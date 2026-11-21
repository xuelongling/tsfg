// SPDX-License-Identifier: MIT
// Pure typed Graph5/Directory interpretation. These cases neither admit Source
// nor grant allocation types, actual aliases, execution or fixed certificates.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const call_fixture = @import("constructor-call-literal-dto.zig");

const Meter = struct {
    remaining: usize = 100_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(raw));
        if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; }
        self.remaining -= count;
    }
    fn budget(self: *Meter) model.Budget { return .{ .context = self, .charge = charge }; }
};

// Leaf is a compatible descendant of Derived. No selected actual newTarget or
// leaf-only premise is supplied to either formal interpretation entry.
const directory: model.Directory = .{
    .types = &.{ .{ .id = "Base", .kind = .reference }, .{ .id = "Derived", .kind = .reference },
        .{ .id = "Leaf", .kind = .reference }, .{ .id = "Other", .kind = .reference },
        .{ .id = "bool", .kind = .scalar }, .{ .id = "i32", .kind = .scalar } },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{ "Derived", "bool" },
        .return_type = "Derived", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Derived", .owner = "Derived", .base = "Base", .receiver_index = 0 } }},
    .globals = &.{}, .environments = &.{}, .fields = &.{"value"},
    .constructions = &.{
        .{ .id = "construct:Base", .owner = "Base", .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "construct:Derived", .owner = "Derived", .base = "Base", .kind = .explicit, .function_id = "ctor" },
        .{ .id = "construct:Leaf", .owner = "Leaf", .base = "Derived", .kind = .implicit_derived, .function_id = null },
        .{ .id = "construct:Other", .owner = "Other", .base = null, .kind = .implicit_base, .function_id = null },
    },
};

// The complete topology comes from the real Source3 conditional-super packet's
// fixed constructor graph: nine Data rows, nine Heaps, eight Controls. Opaque
// names are shortened; no row or live normal/language prefix is discarded.
// The original own-field/token association is a Body boundary premise; this
// standalone symbolic directory intentionally grants no Source-field identity.
const Fixture = struct {
    nodes: [9]model.Value = .{
        .receiver_input,
        .{ .receiver_frame = .{ .construction = "construct:Base", .new_target = null, .parent = &.{0}, .site = "child", .control = 0 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 2 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 3 } },
        .{ .receiver_value = .{ .@"type" = "Derived", .action = 4 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
        .{ .literal = .{ .@"type" = "i32", .category = .other } },
        .{ .gate = .{ .@"type" = "i32", .inputs = &.{6}, .control = 3 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 7 } },
    },
    heaps: [9]model.Heap = .{
        .entry,
        .{ .join = .{ .inputs = &.{ 0, 8 } } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{1}, .action = .bind, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{}, .completion = .language } },
        .{ .store = .{ .previous = 3, .bases = &.{3}, .selector = "field:value", .view = "Base", .values = &.{7}, .control = 3, .initialize = true } },
        .{ .receiver_action = .{ .previous = 6, .control = 3, .frames = &.{1}, .action = .result, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 7, .control = 6, .frames = &.{0}, .action = .bind, .operands = &.{8}, .completion = .normal } },
    },
    controls: [8]model.Control = .{ .entry, .{ .join = .{ .inputs = &.{ 0, 7 } } },
        .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 3 } },
        .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } },
        .{ .receiver_completion = .{ .action = 7 } }, .{ .receiver_completion = .{ .action = 8 } } },

    fn graph(self: *const Fixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{4}, .language = &.{5}, .exits = .{ .normal = &.{.{ .heap = 4, .control = 4 }},
                .language = &.{.{ .heap = 5, .control = 5 }} }, .accesses = &.{} };
    }
};

fn analyze(fixture: *const Fixture, effects: bool) !domain.Analysis {
    const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &directory, &budget);
    const validation = try model.validateGraph(std.testing.allocator, &directory, "ctor", &graph, &budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    var result = if (effects) try domain.analyzeEffects(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" })
        else try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" });
    errdefer result.deinit();
    try std.testing.expect(meter.remaining > 0 and meter.remaining < 100_000);
    return result;
}

test "formal derived receiver keeps a child own-field write and both completion channels" {
    const fixture: Fixture = .{};
    var result = try analyze(&fixture, true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(@as(usize, 1), result.language.len);
    try std.testing.expect(result.normal[0].category == .object and result.normal[0].source == .allocation);
    try std.testing.expect(result.language[0].category == .object and result.language[0].source == .language_error);
    try std.testing.expectEqual(@as(usize, 1), result.normal[0].source.allocation);
    try std.testing.expectEqual(@as(usize, 5), result.language[0].source.language_error);
    try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
    const write = result.initializations[0];
    try std.testing.expect(write.base.source == .allocation and write.value.source == .node);
    try std.testing.expectEqual(@as(usize, 6), write.store);
    try std.testing.expectEqual(@as(usize, 1), write.base.source.allocation);
    try std.testing.expectEqual(@as(usize, 6), write.value.source.node);
    try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[0].new_target);
    try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[1].new_target);
    try std.testing.expectEqual(@as(?model.Ref, 0), result.frames[1].parent);
    try std.testing.expect(result.frames[1].construction != null);
    try std.testing.expectEqualStrings("construct:Base", result.frames[1].construction.?);
}

