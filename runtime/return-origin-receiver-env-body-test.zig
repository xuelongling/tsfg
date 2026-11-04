// SPDX-License-Identifier: MIT
// Handwritten passive typed DTO: no Source packet, parser, identity receipt,
// loader, runtime State, bytecode or VM. Zero envelope fields are placeholders.
// Only the explicit Layout/SSA/SourcePlan/Directory premises are exercised.
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
const construction = @import("wire-program-return-origin-construction.zig");
const certificates = @import("wire-program-return-origins.zig");
const t = wire.types;
const ins = wire.instruction;
const reference: t.TypeRef = @enumFromInt(0);
const callable: t.TypeRef = @enumFromInt(1);
const reference_text = "sha256:" ++ "11" ** 32;
const callable_text = "sha256:" ++ "33" ** 32;
const ctor_text = "sha256:" ++ "55" ** 32;
const child_text = "sha256:" ++ "66" ** 32;
const outer_text = "sha256:" ++ "99" ** 32;
const outer_env = "sha256:" ++ "77" ** 32;
const inner_env = "sha256:" ++ "88" ** 32;
const slot_key = "sha256:" ++ "cc" ** 32;
const role_text = "sha256:" ++ "ee" ** 32;
const signature_text = "sha256:" ++ "dd" ** 32;
const payload_text = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
const rc: t.Carrier = .{ .@"type" = reference };
const fc: t.Carrier = .{ .@"type" = callable };
const e0: t.Carrier = .{ .environment = @enumFromInt(0) };
const e1: t.Carrier = .{ .environment = @enumFromInt(1) };
const frame: t.Carrier = .{ .receiver = @enumFromInt(0) };
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
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 100 };
const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const inner_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = inner_env } }};
const outer_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = outer_env } }};
const slot_properties = [_]t.JsonMember{
    .{ .key = "layout", .value = .{ .string = inner_env } },
    .{ .key = "key", .value = .{ .string = slot_key } },
    .{ .key = "binding", .value = .{ .string = "ctor-value" } },
};
const closure_properties = [_]t.JsonMember{
    .{ .key = "function_id", .value = .{ .string = child_text } },
    .{ .key = "signature_hash", .value = .{ .string = signature_text } },
    .{ .key = "environment_layout", .value = .{ .string = inner_env } },
};
const copy_properties = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = callable_text } }};
const receiver_properties = [_]t.JsonMember{
    .{ .key = "owner", .value = .{ .string = reference_text } },
    .{ .key = "construction", .value = .{ .string = role_text } },
};

const directory: origin.Directory = .{
    .types = &.{ .{ .id = reference_text, .kind = .reference }, .{ .id = callable_text, .kind = .function } },
    .functions = &.{
        .{ .id = ctor_text, .kind = .construction_body, .parameter_types = &.{ reference_text, reference_text }, .return_type = reference_text,
            .environment_metadata_complete = true, .lexical_environment = outer_env, .activation_environment = inner_env,
            .construction = .{ .id = role_text, .owner = reference_text, .base = null, .receiver_index = 0 } },
        .{ .id = child_text, .kind = .source, .parameter_types = &.{}, .return_type = reference_text,
            .environment_metadata_complete = true, .lexical_environment = inner_env, .activation_environment = null, .construction = null },
        .{ .id = outer_text, .kind = .source, .parameter_types = &.{reference_text}, .return_type = reference_text,
            .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = outer_env, .construction = null },
    },
    .environments = &.{
        .{ .id = outer_env, .parent = null, .slots = &.{} },
        .{ .id = inner_env, .parent = outer_env, .slots = &.{.{ .key = slot_key, .@"type" = reference_text, .writable = true }} },
    },
    .constructions = &.{.{ .id = role_text, .owner = reference_text, .base = null, .kind = .explicit, .function_id = ctor_text }},
    .globals = &.{}, .fields = &.{},
};

