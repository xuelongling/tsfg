// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const s = bytecode.arrayCandidate;
const a = std.testing.allocator;
const Input = struct { packets: []const struct { name: []const u8, bytes: usize, sha256: []const u8, hex: []const u8 } };
fn digestEqual(expected: []const u8, bytes: []const u8) !void {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &hash, .{});
    try std.testing.expectEqualStrings(expected, &std.fmt.bytesToHex(hash, .lower));
}
fn decoded(hex: []const u8, length: usize, expected: []const u8) ![]u8 {
    const bytes = try a.alloc(u8, length);
    errdefer a.free(bytes);
    _ = try std.fmt.hexToBytes(bytes, hex);
    try digestEqual(expected, bytes);
    return bytes;
}
fn accepted(allocator: std.mem.Allocator, bytes: []const u8) !*s.ValidatedArrayCandidate {
    return switch (s.load(allocator, bytes)) {
        .loaded => |handle| handle,
        .rejected => |failure| {
            std.debug.print("Array cold rejection {s} at{d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}
fn exact(handle: *const s.ValidatedArrayCandidate, bytes: []const u8) !void {
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
fn whole(index: usize) !void {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const oracle = try std.json.parseFromSlice(std.json.Value, a, @embedFile("testdata/array-packet-oracle.json"), .{});
    defer oracle.deinit();
    try std.testing.expectEqual(@as(usize, 9), inputs.value.packets.len);
    const input = inputs.value.packets[index];
    const bytes = try decoded(input.hex, input.bytes, input.sha256);
    defer a.free(bytes);
    const handle = try accepted(a, bytes);
    defer s.unload(handle);
    const expected = oracle.value.object.get("cases").?.array.items[index].object.get("decoded").?;
    const expected_text = try std.json.Stringify.valueAlloc(a, expected, .{});
    defer a.free(expected_text);
    const actual = try s.inspect(handle, a);
    defer a.free(actual);
    try std.testing.expectEqualStrings(expected_text, actual);
    try exact(handle, bytes);
}
test "whole two slots alias independent fresh" {
    try whole(0);
}
test "whole parameter alias permanently unknown" {
    try whole(1);
}
test "whole recursive parameter-only domain" {
    try whole(2);
}
test "whole actual local ReadSpan" {
    try whole(3);
}
test "whole overwrite and equal resize" {
    try whole(4);
}
test "whole RHS last use permits append" {
    try whole(5);
}
test "whole full-u32 checked endpoints" {
    try whole(6);
}
test "cold-only length before original final View read" {
    try whole(7);
}
test "cold-only discarded length is actual last View use" {
    try whole(8);
}

test "owned immutable ArrayCandidate isolates caller bytes and another handle lifetime" {
    try std.testing.expect(s.ValidatedArrayCandidate != bytecode.VerifiedModule);
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const input = inputs.value.packets[0];
    const bytes = try decoded(input.hex, input.bytes, input.sha256);
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
    try digestEqual(input.sha256, stored);
    try std.testing.expectEqual(@as(usize, 2), s.snapshot(first).payload.functions.len);
    try std.testing.expect(@typeInfo(@TypeOf(s.snapshot(first).payload.functions)).pointer.is_const);
    try std.testing.expect(@typeInfo(@TypeOf(s.snapshot(first).payload.functions[0].instructions)).pointer.is_const);
}
fn allocationFailures(bytes: []const u8, name: []const u8) !void {
    var failures: usize = 0;
    var reached = false;
    for (0..512) |index| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
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
    std.debug.print("Array actual load OOM {s}: {d} allocation points, all cleaned then success\n", .{ name, failures });
}
test "every actual load OOM point across all nine whole models is unpublished and cleaned" {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    for (inputs.value.packets) |input| {
        const bytes = try decoded(input.hex, input.bytes, input.sha256);
        defer a.free(bytes);
        try allocationFailures(bytes, input.name);
    }
}
test "inspect and exact serialization OOM preserve the loaded whole model" {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const input = inputs.value.packets[0];
    const bytes = try decoded(input.hex, input.bytes, input.sha256);
    defer a.free(bytes);
    const handle = try accepted(a, bytes);
    defer s.unload(handle);
    const before = try s.inspect(handle, a);
    defer a.free(before);
    inline for (.{ s.inspect, s.serialize }) |operation| {
        var failures: usize = 0;
        var reached = false;
        for (0..128) |index| {
            var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
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
        std.debug.print("Array view operation OOM points{d}, all cleaned then success\n", .{failures});
    }
    const after = try s.inspect(handle, a);
    defer a.free(after);
    try std.testing.expectEqualStrings(before, after);
    try exact(handle, bytes);
}