test "formal return interpretation preserves the same complete child protocol" {
    const fixture: Fixture = .{};
    var result = try analyze(&fixture, false); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
    try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[0].new_target);
    try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[1].new_target);
}

test "ordinary conditional super imports the exact child allocation and language result" {
    const fixture: Fixture = .{};
    const functions = [_]model.FunctionRow{.{
        .id = "create", .kind = .source, .parameter_types = &.{"bool"}, .return_type = "Derived",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null,
    }} ++ directory.functions[0..1].*;
    var catalog = directory;
    catalog.functions = &functions;
    // Literal model of the retained Source3 conditional-super-bool ``create``.
    // Data0 is its original bool ABI binding. Use the same fixed Derived graph
    // as the formal controls above and follow its two completions separately.
    const graph: model.Graph = .{
        .nodes = &.{
            .{ .parameter = .{ .@"type" = "bool", .index = 0 } },
            .{ .receiver_frame = .{ .construction = "construct:Derived", .new_target = "Derived", .parent = null, .site = "162:179", .control = 0 } },
            .{ .call = .{ .@"type" = "Derived", .call = 0, .completion = .normal } },
            .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
            .{ .copy = .{ .@"type" = "bool", .bases = &.{0}, .site = "174:178", .heap = 0, .control = 0 } },
            .{ .copy = .{ .@"type" = "Derived", .bases = &.{2}, .site = "155:180", .heap = 2, .control = 1 } },
        },
        .heaps = &.{
            .entry,
            .{ .copy = .{ .previous = 0, .value = 4 } },
            .{ .call = .{ .call = 0, .completion = .normal } },
            .{ .call = .{ .call = 0, .completion = .language } },
            .{ .copy = .{ .previous = 2, .value = 5 } },
        },
        .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } } },
        .calls = &.{.{ .function_id = "ctor", .arguments = &.{&.{4}}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 1, .control = 0, .site = "162:179" }},
        .normal = &.{5}, .language = &.{3}, .accesses = &.{},
        .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 3, .control = 2 }} },
    };
    var contracts = call_fixture.contracts;
    contracts[0].return_origins = fixture.graph();
    contracts[0].upper.parameters = &.{
        .{ .index = 0, .read = false, .write = true, .structural = false },
        .{ .index = 1, .read = false, .write = false, .structural = false },
    };
    contracts[0].upper.facets.may_throw = true;
    contracts[1].return_origins = graph;
    contracts[1].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
    contracts[1].upper.facets.may_throw = true;
    var declarations = call_fixture.declarations;
    declarations[0].decl_key.name = "Derived";
    declarations[0].construction.?.base = @splat(0x22);
    declarations[0].parameter_types = &.{ @splat(0x11), @splat(0x33) };
    declarations[1].construction = null;
    declarations[1].kind = .source;
    declarations[1].decl_key.kind = .function;
    declarations[1].decl_key.name = "create";
    declarations[1].return_type = declarations[0].return_type;
    declarations[1].parameter_types = &.{@splat(0x33)};
    const fixed = [_]domain.FixedFunction{
        .{ .function_id = "create", .contract = &contracts[1], .declaration = &declarations[1] },
        .{ .function_id = "ctor", .contract = &contracts[0], .declaration = &declarations[0], .initialization_fields = &.{} },
    };
    var meter: Meter = .{};
    var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &catalog, &budget);
    try std.testing.expectEqual(model.Pending.construction_frame, (try model.validateGraph(std.testing.allocator, &catalog, "create", &graph, &budget)).pending);
    try std.testing.expectEqual(model.Pending.construction_frame, (try model.validateGraph(std.testing.allocator, &catalog, "ctor", &contracts[0].return_origins.?, &budget)).pending);
    const input: domain.FormalInput = .{
        .function_id = "create", .fixed = &fixed,
        .ordinary = .{ .current = &graph, .upper = &contracts[1].return_origins.?, .types = &.{null}, .native_bool = "bool" },
    };
    var result = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, input);
    defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.calls.len);
    const fact = result.calls[0];
    try std.testing.expect(fact.caller_graph == &graph and fact.graph == &contracts[0].return_origins.?);
    try std.testing.expectEqual(@as(model.Ref, 1), fact.receiver);
    try std.testing.expectEqual(@as(model.Ref, 0), fact.input);
    try std.testing.expect(fact.arguments[1].len != 0);
    for (fact.arguments[1]) |argument| {
        try std.testing.expect(argument.source == .node);
        try std.testing.expectEqual(@as(model.Ref, 0), argument.source.node);
    }
    try std.testing.expectEqualStrings("Derived", result.frames[fact.receiver].new_target.?);
    try std.testing.expect(result.normal.len == 1 and result.normal[0].source == .scoped_allocation);
    const imported = result.normal[0].source.scoped_allocation;
    try std.testing.expect(imported.analysis == fact.analysis and imported.completion == .normal);
    try std.testing.expectEqual(@as(model.Ref, 1), imported.frame);
    try std.testing.expectEqual(@as(?model.Ref, fact.input), fact.analysis.frames[imported.frame].parent);
    try std.testing.expectEqual(@as(?model.Symbol, null), fact.analysis.frames[imported.frame].new_target);
    try std.testing.expect(result.language.len == 1 and result.language[0].source == .language_error);
    try std.testing.expectEqual(@as(model.Ref, 3), result.language[0].source.language_error);
    try std.testing.expectEqual(@as(model.Ref, 5), fact.analysis.language[0].source.language_error);

    const rows = [_]owners.Fixed{
        .{ .function_id = "create", .graph = &contracts[1].return_origins.?, .parameters = &.{.{}}, .captures = &.{}, .may_throw = true },
        .{ .function_id = "ctor", .graph = &contracts[0].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = true },
    };
    const fields: []const owners.Field = &.{.{ .id = "value", .view = "Base", .physical = 0, .type_id = "i32" }};
    const physical: []const owners.Physical = &.{ .{ .type_id = "Base", .fields = fields }, .{ .type_id = "Derived", .fields = fields } };
    var returned = try owners.analyzeReceiver(std.testing.allocator, &catalog, physical, "create", &graph, &rows, &budget, &result);
    defer returned.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), returned.pending);
    try std.testing.expect(returned.normal_live and returned.language_live);
    try std.testing.expectEqual(@as(usize, 1), returned.normal.len);
    try std.testing.expectEqual(@as(usize, 1), returned.language.len);
    const normal = returned.locations[returned.normal[0]];
    const language = returned.locations[returned.language[0]];
    try std.testing.expect(normal.kind == .root and normal.owner == .local and normal.scope != 0 and normal.node == imported.frame);
    try std.testing.expectEqualStrings("Derived", normal.type_id.?);
    try std.testing.expect(language.kind == .root and language.owner == .local and language.scope == 0 and language.node == 3 and language.type_id == null);
    try std.testing.expectEqualStrings("receiver-language-error", language.key.?);
    try std.testing.expectEqual(@as(usize, 1), returned.normal_heap.len);
    const field = returned.normal_heap[0];
    try std.testing.expectEqual(returned.normal[0], field.base);
    try std.testing.expectEqualStrings("field:value", field.selector);
    try std.testing.expectEqualStrings("Base", field.view);
    try std.testing.expectEqual(@as(usize, 0), returned.language_heap.len);
    try std.testing.expect(result.frames[fact.receiver].language.unbound);
    try std.testing.expectEqual(@as(usize, 0), result.frames[fact.receiver].language.atoms.len);

    var omitted_abi = input;
    omitted_abi.ordinary.?.native_bool = null;
    var unproved = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, omitted_abi);
    defer unproved.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), unproved.pending);

    // An apparent skip arm whose own heap can also contain the child's
    // initialization is no basis for partitioning the caller's language heap.
    var mixed_heaps = fixture.heaps ++ [_]model.Heap{.{ .join = .{ .inputs = &.{ 0, 8 } } }};
    mixed_heaps[1].join.inputs = &.{ 8, 9 };
    contracts[0].return_origins.?.heaps = &mixed_heaps;
    try std.testing.expectEqual(model.Pending.construction_frame, (try model.validateGraph(std.testing.allocator, &catalog, "ctor", &contracts[0].return_origins.?, &budget)).pending);
    var ambiguous = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, input);
    defer ambiguous.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_completion), ambiguous.pending);
}

