// SPDX-License-Identifier: MIT
// Independent literal typed DTOs for the ordinary Body metadata seam. No
// Source/publication/packet, executable bytes or VM state is an input. Opaque
// hashes identify rows inside this fixture only. Layout/SSA/SourcePlan and
// Directory validation below convey neither Source identity nor permissions.
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
const callable: t.TypeRef = @enumFromInt(2);
const reference_text = "sha256:" ++ "11" ** 32;
const boolean_text = "sha256:" ++ "22" ** 32;
const callable_text = "sha256:" ++ "33" ** 32;
const main_text = "sha256:" ++ "55" ** 32;
const child_text = "sha256:" ++ "66" ** 32;
const outer_text = "sha256:" ++ "99" ** 32;
const alternate_text = "sha256:" ++ "aa" ** 32;
const outer_env = "sha256:" ++ "77" ** 32;
const inner_env = "sha256:" ++ "88" ** 32;
const outer_key = "sha256:" ++ "bb" ** 32;
const inner_key = "sha256:" ++ "cc" ** 32;
const signature_text = "sha256:" ++ "dd" ** 32;
const payload_text = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
const rc: t.Carrier = .{ .@"type" = reference };
const bc: t.Carrier = .{ .@"type" = boolean };
const fc: t.Carrier = .{ .@"type" = callable };
const e0: t.Carrier = .{ .environment = @enumFromInt(0) };
const e1: t.Carrier = .{ .environment = @enumFromInt(1) };
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
const r10: t.RegisterRef = @enumFromInt(10);
const r11: t.RegisterRef = @enumFromInt(11);
const r12: t.RegisterRef = @enumFromInt(12);
const r13: t.RegisterRef = @enumFromInt(13);
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 100 };
const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const outer_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = outer_env } }};
const inner_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = inner_env } }};
const outer_slot_properties = [_]t.JsonMember{
    .{ .key = "layout", .value = .{ .string = outer_env } },
    .{ .key = "key", .value = .{ .string = outer_key } },
    .{ .key = "binding", .value = .{ .string = "outer-value" } },
};
const inner_slot_properties = [_]t.JsonMember{
    .{ .key = "layout", .value = .{ .string = inner_env } },
    .{ .key = "key", .value = .{ .string = inner_key } },
    .{ .key = "binding", .value = .{ .string = "main-value" } },
};
const make_child_properties = [_]t.JsonMember{
    .{ .key = "function_id", .value = .{ .string = child_text } },
    .{ .key = "signature_hash", .value = .{ .string = signature_text } },
    .{ .key = "environment_layout", .value = .{ .string = inner_env } },
};
const make_alternate_properties = [_]t.JsonMember{
    .{ .key = "function_id", .value = .{ .string = alternate_text } },
    .{ .key = "signature_hash", .value = .{ .string = signature_text } },
    .{ .key = "environment_layout", .value = .{ .string = outer_env } },
};
const invoke_properties = [_]t.JsonMember{
    .{ .key = "function_id", .value = .{ .string = child_text } },
    .{ .key = "signature_hash", .value = .{ .string = signature_text } },
};
const copy_properties = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = callable_text } }};
const indirect_properties = [_]t.JsonMember{
    .{ .key = "signature_hash", .value = .{ .string = signature_text } },
    .{ .key = "targets", .value = .{ .object = &.{
        .{ .key = "top", .value = .{ .boolean = false } },
        .{ .key = "functions", .value = .{ .array = &.{
            .{ .object = &.{ .{ .key = "function_id", .value = .{ .string = child_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_text } } } },
            .{ .object = &.{ .{ .key = "function_id", .value = .{ .string = alternate_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_text } } } },
        } } },
    } } },
};

