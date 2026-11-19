// SPDX-License-Identifier: MIT
// Reopen a retained software-device artifact without creating a device.
#include "gpu-software-vulkan-consumer.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/raw_ostream.h"

namespace {
using namespace tsfg::commonProgram;
using tsfg::exception::field;

std::string read(llvm::StringRef path) {
  auto file=llvm::MemoryBuffer::getFile(path);
  return file?(*file)->getBuffer().str():std::string{};
}

std::optional<Json> report(llvm::StringRef path) {
  auto parsed=llvm::json::parse(read(path));
  if(!parsed){llvm::consumeError(parsed.takeError());return std::nullopt;}
  return std::move(*parsed);
}

bool check(bool condition,llvm::StringRef message) {
  if(!condition)llvm::errs()<<message<<'\n';
  return condition;
}
}

int main(int argc,char **argv) {
  if(argc!=4)return 2;
  const std::string fixture=argv[1];
  std::optional<GpuPendingCall> pending;
  {
    const auto core=read(fixture+"/common-program.mlir"),request=read(fixture+"/gpu-binding-request.json");
    const auto matched=report(argv[2]),foreign=report(argv[3]);
    if(core.empty()||request.empty()||!matched||!foreign)return 2;
    Error error;
    const auto module=canonical(field(*matched,"emittedModule"))+"\n";
    pending=readGpuSoftwareSourceCall(core,request,module,error);
    if(!pending){llvm::errs()<<error.code<<": "<<error.message<<'\n';return 3;}
    if(!check(pending->identity().artifactDigest==field(field(*matched,"identity"),"artifactDigest").getAsString()&&
        pending->functionId()==field(*matched,"functionId").getAsString()&&
        pending->descriptors().size()==3&&!pending->launchAuthorized(),
        "admitted artifact retains the real report identity and three bindings"))return 3;
    Error mismatched;
    if(!check(!readGpuSoftwareSourceCall(core,request,canonical(field(*foreign,"emittedModule"))+"\n",mismatched)&&
        mismatched.code=="core-ir-common-gpu-artifact-identity",
        "a real artifact for a different program is rejected"))return 3;
    Error missingLf;
    if(!check(!readGpuSoftwareSourceCall(core,llvm::StringRef(request).drop_back(),module,missingLf)&&
        missingLf.code=="core-ir-common-gpu-canonical","the request requires canonical framing"))return 3;
    Error binaryCore;
    const llvm::StringRef binaryMagic("ML\xefR",4);
    if(!check(!readGpuSoftwareSourceCall(binaryMagic,request,module,binaryCore)&&
        binaryCore.code=="core-ir-common-gpu-core-format","the Core input rejects the binary format"))return 3;
  }
  const auto &global=pending->descriptors()[0];
  if(!check(global.kind==GpuResourceKind::Global&&global.access==GpuResourceAccess::ReadWrite,
      "the actual global remains writable"))return 3;
  const auto type=tsfg::exception::i32Id.str();
  const GpuHostValue arguments[]={{type,11}};
  const GpuHostGlobalValue globals[]={{global.id,{type,23}}};
  const auto checked=preflightGpuSourceCall(*pending,pending->identity(),arguments,globals,{7,3});
  const auto *proof=std::get_if<GpuHostProof>(&checked);
  return check(proof&&proof->bindings().size()==2&&proof->bindings()[0].value.bits==23&&
      proof->bindings()[1].value.bits==11&&proof->budgetBefore().fuelRemaining==7&&
      proof->budgetAfter().fuelRemaining==6&&proof->budgetAfter().depthLimit==3,
      "the reopened request uses live argument, global and budget inputs")?0:3;
}
