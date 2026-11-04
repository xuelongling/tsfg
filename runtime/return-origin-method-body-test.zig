// SPDX-License-Identifier: MIT
// Handwritten literal metadata DTOs. No Source package, identity receipt,
// parser, loader, Runtime State or VM. Only the explicit Layout/SSA/SourcePlan
// and immutable interpretation-directory premises below are claimed.
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
const a_type: t.TypeRef = @enumFromInt(0);
const b_type: t.TypeRef = @enumFromInt(1);
const a_text = "sha256:" ++ "11" ** 32;
const b_text = "sha256:" ++ "22" ** 32;
const caller_text = "sha256:" ++ "44" ** 32;
const method_a_text = "sha256:" ++ "55" ** 32;
const method_b_text = "sha256:" ++ "66" ** 32;
const method_a_id = "sha256:" ++ "aa" ** 32;
const method_b_id = "sha256:" ++ "bb" ** 32;
const domain_text = "sha256:" ++ "cc" ** 32;
const signature_a = "sha256:" ++ "dd" ** 32;
const signature_b = "sha256:" ++ "ee" ** 32;
const environment_text = "sha256:" ++ "77" ** 32;
const payload_text = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
const ac: t.Carrier = .{ .@"type" = a_type };
const bc: t.Carrier = .{ .@"type" = b_type };
const dc: t.Carrier = .{ .domain = @enumFromInt(0) };
const ec: t.Carrier = .{ .environment = @enumFromInt(0) };
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const r3: t.RegisterRef = @enumFromInt(3);
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 80 };
const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const view_properties = [_]t.JsonMember{.{ .key = "target", .value = .{ .string = a_text } }};
const invoke_properties = [_]t.JsonMember{
    .{ .key = "function_id", .value = .{ .string = method_a_text } },
    .{ .key = "signature_hash", .value = .{ .string = signature_a } },
    .{ .key = "dispatch", .value = .{ .array = &.{
        .{ .object = &.{ .{ .key = "receiver_type", .value = .{ .string = a_text } }, .{ .key = "target", .value = .{ .string = method_a_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_a } } } },
        .{ .object = &.{ .{ .key = "receiver_type", .value = .{ .string = b_text } }, .{ .key = "target", .value = .{ .string = method_b_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_b } } } },
    } } },
};

// These entry vectors are module-owned constants. Runtime variant selection
// chooses a persistent slice; no pointer targets an init-stack array.
const method_a_parameters_env = [_]t.RegisterRef{ r2, r0, r1 };
const method_a_parameters_plain = [_]t.RegisterRef{ r0, r1 };
const method_a_physical_env = [_]t.Carrier{ ec, ac, ac };
const method_a_physical_plain = [_]t.Carrier{ ac, ac };
const method_a_semantic_env = [_][]const u8{ a_text, a_text, "env:" ++ environment_text };
const method_a_semantic_plain = [_][]const u8{ a_text, a_text };
const caller_registers = [_]wire.Register{
                .{ .carrier = dc, .view = a_type }, .{ .carrier = ac, .view = a_type }, .{ .carrier = dc, .view = a_type }, .{ .carrier = .payload, .view = null },
            };
const method_b_registers = [_]wire.Register{ .{ .carrier = bc, .view = b_type }, .{ .carrier = bc, .view = a_type } };
const method_b_instructions = [_]ins.Instruction{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .domain_view = .{ .static_view = a_type } } },
            .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
        };
const method_b_blocks = [_]wire.Block{.{ .parameters = &.{r0}, .instructions = &method_b_instructions }};
const method_b_operations = [_]control.SourcePlanOperation{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "view", .view = a_text, .properties = &view_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
        };
const method_b_plan = [_]control.SourcePlanBlock{.{ .parameters = &.{r0}, .operations = &method_b_operations }};

const ClosureFunction = @typeInfo(@FieldType(control.CommonClosures, "functions")).pointer.child;