const Fixture = struct {
    program: wire.Program,
    sources: [1]tables.Source,
    types: [3]tables.CommonType,
    bindings: [5]storage.CommonBinding,
    abis: [4]storage.CommonAbi,
    functions: [4]wire.Function,
    main_registers: [14]wire.Register,
    main_instructions: [14]ins.Instruction,
    main_operations: [14]control.SourcePlanOperation,
    main_blocks: [8]wire.Block,
    main_plan: [8]control.SourcePlanBlock,

    // Slices are attached only after self has its final owning address.
    fn init(self: *Fixture, return_code: bool) void {
        self.sources = .{.{ .hash = @splat(0x44), .path = "ordinary-lexical-operations-dto.ts", .length = 100 }};
        const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "Reference", .native_code = 0,
            .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null };
        self.types = .{ base, base, base };
        self.types[1].id = @splat(0x22); self.types[1].kind = .scalar; self.types[1].name = "bool"; self.types[1].native_code = 2;
        self.types[2].id = @splat(0x33); self.types[2].kind = .function; self.types[2].name = "Callable";
        self.types[2].element = reference; self.types[2].members = &.{reference};
        self.bindings = .{
            .{ .id = "main-value", .owner = .{ .param = @enumFromInt(0) }, .name = "mainValue", .@"type" = reference, .writable = true, .origin = declaration, .carrier = rc, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "main-flag", .owner = .{ .param = @enumFromInt(0) }, .name = "flag", .@"type" = boolean, .writable = false, .origin = declaration, .carrier = bc, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "child-value", .owner = .{ .param = @enumFromInt(1) }, .name = "replacement", .@"type" = reference, .writable = false, .origin = declaration, .carrier = rc, .scope = @enumFromInt(1), .declaration_kind = .parameter },
            .{ .id = "outer-value", .owner = .{ .param = @enumFromInt(2) }, .name = "outerValue", .@"type" = reference, .writable = true, .origin = declaration, .carrier = rc, .scope = @enumFromInt(2), .declaration_kind = .parameter },
            .{ .id = "alternate-value", .owner = .{ .param = @enumFromInt(3) }, .name = "alternateValue", .@"type" = reference, .writable = false, .origin = declaration, .carrier = rc, .scope = @enumFromInt(3), .declaration_kind = .parameter },
        };
        self.main_registers = .{
            .{ .carrier = e0, .view = null }, .{ .carrier = rc, .view = reference }, .{ .carrier = bc, .view = boolean },
            .{ .carrier = e1, .view = null }, .{ .carrier = fc, .view = callable }, .{ .carrier = fc, .view = callable },
            .{ .carrier = fc, .view = callable }, .{ .carrier = fc, .view = callable }, .{ .carrier = fc, .view = callable },
            .{ .carrier = fc, .view = callable }, .{ .carrier = rc, .view = reference }, .{ .carrier = .payload, .view = null },
            .{ .carrier = rc, .view = reference }, .{ .carrier = .payload, .view = null },
        };
        self.main_instructions = .{
            .{ .source = declaration, .result = r3, .operands = &.{r0}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(1), .anchor_kind = .function_entry } } },
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = declaration, .result = null, .operands = &.{ r3, r1 }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .parameter } } },
            .{ .source = operation, .result = r4, .operands = &.{r3}, .data = .{ .function_make = .{ .function = @enumFromInt(1) } } },
            .{ .source = operation, .result = r5, .operands = &.{r0}, .data = .{ .function_make = .{ .function = @enumFromInt(3) } } },
            .{ .source = operation, .result = null, .operands = &.{ r2, r4, r5 }, .data = .{ .cond_br = .{ .true_destination = @enumFromInt(1), .false_destination = @enumFromInt(2), .true_count = 1 } } },
            .{ .source = operation, .result = null, .operands = &.{r6}, .data = .{ .br = .{ .destination = @enumFromInt(3) } } },
            .{ .source = operation, .result = null, .operands = &.{r7}, .data = .{ .br = .{ .destination = @enumFromInt(3) } } },
            .{ .source = operation, .result = r9, .operands = &.{r8}, .data = .{ .domain_copy = .{ .static_view = callable } } },
            .{ .source = operation, .result = null, .operands = &.{ r3, r1 }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(4), .exceptional = @enumFromInt(5) } } },
            .{ .source = operation, .result = null, .operands = &.{ r9, r10 }, .data = .{ .eh_invoke_indirect = .{ .callable = callable, .normal = @enumFromInt(6), .exceptional = @enumFromInt(7) } } },
            .{ .source = operation, .result = null, .operands = &.{r11}, .data = .eh_raise },
            .{ .source = operation, .result = null, .operands = &.{r12}, .data = .@"return" },
            .{ .source = operation, .result = null, .operands = &.{r13}, .data = .eh_raise },
        };
        self.main_operations = .{
            .{ .name = "env_alloc", .view = "env:" ++ inner_env, .properties = &inner_properties, .result = r3, .operands = &.{r0}, .successors = &.{}, .source = declaration },
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "env_init", .view = "void", .properties = &inner_slot_properties, .result = null, .operands = &.{ r3, r1 }, .successors = &.{}, .source = declaration },
            .{ .name = "make_closure", .view = callable_text, .properties = &make_child_properties, .result = r4, .operands = &.{r3}, .successors = &.{}, .source = operation },
            .{ .name = "make_closure", .view = callable_text, .properties = &make_alternate_properties, .result = r5, .operands = &.{r0}, .successors = &.{}, .source = operation },
            .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .result = null, .operands = &.{ r2, r4, r5 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
            .{ .name = "cf.br", .view = "", .properties = &.{}, .result = null, .operands = &.{r6}, .successors = &.{@enumFromInt(3)}, .source = operation },
            .{ .name = "cf.br", .view = "", .properties = &.{}, .result = null, .operands = &.{r7}, .successors = &.{@enumFromInt(3)}, .source = operation },
            .{ .name = "value_copy", .view = callable_text, .properties = &copy_properties, .result = r9, .operands = &.{r8}, .successors = &.{}, .source = operation },
            .{ .name = "invoke", .view = "void", .properties = &invoke_properties, .result = null, .operands = &.{ r3, r1 }, .successors = &.{ @enumFromInt(4), @enumFromInt(5) }, .source = operation },
            .{ .name = "invoke_indirect", .view = "void", .properties = &indirect_properties, .result = null, .operands = &.{ r9, r10 }, .successors = &.{ @enumFromInt(6), @enumFromInt(7) }, .source = operation },
            .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r11}, .successors = &.{}, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r12}, .successors = &.{}, .source = operation },
            .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r13}, .successors = &.{}, .source = operation },
        };
        self.main_blocks = .{
            .{ .parameters = &.{ r0, r1, r2 }, .instructions = self.main_instructions[0..6] },
            .{ .parameters = &.{r6}, .instructions = self.main_instructions[6..7] },
            .{ .parameters = &.{r7}, .instructions = self.main_instructions[7..8] },
            .{ .parameters = &.{r8}, .instructions = self.main_instructions[8..10] },
            .{ .parameters = &.{r10}, .instructions = self.main_instructions[10..11] },
            .{ .parameters = &.{r11}, .instructions = self.main_instructions[11..12] },
            .{ .parameters = &.{r12}, .instructions = self.main_instructions[12..13] },
            .{ .parameters = &.{r13}, .instructions = self.main_instructions[13..14] },
        };
        self.main_plan = .{
            .{ .parameters = &.{ r0, r1, r2 }, .operations = self.main_operations[0..6] },
            .{ .parameters = &.{r6}, .operations = self.main_operations[6..7] },
            .{ .parameters = &.{r7}, .operations = self.main_operations[7..8] },
            .{ .parameters = &.{r8}, .operations = self.main_operations[8..10] },
            .{ .parameters = &.{r10}, .operations = self.main_operations[10..11] },
            .{ .parameters = &.{r11}, .operations = self.main_operations[11..12] },
            .{ .parameters = &.{r12}, .operations = self.main_operations[12..13] },
            .{ .parameters = &.{r13}, .operations = self.main_operations[13..14] },
        };
        const prototype: storage.CommonAbi = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0xdd),
            .parameters = &.{ @enumFromInt(0), @enumFromInt(1) }, .argument_types = &.{ reference, boolean },
            .receiver = null, .construction = null, .receiver_frame = null, .lexical_environment = @enumFromInt(0),
            .physical_parameters = &.{ e0, rc, bc }, .result = reference, .result_carrier = rc,
            .source_plan = .{ .carriers = &.{ "env:" ++ outer_env, reference_text, boolean_text, "env:" ++ inner_env,
                callable_text, callable_text, callable_text, callable_text, callable_text, callable_text, reference_text, payload_text, reference_text, payload_text }, .blocks = &self.main_plan } };
        self.abis = .{ prototype, prototype, prototype, prototype };
        const function: wire.Function = .{ .id = @splat(0x55), .signature = @splat(0xdd), .abi = @enumFromInt(0), .source = @enumFromInt(0),
            .role = .ordinary, .declaration = .{ .start = 0, .end = 100 }, .name = "lexicalOperations", .registers = &self.main_registers, .blocks = &self.main_blocks };
        self.functions = .{ function, function, function, function };
        // Child reads and replaces the *parent* slot. Both reads remain in the
        // graph; the final read uses the heap after the exact mutable slot write.
        self.functions[1].id = @splat(0x66); self.functions[1].abi = @enumFromInt(1);
        self.functions[1].registers = &.{ .{ .carrier = e1, .view = null }, .{ .carrier = rc, .view = reference },
            .{ .carrier = e0, .view = null }, .{ .carrier = rc, .view = reference }, .{ .carrier = rc, .view = reference } };
        self.functions[1].blocks = &.{.{ .parameters = &.{ r0, r1 }, .instructions = &.{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = r2, .operands = &.{r0}, .data = .environment_parent },
            .{ .source = operation, .result = r3, .operands = &.{r2}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = null, .operands = &.{ r2, r1 }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = r4, .operands = &.{r2}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } },
            .{ .source = operation, .result = null, .operands = &.{r4}, .data = .@"return" },
        } }};
        self.abis[1].function = @enumFromInt(1); self.abis[1].parameters = &.{@enumFromInt(2)};
        self.abis[1].argument_types = &.{reference}; self.abis[1].lexical_environment = @enumFromInt(1); self.abis[1].physical_parameters = &.{ e1, rc };
        self.abis[1].source_plan = .{ .carriers = &.{ "env:" ++ inner_env, reference_text, "env:" ++ outer_env, reference_text, reference_text }, .blocks = &.{.{ .parameters = &.{ r0, r1 }, .operations = &.{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "env_parent", .view = "env:" ++ outer_env, .properties = &outer_properties, .result = r2, .operands = &.{r0}, .successors = &.{}, .source = operation },
            .{ .name = "env_load", .view = reference_text, .properties = &outer_slot_properties, .result = r3, .operands = &.{r2}, .successors = &.{}, .source = operation },
            .{ .name = "env_store", .view = "void", .properties = &outer_slot_properties, .result = null, .operands = &.{ r2, r1 }, .successors = &.{}, .source = operation },
            .{ .name = "env_load", .view = reference_text, .properties = &outer_slot_properties, .result = r4, .operands = &.{r2}, .successors = &.{}, .source = operation },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r4}, .successors = &.{}, .source = operation },
        } }} };
        // The two other ordinary bodies keep the fixture's own ABI declarations
        // inhabited without importing a program or claiming an Actual analysis.
        self.functions[2].id = @splat(0x99); self.functions[2].abi = @enumFromInt(2);
        self.functions[2].registers = &.{.{ .carrier = rc, .view = reference }};
        self.functions[2].blocks = &.{.{ .parameters = &.{r0}, .instructions = &.{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = null, .operands = &.{r0}, .data = .@"return" },
        } }};
        self.abis[2].function = @enumFromInt(2); self.abis[2].parameters = &.{@enumFromInt(3)}; self.abis[2].argument_types = &.{reference};
        self.abis[2].lexical_environment = null; self.abis[2].physical_parameters = &.{rc};
        self.abis[2].source_plan = .{ .carriers = &.{reference_text}, .blocks = &.{.{ .parameters = &.{r0}, .operations = &.{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r0}, .successors = &.{}, .source = operation },
        } }} };
        self.functions[3].id = @splat(0xaa); self.functions[3].abi = @enumFromInt(3);
        self.functions[3].registers = &.{ .{ .carrier = e0, .view = null }, .{ .carrier = rc, .view = reference } };
        self.functions[3].blocks = &.{.{ .parameters = &.{ r0, r1 }, .instructions = &.{
            .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
            .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
        } }};
        self.abis[3].function = @enumFromInt(3); self.abis[3].parameters = &.{@enumFromInt(4)}; self.abis[3].argument_types = &.{reference}; self.abis[3].physical_parameters = &.{ e0, rc };
        self.abis[3].source_plan = .{ .carriers = &.{ "env:" ++ outer_env, reference_text }, .blocks = &.{.{ .parameters = &.{ r0, r1 }, .operations = &.{
            .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
            .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
        } }} };
        if (return_code) {
            self.main_instructions[4] = .{ .source = operation, .result = r5, .operands = &.{r4}, .data = .{ .domain_copy = .{ .static_view = callable } } };
            self.main_instructions[5] = .{ .source = operation, .result = null, .operands = &.{r5}, .data = .@"return" };
            self.main_operations[4] = .{ .name = "value_copy", .view = callable_text, .properties = &copy_properties, .result = r5, .operands = &.{r4}, .successors = &.{}, .source = operation };
            self.main_operations[5] = .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r5}, .successors = &.{}, .source = operation };
            self.functions[0].registers = self.main_registers[0..6]; self.functions[0].blocks = self.main_blocks[0..1];
            self.abis[0].result = callable; self.abis[0].result_carrier = fc;
            self.abis[0].source_plan.carriers = self.abis[0].source_plan.carriers[0..6]; self.abis[0].source_plan.blocks = self.main_plan[0..1];
        }
        var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis; common.storage.bindings = &self.bindings;
        common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
        common.storage.concrete = &.{
            .{ .@"type" = reference, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            .{ .@"type" = boolean, .carrier = .{ .layout = .{ .byte_size = 1, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
            .{ .@"type" = callable, .carrier = .{ .layout = .{ .byte_size = 40, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = null },
        };
        common.closures.functions = &.{
            .{ .function = @enumFromInt(0), .parent = @enumFromInt(2), .lexical_environment = @enumFromInt(0), .activation_environment = @enumFromInt(1), .captures = &.{} },
            .{ .function = @enumFromInt(1), .parent = @enumFromInt(0), .lexical_environment = @enumFromInt(1), .activation_environment = null, .captures = &.{.{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }} },
            .{ .function = @enumFromInt(2), .parent = null, .lexical_environment = null, .activation_environment = @enumFromInt(0), .captures = &.{} },
            .{ .function = @enumFromInt(3), .parent = @enumFromInt(2), .lexical_environment = @enumFromInt(0), .activation_environment = null, .captures = &.{} },
        };
        common.closures.environments = &.{
            .{ .id = @splat(0x77), .owner = @enumFromInt(2), .parent = null, .slots = &.{.{ .binding = @enumFromInt(3), .key = @splat(0xbb), .kind = .parameter, .@"type" = reference, .writable = true }} },
            .{ .id = @splat(0x88), .owner = @enumFromInt(0), .parent = @enumFromInt(0), .slots = &.{.{ .binding = @enumFromInt(0), .key = @splat(0xcc), .kind = .parameter, .@"type" = reference, .writable = true }} },
        };
        common.storage.environments = &.{
            .{ .environment = @enumFromInt(0), .byte_size = 8, .alignment = 8, .reference_count = 1, .parent_offset = null, .slot_offsets = &.{0} },
            .{ .environment = @enumFromInt(1), .byte_size = 16, .alignment = 8, .reference_count = 2, .parent_offset = 0, .slot_offsets = &.{8} },
        };
        common.closures.calls = if (return_code) &.{} else &.{.{ .function = @enumFromInt(0), .block = @enumFromInt(4), .instruction = 0, .signature = @splat(0xdd), .targets = &.{ @enumFromInt(1), @enumFromInt(3) } }};
        common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = @enumFromInt(1), .path = &.{"function"} }, .{ .owner = @enumFromInt(2), .path = &.{"function"} }, .{ .owner = @enumFromInt(3), .path = &.{"function"} } };
        common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(3), .scope = @enumFromInt(2) }, .{ .binding = @enumFromInt(4), .scope = @enumFromInt(3) } };
        common.exceptions.functions = &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = @enumFromInt(1), .handlers = &.{} }, .{ .function = @enumFromInt(2), .handlers = &.{} }, .{ .function = @enumFromInt(3), .handlers = &.{} } };
        self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
    }
};

