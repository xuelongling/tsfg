// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;
const bytecode = @import("bytecode.zig");
const vm = @import("vm.zig");
/// A serial host request context. Concurrent hosts use separate Runtime values.
pub const Runtime = struct {
    allocator: Allocator,
    active_requests: usize = 0,
    pub fn init(allocator: Allocator) Runtime {
        return .{ .allocator = allocator };
    }
    pub fn activeRequests(self: *const Runtime) usize {
        return self.active_requests;
    }
};

pub inline fn eval_bytecode(host: *Runtime, module: *const bytecode.VerifiedModule, function_id: bytecode.FunctionId, arguments: []const vm.TypedValue, capabilities: []const vm.Capability, limits: vm.RequestLimits) vm.RequestOutcome {
    host.active_requests += 1;
    defer host.active_requests -= 1;
    return vm.evaluate(host.allocator, module, function_id, arguments, capabilities, limits);
}
