// SPDX-License-Identifier: MIT
// Passive literal Graph5 regressions. No Source package or VM entrance.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-nested-fixed-dto.zig");
const Meter = struct {
    left: usize = 100000000, spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [3]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{} },
        .{ .function_id = dto.final_callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [3]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[2].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.a, .fields = &.{} }, .{ .type_id = dto.b, .fields = &.{} },
    .{ .type_id = dto.c, .fields = &.{.{ .id = dto.field, .view = dto.c, .physical = 0, .type_id = dto.scalar }} },
};
fn validate(contracts: *const @TypeOf(dto.contracts), graph: *const m.Graph, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const checked = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(checked == .pending and checked.pending == .construction_frame);
    for (contracts, [_]m.Symbol{ dto.caller, dto.callee, dto.final_callee }) |row, id| if (row.return_origins) |*dependency| {
        const leaf = try m.validateGraph(std.testing.allocator, &dto.directory, id, dependency, budget);
        try std.testing.expect(leaf == .pending and leaf.pending == .construction_frame);
    };
}
test "nested constructor original local Ref collision never becomes caller B or B input0" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.contracts, &dto.caller_graph, &budget);
    const fixed = fixedRows(&dto.contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and result.calls.len == 1 and result.normal.len == 1);
    const b = result.calls[0]; const c = b.analysis.calls[0];
    try std.testing.expectEqual(b.receiver, c.receiver); try std.testing.expectEqual(@as(usize, 1), c.receiver);
    try std.testing.expectEqualStrings(dto.b, result.frames[b.receiver].new_target.?);
    try std.testing.expectEqualStrings(dto.c, b.analysis.frames[c.receiver].new_target.?);
    const atom = result.normal[0];
    try std.testing.expect(atom.source == .scoped_allocation and atom.source.scoped_allocation.analysis == b.analysis and atom.source.scoped_allocation.frame == c.receiver);
    const rows = ownerRows(&dto.contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expect(content.pending == null and content.normal.len == 1);
    const location = content.locations[content.normal[0]];
    try std.testing.expectEqual(@as(usize, 1), location.scope); try std.testing.expectEqual(c.receiver, location.node); try std.testing.expectEqualStrings(dto.c, location.type_id.?);
}
test "nested constructor absent fixed leaf and active call cycle stay Pending" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var contracts = dto.contracts; contracts[2].return_origins = null;
    var fixed = fixedRows(&contracts); try validate(&contracts, &dto.caller_graph, &budget);
    var missing = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer missing.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), missing.pending);
    var nodes = dto.middle_graph.nodes[0..6].*; nodes[1].receiver_frame.construction = dto.role_a; nodes[1].receiver_frame.new_target = dto.a; nodes[2].call.@"type" = dto.a;
    var calls = dto.middle_graph.calls[0..1].*; calls[0].function_id = dto.caller;
    var middle = dto.middle_graph; middle.nodes = &nodes; middle.calls = &calls;
    contracts = dto.contracts; contracts[1].return_origins = middle; fixed = fixedRows(&contracts); try validate(&contracts, &dto.caller_graph, &budget);
    var cycle = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer cycle.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), cycle.pending);
}
test "nested constructor language errors retain each original completion namespace" {
    var nodes: [7]m.Value = undefined; @memcpy(nodes[0..6], dto.leaf.nodes); nodes[6] = .{ .receiver_value = .{ .@"type" = null, .action = 5 } };
    var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.leaf.heaps); heaps[5] = .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .get, .operands = &.{}, .completion = .language } };
    var controls: [5]m.Control = undefined; @memcpy(controls[0..4], dto.leaf.controls); controls[4] = .{ .receiver_completion = .{ .action = 5 } };
    var leaf = dto.leaf; leaf.nodes = &nodes; leaf.heaps = &heaps; leaf.controls = &controls; leaf.language = &.{6}; leaf.exits.language = &.{.{ .heap = 5, .control = 4 }};
    var contracts = dto.contracts; contracts[2].return_origins = leaf; contracts[0].upper.facets.may_throw = true; contracts[1].upper.facets.may_throw = true; contracts[2].upper.facets.may_throw = true;
    const fixed = fixedRows(&contracts); var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and result.normal_live and result.language_live);
    const middle = result.calls[0].analysis; const inner = middle.calls[0].analysis;
    try std.testing.expect(inner.language[0].source == .language_error and inner.language[0].source.language_error == 5);
    try std.testing.expect(middle.language[0].source == .language_error and middle.language[0].source.language_error == 2);
    try std.testing.expect(result.language[0].source == .language_error and result.language[0].source.language_error == 2);
    const rows = ownerRows(&contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expect(content.pending == null and content.normal_live and content.language_live);
    try std.testing.expectEqual(@as(usize, 1), content.language.len);
    const language_location = content.locations[content.language[0]];
    try std.testing.expectEqual(@as(usize, 0), language_location.scope);
    try std.testing.expectEqual(@as(usize, 2), language_location.node);
    try std.testing.expect(content.normal[0] != content.language[0]);
    try std.testing.expectEqualStrings("receiver-language-error", content.locations[content.language[0]].key.?);
}
test "nested constructor keeps full leaf upper and original cumulative Budget" {
    var contracts = dto.contracts; contracts[2].upper.facets.may_throw = true; var fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var incompatible = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer incompatible.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_completion), incompatible.pending);
    contracts = dto.contracts; fixed = fixedRows(&contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and meter.spent != 0);
    var rows = ownerRows(&contracts); rows[2].parameters = &.{.{ .write = false }};
    var rejected = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer rejected.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), rejected.pending);
    rows = ownerRows(&contracts); meter.left = 0;
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result));
    try std.testing.expectEqual(@as(usize, 0), meter.left);
}
test "nested constructor late missing C field never borrows B empty MUST inventory" {
    var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.leaf.heaps);
    heaps[5] = .{ .join = .{ .inputs = &.{ 2, 3 } } }; heaps[4].receiver_action.previous = 5;
    var leaf = dto.leaf; leaf.heaps = &heaps;
    var contracts = dto.contracts; contracts[2].return_origins = leaf; const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null);
    const b = result.calls[0].analysis; const c = b.calls[0].analysis;
    try std.testing.expectEqual(@as(usize, 0), b.input_exits.?.normal.missing_fields.?.len);
    try std.testing.expectEqual(@as(usize, 1), c.input_exits.?.normal.missing_fields.?.len);
    try std.testing.expectEqualStrings(dto.field, c.input_exits.?.normal.missing_fields.?[0]);
    const rows = ownerRows(&contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .payload_uninitialized), content.pending);
}
test "nested same fixed B in two callsites keeps two original C births" {
    var nodes: [9]m.Value = undefined; @memcpy(nodes[0..6], dto.caller_graph.nodes);
    nodes[6] = .{ .receiver_frame = .{ .construction = dto.role_b, .new_target = dto.b, .parent = null, .site = "caller:second-new-B", .control = 1 } };
    nodes[7] = .{ .call = .{ .@"type" = dto.b, .call = 1, .completion = .normal } };
    nodes[8] = .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } };
    var heaps: [7]m.Heap = undefined; @memcpy(heaps[0..5], dto.caller_graph.heaps);
    heaps[3].receiver_action.previous = 5; heaps[3].receiver_action.control = 5; heaps[3].receiver_action.operands = &.{ 2, 7 };
    heaps[4].receiver_action.previous = 5; heaps[4].receiver_action.control = 5; heaps[4].receiver_action.operands = &.{ 2, 7 };
    heaps[5] = .{ .call = .{ .call = 1, .completion = .normal } }; heaps[6] = .{ .call = .{ .call = 1, .completion = .language } };
    var controls: [7]m.Control = undefined; @memcpy(controls[0..5], dto.caller_graph.controls);
    controls[5] = .{ .call = .{ .call = 1, .completion = .normal } }; controls[6] = .{ .call = .{ .call = 1, .completion = .language } };
    var calls: [2]m.Call = undefined; calls[0] = dto.caller_graph.calls[0]; calls[1] = calls[0];
    calls[1].receiver = &.{6}; calls[1].heap = 1; calls[1].control = 1; calls[1].site = "caller:second-construct-B";
    var graph = dto.caller_graph; graph.nodes = &nodes; graph.heaps = &heaps; graph.controls = &controls; graph.calls = &calls;
    graph.language = &.{ 3, 5, 8 }; graph.exits.language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 } };
    const fixed = fixedRows(&dto.contracts); var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and result.calls.len == 2 and result.normal.len == 2);
    const b0 = result.calls[0].analysis; const b1 = result.calls[1].analysis;
    try std.testing.expect(b0 != b1 and b0.calls[0].graph == b1.calls[0].graph);
    try std.testing.expect(b0.calls[0].analysis != b1.calls[0].analysis);
    try std.testing.expectEqual(b0.calls[0].receiver, b1.calls[0].receiver);
    const rows = ownerRows(&dto.contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expect(content.pending == null and content.normal.len == 2 and content.normal_payloads.len == 2);
    const first = content.locations[content.normal[0]]; const second = content.locations[content.normal[1]];
    try std.testing.expect(first.scope != second.scope and first.node == second.node);
    try std.testing.expectEqualStrings(dto.c, first.type_id.?); try std.testing.expectEqualStrings(dto.c, second.type_id.?);
}