const Fixture = struct {
    program: wire.Program,
    sources: [1]tables.Source,
    types: [2]tables.CommonType,
    bindings: [3]storage.CommonBinding,
    abis: [3]storage.CommonAbi,
    functions: [3]wire.Function,
    instructions: [11]ins.Instruction,
    operations: [11]control.SourcePlanOperation,
    blocks: [3]wire.Block,
    plan: [3]control.SourcePlanBlock,

    fn init(self: *Fixture) void {
        self.sources = .{.{ .hash = @splat(0x44), .path = "receiver-env-literal-dto.ts", .length = 100 }};
        const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "Reference", .native_code = 0,
            .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null };
        self.types = .{ base, base }; self.types[1].id = @splat(0x33); self.types[1].kind = .function;
        self.types[1].name = "Callable"; self.types[1].element = reference;
        self.bindings = .{
            .{ .id = "ctor-receiver", .owner = .{ .receiver = @enumFromInt(0) }, .name = "this", .@"type" = reference, .writable = false, .origin = declaration, .carrier = rc, .scope = @enumFromInt(0), .declaration_kind = null },
            .{ .id = "ctor-value", .owner = .{ .param = @enumFromInt(0) }, .name = "value", .@"type" = reference, .writable = true, .origin = declaration, .carrier = rc, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "outer-value", .owner = .{ .param = @enumFromInt(2) }, .name = "outer", .@"type" = reference, .writable = false, .origin = declaration, .carrier = rc, .scope = @enumFromInt(2), .declaration_kind = .parameter },
        };
        self.instructions = .{
            .{ .source = declaration, .result = r3, .operands = &.{r0}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(1), .anchor_kind = .function_entry } } },
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = declaration, .result = null, .operands = &.{ r3, r2 }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .parameter } } },
            .{ .source = operation, .result = r4, .operands = &.{r3}, .data = .environment_parent },
            .{ .source = operation, .result = r5, .operands = &.{r3}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = null, .operands = &.{ r3, r5 }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = r6, .operands = &.{r3}, .data = .{ .function_make = .{ .function = @enumFromInt(1) } } },
            .{ .source = operation, .result = r7, .operands = &.{r6}, .data = .{ .domain_copy = .{ .static_view = callable } } },
            .{ .source = operation, .result = null, .operands = &.{ r1, r7 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
            .{ .source = operation, .result = null, .operands = &.{r8}, .data = .@"return" },
            .{ .source = operation, .result = null, .operands = &.{r9}, .data = .eh_raise },
        };
        self.operations = .{
            .{ .name = "env_alloc", .view = "env:" ++ inner_env, .properties = &inner_properties, .result = r3, .operands = &.{r0}, .successors = &.{}, .source = declaration },
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "env_init", .view = "void", .properties = &slot_properties, .result = null, .operands = &.{ r3, r2 }, .successors = &.{}, .source = declaration },
            .{ .name = "env_parent", .view = "env:" ++ outer_env, .properties = &outer_properties, .result = r4, .operands = &.{r3}, .successors = &.{}, .source = operation },
            .{ .name = "env_load", .view = reference_text, .properties = &slot_properties, .result = r5, .operands = &.{r3}, .successors = &.{}, .source = operation },
            .{ .name = "env_store", .view = "void", .properties = &slot_properties, .result = null, .operands = &.{ r3, r5 }, .successors = &.{}, .source = operation },
            .{ .name = "make_closure", .view = callable_text, .properties = &closure_properties, .result = r6, .operands = &.{r3}, .successors = &.{}, .source = operation },
            .{ .name = "value_copy", .view = callable_text, .properties = &copy_properties, .result = r7, .operands = &.{r6}, .successors = &.{}, .source = operation },
            .{ .name = "receiver_result", .view = "void", .properties = &receiver_properties, .result = null, .operands = &.{ r1, r7 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
            .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r9}, .successors = &.{}, .source = operation },
        };
        self.blocks = .{ .{ .parameters = &.{ r0, r1, r2 }, .instructions = self.instructions[0..9] }, .{ .parameters = &.{r8}, .instructions = self.instructions[9..10] }, .{ .parameters = &.{r9}, .instructions = self.instructions[10..11] } };
        self.plan = .{ .{ .parameters = &.{ r0, r1, r2 }, .operations = self.operations[0..9] }, .{ .parameters = &.{r8}, .operations = self.operations[9..10] }, .{ .parameters = &.{r9}, .operations = self.operations[10..11] } };
        const prototype: storage.CommonAbi = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0xdd), .parameters = &.{@enumFromInt(1)}, .argument_types = &.{reference},
            .receiver = @enumFromInt(0), .construction = @enumFromInt(0), .receiver_frame = 1, .lexical_environment = @enumFromInt(0),
            .physical_parameters = &.{ e0, frame, rc }, .result = reference, .result_carrier = rc,
            .source_plan = .{ .carriers = &.{ "env:" ++ outer_env, "receiver:" ++ reference_text, reference_text, "env:" ++ inner_env, "env:" ++ outer_env, reference_text, callable_text, callable_text, reference_text, payload_text }, .blocks = &self.plan } };
        self.abis = .{ prototype, prototype, prototype };
        const function: wire.Function = .{ .id = @splat(0x55), .signature = @splat(0xdd), .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .construction_body,
            .declaration = .{ .start = 0, .end = 100 }, .name = "receiverEnvDto", .registers = &.{
                .{ .carrier = e0, .view = null }, .{ .carrier = frame, .view = null }, .{ .carrier = rc, .view = reference },
                .{ .carrier = e1, .view = null }, .{ .carrier = e0, .view = null }, .{ .carrier = rc, .view = reference },
                .{ .carrier = fc, .view = callable }, .{ .carrier = fc, .view = callable }, .{ .carrier = rc, .view = reference }, .{ .carrier = .payload, .view = null },
            }, .blocks = &self.blocks };
        self.functions = .{ function, function, function };
        self.functions[1].id = @splat(0x66); self.functions[1].abi = @enumFromInt(1); self.functions[1].role = .ordinary;
        self.functions[1].registers = &.{ .{ .carrier = e1, .view = null }, .{ .carrier = rc, .view = reference } };
        self.functions[1].blocks = &.{.{ .parameters = &.{r0}, .instructions = &.{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
        } }};
        self.abis[1].function = @enumFromInt(1); self.abis[1].parameters = &.{}; self.abis[1].argument_types = &.{};
        self.abis[1].receiver = null; self.abis[1].construction = null; self.abis[1].receiver_frame = null;
        self.abis[1].lexical_environment = @enumFromInt(1); self.abis[1].physical_parameters = &.{e1};
        self.abis[1].source_plan = .{ .carriers = &.{ "env:" ++ inner_env, reference_text }, .blocks = &.{.{ .parameters = &.{r0}, .operations = &.{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "env_load", .view = reference_text, .properties = &slot_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
        } }} };
        self.functions[2].id = @splat(0x99); self.functions[2].abi = @enumFromInt(2); self.functions[2].role = .ordinary;
        self.functions[2].registers = &.{.{ .carrier = rc, .view = reference }};
        self.functions[2].blocks = &.{.{ .parameters = &.{r0}, .instructions = &.{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = null, .operands = &.{r0}, .data = .@"return" },
        } }};
        self.abis[2] = self.abis[1]; self.abis[2].function = @enumFromInt(2); self.abis[2].parameters = &.{@enumFromInt(2)};
        self.abis[2].argument_types = &.{reference}; self.abis[2].lexical_environment = null; self.abis[2].physical_parameters = &.{rc};
        self.abis[2].source_plan = .{ .carriers = &.{reference_text}, .blocks = &.{.{ .parameters = &.{r0}, .operations = &.{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r0}, .successors = &.{}, .source = operation },
        } }} };
        var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis; common.storage.bindings = &self.bindings;
        common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.storage.concrete = &.{
            .{ .@"type" = reference, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            .{ .@"type" = callable, .carrier = .{ .layout = .{ .byte_size = 40, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = null },
        };
        common.members.constructions = &.{.{ .id = @splat(0xee), .owner = reference, .function = @enumFromInt(0), .kind = .explicit, .origin = declaration,
            .parameters = &.{.{ .binding = @enumFromInt(1), .inherited_from = null, .origin = declaration, .@"type" = reference }},
            .signature = .{ .parameters = &.{reference}, .return_type = reference }, .source_signature = .{ .id = @splat(0xdd), .origin = declaration },
            .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public }};
        common.closures.functions = &.{
            .{ .function = @enumFromInt(0), .parent = @enumFromInt(2), .lexical_environment = @enumFromInt(0), .activation_environment = @enumFromInt(1), .captures = &.{} },
            .{ .function = @enumFromInt(1), .parent = @enumFromInt(0), .lexical_environment = @enumFromInt(1), .activation_environment = null, .captures = &.{.{ .environment = @enumFromInt(1), .slot = @enumFromInt(0) }} },
            .{ .function = @enumFromInt(2), .parent = null, .lexical_environment = null, .activation_environment = @enumFromInt(0), .captures = &.{} },
        };
        common.closures.environments = &.{
            .{ .id = @splat(0x77), .owner = @enumFromInt(2), .parent = null, .slots = &.{} },
            .{ .id = @splat(0x88), .owner = @enumFromInt(0), .parent = @enumFromInt(0), .slots = &.{.{ .binding = @enumFromInt(1), .key = @splat(0xcc), .kind = .parameter, .@"type" = reference, .writable = true }} },
        };
        common.storage.environments = &.{
            .{ .environment = @enumFromInt(0), .byte_size = 0, .alignment = 1, .reference_count = 0, .parent_offset = null, .slot_offsets = &.{} },
            .{ .environment = @enumFromInt(1), .byte_size = 16, .alignment = 8, .reference_count = 2, .parent_offset = 0, .slot_offsets = &.{8} },
        };
        common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = @enumFromInt(1), .path = &.{"function"} }, .{ .owner = @enumFromInt(2), .path = &.{"function"} } };
        common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(2) } };
        common.exceptions.functions = &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = @enumFromInt(1), .handlers = &.{} }, .{ .function = @enumFromInt(2), .handlers = &.{} } };
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};

