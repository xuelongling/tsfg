// SPDX-License-Identifier: MIT
// Typed component projection of the retained Source3 mark function. The fixed
// comparison row carries the current independently derived Graph5 equations.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const context = @import("wire-program-refcheck-context.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const refs = @import("wire-program-publication-refs.zig");
const model = @import("wire-program-return-origin-model.zig");
const body = @import("wire-program-return-origin-body.zig");
const inclusion = @import("wire-program-return-origins.zig");
const construction = @import("wire-program-return-origin-construction.zig");
const publication = @import("wire-program-publication.zig");
const storage = @import("wire-program-storage.zig");
const t = wire.types;
const ins = wire.instruction;

const function = "sha256:588a98d862201eb3eae0b4c91c5f928335a3177cff7df0f829ff28ab5681ada7";
const global = "sha256:07d1beb495bcf492eea7774d30e3ca4fc105cab6a8918030b75b3cb202aa1c52";
const scalar = "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727";
const parameter = "sha256:98588f940a9db011926f2d3c4a65849f926c64c0a08998490d709368379a44b1";
const signature = "sha256:e193bf5b49dcad706855ee9e34c2335cb6e015ffb15f838ab79aff5b82e0fc06";
const type_id: t.TypeRef = @enumFromInt(0);
const native: t.Carrier = .{ .@"type" = type_id };
const cell: t.CellRef = @enumFromInt(0);
const global_ref: t.GlobalRef = @enumFromInt(0);
const Global = @typeInfo(@FieldType(tables.CommonModules, "globals")).pointer.child;

fn hash(comptime text: []const u8) t.Hash {
    return comptime result: {
        var bytes: t.Hash = undefined;
        _ = std.fmt.hexToBytes(&bytes, text[7..]) catch unreachable;
        break :result bytes;
    };
}

fn op(start: u32, end: u32, result: ?t.RegisterRef, operands: []const t.RegisterRef, data: ins.Data) ins.Instruction {
    return .{ .source = .{ .source = @enumFromInt(0), .start = start, .end = end }, .result = result, .operands = operands, .data = data };
}

fn numeric(start: u32, end: u32, operand: t.RegisterRef, operator: ins.Opcode, index: u8, successor: t.BlockRef, group: []const u8) ins.Instruction {
    return op(start, end, null, &.{operand}, .{ .domain_numeric_use = .{
        .target_type = type_id, .numeric_operator = operator, .numeric_arity = 2,
        .numeric_operand = index, .numeric_group = group, .normal_successor = successor,
    } });
}

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
const a1: t.RegisterRef = @enumFromInt(10);
const a2: t.RegisterRef = @enumFromInt(11);
const a3: t.RegisterRef = @enumFromInt(12);
const a4: t.RegisterRef = @enumFromInt(13);

