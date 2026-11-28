// SPDX-License-Identifier: MIT
//! Unified Zero-Compiler-Dependency Windows x64 `tsfg` Runtime Engine (`libtsfg_runtime`).
//! Consolidates ALL runtime subsystems into a single cohesive host library with C ABI exports:
//!   - R04 Canonical Identity, Win64 ABI Validation & Versioned Protocols
//!   - R05 Predecoded Register Bytecode Verifier, Persistent `VmInstance`, Live Debug Hooks & Cross-Tier Bridges
//!   - R06 Incremental Generational Moving GC (Chained AOT Shadow Frames + HandleTable + ValueArena + Capabilities)
//!   - R09 FunctionCell 3-Phase Hot-Reload Runtime & Transactional Schema Migration
//!   - R10 Dynamic Archetype ECS World & Persistent Work-Stealing CPU JobSystem
//!   - R11 Hardware-First Windows Vulkan 1.3 Compute Device & Async Kernel Hot-Reload
//!   - Real Win32 QPC Runtime Profiler (`tsfg-profiler.zig`)
const std = @import("std");

pub const r04_identity = @import("r04-identity.zig");
pub const r04_abi = @import("r04-abi.zig");
pub const r04_protocols = @import("r04-protocols.zig");
pub const bytecode = @import("r05-bytecode.zig");
pub const vm = @import("r05-vm.zig");
pub const gc = @import("r06-gen-gc.zig");
pub const core_rt = @import("r06-runtime.zig");
pub const hot_reload = @import("r09-hot-reload.zig");
pub const ecs = @import("r10-ecs-jobs.zig");
pub const gpu = @import("r11-vulkan-gpu.zig");
pub const profiler = @import("tsfg-profiler.zig");

pub const ABI_VERSION: u32 = 1;

/// Unified in-process tsfg Engine owning GC/Runtime, Hot-Reload FunctionCells,
/// Dynamic ECS World, Work-Stealing JobSystem, optional Vulkan GPU Device, and QPC Profiler.
pub const TsfgEngine = struct {
    allocator: std.mem.Allocator,
    rt: *core_rt.R06Runtime,
    hot: hot_reload.HotReloadRuntime,
    world: ecs.EcsWorld,
    jobs: ecs.WorkStealingJobSystem,
    gpu_device: ?gpu.VulkanGpuDevice = null,
    vm_modules: std.ArrayListUnmanaged(*bytecode.VerifiedModule) = .empty,
    vm_instances: std.ArrayListUnmanaged(*vm.VmInstance) = .empty,

    pub fn create(
        allocator: std.mem.Allocator,
        max_heap_bytes: usize,
        arena_bytes: usize,
        worker_threads: usize,
        initial_schema_hash: []const u8,
    ) !*TsfgEngine {
        const eng = try allocator.create(TsfgEngine);
        errdefer allocator.destroy(eng);

        const rt = try core_rt.R06Runtime.create(allocator, max_heap_bytes, arena_bytes);
        errdefer rt.destroy();

        var hot = try hot_reload.HotReloadRuntime.init(allocator, rt, initial_schema_hash, &.{});
        errdefer hot.deinit();

        const world = ecs.EcsWorld.init(allocator);
        const jobs = ecs.WorkStealingJobSystem.init(allocator, worker_threads, false);

        eng.* = .{
            .allocator = allocator,
            .rt = rt,
            .hot = hot,
            .world = world,
            .jobs = jobs,
            .gpu_device = null,
        };
        return eng;
    }

    pub fn destroy(self: *TsfgEngine) void {
        const alloc = self.allocator;
        for (self.vm_instances.items) |inst| inst.destroy();
        self.vm_instances.deinit(alloc);
        for (self.vm_modules.items) |m| {
            m.deinit();
            alloc.destroy(m);
        }
        self.vm_modules.deinit(alloc);
        if (self.gpu_device) |*dev| {
            dev.deinit();
            self.gpu_device = null;
        }
        self.world.deinit();
        self.hot.deinit();
        self.rt.destroy();
        alloc.destroy(self);
    }

    pub fn enableProfiling(self: *TsfgEngine, enabled: bool) void {
        self.rt.trace.setEnabled(enabled);
    }

    pub fn loadBytecodeInstance(self: *TsfgEngine, bytes: []const u8, expected_abi: ?[32]u8) !*vm.VmInstance {
        const mod_ptr = try self.allocator.create(bytecode.VerifiedModule);
        errdefer self.allocator.destroy(mod_ptr);
        mod_ptr.* = try bytecode.verifyAndPredecode(self.allocator, bytes, expected_abi);
        errdefer mod_ptr.deinit();
        try self.vm_modules.append(self.allocator, mod_ptr);

        const inst = try vm.VmInstance.create(self.rt, mod_ptr, &self.rt.capabilities, .{});
        errdefer inst.destroy();
        try self.vm_instances.append(self.allocator, inst);
        return inst;
    }

    pub fn exportChromeTraceJsonAlloc(self: *TsfgEngine, allocator: std.mem.Allocator) ![]u8 {
        return self.rt.trace.toChromeTraceJsonAlloc(allocator);
    }
};

// ============================================================================
// C-ABI Host Exports (for embedding `tsfg_runtime.lib` into C/C++/Zig game engines)
// ============================================================================
var c_gpa = std.heap.DebugAllocator(.{}){};

pub export fn tsfg_runtime_abi_version() callconv(.c) u32 {
    return ABI_VERSION;
}

