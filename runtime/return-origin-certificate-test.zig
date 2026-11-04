// SPDX-License-Identifier: MIT
// Structural certificates over pure symbolic equations only. These tests do
// not construct Program/Context, admit Source, or grant execution authority.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const certificates = @import("wire-program-return-origins.zig");

const Meter = struct {
    remaining: usize = 100_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(raw));
        if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; }
        self.remaining -= count;
    }
    fn budget(self: *Meter) model.Budget { return .{ .context = self, .charge = charge }; }
};

const constructor: model.FunctionRow = .{
    .id = "ctor", .kind = .construction_body, .parameter_types = &.{"Box"}, .return_type = "Box",
    .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
    .construction = .{ .id = "construct:Box", .owner = "Box", .base = null, .receiver_index = 0 },
};
const directory: model.Directory = .{
    .types = &.{ .{ .id = "Box", .kind = .reference }, .{ .id = "i32", .kind = .scalar },
        .{ .id = "string", .kind = .string }, .{ .id = "undefined", .kind = .@"undefined" } },
    .functions = &.{constructor}, .globals = &.{}, .environments = &.{}, .fields = &.{},
    .constructions = &.{.{ .id = "construct:Box", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" }},
};

const Fixture = struct {
    nodes: [7]model.Value = .{
        .receiver_input,
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 3 } },
        .{ .literal = .{ .@"type" = "i32", .category = .other } },
        .{ .literal = .{ .@"type" = "string", .category = .other } },
    },
    heaps: [4]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{3}, .completion = .normal } },
    },
    controls: [4]model.Control = .{ .entry, .{ .receiver_completion = .{ .action = 1 } },
        .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 3 } } },
    fn graph(self: *const Fixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{4}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 3, .control = 3 }}, .language = &.{} }, .accesses = &.{} };
    }
};

fn inclusion(body: *const model.Graph, upper: ?*const model.Graph) !certificates.Inclusion {
    var meter: Meter = .{}; var budget = meter.budget();
    return certificates.covered(std.testing.allocator, &directory, "ctor", body,
        &.{.{ .function_id = "ctor", .graph = upper }}, &budget);
}
fn expectExactMissing(body: *const model.Graph, upper: *const model.Graph) !void {
    const result = try inclusion(body, upper);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
}

test "receiver certificate accepts complete equations in separate memory" {
    const left = try std.testing.allocator.create(Fixture); defer std.testing.allocator.destroy(left);
    const right = try std.testing.allocator.create(Fixture); defer std.testing.allocator.destroy(right);
    left.* = .{}; right.* = .{};
    const body = left.graph(); const upper = right.graph();
    try std.testing.expect(@intFromPtr(body.nodes.ptr) != @intFromPtr(upper.nodes.ptr));
    try std.testing.expect((try inclusion(&body, &upper)) == .covered);
}

test "receiver certificate compares an unused literal type" {
    const left: Fixture = .{}; var right: Fixture = .{};
    right.nodes[6].literal.@"type" = "i32";
    const body = left.graph(); const upper = right.graph();
    try expectExactMissing(&body, &upper);
}

test "receiver certificate compares the whole heap predecessor equation" {
    const left: Fixture = .{}; var right: Fixture = .{};
    right.heaps[3].receiver_action.previous = 1;
    const body = left.graph(); const upper = right.graph();
    try expectExactMissing(&body, &upper);
}

test "receiver certificate compares accesses and completion roots" {
    const fixture: Fixture = .{}; const body = fixture.graph(); var upper = fixture.graph();
    upper.accesses = &.{.{ .values = &.{1}, .flag = .read, .control = 1 }};
    try expectExactMissing(&body, &upper);
    upper = fixture.graph(); upper.normal = &.{};
    try expectExactMissing(&body, &upper);
}

test "missing fixed graph never substitutes the current body" {
    const fixture: Fixture = .{}; const body = fixture.graph();
    const result = try inclusion(&body, null);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.missing_return_graph, result.pending);
}

