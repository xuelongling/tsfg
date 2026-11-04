// SPDX-License-Identifier: MIT
// Passive literal metadata only. No Source admission, Program aggregate,
// load/check entry, Actual/State/VM or verification marker is represented.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const p = @import("wire-program-publication.zig");
const domain = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
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
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "A-root", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x45)}, .return_type = @splat(0x45), .construction = .{ .id = @splat(0x76), .owner = @splat(0x45), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "B-forward", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x11), @splat(0x46) }, .return_type = @splat(0x11), .construction = .{ .id = @splat(0x77), .owner = @splat(0x11), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "D-leaf", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{ @splat(0x22), @splat(0x46) }, .return_type = @splat(0x22), .construction = .{ .id = @splat(0x88), .owner = @splat(0x22), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "C-actual", .path = &.{}, .source_path = "constructor-call-literal-dto.ts" }, .parameter_types = &.{@splat(0x46)}, .return_type = @splat(0x46), .construction = .{ .id = @splat(0x89), .owner = @splat(0x46), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
};
pub const full: p.EffectUpper = .{
    .parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = true, .@"await" = false, .eh_control = true, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
};
pub const scalar_full: p.EffectUpper = blk: { var upper = full; upper.parameters = &.{ .{ .index = 0, .read = false, .write = true, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } }; break :blk upper; };
pub const contracts = [_]Contract{
    .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = caller_graph, .digest = @splat(0xdc) },
    .{ .function_id = @splat(0x65), .signature_hash = @splat(0xba), .upper = scalar_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = native_leaf, .digest = @splat(0xdd) },
    .{ .function_id = @splat(0x66), .signature_hash = @splat(0xbb), .upper = scalar_full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = leaf, .digest = @splat(0xed) },
    .{ .function_id = @splat(0x67), .signature_hash = @splat(0xbc), .upper = full, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = actual_leaf, .digest = @splat(0xde) },
};
};

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
const Meter = struct {
    left: usize = 100000000, spent: usize = 0,
    fn charge(raw: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *@This() = @ptrCast(@alignCast(raw));
        if (units > self.left) return error.BudgetExceeded;
        self.left -= units; self.spent += units;
    }
};
fn fixedRows(contracts: *const @TypeOf(dto.contracts)) [4]domain.FixedFunction {
    return .{
        .{ .function_id = dto.caller, .declaration = &dto.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
        .{ .function_id = dto.native_callee, .declaration = &dto.declarations[1], .contract = &contracts[1], .initialization_fields = &.{} },
        .{ .function_id = dto.callee, .declaration = &dto.declarations[2], .contract = &contracts[2], .initialization_fields = &.{dto.field} },
        .{ .function_id = dto.final_callee, .declaration = &dto.declarations[3], .contract = &contracts[3], .initialization_fields = &.{dto.native_field} },
    };
}
fn ownerRows(contracts: *const @TypeOf(dto.contracts)) [4]owners.Fixed {
    return .{
        .{ .function_id = dto.caller, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[0].upper.facets.may_throw },
        .{ .function_id = dto.native_callee, .graph = &contracts[1].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[1].upper.facets.may_throw },
        .{ .function_id = dto.callee, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = contracts[2].upper.facets.may_throw },
        .{ .function_id = dto.final_callee, .graph = &contracts[3].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = contracts[3].upper.facets.may_throw },
    };
}
const physical = [_]owners.Physical{
    .{ .type_id = dto.c, .fields = &.{} }, .{ .type_id = dto.a, .fields = &.{} },
    .{ .type_id = dto.b, .fields = &.{.{ .id = dto.field, .view = dto.b, .physical = 0, .type_id = dto.actual_c }} },
    .{ .type_id = dto.actual_c, .fields = &.{.{ .id = dto.native_field, .view = dto.actual_c, .physical = 0, .type_id = dto.scalar }} },
};
fn validate(contracts: *const @TypeOf(dto.contracts), graph: *const m.Graph, budget: *m.Budget) !void {
    try m.validateDirectory(std.testing.allocator, &dto.directory, budget);
    const root = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, graph, budget);
    try std.testing.expect(root == .pending and root.pending == .construction_frame);
    for (contracts, [_]m.Symbol{ dto.caller, dto.native_callee, dto.callee, dto.final_callee }) |row, id| {
        const dependency = row.return_origins orelse return error.TestMissingFullContract;
        const checked = try m.validateGraph(std.testing.allocator, &dto.directory, id, &dependency, budget);
        try std.testing.expect(checked == .pending and checked.pending == .construction_frame);
    }
}
fn fullOracle(result: *const domain.Analysis, content: *const owners.Analysis) !void {
    try std.testing.expect(result.pending == null and result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 3), result.calls.len);
    var forward: ?domain.CallFact = null;
    var first: ?domain.CallFact = null;
    var second: ?domain.CallFact = null;
    for (result.calls) |fact| switch (fact.call) { 0 => first = fact, 1 => forward = fact, 2 => second = fact, else => return error.TestUnexpectedCall };
    try std.testing.expect(first != null and second != null and forward != null);
    try std.testing.expect(first.?.analysis != second.?.analysis and first.?.receiver != second.?.receiver);
    try std.testing.expectEqual(@as(usize, 2), forward.?.arguments[1].len);
    try std.testing.expect(forward.?.arguments[1][0].source == .allocation and forward.?.arguments[1][1].source == .allocation);
    try std.testing.expect(forward.?.arguments[1][0].source.allocation != forward.?.arguments[1][1].source.allocation);
    try std.testing.expectEqual(@as(usize, 1), forward.?.analysis.calls.len);
    const nested = forward.?.analysis.calls[0];
    try std.testing.expectEqual(@as(usize, 1), nested.arguments[1].len);
    try std.testing.expect(nested.arguments[1][0].source == .node);
    const parameter = nested.caller_graph.nodes[nested.arguments[1][0].source.node];
    try std.testing.expect(parameter == .parameter and parameter.parameter.index == 1);
    try std.testing.expectEqualStrings(dto.actual_c, parameter.parameter.@"type");
    try std.testing.expect(content.pending == null and content.normal_live and !content.language_live);
    try std.testing.expectEqual(@as(usize, 1), content.normal.len);
    try std.testing.expectEqual(@as(usize, 3), content.normal_payloads.len);
    var holder: ?owners.Payload = null;
    var natives: usize = 0;
    for (content.normal_payloads) |row| {
        if (std.mem.eql(u8, row.type_id, dto.b)) holder = row;
        if (std.mem.eql(u8, row.type_id, dto.actual_c)) {
            natives += 1;
            try std.testing.expectEqual(@as(usize, 1), row.slots.len);
            try std.testing.expectEqualStrings("field:" ++ dto.native_field, row.slots[0].selector);
            try std.testing.expectEqualStrings(dto.actual_c, row.slots[0].view);
            try std.testing.expectEqual(@as(?usize, 0), row.slots[0].physical);
            try std.testing.expectEqual(@as(usize, 1), row.slots[0].values.len);
            const native = content.locations[row.slots[0].values[0]];
            try std.testing.expect(native.owner == .nonowning);
            try std.testing.expectEqualStrings(dto.scalar, native.type_id.?);
        }
    }
    try std.testing.expectEqual(@as(usize, 2), natives);
    try std.testing.expect(holder != null and holder.?.location == content.normal[0]);
    try std.testing.expectEqual(@as(usize, 1), holder.?.slots.len);
    try std.testing.expectEqualStrings("field:" ++ dto.field, holder.?.slots[0].selector);
    try std.testing.expectEqualStrings(dto.b, holder.?.slots[0].view);
    try std.testing.expectEqual(@as(?usize, 0), holder.?.slots[0].physical);
    const aliases = holder.?.slots[0].values;
    try std.testing.expectEqual(@as(usize, 2), aliases.len);
    try std.testing.expect(aliases[0] != aliases[1]);
    const c1 = content.locations[aliases[0]]; const c2 = content.locations[aliases[1]];
    try std.testing.expect(c1.kind == .root and c2.kind == .root and c1.owner == .local and c2.owner == .local);
    try std.testing.expect(c1.scope == 0 and c2.scope == 0 and c1.node != c2.node);
    try std.testing.expect((c1.node == first.?.receiver and c2.node == second.?.receiver) or (c1.node == second.?.receiver and c2.node == first.?.receiver));
    try std.testing.expectEqualStrings(dto.actual_c, c1.type_id.?);
    try std.testing.expectEqualStrings(dto.actual_c, c2.type_id.?);
    const d = content.locations[content.normal[0]];
    try std.testing.expectEqualStrings(dto.b, d.type_id.?);
    try std.testing.expectEqual(nested.receiver, d.node);
    try std.testing.expectEqual(@as(usize, 0), content.effects.len);
}
test "conditional local C births each finish native fields and preserve both original aliases through B to D" {
    var contracts = dto.contracts; contracts[0].return_origins = conditional;
    const graph = &contracts[0].return_origins.?;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    if (result.pending) |reason| std.debug.print("conditional RED pending={s} calls={d}\n", .{ @tagName(reason), result.calls.len });
    // First tracer assertion is intentionally unchanged between RED and GREEN.
    try std.testing.expect(result.pending == null);
    const rows = ownerRows(&contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &result); defer content.deinit();
    try fullOracle(&result, &content);
    // A nonempty stale snapshot must not license the final grown Ref Set.
    var borrowed = result; var facts: [3]domain.CallFact = undefined; @memcpy(&facts, result.calls);
    var arguments: [2][]const domain.Atom = undefined; var one: [1]domain.Atom = undefined;
    for (&facts) |*fact| if (fact.call == 1) { one[0] = fact.arguments[1][0]; arguments = .{ &.{}, &one }; fact.arguments = &arguments; };
    borrowed.calls = &facts;
    var stale = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &borrowed); defer stale.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), stale.pending);
    // Wrong original caller namespace cannot be repaired by equal numeric refs.
    facts = result.calls[0..3].*; var foreign_graph = conditional;
    for (&facts) |*fact| if (fact.call == 1) { fact.caller_graph = &foreign_graph; };
    borrowed.calls = &facts;
    var foreign = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, graph, &rows, &budget, &borrowed); defer foreign.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), foreign.pending);
    // Full original permissions at both B and D still apply to all alternatives.
    const flags = [_]owners.Flags{ .{ .read = true }, .{ .write = true }, .{ .structural = true } };
    for ([_]usize{ 1, 2 }) |callee| for (flags) |flag| {
        var upper_rows = ownerRows(&contracts);
        const parameters = [_]owners.Flags{ .{ .write = true }, flag }; upper_rows[callee].parameters = &parameters;
        var denied = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, graph, &upper_rows, &budget, &result); defer denied.deinit();
        try std.testing.expectEqual(@as(?owners.Pending, .receiver_protocol), denied.pending);
    };
}
test "conditional C1 normal and C2 language retain their own birth initialization proofs" {
    var nodes = conditional.nodes[0..14].*;
    nodes[13].gate.inputs = &.{11}; nodes[13].gate.control = 8;
    var heaps = conditional.heaps[0..10].*; heaps[9].join.inputs = &.{ 1, 8 };
    var controls = conditional.controls[0..10].*; controls[9].join.inputs = &.{ 1, 8 };
    var graph = conditional; graph.nodes = &nodes; graph.heaps = &heaps; graph.controls = &controls;
    // C2's language path returns the bound original C after native init.
    var leaf = dto.actual_leaf; leaf.language = &.{2}; leaf.exits.language = &.{.{ .heap = 3, .control = 2 }};
    var contracts = dto.contracts; contracts[0].return_origins = graph;
    contracts[3].return_origins = leaf; contracts[3].upper.facets.may_throw = true;
    contracts[0].upper.facets.may_throw = true;
    // Both calls have live language paths in this fixture; original C1
    // language is propagated, C2 language is consumed at the B argument.
    graph.language = &.{ 3, 6, 8 };
    graph.exits.language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 } };
    contracts[0].return_origins = graph;
    var fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &graph, &budget);
    var complete = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer complete.deinit();
    try std.testing.expect(complete.pending == null and complete.normal_live and complete.language_live);
    const rows = ownerRows(&contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &graph, &rows, &budget, &complete); defer content.deinit();
    try std.testing.expect(content.pending == null and content.normal_live and content.language_live);
    try std.testing.expectEqual(@as(usize, 3), content.normal_payloads.len);
    var holder: ?owners.Payload = null;
    for (content.normal_payloads) |row| if (std.mem.eql(u8, row.type_id, dto.b)) { holder = row; };
    try std.testing.expect(holder != null and holder.?.slots[0].values.len == 2);
    // A real C2 language allocation is bound at heap2 but lacks native init.
    // Complete normal C1 (and C2 normal) must not erase that bad completion.
    leaf.exits.language = &.{.{ .heap = 2, .control = 2 }};
    contracts[3].return_origins = leaf; fixed = fixedRows(&contracts);
    try validate(&contracts, &graph, &budget);
    var incomplete = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer incomplete.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), incomplete.pending);
    var found_c2 = false;
    for (incomplete.calls) |fact| if (fact.call == 2) {
        found_c2 = true;
        const exits = fact.analysis.input_exits.?;
        try std.testing.expect(exits.normal.live and !exits.normal.unbound and exits.normal.missing_fields.?.len == 0);
        try std.testing.expect(exits.language.live and !exits.language.unbound);
        try std.testing.expectEqualSlices(m.Symbol, &.{dto.native_field}, exits.language.missing_fields.?);
    };
    try std.testing.expect(found_c2);
}
test "conditional complete calls cannot license a missing source content route" {
    var graph = conditional;
    graph.exits.normal = &.{.{ .heap = 0, .control = 5 }};
    var contracts = dto.contracts; contracts[0].return_origins = graph;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expect(result.pending == null);
    const rows = ownerRows(&contracts);
    var content = try owners.analyzeReceiver(std.testing.allocator, &dto.directory, &physical, dto.caller, &graph, &rows, &budget, &result); defer content.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .payload_uninitialized), content.pending);
}
test "conditional proof does not manufacture public formal input or cyclic fresh birth" {
    var contracts = dto.contracts; contracts[0].return_origins = conditional;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &conditional, &budget);
    var formal = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &dto.native_leaf, &budget, .{ .function_id = dto.native_callee, .fixed = &fixed }); defer formal.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), formal.pending);
    var nodes = conditional.nodes[0..14].*;
    // C2 fresh frame creation depends on C2's own normal completion.
    nodes[9].receiver_frame.control = 7;
    var calls = conditional.calls[0..3].*; calls[2].control = 7;
    var cyclic = conditional; cyclic.nodes = &nodes; cyclic.calls = &calls;
    const validation = try m.validateGraph(std.testing.allocator, &dto.directory, dto.caller, &cyclic, &budget);
    try std.testing.expect(validation == .pending and validation.pending == .receiver_activation);
    try std.testing.expect(!try m.receiverActivations(std.testing.allocator, &cyclic, &budget));
    var looped = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &cyclic, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer looped.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .frame_activation), looped.pending);
}

