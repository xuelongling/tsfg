// SPDX-License-Identifier: MIT
#include "aot.h"
#include "aot-module.h"
#include "aot-lowering.h"
#include "aot-float.h"
#include "aot-conversions.h"
#include "mlir/Conversion/ArithToLLVM/ArithToLLVM.h"
#include "mlir/Conversion/ControlFlowToLLVM/ControlFlowToLLVM.h"
#include "mlir/Conversion/FuncToLLVM/ConvertFuncToLLVM.h"
#include "mlir/Conversion/LLVMCommon/ConversionTarget.h"
#include "mlir/Conversion/LLVMCommon/TypeConverter.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/Verifier.h"
#include "mlir/Parser/Parser.h"
#include "mlir/Target/LLVMIR/Dialect/Builtin/BuiltinToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Dialect/LLVMIR/LLVMToLLVMIRTranslation.h"
#include "mlir/Target/LLVMIR/Export.h"
#include "llvm/TargetParser/Triple.h"
#include "llvm/IR/LLVMContext.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Verifier.h"
#include "llvm/IR/LegacyPassManager.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Target/TargetMachine.h"
#include <string>

mlir::LogicalResult tsfg::emitNativeLLVM(mlir::ModuleOp verifiedCore,
                                        llvm::raw_ostream &output, NativeOutput kind) {
  std::string text;
  const bool program = kind == NativeOutput::ProgramLLVM || kind == NativeOutput::ProgramObject;
  if (mlir::failed(lowerNativeCore(verifiedCore, text, program))) {
    llvm::errs() << "[r07-native-capability] AOT requires complete scalar Core with at most 512 functions\n";
    return mlir::failure();
  }
  mlir::DialectRegistry registry;
  registry.insert<mlir::arith::ArithDialect, mlir::cf::ControlFlowDialect,
                  mlir::func::FuncDialect, mlir::LLVM::LLVMDialect>();
  mlir::registerLLVMDialectTranslation(registry);
  mlir::registerBuiltinDialectTranslation(registry);
  mlir::MLIRContext context(registry);
  context.disableMultithreading();
  auto lowered = mlir::parseSourceString<mlir::ModuleOp>(text, &context);
  if (!lowered || mlir::failed(mlir::verify(*lowered))) return mlir::failure();
  mlir::LLVMTypeConverter converter(&context);
  mlir::RewritePatternSet patterns(&context);
  mlir::arith::populateArithToLLVMConversionPatterns(converter, patterns);
  mlir::cf::populateControlFlowToLLVMConversionPatterns(converter, patterns);
  mlir::populateFuncToLLVMConversionPatterns(converter, patterns);
  mlir::LLVMConversionTarget target(context);
  target.addLegalOp<mlir::ModuleOp>();
  if (mlir::failed(mlir::applyFullConversion(*lowered, target, std::move(patterns))) ||
      mlir::failed(mlir::verify(*lowered))) return mlir::failure();
  llvm::LLVMContext llvmContext;
  auto native = mlir::translateModuleToLLVMIR(*lowered, llvmContext, "tsfg-native");
  if (!native) return mlir::failure();
  materializeNativeConversions(*native);
  materializeNativeFloating(*native);
  if(!materializeNativeModule(*native,verifiedCore,program)) {
    llvm::errs()<<"[core-ir-module-aot] instance materialization failed\n";return mlir::failure();
  }
  const llvm::Triple triple(verifiedCore->getAttrOfType<mlir::StringAttr>("tsfg_core.triple").getValue());
  native->setTargetTriple(triple);
  LLVMInitializeX86TargetInfo(); LLVMInitializeX86Target();
  LLVMInitializeX86TargetMC(); LLVMInitializeX86AsmPrinter();
  LLVMInitializeX86AsmParser();
  std::string error;
  const auto *machineTarget = llvm::TargetRegistry::lookupTarget(triple, error);
  if (!machineTarget) { llvm::errs() << "[r07-native-target] " << error << '\n'; return mlir::failure(); }
  llvm::TargetOptions options;
  std::unique_ptr<llvm::TargetMachine> machine(machineTarget->createTargetMachine(
      triple, "x86-64-v2", "-avx,-avx2,-avx512f", options, llvm::Reloc::PIC_,
      llvm::CodeModel::Small, llvm::CodeGenOptLevel::None));
  if (!machine) return mlir::failure();
  const auto layout = machine->createDataLayout();
  if (layout.getStringRepresentation() != verifiedCore->getAttrOfType<mlir::StringAttr>("tsfg_core.data_layout").getValue()) {
    llvm::errs() << "[r07-native-layout] actual LLVM target layout differs from verified Core\n";
    return mlir::failure();
  }
  native->setDataLayout(layout);
  if (!verifyProgramMetadataLayout(*native)) {
    llvm::errs() << "[r07-native-program-layout] compiled table differs from C target layout\n";
    return mlir::failure();
  }
  auto *i32 = llvm::Type::getInt32Ty(llvmContext), *i8 = llvm::Type::getInt8Ty(llvmContext);
  auto *slot = llvm::StructType::get(llvmContext, {i32, i8, llvm::ArrayType::get(i8, 3)});
  const auto *slotLayout = layout.getStructLayout(slot);
  auto *words = llvm::StructType::get(llvmContext, {i32, i32});
  const auto *wordLayout = layout.getStructLayout(words);
  if (layout.getTypeAllocSize(slot).getFixedValue() != 8 || layout.getABITypeAlign(slot).value() != 4 ||
      slotLayout->getElementOffset(0) != 0 || slotLayout->getElementOffset(1) != 4 || slotLayout->getElementOffset(2) != 5 ||
      layout.getTypeAllocSize(words).getFixedValue() != 8 || layout.getABITypeAlign(words).value() != 4 ||
      wordLayout->getElementOffset(0) != 0 || wordLayout->getElementOffset(1) != 4 || !layout.isLittleEndian() ||
      layout.getPointerSize() != 8 || layout.getPointerABIAlignment(0).value() != 8) {
    llvm::errs() << "[r07-native-abi] actual target ScalarSlot/pointer layout differs from the fixed scalar slot layout\n";
    return mlir::failure();
  }
  new llvm::GlobalVariable(*native, i32, true, llvm::GlobalValue::ExternalLinkage,
      llvm::ConstantInt::get(i32, program || verifiedCore->hasAttr("tsfg_core.sources")?4:NativeABIVersion), "tsfg_native_abi_version");
  if (llvm::verifyModule(*native, &llvm::errs())) return mlir::failure();
  if (kind == NativeOutput::LLVM || kind == NativeOutput::ProgramLLVM) native->print(output, nullptr);
  else {
    llvm::SmallVector<char, 0> bytes;
    llvm::raw_svector_ostream objectStream(bytes);
    llvm::legacy::PassManager passes;
    if (machine->addPassesToEmitFile(passes, objectStream, nullptr,
                                    llvm::CodeGenFileType::ObjectFile)) return mlir::failure();
    passes.run(*native);
    output.write(bytes.data(), bytes.size());
  }
  return mlir::success();
}