test "a parent owns its own field only after binding the child's allocation" {
    const fixture: Fixture = .{};
    var graph = fixture.graph();
    const nodes = fixture.nodes ++ [_]model.Value{.{ .receiver_value = .{ .@"type" = "Derived", .action = 8 } }};
    var heaps = fixture.heaps ++ [_]model.Heap{.{ .store = .{
        .previous = 8, .bases = &.{9}, .selector = "field:own", .view = "Derived", .values = &.{6}, .control = 7, .initialize = true,
    } }};
    heaps[1].join.inputs = &.{ 0, 9 };
    heaps[4].receiver_action.previous = 9;
    heaps[4].receiver_action.control = 7;
    graph.nodes = &nodes;
    graph.heaps = &heaps;
    var catalog = directory;
    catalog.fields = &.{ "own", "value" };
    var meter: Meter = .{};
    var budget = meter.budget();
    var contract = call_fixture.contracts[0];
    contract.return_origins = graph;
    var declaration = call_fixture.declarations[0];
    declaration.decl_key.name = "Derived";
    declaration.construction.?.base = @splat(0x22);
    declaration.parameter_types = &.{ @splat(0x11), @splat(0x33) };
    const rows = [_]domain.FixedFunction{.{
        .function_id = "ctor", .contract = &contract, .declaration = &declaration, .initialization_fields = &.{"own"},
    }};
    const input: domain.FormalInput = .{ .function_id = "ctor", .fixed = &rows };
    try model.validateDirectory(std.testing.allocator, &catalog, &budget);
    try std.testing.expectEqual(model.Pending.construction_frame, (try model.validateGraph(std.testing.allocator, &catalog, "ctor", &graph, &budget)).pending);

    var result = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, input);
    defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    const exits = result.input_exits.?;
    try std.testing.expectEqual(@as(usize, 0), exits.normal.missing_fields.?.len);
    try std.testing.expectEqual(@as(usize, 1), exits.language.missing_fields.?.len);
    try std.testing.expectEqualStrings("own", exits.language.missing_fields.?[0]);
    try std.testing.expectEqual(@as(usize, 2), result.initializations.len);
    for (result.initializations) |write| {
        try std.testing.expect(write.base.source == .allocation and write.base.source.allocation == 1);
    }

    heaps[9].store.previous = 7;
    var before_parent_bind = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, input);
    defer before_parent_bind.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .scalar_initialization), before_parent_bind.pending);

    // A distinct allocation by the same base role shares the parent frame,
    // but was never bound to that parent.
    const distinct_nodes = nodes ++ [_]model.Value{
        .{ .receiver_frame = .{ .construction = "construct:Base", .new_target = null, .parent = &.{0}, .site = "other-child", .control = 7 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 10 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 11 } },
    };
    var distinct_heaps = heaps ++ [_]model.Heap{
        .{ .receiver_action = .{ .previous = 8, .control = 7, .frames = &.{10}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 10, .control = 7, .frames = &.{10}, .action = .bind, .operands = &.{11}, .completion = .normal } },
    };
    distinct_heaps[9].store.previous = 11;
    distinct_heaps[9].store.bases = &.{12};
    graph.nodes = &distinct_nodes;
    graph.heaps = &distinct_heaps;
    try std.testing.expectEqual(model.Pending.construction_frame, (try model.validateGraph(std.testing.allocator, &catalog, "ctor", &graph, &budget)).pending);
    var wrong_allocation = try domain.analyzeReturns(std.testing.allocator, &catalog, &graph, &budget, input);
    defer wrong_allocation.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .scalar_initialization), wrong_allocation.pending);
}

