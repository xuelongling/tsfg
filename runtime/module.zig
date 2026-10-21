// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const request = @import("request.zig");
const strings = @import("string-value.zig");

/// State belongs to one serial embedding instance and borrows its verified
/// module. Unload the module only after deinitializing every instance.
pub const State = struct {
    pub const Status = enum { uninitialized, initializing, initialized, failed };
    allocator: std.mem.Allocator,
    module: *const bytecode.VerifiedModule,
    status: Status = .uninitialized,
    globals: []u64,
    initialized: []bool,
    strings: *strings.Owner,
    string_globals: []?strings.Handle,
    failure: ?request.RequestFailure = null,

    pub fn init(allocator: std.mem.Allocator, module: *const bytecode.VerifiedModule) !State {
        const count = bytecode.moduleTables(module).globals.len;
        const globals = try allocator.alloc(u64, count);
        errdefer allocator.free(globals);
        const initialized = try allocator.alloc(bool, count);
        errdefer allocator.free(initialized);
        const string_globals = try allocator.alloc(?strings.Handle, count);
        errdefer allocator.free(string_globals);
        @memset(string_globals, null);
        const owner = try strings.Owner.create(allocator);
        @memset(globals, 0);
        @memset(initialized, false);
        return .{ .allocator = allocator, .module = module, .globals = globals, .initialized = initialized, .strings = owner, .string_globals = string_globals };
    }
    pub fn deinit(self: *State) void {
        for (self.string_globals) |handle| if (handle) |root| self.strings.heap.release(root) catch unreachable;
        self.allocator.free(self.string_globals);
        self.strings.release();
        self.allocator.free(self.globals);
        self.allocator.free(self.initialized);
        self.* = undefined;
    }
    pub fn storageBytes(self: *const State) usize {
        return @sizeOf(State) + @sizeOf(strings.Owner) + self.globals.len * (@sizeOf(u64) + @sizeOf(bool) + @sizeOf(?strings.Handle));
    }
    pub fn fail(self: *State, failure: request.RequestFailure) void {
        self.failure = failure;
        self.status = .failed;
    }
};
