// SPDX-License-Identifier: MIT
// Handwritten passive Context metadata. No Source package, parser, factory,
// loader, Runtime State, VM or actual-analysis marker. Zero unused envelope
// fields convey no admission or digest premise. All slices have module/self
// backing; no runtime-valued anonymous array escapes an initializer.
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
const m = @import("wire-program-return-origin-model.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const body = @import("wire-program-return-origin-body.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const certificates = @import("wire-program-return-origins.zig");
const publication = @import("wire-program-publication.zig");
const dto = @import("constructor-call-literal-dto.zig");
const t = wire.types;
const ins = wire.instruction;
const a: t.TypeRef = @enumFromInt(0);
const b: t.TypeRef = @enumFromInt(1);
const scalar: t.TypeRef = @enumFromInt(2);
const undefined_type: t.TypeRef = @enumFromInt(3);
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const r3: t.RegisterRef = @enumFromInt(3);
const r4: t.RegisterRef = @enumFromInt(4);
const r5: t.RegisterRef = @enumFromInt(5);
const r6: t.RegisterRef = @enumFromInt(6);
const r7: t.RegisterRef = @enumFromInt(7);
const r8: t.RegisterRef = @enumFromInt(8);
const r9: t.RegisterRef = @enumFromInt(9);
const ac: t.Carrier = .{ .@"type" = a };
const bc: t.Carrier = .{ .@"type" = b };
const sc: t.Carrier = .{ .@"type" = scalar };
const uc: t.Carrier = .{ .@"type" = undefined_type };
const af: t.Carrier = .{ .receiver = @enumFromInt(0) };
const bf: t.Carrier = .{ .receiver = @enumFromInt(1) };
const token: t.Carrier = .{ .initialization = @enumFromInt(1) };
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 100 };
const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
const payload = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const a_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.a } }, .{ .key = "construction", .value = .{ .string = dto.role_a } } };
const b_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } } };
const create_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } }, .{ .key = "new_target", .value = .{ .string = dto.b } } };
const field_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } }, .{ .key = "field", .value = .{ .string = dto.field } } };
const invoke_properties = [_]t.JsonMember{ .{ .key = "function_id", .value = .{ .string = dto.callee } }, .{ .key = "signature_hash", .value = .{ .string = "sha256:" ++ "bb" ** 32 } } };
const caller_registers = [_]wire.Register{
    .{ .carrier = af, .view = null }, .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null }, .{ .carrier = ac, .view = a }, .{ .carrier = .payload, .view = null },
};
const caller_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(1), .new_target = b } } },
    .{ .source = operation, .result = null, .operands = &.{r1}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(1), .exceptional = @enumFromInt(2) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r2 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(3), .language = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r4}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r5}, .data = .eh_raise },
};
const caller_blocks = [_]wire.Block{
    .{ .parameters = &.{r0}, .instructions = caller_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = caller_instructions[3..4] }, .{ .parameters = &.{r3}, .instructions = caller_instructions[4..5] }, .{ .parameters = &.{r4}, .instructions = caller_instructions[5..6] }, .{ .parameters = &.{r5}, .instructions = caller_instructions[6..7] },
};
const caller_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.b, .properties = &create_properties, .result = r1, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &invoke_properties, .result = null, .operands = &.{r1}, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &a_properties, .result = null, .operands = &.{ r0, r2 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r4}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r5}, .successors = &.{}, .source = operation },
};
const caller_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r0}, .operations = caller_operations[0..3] }, .{ .parameters = &.{r2}, .operations = caller_operations[3..4] }, .{ .parameters = &.{r3}, .operations = caller_operations[4..5] }, .{ .parameters = &.{r4}, .operations = caller_operations[5..6] }, .{ .parameters = &.{r5}, .operations = caller_operations[6..7] },
};
const callee_registers = [_]wire.Register{
    .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null }, .{ .carrier = token, .view = null },
    .{ .carrier = sc, .view = scalar }, .{ .carrier = token, .view = null }, .{ .carrier = uc, .view = undefined_type }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null },
};
const callee_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .receiver_allocate = .{ .construction = @enumFromInt(1) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .receiver_bind = .{ .construction = @enumFromInt(1), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{ r0, r2 }, .data = .{ .initialize_begin = .{ .construction = @enumFromInt(1) } } },
    .{ .source = operation, .result = r5, .operands = &.{}, .data = .{ .const_i32 = 7 } },
    .{ .source = operation, .result = r6, .operands = &.{ r4, r2, r5 }, .data = .{ .initialize_field = .{ .construction = @enumFromInt(1), .field = @enumFromInt(0) } } },
    .{ .source = operation, .result = null, .operands = &.{ r6, r2 }, .data = .{ .initialize_end = .{ .construction = @enumFromInt(1) } } },
    .{ .source = operation, .result = r7, .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = undefined_type } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r7 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(1), .normal = @enumFromInt(3), .language = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r8}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r9}, .data = .eh_raise },
};
const callee_blocks = [_]wire.Block{
    .{ .parameters = &.{r0}, .instructions = callee_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = callee_instructions[3..9] }, .{ .parameters = &.{r3}, .instructions = callee_instructions[9..10] }, .{ .parameters = &.{r8}, .instructions = callee_instructions[10..11] }, .{ .parameters = &.{r9}, .instructions = callee_instructions[11..12] },
};
const callee_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_allocate", .view = dto.b, .properties = &b_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_bind", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r0, r1 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "initialize_begin", .view = "initialization:" ++ dto.b, .properties = &b_properties, .result = r4, .operands = &.{ r0, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "constant", .view = dto.scalar, .properties = &.{.{ .key = "decimal", .value = .{ .string = "7" } }}, .result = r5, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "initialize_field", .view = "initialization:" ++ dto.b, .properties = &field_properties, .result = r6, .operands = &.{ r4, r2, r5 }, .successors = &.{}, .source = operation },
    .{ .name = "initialize_end", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r6, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "undefined", .view = dto.undefined_type, .properties = &.{}, .result = r7, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r0, r7 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r9}, .successors = &.{}, .source = operation },
};
const callee_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r0}, .operations = callee_operations[0..3] }, .{ .parameters = &.{r2}, .operations = callee_operations[3..9] }, .{ .parameters = &.{r3}, .operations = callee_operations[9..10] }, .{ .parameters = &.{r8}, .operations = callee_operations[10..11] }, .{ .parameters = &.{r9}, .operations = callee_operations[11..12] },
};
// Independent whole-body upper: both literal producers belong to the
// receiver_bind normal block in the literal SourcePlan, so their uses retain
// that exact birth predicate. The shared Domain-only graph does not claim this
// stronger current-body access/guard certificate. No projection builds it.
const complete_nodes: [8]m.Value = blk: {
    var nodes: [8]m.Value = undefined; @memcpy(nodes[0..6], dto.leaf.nodes);
    nodes[6] = .{ .gate = .{ .@"type" = dto.scalar, .inputs = &.{3}, .control = 2 } };
    nodes[7] = .{ .gate = .{ .@"type" = dto.undefined_type, .inputs = &.{4}, .control = 2 } };
    break :blk nodes;
};
const complete_heaps: [5]m.Heap = blk: {
    var heaps = dto.leaf.heaps[0..5].*; heaps[3].store.values = &.{6}; heaps[4].receiver_action.operands = &.{7}; break :blk heaps;
};
const complete_leaf: m.Graph = blk: {
    var graph = dto.leaf; graph.nodes = &complete_nodes; graph.heaps = &complete_heaps;
    graph.accesses = &.{.{ .values = &.{2}, .flag = .write, .control = 2 }};
    break :blk graph;
};
const complete_contracts: [2]domain.PublicationContract = blk: {
    var rows = dto.contracts; rows[1].return_origins = complete_leaf; break :blk rows;
};
const Fixture = struct {
    program: wire.Program,
    sources: [1]tables.Source,
    types: [4]tables.CommonType,
    bindings: [3]storage.CommonBinding,
    abis: [2]storage.CommonAbi,
    functions: [2]wire.Function,
    fn init(self: *Fixture) void {
        self.sources = .{.{ .hash = @splat(0x10), .path = "constructor-call-body-dto.ts", .length = 100 }};
        const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "A", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null };
        self.types = .{ base, base, base, base }; self.types[1].id = @splat(0x22); self.types[1].name = "B";
        self.types[2].id = @splat(0x33); self.types[2].kind = .scalar; self.types[2].name = "i32"; self.types[2].native_code = 1;
        self.types[3].id = @splat(0x44); self.types[3].kind = .@"undefined"; self.types[3].name = "undefined";
        self.bindings = .{
            .{ .id = "a-receiver", .owner = .{ .receiver = @enumFromInt(0) }, .name = "this", .@"type" = a, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(0), .declaration_kind = null },
            .{ .id = "b-receiver", .owner = .{ .receiver = @enumFromInt(1) }, .name = "this", .@"type" = b, .writable = false, .origin = declaration, .carrier = bc, .scope = @enumFromInt(1), .declaration_kind = null },
            .{ .id = "b-field", .owner = .{ .field = @enumFromInt(0) }, .name = "value", .@"type" = scalar, .writable = true, .origin = operation, .carrier = sc, .scope = null, .declaration_kind = null },
        };
        const prototype: storage.CommonAbi = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0xaa), .parameters = &.{}, .argument_types = &.{}, .receiver = @enumFromInt(0), .construction = @enumFromInt(0), .receiver_frame = 0, .lexical_environment = null, .physical_parameters = &.{af}, .result = a, .result_carrier = ac,
            .source_plan = .{ .carriers = &.{ "receiver:" ++ dto.a, "receiver:" ++ dto.b, dto.b, payload, dto.a, payload }, .blocks = &caller_plan } };
        self.abis = .{ prototype, prototype }; self.abis[1].function = @enumFromInt(1); self.abis[1].signature = @splat(0xbb); self.abis[1].receiver = @enumFromInt(1); self.abis[1].construction = @enumFromInt(1); self.abis[1].physical_parameters = &.{bf}; self.abis[1].result = b; self.abis[1].result_carrier = bc;
        self.abis[1].source_plan = .{ .carriers = &.{ "receiver:" ++ dto.b, dto.b, dto.b, payload, "initialization:" ++ dto.b, dto.scalar, "initialization:" ++ dto.b, dto.undefined_type, dto.b, payload }, .blocks = &callee_plan };
        const function: wire.Function = .{ .id = @splat(0x55), .signature = @splat(0xaa), .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .construction_body, .declaration = .{ .start = 0, .end = 100 }, .name = "A", .registers = &caller_registers, .blocks = &caller_blocks };
        self.functions = .{ function, function }; self.functions[1].id = @splat(0x66); self.functions[1].signature = @splat(0xbb); self.functions[1].abi = @enumFromInt(1); self.functions[1].name = "B"; self.functions[1].registers = &callee_registers; self.functions[1].blocks = &callee_blocks;
        var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis; common.storage.bindings = &self.bindings; common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.members.fields = &.{.{ .id = @splat(0x99), .owner = b, .ordinal = 0, .name = "value", .@"type" = scalar, .declared_type = scalar, .readonly = false, .optional = false, .access = .public, .origin = operation, .binding = @enumFromInt(2) }};
        common.members.constructions = &.{
            .{ .id = @splat(0x77), .owner = a, .function = @enumFromInt(0), .kind = .explicit, .origin = declaration, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = a }, .source_signature = .{ .id = @splat(0xaa), .origin = declaration }, .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public },
            .{ .id = @splat(0x88), .owner = b, .function = @enumFromInt(1), .kind = .explicit, .origin = declaration, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = b }, .source_signature = .{ .id = @splat(0xbb), .origin = declaration }, .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{@enumFromInt(0)}, .access = .public },
        };
        common.storage.concrete = &.{
            .{ .@"type" = a, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            .{ .@"type" = b, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 4, .alignment = 4, .reference_count = 0, .fields = &.{.{ .field = @enumFromInt(0), .binding = @enumFromInt(2), .offset = 0, .reference_offset = 0 }} } },
            .{ .@"type" = scalar, .carrier = .{ .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
            .{ .@"type" = undefined_type, .carrier = .{ .layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
        };
        common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = @enumFromInt(1), .path = &.{"function"} } };
        common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(1) } };
        common.exceptions.functions = &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = @enumFromInt(1), .handlers = &.{} } };
        // Only the actual adapter's accessed complete row arrays are premises.
        // Other fixed-publication fields grant no Source/digest admission.
        common.authority.fixed_publication = std.mem.zeroes(publication.FixedPublication);
        common.authority.fixed_publication.stable_scope.functions = &dto.declarations;
        common.authority.fixed_publication.publication.contracts = &complete_contracts;
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};
fn typed(c: *context.Context, budget: *m.Budget) !void {
    for (c.program.functions) |function| {
        try c.anchor(function.declaration, function.source);
        for (function.registers) |register| { try c.carrier(register.carrier); try c.maybeRef(register.view, c.counts().types); }
        for (function.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
    }
    try layout.check(c); try ssa.check(c); try correspondence.check(c); try m.validateDirectory(c.allocator, &dto.directory, budget);
}
fn rootValue(graph: *const m.Graph, value: m.Ref) !m.Ref {
    var current = value;
    for (0..graph.nodes.len) |_| switch (graph.nodes[current]) {
        .join => |row| { try std.testing.expectEqual(@as(usize, 1), row.inputs.len); current = row.inputs[0]; },
        .gate => |row| { try std.testing.expectEqual(@as(usize, 1), row.inputs.len); current = row.inputs[0]; },
        else => return current,
    };
    return error.TestUnexpectedCycle;
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.scalar }} },
};
fn ownerRows(contracts: *const [2]domain.PublicationContract) [2]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
    };
}
fn expectPayload(result: *const owners.Analysis, receiver: usize) !void {
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(@as(usize, 0), result.language.len);
    const value = result.normal[0]; const location = result.locations[value];
    try std.testing.expect(location.kind == .root and location.owner == .local);
    try std.testing.expectEqualStrings(dto.b, location.type_id.?);
    try std.testing.expectEqual(@as(usize, 0), location.scope);
    try std.testing.expectEqual(receiver, location.node);
    try std.testing.expectEqualStrings("receiver-allocation", location.key.?);
    try std.testing.expectEqual(@as(usize, 1), result.normal_payloads.len);
    const payload_row = result.normal_payloads[0];
    try std.testing.expectEqual(value, payload_row.location);
    try std.testing.expectEqualStrings(dto.b, payload_row.type_id);
    try std.testing.expectEqual(@as(usize, 1), payload_row.slots.len);
    const slot = payload_row.slots[0];
    try std.testing.expectEqualStrings("field:" ++ dto.field, slot.selector);
    try std.testing.expectEqualStrings(dto.b, slot.view);
    try std.testing.expectEqual(@as(?usize, 0), slot.physical);
    try std.testing.expectEqual(@as(usize, 1), slot.values.len);
    const scalar_location = result.locations[slot.values[0]];
    try std.testing.expect(scalar_location.owner == .nonowning);
    try std.testing.expectEqualStrings(dto.scalar, scalar_location.type_id.?);
    var found = false;
    for (result.normal_heap) |address| if (address.base == value and std.mem.eql(u8, address.selector, slot.selector)) {
        try std.testing.expect(!found); found = true;
        try std.testing.expectEqualStrings(slot.view, address.view);
        try std.testing.expectEqualSlices(usize, slot.values, address.values.items);
    };
    try std.testing.expect(found);
    // The borrowed callee's formal input zero must not become an independent
    // local birth, nor inherit the caller's unrelated formal input zero.
    for (result.locations) |row| if (row.owner == .local and row.key != null and std.mem.eql(u8, row.key.?, "receiver-allocation")) {
        try std.testing.expectEqual(@as(usize, 0), row.scope);
        try std.testing.expectEqual(receiver, row.node);
        try std.testing.expectEqualStrings(dto.b, row.type_id.?);
    };
    try std.testing.expectEqual(@as(usize, 0), result.effects.len);
}
test "typed fixed constructor owner closure keeps original frames and initialized payload" {
    var fixture: Fixture = undefined; fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = m.Budget{ .context = &c, .charge = refs.graphCharge }; try typed(&c, &budget);
    var projection = try body.project(&c, @enumFromInt(0), &dto.directory, &budget); defer projection.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projection.pending); const graph = &projection.graph.?;
    const validation = try m.validateGraph(c.allocator, &dto.directory, dto.caller, graph, &budget);
    try std.testing.expect(validation == .pending); try std.testing.expectEqual(m.Pending.construction_frame, validation.pending);
    var arena = std.heap.ArenaAllocator.init(c.allocator); defer arena.deinit();
    const input = try refs.returnOriginConstructorInput(&c, arena.allocator(), c.program.tables.mode.common.authority.fixed_publication, dto.caller);
    const certificates_rows = [_]certificates.FixedContract{
        .{ .function_id = dto.caller, .graph = &dto.caller_graph, .complete = &input.fixed[0] },
        .{ .function_id = dto.callee, .graph = &complete_leaf, .complete = &input.fixed[1] },
    };
    try std.testing.expect((try certificates.covered(c.allocator, &dto.directory, dto.caller, graph, &certificates_rows, &budget)) == .covered);
    var receiver = try domain.analyzeReturns(c.allocator, &dto.directory, graph, &budget, input); defer receiver.deinit();
    // Stage one: the preexisting typed boundary, body certificate and shared
    // construction facts are GREEN before the Owners regression assertion.
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    try std.testing.expect(receiver.normal_live and !receiver.language_live);
    try std.testing.expectEqual(@as(usize, 1), receiver.calls.len);
    const fact = receiver.calls[0]; const caller_receiver = try rootValue(graph, graph.calls[0].receiver.?[0]);
    try std.testing.expectEqual(@as(usize, 0), fact.call);
    try std.testing.expectEqual(caller_receiver, fact.receiver);
    try std.testing.expectEqual(@as(usize, 0), fact.input);
    try std.testing.expect(fact.receiver != fact.input);
    try std.testing.expect(fact.graph == &complete_contracts[1].return_origins.? and fact.fixed == &input.fixed[1]);
    try std.testing.expect(fact.analysis.pending == null and fact.analysis.calls.len == 0);
    try std.testing.expect(fact.analysis.normal[0].source == .allocation and fact.analysis.normal[0].source.allocation == fact.input);
    try std.testing.expectEqualStrings(dto.b, receiver.frames[fact.receiver].new_target.?);
    try std.testing.expect(fact.analysis.frames[fact.input].new_target == null);
    const rows = ownerRows(&complete_contracts);
    var result = try owners.analyzeReceiver(c.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &receiver); defer result.deinit();
    // Stage two: the old implementation returns receiver_protocol here.
    try expectPayload(&result, caller_receiver);
    const initial: owners.Initial = .{ .locations = &.{}, .arguments = &.{&.{}}, .environment = &.{}, .heap = &.{}, .parents = &.{} };
    var saved = try owners.analyzeInputs(c.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &receiver, &initial); defer saved.deinit();
    try expectPayload(&saved, caller_receiver);
}