const Fixture = struct {
    program: wire.Program,
    sources: [1]tables.Source,
    types: [2]tables.CommonType,
    bindings: [5]storage.CommonBinding,
    abis: [3]storage.CommonAbi,
    functions: [3]wire.Function,
    caller_instructions: [4]ins.Instruction,
    caller_operations: [4]control.SourcePlanOperation,
    caller_blocks: [3]wire.Block,
    caller_plan: [3]control.SourcePlanBlock,
    method_a_registers: [3]wire.Register,
    method_a_instructions: [2]ins.Instruction,
    method_a_operations: [2]control.SourcePlanOperation,
    method_a_blocks: [1]wire.Block,
    method_a_plan: [1]control.SourcePlanBlock,
    closure_functions: [3]ClosureFunction,

    fn init(self: *Fixture, hidden_environment: bool) void {
        self.sources = .{.{ .hash = @splat(0x88), .path = "method-body-literal-dto.ts", .length = 80 }};
        const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "A", .native_code = 0,
            .base = null, .element = null, .members = &.{}, .methods = &.{@enumFromInt(0)}, .nominal_key = null, .runtime_key = null };
        self.types = .{ base, base }; self.types[1].id = @splat(0x22); self.types[1].name = "B";
        self.types[1].base = a_type; self.types[1].methods = &.{@enumFromInt(1)};
        self.bindings = .{
            .{ .id = "caller-receiver", .owner = .{ .param = @enumFromInt(0) }, .name = "receiver", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = dc, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "caller-argument", .owner = .{ .param = @enumFromInt(0) }, .name = "argument", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "method-a-receiver", .owner = .{ .receiver = @enumFromInt(1) }, .name = "this", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(1), .declaration_kind = null },
            .{ .id = "method-a-argument", .owner = .{ .param = @enumFromInt(1) }, .name = "argument", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(1), .declaration_kind = .parameter },
            .{ .id = "method-b-receiver", .owner = .{ .receiver = @enumFromInt(2) }, .name = "this", .@"type" = b_type, .writable = false, .origin = declaration, .carrier = bc, .scope = @enumFromInt(2), .declaration_kind = null },
        };
        self.caller_instructions = .{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .common_method_invoke = .{ .receiver_view = a_type, .member = @enumFromInt(0), .dispatch = @enumFromInt(0), .normal = @enumFromInt(1), .exceptional = @enumFromInt(2) } } },
            .{ .source = operation, .result = null, .operands = &.{r2}, .data = .@"return" },
            .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
        };
        self.caller_operations = .{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "invoke_method", .view = "void", .properties = &invoke_properties, .result = null, .operands = &.{ r0, r1 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r2}, .successors = &.{}, .source = operation },
            .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
        };
        self.caller_blocks = .{ .{ .parameters = &.{ r0, r1 }, .instructions = self.caller_instructions[0..2] }, .{ .parameters = &.{r2}, .instructions = self.caller_instructions[2..3] }, .{ .parameters = &.{r3}, .instructions = self.caller_instructions[3..4] } };
        self.caller_plan = .{ .{ .parameters = &.{ r0, r1 }, .operations = self.caller_operations[0..2] }, .{ .parameters = &.{r2}, .operations = self.caller_operations[2..3] }, .{ .parameters = &.{r3}, .operations = self.caller_operations[3..4] } };
        const prototype: storage.CommonAbi = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0xdd),
            .parameters = &.{ @enumFromInt(0), @enumFromInt(1) }, .argument_types = &.{ a_type, a_type }, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = &.{ dc, ac }, .result = a_type, .result_carrier = dc,
            .source_plan = .{ .carriers = &.{ a_text, a_text, a_text, payload_text }, .blocks = &self.caller_plan } };
        self.abis = .{ prototype, prototype, prototype };
        const function: wire.Function = .{ .id = @splat(0x44), .signature = @splat(0xdd), .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .ordinary,
            .declaration = .{ .start = 0, .end = 80 }, .name = "methodCaller", .registers = &caller_registers, .blocks = &self.caller_blocks };
        self.functions = .{ function, function, function };
        self.method_a_registers = .{ .{ .carrier = ac, .view = a_type }, .{ .carrier = ac, .view = a_type }, .{ .carrier = ec, .view = null } };
        self.functions[1].id = @splat(0x55); self.functions[1].abi = @enumFromInt(1); self.functions[1].name = "methodA";
        self.functions[1].registers = self.method_a_registers[0..if (hidden_environment) 3 else 2];
        self.method_a_instructions = .{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
        };
        self.method_a_blocks = .{.{ .parameters = if (hidden_environment) &method_a_parameters_env else &method_a_parameters_plain, .instructions = &self.method_a_instructions }};
        self.functions[1].blocks = &self.method_a_blocks;
        self.abis[1].function = @enumFromInt(1); self.abis[1].parameters = &.{@enumFromInt(3)}; self.abis[1].argument_types = &.{a_type}; self.abis[1].receiver = @enumFromInt(2);
        self.abis[1].lexical_environment = if (hidden_environment) @enumFromInt(0) else null; self.abis[1].physical_parameters = if (hidden_environment) &method_a_physical_env else &method_a_physical_plain;
        self.abis[1].result_carrier = ac;
        self.method_a_operations = .{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
        };
        self.method_a_plan = .{.{ .parameters = if (hidden_environment) &method_a_parameters_env else &method_a_parameters_plain, .operations = &self.method_a_operations }};
        self.abis[1].source_plan = .{ .carriers = if (hidden_environment) &method_a_semantic_env else &method_a_semantic_plain, .blocks = &self.method_a_plan };
        self.functions[2].id = @splat(0x66); self.functions[2].signature = @splat(0xee); self.functions[2].abi = @enumFromInt(2); self.functions[2].name = "methodB";
        self.functions[2].registers = &method_b_registers;
        self.functions[2].blocks = &method_b_blocks;
        self.abis[2].function = @enumFromInt(2); self.abis[2].signature = @splat(0xee); self.abis[2].parameters = &.{}; self.abis[2].argument_types = &.{}; self.abis[2].receiver = @enumFromInt(4);
        self.abis[2].physical_parameters = &.{bc}; self.abis[2].result_carrier = bc;
        self.abis[2].source_plan = .{ .carriers = &.{ b_text, a_text }, .blocks = &method_b_plan };
        if (hidden_environment) {
            // Keep the method's independent ENV entrance legal without
            // pretending the dynamic dispatch transports any hidden ENV.
            self.functions[0].registers = self.functions[0].registers[0..2];
            self.caller_instructions[1] = .{ .source = operation, .result = null, .operands = &.{r0}, .data = .@"return" };
            self.caller_operations[1] = .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r0}, .successors = &.{}, .source = operation };
            self.functions[0].blocks = self.caller_blocks[0..1]; self.abis[0].source_plan.carriers = &.{ a_text, a_text }; self.abis[0].source_plan.blocks = self.caller_plan[0..1];
        }
        var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis; common.storage.bindings = &self.bindings;
        common.domains = &.{.{ .id = @splat(0xcc), .actual_types = &.{ a_type, b_type }, .representation = .reference, .byte_size = 8, .alignment = 8, .reference_count = 1, .tag_bytes = 0 }};
        common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.storage.concrete = &.{
            .{ .@"type" = a_type, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            .{ .@"type" = b_type, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
        };
        common.members.methods = &.{
            .{ .id = @splat(0xaa), .owner = a_type, .function = @enumFromInt(1), .name = "choose", .signature = @splat(0xdd), .override = null, .access = .public },
            .{ .id = @splat(0xbb), .owner = b_type, .function = @enumFromInt(2), .name = "choose", .signature = @splat(0xee), .override = @as(t.Hash, @splat(0xaa)), .access = .public },
        };
        common.views.dispatch = &.{.{ .method = .{ .view = a_type, .member = @enumFromInt(0), .arms = &.{
            .{ .actual = a_type, .target = @enumFromInt(1), .abi = @enumFromInt(1) }, .{ .actual = b_type, .target = @enumFromInt(2), .abi = @enumFromInt(2) },
        } } }};
        common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = @enumFromInt(1), .path = &.{"function"} }, .{ .owner = @enumFromInt(2), .path = &.{"function"} } };
        common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(3), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(4), .scope = @enumFromInt(2) } };
        common.exceptions.functions = &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = @enumFromInt(1), .handlers = &.{} }, .{ .function = @enumFromInt(2), .handlers = &.{} } };
        self.closure_functions = .{
            .{ .function = @enumFromInt(0), .parent = null, .lexical_environment = null, .activation_environment = if (hidden_environment) @enumFromInt(0) else null, .captures = &.{} },
            .{ .function = @enumFromInt(1), .parent = if (hidden_environment) @enumFromInt(0) else null, .lexical_environment = if (hidden_environment) @enumFromInt(0) else null, .activation_environment = null, .captures = &.{} },
            .{ .function = @enumFromInt(2), .parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{} },
        };
        common.closures.functions = &self.closure_functions;
        if (hidden_environment) {
            common.closures.environments = &.{.{ .id = @splat(0x77), .owner = @enumFromInt(0), .parent = null, .slots = &.{} }};
            common.storage.environments = &.{.{ .environment = @enumFromInt(0), .byte_size = 0, .alignment = 1, .reference_count = 0, .parent_offset = null, .slot_offsets = &.{} }};
        }
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};

