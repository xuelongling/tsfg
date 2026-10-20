// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const expectError = std.testing.expectError;

fn values(heap: *Heap, handle: Handle, expected: []const f64) !void {
    try equal(@as(u32, @intCast(expected.len)), try heap.arrayF64Length(handle));
    for (expected, 0..) |element, index| {
        const actual = try heap.readArrayF64(handle, @intCast(index));
        try equal(@as(u64, @bitCast(element)), @as(u64, @bitCast(actual)));
    }
    try expectError(error.IndexOutOfBounds, heap.readArrayF64(handle, @intCast(expected.len)));
    try expectError(error.IndexOutOfBounds, heap.readArrayF64(handle, std.math.maxInt(u32)));
}

test "dense Array owns f64 bits while aliases share and independent owners stay separate" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var input = [_]f64{ -0.0, @bitCast(@as(u64, 0x7FF8000000000042)), std.math.inf(f64), -std.math.inf(f64) };
    const original = input;
    const first = try heap.createArrayF64(&input, .persistent);
    const independent = try heap.createArrayF64(&input, .persistent);
    const alias = try heap.retain(first, .persistent);
    input[0] = 99;
    try values(&heap, first, &original);
    try values(&heap, independent, &original);
    try expect(try heap.sameObject(first, alias));
    try expect(!try heap.sameObject(first, independent));
    try heap.storeArrayF64(alias, 0, 7.5);
    try equal(@as(f64, 7.5), try heap.readArrayF64(first, 0));
    try equal(@as(u64, 0x8000000000000000), @as(u64, @bitCast(try heap.readArrayF64(independent, 0))));
    try heap.collect();
    try equal(@as(f64, 7.5), try heap.readArrayF64(alias, 0));
    try values(&heap, independent, &original);
}

test "overwrite tail append shrink and empty bounds preserve each failed operation's prior state" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const handle = try heap.createArrayF64(&[_]f64{ 10, 20 }, .persistent);
    const alias = try heap.retain(handle, .persistent);
    try heap.storeArrayF64(handle, 1, 21);
    try expectError(error.IndexOutOfBounds, heap.storeArrayF64(handle, 4, 40));
    try expectError(error.IndexOutOfBounds, heap.storeArrayF64(handle, std.math.maxInt(u32), 40));
    try expectError(error.UninitializedGrowth, heap.resizeArrayF64(handle, 4));
    try expectError(error.UninitializedGrowth, heap.resizeArrayF64(handle, std.math.maxInt(u32)));
    try values(&heap, alias, &[_]f64{ 10, 21 });
    try heap.storeArrayF64(handle, 2, 30);
    try values(&heap, alias, &[_]f64{ 10, 21, 30 });
    try heap.resizeArrayF64(alias, 1);
    try values(&heap, handle, &[_]f64{10});
    try expectError(error.UninitializedGrowth, heap.resizeArrayF64(handle, 2));
    try values(&heap, handle, &[_]f64{10});
    try heap.storeArrayF64(alias, 1, 40);
    try heap.resizeArrayF64(handle, 2);
    try values(&heap, handle, &[_]f64{ 10, 40 });
    try heap.resizeArrayF64(handle, 0);
    try values(&heap, alias, &[_]f64{});
    try expectError(error.IndexOutOfBounds, heap.storeArrayF64(handle, 1, 99));
    try heap.storeArrayF64(handle, 0, 50);
    try values(&heap, alias, &[_]f64{50});
    const empty = try heap.createArrayF64(&[_]f64{}, .persistent);
    try heap.resizeArrayF64(empty, 0);
    try values(&heap, empty, &[_]f64{});
    try heap.storeArrayF64(empty, 0, -0.0);
    try values(&heap, empty, &[_]f64{-0.0});
}

