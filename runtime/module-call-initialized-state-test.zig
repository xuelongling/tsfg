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
const module_contracts = @import("wire-program-module-contracts-check.zig");
const fixed_targets = @import("wire-program-fixed-targets-check.zig");
const t = wire.types;
const ins = wire.instruction;
const scalar: t.TypeRef = @enumFromInt(0);
const boolean: t.TypeRef = @enumFromInt(1);
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const r3: t.RegisterRef = @enumFromInt(3);
const void_type: t.TypeRef = @enumFromInt(2);
const callable_type: t.TypeRef = @enumFromInt(3);
const callable_carrier: t.Carrier = .{ .@"type"=callable_type };
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
const returned_value = [_]t.RegisterRef{r2};
const callee_operand = [_]t.RegisterRef{r1};
const caller_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=.payload,.view=null },.{ .carrier=bc,.view=boolean } };
const result_caller_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=.payload,.view=null },.{ .carrier=sc,.view=scalar } };
const callee_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=sc,.view=scalar } };
const branch_callee_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=bc,.view=boolean } };
const exceptional_registers = [_]wire.Register{ .{ .carrier=sc,.view=scalar },.{ .carrier=.payload,.view=null } };
const constant: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .const_i32=7 } };
const bool_op: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&empty,.data=.{ .const_bool=true } };
const init0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=true } } };
const store0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=false } } };
const load0: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(0) } } };
const load1: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(1) } } };
const entry_fuel: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .fuel=.{ .event=.entry } } };
const ret: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.@"return" };
const payload_from_i32: ins.Instruction = .{ .source=anchor,.result=r1,.operands=&value,.data=.{ .eh_carrier=null } };
const raise: ins.Instruction = .{ .source=anchor,.result=null,.operands=&language,.data=.eh_raise };
const invoke: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .eh_invoke=.{ .callee=@enumFromInt(1),.normal=@enumFromInt(1),.exceptional=@enumFromInt(2) } } };
const invoke_nested: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .eh_invoke=.{ .callee=@enumFromInt(2),.normal=@enumFromInt(1),.exceptional=@enumFromInt(2) } } };
const next_block: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(1) } } };
const upper: publication.EffectUpper = .{
    .parameters=&.{},.captures=&.{},.globals=.{ .reads=&.{g0,g1},.writes=&.{g0,g1} },
    .host_resources=.{ .reads=&.{},.writes=&.{} },
    .facets=.{ .allocation=false,.@"await"=false,.eh_control=true,.escape=false,.lock=false,.managed_reference=false,.may_throw=true,.unknown_host=false },
};
const Dependency = @typeInfo(@FieldType(publication.FixedPublication, "dependencies")).pointer.child;
const direct_dependencies = [3]Dependency{
    .{ .function_id=f0,.callees=&.{.{ .function_id=f1,.digest=@splat(0x61) }},.hosts=&.{} },
    .{ .function_id=f1,.callees=&.{},.hosts=&.{} },
    .{ .function_id=f2,.callees=&.{},.hosts=&.{} },
};
const nested_dependencies = [3]Dependency{
    direct_dependencies[0],
    .{ .function_id=f1,.callees=&.{.{ .function_id=f2,.digest=@splat(0x62) }},.hosts=&.{} },
    direct_dependencies[2],
};
const recursive_dependencies = [3]Dependency{
    nested_dependencies[0],
    nested_dependencies[1],
    .{ .function_id=f2,.callees=&.{.{ .function_id=f1,.digest=@splat(0x61) }},.hosts=&.{} },
};
const Case = enum {
    after_init, before_init, callee_only, potential_only, other_global, other_callee, both_arms, missing_arm,
    store_before_init, store_after_init, multiblock_read_before_init, multiblock_read_after_init,
    multiblock_unreachable, multiblock_branch_before_init, multiblock_branch_after_init,
    multiblock_store_before_init, multiblock_store_after_init,
    multiblock_exception_before_init, multiblock_exception_after_init,
    nested_before_init, nested_after_init, recursive_before_init, recursive_after_init,
};
const Fixture = struct {
    program: wire.Program,
    instructions: [10]ins.Instruction,
    blocks: [6]wire.Block,
    callee_instructions: [6]ins.Instruction,
    callee_blocks: [3]wire.Block,
    other_instructions: [5]ins.Instruction,
    other_blocks: [3]wire.Block,
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
        self.other_instructions[0..3].*=.{entry_fuel,load0,ret};
        self.other_blocks[0]=.{ .parameters=&empty,.instructions=self.other_instructions[0..3] };
        var block_count: usize=3; var callee_block_count: usize=1;
        var other_block_count: usize=1;
        var caller_regs: []const wire.Register=&caller_registers;
        var callee_regs: []const wire.Register=callee_registers[0..1];
        const exceptional=case==.multiblock_exception_before_init or case==.multiblock_exception_after_init;
        const recursive=case==.recursive_before_init or case==.recursive_after_init;
        const nested=exceptional or recursive or case==.nested_before_init or case==.nested_after_init;
        const function_count: usize=if(case==.other_callee or nested)3 else 2;
        switch(case) {
            .after_init => {},
            .before_init => {
                self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
            },
            .callee_only,.multiblock_unreachable => {
                self.instructions[0..5].*=.{constant,bool_op,invoke,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..4]; self.blocks[2].instructions=self.instructions[4..5];
                if(case==.multiblock_unreachable) {
                    callee_block_count=2;
                    self.callee_instructions[0..4].*=.{entry_fuel,ret,load0,ret};
                    self.callee_blocks[0].instructions=self.callee_instructions[0..2];
                    self.callee_blocks[1]=.{ .parameters=&empty,.instructions=self.callee_instructions[2..4] };
                }
            },
            .multiblock_read_before_init,.multiblock_read_after_init => {
                caller_regs=&result_caller_registers;
                if(case==.multiblock_read_before_init) {
                    self.instructions[0..5].*=.{constant,invoke,init0,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..2];
                    self.blocks[1].instructions=self.instructions[2..4];
                } else {
                    self.instructions[0..5].*=.{constant,init0,invoke,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..3];
                    self.blocks[1].instructions=self.instructions[3..4];
                }
                self.blocks[1].parameters=&returned_value;
                self.blocks[2].instructions=self.instructions[4..5];
                self.abis[1].result=scalar; self.abis[1].result_carrier=sc;
                callee_block_count=2; callee_regs=&callee_registers;
                self.callee_instructions[0..5].*=.{entry_fuel,constant,next_block,load0,ret};
                self.callee_instructions[3].result=r1;
                self.callee_instructions[4].operands=&callee_operand;
                self.callee_blocks[0].instructions=self.callee_instructions[0..3];
                self.callee_blocks[1]=.{ .parameters=&empty,.instructions=self.callee_instructions[3..5] };
            },
            .multiblock_branch_before_init,.multiblock_branch_after_init => {
                if(case==.multiblock_branch_before_init) {
                    self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
                }
                callee_block_count=3; callee_regs=&branch_callee_registers;
                const branch: ins.Instruction=.{ .source=anchor,.result=null,.operands=&callee_operand,
                    .data=.{ .cond_br=.{ .true_destination=@enumFromInt(1),.false_destination=@enumFromInt(2),.true_count=0 } } };
                self.callee_instructions=.{entry_fuel,bool_op,branch,load0,ret,ret};
                self.callee_instructions[1].result=r1;
                self.callee_blocks=.{
                    .{ .parameters=&empty,.instructions=self.callee_instructions[0..3] },
                    .{ .parameters=&empty,.instructions=self.callee_instructions[3..5] },
                    .{ .parameters=&empty,.instructions=self.callee_instructions[5..6] },
                };
            },
            .multiblock_exception_before_init,.multiblock_exception_after_init => {
                if(case==.multiblock_exception_before_init) {
                    self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
                }
                callee_block_count=3; callee_regs=&exceptional_registers;
                self.callee_instructions[0..5].*=.{entry_fuel,invoke_nested,ret,load0,raise};
                self.callee_blocks=.{
                    .{ .parameters=&empty,.instructions=self.callee_instructions[0..2] },
                    .{ .parameters=&empty,.instructions=self.callee_instructions[2..3] },
                    .{ .parameters=&language,.instructions=self.callee_instructions[3..5] },
                };
                self.other_instructions[0..4].*=.{entry_fuel,constant,payload_from_i32,raise};
                self.other_blocks[0].instructions=self.other_instructions[0..4];
            },
            .nested_before_init,.nested_after_init,.recursive_before_init,.recursive_after_init => {
                if(case==.nested_before_init or case==.recursive_before_init) {
                    self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                    self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
                }
                callee_block_count=3; callee_regs=exceptional_registers[1..2];
                self.callee_instructions[0..4].*=.{entry_fuel,invoke_nested,ret,raise};
                self.callee_instructions[3].operands=&value;
                self.callee_blocks=.{
                    .{ .parameters=&empty,.instructions=self.callee_instructions[0..2] },
                    .{ .parameters=&empty,.instructions=self.callee_instructions[2..3] },
                    .{ .parameters=&value,.instructions=self.callee_instructions[3..4] },
                };
                if(recursive) {
                    other_block_count=3;
                    self.other_instructions=.{entry_fuel,load0,invoke,ret,raise};
                    self.other_blocks=.{
                        .{ .parameters=&empty,.instructions=self.other_instructions[0..3] },
                        .{ .parameters=&empty,.instructions=self.other_instructions[3..4] },
                        .{ .parameters=&language,.instructions=self.other_instructions[4..5] },
                    };
                }
            },
            .potential_only,.other_callee => {
                self.instructions[0..6].*=.{constant,bool_op,invoke,init0,ret,raise};
                self.blocks[0].instructions=self.instructions[0..3]; self.blocks[1].instructions=self.instructions[3..5];
                self.callee_instructions[1]=constant;
            },
            .other_global => { self.callee_instructions[1]=load1; },
            .store_before_init,.store_after_init,.multiblock_store_before_init,.multiblock_store_after_init => {
                if(case==.multiblock_store_before_init or case==.multiblock_store_after_init) {
                    callee_block_count=2;
                    self.callee_instructions[0..5].*=.{entry_fuel,constant,next_block,store0,ret};
                    self.callee_blocks[0].instructions=self.callee_instructions[0..3];
                    self.callee_blocks[1]=.{ .parameters=&empty,.instructions=self.callee_instructions[3..5] };
                } else {
                    self.callee_instructions[0..4].*=.{entry_fuel,constant,store0,ret};
                    self.callee_blocks[0].instructions=self.callee_instructions[0..4];
                }
                if(case==.store_before_init or case==.multiblock_store_before_init) {
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
        const function: wire.Function=.{ .id=f0,.signature=signature,.abi=@enumFromInt(0),.source=@enumFromInt(0),.role=.module_initializer,.declaration=.{ .start=0,.end=100 },.name="$moduleInit",.registers=caller_regs,.blocks=self.blocks[0..block_count] };
        self.functions=.{function,function,function};
        self.functions[1].id=f1; self.functions[1].abi=@enumFromInt(1); self.functions[1].role=.ordinary; self.functions[1].name="sameName";
        self.functions[1].registers=callee_regs; self.functions[1].blocks=self.callee_blocks[0..callee_block_count];
        self.functions[2].id=f2; self.functions[2].abi=@enumFromInt(2); self.functions[2].role=.ordinary; self.functions[2].name="sameName";
        self.functions[2].registers=if(exceptional or recursive)&exceptional_registers else callee_registers[0..1];
        self.functions[2].blocks=self.other_blocks[0..other_block_count];
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
        const dependencies=if(recursive)&recursive_dependencies else if(nested)&nested_dependencies else &direct_dependencies;
        common.authority.fixed_publication.dependencies=dependencies[0..function_count];
        self.program=.{ .envelope=std.mem.zeroes(wire.Envelope),.target=std.mem.zeroes(wire.Target),.input_identity=@splat(0),.source_hash=@splat(0),.source_path="",.source_length=0,.root_source=@enumFromInt(0),.tables=.{ .sources=&self.sources,.mode=.{ .common=common } },.functions=self.functions[0..function_count] };
    }
};

fn prerequisites(c: *context.Context, foreign: bool) !void {
    const common=c.program.tables.mode.common;
    const module=common.modules.modules[0];
    try std.testing.expectEqual(@as(t.FunctionRef,@enumFromInt(0)),module.initializer);
    try std.testing.expectEqual(c.program.functions[0].source,module.source);
    for(common.modules.globals,0..) |global,index| {
        _=try c.ref(global.binding,common.storage.bindings.len); _=try c.ref(global.source,c.program.tables.sources.len);
        const owner=common.modules.modules[if(foreign)index else 0];
        try std.testing.expectEqual(@as(t.GlobalRef,@enumFromInt(index)),owner.globals[if(foreign)0 else index]);
        try std.testing.expectEqual(owner.source,global.source);
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
        var defined=[_]bool{false} ** block_code_registers.len;
        for(f.registers) |r| { try c.carrier(r.carrier); try c.maybeRef(r.view,c.counts().types); }
        for(f.blocks,0..) |block,b| {
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
                        const expected_target: usize=if(index==1)2 else 1;
                        const callee_id=if(expected_target==1)f1 else f2;
                        try std.testing.expectEqual(expected_target,target);
                        try std.testing.expectEqual(callee_id,c.program.functions[target].id);
                        const target_source: t.SourceRef=if(foreign and expected_target==1)@enumFromInt(1) else module.source;
                        try std.testing.expectEqual(target_source,c.program.functions[target].source);
                        try std.testing.expect(c.program.functions[target].role==.ordinary);
                        const callees=common.authority.fixed_publication.dependencies[index].callees;
                        try std.testing.expectEqual(@as(usize,1),callees.len);
                        const dependency=callees[0];
                        try std.testing.expectEqual(callee_id,dependency.function_id);
                        try std.testing.expectEqual(common.authority.fixed_publication.publication.contracts[target-1].digest,dependency.digest);
                    },
                    .function_make => |v| {
                        const target=try c.ref(v.function,c.program.functions.len);
                        try std.testing.expect(op.result!=null and op.operands.len==0);
                        try std.testing.expectEqual(if(index==1)f2 else f1,c.program.functions[target].id);
                        try std.testing.expect(c.program.functions[target].role==.ordinary);
                        try std.testing.expect(common.abis[target].lexical_environment==null);
                        try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(op.result.?)].carrier,callable_carrier));
                    },
                    inline .domain_copy,.domain_view => |v,kind| {
                        try std.testing.expect(v.static_view==callable_type and op.operands.len==1);
                        if (index==1) {
                            try std.testing.expect(op.result==r2 and op.operands[0]==r1);
                            try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(r1)].carrier,callable_carrier));
                            try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(r2)].carrier,callable_carrier));
                        } else {
                            try std.testing.expect((op.result==r3 and op.operands[0]==r2) or
                                (kind==.domain_view and op.result==saved_tail and op.operands[0]==r3));
                        }
                    },
                    .eh_invoke_indirect => |v| {
                        _=try c.ref(v.normal,f.blocks.len); _=try c.ref(v.exceptional,f.blocks.len);
                        try std.testing.expect(i+1==block.instructions.len and op.operands.len==1 and op.result==null and v.callable==callable_type);
                        const logical=common.types[@intFromEnum(v.callable)];
                        try std.testing.expect(logical.kind==.function and logical.element==void_type and logical.members.len==0);
                        const call=common.closures.calls[0];
                        try std.testing.expect(call.function==@as(t.FunctionRef,@enumFromInt(index)) and call.block==@as(t.BlockRef,@enumFromInt(b)) and call.instruction==i);
                        const target: usize=if(index==1)2 else 1;
                        try std.testing.expect(call.targets.len==1 and call.targets[0]==@as(t.FunctionRef,@enumFromInt(target)) and std.mem.eql(u8,&call.signature,&signature));
                        try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(op.operands[0])].carrier,callable_carrier));
                        const abi=common.abis[target];
                        try std.testing.expect(abi.receiver==null and abi.lexical_environment==null and abi.physical_parameters.len==0 and abi.result==null);
                    },
                    .eh_carrier => |view| {
                        try std.testing.expect(view==null and op.result!=null and op.operands.len==1);
                        try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(op.operands[0])].carrier,sc));
                        try std.testing.expect(f.registers[@intFromEnum(op.result.?)].carrier==.payload);
                    },
                    .br => |v| {
                        const destination=try c.ref(v.destination,f.blocks.len);
                        try std.testing.expect(i+1==block.instructions.len and op.result==null);
                        if (op.operands.len!=0) {
                            if (index==1) {
                                try std.testing.expect(destination==1 and std.mem.eql(t.RegisterRef,op.operands,&.{r1}));
                                try std.testing.expectEqualSlices(t.RegisterRef,&.{r2},f.blocks[destination].parameters);
                            } else {
                                try std.testing.expect(destination==3 and std.mem.eql(t.RegisterRef,op.operands,&.{r2}));
                                try std.testing.expectEqualSlices(t.RegisterRef,&.{r3},f.blocks[destination].parameters);
                            }
                        }
                    },
                    .cond_br => |v| {
                        const yes=try c.ref(v.true_destination,f.blocks.len);
                        const no=try c.ref(v.false_destination,f.blocks.len);
                        try std.testing.expect(i+1==block.instructions.len and op.result==null);
                        if (v.true_count==0) try std.testing.expectEqual(@as(usize,1),op.operands.len) else {
                            if (index==1) {
                                try std.testing.expect(yes==1 and no==1 and v.true_count==1);
                                try std.testing.expectEqualSlices(t.RegisterRef,&.{r3,r1,r2},op.operands);
                            } else {
                                try std.testing.expect(yes==3 and no==3 and v.true_count==1);
                                try std.testing.expectEqualSlices(t.RegisterRef,&.{saved_condition,r2,r3},op.operands);
                            }
                            try std.testing.expectEqualSlices(t.RegisterRef,&.{saved_tail},f.blocks[yes].parameters);
                        }
                    },
                    .@"return" => {
                        const abi=common.abis[@intFromEnum(f.abi)];
                        try std.testing.expect(i+1==block.instructions.len and op.result==null);
                        if(abi.result_carrier) |result| {
                            try std.testing.expectEqual(@as(usize,1),op.operands.len);
                            try std.testing.expect(std.meta.eql(f.registers[@intFromEnum(op.operands[0])].carrier,result));
                        } else try std.testing.expectEqual(@as(usize,0),op.operands.len);
                    },
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
    try prerequisites(&c,false);
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
test "module call rejects a callee-only ordinary write before initialization" { try check(.store_before_init,true); }
test "module call accepts ordinary write after initialization" { try check(.store_after_init,false); }
test "module call rejects a reachable multi-block read before initialization" { try check(.multiblock_read_before_init,true); }
test "module call keeps a multi-block callee's scalar result after initialization" { try check(.multiblock_read_after_init,false); }
test "module call ignores a Global read in a disconnected callee block" { try check(.multiblock_unreachable,false); }
test "module call checks a Global read on one reachable callee branch" { try check(.multiblock_branch_before_init,true); }
test "module call accepts a branched callee after initialization" { try check(.multiblock_branch_after_init,false); }
test "module call rejects a reachable multi-block write before initialization" { try check(.multiblock_store_before_init,true); }
test "module call accepts a reachable multi-block write after initialization" { try check(.multiblock_store_after_init,false); }
test "module call rejects a Global read on the exceptional callee edge before initialization" { try check(.multiblock_exception_before_init,true); }
test "module call accepts an initialized Global read on the exceptional callee edge" { try check(.multiblock_exception_after_init,false); }
test "module call rejects a transitive Global read before initialization" { try check(.nested_before_init,true); }
test "module call accepts a transitive Global read after initialization" { try check(.nested_after_init,false); }
test "module call rejects a transitive read through a recursive call graph" { try check(.recursive_before_init,true); }
test "module call accepts a recursive call graph with its observed Global initialized" { try check(.recursive_after_init,false); }

