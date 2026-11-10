// SPDX-License-Identifier: MIT
#include "gpu-software-vulkan-consumer.h"
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#define VK_NO_PROTOTYPES
#include <vulkan/vulkan_core.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <limits>
#include <utility>

namespace tsfg::commonProgram {
namespace {
std::atomic_flag activeSoftwareCall=ATOMIC_FLAG_INIT;
// Windows/x86-64 is the fixed external acceptance target. Payloads and the
// already-owned SPIR-V words use that target's little-endian 32-bit pattern.
static_assert(sizeof(void *)==8&&sizeof(uint32_t)==4);
#define TSFG_DEVICE_FUNCTIONS(X) \
  X(DestroyDevice) X(GetDeviceQueue) X(CreateBuffer) X(DestroyBuffer) \
  X(GetBufferMemoryRequirements) X(AllocateMemory) X(FreeMemory) X(BindBufferMemory) \
  X(MapMemory) X(UnmapMemory) X(FlushMappedMemoryRanges) X(InvalidateMappedMemoryRanges) \
  X(CreateDescriptorSetLayout) X(DestroyDescriptorSetLayout) X(CreateDescriptorPool) \
  X(DestroyDescriptorPool) X(AllocateDescriptorSets) X(UpdateDescriptorSets) \
  X(CreatePipelineLayout) X(DestroyPipelineLayout) X(CreateShaderModule) X(DestroyShaderModule) \
  X(CreateComputePipelines) X(DestroyPipeline) X(CreateCommandPool) X(DestroyCommandPool) \
  X(AllocateCommandBuffers) X(BeginCommandBuffer) X(EndCommandBuffer) X(CmdPipelineBarrier) \
  X(CmdBindPipeline) X(CmdBindDescriptorSets) X(CmdDispatch) X(CreateFence) X(DestroyFence) \
  X(QueueSubmit) X(WaitForFences)
struct Vulkan {
  PFN_vkGetInstanceProcAddr GetInstanceProcAddr=nullptr;
  PFN_vkGetDeviceProcAddr GetDeviceProcAddr=nullptr;
  PFN_vkCreateInstance CreateInstance=nullptr;
  PFN_vkDestroyInstance DestroyInstance=nullptr;
  PFN_vkEnumeratePhysicalDevices EnumeratePhysicalDevices=nullptr;
  PFN_vkGetPhysicalDeviceProperties GetPhysicalDeviceProperties=nullptr;
  PFN_vkGetPhysicalDeviceMemoryProperties GetPhysicalDeviceMemoryProperties=nullptr;
  PFN_vkGetPhysicalDeviceQueueFamilyProperties GetPhysicalDeviceQueueFamilyProperties=nullptr;
  PFN_vkCreateDevice CreateDevice=nullptr;
#define TSFG_DECLARE(name) PFN_vk##name name=nullptr;
  TSFG_DEVICE_FUNCTIONS(TSFG_DECLARE)
#undef TSFG_DECLARE
};
struct Buffer {
  VkBuffer buffer=VK_NULL_HANDLE;VkDeviceMemory memory=VK_NULL_HANDLE;
  void *mapped=nullptr;bool coherent=false;
};
bool privateAbsolute(const std::wstring &path){
  return path.size()>3&&(path[0]==L'E'||path[0]==L'e')&&path[1]==L':'&&(path[2]==L'/'||path[2]==L'\\');
}
}

struct GpuSoftwareVulkanCall::Impl {
  GpuHostProof proof;GpuSoftwareReport report;std::vector<GpuSoftwareOutput> outputs;
  Vulkan vk;HMODULE loader=nullptr;VkInstance instance=VK_NULL_HANDLE;
  VkPhysicalDevice physical=VK_NULL_HANDLE;VkDevice device=VK_NULL_HANDLE;VkQueue queue=VK_NULL_HANDLE;
  VkDescriptorPool descriptorPool=VK_NULL_HANDLE;VkPipelineLayout pipelineLayout=VK_NULL_HANDLE;
  VkShaderModule shader=VK_NULL_HANDLE;VkPipeline pipeline=VK_NULL_HANDLE;
  VkCommandPool commandPool=VK_NULL_HANDLE;VkCommandBuffer command=VK_NULL_HANDLE;VkFence fence=VK_NULL_HANDLE;
  std::vector<Buffer> buffers;std::vector<VkDescriptorSetLayout> layouts;std::vector<VkDescriptorSet> sets;
  std::vector<std::pair<std::wstring,std::optional<std::wstring>>> environment;
  bool lease=false;
  Impl(const GpuHostProof &value,uint64_t generation,uint64_t submission):proof(value){
    const auto &call=proof.call();report.identity=call.identity();report.functionId=call.functionId();
    report.deviceGeneration=generation;report.submissionId=submission;report.resources=call.descriptors();
    if(!call.hostSteps().empty())report.source=std::visit([](const auto &step){return step.site.source;},call.hostSteps().front());
  }
  bool inFlight()const{return report.submitted&&!report.completionKnown&&report.state!=GpuSoftwareState::DeviceLost;}
  bool fail(GpuSoftwareFailure kind,const char *stage,const char *reason){
    report.failure=kind;report.stage=stage;report.reason=reason;
    if(!report.submitted&&report.state!=GpuSoftwareState::DeviceLost)report.state=GpuSoftwareState::FailedBeforeSubmit;
    return false;
  }
  bool checked(VkResult result,const char *stage){
    report.vkResult=int32_t(result);
    if(result==VK_SUCCESS)return true;
    if(result==VK_ERROR_DEVICE_LOST)report.state=GpuSoftwareState::DeviceLost;
    return fail(GpuSoftwareFailure::Vulkan,stage,"Vulkan operation failed");
  }
  bool setEnvironment(const wchar_t *name,const wchar_t *value){
    SetLastError(ERROR_SUCCESS);const auto count=GetEnvironmentVariableW(name,nullptr,0);
    std::optional<std::wstring> previous;
    if(count){std::wstring text(count,L'\0');const auto size=GetEnvironmentVariableW(name,text.data(),count);text.resize(size);previous=std::move(text);}
    else if(GetLastError()!=ERROR_ENVVAR_NOT_FOUND)previous=L"";
    environment.emplace_back(name,std::move(previous));
    if(SetEnvironmentVariableW(name,value))return true;
    report.windowsError=GetLastError();return fail(GpuSoftwareFailure::Windows,"loader-environment","private Vulkan environment setup failed");
  }
  bool prepare(const GpuSoftwarePaths &paths){
    if(!report.deviceGeneration||!report.submissionId||!privateAbsolute(paths.loaderAbsolute)||!privateAbsolute(paths.icdAbsolute))
      return fail(GpuSoftwareFailure::Input,"configuration","qualified private E-drive paths and nonzero generation/submission are required");
    if(activeSoftwareCall.test_and_set(std::memory_order_acquire))
      return fail(GpuSoftwareFailure::Capability,"ownership","another software call still owns the private-loader process environment");
    lease=true;
    // The fixed Loader ignores driver-selection environment at high integrity.
    // Fail closed before loading it so discovery cannot fall back to the system.
    HANDLE token=nullptr;
    if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token)){
      report.windowsError=GetLastError();return fail(GpuSoftwareFailure::Windows,"process-integrity","process token could not be queried");
    }
    DWORD tokenBytes=0;const auto sized=GetTokenInformation(token,TokenIntegrityLevel,nullptr,0,&tokenBytes);
    const auto tokenSizeError=GetLastError();
    if(sized||tokenSizeError!=ERROR_INSUFFICIENT_BUFFER||tokenBytes<sizeof(TOKEN_MANDATORY_LABEL)){
      CloseHandle(token);report.windowsError=tokenSizeError;return fail(GpuSoftwareFailure::Windows,"process-integrity","process integrity size could not be established");
    }
    std::vector<uint8_t> tokenData(tokenBytes);
    const auto queried=GetTokenInformation(token,TokenIntegrityLevel,tokenData.data(),tokenBytes,&tokenBytes);
    const auto tokenError=GetLastError();CloseHandle(token);
    if(!queried){report.windowsError=tokenError;return fail(GpuSoftwareFailure::Windows,"process-integrity","process integrity could not be established");}
    const auto *label=reinterpret_cast<const TOKEN_MANDATORY_LABEL *>(tokenData.data());
    if(!IsValidSid(label->Label.Sid)||!*GetSidSubAuthorityCount(label->Label.Sid))
      return fail(GpuSoftwareFailure::Capability,"process-integrity","process integrity SID is invalid");
    const auto integrity=*GetSidSubAuthority(label->Label.Sid,*GetSidSubAuthorityCount(label->Label.Sid)-1);
    if(integrity>=SECURITY_MANDATORY_HIGH_RID)
      return fail(GpuSoftwareFailure::Capability,"process-integrity","elevated processes cannot enforce the fixed private ICD selection");
    if(GetModuleHandleW(L"vulkan-1.dll"))return fail(GpuSoftwareFailure::Capability,"loader","a Vulkan loader is already active in this process");
    if(!setEnvironment(L"VK_DRIVER_FILES",paths.icdAbsolute.c_str())||
       !setEnvironment(L"VK_ICD_FILENAMES",nullptr)||!setEnvironment(L"VK_ADD_DRIVER_FILES",nullptr)||
       !setEnvironment(L"VK_LOADER_LAYERS_DISABLE",L"~all~")||!setEnvironment(L"VK_LOADER_LAYERS_ENABLE",nullptr)||
       !setEnvironment(L"VK_LOADER_LAYERS_ALLOW",nullptr)||
       !setEnvironment(L"VK_INSTANCE_LAYERS",nullptr)||!setEnvironment(L"VK_LAYER_PATH",nullptr)||
       !setEnvironment(L"VK_ADD_LAYER_PATH",nullptr))return false;
    loader=LoadLibraryExW(paths.loaderAbsolute.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
    if(!loader){report.windowsError=GetLastError();return fail(GpuSoftwareFailure::Windows,"loader","fixed private Vulkan loader could not be loaded");}
    vk.GetInstanceProcAddr=reinterpret_cast<PFN_vkGetInstanceProcAddr>(GetProcAddress(loader,"vkGetInstanceProcAddr"));
    if(!vk.GetInstanceProcAddr)return fail(GpuSoftwareFailure::Capability,"loader-interface","fixed loader lacks vkGetInstanceProcAddr");
    vk.CreateInstance=reinterpret_cast<PFN_vkCreateInstance>(vk.GetInstanceProcAddr(nullptr,"vkCreateInstance"));
    if(!vk.CreateInstance)return fail(GpuSoftwareFailure::Capability,"loader-interface","fixed loader lacks vkCreateInstance");
    VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};app.pApplicationName="tsfg-software-acceptance";app.apiVersion=VK_API_VERSION_1_1;
    VkInstanceCreateInfo create{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};create.pApplicationInfo=&app;
    if(!checked(vk.CreateInstance(&create,nullptr,&instance),"create-instance"))return false;
#define TSFG_INSTANCE(name) vk.name=reinterpret_cast<PFN_vk##name>(vk.GetInstanceProcAddr(instance,"vk" #name)); if(!vk.name)return fail(GpuSoftwareFailure::Capability,"instance-interface","missing Vulkan 1.1 instance function: " #name);
    TSFG_INSTANCE(DestroyInstance) TSFG_INSTANCE(EnumeratePhysicalDevices)
    TSFG_INSTANCE(GetPhysicalDeviceProperties) TSFG_INSTANCE(GetPhysicalDeviceMemoryProperties)
    TSFG_INSTANCE(GetPhysicalDeviceQueueFamilyProperties) TSFG_INSTANCE(CreateDevice) TSFG_INSTANCE(GetDeviceProcAddr)
#undef TSFG_INSTANCE
    uint32_t count=0;if(!checked(vk.EnumeratePhysicalDevices(instance,&count,nullptr),"enumerate-physical-devices"))return false;
    if(count!=1)return fail(GpuSoftwareFailure::Capability,"physical-device","the fixed software ICD must expose exactly one physical device");
    if(!checked(vk.EnumeratePhysicalDevices(instance,&count,&physical),"enumerate-physical-devices"))return false;
    VkPhysicalDeviceProperties properties;vk.GetPhysicalDeviceProperties(physical,&properties);
    report.apiVersion=properties.apiVersion;report.driverVersion=properties.driverVersion;report.vendorId=properties.vendorID;
    report.deviceId=properties.deviceID;report.deviceName=properties.deviceName;
    const auto &call=proof.call();const auto &descriptors=call.descriptors();
    uint32_t setCount=0;for(const auto &descriptor:descriptors){
      if(descriptor.set>=properties.limits.maxBoundDescriptorSets)
        return fail(GpuSoftwareFailure::Capability,"descriptor-set","logical descriptor set exceeds the physical device limit");
      setCount=std::max(setCount,descriptor.set+1);
    }
    if(properties.deviceType!=VK_PHYSICAL_DEVICE_TYPE_CPU||properties.apiVersion<VK_API_VERSION_1_1||
       properties.limits.maxStorageBufferRange<4||properties.limits.maxBoundDescriptorSets<setCount||
       properties.limits.maxPerStageDescriptorStorageBuffers<descriptors.size()||properties.limits.maxDescriptorSetStorageBuffers<descriptors.size())
      return fail(GpuSoftwareFailure::Capability,"physical-profile","software device does not support the fixed single-call i32 resource profile");
    uint32_t queueCount=0;vk.GetPhysicalDeviceQueueFamilyProperties(physical,&queueCount,nullptr);
    std::vector<VkQueueFamilyProperties> families(queueCount);vk.GetPhysicalDeviceQueueFamilyProperties(physical,&queueCount,families.data());
    const auto family=std::find_if(families.begin(),families.end(),[](const auto &item){return item.queueCount&&(item.queueFlags&VK_QUEUE_COMPUTE_BIT);});
    if(family==families.end())return fail(GpuSoftwareFailure::Capability,"compute-queue","software device has no compute queue");
    const auto queueFamily=uint32_t(family-families.begin());const float priority=1;
    VkDeviceQueueCreateInfo queueInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};queueInfo.queueFamilyIndex=queueFamily;queueInfo.queueCount=1;queueInfo.pQueuePriorities=&priority;
    VkDeviceCreateInfo deviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};deviceInfo.queueCreateInfoCount=1;deviceInfo.pQueueCreateInfos=&queueInfo;
    if(!checked(vk.CreateDevice(physical,&deviceInfo,nullptr,&device),"create-device"))return false;
