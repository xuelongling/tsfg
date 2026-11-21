// SPDX-License-Identifier: MIT
// Handwritten passive formal metadata only; no Source/VM/Actual entrance.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const inclusion = @import("wire-program-return-origins.zig");
const dto = @import("constructor-initialized-ref-dto.zig");
const Meter = struct {
    left: usize = 100000000,
    spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [3]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.native_callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{dto.native_field} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [3]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = false },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.a, .fields = &.{.{ .id = dto.native_field, .view = dto.a, .physical = 0, .type_id = dto.scalar }} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.a }} },
};
fn validate(graph: *const m.Graph, contracts: *const @TypeOf(dto.contracts), budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
    for (contracts, dto.directory.functions) |*contract, function| {
        const result = try m.validateGraph(std.testing.allocator, &dto.directory, function.id, &contract.return_origins.?, budget);
        try std.testing.expect(result == .pending and result.pending == .construction_frame);
    }
}
test "initialized Ref constructor rejects unknown ordinary Ref and missing original inventory" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    for ([_]m.Value{ .unknown, .{ .nonowning = .{ .@"type" = dto.a } } }) |argument| {
        var nodes = dto.caller_graph.nodes[0..9].*; nodes[2] = argument;
        var graph = dto.caller_graph; graph.nodes = &nodes; try validate(&graph, &dto.contracts, &budget);
        const fixed = fixedRows(&dto.contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, if (argument == .unknown) .unknown_origin else .data_protocol), result.pending);
    }
    try validate(&dto.caller_graph, &dto.contracts, &budget);
    var fixed = fixedRows(&dto.contracts); fixed[1].initialization_fields = null;
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}
test "initialized Ref constructor requires native field on every original predecessor" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    for (0..2) |variant| {
        var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.native_leaf.heaps);
        heaps[5] = .{ .join = .{ .inputs = &.{ 2, 3 } } };
        // Both cases retain the real store and its MAY prefix write. Neither
        // grants initialization on all exits: one skips it, one joins paths.
        heaps[4].receiver_action.previous = if (variant == 0) 2 else 5;
        var native = dto.native_leaf; native.heaps = &heaps;
        var contracts = dto.contracts; contracts[1].return_origins = native;
        try validate(&dto.caller_graph, &contracts, &budget); const fixed = fixedRows(&contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
    }
}
test "initialized Ref constructor rejects a late unbound predecessor after cached child" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var heaps: [16]m.Heap = undefined; @memcpy(heaps[0..7], dto.caller_graph.heaps);
    heaps[7] = .{ .join = .{ .inputs = &.{ 1, 8 } } };
    heaps[8] = .{ .join = .{ .inputs = &.{9} } }; heaps[9] = .{ .join = .{ .inputs = &.{10} } };
    heaps[10] = .{ .join = .{ .inputs = &.{11} } }; heaps[11] = .{ .join = .{ .inputs = &.{12} } };
    heaps[12] = .{ .join = .{ .inputs = &.{13} } }; heaps[13] = .{ .join = .{ .inputs = &.{14} } };
    heaps[14] = .{ .join = .{ .inputs = &.{15} } }; heaps[15] = .{ .join = .{ .inputs = &.{0} } };
    var calls = dto.caller_graph.calls[0..2].*; calls[1].heap = 7;
    var graph = dto.caller_graph; graph.heaps = &heaps; graph.calls = &calls;
    try validate(&graph, &dto.contracts, &budget); const fixed = fixedRows(&dto.contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}