test "equal receiver equations cannot bypass missing environment metadata" {
    const fixture: Fixture = .{}; const graph = fixture.graph();
    var incomplete = constructor; incomplete.environment_metadata_complete = false;
    var owned = directory; owned.functions = &.{incomplete};
    var meter: Meter = .{}; var budget = meter.budget();
    const result = try certificates.covered(std.testing.allocator, &owned, "ctor", &graph,
        &.{.{ .function_id = "ctor", .graph = &graph }}, &budget);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.graph_protocol, result.pending);
}

test "unselected fixed graphs still undergo full structural validation" {
    const fixture: Fixture = .{}; const body = fixture.graph();
    const unused: model.FunctionRow = .{ .id = "unused", .kind = .source, .parameter_types = &.{}, .return_type = "i32",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null };
    var owned = directory; owned.functions = &.{ constructor, unused };
    const malformed: model.Graph = .{ .nodes = &.{}, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{},
        .normal = &.{0}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{} }, .accesses = &.{} };
    var meter: Meter = .{}; var budget = meter.budget();
    try std.testing.expectError(error.InvalidReference, certificates.covered(std.testing.allocator, &owned, "ctor", &body,
        &.{ .{ .function_id = "ctor", .graph = &body }, .{ .function_id = "unused", .graph = &malformed } }, &budget));
}

test "identity cannot hide an unknown origin and budget never refills" {
    var fixture: Fixture = .{}; fixture.nodes[6] = .unknown;
    const graph = fixture.graph(); const result = try inclusion(&graph, &graph);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.unknown_data_origin, result.pending);
    var meter: Meter = .{ .remaining = 0 }; var budget = meter.budget();
    try std.testing.expectError(error.BudgetExceeded, certificates.covered(std.testing.allocator, &directory, "ctor", &graph,
        &.{.{ .function_id = "ctor", .graph = &graph }}, &budget));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
}

