// SPDX-License-Identifier: MIT
// External acceptance protocol. Invoke only after private-file qualification.
#include "gpu-software-vulkan-consumer.h"
#include "core-ir/dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVDialect.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <limits>

namespace {
using namespace tsfg::commonProgram;
bool read(llvm::StringRef root,llvm::StringRef name,std::string &out){
  auto file=llvm::MemoryBuffer::getFile(root.str()+"/"+name.str());
  if(!file||(*file)->getBufferSize()>1048576)return false;out=(*file)->getBuffer().str();return true;
}
Json source(const GpuSourceRange &row){return Object{{"sourceId",row.sourceId},{"start",row.range.start},{"end",row.range.end}};}
Json identity(const GpuCallIdentity &row){return Object{{"inputIdentity",row.inputIdentity},{"hirDigest",row.hirDigest},
  {"scopeDigest",row.scopeDigest},{"publishedDigest",row.publishedDigest},{"kernelProofDigest",row.kernelProofDigest},
  {"borrowProofDigest",row.borrowProofDigest},{"requestDigest",row.requestDigest},{"planDigest",row.planDigest},
  {"wordsDigest",row.wordsDigest},{"artifactDigest",row.artifactDigest}};}
Json descriptor(const GpuDescriptor &row){return Object{{"kind",row.kind==GpuResourceKind::Global?"global":row.kind==GpuResourceKind::Parameter?"parameter":"return"},
  {"access",row.access==GpuResourceAccess::Read?"read":row.access==GpuResourceAccess::Write?"write":"read-write"},
  {"type","i32"},{"id",row.id},{"kernel",row.kernel?Json(*row.kernel):Json(nullptr)},
  {"set",row.set},{"binding",row.binding},{"source",source(row.source)}};}
Json bindings(const GpuHostProof &proof){Array rows;for(const auto &row:proof.bindings())
  rows.push_back(Object{{"descriptor",descriptor(row.descriptor)},{"actualType",row.value.actualType},
    {"bits",std::to_string(row.value.bits)}});return rows;}
Json report(const GpuSoftwareReport &row){
  const char *state="Ready";switch(row.state){
    case GpuSoftwareState::Ready:break;case GpuSoftwareState::Prepared:state="Prepared";break;
    case GpuSoftwareState::Submitted:state="Submitted";break;case GpuSoftwareState::Completed:state="Completed";break;
    case GpuSoftwareState::FailedBeforeSubmit:state="FailedBeforeSubmit";break;
    case GpuSoftwareState::Unfinished:state="Unfinished";break;case GpuSoftwareState::DeviceLost:state="DeviceLost";break;}
  const char *failure="None";switch(row.failure){case GpuSoftwareFailure::None:break;
    case GpuSoftwareFailure::Input:failure="Input";break;case GpuSoftwareFailure::Capability:failure="Capability";break;
    case GpuSoftwareFailure::Vulkan:failure="Vulkan";break;case GpuSoftwareFailure::Windows:failure="Windows";break;}
  Array resources;for(const auto &value:row.resources)resources.push_back(descriptor(value));
  return Object{{"state",state},{"failure",failure},{"stage",row.stage},{"reason",row.reason},
    {"functionId",row.functionId},{"identity",identity(row.identity)},{"source",source(row.source)},
    {"deviceGeneration",std::to_string(row.deviceGeneration)},{"submissionId",std::to_string(row.submissionId)},
    {"vkResult",row.vkResult?Json(*row.vkResult):Json(nullptr)},
    {"windowsError",row.windowsError?Json(*row.windowsError):Json(nullptr)},
    {"resourceIndex",row.resourceIndex?Json(*row.resourceIndex):Json(nullptr)},
    {"submitted",row.submitted},{"completionKnown",row.completionKnown},{"outputsAvailable",row.outputsAvailable},
    {"apiVersion",row.apiVersion},{"driverVersion",row.driverVersion},{"vendorId",row.vendorId},
    {"deviceId",row.deviceId},{"deviceName",row.deviceName},{"resources",std::move(resources)}};
}
int print(Json value,int exit){if(llvm::sys::ChangeStdoutToBinary())return 2;
  llvm::outs()<<canonical(value)<<'\n';llvm::outs().flush();return llvm::outs().has_error()?2:exit;}
}
int main(int argc,char **argv){
  // The default protocol stays closed and performs no compiler/device work.
  if(argc==1)return print(Object{{"family","tsfg.gpu-software-vulkan-acceptance"},{"version",1},
    {"consumerPrepareAttempted",false},{"device","NOT_RUN"},{"sourceCallExecution","NOT_RUN"},
    {"cpuVmExecution",false},{"driverJIT","NOT_RUN"},
    {"numerical","NOT_RUN"},{"recovery","NOT_RUN"},{"timeout","NOT_OBSERVED"}},0);
  if(argc!=9)return 2;
  uint64_t bits=0,generation=0,submission=0,timeout=0,waitLimit=0;
  if(llvm::StringRef(argv[4]).getAsInteger(10,bits)||bits>UINT32_MAX||
     llvm::StringRef(argv[5]).getAsInteger(10,generation)||!generation||
     llvm::StringRef(argv[6]).getAsInteger(10,submission)||!submission||
     llvm::StringRef(argv[7]).getAsInteger(10,timeout)||!timeout||timeout==UINT64_MAX||
     llvm::StringRef(argv[8]).getAsInteger(10,waitLimit)||!waitLimit||waitLimit>1024)return 2;
  // Qualified test paths are absolute ASCII E paths, supplied by the controller.
  for(int index=1;index<=3;++index){llvm::StringRef value(argv[index]);
    if(!value.starts_with("E:/")&&!value.starts_with("E:\\"))return 2;
    for(unsigned char byte:value)if(byte<32||byte>126)return 2;}
  std::string coreBytes,requestBytes,planBytes;
  if(!read(argv[1],"common-program.mlir",coreBytes)||!read(argv[1],"gpu-binding-request.json",requestBytes)||
     !read(argv[1],"gpu-binding-plan.json",planBytes))return 2;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect,mlir::spirv::SPIRVDialect>();
  mlir::MLIRContext context(registry);context.disableMultithreading();Program program;Error error;
  std::string compilerStage="read-core";
  Json request=nullptr,savedPlan=nullptr,plan=nullptr,artifact=nullptr;
  const auto failed=[&](){return print(Object{{"family","tsfg.gpu-software-vulkan-acceptance"},{"version",1},
    {"device","NOT_RUN"},{"numerical","NOT_RUN"},{"recovery","NOT_RUN"},
    {"compilerError",Object{{"stage",compilerStage},{"code",error.code},{"message",error.message},{"path",error.path},
      {"start",error.range.start},{"end",error.range.end}}}},3);};
  {auto core=mlir::parseSourceString<mlir::ModuleOp>(coreBytes,&context);
   if(!core){error={"gpu-software-acceptance-core-parse","Core fixture failed to parse","common-program.mlir",{0,uint32_t(coreBytes.size())}};return failed();}
   if(!readCore(*core,program,error))return failed();}
  compilerStage="read-request";
  if(requestBytes.size()<2||requestBytes.back()!='\n'){
    error={"gpu-software-acceptance-json-framing","request fixture requires nonempty JSON and final LF",
      "gpu-binding-request.json",{0,uint32_t(requestBytes.size())}};return failed();}
  if(!readJson(llvm::StringRef(requestBytes).drop_back(),request,program,error))return failed();
  compilerStage="read-saved-plan";
  if(planBytes.size()<2||planBytes.back()!='\n'){
    error={"gpu-software-acceptance-json-framing","plan fixture requires nonempty JSON and final LF",
      "gpu-binding-plan.json",{0,uint32_t(planBytes.size())}};return failed();}
  if(!readJson(llvm::StringRef(planBytes).drop_back(),savedPlan,program,error))return failed();
  compilerStage="create-complete-plan";
  if(!createGpuBindingPlan(program,request,plan,error))return failed();
  compilerStage="match-saved-plan";
  if(!same(plan,savedPlan)){
    error={"gpu-software-acceptance-plan-mismatch","saved plan differs from the complete Program binding plan",
      "gpu-binding-plan.json",{0,uint32_t(planBytes.size())}};return failed();}
  compilerStage="emit-module";
  if(!emitGpuBindingModule(program,plan,"single-source-call-v1",context,artifact,error))return failed();
  auto artifactBytes=canonical(artifact)+"\n";std::optional<GpuPendingCall> pending;
  compilerStage="read-owned-module";
  if(!readGpuBindingModule(artifactBytes,program,plan,"single-source-call-v1",context,pending,error)||!pending)return failed();
  GpuHostInputs supplied{pending->identity(),{}};
  for(const auto &row:pending->descriptors())if(row.access!=GpuResourceAccess::Write)
    supplied.bindings.push_back({row,{tsfg::exception::i32Id.str(),bits}});
  std::optional<GpuHostPreflightResult> preflight=preflightGpuBindingCall(*pending,supplied,{2,1});
  auto *proof=std::get_if<GpuHostProof>(&*preflight);
  if(!proof){const auto &failure=std::get<GpuHostFailure>(*preflight);
    return print(Object{{"family","tsfg.gpu-software-vulkan-acceptance"},{"version",1},{"device","NOT_RUN"},
      {"numerical","NOT_RUN"},{"recovery","NOT_RUN"},{"hostFailure",Object{{"code",failure.code},{"ruleId",failure.ruleId},
      {"source",source(failure.site.source)},{"functionId",failure.site.functionId},
      {"fuelRemaining",std::to_string(failure.budget.fuelRemaining)},{"depthLimit",failure.budget.depthLimit}}}},3);}
  if(proof->budgetBefore().fuelRemaining!=2||proof->budgetAfter().fuelRemaining!=1)return 3;
  const auto originalBindings=bindings(*proof);
  const auto originalIdentity=identity(proof->call().identity());const auto function=proof->call().functionId();
  const auto originalSource=source(std::get<GpuEntryBudgetStep>(proof->call().hostSteps().front()).site.source);
  Json output=Object{{"family","tsfg.gpu-software-vulkan-acceptance"},{"version",1},
    {"coreSHA",digest(coreBytes)},{"requestSHA",digest(requestBytes)},{"planSHA",digest(planBytes)},
    {"functionId",function},{"identity",originalIdentity},{"source",originalSource},{"inputs",originalBindings},
    {"emittedModule",artifact},
    {"fuelBefore","2"},{"fuelAfter","1"},{"depthLimit",1},{"timeout","NOT_OBSERVED"},
    {"recovery","NOT_RUN"},{"numerical","NOT_RUN"},{"consumerPrepareAttempted",true},
    {"cpuVmExecution",false},{"driverJIT","NOT_INSTRUMENTED"}};
  pending.reset();supplied={};program=Program{};request=nullptr;savedPlan=nullptr;plan=nullptr;artifact=nullptr;
  coreBytes.clear();requestBytes.clear();planBytes.clear();artifactBytes.clear();
  GpuSoftwarePaths paths{std::wstring(argv[2],argv[2]+std::char_traits<char>::length(argv[2])),
    std::wstring(argv[3],argv[3]+std::char_traits<char>::length(argv[3]))};
  std::optional<GpuSoftwareVulkanCall> call;
  call.emplace(GpuSoftwareVulkanCall::prepare(*proof,paths,generation,submission));
  preflight.reset();
  const auto &owned=call->hostProof();
  (*output.getAsObject())["ownedAfterInputRelease"]=same(identity(owned.call().identity()),originalIdentity)&&
    same(bindings(owned),originalBindings)&&owned.budgetBefore().fuelRemaining==2&&owned.budgetAfter().fuelRemaining==1;
  Array transitions;transitions.push_back(report(call->report()));
  if(call->report().state==GpuSoftwareState::Prepared){call->submit();transitions.push_back(report(call->report()));}
  bool timeoutObserved=false,resumed=false;
  for(uint64_t count=0;count<waitLimit&&call->report().submitted&&!call->report().completionKnown;++count){
    call->wait(timeout);transitions.push_back(report(call->report()));
    const auto &current=call->report();
    if(current.state==GpuSoftwareState::Unfinished&&current.vkResult&&*current.vkResult==2){
      timeoutObserved=true;
      if(count+1<waitLimit){call.reset();const auto *retained=GpuSoftwareVulkanCall::retainedReport();
        if(!retained||retained->deviceGeneration!=generation||retained->submissionId!=submission||
           !same(identity(retained->identity),originalIdentity))return 3;
        call=GpuSoftwareVulkanCall::resumeRetained(generation,submission);if(!call)return 3;resumed=true;}
    }else break;
  }
  const auto &final=call->report();Array values;
  if(final.state==GpuSoftwareState::Completed&&final.completionKnown&&final.outputsAvailable)
    for(const auto &row:call->outputs())values.push_back(Object{{"descriptor",descriptor(row.descriptor)},
      {"bits",std::to_string(row.bits)},{"signed",std::to_string(row.bits<=INT32_MAX?int64_t(row.bits):int64_t(row.bits)-4294967296LL)}});
  (*output.getAsObject())["final"]=report(final);(*output.getAsObject())["transitions"]=std::move(transitions);
  (*output.getAsObject())["outputs"]=std::move(values);
  const bool sourceCompleted=final.state==GpuSoftwareState::Completed&&final.completionKnown;
  (*output.getAsObject())["sourceCallExecution"]=sourceCompleted?"COMPLETED":final.submitted?"SUBMITTED_COMPLETION_UNKNOWN":"NOT_OBSERVED";
  (*output.getAsObject())["device"]=sourceCompleted?"COMPLETED":final.state==GpuSoftwareState::DeviceLost?"DEVICE_LOST":
    final.submitted?"SUBMITTED_COMPLETION_UNKNOWN":final.state==GpuSoftwareState::Prepared?"PREPARED_NOT_SUBMITTED":"NOT_OBSERVED";
  (*output.getAsObject())["timeout"]=timeoutObserved?"OBSERVED":"NOT_OBSERVED";
  (*output.getAsObject())["retainedResumeObserved"]=resumed;
  (*output.getAsObject())["recovery"]=!resumed?"NOT_RUN":sourceCompleted?"COMPLETED":
    final.state==GpuSoftwareState::DeviceLost?"DEVICE_LOST":final.submitted&&!final.completionKnown?"RETAINED":
    final.failure!=GpuSoftwareFailure::None?"FAILED":"NOT_OBSERVED";
  const bool completed=final.state==GpuSoftwareState::Completed&&final.completionKnown&&final.outputsAvailable;
  (*output.getAsObject())["numerical"]=completed?"AVAILABLE":"NOT_RUN";
  return print(std::move(output),completed?0:4);
}
