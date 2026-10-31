// SPDX-License-Identifier: MIT
// The callee half of Common's effective dependency reverse equality. Reuse
// independently solved fixed CODE sets; no actual values or claimed dependency
// edges feed this walk. This is not a second CODE/SSA/heap interpreter.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const fixed = @import("wire-program-fixed-targets-check.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

const Walk = struct {
    c: *Context,
    function: t.FunctionRef,
    may_throw: []const ?bool,
    visited: []bool,
    pending: std.ArrayListUnmanaged(t.BlockRef) = .empty,
    callees: std.AutoHashMapUnmanaged(t.Hash, void) = .empty,

    fn deinit(self: *Walk) void {
        self.c.allocator.free(self.visited);
        self.pending.deinit(self.c.allocator);
        self.callees.deinit(self.c.allocator);
    }

    fn enqueue(self: *Walk, block: t.BlockRef) Error!void {
        try self.c.step();
        const index = @intFromEnum(block);
        if (self.visited[index]) return;
        try self.pending.append(self.c.allocator, block);
        self.visited[index] = true;
    }

    fn consume(self: *Walk, callee: t.FunctionRef) Error!bool {
        try self.c.step();
        const index = @intFromEnum(callee);
        // An initializer is a definition to analyze, never a callable fixed
        // contract. A missing callee contract cannot mean a nonthrowing call.
        const throwing = self.may_throw[index] orelse return error.InvalidShape;
        try self.callees.put(self.c.allocator, self.c.program.functions[index].id, {});
        return throwing;
    }

    fn invocation(self: *Walk, flow: *const fixed.Flow, at: fixed.Site, op: model.instruction.Instruction) Error!void {
        var throwing = false;
        const edges: struct { normal: t.BlockRef, exceptional: t.BlockRef } = switch (op.data) {
            .eh_invoke => |call| edge: {
                throwing = try self.consume(call.callee);
                break :edge .{ .normal = call.normal, .exceptional = call.exceptional };
            },
            .eh_invoke_indirect => |call| edge: {
                const derived = flow.sites.get(at) orelse return error.InvalidShape;
                // Fixed.analyze supplies this complete finite occurrence union.
                var targets = derived.functions.keyIterator();
                while (targets.next()) |target| {
                    const target_throws = try self.consume(target.*);
                    throwing = target_throws or throwing;
                }
                break :edge .{ .normal = call.normal, .exceptional = call.exceptional };
            },
            .common_method_invoke => |call| edge: {
                // checkCompatibility independently established the complete
                // nominal/structural target catalogue and each target ABI.
                const common = self.c.program.tables.mode.common;
                for (common.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| {
                    const target_throws = try self.consume(arm.target orelse return error.InvalidShape);
                    throwing = target_throws or throwing;
                }
                break :edge .{ .normal = call.normal, .exceptional = call.exceptional };
            },
            else => return error.InvalidShape,
        };
        // Match GraphEffects: normal always participates; language completion
        // participates iff ANY complete original callee upper permits throw.
        // Neither actual completion nor a claimed dependency selects an arm.
        try self.enqueue(edges.normal);
        if (throwing) try self.enqueue(edges.exceptional);
    }

    fn run(self: *Walk, flow: *const fixed.Flow) Error!void {
        const function = self.c.program.functions[@intFromEnum(self.function)];
        try self.enqueue(@enumFromInt(0));
        var cursor: usize = 0;
        while (cursor < self.pending.items.len) : (cursor += 1) {
            try self.c.step();
            const block = self.pending.items[cursor];
            for (function.blocks[@intFromEnum(block)].instructions, 0..) |op, instruction| {
                try self.c.step();
                switch (op.data) {
                    .eh_invoke, .eh_invoke_indirect, .common_method_invoke => try self.invocation(flow, .{
                        .function = self.function, .block = block, .instruction = @intCast(instruction),
                    }, op),
                    .br => |branch| try self.enqueue(branch.destination),
                    .cond_br => |branch| {
                        try self.enqueue(branch.true_destination);
                        try self.enqueue(branch.false_destination);
                    },
                    .eh_route => |route| try self.enqueue(route.successor),
                    .domain_numeric_use => |numeric| try self.enqueue(numeric.normal_successor),
                    else => {}, // No other admitted Common opcode adds CFG edges/callees.
                }
            }
        }
    }
};

// Preconditions: same Context refs/layout/SSA/identity, fixed interfaces and
// checkCompatibility succeeded, then fixed.analyze independently derived this
// Flow for the SAME immutable Program. Do not supply wire claim rows as Flow.
//
// Every function, including initializers, starts at its entry. Reachability is
// the original upper-effect CFG, not actual-selected paths: both conditional
// branches, all complete method/indirect callees, and mayThrow language arms.
// The result checks direct effective callee membership in BOTH directions;
// callee-transitive effects do not manufacture direct caller dependencies.
//
// Identity already owns original digest joins/order, and checkHostSites owns
// the all-instruction Host inventory. This pass does not repeat either. It
// does not prove body-effects containment, HSC/provenance, full publication,
// Source equivalence, borrow, execution or admission. In particular original
// mayThrow bounds still need the independent fixed-effects obligation.
pub fn checkCallees(c: *Context, flow: *const fixed.Flow) Error!void {
    const common = switch (c.program.tables.mode) {
        .common => |value| value,
        else => return error.WrongMode,
    };
    var functions: std.AutoHashMapUnmanaged(t.Hash, t.FunctionRef) = .empty;
    defer functions.deinit(c.allocator);
    try c.charge(c.program.functions.len);
    const may_throw = try c.allocator.alloc(?bool, c.program.functions.len);
    defer c.allocator.free(may_throw);
    @memset(may_throw, null);
    for (c.program.functions, 0..) |function, index| {
        try c.step();
        try functions.put(c.allocator, function.id, @enumFromInt(index));
    }
    for (common.authority.fixed_publication.publication.contracts) |contract| {
        try c.step();
        const function = functions.get(contract.function_id) orelse return error.InvalidReference;
        may_throw[@intFromEnum(function)] = contract.upper.facets.may_throw;
    }
    for (c.program.functions, 0..) |function, index| {
        try c.charge(function.blocks.len + 1);
        const visited = try c.allocator.alloc(bool, function.blocks.len);
        @memset(visited, false);
        var walk = Walk{ .c = c, .function = @enumFromInt(index), .may_throw = may_throw, .visited = visited };
        defer walk.deinit();
        try walk.run(flow);
        const claimed = common.authority.fixed_publication.dependencies[index].callees;
        try c.require(claimed.len == walk.callees.count());
        // Original claimed IDs are already unique. Equal cardinality and
        // membership reject omitted and extra edges, without a claimed seed.
        for (claimed) |callee| {
            try c.step();
            try c.require(walk.callees.contains(callee.function_id));
        }
    }
}
