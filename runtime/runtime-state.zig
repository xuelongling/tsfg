// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;
const managed = @import("managed-heap.zig");

/// A serial host request context. Concurrent hosts use separate Runtime values.
/// init allocates nothing. After first heap/request use the Runtime is pinned:
/// transfer ownership before use, then retain its address through deinit.
pub const Runtime = struct {
    allocator: Allocator,
    heap: managed.ManagedHeap,
    active_requests: usize = 0,

    pub fn init(allocator: Allocator) Runtime {
        return .{ .allocator = allocator, .heap = managed.ManagedHeap.init(allocator) };
    }

    pub fn deinit(self: *Runtime) !void {
        if (self.active_requests != 0) return error.RuntimeBusy;
        try self.heap.deinit();
    }

    pub fn activeRequests(self: *const Runtime) usize {
        return self.active_requests;
    }
};