#define TSFG_RESOLVE(name) vk.name=reinterpret_cast<PFN_vk##name>(vk.GetDeviceProcAddr(device,"vk" #name)); if(!vk.name)return fail(GpuSoftwareFailure::Capability,"device-interface","missing Vulkan 1.1 device function: " #name);
    TSFG_DEVICE_FUNCTIONS(TSFG_RESOLVE)
#undef TSFG_RESOLVE
    vk.GetDeviceQueue(device,queueFamily,0,&queue);
    VkPhysicalDeviceMemoryProperties memory;vk.GetPhysicalDeviceMemoryProperties(physical,&memory);
    buffers.resize(descriptors.size());
    for(size_t index=0;index<descriptors.size();++index){
      report.resourceIndex=uint32_t(index);auto &resource=buffers[index];const auto &descriptor=descriptors[index];
      VkBufferCreateInfo buffer{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};buffer.size=call.layout().blockBytes;buffer.usage=VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;buffer.sharingMode=VK_SHARING_MODE_EXCLUSIVE;
      if(!checked(vk.CreateBuffer(device,&buffer,nullptr,&resource.buffer),"create-buffer"))return false;
      VkMemoryRequirements required;vk.GetBufferMemoryRequirements(device,resource.buffer,&required);
      uint32_t type=UINT32_MAX;
      for(uint32_t candidate=0;candidate<memory.memoryTypeCount;++candidate){
        const auto flags=memory.memoryTypes[candidate].propertyFlags;
        if((required.memoryTypeBits&(uint32_t(1)<<candidate))&&(flags&VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT)){
          type=candidate;if(flags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)break;
        }
      }
      if(type==UINT32_MAX)return fail(GpuSoftwareFailure::Capability,"buffer-memory","storage buffer has no host-visible memory type");
      resource.coherent=(memory.memoryTypes[type].propertyFlags&VK_MEMORY_PROPERTY_HOST_COHERENT_BIT)!=0;
      VkMemoryAllocateInfo allocation{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};allocation.allocationSize=required.size;allocation.memoryTypeIndex=type;
      if(!checked(vk.AllocateMemory(device,&allocation,nullptr,&resource.memory),"allocate-buffer-memory")||
         !checked(vk.BindBufferMemory(device,resource.buffer,resource.memory,0),"bind-buffer-memory")||
         !checked(vk.MapMemory(device,resource.memory,0,VK_WHOLE_SIZE,0,&resource.mapped),"map-buffer-memory"))return false;
      uint32_t bits=0;
      if(descriptor.access!=GpuResourceAccess::Write){
        const auto input=std::find_if(proof.bindings().begin(),proof.bindings().end(),[&](const auto &value){return value.descriptor.set==descriptor.set&&value.descriptor.binding==descriptor.binding;});
        bits=uint32_t(input->value.bits);
      }
      std::memcpy(resource.mapped,&bits,sizeof(bits));
      if(!resource.coherent){VkMappedMemoryRange range{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};range.memory=resource.memory;range.offset=0;range.size=VK_WHOLE_SIZE;
        if(!checked(vk.FlushMappedMemoryRanges(device,1,&range),"flush-input-memory"))return false;}
    }
    report.resourceIndex.reset();layouts.resize(setCount,VK_NULL_HANDLE);
    for(uint32_t set=0;set<setCount;++set){
      std::vector<VkDescriptorSetLayoutBinding> bindings;
      for(const auto &descriptor:descriptors)if(descriptor.set==set)bindings.push_back({descriptor.binding,VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,1,VK_SHADER_STAGE_COMPUTE_BIT,nullptr});
      VkDescriptorSetLayoutCreateInfo layout{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};layout.bindingCount=uint32_t(bindings.size());layout.pBindings=bindings.data();
      if(!checked(vk.CreateDescriptorSetLayout(device,&layout,nullptr,&layouts[set]),"create-descriptor-layout"))return false;
    }
    if(setCount){
      VkDescriptorPoolSize size{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,uint32_t(descriptors.size())};
      VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};pool.maxSets=setCount;pool.poolSizeCount=1;pool.pPoolSizes=&size;
      if(!checked(vk.CreateDescriptorPool(device,&pool,nullptr,&descriptorPool),"create-descriptor-pool"))return false;
      sets.resize(setCount);VkDescriptorSetAllocateInfo allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};allocate.descriptorPool=descriptorPool;allocate.descriptorSetCount=setCount;allocate.pSetLayouts=layouts.data();
      if(!checked(vk.AllocateDescriptorSets(device,&allocate,sets.data()),"allocate-descriptor-sets"))return false;
      for(size_t index=0;index<descriptors.size();++index){const auto &descriptor=descriptors[index];
        VkDescriptorBufferInfo buffer{buffers[index].buffer,call.layout().memberOffset,call.layout().memberBytes};
        VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};write.dstSet=sets[descriptor.set];write.dstBinding=descriptor.binding;write.descriptorCount=1;write.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;write.pBufferInfo=&buffer;
        vk.UpdateDescriptorSets(device,1,&write,0,nullptr);
      }
    }
    VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};layout.setLayoutCount=setCount;layout.pSetLayouts=layouts.data();
    if(!checked(vk.CreatePipelineLayout(device,&layout,nullptr,&pipelineLayout),"create-pipeline-layout"))return false;
    VkShaderModuleCreateInfo module{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};module.codeSize=call.words().size()*sizeof(uint32_t);module.pCode=call.words().data();
    if(!checked(vk.CreateShaderModule(device,&module,nullptr,&shader),"create-shader-module"))return false;
    VkComputePipelineCreateInfo compute{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};compute.layout=pipelineLayout;
    compute.stage.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;compute.stage.stage=VK_SHADER_STAGE_COMPUTE_BIT;compute.stage.module=shader;compute.stage.pName=call.entryPoint().c_str();
    if(!checked(vk.CreateComputePipelines(device,VK_NULL_HANDLE,1,&compute,nullptr,&pipeline),"create-compute-pipeline"))return false;
    VkCommandPoolCreateInfo pool{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};pool.queueFamilyIndex=queueFamily;
    if(!checked(vk.CreateCommandPool(device,&pool,nullptr,&commandPool),"create-command-pool"))return false;
    VkCommandBufferAllocateInfo allocate{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};allocate.commandPool=commandPool;allocate.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY;allocate.commandBufferCount=1;
    if(!checked(vk.AllocateCommandBuffers(device,&allocate,&command),"allocate-command-buffer"))return false;
    VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};begin.flags=VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    if(!checked(vk.BeginCommandBuffer(command,&begin),"begin-command-buffer"))return false;
    VkMemoryBarrier upload{VK_STRUCTURE_TYPE_MEMORY_BARRIER};upload.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;upload.dstAccessMask=VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT;
    vk.CmdPipelineBarrier(command,VK_PIPELINE_STAGE_HOST_BIT,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,0,1,&upload,0,nullptr,0,nullptr);
    vk.CmdBindPipeline(command,VK_PIPELINE_BIND_POINT_COMPUTE,pipeline);
    if(setCount)vk.CmdBindDescriptorSets(command,VK_PIPELINE_BIND_POINT_COMPUTE,pipelineLayout,0,setCount,sets.data(),0,nullptr);
    vk.CmdDispatch(command,1,1,1);
    VkMemoryBarrier download{VK_STRUCTURE_TYPE_MEMORY_BARRIER};download.srcAccessMask=VK_ACCESS_SHADER_WRITE_BIT;download.dstAccessMask=VK_ACCESS_HOST_READ_BIT;
    vk.CmdPipelineBarrier(command,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,1,&download,0,nullptr,0,nullptr);
    if(!checked(vk.EndCommandBuffer(command),"end-command-buffer"))return false;
    VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    if(!checked(vk.CreateFence(device,&fenceInfo,nullptr,&fence),"create-fence"))return false;
    report.state=GpuSoftwareState::Prepared;report.stage="prepared";report.failure=GpuSoftwareFailure::None;report.reason.clear();return true;
  }
  ~Impl(){
    if(device&&vk.DestroyDevice){
      if(fence&&vk.DestroyFence)vk.DestroyFence(device,fence,nullptr);
      if(commandPool&&vk.DestroyCommandPool)vk.DestroyCommandPool(device,commandPool,nullptr);
      if(pipeline&&vk.DestroyPipeline)vk.DestroyPipeline(device,pipeline,nullptr);
      if(shader&&vk.DestroyShaderModule)vk.DestroyShaderModule(device,shader,nullptr);
      if(pipelineLayout&&vk.DestroyPipelineLayout)vk.DestroyPipelineLayout(device,pipelineLayout,nullptr);
      if(descriptorPool&&vk.DestroyDescriptorPool)vk.DestroyDescriptorPool(device,descriptorPool,nullptr);
      if(vk.DestroyDescriptorSetLayout)for(auto layout:layouts)if(layout)vk.DestroyDescriptorSetLayout(device,layout,nullptr);
      for(auto &buffer:buffers){
        if(buffer.mapped&&vk.UnmapMemory)vk.UnmapMemory(device,buffer.memory);
        if(buffer.buffer&&vk.DestroyBuffer)vk.DestroyBuffer(device,buffer.buffer,nullptr);
        if(buffer.memory&&vk.FreeMemory)vk.FreeMemory(device,buffer.memory,nullptr);
      }
      vk.DestroyDevice(device,nullptr);
    }
    if(instance&&vk.DestroyInstance)vk.DestroyInstance(instance,nullptr);
    if(loader)FreeLibrary(loader);
    for(auto entry=environment.rbegin();entry!=environment.rend();++entry)SetEnvironmentVariableW(entry->first.c_str(),entry->second?entry->second->c_str():nullptr);
    if(lease)activeSoftwareCall.clear(std::memory_order_release);
  }
};

