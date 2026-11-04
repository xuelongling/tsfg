// SPDX-License-Identifier: MIT
// Handwritten passive formal metadata only; no Source/VM/Actual entrance.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-initialized-ref-dto.zig");
const Meter = struct {
    left: usize = 100000000,
    spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [3]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.native_callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{dto.native_field} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [3]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = false },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.a, .fields = &.{.{ .id = dto.native_field, .view = dto.a, .physical = 0, .type_id = dto.scalar }} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.a }} },
};
fn validate(graph: *const m.Graph, contracts: *const @TypeOf(dto.contracts), budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
    for (contracts, dto.directory.functions) |*contract, function| {
        const result = try m.validateGraph(std.testing.allocator, &dto.directory, function.id, &contract.return_origins.?, budget);
        try std.testing.expect(result == .pending and result.pending == .construction_frame);
    }
}
test "initialized Ref constructor rejects unknown ordinary Ref and missing original inventory" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    for ([_]m.Value{ .unknown, .{ .nonowning = .{ .@"type" = dto.a } } }) |argument| {
        var nodes = dto.caller_graph.nodes[0..9].*; nodes[2] = argument;
        var graph = dto.caller_graph; graph.nodes = &nodes; try validate(&graph, &dto.contracts, &budget);
        const fixed = fixedRows(&dto.contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, if (argument == .unknown) .unknown_origin else .data_protocol), result.pending);
    }
    try validate(&dto.caller_graph, &dto.contracts, &budget);
    var fixed = fixedRows(&dto.contracts); fixed[1].initialization_fields = null;
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}
test "initialized Ref constructor requires native field on every original predecessor" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    for (0..2) |variant| {
        var heaps: [6]m.Heap = undefined; @memcpy(heaps[0..5], dto.native_leaf.heaps);
        heaps[5] = .{ .join = .{ .inputs = &.{ 2, 3 } } };
        // Both cases retain the real store and its MAY prefix write. Neither
        // grants initialization on all exits: one skips it, one joins paths.
        heaps[4].receiver_action.previous = if (variant == 0) 2 else 5;
        var native = dto.native_leaf; native.heaps = &heaps;
        var contracts = dto.contracts; contracts[1].return_origins = native;
        try validate(&dto.caller_graph, &contracts, &budget); const fixed = fixedRows(&contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
    }
}
test "initialized Ref constructor rejects a late unbound predecessor after cached child" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var heaps: [16]m.Heap = undefined; @memcpy(heaps[0..7], dto.caller_graph.heaps);
    heaps[7] = .{ .join = .{ .inputs = &.{ 1, 8 } } };
    heaps[8] = .{ .join = .{ .inputs = &.{9} } }; heaps[9] = .{ .join = .{ .inputs = &.{10} } };
    heaps[10] = .{ .join = .{ .inputs = &.{11} } }; heaps[11] = .{ .join = .{ .inputs = &.{12} } };
    heaps[12] = .{ .join = .{ .inputs = &.{13} } }; heaps[13] = .{ .join = .{ .inputs = &.{14} } };
    heaps[14] = .{ .join = .{ .inputs = &.{15} } }; heaps[15] = .{ .join = .{ .inputs = &.{0} } };
    var calls = dto.caller_graph.calls[0..2].*; calls[1].heap = 7;
    var graph = dto.caller_graph; graph.heaps = &heaps; graph.calls = &calls;
    try validate(&graph, &dto.contracts, &budget); const fixed = fixedRows(&dto.contracts);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}
test "initialized Ref constructor preserves every parameter upper flag and order" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.caller_graph, &dto.contracts, &budget);
    const fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    for (0..2) |parameter| for (0..3) |flag| {
        var flags = [_]owners.Flags{ .{ .write = true }, .{} };
        switch (flag) { 0 => flags[parameter].read = !flags[parameter].read, 1 => flags[parameter].write = !flags[parameter].write, 2 => flags[parameter].structural = !flags[parameter].structural, else => unreachable }
        var rows = ownerRows(&dto.contracts); rows[2].parameters = &flags;
        var result = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver); defer result.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), result.pending);
    };
    for (0..3) |variant| {
        var contracts = dto.contracts; var parameters = dto.scalar_full.parameters[0..2].*;
        switch (variant) { 0 => contracts[2].upper.parameters = parameters[0..1], 1 => { parameters[1].index = 0; contracts[2].upper.parameters = &parameters; }, 2 => { std.mem.swap(@TypeOf(parameters[0]), &parameters[0], &parameters[1]); contracts[2].upper.parameters = &parameters; }, else => unreachable }
        const rows = fixedRows(&contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .fixed_contract), result.pending);
    }
}
test "initialized Ref constructor charges the original budget through owners" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&dto.caller_graph, &dto.contracts, &budget);
    const fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending); try std.testing.expect(meter.spent > 0);
    meter.left = 0; const rows = ownerRows(&dto.contracts);
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver));
}
