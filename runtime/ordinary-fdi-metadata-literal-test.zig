// SPDX-License-Identifier: MIT
// Fresh typed metadata only. There is no Source text/package, JSON reader,
// publication admission, Source correspondence, default execution or Actual/VM.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const control = @import("wire-program-control.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const refs = @import("wire-program-table-refs.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const identity = @import("wire-program-identity-check.zig");
const interfaces = @import("wire-program-fixed-publication-check.zig");
const publication_refs = @import("wire-program-publication-refs.zig");
const t = model.types;
fn Item(comptime T: type, comptime field: []const u8) type { return @typeInfo(@FieldType(T, field)).pointer.child; }
fn h(comptime text: []const u8) t.Hash {
    @setEvalBranchQuota(100000);
    var value: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&value, text) catch unreachable;
    return value;
}
const source_path = "/literal-ordinary-fdi-metadata.ts";
const scalar_id = h("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727");
const undefined_id = h("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");
const void_id = h("acf3514b79a27982daf00b3c04ee5bd8aee8612ba772341a5fa623425b94c190");
const union_id = h("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
// Sorted TypeId positions: union, undefined, scalar, void.
const ids = [4]t.Hash{ union_id, undefined_id, scalar_id, void_id };
const union_type: t.TypeRef = @enumFromInt(0);
const scalar_type: t.TypeRef = @enumFromInt(2);
const union_members = [_]t.TypeRef{ scalar_type, @enumFromInt(1) };
const scalar_label = "{\"kind\":\"scalar\",\"name\":\"i32\"}";
const undefined_label = "{\"kind\":\"undefined\",\"name\":\"undefined\"}";
const void_label = "{\"kind\":\"void\",\"name\":\"void\"}";
const union_label = "{\"kind\":\"union\",\"members\":[\"{\\\"kind\\\":\\\"scalar\\\",\\\"name\\\":\\\"i32\\\"}\",\"{\\\"kind\\\":\\\"undefined\\\",\\\"name\\\":\\\"undefined\\\"}\"]}";
const Case = struct { declared_union: bool, minimum: ?u16, zero: bool = false, signature: t.Hash, function_id: t.Hash, scope_digest: t.Hash, contract_digest: t.Hash, publication_digest: t.Hash };
// Replaced once by independently calculated fixed literals during preparation.
const cases = [_]Case{
    .{ .declared_union=false, .minimum=0, .zero=false, .signature=h("34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"), .function_id=h("bd69e76d3a5fbdb1d86589464f4fc9bae099c8ed7b1a3a06d9ea0aff3c44c568"), .scope_digest=h("57449952d06b4e57d938d8eadb2a382c48b1dae2955cd20776388f7f010d2953"), .contract_digest=h("da9477aa2cd06aef28a79a8ad9e887e245f0f1d90fa22db4cf7a1c6ee22b4c13"), .publication_digest=h("ee1905713a9949edb722fbbd20ccaf38b436747f064601f2ccd688f3547a7d98") },
    .{ .declared_union=true, .minimum=0, .zero=false, .signature=h("34660cb82732affc3258aae5423b99b685f42e92512555d5d8637a753f42b0e7"), .function_id=h("bd69e76d3a5fbdb1d86589464f4fc9bae099c8ed7b1a3a06d9ea0aff3c44c568"), .scope_digest=h("880ad62c4c7ec33b479431185248c573ccd5d2c6e63cb29c15f9e2f8b29198b3"), .contract_digest=h("da9477aa2cd06aef28a79a8ad9e887e245f0f1d90fa22db4cf7a1c6ee22b4c13"), .publication_digest=h("e1a9f80df09519199f91f3170ce84b8ce382b7308c804e6dd51b66d845d408f5") },
    .{ .declared_union=true, .minimum=null, .zero=false, .signature=h("0f7219ad8bd33738a531658cae2241923cb46773b62921edd823731327926cad"), .function_id=h("624f3579e1fbe49e5874507ab276292eac2ae6672636ab19afe9339c7d3edcf0"), .scope_digest=h("1eb8fdb1e25ecbe7e225d91143a70d968c0442f63a1499446dc700e5709d17f7"), .contract_digest=h("6e70a118b85db95703da6d87803432313ab1e52e76881a08e50f0ff5ff4a0bc1"), .publication_digest=h("3111117811e9dda02a7205cfddfc2fbd27089db8a874968dc3085bad949a5bf7") },
    .{ .declared_union=false, .minimum=null, .zero=true, .signature=h("812d7f89a0bb3b2ff92e22ca01d3632517bc3a25758c10b5b6dc160894f298f8"), .function_id=h("8fce2842ecef5fb5525cae4222c6b655ea5453192fdfb220723dc37f8bc1d71b"), .scope_digest=h("00757bb595590b17a965036476d86d937a63051d4c47e8bf8ac0fe5a9383666d"), .contract_digest=h("93ff1846126377fb886f9490373c0e4fb7446503bc4d37d8cf69e8254c5a5984"), .publication_digest=h("a531a1b93a34f3509cac0e03dcd32648697722963c9735b2da5690019ee492f2") },
};
const upper: publication.EffectUpper = .{ .parameters=&.{.{ .index=0, .read=false, .write=false, .structural=false }}, .captures=&.{},
    .globals=.{ .reads=&.{}, .writes=&.{} }, .host_resources=.{ .reads=&.{}, .writes=&.{} },
    .facets=.{ .allocation=false, .@"await"=false, .eh_control=false, .escape=false, .lock=false, .managed_reference=false, .may_throw=false, .unknown_host=false } };
const begin: t.Origin = .{ .source=@enumFromInt(0), .start=0, .end=80 };
const finish: t.Origin = .{ .source=@enumFromInt(0), .start=78, .end=79 };
const fuel = [_]t.JsonMember{.{ .key="event", .value=.{ .integer=1 } }};
const entries = [_]t.RegisterRef{@enumFromInt(0)};
const registers = [_]model.Register{.{ .carrier=.payload, .view=union_type }};
const instructions = [_]model.instruction.Instruction{
    .{ .source=begin, .result=null, .operands=&.{}, .data=.{ .fuel=.{ .event=.entry } } },
    .{ .source=finish, .result=null, .operands=&.{}, .data=.@"return" },
};
const plan_operations = [_]control.SourcePlanOperation{
    .{ .name="fuel", .view="void", .properties=&fuel, .result=null, .operands=&.{}, .successors=&.{}, .source=begin },
    .{ .name="func.return", .view="", .properties=&.{}, .result=null, .operands=&.{}, .successors=&.{}, .source=finish },
};
const Literal = struct {
    program: model.Program,
    functions: [1]model.Function,
    abis: [1]storage.CommonAbi,
    bindings: [1]storage.CommonBinding,
    fixed_functions: [1]Item(publication.StableScope,"functions"),
    contracts: [1]Item(publication.Publication,"contracts"),
    dependencies: [1]Item(publication.FixedPublication,"dependencies"),
    declared: [1]t.Hash,
    blocks: [1]model.Block,
    plan_blocks: [1]control.SourcePlanBlock,

    fn init(self: *Literal, example: Case) void {
        self.blocks = .{.{ .parameters=if(example.zero)&.{} else &entries, .instructions=&instructions }};
        self.plan_blocks = .{.{ .parameters=if(example.zero)&.{} else &entries, .operations=&plan_operations }};
        const declared_type = if (example.declared_union) union_type else scalar_type;
        self.declared = .{if(example.declared_union)union_id else scalar_id};
        self.bindings = .{.{ .id="literal:ordinary-parameter", .owner=.{ .param=@enumFromInt(0) }, .name="input", .@"type"=declared_type,
            .writable=false, .origin=.{ .source=@enumFromInt(0), .start=12, .end=20 },
            .carrier=if(example.declared_union).payload else .{ .@"type"=scalar_type }, .scope=@enumFromInt(0), .declaration_kind=.parameter }};
        self.functions = .{.{ .id=example.function_id, .signature=example.signature, .abi=@enumFromInt(0), .source=@enumFromInt(0),
            .role=.ordinary, .declaration=.{ .start=0, .end=80 }, .name="consume", .registers=if(example.zero)&.{} else &registers, .blocks=&self.blocks }};
        self.abis = .{.{ .kind=.common, .function=@enumFromInt(0), .signature=example.signature, .parameters=if(example.zero)&.{} else &.{@enumFromInt(0)},
            .argument_types=if(example.zero)&.{} else &.{union_type}, .method_minimum_argument_count=null, .ordinary_minimum_argument_count=example.minimum,
            .receiver=null, .construction=null, .receiver_frame=null, .lexical_environment=null, .physical_parameters=if(example.zero)&.{} else &.{.payload},
            .result=null, .result_carrier=null, .source_plan=.{ .carriers=if(example.zero)&.{} else &.{"payload"}, .blocks=&self.plan_blocks } }};
        self.fixed_functions = .{.{ .function_id=example.function_id, .signature_hash=example.signature, .kind=.source,
            .decl_key=.{ .kind=.function, .name="consume", .path=&.{}, .source_path=source_path }, .parameter_types=if(example.zero)&.{} else &self.declared,
            .method_minimum_argument_count=null, .ordinary_parameter_initialization=if(example.minimum)|minimum|.{ .minimum_argument_count=minimum, .argument_types=&.{union_id} }else null,
            .return_type=void_id, .construction=null, .lexical_parent=null, .lexical_environment=null, .activation_environment=null, .captures=&.{}, .access=.public }};
        var effect=upper;if(example.zero)effect.parameters=&.{};
        self.contracts = .{.{ .function_id=example.function_id, .signature_hash=example.signature, .upper=effect,
            .callables=.{ .parameters=&.{}, .returns=null, .slot_writes=.{} }, .return_origins=null, .digest=example.contract_digest }};
        self.dependencies = .{.{ .function_id=example.function_id, .callees=&.{}, .hosts=&.{} }};
        const scope: publication.StableScope = .{ .profile=.@"common-program-fixed-v6", .declaration_types=if(example.zero)&.{void_id} else &ids, .constructions=&.{}, .storage=.{ .fields=&.{}, .results=&.{} },
            .root_file=source_path, .modules=&.{}, .roots=.{ .roots=&.{}, .required_roots=&.{} }, .globals=&.{}, .environments=&.{}, .host_context=null, .host_imports=&.{}, .functions=&self.fixed_functions,
            .types=&.{
                .{ .id=union_id, .label=union_label, .shape=.{ .union_type=.{ .kind=.@"union", .label=union_label, .members=&.{scalar_label,undefined_label} } } },
                .{ .id=undefined_id, .label=undefined_label, .shape=.{ .primitive=.{ .kind=.@"undefined", .label=undefined_label } } },
                .{ .id=scalar_id, .label=scalar_label, .shape=.{ .primitive=.{ .kind=.scalar, .label=scalar_label } } },
                .{ .id=void_id, .label=void_label, .shape=.{ .primitive=.{ .kind=.@"void", .label=void_label } } },
            } };
        self.program = .{ .envelope=.{ .magic=model.format.magic, .version=model.format.version, .schema_hash=model.format.schema_hash, .total_bytes=80, .payload_hash=@splat(0x33) },
            .target=.{ .target=model.format.target, .triple=model.format.triple, .data_layout=model.format.data_layout, .i32_bytes=4, .i32_alignment=4, .pointer_bits=64, .pointer_alignment=8, .capability=model.format.capability },
            .input_identity=@splat(0x22), .source_hash=@splat(0x11), .source_path=source_path, .source_length=128, .root_source=@enumFromInt(0), .functions=&self.functions,
            .tables=.{ .sources=&.{.{ .path=source_path, .hash=@splat(0x11), .length=128 }}, .mode=.{ .common=.{
                .types=&.{
                    .{ .id=union_id, .kind=.@"union", .name="union", .native_code=0, .base=null, .element=null, .members=&union_members, .methods=null, .nominal_key=null, .runtime_key=null },
                    .{ .id=undefined_id, .kind=.@"undefined", .name="undefined", .native_code=0, .base=null, .element=null, .members=&.{}, .methods=null, .nominal_key=null, .runtime_key=null },
                    .{ .id=scalar_id, .kind=.scalar, .name="i32", .native_code=1, .base=null, .element=null, .members=&.{}, .methods=null, .nominal_key=null, .runtime_key=null },
                    .{ .id=void_id, .kind=.@"void", .name="void", .native_code=0, .base=null, .element=null, .members=&.{}, .methods=null, .nominal_key=null, .runtime_key=null },
                }, .members=.{ .fields=&.{}, .methods=&.{}, .constructions=&.{} }, .domains=&.{},
                .storage=.{ .bindings=self.bindings[0..if(example.zero)0 else 1], .concrete=&.{
                    .{ .@"type"=@enumFromInt(1), .carrier=.{ .layout=.{ .byte_size=0, .alignment=1, .reference_count=0 }, .field_offsets=&.{} }, .body=null },
                    .{ .@"type"=scalar_type, .carrier=.{ .layout=.{ .byte_size=4, .alignment=4, .reference_count=0 }, .field_offsets=&.{} }, .body=null },
                    .{ .@"type"=@enumFromInt(3), .carrier=.{ .layout=.{ .byte_size=0, .alignment=1, .reference_count=0 }, .field_offsets=&.{} }, .body=null },
                }, .arrays=&.{}, .environments=&.{}, .payload=.{ .byte_size=16, .alignment=8, .reference_count=1 } }, .abis=&self.abis,
                .views=.{ .compatibility=&.{}, .dispatch=&.{}, .entries=&.{} },
                .modules=.{ .modules=&.{}, .globals=&.{}, .hosts=&.{}, .initialization=&.{}, .roots=.{ .roots=&.{}, .required_roots=&.{} } },
                .closures=.{ .functions=&.{.{ .function=@enumFromInt(0), .parent=null, .lexical_environment=null, .activation_environment=null, .captures=&.{} }}, .environments=&.{}, .calls=&.{} },
                .exceptions=.{ .functions=&.{.{ .function=@enumFromInt(0), .handlers=&.{} }}, .bindings=if(example.zero)&.{} else &.{.{ .binding=@enumFromInt(0), .scope=@enumFromInt(0) }}, .scopes=&.{.{ .owner=@enumFromInt(0), .path=&.{} }} },
                .authority=.{ .exports=.{}, .entries=.{}, .resources=.{}, .published=.{}, .fixed_publication=.{ .stable_scope=scope,
                    .publication=.{ .format=.{ .family=.@"tsfg.program-publication-candidate", .version=6 }, .mode=.fixed, .scope=scope, .scope_digest=example.scope_digest, .expected_digest=example.publication_digest, .contracts=&self.contracts },
                    .dependencies=&self.dependencies, .request=.{ .targets=&.{} } } },
            } } } };
    }
};
fn joined(c: *context.Context) context.Error!void {
    try refs.check(c); try layout.check(c); try ssa.check(c); try identity.check(c); try interfaces.checkInterfaces(c);
}
test "ordinary metadata keeps default binding and incoming union independent" {
    for(cases) |example| { var literal: Literal=undefined; literal.init(example); var c=context.Context{ .program=&literal.program, .allocator=std.testing.allocator }; try joined(&c); try std.testing.expect(c.remaining<model.format.max_work); }
    try std.testing.expectEqual(cases[0].signature,cases[1].signature);
    try std.testing.expect(!std.mem.eql(u8,&cases[1].signature,&cases[2].signature));
    try std.testing.expect(!std.mem.eql(u8,&cases[1].function_id,&cases[2].function_id));
    try std.testing.expect(!std.mem.eql(u8,&cases[0].scope_digest,&cases[1].scope_digest));
}
test "ordinary metadata rejects independent minimum incoming null and role corruption" {
    for(0..9) |mutation| {
        var literal: Literal=undefined; literal.init(cases[0]);
        // Establish a genuine positive prefix before constructing each negative.
        var positive=context.Context{ .program=&literal.program, .allocator=std.testing.allocator }; try joined(&positive);
        switch(mutation) {
            0 => literal.abis[0].ordinary_minimum_argument_count=1,
            1 => literal.fixed_functions[0].ordinary_parameter_initialization.?.minimum_argument_count=1,
            2 => literal.fixed_functions[0].ordinary_parameter_initialization.?.argument_types=&.{scalar_id},
            3 => literal.abis[0].ordinary_minimum_argument_count=null,
            4 => literal.fixed_functions[0].ordinary_parameter_initialization=null,
            5 => literal.fixed_functions[0].lexical_parent=cases[0].function_id,
            6 => literal.abis[0].method_minimum_argument_count=0,
            7 => literal.abis[0].argument_types=&.{scalar_type},
            8 => literal.functions[0].role=.module_initializer,
            else => unreachable,
        }
        var negative=context.Context{ .program=&literal.program, .allocator=std.testing.allocator };
        try std.testing.expectError(error.InvalidShape,joined(&negative));
    }
}
test "ordinary fixed graph formal uses incoming union rather than initialized binding" {
    var literal: Literal=undefined; literal.init(cases[0]); var c=context.Context{ .program=&literal.program, .allocator=std.testing.allocator }; try joined(&c);
    var arena=std.heap.ArenaAllocator.init(std.testing.allocator); defer arena.deinit();
    const directory=try publication_refs.returnOriginDirectory(&c,arena.allocator(),literal.program.tables.mode.common.authority.fixed_publication);
    try std.testing.expectEqualStrings("sha256:29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea",directory.functions[0].parameter_types[0]);
}
test "zero parameter ordinary function requires null FDI metadata" {
    for(0..2) |mutation| {
        var literal: Literal=undefined;literal.init(cases[3]);
        var positive=context.Context{ .program=&literal.program, .allocator=std.testing.allocator };try joined(&positive);
        if(mutation==0)literal.abis[0].ordinary_minimum_argument_count=0
        else literal.fixed_functions[0].ordinary_parameter_initialization=.{ .minimum_argument_count=0, .argument_types=&.{} };
        var negative=context.Context{ .program=&literal.program, .allocator=std.testing.allocator };
        try std.testing.expectError(error.InvalidShape,joined(&negative));
    }
}
test "ordinary metadata does not refill work or accept old mixed envelopes" {
    var literal: Literal=undefined; literal.init(cases[0]); var positive=context.Context{ .program=&literal.program, .allocator=std.testing.allocator }; try joined(&positive);
    var exhausted=context.Context{ .program=&literal.program, .allocator=std.testing.allocator, .remaining=1 }; try std.testing.expectError(error.WorkLimit,joined(&exhausted)); try std.testing.expectEqual(@as(usize,0),exhausted.remaining);
    for([_]u32{17,18,19}) |old| { var envelope=literal.program.envelope; envelope.version=old; try std.testing.expectError(error.WrongFormat,model.requireFormat(envelope,literal.program.target)); }
    var mixed=literal.program.envelope; mixed.schema_hash=@splat(0); try std.testing.expectError(error.WrongFormat,model.requireFormat(mixed,literal.program.target));
}
