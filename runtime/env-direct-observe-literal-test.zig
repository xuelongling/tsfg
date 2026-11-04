// SPDX-License-Identifier: MIT
// Independent literal typed metadata for the direct original Env-result observation slice.
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
const source_path = "/literal-own-cell-observation.ts";
const source_hash = h("0f87f913f44d8361d9fc03c5b35786d62aa186c2b9e563f2a00e6080cc934329");
const input_hash = h("c00579c7bfadbbc6edeeaebd2af6d919fae912a3cfe092a545427bb0e7a1409e");
const payload_hash = h("e4f7a9707dfb7fc9823dd687e5d69029da260e81fbefafa47f8908d0a1b5f587");
const bool_id = h("811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721");
const i32_id = h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727");
const void_id = h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190");
const undefined_id = h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");
const function_id = h("45ad9d12c8f25e4b71c38c1fbc8e55b0bff253c31dd5933f79f5b5a9b98371c2");
const signature = h("3b23153e45e84b8bbf61a7006f338a6cd46cab42213bf55631c0eb566b559c37");
const environment_id = h("f208a9d329efecb5c10a13de600ad8730de1e7b3db34cb26677df249d3a5f4a6");
const slot_key = h("64277e800112bcf72cc3bb118f4ed652b86accffb0494a834cdbf4f8862e068d");
const undefined_key = h("cda68178247879c54bb4e8c81291b8cea4a1f319d376d39adf06c9b9d456b942");
const scope_digest = h("7bd53c51ac3c39564587790fa39788550ea2ed260ff56467bf20330e2b1cbfda");
const contract_digest = h("d103c7fcd9e333bd8cbdd64e89a6153f656d698b457fa4268f370a895695abf2");
const publication_digest = h("7febc32cdb47067e835d06f778458873859e8e9f5b5f0fd8d1bdaa2ada04af53");
const bool_text = "sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721";
const i32_text = "sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727";
const undefined_text = "sha256:64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b";
const environment_text = "env:sha256:f208a9d329efecb5c10a13de600ad8730de1e7b3db34cb26677df249d3a5f4a6";
const binding_id = "literal:observeFactory:counter";
const undefined_binding_id = "literal:observeFactory:optionalValue";
const at: t.Origin = .{ .source = @enumFromInt(0), .start = 8, .end = 9 };
const entry_at: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 64 };
const condition_at: t.Origin = .{ .source = @enumFromInt(0), .start = 24, .end = 25 };
const fuel_entry = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const fuel_condition = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 2 } }};
const one = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "1" } }};
const alloc_properties = [_]t.JsonMember{.{ .key = "layout", .value = .{ .string = "sha256:f208a9d329efecb5c10a13de600ad8730de1e7b3db34cb26677df249d3a5f4a6" } }};
const cell_properties = [_]t.JsonMember{
    .{ .key = "binding", .value = .{ .string = binding_id } },
    .{ .key = "key", .value = .{ .string = "sha256:64277e800112bcf72cc3bb118f4ed652b86accffb0494a834cdbf4f8862e068d" } },
    .{ .key = "layout", .value = .{ .string = "sha256:f208a9d329efecb5c10a13de600ad8730de1e7b3db34cb26677df249d3a5f4a6" } },
};
const undefined_properties = [_]t.JsonMember{
    .{ .key = "binding", .value = .{ .string = undefined_binding_id } },
    .{ .key = "key", .value = .{ .string = "sha256:cda68178247879c54bb4e8c81291b8cea4a1f319d376d39adf06c9b9d456b942" } },
    .{ .key = "layout", .value = .{ .string = "sha256:f208a9d329efecb5c10a13de600ad8730de1e7b3db34cb26677df249d3a5f4a6" } },
};
// Wire instructions and SourcePlan rows are separately authored literals.
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
const alloc: ins.Instruction = .{ .source = at, .result = r(3), .operands = &.{}, .data = .{ .environment_alloc = .{ .environment = @enumFromInt(0), .anchor_kind = .source } } };
const initialize: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(1) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(0), .anchor_kind = .source } } };
const load: ins.Instruction = .{ .source = at, .result = r(4), .operands = &.{r(3)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(0) } } };
const store: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(1) }, .data = .{ .environment_store = .{ .slot = @enumFromInt(0) } } };
const initialize_undefined: ins.Instruction = .{ .source = at, .result = null, .operands = &.{ r(3), r(2) }, .data = .{ .environment_init = .{ .slot = @enumFromInt(1), .anchor_kind = .source } } };
const load_undefined: ins.Instruction = .{ .source = at, .result = r(4), .operands = &.{r(3)}, .data = .{ .environment_load = .{ .slot = @enumFromInt(1) } } };
const returned: ins.Instruction = .{ .source = at, .result = null, .operands = &.{}, .data = .@"return" };
const plan_alloc: control.SourcePlanOperation = .{ .name = "env_alloc", .view = environment_text, .properties = &alloc_properties, .source = at, .result = r(3), .operands = &.{}, .successors = &.{} };
const plan_initialize: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(3), r(1) }, .successors = &.{} };
const plan_load: control.SourcePlanOperation = .{ .name = "env_load", .view = i32_text, .properties = &cell_properties, .source = at, .result = r(4), .operands = &.{r(3)}, .successors = &.{} };
const plan_store: control.SourcePlanOperation = .{ .name = "env_store", .view = "void", .properties = &cell_properties, .source = at, .result = null, .operands = &.{ r(3), r(1) }, .successors = &.{} };
const plan_initialize_undefined: control.SourcePlanOperation = .{ .name = "env_init", .view = "void", .properties = &undefined_properties, .source = at, .result = null, .operands = &.{ r(3), r(2) }, .successors = &.{} };
const plan_load_undefined: control.SourcePlanOperation = .{ .name = "env_load", .view = undefined_text, .properties = &undefined_properties, .source = at, .result = r(4), .operands = &.{r(3)}, .successors = &.{} };
const plan_return: control.SourcePlanOperation = .{ .name = "func.return", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{} };
const initialized_ops = seed ++ [_]ins.Instruction{ alloc, initialize, load, returned };
const initialized_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_initialize, plan_load, plan_return };
const early_load_ops = seed ++ [_]ins.Instruction{ alloc, load, initialize, returned };
const early_load_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_load, plan_initialize, plan_return };
const no_init_ops = seed ++ [_]ins.Instruction{ alloc, load, returned };
const no_init_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_load, plan_return };
const undefined_ops = seed ++ [_]ins.Instruction{ alloc, initialize_undefined, load_undefined, returned };
const undefined_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_initialize_undefined, plan_load_undefined, plan_return };
const initialized_store_ops = seed ++ [_]ins.Instruction{ alloc, initialize, store, load, returned };
const initialized_store_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_initialize, plan_store, plan_load, plan_return };
const early_store_ops = seed ++ [_]ins.Instruction{ alloc, store, initialize, load, returned };
const early_store_plan = seed_plan ++ [_]control.SourcePlanOperation{ plan_alloc, plan_store, plan_initialize, plan_load, plan_return };
const loop_entry = seed ++ [_]ins.Instruction{.{ .source = at, .result = null, .operands = &.{}, .data = .{ .br = .{ .destination = b(1) } } }};
const loop_entry_plan = seed_plan ++ [_]control.SourcePlanOperation{.{ .name = "cf.br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{}, .successors = &.{b(1)} }};
const loop_body = [_]ins.Instruction{
    .{ .source = condition_at, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .condition } } },
    alloc, initialize, load,
    .{ .source = at, .result = null, .operands = &.{r(0)}, .data = .{ .cond_br = .{ .true_destination = b(1), .false_destination = b(2), .true_count = 0 } } },
};
const loop_body_plan = [_]control.SourcePlanOperation{
    .{ .name = "fuel", .view = "void", .properties = &fuel_condition, .source = condition_at, .result = null, .operands = &.{}, .successors = &.{} },
    plan_alloc, plan_initialize, plan_load,
    .{ .name = "cf.cond_br", .view = "", .properties = &.{}, .source = at, .result = null, .operands = &.{r(0)}, .successors = &.{ b(1), b(2) } },
};
const Case = struct { name: []const u8, accept: bool, undefined_payload: bool = false, blocks: []const model.Block, plans: []const control.SourcePlanBlock };
const cases = [_]Case{
    .{ .name = "initialize then discard load", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &initialized_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &initialized_plan }} },
    .{ .name = "discard load before initialize", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &early_load_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &early_load_plan }} },
    .{ .name = "discard load without initialize", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &no_init_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &no_init_plan }} },
    .{ .name = "actual undefined initializes a cell", .accept = true, .undefined_payload = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &undefined_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &undefined_plan }} },
    .{ .name = "fresh allocation initialize load on each loop iteration", .accept = true,
        .blocks = &.{ .{ .parameters = &.{r(0)}, .instructions = &loop_entry }, .{ .parameters = &.{}, .instructions = &loop_body }, .{ .parameters = &.{}, .instructions = &.{returned} } },
        .plans = &.{ .{ .parameters = &.{r(0)}, .operations = &loop_entry_plan }, .{ .parameters = &.{}, .operations = &loop_body_plan }, .{ .parameters = &.{}, .operations = &.{plan_return} } } },
    .{ .name = "writable store after initialize", .accept = true, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &initialized_store_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &initialized_store_plan }} },
    .{ .name = "writable store before initialize", .accept = false, .blocks = &.{.{ .parameters = &.{r(0)}, .instructions = &early_store_ops }}, .plans = &.{.{ .parameters = &.{r(0)}, .operations = &early_store_plan }} },
};
const registers = [_]model.Register{
    .{ .carrier = .{ .@"type" = @enumFromInt(1) }, .view = @enumFromInt(1) },
    .{ .carrier = .{ .@"type" = @enumFromInt(2) }, .view = @enumFromInt(2) },
    .{ .carrier = .{ .@"type" = @enumFromInt(0) }, .view = @enumFromInt(0) },
    .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null },
    .{ .carrier = .{ .@"type" = @enumFromInt(2) }, .view = @enumFromInt(2) },
};
const plan_carriers = [_][]const u8{ bool_text, i32_text, undefined_text, environment_text, i32_text };
const types = [_]tables.CommonType{
    .{ .id = undefined_id, .kind = .@"undefined", .name = "undefined", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = bool_id, .kind = .scalar, .name = "bool", .native_code = 2, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = i32_id, .kind = .scalar, .name = "i32", .native_code = 1, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
    .{ .id = void_id, .kind = .@"void", .name = "void", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
};
const bindings = [_]storage.CommonBinding{
    .{ .id = binding_id, .owner = .{ .local = @enumFromInt(0) }, .name = "counter", .@"type" = @enumFromInt(2), .writable = true, .origin = at, .carrier = .{ .@"type" = @enumFromInt(2) }, .scope = @enumFromInt(0), .declaration_kind = .local },
    .{ .id = "literal:observeFactory:gate", .owner = .{ .param = @enumFromInt(0) }, .name = "gate", .@"type" = @enumFromInt(1), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(1) }, .scope = @enumFromInt(0), .declaration_kind = .parameter },
    .{ .id = undefined_binding_id, .owner = .{ .local = @enumFromInt(0) }, .name = "optionalValue", .@"type" = @enumFromInt(0), .writable = false, .origin = at, .carrier = .{ .@"type" = @enumFromInt(0) }, .scope = @enumFromInt(0), .declaration_kind = .local },
};
const scope: publication.StableScope = .{
    .profile = .@"common-program-fixed-v4", .declaration_types = &.{ undefined_id, bool_id, i32_id, void_id }, .constructions = &.{},
    .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path, .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} },
    .types = &.{
        .{ .id = undefined_id, .label = "{\"kind\":\"undefined\",\"name\":\"undefined\"}", .shape = .{ .primitive = .{ .kind = .@"undefined", .label = "{\"kind\":\"undefined\",\"name\":\"undefined\"}" } } },
        .{ .id = bool_id, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"bool\"}" } } },
        .{ .id = i32_id, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}", .shape = .{ .primitive = .{ .kind = .scalar, .label = "{\"kind\":\"scalar\",\"name\":\"i32\"}" } } },
        .{ .id = void_id, .label = "{\"kind\":\"void\",\"name\":\"void\"}", .shape = .{ .primitive = .{ .kind = .@"void", .label = "{\"kind\":\"void\",\"name\":\"void\"}" } } },
    },
    .functions = &.{.{ .function_id = function_id, .signature_hash = signature, .kind = .source,
        .decl_key = .{ .kind = .function, .name = "observeFactory", .path = &.{ "function", "observeFactory" }, .source_path = source_path },
        .parameter_types = &.{bool_id}, .return_type = void_id, .construction = null, .lexical_parent = null,
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
    register_rows: [5]model.Register,
    carrier_rows: [5][]const u8,
    // In-place initialization keeps all self-backed slices valid throughout the
    // shared Context lifetime; no shallow return/copy claims ownership.
    fn init(self: *Fixture, case: Case) void {
        self.register_rows = registers;
        self.carrier_rows = plan_carriers;
        if (case.undefined_payload) {
            self.register_rows[4] = .{ .carrier = .{ .@"type" = @enumFromInt(0) }, .view = @enumFromInt(0) };
            self.carrier_rows[4] = undefined_text;
        }
        self.functions[0] = .{ .id = function_id, .signature = signature, .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .ordinary,
            .declaration = .{ .start = 0, .end = 64 }, .name = "observeFactory", .registers = &self.register_rows, .blocks = case.blocks };
        self.abis[0] = .{ .kind = .common, .function = @enumFromInt(0), .signature = signature,
            .parameters = &.{@enumFromInt(1)}, .argument_types = &.{@enumFromInt(1)}, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = &.{.{ .@"type" = @enumFromInt(1) }}, .result = null, .result_carrier = null,
            .source_plan = .{ .carriers = &self.carrier_rows, .blocks = case.plans } };
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
                    .stable_scope = scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 4 }, .mode = .fixed, .scope = scope,
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
test "literal env direct observe initialized load" { try run(cases[0]); }
test "literal env direct observe rejects discarded load before init" { try run(cases[1]); }
test "literal env direct observe rejects load without init" { try run(cases[2]); }
test "literal env direct observe initialized actual undefined" { try run(cases[3]); }
test "literal env direct observe fresh allocation loop" { try run(cases[4]); }
test "literal env direct observe initialized writable store" { try run(cases[5]); }
test "literal env direct observe rejects writable store before init" { try run(cases[6]); }
