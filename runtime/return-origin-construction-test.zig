// SPDX-License-Identifier: MIT
// Pure symbolic Graph5 equations. The only non-std imports are Domain/model.
// No Program, Context, bytecode, loader, VM, execution State or instruction.
// Toy symbols and Entry.scalar_fields are explicit caller-proof ASSUMPTIONS
// of these Domain tests, never Source/Field/permission admission evidence.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");

const Meter = struct {
    remaining: usize = 100_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(raw));
        if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; }
        self.remaining -= count;
    }
    fn budget(self: *Meter) model.Budget { return .{ .context = self, .charge = charge }; }
};

// Every Domain call below uses these existing owning-model checks with that
// same cumulative model budget. Construction-frame Pending is the admitted
// typed protocol result; malformed references/carriers fail here as errors.
fn expectTypedFixture(catalog: *const model.Directory, graph: *const model.Graph, budget: *model.Budget) !void {
    try model.validateDirectory(std.testing.allocator, catalog, budget);
    const validation = try model.validateGraph(std.testing.allocator, catalog, "ctor", graph, budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
}

const directory = model.Directory{
    .types = &.{
        .{ .id = "Box", .kind = .reference },
        .{ .id = "i32", .kind = .scalar },
        .{ .id = "string", .kind = .string },
        .{ .id = "undefined", .kind = .@"undefined" },
    },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{"Box"}, .return_type = "Box",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Box", .owner = "Box", .base = null, .receiver_index = 0 } }},
    .constructions = &.{.{ .id = "construct:Box", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" }},
    .fields = &.{"value"}, .globals = &.{}, .environments = &.{},
};
const proved_entry = domain.Entry{ .function_id = "ctor", .construction = "construct:Box", .new_target = "Box", .scalar_fields = &.{"value"} };

// Allocate root input -> bind that same Data allocation -> scalar initialize
// -> constructor fallback result. Exact expected identities are literal below.
const Fixture = struct {
    nodes: [8]model.Value = .{
        .receiver_input,
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .literal = .{ .@"type" = "i32", .category = .other } },
        .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 4 } },
        .{ .local = .{ .@"type" = "Box" } },
        .{ .literal = .{ .@"type" = "string", .category = .other } },
    },
    heaps: [5]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .store = .{ .previous = 2, .control = 2, .bases = &.{2}, .selector = "field:value", .view = "Box", .values = &.{3}, .initialize = true } },
        .{ .receiver_action = .{ .previous = 3, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{4}, .completion = .normal } },
    },
    controls: [4]model.Control = .{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 4 } } },
    fn graph(self: *const Fixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{}, .normal = &.{5}, .language = &.{},
            .exits = .{ .normal = &.{.{ .heap = 4, .control = 3 }}, .language = &.{} }, .accesses = &.{} };
    }
};

fn expectStored(result: *const domain.Analysis) !void {
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expectEqual(@as(usize, 1), result.initializations.len);
    const row = result.initializations[0];
    try std.testing.expectEqual(@as(usize, 3), row.store);
    try std.testing.expectEqual(domain.Category.object, row.base.category);
    try std.testing.expect(row.base.source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), row.base.source.allocation);
    try std.testing.expectEqual(domain.Category.other, row.value.category);
    try std.testing.expect(row.value.source == .node);
    try std.testing.expectEqual(@as(usize, 3), row.value.source.node);
}
fn expectPending(fixture: *const Fixture, entry: ?domain.Entry, pending: domain.Pending) !void {
    var meter: Meter = .{}; var budget = meter.budget(); const graph = fixture.graph();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, entry); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, pending), result.pending);
}

test "proved native initialization retains the bound Data and normal result" {
    const fixture: Fixture = .{}; const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, proved_entry); defer result.deinit();
    try expectStored(&result);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), result.normal[0].source.allocation);
}

test "a language-only exit preserves its earlier native initialization" {
    const fixture: Fixture = .{}; var graph = fixture.graph();
    graph.normal = &.{}; graph.language = &.{3}; graph.exits = .{ .normal = &.{}, .language = &.{.{ .heap = 3, .control = 2 }} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, proved_entry); defer result.deinit();
    try expectStored(&result);
    try std.testing.expect(!result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.language.len);
    try std.testing.expectEqual(domain.Category.other, result.language[0].category);
    try std.testing.expect(result.language[0].source == .node);
    try std.testing.expectEqual(@as(usize, 3), result.language[0].source.node);
}

