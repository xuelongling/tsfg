// SPDX-License-Identifier: MIT
// Complete literal typed metadata for transparent same-Env SSA state checks.
// Unary Env forwarding stops at refs/layout/identity/SSA; its SourceCorr seam
// remains OPEN. Control-flow-only cases also match the existing SourcePlan when SSA accepts.
// No packet, Source package/carrier, decoder, Actual facts, execution or receipt.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const control = @import("wire-program-control.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const refs = @import("wire-program-table-refs.zig");
const layout = @import("wire-program-layout-check.zig");
const identity = @import("wire-program-identity-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const correspondence = @import("wire-program-source-correspondence.zig");
const t = model.types;
const ins = model.instruction;
fn h(comptime hex: []const u8) t.Hash {
    @setEvalBranchQuota(100000);
    var bytes: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&bytes, hex) catch unreachable;
    return bytes;
}
fn r(comptime n: u16) t.RegisterRef { return @enumFromInt(n); }
fn b(comptime n: u16) t.BlockRef { return @enumFromInt(n); }
const source_path = "/literal-transparent-env-alias.ts";
const source_hash = h("83b358cc6d5b1e3e0796fe046e0af4553eddfaf4ced0158798eb6fd70aa5d865");
const input_hash = h("760e2008d6c5ebf449222116b95d98c67f3d209d1c546279d69789e108a252b2");
const payload_hash = h("c091154eac38cafb9e023e439a59a1244f81abc8c53a107a0bd2d5cda4970c4d");
const bool_id = h("811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721");
const i32_id = h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727");
const void_id = h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190");
const undefined_id = h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");
const function_id = h("8b568657c045cc272295a8d42eccf42fa34b24dc3ef8deefd2c2f66117773a52");
const signature = h("3b23153e45e84b8bbf61a7006f338a6cd46cab42213bf55631c0eb566b559c37");
const environment_id = h("03ae292f71f43181805d6071471d8be44fb6d12338a2e89fea975d95f8d380bc");
const slot_key = h("a5cc81769ad18ec84f2e9d91e8628d0e5929f8ffaad4aeef87de36df4706f8cb");
const undefined_key = h("b74a730414e9c84b9ae1aaf9e7721e60a80e96efdd65144a7614d0482e10664f");
const scope_digest = h("d478d89979a15c35e3f92608b32b67db65b2043be65e1110484d2890bdcb58cf");
const contract_digest = h("19c84fd9c5a23682f892307d9f49f5733bab363dfabf7899dad00dbbff421e9b");
const publication_digest = h("dd68c9df80e767345aece0af7834845b4bf566fb24071c5a6975302d897a0ea0");
const bool_text = "sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721";
const i32_text = "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727";
const undefined_text = "sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b";
const environment_text = "env:sha256:03ae292f71f43181805d6071471d8be44fb6d12338a2e89fea975d95f8d380bc";
const binding_id = "literal:aliasFactory:counter";
const undefined_binding_id = "literal:aliasFactory:optionalValue";
const at: t.Origin = .{ .source = @enumFromInt(0), .start = 8, .end = 9 };
const entry_at: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 64 };
const condition_at: t.Origin = .{ .source = @enumFromInt(0), .start = 24, .end = 25 };
const fuel_entry = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const fuel_condition = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 2 } }};
const one = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "1" } }};
const alloc_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = "sha256:03ae292f71f43181805d6071471d8be44fb6d12338a2e89fea975d95f8d380bc" } }};
const cell_properties = [_]t.JsonMember{
    .{ .key = "binding", .value = .{ .string = binding_id } },
    .{ .key = "key", .value = .{ .string = "sha256:a5cc81769ad18ec84f2e9d91e8628d0e5929f8ffaad4aeef87de36df4706f8cb" } },
    .{ .key = "layout", .value = .{ .string = "sha256:03ae292f71f43181805d6071471d8be44fb6d12338a2e89fea975d95f8d380bc" } },
};
const undefined_properties = [_]t.JsonMember{
    .{ .key = "binding", .value = .{ .string = undefined_binding_id } },
    .{ .key = "key", .value = .{ .string = "sha256:b74a730414e9c84b9ae1aaf9e7721e60a80e96efdd65144a7614d0482e10664f" } },
    .{ .key = "layout", .value = .{ .string = "sha256:03ae292f71f43181805d6071471d8be44fb6d12338a2e89fea975d95f8d380bc" } },
};
// Instructions and plan rows below are independent typed literals. Unary Env
// forwarding is checked only through SSA; control-flow cases also match the
// unchanged SourcePlan after successful SSA. No TypeRef grants Env authority.
const seed = [_]ins.Instruction{
    .{ .source = entry_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = at, .result = r(1), .operands = &.{}, .data = .{ .const_i32 = 1 } },
    .{ .source = at, .result = r(2), .operands = &.{}, .data = .{ .domain_literal = .{ .actual_type = @enumFromInt(0) } } },
};
const seed_plan = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_entry, .source = entry_at, .result = null, .operands = &.{}, .successors = &.{} },
    .{ .name = "constant", .view = i32_text, .properties = &one, .source = at, .result = r(1), .operands = &.{}, .successors = &.{} },
    .{ .name = "undefined", .view = undefined_text, .properties = &.{}, .source = at, .result = r(2), .operands = &.{}, .successors = &.{} },
};
const type_property = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = i32_text } }};
const target_property = [_]t.JsonMember{.{ .key = "target", .value = .{ .string = i32_text } }};
const carrier_property = [_]t.JsonMember{.{ .key = "carrier", .value = .{ .string = environment_text } }};
const assertion_properties = [_]t.JsonMember{
    .{ .key = "annotationRange", .value = .{ .array = &.{ .{ .integer = 8 }, .{ .integer = 9 } } } },
    .{ .key = "operator", .value = .{ .string = "as" } },
    .{ .key = "operatorRange", .value = .{ .array = &.{ .{ .integer = 8 }, .{ .integer = 9 } } } },
};
const alloc: ins.Instruction = .{ .source = at, .result = r(3), .operands = &.{}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(0), .anchor_kind = .source } } };
const copy: ins.Instruction = .{ .source = at, .result = r(4), .operands = &.{r(3)}, .data = .{ .domain_copy = .{ .static_view = @enumFromInt(2) } } };
const view: ins.Instruction = .{ .source = at, .result = r(5), .operands = &.{r(4)}, .data = .{ .domain_view = .{ .static_view = @enumFromInt(2) } } };
const carrier: ins.Instruction = .{ .source = at, .result = r(6), .operands = &.{r(5)}, .data = .{ .eh_carrier = @enumFromInt(2) } };
const assertion: ins.Instruction = .{ .source = at, .result = r(7), .operands = &.{r(6)}, .data = .{ .eh_assertion = .{ .static_view = @enumFromInt(2), .operator = .as, .annotation = .{ .start = 8, .end = 9 }, .operator_anchor = .{ .start = 8, .end = 9 } } } };
const returned: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .@"return" };
const plan_alloc: control.SourcePlanOperation = .{ .name = "env_alloc", .view = environment_text, .properties = &alloc_properties, .source = at, .result = r(3), .operands = &.{}, .successors = &.{} };
const plan_copy: control.SourcePlanOperation = .{ .name = "value_copy", .view = i32_text, .properties = &type_property, .source = at, .result = r(4), .operands = &.{r(3)}, .successors = &.{} };
const plan_view: control.SourcePlanOperation = .{ .name = "view", .view = i32_text, .properties = &target_property, .source = at, .result = r(5), .operands = &.{r(4)}, .successors = &.{} };
const plan_carrier: control.SourcePlanOperation = .{ .name = "carrier_cast", .view = i32_text, .properties = &carrier_property, .source = at, .result = r(6), .operands = &.{r(5)}, .successors = &.{} };
const plan_assertion: control.SourcePlanOperation = .{ .name = "assert", .view = i32_text, .properties = &assertion_properties, .source = at, .result = r(7), .operands = &.{r(6)}, .successors = &.{} };
const plan_return: control.SourcePlanOperation = .{ .name = "func.return", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{} };
const aliases = [_]ins.Instruction{ alloc, copy, view, carrier, assertion };
const aliases_plan = [_]control.SourcePlanOperation{ plan_alloc, plan_copy, plan_view, plan_carrier, plan_assertion };
const unary_entry = seed ++ aliases;
const unary_entry_plan = seed_plan ++ aliases_plan;
const base_registers = [_]model.Register{
    .{ .carrier = .{ .@"type" = @enumFromInt(1) }, .view = @enumFromInt(1) },
    .{ .carrier = .{ .@"type" = @enumFromInt(2) }, .view = @enumFromInt(2) },
    .{ .carrier = .{ .@"type" = @enumFromInt(0) }, .view = @enumFromInt(0) },
    .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null },
};
const env_register: model.Register = .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null };
const value_register: model.Register = .{ .carrier = .{ .@"type" = @enumFromInt(2) }, .view = @enumFromInt(2) };
const unary_registers = base_registers ++ [_]model.Register{ env_register, env_register, env_register, env_register, value_register };
const unary_carriers = [_][]const u8{ bool_text, i32_text, undefined_text, environment_text, environment_text, environment_text, environment_text, environment_text, i32_text };
const branch_registers = base_registers ++ [_]model.Register{ env_register, value_register };
const branch_carriers = [_][]const u8{ bool_text, i32_text, undefined_text, environment_text, environment_text, i32_text };
const init_original: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_copy: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(4), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_view: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(5), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_carrier: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(6), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_assertion: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(7), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_other_slot: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(7), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(1), .anchor_kind = .source } } };
const load_original: ins.Instruction = .{ .source = at, .result = r(8), .operands = &.{r(3)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const load_copy: ins.Instruction = .{ .source = at, .result = r(8), .operands = &.{r(4)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const load_view: ins.Instruction = .{ .source = at, .result = r(8), .operands = &.{r(5)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const load_carrier: ins.Instruction = .{ .source = at, .result = r(8), .operands = &.{r(6)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const load_assertion: ins.Instruction = .{ .source = at, .result = r(8), .operands = &.{r(7)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const store_assertion: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(7), r(1) }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } };
const branch_load: ins.Instruction = .{ .source = at, .result = r(5), .operands = &.{r(4)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const branch_original_load: ins.Instruction = .{ .source = at, .result = r(5), .operands = &.{r(3)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const branch_store: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(4), r(1) }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } };
const branch_other_slot: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(4), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(1), .anchor_kind = .source } } };
const plan_init_original: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(3), r(1) }, .successors = &.{} };
const plan_init_copy: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(4), r(1) }, .successors = &.{} };
const plan_init_view: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(5), r(1) }, .successors = &.{} };
const plan_init_carrier: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(6), r(1) }, .successors = &.{} };
const plan_init_assertion: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(7), r(1) }, .successors = &.{} };
const plan_init_other_slot: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &undefined_properties, .source = at, .result = null, .operands = &.{ r(7), r(2) }, .successors = &.{} };
const plan_load_original: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(8), .operands = &.{r(3)}, .successors = &.{} };
const plan_load_copy: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(8), .operands = &.{r(4)}, .successors = &.{} };
const plan_load_view: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(8), .operands = &.{r(5)}, .successors = &.{} };
const plan_load_carrier: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(8), .operands = &.{r(6)}, .successors = &.{} };
const plan_load_assertion: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(8), .operands = &.{r(7)}, .successors = &.{} };
const plan_store_assertion: control.SourcePlanOperation = .{ .name = "env_store", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(7), r(1) }, .successors = &.{} };
const plan_branch_load: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(5), .operands = &.{r(4)}, .successors = &.{} };
const plan_branch_original_load: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(5), .operands = &.{r(3)}, .successors = &.{} };
const plan_branch_store: control.SourcePlanOperation = .{ .name = "env_store", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(4), r(1) }, .successors = &.{} };
const plan_branch_other_slot: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &undefined_properties, .source = at, .result = null, .operands = &.{ r(4), r(2) }, .successors = &.{} };
const copy_once_ops = unary_entry ++ [_]ins.Instruction{ init_copy, init_copy, load_copy, returned };
const copy_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_copy, plan_init_copy, plan_load_copy, plan_return };
const view_once_ops = unary_entry ++ [_]ins.Instruction{ init_view, init_view, load_view, returned };
const view_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_view, plan_init_view, plan_load_view, plan_return };
const carrier_once_ops = unary_entry ++ [_]ins.Instruction{ init_carrier, init_carrier, load_carrier, returned };
const carrier_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_carrier, plan_init_carrier, plan_load_carrier, plan_return };
const assertion_once_ops = unary_entry ++ [_]ins.Instruction{ init_assertion, init_assertion, load_assertion, returned };
const assertion_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_assertion, plan_init_assertion, plan_load_assertion, plan_return };
const copy_tdz_ops = unary_entry ++ [_]ins.Instruction{ load_copy, init_copy, returned };
const copy_tdz_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_load_copy, plan_init_copy, plan_return };
const view_tdz_ops = unary_entry ++ [_]ins.Instruction{ load_view, init_view, returned };
const view_tdz_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_load_view, plan_init_view, plan_return };
const carrier_tdz_ops = unary_entry ++ [_]ins.Instruction{ load_carrier, init_carrier, returned };
const carrier_tdz_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_load_carrier, plan_init_carrier, plan_return };
const assertion_tdz_ops = unary_entry ++ [_]ins.Instruction{ load_assertion, init_assertion, returned };
const assertion_tdz_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_load_assertion, plan_init_assertion, plan_return };
const store_tdz_ops = unary_entry ++ [_]ins.Instruction{ store_assertion, init_assertion, load_assertion, returned };
const store_tdz_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_store_assertion, plan_init_assertion, plan_load_assertion, plan_return };
const original_alias_once_ops = unary_entry ++ [_]ins.Instruction{ init_original, init_assertion, load_assertion, returned };
const original_alias_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_original, plan_init_assertion, plan_load_assertion, plan_return };
const alias_original_once_ops = unary_entry ++ [_]ins.Instruction{ init_assertion, init_original, load_assertion, returned };
const alias_original_once_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_assertion, plan_init_original, plan_load_assertion, plan_return };
const initialized_multihop_ops = unary_entry ++ [_]ins.Instruction{ init_copy, store_assertion, load_assertion, returned };
const initialized_multihop_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_copy, plan_store_assertion, plan_load_assertion, plan_return };
const original_alias_observe_ops = unary_entry ++ [_]ins.Instruction{ init_original, load_assertion, returned };
const original_alias_observe_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_original, plan_load_assertion, plan_return };
const alias_original_observe_ops = unary_entry ++ [_]ins.Instruction{ init_assertion, load_original, returned };
const alias_original_observe_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_assertion, plan_load_original, plan_return };
const separate_slots_ops = unary_entry ++ [_]ins.Instruction{ init_copy, init_other_slot, load_assertion, returned };
const separate_slots_plan = unary_entry_plan ++ [_]control.SourcePlanOperation{ plan_init_copy, plan_init_other_slot, plan_load_assertion, plan_return };
const to_alias: ins.Instruction = .{ .source = at, .result = null, .operands = &.{r(3)}, .data = .{ .br = .{ .destination = b(1) } } };
const plan_to_alias: control.SourcePlanOperation = .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(3)}, .successors = &.{b(1)} };
const branch_entry = seed ++ [_]ins.Instruction{ alloc, to_alias };
const branch_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_to_alias };
const to_next: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(2) } } };
const plan_to_next: control.SourcePlanOperation = .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(2)} };
const condition: ins.Instruction = .{ .source = condition_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .condition } } };
const plan_condition: control.SourcePlanOperation = .{ .name = "fuel", .view = "void", .properties = &fuel_condition, .source = condition_at, .result = null, .operands = &.{}, .successors = &.{} };
const choose: ins.Instruction = .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(2), .false_destination = b(3), .true_count = 0 } } };
const plan_choose: control.SourcePlanOperation = .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(2), b(3) } };
const to_join: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(4) } } };
const plan_to_join: control.SourcePlanOperation = .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(4)} };
const branch_once = [_]ins.Instruction{ init_copy, init_copy, branch_load, returned };
const branch_once_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_init_copy, plan_branch_load, plan_return };
const branch_tdz = [_]ins.Instruction{ branch_load, init_copy, returned };
const branch_tdz_plan = [_]control.SourcePlanOperation{ plan_branch_load, plan_init_copy, plan_return };
const branch_store_tdz = [_]ins.Instruction{ branch_store, init_copy, branch_load, returned };
const branch_store_tdz_plan = [_]control.SourcePlanOperation{ plan_branch_store, plan_init_copy, plan_branch_load, plan_return };
const branch_valid = [_]ins.Instruction{ init_copy, branch_store, branch_load, returned };
const branch_valid_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_store, plan_branch_load, plan_return };
const branch_original_observe = [_]ins.Instruction{ init_copy, branch_original_load, returned };
const branch_original_observe_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_original_load, plan_return };
const branch_slots = [_]ins.Instruction{ init_copy, branch_other_slot, branch_load, returned };
const branch_slots_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_other_slot, plan_branch_load, plan_return };
const branch_original_once_entry = seed ++ [_]ins.Instruction{ alloc, init_original, to_alias };
const branch_original_once_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_init_original, plan_to_alias };
const branch_cross_first = [_]ins.Instruction{ init_copy, to_next };
const branch_cross_first_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_to_next };
const branch_cross_second = [_]ins.Instruction{ init_copy, branch_load, returned };
const branch_cross_second_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_load, plan_return };
const loop_entry = seed ++ [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(1) } } }};
const loop_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(1)} }};
const fresh_alloc = [_]ins.Instruction{ condition, alloc, .{ .source = at, .result = null, .operands = &.{r(3)}, .data = .{ .br = .{ .destination = b(2) } } } };
const fresh_alloc_plan = [_]control.SourcePlanOperation{ plan_condition, plan_alloc, .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(3)}, .successors = &.{b(2)} } };
const fresh_body = [_]ins.Instruction{ init_copy, branch_load, .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(3), .true_count = 0 } } } };
const fresh_body_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_load, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(1), b(3) } } };
const repeated_body = [_]ins.Instruction{ condition, init_copy, branch_load, .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(2), .false_destination = b(3), .true_count = 0 } } } };
const repeated_body_plan = [_]control.SourcePlanOperation{ plan_condition, plan_init_copy, plan_branch_load, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(2), b(3) } } };
const second_alloc: ins.Instruction = .{ .source = at, .result = r(4), .operands = &.{}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(0), .anchor_kind = .source } } };
const plan_second_alloc: control.SourcePlanOperation = .{ .name = "env_alloc", .view = environment_text, .properties = &alloc_properties, .source = at, .result = r(4), .operands = &.{}, .successors = &.{} };
const distinct_registers = base_registers ++ [_]model.Register{ env_register, env_register, env_register, value_register };
const distinct_carriers = [_][]const u8{ bool_text, i32_text, undefined_text, environment_text, environment_text, environment_text, environment_text, i32_text };
const distinct_entry = seed ++ [_]ins.Instruction{ alloc, second_alloc, .{ .source = at, .result = null, .operands = &.{ r(3), r(4) }, .data = .{ .br = .{ .destination = b(1) } } } };
const distinct_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_second_alloc, .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(3), r(4) }, .successors = &.{b(1)} } };
const distinct_body = [_]ins.Instruction{ init_view, init_carrier, .{ .source = at, .result = r(7), .operands = &.{r(5)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } }, returned };
const distinct_body_plan = [_]control.SourcePlanOperation{ plan_init_view, plan_init_carrier, .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(7), .operands = &.{r(5)}, .successors = &.{} }, plan_return };
const hop_registers = base_registers ++ [_]model.Register{ env_register, env_register, value_register };
const hop_carriers = [_][]const u8{ bool_text, i32_text, undefined_text, environment_text, environment_text, environment_text, i32_text };
const hop_middle = [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(4)}, .data = .{ .br = .{ .destination = b(2) } } }};
const hop_middle_plan = [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(4)}, .successors = &.{b(2)} }};
const hop_body = [_]ins.Instruction{ init_view, .{ .source = at, .result = r(6), .operands = &.{r(5)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } }, returned };
const hop_body_plan = [_]control.SourcePlanOperation{ plan_init_view, .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(6), .operands = &.{r(5)}, .successors = &.{} }, plan_return };
const merge_registers = unary_registers;
const merge_carriers = unary_carriers;
const merge_entry = seed ++ [_]ins.Instruction{ alloc, second_alloc, .{ .source = at, .result = null, .operands = &.{ r(0), r(3), r(4) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 1 } } } };
const merge_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_second_alloc, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(3), r(4) }, .successors = &.{ b(1), b(2) } } };
const merge_left = [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(5)}, .data = .{ .br = .{ .destination = b(3) } } }};
const merge_left_plan = [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(5)}, .successors = &.{b(3)} }};
const merge_right = [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(6)}, .data = .{ .br = .{ .destination = b(3) } } }};
const merge_right_plan = [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(6)}, .successors = &.{b(3)} }};
const double_edge_entry = seed ++ [_]ins.Instruction{ alloc, second_alloc, .{ .source = at, .result = null, .operands = &.{ r(0), r(3), r(4) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(1), .true_count = 1 } } } };
const double_edge_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_second_alloc, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(3), r(4) }, .successors = &.{ b(1), b(1) } } };
const double_edge_body = [_]ins.Instruction{.{ .source = at, .result = r(6), .operands = &.{r(5)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } }, returned };
const double_edge_body_plan = [_]control.SourcePlanOperation{.{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(6), .operands = &.{r(5)}, .successors = &.{} }, plan_return };
const readonly_store: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(4), r(2) }, .data = .{ .environment_store = .{ .slot = @enumFromInt(1) } } };
const plan_readonly_store: control.SourcePlanOperation = .{ .name = "env_store", .view = "void", .properties = &undefined_properties, .source = at, .result = null, .operands = &.{ r(4), r(2) }, .successors = &.{} };
const conditional_entry = seed ++ [_]ins.Instruction{ alloc, .{ .source = at, .result = null, .operands = &.{ r(0), r(3) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 1 } } } };
const conditional_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(3) }, .successors = &.{ b(1), b(2) } } };
// Same-allocation conditional, diamond and loop parameters. These use only
// existing control-flow transport and retain complete passive plan matching.
const conditional_valid = [_]ins.Instruction{ init_copy, branch_store, branch_load, returned };
const conditional_valid_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_store, plan_branch_load, plan_return };
const conditional_original = [_]ins.Instruction{ init_copy, branch_original_load, returned };
const conditional_original_plan = [_]control.SourcePlanOperation{ plan_init_copy, plan_branch_original_load, plan_return };
const same_edge_entry = seed ++ [_]ins.Instruction{ alloc, .{ .source = at, .result = null, .operands = &.{ r(0), r(3), r(3) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(1), .true_count = 1 } } } };
const same_edge_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(3), r(3) }, .successors = &.{ b(1), b(1) } } };
const same_merge_entry = seed ++ [_]ins.Instruction{ alloc, .{ .source = at, .result = null, .operands = &.{ r(0), r(3), r(3) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 1 } } } };
const same_merge_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(3), r(3) }, .successors = &.{ b(1), b(2) } } };
const same_merge_left = [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(4)}, .data = .{ .br = .{ .destination = b(3) } } }};
const same_merge_left_plan = [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(4)}, .successors = &.{b(3)} }};
const same_merge_right = [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(5)}, .data = .{ .br = .{ .destination = b(3) } } }};
const same_merge_right_plan = [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(5)}, .successors = &.{b(3)} }};
const same_merge_load: ins.Instruction = .{ .source = at, .result = r(7), .operands = &.{r(6)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const same_merge_store: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(6), r(1) }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } };
const plan_same_merge_load: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(7), .operands = &.{r(6)}, .successors = &.{} };
const plan_same_merge_store: control.SourcePlanOperation = .{ .name = "env_store", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(6), r(1) }, .successors = &.{} };
const seeded_loop_entry = seed ++ [_]ins.Instruction{ alloc, init_original, to_alias };
const seeded_loop_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_init_original, plan_to_alias };
const seeded_loop_back: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(0), r(4) }, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 1 } } };
const plan_seeded_loop_back: control.SourcePlanOperation = .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(4) }, .successors = &.{ b(1), b(2) } };
const seeded_loop_valid = [_]ins.Instruction{ condition, branch_store, branch_load, seeded_loop_back };
const seeded_loop_valid_plan = [_]control.SourcePlanOperation{ plan_condition, plan_branch_store, plan_branch_load, plan_seeded_loop_back };
const seeded_loop_repeat = [_]ins.Instruction{ condition, init_copy, branch_load, seeded_loop_back };
const seeded_loop_repeat_plan = [_]control.SourcePlanOperation{ plan_condition, plan_init_copy, plan_branch_load, plan_seeded_loop_back };
// Block2 is unreachable Common CFG with its own ungrounded Env cycle. Its edge
// into block1 must prevent borrowing block0's allocation as a total proof.
const seedless_load: ins.Instruction = .{ .source = at, .result = r(6), .operands = &.{r(4)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const plan_seedless_load: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(6), .operands = &.{r(4)}, .successors = &.{} };
const seedless_entry = seed ++ [_]ins.Instruction{ alloc,
    .{ .source = at, .result = null, .operands = &.{ r(3), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(1), .anchor_kind = .source } } }, to_alias };
