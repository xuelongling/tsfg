// SPDX-License-Identifier: MIT
// Direct passive current-Body API regressions over the existing Common18 data
// fixture. No VM, target solver, observer, effects.finish or full admission.
// Each input uses its one post-decode Context budget for the existing owning
// metadata validators, Body projection and typed Graph/Domain checks. The view
// variant is a borrowed typed-DTO change, not a new packet or Source receipt.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const context = @import("wire-program-refcheck-context.zig");
const table_refs = @import("wire-program-table-refs.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const identity = @import("wire-program-identity-check.zig");
const constructions = @import("wire-program-construction-contracts-check.zig");
const fixed = @import("wire-program-fixed-publication-check.zig");
const refs = @import("wire-program-publication-refs.zig");
const model = @import("wire-program-return-origin-model.zig");
const body = @import("wire-program-return-origin-body.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const t = wire.types;

fn checkedBodyInput(c: *context.Context) !void {
    try wire.requireFormat(c.program.envelope, c.program.target);
    try table_refs.check(c);
    try layout.check(c);
    try ssa.check(c); // Includes the real receiver/token protocol checker.
    try identity.check(c);
    try constructions.checkConstructions(c);
    try fixed.checkInterfaces(c);
}

fn constructor(program: *const wire.Program) !t.FunctionRef {
    for (program.functions, 0..) |function, index| {
        if (function.role == .construction_body) return @enumFromInt(index);
    }
    return error.TestExpectedConstructor;
}

fn checkedGraph(c: *context.Context, directory: *const model.Directory, function_id: model.Symbol, graph: *const model.Graph, budget: *model.Budget) !void {
    try model.validateDirectory(c.allocator, directory, budget);
    const validation = try model.validateGraph(c.allocator, directory, function_id, graph, budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(model.Pending.construction_frame, validation.pending);
}

// This checks the public Body outputs against the original field/ABI metadata
// and completed Domain observations, rather than constructing expected joins.
fn expectFieldOwners(program: *const wire.Program, function: t.FunctionRef, graph: *const model.Graph, fields: []const body.ReceiverField, writes: []const domain.Initialization) !void {
    const common = program.tables.mode.common;
    const abi = common.abis[@intFromEnum(program.functions[@intFromEnum(function)].abi)];
    const role = common.members.constructions[@intFromEnum(abi.construction.?)];
    try std.testing.expectEqual(@as(usize, 2), role.initialization_fields.len);
    try std.testing.expectEqual(role.initialization_fields.len, fields.len);
    try std.testing.expectEqual(@as(usize, 6), writes.len);
    var seen = [_]bool{false} ** 2;
    for (fields) |field| {
        const ordinal = std.mem.indexOfScalar(t.FieldRef, role.initialization_fields, field.field) orelse return error.TestExpectedOwnedField;
        try std.testing.expect(!seen[ordinal]); seen[ordinal] = true;
        const store = graph.heaps[field.store].store;
        var expected_selector: [77]u8 = undefined;
        @memcpy(expected_selector[0..13], "field:sha256:");
        const field_hash = std.fmt.bytesToHex(common.members.fields[@intFromEnum(field.field)].id, .lower);
        @memcpy(expected_selector[13..], &field_hash);
        try std.testing.expectEqualStrings(&expected_selector, store.selector);
        var owner_id: [71]u8 = undefined; @memcpy(owner_id[0..7], "sha256:");
        const owner_hash = std.fmt.bytesToHex(common.types[@intFromEnum(role.owner)].id, .lower); @memcpy(owner_id[7..], &owner_hash);
        try std.testing.expectEqualStrings(&owner_id, store.view);
        var categories: u3 = 0;
        for (writes) |write| {
            if (write.store != field.store) continue;
            try std.testing.expect(write.base.source == .allocation);
            try std.testing.expect(graph.nodes[write.base.source.allocation] == .receiver_input);
            try std.testing.expectEqual(domain.Category.object, write.base.category);
            try std.testing.expect(write.value.source == .node);
            const source = graph.nodes[write.value.source.node];
            try std.testing.expect(source == .parameter);
            try std.testing.expectEqual(ordinal + 1, source.parameter.index);
            categories |= switch (write.value.category) { .object => @as(u3, 1), .@"undefined" => @as(u3, 2), .other => @as(u3, 4) };
        }
        // A formal Array/ReadSpan view does not erase primitive/undefined
        // alternatives and supplies no actual alias/fresh/holding evidence.
        try std.testing.expectEqual(@as(u3, 7), categories);
    }
    for (seen) |present| try std.testing.expect(present);
}

test "checked receiver Body preserves both copy heaps and complete field prefix owners" {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining); defer owned.deinit();
    var c = context.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    try checkedBodyInput(&c);
    const function = try constructor(c.program);
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit();
    const directory = try refs.returnOriginDirectory(&c, arena.allocator(), c.program.tables.mode.common.authority.fixed_publication);
    const function_id = try refs.symbol(&c, arena.allocator(), c.program.functions[@intFromEnum(function)].id);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    var projected = try body.project(&c, function, &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const graph = &projected.graph.?;
    try checkedGraph(&c, &directory, function_id, graph, &budget);
    var copies: usize = 0;
    for (graph.heaps) |heap| {
        if (heap != .copy) continue;
        copies += 1;
        const value = graph.nodes[heap.copy.value];
        try std.testing.expect(value == .copy);
        try std.testing.expectEqual(heap.copy.previous, value.copy.heap);
    }
    try std.testing.expectEqual(@as(usize, 2), copies);
    var result = try domain.analyzeReturns(c.allocator, &directory, graph, &budget, function_id); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(domain.Category.object, result.normal[0].category);
    try std.testing.expect(result.normal[0].source == .allocation);
    try std.testing.expect(graph.nodes[result.normal[0].source.allocation] == .receiver_input);
    try std.testing.expectEqual(@as(usize, 0), result.language.len);
    try expectFieldOwners(c.program, function, graph, projected.field_stores, result.initializations);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}

test "checked receiver effects Body keeps owner categories across a real logical domain_view" {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining); defer owned.deinit();
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit();
    const a = arena.allocator();
    var changed = owned.program;
    const function = try constructor(&changed); const function_index = @intFromEnum(function);
    const functions = try a.dupe(wire.Function, changed.functions); changed.functions = functions;
    const registers = try a.dupe(wire.Register, functions[function_index].registers); functions[function_index].registers = registers;
    const blocks = try a.dupe(wire.Block, functions[function_index].blocks); functions[function_index].blocks = blocks;
    const abi = changed.tables.mode.common.abis[@intFromEnum(functions[function_index].abi)];
    try std.testing.expectEqual(@as(usize, 2), abi.argument_types.len);
    try std.testing.expect(abi.argument_types[0] != abi.argument_types[1]);
    // Replace one explicit copy with a legal as/view forwarding operation.
    // The physical carrier and all actual field/token operands remain intact.
    // Its logical view is the other existing owned managed type, not a tag.
    var replaced = false;
    for (blocks) |*block| {
        if (replaced) break;
        const instructions = try a.dupe(wire.instruction.Instruction, block.instructions); block.instructions = instructions;
        for (instructions) |*op| {
            if (op.data != .domain_copy) continue;
            const result = op.result.?;
            try std.testing.expect(registers[@intFromEnum(op.operands[0])].view != abi.argument_types[1]);
            op.data = .{ .domain_view = .{ .static_view = abi.argument_types[1] } };
            registers[@intFromEnum(result)].view = abi.argument_types[1];
            replaced = true; break;
        }
    }
    try std.testing.expect(replaced);
    var c = context.Context{ .program = &changed, .allocator = std.testing.allocator, .remaining = remaining };
    try checkedBodyInput(&c);
    const directory = try refs.returnOriginDirectory(&c, a, changed.tables.mode.common.authority.fixed_publication);
    const function_id = try refs.symbol(&c, a, functions[function_index].id);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    var effect = try body.coverReceiverEffects(&c, function); defer effect.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), effect.body.pending);
    try std.testing.expect(effect.analysis != null and effect.proof != null);
    try std.testing.expectEqual(@as(?domain.Pending, null), effect.analysis.?.pending);
    const proof = effect.proof.?;
    try checkedGraph(&c, &directory, function_id, &proof.flow.graph, &budget);
    try std.testing.expect(effect.analysis.?.normal_live and !effect.analysis.?.language_live);
    try std.testing.expectEqual(@as(usize, 1), effect.analysis.?.normal.len);
    try std.testing.expectEqual(domain.Category.object, effect.analysis.?.normal[0].category);
    try std.testing.expect(effect.analysis.?.normal[0].source == .allocation);
    try std.testing.expectEqual(@as(usize, 0), effect.analysis.?.language.len);
    try expectFieldOwners(c.program, function, &proof.flow.graph, proof.fields, proof.initializations);
    // Effects' forwarding promise does not widen the independent certificate
    // recipe: that path still requires the original same-view/carrier rule.
    var certificate = try body.project(&c, function, &directory, &budget); defer certificate.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .view), certificate.pending);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}