test "initialized Ref constructor preserves every parameter upper flag and order" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.caller_graph, &dto.contracts, &budget);
    const fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    for (0..2) |parameter| for (0..3) |flag| {
        var flags = [_]owners.Flags{ .{ .write = true }, .{} };
        switch (flag) { 0 => flags[parameter].read = !flags[parameter].read, 1 => flags[parameter].write = !flags[parameter].write, 2 => flags[parameter].structural = !flags[parameter].structural, else => unreachable }
        var rows = ownerRows(&dto.contracts); rows[2].parameters = &flags;
        var result = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver); defer result.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), result.pending);
    };
    for (0..3) |variant| {
        var contracts = dto.contracts; var parameters = dto.scalar_full.parameters[0..2].*;
        switch (variant) { 0 => contracts[2].upper.parameters = parameters[0..1], 1 => { parameters[1].index = 0; contracts[2].upper.parameters = &parameters; }, 2 => { std.mem.swap(@TypeOf(parameters[0]), &parameters[0], &parameters[1]); contracts[2].upper.parameters = &parameters; }, else => unreachable }
        const rows = fixedRows(&contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .fixed_contract), result.pending);
    }
}
test "initialized Ref constructor charges the original budget through owners" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.caller_graph, &dto.contracts, &budget);
    const fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending); try std.testing.expect(meter.spent > 0);
    meter.left = 0; const rows = ownerRows(&dto.contracts);
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver));
}

