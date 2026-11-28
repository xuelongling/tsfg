// SPDX-License-Identifier: MIT
//! R11 Real Vulkan 1.3 Lavapipe GPU Execution CLI (`tsfg-r11-gpu.exe`).
//! Drives:
//!   1. Real Vulkan 1.3 Lavapipe device initialization & feature negotiation
//!   2. Explicit buffer upload, SPIR-V v1 (`a + b`) async compute dispatch
//!   3. Live GPU kernel hot-reload to SPIR-V v2 (`a * b + a`) WHILE v1 fence is STILL in-flight!
//!   4. Proof that v1 pipeline is deferred while in-flight and destroyed cleanly AFTER `vkWaitForFences`
//!   5. Pipeline cache export, corrupted cache rejection, OOM budget rejection, and DeviceLost isolation
//!   6. Downloads v1 and v2 output buffers for CPU reference verification!
const std = @import("std");
const gpu = @import("r11-vulkan-gpu.zig");

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len < 7) {
        std.debug.print("usage: r11-gpu-cli <vulkan-1.dll> <lvp_icd.json> <v1.spv> <v2.spv> <out_v1.bin> <out_v2.bin>\n", .{});
        std.process.exit(2);
    }

    const loader_path = args[1];
    const icd_path = args[2];
    const v1_spv_path = args[3];
    const v2_spv_path = args[4];
    const out_v1_path = args[5];
    const out_v2_path = args[6];

    const v1_spv = try std.Io.Dir.cwd().readFileAlloc(io, v1_spv_path, allocator, .limited(2 * 1024 * 1024));
    defer allocator.free(v1_spv);
    const v2_spv = try std.Io.Dir.cwd().readFileAlloc(io, v2_spv_path, allocator, .limited(2 * 1024 * 1024));
    defer allocator.free(v2_spv);

    // 1 MB explicit GPU memory budget
    var dev = try gpu.VulkanGpuDevice.init(allocator, loader_path, icd_path, 1024 * 1024);
    defer dev.deinit();

    // Feature negotiation: compute_shader succeeds; unknown feature explicitly rejected!
    try dev.negotiateFeature("compute_shader");
    var unsupported_feature_rejected = false;
    if (dev.negotiateFeature("ray_tracing_khr")) |_| {} else |_| {
        unsupported_feature_rejected = true;
    }

    // OOM budget negative test (requesting 8 MB > 1 MB cap must fail with GpuOutOfMemory!)
    var oom_rejected = false;
    if (dev.createBuffer(8 * 1024 * 1024)) |b| {
        var tmp = b;
        dev.destroyBuffer(&tmp);
    } else |err| {
        oom_rejected = (err == error.GpuOutOfMemory);
    }

    // Prepare 1024 f32 inputs
    const count: usize = 1024;
    const byte_len = count * @sizeOf(f32);
    var host_a: [count]f32 = undefined;
    var host_b: [count]f32 = undefined;
    for (0..count) |i| {
        host_a[i] = @as(f32, @floatFromInt(i)) * 0.5 + 1.25;
        host_b[i] = @as(f32, @floatFromInt(i % 17)) * 0.25 - 2.0;
    }

    var buf_a = try dev.createBuffer(byte_len);
    defer dev.destroyBuffer(&buf_a);
    var buf_b = try dev.createBuffer(byte_len);
    defer dev.destroyBuffer(&buf_b);
    var buf_out_v1 = try dev.createBuffer(byte_len);
    defer dev.destroyBuffer(&buf_out_v1);
    var buf_out_v2 = try dev.createBuffer(byte_len);
    defer dev.destroyBuffer(&buf_out_v2);

    try dev.uploadBytes(buf_a, std.mem.sliceAsBytes(&host_a));
    try dev.uploadBytes(buf_b, std.mem.sliceAsBytes(&host_b));

    // Publish SPIR-V kernel v1 (`a + b`) and dispatch asynchronously!
    try dev.publishSpirvKernel(1, v1_spv);
    var disp1 = try dev.dispatchAsync(buf_a, buf_b, buf_out_v1, @intCast(count / 64));

    // Hot-reload SPIR-V kernel v2 (`a * b + a`) WHILE v1 fence is STILL in-flight!
    try dev.publishSpirvKernel(2, v2_spv);

    // Attempt reclaim while disp1 is still in flight -> v1 MUST be deferred (deferred_reclaims == 1)!
    dev.reclaimRetiredKernels();
    const deferred_while_in_flight = dev.deferred_reclaims;

    // Wait for v1 fence, download v1 results, and reclaim v1 pipeline!
    try dev.waitAndComplete(&disp1);
    dev.reclaimRetiredKernels();
    const reclaimed_after_fence = dev.reclaimed_kernels;

    var res_v1: [count]f32 = undefined;
    try dev.downloadBytes(buf_out_v1, std.mem.sliceAsBytes(&res_v1));

    // Dispatch & wait v2 on the SAME Vulkan device
    var disp2 = try dev.dispatchAsync(buf_a, buf_b, buf_out_v2, @intCast(count / 64));
    try dev.waitAndComplete(&disp2);
    var res_v2: [count]f32 = undefined;
    try dev.downloadBytes(buf_out_v2, std.mem.sliceAsBytes(&res_v2));

    // Export sealed pipeline cache, corrupt 1 byte, verify rejection, then reload valid cache!
    const valid_cache = try dev.exportSealedPipelineCache(allocator);
    defer allocator.free(valid_cache);
    const bad_cache = try allocator.dupe(u8, valid_cache);
    defer allocator.free(bad_cache);
    bad_cache[8] ^= 0xff;
    var corrupt_cache_rejected = false;
    if (dev.loadSealedPipelineCache(bad_cache)) |_| {} else |err| {
        corrupt_cache_rejected = (err == error.CorruptPipelineCache);
    }
    try dev.loadSealedPipelineCache(valid_cache);

    // DeviceLost fault isolation test
    dev.simulateDeviceLost();
    var device_lost_rejected = false;
    if (dev.dispatchAsync(buf_a, buf_b, buf_out_v2, 1)) |_| {} else |err| {
        device_lost_rejected = (err == error.DeviceLost);
    }

    // Write downloaded GPU output buffers to disk for CPU reference validation
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = out_v1_path, .data = std.mem.sliceAsBytes(&res_v1) });
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = out_v2_path, .data = std.mem.sliceAsBytes(&res_v2) });

    const dev_name = std.mem.sliceTo(&dev.device_name, 0);
    var out: std.ArrayListUnmanaged(u8) = .empty;
    defer out.deinit(allocator);
    try out.print(
        allocator,
        "{{\"deviceName\":\"{s}\",\"apiVersion\":{d},\"supportsF64\":{},\"unsupportedFeatureRejected\":{},\"oomRejected\":{},\"deferredWhileInFlight\":{d},\"reclaimedAfterFence\":{d},\"corruptCacheRejected\":{},\"deviceLostRejected\":{},\"remainingRetired\":{d}}}\n",
        .{
            dev_name,
            dev.api_version,
            dev.supports_f64,
            unsupported_feature_rejected,
            oom_rejected,
            deferred_while_in_flight,
            reclaimed_after_fence,
            corrupt_cache_rejected,
            device_lost_rejected,
            dev.retired_kernels.items.len,
        },
    );
    try writeStdout(io, out.items);
}