GpuSoftwareVulkanCall::GpuSoftwareVulkanCall(std::unique_ptr<Impl> impl):impl_(std::move(impl)){}
GpuSoftwareVulkanCall GpuSoftwareVulkanCall::prepare(const GpuHostProof &proof,const GpuSoftwarePaths &paths,uint64_t generation,uint64_t submission){
  auto impl=std::make_unique<Impl>(proof,generation,submission);impl->prepare(paths);return GpuSoftwareVulkanCall(std::move(impl));
}
GpuSoftwareVulkanCall::GpuSoftwareVulkanCall(GpuSoftwareVulkanCall &&)noexcept=default;
std::unique_ptr<GpuSoftwareVulkanCall::Impl> &GpuSoftwareVulkanCall::retained(){
  // The named process owner survives C++ shutdown: an outstanding GPU job must
  // not be destroyed through Vulkan while the external process is exiting.
  static auto *slot=new std::unique_ptr<Impl>();return *slot;
}
void GpuSoftwareVulkanCall::retainOutstanding(){if(impl_&&impl_->inFlight())retained()=std::move(impl_);}
const GpuSoftwareReport *GpuSoftwareVulkanCall::retainedReport(){const auto &slot=retained();return slot?&slot->report:nullptr;}
std::optional<GpuSoftwareVulkanCall> GpuSoftwareVulkanCall::resumeRetained(uint64_t generation,uint64_t submission){
  auto &slot=retained();if(!slot||slot->report.deviceGeneration!=generation||slot->report.submissionId!=submission)return std::nullopt;
  return GpuSoftwareVulkanCall(std::move(slot));
}
GpuSoftwareVulkanCall &GpuSoftwareVulkanCall::operator=(GpuSoftwareVulkanCall &&other)noexcept{
  if(this!=&other){retainOutstanding();impl_=std::move(other.impl_);}return *this;
}
GpuSoftwareVulkanCall::~GpuSoftwareVulkanCall(){retainOutstanding();}
const GpuSoftwareReport &GpuSoftwareVulkanCall::report()const{return impl_->report;}
const GpuHostProof &GpuSoftwareVulkanCall::hostProof()const{return impl_->proof;}
const std::vector<GpuSoftwareOutput> &GpuSoftwareVulkanCall::outputs()const{return impl_->outputs;}
const GpuSoftwareReport &GpuSoftwareVulkanCall::submit(){
  auto &state=*impl_;auto &report=state.report;
  if(report.state!=GpuSoftwareState::Prepared){state.fail(GpuSoftwareFailure::Input,"submit-order","only a prepared call can be submitted once");return report;}
  VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};submit.commandBufferCount=1;submit.pCommandBuffers=&state.command;
  const auto result=state.vk.QueueSubmit(state.queue,1,&submit,state.fence);
  if(!state.checked(result,"queue-submit"))return report;
  report.submitted=true;report.state=GpuSoftwareState::Submitted;report.stage="submitted";report.failure=GpuSoftwareFailure::None;report.reason.clear();return report;
}
const GpuSoftwareReport &GpuSoftwareVulkanCall::wait(uint64_t timeoutNanoseconds){
  auto &state=*impl_;auto &report=state.report;
  if((report.state!=GpuSoftwareState::Submitted&&report.state!=GpuSoftwareState::Unfinished)||!timeoutNanoseconds||timeoutNanoseconds==UINT64_MAX){
    state.fail(GpuSoftwareFailure::Input,"wait-parameters","an outstanding call and an explicit positive finite timeout are required");return report;
  }
  const auto result=state.vk.WaitForFences(state.device,1,&state.fence,VK_TRUE,timeoutNanoseconds);report.vkResult=int32_t(result);
  if(result==VK_TIMEOUT){report.state=GpuSoftwareState::Unfinished;report.failure=GpuSoftwareFailure::None;report.stage="wait";report.reason="fence is still outstanding; no output publication or resource retirement";return report;}
  if(!state.checked(result,"wait")){if(report.state!=GpuSoftwareState::DeviceLost)report.state=GpuSoftwareState::Unfinished;return report;}
  report.completionKnown=true;report.state=GpuSoftwareState::Completed;
  std::vector<GpuSoftwareOutput> outputs;const auto &descriptors=state.proof.call().descriptors();
  for(size_t index=0;index<descriptors.size();++index)if(descriptors[index].access!=GpuResourceAccess::Read){
    report.resourceIndex=uint32_t(index);auto &buffer=state.buffers[index];
    if(!buffer.coherent){VkMappedMemoryRange range{VK_STRUCTURE_TYPE_MAPPED_MEMORY_RANGE};range.memory=buffer.memory;range.offset=0;range.size=VK_WHOLE_SIZE;
      if(!state.checked(state.vk.InvalidateMappedMemoryRanges(state.device,1,&range),"invalidate-output-memory"))return report;}
    uint32_t bits;std::memcpy(&bits,buffer.mapped,sizeof(bits));outputs.push_back({descriptors[index],bits});
  }
  state.outputs=std::move(outputs);report.outputsAvailable=true;report.resourceIndex.reset();report.failure=GpuSoftwareFailure::None;report.stage="completed";report.reason.clear();return report;
}
#undef TSFG_DEVICE_FUNCTIONS
} // namespace tsfg::commonProgram
