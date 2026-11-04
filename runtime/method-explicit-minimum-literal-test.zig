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
const source_path = "/literal-explicit-method-minimum.ts";
const source_hash = h("7798c2a571169c4565106dfbccf6bcf3c723e4f879f1f1dabf543af36d555ffb");
const payload_hash = h("8e20887304ba901e3f45caf7a9496c3508eb19ff4af5bc836402d9bb8a42ac72");
const input_identity = h("17aaa399c421e5f5db9b7cc86560c1d4ccea4d6850ac79045c44ba119b0775a5");
// Logical type positions: i32, undefined, void, i32|undefined, ImplementationRole, PublicRole.
const labels = [6][]const u8{ "{\"kind\":\"scalar\",\"name\":\"i32\"}", "{\"kind\":\"undefined\",\"name\":\"undefined\"}", "{\"kind\":\"void\",\"name\":\"void\"}", "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"ImplementationRole\"],\"sourcePath\":\"/literal-explicit-method-minimum.ts\"}}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"PublicRole\"],\"sourcePath\":\"/literal-explicit-method-minimum.ts\"}}" };
const primitives = [3]t.Hash{ h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"), h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"), h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190") };
const union_id = h("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
const runtime_keys = [2]t.Hash{ h("507454ca5258ae77db9fe92aa20f5b46dc3827d849fc6e93f8126a6f6959ff38"), h("95dc9a17495191ef1fcd050df0f8ca96a52daa1e3e8bf1852d1a0c1ef25b969e") };
const constructor_source_ids = [2]t.Hash{ h("a87ae10ea5cf53cb77928bde06e76b0dc4a399b520b5811c84efd3fc669ace5b"), h("e24c3e3d8efcd751e1c577d9df52f5032f5e6cb8f7b90dd065f1d66ea485e1f7") };
const receiver_ids = [2][]const u8{ "this@sha256:81aee4f56e1c17d39bec5710eb693d5ae29520d75b31f5987a0f296ad2107358", "this@sha256:abbf46245985512b151ce0789995510f806bd049de51461f168df5d195225234" };
const owner_names = [2][]const u8{ "ImplementationRole", "PublicRole" };
const owner_paths = [2][]const []const u8{ &.{"ImplementationRole"}, &.{"PublicRole"} };
const method_paths = [2][]const []const u8{ &.{"type", "ImplementationRole"}, &.{"type", "PublicRole"} };
const union_labels = [2][]const u8{ labels[0], labels[1] };
const ordinary_label = [1][]const u8{labels[3]};
const upper: publication.EffectUpper = .{
    .parameters = &.{ .{ .index = 0, .read = false, .write = false, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } },
    .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} }, .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = false, .@"await" = false, .eh_control = false, .escape = false, .lock = false,
        .managed_reference = false, .may_throw = false, .unknown_host = false },
};
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const Case = struct {
    minimums: [2]u16, nominal_ids: [2]t.Hash, signatures: [2]t.Hash, function_ids: [2]t.Hash,
    construction_ids: [2]t.Hash, contract_digests: [2]t.Hash, scope_digest: t.Hash, publication_digest: t.Hash,
    type_order: [6]usize, function_order: [2]usize, construction_order: [2]usize,
};
const cases = [_]Case{
    .{ .minimums = .{ 0, 0 }, .nominal_ids = .{ h("344c40545ffadab90aa733863720f0917b62caeb8e3a1b6a55312d73eaabeeff"), h("c7e286f88efb0b5c22661f4f37044803024006402ebf70f43584483bbdc25807") },
        .signatures = .{ h("2a76651f5f2a02f66c791610927458cfac675ba24c51d3a66d05ffd2db6d097e"), h("0939425a8b5322a099e6792ea7e0544779d432c447df749400e3fea6e70f4df5") }, .function_ids = .{ h("920c395bf234fa62b0ed17a315496340e98c30e5f34fce286a5f7bd8bd58b221"), h("6bf78ae7e8f964ccc4eb3f34ad74549d910f404c0173d33d3e4174e8ec2cd16d") },
        .construction_ids = .{ h("b1b9f2ffaef3e50f9c28e06ca1d484a87194b9aced96aa24bf5bd0910a2aa64f"), h("e74c7125c140e925b73f786ad05c34f1cc8cc12d586b72e9a1e2ef5dece4bdc2") }, .contract_digests = .{ h("ad3d1243a0c9c1f9a0143eb36ec1defb966148ce691f8562a7a4cb00fb232984"), h("8f0a9b4f6497e638fc5e86f309090205f36e41901105efa7babc06cae00a9d3c") },
        .scope_digest = h("d2332252507cf05746585d44132f3c0985ec782b199e1b481531be7bed8184c1"), .publication_digest = h("9dc92f9f8f77a7781f3f668b2eed90d8ac3ca67be7f2a920f309567f09c5300f"),
        .type_order = .{ 3, 4, 1, 0, 2, 5 }, .function_order = .{ 1, 0 }, .construction_order = .{ 0, 1 } },
    .{ .minimums = .{ 1, 1 }, .nominal_ids = .{ h("aaf3e701495e155f1dd43db666cf48c08d00829b84e4c2cde5ee980bd845ad88"), h("0429b6199a5198b05dc781fc6a5926d216b4bc62bba6e83c1dd40f3922efb649") },
        .signatures = .{ h("41e07997dc78282b816c2048bdc54a6cc39c663d2fbbf12b007159b275d44668"), h("d4fb3748b9b90c8492469ec803e5ca558a860f79c800b549e79e1fced8e50b34") }, .function_ids = .{ h("210abd809ccb219bb5da13939c35efb93738da46468750c9be5d0c53bf2e1fce"), h("788b6d57d485d3ca8f266f25f312c4e8d4b868e37bde8d3f895d2b37081f1b13") },
        .construction_ids = .{ h("2157f68a9fe24ea46ce85ca90052ee335765de389ec0ca4f8724d11b971a8fda"), h("eb8a9d30e249df52b9c1ab20b09c018dc41289120e8576e4033f0b170343c5ab") }, .contract_digests = .{ h("6f0c2dae1a37d9fef8dd543e4ec5cc7a31deff851995ae1c894f6fba5e2f31e0"), h("f4a360398a0645f2a45b0e17b4c8d42c15987bd819b3ee78d1ed70d57f2f3dc8") },
        .scope_digest = h("6a85a290d01dbcba3c23806d79143968e4b243c42c5ff2182da957c39670d606"), .publication_digest = h("2b86443c996023a910349849267a5599ce80b5860934e3d8eaa781cb606fa962"),
        .type_order = .{ 5, 3, 1, 0, 4, 2 }, .function_order = .{ 0, 1 }, .construction_order = .{ 0, 1 } },
    .{ .minimums = .{ 0, 1 }, .nominal_ids = .{ h("344c40545ffadab90aa733863720f0917b62caeb8e3a1b6a55312d73eaabeeff"), h("0429b6199a5198b05dc781fc6a5926d216b4bc62bba6e83c1dd40f3922efb649") },
        .signatures = .{ h("2a76651f5f2a02f66c791610927458cfac675ba24c51d3a66d05ffd2db6d097e"), h("d4fb3748b9b90c8492469ec803e5ca558a860f79c800b549e79e1fced8e50b34") }, .function_ids = .{ h("920c395bf234fa62b0ed17a315496340e98c30e5f34fce286a5f7bd8bd58b221"), h("788b6d57d485d3ca8f266f25f312c4e8d4b868e37bde8d3f895d2b37081f1b13") },
        .construction_ids = .{ h("b1b9f2ffaef3e50f9c28e06ca1d484a87194b9aced96aa24bf5bd0910a2aa64f"), h("eb8a9d30e249df52b9c1ab20b09c018dc41289120e8576e4033f0b170343c5ab") }, .contract_digests = .{ h("f4a360398a0645f2a45b0e17b4c8d42c15987bd819b3ee78d1ed70d57f2f3dc8"), h("8f0a9b4f6497e638fc5e86f309090205f36e41901105efa7babc06cae00a9d3c") },
        .scope_digest = h("e7448c8e881e6c7f0a4ec6e5dd303495dcfa7425ce9debe908b83e387226ad08"), .publication_digest = h("c7607a55b2f7ccdd19c80a109265d882756ef4560fb2acf65041535a473d572f"),
        .type_order = .{ 5, 3, 4, 1, 0, 2 }, .function_order = .{ 1, 0 }, .construction_order = .{ 0, 1 } },
    .{ .minimums = .{ 1, 0 }, .nominal_ids = .{ h("aaf3e701495e155f1dd43db666cf48c08d00829b84e4c2cde5ee980bd845ad88"), h("c7e286f88efb0b5c22661f4f37044803024006402ebf70f43584483bbdc25807") },
        .signatures = .{ h("41e07997dc78282b816c2048bdc54a6cc39c663d2fbbf12b007159b275d44668"), h("0939425a8b5322a099e6792ea7e0544779d432c447df749400e3fea6e70f4df5") }, .function_ids = .{ h("210abd809ccb219bb5da13939c35efb93738da46468750c9be5d0c53bf2e1fce"), h("6bf78ae7e8f964ccc4eb3f34ad74549d910f404c0173d33d3e4174e8ec2cd16d") },
        .construction_ids = .{ h("2157f68a9fe24ea46ce85ca90052ee335765de389ec0ca4f8724d11b971a8fda"), h("e74c7125c140e925b73f786ad05c34f1cc8cc12d586b72e9a1e2ef5dece4bdc2") }, .contract_digests = .{ h("6f0c2dae1a37d9fef8dd543e4ec5cc7a31deff851995ae1c894f6fba5e2f31e0"), h("ad3d1243a0c9c1f9a0143eb36ec1defb966148ce691f8562a7a4cb00fb232984") },
        .scope_digest = h("8b7143a9e41316497b2b5715fde901be6cac2f5716ab751a7e4b033f35a99a9f"), .publication_digest = h("ca4280f202ba68abc8458743ff2200f4cb8c95839d1392c68e143179263a75b7"),
        .type_order = .{ 3, 1, 0, 4, 2, 5 }, .function_order = .{ 0, 1 }, .construction_order = .{ 0, 1 } },
};

