// SPDX-License-Identifier: MIT
// Direct ordinary-Body metadata API cases. The self-owned typed fixture follows
// wire-program-source-correspondence-test.zig; it is not a captured Source input,
// packet, identity receipt, published contract, execution handle or VM program.
// Unused envelope/authority fields are zero placeholders. Only the explicit
// layout/SSA/SourcePlan and interpretation-directory premises below are claimed.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const control = @import("wire-program-control.zig");
const context = @import("wire-program-refcheck-context.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const correspondence = @import("wire-program-source-correspondence.zig");
const refs = @import("wire-program-publication-refs.zig");
const origin = @import("wire-program-return-origin-model.zig");
const body = @import("wire-program-return-origin-body.zig");
const t = wire.types;
const ins = wire.instruction;
const reference: t.TypeRef = @enumFromInt(0);
const boolean: t.TypeRef = @enumFromInt(1);
const void_type: t.TypeRef = @enumFromInt(2);
const other: t.TypeRef = @enumFromInt(3);
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const r3: t.RegisterRef = @enumFromInt(3);
const r4: t.RegisterRef = @enumFromInt(4);
const r5: t.RegisterRef = @enumFromInt(5);
const reference_text = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const boolean_text = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const void_text = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
const function_text = "sha256:5555555555555555555555555555555555555555555555555555555555555555";
const reference_carrier: t.Carrier = .{ .@"type" = reference };
const boolean_carrier: t.Carrier = .{ .@"type" = boolean };
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 50 };
const copied: t.Origin = .{ .source = @enumFromInt(0), .start = 4, .end = 8 };
const viewed: t.Origin = .{ .source = @enumFromInt(0), .start = 9, .end = 14 };
const viewed_again: t.Origin = .{ .source = @enumFromInt(0), .start = 15, .end = 20 };
const copied_again: t.Origin = .{ .source = @enumFromInt(0), .start = 21, .end = 26 };
const branching: t.Origin = .{ .source = @enumFromInt(0), .start = 27, .end = 30 };
const returned_true: t.Origin = .{ .source = @enumFromInt(0), .start = 31, .end = 36 };
const returned_false: t.Origin = .{ .source = @enumFromInt(0), .start = 40, .end = 45 };
const copy_properties = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = reference_text } }};
const view_properties = [_]t.JsonMember{.{ .key = "target", .value = .{ .string = void_text } }};
const reference_view_properties = [_]t.JsonMember{.{ .key = "target", .value = .{ .string = reference_text } }};
const private_copy_properties = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = void_text } }};
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const directory: origin.Directory = .{
    .types = &.{ .{ .id = reference_text, .kind = .reference }, .{ .id = boolean_text, .kind = .scalar } },
    .functions = &.{.{ .id = function_text, .kind = .source, .parameter_types = &.{ reference_text, boolean_text },
        .return_type = reference_text, .environment_metadata_complete = true, .lexical_environment = null,
        .activation_environment = null, .construction = null }},
    .globals = &.{}, .environments = &.{}, .fields = &.{},
    .constructions = &.{.{ .id = "ordinary-fixture-construction", .owner = reference_text,
        .base = null, .kind = .implicit_base, .function_id = null }},
};