fn directory(comptime hidden_environment: bool) origin.Directory {
    return .{
        .types = &.{ .{ .id = a_text, .kind = .reference }, .{ .id = b_text, .kind = .reference } },
        .functions = &.{
            .{ .id = caller_text, .kind = .source, .parameter_types = &.{ a_text, a_text }, .return_type = a_text, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = if (hidden_environment) environment_text else null, .construction = null },
            .{ .id = method_a_text, .kind = .method, .parameter_types = &.{ a_text, a_text }, .return_type = a_text, .environment_metadata_complete = true, .lexical_environment = if (hidden_environment) environment_text else null, .activation_environment = null, .construction = null },
            .{ .id = method_b_text, .kind = .method, .parameter_types = &.{b_text}, .return_type = a_text, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
        },
        .environments = if (hidden_environment) &.{.{ .id = environment_text, .parent = null, .slots = &.{} }} else &.{}, .globals = &.{}, .fields = &.{},
        .constructions = &.{ .{ .id = "implicit:A", .owner = a_text, .base = null, .kind = .implicit_base, .function_id = null }, .{ .id = "implicit:B", .owner = b_text, .base = a_text, .kind = .implicit_derived, .function_id = null } },
    };
}

fn typedInput(c: *context.Context, budget: *origin.Budget, interpretation: *const origin.Directory) !void {
    for (c.program.functions) |f| {
        try c.anchor(f.declaration, f.source);
        for (f.registers) |reg| { try c.carrier(reg.carrier); try c.maybeRef(reg.view, c.counts().types); }
        for (f.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
    }
    try layout.check(c); try ssa.check(c); try correspondence.check(c); try origin.validateDirectory(c.allocator, interpretation, budget);
}

fn rootValue(graph: *const origin.Graph, value: origin.Ref) !origin.Ref {
    var current = value;
    for (0..graph.nodes.len) |_| switch (graph.nodes[current]) {
        .join => |row| { try std.testing.expectEqual(@as(usize, 1), row.inputs.len); current = row.inputs[0]; },
        .gate => |row| { try std.testing.expectEqual(@as(usize, 1), row.inputs.len); current = row.inputs[0]; },
        else => return current,
    };
    return error.TestUnexpectedCycle;
}

test "method hidden ENV leaves receiver at logical zero and argument at logical one" {
    var fixture: Fixture = undefined; fixture.init(true); const interpretation = comptime directory(true);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &interpretation);
    var projected = try body.project(&c, @enumFromInt(1), &interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &interpretation, method_a_text, graph, &budget)) == .valid);
    const result = graph.nodes[try rootValue(graph, graph.normal[0])].parameter;
    try std.testing.expectEqual(@as(usize, 1), result.index); try std.testing.expectEqualStrings(a_text, result.@"type");
    var receiver: ?origin.Ref = null; var environment: ?origin.Ref = null;
    for (graph.nodes, 0..) |node, id| switch (node) {
        .parameter => |row| if (row.index == 0) { try std.testing.expect(receiver == null); receiver = id; try std.testing.expectEqualStrings(a_text, row.@"type"); },
        .environment_input => |row| { try std.testing.expect(environment == null); environment = id; try std.testing.expectEqualStrings(environment_text, row.layout); },
        else => {},
    };
    try std.testing.expect(receiver != null and environment != null and receiver.? != environment.?);
    try std.testing.expectEqual(@as(usize, 0), graph.calls.len); try std.testing.expectEqual(@as(usize, 0), graph.language.len);
}

