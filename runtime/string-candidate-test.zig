// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const s = bytecode.stringCandidate;
const a = std.testing.allocator;
const Input = struct { packets: []const struct { name: []const u8, bytes: usize, sha256: []const u8, hex: []const u8 } };
const ColdCase = struct { id: []const u8, packetBytes: usize, packetSHA256: []const u8, packetHex: []const u8, expected: struct { decodedJCSSHA256: ?[]const u8 = null, serializeSHA256: ?[]const u8 = null } };
const Cold = struct { negatives: []const ColdCase, positives: []const ColdCase };
fn decodedBytes(hex: []const u8, length: usize, wanted: []const u8) ![]u8 {
    const bytes = try a.alloc(u8, length);
    errdefer a.free(bytes);
    _ = try std.fmt.hexToBytes(bytes, hex);
    try digestEqual(wanted, bytes);
    return bytes;
}
fn digestEqual(expected: []const u8, bytes: []const u8) !void {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &hash, .{});
    try std.testing.expectEqualStrings(expected, &std.fmt.bytesToHex(hash, .lower));
}
fn accepted(bytes: []const u8) !*s.ValidatedStringCandidate {
    return switch (s.load(a, bytes)) {
        .loaded => |value| value,
        .rejected => |failure| {
            std.debug.print("unexpected String cold {s} at{d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}
fn copiedExactly(handle: *const s.ValidatedStringCandidate, bytes: []const u8) !void {
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
// Only test JSON with ASCII field names and finite integers is canonicalized.
// This is an independent DTO observation, not a decoder or oracle generator.
fn keyLess(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}
fn ordered(allocator: std.mem.Allocator, value: std.json.Value) std.mem.Allocator.Error!std.json.Value {
    return switch (value) {
        .object => |object| blk: {
            const keys = try allocator.alloc([]const u8, object.count());
            var it = object.iterator();
            var i: usize = 0;
            while (it.next()) |entry| : (i += 1) keys[i] = entry.key_ptr.*;
            std.mem.sort([]const u8, keys, {}, keyLess);
            var result: std.json.ObjectMap = .empty;
            for (keys) |key| try result.put(allocator, key, try ordered(allocator, object.get(key).?));
            break :blk .{ .object = result };
        },
        .array => |array| blk: {
            var result: std.array_list.Managed(std.json.Value) = .init(allocator);
            for (array.items) |item| try result.append(try ordered(allocator, item));
            break :blk .{ .array = result };
        },
        else => value,
    };
}
fn canonicalDigest(handle: *const s.ValidatedStringCandidate, expected: []const u8) !void {
    const text = try s.inspect(handle, a);
    defer a.free(text);
    const parsed = try std.json.parseFromSlice(std.json.Value, a, text, .{});
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const canonical = try std.json.Stringify.valueAlloc(arena.allocator(), try ordered(arena.allocator(), parsed.value), .{});
    try digestEqual(expected, canonical);
}

test "all three independent complete String models and original packet bytes agree" {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/string-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const gold = try std.json.parseFromSlice(std.json.Value, a, @embedFile("testdata/string-packet-oracle.json"), .{});
    defer gold.deinit();
    try std.testing.expectEqual(@as(usize, 3), inputs.value.packets.len);
    for (inputs.value.packets, 0..) |input, index| {
        const bytes = try decodedBytes(input.hex, input.bytes, input.sha256);
        defer a.free(bytes);
        const handle = try accepted(bytes);
        defer s.unload(handle);
        const wanted = gold.value.object.get("cases").?.array.items[index].object.get("decoded").?;
        const expected = try std.json.Stringify.valueAlloc(a, wanted, .{});
        defer a.free(expected);
        const actual = try s.inspect(handle, a);
        defer a.free(actual);
        try std.testing.expectEqualStrings(expected, actual);
        try copiedExactly(handle, bytes);
        std.debug.print("String whole {s}: complete DTO and {d}B exact serialize\n", .{ input.name, bytes.len });
    }
}

test "seven independent positive boundaries match complete decoded canonical digests" {
    const cases = try std.json.parseFromSlice(Cold, a, @embedFile("testdata/string-packet-negative-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    try std.testing.expectEqual(@as(usize, 7), cases.value.positives.len);
    for (cases.value.positives) |case| {
        const bytes = try decodedBytes(case.packetHex, case.packetBytes, case.packetSHA256);
        defer a.free(bytes);
        const handle = try accepted(bytes);
        defer s.unload(handle);
        try canonicalDigest(handle, case.expected.decodedJCSSHA256.?);
        try copiedExactly(handle, bytes);
        try digestEqual(case.expected.serializeSHA256.?, bytes);
        std.debug.print("String cold positive {s}: full DTO and exact serialize\n", .{case.id});
    }
}

test "32 independent repaired deep negatives never publish or leak" {
    const cases = try std.json.parseFromSlice(Cold, a, @embedFile("testdata/string-packet-negative-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    try std.testing.expectEqual(@as(usize, 32), cases.value.negatives.len);
    for (cases.value.negatives) |case| {
        const bytes = try decodedBytes(case.packetHex, case.packetBytes, case.packetSHA256);
        defer a.free(bytes);
        switch (s.load(a, bytes)) {
            .loaded => |handle| {
                s.unload(handle);
                return error.UnexpectedAdmission;
            },
            .rejected => |failure| {
                try std.testing.expect(failure.offset <= bytes.len);
                try std.testing.expect(std.mem.startsWith(u8, failure.code, "r04-string-"));
                std.debug.print("String cold negative {s}: {s} at{d}\n", .{ case.id, failure.code, failure.offset });
            },
        }
    }
}

test "owned immutable handles survive caller mutation and other handle unload" {
    try std.testing.expect(s.ValidatedStringCandidate != bytecode.VerifiedModule);
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/string-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const input = inputs.value.packets[2];
    const bytes = try decodedBytes(input.hex, input.bytes, input.sha256);
    defer a.free(bytes);
    const first = try accepted(bytes);
    defer s.unload(first);
    const second = try accepted(bytes);
    const before = try s.inspect(first, a);
    defer a.free(before);
    @memset(bytes, 0);
    s.unload(second);
    const after = try s.inspect(first, a);
    defer a.free(after);
    try std.testing.expectEqualStrings(before, after);
    const serialized = try s.serialize(first, a);
    defer a.free(serialized);
    try digestEqual(input.sha256, serialized);
    try std.testing.expectEqual(@as(usize, 6), s.snapshot(first).payload.functions.len);
}

fn allocationFailures(bytes: []const u8, name: []const u8) !void {
    var failures: usize = 0;
    var reached = false;
    for (0..256) |offset| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = offset });
        failing.resize_fail_index = 0;
        switch (s.load(failing.allocator(), bytes)) {
            .loaded => |handle| {
                s.unload(handle);
                reached = true;
            },
            .rejected => |failure| {
                try std.testing.expectEqualStrings("r04-string-allocation", failure.code);
                failures += 1;
            },
        }
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (reached) break;
    }
    try std.testing.expect(reached and failures > 0);
    std.debug.print("String actual OOM {s}: {d} allocation points, all cleaned before success\n", .{ name, failures });
}
test "all real allocation points including maximum package release unpublished storage" {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/string-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    for (inputs.value.packets) |input| {
        const bytes = try decodedBytes(input.hex, input.bytes, input.sha256);
        defer a.free(bytes);
        try allocationFailures(bytes, input.name);
    }
    const cases = try std.json.parseFromSlice(Cold, a, @embedFile("testdata/string-packet-negative-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    const maximum = cases.value.positives[6];
    const bytes = try decodedBytes(maximum.packetHex, maximum.packetBytes, maximum.packetSHA256);
    defer a.free(bytes);
    try allocationFailures(bytes, maximum.id);
}

// Concrete reservation observer for the independent remaining-byte controls.
// Prefix/input storage is allowed; resize/remap cannot hide a large reservation.
const Limited = struct {
    blocked: usize = 0,
    largest: usize = 0,
    live: usize = 0,
    fn allocator(self: *Limited) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(ctx: *anyopaque, size: usize, alignment: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.largest = @max(self.largest, size);
        if (size > 8192) {
            self.blocked += 1;
            return null;
        }
        const memory = a.rawAlloc(size, alignment, ra) orelse return null;
        self.live += size;
        return memory;
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool {
        return false;
    }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 {
        return null;
    }
    fn free(ctx: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ra: usize) void {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.live -= memory.len;
        a.rawFree(memory, alignment, ra);
    }
};
test "function and unit reservations follow real encoded remaining bounds" {
    const cases = try std.json.parseFromSlice(Cold, a, @embedFile("testdata/string-packet-negative-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    for (cases.value.negatives[24..28]) |case| {
        const bytes = try decodedBytes(case.packetHex, case.packetBytes, case.packetSHA256);
        defer a.free(bytes);
        var limited: Limited = .{};
        switch (s.load(limited.allocator(), bytes)) {
            .loaded => |handle| {
                s.unload(handle);
                return error.UnexpectedAdmission;
            },
            .rejected => |failure| {
                try std.testing.expect(!std.mem.eql(u8, failure.code, "r04-string-allocation"));
                try std.testing.expectEqual(@as(usize, 0), limited.blocked);
                try std.testing.expectEqual(@as(usize, 0), limited.live);
                std.debug.print("String remaining {s}: {s} at{d}, largest reservation{d}, blocked0/live0\n", .{ case.id, failure.code, failure.offset, limited.largest });
            },
        }
    }
}

test "inspect and serialize OOM leave the live immutable handle unchanged" {
    const inputs = try std.json.parseFromSlice(Input, a, @embedFile("testdata/string-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    const input = inputs.value.packets[0];
    const bytes = try decodedBytes(input.hex, input.bytes, input.sha256);
    defer a.free(bytes);
    const handle = try accepted(bytes);
    defer s.unload(handle);
    const original = try s.inspect(handle, a);
    defer a.free(original);
    inline for (.{ s.inspect, s.serialize }) |operation| {
        var reached = false;
        var failures: usize = 0;
        for (0..128) |index| {
            var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
            failing.resize_fail_index = 0;
            if (operation(handle, failing.allocator())) |result| {
                failing.allocator().free(result);
                reached = true;
            } else |err| {
                try std.testing.expectEqual(error.OutOfMemory, err);
                failures += 1;
            }
            try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            if (reached) break;
        }
        try std.testing.expect(reached and failures > 0);
        std.debug.print("String view actual OOM points{d}, then success\n", .{failures});
    }
    const after = try s.inspect(handle, a);
    defer a.free(after);
    try std.testing.expectEqualStrings(original, after);
    try copiedExactly(handle, bytes);
}
