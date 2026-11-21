// SPDX-License-Identifier: MIT
// The callee half of Common's effective dependency reverse equality. Reuse
// independently solved fixed CODE sets; no actual values or claimed dependency
// edges feed this walk. This is not a second CODE/SSA/heap interpreter.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const fixed = @import("wire-program-fixed-targets-check.zig");
const body_origins = @import("wire-program-return-origin-body.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

const Walk = struct {
    c: *Context,
    function: t.FunctionRef,
    may_throw: []const ?bool,
    visited: []bool,
    receiver_flow: ?*const body_origins.ReceiverFlow,
    unproved_receiver: bool = false,
    include_unproved: bool = false,
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

    fn receiver(self: *Walk, block: t.BlockRef, instruction: usize, normal: t.BlockRef, language: t.BlockRef) Error!void {
        if (self.receiver_flow) |receiver_flow| {
            for (receiver_flow.receiver_actions) |action| {
                try self.c.step();
                if (action.block != @intFromEnum(block) or action.instruction != instruction) continue;
                try self.c.charge(2);
                if (receiver_flow.controls[action.normal_control]) try self.enqueue(normal);
                if (receiver_flow.controls[action.language_control]) try self.enqueue(language);
                return;
            }
            return error.InvalidShape;
        }
        self.unproved_receiver = true;
        if (self.include_unproved) {
            try self.enqueue(normal);
            try self.enqueue(language);
        }
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
                    inline .receiver_bind, .receiver_get, .receiver_result => |control|
                        try self.receiver(block, instruction, control.normal, control.language),
                    else => {}, // No other admitted Common opcode adds CFG edges/callees.
                }
            }
        }
    }
};

// Preconditions: same Context refs/layout/SSA/identity, fixed interfaces and
// checkCompatibility succeeded, then fixed.analyze independently derived this
// Flow for the SAME immutable Program. Effects supplies its same-Context
// receiver control proof after verifying the current body's fixed upper.
// Neither actual completion nor wire claims select receiver continuations.
//
// Every function, including initializers, starts at its entry. Reachability is
// the original upper-effect CFG: both conditional branches, all complete
// method/indirect callees, mayThrow language arms, and checked receiver arms.
// The result checks direct effective callee membership in BOTH directions;
// callee-transitive effects do not manufacture direct caller dependencies.
//
// Identity already owns original digest joins/order, and checkHostSites owns
// the all-instruction Host inventory. This pass does not repeat either. It
// does not prove body-effects containment, HSC/provenance, full publication,
// Source equivalence, borrow, execution or admission. In particular original
// mayThrow bounds still need the independent fixed-effects obligation.
pub fn checkCallees(c: *Context, flow: *const fixed.Flow, receiver_effects: []const ?*body_origins.ReceiverEffects) Error!void {
    try c.require(receiver_effects.len == c.program.functions.len);
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
        const receiver_flow = if (receiver_effects[index]) |effects| if (effects.proof) |*proof| &proof.flow else null else null;
        var walk = Walk{ .c = c, .function = @enumFromInt(index), .may_throw = may_throw, .visited = visited, .receiver_flow = receiver_flow };
        defer walk.deinit();
        try walk.run(flow);
        if (walk.unproved_receiver) {
            // Without receiver facts, omitting every unproved edge gives a
            // lower set and including them gives an upper set. The exact
            // dependency set is known only when these two results agree.
            const definite = walk.callees.count();
            try c.charge(visited.len);
            @memset(visited, false);
            walk.pending.clearRetainingCapacity();
            walk.include_unproved = true;
            try walk.run(flow);
            try c.require(walk.callees.count() == definite);
        }
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

const TestReceiverDependencies = struct {
    const origin: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 0 };
    const function_id: t.Hash = @splat(1);
    const callee_id: t.Hash = @splat(2);
    const callee_digest: t.Hash = @splat(3);
    const receiver = model.instruction.Instruction{ .source = origin, .result = null, .operands = &.{}, .data = .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } };
    const invoke = model.instruction.Instruction{ .source = origin, .result = null, .operands = &.{}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(3), .exceptional = @enumFromInt(2) } } };
    const indirect = model.instruction.Instruction{ .source = origin, .result = null, .operands = &.{}, .data = .{ .eh_invoke_indirect = .{ .callable = @enumFromInt(0), .normal = @enumFromInt(3), .exceptional = @enumFromInt(2) } } };
    const invoke_block = model.Block{ .parameters = &.{}, .instructions = &.{invoke} };
    const indirect_block = model.Block{ .parameters = &.{}, .instructions = &.{indirect} };
    const exit = model.instruction.Instruction{ .source = origin, .result = null, .operands = &.{}, .data = .@"return" };
    const block = model.Block{ .parameters = &.{}, .instructions = &.{exit} };
    const contract = contract: {
        var row = std.mem.zeroes(@typeInfo(@FieldType(@import("wire-program-publication.zig").Publication, "contracts")).pointer.child);
        row.function_id = callee_id;
        row.digest = callee_digest;
        break :contract row;
    };
    program: model.Program,
    functions: [2]model.Function,
    blocks: [4]model.Block,

    fn init(self: *TestReceiverDependencies, normal: model.Block, language: model.Block, claimed: bool) void {
        const prototype: model.Function = .{ .id = function_id, .signature = @splat(0), .abi = @enumFromInt(0),
            .source = @enumFromInt(0), .role = .ordinary, .declaration = .{ .start = 0, .end = 0 }, .name = "caller",
            .registers = &.{}, .blocks = &.{block} };
        self.blocks = .{ .{ .parameters = &.{}, .instructions = &.{receiver} }, normal, language, block };
        self.functions = .{ prototype, prototype };
        self.functions[0].blocks = &self.blocks;
        self.functions[1].id = callee_id;
        self.functions[1].name = "callee";
        var common = std.mem.zeroes(@import("wire-program-tables.zig").CommonTables);
        common.authority.fixed_publication.publication.contracts = &.{contract};
        common.authority.fixed_publication.dependencies = if (claimed)
            &.{ .{ .function_id = function_id, .callees = &.{.{ .function_id = callee_id, .digest = callee_digest }}, .hosts = &.{} },
                .{ .function_id = callee_id, .callees = &.{}, .hosts = &.{} } }
        else &.{ .{ .function_id = function_id, .callees = &.{}, .hosts = &.{} },
            .{ .function_id = callee_id, .callees = &.{}, .hosts = &.{} } };
        self.program = .{ .envelope = std.mem.zeroes(model.Envelope), .target = std.mem.zeroes(model.Target),
            .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0),
            .tables = .{ .sources = &.{}, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};

test "an unproved receiver continuation cannot erase a later call from the dependency check" {
    var fixture: TestReceiverDependencies = undefined;
    fixture.init(TestReceiverDependencies.invoke_block, TestReceiverDependencies.block, false);
    var c = Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidShape, checkCallees(&c, &.{}, &.{ null, null }));
}