test "late born unbound C2 cannot borrow an earlier complete C2 certificate" {
    var nodes: [15]m.Value = undefined; @memcpy(nodes[0..14], conditional.nodes);
    // The extra original allocation becomes a late Ref alternative after the
    // existing complete C2 call. It is a real born-but-unbound object.
    nodes[14] = .{ .receiver_value = .{ .@"type" = dto.actual_c, .action = 10 } };
    nodes[13].gate.inputs = &.{ 10, 14 };
    var heaps: [11]m.Heap = undefined; @memcpy(heaps[0..10], conditional.heaps);
    heaps[10] = .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{9}, .action = .allocate, .operands = &.{}, .completion = .normal } };
    heaps[9].join.inputs = &.{ 1, 7, 10 };
    var graph = conditional; graph.nodes = &nodes; graph.heaps = &heaps;
    var contracts = dto.contracts; contracts[0].return_origins = graph;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}
test "heap-only repeated direct birth remains unready despite later complete constructor" {
    var nodes: [15]m.Value = undefined; @memcpy(nodes[0..14], conditional.nodes);
    nodes[14] = .{ .receiver_value = .{ .@"type" = dto.actual_c, .action = 10 } };
    nodes[13].gate.inputs = &.{ 10, 14 };
    var heaps: [12]m.Heap = undefined; @memcpy(heaps[0..10], conditional.heaps);
    // Activation controls are acyclic; only the heap can repeat this original
    // allocation. The existing activation-cycle gate alone does not reject it.
    heaps[10] = .{ .receiver_action = .{ .previous = 11, .control = 0, .frames = &.{9}, .action = .allocate, .operands = &.{}, .completion = .normal } };
    heaps[11] = .{ .join = .{ .inputs = &.{ 0, 10 } } };
    var calls = conditional.calls[0..3].*; calls[2].heap = 10;
    var graph = conditional; graph.nodes = &nodes; graph.heaps = &heaps; graph.calls = &calls;
    var contracts = dto.contracts; contracts[0].return_origins = graph;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}