test "Array roots share String scalar scopes edges and the actual moving collector" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    const temporary = try heap.createArrayF64(&[_]f64{ 1.5, 2.5 }, .temporary);
    const persistent = try heap.retain(temporary, .persistent);
    const alias = try heap.retain(persistent, .persistent);
    const nested = try heap.beginScope();
    const nested_root = try heap.retain(temporary, .temporary);
    try heap.endScope(nested);
    try expectError(error.InvalidHandle, heap.arrayF64Length(nested_root));
    const string = try heap.createString(&[_]u16{ 0xD83D, 0xDE00 }, .persistent);
    const holder = try heap.create(9, 42, 2, .persistent);
    try heap.setEdge(holder, 0, persistent);
    try heap.setEdge(holder, 1, string);
    try heap.release(persistent);
    try heap.release(string);
    try heap.endScope(scope);
    try expectError(error.InvalidHandle, heap.arrayF64Length(temporary));
    var location = try managed.testing.location(&heap, alias);
    for (0..3) |_| {
        try heap.collect();
        const moved = try managed.testing.location(&heap, alias);
        try expect(location != moved);
        location = moved;
        try values(&heap, alias, &[_]f64{ 1.5, 2.5 });
        const via_edge = (try heap.retainEdge(holder, 0, .persistent)).?;
        const via_string = (try heap.retainEdge(holder, 1, .persistent)).?;
        try expect(try heap.sameObject(alias, via_edge));
        try equal(@as(u16, 0xDE00), try heap.readStringCodeUnit(via_string, 1));
        try heap.release(via_edge);
        try heap.release(via_string);
    }
    try heap.storeArrayF64(alias, 2, 3.5);
    try heap.release(alias);
    const only_edge = (try heap.retainEdge(holder, 0, .persistent)).?;
    try values(&heap, only_edge, &[_]f64{ 1.5, 2.5, 3.5 });
    try heap.release(only_edge);
    try heap.release(holder);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "wrong payload foreign stale destroyed and copied-owner Array operations refuse" {
    var left = Heap.init(std.testing.allocator);
    var right = Heap.init(std.testing.allocator);
    defer right.deinit() catch unreachable;
    const array = try left.createArrayF64(&[_]f64{1}, .persistent);
    const other = try right.createArrayF64(&[_]f64{2}, .persistent);
    const scalar = try left.create(0, 7, 0, .persistent);
    const string = try left.createString(&[_]u16{0x0041}, .persistent);
    try expectError(error.TypeMismatch, left.read(array, 0));
    try expectError(error.TypeMismatch, left.write(array, 0, 9));
    try expectError(error.TypeMismatch, left.stringLength(array));
    for ([_]Handle{ scalar, string }) |handle| {
        try expectError(error.TypeMismatch, left.arrayF64Length(handle));
        try expectError(error.TypeMismatch, left.readArrayF64(handle, 0));
        try expectError(error.TypeMismatch, left.storeArrayF64(handle, 0, 99));
        try expectError(error.TypeMismatch, left.resizeArrayF64(handle, 0));
    }
    try equal(@as(u64, 7), (try left.read(scalar, 0)).scalar);
    try equal(@as(u16, 0x0041), try left.readStringCodeUnit(string, 0));
    try expectError(error.InvalidHandle, right.readArrayF64(array, 0));
    try expectError(error.InvalidHandle, left.readArrayF64(other, 0));
    var copied_owner = left;
    try expectError(error.InvalidOwner, copied_owner.storeArrayF64(array, 0, 99));
    try left.release(array);
    try expectError(error.InvalidHandle, left.arrayF64Length(array));
    const replacement = try left.createArrayF64(&[_]f64{3}, .persistent);
    try expectError(error.InvalidHandle, left.readArrayF64(array, 0));
    var bad = replacement;
    bad.generation += 1;
    try expectError(error.InvalidHandle, left.storeArrayF64(bad, 0, 9));
    bad = replacement;
    bad.slot = std.math.maxInt(usize);
    try expectError(error.InvalidHandle, left.resizeArrayF64(bad, 0));
    try expectError(error.ScopeRequired, left.createArrayF64(&[_]f64{1}, .temporary));
    try left.deinit();
    try expectError(error.HeapDestroyed, left.arrayF64Length(replacement));
    try expectError(error.InvalidOwner, copied_owner.deinit());
}
