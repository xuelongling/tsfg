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

const Definition = struct { block: usize, position: i32 };
const Use = struct { block: usize=0, position: usize=0, operand: usize=0, count: usize=0 };
const Facts = struct {
    successors: [2]usize=.{0,0}, count: usize=0,
    predecessors: Bits=zero, predecessor_count: usize=0,
    reachable: bool=false, condition: bool=false,
};
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
                        .common => |rows| { const binding=rows.closures.environments[env].slots[@intFromEnum(v.slot)].binding;
                            try c.require(exact(self.carrierOf(r),rows.storage.bindings[@intFromEnum(binding)].carrier)); },
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
        try self.usesDom(); try self.entryAbi(); try self.operations(); try self.numeric(); try self.fuel();
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