const foreign_source: t.SourceRef = @enumFromInt(1);
const owner_path = "/module-call-initialized.ts";
const foreign_path = "/module-call-relay.ts";
const foreign_anchor: t.Origin = .{ .source=foreign_source,.start=0,.end=100 };
const foreign_initializer: t.Hash = @splat(0x33);
const owner_module: t.Hash = @splat(0x50);
const foreign_module: t.Hash = @splat(0x51);
const Global = @typeInfo(@FieldType(tables.CommonModules,"globals")).pointer.child;
const Module = @typeInfo(@FieldType(tables.CommonModules,"modules")).pointer.child;
const cross_modules = [_]Module{
    .{ .id=owner_module,.source=@enumFromInt(0),.external=true,.initializer=@enumFromInt(0),.dependencies=&.{@enumFromInt(1)},.globals=&.{@enumFromInt(0)},
       .imports=&.{.{ .kind=.import,.specifier="./module-call-relay",.source=foreign_source,.bindings=&.{
           .{ .imported="relay",.kind=.function,.name="relay",.target=f1,.target_source=foreign_source },
           .{ .imported="g1",.kind=.global,.name="g1",.target=g1,.target_source=foreign_source },
       } }},.exports=&.{.{ .kind=.function,.name="observe",.target=f2,.target_source=@enumFromInt(0) }} },
    .{ .id=foreign_module,.source=foreign_source,.external=true,.initializer=@enumFromInt(3),.dependencies=&.{@enumFromInt(0)},.globals=&.{@enumFromInt(1)},
       .imports=&.{.{ .kind=.import,.specifier="./module-call-initialized",.source=@enumFromInt(0),.bindings=&.{
           .{ .imported="observe",.kind=.function,.name="observe",.target=f2,.target_source=@enumFromInt(0) },
       } }},.exports=&.{
           .{ .kind=.function,.name="relay",.target=f1,.target_source=foreign_source },
           .{ .kind=.global,.name="g1",.target=g1,.target_source=foreign_source },
       } },
};
const cross_scope_modules = [_]publication.ScopeModule{
    .{ .id=owner_module,.source_path=owner_path,.external=true,.initializer=f0,.dependencies=&.{foreign_path},.globals=&.{g0},
       .imports=&.{.{ .kind=.import,.specifier="./module-call-relay",.source_path=foreign_path,.bindings=&.{
           .{ .imported="relay",.kind=.function,.name="relay",.target=f1,.target_source_path=foreign_path },
           .{ .imported="g1",.kind=.global,.name="g1",.target=g1,.target_source_path=foreign_path },
       } }},.exports=&.{.{ .kind=.function,.name="observe",.target=f2,.target_source_path=owner_path }} },
    .{ .id=foreign_module,.source_path=foreign_path,.external=true,.initializer=foreign_initializer,.dependencies=&.{owner_path},.globals=&.{g1},
       .imports=&.{.{ .kind=.import,.specifier="./module-call-initialized",.source_path=owner_path,.bindings=&.{
           .{ .imported="observe",.kind=.function,.name="observe",.target=f2,.target_source_path=owner_path },
       } }},.exports=&.{
           .{ .kind=.function,.name="relay",.target=f1,.target_source_path=foreign_path },
           .{ .kind=.global,.name="g1",.target=g1,.target_source_path=foreign_path },
       } },
};
const cross_dependencies = nested_dependencies ++ [_]Dependency{
    .{ .function_id=foreign_initializer,.callees=&.{},.hosts=&.{} },
};
const CrossCase = enum { read_before, read_after, write_before, write_after, foreign_read };
const CrossFixture = struct {
    base: Fixture,
    functions: [4]wire.Function,
    abis: [4]storage.CommonAbi,
    sources: [2]tables.Source,
    globals: [2]Global,
    foreign_ops: [3]ins.Instruction,
    foreign_blocks: [1]wire.Block,

    fn init(self: *CrossFixture, case: CrossCase) void {
        self.base.init(if(case==.read_after or case==.write_after).nested_after_init else .nested_before_init);
        self.sources=.{self.base.sources[0],.{ .hash=@splat(0x20),.path=foreign_path,.length=100 }};
        self.functions[0..3].*=self.base.functions;
        self.functions[1].source=foreign_source;
        self.functions[1].name="relay";
        self.functions[2].name="observe";
        for(self.base.callee_instructions[0..4]) |*op| op.source=foreign_anchor;
        if(case==.write_before or case==.write_after){
            self.base.other_instructions[0..4].*=.{entry_fuel,constant,store0,ret};
            self.base.other_blocks[0].instructions=self.base.other_instructions[0..4];
        }else if(case==.foreign_read)self.base.other_instructions[1]=load1;
        self.foreign_ops=.{constant,init0,ret};
        for(&self.foreign_ops) |*op| op.source=foreign_anchor;
        self.foreign_ops[1].data.global_store.global=@enumFromInt(1);
        self.foreign_blocks=.{.{ .parameters=&empty,.instructions=&self.foreign_ops }};
        self.functions[3]=self.functions[0];
        self.functions[3].id=foreign_initializer;
        self.functions[3].abi=@enumFromInt(3);
        self.functions[3].source=foreign_source;
        self.functions[3].registers=callee_registers[0..1];
        self.functions[3].blocks=&self.foreign_blocks;
        self.abis[0..3].*=self.base.abis;
        self.abis[3]=self.abis[0];
        self.abis[3].function=@enumFromInt(3);
        self.base.bindings[1].origin=foreign_anchor;
        var common=&self.base.program.tables.mode.common;
        self.globals=common.modules.globals[0..2].*;
        self.globals[1].source=foreign_source;
        self.globals[1].decl_key.source_path=foreign_path;
        common.abis=&self.abis;
        common.modules.globals=&self.globals;
        common.modules.modules=&cross_modules;
        common.modules.initialization=&.{@enumFromInt(1),@enumFromInt(0)};
        common.exceptions.functions=&.{
            .{ .function=@enumFromInt(0),.handlers=&.{} },.{ .function=@enumFromInt(1),.handlers=&.{} },
            .{ .function=@enumFromInt(2),.handlers=&.{} },.{ .function=@enumFromInt(3),.handlers=&.{} },
        };
        common.authority.fixed_publication.stable_scope.root_file=owner_path;
        common.authority.fixed_publication.stable_scope.modules=&cross_scope_modules;
        common.authority.fixed_publication.dependencies=&cross_dependencies;
        self.base.program.tables.sources=&self.sources;
        self.base.program.functions=&self.functions;
    }
};

