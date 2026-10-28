// SPDX-License-Identifier: MIT
#include "system-query.h"
#include "common-program-header.h"
#include "mlir/Conversion/ArithToLLVM/ArithToLLVM.h"
#include "mlir/Conversion/ControlFlowToLLVM/ControlFlowToLLVM.h"
#include "mlir/Conversion/FuncToLLVM/ConvertFuncToLLVMPass.h"
#include "mlir/Conversion/MemRefToLLVM/MemRefToLLVM.h"
#include "mlir/Conversion/ReconcileUnrealizedCasts/ReconcileUnrealizedCasts.h"
#include "mlir/Conversion/SCFToControlFlow/SCFToControlFlow.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/Builders.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "mlir/Pass/Pass.h"
#include "mlir/Pass/PassManager.h"
#include "mlir/Target/LLVMIR/Dialect/Builtin/BuiltinToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Dialect/LLVMIR/LLVMToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Export.h"
#include "llvm/AsmParser/Parser.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Metadata.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Verifier.h"
#include "llvm/Support/SourceMgr.h"
#include "llvm/Support/raw_ostream.h"

namespace tsfg::systemQuery {
namespace {
constexpr size_t byteLimit=8388608;
constexpr llvm::StringLiteral moduleName="tsfg.query.cpu";
constexpr llvm::StringLiteral proofName="tsfg.query.cpu";
std::string printed(mlir::ModuleOp module){std::string text;llvm::raw_string_ostream out(text);module->print(out,mlir::OpPrintingFlags().printGenericOpForm());out<<'\n';return text;}
std::string printed(const llvm::Module &module){std::string text;llvm::raw_string_ostream out(text);module.print(out,nullptr);return text;}

// Input has already passed the one owning complete batch verifier. These are
// official generic conversions; no TargetMachine, backend or executor is used.
mlir::LogicalResult convertBatch(mlir::ModuleOp module){
  const auto source=printed(module);
  module.walk([](mlir::Operation *op){
    llvm::SmallVector<mlir::StringAttr> remove;
    for(const auto &attr:op->getAttrs()){
      const auto name=attr.getName().strref();
      if(name.starts_with("tsfg")||name.starts_with("operator_")||name.starts_with("callee_"))remove.push_back(attr.getName());
    }
    for(auto name:remove)op->removeAttr(name);
  });
  auto *context=module.getContext();mlir::OpBuilder b(context);
  module->setAttr("llvm.data_layout",b.getStringAttr(commonProgram::coreHeader::layout));
  module->setAttr("llvm.target_triple",b.getStringAttr(commonProgram::coreHeader::triple));
  mlir::PassManager manager(context);manager.enableVerifier(true);
  manager.addPass(mlir::createSCFToControlFlowPass());
  manager.addPass(mlir::createArithToLLVMConversionPass());
  manager.addPass(mlir::createFinalizeMemRefToLLVMConversionPass());
  manager.addPass(mlir::createConvertFuncToLLVMPass());
  manager.addPass(mlir::createConvertControlFlowToLLVMPass());
  manager.addPass(mlir::createReconcileUnrealizedCastsPass());
  if(mlir::failed(manager.run(module)))return module.emitError("[core-ir-query-llvm] official generic conversion failed");
  bool selected=true;module.walk([&](mlir::Operation *op){if(op!=module.getOperation()&&op->getName().getDialectNamespace()!="llvm")selected=false;});
  if(!selected)return module.emitError("[core-ir-query-llvm] unconverted operation remains");
  module->setAttr("tsfg.cpu_llvm_version",b.getI32IntegerAttr(1));
  module->setAttr("tsfg.cpu_llvm_source",b.getStringAttr(source));
  if(mlir::failed(mlir::verify(module))||printed(module).size()>byteLimit)return module.emitError("[core-ir-query-llvm] LLVM dialect verification or text budget failed");
  return mlir::success();
}

// Caller supplies the checked LLVM dialect. The copied module sheds only the
// proof envelope before official export; the exact batch remains named LLVM
// metadata and is rechecked by the independent cold consumer below.
std::unique_ptr<llvm::Module> exported(mlir::ModuleOp module,llvm::LLVMContext &context){
  const auto source=module->getAttrOfType<mlir::StringAttr>("tsfg.cpu_llvm_source").getValue();
  mlir::OwningOpRef<mlir::ModuleOp> copy=llvm::cast<mlir::ModuleOp>(module->clone());
  (*copy)->removeAttr("tsfg.cpu_llvm_source");(*copy)->removeAttr("tsfg.cpu_llvm_version");
  auto result=mlir::translateModuleToLLVMIR(*copy,context,moduleName);
  if(!result)return nullptr;
  result->setModuleIdentifier(moduleName);result->setSourceFileName(moduleName);
  auto *row=llvm::MDNode::get(context,{llvm::MDString::get(context,"1"),llvm::MDString::get(context,source)});
  result->getOrInsertNamedMetadata(proofName)->addOperand(row);
  if(llvm::verifyModule(*result,&llvm::errs())||printed(*result).size()>byteLimit)return nullptr;
  return result;
}
}

void registerCpuLLVMDialects(mlir::DialectRegistry &registry){registry.insert<mlir::LLVM::LLVMDialect>();mlir::registerBuiltinDialectTranslation(registry);mlir::registerLLVMDialectTranslation(registry);}
bool isCpuLLVM(mlir::ModuleOp module){return module->hasAttr("tsfg.cpu_llvm_version");}
mlir::LogicalResult lowerCpuLLVM(mlir::ModuleOp module){
  if(isCpuBatch(module)){if(mlir::failed(verifyCpuBatch(module)))return mlir::failure();}
  else if(mlir::failed(lowerCpuBatch(module)))return mlir::failure();
  return convertBatch(module);
}
mlir::LogicalResult verifyCpuLLVM(mlir::ModuleOp module,commonProgram::Json *effects){
  const auto version=module->getAttrOfType<mlir::IntegerAttr>("tsfg.cpu_llvm_version");
  const auto source=module->getAttrOfType<mlir::StringAttr>("tsfg.cpu_llvm_source");
  if(!version||!version.getType().isSignlessInteger(32)||version.getInt()!=1||!source||source.getValue().empty()||source.getValue().size()>byteLimit)return module.emitError("[core-ir-query-llvm] owned version/batch snapshot required");
  auto expected=mlir::parseSourceString<mlir::ModuleOp>(source.getValue(),module.getContext());
  if(!expected||mlir::failed(verifyCpuBatch(*expected,effects))||mlir::failed(convertBatch(*expected)))return mlir::failure();
  if(mlir::failed(mlir::verify(module))||printed(module)!=printed(*expected))return module.emitError("[core-ir-query-llvm] LLVM dialect differs from independently checked batch conversion");
  return mlir::success();
}
int printCpuLLVMIR(mlir::ModuleOp checked){
  llvm::LLVMContext context;auto module=exported(checked,context);
  if(!module){llvm::errs()<<"[core-ir-query-llvm] official LLVM IR export/verification failed\n";return 3;}
  llvm::outs()<<printed(*module);return 0;
}
int canonicalizeCpuLLVMIR(llvm::StringRef input,mlir::MLIRContext &context){
  if(input.empty()||input.size()>byteLimit){llvm::errs()<<"[core-ir-query-llvm] LLVM IR input budget differs\n";return 3;}
  llvm::LLVMContext actualContext;llvm::SMDiagnostic diagnostic;auto actual=llvm::parseAssemblyString(input,diagnostic,actualContext);
  if(!actual){diagnostic.print("core-ir-query-llvm",llvm::errs());return 3;}
  const auto reject=[](){llvm::errs()<<"[core-ir-query-llvm] owned LLVM IR proof or exact Source conversion differs\n";return 3;};
  if(llvm::verifyModule(*actual,&llvm::errs()))return reject();
  const auto *proof=actual->getNamedMetadata(proofName);
  if(!proof||proof->getNumOperands()!=1)return reject();const auto *row=proof->getOperand(0);
  if(row->getNumOperands()!=2)return reject();const auto *version=llvm::dyn_cast_if_present<llvm::MDString>(row->getOperand(0).get()),*source=llvm::dyn_cast_if_present<llvm::MDString>(row->getOperand(1).get());
  if(!version||version->getString()!="1"||!source||source->getString().empty()||source->getString().size()>byteLimit)return reject();
  auto batch=mlir::parseSourceString<mlir::ModuleOp>(source->getString(),&context);
  if(!batch||mlir::failed(verifyCpuBatch(*batch))||mlir::failed(convertBatch(*batch)))return reject();
  llvm::LLVMContext expectedContext;auto expected=exported(*batch,expectedContext);if(!expected)return reject();
  // ModuleID is a parser buffer label/comment, unlike source_filename and the
  // target/layout/proof/instructions, which remain part of the exact binding.
  actual->setModuleIdentifier(moduleName);
  const auto canonical=printed(*actual);if(canonical!=printed(*expected))return reject();
  llvm::outs()<<canonical;return 0;
}
} // namespace tsfg::systemQuery