fn interpretation(comptime return_code: bool) origin.Directory {
    return .{
        .types = &.{ .{ .id = reference_text, .kind = .reference }, .{ .id = boolean_text, .kind = .scalar }, .{ .id = callable_text, .kind = .function } },
        .functions = &.{
            .{ .id = main_text, .kind = .source, .parameter_types = &.{ reference_text, boolean_text }, .return_type = if (return_code) callable_text else reference_text, .environment_metadata_complete = true, .lexical_environment = outer_env, .activation_environment = inner_env, .construction = null },
            .{ .id = child_text, .kind = .source, .parameter_types = &.{reference_text}, .return_type = reference_text, .environment_metadata_complete = true, .lexical_environment = inner_env, .activation_environment = null, .construction = null },
            .{ .id = outer_text, .kind = .source, .parameter_types = &.{reference_text}, .return_type = reference_text, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = outer_env, .construction = null },
            .{ .id = alternate_text, .kind = .source, .parameter_types = &.{reference_text}, .return_type = reference_text, .environment_metadata_complete = true, .lexical_environment = outer_env, .activation_environment = null, .construction = null },
        },
        .environments = &.{ .{ .id = outer_env, .parent = null, .slots = &.{.{ .key = outer_key, .@"type" = reference_text, .writable = true }} }, .{ .id = inner_env, .parent = outer_env, .slots = &.{.{ .key = inner_key, .@"type" = reference_text, .writable = true }} } },
        .globals = &.{}, .fields = &.{}, .constructions = &.{.{ .id = "ordinary-reference-construction", .owner = reference_text, .base = null, .kind = .implicit_base, .function_id = null }},
    };
}