// init connects slices only after the fixture has its final owning address.
// All finite references/definitions and arities are constructed explicitly.
const Fixture = struct {
    program: wire.Program,
    sources: [1]tables.Source,
    types: [4]tables.CommonType,
    bindings: [2]storage.CommonBinding,
    abis: [1]storage.CommonAbi,
    functions: [1]wire.Function,
    registers: [6]wire.Register,
    blocks: [3]wire.Block,
    instructions: [8]ins.Instruction,
    plan_blocks: [3]control.SourcePlanBlock,
    operations: [8]control.SourcePlanOperation,
    carriers: [6][]const u8,

    fn init(self: *Fixture) void {
        self.sources = .{.{ .hash = @splat(0x66), .path = "ordinary-body-metadata-fixture.ts", .length = 50 }};
        const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "FixtureReference", .native_code = 0,
            .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null };
        self.types = .{ base, base, base, base };
        self.types[1].id = @splat(0x22); self.types[1].kind = .scalar; self.types[1].name = "bool"; self.types[1].native_code = 2;
        self.types[2].id = @splat(0x33); self.types[2].kind = .@"void"; self.types[2].name = "void";
        self.types[3].id = @splat(0x44); self.types[3].name = "OtherReference";
        self.bindings = .{
            .{ .id = "ordinary-value", .owner = .{ .param = @enumFromInt(0) }, .name = "value", .@"type" = reference,
                .writable = false, .origin = declaration, .carrier = reference_carrier, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "ordinary-flag", .owner = .{ .param = @enumFromInt(0) }, .name = "flag", .@"type" = boolean,
                .writable = false, .origin = declaration, .carrier = boolean_carrier, .scope = @enumFromInt(0), .declaration_kind = .parameter },
        };
        @memset(&self.registers, .{ .carrier = reference_carrier, .view = reference });
        self.registers[1] = .{ .carrier = boolean_carrier, .view = boolean };
        self.registers[3].view = void_type; self.registers[4].view = void_type;
        self.carriers = .{ reference_text, boolean_text, reference_text, void_text, void_text, reference_text };
        self.instructions = .{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = copied, .result = r2, .operands = &.{r0}, .data = .{ .domain_copy = .{ .static_view = reference } } },
            .{ .source = viewed, .result = r3, .operands = &.{r2}, .data = .{ .domain_view = .{ .static_view = void_type } } },
            .{ .source = viewed_again, .result = r4, .operands = &.{r3}, .data = .{ .domain_view = .{ .static_view = void_type } } },
            .{ .source = copied_again, .result = r5, .operands = &.{r4}, .data = .{ .domain_copy = .{ .static_view = reference } } },
            .{ .source = branching, .result = null, .operands = &.{r1}, .data = .{ .cond_br = .{ .true_destination = @enumFromInt(1), .false_destination = @enumFromInt(2), .true_count = 0 } } },
            .{ .source = returned_true, .result = null, .operands = &.{r5}, .data = .@"return" },
            .{ .source = returned_false, .result = null, .operands = &.{r4}, .data = .@"return" },
        };
        self.operations = .{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "value_copy", .view = reference_text, .properties = &copy_properties, .result = r2, .operands = &.{r0}, .successors = &.{}, .source = copied },
            .{ .name = "view", .view = void_text, .properties = &view_properties, .result = r3, .operands = &.{r2}, .successors = &.{}, .source = viewed },
            .{ .name = "view", .view = void_text, .properties = &view_properties, .result = r4, .operands = &.{r3}, .successors = &.{}, .source = viewed_again },
            .{ .name = "value_copy", .view = reference_text, .properties = &copy_properties, .result = r5, .operands = &.{r4}, .successors = &.{}, .source = copied_again },
            .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = branching },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r5}, .successors = &.{}, .source = returned_true },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r4}, .successors = &.{}, .source = returned_false },
        };
        self.blocks = .{ .{ .parameters = &.{ r0, r1 }, .instructions = self.instructions[0..6] },
            .{ .parameters = &.{}, .instructions = self.instructions[6..7] }, .{ .parameters = &.{}, .instructions = self.instructions[7..8] } };
        self.plan_blocks = .{ .{ .parameters = &.{ r0, r1 }, .operations = self.operations[0..6] },
            .{ .parameters = &.{}, .operations = self.operations[6..7] }, .{ .parameters = &.{}, .operations = self.operations[7..8] } };
        self.abis = .{.{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0x77), .parameters = &.{ @enumFromInt(0), @enumFromInt(1) },
            .argument_types = &.{ reference, boolean }, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = &.{ reference_carrier, boolean_carrier }, .result = reference,
            .result_carrier = reference_carrier, .source_plan = .{ .carriers = &self.carriers, .blocks = &self.plan_blocks } }};
        self.functions = .{.{ .id = @splat(0x55), .signature = @splat(0x77), .abi = @enumFromInt(0), .source = @enumFromInt(0),
            .role = .ordinary, .declaration = .{ .start = 0, .end = 50 }, .name = "ordinaryMetadataFixture", .registers = &self.registers, .blocks = &self.blocks }};
        var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis;
        common.storage.bindings = &self.bindings; common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.exceptions.scopes = &.{.{ .owner = @enumFromInt(0), .path = &.{"function"} }};
        common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) } };
        common.exceptions.functions = &.{.{ .function = @enumFromInt(0), .handlers = &.{} }};
        common.storage.concrete = &.{
            .{ .@"type" = reference, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} },
                .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            .{ .@"type" = boolean, .carrier = .{ .layout = .{ .byte_size = 1, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
            .{ .@"type" = void_type, .carrier = .{ .layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
            .{ .@"type" = other, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} },
                .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
        };
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0),
            .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0),
            .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};

