// SPDX-License-Identifier: MIT
// M39 end-to-end formal Common20 initialized instance + software Vulkan (Lavapipe) acceptance.
// Executes right(11), right(-4), and zero-fuel right(5) against ONE initialized Common20 instance.
#include "common20-gpu-source-lease.h"
#include "core-ir/dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVDialect.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"
#include <cstdint>
#include <iostream>
#include <string>

namespace {
using namespace tsfg::commonProgram;

bool readFileAll(const std::string &path, std::string &out) {
  auto buf = llvm::MemoryBuffer::getFile(path);
  if (!buf) {
    llvm::errs() << "failed to read: " << path << "\n";
    return false;
  }
  out = (*buf)->getBuffer().str();
  return true;
}

bool check(bool cond, const char *msg) {
  if (!cond) {
    llvm::errs() << "FAIL: " << msg << "\n";
    return false;
  }
  return true;
}
} // namespace

int main(int argc, char **argv) {
  if (argc != 4) {
    llvm::errs() << "usage: m39-common20-instance-lavapipe <right-results-dir> <vulkan-1.dll> <lvp_icd.json>\n";
    return 2;
  }
  const std::string dir = argv[1];
  const std::string loaderPath = argv[2];
  const std::string icdPath = argv[3];

  std::string tbcBytes, coreBytes, requestBytes, planBytes;
  if (!readFileAll(dir + "/right.common20.tbc", tbcBytes) ||
      !readFileAll(dir + "/inputs/common-program.mlir", coreBytes) ||
      !readFileAll(dir + "/inputs/gpu-binding-request.json", requestBytes) ||
      !readFileAll(dir + "/inputs/gpu-binding-plan.json", planBytes)) {
    return 2;
  }

  mlir::DialectRegistry registry;
  tsfg::registerCoreDialect(registry);
  registerDialect(registry);
  registry.insert<mlir::func::FuncDialect, mlir::cf::ControlFlowDialect, mlir::spirv::SPIRVDialect>();
  mlir::MLIRContext context(registry);
  context.disableMultithreading();

  Program program;
  Error error;
  Json request = nullptr, savedPlan = nullptr, plan = nullptr, artifact = nullptr;
  {
    auto core = mlir::parseSourceString<mlir::ModuleOp>(coreBytes, &context);
    if (!check(static_cast<bool>(core), "parse common-program.mlir")) return 1;
    if (!check(readCore(*core, program, error), "readCore")) return 1;
  }
  if (!check(readJson(llvm::StringRef(requestBytes).drop_back(), request, program, error), "read request")) return 1;
  if (!check(readJson(llvm::StringRef(planBytes).drop_back(), savedPlan, program, error), "read saved plan")) return 1;
  if (!check(createGpuBindingPlan(program, request, plan, error), "createGpuBindingPlan")) return 1;
  if (!check(same(plan, savedPlan), "plan matches saved plan")) return 1;
  if (!check(emitGpuBindingModule(program, plan, "single-source-call-v1", context, artifact, error), "emitGpuBindingModule")) return 1;
  std::string artifactBytes = canonical(artifact) + "\n";
  std::optional<GpuPendingCall> pending;
  if (!check(readGpuBindingModule(artifactBytes, program, plan, "single-source-call-v1", context, pending, error) && pending,
             "readGpuBindingModule")) return 1;

  const auto &id = pending->identity();
  const std::string rightTotalId = "sha256:c6b03719e7decf93073046e91b968d431e63276831f788ccda16039c954fcee3";
  const std::string leftTotalId = [&]() -> std::string {
    for (const auto &g : tsfg::exception::items(tsfg::exception::field(program.hir, "globals"))) {
      if (tsfg::exception::string(tsfg::exception::field(g, "name")) == "leftTotal") {
        return tsfg::exception::string(tsfg::exception::field(g, "id"));
      }
    }
    return "";
  }();
  if (!check(!leftTotalId.empty(), "locate leftTotal global id")) return 1;

  // 1. Negative admission checks: identity / digest mismatch must reject before instance creation.
  {
    std::string err;
    GpuCallIdentity badId = id;
    badId.inputIdentity[7] = (badId.inputIdentity[7] == '0') ? '1' : '0';
    if (!check(!Common20Instance::admit(tbcBytes, badId, err).has_value(), "reject mismatched inputIdentity")) return 1;

    GpuCallIdentity badScope = id;
    badScope.scopeDigest[7] = (badScope.scopeDigest[7] == '0') ? '1' : '0';
    if (!check(!Common20Instance::admit(tbcBytes, badScope, err).has_value(), "reject mismatched scopeDigest")) return 1;

    GpuCallIdentity badPub = id;
    badPub.publishedDigest[7] = (badPub.publishedDigest[7] == '0') ? '1' : '0';
    if (!check(!Common20Instance::admit(tbcBytes, badPub, err).has_value(), "reject mismatched publishedDigest")) return 1;
  }

  // 2. Formal admission & initialization of ONE Common20 instance.
  std::string admitErr;
  auto instance = Common20Instance::admit(tbcBytes, id, admitErr);
  if (!check(instance.has_value(), admitErr.c_str())) return 1;
  if (!check(!instance->readGlobalI32(rightTotalId).has_value(), "uninitialized global unreadable")) return 1;
  if (!check(instance->createExclusiveLease(id, {1, 1}, {}) == nullptr, "uninitialized instance denies lease")) return 1;

  uint64_t initFuelRemaining = 0;
  if (!check(instance->initialize(100, 8, initFuelRemaining), "initialize Common20 right instance")) return 1;
  if (!check(instance->readGlobalI32(leftTotalId) == 0u, "leftTotal initialized to 0")) return 1;
  if (!check(instance->readGlobalI32(rightTotalId) == 0u, "rightTotal initialized to 0")) return 1;

  const GpuSoftwarePaths paths{
      std::wstring(loaderPath.begin(), loaderPath.end()),
      std::wstring(icdPath.begin(), icdPath.end())};
  const std::string i32 = tsfg::exception::i32Id.str();
  constexpr uint64_t timeoutNs = 10'000'000'000ULL;

  // 3. Request 1: right(11), entry fuel=1 -> returns 11, rightTotal=11, leftTotal=0, fuel=0.
  {
    std::optional<uint32_t> retCell;
    auto lease = instance->createExclusiveLease(id, {1, 1}, {{i32, 11u}}, &retCell);
    if (!check(lease != nullptr, "acquire lease for right(11)")) return 1;
    // Exclusive lease check: second simultaneous lease must be denied.
    if (!check(instance->createExclusiveLease(id, {1, 1}, {{i32, 11u}}) == nullptr, "deny concurrent second lease")) return 1;

    auto admitted = GpuSoftwareVulkanCall::prepareSourceInstance(*pending, std::move(lease), {1, 1}, paths, 1, 1);
    auto *call = std::get_if<GpuSoftwareVulkanCall>(&admitted);
    if (!check(call != nullptr, "prepareSourceInstance right(11)")) return 1;
    if (call->report().state != GpuSoftwareState::Prepared) {
      llvm::errs() << "prepare report: stage=" << call->report().stage
                   << " reason=" << call->report().reason
                   << " vkResult=" << call->report().vkResult
                   << " device=" << call->report().deviceName << "\n";
    }
    if (!check(call->report().state == GpuSoftwareState::Prepared, "right(11) prepared on Lavapipe")) return 1;

    auto completion = call->finishSourceRequest(timeoutNs);
    if (!check(completion.device.state == GpuSoftwareState::Completed, "right(11) completed on Lavapipe")) return 1;
    if (!check(completion.writeBack == GpuSoftwareWriteBack::Committed, "right(11) committed writeback")) return 1;
    if (!check(completion.returnBits == 11u && retCell == 11u, "right(11) returned 11")) return 1;
    if (!check(completion.budget.fuelRemaining == 0, "right(11) consumed 1 fuel -> 0")) return 1;
    if (!check(instance->readGlobalI32(rightTotalId) == 11u, "rightTotal updated to 11")) return 1;
    if (!check(instance->readGlobalI32(leftTotalId) == 0u, "leftTotal remained 0")) return 1;
    llvm::outs() << "PASS request 1: right(11) => return=11 rightTotal=11 leftTotal=0 fuel=0 device="
                 << completion.device.deviceName << "\n";
  }

  // 4. Request 2: right(-4), entry fuel=1 -> returns 7, rightTotal=7, leftTotal=0, fuel=0.
  {
    std::optional<uint32_t> retCell;
    const uint32_t neg4 = static_cast<uint32_t>(-4);
    auto lease = instance->createExclusiveLease(id, {1, 1}, {{i32, neg4}}, &retCell);
    if (!check(lease != nullptr, "acquire lease for right(-4)")) return 1;

    auto admitted = GpuSoftwareVulkanCall::prepareSourceInstance(*pending, std::move(lease), {1, 1}, paths, 1, 2);
    auto *call = std::get_if<GpuSoftwareVulkanCall>(&admitted);
    if (!check(call != nullptr, "prepareSourceInstance right(-4)")) return 1;

    auto completion = call->finishSourceRequest(timeoutNs);
    if (!check(completion.device.state == GpuSoftwareState::Completed, "right(-4) completed on Lavapipe")) return 1;
    if (!check(completion.writeBack == GpuSoftwareWriteBack::Committed, "right(-4) committed writeback")) return 1;
    if (!check(completion.returnBits == 7u && retCell == 7u, "right(-4) returned 7")) return 1;
    if (!check(completion.budget.fuelRemaining == 0, "right(-4) consumed 1 fuel -> 0")) return 1;
    if (!check(instance->readGlobalI32(rightTotalId) == 7u, "rightTotal updated to 7")) return 1;
    if (!check(instance->readGlobalI32(leftTotalId) == 0u, "leftTotal remained 0")) return 1;
    llvm::outs() << "PASS request 2: right(-4) => return=7 rightTotal=7 leftTotal=0 fuel=0\n";
  }

  // 5. Request 3: right(5), entry fuel=0 -> r01-t-fuel trap, 0 device submits, 0 writeback, rightTotal=7, leftTotal=0.
  {
    std::optional<uint32_t> retCell;
    auto lease = instance->createExclusiveLease(id, {0, 1}, {{i32, 5u}}, &retCell);
    if (!check(lease != nullptr, "acquire lease for right(5) zero-fuel")) return 1;

    auto admitted = GpuSoftwareVulkanCall::prepareSourceInstance(*pending, std::move(lease), {0, 1}, paths, 1, 3);
    auto *failure = std::get_if<GpuHostFailure>(&admitted);
    if (!check(failure != nullptr, "right(5) with 0 fuel rejected before Vulkan submission")) return 1;
    if (!check(failure->kind == GpuHostFailureKind::Trap, "zero-fuel failure is Trap")) return 1;
    if (!check(failure->code == "r01-t-fuel", "zero-fuel trap code is r01-t-fuel")) return 1;
    if (!check(failure->budget.fuelRemaining == 0, "zero-fuel budget remains 0")) return 1;
    if (!check(!retCell.has_value(), "zero-fuel produced no return value")) return 1;
    if (!check(instance->readGlobalI32(rightTotalId) == 7u, "rightTotal stayed 7 after zero-fuel trap")) return 1;
    if (!check(instance->readGlobalI32(leftTotalId) == 0u, "leftTotal stayed 0 after zero-fuel trap")) return 1;
    llvm::outs() << "PASS request 3: right(5) fuel=0 => trap=" << failure->code
                 << " anchor=" << failure->site.source.sourceId << ":" << failure->site.source.range.start
                 << "-" << failure->site.source.range.end << " rightTotal=7 leftTotal=0\n";
  }

  // 6. Negative budget mismatch check: expectedBudget != lease.remainingBudget() -> zero submits, zero writebacks.
  {
    auto lease = instance->createExclusiveLease(id, {1, 1}, {{i32, 99u}});
    if (!check(lease != nullptr, "acquire lease for budget mismatch check")) return 1;
    auto admitted = GpuSoftwareVulkanCall::prepareSourceInstance(*pending, std::move(lease), {2, 1}, paths, 1, 4);
    auto *failure = std::get_if<GpuHostFailure>(&admitted);
    if (!check(failure != nullptr && failure->code == "core-ir-common-gpu-host-budget", "reject budget mismatch")) return 1;
    if (!check(instance->readGlobalI32(rightTotalId) == 7u, "rightTotal unchanged after budget mismatch")) return 1;
  }

  llvm::outs() << "M39_SOFTWARE_DEVICE_ACCEPTANCE=PASS\n";
  return 0;
}
