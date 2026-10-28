// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("runtime");

const State = struct {
    environment: runtime.FloatingEnvironment,
    status: u16,
    x87: [28]u8,
    fn read() State {
        var status: u16 = undefined;
        asm volatile ("fnstsw (%[ptr])" : : [ptr] "r" (&status) : .{ .memory = true });
        return .{ .environment = runtime.FloatingEnvironment.read(), .status = status, .x87 = x87Read() };
    }
};
fn x87Read() [28]u8 {
    var bytes: [28]u8 = undefined;
    // FNSTENV masks exceptions; restore the exact recorded environment immediately.
    asm volatile ("fnstenv (%[ptr])" : : [ptr] "r" (&bytes) : .{ .memory = true });
    x87Write(&bytes);
    return bytes;
}
fn x87Write(bytes: *const [28]u8) void {
    asm volatile ("fldenv (%[ptr])" : : [ptr] "r" (bytes) : .{ .memory = true });
}
fn observe(host: *runtime.Runtime, module: *const runtime.VerifiedModule, arguments: []const runtime.TypedValue, limits: runtime.RequestLimits) !runtime.RequestOutcome {
    const before = State.read();
    const result = runtime.eval_bytecode(host, module, runtime.functions(module)[0].info.function_id, arguments, &.{}, limits);
    const after = State.read();
    // All state observation precedes assertion/error formatting.
    try std.testing.expectEqual(before.environment.mxcsr, after.environment.mxcsr);
    try std.testing.expectEqual(before.environment.x87_control, after.environment.x87_control);
    try std.testing.expectEqual(before.status, after.status);
    try std.testing.expectEqualSlices(u8, &before.x87, &after.x87);
    std.debug.print("mxcsr {x} -> {x}; x87cw {x} -> {x}; x87status {x} -> {x}; full-x87-environment equal\n", .{ before.environment.mxcsr, after.environment.mxcsr, before.environment.x87_control, after.environment.x87_control, before.status, after.status });
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
    return result;
}
fn rejectUnchanged(host: *runtime.Runtime, module: *const runtime.VerifiedModule, id: runtime.FunctionId, arguments: []const runtime.TypedValue, capabilities: []const runtime.Capability, expected: []const u8) !void {
    const before = State.read();
    const result = runtime.eval_bytecode(host, module, id, arguments, capabilities,
        .{ .depth = 0, .memory_bytes = 0, .instruction_budget = 0, .semantic_fuel = 0 });
    const after = State.read();
    try std.testing.expectEqual(before.environment.mxcsr, after.environment.mxcsr);
    try std.testing.expectEqual(before.environment.x87_control, after.environment.x87_control);
    try std.testing.expectEqual(before.status, after.status);
    try std.testing.expectEqualSlices(u8, &before.x87, &after.x87);
    try std.testing.expectEqualStrings(expected, result.failed.code);
    try std.testing.expectEqual(@as(u64, 0), result.failed.fuel_consumed);
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
}
fn load(bytes: []const u8) !*runtime.VerifiedModule {
    return switch (runtime.load(std.testing.allocator, bytes)) {
        .loaded => |module| module,
        .rejected => error.InvalidSourceProducedPacket,
    };
}
fn exercise(comptime code: u8, success_bytes: []const u8, trap_bytes: []const u8) !void {
    const success = try load(success_bytes);
    defer runtime.unload(success);
    const trap = try load(trap_bytes);
    defer runtime.unload(trap);
    var host = runtime.Runtime.init(std.testing.allocator);
    const args = [_]runtime.TypedValue{ runtime.typedValue(1, code), runtime.typedValue(0, code) };
    const trap_args = [_]runtime.TypedValue{ runtime.typedValue(1, code), .{ .i32 = 0 } };
    const returned = try observe(&host, success, &args, .{});
    try std.testing.expectEqual(@as(u64, 1), returned.returned.result.bits());
    const nan_args = [_]runtime.TypedValue{ runtime.typedValue(if (code == 12) 0x7f800001 else 0x7ff0000000000001, code), runtime.typedValue(0, code) };
    const nan = try observe(&host, success, &nan_args, .{});
    try std.testing.expectEqual(@as(u64, if (code == 12) 0x7fc00000 else 0x7ff8000000000000), nan.returned.result.bits());
    const trapped = try observe(&host, trap, &trap_args, .{});
    try std.testing.expectEqualStrings("trap", trapped.failed.category);
    const aborted = try observe(&host, success, &args, .{ .instruction_budget = 0 });
    try std.testing.expectEqualStrings("execution-abort", aborted.failed.category);
    const recovered = try observe(&host, success, &args, .{});
    try std.testing.expectEqual(@as(u64, 1), recovered.returned.result.bits());
    const id = runtime.functions(success)[0].info.function_id;
    try rejectUnchanged(&host, success, [_]u8{0} ** 32, &args, &.{}, "r05-request-function");
    try rejectUnchanged(&host, success, id, &.{}, &.{}, "r05-request-arguments");
    try rejectUnchanged(&host, success, id, &args, &.{.{ .id = 31 }}, "r05-request-capability");
    try rejectUnchanged(&host, success, id, &args, &.{}, "r01-t-depth");
}

test "actual VM requests restore caller MXCSR and leave altered x87 status unchanged on the executing thread" {
    const original = State.read();
    const x87 = x87Read();
    defer {
        x87Write(&x87);
        original.environment.restore();
    }
    for (0..8) |index| {
        var changed = x87;
        const control = (original.environment.x87_control & ~@as(u16, 0x0c00)) | @as(u16, @intCast(index % 4)) << 10 | 0x003f;
        std.mem.writeInt(u16, changed[0..2], control, .little);
        std.mem.writeInt(u16, changed[4..6], if (index < 4) 0x003f else 0, .little);
        x87Write(&changed);
        const caller = runtime.FloatingEnvironment{
            .mxcsr = if (index < 4) 0x1fbf | @as(u32, @intCast(index)) << 13 | 0x8040
                else @as(u32, @intCast(index % 4)) << 13 | 0x8040,
            .x87_control = control,
        };
        caller.restore();
        try exercise(12, @embedFile("f32-success.tbc"), @embedFile("f32-trap.tbc"));
        try exercise(13, @embedFile("f64-success.tbc"), @embedFile("f64-trap.tbc"));
    }
}