fn typedInput(c: *context.Context, budget: *origin.Budget, directory: *const origin.Directory) !void {
    for (c.program.functions) |f| {
        try c.anchor(f.declaration, f.source);
        for (f.registers) |reg| { try c.carrier(reg.carrier); try c.maybeRef(reg.view, c.counts().types); }
        for (f.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
    }
    try layout.check(c); try ssa.check(c); try correspondence.check(c);
    try origin.validateDirectory(c.allocator, directory, budget);
}

// Only transparent SSA joins/gates are traversed by this oracle. It deliberately
// does not implement the solver, heap semantics or Code/ENV pairing algorithm.
fn root(graph: *const origin.Graph, value: origin.Ref) !origin.Ref {
    var current = value; var depth: usize = 0;
    while (depth < graph.nodes.len) : (depth += 1) {
        const inputs = switch (graph.nodes[current]) { .join => |v| v.inputs, .gate => |v| v.inputs, else => return current };
        try std.testing.expectEqual(@as(usize, 1), inputs.len); current = inputs[0];
    }
    return error.TestUnexpectedCycle;
}

fn parameterZero(graph: *const origin.Graph, value: origin.Ref) !void {
    const node = graph.nodes[try root(graph, value)]; try std.testing.expect(node == .parameter);
    try std.testing.expectEqual(@as(usize, 0), node.parameter.index); try std.testing.expectEqualStrings(reference_text, node.parameter.@"type");
}

fn completionExit(graph: *const origin.Graph, exit: origin.Exit, calls: []const origin.Ref, completion: origin.Completion) !void {
    const heap = graph.heaps[exit.heap]; const ctl = graph.controls[exit.control];
    try std.testing.expect(heap == .join and ctl == .join);
    try std.testing.expectEqual(calls.len, heap.join.inputs.len); try std.testing.expectEqual(calls.len, ctl.join.inputs.len);
    for (heap.join.inputs, ctl.join.inputs, calls) |heap_id, control_id, call_id| {
        const incoming_heap = graph.heaps[heap_id]; const incoming_control = graph.controls[control_id];
        try std.testing.expect(incoming_heap == .call and incoming_control == .call);
        try std.testing.expectEqual(call_id, incoming_heap.call.call); try std.testing.expectEqual(call_id, incoming_control.call.call);
        try std.testing.expectEqual(completion, incoming_heap.call.completion); try std.testing.expectEqual(completion, incoming_control.call.completion);
    }
}

test "ordinary parent-slot loads and mutable replacement retain exact ENV and heap chain" {
    var fixture: Fixture = undefined; fixture.init(false); const directory = interpretation(false);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
    try typedInput(&c, &budget, &directory);
    var projected = try body.project(&c, @enumFromInt(1), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &directory, child_text, graph, &budget)) == .valid);
    var first: ?origin.Ref = null; var last: ?origin.Ref = null; var store_id: ?origin.Ref = null;
    for (graph.nodes, 0..) |node, id| if (node == .capture) { if (first == null) first = id; last = id; };
    for (graph.heaps, 0..) |heap, id| if (heap == .store) { try std.testing.expect(store_id == null); store_id = id; };
    try std.testing.expect(first != null and last != null and first.? != last.? and store_id != null);
    const before = graph.nodes[first.?].capture; const after = graph.nodes[last.?].capture; const write = graph.heaps[store_id.?].store;
    try std.testing.expectEqualStrings(outer_env, before.layout); try std.testing.expectEqualStrings(outer_key, before.id);
    try std.testing.expectEqualStrings(outer_env, after.layout); try std.testing.expectEqualStrings(outer_key, after.id);
    try std.testing.expectEqualSlices(origin.Ref, before.environment, after.environment); try std.testing.expectEqualSlices(origin.Ref, before.environment, write.bases);
    const parent = graph.nodes[try root(graph, before.environment[0])]; try std.testing.expect(parent == .environment_parent);
    try std.testing.expectEqualStrings(outer_env, parent.environment_parent.layout);
    const incoming = graph.nodes[try root(graph, parent.environment_parent.bases[0])]; try std.testing.expect(incoming == .environment_input);
    try std.testing.expectEqualStrings(inner_env, incoming.environment_input.layout);
    try std.testing.expectEqualStrings("capture:" ++ outer_key, write.selector); try std.testing.expectEqualStrings("env:" ++ outer_env, write.view);
    try std.testing.expect(!write.initialize); try parameterZero(graph, write.values[0]);
    try std.testing.expectEqual(before.heap, write.previous); try std.testing.expectEqual(store_id.?, after.heap);
    try std.testing.expectEqual(last.?, try root(graph, graph.normal[0]));
    try std.testing.expectEqual(store_id.?, graph.exits.normal[0].heap); try std.testing.expectEqual(@as(usize, 0), graph.language.len);
}