// Pure typed reproducer of the independently observed Body33/Heap15/Control11
// versus fixed8/8/4 equations. Toy IDs preserve their actual Ref topology;
// no package, Source, selected actual argument or admission evidence is made.
const receiver_directory: model.Directory = .{
    .types = &.{ .{ .id = "Array", .kind = .array }, .{ .id = "Box", .kind = .reference }, .{ .id = "Span", .kind = .read_span } },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{ "Box", "Array", "Span" }, .return_type = "Box",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Box", .owner = "Box", .base = null, .receiver_index = 0 } }},
    .globals = &.{}, .environments = &.{}, .fields = &.{ "alternate", "owner", "span" },
    .constructions = &.{.{ .id = "construct:Box", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" }},
};
const ReceiverBodyFixture = struct {
    nodes: [33]model.Value = .{
        .{ .join = .{ .@"type" = null, .inputs = &.{ 14 } } },
        .{ .join = .{ .@"type" = "Array", .inputs = &.{ 15 } } },
        .{ .join = .{ .@"type" = "Span", .inputs = &.{ 16 } } },
        .{ .join = .{ .@"type" = null, .inputs = &.{  } } },
        .{ .join = .{ .@"type" = null, .inputs = &.{  } } },
        .{ .join = .{ .@"type" = "Array", .inputs = &.{ 21 } } },
        .{ .join = .{ .@"type" = "Span", .inputs = &.{ 22 } } },
        .{ .join = .{ .@"type" = "Box", .inputs = &.{ 24 } } },
        .{ .join = .{ .@"type" = "Box", .inputs = &.{ 25 } } },
        .{ .join = .{ .@"type" = "Array", .inputs = &.{ 28 } } },
        .{ .join = .{ .@"type" = "Span", .inputs = &.{ 30 } } },
        .{ .join = .{ .@"type" = null, .inputs = &.{ 26 } } },
        .{ .join = .{ .@"type" = "Box", .inputs = &.{ 31 } } },
        .{ .join = .{ .@"type" = null, .inputs = &.{ 32 } } },
        .receiver_input,
        .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
        .{ .parameter = .{ .@"type" = "Span", .index = 2 } },
        .{ .join = .{ .@"type" = "Array", .inputs = &.{ 19 } } },
        .{ .join = .{ .@"type" = "Span", .inputs = &.{ 20 } } },
        .{ .gate = .{ .@"type" = null, .inputs = &.{ 1 }, .control = 1 } },
        .{ .gate = .{ .@"type" = null, .inputs = &.{ 2 }, .control = 1 } },
        .{ .gate = .{ .@"type" = "Array", .inputs = &.{ 17 }, .control = 1 } },
        .{ .gate = .{ .@"type" = "Span", .inputs = &.{ 18 }, .control = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 6 } },
        .{ .gate = .{ .@"type" = "Box", .inputs = &.{ 23 }, .control = 6 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 7 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 8 } },
        .{ .copy = .{ .@"type" = "Array", .bases = &.{ 5 }, .site = "[\"ctor\",24,52,\"body-copy:1:1\"]", .heap = 2, .control = 2 } },
        .{ .gate = .{ .@"type" = "Array", .inputs = &.{ 27 }, .control = 2 } },
        .{ .copy = .{ .@"type" = "Span", .bases = &.{ 6 }, .site = "[\"ctor\",54,89,\"body-copy:1:3\"]", .heap = 10, .control = 2 } },
        .{ .gate = .{ .@"type" = "Span", .inputs = &.{ 29 }, .control = 2 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 13 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 14 } },
    },
    heaps: [15]model.Heap = .{
        .entry,
        .{ .join = .{ .inputs = &.{ 0 } } },
        .{ .join = .{ .inputs = &.{ 7 } } },
        .{ .join = .{ .inputs = &.{ 8 } } },
        .{ .join = .{ .inputs = &.{ 13 } } },
        .{ .join = .{ .inputs = &.{ 14 } } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{ 0 }, .action = .allocate, .operands = &.{  }, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 6, .control = 6, .frames = &.{ 0 }, .action = .bind, .operands = &.{ 7 }, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 6, .control = 6, .frames = &.{ 0 }, .action = .bind, .operands = &.{ 7 }, .completion = .language } },
        .{ .copy = .{ .previous = 2, .value = 27 } },
        .{ .store = .{ .previous = 9, .bases = &.{ 8 }, .selector = "field:owner", .view = "Box", .values = &.{ 9 }, .control = 2, .initialize = true } },
        .{ .copy = .{ .previous = 10, .value = 29 } },
        .{ .store = .{ .previous = 11, .bases = &.{ 8 }, .selector = "field:span", .view = "Box", .values = &.{ 10 }, .control = 2, .initialize = true } },
        .{ .receiver_action = .{ .previous = 12, .control = 2, .frames = &.{ 0 }, .action = .result, .operands = &.{  }, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 12, .control = 2, .frames = &.{ 0 }, .action = .result, .operands = &.{  }, .completion = .language } },
    },
    controls: [11]model.Control = .{
        .entry,
        .{ .join = .{ .inputs = &.{ 0 } } },
        .{ .join = .{ .inputs = &.{ 7 } } },
        .{ .join = .{ .inputs = &.{ 8 } } },
        .{ .join = .{ .inputs = &.{ 9 } } },
        .{ .join = .{ .inputs = &.{ 10 } } },
        .{ .receiver_completion = .{ .action = 6 } },
        .{ .receiver_completion = .{ .action = 7 } },
        .{ .receiver_completion = .{ .action = 8 } },
        .{ .receiver_completion = .{ .action = 13 } },
        .{ .receiver_completion = .{ .action = 14 } },
    },
    fn graph(self: *const ReceiverBodyFixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{ 12 }, .language = &.{ 11, 13 }, .exits = .{ .normal = &.{ .{ .heap = 4, .control = 4 } }, .language = &.{ .{ .heap = 3, .control = 3 }, .{ .heap = 5, .control = 5 } } }, .accesses = &.{ .{ .values = &.{ 8 }, .flag = .write, .control = 2 } } };
    }
};