const Literal = struct {
    program: model.Program,
    types: [6]tables.CommonType,
    type_positions: [6]usize,
    methods: [2]members.CommonMethod,
    constructors: [2]members.CommonConstruction,
    bindings: [4]storage.CommonBinding,
    concrete: [5]Item(storage.CommonStorage, "concrete"),
    functions: [2]model.Function,
    abis: [2]storage.CommonAbi,
    registers: [2][2]model.Register,
    physical: [2][2]t.Carrier,
    incoming: [2][1]t.TypeRef,
    parameters: [2][1]t.BindingRef,
    entries: [2][2]t.RegisterRef,
    instructions: [2][2]ins.Instruction,
    blocks: [2]model.Block,
    plan_operations: [2][2]control.SourcePlanOperation,
    plan_blocks: [2]control.SourcePlanBlock,
    plan_carriers: [2][2][]const u8,
    type_texts: [6][71]u8,
    method_refs: [2][1]t.MethodRef,
    union_refs: [2]t.TypeRef,
    shape_methods: [2][1]ShapeMethod,
    fixed_types: [6]Item(publication.StableScope, "types"),
    fixed_functions: [2]Item(publication.StableScope, "functions"),
    fixed_constructors: [2]publication.Construction,
    parameter_ids: [2][2]t.Hash,
    declaration_ids: [6]t.Hash,
    contracts: [2]Item(publication.Publication, "contracts"),
    dependencies: [2]Item(publication.FixedPublication, "dependencies"),
    closures: [2]Item(control.CommonClosures, "functions"),
    scopes: [2]Item(control.CommonControl, "scopes"),
    cells: [4]Item(control.CommonControl, "bindings"),
    function_control: [2]Item(control.CommonControl, "functions"),
    proof_methods: [1]Item(Item(tables.CommonViews, "compatibility"), "methods"),
    proofs: [1]Item(tables.CommonViews, "compatibility"),

    fn typeRef(self: *const Literal, logical: usize) t.TypeRef { return @enumFromInt(self.type_positions[logical]); }

    fn init(self: *Literal, example: Case) void {
        const ids = [6]t.Hash{ primitives[0], primitives[1], primitives[2], union_id, example.nominal_ids[0], example.nominal_ids[1] };
        var function_positions: [2]usize = undefined;
        for (example.function_order, 0..) |owner, index| function_positions[owner] = index;
        for (example.type_order, 0..) |logical, index| self.type_positions[logical] = index;
        self.union_refs = .{self.typeRef(0), self.typeRef(1)};
        for (ids, 0..) |id, logical| {
            @memcpy(self.type_texts[logical][0..7], "sha256:");
            @memcpy(self.type_texts[logical][7..], &std.fmt.bytesToHex(id, .lower));
        }
        for (0..2) |owner| {
            const function: t.FunctionRef = @enumFromInt(function_positions[owner]);
            const start: u32 = @intCast(10 + owner * 50);
            self.bindings[owner] = .{ .id = if (owner == 0) "argument:implementation" else "argument:public",
                .owner = .{ .param = function }, .name = "input", .@"type" = self.typeRef(3), .writable = false,
                .origin = .{ .source = @enumFromInt(0), .start = start + 4, .end = start + 5 }, .carrier = .payload,
                .scope = @enumFromInt(function_positions[owner]), .declaration_kind = .parameter };
            self.bindings[owner + 2] = .{ .id = receiver_ids[owner], .owner = .{ .receiver = function }, .name = "this",
                .@"type" = self.typeRef(4 + owner), .writable = false,
                .origin = .{ .source = @enumFromInt(0), .start = start + 2, .end = start + 3 },
                .carrier = .{ .@"type" = self.typeRef(4 + owner) }, .scope = @enumFromInt(function_positions[owner]), .declaration_kind = null };
            self.shape_methods[owner][0] = .{ .access = .public, .name = "consume", .parameters = &ordinary_label,
                .return_type = labels[2], .minimum_argument_count = example.minimums[owner] };
        }
        for (self.bindings, 0..) |binding, index| self.cells[index] = .{ .binding = @enumFromInt(index), .scope = binding.scope.? };
        for (example.function_order, 0..) |owner, index| {
            const owner_type = self.typeRef(owner + 4);
            const start: u32 = @intCast(10 + owner * 50);
            const begin: t.Origin = .{ .source = @enumFromInt(0), .start = start, .end = start + 30 };
            const end: t.Origin = .{ .source = @enumFromInt(0), .start = start + 28, .end = start + 29 };
            self.method_refs[owner] = .{@enumFromInt(index)};
            self.methods[index] = .{ .id = example.function_ids[owner], .owner = owner_type, .function = @enumFromInt(index),
                .name = "consume", .signature = example.signatures[owner], .override = null, .access = .public };
            self.physical[index] = .{ .{ .@"type" = owner_type }, .payload };
            self.registers[index] = .{ .{ .carrier = self.physical[index][0], .view = owner_type }, .{ .carrier = .payload, .view = self.typeRef(3) } };
            self.entries[index] = .{@enumFromInt(0), @enumFromInt(1)};
            self.parameters[index] = .{@enumFromInt(owner)};
            self.incoming[index] = .{self.typeRef(3)};
            self.instructions[index] = .{
                .{ .source = begin, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
                .{ .source = end, .result = null, .operands = &.{}, .data = .@"return" },
            };
            self.blocks[index] = .{ .parameters = &self.entries[index], .instructions = &self.instructions[index] };
            self.plan_operations[index] = .{
                .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = begin },
                .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{}, .successors = &.{}, .source = end },
            };
            self.plan_blocks[index] = .{ .parameters = &self.entries[index], .operations = &self.plan_operations[index] };
            self.plan_carriers[index] = .{ &self.type_texts[owner + 4], "payload" };
            self.functions[index] = .{ .id = example.function_ids[owner], .signature = example.signatures[owner], .abi = @enumFromInt(index),
                .source = @enumFromInt(0), .role = .ordinary, .declaration = .{ .start = start, .end = start + 30 },
                .name = "consume", .registers = &self.registers[index], .blocks = self.blocks[index .. index + 1] };
            self.abis[index] = .{ .kind = .common, .function = @enumFromInt(index), .signature = example.signatures[owner],
                .parameters = &self.parameters[index], .argument_types = &self.incoming[index], .method_minimum_argument_count = example.minimums[owner],
                .receiver = @enumFromInt(owner + 2), .construction = null, .receiver_frame = null, .lexical_environment = null,
                .physical_parameters = &self.physical[index], .result = null, .result_carrier = null,
                .source_plan = .{ .carriers = &self.plan_carriers[index], .blocks = self.plan_blocks[index .. index + 1] } };
            self.parameter_ids[index] = .{ ids[owner + 4], union_id };
            self.fixed_functions[index] = .{ .function_id = example.function_ids[owner], .signature_hash = example.signatures[owner], .kind = .method,
                .decl_key = .{ .kind = .method, .name = "consume", .path = method_paths[owner], .source_path = source_path },
                .parameter_types = &self.parameter_ids[index], .method_minimum_argument_count = example.minimums[owner], .return_type = primitives[2],
                .construction = null, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public };
            self.contracts[index] = .{ .function_id = example.function_ids[owner], .signature_hash = example.signatures[owner], .upper = upper,
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
                .kind = .@"implicit-base", .origin = at, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = self.typeRef(owner + 4) },
                .source_signature = .{ .id = constructor_source_ids[owner], .origin = at }, .implicit_forward = null,
                .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public };
            self.fixed_constructors[index] = .{ .id = example.construction_ids[owner], .owner = ids[owner + 4], .base = null,
                .kind = .@"implicit-base", .function_id = null };
        }
        var concrete_index: usize = 0;
        for (example.type_order, 0..) |logical, index| {
            const nominal = logical >= 4;
            const kind: @FieldType(tables.CommonType, "kind") = switch (logical) { 0 => .scalar, 1 => .@"undefined", 2 => .@"void", 3 => .@"union", else => .reference };
            self.types[index] = .{ .id = ids[logical], .kind = kind,
                .name = if (nominal) owner_names[logical - 4] else if (logical == 0) "i32" else if (logical == 1) "undefined" else if (logical == 2) "void" else "union",
                .native_code = if (logical == 0) 1 else 0, .base = null, .element = null,
                .members = if (logical == 3) &self.union_refs else &.{}, .methods = if (nominal) &self.method_refs[logical - 4] else null,
                .nominal_key = if (nominal) .{ .source = @enumFromInt(0), .declaration_path = owner_paths[logical - 4], .category = .reference } else null,
                .runtime_key = if (nominal) runtime_keys[logical - 4] else null };
            self.fixed_types[index] = .{ .id = ids[logical], .label = labels[logical], .shape = if (nominal)
                .{ .nominal = .{ .kind = .reference, .label = labels[logical], .base = null,
                    .construction = .{ .access = .public, .parameters = &.{}, .return_type = labels[logical], .argument_signature = null },
                    .fields = &.{}, .methods = &self.shape_methods[logical - 4] } }
                else if (logical == 3) .{ .union_type = .{ .kind = .@"union", .label = labels[3], .members = &union_labels } }
                else .{ .primitive = .{ .kind = if (logical == 0) .scalar else if (logical == 1) .@"undefined" else .@"void", .label = labels[logical] } } };
            self.declaration_ids[index] = ids[logical];
            if (logical == 3) continue;
            self.concrete[concrete_index] = .{ .@"type" = @enumFromInt(index),
                .carrier = .{ .layout = .{ .byte_size = if (nominal) 8 else if (logical == 0) 4 else 0,
                    .alignment = if (nominal) 8 else if (logical == 0) 4 else 1, .reference_count = if (nominal) 1 else 0 }, .field_offsets = &.{} },
                .body = if (nominal) .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } else null };
            concrete_index += 1;
        }
        const scope: publication.StableScope = .{ .profile = .@"common-program-fixed-v5", .declaration_types = &self.declaration_ids,
            .constructions = &self.fixed_constructors, .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path,
            .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} }, .types = &self.fixed_types, .functions = &self.fixed_functions,
            .globals = &.{}, .environments = &.{}, .host_context = null, .host_imports = &.{} };
        self.proof_methods[0] = .{ .actual = @enumFromInt(function_positions[0]), .target = @enumFromInt(function_positions[1]) };
        self.proofs[0] = .{ .source_type = self.typeRef(4), .target_type = self.typeRef(5),
            .origin = .{ .source = @enumFromInt(0), .start = 110, .end = 120 }, .fields = &.{}, .methods = &self.proof_methods };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = 19, .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout,
                .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = 1019 },
            .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = 160, .root_source = @enumFromInt(0),
            .functions = &self.functions, .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 160 }}, .mode = .{ .common = .{
                .types = &self.types, .members = .{ .fields = &.{}, .methods = &self.methods, .constructions = &self.constructors }, .domains = &.{},
                .storage = .{ .bindings = &self.bindings, .concrete = &self.concrete, .arrays = &.{}, .environments = &.{},
                    .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } }, .abis = &self.abis,
                .views = .{ .compatibility = &self.proofs, .dispatch = &.{}, .entries = &.{} },
                .modules = .{ .modules = &.{}, .globals = &.{}, .hosts = &.{}, .initialization = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} } },
                .closures = .{ .functions = &self.closures, .environments = &.{}, .calls = &.{} },
                .exceptions = .{ .functions = &self.function_control, .bindings = &self.cells, .scopes = &self.scopes },
                .authority = .{ .exports = .{}, .entries = .{}, .resources = .{}, .published = .{}, .fixed_publication = .{
                    .stable_scope = scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 5 },
                        .mode = .fixed, .scope = scope, .scope_digest = example.scope_digest, .expected_digest = example.publication_digest, .contracts = &self.contracts },
                    .dependencies = &self.dependencies, .request = .{ .targets = &.{} } } },
            } } } };
    }
};

