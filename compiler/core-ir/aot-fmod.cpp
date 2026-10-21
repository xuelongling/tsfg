// SPDX-License-Identifier: MIT
#include "aot-float.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Module.h"

// Exact binary remainder, using the existing scalar semantics. All intermediate
// significands fit in53+1 bits; exponent differences are bounded by2097. This
// avoids both an overflowing floating quotient and an undeclared fmod import.
void tsfg::materializeNativeRemainder(llvm::Function &fn) {
  using namespace llvm;
  auto &context = fn.getContext();
  IRBuilder<> b(context);
  auto *format = fn.getReturnType();
  const bool single = format->isFloatTy();
  const unsigned fraction = single ? 23 : 52;
  const uint64_t signMask = single ? UINT64_C(0x80000000) : UINT64_C(0x8000000000000000);
  const uint64_t infinity = single ? UINT64_C(0x7f800000) : UINT64_C(0x7ff0000000000000);
  const uint64_t canonical = single ? UINT64_C(0x7fc00000) : UINT64_C(0x7ff8000000000000);
  const uint64_t implicit = UINT64_C(1) << fraction;
  auto *rawType = b.getIntNTy(single ? 32 : 64);
  auto block = [&](const char *name) { return BasicBlock::Create(context, name, &fn); };
  auto *entry = block("entry"), *invalid = block("invalid"), *classify = block("classify"),
       *unchanged = block("unchanged"), *equal = block("equal"), *zero = block("zero"),
       *setup = block("setup"), *normalizeX = block("normalize_x"), *shiftX = block("shift_x"),
       *normalizeY = block("normalize_y"), *shiftY = block("shift_y"), *divide = block("divide"),
       *subtract = block("subtract"), *advance = block("advance"), *finish = block("finish"),
       *normalizeResult = block("normalize_result"), *shiftResult = block("shift_result"),
       *encode = block("encode"), *normal = block("normal"), *subnormal = block("subnormal");
  b.SetInsertPoint(entry);
  auto bits = [&](Value *v) { return b.CreateZExtOrTrunc(b.CreateBitCast(v, rawType), b.getInt64Ty()); };
  auto *left = bits(fn.getArg(0)), *right = bits(fn.getArg(1));
  auto *sign = b.CreateAnd(left, signMask), *a = b.CreateAnd(left, ~signMask), *d = b.CreateAnd(right, ~signMask);
  auto *xSlot = b.CreateAlloca(b.getInt64Ty()), *ySlot = b.CreateAlloca(b.getInt64Ty());
  auto *exSlot = b.CreateAlloca(b.getInt32Ty()), *eySlot = b.CreateAlloca(b.getInt32Ty());
  auto loadX = [&]() { return b.CreateLoad(b.getInt64Ty(), xSlot); };
  auto loadY = [&]() { return b.CreateLoad(b.getInt64Ty(), ySlot); };
  auto loadEx = [&]() { return b.CreateLoad(b.getInt32Ty(), exSlot); };
  auto loadEy = [&]() { return b.CreateLoad(b.getInt32Ty(), eySlot); };
  auto result = [&](Value *raw) {
    b.CreateRet(b.CreateBitCast(b.CreateTruncOrBitCast(raw, rawType), format));
  };
  auto *bad = b.CreateOr(b.CreateICmpUGE(a, b.getInt64(infinity)), b.CreateICmpUGT(d, b.getInt64(infinity)));
  b.CreateCondBr(b.CreateOr(bad, b.CreateICmpEQ(d, b.getInt64(0))), invalid, classify);
  b.SetInsertPoint(invalid); result(b.getInt64(canonical));
  b.SetInsertPoint(classify); b.CreateCondBr(b.CreateICmpULT(a, d), unchanged, equal);
  b.SetInsertPoint(unchanged); b.CreateRet(fn.getArg(0));
  b.SetInsertPoint(equal); b.CreateCondBr(b.CreateICmpEQ(a, d), zero, setup);
  b.SetInsertPoint(zero); result(sign);
  b.SetInsertPoint(setup);
  auto *ex = b.CreateTrunc(b.CreateLShr(a, fraction), b.getInt32Ty());
  auto *ey = b.CreateTrunc(b.CreateLShr(d, fraction), b.getInt32Ty());
  auto *normalX = b.CreateICmpNE(ex, b.getInt32(0)), *normalY = b.CreateICmpNE(ey, b.getInt32(0));
  b.CreateStore(b.CreateOr(b.CreateAnd(a, implicit - 1), b.CreateSelect(normalX, b.getInt64(implicit), b.getInt64(0))), xSlot);
  b.CreateStore(b.CreateOr(b.CreateAnd(d, implicit - 1), b.CreateSelect(normalY, b.getInt64(implicit), b.getInt64(0))), ySlot);
  b.CreateStore(b.CreateSelect(normalX, ex, b.getInt32(1)), exSlot);
  b.CreateStore(b.CreateSelect(normalY, ey, b.getInt32(1)), eySlot); b.CreateBr(normalizeX);
  b.SetInsertPoint(normalizeX); b.CreateCondBr(b.CreateICmpULT(loadX(), b.getInt64(implicit)), shiftX, normalizeY);
  b.SetInsertPoint(shiftX); b.CreateStore(b.CreateShl(loadX(), 1), xSlot); b.CreateStore(b.CreateSub(loadEx(), b.getInt32(1)), exSlot); b.CreateBr(normalizeX);
  b.SetInsertPoint(normalizeY); b.CreateCondBr(b.CreateICmpULT(loadY(), b.getInt64(implicit)), shiftY, divide);
  b.SetInsertPoint(shiftY); b.CreateStore(b.CreateShl(loadY(), 1), ySlot); b.CreateStore(b.CreateSub(loadEy(), b.getInt32(1)), eySlot); b.CreateBr(normalizeY);
  b.SetInsertPoint(divide); b.CreateCondBr(b.CreateICmpSGT(loadEx(), loadEy()), subtract, finish);
  b.SetInsertPoint(subtract);
  auto *x = loadX(), *y = loadY();
  auto *difference = b.CreateSelect(b.CreateICmpUGE(x, y), b.CreateSub(x, y), x);
  b.CreateStore(difference, xSlot); b.CreateCondBr(b.CreateICmpEQ(difference, b.getInt64(0)), zero, advance);
  b.SetInsertPoint(advance); b.CreateStore(b.CreateShl(loadX(), 1), xSlot); b.CreateStore(b.CreateSub(loadEx(), b.getInt32(1)), exSlot); b.CreateBr(divide);
  b.SetInsertPoint(finish); x = loadX(); y = loadY();
  difference = b.CreateSelect(b.CreateICmpUGE(x, y), b.CreateSub(x, y), x);
  b.CreateStore(difference, xSlot); b.CreateCondBr(b.CreateICmpEQ(difference, b.getInt64(0)), zero, normalizeResult);
  b.SetInsertPoint(normalizeResult); b.CreateCondBr(b.CreateICmpULT(loadX(), b.getInt64(implicit)), shiftResult, encode);
  b.SetInsertPoint(shiftResult); b.CreateStore(b.CreateShl(loadX(), 1), xSlot); b.CreateStore(b.CreateSub(loadEy(), b.getInt32(1)), eySlot); b.CreateBr(normalizeResult);
  b.SetInsertPoint(encode); b.CreateCondBr(b.CreateICmpSGT(loadEy(), b.getInt32(0)), normal, subnormal);
  b.SetInsertPoint(normal);
  result(b.CreateOr(sign, b.CreateOr(b.CreateShl(b.CreateZExt(loadEy(), b.getInt64Ty()), fraction), b.CreateSub(loadX(), b.getInt64(implicit)))));
  b.SetInsertPoint(subnormal);
  result(b.CreateOr(sign, b.CreateLShr(loadX(), b.CreateZExt(b.CreateSub(b.getInt32(1), loadEy()), b.getInt64Ty()))));
}
