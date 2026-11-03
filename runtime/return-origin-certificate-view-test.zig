// SPDX-License-Identifier: MIT
// Pure current certificate-Body boundaries over the retained Source3 capture.
// Borrowed negative DTOs are not new packets or Source receipts. This suite
// does not grant full fixed-upper admission, physical holding or VM execution.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const context = @import("wire-program-refcheck-context.zig");
const table_refs = @import("wire-program-table-refs.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const correspondence = @import("wire-program-source-correspondence.zig");
const identity = @import("wire-program-identity-check.zig");
const constructions = @import("wire-program-construction-contracts-check.zig");
const fixed = @import("wire-program-fixed-publication-check.zig");
const refs = @import("wire-program-publication-refs.zig");
const model = @import("wire-program-return-origin-model.zig");
const body = @import("wire-program-return-origin-body.zig");
const certificates = @import("wire-program-return-origins.zig");
const t = wire.types;
const fixture = @embedFile("test-data/common18-source3-conditional-super.tbc");

fn checkedInput(c: *context.Context) !void {
    try wire.requireFormat(c.program.envelope, c.program.target);
    try table_refs.check(c); try layout.check(c); try ssa.check(c);
    try correspondence.check(c); try identity.check(c);
    try constructions.checkConstructions(c); try fixed.checkInterfaces(c);
}

const View = struct { function: t.FunctionRef, input: t.RegisterRef, result: t.RegisterRef };
fn originalView(program: *const wire.Program) !View {
    const common = program.tables.mode.common;
    var selected: ?View = null;
    for (program.functions, 0..) |function, index| {
        if (function.role != .construction_body) continue;
        for (function.blocks) |block| for (block.instructions) |op| {
            if (op.data != .domain_view or common.types[@intFromEnum(op.data.domain_view.static_view)].kind != .@"void") continue;
            try std.testing.expect(selected == null);
            selected = .{ .function = @enumFromInt(index), .input = op.operands[0], .result = op.result.? };
        };
    }
    return selected orelse error.TestExpectedVoidView;
}

// Only complete transparent paths may identify an original Data value. This
// structural assertion neither executes the operation nor invents a category.
fn forwardsOnly(a: std.mem.Allocator, graph: *const model.Graph, roots: []const model.Ref, expected: model.Ref) !bool {
    const seen = try a.alloc(bool, graph.nodes.len); @memset(seen, false);
    const pending = try a.alloc(model.Ref, graph.nodes.len); var count: usize = 0; var cursor: usize = 0; var found = false;
    for (roots) |id| if (!seen[id]) { seen[id] = true; pending[count] = id; count += 1; };
    while (cursor < count) : (cursor += 1) {
        const id = pending[cursor]; if (id == expected) { found = true; continue; }
        const inputs = switch (graph.nodes[id]) { inline .join, .gate => |row| row.inputs, else => return false };
        if (inputs.len == 0) return false;
        for (inputs) |input| if (!seen[input]) { seen[input] = true; pending[count] = input; count += 1; };
    }
    return found;
}

test "certificate Body preserves original reference Data across a void view without certifying a missing copy upper" {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, fixture, &remaining); defer owned.deinit();
    var c = context.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    try checkedInput(&c);
    const view = try originalView(c.program); const common = c.program.tables.mode.common;
    const f = c.program.functions[@intFromEnum(view.function)]; const abi = common.abis[@intFromEnum(f.abi)];
    const root = common.members.constructions[@intFromEnum(abi.construction.?)];
    const from = f.registers[@intFromEnum(view.input)]; const into = f.registers[@intFromEnum(view.result)];
    try std.testing.expect(from.carrier == .@"type" and into.carrier == .@"type");
    try std.testing.expectEqual(root.owner, from.carrier.@"type"); try std.testing.expectEqual(root.owner, into.carrier.@"type");
    try std.testing.expect(from.view != into.view and common.types[@intFromEnum(into.view.?)].kind == .@"void");
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit(); const a = arena.allocator();
    const publication = common.authority.fixed_publication;
    const directory = try refs.returnOriginDirectory(&c, a, publication); const function_id = try refs.symbol(&c, a, f.id);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    var projected = try body.project(&c, view.function, &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const graph = &projected.graph.?;
    try model.validateDirectory(a, &directory, &budget);
    const validation = try model.validateGraph(a, &directory, function_id, graph, &budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
    var wire_copies: usize = 0; var normal_exits: usize = 0; var language_exits: usize = 0;
    for (f.blocks) |block| for (block.instructions) |op| switch (op.data) {
        .domain_copy => wire_copies += 1, .@"return" => normal_exits += 1, .eh_raise => language_exits += 1, else => {},
    };
    var copy_nodes: usize = 0; var copy_heaps: usize = 0; var parent_normal: ?model.Ref = null;
    for (graph.nodes) |node| if (node == .copy) { copy_nodes += 1; };
    for (graph.heaps) |heap| if (heap == .copy) {
        copy_heaps += 1;
        try std.testing.expect(graph.nodes[heap.copy.value] == .copy);
        try std.testing.expectEqual(heap.copy.previous, graph.nodes[heap.copy.value].copy.heap);
    };
    try std.testing.expectEqual(wire_copies, copy_nodes); try std.testing.expectEqual(wire_copies, copy_heaps);
    try std.testing.expectEqual(@as(usize, 1), wire_copies);
    try std.testing.expectEqual(normal_exits, graph.exits.normal.len); try std.testing.expectEqual(language_exits, graph.exits.language.len);
    try std.testing.expectEqual(@as(usize, 1), projected.field_stores.len);
    const store = graph.heaps[projected.field_stores[0].store].store;
    var copied: ?model.Ref = null;
    for (graph.nodes, 0..) |node, index| if (node == .copy) { copied = index; };
    try std.testing.expect(try forwardsOnly(a, graph, store.values, copied.?));
    for (projected.receiver_actions) |row| {
        const op = f.blocks[row.block].instructions[row.instruction];
        if (op.data != .receiver_bind or op.data.receiver_bind.construction != abi.construction.?) continue;
        if (f.blocks[@intFromEnum(op.data.receiver_bind.normal)].parameters[0] != view.input) continue;
        try std.testing.expect(parent_normal == null); parent_normal = row.normal;
    }
    var original: ?model.Ref = null;
    for (graph.nodes, 0..) |node, index| if (node == .receiver_value and node.receiver_value.action == (parent_normal orelse return error.TestExpectedParentBind)) {
        try std.testing.expect(original == null); original = index;
    };
    var aliases: usize = 0;
    for (graph.nodes) |node| if (node == .join and node.join.@"type" == null and try forwardsOnly(a, graph, node.join.inputs, original orelse return error.TestExpectedOriginalData)) { aliases += 1; };
    try std.testing.expectEqual(@as(usize, 1), aliases);

    // The real captured upper retained literal+gate but no Data/Heap.copy.
    // Alias support must not silently waive that independent whole-graph gate.
    const contracts = try a.alloc(certificates.FixedContract, publication.publication.contracts.len);
    var fixed_graph: ?*const model.Graph = null;
    for (publication.publication.contracts, contracts) |*row, *entry| {
        entry.* = .{ .function_id = try refs.symbol(&c, a, row.function_id), .graph = if (row.return_origins) |*value| value else null };
        if (std.meta.eql(row.function_id, f.id)) { try std.testing.expect(fixed_graph == null); fixed_graph = entry.graph; }
    }
    const upper = fixed_graph orelse return error.TestExpectedFixedGraph;
    for (upper.nodes) |node| try std.testing.expect(node != .copy);
    for (upper.heaps) |heap| try std.testing.expect(heap != .copy);
    const coverage = try certificates.covered(a, &directory, function_id, graph, contracts, &budget);
    try std.testing.expect(coverage == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, coverage.pending);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}

test "a different owned physical reference carrier stays Pending despite the same void Source occurrence" {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, fixture, &remaining); defer owned.deinit();
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit(); const a = arena.allocator();
    var changed = owned.program; const view = try originalView(&changed);
    const functions = try a.dupe(wire.Function, changed.functions); changed.functions = functions;
    const f = &functions[@intFromEnum(view.function)]; const registers = try a.dupe(wire.Register, f.registers); f.registers = registers;
    const common = changed.tables.mode.common; const abi = common.abis[@intFromEnum(f.abi)];
    const owner = common.members.constructions[@intFromEnum(abi.construction.?)].owner;
    const base = common.types[@intFromEnum(owner)].base.?;
    try std.testing.expect(base != owner); registers[@intFromEnum(view.result)].carrier = .{ .@"type" = base };
    var c = context.Context{ .program = &changed, .allocator = std.testing.allocator, .remaining = remaining };
    try c.carrier(registers[@intFromEnum(view.result)].carrier); try checkedInput(&c);
    const directory = try refs.returnOriginDirectory(&c, a, common.authority.fixed_publication);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    var projected = try body.project(&c, view.function, &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .view), projected.pending); try std.testing.expect(projected.graph == null);
}