fn typedInput(c: *context.Context, budget: *origin.Budget, interpretation: *const origin.Directory) !void {
    // The fixture owns all finite references. Exercise the actual carrier and
    // origin boundaries, complete layout/SSA, and exact whole SourcePlan map.
    for (c.program.functions) |f| {
        try c.anchor(f.declaration, f.source);
        for (f.registers) |r| { try c.carrier(r.carrier); try c.maybeRef(r.view, c.counts().types); }
        for (f.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
    }
    try layout.check(c); try ssa.check(c); try correspondence.check(c);
    try origin.validateDirectory(c.allocator, interpretation, budget);
}

// This finite structural oracle accepts only the original parameter through
// every join/gate input and actual copy node. It never infers from static views.
fn copiesFromOriginal(graph: *const origin.Graph, value: origin.Ref, depth: usize) error{ TestUnexpectedCycle, TestUnexpectedData, TestUnexpectedResult }!usize {
    if (depth >= graph.nodes.len) return error.TestUnexpectedCycle;
    const node = graph.nodes[value];
    if (node == .parameter) { try std.testing.expect(node.parameter.index == 0); return 0; }
    const inputs = switch (node) { .join => |row| row.inputs, .gate => |row| row.inputs, .copy => |row| row.bases, else => return error.TestUnexpectedData };
    try std.testing.expect(inputs.len != 0);
    var count: ?usize = null;
    for (inputs) |input| {
        const actual = try copiesFromOriginal(graph, input, depth + 1);
        if (count) |old| try std.testing.expect(old == actual) else count = actual;
    }
    return count.? + @as(usize, if (node == .copy) 1 else 0);
}

test "ordinary reference aliases keep private views, both copies and complete branch returns" {
    var fixture: Fixture = undefined; fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &directory);
    const before = c.remaining;
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &directory, function_text, graph, &budget)) == .valid);
    try std.testing.expectEqual(@as(usize, 2), graph.normal.len); try std.testing.expectEqual(@as(usize, 2), graph.exits.normal.len);
    try std.testing.expectEqual(@as(usize, 0), graph.language.len); try std.testing.expectEqual(@as(usize, 0), graph.exits.language.len);
    var paths: u3 = 0;
    for (graph.normal) |value| { const count = try copiesFromOriginal(graph, value, 0); try std.testing.expect(count == 1 or count == 2); paths |= @as(u3, 1) << @as(u2, @intCast(count)); }
    try std.testing.expectEqual(@as(u3, 6), paths);
    var copies: usize = 0; var copy_heaps: usize = 0; var untyped: usize = 0;
    for (graph.nodes, 0..) |node, index| {
        if (node == .join and node.join.@"type" == null) untyped += 1;
        if (node != .copy) continue;
        copies += 1; try std.testing.expectEqualStrings(reference_text, node.copy.@"type");
        var owners: usize = 0;
        for (graph.heaps) |heap| if (heap == .copy and heap.copy.value == index) { owners += 1; try std.testing.expectEqual(node.copy.heap, heap.copy.previous); };
        try std.testing.expectEqual(@as(usize, 1), owners);
    }
    for (graph.heaps) |heap| { if (heap == .copy) copy_heaps += 1; }
    try std.testing.expectEqual(@as(usize, 2), copies); try std.testing.expectEqual(copies, copy_heaps);
    try std.testing.expectEqual(@as(usize, 2), untyped);
    try std.testing.expect(before < wire.format.max_work and c.remaining < before and c.remaining > 0);
}

