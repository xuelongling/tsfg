// SPDX-License-Identifier: MIT
const std = @import("std");
const Heap = @import("managed-heap.zig").ManagedHeap;

test "real heap concatenates a split surrogate pair into canonical owned String" {
    try std.testing.expect(@hasDecl(Heap, "concatStrings"));
    if (comptime @hasDecl(Heap, "concatStrings")) {
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        const left = try heap.createString(&.{0xD800}, .persistent);
        const right = try heap.createString(&.{0xDC00}, .persistent);
        const joined = try heap.concatStrings(left, right, .persistent);
        try std.testing.expectEqual(@as(usize, 2), try heap.stringLength(joined));
        var bytes: [4]u8 = undefined;
        try std.testing.expectEqual(@as(usize, 4), try heap.copyStringBytes(joined, &bytes));
        try std.testing.expectEqualSlices(u8, &.{ 0xF0, 0x90, 0x80, 0x80 }, &bytes);
        try std.testing.expectEqual(@as(u16, 0xD800), try heap.readStringCodeUnit(joined, 0));
        try std.testing.expectEqual(@as(u16, 0xDC00), try heap.readStringCodeUnit(joined, 1));
    }
}