// Each phase shares exactly one non-refillable Context. These are metadata
// consumers only; no publication admission or live execution is exercised.
fn joined(c: *context.Context) context.Error!void {
    try refs.check(c);
    try layout.check(c);
    try ssa.check(c);
    try identity.check(c);
    try interfaces.checkInterfaces(c);
}

test "explicit minimum changes method and owner identities for the same union input" {
    var optional: Literal = undefined;
    var required: Literal = undefined;
    optional.init(cases[0]);
    required.init(cases[1]);
    var left = context.Context{ .program = &optional.program, .allocator = std.testing.allocator };
    var right = context.Context{ .program = &required.program, .allocator = std.testing.allocator };
    try joined(&left);
    try joined(&right);
    try compatibility.checkCompatibility(&left);
    try compatibility.checkCompatibility(&right);
    for (0..2) |owner| {
        try std.testing.expect(!std.mem.eql(u8, &cases[0].nominal_ids[owner], &cases[1].nominal_ids[owner]));
        try std.testing.expect(!std.mem.eql(u8, &cases[0].signatures[owner], &cases[1].signatures[owner]));
        try std.testing.expect(!std.mem.eql(u8, &cases[0].function_ids[owner], &cases[1].function_ids[owner]));
    }
    try std.testing.expectEqual(optional.types[optional.type_positions[3]].id, required.types[required.type_positions[3]].id);
    try std.testing.expect(left.remaining < model.format.max_work and right.remaining < model.format.max_work);
}

