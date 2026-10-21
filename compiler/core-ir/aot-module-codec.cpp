// SPDX-License-Identifier: MIT
#include "aot-module-codec.h"
#include "dialect.h"
#include "scalar-presence.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/Function.h"

namespace tsfg {
using namespace llvm;
Value *ModuleAotCodec::address(Value *base, uint64_t offset) {
  return b.CreateGEP(b.getInt8Ty(), base, b.getInt64(offset));
}
Value *ModuleAotCodec::load(Type *type, Value *base, uint64_t offset, unsigned alignment) {
  return b.CreateAlignedLoad(type, address(base, offset), Align(alignment));
}
void ModuleAotCodec::store(Value *value, Value *base, uint64_t offset, unsigned alignment) {
  b.CreateAlignedStore(value, address(base, offset), Align(alignment));
}
Value *ModuleAotCodec::extent(Value *pointer, Value *bytes, unsigned alignment) {
  auto *number = b.CreatePtrToInt(pointer, b.getInt64Ty());
  auto *nonzero = b.CreateICmpNE(number, b.getInt64(0));
  auto *aligned = b.CreateICmpEQ(b.CreateAnd(number, b.getInt64(alignment - 1)), b.getInt64(0));
  auto *fits = b.CreateICmpULE(number, b.CreateSub(b.getInt64(UINT64_MAX), bytes));
  return b.CreateOr(b.CreateICmpEQ(bytes, b.getInt64(0)), b.CreateAnd(nonzero, b.CreateAnd(aligned, fits)));
}
Value *ModuleAotCodec::extent(Value *pointer, uint64_t bytes, unsigned alignment) {
  return extent(pointer, b.getInt64(bytes), alignment);
}
Value *ModuleAotCodec::disjoint(Value *a, Value *bytes, Value *c, Value *bytes2) {
  auto *left = b.CreatePtrToInt(a, b.getInt64Ty()), *right = b.CreatePtrToInt(c, b.getInt64Ty());
  // Callers check both extents before using these nonwrapping intervals.
  return b.CreateOr(b.CreateOr(b.CreateICmpEQ(bytes, b.getInt64(0)), b.CreateICmpEQ(bytes2, b.getInt64(0))),
      b.CreateOr(b.CreateICmpULE(b.CreateAdd(left, bytes), right), b.CreateICmpULE(b.CreateAdd(right, bytes2), left)));
}
Value *ModuleAotCodec::disjoint(Value *a, uint64_t bytes, Value *c, uint64_t bytes2) {
  return disjoint(a, b.getInt64(bytes), c, b.getInt64(bytes2));
}
Value *ModuleAotCodec::bytesEqual(Value *base, uint64_t offset, ArrayRef<uint8_t> bytes) {
  Value *equal = b.getTrue();
  for (unsigned i = 0; i < bytes.size(); ++i)
    equal = b.CreateAnd(equal, b.CreateICmpEQ(load(b.getInt8Ty(), base, offset + i), b.getInt8(bytes[i])));
  return equal;
}
Value *ModuleAotCodec::bytesEqual(Value *a, uint64_t offset, Value *c, uint64_t offset2, unsigned count) {
  Value *equal = b.getTrue();
  for (unsigned i = 0; i < count; ++i)
    equal = b.CreateAnd(equal, b.CreateICmpEQ(load(b.getInt8Ty(), a, offset + i), load(b.getInt8Ty(), c, offset2 + i)));
  return equal;
}
void ModuleAotCodec::allow(Value *condition, BasicBlock *failure) {
  auto *next = BasicBlock::Create(b.getContext(), "valid", b.GetInsertBlock()->getParent());
  b.CreateCondBr(condition, next, failure); b.SetInsertPoint(next);
}
void ModuleAotCodec::clear(Value *base, uint64_t bytes, unsigned alignment) {
  if (bytes) b.CreateMemSet(base, b.getInt8(0), bytes, Align(alignment));
}
Type *ModuleAotCodec::scalar(LLVMContext &context, uint8_t code) {
  if (code == 12) return Type::getFloatTy(context);
  if (code == 13) return Type::getDoubleTy(context);
  if (code >= 1 && code <= 11) return IntegerType::get(context, code == 2 ? 1 : tsfg::width(code));
  return nullptr;
}
std::vector<Value *> ModuleAotCodec::arguments(mlir::func::FuncOp fn, Value *count,
    Value *types, Value *resultType, Value *slots, BasicBlock *badArguments, BasicBlock *badPresence) {
  const auto signature = fn.getFunctionType();
  allow(b.CreateICmpEQ(count, b.getInt32(signature.getNumInputs())), badArguments);
  allow(b.CreateICmpEQ(resultType, b.getInt8(typeCode(signature.getResult(0)))), badArguments);
  std::vector<Value *> values;
  for (unsigned i = 0; i < signature.getNumInputs(); ++i) {
    const auto code = typeCode(signature.getInput(i));
    allow(b.CreateICmpEQ(load(b.getInt8Ty(), types, i), b.getInt8(code)), badArguments);
    auto *low = load(b.getInt32Ty(), slots, i * 8, 4);
    auto *high = load(b.getInt32Ty(), slots, i * 8 + 4, 4);
    if (code == 2) {
      allow(b.CreateAnd(b.CreateICmpEQ(low, b.getInt32(0)), b.CreateICmpULE(high, b.getInt32(1))), badArguments);
      values.push_back(b.CreateTrunc(high, b.getInt1Ty())); continue;
    }
    const auto bits = code == 12 ? 32 : tsfg::width(code);
    Value *value = low;
    if (bits <= 32) {
      allow(b.CreateICmpEQ(high, b.getInt32(0)), badArguments);
      if (bits < 32) {
        allow(b.CreateICmpULE(low, b.getInt32((UINT64_C(1) << bits) - 1)), badArguments);
        value = b.CreateTrunc(low, IntegerType::get(b.getContext(), bits));
      }
    } else {
      value = b.CreateOr(b.CreateZExt(low, b.getInt64Ty()), b.CreateShl(b.CreateZExt(high, b.getInt64Ty()), 32));
    }
    if (code == 12 || code == 13) value = b.CreateBitCast(value, scalar(b.getContext(), code));
    values.push_back(value);
  }
  std::vector<uint8_t> masks; parameterPresence(fn, masks);
  unsigned physical = 0;
  for (auto mask : masks) {
    auto *payload = values[physical++];
    if (!(mask & 3)) continue;
    auto *state = values[physical++];
    auto *present = b.CreateICmpEQ(state, b.getInt32(0));
    Value *allowed = present;
    if (mask & 1) allowed = b.CreateOr(allowed, b.CreateICmpEQ(state, b.getInt32(1)));
    if (mask & 2) allowed = b.CreateOr(allowed, b.CreateICmpEQ(state, b.getInt32(2)));
    if (payload->getType()->isFloatingPointTy())
      payload = b.CreateBitCast(payload, IntegerType::get(b.getContext(), payload->getType()->isFloatTy() ? 32 : 64));
    auto *zero = ConstantInt::get(cast<IntegerType>(payload->getType()), 0);
    allow(b.CreateAnd(allowed, b.CreateOr(present, b.CreateICmpEQ(payload, zero))), badPresence);
  }
  return values;
}
void ModuleAotCodec::result(uint8_t code, Value *value, Value *output) {
  Value *low = b.getInt32(0), *high = b.getInt32(0);
  if (code == 2) high = b.CreateZExt(value, b.getInt32Ty());
  else {
    if (value->getType()->isFloatingPointTy())
      value = b.CreateBitCast(value, code == 12 ? b.getInt32Ty() : b.getInt64Ty());
    if (value->getType()->getIntegerBitWidth() <= 32) low = b.CreateZExtOrTrunc(value, b.getInt32Ty());
    else { low = b.CreateTrunc(value, b.getInt32Ty()); high = b.CreateTrunc(b.CreateLShr(value, 32), b.getInt32Ty()); }
  }
  store(low, output, 0, 4); store(high, output, 4, 4);
}
} // namespace tsfg
