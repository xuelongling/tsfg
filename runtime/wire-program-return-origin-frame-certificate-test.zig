// SPDX-License-Identifier: MIT
// Pure typed whole-equation certificates. These are not packet/Source admission,
// selected actual states, a Host/VM launch or a replacement for the original16.
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
const directory: model.Directory = .{
    .types = &.{ .{ .id = "Box", .kind = .reference }, .{ .id = "Child", .kind = .reference }, .{ .id = "undefined", .kind = .@"undefined" } },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{"Box"}, .return_type = "Box",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Box", .owner = "Box", .base = null, .receiver_index = 0 } }},
    .constructions = &.{ .{ .id = "construct:Box", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" },
        .{ .id = "construct:Child", .owner = "Child", .base = "Box", .kind = .implicit_derived, .function_id = null } },
    .globals = &.{}, .environments = &.{}, .fields = &.{},
};
const Fixture = struct {
    nodes: [9]model.Value = .{
        .receiver_input,
        .{ .receiver_frame = .{ .construction = "construct:Box", .new_target = "Box", .parent = null, .site = "body:create", .control = 0 } },
        .{ .receiver_frame = .{ .construction = "construct:Box", .new_target = "Box", .parent = null, .site = "body:unused", .control = 0 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 1 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .literal = .{ .@"type" = "undefined", .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 4 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
        .{ .gate = .{ .@"type" = "undefined", .inputs = &.{5}, .control = 2 } },
    },
    heaps: [6]model.Heap = .{
        .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{1}, .action = .bind, .operands = &.{3}, .completion = .normal } },
        .{ .join = .{ .inputs = &.{ 0, 2 } } },
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{1}, .action = .result, .operands = &.{5}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{1}, .action = .result, .operands = &.{5}, .completion = .language } },
    },
    controls: [6]model.Control = .{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } },
        .{ .join = .{ .inputs = &.{ 0, 2 } } }, .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } } },
    fn renamed() Fixture {
        var value: Fixture = .{};
        value.nodes[1].receiver_frame.site = "fixed:create"; value.nodes[2].receiver_frame.site = "fixed:unused";
        return value;
    }
    fn graph(self: *const Fixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps, .controls = &self.controls, .calls = &.{}, .normal = &.{6}, .language = &.{7},
            .exits = .{ .normal = &.{.{ .heap = 4, .control = 4 }}, .language = &.{.{ .heap = 5, .control = 5 }} }, .accesses = &.{} };
    }
};
fn inclusion(owned: *const model.Directory, body: *const model.Graph, fixed: *const model.Graph) !certificates.Inclusion {
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, owned, &budget);
    for ([_]*const model.Graph{ body, fixed }) |graph| {
        const validation = try model.validateGraph(std.testing.allocator, owned, "ctor", graph, &budget);
        try std.testing.expect(validation == .pending);
        try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    }
    return certificates.covered(std.testing.allocator, owned, "ctor", body, &.{.{ .function_id = "ctor", .graph = fixed }}, &budget);
}
fn missing(owned: *const model.Directory, body: *const model.Graph, fixed: *const model.Graph) !void {
    const result = try inclusion(owned, body, fixed);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
}
test "complete fresh frames multi-joins and non-erasable gates match in both directions" {
    const left: Fixture = .{}; const right = Fixture.renamed(); const body = left.graph(); const fixed = right.graph();
    try std.testing.expect((try inclusion(&directory, &body, &fixed)) == .covered);
    try std.testing.expect((try inclusion(&directory, &fixed, &body)) == .covered);
}
test "a multi-control join cannot lose its second edge" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.controls[3].join.inputs = &.{0};
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "a multi-heap join cannot lose its second edge" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.heaps[3].join.inputs = &.{0};
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "a non-erasable literal gate retains its actual predicate" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.nodes[8].gate.control = 1;
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "a one-sided conditional gate is not erased by may-liveness" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.nodes[8] = right.nodes[5];
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "unused frame sites preserve one shared bidirectional identity map" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.nodes[2].receiver_frame.site = right.nodes[1].receiver_frame.site;
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "unused frame new-target values remain part of the complete equation" {
    const left: Fixture = .{}; var right = Fixture.renamed(); right.nodes[2].receiver_frame.new_target = "Child";
    const body = left.graph(); const fixed = right.graph(); try missing(&directory, &body, &fixed);
}
test "implicit-derived frame construction still has no certificate support" {
    const left: Fixture = .{}; var right = Fixture.renamed();
    right.nodes[2].receiver_frame.construction = "construct:Child"; right.nodes[2].receiver_frame.new_target = "Child";
    const body = left.graph(); const fixed = right.graph(); const result = try inclusion(&directory, &body, &fixed);
    try std.testing.expect(result == .pending); try std.testing.expectEqual(certificates.Pending.graph_protocol, result.pending);
}

