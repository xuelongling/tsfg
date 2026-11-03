// SPDX-License-Identifier: MIT
// Retained metadata capture: Core65419/5cd0 -> qualified CLI31464 -> packetcee5.
// Historic Frontend provenance remains UNKNOWN. This checks current Body
// projection, not complete refcheck, Domain admission, Source adoption or a VM.
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
const t = wire.types;

// Follow only transparent equations, without interpreting views or categories.
// Every terminal must be the original value; a cycle cannot invent a seed.
fn forwardsOnly(a: std.mem.Allocator, graph: *const model.Graph, roots: []const model.Ref, expected: model.Ref) !bool {
    const seen = try a.alloc(bool, graph.nodes.len); @memset(seen, false);
    const pending = try a.alloc(model.Ref, graph.nodes.len); var count: usize = 0; var cursor: usize = 0; var found = false;
    for (roots) |id| if (!seen[id]) { seen[id] = true; pending[count] = id; count += 1; };
    while (cursor < count) : (cursor += 1) {
        const id = pending[cursor];
        if (id == expected) { found = true; continue; }
        const inputs = switch (graph.nodes[id]) { inline .join, .gate => |row| row.inputs, else => return false };
        if (inputs.len == 0) return false;
        for (inputs) |input| if (!seen[input]) { seen[input] = true; pending[count] = input; count += 1; };
    }
    return found;
}

fn heapContains(a: std.mem.Allocator, graph: *const model.Graph, root: model.Ref, expected: model.Ref) !bool {
    const seen = try a.alloc(bool, graph.heaps.len); @memset(seen, false);
    const pending = try a.alloc(model.Ref, graph.heaps.len); var count: usize = 1; var cursor: usize = 0;
    pending[0] = root; seen[root] = true;
    while (cursor < count) : (cursor += 1) {
        const id = pending[cursor]; if (id == expected) return true;
        switch (graph.heaps[id]) {
            .entry => {},
            .join => |row| for (row.inputs) |input| {
                if (!seen[input]) { seen[input] = true; pending[count] = input; count += 1; }
            },
            inline .receiver_action, .store, .copy => |row| {
                if (!seen[row.previous]) { seen[row.previous] = true; pending[count] = row.previous; count += 1; }
            },
            else => return error.TestUnexpectedHeap,
        }
    }
    return false;
}