test "a nonterminating join cycle preserves the live store prefix without an exit" {
    var fixture: Fixture = .{};
    fixture.nodes[5] = .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } };
    fixture.heaps[4] = .{ .join = .{ .inputs = &.{ 3, 4 } } };
    fixture.controls[3] = .{ .join = .{ .inputs = &.{ 2, 3 } } };
    var graph = fixture.graph(); graph.normal = &.{}; graph.exits.normal = &.{};
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, proved_entry); defer result.deinit();
    try expectStored(&result);
    try std.testing.expect(!result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 0), result.normal.len);
    try std.testing.expectEqual(@as(usize, 0), result.language.len);
}

test "native literal provenance crosses a seeded cyclic join and a live gate" {
    var fixture: Fixture = .{};
    fixture.nodes[6] = .{ .join = .{ .@"type" = "i32", .inputs = &.{ 3, 6 } } };
    fixture.nodes[7] = .{ .gate = .{ .@"type" = "i32", .inputs = &.{6}, .control = 2 } };
    fixture.heaps[3].store.values = &.{7};
    const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, proved_entry); defer result.deinit();
    try expectStored(&result);
    try std.testing.expect(result.normal_live);
}

test "wrong or mixed Data bases are not a proof of the bound receiver" {
    var fixture: Fixture = .{}; fixture.heaps[3].store.bases = &.{6};
    try expectPending(&fixture, proved_entry, .scalar_initialization);
    fixture.heaps[3].store.bases = &.{ 2, 6 };
    try expectPending(&fixture, proved_entry, .scalar_initialization);
}

test "unbound and joined bound-unbound worlds cannot initialize a receiver" {
    var fixture: Fixture = .{};
    fixture.heaps[3].store.previous = 1; fixture.heaps[3].store.control = 1; fixture.heaps[3].store.bases = &.{1};
    try expectPending(&fixture, proved_entry, .scalar_initialization);
    fixture = .{};
    fixture.nodes[5] = .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } };
    fixture.heaps[4] = .{ .join = .{ .inputs = &.{ 1, 2 } } };
    fixture.controls[3] = .{ .join = .{ .inputs = &.{2} } };
    fixture.heaps[3].store.previous = 4;
    try expectPending(&fixture, proved_entry, .scalar_initialization);
}

test "absent entry or scalar-field proof grants no initialization authority" {
    const fixture: Fixture = .{};
    try expectPending(&fixture, null, .entry_state);
    var unproved = proved_entry; unproved.scalar_fields = &.{};
    try expectPending(&fixture, unproved, .scalar_initialization);
}

test "undefined string object unknown and mixed payloads remain unavailable" {
    var fixture: Fixture = .{};
    fixture.heaps[3].store.values = &.{4}; try expectPending(&fixture, proved_entry, .scalar_initialization);
    fixture.heaps[3].store.values = &.{7}; try expectPending(&fixture, proved_entry, .scalar_initialization);
    fixture.heaps[3].store.values = &.{6}; try expectPending(&fixture, proved_entry, .scalar_initialization);
    fixture = .{}; fixture.nodes[3] = .unknown; try expectPending(&fixture, proved_entry, .unknown_origin);
    fixture = .{}; fixture.nodes[7] = .{ .join = .{ .@"type" = "i32", .inputs = &.{ 3, 4 } } }; fixture.heaps[3].store.values = &.{7};
    try expectPending(&fixture, proved_entry, .scalar_initialization);
}

