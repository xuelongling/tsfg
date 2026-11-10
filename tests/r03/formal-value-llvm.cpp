// SPDX-License-Identifier: MIT
// Compiler-data driver: reads the complete genuine Core and verifies LLVM IR.
// It never calls generated functions, a backend, TargetMachine or a Runtime.
#include "common-program-value-lowering.h"
#include "common-program-return-origins-v4.h"
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "llvm/AsmParser/Parser.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <functional>

namespace {
struct Graph {
  std::vector<const llvm::BasicBlock *> blocks;
  std::map<const llvm::BasicBlock *,size_t> indices;
  std::vector<std::vector<size_t>> edges;
  std::vector<std::set<size_t>> dominators;
  std::set<size_t> repeating;unsigned backedges=0;
  explicit Graph(const llvm::Function &function){
    for(const auto &block:function){indices.emplace(&block,blocks.size());blocks.push_back(&block);}
    edges.resize(blocks.size());std::vector<std::set<size_t>> predecessors(blocks.size());
    for(size_t i=0;i<blocks.size();++i){const auto *end=blocks[i]->getTerminator();
      for(unsigned j=0;j<end->getNumSuccessors();++j){const auto to=indices.at(end->getSuccessor(j));edges[i].push_back(to);predecessors[to].insert(i);}}
    std::vector<unsigned> color(blocks.size());
    std::function<void(size_t)> visit=[&](size_t at){color[at]=1;for(auto to:edges[at]){if(!color[to])visit(to);else if(color[to]==1)++backedges;}color[at]=2;};visit(0);
    std::vector<int> discovered(blocks.size(),-1),low(blocks.size());std::vector<bool> onStack(blocks.size());std::vector<size_t> stack;int sequence=0;
    std::function<void(size_t)> component=[&](size_t at){discovered[at]=low[at]=sequence++;stack.push_back(at);onStack[at]=true;
      for(auto to:edges[at]){if(discovered[to]<0){component(to);low[at]=std::min(low[at],low[to]);}else if(onStack[to])low[at]=std::min(low[at],discovered[to]);}
      if(low[at]!=discovered[at])return;std::vector<size_t> members;
      while(true){const auto member=stack.back();stack.pop_back();onStack[member]=false;members.push_back(member);if(member==at)break;}
      if(members.size()>1||std::find(edges[at].begin(),edges[at].end(),at)!=edges[at].end())repeating.insert(members.begin(),members.end());
    };for(size_t i=0;i<blocks.size();++i)if(discovered[i]<0)component(i);
    std::set<size_t> all;for(size_t i=0;i<blocks.size();++i)all.insert(i);dominators.assign(blocks.size(),all);dominators[0]={0};
    bool changed=true;while(changed){changed=false;for(size_t i=1;i<blocks.size();++i){auto next=all;
      for(auto from:predecessors[i]){std::set<size_t> both;std::set_intersection(next.begin(),next.end(),dominators[from].begin(),dominators[from].end(),std::inserter(both,both.end()));next=std::move(both);}
      next.insert(i);if(next!=dominators[i]){dominators[i]=std::move(next);changed=true;}}}
  }
  bool acyclicWithout(const std::set<size_t> &removed)const{
    std::vector<unsigned> color(blocks.size());std::function<bool(size_t)> visit=[&](size_t at){
      if(removed.count(at)||color[at]==2)return true;if(color[at]==1)return false;color[at]=1;
      for(auto to:edges[at])if(!visit(to))return false;color[at]=2;return true;};
    for(size_t i=0;i<blocks.size();++i)if(!visit(i))return false;return true;
  }
};
bool freshCopy(const llvm::StoreInst &store){
  const auto *loaded=llvm::dyn_cast<llvm::LoadInst>(store.getValueOperand());
  const auto *allocation=llvm::dyn_cast<llvm::AllocaInst>(store.getPointerOperand());
  return loaded&&allocation&&loaded->getParent()==allocation->getParent()&&allocation->getParent()==store.getParent()&&loaded->comesBefore(allocation)&&allocation->comesBefore(&store);
}
llvm::json::Value certificateControls(){
  namespace V4=CommonReturnOriginV4;
  using Json=llvm::json::Value;using Object=llvm::json::Object;using Array=llvm::json::Array;
  V4::Directory directory;directory.functionId="F";directory.types.emplace("T",V4::TypeRow{V4::TypeKind::Value});directory.types.emplace("i32",V4::TypeRow{V4::TypeKind::Scalar});directory.types.emplace("void",V4::TypeRow{V4::TypeKind::Void});
  V4::FunctionRow function;function.kind=V4::FunctionKind::Source;function.parameterTypes={"T"};function.returnType="T";function.environmentMetadataComplete=true;directory.functions.emplace("F",function);
  function.parameterTypes.clear();directory.functions.emplace("H",function);directory.fields.insert("n");directory.fields.insert("m");directory.fields.insert("left");directory.fields.insert("right");
  const auto empty=[]()->Json{return Object{{"format",Object{{"family","tsfg.return-origin-graph-candidate"},{"version",5}}},{"nodes",Array{}},{"heaps",Array{Object{{"kind","entry"}}}},
    {"controls",Array{Object{{"kind","entry"}}}},{"calls",Array{}},{"normal",Array{}},{"language",Array{}},{"exits",Object{{"normal",Array{Object{{"heap",0},{"control",0}}}},{"language",Array{}}}},{"accesses",Array{}}};};
  const auto parameter=[]()->Json{return Object{{"kind","parameter"},{"type","T"},{"index",0}};};
  const auto typed=[&](const Json &raw,const V4::Directory &context)->std::optional<V4::Graph>{size_t left=200000;auto result=V4::read(raw,context,[&](size_t n){if(n>left)return false;left-=n;return true;});if(result.status!=V4::ReadStatus::Typed){llvm::errs()<<"origin control reader: "<<result.reason<<'\n';return std::nullopt;}return std::move(result.graph);};
  Array rows;bool valid=true;
  const auto check=[&](const char *name,const V4::Graph &body,const V4::Graph &upper,const V4::FixedContracts &fixed,V4::InclusionStatus expected){
    size_t left=200000;const auto result=V4::covered(body,upper,fixed,[&](size_t n){if(n>left)return false;left-=n;return true;});const bool passed=result.status==expected;valid&=passed;rows.push_back(Object{{"name",name},{"passed",passed},{"work",int64_t(200000-left)}});
    if(!passed)llvm::errs()<<"origin control failed: "<<name<<" "<<result.reason<<'\n';
  };
  auto cyclic=empty();*cyclic.getAsObject()->getArray("nodes")=Array{parameter(),Object{{"kind","copy"},{"type","T"},{"bases",Array{0}},{"site","loop-copy"},{"heap",1},{"control",0}}};
  *cyclic.getAsObject()->getArray("heaps")=Array{Object{{"kind","entry"}},Object{{"kind","join"},{"inputs",Array{0,2}}},Object{{"kind","copy"},{"previous",1},{"value",1}}};
  *cyclic.getAsObject()->getArray("normal")=Array{1};*cyclic.getAsObject()->getObject("exits")->getArray("normal")=Array{Object{{"heap",2},{"control",0}}};
  const auto cycle=typed(cyclic,directory);if(!cycle)return nullptr;check("identical cyclic typed graph",*cycle,*cycle,{},V4::InclusionStatus::Covered);
  auto unknown=cyclic;unknown.getAsObject()->getArray("nodes")->push_back(Object{{"kind","unknown"},{"type",nullptr}});const auto uncertain=typed(unknown,directory);if(!uncertain)return nullptr;check("identical unknown remains open",*uncertain,*uncertain,{},V4::InclusionStatus::Open);
  auto caller=empty();caller.getAsObject()->getArray("calls")->push_back(Object{{"functionId","H"},{"arguments",Array{}},{"environment",nullptr},{"callee",nullptr},{"receiver",nullptr},{"heap",0},{"control",0},{"site","syntax-call"}});
  const auto call=typed(caller,directory);if(!call)return nullptr;check("missing selected callee",*call,*call,{},V4::InclusionStatus::Open);check("null selected callee",*call,*call,V4::FixedContracts{{"H",nullptr}},V4::InclusionStatus::Open);
  const auto projection=[&](const char *selector){auto raw=empty();*raw.getAsObject()->getArray("nodes")=Array{parameter(),Object{{"kind","projection"},{"type","T"},{"bases",Array{0}},{"selector",selector},{"view","T"},{"heap",0},{"control",0}}};*raw.getAsObject()->getArray("normal")=Array{1};return typed(raw,directory);};
  const auto left=projection("field:n"),right=projection("field:m");if(!left||!right)return nullptr;check("different field retains structural rejection",*left,*right,{},V4::InclusionStatus::Open);
  const auto copies=[&](bool separate,const char *site){auto raw=empty();auto &nodes=*raw.getAsObject()->getArray("nodes"),&heaps=*raw.getAsObject()->getArray("heaps");
    nodes=Array{Object{{"kind","local"},{"type","T"}},Object{{"kind","local"},{"type","T"}},Object{{"kind","copy"},{"type","T"},{"bases",Array{0}},{"site",site},{"heap",0},{"control",0}}};heaps.push_back(Object{{"kind","copy"},{"previous",0},{"value",2}});
    if(separate){nodes.push_back(Object{{"kind","copy"},{"type","T"},{"bases",Array{0}},{"site","right-copy"},{"heap",1},{"control",0}});heaps.push_back(Object{{"kind","copy"},{"previous",1},{"value",3}});}
    for(const auto *selector:{"field:left","field:right"})heaps.push_back(Object{{"kind","store"},{"previous",int64_t(heaps.size()-1)},{"bases",Array{1}},{"selector",selector},{"view","T"},{"values",Array{separate&&llvm::StringRef(selector)=="field:right"?3:2}},{"initialize",true},{"control",0}});
    *raw.getAsObject()->getArray("normal")=Array{1};*raw.getAsObject()->getObject("exits")->getArray("normal")=Array{Object{{"heap",int64_t(heaps.size()-1)},{"control",0}}};raw.getAsObject()->getArray("accesses")->push_back(Object{{"values",Array{1}},{"flag","write"},{"control",0}});return typed(raw,directory);};
  const auto shared=copies(false,"left-copy"),renamed=copies(false,"published-copy"),separate=copies(true,"left-copy");if(!shared||!renamed||!separate)return nullptr;
  check("nonidentical alpha certificate remains covered",*shared,*renamed,{},V4::InclusionStatus::Covered);check("different copy sharing remains open",*shared,*separate,{},V4::InclusionStatus::Open);
  auto construction=directory;auto &constructor=construction.functions.at("F");constructor.kind=V4::FunctionKind::ConstructionBody;constructor.returnType="void";constructor.construction=V4::Constructor{"C","T",std::nullopt,0};construction.constructions.emplace("C",V4::Construction{"C","T","explicit",std::nullopt,"F"});
  auto receiver=empty();receiver.getAsObject()->getArray("nodes")->push_back(Object{{"kind","receiverInput"},{"type",nullptr}});const auto first=typed(receiver,construction);receiver.getAsObject()->getArray("nodes")->push_back(Object{{"kind","nonowning"},{"type","i32"}});const auto second=typed(receiver,construction);if(!first||!second)return nullptr;
  check("nonidentical receiver remains open",*first,*second,{},V4::InclusionStatus::Open);
  if(!valid)return nullptr;return Object{{"passed",true},{"controls",std::move(rows)},{"SourceProducer",false},{"executionAuthority",false}};
}
}

