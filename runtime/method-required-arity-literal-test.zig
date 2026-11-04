// SPDX-License-Identifier: MIT
// New independent typed metadata. Hashes are frozen offline from the rows,
// never computed by the checker under test. No packet, Source package,
// decoder, Actual analysis, dispatch/bodycall, VM, or execution receipt.
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
const compatibility = @import("wire-program-reference-contracts-check.zig");
const t = model.types;
const ins = model.instruction;
const Concrete = @typeInfo(@FieldType(storage.CommonStorage, "concrete")).pointer.child;
const ScopeType = @typeInfo(@FieldType(publication.StableScope, "types")).pointer.child;
const ScopeFunction = @typeInfo(@FieldType(publication.StableScope, "functions")).pointer.child;
const Contract = @typeInfo(@FieldType(publication.Publication, "contracts")).pointer.child;
const Dependency = @typeInfo(@FieldType(publication.FixedPublication, "dependencies")).pointer.child;
const ClosureFunction = @typeInfo(@FieldType(control.CommonClosures, "functions")).pointer.child;
const Scope = @typeInfo(@FieldType(control.CommonControl, "scopes")).pointer.child;
const Cell = @typeInfo(@FieldType(control.CommonControl, "bindings")).pointer.child;
const FunctionControl = @typeInfo(@FieldType(control.CommonControl, "functions")).pointer.child;
const Proof = @typeInfo(@FieldType(tables.CommonViews, "compatibility")).pointer.child;
const ProofMethod = @typeInfo(@FieldType(Proof, "methods")).pointer.child;
const Nominal = @FieldType(publication.ScopeShape, "nominal");
const ScopeMethod = @typeInfo(@typeInfo(@FieldType(Nominal, "methods")).optional.child).pointer.child;

fn h(comptime hex: []const u8) t.Hash {
    @setEvalBranchQuota(100000);
    var bytes: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&bytes, hex) catch unreachable;
    return bytes;
}