const ControlFixture = struct {
    nodes: [8]model.Value = .{
        .receiver_input,
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 4 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 3 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
        .{ .join = .{ .@"type" = "Box", .inputs = &.{5, 6} } },
    },
    heaps: [6]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .language } },
        .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{3}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{3}, .completion = .language } },
    },
    controls: [6]model.Control = .{ .entry,
        .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } },
        .{ .receiver_completion = .{ .action = 3 } }, .{ .receiver_completion = .{ .action = 4 } },
        .{ .receiver_completion = .{ .action = 5 } } },
    fn graph(self: *const ControlFixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{4}, .language = &.{7},
            .exits = .{ .normal = &.{.{ .heap = 4, .control = 4 }}, .language = &.{ .{ .heap = 3, .control = 3 }, .{ .heap = 5, .control = 5 } } },
            .accesses = &.{} };
    }
};
fn checkControls(fixture: *const ControlFixture, normal: bool, language: bool) !void {
    const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expectEqual(normal, result.normal_live);
    try std.testing.expectEqual(language, result.language_live);
    try std.testing.expectEqual(@as(usize, 0), result.initializations.len);
    try std.testing.expectEqual(@as(usize, 6), result.controls.len);
    try std.testing.expectEqual(@as(usize, 6), result.action_results.len);
}
test "formal allocation bind and undefined result do not invent a language edge" {
    const fixture: ControlFixture = .{}; try checkControls(&fixture, true, false);
}
test "formal get before binding retains its language edge" {
    var fixture: ControlFixture = .{};
    fixture.heaps[2].receiver_action.action = .get; fixture.heaps[2].receiver_action.operands = &.{};
    fixture.heaps[3].receiver_action.action = .get; fixture.heaps[3].receiver_action.operands = &.{};
    try checkControls(&fixture, false, true);
}
test "formal double binding retains its language edge" {
    var fixture: ControlFixture = .{};
    fixture.heaps[4].receiver_action.action = .bind; fixture.heaps[4].receiver_action.operands = &.{1};
    fixture.heaps[5].receiver_action.action = .bind; fixture.heaps[5].receiver_action.operands = &.{1};
    try checkControls(&fixture, false, true);
}
test "formal unbound undefined result retains its language edge" {
    var fixture: ControlFixture = .{};
    fixture.heaps[2].receiver_action.action = .result; fixture.heaps[2].receiver_action.operands = &.{3};
    fixture.heaps[3].receiver_action.action = .result; fixture.heaps[3].receiver_action.operands = &.{3};
    try checkControls(&fixture, false, true);
}
test "formal unknown result retains both object and nonobject completions" {
    const nodes = [_]model.Value{ .receiver_input, .unknown,
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{2}, .language = &.{3},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expect(result.controls[1] and result.controls[2]);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expectEqual(@as(usize, 0), result.initializations.len);
}

test "formal copies preserve categories without allocation or alias provenance" {
    var nodes = [_]model.Value{ .receiver_input, .unknown,
        .{ .copy = .{ .@"type" = "Box", .bases = &.{1}, .site = "copy", .heap = 0, .control = 0 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{3}, .language = &.{4},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expect(result.normal[0].source == .node);
    try std.testing.expectEqual(@as(usize, 2), result.normal[0].source.node);
    try std.testing.expectEqual(@as(usize, 0), result.initializations.len);
    // A known copied object still cannot pass the stronger original certificate boundary.
    nodes[1] = .{ .local = .{ .@"type" = "Box" } };
    var certificate_meter: Meter = .{}; var certificate_budget = certificate_meter.budget();
    try expectTypedFixture(&directory, &graph, &certificate_budget);
    var certificate = try domain.analyze(std.testing.allocator, &directory, &graph, &certificate_budget, proved_entry); defer certificate.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), certificate.pending);
}


// Effect-origin domain regressions. Array/Span annotations below are lexical
// protocol names, never actual tags or physical-capacity/holding evidence.
const effect_directory = model.Directory{
    .types = &.{
        .{ .id = "Array", .kind = .array },
        .{ .id = "Base", .kind = .reference },
        .{ .id = "Box", .kind = .reference },
        .{ .id = "LocalValue", .kind = .value },
        .{ .id = "Span", .kind = .read_span },
        .{ .id = "i32", .kind = .scalar },
        .{ .id = "undefined", .kind = .@"undefined" },
    },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{ "Box", "Array", "Span" }, .return_type = "Box",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Box", .owner = "Box", .base = null, .receiver_index = 0 } }},
    .constructions = &.{
        .{ .id = "construct:Base", .owner = "Base", .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "construct:Box", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" },
        .{ .id = "construct:LocalValue", .owner = "LocalValue", .base = null, .kind = .implicit_base, .function_id = null },
    },
    .fields = &.{ "owner", "span" }, .globals = &.{}, .environments = &.{},
};

// A constructor receives two arbitrary Data parameters, transports their
// conditional owners through Cell-like joins and copy, and initializes two
// real fields on its allocated/bound receiver. These are symbolic equations,
// not Source/SSA validation or an actual allocation/alias/holding certificate.
const EffectFixture = struct {
    nodes: [14]model.Value = .{
        .receiver_input,
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
        .{ .parameter = .{ .@"type" = "Span", .index = 2 } },
        .{ .join = .{ .@"type" = "Array", .inputs = &.{3} } },
        .{ .gate = .{ .@"type" = "Array", .inputs = &.{5}, .control = 2 } },
        .{ .copy = .{ .@"type" = "Array", .bases = &.{6}, .site = "copy-owner", .heap = 2, .control = 2 } },
        .{ .join = .{ .@"type" = "Span", .inputs = &.{4} } },
        .{ .gate = .{ .@"type" = "Span", .inputs = &.{8}, .control = 2 } },
        .{ .copy = .{ .@"type" = "Span", .bases = &.{9}, .site = "copy-span", .heap = 3, .control = 2 } },
        .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 5 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 6 } },
    },
    heaps: [7]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .store = .{ .previous = 2, .control = 2, .bases = &.{2}, .selector = "field:owner", .view = "Box", .values = &.{7}, .initialize = true } },
        .{ .store = .{ .previous = 3, .control = 2, .bases = &.{2}, .selector = "field:span", .view = "Box", .values = &.{10}, .initialize = true } },
        .{ .receiver_action = .{ .previous = 4, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{11}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 4, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{11}, .completion = .language } },
    },
    controls: [5]model.Control = .{ .entry,
        .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } },
        .{ .receiver_completion = .{ .action = 5 } }, .{ .receiver_completion = .{ .action = 6 } } },
    fn graph(self: *const EffectFixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{}, .normal = &.{12}, .language = &.{13},
            .exits = .{ .normal = &.{.{ .heap = 5, .control = 3 }}, .language = &.{.{ .heap = 6, .control = 4 }} }, .accesses = &.{} };
    }
};

