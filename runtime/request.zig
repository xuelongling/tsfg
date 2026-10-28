// SPDX-License-Identifier: MIT
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const Source = bytecode.Source;
const host_counter = @import("host_counter.zig");
const std = @import("std");
const values = @import("request-values.zig");
pub const TypedValue = values.TypedValue;
pub const typedValue = values.typedValue;
pub const Returned = values.Returned;
pub const RequestFailure = values.RequestFailure;
pub const RequestOutcome = values.RequestOutcome;
pub const deinitOutcome = values.deinitOutcome;
pub const Capability = struct { id: u32, signature: ?[32]u8 = null, semantic_contract: ?[32]u8 = null, counter: ?*host_counter.Counter = null };
pub const RequestLimits = struct { memory_bytes: usize = 16384, instruction_budget: u64 = 4097, semantic_fuel: u64 = 4097, depth: u32 = 1, host_time_ns: ?u64 = null };
pub fn requestFailure(code: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = function_id, .source = source } };
}

pub fn finish(outcome: *RequestOutcome, limits: RequestLimits, fuel: u64) void {
    switch (outcome.*) {
        .returned => |*result| { result.fuel_remaining = fuel; result.fuel_consumed = limits.semantic_fuel - fuel; },
        .failed => |*failure| { failure.fuel_remaining = fuel; failure.fuel_consumed = limits.semantic_fuel - fuel; },
    }
}

// These writers share the caller-owned outcome slot. Guest Frames
// and verified descriptor storage never alias it; no writer retains its address.
pub fn storeRequestFailure(out: *RequestOutcome, code: []const u8, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = id.*, .source = source.* } };
}
pub fn storeArithmeticTrap(out: *RequestOutcome, comptime code: []const u8, comptime rule_id: []const u8, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = code, .category = "trap", .rule_ids = &.{rule_id}, .function_id = id.*, .source = source.* } };
}
pub fn storeManagedReference(out: *RequestOutcome, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = "r01-e-reference", .category = "managed-exception", .exception_kind = "ReferenceError", .rule_ids = &.{"r01-modules"}, .function_id = id.*, .source = source.* } };
}
pub fn storeReturned(out: *RequestOutcome, value: TypedValue, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .returned = .{ .result = value, .function_id = id.*, .source = source.* } };
}

/// Check logical caller values before any guest activation or state mutation.
/// Omitted optional parameters are canonical undefined, never host defaults.
pub fn acceptsArguments(info: *const bytecode.ModuleInfo, arguments: []const TypedValue) bool {
    if (arguments.len > info.presence_masks.len) return false;
    var physical: usize = 0;
    for (info.presence_masks, 0..) |presence, index| {
        if (index >= arguments.len) {
            if (presence & 4 == 0) return false;
        } else {
            const argument = arguments[index];
            const state = argument.presenceState();
            if (state == 0 and argument.typeCode() != info.parameter_types[physical]
                or state == 1 and presence & 1 == 0 or state == 2 and presence & 2 == 0) return false;
            if (argument == .string) _ = argument.string.owner.heap.stringLength(argument.string.handle) catch return false;
        }
        physical += if (presence & 3 != 0) @as(usize, 2) else 1;
    }
    return true;
}
