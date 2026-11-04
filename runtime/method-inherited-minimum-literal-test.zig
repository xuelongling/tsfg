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
const source_path = "/literal-inherited-method-minimum.ts";
const source_hash = h("0c577fe37b71f724e7ff2e93a1ce402a45512c1583f646a66a7f30f44cb4b849");
const payload_hash = h("252ba12354bb4c4438064fb1f8ff57f49403e3a224ae7012201e0ad455f4ec5d");
const input_identity = h("3d0f65f94be68714fbb32edb2fd0c117484fd6b417fef519e593056f2dec2da0");
// Logical type positions: i32, undefined, void, union, BaseRole, ViewRole, DerivedRole.
const labels = [7][]const u8{ "{\"kind\":\"scalar\",\"name\":\"i32\"}", "{\"kind\":\"undefined\",\"name\":\"undefined\"}", "{\"kind\":\"void\",\"name\":\"void\"}", "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"BaseRole\"],\"sourcePath\":\"/literal-inherited-method-minimum.ts\"}}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"ViewRole\"],\"sourcePath\":\"/literal-inherited-method-minimum.ts\"}}", "{\"kind\":\"reference\",\"nominal\":{\"category\":\"reference\",\"declarationPath\":[\"DerivedRole\"],\"sourcePath\":\"/literal-inherited-method-minimum.ts\"}}" };
const primitives = [3]t.Hash{ h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727"), h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b"), h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190") };
const union_id = h("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
const runtime_keys = [3]t.Hash{ h("e0c1c19a7699e2642e5955764a7316c03b88bb49d79230f6f4ea3591bb7e27cc"), h("85e3a168a0f4d4975c642a9de186e1fc8f9dfa6842535a82851cd6bf8e09dfda"), h("f2d61506478d49ee11d8e8d8243f49baa3b2e3a600ffaf544130e91e0374f390") };
const constructor_source_ids = [3]t.Hash{ h("bd0f292953e4f49e89353507a117ac1d36dcc90cb4abf6ad312852eaaf0e6452"), h("5a0307cb6546b66012f63c302af712d26f03bba6b96a8551c8138f829ee484ca"), h("10e848c257143b942cbdef058af85563e0b0132921cda0ffe8fb95196253f88f") };
const receiver_ids = [3][]const u8{ "this@sha256:d474395e37bad6eb74481fc2136c73752cda47352f9d2f2e7b9bcd7922e6bab3", "this@sha256:969695b931fa299981ca06937ba10737e8689db0a5ae1d1c8c673f7896d7e984", "this@sha256:1395d6bed0c9a170838594bf16f7ced8e57cb5ee460b7c2be75950faf7542740" };
const owner_names = [3][]const u8{ "BaseRole", "ViewRole", "DerivedRole" };
const argument_names = [3][2][]const u8{ .{ "argument:0:0", "argument:0:1" }, .{ "argument:1:0", "argument:1:1" }, .{ "argument:2:0", "argument:2:1" } };
const owner_paths = [3][]const []const u8{ &.{"BaseRole"}, &.{"ViewRole"}, &.{"DerivedRole"} };
const method_paths = [3][]const []const u8{ &.{"type", "BaseRole"}, &.{"type", "ViewRole"}, &.{"type", "DerivedRole"} };
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
    minimums: [3]u16, counts: [3]usize, parameters: [3][2]usize, results: [3]usize,
    nominal_ids: [3]t.Hash, signatures: [3]t.Hash, function_ids: [3]t.Hash,
    construction_ids: [3]t.Hash, contract_digests: [3]t.Hash, scope_digest: t.Hash, publication_digest: t.Hash,
    type_order: [7]usize, function_order: [3]usize, construction_order: [3]usize,
};
const cases = [_]Case{
    .{ .minimums = .{ 0, 0, 0 }, .counts = .{ 1, 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2, 2 },
        .nominal_ids = .{ h("9fd957b09ec65f83dc8c16b2f414e9353ea3221f1e05953534fb2fda77c00d29"), h("0ca30880b3247669e41a9226de47986e3a9db1cd47d83538ebe8a6220d41a00f"), h("6eac773155b2b9953deb1840c1942836a1b4d19e5a7eb0e3c10c27ffc3676b5d") }, .signatures = .{ h("f02ec593d19a3943c82d53f69ee017a247e68c7dd738b34e79fcf5b935cf2c7c"), h("a60960b468b311d08f8f985666f1ac83eba57fe75810c0c4fa63e4a03d9cde9a"), h("0714f234ab78e2b4b96240fcb99e374cdf0ef803c028a87c182a8912d0da9b5b") }, .function_ids = .{ h("e1d8fff2e548fc4fe96dd53d924cdd0856938a6822875ec144f5000ff9e22872"), h("9a2d49ba4a36372c5139255ceb8c350a862e94d27404cf339acf0dfe887f50f8"), h("a4ec23df98bdb42d8989dbc8e4870b690348460ab1500f8cf3b01f125729575e") },
        .construction_ids = .{ h("f54db164df25e9f96e69d31556789e999435096a96fb83bdd959cf724e88a5fa"), h("94969c5dd70157bc57b48fd2073d474460b666003ce7b139c4426ee1742e64a8"), h("a5f21cfdace389310356ef4dfb444afbb894c4836b490247f5b22fb2d91c6084") }, .contract_digests = .{ h("f2d5f3d66f927de249ec7c9b250e3457ab53011c0bb9745b21bd10ca31899c0b"), h("3a4540dc599e22cdc6aa7435ca3cc153b2273c5eaea9bdc34a7c099c6aa1eff2"), h("0483a56c0dbfedcd0df55d7bdbcdd48f6262942ef711ced94fdeb3220f01ffa1") },
        .scope_digest = h("6528d302f2c5232b689698e7c3820fff90ecb0f06f89433d2a42a3fe1a7d85c9"), .publication_digest = h("e4d02873f944a6f4de1b33c3f8bde14a79e5c69056d351208d743fbdd7d50bda"),
        .type_order = .{ 5, 3, 1, 6, 4, 0, 2 }, .function_order = .{ 1, 2, 0 }, .construction_order = .{ 1, 2, 0 } },
    .{ .minimums = .{ 0, 0, 1 }, .counts = .{ 1, 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2, 2 },
        .nominal_ids = .{ h("9fd957b09ec65f83dc8c16b2f414e9353ea3221f1e05953534fb2fda77c00d29"), h("0ca30880b3247669e41a9226de47986e3a9db1cd47d83538ebe8a6220d41a00f"), h("28b5d120ed00792b47feb9ece33ae1aefc0ac10b4c62aaf6bc9d6cd319caaaf3") }, .signatures = .{ h("f02ec593d19a3943c82d53f69ee017a247e68c7dd738b34e79fcf5b935cf2c7c"), h("a60960b468b311d08f8f985666f1ac83eba57fe75810c0c4fa63e4a03d9cde9a"), h("4966ec429551c4082e16996be75d0dcf46090f5826bcfaa3ead0f3628813dc5d") }, .function_ids = .{ h("e1d8fff2e548fc4fe96dd53d924cdd0856938a6822875ec144f5000ff9e22872"), h("9a2d49ba4a36372c5139255ceb8c350a862e94d27404cf339acf0dfe887f50f8"), h("f6d4e0c13434b856d2dbe773693851c8555ae75dc0ea8bd26c0e068036e6607d") },
        .construction_ids = .{ h("f54db164df25e9f96e69d31556789e999435096a96fb83bdd959cf724e88a5fa"), h("94969c5dd70157bc57b48fd2073d474460b666003ce7b139c4426ee1742e64a8"), h("66578c3d83ae695956aef82de948dbc88b0e81ff175fb3139771f27f6ce0a8ce") }, .contract_digests = .{ h("f2d5f3d66f927de249ec7c9b250e3457ab53011c0bb9745b21bd10ca31899c0b"), h("0483a56c0dbfedcd0df55d7bdbcdd48f6262942ef711ced94fdeb3220f01ffa1"), h("0686b290b9c1b4c78be498cbb6bee12faadd2ec114ea3a5259ef16e1cb74fd0e") },
        .scope_digest = h("70e1d048785077f8b467b12abc545d5cc08f4cb4480b03e8a3b4f15184ac99a1"), .publication_digest = h("b6c56df48c475635cff0a6d1c156f764965ed9d0341e5306909c31325233133f"),
        .type_order = .{ 5, 6, 3, 1, 4, 0, 2 }, .function_order = .{ 1, 0, 2 }, .construction_order = .{ 2, 1, 0 } },
    .{ .minimums = .{ 0, 0, 0 }, .counts = .{ 1, 1, 2 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 2, 2, 2 },
        .nominal_ids = .{ h("9fd957b09ec65f83dc8c16b2f414e9353ea3221f1e05953534fb2fda77c00d29"), h("0ca30880b3247669e41a9226de47986e3a9db1cd47d83538ebe8a6220d41a00f"), h("aa8f9bad98536a85ea2ad07fd593217ab8bc2c96f650427983183dcbafda3400") }, .signatures = .{ h("f02ec593d19a3943c82d53f69ee017a247e68c7dd738b34e79fcf5b935cf2c7c"), h("a60960b468b311d08f8f985666f1ac83eba57fe75810c0c4fa63e4a03d9cde9a"), h("c60ae6ff0fea0093aeab0cac8d420fd0afe27f9679f1055dde34eb29899f252b") }, .function_ids = .{ h("e1d8fff2e548fc4fe96dd53d924cdd0856938a6822875ec144f5000ff9e22872"), h("9a2d49ba4a36372c5139255ceb8c350a862e94d27404cf339acf0dfe887f50f8"), h("2cc406f77e0d2deda8ed8ba6136de590d087b33705e350edd9b0390c28b0c8c5") },
        .construction_ids = .{ h("f54db164df25e9f96e69d31556789e999435096a96fb83bdd959cf724e88a5fa"), h("94969c5dd70157bc57b48fd2073d474460b666003ce7b139c4426ee1742e64a8"), h("5015fb3f4af5634683229557245eeb260c0640ad12a157188001801701f8f59d") }, .contract_digests = .{ h("ee9962a9175b1b6fe3d6bda634cfce725388ea04ef07c8e7e631543ed495ec39"), h("f2d5f3d66f927de249ec7c9b250e3457ab53011c0bb9745b21bd10ca31899c0b"), h("0483a56c0dbfedcd0df55d7bdbcdd48f6262942ef711ced94fdeb3220f01ffa1") },
        .scope_digest = h("05d4d73d019944c531b3ca2c05acb2fd21d2eaf5068e417b24cf32feb5fe14be"), .publication_digest = h("c991cfc67714473fcec51eae2374b52d2e53c9b71578c6b7c38d974c28dd04f5"),
        .type_order = .{ 5, 3, 1, 4, 0, 6, 2 }, .function_order = .{ 2, 1, 0 }, .construction_order = .{ 2, 1, 0 } },
    .{ .minimums = .{ 0, 0, 0 }, .counts = .{ 1, 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 0, 3 } }, .results = .{ 2, 2, 2 },
        .nominal_ids = .{ h("9fd957b09ec65f83dc8c16b2f414e9353ea3221f1e05953534fb2fda77c00d29"), h("0ca30880b3247669e41a9226de47986e3a9db1cd47d83538ebe8a6220d41a00f"), h("23a052dbc5b56d34f79aa0529ddf03024a1b73943a66293c308902162575d0bd") }, .signatures = .{ h("f02ec593d19a3943c82d53f69ee017a247e68c7dd738b34e79fcf5b935cf2c7c"), h("a60960b468b311d08f8f985666f1ac83eba57fe75810c0c4fa63e4a03d9cde9a"), h("22526e18b25fe120f347601d43e59e0ef598c700a2a077ec2aa8cddcbb4b206a") }, .function_ids = .{ h("e1d8fff2e548fc4fe96dd53d924cdd0856938a6822875ec144f5000ff9e22872"), h("9a2d49ba4a36372c5139255ceb8c350a862e94d27404cf339acf0dfe887f50f8"), h("629c694b1bde0c926ad5f4eee4fbda78fd0fdb7165f4cbb904f811ebdfea8027") },
        .construction_ids = .{ h("f54db164df25e9f96e69d31556789e999435096a96fb83bdd959cf724e88a5fa"), h("94969c5dd70157bc57b48fd2073d474460b666003ce7b139c4426ee1742e64a8"), h("e5180b33a2580a35542a632c19f4b5e960eb9791db2c019006928c66ab9a8d93") }, .contract_digests = .{ h("3acd69b0118f9e98ef514937d3953d4583001cf53ef6bafff009031d3b786860"), h("f2d5f3d66f927de249ec7c9b250e3457ab53011c0bb9745b21bd10ca31899c0b"), h("0483a56c0dbfedcd0df55d7bdbcdd48f6262942ef711ced94fdeb3220f01ffa1") },
        .scope_digest = h("d26583a1ca3321a8eabbf9da211d8b22550741665c1069636ae30e76a885dbfb"), .publication_digest = h("0c9d9081c8f250910d6b47ed14a81a263d7502c2ebaf82ef7fa3a9df4b6dc292"),
        .type_order = .{ 5, 6, 3, 1, 4, 0, 2 }, .function_order = .{ 2, 1, 0 }, .construction_order = .{ 1, 2, 0 } },
    .{ .minimums = .{ 0, 0, 0 }, .counts = .{ 1, 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 0, 0, 0 },
        .nominal_ids = .{ h("82785c05921ee45cc768b40dd1425e1078650ecb37f573508ad2e81efce8daf8"), h("39928077f3ea245601fcb79d9a16946975c1f9af87cdd6ad6c0da809aef860fa"), h("83adaeafd71efbc49129d941b73e1d73054173bb550def74de6d8365888e5a64") }, .signatures = .{ h("61e7dad074d33e73367fb3bfff57158ba35e707a9633487bb3c8bb4136cad575"), h("b9cdf849b28176aa63af5589c4b70d6b0530023c6ddc7f362c9e17153f25dc35"), h("0bc50ca99267b6597d1f155dc605e61a6b5ad195bae725a34049b3eee064f877") }, .function_ids = .{ h("d1310313364000de1a8dac5025817cdd615ab3ef92ab18f9923d1691acd5e78b"), h("feb3a1922271e7dcaa412aa82d8ab1f8e1fedbf8fdbfd5dd1e57527430123f19"), h("82d997a1458acdf0af30577d8e6800d3885ad89a9f6008bf87e8309f08273010") },
        .construction_ids = .{ h("413451dbfb54615f54f15dc5570445692f7f7d7d5e7cdf61ff6c2e462739b3be"), h("70910cca9495b4ff16b60d68804ac9f947870ada512f117477a0b76e851b8732"), h("7d479b4f0708b14607f75df6766d62800deeaa9ba0af086bca8f249a109fbe75") }, .contract_digests = .{ h("d4c194a12823b1e1d71681d6ab1b34fd2dc3712981b9d9ed6f435acccad6c95d"), h("8d10f2a1ada0287110d1a487aeff5298eb18916401c49e00e39fadbdcf379479"), h("80f6ce50cde6fc3c5c4109044023ee9d8f890585b82c95ae468774313eab9754") },
        .scope_digest = h("b04dff96f47a062915e6a2580f8360309a10343c31f3f34b69fdc174594f2f08"), .publication_digest = h("e63b65bb157cff8039a6077c05bec5e1e7541659ac81a2cb18c9f068fc3c6691"),
        .type_order = .{ 3, 5, 1, 4, 6, 0, 2 }, .function_order = .{ 2, 0, 1 }, .construction_order = .{ 0, 1, 2 } },
    .{ .minimums = .{ 0, 0, 0 }, .counts = .{ 1, 1, 1 }, .parameters = .{ .{ 3, 3 }, .{ 3, 3 }, .{ 3, 3 } }, .results = .{ 0, 0, 2 },
        .nominal_ids = .{ h("82785c05921ee45cc768b40dd1425e1078650ecb37f573508ad2e81efce8daf8"), h("39928077f3ea245601fcb79d9a16946975c1f9af87cdd6ad6c0da809aef860fa"), h("7f5210431b363aebd1d22cdfad8327991bc209e74fef6c9c2cb7a8ef1980e0ab") }, .signatures = .{ h("61e7dad074d33e73367fb3bfff57158ba35e707a9633487bb3c8bb4136cad575"), h("b9cdf849b28176aa63af5589c4b70d6b0530023c6ddc7f362c9e17153f25dc35"), h("5825d146d2bafd276795b2b350c1f4854a9e6d574ed71385c38f07b696ec5a1b") }, .function_ids = .{ h("d1310313364000de1a8dac5025817cdd615ab3ef92ab18f9923d1691acd5e78b"), h("feb3a1922271e7dcaa412aa82d8ab1f8e1fedbf8fdbfd5dd1e57527430123f19"), h("2519167de208f132aab4439790b7d2b5a413769dca8d2134a44f3a456b21c88d") },
        .construction_ids = .{ h("413451dbfb54615f54f15dc5570445692f7f7d7d5e7cdf61ff6c2e462739b3be"), h("70910cca9495b4ff16b60d68804ac9f947870ada512f117477a0b76e851b8732"), h("452a84fbcb96476a8b1e941f3c46d7fef49b7d3603e1e8c527fd9cd9c3075d3e") }, .contract_digests = .{ h("4bf7e77c2e39b40d8d22edb57a9755c4b6e525dd081e04294e13b839ea93b537"), h("8d10f2a1ada0287110d1a487aeff5298eb18916401c49e00e39fadbdcf379479"), h("80f6ce50cde6fc3c5c4109044023ee9d8f890585b82c95ae468774313eab9754") },
        .scope_digest = h("2dbf26e56f1dfd903a6d0464cbeb0181df9d43b98614a733b9c291207c6fdac0"), .publication_digest = h("dc1d0f31f22daf3f99e68662a4a0c1c44e1807da66a5b26884606c9a1da3e76f"),
        .type_order = .{ 3, 5, 1, 6, 4, 0, 2 }, .function_order = .{ 2, 0, 1 }, .construction_order = .{ 0, 2, 1 } },
};
const Literal = struct {
    program: model.Program,
    types: [7]tables.CommonType,
    type_positions: [7]usize,
    methods: [3]members.CommonMethod,
    constructors: [3]members.CommonConstruction,
    bindings: [7]storage.CommonBinding,
    concrete: [6]Item(storage.CommonStorage, "concrete"),
    functions: [3]model.Function,
    abis: [3]storage.CommonAbi,
    registers: [3][4]model.Register,
    physical: [3][3]t.Carrier,
    incoming: [3][2]t.TypeRef,
    parameters: [3][2]t.BindingRef,
    entries: [3][3]t.RegisterRef,
    instructions: [3][3]ins.Instruction,
    blocks: [3]model.Block,
    plan_operations: [3][3]control.SourcePlanOperation,
    plan_blocks: [3]control.SourcePlanBlock,
    plan_carriers: [3][4][]const u8,
    type_texts: [7][71]u8,
    method_refs: [3][1]t.MethodRef,
    union_refs: [2]t.TypeRef,
    receiver_refs: [3]t.BindingRef,
    parameter_labels: [3][2][]const u8,
    return_refs: [3][1]t.RegisterRef,
    upper_parameters: [3][3]Item(publication.EffectUpper, "parameters"),
    dispatch_arms: [3]Item(@FieldType(tables.Dispatch, "method"), "arms"),
    dispatch_rows: [1]tables.Dispatch,
    shape_methods: [3][1]ShapeMethod,
    fixed_types: [7]Item(publication.StableScope, "types"),
    fixed_functions: [3]Item(publication.StableScope, "functions"),
    fixed_constructors: [3]publication.Construction,
    parameter_ids: [3][3]t.Hash,
    declaration_ids: [7]t.Hash,
    contracts: [3]Item(publication.Publication, "contracts"),
    dependencies: [3]Item(publication.FixedPublication, "dependencies"),
    closures: [3]Item(control.CommonClosures, "functions"),
    scopes: [3]Item(control.CommonControl, "scopes"),
    cells: [7]Item(control.CommonControl, "bindings"),
    function_control: [3]Item(control.CommonControl, "functions"),
    proof_methods: [1]Item(Item(tables.CommonViews, "compatibility"), "methods"),
    proofs: [1]Item(tables.CommonViews, "compatibility"),

    fn typeRef(self: *const Literal, logical: usize) t.TypeRef { return @enumFromInt(self.type_positions[logical]); }

    fn init(self: *Literal, example: Case) void {
        const ids = [7]t.Hash{ primitives[0], primitives[1], primitives[2], union_id, example.nominal_ids[0], example.nominal_ids[1], example.nominal_ids[2] };
        var function_positions: [3]usize = undefined;
        var construction_positions: [3]usize = undefined;
        for (example.construction_order, 0..) |owner, index| construction_positions[owner] = index;
        for (example.function_order, 0..) |owner, index| function_positions[owner] = index;
        for (example.type_order, 0..) |logical, index| self.type_positions[logical] = index;
        self.union_refs = .{self.typeRef(0), self.typeRef(1)};
        for (ids, 0..) |id, logical| {
            @memcpy(self.type_texts[logical][0..7], "sha256:");
            @memcpy(self.type_texts[logical][7..], &std.fmt.bytesToHex(id, .lower));
        }
        var binding_count: usize = 0;
        for (0..3) |owner| {
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
            self.shape_methods[owner][0] = .{ .access = .public, .name = "match", .parameters = self.parameter_labels[owner][0..example.counts[owner]],
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
                .name = "match", .signature = example.signatures[owner], .override = if (owner == 2) example.function_ids[0] else null, .access = .public };
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
                .name = "match", .registers = self.registers[index][0..register_count], .blocks = self.blocks[index .. index + 1] };
            self.abis[index] = .{ .kind = .common, .function = @enumFromInt(index), .signature = example.signatures[owner],
                .parameters = self.parameters[index][0..count], .argument_types = self.incoming[index][0..count], .method_minimum_argument_count = example.minimums[owner], .ordinary_minimum_argument_count = null,
                .receiver = self.receiver_refs[index], .construction = null, .receiver_frame = null, .lexical_environment = null,
                .physical_parameters = self.physical[index][0 .. count + 1], .result = if (valued) self.typeRef(example.results[owner]) else null,
                .result_carrier = if (valued) .{ .@"type" = self.typeRef(example.results[owner]) } else null,
                .source_plan = .{ .carriers = self.plan_carriers[index][0..register_count], .blocks = self.plan_blocks[index .. index + 1] } };
            self.fixed_functions[index] = .{ .function_id = example.function_ids[owner], .signature_hash = example.signatures[owner], .kind = .method,
                .decl_key = .{ .kind = .method, .name = "match", .path = method_paths[owner], .source_path = source_path },
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
                .kind = if (owner == 2) .@"implicit-derived" else .@"implicit-base", .origin = at, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = self.typeRef(owner + 4) },
                .source_signature = .{ .id = constructor_source_ids[owner], .origin = at },
                .implicit_forward = if (owner == 2) .{ .target = @enumFromInt(construction_positions[0]), .origin = at,
                    .base_signature = .{ .parameters = &.{}, .@"return" = self.typeRef(4) }, .parameters = &.{} } else null,
                .initialization_phase = if (owner == 2) .@"after-successful-super" else .@"before-body", .initialization_fields = &.{}, .access = .public };
            self.fixed_constructors[index] = .{ .id = example.construction_ids[owner], .owner = ids[owner + 4], .base = if (owner == 2) ids[4] else null,
                .kind = if (owner == 2) .@"implicit-derived" else .@"implicit-base", .function_id = null };
        }
        var concrete_index: usize = 0;
        var declaration_count: usize = 0;
        const needs_void = std.mem.indexOfScalar(usize, &example.results, 2) != null;
        for (example.type_order, 0..) |logical, index| {
            const nominal = logical >= 4;
            const kind: @FieldType(tables.CommonType, "kind") = switch (logical) { 0 => .scalar, 1 => .@"undefined", 2 => .@"void", 3 => .@"union", else => .reference };
            self.types[index] = .{ .id = ids[logical], .kind = kind,
                .name = if (nominal) owner_names[logical - 4] else if (logical == 0) "i32" else if (logical == 1) "undefined" else if (logical == 2) "void" else "union",
                .native_code = if (logical == 0) 1 else 0, .base = if (logical == 6) self.typeRef(4) else null, .element = null,
                .members = if (logical == 3) &self.union_refs else &.{}, .methods = if (nominal) &self.method_refs[logical - 4] else null,
                .nominal_key = if (nominal) .{ .source = @enumFromInt(0), .declaration_path = owner_paths[logical - 4], .category = .reference } else null,
                .runtime_key = if (nominal) runtime_keys[logical - 4] else null };
            self.fixed_types[index] = .{ .id = ids[logical], .label = labels[logical], .shape = if (nominal)
                .{ .nominal = .{ .kind = .reference, .label = labels[logical], .base = if (logical == 6) labels[4] else null,
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
        self.dispatch_rows[0] = .{ .method = .{ .view = self.typeRef(5), .member = @enumFromInt(function_positions[1]), .arms = &self.dispatch_arms } };
        self.proof_methods[0] = .{ .actual = @enumFromInt(function_positions[0]), .target = @enumFromInt(function_positions[1]) };
        self.proofs[0] = .{ .source_type = self.typeRef(4), .target_type = self.typeRef(5),
            .origin = .{ .source = @enumFromInt(0), .start = 170, .end = 180 }, .fields = &.{}, .methods = &self.proof_methods };
        self.program = .{ .envelope = .{ .magic = model.format.magic, .version = 20, .schema_hash = model.format.schema_hash, .total_bytes = 80, .payload_hash = payload_hash },
            .target = .{ .target = model.format.target, .triple = model.format.triple, .data_layout = model.format.data_layout,
                .i32_bytes = 4, .i32_alignment = 4, .pointer_bits = 64, .pointer_alignment = 8, .capability = 1020 },
            .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = 200, .root_source = @enumFromInt(0),
            .functions = &self.functions, .tables = .{ .sources = &.{.{ .hash = source_hash, .path = source_path, .length = 200 }}, .mode = .{ .common = .{
                .types = &self.types, .members = .{ .fields = &.{}, .methods = &self.methods, .constructions = &self.constructors }, .domains = &.{},
                .storage = .{ .bindings = self.bindings[0..binding_count], .concrete = &self.concrete, .arrays = &.{}, .environments = &.{},
                    .payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 } }, .abis = &self.abis,
                .views = .{ .compatibility = &self.proofs, .dispatch = &self.dispatch_rows, .entries = &.{} },
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

test "base and inherited dispatch accept equal zero minimum" {
    var literal: Literal = undefined;
    literal.init(cases[0]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "inherited projection rejects a stricter override minimum" {
    var literal: Literal = undefined;
    literal.init(cases[1]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "inherited projection rejects an extra ordinary parameter" {
    var literal: Literal = undefined;
    literal.init(cases[2]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "inherited projection rejects a narrower override input" {
    var literal: Literal = undefined;
    literal.init(cases[3]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "base and inherited dispatch accept equal scalar result" {
    var literal: Literal = undefined;
    literal.init(cases[4]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try compatibility.checkCompatibility(&c);
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}

test "inherited projection rejects void override behind scalar result" {
    var literal: Literal = undefined;
    literal.init(cases[5]);
    var c = context.Context{ .program = &literal.program, .allocator = std.testing.allocator };
    try joined(&c);
    try std.testing.expectError(error.InvalidShape, compatibility.checkCompatibility(&c));
    try std.testing.expect(c.remaining > 0 and c.remaining < model.format.max_work);
}