fn checkCrossModule(case: CrossCase, rejected: bool) !void {
    var fixture: CrossFixture=undefined;
    fixture.init(case);
    var c=context.Context{ .program=&fixture.base.program,.allocator=std.testing.allocator };
    try prerequisites(&c,true);
    // This verifies exact Source owners, reciprocal import/export relations,
    // initializer ABI and the cycle-tolerant initialization order independently.
    try module_contracts.checkModules(&c);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
    try std.testing.expect(c.remaining>0 and c.remaining<wire.format.max_work);
}
test "module callback rejects an owned Global read before initialization" { try checkCrossModule(.read_before,true); }
test "module callback accepts an initialized owned Global read" { try checkCrossModule(.read_after,false); }
test "module callback rejects an owned Global write before initialization" { try checkCrossModule(.write_before,true); }
test "module callback accepts an initialized owned Global write" { try checkCrossModule(.write_after,false); }
test "module callback leaves a foreign Global outside the caller initialization proof" { try checkCrossModule(.foreign_read,false); }

const Concrete = @typeInfo(@FieldType(storage.CommonStorage,"concrete")).pointer.child;
const FixedCall = @typeInfo(@FieldType(@FieldType(tables.CommonTables,"closures"),"calls")).pointer.child;
const SavedCodeTransport = enum { literal, copy, view, copy_view };
const BlockCodeTransport = enum { single, single_view, parallel, distinct };
const saved_tail: t.RegisterRef = @enumFromInt(4);
const saved_condition: t.RegisterRef = @enumFromInt(5);
const code_register: wire.Register = .{ .carrier=callable_carrier,.view=callable_type };
const saved_registers = [_]wire.Register{caller_registers[0],caller_registers[1],code_register,code_register,code_register};
const block_code_registers = saved_registers ++ [_]wire.Register{caller_registers[2]};
const make_saved: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&empty,.data=.{ .function_make=.{ .function=@enumFromInt(1) } } };
const forward_saved: ins.Instruction = .{ .source=anchor,.result=r3,.operands=&.{r2},.data=.{ .domain_copy=.{ .static_view=callable_type } } };
const view_saved: ins.Instruction = .{ .source=anchor,.result=r3,.operands=&.{r2},.data=.{ .domain_view=.{ .static_view=callable_type } } };
const view_copied: ins.Instruction = .{ .source=anchor,.result=saved_tail,.operands=&.{r3},.data=view_saved.data };
const invoke_saved: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{r2},
    .data=.{ .eh_invoke_indirect=.{ .callable=callable_type,.normal=@enumFromInt(1),.exceptional=@enumFromInt(2) } } };
