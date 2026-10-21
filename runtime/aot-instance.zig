// SPDX-License-Identifier: MIT
// Owned storage for one statically linked ordinary compiled module. This is
// independent of the Native0.4 descriptor loader and grants no Native/Resource
// admission or ABI/lifecycle execution evidence. No program bytes, authority
// pointer or callback implementation are accepted from untrusted request JSON.
const std = @import("std");
const request = @import("request.zig");
const Counter = @import("host_counter.zig").Counter;
const semantics = @import("host-semantic-contract.zig");
const identity = @import("host_semantic_identity.zig");

pub const version: u32 = 4;
pub const max_logical_parameters: usize = 64;
pub const max_physical_arguments: usize = 128;

// Serialized scalar/presence slots have alignment4, unlike the instance's
// internal nominal u64 globals. Boolean and f32 carriers retain the C ABI bits.
pub const RawSlot = extern struct { low: u32 = 0, high: u32 = 0 };
pub const Failure = extern struct {
    // 0 none, 1 trap, 2 abort, 3 request, 4 managed exception (module TDZ).
    // Preserve the generated first failure verbatim; this adds no catch path.
    kind: u32 = 0,
    reason: u32 = 0,
    function_index: u32 = 0,
    source_index: u32 = 0,
    start: u32 = 0,
    end: u32 = 0,
    reserved: [2]u32 = .{ 0, 0 },
};
pub const Host31 = extern struct {
    capability: u32,
    reserved: u32,
    signature: [32]u8,
    semantic_contract: [32]u8,
    counter: ?*anyopaque,
};
const HostCall = *const fn (?*anyopaque, u32) callconv(.c) u32;
const HostAdmission = *const fn (?*const anyopaque) callconv(.c) u32;
pub const Authority = extern struct {
    version: u32,
    bytes: u32,
    signature: [32]u8,
    semantic_contract: [32]u8,
    host31: ?HostCall,
    admitted: ?HostAdmission,
};
pub const InstanceRecord = extern struct {
    version: u32,
    bytes: u32,
    compiled_table_id: [32]u8,
    status: u32,
    active: u32,
    global_count: u32,
    host_count: u32,
    globals: ?[*]u64,
    initialized: ?[*]u8,
    hosts: ?[*]const Host31,
    authority: ?*const Authority,
    memo: Failure,
};
pub const Event = *const fn (?*anyopaque, u32, u32, u32, u32, u64) callconv(.c) i32;
pub const Request = extern struct {
    version: u32,
    bytes: u32,
    event_state: ?*anyopaque,
    event: ?Event,
    failure: Failure,

    // The trusted embedding supplies its real budget/source-location callback.
    // Failure storage belongs to this request and never aliases instance.memo.
    pub fn init(event_state: ?*anyopaque, event: Event) Request {
        return .{ .version = version, .bytes = @sizeOf(Request), .event_state = event_state,
            .event = event, .failure = .{} };
    }
};

// One concrete compiled artifact supplies these immutable symbols and entry
// points at link time. There is no request-selected module or entry address.
extern const tsfg_aot_global_count_v4: u32;
extern const tsfg_aot_required_host_count_v4: u32;
extern const tsfg_aot_compiled_table_id_v4: [32]u8;
extern fn tsfg_aot_instance_init_v4(instance: *InstanceRecord) callconv(.c) u32;
extern fn tsfg_aot_invoke_v4(instance: *InstanceRecord, invocation: *Request, root_index: u32,
    argument_count: u32, argument_types: ?[*]const u8, result_type: u8,
    arguments: ?*const anyopaque, output: *anyopaque) callconv(.c) u32;

fn callHost(raw: ?*anyopaque, argument: u32) callconv(.c) u32 {
    const counter: *Counter = @ptrCast(@alignCast(raw orelse return 0));
    return counter.call(argument);
}
fn admitHost(raw: ?*const anyopaque) callconv(.c) u32 {
    const counter: *const Counter = @ptrCast(@alignCast(raw orelse return 0));
    // The actual certificate and machine identity stay authoritative. A false
    // certificate remains false; no test-only positive authority is installed.
    return @intFromBool(counter.admitted());
}
const authority: Authority = .{
    .version = version,
    .bytes = @sizeOf(Authority),
    .signature = identity.signature_hash,
    .semantic_contract = identity.contract_hash,
    .host31 = &callHost,
    .admitted = &admitHost,
};