fn expectEffectFields(result: *const domain.Analysis, graph: *const model.Graph) !void {
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    // All three actual-category possibilities of both formal payloads survive
    // their Array/Span views, Cells and copies. Neither payload becomes fresh.
    try std.testing.expectEqual(@as(usize, 6), result.initializations.len);
    var owner_categories: u3 = 0; var span_categories: u3 = 0;
    for (result.initializations) |write| {
        try std.testing.expectEqual(domain.Category.object, write.base.category);
        try std.testing.expect(write.base.source == .allocation);
        try std.testing.expectEqual(@as(usize, 0), write.base.source.allocation);
        try std.testing.expect(write.value.source == .node);
        const bit: u3 = switch (write.value.category) { .object => 1, .@"undefined" => 2, .other => 4 };
        try std.testing.expect(write.store == 3 or write.store == 4);
        const stored = graph.heaps[write.store].store;
        try std.testing.expectEqualStrings("Box", stored.view);
        if (write.store == 3) {
            try std.testing.expectEqualStrings("field:owner", stored.selector);
            try std.testing.expectEqual(@as(usize, 3), write.value.source.node);
            owner_categories |= bit;
        } else {
            try std.testing.expectEqualStrings("field:span", stored.selector);
            try std.testing.expectEqual(@as(usize, 4), write.value.source.node);
            span_categories |= bit;
        }
    }
    try std.testing.expectEqual(@as(u3, 7), owner_categories);
    try std.testing.expectEqual(@as(u3, 7), span_categories);
}
fn expectEffectPending(graph: *const model.Graph, catalog: *const model.Directory, pending: domain.Pending) !void {
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(catalog, graph, &budget);
    var result = try domain.analyzeEffects(std.testing.allocator, catalog, graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, pending), result.pending);
}

