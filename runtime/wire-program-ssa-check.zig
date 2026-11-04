// SPDX-License-Identifier: MIT
// Independent CFG/SSA checks of an owned, reference/layout-checked Program.
// This is not a decoder, Source proof, actual-capacity/effects/borrow solver or
// crypto/Runtime admission. The caller lends its existing, non-refillable meter.
const std = @import("std");
const model = @import("wire-program-model.zig");
const t = model.types;
const ins = model.instruction;
const table = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const context = @import("wire-program-refcheck-context.zig");
const receiver_protocol = @import("wire-program-receiver-protocol-check.zig");
const Context = context.Context;
pub const Error = context.Error;
const Bits = [4]u64;
const zero: Bits = .{ 0, 0, 0, 0 };

fn put(bits: *Bits, index: usize) void { bits[index / 64] |= @as(u64, 1) << @as(u6, @intCast(index % 64)); }
fn has(bits: Bits, index: usize) bool { return bits[index / 64] & (@as(u64, 1) << @as(u6, @intCast(index % 64))) != 0; }
fn exact(a: t.Carrier, b: t.Carrier) bool { return std.meta.eql(a, b); }
fn ehCarrier(value: storage.ExceptionCarrier) t.Carrier {
    return switch (value) { .domain => |v| .{ .domain=v }, .@"type" => |v| .{ .@"type"=v }, .payload => .payload };
}
fn origin(a: *const ins.Instruction, b: *const ins.Instruction) bool { return std.meta.eql(a.source, b.source); }
fn anchorsEmpty(op: *const ins.Instruction) bool { return op.operator_anchor == null and op.target_anchor == null; }