test "method dispatch preserves both target prefixes and normal language continuations" {
    var fixture: Fixture = undefined; fixture.init(false); const interpretation = comptime directory(false);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge }; try typedInput(&c, &budget, &interpretation);
    var projected = try body.project(&c, @enumFromInt(0), &interpretation, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &interpretation, caller_text, graph, &budget)) == .valid);
    // Full literal target identities are the oracle, not an Actual-selected arm.
    try std.testing.expectEqual(@as(usize, 2), graph.calls.len);
    const first = graph.calls[0]; const second = graph.calls[1];
    try std.testing.expectEqualStrings(method_a_text, first.function_id); try std.testing.expectEqualStrings(method_b_text, second.function_id);
    try std.testing.expect(first.receiver == null and second.receiver == null and first.environment == null and second.environment == null and first.callee == null and second.callee == null);
    try std.testing.expectEqual(@as(usize, 2), first.arguments.len); try std.testing.expectEqual(@as(usize, 1), second.arguments.len);
    const receiver = try rootValue(graph, first.arguments[0][0]); const argument = try rootValue(graph, first.arguments[1][0]);
    try std.testing.expectEqual(receiver, try rootValue(graph, second.arguments[0][0])); try std.testing.expect(receiver != argument);
    try std.testing.expectEqual(@as(usize, 0), graph.nodes[receiver].parameter.index); try std.testing.expectEqual(@as(usize, 1), graph.nodes[argument].parameter.index);
    try std.testing.expectEqual(first.heap, second.heap); try std.testing.expectEqual(first.control, second.control); try std.testing.expectEqualStrings(first.site, second.site);
    inline for (.{ origin.Completion.normal, origin.Completion.language }) |completion| {
        const exits = if (completion == .normal) graph.exits.normal else graph.exits.language;
        const results = if (completion == .normal) graph.normal else graph.language;
        try std.testing.expectEqual(@as(usize, 1), exits.len); try std.testing.expectEqual(@as(usize, 1), results.len);
        const incoming_heap = graph.heaps[exits[0].heap].join.inputs; const incoming_control = graph.controls[exits[0].control].join.inputs;
        const incoming_values = graph.nodes[results[0]].join.inputs;
        try std.testing.expectEqual(@as(usize, 2), incoming_heap.len); try std.testing.expectEqual(@as(usize, 2), incoming_control.len); try std.testing.expectEqual(@as(usize, 2), incoming_values.len);
        for (incoming_heap, incoming_control, incoming_values, 0..) |heap, predicate, value, target| {
            const h = graph.heaps[heap].call; const ctl = graph.controls[predicate].call; const data = graph.nodes[value].call;
            try std.testing.expectEqual(target, h.call); try std.testing.expectEqual(target, ctl.call); try std.testing.expectEqual(target, data.call);
            try std.testing.expectEqual(completion, h.completion); try std.testing.expectEqual(completion, ctl.completion); try std.testing.expectEqual(completion, data.completion);
        }
    }
}