test "effect formal copy retains a conditional owner without converting its declared category" {
    for ([_][]const u8{ "Array", "Span" }, 1..) |view, parameter| {
        const nodes = [_]model.Value{ .receiver_input,
            .{ .parameter = .{ .@"type" = view, .index = parameter } },
            .{ .copy = .{ .@"type" = view, .bases = &.{1}, .site = "formal-copy", .heap = 0, .control = 0 } },
            .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
            .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
        const heaps = [_]model.Heap{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } } };
        const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
        const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{3}, .language = &.{4},
            .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
        var meter: Meter = .{}; var budget = meter.budget();
        try expectTypedFixture(&effect_directory, &graph, &budget);
        var result = try domain.analyzeEffects(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        // An unbound result can select the object alternative or raise on the
        // undefined/primitive alternative; the declared view cannot erase either.
        try std.testing.expect(result.normal_live and result.language_live);
        try std.testing.expectEqual(@as(usize, 1), result.normal.len);
        try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
        try std.testing.expect(result.normal[0].source == .node);
        try std.testing.expectEqual(@as(usize, 1), result.normal[0].source.node);
        try std.testing.expectEqual(@as(usize, 0), result.initializations.len);
        var control_meter: Meter = .{}; var control_budget = control_meter.budget();
        try expectTypedFixture(&effect_directory, &graph, &control_budget);
        var control = try domain.analyzeControls(std.testing.allocator, &effect_directory, &graph, &control_budget, .{ .function_id = "ctor" }); defer control.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), control.pending);
        try std.testing.expect(control.normal_live and control.language_live);
        try std.testing.expectEqual(@as(usize, 1), control.normal.len);
        try std.testing.expect(control.normal[0].source == .node);
        try std.testing.expectEqual(@as(usize, 2), control.normal[0].source.node);
        var certificate_meter: Meter = .{}; var certificate_budget = certificate_meter.budget();
        try expectTypedFixture(&effect_directory, &graph, &certificate_budget);
        var certificate = try domain.analyze(std.testing.allocator, &effect_directory, &graph, &certificate_budget, proved_entry); defer certificate.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), certificate.pending);
    }
}

test "effect two managed fields retain all parameter categories on the bound receiver" {
    const fixture: EffectFixture = .{}; const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&effect_directory, &graph, &budget);
    var result = try domain.analyzeEffects(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try expectEffectFields(&result, &graph);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), result.normal[0].source.allocation);
}

test "effect language completion retains both earlier managed field writes" {
    const fixture: EffectFixture = .{}; var graph = fixture.graph();
    graph.normal = &.{}; graph.language = &.{7}; graph.exits = .{ .normal = &.{}, .language = &.{.{ .heap = 4, .control = 2 }} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&effect_directory, &graph, &budget);
    var result = try domain.analyzeEffects(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try expectEffectFields(&result, &graph);
    try std.testing.expect(!result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 3), result.language.len);
    for (result.language) |atom| { try std.testing.expect(atom.source == .node); try std.testing.expectEqual(@as(usize, 3), atom.source.node); }
}

test "effect a nonterminating world join retains both managed prefix writes without an exit" {
    const fixture: EffectFixture = .{};
    const heaps = [_]model.Heap{ fixture.heaps[0], fixture.heaps[1], fixture.heaps[2], fixture.heaps[3], fixture.heaps[4], fixture.heaps[5], fixture.heaps[6],
        .{ .join = .{ .inputs = &.{ 4, 7 } } } };
    const controls = [_]model.Control{ fixture.controls[0], fixture.controls[1], fixture.controls[2], fixture.controls[3], fixture.controls[4],
        .{ .join = .{ .inputs = &.{ 2, 5 } } } };
    var graph = fixture.graph(); graph.heaps = &heaps; graph.controls = &controls; graph.normal = &.{}; graph.language = &.{}; graph.exits = .{ .normal = &.{}, .language = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&effect_directory, &graph, &budget);
    var result = try domain.analyzeEffects(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try expectEffectFields(&result, &graph);
    try std.testing.expect(!result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 0), result.normal.len);
    try std.testing.expectEqual(@as(usize, 0), result.language.len);
}