pub export fn tsfg_engine_create(max_heap_bytes: usize, arena_bytes: usize, worker_threads: u32) callconv(.c) ?*anyopaque {
    const default_schema = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const eng = TsfgEngine.create(
        c_gpa.allocator(),
        if (max_heap_bytes == 0) 16 * 1024 * 1024 else max_heap_bytes,
        if (arena_bytes == 0) 65536 else arena_bytes,
        if (worker_threads == 0) 4 else worker_threads,
        default_schema,
    ) catch return null;
    return eng;
}

pub export fn tsfg_engine_destroy(handle: ?*anyopaque) callconv(.c) void {
    const raw = handle orelse return;
    const eng: *TsfgEngine = @ptrCast(@alignCast(raw));
    eng.destroy();
}

pub export fn tsfg_engine_enable_profiling(handle: ?*anyopaque, enabled: u8) callconv(.c) void {
    const raw = handle orelse return;
    const eng: *TsfgEngine = @ptrCast(@alignCast(raw));
    eng.enableProfiling(enabled != 0);
}

pub export fn tsfg_engine_eval_i32(
    handle: ?*anyopaque,
    bc_ptr: [*]const u8,
    bc_len: usize,
    fn_idx: u32,
    arg0: i32,
    arg1: i32,
    out_val: *i32,
) callconv(.c) i32 {
    const raw = handle orelse return -1;
    const eng: *TsfgEngine = @ptrCast(@alignCast(raw));
    const inst = eng.loadBytecodeInstance(bc_ptr[0..bc_len], null) catch return -2;
    if (fn_idx >= inst.mod.functions.len) return -3;
    const pc = inst.mod.functions[fn_idx].param_count;
    const args = [_]vm.TypedVal{ vm.TypedVal.fromI32(arg0), vm.TypedVal.fromI32(arg1) };
    const out = inst.callFunction(inst.mod.functions[fn_idx].function_id, args[0..@min(pc, 2)], .{}, null);
    if (out.status != .ok) return @intFromEnum(out.status);
    out_val.* = out.value.asI32();
    return 0;
}

test "Unified TsfgEngine: persistent multi-frame VM + GC relocation + ECS + Profiler in ONE process" {
    const alloc = std.testing.allocator;
    const schema = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const eng = try TsfgEngine.create(alloc, 4 * 1024 * 1024, 65536, 2, schema);
    defer eng.destroy();
    eng.enableProfiling(true);

    // Build a 2-function module: fn0 allocates object & stores in global[0], fn1 increments field after GC!
    var fid0: [32]u8 = [_]u8{0} ** 32;
    fid0[0] = 1;
    var fid1: [32]u8 = [_]u8{0} ** 32;
    fid1[0] = 2;

    const bytes = try bytecode.encodeModule(alloc, .{
        .module_id = [_]u8{7} ** 32,
        .abi_hash = [_]u8{8} ** 32,
        .static_schema_hash = [_]u8{9} ** 32,
        .global_count = 1,
        .functions = &.{
            .{
                .function_id = fid0,
                .param_count = 1,
                .reg_count = 4,
                .ops = &.{
                    .{ .op = .fuel, .a = 1 },
                    .{ .op = .new_obj, .dst = 1, .a = 2, .b = 0, .imm32 = 10 },
                    .{ .op = .field_set, .a = 1, .b = 0, .dst = 0, .imm32 = 0 },
                    .{ .op = .global_set, .a = 1, .imm32 = 0 },
                    .{ .op = .ret, .a = 0 },
                },
            },
            .{
                .function_id = fid1,
                .param_count = 1,
                .reg_count = 5,
                .ops = &.{
                    .{ .op = .fuel, .a = 1 },
                    .{ .op = .global_get, .dst = 1, .imm32 = 0 },
                    .{ .op = .gc_safepoint },
                    .{ .op = .field_get, .dst = 2, .a = 1, .b = 0, .imm32 = 1 },
                    .{ .op = .add_i32, .dst = 3, .a = 2, .b = 0 },
                    .{ .op = .field_set, .a = 1, .b = 0, .dst = 3, .imm32 = 1 },
                    .{ .op = .ret, .a = 3 },
                },
            },
        },
    });
    defer alloc.free(bytes);

    const inst = try eng.loadBytecodeInstance(bytes, null);
    // Frame 1: initialize global object with value 40
    const r0 = inst.callFunction(fid0, &.{vm.TypedVal.fromI32(40)}, .{}, null);
    try std.testing.expectEqual(vm.OutcomeStatus.ok, r0.status);

    // Force minor GC BETWEEN frames! Global object relocates cleanly via VmInstance HandleHook!
    try eng.rt.gc.collectMinor();
    try std.testing.expect(eng.rt.gc.stats.objects_relocated >= 1);

    // Frame 2: reads relocated global object + triggers another GC safepoint + adds 2 -> 42
    const r1 = inst.callFunction(fid1, &.{vm.TypedVal.fromI32(2)}, .{}, null);
    try std.testing.expectEqual(vm.OutcomeStatus.ok, r1.status);
    try std.testing.expectEqual(@as(i32, 42), r1.value.asI32());

    // Frame 3: persists mutated value 42 + 8 -> 50
    const r2 = inst.callFunction(fid1, &.{vm.TypedVal.fromI32(8)}, .{}, null);
    try std.testing.expectEqual(vm.OutcomeStatus.ok, r2.status);
    try std.testing.expectEqual(@as(i32, 50), r2.value.asI32());

    // Real profiler captured VM + GC events!
    const trace_json = try eng.exportChromeTraceJsonAlloc(alloc);
    defer alloc.free(trace_json);
    try std.testing.expect(std.mem.indexOf(u8, trace_json, "\"gc_minor\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, trace_json, "\"vm_call\"") != null);
}