const entry = [_]ins.Instruction{
    op(102, 166, null, &.{}, .{ .fuel = .{ .event = .entry } }),
    op(116, 122, r1, &.{}, .{ .eh_cell = .{ .binding = cell } }),
    op(116, 122, null, &.{ r1, r0 }, .{ .eh_store = .{ .binding = cell, .initialize = true } }),
    op(139, 144, r2, &.{}, .{ .global_load = .{ .global = global_ref } }),
    op(147, 149, r3, &.{}, .{ .const_i32 = 10 }),
    numeric(139, 149, r2, .mul, 0, @enumFromInt(1), "mark-multiply"),
};
const last = [_]ins.Instruction{
    op(139, 153, r6, &.{ a3, a4 }, .add),
    op(131, 153, r7, &.{r6}, .{ .domain_copy = .{ .static_view = type_id } }),
    op(131, 153, null, &.{r7}, .{ .global_store = .{ .global = global_ref, .initialize = false } }),
    op(162, 163, r8, &.{r1}, .{ .eh_load = .{ .binding = cell } }),
    op(155, 164, r9, &.{r8}, .{ .domain_copy = .{ .static_view = type_id } }),
    op(155, 164, null, &.{r9}, .@"return"),
};
const mark_registers = registers: {
    var rows = [_]wire.Register{.{ .carrier = native, .view = type_id }} ** 14;
    rows[1] = .{ .carrier = .{ .cell = cell }, .view = null };
    break :registers rows;
};
const directory: model.Directory = .{
    .types = &.{.{ .id = scalar, .kind = .scalar }},
    .functions = &.{.{ .id = function, .kind = .source, .parameter_types = &.{scalar},
        .return_type = scalar, .environment_metadata_complete = true,
        .lexical_environment = null, .activation_environment = null, .construction = null }},
    .globals = &.{.{ .id = global, .@"type" = scalar }}, .environments = &.{}, .fields = &.{}, .constructions = &.{},
};
const fixed: model.Graph = .{
    .nodes = &.{
        .{ .parameter = .{ .@"type" = scalar, .index = 0 } },
        .{ .nonowning = .{ .@"type" = scalar } },
        .{ .global = .{ .id = global, .@"type" = scalar } },
        .{ .gate = .{ .@"type" = null, .inputs = &.{2}, .control = 0 } },
        .{ .copy = .{ .@"type" = scalar, .bases = &.{1}, .heap = 0, .control = 0, .site = "[\"" ++ function ++ "\",131,153,\"assignment-store\"]" } },
        .{ .copy = .{ .@"type" = scalar, .bases = &.{0}, .heap = 1, .control = 0, .site = "[\"" ++ function ++ "\",155,164,\"return\"]" } },
    },
    .heaps = &.{ .entry, .{ .copy = .{ .previous = 0, .value = 4 } }, .{ .copy = .{ .previous = 1, .value = 5 } } },
    .controls = &.{.entry}, .calls = &.{}, .normal = &.{5}, .language = &.{},
    .exits = .{ .normal = &.{.{ .heap = 2, .control = 0 }}, .language = &.{} },
    .accesses = &.{.{ .values = &.{3}, .flag = .write, .control = 0 }},
};
const scalar_graph: model.Graph = .{
    .nodes = &.{
        fixed.nodes[0], fixed.nodes[2], .{ .literal = .{ .@"type" = scalar, .category = .other } },
        .{ .copy = .{ .@"type" = scalar, .bases = &.{2}, .heap = 0, .control = 0, .site = function ++ "/%v7" } },
        .{ .copy = .{ .@"type" = scalar, .bases = &.{0}, .heap = 1, .control = 0, .site = function ++ "/%v9" } },
    },
    .heaps = &.{ .entry, .{ .copy = .{ .previous = 0, .value = 3 } }, .{ .copy = .{ .previous = 1, .value = 4 } } },
    .controls = &.{.entry}, .calls = &.{}, .normal = &.{4}, .language = &.{},
    .exits = .{ .normal = &.{.{ .heap = 2, .control = 0 }}, .language = &.{} },
    .accesses = &.{ .{ .values = &.{1}, .flag = .read, .control = 0 }, .{ .values = &.{1}, .flag = .write, .control = 0 } },
};