const ReceiverFixedFixture = struct {
    nodes: [8]model.Value = .{
        .receiver_input,
        .{ .parameter = .{ .@"type" = "Array", .index = 1 } },
        .{ .parameter = .{ .@"type" = "Span", .index = 2 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .copy = .{ .@"type" = "Array", .bases = &.{ 1 }, .site = "ctor/%v11", .heap = 2, .control = 2 } },
        .{ .copy = .{ .@"type" = "Span", .bases = &.{ 2 }, .site = "ctor/%v13", .heap = 4, .control = 2 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 7 } },
    },
    heaps: [8]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{ 0 }, .action = .allocate, .operands = &.{  }, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{ 0 }, .action = .bind, .operands = &.{ 3 }, .completion = .normal } },
        .{ .copy = .{ .previous = 2, .value = 5 } },
        .{ .store = .{ .previous = 3, .bases = &.{ 4 }, .selector = "field:owner", .view = "Box", .values = &.{ 5 }, .control = 2, .initialize = true } },
        .{ .copy = .{ .previous = 4, .value = 6 } },
        .{ .store = .{ .previous = 5, .bases = &.{ 4 }, .selector = "field:span", .view = "Box", .values = &.{ 6 }, .control = 2, .initialize = true } },
        .{ .receiver_action = .{ .previous = 6, .control = 2, .frames = &.{ 0 }, .action = .result, .operands = &.{  }, .completion = .normal } },
    },
    controls: [4]model.Control = .{
        .entry,
        .{ .receiver_completion = .{ .action = 1 } },
        .{ .receiver_completion = .{ .action = 2 } },
        .{ .receiver_completion = .{ .action = 7 } },
    },
    fn graph(self: *const ReceiverFixedFixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{ 7 }, .language = &.{  }, .exits = .{ .normal = &.{ .{ .heap = 7, .control = 3 } }, .language = &.{  } }, .accesses = &.{ .{ .values = &.{ 4 }, .flag = .write, .control = 2 } } };
    }
};

fn receiverInclusion(body_graph: *const model.Graph, upper_graph: *const model.Graph) !certificates.Inclusion {
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &receiver_directory, &budget);
    for ([_]*const model.Graph{ body_graph, upper_graph }) |graph| {
        const validation = try model.validateGraph(std.testing.allocator, &receiver_directory, "ctor", graph, &budget);
        try std.testing.expect(validation == .pending);
        try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    }
    const result = try certificates.covered(std.testing.allocator, &receiver_directory, "ctor", body_graph,
        &.{.{ .function_id = "ctor", .graph = upper_graph }}, &budget);
    try std.testing.expect(meter.remaining > 0 and meter.remaining < 100_000);
    return result;
}
fn expectReceiverMissing(body_graph: *const model.Graph, upper_graph: *const model.Graph) !void {
    const result = try receiverInclusion(body_graph, upper_graph);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
}

test "receiver full correspondence relates SSA wrappers and locally renamed copy sites" {
    const current: ReceiverBodyFixture = .{}; var fixed_graph: ReceiverFixedFixture = .{};
    fixed_graph.nodes[5].copy.site = "copy:first"; fixed_graph.nodes[6].copy.site = "copy:second";
    const left = current.graph(); const right = fixed_graph.graph();
    try std.testing.expect((try receiverInclusion(&left, &right)) == .covered);
    // This finite correspondence is bilateral, not a normal-result subset.
    try std.testing.expect((try receiverInclusion(&right, &left)) == .covered);
}

test "receiver full correspondence preserves every field selector and bound-owner view" {
    const current: ReceiverBodyFixture = .{}; var fixed_graph: ReceiverFixedFixture = .{};
    const left = current.graph(); const right = fixed_graph.graph();
    fixed_graph.heaps[4].store.selector = "field:alternate";
    try expectReceiverMissing(&left, &right);
    fixed_graph = .{}; fixed_graph.heaps[6].store.view = "Array";
    try expectReceiverMissing(&left, &right);
}

test "receiver full correspondence preserves control predicates and completion exits" {
    var current: ReceiverBodyFixture = .{}; const fixed_graph: ReceiverFixedFixture = .{};
    var left = current.graph(); const right = fixed_graph.graph();
    // Both predicates happen to be may-live, but entry is not the same
    // equation as successful bind completion. No bool-only comparison works.
    current.heaps[10].store.control = 1;
    try expectReceiverMissing(&left, &right);
    current = .{}; left = current.graph();
    left.exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = left.exits.language };
    try expectReceiverMissing(&left, &right);
}

