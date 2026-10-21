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