test "ordinary activation initializes its captured parameter before making and copying returned Code ENV pair" {
    var fixture: Fixture = undefined; fixture.init(true); const directory = interpretation(true);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
    try typedInput(&c, &budget, &directory);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &directory, main_text, graph, &budget)) == .valid);
    const copy_id = try root(graph, graph.normal[0]); const copied = graph.nodes[copy_id]; try std.testing.expect(copied == .copy);
    const code = graph.nodes[try root(graph, copied.copy.bases[0])]; try std.testing.expect(code == .code);
    try std.testing.expectEqualStrings(child_text, code.code.function_id); const allocated = graph.nodes[try root(graph, code.code.environment.?[0])];
    try std.testing.expect(allocated == .environment_create); try std.testing.expectEqualStrings(inner_env, allocated.environment_create.layout);
    const parent = graph.nodes[try root(graph, allocated.environment_create.parent.?[0])]; try std.testing.expect(parent == .environment_input);
    try std.testing.expectEqualStrings(outer_env, parent.environment_input.layout);
    const init = graph.heaps[copied.copy.heap]; try std.testing.expect(init == .store and init.store.initialize);
    try std.testing.expectEqualStrings("capture:" ++ inner_key, init.store.selector); try std.testing.expectEqualStrings("env:" ++ inner_env, init.store.view);
    try std.testing.expectEqualSlices(origin.Ref, code.code.environment.?, init.store.bases); try parameterZero(graph, init.store.values[0]);
    const exit_heap = graph.heaps[graph.exits.normal[0].heap]; try std.testing.expect(exit_heap == .copy);
    try std.testing.expectEqual(copy_id, exit_heap.copy.value); try std.testing.expectEqual(copied.copy.heap, exit_heap.copy.previous);
    try std.testing.expect(graph.heaps[init.store.previous] == .join); try std.testing.expectEqual(@as(usize, 0), graph.calls.len);
}

