// SPDX-License-Identifier: MIT
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const Source = bytecode.Source;
const host_counter = @import("host_counter.zig");
pub const TypedValue = union(enum) {
    i32: i32, boolean: bool, i8: i8, i16: i16, i64: i64,
    u8: u8, u16: u16, u32: u32, u64: u64, isize: isize, usize: usize,
    f32_bits: u32, f64_bits: u64,
    pub fn typeCode(self: TypedValue) u8 {
        return switch (self) { .i32 => 1, .boolean => 2, .i8 => 3, .i16 => 4, .i64 => 5, .u8 => 6, .u16 => 7, .u32 => 8, .u64 => 9, .isize => 10, .usize => 11, .f32_bits => 12, .f64_bits => 13 };
    }
    pub fn bits(self: TypedValue) u64 {
        return switch (self) {
            .i32 => |v| @as(u32, @bitCast(v)), .boolean => |v| @intFromBool(v),
            .i8 => |v| @as(u8, @bitCast(v)), .i16 => |v| @as(u16, @bitCast(v)),
            .i64 => |v| @bitCast(v), .isize => |v| @bitCast(v),
            .u8 => |v| v, .u16 => |v| v, .u32 => |v| v, .u64 => |v| v, .usize => |v| v,
            .f32_bits => |v| v, .f64_bits => |v| v,
        };
    }
};
pub fn typedValue(bits: u64, code: u8) TypedValue {
    return switch (code) {
        1 => .{ .i32 = @bitCast(@as(u32, @truncate(bits))) }, 2 => .{ .boolean = bits != 0 },
        3 => .{ .i8 = @bitCast(@as(u8, @truncate(bits))) }, 4 => .{ .i16 = @bitCast(@as(u16, @truncate(bits))) },
        5 => .{ .i64 = @bitCast(bits) }, 6 => .{ .u8 = @truncate(bits) }, 7 => .{ .u16 = @truncate(bits) },
        8 => .{ .u32 = @truncate(bits) }, 9 => .{ .u64 = bits }, 10 => .{ .isize = @bitCast(bits) }, 11 => .{ .usize = bits }, 12 => .{ .f32_bits = @truncate(bits) }, 13 => .{ .f64_bits = bits }, else => unreachable,
    };
}
pub const Capability = struct { id: u32, signature: ?[32]u8 = null, counter: ?*host_counter.Counter = null };
pub const RequestLimits = struct { memory_bytes: usize = 16384, instruction_budget: u64 = 4097, semantic_fuel: u64 = 4097, depth: u32 = 1, host_time_ns: ?u64 = null };
pub const Returned = struct { result: TypedValue, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestFailure = struct { exception_kind: ?[]const u8 = null, code: []const u8, category: []const u8, rule_ids: []const []const u8 = &.{}, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestOutcome = union(enum) { returned: Returned, failed: RequestFailure };
