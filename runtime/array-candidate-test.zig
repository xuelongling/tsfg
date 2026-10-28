// SPDX-License-Identifier: MIT
// Complete independent Root-accepted full57 fixtures, copied byte-for-byte.
// First-pair causal tests keep their separately frozen source/timing; this suite
// consumes the later full-group layout without changing those original tests.
const std = @import("std");
const bytecode = @import("bytecode.zig");
const s = bytecode.arrayCandidate;
const comparison = @import("array-candidate-test-support.zig");
const a = std.testing.allocator;
const Case = struct { name: []const u8, packet: struct { bytes: usize, sha256: []const u8 }, decoded: std.json.Value };
const Input = struct { cases: []const Case };
const Batch = struct { oracle: []const u8, packets: []const []const u8 };
const batches = [_]Batch{
    .{ .oracle = @embedFile("testdata/array-packet-v3-whole/return-core13-packet-v3-whole-oracle.json"), .packets = &.{
        @embedFile("testdata/array-packet-v3-whole/return20-01-26d-bound-const-alias.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-02-26d-tail-discard-and-unused-bound.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-03-26d-view-parameter-same-family.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-04-26d-callee-modify-before-create.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-05-26d-reachable-forty-root-call-results.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-06-26d-after.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-07-26d-global1024.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-08-26d-fresh-disjoint-structural-comparison.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-09-26d-mixed-slots-repeated-owner-then-view-helper.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-10-26d-two-forwarders-bound-then-tail.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-11-26c-const-alias-return.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-12-26c-tail-forward-return.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-13-26c-bound-forward-return.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-14-26c-discarded-return-call.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-15-26c-mixed-original-slots.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-16-26c-same-owner-distinct-family-after.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-17-26c-events100.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-18-26c-familyuses50.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-19-26c-after.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/return20-20-26c-return-global-1024.packet-v3.bin"),
    } },
    .{ .oracle = @embedFile("testdata/array-packet-v3-whole/old30-core13-packet-v3-whole-oracle.json"), .packets = &.{
        @embedFile("testdata/array-packet-v3-whole/old-main17-21-after.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-22-required-checked-read.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-23-formal-alias-length.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-24-statement-return-forward-dag.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-25-mixed-full-slots.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-26-same-family-two-view-arguments.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-27-read-then-mutate-distinct-fresh-call.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-28-zero-length-retained-checks.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-29-two-slots-alias-and-independent-fresh.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-30-parameter-alias-permanent-unknown.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-31-spin-wide-local-upper.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-32-core-isolated-view-gate.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-33-known-overwrite-equal-resize.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-34-rhs-last-use-append.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-35-full-u32-endpoint-checks.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-36-length-before-original-final-view-read.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-main17-37-length-is-last-view-use-after-known-overwrite.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-38-full-fresh-aliases.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-39-empty-checked-read.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-40-length-equal-checked-read.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-41-far-oob-checked-read.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-42-dense-overwrite.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-43-dynamic-owner-aliases.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-44-empty-append-rhs-shrink.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-45-uncertain-dense-length.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-46-quiet-array-structural-false.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-legacy10-47-view-read-covered.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-additional3-48-actual-source-scalar-ordinary-call.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-additional3-49-owned-facts-scalar-alias-ordinary-call.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-additional3-50-actual-source-work1024.packet-v3.bin"),
    } },
    .{ .oracle = @embedFile("testdata/array-packet-v3-whole/node7-core13-packet-v3-whole-oracle.json"), .packets = &.{
        @embedFile("testdata/array-packet-v3-whole/old-node7-51-two-level-private-local-and-stable-publication.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-52-two-level-private-local-narrow.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-53-core-call-only-refusal.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-54-core-new-return-only-refusal.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-55-work-lower.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-56-work-upper.packet-v3.bin"),
        @embedFile("testdata/array-packet-v3-whole/old-node7-57-shared-readspan-rr.packet-v3.bin"),
    } },
};
fn parsed(batch: Batch) !std.json.Parsed(Input) {
    const input = try std.json.parseFromSlice(Input, a, batch.oracle, .{ .ignore_unknown_fields = true });
    errdefer input.deinit();
    try std.testing.expectEqual(batch.packets.len, input.value.cases.len);
    return input;
}
fn checked(c: Case, bytes: []const u8) !void {
    try std.testing.expectEqual(c.packet.bytes, bytes.len);
    try comparison.hashEqual(c.packet.sha256, bytes);
}
fn accepted(allocator: std.mem.Allocator, bytes: []const u8) !*s.ValidatedArrayCandidate {
    return switch (s.load(allocator, bytes)) {
        .loaded => |handle| handle,
        .rejected => |failure| {
            std.debug.print("Array v3 whole rejection {s} at{d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}
fn exact(handle: *const s.ValidatedArrayCandidate, bytes: []const u8, expected: std.json.Value) !void {
    const actual = try s.inspect(handle, a);
    defer a.free(actual);
    try comparison.equal(expected, actual);
    const copy = try s.serialize(handle, a);
    defer a.free(copy);
    try std.testing.expectEqualSlices(u8, bytes, copy);
}
fn wholeGroup(index: usize, count: usize) !void {
    const batch = batches[index];
    const input = try parsed(batch);
    defer input.deinit();
    try std.testing.expectEqual(count, input.value.cases.len);
    for (input.value.cases, batch.packets) |c, bytes| {
        try checked(c, bytes);
        const handle = try accepted(a, bytes);
        defer s.unload(handle);
        try exact(handle, bytes, c.decoded);
        std.debug.print("Array v3 whole {s}: {d} bytes complete DTO/JCS and exact serialization\n", .{ c.name, bytes.len });
    }
}
test "all20 complete accepted return modules match independent whole DTO/JCS and bytes" {
    try wholeGroup(0, 20);
}
test "all30 original complete old-domain modules match independent current whole DTO/JCS and bytes" {
    try wholeGroup(1, 30);
}
test "all7 original Node configurations match independent current whole DTO/JCS and bytes" {
    try wholeGroup(2, 7);
}
test "all57 owned immutable ArrayCandidates isolate caller bytes and independent handle lifetime" {
    try std.testing.expect(s.ValidatedArrayCandidate != bytecode.VerifiedModule);
    var count: usize = 0;
    for (batches) |batch| {
        const input = try parsed(batch);
        defer input.deinit();
        for (input.value.cases, batch.packets) |c, original| {
            try checked(c, original);
            const bytes = try a.dupe(u8, original);
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
            try std.testing.expectEqualSlices(u8, original, stored);
            try std.testing.expect(s.snapshot(first).payload.functions.len > 0);
            try std.testing.expect(@typeInfo(@TypeOf(s.snapshot(first).payload.functions)).pointer.is_const);
            try std.testing.expect(@typeInfo(@TypeOf(s.snapshot(first).payload.functions[0].instructions)).pointer.is_const);
            count += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 57), count);
}
fn loadFailures(bytes: []const u8, name: []const u8) !void {
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
    std.debug.print("Array v3 load OOM {s}: {d} actual backend allocation points, zero residue then success\n", .{ name, failures });
}
fn observeFailures(handle: *const s.ValidatedArrayCandidate, name: []const u8) !void {
    inline for (.{ s.inspect, s.serialize }, .{ "inspect", "serialize" }) |operation, kind| {
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
        std.debug.print("Array v3 {s} OOM {s}: {d} actual backend allocation points, zero residue then success\n", .{ kind, name, failures });
    }
}
test "all57 actual load inspect serialize OOM points clean up and preserve complete models" {
    var count: usize = 0;
    for (batches) |batch| {
        const input = try parsed(batch);
        defer input.deinit();
        for (input.value.cases, batch.packets) |c, bytes| {
            try checked(c, bytes);
            try loadFailures(bytes, c.name);
            const handle = try accepted(a, bytes);
            defer s.unload(handle);
            try observeFailures(handle, c.name);
            try exact(handle, bytes, c.decoded);
            count += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 57), count);
}