test "ordinary view rejects a different owned physical reference after typed prerequisites" {
    var fixture: Fixture = undefined; fixture.init(); fixture.registers[3].carrier = .{ .@"type" = other };
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &directory);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "ordinary alias does not waive the required copy type archive" {
    var fixture: Fixture = undefined; fixture.init();
    // Same public reference views reach this mandatory copy lookup even with
    // the old Body. The private void type belongs only to the final copy use.
    for (2..4) |index| {
        fixture.instructions[index].data = .{ .domain_view = .{ .static_view = reference } };
        fixture.operations[index].view = reference_text; fixture.operations[index].properties = &reference_view_properties;
        fixture.registers[index + 1].view = reference; fixture.carriers[index + 1] = reference_text;
    }
    fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; fixture.registers[5].view = void_type;
    fixture.operations[4].view = void_text; fixture.operations[4].properties = &private_copy_properties; fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &directory);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

const integer_text = "sha256:4444444444444444444444444444444444444444444444444444444444444444";
const Scalar = enum { boolean, integer };
const Concrete = std.meta.Child(@TypeOf(@as(storage.CommonStorage, undefined).concrete));
const ScalarFixture = struct {
    fixture: Fixture,
    concrete: [4]Concrete,
    argument_types: [2]t.TypeRef,
    physical_parameters: [2]t.Carrier,
    parameter_types: [2]origin.Symbol,
    type_rows: [3]origin.TypeRow,
    function_rows: [1]origin.FunctionRow,
    interpretation: origin.Directory,
    copy_properties: [1]t.JsonMember,
    view_properties: [1]t.JsonMember,
    data_type: t.TypeRef,
    data_text: []const u8,

    fn init(self: *ScalarFixture, kind: Scalar) void {
        self.fixture.init();
        // Reuse the finite ordinary fixture, not a constructor/Source receipt.
        // The formerly unused fourth owned type is i32 for these scalar cases.
        self.fixture.types[3].kind = .scalar; self.fixture.types[3].name = "i32"; self.fixture.types[3].native_code = 1;
        for (0..4) |index| self.concrete[index] = self.fixture.program.tables.mode.common.storage.concrete[index];
        self.concrete[3] = .{ .@"type" = other, .carrier = .{ .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null };
        self.fixture.program.tables.mode.common.storage.concrete = &self.concrete;
        self.data_type = if (kind == .boolean) boolean else other;
        self.data_text = if (kind == .boolean) boolean_text else integer_text;
        const carrier: t.Carrier = .{ .@"type" = self.data_type };
        self.fixture.bindings[0].@"type" = self.data_type; self.fixture.bindings[0].carrier = carrier;
        self.argument_types = .{ self.data_type, boolean }; self.physical_parameters = .{ carrier, boolean_carrier };
        self.fixture.abis[0].argument_types = &self.argument_types; self.fixture.abis[0].physical_parameters = &self.physical_parameters;
        self.fixture.abis[0].result = self.data_type; self.fixture.abis[0].result_carrier = carrier;
        for ([_]usize{ 0, 2, 3, 4, 5 }) |index| {
            self.fixture.registers[index].carrier = carrier;
            self.fixture.registers[index].view = if (index == 3 or index == 4) void_type else self.data_type;
            self.fixture.carriers[index] = if (index == 3 or index == 4) void_text else self.data_text;
        }
        self.copy_properties = .{.{ .key = "type", .value = .{ .string = self.data_text } }};
        self.view_properties = .{.{ .key = "target", .value = .{ .string = self.data_text } }};
        for ([_]usize{ 1, 4 }) |index| {
            self.fixture.instructions[index].data = .{ .domain_copy = .{ .static_view = self.data_type } };
            self.fixture.operations[index].view = self.data_text; self.fixture.operations[index].properties = &self.copy_properties;
        }
        self.type_rows = .{ directory.types[0], directory.types[1], .{ .id = integer_text, .kind = .scalar } };
        self.parameter_types = .{ self.data_text, boolean_text }; self.function_rows = .{directory.functions[0]};
        self.function_rows[0].parameter_types = &self.parameter_types; self.function_rows[0].return_type = self.data_text;
        self.interpretation = directory; self.interpretation.types = &self.type_rows; self.interpretation.functions = &self.function_rows;
    }
};

fn scalarAliases(kind: Scalar) !void {
    var scalar: ScalarFixture = undefined; scalar.init(kind);
    try dataAliases(&scalar);
}

fn dataAliases(scalar: *ScalarFixture) !void {
    var c = context.Context{ .program = &scalar.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &scalar.interpretation);
    const before = c.remaining;
    var projected = try body.project(&c, @enumFromInt(0), &scalar.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &scalar.interpretation, function_text, graph, &budget)) == .valid);
    // Both scalar inputs have the same physical type in the bool case. The
    // independent oracle must still reach parameter0, never the branch flag.
    var paths: u3 = 0;
    for (graph.normal) |value| { const count = try copiesFromOriginal(graph, value, 0); try std.testing.expect(count == 1 or count == 2); paths |= @as(u3, 1) << @as(u2, @intCast(count)); }
    try std.testing.expectEqual(@as(u3, 6), paths);
    try std.testing.expectEqual(@as(usize, 2), graph.normal.len); try std.testing.expectEqual(@as(usize, 2), graph.exits.normal.len);
    try std.testing.expectEqual(@as(usize, 0), graph.language.len); try std.testing.expectEqual(@as(usize, 0), graph.exits.language.len);
    var copies: usize = 0; var copy_heaps: usize = 0; var untyped: usize = 0;
    for (graph.nodes, 0..) |node, index| {
        if (node == .join and node.join.@"type" == null) untyped += 1;
        if (node != .copy) continue;
        copies += 1; try std.testing.expectEqualStrings(scalar.data_text, node.copy.@"type");
        var owners: usize = 0;
        for (graph.heaps) |heap| if (heap == .copy and heap.copy.value == index) { owners += 1; try std.testing.expectEqual(node.copy.heap, heap.copy.previous); };
        try std.testing.expectEqual(@as(usize, 1), owners);
    }
    for (graph.heaps) |heap| { if (heap == .copy) copy_heaps += 1; }
    try std.testing.expectEqual(@as(usize, 2), copies); try std.testing.expectEqual(copies, copy_heaps);
    try std.testing.expectEqual(@as(usize, 2), untyped);
    try std.testing.expect(before < wire.format.max_work and c.remaining < before and c.remaining > 0);
}

