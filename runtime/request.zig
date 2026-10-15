// SPDX-License-Identifier: MIT
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const Source = bytecode.Source;
const host_counter = @import("host_counter.zig");
const std = @import("std");
pub const TypedValue = union(enum) {
    i32: i32, boolean: bool, i8: i8, i16: i16, i64: i64,
    u8: u8, u16: u16, u32: u32, u64: u64, isize: isize, usize: usize,
    f32_bits: u32, f64_bits: u64,
    pub fn typeCode(self: TypedValue) u8 {
        // Fixed decisions preserve the nominal wire codes while avoiding an
        // unqualified Debug jump table in request preflight's machine graph.
        const tag = std.meta.activeTag(self);
        if (tag == .i32) return 1;
        if (tag == .boolean) return 2;
        if (tag == .i8) return 3;
        if (tag == .i16) return 4;
        if (tag == .i64) return 5;
        if (tag == .u8) return 6;
        if (tag == .u16) return 7;
        if (tag == .u32) return 8;
        if (tag == .u64) return 9;
        if (tag == .isize) return 10;
        if (tag == .usize) return 11;
        if (tag == .f32_bits) return 12;
        if (tag == .f64_bits) return 13;
        unreachable;
    }
    pub fn bits(self: TypedValue) u64 {
        const tag = std.meta.activeTag(self);
        if (tag == .i32) return @as(u32, @bitCast(self.i32));
        if (tag == .boolean) return @intFromBool(self.boolean);
        if (tag == .i8) return @as(u8, @bitCast(self.i8));
        if (tag == .i16) return @as(u16, @bitCast(self.i16));
        if (tag == .i64) return @bitCast(self.i64);
        if (tag == .isize) return @bitCast(self.isize);
        if (tag == .u8) return self.u8;
        if (tag == .u16) return self.u16;
        if (tag == .u32) return self.u32;
        if (tag == .u64) return self.u64;
        if (tag == .usize) return self.usize;
        if (tag == .f32_bits) return self.f32_bits;
        if (tag == .f64_bits) return self.f64_bits;
        unreachable;
    }
};
pub fn typedValue(bits: u64, code: u8) TypedValue {
    if (code == 1) return .{ .i32 = @bitCast(@as(u32, @truncate(bits))) };
    if (code == 2) return .{ .boolean = bits != 0 };
    if (code == 3) return .{ .i8 = @bitCast(@as(u8, @truncate(bits))) };
    if (code == 4) return .{ .i16 = @bitCast(@as(u16, @truncate(bits))) };
    if (code == 5) return .{ .i64 = @bitCast(bits) };
    if (code == 6) return .{ .u8 = @truncate(bits) };
    if (code == 7) return .{ .u16 = @truncate(bits) };
    if (code == 8) return .{ .u32 = @truncate(bits) };
    if (code == 9) return .{ .u64 = bits };
    if (code == 10) return .{ .isize = @bitCast(bits) };
    if (code == 11) return .{ .usize = bits };
    if (code == 12) return .{ .f32_bits = @truncate(bits) };
    if (code == 13) return .{ .f64_bits = bits };
    unreachable;
}
pub const Capability = struct { id: u32, signature: ?[32]u8 = null, counter: ?*host_counter.Counter = null };
pub const RequestLimits = struct { memory_bytes: usize = 16384, instruction_budget: u64 = 4097, semantic_fuel: u64 = 4097, depth: u32 = 1, host_time_ns: ?u64 = null };
pub const Returned = struct { result: TypedValue, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestFailure = struct { exception_kind: ?[]const u8 = null, code: []const u8, category: []const u8, rule_ids: []const []const u8 = &.{}, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestOutcome = union(enum) { returned: Returned, failed: RequestFailure };
