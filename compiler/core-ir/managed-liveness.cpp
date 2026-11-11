// SPDX-License-Identifier: MIT
#include "managed-liveness.h"
#include "reference.h"
#include "closure.h"
#include "array-core.h"
#include "common-program.h"
#include "module.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/BitVector.h"
#include "llvm/ADT/DenseMap.h"
#include "llvm/ADT/STLExtras.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <deque>

namespace tsfg {
mlir::LogicalResult recomputeManagedLiveness(mlir::func::FuncOp function, ManagedDomain domain, ManagedLiveness &output) {
  output = ManagedLiveness{}; ManagedLiveness result;
  const bool closureDomain = domain == ManagedDomain::Closure;
  const bool arrayDomain = domain == ManagedDomain::Array;
  auto reject = [&](llvm::StringRef reason) {
    llvm::errs() << (arrayDomain ? "[core-ir-array-roots] " : closureDomain ? "[core-ir-closure-roots] " : "[core-ir-reference-roots] ") << reason << '\n'; return mlir::failure();
  };
  llvm::DenseMap<mlir::Block *, unsigned> blocks;
  llvm::DenseMap<mlir::Value, unsigned> registers;
  auto &values = result.values;
  if (function.getBody().empty() || function.getBody().getBlocks().size() > 256) return reject("block budget exceeded");
  for (auto &block : function.getBody()) {
    if (block.empty()) return reject("empty block");
    blocks[&block] = static_cast<unsigned>(blocks.size());
    for (auto argument : block.getArguments()) { registers[argument] = static_cast<unsigned>(values.size()); values.push_back(argument); }
    for (auto &operation : block) for (auto value : operation.getResults()) {
      registers[value] = static_cast<unsigned>(values.size()); values.push_back(value);
    }
  }
  if (values.size() > (arrayDomain ? 4219u : 4096u)) return reject("register limit exceeded");
  std::vector<llvm::BitVector> incoming(blocks.size(),llvm::BitVector(values.size()));
  std::vector<std::vector<unsigned>> predecessors(blocks.size());
  std::vector<mlir::Block *> ordered(blocks.size());
  for (auto &block : function.getBody()) {
    auto index = blocks.lookup(&block); ordered[index] = &block;
    for (auto *next : block.back().getSuccessors()) {
      if (!blocks.count(next)) return reject("successor is outside its function");
      predecessors[blocks.lookup(next)].push_back(index);
    }
  }
  bool valid = true; size_t workCount = 0;
  auto step = [&]() { if ((closureDomain || arrayDomain) && ++workCount > 1000000) valid = false; };
  auto managed = [&](mlir::Type type) {
    return arrayDomain ? llvm::isa<arrays::ArrayType,arrays::ReadSpanType>(type)
      : closureDomain ? llvm::isa<closure::EnvironmentType,closure::ClosureType>(type) : llvm::isa<ReferenceType>(type);
  };
  auto add = [&](llvm::BitVector &live, mlir::Value value) {
    step(); auto found = registers.find(value);
    if (found == registers.end()) { valid = false; return; }
    if (managed(value.getType())) live.set(found->second);
  };
  auto outgoing = [&](mlir::Block &block) {
    llvm::BitVector live(values.size());
    auto edge = [&](mlir::Block *destination, mlir::ValueRange arguments) {
      const auto &target = incoming[blocks.lookup(destination)];
      for (int bit = target.find_first(); bit >= 0; bit = target.find_next(bit)) {
        step(); auto value = values[bit]; auto argument = llvm::dyn_cast<mlir::BlockArgument>(value);
        if (argument && argument.getOwner() == destination) {
          if (argument.getArgNumber() >= arguments.size()) { valid = false; continue; }
          add(live,arguments[argument.getArgNumber()]);
        } else live.set(bit);
      }
    };
    if (auto branch = llvm::dyn_cast<mlir::cf::BranchOp>(block.back())) edge(branch.getDest(),branch.getDestOperands());
    else if (auto branch = llvm::dyn_cast<mlir::cf::CondBranchOp>(block.back())) {
      edge(branch.getTrueDest(),branch.getTrueDestOperands()); edge(branch.getFalseDest(),branch.getFalseDestOperands());
    }
    return live;
  };
  auto before = [&](mlir::Operation &operation, llvm::BitVector &live) {
    step();
    for (auto value : operation.getResults()) live.reset(registers.lookup(value));
    // Only live destination arguments transfer across their corresponding edge.
    if (llvm::isa<mlir::cf::BranchOp,mlir::cf::CondBranchOp>(operation)) return;
    for (auto operand : operation.getOperands()) add(live,operand);
  };
  std::deque<unsigned> work; std::vector<bool> queued(blocks.size(),true);
  for (size_t i = blocks.size(); i > 0; --i) work.push_back(static_cast<unsigned>(i-1));
  while (!work.empty()) {
    if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
    auto index = work.front(); work.pop_front(); queued[index] = false;
    auto live = outgoing(*ordered[index]);
    for (auto &operation : llvm::reverse(*ordered[index])) before(operation,live);
    if (live == incoming[index]) continue;
    incoming[index] = std::move(live);
    for (auto predecessor : predecessors[index]) if (!queued[predecessor]) { queued[predecessor] = true; work.push_back(predecessor); }
  }
  if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
  size_t entries = 0;
  for (auto &block : function.getBody()) {
    auto live = outgoing(block); std::vector<ManagedLivePoint> reversePoints;
    auto instruction = block.getOperations().size();
    for (auto &operation : llvm::reverse(block)) {
      --instruction; before(operation,live);
      // The Array slice exposes call suspension roots only, not allocation/GC ABI.
      const bool point = arrayDomain ? llvm::isa<mlir::func::CallOp>(operation) : closureDomain
        ? llvm::isa<closure::EnvironmentAllocOp,closure::CallOp,mlir::func::CallOp>(operation)
        : llvm::isa<ReferenceAllocOp,ReferenceCallOp,mlir::func::CallOp,AuthorizedHostOp>(operation);
      if (!point) continue;
      ManagedLivePoint record{blocks.lookup(&block),static_cast<uint32_t>(instruction),&operation,{}};
      for (int bit = live.find_first(); bit >= 0; bit = live.find_next(bit)) record.registers.push_back(static_cast<uint32_t>(bit));
      entries += record.registers.size();
      if (entries > 1048576) return reject("root map exceeds candidate byte budget");
      reversePoints.push_back(std::move(record));
    }
    result.points.insert(result.points.end(),reversePoints.rbegin(),reversePoints.rend());
  }
  if (!valid) return reject("invalid SSA operand or liveness work budget exceeded");
  result.work = workCount;
  output = std::move(result); return mlir::success();
}

bool analyzeCommonCallRoots(mlir::ModuleOp module,llvm::StringRef functionId,
    CommonCallRoots &output,commonProgram::Error &error,size_t workLimit) {
  using namespace commonProgram;
  using exception::field;
  using exception::items;
  output={};error={};
  Program program;
  if(!readCore(module,program,error)||!verifyProgram(program,error))return false;
  CommonCallRoots result;
  const auto limit=std::min(workLimit,commonCallRootsWorkLimit);
  const auto spend=[&](size_t count){
    if(count>limit-result.work||!program.charge(count))
      return reject(error,"core-ir-common-call-roots-budget","managed call root analysis work exceeded");
    result.work+=count;return true;
  };
  if(!spend(program.functions.size()))return false;
  const auto selected=llvm::find_if(program.functions,[&](const Function &fn){return fn.id==functionId;});
  if(selected==program.functions.end())
    return reject(error,"core-ir-common-call-roots-function","FunctionId is absent from the verified Common module");
  const auto &fn=*selected;
  const auto width=fn.carriers.size(),words=(width+63)/64;
  if(!spend(fn.blocks.size()*(words+1)+width+1))return false;

  std::set<llvm::StringRef> direct;
  for(const auto &row:items(field(program.hir,"types"))){
    const auto id=field(row,"id").getAsString().value(),kind=field(row,"kind").getAsString().value();
    if(!spend(id.size()/8+1))return false;
    if(kind=="reference"||kind=="array")direct.insert(id);
  }
  for(const auto &row:items(field(program.representation,"domains"))){
    const auto id=field(row,"id").getAsString().value();
    if(!spend(id.size()/8+1))return false;
    if(field(row,"representation").getAsString()!="reference")continue;
    const auto &members=items(field(row,"actualTypes"));bool oneHandle=!members.empty();
    for(const auto &member:members){
      const auto type=member.getAsString().value();if(!spend(type.size()/8+1))return false;
      oneHandle=direct.count(type)&&oneHandle;
    }
    if(oneHandle)direct.insert(id);
  }
  std::map<llvm::StringRef,llvm::StringRef> bindings;
  for(const auto &row:items(field(program.representation,"bindings"))){
    const auto id=field(row,"id").getAsString().value();
    if(!spend(id.size()/8+1))return false;
    bindings.emplace(id,field(row,"carrier").getAsString().value());
  }
  enum class RootKind { None, Handle, Unsupported };
  std::vector<RootKind> kinds;
  kinds.reserve(width);
  for(llvm::StringRef carrier:fn.carriers){
    if(!spend(carrier.size()/8+1))return false;
    const bool cell=carrier.starts_with("cell:");
    if(cell){
      const auto binding=bindings.find(carrier.drop_front(5));
      if(binding==bindings.end()){kinds.push_back(RootKind::Unsupported);continue;}
      carrier=binding->second;
      if(!spend(carrier.size()/8+1))return false;
    }
    const auto layout=program.layouts.find(carrier.str());
    if(layout!=program.layouts.end()&&layout->second.referenceCount==0)kinds.push_back(RootKind::None);
    else if(!cell&&direct.count(carrier)&&layout!=program.layouts.end()&&
            layout->second.referenceCount==1&&layout->second.byteSize==8&&layout->second.alignment==8)
      kinds.push_back(RootKind::Handle);
    else kinds.push_back(RootKind::Unsupported);
  }

  const auto forwards=[](const Operation &op){return op.name=="cf.br"||op.name=="cf.cond_br"||op.name=="route";};
  const auto call=[](const Operation &op){
    return op.name=="invoke"||op.name=="invoke_method"||op.name=="invoke_indirect"||op.name=="host_call";
  };
  std::vector<llvm::BitVector> incoming(fn.blocks.size(),llvm::BitVector(width));
  std::vector<std::vector<uint16_t>> predecessors(fn.blocks.size());
  for(size_t block=0;block<fn.blocks.size();++block){
    const auto &end=fn.blocks[block].operations.back();
    if(!spend(end.successors.size()+1))return false;
    if(!end.successors.empty()&&!forwards(end)&&!call(end)&&end.name!="numeric_use"&&
        end.name!="receiver_bind"&&end.name!="receiver_get"&&end.name!="receiver_result")
      return reject(error,"core-ir-common-call-roots-capability","unsupported Common control edge");
    for(const auto successor:end.successors)predecessors[successor].push_back(uint16_t(block));
  }
  const auto transfer=[&](uint16_t block,llvm::BitVector &live){
    const auto &end=fn.blocks[block].operations.back();
    const bool forwarded=forwards(end);
    size_t offset=end.name=="cf.cond_br"?1:0;
    for(const auto successor:end.successors){
      const auto &parameters=fn.blocks[successor].parameters;
      if(!spend(2*words+parameters.size()+1))return false;
      auto carried=incoming[successor];
      for(const auto reg:parameters){
        // Only branches forward existing SSA operands. Calls and receiver or
        // numeric completions define their own successor arguments.
        if(forwarded&&carried.test(reg))live.set(end.operands[offset]);
        carried.reset(reg);++offset;
      }
      live|=carried;
    }
    return true;
  };
  const auto before=[&](const Operation &op,llvm::BitVector &live){
    if(!spend(op.operands.size()+1))return false;
    if(op.result!=noRegister)live.reset(op.result);
    if(op.name=="cf.cond_br")live.set(op.operands[0]);
    else if(!forwards(op))for(const auto operand:op.operands)live.set(operand);
    return true;
  };
  std::deque<uint16_t> pending;
  std::vector<bool> queued(fn.blocks.size(),true);
  for(size_t block=fn.blocks.size();block>0;--block)pending.push_back(uint16_t(block-1));
  while(!pending.empty()){
    const auto block=pending.front();pending.pop_front();queued[block]=false;
    if(!spend(2*words+1))return false;
    llvm::BitVector live(width);
    if(!transfer(block,live))return false;
    for(const auto &op:llvm::reverse(fn.blocks[block].operations))if(!before(op,live))return false;
    if(incoming[block]==live)continue;
    incoming[block]=std::move(live);
    if(!spend(predecessors[block].size()))return false;
    for(const auto predecessor:predecessors[block])if(!queued[predecessor]){
      queued[predecessor]=true;pending.push_back(predecessor);
    }
  }

  const auto &sources=program.operationSources.at(fn.id);
  for(size_t block=0;block<fn.blocks.size();++block){
    if(!spend(words+1))return false;
    llvm::BitVector live(width);
    if(!transfer(uint16_t(block),live))return false;
    std::vector<CommonCallRootPoint> points;
    const auto &operations=fn.blocks[block].operations;
    for(size_t i=operations.size();i>0;--i){
      const auto &op=operations[i-1];if(!before(op,live))return false;
      if(!call(op))continue;
      const auto &path=sources.at({uint16_t(block),uint16_t(i-1)});
      if(!spend(words+path.size()/8+op.name.size()/8+2))return false;
      CommonCallRootPoint point{uint16_t(block),uint16_t(i-1),op.name,path,op.range.start,op.range.end,{}};
      for(int reg=live.find_first();reg>=0;reg=live.find_next(reg)){
        if(!spend(1))return false;
        if(kinds[reg]==RootKind::Unsupported){
          error.path=path;error.range=op.range;
          return reject(error,"core-ir-common-call-roots-capability","live carrier has no direct managed root component proof");
        }
        if(kinds[reg]==RootKind::Handle)point.registers.push_back(uint16_t(reg));
      }
      points.push_back(std::move(point));
    }
    for(auto &point:llvm::reverse(points))result.points.push_back(std::move(point));
  }
  if(!spend(program.inputIdentity.size()/8+fn.id.size()/8+1))return false;
  result.inputIdentity=std::move(program.inputIdentity);
  result.functionId=fn.id;
  result.carriers=std::move(selected->carriers);
  output=std::move(result);return true;
}
} // namespace tsfg
