// SPDX-License-Identifier: MIT
// Account every heap allocation, including collector copies and root capacity.
// Disabling in-place growth keeps failed reallocations transactional.
const std = @import("std");
pub const Budget = struct {
    backing: std.mem.Allocator,
    used: usize = 0,
    limit: usize = std.math.maxInt(usize),
    pub fn allocator(self: *Budget) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(context: *anyopaque, size: usize, alignment: std.mem.Alignment, address: usize) ?[*]u8 {
        const self: *Budget = @ptrCast(@alignCast(context));
        if (self.used > self.limit or size > self.limit - self.used) return null;
        const bytes = self.backing.rawAlloc(size, alignment, address) orelse return null;
        self.used += size;
        return bytes;
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool { return false; }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 { return null; }
    fn free(context: *anyopaque, bytes: []u8, alignment: std.mem.Alignment, address: usize) void {
        const self: *Budget = @ptrCast(@alignCast(context));
        self.backing.rawFree(bytes, alignment, address);
        self.used -= bytes.len;
    }
};