test "ordinary bool views keep original Data and both copy heaps without numeric evaluation" {
    try scalarAliases(.boolean);
}

test "ordinary i32 views keep original Data and both copy heaps without numeric evaluation" {
    try scalarAliases(.integer);
}

test "ordinary scalar aliases reject a different owned scalar carrier" {
    for ([_]Scalar{ .boolean, .integer }) |kind| {
        var scalar: ScalarFixture = undefined; scalar.init(kind);
        scalar.fixture.registers[3].carrier = .{ .@"type" = if (kind == .boolean) other else boolean };
        var c = context.Context{ .program = &scalar.fixture.program, .allocator = std.testing.allocator };
        var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &scalar.interpretation);
        var projected = try body.project(&c, @enumFromInt(0), &scalar.interpretation, &budget); defer projected.deinit();
        try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
    }
}

test "ordinary scalar views keep the required copy archive strict" {
    var scalar: ScalarFixture = undefined; scalar.init(.boolean);
    for (2..4) |index| {
        scalar.fixture.instructions[index].data = .{ .domain_view = .{ .static_view = boolean } };
        scalar.fixture.operations[index].view = boolean_text; scalar.fixture.operations[index].properties = &scalar.view_properties;
        scalar.fixture.registers[index + 1].view = boolean; scalar.fixture.carriers[index + 1] = boolean_text;
    }
    scalar.fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; scalar.fixture.registers[5].view = void_type;
    scalar.fixture.operations[4].view = void_text; scalar.fixture.operations[4].properties = &private_copy_properties; scalar.fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &scalar.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &scalar.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &scalar.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

fn stringFixture(fixture: *ScalarFixture) void {
    // Reuse the complete owned fourth-slot ABI/SourcePlan fixture. Its opaque
    // test identifier has no scalar meaning or claimed Source type digest.
    fixture.init(.integer);
    fixture.fixture.types[3].kind = .string; fixture.fixture.types[3].name = "String"; fixture.fixture.types[3].native_code = 0;
    fixture.concrete[3].carrier.layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 };
    fixture.type_rows[2].kind = .string;
    // body remains null and field_offsets remain empty. No constructor row,
    // String operation, encoding or actual heap representation is introduced.
}

