// SPDX-License-Identifier: MIT
#pragma once
#include "core-ir/common-program-gpu-lowering.h"
#include "llvm/ADT/ArrayRef.h"
#include <memory>

namespace tsfg::commonProgram {
// The external acceptance runner authenticates these two private files against
// its fixed 39b qualification. No system loader, registry installation or ICD
// fallback is selected by this Interface.
struct GpuSoftwarePaths {std::wstring loaderAbsolute,icdAbsolute;};
enum class GpuSoftwareState {Ready,Prepared,Submitted,Completed,FailedBeforeSubmit,Unfinished,DeviceLost};
enum class GpuSoftwareFailure {None,Input,Capability,Vulkan,Windows};
struct GpuSoftwareOutput {GpuDescriptor descriptor;uint32_t bits=0;};
enum class GpuSoftwareWriteBack {
  Committed, OutputsUnavailable, SubmissionMismatch, BindingMismatch, AlreadyCommitted, SourceRejected
};
// An exclusive lease supplied by the owner of an actual Source instance.
// Keep that instance and its snapshot stable until this lease is destroyed.
class GpuSoftwareSourceLease {
public:
  virtual ~GpuSoftwareSourceLease()=default;
  virtual const GpuCallIdentity &identity() const noexcept=0;
  virtual GpuHostBudget remainingBudget() const noexcept=0;
  // Already evaluated values in Source parameter order, borrowed through preflight.
  virtual llvm::ArrayRef<GpuHostValue> evaluatedArguments() const noexcept=0;
  virtual std::optional<GpuHostValue> readGlobal(llvm::StringRef globalId) const=0;
  // Resolve every writable destination together, including the return cell.
  // They must be distinct and remain writable until the lease is released.
  // The descriptor views are borrowed for this call only.
  virtual bool reserveOutputs(llvm::ArrayRef<const GpuDescriptor *> outputs) noexcept=0;
  // Publish together to this instance, including its return cell. False leaves
  // every destination unchanged. The borrowed output rows expire on return.
  // The caller retains its call handle through the callback.
  virtual bool publish(llvm::ArrayRef<GpuSoftwareOutput> outputs) noexcept=0;
};
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
struct GpuSoftwareSourceCompletion {
  GpuSoftwareReport device;
  GpuHostBudget budget;
  std::optional<GpuSoftwareWriteBack> writeBack;
  std::optional<GpuSoftwareReport> operationError;
  // The i32 bit pattern of this completion's successfully published return.
  std::optional<uint32_t> returnBits{};
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
  static std::variant<GpuSoftwareVulkanCall,GpuHostFailure> prepareSourceInstance(
      const GpuPendingCall &,std::unique_ptr<GpuSoftwareSourceLease>,GpuHostBudget expectedBudget,const GpuSoftwarePaths &,
      uint64_t deviceGeneration,uint64_t submissionId);
  static const GpuSoftwareReport *retainedReport();
  static std::optional<GpuSoftwareVulkanCall> resumeRetained(uint64_t deviceGeneration,uint64_t submissionId);
  static std::optional<GpuSoftwareVulkanCall> resumeRetainedSource(uint64_t deviceGeneration,
      uint64_t submissionId,const GpuCallIdentity &identity);
  GpuSoftwareVulkanCall(GpuSoftwareVulkanCall &&)noexcept;
  GpuSoftwareVulkanCall &operator=(GpuSoftwareVulkanCall &&)noexcept;
  GpuSoftwareVulkanCall(const GpuSoftwareVulkanCall &)=delete;
  GpuSoftwareVulkanCall &operator=(const GpuSoftwareVulkanCall &)=delete;
  ~GpuSoftwareVulkanCall();
  const GpuSoftwareReport &report()const;
  const GpuHostProof &hostProof()const;
  // Inspection only for calls bound to a Source lease.
  const std::vector<GpuSoftwareOutput> &outputs()const;
  // The Host owns the destination cells, in writable descriptor order, for
  // the named submission. A successful publication consumes the writeback.
  GpuSoftwareWriteBack writeBack(uint64_t deviceGeneration,uint64_t submissionId,
                                llvm::MutableArrayRef<GpuSoftwareOutput> destinations);
  // A bound call can publish only to its original lease, including after resume.
  // Source rejection retires the lease and remains the call's writeback result.
  GpuSoftwareWriteBack writeBackSource();
  // Submit a prepared Source request, wait once and publish available outputs.
  // Call again after an unfinished wait to wait on the same submission.
  // Terminal outcomes release the device while keeping the report and outputs.
  // Operation errors and writeback status never replace the device report.
  GpuSoftwareSourceCompletion finishSourceRequest(uint64_t timeoutNanoseconds);
  // A rejected submit or wait returns the operation error. report() keeps
  // the call's last real outcome; the next rejection replaces the operation error.
  const GpuSoftwareReport &submit();
  // Nanoseconds must be positive and below UINT64_MAX. Timeout preserves all
  // in-flight resources and permits another explicit wait, never resubmission.
  // Known completion or device loss retires the device before returning.
  const GpuSoftwareReport &wait(uint64_t timeoutNanoseconds);
private:
  friend struct GpuSoftwareCompletionTest;
  struct Impl;
  static std::unique_ptr<Impl> &retained();
  static std::optional<GpuSoftwareVulkanCall> takeRetained(uint64_t,uint64_t,const GpuCallIdentity *);
  void retainOutstanding();
  explicit GpuSoftwareVulkanCall(std::unique_ptr<Impl>);
  std::unique_ptr<Impl> impl_;
};
// The Host supplies its original evaluated snapshot and semantic budget.
// A preflight failure returns its original Source diagnostic and post-budget.
// A prepared call retains both the proof and the device submission report.
using GpuSoftwareHostAdmission=std::variant<GpuSoftwareVulkanCall,GpuHostFailure>;
// Admit persisted single-source-call-v1 compiler data for the external Host.
// The owning result keeps the rebuilt identities, bindings, and shader.
// No Source state, Host budget, or device execution is admitted here.
std::optional<GpuPendingCall> readGpuSoftwareSourceCall(llvm::StringRef core,
    llvm::StringRef request,llvm::StringRef artifact,Error &);
GpuSoftwareHostAdmission prepareGpuSoftwareHostRequest(
    const GpuPendingCall &,const GpuHostInputs &,GpuHostBudget,const GpuSoftwarePaths &,
    uint64_t deviceGeneration,uint64_t submissionId);
GpuSoftwareHostAdmission prepareGpuSoftwareSourceRequest(
    const GpuPendingCall &,const GpuCallIdentity &,llvm::ArrayRef<GpuHostValue> arguments,
    llvm::ArrayRef<GpuHostGlobalValue> globals,GpuHostBudget,const GpuSoftwarePaths &,
    uint64_t deviceGeneration,uint64_t submissionId);
// Dropping an unfinished call transfers its complete owner to the process's
// single retained slot. retainedReport/resumeRetained keep the original identity
// and same-fence finite wait accessible. That slot blocks another prepare until
// retirement; it never publishes or replays. Process exit leaves OS teardown in
// charge of a still-outstanding slot. Completed/lost/pre-submit calls retire.
// Source-bound calls resume through resumeRetainedSource with their full identity.
} // namespace tsfg::commonProgram