test "effect external and mixed field bases cannot borrow the receiver allocation proof" {
    var fixture: EffectFixture = .{}; fixture.heaps[3].store.bases = &.{3};
    var graph = fixture.graph(); try expectEffectPending(&graph, &effect_directory, .scalar_initialization);
    fixture.heaps[3].store.bases = &.{ 2, 3 };
    graph = fixture.graph(); try expectEffectPending(&graph, &effect_directory, .scalar_initialization);
}

test "effect a joined bound and unbound receiver is not a field initialization proof" {
    var fixture: EffectFixture = .{}; fixture.heaps[3].store.previous = 7;
    const heaps = [_]model.Heap{ fixture.heaps[0], fixture.heaps[1], fixture.heaps[2], fixture.heaps[3], fixture.heaps[4], fixture.heaps[5], fixture.heaps[6],
        .{ .join = .{ .inputs = &.{ 1, 2 } } } };
    var graph = fixture.graph(); graph.heaps = &heaps;
    try expectEffectPending(&graph, &effect_directory, .scalar_initialization);
}

test "effect a field needs a field selector and constructor owner view" {
    // element is a valid typed selector, but is not a constructor field proof.
    var fixture: EffectFixture = .{}; fixture.heaps[3].store.selector = "element";
    var graph = fixture.graph(); try expectEffectPending(&graph, &effect_directory, .scalar_initialization);
    fixture.heaps[3].store.selector = "field:owner"; fixture.heaps[3].store.view = "Array";
    graph = fixture.graph(); try expectEffectPending(&graph, &effect_directory, .scalar_initialization);
}

test "effect an actual Local Value without physical copy fields stays Pending" {
    var fixture: EffectFixture = .{}; fixture.nodes[3] = .{ .local = .{ .@"type" = "LocalValue" } };
    const graph = fixture.graph(); try expectEffectPending(&graph, &effect_directory, .data_protocol);
}

test "effect a derived receiver protocol stays Pending without parent coverage" {
    // A derived constructor cannot allocate its own root. This legal typed
    // result-only graph exercises the unsupported parent-entry protocol alone.
    const nodes = [_]model.Value{ .receiver_input,
        .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{2}, .language = &.{3},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var functions = [_]model.FunctionRow{effect_directory.functions[0]}; functions[0].construction.?.base = "Base";
    const constructions = [_]model.Construction{ effect_directory.constructions[0],
        .{ .id = "construct:Box", .owner = "Box", .base = "Base", .kind = .explicit, .function_id = "ctor" }, effect_directory.constructions[2] };
    var catalog = effect_directory; catalog.functions = &functions; catalog.constructions = &constructions;
    try expectEffectPending(&graph, &catalog, .entry_state);
}

test "effect a call keeps its separate fixed-callee proof obligation" {
    const nodes = [_]model.Value{ .receiver_input,
        .{ .parameter = .{ .@"type" = "Array", .index = 1 } }, .{ .parameter = .{ .@"type" = "Span", .index = 2 } },
        .{ .call = .{ .@"type" = "Box", .call = 0, .completion = .normal } } };
    const calls = [_]model.Call{.{ .function_id = "ctor", .arguments = &.{ &.{1}, &.{2} }, .environment = null, .callee = null, .receiver = &.{0}, .heap = 0, .control = 0, .site = "construct-call" }};
    const heaps = [_]model.Heap{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } };
    const controls = [_]model.Control{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &calls, .normal = &.{3}, .language = &.{},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{} }, .accesses = &.{} };
    try expectEffectPending(&graph, &effect_directory, .fixed_call);
}


fn expectReturnPending(graph: *const model.Graph, catalog: *const model.Directory, pending: domain.Pending) !void {
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(catalog, graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, catalog, graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, pending), result.pending);
}