const Fixture = struct {
    program: wire.Program,
    functions: [1]wire.Function,
    blocks: [5]wire.Block,
    globals: [1]Global,
    entry_instructions: [entry.len]ins.Instruction,
    last_instructions: [last.len]ins.Instruction,

    fn init(self: *Fixture) void {
        self.entry_instructions = entry;
        self.last_instructions = last;
        self.blocks = .{
            .{ .parameters = &.{r0}, .instructions = &self.entry_instructions },
            .{ .parameters = &.{a1}, .instructions = comptime &.{numeric(139, 149, r3, .mul, 1, @enumFromInt(2), "mark-multiply")} },
            .{ .parameters = &.{a2}, .instructions = comptime &.{
                op(139, 149, r4, &.{ a1, a2 }, .mul),
                op(152, 153, r5, &.{r1}, .{ .eh_load = .{ .binding = cell } }),
                numeric(139, 153, r4, .add, 0, @enumFromInt(3), "mark-add"),
            } },
            .{ .parameters = &.{a3}, .instructions = comptime &.{numeric(139, 153, r5, .add, 1, @enumFromInt(4), "mark-add")} },
            .{ .parameters = &.{a4}, .instructions = &self.last_instructions },
        };
        self.functions = .{.{ .id = hash(function), .signature = hash(signature), .abi = @enumFromInt(0), .source = @enumFromInt(0),
            .role = .ordinary, .declaration = .{ .start = 102, .end = 166 }, .name = "mark", .registers = &mark_registers, .blocks = &self.blocks }};
        self.globals = .{.{ .id = hash(global), .source = @enumFromInt(0), .name = "total", .@"type" = type_id, .carrier = native,
            .writable = true, .generated = false, .start = 0, .end = 102, .binding = @enumFromInt(1),
            .decl_key = .{ .kind = .global, .name = "total", .path = &.{}, .source_path = "/src/main.ts" } }};
        var common = std.mem.zeroes(tables.CommonTables);
        common.types = comptime &.{.{ .id = hash(scalar), .kind = .scalar, .name = "i32", .native_code = 1,
            .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null }};
        common.storage.bindings = comptime &.{
            .{ .id = parameter, .owner = .{ .param = @enumFromInt(0) }, .name = "n", .@"type" = type_id, .writable = true,
                .origin = .{ .source = @enumFromInt(0), .start = 116, .end = 122 }, .carrier = native, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = global, .owner = .{ .global = global_ref }, .name = "total", .@"type" = type_id, .writable = true,
                .origin = null, .carrier = native, .scope = null, .declaration_kind = null },
        };
        common.storage.concrete = comptime &.{.{ .@"type" = type_id, .carrier = .{
            .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null }};
        common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.abis = comptime &.{.{ .kind = .common, .function = @enumFromInt(0), .signature = hash(signature), .parameters = &.{@enumFromInt(0)},
            .argument_types = &.{type_id}, .receiver = null, .construction = null, .receiver_frame = null, .lexical_environment = null,
            .physical_parameters = &.{native}, .result = type_id, .result_carrier = native, .source_plan = .{ .carriers = &.{}, .blocks = &.{} } }};
        common.modules.globals = &self.globals;
        common.exceptions.scopes = comptime &.{.{ .owner = @enumFromInt(0), .path = &.{"function"} }};
        common.exceptions.bindings = comptime &.{.{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }};
        common.exceptions.functions = comptime &.{.{ .function = @enumFromInt(0), .handlers = &.{} }};
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0),
            .source_hash = @splat(0), .source_path = "/src/main.ts", .source_length = 2128, .root_source = @enumFromInt(0),
            .tables = .{ .sources = comptime &.{.{ .hash = @splat(0), .path = "/src/main.ts", .length = 2128 }}, .mode = .{ .common = common } },
            .functions = &self.functions };
    }
};

