// SPDX-License-Identifier: MIT
// Independent passive Graph5 controls for the scoped Ref Data proof.
// The separate strict typed fixture owns Context/ABI/layout/SSA/correspondence.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-scoped-ref-dto.zig");
const Meter = struct {
    left: usize = 100000000, spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [4]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.native_callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
        .{ .function_id = dto.final_callee, .declaration = &dto.declarations[3], .contract = &contracts[3], .initialization_fields = &.{dto.native_field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [4]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.c, .fields = &.{} }, .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.a }} },
    .{ .type_id = dto.actual_c, .fields = &.{.{ .id = dto.native_field, .view = dto.actual_c, .physical = 0, .type_id = dto.scalar }} },
};
fn validate(contracts: *const @TypeOf(dto.contracts), graph: *const m.Graph, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const checked = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(checked == .pending and checked.pending == .construction_frame);
    for (contracts, [_]m.Symbol{ dto.caller, dto.native_callee, dto.callee, dto.final_callee }) |row, id| if (row.return_origins) |*dependency| {
        const leaf = try m.validateGraph(std.testing.allocator, &dto.directory, id, dependency, budget);
        try std.testing.expect(leaf == .pending and leaf.pending == .construction_frame);
    };
}
test "late C missing field cannot borrow known-empty B inventory for D Ref Data" {
    var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.actual_leaf.heaps);
    heaps[5] = .{ .join = .{ .inputs = &.{ 2, 3 } } }; heaps[4].receiver_action.previous = 5;
    var leaf = dto.actual_leaf; leaf.heaps = &heaps;
    var contracts = dto.contracts; contracts[3].return_origins = leaf; const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
    try std.testing.expectEqual(@as(usize, 1), result.calls.len);
    const b = result.calls[0].analysis; const c = b.calls[0];
    try std.testing.expectEqual(@as(usize, 0), b.input_exits.?.normal.missing_fields.?.len);
    try std.testing.expectEqual(@as(usize, 1), b.frames[c.receiver].normal.missing_fields.?.len);
    try std.testing.expectEqualStrings(dto.native_field, b.frames[c.receiver].normal.missing_fields.?[0]);
    // MAY writes contain the field even though a final normal predecessor lacks it.
    try std.testing.expectEqual(@as(usize, 1), c.analysis.initializations.len);
}
test "scoped normal and partial language C keep independent completion proofs" {
    var leaf = dto.actual_leaf; leaf.language = &.{2}; leaf.exits.language = &.{.{ .heap = 2, .control = 2 }};
    var contracts = dto.contracts; contracts[3].return_origins = leaf;
    contracts[0].upper.facets.may_throw = true; contracts[1].upper.facets.may_throw = true; contracts[3].upper.facets.may_throw = true;
    const calls = dto.caller_graph.calls[0..1].*;
    var graph = dto.caller_graph; graph.nodes = dto.caller_graph.nodes[0..4]; graph.heaps = dto.caller_graph.heaps[0..3]; graph.controls = dto.caller_graph.controls[0..3]; graph.calls = &calls;
    graph.normal = &.{2}; graph.language = &.{3}; graph.exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} };
    const fixed = fixedRows(&contracts); var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len); try std.testing.expectEqual(@as(usize, 1), result.language.len);
    const normal = result.normal[0].source.scoped_allocation; const language = result.language[0].source.scoped_allocation;
    try std.testing.expect(normal.analysis == language.analysis and normal.frame == language.frame);
    try std.testing.expectEqual(m.Completion.normal, normal.completion); try std.testing.expectEqual(m.Completion.language, language.completion);
    const original = normal.analysis.frames[normal.frame];
    try std.testing.expectEqual(@as(usize, 0), original.normal.missing_fields.?.len);
    try std.testing.expectEqualSlices(m.Symbol, &.{dto.native_field}, original.language.missing_fields.?);
    // A language-origin Data alternative is never licensed by normal MUST.
    var nodes: [11]m.Value = undefined; @memcpy(nodes[0..9], dto.caller_graph.nodes);
    nodes[4].receiver_frame.control = 7;
    nodes[9] = .{ .receiver_value = .{ .@"type" = dto.a, .action = 7 } };
    nodes[10] = .{ .receiver_frame = .{ .construction = dto.role_a, .new_target = dto.a, .parent = null, .site = "A:bind-caught-C", .control = 2 } };
    var full_heaps: [8]m.Heap = undefined; @memcpy(full_heaps[0..7], dto.caller_graph.heaps);
    full_heaps[7] = .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{10}, .action = .bind, .operands = &.{3}, .completion = .normal } };
    var full_controls: [8]m.Control = undefined; @memcpy(full_controls[0..7], dto.caller_graph.controls);
    full_controls[7] = .{ .receiver_completion = .{ .action = 7 } };
    var full_calls = dto.caller_graph.calls[0..2].*; full_calls[1].arguments = &.{&.{9}}; full_calls[1].heap = 7; full_calls[1].control = 7;
    graph = dto.caller_graph; graph.nodes = &nodes; graph.heaps = &full_heaps; graph.controls = &full_controls; graph.calls = &full_calls; try validate(&contracts, &graph, &budget);
    var rejected = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer rejected.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), rejected.pending);
}
test "two same B original calls supply two distinct C births into one D field" {
    var nodes: [13]m.Value = undefined; @memcpy(nodes[0..9], dto.caller_graph.nodes);
    nodes[9] = .{ .receiver_frame = .{ .construction = dto.role_a, .new_target = dto.a, .parent = null, .site = "A:second-new-B", .control = 1 } };
    nodes[10] = .{ .call = .{ .@"type" = dto.a, .call = 2, .completion = .normal } }; nodes[11] = .{ .call = .{ .@"type" = null, .call = 2, .completion = .language } };
    nodes[12] = .{ .join = .{ .@"type" = dto.a, .inputs = &.{ 2, 10 } } };
    var heaps: [10]m.Heap = undefined; @memcpy(heaps[0..7], dto.caller_graph.heaps);
    heaps[7] = .{ .call = .{ .call = 2, .completion = .normal } }; heaps[8] = .{ .call = .{ .call = 2, .completion = .language } };
    heaps[9] = .{ .join = .{ .inputs = &.{ 1, 7 } } };
    var controls: [10]m.Control = undefined; @memcpy(controls[0..7], dto.caller_graph.controls);
    controls[7] = .{ .call = .{ .call = 2, .completion = .normal } }; controls[8] = .{ .call = .{ .call = 2, .completion = .language } };
    controls[9] = .{ .join = .{ .inputs = &.{ 1, 7 } } }; nodes[4].receiver_frame.control = 9;
    var calls: [3]m.Call = undefined; @memcpy(calls[0..2], dto.caller_graph.calls);
    calls[1].arguments = &.{&.{12}}; calls[1].heap = 9; calls[1].control = 9;
    calls[2] = calls[0]; calls[2].receiver = &.{9}; calls[2].heap = 1; calls[2].control = 1; calls[2].site = "A:second-construct-B";
    var graph = dto.caller_graph; graph.nodes = &nodes; graph.heaps = &heaps; graph.controls = &controls; graph.calls = &calls;
    graph.language = &.{ 3, 6, 8, 11 }; graph.exits.language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 }, .{ .heap = 8, .control = 8 } };
    const fixed = fixedRows(&dto.contracts); var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and result.calls.len == 3);
    var births: [2]*const domain.Analysis = undefined; var birth_count: usize = 0;
    for (result.calls) |fact| if (fact.call != 1) { births[birth_count] = fact.analysis; birth_count += 1; };
    try std.testing.expect(birth_count == 2 and births[0] != births[1]);
    try std.testing.expect(births[0].calls[0].analysis != births[1].calls[0].analysis);
    try std.testing.expectEqual(births[0].calls[0].receiver, births[1].calls[0].receiver);
    const rows = ownerRows(&dto.contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expect(content.pending == null and content.normal.len == 1 and content.normal_payloads.len == 3);
    var holder: ?owners.Payload = null;
    for (content.normal_payloads) |row| if (std.mem.eql(u8, row.type_id, dto.b)) { holder = row; };
    const values = holder.?.slots[0].values; try std.testing.expectEqual(@as(usize, 2), values.len);
    const first = content.locations[values[0]]; const second = content.locations[values[1]];
    try std.testing.expect(first.scope != second.scope and first.node == second.node);
    try std.testing.expectEqualStrings(dto.actual_c, first.type_id.?); try std.testing.expectEqualStrings(dto.actual_c, second.type_id.?);
    var native_count: usize = 0;
    for (content.normal_payloads) |row| if (std.mem.eql(u8, row.type_id, dto.actual_c)) {
        native_count += 1; try std.testing.expectEqualStrings("field:" ++ dto.native_field, row.slots[0].selector);
        try std.testing.expectEqual(@as(usize, 1), row.slots[0].values.len); try std.testing.expect(content.locations[row.slots[0].values[0]].owner == .nonowning);
    };
    try std.testing.expectEqual(@as(usize, 2), native_count);
    // The first B branch can make the join ready and create D before the
    // second B branch supplies its original C. A nonempty truncated proof
    // must not let that old target hide the final two-value argument Set.
    var borrowed = result; var facts: [3]domain.CallFact = undefined; @memcpy(&facts, result.calls);
    var proof_arguments: [2][]const domain.Atom = undefined; var first_atom: [1]domain.Atom = undefined;
    for (&facts) |*fact| if (fact.call == 1) {
        try std.testing.expectEqual(@as(usize, 2), fact.arguments[1].len);
        first_atom[0] = fact.arguments[1][0]; proof_arguments = .{ &.{}, &first_atom }; fact.arguments = &proof_arguments;
    };
    borrowed.calls = &facts;
    var stale = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &graph, &rows, &budget, &borrowed); defer stale.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), stale.pending);
}
test "scoped Data unknown inventory missing graph and unsupported unknown stay Pending" {
    var contracts = dto.contracts; var fixed = fixedRows(&contracts);
    fixed[3].initialization_fields = null;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var inventory = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer inventory.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), inventory.pending);
    contracts[3].return_origins = null; fixed = fixedRows(&contracts);
    var missing = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer missing.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_call), missing.pending);
    var unknown_nodes: [7]m.Value = undefined; @memcpy(unknown_nodes[0..6], dto.actual_leaf.nodes); unknown_nodes[6] = .unknown;
    var unknown = dto.actual_leaf; unknown.nodes = &unknown_nodes; contracts = dto.contracts; contracts[3].return_origins = unknown; fixed = fixedRows(&contracts); try validate(&contracts, &dto.caller_graph, &budget);
    var unsupported = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer unsupported.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .unknown_origin), unsupported.pending);
}
test "scoped Ref keeps complete Upper flags original Set and cumulative Budget" {
    var contracts = dto.contracts; contracts[3].upper.facets.may_throw = true; var fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&contracts, &dto.caller_graph, &budget);
    var completion = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer completion.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .fixed_completion), completion.pending);
    contracts = dto.contracts; fixed = fixedRows(&contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null and meter.spent != 0);
    var rows = ownerRows(&contracts); rows[2].parameters = &.{ .{ .write = true }, .{ .read = true } };
    var flags = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result); defer flags.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), flags.pending);
    rows = ownerRows(&contracts); var borrowed = result; var facts: [2]domain.CallFact = undefined; @memcpy(&facts, result.calls);
    for (&facts) |*fact| if (fact.call == 1) { fact.arguments = &.{ &.{}, &.{} }; };
    borrowed.calls = &facts;
    var unmatched = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &borrowed); defer unmatched.deinit();
    try std.testing.expect(unmatched.pending != null);
    meter.left = 0;
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &result));
    try std.testing.expectEqual(@as(usize, 0), meter.left);
}