// Literal control facts isolate dependency comparison from the receiver solver.
// No fabricated control facts enter the owning packet reader.
fn testReceiverArms(fixture: *TestReceiverDependencies, flow: *const fixed.Flow, controls: []const bool) Error!void {
    const origin = @import("wire-program-return-origin-model.zig");
    var c = Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var effects = body_origins.ReceiverEffects{
        .arena = std.heap.ArenaAllocator.init(c.allocator),
        .body = .{ .arena = std.heap.ArenaAllocator.init(c.allocator) },
        .proof = .{
            .flow = .{
                .graph = std.mem.zeroes(origin.Graph),
                .block_controls = &.{},
                .receiver_actions = &.{.{ .block = 0, .instruction = 0, .normal = 0, .language = 0, .normal_control = 0, .language_control = 1 }},
                .controls = controls,
                .action_results = &.{},
            },
            .fields = &.{},
            .initializations = &.{},
        },
    };
    defer effects.deinit();
    try checkCallees(&c, flow, &.{ &effects, null });
}

test "fixed dependency equality follows only proven receiver arms" {
    const F = TestReceiverDependencies;
    var fixture: F = undefined;
    fixture.init(F.invoke_block, F.block, true);
    try testReceiverArms(&fixture, &.{}, &.{ true, false });
    try std.testing.expectError(error.InvalidShape, testReceiverArms(&fixture, &.{}, &.{ false, true }));

    fixture.init(F.block, F.invoke_block, true);
    try testReceiverArms(&fixture, &.{}, &.{ false, true });
    try std.testing.expectError(error.InvalidShape, testReceiverArms(&fixture, &.{}, &.{ true, false }));

    fixture.init(F.block, F.invoke_block, false);
    try testReceiverArms(&fixture, &.{}, &.{ true, false });
    try std.testing.expectError(error.InvalidShape, testReceiverArms(&fixture, &.{}, &.{ false, true }));
}

test "a receiver arm consumes the independently established indirect occurrence" {
    const F = TestReceiverDependencies;
    var fixture: F = undefined;
    fixture.init(F.indirect_block, F.block, true);
    var flow = fixed.Flow{};
    defer flow.deinit(std.testing.allocator);
    const entry = try flow.sites.getOrPut(std.testing.allocator, .{ .function = @enumFromInt(0), .block = @enumFromInt(1), .instruction = 0 });
    entry.value_ptr.* = .{};
    try entry.value_ptr.functions.put(std.testing.allocator, @enumFromInt(1), {});
    try testReceiverArms(&fixture, &flow, &.{ true, false });
    try std.testing.expectError(error.InvalidShape, testReceiverArms(&fixture, &.{}, &.{ true, false }));
}