fn typedInput(c: *context.Context, budget: *origin.Budget) !void {
    for (c.program.functions) |f| {
        try c.anchor(f.declaration, f.source);
        for (f.registers) |reg| { try c.carrier(reg.carrier); try c.maybeRef(reg.view, c.counts().types); }
        for (f.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
    }
    try layout.check(c); try ssa.check(c); try correspondence.check(c);
    try origin.validateDirectory(c.allocator, &directory, budget);
}

// The oracle removes only transparent one-input SSA forwarding wrappers.
// All expected heap, Code, ENV, parameter and receiver relations are literal.
fn rootValue(graph: *const origin.Graph, value: origin.Ref) !origin.Ref {
    var current = value;
    for (0..graph.nodes.len) |_| switch (graph.nodes[current]) {
        .join => |v| { try std.testing.expectEqual(@as(usize, 1), v.inputs.len); current = v.inputs[0]; },
        .gate => |v| { try std.testing.expectEqual(@as(usize, 1), v.inputs.len); current = v.inputs[0]; },
        else => return current,
    };
    return error.TestUnexpectedCycle;
}

// Independently numbered immutable graph. It is never built from a projection.
const upper: origin.Graph = .{
    .nodes = &.{
        .{ .environment_input = .{ .layout = outer_env } }, .receiver_input,
        .{ .parameter = .{ .@"type" = reference_text, .index = 1 } },
        .{ .environment_create = .{ .layout = inner_env, .parent = &.{0}, .site = "upper:environment", .control = 0 } },
        .{ .environment_parent = .{ .layout = outer_env, .bases = &.{3}, .control = 0 } },
        .{ .capture = .{ .@"type" = reference_text, .id = slot_key, .layout = inner_env, .environment = &.{3}, .heap = 1, .control = 0 } },
        .{ .code = .{ .@"type" = callable_text, .function_id = child_text, .environment = &.{3}, .control = 0 } },
        .{ .copy = .{ .@"type" = callable_text, .bases = &.{6}, .site = "upper:copy", .heap = 2, .control = 0 } },
        .{ .receiver_value = .{ .@"type" = reference_text, .action = 4 } },
        .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
    },
    .heaps = &.{
        .entry,
        .{ .store = .{ .previous = 0, .bases = &.{3}, .selector = "capture:" ++ slot_key, .view = "env:" ++ inner_env, .values = &.{2}, .control = 0, .initialize = true } },
        .{ .store = .{ .previous = 1, .bases = &.{3}, .selector = "capture:" ++ slot_key, .view = "env:" ++ inner_env, .values = &.{5}, .control = 0, .initialize = false } },
        .{ .copy = .{ .previous = 2, .value = 7 } },
        .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{7}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{7}, .completion = .language } },
    },
    .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } } },
    .calls = &.{}, .normal = &.{8}, .language = &.{9},
    .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 5, .control = 2 }} }, .accesses = &.{},
};