// This is the complete 9/9/8 topology of retained public43217/cee5 table8,
// with toy immutable IDs and a scalar field. Both sides are independently typed.
// Its positive interpretation additionally requires the separate formal-derived
// Domain change; the strict matcher does not replace that missing prerequisite.
const child_directory: model.Directory = .{
    .types = &.{ .{ .id = "Base", .kind = .reference }, .{ .id = "Derived", .kind = .reference }, .{ .id = "i32", .kind = .scalar } },
    .functions = &.{.{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{"Derived"}, .return_type = "Derived",
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null,
        .construction = .{ .id = "construct:Derived", .owner = "Derived", .base = "Base", .receiver_index = 0 } }},
    .constructions = &.{ .{ .id = "construct:Base", .owner = "Base", .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "construct:Derived", .owner = "Derived", .base = "Base", .kind = .explicit, .function_id = "ctor" } },
    .globals = &.{}, .environments = &.{}, .fields = &.{"field"},
};
const ChildFixture = struct {
    nodes: [10]model.Value = .{
        .receiver_input,
        .{ .receiver_frame = .{ .construction = "construct:Base", .new_target = null, .parent = &.{0}, .site = "body:base", .control = 0 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 2 } }, .{ .receiver_value = .{ .@"type" = "Base", .action = 3 } },
        .{ .receiver_value = .{ .@"type" = "Derived", .action = 4 } }, .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
        .{ .literal = .{ .@"type" = "i32", .category = .other } }, .{ .gate = .{ .@"type" = "i32", .inputs = &.{6}, .control = 3 } },
        .{ .receiver_value = .{ .@"type" = "Base", .action = 7 } },
        .{ .receiver_frame = .{ .construction = "construct:Derived", .new_target = "Derived", .parent = null, .site = "same:unused", .control = 0 } },
    },
    heaps: [9]model.Heap = .{ .entry, .{ .join = .{ .inputs = &.{ 0, 8 } } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{1}, .action = .bind, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{}, .completion = .language } },
        .{ .store = .{ .previous = 3, .control = 3, .bases = &.{3}, .selector = "field:field", .view = "Base", .values = &.{7}, .initialize = true } },
        .{ .receiver_action = .{ .previous = 6, .control = 3, .frames = &.{1}, .action = .result, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 7, .control = 6, .frames = &.{0}, .action = .bind, .operands = &.{8}, .completion = .normal } },
    },
    controls: [8]model.Control = .{ .entry, .{ .join = .{ .inputs = &.{ 0, 7 } } },
        .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 3 } },
        .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } },
        .{ .receiver_completion = .{ .action = 7 } }, .{ .receiver_completion = .{ .action = 8 } } },
    fn graph(self: *const ChildFixture, extra: bool) model.Graph {
        return .{ .nodes = self.nodes[0..@as(usize, if (extra) 10 else 9)], .heaps = &self.heaps, .controls = &self.controls, .calls = &.{},
            .normal = &.{4}, .language = &.{5}, .exits = .{ .normal = &.{.{ .heap = 4, .control = 4 }}, .language = &.{.{ .heap = 5, .control = 5 }} },
            .accesses = &.{.{ .values = &.{3}, .flag = .write, .control = 3 }} };
    }
};
test "complete implicit-base child and conditional-super join topology has an exact structural certificate" {
    const left: ChildFixture = .{}; var right: ChildFixture = .{}; right.nodes[1].receiver_frame.site = "fixed:base";
    const body = left.graph(false); const fixed = right.graph(false);
    try std.testing.expect((try inclusion(&child_directory, &body, &fixed)) == .covered);
    try std.testing.expect((try inclusion(&child_directory, &fixed, &body)) == .covered);
}
test "a typed alternative parent frame cannot replace the original formal parent" {
    const left: ChildFixture = .{}; var right: ChildFixture = .{};
    right.nodes[1].receiver_frame.site = "fixed:base"; right.nodes[1].receiver_frame.parent = &.{9};
    const body = left.graph(true); const fixed = right.graph(true); try missing(&child_directory, &body, &fixed);
}
test "strict frame matching never refills an exhausted owner budget" {
    const fixture: Fixture = .{}; const graph = fixture.graph(); var meter: Meter = .{ .remaining = 0 }; var budget = meter.budget();
    try std.testing.expectError(error.BudgetExceeded, certificates.covered(std.testing.allocator, &directory, "ctor", &graph,
        &.{.{ .function_id = "ctor", .graph = &graph }}, &budget));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
}