test "ordinary direct and complete indirect targets preserve saved heap paired environments and both completions" {
    var fixture: Fixture = undefined; fixture.init(false); const directory = interpretation(false);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
    try typedInput(&c, &budget, &directory);
    var projected = try body.project(&c, @enumFromInt(0), &directory, &budget); defer projected.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projected.pending); const graph = &projected.graph.?;
    try std.testing.expect((try origin.validateGraph(c.allocator, &directory, main_text, graph, &budget)) == .valid);
    try std.testing.expectEqual(@as(usize, 3), graph.calls.len);
    const direct = graph.calls[0]; try std.testing.expectEqualStrings(child_text, direct.function_id); try std.testing.expect(direct.callee == null);
    try std.testing.expectEqual(@as(usize, 1), direct.arguments.len); try parameterZero(graph, direct.arguments[0][0]);
    const direct_env = graph.nodes[try root(graph, direct.environment.?[0])]; try std.testing.expect(direct_env == .environment_create);
    try std.testing.expectEqualStrings(inner_env, direct_env.environment_create.layout);
    const saved = graph.heaps[direct.heap]; try std.testing.expect(saved == .copy);
    const copied = graph.nodes[saved.copy.value]; try std.testing.expect(copied == .copy); try std.testing.expectEqual(saved.copy.previous, copied.copy.heap);
    const init = graph.heaps[saved.copy.previous]; try std.testing.expect(init == .join);
    // Both branches reach the saved pre-call heap; each branch retains the same
    // real activation initialization, rather than a fabricated fresh entry.
    try std.testing.expectEqual(@as(usize, 2), init.join.inputs.len);
    for (init.join.inputs) |branch_heap| {
        const branch = graph.heaps[branch_heap]; try std.testing.expect(branch == .join); try std.testing.expectEqual(@as(usize, 1), branch.join.inputs.len);
        const initialized = graph.heaps[branch.join.inputs[0]]; try std.testing.expect(initialized == .store and initialized.store.initialize);
        try parameterZero(graph, initialized.store.values[0]);
    }
    const merged = graph.nodes[copied.copy.bases[0]]; try std.testing.expect(merged == .join); try std.testing.expectEqual(@as(usize, 2), merged.join.inputs.len);
    var saw_child = false; var saw_alternate = false;
    for (merged.join.inputs) |input| {
        const made = graph.nodes[try root(graph, input)]; try std.testing.expect(made == .code);
        const env = graph.nodes[try root(graph, made.code.environment.?[0])];
        if (std.mem.eql(u8, made.code.function_id, child_text)) { saw_child = true; try std.testing.expect(env == .environment_create); try std.testing.expectEqualStrings(inner_env, env.environment_create.layout); }
        else { try std.testing.expectEqualStrings(alternate_text, made.code.function_id); saw_alternate = true; try std.testing.expect(env == .environment_input); try std.testing.expectEqualStrings(outer_env, env.environment_input.layout); }
    }
    try std.testing.expect(saw_child and saw_alternate);
    for (graph.calls[1..], 1..) |call, call_id| {
        const expected_function = if (call_id == 1) child_text else alternate_text; const expected_env = if (call_id == 1) inner_env else outer_env;
        try std.testing.expectEqualStrings(expected_function, call.function_id); try std.testing.expectEqual(@as(usize, 1), call.arguments.len);
        const arg = graph.nodes[try root(graph, call.arguments[0][0])]; try std.testing.expect(arg == .call); try std.testing.expectEqual(@as(usize, 0), arg.call.call); try std.testing.expect(arg.call.completion == .normal);
        try std.testing.expectEqual(saved.copy.value, try root(graph, call.callee.?[0]));
        const env = graph.nodes[call.environment.?[0]]; try std.testing.expect(env == .environment_component);
        try std.testing.expectEqualStrings(expected_function, env.environment_component.function_id); try std.testing.expectEqualStrings(expected_env, env.environment_component.layout);
        try std.testing.expectEqualSlices(origin.Ref, call.callee.?, env.environment_component.callee);
        try std.testing.expectEqual(graph.calls[1].heap, call.heap); try std.testing.expectEqual(graph.calls[1].control, call.control);
        const incoming_heap = graph.heaps[call.heap]; try std.testing.expect(incoming_heap == .join); try std.testing.expectEqual(@as(usize, 1), incoming_heap.join.inputs.len);
        const normal_heap = graph.heaps[incoming_heap.join.inputs[0]]; try std.testing.expect(normal_heap == .call); try std.testing.expectEqual(@as(usize, 0), normal_heap.call.call); try std.testing.expect(normal_heap.call.completion == .normal);
        const incoming_control = graph.controls[call.control]; try std.testing.expect(incoming_control == .join); try std.testing.expectEqual(@as(usize, 1), incoming_control.join.inputs.len);
        const normal_control = graph.controls[incoming_control.join.inputs[0]]; try std.testing.expect(normal_control == .call); try std.testing.expectEqual(@as(usize, 0), normal_control.call.call); try std.testing.expect(normal_control.call.completion == .normal);
    }
    // Every Call has exactly one Data/Heap/Control node for EACH completion.
    // Exits then join both indirect targets; the direct language exit survives.
    for (graph.calls, 0..) |_, call_id| inline for (.{ origin.Completion.normal, origin.Completion.language }) |completion| {
        var values: usize = 0; var heaps: usize = 0; var controls: usize = 0;
        for (graph.nodes) |node| if (node == .call and node.call.call == call_id and node.call.completion == completion) { values += 1; };
        for (graph.heaps) |heap| if (heap == .call and heap.call.call == call_id and heap.call.completion == completion) { heaps += 1; };
        for (graph.controls) |ctl| if (ctl == .call and ctl.call.call == call_id and ctl.call.completion == completion) { controls += 1; };
        try std.testing.expectEqual(@as(usize, 1), values); try std.testing.expectEqual(@as(usize, 1), heaps); try std.testing.expectEqual(@as(usize, 1), controls);
    };
    try std.testing.expectEqual(@as(usize, 1), graph.exits.normal.len); try std.testing.expectEqual(@as(usize, 2), graph.exits.language.len);
    try completionExit(graph, graph.exits.normal[0], &.{ 1, 2 }, .normal);
    try completionExit(graph, graph.exits.language[0], &.{0}, .language);
    try completionExit(graph, graph.exits.language[1], &.{ 1, 2 }, .language);
    const normal_values = graph.nodes[graph.normal[0]]; try std.testing.expect(normal_values == .join); try std.testing.expectEqual(@as(usize, 2), normal_values.join.inputs.len);
    for (normal_values.join.inputs, 1..) |value, call_id| { const result = graph.nodes[value]; try std.testing.expect(result == .call); try std.testing.expectEqual(call_id, result.call.call); try std.testing.expect(result.call.completion == .normal); }
    try std.testing.expectEqual(@as(usize, 2), graph.language.len);
    const direct_language = graph.nodes[try root(graph, graph.language[0])]; try std.testing.expect(direct_language == .call);
    try std.testing.expectEqual(@as(usize, 0), direct_language.call.call); try std.testing.expect(direct_language.call.completion == .language);
    const indirect_language = graph.nodes[graph.language[1]]; try std.testing.expect(indirect_language == .join);
    try std.testing.expectEqual(@as(usize, 2), indirect_language.join.inputs.len);
    for (indirect_language.join.inputs, 1..) |value, call_id| { const result = graph.nodes[value]; try std.testing.expect(result == .call); try std.testing.expectEqual(call_id, result.call.call); try std.testing.expect(result.call.completion == .language); }
}

