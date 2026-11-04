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
const p = publication;
const dto = struct {
// SPDX-License-Identifier: MIT
// Independent literal interpretation DTOs, not a Source publication or identity
// receipt. Hashes are opaque row names. Full rows below are metadata premises;
// these tests do not assert scope/digest/Source admission or actual entrances.
pub const a = "sha256:" ++ "11" ** 32;
pub const b = "sha256:" ++ "22" ** 32;
pub const scalar = "sha256:" ++ "33" ** 32;
pub const undefined_type = "sha256:" ++ "44" ** 32;
pub const c = "sha256:" ++ "45" ** 32;
pub const actual_c = "sha256:" ++ "46" ** 32;
pub const boolean = "sha256:" ++ "47" ** 32;
pub const final_callee = "sha256:" ++ "67" ** 32;
pub const final_role = "sha256:" ++ "89" ** 32;
pub const native_callee = "sha256:" ++ "65" ** 32;
pub const role_c = "sha256:" ++ "76" ** 32;
pub const caller = "sha256:" ++ "55" ** 32;
pub const callee = "sha256:" ++ "66" ** 32;
pub const role_a = "sha256:" ++ "77" ** 32;
pub const role_b = "sha256:" ++ "88" ** 32;
pub const field = "sha256:" ++ "99" ** 32;
pub const native_field = "sha256:" ++ "9a" ** 32;
pub const directory: m.Directory = .{
    .types = &.{ .{ .id = a, .kind = .reference }, .{ .id = b, .kind = .reference }, .{ .id = scalar, .kind = .scalar }, .{ .id = undefined_type, .kind = .@"undefined" }, .{ .id = c, .kind = .reference }, .{ .id = actual_c, .kind = .reference }, .{ .id = boolean, .kind = .scalar } },
    .functions = &.{
        .{ .id = caller, .kind = .construction_body, .parameter_types = &.{ c, boolean }, .return_type = c, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_c, .owner = c, .base = null, .receiver_index = 0 } },
        .{ .id = native_callee, .kind = .construction_body, .parameter_types = &.{ a, actual_c }, .return_type = a, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_a, .owner = a, .base = null, .receiver_index = 0 } },
        .{ .id = callee, .kind = .construction_body, .parameter_types = &.{ b, actual_c }, .return_type = b, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_b, .owner = b, .base = null, .receiver_index = 0 } },
        .{ .id = final_callee, .kind = .construction_body, .parameter_types = &.{actual_c}, .return_type = actual_c, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = final_role, .owner = actual_c, .base = null, .receiver_index = 0 } },
    },
    .constructions = &.{ .{ .id = role_c, .owner = c, .base = null, .kind = .explicit, .function_id = caller }, .{ .id = role_a, .owner = a, .base = null, .kind = .explicit, .function_id = native_callee }, .{ .id = role_b, .owner = b, .base = null, .kind = .explicit, .function_id = callee }, .{ .id = final_role, .owner = actual_c, .base = null, .kind = .explicit, .function_id = final_callee } },
    .fields = &.{ field, native_field }, .globals = &.{}, .environments = &.{},
};
pub const leaf: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_value = .{ .@"type" = b, .action = 1 } }, .{ .receiver_value = .{ .@"type" = b, .action = 2 } },
        .{ .parameter = .{ .@"type" = actual_c, .index = 1 } }, .{ .literal = .{ .@"type" = undefined_type, .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = b, .action = 4 } },
    },
    .heaps = &.{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .store = .{ .previous = 2, .bases = &.{2}, .selector = "field:" ++ field, .view = b, .values = &.{3}, .control = 2, .initialize = true } },
        .{ .receiver_action = .{ .previous = 3, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{4}, .completion = .normal } },
    },
    .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 4 } } },
    .calls = &.{}, .normal = &.{5}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 4, .control = 3 }}, .language = &.{} }, .accesses = &.{},
};
pub const actual_leaf: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_value = .{ .@"type" = actual_c, .action = 1 } }, .{ .receiver_value = .{ .@"type" = actual_c, .action = 2 } },
        .{ .literal = .{ .@"type" = scalar, .category = .other } }, .{ .literal = .{ .@"type" = undefined_type, .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = actual_c, .action = 4 } },
    },
    .heaps = &.{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
        .{ .store = .{ .previous = 2, .bases = &.{2}, .selector = "field:" ++ native_field, .view = actual_c, .values = &.{3}, .control = 2, .initialize = true } },
        .{ .receiver_action = .{ .previous = 3, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{4}, .completion = .normal } },
    },
    .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 4 } } },
    .calls = &.{}, .normal = &.{5}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 4, .control = 3 }}, .language = &.{} }, .accesses = &.{},
};
pub const native_leaf: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_frame = .{ .construction = role_b, .new_target = b, .parent = null, .site = "B:new-D", .control = 0 } },
        .{ .call = .{ .@"type" = b, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .receiver_value = .{ .@"type" = a, .action = 3 } }, .{ .receiver_value = .{ .@"type" = null, .action = 4 } },
        .{ .parameter = .{ .@"type" = actual_c, .index = 1 } },
    },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } },
    },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } }, .{ .receiver_completion = .{ .action = 3 } }, .{ .receiver_completion = .{ .action = 4 } } },
    .calls = &.{.{ .function_id = callee, .arguments = &.{&.{6}}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "B:construct-D" }},
    .normal = &.{4}, .language = &.{3,5}, .exits = .{ .normal = &.{.{ .heap = 3, .control = 3 }}, .language = &.{.{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }} }, .accesses = &.{},
};
pub const caller_graph: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_frame = .{ .construction = final_role, .new_target = actual_c, .parent = null, .site = "A:new-C", .control = 0 } },
        .{ .call = .{ .@"type" = actual_c, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .receiver_frame = .{ .construction = role_a, .new_target = a, .parent = null, .site = "A:new-B", .control = 1 } },
        .{ .call = .{ .@"type" = a, .call = 1, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } },
        .{ .receiver_value = .{ .@"type" = c, .action = 5 } }, .{ .receiver_value = .{ .@"type" = null, .action = 6 } },
    },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } },
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .language } },
    },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } },
        .{ .receiver_completion = .{ .action = 5 } }, .{ .receiver_completion = .{ .action = 6 } } },
    .calls = &.{
        .{ .function_id = final_callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "A:construct-C" },
        .{ .function_id = native_callee, .arguments = &.{&.{2}}, .environment = null, .callee = null, .receiver = &.{4}, .heap = 1, .control = 1, .site = "A:construct-B" },
    },
    .normal = &.{7}, .language = &.{ 3, 6, 8 }, .exits = .{ .normal = &.{.{ .heap = 5, .control = 5 }}, .language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 } } }, .accesses = &.{},
};
const ScopeFunction = @typeInfo(@FieldType(p.StableScope, "functions")).pointer.child;
const Contract = @typeInfo(@FieldType(p.Publication, "contracts")).pointer.child;
pub const declarations = [_]ScopeFunction{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "A-root", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x45), @splat(0x47) }, .return_type = @splat(0x45), .construction = .{ .id = @splat(0x76), .owner = @splat(0x45), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "B-forward", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x11), @splat(0x46) }, .return_type = @splat(0x11), .construction = .{ .id = @splat(0x77), .owner = @splat(0x11), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "D-leaf", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x22), @splat(0x46) }, .return_type = @splat(0x22), .construction = .{ .id = @splat(0x88), .owner = @splat(0x22), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "C-actual", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x46)}, .return_type = @splat(0x46), .construction = .{ .id = @splat(0x89), .owner = @splat(0x46), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
};
pub const full: p.EffectUpper = .{
    .parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = true, .@"await" = false, .eh_control = true, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
};
pub const scalar_full: p.EffectUpper = blk: { var upper = full; upper.parameters = &.{ .{ .index = 0, .read = false, .write = true, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } }; break :blk upper; };
pub const root_full: p.EffectUpper = blk: { var upper = full; upper.parameters = &.{ .{ .index = 0, .read = false, .write = true, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } }; break :blk upper; };
pub const contracts = [_]Contract{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .upper = root_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = caller_graph, .digest = @splat(0xdc) },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .upper = scalar_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = native_leaf, .digest = @splat(0xdd) },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .upper = scalar_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = leaf, .digest = @splat(0xed) },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = actual_leaf, .digest = @splat(0xde) },
};
};
const t = wire.types;
const ins = wire.instruction;
const a_type: t.TypeRef = @enumFromInt(0);
const b_type: t.TypeRef = @enumFromInt(1);
const scalar_type: t.TypeRef = @enumFromInt(2);
const actual_c_type: t.TypeRef = @enumFromInt(5);
const actual_cc: t.Carrier = .{ .@"type" = actual_c_type };
const actual_cf: t.Carrier = .{ .receiver = @enumFromInt(3) };
const actual_token: t.Carrier = .{ .initialization = @enumFromInt(3) };
const c_type: t.TypeRef = @enumFromInt(4);
const cc: t.Carrier = .{ .@"type" = c_type };
const cf: t.Carrier = .{ .receiver = @enumFromInt(0) };
const undefined_value_type: t.TypeRef = @enumFromInt(3);
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
const ac: t.Carrier = .{ .@"type" = a_type };
const bc: t.Carrier = .{ .@"type" = b_type };
const sc: t.Carrier = .{ .@"type" = scalar_type };
const uc: t.Carrier = .{ .@"type" = undefined_value_type };
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
const bool_type: t.TypeRef = @enumFromInt(6);
const bool_carrier: t.Carrier = .{ .@"type" = bool_type };
const caller_registers = [_]wire.Register{
    .{ .carrier = cf, .view = null }, .{ .carrier = actual_cf, .view = null }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = .payload, .view = null },
    .{ .carrier = af, .view = null }, .{ .carrier = ac, .view = a_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = cc, .view = c_type }, .{ .carrier = .payload, .view = null },
    .{ .carrier = actual_cf, .view = null }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = bool_carrier, .view = bool_type },
};
const caller_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = null, .operands = &.{r13}, .data = .{ .cond_br = .{ .true_destination = @enumFromInt(1), .false_destination = @enumFromInt(2), .true_count = 0 } } },
    .{ .source = operation, .result = r1, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(3), .new_target = actual_c_type } } },
    .{ .source = operation, .result = null, .operands = &.{r1}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(3), .normal = @enumFromInt(3), .exceptional = @enumFromInt(4) } } },
    .{ .source = operation, .result = r9, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(3), .new_target = actual_c_type } } },
    .{ .source = operation, .result = null, .operands = &.{r9}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(3), .normal = @enumFromInt(5), .exceptional = @enumFromInt(6) } } },
    .{ .source = operation, .result = null, .operands = &.{r2}, .data = .{ .br = .{ .destination = @enumFromInt(7) } } },
    .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r10}, .data = .{ .br = .{ .destination = @enumFromInt(7) } } },
    .{ .source = operation, .result = null, .operands = &.{r11}, .data = .eh_raise },
    .{ .source = operation, .result = r4, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(1), .new_target = a_type } } },
    .{ .source = operation, .result = null, .operands = &.{ r4, r12 }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(8), .exceptional = @enumFromInt(9) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r5 }, .data = .{ .receiver_result = .{ .construction = @enumFromInt(0), .normal = @enumFromInt(10), .language = @enumFromInt(11) } } },
    .{ .source = operation, .result = null, .operands = &.{r6}, .data = .eh_raise },
    .{ .source = operation, .result = null, .operands = &.{r7}, .data = .@"return" },
    .{ .source = operation, .result = null, .operands = &.{r8}, .data = .eh_raise },
};
const caller_blocks = [_]wire.Block{
    .{ .parameters = &.{ r0, r13 }, .instructions = caller_instructions[0..2] },
    .{ .parameters = &.{}, .instructions = caller_instructions[2..4] },
    .{ .parameters = &.{}, .instructions = caller_instructions[4..6] },
    .{ .parameters = &.{r2}, .instructions = caller_instructions[6..7] },
    .{ .parameters = &.{r3}, .instructions = caller_instructions[7..8] },
    .{ .parameters = &.{r10}, .instructions = caller_instructions[8..9] },
    .{ .parameters = &.{r11}, .instructions = caller_instructions[9..10] },
    .{ .parameters = &.{r12}, .instructions = caller_instructions[10..12] },
    .{ .parameters = &.{r5}, .instructions = caller_instructions[12..13] },
    .{ .parameters = &.{r6}, .instructions = caller_instructions[13..14] },
    .{ .parameters = &.{r7}, .instructions = caller_instructions[14..15] },
    .{ .parameters = &.{r8}, .instructions = caller_instructions[15..16] },
};
const caller_operations = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
    .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .result = null, .operands = &.{r13}, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.actual_c, .properties = &native_create_properties, .result = r1, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &native_invoke_properties, .result = null, .operands = &.{r1}, .successors = &.{ @enumFromInt(3), @enumFromInt(4) }, .source = operation },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.actual_c, .properties = &native_create_properties, .result = r9, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &native_invoke_properties, .result = null, .operands = &.{r9}, .successors = &.{ @enumFromInt(5), @enumFromInt(6) }, .source = operation },
    .{ .name = "cf.br", .view = "", .properties = &.{}, .result = null, .operands = &.{r2}, .successors = &.{@enumFromInt(7)}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
    .{ .name = "cf.br", .view = "", .properties = &.{}, .result = null, .operands = &.{r10}, .successors = &.{@enumFromInt(7)}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r11}, .successors = &.{}, .source = operation },
    .{ .name = "receiver_create", .view = "receiver:" ++ dto.a, .properties = &create_a_properties, .result = r4, .operands = &.{}, .successors = &.{}, .source = operation },
    .{ .name = "invoke", .view = "void", .properties = &invoke_a_properties, .result = null, .operands = &.{ r4, r12 }, .successors = &.{ @enumFromInt(8), @enumFromInt(9) }, .source = operation },
    .{ .name = "receiver_result", .view = "void", .properties = &c_properties, .result = null, .operands = &.{ r0, r5 }, .successors = &.{ @enumFromInt(10), @enumFromInt(11) }, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r6}, .successors = &.{}, .source = operation },
    .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r7}, .successors = &.{}, .source = operation },
    .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r8}, .successors = &.{}, .source = operation },
};
const caller_plan = [_]control.SourcePlanBlock{
    .{ .parameters = &.{ r0, r13 }, .operations = caller_operations[0..2] },
    .{ .parameters = &.{}, .operations = caller_operations[2..4] },
    .{ .parameters = &.{}, .operations = caller_operations[4..6] },
    .{ .parameters = &.{r2}, .operations = caller_operations[6..7] },
    .{ .parameters = &.{r3}, .operations = caller_operations[7..8] },
    .{ .parameters = &.{r10}, .operations = caller_operations[8..9] },
    .{ .parameters = &.{r11}, .operations = caller_operations[9..10] },
    .{ .parameters = &.{r12}, .operations = caller_operations[10..12] },
    .{ .parameters = &.{r5}, .operations = caller_operations[12..13] },
    .{ .parameters = &.{r6}, .operations = caller_operations[13..14] },
    .{ .parameters = &.{r7}, .operations = caller_operations[14..15] },
    .{ .parameters = &.{r8}, .operations = caller_operations[15..16] },
};
const callee_registers = [_]wire.Register{
    .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b_type }, .{ .carrier = bc, .view = b_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = token, .view = null },
    .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = token, .view = null }, .{ .carrier = uc, .view = undefined_value_type }, .{ .carrier = bc, .view = b_type }, .{ .carrier = .payload, .view = null },
};
const callee_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .receiver_allocate = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .receiver_bind = .{ .construction = @enumFromInt(2), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{ r0, r2 }, .data = .{ .initialize_begin = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = r6, .operands = &.{ r4, r2, r5 }, .data = .{ .initialize_field = .{ .construction = @enumFromInt(2), .field = @enumFromInt(0) } } },
    .{ .source = operation, .result = null, .operands = &.{ r6, r2 }, .data = .{ .initialize_end = .{ .construction = @enumFromInt(2) } } },
    .{ .source = operation, .result = r7, .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = undefined_value_type } } },
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
    .{ .carrier = af, .view = null }, .{ .carrier = bf, .view = null }, .{ .carrier = bc, .view = b_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = ac, .view = a_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = actual_cc, .view = actual_c_type },
};
const native_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{}, .data = .{ .receiver_create = .{ .construction = @enumFromInt(2), .new_target = b_type } } },
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
    .{ .carrier = actual_cf, .view = null }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = .payload, .view = null }, .{ .carrier = actual_token, .view = null },
    .{ .carrier = sc, .view = scalar_type }, .{ .carrier = actual_token, .view = null }, .{ .carrier = uc, .view = undefined_value_type }, .{ .carrier = actual_cc, .view = actual_c_type }, .{ .carrier = .payload, .view = null },
};
const actual_instructions = [_]ins.Instruction{
    .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .receiver_allocate = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .receiver_bind = .{ .construction = @enumFromInt(3), .normal = @enumFromInt(1), .language = @enumFromInt(2) } } },
    .{ .source = operation, .result = r4, .operands = &.{ r0, r2 }, .data = .{ .initialize_begin = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = r5, .operands = &.{}, .data = .{ .const_i32 = 7 } },
    .{ .source = operation, .result = r6, .operands = &.{ r4, r2, r5 }, .data = .{ .initialize_field = .{ .construction = @enumFromInt(3), .field = @enumFromInt(1) } } },
    .{ .source = operation, .result = null, .operands = &.{ r6, r2 }, .data = .{ .initialize_end = .{ .construction = @enumFromInt(3) } } },
    .{ .source = operation, .result = r7, .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = undefined_value_type } } },
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
// A heap join represents the two incoming histories. C1 and C2 each allocate
// and initialize only on their own predecessor; neither is common-born.
const conditional: m.Graph = .{
    .nodes = &.{
        .receiver_input, // 0: A receiver control only
        .{ .receiver_frame = .{ .construction = dto.final_role, .new_target = dto.actual_c, .parent = null, .site = "conditional:C1", .control = 0 } }, // 1
        .{ .call = .{ .@"type" = dto.actual_c, .call = 0, .completion = .normal } }, // 2
        .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } }, // 3
        .{ .receiver_frame = .{ .construction = dto.role_a, .new_target = dto.a, .parent = null, .site = "conditional:B", .control = 9 } }, // 4
        .{ .call = .{ .@"type" = dto.a, .call = 1, .completion = .normal } }, // 5
        .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } }, // 6
        .{ .receiver_value = .{ .@"type" = dto.c, .action = 5 } }, // 7
        .{ .receiver_value = .{ .@"type" = null, .action = 6 } }, // 8
        .{ .receiver_frame = .{ .construction = dto.final_role, .new_target = dto.actual_c, .parent = null, .site = "conditional:C2", .control = 0 } }, // 9
        .{ .call = .{ .@"type" = dto.actual_c, .call = 2, .completion = .normal } }, // 10
        .{ .call = .{ .@"type" = null, .call = 2, .completion = .language } }, // 11
        .{ .join = .{ .@"type" = dto.actual_c, .inputs = &.{ 2, 13 } } }, // 12: original complete Ref union
        .{ .gate = .{ .@"type" = dto.actual_c, .inputs = &.{10}, .control = 7 } }, // 13: postposed late identity
        .{ .parameter = .{ .@"type" = dto.boolean, .index = 1 } }, // 14: original bool formal remains a core even when only used by cond_br
    },
    .heaps = &.{
        .entry, // 0
        .{ .call = .{ .call = 0, .completion = .normal } }, // 1: C1 own predecessor
        .{ .call = .{ .call = 0, .completion = .language } }, // 2
        .{ .call = .{ .call = 1, .completion = .normal } }, // 3
        .{ .call = .{ .call = 1, .completion = .language } }, // 4
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .normal } }, // 5
        .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .language } }, // 6
        .{ .call = .{ .call = 2, .completion = .normal } }, // 7: C2 own predecessor
        .{ .call = .{ .call = 2, .completion = .language } }, // 8
        .{ .join = .{ .inputs = &.{ 1, 7 } } }, // 9: do not replace with common-born heap7
    },
    .controls = &.{
        .entry, // 0
        .{ .call = .{ .call = 0, .completion = .normal } }, // 1
        .{ .call = .{ .call = 0, .completion = .language } }, // 2
        .{ .call = .{ .call = 1, .completion = .normal } }, // 3
        .{ .call = .{ .call = 1, .completion = .language } }, // 4
        .{ .receiver_completion = .{ .action = 5 } }, // 5
        .{ .receiver_completion = .{ .action = 6 } }, // 6
        .{ .call = .{ .call = 2, .completion = .normal } }, // 7
        .{ .call = .{ .call = 2, .completion = .language } }, // 8
        .{ .join = .{ .inputs = &.{ 1, 7 } } }, // 9
    },
    .calls = &.{
        .{ .function_id = dto.final_callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "conditional:construct-C1" },
        .{ .function_id = dto.native_callee, .arguments = &.{&.{12}}, .environment = null, .callee = null, .receiver = &.{4}, .heap = 9, .control = 9, .site = "conditional:construct-B" },
        .{ .function_id = dto.final_callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{9}, .heap = 0, .control = 0, .site = "conditional:construct-C2" },
    },
    .normal = &.{7}, .language = &.{ 3, 6, 8, 11 },
    .exits = .{
        .normal = &.{.{ .heap = 5, .control = 5 }},
        .language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 }, .{ .heap = 8, .control = 8 } },
    },
    .accesses = &.{},
};