test "ordinary String views preserve parameter Data, both copies and full normal returns" {
    var fixture: ScalarFixture = undefined; stringFixture(&fixture);
    try std.testing.expect(fixture.fixture.types[3].kind == .string);
    try std.testing.expectEqual(@as(u32, 8), fixture.concrete[3].carrier.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 8), fixture.concrete[3].carrier.layout.alignment);
    try std.testing.expectEqual(@as(u16, 1), fixture.concrete[3].carrier.layout.reference_count);
    try std.testing.expect(fixture.concrete[3].body == null and fixture.concrete[3].carrier.field_offsets.len == 0);
    try dataAliases(&fixture);
}

test "ordinary String alias rejects a different owned physical carrier" {
    var fixture: ScalarFixture = undefined; stringFixture(&fixture);
    fixture.fixture.registers[3].carrier = boolean_carrier;
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "ordinary String view keeps the required copy archive strict" {
    var fixture: ScalarFixture = undefined; stringFixture(&fixture);
    for (2..4) |index| {
        fixture.fixture.instructions[index].data = .{ .domain_view = .{ .static_view = fixture.data_type } };
        fixture.fixture.operations[index].view = fixture.data_text; fixture.fixture.operations[index].properties = &fixture.view_properties;
        fixture.fixture.registers[index + 1].view = fixture.data_type; fixture.fixture.carriers[index + 1] = fixture.data_text;
    }
    fixture.fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; fixture.fixture.registers[5].view = void_type;
    fixture.fixture.operations[4].view = void_text; fixture.fixture.operations[4].properties = &private_copy_properties; fixture.fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

fn undefinedFixture(fixture: *ScalarFixture) void {
    // This is an owned undefined Data slot, not a literal inferred from its
    // private view. The same parameter/ABI/copy identities remain independent.
    fixture.init(.integer);
    fixture.fixture.types[3].kind = .@"undefined"; fixture.fixture.types[3].name = "undefined"; fixture.fixture.types[3].native_code = 0;
    fixture.concrete[3].carrier.layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 };
    fixture.type_rows[2].kind = .@"undefined";
}

test "ordinary undefined views keep original parameter Data without numeric consumption" {
    var fixture: ScalarFixture = undefined; undefinedFixture(&fixture);
    try std.testing.expect(fixture.fixture.types[3].kind == .@"undefined");
    try std.testing.expectEqual(@as(u32, 0), fixture.concrete[3].carrier.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 1), fixture.concrete[3].carrier.layout.alignment);
    try std.testing.expectEqual(@as(u16, 0), fixture.concrete[3].carrier.layout.reference_count);
    try std.testing.expect(fixture.concrete[3].body == null and fixture.concrete[3].carrier.field_offsets.len == 0);
    try dataAliases(&fixture);
}