test "checked Source3 Body retains actual Data and copy prefix through an unarchived void view" {
    const input = @embedFile("test-data/common18-source3-conditional-super.tbc");
    var hash: t.Hash = undefined; std.crypto.hash.sha2.Sha256.hash(input, &hash, .{});
    const hex = std.fmt.bytesToHex(hash, .lower);
    try std.testing.expectEqualStrings("cee5be1dee41599fa8e52bf0f9bcdb94963bcf534d3ff8ccd3f60d712eaa8e8f", &hex);
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, input, &remaining); defer owned.deinit();
    var c = context.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    try wire.requireFormat(c.program.envelope, c.program.target);
    try table_refs.check(&c); try layout.check(&c); try ssa.check(&c);
    try correspondence.check(&c); try identity.check(&c);
    try constructions.checkConstructions(&c); try fixed.checkInterfaces(&c);
    const common = c.program.tables.mode.common;
    var selected: ?t.FunctionRef = null;
    for (c.program.functions, 0..) |function, index| {
        if (function.role != .construction_body) continue;
        const role = common.members.constructions[@intFromEnum(common.abis[@intFromEnum(function.abi)].construction.?)];
        if (common.types[@intFromEnum(role.owner)].base == null) continue;
        try std.testing.expect(selected == null); selected = @as(t.FunctionRef, @enumFromInt(index));
    }
    const function = selected orelse return error.TestExpectedDerivedConstructor;
    const f = c.program.functions[@intFromEnum(function)]; const abi = common.abis[@intFromEnum(f.abi)];
    const root = common.members.constructions[@intFromEnum(abi.construction.?)];
    var viewed: ?t.RegisterRef = null; var original: ?t.RegisterRef = null;
    var wire_actions: usize = 0; var wire_copies: usize = 0; var wire_stores: usize = 0; var zero_literals: usize = 0; var normal_exits: usize = 0; var language_exits: usize = 0;
    for (f.blocks) |block| for (block.instructions) |op| switch (op.data) {
        .domain_view => |view| {
            const target = common.types[@intFromEnum(view.static_view)];
            if (target.kind != .@"void") continue;
            try std.testing.expect(viewed == null); viewed = op.result.?; original = op.operands[0];
            const from = f.registers[@intFromEnum(original.?)]; const into = f.registers[@intFromEnum(viewed.?)];
            try std.testing.expectEqual(root.owner, from.view.?); try std.testing.expectEqual(view.static_view, into.view.?);
            // The captured wire uses a direct Derived Data carrier (kind2),
            // distinct from both domain0 and the separate receiver-frame5.
            try std.testing.expect(from.carrier == .@"type" and into.carrier == .@"type");
            try std.testing.expectEqual(root.owner, from.carrier.@"type");
            try std.testing.expectEqual(root.owner, into.carrier.@"type");
            for (common.authority.fixed_publication.publication.scope.types) |archived| try std.testing.expect(!std.meta.eql(target.id, archived.id));
        },
        .receiver_bind, .receiver_get, .receiver_result => wire_actions += 1,
        .domain_copy => wire_copies += 1,
        .initialize_field => wire_stores += 1,
        .const_i32 => |bits| if (bits == 0) { zero_literals += 1; },
        .@"return" => normal_exits += 1,
        .eh_raise => language_exits += 1,
        else => {},
    };
    try std.testing.expect(viewed != null and original != null);
    try std.testing.expectEqual(@as(usize, 1), wire_copies); try std.testing.expectEqual(@as(usize, 1), wire_stores);
    try std.testing.expectEqual(@as(usize, 1), zero_literals);

    // The public effect API retains its independent Body even if the separate
    // construction Domain is Pending. This test grants no effect proof.
    var projected = try body.coverReceiverEffects(&c, function); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.body.pending);
    const graph = &projected.body.graph.?;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit(); const a = arena.allocator();
    const directory = try refs.returnOriginDirectory(&c, a, common.authority.fixed_publication);
    const function_id = try refs.symbol(&c, a, f.id); var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    try model.validateDirectory(a, &directory, &budget);
    const validation = try model.validateGraph(a, &directory, function_id, graph, &budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
    try std.testing.expectEqual(wire_actions, projected.body.receiver_actions.len);
    try std.testing.expectEqual(normal_exits, graph.exits.normal.len);
    try std.testing.expectEqual(language_exits, graph.exits.language.len); // Retain dead sinks too.
    try std.testing.expectEqual(wire_stores, projected.body.field_stores.len);

    var parent_normal: ?model.Ref = null; var prefix_completions: usize = 0;
    const field_site = projected.body.field_stores[0]; const field = common.members.fields[@intFromEnum(field_site.field)];
    const field_op = f.blocks[field_site.block].instructions[field_site.instruction];
    try std.testing.expect(field_op.data == .initialize_field and field_op.data.initialize_field.field == field_site.field);
    try std.testing.expect(std.meta.eql(field.origin, field_op.source));
    const store = graph.heaps[field_site.store].store;
    try std.testing.expect(store.initialize);
    const owner_id = try refs.symbol(&c, a, common.types[@intFromEnum(field.owner)].id);
    try std.testing.expectEqualStrings(owner_id, store.view);
    try std.testing.expect(std.mem.startsWith(u8, store.selector, "field:"));
    try std.testing.expectEqualStrings(try refs.symbol(&c, a, field.id), store.selector[6..]);
    for (projected.body.receiver_actions) |row| {
        const op = f.blocks[row.block].instructions[row.instruction];
        switch (op.data) {
            .receiver_bind => |bind| if (bind.construction == abi.construction.? and f.blocks[@intFromEnum(bind.normal)].parameters[0] == original.?) {
                try std.testing.expect(parent_normal == null); parent_normal = row.normal;
                try std.testing.expect(try heapContains(a, graph, graph.heaps[row.normal].receiver_action.previous, field_site.store)); prefix_completions += 1;
            },
            .receiver_result => |result| if (result.construction != abi.construction.?) {
                try std.testing.expect(try heapContains(a, graph, graph.heaps[row.normal].receiver_action.previous, field_site.store)); prefix_completions += 1;
            },
            else => {},
        }
    }
    try std.testing.expectEqual(@as(usize, 2), prefix_completions);
    const normal_action = parent_normal orelse return error.TestExpectedParentBinding;
    var original_node: ?model.Ref = null; var copy_node: ?model.Ref = null; var literal_node: ?model.Ref = null;
    const field_type = try refs.symbol(&c, a, common.types[@intFromEnum(field.@"type")].id);
    const receiver_type = try refs.symbol(&c, a, common.types[@intFromEnum(root.owner)].id);
    for (graph.nodes, 0..) |node, index| switch (node) {
        .receiver_value => |value| if (value.action == normal_action) { try std.testing.expect(original_node == null); try std.testing.expectEqualStrings(receiver_type, value.@"type".?); original_node = index; },
        .copy => |copy| { try std.testing.expect(copy_node == null); try std.testing.expectEqualStrings(field_type, copy.@"type"); copy_node = index; },
        .literal => |literal| { try std.testing.expect(literal_node == null); try std.testing.expect(literal.category == .other); try std.testing.expectEqualStrings(field_type, literal.@"type".?); literal_node = index; },
        else => {},
    };
    const copied = copy_node orelse return error.TestExpectedCopy; const literal = literal_node orelse return error.TestExpectedLiteral;
    try std.testing.expect(try forwardsOnly(a, graph, store.values, copied));
    try std.testing.expect(try forwardsOnly(a, graph, graph.nodes[copied].copy.bases, literal));
    var preserved_aliases: usize = 0;
    for (graph.nodes) |node| if (node == .join and node.join.@"type" == null and try forwardsOnly(a, graph, node.join.inputs, original_node orelse return error.TestExpectedOriginalReceiver)) { preserved_aliases += 1; };
    try std.testing.expectEqual(@as(usize, 1), preserved_aliases);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}
