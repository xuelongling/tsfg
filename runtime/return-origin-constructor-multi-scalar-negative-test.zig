// SPDX-License-Identifier: MIT
// Passive handwritten Directory/Graph premises only; no Source or VM entrance.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const dto = @import("constructor-multi-scalar-dto.zig");
const Meter = struct {
    left: usize = 100000000,
    spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [2]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0] },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[1], .contract = &contracts[1] },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [2]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{ .{ .write = true }, .{}, .{} }, .captures = &.{}, .may_throw = false },
        .{ .function_id = dto.callee, .graph = &contracts[1].return_origins.?, .parameters = &.{ .{ .write = true }, .{}, .{} }, .captures = &.{}, .may_throw = false },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{ .{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.scalar }, .{ .id = dto.field2, .view = dto.b, .physical = 1, .type_id = dto.scalar } } },
};
fn validate(budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    _ = try m.validateGraph(std.testing.allocator, &dto.directory, dto.callee, &dto.leaf, budget);
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &dto.caller_graph, budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
}
test "ordered scalar constructor checks every argument leaf and declared arity" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&budget);
    var fixed = fixedRows(&dto.contracts);
    for ([_]usize{ 6, 7 }) |argument_node| {
        for ([_]m.Value{ .unknown, .{ .nonowning = .{ .@"type" = dto.undefined_type } }, .{ .join = .{ .@"type" = dto.scalar, .inputs = &.{3} } } }) |argument| {
            var nodes = dto.caller_graph.nodes[0..8].*; nodes[argument_node] = argument;
            var graph = dto.caller_graph; graph.nodes = &nodes;
            const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &graph, &budget);
            try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
            var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
            const expected: domain.Pending = if (argument == .unknown) .unknown_origin else .data_protocol;
            try std.testing.expectEqual(@as(?domain.Pending, expected), result.pending);
        }
    }
    // Shape-invalid contracts stop at Graph validation, before Domain analysis.
    for ([_][]const []const m.Ref{ &.{&.{7}}, &.{ &.{7}, &.{6}, &.{6} } }) |arguments| {
        var calls = dto.caller_graph.calls[0..1].*; calls[0].arguments = arguments;
        var graph = dto.caller_graph; graph.calls = &calls;
        try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &graph, &budget));
    }
    for ([_][]const []const m.Ref{ &.{ &.{}, &.{6} }, &.{ &.{7}, &.{} } }) |arguments| {
        var calls = dto.caller_graph.calls[0..1].*; calls[0].arguments = arguments;
        var graph = dto.caller_graph; graph.calls = &calls;
        const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &graph, &budget);
        try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
    }
}
test "ordered scalar constructor checks all three flags on all parameters and full upper order" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&budget);
    var fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    for (0..3) |parameter| {
        for (0..3) |flag| {
            var flags = [_]owners.Flags{ .{ .write = true }, .{}, .{} };
            switch (flag) { 0 => flags[parameter].read = !flags[parameter].read, 1 => flags[parameter].write = !flags[parameter].write, 2 => flags[parameter].structural = !flags[parameter].structural, else => unreachable }
            var rows = ownerRows(&dto.contracts); rows[1].parameters = &flags;
            var result = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver); defer result.deinit();
            try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), result.pending);
        }
    }
    for (0..3) |variant| {
        var contracts = dto.contracts; var parameters = dto.scalar_full.parameters[0..3].*;
        switch (variant) { 0 => contracts[1].upper.parameters = parameters[0..2], 1 => { parameters[2].index = 1; contracts[1].upper.parameters = &parameters; }, 2 => { std.mem.swap(@TypeOf(parameters[0]), &parameters[1], &parameters[2]); contracts[1].upper.parameters = &parameters; }, else => unreachable }
        var rows = fixedRows(&contracts);
        var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows }); defer result.deinit();
        try std.testing.expectEqual(@as(?domain.Pending, .fixed_contract), result.pending);
    }
}
test "ordered scalar constructor borrows the original budget for owners" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try validate(&budget);
    var fixed = fixedRows(&dto.contracts);
    var receiver = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending); try std.testing.expect(meter.spent > 0);
    meter.left = 0; const rows = ownerRows(&dto.contracts);
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &dto.caller_graph, &rows, &budget, &receiver));
}
