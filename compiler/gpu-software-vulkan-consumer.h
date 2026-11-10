// SPDX-License-Identifier: MIT
#pragma once
#include "core-ir/common-program-gpu-lowering.h"
#include <memory>

namespace tsfg::commonProgram {
// The external acceptance runner authenticates these two private files against
// its fixed 39b qualification. No system loader, registry installation or ICD
// fallback is selected by this Interface.
struct GpuSoftwarePaths {std::wstring loaderAbsolute,icdAbsolute;};
enum class GpuSoftwareState {Ready,Prepared,Submitted,Completed,FailedBeforeSubmit,Unfinished,DeviceLost};
enum class GpuSoftwareFailure {None,Input,Capability,Vulkan,Windows};
struct GpuSoftwareOutput {GpuDescriptor descriptor;uint32_t bits=0;};
struct GpuSoftwareReport {
  GpuSoftwareState state=GpuSoftwareState::Ready;
  GpuSoftwareFailure failure=GpuSoftwareFailure::None;
  std::string stage,reason,functionId;
  GpuCallIdentity identity;
  GpuSourceRange source;
  uint64_t deviceGeneration=0,submissionId=0;
  std::optional<int32_t> vkResult;
  std::optional<uint32_t> windowsError,resourceIndex;
  uint32_t apiVersion=0,driverVersion=0,vendorId=0,deviceId=0;
  std::string deviceName;
  bool submitted=false,completionKnown=false,outputsAvailable=false;
  std::vector<GpuDescriptor> resources;
};

// Permanent external software-device consumer, outside the product Runtime.
// prepare/submit/wait invoke the fixed Windows/Vulkan implementation and require
// a separately qualified execution environment. Construction of GpuHostProof
// alone grants none of that execution authority. All methods use one owner
// thread; one instance owns the process's temporary private-loader environment.
class GpuSoftwareVulkanCall {
public:
  static GpuSoftwareVulkanCall prepare(const GpuHostProof &,const GpuSoftwarePaths &,
                                     uint64_t deviceGeneration,uint64_t submissionId);
  static const GpuSoftwareReport *retainedReport();
  static std::optional<GpuSoftwareVulkanCall> resumeRetained(uint64_t deviceGeneration,uint64_t submissionId);
  GpuSoftwareVulkanCall(GpuSoftwareVulkanCall &&)noexcept;
  GpuSoftwareVulkanCall &operator=(GpuSoftwareVulkanCall &&)noexcept;
  GpuSoftwareVulkanCall(const GpuSoftwareVulkanCall &)=delete;
  GpuSoftwareVulkanCall &operator=(const GpuSoftwareVulkanCall &)=delete;
  ~GpuSoftwareVulkanCall();
  const GpuSoftwareReport &report()const;
  const GpuHostProof &hostProof()const;
  const std::vector<GpuSoftwareOutput> &outputs()const;
  const GpuSoftwareReport &submit();
  // Nanoseconds must be positive and below UINT64_MAX. Timeout preserves all
  // in-flight resources and permits another explicit wait, never resubmission.
  const GpuSoftwareReport &wait(uint64_t timeoutNanoseconds);
private:
  struct Impl;
  static std::unique_ptr<Impl> &retained();
  void retainOutstanding();
  explicit GpuSoftwareVulkanCall(std::unique_ptr<Impl>);
  std::unique_ptr<Impl> impl_;
};
// Dropping an unfinished call transfers its complete owner to the process's
// single retained slot. retainedReport/resumeRetained keep the original identity
// and same-fence finite wait accessible. That slot blocks another prepare until
// retirement; it never publishes or replays. Process exit leaves OS teardown in
// charge of a still-outstanding slot. Completed/lost/pre-submit calls retire.
} // namespace tsfg::commonProgram