// Logical indexes: i32, bool, undefined, void, A, B, i32|undefined.
const source_path = "/literal-method-required-arity.ts";
const source_hash = h("31dba2c5b62968e59bc8e2199ed36a8b6ef058f72a4e13f8a4c191d41d940f08");
const payload_hash = h("9fc6ab07422759631607959f72db60a90f449c09e423514f38126bf547f3180a");
const input_identity = h("f081f10fc915a2dc9af5adc29ba63ce85f1f93fcea0124ec248b2d8ae7648305");
const primitive_ids = [4]t.Hash{ h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"), h("811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721"), h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"), h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190") };
const union_id = h("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
const runtime_keys = [2]t.Hash{ h("3a01dfc8f95029ee1dc39aa8a0ab75dfaf06765e318c5775467d9435c1a6b2ee"), h("3a11dceca6fc0b1339171d2474fee84532727e675b68d151820dfaab87426ddb") };
const source_signatures = [2]t.Hash{ h("94b2880f5b2e5034206c34e9b0c007554443df385fc07fe88aeff0136b32b15c"), h("cb545ac454b58cb15393fe56d3f540e2690c925f86861f54c24d2cf9ce5c1a35") };
const receiver_ids = [2][]const u8{ "this@sha256:889e5aa996238cd1838749cc1706d70a485d0fc6d93d145779d6b2ccb502599c", "this@sha256:786dc835cfba08fb89a645b2ae8cee34f45064c8731a980caca17c14c2207108" };
const labels = [7][]const u8{ "{\"kind\":\"scalar\",\"name\":\"i32\"}", "{\"kind\":\"scalar\",\"name\":\"bool\"}", "{\"kind\":\"undefined\",\"name\":\"undefined\"}", "{\"kind\":\"void\",\"name\":\"void\"}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"A\"],\"sourcePath\":\"/literal-method-required-arity.ts\"}}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"B\"],\"sourcePath\":\"/literal-method-required-arity.ts\"}}", "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}" };
const union_labels = [2][]const u8{ "{\"kind\":\"scalar\",\"name\":\"i32\"}", "{\"kind\":\"undefined\",\"name\":\"undefined\"}" };
const nominal_paths = [2][]const []const u8{ &.{"A"}, &.{"B"} };
const declaration_paths = [2][]const []const u8{ &.{"type", "A"}, &.{"type", "B"} };
const names = [_][]const u8{ "i32", "bool", "undefined", "void", "A", "B", "union" };
const owners = [_][]const u8{ "A", "B" };
const parameter_ids = [2][2][]const u8{
    .{ "parameter:A:0", "parameter:A:1" },
    .{ "parameter:B:0", "parameter:B:1" },
};
const parameter_names = [_][]const u8{ "p0", "p1" };
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const seven_properties = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "7" } }};
const upper: publication.EffectUpper = .{
    .parameters = &.{}, .captures = &.{}, .globals = .{ .reads = &.{}, .writes = &.{} },
    .host_resources = .{ .reads = &.{}, .writes = &.{} },
    .facets = .{ .allocation = false, .@"await" = false, .eh_control = false,
        .escape = false, .lock = false, .managed_reference = false,
        .may_throw = false, .unknown_host = false },
};
const Case = struct {
    name: []const u8,
    accept: bool,
    counts: [2]usize,
    parameters: [2][2]usize,
    results: [2]usize,
    nominal_ids: [2]t.Hash,
    function_ids: [2]t.Hash,
    signatures: [2]t.Hash,
    construction_ids: [2]t.Hash,
    contract_digests: [2]t.Hash,
    scope_digest: t.Hash,
    publication_digest: t.Hash,
    type_order: [7]usize,
    function_order: [2]usize,
    construction_order: [2]usize,
};
const cases = [_]Case{
    .{ .name = "equal", .accept = true,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("8966902526fa5eb3dee13d1d9b9b8e4c4be5ebc6d9bc7c4a4114c8ed42794b71"), h("6ccf6fc40e7cc6654e6eb80231d63cfe0b9a29078f31204043dcf4f13c86d483") },
        .function_ids = .{ h("229b521fba0fe305a38321bc4facf470a025bb086f0cc9c0e6061ce21b111997"), h("dc2b21a84306d8e523bb3cd7295d8582d78bf54621ed9f963984f32b28b2220a") },
        .signatures = .{ h("821e91646f3cff9eea7d0babb9329500ccf28e2d870c6ed1017cb87294b07845"), h("c0f7b63528103be292e76d29a24a82d08c22b09fd9349c47bb3ffd53913c2465") },
        .construction_ids = .{ h("e4ebef031f28e0ae8428761a026b9dd43e4da358a5d64fca783eb4d070346432"), h("afa6a5856502d9f7861b4e871f1258fbbf085ffa02594d21a6d391c6c96addf9") },
        .contract_digests = .{ h("b95ee5d799e82e8d41ee43420551bd3136de537fc8cc7d301a62aa8cf4ba4ac7"), h("a21aacc2f851daaa305bb93a3d793782108f4157ee77e591d3f58e94422b8011") },
        .scope_digest = h("00a3a0baa555980471d5e99ed4311b4ee17234f4cc9440f65c8c66331cb2ed03"),
        .publication_digest = h("a6b18c5737cd7c902e824954546c4bcea6c18d4d96600421de8742c6f5302329"),
        .type_order = .{ 6, 2, 5, 1, 4, 0, 3 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "fewer", .accept = true,
        .counts = .{ 1, 2 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("8966902526fa5eb3dee13d1d9b9b8e4c4be5ebc6d9bc7c4a4114c8ed42794b71"), h("63ea492cf730305d8feb9717dcf4c9f8cf3e8864c0aa877ad298d0b1fd13ebc0") },
        .function_ids = .{ h("229b521fba0fe305a38321bc4facf470a025bb086f0cc9c0e6061ce21b111997"), h("0038b84bc13f4dc9d8f486b85eb9284d2f6fee191fe53720bc1ebe0b3443edc1") },
        .signatures = .{ h("821e91646f3cff9eea7d0babb9329500ccf28e2d870c6ed1017cb87294b07845"), h("15f33c9643b4550f95b5ee67fc2d299dd7f06100242610505e03363610562ae4") },
        .construction_ids = .{ h("e4ebef031f28e0ae8428761a026b9dd43e4da358a5d64fca783eb4d070346432"), h("80c967e3e22fb3e9ba85aed6869e386800cf4c95b5ce7398bb5d62f85c942bdf") },
        .contract_digests = .{ h("b95ee5d799e82e8d41ee43420551bd3136de537fc8cc7d301a62aa8cf4ba4ac7"), h("0ee79d380cdcf8184447fbc3c1d0f0a4bbf81aea7715414de604c06c5f258d55") },
        .scope_digest = h("e1f69c1b634ab944b44013852b588aa3165d15dc7426aabba8299186c6bb891e"),
        .publication_digest = h("66632b4376a1f85f7e485fd7def202850e8cf191d6a8188e4922c01fc662f2d6"),
        .type_order = .{ 6, 5, 2, 1, 4, 0, 3 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .name = "extra_required", .accept = false,
        .counts = .{ 2, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("011642c0c90d7f0decd5defccbf0795b8d50856e616f565cc9c98ab328de088f"), h("6ccf6fc40e7cc6654e6eb80231d63cfe0b9a29078f31204043dcf4f13c86d483") },
        .function_ids = .{ h("61cb081a7ba2ee5da63cccec322b2e2eda3ebfa80d3949231fe3145466f46b16"), h("dc2b21a84306d8e523bb3cd7295d8582d78bf54621ed9f963984f32b28b2220a") },
        .signatures = .{ h("ddab41a31b9454eb5b5336c37996779c9a58c643be8b837804622cf2912efbd9"), h("c0f7b63528103be292e76d29a24a82d08c22b09fd9349c47bb3ffd53913c2465") },
        .construction_ids = .{ h("f95d1ec7a82a3858ebb3c9b9f05f875dbe31cdb605f9e2a63f45758adabe3d3d"), h("afa6a5856502d9f7861b4e871f1258fbbf085ffa02594d21a6d391c6c96addf9") },
        .contract_digests = .{ h("4bf18df1df0aaf8d43a9435c1efb461af4bcae8bebe8e174778c53cc31f5cd83"), h("a21aacc2f851daaa305bb93a3d793782108f4157ee77e591d3f58e94422b8011") },
        .scope_digest = h("8db45733650f6c667c811c9fc96c707c0e34ecc1bdaafa153920d7f0413d96c6"),
        .publication_digest = h("4354c4beef2e498536e3c4c9f68500a076ee85ee7338b0946bce130e5f7d02cf"),
        .type_order = .{ 4, 6, 2, 5, 1, 0, 3 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "extra_required_undefined_union", .accept = false,
        .counts = .{ 2, 1 }, .parameters = .{ .{ 0, 6 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("4cf27de7039948a12e4f8caab96a5e7c30a7adbaa3eb95ae2724d7dfae5f1f4e"), h("6ccf6fc40e7cc6654e6eb80231d63cfe0b9a29078f31204043dcf4f13c86d483") },
        .function_ids = .{ h("23bdbf21e2ce0a9756e9eca60830a37fb39602d0d2aada9d44e684e74ece6c3c"), h("dc2b21a84306d8e523bb3cd7295d8582d78bf54621ed9f963984f32b28b2220a") },
        .signatures = .{ h("4b9d3dee5155b79757b8a9e3505fb35c26edbc6609f998f7cbfc86671bf38dfc"), h("c0f7b63528103be292e76d29a24a82d08c22b09fd9349c47bb3ffd53913c2465") },
        .construction_ids = .{ h("c146a2fc7b32f5927ea7c2fb95c22f20f1210abbd2e0a9cb8f4a759e3dfb99db"), h("afa6a5856502d9f7861b4e871f1258fbbf085ffa02594d21a6d391c6c96addf9") },
        .contract_digests = .{ h("d3f2ff3cbc1115b80aa3277595a999c27a6c99d64fa5993fe561f5d8f72f6465"), h("a21aacc2f851daaa305bb93a3d793782108f4157ee77e591d3f58e94422b8011") },
        .scope_digest = h("91171f966d9976c744edcc50ce3defa700e61eb5d2051567f581e07601d7dcda"),
        .publication_digest = h("87afe927bc5cffb97f60073f251049c08df240cc5eb943759121efbd403fd8f4"),
        .type_order = .{ 6, 4, 2, 5, 1, 0, 3 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "parameter_direction", .accept = false,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 1, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("8966902526fa5eb3dee13d1d9b9b8e4c4be5ebc6d9bc7c4a4114c8ed42794b71"), h("c9f49ab3142f00bc5a92de64625ef89edffe15eb6286a57846bcc8e6505452b2") },
        .function_ids = .{ h("229b521fba0fe305a38321bc4facf470a025bb086f0cc9c0e6061ce21b111997"), h("0eb1bdefb0b9d6acc5005b90ce9d7f4d427331c40564174b9060097e1ffa6b0e") },
        .signatures = .{ h("821e91646f3cff9eea7d0babb9329500ccf28e2d870c6ed1017cb87294b07845"), h("95184316e8bf8b3585396df31eae89d850b4bf771f4eaae16fe38e6ad3a5c772") },
        .construction_ids = .{ h("e4ebef031f28e0ae8428761a026b9dd43e4da358a5d64fca783eb4d070346432"), h("0844a37abd6de89baba8b26981eceeaf1bdc2a5c4c0f4262eb0ff20f7cd71592") },
        .contract_digests = .{ h("b95ee5d799e82e8d41ee43420551bd3136de537fc8cc7d301a62aa8cf4ba4ac7"), h("5b238a10eeac8c0da3ec31b2093cf4498861af1fad0db49ac7fb8c5eb52e9669") },
        .scope_digest = h("b7020cc032576f11009d2eb3916b1ffc736eb627706b5f238928e30df53b8315"),
        .publication_digest = h("97a06a2e95622a303a2f6adb45bb696d7680560cda1522be5b6c1de94aa5bc79"),
        .type_order = .{ 6, 2, 1, 4, 0, 3, 5 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .name = "return_direction", .accept = false,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 0 },
        .nominal_ids = .{ h("8966902526fa5eb3dee13d1d9b9b8e4c4be5ebc6d9bc7c4a4114c8ed42794b71"), h("02e88eb514a6ab36106a44e17b407155e2b71ce5c7c580e3318ae4adfa913a73") },
        .function_ids = .{ h("229b521fba0fe305a38321bc4facf470a025bb086f0cc9c0e6061ce21b111997"), h("19f26014479d7ce0a2b09ea686c59afae82fae4ea2d11b0ad11ff8ebfbde7291") },
        .signatures = .{ h("821e91646f3cff9eea7d0babb9329500ccf28e2d870c6ed1017cb87294b07845"), h("66a155783bd2af58a105ad627c85065ccb9c8a0f6535a5628dc4a5959d6bb84c") },
        .construction_ids = .{ h("e4ebef031f28e0ae8428761a026b9dd43e4da358a5d64fca783eb4d070346432"), h("13e3e96f39ebbcbab2c9f9f83e3425bbb568c524b2e1a0b4cdadfd58e11e52e1") },
        .contract_digests = .{ h("b95ee5d799e82e8d41ee43420551bd3136de537fc8cc7d301a62aa8cf4ba4ac7"), h("ee9a2a8fa51694544b23b94113c5ea7fe5583d844fb99b09bc115d1b4e65239e") },
        .scope_digest = h("50f180750ae8e86060dfff382ef059fb6715aa5e281e9c3ae5ba823f9823357b"),
        .publication_digest = h("d09e837e1308df994e0c7139a77239a312e3df77757fe31f55b72bb0e81bb10a"),
        .type_order = .{ 5, 6, 2, 1, 4, 0, 3 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .name = "void_view_discards_result", .accept = true,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 0, 3 },
        .nominal_ids = .{ h("2bfcb4612be8eb46e45ac3283125bbcbf8877101f3de548c9169ed05646168d5"), h("6ccf6fc40e7cc6654e6eb80231d63cfe0b9a29078f31204043dcf4f13c86d483") },
        .function_ids = .{ h("bc0bc832e0f7bc5cc53b8e52b962e61074615f4f19b78b296f2a47db14e80b7a"), h("dc2b21a84306d8e523bb3cd7295d8582d78bf54621ed9f963984f32b28b2220a") },
        .signatures = .{ h("46ec97978c9257ce59b9bc4a12ca96692567a053c174f031fcbb33988a561ffe"), h("c0f7b63528103be292e76d29a24a82d08c22b09fd9349c47bb3ffd53913c2465") },
        .construction_ids = .{ h("dc6e35d6b96a67eac3f673114e2a70436987a05dfa07a145a0112aac7709b56d"), h("afa6a5856502d9f7861b4e871f1258fbbf085ffa02594d21a6d391c6c96addf9") },
        .contract_digests = .{ h("6439d3eafbccc23c3d85b3dd166f6639cb87bf3c602df0b9a790e41ccba2adf2"), h("a21aacc2f851daaa305bb93a3d793782108f4157ee77e591d3f58e94422b8011") },
        .scope_digest = h("bda57df4c4318d1b1ad8cc1fbca347bb11453b221e80ccd0d360e88c296414ac"),
        .publication_digest = h("885fbb9e1116012427afe8a53920ed3ac5e3528f504bd4461b97f7f28c044bf1"),
        .type_order = .{ 6, 4, 2, 5, 1, 0, 3 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
};

// One self-owned fixture receives its final address before connecting slices.
// Shared immutable labels/hashes are metadata, never a borrowed Program.
const Fixture = struct {
    program: model.Program,
    types: [7]tables.CommonType,
    methods: [2]members.CommonMethod,
    constructions: [2]members.CommonConstruction,
    bindings: [5]storage.CommonBinding,
    concrete: [6]Concrete,
    functions: [2]model.Function,
    abis: [2]storage.CommonAbi,
    registers: [2][4]model.Register,
    blocks: [2]model.Block,
    instructions: [2][3]ins.Instruction,
    operations: [2][3]control.SourcePlanOperation,
    plan_blocks: [2]control.SourcePlanBlock,
    plan_carriers: [2][4][]const u8,
    physical: [2][3]t.Carrier,
    entry: [2][3]t.RegisterRef,
    return_refs: [2][1]t.RegisterRef,
    ordinary_refs: [2][2]t.BindingRef,
    argument_types: [2][2]t.TypeRef,
    receiver_refs: [2]t.BindingRef,
    method_refs: [2][1]t.MethodRef,
    union_members: [2]t.TypeRef,
    positions: [7]usize,
    type_text: [7][71]u8,
    scope: publication.StableScope,
    scope_types: [7]ScopeType,
    scope_functions: [2]ScopeFunction,
    scope_constructions: [2]publication.Construction,
    scope_methods: [2][1]ScopeMethod,
    scope_parameter_labels: [2][2][]const u8,
    function_parameter_ids: [2][3]t.Hash,
    declaration_types: [7]t.Hash,
    contracts: [2]Contract,
    dependencies: [2]Dependency,
    closures: [2]ClosureFunction,
    scopes: [2]Scope,
    cells: [5]Cell,
    controls: [2]FunctionControl,
    proof_methods: [1]ProofMethod,
    proofs: [1]Proof,

    fn ty(self: *const Fixture, logical: usize) t.TypeRef { return @enumFromInt(self.positions[logical]); }

    fn init(self: *Fixture, case: Case) void {
        const ids = [7]t.Hash{ primitive_ids[0], primitive_ids[1], primitive_ids[2], primitive_ids[3],
            case.nominal_ids[0], case.nominal_ids[1], union_id };
        var function_refs: [2]usize = undefined;
        for (case.function_order, 0..) |owner, index| function_refs[owner] = index;
        for (case.type_order, 0..) |logical, index| self.positions[logical] = index;
        self.union_members = .{ self.ty(0), self.ty(2) };
        for (ids, 0..) |value, logical| {
            @memcpy(self.type_text[logical][0..7], "sha256:");
            @memcpy(self.type_text[logical][7..], &std.fmt.bytesToHex(value, .lower));
        }
        var binding_count: usize = 0;
        for (case.function_order) |owner| {
            const function_index = function_refs[owner];
            const start: u32 = @intCast(owner * 40);
            self.bindings[binding_count] = .{ .id = receiver_ids[owner],
                .owner = .{ .receiver = @enumFromInt(function_index) }, .name = "this",
                .@"type" = self.ty(owner + 4), .writable = false,
                .origin = .{ .source = @enumFromInt(0), .start = start + 2, .end = start + 3 },
                .carrier = .{ .@"type" = self.ty(owner + 4) },
                .scope = @enumFromInt(function_index), .declaration_kind = null };
            binding_count += 1;
            for (0..case.counts[owner]) |ordinal| {
                const logical = case.parameters[owner][ordinal];
                self.bindings[binding_count] = .{ .id = parameter_ids[owner][ordinal],
                    .owner = .{ .param = @enumFromInt(function_index) }, .name = parameter_names[ordinal],
                    .@"type" = self.ty(logical), .writable = false,
                    .origin = .{ .source = @enumFromInt(0), .start = start + 4 + @as(u32, @intCast(ordinal * 2)),
                        .end = start + 5 + @as(u32, @intCast(ordinal * 2)) },
                    .carrier = if (logical == 6) .payload else .{ .@"type" = self.ty(logical) },
                    .scope = @enumFromInt(function_index), .declaration_kind = .parameter };
                binding_count += 1;
            }
        }
        std.mem.sort(storage.CommonBinding, self.bindings[0..binding_count], {}, struct {
            fn less(_: void, a: storage.CommonBinding, b: storage.CommonBinding) bool {
                return std.mem.order(u8, a.id, b.id) == .lt;
            }
        }.less);
        for (self.bindings[0..binding_count], 0..) |binding, index| {
            switch (binding.owner) {
                .receiver => |function| self.receiver_refs[@intFromEnum(function)] = @enumFromInt(index),
                .param => |function| self.ordinary_refs[@intFromEnum(function)][binding.name[1] - '0'] = @enumFromInt(index),
                else => unreachable,
            }
            self.cells[index] = .{ .binding = @enumFromInt(index), .scope = binding.scope.? };
        }
        for (case.function_order, 0..) |owner, index| {
            const count = case.counts[owner];
            const start: u32 = @intCast(owner * 40);
            const end = start + 30;
            const origin: t.Origin = .{ .source = @enumFromInt(0), .start = start, .end = end };
            const last: t.Origin = .{ .source = @enumFromInt(0), .start = end - 2, .end = end - 1 };
            self.method_refs[owner] = .{@enumFromInt(index)};
            self.methods[index] = .{ .id = case.function_ids[owner], .owner = self.ty(owner + 4),
                .function = @enumFromInt(index), .name = "m", .signature = case.signatures[owner],
                .override = null, .access = .public };
            for (0..count + 1) |ordinal| {
                const logical = if (ordinal == 0) owner + 4 else case.parameters[owner][ordinal - 1];
                const carrier: t.Carrier = if (logical == 6) .payload else .{ .@"type" = self.ty(logical) };
                self.physical[index][ordinal] = carrier;
                self.registers[index][ordinal] = .{ .carrier = carrier, .view = self.ty(logical) };
                self.plan_carriers[index][ordinal] = if (logical == 6) "payload" else &self.type_text[logical];
                self.entry[index][ordinal] = @enumFromInt(ordinal);
                self.function_parameter_ids[index][ordinal] = ids[logical];
                if (ordinal != 0) {
                    self.argument_types[index][ordinal - 1] = self.ty(logical);
                    self.scope_parameter_labels[owner][ordinal - 1] = labels[logical];
                }
            }
            self.instructions[index][0] = .{ .source = origin, .result = null, .operands = &.{},
                .data = .{ .fuel = .{ .event = .entry } } };
            self.operations[index][0] = .{ .name = "fuel", .view = "void", .properties = &fuel_properties,
                .result = null, .operands = &.{}, .successors = &.{}, .source = origin };
            const valued = case.results[owner] != 3;
            const instruction_count: usize = if (valued) 3 else 2;
            const register_count = count + 1 + @as(usize, if (valued) 1 else 0);
            if (valued) {
                const result_register: t.RegisterRef = @enumFromInt(count + 1);
                const at: t.Origin = .{ .source = @enumFromInt(0), .start = end - 4, .end = end - 3 };
                self.registers[index][count + 1] = .{ .carrier = .{ .@"type" = self.ty(0) }, .view = self.ty(0) };
                self.plan_carriers[index][count + 1] = &self.type_text[0];
                self.instructions[index][1] = .{ .source = at, .result = result_register,
                    .operands = &.{}, .data = .{ .const_i32 = 7 } };
                self.operations[index][1] = .{ .name = "constant", .view = &self.type_text[0],
                    .properties = &seven_properties, .result = result_register, .operands = &.{}, .successors = &.{}, .source = at };
                self.return_refs[index][0] = result_register;
            }
            const returned: []const t.RegisterRef = if (valued) &self.return_refs[index] else &.{};
            self.instructions[index][instruction_count - 1] = .{ .source = last, .result = null,
                .operands = returned, .data = .@"return" };
            self.operations[index][instruction_count - 1] = .{ .name = "func.return", .view = "", .properties = &.{},
                .result = null, .operands = returned, .successors = &.{}, .source = last };
            self.blocks[index] = .{ .parameters = self.entry[index][0 .. count + 1],
                .instructions = self.instructions[index][0..instruction_count] };
            self.plan_blocks[index] = .{ .parameters = self.entry[index][0 .. count + 1],
                .operations = self.operations[index][0..instruction_count] };
            self.functions[index] = .{ .id = case.function_ids[owner], .signature = case.signatures[owner],
                .abi = @enumFromInt(index), .source = @enumFromInt(0), .role = .ordinary,
                .declaration = .{ .start = start, .end = end }, .name = "m",
                .registers = self.registers[index][0..register_count], .blocks = self.blocks[index .. index + 1] };
            self.abis[index] = .{ .kind = .common, .function = @enumFromInt(index), .signature = case.signatures[owner],
                .parameters = self.ordinary_refs[index][0..count], .argument_types = self.argument_types[index][0..count],
                .receiver = self.receiver_refs[index], .construction = null, .receiver_frame = null,
                .lexical_environment = null, .physical_parameters = self.physical[index][0 .. count + 1],
                .result = if (valued) self.ty(case.results[owner]) else null,
                .result_carrier = if (valued) .{ .@"type" = self.ty(case.results[owner]) } else null,
                .source_plan = .{ .carriers = self.plan_carriers[index][0..register_count],
                    .blocks = self.plan_blocks[index .. index + 1] } };
            self.scope_functions[index] = .{ .function_id = case.function_ids[owner], .signature_hash = case.signatures[owner],
                .kind = .method, .decl_key = .{ .kind = .method, .name = "m", .path = declaration_paths[owner], .source_path = source_path },
                .parameter_types = self.function_parameter_ids[index][0 .. count + 1], .return_type = ids[case.results[owner]],
                .construction = null, .lexical_parent = null, .lexical_environment = null,
                .activation_environment = null, .captures = &.{}, .access = .public };
            self.contracts[index] = .{ .function_id = case.function_ids[owner], .signature_hash = case.signatures[owner],
                .upper = upper, .callables = .{ .parameters = &.{}, .returns = null, .slot_writes = .{} },
                .return_origins = null, .digest = case.contract_digests[owner] };
            self.dependencies[index] = .{ .function_id = case.function_ids[owner], .callees = &.{}, .hosts = &.{} };
            self.closures[index] = .{ .function = @enumFromInt(index), .parent = null,
                .lexical_environment = null, .activation_environment = null, .captures = &.{} };
            self.scopes[index] = .{ .owner = @enumFromInt(index), .path = &.{} };
            self.controls[index] = .{ .function = @enumFromInt(index), .handlers = &.{} };
            self.scope_methods[owner][0] = .{ .access = .public, .name = "m",
                .parameters = self.scope_parameter_labels[owner][0..count], .return_type = labels[case.results[owner]] };
        }
        for (case.construction_order, 0..) |owner, index| {
            const start: u32 = @intCast(owner * 40);
            const origin: t.Origin = .{ .source = @enumFromInt(0), .start = start, .end = start + 30 };
            self.constructions[index] = .{ .id = case.construction_ids[owner], .owner = self.ty(owner + 4),
                .function = null, .kind = .@"implicit-base", .origin = origin, .parameters = &.{},
                .signature = .{ .parameters = &.{}, .return_type = self.ty(owner + 4) },
                .source_signature = .{ .id = source_signatures[owner], .origin = origin },
                .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public };
            self.scope_constructions[index] = .{ .id = case.construction_ids[owner], .owner = ids[owner + 4],
                .base = null, .kind = .@"implicit-base", .function_id = null };
        }
        var concrete_count: usize = 0;
        for (case.type_order, 0..) |logical, index| {
            const nominal = logical == 4 or logical == 5;
            const kind: @FieldType(tables.CommonType, "kind") = switch (logical) {
                0, 1 => .scalar, 2 => .@"undefined", 3 => .@"void", 4, 5 => .reference, 6 => .@"union", else => unreachable,
            };
            self.types[index] = .{ .id = ids[logical], .kind = kind, .name = names[logical],
                .native_code = if (logical == 0) 1 else if (logical == 1) 2 else 0,
                .base = null, .element = null, .members = if (logical == 6) &self.union_members else &.{},
                .methods = if (nominal) &self.method_refs[logical - 4] else null,
                .nominal_key = if (nominal) .{ .category = .reference, .declaration_path = nominal_paths[logical - 4], .source = @enumFromInt(0) } else null,
                .runtime_key = if (nominal) runtime_keys[logical - 4] else null };
            self.scope_types[index] = .{ .id = ids[logical], .label = labels[logical], .shape = undefined };
            if (nominal) self.scope_types[index].shape = .{ .nominal = .{ .kind = .reference, .label = labels[logical],
                .base = null, .construction = .{ .access = .public, .parameters = &.{}, .return_type = labels[logical], .argument_signature = null },
                .fields = &.{}, .methods = &self.scope_methods[logical - 4] } }
            else if (logical == 6) self.scope_types[index].shape = .{ .union_type = .{ .kind = .@"union", .label = labels[6], .members = &union_labels } }
            else self.scope_types[index].shape = .{ .primitive = .{ .kind = if (logical < 2) .scalar else if (logical == 2) .@"undefined" else .@"void", .label = labels[logical] } };
            if (logical == 6) continue;
            self.concrete[concrete_count] = .{ .@"type" = @enumFromInt(index),
                .carrier = .{ .layout = .{ .byte_size = if (nominal) 8 else if (logical == 0) 4 else if (logical == 1) 1 else 0,
                    .alignment = if (nominal) 8 else if (logical == 0) 4 else 1,
                    .reference_count = if (nominal) 1 else 0 }, .field_offsets = &.{} },
                .body = if (nominal) .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } else null };
            concrete_count += 1;
        }
        var required = [_]bool{false} ** 7;
        required[4] = true; required[5] = true;
        for (0..2) |owner| {
            required[case.results[owner]] = true;
            for (case.parameters[owner][0..case.counts[owner]]) |logical| {
                required[logical] = true;
                if (logical == 6) { required[0] = true; required[2] = true; }
            }
        }
        var declaration_count: usize = 0;
        for (case.type_order) |logical| if (required[logical]) {
            self.declaration_types[declaration_count] = ids[logical]; declaration_count += 1;
        };
        self.scope = .{ .profile = .@"common-program-fixed-v4", .declaration_types = self.declaration_types[0..declaration_count],
            .constructions = &self.scope_constructions, .storage = .{ .fields = &.{}, .results = &.{} }, .root_file = source_path,
            .modules = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} }, .types = &self.scope_types,
            .functions = &self.scope_functions, .globals = &.{}, .environments = &.{}, .host_context = null, .host_imports = &.{} };
        self.proof_methods[0] = .{ .actual = @enumFromInt(function_refs[0]), .target = @enumFromInt(function_refs[1]) };
        self.proofs[0] = .{ .source_type = self.ty(4), .target_type = self.ty(5),
            .origin = .{ .source = @enumFromInt(0), .start = 80, .end = 90 }, .fields = &.{}, .methods = &self.proof_methods };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = model.format.version,
            .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout,
                .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = model.format.capability },
            .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = 128, .root_source = @enumFromInt(0),
            .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 128 }}, .mode = .{ .common = .{
                .types = &self.types, .members = .{ .fields = &.{}, .methods = &self.methods, .constructions = &self.constructions },
                .domains = &.{}, .storage = .{ .bindings = self.bindings[0..binding_count], .concrete = self.concrete[0..concrete_count],
                    .arrays = &.{}, .environments = &.{}, .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } },
                .views = .{ .compatibility = &self.proofs, .dispatch = &.{}, .entries = &.{} }, .abis = &self.abis,
                .modules = .{ .modules = &.{}, .globals = &.{}, .hosts = &.{}, .initialization = &.{}, .roots = .{ .roots = &.{}, .required_roots = &.{} } },
                .authority = .{ .exports = .{}, .entries = .{}, .resources = .{}, .published = .{}, .fixed_publication = .{
                    .stable_scope = self.scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 4 },
                        .mode = .fixed, .scope = self.scope, .scope_digest = case.scope_digest,
                        .expected_digest = case.publication_digest, .contracts = &self.contracts },
                    .dependencies = &self.dependencies, .request = .{ .targets = &.{} } } },
                .closures = .{ .functions = &self.closures, .environments = &.{}, .calls = &.{} },
                .exceptions = .{ .functions = &self.controls, .bindings = self.cells[0..binding_count], .scopes = &self.scopes },
            } } }, .functions = &self.functions };
    }
};

test "literal method compatibility equal" {
    var fixture: Fixture = undefined;
    fixture.init(cases[0]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility fewer" {
    var fixture: Fixture = undefined;
    fixture.init(cases[1]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility extra_required" {
    var fixture: Fixture = undefined;
    fixture.init(cases[2]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility extra_required_undefined_union" {
    var fixture: Fixture = undefined;
    fixture.init(cases[3]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility parameter_direction" {
    var fixture: Fixture = undefined;
    fixture.init(cases[4]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility return_direction" {
    var fixture: Fixture = undefined;
    fixture.init(cases[5]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}

test "literal method compatibility void_view_discards_result" {
    var fixture: Fixture = undefined;
    fixture.init(cases[6]);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try refs.check(&c);
    try layout.check(&c);
    try ssa.check(&c);
    try identity.check(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining < model.format.max_work and c.remaining > 0);
}
