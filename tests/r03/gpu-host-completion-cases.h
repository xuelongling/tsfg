// SPDX-License-Identifier: MIT
// Private completion cases included inside the Host preflight test namespace.
bool checkSourceCompletion(const GpuPendingCall &call){
  using Device=GpuSoftwareCompletionTest;
  const auto &descriptors=call.descriptors();
  if(!check(descriptors.size()==3&&descriptors[0].kind==GpuResourceKind::Global&&
      descriptors[1].kind==GpuResourceKind::Parameter&&descriptors[2].kind==GpuResourceKind::Return,
      "completion fixture has a global, an argument and a return"))return false;
  const auto i32=tsfg::exception::i32Id.str();
  const GpuHostValue arguments[]={{i32,11}};
  const GpuHostGlobalValue globals[]={{descriptors[0].id,{i32,23}}};
  auto checked=preflightGpuSourceCall(call,call.identity(),arguments,globals,{7,3});
  const auto *proof=std::get_if<GpuHostProof>(&checked);
  if(!check(proof,"completion fixture admits independent input values"))return false;
  const auto lease=[&](SourceLeaseObservation &observed){
    return std::make_unique<ObservedSourceLease>(call.identity(),descriptors[0].id,descriptors[2].id,observed);
  };
  // Distinct output words catch a swap between the global and return cells.
  uint32_t data[]={34,11,57};
  SourceLeaseObservation accepted;
  accepted.acceptOutputs=true;
  {
    auto device=Device::prepared(*proof,lease(accepted),data);
    const auto invalid=device.finishSourceRequest(0);
    if(!check(invalid.operationError&&invalid.device.state==GpuSoftwareState::Prepared&&
        Device::submissions==0&&Device::waits==0,"invalid wait does not submit"))return false;
    Device::waitResult=VK_TIMEOUT;
    const auto pending=device.finishSourceRequest(1);
    if(!check(pending.device.state==GpuSoftwareState::Unfinished&&!pending.writeBack&&
        Device::ownsDevice(device)&&
        !pending.operationError&&accepted.global==23&&accepted.returned==0&&
        accepted.publications==0&&accepted.destructions==0,"timeout preserves the request and original values"))return false;
    Device::waitResult=VK_ERROR_OUT_OF_HOST_MEMORY;
    const auto &uncertain=device.wait(1);
    if(!check(uncertain.state==GpuSoftwareState::Unfinished&&uncertain.failure==GpuSoftwareFailure::Vulkan&&
        uncertain.vkResult==VK_ERROR_OUT_OF_HOST_MEMORY&&!uncertain.completionKnown&&Device::ownsDevice(device)&&
        accepted.destructions==0,"a wait error with unknown completion keeps the original request"))return false;
  }
  auto otherIdentity=call.identity();
  otherIdentity.artifactDigest.clear();
  if(!check(!GpuSoftwareVulkanCall::resumeRetained(8,9)&&
      !GpuSoftwareVulkanCall::resumeRetainedSource(8,9,otherIdentity)&&
      !GpuSoftwareVulkanCall::resumeRetainedSource(8,10,call.identity()),
      "a Source request requires its original program identity to resume"))return false;
  auto resumed=GpuSoftwareVulkanCall::resumeRetainedSource(8,9,call.identity());
  if(!check(resumed.has_value(),"resume the original request"))return false;
  Device::waitResult=VK_SUCCESS;
  const auto &finished=resumed->wait(1);
  if(!check(finished.outputsAvailable&&!Device::ownsDevice(*resumed)&&accepted.destructions==0,
      "direct wait retires device ownership and keeps the Source instance for writeback"))return false;
  const auto completed=resumed->finishSourceRequest(1);
  const auto repeated=resumed->finishSourceRequest(1);
  if(!check(completed.device.state==GpuSoftwareState::Completed&&completed.device.identity==call.identity()&&
      completed.device.deviceGeneration==8&&completed.device.submissionId==9&&completed.budget.fuelRemaining==6&&
      completed.writeBack==GpuSoftwareWriteBack::Committed&&repeated.writeBack==GpuSoftwareWriteBack::AlreadyCommitted&&
      Device::submissions==1&&Device::waits==3&&accepted.global==34&&accepted.returned==57&&
      accepted.publications==1&&accepted.destructions==1,"resume waits again and publishes once"))return false;

  SourceLeaseObservation rejected;
  auto device=Device::prepared(*proof,lease(rejected),data);
  resumed.reset();
  if(!check(Device::ownsDevice(device)&&Device::deviceReserved(),
      "retiring the old handle preserves the next request's ownership"))return false;
  const auto failed=device.finishSourceRequest(1);
  auto foreign=device.outputs();
  for(auto &output:foreign)output.bits=0;
  if(!check(failed.device.state==GpuSoftwareState::Completed&&failed.device.outputsAvailable&&
      !Device::ownsDevice(device)&&
      failed.writeBack==GpuSoftwareWriteBack::SourceRejected&&!failed.operationError&&
      device.finishSourceRequest(1).writeBack==GpuSoftwareWriteBack::SourceRejected&&
      device.writeBack(8,9,foreign)==GpuSoftwareWriteBack::BindingMismatch&&
      rejected.global==23&&rejected.returned==0&&rejected.publications==1&&rejected.destructions==1,
      "rejected writeback retires the original lease and cannot publish to another destination"))return false;

  SourceLeaseObservation submitFailure;
  auto unableToSubmit=Device::prepared(*proof,lease(submitFailure),data);
  Device::submitResult=VK_ERROR_OUT_OF_HOST_MEMORY;
  const auto &submission=unableToSubmit.submit();
  if(!check(submission.state==GpuSoftwareState::FailedBeforeSubmit&&
      submission.vkResult==VK_ERROR_OUT_OF_HOST_MEMORY&&submission.stage=="queue-submit"&&
      !submission.submitted&&!submission.outputsAvailable&&!Device::deviceReserved()&&
      submitFailure.publications==0&&submitFailure.destructions==1,
      "failed direct submission keeps its report and frees ownership for the next request"))return false;

  Device::submitResult=VK_SUCCESS;
  for(const bool readbackFailure:{false,true}){
    SourceLeaseObservation observed;
    auto failing=Device::prepared(*proof,lease(observed),data,readbackFailure);
    if(!check(failing.submit().submitted,"submit before testing a terminal wait failure"))return false;
    Device::waitResult=readbackFailure?VK_SUCCESS:VK_ERROR_DEVICE_LOST;
    const auto &failure=failing.wait(1);
    const auto expectedState=readbackFailure?GpuSoftwareState::Completed:GpuSoftwareState::DeviceLost;
    const auto expectedResult=readbackFailure?VK_ERROR_OUT_OF_HOST_MEMORY:VK_ERROR_DEVICE_LOST;
    if(!check(failure.state==expectedState&&failure.vkResult==expectedResult&&failure.completionKnown==readbackFailure&&
        failure.stage==(readbackFailure?"invalidate-output-memory":"wait")&&failure.failure==GpuSoftwareFailure::Vulkan&&
        !failure.outputsAvailable&&failing.outputs().empty()&&!Device::deviceReserved()&&
        observed.destructions==1&&observed.publications==0&&observed.global==23&&observed.returned==0,
        "terminal wait failure preserves its report, retires ownership and publishes nothing"))return false;
  }
  return true;
}