const invoke_forwarded: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{r3},.data=invoke_saved.data };
const invoke_copied_view: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{saved_tail},.data=invoke_saved.data };
const enter_code_block: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{r2},
    .data=.{ .br=.{ .destination=@enumFromInt(3) } } };
const choose_code: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{saved_condition,r2,r3},
    .data=.{ .cond_br=.{ .true_destination=@enumFromInt(3),.false_destination=@enumFromInt(3),.true_count=1 } } };
const code_condition: ins.Instruction = .{ .source=anchor,.result=saved_condition,.operands=&empty,.data=bool_op.data };
const make_second_code: ins.Instruction = .{ .source=anchor,.result=r3,.operands=&empty,.data=make_saved.data };

const SavedCodeFixture = struct {
    types: [4]tables.CommonType,
    concrete: [4]Concrete,
    calls: [1]FixedCall,

    fn installTypes(self: *SavedCodeFixture, base: *Fixture) void {
        const common=&base.program.tables.mode.common;
        self.types=base.types ++ [_]tables.CommonType{
            .{ .id=@splat(0x13),.kind=.@"void",.name="void",.native_code=0,.base=null,.element=null,.members=&.{},.methods=null,.nominal_key=null,.runtime_key=null },
            .{ .id=@splat(0x14),.kind=.function,.name="observe",.native_code=0,.base=null,.element=void_type,.members=&.{},.methods=null,.nominal_key=null,.runtime_key=null },
        };
        self.concrete=common.storage.concrete[0..2].* ++ [_]Concrete{
            .{ .@"type"=void_type,.carrier=.{ .layout=.{ .byte_size=0,.alignment=1,.reference_count=0 },.field_offsets=&.{} },.body=null },
            .{ .@"type"=callable_type,.carrier=.{ .layout=.{ .byte_size=40,.alignment=8,.reference_count=1 },.field_offsets=&.{} },.body=null },
        };
        common.types=&self.types;
        common.storage.concrete=&self.concrete;
        common.closures.calls=&self.calls;
    }

    fn install(self: *SavedCodeFixture, base: *Fixture, caller: *wire.Function, comptime initialized: bool, comptime transport: SavedCodeTransport) void {
        self.installTypes(base);
        const prefix = if (initialized) [_]ins.Instruction{constant,init0,make_saved} else [_]ins.Instruction{constant,make_saved};
        const suffix = switch (transport) {
            .literal => [_]ins.Instruction{invoke_saved},
            .copy => [_]ins.Instruction{forward_saved,invoke_forwarded},
            .view => [_]ins.Instruction{view_saved,invoke_forwarded},
            .copy_view => [_]ins.Instruction{forward_saved,view_copied,invoke_copied_view},
        };
        const instructions = &(prefix ++ suffix);
        base.blocks[0].instructions=instructions;
        caller.registers=saved_registers[0..switch (transport) { .literal => 3, .copy,.view => 4, .copy_view => 5 }];
        self.calls=.{.{ .function=@enumFromInt(0),.block=@enumFromInt(0),.instruction=@intCast(instructions.len-1),
            .signature=signature,.targets=&.{@enumFromInt(1)} }};
    }

    fn installBlock(self: *SavedCodeFixture, base: *Fixture, caller: *wire.Function, comptime initialized: bool, comptime transport: BlockCodeTransport) void {
        self.install(base,caller,initialized,.literal);
        const prefix = if (initialized) [_]ins.Instruction{constant,init0,make_saved} else [_]ins.Instruction{constant,make_saved};
        const suffix = switch (transport) {
            .single,.single_view => [_]ins.Instruction{enter_code_block},
            .parallel => [_]ins.Instruction{code_condition,forward_saved,choose_code},
            .distinct => [_]ins.Instruction{code_condition,make_second_code,choose_code},
        };
        const completion: []const ins.Instruction = switch (transport) {
            .single => &.{invoke_forwarded},
            .single_view => &.{view_copied,invoke_copied_view},
            .parallel,.distinct => &.{invoke_copied_view},
        };
        base.blocks[0].instructions=&(prefix ++ suffix);
        base.blocks[3]=.{
            .parameters=switch (transport) { .single,.single_view => &.{r3}, .parallel,.distinct => &.{saved_tail} },
            .instructions=completion,
        };
        caller.blocks=base.blocks[0..4];
        caller.registers=block_code_registers[0..switch (transport) { .single => 4,.single_view => 5,.parallel,.distinct => 6 }];
        self.calls[0].block=@enumFromInt(3);
        self.calls[0].instruction=@intCast(completion.len-1);
    }
};

