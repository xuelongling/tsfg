// SPDX-License-Identifier: MIT
// Pure typed Graph5/Directory interpretation. These cases neither admit Source
// nor grant allocation types, actual aliases, execution or fixed certificates.
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