fn contracts(graph: *const origin.Graph) [3]certificates.FixedContract {
    return .{ .{ .function_id = ctor_text, .graph = graph }, .{ .function_id = child_text, .graph = null }, .{ .function_id = outer_text, .graph = null } };
}

test "receiver hidden ENV preserves logical input and complete closure heap through both completion edges" {
    var fixture: Fixture = undefined; fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    for ([_]*const origin.Graph{ graph, &upper }) |checked| {
        const validation = try origin.validateGraph(c.allocator, &directory, ctor_text, checked, &budget);
        try std.testing.expect(validation == .pending); try std.testing.expectEqual(origin.Pending.construction_frame, validation.pending);
    }
    const fixed = contracts(&upper); try std.testing.expect((try certificates.covered(c.allocator, &directory, ctor_text, graph, &fixed, &budget)) == .covered);
    const reverse = contracts(graph); try std.testing.expect((try certificates.covered(c.allocator, &directory, ctor_text, &upper, &reverse, &budget)) == .covered);
    const normal_result = graph.nodes[try rootValue(graph, graph.normal[0])].receiver_value;
    const normal_action = graph.heaps[normal_result.action].receiver_action;
    try std.testing.expectEqual(origin.Completion.normal, normal_action.completion);
    const incoming_frame = graph.nodes[try rootValue(graph, normal_action.frames[0])]; try std.testing.expect(incoming_frame == .receiver_input);
    const copied_id = try rootValue(graph, normal_action.operands[0]); const copied = graph.nodes[copied_id].copy;
    const copy_heap = graph.heaps[normal_action.previous].copy; try std.testing.expectEqual(copied_id, copy_heap.value); try std.testing.expectEqual(copied.heap, copy_heap.previous);
    const code_id = try rootValue(graph, copied.bases[0]); const closure = graph.nodes[code_id].code;
    try std.testing.expectEqualStrings(child_text, closure.function_id);
    try std.testing.expectEqual(closure.control, copied.control); try std.testing.expectEqual(copied.control, normal_action.control);
    const child_env = graph.nodes[try rootValue(graph, closure.environment.?[0])].environment_create; try std.testing.expectEqualStrings(inner_env, child_env.layout);
    const parent_env = graph.nodes[try rootValue(graph, child_env.parent.?[0])].environment_input; try std.testing.expectEqualStrings(outer_env, parent_env.layout);
    const replace = graph.heaps[copied.heap].store; try std.testing.expect(!replace.initialize);
    const load = graph.nodes[try rootValue(graph, replace.values[0])].capture; try std.testing.expectEqualStrings(slot_key, load.id); try std.testing.expectEqual(replace.previous, load.heap);
    const initialize = graph.heaps[replace.previous].store; try std.testing.expect(initialize.initialize); try std.testing.expectEqualStrings("capture:" ++ slot_key, initialize.selector);
    const incoming = graph.nodes[try rootValue(graph, initialize.values[0])].parameter; try std.testing.expectEqual(@as(usize, 1), incoming.index);
    var analysis = try construction.analyzeReturns(c.allocator, &directory, graph, &budget, ctor_text); defer analysis.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), analysis.pending); try std.testing.expect(analysis.normal_live and !analysis.language_live);
    try std.testing.expectEqual(@as(usize, 1), analysis.normal.len); try std.testing.expect(analysis.normal[0].source == .node);
    // A function copy retains the original Code+ENV identity. The explicit
    // Heap.copy relation above remains mandatory; it does not mint new Code.
    try std.testing.expectEqual(code_id, analysis.normal[0].source.node); try std.testing.expectEqual(construction.Category.object, analysis.normal[0].category);
    try std.testing.expectEqual(@as(usize, 0), analysis.language.len);
    const language_result = graph.nodes[try rootValue(graph, graph.language[0])].receiver_value;
    const language_action = graph.heaps[language_result.action].receiver_action;
    try std.testing.expectEqual(origin.Completion.language, language_action.completion);
    try std.testing.expectEqual(normal_action.previous, language_action.previous); try std.testing.expectEqual(normal_action.control, language_action.control);
    try std.testing.expectEqual(try rootValue(graph, normal_action.frames[0]), try rootValue(graph, language_action.frames[0]));
    try std.testing.expectEqual(copied_id, try rootValue(graph, language_action.operands[0]));
    try std.testing.expect(analysis.heap_live[normal_result.action] and !analysis.heap_live[language_result.action]);
    try std.testing.expect(analysis.controls[graph.exits.normal[0].control] and !analysis.controls[graph.exits.language[0].control]);
    try std.testing.expectEqual(@as(usize, 0), analysis.action_results[language_result.action].len);
    try std.testing.expectEqual(@as(usize, 0), graph.calls.len);
    try std.testing.expectEqual(@as(usize, 0), graph.accesses.len);
}

