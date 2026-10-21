// SPDX-License-Identifier: MIT
#include "aot-module.h"
#include "aot-module-codec.h"
#include "dialect.h"
#include "scalar-presence.h"
#include "../../runtime/aot-instance.h"
#include "llvm/IR/Constants.h"
#include "llvm/IR/GlobalVariable.h"
#include "llvm/IR/Intrinsics.h"

namespace {
using namespace llvm;
using tsfg::ModuleAotCodec;
struct Region { Value *pointer; uint64_t bytes; };
struct Storage { Value *globals, *initialized, *hosts, *authority, *counter = nullptr; };
struct Anchor { uint32_t function, source, start, end; };
constexpr uint32_t unknown = UINT32_MAX;

class Entry {
  tsfg::ModuleAotContext &context;
  Module &module;
  IRBuilder<> b;
  ModuleAotCodec codec;
  PointerType *ptr;
  std::vector<Function *> native;
  std::vector<Anchor> anchors;
  std::vector<Region> regions;
  Function *recordFailure, *continued, *eventResult;
  Function *function = nullptr;
  Value *instance = nullptr, *request = nullptr, *eventState = nullptr, *eventFunction = nullptr;
  unsigned requiredHosts = 0;
  tsfg::ModuleHash hostSignature{};

  Value *u32(Value *base, uint64_t offset) { return codec.load(b.getInt32Ty(), base, offset, 4); }
  Value *pointer(Value *base, uint64_t offset) { return codec.load(ptr, base, offset, 8); }
  void put(Value *base, uint64_t offset, uint32_t value) { codec.store(b.getInt32(value), base, offset, 4); }
  void fail(unsigned kind, unsigned reason, Anchor anchor = {unknown, unknown, 0, 0}) {
    b.CreateCall(recordFailure, {request, b.getInt32(kind), b.getInt32(reason), b.getInt32(anchor.function),
        b.getInt32(anchor.source), b.getInt32(anchor.start), b.getInt32(anchor.end)});
  }
  BasicBlock *rejection(unsigned reason = 0, Anchor anchor = {unknown, unknown, 0, 0}) {
    auto saved = b.saveIP();
    auto *block = BasicBlock::Create(b.getContext(), "reject", function); b.SetInsertPoint(block);
    if (reason) fail(TSFG_AOT_REQUEST, reason, anchor);
    b.CreateRet(b.getInt32(0)); b.restoreIP(saved); return block;
  }
  Value *continuing() { return b.CreateICmpNE(b.CreateCall(continued, {request}), b.getInt32(0)); }
  void header(BasicBlock *bad) {
    codec.allow(codec.extent(instance, sizeof(TsfgAotInstanceV4), alignof(TsfgAotInstanceV4)), bad);
    codec.allow(b.CreateICmpEQ(u32(instance, offsetof(TsfgAotInstanceV4, version)), b.getInt32(4)), bad);
    codec.allow(b.CreateICmpEQ(u32(instance, offsetof(TsfgAotInstanceV4, bytes)), b.getInt32(sizeof(TsfgAotInstanceV4))), bad);
    codec.allow(codec.bytesEqual(instance, offsetof(TsfgAotInstanceV4, compiled_table_id), context.identity), bad);
    codec.allow(b.CreateICmpEQ(u32(instance, offsetof(TsfgAotInstanceV4, global_count)), b.getInt32(context.tables.globals.size())), bad);
    codec.allow(b.CreateICmpEQ(u32(instance, offsetof(TsfgAotInstanceV4, host_count)), b.getInt32(requiredHosts)), bad);
  }
  Storage storage(BasicBlock *bad, Value *invocation = nullptr) {
    // Header rejection precedes every borrowed child-pointer dereference.
    header(bad);
    Storage state{pointer(instance, offsetof(TsfgAotInstanceV4, globals)),
        pointer(instance, offsetof(TsfgAotInstanceV4, initialized)),
        pointer(instance, offsetof(TsfgAotInstanceV4, hosts)), pointer(instance, offsetof(TsfgAotInstanceV4, authority))};
    regions = {{instance, sizeof(TsfgAotInstanceV4)}, {state.globals, context.tables.globals.size() * 8},
      {state.initialized, context.tables.globals.size()}, {state.hosts, requiredHosts * sizeof(TsfgAotHost31V4)},
      {state.authority, requiredHosts ? sizeof(TsfgAotAuthorityV4) : 0}};
    const unsigned alignments[] = {8, 8, 1, 8, 8};
    for (unsigned i = 0; i < regions.size(); ++i) {
      codec.allow(codec.extent(regions[i].pointer, regions[i].bytes, alignments[i]), bad);
      for (unsigned j = 0; j < i; ++j)
        codec.allow(codec.disjoint(regions[i].pointer, regions[i].bytes, regions[j].pointer, regions[j].bytes), bad);
      if (invocation) codec.allow(codec.disjoint(invocation, sizeof(TsfgAotRequestV4), regions[i].pointer, regions[i].bytes), bad);
    }
    if (requiredHosts) {
      state.counter = pointer(state.hosts, offsetof(TsfgAotHost31V4, counter));
      codec.allow(codec.extent(state.counter, 16, 8), bad);
      for (auto region : regions) codec.allow(codec.disjoint(state.counter, 16, region.pointer, region.bytes), bad);
      if (invocation) codec.allow(codec.disjoint(state.counter, 16, invocation, sizeof(TsfgAotRequestV4)), bad);
      regions.push_back({state.counter, 16});
    }
    // Counts bind both capacities under the trusted embedding's borrowed
    // storage contract. Extents prevent null/alignment/wrap/overlap errors;
    // C pointers cannot authenticate their actual allocation or function body.
    return state;
  }
  Value *recordGate(BasicBlock *bad, bool constructor) {
    codec.allow(b.CreateICmpEQ(u32(instance, offsetof(TsfgAotInstanceV4, active)), b.getInt32(0)), bad);
    auto *status = u32(instance, offsetof(TsfgAotInstanceV4, status));
    Value *valid = b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_COLD));
    if (!constructor) valid = b.CreateOr(valid, b.CreateOr(b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_READY)),
        b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_FAILED))));
    codec.allow(valid, bad);
    auto *memoKind = u32(instance, offsetof(TsfgAotInstanceV4, memo) + offsetof(TsfgAotFailureV4, kind));
    auto *failed = b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_FAILED));
    auto *knownFailure = b.CreateAnd(b.CreateICmpUGE(memoKind, b.getInt32(TSFG_AOT_TRAP)),
        b.CreateICmpULE(memoKind, b.getInt32(TSFG_AOT_EXCEPTION)));
    codec.allow(b.CreateSelect(failed, knownFailure, b.CreateICmpEQ(memoKind, b.getInt32(TSFG_AOT_NONE))), bad);
    codec.allow(b.CreateICmpEQ(codec.load(b.getInt64Ty(), instance,
        offsetof(TsfgAotInstanceV4, memo) + offsetof(TsfgAotFailureV4, reserved), 4), b.getInt64(0)), bad);
    return status;
  }
  void hostGate(Storage state, BasicBlock *badCapability, BasicBlock *badContract) {
    if (!requiredHosts) return;
    auto *grant = state.hosts, *authority = state.authority;
    codec.allow(b.CreateICmpEQ(u32(grant, offsetof(TsfgAotHost31V4, capability)), b.getInt32(31)), badCapability);
    codec.allow(b.CreateICmpEQ(u32(grant, offsetof(TsfgAotHost31V4, reserved)), b.getInt32(0)), badCapability);
    codec.allow(codec.bytesEqual(grant, offsetof(TsfgAotHost31V4, signature), hostSignature), badCapability);
    codec.allow(b.CreateICmpEQ(u32(authority, offsetof(TsfgAotAuthorityV4, version)), b.getInt32(4)), badCapability);
    codec.allow(b.CreateICmpEQ(u32(authority, offsetof(TsfgAotAuthorityV4, bytes)), b.getInt32(sizeof(TsfgAotAuthorityV4))), badCapability);
    codec.allow(codec.bytesEqual(authority, offsetof(TsfgAotAuthorityV4, signature), hostSignature), badContract);
    codec.allow(codec.bytesEqual(grant, offsetof(TsfgAotHost31V4, semantic_contract), authority,
        offsetof(TsfgAotAuthorityV4, semantic_contract), 32), badContract);
    auto *bridge = pointer(authority, offsetof(TsfgAotAuthorityV4, host31));
    auto *admitted = pointer(authority, offsetof(TsfgAotAuthorityV4, admitted));
    codec.allow(b.CreateICmpNE(bridge, ConstantPointerNull::get(ptr)), badCapability);
    codec.allow(b.CreateICmpNE(admitted, ConstantPointerNull::get(ptr)), badCapability);
    // The authority is constructed by the trusted Runtime, never request JSON.
    // Its real admitted callback retains the actual false-certificate decision.
    auto *type = FunctionType::get(b.getInt32Ty(), {ptr}, false);
    codec.allow(b.CreateICmpNE(b.CreateCall(type, admitted, {state.counter}), b.getInt32(0)), badCapability);
  }
  Value *event(unsigned kind, Anchor anchor, uint64_t id) {
    auto *marker = Intrinsic::getOrInsertDeclaration(&module, Intrinsic::experimental_stackmap);
    b.CreateCall(marker, {b.getInt64((UINT64_C(1) << 63) | id), b.getInt32(0)});
    auto *type = FunctionType::get(b.getInt32Ty(), {ptr, b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt64Ty()}, false);
    auto *accepted = b.CreateCall(type, eventFunction, {eventState, b.getInt32(kind), b.getInt32(anchor.function),
        b.getInt32(anchor.start), b.getInt32(anchor.end), b.getInt64(id)});
    return b.CreateICmpNE(b.CreateCall(eventResult, {request, accepted, b.getInt32(anchor.function),
        b.getInt32(anchor.source), b.getInt32(anchor.start), b.getInt32(anchor.end)}), b.getInt32(0));
  }
  void finishFailure(bool initialization) {
    if (initialization) {
      b.CreateMemCpy(codec.address(instance, offsetof(TsfgAotInstanceV4, memo)), Align(4),
          codec.address(request, offsetof(TsfgAotRequestV4, failure)), Align(4), sizeof(TsfgAotFailureV4));
      put(instance, offsetof(TsfgAotInstanceV4, status), TSFG_AOT_FAILED);
    }
    put(instance, offsetof(TsfgAotInstanceV4, active), 0); b.CreateRet(b.getInt32(0));
  }
  void root(unsigned index, Storage state, Value *status, Value *count, Value *types,
      Value *resultType, Value *arguments, Value *output) {
    const auto &root = context.tables.roots[index]; const auto anchor = anchors[root.function];
    auto *badArguments = rejection(TSFG_AOT_BAD_ARGUMENTS, anchor);
    auto *badPresence = rejection(TSFG_AOT_BAD_PRESENCE, anchor);
    auto values = codec.arguments(context.functions[root.function], count, types, resultType, arguments, badArguments, badPresence);
    hostGate(state, rejection(TSFG_AOT_BAD_CAPABILITY, anchor), rejection(TSFG_AOT_BAD_HOST_CONTRACT, anchor));
    auto *memo = BasicBlock::Create(b.getContext(), "memo", function), *run = BasicBlock::Create(b.getContext(), "run", function);
    b.CreateCondBr(b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_FAILED)), memo, run);
    b.SetInsertPoint(memo);
    b.CreateMemCpy(codec.address(request, offsetof(TsfgAotRequestV4, failure)), Align(4),
        codec.address(instance, offsetof(TsfgAotInstanceV4, memo)), Align(4), sizeof(TsfgAotFailureV4));
    b.CreateRet(b.getInt32(0)); b.SetInsertPoint(run);
    put(instance, offsetof(TsfgAotInstanceV4, active), 1);
    auto *cold = BasicBlock::Create(b.getContext(), "initialize", function), *ready = BasicBlock::Create(b.getContext(), "ready", function);
    auto *initFailure = BasicBlock::Create(b.getContext(), "initialization_failure", function);
    auto *requestFailure = BasicBlock::Create(b.getContext(), "request_failure", function);
    b.CreateCondBr(b.CreateICmpEQ(status, b.getInt32(TSFG_AOT_COLD)), cold, ready);
    b.SetInsertPoint(initFailure); finishFailure(true);
    b.SetInsertPoint(requestFailure); finishFailure(false);
    b.SetInsertPoint(cold); put(instance, offsetof(TsfgAotInstanceV4, status), TSFG_AOT_INITIALIZING);
    const uint64_t prefix = (UINT64_C(1) << 61) | uint64_t(index) * 1024;
    unsigned phase = 0;
    for (auto initializer : context.tables.initialization) {
      codec.allow(event(0, anchors[initializer], prefix | phase++), initFailure);
      b.CreateCall(native[initializer], {eventState, eventFunction, instance, request});
      codec.allow(continuing(), initFailure);
    }
    put(instance, offsetof(TsfgAotInstanceV4, status), TSFG_AOT_READY); b.CreateBr(ready);
    b.SetInsertPoint(ready);
    Value *result = b.getInt32(0);
    if (root.kind != 1) {
      codec.allow(event(0, anchor, prefix | 256), requestFailure);
      std::vector<Value *> call{eventState, eventFunction, instance, request};
      call.insert(call.end(), values.begin(), values.end()); result = b.CreateCall(native[root.function], call);
      codec.allow(continuing(), requestFailure);
    }
    codec.allow(event(8, anchor, prefix | 257), requestFailure);
    put(instance, offsetof(TsfgAotInstanceV4, active), 0);
    codec.result(tsfg::typeCode(context.functions[root.function].getFunctionType().getResult(0)), result, output);
    b.CreateRet(b.getInt32(1));
  }
  void constructor() {
    request = nullptr;
    function = Function::Create(FunctionType::get(b.getInt32Ty(), {ptr}, false), GlobalValue::ExternalLinkage, "tsfg_aot_instance_init_v4", module);
    instance = function->getArg(0); b.SetInsertPoint(BasicBlock::Create(b.getContext(), "entry", function));
    auto *bad = rejection(); auto state = storage(bad); recordGate(bad, true);
    codec.clear(state.globals, context.tables.globals.size() * 8, 8);
    codec.clear(state.initialized, context.tables.globals.size());
    codec.clear(codec.address(instance, offsetof(TsfgAotInstanceV4, memo)), sizeof(TsfgAotFailureV4), 4);
    put(instance, offsetof(TsfgAotInstanceV4, status), TSFG_AOT_COLD);
    put(instance, offsetof(TsfgAotInstanceV4, active), 0); b.CreateRet(b.getInt32(1));
  }
  void invoke() {
    auto *type = FunctionType::get(b.getInt32Ty(), {ptr, ptr, b.getInt32Ty(), b.getInt32Ty(), ptr, b.getInt8Ty(), ptr, ptr}, false);
    function = Function::Create(type, GlobalValue::ExternalLinkage, "tsfg_aot_invoke_v4", module);
    instance = function->getArg(0); request = function->getArg(1);
    auto *selected = function->getArg(2), *count = function->getArg(3), *types = function->getArg(4);
    auto *resultType = function->getArg(5), *arguments = function->getArg(6), *output = function->getArg(7);
    b.SetInsertPoint(BasicBlock::Create(b.getContext(), "entry", function)); auto *bare = rejection();
    codec.allow(codec.extent(request, sizeof(TsfgAotRequestV4), alignof(TsfgAotRequestV4)), bare);
    codec.allow(b.CreateICmpEQ(u32(request, offsetof(TsfgAotRequestV4, version)), b.getInt32(4)), bare);
    codec.allow(b.CreateICmpEQ(u32(request, offsetof(TsfgAotRequestV4, bytes)), b.getInt32(sizeof(TsfgAotRequestV4))), bare);
    eventState = pointer(request, offsetof(TsfgAotRequestV4, event_state)); eventFunction = pointer(request, offsetof(TsfgAotRequestV4, event));
    codec.allow(b.CreateICmpNE(eventFunction, ConstantPointerNull::get(ptr)), bare);
    auto state = storage(bare, request);
    // Establish independent readable/writable views before clearing failure.
    // Malformed borrowed pointers return0 without touching aliased output or
    // instance storage; they are outside the typed embedding storage contract.
    codec.allow(b.CreateICmpULE(count, b.getInt32(128)), bare);
    auto *bytes = b.CreateMul(b.CreateZExt(count, b.getInt64Ty()), b.getInt64(8));
    auto *typeBytes = b.CreateZExt(count, b.getInt64Ty());
    codec.allow(codec.extent(arguments, bytes, 4), bare); codec.allow(codec.extent(types, typeBytes, 1), bare);
    codec.allow(codec.extent(output, 8, 4), bare);
    codec.allow(codec.disjoint(arguments, bytes, request, b.getInt64(sizeof(TsfgAotRequestV4))), bare);
    codec.allow(codec.disjoint(types, typeBytes, request, b.getInt64(sizeof(TsfgAotRequestV4))), bare);
    codec.allow(codec.disjoint(output, 8, request, sizeof(TsfgAotRequestV4)), bare);
    for (auto region : regions) {
      codec.allow(codec.disjoint(output, 8, region.pointer, region.bytes), bare);
      codec.allow(codec.disjoint(arguments, bytes, region.pointer, b.getInt64(region.bytes)), bare);
      codec.allow(codec.disjoint(types, typeBytes, region.pointer, b.getInt64(region.bytes)), bare);
    }
    auto *reserved = codec.load(b.getInt64Ty(), request, offsetof(TsfgAotRequestV4, failure) + offsetof(TsfgAotFailureV4, reserved), 4);
    codec.clear(codec.address(request, offsetof(TsfgAotRequestV4, failure)), sizeof(TsfgAotFailureV4), 4);
    auto *badInstance = rejection(TSFG_AOT_BAD_INSTANCE), *badArguments = rejection(TSFG_AOT_BAD_ARGUMENTS);
    auto *status = recordGate(badInstance, false);
    codec.allow(b.CreateICmpEQ(reserved, b.getInt64(0)), badArguments);
    auto *selection = b.CreateSwitch(selected, rejection(TSFG_AOT_BAD_FUNCTION), context.tables.roots.size());
    for (unsigned i = 0; i < context.tables.roots.size(); ++i) {
      auto *block = BasicBlock::Create(b.getContext(), "root", function); selection->addCase(b.getInt32(i), block);
      b.SetInsertPoint(block); root(i, state, status, count, types, resultType, arguments, output);
    }
  }
  bool validate() {
    const auto &tables = context.tables;
    if (!tables.present || context.functions.empty() || context.functions.size() > 512 || tables.modules.size() > 128
        || tables.globals.size() > 4096 || tables.roots.empty() || tables.roots.size() > 128 || tables.initialization.size() > 128
        || tables.plan.hosts.size() != tables.hosts.size() || tables.plan.functions.size() != context.functions.size()
        || tables.plan.modules.size() != tables.modules.size()) return false;
    for (unsigned i = 0; i < tables.hosts.size(); ++i) if (tables.plan.hosts[i]) {
      if (tables.hosts[i].capability != 31) return false;
      if (requiredHosts && hostSignature != tables.hosts[i].signature) return false;
      requiredHosts = 1; hostSignature = tables.hosts[i].signature;
    }
    for (unsigned i = 0; i < context.functions.size(); ++i) {
      auto fn = context.functions[i]; auto signature = fn.getFunctionType(); std::vector<uint8_t> presence;
      auto *callee = module.getFunction("native_" + std::to_string(i));
      if (!callee || callee->isDeclaration() || signature.getNumResults() != 1 || !tsfg::parameterPresence(fn, presence)
          || callee->arg_size() != signature.getNumInputs() + 4) return false;
      auto *result = ModuleAotCodec::scalar(b.getContext(), tsfg::typeCode(signature.getResult(0)));
      if (!result || callee->getReturnType() != result) return false;
      for (unsigned p = 0; p < 4; ++p) if (callee->getArg(p)->getType() != ptr) return false;
      for (unsigned p = 0; p < signature.getNumInputs(); ++p)
        if (callee->getArg(p + 4)->getType() != ModuleAotCodec::scalar(b.getContext(), tsfg::typeCode(signature.getInput(p)))) return false;
      auto source = fn->getAttrOfType<mlir::IntegerAttr>("tsfg_core.source_index");
      auto start = fn->getAttrOfType<mlir::IntegerAttr>("tsfg_core.function_start"), end = fn->getAttrOfType<mlir::IntegerAttr>("tsfg_core.function_end");
      if (!source || !start || !end || source.getInt() < 0 || uint64_t(source.getInt()) >= tables.sources.size()
          || start.getInt() < 0 || end.getInt() < start.getInt() || uint64_t(end.getInt()) > tables.sources[source.getInt()].length) return false;
      native.push_back(callee); anchors.push_back({i, uint32_t(source.getInt()), uint32_t(start.getInt()), uint32_t(end.getInt())});
    }
    for (auto initializer : tables.initialization)
      if (initializer >= native.size() || native[initializer]->arg_size() != 4 || native[initializer]->getReturnType() != b.getInt32Ty()) return false;
    for (const auto &root : tables.roots)
      if (root.function >= native.size() || (root.kind == 1 && (native[root.function]->arg_size() != 4 || native[root.function]->getReturnType() != b.getInt32Ty()))) return false;
    return recordFailure && continued && eventResult
      && recordFailure->getFunctionType() == FunctionType::get(b.getVoidTy(), {ptr, b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty()}, false)
      && continued->getFunctionType() == FunctionType::get(b.getInt32Ty(), {ptr}, false)
      && eventResult->getFunctionType() == FunctionType::get(b.getInt32Ty(), {ptr, b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty(), b.getInt32Ty()}, false);
  }