test "a later fresh allocation cannot inherit an older same-frame complete C2 binding" {
    var nodes: [15]m.Value = undefined; @memcpy(nodes[0..14], conditional.nodes);
    nodes[14] = .{ .receiver_value = .{ .@"type" = dto.actual_c, .action = 10 } };
    nodes[13].gate.inputs = &.{ 10, 14 };
    var heaps: [11]m.Heap = undefined; @memcpy(heaps[0..10], conditional.heaps);
    // This fresh object is born AFTER a complete C2. The old ordinary binding
    // and missing arrays still describe the older object at the same static
    // frame; the real bad-birth fact must defeat both primary and fallback.
    heaps[10] = .{ .receiver_action = .{ .previous = 7, .control = 7, .frames = &.{9}, .action = .allocate, .operands = &.{}, .completion = .normal } };
    heaps[9].join.inputs = &.{ 1, 10 };
    var graph = conditional; graph.nodes = &nodes; graph.heaps = &heaps;
    var contracts = dto.contracts; contracts[0].return_origins = graph;
    const fixed = fixedRows(&contracts);
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try validate(&contracts, &graph, &budget);
    var result = try domain.analyzeReturns(std.testing.allocator, &dto.directory, &graph, &budget, .{ .function_id = dto.caller, .fixed = &fixed }); defer result.deinit();
    try std.testing.expectEqual(@as(?domain.Pending, .data_protocol), result.pending);
}