fn checkSavedCode(case: Case, comptime initialized: bool, comptime transport: SavedCodeTransport, rejected: bool) !void {
    var fixture: Fixture=undefined;
    fixture.init(case);
    var saved: SavedCodeFixture=undefined;
    saved.install(&fixture,&fixture.functions[0],initialized,transport);
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try prerequisites(&c,false);
    var fixed=try fixed_targets.analyze(&c);
    defer fixed.deinit(c.allocator);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
}

test "module fixed Code rejects a read before initialization" { try checkSavedCode(.before_init,false,.literal,true); }
test "module fixed Code accepts an initialized read" { try checkSavedCode(.after_init,true,.literal,false); }
test "module fixed Code rejects a write before initialization" { try checkSavedCode(.store_before_init,false,.literal,true); }
test "module fixed Code accepts an initialized write" { try checkSavedCode(.store_after_init,true,.literal,false); }
test "module fixed Code uses the saved FunctionRef over an uncalled same-name target" { try checkSavedCode(.other_callee,false,.literal,false); }
test "module fixed Code copy still requires initialization before a read" { try checkSavedCode(.before_init,false,.copy,true); }
test "module fixed Code copy allows an initialized read" { try checkSavedCode(.after_init,true,.copy,false); }
test "module fixed Code view still requires initialization before a write" { try checkSavedCode(.store_before_init,false,.view,true); }
test "module fixed Code view allows an initialized write" { try checkSavedCode(.store_after_init,true,.view,false); }
test "module fixed Code copy followed by a view keeps the exact target" { try checkSavedCode(.before_init,false,.copy_view,true); }