public:
  explicit Entry(tsfg::ModuleAotContext &value) : context(value), module(value.native), b(module.getContext()), codec(b),
      ptr(PointerType::getUnqual(module.getContext())), recordFailure(module.getFunction("tsfg_aot_record_failure_v4")),
      continued(module.getFunction("tsfg_aot_continue_v4")), eventResult(module.getFunction("tsfg_aot_event_result_v4")) {}
  bool materialize() {
    if (!validate()) return false;
    for (auto name : {"tsfg_aot_global_count_v4", "tsfg_aot_required_host_count_v4", "tsfg_aot_compiled_table_id_v4", "tsfg_aot_instance_init_v4", "tsfg_aot_invoke_v4"})
      if (module.getNamedValue(name)) return false;
    // Complete code retention does not expose undeclared embedding entries.
    for (auto *callee : native) callee->setLinkage(GlobalValue::InternalLinkage);
    new GlobalVariable(module, b.getInt32Ty(), true, GlobalValue::ExternalLinkage, b.getInt32(context.tables.globals.size()), "tsfg_aot_global_count_v4");
    new GlobalVariable(module, b.getInt32Ty(), true, GlobalValue::ExternalLinkage, b.getInt32(requiredHosts), "tsfg_aot_required_host_count_v4");
    auto *identity = ConstantDataArray::get(b.getContext(), ArrayRef<uint8_t>(context.identity));
    new GlobalVariable(module, identity->getType(), true, GlobalValue::ExternalLinkage, identity, "tsfg_aot_compiled_table_id_v4");
    constructor(); invoke(); return true;
  }
};
} // namespace

bool tsfg::materializeModuleEntry(ModuleAotContext &context) { return Entry(context).materialize(); }
