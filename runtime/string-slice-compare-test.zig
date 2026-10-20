// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const codec = @import("string-codec.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const expectError = std.testing.expectError;
const Slice = struct { name: []const u8, input: []const u16, start: usize, end: usize, units: []const u16, bytes: []const u8 };
const Comparison = struct { name: []const u8, left: []const u16, right: []const u16, order: i8 };
const Oracle = struct { family: []const u8, version: u8, source: []const u8, range: []const u8, slices: []const Slice, comparisons: []const Comparison };

fn unitsEqual(heap: *Heap, handle: Handle, units: []const u16) !void {
    try equal(units.len, try heap.stringLength(handle));
    for (units, 0..) |unit, index| try equal(unit, try heap.readStringCodeUnit(handle, index));
    try expectError(error.IndexOutOfBounds, heap.readStringCodeUnit(handle, units.len));
}

fn wholeEqual(heap: *Heap, handle: Handle, units: []const u16, bytes: []const u8) !void {
    try unitsEqual(heap, handle, units);
    try equal(bytes.len, try heap.stringByteLength(handle));
    var buffer: [64]u8 = undefined;
    const length = try heap.copyStringBytes(handle, &buffer);
    try equal(bytes.len, length);
    try std.testing.expectEqualSlices(u8, bytes, buffer[0..length]);
}

fn order(value: i8) std.math.Order {
    return if (value < 0) .lt else if (value > 0) .gt else .eq;
}

test "twenty independent slice wholes retain UTF16 and canonical bytes before and after moving GC" {
    const parsed = try std.json.parseFromSlice(Oracle, std.testing.allocator, @embedFile("testdata/string-slice-compare-oracle.json"), .{});
    defer parsed.deinit();
    try std.testing.expectEqualStrings("tsfg.managed-string-slice-compare-oracle", parsed.value.family);
    try equal(@as(u8, 1), parsed.value.version);
    try equal(@as(usize, 20), parsed.value.slices.len);
    for (parsed.value.slices) |vector| {
        std.debug.print("slice whole {s}\n", .{vector.name});
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const source = try heap.createString(vector.input, .persistent);
        const alias = try heap.retain(source, .persistent);
        var before: [64]u8 = undefined;
        const before_len = try heap.copyStringBytes(source, &before);
        const result = try heap.sliceString(alias, vector.start, vector.end, .persistent);
        try expect(!try heap.sameObject(source, result));
        try wholeEqual(&heap, result, vector.units, vector.bytes);
        try unitsEqual(&heap, source, vector.input);
        try wholeEqual(&heap, alias, vector.input, before[0..before_len]);
        try heap.collect();
        try wholeEqual(&heap, result, vector.units, vector.bytes);
        try wholeEqual(&heap, source, vector.input, before[0..before_len]);
        try heap.release(source);
        try heap.release(alias);
        try heap.collect();
        try equal(@as(usize, 1), try heap.objectCount());
        try wholeEqual(&heap, result, vector.units, vector.bytes);
    }
}

test "twenty independent unsigned UTF16 comparisons preserve both operands and reverse order" {
    const parsed = try std.json.parseFromSlice(Oracle, std.testing.allocator, @embedFile("testdata/string-slice-compare-oracle.json"), .{});
    defer parsed.deinit();
    try equal(@as(usize, 20), parsed.value.comparisons.len);
    for (parsed.value.comparisons) |vector| {
        std.debug.print("comparison whole {s}\n", .{vector.name});
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const left = try heap.createString(vector.left, .persistent);
        const right = try heap.createString(vector.right, .persistent);
        const objects = try heap.objectCount();
        const identity = heap.next_identity;
        try equal(order(vector.order), try heap.compareStrings(left, right));
        try equal(order(-vector.order), try heap.compareStrings(right, left));
        try equal(std.math.Order.eq, try heap.compareStrings(left, left));
        try equal(objects, try heap.objectCount());
        try equal(identity, heap.next_identity);
        try unitsEqual(&heap, left, vector.left);
        try unitsEqual(&heap, right, vector.right);
        try heap.collect();
        try equal(order(vector.order), try heap.compareStrings(left, right));
    }
}

