// SPDX-License-Identifier: MIT
// Independent first-touch whole; earlier first-pair source remains frozen separately.
const std = @import("std");
const s = @import("bytecode.zig").arrayCandidate;
const comparison = @import("array-candidate-test-support.zig");
const a = std.testing.allocator;
const Gold = struct { cases: []const struct { name: []const u8, packet: struct { bytes: usize, sha256: []const u8 }, decoded: std.json.Value } };
fn packet(_: usize) []const u8 {
    return @embedFile("testdata/array-packet-v3-first-touch-alias.packet-v3.bin");
}
fn gold() !std.json.Parsed(Gold) {
    return std.json.parseFromSlice(Gold, a, @embedFile("testdata/array-packet-v3-original-call-boundaries-whole-oracle.json"), .{ .ignore_unknown_fields = true });
}
fn accepted(allocator: std.mem.Allocator, bytes: []const u8) !*s.ValidatedArrayCandidate {
    return switch (s.load(allocator, bytes)) {
        .loaded => |handle| handle,
        .rejected => |failure| {
            std.debug.print("First touch alias rejected {s} at{d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}
fn exact(handle: *const s.ValidatedArrayCandidate, bytes: []const u8, expected: std.json.Value) !void {
    const observed = try s.inspect(handle, a);
    defer a.free(observed);
    // This compares the entire independent DTO after recursive key ordering (JCS).
    try comparison.equal(expected, observed);
    const serialized = try s.serialize(handle, a);
    defer a.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
}
fn whole(index: usize) !void {
    const input = try gold();
    defer input.deinit();
    try std.testing.expectEqual(@as(usize, 1), input.value.cases.len);
    const c = input.value.cases[index];
    const bytes = packet(index);
    try std.testing.expectEqual(c.packet.bytes, bytes.len);
    try comparison.hashEqual(c.packet.sha256, bytes);
    const handle = try accepted(a, bytes);
    defer s.unload(handle);
    try exact(handle, bytes, c.decoded);
    std.debug.print("First touch alias whole {s}: {d} bytes complete DTO/JCS and exact serialize\n", .{ c.name, bytes.len });
}
test "first touch alias complete independent whole DTO/JCS exact serialization" {
    try whole(0);
}
test "first touch alias original packets remain owned across caller mutation and independent unload" {
    for (0..1) |index| {
        const bytes = try a.dupe(u8, packet(index));
        defer a.free(bytes);
        const first = try accepted(a, bytes);
        defer s.unload(first);
        const second = try accepted(a, bytes);
        const before = try s.inspect(first, a);
        defer a.free(before);
        @memset(bytes, 0);
        s.unload(second);
        const after = try s.inspect(first, a);
        defer a.free(after);
        try std.testing.expectEqualStrings(before, after);
        const stored = try s.serialize(first, a);
        defer a.free(stored);
        try std.testing.expectEqualSlices(u8, packet(index), stored);
    }
}
test "first touch alias every actual load inspect serialize OOM point cleans up and preserves model" {
    const input = try gold();
    defer input.deinit();
    for (0..1) |index| {
        const bytes = packet(index);
        var reached = false;
        var failures: usize = 0;
        for (0..512) |at| {
            var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = at });
            failing.resize_fail_index = 0;
            switch (s.load(failing.allocator(), bytes)) {
                .loaded => |handle| {
                    s.unload(handle);
                    reached = true;
                },
                .rejected => |failure| {
                    try std.testing.expectEqualStrings("r04-array-allocation", failure.code);
                    failures += 1;
                },
            }
            try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            if (reached) break;
        }
        try std.testing.expect(reached and failures > 0);
        std.debug.print("First touch alias {s} actual load OOM {d}, zero residue then success\n", .{ input.value.cases[index].name, failures });
        const handle = try accepted(a, bytes);
        defer s.unload(handle);
        inline for (.{ s.inspect, s.serialize }) |operation| {
            reached = false;
            failures = 0;
            for (0..128) |at| {
                var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = at });
                failing.resize_fail_index = 0;
                if (operation(handle, failing.allocator())) |value| {
                    failing.allocator().free(value);
                    reached = true;
                } else |err| {
                    try std.testing.expectEqual(error.OutOfMemory, err);
                    failures += 1;
                }
                try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
                if (reached) break;
            }
            try std.testing.expect(reached and failures > 0);
            std.debug.print("First touch alias {s} actual observe OOM {d}, zero residue then success\n", .{ input.value.cases[index].name, failures });
        }
        try exact(handle, bytes, input.value.cases[index].decoded);
    }
}
