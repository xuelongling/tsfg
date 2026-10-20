// SPDX-License-Identifier: MIT
// Every failure is injected into the actual allocator used by the actual ManagedHeap.
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const Operation = enum { create, append, collect };

fn verify(heap: *Heap, handle: Handle, expected: []const f64) !void {
    try equal(@as(u32, @intCast(expected.len)), try heap.arrayF64Length(handle));
    for (expected, 0..) |value, index| try equal(value, try heap.readArrayF64(handle, @intCast(index)));
}

fn attempt(heap: *Heap, operation: Operation, input: []const f64, handle: Handle) !?Handle {
    return switch (operation) {
        .create => try heap.createArrayF64(input, .persistent),
        .append => blk: {
            try heap.storeArrayF64(handle, 2, 9.5);
            break :blk null;
        },
        .collect => blk: {
            try heap.collect();
            break :blk null;
        },
    };
}

fn allocationFailures(operation: Operation, padding: usize) !usize {
    var success = false;
    var failures: usize = 0;
    for (0..64) |fail_offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var heap = Heap.init(failing.allocator());
        var live = true;
        defer if (live) heap.deinit() catch unreachable;
        const scope = try heap.beginScope();
        const array = try heap.createArrayF64(&[_]f64{ 1.5, 2.5 }, .persistent);
        const alias = try heap.retain(array, .temporary);
        const string = try heap.createString(&[_]u16{ 0x0041, 0xD800 }, .persistent);
        const holder = try heap.create(9, 42, 2, .persistent);
        try heap.setEdge(holder, 0, array);
        try heap.setEdge(holder, 1, string);
        var padding_roots: [16]Handle = undefined;
        for (padding_roots[0..padding]) |*root| root.* = try heap.createArrayF64(&[_]f64{7.5}, .persistent);
        // Force the next new root through the real table growth boundary.
        var extra: [64]Handle = undefined;
        var extra_count: usize = 0;
        while (true) {
            const stats = try managed.testing.rootStats(&heap);
            if (stats.count == stats.capacity) break;
            try expect(extra_count < extra.len);
            extra[extra_count] = try heap.retain(array, .persistent);
            extra_count += 1;
        }
        const array_location = try managed.testing.location(&heap, array);
        const string_location = try managed.testing.location(&heap, string);
        const holder_location = try managed.testing.location(&heap, holder);
        const objects = try heap.objectCount();
        const roots = (try managed.testing.rootStats(&heap)).count;
        const next_identity = heap.next_identity;
        var input = [_]f64{ -0.0, 4.5, 5.5 };
        const original = input;
        failing.fail_index = failing.alloc_index + fail_offset;
        failing.resize_fail_index = failing.resize_index;
        var failed = false;
        const result = attempt(&heap, operation, &input, array) catch |err| blk: {
            try expect(err == error.OutOfMemory);
            failed = true;
            failures += 1;
            break :blk null;
        };
        failing.fail_index = std.math.maxInt(usize);
        failing.resize_fail_index = std.math.maxInt(usize);
        try expect(std.mem.eql(f64, &original, &input));
        if (failed) {
            try equal(objects, try heap.objectCount());
            try equal(roots, (try managed.testing.rootStats(&heap)).count);
            try equal(next_identity, heap.next_identity);
            try equal(array_location, try managed.testing.location(&heap, array));
            try equal(string_location, try managed.testing.location(&heap, string));
            try equal(holder_location, try managed.testing.location(&heap, holder));
        } else success = true;
        const expected: []const f64 = if (!failed and operation == .append) &[_]f64{ 1.5, 2.5, 9.5 } else &[_]f64{ 1.5, 2.5 };
        try verify(&heap, array, expected);
        try verify(&heap, alias, expected);
        try equal(@as(u16, 0xD800), try heap.readStringCodeUnit(string, 1));
        try equal(@as(u64, 42), (try heap.read(holder, 9)).scalar);
        try equal(try managed.testing.location(&heap, array), (try managed.testing.edgeLocation(&heap, holder, 0)).?);
        try equal(try managed.testing.location(&heap, string), (try managed.testing.edgeLocation(&heap, holder, 1)).?);
        for (padding_roots[0..padding]) |root| try verify(&heap, root, &[_]f64{7.5});
        for (extra[0..extra_count]) |root| try verify(&heap, root, expected);
        if (result) |handle| {
            try verify(&heap, handle, &original);
            try expect(!try heap.sameObject(array, handle));
            try heap.release(handle);
        }
        // All failed paths leave the old heap usable for a later mutation and move.
        try heap.storeArrayF64(array, 0, 6.5);
        try equal(@as(f64, 6.5), try heap.readArrayF64(alias, 0));
        try heap.collect();
        try equal(@as(f64, 6.5), try heap.readArrayF64(alias, 0));
        try equal(@as(u16, 0xD800), try heap.readStringCodeUnit(string, 1));
        try heap.endScope(scope);
        try std.testing.expectError(error.InvalidHandle, heap.arrayF64Length(alias));
        try heap.deinit();
        live = false;
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (success) break;
    }
    try expect(success);
    try expect(failures > 0);
    std.debug.print("Array transaction {s} padding {d}: {d} injected OOM points, success reached\n", .{ @tagName(operation), padding, failures });
    return failures;
}

test "Array create allocation failures preserve all existing roots and payloads" {
    var object_growth = false;
    // std.ArrayList(*Object) starts above the former0..8 padding range on this target.
    // Match the existing String fixture range so the real object table also grows.
    for (0..17) |padding| {
        if (try allocationFailures(.create, padding) > 3) object_growth = true;
    }
    try expect(object_growth);
}

test "Array append backing growth OOM is transactional" {
    _ = try allocationFailures(.append, 0);
}

test "moving collection OOM preserves mixed Array String scalar graph" {
    _ = try allocationFailures(.collect, 0);
}