pub const InitError = std.mem.Allocator.Error || error{
    InvalidCapability,
    InvalidHostContract,
    UnsupportedCompiledCapabilities,
    CompiledInstanceRejected,
};

// Each instance has one serial, non-reentrant owner. Move the returned value;
// copying an owning Instance would duplicate ownership of its allocator slices.
// Capability Counter storage is borrowed for the instance lifetime. The caller
// keeps it valid and isolates mutable contexts between concurrent instances.
pub const Instance = struct {
    allocator: std.mem.Allocator,
    globals: []u64,
    initialized: []u8,
    hosts: []Host31,
    record: InstanceRecord,

    pub fn init(allocator: std.mem.Allocator, capabilities: []const request.Capability) InitError!Instance {
        const global_count = tsfg_aot_global_count_v4;
        const host_count = tsfg_aot_required_host_count_v4;
        // The current ordinary module contract has only the fixed Host31
        // capability. Multiple retained declarations share one unique grant.
        if (host_count > 1) return error.UnsupportedCompiledCapabilities;
        if (capabilities.len != host_count) return error.InvalidCapability;
        for (capabilities, 0..) |capability, index| {
            if (capability.id != 31) return error.InvalidCapability;
            for (capabilities[0..index]) |previous| {
                if (previous.id == capability.id) return error.InvalidCapability;
            }
            const signature = capability.signature orelse return error.InvalidCapability;
            const claim = capability.semantic_contract orelse return error.InvalidHostContract;
            if (!semantics.accepts(capability.id, &signature, &claim)) return error.InvalidHostContract;
            if (capability.counter == null) return error.InvalidCapability;
        }
        const globals = try allocator.alloc(u64, global_count);
        errdefer allocator.free(globals);
        const initialized = try allocator.alloc(u8, global_count);
        errdefer allocator.free(initialized);
        const hosts = try allocator.alloc(Host31, host_count);
        errdefer allocator.free(hosts);
        for (capabilities, 0..) |capability, index| {
            hosts[index] = .{ .capability = capability.id, .reserved = 0,
                .signature = capability.signature.?, .semantic_contract = capability.semantic_contract.?,
                .counter = @ptrCast(capability.counter.?) };
        }
        var record: InstanceRecord = .{
            .version = version,
            .bytes = @sizeOf(InstanceRecord),
            .compiled_table_id = tsfg_aot_compiled_table_id_v4,
            .status = 0,
            .active = 0,
            .global_count = global_count,
            .host_count = host_count,
            .globals = if (globals.len == 0) null else globals.ptr,
            .initialized = if (initialized.len == 0) null else initialized.ptr,
            .hosts = if (hosts.len == 0) null else hosts.ptr,
            .authority = &authority,
            .memo = .{},
        };
        // The generated constructor validates the linked table identity and
        // both capacities, clears storage and installs cold state. It runs no
        // guest initializer. Failure releases every array through errdefer.
        if (tsfg_aot_instance_init_v4(&record) != 1) return error.CompiledInstanceRejected;
        return .{ .allocator = allocator, .globals = globals, .initialized = initialized,
            .hosts = hosts, .record = record };
    }

    // The caller supplies physical slots in declaration order, including i32
    // presence tags. Generated code checks the root's exact signature and
    // carriers, authorizes Host31, and owns lifecycle/memo/first-failure order.
    // Every budget, depth, work, deadline and storage decision enters through
    // the trusted caller-owned Request event seam before a Host boundary.
    // A malformed Zig slice pair is an API error before the generated call;
    // generated request failures remain unchanged in invocation.failure.
    pub fn invoke(self: *Instance, invocation: *Request, root_index: u32,
        argument_types: []const u8, arguments: []const RawSlot, result_type: u8,
        output: *RawSlot) error{InvalidArgumentCount}!bool
    {
        if (arguments.len > max_physical_arguments or argument_types.len != arguments.len)
            return error.InvalidArgumentCount;
        var returned: RawSlot = .{};
        const types: ?[*]const u8 = if (argument_types.len == 0) null else argument_types.ptr;
        const values: ?*const anyopaque = if (arguments.len == 0) null else @ptrCast(arguments.ptr);
        const success = tsfg_aot_invoke_v4(&self.record, invocation, root_index,
            @intCast(arguments.len), types, result_type, values, @ptrCast(&returned));
        if (success != 1 or invocation.failure.kind != 0) return false;
        output.* = returned;
        return true;
    }

    pub fn deinit(self: *Instance) void {
        // Serial ownership requires all invocations to have returned. No guest
        // cleanup, reset or initializer is called when releasing owned arrays.
        std.debug.assert(self.record.active == 0);
        self.allocator.free(self.hosts);
        self.allocator.free(self.initialized);
        self.allocator.free(self.globals);
        self.* = undefined;
    }
};