const seedless_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc,
    .{ .name = "env_init", .view = "void", .properties = &undefined_properties, .source = at, .result = null, .operands = &.{ r(3), r(2) }, .successors = &.{} }, plan_to_alias };
const seedless_body = [_]ins.Instruction{ condition, .{ .source = at, .result = null, .operands = &.{ r(0), r(5), r(5) }, .data = .{ .cond_br = .{ .true_destination = b(2), .false_destination = b(1), .true_count = 1 } } } };
const seedless_body_plan = [_]control.SourcePlanOperation{ plan_condition, .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{ r(0), r(5), r(5) }, .successors = &.{ b(2), b(1) } } };
const Case = struct {
    name: []const u8, accept: bool,
    registers: []const model.Register = &unary_registers,
    carriers: []const []const u8 = &unary_carriers,
    blocks: []const model.Block, plans: []const control.SourcePlanBlock,
    match_plan: bool = false,
};
const cases = [_]Case{
    .{ .name = "unary copy_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &copy_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &copy_once_plan }} },
    .{ .name = "unary view_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &view_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &view_once_plan }} },
    .{ .name = "unary carrier_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &carrier_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &carrier_once_plan }} },
    .{ .name = "unary assertion_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &assertion_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &assertion_once_plan }} },
    .{ .name = "unary copy_tdz", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &copy_tdz_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &copy_tdz_plan }} },
    .{ .name = "unary view_tdz", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &view_tdz_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &view_tdz_plan }} },
    .{ .name = "unary carrier_tdz", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &carrier_tdz_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &carrier_tdz_plan }} },
    .{ .name = "unary assertion_tdz", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &assertion_tdz_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &assertion_tdz_plan }} },
    .{ .name = "unary store_tdz", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &store_tdz_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &store_tdz_plan }} },
    .{ .name = "unary original_alias_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &original_alias_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &original_alias_once_plan }} },
    .{ .name = "unary alias_original_once", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &alias_original_once_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &alias_original_once_plan }} },
    .{ .name = "unary initialized_multihop", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &initialized_multihop_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &initialized_multihop_plan }} },
    .{ .name = "unary original_alias_observe", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &original_alias_observe_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &original_alias_observe_plan }} },
    .{ .name = "unary alias_original_observe", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &alias_original_observe_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &alias_original_observe_plan }} },
    .{ .name = "unary separate_slots", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &separate_slots_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &separate_slots_plan }} },
    .{ .name = "br initialized alias", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_valid } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_valid_plan } } },
    .{ .name = "br duplicate alias init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_once } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_once_plan } } },
    .{ .name = "br alias load before init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_tdz } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_tdz_plan } } },
    .{ .name = "br alias load without init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_branch_load, plan_return } } } },
    .{ .name = "br alias store before init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_store_tdz } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_store_tdz_plan } } },
    .{ .name = "br alias init original load", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_original_observe } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_original_observe_plan } } },
    .{ .name = "br separate slots", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_slots } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_slots_plan } } },
    .{ .name = "br readonly store permission", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ init_copy, readonly_store, branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_init_copy, plan_readonly_store, plan_branch_load, plan_return } } } },
    .{ .name = "br original then alias duplicate init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_original_once_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ init_copy, branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_original_once_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_init_copy, plan_branch_load, plan_return } } } },
    .{ .name = "br cross block duplicate init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_cross_first }, .{ .parameters = &.{}, .instructions = &branch_cross_second } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_cross_first_plan }, .{ .parameters = &.{}, .operations = &branch_cross_second_plan } } },
    .{ .name = "br exclusive init arms", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{choose} }, .{ .parameters = &.{}, .instructions = &.{ init_copy, to_join } }, .{ .parameters = &.{}, .instructions = &.{ init_copy, to_join } }, .{ .parameters = &.{}, .instructions = &.{ branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{plan_choose} }, .{ .parameters = &.{}, .operations = &.{ plan_init_copy, plan_to_join } }, .{ .parameters = &.{}, .operations = &.{ plan_init_copy, plan_to_join } }, .{ .parameters = &.{}, .operations = &.{ plan_branch_load, plan_return } } } },
    .{ .name = "br missing init arm", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{choose} }, .{ .parameters = &.{}, .instructions = &.{ init_copy, to_join } }, .{ .parameters = &.{}, .instructions = &.{to_join} }, .{ .parameters = &.{}, .instructions = &.{ branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{plan_choose} }, .{ .parameters = &.{}, .operations = &.{ plan_init_copy, plan_to_join } }, .{ .parameters = &.{}, .operations = &.{plan_to_join} }, .{ .parameters = &.{}, .operations = &.{ plan_branch_load, plan_return } } } },
    .{ .name = "br fresh allocation per loop", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &loop_entry }, .{ .parameters = &.{}, .instructions = &fresh_alloc }, .{ .parameters = &.{r(4)}, .instructions = &fresh_body }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &loop_entry_plan }, .{ .parameters = &.{}, .operations = &fresh_alloc_plan }, .{ .parameters = &.{r(4)}, .operations = &fresh_body_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "br repeated init loop without allocation", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{to_next} }, .{ .parameters = &.{}, .instructions = &repeated_body }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{plan_to_next} }, .{ .parameters = &.{}, .operations = &repeated_body_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "br distinct allocations", .accept = true, .registers = &distinct_registers, .carriers = &distinct_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &distinct_entry }, .{ .parameters = &.{ r(5), r(6) }, .instructions = &distinct_body } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &distinct_entry_plan }, .{ .parameters = &.{ r(5), r(6) }, .operations = &distinct_body_plan } } },
    .{ .name = "br multihop initialization", .accept = true, .registers = &hop_registers, .carriers = &hop_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &hop_middle }, .{ .parameters = &.{r(5)}, .instructions = &hop_body } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &hop_middle_plan }, .{ .parameters = &.{r(5)}, .operations = &hop_body_plan } } },
    // The single conditional edge has one proven root and requires I.
    // Different-allocation merges retain their prior incomplete treatment.
    .{ .name = "conditional same root load requires initialization", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &conditional_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ branch_load, returned } }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &conditional_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_branch_load, plan_return } }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "different allocation merge load unchanged", .accept = true, .registers = &merge_registers, .carriers = &merge_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &merge_entry }, .{ .parameters = &.{r(5)}, .instructions = &merge_left }, .{ .parameters = &.{r(6)}, .instructions = &merge_right }, .{ .parameters = &.{r(7)}, .instructions = &.{ load_assertion, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &merge_entry_plan }, .{ .parameters = &.{r(5)}, .operations = &merge_left_plan }, .{ .parameters = &.{r(6)}, .operations = &merge_right_plan }, .{ .parameters = &.{r(7)}, .operations = &.{ plan_load_assertion, plan_return } } } },
    .{ .name = "different allocation merge init unchanged", .accept = true, .registers = &merge_registers, .carriers = &merge_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &merge_entry }, .{ .parameters = &.{r(5)}, .instructions = &merge_left }, .{ .parameters = &.{r(6)}, .instructions = &merge_right }, .{ .parameters = &.{r(7)}, .instructions = &.{ init_assertion, init_assertion, load_assertion, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &merge_entry_plan }, .{ .parameters = &.{r(5)}, .operations = &merge_left_plan }, .{ .parameters = &.{r(6)}, .operations = &merge_right_plan }, .{ .parameters = &.{r(7)}, .operations = &.{ plan_init_assertion, plan_init_assertion, plan_load_assertion, plan_return } } } },
    .{ .name = "two conditional edges from one predecessor unchanged", .accept = true, .registers = &hop_registers, .carriers = &hop_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &double_edge_entry }, .{ .parameters = &.{r(5)}, .instructions = &double_edge_body } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &double_edge_entry_plan }, .{ .parameters = &.{r(5)}, .operations = &double_edge_body_plan } } },
    .{ .name = "conditional same root initialized alias", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &conditional_entry }, .{ .parameters = &.{r(4)}, .instructions = &conditional_valid }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &conditional_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &conditional_valid_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "conditional same root duplicate init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &conditional_entry }, .{ .parameters = &.{r(4)}, .instructions = &branch_once }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &conditional_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &branch_once_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "conditional same root init original load", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &conditional_entry }, .{ .parameters = &.{r(4)}, .instructions = &conditional_original }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &conditional_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &conditional_original_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "two conditional same root edges require initialization", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &same_edge_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ branch_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &same_edge_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_branch_load, plan_return } } } },
    .{ .name = "same root diamond load requires initialization", .accept = false, .registers = &distinct_registers, .carriers = &distinct_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &same_merge_entry }, .{ .parameters = &.{r(4)}, .instructions = &same_merge_left }, .{ .parameters = &.{r(5)}, .instructions = &same_merge_right }, .{ .parameters = &.{r(6)}, .instructions = &.{ same_merge_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &same_merge_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &same_merge_left_plan }, .{ .parameters = &.{r(5)}, .operations = &same_merge_right_plan }, .{ .parameters = &.{r(6)}, .operations = &.{ plan_same_merge_load, plan_return } } } },
    .{ .name = "same root diamond initialized alias", .accept = true, .registers = &distinct_registers, .carriers = &distinct_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &same_merge_entry }, .{ .parameters = &.{r(4)}, .instructions = &same_merge_left }, .{ .parameters = &.{r(5)}, .instructions = &same_merge_right }, .{ .parameters = &.{r(6)}, .instructions = &.{ init_carrier, same_merge_store, same_merge_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &same_merge_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &same_merge_left_plan }, .{ .parameters = &.{r(5)}, .operations = &same_merge_right_plan }, .{ .parameters = &.{r(6)}, .operations = &.{ plan_init_carrier, plan_same_merge_store, plan_same_merge_load, plan_return } } } },
    .{ .name = "same root diamond duplicate init", .accept = false, .registers = &distinct_registers, .carriers = &distinct_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &same_merge_entry }, .{ .parameters = &.{r(4)}, .instructions = &same_merge_left }, .{ .parameters = &.{r(5)}, .instructions = &same_merge_right }, .{ .parameters = &.{r(6)}, .instructions = &.{ init_carrier, init_carrier, same_merge_load, returned } } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &same_merge_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &same_merge_left_plan }, .{ .parameters = &.{r(5)}, .operations = &same_merge_right_plan }, .{ .parameters = &.{r(6)}, .operations = &.{ plan_init_carrier, plan_init_carrier, plan_same_merge_load, plan_return } } } },
    .{ .name = "same root seeded loop initialized reads", .accept = true, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &seeded_loop_entry }, .{ .parameters = &.{r(4)}, .instructions = &seeded_loop_valid }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &seeded_loop_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &seeded_loop_valid_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "same root seeded loop repeated init", .accept = false, .registers = &branch_registers, .carriers = &branch_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &branch_entry }, .{ .parameters = &.{r(4)}, .instructions = &seeded_loop_repeat }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &branch_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &seeded_loop_repeat_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "root plus seedless cycle remains unproven with independent init", .accept = true, .registers = &hop_registers, .carriers = &hop_carriers, .match_plan = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &seedless_entry }, .{ .parameters = &.{r(4)}, .instructions = &.{ seedless_load, returned } }, .{ .parameters = &.{r(5)}, .instructions = &seedless_body } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &seedless_entry_plan }, .{ .parameters = &.{r(4)}, .operations = &.{ plan_seedless_load, plan_return } }, .{ .parameters = &.{r(5)}, .operations = &seedless_body_plan } } },

};
const types = [_]tables.CommonType{
    .{ .id = undefined_id, .kind = .@"undefined", .name = "undefined", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = bool_id, .kind = .scalar, .name = "bool", .native_code = 2, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = i32_id, .kind = .scalar, .name = "i32", .native_code = 1, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = void_id, .kind = .@"void", .name = "void", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
};
const bindings = [_]storage.CommonBinding{
    .{ .id = binding_id, .owner = .{ .local = @enumFromInt(0) }, .name = "counter", .@"type" = @enumFromInt(2), .writable = true, .origin = at, .carrier = .{ .@"type" = @enumFromInt(2) }, .scope = @enumFromInt(0), .declaration_kind = .local },
    .{ .id = "literal:aliasFactory:gate", .owner = .{ .param = @enumFromInt(0) }, .name = "gate", .@"type" = @enumFromInt(1), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(1) }, .scope = @enumFromInt(0), .declaration_kind = .parameter },
    .{ .id = undefined_binding_id, .owner = .{ .local = @enumFromInt(0) }, .name = "optionalValue", .@"type" = @enumFromInt(0), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(0) }, .scope = @enumFromInt(0), .declaration_kind = .local },
};
const scope: publication.StableScope = .{
    .profile = .@"common-program-fixed-v6", .declaration_types = &.{ undefined_id, bool_id, i32_id, void_id }, .constructions = &.{},
    .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path, .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} },
    .types = &.{
        .{ .id = undefined_id, .label = "{\"kind\":\"undefined\",\"name\":\"undefined\"}", .shape = .{ .primitive = .{ .kind = .@"undefined", .label = "{\"kind\":\"undefined\",\"name\":\"undefined\"}" } } },
        .{ .id = bool_id, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}" } } },
        .{ .id = i32_id, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}" } } },
        .{ .id = void_id, .label = "{\"kind\":\"void\",\"name\":\"void\"}", .shape = .{ .primitive = .{ .kind = .@"void", .label = "{\"kind\":\"void\",\"name\":\"void\"}" } } },
    },
    .functions = &.{.{ .function_id = function_id, .signature_hash = signature, .kind = .source,
        .decl_key = .{ .kind = .function, .name = "aliasFactory", .path = &.{ "function", "aliasFactory" }, .source_path = source_path },
        .parameter_types = &.{bool_id}, .method_minimum_argument_count = null, .ordinary_parameter_initialization = null, .return_type = void_id, .construction = null, .lexical_parent = null,
        .lexical_environment = null, .activation_environment = environment_id, .captures = &.{}, .access = .public }},
    .globals = &.{}, .environments = &.{.{ .id = environment_id, .owner = function_id, .parent = null,
        .slots = &.{ .{ .key = slot_key, .kind = .local, .@"type" = i32_id, .writable = true }, .{ .key = undefined_key, .kind = .local, .@"type" = undefined_id, .writable = false } } }},
    .host_context = null, .host_imports = &.{},
};
const upper: publication.EffectUpper = .{
    .parameters = &.{}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = true, .@"await" = false, .eh_control = false, .escape = false, .lock = false, .managed_reference = true, .may_throw = false, .unknown_host = false },
};
const Fixture = struct {
    program: model.Program,
    functions: [1]model.Function,
    abis: [1]storage.CommonAbi,
    // In-place initialization keeps all self-backed slices valid throughout the
    // shared Context lifetime; no shallow return/copy claims ownership.
    fn init(self: *Fixture, case: Case) void {
        self.functions[0] = .{ .id = function_id, .signature = signature, .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .ordinary,
            .declaration = .{ .start = 0, .end = 64 }, .name = "aliasFactory", .registers = case.registers, .blocks = case.blocks };
        self.abis[0] = .{ .kind = .common, .function = @enumFromInt(0), .signature = signature,
            .parameters = &.{@enumFromInt(1)}, .argument_types = &.{@enumFromInt(1)}, .method_minimum_argument_count = null, .ordinary_minimum_argument_count = null, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = &.{.{ .@"type" = @enumFromInt(1) }}, .result = null, .result_carrier = null,
            .source_plan = .{ .carriers = case.carriers, .blocks = case.plans } };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = model.format.version, .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout, .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = model.format.capability },
            .input_identity = input_hash, .source_hash = source_hash, .source_path = source_path, .source_length = 96, .root_source = @enumFromInt(0),
            .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 96 }}, .mode = .{ .common = .{
                .types = &types, .members = .{ .fields = &.{}, .methods = &.{}, .constructions = &.{} }, .domains = &.{},
                .storage = .{ .bindings = &bindings, .concrete = &.{
                    .{ .@"type" = @enumFromInt(1), .carrier = .{ .layout = .{ .byte_size = 1, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                    .{ .@"type" = @enumFromInt(2), .carrier = .{ .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                    .{ .@"type" = @enumFromInt(3), .carrier = .{ .layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                    .{ .@"type" = @enumFromInt(0), .carrier = .{ .layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                }, .arrays = &.{}, .environments = &.{.{ .environment = @enumFromInt(0), .byte_size = 4, .alignment = 4, .reference_count = 0, .parent_offset = null, .slot_offsets = &.{ 0, 4 } }},
                    .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } },
                .views = .{ .compatibility = &.{}, .dispatch = &.{}, .entries = &.{} }, .abis = &self.abis,
                .modules = .{ .modules = &.{}, .globals = &.{}, .hosts = &.{}, .initialization = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} } },
                .authority = .{ .exports = .{}, .entries = .{}, .resources = .{}, .published = .{}, .fixed_publication = .{
                    .stable_scope = scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 6 }, .mode = .fixed, .scope = scope,
                        .scope_digest = scope_digest, .expected_digest = publication_digest, .contracts = &.{.{ .function_id = function_id, .signature_hash = signature,
                            .upper = upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = null, .digest = contract_digest }} },
                    .dependencies = &.{.{ .function_id = function_id, .callees = &.{}, .hosts = &.{} }}, .request = .{ .targets = &.{} } } },
                .closures = .{ .functions = &.{.{ .function = @enumFromInt(0), .parent = null, .lexical_environment = null, .activation_environment = @enumFromInt(0), .captures = &.{} }},
                    .environments = &.{.{ .id = environment_id, .owner = @enumFromInt(0), .parent = null, .slots = &.{ .{ .binding = @enumFromInt(0), .key = slot_key, .kind = .local, .@"type" = @enumFromInt(2), .writable = true }, .{ .binding = @enumFromInt(2), .key = undefined_key, .kind = .local, .@"type" = @enumFromInt(0), .writable = false } } }}, .calls = &.{} },
                .exceptions = .{ .functions = &.{.{ .function = @enumFromInt(0), .handlers = &.{} }}, .bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(0) } },
                    .scopes = &.{.{ .owner = @enumFromInt(0), .path = &.{} }} },
            } } }, .functions = &self.functions };
    }
};
fn run(case: Case) !void {
    var fixture: Fixture = undefined;
    fixture.init(case);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    // Every case must pass these actual prerequisites before the SSA oracle.
    try refs.check(&c);
    try layout.check(&c);
    try identity.check(&c);
    const before_ssa = c.remaining;
    const result = ssa.check(&c);
    // Control-flow cases also prove correspondence if SSA accepts. On the
    // old checker each missed rejection reaches this unchanged matcher first.
    // Unary Env forwarding has a separate, explicitly OPEN SourceCorr seam.
    if (result) |_| {
        if (case.match_plan) try correspondence.check(&c);
    } else |_| {}
    if (case.accept) try result else try std.testing.expectError(error.InvalidShape, result);
    try std.testing.expect(c.remaining < before_ssa and c.remaining > 0);
}
test "literal Env alias unary copy_once" { try run(cases[0]); }
test "literal Env alias unary view_once" { try run(cases[1]); }
test "literal Env alias unary carrier_once" { try run(cases[2]); }
test "literal Env alias unary assertion_once" { try run(cases[3]); }
test "literal Env alias unary copy_tdz" { try run(cases[4]); }
test "literal Env alias unary view_tdz" { try run(cases[5]); }
test "literal Env alias unary carrier_tdz" { try run(cases[6]); }
test "literal Env alias unary assertion_tdz" { try run(cases[7]); }
test "literal Env alias unary store_tdz" { try run(cases[8]); }
test "literal Env alias unary original_alias_once" { try run(cases[9]); }
test "literal Env alias unary alias_original_once" { try run(cases[10]); }
test "literal Env alias unary initialized_multihop" { try run(cases[11]); }
test "literal Env alias unary original_alias_observe" { try run(cases[12]); }
test "literal Env alias unary alias_original_observe" { try run(cases[13]); }
test "literal Env alias unary separate_slots" { try run(cases[14]); }
test "literal Env alias br initialized alias" { try run(cases[15]); }
test "literal Env alias br duplicate alias init" { try run(cases[16]); }
test "literal Env alias br alias load before init" { try run(cases[17]); }
test "literal Env alias br alias load without init" { try run(cases[18]); }
test "literal Env alias br alias store before init" { try run(cases[19]); }
test "literal Env alias br alias init original load" { try run(cases[20]); }
test "literal Env alias br separate slots" { try run(cases[21]); }
test "literal Env alias br readonly store permission" { try run(cases[22]); }
test "literal Env alias br original then alias duplicate init" { try run(cases[23]); }
test "literal Env alias br cross block duplicate init" { try run(cases[24]); }
test "literal Env alias br exclusive init arms" { try run(cases[25]); }
test "literal Env alias br missing init arm" { try run(cases[26]); }
test "literal Env alias br fresh allocation per loop" { try run(cases[27]); }
test "literal Env alias br repeated init loop without allocation" { try run(cases[28]); }
test "literal Env alias br distinct allocations" { try run(cases[29]); }
test "literal Env alias br multihop initialization" { try run(cases[30]); }
test "literal Env alias conditional same root load requires initialization" { try run(cases[31]); }
test "literal Env alias different allocation merge load unchanged" { try run(cases[32]); }
test "literal Env alias different allocation merge init unchanged" { try run(cases[33]); }
test "literal Env alias two conditional edges from one predecessor unchanged" { try run(cases[34]); }
test "literal Env alias conditional same root initialized alias" { try run(cases[35]); }
test "literal Env alias conditional same root duplicate init" { try run(cases[36]); }
test "literal Env alias conditional same root init original load" { try run(cases[37]); }
test "literal Env alias two conditional same root edges require initialization" { try run(cases[38]); }
test "literal Env alias same root diamond load requires initialization" { try run(cases[39]); }
test "literal Env alias same root diamond initialized alias" { try run(cases[40]); }
test "literal Env alias same root diamond duplicate init" { try run(cases[41]); }
test "literal Env alias same root seeded loop initialized reads" { try run(cases[42]); }
test "literal Env alias same root seeded loop repeated init" { try run(cases[43]); }
test "literal Env alias root plus seedless cycle remains unproven with independent init" { try run(cases[44]); }
