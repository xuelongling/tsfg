// SPDX-License-Identifier: MIT
#include "aot-module.h"
#include "../../runtime/aot-instance.h"
#include "llvm/IR/IRBuilder.h"
#include "llvm/IR/Intrinsics.h"
#include <cstddef>
#include <string>

namespace tsfg {
namespace {
using namespace llvm;
class Services {
  ModuleAotContext &context;
  LLVMContext &c;
  IRBuilder<> b;
  PointerType *ptr;
  IntegerType *i8, *i32, *i64;
  Function *record = nullptr, *continuing = nullptr, *eventResult = nullptr;
  Function *globalLoad = nullptr, *globalStore = nullptr, *hostCall = nullptr;

  Function *declare(StringRef name, Type *result, ArrayRef<Type *> arguments) {
    auto *signature = FunctionType::get(result, arguments, false);
    auto *function = context.native.getFunction(name);
    if (function) {
      if (!function->isDeclaration() || function->getFunctionType() != signature) return nullptr;
    } else {
      if (context.native.getNamedValue(name)) return nullptr;
      function = Function::Create(signature, GlobalValue::ExternalLinkage, name, context.native);
    }
    function->setLinkage(GlobalValue::InternalLinkage);
    function->setCallingConv(CallingConv::C);
    return function;
  }
  BasicBlock *block(Function *function, StringRef name) { return BasicBlock::Create(c, name, function); }
  void begin(Function *function) { b.SetInsertPoint(block(function, "entry")); }
  Value *at(Value *base, uint64_t offset) { return b.CreateGEP(i8, base, b.getInt64(offset)); }
  Value *field(Type *type, Value *base, uint64_t offset) { return b.CreateLoad(type, at(base, offset)); }
  void store(Value *value, Value *base, uint64_t offset) { b.CreateStore(value, at(base, offset)); }
  Value *nonnull(Value *value) { return b.CreateICmpNE(value, ConstantPointerNull::get(ptr)); }
  Value *clean(Value *request) { return b.CreateICmpNE(b.CreateCall(continuing, {request}), b.getInt32(0)); }
  void fail(Value *request, unsigned kind, unsigned reason, Value *entity, Value *source, Value *start, Value *end) {
    b.CreateCall(record, {request, b.getInt32(kind), b.getInt32(reason), entity, source, start, end});
  }
  void pairReturn(Function *function, Value *value) {
    auto *result = b.CreateInsertValue(Constant::getNullValue(function->getReturnType()), value, 0);
    b.CreateRet(b.CreateInsertValue(result, b.getInt32(1), 1));
  }
  void rejectUnless(Function *function, Value *condition, BasicBlock *rejected, StringRef name) {
    auto *next = block(function, name);
    b.CreateCondBr(condition, next, rejected);
    b.SetInsertPoint(next);
  }
  void emitRecord() {
    begin(record);
    auto *request = record->getArg(0);
    auto *done = block(record, "done");
    rejectUnless(record, nonnull(request), done, "valid_request");
    constexpr auto failure = offsetof(TsfgAotRequestV4, failure);
    rejectUnless(record, b.CreateICmpEQ(field(i32, request, failure + offsetof(TsfgAotFailureV4, kind)), b.getInt32(0)), done, "first_failure");
    const size_t offsets[] = {offsetof(TsfgAotFailureV4, reason), offsetof(TsfgAotFailureV4, function_index),
      offsetof(TsfgAotFailureV4, source_index), offsetof(TsfgAotFailureV4, start), offsetof(TsfgAotFailureV4, end)};
    for (unsigned index = 0; index < 5; ++index) store(record->getArg(index + 2), request, failure + offsets[index]);
    store(b.getInt32(0), request, failure + offsetof(TsfgAotFailureV4, reserved));
    store(b.getInt32(0), request, failure + offsetof(TsfgAotFailureV4, reserved) + sizeof(uint32_t));
    store(record->getArg(1), request, failure + offsetof(TsfgAotFailureV4, kind));
    b.CreateBr(done);
    b.SetInsertPoint(done); b.CreateRetVoid();
  }
  void emitContinue() {
    begin(continuing);
    auto *request = continuing->getArg(0);
    auto *invalid = block(continuing, "invalid");
    rejectUnless(continuing, nonnull(request), invalid, "valid_request");
    auto *kind = field(i32, request, offsetof(TsfgAotRequestV4, failure) + offsetof(TsfgAotFailureV4, kind));
    b.CreateRet(b.CreateZExt(b.CreateICmpEQ(kind, b.getInt32(0)), i32));
    b.SetInsertPoint(invalid); b.CreateRet(b.getInt32(0));
  }
  void emitEventResult() {
    begin(eventResult);
    auto *request = eventResult->getArg(0), *accepted = eventResult->getArg(1);
    auto *fallback = block(eventResult, "fallback"), *done = block(eventResult, "done");
    b.CreateCondBr(b.CreateICmpEQ(accepted, b.getInt32(0)), fallback, done);
    b.SetInsertPoint(fallback);
    fail(request, TSFG_AOT_ABORT, TSFG_AOT_EXECUTION_ABORT, eventResult->getArg(2), eventResult->getArg(3), eventResult->getArg(4), eventResult->getArg(5));
    b.CreateBr(done);
    b.SetInsertPoint(done);
    b.CreateRet(b.CreateZExt(b.CreateAnd(b.CreateICmpNE(accepted, b.getInt32(0)), clean(request)), i32));
  }
  void emitGlobal(bool writing) {
    auto *function = writing ? globalStore : globalLoad;
    begin(function);
    auto *instance = function->getArg(0), *request = function->getArg(1), *index = function->getArg(2);
    const unsigned anchor = writing ? 5 : 3;
    auto *entity = function->getArg(anchor), *source = function->getArg(anchor + 1);
    auto *start = function->getArg(anchor + 2), *end = function->getArg(anchor + 3);
    auto *rejected = block(function, "failed"), *badInstance = block(function, "bad_instance"), *tdz = block(function, "tdz");
    // The entry validated both storage capacities. Keep internal bad indexes
    // and null storage from producing a speculative out-of-bounds access.
    rejectUnless(function, clean(request), rejected, "request_clean");
    rejectUnless(function, nonnull(instance), badInstance, "valid_instance");
    auto *count = field(i32, instance, offsetof(TsfgAotInstanceV4, global_count));
    auto *valid = b.CreateAnd(b.CreateICmpULT(index, b.getInt32(context.tables.globals.size())), b.CreateICmpULT(index, count));
    if (writing) valid = b.CreateAnd(valid, b.CreateICmpULE(function->getArg(4), b.getInt32(1)));
    rejectUnless(function, valid, badInstance, "valid_index");
    auto *globals = field(ptr, instance, offsetof(TsfgAotInstanceV4, globals));
    auto *initialized = field(ptr, instance, offsetof(TsfgAotInstanceV4, initialized));
    rejectUnless(function, b.CreateAnd(nonnull(globals), nonnull(initialized)), badInstance, "valid_storage");
    auto *offset = b.CreateZExt(index, i64);
    auto *flag = b.CreateGEP(i8, initialized, offset);
    Value *available = b.CreateICmpNE(b.CreateLoad(i8, flag), b.getInt8(0));
    if (writing) available = b.CreateOr(available, b.CreateICmpNE(function->getArg(4), b.getInt32(0)));
    rejectUnless(function, available, tdz, "initialized");
    auto *value = b.CreateGEP(i64, globals, offset);
    if (writing) {
      b.CreateStore(function->getArg(3), value);
      b.CreateStore(b.getInt8(1), flag);
      b.CreateRet(b.getInt32(1));
    } else pairReturn(function, b.CreateLoad(i64, value));
    b.SetInsertPoint(tdz);
    fail(request, TSFG_AOT_EXCEPTION, TSFG_AOT_TDZ, entity, source, start, end);
    b.CreateBr(rejected);
    b.SetInsertPoint(badInstance);
    fail(request, TSFG_AOT_REQUEST, TSFG_AOT_BAD_INSTANCE, entity, source, start, end);
    b.CreateBr(rejected);
    b.SetInsertPoint(rejected); b.CreateRet(Constant::getNullValue(function->getReturnType()));
  }
  void hostEvent(Function *function, Value *request, Value *eventState, Value *event, Value *entity,
      Value *source, Value *start, Value *end, uint32_t hostIndex, unsigned phase, BasicBlock *rejected) {
    // These real location markers occupy a separate domain from ordinary
    // frame and interval markers. Their existence is not Resource/RF credit.
    const uint64_t location = (UINT64_C(1) << 62) | (uint64_t(hostIndex) * 2 + phase);
    auto *marker = Intrinsic::getOrInsertDeclaration(&context.native, Intrinsic::experimental_stackmap);
    b.CreateCall(marker, {b.getInt64((UINT64_C(1) << 63) | location), b.getInt32(0)});
    auto *signature = FunctionType::get(i32, {ptr, i32, i32, i32, i32, i64}, false);
    auto *accepted = b.CreateCall(signature, event, {eventState, b.getInt32(13 + phase), entity, start, end, b.getInt64(location)});
    auto *result = b.CreateCall(eventResult, {request, accepted, entity, source, start, end});
    rejectUnless(function, b.CreateICmpNE(result, b.getInt32(0)), rejected, phase == 0 ? "host_admitted" : "host_completed");
  }
  bool emitHost() {
    begin(hostCall);
    auto *instance = hostCall->getArg(0), *request = hostCall->getArg(1);
    auto *eventState = hostCall->getArg(2), *event = hostCall->getArg(3);
    auto *index = hostCall->getArg(4), *argument = hostCall->getArg(5);
    auto *source = hostCall->getArg(7), *start = hostCall->getArg(8), *end = hostCall->getArg(9);
    auto *entity = b.CreateOr(index, b.getInt32(TSFG_AOT_HOST_ENTITY));
    auto *rejected = block(hostCall, "failed"), *badCapability = block(hostCall, "bad_capability");
    rejectUnless(hostCall, clean(request), rejected, "request_clean");
    rejectUnless(hostCall, b.CreateAnd(nonnull(instance), nonnull(event)), badCapability, "valid_context");
    auto *hosts = field(ptr, instance, offsetof(TsfgAotInstanceV4, hosts));
    auto *authority = field(ptr, instance, offsetof(TsfgAotInstanceV4, authority));
    auto *count = field(i32, instance, offsetof(TsfgAotInstanceV4, host_count));
    rejectUnless(hostCall, b.CreateAnd(b.CreateAnd(nonnull(hosts), nonnull(authority)), b.CreateICmpEQ(count, b.getInt32(1))), badCapability, "valid_authority");
    // Entry authorization bound this unique capability31 grant to the fixed
    // real bridge and Counter admission. Never create authority from metadata.
    auto *counter = field(ptr, hosts, offsetof(TsfgAotHost31V4, counter));
    auto *bridge = field(ptr, authority, offsetof(TsfgAotAuthorityV4, host31));
    rejectUnless(hostCall, b.CreateAnd(nonnull(counter), nonnull(bridge)), badCapability, "valid_bridge");
    auto *dispatch = b.CreateSwitch(index, badCapability);
    for (size_t host = 0; host < context.tables.hosts.size(); ++host) {
      if (!context.tables.plan.hosts[host]) continue;
      if (context.tables.hosts[host].capability != 31) return false;
      auto *selected = block(hostCall, "host_" + std::to_string(host));
      dispatch->addCase(b.getInt32(host), selected);
      b.SetInsertPoint(selected);
      hostEvent(hostCall, request, eventState, event, entity, source, start, end, host, 0, rejected);
      auto *signature = FunctionType::get(i32, {ptr, i32}, false);
      auto *result = b.CreateCall(signature, bridge, {counter, argument});
      rejectUnless(hostCall, clean(request), rejected, "bridge_returned");
      hostEvent(hostCall, request, eventState, event, entity, source, start, end, host, 1, rejected);
      pairReturn(hostCall, result);
    }
    b.SetInsertPoint(badCapability);
    fail(request, TSFG_AOT_REQUEST, TSFG_AOT_BAD_CAPABILITY, entity, source, start, end);
    b.CreateBr(rejected);
    b.SetInsertPoint(rejected); b.CreateRet(Constant::getNullValue(hostCall->getReturnType()));
    return true;
  }
public:
  explicit Services(ModuleAotContext &input) : context(input), c(input.native.getContext()), b(c),
      ptr(PointerType::getUnqual(c)), i8(b.getInt8Ty()), i32(b.getInt32Ty()), i64(b.getInt64Ty()) {}
  bool emit() {
    if (context.tables.globals.size() > 4096 || context.tables.hosts.size() > 128
        || context.tables.plan.hosts.size() != context.tables.hosts.size()) return false;
    record = declare("tsfg_aot_record_failure_v4", b.getVoidTy(), {ptr, i32, i32, i32, i32, i32, i32});
    continuing = declare("tsfg_aot_continue_v4", i32, {ptr});
    eventResult = declare("tsfg_aot_event_result_v4", i32, {ptr, i32, i32, i32, i32, i32});
    globalLoad = declare("tsfg_aot_global_load_v4", StructType::get(c, {i64, i32}), {ptr, ptr, i32, i32, i32, i32, i32});
    globalStore = declare("tsfg_aot_global_store_v4", i32, {ptr, ptr, i32, i64, i32, i32, i32, i32, i32});
    hostCall = declare("tsfg_aot_host31_v4", StructType::get(c, {i32, i32}), {ptr, ptr, ptr, ptr, i32, i32, i32, i32, i32, i32});
    if (!record || !continuing || !eventResult || !globalLoad || !globalStore || !hostCall) return false;
    emitRecord(); emitContinue(); emitEventResult(); emitGlobal(false); emitGlobal(true);
    return emitHost();
  }
};
} // namespace
bool materializeModuleServices(ModuleAotContext &context) { return Services(context).emit(); }
} // namespace tsfg