comptime {
    if (@sizeOf(usize) != 8 or max_physical_arguments != max_logical_parameters * 2)
        @compileError("ordinary AOTv4 requires Win64 and 64 logical / 128 physical parameters");
    if (@sizeOf(RawSlot) != 8 or @alignOf(RawSlot) != 4 or
        @offsetOf(RawSlot, "low") != 0 or @offsetOf(RawSlot, "high") != 4)
        @compileError("ordinary AOTv4 raw slot differs from the C scalar carrier");
    if (@sizeOf(Failure) != 32 or @alignOf(Failure) != 4 or
        @offsetOf(Failure, "kind") != 0 or @offsetOf(Failure, "reason") != 4 or
        @offsetOf(Failure, "function_index") != 8 or @offsetOf(Failure, "source_index") != 12 or
        @offsetOf(Failure, "start") != 16 or @offsetOf(Failure, "end") != 20 or
        @offsetOf(Failure, "reserved") != 24)
        @compileError("ordinary AOTv4 failure differs from aot-instance.h");
    if (@sizeOf(Host31) != 80 or @alignOf(Host31) != 8 or
        @offsetOf(Host31, "capability") != 0 or @offsetOf(Host31, "reserved") != 4 or
        @offsetOf(Host31, "signature") != 8 or @offsetOf(Host31, "semantic_contract") != 40 or
        @offsetOf(Host31, "counter") != 72)
        @compileError("ordinary AOTv4 Host differs from aot-instance.h");
    if (@sizeOf(Authority) != 88 or @alignOf(Authority) != 8 or
        @offsetOf(Authority, "version") != 0 or @offsetOf(Authority, "bytes") != 4 or
        @offsetOf(Authority, "signature") != 8 or @offsetOf(Authority, "semantic_contract") != 40 or
        @offsetOf(Authority, "host31") != 72 or @offsetOf(Authority, "admitted") != 80)
        @compileError("ordinary AOTv4 authority differs from aot-instance.h");
    if (@sizeOf(InstanceRecord) != 120 or @alignOf(InstanceRecord) != 8 or
        @offsetOf(InstanceRecord, "version") != 0 or @offsetOf(InstanceRecord, "bytes") != 4 or
        @offsetOf(InstanceRecord, "compiled_table_id") != 8 or @offsetOf(InstanceRecord, "status") != 40 or
        @offsetOf(InstanceRecord, "active") != 44 or @offsetOf(InstanceRecord, "global_count") != 48 or
        @offsetOf(InstanceRecord, "host_count") != 52 or @offsetOf(InstanceRecord, "globals") != 56 or
        @offsetOf(InstanceRecord, "initialized") != 64 or @offsetOf(InstanceRecord, "hosts") != 72 or
        @offsetOf(InstanceRecord, "authority") != 80 or @offsetOf(InstanceRecord, "memo") != 88)
        @compileError("ordinary AOTv4 instance differs from aot-instance.h");
    if (@sizeOf(Request) != 56 or @alignOf(Request) != 8 or
        @offsetOf(Request, "version") != 0 or @offsetOf(Request, "bytes") != 4 or
        @offsetOf(Request, "event_state") != 8 or @offsetOf(Request, "event") != 16 or
        @offsetOf(Request, "failure") != 24)
        @compileError("ordinary AOTv4 request differs from aot-instance.h");
}