test "owning typed boundaries reject wrong parent Code ENV and immutable-slot writes before Body" {
    // Each independent baseline must pass all typed premises first. These are
    // owning InvalidShape controls, never evidence of a Body RED.
    {
        var fixture: Fixture = undefined; fixture.init(true); const directory = interpretation(true);
        var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
        try typedInput(&c, &budget, &directory);
        // An activation whose declared parent is outer ENV cannot receive its
        // ordinary reference parameter as that parent. SSA owns the mismatch.
        fixture.main_instructions[0].operands = &.{r1}; fixture.main_operations[0].operands = &.{r1};
        try std.testing.expectError(error.InvalidShape, ssa.check(&c));
    }
    {
        var fixture: Fixture = undefined; fixture.init(true); const directory = interpretation(true);
        var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
        try typedInput(&c, &budget, &directory);
        // Child Code requires inner ENV, while this operand is outer ENV.
        fixture.main_instructions[3].operands = &.{r0}; fixture.main_operations[3].operands = &.{r0};
        try std.testing.expectError(error.InvalidShape, ssa.check(&c));
    }
    {
        var fixture: Fixture = undefined; fixture.init(false); const directory = interpretation(false);
        var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
        try typedInput(&c, &budget, &directory);
        var environments = fixture.program.tables.mode.common.closures.environments[0..2].*;
        var slot = environments[0].slots[0..1].*; slot[0].writable = false; environments[0].slots = &slot;
        fixture.bindings[3].writable = false; fixture.program.tables.mode.common.closures.environments = &environments;
        try layout.check(&c); // The mutation is layout-consistent.
        try std.testing.expectError(error.InvalidShape, ssa.check(&c));
    }
}

