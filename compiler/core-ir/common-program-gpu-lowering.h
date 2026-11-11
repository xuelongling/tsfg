// SPDX-License-Identifier: MIT
#pragma once
#include "common-program.h"
#include <optional>
#include <variant>

namespace tsfg::commonProgram {
// Caller owns readCore -> createGpuBindingPlan for this same Program/plan.
// Builds verified upstream SPIR-V function/resource IR inside a builtin module.
// Its ordered unresolved obligations describe conditional normal continuations;
// this is never a launchable shader or an execution/failure-domain permit.
// No VCE, addressing/memory model, entry point or dispatch policy is selected.
bool lowerGpuBindingFunctions(Program &,const Json &alreadyVerifiedPlan,
                             mlir::MLIRContext &,Json &out,Error &);
// Explicit compiler profile; no API/device work or execution permit. The sole
// single-source-call-v1 profile targets Vulkan 1.1 / SPIR-V 1.3 with one active
// Source instance. Its generated Host recipe must be fulfilled before use.
// Caller owns the same complete Program/plan verification as the API above.
bool emitGpuBindingModule(Program &,const Json &alreadyVerifiedPlan,
                          llvm::StringRef profile,mlir::MLIRContext &,
                          Json &out,Error &);

enum class GpuModuleProfile {SingleSourceCallV1};
enum class GpuResourceKind {Global,Parameter,Return};
enum class GpuResourceAccess {Read,Write,ReadWrite};
enum class GpuScalarType {I32};
struct GpuSourceRange {std::string sourceId;SourceAnchor range;};
struct GpuSourcePoint {uint32_t block=0,operation=0;};
struct GpuObligationSite {
  uint32_t obligationId=0;std::string functionId;
  GpuSourceRange source;GpuSourcePoint point;
};
// Payload/member layout only, never device-allocation or descriptor-base alignment.
struct GpuScalarBufferLayout {
  uint32_t memberOffset=0,memberBytes=0,memberAlignment=0,blockBytes=0;
};
struct GpuDescriptor {
  GpuResourceKind kind;GpuResourceAccess access;GpuScalarType type;
  std::string id;std::optional<std::string> kernel;
  uint32_t set=0,binding=0;GpuSourceRange source;
};
struct GpuBindingOrigin {uint32_t descriptorIndex=0;};
struct GpuI32ConstantOrigin {uint32_t bits=0;std::string decimal;};
using GpuNumericOrigin=std::variant<GpuBindingOrigin,GpuI32ConstantOrigin>;
// Still pending: Source depth is checked before fuel, not compiler work budget.
struct GpuEntryBudgetStep {
  GpuObligationSite site;uint32_t event=0,activeDepth=0,fuelCost=0;
};
// Still pending: check actual initialization/tag. Undefined requests the original
// operation's trap; other tags remain an unimplemented capability, not a new trap.
struct GpuNumericUseStep {
  GpuObligationSite site;std::string sourceOperator;uint32_t index=0,operand=0;
  GpuNumericOrigin origin;
};
using GpuPendingHostStep=std::variant<GpuEntryBudgetStep,GpuNumericUseStep>;
// Exact i32 operation or computed-value numeric-use relation. Prerequisites
// refer to earlier compiler discharges and pending Host checks.
struct GpuI32Discharge {GpuObligationSite site;std::vector<uint32_t> prerequisites;};
struct GpuCallIdentity {
  std::string inputIdentity,hirDigest,scopeDigest,publishedDigest;
  std::string kernelProofDigest,borrowProofDigest,requestDigest,planDigest;
  std::string wordsDigest,artifactDigest;
};

// Owns only admitted compiler data. Construction grants no Host fulfillment or
// launch authority. A later consumer must preserve the same Source-value snapshot,
// ordered checks, one active call and bound-resource lifetime until completion.
class GpuPendingCall {
public:
  GpuPendingCall(const GpuPendingCall &)=default;
  GpuPendingCall(GpuPendingCall &&)=default;
  GpuPendingCall &operator=(const GpuPendingCall &)=default;
  GpuPendingCall &operator=(GpuPendingCall &&)=default;
  ~GpuPendingCall()=default;
  GpuModuleProfile profile()const{return GpuModuleProfile::SingleSourceCallV1;}
  bool launchAuthorized()const{return false;}
  bool hostPreflightFulfilled()const{return false;}
  const GpuCallIdentity &identity()const{return identity_;}
  const std::string &functionId()const{return functionId_;}
  const std::string &entryPoint()const{return entryPoint_;}
  const GpuScalarBufferLayout &layout()const{return layout_;}
  const std::vector<uint32_t> &words()const{return words_;}
  const std::vector<GpuDescriptor> &descriptors()const{return descriptors_;}
  const std::vector<GpuPendingHostStep> &hostSteps()const{return hostSteps_;}
  const std::vector<GpuI32Discharge> &discharges()const{return discharges_;}
private:
  GpuPendingCall()=default;
  GpuCallIdentity identity_;std::string functionId_,entryPoint_;
  GpuScalarBufferLayout layout_;std::vector<uint32_t> words_;
  std::vector<GpuDescriptor> descriptors_;
  std::vector<GpuPendingHostStep> hostSteps_;std::vector<GpuI32Discharge> discharges_;
  friend bool readGpuBindingModule(llvm::StringRef,Program &,const Json &,
    llvm::StringRef,mlir::MLIRContext &,std::optional<GpuPendingCall> &,Error &);
};
// Unknown input is bounded canonical JSON plus one LF. Caller owns the same
// readCore -> createGpuBindingPlan precondition as emitGpuBindingModule. Rebuild
// and match the entire artifact before projecting owned typed pending data.
// Failure leaves out unchanged; all work consumes Program.remaining, never fuel.
bool readGpuBindingModule(llvm::StringRef bytes,Program &,const Json &alreadyVerifiedPlan,
                          llvm::StringRef profile,mlir::MLIRContext &,
                          std::optional<GpuPendingCall> &out,Error &);

// Source actual TypeId and canonical payload bits, independent of the static
// descriptor view. Absence has zero bits; pure assertions never change its tag.
// Other scalar/absence tags retain their identity for a reached capability
// failure. Only an actual i32 fulfills a numeric use; no conversion is applied.
struct GpuHostValue {std::string actualType;uint64_t bits=0;};
struct GpuHostBindingValue {GpuDescriptor descriptor;GpuHostValue value;};
struct GpuHostInputs {GpuCallIdentity identity;std::vector<GpuHostBindingValue> bindings;};
// One original Source call, with no caller frame in single-source-call-v1.
// Compiler Program.remaining and physical execution budgets are separate.
struct GpuHostBudget {uint64_t fuelRemaining=4097;uint32_t depthLimit=1;};
enum class GpuHostFailureKind {Input,Capability,Trap};
struct GpuHostFailure {
  GpuHostFailureKind kind;std::string code,ruleId;GpuObligationSite site;
  GpuHostBudget budget;
};
class GpuHostProof;
using GpuHostPreflightResult=std::variant<GpuHostProof,GpuHostFailure>;
// Owns the admitted call and its actual input snapshot. Only successful ordered
// Host checks construct this proof. It grants no Runtime/device/launch authority.
class GpuHostProof {
public:
  GpuHostProof(const GpuHostProof &)=default;
  GpuHostProof(GpuHostProof &&)=default;
  GpuHostProof &operator=(const GpuHostProof &)=default;
  GpuHostProof &operator=(GpuHostProof &&)=default;
  bool hostPreflightFulfilled()const{return true;}
  bool launchAuthorized()const{return false;}
  bool deviceExecutionAuthorized()const{return false;}
  const GpuPendingCall &call()const{return call_;}
  const std::vector<GpuHostBindingValue> &bindings()const{return bindings_;}
  const GpuHostBudget &budgetBefore()const{return before_;}
  const GpuHostBudget &budgetAfter()const{return after_;}
private:
  GpuHostProof(const GpuPendingCall &call,const GpuHostInputs &inputs,
               GpuHostBudget before,GpuHostBudget after)
    :call_(call),bindings_(inputs.bindings),before_(before),after_(after){}
  GpuPendingCall call_;std::vector<GpuHostBindingValue> bindings_;
  GpuHostBudget before_,after_;
  friend GpuHostPreflightResult preflightGpuBindingCall(const GpuPendingCall &,
    const GpuHostInputs &,GpuHostBudget);
};
// Validate complete call/resource identities before Source events. Bindings are
// exactly the read/read-write descriptors in descriptor order. On valid inputs,
// process the owned recipe in order: depth, fuel, then each numeric use. Failure
// retains the reached original operation and the Source fuel post-state.
GpuHostPreflightResult preflightGpuBindingCall(const GpuPendingCall &,
                                              const GpuHostInputs &,GpuHostBudget);
} // namespace tsfg::commonProgram
