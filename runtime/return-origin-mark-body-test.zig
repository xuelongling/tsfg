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