test "minimum compatibility accepts weaker actual requirement with the same union input" {
    var literal: Literal = undefined;
    literal.init(cases[2]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try compatibility.checkCompatibility(&c);
}

test "minimum compatibility rejects a required actual behind an optional view" {
    var literal: Literal = undefined;
    literal.init(cases[3]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
}

test "ABI minimum cannot disagree with unchanged owner semantic shape" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    literal.abis[0].method_minimum_argument_count = 1;
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, identity.check(&c));
}

test "semantic shape minimum cannot disagree with unchanged ABI" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    literal.shape_methods[0][0].minimum_argument_count = 1;
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, identity.check(&c));
}

test "fixed function minimum cannot disagree with unchanged ABI" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    literal.fixed_functions[0].method_minimum_argument_count = 1;
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, identity.check(&c));
}

test "every explicit method minimum is bounded by ordinary parameter count" {
    for (0..3) |layer| {
        var literal: Literal = undefined;
        literal.init(cases[0]);
        switch (layer) {
            0 => literal.abis[0].method_minimum_argument_count = 2,
            1 => literal.shape_methods[0][0].minimum_argument_count = 2,
            2 => literal.fixed_functions[0].method_minimum_argument_count = 2,
            else => unreachable,
        }
        var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
        try std.testing.expectError(error.InvalidShape, refs.check(&c));
    }
}

