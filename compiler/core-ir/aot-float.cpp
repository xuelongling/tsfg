// SPDX-License-Identifier: MIT
#include "aot-float.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Module.h"
#include "llvm/IR/Intrinsics.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/ADT/StringSwitch.h"
#include <string>

namespace {
using namespace llvm;
void arithmetic(Function &fn, StringRef name) {
  auto &context = fn.getContext();
  auto *format = fn.getArg(0)->getType();
  const bool single = format->isFloatTy();
  auto *integer = IntegerType::get(context, single ? 32 : 64);
  const uint64_t sign = single ? UINT64_C(0x80000000) : UINT64_C(0x8000000000000000);
  const uint64_t infinity = single ? UINT64_C(0x7f800000) : UINT64_C(0x7ff0000000000000);
  const uint64_t canonical = single ? UINT64_C(0x7fc00000) : UINT64_C(0x7ff8000000000000);
  IRBuilder<> builder(BasicBlock::Create(context, "entry", &fn));
  auto bits = [&](Value *value) { return builder.CreateBitCast(value, integer); };
  auto nan = [&](Value *value) {
    return builder.CreateICmpUGT(builder.CreateAnd(bits(value), ~sign), ConstantInt::get(integer, infinity));
  };
  auto *left = fn.getArg(0);
  Value *value;
  if (name == "neg" || name == "pos") {
    value = name == "neg" ? builder.CreateBitCast(builder.CreateXor(bits(left), sign), format) : left;
    value = builder.CreateSelect(nan(left), ConstantExpr::getBitCast(ConstantInt::get(integer, canonical), format), value);
  } else {
    auto *right = fn.getArg(1);
    if (fn.getReturnType()->isIntegerTy(1)) {
      CmpInst::Predicate predicate = StringSwitch<CmpInst::Predicate>(name)
          .Case("eq", CmpInst::FCMP_OEQ).Case("ne", CmpInst::FCMP_UNE)
          .Case("lt", CmpInst::FCMP_OLT).Case("le", CmpInst::FCMP_OLE)
          .Case("gt", CmpInst::FCMP_OGT).Case("ge", CmpInst::FCMP_OGE)
          .Default(CmpInst::BAD_FCMP_PREDICATE);
      value = builder.CreateConstrainedFPCmp(Intrinsic::experimental_constrained_fcmp,
          predicate, left, right, "", fp::ebIgnore);
    } else {
      const auto id = StringSwitch<Intrinsic::ID>(name)
          .Case("add", Intrinsic::experimental_constrained_fadd)
          .Case("sub", Intrinsic::experimental_constrained_fsub)
          .Case("mul", Intrinsic::experimental_constrained_fmul)
          .Case("div", Intrinsic::experimental_constrained_fdiv).Default(Intrinsic::not_intrinsic);
      value = builder.CreateConstrainedFPBinOp(id, left, right, {}, "", nullptr,
          RoundingMode::NearestTiesToEven, fp::ebIgnore);
      value = builder.CreateSelect(nan(value), ConstantExpr::getBitCast(ConstantInt::get(integer, canonical), format), value);
    }
  }
  builder.CreateRet(value);
}
}

void tsfg::materializeNativeFloating(llvm::Module &module) {
  llvm::SmallVector<llvm::Function *> functions;
  for (auto &fn : module) if (fn.isDeclaration() && fn.getName().starts_with("tsfg_aot_f")) functions.push_back(&fn);
  bool hasFloating = !functions.empty();
  for (auto &fn : module) {
    hasFloating |= fn.getReturnType()->isFloatingPointTy();
    for (auto &argument : fn.args()) hasFloating |= argument.getType()->isFloatingPointTy();
  }
  if (!hasFloating) return;
  // X86AsmPrinter emits this MSVC marker whenever float values are present.
  // Resolve it locally rather than importing libcmt's process initialization
  // and printf/scanf support. COMDAT permits multiple native objects to link.
  auto *marker = new llvm::GlobalVariable(module, llvm::Type::getInt32Ty(module.getContext()), true,
      llvm::GlobalValue::LinkOnceODRLinkage, llvm::ConstantInt::get(llvm::Type::getInt32Ty(module.getContext()), 0), "_fltused");
  marker->setComdat(module.getOrInsertComdat("_fltused"));
  for (auto *fn : functions) {
    auto name = fn->getName().drop_front(std::string("tsfg_aot_f32_").size());
    fn->setLinkage(llvm::GlobalValue::InternalLinkage);
    fn->addFnAttr(llvm::Attribute::StrictFP);
    fn->addFnAttr("denormal-fp-math", "ieee,ieee");
    fn->addFnAttr("denormal-fp-math-f32", "ieee,ieee");
    if (name == "rem") materializeNativeRemainder(*fn);
    else arithmetic(*fn, name);
  }
  establishNativeFloatingEnvironment(module);
}
