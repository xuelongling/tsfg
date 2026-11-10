// SPDX-License-Identifier: MIT
// Compiler-data driver: reads the complete genuine Core and verifies LLVM IR.
// It never calls generated functions, a backend, TargetMachine or a Runtime.
#include "common-program-value-lowering.h"
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
#include <functional>

int main(int argc,char **argv){
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
  Array aggregateCopies,fieldWrites,fieldReads,eventRows,nativeLayouts;unsigned fieldComparisons=0;
  std::set<uint64_t> intervals;
  for(const auto &fn:*module){
    if(fn.isDeclaration()){
      if(!fn.getName().starts_with("llvm.experimental.stackmap"))return 4;continue;
    }++functions;
    if(!functionIndices.count(fn.getName().str())||fn.arg_size()<2)return 4;
    const auto currentFunction=functionIndices.at(fn.getName().str());
    for(const auto &argument:fn.args())if(const auto *structure=llvm::dyn_cast<llvm::StructType>(argument.getType())){
      const auto *layout=module->getDataLayout().getStructLayout(const_cast<llvm::StructType *>(structure));Array offsets;
      for(size_t i=0;i<structure->getNumElements();++i)offsets.push_back(int64_t(layout->getElementOffset(i)));
      nativeLayouts.push_back(Object{{"function",fn.getName().str()},{"argument",argument.getArgNo()},{"byteSize",int64_t(layout->getSizeInBytes())},
        {"alignment",int64_t(layout->getAlignment().value())},{"offsets",std::move(offsets)}});
    }
    std::map<const llvm::Value *,int64_t> slots;
    for(const auto &block:fn)for(const auto &operation:block)if(llvm::isa<llvm::AllocaInst>(operation))slots.emplace(&operation,slots.size());
    std::set<const llvm::Value *> visiting;
    std::function<int64_t(const llvm::Value *)> root=[&](const llvm::Value *value)->int64_t{
      if(slots.count(value))return slots.at(value);if(!visiting.insert(value).second)return -1;int64_t found=-1;
      if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(value))found=root(pointer->getPointerOperand());
      if(const auto *load=llvm::dyn_cast<llvm::LoadInst>(value);load&&load->getType()->isPointerTy()){
        for(const auto *user:load->getPointerOperand()->users())if(const auto *store=llvm::dyn_cast<llvm::StoreInst>(user);store&&store->getPointerOperand()==load->getPointerOperand()){
          const auto next=root(store->getValueOperand());if(found>=0&&found!=next){found=-1;break;}found=next;
        }
      }visiting.erase(value);return found;
    };
    for(const auto &block:fn)for(const auto &operation:block){
      for(const auto &operand:operation.operands())if(llvm::isa<llvm::UndefValue,llvm::PoisonValue>(operand))return 4;
      if(llvm::isa<llvm::GetElementPtrInst>(operation))++geps;
      if(const auto *load=llvm::dyn_cast<llvm::LoadInst>(&operation))if(const auto *pointer=llvm::dyn_cast<llvm::GetElementPtrInst>(load->getPointerOperand())){
        Array indices;for(const auto &index:pointer->indices()){const auto *literal=llvm::dyn_cast<llvm::ConstantInt>(index);if(!literal)return 4;indices.push_back(int64_t(literal->getZExtValue()));}
        fieldReads.push_back(Object{{"indices",std::move(indices)},{"rootSlot",root(pointer)},{"function",fn.getName().str()}});
      }
      if(const auto *store=llvm::dyn_cast<llvm::StoreInst>(&operation)){
        copies+=store->getValueOperand()->getType()->isStructTy();
        if(const auto *loaded=llvm::dyn_cast<llvm::LoadInst>(store->getValueOperand());loaded&&loaded->getType()->isStructTy()){
          const auto source=root(loaded->getPointerOperand()),target=root(store->getPointerOperand());
          if(!llvm::isa<llvm::AllocaInst>(store->getPointerOperand())||source<0||target<0||source==target)return 4;
          aggregateCopies.push_back(Object{{"sourceSlot",source},{"targetSlot",target},{"separateStorage",true},{"function",fn.getName().str()}});
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
          eventRows.push_back(Object{{"kind",int64_t(kind->getZExtValue())},{"function",int64_t(index->getZExtValue())},{"start",int64_t(start->getZExtValue())},{"end",int64_t(end->getZExtValue())},{"interval",int64_t(interval->getZExtValue())}});
        }else if(call->getCalledFunction()->getName().starts_with("llvm.experimental.stackmap"))++stackmaps;
        else if(call->getCalledFunction()->getName().starts_with("value_"))++calls;
        else return 4;
      }
    }
  }
  if(functions!=items(field(*decoded,"closure")).size()||stackmaps!=callbacks+functions||intervals.size()!=callbacks)return 4;
  llvm::outs()<<canonical(Object{{"passed",true},{"completeCoreRetained",true},{"mlirRoundTrip",true},{"functionId",argv[2]},{"functions",functions},
    {"callbacks",callbacks},{"stackmaps",stackmaps},{"fieldAddresses",geps},{"aggregateStores",copies},{"comparisons",comparisons},{"directCalls",calls},
    {"coreDigest",digest((*bytes)->getBuffer())},{"inputIdentity",field(*decoded,"inputIdentity")},{"hirDigest",field(*decoded,"hirDigest")},
    {"layouts",lowered.layouts},{"initializedFields",field(*decoded,"initializedFields")},{"events",std::move(eventRows)},
    {"copies",std::move(aggregateCopies)},{"fieldWrites",std::move(fieldWrites)},{"fieldReads",std::move(fieldReads)},
    {"nativeLayouts",std::move(nativeLayouts)},{"fieldComparisons",fieldComparisons},{"executionAuthority",false},{"llvm",lowered.llvm},{"mlir",lowered.mlir}})<<'\n';return 0;
}