test "internal null default cannot stand in for method declaration metadata" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    literal.abis[0].method_minimum_argument_count = null;
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try std.testing.expectError(error.InvalidShape, layout.check(&c));
    literal.init(cases[0]);
    literal.fixed_functions[0].method_minimum_argument_count = null;
    var fixed = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidShape, refs.check(&fixed));
}

test "nonmethod roles cannot carry method minimum metadata" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    // A complete free-function ABI tuple at the layout seam: its former
    // receiver is an ordinary local, and its only physical input is payload.
    const receiver_binding = literal.abis[0].receiver.?;
    literal.bindings[@intFromEnum(receiver_binding)].owner = .{ .local = @enumFromInt(0) };
    literal.bindings[@intFromEnum(receiver_binding)].declaration_kind = .local;
    literal.abis[0].receiver = null;
    literal.abis[0].physical_parameters = literal.physical[0][1..];
    literal.abis[0].method_minimum_argument_count = null;
    var valid = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&valid);
    try layout.check(&valid);
    // Only the nonmethod minimum changes. This branch checks layout metadata;
    // it does not claim complete Source, SSA or semantic method identity.
    literal.abis[0].method_minimum_argument_count = 0;
    var abi = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try refs.check(&abi);
    try std.testing.expectError(error.InvalidShape, layout.check(&abi));
    literal.init(cases[0]);
    literal.fixed_functions[0].kind = .source;
    var fixed = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidShape, refs.check(&fixed));
}

