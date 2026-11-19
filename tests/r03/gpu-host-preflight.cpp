// SPDX-License-Identifier: MIT
// Genuine compiler data -> complete Core/plan -> owned reader -> Host checks.
#include "common-program-gpu-lowering.h"
#ifdef TSFG_GPU_SOFTWARE_HOST_CHECK
#include "gpu-software-vulkan-consumer.h"
#endif
#include "dialect.h"
#include "mlir/Dialect/ControlFlow/IR/ControlFlowOps.h"
#include "mlir/Dialect/SPIRV/IR/SPIRVDialect.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Parser/Parser.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Program.h"
#include "llvm/Support/raw_ostream.h"
#include <algorithm>
#include <type_traits>

namespace {
using namespace tsfg::commonProgram;
using tsfg::exception::field;using tsfg::exception::items;using tsfg::exception::string;
bool check(bool condition,llvm::StringRef message){
  if(!condition)llvm::errs()<<"Host preflight check failed: "<<message<<'\n';return condition;
}
bool read(llvm::StringRef root,llvm::StringRef name,std::string &out){
  auto file=llvm::MemoryBuffer::getFile(root.str()+"/"+name.str());
  if(!file)return false;out=(*file)->getBuffer().str();return out.size()<=1048576;
}
Json source(const GpuSourceRange &row){return Object{{"sourceId",row.sourceId},{"start",row.range.start},{"end",row.range.end}};}
Json site(const GpuObligationSite &row){return Object{{"obligationId",row.obligationId},{"functionId",row.functionId},
  {"source",source(row.source)},{"point",Object{{"block",row.point.block},{"operation",row.point.operation}}}};}
bool sameSite(const GpuObligationSite &a,const GpuObligationSite &b){return same(site(a),site(b));}
bool checkUnwrittenGlobal(Program &program,Json plan,mlir::MLIRContext &context){
  auto &bindings=*plan.getAsObject()->getArray("bindings");
  for(const auto &global:items(field(program.hir,"globals"))){
    const auto id=string(field(global,"id"));
    if(std::any_of(bindings.begin(),bindings.end(),[&](const Json &row){return field(row,"id").getAsString()==id;}))
      continue;
    const auto &range=field(global,"range");
    // Isolate the executable lowerer. The extra permission models a fixed
    // upper that allows a write the selected body does not use.
    bindings.push_back(Object{{"kind","global"},{"id",id},{"kernel",nullptr},{"set",1},{"binding",0},
      {"access","write"},{"type","i32"},{"source",Object{{"sourceId",field(global,"sourcePath")},
        {"start",field(range,"start")},{"end",field(range,"end")}}}});
    Error error;Json artifact=nullptr;
    const bool accepted=emitGpuBindingModule(program,plan,"single-source-call-v1",context,artifact,error);
    const auto &source=field(items(field(plan,"kernels")).front(),"source");
    return check(!accepted&&artifact.getAsNull()&&error.code=="core-ir-common-gpu-lowering-capability"&&
      error.message=="single-call write-only global has no store on the normal path"&&
      error.path==field(source,"sourceId").getAsString()&&error.range.start==field(source,"start").getAsInteger()&&
      error.range.end==field(source,"end").getAsInteger(),"unwritten write-only buffer must never reach publication");
  }
  return check(false,"selected fixture needs a global outside the selected body's binding plan");
}
#ifndef TSFG_GPU_PREFLIGHT_BASELINE
Json failure(const GpuHostFailure &row){return Object{{"kind",row.kind==GpuHostFailureKind::Trap?"trap":row.kind==GpuHostFailureKind::Input?"input":"capability"},
  {"code",row.code},{"ruleId",row.ruleId},{"site",site(row.site)},{"fuelRemaining",std::to_string(row.budget.fuelRemaining)},
  {"depthLimit",row.budget.depthLimit}};}
Json inputs(const std::vector<GpuHostBindingValue> &rows){Array out;for(const auto &row:rows)
  out.push_back(Object{{"id",row.descriptor.id},{"binding",row.descriptor.binding},{"actualType",row.value.actualType},{"bits",std::to_string(row.value.bits)}});return out;}
static_assert(!std::is_default_constructible_v<GpuHostProof>);
static_assert(!std::is_aggregate_v<GpuHostProof>);
static_assert(!std::is_constructible_v<GpuHostProof,const GpuPendingCall &,const GpuHostInputs &,GpuHostBudget,GpuHostBudget>);

bool checkSourceArguments(const GpuPendingCall &call){
  const auto &descriptors=call.descriptors();
  if(!check(descriptors.size()==3&&descriptors[0].kind==GpuResourceKind::Global&&
            descriptors[1].kind==GpuResourceKind::Parameter&&descriptors[2].kind==GpuResourceKind::Return&&
            call.argumentBindings()==std::vector<uint32_t>{1},"fixture has a global before the argument"))return false;
  const auto i32=tsfg::exception::i32Id.str();
  std::vector<GpuHostValue> arguments{{i32,0xfffffff9u}};
  std::vector<GpuHostGlobalValue> globals{{descriptors[0].id,{i32,23}}};
  const GpuHostBudget budget{7,3};
  auto actual=preflightGpuSourceCall(call,call.identity(),arguments,globals,budget);
  const auto *proof=std::get_if<GpuHostProof>(&actual);
  arguments[0].bits=1;globals[0].value.bits=2;
  if(!check(proof&&proof->bindings().size()==2&&proof->bindings()[0].value.bits==23&&
            proof->bindings()[1].value.bits==0xfffffff9u&&proof->budgetAfter().fuelRemaining==6&&
            proof->budgetAfter().depthLimit==3,"copy the two actual values into their original bindings"))return false;

  auto identity=call.identity();
  identity.requestDigest.clear();
  const auto rejected=[&](const GpuCallIdentity &id,llvm::ArrayRef<GpuHostValue> positional,
                          llvm::ArrayRef<GpuHostGlobalValue> snapshot,llvm::StringRef code){
    const auto result=preflightGpuSourceCall(call,id,positional,snapshot,budget);
    const auto *failure=std::get_if<GpuHostFailure>(&result);
    return check(failure&&failure->kind==GpuHostFailureKind::Input&&failure->code==code&&
                 failure->site.functionId==call.functionId()&&failure->budget.fuelRemaining==7,
                 "bad Source input fails before spending fuel");
  };
  if(!rejected(identity,arguments,globals,"core-ir-common-gpu-host-context")||
     !rejected(call.identity(),{},globals,"core-ir-common-gpu-host-arguments")||
     !rejected(call.identity(),arguments,{},"core-ir-common-gpu-host-globals"))return false;
  globals[0].globalId=descriptors[1].id;
  return rejected(call.identity(),arguments,globals,"core-ir-common-gpu-host-globals");
}
#ifdef TSFG_GPU_SOFTWARE_HOST_CHECK
struct SourceLeaseObservation {size_t reads=0,reservations=0,publications=0,destructions=0;};
class ObservedSourceLease final : public GpuSoftwareSourceLease {
  GpuCallIdentity deviceIdentity;
  std::string globalId;
  std::string returnId;
  SourceLeaseObservation &observed;
public:
  ObservedSourceLease(GpuCallIdentity identity,llvm::StringRef global,llvm::StringRef result,
                      SourceLeaseObservation &observation)
      :deviceIdentity(std::move(identity)),globalId(global.str()),returnId(result.str()),observed(observation){}
  ~ObservedSourceLease() override{++observed.destructions;}
  const GpuCallIdentity &identity() const noexcept override{return deviceIdentity;}
  std::optional<GpuHostValue> readGlobal(llvm::StringRef id) const override {
    ++observed.reads;
    if(id!=globalId)return std::nullopt;
    return GpuHostValue{tsfg::exception::i32Id.str(),23};
  }
  bool reserveOutputs(llvm::ArrayRef<const GpuDescriptor *> outputs) noexcept override {
    ++observed.reservations;
    return outputs.size()==2&&outputs[0]->kind==GpuResourceKind::Global&&
      outputs[0]->access==GpuResourceAccess::ReadWrite&&outputs[0]->id==globalId&&
      outputs[1]->kind==GpuResourceKind::Return&&outputs[1]->access==GpuResourceAccess::Write&&
      outputs[1]->id==returnId;
  }
  bool publish(llvm::ArrayRef<GpuSoftwareOutput>) noexcept override {
    ++observed.publications;
    return false;
  }
};
bool checkBoundSourceInstance(const GpuPendingCall &call){
  const auto &descriptors=call.descriptors();
  if(!check(descriptors.size()==3&&descriptors[0].kind==GpuResourceKind::Global&&
            call.argumentBindings()==std::vector<uint32_t>{1},"fixture has one global and one argument"))return false;
  const GpuHostValue arguments[]={{tsfg::exception::i32Id.str(),11}};
  const GpuHostBudget budget{7,3};
  const auto rejected=[&](const GpuCallIdentity &identity,llvm::StringRef global,llvm::StringRef resultId,
                          llvm::ArrayRef<GpuHostValue> values,llvm::StringRef code,size_t reads,size_t reservations){
    SourceLeaseObservation observed;
    auto lease=std::make_unique<ObservedSourceLease>(identity,global,resultId,observed);
    auto result=GpuSoftwareVulkanCall::prepareSourceInstance(call,values,std::move(lease),budget,{},8,9);
    const auto *failure=std::get_if<GpuHostFailure>(&result);
    return check(failure&&failure->kind==GpuHostFailureKind::Input&&failure->code==code&&
                 failure->site.functionId==call.functionId()&&failure->budget.fuelRemaining==7&&
                 failure->budget.depthLimit==3&&observed.reads==reads&&observed.reservations==reservations&&
                 observed.publications==0&&observed.destructions==1,
                 "rejected instance releases its lease without publishing");
  };
  auto wrongIdentity=call.identity();
  wrongIdentity.artifactDigest.clear();
  const auto &globalId=descriptors[0].id;
  const auto &returnId=descriptors[2].id;
  if(!rejected(wrongIdentity,globalId,returnId,arguments,"core-ir-common-gpu-host-context",0,0)||
     !rejected(call.identity(),globalId,returnId,{},"core-ir-common-gpu-host-arguments",0,0)||
     !rejected(call.identity(),"",returnId,arguments,"core-ir-common-gpu-host-globals",1,0)||
     !rejected(call.identity(),globalId,"",arguments,"core-ir-common-gpu-host-outputs",1,1))return false;

  SourceLeaseObservation exhausted;
  auto missingReturn=std::make_unique<ObservedSourceLease>(call.identity(),globalId,"",exhausted);
  auto trapResult=GpuSoftwareVulkanCall::prepareSourceInstance(call,arguments,std::move(missingReturn),{0,3},{},8,9);
  const auto *trap=std::get_if<GpuHostFailure>(&trapResult);
  if(!check(trap&&trap->kind==GpuHostFailureKind::Trap&&trap->code=="r01-t-fuel"&&
            sameSite(trap->site,std::get<GpuEntryBudgetStep>(call.hostSteps().front()).site)&&
            trap->budget.fuelRemaining==0&&trap->budget.depthLimit==3&&exhausted.reservations==0&&
            exhausted.publications==0&&exhausted.destructions==1,"preserve the original Source fuel failure"))return false;

  SourceLeaseObservation observed;
  auto lease=std::make_unique<ObservedSourceLease>(call.identity(),globalId,returnId,observed);
  // An empty configuration fails before looking up Vulkan.
  auto result=GpuSoftwareVulkanCall::prepareSourceInstance(call,arguments,std::move(lease),budget,{},8,9);
  auto *device=std::get_if<GpuSoftwareVulkanCall>(&result);
  if(!check(device&&device->report().stage=="configuration"&&device->report().identity==call.identity()&&
            observed.reads==1&&observed.reservations==1&&observed.destructions==1,
            "read the input and reserve the output bindings before releasing on configuration failure"))return false;
  const auto &proof=device->hostProof();
  return check(proof.bindings().size()==2&&proof.bindings()[0].value.bits==23&&proof.bindings()[1].value.bits==11&&
               proof.budgetAfter().fuelRemaining==6&&device->writeBackSource()==GpuSoftwareWriteBack::OutputsUnavailable&&
               observed.publications==0,"keep admitted values and leave Source state untouched on device failure");
}
bool checkSoftwareOperationRejection(const GpuPendingCall &call){
  const auto &descriptors=call.descriptors();
  if(!check(descriptors.size()==3&&descriptors[0].kind==GpuResourceKind::Global&&
            call.argumentBindings()==std::vector<uint32_t>{1},"fixture has one global and one argument"))return false;
  const auto i32=tsfg::exception::i32Id.str();
  const GpuHostValue arguments[]={{i32,11}};
  const GpuHostGlobalValue globals[]={{descriptors[0].id,{i32,23}}};
  // Empty paths force a configuration error before loading any device API.
  auto prepared=prepareGpuSoftwareSourceRequest(call,call.identity(),arguments,globals,{7,3},{},8,9);
  auto *device=std::get_if<GpuSoftwareVulkanCall>(&prepared);
  if(!check(device&&device->report().state==GpuSoftwareState::FailedBeforeSubmit&&
            device->report().stage=="configuration","original rejection comes from device configuration"))return false;
  const auto rejected=[&](const GpuSoftwareReport &attempt,llvm::StringRef stage){
    const auto &result=device->report();
    return check(attempt.failure==GpuSoftwareFailure::Input&&attempt.stage==stage&&
                 attempt.identity==call.identity()&&attempt.deviceGeneration==8&&attempt.submissionId==9&&
                 result.state==GpuSoftwareState::FailedBeforeSubmit&&result.stage=="configuration"&&
                 result.failure==GpuSoftwareFailure::Input&&!result.outputsAvailable,
                 "invalid operation does not overwrite the call's true failure");
  };
  const bool submitRejected=rejected(device->submit(),"submit-order");
  const bool waitRejected=rejected(device->wait(1),"wait-parameters");
  return submitRejected&&waitRejected&&
    check(device->writeBack(8,9,{})==GpuSoftwareWriteBack::OutputsUnavailable,
          "a failed call cannot write back");
}
#endif
#endif
}
int main(int argc,char **argv){
  const auto mode=argc==3?llvm::StringRef(argv[2]):llvm::StringRef{};
  if(argc!=2&&mode!="--check-derived-numeric-use"&&mode!="--check-unwritten-global"&&
     mode!="--check-source-arguments"
#ifdef TSFG_GPU_SOFTWARE_HOST_CHECK
     &&mode!="--check-software-operation-rejection"&&mode!="--check-bound-source-instance"
#endif
     )return 2;
  const bool checkDerived=mode=="--check-derived-numeric-use";
  std::string coreBytes,requestBytes,planBytes;
  if(!read(argv[1],"common-program.mlir",coreBytes)||!read(argv[1],"gpu-binding-request.json",requestBytes)||
     !read(argv[1],"gpu-binding-plan.json",planBytes))return 2;
  mlir::DialectRegistry registry;tsfg::registerCoreDialect(registry);registerDialect(registry);
  registry.insert<mlir::func::FuncDialect,mlir::cf::ControlFlowDialect,mlir::spirv::SPIRVDialect>();
  mlir::MLIRContext context(registry);context.disableMultithreading();Program program;Error error;
  {auto core=mlir::parseSourceString<mlir::ModuleOp>(coreBytes,&context);
   if(!core||!readCore(*core,program,error)){llvm::errs()<<error.code<<": "<<error.message<<'\n';return 3;}}
  Json request=nullptr,savedPlan=nullptr,plan=nullptr;
  if(!readJson(llvm::StringRef(requestBytes).drop_back(),request,program,error)||
     !readJson(llvm::StringRef(planBytes).drop_back(),savedPlan,program,error)||
     !createGpuBindingPlan(program,request,plan,error)||!check(same(plan,savedPlan),"actual complete plan"))return 3;
  if(mode=="--check-unwritten-global")return checkUnwrittenGlobal(program,std::move(plan),context)?0:3;
  Json artifact=nullptr;
  if(!emitGpuBindingModule(program,plan,"single-source-call-v1",context,artifact,error)){
    llvm::errs()<<error.code<<": "<<error.message<<" ("<<error.path<<":"<<error.range.start<<":"<<error.range.end<<")\n";return 3;}
  auto artifactBytes=canonical(artifact)+"\n";std::optional<GpuPendingCall> pending;
  if(!readGpuBindingModule(artifactBytes,program,plan,"single-source-call-v1",context,pending,error))return 3;
  if(!check(pending&&!pending->hostPreflightFulfilled()&&!pending->launchAuthorized(),"owned reader preserves pending call"))return 3;
  if(checkDerived){
    auto changed=artifact;
    auto &discharges=*changed.getAsObject()->getArray("discharges");
    const auto derived=std::find_if(discharges.begin(),discharges.end(),[](const Json &row){
      return field(row,"relation").getAsString()=="computed-i32-is-numeric";
    });
    if(!check(derived!=discharges.end()&&!items(field(*derived,"requires")).empty(),
       "actual computed i32 discharge has prior proof"))return 3;
    const auto obligation=field(*derived,"obligationId").getAsInteger();
    if(!check(std::any_of(pending->discharges().begin(),pending->discharges().end(),[&](const GpuI32Discharge &row){
      return obligation==row.site.obligationId&&!row.prerequisites.empty();
    }),"owned computed i32 discharge retains prerequisites"))return 3;
    (*derived->getAsObject())["requires"]=Array{};
    changed.getAsObject()->erase("artifactDigest");
    const auto changedDigest=digest(canonical(changed)+"\n");
    (*changed.getAsObject())["artifactDigest"]=changedDigest;
    Error rejected;
    if(!check(!readGpuBindingModule(canonical(changed)+"\n",program,plan,"single-source-call-v1",context,pending,rejected)&&
        rejected.code=="core-ir-common-gpu-artifact-content"&&pending&&
        pending->identity().artifactDigest==field(artifact,"artifactDigest").getAsString(),
        "reader rejects rebound computed proof with missing prerequisites"))return 3;
  }
#ifdef TSFG_GPU_PREFLIGHT_BASELINE
  if(!check(pending->hostPreflightFulfilled(),"baseline has no successful Host preflight consumer for genuine call"))return 3;
  return 0;
#else
  const auto &call=*pending;const auto &entry=std::get<GpuEntryBudgetStep>(call.hostSteps().front());
  if(mode=="--check-source-arguments")return checkSourceArguments(call)?0:3;
#ifdef TSFG_GPU_SOFTWARE_HOST_CHECK
  if(mode=="--check-software-operation-rejection")return checkSoftwareOperationRejection(call)?0:3;
  if(mode=="--check-bound-source-instance")return checkBoundSourceInstance(call)?0:3;
#endif
  std::vector<const GpuNumericUseStep *> uses;
  for(const auto &row:call.hostSteps())if(const auto *use=std::get_if<GpuNumericUseStep>(&row))
    if(std::holds_alternative<GpuBindingOrigin>(use->origin))uses.push_back(use);
  if(!check(!uses.empty(),"real binding numeric consumer"))return 3;
  const auto compilerBudget=program.remaining;const auto beforePending=canonical(artifact);
  GpuHostInputs supplied{call.identity(),{}};
  for(const auto &descriptor:call.descriptors())if(descriptor.access!=GpuResourceAccess::Write)
    supplied.bindings.push_back({descriptor,{tsfg::exception::i32Id.str(),uint32_t(0xfffffff9)}});
  Array failures;uint32_t checks=0;
  const auto expectFailure=[&](llvm::StringRef name,const GpuHostInputs &values,GpuHostBudget budget,
      GpuHostFailureKind kind,llvm::StringRef code,llvm::StringRef rule,const GpuObligationSite &expected,uint64_t fuel){
    auto result=preflightGpuBindingCall(call,values,budget);const auto *failed=std::get_if<GpuHostFailure>(&result);
    if(!check(failed&&failed->kind==kind&&failed->code==code&&failed->ruleId==rule&&sameSite(failed->site,expected)&&
      failed->budget.fuelRemaining==fuel&&failed->budget.depthLimit==budget.depthLimit,name))return false;
    failures.push_back(Object{{"name",name.str()},{"failure",failure(*failed)}});++checks;return true;
  };
  auto positive=preflightGpuBindingCall(call,supplied,{2,1});auto *proof=std::get_if<GpuHostProof>(&positive);
  if(!check(proof&&proof->hostPreflightFulfilled()&&!proof->launchAuthorized()&&!proof->deviceExecutionAuthorized()&&
      !proof->call().hostPreflightFulfilled()&&!proof->call().launchAuthorized()&&proof->budgetBefore().fuelRemaining==2&&
      proof->budgetAfter().fuelRemaining==1&&proof->call().identity().artifactDigest==call.identity().artifactDigest&&
      same(inputs(proof->bindings()),inputs(supplied.bindings)),"successful owned Host proof with exact negative-i32 bits"))return 3;
  ++checks;
  auto exact=preflightGpuBindingCall(call,supplied,{1,1});
  if(!check(std::holds_alternative<GpuHostProof>(exact)&&std::get<GpuHostProof>(exact).budgetAfter().fuelRemaining==0,"exact entry fuel"))return 3;
  ++checks;
  auto missing=supplied;missing.bindings.pop_back();auto extra=supplied;extra.bindings.push_back(supplied.bindings.front());
  auto wrongBinding=supplied;wrongBinding.bindings[0].descriptor.binding++;
  auto wrongResource=supplied;wrongResource.bindings[0].descriptor.id="sha256:"+std::string(64,'0');
  auto wrongSource=supplied;wrongSource.bindings[0].descriptor.source.range.start++;
  for(const auto &[name,value]:std::vector<std::pair<std::string,GpuHostInputs>>{{"missing",missing},{"extra",extra},
    {"wrong-slot",wrongBinding},{"wrong-resource",wrongResource},{"wrong-source",wrongSource}})
    if(!expectFailure(name,value,{0,0},GpuHostFailureKind::Input,"core-ir-common-gpu-host-binding","r01-gpu",entry.site,0))return 3;
  using IdentityMember=std::string GpuCallIdentity::*;
  for(const auto member:std::vector<IdentityMember>{&GpuCallIdentity::inputIdentity,&GpuCallIdentity::hirDigest,
    &GpuCallIdentity::scopeDigest,&GpuCallIdentity::publishedDigest,&GpuCallIdentity::kernelProofDigest,
    &GpuCallIdentity::borrowProofDigest,&GpuCallIdentity::requestDigest,&GpuCallIdentity::planDigest,
    &GpuCallIdentity::wordsDigest,&GpuCallIdentity::artifactDigest}){
    auto wrong=supplied;wrong.identity.*member="sha256:"+std::string(64,'0');
    if(!expectFailure("wrong-context",wrong,{0,0},GpuHostFailureKind::Input,"core-ir-common-gpu-host-context","r01-gpu",entry.site,0))return 3;
  }
  auto malformed=supplied;malformed.bindings[0].value.bits=0xfffffffffffffffull;
  if(!expectFailure("noncanonical-i32",malformed,{2,1},GpuHostFailureKind::Input,"core-ir-common-gpu-host-value","r01-gpu",entry.site,2))return 3;
  malformed=supplied;malformed.bindings[0].value.actualType="sha256:"+std::string(64,'0');
  if(!expectFailure("foreign-actual-tag",malformed,{2,1},GpuHostFailureKind::Input,"core-ir-common-gpu-host-value","r01-gpu",entry.site,2))return 3;
  if(!expectFailure("depth-before-fuel",supplied,{0,0},GpuHostFailureKind::Trap,"r01-t-depth","r01-depth",entry.site,0)||
     !expectFailure("depth-preserves-fuel",supplied,{2,0},GpuHostFailureKind::Trap,"r01-t-depth","r01-depth",entry.site,2)||
     !expectFailure("fuel-exhausted",supplied,{0,1},GpuHostFailureKind::Trap,"r01-t-fuel","r01-fuel",entry.site,0))return 3;
  const auto undefinedType=digest(llvm::StringRef("tsfg.type\0undefined",19));
  const auto setValue=[&](GpuHostInputs &values,const GpuNumericUseStep &use,GpuHostValue value){
    const auto index=std::get<GpuBindingOrigin>(use.origin).descriptorIndex;
    for(auto &row:values.bindings)if(row.descriptor.id==call.descriptors()[index].id)row.value=value;
  };
  auto absent=supplied;for(const auto *use:uses)setValue(absent,*use,{undefinedType,0});
  if(!expectFailure("first-undefined-source-order",absent,{2,1},GpuHostFailureKind::Trap,"r01-t-undefined-numeric-use","r01-numeric-use",uses[0]->site,1)||
     !expectFailure("depth-before-undefined",absent,{0,0},GpuHostFailureKind::Trap,"r01-t-depth","r01-depth",entry.site,0)||
     !expectFailure("fuel-before-undefined",absent,{0,1},GpuHostFailureKind::Trap,"r01-t-fuel","r01-fuel",entry.site,0))return 3;
  if(uses.size()>1){
    setValue(absent,*uses[0],{tsfg::exception::i32Id.str(),17});
    if(!expectFailure("second-undefined-source-order",absent,{2,1},GpuHostFailureKind::Trap,"r01-t-undefined-numeric-use","r01-numeric-use",uses[1]->site,1))return 3;
  }
  for(const auto name:{"bool","null","u32","f64"}){
    auto other=supplied;setValue(other,*uses[0],{digest(std::string("tsfg.type\0",10)+name),0});
    if(!expectFailure(name,other,{2,1},GpuHostFailureKind::Capability,"core-ir-common-gpu-host-capability","r01-gpu",uses[0]->site,1))return 3;
  }
  if(!check(program.remaining==compilerBudget&&!call.hostPreflightFulfilled()&&!call.launchAuthorized(),"Host check preserves compiler budget and original pending authority"))return 3;
  Json afterArtifact=nullptr;
  if(!emitGpuBindingModule(program,plan,"single-source-call-v1",context,afterArtifact,error)||
     !check(canonical(afterArtifact)==beforePending,"existing artifact bytes stay exact after Host proof"))return 3;
  std::optional<GpuPendingCall> second;
  if(!readGpuBindingModule(artifactBytes,program,plan,"single-source-call-v1",context,second,error)||
    !check(second&&!second->hostPreflightFulfilled()&&second->identity().artifactDigest==call.identity().artifactDigest&&
      second->words()==call.words()&&second->hostSteps().size()==call.hostSteps().size(),"old reader stays pending and stable"))return 3;
  const auto savedInputs=canonical(inputs(proof->bindings()));const auto savedWords=proof->call().words();
  const auto identity=proof->call().identity().artifactDigest;const auto coreHash=digest(coreBytes);
  const auto planHash=digest(planBytes);const auto requestHash=digest(requestBytes);
  Json report=Object{{"family","tsfg.gpu-host-preflight-checks"},{"version",1},{"checks",checks},
    {"coreSHA",coreHash},{"planSHA",planHash},{"requestSHA",requestHash},{"emittedModule",artifact},
    {"proof",Object{{"hostPreflightFulfilled",true},{"launchAuthorized",false},{"deviceExecutionAuthorized",false},
      {"fuelBefore","2"},{"fuelAfter","1"},{"bindings",inputs(proof->bindings())},{"artifactDigest",identity}}},
    {"failures",std::move(failures)},{"genuineBindingNumericUses",int64_t(uses.size())},{"oldArtifactBytesUnchanged",true},
    {"oldReaderPending",true},{"compilerBudgetUnchanged",true},{"sourceExecution",false},{"vm",false},{"jit",false},{"device",false}};
  supplied.bindings.clear();supplied.identity={};pending.reset();second.reset();program=Program{};
  artifact=nullptr;afterArtifact=nullptr;plan=nullptr;savedPlan=nullptr;request=nullptr;
  std::fill(artifactBytes.begin(),artifactBytes.end(),'x');artifactBytes.clear();coreBytes.clear();planBytes.clear();requestBytes.clear();
  if(!check(canonical(inputs(proof->bindings()))==savedInputs&&proof->call().words()==savedWords&&
      proof->call().identity().artifactDigest==identity&&proof->budgetAfter().fuelRemaining==1,"proof owns call and values after all caller inputs release"))return 3;
  (*report.getAsObject())["ownedAfterInputRelease"]=true;
  if(checkDerived)(*report.getAsObject())["derivedReaderRejectedMissingPrerequisites"]=true;
  if(llvm::sys::ChangeStdoutToBinary())return 2;
  llvm::outs()<<canonical(report)<<'\n';llvm::outs().flush();return llvm::outs().has_error()?2:0;
#endif
}
