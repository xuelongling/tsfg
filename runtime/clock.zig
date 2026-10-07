// SPDX-License-Identifier: MIT
const std = @import("std");
extern "kernel32" fn QueryPerformanceFrequency(value: *i64) callconv(.winapi) i32;
extern "kernel32" fn QueryPerformanceCounter(value: *i64) callconv(.winapi) i32;

pub const Deadline = struct {
    expires: ?i64 = null,
    frequency: u64 = 0,
    pub fn init(nanoseconds: ?u64) !Deadline {
        const nanos = nanoseconds orelse return .{};
        var frequency: i64 = 0;
        if (QueryPerformanceFrequency(&frequency) == 0 or frequency <= 0) return error.ClockUnavailable;
        const now = try counter();
        return .{ .expires = expiration(now, @intCast(frequency), nanos), .frequency = @intCast(frequency) };
    }
    pub fn expired(self: Deadline) !bool {
        const expires = self.expires orelse return false;
        return try counter() >= expires;
    }
};
pub fn counter() !i64 {
    var value: i64 = 0;
    if (QueryPerformanceCounter(&value) == 0 or value < 0) return error.ClockUnavailable;
    return value;
}
/// Round positive durations up to the next QPC tick. Split the frequency before
/// multiplying the subsecond part, so every intermediate fits u64. Durations
/// beyond the signed counter's representable future saturate, never wrap.
pub fn expiration(now: i64, frequency: u64, nanoseconds: u64) i64 {
    const maximum = std.math.maxInt(i64);
    const available: u64 = @intCast(maximum - now);
    const seconds = nanoseconds / 1_000_000_000;
    const remainder = nanoseconds % 1_000_000_000;
    const whole = @mulWithOverflow(seconds, frequency);
    if (whole[1] != 0 or whole[0] >= available) return maximum;
    const fraction_product = remainder * (frequency % 1_000_000_000);
    const fraction = remainder * (frequency / 1_000_000_000) +
        fraction_product / 1_000_000_000 + @intFromBool(fraction_product % 1_000_000_000 != 0);
    if (fraction >= available - whole[0]) return maximum;
    return now + @as(i64, @intCast(whole[0] + fraction));
}