test "ordinary mark projects native Cell and guards while requiring both Global read and write" {
    var fixture: Fixture = undefined;
    fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    try layout.check(&c);
    try ssa.check(&c);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget);
    defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const graph = &projected.graph.?;
    try std.testing.expectEqual(@as(usize, 1), graph.exits.normal.len);
    try std.testing.expectEqual(@as(usize, 0), graph.exits.language.len);
    const published = [_]inclusion.FixedContract{.{ .function_id = function, .graph = &fixed }};
    try std.testing.expect((try inclusion.covered(c.allocator, &directory, function, graph, &published, &budget)) == .pending);

    // This independent physical comparison includes the read and the exact
    // native operator's successful scalar clause. The retained Source graph
    // above has different obligations at both of those points.
    const read: model.Access = .{ .values = &.{3}, .flag = .read, .control = 0 };
    const write = fixed.accesses[0];
    var physical_nodes: [fixed.nodes.len]model.Value = fixed.nodes[0..fixed.nodes.len].*;
    physical_nodes[1] = .{ .literal = .{ .@"type" = scalar, .category = .other } };
    var physical = fixed;
    physical.nodes = &physical_nodes;
    physical.accesses = &.{ read, write };
    const contracts = [_]inclusion.FixedContract{.{ .function_id = function, .graph = &physical }};
    try std.testing.expect((try inclusion.covered(c.allocator, &directory, function, graph, &contracts, &budget)) == .covered);
    var missing_write = physical;
    missing_write.accesses = &.{read};
    const narrow = [_]inclusion.FixedContract{.{ .function_id = function, .graph = &missing_write }};
    try std.testing.expect((try inclusion.covered(c.allocator, &directory, function, graph, &narrow, &budget)) == .pending);
    var missing_read = physical;
    missing_read.accesses = &.{write};
    const missing = [_]inclusion.FixedContract{.{ .function_id = function, .graph = &missing_read }};
    try std.testing.expect((try inclusion.covered(c.allocator, &directory, function, graph, &missing, &budget)) == .pending);
    physical_nodes[5].copy.bases = &.{1};
    const wrong_parameter = physical;
    const wrong = [_]inclusion.FixedContract{.{ .function_id = function, .graph = &wrong_parameter }};
    try std.testing.expect((try inclusion.covered(c.allocator, &directory, function, graph, &wrong, &budget)) == .pending);
}

test "ordinary mark projection keeps mutable Cells and Global initialization pending" {
    var fixture: Fixture = undefined;
    fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    fixture.entry_instructions[2].data.eh_store.initialize = false;
    var changed_cell = try body.project(&c, @enumFromInt(0), &directory, &budget);
    defer changed_cell.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .operation), changed_cell.pending);
    fixture.entry_instructions[2] = entry[2];
    fixture.last_instructions[2].data.global_store.initialize = true;
    var changed_global = try body.project(&c, @enumFromInt(0), &directory, &budget);
    defer changed_global.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .global_payload), changed_global.pending);
}

test "ordinary Cell projection rejects a branch carrying an aliased Cell handle" {
    var fixture: Fixture = undefined;
    fixture.init();
    const registers = [_]wire.Register{ mark_registers[0], mark_registers[1], mark_registers[1], mark_registers[0] };
    const initial = entry[0..3].* ++ [_]ins.Instruction{
        op(120, 122, null, &.{r1}, .{ .br = .{ .destination = @enumFromInt(1) } }),
    };
    const alias = [_]ins.Instruction{
        op(162, 163, r3, &.{r2}, .{ .eh_load = .{ .binding = cell } }),
        op(155, 164, null, &.{r3}, .@"return"),
    };
    fixture.blocks[0] = .{ .parameters = &.{r0}, .instructions = &initial };
    fixture.blocks[1] = .{ .parameters = &.{r2}, .instructions = &alias };
    fixture.functions[0].registers = &registers;
    fixture.functions[0].blocks = fixture.blocks[0..2];
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    try layout.check(&c);
    try ssa.check(&c);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget);
    defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, .operation), projected.pending);
}

