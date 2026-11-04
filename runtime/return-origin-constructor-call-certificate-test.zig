// SPDX-License-Identifier: MIT
// Independent original-equation fixed-call certificates. Full source rows are
// borrowed metadata premises, not asserted Source/digest admission receipts.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const certificates = @import("wire-program-return-origins.zig");
const dto = @import("constructor-call-literal-dto.zig");
const Meter = struct {
    remaining: usize = 300_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void { const self: *Meter = @ptrCast(@alignCast(raw)); if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; } self.remaining -= count; }
    fn budget(self: *Meter) m.Budget { return .{ .context = self, .charge = charge }; }
};
fn fixed(contracts: *const [2]domain.PublicationContract) [2]domain.FixedFunction {
    return .{ .{ .function_id = dto.caller, .contract = &contracts[0], .declaration = &dto.declarations[0] }, .{ .function_id = dto.callee, .contract = &contracts[1], .declaration = &dto.declarations[1] } };
}
fn checked(graph: *const m.Graph, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(validation == .pending); try std.testing.expectEqual(m.Pending.construction_frame, validation.pending);
    const leaf = try m.validateGraph(std.testing.allocator, &dto.directory, dto.callee, &dto.leaf, budget);
    try std.testing.expect(leaf == .pending); try std.testing.expectEqual(m.Pending.construction_frame, leaf.pending);
}
test "constructor call structural certificate preserves distinct frame and call sites" {
    var nodes: [6]m.Value = dto.caller_graph.nodes[0..6].*; nodes[1].receiver_frame.site = "upper:fresh-B";
    var calls: [1]m.Call = dto.caller_graph.calls[0..1].*; calls[0].site = "upper:call-B";
    var upper = dto.caller_graph; upper.nodes = &nodes; upper.calls = &calls;
    var contracts = dto.contracts; contracts[0].return_origins = upper; const complete = fixed(&contracts);
    const rows = [_]certificates.FixedContract{ .{ .function_id = dto.caller, .graph = &upper, .complete = &complete[0] }, .{ .function_id = dto.callee, .graph = &dto.leaf, .complete = &complete[1] } };
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &budget); try checked(&upper, &budget);
    try std.testing.expect((try certificates.covered(std.testing.allocator, &dto.directory, dto.caller, &dto.caller_graph, &rows, &budget)) == .covered);
    const reverse = [_]certificates.FixedContract{ .{ .function_id = dto.caller, .graph = &dto.caller_graph, .complete = &complete[0] }, rows[1] };
    try std.testing.expect((try certificates.covered(std.testing.allocator, &dto.directory, dto.caller, &upper, &reverse, &budget)) == .covered);
}
test "constructor call graph-only rows cannot replace complete fixed metadata" {
    const rows = [_]certificates.FixedContract{ .{ .function_id = dto.caller, .graph = &dto.caller_graph }, .{ .function_id = dto.callee, .graph = &dto.leaf } };
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &budget);
    const result = try certificates.covered(std.testing.allocator, &dto.directory, dto.caller, &dto.caller_graph, &rows, &budget);
    try std.testing.expect(result == .pending); try std.testing.expectEqual(certificates.Pending.graph_protocol, result.pending);
}
test "constructor call certificate cannot erase its normal heap or merge its site with frame creation" {
    var heaps: [5]m.Heap = dto.caller_graph.heaps[0..5].*; heaps[1] = .{ .join = .{ .inputs = &.{0} } };
    var upper = dto.caller_graph; upper.heaps = &heaps; var contracts = dto.contracts; contracts[0].return_origins = upper; var complete = fixed(&contracts);
    var rows = [_]certificates.FixedContract{ .{ .function_id = dto.caller, .graph = &upper, .complete = &complete[0] }, .{ .function_id = dto.callee, .graph = &dto.leaf, .complete = &complete[1] } };
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &budget); try checked(&upper, &budget);
    var result = try certificates.covered(std.testing.allocator, &dto.directory, dto.caller, &dto.caller_graph, &rows, &budget);
    try std.testing.expect(result == .pending); try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
    upper = dto.caller_graph; var calls: [1]m.Call = dto.caller_graph.calls[0..1].*; calls[0].site = dto.caller_graph.nodes[1].receiver_frame.site; upper.calls = &calls;
    contracts[0].return_origins = upper; complete = fixed(&contracts); rows[0].graph = &upper;
    try checked(&upper, &budget); result = try certificates.covered(std.testing.allocator, &dto.directory, dto.caller, &dto.caller_graph, &rows, &budget);
    try std.testing.expect(result == .pending); try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
}
test "constructor recursive and unknown fixed dependencies remain Pending" {
    var leaf = dto.leaf; leaf.calls = &.{.{ .function_id = dto.callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{0}, .heap = 0, .control = 0, .site = "callee:recursive" }};
    var contracts = dto.contracts; contracts[1].return_origins = leaf; var complete = fixed(&contracts);
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &budget);
    var validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.callee, &leaf, &budget); try std.testing.expect(validation == .pending);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &complete }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), result.pending);
    var nodes: [6]m.Value = dto.leaf.nodes[0..6].*; nodes[4] = .unknown; leaf = dto.leaf; leaf.nodes = &nodes; contracts[1].return_origins = leaf; complete = fixed(&contracts);
    validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.callee, &leaf, &budget); try std.testing.expect(validation == .pending);
    var unknown = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &complete }); defer unknown.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), unknown.pending);
}
test "constructor call receiver role and Data argument count fail at the original model boundary" {
    var calls: [1]m.Call = dto.caller_graph.calls[0..1].*; var graph = dto.caller_graph; graph.calls = &calls;
    var meter: Meter = .{}; var budget = meter.budget(); try m.validateDirectory(std.testing.allocator, &dto.directory, &budget);
    calls[0].receiver = &.{0}; try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &graph, &budget));
    calls[0] = dto.caller_graph.calls[0]; calls[0].arguments = &.{&.{2}};
    try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &graph, &budget));
}
