// SPDX-License-Identifier: MIT
const std = @import("std");
const Heap = @import("managed-heap.zig").ManagedHeap;

test "real heap slices surrogate code units and compares unsigned UTF16" {
    try std.testing.expect(@hasDecl(Heap, "sliceString") and @hasDecl(Heap, "compareStrings"));
    if (comptime @hasDecl(Heap, "sliceString") and @hasDecl(Heap, "compareStrings")) {
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const source = try heap.createString(&.{ 0xD800, 0xDC00 }, .persistent);
        const high = try heap.sliceString(source, 0, 1, .persistent);
        var bytes: [3]u8 = undefined;
        try std.testing.expectEqual(@as(usize, 3), try heap.copyStringBytes(high, &bytes));
        try std.testing.expectEqualSlices(u8, &.{ 0xED, 0xA0, 0x80 }, &bytes);
        const bmp = try heap.createString(&.{0xE000}, .persistent);
        try std.testing.expectEqual(std.math.Order.lt, try heap.compareStrings(source, bmp));
        try std.testing.expectEqual(std.math.Order.lt, try heap.compareStrings(high, source));
        try std.testing.expect(!try heap.sameObject(source, high));
        try std.testing.expectEqual(@as(usize, 2), try heap.stringLength(source));
    }
}
