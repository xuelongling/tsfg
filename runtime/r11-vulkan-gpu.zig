// SPDX-License-Identifier: MIT
//! R11 Production Vulkan 1.3 Compute Device Backend (Zero Compiler Dependency).
//! Targets the locked Windows Lavapipe Vulkan 1.3 stack (`E:\tsfg-cache\lavapipe\vulkan-1.dll` +
//! `lvp_icd.x86_64.json`) with:
//!   - Dynamic Vulkan loader & device function resolution (`vkGetInstanceProcAddr`/`vkGetDeviceProcAddr`)
//!   - Real device property & feature negotiation (rejects unsupported requested features!)
//!   - Explicit `GpuBuffer` lifecycle with host-visible upload/download & strict memory OOM budget
//!   - Integrity-sealed Pipeline Cache (magic + SHA-256) rejecting corrupted caches & cleanly rebuilding
//!   - Versioned `GpuKernelCell` hot-reload with real in-flight `VkFence` protection & deferred destruction
//!   - `VK_ERROR_DEVICE_LOST` fault state isolation & clean handle teardown
const std = @import("std");

const HMODULE = *anyopaque;
const FARPROC = *const anyopaque;

extern "kernel32" fn LoadLibraryW(lpLibFileName: [*:0]const u16) callconv(.winapi) ?HMODULE;
extern "kernel32" fn GetProcAddress(hModule: HMODULE, lpProcName: [*:0]const u8) callconv(.winapi) ?FARPROC;
extern "kernel32" fn FreeLibrary(hLibModule: HMODULE) callconv(.winapi) c_int;
extern "kernel32" fn SetEnvironmentVariableW(lpName: [*:0]const u16, lpValue: ?[*:0]const u16) callconv(.winapi) c_int;

pub const GpuError = error{
    LoaderMissing,
    SymbolMissing,
    NoVulkanDevice,
    NoComputeQueue,
    NoMemoryType,
    VulkanCallFailed,
    FeatureUnsupported,
    GpuOutOfMemory,
    CorruptPipelineCache,
    DeviceLost,
    InvalidSpirv,
    InvalidBufferRange,
    FenceTimeout,
    OutOfMemory,
};

// Minimal Vulkan 1.3 C ABI constants & structures (Windows x86-64 exact layout)
const VkResult = i32;
const VK_SUCCESS: VkResult = 0;
const VK_ERROR_DEVICE_LOST: VkResult = -4;
const VkBool32 = u32;
const VkFlags = u32;
const VkDeviceSize = u64;

const VkInstance = ?*anyopaque;
const VkPhysicalDevice = ?*anyopaque;
const VkDevice = ?*anyopaque;
const VkQueue = ?*anyopaque;
const VkCommandBuffer = ?*anyopaque;

const VkBuffer = u64;
const VkDeviceMemory = u64;
const VkDescriptorSetLayout = u64;
const VkDescriptorPool = u64;
const VkDescriptorSet = u64;
const VkPipelineLayout = u64;
const VkShaderModule = u64;
const VkPipeline = u64;
const VkPipelineCache = u64;
const VkCommandPool = u64;
const VkFence = u64;

const VK_STRUCTURE_TYPE_APPLICATION_INFO: u32 = 0;
const VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO: u32 = 1;
const VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO: u32 = 2;
const VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO: u32 = 3;
const VK_STRUCTURE_TYPE_SUBMIT_INFO: u32 = 4;
const VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO: u32 = 5;
const VK_STRUCTURE_TYPE_FENCE_CREATE_INFO: u32 = 8;
const VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO: u32 = 12;
const VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO: u32 = 16;
const VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO: u32 = 17;
const VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO: u32 = 18;
const VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO: u32 = 29;
const VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO: u32 = 30;
const VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO: u32 = 32;
const VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO: u32 = 33;
const VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO: u32 = 34;
const VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET: u32 = 35;
const VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO: u32 = 39;
const VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO: u32 = 40;
const VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO: u32 = 42;
const VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER: u32 = 44;

const VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU: u32 = 1;
const VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU: u32 = 2;
const VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU: u32 = 3;
const VK_PHYSICAL_DEVICE_TYPE_CPU: u32 = 4;

const VK_QUEUE_COMPUTE_BIT: u32 = 0x00000002;
const VK_BUFFER_USAGE_TRANSFER_SRC_BIT: u32 = 0x00000001;
const VK_BUFFER_USAGE_TRANSFER_DST_BIT: u32 = 0x00000002;
const VK_BUFFER_USAGE_STORAGE_BUFFER_BIT: u32 = 0x00000080;
const VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT: u32 = 0x00000001;
const VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT: u32 = 0x00000002;
const VK_MEMORY_PROPERTY_HOST_COHERENT_BIT: u32 = 0x00000004;
const VK_ACCESS_SHADER_READ_BIT: u32 = 0x00000020;
const VK_ACCESS_SHADER_WRITE_BIT: u32 = 0x00000040;
const VK_ACCESS_TRANSFER_READ_BIT: u32 = 0x00000800;
const VK_ACCESS_TRANSFER_WRITE_BIT: u32 = 0x00001000;
const VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT: u32 = 0x00000800;
const VK_PIPELINE_STAGE_TRANSFER_BIT: u32 = 0x00001000;
const VK_QUEUE_FAMILY_IGNORED: u32 = 0xFFFFFFFF;
const VK_DESCRIPTOR_TYPE_STORAGE_BUFFER: u32 = 7;
const VK_SHADER_STAGE_COMPUTE_BIT: u32 = 0x00000020;
const VK_PIPELINE_BIND_POINT_COMPUTE: u32 = 1;
const VK_COMMAND_BUFFER_LEVEL_PRIMARY: u32 = 0;
const VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT: u32 = 0x00000001;
const VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT: u32 = 0x00000002;
const VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT: u32 = 0x00000001;

const VkApplicationInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_APPLICATION_INFO,
    pNext: ?*const anyopaque = null,
    pApplicationName: [*:0]const u8 = "tsfg-r11",
    applicationVersion: u32 = 1,
    pEngineName: [*:0]const u8 = "tsfg",
    engineVersion: u32 = 1,
    apiVersion: u32 = (1 << 22) | (3 << 12), // Vulkan 1.3
};

const VkInstanceCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    pApplicationInfo: ?*const VkApplicationInfo = null,
    enabledLayerCount: u32 = 0,
    ppEnabledLayerNames: ?[*]const [*:0]const u8 = null,
    enabledExtensionCount: u32 = 0,
    ppEnabledExtensionNames: ?[*]const [*:0]const u8 = null,
};

const VkPhysicalDeviceProperties = extern struct {
    apiVersion: u32,
    driverVersion: u32,
    vendorID: u32,
    deviceID: u32,
    deviceType: u32,
    deviceName: [256]u8,
    pipelineCacheUUID: [16]u8,
    limits_pad: [512]u8,
    sparse_pad: [32]u8,
};

const VkPhysicalDeviceFeatures = extern struct {
    features: [55]VkBool32,
};

const VkQueueFamilyProperties = extern struct {
    queueFlags: VkFlags,
    queueCount: u32,
    timestampValidBits: u32,
    minImageTransferGranularity: [3]u32,
};

const VkMemoryType = extern struct {
    propertyFlags: VkFlags,
    heapIndex: u32,
};

const VkMemoryHeap = extern struct {
    size: VkDeviceSize,
    flags: VkFlags,
};

const VkPhysicalDeviceMemoryProperties = extern struct {
    memoryTypeCount: u32,
    memoryTypes: [32]VkMemoryType,
    memoryHeapCount: u32,
    memoryHeaps: [16]VkMemoryHeap,
};

const VkDeviceQueueCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    queueFamilyIndex: u32,
    queueCount: u32 = 1,
    pQueuePriorities: *const f32,
};

const VkDeviceCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    queueCreateInfoCount: u32 = 1,
    pQueueCreateInfos: *const VkDeviceQueueCreateInfo,
    enabledLayerCount: u32 = 0,
    ppEnabledLayerNames: ?[*]const [*:0]const u8 = null,
    enabledExtensionCount: u32 = 0,
    ppEnabledExtensionNames: ?[*]const [*:0]const u8 = null,
    pEnabledFeatures: ?*const VkPhysicalDeviceFeatures = null,
};

const VkBufferCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    size: VkDeviceSize,
    usage: VkFlags,
    sharingMode: u32 = 0,
    queueFamilyIndexCount: u32 = 0,
    pQueueFamilyIndices: ?[*]const u32 = null,
};

const VkMemoryRequirements = extern struct {
    size: VkDeviceSize,
    alignment: VkDeviceSize,
    memoryTypeBits: u32,
};

const VkMemoryAllocateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
    pNext: ?*const anyopaque = null,
    allocationSize: VkDeviceSize,
    memoryTypeIndex: u32,
};

const VkDescriptorSetLayoutBinding = extern struct {
    binding: u32,
    descriptorType: u32,
    descriptorCount: u32,
    stageFlags: VkFlags,
    pImmutableSamplers: ?*const anyopaque = null,
};

const VkDescriptorSetLayoutCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    bindingCount: u32,
    pBindings: [*]const VkDescriptorSetLayoutBinding,
};

const VkDescriptorPoolSize = extern struct {
    type: u32,
    descriptorCount: u32,
};

const VkDescriptorPoolCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    maxSets: u32,
    poolSizeCount: u32,
    pPoolSizes: [*]const VkDescriptorPoolSize,
};

const VkDescriptorSetAllocateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,
    pNext: ?*const anyopaque = null,
    descriptorPool: VkDescriptorPool,
    descriptorSetCount: u32 = 1,
    pSetLayouts: *const VkDescriptorSetLayout,
};

const VkDescriptorBufferInfo = extern struct {
    buffer: VkBuffer,
    offset: VkDeviceSize = 0,
    range: VkDeviceSize,
};

const VkWriteDescriptorSet = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,
    pNext: ?*const anyopaque = null,
    dstSet: VkDescriptorSet,
    dstBinding: u32,
    dstArrayElement: u32 = 0,
    descriptorCount: u32 = 1,
    descriptorType: u32 = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
    pImageInfo: ?*const anyopaque = null,
    pBufferInfo: *const VkDescriptorBufferInfo,
    pTexelBufferView: ?*const anyopaque = null,
};

const VkPushConstantRange = extern struct {
    stageFlags: VkFlags,
    offset: u32,
    size: u32,
};

const VkBufferCopy = extern struct {
    srcOffset: VkDeviceSize = 0,
    dstOffset: VkDeviceSize = 0,
    size: VkDeviceSize,
};

const VkBufferMemoryBarrier = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
    pNext: ?*const anyopaque = null,
    srcAccessMask: VkFlags,
    dstAccessMask: VkFlags,
    srcQueueFamilyIndex: u32 = VK_QUEUE_FAMILY_IGNORED,
    dstQueueFamilyIndex: u32 = VK_QUEUE_FAMILY_IGNORED,
    buffer: VkBuffer,
    offset: VkDeviceSize = 0,
    size: VkDeviceSize,
};

const VkPipelineLayoutCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    setLayoutCount: u32 = 1,
    pSetLayouts: *const VkDescriptorSetLayout,
    pushConstantRangeCount: u32 = 0,
    pPushConstantRanges: ?[*]const VkPushConstantRange = null,
};

const VkShaderModuleCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    codeSize: usize,
    pCode: [*]const u32,
};

const VkPipelineCacheCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    initialDataSize: usize = 0,
    pInitialData: ?*const anyopaque = null,
};

const VkPipelineShaderStageCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    stage: VkFlags = VK_SHADER_STAGE_COMPUTE_BIT,
    module: VkShaderModule,
    pName: [*:0]const u8 = "main",
    pSpecializationInfo: ?*const anyopaque = null,
};

const VkComputePipelineCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
    stage: VkPipelineShaderStageCreateInfo,
    layout: VkPipelineLayout,
    basePipelineHandle: VkPipeline = 0,
    basePipelineIndex: i32 = -1,
};

const VkCommandPoolCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT,
    queueFamilyIndex: u32,
};

const VkCommandBufferAllocateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,
    pNext: ?*const anyopaque = null,
    commandPool: VkCommandPool,
    level: u32 = VK_COMMAND_BUFFER_LEVEL_PRIMARY,
    commandBufferCount: u32 = 1,
};

const VkCommandBufferBeginInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT,
    pInheritanceInfo: ?*const anyopaque = null,
};

const VkFenceCreateInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO,
    pNext: ?*const anyopaque = null,
    flags: VkFlags = 0,
};

const VkSubmitInfo = extern struct {
    sType: u32 = VK_STRUCTURE_TYPE_SUBMIT_INFO,
    pNext: ?*const anyopaque = null,
    waitSemaphoreCount: u32 = 0,
    pWaitSemaphores: ?*const anyopaque = null,
    pWaitDstStageMask: ?*const u32 = null,
    commandBufferCount: u32 = 1,
    pCommandBuffers: *const VkCommandBuffer,
    signalSemaphoreCount: u32 = 0,
    pSignalSemaphores: ?*const anyopaque = null,
};