const complete_contracts: [4]domain.PublicationContract = blk: {
    var rows = dto.contracts; rows[0].return_origins = conditional; rows[3].return_origins = actual_complete; rows[2].return_origins = complete_leaf; break :blk rows;
};
const Fixture = struct {
    program: wire.Program, sources: [1]tables.Source, types: [7]tables.CommonType, bindings: [9]storage.CommonBinding, abis: [4]storage.CommonAbi, functions: [4]wire.Function,
    fn init(self: *Fixture) void {
        self.sources=.{.{ .hash=@splat(0x10), .path="constructor-scoped-ref-dto.ts", .length=100 }};
        const base:tables.CommonType=.{ .id=@splat(0x11), .kind=.reference, .name="A", .native_code=0, .base=null, .element=null, .members=&.{}, .methods=null, .nominal_key=null, .runtime_key=null };
        self.types=.{base,base,base,base,base,base,base};self.types[1].id=@splat(0x22);self.types[1].name="B";self.types[2].id=@splat(0x33);self.types[2].kind=.scalar;self.types[2].name="i32";self.types[2].native_code=1;self.types[3].id=@splat(0x44);self.types[3].kind=.@"undefined";self.types[3].name="undefined";self.types[4].id=@splat(0x45);self.types[4].name="A-root";self.types[5].id=@splat(0x46);self.types[5].name="C-actual";self.types[6].id=@splat(0x47);self.types[6].kind=.scalar;self.types[6].name="bool";self.types[6].native_code=2;
        self.bindings=.{
            .{ .id="c-receiver", .owner=.{ .receiver=@enumFromInt(0) }, .name="this", .@"type"=c_type, .writable=false, .origin=declaration, .carrier=cc, .scope=@enumFromInt(0), .declaration_kind=null },
            .{ .id="a-receiver", .owner=.{ .receiver=@enumFromInt(1) }, .name="this", .@"type"=a_type, .writable=false, .origin=declaration, .carrier=ac, .scope=@enumFromInt(1), .declaration_kind=null },
            .{ .id="b-receiver", .owner=.{ .receiver=@enumFromInt(2) }, .name="this", .@"type"=b_type, .writable=false, .origin=declaration, .carrier=bc, .scope=@enumFromInt(2), .declaration_kind=null },
            .{ .id="b-field", .owner=.{ .field=@enumFromInt(0) }, .name="value", .@"type"=actual_c_type, .writable=true, .origin=operation, .carrier=actual_cc, .scope=null, .declaration_kind=null },
            .{ .id="b-argument", .owner=.{ .param=@enumFromInt(2) }, .name="x", .@"type"=actual_c_type, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(2), .declaration_kind=.parameter },
            .{ .id="c-native-field", .owner=.{ .field=@enumFromInt(1) }, .name="native", .@"type"=scalar_type, .writable=true, .origin=operation, .carrier=sc, .scope=null, .declaration_kind=null },
            .{ .id="c-actual-receiver", .owner=.{ .receiver=@enumFromInt(3) }, .name="this", .@"type"=actual_c_type, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(3), .declaration_kind=null },
            .{ .id="b-forward-argument", .owner=.{ .param=@enumFromInt(1) }, .name="c", .@"type"=actual_c_type, .writable=false, .origin=declaration, .carrier=actual_cc, .scope=@enumFromInt(1), .declaration_kind=.parameter },
            .{ .id="root-condition", .owner=.{ .param=@enumFromInt(0) }, .name="condition", .@"type"=bool_type, .writable=false, .origin=declaration, .carrier=bool_carrier, .scope=@enumFromInt(0), .declaration_kind=.parameter },
        };
        const prototype:storage.CommonAbi=.{ .kind=.common, .function=@enumFromInt(0), .signature=@splat(0xaa), .parameters=&.{@enumFromInt(8)}, .argument_types=&.{bool_type}, .receiver=@enumFromInt(0), .construction=@enumFromInt(0), .receiver_frame=0, .lexical_environment=null, .physical_parameters=&.{cf,bool_carrier}, .result=c_type, .result_carrier=cc, .source_plan=.{ .carriers=&.{ "receiver:"++dto.c, "receiver:"++dto.actual_c, dto.actual_c,payload,"receiver:"++dto.a,dto.a,payload,dto.c,payload,"receiver:"++dto.actual_c,dto.actual_c,payload,dto.actual_c,dto.boolean }, .blocks=&caller_plan } };
        self.abis=.{prototype,prototype,prototype,prototype};
        self.abis[1].function=@enumFromInt(1);self.abis[1].signature=@splat(0xba);self.abis[1].receiver=@enumFromInt(1);self.abis[1].construction=@enumFromInt(1);self.abis[1].parameters=&.{@enumFromInt(7)};self.abis[1].argument_types=&.{actual_c_type};self.abis[1].physical_parameters=&.{af,actual_cc};self.abis[1].result=a_type;self.abis[1].result_carrier=ac;
        self.abis[1].source_plan=.{ .carriers=&.{"receiver:"++dto.a,"receiver:"++dto.b,dto.b,payload,dto.a,payload,dto.actual_c}, .blocks=&native_plan };
        self.abis[2].function=@enumFromInt(2);self.abis[2].signature=@splat(0xbb);self.abis[2].receiver=@enumFromInt(2);self.abis[2].construction=@enumFromInt(2);self.abis[2].parameters=&.{@enumFromInt(4)};self.abis[2].argument_types=&.{actual_c_type};self.abis[2].physical_parameters=&.{bf,actual_cc};self.abis[2].result=b_type;self.abis[2].result_carrier=bc;
        self.abis[2].source_plan=.{ .carriers=&.{"receiver:"++dto.b,dto.b,dto.b,payload,"initialization:"++dto.b,dto.actual_c,"initialization:"++dto.b,dto.undefined_type,dto.b,payload}, .blocks=&callee_plan };
        self.abis[3]=prototype;self.abis[3].function=@enumFromInt(3);self.abis[3].signature=@splat(0xbc);self.abis[3].receiver=@enumFromInt(6);self.abis[3].construction=@enumFromInt(3);self.abis[3].parameters=&.{};self.abis[3].argument_types=&.{};self.abis[3].physical_parameters=&.{actual_cf};self.abis[3].result=actual_c_type;self.abis[3].result_carrier=actual_cc;
        self.abis[3].source_plan=.{ .carriers=&.{"receiver:"++dto.actual_c,dto.actual_c,dto.actual_c,payload,"initialization:"++dto.actual_c,dto.scalar,"initialization:"++dto.actual_c,dto.undefined_type,dto.actual_c,payload}, .blocks=&actual_plan };
        const function:wire.Function=.{ .id=@splat(0x55), .signature=@splat(0xaa), .abi=@enumFromInt(0), .source=@enumFromInt(0), .role=.construction_body, .declaration=.{ .start=0,.end=100 }, .name="C", .registers=&caller_registers,.blocks=&caller_blocks };
        self.functions=.{function,function,function,function};self.functions[1].id=@splat(0x65);self.functions[1].signature=@splat(0xba);self.functions[1].abi=@enumFromInt(1);self.functions[1].name="A";self.functions[1].registers=&native_registers;self.functions[1].blocks=&native_blocks;
        self.functions[2].id=@splat(0x66);self.functions[2].signature=@splat(0xbb);self.functions[2].abi=@enumFromInt(2);self.functions[2].name="B";self.functions[2].registers=&callee_registers;self.functions[2].blocks=&callee_blocks;
        self.functions[3]=function;self.functions[3].id=@splat(0x67);self.functions[3].signature=@splat(0xbc);self.functions[3].abi=@enumFromInt(3);self.functions[3].name="C-actual";self.functions[3].registers=&actual_registers;self.functions[3].blocks=&actual_blocks;
        var common=std.mem.zeroes(tables.CommonTables);common.types=&self.types;common.abis=&self.abis;common.storage.bindings=&self.bindings;common.storage.payload=.{ .byte_size=16,.alignment=8,.reference_count=1 };
        common.members.fields=&.{
            .{ .id=@splat(0x99),.owner=b_type,.ordinal=0,.name="value",.@"type"=actual_c_type,.declared_type=actual_c_type,.readonly=false,.optional=false,.access=.public,.origin=operation,.binding=@enumFromInt(3) },
            .{ .id=@splat(0x9a),.owner=actual_c_type,.ordinal=0,.name="native",.@"type"=scalar_type,.declared_type=scalar_type,.readonly=false,.optional=false,.access=.public,.origin=operation,.binding=@enumFromInt(5) },
        };
        common.members.constructions=&.{
            .{ .id=@splat(0x76),.owner=c_type,.function=@enumFromInt(0),.kind=.explicit,.origin=declaration,.parameters=&.{.{.binding=@enumFromInt(8),.inherited_from=null,.origin=declaration,.@"type"=bool_type}},.signature=.{.parameters=&.{bool_type},.return_type=c_type},.source_signature=.{.id=@splat(0xaa),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{},.access=.public },
            .{ .id=@splat(0x77),.owner=a_type,.function=@enumFromInt(1),.kind=.explicit,.origin=declaration,.parameters=&.{.{.binding=@enumFromInt(7),.inherited_from=null,.origin=declaration,.@"type"=actual_c_type}},.signature=.{.parameters=&.{actual_c_type},.return_type=a_type},.source_signature=.{.id=@splat(0xba),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{},.access=.public },
            .{ .id=@splat(0x88),.owner=b_type,.function=@enumFromInt(2),.kind=.explicit,.origin=declaration,.parameters=&.{.{.binding=@enumFromInt(4),.inherited_from=null,.origin=declaration,.@"type"=actual_c_type}},.signature=.{.parameters=&.{actual_c_type},.return_type=b_type},.source_signature=.{.id=@splat(0xbb),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{@enumFromInt(0)},.access=.public },
            .{ .id=@splat(0x89),.owner=actual_c_type,.function=@enumFromInt(3),.kind=.explicit,.origin=declaration,.parameters=&.{},.signature=.{.parameters=&.{},.return_type=actual_c_type},.source_signature=.{.id=@splat(0xbc),.origin=declaration},.implicit_forward=null,.initialization_phase=.@"before-body",.initialization_fields=&.{@enumFromInt(1)},.access=.public },
        };
        common.storage.concrete=&.{
            .{ .@"type"=a_type,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=0,.alignment=1,.reference_count=0,.fields=&.{}} },
            .{ .@"type"=b_type,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=8,.alignment=8,.reference_count=1,.fields=&.{.{.field=@enumFromInt(0),.binding=@enumFromInt(3),.offset=0,.reference_offset=0}}} },
            .{ .@"type"=scalar_type,.carrier=.{.layout=.{.byte_size=4,.alignment=4,.reference_count=0},.field_offsets=&.{}},.body=null },
            .{ .@"type"=undefined_value_type,.carrier=.{.layout=.{.byte_size=0,.alignment=1,.reference_count=0},.field_offsets=&.{}},.body=null },
            .{ .@"type"=c_type,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=0,.alignment=1,.reference_count=0,.fields=&.{}} },
            .{ .@"type"=actual_c_type,.carrier=.{.layout=.{.byte_size=8,.alignment=8,.reference_count=1},.field_offsets=&.{}},.body=.{.byte_size=4,.alignment=4,.reference_count=0,.fields=&.{.{.field=@enumFromInt(1),.binding=@enumFromInt(5),.offset=0,.reference_offset=0}}} },
            .{ .@"type"=bool_type,.carrier=.{.layout=.{.byte_size=1,.alignment=1,.reference_count=0},.field_offsets=&.{}},.body=null },
        };
        common.exceptions.scopes=&.{.{.owner=@enumFromInt(0),.path=&.{"function"}},.{.owner=@enumFromInt(1),.path=&.{"function"}},.{.owner=@enumFromInt(2),.path=&.{"function"}},.{.owner=@enumFromInt(3),.path=&.{"function"}}};
        common.exceptions.bindings=&.{.{.binding=@enumFromInt(0),.scope=@enumFromInt(0)},.{.binding=@enumFromInt(1),.scope=@enumFromInt(1)},.{.binding=@enumFromInt(2),.scope=@enumFromInt(2)},.{.binding=@enumFromInt(4),.scope=@enumFromInt(2)},.{.binding=@enumFromInt(6),.scope=@enumFromInt(3)},.{.binding=@enumFromInt(7),.scope=@enumFromInt(1)},.{.binding=@enumFromInt(8),.scope=@enumFromInt(0)}};
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
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
fn entryHeap(graph: *const m.Graph, heap: m.Ref) !m.Ref {
    var current = heap;
    for (0..graph.heaps.len) |_| switch (graph.heaps[current]) {
        .entry => return current,
        .join => |row| {
            try std.testing.expectEqual(@as(usize, 1), row.inputs.len);
            current = row.inputs[0];
        },
        else => return error.TestBirthBeforeBranch,
    };
    return error.TestHeapCycle;
}

test "typed conditional branch independently births complete C on each incoming Ref phi then forwards B to D" {
    var fixture: Fixture = undefined; fixture.init();
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = m.Budget{ .context = &c, .charge = refs.graphCharge };
    // Actual prerequisite checks run on THIS branch's bool parameter,
    // twelve blocks, two C construction sites and shared Ref phi.
    try typed(&c, &budget);
    try std.testing.expectEqual(@as(usize, 12), fixture.functions[0].blocks.len);
    try std.testing.expectEqual(@as(usize, 2), fixture.functions[0].blocks[0].parameters.len);
    try std.testing.expect(fixture.functions[0].blocks[0].instructions[1].data == .cond_br);
    try std.testing.expectEqual(@as(usize, 1), fixture.functions[0].blocks[7].parameters.len);
    var projection = try body.project(&c, @enumFromInt(0), &dto.directory, &budget); defer projection.deinit();
    try std.testing.expectEqual(@as(?body.Pending, null), projection.pending);
    const graph = &projection.graph.?;
    const validation = try m.validateGraph(c.allocator, &dto.directory, dto.caller, graph, &budget);
    try std.testing.expect(validation == .pending and validation.pending == .construction_frame);
    var arena = std.heap.ArenaAllocator.init(c.allocator); defer arena.deinit();
    const input = try refs.returnOriginConstructorInput(&c, arena.allocator(), c.program.tables.mode.common.authority.fixed_publication, dto.caller);
    try std.testing.expectEqual(@as(usize, 4), input.fixed.len);
    try std.testing.expectEqual(@as(usize, 2), input.fixed[0].contract.upper.parameters.len);
    try std.testing.expectEqual(@as(usize, 2), input.fixed[0].declaration.parameter_types.len);
    try std.testing.expectEqual(@as(usize, 1), input.fixed[3].initialization_fields.?.len);
    try std.testing.expectEqualStrings(dto.native_field, input.fixed[3].initialization_fields.?[0]);
    try std.testing.expectEqual(@as(usize, 1), input.fixed[2].initialization_fields.?.len);
    try std.testing.expectEqualStrings(dto.field, input.fixed[2].initialization_fields.?[0]);
    for (input.fixed) |fixed| {
        const check = try m.validateGraph(c.allocator, &dto.directory, fixed.function_id, &fixed.contract.return_origins.?, &budget);
        try std.testing.expect(check == .pending and check.pending == .construction_frame);
    }
    const certificates_rows = [_]certificates.FixedContract{
        .{ .function_id = dto.caller, .graph = &conditional, .complete = &input.fixed[0] },
        .{ .function_id = dto.native_callee, .graph = &dto.native_leaf, .complete = &input.fixed[1] },
        .{ .function_id = dto.callee, .graph = &complete_leaf, .complete = &input.fixed[2] },
        .{ .function_id = dto.final_callee, .graph = &actual_complete, .complete = &input.fixed[3] },
    };
    var receiver = try domain.analyzeReturns(c.allocator, &dto.directory, graph, &budget, input); defer receiver.deinit();
    const coverage = try certificates.covered(c.allocator, &dto.directory, dto.caller, graph, &certificates_rows, &budget);
    if (receiver.pending) |reason| std.debug.print("typed conditional pending={s} coverage={s}\n", .{ @tagName(reason), @tagName(coverage) });
    // Frozen first semantic assertion for same-input committed RED and new G.
    try std.testing.expectEqual(@as(?domain.Pending, null), receiver.pending);
    try std.testing.expect(coverage == .covered);
    try std.testing.expect(receiver.normal_live and !receiver.language_live);
    try std.testing.expectEqual(@as(usize, 3), receiver.calls.len);
    var forward: ?domain.CallFact = null;
    var c_births: [2]domain.CallFact = undefined; var birth_count: usize = 0;
    for (receiver.calls) |fact| {
        const called = fact.fixed.function_id;
        if (std.mem.eql(u8, called, dto.native_callee)) {
            try std.testing.expect(forward == null); forward = fact;
        } else {
            try std.testing.expectEqualStrings(dto.final_callee, called);
            try std.testing.expect(birth_count < c_births.len);
            c_births[birth_count] = fact; birth_count += 1;
        }
    }
    try std.testing.expect(forward != null and birth_count == 2);
    try std.testing.expect(c_births[0].analysis != c_births[1].analysis and c_births[0].receiver != c_births[1].receiver);
    const first_call = graph.calls[c_births[0].call]; const second_call = graph.calls[c_births[1].call];
    // Distinct C branches retain their own incoming entry heap. B must retain
    // their actual joined heap, never be rewritten to one common-born source.
    const first_entry = try entryHeap(graph, first_call.heap);
    const second_entry = try entryHeap(graph, second_call.heap);
    try std.testing.expectEqual(first_entry, second_entry);
    const forward_call = graph.calls[forward.?.call];
    try std.testing.expect(forward_call.heap != first_call.heap and forward_call.heap != second_call.heap);
    try std.testing.expect(graph.heaps[forward_call.heap] == .join);
    try std.testing.expectEqual(@as(usize, 2), forward.?.arguments[1].len);
    for (forward.?.arguments[1]) |atom| {
        try std.testing.expect(atom.category == .object and atom.source == .allocation);
        try std.testing.expect(atom.source.allocation == c_births[0].receiver or atom.source.allocation == c_births[1].receiver);
    }
    try std.testing.expectEqual(@as(usize, 1), forward.?.analysis.calls.len);
    const nested = forward.?.analysis.calls[0];
    try std.testing.expectEqualStrings(dto.callee, nested.fixed.function_id);
    try std.testing.expectEqual(@as(usize, 1), nested.arguments[1].len);
    const parameter = nested.arguments[1][0];
    try std.testing.expect(parameter.source == .node and nested.caller_graph.nodes[parameter.source.node] == .parameter);
    try std.testing.expectEqual(@as(usize, 1), nested.caller_graph.nodes[parameter.source.node].parameter.index);
    try std.testing.expectEqualStrings(dto.actual_c, nested.caller_graph.nodes[parameter.source.node].parameter.@"type");
    try std.testing.expectEqual(@as(usize, 1), receiver.normal.len);
    const returned = receiver.normal[0];
    try std.testing.expect(returned.category == .object and returned.source == .scoped_allocation);
    try std.testing.expect(returned.source.scoped_allocation.analysis == forward.?.analysis);
    try std.testing.expectEqual(nested.receiver, returned.source.scoped_allocation.frame);
    try std.testing.expectEqual(m.Completion.normal, returned.source.scoped_allocation.completion);
    const rows = ownerRows(&complete_contracts);
    var result = try owners.analyzeReceiver(c.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &receiver); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    const d_location = result.locations[result.normal[0]];
    try std.testing.expect(d_location.kind == .root and d_location.owner == .local);
    try std.testing.expectEqualStrings(dto.b, d_location.type_id.?);
    try std.testing.expectEqual(nested.receiver, d_location.node);
    try std.testing.expectEqual(@as(usize, 3), result.normal_payloads.len);
    var holder: ?owners.Payload = null; var native_count: usize = 0;
    for (result.normal_payloads) |payload_row| {
        if (std.mem.eql(u8, payload_row.type_id, dto.b)) holder = payload_row;
        if (std.mem.eql(u8, payload_row.type_id, dto.actual_c)) {
            native_count += 1;
            try std.testing.expectEqual(@as(usize, 1), payload_row.slots.len);
            const slot = payload_row.slots[0];
            try std.testing.expectEqualStrings("field:" ++ dto.native_field, slot.selector);
            try std.testing.expectEqualStrings(dto.actual_c, slot.view);
            try std.testing.expectEqual(@as(?usize, 0), slot.physical);
            try std.testing.expectEqual(@as(usize, 1), slot.values.len);
            const native = result.locations[slot.values[0]];
            try std.testing.expect(native.owner == .nonowning);
            try std.testing.expectEqualStrings(dto.scalar, native.type_id.?);
        }
    }
    try std.testing.expectEqual(@as(usize, 2), native_count);
    try std.testing.expect(holder != null and holder.?.location == result.normal[0]);
    try std.testing.expectEqual(@as(usize, 1), holder.?.slots.len);
    const refslot = holder.?.slots[0];
    try std.testing.expectEqualStrings("field:" ++ dto.field, refslot.selector);
    try std.testing.expectEqualStrings(dto.b, refslot.view);
    try std.testing.expectEqual(@as(?usize, 0), refslot.physical);
    try std.testing.expectEqual(@as(usize, 2), refslot.values.len);
    const first = result.locations[refslot.values[0]]; const second = result.locations[refslot.values[1]];
    try std.testing.expect(first.scope == 0 and second.scope == 0 and first.node != second.node);
    try std.testing.expect(first.kind == .root and second.kind == .root and first.owner == .local and second.owner == .local);
    try std.testing.expectEqualStrings(dto.actual_c, first.type_id.?);
    try std.testing.expectEqualStrings(dto.actual_c, second.type_id.?);
    try std.testing.expect((first.node == c_births[0].receiver and second.node == c_births[1].receiver) or (first.node == c_births[1].receiver and second.node == c_births[0].receiver));
    try std.testing.expectEqual(@as(usize, 0), result.effects.len);

    // Complete negative certificates: graph and complete contract carry the
    // same bad upper, so rejection cannot be a pointer/row mismatch shortcut.
    for (0..4) |bad_case| {
        var bad_nodes: [16]m.Value = undefined; @memcpy(bad_nodes[0..15], conditional.nodes);
        bad_nodes[15] = .{ .literal = .{ .@"type" = dto.boolean, .category = .other } };
        switch (bad_case) {
            0 => {
                bad_nodes[15] = .{ .gate = .{ .@"type" = dto.actual_c, .inputs = &.{2}, .control = 1 } };
                bad_nodes[12].join.inputs = &.{ 2, 15 };
            },
            1 => {
                bad_nodes[15] = .{ .gate = .{ .@"type" = dto.actual_c, .inputs = &.{2}, .control = 1 } };
                bad_nodes[12].join.inputs = &.{ 2, 13, 15 };
            },
            2 => bad_nodes[13].gate.control = 1,
            3 => {}, // The extra legal unused literal remains a real core.
            else => unreachable,
        }
        var bad_upper = conditional; bad_upper.nodes = bad_nodes[0..if (bad_case == 2) 15 else 16];
        const bad_validation = try m.validateGraph(c.allocator, &dto.directory, dto.caller, &bad_upper, &budget);
        try std.testing.expect(bad_validation == .pending and bad_validation.pending == .construction_frame);
        var bad_contracts = complete_contracts; bad_contracts[0].return_origins = bad_upper;
        var bad_complete: [4]domain.FixedFunction = undefined; @memcpy(&bad_complete, input.fixed);
        bad_complete[0].contract = &bad_contracts[0];
        var bad_fixed = certificates_rows;
        bad_fixed[0].graph = &bad_contracts[0].return_origins.?;
        bad_fixed[0].complete = &bad_complete[0];
        const rejected = try certificates.covered(c.allocator, &dto.directory, dto.caller, graph, &bad_fixed, &budget);
        try std.testing.expect(rejected != .covered);
    }
}
