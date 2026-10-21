// SPDX-License-Identifier: MIT
// Independent v2 packet mutations retain full models and repaired deep framing.
// Test gold is authored separately; neither reader nor producer generates it.
const std = @import("std");
const s = @import("bytecode.zig").arrayCandidate;
const a = std.testing.allocator;
const comparison = @import("array-candidate-test-support.zig");
const Case = struct {
    name: []const u8,
    expected: []const u8,
    expectedRejectionClass: ?[]const u8 = null,
    packetBytes: usize,
    packetSHA256: []const u8,
    packetHex: []const u8,
    expectedDecoded: ?std.json.Value = null,
    expectedDecodedCanonicalSHA256: ?[]const u8 = null,
    causality: struct {
        cursor: ?usize = null,
        count: ?usize = null,
        minimumEncodedRecordBytes: ?usize = null,
        remainingBytes: ?usize = null,
    },
};
const Cases = struct { cases: []const Case };
fn input(c: Case) ![]u8 {
    const bytes = try a.alloc(u8, c.packetBytes);
    errdefer a.free(bytes);
    try std.testing.expectEqual(bytes.len, (try std.fmt.hexToBytes(bytes, c.packetHex)).len);
    try comparison.hashEqual(c.packetSHA256, bytes);
    return bytes;
}
fn fullPositive(handle: *const s.ValidatedArrayCandidate, bytes: []const u8, c: Case) !void {
    const observed = try s.inspect(handle, a);
    defer a.free(observed);
    try comparison.equal(c.expectedDecoded.?, observed);
    const parsed = try std.json.parseFromSlice(std.json.Value, a, observed, .{});
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const canonical = try std.json.Stringify.valueAlloc(arena.allocator(), try comparison.ordered(arena.allocator(), parsed.value), .{});
    try comparison.hashEqual(c.expectedDecodedCanonicalSHA256.?, canonical);
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
fn cold(c: Case) !void {
    const bytes = try input(c);
    defer a.free(bytes);
    var tracked = std.testing.FailingAllocator.init(a, .{ .fail_index = std.math.maxInt(usize) });
    switch (s.load(tracked.allocator(), bytes)) {
        .loaded => |handle| {
            defer s.unload(handle);
            try std.testing.expectEqualStrings("accept", c.expected);
            try fullPositive(handle, bytes, c);
            std.debug.print("Array v2 cold {s}: accepted complete DTO and exact bytes\n", .{c.name});
        },
        .rejected => |failure| {
            std.debug.print("Array v2 cold {s}: {s} at{d}\n", .{ c.name, failure.code, failure.offset });
            try std.testing.expectEqualStrings("reject", c.expected);
            try std.testing.expect(!std.mem.eql(u8, failure.code, "r04-array-allocation"));
            // Independent intent is not an exact SUT code; retain the observed phase.
            std.debug.print("Independent intent {s}\n", .{c.expectedRejectionClass orelse "unknown"});
        },
    }
    try std.testing.expectEqual(tracked.allocated_bytes, tracked.freed_bytes);
}
test "all independent v2 deep cold controls match complete outcomes without leaks" {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-v2-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    try std.testing.expectEqual(@as(usize, 115), cases.value.cases.len);
    var failures: usize = 0;
    for (cases.value.cases) |c| cold(c) catch |err| {
        failures += 1;
        std.debug.print("Case failed {s}: {s}\n", .{ c.name, @errorName(err) });
    };
    try std.testing.expectEqual(@as(usize, 0), failures);
}
// The observer measures individual backend reservations, not aggregate memory.
// Arena suballocation rejection is independently located by cursor and remaining/min.
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
test "all18 independent remaining roles reject before target reservation" {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-v2-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    const roles = [_][]const u8{ "remaining-source-table", "remaining-type-table", "remaining-intrinsic-parameters", "remaining-function-id-table", "remaining-export-table", "remaining-parameter-table", "remaining-instruction-table", "remaining-operand-table", "remaining-root-array-registers", "remaining-call-root-points", "remaining-utf8-source-path", "remaining-view-lifetime-table", "remaining-call-arguments", "remaining-complete-function-table-count16", "remaining-utf8-function-name", "remaining-publication-contracts", "remaining-root-view-registers", "remaining-publication-upper-parameters" };
    var covered: [18]bool = @splat(false);
    var seen: usize = 0;
    for (cases.value.cases) |c| {
        if (!std.mem.startsWith(u8, c.name, "remaining-")) continue;
        var role: ?usize = null;
        for (roles, 0..) |name, i| if (std.mem.eql(u8, c.name, name)) {
            role = i;
        };
        try std.testing.expect(role != null and !covered[role.?]);
        covered[role.?] = true;
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
                // A stronger enclosing record guard may reject earlier; gold pins
                // semantic intent, not a specific parser branch or diagnostic.
                try std.testing.expect(failure.offset <= target.cursor.?);
                const expected = if (std.mem.startsWith(u8, c.name, "remaining-utf8")) "r04-array-truncated" else "r04-array-limit";
                try std.testing.expectEqualStrings(expected, failure.code);
                try std.testing.expectEqual(@as(usize, 0), limited.blocked);
                try std.testing.expectEqual(@as(usize, 0), limited.live);
                std.debug.print("Array v2 remaining {s}: {s} at{d}, largest{d}/cutoff{d}, blocked0/live0\n", .{ c.name, failure.code, failure.offset, limited.largest, limited.cutoff });
            },
        }
        seen += 1;
    }
    try std.testing.expectEqual(@as(usize, 18), seen);
    for (covered) |found| try std.testing.expect(found);
}
fn budgetCase(cases: []const Case) !Case {
    for (cases) |c| if (std.mem.eql(u8, c.name, "literal256-and-package4096-exact-budget")) return c;
    return error.MissingIndependentBoundary;
}
test "actual 4096-element load inspect and serialize allocation failures clean up and preserve model" {
    const cases = try std.json.parseFromSlice(Cases, a, @embedFile("testdata/array-packet-v2-cold-oracle.json"), .{ .ignore_unknown_fields = true });
    defer cases.deinit();
    const c = try budgetCase(cases.value.cases);
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
    std.debug.print("Array v2 4096 actual load OOM points{d}, all cleaned then success\n", .{failures});
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
        std.debug.print("Array v2 4096 actual observation OOM points{d}, all cleaned then success\n", .{failures});
    }
    try fullPositive(handle, bytes, c);
}
