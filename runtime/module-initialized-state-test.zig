// SPDX-License-Identifier: MIT
// Independent handwritten typed metadata. No packet, Source, decoder, Runtime
// wrapper, aggregate admission, State, VM or guest execution is used here.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
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
const sc: t.Carrier = .{ .@"type" = scalar };
const bc: t.Carrier = .{ .@"type" = boolean };
const anchor: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 100 };
const empty = [_]t.RegisterRef{};
const value = [_]t.RegisterRef{r0};
const condition = [_]t.RegisterRef{r1};
const registers = [_]wire.Register{.{ .carrier=sc,.view=scalar },.{ .carrier=bc,.view=boolean },.{ .carrier=sc,.view=scalar }};
const constant: ins.Instruction = .{ .source=anchor,.result=r0,.operands=&empty,.data=.{ .const_i32=7 } };
const bool_op: ins.Instruction = .{ .source=anchor,.result=r1,.operands=&empty,.data=.{ .const_bool=true } };
const init0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=true } } };
const init1: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(1),.initialize=true } } };
const load0: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(0) } } };
const load1: ins.Instruction = .{ .source=anchor,.result=r2,.operands=&empty,.data=.{ .global_load=.{ .global=@enumFromInt(1) } } };
const store0: ins.Instruction = .{ .source=anchor,.result=null,.operands=&value,.data=.{ .global_store=.{ .global=@enumFromInt(0),.initialize=false } } };
const ret: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.@"return" };
const loop_fuel: ins.Instruction = .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .fuel=.{ .event=.condition } } };
const Case = enum { linear, diamond, stable_loop, double, missing_arm, before_init, ordinary_store, wrong_binding, repeated_loop, unreachable_repeat };
const Fixture = struct {
    program: wire.Program,
    instructions: [16]ins.Instruction,
    blocks: [4]wire.Block,
    functions: [1]wire.Function,
    abis: [1]storage.CommonAbi,
    bindings: [2]storage.CommonBinding,
    sources: [1]tables.Source,
    types: [2]tables.CommonType,
    fn init(self: *Fixture, case: Case) void {
        self.sources=.{.{ .hash=@splat(0x10),.path="/module-initialized-state.ts",.length=100 }};
        const base_type: tables.CommonType=.{ .id=@splat(0x11),.kind=.scalar,.name="i32",.native_code=1,.base=null,.element=null,.members=&.{},.methods=null,.nominal_key=null,.runtime_key=null };
        self.types=.{base_type,base_type}; self.types[1].id=@splat(0x12); self.types[1].name="bool"; self.types[1].native_code=2;
        self.bindings=.{
            .{ .id="g0",.owner=.{ .global=@enumFromInt(0) },.name="g0",.@"type"=scalar,.writable=true,.origin=anchor,.carrier=sc,.scope=null,.declaration_kind=null },
            .{ .id="g1",.owner=.{ .global=@enumFromInt(1) },.name="g1",.@"type"=scalar,.writable=true,.origin=anchor,.carrier=sc,.scope=null,.declaration_kind=null },
        };
        self.abis=.{.{ .kind=.common,.function=@enumFromInt(0),.signature=@splat(0x22),.parameters=&.{},.argument_types=&.{},.receiver=null,.construction=null,.receiver_frame=null,.lexical_environment=null,.physical_parameters=&.{},.result=null,.result_carrier=null,.source_plan=.{ .carriers=&.{},.blocks=&.{} } }};
        self.instructions[0..6].*=.{constant,bool_op,init0,init1,load0,ret};
        self.blocks[0]=.{ .parameters=&empty,.instructions=self.instructions[0..6] };
        var count: usize=1;
        switch(case) {
            .linear => {},
            .double => { self.instructions[0..7].*=.{constant,bool_op,init0,init0,init1,load0,ret}; self.blocks[0].instructions=self.instructions[0..7]; },
            .before_init => { self.instructions[0..6].*=.{constant,bool_op,load0,init0,init1,ret}; },
            .ordinary_store => { self.instructions[0..7].*=.{constant,bool_op,store0,init0,init1,load0,ret}; self.blocks[0].instructions=self.instructions[0..7]; },
            .wrong_binding => { self.instructions[0..5].*=.{constant,bool_op,init0,load1,ret}; self.blocks[0].instructions=self.instructions[0..5]; },
            .diamond,.missing_arm => {
                count=4;
                self.instructions[0..10].*=.{constant,bool_op,init1,
                    .{ .source=anchor,.result=null,.operands=&condition,.data=.{ .cond_br=.{ .true_destination=@enumFromInt(1),.false_destination=@enumFromInt(2),.true_count=0 } } },
                    init0,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(3) } } },
                    init0,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(3) } } },load0,ret};
                self.blocks=.{ .{ .parameters=&empty,.instructions=self.instructions[0..4] },.{ .parameters=&empty,.instructions=self.instructions[4..6] },.{ .parameters=&empty,.instructions=self.instructions[6..8] },.{ .parameters=&empty,.instructions=self.instructions[8..10] } };
                if(case==.missing_arm)self.blocks[2].instructions=self.instructions[7..8];
            },
            .stable_loop,.repeated_loop => {
                count=3;
                const repeated=case==.repeated_loop;
                self.instructions[0..10].*=.{constant,bool_op,init1,init0,
                    .{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(1) } } },loop_fuel,init0,
                    .{ .source=anchor,.result=null,.operands=&condition,.data=.{ .cond_br=.{ .true_destination=@enumFromInt(1),.false_destination=@enumFromInt(2),.true_count=0 } } },load0,ret};
                if(repeated)self.instructions[3]=self.instructions[4];
                self.blocks[0]=.{ .parameters=&empty,.instructions=self.instructions[0..if(repeated)4 else 5] };
                if(!repeated)self.instructions[6]=self.instructions[7];
                self.blocks[1]=.{ .parameters=&empty,.instructions=self.instructions[5..if(repeated)8 else 7] };
                self.blocks[2]=.{ .parameters=&empty,.instructions=self.instructions[8..10] };
            },
            .unreachable_repeat => {
                count=2;
                self.instructions[6..9].*=.{loop_fuel,init0,.{ .source=anchor,.result=null,.operands=&empty,.data=.{ .br=.{ .destination=@enumFromInt(1) } } }};
                self.blocks[1]=.{ .parameters=&empty,.instructions=self.instructions[6..9] };
            },
        }
        self.functions=.{.{ .id=@splat(0x33),.signature=@splat(0x22),.abi=@enumFromInt(0),.source=@enumFromInt(0),.role=.module_initializer,.declaration=.{ .start=0,.end=100 },.name="$moduleInit",.registers=&registers,.blocks=self.blocks[0..count] }};
        var common=std.mem.zeroes(tables.CommonTables); common.types=&self.types; common.abis=&self.abis; common.storage.bindings=&self.bindings;
        common.storage.payload=.{ .byte_size=16,.alignment=8,.reference_count=1 };
        common.storage.concrete=&.{ .{ .@"type"=scalar,.carrier=.{ .layout=.{ .byte_size=4,.alignment=4,.reference_count=0 },.field_offsets=&.{} },.body=null },.{ .@"type"=boolean,.carrier=.{ .layout=.{ .byte_size=1,.alignment=1,.reference_count=0 },.field_offsets=&.{} },.body=null } };
        common.modules.globals=&.{
            .{ .id=@splat(0x41),.source=@enumFromInt(0),.name="g0",.@"type"=scalar,.carrier=sc,.writable=true,.generated=false,.start=0,.end=100,.decl_key=.{ .kind=.global,.name="g0",.path=&.{"g0"},.source_path="/module-initialized-state.ts" },.binding=@enumFromInt(0) },
            .{ .id=@splat(0x42),.source=@enumFromInt(0),.name="g1",.@"type"=scalar,.carrier=sc,.writable=true,.generated=false,.start=0,.end=100,.decl_key=.{ .kind=.global,.name="g1",.path=&.{"g1"},.source_path="/module-initialized-state.ts" },.binding=@enumFromInt(1) },
        };
        common.modules.modules=&.{.{ .id=@splat(0x50),.source=@enumFromInt(0),.external=false,.initializer=@enumFromInt(0),.dependencies=&.{},.globals=&.{ @enumFromInt(0),@enumFromInt(1) },.imports=&.{},.exports=&.{} }};
        common.modules.initialization=&.{@enumFromInt(0)};
        self.program=.{ .envelope=std.mem.zeroes(wire.Envelope),.target=std.mem.zeroes(wire.Target),.input_identity=@splat(0),.source_hash=@splat(0),.source_path="",.source_length=0,.root_source=@enumFromInt(0),.tables=.{ .sources=&self.sources,.mode=.{ .common=common } },.functions=&self.functions };
    }
};
// Establish the refs/unique definitions and exact opcode shapes used by these
// literal fixtures before the real layout/SSA consumer. This is no packet claim.
fn preconditions(c: *context.Context) !void {
    const f=c.program.functions[0]; try c.anchor(f.declaration,f.source); _=try c.ref(f.abi,c.program.tables.mode.common.abis.len);
    var defined=[_]bool{false} ** registers.len;
    for(f.registers) |r| { try c.carrier(r.carrier); try c.maybeRef(r.view,c.counts().types); }
    for(f.blocks) |block| for(block.instructions,0..) |op,i| {
        try c.origin(op.source); if(op.result) |r| { const n=try c.ref(r,f.registers.len); try std.testing.expect(!defined[n]); defined[n]=true; }
        for(op.operands) |r| { _=try c.ref(r,f.registers.len); }
        switch(op.data) {
            .const_i32,.const_bool => try std.testing.expect(op.result!=null and op.operands.len==0),
            .global_store => |v| { _=try c.ref(v.global,c.counts().globals); try std.testing.expect(op.result==null and op.operands.len==1 and std.meta.eql(f.registers[@intFromEnum(op.operands[0])].carrier,sc)); },
            .global_load => |v| { _=try c.ref(v.global,c.counts().globals); try std.testing.expect(op.result!=null and op.operands.len==0 and std.meta.eql(f.registers[@intFromEnum(op.result.?)].carrier,sc)); },
            .br => |v| { _=try c.ref(v.destination,f.blocks.len); try std.testing.expect(i+1==block.instructions.len and op.operands.len==0 and op.result==null); },
            .cond_br => |v| { _=try c.ref(v.true_destination,f.blocks.len); _=try c.ref(v.false_destination,f.blocks.len); try std.testing.expect(i+1==block.instructions.len and op.operands.len==1 and v.true_count==0 and op.result==null); },
            .@"return" => try std.testing.expect(i+1==block.instructions.len and op.operands.len==0 and op.result==null),
            .fuel => try std.testing.expect(op.result==null and op.operands.len==0),
            else => return error.TestUnexpectedOpcode,
        }
    };
    for(defined) |present| try std.testing.expect(present);
    try layout.check(c);
}
fn check(case: Case, rejected: bool) !void {
    var fixture: Fixture=undefined; fixture.init(case);
    var c=context.Context{ .program=&fixture.program,.allocator=std.testing.allocator };
    try preconditions(&c);
    if(rejected)try std.testing.expectError(error.InvalidShape,ssa.check(&c)) else try ssa.check(&c);
    try std.testing.expect(c.remaining>0 and c.remaining<wire.format.max_work);
}
test "module cell accepts one init before observation" { try check(.linear,false); }
test "module cell accepts mutually exclusive init arms" { try check(.diamond,false); }
test "module cell accepts initialized loop without reinitialization" { try check(.stable_loop,false); }
test "module cell rejects two consecutive initializations" { try check(.double,true); }
test "module cell rejects an uninitialized merge arm" { try check(.missing_arm,true); }
test "module cell rejects observation preceding initialization" { try check(.before_init,true); }
test "module cell ordinary assignment cannot initialize" { try check(.ordinary_store,true); }
test "module cells do not borrow another binding initialization" { try check(.wrong_binding,true); }
test "module cell rejects repeated initialization through a backedge" { try check(.repeated_loop,true); }
test "module cell retains unreachable original CFG without inventing an entry" { try check(.unreachable_repeat,false); }
