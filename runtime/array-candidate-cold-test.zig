// SPDX-License-Identifier: MIT
// Independent repaired packets are shared with the producer's Node test. This
// Runtime module-root copy is literal oracle data, never synthesized by the SUT.
const std = @import("std");
const s = @import("bytecode.zig").arrayCandidate;
const a = std.testing.allocator;
const Case = struct {
    name: []const u8,
    expected: []const u8,
    packetBytes: usize,
    packetSHA256: []const u8,
    packetHex: []const u8,
    expectedDecodedCanonicalSHA256: ?[]const u8 = null,
    causality: struct { cursor: ?usize = null, count: ?usize = null, minimumEncodedRecordBytes: ?usize = null, remainingBytes: ?usize = null },
};
const Cases = struct { cases: []const Case };
fn input(c: Case) ![]u8 {
    const bytes = try a.alloc(u8, c.packetBytes);
    errdefer a.free(bytes);
    _ = try std.fmt.hexToBytes(bytes, c.packetHex);
    try hashEqual(c.packetSHA256, bytes);
    return bytes;
}
fn hashEqual(expected: []const u8, bytes: []const u8) !void {
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    try std.testing.expectEqualStrings(expected, &std.fmt.bytesToHex(digest, .lower));
}
fn less(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}
// Test DTO keys are ASCII and values are bounded integers/UTF8 strings/raw-bit
// strings. Sorting observations checks the independent whole digest, not decode.
fn ordered(allocator: std.mem.Allocator, value: std.json.Value) std.mem.Allocator.Error!std.json.Value {
    return switch (value) {
        .object => |object| blk: {
            const keys = try allocator.alloc([]const u8, object.count());
            var iterator = object.iterator();
            var i: usize = 0;
            while (iterator.next()) |entry| : (i += 1) keys[i] = entry.key_ptr.*;
            std.mem.sort([]const u8, keys, {}, less);
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
fn fullPositive(handle: *const s.ValidatedArrayCandidate, bytes: []const u8, expected: []const u8) !void {
    const text = try s.inspect(handle, a);
    defer a.free(text);
    const parsed = try std.json.parseFromSlice(std.json.Value, a, text, .{});
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const canonical = try std.json.Stringify.valueAlloc(arena.allocator(), try ordered(arena.allocator(), parsed.value), .{});
    try hashEqual(expected, canonical);
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
fn cold(index: usize) !void {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    try std.testing.expectEqual(@as(usize, 72), cases.value.cases.len);
    const c = cases.value.cases[index];
    const bytes = try input(c);
    defer a.free(bytes);
    var tracked = std.testing.FailingAllocator.init(a, .{ .fail_index = std.math.maxInt(usize) });
    switch (s.load(tracked.allocator(), bytes)) {
        .loaded => |handle| {
            defer s.unload(handle);
            try std.testing.expectEqualStrings("accept", c.expected);
            try fullPositive(handle, bytes, c.expectedDecodedCanonicalSHA256.?);
        },
        .rejected => |failure| {
            std.debug.print("Array cold {s}: {s} at{d}\n", .{ c.name, failure.code, failure.offset });
            try std.testing.expectEqualStrings("reject", c.expected);
            try std.testing.expect(!std.mem.eql(u8, failure.code, "r04-array-allocation"));
        },
    }
    try std.testing.expectEqual(tracked.allocated_bytes, tracked.freed_bytes);
}
// External allocator reservation observer: values are individual backend request
// lengths, not aggregate live+request. Small arena suballocations are additionally
// checked by the exact target cursor/error and the production division guard.
const Limited = struct {
    cutoff: usize,
    blocked: usize = 0,
    largest: usize = 0,
    live: usize = 0,
    fn allocator(self: *Limited) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(ctx: *anyopaque, n: usize, alignment: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.largest = @max(self.largest, n);
        if (n > self.cutoff) {
            self.blocked += 1;
            return null;
        }
        const memory = a.rawAlloc(n, alignment, ra) orelse return null;
        self.live += n;
        return memory;
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool {
        return false;
    }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 {
        return null;
    }
    fn free(ctx: *anyopaque, bytes: []u8, alignment: std.mem.Alignment, ra: usize) void {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.live -= bytes.len;
        a.rawFree(bytes, alignment, ra);
    }
};
test "all fourteen independent counted remaining bounds reject at the exact preallocation cursor" {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    var seen: usize = 0;
    for (cases.value.cases) |c| {
        if (!std.mem.startsWith(u8, c.name, "remaining-")) continue;
        const bytes = try input(c);
        defer a.free(bytes);
        const target = c.causality;
        try std.testing.expectEqual(bytes.len - target.cursor.?, target.remainingBytes.?);
        try std.testing.expect(target.count.? > target.remainingBytes.? / target.minimumEncodedRecordBytes.?);
        var limited: Limited = .{ .cutoff = @max(65536, bytes.len * 8) };
        switch (s.load(limited.allocator(), bytes)) {
            .loaded => |handle| {
                s.unload(handle);
                return error.UnexpectedAdmission;
            },
            .rejected => |failure| {
                try std.testing.expectEqual(target.cursor.?, failure.offset);
                // Utf8 views allocate nothing; take() rejects their absent bytes.
                const expected = if (std.mem.startsWith(u8, c.name, "remaining-utf8")) "r04-array-truncated" else "r04-array-limit";
                try std.testing.expectEqualStrings(expected, failure.code);
                try std.testing.expectEqual(@as(usize, 0), limited.blocked);
                try std.testing.expectEqual(@as(usize, 0), limited.live);
                std.debug.print("Array remaining {s}: {s} at{d}, largest single reservation{d}/cutoff{d}, blocked0/live0\n", .{ c.name, failure.code, failure.offset, limited.largest, limited.cutoff });
            },
        }
        seen += 1;
    }
    try std.testing.expectEqual(@as(usize, 14), seen);
}
test "actual load and observation OOM points at the independent 4096-element boundary clean up" {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    const c = cases.value.cases[45];
    try std.testing.expectEqualStrings("literal256-and-package4096-exact-budget", c.name);
    const bytes = try input(c);
    defer a.free(bytes);
    var reached = false;
    var failures: usize = 0;
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
    std.debug.print("Array4096 actual load OOM points{d}, all cleaned then success\n", .{failures});
    const handle = switch (s.load(a, bytes)) {
        .loaded => |v| v,
        .rejected => return error.UnexpectedRejection,
    };
    defer s.unload(handle);
    inline for (.{ s.inspect, s.serialize }) |operation| {
        reached = false;
        failures = 0;
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
        std.debug.print("Array4096 actual observation OOM points{d}, all cleaned then success\n", .{failures});
    }
    try fullPositive(handle, bytes, c.expectedDecodedCanonicalSHA256.?);
}
test "cold bad-magic" {
    try cold(0);
}
test "cold bad-private-version" {
    try cold(1);
}
test "cold bad-protocol-schema" {
    try cold(2);
}
test "cold bad-total-length" {
    try cold(3);
}
test "cold bad-payload-hash" {
    try cold(4);
}
test "cold truncated-header" {
    try cold(5);
}
test "cold truncated-final-operand-repaired" {
    try cold(6);
}
test "cold trailing-byte-repaired" {
    try cold(7);
}
test "cold invalid-utf8-root-path" {
    try cold(8);
}
test "cold nul-function-name" {
    try cold(9);
}
test "cold empty-function-name" {
    try cold(10);
}
test "cold wrong-nominal-f64-origin" {
    try cold(11);
}
test "cold readonly-view-origin-zero" {
    try cold(12);
}
test "cold wrong-root-source-hash-row" {
    try cold(13);
}
test "cold source-table-wrong-order" {
    try cold(14);
}
test "cold wrong-function-identity" {
    try cold(15);
}
test "cold wrong-signature" {
    try cold(16);
}
test "cold wrong-function-id-order" {
    try cold(17);
}
test "cold parameter-writable-zero" {
    try cold(18);
}
test "cold parameter-binding-wrong" {
    try cold(19);
}
test "cold unknown-opcode" {
    try cold(20);
}
test "cold fuel-not-one" {
    try cold(21);
}
test "cold nondense-result-register" {
    try cold(22);
}
test "cold future-SSA-operand" {
    try cold(23);
}
test "cold wrong-readspan-result-type" {
    try cold(24);
}
test "cold wrong-allocation-site" {
    try cold(25);
}
test "cold missing-alias-SSA-call-root" {
    try cold(26);
}
test "cold call-roots-wrong-order" {
    try cold(27);
}
test "cold missing-call-root-point" {
    try cold(28);
}
test "cold wrong-view-owner" {
    try cold(29);
}
test "cold view-last-use-omits-real-read" {
    try cold(30);
}
test "cold missing-view-row" {
    try cold(31);
}
test "cold live-view-append-before-length" {
    try cold(32);
}
test "cold zero-length-does-not-erase-live-borrow" {
    try cold(33);
}
test "cold known-dense-gap-after-last-view-use" {
    try cold(34);
}
test "cold f64-zero-exact-bits" {
    try cold(35);
}
test "cold f64-negative-zero-exact-bits" {
    try cold(36);
}
test "cold f64-subnormal-exact-bits" {
    try cold(37);
}
test "cold nonfinite-f64-infinity" {
    try cold(38);
}
test "cold nonfinite-f64-nan" {
    try cold(39);
}
test "cold range-end65536-retained" {
    try cold(40);
}
test "cold opaque-identities-self-consistent-retained" {
    try cold(41);
}
test "cold full-u32-obligations-retained" {
    try cold(42);
}
test "cold append-after-actual-last-view-use-allowed" {
    try cold(43);
}
test "cold recursive-parameter-only-with-acyclic-allocating-entry-allowed" {
    try cold(44);
}
test "cold literal256-and-package4096-exact-budget" {
    try cold(45);
}
test "cold package4097-one-over-only" {
    try cold(46);
}
test "cold remaining-source-table-count2" {
    try cold(47);
}
test "cold remaining-type-table-count4" {
    try cold(48);
}
test "cold remaining-intrinsic-parameters-count3" {
    try cold(49);
}
test "cold remaining-function-id-table-count16" {
    try cold(50);
}
test "cold remaining-export-table-count2" {
    try cold(51);
}
test "cold remaining-parameter-table-count8" {
    try cold(52);
}
test "cold remaining-instruction-table-count4245" {
    try cold(53);
}
test "cold remaining-operand-table-count256" {
    try cold(54);
}
test "cold remaining-root-registers-count12" {
    try cold(55);
}
test "cold remaining-call-root-points-count32" {
    try cold(56);
}
test "cold remaining-utf8-source-path" {
    try cold(57);
}
test "cold remaining-utf8-function-name" {
    try cold(58);
}
test "cold remaining-complete-function-table-count16" {
    try cold(59);
}
test "cold remaining-view-table-count1" {
    try cold(60);
}
test "cold unicode-names-unsigned-utf8-sorted" {
    try cold(61);
}
test "cold unicode-exports-js-utf16-order-rejected" {
    try cold(62);
}
test "cold parameter-mayalias-remains-unknown-after-resize" {
    try cold(63);
}
test "cold parameter-view-and-independent-fresh-overwrite-allowed" {
    try cold(64);
}
test "cold active-view-crosses-ordinary-call" {
    try cold(65);
}
test "cold self-cycle-allocation-forbidden" {
    try cold(66);
}
test "cold cyclic-node-outgoing-allocation-forbidden" {
    try cold(67);
}
test "cold parameter-alias-unknown-checks-retained" {
    try cold(68);
}
test "cold literal257-rejected-with-u16-count" {
    try cold(69);
}
test "cold u32-index-excludes-ffffffff" {
    try cold(70);
}
test "cold source-end65537-rejected" {
    try cold(71);
}