test "private predecessor envelope and mixed capability are refused" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    try model.requireFormat(literal.program.envelope, literal.program.target);
    literal.program.envelope.version = 18;
    try std.testing.expectError(error.WrongFormat, model.requireFormat(literal.program.envelope, literal.program.target));
    literal.program.envelope.version = 19;
    literal.program.target.capability = 1018;
    try std.testing.expectError(error.WrongFormat, model.requireFormat(literal.program.envelope, literal.program.target));
    literal.program.target.capability = 1019;
    literal.program.envelope.schema_hash = h("cd560f1da0e1d809fb2ffa907baf7a27b86e3ccecb8323e0e46ce1570a8a1b65");
    try std.testing.expectError(error.WrongFormat, model.requireFormat(literal.program.envelope, literal.program.target));
    literal.init(cases[0]);
    literal.program.tables.mode.common.authority.fixed_publication.publication.format.version = 4;
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidShape, refs.check(&c));
}

test "metadata checks and M12 share one cumulative work allowance" {
    var measured: Literal = undefined;
    measured.init(cases[0]);
    var baseline = context.Context{ .program = &measured.program, .allocator = std.testing.allocator };
    try joined(&baseline);
    const spent = model.format.max_work - baseline.remaining;
    var literal: Literal = undefined;
    literal.init(cases[0]);
    var limited = context.Context{ .program = &literal.program, .allocator = std.testing.allocator, .remaining = spent + 1 };
    try joined(&limited);
    try std.testing.expectEqual(@as(usize, 1), limited.remaining);
    try std.testing.expectError(error.WorkLimit, compatibility.checkCompatibility(&limited));
    try std.testing.expectEqual(@as(usize, 0), limited.remaining);
}
