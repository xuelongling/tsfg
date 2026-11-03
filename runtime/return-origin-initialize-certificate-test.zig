// SPDX-License-Identifier: MIT
// Independent Graph5 DTO at the existing structural.covered API. Both graphs
// are typed and valid before the certificate query. No Body/Program, Source
// archive, publication packet, State or executable input is constructed.
const std = @import("std");
const origin = @import("wire-program-return-origin-model.zig");
const inclusion = @import("wire-program-return-origins.zig");
const scalar = "scalar";
const function_id = "function";
const layout_id = "layout";
const key = "slot";
const directory = origin.Directory{
    .types = &.{.{ .id = scalar, .kind = .scalar }},
    .functions = &.{.{ .id = function_id, .kind = .source, .parameter_types = &.{}, .return_type = scalar,
        .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = layout_id, .construction = null }},
    .environments = &.{.{ .id = layout_id, .parent = null, .slots = &.{.{ .key = key, .@"type" = scalar, .writable = true }} }},
    .fields = &.{}, .globals = &.{}, .constructions = &.{},
};
const nodes = [_]origin.Value{
    .{ .literal = .{ .@"type" = scalar, .category = .other } },
    .{ .environment_create = .{ .layout = layout_id, .parent = null, .site = "activation", .control = 0 } },
    .{ .capture = .{ .@"type" = scalar, .id = key, .layout = layout_id, .environment = &.{1}, .heap = 1, .control = 0 } },
};
const heaps = [_]origin.Heap{
    .entry,
    .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "capture:" ++ key, .view = "env:" ++ layout_id,
        .values = &.{0}, .control = 0, .initialize = true } },
};
const graph = origin.Graph{ .nodes = &nodes, .heaps = &heaps, .controls = &.{.entry}, .calls = &.{},
    .normal = &.{2}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{} }, .accesses = &.{} };
const Meter = struct {
    remaining: usize = 1_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer));
        if (units > self.remaining) return error.BudgetExceeded; self.remaining -= units;
    }
};

test "matching lexical slot initialization has a complete fixed certificate" {
    var meter: Meter = .{}; var budget = origin.Budget{ .context = &meter, .charge = Meter.charge };
    try origin.validateDirectory(std.testing.allocator, &directory, &budget);
    try std.testing.expect((try origin.validateGraph(std.testing.allocator, &directory, function_id, &graph, &budget)) == .valid);
    const fixed = [_]inclusion.FixedContract{.{ .function_id = function_id, .graph = &graph }};
    try std.testing.expect((try inclusion.covered(std.testing.allocator, &directory, function_id, &graph, &fixed, &budget)) == .covered);
}

test "a slot store cannot stand in for the fixed initialization edge" {
    var meter: Meter = .{}; var budget = origin.Budget{ .context = &meter, .charge = Meter.charge };
    var body_heaps = heaps; body_heaps[1].store.initialize = false;
    var body = graph; body.heaps = &body_heaps;
    try origin.validateDirectory(std.testing.allocator, &directory, &budget);
    try std.testing.expect((try origin.validateGraph(std.testing.allocator, &directory, function_id, &body, &budget)) == .valid);
    try std.testing.expect((try origin.validateGraph(std.testing.allocator, &directory, function_id, &graph, &budget)) == .valid);
    const fixed = [_]inclusion.FixedContract{.{ .function_id = function_id, .graph = &graph }};
    const result = try inclusion.covered(std.testing.allocator, &directory, function_id, &body, &fixed, &budget);
    try std.testing.expect(result == .pending);
    try std.testing.expectEqual(inclusion.Pending.no_structural_certificate, result.pending);
}