fn checkBlockCode(case: Case, comptime initialized: bool, comptime transport: BlockCodeTransport, rejected: bool) !void {
    var fixture: Fixture=undefined;
    fixture.init(case);
    var saved: SavedCodeFixture=undefined;
    saved.installBlock(&fixture,&fixture.functions[0],initialized,transport);
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try prerequisites(&c,false);
    var fixed=try fixed_targets.analyze(&c);
    defer fixed.deinit(c.allocator);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
}

test "module fixed Code block parameter requires initialization before a read" { try checkBlockCode(.before_init,false,.single,true); }
test "module fixed Code block parameter allows a prior initialized read" { try checkBlockCode(.after_init,true,.single,false); }
test "module fixed Code view of a block parameter retains the literal" { try checkBlockCode(.before_init,false,.single_view,true); }
test "module fixed Code requires initialization on parallel edges carrying one literal" { try checkBlockCode(.store_before_init,false,.parallel,true); }
test "module fixed Code parallel edges allow a prior initialized write" { try checkBlockCode(.store_after_init,true,.parallel,false); }
test "module fixed Code parallel edges distinguish separate literals for one target" { try checkBlockCode(.before_init,false,.distinct,false); }

const NestedCodeTransport = enum { literal, copy, view };

fn checkNestedCode(initialized: bool, write: bool, comptime transport: NestedCodeTransport, rejected: bool) !void {
    var fixture: Fixture=undefined;
    fixture.init(if(initialized).nested_after_init else .nested_before_init);
    var saved: SavedCodeFixture=undefined;
    saved.installTypes(&fixture);
    const call_position = if (transport == .literal) 2 else 3;
    saved.calls=.{.{ .function=@enumFromInt(1),.block=@enumFromInt(0),.instruction=call_position,
        .signature=signature,.targets=&.{@enumFromInt(2)} }};
    const alias: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&language,
        .data=if(transport==.copy)forward_saved.data else view_saved.data };
    const prefix = if (transport == .literal) [_]ins.Instruction{entry_fuel,make_saved} else [_]ins.Instruction{entry_fuel,make_saved,alias};
    fixture.callee_instructions[0..call_position+3].* = prefix ++ [_]ins.Instruction{invoke_saved,ret,raise};
    fixture.callee_instructions[1].result=r1;
    fixture.callee_instructions[1].data.function_make.function=@enumFromInt(2);
    fixture.callee_instructions[call_position].operands=if(transport==.literal)&language else &.{r2};
    fixture.callee_instructions[call_position+2].operands=&value;
    fixture.callee_blocks[0].instructions=fixture.callee_instructions[0..call_position+1];
    fixture.callee_blocks[1].instructions=fixture.callee_instructions[call_position+1..call_position+2];
    fixture.callee_blocks[2].instructions=fixture.callee_instructions[call_position+2..call_position+3];
    fixture.functions[1].registers=if(transport==.literal)&.{caller_registers[1],code_register} else &.{caller_registers[1],code_register,code_register};
    if(write) {
        fixture.other_instructions[0..4].*=.{entry_fuel,constant,store0,ret};
        fixture.other_blocks[0].instructions=fixture.other_instructions[0..4];
    }
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try prerequisites(&c,false);
    var fixed=try fixed_targets.analyze(&c);
    defer fixed.deinit(c.allocator);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
}