test "slice result owns its range across source scope exit mixed edges and repeated collection" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    const source = try heap.createString(&.{ 65, 0xD800, 0xDC00, 0, 66 }, .temporary);
    const result = try heap.sliceString(source, 2, 4, .temporary);
    const persistent = try heap.retain(result, .persistent);
    const array = try heap.createArrayF64(&.{ -0.0, 2.5 }, .persistent);
    const holder = try heap.create(9, 42, 2, .persistent);
    try heap.setEdge(holder, 0, persistent);
    try heap.setEdge(holder, 1, array);
    try heap.release(persistent);
    try heap.release(array);
    try heap.endScope(scope);
    try expectError(error.InvalidHandle, heap.stringLength(source));
    try expectError(error.InvalidHandle, heap.stringLength(result));
    for (0..3) |_| {
        try heap.collect();
        try equal(@as(usize, 3), try heap.objectCount());
        const text = (try heap.retainEdge(holder, 0, .persistent)).?;
        const values = (try heap.retainEdge(holder, 1, .persistent)).?;
        try wholeEqual(&heap, text, &.{ 0xDC00, 0 }, &.{ 0xED, 0xB0, 0x80, 0 });
        try equal(@as(u64, 0x8000000000000000), @as(u64, @bitCast(try heap.readArrayF64(values, 0))));
        try equal(@as(f64, 2.5), try heap.readArrayF64(values, 1));
        try heap.release(text);
        try heap.release(values);
    }
    try heap.release(holder);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "exact range and handle errors publish nothing and leave valid owners unchanged" {
    var heap = Heap.init(std.testing.allocator);
    var foreign = Heap.init(std.testing.allocator);
    defer foreign.deinit() catch unreachable;
    const source = try heap.createString(&.{ 65, 0xD800, 0xDC00 }, .persistent);
    const other = try foreign.createString(&.{66}, .persistent);
    const scalar = try heap.create(0, 7, 0, .persistent);
    const array = try heap.createArrayF64(&.{1.5}, .persistent);
    const objects = try heap.objectCount();
    const identity = heap.next_identity;
    for ([_][2]usize{ .{ 2, 1 }, .{ 0, 4 }, .{ 4, 4 }, .{ 0, std.math.maxInt(usize) }, .{ std.math.maxInt(usize), std.math.maxInt(usize) } }) |range| {
        try expectError(error.IndexOutOfBounds, heap.sliceString(source, range[0], range[1], .persistent));
    }
    for ([_]Handle{ scalar, array }) |wrong| {
        try expectError(error.TypeMismatch, heap.sliceString(wrong, 0, 0, .persistent));
        try expectError(error.TypeMismatch, heap.compareStrings(wrong, source));
        try expectError(error.TypeMismatch, heap.compareStrings(source, wrong));
    }
    try expectError(error.InvalidHandle, heap.sliceString(other, 0, 0, .persistent));
    try expectError(error.InvalidHandle, heap.compareStrings(other, source));
    try expectError(error.InvalidHandle, heap.compareStrings(source, other));
    try expectError(error.ScopeRequired, heap.sliceString(source, 0, 0, .temporary));
    var copied = heap;
    try expectError(error.InvalidOwner, copied.sliceString(source, 0, 0, .persistent));
    try expectError(error.InvalidOwner, copied.compareStrings(source, source));
    try equal(objects, try heap.objectCount());
    try equal(identity, heap.next_identity);
    try wholeEqual(&heap, source, &.{ 65, 0xD800, 0xDC00 }, &.{ 65, 0xF0, 0x90, 0x80, 0x80 });
    const scope = try heap.beginScope();
    const transient = try heap.sliceString(source, 0, 3, .temporary);
    try heap.endScope(scope);
    const replacement = try heap.createString(&.{68}, .persistent);
    try expectError(error.InvalidHandle, heap.sliceString(transient, 0, 0, .persistent));
    try expectError(error.InvalidHandle, heap.compareStrings(source, transient));
    try expectError(error.InvalidHandle, heap.compareStrings(transient, source));
    try wholeEqual(&heap, replacement, &.{68}, &.{68});
    try heap.deinit();
    try expectError(error.HeapDestroyed, heap.sliceString(source, 0, 0, .persistent));
    try expectError(error.HeapDestroyed, heap.compareStrings(source, source));
    try expectError(error.InvalidOwner, copied.deinit());
}

test "comparison is allocation free including equal values prefixes and differing code units" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var heap = Heap.init(failing.allocator());
    defer heap.deinit() catch unreachable;
    const left = try heap.createString(&.{ 0xD800, 0xDC00 }, .persistent);
    const alias = try heap.retain(left, .persistent);
    const equal_value = try heap.createString(&.{ 0xD800, 0xDC00 }, .persistent);
    const high = try heap.createString(&.{0xD800}, .persistent);
    const bmp = try heap.createString(&.{0xE000}, .persistent);
    const empty = try heap.createString(&.{}, .persistent);
    const allocations = failing.alloc_index;
    const resizes = failing.resize_index;
    failing.fail_index = allocations;
    failing.resize_fail_index = resizes;
    try equal(std.math.Order.eq, try heap.compareStrings(left, alias));
    try equal(std.math.Order.eq, try heap.compareStrings(left, equal_value));
    try equal(std.math.Order.lt, try heap.compareStrings(left, bmp));
    try equal(std.math.Order.lt, try heap.compareStrings(high, left));
    try equal(std.math.Order.lt, try heap.compareStrings(empty, left));
    try equal(allocations, failing.alloc_index);
    try equal(resizes, failing.resize_index);
}

test "codec rejects malformed complete encodings before slice allocation or comparison decision" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    failing.fail_index = 0;
    const malformed = [_][]const u8{ &.{ 65, 0xC0, 0x80 }, &.{ 65, 0xF0, 0x90 }, &.{ 65, 0xED, 0xA0, 0x80, 0xED, 0xB0, 0x80 } };
    for (malformed) |bytes| {
        try expectError(error.InvalidCanonicalWtf8, codec.sliceAlloc(failing.allocator(), bytes, 0, 0));
        try expectError(error.InvalidCanonicalWtf8, codec.compare(&.{0}, bytes));
        try expectError(error.InvalidCanonicalWtf8, codec.compare(bytes, &.{0}));
    }
    try equal(@as(usize, 0), failing.alloc_index);
}
