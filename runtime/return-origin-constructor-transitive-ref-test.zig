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
const dto = @import("constructor-transitive-ref-dto.zig");
const t = wire.types;
const ins = wire.instruction;
const a: t.TypeRef = @enumFromInt(0);
const b: t.TypeRef = @enumFromInt(1);
const scalar: t.TypeRef = @enumFromInt(2);
const actual_c: t.TypeRef = @enumFromInt(5);
const actual_cc: t.Carrier = .{ .@"type" = actual_c };
const actual_cf: t.Carrier = .{ .receiver = @enumFromInt(3) };
const actual_token: t.Carrier = .{ .initialization = @enumFromInt(3) };
const c_type: t.TypeRef = @enumFromInt(4);
const cc: t.Carrier = .{ .@"type" = c_type };
const cf: t.Carrier = .{ .receiver = @enumFromInt(0) };
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
const r10: t.RegisterRef = @enumFromInt(10);
const r11: t.RegisterRef = @enumFromInt(11);
const r12: t.RegisterRef = @enumFromInt(12);
const r13: t.RegisterRef = @enumFromInt(13);
const ac: t.Carrier = .{ .@"type" = a };
const bc: t.Carrier = .{ .@"type" = b };
const sc: t.Carrier = .{ .@"type" = scalar };
const uc: t.Carrier = .{ .@"type" = undefined_type };
const af: t.Carrier = .{ .receiver = @enumFromInt(1) };
const bf: t.Carrier = .{ .receiver = @enumFromInt(2) };
const a_token: t.Carrier = .{ .initialization = @enumFromInt(1) };
const token: t.Carrier = .{ .initialization = @enumFromInt(2) };
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 100 };
const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
const payload = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const a_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.a } }, .{ .key = "construction", .value = .{ .string = dto.role_a } } };
const b_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } } };
const create_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } }, .{ .key = "new_target", .value = .{ .string = dto.b } } };
const field_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.b } }, .{ .key = "construction", .value = .{ .string = dto.role_b } }, .{ .key = "field", .value = .{ .string = dto.field } } };
const native_field_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.a } }, .{ .key = "construction", .value = .{ .string = dto.role_a } }, .{ .key = "field", .value = .{ .string = dto.native_field } } };
const invoke_properties = [_]t.JsonMember{ .{ .key = "function_id", .value = .{ .string = dto.callee } }, .{ .key = "signature_hash", .value = .{ .string = "sha256:" ++ "bb" ** 32 } } };
const c_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.c } }, .{ .key = "construction", .value = .{ .string = dto.role_c } } };
const create_a_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.a } }, .{ .key = "construction", .value = .{ .string = dto.role_a } }, .{ .key = "new_target", .value = .{ .string = dto.a } } };
const invoke_a_properties = [_]t.JsonMember{ .{ .key = "function_id", .value = .{ .string = dto.native_callee } }, .{ .key = "signature_hash", .value = .{ .string = "sha256:" ++ "ba" ** 32 } } };
const native_create_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.actual_c } }, .{ .key = "construction", .value = .{ .string = dto.final_role } }, .{ .key = "new_target", .value = .{ .string = dto.actual_c } } };
const native_invoke_properties = [_]t.JsonMember{ .{ .key = "function_id", .value = .{ .string = dto.final_callee } }, .{ .key = "signature_hash", .value = .{ .string = "sha256:" ++ "bc" ** 32 } } };
const actual_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.actual_c } }, .{ .key = "construction", .value = .{ .string = dto.final_role } } };
const actual_field_properties = [_]t.JsonMember{ .{ .key = "owner", .value = .{ .string = dto.actual_c } }, .{ .key = "construction", .value = .{ .string = dto.final_role } }, .{ .key = "field", .value = .{ .string = dto.native_field } } };
const caller_registers = [_]wire.Register{
    .{ .carrier = cf, .view = null }, .{ .carrier = actual_cf, .view = null }, .{ .carrier = actual_cc, .view = actual_c }, .{ .carrier = .payload, .view = null },
    .{ .carrier = af, .view = null }, .{ .carrier = ac, .view = a }, .{ .carrier = .payload, .view = null }, .{ .carrier = cc, .view = c_type }, .{ .carrier = .payload, .view = null },
};
const caller_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(3), .new_target = actual_c } } },
    .{ .source = operation, .result = null, .operands = &.{r1}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(3), .normal = @enumFromInt(1), .exceptional = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(1), .new_target = a } } },
    .{ .source = operation, .result = null, .operands = &.{ r4, r2 }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(3), .exceptional = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{ r0, r5 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(5), .language = @enumFromInt(6) } } },
    .{ .source = operation, .result = null, .operands = &.{r6}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r7}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r8}, .data = .eh_raise },
};
const caller_blocks = [_]wire.Block{
    .{ .parameters = &.{r0}, .instructions = caller_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = caller_instructions[3..5] }, .{ .parameters = &.{r3}, .instructions = caller_instructions[5..6] },
    .{ .parameters = &.{r5}, .instructions = caller_instructions[6..7] }, .{ .parameters = &.{r6}, .instructions = caller_instructions[7..8] }, .{ .parameters = &.{r7}, .instructions = caller_instructions[8..9] }, .{ .parameters = &.{r8}, .instructions = caller_instructions[9..10] },
};
const caller_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.actual_c, .properties = &native_create_properties, .result = r1, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &native_invoke_properties, .result = null, .operands = &.{r1}, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.a, .properties = &create_a_properties, .result = r4, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &invoke_a_properties, .result = null, .operands = &.{ r4, r2 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &c_properties, .result = null, .operands = &.{ r0, r5 }, .successors = &.{ @enumFromInt(5), @enumFromInt(6) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r6}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r7}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
};
const caller_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r0}, .operations = caller_operations[0..3] }, .{ .parameters = &.{r2}, .operations = caller_operations[3..5] }, .{ .parameters = &.{r3}, .operations = caller_operations[5..6] },
    .{ .parameters = &.{r5}, .operations = caller_operations[6..7] }, .{ .parameters = &.{r6}, .operations = caller_operations[7..8] }, .{ .parameters = &.{r7}, .operations = caller_operations[8..9] }, .{ .parameters = &.{r8}, .operations = caller_operations[9..10] },
};
const callee_registers = [_]wire.Register{
    .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null }, .{ .carrier = token, .view = null },
    .{ .carrier = actual_cc, .view = actual_c }, .{ .carrier = token, .view = null }, .{ .carrier = uc, .view = undefined_type }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null },
};
const callee_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .receiver_allocate = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .receiver_bind = .{ .construction = @enumFromInt(2), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{ r0, r2 }, .data = .{ .initialize_begin = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = r6, .operands = &.{ r4, r2, r5 }, .data = .{ .initialize_field = .{ .construction = @enumFromInt(2), .field = @enumFromInt(0) } } },
    .{ .source = operation, .result = null, .operands = &.{ r6, r2 }, .data = .{ .initialize_end = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = r7, .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = undefined_type } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r7 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(2), .normal = @enumFromInt(3), .language = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r8}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r9}, .data = .eh_raise },
};
const callee_blocks = [_]wire.Block{
    .{ .parameters = &.{ r0, r5 }, .instructions = callee_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = callee_instructions[3..8] }, .{ .parameters = &.{r3}, .instructions = callee_instructions[8..9] }, .{ .parameters = &.{r8}, .instructions = callee_instructions[9..10] }, .{ .parameters = &.{r9}, .instructions = callee_instructions[10..11] },
};
const callee_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_allocate", .view = dto.b, .properties = &b_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_bind", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r0, r1 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "initialize_begin", .view = "initialization:" ++ dto.b, .properties = &b_properties, .result = r4, .operands = &.{ r0, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "initialize_field", .view = "initialization:" ++ dto.b, .properties = &field_properties, .result = r6, .operands = &.{ r4, r2, r5 }, .successors = &.{}, .source = operation },
    .{ .name = "initialize_end", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r6, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "undefined", .view = dto.undefined_type, .properties = &.{}, .result = r7, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &b_properties, .result = null, .operands = &.{ r0, r7 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r9}, .successors = &.{}, .source = operation },
};
const callee_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{ r0, r5 }, .operations = callee_operations[0..3] }, .{ .parameters = &.{r2}, .operations = callee_operations[3..8] }, .{ .parameters = &.{r3}, .operations = callee_operations[8..9] }, .{ .parameters = &.{r8}, .operations = callee_operations[9..10] }, .{ .parameters = &.{r9}, .operations = callee_operations[10..11] },
};
const native_registers = [_]wire.Register{
    .{ .carrier = af, .view = null }, .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b }, .{ .carrier = .payload, .view = null }, .{ .carrier = ac, .view = a }, .{ .carrier = .payload, .view = null }, .{ .carrier = actual_cc, .view = actual_c },
};
const native_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(2), .new_target = b } } },
    .{ .source = operation, .result = null, .operands = &.{ r1, r6 }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(1), .exceptional = @enumFromInt(2) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r2 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(1), .normal = @enumFromInt(3), .language = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r4}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r5}, .data = .eh_raise },
};
const native_blocks = [_]wire.Block{
    .{ .parameters = &.{ r0, r6 }, .instructions = native_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = native_instructions[3..4] }, .{ .parameters = &.{r3}, .instructions = native_instructions[4..5] }, .{ .parameters = &.{r4}, .instructions = native_instructions[5..6] }, .{ .parameters = &.{r5}, .instructions = native_instructions[6..7] },
};
const native_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.b, .properties = &create_properties, .result = r1, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &invoke_properties, .result = null, .operands = &.{ r1, r6 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &a_properties, .result = null, .operands = &.{ r0, r2 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r4}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r5}, .successors = &.{}, .source = operation },
};
const native_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{ r0, r6 }, .operations = native_operations[0..3] }, .{ .parameters = &.{r2}, .operations = native_operations[3..4] }, .{ .parameters = &.{r3}, .operations = native_operations[4..5] }, .{ .parameters = &.{r4}, .operations = native_operations[5..6] }, .{ .parameters = &.{r5}, .operations = native_operations[6..7] },
};
const actual_registers = [_]wire.Register{
    .{ .carrier = actual_cf, .view = null }, .{ .carrier = actual_cc, .view = actual_c }, .{ .carrier = actual_cc, .view = actual_c }, .{ .carrier = .payload, .view = null }, .{ .carrier = actual_token, .view = null },
    .{ .carrier = sc, .view = scalar }, .{ .carrier = actual_token, .view = null }, .{ .carrier = uc, .view = undefined_type }, .{ .carrier = actual_cc, .view = actual_c }, .{ .carrier = .payload, .view = null },
};
const actual_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .receiver_allocate = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .receiver_bind = .{ .construction = @enumFromInt(3), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{ r0, r2 }, .data = .{ .initialize_begin = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = r5, .operands = &.{}, .data = .{ .const_i32 = 7 } },
    .{ .source = operation, .result = r6, .operands = &.{ r4, r2, r5 }, .data = .{ .initialize_field = .{ .construction = @enumFromInt(3), .field = @enumFromInt(1) } } },
    .{ .source = operation, .result = null, .operands = &.{ r6, r2 }, .data = .{ .initialize_end = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = r7, .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = undefined_type } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r7 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(3), .normal = @enumFromInt(3), .language = @enumFromInt(4) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r8}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r9}, .data = .eh_raise },
};
const actual_blocks = [_]wire.Block{
    .{ .parameters = &.{r0}, .instructions = actual_instructions[0..3] }, .{ .parameters = &.{r2}, .instructions = actual_instructions[3..9] }, .{ .parameters = &.{r3}, .instructions = actual_instructions[9..10] }, .{ .parameters = &.{r8}, .instructions = actual_instructions[10..11] }, .{ .parameters = &.{r9}, .instructions = actual_instructions[11..12] },
};
const actual_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "receiver_allocate", .view = dto.actual_c, .properties = &actual_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_bind", .view = "void", .properties = &actual_properties, .result = null, .operands = &.{ r0, r1 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "initialize_begin", .view = "initialization:" ++ dto.actual_c, .properties = &actual_properties, .result = r4, .operands = &.{ r0, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "constant", .view = dto.scalar, .properties = &.{.{ .key = "decimal", .value = .{ .string = "7" } }}, .result = r5, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "initialize_field", .view = "initialization:" ++ dto.actual_c, .properties = &actual_field_properties, .result = r6, .operands = &.{ r4, r2, r5 }, .successors = &.{}, .source = operation },
    .{ .name = "initialize_end", .view = "void", .properties = &actual_properties, .result = null, .operands = &.{ r6, r2 }, .successors = &.{}, .source = operation },
    .{ .name = "undefined", .view = dto.undefined_type, .properties = &.{}, .result = r7, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &actual_properties, .result = null, .operands = &.{ r0, r7 }, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r9}, .successors = &.{}, .source = operation },
};
const actual_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r0}, .operations = actual_operations[0..3] }, .{ .parameters = &.{r2}, .operations = actual_operations[3..9] }, .{ .parameters = &.{r3}, .operations = actual_operations[9..10] }, .{ .parameters = &.{r8}, .operations = actual_operations[10..11] }, .{ .parameters = &.{r9}, .operations = actual_operations[11..12] },
};
// Independent whole-body upper: both literal producers belong to the
// receiver_bind normal block in the literal SourcePlan, so their uses retain
// that exact birth predicate. The shared Domain-only graph does not claim this
// stronger current-body access/guard certificate. No projection builds it.
const complete_nodes: [8]m.Value = blk: {
    var nodes: [8]m.Value = undefined; @memcpy(nodes[0..6], dto.leaf.nodes);
    nodes[6] = .{ .join = .{ .@"type" = dto.actual_c, .inputs = &.{3} } };
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
const actual_complete_nodes: [8]m.Value = blk: {
    var nodes: [8]m.Value = undefined; @memcpy(nodes[0..6], dto.actual_leaf.nodes);
    nodes[6] = .{ .gate = .{ .@"type" = dto.scalar, .inputs = &.{3}, .control = 2 } };
    nodes[7] = .{ .gate = .{ .@"type" = dto.undefined_type, .inputs = &.{4}, .control = 2 } }; break :blk nodes;
};
const actual_complete_heaps: [5]m.Heap = blk: { var heaps = dto.actual_leaf.heaps[0..5].*; heaps[3].store.values = &.{6}; heaps[4].receiver_action.operands = &.{7}; break :blk heaps; };
const actual_complete: m.Graph = blk: { var graph=dto.actual_leaf; graph.nodes=&actual_complete_nodes; graph.heaps=&actual_complete_heaps; graph.accesses=&.{.{ .values=&.{2}, .flag=.write, .control=2 }}; break :blk graph; };
const complete_contracts: [4]domain.PublicationContract = blk: {
    var rows = dto.contracts; rows[3].return_origins = actual_complete; rows[2].return_origins = complete_leaf; break :blk rows;
};
const Fixture = struct {
    program: wire.Program, sources: [1]tables.Source, types: [6]tables.CommonType, bindings: [8]storage.CommonBinding, abis: [4]storage.CommonAbi, functions: [4]wire.Function,
    fn init(self: *Fixture) void {
        self.sources=.{.{ .hash=@splat(0x10), .path="constructor-scoped-ref-dto.ts", .length=100 }};
        const base:tables.CommonType=.{ .id=@splat(0x11), .kind=.reference, .name="A", .native_code=0, .base=null, .element=null, .members=&.{}, .methods=null, .nominal_key=null, .runtime_key=null };
        self.types=.{base,base,base,base,base,base};self.types[1].id=@splat(0x22);self.types[1].name="B";self.types[2].id=@splat(0x33);self.types[2].kind=.scalar;self.types[2].name="i32";self.types[2].native_code=1;self.types[3].id=@splat(0x44);self.types[3].kind=.@"undefined";self.types[3].name="undefined";self.types[4].id=@splat(0x45);self.types[4].name="A-root";self.types[5].id=@splat(0x46);self.types[5].name="C-actual";
        self.bindings=.{
            .{ .id="c-receiver", .owner=.{ .receiver=@enumFromInt(0) }, .name="this", .@"type"=c_type, .writable=false, .origin=declaration, .carrier=cc, .scope=@enumFromInt(0), .declaration_kind=null },
            .{ .id="a-receiver", .owner=.{ .receiver=@enumFromInt(1) }, .name="this", .@"type"=a, .writable=false, .origin=declaration, .carrier=ac, .scope=@enumFromInt(1), .declaration_kind=null },
            .{ .id="b-receiver", .owner=.{ .receiver=@enumFromInt(2) }, .name="this", .@"type"=b, .writable=false, .origin=declaration, .carrier=bc, .scope=@enumFromInt(2), .declaration_kind=null },
            .{ .id="b-field", .owner=.{ .field=@enumFromInt(0) }, .name="value", .@"type"=actual_c, .writable=true, .origin=operation, .carrier=actual_cc, .scope=null, .declaration_kind=null },
            .{ .id="b-argument", .owner=.{ .param=@enumFromInt(2) }, .name="x", .@"type"=actual_c, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(2), .declaration_kind=.parameter },
            .{ .id="c-native-field", .owner=.{ .field=@enumFromInt(1) }, .name="native", .@"type"=scalar, .writable=true, .origin=operation, .carrier=sc, .scope=null, .declaration_kind=null },
            .{ .id="c-actual-receiver", .owner=.{ .receiver=@enumFromInt(3) }, .name="this", .@"type"=actual_c, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(3), .declaration_kind=null },
            .{ .id="b-forward-argument", .owner=.{ .param=@enumFromInt(1) }, .name="c", .@"type"=actual_c, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(1), .declaration_kind=.parameter },
        };
        const prototype:storage.CommonAbi=.{ .kind=.common, .function=@enumFromInt(0), .signature=@splat(0xaa), .parameters=&.{}, .argument_types=&.{}, .receiver=@enumFromInt(0), .construction=@enumFromInt(0), .receiver_frame=0, .lexical_environment=null, .physical_parameters=&.{cf}, .result=c_type, .result_carrier=cc, .source_plan=.{ .carriers=&.{ "receiver:"++dto.c, "receiver:"++dto.actual_c, dto.actual_c,payload,"receiver:"++dto.a,dto.a,payload,dto.c,payload }, .blocks=&caller_plan } };
        self.abis=.{prototype,prototype,prototype,prototype};
        self.abis[1].function=@enumFromInt(1);self.abis[1].signature=@splat(0xba);self.abis[1].receiver=@enumFromInt(1);self.abis[1].construction=@enumFromInt(1);self.abis[1].parameters=&.{@enumFromInt(7)};self.abis[1].argument_types=&.{actual_c};self.abis[1].physical_parameters=&.{af,actual_cc};self.abis[1].result=a;self.abis[1].result_carrier=ac;
        self.abis[1].source_plan=.{ .carriers=&.{"receiver:"++dto.a,"receiver:"++dto.b,dto.b,payload,dto.a,payload,dto.actual_c}, .blocks=&native_plan };
        self.abis[2].function=@enumFromInt(2);self.abis[2].signature=@splat(0xbb);self.abis[2].receiver=@enumFromInt(2);self.abis[2].construction=@enumFromInt(2);self.abis[2].parameters=&.{@enumFromInt(4)};self.abis[2].argument_types=&.{actual_c};self.abis[2].physical_parameters=&.{bf,actual_cc};self.abis[2].result=b;self.abis[2].result_carrier=bc;
        self.abis[2].source_plan=.{ .carriers=&.{"receiver:"++dto.b,dto.b,dto.b,payload,"initialization:"++dto.b,dto.actual_c,"initialization:"++dto.b,dto.undefined_type,dto.b,payload}, .blocks=&callee_plan };
        self.abis[3]=prototype;self.abis[3].function=@enumFromInt(3);self.abis[3].signature=@splat(0xbc);self.abis[3].receiver=@enumFromInt(6);self.abis[3].construction=@enumFromInt(3);self.abis[3].physical_parameters=&.{actual_cf};self.abis[3].result=actual_c;self.abis[3].result_carrier=actual_cc;
        self.abis[3].source_plan=.{ .carriers=&.{"receiver:"++dto.actual_c,dto.actual_c,dto.actual_c,payload,"initialization:"++dto.actual_c,dto.scalar,"initialization:"++dto.actual_c,dto.undefined_type,dto.actual_c,payload}, .blocks=&actual_plan };
        const function:wire.Function=.{ .id=@splat(0x55), .signature=@splat(0xaa), .abi=@enumFromInt(0), .source=@enumFromInt(0), .role=.construction_body, .declaration=.{ .start=0,.end=100 }, .name="C", .registers=&caller_registers,.blocks=&caller_blocks };
        self.functions=.{function,function,function,function};self.functions[1].id=@splat(0x65);self.functions[1].signature=@splat(0xba);self.functions[1].abi=@enumFromInt(1);self.functions[1].name="A";self.functions[1].registers=&native_registers;self.functions[1].blocks=&native_blocks;
        self.functions[2].id=@splat(0x66);self.functions[2].signature=@splat(0xbb);self.functions[2].abi=@enumFromInt(2);self.functions[2].name="B";self.functions[2].registers=&callee_registers;self.functions[2].blocks=&callee_blocks;
        self.functions[3]=function;self.functions[3].id=@splat(0x67);self.functions[3].signature=@splat(0xbc);self.functions[3].abi=@enumFromInt(3);self.functions[3].name="C-actual";self.functions[3].registers=&actual_registers;self.functions[3].blocks=&actual_blocks;
        var common=std.mem.zeroes(tables.CommonTables);common.types=&self.types;common.abis=&self.abis;common.storage.bindings=&self.bindings;common.storage.payload=.{ .byte_size=16,.alignment=8,.reference_count=1 };
        common.members.fields=&.{
            .{ .id=@splat(0x99),.owner=b,.ordinal=0,.name="value",.@"type"=actual_c,.declared_type=actual_c,.readonly=false,.optional=false,.access=.public,.origin=operation,.binding=@enumFromInt(3) },
            .{ .id=@splat(0x9a),.owner=actual_c,.ordinal=0,.name="native",.@"type"=scalar,.declared_type=scalar,.readonly=false,.optional=false,.access=.public,.origin=operation,.binding=@enumFromInt(5) },
        };
        common.members.constructions=&.{
            .{ .id=@splat(0x76),.owner=c_type,.function=@enumFromInt(0),.kind=.explicit,.origin=declaration,.parameters=&.{},.signature=.{.parameters=&.{},.return_type=c_type},.source_signature=.{.id=@splat(0xaa),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{},.access=.public },
            .{ .id=@splat(0x77),.owner=a,.function=@enumFromInt(1),.kind=.explicit,.origin=declaration,.parameters=&.{.{.binding=@enumFromInt(7),.inherited_from=null,.origin=declaration,.@"type"=actual_c}},.signature=.{.parameters=&.{actual_c},.return_type=a},.source_signature=.{.id=@splat(0xba),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{},.access=.public },
            .{ .id=@splat(0x88),.owner=b,.function=@enumFromInt(2),.kind=.explicit,.origin=declaration,.parameters=&.{.{.binding=@enumFromInt(4),.inherited_from=null,.origin=declaration,.@"type"=actual_c}},.signature=.{.parameters=&.{actual_c},.return_type=b},.source_signature=.{.id=@splat(0xbb),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{@enumFromInt(0)},.access=.public },
            .{ .id=@splat(0x89),.owner=actual_c,.function=@enumFromInt(3),.kind=.explicit,.origin=declaration,.parameters=&.{},.signature=.{.parameters=&.{},.return_type=actual_c},.source_signature=.{.id=@splat(0xbc),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{@enumFromInt(1)},.access=.public },
        };
        common.storage.concrete=&.{
            .{ .@"type"=a,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=0,.alignment=1,.reference_count=0,.fields=&.{}} },
            .{ .@"type"=b,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=8,.alignment=8,.reference_count=1,.fields=&.{.{.field=@enumFromInt(0),.binding=@enumFromInt(3),.offset=0,.reference_offset=0}}} },
            .{ .@"type"=scalar,.carrier=.{.layout=.{.byte_size=4,.alignment=4,.reference_count=0},.field_offsets=&.{}},.body=null },
            .{ .@"type"=undefined_type,.carrier=.{.layout=.{.byte_size=0,.alignment=1,.reference_count=0},.field_offsets=&.{}},.body=null },
            .{ .@"type"=c_type,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=0,.alignment=1,.reference_count=0,.fields=&.{}} },
            .{ .@"type"=actual_c,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=4,.alignment=4,.reference_count=0,.fields=&.{.{.field=@enumFromInt(1),.binding=@enumFromInt(5),.offset=0,.reference_offset=0}}} },
        };
        common.exceptions.scopes=&.{.{.owner=@enumFromInt(0),.path=&.{"function"}},.{.owner=@enumFromInt(1),.path=&.{"function"}},.{.owner=@enumFromInt(2),.path=&.{"function"}},.{.owner=@enumFromInt(3),.path=&.{"function"}}};
        common.exceptions.bindings=&.{.{.binding=@enumFromInt(0),.scope=@enumFromInt(0)},.{.binding=@enumFromInt(1),.scope=@enumFromInt(1)},.{.binding=@enumFromInt(2),.scope=@enumFromInt(2)},.{.binding=@enumFromInt(4),.scope=@enumFromInt(2)},.{.binding=@enumFromInt(6),.scope=@enumFromInt(3)},.{.binding=@enumFromInt(7),.scope=@enumFromInt(1)}};
        common.exceptions.functions=&.{.{.function=@enumFromInt(0),.handlers=&.{}},.{.function=@enumFromInt(1),.handlers=&.{}},.{.function=@enumFromInt(2),.handlers=&.{}},.{.function=@enumFromInt(3),.handlers=&.{}}};
        common.authority.fixed_publication=std.mem.zeroes(publication.FixedPublication);common.authority.fixed_publication.stable_scope.functions=&dto.declarations;common.authority.fixed_publication.publication.contracts=&complete_contracts;
        self.program=.{.envelope=std.mem.zeroes(wire.Envelope),.target=std.mem.zeroes(wire.Target),.input_identity=@splat(0),.source_hash=@splat(0),.source_path="",.source_length=0,.root_source=@enumFromInt(0),.tables=.{.sources=&self.sources,.mode=.{.common=common}},.functions=&self.functions};
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
    .{ .type_id = dto.actual_c, .fields = &.{.{ .id = dto.native_field, .view = dto.actual_c, .physical = 0, .type_id = dto.scalar }} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.actual_c }} },
};
fn ownerRows(contracts: *const [4]domain.PublicationContract) [4]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
test "typed A new C forwards original Ref through B parameter to new D and returns actual D" {
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
        .{ .function_id = dto.native_callee, .graph = &dto.native_leaf, .complete = &input.fixed[1] },
        .{ .function_id = dto.callee, .graph = &complete_leaf, .complete = &input.fixed[2] },
        .{ .function_id = dto.final_callee, .graph = &actual_complete, .complete = &input.fixed[3] },
    };
    for (input.fixed) |fixed| {
        const check=try m.validateGraph(c.allocator,&dto.directory,fixed.function_id,&fixed.contract.return_origins.?,&budget);
        try std.testing.expect(check==.pending and check.pending==.construction_frame);
    }
    var receiver = try domain.analyzeReturns(c.allocator, &dto.directory, graph, &budget, input); defer receiver.deinit();
    const coverage = try certificates.covered(c.allocator, &dto.directory, dto.caller, graph, &certificates_rows, &budget);
    if (receiver.pending) |reason| std.debug.print("scoped-ref direct.pending={s} coverage={s}\n", .{ @tagName(reason), @tagName(coverage) });
    try std.testing.expect(coverage == .covered);
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    try std.testing.expect(receiver.normal_live and !receiver.language_live);
    try std.testing.expectEqual(@as(usize, 2), receiver.calls.len);
    const first = receiver.calls[0]; const fact = receiver.calls[1];
    const c_birth = try rootValue(graph, graph.calls[0].receiver.?[0]);
    try std.testing.expectEqual(c_birth, first.receiver);
    try std.testing.expect(first.analysis.calls.len == 0 and fact.analysis.calls.len == 1);
    const inner = fact.analysis.calls[0];
    try std.testing.expect(fact.caller_graph == graph and fact.graph == &complete_contracts[1].return_origins.?);
    try std.testing.expect(inner.caller_graph == fact.graph and inner.graph == &complete_contracts[2].return_origins.?);
    try std.testing.expectEqualStrings(dto.a, dto.directory.functions[1].return_type);
    try std.testing.expectEqualStrings(dto.a, fact.graph.nodes[4].receiver_value.@"type".?);
    try std.testing.expectEqual(@as(usize, 1), fact.arguments[1].len);
    try std.testing.expect(fact.arguments[1][0].source == .allocation and fact.arguments[1][0].source.allocation == c_birth);
    try std.testing.expectEqual(@as(usize, 1), inner.arguments[1].len);
    const parameter = inner.arguments[1][0];
    try std.testing.expect(parameter.source == .node and inner.caller_graph.nodes[parameter.source.node] == .parameter);
    try std.testing.expectEqual(@as(usize, 1), inner.caller_graph.nodes[parameter.source.node].parameter.index);
    const d_birth = inner.receiver;
    try std.testing.expectEqual(@as(usize, 1), receiver.normal.len);
    const birth = receiver.normal[0].source.scoped_allocation;
    try std.testing.expect(birth.analysis == fact.analysis and birth.frame == d_birth and birth.completion == .normal);
    try std.testing.expectEqualStrings(dto.b, birth.analysis.frames[birth.frame].new_target.?);
    try std.testing.expectEqualStrings(dto.actual_c, receiver.frames[c_birth].new_target.?);
    const rows = ownerRows(&complete_contracts);
    var result = try owners.analyzeReceiver(c.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &receiver); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    const value = result.normal[0]; const location = result.locations[value];
    try std.testing.expect(location.kind == .root and location.owner == .local);
    try std.testing.expectEqualStrings(dto.b, location.type_id.?);
    try std.testing.expectEqual(d_birth, location.node);
    try std.testing.expectEqual(@as(usize, 2), result.normal_payloads.len);
    var d_payload: ?owners.Payload = null; var c_payload: ?owners.Payload = null;
    for (result.normal_payloads) |row| { if (std.mem.eql(u8,row.type_id,dto.b)) d_payload=row; if (std.mem.eql(u8,row.type_id,dto.actual_c)) c_payload=row; }
    try std.testing.expect(d_payload != null and c_payload != null);
    try std.testing.expectEqual(value, d_payload.?.location);
    const slot = d_payload.?.slots[0]; try std.testing.expectEqualStrings("field:" ++ dto.field, slot.selector);
    try std.testing.expectEqual(@as(usize, 1), slot.values.len);
    const original = slot.values[0]; const original_location = result.locations[original];
    try std.testing.expectEqual(c_payload.?.location, original);
    try std.testing.expect(original != value and original_location.kind == .root and original_location.owner == .local);
    try std.testing.expectEqual(@as(usize, 0), original_location.scope);
    try std.testing.expectEqual(c_birth, original_location.node);
    try std.testing.expectEqualStrings(dto.actual_c, original_location.type_id.?);
    var native_seen = false; var reference_seen = false;
    for (result.normal_heap) |address| {
        if (address.base == original and std.mem.eql(u8,address.selector,"field:" ++ dto.native_field)) {
            native_seen = true; try std.testing.expectEqualStrings(dto.actual_c,address.view);
            try std.testing.expectEqual(@as(usize, 1),address.values.items.len);
            const native = result.locations[address.values.items[0]];
            try std.testing.expect(native.owner == .nonowning); try std.testing.expectEqualStrings(dto.scalar,native.type_id.?);
        }
        if (address.base == value and std.mem.eql(u8,address.selector,"field:" ++ dto.field)) { reference_seen = true; try std.testing.expectEqualSlices(usize,&.{original},address.values.items); }
    }
    try std.testing.expect(native_seen and reference_seen);
    try std.testing.expectEqual(@as(usize, 0),result.effects.len);
}