test "child completion alone never binds its parent" {
    var fixture: Fixture = .{};
    fixture.heaps[8] = .{ .join = .{ .inputs = &.{7} } };
    fixture.controls[7] = .{ .join = .{ .inputs = &.{6} } };
    var result = try analyze(&fixture, true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(!result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 0), result.normal.len);
    try std.testing.expectEqual(@as(usize, 1), result.language.len);
    try std.testing.expect(result.language[0].source == .language_error);
    try std.testing.expectEqual(@as(usize, 5), result.language[0].source.language_error);
    try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
}

test "a child allocation cannot initialize a different owner view" {
    var fixture: Fixture = .{}; fixture.heaps[6].store.view = "Derived";
    var result = try analyze(&fixture, true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .scalar_initialization), result.pending);
}

test "global availability of a bind result cannot replace binding in the input Heap" {
    var fixture: Fixture = .{}; fixture.heaps[6].store.previous = 2;
    var result = try analyze(&fixture, true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .scalar_initialization), result.pending);
}

test "the owning typed boundary rejects an unrelated implicit-base child" {
    var fixture: Fixture = .{}; fixture.nodes[1].receiver_frame.construction = "construct:Other";
    fixture.nodes[2].receiver_value.@"type" = "Other";
    fixture.nodes[3].receiver_value.@"type" = "Other";
    fixture.nodes[8].receiver_value.@"type" = "Other";
    fixture.heaps[6].store.view = "Other";
    const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &directory, &budget);
    try std.testing.expectError(error.InvalidGraph, model.validateGraph(std.testing.allocator, &directory, "ctor", &graph, &budget));
}

