// SPDX-License-Identifier: MIT
// Returned Analysis ownership only, over the same independent metadata DTO.
// std.testing.allocator checks that successful and failing owners release all
// allocations; no Source, Runtime State, loader or VM is an input.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const dto = @import("constructor-call-literal-dto.zig");
const rows = [_]domain.FixedFunction{
    .{ .function_id = dto.caller, .contract = &dto.contracts[0], .declaration = &dto.declarations[0] },
    .{ .function_id = dto.callee, .contract = &dto.contracts[1], .declaration = &dto.declarations[1] },
};
const Meter = struct {
    remaining: usize = 300_000,
    fn charge(raw: *anyopaque, count: usize) error{BudgetExceeded}!void { const self: *Meter = @ptrCast(@alignCast(raw)); if (count > self.remaining) { self.remaining = 0; return error.BudgetExceeded; } self.remaining -= count; }
    fn budget(self: *Meter) m.Budget { return .{ .context = self, .charge = charge }; }
};
fn checked(budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    for ([_]*const m.Graph{ &dto.caller_graph, &dto.leaf }, [_]m.Symbol{ dto.caller, dto.callee }) |graph, id| {
        const validation = try m.validateGraph(std.testing.allocator, &dto.directory, id, graph, budget);
        try std.testing.expect(validation == .pending); try std.testing.expectEqual(m.Pending.construction_frame, validation.pending);
    }
}
fn moved(meter: *Meter) !domain.Analysis {
    var budget = meter.budget();
    return domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.caller_graph, &budget, .{ .function_id = dto.caller, .fixed = &rows });
}
fn reuseStack(byte: u8) u8 {
    var buffer: [32768]u8 = undefined; @memset(&buffer, byte);
    std.mem.doNotOptimizeAway(&buffer); return buffer[16384];
}
test "returned constructor analysis retains child facts after stack reuse and frees one owning arena" {
    var meter: Meter = .{}; var budget = meter.budget(); try checked(&budget);
    var result = try moved(&meter); defer result.deinit();
    try std.testing.expectEqual(@as(u8, 0x5a), reuseStack(0x5a)); try std.testing.expectEqual(@as(u8, 0xa5), reuseStack(0xa5));
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    const child = result.calls[0]; try std.testing.expect(child.fixed.contract == &dto.contracts[1]);
    const prefix = child.analysis.initializations[0]; try std.testing.expectEqualStrings("field:" ++ dto.field, child.graph.heaps[prefix.store].store.selector);
    try std.testing.expect(child.analysis.input_exits.?.normal.live and !child.analysis.input_exits.?.normal.unbound);
    try std.testing.expect(result.normal[0].source == .allocation and result.normal[0].source.allocation == child.receiver);
}
test "partial constructor analysis exhaustion frees parent-owned child chunks" {
    var measured: Meter = .{}; var measured_budget = measured.budget(); try checked(&measured_budget);
    const initial = measured.remaining;
    var complete = try moved(&measured); defer complete.deinit(); try std.testing.expect(complete.pending == null);
    const spent = initial - measured.remaining; try std.testing.expect(spent > 2);
    for ([_]usize{ spent / 2, spent - 1 }) |allowance| {
        var limited: Meter = .{}; var limited_budget = limited.budget(); try checked(&limited_budget);
        limited.remaining = @min(limited.remaining, allowance); // Reduce, never refill the same validated meter.
        try std.testing.expectError(error.BudgetExceeded, moved(&limited)); try std.testing.expectEqual(@as(usize, 0), limited.remaining);
    }
}
