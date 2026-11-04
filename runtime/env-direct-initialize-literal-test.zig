// SPDX-License-Identifier: MIT
// Independent literal typed metadata for the direct original Env-result slice.
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
const source_path = "/literal-env-direct-initialize.ts";
const source_hash = h("1ab49bdebfe447e87ba7af3c569c342f5f90c70cf837c06271ec04db80c3c20a");
const input_hash = h("9880b025957b0f47dac9e824665d13023fed2178895fc73ddfee5b11152a6de5");
const payload_hash = h("45cfc16cc90af95be8ee9edd88d19ad75813749b4044c65964b064e646815203");
const bool_id = h("811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721");
const i32_id = h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727");
const void_id = h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190");
const function_id = h("077f98bfa1152118761239b2b66aa950f40d3060b8d1ecd60a3b4f8cb0d157ce");
const signature = h("3b23153e45e84b8bbf61a7006f338a6cd46cab42213bf55631c0eb566b559c37");
const environment_id = h("33a7cc3d485a8ce7204bdd1237841cac6060528329b8a5705da0cdccc4f5e82c");
const slot_key = h("dcbda08418e80e57be7764a3c87d16b93c3d37b17c9065e9d69313e5d1fe1c22");
const scope_digest = h("b9a83293ff38b307349b9977a1c732afed11309ec8035032d7c99f86603ce73b");
const contract_digest = h("aa32107e7c701965140953ce17667e0f16cc0824faa4163f9e1e3830e617986d");
const publication_digest = h("51a8b20437e93f0c2ab0657187c91c01ed5d844afa0f719b14bd5f4c9266f015");
const bool_text = "sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721";
const i32_text = "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727";
const environment_text = "env:sha256:33a7cc3d485a8ce7204bdd1237841cac6060528329b8a5705da0cdccc4f5e82c";
const binding_id = "literal:factory:saved";
const at: t.Origin = .{ .source = @enumFromInt(0), .start = 8, .end = 9 };
const entry_at: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 64 };
const condition_at: t.Origin = .{ .source = @enumFromInt(0), .start = 24, .end = 25 };
const fuel_entry = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const fuel_condition = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 2 } }};
const one = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "1" } }};
const two = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "2" } }};
const alloc_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = "sha256:33a7cc3d485a8ce7204bdd1237841cac6060528329b8a5705da0cdccc4f5e82c" } }};
const init_properties = [_]t.JsonMember{
    .{ .key = "binding", .value = .{ .string = binding_id } },
    .{ .key = "key", .value = .{ .string = "sha256:dcbda08418e80e57be7764a3c87d16b93c3d37b17c9065e9d69313e5d1fe1c22" } },
    .{ .key = "layout", .value = .{ .string = "sha256:33a7cc3d485a8ce7204bdd1237841cac6060528329b8a5705da0cdccc4f5e82c" } },
};
// Separate hand-written wire and logical rows: the expected logical operations
// are never projected from instructions by the checker or fixture initializer.
const prefix = [_]ins.Instruction{
    .{ .source = at, .result = r(3), .operands = &.{}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(0), .anchor_kind = .source } } },
    .{ .source = entry_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
    .{ .source = at, .result = r(1), .operands = &.{}, .data = .{ .const_i32 = 1 } },
    .{ .source = at, .result = r(2), .operands = &.{}, .data = .{ .const_i32 = 2 } },
};
const prefix_plan = [_]control.SourcePlanOperation{
    .{ .name = "env_alloc", .view = environment_text, .properties = &alloc_properties, .source = at, .result = r(3), .operands = &.{}, .successors = &.{} },
    .{ .name = "fuel", .view = "void", .properties = &fuel_entry, .source = entry_at, .result = null, .operands = &.{}, .successors = &.{} },
    .{ .name = "constant", .view = i32_text, .properties = &one, .source = at, .result = r(1), .operands = &.{}, .successors = &.{} },
    .{ .name = "constant", .view = i32_text, .properties = &two, .source = at, .result = r(2), .operands = &.{}, .successors = &.{} },
};
const init_first: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_second: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const init_other: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(4), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const fresh: ins.Instruction = .{ .source = at, .result = r(4), .operands = &.{}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(0), .anchor_kind = .source } } };
const returned: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .@"return" };
const plan_first: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &init_properties, .source = at, .result = null, .operands = &.{ r(3), r(1) }, .successors = &.{} };
const plan_second: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &init_properties, .source = at, .result = null, .operands = &.{ r(3), r(2) }, .successors = &.{} };
const plan_other: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &init_properties, .source = at, .result = null, .operands = &.{ r(4), r(2) }, .successors = &.{} };
const plan_fresh: control.SourcePlanOperation = .{ .name = "env_alloc", .view = environment_text, .properties = &alloc_properties, .source = at, .result = r(4), .operands = &.{}, .successors = &.{} };
const plan_return: control.SourcePlanOperation = .{ .name = "func.return", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{} };
const single_ops = prefix ++ [_]ins.Instruction{ init_first, returned };
const single_plan = prefix_plan ++ [_]control.SourcePlanOperation{ plan_first, plan_return };
const double_ops = prefix ++ [_]ins.Instruction{ init_first, init_second, returned };
const double_plan = prefix_plan ++ [_]control.SourcePlanOperation{ plan_first, plan_second, plan_return };
const distinct_ops = prefix ++ [_]ins.Instruction{ fresh, init_first, init_other, returned };
const distinct_plan = prefix_plan ++ [_]control.SourcePlanOperation{ plan_fresh, plan_first, plan_other, plan_return };
const exclusive_entry = prefix ++ [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 0 } } }};
const exclusive_entry_plan = prefix_plan ++ [_]control.SourcePlanOperation{.{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(1), b(2) } }};
const to_join: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(3) } } };
const plan_join: control.SourcePlanOperation = .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(3)} };
const exclusive_left = [_]ins.Instruction{ init_first, to_join };
const exclusive_right = [_]ins.Instruction{ init_second, to_join };
const exclusive_left_plan = [_]control.SourcePlanOperation{ plan_first, plan_join };
const exclusive_right_plan = [_]control.SourcePlanOperation{ plan_second, plan_join };
const loop_entry = prefix ++ [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(1) } } }};
const loop_entry_plan = prefix_plan ++ [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(1)} }};
const loop_body = [_]ins.Instruction{
    .{ .source = condition_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .condition } } },
    fresh, init_other,
    .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 0 } } },
};
const loop_body_plan = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_condition, .source = condition_at, .result = null, .operands = &.{}, .successors = &.{} },
    plan_fresh, plan_other,
    .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(1), b(2) } },
};
const single_blocks = [_]model.Block{.{ .parameters = &.{r(0)}, .instructions = &single_ops }};
const double_blocks = [_]model.Block{.{ .parameters = &.{r(0)}, .instructions = &double_ops }};
const distinct_blocks = [_]model.Block{.{ .parameters = &.{r(0)}, .instructions = &distinct_ops }};
const single_plans = [_]control.SourcePlanBlock{.{ .parameters = &.{r(0)}, .operations = &single_plan }};
const double_plans = [_]control.SourcePlanBlock{.{ .parameters = &.{r(0)}, .operations = &double_plan }};
const distinct_plans = [_]control.SourcePlanBlock{.{ .parameters = &.{r(0)}, .operations = &distinct_plan }};
const exclusive_blocks = [_]model.Block{
    .{ .parameters = &.{r(0)}, .instructions = &exclusive_entry },
    .{ .parameters = &.{}, .instructions = &exclusive_left },
    .{ .parameters = &.{}, .instructions = &exclusive_right },
    .{ .parameters = &.{}, .instructions = &.{returned} },
};
const exclusive_plans = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r(0)}, .operations = &exclusive_entry_plan },
    .{ .parameters = &.{}, .operations = &exclusive_left_plan },
    .{ .parameters = &.{}, .operations = &exclusive_right_plan },
    .{ .parameters = &.{}, .operations = &.{plan_return} },
};
const loop_blocks = [_]model.Block{
    .{ .parameters = &.{r(0)}, .instructions = &loop_entry },
    .{ .parameters = &.{}, .instructions = &loop_body },
    .{ .parameters = &.{}, .instructions = &.{returned} },
};
const loop_plans = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r(0)}, .operations = &loop_entry_plan },
    .{ .parameters = &.{}, .operations = &loop_body_plan },
    .{ .parameters = &.{}, .operations = &.{plan_return} },
};
// Two CFG negatives distinguish original-instance state from adjacency and
// block-local counts. Neither path executes another environment allocation.
const cross_entry = prefix ++ [_]ins.Instruction{
    init_first,
    .{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(1) } } },
};
const cross_entry_plan = prefix_plan ++ [_]control.SourcePlanOperation{
    plan_first,
    .{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(1)} },
};
const cross_blocks = [_]model.Block{
    .{ .parameters = &.{r(0)}, .instructions = &cross_entry },
    .{ .parameters = &.{}, .instructions = &.{ init_second, returned } },
};
const cross_plans = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r(0)}, .operations = &cross_entry_plan },
    .{ .parameters = &.{}, .operations = &.{ plan_second, plan_return } },
};
const repeated_body = [_]ins.Instruction{
    .{ .source = condition_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .condition } } },
    init_first,
    .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 0 } } },
};
const repeated_body_plan = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_condition, .source = condition_at, .result = null, .operands = &.{}, .successors = &.{} },
    plan_first,
    .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(1), b(2) } },
};
const repeated_blocks = [_]model.Block{
    .{ .parameters = &.{r(0)}, .instructions = &loop_entry },
    .{ .parameters = &.{}, .instructions = &repeated_body },
    .{ .parameters = &.{}, .instructions = &.{returned} },
};
const repeated_plans = [_]control.SourcePlanBlock{
    .{ .parameters = &.{r(0)}, .operations = &loop_entry_plan },
    .{ .parameters = &.{}, .operations = &repeated_body_plan },
    .{ .parameters = &.{}, .operations = &.{plan_return} },
};
const Case = struct { name: []const u8, accept: bool, registers: usize, blocks: []const model.Block, plans: []const control.SourcePlanBlock };
const cases = [_]Case{
    .{ .name = "single", .accept = true, .registers = 4, .blocks = &single_blocks, .plans = &single_plans },
    .{ .name = "same original allocation result twice", .accept = false, .registers = 4, .blocks = &double_blocks, .plans = &double_plans },
    .{ .name = "distinct allocation results", .accept = true, .registers = 5, .blocks = &distinct_blocks, .plans = &distinct_plans },
    .{ .name = "mutually exclusive branches", .accept = true, .registers = 4, .blocks = &exclusive_blocks, .plans = &exclusive_plans },
    .{ .name = "fresh allocation on each loop iteration", .accept = true, .registers = 5, .blocks = &loop_blocks, .plans = &loop_plans },
    .{ .name = "same original result across blocks", .accept = false, .registers = 4, .blocks = &cross_blocks, .plans = &cross_plans },
    .{ .name = "same original result on no-allocation backedge", .accept = false, .registers = 4, .blocks = &repeated_blocks, .plans = &repeated_plans },
};
const registers = [_]model.Register{
    .{ .carrier = .{ .@"type" = @enumFromInt(0) }, .view = @enumFromInt(0) },
    .{ .carrier = .{ .@"type" = @enumFromInt(1) }, .view = @enumFromInt(1) },
    .{ .carrier = .{ .@"type" = @enumFromInt(1) }, .view = @enumFromInt(1) },
    .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null },
    .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null },
};
const plan_carriers = [_][]const u8{ bool_text, i32_text, i32_text, environment_text, environment_text };
const types = [_]tables.CommonType{
    .{ .id = bool_id, .kind = .scalar, .name = "bool", .native_code = 2, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = i32_id, .kind = .scalar, .name = "i32", .native_code = 1, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = void_id, .kind = .@"void", .name = "void", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
};
const bindings = [_]storage.CommonBinding{
    .{ .id = "literal:factory:condition", .owner = .{ .param = @enumFromInt(0) }, .name = "condition", .@"type" = @enumFromInt(0), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(0) }, .scope = @enumFromInt(0), .declaration_kind = .parameter },
    .{ .id = binding_id, .owner = .{ .local = @enumFromInt(0) }, .name = "saved", .@"type" = @enumFromInt(1), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(1) }, .scope = @enumFromInt(0), .declaration_kind = .local },
};
const scope: publication.StableScope = .{
    .profile = .@"common-program-fixed-v4", .declaration_types = &.{ bool_id, i32_id, void_id }, .constructions = &.{},
    .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path, .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} },
    .types = &.{
        .{ .id = bool_id, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}" } } },
        .{ .id = i32_id, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}" } } },
        .{ .id = void_id, .label = "{\"kind\":\"void\",\"name\":\"void\"}", .shape = .{ .primitive = .{ .kind = .@"void", .label = "{\"kind\":\"void\",\"name\":\"void\"}" } } },
    },
    .functions = &.{.{ .function_id = function_id, .signature_hash = signature, .kind = .source,
        .decl_key = .{ .kind = .function, .name = "factory", .path = &.{ "function", "factory" }, .source_path = source_path },
        .parameter_types = &.{bool_id}, .return_type = void_id, .construction = null, .lexical_parent = null,
        .lexical_environment = null, .activation_environment = environment_id, .captures = &.{}, .access = .public }},
    .globals = &.{}, .environments = &.{.{ .id = environment_id, .owner = function_id, .parent = null,
        .slots = &.{.{ .key = slot_key, .kind = .local, .@"type" = i32_id, .writable = false }} }},
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
            .declaration = .{ .start = 0, .end = 64 }, .name = "factory", .registers = registers[0..case.registers], .blocks = case.blocks };
        self.abis[0] = .{ .kind = .common, .function = @enumFromInt(0), .signature = signature,
            .parameters = &.{@enumFromInt(0)}, .argument_types = &.{@enumFromInt(0)}, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = &.{.{ .@"type" = @enumFromInt(0) }}, .result = null, .result_carrier = null,
            .source_plan = .{ .carriers = plan_carriers[0..case.registers], .blocks = case.plans } };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = model.format.version, .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout, .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = model.format.capability },
            .input_identity = input_hash, .source_hash = source_hash, .source_path = source_path, .source_length = 96, .root_source = @enumFromInt(0),
            .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 96 }}, .mode = .{ .common = .{
                .types = &types, .members = .{ .fields = &.{}, .methods = &.{}, .constructions = &.{} }, .domains = &.{},
                .storage = .{ .bindings = &bindings, .concrete = &.{
                    .{ .@"type" = @enumFromInt(0), .carrier = .{ .layout = .{ .byte_size = 1, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                    .{ .@"type" = @enumFromInt(1), .carrier = .{ .layout = .{ .byte_size = 4, .alignment = 4, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                    .{ .@"type" = @enumFromInt(2), .carrier = .{ .layout = .{ .byte_size = 0, .alignment = 1, .reference_count = 0 }, .field_offsets = &.{} }, .body = null },
                }, .arrays = &.{}, .environments = &.{.{ .environment = @enumFromInt(0), .byte_size = 4, .alignment = 4, .reference_count = 0, .parent_offset = null, .slot_offsets = &.{0} }},
                    .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } },
                .views = .{ .compatibility = &.{}, .dispatch = &.{}, .entries = &.{} }, .abis = &self.abis,
                .modules = .{ .modules = &.{}, .globals = &.{}, .hosts = &.{}, .initialization = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} } },
                .authority = .{ .exports = .{}, .entries = .{}, .resources = .{}, .published = .{}, .fixed_publication = .{
                    .stable_scope = scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 4 }, .mode = .fixed, .scope = scope,
                        .scope_digest = scope_digest, .expected_digest = publication_digest, .contracts = &.{.{ .function_id = function_id, .signature_hash = signature,
                            .upper = upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = null, .digest = contract_digest }} },
                    .dependencies = &.{.{ .function_id = function_id, .callees = &.{}, .hosts = &.{} }}, .request = .{ .targets = &.{} } } },
                .closures = .{ .functions = &.{.{ .function = @enumFromInt(0), .parent = null, .lexical_environment = null, .activation_environment = @enumFromInt(0), .captures = &.{} }},
                    .environments = &.{.{ .id = environment_id, .owner = @enumFromInt(0), .parent = null, .slots = &.{.{ .binding = @enumFromInt(1), .key = slot_key, .kind = .local, .@"type" = @enumFromInt(1), .writable = false }} }}, .calls = &.{} },
                .exceptions = .{ .functions = &.{.{ .function = @enumFromInt(0), .handlers = &.{} }}, .bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) } },
                    .scopes = &.{.{ .owner = @enumFromInt(0), .path = &.{} }} },
            } } }, .functions = &self.functions };
    }
};
fn run(case: Case) !void {
    var fixture: Fixture = undefined;
    fixture.init(case);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try identity.check(&c);
    const result = ssa.check(&c);
    // On the old checker the negative reaches full plan matching before its
    // expected rejection assertion fails: RED is not an invalid-plan shortcut.
    if (result) |_| {
        try correspondence.check(&c);
    } else |_| {}
    if (case.accept) try result else try std.testing.expectError(error.InvalidShape, result);
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}
test "literal env direct initialize single" { try run(cases[0]); }
test "literal env direct initialize rejects same original result twice" { try run(cases[1]); }
test "literal env direct initialize distinct allocations" { try run(cases[2]); }
test "literal env direct initialize exclusive branches" { try run(cases[3]); }
test "literal env direct initialize fresh loop" { try run(cases[4]); }
test "literal env direct initialize rejects across blocks" { try run(cases[5]); }
test "literal env direct initialize rejects no-allocation backedge" { try run(cases[6]); }
