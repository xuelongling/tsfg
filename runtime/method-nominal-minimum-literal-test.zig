// SPDX-License-Identifier: MIT
// Independent complete typed metadata, with offline worked contract literals.
// No packet, Source package, parser, admission, Actual state or VM is used.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const members = @import("wire-program-members.zig");
const control = @import("wire-program-control.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const refs = @import("wire-program-table-refs.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const identity = @import("wire-program-identity-check.zig");
const constructions = @import("wire-program-construction-contracts-check.zig");
const interfaces = @import("wire-program-fixed-publication-check.zig");
const compatibility = @import("wire-program-reference-contracts-check.zig");
const t = model.types;
const ins = model.instruction;
fn Item(comptime T: type, comptime field: []const u8) type { return @typeInfo(@FieldType(T, field)).pointer.child; }
const Nominal = @FieldType(publication.ScopeShape, "nominal");
const ShapeMethod = @typeInfo(@typeInfo(@FieldType(Nominal, "methods")).optional.child).pointer.child;
fn h(comptime text: []const u8) t.Hash {
    @setEvalBranchQuota(100000);
    var result: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&result, text) catch unreachable;
    return result;
}
const source_path = "/literal-nominal-method-minimum.ts";
const source_hash = h("dbf03408ad539db1a66ba0ac9d53682e3a5d8822edb9eb4059b1793e0994f44d");
const payload_hash = h("c974c596de974e418dd7c08dc887e98c8c467022d8b88a581d97f2564f2ad9f5");
const input_identity = h("f6c86dab89e483d1a128c026ba3673c4ef9dd97f6fe7a8146ccea574f897d199");
const labels = [6][]const u8{ "{\"kind\":\"scalar\",\"name\":\"i32\"}", "{\"kind\":\"undefined\",\"name\":\"undefined\"}", "{\"kind\":\"void\",\"name\":\"void\"}", "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"NominalBase\"],\"sourcePath\":\"/literal-nominal-method-minimum.ts\"}}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"NominalDerived\"],\"sourcePath\":\"/literal-nominal-method-minimum.ts\"}}" };
const primitives = [3]t.Hash{ h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"), h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"), h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190") };
const union_id = h("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
const runtime_keys = [2]t.Hash{ h("8ef417b597c434d3cc83d59ad38ac4f83d75680f884bd325a19b90aad2ceee62"), h("2c4048865ceaf8d3e6833e1b635642499fc632c87412c2bd1e489ac062bb64d3") };
const constructor_source_ids = [2]t.Hash{ h("2aad2b0a0ca812d455897e63cb32d4f409441cc35d5a83596f783484c9bab1b0"), h("94707c2b595f5f04de33fd4a27404c3f5ff3951edca2c851a01598c09f842729") };
const receiver_ids = [2][]const u8{ "this@sha256:bfd748d9b2cc586d9b2951604995ad227c34aafd8b76bee6d0705fd8f2e6903d", "this@sha256:d17ce1d51576de842289668051eef3ddca26970f70375a31a7958235bfec35a5" };
const owner_names = [2][]const u8{ "NominalBase", "NominalDerived" };
const argument_names = [2][2][]const u8{ .{ "argument:0:0", "argument:0:1" }, .{ "argument:1:0", "argument:1:1" } };
const owner_paths = [2][]const []const u8{ &.{"NominalBase"}, &.{"NominalDerived"} };
const method_paths = [2][]const []const u8{ &.{"type", "NominalBase"}, &.{"type", "NominalDerived"} };
const union_labels = [2][]const u8{ labels[0], labels[1] };
const upper: publication.EffectUpper = .{
    .parameters = &.{ .{ .index = 0, .read = false, .write = false, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } },
    .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = false, .@"await" = false, .eh_control = false, .escape = false, .lock = false,
        .managed_reference = false, .may_throw = false, .unknown_host = false },
};
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const seven_properties = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "7" } }};
const Case = struct {
    minimums: [2]u16, counts: [2]usize, parameters: [2][2]usize, results: [2]usize,
    nominal_ids: [2]t.Hash, signatures: [2]t.Hash, function_ids: [2]t.Hash,
    construction_ids: [2]t.Hash, contract_digests: [2]t.Hash, scope_digest: t.Hash, publication_digest: t.Hash,
    type_order: [6]usize, function_order: [2]usize, construction_order: [2]usize,
};
const cases = [_]Case{
    .{ .minimums = .{ 0, 0 }, .counts = .{ 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2 },
        .nominal_ids = .{ h("ff2e21c5780554ae5f949de92f02c03b3446a5967b3a1477e8f4a2863b2be7e8"), h("60f17ea777a5f690026575287f399039faeb12fa64ee34f34795e57608ea0a5e") }, .signatures = .{ h("e7f07ca33b2ac659a57c1d1c79b062db1e7f47ceb6c0dea5aa8ab37e33302272"), h("c4d15b1f240dc95b4523fd15ed6f1b4e5bef0edd95593d2608910b67e2eb140c") }, .function_ids = .{ h("457f58c56954b6bf2f6b4245dcc0827b06cd3f23991611c26e691855a2b55cd4"), h("70d5a2624bcfcee8f03c00f84396e9508b2cb71c3f33435777c8d92e7741dba0") },
        .construction_ids = .{ h("90ab7ce3983652d8b19e101ef31f8a851b8e0b45668af685438ba7ef881c2c7b"), h("618ff354c8aac6a7939fd49070b8d72265cef09012d9906811ee981ad0a89efb") }, .contract_digests = .{ h("adba2b2d8225bb67f13505041ebde22e1c1d7eee931ac502d2eedf7e5624db36"), h("d855fdac2e409b73c4d5c29bd5a8aa07fb1bcbe1e21dcc127c9301ec5e051e31") },
        .scope_digest = h("cc0b05e50a120e3bb6a0be22daa80a67eeeaf525c3e81f644facb9673a6443aa"), .publication_digest = h("6b70d331297ce030486b1d197a22b51ad4577a8b0a7b1deca06483e46e2ed5ef"),
        .type_order = .{ 3, 5, 1, 0, 2, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .minimums = .{ 0, 1 }, .counts = .{ 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2 },
        .nominal_ids = .{ h("ff2e21c5780554ae5f949de92f02c03b3446a5967b3a1477e8f4a2863b2be7e8"), h("f8b39f4bc87b40c11d3a3799578111725e0affad03457fbed0ef9de7e5d79cc5") }, .signatures = .{ h("e7f07ca33b2ac659a57c1d1c79b062db1e7f47ceb6c0dea5aa8ab37e33302272"), h("4bd7d82f5ae71528a22eb8b9569491c1cf5bbe8e3b2bd3b7abbde1acf60ed233") }, .function_ids = .{ h("457f58c56954b6bf2f6b4245dcc0827b06cd3f23991611c26e691855a2b55cd4"), h("2ae9baae0a5872743754f1e1925543b66c2cd6d1a347946fc62499d5a20e31a1") },
        .construction_ids = .{ h("90ab7ce3983652d8b19e101ef31f8a851b8e0b45668af685438ba7ef881c2c7b"), h("7f4f69621f8c57f80d565ae5171c0c7a7dea73a05a8d6b0591c5e80f96287531") }, .contract_digests = .{ h("824248c6be2448b1563dbf6a2769f113e68ecaa13d0dd836a3443772a9b0f702"), h("adba2b2d8225bb67f13505041ebde22e1c1d7eee931ac502d2eedf7e5624db36") },
        .scope_digest = h("8208f1c438f169cca0a338032bfc60d0d61b931f3126c67d52c734e4aa155d25"), .publication_digest = h("a749e4a6686d92a3602f67202e38808957a369d61d6e232088700ab403c14ece"),
        .type_order = .{ 3, 1, 0, 2, 5, 4 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .minimums = .{ 0, 0 }, .counts = .{ 1, 2 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2 },
        .nominal_ids = .{ h("ff2e21c5780554ae5f949de92f02c03b3446a5967b3a1477e8f4a2863b2be7e8"), h("436432e54d258bdc873ce0557b864edca56fde050c8f2e3f5c4fa8d5198d1d39") }, .signatures = .{ h("e7f07ca33b2ac659a57c1d1c79b062db1e7f47ceb6c0dea5aa8ab37e33302272"), h("a1847258ddbafccfd5c8fdb43d842127980be25e4fda822637bd99364eedb681") }, .function_ids = .{ h("457f58c56954b6bf2f6b4245dcc0827b06cd3f23991611c26e691855a2b55cd4"), h("8e05bbb257ed37324194b519bb25c247ad20ab7a0e228729ef038548bca03588") },
        .construction_ids = .{ h("90ab7ce3983652d8b19e101ef31f8a851b8e0b45668af685438ba7ef881c2c7b"), h("3f6aff03ba0c7cbea97ecf547de49e0e8419f0ba6670f78cb12e0fcadba5ee80") }, .contract_digests = .{ h("adba2b2d8225bb67f13505041ebde22e1c1d7eee931ac502d2eedf7e5624db36"), h("86085a25cba0cc8c4ce3155a7378157ba7273948c973a6748363c34b9d253050") },
        .scope_digest = h("134c4a269054e6611d491910f6a8fa369c9ed09c05ff3f6fcbaa47ccb4e307c4"), .publication_digest = h("a1d78697d591f0ff006387db26ba41245fff48394876690976efebf9ed5dad56"),
        .type_order = .{ 3, 5, 1, 0, 2, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
};
const Literal = struct {
    program: model.Program,
    types: [6]tables.CommonType,
    type_positions: [6]usize,
    methods: [2]members.CommonMethod,
    constructors: [2]members.CommonConstruction,
    bindings: [5]storage.CommonBinding,
    concrete: [5]Item(storage.CommonStorage, "concrete"),
    functions: [2]model.Function,
    abis: [2]storage.CommonAbi,
    registers: [2][4]model.Register,
    physical: [2][3]t.Carrier,
    incoming: [2][2]t.TypeRef,
    parameters: [2][2]t.BindingRef,
    entries: [2][3]t.RegisterRef,
    instructions: [2][3]ins.Instruction,
    blocks: [2]model.Block,
    plan_operations: [2][3]control.SourcePlanOperation,
    plan_blocks: [2]control.SourcePlanBlock,
    plan_carriers: [2][4][]const u8,
    type_texts: [6][71]u8,
    method_refs: [2][1]t.MethodRef,
    union_refs: [2]t.TypeRef,
    receiver_refs: [2]t.BindingRef,
    parameter_labels: [2][2][]const u8,
    return_refs: [2][1]t.RegisterRef,
    upper_parameters: [2][3]Item(publication.EffectUpper, "parameters"),
    dispatch_arms: [2]Item(@FieldType(tables.Dispatch, "method"), "arms"),
    dispatch_rows: [1]tables.Dispatch,
    shape_methods: [2][1]ShapeMethod,
    fixed_types: [6]Item(publication.StableScope, "types"),
    fixed_functions: [2]Item(publication.StableScope, "functions"),
    fixed_constructors: [2]publication.Construction,
    parameter_ids: [2][3]t.Hash,
    declaration_ids: [6]t.Hash,
    contracts: [2]Item(publication.Publication, "contracts"),
    dependencies: [2]Item(publication.FixedPublication, "dependencies"),
    closures: [2]Item(control.CommonClosures, "functions"),
    scopes: [2]Item(control.CommonControl, "scopes"),
    cells: [5]Item(control.CommonControl, "bindings"),
    function_control: [2]Item(control.CommonControl, "functions"),

    fn typeRef(self: *const Literal, logical: usize) t.TypeRef { return @enumFromInt(self.type_positions[logical]); }

    fn init(self: *Literal, example: Case) void {
        const ids = [6]t.Hash{ primitives[0], primitives[1], primitives[2], union_id, example.nominal_ids[0], example.nominal_ids[1] };
        var function_positions: [2]usize = undefined;
        var construction_positions: [2]usize = undefined;
        for (example.construction_order, 0..) |owner, index| construction_positions[owner] = index;
        for (example.function_order, 0..) |owner, index| function_positions[owner] = index;
        for (example.type_order, 0..) |logical, index| self.type_positions[logical] = index;
        self.union_refs = .{self.typeRef(0), self.typeRef(1)};
        for (ids, 0..) |id, logical| {
            @memcpy(self.type_texts[logical][0..7], "sha256:");
            @memcpy(self.type_texts[logical][7..], &std.fmt.bytesToHex(id, .lower));
        }
        var binding_count: usize = 0;
        for (0..2) |owner| {
            const function: t.FunctionRef = @enumFromInt(function_positions[owner]);
            const start: u32 = @intCast(10 + owner * 50);
            for (0..example.counts[owner]) |ordinal| {
                const logical = example.parameters[owner][ordinal];
                self.bindings[binding_count] = .{ .id = argument_names[owner][ordinal],
                    .owner = .{ .param = function }, .name = if (ordinal == 0) "input0" else "input1", .@"type" = self.typeRef(logical), .writable = false,
                    .origin = .{ .source = @enumFromInt(0), .start = start + 4 + @as(u32, @intCast(ordinal * 2)), .end = start + 5 + @as(u32, @intCast(ordinal * 2)) },
                    .carrier = if (logical == 3) .payload else .{ .@"type" = self.typeRef(logical) }, .scope = @enumFromInt(function_positions[owner]), .declaration_kind = .parameter };
                self.parameter_labels[owner][ordinal] = labels[logical];
                binding_count += 1;
            }
            self.bindings[binding_count] = .{ .id = receiver_ids[owner], .owner = .{ .receiver = function }, .name = "this",
                .@"type" = self.typeRef(4 + owner), .writable = false,
                .origin = .{ .source = @enumFromInt(0), .start = start + 2, .end = start + 3 },
                .carrier = .{ .@"type" = self.typeRef(4 + owner) }, .scope = @enumFromInt(function_positions[owner]), .declaration_kind = null };
            binding_count += 1;
            self.shape_methods[owner][0] = .{ .access = .public, .name = "pick", .parameters = self.parameter_labels[owner][0..example.counts[owner]],
                .return_type = labels[example.results[owner]], .minimum_argument_count = example.minimums[owner] };
        }
        std.mem.sort(storage.CommonBinding, self.bindings[0..binding_count], {}, struct {
            fn less(_: void, a: storage.CommonBinding, b: storage.CommonBinding) bool { return std.mem.order(u8, a.id, b.id) == .lt; }
        }.less);
        for (self.bindings[0..binding_count], 0..) |binding, index| {
            self.cells[index] = .{ .binding = @enumFromInt(index), .scope = binding.scope.? };
            switch (binding.owner) {
                .param => |function| self.parameters[@intFromEnum(function)][binding.name[5] - '0'] = @enumFromInt(index),
                .receiver => |function| self.receiver_refs[@intFromEnum(function)] = @enumFromInt(index),
                else => unreachable,
            }
        }
        for (example.function_order, 0..) |owner, index| {
            const owner_type = self.typeRef(owner + 4);
            const start: u32 = @intCast(10 + owner * 50);
            const begin: t.Origin = .{ .source = @enumFromInt(0), .start = start, .end = start + 30 };
            const end: t.Origin = .{ .source = @enumFromInt(0), .start = start + 28, .end = start + 29 };
            self.method_refs[owner] = .{@enumFromInt(index)};
            self.methods[index] = .{ .id = example.function_ids[owner], .owner = owner_type, .function = @enumFromInt(index),
                .name = "pick", .signature = example.signatures[owner], .override = if (owner == 1) example.function_ids[0] else null, .access = .public };
            const count = example.counts[owner];
            for (0..count + 1) |ordinal| {
                const logical = if (ordinal == 0) owner + 4 else example.parameters[owner][ordinal - 1];
                const carrier: t.Carrier = if (logical == 3) .payload else .{ .@"type" = self.typeRef(logical) };
                self.physical[index][ordinal] = carrier;
                self.registers[index][ordinal] = .{ .carrier = carrier, .view = self.typeRef(logical) };
                self.entries[index][ordinal] = @enumFromInt(ordinal);
                self.plan_carriers[index][ordinal] = if (logical == 3) "payload" else &self.type_texts[logical];
                self.parameter_ids[index][ordinal] = ids[logical];
                self.upper_parameters[index][ordinal] = .{ .index = @intCast(ordinal), .read = false, .write = false, .structural = false };
                if (ordinal != 0) self.incoming[index][ordinal - 1] = self.typeRef(logical);
            }
            self.instructions[index][0] = .{ .source = begin, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } };
            self.plan_operations[index][0] = .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = begin };
            const valued = example.results[owner] != 2;
            const operation_count: usize = if (valued) 3 else 2;
            const register_count = count + 1 + @as(usize, if (valued) 1 else 0);
            if (valued) {
                const value_reg: t.RegisterRef = @enumFromInt(count + 1);
                const value_at: t.Origin = .{ .source = @enumFromInt(0), .start = start + 26, .end = start + 27 };
                self.registers[index][count + 1] = .{ .carrier = .{ .@"type" = self.typeRef(0) }, .view = self.typeRef(0) };
                self.plan_carriers[index][count + 1] = &self.type_texts[0];
                self.instructions[index][1] = .{ .source = value_at, .result = value_reg, .operands = &.{}, .data = .{ .const_i32 = 7 } };
                self.plan_operations[index][1] = .{ .name = "constant", .view = &self.type_texts[0], .properties = &seven_properties,
                    .result = value_reg, .operands = &.{}, .successors = &.{}, .source = value_at };
                self.return_refs[index][0] = value_reg;
            }
            const returned: []const t.RegisterRef = if (valued) &self.return_refs[index] else &.{};
            self.instructions[index][operation_count - 1] = .{ .source = end, .result = null, .operands = returned, .data = .@"return" };
            self.plan_operations[index][operation_count - 1] = .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = returned, .successors = &.{}, .source = end };
            self.blocks[index] = .{ .parameters = self.entries[index][0 .. count + 1], .instructions = self.instructions[index][0..operation_count] };
            self.plan_blocks[index] = .{ .parameters = self.entries[index][0 .. count + 1], .operations = self.plan_operations[index][0..operation_count] };
            self.functions[index] = .{ .id = example.function_ids[owner], .signature = example.signatures[owner], .abi = @enumFromInt(index),
                .source = @enumFromInt(0), .role = .ordinary, .declaration = .{ .start = start, .end = start + 30 },
                .name = "pick", .registers = self.registers[index][0..register_count], .blocks = self.blocks[index .. index + 1] };
            self.abis[index] = .{ .kind = .common, .function = @enumFromInt(index), .signature = example.signatures[owner],
                .parameters = self.parameters[index][0..count], .argument_types = self.incoming[index][0..count], .method_minimum_argument_count = example.minimums[owner], .ordinary_minimum_argument_count = null,
                .receiver = self.receiver_refs[index], .construction = null, .receiver_frame = null, .lexical_environment = null,
                .physical_parameters = self.physical[index][0 .. count + 1], .result = if (valued) self.typeRef(example.results[owner]) else null,
                .result_carrier = if (valued) .{ .@"type" = self.typeRef(example.results[owner]) } else null,
                .source_plan = .{ .carriers = self.plan_carriers[index][0..register_count], .blocks = self.plan_blocks[index .. index + 1] } };
            self.fixed_functions[index] = .{ .function_id = example.function_ids[owner], .signature_hash = example.signatures[owner], .kind = .method,
                .decl_key = .{ .kind = .method, .name = "pick", .path = method_paths[owner], .source_path = source_path },
                .parameter_types = self.parameter_ids[index][0 .. count + 1], .method_minimum_argument_count = example.minimums[owner], .ordinary_parameter_initialization = null, .return_type = ids[example.results[owner]],
                .construction = null, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public };
            var effect_upper = upper;
            effect_upper.parameters = self.upper_parameters[index][0 .. count + 1];
            self.contracts[index] = .{ .function_id = example.function_ids[owner], .signature_hash = example.signatures[owner], .upper = effect_upper,
                .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} }, .return_origins = null, .digest = example.contract_digests[index] };
            self.dependencies[index] = .{ .function_id = example.function_ids[owner], .callees = &.{}, .hosts = &.{} };
            self.closures[index] = .{ .function = @enumFromInt(index), .parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{} };
            self.scopes[index] = .{ .owner = @enumFromInt(index), .path = &.{} };
            self.function_control[index] = .{ .function = @enumFromInt(index), .handlers = &.{} };
        }
        for (example.construction_order, 0..) |owner, index| {
            const start: u32 = @intCast(10 + owner * 50);
            const at: t.Origin = .{ .source = @enumFromInt(0), .start = start, .end = start + 30 };
            self.constructors[index] = .{ .id = example.construction_ids[owner], .owner = self.typeRef(owner + 4), .function = null,
                .kind = if (owner == 1) .@"implicit-derived" else .@"implicit-base", .origin = at, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = self.typeRef(owner + 4) },
                .source_signature = .{ .id = constructor_source_ids[owner], .origin = at },
                .implicit_forward = if (owner == 1) .{ .target = @enumFromInt(construction_positions[0]), .origin = at,
                    .base_signature = .{ .parameters = &.{}, .@"return" = self.typeRef(4) }, .parameters = &.{} } else null,
                .initialization_phase = if (owner == 1) .@"after-successful-super" else .@"before-body", .initialization_fields = &.{}, .access = .public };
            self.fixed_constructors[index] = .{ .id = example.construction_ids[owner], .owner = ids[owner + 4], .base = if (owner == 1) ids[4] else null,
                .kind = if (owner == 1) .@"implicit-derived" else .@"implicit-base", .function_id = null };
        }
        var concrete_index: usize = 0;
        var declaration_count: usize = 0;
        const needs_void = std.mem.indexOfScalar(usize, &example.results, 2) != null;
        for (example.type_order, 0..) |logical, index| {
            const nominal = logical >= 4;
            const kind: @FieldType(tables.CommonType, "kind") = switch (logical) { 0 => .scalar, 1 => .@"undefined", 2 => .@"void", 3 => .@"union", else => .reference };
            self.types[index] = .{ .id = ids[logical], .kind = kind,
                .name = if (nominal) owner_names[logical - 4] else if (logical == 0) "i32" else if (logical == 1) "undefined" else if (logical == 2) "void" else "union",
                .native_code = if (logical == 0) 1 else 0, .base = if (logical == 5) self.typeRef(4) else null, .element = null,
                .members = if (logical == 3) &self.union_refs else &.{}, .methods = if (nominal) &self.method_refs[logical - 4] else null,
                .nominal_key = if (nominal) .{ .source = @enumFromInt(0), .declaration_path = owner_paths[logical - 4], .category = .reference } else null,
                .runtime_key = if (nominal) runtime_keys[logical - 4] else null };
            self.fixed_types[index] = .{ .id = ids[logical], .label = labels[logical], .shape = if (nominal)
                .{ .nominal = .{ .kind = .reference, .label = labels[logical], .base = if (logical == 5) labels[4] else null,
                    .construction = .{ .access = .public, .parameters = &.{}, .return_type = labels[logical], .argument_signature = null },
                    .fields = &.{}, .methods = &self.shape_methods[logical - 4] } }
                else if (logical == 3) .{ .union_type = .{ .kind = .@"union", .label = labels[3], .members = &union_labels } }
                else .{ .primitive = .{ .kind = if (logical == 0) .scalar else if (logical == 1) .@"undefined" else .@"void", .label = labels[logical] } } };
            if (logical != 2 or needs_void) { self.declaration_ids[declaration_count] = ids[logical]; declaration_count += 1; }
            if (logical == 3) continue;
            self.concrete[concrete_index] = .{ .@"type" = @enumFromInt(index),
                .carrier = .{ .layout = .{ .byte_size = if (nominal) 8 else if (logical == 0) 4 else 0,
                    .alignment = if (nominal) 8 else if (logical == 0) 4 else 1, .reference_count = if (nominal) 1 else 0 }, .field_offsets = &.{} },
                .body = if (nominal) .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } else null };
            concrete_index += 1;
        }
        const scope: publication.StableScope = .{ .profile = .@"common-program-fixed-v6", .declaration_types = self.declaration_ids[0..declaration_count],
            .constructions = &self.fixed_constructors, .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path,
            .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} }, .types = &self.fixed_types, .functions = &self.fixed_functions,
            .globals = &.{}, .environments = &.{}, .host_context = null, .host_imports = &.{} };
        var dispatch_index: usize = 0;
        for (example.type_order) |logical| {
            if (logical < 4) continue;
            const owner = logical - 4;
            self.dispatch_arms[dispatch_index] = .{ .actual = self.typeRef(logical), .target = @enumFromInt(function_positions[owner]), .abi = @enumFromInt(function_positions[owner]) };
            dispatch_index += 1;
        }
        self.dispatch_rows[0] = .{ .method = .{ .view = self.typeRef(4), .member = @enumFromInt(function_positions[0]), .arms = &self.dispatch_arms } };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = 20, .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout,
                .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = 1020 },
            .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = 150, .root_source = @enumFromInt(0),
            .functions = &self.functions, .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 150 }}, .mode = .{ .common = .{
                .types = &self.types, .members = .{ .fields = &.{}, .methods = &self.methods, .constructions = &self.constructors }, .domains = &.{},
                .storage = .{ .bindings = self.bindings[0..binding_count], .concrete = &self.concrete, .arrays = &.{}, .environments = &.{},
                    .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } }, .abis = &self.abis,
                .views = .{ .compatibility = &.{}, .dispatch = &self.dispatch_rows, .entries = &.{} },
                .modules = .{ .modules = &.{}, .globals = &.{}, .hosts = &.{}, .initialization = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} } },
                .closures = .{ .functions = &self.closures, .environments = &.{}, .calls = &.{} },
                .exceptions = .{ .functions = &self.function_control, .bindings = self.cells[0..binding_count], .scopes = &self.scopes },
                .authority = .{ .exports = .{}, .entries = .{}, .resources = .{}, .published = .{}, .fixed_publication = .{
                    .stable_scope = scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 6 },
                        .mode = .fixed, .scope = scope, .scope_digest = example.scope_digest, .expected_digest = example.publication_digest, .contracts = &self.contracts },
                    .dependencies = &self.dependencies, .request = .{ .targets = &.{} } } },
            } } } };
    }
};

// These preconditions prove complete current metadata before the M12 consumer.
// No source admission, call execution, omitted operands or defaults are used.
fn joined(c: *context.Context) context.Error!void {
    try refs.check(c);
    try layout.check(c);
    try ssa.check(c);
    try identity.check(c);
    try constructions.checkConstructions(c);
    try interfaces.checkInterfaces(c);
}

test "nominal Base-view dispatch accepts an equal override minimum without proof rows" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "nominal Base-view dispatch rejects stricter override minimum without proof rows" {
    var literal: Literal = undefined;
    literal.init(cases[1]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "nominal Base-view dispatch rejects extra ordinary parameter without proof rows" {
    var literal: Literal = undefined;
    literal.init(cases[2]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}
