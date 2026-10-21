// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const Operation = enum { create, append, overwrite, read, collect };
const layout: managed.ArrayLayout = .{ .type_id = .{8} ** 32, .byte_size = 8, .alignment = 8, .reference_count = 1, .variants = &.{ .{ .tag = 0, .fields = &.{.{ .offset = 0, .code = 13 }}, .references = &.{.{ .slot = 0, .type = .{ .object = 77 } }} }, .{ .tag = 1, .kind = .undefined_value } } };
const initial = [_]u8{ 0, 0, 0, 0, 0, 0, 0xF0, 0x3F };
const replacement = [_]u8{ 0, 0, 0, 0, 0, 0, 0, 0x40 };
fn verify(heap: *Heap, array: managed.Handle, child: managed.Handle, length: u32, changed: bool) !void {
    try equal(length, try heap.typedArrayLength(array, layout));
    const scope = try heap.beginScope();
    defer heap.endScope(scope) catch unreachable;
    var value = try heap.readTypedArray(array, layout, 0, .temporary);
    defer value.deinit(heap.allocator);
    try std.testing.expectEqualSlices(u8, if (changed) &replacement else &initial, value.bytes);
    try expect(try heap.sameObject(child, value.references[0].?));
    if (length == 2) {
        var tail = try heap.readTypedArray(array, layout, 1, .temporary);
        defer tail.deinit(heap.allocator);
        try equal(@as(u16, 1), tail.tag);
        try expect(tail.references[0] == null);
    }
}
fn failures(operation: Operation) !void {
    var failure_count: usize = 0;
    for (0..256) |offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var heap = Heap.init(failing.allocator());
        var live = true;
        defer if (live) heap.deinit() catch unreachable;
        const child = try heap.create(77, 42, 0, .persistent);
        const array = try heap.createTypedArray(layout, &.{.{ .bytes = &initial, .references = &.{child} }}, .persistent);
        const alias = try heap.retain(array, .persistent);
        const scope = try heap.beginScope();
        // Force reads/create to encounter real root table allocation, including
        // after value copies have been allocated but before any root is published.
        while (true) {
            const stats = try managed.testing.rootStats(&heap);
            if (stats.count == stats.capacity) break;
            _ = try heap.retain(array, .temporary);
        }
        const count = try heap.objectCount();
        const root_count = (try managed.testing.rootStats(&heap)).count;
        const identity = heap.next_identity;
        const location = try managed.testing.location(&heap, array);
        failing.fail_index = failing.alloc_index + offset;
        failing.resize_fail_index = failing.resize_index;
        const attempt: ?managed.Error = blk: {
            switch (operation) {
                .create => {
                    const result = heap.createTypedArray(layout, &.{.{ .bytes = &replacement, .references = &.{child} }}, .persistent) catch |err| break :blk err;
                    heap.release(result) catch unreachable;
                },
                .append => heap.storeTypedArray(array, layout, 1, .{ .tag = 1, .bytes = &replacement, .references = &.{null} }) catch |err| break :blk err,
                .overwrite => heap.storeTypedArray(array, layout, 0, .{ .bytes = &replacement, .references = &.{child} }) catch |err| break :blk err,
                .read => {
                    var value = heap.readTypedArray(array, layout, 0, .temporary) catch |err| break :blk err;
                    value.deinit(heap.allocator);
                },
                .collect => heap.collect() catch |err| break :blk err,
            }
            break :blk null;
        };
        failing.fail_index = std.math.maxInt(usize);
        failing.resize_fail_index = std.math.maxInt(usize);
        if (attempt) |err| {
            try expect(err == error.OutOfMemory);
            failure_count += 1;
            try equal(count, try heap.objectCount());
            try equal(root_count, (try managed.testing.rootStats(&heap)).count);
            try equal(identity, heap.next_identity);
            try equal(location, try managed.testing.location(&heap, array));
        }
        const length: u32 = if (attempt == null and operation == .append) 2 else 1;
        const changed = attempt == null and operation == .overwrite;
        try verify(&heap, array, child, length, changed);
        try verify(&heap, alias, child, length, changed);
        try heap.collect();
        try verify(&heap, alias, child, length, changed);
        try heap.endScope(scope);
        try heap.deinit();
        live = false;
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (attempt == null) {
            try expect(failure_count > 0);
            std.debug.print("typed Array {s}: {d} real OOM points then success\n", .{ @tagName(operation), failure_count });
            return;
        }
    }
    return error.NoSuccessfulAttempt;
}
test "typed Array allocation failures are transactional across both planes and roots" {
    inline for (std.meta.tags(Operation)) |operation| try failures(operation);
}