const Definition = receiver_protocol.Definition;
const Use = struct { block: usize=0, position: usize=0, operand: usize=0, count: usize=0 };
const Facts = receiver_protocol.Facts;
const Predecessors = struct {
    bits: Bits, word: usize=0,
    fn next(self: *Predecessors, c: *Context) Error!?usize {
        while(self.word<4) {
            try c.step(); const value=self.bits[self.word];
            if(value!=0) {
                const bit: usize=@intCast(@ctz(value)); self.bits[self.word]=value&(value-1);
                return self.word*64+bit;
            }
            self.word+=1;
        }
        return null;
    }
};
const Graph = struct {
    c: *Context, f: *const model.Function, function: usize, mode: table.Mode,
    definitions: []Definition, uses: []Use, facts: []Facts, dom: []Bits, fully_reached: bool=false,
    has_environment_init: bool=false,
    has_environment_access: bool=false,

    fn init(c: *Context, index: usize) Error!Graph {
        const f=&c.program.functions[index];
        try c.charge(2*f.registers.len+f.blocks.len);
        const definitions=try c.allocator.alloc(Definition,f.registers.len); errdefer c.allocator.free(definitions);
        const uses=try c.allocator.alloc(Use,f.registers.len); errdefer c.allocator.free(uses); @memset(uses,.{});
        const facts=try c.allocator.alloc(Facts,f.blocks.len); errdefer c.allocator.free(facts); @memset(facts,.{});
        return .{.c=c,.f=f,.function=index,.mode=std.meta.activeTag(c.program.tables.mode),
            .definitions=definitions,.uses=uses,.facts=facts,.dom=&.{}};
    }
    fn deinit(self: *Graph) void {
        self.c.allocator.free(self.definitions); self.c.allocator.free(self.uses);
        self.c.allocator.free(self.facts); self.c.allocator.free(self.dom);
    }
    fn carrierOf(self: *const Graph, r: t.RegisterRef) t.Carrier { return self.f.registers[@intFromEnum(r)].carrier; }
    fn abiIndex(self: *const Graph, f: usize) usize { return @intFromEnum(self.c.program.functions[f].abi); }
    fn closure(self: *const Graph) bool {
        // The formal verifier dispatches the entire legacy Program through
        // the closure verifier when its function directory is nonempty.
        return self.mode==.legacy and self.c.program.tables.mode.legacy.closures.functions.len!=0;
    }
    fn same(self: *Graph, a: t.RegisterRef, b: t.RegisterRef) Error!void {
        try self.c.require(exact(self.carrierOf(a),self.carrierOf(b)) and
            (self.mode!=.exception or self.f.registers[@intFromEnum(a)].view==self.f.registers[@intFromEnum(b)].view));
    }
    fn primitive(self: *Graph, carrier: t.Carrier, code: u8) Error!bool {
        try self.c.step();
        return switch (self.c.program.tables.mode) {
            .common => |v| std.meta.activeTag(carrier)==.@"type" and v.types[@intFromEnum(carrier.@"type")].native_code==code,
            .legacy => |v| std.meta.activeTag(carrier)==.domain and v.domains[@intFromEnum(carrier.domain)].native_code==code,
            .exception => |v| std.meta.activeTag(carrier)==.@"type" and blk: {
                const row=v.types[@intFromEnum(carrier.@"type")];
                const name: []const u8=if(code==1) "i32" else "bool";
                try self.c.charge(1+name.len/64);
                break :blk row.kind==.scalar and std.mem.eql(u8,row.name,name);
            },
        };
    }
    fn includes(self: *Graph, target: t.Carrier, source: t.Carrier) Error!void {
        // Legacy finite branch/call domains may widen. Closures reconstruct
        // concrete MLIR types and therefore require exact carrier identity.
        if(self.mode!=.legacy or self.closure()) { try self.c.require(exact(target,source)); return; }
        try self.c.require(std.meta.activeTag(target)==.domain and std.meta.activeTag(source)==.domain);
        const rows=self.c.program.tables.mode.legacy.domains;
        const to=rows[@intFromEnum(target.domain)].alternatives;
        const from=rows[@intFromEnum(source.domain)].alternatives;
        for(from) |member| {
            try self.c.step(); var found=false;
            for(to) |allowed| { try self.c.step(); if(member==allowed) { found=true; break; } }
            try self.c.require(found);
        }
    }
    fn legacyType(self: *Graph, r: t.RegisterRef, expected: t.TypeRef) Error!void {
        const carrier=self.carrierOf(r); try self.c.require(std.meta.activeTag(carrier)==.domain);
        const alternatives=self.c.program.tables.mode.legacy.domains[@intFromEnum(carrier.domain)].alternatives;
        try self.c.require(alternatives.len==1 and alternatives[0]==expected);
    }
    fn branch(self: *Graph, target: usize, operands: []const t.RegisterRef) Error!void {
        const parameters=self.f.blocks[target].parameters;
        try self.c.require(parameters.len==operands.len);
        for(parameters,operands) |to,from| {
            try self.c.step();
            if(self.mode==.exception)try self.same(to,from) else try self.includes(self.carrierOf(to),self.carrierOf(from));
        }
    }
    fn directory(self: *Graph) Error!void {
        // Reference checking already proved uniqueness and total definitions.
        // Build locations once; do not repeat that boundary's hash directory.
        const c=self.c;
        for(self.f.blocks,0..) |block,b| {
            try c.step();
            for(block.parameters) |r| { try c.step(); self.definitions[@intFromEnum(r)]=.{.block=b,.position=-1}; }
            for(block.instructions,0..) |*op,i| {
                try c.step();
                if(op.result) |r| { try c.step(); self.definitions[@intFromEnum(r)]=.{.block=b,.position=@intCast(i)}; }
                for(op.operands,0..) |r,n| {
                    try c.step(); const use=&self.uses[@intFromEnum(r)];
                    if(use.count==0) { use.block=b; use.position=i; use.operand=n; } use.count+=1;
                }
            }
            const op=&block.instructions[block.instructions.len-1];
            const edges=&self.facts[b];
            switch(op.data) {
                .br => |v| { edges.count=1; edges.successors[0]=@intFromEnum(v.destination); },
                .cond_br => |v| { edges.count=2; edges.successors=.{@intFromEnum(v.true_destination),@intFromEnum(v.false_destination)}; },
                .domain_numeric_use => |v| { edges.count=1; edges.successors[0]=@intFromEnum(v.normal_successor); },
                inline .eh_invoke,.eh_invoke_indirect,.common_method_invoke => |v| { edges.count=2; edges.successors=.{@intFromEnum(v.normal),@intFromEnum(v.exceptional)}; },
                inline .receiver_bind,.receiver_get,.receiver_result => |v| { edges.count=2; edges.successors=.{@intFromEnum(v.normal),@intFromEnum(v.language)}; },
                .eh_route => |v| { edges.count=1; edges.successors[0]=@intFromEnum(v.successor); },
                else => {}, // All remaining typed opcodes have no CFG edges.
            }
            for(edges.successors[0..edges.count]) |next| {
                try c.require(next!=0); const incoming=&self.facts[next];
                if(self.mode!=.common or !has(incoming.predecessors,b))incoming.predecessor_count+=1;
                put(&incoming.predecessors,b);
            }
        }
    }
    fn reach(self: *Graph) Error!void {
        var pending: [256]usize=undefined; var size: usize=1; pending[0]=0; self.facts[0].reachable=true;
        var cursor: usize=0;
        while(cursor<size) : (cursor+=1) {
            try self.c.step(); const from=self.facts[pending[cursor]];
            for(from.successors[0..from.count]) |next| {
                try self.c.step(); if(!self.facts[next].reachable) { self.facts[next].reachable=true; pending[size]=next; size+=1; }
            }
        }
        self.fully_reached=size==self.facts.len;
        if(self.mode!=.common)try self.c.require(self.fully_reached);
    }
    fn dominance(self: *Graph, full: bool) Error![]Bits {
        const c=self.c; const words=(self.facts.len+63)/64; var all=zero;
        for(self.facts,0..) |fact,b| { try c.step(); if(full or fact.reachable)put(&all,b); }
        try c.charge(self.facts.len*words);
        const dom=try c.allocator.alloc(Bits,self.facts.len); errdefer c.allocator.free(dom);
        @memset(dom,all); dom[0]=zero; put(&dom[0],0);
        var changed=true;
        while(changed) {
            changed=false;
            for(self.facts[1..],1..) |fact,b| {
                try c.step(); if(!full and !fact.reachable)continue;
                var next=all;
                var predecessors=Predecessors{.bits=fact.predecessors};
                while(try predecessors.next(c)) |pred| {
                    if(!full and !self.facts[pred].reachable)continue;
                    for(0..words) |word| { try c.step(); next[word]&=dom[pred][word]; }
                }
                put(&next,b); try c.charge(words);
                if(!std.mem.eql(u64,&next,&dom[b])) { dom[b]=next; changed=true; }
            }
        }
        return dom;
    }
    fn usesDom(self: *Graph) Error!void {
        for(self.f.blocks,0..) |block,b| for(block.instructions,0..) |op,i| for(op.operands) |r| {
            try self.c.step(); const definition=self.definitions[@intFromEnum(r)];
            if(definition.block==b)try self.c.require(definition.position<@as(i32,@intCast(i)))
            else try self.c.require((self.mode==.common and !self.facts[b].reachable) or has(self.dom[b],definition.block));
        };
    }
    fn entryAbi(self: *Graph) Error!void {
        const c=self.c; const parameters=self.f.blocks[0].parameters; const a=self.abiIndex(self.function);
        switch(c.program.tables.mode) {
            .common => |v| {
                for(self.f.registers) |r| {
                    try c.step();
                    if(std.meta.activeTag(r.carrier)==.@"type") {
                        const kind=v.types[@intFromEnum(r.carrier.@"type")].kind;
                        try c.require(kind!=.@"void" and kind!=.@"union" and kind!=.unknown);
                    }
                }
                for(parameters,v.abis[a].physical_parameters) |r,carrier| { try c.require(exact(self.carrierOf(r),carrier)); }
                const abi=v.abis[a];
                const hidden=@as(usize,if(abi.lexical_environment!=null)1 else 0)+@as(usize,if(abi.receiver!=null)1 else 0);
                for(abi.argument_types,0..) |view,index| {
                    try c.step(); try c.require(self.f.registers[@intFromEnum(parameters[hidden+index])].view==view);
                }
            },
            .legacy => |v| {
                var at: usize=0;
                if(self.closure())try c.require(parameters.len==v.abis[a].parameters.len+@as(usize,if(v.closures.functions[self.function].lexical_environment!=null)1 else 0));
                if(self.closure()) {
                    if(v.closures.functions[self.function].lexical_environment) |env| {
                        try c.require(exact(self.carrierOf(parameters[0]),.{.environment=env})); at=1;
                    }
                }
                for(v.abis[a].parameters,parameters[at..]) |parameter,r| { try c.require(exact(self.carrierOf(r),.{.domain=parameter.domain})); }
                if(self.closure()) {
                    for(self.f.registers) |r| {
                        try c.step(); if(std.meta.activeTag(r.carrier)==.environment)continue;
                        const actual=v.domains[@intFromEnum(r.carrier.domain)].alternatives;
                        try c.require(actual.len==1 and r.view!=null and actual[0]==r.view.?);
                    }
                } else {
                    for(self.f.registers) |r| {
                        try c.step(); try c.require(std.meta.activeTag(r.carrier)==.domain);
                        try c.require(v.domains[@intFromEnum(r.carrier.domain)].alternatives.len!=0);
                    }
                }
            },
            .exception => |v| {
                for(self.f.registers) |r| {
                    try c.step(); try c.require(r.view==null and std.meta.activeTag(r.carrier)!=.environment);
                    if(std.meta.activeTag(r.carrier)==.@"type") {
                        const kind=v.types[@intFromEnum(r.carrier.@"type")].kind;
                        try c.require(kind!=.unknown and kind!=.nullable);
                    }
                }
                for(parameters,v.storage.frames[@intFromEnum(v.abis[a].frame)].slots) |r,slot| {
                    try c.step(); const expected: t.Carrier=if(slot.kind==.cell).{.cell=slot.binding} else ehCarrier(slot.carrier.?);
                    try c.require(exact(self.carrierOf(r),expected));
                }
            },
        }
    }
    fn returned(self: *Graph, op: *const ins.Instruction) Error!void {
        const a=self.abiIndex(self.function);
        if(op.operands.len==0)return; // The reference boundary owns void arity.
        const value=self.carrierOf(op.operands[0]);
        switch(self.c.program.tables.mode) {
            .common => |v| try self.c.require(exact(value,v.abis[a].result_carrier.?)),
            .exception => |v| try self.c.require(exact(value,ehCarrier(v.abis[a].result_carrier.?))),
            .legacy => |v| try self.includes(.{.domain=v.abis[a].result.?.domain},value),
        }
    }
    fn language(self: *Graph, block: t.BlockRef) Error!void {
        const parameters=self.f.blocks[@intFromEnum(block)].parameters;
        try self.c.require(parameters.len==1 and exact(self.carrierOf(parameters[0]),.payload));
    }
    fn direct(self: *Graph, op: *const ins.Instruction, target: usize, normal: ?t.BlockRef, exceptional: ?t.BlockRef) Error!void {
        const c=self.c; const a=self.abiIndex(target);
        switch(c.program.tables.mode) {
            .common => |v| {
                const abi=v.abis[a];
                for(op.operands,abi.physical_parameters) |r,carrier| { try c.require(exact(self.carrierOf(r),carrier)); }
                const output=self.f.blocks[@intFromEnum(normal.?)].parameters;
                if(abi.result_carrier) |result|try c.require(output.len==1 and exact(self.carrierOf(output[0]),result)) else try c.require(output.len==0);
                try self.language(exceptional.?);
                // Common method calls have an explicit dispatch opcode (93).
                for(v.members.methods) |method| { try c.step(); try c.require(@intFromEnum(method.function)!=target); }
            },
            .exception => |v| {
                const abi=v.abis[a];
                for(abi.carriers,op.operands[0..abi.carriers.len]) |carrier,r| { try c.require(exact(self.carrierOf(r),ehCarrier(carrier))); }
                for(v.exceptions.functions[target].captures,op.operands[abi.carriers.len..]) |cell,r| { try c.require(exact(self.carrierOf(r),.{.cell=cell})); }
                const parameters=self.f.blocks[@intFromEnum(normal.?)].parameters;
                try c.require(parameters.len==1 and exact(self.carrierOf(parameters[0]),ehCarrier(abi.result_carrier.?)));
                try self.language(exceptional.?);
            },
            .legacy => |v| {
                const abi=v.abis[a]; var at: usize=0;
                if(self.closure())try c.require(op.operands.len==abi.parameters.len+@as(usize,if(v.closures.functions[target].lexical_environment!=null)1 else 0));
                if(self.closure()) {
                    if(v.closures.functions[target].lexical_environment) |env| { try c.require(exact(self.carrierOf(op.operands[0]),.{.environment=env})); at=1; }
                }
                for(abi.parameters,op.operands[at..]) |parameter,r| { try self.includes(.{.domain=parameter.domain},self.carrierOf(r)); }
                if(abi.result) |result|try self.includes(self.carrierOf(op.result.?),.{.domain=result.domain});
            },
        }
    }
    fn indirectEh(self: *Graph, op: *const ins.Instruction, callable: t.TypeRef, normal: t.BlockRef, exceptional: t.BlockRef) Error!void {
        const c=self.c; const v=c.program.tables.mode.exception;
        try c.require(exact(self.carrierOf(op.operands[0]),.{.@"type"=callable}));
        var found: ?usize=null;
        for(v.exceptions.functions,0..) |fnrow,i| { try c.step(); if(fnrow.@"type"==callable) { found=i; break; } }
        const abi=v.abis[self.abiIndex(found orelse return error.InvalidShape)];
        try c.require(op.operands.len==1+abi.carriers.len);
        for(abi.carriers,op.operands[1..]) |carrier,r| { try c.require(exact(self.carrierOf(r),ehCarrier(carrier))); }
        try c.require(exact(self.carrierOf(self.f.blocks[@intFromEnum(normal)].parameters[0]),ehCarrier(abi.result_carrier.?)));
        try self.language(exceptional);
    }
    fn joined(self: *Graph, expected: t.Carrier, inputs: []const t.Carrier) Error!void {
        const c=self.c; const v=c.program.tables.mode.common;
        var tags: std.AutoHashMapUnmanaged(t.TypeRef,void)=.{}; defer tags.deinit(c.allocator);
        var unknown=false;
        for(inputs) |carrier| {
            try c.step(); switch(carrier) {
                .payload => unknown=true,
                .@"type" => |id| { try c.step(); try tags.put(c.allocator,id,{}); },
                .domain => |id| for(v.domains[@intFromEnum(id)].actual_types) |tag| { try c.step(); try tags.put(c.allocator,tag,{}); },
                else => return error.InvalidShape,
            }
        }
        var single: ?t.TypeRef=null;
        if(tags.count()==1) { var it=tags.keyIterator(); single=it.next().?.*; }
        // Same singleton-callable-before-TOP rule as ActualCheck::carrier.
        if(single) |id|if(v.types[@intFromEnum(id)].kind==.function) { try c.require(exact(expected,.{.@"type"=id})); return; };
        if(unknown) { try c.require(exact(expected,.payload)); return; }
        if(single) |id| {
            const kind=v.types[@intFromEnum(id)].kind;
            if(kind!=.@"undefined" and kind!=.@"null" and kind!=.@"void") { try c.require(exact(expected,.{.@"type"=id})); return; }
        }
        try c.require(std.meta.activeTag(expected)==.domain);
        const actual=v.domains[@intFromEnum(expected.domain)].actual_types;
        try c.require(actual.len==tags.count()); for(actual) |tag| { try c.step(); try c.require(tags.contains(tag)); }
    }
    fn commonCall(self: *Graph, op: *const ins.Instruction, b: usize, position: usize) Error!void {
        const c=self.c; const v=c.program.tables.mode.common; const method=std.meta.activeTag(op.data)==.common_method_invoke;
        const normal=if(method)op.data.common_method_invoke.normal else op.data.eh_invoke_indirect.normal;
        const exceptional=if(method)op.data.common_method_invoke.exceptional else op.data.eh_invoke_indirect.exceptional;
        try self.language(exceptional);
        var targets: std.ArrayListUnmanaged(usize)=.empty; defer targets.deinit(c.allocator);
        var valued=true;
        if(method) {
            const data=op.data.common_method_invoke; const definition=v.members.methods[@intFromEnum(data.member)].function;
            valued=v.abis[self.abiIndex(@intFromEnum(definition))].result!=null;
            const receiver=self.f.registers[@intFromEnum(op.operands[0])]; try c.require(receiver.view==data.receiver_view);
            for(v.views.dispatch[@intFromEnum(data.dispatch)].method.arms) |arm| { try c.step(); try targets.append(c.allocator,@intFromEnum(arm.target.?)); }
        } else {
            const saved=self.f.registers[@intFromEnum(op.operands[0])];
            const logical=saved.view orelse if(std.meta.activeTag(saved.carrier)==.@"type") saved.carrier.@"type" else return error.InvalidShape;
            const signature=v.types[@intFromEnum(logical)]; const encoded=v.types[@intFromEnum(op.data.eh_invoke_indirect.callable)];
            try c.require(signature.kind==.function and signature.element==encoded.element and signature.members.len==encoded.members.len);
            for(signature.members,encoded.members) |actual,expected| { try c.step(); try c.require(actual==expected); }
            var matched=false;
            for(v.closures.calls) |row| {
                try c.step(); if(@intFromEnum(row.function)!=self.function or @intFromEnum(row.block)!=b or row.instruction!=position)continue;
                try c.require(!matched); matched=true;
                for(row.targets) |target| { try c.step(); try targets.append(c.allocator,@intFromEnum(target)); }
            }
            try c.require(matched);
        }
        const output=self.f.blocks[@intFromEnum(normal)].parameters;
        if(targets.items.len==0) {
            // A complete empty fixed callable upper retains argument carriers;
            // its structural value continuation has generic payload capacity.
            try c.require(!method and (output.len==0 or exact(self.carrierOf(output[0]),.payload))); return;
        }
        for(targets.items) |target| { try c.step(); try c.require(c.program.functions[target].role!=.module_initializer); }
        var carriers: std.ArrayListUnmanaged(t.Carrier)=.empty; defer carriers.deinit(c.allocator);
        const offset: usize=if(method)0 else 1;
        for(op.operands[offset..],offset..) |r,i| {
            carriers.clearRetainingCapacity();
            for(targets.items) |target| {
                try c.step(); const abi=v.abis[self.abiIndex(target)];
                const hidden: usize=if(!method and abi.lexical_environment!=null)1 else 0;
                if(method) { if(i>=abi.physical_parameters.len)continue; }
                else try c.require(abi.physical_parameters.len==op.operands.len-1+hidden);
                try carriers.append(c.allocator,abi.physical_parameters[i-offset+hidden]);
            }
            if(carriers.items.len!=0)try self.joined(self.carrierOf(r),carriers.items);
        }
        carriers.clearRetainingCapacity(); var voids: usize=0;
        for(targets.items) |target| {
            try c.step(); const result=v.abis[self.abiIndex(target)].result_carrier;
            if(result) |carrier| { try carriers.append(c.allocator,carrier); } else voids+=1;
        }
        if(method and !valued) { try c.require(output.len==0); return; }
        if(voids!=0)try c.require(!method and voids==targets.items.len and output.len==0)
        else { try c.require(output.len==1); try self.joined(self.carrierOf(output[0]),carriers.items); }
    }
    fn legacyCallable(self: *Graph, op: *const ins.Instruction, signature: t.TypeRef) Error!void {
        const v=self.c.program.tables.mode.legacy; const row=v.types[@intFromEnum(signature)];
        try self.legacyType(op.operands[0],signature);
        for(op.operands[1..],row.members) |r,parameter| { try self.c.step(); try self.legacyType(r,parameter); }
        if(op.result) |r|try self.legacyType(r,row.element.?);
    }
    fn cells(self: *Graph, op: *const ins.Instruction) Error!void {
        const c=self.c;
        const code=std.meta.activeTag(op.data);
        switch(c.program.tables.mode) {
            .common => |v| {
                const id=if(code==.eh_load)op.data.eh_load.binding else op.data.eh_store.binding;
                const binding=v.exceptions.bindings[@intFromEnum(id)].binding;
                const r=if(code==.eh_load)op.result.? else op.operands[1];
                try c.require(exact(self.carrierOf(r),v.storage.bindings[@intFromEnum(binding)].carrier));
            },
            .exception => |v| {
                const id=if(code==.eh_load)op.data.eh_load.binding else op.data.eh_store.binding;
                const r=if(code==.eh_load)op.result.? else op.operands[1];
                try c.require(exact(self.carrierOf(r),ehCarrier(v.exceptions.bindings[@intFromEnum(id)].carrier)));
            },
            .legacy => return error.WrongMode,
        }
    }
    fn operations(self: *Graph) Error!void {
        const c=self.c;
        for(self.f.blocks,0..) |block,b| for(block.instructions,0..) |*op,i| {
            try c.step();
            if(self.closure()) {
                const code=@intFromEnum(std.meta.activeTag(op.data));
                try c.require(code<=28 or code==32 or code==33 or (code>=65 and code<=71));
            }
            switch(op.data) {
                .@"return" => try self.returned(op),
                .br => |v| try self.branch(@intFromEnum(v.destination),op.operands),
                .cond_br => |v| {
                    try c.require(try self.primitive(self.carrierOf(op.operands[0]),2));
                    try self.branch(@intFromEnum(v.true_destination),op.operands[1..1+v.true_count]);
                    try self.branch(@intFromEnum(v.false_destination),op.operands[1+v.true_count..]);
                },
                .eh_route => |v| {
                    try self.branch(@intFromEnum(v.successor),op.operands);
                    if(self.mode==.exception) {
                        const role=c.program.tables.mode.exception.exceptions.scopes[@intFromEnum(v.scope)].role;
                        try c.require(role==.finally or (role==.@"catch" and v.completion==.@"throw"));
                    }
                    if(v.completion==.@"throw")try c.require(exact(self.carrierOf(op.operands[0]),.payload));
                    if(v.completion==.@"return")try c.require(std.meta.activeTag(self.carrierOf(op.operands[0]))!=.cell);
                    // The completion block enters this exact handler scope.
                    const head=self.f.blocks[@intFromEnum(v.successor)].instructions[0];
                    try c.require(std.meta.activeTag(head.data)==.eh_enter and head.data.eh_enter.scope==v.scope);
                },
                .eh_raise => try c.require(exact(self.carrierOf(op.operands[0]),.payload)),
                .call => |v| try self.direct(op,@intFromEnum(v.callee),null,null),
                .eh_invoke => |v| try self.direct(op,@intFromEnum(v.callee),v.normal,v.exceptional),
                .eh_invoke_indirect => |v| if(self.mode==.common)try self.commonCall(op,b,i) else try self.indirectEh(op,v.callable,v.normal,v.exceptional),
                .common_method_invoke => try self.commonCall(op,b,i),
                .function_call => |v| try self.legacyCallable(op,v.signature),
                .function_make => |v| {
                    switch(c.program.tables.mode) {
                        .legacy => |rows| {
                            try self.legacyType(op.result.?,rows.closures.functions[@intFromEnum(v.function)].@"type");
                            if(rows.closures.functions[@intFromEnum(v.function)].lexical_environment) |env|try c.require(exact(self.carrierOf(op.operands[0]),.{.environment=env}));
                        },
                        .common => |rows| {
                            const output=self.carrierOf(op.result.?); try c.require(std.meta.activeTag(output)==.@"type");
                            try c.require(rows.types[@intFromEnum(output.@"type")].kind==.function);
                            for(rows.closures.functions) |fnrow| {
                                try c.step(); if(fnrow.function!=v.function)continue;
                                if(fnrow.lexical_environment) |env|try c.require(exact(self.carrierOf(op.operands[0]),.{.environment=env}));
                            }
                        },
                        .exception => unreachable,
                    }
                },
                .eh_function => |v| {
                    const expected=c.program.tables.mode.exception.exceptions.functions[@intFromEnum(v.function)].@"type" orelse return error.InvalidShape;
                    try c.require(exact(self.carrierOf(op.result.?),.{.@"type"=expected}));
                },
                .environment_alloc => |v| {
                    const parent=switch(c.program.tables.mode) { .common => |rows| rows.closures.environments[@intFromEnum(v.environment)].parent,
                        .legacy => |rows| rows.closures.environments[@intFromEnum(v.environment)].parent, .exception => unreachable };
                    if(parent) |id|try c.require(exact(self.carrierOf(op.operands[0]),.{.environment=id}));
                },
                inline .environment_init,.environment_load,.environment_store => |v| {
                    const env=@intFromEnum(self.carrierOf(op.operands[0]).environment);
                    const r=if(std.meta.activeTag(op.data)==.environment_load)op.result.? else op.operands[1];
                    switch(c.program.tables.mode) {
                        .common => |rows| {
                            const environment=rows.closures.environments[env];
                            const slot=environment.slots[@intFromEnum(v.slot)];
                            try c.require(exact(self.carrierOf(r),rows.storage.bindings[@intFromEnum(slot.binding)].carrier));
                            // A mutable payload upper never grants replacement
                            // of a const binding's environment slot.
                            if(op.data==.environment_store)try c.require(slot.writable);
                            try c.step(); self.has_environment_access=true;
                            if(op.data==.environment_init)self.has_environment_init=true;
                        },
                        .legacy => |rows| try self.legacyType(r,rows.closures.environments[env].slots[@intFromEnum(v.slot)].@"type"),
                        .exception => unreachable,
                    }
                },
                .eh_load,.eh_store => try self.cells(op),
                else => {}, // Every opcode's operands are checked by usesDom;
                // value tags, effects, initialization and lifetime are separate.
            }
        };
        if(self.mode==.exception)for(self.facts,0..) |fact,b| {
            try c.step(); const code=std.meta.activeTag(self.f.blocks[b].instructions[self.f.blocks[b].instructions.len-1].data);
            if(code==.eh_invoke or code==.eh_invoke_indirect)for(fact.successors[0..fact.count]) |next|try c.require(self.facts[next].predecessor_count==1);
        };
    }
    const EnvironmentOrigin=union(enum) { bottom, allocation: t.RegisterRef, mixed, unknown };
    const EnvironmentEdge=struct { follower: t.RegisterRef, next: ?usize };
    const EnvironmentProof=struct {
        c: *Context, seen: []bool, origins: []EnvironmentOrigin, foreign: []bool,
        followers: []?usize, edges: []EnvironmentEdge, pending: []t.RegisterRef, queued: []bool,
        used: usize=0, size: usize=0,

        fn link(self: *EnvironmentProof, source: t.RegisterRef, receiver: t.RegisterRef) Error!void {
            const c=self.c; const index=@intFromEnum(source);
            try c.row(EnvironmentEdge); try c.charge(2);
            self.edges[self.used]=.{.follower=receiver,.next=self.followers[index]};
            self.followers[index]=self.used; self.used+=1;
            try c.step();
            if(!self.seen[index]) {
                try c.charge(2); self.seen[index]=true; self.pending[self.size]=source; self.size+=1;
            }
        }
        fn propagate(self: *EnvironmentProof) Error!void {
            const c=self.c; const count=self.origins.len;
            // First propagate real allocation/unknown seeds. Only then poison
            // still-bottom components, so phi(A,self) retains its grounded A.
            for(0..2) |phase| {
                var head: usize=0; var size: usize=0;
                for(self.seen,0..) |needed,index| {
                    try c.charge(3); if(!needed)continue;
                    const origin_state=self.origins[index];
                    const seed=if(phase==0)origin_state!=.bottom or self.foreign[index] else origin_state==.bottom;
                    if(!seed)continue;
                    if(phase==1) { try c.step(); self.origins[index]=.unknown; }
                    try c.charge(2); self.pending[size]=@enumFromInt(index); self.queued[index]=true; size+=1;
                }
                while(size!=0) {
                    try c.charge(3); const source=@intFromEnum(self.pending[head]);
                    head=(head+1)%count; size-=1; self.queued[source]=false;
                    try c.charge(3); const origin_state=self.origins[source]; const foreign=self.foreign[source];
                    var edge=self.followers[source];
                    while(edge) |index| {
                        try c.row(EnvironmentEdge); try c.charge(3); const next=self.edges[index]; const follower=@intFromEnum(next.follower);
                        const previous=self.origins[follower]; const was_foreign=self.foreign[follower];
                        const joined_origin: EnvironmentOrigin=switch(origin_state) {
                            .bottom => previous,
                            .unknown => .unknown,
                            .mixed => if(previous==.unknown).unknown else .mixed,
                            .allocation => |allocation| switch(previous) {
                                .bottom => origin_state,
                                .allocation => |prior_allocation| if(prior_allocation==allocation)previous else .mixed,
                                .mixed,.unknown => previous,
                            },
                        };
                        const is_foreign=was_foreign or foreign;
                        if(!std.meta.eql(previous,joined_origin) or was_foreign!=is_foreign) {
                            try c.charge(2); self.origins[follower]=joined_origin; self.foreign[follower]=is_foreign;
                            try c.step();
                            if(!self.queued[follower]) {
                                try c.charge(2); self.pending[(head+size)%count]=next.follower; self.queued[follower]=true; size+=1;
                            }
                        }
                        edge=next.next;
                    }
                }
            }
        }
    };
    const EnvironmentIdentity=union(enum) { allocation: t.EnvironmentRef, source: t.RegisterRef, parameter: usize, unknown };
    // Classify a typed definition once. All block-argument sources are owned by
    // the shared edge traversal below, including both edges of one cond_br.
    fn environmentIdentity(self: *Graph, receiver: t.RegisterRef) Error!EnvironmentIdentity {
        const c=self.c;
        try c.charge(2); const definition=self.definitions[@intFromEnum(receiver)];
        if(definition.position>=0) {
            const producer=self.f.blocks[definition.block].instructions[@intCast(definition.position)];
            switch(producer.data) {
                .environment_alloc => |v| return .{.allocation=v.environment},
                .domain_view,.domain_copy,.eh_carrier,.eh_assertion => {
                    try c.charge(3); const source=producer.operands[0];
                    if(!exact(self.carrierOf(receiver),self.carrierOf(source)))return .unknown;
                    return .{.source=source};
                },
                else => return .unknown,
            }
        }
        return if(definition.block==0).unknown else .{.parameter=definition.block};
    }
    fn environmentOrigins(self: *Graph) Error!?[]?t.RegisterRef {
        if(self.mode!=.common or !self.has_environment_access)return null;
        const c=self.c; const rows=c.program.tables.mode.common;
        var activation: ?t.EnvironmentRef=null;
        if(self.has_environment_init) {
            for(rows.closures.functions) |function| {
                try c.step(); if(@intFromEnum(function.function)!=self.function)continue;
                activation=function.activation_environment; break;
            }
            const layout=activation orelse return error.InvalidShape;
            try c.require(@intFromEnum(rows.closures.environments[@intFromEnum(layout)].owner)==self.function);
        }
        const count=self.f.registers.len;
        // At most one unary edge per register, plus one transported argument
        // per real CFG edge/target parameter. Fixed storage avoids hidden list
        // growth/relocation and does not depend on a new alias state space.
        var edge_capacity=count;
        for(self.facts) |fact| {
            try c.step();
            for(fact.successors[0..fact.count]) |successor| {
                try c.step(); edge_capacity+=self.f.blocks[successor].parameters.len;
            }
        }
        try c.charge(6*count+edge_capacity);
        const seen=try c.allocator.alloc(bool,count); defer c.allocator.free(seen); @memset(seen,false);
        const origins=try c.allocator.alloc(EnvironmentOrigin,count); defer c.allocator.free(origins); @memset(origins,.bottom);
        const foreign=try c.allocator.alloc(bool,count); defer c.allocator.free(foreign); @memset(foreign,false);
        const followers=try c.allocator.alloc(?usize,count); defer c.allocator.free(followers); @memset(followers,null);
        const pending=try c.allocator.alloc(t.RegisterRef,count); defer c.allocator.free(pending);
        const queued=try c.allocator.alloc(bool,count); defer c.allocator.free(queued); @memset(queued,false);
        const edges=try c.allocator.alloc(EnvironmentEdge,edge_capacity); defer c.allocator.free(edges);
        var proof=EnvironmentProof{.c=c,.seen=seen,.origins=origins,.foreign=foreign,
            .followers=followers,.edges=edges,.pending=pending,.queued=queued};
        for(self.f.blocks) |block| for(block.instructions) |op| {
            try c.step(); switch(op.data) {
                .environment_init,.environment_load,.environment_store => {},
                else => continue,
            }
            try c.charge(2); const receiver=op.operands[0]; const index=@intFromEnum(receiver);
            if(!seen[index]) { try c.charge(2); seen[index]=true; pending[proof.size]=receiver; proof.size+=1; }
        };
        var cursor: usize=0;
        while(cursor<proof.size) : (cursor+=1) {
            try c.step(); const receiver=pending[cursor]; const index=@intFromEnum(receiver);
            if(activation) |layout| {
                try c.charge(2); foreign[index]=!exact(self.carrierOf(receiver),.{.environment=layout});
            }
            switch(try self.environmentIdentity(receiver)) {
                .allocation => |allocation| {
                    try c.step(); origins[index]=.{.allocation=receiver};
                    if(activation) |layout| { try c.charge(2); foreign[index]=foreign[index] or allocation!=layout; }
                },
                .source => |source| try proof.link(source,receiver),
                .unknown => { try c.step(); origins[index]=.unknown; },
                .parameter => |block_index| {
                    var ordinal: ?usize=null;
                    try c.step();
                    for(self.f.blocks[block_index].parameters,0..) |parameter,n| {
                        try c.step(); if(parameter==receiver) { ordinal=n; break; }
                    }
                    const parameter=ordinal orelse { try c.step(); origins[index]=.unknown; continue; };
                    var incoming: usize=0;
                    try c.step(); var predecessors=Predecessors{.bits=self.facts[block_index].predecessors};
                    while(try predecessors.next(c)) |pred| {
                        try c.charge(3); const block=self.f.blocks[pred]; const op=block.instructions[block.instructions.len-1];
                        const exits=self.facts[pred];
                        for(exits.successors[0..exits.count],0..) |next,edge| {
                            try c.step(); if(next!=block_index)continue;
                            const arguments=switch(op.data) {
                                .br,.eh_route => op.operands,
                                .cond_br => |conditional| if(edge==0)op.operands[1..1+conditional.true_count] else op.operands[1+conditional.true_count..],
                                // Invokes/numeric edges create values instead
                                // of transporting a complete Env argument.
                                else => { try c.step(); origins[index]=.unknown; continue; },
                            };
                            try c.step(); const source=arguments[parameter];
                            try proof.link(source,receiver); incoming+=1;
                        }
                    }
                    if(incoming==0) { try c.step(); origins[index]=.unknown; }
                },
            }
        }
        try proof.propagate();
        // Authority is required only for actual initializer receivers. Unknown
        // load/store paths cannot invalidate an independent valid initializer.
        for(self.f.blocks) |block| for(block.instructions) |op| {
            try c.step(); if(op.data!=.environment_init)continue;
            try c.charge(3); const index=@intFromEnum(op.operands[0]);
            const origin_state=origins[index];
            try c.require((origin_state==.allocation or origin_state==.mixed) and !foreign[index]);
        };
        try c.charge(3*count);
        const allocations=try c.allocator.alloc(?t.RegisterRef,count);
        for(origins,allocations) |origin_state,*allocation| {
            allocation.*=switch(origin_state) { .allocation => |ref| ref, else => null };
        }
        return allocations;
    }
    fn environmentDirectCellState(self: *Graph, allocations: []const ?t.RegisterRef) Error!void {
        if(self.mode!=.common or !self.has_environment_access)return;
        const c=self.c;
        const Pair=struct { receiver: t.RegisterRef, slot: t.EnvironmentSlotRef };
        var pairs: std.AutoHashMapUnmanaged(Pair,void)=.{}; defer pairs.deinit(c.allocator);
        for(self.f.blocks) |block| for(block.instructions) |op| {
            try c.step(); const slot=switch(op.data) {
                inline .environment_init,.environment_load,.environment_store => |v| v.slot,
                else => continue,
            };
            try c.step(); const allocation=allocations[@intFromEnum(op.operands[0])] orelse continue;
            try c.row(Pair);
            const capacity=@as(usize,pairs.capacity()); const used=@as(usize,pairs.count());
            // This insert-only default-load map grows before lookup. Prepay
            // old buckets, new metadata and each retained pair's rehash/copy.
            if(used==capacity*std.hash_map.default_max_load_percentage/100)
                try c.charge(capacity+@max(8,2*capacity)+3*used);
            _=try pairs.getOrPut(c.allocator,.{.receiver=allocation,.slot=slot});
        };
        try c.charge(@as(usize,pairs.capacity())+1); // Include empty buckets before any next().
        var iterator=pairs.keyIterator();
        while(true) {
            try c.step(); const pair=(iterator.next() orelse break).*;
            const count=self.f.blocks.len;
            // The unique original result resets this instance only when its
            // allocation executes again. Proven transparent receivers share
            // that cell; mixed/unknown and interprocedural state remain separate.
            try c.charge(4*count);
            var last: [256]u2=undefined; @memset(last[0..count],0);
            var incoming: [256]u2=undefined; @memset(incoming[0..count],0);
            var outgoing: [256]u2=undefined; @memset(outgoing[0..count],0);
            var queued: [256]bool=undefined; @memset(queued[0..count],false);
            var pending: [256]usize=undefined;
            for(self.f.blocks,0..) |block,b| for(block.instructions) |op| {
                try c.step();
                if(op.data==.environment_alloc and op.result.?==pair.receiver)last[b]=1
                else if(op.data==.environment_init) {
                    try c.step();
                    if(allocations[@intFromEnum(op.operands[0])]==pair.receiver and op.data.environment_init.slot==pair.slot)last[b]=2;
                }
            };
            // Possible states: bottom=0, Uninitialized=1, Initialized=2.
            // A block's last ordered reset/init determines its transfer. Union
            // at joins retains every live incoming arm, including loop entries.
            var head: usize=0; var size: usize=1;
            try c.charge(3); pending[0]=0; queued[0]=true; incoming[0]=1;
            while(size!=0) {
                try c.step(); const b=pending[head]; head=(head+1)%count; size-=1; queued[b]=false;
                try c.charge(4);
                const next: u2=if(incoming[b]==0)0 else if(last[b]!=0)last[b] else incoming[b];
                if(outgoing[b]==next)continue;
                outgoing[b]=next;
                for(self.facts[b].successors[0..self.facts[b].count]) |successor| {
                    try c.charge(3); const joinedState=incoming[successor]|next;
                    if(joinedState==incoming[successor])continue;
                    incoming[successor]=joinedState;
                    if(!queued[successor]) {
                        try c.charge(3); pending[(head+size)%count]=successor; size+=1; queued[successor]=true;
                    }
                }
            }
            for(self.f.blocks,0..) |block,b| {
                try c.step(); var state=incoming[b];
                for(block.instructions) |op| {
                    try c.step(); if(state==0)continue;
                    switch(op.data) {
                        .environment_alloc => if(op.result.?==pair.receiver) { state=1; },
                        inline .environment_init,.environment_load,.environment_store => |v| {
                            try c.step();
                            if(allocations[@intFromEnum(op.operands[0])]!=pair.receiver or v.slot!=pair.slot)continue;
                            if(op.data==.environment_init) { try c.require(state==1); state=2; }
                            else try c.require(state==2);
                        },
                        else => {},
                    }
                }
            }
        }
    }
    fn directGlobalBody(self: *Graph, target: t.FunctionRef) Error![]const ins.Instruction {
        // The opcode's exact FunctionRef owns the call target. Only a simple
        // same-module ordinary body is covered here, never a potential fixed
        // upper, a display-name match or a transitive/conditional observation.
        const c=self.c; try c.charge(5); const function=c.program.functions[@intFromEnum(target)];
        if(function.role!=.ordinary or function.source!=self.f.source or function.blocks.len!=1)return &.{};
        const body=function.blocks[0].instructions;
        if(body[body.len-1].data!=.@"return")return &.{};
        for(body) |op| {
            try c.step(); switch(op.data) {
                .fuel,.const_i32,.const_bool,.global_load,.@"return"=>{},
                .global_store=>|v| if(v.initialize)return &.{},
                else=>return &.{},
            }
        }
        return body;
    }
    fn globalInitialization(self: *Graph) Error!void {
        if(self.mode!=.common or self.f.role!=.module_initializer)return;
        const c=self.c; const modules=c.program.tables.mode.common.modules; const globals=modules.globals;
        // GlobalRef identifies one program cell. Permission/defining-module
        // ownership remains the independent module-contracts obligation.
        try c.charge(globals.len);
        const used=try c.allocator.alloc(bool,globals.len); defer c.allocator.free(used); @memset(used,false);
        var own_globals: []const t.GlobalRef=&.{};
        for(modules.modules) |module| {
            try c.step(); if(@intFromEnum(module.initializer)==self.function and module.source==self.f.source) { own_globals=module.globals; break; }
        }
        for(self.f.blocks) |block| for(block.instructions) |op| {
            try c.step(); switch(op.data) {
                inline .global_load,.global_store=>|v| {
                    const index=@intFromEnum(v.global); if(globals[index].source==self.f.source)used[index]=true;
                },
                .eh_invoke=>|v| if(own_globals.len!=0) {
                    for(try self.directGlobalBody(v.callee)) |callee_op| {
                        try c.step(); const ref=switch(callee_op.data) { inline .global_load,.global_store=>|access|access.global, else=>continue };
                        for(own_globals) |owned| {
                            try c.step(); if(owned==ref) {
                                try c.step(); const index=@intFromEnum(ref); if(globals[index].source==self.f.source)used[index]=true; break;
                            }
                        }
                    }
                },
                else=>{},
            }
        };
        for(used,0..) |needed,index| {
            try c.step(); if(!needed)continue;
            const ref: t.GlobalRef=@enumFromInt(index);
            try c.charge(4*self.f.blocks.len);
            var initializes: [256]bool=undefined; @memset(initializes[0..self.f.blocks.len],false);
            for(self.f.blocks,0..) |block,b| for(block.instructions) |op| {
                try c.step(); if(op.data==.global_store and op.data.global_store.global==ref and op.data.global_store.initialize)initializes[b]=true;
            };
            // Possible states: bottom=0, Uninitialized=1, Initialized=2.
            // Union at joins retains the uninitialized arm. Compute the finite
            // fixed point before rejecting, so an initialized loop does not
            // acquire a false Uninitialized state from an initial MUST bottom.
            var incoming: [256]u2=undefined; @memset(incoming[0..self.f.blocks.len],0);
            var outgoing: [256]u2=undefined; @memset(outgoing[0..self.f.blocks.len],0);
            var queued: [256]bool=undefined; @memset(queued[0..self.f.blocks.len],false); var pending: [256]usize=undefined;
            var head: usize=0; var size: usize=1; try c.step(); pending[0]=0; queued[0]=true; incoming[0]=1;
            while(size!=0) {
                try c.step(); const b=pending[head]; head=(head+1)%self.f.blocks.len; size-=1; queued[b]=false;
                const next: u2=if(incoming[b]==0)0 else if(initializes[b])2 else incoming[b];
                if(outgoing[b]==next)continue;
                outgoing[b]=next;
                for(self.facts[b].successors[0..self.facts[b].count]) |successor| {
                    try c.step(); const joinedState=incoming[successor]|next;
                    if(joinedState==incoming[successor])continue;
                    incoming[successor]=joinedState;
                    if(!queued[successor]) { try c.step(); pending[(head+size)%self.f.blocks.len]=successor; size+=1; queued[successor]=true; }
                }
            }
            for(self.f.blocks,0..) |block,b| {
                try c.step(); var state=incoming[b];
                // Common has only block0 as an execution entry; reach() and
                // usesDom() permit original unreachable blocks. Keep their
                // empty path set rather than inventing extra entry states.
                for(block.instructions) |op| {
                    try c.step(); if(state==0)continue;
                    switch(op.data) {
                        .global_store=>|v| if(v.global==ref) {
                            if(v.initialize) { try c.require(state==1); state=2; } else try c.require(state==2);
                        },
                        .global_load=>|v| if(v.global==ref) { try c.require(state==2); },
                        .eh_invoke=>|v| if(own_globals.len!=0) {
                            for(try self.directGlobalBody(v.callee)) |callee_op| {
                                try c.step(); const observed=switch(callee_op.data) { inline .global_load,.global_store=>|access|access.global, else=>continue };
                                if(observed==ref)try c.require(state==2);
                            }
                        },
                        else=>{},
                    }
                }
            }
        }
        // Covered direct bodies cannot initialize a Global and add no state
        // mutation. Other callee shapes/targets/modules and Env instance state
        // retain their separate proof obligations; no completion receipt or
        // general interprocedural initialization guarantee is inferred here.
    }
    fn fuel(self: *Graph) Error!void {
        const c=self.c; var entries: usize=0;
        for(self.f.blocks,0..) |block,b| for(block.instructions,0..) |*op,i| {
            try c.step(); if(std.meta.activeTag(op.data)!=.fuel)continue;
            try c.require(op.source.source==self.f.source);
            if(op.data.fuel.event==.entry) {
                entries+=1; try c.require(b==0 and self.f.role!=.module_initializer and op.source.start==self.f.declaration.start and op.source.end==self.f.declaration.end);
                if(self.mode==.common) {
                    for(block.instructions[0..i]) |prefix| { try c.step(); try c.require(std.meta.activeTag(prefix.data)==.environment_alloc); }
                } else try c.require(i==0);
            } else { try c.require((self.mode==.exception or b!=0) and i==0); self.facts[b].condition=true; }
        };
        try c.require(entries==@as(usize,if(self.f.role==.module_initializer)0 else 1));
        // Removing all real condition-event blocks must leave a DAG. This
        // checks each cycle, including irreducible and unreachable Common CFGs.
        var incoming: [256]usize=@splat(0); var pending: [256]usize=undefined; var size: usize=0; var uncharged: usize=0;
        for(self.facts) |fact| {
            try c.step(); if(fact.condition)continue; uncharged+=1;
            for(fact.successors[0..fact.count]) |next| { try c.step(); if(!self.facts[next].condition)incoming[next]+=1; }
        }
        for(self.facts,0..) |fact,b| { try c.step(); if(!fact.condition and incoming[b]==0) { pending[size]=b; size+=1; } }
        var at: usize=0;
        while(at<size) : (at+=1)for(self.facts[pending[at]].successors[0..self.facts[pending[at]].count]) |next| {
            try c.step(); if(self.facts[next].condition)continue; incoming[next]-=1;
            if(incoming[next]==0) { pending[size]=next; size+=1; }
        };
        try c.require(size==uncharged);
    }
    fn numericInput(self: *Graph, r: t.RegisterRef) Error!void {
        const c=self.c; const carrier=self.carrierOf(r);
        if(self.mode==.common and try self.primitive(carrier,1))return;
        try c.require(std.meta.activeTag(carrier)==.domain);
        switch(c.program.tables.mode) {
            .legacy => |v| for(v.domains[@intFromEnum(carrier.domain)].alternatives) |id| {
                try c.step(); const row=v.types[@intFromEnum(id)]; try c.require(row.native_code==1 or row.kind==.@"undefined");
            },
            .common => |v| for(v.domains[@intFromEnum(carrier.domain)].actual_types) |id| {
                try c.step(); const row=v.types[@intFromEnum(id)]; try c.require(row.native_code==1 or row.kind==.@"undefined");
            },
            .exception => |v| for(v.domains[@intFromEnum(carrier.domain)].actual_types) |id| {
                try c.step(); const row=v.types[@intFromEnum(id)]; try c.charge(1+row.name.len/64);
                try c.require(row.kind==.@"undefined" or (row.kind==.scalar and std.mem.eql(u8,row.name,"i32")));
            },
        }
    }
    fn before(self: *Graph, dom: []const Bits, r: t.RegisterRef, first: usize) Error!void {
        const definition=self.definitions[@intFromEnum(r)];
        try self.c.require(has(dom[first],definition.block) and (definition.block!=first or
            definition.position<@as(i32,@intCast(self.f.blocks[first].instructions.len-1))));
    }
    fn numeric(self: *Graph) Error!void {
        const c=self.c;
        const Group=struct { blocks: [2]usize=.{0,0}, count: usize=0 };
        var groups: std.StringHashMapUnmanaged(Group)=.{}; defer groups.deinit(c.allocator);
        for(self.f.blocks,0..) |block,b| {
            try c.step(); const op=&block.instructions[block.instructions.len-1];
            if(std.meta.activeTag(op.data)!=.domain_numeric_use)continue;
            const data=op.data.domain_numeric_use; try c.charge(1+data.numeric_group.len/64);
            const approved_target=switch(c.program.tables.mode) {
                .legacy => |v| v.types[@intFromEnum(data.target_type)].native_code==1,
                else => try self.primitive(.{.@"type"=data.target_type},1),
            };
            try c.require(approved_target);
            const found=try groups.getOrPut(c.allocator,data.numeric_group); if(!found.found_existing)found.value_ptr.*=.{};
            try c.require(found.value_ptr.count<2); found.value_ptr.blocks[found.value_ptr.count]=b; found.value_ptr.count+=1;
            try self.numericInput(op.operands[0]);
            try c.require(try self.primitive(self.carrierOf(self.f.blocks[@intFromEnum(data.normal_successor)].parameters[0]),1));
        }
        if(groups.count()==0)return;
        // Common ordinary SSA ignores cross-block dominance in unreachable
        // blocks; its numeric proof explicitly computes the full graph instead.
        const separate=self.mode==.common and !self.fully_reached;
        const full=if(separate)try self.dominance(true) else self.dom;
        defer if(separate)c.allocator.free(full);
        var iterator=groups.iterator();
        while(iterator.next()) |entry| {
            try c.step(); const group=entry.value_ptr.*; var first: ?usize=null;
            for(group.blocks[0..group.count]) |b| {
                try c.step(); var follows=false;
                var predecessors=Predecessors{.bits=self.facts[b].predecessors};
                while(try predecessors.next(c)) |pred| {
                    const previous=self.f.blocks[pred].instructions[self.f.blocks[pred].instructions.len-1];
                    if(std.meta.activeTag(previous.data)==.domain_numeric_use) {
                        const id=previous.data.domain_numeric_use.numeric_group; try c.charge(1+id.len/64);
                        if(std.mem.eql(u8,id,entry.key_ptr.*))follows=true;
                    }
                }
                if(!follows) { try c.require(first==null); first=b; }
            }
            const start=first orelse return error.InvalidShape;
            const initial=&self.f.blocks[start].instructions[self.f.blocks[start].instructions.len-1];
            const common=initial.data.domain_numeric_use;
            var checked: [2]struct { argument: t.RegisterRef, index: usize }=undefined;
            var visited=zero; var count: usize=0; var b=start; var previous: i32=-1;
            var consumer_block: usize=0; var consumer_position: usize=0;
            while(true) {
                try c.require(!has(visited,b) and count<group.count); put(&visited,b);
                const op=&self.f.blocks[b].instructions[self.f.blocks[b].instructions.len-1];
                try c.require(std.meta.activeTag(op.data)==.domain_numeric_use); const row=op.data.domain_numeric_use;
                try c.charge(1+row.numeric_group.len/64);
                try c.require(std.mem.eql(u8,row.numeric_group,entry.key_ptr.*) and row.target_type==common.target_type and
                    row.numeric_operator==common.numeric_operator and row.numeric_arity==common.numeric_arity and origin(initial,op) and row.numeric_operand>previous);
                previous=row.numeric_operand; try self.before(full,op.operands[0],start);
                const next=@intFromEnum(row.normal_successor); const target=self.f.blocks[next];
                try c.require(self.facts[next].predecessor_count==1 and has(self.facts[next].predecessors,b));
                checked[count]=.{.argument=target.parameters[0],.index=row.numeric_operand}; count+=1;
                var at: usize=0;
                if(self.mode==.common)while(at<target.instructions.len and std.meta.activeTag(target.instructions[at].data)==.eh_carrier) : (at+=1) {
                    try c.step(); const cast=&target.instructions[at];
                    try c.require(origin(initial,cast) and anchorsEmpty(cast) and cast.data.eh_carrier!=null and
                        try self.primitive(self.carrierOf(cast.operands[0]),1) and try self.primitive(self.carrierOf(cast.result.?),1));
                };
                try c.require(at<target.instructions.len);
                if(std.meta.activeTag(target.instructions[at].data)==.domain_numeric_use) {
                    try c.require(at+1==target.instructions.len); b=next; continue;
                }
                consumer_block=next; consumer_position=at; break;
            }
            const consumer=&self.f.blocks[consumer_block].instructions[consumer_position];
            try c.require(count==group.count and std.meta.activeTag(consumer.data)==common.numeric_operator and
                consumer.operands.len==common.numeric_arity and origin(initial,consumer) and anchorsEmpty(consumer));
            var indices: [2]bool=.{false,false};
            for(checked[0..count]) |item| {
                var argument=item.argument; var aliases: std.AutoHashMapUnmanaged(t.RegisterRef,void)=.{}; defer aliases.deinit(c.allocator);
                while(true) {
                    try c.step(); const seen=try aliases.getOrPut(c.allocator,argument); try c.require(!seen.found_existing);
                    const use=self.uses[@intFromEnum(argument)]; try c.require(use.count==1);
                    const reader=&self.f.blocks[use.block].instructions[use.position];
                    if(self.mode==.common and std.meta.activeTag(reader.data)==.eh_carrier) {
                        try c.require(origin(initial,reader) and try self.primitive(self.carrierOf(reader.result.?),1)); argument=reader.result.?; continue;
                    }
                    try c.require(use.block==consumer_block and use.position==consumer_position and use.operand==item.index and consumer.operands[item.index]==argument); break;
                }
                indices[item.index]=true;
            }
            for(consumer.operands,0..) |r,i| { try c.step(); if(!indices[i])try self.before(full,r,start); }
            // Recomputing numeric_group's semantic hash belongs to the future
            // crypto/provenance boundary, not this typed CFG/SSA checker.
        }
    }
    fn run(self: *Graph) Error!void {
        try self.directory(); try self.reach(); self.dom=try self.dominance(false);
        try self.usesDom(); try self.entryAbi(); try self.operations();
        const allocations=try self.environmentOrigins(); defer if(allocations) |values| self.c.allocator.free(values);
        if(allocations) |values|try self.environmentDirectCellState(values);
        try self.globalInitialization(); try self.numeric(); try self.fuel();
        // Borrow the paid definition/predecessor directory. The business proof
        // adds no second dominance graph, Context, Source table or admission.
        if(self.mode==.common)try receiver_protocol.check(self.c,self.function,.{.definitions=self.definitions,.facts=self.facts});
    }
};

// references/layout must already have succeeded with this same Context. No
// fresh budget, marker, retained graph or execution handle is created here.
pub fn check(c: *Context) Error!void {
    if(c.program.tables.mode==.legacy) {
        const v=c.program.tables.mode.legacy;
        // The real legacy dispatcher selects closure verification by the
        // complete function directory, not by a single function's ABI.kind.
        if(v.closures.functions.len!=0) {
            try c.require(v.closures.functions.len==c.program.functions.len);
            for(v.closures.functions,0..) |fnrow,i| { try c.step(); try c.require(@intFromEnum(fnrow.function)==i); }
        } else try c.require(v.closures.environments.len==0 and v.closures.calls.len==0);
    }
    for(c.program.functions,0..) |_,index| {
        try c.step(); var graph=try Graph.init(c,index); defer graph.deinit(); try graph.run();
    }
}