// Independent old-capability controls. Z has a genuinely known-empty full
// physical/native inventory, not a narrowed C inventory or borrowed B upper.
const direct_fixture = struct {
    const root_type = "sha256:" ++ "11" ** 32;
    const z_type = "sha256:" ++ "22" ** 32;
    const undef_type = "sha256:" ++ "33" ** 32;
    const consumer_type = "sha256:" ++ "44" ** 32;
    const root_function = "sha256:" ++ "55" ** 32;
    const z_function = "sha256:" ++ "56" ** 32;
    const consumer_function = "sha256:" ++ "57" ** 32;
    const root_role = "sha256:" ++ "75" ** 32;
    const z_role = "sha256:" ++ "76" ** 32;
    const consumer_role = "sha256:" ++ "77" ** 32;
    const directory: m.Directory = .{
        .types = &.{ .{ .id = root_type, .kind = .reference }, .{ .id = z_type, .kind = .reference }, .{ .id = undef_type, .kind = .@"undefined" }, .{ .id = consumer_type, .kind = .reference } },
        .functions = &.{
            .{ .id = root_function, .kind = .construction_body, .parameter_types = &.{root_type}, .return_type = root_type, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = root_role, .owner = root_type, .base = null, .receiver_index = 0 } },
            .{ .id = z_function, .kind = .construction_body, .parameter_types = &.{z_type}, .return_type = z_type, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = z_role, .owner = z_type, .base = null, .receiver_index = 0 } },
            .{ .id = consumer_function, .kind = .construction_body, .parameter_types = &.{ consumer_type, z_type }, .return_type = consumer_type, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = .{ .id = consumer_role, .owner = consumer_type, .base = null, .receiver_index = 0 } },
        },
        .constructions = &.{
            .{ .id = root_role, .owner = root_type, .base = null, .kind = .explicit, .function_id = root_function },
            .{ .id = z_role, .owner = z_type, .base = null, .kind = .explicit, .function_id = z_function },
            .{ .id = consumer_role, .owner = consumer_type, .base = null, .kind = .explicit, .function_id = consumer_function },
        },
        .fields = &.{}, .globals = &.{}, .environments = &.{},
    };
    const root_graph: m.Graph = .{
        .nodes = &.{ .receiver_input,
            .{ .receiver_frame = .{ .construction = z_role, .new_target = z_type, .parent = null, .site = "direct:first-Z", .control = 0 } },
            .{ .receiver_value = .{ .@"type" = z_type, .action = 1 } },
            .{ .receiver_value = .{ .@"type" = z_type, .action = 2 } },
            .{ .receiver_frame = .{ .construction = consumer_role, .new_target = consumer_type, .parent = null, .site = "direct:consumer", .control = 2 } },
            .{ .call = .{ .@"type" = consumer_type, .call = 0, .completion = .normal } },
            .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
            .{ .receiver_value = .{ .@"type" = root_type, .action = 5 } },
            .{ .receiver_value = .{ .@"type" = null, .action = 6 } },
        },
        .heaps = &.{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .allocate, .operands = &.{}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{1}, .action = .bind, .operands = &.{2}, .completion = .normal } },
            .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
            .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 3, .control = 3, .frames = &.{0}, .action = .result, .operands = &.{5}, .completion = .language } },
        },
        .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } },
            .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
            .{ .receiver_completion = .{ .action = 5 } }, .{ .receiver_completion = .{ .action = 6 } },
        },
        .calls = &.{.{ .function_id = consumer_function, .arguments = &.{&.{3}}, .environment = null, .callee = null, .receiver = &.{4}, .heap = 2, .control = 2, .site = "direct:consume-Z" }},
        .normal = &.{7}, .language = &.{ 6, 8 }, .exits = .{ .normal = &.{.{ .heap = 5, .control = 5 }}, .language = &.{ .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 } } }, .accesses = &.{},
    };
    const z_graph: m.Graph = .{
        .nodes = &.{ .receiver_input,
            .{ .receiver_value = .{ .@"type" = z_type, .action = 1 } }, .{ .receiver_value = .{ .@"type" = z_type, .action = 2 } },
            .{ .literal = .{ .@"type" = undef_type, .category = .@"undefined" } }, .{ .receiver_value = .{ .@"type" = z_type, .action = 3 } },
        },
        .heaps = &.{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .allocate, .operands = &.{}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 1, .control = 1, .frames = &.{0}, .action = .bind, .operands = &.{1}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 2, .control = 2, .frames = &.{0}, .action = .result, .operands = &.{3}, .completion = .normal } },
        },
        .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } }, .{ .receiver_completion = .{ .action = 3 } } },
        .calls = &.{}, .normal = &.{4}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 3, .control = 3 }}, .language = &.{} }, .accesses = &.{},
    };
    const consumer_graph: m.Graph = .{
        .nodes = &.{ .receiver_input, .{ .parameter = .{ .@"type" = z_type, .index = 1 } },
            .{ .receiver_value = .{ .@"type" = consumer_type, .action = 1 } }, .{ .receiver_value = .{ .@"type" = null, .action = 2 } },
        },
        .heaps = &.{ .entry,
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .normal } },
            .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{0}, .action = .result, .operands = &.{1}, .completion = .language } },
        },
        .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } },
        .calls = &.{}, .normal = &.{2}, .language = &.{3}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{},
    };
    const declarations = [_]domain.ScopeFunction{
        .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "direct-root", .path = &.{}, .source_path = "direct-empty-literal.ts" }, .parameter_types = &.{@splat(0x11)}, .return_type = @splat(0x11), .construction = .{ .id = @splat(0x75), .owner = @splat(0x11), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
        .{ .function_id = @splat(0x56), .signature_hash = @splat(0xab), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "Z-empty", .path = &.{}, .source_path = "direct-empty-literal.ts" }, .parameter_types = &.{@splat(0x22)}, .return_type = @splat(0x22), .construction = .{ .id = @splat(0x76), .owner = @splat(0x22), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
        .{ .function_id = @splat(0x57), .signature_hash = @splat(0xac), .kind = .@"construction-body", .decl_key = .{ .kind = .constructor, .name = "consume-Z", .path = &.{}, .source_path = "direct-empty-literal.ts" }, .parameter_types = &.{ @splat(0x44), @splat(0x22) }, .return_type = @splat(0x44), .construction = .{ .id = @splat(0x77), .owner = @splat(0x44), .base = null, .receiver_index = 0 }, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public },
    };
    const full_upper: p.EffectUpper = .{
        .parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
        .facets = .{ .allocation = true, .@"await" = false, .eh_control = true, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
    };
    const consumer_upper: p.EffectUpper = blk: { var upper = full_upper; upper.parameters = &.{ .{ .index = 0, .read = false, .write = true, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } }; break :blk upper; };
    const contracts = [_]domain.PublicationContract{
        .{ .function_id = @splat(0x55), .signature_hash = @splat(0xaa), .upper = full_upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = root_graph, .digest = @splat(0xda) },
        .{ .function_id = @splat(0x56), .signature_hash = @splat(0xab), .upper = full_upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = z_graph, .digest = @splat(0xdb) },
        .{ .function_id = @splat(0x57), .signature_hash = @splat(0xac), .upper = consumer_upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = consumer_graph, .digest = @splat(0xdc) },
    };
    const layouts = [_]owners.Physical{
        .{ .type_id = root_type, .fields = &.{} }, .{ .type_id = z_type, .fields = &.{} }, .{ .type_id = consumer_type, .fields = &.{} },
    };
};
test "first complete direct local empty Z retains old MUST including two distinct first-birth branches" {
    for (0..2) |variant| {
        var nodes: [12]m.Value = undefined; @memcpy(nodes[0..9], direct_fixture.root_graph.nodes);
        nodes[9] = .{ .call = .{ .@"type" = direct_fixture.z_type, .call = 1, .completion = .normal } };
        nodes[10] = .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } };
        nodes[11] = .{ .join = .{ .@"type" = direct_fixture.z_type, .inputs = &.{ 3, 9 } } };
        var heaps: [10]m.Heap = undefined; @memcpy(heaps[0..7], direct_fixture.root_graph.heaps);
        heaps[7] = .{ .call = .{ .call = 1, .completion = .normal } }; heaps[8] = .{ .call = .{ .call = 1, .completion = .language } }; heaps[9] = .{ .join = .{ .inputs = &.{ 2, 7 } } };
        var controls: [10]m.Control = undefined; @memcpy(controls[0..7], direct_fixture.root_graph.controls);
        controls[7] = .{ .call = .{ .call = 1, .completion = .normal } }; controls[8] = .{ .call = .{ .call = 1, .completion = .language } }; controls[9] = .{ .join = .{ .inputs = &.{ 2, 7 } } };
        var calls: [2]m.Call = undefined; calls[0] = direct_fixture.root_graph.calls[0];
        calls[1] = .{ .function_id = direct_fixture.z_function, .arguments = &.{}, .environment = null, .callee = null, .receiver = &.{1}, .heap = 0, .control = 0, .site = "direct:alternative-first-ctor" };
        var graph = direct_fixture.root_graph;
        if (variant == 1) {
            nodes[4].receiver_frame.control = 9; calls[0].arguments = &.{&.{11}}; calls[0].heap = 9; calls[0].control = 9;
            graph.nodes = &nodes; graph.heaps = &heaps; graph.controls = &controls; graph.calls = &calls;
            graph.language = &.{ 6, 8, 10 }; graph.exits.language = &.{ .{ .heap = 4, .control = 4 }, .{ .heap = 6, .control = 6 }, .{ .heap = 8, .control = 8 } };
        }
        var contracts = direct_fixture.contracts; contracts[0].return_origins = graph;
        const fixed = [_]domain.FixedFunction{
            .{ .function_id = direct_fixture.root_function, .declaration = &direct_fixture.declarations[0], .contract = &contracts[0], .initialization_fields = &.{} },
            .{ .function_id = direct_fixture.z_function, .declaration = &direct_fixture.declarations[1], .contract = &contracts[1], .initialization_fields = &.{} },
            .{ .function_id = direct_fixture.consumer_function, .declaration = &direct_fixture.declarations[2], .contract = &contracts[2], .initialization_fields = &.{} },
        };
        var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
        try m.validateDirectory(std.testing.allocator, &direct_fixture.directory, &budget);
        for (fixed) |row| {
            const valid = try m.validateGraph(std.testing.allocator, &direct_fixture.directory, row.function_id, &row.contract.return_origins.?, &budget);
            try std.testing.expect(valid == .pending and valid.pending == .construction_frame);
        }
        var result = try domain.analyzeReturns(std.testing.allocator, &direct_fixture.directory, &graph, &budget, .{ .function_id = direct_fixture.root_function, .fixed = &fixed }); defer result.deinit();
        try std.testing.expect(result.pending == null and result.normal_live and !result.language_live);
        try std.testing.expectEqual(@as(usize, if (variant == 0) 1 else 2), result.calls.len);
        try std.testing.expectEqual(@as(usize, 1), result.normal.len);
        try std.testing.expect(result.normal[0].source == .allocation and result.normal[0].source.allocation == 1);
        try std.testing.expect(!result.frames[1].normal.unbound and result.frames[1].normal.missing_fields.?.len == 0);
        const rows = [_]owners.Fixed{
            .{ .function_id = direct_fixture.root_function, .graph = &contracts[0].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
            .{ .function_id = direct_fixture.z_function, .graph = &contracts[1].return_origins.?, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
            .{ .function_id = direct_fixture.consumer_function, .graph = &contracts[2].return_origins.?, .parameters = &.{ .{ .write = true }, .{} }, .captures = &.{}, .may_throw = false },
        };
        var content = try owners.analyzeReceiver(std.testing.allocator, &direct_fixture.directory, &direct_fixture.layouts, direct_fixture.root_function, &graph, &rows, &budget, &result); defer content.deinit();
        try std.testing.expect(content.pending == null and content.normal_live and !content.language_live);
        try std.testing.expectEqual(@as(usize, 1), content.normal.len);
        const original = content.locations[content.normal[0]];
        try std.testing.expect(original.kind == .root and original.owner == .local and original.scope == 0 and original.node == 1);
        try std.testing.expectEqualStrings(direct_fixture.z_type, original.type_id.?);
        try std.testing.expectEqual(@as(usize, 1), content.normal_payloads.len);
        try std.testing.expectEqual(@as(usize, 0), content.normal_payloads[0].slots.len);
    }
}
