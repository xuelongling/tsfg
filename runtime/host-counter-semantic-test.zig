// SPDX-License-Identifier: MIT
// Link only the existing real C leaf. No VM, bridge/probe, certificate or mock.
const std = @import("std");
const Counter = extern struct { storage: u32, reserved: u32, events: u64 };
extern fn tsfg_host_counter(counter: *Counter, delta: u32) callconv(.c) u32;
comptime {
    if (@sizeOf(Counter) != 16 or @alignOf(Counter) != 8 or @offsetOf(Counter,"storage") != 0 or
        @offsetOf(Counter,"reserved") != 4 or @offsetOf(Counter,"events") != 8) @compileError("Counter ABI");
}
test "M22 real Counter returns wrapping storage and increments event once" {
    var value: Counter = .{ .storage = 0xfffffff0, .reserved = 0x12345678, .events = 0xffffffffffffffff };
    try std.testing.expectEqual(@as(u32, 0x10), tsfg_host_counter(&value, 0x20));
    try std.testing.expectEqual(@as(u32, 0x10), value.storage);
    try std.testing.expectEqual(@as(u64, 0), value.events);
    try std.testing.expectEqual(@as(u32, 0x12345678), value.reserved);
    try std.testing.expectEqual(@as(u32, 0x10), tsfg_host_counter(&value, 0));
    try std.testing.expectEqual(@as(u64, 1), value.events);
}
test "M22 real Counter touches only its owned context and no adjacent instance" {
    const Guarded = extern struct { before: u64, first: Counter, second: Counter, after: u64 };
    var state: Guarded = .{ .before = 0x1122334455667788, .first = .{ .storage = 7, .reserved = 9, .events = 2 },
        .second = .{ .storage = 11, .reserved = 13, .events = 17 }, .after = 0x8877665544332211 };
    try std.testing.expectEqual(@as(u32, 6), tsfg_host_counter(&state.first, 0xffffffff));
    try std.testing.expectEqual(@as(u32, 9), state.first.reserved);
    try std.testing.expectEqual(@as(u64, 3), state.first.events);
    try std.testing.expectEqual(@as(u32, 11), state.second.storage);
    try std.testing.expectEqual(@as(u32, 13), state.second.reserved);
    try std.testing.expectEqual(@as(u64, 17), state.second.events);
    try std.testing.expectEqual(@as(u64, 0x1122334455667788), state.before);
    try std.testing.expectEqual(@as(u64, 0x8877665544332211), state.after);
    try std.testing.expectEqual(@as(u32, 16), tsfg_host_counter(&state.second, 5));
    try std.testing.expectEqual(@as(u32, 6), state.first.storage);
    try std.testing.expectEqual(@as(u64, 3), state.first.events);
}
