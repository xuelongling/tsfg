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