test "ordinary Body retains explicit pending for incomplete environment and function interpretation" {
    var fixture: Fixture = undefined; fixture.init(true); const directory = interpretation(true);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator }; var budget = origin.Budget{ .context = &c, .charge = refs.graphCharge };
    try typedInput(&c, &budget, &directory);
    {
        var incomplete = directory; var environments = directory.environments[0..2].*;
        environments[1].slots = &.{}; incomplete.environments = &environments;
        try origin.validateDirectory(c.allocator, &incomplete, &budget);
        var projected = try body.project(&c, @enumFromInt(0), &incomplete, &budget); defer projected.deinit();
        try std.testing.expect(projected.pending != null); try std.testing.expectEqualStrings("archive_environment", @tagName(projected.pending.?)); try std.testing.expect(projected.graph == null);
    }
    {
        var incomplete = directory; var functions = directory.functions[0..4].*;
        functions[1].environment_metadata_complete = false; incomplete.functions = &functions;
        try origin.validateDirectory(c.allocator, &incomplete, &budget);
        var projected = try body.project(&c, @enumFromInt(0), &incomplete, &budget); defer projected.deinit();
        try std.testing.expect(projected.pending != null); try std.testing.expectEqualStrings("archive_function", @tagName(projected.pending.?)); try std.testing.expect(projected.graph == null);
    }
    {
        // A nonexistent declared parent is rejected by the Directory owner,
        // before Body. This is distinct from a structurally valid missing slot.
        var malformed = directory; var environments = directory.environments[0..2].*;
        environments[1].parent = "unknown-ordinary-parent"; malformed.environments = &environments;
        try std.testing.expectError(error.InvalidReference, origin.validateDirectory(c.allocator, &malformed, &budget));
    }
}
