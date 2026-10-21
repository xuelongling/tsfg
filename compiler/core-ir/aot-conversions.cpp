// SPDX-License-Identifier: MIT
#include "aot-conversions.h"
#include "dialect.h"
#include "llvm/ADT/SmallVector.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Intrinsics.h"
#include "llvm/IR/Module.h"

namespace {
using namespace llvm;
// Exact sign/magnitude * 2^power. Every shift is independently bounded, even
// on a select's unchosen side: malformed IEEE exponents cannot create poison.
class Conversion {
  Function &fn;
  IRBuilder<> b;
  IntegerType *i64, *i32, *i128;
  unsigned source, target;
  Value *negative, *magnitude, *power, *nonfinite, *nan;
  ConstantInt *c(uint64_t n) { return ConstantInt::get(i64, n); }
  ConstantInt *s(int32_t n) { return ConstantInt::getSigned(i32, n); }
  Value *bounded(Value *n, unsigned limit) {
    return b.CreateSelect(b.CreateICmpULT(n, s(limit)), n, s(limit));
  }
  Value *shift64(Value *n) { return b.CreateZExt(bounded(n, 63), i64); }
  void finish(Value *bits, Value *status) {
    auto *result = b.CreateInsertValue(PoisonValue::get(fn.getReturnType()), bits, 0);
    b.CreateRet(b.CreateInsertValue(result, status, 1));
  }
  void decode(Value *bits) {
    if (source >= 1 && source <= 11 && source != 2) {
      const unsigned width = tsfg::width(source);
      auto *narrow = b.CreateTruncOrBitCast(bits, IntegerType::get(fn.getContext(), width));
      auto *value = tsfg::signedInteger(source) ? b.CreateSExtOrBitCast(narrow, i64) : bits;
      negative = tsfg::signedInteger(source) ? b.CreateICmpSLT(value, c(0)) : b.getFalse();
      magnitude = b.CreateSelect(negative, b.CreateNeg(value), value);
      power = s(0); nonfinite = nan = b.getFalse();
      return;
    }
    const unsigned fraction = source == 12 ? 23 : 52, bias = source == 12 ? 127 : 1023;
    const uint64_t exponentMask = source == 12 ? 255 : 2047;
    auto *exponent = b.CreateAnd(b.CreateLShr(bits, fraction), c(exponentMask));
    auto *significand = b.CreateAnd(bits, c((UINT64_C(1) << fraction) - 1));
    auto *subnormal = b.CreateICmpEQ(exponent, c(0));
    negative = b.CreateICmpNE(b.CreateAnd(bits, c(UINT64_C(1) << (source == 12 ? 31 : 63))), c(0));
    magnitude = b.CreateSelect(subnormal, significand, b.CreateOr(significand, c(UINT64_C(1) << fraction)));
    power = b.CreateSub(b.CreateTrunc(b.CreateSelect(subnormal, c(1), exponent), i32), s(bias + fraction));
    nonfinite = b.CreateICmpEQ(exponent, c(exponentMask));
    nan = b.CreateAnd(nonfinite, b.CreateICmpNE(significand, c(0)));
  }
  // Rounded binary quotient, ties to even, directly at destination precision.
  Value *rounded(Value *value, Value *shift) {
    auto *left = b.CreateShl(value, shift64(b.CreateNeg(shift)));
    auto *right = b.CreateLShr(value, shift64(shift));
    right = b.CreateSelect(b.CreateICmpUGE(shift, s(64)), c(0), right);
    auto *mask = b.CreateSub(b.CreateShl(c(1), shift64(shift)), c(1));
    auto *remainder = b.CreateSelect(b.CreateICmpEQ(shift, s(64)), value, b.CreateAnd(value, mask));
    auto *halfway = b.CreateShl(c(1), shift64(b.CreateSub(shift, s(1))));
    auto *up = b.CreateOr(b.CreateICmpUGT(remainder, halfway),
      b.CreateAnd(b.CreateICmpEQ(remainder, halfway), b.CreateICmpNE(b.CreateAnd(right, c(1)), c(0))));
    auto *rounded = b.CreateAdd(right, b.CreateZExt(up, i64));
    rounded = b.CreateSelect(b.CreateICmpSGT(shift, s(64)), c(0), rounded);
    return b.CreateSelect(b.CreateICmpSLE(shift, s(0)), left, rounded);
  }
  void toFloat() {
    const unsigned fraction = target == 12 ? 23 : 52, bias = target == 12 ? 127 : 1023;
    const uint64_t infinity = target == 12 ? UINT64_C(0x7f800000) : UINT64_C(0x7ff0000000000000);
    auto *sign = b.CreateSelect(negative, c(UINT64_C(1) << (target == 12 ? 31 : 63)), c(0));
    auto *ctlz = Intrinsic::getOrInsertDeclaration(fn.getParent(), Intrinsic::ctlz, {i64});
    auto *top = b.CreateSub(s(63), b.CreateTrunc(b.CreateCall(ctlz, {magnitude, b.getFalse()}), i32));
    auto *exponent = b.CreateAdd(top, power);
    auto *significand = rounded(magnitude, b.CreateSub(top, s(fraction)));
    auto *carry = b.CreateICmpEQ(significand, c(UINT64_C(1) << (fraction + 1)));
    significand = b.CreateSelect(carry, b.CreateLShr(significand, 1), significand);
    auto *adjusted = b.CreateAdd(exponent, b.CreateZExt(carry, i32));
    auto *normal = b.CreateOr(b.CreateShl(b.CreateZExt(b.CreateAdd(adjusted, s(bias)), i64), fraction),
        b.CreateAnd(significand, c((UINT64_C(1) << fraction) - 1)));
    auto *subnormal = rounded(magnitude, b.CreateSub(s(1 - int(bias) - int(fraction)), power));
    auto *bits = b.CreateOr(sign, b.CreateSelect(b.CreateICmpSLT(exponent, s(1 - int(bias))), subnormal, normal));
    auto *zero = b.CreateICmpEQ(magnitude, c(0));
    bits = b.CreateSelect(zero, sign, bits);
    auto *special = b.CreateSelect(nan, c(target == 12 ? UINT64_C(0x7fc00000) : UINT64_C(0x7ff8000000000000)), b.CreateOr(sign, c(infinity)));
    bits = b.CreateSelect(nonfinite, special, bits);
    auto *overflow = b.CreateAnd(b.CreateNot(b.CreateOr(zero, nonfinite)), b.CreateICmpSGT(adjusted, s(bias)));
    finish(bits, b.CreateSelect(overflow, s(2), s(0)));
  }
  void toInteger() {
    auto *wide = b.CreateZExt(magnitude, i128);
    auto *left = b.CreateShl(wide, b.CreateZExt(bounded(power, 127), i128));
    auto *right = b.CreateLShr(wide, b.CreateZExt(bounded(b.CreateNeg(power), 127), i128));
    auto *truncated = b.CreateSelect(b.CreateICmpSGE(power, s(0)), left, right);
    auto *ctlz = Intrinsic::getOrInsertDeclaration(fn.getParent(), Intrinsic::ctlz, {i64});
    auto *top = b.CreateSub(s(63), b.CreateTrunc(b.CreateCall(ctlz, {magnitude, b.getFalse()}), i32));
    auto *huge = b.CreateAnd(b.CreateICmpNE(magnitude, c(0)), b.CreateICmpSGT(b.CreateAdd(top, power), s(64)));
    const unsigned width = tsfg::width(target);
    Value *range;
    if (tsfg::signedInteger(target)) {
      auto *limit = ConstantInt::get(i128, APInt::getOneBitSet(128, width - 1));
      auto *maximum = b.CreateSub(limit, b.CreateZExt(b.CreateNot(negative), i128));
      range = b.CreateICmpUGT(truncated, maximum);
    } else {
      auto *limit = ConstantInt::get(i128, APInt::getOneBitSet(128, width));
      range = b.CreateOr(b.CreateICmpUGE(truncated, limit), b.CreateAnd(negative, b.CreateICmpNE(truncated, ConstantInt::get(i128, 0))));
    }
    range = b.CreateOr(range, huge);
    auto *low = b.CreateTrunc(truncated, i64);
    auto *bits = b.CreateSelect(negative, b.CreateNeg(low), low);
    if (width < 64) bits = b.CreateAnd(bits, c((UINT64_C(1) << width) - 1));
    finish(bits, b.CreateSelect(nonfinite, s(1), b.CreateSelect(range, s(2), s(0))));
  }
public:
  Conversion(Function &function, unsigned from, unsigned to)
    : fn(function), b(BasicBlock::Create(fn.getContext(), "entry", &fn)),
      i64(b.getInt64Ty()), i32(b.getInt32Ty()), i128(b.getInt128Ty()), source(from), target(to) {}
  void emit(unsigned mode) {
    auto *bits = fn.getArg(0);
    if (mode == 42) { finish(bits, s(0)); return; }
    if (mode == 41) {
      auto *narrow = b.CreateTruncOrBitCast(bits, IntegerType::get(fn.getContext(), tsfg::width(source)));
      auto *extended = tsfg::signedInteger(source) ? b.CreateSExtOrBitCast(narrow, i64) : bits;
      if (tsfg::width(target) < 64) extended = b.CreateAnd(extended, c((UINT64_C(1) << tsfg::width(target)) - 1));
      finish(extended, s(0)); return;
    }
    decode(bits);
    if (tsfg::floating(target)) toFloat(); else toInteger();
  }
};
}
void tsfg::materializeNativeConversions(llvm::Module &module) {
  llvm::SmallVector<llvm::Function *> functions;
  for (auto &fn : module) if (fn.isDeclaration() && fn.getName().starts_with("tsfg_aot_convert_")) functions.push_back(&fn);
  for (auto *fn : functions) {
    auto name = fn->getName().drop_front(17);
    const auto first = name.split('_'), second = first.second.split('_');
    unsigned mode, source, target;
    if (first.first.getAsInteger(10, mode) || second.first.getAsInteger(10, source) || second.second.getAsInteger(10, target)) llvm_unreachable("verified conversion helper name");
    fn->setLinkage(llvm::GlobalValue::InternalLinkage);
    Conversion(*fn, source, target).emit(mode);
  }
}
