// SPDX-License-Identifier: MIT
// Stable heap ownership shared by an instance and its independently rooted result.
const std = @import("std");
const managed = @import("managed-heap.zig");
pub const Handle = managed.Handle;
pub const Owner = struct {
    allocator: std.mem.Allocator,
    heap: managed.ManagedHeap,
    budget: @import("string-budget.zig").Budget,
    references: usize = 1,

    pub fn create(allocator: std.mem.Allocator) !*Owner {
        const owner = try allocator.create(Owner);
        owner.* = .{ .allocator = allocator, .heap = undefined, .budget = .{ .backing = allocator } };
        owner.heap = managed.ManagedHeap.init(owner.budget.allocator());
        return owner;
    }
    pub fn retain(self: *Owner) !void {
        if (self.references == std.math.maxInt(usize)) return error.IdentityExhausted;
        self.references += 1;
    }
    pub fn release(self: *Owner) void {
        self.references -= 1;
        if (self.references == 0) {
            const allocator = self.allocator;
            // An unused wrapper has no owned storage. Avoid reserving an ID
            // merely to destroy it, including after owner-ID exhaustion.
            if (self.heap.owner != 0) self.heap.deinit() catch unreachable;
            allocator.destroy(self);
        }
    }
};

pub const String = struct {
    owner: *Owner,
    handle: Handle,

    pub fn retain(owner: *Owner, handle: Handle) !String {
        _ = try owner.heap.stringLength(handle);
        const root = try owner.heap.retain(handle, .persistent);
        errdefer owner.heap.release(root) catch unreachable;
        try owner.retain();
        return .{ .owner = owner, .handle = root };
    }
    pub fn deinit(self: *String) void {
        self.owner.heap.release(self.handle) catch unreachable;
        self.owner.release();
        self.* = undefined;
    }
    // Cross-instance argument transfer preserves code units in an owned copy.
    pub fn import(self: String, destination: *Owner) !Handle {
        if (self.owner == destination) return destination.heap.retain(self.handle, .persistent);
        return destination.heap.copyStringFrom(&self.owner.heap, self.handle, .persistent);
    }
};