const ctor: t.FunctionRef = @enumFromInt(1);
const object: t.TypeRef = @enumFromInt(1);
const object_carrier: t.Carrier = .{ .@"type" = object };
const receiver: t.Carrier = .{ .receiver = @enumFromInt(0) };
const token: t.Carrier = .{ .initialization = @enumFromInt(0) };
const owner_id: t.Hash = @splat(0xbb);
const constructor_id: t.Hash = @splat(0xcc);
const ctor_id: t.Hash = @splat(0xdd);
const ctor_signature: t.Hash = @splat(0xee);
const ctor_source = entry[0].source;
const no_access: publication.EffectUpper = .{
    .captures = &.{}, .parameters = &.{}, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .globals = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = false, .@"await" = false, .eh_control = false, .escape = false, .lock = false,
        .managed_reference = false, .may_throw = false, .unknown_host = false },
};
const ctor_registers = [_]wire.Register{
    .{ .carrier = receiver, .view = null },
    .{ .carrier = object_carrier, .view = object }, .{ .carrier = object_carrier, .view = object },
    .{ .carrier = .payload, .view = null }, .{ .carrier = native, .view = type_id },
    .{ .carrier = native, .view = type_id }, .{ .carrier = .payload, .view = null },
    .{ .carrier = token, .view = null }, .{ .carrier = token, .view = null },
    .{ .carrier = object_carrier, .view = object }, .{ .carrier = .payload, .view = null },
};
const ctor_blocks = [_]wire.Block{
    .{ .parameters = &.{r0}, .instructions = &.{
        entry[0],
        op(102, 110, r1, &.{r0}, .{ .receiver_allocate = .{ .construction = @enumFromInt(0) } }),
        op(102, 110, null, &.{ r0, r1 }, .{ .receiver_bind = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(1), .language = @enumFromInt(2) } }),
    } },
    .{ .parameters = &.{r2}, .instructions = &.{
        op(119, 120, r4, &.{}, .{ .const_i32 = 7 }),
        op(117, 121, null, &.{r4}, .{ .eh_invoke = .{ .callee = @enumFromInt(0), .normal = @enumFromInt(3), .exceptional = @enumFromInt(4) } }),
    } },
    .{ .parameters = &.{r3}, .instructions = &.{op(102, 110, null, &.{r3}, .eh_raise)} },
    .{ .parameters = &.{r5}, .instructions = &.{
        op(121, 122, r7, &.{ r0, r2 }, .{ .initialize_begin = .{ .construction = @enumFromInt(0) } }),
        op(121, 122, r8, &.{ r7, r2, r5 }, .{ .initialize_field = .{ .construction = @enumFromInt(0), .field = @enumFromInt(0) } }),
        op(121, 122, null, &.{ r8, r2 }, .{ .initialize_end = .{ .construction = @enumFromInt(0) } }),
        op(154, 166, null, &.{ r0, r5 }, .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(5), .language = @enumFromInt(6) } }),
    } },
    .{ .parameters = &.{r6}, .instructions = &.{op(117, 121, null, &.{r6}, .eh_raise)} },
    .{ .parameters = &.{r9}, .instructions = &.{op(154, 166, null, &.{r9}, .@"return")} },
    .{ .parameters = &.{a1}, .instructions = &.{op(154, 166, null, &.{a1}, .eh_raise)} },
};

