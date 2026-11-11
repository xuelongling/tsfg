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
const EdgeTargets = struct { blocks: [2]usize = .{0,0}, count: usize = 0 };
fn edgeTargets(op: *const ins.Instruction) EdgeTargets {
    return switch(op.data) {
        .br => |v| .{ .blocks=.{@intFromEnum(v.destination),0},.count=1 },
        .cond_br => |v| .{ .blocks=.{@intFromEnum(v.true_destination),@intFromEnum(v.false_destination)},.count=2 },
        .domain_numeric_use => |v| .{ .blocks=.{@intFromEnum(v.normal_successor),0},.count=1 },
        inline .eh_invoke,.eh_invoke_indirect,.common_method_invoke => |v| .{ .blocks=.{@intFromEnum(v.normal),@intFromEnum(v.exceptional)},.count=2 },
        inline .receiver_bind,.receiver_get,.receiver_result => |v| .{ .blocks=.{@intFromEnum(v.normal),@intFromEnum(v.language)},.count=2 },
        .eh_route => |v| .{ .blocks=.{@intFromEnum(v.successor),0},.count=1 },
        else => .{},
    };
}
const GlobalRefs = std.AutoHashMapUnmanaged(t.GlobalRef, void);
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
    has_direct_environment_call: bool=false,

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
            const targets=edgeTargets(&block.instructions[block.instructions.len-1]);
            const edges=&self.facts[b];
            edges.successors=targets.blocks;
            edges.count=targets.count;
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
                if (abi.lexical_environment != null) {
                    try c.step();
                    self.has_direct_environment_call = true;
                }
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
    const InitializerCodeDefinition = union(enum) { literal: t.FunctionRef, source: t.RegisterRef, parameter: usize, unknown };

    fn initializerCodeDefinition(self: *Graph, receiver: t.RegisterRef) Error!InitializerCodeDefinition {
        const c = self.c;
        try c.charge(3);
        const definition = self.definitions[@intFromEnum(receiver)];
        if (definition.position < 0)
            return if (definition.block == 0) .unknown else .{ .parameter = definition.block };
        try c.charge(3);
        const producer = &self.f.blocks[definition.block].instructions[@intCast(definition.position)];
        switch (producer.data) {
            .function_make => |v| return .{ .literal = v.function },
            .domain_copy, .domain_view => {
                try c.charge(3);
                const source = producer.operands[0];
                return if (exact(self.carrierOf(receiver), self.carrierOf(source))) .{ .source = source } else .unknown;
            },
            else => return .unknown,
        }
    }

    fn initializerCodeMerge(self: *Graph, receiver: t.RegisterRef) Error!?t.RegisterRef {
        const c = self.c;
        const count = self.f.registers.len;
        var edge_capacity = count;
        for (self.facts) |*fact| {
            try c.step();
            if (!fact.reachable) continue;
            for (fact.successors[0..fact.count]) |next| {
                try c.step();
                edge_capacity += self.f.blocks[next].parameters.len;
            }
        }
        var proof = try EnvironmentProof.init(c, count, edge_capacity);
        defer proof.deinit();
        try proof.need(receiver);
        var cursor: usize = 0;
        while (cursor < proof.size) : (cursor += 1) {
            try c.charge(2);
            const current = proof.pending[cursor];
            const index = @intFromEnum(current);
            switch (try self.initializerCodeDefinition(current)) {
                .literal => {
                    // The original SSA definition identifies the saved Code;
                    // equal FunctionRefs from separate definitions stay mixed.
                    try c.step();
                    proof.origins[index] = .{ .allocation = current };
                },
                .source => |source| try proof.link(source, current),
                .parameter => |block| {
                    var ordinal: ?usize = null;
                    for (self.f.blocks[block].parameters, 0..) |parameter, n| {
                        try c.step();
                        if (parameter == current) { ordinal = n; break; }
                    }
                    const argument_index = ordinal orelse return null;
                    try c.charge(zero.len + 1);
                    var predecessors = Predecessors{ .bits = self.facts[block].predecessors };
                    while (try predecessors.next(c)) |predecessor| {
                        try c.step();
                        const fact = &self.facts[predecessor];
                        if (!fact.reachable) continue;
                        try c.charge(3);
                        const instructions = self.f.blocks[predecessor].instructions;
                        const terminator = &instructions[instructions.len - 1];
                        for (fact.successors[0..fact.count], 0..) |next, edge| {
                            try c.step();
                            if (next != block) continue;
                            if (environmentEdgeArguments(terminator, edge)) |arguments| {
                                try c.charge(3);
                                const source = arguments[argument_index];
                                if (exact(self.carrierOf(current), self.carrierOf(source))) {
                                    try proof.link(source, current);
                                    continue;
                                }
                            }
                            try c.step();
                            proof.origins[index] = .unknown;
                        }
                    }
                },
                .unknown => {
                    try c.step();
                    proof.origins[index] = .unknown;
                },
            }
        }
        try proof.propagate();
        try c.step();
        return switch (proof.origins[@intFromEnum(receiver)]) {
            .allocation => |source| source,
            else => null,
        };
    }

    fn initializerCodeTarget(self: *Graph, receiver: t.RegisterRef) Error!?t.FunctionRef {
        var current = receiver;
        // Reachable SSA orders unary sources. A block merge needs the shared
        // grounded-origin proof because CFG backedges can revisit parameters.
        while (true) switch (try self.initializerCodeDefinition(current)) {
            .literal => |target| return target,
            .source => |source| current = source,
            .parameter => current = (try self.initializerCodeMerge(current)) orelse return null,
            .unknown => return null,
        };
    }

    fn commonCall(self: *Graph, op: *const ins.Instruction, b: usize, position: usize, initializer_callee: ?*?t.FunctionRef) Error!void {
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
        if (initializer_callee) |record| {
            try c.charge(3);
            if (targets.items.len == 1 and self.facts[b].reachable) {
                // Join the saved Code to the same fixed call row that checked
                // the argument and result ABI.
                if (try self.initializerCodeTarget(op.operands[0])) |target| {
                    try c.step();
                    if (@intFromEnum(target) == targets.items[0]) record.* = target;
                }
            }
        }
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
    fn operations(self: *Graph, initializer_callees: ?[]?t.FunctionRef) Error!void {
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
                .eh_invoke_indirect => |v| if(self.mode==.common)
                    try self.commonCall(op,b,i,if(initializer_callees) |callees| &callees[b] else null)
                else
                    try self.indirectEh(op,v.callable,v.normal,v.exceptional),
                .common_method_invoke => try self.commonCall(op,b,i,null),
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

        fn init(c: *Context, count: usize, edge_capacity: usize) Error!EnvironmentProof {
            try c.charge(6 * count + edge_capacity);
            const allocator = c.allocator;
            const seen = try allocator.alloc(bool, count);
            errdefer allocator.free(seen);
            const origins = try allocator.alloc(EnvironmentOrigin, count);
            errdefer allocator.free(origins);
            const foreign = try allocator.alloc(bool, count);
            errdefer allocator.free(foreign);
            const followers = try allocator.alloc(?usize, count);
            errdefer allocator.free(followers);
            const pending = try allocator.alloc(t.RegisterRef, count);
            errdefer allocator.free(pending);
            const queued = try allocator.alloc(bool, count);
            errdefer allocator.free(queued);
            const edges = try allocator.alloc(EnvironmentEdge, edge_capacity);
            @memset(seen, false);
            @memset(origins, .bottom);
            @memset(foreign, false);
            @memset(followers, null);
            @memset(queued, false);
            return .{
                .c = c, .seen = seen, .origins = origins, .foreign = foreign,
                .followers = followers, .edges = edges, .pending = pending, .queued = queued,
            };
        }

        fn deinit(self: *EnvironmentProof) void {
            const allocator = self.c.allocator;
            allocator.free(self.seen);
            allocator.free(self.origins);
            allocator.free(self.foreign);
            allocator.free(self.followers);
            allocator.free(self.edges);
            allocator.free(self.pending);
            allocator.free(self.queued);
        }

        fn link(self: *EnvironmentProof, source: t.RegisterRef, receiver: t.RegisterRef) Error!void {
            const c=self.c; const index=@intFromEnum(source);
            try c.row(EnvironmentEdge); try c.charge(2);
            self.edges[self.used]=.{.follower=receiver,.next=self.followers[index]};
            self.followers[index]=self.used; self.used+=1;
            try self.need(source);
        }

        fn need(self: *EnvironmentProof, receiver: t.RegisterRef) Error!void {
            try self.c.step();
            const index = @intFromEnum(receiver);
            if (self.seen[index]) return;
            try self.c.charge(2);
            self.seen[index] = true;
            self.pending[self.size] = receiver;
            self.size += 1;
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
    const EnvironmentAllocations = struct {
        direct: []?t.RegisterRef,
        checked_layout: ?t.EnvironmentRef,
        call_blocks_with_older_aliases: Bits,
    };

    fn environmentEdgeArguments(op: *const ins.Instruction, edge: usize) ?[]const t.RegisterRef {
        return switch (op.data) {
            .br, .eh_route => op.operands,
            .cond_br => |conditional| if (edge == 0)
                op.operands[1 .. 1 + conditional.true_count]
            else
                op.operands[1 + conditional.true_count ..],
            // These edges create values instead of transporting Env arguments.
            else => null,
        };
    }
    fn isEnvironmentForwarder(op: *const ins.Instruction) bool {
        return switch (op.data) {
            .domain_view, .domain_copy, .eh_carrier, .eh_assertion => true,
            else => false,
        };
    }

    // Classify a typed definition once. All block-argument sources are owned by
    // the shared edge traversal below, including both edges of one cond_br.
    fn environmentIdentity(self: *Graph, receiver: t.RegisterRef) Error!EnvironmentIdentity {
        const c=self.c;
        try c.charge(2); const definition=self.definitions[@intFromEnum(receiver)];
        if(definition.position>=0) {
            const producer = &self.f.blocks[definition.block].instructions[@intCast(definition.position)];
            if (producer.data == .environment_alloc)
                return .{ .allocation = producer.data.environment_alloc.environment };
            try c.step();
            if (!isEnvironmentForwarder(producer)) return .unknown;
            try c.charge(3);
            const source = producer.operands[0];
            if (!exact(self.carrierOf(receiver), self.carrierOf(source))) return .unknown;
            return .{ .source = source };
        }
        return if(definition.block==0).unknown else .{.parameter=definition.block};
    }
    fn ownedEnvironmentLayout(self: *Graph) Error!?t.EnvironmentRef {
        const c = self.c;
        const closures = &c.program.tables.mode.common.closures;
        for (closures.functions) |row| {
            try c.step();
            if (@intFromEnum(row.function) != self.function) continue;
            const layout = row.activation_environment orelse return null;
            try c.step();
            return if (@intFromEnum(closures.environments[@intFromEnum(layout)].owner) == self.function) layout else null;
        }
        return null;
    }

    fn environmentOrigins(
        self: *Graph,
        owned_layout: ?t.EnvironmentRef,
        calls: []const DirectEnvironmentCall,
    ) Error!?EnvironmentAllocations {
        if (!self.has_environment_access and calls.len == 0) return null;
        const c = self.c;
        const activation = if (self.has_environment_init) owned_layout orelse return error.InvalidShape else null;
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
        var proof = try EnvironmentProof.init(c, count, edge_capacity);
        defer proof.deinit();
        const origins = proof.origins;
        const foreign = proof.foreign;
        const pending = proof.pending;
        if (self.has_environment_access) for (self.f.blocks) |block| for (block.instructions) |*op| {
            try c.step();
            if (environmentAccessSlot(op) == null) continue;
            try c.step();
            try proof.need(op.operands[0]);
        };
        for (calls) |*call| {
            try c.step();
            try proof.need(call.receiver);
        }
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
                            const arguments=environmentEdgeArguments(&op,edge) orelse {
                                try c.step(); origins[index]=.unknown; continue;
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
        var mixed_access = false;
        if (self.has_environment_access) for (self.f.blocks) |block| for (block.instructions) |*op| {
            try c.step();
            if (environmentAccessSlot(op) == null) continue;
            try c.charge(3);
            const index = @intFromEnum(op.operands[0]);
            const origin_state = origins[index];
            mixed_access = mixed_access or origin_state == .mixed;
            if (op.data == .environment_init)
                try c.require((origin_state == .allocation or origin_state == .mixed) and !foreign[index]);
        };
        if (!mixed_access) for (calls) |*call| {
            try c.charge(2);
            if (origins[@intFromEnum(call.receiver)] == .mixed) {
                mixed_access = true;
                break;
            }
        };
        try c.charge(2 * count);
        const allocations = try c.allocator.alloc(?t.RegisterRef, count);
        errdefer c.allocator.free(allocations);
        for (origins, allocations) |origin_state, *allocation| {
            allocation.* = switch (origin_state) { .allocation => |ref| ref, else => null };
        }
        const checked_layout = if (mixed_access) try self.environmentMixedState(origins, calls) else null;
        return .{
            .direct = allocations,
            .checked_layout = checked_layout,
            .call_blocks_with_older_aliases = if (calls.len == 0 or checked_layout == owned_layout)
                zero
            else
                try self.environmentCallBlocksWithOlderAliases(owned_layout.?, calls, origins),
        };
    }

    fn environmentAccessSlot(op: *const ins.Instruction) ?t.EnvironmentSlotRef {
        return switch (op.data) {
            inline .environment_init, .environment_load, .environment_store => |v| v.slot,
            else => null,
        };
    }

    fn environmentInLayout(self: *const Graph, register: t.RegisterRef, layout: t.EnvironmentRef) bool {
        return exact(self.carrierOf(register), .{ .environment = layout });
    }

    fn environmentAllocCanRepeat(self: *Graph, start: usize) Error!bool {
        const c = self.c;
        try c.charge(zero.len + 3);
        var seen = zero;
        var pending: [256]usize = undefined;
        pending[0] = start;
        var size: usize = 1;
        var cursor: usize = 0;
        while (cursor < size) : (cursor += 1) {
            try c.charge(3);
            const row = &self.facts[pending[cursor]];
            for (row.successors[0..row.count]) |next| {
                try c.charge(4);
                if (next == start) return true;
                if (has(seen, next)) continue;
                put(&seen, next);
                pending[size] = next;
                size += 1;
            }
        }
        return false;
    }

    fn environmentOlderAliasAtEntry(self: *Graph, layout: t.EnvironmentRef, block: usize, origins: []const EnvironmentOrigin) Error!bool {
        const c = self.c;
        // The reverse origin walk starts at every Env access. Bottom rows
        // cannot contribute to a tracked Env observation.
        for (origins, self.definitions, self.f.registers) |origin_state, *definition, *register| {
            try c.charge(3);
            if (origin_state == .bottom or !exact(register.carrier, .{ .environment = layout })) continue;
            // The allocation's own result is assigned anew in this block.
            // Earlier definitions in the block can only forward an entry value.
            try c.charge(3 + zero.len);
            const available = if (definition.block == block)
                definition.position < 0
            else
                has(self.dom[block], definition.block);
            if (!available) continue;
            switch (origin_state) {
                .allocation => |root| {
                    try c.step();
                    if (self.definitions[@intFromEnum(root)].block == block) return true;
                },
                .mixed, .unknown => return true,
                .bottom => unreachable,
            }
        }
        return false;
    }

    fn environmentCallBlocksWithOlderAliases(
        self: *Graph,
        layout: t.EnvironmentRef,
        calls: []const DirectEnvironmentCall,
        origins: []const EnvironmentOrigin,
    ) Error!Bits {
        const c = self.c;
        try c.charge(3 * zero.len);
        var checked = zero;
        var blocked = zero;
        for (calls) |*call| {
            try c.charge(2);
            const origin_state = &origins[@intFromEnum(call.receiver)];
            if (origin_state.* != .allocation) continue;
            try c.charge(4 + zero.len);
            const allocation = origin_state.allocation;
            if (!self.environmentInLayout(allocation, layout)) continue;
            const block = self.definitions[@intFromEnum(allocation)].block;
            if (has(checked, block)) continue;
            try c.step();
            put(&checked, block);
            // A repeated allocation still defines the current instance if
            // no tracked receiver can refer to an older instance at entry.
            if (try self.environmentAllocCanRepeat(block) and
                try self.environmentOlderAliasAtEntry(layout, block, origins))
            {
                try c.step();
                put(&blocked, block);
            }
        }
        return blocked;
    }

    fn environmentMixedState(
        self: *Graph,
        origins: []const EnvironmentOrigin,
        calls: []const DirectEnvironmentCall,
    ) Error!?t.EnvironmentRef {
        const c = self.c;
        const closures = c.program.tables.mode.common.closures;
        var owner_layout: ?t.EnvironmentRef = null;
        for (closures.functions) |row| {
            try c.step();
            if (@intFromEnum(row.function) != self.function) continue;
            owner_layout = row.activation_environment;
            break;
        }
        const layout = owner_layout orelse return null;
        if (@intFromEnum(closures.environments[@intFromEnum(layout)].owner) != self.function) return null;
        const slot_count = closures.environments[@intFromEnum(layout)].slots.len;
        try c.charge(slot_count);
        const slots = try c.allocator.alloc(bool, slot_count);
        defer c.allocator.free(slots);
        @memset(slots, false);

        // Track only supported transports and observations of this layout.
        // A repeated allocation needs a separate entry alias check.
        try c.charge(zero.len);
        var repeat_blocks = zero;
        var roots: [4096]t.RegisterRef = undefined;
        var root_count: usize = 0;
        var has_mixed_observation = false;
        var next_call: usize = 0;
        for (self.f.blocks, 0..) |block, block_index| {
            try c.step();
            if (!self.facts[block_index].reachable) continue;
            const call_at_block = if (calls.len != 0) at_call: {
                try c.charge(2);
                break :at_call next_call < calls.len and calls[next_call].block == block_index;
            } else false;
            if (call_at_block) {
                try c.charge(4);
                const origin_state = &origins[@intFromEnum(calls[next_call].receiver)];
                if (origin_state.* == .unknown or origin_state.* == .bottom) return null;
                has_mixed_observation = has_mixed_observation or origin_state.* == .mixed;
                next_call += 1;
            }
            var has_allocation = false;
            for (block.parameters) |parameter| {
                try c.charge(2);
                if (block_index == 0 and self.environmentInLayout(parameter, layout)) return null;
            }
            for (block.instructions) |*op| {
                try c.charge(3);
                if (environmentAccessSlot(op)) |slot| {
                    if (self.environmentInLayout(op.operands[0], layout)) {
                        const origin_state = origins[@intFromEnum(op.operands[0])];
                        if (origin_state == .unknown or origin_state == .bottom) return null;
                        has_mixed_observation = has_mixed_observation or origin_state == .mixed;
                        slots[@intFromEnum(slot)] = true;
                    }
                }
                const result_in_layout = if (op.result) |result| self.environmentInLayout(result, layout) else false;
                if (result_in_layout) {
                    switch (op.data) {
                        .environment_alloc => {
                            roots[root_count] = op.result.?;
                            root_count += 1;
                            has_allocation = true;
                        },
                        .domain_copy, .domain_view, .eh_carrier, .eh_assertion => {
                            try c.step();
                            if (!self.environmentInLayout(op.operands[0], layout)) return null;
                        },
                        else => return null,
                    }
                }
                for (op.operands, 0..) |operand, index| {
                    try c.charge(2);
                    if (!self.environmentInLayout(operand, layout)) continue;
                    switch (op.data) {
                        .br, .cond_br, .eh_route => {},
                        .domain_copy, .domain_view, .eh_carrier, .eh_assertion => if (!result_in_layout or index != 0) return null,
                        .environment_init, .environment_load, .environment_store => if (index != 0) return null,
                        .eh_invoke => if (index != 0 or !call_at_block) return null,
                        else => return null,
                    }
                }
            }
            if (has_allocation and try self.environmentAllocCanRepeat(block_index)) {
                if (try self.environmentOlderAliasAtEntry(layout, block_index, origins)) return null;
                try c.step();
                put(&repeat_blocks, block_index);
            }
            const terminator = &block.instructions[block.instructions.len - 1];
            if (environmentEdgeArguments(terminator, 0) == null) {
                const edges = &self.facts[block_index];
                for (edges.successors[0..edges.count]) |next| {
                    try c.step();
                    for (self.f.blocks[next].parameters) |parameter| {
                        try c.charge(2);
                        if (self.environmentInLayout(parameter, layout)) return null;
                    }
                }
            }
        }
        if (!has_mixed_observation) return null;
        try c.charge(3);
        var arena = std.heap.ArenaAllocator.init(c.allocator);
        defer arena.deinit();
        var needs: EnvironmentCalleeSlots = .empty;
        defer needs.deinit(c.allocator);
        var call_sites: EnvironmentCallSites = .empty;
        defer call_sites.deinit(c.allocator);
        for (calls) |*call| {
            try c.row(DirectEnvironmentCall);
            const observed = try self.environmentSlotsForCall(call.callee, layout, &needs, arena.allocator());
            for (observed) |slot| {
                try c.step();
                slots[@intFromEnum(slot)] = true;
                try rememberEnvironmentCallSite(c, &call_sites, .{ .receiver = call.receiver, .slot = slot, .block = call.block });
            }
        }
        const entry_aliases = try self.environmentEntryAliases(layout);
        defer c.allocator.free(entry_aliases);
        for (slots, 0..) |used, slot| {
            try c.step();
            if (!used) continue;
            for (roots[0..root_count]) |root| {
                try c.charge(2 + zero.len);
                const repeat = has(repeat_blocks, self.definitions[@intFromEnum(root)].block);
                try self.environmentTrackSlot(layout, root, @enumFromInt(slot), entry_aliases, repeat, &call_sites);
            }
        }
        return layout;
    }

    // Track one allocation and slot at a time. A state records the initialized
    // bit together with precisely the SSA values that denote this allocation.
    // Distinct predecessor facts are merged only when both parts agree.
    const EnvironmentAliases = [64]u64;
    const no_environment_aliases: EnvironmentAliases = @splat(0);
    fn markEnvironmentAlias(aliases: *EnvironmentAliases, target: usize, present: bool) void {
        const mask = @as(u64, 1) << @as(u6, @truncate(target));
        const word = &aliases[target / 64];
        if (present) word.* |= mask else word.* &= ~mask;
    }

    fn environmentEntryAliases(self: *Graph, layout: t.EnvironmentRef) Error![]EnvironmentAliases {
        const c = self.c;
        const count = self.f.blocks.len;
        try c.charge(1 + count * no_environment_aliases.len);
        const masks = try c.allocator.alloc(EnvironmentAliases, count);
        errdefer c.allocator.free(masks);
        @memset(masks, no_environment_aliases);
        for (self.f.registers, self.definitions, 0..) |register, definition, index| {
            try c.charge(3);
            if (!exact(register.carrier, .{ .environment = layout })) continue;
            for (masks, 0..) |*mask, block| {
                try c.charge(3 + zero.len);
                if (definition.block != block and has(self.dom[block], definition.block)) {
                    try c.step();
                    markEnvironmentAlias(mask, index, true);
                }
            }
        }
        return masks;
    }

    const EnvironmentState = struct {
        aliases: EnvironmentAliases,
        initialized: bool,
        block: usize,
        next: ?usize = null,

        fn mark(self: *EnvironmentState, target: t.RegisterRef, present: bool) void {
            markEnvironmentAlias(&self.aliases, @intFromEnum(target), present);
        }

        fn includes(self: *const EnvironmentState, target: t.RegisterRef) bool {
            const index = @intFromEnum(target);
            return self.aliases[index / 64] & (@as(u64, 1) << @as(u6, @truncate(index))) != 0;
        }
    };
    const environment_state_words = @sizeOf(EnvironmentState) / @sizeOf(u64);

    fn environmentEnqueue(
        c: *Context,
        states: *std.ArrayList(EnvironmentState),
        heads: []?usize,
        state: *const EnvironmentState,
        words: usize,
    ) Error!void {
        try c.step();
        var cursor = heads[state.block];
        while (cursor) |index| {
            try c.charge(3);
            const known = &states.items[index];
            if (known.initialized == state.initialized) {
                try c.charge(words);
                if (std.mem.eql(u64, known.aliases[0..words], state.aliases[0..words])) return;
            }
            cursor = known.next;
        }
        if (states.items.len == states.capacity) {
            const capacity = @max(8, 2 * states.capacity);
            try c.charge(1 + (capacity + states.items.len) * environment_state_words);
            try states.ensureTotalCapacityPrecise(c.allocator, capacity);
        }
        try c.charge(5 + environment_state_words);
        const stored = states.addOneAssumeCapacity();
        stored.* = state.*;
        stored.next = heads[state.block];
        heads[state.block] = states.items.len - 1;
    }

    fn environmentTrackSlot(
        self: *Graph,
        layout: t.EnvironmentRef,
        root: t.RegisterRef,
        slot: t.EnvironmentSlotRef,
        entry_aliases: []const EnvironmentAliases,
        reset_at_allocation: bool,
        call_sites: *const EnvironmentCallSites,
    ) Error!void {
        const c = self.c;
        const words = (self.f.registers.len + 63) / 64;
        var heads: [256]?usize = undefined;
        try c.charge(1 + self.f.blocks.len + no_environment_aliases.len);
        const has_call_sites = call_sites.count() != 0;
        @memset(heads[0..self.f.blocks.len], null);
        var states: std.ArrayList(EnvironmentState) = .empty;
        defer states.deinit(c.allocator);
        try environmentEnqueue(c, &states, &heads, &.{ .aliases = no_environment_aliases, .initialized = false, .block = 0 }, words);
        var cursor: usize = 0;
        while (cursor < states.items.len) : (cursor += 1) {
            try c.charge(5 + environment_state_words);
            var state = states.items[cursor];
            const block = &self.f.blocks[state.block];
            for (block.instructions) |*op| {
                try c.charge(3);
                if (op.result) |result| {
                    if (self.environmentInLayout(result, layout)) {
                        try c.charge(4);
                        if (op.data == .environment_alloc) {
                            const selected = result == root;
                            if (selected and reset_at_allocation) {
                                // The entry proof excludes observations of the
                                // previous instance. Drop its dormant aliases.
                                try c.charge(2 + no_environment_aliases.len);
                                state.aliases = no_environment_aliases;
                                state.initialized = false;
                            }
                            state.mark(result, selected);
                        } else state.mark(result, state.includes(op.operands[0]));
                    }
                }
                if (environmentAccessSlot(op)) |access| {
                    try c.charge(3);
                    if (access != slot or !state.includes(op.operands[0])) continue;
                    if (op.data == .environment_init) {
                        try c.require(!state.initialized);
                        state.initialized = true;
                    } else try c.require(state.initialized);
                }
            }
            const terminator = &block.instructions[block.instructions.len - 1];
            if (has_call_sites) {
                try c.charge(2);
                if (terminator.data == .eh_invoke and terminator.operands.len != 0) {
                    try c.row(EnvironmentCallSite);
                    const receiver = terminator.operands[0];
                    if (call_sites.contains(.{ .receiver = receiver, .slot = slot, .block = state.block })) {
                        try c.step();
                        if (state.includes(receiver)) try c.require(state.initialized);
                    }
                }
            }
            const facts = &self.facts[state.block];
            for (facts.successors[0..facts.count], 0..) |successor, edge| {
                try c.charge(4 + environment_state_words);
                var next = state;
                next.block = successor;
                // Dominating values can still be observed. The successor's
                // parameters are replaced by the parallel edge assignments.
                try c.charge(2 * words);
                for (next.aliases[0..words], entry_aliases[successor][0..words]) |*word, mask| word.* &= mask;
                if (environmentEdgeArguments(terminator, edge)) |arguments| {
                    for (self.f.blocks[successor].parameters, arguments) |target, source| {
                        try c.charge(3);
                        if (self.environmentInLayout(target, layout)) next.mark(target, state.includes(source));
                    }
                }
                try environmentEnqueue(c, &states, &heads, &next, words);
            }
        }
    }

    const EnvironmentCell = struct { receiver: t.RegisterRef, slot: t.EnvironmentSlotRef };
    const EnvironmentCallSite = struct { receiver: t.RegisterRef, slot: t.EnvironmentSlotRef, block: usize };
    const EnvironmentCells = std.AutoHashMapUnmanaged(EnvironmentCell, void);
    const EnvironmentCallSites = std.AutoHashMapUnmanaged(EnvironmentCallSite, void);
    const EnvironmentCalleeSlots = std.AutoHashMapUnmanaged(t.FunctionRef, []const t.EnvironmentSlotRef);

    fn rememberEnvironmentCallSite(c: *Context, sites: *EnvironmentCallSites, site: EnvironmentCallSite) Error!void {
        try c.row(EnvironmentCallSite);
        try environmentMapGrowth(c, sites, 4);
        _ = try sites.getOrPut(c.allocator, site);
    }

    fn environmentSlotsForCall(
        self: *Graph,
        callee: t.FunctionRef,
        layout: t.EnvironmentRef,
        needs: *EnvironmentCalleeSlots,
        allocator: std.mem.Allocator,
    ) Error![]const t.EnvironmentSlotRef {
        const c = self.c;
        try c.charge(4);
        try environmentMapGrowth(c, needs, 4);
        const entry = try needs.getOrPut(c.allocator, callee);
        if (!entry.found_existing)
            entry.value_ptr.* = try self.directCalleeEnvironmentSlots(callee, layout, allocator);
        return entry.value_ptr.*;
    }

    fn environmentMapGrowth(c: *Context, map: anytype, row_words: usize) Error!void {
        const capacity = @as(usize, map.capacity());
        const used = @as(usize, map.count());
        // The insert-only default-load maps grow before lookup. Prepay old
        // buckets, new metadata and the retained key/value rows.
        if (used == capacity * std.hash_map.default_max_load_percentage / 100)
            try c.charge(capacity + @max(8, 2 * capacity) + row_words * used);
    }

    fn rememberEnvironmentCell(c: *Context, pairs: *EnvironmentCells, cell: EnvironmentCell) Error!void {
        try c.row(EnvironmentCell);
        try environmentMapGrowth(c, pairs, 3);
        _ = try pairs.getOrPut(c.allocator, cell);
    }

    fn matchesDirectEnvironment(
        c: *Context,
        aliases: ?std.DynamicBitSetUnmanaged,
        input: t.RegisterRef,
        value: t.RegisterRef,
    ) Error!bool {
        try c.step();
        if (value == input) return true;
        if (aliases) |known| {
            try c.step();
            return known.isSet(@intFromEnum(value));
        }
        return false;
    }

    fn directCalleeEnvironmentAliases(
        c: *Context,
        target: *const model.Function,
        input: t.RegisterRef,
        layout: t.EnvironmentRef,
        reachable: []const usize,
        edge_capacity: usize,
    ) Error!std.DynamicBitSetUnmanaged {
        const carrier: t.Carrier = .{ .environment = layout };
        var proof = try EnvironmentProof.init(c, target.registers.len, edge_capacity);
        defer proof.deinit();
        // The sole positive seed is the hidden entry Env, whose identity is
        // preserved by an exact-carrier copy or by every incoming CFG edge.
        for (target.blocks[0].parameters) |parameter| {
            try c.charge(3);
            const index = @intFromEnum(parameter);
            if (!exact(target.registers[index].carrier, carrier)) continue;
            try proof.need(parameter);
            proof.origins[index] = if (parameter == input) .{ .allocation = input } else .unknown;
        }
        for (reachable) |block_index| {
            try c.charge(2);
            const block = &target.blocks[block_index];
            for (block.instructions) |*op| {
                try c.step();
                const result = op.result orelse continue;
                try c.charge(3);
                const index = @intFromEnum(result);
                if (!exact(target.registers[index].carrier, carrier)) continue;
                try proof.need(result);
                if (isEnvironmentForwarder(op)) {
                    try c.charge(3);
                    const source = op.operands[0];
                    if (exact(target.registers[@intFromEnum(source)].carrier, carrier)) {
                        try proof.link(source, result);
                        continue;
                    }
                }
                try c.step();
                proof.origins[index] = .unknown;
            }
            try c.charge(2);
            const terminator = &block.instructions[block.instructions.len - 1];
            const successors = edgeTargets(terminator);
            for (successors.blocks[0..successors.count], 0..) |next, edge| {
                try c.charge(3);
                const parameters = target.blocks[next].parameters;
                if (parameters.len == 0) continue;
                const arguments = environmentEdgeArguments(terminator, edge);
                for (parameters, 0..) |parameter, index| {
                    try c.charge(3);
                    const register = @intFromEnum(parameter);
                    if (!exact(target.registers[register].carrier, carrier)) continue;
                    try proof.need(parameter);
                    if (arguments) |values| {
                        try c.charge(3);
                        const source = values[index];
                        if (exact(target.registers[@intFromEnum(source)].carrier, carrier)) {
                            try proof.link(source, parameter);
                            continue;
                        }
                    }
                    try c.step();
                    proof.origins[register] = .unknown;
                }
            }
        }
        try proof.propagate();
        const mask_bits = @bitSizeOf(std.DynamicBitSetUnmanaged.MaskInt);
        const registers = target.registers.len;
        try c.charge(4 + (registers + mask_bits - 1) / mask_bits);
        var aliases = try std.DynamicBitSetUnmanaged.initEmpty(c.allocator, registers);
        errdefer aliases.deinit(c.allocator);
        for (proof.origins, 0..) |*origin_state, index| {
            try c.charge(2);
            if (origin_state.* == .allocation and origin_state.allocation == input) {
                try c.step();
                aliases.set(index);
            }
        }
        return aliases;
    }

    fn directCalleeEnvironmentSlots(
        self: *Graph,
        first: t.FunctionRef,
        layout: t.EnvironmentRef,
        allocator: std.mem.Allocator,
    ) Error![]const t.EnvironmentSlotRef {
        const c = self.c;
        const common = &c.program.tables.mode.common;
        const slots = common.closures.environments[@intFromEnum(layout)].slots;
        if (slots.len == 0) return &.{};
        try c.charge(slots.len + 5);
        const seen_slots = try allocator.alloc(bool, slots.len);
        @memset(seen_slots, false);
        var needs: std.ArrayListUnmanaged(t.EnvironmentSlotRef) = .empty;
        var seen_functions: ?std.DynamicBitSetUnmanaged = null;
        defer if (seen_functions) |*seen| seen.deinit(c.allocator);
        var pending_functions: std.ArrayListUnmanaged(t.FunctionRef) = .empty;
        defer pending_functions.deinit(c.allocator);
        var pending_blocks: [256]usize = undefined;
        var current = first;
        var function_cursor: usize = 0;
        while (true) {
            try c.charge(zero.len + 5);
            const target = &c.program.functions[@intFromEnum(current)];
            try c.require(target.blocks[0].parameters.len != 0);
            const input = target.blocks[0].parameters[0];
            try c.require(exact(target.registers[@intFromEnum(input)].carrier, .{ .environment = layout }));
            var seen_blocks = zero;
            pending_blocks[0] = 0;
            put(&seen_blocks, 0);
            var count: usize = 1;
            var cursor: usize = 0;
            var edge_capacity = target.registers.len;
            var has_environment_parameters = false;
            while (cursor < count) : (cursor += 1) {
                try c.charge(3);
                const block = &target.blocks[pending_blocks[cursor]];
                if (cursor != 0 and !has_environment_parameters) {
                    for (block.parameters) |parameter| {
                        try c.charge(2);
                        if (!exact(target.registers[@intFromEnum(parameter)].carrier, .{ .environment = layout })) continue;
                        has_environment_parameters = true;
                        break;
                    }
                }
                try c.charge(2);
                const successors = edgeTargets(&block.instructions[block.instructions.len - 1]);
                for (successors.blocks[0..successors.count]) |next| {
                    try c.charge(5 + zero.len);
                    edge_capacity += target.blocks[next].parameters.len;
                    if (has(seen_blocks, next)) continue;
                    put(&seen_blocks, next);
                    pending_blocks[count] = next;
                    count += 1;
                }
            }
            // With no Env block parameters, a dominating copy is available
            // when its use is visited in FIFO order.
            var aliases: ?std.DynamicBitSetUnmanaged = if (has_environment_parameters)
                try directCalleeEnvironmentAliases(c, target, input, layout, pending_blocks[0..count], edge_capacity)
            else
                null;
            defer if (aliases) |*known| known.deinit(c.allocator);
            for (pending_blocks[0..count]) |block_index| {
                try c.charge(2);
                const block = &target.blocks[block_index];
                for (block.instructions) |*op| {
                    try c.step();
                    const slot = switch (op.data) {
                        inline .environment_load, .environment_store => |v| v.slot,
                        else => {
                            if (has_environment_parameters) continue;
                            try c.step();
                            if (!isEnvironmentForwarder(op)) continue;
                            try c.charge(2);
                            if (!try matchesDirectEnvironment(c, aliases, input, op.operands[0])) continue;
                            try c.charge(3);
                            const result = @intFromEnum(op.result.?);
                            if (!exact(target.registers[result].carrier, .{ .environment = layout })) continue;
                            if (aliases == null) {
                                const mask_bits = @bitSizeOf(std.DynamicBitSetUnmanaged.MaskInt);
                                const registers = target.registers.len;
                                try c.charge(4 + (registers + mask_bits - 1) / mask_bits);
                                aliases = try std.DynamicBitSetUnmanaged.initEmpty(c.allocator, registers);
                            }
                            try c.step();
                            aliases.?.set(result);
                            continue;
                        },
                    };
                    try c.charge(3);
                    if (!try matchesDirectEnvironment(c, aliases, input, op.operands[0]) or seen_slots[@intFromEnum(slot)]) continue;
                    if (needs.items.len == needs.capacity) try c.charge(needs.items.len + 1);
                    try c.charge(2);
                    seen_slots[@intFromEnum(slot)] = true;
                    try needs.append(allocator, slot);
                }
                try c.charge(2);
                const terminator = &block.instructions[block.instructions.len - 1];
                if (terminator.data != .eh_invoke) continue;
                try c.charge(3);
                if (terminator.operands.len == 0 or !try matchesDirectEnvironment(c, aliases, input, terminator.operands[0])) continue;
                try c.charge(4);
                const callee = terminator.data.eh_invoke.callee;
                const index = @intFromEnum(callee);
                const function = &c.program.functions[index];
                const abi = &common.abis[@intFromEnum(function.abi)];
                if (function.role != .ordinary or abi.lexical_environment != layout) continue;
                // All retained edges carry the same instance in the target's
                // first entry parameter. Mark on discovery so recursive calls
                // scan each reachable body once.
                try c.charge(2);
                if (seen_functions == null) {
                    const mask_bits = @bitSizeOf(std.DynamicBitSetUnmanaged.MaskInt);
                    const functions = c.program.functions.len;
                    try c.charge(4 + (functions + mask_bits - 1) / mask_bits);
                    seen_functions = try std.DynamicBitSetUnmanaged.initEmpty(c.allocator, functions);
                    seen_functions.?.set(@intFromEnum(first));
                }
                if (seen_functions.?.isSet(index)) continue;
                if (pending_functions.items.len == pending_functions.capacity)
                    try c.charge(pending_functions.items.len + 1);
                try c.charge(2);
                seen_functions.?.set(index);
                try pending_functions.append(c.allocator, callee);
            }
            try c.charge(3);
            if (function_cursor == pending_functions.items.len) break;
            current = pending_functions.items[function_cursor];
            function_cursor += 1;
        }
        return needs.items;
    }

    const DirectEnvironmentCall = struct { receiver: t.RegisterRef, callee: t.FunctionRef, block: usize };

    fn directEnvironmentCalls(
        self: *Graph,
        owned_layout: ?t.EnvironmentRef,
        buffer: *[256]DirectEnvironmentCall,
    ) Error![]const DirectEnvironmentCall {
        if (!self.has_direct_environment_call) return &.{};
        const layout = owned_layout orelse return &.{};
        const c = self.c;
        const common = &c.program.tables.mode.common;
        try c.step();
        if (common.closures.environments[@intFromEnum(layout)].slots.len == 0) return &.{};
        var count: usize = 0;
        for (self.f.blocks, 0..) |block, block_index| {
            try c.charge(3);
            if (!self.facts[block_index].reachable) continue;
            const op = &block.instructions[block.instructions.len - 1];
            if (op.data != .eh_invoke) continue;
            try c.charge(4);
            const callee = op.data.eh_invoke.callee;
            const target = &c.program.functions[@intFromEnum(callee)];
            const abi = &common.abis[@intFromEnum(target.abi)];
            if (target.role != .ordinary or abi.lexical_environment != layout) continue;
            try c.row(DirectEnvironmentCall);
            buffer[count] = .{ .receiver = op.operands[0], .callee = callee, .block = block_index };
            count += 1;
        }
        return buffer[0..count];
    }

    fn observeDirectEnvironmentCalls(
        self: *Graph,
        layout: t.EnvironmentRef,
        calls: []const DirectEnvironmentCall,
        proven: *const EnvironmentAllocations,
        pairs: *EnvironmentCells,
        sites: *EnvironmentCallSites,
    ) Error!void {
        const c = self.c;
        try c.charge(4);
        var arena = std.heap.ArenaAllocator.init(c.allocator);
        defer arena.deinit();
        var needs: EnvironmentCalleeSlots = .empty;
        defer needs.deinit(c.allocator);
        for (calls) |*call| {
            try c.row(DirectEnvironmentCall);
            try c.charge(3 + zero.len);
            const receiver = proven.direct[@intFromEnum(call.receiver)] orelse continue;
            if (!self.environmentInLayout(receiver, layout)) continue;
            const allocation_block = self.definitions[@intFromEnum(receiver)].block;
            if (has(proven.call_blocks_with_older_aliases, allocation_block)) continue;
            const observed = try self.environmentSlotsForCall(call.callee, layout, &needs, arena.allocator());
            for (observed) |slot| {
                try rememberEnvironmentCell(c, pairs, .{ .receiver = receiver, .slot = slot });
                try rememberEnvironmentCallSite(c, sites, .{ .receiver = receiver, .slot = slot, .block = call.block });
            }
        }
    }

    fn environmentDirectCellState(
        self: *Graph,
        proven: EnvironmentAllocations,
        owned_layout: ?t.EnvironmentRef,
        calls: []const DirectEnvironmentCall,
    ) Error!void {
        const c=self.c;
        const allocations = proven.direct;
        var pairs: EnvironmentCells = .empty; defer pairs.deinit(c.allocator);
        var call_sites: EnvironmentCallSites = .empty; defer call_sites.deinit(c.allocator);
        if (self.has_environment_access) for (self.f.blocks) |block| for (block.instructions) |*op| {
            try c.step();
            const slot = environmentAccessSlot(op) orelse continue;
            try c.step(); const allocation=allocations[@intFromEnum(op.operands[0])] orelse continue;
            if (proven.checked_layout) |layout| {
                try c.step();
                if (self.environmentInLayout(allocation, layout)) continue;
            }
            try rememberEnvironmentCell(c, &pairs, .{ .receiver = allocation, .slot = slot });
        };
        if (calls.len != 0 and proven.checked_layout != owned_layout)
            try self.observeDirectEnvironmentCalls(owned_layout.?, calls, &proven, &pairs, &call_sites);
        const has_call_sites = call_sites.count() != 0;
        try c.charge(@as(usize,pairs.capacity())+1); // Include empty buckets before any next().
        var iterator=pairs.keyIterator();
        while(true) {
            try c.step(); const pair=(iterator.next() orelse break).*;
            const count=self.f.blocks.len;
            // The unique original result resets this instance only when its
            // allocation executes again. Proven transparent receivers share
            // that cell. A direct call can observe it, without changing state.
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
                        .eh_invoke => if (has_call_sites) {
                            // The child sees this binding before either of
                            // the caller's continuations.
                            try c.row(EnvironmentCallSite);
                            if (call_sites.contains(.{ .receiver = pair.receiver, .slot = pair.slot, .block = b }))
                                try c.require(state == 2);
                        },
                        else => {},
                    }
                }
            }
        }
    }
    fn directClosureGlobalUses(self: *Graph, target: t.FunctionRef, owned: []const t.GlobalRef, used: []bool, observed: *GlobalRefs) Error!void {
        // An imported ordinary call can reach the initializer's own Globals
        // through a callback. Visit exact targets from block 0, once per body.
        const c=self.c; try c.charge(3); const functions=c.program.functions;
        const first=functions[@intFromEnum(target)];
        if(first.role!=.ordinary)return;
        const globals=c.program.tables.mode.common.modules.globals;
        const mask_bits=@bitSizeOf(std.DynamicBitSetUnmanaged.MaskInt);
        try c.charge(4+functions.len+(functions.len+mask_bits-1)/mask_bits);
        const pending_functions=try c.allocator.alloc(t.FunctionRef,functions.len);
        defer c.allocator.free(pending_functions);
        var seen_functions=try std.DynamicBitSetUnmanaged.initEmpty(c.allocator,functions.len);
        defer seen_functions.deinit(c.allocator);
        pending_functions[0]=target; seen_functions.set(@intFromEnum(target));
        var pending_blocks: [256]usize=undefined; var function_cursor: usize=0; var function_count: usize=1;
        while(function_cursor<function_count) : (function_cursor+=1) {
            try c.step();
            const function=&functions[@intFromEnum(pending_functions[function_cursor])];
            var seen_blocks=zero;
            try c.charge(2); pending_blocks[0]=0; put(&seen_blocks,0);
            var block_cursor: usize=0; var block_count: usize=1;
            while(block_cursor<block_count) : (block_cursor+=1) {
                try c.step(); const block=function.blocks[pending_blocks[block_cursor]];
                for(block.instructions) |op| {
                    try c.step(); const ref=switch(op.data) {
                        .eh_invoke=>|v| {
                            try c.charge(3); const index=@intFromEnum(v.callee);
                            if(!seen_functions.isSet(index)) {
                                seen_functions.set(index);
                                const callee=functions[index];
                                if(callee.role==.ordinary) {
                                    try c.step(); pending_functions[function_count]=v.callee; function_count+=1;
                                }
                            }
                            continue;
                        },
                        .global_load=>|v| v.global,
                        .global_store=>|v| if(v.initialize)continue else v.global,
                        else=>continue,
                    };
                    for(owned) |own| {
                        try c.step(); if(own!=ref)continue;
                        try c.charge(2); const index=@intFromEnum(ref);
                        if(globals[index].source==self.f.source) {
                            try observed.put(c.allocator,ref,{});
                            used[index]=true;
                        }
                        break;
                    }
                }
                try c.step(); const next=edgeTargets(&block.instructions[block.instructions.len-1]);
                for(next.blocks[0..next.count]) |successor| {
                    try c.step(); if(has(seen_blocks,successor))continue;
                    try c.step(); put(&seen_blocks,successor); pending_blocks[block_count]=successor; block_count+=1;
                }
            }
        }
    }
    fn globalInitialization(self: *Graph, initializer_callees: []const ?t.FunctionRef) Error!void {
        const c=self.c; const modules=c.program.tables.mode.common.modules; const globals=modules.globals;
        // GlobalRef identifies one program cell. Permission/defining-module
        // ownership remains the independent module-contracts obligation.
        try c.charge(globals.len);
        const used=try c.allocator.alloc(bool,globals.len); defer c.allocator.free(used); @memset(used,false);
        var own_globals: []const t.GlobalRef=&.{};
        for(modules.modules) |module| {
            try c.step(); if(@intFromEnum(module.initializer)==self.function and module.source==self.f.source) { own_globals=module.globals; break; }
        }
        var callee_globals = std.AutoHashMapUnmanaged(t.FunctionRef, GlobalRefs){};
        defer {
            var entries=callee_globals.valueIterator();
            while(entries.next()) |entry| entry.deinit(c.allocator);
            callee_globals.deinit(c.allocator);
        }
        for(self.f.blocks,0..) |block,b| {
            try c.step(); if(!self.facts[b].reachable)continue;
            for(block.instructions) |op| {
                try c.step(); switch(op.data) {
                    inline .global_load,.global_store=>|v| {
                        const index=@intFromEnum(v.global); if(globals[index].source==self.f.source)used[index]=true;
                    },
                    inline .eh_invoke,.eh_invoke_indirect=>|v,kind| if(own_globals.len!=0) {
                        try c.step();
                        const callee=if(kind==.eh_invoke) v.callee else initializer_callees[b] orelse continue;
                        const entry=try callee_globals.getOrPut(c.allocator,callee);
                        if(!entry.found_existing) {
                            entry.value_ptr.*=.empty;
                            try self.directClosureGlobalUses(callee,own_globals,used,entry.value_ptr);
                        }
                    },
                    else=>{},
                }
            }
        }
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
                        inline .eh_invoke,.eh_invoke_indirect=>|v,kind| if(own_globals.len!=0 and state!=2) {
                            try c.charge(2);
                            const callee=if(kind==.eh_invoke) v.callee else initializer_callees[b] orelse continue;
                            const observed=callee_globals.getPtr(callee) orelse return error.InvalidShape;
                            try c.require(!observed.contains(ref));
                        },
                        else=>{},
                    }
                }
            }
        }
        // Callee observations do not change either continuation's state.
        // Dynamic targets, other modules and Env instance state retain their
        // separate proof obligations.
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
        try self.usesDom(); try self.entryAbi();
        var call_buffer: [256]?t.FunctionRef=undefined;
        const initializer_callees: ?[]?t.FunctionRef=if(self.mode==.common and self.f.role==.module_initializer) rows: {
            const callees=call_buffer[0..self.f.blocks.len];
            try self.c.charge(callees.len);
            @memset(callees,null);
            break :rows callees;
        }else null;
        try self.operations(initializer_callees);
        if (self.mode == .common and (self.has_environment_access or self.has_direct_environment_call)) {
            const owned_layout = if (self.has_environment_init or self.has_direct_environment_call)
                try self.ownedEnvironmentLayout()
            else
                null;
            var call_buffer_storage: [256]DirectEnvironmentCall = undefined;
            const calls = try self.directEnvironmentCalls(owned_layout, &call_buffer_storage);
            if (try self.environmentOrigins(owned_layout, calls)) |allocations| {
                defer self.c.allocator.free(allocations.direct);
                try self.environmentDirectCellState(allocations, owned_layout, calls);
            }
        }
        if(initializer_callees) |callees| try self.globalInitialization(callees);
        try self.numeric(); try self.fuel();
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
