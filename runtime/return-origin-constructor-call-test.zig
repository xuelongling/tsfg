// SPDX-License-Identifier: MIT
// New FormalInput API over the same literal DTO as the separately preserved
// old Symbol-API baseline. No full Source/digest/Actual admission is asserted.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const dto = @import("constructor-call-literal-dto.zig");
const Meter = struct {
    remaining: usize = 300_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void { const self: *Meter = @ptrCast(@alignCast(raw)); if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; } self.remaining -= count; }
    fn budget(self: *Meter) m.Budget { return .{ .context = self, .charge = charge }; }
};
fn fixed(contracts: *const [2]domain.PublicationContract) [2]domain.FixedFunction {
    return .{ .{ .function_id = dto.caller, .contract = &contracts[0], .declaration = &dto.declarations[0] }, .{ .function_id = dto.callee, .contract = &contracts[1], .declaration = &dto.declarations[1] } };
}
fn checked(graph: *const m.Graph, contracts: *const [2]domain.PublicationContract, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(validation == .pending); try std.testing.expectEqual(m.Pending.construction_frame, validation.pending);
    for (contracts, [_]m.Symbol{ dto.caller, dto.callee }) |*row, id| {
        if (row.return_origins) |*original| { const input = try m.validateGraph(std.testing.allocator, &dto.directory, id, original, budget); try std.testing.expect(input == .pending); try std.testing.expectEqual(m.Pending.construction_frame, input.pending); }
    }
}
test "fixed constructor calls preserve caller frame identity and original callee prefix scope" {
    var meter: Meter = .{}; var budget = meter.budget(); const rows = fixed(&dto.contracts); try checked(&dto.caller_graph, &dto.contracts, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending); try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len); try std.testing.expect(result.normal[0].source == .allocation and result.normal[0].source.allocation == 1);
    try std.testing.expect(result.frames[0].new_target == null); try std.testing.expectEqualStrings(dto.b, result.frames[1].new_target.?);
    const call = result.calls[0]; try std.testing.expectEqual(@as(usize, 0), call.call); try std.testing.expectEqual(@as(usize, 1), call.receiver); try std.testing.expectEqual(@as(usize, 0), call.input);
    try std.testing.expect(call.fixed.contract == &dto.contracts[1]); try std.testing.expect(call.fixed.declaration == &dto.declarations[1]); try std.testing.expect(call.graph == &dto.contracts[1].return_origins.?);
    const write = call.analysis.initializations[0]; try std.testing.expectEqual(@as(usize, 3), write.store);
    try std.testing.expectEqualStrings("field:" ++ dto.field, call.graph.heaps[write.store].store.selector);
    try std.testing.expect(write.base.source == .allocation and write.base.source.allocation == call.input); try std.testing.expect(write.value.source == .node and write.value.source.node == 3);
    const exits = call.analysis.input_exits.?; try std.testing.expect(exits.normal.live and !exits.normal.unbound and !exits.language.live);
    try std.testing.expectEqual(@as(usize, 1), exits.normal.atoms.len); try std.testing.expect(exits.normal.atoms[0].source == .allocation and exits.normal.atoms[0].source.allocation == call.input);
    // The ALL-prefix summary still includes the unbound entry; it must never
    // replace the precise normal exit state used to restore the caller World.
    try std.testing.expect(call.analysis.frames[call.input].may_unbound);
    try std.testing.expect(result.heap_live[1] and !result.heap_live[2]); try std.testing.expect(result.controls[1] and !result.controls[2]);
}
test "full mayThrow cannot be narrowed to a normal-only fixed constructor graph" {
    var contracts = dto.contracts; contracts[1].upper.facets.may_throw = true; const rows = fixed(&contracts);
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &contracts, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_completion), result.pending);
}
test "missing fixed constructor relations and incomplete fixed vectors remain Pending" {
    var contracts = dto.contracts; contracts[1].return_origins = null; var rows = fixed(&contracts);
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &contracts, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), result.pending);
    rows = fixed(&dto.contracts); var incomplete = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = rows[0..1] }); defer incomplete.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), incomplete.pending);
}
test "fixed constructor language completion keeps distinct callee and caller error namespaces" {
    var nodes: [7]m.Value = undefined; @memcpy(nodes[0..6], dto.leaf.nodes); nodes[6] = .{ .receiver_value = .{ .@"type" = null, .action = 5 } };
    var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.leaf.heaps); heaps[5] = .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .get, .operands = &.{}, .completion = .language } };
    var controls: [5]m.Control = undefined; @memcpy(controls[0..4], dto.leaf.controls); controls[4] = .{ .receiver_completion = .{ .action = 5 } };
    var leaf = dto.leaf; leaf.nodes = &nodes; leaf.heaps = &heaps; leaf.controls = &controls; leaf.language = &.{6}; leaf.exits.language = &.{.{ .heap = 5, .control = 4 }};
    var contracts = dto.contracts; contracts[1].return_origins = leaf; contracts[1].upper.facets.may_throw = true; const rows = fixed(&contracts);
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &contracts, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending); try std.testing.expect(result.normal_live and result.language_live);
    const called = result.calls[0].analysis; try std.testing.expect(called.language[0].source == .language_error and called.language[0].source.language_error == 5);
    try std.testing.expect(result.language[0].source == .language_error and result.language[0].source.language_error == 2);
    try std.testing.expect(called.input_exits.?.language.live and called.input_exits.?.language.unbound); try std.testing.expectEqual(@as(usize, 0), called.input_exits.?.language.atoms.len);
    try std.testing.expect(called.input_exits.?.normal.live and !called.input_exits.?.normal.unbound); try std.testing.expect(result.heap_live[1] and result.heap_live[2]);
}
test "callee-local object return provenance is not relabeled as a caller node" {
    var nodes: [6]m.Value = dto.leaf.nodes[0..6].*; nodes[4] = .{ .local = .{ .@"type" = dto.b } };
    var leaf = dto.leaf; leaf.nodes = &nodes; var contracts = dto.contracts; contracts[1].return_origins = leaf; const rows = fixed(&contracts);
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &contracts, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_origin), result.pending);
}
test "constructor fixed calls share the original exhausted meter" {
    const rows = fixed(&dto.contracts); var meter: Meter = .{}; var budget = meter.budget(); try checked(&dto.caller_graph, &dto.contracts, &budget); meter.remaining = 1;
    try std.testing.expectError(error.BudgetExceeded, domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows })); try std.testing.expectEqual(@as(usize, 0), meter.remaining);
}