const ReceiverFixture = struct {
    mark: Fixture,
    functions: [2]wire.Function,
    abis: [2]storage.CommonAbi,
    types: [2]tables.CommonType,
    bindings: [4]storage.CommonBinding,
    contracts: [2]construction.PublicationContract,

    fn init(self: *ReceiverFixture) void {
        self.mark.init();
        const common = &self.mark.program.tables.mode.common;
        self.functions = .{ self.mark.functions[0], .{ .id = ctor_id, .signature = ctor_signature, .abi = @enumFromInt(1), .source = @enumFromInt(0),
            .role = .construction_body, .declaration = .{ .start = 102, .end = 166 }, .name = "Box", .registers = &ctor_registers, .blocks = &ctor_blocks } };
        self.mark.program.functions = &self.functions;
        self.abis = .{ common.abis[0], .{ .kind = .common, .function = ctor, .signature = ctor_signature, .parameters = &.{}, .argument_types = &.{},
            .receiver = @enumFromInt(2), .construction = @enumFromInt(0), .receiver_frame = 0, .lexical_environment = null,
            .physical_parameters = &.{receiver}, .result = object, .result_carrier = object_carrier, .source_plan = .{ .carriers = &.{}, .blocks = &.{} } } };
        common.abis = &self.abis;
        self.types = .{ common.types[0], .{ .id = owner_id, .kind = .reference, .name = "Box", .native_code = 0,
            .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null } };
        common.types = &self.types;
        self.bindings = .{ common.storage.bindings[0], common.storage.bindings[1],
            .{ .id = "box-this", .owner = .{ .receiver = ctor }, .name = "this", .@"type" = object, .writable = false, .origin = ctor_source, .carrier = object_carrier, .scope = @enumFromInt(1), .declaration_kind = null },
            .{ .id = "box-value", .owner = .{ .field = @enumFromInt(0) }, .name = "value", .@"type" = type_id, .writable = true, .origin = ctor_source, .carrier = native, .scope = null, .declaration_kind = null },
        };
        common.storage.bindings = &self.bindings;
        common.storage.concrete = comptime &.{
            .{ .@"type" = type_id, .carrier = .{ .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
            .{ .@"type" = object, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} },
                .body = .{ .byte_size = 4, .alignment = 4, .reference_count = 0, .fields = &.{.{ .field = @enumFromInt(0), .binding = @enumFromInt(3), .offset = 0, .reference_offset = 0 }} } },
        };
        common.members.fields = comptime &.{.{ .id = @splat(0xfe), .owner = object, .ordinal = 0, .name = "value", .@"type" = type_id, .declared_type = type_id,
            .readonly = false, .optional = false, .access = .public, .origin = ctor_source, .binding = @enumFromInt(3) }};
        common.members.constructions = comptime &.{.{ .id = constructor_id, .owner = object, .function = ctor, .kind = .explicit, .origin = ctor_source, .parameters = &.{},
            .signature = .{ .parameters = &.{}, .return_type = object }, .source_signature = .{ .id = ctor_signature, .origin = ctor_source },
            .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{@enumFromInt(0)}, .access = .public }};
        common.exceptions.scopes = comptime &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = ctor, .path = &.{"function"} } };
        common.exceptions.bindings = comptime &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(1) } };
        common.exceptions.functions = comptime &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = ctor, .handlers = &.{} } };
        const declarations: []const construction.ScopeFunction = comptime &.{
            .{ .function_id = hash(function), .signature_hash = hash(signature), .kind = .source, .decl_key = .{ .kind = .function, .name = "mark", .path = &.{}, .source_path = "/src/main.ts" },
                .parameter_types = &.{hash(scalar)}, .return_type = hash(scalar), .construction = null, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
            .{ .function_id = ctor_id, .signature_hash = ctor_signature, .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "Box", .path = &.{}, .source_path = "/src/main.ts" },
                .parameter_types = &.{owner_id}, .return_type = owner_id, .construction = .{ .id = constructor_id, .owner = owner_id, .base = null, .receiver_index = 0 },
                .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
        };
        var authority = std.mem.zeroes(publication.FixedPublication);
        authority.stable_scope.functions = declarations;
        authority.publication.scope.functions = declarations;
        authority.publication.scope.types = comptime &.{
            .{ .id = hash(scalar), .label = "i32", .shape = .{ .primitive = .{ .kind = .scalar, .label = "i32" } } },
            .{ .id = owner_id, .label = "Box", .shape = .{ .nominal = .{ .kind = .reference, .label = "Box", .base = null,
                .construction = .{ .access = .public, .parameters = &.{}, .return_type = "Box", .argument_signature = null }, .fields = &.{}, .methods = null } } },
        };
        authority.publication.scope.globals = comptime &.{.{ .global_id = hash(global), .decl_key = .{ .kind = .global, .name = "total", .path = &.{}, .source_path = "/src/main.ts" }, .@"type" = hash(scalar), .writable = true }};
        authority.publication.scope.constructions = comptime &.{.{ .id = constructor_id, .owner = owner_id, .base = null, .kind = .explicit, .function_id = ctor_id }};
        self.contracts = .{
            .{ .function_id = hash(function), .signature_hash = hash(signature), .upper = no_access, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = scalar_graph, .digest = @splat(1) },
            .{ .function_id = ctor_id, .signature_hash = ctor_signature, .upper = no_access, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = null, .digest = @splat(2) },
        };
        self.contracts[0].upper.parameters = comptime &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
        self.contracts[0].upper.globals = comptime .{ .reads = &.{hash(global)}, .writes = &.{hash(global)} };
        authority.publication.contracts = &self.contracts;
        common.authority.fixed_publication = authority;
    }
};