const ControlRole = enum { receiver, cell, initialization, environment };
fn rejectControlRole(role: ControlRole) !void {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, fixture, &remaining); defer owned.deinit();
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit(); const a = arena.allocator();
    var changed = owned.program; const view = try originalView(&changed);
    const functions = try a.dupe(wire.Function, changed.functions); changed.functions = functions;
    const f = &functions[@intFromEnum(view.function)]; const registers = try a.dupe(wire.Register, f.registers); f.registers = registers;
    const carrier: t.Carrier = if (role == .environment) .{ .environment = @enumFromInt(0) } else for (f.registers) |row| {
        if ((role == .receiver and row.carrier == .receiver) or (role == .cell and row.carrier == .cell) or (role == .initialization and row.carrier == .initialization)) break row.carrier;
    } else return error.TestExpectedControlCarrier;
    registers[@intFromEnum(view.result)] = .{ .carrier = carrier, .view = null };
    var c = context.Context{ .program = &changed, .allocator = std.testing.allocator, .remaining = remaining };
    if (role == .environment) {
        // This host-free capture owns no Env; an invented ref fails its owning
        // boundary before it could be mistaken for ordinary Data by Body.
        try std.testing.expectEqual(@as(usize, 0), changed.tables.mode.common.closures.environments.len);
        try std.testing.expectError(error.InvalidReference, c.carrier(carrier));
    } else {
        try c.carrier(carrier);
        // Existing Frame/token producer rules or the exact Source SSA mapping
        // reject the changed role. No malformed DTO is handed to Body.
        try std.testing.expectError(error.InvalidShape, checkedInput(&c));
    }
}

test "receiver frames cannot be manufactured by a Data view" { try rejectControlRole(.receiver); }
test "a Cell cannot be manufactured by a Data view" { try rejectControlRole(.cell); }
test "initialization tokens cannot be manufactured by a Data view" { try rejectControlRole(.initialization); }
test "an unowned Env carrier cannot be manufactured by a Data view" { try rejectControlRole(.environment); }
