// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const expectError = std.testing.expectError;
const Vector = struct {
    id: []const u8,
    leftUnits: []const u16,
    leftBytes: []const u8,
    rightUnits: []const u16,
    rightBytes: []const u8,
    resultUnits: []const u16,
    resultBytes: []const u8,
};
const Oracle = struct { schema: []const u8, basis: []const u8, vectors: []const Vector };

fn verify(heap: *Heap, handle: Handle, units: []const u16, bytes: []const u8) !void {
    try equal(units.len, try heap.stringLength(handle));
    try equal(bytes.len, try heap.stringByteLength(handle));
    var buffer: [64]u8 = undefined;
    try expect(bytes.len <= buffer.len);
    const length = try heap.copyStringBytes(handle, &buffer);
    try equal(bytes.len, length);
    try std.testing.expectEqualSlices(u8, bytes, buffer[0..length]);
    for (units, 0..) |unit, index| try equal(unit, try heap.readStringCodeUnit(handle, index));
    try expectError(error.IndexOutOfBounds, heap.readStringCodeUnit(handle, units.len));
}

test "complete independent concat vectors preserve code units canonical bytes and both inputs" {
    const parsed = try std.json.parseFromSlice(Oracle, std.testing.allocator, @embedFile("testdata/string-concat-oracle.json"), .{});
    defer parsed.deinit();
    try std.testing.expectEqualStrings("tsfg.managed-string-concat-oracle.v1", parsed.value.schema);
    try equal(@as(usize, 21), parsed.value.vectors.len);
    for (parsed.value.vectors) |vector| {
        std.debug.print("concat vector {s}\n", .{vector.id});
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const left = try heap.createString(vector.leftUnits, .persistent);
        const right = try heap.createString(vector.rightUnits, .persistent);
        const alias = try heap.retain(left, .persistent);
        const joined = try heap.concatStrings(alias, right, .persistent);
        try expect(!try heap.sameObject(joined, left));
        try expect(!try heap.sameObject(joined, right));
        try verify(&heap, left, vector.leftUnits, vector.leftBytes);
        try verify(&heap, right, vector.rightUnits, vector.rightBytes);
        try verify(&heap, joined, vector.resultUnits, vector.resultBytes);
        try heap.collect();
        try verify(&heap, alias, vector.leftUnits, vector.leftBytes);
        try verify(&heap, right, vector.rightUnits, vector.rightBytes);
        try verify(&heap, joined, vector.resultUnits, vector.resultBytes);
    }
}

test "same source aliases create a separately rooted result" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const high = try heap.createString(&.{0xD800}, .persistent);
    const alias = try heap.retain(high, .persistent);
    const joined = try heap.concatStrings(high, alias, .persistent);
    try verify(&heap, joined, &.{ 0xD800, 0xD800 }, &.{ 0xED, 0xA0, 0x80, 0xED, 0xA0, 0x80 });
    try expect(!try heap.sameObject(high, joined));
    try heap.release(high);
    try heap.release(alias);
    try heap.collect();
    try equal(@as(usize, 1), try heap.objectCount());
    try verify(&heap, joined, &.{ 0xD800, 0xD800 }, &.{ 0xED, 0xA0, 0x80, 0xED, 0xA0, 0x80 });
}

test "concat result survives source scope end through mixed String Array scalar edges" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    const left = try heap.createString(&.{ 65, 0xD800 }, .temporary);
    const right = try heap.createString(&.{ 0xDC00, 0 }, .temporary);
    const temporary = try heap.concatStrings(left, right, .temporary);
    const persistent = try heap.retain(temporary, .persistent);
    const array = try heap.createArrayF64(&.{ -0.0, 2.5 }, .persistent);
    const holder = try heap.create(9, 42, 2, .persistent);
    try heap.setEdge(holder, 0, persistent);
    try heap.setEdge(holder, 1, array);
    try heap.release(persistent);
    try heap.release(array);
    try heap.endScope(scope);
    try expectError(error.InvalidHandle, heap.stringLength(temporary));
    try expectError(error.InvalidHandle, heap.stringLength(left));
    try expectError(error.InvalidHandle, heap.stringLength(right));
    for (0..3) |_| {
        try heap.collect();
        try equal(@as(usize, 3), try heap.objectCount());
        const joined = (try heap.retainEdge(holder, 0, .persistent)).?;
        const values = (try heap.retainEdge(holder, 1, .persistent)).?;
        try verify(&heap, joined, &.{ 65, 0xD800, 0xDC00, 0 }, &.{ 65, 0xF0, 0x90, 0x80, 0x80, 0 });
        try equal(@as(u64, 0x8000000000000000), @as(u64, @bitCast(try heap.readArrayF64(values, 0))));
        try equal(@as(f64, 2.5), try heap.readArrayF64(values, 1));
        try heap.release(joined);
        try heap.release(values);
    }
    try heap.release(holder);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "concat rejects wrong owner stale type and lifetime without changing valid sources" {
    var heap = Heap.init(std.testing.allocator);
    var foreign = Heap.init(std.testing.allocator);
    defer foreign.deinit() catch unreachable;
    const valid = try heap.createString(&.{65}, .persistent);
    const other = try foreign.createString(&.{66}, .persistent);
    const scalar = try heap.create(0, 7, 0, .persistent);
    const array = try heap.createArrayF64(&.{1.5}, .persistent);
    const before = try heap.objectCount();
    for ([_]Handle{ scalar, array }) |wrong| {
        try expectError(error.TypeMismatch, heap.concatStrings(wrong, valid, .persistent));
        try expectError(error.TypeMismatch, heap.concatStrings(valid, wrong, .persistent));
    }
    try expectError(error.InvalidHandle, heap.concatStrings(other, valid, .persistent));
    try expectError(error.InvalidHandle, heap.concatStrings(valid, other, .persistent));
    try expectError(error.ScopeRequired, heap.concatStrings(valid, valid, .temporary));
    var copied = heap;
    try expectError(error.InvalidOwner, copied.concatStrings(valid, valid, .persistent));
    try equal(before, try heap.objectCount());
    try verify(&heap, valid, &.{65}, &.{65});
    try equal(@as(u64, 7), (try heap.read(scalar, 0)).scalar);
    try equal(@as(f64, 1.5), try heap.readArrayF64(array, 0));
    const stale = try heap.createString(&.{67}, .persistent);
    try heap.release(stale);
    const replacement = try heap.createString(&.{68}, .persistent);
    try expectError(error.InvalidHandle, heap.concatStrings(stale, valid, .persistent));
    try expectError(error.InvalidHandle, heap.concatStrings(valid, stale, .persistent));
    try verify(&heap, replacement, &.{68}, &.{68});
    try heap.deinit();
    try expectError(error.HeapDestroyed, heap.concatStrings(valid, valid, .persistent));
    try expectError(error.InvalidOwner, copied.deinit());
}