test "receiver ENV certificate retains initialization bit copy heap and Code ENV shape" {
    var fixture: Fixture = undefined; fixture.init(); var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit(); try std.testing.expect(projected.pending == null);
    var heaps: [6]origin.Heap = upper.heaps[0..6].*; var changed = upper; changed.heaps = &heaps;
    heaps[1].store.initialize = false;
    var fixed = contracts(&changed); var result = try certificates.covered(c.allocator, &directory, ctor_text, &projected.graph.?, &fixed, &budget); try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
    heaps = upper.heaps[0..6].*; heaps[3] = .{ .join = .{ .inputs = &.{2} } };
    fixed = contracts(&changed); result = try certificates.covered(c.allocator, &directory, ctor_text, &projected.graph.?, &fixed, &budget); try std.testing.expect(result == .pending);
    try std.testing.expectEqual(certificates.Pending.receiver_no_exact_certificate, result.pending);
    heaps = upper.heaps[0..6].*;
    var nodes: [10]origin.Value = upper.nodes[0..10].*; changed.nodes = &nodes;
    // An inner ENV cannot replace its outer parent, and a Code requiring the
    // inner layout cannot capture the outer layout. These are typed carrier
    // failures at the model boundary, before structural inclusion is queried.
    nodes[3].environment_create.parent = &.{3};
    try std.testing.expectError(error.InvalidGraph, origin.validateGraph(c.allocator, &directory, ctor_text, &changed, &budget));
    nodes = upper.nodes[0..10].*; nodes[6].code.environment = &.{0};
    try std.testing.expectError(error.InvalidGraph, origin.validateGraph(c.allocator, &directory, ctor_text, &changed, &budget));
    nodes = upper.nodes[0..10].*;
    // This malformed Code+ENV pair is rejected at the original owning model,
    // before any structural certificate or owner result can consume it.
    nodes[6].code.environment = null;
    try std.testing.expectError(error.InvalidGraph, origin.validateGraph(c.allocator, &directory, ctor_text, &changed, &budget));
}