int main(int argc,char **argv){
  if(argc==2&&llvm::StringRef(argv[1])=="--origin-certificate-controls"){const auto controls=certificateControls();if(controls.getAsNull())return 4;llvm::outs()<<tsfg::commonProgram::canonical(controls)<<'\n';return 0;}
  if(argc!=3)return 2;
  auto bytes=llvm::MemoryBuffer::getFile(argv[1]);if(!bytes)return 2;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);tsfg::commonProgram::registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect,mlir::LLVM::LLVMDialect>();
  mlir::MLIRContext context(registry);context.disableMultithreading();
  auto core=mlir::parseSourceString<mlir::ModuleOp>((*bytes)->getBuffer(),&context);
  tsfg::commonProgram::Error error;tsfg::commonProgram::FixedValueLLVM lowered;
  if(!core||!tsfg::commonProgram::lowerFixedValueLLVM(*core,argv[2],lowered,error)){
    llvm::errs()<<'['<<error.code<<"] "<<error.message;
    if(!error.path.empty())llvm::errs()<<" ("<<error.path<<":"<<error.range.start<<":"<<error.range.end<<")";
    llvm::errs()<<'\n';return 3;
  }
  llvm::LLVMContext llvmContext;llvm::SMDiagnostic diagnostic;
  auto module=llvm::parseAssemblyString(lowered.llvm,diagnostic,llvmContext);
  if(!module||llvm::verifyModule(*module,&llvm::errs()))return 4;
  auto *function=module->getFunction("value_"+std::string(argv[2]).substr(7));
  if(!function||function->arg_size()<2)return 4;
  const auto *metadata=module->getNamedMetadata("tsfg.fixed.value");
  if(!metadata||metadata->getNumOperands()!=1||metadata->getOperand(0)->getNumOperands()!=1)return 4;
  const auto *encoded=llvm::dyn_cast<llvm::MDString>(metadata->getOperand(0)->getOperand(0));
  if(!encoded)return 4;auto decoded=llvm::json::parse(encoded->getString());if(!decoded)return 4;
  auto cold=mlir::parseSourceString<mlir::ModuleOp>(lowered.mlir,&context);
  if(!cold||mlir::failed(mlir::verify(*cold)))return 4;
  const auto coldProof=(*cold)->getAttrOfType<mlir::StringAttr>("tsfg_program.fixed_value");if(!coldProof||coldProof.getValue()!=encoded->getString())return 4;
  std::string roundTrip;llvm::raw_string_ostream coldStream(roundTrip);cold->print(coldStream,mlir::OpPrintingFlags().printGenericOpForm());coldStream<<'\n';coldStream.flush();if(roundTrip!=lowered.mlir)return 4;
  using namespace tsfg::commonProgram;
  using tsfg::exception::field;using tsfg::exception::items;using tsfg::exception::string;
  Program source;if(!readCore(*core,source,error))return 4;
  if(string(field(*decoded,"functionId"))!=argv[2]||field(*decoded,"executionAuthority").getAsBoolean()!=false)return 4;
  if(string(field(*decoded,"inputIdentity"))!=source.inputIdentity||string(field(*decoded,"hirDigest"))!=source.hirHash||items(field(*decoded,"functions")).size()!=source.functions.size())return 4;
  std::map<std::string,size_t> functionIndices;
  for(size_t index=0;index<source.functions.size();++index){
    functionIndices.emplace("value_"+source.functions[index].id.substr(7),index);
    const auto &row=items(field(*decoded,"functions"))[index];const auto &fn=source.functions[index];
    if(string(field(row,"id"))!=fn.id||string(field(row,"source"))!=fn.path||field(row,"start").getAsInteger()!=fn.range.start||field(row,"end").getAsInteger()!=fn.range.end)return 4;
  }
  std::string original;llvm::raw_string_ostream originalStream(original);core->print(originalStream,mlir::OpPrintingFlags().printGenericOpForm());originalStream<<'\n';originalStream.flush();
  if(string(field(*decoded,"fullCore"))!=original)return 4;
  unsigned callbacks=0,stackmaps=0,geps=0,copies=0,comparisons=0,calls=0,functions=0;
  Array aggregateCopies,fieldWrites,fieldReads,eventRows,nativeLayouts,controlFlows;unsigned fieldComparisons=0,sourceFuelSites=0;
  std::set<uint64_t> intervals;
  for(const auto &fn:*module){
    if(fn.isDeclaration()){
      if(!fn.getName().starts_with("llvm.experimental.stackmap"))return 4;continue;
    }++functions;
    if(!functionIndices.count(fn.getName().str())||fn.arg_size()<2)return 4;
    const auto currentFunction=functionIndices.at(fn.getName().str());
    Graph graph(fn);std::set<size_t> fuelBlocks;Array instructions,blockRows;const llvm::StoreInst *repeatedCopy=nullptr;
    std::map<const llvm::Value *,int64_t> valueIds;
    for(const auto &argument:fn.args())valueIds.emplace(&argument,valueIds.size());
    for(const auto &block:fn)for(const auto &operation:block)valueIds.emplace(&operation,valueIds.size());
    const auto valueId=[&](const llvm::Value *value)->int64_t{return valueIds.count(value)?valueIds.at(value):-1;};
    for(const auto &block:source.functions[currentFunction].blocks)for(const auto &operation:block.operations)sourceFuelSites+=operation.name=="fuel";
    for(const auto &argument:fn.args())if(const auto *structure=llvm::dyn_cast<llvm::StructType>(argument.getType())){
      const auto *layout=module->getDataLayout().getStructLayout(const_cast<llvm::StructType *>(structure));Array offsets;
      for(size_t i=0;i<structure->getNumElements();++i)offsets.push_back(int64_t(layout->getElementOffset(i)));
      nativeLayouts.push_back(Object{{"function",fn.getName().str()},{"argument",argument.getArgNo()},{"byteSize",int64_t(layout->getSizeInBytes())},
        {"alignment",int64_t(layout->getAlignment().value())},{"offsets",std::move(offsets)}});
    }
    std::map<const llvm::Value *,int64_t> slots;
    for(const auto &block:fn)for(const auto &operation:block)if(llvm::isa<llvm::AllocaInst>(operation))slots.emplace(&operation,slots.size());
    std::set<const llvm::Value *> visiting;
    std::function<std::set<int64_t>(const llvm::Value *)> roots=[&](const llvm::Value *value)->std::set<int64_t>{
      if(slots.count(value))return {slots.at(value)};if(!visiting.insert(value).second)return {};std::set<int64_t> found;
      const auto add=[&](const llvm::Value *next){const auto child=roots(next);found.insert(child.begin(),child.end());};
      if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(value))add(pointer->getPointerOperand());
      if(const auto *phi=llvm::dyn_cast<llvm::PHINode>(value))for(const auto &incoming:phi->incoming_values())add(incoming.get());
      if(const auto *load=llvm::dyn_cast<llvm::LoadInst>(value);load&&load->getType()->isPointerTy()){
        for(const auto *user:load->getPointerOperand()->users())if(const auto *store=llvm::dyn_cast<llvm::StoreInst>(user);store&&store->getPointerOperand()==load->getPointerOperand()){
          add(store->getValueOperand());
        }
      }visiting.erase(value);return found;
    };
    const auto root=[&](const llvm::Value *value)->int64_t{const auto found=roots(value);return found.size()==1?*found.begin():-1;};
    for(const auto &block:fn)for(const auto &operation:block){
      const auto blockId=graph.indices.at(&block);Object record{{"id",valueId(&operation)},{"block",int64_t(blockId)},{"kind",operation.getOpcodeName()}};
      if(const auto *allocation=llvm::dyn_cast<llvm::AllocaInst>(&operation)){
        record["element"]=allocation->getAllocatedType()->isStructTy()?"aggregate":allocation->getAllocatedType()->isPointerTy()?"pointer":"scalar";
        record["repeating"]=graph.repeating.count(blockId)!=0;record["slot"]=slots.at(allocation);
      }
      if(const auto *load=llvm::dyn_cast<llvm::LoadInst>(&operation)){record["pointer"]=valueId(load->getPointerOperand());record["pointerResult"]=load->getType()->isPointerTy();}
      if(const auto *store=llvm::dyn_cast<llvm::StoreInst>(&operation)){record["pointer"]=valueId(store->getPointerOperand());record["value"]=valueId(store->getValueOperand());}
      if(const auto *branch=llvm::dyn_cast<llvm::BranchInst>(&operation);branch&&branch->isConditional())record["condition"]=valueId(branch->getCondition());
      if(const auto *returned=llvm::dyn_cast<llvm::ReturnInst>(&operation);returned&&returned->getReturnValue())record["value"]=valueId(returned->getReturnValue());
      if(const auto *comparison=llvm::dyn_cast<llvm::ICmpInst>(&operation)){
        record["predicate"]=llvm::CmpInst::getPredicateName(comparison->getPredicate()).str();Array operands;
        for(const auto &operand:comparison->operands())operands.push_back(valueId(operand.get()));record["operands"]=std::move(operands);
      }
      if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(&operation))record["pointer"]=valueId(pointer->getPointerOperand());
      if(const auto *phi=llvm::dyn_cast<llvm::PHINode>(&operation)){Array incoming;for(const auto &value:phi->incoming_values())incoming.push_back(valueId(value.get()));record["incoming"]=std::move(incoming);}
      for(const auto &operand:operation.operands())if(llvm::isa<llvm::UndefValue,llvm::PoisonValue>(operand))return 4;
      if(llvm::isa<llvm::GetElementPtrInst>(operation))++geps;
      if(const auto *load=llvm::dyn_cast<llvm::LoadInst>(&operation))if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(load->getPointerOperand())){
        Array indices;for(const auto &index:pointer->indices()){const auto *literal=llvm::dyn_cast<llvm::ConstantInt>(index);if(!literal)return 4;indices.push_back(int64_t(literal->getZExtValue()));}
        fieldReads.push_back(Object{{"indices",std::move(indices)},{"rootSlot",root(pointer)},{"function",fn.getName().str()}});
      }
      if(const auto *store=llvm::dyn_cast<llvm::StoreInst>(&operation)){
        copies+=store->getValueOperand()->getType()->isStructTy();
        if(const auto *loaded=llvm::dyn_cast<llvm::LoadInst>(store->getValueOperand());loaded&&loaded->getType()->isStructTy()){
          const auto *allocation=llvm::dyn_cast<llvm::AllocaInst>(store->getPointerOperand());
          if(!freshCopy(*store))return 4;if(graph.repeating.count(blockId))repeatedCopy=store;
          Array sourceSlots;for(auto slot:roots(loaded->getPointerOperand()))sourceSlots.push_back(slot);if(sourceSlots.empty())return 4;
          aggregateCopies.push_back(Object{{"sourceSlot",root(loaded->getPointerOperand())},{"sourceSlots",std::move(sourceSlots)},{"targetSlot",root(allocation)},
            {"separateStorage",true},{"sourceBeforeFreshAllocation",true},{"repeating",graph.repeating.count(blockId)!=0},{"function",fn.getName().str()}});
        }
        if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(store->getPointerOperand())){
          Array indices;for(const auto &index:pointer->indices()){const auto *literal=llvm::dyn_cast<llvm::ConstantInt>(index);if(!literal)return 4;indices.push_back(int64_t(literal->getZExtValue()));}
          const auto *literal=llvm::dyn_cast<llvm::ConstantInt>(store->getValueOperand());
          fieldWrites.push_back(Object{{"indices",std::move(indices)},{"rootSlot",root(pointer)},{"function",fn.getName().str()},
            {"constantBits",literal?Json(std::to_string(literal->getZExtValue())):Json(nullptr)}});
        }
      }
      if(llvm::isa<llvm::CmpInst>(operation))++comparisons;
      if(const auto *comparison=llvm::dyn_cast<llvm::CmpInst>(&operation))fieldComparisons+=comparison->getPredicate()==llvm::CmpInst::ICMP_EQ||comparison->getPredicate()==llvm::CmpInst::FCMP_OEQ;
      if(const auto *call=llvm::dyn_cast<llvm::CallBase>(&operation)){
        if(call->isIndirectCall()){
          ++callbacks;if(call->arg_size()!=6)return 4;
          const auto *kind=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(1));
          const auto *index=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(2));
          const auto *start=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(3));
          const auto *end=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(4));
          const auto *interval=llvm::dyn_cast<llvm::ConstantInt>(call->getArgOperand(5));
          if(!kind||kind->getZExtValue()>4||!index||index->getZExtValue()>=items(field(*decoded,"functions")).size()||!start||!end||start->getZExtValue()>=end->getZExtValue()||!interval||!intervals.insert(interval->getZExtValue()).second)return 4;
          const auto &owner=source.functions[index->getZExtValue()];bool anchored=false;
          if(kind->getZExtValue()==0)anchored=start->getZExtValue()==owner.range.start&&end->getZExtValue()==owner.range.end;
          else{
            if(index->getZExtValue()!=currentFunction)return 4;
            if(kind->getZExtValue()==3&&start->getZExtValue()==owner.range.start&&end->getZExtValue()==owner.range.end)anchored=true;
            for(const auto &sourceBlock:owner.blocks)for(const auto &sourceOperation:sourceBlock.operations){
              const bool correctKind=kind->getZExtValue()==1?sourceOperation.name=="fuel":kind->getZExtValue()>=3?sourceOperation.name=="func.return":sourceOperation.name!="fuel";
              if(correctKind&&start->getZExtValue()==sourceOperation.range.start&&end->getZExtValue()==sourceOperation.range.end)anchored=true;
            }
          }if(!anchored)return 4;
          if(kind->getZExtValue()==1)fuelBlocks.insert(blockId);
          eventRows.push_back(Object{{"kind",int64_t(kind->getZExtValue())},{"function",int64_t(index->getZExtValue())},{"start",int64_t(start->getZExtValue())},{"end",int64_t(end->getZExtValue())},{"interval",int64_t(interval->getZExtValue())}});
        }else if(call->getCalledFunction()->getName().starts_with("llvm.experimental.stackmap"))++stackmaps;
        else if(call->getCalledFunction()->getName().starts_with("value_")){++calls;record["callee"]=call->getCalledFunction()->getName().str();}
        else return 4;
      }
      instructions.push_back(std::move(record));
    }
    if(!graph.acyclicWithout(fuelBlocks))return 4;
    for(size_t i=0;i<graph.blocks.size();++i){Array successors,dominators;for(auto to:graph.edges[i])successors.push_back(int64_t(to));for(auto from:graph.dominators[i])dominators.push_back(int64_t(from));
      blockRows.push_back(Object{{"id",int64_t(i)},{"successors",std::move(successors)},{"dominators",std::move(dominators)},{"fuel",fuelBlocks.count(i)!=0}});}
    bool rejectedHoist=false;if(repeatedCopy){
      auto *allocation=const_cast<llvm::AllocaInst *>(llvm::cast<llvm::AllocaInst>(repeatedCopy->getPointerOperand()));auto *next=allocation->getNextNode();
      allocation->moveBefore(const_cast<llvm::Instruction *>(fn.getEntryBlock().getTerminator())->getIterator());
      rejectedHoist=!llvm::verifyModule(*module,&llvm::errs())&&!freshCopy(*repeatedCopy);allocation->moveBefore(next->getIterator());if(!rejectedHoist)return 4;
    }
    controlFlows.push_back(Object{{"function",fn.getName().str()},{"sourceIndex",int64_t(currentFunction)},{"sourceName",source.functions[currentFunction].name},{"backedges",graph.backedges},
      {"everyCycleHasFuel",true},{"hoistedCopyNegativeRejected",rejectedHoist},{"blocks",std::move(blockRows)},{"instructions",std::move(instructions)}});
  }
  if(functions!=items(field(*decoded,"closure")).size()||stackmaps!=callbacks+functions||intervals.size()!=callbacks)return 4;
  llvm::outs()<<canonical(Object{{"passed",true},{"completeCoreRetained",true},{"mlirRoundTrip",true},{"functionId",argv[2]},{"functions",functions},
    {"callbacks",callbacks},{"stackmaps",stackmaps},{"fieldAddresses",geps},{"aggregateStores",copies},{"comparisons",comparisons},{"directCalls",calls},
    {"coreDigest",digest((*bytes)->getBuffer())},{"inputIdentity",field(*decoded,"inputIdentity")},{"hirDigest",field(*decoded,"hirDigest")},
    {"layouts",lowered.layouts},{"initializedFields",field(*decoded,"initializedFields")},{"events",std::move(eventRows)},
    {"copies",std::move(aggregateCopies)},{"fieldWrites",std::move(fieldWrites)},{"fieldReads",std::move(fieldReads)},
    {"nativeLayouts",std::move(nativeLayouts)},{"fieldComparisons",fieldComparisons},{"sourceFuelSites",sourceFuelSites},{"controlFlows",std::move(controlFlows)},
    {"storageLifetime",field(*decoded,"storageLifetime")},{"resourceProof",nullptr},{"executionAuthority",false},{"llvm",lowered.llvm},{"mlir",lowered.mlir}})<<'\n';return 0;
}