test "checked receiver Body keeps an unsupported live operation Pending" {
    var remaining: usize = wire.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining); defer owned.deinit();
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit(); const a = arena.allocator();
    var changed = owned.program;
    const function = try constructor(&changed); const function_index = @intFromEnum(function);
    const functions = try a.dupe(wire.Function, changed.functions); changed.functions = functions;
    const registers = try a.dupe(wire.Register, functions[function_index].registers); functions[function_index].registers = registers;
    const blocks = try a.dupe(wire.Block, functions[function_index].blocks); functions[function_index].blocks = blocks;
    const scalar: t.TypeRef = for (changed.tables.mode.common.types, 0..) |row, index| {
        if (row.kind == .scalar and std.mem.eql(u8, row.name, "i32")) break @enumFromInt(index);
    } else return error.TestExpectedScalarType;
    var discarded: ?t.RegisterRef = null; var original_input: ?t.RegisterRef = null;
    for (blocks) |*block| {
        const instructions = try a.dupe(wire.instruction.Instruction, block.instructions); block.instructions = instructions;
        for (instructions) |*op| {
            if (discarded == null and op.data == .domain_copy) {
                discarded = op.result.?; original_input = op.operands[0];
                op.data = .domain_array_length;
                registers[@intFromEnum(discarded.?)] = .{ .carrier = .{ .@"type" = scalar }, .view = scalar };
            } else if (discarded != null and op.data == .initialize_field and op.operands[2] == discarded.?) {
                const operands = try a.dupe(t.RegisterRef, op.operands); operands[2] = original_input.?; op.operands = operands;
            }
        }
    }
    try std.testing.expect(discarded != null);
    // The ignored scalar length is a real live operation. Its source Array
    // and the original field payload keep their admitted physical carriers.
    // A projection that does not model it must not prove a complete return.
    var c = context.Context{ .program = &changed, .allocator = std.testing.allocator, .remaining = remaining };
    try checkedBodyInput(&c);
    const directory = try refs.returnOriginDirectory(&c, a, changed.tables.mode.common.authority.fixed_publication);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    try model.validateDirectory(c.allocator, &directory, &budget);
    var projected = try body.project(&c, function, &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .operation), projected.pending);
    try std.testing.expect(projected.graph == null);
    var effects = try body.coverReceiverEffects(&c, function); defer effects.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .operation), effects.body.pending);
    try std.testing.expect(effects.analysis == null and effects.proof == null);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}
