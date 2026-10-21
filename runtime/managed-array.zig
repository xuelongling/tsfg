// SPDX-License-Identifier: MIT
// Array value plane; reference edges live in the same ManagedHeap object's graph.
const std = @import("std");
const element = @import("array-element.zig");
const Allocator = std.mem.Allocator;
pub const Error = element.Error;
pub const Array = struct {
    layout: element.Layout,
    bytes: []u8,
    tags: []u16,
    length: u32,

    pub fn init(allocator: Allocator, layout: element.Layout, values: []const element.Input) Error!Array {
        try layout.validate();
        if (values.len > std.math.maxInt(u32)) return error.ArrayTooLarge;
        const owned_layout = try layout.clone(allocator);
        errdefer owned_layout.deinit(allocator);
        const tags = try allocator.alloc(u16, values.len);
        errdefer allocator.free(tags);
        const bytes = try allocator.alloc(u8, try byteCount(layout, values.len));
        errdefer allocator.free(bytes);
        for (values, 0..) |value, index| {
            _ = try layout.checkBytes(value.tag, value.bytes);
            if (value.references.len != layout.reference_count) return error.InvalidArrayElement;
            tags[index] = value.tag;
            layout.copyBytes(value.tag, bytes[index * layout.byte_size ..][0..layout.byte_size], value.bytes);
        }
        return .{ .layout = owned_layout, .bytes = bytes, .tags = tags, .length = @intCast(values.len) };
    }

    pub fn byteCount(layout: element.Layout, count: usize) Error!usize {
        return std.math.mul(usize, layout.byte_size, count) catch error.ArrayTooLarge;
    }

    pub fn referenceCount(layout: element.Layout, count: usize) Error!usize {
        return std.math.mul(usize, layout.reference_count, count) catch error.ArrayTooLarge;
    }

    pub fn deinit(self: Array, allocator: Allocator) void {
        self.layout.deinit(allocator);
        allocator.free(self.bytes);
        allocator.free(self.tags);
    }

    pub fn clone(self: Array, allocator: Allocator) Error!Array {
        const layout = try self.layout.clone(allocator);
        errdefer layout.deinit(allocator);
        const tags = try allocator.dupe(u16, self.tags[0..self.length]);
        errdefer allocator.free(tags);
        const bytes = try allocator.dupe(u8, self.bytes[0..try byteCount(layout, self.length)]);
        return .{ .layout = layout, .tags = tags, .bytes = bytes, .length = self.length };
    }

    pub fn check(self: Array, expected: element.Layout) Error!void {
        if (!self.layout.same(expected)) return error.TypeMismatch;
    }

    pub fn readBytes(self: Array, index: u32) Error![]const u8 {
        if (index >= self.length) return error.IndexOutOfBounds;
        const start = @as(usize, index) * self.layout.byte_size;
        return self.bytes[start..][0..self.layout.byte_size];
    }

    // Append reserves a new value plane before the heap commits its edge plane.
    // Nothing is changed on allocation failure, including length and capacity.
    pub fn replacement(self: Array, allocator: Allocator, value: element.Input) Error!Array {
        if (self.length == std.math.maxInt(u32)) return error.ArrayTooLarge;
        const length = self.length + 1;
        const layout = try self.layout.clone(allocator);
        errdefer layout.deinit(allocator);
        const tags = try allocator.alloc(u16, length);
        errdefer allocator.free(tags);
        const bytes = try allocator.alloc(u8, try byteCount(layout, length));
        @memcpy(tags[0..self.length], self.tags[0..self.length]);
        tags[self.length] = value.tag;
        const old_size = try byteCount(layout, self.length);
        @memcpy(bytes[0..old_size], self.bytes[0..old_size]);
        layout.copyBytes(value.tag, bytes[old_size..], value.bytes);
        return .{ .layout = layout, .tags = tags, .bytes = bytes, .length = length };
    }
};
