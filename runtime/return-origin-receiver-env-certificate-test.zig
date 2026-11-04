// SPDX-License-Identifier: MIT
// Literal symbolic metadata only. Directory and Graph own every premise;
// these tests assert neither Source admission nor selected runtime actuals.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const certificates = @import("wire-program-return-origins.zig");
const Meter = struct {
    remaining: usize = 300_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(raw));
        if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; }
        self.remaining -= count;
    }
    fn budget(self: *Meter) model.Budget { return .{ .context = self, .charge = charge }; }
};
const directory: model.Directory = .{
    .types = &.{ .{ .id = "Box", .kind = .reference }, .{ .id = "Code", .kind = .function } },
    .functions = &.{
        .{ .id = "child", .kind = .source, .parameter_types = &.{}, .return_type = "Box", .environment_metadata_complete = true, .lexical_environment = "inner", .activation_environment = null, .construction = null },
        .{ .id = "ctor", .kind = .construction_body, .parameter_types = &.{ "Box", "Box" }, .return_type = "Box", .environment_metadata_complete = true, .lexical_environment = "outer", .activation_environment = "inner", .construction = .{ .id = "role", .owner = "Box", .base = null, .receiver_index = 0 } },
    },
    .environments = &.{ .{ .id = "inner", .parent = "outer", .slots = &.{.{ .key = "value", .@"type" = "Box", .writable = true }} }, .{ .id = "outer", .parent = null, .slots = &.{} } },
    .globals = &.{.{ .id = "root", .@"type" = "Box" }}, .fields = &.{"field"},
    .constructions = &.{.{ .id = "role", .owner = "Box", .base = null, .kind = .explicit, .function_id = "ctor" }},
};
const Fixture = struct {
    nodes: [11]model.Value = .{
        .receiver_input,
        .{ .environment_input = .{ .layout = "outer" } },
        .{ .environment_create = .{ .layout = "inner", .parent = &.{1}, .site = "body:env", .control = 0 } },
        .{ .parameter = .{ .@"type" = "Box", .index = 1 } },
        .{ .code = .{ .@"type" = "Code", .function_id = "child", .environment = &.{2}, .control = 0 } },
        .{ .environment_component = .{ .layout = "inner", .function_id = "child", .callee = &.{4}, .control = 0 } },
        .{ .global = .{ .@"type" = "Box", .id = "root" } },
        .{ .local = .{ .@"type" = "Box" } },
        .{ .projection = .{ .@"type" = "Box", .bases = &.{6}, .selector = "field:field", .view = "Box", .heap = 1, .control = 0 } },
        .{ .receiver_value = .{ .@"type" = "Box", .action = 2 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 3 } },
    },
    heaps: [4]model.Heap = .{
        .entry,
        .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "capture:value", .view = "env:inner", .values = &.{3}, .control = 0, .initialize = true } },
        .{ .receiver_action = .{ .previous = 1, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{4}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{4}, .completion = .language } },
    },
    fn graph(self: *const Fixture) model.Graph {
        return .{ .nodes = &self.nodes, .heaps = &self.heaps,
            .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 3 } } },
            .calls = &.{}, .normal = &.{9}, .language = &.{10}, .exits = .{ .normal = &.{.{ .heap = 2, .control = 1 }}, .language = &.{.{ .heap = 3, .control = 2 }} },
            .accesses = &.{.{ .values = &.{6}, .flag = .read, .control = 0 }} };
    }
};
fn inclusion(left: *const model.Graph, right: *const model.Graph) !certificates.Inclusion {
    var meter: Meter = .{}; var budget = meter.budget();
    try model.validateDirectory(std.testing.allocator, &directory, &budget);
    for ([_]*const model.Graph{ left, right }) |graph| {
        const validation = try model.validateGraph(std.testing.allocator, &directory, "ctor", graph, &budget);
        try std.testing.expect(validation == .pending); try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
    }
    return certificates.covered(std.testing.allocator, &directory, "ctor", left, &.{ .{ .function_id = "child", .graph = null }, .{ .function_id = "ctor", .graph = right } }, &budget);
}
fn missing(left: *const model.Graph, right: *const model.Graph) !void {
    const result = try inclusion(left, right); try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
}
test "receiver structural certificate matches complete ENV code components ordinary roots and projections" {
    const left: Fixture = .{}; var right: Fixture = .{}; right.nodes[2].environment_create.site = "upper:env";
    const a = left.graph(); const b = right.graph();
    try std.testing.expect((try inclusion(&a, &b)) == .covered); try std.testing.expect((try inclusion(&b, &a)) == .covered);
}
test "receiver certificate cannot exchange an ENV component callee or ordinary projection base" {
    const left: Fixture = .{}; const a = left.graph(); var right: Fixture = .{}; right.nodes[2].environment_create.site = "upper:env";
    right.nodes[5].environment_component.callee = &.{7}; var b = right.graph(); try missing(&a, &b);
    right = .{}; right.nodes[2].environment_create.site = "upper:env"; right.nodes[8].projection.bases = &.{7}; b = right.graph(); try missing(&a, &b);
}
test "receiver certificate preserves ignored local identity and projection heap" {
    const left: Fixture = .{}; const a = left.graph(); var right: Fixture = .{}; right.nodes[2].environment_create.site = "upper:env";
    right.nodes[7] = right.nodes[6]; var b = right.graph(); try missing(&a, &b);
    right = .{}; right.nodes[2].environment_create.site = "upper:env"; right.nodes[8].projection.heap = 0; b = right.graph(); try missing(&a, &b);
}
