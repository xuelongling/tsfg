// SPDX-License-Identifier: MIT
// Original115 controls plus independent return/boundary controls. Never replace
// an old semantic control with a version-only refusal or infer gold from output.
const std = @import("std");
const s = @import("bytecode.zig").arrayCandidate;
const m = @import("array-candidate-model.zig");
const decode = @import("array-candidate-decode.zig");
const data = @import("array-candidate-cold-inputs.zig");
const comparison = @import("array-candidate-test-support.zig");
const a = std.testing.allocator;
const Packet = struct { bytes: usize, sha256: []const u8 };
const Causality = struct { cursor: ?usize = null, count: ?usize = null, minimumEncodedRecordBytes: ?usize = null, remainingBytes: ?usize = null };
const LegacyCase = struct { name: []const u8, expected: []const u8, expectedRejectionClass: ?[]const u8, packet: Packet, causality: Causality, existingFrozenExpected: ?struct { selector: []const u8 } = null };
const Positive = struct { name: []const u8, expect: []const u8, packet: Packet, decoded: std.json.Value, supersedes: ?struct { selector: []const u8 } = null };
const Negative = struct { name: []const u8, expect: []const u8, rule: []const u8, packet: Packet };
const Legacy = struct { cases: []const LegacyCase };
const Budget = struct { accepted: []const Positive, rejected: []const Negative };
const Corrections = struct { cases: []const Positive };
fn parsed(comptime T: type, bytes: []const u8) !std.json.Parsed(T) {
    return std.json.parseFromSlice(T, a, bytes, .{ .ignore_unknown_fields = true });
}
fn selected(budget: Budget, corrections: Corrections, index: usize) Positive {
    return switch (index) { 0 => corrections.cases[0], 1 => corrections.cases[1], 22 => corrections.cases[2], else => budget.accepted[index] };
}
fn checked(packet: Packet, bytes: []const u8) !void {
    try std.testing.expectEqual(packet.bytes, bytes.len);
    try comparison.hashEqual(packet.sha256, bytes);
}
fn exact(handle: *const s.ValidatedArrayCandidate, bytes: []const u8, expected: std.json.Value) !void {
    const actual = try s.inspect(handle, a);
    defer a.free(actual);
    try comparison.equal(expected, actual);
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
fn accepted(bytes: []const u8) !*s.ValidatedArrayCandidate {
    return switch (s.load(a, bytes)) {
        .loaded => |handle| handle,
        .rejected => |failure| {
            std.debug.print("Cold positive rejected {s} at{d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}
test "all115 original current deep controls retain full outcomes and zero allocation residue" {
    const legacy = try parsed(Legacy, data.legacy);
    defer legacy.deinit();
    const budget = try parsed(Budget, data.budget);
    defer budget.deinit();
    try std.testing.expectEqual(@as(usize, 115), legacy.value.cases.len);
    var failures: usize = 0;
    var accepted_count: usize = 0;
    for (legacy.value.cases, data.legacy_packets) |c, bytes| {
        try checked(c.packet, bytes);
        var tracked = std.testing.FailingAllocator.init(a, .{ .fail_index = std.math.maxInt(usize) });
        switch (s.load(tracked.allocator(), bytes)) {
            .loaded => |handle| {
                defer s.unload(handle);
                if (!std.mem.eql(u8, c.expected, "accept")) {
                    std.debug.print("Legacy unexpected admission {s}, intent {s}\n", .{ c.name, c.expectedRejectionClass orelse "none" });
                    failures += 1;
                } else {
                    const selector = c.existingFrozenExpected.?.selector;
                    try std.testing.expect(std.mem.startsWith(u8, selector, "accepted."));
                    const index = try std.fmt.parseInt(usize, selector[9..], 10);
                    try std.testing.expect(index >= 2 and index <= 21);
                    const original = budget.value.accepted[index];
                    try std.testing.expectEqualStrings(c.packet.sha256, original.packet.sha256);
                    try exact(handle, bytes, original.decoded);
                    accepted_count += 1;
                }
            },
            .rejected => |failure| {
                std.debug.print("Legacy cold {s}: {s} at{d}, intent {s}\n", .{ c.name, failure.code, failure.offset, c.expectedRejectionClass orelse "none" });
                try std.testing.expect(!std.mem.eql(u8, failure.code, "r04-array-allocation"));
                if (!std.mem.eql(u8, c.expected, "reject")) failures += 1;
            },
        }
        try std.testing.expectEqual(tracked.allocated_bytes, tracked.freed_bytes);
    }
    try std.testing.expectEqual(@as(usize, 20), accepted_count);
    try std.testing.expectEqual(@as(usize, 0), failures);
}
// Track the real decoder allocator *outside* its cleanup Arena. Tracking only
// Arena backend growth could miss a forbidden target-sized suballocation.
const AtCursor = struct {
    backing: std.mem.Allocator,
    reader: *m.Reader,
    cursor: usize,
    target_calls: usize = 0,
    prior_calls: usize = 0,
    fn allocator(self: *AtCursor) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(ctx: *anyopaque, n: usize, alignment: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *AtCursor = @ptrCast(@alignCast(ctx));
        if (self.reader.offset >= self.cursor) self.target_calls += 1 else self.prior_calls += 1;
        return self.backing.rawAlloc(n, alignment, ra);
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool { return false; }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 { return null; }
    fn free(ctx: *anyopaque, bytes: []u8, alignment: std.mem.Alignment, ra: usize) void {
        const self: *AtCursor = @ptrCast(@alignCast(ctx));
        self.backing.rawFree(bytes, alignment, ra);
    }
};
fn remainingOOM(bytes: []const u8, cursor: usize, expected: []const u8) !usize {
    var failures: usize = 0;
    for (0..512) |index| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
        failing.resize_fail_index = 0;
        var reached = false;
        switch (s.load(failing.allocator(), bytes)) {
            .loaded => |handle| { s.unload(handle); return error.UnexpectedAdmission; },
            .rejected => |failure| {
                if (std.mem.eql(u8, failure.code, "r04-array-allocation")) failures += 1 else {
                    try std.testing.expectEqualStrings(expected, failure.code);
                    try std.testing.expect(failure.offset <= cursor);
                    reached = true;
                }
            },
        }
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (reached) { try std.testing.expect(failures > 0); return failures; }
    }
    return error.OOMBoundaryNotReached;
}
test "all18 original remaining roles reject before actual target allocation with every opaque OOM cleaned" {
    const legacy = try parsed(Legacy, data.legacy);
    defer legacy.deinit();
    var count: usize = 0;
    for (legacy.value.cases, data.legacy_packets) |c, bytes| {
        if (!std.mem.startsWith(u8, c.name, "remaining-")) continue;
        const target = c.causality;
        try checked(c.packet, bytes);
        try std.testing.expectEqual(bytes.len - target.cursor.?, target.remainingBytes.?);
        try std.testing.expect(target.count.? > target.remainingBytes.? / target.minimumEncodedRecordBytes.?);
        var arena = std.heap.ArenaAllocator.init(a);
        defer arena.deinit();
        var reader: m.Reader = .{ .bytes = bytes };
        var tracker: AtCursor = .{ .backing = arena.allocator(), .reader = &reader, .cursor = target.cursor.? };
        try std.testing.expectError(error.Invalid, decode.parse(&reader, tracker.allocator()));
        const expected = if (std.mem.startsWith(u8, c.name, "remaining-utf8")) "r04-array-truncated" else "r04-array-limit";
        try std.testing.expectEqualStrings(expected, reader.failure.code);
        try std.testing.expect(reader.offset <= target.cursor.?);
        try std.testing.expectEqual(@as(usize, 0), tracker.target_calls);
        const oom = try remainingOOM(bytes, target.cursor.?, expected);
        std.debug.print("Remaining {s}: offset{d}<=cursor{d}, priorAlloc{d}/targetAlloc0, opaque OOM{d} zero residue\n", .{ c.name, reader.offset, target.cursor.?, tracker.prior_calls, oom });
        count += 1;
    }
    try std.testing.expectEqual(@as(usize, 18), count);
}
test "all3 source-valid repaired cold models select complete original rows and match full DTO/JCS and bytes" {
    const budget = try parsed(Budget, data.budget);
    defer budget.deinit();
    const corrections = try parsed(Corrections, data.repairs);
    defer corrections.deinit();
    try std.testing.expectEqual(@as(usize, 23), budget.value.accepted.len);
    try std.testing.expectEqual(@as(usize, 3), corrections.value.cases.len);
    try std.testing.expectEqualStrings("accepted.0", corrections.value.cases[0].supersedes.?.selector);
    try std.testing.expectEqualStrings("cases.0", corrections.value.cases[1].supersedes.?.selector);
    try std.testing.expectEqualStrings("cases.1", corrections.value.cases[2].supersedes.?.selector);
    for ([_]usize{ 0, 1, 22 }) |index| {
        const bytes = data.accepted_packets[index];
        const c = selected(budget.value, corrections.value, index);
        try std.testing.expectEqualStrings("accept", c.expect);
        try checked(c.packet, bytes);
        const handle = try accepted(bytes);
        defer s.unload(handle);
        try exact(handle, bytes, c.decoded);
        std.debug.print("Current cold accepted {s}: complete DTO/JCS and exact bytes\n", .{c.name});
    }
}
test "all23 new repaired current negative controls supplement the original95 without allocation residue" {
    const budget = try parsed(Budget, data.budget);
    defer budget.deinit();
    try std.testing.expectEqual(@as(usize, 23), budget.value.rejected.len);
    var failures: usize = 0;
    for (budget.value.rejected, data.rejected_packets) |c, bytes| {
        try checked(c.packet, bytes);
        try std.testing.expectEqualStrings("reject", c.expect);
        var tracked = std.testing.FailingAllocator.init(a, .{ .fail_index = std.math.maxInt(usize) });
        switch (s.load(tracked.allocator(), bytes)) {
            .loaded => |handle| { s.unload(handle); failures += 1; std.debug.print("New cold unexpected admission {s}\n", .{c.name}); },
            .rejected => |failure| {
                try std.testing.expect(!std.mem.eql(u8, failure.code, "r04-array-allocation"));
                std.debug.print("Current cold rejected {s}: {s} at{d}; intent {s}\n", .{ c.name, failure.code, failure.offset, c.rule });
            },
        }
        try std.testing.expectEqual(tracked.allocated_bytes, tracked.freed_bytes);
    }
    try std.testing.expectEqual(@as(usize, 0), failures);
}
fn boundaryOOM(bytes: []const u8, name: []const u8, expected: std.json.Value) !void {
    var reached = false;
    var load_failures: usize = 0;
    for (0..512) |index| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
        failing.resize_fail_index = 0;
        switch (s.load(failing.allocator(), bytes)) {
            .loaded => |handle| { s.unload(handle); reached = true; },
            .rejected => |failure| { try std.testing.expectEqualStrings("r04-array-allocation", failure.code); load_failures += 1; },
        }
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (reached) break;
    }
    try std.testing.expect(reached and load_failures > 0);
    const handle = try accepted(bytes);
    defer s.unload(handle);
    const before = try s.inspect(handle, a);
    defer a.free(before);
    std.debug.print("Boundary {s} load OOM{d} zero residue then success\n", .{ name, load_failures });
    inline for (.{ s.inspect, s.serialize }, .{ "inspect", "serialize" }) |operation, kind| {
        reached = false;
        var failures: usize = 0;
        for (0..128) |index| {
            var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
            failing.resize_fail_index = 0;
            if (operation(handle, failing.allocator())) |value| { failing.allocator().free(value); reached = true; } else |err| { try std.testing.expectEqual(error.OutOfMemory, err); failures += 1; }
            try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            if (reached) break;
        }
        try std.testing.expect(reached and failures > 0);
        std.debug.print("Boundary {s} {s} OOM{d} zero residue then success\n", .{ name, kind, failures });
    }
    const after = try s.inspect(handle, a);
    defer a.free(after);
    try std.testing.expectEqualStrings(before, after);
    try exact(handle, bytes, expected);
}
test "affected source-valid row57 family40 package4096 scalar260 View358 every OOM cleans up" {
    const budget = try parsed(Budget, data.budget);
    defer budget.deinit();
    const corrections = try parsed(Corrections, data.repairs);
    defer corrections.deinit();
    for ([_]usize{ 0, 1, 16, 20, 22 }) |index| {
        const c = selected(budget.value, corrections.value, index);
        const bytes = data.accepted_packets[index];
        try checked(c.packet, bytes);
        try boundaryOOM(bytes, c.name, c.decoded);
    }
}
