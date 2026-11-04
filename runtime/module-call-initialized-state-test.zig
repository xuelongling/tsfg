// SPDX-License-Identifier: MIT
// Independent literal typed inputs for the Common SSA boundary. No packet,
// decoder, aggregate verifier, actual solver, Runtime, State or VM is used.
// Function/global identity joins and refs are asserted below; fixed uppers are
// passive permission metadata, not evidence that a body consumes a Global.
// Unused envelope/publication hash fields are placeholders, not identity proof.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const layout = @import("wire-program-layout-check.zig");
const ssa = @import("wire-program-ssa-check.zig");
const t = wire.types;
const ins = wire.instruction;
const scalar: t.TypeRef = @enumFromInt(0);
const boolean: t.TypeRef = @enumFromInt(1);
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const sc: t.Carrier = .{ .@"type"=scalar };
const bc: t.Carrier = .{ .@"type"=boolean };
const anchor: t.Origin = .{ .source=@enumFromInt(0),.start=0,.end=100 };
const f0: t.Hash = @splat(0x30);
const f1: t.Hash = @splat(0x31);
const f2: t.Hash = @splat(0x32);
const g0: t.Hash = @splat(0x40);
const g1: t.Hash = @splat(0x41);
const signature: t.Hash = @splat(0x22);
const empty = [_]t.RegisterRef{};
const value = [_]t.RegisterRef{r0};
const condition = [_]t.RegisterRef{r2};
const language = [_]t.RegisterRef{r1};
const caller_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=.payload,.view=null },.{ .carrier=bc,.view=boolean } };
const callee_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=sc,.view=scalar } };
const constant: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .const_i32=7 } };
const bool_op: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&empty,.data=.{ .const_bool=true } };
const init0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=true } } };
const store0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=false } } };
const load0: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(0) } } };
const load1: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(1) } } };
const entry_fuel: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .fuel=.{ .event=.entry } } };
const ret: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.@"return" };
const raise: ins.Instruction = .{ .source=anchor,.result=null,.operands=&language,.data=.eh_raise };
const invoke: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .eh_invoke=.{ .callee=@enumFromInt(1),.normal=@enumFromInt(1),.exceptional=@enumFromInt(2) } } };
const upper: publication.EffectUpper = .{
    .parameters=&.{},.captures=&.{},.globals=.{ .reads=&.{g0,g1},.writes=&.{g0,g1} },
    .host_resources=.{ .reads=&.{},.writes=&.{} },
    .facets=.{ .allocation=false,.@"await"=false,.eh_control=true,.escape=false,.lock=false,.managed_reference=false,.may_throw=true,.unknown_host=false },
};
const Case = enum { after_init, before_init, callee_only, potential_only, other_global, other_callee, both_arms, missing_arm, unsupported_multiblock, store_before_init, store_after_init };
const Fixture = struct {
    program: wire.Program,
    instructions: [10]ins.Instruction,
    blocks: [6]wire.Block,
    callee_instructions: [5]ins.Instruction,
    callee_blocks: [2]wire.Block,
    other_instructions: [3]ins.Instruction,
    other_blocks: [1]wire.Block,
    functions: [3]wire.Function,
    abis: [3]storage.CommonAbi,
    bindings: [2]storage.CommonBinding,
    sources: [1]tables.Source,
    types: [2]tables.CommonType,

    fn init(self: *Fixture, case: Case) void {
        self.sources=.{.{ .hash=@splat(0x10),.path="/module-call-initialized.ts",.length=100 }};
        const base_type: tables.CommonType=.{ .id=@splat(0x11),.kind=.scalar,.name="i32",.native_code=1,.base=null,.element=null,.members=&.{},.methods=null,.nominal_key=null,.runtime_key=null };
        self.types=.{base_type,base_type}; self.types[1].id=@splat(0x12); self.types[1].name="bool"; self.types[1].native_code=2;
        self.bindings=.{
            .{ .id="g0",.owner=.{ .global=@enumFromInt(0) },.name="g0",.@"type"=scalar,.writable=true,.origin=anchor,.carrier=sc,.scope=null,.declaration_kind=.local },
            .{ .id="g1",.owner=.{ .global=@enumFromInt(1) },.name="g1",.@"type"=scalar,.writable=true,.origin=anchor,.carrier=sc,.scope=null,.declaration_kind=.local },
        };
        const abi: storage.CommonAbi=.{ .kind=.common,.function=@enumFromInt(0),.signature=signature,.parameters=&.{},.argument_types=&.{},.receiver=null,.construction=null,.receiver_frame=null,.lexical_environment=null,.physical_parameters=&.{},.result=null,.result_carrier=null,.source_plan=.{ .carriers=&.{},.blocks=&.{} } };
        self.abis=.{abi,abi,abi}; self.abis[1].function=@enumFromInt(1); self.abis[2].function=@enumFromInt(2);
        self.instructions[0..6].*=.{constant,bool_op,init0,invoke,ret,raise};
        self.blocks[0]=.{ .parameters=&empty,.instructions=self.instructions[0..4] };
        self.blocks[1]=.{ .parameters=&empty,.instructions=self.instructions[4..5] };
        self.blocks[2]=.{ .parameters=&language,.instructions=self.instructions[5..6] };
        self.callee_instructions[0..3].*=.{entry_fuel,load0,ret};
        self.callee_blocks[0]=.{ .parameters=&empty,.instructions=self.callee_instructions[0..3] };
        self.other_instructions=.{entry_fuel,load0,ret}; self.other_blocks=.{.{ .parameters=&empty,.instructions=&self.other_instructions }};
        var block_count: usize=3; var callee_block_count: usize=1; var callee_register_count: usize=1;
        const function_count: usize=if(case==.other_callee)3 else 2;
        switch(case) {
            .after_init => {},
            .before_init => {
                self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
            },
            .callee_only,.unsupported_multiblock => {
                self.instructions[0..5].*=.{constant,bool_op,invoke,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..4]; self.blocks[2].instructions=self.instructions[4..5];
                if(case==.unsupported_multiblock) {
                    callee_block_count=2; callee_register_count=2;
                    self.callee_instructions=.{entry_fuel,constant,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(1) } } },load0,ret};
                    self.callee_instructions[3].result=r1;
                    self.callee_blocks=.{ .{ .parameters=&empty,.instructions=self.callee_instructions[0..3] },.{ .parameters=&empty,.instructions=self.callee_instructions[3..5] } };
                }
            },
            .potential_only,.other_callee => {
                self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
                self.callee_instructions[1]=constant;
            },
            .other_global => { self.callee_instructions[1]=load1; },
            .store_before_init,.store_after_init => {
                self.callee_instructions[0..4].*=.{entry_fuel,constant,store0,ret};
                self.callee_blocks[0].instructions=self.callee_instructions[0..4];
                if(case==.store_before_init) {
                    // No initializer-local Global op: discovery must see the
                    // callee's exact noninitializing write, not its upper.
                    self.instructions[0..5].*=.{constant,bool_op,invoke,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..4]; self.blocks[2].instructions=self.instructions[4..5];
                }
            },
            .both_arms,.missing_arm => {
                block_count=6;
                self.instructions[0..10].*=.{constant,bool_op,
                    .{ .source=anchor,.result=null,.operands=&condition,.data=.{ .cond_br=.{ .true_destination=@enumFromInt(1),.false_destination=@enumFromInt(2),.true_count=0 } } },
                    init0,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(3) } } },
                    init0,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(3) } } },
                    invoke,ret,raise};
                self.instructions[7].data.eh_invoke.normal=@enumFromInt(4); self.instructions[7].data.eh_invoke.exceptional=@enumFromInt(5);
                self.blocks=.{ .{ .parameters=&empty,.instructions=self.instructions[0..3] },.{ .parameters=&empty,.instructions=self.instructions[3..5] },
                    .{ .parameters=&empty,.instructions=self.instructions[5..7] },.{ .parameters=&empty,.instructions=self.instructions[7..8] },
                    .{ .parameters=&empty,.instructions=self.instructions[8..9] },.{ .parameters=&language,.instructions=self.instructions[9..10] } };
                if(case==.missing_arm)self.blocks[2].instructions=self.instructions[6..7];
            },
        }
        const function: wire.Function=.{ .id=f0,.signature=signature,.abi=@enumFromInt(0),.source=@enumFromInt(0),.role=.module_initializer,.declaration=.{ .start=0,.end=100 },.name="$moduleInit",.registers=&caller_registers,.blocks=self.blocks[0..block_count] };
        self.functions=.{function,function,function};
        self.functions[1].id=f1; self.functions[1].abi=@enumFromInt(1); self.functions[1].role=.ordinary; self.functions[1].name="sameName";
        self.functions[1].registers=callee_registers[0..callee_register_count]; self.functions[1].blocks=self.callee_blocks[0..callee_block_count];
        self.functions[2].id=f2; self.functions[2].abi=@enumFromInt(2); self.functions[2].role=.ordinary; self.functions[2].name="sameName";
        self.functions[2].registers=callee_registers[0..1]; self.functions[2].blocks=&self.other_blocks;
        var common=std.mem.zeroes(tables.CommonTables); common.types=&self.types; common.abis=self.abis[0..function_count]; common.storage.bindings=&self.bindings;
        common.storage.payload=.{ .byte_size=16,.alignment=8,.reference_count=1 };
        common.storage.concrete=&.{ .{ .@"type"=scalar,.carrier=.{ .layout=.{ .byte_size=4,.alignment=4,.reference_count=0 },.field_offsets=&.{} },.body=null },.{ .@"type"=boolean,.carrier=.{ .layout=.{ .byte_size=1,.alignment=1,.reference_count=0 },.field_offsets=&.{} },.body=null } };
        common.modules.globals=&.{
            .{ .id=g0,.source=@enumFromInt(0),.name="g0",.@"type"=scalar,.carrier=sc,.writable=true,.generated=false,.start=0,.end=100,.decl_key=.{ .kind=.global,.name="g0",.path=&.{},.source_path="/module-call-initialized.ts" },.binding=@enumFromInt(0) },
            .{ .id=g1,.source=@enumFromInt(0),.name="g1",.@"type"=scalar,.carrier=sc,.writable=true,.generated=false,.start=0,.end=100,.decl_key=.{ .kind=.global,.name="g1",.path=&.{},.source_path="/module-call-initialized.ts" },.binding=@enumFromInt(1) },
        };
        common.modules.modules=&.{.{ .id=@splat(0x50),.source=@enumFromInt(0),.external=true,.initializer=@enumFromInt(0),.dependencies=&.{},.globals=&.{ @enumFromInt(0),@enumFromInt(1) },.imports=&.{},.exports=&.{} }};
        common.modules.initialization=&.{@enumFromInt(0)};
        common.closures.functions=&.{
            .{ .function=@enumFromInt(1),.parent=null,.lexical_environment=null,.activation_environment=null,.captures=&.{} },
            .{ .function=@enumFromInt(2),.parent=null,.lexical_environment=null,.activation_environment=null,.captures=&.{} },
        }; common.closures.functions=common.closures.functions[0..function_count-1];
        common.exceptions.functions=&.{ .{ .function=@enumFromInt(0),.handlers=&.{} },.{ .function=@enumFromInt(1),.handlers=&.{} },.{ .function=@enumFromInt(2),.handlers=&.{} } };
        common.exceptions.functions=common.exceptions.functions[0..function_count];
        common.authority.fixed_publication.publication.contracts=&.{
            .{ .function_id=f1,.signature_hash=signature,.upper=upper,.callables=.{ .parameters=&.{},.returns=null,.slot_writes=.{} },.return_origins=null,.digest=@splat(0x61) },
            .{ .function_id=f2,.signature_hash=signature,.upper=upper,.callables=.{ .parameters=&.{},.returns=null,.slot_writes=.{} },.return_origins=null,.digest=@splat(0x62) },
        };
        common.authority.fixed_publication.publication.contracts=common.authority.fixed_publication.publication.contracts[0..function_count-1];
        common.authority.fixed_publication.dependencies=&.{
            .{ .function_id=f0,.callees=&.{.{ .function_id=f1,.digest=@splat(0x61) }},.hosts=&.{} },
            .{ .function_id=f1,.callees=&.{},.hosts=&.{} },
            .{ .function_id=f2,.callees=&.{},.hosts=&.{} },
        }; common.authority.fixed_publication.dependencies=common.authority.fixed_publication.dependencies[0..function_count];
        self.program=.{ .envelope=std.mem.zeroes(wire.Envelope),.target=std.mem.zeroes(wire.Target),.input_identity=@splat(0),.source_hash=@splat(0),.source_path="",.source_length=0,.root_source=@enumFromInt(0),.tables=.{ .sources=&self.sources,.mode=.{ .common=common } },.functions=self.functions[0..function_count] };
    }
};

