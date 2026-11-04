// SPDX-License-Identifier: MIT
// Independent literal interpretation DTOs, not a Source publication or identity
// receipt. Hashes are opaque row names. Full rows below are metadata premises;
// these tests do not assert scope/digest/Source admission or actual entrances.
const m = @import("wire-program-return-origin-model.zig");
const p = @import("wire-program-publication.zig");
pub const a = "sha256:" ++ "11" ** 32;
pub const b = "sha256:" ++ "22" ** 32;
pub const scalar = "sha256:" ++ "33" ** 32;
pub const undefined_type = "sha256:" ++ "44" ** 32;
pub const c = "sha256:" ++ "45" ** 32;
pub const actual_c = "sha256:" ++ "46" ** 32;
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
    .types = &.{ .{ .id = a, .kind = .reference }, .{ .id = b, .kind = .reference }, .{ .id = scalar, .kind = .scalar }, .{ .id = undefined_type, .kind = .@"undefined" }, .{ .id = c, .kind = .reference }, .{ .id = actual_c, .kind = .reference } },
    .functions = &.{
        .{ .id = caller, .kind = .construction_body, .parameter_types = &.{c}, .return_type = c, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_c, .owner = c, .base = null, .receiver_index = 0 } },
        .{ .id = native_callee, .kind = .construction_body, .parameter_types = &.{a}, .return_type = a, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_a, .owner = a, .base = null, .receiver_index = 0 } },
        .{ .id = callee, .kind = .construction_body, .parameter_types = &.{ b, a }, .return_type = b, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_b, .owner = b, .base = null, .receiver_index = 0 } },
        .{ .id = final_callee, .kind = .construction_body, .parameter_types = &.{actual_c}, .return_type = actual_c, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = final_role, .owner = actual_c, .base = null, .receiver_index = 0 } },
    },
    .constructions = &.{ .{ .id = role_c, .owner = c, .base = null, .kind = .explicit, .function_id = caller }, .{ .id = role_a, .owner = a, .base = null, .kind = .explicit, .function_id = native_callee }, .{ .id = role_b, .owner = b, .base = null, .kind = .explicit, .function_id = callee }, .{ .id = final_role, .owner = actual_c, .base = null, .kind = .explicit, .function_id = final_callee } },
    .fields = &.{ field, native_field }, .globals = &.{}, .environments = &.{},
};
pub const leaf: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_value = .{ .@"type" = b, .action = 1 } }, .{ .receiver_value = .{ .@"type" = b, .action = 2 } },
        .{ .parameter = .{ .@"type" = a, .index = 1 } }, .{ .literal = .{ .@"type" = undefined_type, .category = .@"undefined" } },
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
        .{ .receiver_frame = .{ .construction = final_role, .new_target = actual_c, .parent = null, .site = "B:new-C", .control = 0 } },
        .{ .call = .{ .@"type" = actual_c, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .receiver_value = .{ .@"type" = a, .action = 3 } }, .{ .receiver_value = .{ .@"type" = null, .action = 4 } },
    },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } },
    },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } }, .{ .receiver_completion = .{ .action = 3 } }, .{ .receiver_completion = .{ .action = 4 } } },
    .calls = &.{.{ .function_id = final_callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "B:construct-C" }},
    .normal = &.{}, .language = &.{3,4,5}, .exits = .{ .normal = &.{}, .language = &.{.{ .heap = 2, .control = 2 }, .{ .heap = 3, .control = 3 }, .{ .heap = 4, .control = 4 }} }, .accesses = &.{},
};
pub const caller_graph: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_frame = .{ .construction = role_a, .new_target = a, .parent = null, .site = "caller:new-A", .control = 0 } },
        .{ .call = .{ .@"type" = a, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .receiver_frame = .{ .construction = role_b, .new_target = b, .parent = null, .site = "caller:new-B", .control = 2 } },
        .{ .call = .{ .@"type" = b, .call = 1, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } },
        .{ .receiver_value = .{ .@"type" = c, .action = 5 } }, .{ .receiver_value = .{ .@"type" = null, .action = 6 } },
        .{ .join = .{ .@"type" = a, .inputs = &.{3} } },
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
        .{ .function_id = native_callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "caller:construct-A" },
        .{ .function_id = callee, .arguments = &.{&.{9}}, .environment = null, .callee = null, .receiver = &.{4}, .heap = 2, .control = 2, .site = "caller:construct-B" },
    },
    .normal = &.{7}, .language = &.{ 6, 8 }, .exits = .{ .normal = &.{.{ .heap = 5, .control = 5 }}, .language = &.{ .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 } } }, .accesses = &.{},
};
const ScopeFunction = @typeInfo(@FieldType(p.StableScope, "functions")).pointer.child;
const Contract = @typeInfo(@FieldType(p.Publication, "contracts")).pointer.child;
pub const declarations = [_]ScopeFunction{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "C", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x45)}, .return_type = @splat(0x45), .construction = .{ .id = @splat(0x76), .owner = @splat(0x45), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "A", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x11)}, .return_type = @splat(0x11), .construction = .{ .id = @splat(0x77), .owner = @splat(0x11), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "B", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x22), @splat(0x11) }, .return_type = @splat(0x22), .construction = .{ .id = @splat(0x88), .owner = @splat(0x22), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "C-actual", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x46)}, .return_type = @splat(0x46), .construction = .{ .id = @splat(0x89), .owner = @splat(0x46), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
};
pub const full: p.EffectUpper = .{
    .parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = true, .@"await" = false, .eh_control = true, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
};
pub const throwing_full: p.EffectUpper = blk: { var upper = full; upper.facets.may_throw = true; break :blk upper; };
pub const scalar_full: p.EffectUpper = blk: { var upper = full; upper.parameters = &.{ .{ .index = 0, .read = false, .write = true, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } }; break :blk upper; };
pub const contracts = [_]Contract{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .upper = throwing_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = caller_graph, .digest = @splat(0xdc) },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .upper = throwing_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = native_leaf, .digest = @splat(0xdd) },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .upper = scalar_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = leaf, .digest = @splat(0xed) },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = actual_leaf, .digest = @splat(0xde) },
};