test "checked constructor return graphs retain copy heaps and both managed field prefixes" {
    var fixture: EffectFixture = .{};
    fixture.nodes[10].copy.heap = 4;
    fixture.nodes[12].receiver_value.action = 7; fixture.nodes[13].receiver_value.action = 8;
    var owner_store = fixture.heaps[3]; owner_store.store.previous = 3;
    var span_store = fixture.heaps[4]; span_store.store.previous = 5;
    const heaps = [_]model.Heap{ fixture.heaps[0], fixture.heaps[1], fixture.heaps[2],
        .{ .copy = .{ .previous = 2, .value = 7 } }, owner_store,
        .{ .copy = .{ .previous = 4, .value = 10 } }, span_store,
        .{ .receiver_action = .{ .previous = 6, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{11}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 6, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{11}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } },
        .{ .receiver_completion = .{ .action = 7 } }, .{ .receiver_completion = .{ .action = 8 } } };
    var graph = fixture.graph(); graph.heaps = &heaps; graph.controls = &controls;
    graph.exits = .{ .normal = &.{.{ .heap = 7, .control = 3 }}, .language = &.{.{ .heap = 8, .control = 4 }} };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&effect_directory, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expect(result.controls[3] and !result.controls[4]);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), result.normal[0].source.allocation);
    // Both copies preserve the conditional parameter roots and all three
    // categories while the bound receiver identity survives each heap edge.
    try std.testing.expectEqual(@as(usize, 6), result.initializations.len);
    var owner_categories: u3 = 0; var span_categories: u3 = 0;
    for (result.initializations) |write| {
        try std.testing.expect(write.base.source == .allocation);
        try std.testing.expectEqual(@as(usize, 0), write.base.source.allocation);
        try std.testing.expectEqual(domain.Category.object, write.base.category);
        try std.testing.expect(write.value.source == .node);
        const bit: u3 = switch (write.value.category) { .object => 1, .@"undefined" => 2, .other => 4 };
        try std.testing.expect(write.store == 4 or write.store == 6);
        if (write.store == 4) {
            try std.testing.expectEqualStrings("field:owner", graph.heaps[write.store].store.selector);
            try std.testing.expectEqual(@as(usize, 3), write.value.source.node); owner_categories |= bit;
        } else {
            try std.testing.expectEqualStrings("field:span", graph.heaps[write.store].store.selector);
            try std.testing.expectEqual(@as(usize, 4), write.value.source.node); span_categories |= bit;
        }
        try std.testing.expectEqualStrings("Box", graph.heaps[write.store].store.view);
    }
    try std.testing.expectEqual(@as(u3, 7), owner_categories); try std.testing.expectEqual(@as(u3, 7), span_categories);
    // The effect-only entry is not a replacement for return graph interpretation.
    try expectEffectPending(&graph, &effect_directory, .heap_protocol);
}

test "checked base constructor scalar result retains its bound receiver fallback" {
    var fixture: ControlFixture = .{}; fixture.nodes[3] = .{ .literal = .{ .@"type" = "i32", .category = .other } };
    const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), result.normal[0].source.allocation);
}

test "checked constructor language exits retain scalar undefined and reference payload categories" {
    for ([_]domain.Category{ .other, .@"undefined", .object }) |category| {
        var fixture: ControlFixture = .{};
        fixture.nodes[3] = .{ .literal = .{ .@"type" = if (category == .@"undefined") "undefined" else "i32", .category = if (category == .@"undefined") .@"undefined" else .other } };
        var graph = fixture.graph(); graph.normal = &.{};
        graph.language = if (category == .object) &.{1} else &.{3};
        graph.exits = .{ .normal = &.{}, .language = &.{.{ .heap = 2, .control = 2 }} };
        var meter: Meter = .{}; var budget = meter.budget();
        try expectTypedFixture(&directory, &graph, &budget);
        var result = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        try std.testing.expect(!result.normal_live and result.language_live);
        try std.testing.expectEqual(@as(usize, 1), result.language.len);
        try std.testing.expectEqual(category, result.language[0].category);
        if (category == .object) {
            try std.testing.expect(result.language[0].source == .allocation);
            try std.testing.expectEqual(@as(usize, 0), result.language[0].source.allocation);
        } else {
            try std.testing.expect(result.language[0].source == .node);
            try std.testing.expectEqual(@as(usize, 3), result.language[0].source.node);
        }
    }
}