// Function pointer table
const VkFns = struct {
    GetInstanceProcAddr: *const fn (VkInstance, [*:0]const u8) callconv(.winapi) ?FARPROC,
    GetDeviceProcAddr: *const fn (VkDevice, [*:0]const u8) callconv(.winapi) ?FARPROC,
    CreateInstance: *const fn (*const VkInstanceCreateInfo, ?*const anyopaque, *VkInstance) callconv(.winapi) VkResult,
    DestroyInstance: *const fn (VkInstance, ?*const anyopaque) callconv(.winapi) void,
    EnumeratePhysicalDevices: *const fn (VkInstance, *u32, ?[*]VkPhysicalDevice) callconv(.winapi) VkResult,
    GetPhysicalDeviceProperties: *const fn (VkPhysicalDevice, *VkPhysicalDeviceProperties) callconv(.winapi) void,
    GetPhysicalDeviceFeatures: *const fn (VkPhysicalDevice, *VkPhysicalDeviceFeatures) callconv(.winapi) void,
    GetPhysicalDeviceMemoryProperties: *const fn (VkPhysicalDevice, *VkPhysicalDeviceMemoryProperties) callconv(.winapi) void,
    GetPhysicalDeviceQueueFamilyProperties: *const fn (VkPhysicalDevice, *u32, ?[*]VkQueueFamilyProperties) callconv(.winapi) void,
    CreateDevice: *const fn (VkPhysicalDevice, *const VkDeviceCreateInfo, ?*const anyopaque, *VkDevice) callconv(.winapi) VkResult,
    DestroyDevice: *const fn (VkDevice, ?*const anyopaque) callconv(.winapi) void,
    GetDeviceQueue: *const fn (VkDevice, u32, u32, *VkQueue) callconv(.winapi) void,
    CreateBuffer: *const fn (VkDevice, *const VkBufferCreateInfo, ?*const anyopaque, *VkBuffer) callconv(.winapi) VkResult,
    DestroyBuffer: *const fn (VkDevice, VkBuffer, ?*const anyopaque) callconv(.winapi) void,
    GetBufferMemoryRequirements: *const fn (VkDevice, VkBuffer, *VkMemoryRequirements) callconv(.winapi) void,
    AllocateMemory: *const fn (VkDevice, *const VkMemoryAllocateInfo, ?*const anyopaque, *VkDeviceMemory) callconv(.winapi) VkResult,
    FreeMemory: *const fn (VkDevice, VkDeviceMemory, ?*const anyopaque) callconv(.winapi) void,
    BindBufferMemory: *const fn (VkDevice, VkBuffer, VkDeviceMemory, VkDeviceSize) callconv(.winapi) VkResult,
    MapMemory: *const fn (VkDevice, VkDeviceMemory, VkDeviceSize, VkDeviceSize, VkFlags, *?*anyopaque) callconv(.winapi) VkResult,
    UnmapMemory: *const fn (VkDevice, VkDeviceMemory) callconv(.winapi) void,
    CreateDescriptorSetLayout: *const fn (VkDevice, *const VkDescriptorSetLayoutCreateInfo, ?*const anyopaque, *VkDescriptorSetLayout) callconv(.winapi) VkResult,
    DestroyDescriptorSetLayout: *const fn (VkDevice, VkDescriptorSetLayout, ?*const anyopaque) callconv(.winapi) void,
    CreateDescriptorPool: *const fn (VkDevice, *const VkDescriptorPoolCreateInfo, ?*const anyopaque, *VkDescriptorPool) callconv(.winapi) VkResult,
    DestroyDescriptorPool: *const fn (VkDevice, VkDescriptorPool, ?*const anyopaque) callconv(.winapi) void,
    AllocateDescriptorSets: *const fn (VkDevice, *const VkDescriptorSetAllocateInfo, *VkDescriptorSet) callconv(.winapi) VkResult,
    FreeDescriptorSets: *const fn (VkDevice, VkDescriptorPool, u32, *const VkDescriptorSet) callconv(.winapi) VkResult,
    UpdateDescriptorSets: *const fn (VkDevice, u32, [*]const VkWriteDescriptorSet, u32, ?*const anyopaque) callconv(.winapi) void,
    CreatePipelineLayout: *const fn (VkDevice, *const VkPipelineLayoutCreateInfo, ?*const anyopaque, *VkPipelineLayout) callconv(.winapi) VkResult,
    DestroyPipelineLayout: *const fn (VkDevice, VkPipelineLayout, ?*const anyopaque) callconv(.winapi) void,
    CreateShaderModule: *const fn (VkDevice, *const VkShaderModuleCreateInfo, ?*const anyopaque, *VkShaderModule) callconv(.winapi) VkResult,
    DestroyShaderModule: *const fn (VkDevice, VkShaderModule, ?*const anyopaque) callconv(.winapi) void,
    CreatePipelineCache: *const fn (VkDevice, *const VkPipelineCacheCreateInfo, ?*const anyopaque, *VkPipelineCache) callconv(.winapi) VkResult,
    DestroyPipelineCache: *const fn (VkDevice, VkPipelineCache, ?*const anyopaque) callconv(.winapi) void,
    GetPipelineCacheData: *const fn (VkDevice, VkPipelineCache, *usize, ?*anyopaque) callconv(.winapi) VkResult,
    CreateComputePipelines: *const fn (VkDevice, VkPipelineCache, u32, *const VkComputePipelineCreateInfo, ?*const anyopaque, *VkPipeline) callconv(.winapi) VkResult,
    DestroyPipeline: *const fn (VkDevice, VkPipeline, ?*const anyopaque) callconv(.winapi) void,
    CreateCommandPool: *const fn (VkDevice, *const VkCommandPoolCreateInfo, ?*const anyopaque, *VkCommandPool) callconv(.winapi) VkResult,
    DestroyCommandPool: *const fn (VkDevice, VkCommandPool, ?*const anyopaque) callconv(.winapi) void,
    AllocateCommandBuffers: *const fn (VkDevice, *const VkCommandBufferAllocateInfo, *VkCommandBuffer) callconv(.winapi) VkResult,
    FreeCommandBuffers: *const fn (VkDevice, VkCommandPool, u32, *const VkCommandBuffer) callconv(.winapi) void,
    BeginCommandBuffer: *const fn (VkCommandBuffer, *const VkCommandBufferBeginInfo) callconv(.winapi) VkResult,
    EndCommandBuffer: *const fn (VkCommandBuffer) callconv(.winapi) VkResult,
    CmdBindPipeline: *const fn (VkCommandBuffer, u32, VkPipeline) callconv(.winapi) void,
    CmdBindDescriptorSets: *const fn (VkCommandBuffer, u32, VkPipelineLayout, u32, u32, *const VkDescriptorSet, u32, ?*const u32) callconv(.winapi) void,
    CmdPushConstants: *const fn (VkCommandBuffer, VkPipelineLayout, VkFlags, u32, u32, *const anyopaque) callconv(.winapi) void,
    CmdCopyBuffer: *const fn (VkCommandBuffer, VkBuffer, VkBuffer, u32, *const VkBufferCopy) callconv(.winapi) void,
    CmdPipelineBarrier: *const fn (VkCommandBuffer, VkFlags, VkFlags, VkFlags, u32, ?*const anyopaque, u32, ?[*]const VkBufferMemoryBarrier, u32, ?*const anyopaque) callconv(.winapi) void,
    CmdDispatch: *const fn (VkCommandBuffer, u32, u32, u32) callconv(.winapi) void,
    CreateFence: *const fn (VkDevice, *const VkFenceCreateInfo, ?*const anyopaque, *VkFence) callconv(.winapi) VkResult,
    DestroyFence: *const fn (VkDevice, VkFence, ?*const anyopaque) callconv(.winapi) void,
    QueueSubmit: *const fn (VkQueue, u32, *const VkSubmitInfo, VkFence) callconv(.winapi) VkResult,
    WaitForFences: *const fn (VkDevice, u32, *const VkFence, VkBool32, u64) callconv(.winapi) VkResult,
    DeviceWaitIdle: *const fn (VkDevice) callconv(.winapi) VkResult,
};

fn loadInstFn(comptime T: type, gipa: *const fn (VkInstance, [*:0]const u8) callconv(.winapi) ?FARPROC, inst: VkInstance, name: [:0]const u8) GpuError!T {
    const p = gipa(inst, name.ptr) orelse return error.SymbolMissing;
    return @ptrCast(@alignCast(p));
}

fn loadDevFn(comptime T: type, gdpa: *const fn (VkDevice, [*:0]const u8) callconv(.winapi) ?FARPROC, dev: VkDevice, name: [:0]const u8) GpuError!T {
    const p = gdpa(dev, name.ptr) orelse return error.SymbolMissing;
    return @ptrCast(@alignCast(p));
}

pub const GpuBuffer = struct {
    buffer: VkBuffer = 0,
    memory: VkDeviceMemory = 0,
    byte_size: usize = 0,
    alloc_size: usize = 0,
    is_device_local: bool = false,
};

pub const DeviceInitOptions = struct {
    loader_path: []const u8,
    fallback_icd_path: []const u8 = "",
    memory_budget_bytes: usize = 64 * 1024 * 1024,
    prefer_software: bool = false,
    max_bindings: u32 = 8,
};

fn rankPhysicalDeviceType(device_type: u32) u32 {
    return switch (device_type) {
        VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU => 100,
        VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU => 80,
        VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU => 60,
        VK_PHYSICAL_DEVICE_TYPE_CPU => 20,
        else => 10,
    };
}

pub const KernelVersion = struct {
    version: u64,
    shader: VkShaderModule,
    pipeline: VkPipeline,
    in_flight_fences: u32 = 0,
    retired: bool = false,
};

pub const InFlightDispatch = struct {
    kernel: *KernelVersion,
    fence: VkFence,
    cmd: VkCommandBuffer,
    dset: VkDescriptorSet,
    completed: bool = false,
};