test "a derived result-only graph still lacks parent protocol coverage" {
    const nodes = [_]model.Value{ .receiver_input, .{ .parameter = .{ .@"type" = "bool", .index = 1 } },
        .{ .receiver_value = .{ .@"type" = "Derived", .action = 1 } }, .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{2}, .language = &.{3},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &directory, &budget);
    const validation = try model.validateGraph(std.testing.allocator, &directory, "ctor", &graph, &budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    var result = try domain.analyzeEffects(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .entry_state), result.pending);
}

test "unknown child field data remains Pending" {
    var fixture: Fixture = .{}; fixture.nodes[6] = .unknown;
    var result = try analyze(&fixture, true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), result.pending);
}

test "formal child interpretation cannot refill an exhausted checked budget" {
    const fixture: Fixture = .{}; const graph = fixture.graph();
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &directory, &budget);
    const validation = try model.validateGraph(std.testing.allocator, &directory, "ctor", &graph, &budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    meter.remaining = 0;
    try std.testing.expectError(error.BudgetExceeded, domain.analyzeEffects(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
}

// Keep the real protocol topology, then add the three impossible language
// completions which a complete normalized body retains alongside the genuine
// unbound-Derived result error. These are formal facts for all compatible
// targets and arbitrary Data parameters, not a selected boolean entrance.
const MixedLanguageFixture = struct {
    nodes: [16]model.Value = undefined,
    heaps: [13]model.Heap = undefined,
    controls: [11]model.Control = undefined,
    node_count: usize = 12,
    heap_count: usize = 12,
    language: []const model.Ref = &.{ 5, 9, 10, 11 },

    fn init(self: *MixedLanguageFixture) void {
        const core: Fixture = .{};
        @memcpy(self.nodes[0..9], &core.nodes);
        @memcpy(self.heaps[0..9], &core.heaps);
        @memcpy(self.controls[0..8], &core.controls);
        self.nodes[9] = .{ .receiver_value = .{ .@"type" = null, .action = 9 } };
        self.nodes[10] = .{ .receiver_value = .{ .@"type" = null, .action = 10 } };
        self.nodes[11] = .{ .receiver_value = .{ .@"type" = null, .action = 11 } };
        self.heaps[9] = .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{1}, .action = .bind, .operands = &.{2}, .completion = .language } };
        self.heaps[10] = .{ .receiver_action = .{ .previous = 6, .control = 3, .frames = &.{1}, .action = .result, .operands = &.{}, .completion = .language } };
        self.heaps[11] = .{ .receiver_action = .{ .previous = 7, .control = 6, .frames = &.{0}, .action = .bind, .operands = &.{8}, .completion = .language } };
        self.controls[8] = .{ .receiver_completion = .{ .action = 9 } };
        self.controls[9] = .{ .receiver_completion = .{ .action = 10 } };
        self.controls[10] = .{ .receiver_completion = .{ .action = 11 } };
    }
    fn graph(self: *const MixedLanguageFixture) model.Graph {
        return .{ .nodes = self.nodes[0..self.node_count], .heaps = self.heaps[0..self.heap_count], .controls = &self.controls, .calls = &.{},
            .normal = &.{4}, .language = self.language, .exits = .{ .normal = &.{.{ .heap = 4, .control = 4 }}, .language = &.{
                .{ .heap = 5, .control = 5 }, .{ .heap = 9, .control = 8 }, .{ .heap = 10, .control = 9 }, .{ .heap = 11, .control = 10 } } }, .accesses = &.{} };
    }
    fn analyze(self: *const MixedLanguageFixture, effects: bool) !domain.Analysis {
        const body = self.graph(); var meter: Meter = .{}; var budget = meter.budget();
        try model.validateDirectory(std.testing.allocator, &directory, &budget);
        const validation = try model.validateGraph(std.testing.allocator, &directory, "ctor", &body, &budget);
        try std.testing.expect(validation == .pending);
        try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
        var result = if (effects) try domain.analyzeEffects(std.testing.allocator, &directory, &body, &budget, .{ .function_id = "ctor" })
            else try domain.analyzeReturns(std.testing.allocator, &directory, &body, &budget, .{ .function_id = "ctor" });
        errdefer result.deinit();
        try std.testing.expect(meter.remaining > 0 and meter.remaining < 100_000);
        return result;
    }
};

