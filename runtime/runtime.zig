// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;
const bytecode = @import("bytecode.zig");
const vm = @import("vm.zig");
const managed = @import("managed-heap.zig");

pub const Runtime = @import("runtime-state.zig").Runtime;

pub inline fn eval_bytecode(host: *Runtime, module: *const bytecode.VerifiedModule, function_id: bytecode.FunctionId, arguments: []const vm.TypedValue, capabilities: []const vm.Capability, limits: vm.RequestLimits) vm.RequestOutcome {
    const scope = host.heap.beginScope() catch {
        // Physical resource/owner exhaustion uses the established request abort
        // identity, never the catchable managed-exception channel.
        return .{ .failed = .{ .code = "r05-execution-abort", .category = "execution-abort",
            .function_id = function_id, .source = bytecode.moduleInfoView(module).source,
            .fuel_remaining = limits.semantic_fuel } };
    };
    defer host.heap.endScope(scope) catch unreachable;
    host.active_requests += 1;
    defer host.active_requests -= 1;
    return vm.evaluate(host.allocator, module, function_id, arguments, capabilities, limits);
}
