// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;

test "typed Array owns initialized undefined independently of missing and traces reference elements" {
    try std.testing.expect(@hasDecl(Heap, "createTypedArray"));
    if (comptime @hasDecl(Heap, "createTypedArray")) {
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const layout: managed.ArrayLayout = .{ .type_id = .{7} ** 32, .byte_size = 1, .alignment = 1, .reference_count = 1, .variants = &.{ .{ .tag = 0, .references = &.{.{ .slot = 0, .type = .{ .object = 77 } }} }, .{ .tag = 1, .kind = .undefined_value } } };
        const child = try heap.create(77, 42, 0, .persistent);
        // The selected union layout uses tag 0 for a reference, 1 for undefined.
        const array = try heap.createTypedArray(layout, &.{
            .{ .tag = 1, .bytes = &.{1}, .references = &.{null} },
            .{ .bytes = &.{0}, .references = &.{child} },
        }, .persistent);
        try heap.release(child);
        try heap.collect();
        const scope = try heap.beginScope();
        defer heap.endScope(scope) catch unreachable;
        var first = try heap.readTypedArray(array, layout, 0, .temporary);
        defer first.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(u16, 1), first.tag);
        try std.testing.expectEqualSlices(u8, &.{0}, first.bytes);
        try std.testing.expect(first.references[0] == null);
        try std.testing.expectError(error.IndexOutOfBounds, heap.readTypedArray(array, layout, 2, .temporary));
        var second = try heap.readTypedArray(array, layout, 1, .temporary);
        defer second.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(u64, 42), (try heap.read(second.references[0].?, 77)).scalar);
        try heap.resizeTypedArray(array, layout, 1);
        try heap.collect();
        try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
    }
}
