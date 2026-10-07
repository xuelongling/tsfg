// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const request = @import("request.zig");

/// State belongs to one serial embedding instance and borrows its verified
/// module. Unload the module only after deinitializing every instance.
pub const State = struct {
    pub const Status = enum { uninitialized, initializing, initialized, failed };
    allocator: std.mem.Allocator,
    module: *const bytecode.VerifiedModule,
    status: Status = .uninitialized,
    globals: []u64,
    initialized: []bool,
    failure: ?request.RequestFailure = null,

    pub fn init(allocator: std.mem.Allocator, module: *const bytecode.VerifiedModule) !State {
        const count = bytecode.moduleTables(module).globals.len;
        const globals = try allocator.alloc(u64, count);
        errdefer allocator.free(globals);
        const initialized = try allocator.alloc(bool, count);
        @memset(globals, 0);
        @memset(initialized, false);
        return .{ .allocator = allocator, .module = module, .globals = globals, .initialized = initialized };
    }
    pub fn deinit(self: *State) void {
        self.allocator.free(self.globals);
        self.allocator.free(self.initialized);
        self.* = undefined;
    }
    pub fn storageBytes(self: *const State) usize {
        return @sizeOf(State) + self.globals.len * (@sizeOf(u64) + @sizeOf(bool));
    }
    pub fn fail(self: *State, failure: request.RequestFailure) void {
        self.failure = failure;
        self.status = .failed;
    }
};