test "ordinary undefined view rejects a different owned physical carrier" {
    var fixture: ScalarFixture = undefined; undefinedFixture(&fixture);
    fixture.fixture.registers[3].carrier = boolean_carrier;
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "ordinary undefined view keeps the required copy archive strict" {
    var fixture: ScalarFixture = undefined; undefinedFixture(&fixture);
    for (2..4) |index| {
        fixture.fixture.instructions[index].data = .{ .domain_view = .{ .static_view = fixture.data_type } };
        fixture.fixture.operations[index].view = fixture.data_text; fixture.fixture.operations[index].properties = &fixture.view_properties;
        fixture.fixture.registers[index + 1].view = fixture.data_type; fixture.fixture.carriers[index + 1] = fixture.data_text;
    }
    fixture.fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; fixture.fixture.registers[5].view = void_type;
    fixture.fixture.operations[4].view = void_text; fixture.fixture.operations[4].properties = &private_copy_properties; fixture.fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

fn nullFixture(fixture: *ScalarFixture) void {
    // Pure null transport has the same empty physical size as undefined, but
    // retains its own TypeRef. No literal/category or numeric use is inferred.
    fixture.init(.integer);
    fixture.fixture.types[3].kind = .@"null"; fixture.fixture.types[3].name = "null"; fixture.fixture.types[3].native_code = 0;
    fixture.concrete[3].carrier.layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 };
    fixture.type_rows[2].kind = .@"null";
}

test "ordinary null views keep original parameter Data without a numeric decision" {
    var fixture: ScalarFixture = undefined; nullFixture(&fixture);
    try std.testing.expect(fixture.fixture.types[3].kind == .@"null");
    try std.testing.expectEqual(@as(u32, 0), fixture.concrete[3].carrier.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 1), fixture.concrete[3].carrier.layout.alignment);
    try std.testing.expectEqual(@as(u16, 0), fixture.concrete[3].carrier.layout.reference_count);
    try std.testing.expect(fixture.concrete[3].body == null and fixture.concrete[3].carrier.field_offsets.len == 0);
    try dataAliases(&fixture);
}