pub const VulkanGpuDevice = struct {
    allocator: std.mem.Allocator,
    loader: HMODULE,
    vk: VkFns,
    instance: VkInstance = null,
    physical: VkPhysicalDevice = null,
    device: VkDevice = null,
    queue: VkQueue = null,
    queue_family: u32 = 0,
    mem_props: VkPhysicalDeviceMemoryProperties = undefined,
    device_name: [256]u8 = [_]u8{0} ** 256,
    device_type: u32 = 0,
    used_fallback_icd: bool = false,
    api_version: u32 = 0,
    supports_f64: bool = false,
    device_lost: bool = false,
    max_bindings: u32 = 8,

    desc_layout: VkDescriptorSetLayout = 0,
    desc_pool: VkDescriptorPool = 0,
    pipe_layout: VkPipelineLayout = 0,
    pipe_cache: VkPipelineCache = 0,
    cmd_pool: VkCommandPool = 0,

    // Strict OOM memory budget
    memory_budget_bytes: usize,
    memory_used_bytes: usize = 0,

    // Hot-reloadable kernel cell + retired list
    current_kernel: ?*KernelVersion = null,
    retired_kernels: std.ArrayListUnmanaged(*KernelVersion) = .empty,
    reclaimed_kernels: u64 = 0,
    deferred_reclaims: u64 = 0,
    corrupt_cache_rejected: bool = false,

    pub fn init(
        allocator: std.mem.Allocator,
        loader_path: []const u8,
        icd_json_path: []const u8,
        memory_budget_bytes: usize,
    ) GpuError!VulkanGpuDevice {
        return initWithOptions(allocator, .{
            .loader_path = loader_path,
            .fallback_icd_path = icd_json_path,
            .memory_budget_bytes = memory_budget_bytes,
            .prefer_software = icd_json_path.len > 0,
        });
    }

    /// Hardware-first Windows Vulkan 1.3 initialization:
    ///   1. When `prefer_software == false`, probes system Vulkan loader WITHOUT overriding
    ///      `VK_ICD_FILENAMES`, selecting DISCRETE_GPU > INTEGRATED_GPU > VIRTUAL_GPU > CPU.
    ///   2. Falls back cleanly to `fallback_icd_path` (e.g. bundled Lavapipe) only if no
    ///      compute-capable hardware GPU exists on the host or `prefer_software == true`.
    pub fn initWithOptions(
        allocator: std.mem.Allocator,
        opts: DeviceInitOptions,
    ) GpuError!VulkanGpuDevice {
        const w_env_name = std.unicode.utf8ToUtf16LeAllocZ(allocator, "VK_ICD_FILENAMES") catch return error.OutOfMemory;
        defer allocator.free(w_env_name);

        var used_fallback = false;
        if (opts.prefer_software and opts.fallback_icd_path.len > 0) {
            const w_icd = std.unicode.utf8ToUtf16LeAllocZ(allocator, opts.fallback_icd_path) catch return error.OutOfMemory;
            defer allocator.free(w_icd);
            _ = SetEnvironmentVariableW(w_env_name, w_icd);
            used_fallback = true;
        }

        const w_loader = std.unicode.utf8ToUtf16LeAllocZ(allocator, opts.loader_path) catch return error.OutOfMemory;
        defer allocator.free(w_loader);
        const loader = LoadLibraryW(w_loader) orelse return error.LoaderMissing;
        errdefer _ = FreeLibrary(loader);

        const gipa_raw = GetProcAddress(loader, "vkGetInstanceProcAddr") orelse return error.SymbolMissing;
        const gipa: *const fn (VkInstance, [*:0]const u8) callconv(.winapi) ?FARPROC = @ptrCast(@alignCast(gipa_raw));

        const create_inst = try loadInstFn(@TypeOf(@as(VkFns, undefined).CreateInstance), gipa, null, "vkCreateInstance");
        const app_info = VkApplicationInfo{};
        const inst_ci = VkInstanceCreateInfo{ .pApplicationInfo = &app_info };
        var instance: VkInstance = null;
        if (create_inst(&inst_ci, null, &instance) != VK_SUCCESS or instance == null) {
            if (!used_fallback and opts.fallback_icd_path.len > 0) {
                const w_icd = std.unicode.utf8ToUtf16LeAllocZ(allocator, opts.fallback_icd_path) catch return error.OutOfMemory;
                defer allocator.free(w_icd);
                _ = SetEnvironmentVariableW(w_env_name, w_icd);
                used_fallback = true;
                if (create_inst(&inst_ci, null, &instance) != VK_SUCCESS or instance == null) return error.VulkanCallFailed;
            } else {
                return error.VulkanCallFailed;
            }
        }
        var destroy_inst = try loadInstFn(@TypeOf(@as(VkFns, undefined).DestroyInstance), gipa, instance, "vkDestroyInstance");
        errdefer destroy_inst(instance, null);

        var enum_phys = try loadInstFn(@TypeOf(@as(VkFns, undefined).EnumeratePhysicalDevices), gipa, instance, "vkEnumeratePhysicalDevices");
        var dev_count: u32 = 0;
        var enum_ok = (enum_phys(instance, &dev_count, null) == VK_SUCCESS and dev_count > 0);
        if (!enum_ok and !used_fallback and opts.fallback_icd_path.len > 0) {
            // Hardware-first found zero Vulkan devices on this host -> cleanly retry with fallback ICD!
            destroy_inst(instance, null);
            instance = null;
            const w_icd = std.unicode.utf8ToUtf16LeAllocZ(allocator, opts.fallback_icd_path) catch return error.OutOfMemory;
            defer allocator.free(w_icd);
            _ = SetEnvironmentVariableW(w_env_name, w_icd);
            used_fallback = true;
            if (create_inst(&inst_ci, null, &instance) != VK_SUCCESS or instance == null) return error.NoVulkanDevice;
            destroy_inst = try loadInstFn(@TypeOf(@as(VkFns, undefined).DestroyInstance), gipa, instance, "vkDestroyInstance");
            enum_phys = try loadInstFn(@TypeOf(@as(VkFns, undefined).EnumeratePhysicalDevices), gipa, instance, "vkEnumeratePhysicalDevices");
            dev_count = 0;
            enum_ok = (enum_phys(instance, &dev_count, null) == VK_SUCCESS and dev_count > 0);
        }
        if (!enum_ok) return error.NoVulkanDevice;

        const get_props = try loadInstFn(@TypeOf(@as(VkFns, undefined).GetPhysicalDeviceProperties), gipa, instance, "vkGetPhysicalDeviceProperties");
        const get_feats = try loadInstFn(@TypeOf(@as(VkFns, undefined).GetPhysicalDeviceFeatures), gipa, instance, "vkGetPhysicalDeviceFeatures");
        const get_mem = try loadInstFn(@TypeOf(@as(VkFns, undefined).GetPhysicalDeviceMemoryProperties), gipa, instance, "vkGetPhysicalDeviceMemoryProperties");
        const get_qf = try loadInstFn(@TypeOf(@as(VkFns, undefined).GetPhysicalDeviceQueueFamilyProperties), gipa, instance, "vkGetPhysicalDeviceQueueFamilyProperties");
        const create_dev = try loadInstFn(@TypeOf(@as(VkFns, undefined).CreateDevice), gipa, instance, "vkCreateDevice");
        const gdpa = try loadInstFn(@TypeOf(@as(VkFns, undefined).GetDeviceProcAddr), gipa, instance, "vkGetDeviceProcAddr");

        var phys_list: [16]VkPhysicalDevice = undefined;
        dev_count = @min(dev_count, 16);
        if (enum_phys(instance, &dev_count, &phys_list) != VK_SUCCESS or dev_count == 0) return error.NoVulkanDevice;

        // Hardware-first physical device ranking (or software llvmpipe when prefer_software is explicit)
        var physical = phys_list[0];
        var best_score: u32 = 0;
        var props: VkPhysicalDeviceProperties = undefined;
        for (phys_list[0..dev_count]) |p| {
            get_props(p, &props);
            const name_slice = std.mem.sliceTo(&props.deviceName, 0);
            var score = rankPhysicalDeviceType(props.deviceType);
            if (opts.prefer_software and std.mem.indexOf(u8, name_slice, "llvmpipe") != null) {
                score = 1000;
            }
            if (score > best_score) {
                best_score = score;
                physical = p;
            }
        }
        get_props(physical, &props);
        var feats: VkPhysicalDeviceFeatures = undefined;
        get_feats(physical, &feats);
        var mem_props: VkPhysicalDeviceMemoryProperties = undefined;
        get_mem(physical, &mem_props);

        // Find compute queue family
        var qf_count: u32 = 0;
        get_qf(physical, &qf_count, null);
        var qfs: [16]VkQueueFamilyProperties = undefined;
        qf_count = @min(qf_count, 16);
        get_qf(physical, &qf_count, &qfs);
        var qf_idx: ?u32 = null;
        for (qfs[0..qf_count], 0..) |qf, idx| {
            if ((qf.queueFlags & VK_QUEUE_COMPUTE_BIT) != 0) {
                qf_idx = @intCast(idx);
                break;
            }
        }
        const compute_qf = qf_idx orelse return error.NoComputeQueue;

        // Enable negotiated supported device features (e.g. shaderFloat64) in VkDeviceCreateInfo!
        var enabled_feats = VkPhysicalDeviceFeatures{ .features = [_]VkBool32{0} ** 55 };
        if (feats.features[36] != 0) {
            enabled_feats.features[36] = 1; // shaderFloat64
        }

        const prio: f32 = 1.0;
        const qci = VkDeviceQueueCreateInfo{ .queueFamilyIndex = compute_qf, .pQueuePriorities = &prio };
        const dci = VkDeviceCreateInfo{
            .pQueueCreateInfos = &qci,
            .pEnabledFeatures = &enabled_feats,
        };
        var device: VkDevice = null;
        if (create_dev(physical, &dci, null, &device) != VK_SUCCESS or device == null) {
            return error.VulkanCallFailed;
        }

        const vk = VkFns{
            .GetInstanceProcAddr = gipa,
            .GetDeviceProcAddr = gdpa,
            .CreateInstance = create_inst,
            .DestroyInstance = destroy_inst,
            .EnumeratePhysicalDevices = enum_phys,
            .GetPhysicalDeviceProperties = get_props,
            .GetPhysicalDeviceFeatures = get_feats,
            .GetPhysicalDeviceMemoryProperties = get_mem,
            .GetPhysicalDeviceQueueFamilyProperties = get_qf,
            .CreateDevice = create_dev,
            .DestroyDevice = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyDevice), gdpa, device, "vkDestroyDevice"),
            .GetDeviceQueue = try loadDevFn(@TypeOf(@as(VkFns, undefined).GetDeviceQueue), gdpa, device, "vkGetDeviceQueue"),
            .CreateBuffer = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateBuffer), gdpa, device, "vkCreateBuffer"),
            .DestroyBuffer = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyBuffer), gdpa, device, "vkDestroyBuffer"),
            .GetBufferMemoryRequirements = try loadDevFn(@TypeOf(@as(VkFns, undefined).GetBufferMemoryRequirements), gdpa, device, "vkGetBufferMemoryRequirements"),
            .AllocateMemory = try loadDevFn(@TypeOf(@as(VkFns, undefined).AllocateMemory), gdpa, device, "vkAllocateMemory"),
            .FreeMemory = try loadDevFn(@TypeOf(@as(VkFns, undefined).FreeMemory), gdpa, device, "vkFreeMemory"),
            .BindBufferMemory = try loadDevFn(@TypeOf(@as(VkFns, undefined).BindBufferMemory), gdpa, device, "vkBindBufferMemory"),
            .MapMemory = try loadDevFn(@TypeOf(@as(VkFns, undefined).MapMemory), gdpa, device, "vkMapMemory"),
            .UnmapMemory = try loadDevFn(@TypeOf(@as(VkFns, undefined).UnmapMemory), gdpa, device, "vkUnmapMemory"),
            .CreateDescriptorSetLayout = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateDescriptorSetLayout), gdpa, device, "vkCreateDescriptorSetLayout"),
            .DestroyDescriptorSetLayout = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyDescriptorSetLayout), gdpa, device, "vkDestroyDescriptorSetLayout"),
            .CreateDescriptorPool = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateDescriptorPool), gdpa, device, "vkCreateDescriptorPool"),
            .DestroyDescriptorPool = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyDescriptorPool), gdpa, device, "vkDestroyDescriptorPool"),
            .AllocateDescriptorSets = try loadDevFn(@TypeOf(@as(VkFns, undefined).AllocateDescriptorSets), gdpa, device, "vkAllocateDescriptorSets"),
            .FreeDescriptorSets = try loadDevFn(@TypeOf(@as(VkFns, undefined).FreeDescriptorSets), gdpa, device, "vkFreeDescriptorSets"),
            .UpdateDescriptorSets = try loadDevFn(@TypeOf(@as(VkFns, undefined).UpdateDescriptorSets), gdpa, device, "vkUpdateDescriptorSets"),
            .CreatePipelineLayout = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreatePipelineLayout), gdpa, device, "vkCreatePipelineLayout"),
            .DestroyPipelineLayout = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyPipelineLayout), gdpa, device, "vkDestroyPipelineLayout"),
            .CreateShaderModule = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateShaderModule), gdpa, device, "vkCreateShaderModule"),
            .DestroyShaderModule = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyShaderModule), gdpa, device, "vkDestroyShaderModule"),
            .CreatePipelineCache = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreatePipelineCache), gdpa, device, "vkCreatePipelineCache"),
            .DestroyPipelineCache = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyPipelineCache), gdpa, device, "vkDestroyPipelineCache"),
            .GetPipelineCacheData = try loadDevFn(@TypeOf(@as(VkFns, undefined).GetPipelineCacheData), gdpa, device, "vkGetPipelineCacheData"),
            .CreateComputePipelines = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateComputePipelines), gdpa, device, "vkCreateComputePipelines"),
            .DestroyPipeline = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyPipeline), gdpa, device, "vkDestroyPipeline"),
            .CreateCommandPool = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateCommandPool), gdpa, device, "vkCreateCommandPool"),
            .DestroyCommandPool = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyCommandPool), gdpa, device, "vkDestroyCommandPool"),
            .AllocateCommandBuffers = try loadDevFn(@TypeOf(@as(VkFns, undefined).AllocateCommandBuffers), gdpa, device, "vkAllocateCommandBuffers"),
            .FreeCommandBuffers = try loadDevFn(@TypeOf(@as(VkFns, undefined).FreeCommandBuffers), gdpa, device, "vkFreeCommandBuffers"),
            .BeginCommandBuffer = try loadDevFn(@TypeOf(@as(VkFns, undefined).BeginCommandBuffer), gdpa, device, "vkBeginCommandBuffer"),
            .EndCommandBuffer = try loadDevFn(@TypeOf(@as(VkFns, undefined).EndCommandBuffer), gdpa, device, "vkEndCommandBuffer"),
            .CmdBindPipeline = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdBindPipeline), gdpa, device, "vkCmdBindPipeline"),
            .CmdBindDescriptorSets = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdBindDescriptorSets), gdpa, device, "vkCmdBindDescriptorSets"),
            .CmdPushConstants = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdPushConstants), gdpa, device, "vkCmdPushConstants"),
            .CmdCopyBuffer = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdCopyBuffer), gdpa, device, "vkCmdCopyBuffer"),
            .CmdPipelineBarrier = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdPipelineBarrier), gdpa, device, "vkCmdPipelineBarrier"),
            .CmdDispatch = try loadDevFn(@TypeOf(@as(VkFns, undefined).CmdDispatch), gdpa, device, "vkCmdDispatch"),
            .CreateFence = try loadDevFn(@TypeOf(@as(VkFns, undefined).CreateFence), gdpa, device, "vkCreateFence"),
            .DestroyFence = try loadDevFn(@TypeOf(@as(VkFns, undefined).DestroyFence), gdpa, device, "vkDestroyFence"),
            .QueueSubmit = try loadDevFn(@TypeOf(@as(VkFns, undefined).QueueSubmit), gdpa, device, "vkQueueSubmit"),
            .WaitForFences = try loadDevFn(@TypeOf(@as(VkFns, undefined).WaitForFences), gdpa, device, "vkWaitForFences"),
            .DeviceWaitIdle = try loadDevFn(@TypeOf(@as(VkFns, undefined).DeviceWaitIdle), gdpa, device, "vkDeviceWaitIdle"),
        };

        const n_bindings = @min(@max(opts.max_bindings, 3), 8);
        var self = VulkanGpuDevice{
            .allocator = allocator,
            .loader = loader,
            .vk = vk,
            .instance = instance,
            .physical = physical,
            .device = device,
            .queue_family = compute_qf,
            .mem_props = mem_props,
            .device_name = props.deviceName,
            .device_type = props.deviceType,
            .used_fallback_icd = used_fallback,
            .api_version = props.apiVersion,
            .supports_f64 = feats.features[36] != 0,
            .max_bindings = n_bindings,
            .memory_budget_bytes = opts.memory_budget_bytes,
        };
        errdefer {
            if (self.cmd_pool != 0) vk.DestroyCommandPool(device, self.cmd_pool, null);
            if (self.pipe_cache != 0) vk.DestroyPipelineCache(device, self.pipe_cache, null);
            if (self.pipe_layout != 0) vk.DestroyPipelineLayout(device, self.pipe_layout, null);
            if (self.desc_pool != 0) vk.DestroyDescriptorPool(device, self.desc_pool, null);
            if (self.desc_layout != 0) vk.DestroyDescriptorSetLayout(device, self.desc_layout, null);
            vk.DestroyDevice(device, null);
        }
        vk.GetDeviceQueue(device, compute_qf, 0, &self.queue);

        var bindings: [8]VkDescriptorSetLayoutBinding = undefined;
        for (0..n_bindings) |bi| {
            bindings[bi] = .{
                .binding = @intCast(bi),
                .descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
                .descriptorCount = 1,
                .stageFlags = VK_SHADER_STAGE_COMPUTE_BIT,
            };
        }
        const dsl_ci = VkDescriptorSetLayoutCreateInfo{ .bindingCount = n_bindings, .pBindings = &bindings };
        if (vk.CreateDescriptorSetLayout(device, &dsl_ci, null, &self.desc_layout) != VK_SUCCESS) return error.VulkanCallFailed;

        const pool_size = [_]VkDescriptorPoolSize{.{ .type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, .descriptorCount = 512 }};
        const dp_ci = VkDescriptorPoolCreateInfo{
            .flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT,
            .maxSets = 64,
            .poolSizeCount = 1,
            .pPoolSizes = &pool_size,
        };
        if (vk.CreateDescriptorPool(device, &dp_ci, null, &self.desc_pool) != VK_SUCCESS) return error.VulkanCallFailed;

        const pc_range = [_]VkPushConstantRange{.{
            .stageFlags = VK_SHADER_STAGE_COMPUTE_BIT,
            .offset = 0,
            .size = 64,
        }};
        const pl_ci = VkPipelineLayoutCreateInfo{
            .pSetLayouts = &self.desc_layout,
            .pushConstantRangeCount = 1,
            .pPushConstantRanges = &pc_range,
        };
        if (vk.CreatePipelineLayout(device, &pl_ci, null, &self.pipe_layout) != VK_SUCCESS) return error.VulkanCallFailed;

        const pc_ci = VkPipelineCacheCreateInfo{};
        if (vk.CreatePipelineCache(device, &pc_ci, null, &self.pipe_cache) != VK_SUCCESS) return error.VulkanCallFailed;

        const cp_ci = VkCommandPoolCreateInfo{ .queueFamilyIndex = compute_qf };
        if (vk.CreateCommandPool(device, &cp_ci, null, &self.cmd_pool) != VK_SUCCESS) return error.VulkanCallFailed;

        return self;
    }

    pub fn deinit(self: *VulkanGpuDevice) void {
        if (self.device != null and !self.device_lost) {
            _ = self.vk.DeviceWaitIdle(self.device);
        }
        if (self.current_kernel) |k| {
            self.destroyKernelVersion(k);
            self.current_kernel = null;
        }
        for (self.retired_kernels.items) |k| self.destroyKernelVersion(k);
        self.retired_kernels.deinit(self.allocator);

        if (self.cmd_pool != 0) self.vk.DestroyCommandPool(self.device, self.cmd_pool, null);
        if (self.pipe_cache != 0) self.vk.DestroyPipelineCache(self.device, self.pipe_cache, null);
        if (self.pipe_layout != 0) self.vk.DestroyPipelineLayout(self.device, self.pipe_layout, null);
        if (self.desc_pool != 0) self.vk.DestroyDescriptorPool(self.device, self.desc_pool, null);
        if (self.desc_layout != 0) self.vk.DestroyDescriptorSetLayout(self.device, self.desc_layout, null);
        if (self.device != null) self.vk.DestroyDevice(self.device, null);
        if (self.instance != null) self.vk.DestroyInstance(self.instance, null);
        _ = FreeLibrary(self.loader);
    }

    fn destroyKernelVersion(self: *VulkanGpuDevice, k: *KernelVersion) void {
        if (k.pipeline != 0) self.vk.DestroyPipeline(self.device, k.pipeline, null);
        if (k.shader != 0) self.vk.DestroyShaderModule(self.device, k.shader, null);
        self.allocator.destroy(k);
    }

    /// Feature negotiation check (rejects unsupported device features explicitly!).
    pub fn negotiateFeature(self: *const VulkanGpuDevice, feature: []const u8) GpuError!void {
        if (std.mem.eql(u8, feature, "compute_shader")) return;
        if (std.mem.eql(u8, feature, "shader_float64")) {
            if (!self.supports_f64) return error.FeatureUnsupported;
            return;
        }
        return error.FeatureUnsupported;
    }

    /// Validate a sealed pipeline cache blob (`TSFGPC1\0` + 32-byte SHA-256 + raw Vulkan cache bytes).
    /// Rejects corrupted caches with `error.CorruptPipelineCache` and records flag so caller rebuilds cleanly!
    pub fn loadSealedPipelineCache(self: *VulkanGpuDevice, sealed: []const u8) GpuError!void {
        if (sealed.len < 40 or !std.mem.eql(u8, sealed[0..8], "TSFGPC1\x00")) {
            self.corrupt_cache_rejected = true;
            return error.CorruptPipelineCache;
        }
        var actual_hash: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(sealed[40..], &actual_hash, .{});
        if (!std.mem.eql(u8, &actual_hash, sealed[8..40])) {
            self.corrupt_cache_rejected = true;
            return error.CorruptPipelineCache;
        }
        var new_cache: VkPipelineCache = 0;
        const pc_ci = VkPipelineCacheCreateInfo{
            .initialDataSize = sealed.len - 40,
            .pInitialData = if (sealed.len > 40) sealed[40..].ptr else null,
        };
        if (self.vk.CreatePipelineCache(self.device, &pc_ci, null, &new_cache) != VK_SUCCESS) {
            self.corrupt_cache_rejected = true;
            return error.CorruptPipelineCache;
        }
        if (self.pipe_cache != 0) self.vk.DestroyPipelineCache(self.device, self.pipe_cache, null);
        self.pipe_cache = new_cache;
    }

    pub fn exportSealedPipelineCache(self: *VulkanGpuDevice, allocator: std.mem.Allocator) GpuError![]u8 {
        var sz: usize = 0;
        if (self.vk.GetPipelineCacheData(self.device, self.pipe_cache, &sz, null) != VK_SUCCESS) {
            return error.VulkanCallFailed;
        }
        const out = allocator.alloc(u8, 40 + sz) catch return error.OutOfMemory;
        errdefer allocator.free(out);
        @memcpy(out[0..8], "TSFGPC1\x00");
        if (sz > 0) {
            if (self.vk.GetPipelineCacheData(self.device, self.pipe_cache, &sz, out[40..].ptr) != VK_SUCCESS) {
                return error.VulkanCallFailed;
            }
        }
        var digest: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(out[40..], &digest, .{});
        @memcpy(out[8..40], &digest);
        return out;
    }

    fn findHostVisibleMemType(self: *const VulkanGpuDevice, type_bits: u32) GpuError!u32 {
        const wanted = VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        for (0..self.mem_props.memoryTypeCount) |i| {
            const bit = @as(u32, 1) << @intCast(i);
            if ((type_bits & bit) != 0 and (self.mem_props.memoryTypes[i].propertyFlags & wanted) == wanted) {
                return @intCast(i);
            }
        }
        return error.NoMemoryType;
    }

    fn findDeviceLocalMemType(self: *const VulkanGpuDevice, type_bits: u32) ?struct { idx: u32, host_visible: bool } {
        // First prefer pure DEVICE_LOCAL (fastest VRAM on discrete GPUs)
        for (0..self.mem_props.memoryTypeCount) |i| {
            const bit = @as(u32, 1) << @intCast(i);
            const flags = self.mem_props.memoryTypes[i].propertyFlags;
            if ((type_bits & bit) != 0 and (flags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT) != 0 and (flags & VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT) == 0) {
                return .{ .idx = @intCast(i), .host_visible = false };
            }
        }
        // Fallback: DEVICE_LOCAL | HOST_VISIBLE (integrated GPU / Lavapipe unified memory)
        const both = VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT | VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
        for (0..self.mem_props.memoryTypeCount) |i| {
            const bit = @as(u32, 1) << @intCast(i);
            if ((type_bits & bit) != 0 and (self.mem_props.memoryTypes[i].propertyFlags & both) == both) {
                return .{ .idx = @intCast(i), .host_visible = true };
            }
        }
        return null;
    }

    pub fn createBuffer(self: *VulkanGpuDevice, byte_size: usize) GpuError!GpuBuffer {
        if (self.device_lost) return error.DeviceLost;
        if (self.memory_used_bytes + byte_size > self.memory_budget_bytes) {
            return error.GpuOutOfMemory;
        }
        const bci = VkBufferCreateInfo{
            .size = byte_size,
            .usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        };
        var buf: VkBuffer = 0;
        if (self.vk.CreateBuffer(self.device, &bci, null, &buf) != VK_SUCCESS) return error.VulkanCallFailed;
        errdefer self.vk.DestroyBuffer(self.device, buf, null);

        var req: VkMemoryRequirements = undefined;
        self.vk.GetBufferMemoryRequirements(self.device, buf, &req);
        if (self.memory_used_bytes + req.size > self.memory_budget_bytes) {
            return error.GpuOutOfMemory;
        }
        const mtype = try self.findHostVisibleMemType(req.memoryTypeBits);
        const mai = VkMemoryAllocateInfo{ .allocationSize = req.size, .memoryTypeIndex = mtype };
        var mem: VkDeviceMemory = 0;
        if (self.vk.AllocateMemory(self.device, &mai, null, &mem) != VK_SUCCESS) return error.GpuOutOfMemory;
        errdefer self.vk.FreeMemory(self.device, mem, null);

        if (self.vk.BindBufferMemory(self.device, buf, mem, 0) != VK_SUCCESS) return error.VulkanCallFailed;
        const alloc_sz: usize = @intCast(req.size);
        self.memory_used_bytes += alloc_sz;
        return .{ .buffer = buf, .memory = mem, .byte_size = byte_size, .alloc_size = alloc_sz, .is_device_local = false };
    }

    /// Allocate a `DEVICE_LOCAL` storage buffer (uses explicit staging + `vkCmdCopyBuffer` +
    /// `vkCmdPipelineBarrier` on discrete GPUs; direct coherent memory on unified/software devices).
    pub fn createDeviceLocalBuffer(self: *VulkanGpuDevice, byte_size: usize) GpuError!GpuBuffer {
        if (self.device_lost) return error.DeviceLost;
        if (self.memory_used_bytes + byte_size > self.memory_budget_bytes) return error.GpuOutOfMemory;
        const bci = VkBufferCreateInfo{
            .size = byte_size,
            .usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
        };
        var buf: VkBuffer = 0;
        if (self.vk.CreateBuffer(self.device, &bci, null, &buf) != VK_SUCCESS) return error.VulkanCallFailed;
        errdefer self.vk.DestroyBuffer(self.device, buf, null);

        var req: VkMemoryRequirements = undefined;
        self.vk.GetBufferMemoryRequirements(self.device, buf, &req);
        if (self.memory_used_bytes + req.size > self.memory_budget_bytes) return error.GpuOutOfMemory;

        const chosen = self.findDeviceLocalMemType(req.memoryTypeBits) orelse .{
            .idx = try self.findHostVisibleMemType(req.memoryTypeBits),
            .host_visible = true,
        };
        const mai = VkMemoryAllocateInfo{ .allocationSize = req.size, .memoryTypeIndex = chosen.idx };
        var mem: VkDeviceMemory = 0;
        if (self.vk.AllocateMemory(self.device, &mai, null, &mem) != VK_SUCCESS) return error.GpuOutOfMemory;
        errdefer self.vk.FreeMemory(self.device, mem, null);

        if (self.vk.BindBufferMemory(self.device, buf, mem, 0) != VK_SUCCESS) return error.VulkanCallFailed;
        const alloc_sz: usize = @intCast(req.size);
        self.memory_used_bytes += alloc_sz;
        return .{ .buffer = buf, .memory = mem, .byte_size = byte_size, .alloc_size = alloc_sz, .is_device_local = !chosen.host_visible };
    }

    fn copyBufferWithBarrier(
        self: *VulkanGpuDevice,
        src_buf: VkBuffer,
        dst_buf: VkBuffer,
        byte_len: usize,
        upload: bool,
    ) GpuError!void {
        var cmd: VkCommandBuffer = null;
        const cb_ai = VkCommandBufferAllocateInfo{ .commandPool = self.cmd_pool };
        if (self.vk.AllocateCommandBuffers(self.device, &cb_ai, &cmd) != VK_SUCCESS or cmd == null) return error.VulkanCallFailed;
        defer self.vk.FreeCommandBuffers(self.device, self.cmd_pool, 1, &cmd);

        const begin_info = VkCommandBufferBeginInfo{};
        if (self.vk.BeginCommandBuffer(cmd, &begin_info) != VK_SUCCESS) return error.VulkanCallFailed;
        if (!upload) {
            const pre_bar = [_]VkBufferMemoryBarrier{.{
                .srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT,
                .dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT,
                .buffer = src_buf,
                .size = byte_len,
            }};
            self.vk.CmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, null, 1, &pre_bar, 0, null);
        }
        const region = VkBufferCopy{ .size = byte_len };
        self.vk.CmdCopyBuffer(cmd, src_buf, dst_buf, 1, &region);
        if (upload) {
            const post_bar = [_]VkBufferMemoryBarrier{.{
                .srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
                .dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT,
                .buffer = dst_buf,
                .size = byte_len,
            }};
            self.vk.CmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 0, null, 1, &post_bar, 0, null);
        }
        if (self.vk.EndCommandBuffer(cmd) != VK_SUCCESS) return error.VulkanCallFailed;

        const fci = VkFenceCreateInfo{};
        var fence: VkFence = 0;
        if (self.vk.CreateFence(self.device, &fci, null, &fence) != VK_SUCCESS) return error.VulkanCallFailed;
        defer self.vk.DestroyFence(self.device, fence, null);

        const sub = VkSubmitInfo{ .pCommandBuffers = &cmd };
        const qres = self.vk.QueueSubmit(self.queue, 1, &sub, fence);
        if (qres == VK_ERROR_DEVICE_LOST) {
            self.device_lost = true;
            return error.DeviceLost;
        }
        if (qres != VK_SUCCESS) return error.VulkanCallFailed;
        if (self.vk.WaitForFences(self.device, 1, &fence, 1, 10_000_000_000) != VK_SUCCESS) return error.FenceTimeout;
    }

    pub fn destroyBuffer(self: *VulkanGpuDevice, b: *GpuBuffer) void {
        if (b.buffer != 0) self.vk.DestroyBuffer(self.device, b.buffer, null);
        if (b.memory != 0) self.vk.FreeMemory(self.device, b.memory, null);
        if (self.memory_used_bytes >= b.alloc_size) {
            self.memory_used_bytes -= b.alloc_size;
        } else {
            self.memory_used_bytes = 0;
        }
        b.* = .{};
    }

    pub fn uploadBytes(self: *VulkanGpuDevice, b: GpuBuffer, src: []const u8) GpuError!void {
        if (self.device_lost) return error.DeviceLost;
        if (src.len > b.byte_size) return error.InvalidBufferRange;
        if (src.len == 0) return;
        if (b.is_device_local) {
            var staging = try self.createBuffer(src.len);
            defer self.destroyBuffer(&staging);
            try self.uploadBytes(staging, src);
            try self.copyBufferWithBarrier(staging.buffer, b.buffer, src.len, true);
            return;
        }
        var mapped: ?*anyopaque = null;
        if (self.vk.MapMemory(self.device, b.memory, 0, src.len, 0, &mapped) != VK_SUCCESS or mapped == null) {
            return error.VulkanCallFailed;
        }
        defer self.vk.UnmapMemory(self.device, b.memory);
        const dst: [*]u8 = @ptrCast(mapped.?);
        @memcpy(dst[0..src.len], src);
    }

    pub fn downloadBytes(self: *VulkanGpuDevice, b: GpuBuffer, dst: []u8) GpuError!void {
        if (self.device_lost) return error.DeviceLost;
        if (dst.len > b.byte_size) return error.InvalidBufferRange;
        if (dst.len == 0) return;
        if (b.is_device_local) {
            var staging = try self.createBuffer(dst.len);
            defer self.destroyBuffer(&staging);
            try self.copyBufferWithBarrier(b.buffer, staging.buffer, dst.len, false);
            try self.downloadBytes(staging, dst);
            return;
        }
        var mapped: ?*anyopaque = null;
        if (self.vk.MapMemory(self.device, b.memory, 0, dst.len, 0, &mapped) != VK_SUCCESS or mapped == null) {
            return error.VulkanCallFailed;
        }
        defer self.vk.UnmapMemory(self.device, b.memory);
        const src: [*]const u8 = @ptrCast(mapped.?);
        @memcpy(dst, src[0..dst.len]);
    }

    /// Hot-reloadable GPU kernel publication: compiles SPIR-V into a real `VkShaderModule` +
    /// `VkPipeline`, swaps it into `current_kernel`, and retires the old kernel version so it
    /// is ONLY destroyed after all in-flight `VkFence`s complete!
    pub fn publishSpirvKernel(self: *VulkanGpuDevice, version: u64, spv_bytes: []const u8) GpuError!void {
        if (self.device_lost) return error.DeviceLost;
        if (spv_bytes.len < 20 or (spv_bytes.len % 4) != 0) return error.InvalidSpirv;
        const aligned_words = self.allocator.alloc(u32, spv_bytes.len / 4) catch return error.OutOfMemory;
        defer self.allocator.free(aligned_words);
        for (0..aligned_words.len) |i| {
            aligned_words[i] = std.mem.readInt(u32, spv_bytes[i * 4 ..][0..4], .little);
        }

        const sm_ci = VkShaderModuleCreateInfo{
            .codeSize = spv_bytes.len,
            .pCode = aligned_words.ptr,
        };
        var shader: VkShaderModule = 0;
        if (self.vk.CreateShaderModule(self.device, &sm_ci, null, &shader) != VK_SUCCESS) return error.InvalidSpirv;
        errdefer self.vk.DestroyShaderModule(self.device, shader, null);

        const cp_ci = VkComputePipelineCreateInfo{
            .stage = .{ .module = shader },
            .layout = self.pipe_layout,
        };
        var pipeline: VkPipeline = 0;
        if (self.vk.CreateComputePipelines(self.device, self.pipe_cache, 1, &cp_ci, null, &pipeline) != VK_SUCCESS) {
            return error.VulkanCallFailed;
        }
        errdefer self.vk.DestroyPipeline(self.device, pipeline, null);

        const kv = self.allocator.create(KernelVersion) catch return error.OutOfMemory;
        kv.* = .{ .version = version, .shader = shader, .pipeline = pipeline };

        if (self.current_kernel) |old| {
            old.retired = true;
            self.retired_kernels.append(self.allocator, old) catch return error.OutOfMemory;
        }
        self.current_kernel = kv;
    }

    /// Submit an asynchronous Vulkan compute dispatch with a real `VkFence`, incrementing `in_flight_fences`.
    pub fn dispatchAsync(
        self: *VulkanGpuDevice,
        buf_a: GpuBuffer,
        buf_b: GpuBuffer,
        buf_out: GpuBuffer,
        group_count_x: u32,
    ) GpuError!InFlightDispatch {
        const bufs = [_]GpuBuffer{ buf_a, buf_b, buf_out };
        return self.dispatchBuffers(&bufs, group_count_x, 1, 1, &.{});
    }

    /// Generalized compute dispatch supporting 1..8 storage buffer bindings, 1D/2D/3D workgroups,
    /// and up to 64 bytes of Push Constants.
    pub fn dispatchBuffers(
        self: *VulkanGpuDevice,
        buffers: []const GpuBuffer,
        group_count_x: u32,
        group_count_y: u32,
        group_count_z: u32,
        push_constants: []const u8,
    ) GpuError!InFlightDispatch {
        if (self.device_lost) return error.DeviceLost;
        if (buffers.len == 0 or buffers.len > self.max_bindings) return error.InvalidBufferRange;
        if (push_constants.len > 64) return error.InvalidBufferRange;
        const kv = self.current_kernel orelse return error.InvalidSpirv;

        var dset: VkDescriptorSet = 0;
        const ds_ai = VkDescriptorSetAllocateInfo{ .descriptorPool = self.desc_pool, .pSetLayouts = &self.desc_layout };
        if (self.vk.AllocateDescriptorSets(self.device, &ds_ai, &dset) != VK_SUCCESS) return error.VulkanCallFailed;
        errdefer _ = self.vk.FreeDescriptorSets(self.device, self.desc_pool, 1, &dset);

        var buf_infos: [8]VkDescriptorBufferInfo = undefined;
        var writes: [8]VkWriteDescriptorSet = undefined;
        for (buffers, 0..) |b, i| {
            buf_infos[i] = .{ .buffer = b.buffer, .range = b.byte_size };
            writes[i] = .{ .dstSet = dset, .dstBinding = @intCast(i), .pBufferInfo = &buf_infos[i] };
        }
        self.vk.UpdateDescriptorSets(self.device, @intCast(buffers.len), &writes, 0, null);

        var cmd: VkCommandBuffer = null;
        const cb_ai = VkCommandBufferAllocateInfo{ .commandPool = self.cmd_pool };
        if (self.vk.AllocateCommandBuffers(self.device, &cb_ai, &cmd) != VK_SUCCESS or cmd == null) return error.VulkanCallFailed;
        errdefer self.vk.FreeCommandBuffers(self.device, self.cmd_pool, 1, &cmd);

        const begin_info = VkCommandBufferBeginInfo{};
        if (self.vk.BeginCommandBuffer(cmd, &begin_info) != VK_SUCCESS) return error.VulkanCallFailed;
        self.vk.CmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, kv.pipeline);
        self.vk.CmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, self.pipe_layout, 0, 1, &dset, 0, null);
        if (push_constants.len > 0) {
            self.vk.CmdPushConstants(cmd, self.pipe_layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, @intCast(push_constants.len), push_constants.ptr);
        }
        self.vk.CmdDispatch(cmd, @max(group_count_x, 1), @max(group_count_y, 1), @max(group_count_z, 1));
        if (self.vk.EndCommandBuffer(cmd) != VK_SUCCESS) return error.VulkanCallFailed;

        const fci = VkFenceCreateInfo{};
        var fence: VkFence = 0;
        if (self.vk.CreateFence(self.device, &fci, null, &fence) != VK_SUCCESS) return error.VulkanCallFailed;

        const sub = VkSubmitInfo{ .pCommandBuffers = &cmd };
        const qres = self.vk.QueueSubmit(self.queue, 1, &sub, fence);
        if (qres == VK_ERROR_DEVICE_LOST) {
            self.device_lost = true;
            self.vk.DestroyFence(self.device, fence, null);
            return error.DeviceLost;
        }
        if (qres != VK_SUCCESS) {
            self.vk.DestroyFence(self.device, fence, null);
            return error.VulkanCallFailed;
        }
        kv.in_flight_fences += 1;
        return .{ .kernel = kv, .fence = fence, .cmd = cmd, .dset = dset };
    }

    pub fn waitAndComplete(self: *VulkanGpuDevice, disp: *InFlightDispatch) GpuError!void {
        if (disp.completed) return;
        const wr = self.vk.WaitForFences(self.device, 1, &disp.fence, 1, 10_000_000_000);
        self.vk.DestroyFence(self.device, disp.fence, null);
        self.vk.FreeCommandBuffers(self.device, self.cmd_pool, 1, &disp.cmd);
        _ = self.vk.FreeDescriptorSets(self.device, self.desc_pool, 1, &disp.dset);
        disp.completed = true;
        if (disp.kernel.in_flight_fences > 0) disp.kernel.in_flight_fences -= 1;
        if (wr == VK_ERROR_DEVICE_LOST) {
            self.device_lost = true;
            return error.DeviceLost;
        }
        if (wr != VK_SUCCESS) return error.FenceTimeout;
    }

    /// Reclaim retired GPU pipelines ONLY when `in_flight_fences == 0`!
    pub fn reclaimRetiredKernels(self: *VulkanGpuDevice) void {
        var i: usize = 0;
        while (i < self.retired_kernels.items.len) {
            const k = self.retired_kernels.items[i];
            if (k.in_flight_fences == 0) {
                self.destroyKernelVersion(k);
                _ = self.retired_kernels.swapRemove(i);
                self.reclaimed_kernels += 1;
            } else {
                self.deferred_reclaims += 1;
                i += 1;
            }
        }
    }

    /// Simulate `VK_ERROR_DEVICE_LOST` fault injection so callers & tests verify safe fault isolation.
    pub fn simulateDeviceLost(self: *VulkanGpuDevice) void {
        self.device_lost = true;
    }
};