test "receiver full correspondence never deletes a potentially live language completion" {
    const receiver_domain = @import("wire-program-return-origin-construction.zig");
    var current: ReceiverBodyFixture = .{};
    // A second bind of the already bound frame is a real language failure.
    // An explicit-base result of U/other would instead use normal fallback.
    current.heaps[13].receiver_action.action = .bind;
    current.heaps[14].receiver_action.action = .bind;
    current.heaps[13].receiver_action.operands = &.{15};
    current.heaps[14].receiver_action.operands = &.{15};
    var left = current.graph();
    // This derived fixture declares only its proved language-only exit. The
    // first bind's language root11 and the second bind's normal root12 are
    // dead; retaining root11 would fail Domain's non-bottom return closure.
    left.normal = &.{}; left.exits.normal = &.{};
    left.language = &.{13}; left.exits.language = &.{.{ .heap = 5, .control = 5 }};
    // Keep every other equation identical, isolating the certificate's loss
    // of this genuinely live language channel rather than a wrong action.
    var right = left; right.language = &.{}; right.exits.language = &.{};
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &receiver_directory, &budget);
    for ([_]*const model.Graph{ &left, &right }) |graph| {
        const validation = try model.validateGraph(std.testing.allocator, &receiver_directory, "ctor", graph, &budget);
        try std.testing.expect(validation == .pending);
        try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    }
    var observed = try receiver_domain.analyzeReturns(std.testing.allocator, &receiver_directory, &left, &budget, .{ .function_id = "ctor" }); defer observed.deinit();
    try std.testing.expectEqual(@as(?receiver_domain.Pending, null), observed.pending);
    try std.testing.expect(!observed.normal_live and observed.language_live);
    try std.testing.expect(!observed.controls[9] and observed.controls[10]);
    try std.testing.expectEqual(@as(usize, 0), observed.normal.len);
    try std.testing.expectEqual(@as(usize, 1), observed.language.len);
    try std.testing.expectEqual(receiver_domain.Category.object, observed.language[0].category);
    try std.testing.expect(observed.language[0].source == .language_error);
    try std.testing.expectEqual(@as(usize, 14), observed.language[0].source.language_error);
    try std.testing.expectEqual(@as(usize, 6), observed.initializations.len);
    const result = try certificates.covered(std.testing.allocator, &receiver_directory, "ctor", &left,
        &.{.{ .function_id = "ctor", .graph = &right }}, &budget);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
    try std.testing.expect(meter.remaining > 0 and meter.remaining < 100_000);
}

test "receiver full correspondence requires the actual Heap copy predecessor" {
    const current: ReceiverBodyFixture = .{}; var fixed_graph: ReceiverFixedFixture = .{};
    fixed_graph.heaps[3] = .{ .join = .{ .inputs = &.{2} } };
    const left = current.graph(); const right = fixed_graph.graph();
    // Keeping the Copy Data node cannot replace its missing Heap.copy row.
    try expectReceiverMissing(&left, &right);
}

test "receiver full correspondence requires a bidirectional copy-site identity map" {
    const current: ReceiverBodyFixture = .{}; var fixed_graph: ReceiverFixedFixture = .{};
    fixed_graph.nodes[6].copy.site = fixed_graph.nodes[5].copy.site;
    const left = current.graph(); const right = fixed_graph.graph();
    try expectReceiverMissing(&left, &right);
    try expectReceiverMissing(&right, &left);
}

test "receiver full correspondence covers stores and copies even without exits" {
    const current: ReceiverBodyFixture = .{}; var fixed_graph: ReceiverFixedFixture = .{};
    var left = current.graph(); var right = fixed_graph.graph();
    left.normal = &.{}; left.exits.normal = &.{};
    right.normal = &.{}; right.exits.normal = &.{};
    try std.testing.expect((try receiverInclusion(&left, &right)) == .covered);
    fixed_graph.heaps[6] = .{ .join = .{ .inputs = &.{5} } };
    try expectReceiverMissing(&left, &right);
}

test "receiver full correspondence retains an unproved administrative gate" {
    var current: ReceiverBodyFixture = .{}; const fixed_graph: ReceiverFixedFixture = .{};
    current.nodes[19].gate.control = 2;
    const left = current.graph(); const right = fixed_graph.graph();
    // A formal parameter has no intrinsic bind predicate. A live bind bool
    // alone cannot justify deleting this extra conditional data equation.
    try expectReceiverMissing(&left, &right);
}