test "ordinary Ref parameter survives an ordered Box argument and own field projection" {
    var functions = dto.directory.functions[0..3].*;
    functions[0].kind = .source;
    functions[0].parameter_types = &.{dto.a};
    functions[0].return_type = dto.a;
    functions[0].construction = null;
    var constructions = dto.directory.constructions[0..3].*;
    constructions[0].kind = .implicit_base;
    constructions[0].function_id = null;
    var directory = dto.directory;
    directory.functions = &functions;
    directory.constructions = &constructions;

    const graph: m.Graph = .{
        .nodes = &.{
            .{ .parameter = .{ .@"type" = dto.a, .index = 0 } },
            .{ .receiver_frame = .{ .construction = dto.role_b, .new_target = dto.b, .parent = null, .site = "pass:new-Box", .control = 0 } },
            .{ .copy = .{ .@"type" = dto.a, .bases = &.{0}, .site = "pass:argument", .heap = 0, .control = 0 } },
            .{ .call = .{ .@"type" = dto.b, .call = 0, .completion = .normal } },
            .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
            .{ .projection = .{ .@"type" = dto.a, .bases = &.{3}, .selector = "field:" ++ dto.field, .view = dto.b, .heap = 2, .control = 1 } },
            .{ .copy = .{ .@"type" = dto.a, .bases = &.{5}, .site = "pass:return", .heap = 2, .control = 1 } },
        },
        .heaps = &.{
            .entry, .{ .copy = .{ .previous = 0, .value = 2 } },
            .{ .call = .{ .call = 0, .completion = .normal } },
            .{ .call = .{ .call = 0, .completion = .language } },
            .{ .copy = .{ .previous = 2, .value = 6 } },
        },
        .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } } },
        .calls = &.{.{ .function_id = dto.callee, .arguments = &.{&.{2}}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 1, .control = 0, .site = "pass:construct-Box" }},
        .normal = &.{6},
        .language = &.{4},
        .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 3, .control = 2 }} },
        .accesses = &.{.{ .values = &.{3}, .flag = .read, .control = 1 }},
    };
    var declarations = dto.declarations;
    declarations[0].kind = .source;
    declarations[0].decl_key.kind = .function;
    declarations[0].decl_key.name = "pass";
    declarations[0].parameter_types = &.{@splat(0x11)};
    declarations[0].return_type = @splat(0x11);
    declarations[0].construction = null;
    var contracts = dto.contracts;
    var published_nodes = graph.nodes[0..7].*;
    published_nodes[1].receiver_frame.site = "published:new-Box";
    published_nodes[2].copy.site = "published:argument";
    published_nodes[6].copy.site = "published:return";
    var published = graph;
    published.nodes = &published_nodes;
    contracts[0].return_origins = published;
    contracts[0].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
    var rows = fixedRows(&contracts);
    rows[0].declaration = &declarations[0];

    var meter: Meter = .{};
    var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &directory, &budget);
    for ([_]struct { m.Symbol, *const m.Graph }{
        .{ dto.caller, &graph }, .{ dto.callee, &contracts[2].return_origins.? },
    }) |row| {
        const checked = try m.validateGraph(std.testing.allocator, &directory, row[0], row[1], &budget);
        try std.testing.expect(checked == .pending and checked.pending == .construction_frame);
    }
    const evidence = domain.OrdinaryReferenceInputs{ .current = &graph, .upper = &contracts[0].return_origins.?, .types = &.{dto.a} };
    const bounds = [_]inclusion.FixedContract{
        .{ .function_id = dto.caller, .graph = evidence.upper, .complete = &rows[0] },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .complete = &rows[1] },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .complete = &rows[2] },
    };
    const without = try inclusion.covered(std.testing.allocator, &directory, dto.caller, &graph, &bounds, &budget);
    try std.testing.expect(without == .pending and without.pending == .receiver_no_exact_certificate);
    try std.testing.expect((try inclusion.coveredWithEvidence(std.testing.allocator, &directory, dto.caller, &graph, &bounds, &budget, .{ .ordinary = evidence })) == .covered);
    for ([_]*const m.Graph{ &graph, evidence.upper }) |candidate| {
        var result = try domain.analyzeReturns(std.testing.allocator, &directory, candidate, &budget, .{ .function_id = dto.caller, .fixed = &rows, .ordinary = evidence });
        defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        try std.testing.expect(result.normal_live and !result.language_live);
        try std.testing.expect(result.heap_live[4] and !result.heap_live[3]);
        try std.testing.expectEqual(@as(usize, 1), result.calls.len);
        const call = result.calls[0];
        try std.testing.expect(call.caller_graph == candidate);
        try std.testing.expectEqual(@as(usize, 2), call.arguments.len);
        try std.testing.expectEqual(@as(usize, 0), call.arguments[0].len);
        try std.testing.expectEqual(@as(usize, 1), call.arguments[1].len);
        const argument = call.arguments[1][0];
        try std.testing.expect(argument.source == .node and argument.source.node == 0 and argument.category == .object);
        const write = call.analysis.initializations[0];
        try std.testing.expect(write.value.source == .node and write.value.source.node == 3 and write.value.category == .object);
        var upper = ownerRows(&contracts);
        upper[0].parameters = &.{.{}};
        const initial = owners.Initial{
            .locations = &.{ .{ .kind = .root, .owner = .{ .input = 0 } }, .{ .kind = .root, .owner = .{ .input = 1 } } },
            .arguments = &.{&.{1}}, .environment = &.{}, .heap = &.{}, .parents = &.{},
        };
        var returned = try owners.analyzeInputs(std.testing.allocator, &directory, &physical, dto.caller, candidate, &upper, &budget, &result, &initial);
        defer returned.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, null), returned.pending);
        try std.testing.expect(returned.normal_live and !returned.language_live);
        try std.testing.expectEqual(@as(usize, 1), returned.normal.len);
        const original = returned.locations[returned.normal[0]];
        try std.testing.expect(original.kind == .root and original.owner == .input and original.owner.input == 1);
        try std.testing.expect(original.type_id == null);
    }
    for ([_]?domain.OrdinaryReferenceInputs{
        null,
        .{ .current = &dto.caller_graph, .upper = evidence.upper, .types = evidence.types },
        .{ .current = &graph, .upper = &dto.caller_graph, .types = evidence.types },
        .{ .current = &graph, .upper = evidence.upper, .types = &.{dto.b} },
    }) |unbound| {
        var result = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &rows, .ordinary = unbound });
        defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .entry_state), result.pending);
    }
    const extra = graph.nodes[0..7].* ++ [_]m.Value{.{ .join = .{ .@"type" = dto.a, .inputs = &.{ 0, 2 } } }};
    for ([_]m.Ref{ 0, 7 }) |argument| {
        const refs = [_]m.Ref{argument};
        const arguments = [_][]const m.Ref{&refs};
        var calls = graph.calls[0..1].*;
        calls[0].arguments = &arguments;
        var uncommitted = graph;
        uncommitted.nodes = &extra;
        uncommitted.calls = &calls;
        var proof = evidence;
        proof.current = &uncommitted;
        var rejected = try domain.analyzeReturns(std.testing.allocator, &directory, &uncommitted, &budget, .{ .function_id = dto.caller, .fixed = &rows, .ordinary = proof });
        defer rejected.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), rejected.pending);
    }
    var formal_parameters = dto.scalar_full.parameters[0..2].*;
    formal_parameters[1].read = true;
    contracts[2].upper.parameters = &formal_parameters;
    var forbidden = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &rows, .ordinary = evidence });
    defer forbidden.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_contract), forbidden.pending);
}