test "module nested literal Code requires initialization before a read" { try checkNestedCode(false,false,.literal,true); }
test "module nested literal Code allows an initialized read" { try checkNestedCode(true,false,.literal,false); }
test "module nested literal Code requires initialization before a write" { try checkNestedCode(false,true,.literal,true); }
test "module nested literal Code allows an initialized write" { try checkNestedCode(true,true,.literal,false); }
test "module nested Code copy requires initialization before a read" { try checkNestedCode(false,false,.copy,true); }
test "module nested Code copy allows an initialized read" { try checkNestedCode(true,false,.copy,false); }
test "module nested Code view requires initialization before a write" { try checkNestedCode(false,true,.view,true); }
test "module nested Code view allows an initialized write" { try checkNestedCode(true,true,.view,false); }

const NestedCfgTransport = enum { parameter, parallel, distinct, dominating };

fn checkNestedCfgCode(initialized: bool, write: bool, comptime transport: NestedCfgTransport, rejected: bool) !void {
    var fixture: Fixture=undefined;
    fixture.init(if(initialized).nested_after_init else .nested_before_init);
    var saved: SavedCodeFixture=undefined;
    saved.installTypes(&fixture);
    saved.calls=.{.{ .function=@enumFromInt(1),.block=@enumFromInt(1),.instruction=0,
        .signature=signature,.targets=&.{@enumFromInt(2)} }};
    const literal: ins.Instruction = .{ .source=anchor,.result=r1,.operands=&empty,
        .data=.{ .function_make=.{ .function=@enumFromInt(2) } } };
    const alternate: ins.Instruction = .{ .source=anchor,.result=r2,.operands=if(transport==.distinct)&empty else &.{r1},
        .data=if(transport==.distinct)literal.data else forward_saved.data };
    const choose_condition: ins.Instruction = .{ .source=anchor,.result=r3,.operands=&empty,.data=bool_op.data };
    const parallel: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{r3,r1,r2},
        .data=.{ .cond_br=.{ .true_destination=@enumFromInt(1),.false_destination=@enumFromInt(1),.true_count=1 } } };
    const branch: ins.Instruction = .{ .source=anchor,.result=null,.operands=if(transport==.parameter)&.{r1} else &empty,.data=next_block.data };
    const entry = switch (transport) {
        .parameter,.dominating => [_]ins.Instruction{entry_fuel,literal,branch},
        .parallel,.distinct => [_]ins.Instruction{entry_fuel,literal,alternate,choose_condition,parallel},
    };
    const receiver: t.RegisterRef = switch (transport) {
        .parameter => r2,
        .parallel,.distinct => saved_tail,
        .dominating => r1,
    };
    const indirect: ins.Instruction = .{ .source=anchor,.result=null,.operands=&.{receiver},
        .data=.{ .eh_invoke_indirect=.{ .callable=callable_type,.normal=@enumFromInt(2),.exceptional=@enumFromInt(3) } } };
    const reraised: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.eh_raise };
    const blocks = [_]wire.Block{
        .{ .parameters=&empty,.instructions=&entry },
        .{ .parameters=if(transport==.dominating)&empty else &.{receiver},.instructions=&.{indirect} },
        .{ .parameters=&empty,.instructions=&.{ret} },
        .{ .parameters=&value,.instructions=&.{reraised} },
    };
    fixture.functions[1].blocks=&blocks;
    fixture.functions[1].registers=switch(transport) {
        .parameter => &.{caller_registers[1],code_register,code_register},
        .parallel,.distinct => &.{caller_registers[1],code_register,code_register,caller_registers[2],code_register},
        .dominating => &.{caller_registers[1],code_register},
    };
    if(write) {
        fixture.other_instructions[0..4].*=.{entry_fuel,constant,store0,ret};
        fixture.other_blocks[0].instructions=fixture.other_instructions[0..4];
    }
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try prerequisites(&c,false);
    var fixed=try fixed_targets.analyze(&c);
    defer fixed.deinit(c.allocator);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
}