test "checked constructor returns keep unsupported Value call and derived protocols Pending" {
    {
        var fixture: EffectFixture = .{}; fixture.nodes[3] = .{ .local = .{ .@"type" = "LocalValue" } };
        const graph = fixture.graph(); try expectReturnPending(&graph, &effect_directory, .data_protocol);
    }
    {
        const nodes = [_]model.Value{ .receiver_input,
            .{ .parameter = .{ .@"type" = "Array", .index = 1 } }, .{ .parameter = .{ .@"type" = "Span", .index = 2 } },
            .{ .call = .{ .@"type" = "Box", .call = 0, .completion = .normal } } };
        const calls = [_]model.Call{.{ .function_id = "ctor", .arguments = &.{ &.{1}, &.{2} }, .environment = null, .callee = null, .receiver = &.{0}, .heap = 0, .control = 0, .site = "construct-call" }};
        const heaps = [_]model.Heap{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } };
        const controls = [_]model.Control{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } };
        const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &calls, .normal = &.{3}, .language = &.{},
            .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{} }, .accesses = &.{} };
        try expectReturnPending(&graph, &effect_directory, .fixed_call);
    }
    {
        const nodes = [_]model.Value{ .receiver_input,
            .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
            .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } }, .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
        const heaps = [_]model.Heap{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } } };
        const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
        const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{2}, .language = &.{3},
            .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
        var functions = [_]model.FunctionRow{effect_directory.functions[0]}; functions[0].construction.?.base = "Base";
        const constructions = [_]model.Construction{ effect_directory.constructions[0],
            .{ .id = "construct:Box", .owner = "Box", .base = "Base", .kind = .explicit, .function_id = "ctor" }, effect_directory.constructions[2] };
        var catalog = effect_directory; catalog.functions = &functions; catalog.constructions = &constructions;
        try expectReturnPending(&graph, &catalog, .entry_state);
    }
}


test "an effects logical view keeps the same formal owner and actual alternatives" {
    for ([_][]const u8{ "Array", "Span" }) |view| {
        const nodes = [_]model.Value{ .receiver_input,
            .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
            .{ .gate = .{ .@"type" = view, .inputs = &.{1}, .control = 0 } },
            .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
            .{ .receiver_value = .{ .@"type" = null, .action = 2 } } };
        const heaps = [_]model.Heap{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } } };
        const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
        const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{3}, .language = &.{4},
            .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
        var meter: Meter = .{}; var budget = meter.budget();
        try expectTypedFixture(&effect_directory, &graph, &budget);
        var result = try domain.analyzeEffects(std.testing.allocator, &effect_directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
        // A retained Array->Span view cannot remove undefined/primitive result
        // failure or make a fresh owner. It is only a lexical view equation.
        try std.testing.expect(result.normal_live and result.language_live);
        try std.testing.expectEqual(@as(usize, 1), result.normal.len);
        try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
        try std.testing.expect(result.normal[0].source == .node);
        try std.testing.expectEqual(@as(usize, 1), result.normal[0].source.node);
        try std.testing.expectEqual(@as(usize, 0), result.initializations.len);
    }
}

test "a live return copy needs Data even when its result is discarded" {
    var fixture: ControlFixture = .{};
    fixture.nodes[6] = .{ .join = .{ .@"type" = "i32", .inputs = &.{6} } };
    fixture.nodes[7] = .{ .copy = .{ .@"type" = "i32", .bases = &.{6}, .site = "ignored-copy", .heap = 2, .control = 2 } };
    fixture.heaps[4].receiver_action.previous = 6; fixture.heaps[5].receiver_action.previous = 6;
    const heaps = [_]model.Heap{ fixture.heaps[0], fixture.heaps[1], fixture.heaps[2], fixture.heaps[3], fixture.heaps[4], fixture.heaps[5],
        .{ .copy = .{ .previous = 2, .value = 7 } } };
    var graph = fixture.graph(); graph.heaps = &heaps;
    // A syntactically valid but unseeded Cell-like cycle is not Data. Merely
    // forwarding the prior bound frame through Heap.copy cannot prove normal.
    try expectReturnPending(&graph, &directory, .unknown_origin);
    fixture.nodes[6].join.inputs = &.{ 3, 6 };
    var meter: Meter = .{}; var budget = meter.budget();
    try expectTypedFixture(&directory, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, .{ .function_id = "ctor" }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), result.normal[0].source.allocation);
}