test "receiver control projection retains typed ENV stores without claiming copy heap proof" {
    var fixture: Fixture = undefined; fixture.init(); var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget);
    var projected = try body.projectReceiverControls(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    const normal = graph.nodes[try rootValue(graph, graph.normal[0])].receiver_value;
    const action = graph.heaps[normal.action].receiver_action;
    const replace = graph.heaps[action.previous].store; try std.testing.expect(!replace.initialize);
    const initialize = graph.heaps[replace.previous].store; try std.testing.expect(initialize.initialize);
    try std.testing.expectEqualStrings("env:" ++ inner_env, replace.view); try std.testing.expectEqualStrings("capture:" ++ slot_key, initialize.selector);
    const copied = graph.nodes[try rootValue(graph, action.operands[0])].copy;
    const code = graph.nodes[try rootValue(graph, copied.bases[0])].code;
    const child = graph.nodes[try rootValue(graph, code.environment.?[0])].environment_create;
    try std.testing.expectEqualStrings(inner_env, child.layout);
    try std.testing.expectEqualStrings(outer_env, graph.nodes[try rootValue(graph, child.parent.?[0])].environment_input.layout);
    var analysis = try construction.analyzeControls(c.allocator, &directory, graph, &budget, ctor_text); defer analysis.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), analysis.pending);
    try std.testing.expect(analysis.normal_live and !analysis.language_live);
}

test "receiver ENV projection spends the same exhausted Context budget" {
    var fixture: Fixture = undefined; fixture.init(); var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget);
    c.remaining = 1; // Reduce the existing cumulative allowance; never refill it.
    try std.testing.expectError(error.WorkLimit, body.project(&c, @enumFromInt(0), &directory, &budget));
    try std.testing.expectEqual(@as(usize, 0), c.remaining);
}