test "complete language roots keep one real error and three impossible receiver completions" {
    var fixture: MixedLanguageFixture = .{}; fixture.init();
    for ([_]bool{ true, false }) |effects| {
        var result = try fixture.analyze(effects); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        try std.testing.expect(result.normal_live and result.language_live);
        try std.testing.expectEqual(@as(usize, 1), result.normal.len);
        try std.testing.expectEqual(@as(usize, 1), result.language.len);
        try std.testing.expectEqual(@as(model.Ref, 5), result.language[0].source.language_error);
        try std.testing.expect(result.controls[5] and !result.controls[8] and !result.controls[9] and !result.controls[10]);
        try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
        try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[0].new_target);
        try std.testing.expectEqual(@as(?model.Symbol, null), result.frames[1].new_target);
    }
}

test "all inputs of transparent join copy and gate must prove inactive language" {
    var fixture: MixedLanguageFixture = .{}; fixture.init();
    fixture.nodes[12] = .{ .join = .{ .@"type" = null, .inputs = &.{ 9, 10, 11 } } };
    fixture.nodes[13] = .{ .copy = .{ .@"type" = "i32", .bases = &.{12}, .site = "dead-language-copy", .heap = 9, .control = 8 } };
    fixture.nodes[14] = .{ .gate = .{ .@"type" = null, .inputs = &.{13}, .control = 8 } };
    fixture.node_count = 15; fixture.language = &.{ 5, 14 };
    var result = try fixture.analyze(true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expectEqual(@as(usize, 1), result.language.len);
    try std.testing.expectEqual(@as(model.Ref, 5), result.language[0].source.language_error);
    try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
}

test "empty data wrappers stay unknown beside a genuine live language error" {
    const empty = [_]model.Value{
        .{ .join = .{ .@"type" = null, .inputs = &.{} } },
        .{ .gate = .{ .@"type" = null, .inputs = &.{}, .control = 0 } },
        .{ .copy = .{ .@"type" = "i32", .bases = &.{}, .site = "empty-copy", .heap = 0, .control = 0 } },
    };
    for (empty) |node| {
        var fixture: MixedLanguageFixture = .{}; fixture.init();
        fixture.nodes[12] = node; fixture.node_count = 13; fixture.language = &.{ 5, 12 };
        var result = try fixture.analyze(true); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), result.pending);
    }
}

test "a cyclic language equation stays unknown even with an inactive alternative" {
    var fixture: MixedLanguageFixture = .{}; fixture.init();
    fixture.nodes[12] = .{ .join = .{ .@"type" = null, .inputs = &.{ 9, 13 } } };
    fixture.nodes[13] = .{ .gate = .{ .@"type" = null, .inputs = &.{12}, .control = 0 } };
    fixture.node_count = 14; fixture.language = &.{ 5, 12 };
    var result = try fixture.analyze(true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), result.pending);
}

test "active receiver action with an unresolved frame is not an inactive completion" {
    var fixture: MixedLanguageFixture = .{}; fixture.init();
    fixture.nodes[12] = .{ .gate = .{ .@"type" = null, .inputs = &.{1}, .control = 8 } };
    fixture.nodes[13] = .{ .receiver_value = .{ .@"type" = null, .action = 12 } };
    fixture.heaps[12] = .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{12}, .action = .get, .operands = &.{}, .completion = .language } };
    fixture.node_count = 14; fixture.heap_count = 13; fixture.language = &.{ 5, 13 };
    var result = try fixture.analyze(true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), result.pending);
}

test "a live channel cannot lose its entire declared data root vector" {
    var fixture: MixedLanguageFixture = .{}; fixture.init(); fixture.language = &.{ 9, 10, 11 };
    var result = try fixture.analyze(true); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), result.pending);
}