test "ordinary null view rejects an undefined carrier despite the same empty layout" {
    var fixture: ScalarFixture = undefined; nullFixture(&fixture);
    var types: [5]tables.CommonType = undefined;
    var concrete: [5]Concrete = undefined;
    for (0..4) |index| { types[index] = fixture.fixture.types[index]; concrete[index] = fixture.concrete[index]; }
    const undefined_type: t.TypeRef = @enumFromInt(4);
    types[4] = types[3]; types[4].id = @splat(0x88); types[4].kind = .@"undefined"; types[4].name = "undefined";
    concrete[4] = concrete[3]; concrete[4].@"type" = undefined_type;
    fixture.fixture.program.tables.mode.common.types = &types;
    fixture.fixture.program.tables.mode.common.storage.concrete = &concrete;
    fixture.fixture.registers[3].carrier = .{ .@"type" = undefined_type };
    try std.testing.expectEqualDeep(concrete[3].carrier.layout, concrete[4].carrier.layout);
    try std.testing.expect(!std.meta.eql(fixture.fixture.registers[2].carrier, fixture.fixture.registers[3].carrier));
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "ordinary null view keeps the required copy archive strict" {
    var fixture: ScalarFixture = undefined; nullFixture(&fixture);
    for (2..4) |index| {
        fixture.fixture.instructions[index].data = .{ .domain_view = .{ .static_view = fixture.data_type } };
        fixture.fixture.operations[index].view = fixture.data_text; fixture.fixture.operations[index].properties = &fixture.view_properties;
        fixture.fixture.registers[index + 1].view = fixture.data_type; fixture.fixture.carriers[index + 1] = fixture.data_text;
    }
    fixture.fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; fixture.fixture.registers[5].view = void_type;
    fixture.fixture.operations[4].view = void_text; fixture.fixture.operations[4].properties = &private_copy_properties; fixture.fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &fixture.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

const field_text = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const Field = std.meta.Child(@TypeOf(@as(tables.CommonTables, undefined).members.fields));
const ValueFixture = struct {
    data: ScalarFixture,
    bindings: [3]storage.CommonBinding,
    fields: [1]Field,
    constructions: [2]origin.Construction,

    fn init(self: *ValueFixture) void {
        self.data.init(.integer);
        self.data.fixture.types[3].kind = .value; self.data.fixture.types[3].name = "FlagValue"; self.data.fixture.types[3].native_code = 0;
        self.bindings[0] = self.data.fixture.bindings[0]; self.bindings[1] = self.data.fixture.bindings[1];
        self.bindings[2] = .{ .id = "ordinary-value-flag-field", .owner = .{ .field = @enumFromInt(0) }, .name = "flag",
            .@"type" = boolean, .writable = true, .origin = declaration, .carrier = boolean_carrier, .scope = null, .declaration_kind = null };
        self.fields = .{.{ .id = @splat(0xaa), .owner = other, .ordinal = 0, .name = "flag", .@"type" = boolean,
            .declared_type = boolean, .readonly = false, .optional = false, .access = .public, .origin = declaration, .binding = @enumFromInt(2) }};
        self.data.fixture.program.tables.mode.common.storage.bindings = &self.bindings;
        self.data.fixture.program.tables.mode.common.members.fields = &self.fields;
        self.data.concrete[3] = .{ .@"type" = other,
            .carrier = .{ .layout = .{ .byte_size = 1, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{0} },
            .body = .{ .byte_size = 1, .alignment = 1, .reference_count = 0,
                .fields = &.{.{ .field = @enumFromInt(0), .binding = @enumFromInt(2), .offset = 0, .reference_offset = 0 }} } };
        self.data.type_rows[2].kind = .value;
        self.constructions = .{ directory.constructions[0], .{ .id = "ordinary-value-fixture-construction", .owner = self.data.data_text,
            .base = null, .kind = .implicit_base, .function_id = null } };
        self.data.interpretation.constructions = &self.constructions; self.data.interpretation.fields = &.{field_text};
        // This is a nonempty by-value payload with actual field/binding/offset
        // metadata. The archive's required declaration row adds no constructor
        // ABI, receiver frame, reference-alias permission or initialization.
    }
};

test "ordinary nonempty Value views preserve both explicit copies and original parameter Data" {
    var fixture: ValueFixture = undefined; fixture.init();
    try std.testing.expect(fixture.data.fixture.types[3].kind == .value);
    try std.testing.expectEqual(@as(usize, 1), fixture.fields.len);
    try std.testing.expectEqual(fixture.bindings[2].@"type", fixture.fields[0].@"type");
    try std.testing.expectEqual(@as(u32, 1), fixture.data.concrete[3].carrier.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 1), fixture.data.concrete[3].carrier.layout.alignment);
    try std.testing.expectEqual(@as(u16, 0), fixture.data.concrete[3].carrier.layout.reference_count);
    try std.testing.expectEqual(@as(usize, 1), fixture.data.concrete[3].body.?.fields.len);
    try dataAliases(&fixture.data);
}

test "ordinary Value view rejects a scalar carrier despite the same physical layout" {
    var fixture: ValueFixture = undefined; fixture.init();
    fixture.data.fixture.registers[3].carrier = boolean_carrier;
    try std.testing.expectEqualDeep(fixture.data.concrete[3].carrier.layout, fixture.data.concrete[1].carrier.layout);
    var c = context.Context{ .program = &fixture.data.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.data.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.data.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.view, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "ordinary Value view keeps the required copy archive strict" {
    var fixture: ValueFixture = undefined; fixture.init();
    for (2..4) |index| {
        fixture.data.fixture.instructions[index].data = .{ .domain_view = .{ .static_view = fixture.data.data_type } };
        fixture.data.fixture.operations[index].view = fixture.data.data_text; fixture.data.fixture.operations[index].properties = &fixture.data.view_properties;
        fixture.data.fixture.registers[index + 1].view = fixture.data.data_type; fixture.data.fixture.carriers[index + 1] = fixture.data.data_text;
    }
    fixture.data.fixture.instructions[4].data = .{ .domain_copy = .{ .static_view = void_type } }; fixture.data.fixture.registers[5].view = void_type;
    fixture.data.fixture.operations[4].view = void_text; fixture.data.fixture.operations[4].properties = &private_copy_properties; fixture.data.fixture.carriers[5] = void_text;
    var c = context.Context{ .program = &fixture.data.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &fixture.data.interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &fixture.data.interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(body.Pending.archive_type, projected.pending.?); try std.testing.expect(projected.graph == null);
}

test "nonempty Value field offsets remain an owning layout prerequisite" {
    var fixture: ValueFixture = undefined; fixture.init();
    fixture.data.concrete[3].carrier.field_offsets = &.{1};
    var c = context.Context{ .program = &fixture.data.fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
    // Failure is at the real layout boundary, before Body projection. It must
    // never be reported as a Value-view rejection or a successful certificate.
    try std.testing.expectError(error.InvalidShape, typedInput(&c, &budget, &fixture.data.interpretation));
}