test "module nested Code block parameter requires initialization before a read" { try checkNestedCfgCode(false,false,.parameter,true); }
test "module nested Code block parameter allows an initialized read" { try checkNestedCfgCode(true,false,.parameter,false); }
test "module nested Code parallel edges carrying one definition require initialization before a write" { try checkNestedCfgCode(false,true,.parallel,true); }
test "module nested Code parallel edges allow an initialized write" { try checkNestedCfgCode(true,true,.parallel,false); }
test "module nested Code parallel edges distinguish separate literals for one target" { try checkNestedCfgCode(false,false,.distinct,false); }
test "module nested Code definition in a dominating block requires initialization before a read" { try checkNestedCfgCode(false,false,.dominating,true); }
test "module nested Code definition in a dominating block allows an initialized read" { try checkNestedCfgCode(true,false,.dominating,false); }

test "module fixed Code leaves foreign Globals to the verified module order" {
    var fixture: CrossFixture=undefined;
    fixture.init(.foreign_read);
    var saved: SavedCodeFixture=undefined;
    saved.install(&fixture.base,&fixture.functions[0],false,.literal);
    var c=context.Context{ .program=&fixture.base.program,.allocator=std.testing.allocator };
    try prerequisites(&c,true);
    try module_contracts.checkModules(&c);
    var fixed=try fixed_targets.analyze(&c);
    defer fixed.deinit(c.allocator);
    try ssa.check(&c);
}
