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
pub const caller = "sha256:" ++ "55" ** 32;
pub const callee = "sha256:" ++ "66" ** 32;
pub const role_a = "sha256:" ++ "77" ** 32;
pub const role_b = "sha256:" ++ "88" ** 32;
pub const field = "sha256:" ++ "99" ** 32;
pub const directory: m.Directory = .{
    .types = &.{ .{ .id = a, .kind = .reference }, .{ .id = b, .kind = .reference }, .{ .id = scalar, .kind = .scalar }, .{ .id = undefined_type, .kind = .@"undefined" } },
    .functions = &.{
        .{ .id = caller, .kind = .construction_body, .parameter_types = &.{a}, .return_type = a, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_a, .owner = a, .base = null, .receiver_index = 0 } },
        .{ .id = callee, .kind = .construction_body, .parameter_types = &.{b}, .return_type = b, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = role_b, .owner = b, .base = null, .receiver_index = 0 } },
    },
    .constructions = &.{ .{ .id = role_a, .owner = a, .base = null, .kind = .explicit, .function_id = caller }, .{ .id = role_b, .owner = b, .base = null, .kind = .explicit, .function_id = callee } },
    .fields = &.{field}, .globals = &.{}, .environments = &.{},
};
pub const leaf: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_value = .{ .@"type" = b, .action = 1 } }, .{ .receiver_value = .{ .@"type" = b, .action = 2 } },
        .{ .literal = .{ .@"type" = scalar, .category = .other } }, .{ .literal = .{ .@"type" = undefined_type, .category = .@"undefined" } },
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
pub const caller_graph: m.Graph = .{
    .nodes = &.{ .receiver_input,
        .{ .receiver_frame = .{ .construction = role_b, .new_target = b, .parent = null, .site = "caller:new-B", .control = 0 } },
        .{ .call = .{ .@"type" = b, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .receiver_value = .{ .@"type" = a, .action = 3 } }, .{ .receiver_value = .{ .@"type" = null, .action = 4 } },
    },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .normal } },
        .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .result, .operands = &.{2}, .completion = .language } },
    },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } }, .{ .receiver_completion = .{ .action = 3 } }, .{ .receiver_completion = .{ .action = 4 } } },
    .calls = &.{.{ .function_id = callee, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "caller:construct-B" }},
    .normal = &.{4}, .language = &.{ 3, 5 }, .exits = .{ .normal = &.{.{ .heap = 3, .control = 3 }}, .language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 } } }, .accesses = &.{},
};
const ScopeFunction = @typeInfo(@FieldType(p.StableScope, "functions")).pointer.child;
const Contract = @typeInfo(@FieldType(p.Publication, "contracts")).pointer.child;
pub const declarations = [_]ScopeFunction{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "A", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x11)}, .return_type = @splat(0x11), .construction = .{ .id = @splat(0x77), .owner = @splat(0x11), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "B", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x22)}, .return_type = @splat(0x22), .construction = .{ .id = @splat(0x88), .owner = @splat(0x22), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
};
pub const full: p.EffectUpper = .{
    .parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = true, .@"await" = false, .eh_control = true, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
};
pub const contracts = [_]Contract{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = caller_graph, .digest = @splat(0xdc) },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = leaf, .digest = @splat(0xed) },
};