test "receiver effects carry the original scalar argument through checked fixed mark" {
    var fixture: ReceiverFixture = undefined;
    fixture.init();
    var c = context.Context{ .program = &fixture.mark.program, .allocator = std.testing.allocator };
    try layout.check(&c);
    try ssa.check(&c);
    var result = try body.coverReceiverEffects(&c, ctor);
    defer result.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), result.body.pending);
    try std.testing.expectEqual(@as(?construction.Pending, null), result.analysis.?.pending);
    const proof = result.proof.?;
    const graph = &proof.flow.graph;
    try std.testing.expectEqual(@as(usize, 1), graph.calls.len);
    try std.testing.expect(graph.calls[0].receiver == null and graph.calls[0].environment == null);
    try std.testing.expectEqualStrings(function, graph.calls[0].function_id);
    try std.testing.expect(result.analysis.?.normal_live and !result.analysis.?.language_live);
    var continuations: usize = 0;
    for (graph.controls, proof.flow.controls) |control, live| {
        if (control != .call) continue;
        try std.testing.expectEqual(@as(model.Ref, 0), control.call.call);
        try std.testing.expectEqual(control.call.completion == .normal, live);
        continuations += 1;
    }
    try std.testing.expectEqual(@as(usize, 2), continuations);
    try std.testing.expectEqual(@as(usize, 1), proof.initializations.len);
    const write = proof.initializations[0];
    try std.testing.expect(write.base.source == .allocation and write.base.category == .object);
    try std.testing.expect(graph.nodes[write.base.source.allocation] == .receiver_input);
    try std.testing.expect(write.value.source == .node and write.value.category == .other);
    try std.testing.expect(graph.nodes[write.value.source.node] == .literal);

    // A call proof from another graph or callee must not activate this call.
    var arena = std.heap.ArenaAllocator.init(c.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const fixed_publication = c.program.tables.mode.common.authority.fixed_publication;
    const native_directory = try refs.returnOriginDirectory(&c, allocator, fixed_publication);
    const constructor_symbol = try refs.symbol(&c, allocator, ctor_id);
    const input = try refs.returnOriginConstructorInput(&c, allocator, fixed_publication, constructor_symbol);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    const original = &result.body.graph.?;
    const copied = original.*;
    var wrong_graph = try construction.analyzeEffectsWithCalls(c.allocator, &native_directory, &copied, &budget, input,
        .{ .caller = original, .callees = &.{function} });
    defer wrong_graph.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, .fixed_call), wrong_graph.pending);
    var wrong_callee = try construction.analyzeEffectsWithCalls(c.allocator, &native_directory, original, &budget, input,
        .{ .caller = original, .callees = &.{constructor_symbol} });
    defer wrong_callee.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, .fixed_call), wrong_callee.pending);
}

test "receiver scalar calls require verified permissions and active scalar graph gates" {
    const extra: [scalar_graph.nodes.len + 1]model.Value = scalar_graph.nodes[0..scalar_graph.nodes.len].* ++
        [_]model.Value{.{ .gate = .{ .@"type" = scalar, .inputs = &.{0}, .control = 1 } }};
    const unused_control = [_]model.Control{ .entry, .{ .join = .{ .inputs = &.{} } } };
    for (0..4) |variant| {
        var fixture: ReceiverFixture = undefined;
        fixture.init();
        switch (variant) {
            0 => fixture.contracts[0].return_origins = fixed,
            1 => fixture.contracts[0].upper.globals.reads = &.{},
            2 => fixture.contracts[0].upper.facets.may_throw = true,
            3 => {
                fixture.contracts[0].return_origins.?.nodes = &extra;
                fixture.contracts[0].return_origins.?.controls = &unused_control;
            },
            else => unreachable,
        }
        var c = context.Context{ .program = &fixture.mark.program, .allocator = std.testing.allocator };
        try layout.check(&c);
        try ssa.check(&c);
        var result = try body.coverReceiverEffects(&c, ctor);
        defer result.deinit();
        try std.testing.expectEqual(@as(?body.Pending, null), result.body.pending);
        try std.testing.expectEqual(@as(?construction.Pending, .fixed_call), result.analysis.?.pending);
        try std.testing.expect(result.proof == null);
    }
}

