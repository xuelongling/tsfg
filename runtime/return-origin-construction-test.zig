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
    var result = try domain.analyze(std.testing.allocator, &directory, &graph, &budget, entry); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, pending), result.pending);
}

test "proved native initialization retains the bound Data and normal result" {
    const fixture: Fixture = .{}; const graph = fixture.graph(); var meter: Meter = .{}; var budget = meter.budget();
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
        .{ .receiver_value = .{ .@"type" = "Box", .action = 3 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 5 } },
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
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, "ctor"); defer result.deinit();
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
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{2}, .language = &.{3},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, "ctor"); defer result.deinit();
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
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } } };
    const heaps = [_]model.Heap{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } } };
    const controls = [_]model.Control{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    const graph = model.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &controls, .calls = &.{}, .normal = &.{3}, .language = &.{4},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    var result = try domain.analyzeControls(std.testing.allocator, &directory, &graph, &budget, "ctor"); defer result.deinit();
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
    var certificate = try domain.analyze(std.testing.allocator, &directory, &graph, &certificate_budget, proved_entry); defer certificate.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), certificate.pending);
}
