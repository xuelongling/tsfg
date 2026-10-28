// SPDX-License-Identifier: MIT
#include "closure-metadata.h"
#include "closure-initialization.h"
#include "dialect.h"
#include "scalar_ops.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "llvm/ADT/DenseSet.h"
#include "llvm/ADT/STLExtras.h"
#include <algorithm>

namespace tsfg::closure {
namespace {
bool scalarOperation(llvm::StringRef name) {
  static const llvm::StringRef names[] = {"tsfg_core.add","tsfg_core.sub","tsfg_core.mul","tsfg_core.div","tsfg_core.rem",
    "tsfg_core.shl","tsfg_core.shr","tsfg_core.ushr","tsfg_core.and","tsfg_core.or","tsfg_core.xor","tsfg_core.neg",
    "tsfg_core.not","tsfg_core.bool_not","tsfg_core.eq","tsfg_core.ne","tsfg_core.lt","tsfg_core.le","tsfg_core.gt","tsfg_core.ge","tsfg_core.pos"};
  return llvm::is_contained(names,name);
}
bool functionIdentity(mlir::func::FuncOp op, const Function &fn, const Index &index) {
  uint32_t start, end;
  if (!attributes(op,{"sym_name","function_type","tsfg_core.function_id","tsfg_core.signature_hash","tsfg_core.type_id",
      "tsfg_core.function_start","tsfg_core.function_end","tsfg_closure.signature","tsfg_closure.lexical_environment","tsfg_closure.activation_environment"})
      || op.getSymName() != fn.symbol || text(op,"tsfg_core.function_id") != fn.id
      || text(op,"tsfg_core.signature_hash") != fn.signatureHash || text(op,"tsfg_core.type_id") != fn.result
      || text(op,"tsfg_closure.signature") != fn.signature || text(op,"tsfg_closure.lexical_environment") != fn.lexicalEnvironment
      || text(op,"tsfg_closure.activation_environment") != fn.activationEnvironment
      || !op->getAttrOfType<mlir::StringAttr>("tsfg_closure.lexical_environment")
      || !op->getAttrOfType<mlir::StringAttr>("tsfg_closure.activation_environment")
      || !number(op,"tsfg_core.function_start",start) || start != fn.start || !number(op,"tsfg_core.function_end",end) || end != fn.end)
    return false;
  const auto type = op.getFunctionType(); const size_t hidden = fn.lexicalEnvironment.empty() ? 0 : 1;
  if (op.isExternal() || type.getNumInputs() != fn.parameters.size() + hidden || type.getNumResults() != 1
      || type.getResult(0) != index.coreType(op.getContext(),fn.result) || op.getBody().front().getNumArguments() != type.getNumInputs()) return false;
  if (hidden && type.getInput(0) != EnvironmentType::get(op.getContext(),fn.lexicalEnvironment)) return false;
  for (size_t i = 0; i < fn.parameters.size(); ++i)
    if (type.getInput(i+hidden) != index.coreType(op.getContext(),fn.parameters[i].type)) return false;
  for (size_t i = 0; i < type.getNumInputs(); ++i) if (op.getBody().front().getArgument(i).getType() != type.getInput(i)) return false;
  return true;
}
}
mlir::LogicalResult verifyProgram(mlir::ModuleOp module, const Metadata &metadata) {
  auto fail = [](llvm::StringRef detail) { return reject("core-ir-closure-invalid",detail); };
  Index index(metadata); if (!index.validate()) return fail("invalid metadata graph");
  std::map<std::string,mlir::func::FuncOp> functions;
  std::set<std::string> identities;
  for (auto &operation : *module.getBody()) {
    auto function = llvm::dyn_cast<mlir::func::FuncOp>(&operation);
    if (!function) return fail("module contains a non-function operation");
    auto found = index.functions.find(text(function,"tsfg_core.function_id").str());
    if (found == index.functions.end() || !identities.insert(found->first).second || !functionIdentity(function,*found->second,index))
      return fail("function identity or typed signature differs");
    functions.emplace(function.getSymName().str(),function);
  }
  if (identities.size() != metadata.functions.size()) return fail("complete function set differs");
  size_t work = 0;
  for (auto &entry : functions) {
    auto function = entry.second;
    const auto &fn = *index.functions.at(text(function,"tsfg_core.function_id").str());
    if (mlir::failed(verifyFunctionGraph(function,fn,index))) return mlir::failure();
    llvm::DenseSet<mlir::Value> registers;
    std::set<std::string> accessible;
    if (!fn.activationEnvironment.empty()) accessible.insert(fn.activationEnvironment);
    std::string environmentId = fn.lexicalEnvironment;
    while (!environmentId.empty()) { accessible.insert(environmentId); environmentId = index.environments.at(environmentId)->parent; }
    auto valueType = [&](mlir::Type type) {
      if (auto environment = llvm::dyn_cast<EnvironmentType>(type)) return accessible.count(environment.key().str()) != 0;
      if (llvm::isa<ClosureType>(type)) return index.callable(type) != nullptr;
      return typeCode(type) != 0;
    };
    for (auto &block : function.getBody()) {
      for (auto value : block.getArguments()) registers.insert(value);
      for (auto &operation : block) for (auto value : operation.getResults()) registers.insert(value);
    }
    if (registers.size() > 4096) return fail("register budget exceeded");
    for (auto value : registers) if (!valueType(value.getType())) return fail("unknown or inaccessible SSA type");
    for (auto &block : function.getBody()) for (auto &operation : block) {
      if (++work > 1000000) return fail("verification work budget exceeded");
      for (auto operand : operation.getOperands()) if (!registers.count(operand)) return fail("operand is outside its function SSA set");
      if (auto returned = llvm::dyn_cast<mlir::func::ReturnOp>(operation)) {
        if (!attributes(returned,{},true) || returned.getNumOperands() != 1
            || returned.getOperand(0).getType() != index.coreType(module.getContext(),fn.result)) return fail("return type differs");
      } else if (llvm::isa<mlir::cf::BranchOp>(operation)) {
        if (!attributes(&operation,{},true)) return fail("unknown branch attribute");
      } else if (llvm::isa<mlir::cf::CondBranchOp>(operation)) {
        if (!attributes(&operation,{"operandSegmentSizes"},true)) return fail("unknown conditional attribute");
      } else if (llvm::isa<FuelOp>(operation)) {
        if (!attributes(&operation,{"event"},true)) return fail("unknown fuel attribute");
      } else if (llvm::isa<ConstantOp>(operation)) {
        if (!attributes(&operation,{"value"},true)) return fail("unknown constant attribute");
      } else if (scalarOperation(operation.getName().getStringRef())) {
        if (!attributes(&operation,{},true)) return fail("unknown scalar attribute");
      } else if (auto call = llvm::dyn_cast<mlir::func::CallOp>(operation)) {
        auto target = functions.find(call.getCallee().str());
        if (!attributes(call,{"callee","tsfg_core.function_id","tsfg_core.signature_hash"},true) || target == functions.end())
          return fail("direct target is missing");
        const auto &targetFn = *index.functions.at(text(target->second,"tsfg_core.function_id").str());
        if (text(call,"tsfg_core.function_id") != targetFn.id || text(call,"tsfg_core.signature_hash") != targetFn.signatureHash
            || call.getNumOperands() != target->second.getFunctionType().getNumInputs() || call.getNumResults() != 1
            || call.getResult(0).getType() != index.coreType(module.getContext(),targetFn.result)) return fail("direct call identity differs");
        for (size_t i = 0; i < call.getNumOperands(); ++i)
          if (call.getOperand(i).getType() != target->second.getFunctionType().getInput(i)) return fail("direct argument type differs");
      } else if (llvm::isa<EnvironmentAllocOp>(operation)) {
        const auto *environment = index.environment(operation.getResult(0).getType());
        if (!environment || environment->owner != fn.id || text(&operation,"layout") != environment->id
            || !attributes(&operation,{"layout","anchor_kind"},true)
            || operation.getNumOperands() != (environment->parent.empty() ? 0 : 1)
            || !environment->parent.empty() && operation.getOperand(0).getType() != EnvironmentType::get(module.getContext(),environment->parent))
          return fail("allocation layout or parent differs");
      } else if (llvm::isa<EnvironmentParentOp>(operation)) {
        const auto *environment = index.environment(operation.getOperand(0).getType());
        if (!environment || environment->parent.empty() || !attributes(&operation,{},true)
            || operation.getResult(0).getType() != EnvironmentType::get(module.getContext(),environment->parent))
          return fail("parent edge differs");
      } else if (llvm::isa<EnvironmentInitOp,EnvironmentLoadOp,EnvironmentStoreOp>(operation)) {
        const auto *environment = index.environment(operation.getOperand(0).getType());
        if (!environment) return fail("slot environment is unknown");
        auto binding = text(&operation,"binding");
        auto slot = std::find_if(environment->slots.begin(),environment->slots.end(),[&](const Slot &slot) { return slot.binding == binding; });
        const bool init = llvm::isa<EnvironmentInitOp>(operation), load = llvm::isa<EnvironmentLoadOp>(operation);
        if (!attributes(&operation,init ? llvm::ArrayRef<llvm::StringRef>{"binding","anchor_kind"} : llvm::ArrayRef<llvm::StringRef>{"binding"},true)
            || slot == environment->slots.end()) return fail("unknown slot or attribute");
        auto type = index.coreType(module.getContext(),slot->type);
        if ((load ? operation.getResult(0).getType() != type : operation.getOperand(1).getType() != type)
            || llvm::isa<EnvironmentStoreOp>(operation) && !slot->writable)
          return fail("slot type or write permission differs");
      } else if (llvm::isa<MakeOp>(operation)) {
        auto target = index.functions.find(text(&operation,"function_id").str());
        if (!attributes(&operation,{"function_id","signature_hash"},true) || target == index.functions.end()) return fail("closure target is missing");
        const auto &targetFn = *target->second;
        if (text(&operation,"signature_hash") != targetFn.signatureHash
            || operation.getResult(0).getType() != ClosureType::get(module.getContext(),targetFn.signature)
            || operation.getNumOperands() != (targetFn.lexicalEnvironment.empty() ? 0 : 1)
            || !targetFn.lexicalEnvironment.empty() && operation.getOperand(0).getType() != EnvironmentType::get(module.getContext(),targetFn.lexicalEnvironment))
          return fail("closure code/signature/environment differs");
      } else if (llvm::isa<CallOp>(operation)) {
        const auto *type = index.callable(operation.getOperand(0).getType());
        if (!type || !attributes(&operation,{"signature","signature_hash"},true)
            || text(&operation,"signature") != type->id || text(&operation,"signature_hash") != index.signatureHashes.at(type->id)
            || operation.getNumOperands() != type->parameters.size()+1
            || operation.getResult(0).getType() != index.coreType(module.getContext(),type->result)) return fail("closure call signature differs");
        for (size_t i = 0; i < type->parameters.size(); ++i)
          if (operation.getOperand(i+1).getType() != index.coreType(module.getContext(),type->parameters[i])) return fail("closure argument type differs");
      } else return fail("unsupported operation");
    }
  }
  return verifyInitialization(module,index);
}
} // namespace tsfg::closure
