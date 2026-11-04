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
        .nominal_ids = .{ h("e55a5c685894491249228a15826fbb58915bed23d8752c56d7581014099442c4"), h("ac0638d79b64825b09fdb36e90ffa8de05c258443fb926750ebc6dbedaf91377") },
        .function_ids = .{ h("32910129571306d1fa5b35022ab48365c1fa1bc0430b5e08b42f0bb82de92ab1"), h("aa3519f962ba6c37c210e1b7560794386991e41b2911aab1c8f1c8891574b3e4") },
        .signatures = .{ h("8f6fef4ada43b2444846e77abe1fce1601d851fea9c49dbe827496b2868570d4"), h("52b186d9c6afd90098f44c198000e47e89b5c4b174673c0b1821b258a612b5a9") },
        .construction_ids = .{ h("9b4e2d2bfb76e2858551ca0da905e4a50cba6abff042101bb57d711d1d45f3dd"), h("2ec5e42f30242f7ab7e37deb10eba45801c843b1740b41973022a563de811404") },
        .contract_digests = .{ h("ae518ae82ae912c15ace09591f1dec3bbc2d2ef3d5ad706dc94cdb9bb0923f25"), h("7ce2910618b52e7a9151cfd96ec945fb80b9aefca4ca93bc596e91c0d272e89c") },
        .scope_digest = h("4630f802d2a317069c9d83dea69e8e3e6d34fa93d337d3c4a3080bda6925ab94"),
        .publication_digest = h("1b0fb31432521760d57dbb614a9aa0fdb3897fcd2234f48141b2fc21316026ee"),
        .type_order = .{ 6, 2, 1, 0, 5, 3, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "fewer", .accept = true,
        .counts = .{ 1, 2 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("e55a5c685894491249228a15826fbb58915bed23d8752c56d7581014099442c4"), h("96ec0b8011b6a5ddfbd71c3bac7b3297a93477aa9933001f83e8a1c2cd8d914e") },
        .function_ids = .{ h("32910129571306d1fa5b35022ab48365c1fa1bc0430b5e08b42f0bb82de92ab1"), h("738377ce3199f15a07d2ce92f4709c2feade5f6a01e021ba90bf5141ec1e2b04") },
        .signatures = .{ h("8f6fef4ada43b2444846e77abe1fce1601d851fea9c49dbe827496b2868570d4"), h("5f1e78631f2559015fc1a2de097b578fa5265f27cfd08228507697e341f59ab3") },
        .construction_ids = .{ h("9b4e2d2bfb76e2858551ca0da905e4a50cba6abff042101bb57d711d1d45f3dd"), h("5825517f7718b29c21a668665723901f0da0cf871bb2c9f67dfc4562ac5ddb83") },
        .contract_digests = .{ h("ae518ae82ae912c15ace09591f1dec3bbc2d2ef3d5ad706dc94cdb9bb0923f25"), h("3831ee044fccb6f816042983234956f0bb8a912bf6743ea160101ea3ca054619") },
        .scope_digest = h("a5a3144d7318c0d36667e10180a88e5fe08d8099d4db27405221b5986c3c9217"),
        .publication_digest = h("39fb2fb78273d57ea6914666807d6310da80caf7a246176bb35ad94dd0c37d22"),
        .type_order = .{ 6, 2, 1, 5, 0, 3, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "extra_required", .accept = false,
        .counts = .{ 2, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("d9f6af9f6a0aef91f73583013279b5a552c162d11947d2be9cf9429cbdd3df46"), h("ac0638d79b64825b09fdb36e90ffa8de05c258443fb926750ebc6dbedaf91377") },
        .function_ids = .{ h("3e0bffacbb2195c1eaa59d080c1a530c69e0ceb2cf42af3a19b48a48a04c82de"), h("aa3519f962ba6c37c210e1b7560794386991e41b2911aab1c8f1c8891574b3e4") },
        .signatures = .{ h("54c3c23e744481c42b1a49a8929c0423189788947340b361b9762ca53c32b700"), h("52b186d9c6afd90098f44c198000e47e89b5c4b174673c0b1821b258a612b5a9") },
        .construction_ids = .{ h("dd76c1fdbea1f0f88e4a9d93e1dc6d90be2b9eda155ad6e5eb023418ce07abd3"), h("2ec5e42f30242f7ab7e37deb10eba45801c843b1740b41973022a563de811404") },
        .contract_digests = .{ h("566edc6effd66e7270b6920ed79a5ceedaa2c4b5b24ecfb95c30d4b6b9531694"), h("7ce2910618b52e7a9151cfd96ec945fb80b9aefca4ca93bc596e91c0d272e89c") },
        .scope_digest = h("ebbb1cdb4d7e00b9392cb31ae6ccbbe96a5bbae2c98ee984ba6811e9187c6764"),
        .publication_digest = h("1db01cb49c8fce28f6ed90fea327a45e5736702f0a9269da297eee3f34e2d46b"),
        .type_order = .{ 6, 2, 1, 0, 5, 3, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
    .{ .name = "extra_required_undefined_union", .accept = false,
        .counts = .{ 2, 1 }, .parameters = .{ .{ 0, 6 }, .{ 0, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("e15483cb4fe8dc28c33b6ef0aaace8fef6c7e7e961cf04034ea9a3abe81e0266"), h("ac0638d79b64825b09fdb36e90ffa8de05c258443fb926750ebc6dbedaf91377") },
        .function_ids = .{ h("266f23409b2a29f918f8371862a64bf6deb6ec6d3cfa61c83039e4d851a00858"), h("aa3519f962ba6c37c210e1b7560794386991e41b2911aab1c8f1c8891574b3e4") },
        .signatures = .{ h("636bff2e0a818d5208a7681dee5a9c5b40619e6d074f9353d0e0d198384666ec"), h("52b186d9c6afd90098f44c198000e47e89b5c4b174673c0b1821b258a612b5a9") },
        .construction_ids = .{ h("28c40f11dc999f492d93988f4a03da580bdd6940697dffc6356f8f81db6101cb"), h("2ec5e42f30242f7ab7e37deb10eba45801c843b1740b41973022a563de811404") },
        .contract_digests = .{ h("bdfb46d9c62526be3542fb12927d8ff0f95abaf357e1b3cd76159990ea025d4b"), h("7ce2910618b52e7a9151cfd96ec945fb80b9aefca4ca93bc596e91c0d272e89c") },
        .scope_digest = h("c5d3519dac93d60fef9e54999814e960d0289556eca3d208171fe0a418158ec4"),
        .publication_digest = h("686fa5b12eac96010177c1c45a14854fd6b42945713e836dbb5d295d1ae0a9c6"),
        .type_order = .{ 6, 2, 1, 0, 5, 3, 4 }, .function_order = .{ 0, 1 }, .construction_order = .{ 0, 1 } },
    .{ .name = "parameter_direction", .accept = false,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 1, 0 } }, .results = .{ 3, 3 },
        .nominal_ids = .{ h("e55a5c685894491249228a15826fbb58915bed23d8752c56d7581014099442c4"), h("44d765307e169908b47db96851804f018864604526e080a0c16cdc6979d64839") },
        .function_ids = .{ h("32910129571306d1fa5b35022ab48365c1fa1bc0430b5e08b42f0bb82de92ab1"), h("25dbeeb3331dca65c9ca42a940a1dcad7341614c0cf814af281e60ef805aacc9") },
        .signatures = .{ h("8f6fef4ada43b2444846e77abe1fce1601d851fea9c49dbe827496b2868570d4"), h("fc7335017fba067cb0b2873617f25622c28da5725c93b620948ffa7f091e0207") },
        .construction_ids = .{ h("9b4e2d2bfb76e2858551ca0da905e4a50cba6abff042101bb57d711d1d45f3dd"), h("87f0cbfb2823ddfc7c5700555eccd880025a2851c50ac8b9a97110367b11831c") },
        .contract_digests = .{ h("ae518ae82ae912c15ace09591f1dec3bbc2d2ef3d5ad706dc94cdb9bb0923f25"), h("b5fcc99433a8f83f94d20efa3e470b031ee47a99a69971058190c86fc8c46e69") },
        .scope_digest = h("7d6877ce3f85972e28f038495cf039c823f8152d9f48490e7a889b5baab28627"),
        .publication_digest = h("d503e8970bd02bee49b6674d641f91a68b66fc0372ff0e68db2e0a1cdfbaf3d4"),
        .type_order = .{ 6, 5, 2, 1, 0, 3, 4 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .name = "return_direction", .accept = false,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 3, 0 },
        .nominal_ids = .{ h("e55a5c685894491249228a15826fbb58915bed23d8752c56d7581014099442c4"), h("8b830c19189fc3610970cf18384084754e038b45b5050e77b67482a1b67dc0f8") },
        .function_ids = .{ h("32910129571306d1fa5b35022ab48365c1fa1bc0430b5e08b42f0bb82de92ab1"), h("143095bcb785c7ce07538be32271048a45162d4520ff8d68d6424a5e9ff0013f") },
        .signatures = .{ h("8f6fef4ada43b2444846e77abe1fce1601d851fea9c49dbe827496b2868570d4"), h("305b67d444fb58a7e784477a676e7321db5ed371e7d919acdfabb7923f4405c1") },
        .construction_ids = .{ h("9b4e2d2bfb76e2858551ca0da905e4a50cba6abff042101bb57d711d1d45f3dd"), h("1f3bbf03fba889797147a5665e441961de404a5d36ad46728edfc52ae1d3dec6") },
        .contract_digests = .{ h("ae518ae82ae912c15ace09591f1dec3bbc2d2ef3d5ad706dc94cdb9bb0923f25"), h("97045703b6c5786d16a3d4b0f73a5cf74027ddbd4a8c864c04a9604d7f0f8da2") },
        .scope_digest = h("a0da5ee89740d3388980b945245f1bb9271ecbcad5a9f2d0a4ee19d5ad0f356a"),
        .publication_digest = h("72437dbdc8d8d85d2ec09434c4700c4a7334dcbcbceb48515e935a76aecff2b5"),
        .type_order = .{ 6, 2, 1, 5, 0, 3, 4 }, .function_order = .{ 1, 0 }, .construction_order = .{ 1, 0 } },
    .{ .name = "void_view_discards_result", .accept = true,
        .counts = .{ 1, 1 }, .parameters = .{ .{ 0, 0 }, .{ 0, 0 } }, .results = .{ 0, 3 },
        .nominal_ids = .{ h("6f630e2a563ac996583563f10096f04040219b1821f8703380d4be780d5c92ce"), h("ac0638d79b64825b09fdb36e90ffa8de05c258443fb926750ebc6dbedaf91377") },
        .function_ids = .{ h("340adce8d7950a88cbd638ef102de8ce0c5dca3b8d5cf299f56b4fc5c27c9fdf"), h("aa3519f962ba6c37c210e1b7560794386991e41b2911aab1c8f1c8891574b3e4") },
        .signatures = .{ h("6649675d743a4ee8a0adf54a5236dc51d090220b1c1df3f9274c0790b687ceed"), h("52b186d9c6afd90098f44c198000e47e89b5c4b174673c0b1821b258a612b5a9") },
        .construction_ids = .{ h("b6bb5abc57ecf87f4dc237f7e14ffa7660e0dcc755593a1875a5f60f088b9cb5"), h("2ec5e42f30242f7ab7e37deb10eba45801c843b1740b41973022a563de811404") },
        .contract_digests = .{ h("3d5d5c0f86fb286d041cb7f4a91fdd8710760422cc239d9aaeb88455d316f776"), h("7ce2910618b52e7a9151cfd96ec945fb80b9aefca4ca93bc596e91c0d272e89c") },
        .scope_digest = h("99fdd4706594e42d4999cb58b3956ba3daa6255a88a425b580db39a3e5498861"),
        .publication_digest = h("1c891792a488e1a29b90e02cf0da4348ab926559a744b0c8196fc2f7fa180f39"),
        .type_order = .{ 6, 2, 4, 1, 0, 5, 3 }, .function_order = .{ 0, 1 }, .construction_order = .{ 1, 0 } },
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
                .method_minimum_argument_count = @as(u16, @intCast(count)),
                .receiver = self.receiver_refs[index], .construction = null, .receiver_frame = null,
                .lexical_environment = null, .physical_parameters = self.physical[index][0 .. count + 1],
                .result = if (valued) self.ty(case.results[owner]) else null,
                .result_carrier = if (valued) .{ .@"type" = self.ty(case.results[owner]) } else null,
                .source_plan = .{ .carriers = self.plan_carriers[index][0..register_count],
                    .blocks = self.plan_blocks[index .. index + 1] } };
            self.scope_functions[index] = .{ .function_id = case.function_ids[owner], .signature_hash = case.signatures[owner],
                .kind = .method, .decl_key = .{ .kind = .method, .name = "m", .path = declaration_paths[owner], .source_path = source_path },
                .parameter_types = self.function_parameter_ids[index][0 .. count + 1], .method_minimum_argument_count = @as(u16, @intCast(count)), .return_type = ids[case.results[owner]],
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
                .parameters = self.scope_parameter_labels[owner][0..count], .return_type = labels[case.results[owner]], .minimum_argument_count = @intCast(count) };
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
        self.scope = .{ .profile = .@"common-program-fixed-v5", .declaration_types = self.declaration_types[0..declaration_count],
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
                    .stable_scope = self.scope, .publication = .{ .format = .{ .family = .@"tsfg.program-publication-candidate", .version = 5 },
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
