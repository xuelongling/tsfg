// SPDX-License-Identifier: MIT
// Complete DTO comparisons ignore object insertion order, never field/value data.
const std = @import("std");
pub fn hashEqual(expected: []const u8, bytes: []const u8) !void {
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &hash, .{});
    try std.testing.expectEqualStrings(expected, &std.fmt.bytesToHex(hash, .lower));
}
fn less(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.lessThan(u8, left, right);
}
pub fn ordered(allocator: std.mem.Allocator, value: std.json.Value) std.mem.Allocator.Error!std.json.Value {
    return switch (value) {
        .object => |object| blk: {
            const keys = try allocator.alloc([]const u8, object.count());
            var iterator = object.iterator();
            var i: usize = 0;
            while (iterator.next()) |entry| : (i += 1) keys[i] = entry.key_ptr.*;
            std.mem.sort([]const u8, keys, {}, less);
            var result: std.json.ObjectMap = .empty;
            for (keys) |key| try result.put(allocator, key, try ordered(allocator, object.get(key).?));
            break :blk .{ .object = result };
        },
        .array => |array| blk: {
            var result: std.array_list.Managed(std.json.Value) = .init(allocator);
            for (array.items) |item| try result.append(try ordered(allocator, item));
            break :blk .{ .array = result };
        },
        else => value,
    };
}
pub fn equal(expected: std.json.Value, observed: []const u8) !void {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, observed, .{});
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const left = try std.json.Stringify.valueAlloc(arena.allocator(), try ordered(arena.allocator(), expected), .{});
    const right = try std.json.Stringify.valueAlloc(arena.allocator(), try ordered(arena.allocator(), parsed.value), .{});
    try std.testing.expectEqualStrings(left, right);
}
