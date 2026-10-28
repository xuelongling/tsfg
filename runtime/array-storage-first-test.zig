// SPDX-License-Identifier: MIT
const std = @import("std");
const Heap = @import("managed-heap.zig").ManagedHeap;

test "real ManagedHeap owns and mutates a dense f64 Array" {
    try std.testing.expect(@hasDecl(Heap, "createArrayF64"));
    if (comptime @hasDecl(Heap, "createArrayF64")) {
        var heap = Heap.init(std.testing.allocator);
        defer heap.deinit() catch unreachable;
        var input = [_]f64{ 1.5, 2.5 };
        const handle = try heap.createArrayF64(&input, .persistent);
        input[0] = 99;
        try std.testing.expectEqual(@as(u32, 2), try heap.arrayF64Length(handle));
        try std.testing.expectEqual(@as(f64, 1.5), try heap.readArrayF64(handle, 0));
        try heap.storeArrayF64(handle, 1, 7.5);
        try heap.storeArrayF64(handle, 2, 8.5);
        try std.testing.expectEqual(@as(u32, 3), try heap.arrayF64Length(handle));
        try std.testing.expectEqual(@as(f64, 7.5), try heap.readArrayF64(handle, 1));
        try std.testing.expectEqual(@as(f64, 8.5), try heap.readArrayF64(handle, 2));
    }
}
