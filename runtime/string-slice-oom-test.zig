// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const equal = std.testing.expectEqual;
const expect = std.testing.expect;

fn verify(heap: *Heap, handle: Handle, units: []const u16, bytes: []const u8) !void {
    try equal(units.len, try heap.stringLength(handle));
    var out: [16]u8 = undefined;
    const length = try heap.copyStringBytes(handle, &out);
    try std.testing.expectEqualSlices(u8, bytes, out[0..length]);
    for (units, 0..) |unit, index| try equal(unit, try heap.readStringCodeUnit(handle, index));
}

fn failuresAtPadding(padding: usize) !usize {
    var reached_success = false;
    var failures: usize = 0;
    for (0..64) |fail_offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var heap = Heap.init(failing.allocator());
        var live = true;
        defer if (live) heap.deinit() catch unreachable;
        const scope = try heap.beginScope();
        const left = try heap.createString(&.{ 65, 0xD800 }, .persistent);
        const right = try heap.createString(&.{ 0xDC00, 0 }, .persistent);
        const alias = try heap.retain(left, .temporary);
        const array = try heap.createArrayF64(&.{ -0.0, 2.5 }, .persistent);
        const holder = try heap.create(9, 42, 3, .persistent);
        try heap.setEdge(holder, 0, left);
        try heap.setEdge(holder, 1, right);
        try heap.setEdge(holder, 2, array);
        var padding_roots: [16]Handle = undefined;
        for (padding_roots[0..padding]) |*root| root.* = try heap.createString(&.{90}, .persistent);
        // Existing test-only metrics place the fault at the actual root-table edge.
        // Logical preservation is observed through supported handles and values.
        var extras: [64]Handle = undefined;
        var extra_count: usize = 0;
        while (true) {
            const stats = try managed.testing.rootStats(&heap);
            if (stats.count == stats.capacity) break;
            try expect(extra_count < extras.len);
            extras[extra_count] = try heap.retain(left, .persistent);
            extra_count += 1;
        }
        const objects = try heap.objectCount();
        const roots = (try managed.testing.rootStats(&heap)).count;
        const next_identity = heap.next_identity;
        failing.fail_index = failing.alloc_index + fail_offset;
        failing.resize_fail_index = failing.resize_index;
        const allocations = failing.alloc_index;
        try equal(std.math.Order.eq, try heap.compareStrings(alias, left));
        try equal(allocations, failing.alloc_index);
        var failed = false;
        const joined: ?Handle = heap.sliceString(alias, 1, 2, .persistent) catch |err| blk: {
            try expect(err == error.OutOfMemory);
            failures += 1;
            failed = true;
            break :blk null;
        };
        failing.fail_index = std.math.maxInt(usize);
        failing.resize_fail_index = std.math.maxInt(usize);
        if (failed) {
            try equal(objects, try heap.objectCount());
            try equal(roots, (try managed.testing.rootStats(&heap)).count);
            try equal(next_identity, heap.next_identity);
        } else reached_success = true;
        try verify(&heap, left, &.{ 65, 0xD800 }, &.{ 65, 0xED, 0xA0, 0x80 });
        try verify(&heap, alias, &.{ 65, 0xD800 }, &.{ 65, 0xED, 0xA0, 0x80 });
        try verify(&heap, right, &.{ 0xDC00, 0 }, &.{ 0xED, 0xB0, 0x80, 0 });
        for (extras[0..extra_count]) |root| try verify(&heap, root, &.{ 65, 0xD800 }, &.{ 65, 0xED, 0xA0, 0x80 });
        for (padding_roots[0..padding]) |root| try verify(&heap, root, &.{90}, &.{90});
        try equal(@as(u64, 0x8000000000000000), @as(u64, @bitCast(try heap.readArrayF64(array, 0))));
        try equal(@as(f64, 2.5), try heap.readArrayF64(array, 1));
        try equal(@as(u64, 42), (try heap.read(holder, 9)).scalar);
        for ([_]Handle{ left, right, array }, 0..) |expected, index| {
            const via_edge = (try heap.retainEdge(holder, index, .temporary)).?;
            try expect(try heap.sameObject(expected, via_edge));
            try heap.release(via_edge);
        }
        if (joined) |handle| {
            try verify(&heap, handle, &.{0xD800}, &.{ 0xED, 0xA0, 0x80 });
            try expect(!try heap.sameObject(left, handle));
            try expect(!try heap.sameObject(right, handle));
            try heap.release(handle);
        }
        // An OOM leaves the same actual heap able to create and move a later result.
        const later = try heap.sliceString(left, 1, 2, .persistent);
        try heap.collect();
        try verify(&heap, later, &.{0xD800}, &.{ 0xED, 0xA0, 0x80 });
        try verify(&heap, alias, &.{ 65, 0xD800 }, &.{ 65, 0xED, 0xA0, 0x80 });
        try equal(@as(f64, 2.5), try heap.readArrayF64(array, 1));
        try heap.endScope(scope);
        try std.testing.expectError(error.InvalidHandle, heap.stringLength(alias));
        try heap.deinit();
        live = false;
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (reached_success) break;
    }
    try expect(reached_success);
    try expect(failures > 0);
    std.debug.print("slice padding {d}: {d} injected OOM points, success reached\n", .{ padding, failures });
    return failures;
}

test "every actual slice allocation failure preserves mixed roots values and heap usability" {
    var object_growth = false;
    // The existing real String/Array fixture range spans actual object-table growth.
    for (0..17) |padding| {
        if (try failuresAtPadding(padding) > 3) object_growth = true;
    }
    try expect(object_growth);
}
