// SPDX-License-Identifier: MIT
#include "aot-float.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/InlineAsm.h"
#include "llvm/IR/IntrinsicsX86.h"
#include "llvm/IR/Module.h"
#include "llvm/ADT/SmallVector.h"

// Function-local state avoids globals/TLS and permits recursion and reentrant
// callbacks. Restore the entry environment around each external callback, then
// reestablish strict mode even when that callback changed its own environment.
void tsfg::establishNativeFloatingEnvironment(llvm::Module &module) {
  using namespace llvm;
  auto &context = module.getContext();
  auto *readSSE = Intrinsic::getOrInsertDeclaration(&module, Intrinsic::x86_sse_stmxcsr);
  auto *writeSSE = Intrinsic::getOrInsertDeclaration(&module, Intrinsic::x86_sse_ldmxcsr);
  auto *assemblyType = FunctionType::get(Type::getVoidTy(context), {PointerType::getUnqual(context)}, false);
  auto *readX87 = InlineAsm::get(assemblyType, "fnstcw ($0)", "r,~{memory}", true);
  auto *writeX87 = InlineAsm::get(assemblyType, "fldcw ($0)", "r,~{memory}", true);
  for (auto &fn : module) {
    if (fn.isDeclaration() || !(fn.getName().starts_with("native_") || fn.getName() == "tsfg_native_invoke_v3")) continue;
    fn.addFnAttr(Attribute::StrictFP);
    fn.addFnAttr("denormal-fp-math", "ieee,ieee");
    fn.addFnAttr("denormal-fp-math-f32", "ieee,ieee");
    SmallVector<CallInst *> callbacks;
    SmallVector<ReturnInst *> returns;
    for (auto &block : fn) for (auto &instruction : block) {
      if (auto *call = dyn_cast<CallInst>(&instruction)) {
        call->addFnAttr(Attribute::StrictFP);
        if (!call->getCalledFunction()) callbacks.push_back(call);
      }
      if (auto *ret = dyn_cast<ReturnInst>(&instruction)) returns.push_back(ret);
    }
    IRBuilder<> b(&*fn.getEntryBlock().getFirstInsertionPt());
    auto *mxcsr = b.CreateAlloca(b.getInt32Ty(), nullptr, "caller_mxcsr");
    auto *control = b.CreateAlloca(b.getInt16Ty(), nullptr, "caller_x87");
    auto *strictSSE = b.CreateAlloca(b.getInt32Ty(), nullptr, "strict_mxcsr");
    auto *strictX87 = b.CreateAlloca(b.getInt16Ty(), nullptr, "strict_x87");
    b.CreateCall(readSSE, {mxcsr}); b.CreateCall(readX87, {control});
    b.CreateStore(b.CreateOr(b.CreateAnd(b.CreateLoad(b.getInt32Ty(), mxcsr), ~uint32_t(0xe07f)), 0x1f80), strictSSE);
    b.CreateStore(b.CreateOr(b.CreateAnd(b.CreateLoad(b.getInt16Ty(), control), b.getInt16(~uint16_t(0x0c00))), b.getInt16(0x003f)), strictX87);
    auto restore = [&](Value *sse, Value *x87) { b.CreateCall(writeSSE, {sse}); b.CreateCall(writeX87, {x87}); };
    restore(strictSSE, strictX87);
    for (auto *callback : callbacks) {
      // Keep the existing marker adjacent to its callback: its code location is
      // part of the resource/event contract, not an arbitrary nearby address.
      auto *marker = dyn_cast_or_null<CallInst>(callback->getPrevNode());
      if (marker && marker->getCalledFunction() && marker->getCalledFunction()->getName() == "llvm.experimental.stackmap")
        b.SetInsertPoint(marker);
      else b.SetInsertPoint(callback);
      restore(mxcsr, control);
      b.SetInsertPoint(callback->getNextNode()); restore(strictSSE, strictX87);
    }
    for (auto *ret : returns) { b.SetInsertPoint(ret); restore(mxcsr, control); }
  }
}
