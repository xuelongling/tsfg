// SPDX-License-Identifier: MIT
// Second production consumer of the shared typed request protocol. Selection,
// presence and outcomes retain their existing meanings; generated code owns
// module initialization, stores, first-failure memo and ordered computation.
const std = @import("std");
const abi = @import("aot-instance.zig");
const program = @import("aot-program.zig");
const events = @import("aot-events.zig");
const request = @import("request.zig");
const json = @import("request-json.zig");
const Runtime = @import("runtime-state.zig").Runtime;
const Counter = @import("host_counter.zig").Counter;
const semantics = @import("host-semantic-contract.zig");
const clock = @import("clock.zig");
const FloatingEnvironment = @import("floating-environment.zig").FloatingEnvironment;

fn capabilityFailure(metadata: *const program.Metadata, capabilities: []const request.Capability) ?[]const u8 {
    const hosts = if (metadata.program.host_count == 0) &.{} else metadata.program.hosts.?[0..metadata.program.host_count];
    for (capabilities, 0..) |capability, index| {
        var required = false;
        for (hosts) |host| if (host.required == 1 and host.capability == capability.id) {
            required = true;
            const signature = capability.signature orelse return "r05-request-capability";
            const claim = capability.semantic_contract orelse return "r05-request-host-contract";
            if (!semantics.accepts(capability.id, &signature, &claim)) return "r05-request-host-contract";
            const counter = capability.counter orelse return "r05-request-capability";
            if (!std.mem.eql(u8, &signature, &host.signature) or !counter.admitted()) return "r05-request-capability";
        };
        if (!required) return "r05-request-capability";
        for (capabilities[0..index]) |previous| if (previous.id == capability.id) return "r05-request-capability";
    }
    for (hosts) |host| if (host.required == 1) {
        var authorized = false;
        for (capabilities) |capability| if (capability.id == host.capability) { authorized = true; break; };
        if (!authorized) return "r05-request-capability";
    };
    return null;
}

// Canonical scalar carrier conversion is the ABI boundary, not arithmetic.
// Float bits and nominal integer widths never pass through a host float value.
fn slot(bits: u64, code: u8) abi.RawSlot {
    if (code == 2) return .{ .low = 0, .high = @intFromBool(bits != 0) };
    return .{ .low = @truncate(bits), .high = @truncate(bits >> 32) };
}
fn resultBits(value: abi.RawSlot, code: u8) u64 {
    if (code == 2) return value.high;
    return @as(u64, value.low) | @as(u64, value.high) << 32;
}

pub fn evaluate(host: *Runtime, metadata: *program.Metadata, original: *const json.Request,
    persistent: ?*?abi.Instance, counter: *Counter, out: *request.RequestOutcome) !void
{
    var parsed: json.ParsedRequest = undefined;
    parsed.argument_count = 0;
    parsed.argument_owner = null;
    defer {
        for (parsed.argument_storage[0..parsed.argument_count]) |*argument| if (argument.* == .string) argument.string.deinit();
        if (parsed.argument_owner) |owner| owner.release();
    }
    if (!try @call(.never_inline, json.parseRequest, .{ host.allocator, metadata, original, counter, &parsed, out })) return;
    var selected: u32 = 0;
    for (0..metadata.program.function_count) |index| if (std.mem.eql(u8, &parsed.function_id, &metadata.program.functions.?[index].id)) {
        selected = @intCast(index); break;
    };
    const info = metadata.info(selected);
    var fuel = parsed.limits.semantic_fuel;
    defer request.finish(out, parsed.limits, fuel);
    const root = metadata.rootIndex(selected, parsed.init_only) orelse {
        request.storeRequestFailure(out, "r05-request-function", &info.function_id, &info.source); return;
    };
    const capabilities = parsed.capabilities[0..parsed.capability_count];
    if (capabilityFailure(metadata, capabilities)) |code| {
        request.storeRequestFailure(out, code, &info.function_id, &info.source); return;
    }
    var fresh: ?abi.Instance = null;
    const storage = persistent orelse &fresh;
    var active = false;
    defer {
        if (!parsed.init_only) { if (fresh) |*value| value.deinit(); }
        if (active) host.active_requests -= 1;
        if (parsed.init_only) { if (fresh) |*value| value.deinit(); }
    }
    if (storage.* == null) {
        if (!parsed.init_only) { host.active_requests += 1; active = true; }
        storage.* = abi.Instance.init(host.allocator, capabilities) catch |err| {
            if (parsed.init_only) return err;
            request.storeRequestFailure(out, "r05-execution-abort", &info.function_id, &metadata.defaultInfo().source); return;
        };
    }
    if (!active) { host.active_requests += 1; active = true; }
    const instance = &storage.*.?;
    // A failed initializer is an immutable instance result. The original
    // request preflight above still precedes replay; no clock or guest event
    // may replace its precise first failure.
    if (instance.record.status == 3) { events.storeFailure(metadata, instance.record.memo, &info, out); return; }
    if (instance.record.status == 1 or instance.record.active != 0) {
        request.storeRequestFailure(out, "r05-request-instance", &info.function_id, &info.source); return;
    }
    const environment = FloatingEnvironment.read();
    environment.establish();
    defer environment.restore();
    const time_limit = parsed.limits.host_time_ns orelse if (instance.hosts.len != 0) @as(?u64, 1_000_000_000) else null;
    const deadline = clock.Deadline.init(time_limit) catch {
        request.storeRequestFailure(out, "r05-execution-abort", &info.function_id, &metadata.defaultInfo().source); return;
    };
    var invocation: abi.Request = undefined;
    var context: events.Context = .{ .allocator = host.allocator, .metadata = metadata,
        .instance = instance, .invocation = &invocation, .counter = counter, .limits = parsed.limits,
        .fuel = fuel, .work = parsed.limits.instruction_budget, .deadline = deadline, .requested = selected };
    defer context.deinit();
    invocation = abi.Request.init(@ptrCast(&context), &events.Context.event);
    var arguments: [128]abi.RawSlot = undefined;
    var physical: usize = 0;
    for (info.presence_masks, 0..) |mask, index| {
        const value: request.TypedValue = if (index < parsed.arguments.len) parsed.arguments[index] else .{ .undefined_value = {} };
        const code = info.parameter_types[physical];
        arguments[physical] = slot(value.bits(), code);
        physical += 1;
        if (mask & 3 != 0) { arguments[physical] = slot(value.presenceState(), 1); physical += 1; }
    }
    var returned: abi.RawSlot = .{};
    const success = instance.invoke(&invocation, root, info.parameter_types, arguments[0..physical], info.return_type, &returned) catch false;
    fuel = context.fuel;
    if (success and !context.invalid_event and context.frames.items.len == 0) {
        const source = context.returned_source orelse info.source;
        request.storeReturned(out, request.typedValue(resultBits(returned, info.return_type), info.return_type), &info.function_id, &source);
    } else if (invocation.failure.kind != 0) events.storeFailure(metadata, invocation.failure, &info, out)
    else request.storeRequestFailure(out, "r05-execution-abort", &info.function_id, &info.source);
}