fn prerequisites(c: *context.Context) !void {
    const common=c.program.tables.mode.common;
    const module=common.modules.modules[0];
    try std.testing.expectEqual(@as(t.FunctionRef,@enumFromInt(0)),module.initializer);
    try std.testing.expectEqual(c.program.functions[0].source,module.source);
    for(common.modules.globals,0..) |global,index| {
        _=try c.ref(global.binding,common.storage.bindings.len); _=try c.ref(global.source,c.program.tables.sources.len);
        try std.testing.expectEqual(@as(t.GlobalRef,@enumFromInt(index)),module.globals[index]);
        try std.testing.expectEqual(module.source,global.source);
    }
    for(c.program.functions,0..) |f,index| {
        try c.anchor(f.declaration,f.source); _=try c.ref(f.abi,common.abis.len);
        try std.testing.expectEqual(@as(t.FunctionRef,@enumFromInt(index)),common.abis[@intFromEnum(f.abi)].function);
        try std.testing.expectEqual(f.id,common.authority.fixed_publication.dependencies[index].function_id);
        if(f.role==.ordinary) {
            try std.testing.expectEqual(@as(t.FunctionRef,@enumFromInt(index)),common.closures.functions[index-1].function);
            const contract=common.authority.fixed_publication.publication.contracts[index-1];
            try std.testing.expectEqual(f.id,contract.function_id); try std.testing.expectEqual(f.signature,contract.signature_hash);
            try std.testing.expectEqualSlices(t.Hash,&.{g0,g1},contract.upper.globals.reads);
        }
        var defined=[_]bool{false} ** caller_registers.len;
        for(f.registers) |r| { try c.carrier(r.carrier); try c.maybeRef(r.view,c.counts().types); }
        for(f.blocks) |block| {
            for(block.parameters) |r| { const n=try c.ref(r,f.registers.len); try std.testing.expect(!defined[n]); defined[n]=true; }
            for(block.instructions,0..) |op,i| {
                try c.origin(op.source);
                if(op.result) |r| { const n=try c.ref(r,f.registers.len); try std.testing.expect(!defined[n]); defined[n]=true; }
                for(op.operands) |r| { _=try c.ref(r,f.registers.len); }
                switch(op.data) {
                    .const_i32,.const_bool => try std.testing.expect(op.result!=null and op.operands.len==0),
                    .global_store => |v| { _=try c.ref(v.global,c.counts().globals); try std.testing.expect(op.result==null and op.operands.len==1 and std.meta.eql(f.registers[@intFromEnum(op.operands[0])].carrier,sc)); },
                    .global_load => |v| { _=try c.ref(v.global,c.counts().globals); try std.testing.expect(op.result!=null and op.operands.len==0 and std.meta.eql(f.registers[@intFromEnum(op.result.?)].carrier,sc)); },
                    .eh_invoke => |v| {
                        const target=try c.ref(v.callee,c.program.functions.len); _=try c.ref(v.normal,f.blocks.len); _=try c.ref(v.exceptional,f.blocks.len);
                        try std.testing.expect(i+1==block.instructions.len and op.operands.len==0 and op.result==null);
                        try std.testing.expectEqual(@as(usize,1),target); try std.testing.expectEqual(f1,c.program.functions[target].id);
                        try std.testing.expectEqual(module.source,c.program.functions[target].source);
                        try std.testing.expect(c.program.functions[target].role==.ordinary);
                        const dependency=common.authority.fixed_publication.dependencies[index].callees[0];
                        try std.testing.expectEqual(f1,dependency.function_id);
                        try std.testing.expectEqual(common.authority.fixed_publication.publication.contracts[0].digest,dependency.digest);
                    },
                    .br => |v| { _=try c.ref(v.destination,f.blocks.len); try std.testing.expect(i+1==block.instructions.len and op.operands.len==0 and op.result==null); },
                    .cond_br => |v| { _=try c.ref(v.true_destination,f.blocks.len); _=try c.ref(v.false_destination,f.blocks.len); try std.testing.expect(i+1==block.instructions.len and op.operands.len==1 and v.true_count==0 and op.result==null); },
                    .@"return" => try std.testing.expect(i+1==block.instructions.len and op.operands.len==0 and op.result==null),
                    .eh_raise => try std.testing.expect(i+1==block.instructions.len and op.operands.len==1 and op.result==null and f.registers[@intFromEnum(op.operands[0])].carrier==.payload),
                    .fuel => try std.testing.expect(op.result==null and op.operands.len==0),
                    else => return error.TestUnexpectedOpcode,
                }
            }
        }
        for(defined[0..f.registers.len]) |present| try std.testing.expect(present);
    }
    try layout.check(c);
}
fn check(case: Case, rejected: bool) !void {
    var fixture: Fixture=undefined; fixture.init(case);
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try prerequisites(&c);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
    try std.testing.expect(c.remaining>0 and c.remaining<wire.format.max_work);
}
test "module call accepts actual read after initialization" { try check(.after_init,false); }
test "module call rejects discarded actual read before initialization" { try check(.before_init,true); }
test "module call discovers a GlobalRef mentioned only by its callee" { try check(.callee_only,true); }
test "module call potential read permission does not imply actual consumption" { try check(.potential_only,false); }
test "module call cannot borrow another GlobalRef initialization" { try check(.other_global,true); }
test "module call uses exact target rather than an uncalled same-name function" { try check(.other_callee,false); }
test "module call accepts initialization on both caller arms" { try check(.both_arms,false); }
test "module call rejects an uninitialized caller merge arm" { try check(.missing_arm,true); }
test "module call leaves a multi-block callee to its existing separate obligation" { try check(.unsupported_multiblock,false); }
test "module call rejects a callee-only ordinary write before initialization" { try check(.store_before_init,true); }
test "module call accepts ordinary write after initialization" { try check(.store_after_init,false); }