test "formal constructor certificate rechecks the original scalar call on both graphs" {
    var fixture: ReceiverFixture = undefined;
    fixture.init();
    var c = context.Context{ .program = &fixture.mark.program, .allocator = std.testing.allocator };
    try layout.check(&c);
    try ssa.check(&c);
    var arena = std.heap.ArenaAllocator.init(c.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    const fixed_publication = c.program.tables.mode.common.authority.fixed_publication;
    const archive = try refs.returnOriginDirectory(&c, allocator, fixed_publication);
    const constructor_symbol = try refs.symbol(&c, allocator, ctor_id);
    var budget = model.Budget{ .context = &c, .charge = refs.graphCharge };
    var projected = try body.project(&c, ctor, &archive, &budget);
    defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending);
    const current = &projected.graph.?;
    const fixed_calls = try allocator.dupe(model.Call, current.calls);
    try std.testing.expectEqual(@as(usize, 1), fixed_calls.len);
    // Fresh immutable occurrence spelling forces the whole receiver
    // comparator, including the actual call and both completion arms.
    fixed_calls[0].site = "fixed-constructor-mark";
    fixture.contracts[1].return_origins = current.*;
    fixture.contracts[1].return_origins.?.calls = fixed_calls;
    const upper = &fixture.contracts[1].return_origins.?;
    const input = try refs.returnOriginConstructorInput(&c, allocator, fixed_publication, constructor_symbol);
    const bounds = [_]inclusion.FixedContract{
        .{ .function_id = function, .graph = &fixture.contracts[0].return_origins.?, .complete = &input.fixed[0] },
        .{ .function_id = constructor_symbol, .graph = upper, .complete = &input.fixed[1] },
    };
    const original = try inclusion.covered(c.allocator, &archive, constructor_symbol, current, &bounds, &budget);
    try std.testing.expect(original == .pending and original.pending == .receiver_no_exact_certificate);
    const evidence = (try body.scalarReturnCalls(&c, allocator, &archive, &projected, upper, &input, &bounds, &budget)).?;
    const covered = try inclusion.coveredWithScalarCalls(c.allocator, &archive, constructor_symbol, current, &bounds, &budget, evidence);
    try std.testing.expectEqual(std.meta.Tag(inclusion.Inclusion).covered, std.meta.activeTag(covered));
    var upper_result = try construction.analyzeReturnsWithCalls(c.allocator, &archive, upper, &budget, input, evidence);
    defer upper_result.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), upper_result.pending);
    try std.testing.expect(upper_result.normal_live and !upper_result.language_live);
    try std.testing.expectEqual(@as(usize, 1), upper_result.initializations.len);
    const write = upper_result.initializations[0];
    try std.testing.expect(write.value.source == .node and write.value.category == .other);
    try std.testing.expect(upper.nodes[write.value.source.node] == .literal);

    const copied = current.*;
    const wrong = try inclusion.coveredWithScalarCalls(c.allocator, &archive, constructor_symbol, &copied, &bounds, &budget, evidence);
    try std.testing.expect(wrong == .pending and wrong.pending == .receiver_no_exact_certificate);
    var mismatched = evidence;
    mismatched.callees = &.{constructor_symbol};
    var wrong_target = try construction.analyzeReturnsWithCalls(c.allocator, &archive, upper, &budget, input, mismatched);
    defer wrong_target.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, .fixed_call), wrong_target.pending);

    var effects = try body.coverReceiverEffects(&c, ctor);
    defer effects.deinit();
    try std.testing.expect(effects.proof != null);
    try std.testing.expect((try body.scalarReturnCalls(&c, allocator, &archive, &effects.body, upper, &input, &bounds, &budget)) == null);
}
