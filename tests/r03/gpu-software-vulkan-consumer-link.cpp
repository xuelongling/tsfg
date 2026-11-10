// SPDX-License-Identifier: MIT
// Compile/link-only ABI fixture. Neither this executable nor its exports run.
#include "gpu-software-vulkan-consumer.h"
#include <type_traits>
#include <utility>

using namespace tsfg::commonProgram;
using Prepare = GpuSoftwareVulkanCall (*)(const GpuHostProof &,const GpuSoftwarePaths &,uint64_t,uint64_t);
using ReadReport = const GpuSoftwareReport &(GpuSoftwareVulkanCall::*)() const;
using ReadProof = const GpuHostProof &(GpuSoftwareVulkanCall::*)() const;
using ReadOutputs = const std::vector<GpuSoftwareOutput> &(GpuSoftwareVulkanCall::*)() const;
using Submit = const GpuSoftwareReport &(GpuSoftwareVulkanCall::*)();
using Wait = const GpuSoftwareReport &(GpuSoftwareVulkanCall::*)(uint64_t);
using RetainedReport = const GpuSoftwareReport *(*)();
using ResumeRetained = std::optional<GpuSoftwareVulkanCall> (*)(uint64_t,uint64_t);

static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::prepare),Prepare>);
static_assert(!std::is_invocable_v<Prepare,const GpuPendingCall &,const GpuSoftwarePaths &,uint64_t,uint64_t>);
static_assert(!std::is_invocable_v<Prepare,const GpuHostInputs &,const GpuSoftwarePaths &,uint64_t,uint64_t>);
static_assert(!std::is_invocable_v<Prepare,const GpuHostFailure &,const GpuSoftwarePaths &,uint64_t,uint64_t>);
static_assert(!std::is_default_constructible_v<GpuHostProof> && !std::is_aggregate_v<GpuHostProof>);
static_assert(!std::is_default_constructible_v<GpuSoftwareVulkanCall>);
static_assert(!std::is_copy_constructible_v<GpuSoftwareVulkanCall> && !std::is_copy_assignable_v<GpuSoftwareVulkanCall>);
static_assert(std::is_nothrow_move_constructible_v<GpuSoftwareVulkanCall> && std::is_nothrow_move_assignable_v<GpuSoftwareVulkanCall>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::report),ReadReport>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::hostProof),ReadProof>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::outputs),ReadOutputs>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::submit),Submit>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::wait),Wait>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::retainedReport),RetainedReport>);
static_assert(std::is_same_v<decltype(&GpuSoftwareVulkanCall::resumeRetained),ResumeRetained>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::vkResult),std::optional<int32_t>>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::windowsError),std::optional<uint32_t>>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::deviceGeneration),uint64_t>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::submissionId),uint64_t>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::identity),GpuCallIdentity>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::source),GpuSourceRange>);
static_assert(std::is_same_v<decltype(GpuSoftwareReport::resources),std::vector<GpuDescriptor>>);
static_assert(!std::is_same_v<GpuSoftwareFailure,GpuHostFailureKind>);

struct SoftwareVulkanInterface {
  Prepare prepare;
  ReadReport report;
  ReadProof hostProof;
  ReadOutputs outputs;
  Submit submit;
  Wait wait;
  RetainedReport retainedReport;
  ResumeRetained resumeRetained;
};

// Exported constant-initialized addresses keep every implementation symbol in
// the actual PE without calling prepare, submit, wait or a getter.
extern "C" __declspec(dllexport) SoftwareVulkanInterface tsfg_gpu_software_interface = {
  &GpuSoftwareVulkanCall::prepare,&GpuSoftwareVulkanCall::report,&GpuSoftwareVulkanCall::hostProof,
  &GpuSoftwareVulkanCall::outputs,&GpuSoftwareVulkanCall::submit,&GpuSoftwareVulkanCall::wait,
  &GpuSoftwareVulkanCall::retainedReport,&GpuSoftwareVulkanCall::resumeRetained
};

// This never-invoked link entry retains move/destruction definitions.
extern "C" __declspec(dllexport) void tsfg_gpu_software_owned_link(GpuSoftwareVulkanCall &from,GpuSoftwareVulkanCall &to) {
  GpuSoftwareVulkanCall moved(std::move(from));
  to=std::move(moved);
}

int main() { return 0; }
