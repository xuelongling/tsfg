// SPDX-License-Identifier: MIT
// Independent actual may-flow over owned wire17 instructions, not a fixed-upper
// solver. Missing caller values remain unresolved; representation maxima,
// permitted target rows and publication bounds never initialize actual values.
const std = @import("std");
const model = @import("wire-program-model.zig");
const t = model.types;
const ins = model.instruction;
pub const facts = @import("wire-program-actual-facts.zig");
const Context = facts.Context;
pub const Error = facts.Error;
const V = facts.OwnedValue;
const Heap = facts.Heap;
const relation = @import("wire-program-region-holding.zig");
const region_data = @import("wire-program-actual-data.zig");
const host_binding = @import("wire-program-host-binding-check.zig");
const receiver_actual = @import("wire-program-receiver-actual.zig");
const entry_contracts = @import("wire-program-reference-contracts-check.zig");

pub const Relation = enum { exact_closed, known_covered, derived, unresolved, unobserved };
pub const TargetObservation = struct {
    location: facts.Location,
    known: std.ArrayListUnmanaged(t.FunctionRef)=.empty,
    unresolved: bool=false,
    reached: bool=false,
    relation: Relation=.unobserved,
};
pub const Invocation = struct {
    function: t.FunctionRef,
    parent: ?facts.Site,
    root: bool,
    repeated: bool,
    activation: usize,
    region_scope: ?relation.ScopeRef=null,
    unresolved: bool=false,
    // Reasons remain independent: a fixed receiver upper gap is NOT evidence
    // that the actual entry frame is unknown. Neither clears unresolved.
    actual_unresolved: bool=false,
    receiver_upper_gap: bool=false,
    arguments: []V,
    entry: Heap=.{},
    returned: V=.{}, thrown: V=.{},
    normal_heap: Heap=.{}, language_heap: Heap=.{},
    entry_relations: relation.Heap=.{},
    normal_relations: relation.Heap=.{}, language_relations: relation.Heap=.{},
    normal: bool=false, language: bool=false,
    entry_frames: facts.FrameStore=.{}, normal_frames: facts.FrameStore=.{}, language_frames: facts.FrameStore=.{},
    receiver_lifetimes: facts.ReceiverLifetimes=.{},
};
pub const Analysis = struct {
    owner: ?*const Context=null,
    final_replay_complete: bool=false,
    receiver_calls: std.ArrayListUnmanaged(facts.CallEdge)=.empty,
    frames: std.ArrayListUnmanaged(region_data.FrameInfo)=.empty,
    // Passive facts. Neither construction nor a known-subset comparison is an
    // admission marker; unresolved inputs and unavailable region correlation
    // must be consumed explicitly by later effects/borrow clients.
    objects: std.ArrayListUnmanaged(facts.ObjectInfo)=.empty,
    cells: std.ArrayListUnmanaged(facts.CellInfo)=.empty,
    invocations: std.ArrayListUnmanaged(*Invocation)=.empty,
    contexts: std.ArrayListUnmanaged(facts.ContextInfo)=.empty,
    observations: std.ArrayListUnmanaged(TargetObservation)=.empty,
    creation_storage: std.ArrayListUnmanaged(std.ArrayListUnmanaged(facts.Site))=.empty,
    unresolved: bool=false,
    // These are derived current-version facts, not a coverage/admission bit.
    // External/unscoped alternatives remain unresolved in each Value.
    region_nodes: std.ArrayListUnmanaged(relation.Node)=.empty,
    region_scopes: std.ArrayListUnmanaged(relation.Scope)=.empty,

    pub const ReceiverEntry = struct { construction: t.ConstructionIndex, new_target: t.TypeRef, scalar_fields: []const t.FieldRef };
    fn strictReceiverCaller(c: *Context, ref: t.FunctionRef, target: t.FunctionRef, construction: t.ConstructionIndex) Error!bool {
        const v=&c.program.tables.mode.common; const f=&c.program.functions[@intFromEnum(ref)]; const abi=&v.abis[@intFromEnum(f.abi)];
        try c.charge(8);
        if((f.role!=.ordinary and f.role!=.module_initializer) or abi.parameters.len!=0 or abi.argument_types.len!=0 or abi.receiver!=null or abi.receiver_frame!=null or abi.construction!=null or abi.lexical_environment!=null or f.blocks[0].parameters.len!=0)return false;
        for(v.modules.modules) |*module| { try c.step(); if(module.external and module.source==f.source)return false; }
        var creates:usize=0; var calls:usize=0;
        for(f.registers) |*reg| { try c.step(); if(reg.carrier==.cell or reg.carrier==.environment or reg.carrier==.initialization)return false; }
        for(f.blocks) |*block| { try c.step(); for(block.instructions) |*op| {
            try c.step(); switch(op.data) {
                .fuel,.br,.@"return",.eh_raise,.eh_unreachable,.const_i32,.const_integer,.const_bool,.const_float=>{},
                .domain_literal=>|row|switch(v.types[@intFromEnum(row.actual_type)].kind){.scalar,.@"undefined",.@"null",.@"void"=>{},else=>return false},
                .domain_view=>{
                    const a=&f.registers[@intFromEnum(op.operands[0])]; const b=&f.registers[@intFromEnum(op.result.?)]; try c.charge(2);
                    if(a.view!=b.view or !std.meta.eql(a.carrier,b.carrier))return false;
                },
                .receiver_create=>|row|{ creates+=1; if(row.construction!=construction or row.new_target!=v.members.constructions[@intFromEnum(construction)].owner)return false; },
                .eh_invoke=>|row|{ calls+=1; if(row.callee!=target or op.operands.len!=1)return false; },
                else=>return false,
            }
        } }
        return creates==1 and calls==1;
    }
    fn receiverIncoming(self:*const Analysis,c:*Context,target:t.FunctionRef,construction:t.ConstructionIndex,edge:facts.CallEdge) Error!bool {
        try c.charge(12);
        const invocation=self.invocations.items[@intFromEnum(edge.callee)]; const caller=self.invocations.items[@intFromEnum(edge.caller.context)];
        // Body/storage uncertainty must not overwrite an independently complete
        // entrance. Arguments, entry frame state and every incoming creator are
        // checked below; all original body unresolved flags remain unchanged.
        if(invocation.function!=target or invocation.root or invocation.repeated or invocation.arguments.len!=1 or invocation.entry_frames.entries.count()!=1 or invocation.parent==null)return false;
        try c.row(facts.Site); if(!std.meta.eql(invocation.parent.?,edge.caller))return false;
        if(caller.function!=edge.caller.location.function or !caller.root or caller.parent!=null or caller.repeated or caller.actual_unresolved or caller.arguments.len!=0 or (caller.unresolved and !caller.receiver_upper_gap))return false;
        if(!invocation.receiver_lifetimes.final_replay_complete or !caller.receiver_lifetimes.final_replay_complete)return false;
        try c.row(facts.Value); const passed=invocation.arguments[0].view(); try c.charge(9);
        if(passed.unknown or passed.callable_unknown or passed.frames.len!=1 or passed.cursors.len!=0 or passed.tags.len!=0 or passed.objects.len!=0 or passed.cells.len!=0 or passed.callables.len!=0 or passed.effect_origins.len!=0)return false;
        const frame=passed.frames[0]; try c.step(); const metadata=&self.frames.items[@intFromEnum(frame)];
        const v=&c.program.tables.mode.common; const role=&v.members.constructions[@intFromEnum(construction)];
        try c.charge(6);
        if(metadata.weak or metadata.parent!=null or metadata.construction!=construction or metadata.new_target!=role.owner or metadata.site.context!=edge.caller.context or metadata.site.location.function!=caller.function)return false;
        try c.charge(invocation.entry_frames.entries.count()+1);
        const binding=invocation.entry_frames.entries.getPtr(frame) orelse return false; try c.charge(7);
        try c.row(facts.Value);
        if(!binding.unbound or binding.unresolved or binding.initializing or binding.aborted or binding.prefix_min!=0 or binding.prefix_max!=0 or !binding.bound.view().bottom())return false;
        // The creator is a REAL same-context operation, not the representative
        // site of a merged frame from a different incoming invocation.
        const f=&c.program.functions[@intFromEnum(caller.function)];
        const create=&f.blocks[@intFromEnum(metadata.site.location.block)].instructions[metadata.site.location.instruction];
        const call=&f.blocks[@intFromEnum(edge.caller.location.block)].instructions[edge.caller.location.instruction];
        try c.charge(8);
        if(create.data!=.receiver_create or call.data!=.eh_invoke or create.result==null or call.operands.len!=1 or call.operands[0]!=create.result.? or call.data.eh_invoke.callee!=target)return false;
        if(create.data.receiver_create.construction!=construction or create.data.receiver_create.new_target!=role.owner)return false;
        const normal=facts.Location{.function=caller.function,.block=call.data.eh_invoke.normal,.instruction=0};
        const language=facts.Location{.function=caller.function,.block=call.data.eh_invoke.exceptional,.instruction=0};
        try c.charge(6); if(!std.meta.eql(normal,edge.normal) or edge.language==null or !std.meta.eql(language,edge.language.?))return false;
        return true;
    }
    // A narrow entry-value proof over the SAME completed actual analysis.
    // This is not a fixed-upper, activation-uniqueness or Source certificate.
    pub fn receiverEntry(self:*const Analysis,c:*Context,target:t.FunctionRef) Error!?ReceiverEntry {
        try c.charge(3); try c.require(self.owner==c);
        if(!self.final_replay_complete or c.program.tables.mode!=.common)return null;
        const v=&c.program.tables.mode.common; const f=&c.program.functions[@intFromEnum(target)]; const abi=&v.abis[@intFromEnum(f.abi)];
        try c.charge(7);
        if(f.role!=.construction_body or abi.construction==null or abi.receiver_frame!=0 or abi.parameters.len!=0 or abi.argument_types.len!=0 or abi.lexical_environment!=null or abi.receiver!=null or f.blocks[0].parameters.len!=1)return null;
        const construction=abi.construction.?; const role=&v.members.constructions[@intFromEnum(construction)]; const owner=&v.types[@intFromEnum(role.owner)];
        try c.charge(7);
        if(role.kind!=.explicit or role.function!=target or role.parameters.len!=0 or role.signature.parameters.len!=0 or owner.kind!=.reference or owner.base!=null)return null;
        for(role.initialization_fields) |field_ref| {
            try c.charge(7); const field=&v.members.fields[@intFromEnum(field_ref)]; const binding=&v.storage.bindings[@intFromEnum(field.binding)];
            if(field.owner!=role.owner or v.types[@intFromEnum(field.@"type")].kind!=.scalar or field.declared_type!=field.@"type" or
                binding.@"type"!=field.@"type" or binding.carrier!=.@"type" or binding.carrier.@"type"!=field.@"type")return null;
            // Independently prove ALL current writes of this field have a
            // real native scalar payload. Other+view in Graph5 alone is not
            // that proof: it also represents strings and asserted views.
            var written=false;
            for(f.blocks) |*block| { try c.step(); for(block.instructions) |*op| {
                try c.step(); if(op.data!=.initialize_field or op.data.initialize_field.field!=field_ref)continue;
                if(op.data.initialize_field.construction!=construction)return null;
                written=true; const payload=op.operands[2]; const carrier=f.registers[@intFromEnum(payload)].carrier;
                try c.charge(2); if(carrier!=.@"type" or carrier.@"type"!=field.@"type")return null;
                var native=false;
                definitions: for(f.blocks) |*definition_block| { try c.step(); for(definition_block.instructions) |*definition| {
                    try c.step(); if(definition.result!=payload)continue;
                    native=switch(definition.data){.const_i32,.const_integer,.const_bool,.const_float=>true,
                        .domain_literal=>|row|row.actual_type==field.@"type" and v.types[@intFromEnum(row.actual_type)].kind==.scalar,else=>false};
                    break :definitions;
                } }
                if(!native)return null;
            } }
            if(!written)return null;
        }
        // Root policy independently distinguishes a lexical closure row from
        // an actual outside entry capable of providing this hidden Frame.
        if(try receiverOutside(c,target))return null;
        var sites:usize=0;
        // Quantify current syntax first, including dead sites. EACH such site
        // must be represented for EVERY stabilized context of its caller.
        for(c.program.functions,0..) |*caller,fn_index| { try c.step(); for(caller.blocks,0..) |*block,b| { try c.step(); for(block.instructions,0..) |*op,i| {
            try c.step();
            if(op.data==.function_make and op.data.function_make.function==target)return null;
            if(op.data==.call and op.data.call.callee==target)return null;
            if(op.data!=.eh_invoke or op.data.eh_invoke.callee!=target)continue;
            sites+=1; const caller_ref:t.FunctionRef=@enumFromInt(fn_index);
            if(!try strictReceiverCaller(c,caller_ref,target,construction))return null;
            var contexts:usize=0;
            for(self.invocations.items,0..) |invocation,context_index| {
                try c.step(); if(invocation.function!=caller_ref)continue; contexts+=1; var represented=false;
                const location=facts.Location{.function=caller_ref,.block=@enumFromInt(b),.instruction=@intCast(i)};
                for(self.receiver_calls.items) |edge| { try c.row(facts.CallEdge);
                    if(@intFromEnum(edge.caller.context)!=context_index or !std.meta.eql(edge.caller.location,location))continue;
                    if(!try self.receiverIncoming(c,target,construction,edge))return null; represented=true;
                }
                if(!represented)return null;
            }
            if(contexts==0)return null;
        } } }
        if(sites==0)return null; var incoming:usize=0;
        // Conversely EVERY target context and EVERY recorded incoming edge
        // must be explained; not merely some matching observed invocation.
        for(self.invocations.items,0..) |invocation,index| {
            try c.step(); if(invocation.function!=target)continue; incoming+=1; var represented=false;
            for(self.receiver_calls.items) |edge| { try c.row(facts.CallEdge); if(@intFromEnum(edge.callee)!=index)continue;
                if(!try self.receiverIncoming(c,target,construction,edge))return null; represented=true;
            }
            if(!represented)return null;
        }
        if(incoming==0)return null; try c.charge(4); return .{.construction=construction,.new_target=role.owner,.scalar_fields=role.initialization_fields};
    }

    pub fn view(self: *const Analysis) facts.WorldView {
        return .{.frames=self.frames.items,.objects=self.objects.items,.cells=self.cells.items,.contexts=self.contexts.items,
            .region_nodes=self.region_nodes.items,.region_scopes=self.region_scopes.items};
    }
    pub fn deinit(self: *Analysis, allocator: std.mem.Allocator) void {
        for(self.invocations.items) |item| {
            for(item.arguments) |*value|value.deinit(allocator); allocator.free(item.arguments);
            item.entry.deinit(allocator); item.returned.deinit(allocator); item.thrown.deinit(allocator);
            item.normal_heap.deinit(allocator); item.language_heap.deinit(allocator);
            receiver_actual.deinit(&item.entry_frames,allocator); receiver_actual.deinit(&item.normal_frames,allocator); receiver_actual.deinit(&item.language_frames,allocator);
            item.receiver_lifetimes.deinit(allocator);
            item.entry_relations.deinit(allocator); item.normal_relations.deinit(allocator); item.language_relations.deinit(allocator); allocator.destroy(item);
        }
        for(self.observations.items) |*row|row.known.deinit(allocator);
        for(self.creation_storage.items) |*sites|sites.deinit(allocator); self.creation_storage.deinit(allocator);
        self.objects.deinit(allocator); self.cells.deinit(allocator); self.invocations.deinit(allocator);
        self.frames.deinit(allocator);
        self.receiver_calls.deinit(allocator);
        self.contexts.deinit(allocator); self.observations.deinit(allocator);
        self.region_nodes.deinit(allocator); self.region_scopes.deinit(allocator); self.*=.{};
    }
};
// Closure.parent is lexical ownership, not permission to supply an internal
// constructor Frame. Preserve real module/Host/Kernel roots, direct function
// exports/imports and Code entries. Exporting a nominal TYPE is not exporting
// its hidden Frame ABI. SSA forbids Frame flow through ordinary Data/Env and
// fixed Code target admission excludes constructor ABIs.
fn receiverOutside(c:*Context,target:t.FunctionRef) Error!bool {
    const v=&c.program.tables.mode.common; const f=&c.program.functions[@intFromEnum(target)];
    inline for(.{v.modules.roots.roots,v.modules.roots.required_roots}) |group| for(group) |*row| {
        try c.charge(5); if(std.mem.eql(u8,&row.target,&f.id))return true;
    };
    for(v.modules.modules) |*module| {
        try c.step(); if(module.external and module.source==f.source)return true;
        for(module.exports) |*row| { try c.charge(5); if(row.kind==.function and std.mem.eql(u8,&row.target,&f.id))return true; }
        for(module.imports) |*dependency| { try c.step(); for(dependency.bindings) |*row| {
            try c.charge(5); if(row.kind==.function and std.mem.eql(u8,&row.target,&f.id))return true;
        } }
    }
    for(v.closures.calls) |*row| { try c.step(); for(row.targets) |selected| { try c.step(); if(selected==target)return true; } }
    for(v.members.methods) |*row| { try c.step(); if(row.function==target)return true; }
    for(c.program.functions) |*caller| { try c.step(); for(caller.blocks) |*block| { try c.step(); for(block.instructions) |*op| {
        try c.step(); if(op.data==.function_make and op.data.function_make.function==target)return true;
    } } }
    return false;
}

const State = struct {
    frames: facts.FrameStore=.{},
    values: []V,
    heap: Heap=.{},
    relations: relation.Heap=.{},
    fn init(c: *Context, count: usize) Error!State {
        try c.charge(count); const values=try c.allocator.alloc(V,count); @memset(values,.{}); return .{.values=values};
    }
    fn deinit(self: *State, c: *Context) void {
        for(self.values) |*v|v.deinit(c.allocator); c.allocator.free(self.values); self.heap.deinit(c.allocator); self.relations.deinit(c.allocator);
        receiver_actual.deinit(&self.frames,c.allocator);
    }
    fn view(self: *const State) facts.StateView { return .{.frames=&self.frames,.values=.{.values=self.values},.heap=.{.heap=&self.heap,.relations=&self.relations},.relations=&self.relations}; }
    fn read(self: *const State, r: t.RegisterRef) facts.Value { return self.values[@intFromEnum(r)].view(); }
    fn assign(self: *State, c: *Context, r: t.RegisterRef, value: facts.Value) Error!void {
        const replacement=try V.clone(c,value); const target=&self.values[@intFromEnum(r)];
        target.deinit(c.allocator); target.*=replacement;
    }
    fn clone(c: *Context, source: *const State) Error!State {
        var result=try State.init(c,source.values.len); errdefer result.deinit(c);
        for(source.values,0..) |value,i| { result.values[i]=try V.clone(c,value.view()); }
        result.heap=try Heap.clone(c,source.heap.view()); result.relations=try relation.Heap.clone(c,&source.relations); result.frames=try receiver_actual.clone(c,&source.frames); return result;
    }
    fn join(self: *State, c: *Context, incoming: *const State) Error!bool {
        var changed=try self.heap.join(c,incoming.heap.view());
        changed=(try self.relations.join(c,&incoming.relations)) or changed;
        changed=(try receiver_actual.join(c,&self.frames,&incoming.frames)) or changed;
        for(self.values,incoming.values) |*a,b| { if(try a.join(c,b.view()))changed=true; } return changed;
    }
};
const Engine = struct {
    const RegionKey = struct { scope: relation.ScopeRef, activation: usize, reference: facts.ObjectId, copied: ?relation.Root=null };
    const ScopeKey = struct { activation: usize, location: facts.Location, target: t.FunctionRef };
    const RegionGraph = struct {
        blocks: usize, registers: usize,
        cuts: []bool, live: []bool, repeating: []bool,
        acyclic: bool,
        fn deinit(self: *RegionGraph, allocator: std.mem.Allocator) void {
            allocator.free(self.cuts); allocator.free(self.live); allocator.free(self.repeating);
        }
    };
    const CopyPair = struct { original: facts.ObjectId, copied: facts.ObjectId, parent: ?usize, field: ?t.FieldRef=null };
    const Activation = struct { function: t.FunctionRef, parent: ?usize, site: ?facts.Location, recursive: bool, root_target: ?t.TypeRef=null };
    const FrameKey = struct { activation: usize, location: ?facts.Location, construction: t.ConstructionIndex, new_target: t.TypeRef, parent: ?facts.FrameId };
    const ObjectKey = struct {
        activation: usize, location: facts.Location, kind: facts.ObjectKind, @"type": ?t.TypeRef, environment: ?t.EnvironmentRef,
        copy_source: ?facts.ObjectId=null, copy_parent: ?facts.ObjectId=null, copy_field: ?t.FieldRef=null,
        entry_parameter: ?t.RegisterRef=null,
    };
    c: *Context,
    host_material: ?*const host_binding.Bundle,
    result: Analysis=.{},
    observers: []const facts.Observer=&.{},
    replay: bool=false,
    emit: bool=false,
    changed: bool=false,
    initial_globals: Heap=.{},
    entry_roles: ?entry_contracts.EntryRoles=null,
    activations: std.ArrayListUnmanaged(Activation)=.empty,
    object_keys: std.ArrayListUnmanaged(ObjectKey)=.empty,
    frame_keys: std.ArrayListUnmanaged(FrameKey)=.empty,
    cell_activations: std.ArrayListUnmanaged(usize)=.empty,
    captured: std.AutoHashMapUnmanaged(struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef },V)=.{},
    primitives: std.StringHashMapUnmanaged(t.TypeRef)=.{},
    region_keys: std.ArrayListUnmanaged(RegionKey)=.empty,
    scope_keys: std.ArrayListUnmanaged(ScopeKey)=.empty,
    region_graphs: std.AutoHashMapUnmanaged(t.FunctionRef,RegionGraph)=.empty,
    recursive: std.AutoHashMapUnmanaged(t.FunctionRef,bool)=.empty,
    transport_readers: std.AutoHashMapUnmanaged(t.FunctionRef,bool)=.{},

    fn deinit(self: *Engine) void {
        if(self.entry_roles) |*roles|roles.deinit();
        self.initial_globals.deinit(self.c.allocator); self.activations.deinit(self.c.allocator);
        self.object_keys.deinit(self.c.allocator); self.cell_activations.deinit(self.c.allocator);
        self.frame_keys.deinit(self.c.allocator);
        var iterator=self.captured.valueIterator(); while(iterator.next()) |value|value.deinit(self.c.allocator); self.captured.deinit(self.c.allocator);
        self.primitives.deinit(self.c.allocator);
        self.region_keys.deinit(self.c.allocator); self.scope_keys.deinit(self.c.allocator);
        var graphs=self.region_graphs.valueIterator(); while(graphs.next()) |graph|graph.deinit(self.c.allocator);
        self.region_graphs.deinit(self.c.allocator); self.recursive.deinit(self.c.allocator);
        self.transport_readers.deinit(self.c.allocator);
    }
    fn domain(self: *Engine) relation.Domain {
        return .{.c=self.c,.nodes=self.result.region_nodes.items,.scopes=self.result.region_scopes.items};
    }
    fn setRegion(self: *Engine, value: *V, selected: region_data.Value) Error!void {
        var replacement=try region_data.OwnedValue.clone(self.c,selected); errdefer replacement.deinit(self.c.allocator);
        value.region.deinit(self.c.allocator); value.region=replacement;
    }
    fn prepareRegionGraph(self: *Engine, ref: t.FunctionRef) Error!*const RegionGraph {
        try self.c.step();
        if(self.region_graphs.getPtr(ref)) |cached|return cached;
        const function=self.c.program.functions[@intFromEnum(ref)]; const n=function.blocks.len; const r=function.registers.len;
        try self.c.charge(n*n*3+n*r*3+n*4+1);
        const pred=try self.c.allocator.alloc(bool,n*n); defer self.c.allocator.free(pred); @memset(pred,false);
        const dom=try self.c.allocator.alloc(bool,n*n); defer self.c.allocator.free(dom); @memset(dom,true); @memset(dom[0..n],false); dom[0]=true;
        const defs=try self.c.allocator.alloc(bool,n*r); defer self.c.allocator.free(defs); @memset(defs,false);
        const uses=try self.c.allocator.alloc(bool,n*r); defer self.c.allocator.free(uses); @memset(uses,false);
        const live=try self.c.allocator.alloc(bool,n*r); errdefer self.c.allocator.free(live); @memset(live,false);
        const cuts=try self.c.allocator.alloc(bool,n*n); errdefer self.c.allocator.free(cuts); @memset(cuts,false);
        const repeating=try self.c.allocator.alloc(bool,n); errdefer self.c.allocator.free(repeating); @memset(repeating,false);
        for(function.blocks,0..) |block,b| {
            for(block.instructions) |op| {
                try self.c.step();
                if(op.data!=.@"br" and op.data!=.eh_route)for(op.operands) |reg| {
                    try self.c.step(); const v=@intFromEnum(reg); if(!defs[b*r+v])uses[b*r+v]=true;
                };
                if(op.result) |reg|defs[b*r+@intFromEnum(reg)]=true;
            }
            const next=successors(block.instructions[block.instructions.len-1]);
            for(next.blocks[0..next.count]) |to| { try self.c.step(); pred[@intFromEnum(to)*n+b]=true; }
        }
        var changed=true;
        while(changed) {
            changed=false;
            for(1..n) |b|for(0..n) |d| {
                try self.c.step(); var present=b==d;
                if(!present) { present=true; for(0..n) |p| { try self.c.step(); if(pred[b*n+p])present=present and dom[p*n+d]; } }
                if(dom[b*n+d]!=present) { dom[b*n+d]=present; changed=true; }
            };
        }
        var cyclic=false;
        for(0..n) |to|for(0..n) |from| {
            try self.c.step(); if(pred[to*n+from] and dom[from*n+to]) { cuts[from*n+to]=true; cyclic=true; }
        };
        const degrees=try self.c.allocator.alloc(usize,n); defer self.c.allocator.free(degrees); @memset(degrees,0);
        const queue=try self.c.allocator.alloc(usize,n); defer self.c.allocator.free(queue); var count: usize=0;
        for(0..n) |to| { for(0..n) |from| { try self.c.step(); if(pred[to*n+from] and !cuts[from*n+to])degrees[to]+=1; } if(degrees[to]==0) { queue[count]=to; count+=1; } }
        var cursor: usize=0;
        while(cursor<count) : (cursor+=1) {
            const from=queue[cursor];
            for(0..n) |to| { try self.c.step(); if(!pred[to*n+from] or cuts[from*n+to])continue; degrees[to]-=1; if(degrees[to]==0) { queue[count]=to; count+=1; } }
        }
        const reducible=count==n;
        if(!reducible)@memset(cuts,false) else if(cyclic) {
            try self.c.charge(n*n);
            const back=try self.c.allocator.dupe(bool,cuts); defer self.c.allocator.free(back);
            const members=try self.c.allocator.alloc(bool,n); defer self.c.allocator.free(members);
            var valid=true;
            for(0..n) |head| {
                try self.c.charge(n);
                @memset(members,false); members[head]=true; count=0; cursor=0; var has_backedge=false;
                for(0..n) |tail| { try self.c.step(); if(back[tail*n+head]) { has_backedge=true; if(!members[tail]) { members[tail]=true; queue[count]=tail; count+=1; } } }
                if(!has_backedge)continue;
                while(cursor<count) : (cursor+=1) {
                    const b=queue[cursor]; try self.c.step(); if(!dom[b*n+head]) { valid=false; break; }
                    for(0..n) |p| { try self.c.step(); if(pred[b*n+p] and !members[p]) { members[p]=true; queue[count]=p; count+=1; } }
                }
                if(!valid)break;
                for(0..n) |from| { try self.c.step(); if(!members[from])continue; repeating[from]=true;
                    const next=successors(function.blocks[from].instructions[function.blocks[from].instructions.len-1]);
                    for(next.blocks[0..next.count]) |to| { try self.c.step(); if(!members[@intFromEnum(to)])cuts[from*n+@intFromEnum(to)]=true; }
                }
            }
            if(!valid) { @memset(cuts,false); @memset(repeating,false); }
        }
        const next_live=try self.c.allocator.alloc(bool,r); defer self.c.allocator.free(next_live);
        changed=true;
        while(changed) {
            changed=false; var b=n;
            while(b!=0) { b-=1; const last=function.blocks[b].instructions[function.blocks[b].instructions.len-1]; const next=successors(last);
                try self.c.charge(r); @memcpy(next_live,uses[b*r..][0..r]);
                for(next.blocks[0..next.count]) |target| {
                    const to=@intFromEnum(target);
                    for(0..r) |v| { try self.c.step(); if(!live[to*r+v])continue; var translated=v; var parameter=false;
                        for(function.blocks[to].parameters,0..) |ref_param,index| { try self.c.step(); if(@intFromEnum(ref_param)==v) {
                            parameter=true; if(last.data==.@"br" or last.data==.eh_route)translated=@intFromEnum(last.operands[index]); break;
                        } }
                        if(parameter and last.data!=.@"br" and last.data!=.eh_route)continue;
                        if(!defs[b*r+translated])next_live[translated]=true;
                    }
                }
                for(next_live,0..) |wanted,reg| { try self.c.step(); if(live[b*r+reg]!=wanted) { live[b*r+reg]=wanted; changed=true; } }
            }
        }
        try self.region_graphs.put(self.c.allocator,ref,.{.blocks=n,.registers=r,.cuts=cuts,.live=live,.repeating=repeating,.acyclic=reducible and !cyclic});
        return self.region_graphs.getPtr(ref).?;
    }
    fn appendRegionCallees(self: *Engine, function: t.FunctionRef, pending: *std.ArrayListUnmanaged(t.FunctionRef)) Error!void {
        const common=self.c.program.tables.mode.common;
        for(self.c.program.functions[@intFromEnum(function)].blocks,0..) |block,b|for(block.instructions,0..) |op,index| {
            try self.c.step(); switch(op.data) {
                .eh_invoke => |call|try pending.append(self.c.allocator,call.callee),
                .eh_invoke_indirect => {
                    // This complete finite directory is only a conservative
                    // cycle restriction. It never seeds the actual code set.
                    for(common.closures.calls) |row| { try self.c.step(); if(row.function==function and @intFromEnum(row.block)==b and row.instruction==index) { try self.c.charge(row.targets.len); try pending.appendSlice(self.c.allocator,row.targets); } }
                },
                .common_method_invoke => |call|for(common.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| {
                    try self.c.step();
                    // The shared dispatch data permits null, but a Common
                    // method arm must join an actual Method function/ABI.
                    // Missing implementations are omitted, never null edges
                    // that could silently certify a closed acyclic function.
                    const callee=arm.target orelse return error.InvalidShape;
                    try pending.append(self.c.allocator,callee);
                },
                else => {},
            }
        };
    }
    fn recursiveFunction(self: *Engine, function: t.FunctionRef) Error!bool {
        try self.c.step();
        if(self.recursive.get(function)) |cached|return cached;
        var pending: std.ArrayListUnmanaged(t.FunctionRef)=.empty; defer pending.deinit(self.c.allocator);
        var visited: std.AutoHashMapUnmanaged(t.FunctionRef,void)=.empty; defer visited.deinit(self.c.allocator);
        try self.appendRegionCallees(function,&pending); var cursor: usize=0; var recursive=false;
        while(cursor<pending.items.len) : (cursor+=1) {
            try self.c.step(); const next=pending.items[cursor]; if(next==function) { recursive=true; break; }
            const found=try visited.getOrPut(self.c.allocator,next); if(!found.found_existing)try self.appendRegionCallees(next,&pending);
        }
        try self.recursive.put(self.c.allocator,function,recursive); return recursive;
    }
    fn birth(self: *Engine, at: facts.Site, reference: facts.ObjectId, heap: *relation.Heap, copied: ?relation.Root, inherited: ?relation.ScopeRef) Error!region_data.OwnedValue {
        var out=region_data.OwnedValue{.known=true}; errdefer out.deinit(self.c.allocator);
        if(self.c.program.tables.mode!=.common) { out.unresolved=true; return out; }
        const scope=inherited orelse self.info(at.context).region_scope orelse { out.unresolved=true; return out; };
        if(copied==null and !(try self.prepareRegionGraph(at.location.function)).acyclic) { out.unresolved=true; return out; }
        const key=RegionKey{.scope=scope,.activation=self.info(at.context).activation,.reference=reference,.copied=copied};
        var selected: ?relation.Root=null;
        for(self.region_keys.items,0..) |old,i| { try self.c.step(); if(std.meta.eql(old,key)) { selected=@enumFromInt(i); break; } }
        if(selected==null) {
            try self.c.require(!self.replay and self.region_keys.items.len<65536);
            try self.region_keys.ensureUnusedCapacity(self.c.allocator,1); try self.result.region_nodes.ensureUnusedCapacity(self.c.allocator,1);
            selected=@enumFromInt(self.region_keys.items.len); self.region_keys.appendAssumeCapacity(key);
            self.result.region_nodes.appendAssumeCapacity(.{.scope=scope,.reference=reference}); self.changed=true;
        }
        try heap.reset(self.c,selected.?); try out.roots.append(self.c.allocator,selected.?); return out;
    }
    fn selectedReachable(self: *Engine, values: []const V, heap: *const relation.Heap) Error!relation.Heap {
        var out: relation.Heap=.{}; errdefer out.deinit(self.c.allocator);
        var pending: std.ArrayListUnmanaged(relation.Root)=.empty; defer pending.deinit(self.c.allocator);
        for(values) |value| { const selected=try facts.relation(self.c,value.view()); try self.c.charge(selected.roots.len+1); try pending.appendSlice(self.c.allocator,selected.roots); }
        var cursor: usize=0;
        while(cursor<pending.items.len) : (cursor+=1) {
            try self.c.step(); const root=pending.items[cursor]; if(out.nodes.contains(root))continue;
            const slots=heap.nodes.getPtr(root) orelse continue; try out.reset(self.c,root);
            var iterator=slots.iterator(); while(iterator.next()) |entry| {
                try self.c.step(); var stored=try region_data.OwnedValue.clone(self.c,entry.value_ptr.view()); errdefer stored.deinit(self.c.allocator);
                try pending.appendSlice(self.c.allocator,stored.roots.items); try self.c.charge(stored.roots.items.len);
                try out.nodes.getPtr(root).?.put(self.c.allocator,entry.key_ptr.*,stored);
            }
        }
        return out;
    }
    fn hardEscape(self: *Engine, value: facts.Value, heap: facts.HeapView) Error!void {
        if(self.c.program.tables.mode!=.common)return;
        var d=self.domain(); var observer=relation.HardEscapes.init(&d); try observer.observe(self.result.view(),value,heap);
    }
    fn escape(self: *Engine, value: facts.Value, state: *const State, hard: bool) Error!void {
        if(self.c.program.tables.mode!=.common)return;
        var d=self.domain(); try d.escape(try facts.relation(self.c,value),&state.relations,hard);
        if(hard)try self.hardEscape(value,state.heap.view());
    }
    fn callScope(self: *Engine, at: facts.Site, target: t.FunctionRef, arguments: []const V, state: *const State, complete: bool) Error!?relation.ScopeRef {
        if(self.c.program.tables.mode!=.common)return null;
        const graph=try self.prepareRegionGraph(target);
        if(!complete or !graph.acyclic or try self.recursiveFunction(target)) {
            for(arguments) |argument| { try self.c.step(); try self.escape(argument.view(),state,true); } return null;
        }
        const parent=self.info(at.context); if(parent.region_scope) |scope|return scope;
        var inherited: ?relation.ScopeRef=null; var uncertain=false;
        for(arguments) |argument| {
            const selected=try facts.relation(self.c,argument.view()); uncertain=uncertain or selected.unresolved;
            for(selected.roots) |root| { try self.c.step(); const scope=self.result.region_nodes.items[@intFromEnum(root)].scope;
                if(inherited) |old| { uncertain=uncertain or old!=scope; } else inherited=scope;
            }
        }
        if(inherited!=null)return if(uncertain)null else inherited;
        const caller=try self.prepareRegionGraph(at.location.function);
        if(parent.repeated or try self.recursiveFunction(at.location.function) or !caller.repeating[@intFromEnum(at.location.block)])return null;
        var any_cut=false; for(caller.cuts) |is_cut| { try self.c.step(); any_cut=any_cut or is_cut; } if(!any_cut)return null;
        const key=ScopeKey{.activation=parent.activation,.location=at.location,.target=target};
        for(self.scope_keys.items,0..) |old,i| { try self.c.step(); if(std.meta.eql(old,key))return @enumFromInt(i); }
        try self.c.require(!self.replay and self.scope_keys.items.len<4096);
        try self.scope_keys.ensureUnusedCapacity(self.c.allocator,1); try self.result.region_scopes.ensureUnusedCapacity(self.c.allocator,1);
        const scope: relation.ScopeRef=@enumFromInt(self.scope_keys.items.len); self.scope_keys.appendAssumeCapacity(key);
        self.result.region_scopes.appendAssumeCapacity(.{.function=at.location.function,.activation=at.context}); self.changed=true; return scope;
    }
    fn cut(self: *Engine, at: facts.Site, target: t.BlockRef, state: *State) Error!void {
        if(self.c.program.tables.mode!=.common or self.result.region_nodes.items.len==0)return;
        const graph=try self.prepareRegionGraph(at.location.function); const to=@intFromEnum(target);
        if(!graph.cuts[@intFromEnum(at.location.block)*graph.blocks+to])return;
        var demanded: std.ArrayListUnmanaged(region_data.Value)=.empty; defer demanded.deinit(self.c.allocator);
        var globals: std.ArrayListUnmanaged(region_data.Value)=.empty; defer globals.deinit(self.c.allocator);
        var roots: std.ArrayListUnmanaged(V)=.empty; defer roots.deinit(self.c.allocator);
        for(state.values,0..) |value,index| {
            try self.c.step(); if(!graph.live[to*graph.registers+index])continue;
            try demanded.append(self.c.allocator,try facts.relation(self.c,value.view())); try roots.append(self.c.allocator,value);
        }
        var retained=try receiver_actual.retained(self.c,&state.frames,roots.items); defer retained.deinit(self.c.allocator);
        if(!retained.view().bottom()) {
            try self.c.charge(2+@as(usize,if(demanded.items.len==demanded.capacity)demanded.items.len else 0)+@as(usize,if(roots.items.len==roots.capacity)roots.items.len else 0));
            try demanded.ensureUnusedCapacity(self.c.allocator,1); try roots.ensureUnusedCapacity(self.c.allocator,1);
            demanded.appendAssumeCapacity(try facts.relation(self.c,retained.view())); roots.appendAssumeCapacity(retained);
        }
        var reached_heap=try self.reachable(roots.items,state.heap.view()); defer reached_heap.deinit(self.c.allocator);
        var entries=reached_heap.view().iterator(); while(entries.next()) |entry| { try self.c.step(); try demanded.append(self.c.allocator,try facts.relation(self.c,entry.value)); }
        var all=state.heap.entries.iterator(); while(all.next()) |entry| {
            try self.c.step(); if(entry.key_ptr.*==.global)try globals.append(self.c.allocator,try facts.relation(self.c,entry.value_ptr.view()));
        }
        var d=self.domain();
        // Only phi-assigned continuation-live values export a relation. The
        // subsequent age affects every raw value, not only those arguments.
        var no_registers: [0]region_data.OwnedValue=.{};
        try d.cut(demanded.items,globals.items,&no_registers,&state.relations);
        for(state.values) |*value|try value.region.age(self.c);
        var raw=state.heap.entries.valueIterator(); while(raw.next()) |value|try value.region.age(self.c);
        var frames=state.frames.entries.valueIterator(); while(frames.next()) |frame|try frame.bound.region.age(self.c);
    }
    fn activationFor(self: *Engine, function: t.FunctionRef, parent: ?facts.Site, root_target: ?t.TypeRef) Error!usize {
        if(self.closureLegacy()) {
            for(self.activations.items,0..) |row,i| { try self.c.step(); if(row.function==function)return i; }
            if(self.replay)return error.InvalidShape;
            try self.activations.append(self.c.allocator,.{.function=function,.parent=null,.site=null,.recursive=false}); return self.activations.items.len-1;
        }
        var ancestor: ?usize=if(parent) |at|self.info(at.context).activation else null; var recursive=false;
        while(ancestor) |index| {
            try self.c.step(); const row=self.activations.items[index];
            if(row.function==function) { recursive=true; break; } ancestor=row.parent;
        }
        const owner: ?usize=if(!recursive and parent!=null)self.info(parent.?.context).activation else null;
        const site: ?facts.Location=if(!recursive and parent!=null)parent.?.location else null;
        for(self.activations.items,0..) |row,i| { try self.c.charge(2);
            if(row.function==function and row.parent==owner and row.recursive==recursive and std.meta.eql(row.site,site) and row.root_target==root_target)return i;
        }
        if(self.replay)return error.InvalidShape;
        try self.activations.append(self.c.allocator,.{.function=function,.parent=owner,.site=site,.recursive=recursive,.root_target=root_target}); return self.activations.items.len-1;
    }

    fn typeKind(self: *Engine, id: t.TypeRef) []const u8 {
        return switch(self.c.program.tables.mode) { .common => |v| @tagName(v.types[@intFromEnum(id)].kind),
            .legacy => |v| @tagName(v.types[@intFromEnum(id)].kind), .exception => |v| @tagName(v.types[@intFromEnum(id)].kind) };
    }
    fn is(self: *Engine, id: t.TypeRef, name: []const u8) Error!bool {
        try self.c.charge(1+name.len/64); return std.mem.eql(u8,self.typeKind(id),name);
    }
    fn primitive(self: *Engine, name: []const u8) Error!t.TypeRef {
        try self.c.charge(1+name.len/64); return self.primitives.get(name) orelse error.InvalidShape;
    }
    fn literal(self: *Engine, id: t.TypeRef) Error!V {
        var value: V=.{}; errdefer value.deinit(self.c.allocator); _=try value.tag(self.c,id); return value;
    }
    fn logical(self: *Engine, function: t.FunctionRef, r: t.RegisterRef) ?t.TypeRef {
        const row=self.c.program.functions[@intFromEnum(function)].registers[@intFromEnum(r)];
        return row.view orelse if(std.meta.activeTag(row.carrier)==.@"type")row.carrier.@"type" else null;
    }
    fn info(self: *Engine, id: facts.ContextId) *Invocation { return self.result.invocations.items[@intFromEnum(id)]; }
    fn refresh(self: *Engine) Error!void {
        self.result.contexts.clearRetainingCapacity();
        for(self.result.invocations.items) |invocation| {
            try self.c.charge(2); try self.result.contexts.append(self.c.allocator,.{.function=invocation.function,.receiver_lifetimes=&invocation.receiver_lifetimes,
                .arguments=.{.values=invocation.arguments},.entry=.{.heap=&invocation.entry,.relations=&invocation.entry_relations},.root=invocation.root,.frames=&invocation.entry_frames,
                .repeated=invocation.repeated,.unresolved=invocation.unresolved,.region_scope=invocation.region_scope});
        }
    }
    fn observe(self: *Engine, at: facts.Site, called: facts.Value) Error!void {
        if(self.replay)return;
        var found: ?*TargetObservation=null;
        for(self.result.observations.items) |*row| { try self.c.step(); if(std.meta.eql(row.location,at.location)) { found=row; break; } }
        if(found==null) { try self.result.observations.append(self.c.allocator,.{.location=at.location}); found=&self.result.observations.items[self.result.observations.items.len-1]; }
        const row=found.?; row.reached=true;
        row.unresolved=row.unresolved or called.unknown or called.callable_unknown;
        for(called.callables) |pair| {
            var exists=false;
            for(row.known.items) |code| { try self.c.step(); if(code==pair.code) { exists=true; break; } }
            if(!exists) { try self.c.step(); try row.known.append(self.c.allocator,pair.code); self.changed=true; }
        }
        self.result.unresolved=self.result.unresolved or row.unresolved;
    }
    fn unknown(self: *Engine, id: facts.ContextId) facts.Value {
        if(!self.info(id).actual_unresolved) { self.info(id).actual_unresolved=true; self.changed=true; }
        if(!self.info(id).unresolved) { self.info(id).unresolved=true; self.changed=true; }
        self.result.unresolved=true;
        return .{.unknown=true,.callable_unknown=true};
    }
    fn heapEqual(self: *Engine, a: facts.HeapView, b: facts.HeapView) Error!bool {
        try self.c.step(); if(a.heap.entries.count()!=b.heap.entries.count())return false;
        var iterator=a.iterator();
        while(iterator.next()) |entry| { try self.c.step(); const other=b.get(entry.slot) orelse return false; if(!try self.dataEqual(entry.value,other))return false; }
        return true;
    }
    fn dataEqual(self: *Engine, left: facts.Value, right: facts.Value) Error!bool {
        // Provenance is an additional finite effect fact, not a new physical
        // activation or an actual-context key. Recursive parameters must not
        // create infinitely many contexts merely by acquiring another token.
        var a=left; var b=right; a.effect_origins=&.{}; b.effect_origins=&.{}; return facts.equal(self.c,a,b);
    }
    fn reachable(self: *Engine, arguments: []const V, heap: facts.HeapView) Error!Heap {
        var result: Heap=.{}; errdefer result.deinit(self.c.allocator);
        var roots: V=.{}; defer roots.deinit(self.c.allocator);
        for(arguments) |value| { _=try roots.join(self.c,value.view()); }
        var iterator=heap.iterator();
        while(iterator.next()) |entry| {
            try self.c.step(); if(std.meta.activeTag(entry.slot)==.global) { _=try result.put(self.c,entry.slot,entry.value,true); _=try roots.join(self.c,entry.value); }
        }
        var changed=true;
        while(changed) {
            changed=false; iterator=heap.iterator();
            while(iterator.next()) |entry| {
                try self.c.step(); var include=std.meta.activeTag(entry.slot)==.global;
                switch(entry.slot) {
                    .cell => |id| for(roots.cells.items) |ref| { try self.c.step(); if(id==ref) { include=true; break; } },
                    .global => {},
                    else => {
                        const object_id: facts.ObjectId=switch(entry.slot) {
                            .field => |v| v.object, .element => |v| v.object, .environment_slot => |v| v.object, .capture => |v| v.object,
                            .length,.span_owner,.span_start,.span_length,.parent => |v| v,
                            else => unreachable,
                        };
                        for(roots.objects.items) |ref| { try self.c.step(); if(object_id==ref) { include=true; break; } }
                        if(!include)for(roots.callables.items) |pair| { try self.c.step(); if(pair.environment==object_id) { include=true; break; } };
                    },
                }
                if(include) {
                    if(!result.entries.contains(entry.slot)) { _=try result.put(self.c,entry.slot,entry.value,true); changed=true; }
                    if(try roots.join(self.c,entry.value))changed=true;
                }
            }
        }
        return result;
    }
    fn contextFor(self: *Engine, function: t.FunctionRef, arguments: []const V, heap: facts.HeapView, parent: ?facts.Site, is_root: bool, repeated: bool, versions: ?*const relation.Heap, scope: ?relation.ScopeRef, frames: ?*const facts.FrameStore, root_target: ?t.TypeRef) Error!facts.ContextId {
        const activation=try self.activationFor(function,parent,root_target);
        const summarized=repeated or self.activations.items[activation].recursive;
        var selected_frames: facts.FrameStore=.{}; defer receiver_actual.deinit(&selected_frames,self.c.allocator);
        if(frames) |incoming|selected_frames=try receiver_actual.select(self.c,incoming,arguments);
        var retained=try receiver_actual.retained(self.c,&selected_frames,arguments); defer retained.deinit(self.c.allocator);
        var roots: std.ArrayListUnmanaged(V)=.empty; defer roots.deinit(self.c.allocator);
        const has_frames=selected_frames.entries.count()!=0;
        if(has_frames) {
            try self.c.charge(arguments.len+1); try roots.ensureTotalCapacityPrecise(self.c.allocator,arguments.len+1);
            roots.appendSliceAssumeCapacity(arguments); roots.appendAssumeCapacity(retained);
        }
        const retained_arguments=if(has_frames)roots.items else arguments;
        var entry=try self.reachable(retained_arguments,heap); defer entry.deinit(self.c.allocator);
        var current: relation.Heap=.{}; defer current.deinit(self.c.allocator);
        if(versions) |selected|current=try self.selectedReachable(retained_arguments,selected);
        for(self.result.invocations.items,0..) |invocation,i| {
            if(self.closureLegacy() and invocation.function==function) {
                try self.c.require(invocation.arguments.len==arguments.len);
                if(self.replay) {
                    // This mode intentionally unions inputs by function. No
                    // mutation of the final shared world occurs during replay.
                    for(invocation.arguments,arguments) |a,b| {
                        var merged=try V.clone(self.c,a.view()); defer merged.deinit(self.c.allocator); _=try merged.join(self.c,b.view());
                        try self.c.require(try self.dataEqual(a.view(),merged.view())); try self.provenanceSubset(a.view(),b.view());
                    }
                    var iterator=entry.view().iterator(); while(iterator.next()) |slot| { try self.c.step();
                        const old=invocation.entry.view().get(slot.slot) orelse return error.InvalidShape;
                        var merged=try V.clone(self.c,old); defer merged.deinit(self.c.allocator); _=try merged.join(self.c,slot.value);
                        try self.c.require(try self.dataEqual(old,merged.view())); try self.provenanceSubset(old,slot.value);
                    }
                    return @enumFromInt(i);
                }
                for(invocation.arguments,arguments) |*a,b| { if(try a.join(self.c,b.view()))self.changed=true; }
                if(try invocation.entry.join(self.c,entry.view()))self.changed=true;
                return @enumFromInt(i);
            }
            try self.c.step(); if(invocation.function!=function or invocation.root!=is_root or invocation.repeated!=summarized or invocation.activation!=activation or invocation.arguments.len!=arguments.len or invocation.region_scope!=scope)continue;
            var same=true;
            for(invocation.arguments,arguments) |a,b| { if(!try self.dataEqual(a.view(),b.view())) { same=false; break; } }
            if(same and try self.heapEqual(invocation.entry.view(),entry.view()) and try invocation.entry_relations.equal(self.c,&current) and
                ((invocation.entry_frames.entries.count()==0 and !has_frames) or try receiver_actual.equal(self.c,&invocation.entry_frames,&selected_frames))) {
                if(self.replay) {
                    for(invocation.arguments,arguments) |a,b|try self.provenanceSubset(a.view(),b.view());
                    var iterator=entry.view().iterator(); while(iterator.next()) |slot| { try self.c.step(); try self.provenanceSubset(invocation.entry.view().get(slot.slot).?,slot.value); }
                    var controls=selected_frames.entries.iterator(); while(controls.next()) |row| { try self.c.step(); try self.provenanceSubset(invocation.entry_frames.entries.getPtr(row.key_ptr.*).?.bound.view(),row.value_ptr.bound.view()); }
                    return @enumFromInt(i);
                }
                for(invocation.arguments,arguments) |*a,b| { if(try a.join(self.c,b.view()))self.changed=true; }
                if(try invocation.entry.join(self.c,entry.view()))self.changed=true;
                if(try receiver_actual.join(self.c,&invocation.entry_frames,&selected_frames))self.changed=true;
                return @enumFromInt(i);
            }
        }
        if(self.replay)return error.InvalidShape; // Final replay never invents contexts.
        if(self.c.program.tables.mode!=.legacy)try self.c.require(self.result.invocations.items.len<4096);
        try self.c.step(); const invocation=try self.c.allocator.create(Invocation); errdefer self.c.allocator.destroy(invocation);
        const values=try self.c.allocator.alloc(V,arguments.len); errdefer self.c.allocator.free(values); @memset(values,.{});
        var copied_count: usize=0; errdefer for(values[0..copied_count]) |*value|value.deinit(self.c.allocator);
        for(arguments,0..) |value,i| { values[i]=try V.clone(self.c,value.view()); copied_count+=1; }
        var unresolved=false; for(values) |value| { try self.c.step(); unresolved=unresolved or value.unknown or value.callable_unknown; }
        invocation.*=.{.function=function,.parent=parent,.root=is_root,.repeated=summarized,.activation=activation,.arguments=values,.entry=entry,.unresolved=unresolved,.actual_unresolved=unresolved,.region_scope=scope,.entry_relations=current,.entry_frames=selected_frames}; entry=.{}; current=.{}; selected_frames=.{};
        self.result.unresolved=self.result.unresolved or unresolved;
        errdefer invocation.entry.deinit(self.c.allocator);
        errdefer invocation.entry_relations.deinit(self.c.allocator);
        errdefer receiver_actual.deinit(&invocation.entry_frames,self.c.allocator);
        try self.result.invocations.append(self.c.allocator,invocation); self.changed=true; return @enumFromInt(self.result.invocations.items.len-1);
    }
    fn object(self: *Engine, at: facts.Site, kind: facts.ObjectKind, actual_type: ?t.TypeRef, environment: ?t.EnvironmentRef, weak: bool) Error!facts.ObjectId {
        const key=ObjectKey{.activation=self.info(at.context).activation,.location=at.location,.kind=kind,.@"type"=actual_type,.environment=environment};
        return self.objectKey(at,key,weak);
    }
    fn objectKey(self: *Engine, at: facts.Site, key: ObjectKey, weak: bool) Error!facts.ObjectId {
        for(self.object_keys.items,0..) |prior,i| {
            try self.c.charge(2); if(!std.meta.eql(prior,key))continue; const row=&self.result.objects.items[i];
            if(key.entry_parameter==null) {
                var found=false; for(self.result.creation_storage.items[i].items) |site| { try self.c.step(); if(std.meta.eql(site,at)) { found=true; break; } }
                if(!found) { if(self.replay)return error.InvalidShape; try self.result.creation_storage.items[i].append(self.c.allocator,at); row.creations=self.result.creation_storage.items[i].items; }
            }
            if(weak and !row.weak) { if(self.replay)return error.InvalidShape; row.weak=true; self.changed=true; } return @enumFromInt(i);
        }
        if(self.replay)return error.InvalidShape;
        var sites: std.ArrayListUnmanaged(facts.Site)=.empty; errdefer sites.deinit(self.c.allocator);
        if(key.entry_parameter==null)try sites.append(self.c.allocator,at);
        if(key.entry_parameter!=null) {
            // External entry families own three new directory records. Pay
            // their publication and each real growth copy before allocation.
            try self.c.charge(3 +
                @as(usize,if(self.object_keys.items.len==self.object_keys.capacity) self.object_keys.items.len else 0) +
                @as(usize,if(self.result.creation_storage.items.len==self.result.creation_storage.capacity) self.result.creation_storage.items.len else 0) +
                @as(usize,if(self.result.objects.items.len==self.result.objects.capacity) self.result.objects.items.len else 0));
        }
        try self.object_keys.ensureUnusedCapacity(self.c.allocator,1); try self.result.creation_storage.ensureUnusedCapacity(self.c.allocator,1);
        const object_origin: facts.ObjectOrigin=if(key.entry_parameter) |parameter| .{.entry=.{.context=at.context,.parameter=parameter}} else .{.allocation=at};
        try self.result.objects.append(self.c.allocator,.{.origin=object_origin,.kind=key.kind,.@"type"=key.@"type",.environment=key.environment,.weak=weak});
        self.object_keys.appendAssumeCapacity(key); self.result.creation_storage.appendAssumeCapacity(sites); self.result.objects.items[self.result.objects.items.len-1].creations=sites.items;
        self.changed=true; return @enumFromInt(self.result.objects.items.len-1);
    }
    fn cell(self: *Engine, at: facts.Site, binding: t.CellRef, weak: bool) Error!facts.CellId {
        const activation=self.info(at.context).activation;
        for(self.result.cells.items,0..) |*row,i| { try self.c.step(); if(row.binding==binding and self.cell_activations.items[i]==activation and std.meta.eql(row.origin.location,at.location)) {
            if(weak and !row.weak) { if(self.replay)return error.InvalidShape; row.weak=true; self.changed=true; } return @enumFromInt(i);
        } }
        if(self.replay)return error.InvalidShape;
        try self.cell_activations.ensureUnusedCapacity(self.c.allocator,1);
        try self.result.cells.append(self.c.allocator,.{.origin=at,.binding=binding,.weak=weak}); self.changed=true;
        self.cell_activations.appendAssumeCapacity(activation);
        return @enumFromInt(self.result.cells.items.len-1);
    }

    fn closureLegacy(self: *Engine) bool {
        return self.c.program.tables.mode==.legacy and self.c.program.tables.mode.legacy.closures.functions.len!=0;
    }
    fn provenanceSubset(self: *Engine, into: facts.Value, from: facts.Value) Error!void {
        for(from.effect_origins) |origin_value| { var found=false;
            for(into.effect_origins) |existing| { try self.c.step(); if(std.meta.eql(existing,origin_value)) { found=true; break; } }
            try self.c.require(found);
        }
    }
    fn abi(self: *Engine, function: t.FunctionRef) usize { return @intFromEnum(self.c.program.functions[@intFromEnum(function)].abi); }
    fn declared(self: *Engine, id: t.TypeRef) Error!V {
        // This declared-value recipe belongs only to legacy/EH. Common keeps
        // actual storage semantics: its explicit exported Array roles use the
        // separate entry boundary; missing roles never use a carrier maximum.
        try self.c.step(); var result: V=.{}; errdefer result.deinit(self.c.allocator);
        switch(self.c.program.tables.mode) {
            .common => return error.WrongMode,
            .legacy => |v| {
                const row=v.types[@intFromEnum(id)];
                if(row.kind==.@"union") {
                    for(row.members) |member| { var child=try self.declared(member); defer child.deinit(self.c.allocator); _=try result.join(self.c,child.view()); }
                } else { _=try result.tag(self.c,id); if(row.kind==.function)result.callable_unknown=true;
                    if(row.kind==.reference or row.kind==.value or row.kind==.array or row.kind==.readSpan)result.unknown=true;
                }
                if(std.mem.eql(u8,row.name,"bool"))result.truth=3;
            },
            .exception => |v| {
                const row=v.types[@intFromEnum(id)];
                switch(row.kind) {
                    .unknown => result.unknown=true,
                    .nullable => {
                        _=try result.tag(self.c,row.base.?);
                        if(v.types[@intFromEnum(row.base.?)].kind==.callable)result.callable_unknown=true;
                        for(v.types,0..) |candidate,i| { try self.c.step();
                            if((candidate.kind==.@"undefined" and row.mask&1!=0) or (candidate.kind==.@"null" and row.mask&2!=0))_=try result.tag(self.c,@enumFromInt(i));
                        }
                    },
                    else => { _=try result.tag(self.c,id); if(row.kind==.callable)result.callable_unknown=true; },
                }
                if(row.kind==.scalar and std.mem.eql(u8,row.name,"bool"))result.truth=3;
            },
        }
        return result;
    }
    fn resultType(self: *Engine, function: t.FunctionRef, reg: t.RegisterRef) Error!t.TypeRef {
        const carrier=self.c.program.functions[@intFromEnum(function)].registers[@intFromEnum(reg)].carrier;
        try self.c.step(); if(carrier==.@"type")return carrier.@"type";
        // A native instruction has exactly one native physical type. This is
        // its operation type, never expansion of an arbitrary capacity set.
        if(carrier==.domain and self.c.program.tables.mode==.legacy) {
            const alternatives=self.c.program.tables.mode.legacy.domains[@intFromEnum(carrier.domain)].alternatives;
            try self.c.require(alternatives.len==1); return alternatives[0];
        }
        return error.InvalidShape;
    }
    fn origins(self: *Engine, value: *V, source: []const facts.EffectOrigin) Error!void {
        value.effect_origins.clearRetainingCapacity();
        for(source) |effect_origin|_=try value.effectOrigin(self.c,effect_origin);
    }
    fn origin(self: *Engine, value: *V, context: facts.ContextId, owner: @FieldType(facts.EffectOrigin,"owner")) Error!void {
        const one=[_]facts.EffectOrigin{.{.context=context,.owner=owner}}; try self.origins(value,&one);
    }
    fn receiverLifetimes(self: *Engine, at: facts.Site, state: *const State, phase: facts.ReceiverPhase) Error!void {
        if(!self.emit or self.c.program.tables.mode!=.common)return;
        try receiver_actual.observeLifetimes(self.c,&self.info(at.context).receiver_lifetimes,self.result.view(),at.context,&state.frames,phase);
    }
    fn callback(self: *Engine, before: bool, at: facts.Site, state: *const State) Error!void {
        try self.receiverLifetimes(at,state,.prefix);
        if(!self.emit)return;
        for(self.observers) |observer| { try self.c.step(); const action=if(before)observer.before else observer.after;
            if(action) |f|try f(observer.client,self.c,self.result.view(),at,state.view());
        }
    }
    fn notifyEdge(self: *Engine, at: facts.Site, to: facts.Location) Error!void {
        if(self.emit)for(self.observers) |observer| { try self.c.step(); if(observer.edge) |f|try f(observer.client,self.c,self.result.view(),at,to); };
    }
    fn notifyCall(self: *Engine, at: facts.Site, callee: facts.ContextId, normal: facts.Location, language: ?facts.Location) Error!void {
        if(self.emit)for(self.observers) |observer| { try self.c.step(); if(observer.call) |f|try f(observer.client,self.c,self.result.view(),.{.caller=at,.callee=callee,.normal=normal,.language=language}); };
    }
    fn completion(self: *Engine, at: facts.Site, kind: facts.Completion, value: facts.Value, state: *const State) Error!void {
        try self.receiverLifetimes(at,state,switch(kind){.normal=>.normal,.language=>.language,.request_trap=>.request_trap});
        const invocation=self.info(at.context);
        if(self.c.program.tables.mode==.common and kind!=.request_trap) {
            var d=self.domain(); try d.returned(invocation.region_scope,invocation.root,try facts.relation(self.c,value),&state.relations);
            if(invocation.root)try self.hardEscape(value,state.heap.view());
        }
        if(kind!=.request_trap and !self.replay) {
            const normal=kind==.normal; const flag=if(normal)&invocation.normal else &invocation.language;
            if(!flag.*) { flag.*=true; self.changed=true; }
            const returned=if(normal)&invocation.returned else &invocation.thrown;
            if(try returned.join(self.c,value))self.changed=true;
            var roots: std.ArrayListUnmanaged(V)=.empty; defer roots.deinit(self.c.allocator);
            try self.c.charge(invocation.arguments.len+1); try roots.appendSlice(self.c.allocator,invocation.arguments);
            var extra=try V.clone(self.c,value); defer extra.deinit(self.c.allocator); try roots.append(self.c.allocator,extra);
            var bound=try receiver_actual.retained(self.c,&state.frames,invocation.arguments); defer bound.deinit(self.c.allocator);
            if(!bound.view().bottom()) {
                try self.c.charge(1+@as(usize,if(roots.items.len==roots.capacity)roots.items.len else 0));
                try roots.ensureUnusedCapacity(self.c.allocator,1); roots.appendAssumeCapacity(bound);
            }
            var heap=try self.reachable(roots.items,state.heap.view()); defer heap.deinit(self.c.allocator);
            if(try (if(normal)&invocation.normal_heap else &invocation.language_heap).join(self.c,heap.view()))self.changed=true;
            var selected=try self.selectedReachable(roots.items,&state.relations); defer selected.deinit(self.c.allocator);
            if(try (if(normal)&invocation.normal_relations else &invocation.language_relations).join(self.c,&selected))self.changed=true;
            var frames=try receiver_actual.select(self.c,&state.frames,invocation.arguments); defer receiver_actual.deinit(&frames,self.c.allocator);
            if(try receiver_actual.join(self.c,if(normal)&invocation.normal_frames else &invocation.language_frames,&frames))self.changed=true;
        }
        if(self.emit)for(self.observers) |observer| { try self.c.step(); if(observer.completed) |f|try f(observer.client,self.c,self.result.view(),at,kind,value,.{.heap=&state.heap,.relations=&state.relations}); };
    }
    const Graph = struct {
        invocation: facts.ContextId,
        incoming: []?State,
        queued: []bool,
        work: std.ArrayListUnmanaged(t.BlockRef)=.empty,
        loop: []bool,
        collect: bool=true,
        fn deinit(self: *Graph, c: *Context) void {
            for(self.incoming) |*state|if(state.*) |*s|s.deinit(c);
            c.allocator.free(self.incoming); c.allocator.free(self.queued); c.allocator.free(self.loop); self.work.deinit(c.allocator);
        }
    };
    fn edge(self: *Engine, graph: *Graph, at: facts.Site, target: t.BlockRef, state: *const State, arguments: []const V) Error!void {
        // Fork-local receiver_bind states are not the caller's after-callback
        // state. Sample the actual edge state even when the replay won't join it.
        try self.receiverLifetimes(at,state,.prefix);
        const function=self.c.program.functions[@intFromEnum(at.location.function)]; const b=@intFromEnum(target);
        const parameters=function.blocks[b].parameters; try self.c.require(parameters.len==arguments.len);
        try self.notifyEdge(at,.{.function=at.location.function,.block=target,.instruction=0});
        if(!graph.collect)return;
        var incoming=try State.clone(self.c,state); var owns=true; defer if(owns)incoming.deinit(self.c);
        for(parameters,arguments) |parameter,argument|try incoming.assign(self.c,parameter,argument.view());
        try self.cut(at,target,&incoming);
        const grew=if(graph.incoming[b]) |*old|try old.join(self.c,&incoming) else blk: {
            graph.incoming[b]=incoming; owns=false; break :blk true;
        };
        if(grew and !graph.queued[b]) { try self.c.step(); graph.queued[b]=true; try graph.work.append(self.c.allocator,target); }
    }
    fn remapOrigins(self: *Engine, at: facts.Site, callee: facts.ContextId, passed: []const V, frames: *const facts.FrameStore, value: facts.Value, from_binding: bool, result: *V) Error!void {
        const target=self.c.program.functions[@intFromEnum(self.info(callee).function)];
        for(value.effect_origins) |source| { try self.c.step();
            if(source.context==callee) switch(source.owner) {
                .parameter => |reg| {
                    var found=false;
                    for(target.blocks[0].parameters,0..) |entry,i| { try self.c.step(); if(entry!=reg)continue;
                        found=true;
                        if(target.registers[@intFromEnum(reg)].carrier==.receiver) {
                            // The frame argument intentionally has no language
                            // owners. Translate logical-this through its saved
                            // selected binding from THIS completion instead.
                            var mapped=false;
                            if(!from_binding) for(passed[i].frames.items) |id| {
                                try self.c.step(); const selected=frames.entries.getPtr(id) orelse continue;
                                mapped=true; try self.remapOrigins(at,callee,passed,frames,selected.bound.view(),true,result);
                                if(selected.unresolved) { _=try result.effectOrigin(self.c,.{.context=at.context,.owner=.unknown}); _=self.unknown(at.context); }
                            };
                            // A nested frame-owner token without an independent
                            // payload mapping is an explicit gap, never empty.
                            if(!mapped) { _=try result.effectOrigin(self.c,.{.context=at.context,.owner=.unknown}); _=self.unknown(at.context); }
                        } else for(passed[i].effect_origins.items) |origin_value|_=try result.effectOrigin(self.c,origin_value);
                        break;
                    }
                    try self.c.require(found);
                },
                .global,.capture => { var renamed=source; renamed.context=at.context; _=try result.effectOrigin(self.c,renamed); },
                .unknown => _=try result.effectOrigin(self.c,.{.context=at.context,.owner=.unknown}),
            } else if(source.context==at.context)_=try result.effectOrigin(self.c,source) else _=try result.effectOrigin(self.c,.{.context=at.context,.owner=.unknown});
        }
        // Unknown actual bits are not necessarily unknown ownership: an
        // external argument still has its precise parameter token.
        if(value.unknown and value.effect_origins.len==0)_=try result.effectOrigin(self.c,.{.context=at.context,.owner=.unknown});
    }
    fn copyOrigins(self: *Engine, at: facts.Site, callee: facts.ContextId, passed: []const V, value: facts.Value, frames: *const facts.FrameStore) Error!V {
        var result=try V.clone(self.c,value); errdefer result.deinit(self.c.allocator); result.effect_origins.clearRetainingCapacity();
        try self.remapOrigins(at,callee,passed,frames,value,false,&result);
        return result;
    }
    fn overlay(self: *Engine, state: *State, heap: facts.HeapView) Error!void {
        var iterator=heap.iterator(); while(iterator.next()) |entry| {
            try self.c.step(); const weak=switch(entry.slot) {
                .global => false, .cell => |id| self.result.cells.items[@intFromEnum(id)].weak,
                .field => |v| self.result.objects.items[@intFromEnum(v.object)].weak,
                .element => |v| self.result.objects.items[@intFromEnum(v.object)].weak,
                .environment_slot => |v| self.result.objects.items[@intFromEnum(v.object)].weak,
                .capture => |v| self.result.objects.items[@intFromEnum(v.object)].weak,
                .length,.span_owner,.span_start,.span_length,.parent => |v| self.result.objects.items[@intFromEnum(v)].weak,
            };
            _=try state.heap.put(self.c,entry.slot,entry.value,!weak);
        }
    }
    fn invoke(self: *Engine, graph: *Graph, at: facts.Site, target: t.FunctionRef, arguments: []const V, state: *State, normal: ?t.BlockRef, language: ?t.BlockRef, weak: bool, output: *V, complete: bool) Error!void {
        if(self.c.program.tables.mode==.common and self.c.program.tables.mode.common.abis[self.abi(target)].construction!=null) {
            // Keep current body actual identities for heap safety. They are
            // NOT the missing fixed construction/newTarget caller upper.
            try self.c.charge(2); const caller=self.info(at.context);
            caller.receiver_upper_gap=true;
            if(!caller.unresolved) { caller.unresolved=true; self.changed=true; }
            self.result.unresolved=true;
        }
        const scope=try self.callScope(at,target,arguments,state,complete);
        try self.c.charge(arguments.len); const passed=try self.c.allocator.alloc(V,arguments.len); @memset(passed,.{});
        defer { for(passed) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(passed); }
        for(arguments,passed) |argument,*out| { out.*=try V.clone(self.c,argument.view()); if(self.c.program.tables.mode==.common and scope==null)try out.region.age(self.c); }
        const callee=try self.contextFor(target,passed,state.heap.view(),at,false,weak,if(scope!=null)&state.relations else null,scope,&state.frames,null);
        const next=facts.Location{.function=at.location.function,.block=normal orelse at.location.block,.instruction=if(normal==null)at.location.instruction+1 else 0};
        if(self.replay and self.c.program.tables.mode==.common and self.c.program.tables.mode.common.abis[self.abi(target)].construction!=null) {
            try self.c.row(facts.CallEdge);
            const call_edge=facts.CallEdge{.caller=at,.callee=callee,.normal=next,.language=if(language) |b| .{.function=at.location.function,.block=b,.instruction=0} else null};
            var found=false;
            for(self.result.receiver_calls.items) |old| { try self.c.row(facts.CallEdge); if(std.meta.eql(old,call_edge)) { found=true; break; } }
            if(!found) {
                try self.c.row(facts.CallEdge);
                if(self.result.receiver_calls.items.len==self.result.receiver_calls.capacity)try self.c.charge(self.result.receiver_calls.items.len+1);
                try self.result.receiver_calls.append(self.c.allocator,call_edge);
            }
        }
        try self.notifyCall(at,callee,next,if(language) |b| .{.function=at.location.function,.block=b,.instruction=0} else null);
        const called=self.info(callee);
        if(normal) |b| {
            if(called.normal) {
                var after=try State.clone(self.c,state); defer after.deinit(self.c); try self.overlay(&after,called.normal_heap.view());
                try after.relations.overlay(self.c,&called.normal_relations);
                try receiver_actual.overlay(self.c,&after.frames,&called.normal_frames);
                var value=try self.copyOrigins(at,callee,arguments,called.returned.view(),&called.normal_frames); defer value.deinit(self.c.allocator);
                const count=self.c.program.functions[@intFromEnum(at.location.function)].blocks[@intFromEnum(b)].parameters.len;
                try self.edge(graph,at,b,&after,if(count==0)&.{} else @as([]const V, &.{value}));
            }
            if(called.language) {
                var after=try State.clone(self.c,state); defer after.deinit(self.c); try self.overlay(&after,called.language_heap.view());
                try after.relations.overlay(self.c,&called.language_relations);
                try receiver_actual.overlay(self.c,&after.frames,&called.language_frames); try receiver_actual.abortInitializers(self.c,&after.frames);
                var value=try self.copyOrigins(at,callee,arguments,called.thrown.view(),&called.language_frames); defer value.deinit(self.c.allocator);
                try self.edge(graph,at,language.?,&after,&.{value});
            }
        } else {
            // The legacy closure contract is a context-insensitive language
            // may graph; its non-CPS calls do not prune the following block
            // according to a callee's current completion approximation.
            var value=try self.copyOrigins(at,callee,arguments,called.returned.view(),&called.normal_frames); defer value.deinit(self.c.allocator);
            _=try output.join(self.c,value.view()); try self.overlay(state,called.normal_heap.view());
            try state.relations.overlay(self.c,&called.normal_relations);
            try receiver_actual.overlay(self.c,&state.frames,&called.normal_frames);
        }
    }
    fn havoc(self: *Engine, context: facts.ContextId, state: *State) Error!void {
        // Without caller code a call may mutate every reachable argument and
        // global. Preserve object identity/weakness, not invented field facts.
        for(state.values) |value| { try self.c.step(); try self.escape(value.view(),state,true); }
        var present: V=.{}; defer present.deinit(self.c.allocator);
        var slots=state.heap.view().iterator(); while(slots.next()) |entry| { try self.c.step();
            try self.escape(entry.value,state,true);
            switch(entry.slot) {
                inline .field,.element,.environment_slot,.capture => |v| { _=try present.object(self.c,v.object); },
                .length,.span_owner,.span_start,.span_length,.parent => |v| { _=try present.object(self.c,v); },
                .cell,.global => {},
            }
        }
        state.relations.deinit(self.c.allocator);
        var iterator=state.heap.entries.valueIterator();
        while(iterator.next()) |value| { try self.c.step(); value.deinit(self.c.allocator); value.*=try V.clone(self.c,self.unknown(context)); }
        for(present.objects.items) |id| { try self.c.step();
            if(self.result.objects.items[@intFromEnum(id)].kind==.array)_=try state.heap.put(self.c,.{.element=.{.object=id,.index=null}},self.unknown(context),false);
        }
    }
    fn unknownInvoke(self: *Engine, graph: *Graph, at: facts.Site, state: *State, normal: t.BlockRef, language: t.BlockRef) Error!void {
        var after=try State.clone(self.c,state); defer after.deinit(self.c); try self.havoc(at.context,&after);
        var value=try V.clone(self.c,self.unknown(at.context)); defer value.deinit(self.c.allocator); try self.origin(&value,at.context,.unknown);
        const count=self.c.program.functions[@intFromEnum(at.location.function)].blocks[@intFromEnum(normal)].parameters.len;
        try self.edge(graph,at,normal,&after,if(count==0)&.{} else @as([]const V,&.{value}));
        try self.edge(graph,at,language,&after,&.{value});
    }
    fn base(self: *Engine, id: t.TypeRef) ?t.TypeRef {
        return switch(self.c.program.tables.mode) { inline .common,.legacy,.exception => |v| v.types[@intFromEnum(id)].base };
    }
    fn extends(self: *Engine, actual: t.TypeRef, owner: t.TypeRef) Error!bool {
        var current: ?t.TypeRef=actual;
        while(current) |id| { try self.c.step(); if(id==owner)return true; current=self.base(id); }
        return false;
    }
    fn fieldFor(self: *Engine, actual: t.TypeRef, member: t.FieldRef) Error!t.FieldRef {
        switch(self.c.program.tables.mode) {
            inline .common,.legacy => |v| {
                const requested=v.members.fields[@intFromEnum(member)];
                if(try self.extends(actual,requested.owner))return member;
                // A structural projection retains real field identity, never
                // an arbitrary producer dispatch arm as an actual seed.
                try self.c.require(try self.is(actual,"reference")); var current: ?t.TypeRef=actual;
                while(current) |id| { for(v.members.fields,0..) |field,i| { try self.c.charge(1+field.name.len/64);
                    if(field.owner==id and std.mem.eql(u8,field.name,requested.name))return @enumFromInt(i);
                } current=self.base(id); }
            },
            .exception => return member,
        }
        return error.InvalidShape;
    }
    fn methodFor(self: *Engine, actual: t.TypeRef, member: t.MethodRef) Error!?t.FunctionRef {
        switch(self.c.program.tables.mode) {
            inline .common,.legacy => |v| {
                const requested=v.members.methods[@intFromEnum(member)]; var current: ?t.TypeRef=actual;
                while(current) |id| { for(v.members.methods) |method| { try self.c.step();
                    // Common names are semantic data. Legacy method ids are
                    // independently joined by their already checked view map.
                    const matches=if(@hasField(@TypeOf(method),"name"))std.mem.eql(u8,method.name,requested.name) else legacy: {
                        var candidate: ?t.Hash=method.id;
                        while(candidate) |hash| {
                            try self.c.step(); if(std.mem.eql(u8,&hash,&requested.id))break :legacy true;
                            var next: ?t.Hash=null;
                            for(v.members.methods) |row| { try self.c.step(); if(std.mem.eql(u8,&row.id,&hash)) { next=row.override; break; } }
                            candidate=next;
                        }
                        break :legacy false;
                    };
                    if(method.owner==id and matches)return method.function;
                } current=self.base(id); }
                // Legacy's normalized member directory does not preserve a
                // structural method name. Do not reverse a hash or treat its
                // dispatch claim as the missing semantic selector.
                if(self.c.program.tables.mode==.legacy)return null;
            },
            .exception => return error.WrongMode,
        }
        return error.InvalidShape;
    }
    fn readField(self: *Engine, context: facts.ContextId, heap: facts.HeapView, receiver: facts.Value, member: t.FieldRef) Error!V {
        var value: V=.{}; errdefer value.deinit(self.c.allocator);
        if(receiver.unknown or (receiver.objects.len==0 and receiver.tags.len!=0))_=try value.join(self.c,self.unknown(context));
        for(receiver.objects) |id| { try self.c.step(); const object_info=self.result.objects.items[@intFromEnum(id)];
            const selected=try self.fieldFor(object_info.@"type" orelse return error.InvalidShape,member);
            if(heap.get(.{.field=.{.object=id,.field=selected}})) |stored|_=try value.join(self.c,stored)
            else if(self.primitives.get("undefined")) |absent|_=try value.tag(self.c,absent) else _=try value.join(self.c,self.unknown(context));
        }
        try self.origins(&value,receiver.effect_origins); return value;
    }
    fn writeField(self: *Engine, state: *State, receiver: facts.Value, member: t.FieldRef, value: facts.Value) Error!void {
        for(receiver.objects) |id| { try self.c.step(); const object_info=self.result.objects.items[@intFromEnum(id)];
            const selected=try self.fieldFor(object_info.@"type" orelse return error.InvalidShape,member);
            _=try state.heap.put(self.c,.{.field=.{.object=id,.field=selected}},value,!object_info.weak and receiver.objects.len==1 and !receiver.unknown);
        }
    }
    fn owners(self: *Engine, heap: facts.HeapView, receiver: facts.Value) Error!V {
        var result: V=.{}; errdefer result.deinit(self.c.allocator);
        result.unknown=receiver.unknown;
        for(receiver.objects) |id| { try self.c.step(); const object_info=self.result.objects.items[@intFromEnum(id)];
            if(object_info.kind==.read_span) {
                if(heap.get(.{.span_owner=id})) |stored|_=try result.join(self.c,stored) else result.unknown=true;
            } else if(object_info.kind==.array)_=try result.object(self.c,id) else return error.InvalidShape;
        }
        return result;
    }
    fn makeObject(self: *Engine, at: facts.Site, kind: facts.ObjectKind, id: t.TypeRef, weak: bool) Error!V {
        var result=try self.literal(id); errdefer result.deinit(self.c.allocator);
        _=try result.object(self.c,try self.object(at,kind,id,null,weak)); return result;
    }
    fn copyValue(self: *Engine, at: facts.Site, input: facts.Value, state: *State, weak: bool) Error!V {
        var result=try V.clone(self.c,input); errdefer result.deinit(self.c.allocator); result.objects.clearRetainingCapacity();
        // An inline value copy copies its value children, not references or
        // closure environments. A work list handles shared/cyclic references
        // without reinterpreting a site as a runtime instance.
        var copies: std.ArrayListUnmanaged(CopyPair)=.empty; defer copies.deinit(self.c.allocator);
        for(input.objects) |id| { try self.c.step(); const old=self.result.objects.items[@intFromEnum(id)];
            if(old.kind!=.value) { _=try result.object(self.c,id); continue; }
            const copy_id=try self.objectKey(at,.{.activation=self.info(at.context).activation,.location=at.location,.kind=.value,.@"type"=old.@"type",.environment=null,.copy_source=id},weak or old.weak or input.objects.len>1);
            if(!self.replay)self.result.objects.items[@intFromEnum(copy_id)].origin=.{.copy=.{.site=at,.original=id}};
            _=try result.object(self.c,copy_id); try copies.append(self.c.allocator,.{.original=id,.copied=copy_id,.parent=null});
        }
        // Gather before insertion: HashMap growth invalidates its iterator.
        const Entry=struct { slot: facts.Slot, value: V };
        var entries: std.ArrayListUnmanaged(Entry)=.empty; defer { for(entries.items) |*entry|entry.value.deinit(self.c.allocator); entries.deinit(self.c.allocator); }
        var cursor: usize=0;
        while(cursor<copies.items.len) : (cursor+=1) { const pair=copies.items[cursor]; var iterator=state.heap.view().iterator(); while(iterator.next()) |entry| {
            try self.c.step(); if(entry.slot!=.field or entry.slot.field.object!=pair.original)continue;
            var stored=try V.clone(self.c,entry.value); errdefer stored.deinit(self.c.allocator); stored.objects.clearRetainingCapacity();
            for(entry.value.objects) |child| { try self.c.step(); const child_info=self.result.objects.items[@intFromEnum(child)];
                if(child_info.kind!=.value) { _=try stored.object(self.c,child); continue; }
                var ancestor: ?usize=cursor;
                while(ancestor) |index| { try self.c.step(); try self.c.require(copies.items[index].original!=child); ancestor=copies.items[index].parent; }
                const child_copy=try self.objectKey(at,.{.activation=self.info(at.context).activation,.location=at.location,.kind=.value,.@"type"=child_info.@"type",.environment=null,
                    .copy_source=child,.copy_parent=pair.copied,.copy_field=entry.slot.field.field},weak or child_info.weak or entry.value.objects.len>1);
                if(!self.replay)self.result.objects.items[@intFromEnum(child_copy)].origin=.{.copy=.{.site=at,.original=child}};
                _=try stored.object(self.c,child_copy); try copies.append(self.c.allocator,.{.original=child,.copied=child_copy,.parent=cursor,.field=entry.slot.field.field});
            }
            try entries.append(self.c.allocator,.{.slot=.{.field=.{.object=pair.copied,.field=entry.slot.field.field}},.value=stored});
        } }
        for(entries.items) |entry|_=try state.heap.put(self.c,entry.slot,entry.value.view(),!self.result.objects.items[@intFromEnum(entry.slot.field.object)].weak);
        if(self.c.program.tables.mode==.common) {
            var selected=try self.copyRegion(at,try facts.relation(self.c,input),copies.items,null,null,state,0); defer selected.deinit(self.c.allocator);
            try self.setRegion(&result,selected.view());
        }
        return result;
    }
    fn projectRegion(self: *Engine, selected: *V, source: facts.Value) Error!void {
        if(self.c.program.tables.mode!=.common)return;
        const original=try facts.relation(self.c,source);
        var projected=region_data.OwnedValue{.known=true,.unresolved=original.unresolved,.empty=original.empty,.number=original.number}; defer projected.deinit(self.c.allocator);
        for(original.roots) |root| { try self.c.step(); const reference=self.result.region_nodes.items[@intFromEnum(root)].reference;
            for(selected.objects.items) |object_id| { try self.c.step(); if(reference==object_id) { const one=[_]relation.Root{root}; _=try projected.join(self.c,.{.known=true,.roots=&one}); break; } }
        }
        if(selected.objects.items.len!=0 and projected.roots.items.len==0)projected.unresolved=true;
        try self.setRegion(selected,projected.view());
    }
    fn currentLoad(self: *Engine, receiver: facts.Value, slot: relation.Slot, state: *const State) Error!region_data.OwnedValue {
        var d=self.domain(); return d.load(try facts.relation(self.c,receiver),slot,&state.relations);
    }
    fn scalarResult(self: *Engine, carrier: t.Carrier) Error!bool {
        const common=self.c.program.tables.mode.common;
        switch(carrier) {
            .@"type" => |id|return self.nonowningType(id),
            .domain => |id| {
                const alternatives=common.domains[@intFromEnum(id)].actual_types;
                if(alternatives.len==0)return false;
                for(alternatives) |alternative| { try self.c.step(); if(!try self.nonowningType(alternative))return false; }
                return true;
            },
            else => return false,
        }
    }
    fn nonowningType(self: *Engine, id: t.TypeRef) Error!bool {
        try self.c.step(); return switch(self.c.program.tables.mode.common.types[@intFromEnum(id)].kind) {
            .scalar,.@"undefined",.@"null" => true,
            else => false,
        };
    }
    fn freshRegister(self: *Engine, function: t.FunctionRef, reg: t.RegisterRef, kind: enum { environment, cell, object }) Error!bool {
        for(self.c.program.functions[@intFromEnum(function)].blocks) |block|for(block.instructions) |op| {
            try self.c.step(); if(op.result!=reg)continue;
            return switch(kind) { .environment => op.data==.environment_alloc, .cell => op.data==.eh_cell, .object => op.data==.eh_construct };
        };
        return false;
    }
    fn captureWrite(self: *Engine, function: t.FunctionRef, receiver: t.RegisterRef, slot_ref: t.EnvironmentSlotRef) Error!bool {
        const common=self.c.program.tables.mode.common; const record=self.c.program.functions[@intFromEnum(function)];
        const carrier=record.registers[@intFromEnum(receiver)].carrier;
        if(carrier!=.environment)return false;
        const layout=carrier.environment; const slot=common.closures.environments[@intFromEnum(layout)].slots[@intFromEnum(slot_ref)];
        if(!slot.writable)return false;
        var occurrences: usize=0;
        for(common.closures.environments) |environment|for(environment.slots) |candidate| {
            try self.c.step(); if(std.meta.eql(slot.key,candidate.key))occurrences+=1;
        };
        if(occurrences!=1)return false;
        const typed=common.types[@intFromEnum(slot.@"type")];
        const scalar_array=typed.kind==.array and typed.element!=null and common.types[@intFromEnum(typed.element.?)].kind==.scalar;
        if(typed.kind!=.scalar and typed.kind!=.string and !scalar_array)return false;
        var declared_write=false;
        for(common.authority.fixed_publication.publication.contracts) |contract| {
            try self.c.step(); if(!std.meta.eql(contract.function_id,record.id))continue;
            for(contract.upper.captures) |access| { try self.c.step(); if(std.meta.eql(access.slot,slot.key) and access.write and !access.structural)declared_write=true; }
        }
        if(!declared_write)return false;
        var parent=common.abis[self.abi(function)].lexical_environment;
        for(common.closures.functions) |row| { try self.c.step(); if(row.function==function) { parent=row.activation_environment orelse row.lexical_environment; break; } }
        while(parent) |current| {
            try self.c.step(); if(current==layout)return true; parent=common.closures.environments[@intFromEnum(current)].parent;
        }
        return false;
    }
    fn readerCode(self: *Engine, reader: t.FunctionRef) Error!bool {
        try self.c.step(); if(self.transport_readers.get(reader)) |cached|return cached;
        var pending: std.ArrayListUnmanaged(t.FunctionRef)=.empty; defer pending.deinit(self.c.allocator);
        var visited: std.AutoHashMapUnmanaged(t.FunctionRef,void)=.empty; defer visited.deinit(self.c.allocator);
        try pending.append(self.c.allocator,reader); var cursor: usize=0; var allowed=true;
        const common=self.c.program.tables.mode.common;
        walk: while(cursor<pending.items.len) : (cursor+=1) {
            try self.c.step(); const target=pending.items[cursor]; const found=try visited.getOrPut(self.c.allocator,target); if(found.found_existing)continue;
            if(!(try self.prepareRegionGraph(target)).acyclic or try self.recursiveFunction(target)) { allowed=false; break; }
            const function=self.c.program.functions[@intFromEnum(target)];
            // Carrier maxima only exclude managed returns; they never create
            // an actual value or code/environment pair. This first slice is
            // deliberately narrower than the C++ may-throw reader rule.
            if(common.abis[self.abi(target)].result_carrier) |result_carrier| {
                if(!try self.scalarResult(result_carrier)) { allowed=false; break; }
            }
            var contract_found=false;
            for(common.authority.fixed_publication.publication.contracts) |contract| {
                try self.c.step(); if(!std.meta.eql(contract.function_id,function.id))continue; contract_found=true;
                const upper_bound=contract.upper;
                if(upper_bound.facets.unknown_host or upper_bound.facets.@"await" or upper_bound.facets.lock or upper_bound.facets.escape or upper_bound.facets.may_throw or
                    upper_bound.globals.reads.len!=0 or upper_bound.globals.writes.len!=0 or upper_bound.host_resources.reads.len!=0 or upper_bound.host_resources.writes.len!=0) { allowed=false; break :walk; }
                for(upper_bound.parameters) |access| { try self.c.step(); if(access.write or access.structural) { allowed=false; break :walk; } }
                for(upper_bound.captures) |access| {
                    try self.c.step(); if(access.structural) { allowed=false; break :walk; }
                    if(!access.write)continue;
                    var matched=false;
                    for(common.closures.environments,0..) |environment,e|for(environment.slots,0..) |slot,s| {
                        try self.c.step(); if(!std.meta.eql(slot.key,access.slot))continue;
                        // A real code register must name this layout. This is
                        // the canonical capture slot, not a same-name binding.
                        for(function.registers,0..) |reg,r| { try self.c.step(); if(reg.carrier==.environment and @intFromEnum(reg.carrier.environment)==e) {
                            if(try self.captureWrite(target,@enumFromInt(r),@enumFromInt(s)))matched=true;
                        } }
                    };
                    if(!matched) { allowed=false; break :walk; }
                }
                break;
            }
            if(!contract_found) { allowed=false; break; }
            // Inspect EVERY typed block, including branches not selected by
            // any current actual context. Upper claims alone cannot erase a
            // global/Host/store or turn a missing call into an empty effect.
            for(function.blocks,0..) |block,b|for(block.instructions,0..) |op,index| {
                try self.c.step(); switch(op.data) {
                    .global_load,.global_store,.authorized_host,.domain_array_store,.domain_array_resize,.domain_field_store,.eh_raise,.eh_publish,
                    .@"call",.function_call,.domain_method_call,.domain_construct,.domain_super,.domain_initialize_fields,.domain_field_define,.domain_field_initialize => { allowed=false; break :walk; },
                    .eh_store => { if(!try self.freshRegister(target,op.operands[0],.cell)) { allowed=false; break :walk; } },
                    inline .environment_init,.environment_store => |write| {
                        if(!try self.freshRegister(target,op.operands[0],.environment) and !try self.captureWrite(target,op.operands[0],write.slot)) { allowed=false; break :walk; }
                    },
                    .eh_field_initialize => { if(!try self.freshRegister(target,op.operands[0],.object)) { allowed=false; break :walk; } },
                    .eh_invoke => |call|try pending.append(self.c.allocator,call.callee),
                    .eh_invoke_indirect => {
                        var matched=false;
                        for(common.closures.calls) |row| {
                            try self.c.step(); if(row.function!=target or @intFromEnum(row.block)!=b or row.instruction!=index)continue;
                            matched=true; if(row.targets.len==0) { allowed=false; break :walk; }
                            try self.c.charge(row.targets.len); try pending.appendSlice(self.c.allocator,row.targets);
                        }
                        if(!matched) { allowed=false; break :walk; }
                    },
                    .common_method_invoke => |call| {
                        const arms=common.views.dispatch[@intFromEnum(call.dispatch)].method.arms;
                        if(arms.len==0) { allowed=false; break :walk; }
                        for(arms) |arm| { try self.c.step(); const callee=arm.target orelse { allowed=false; break :walk; }; try pending.append(self.c.allocator,callee); }
                    },
                    else => {},
                }
            };
        }
        try self.transport_readers.put(self.c.allocator,reader,allowed); return allowed;
    }
    fn wholeCallable(self: *Engine, value: facts.Value, state: *const State) Error!bool {
        if(value.unknown or value.callable_unknown or value.objects.len!=0 or value.cells.len!=0 or value.tags.len==0 or value.callables.len==0)return false;
        const common=self.c.program.tables.mode.common;
        const current=try facts.relation(self.c,value);
        if(!current.known or current.unresolved or current.empty or current.roots.len==0)return false;
        for(value.tags) |tag| { try self.c.step(); if(common.types[@intFromEnum(tag)].kind!=.function)return false; }
        for(value.callables) |pair| {
            try self.c.step(); var private_parent=false;
            for(common.closures.functions) |row| { try self.c.step(); if(row.function==pair.code) { private_parent=row.parent!=null; break; } }
            if(!private_parent or !try self.readerCode(pair.code))return false;
            const layout=common.abis[self.abi(pair.code)].lexical_environment orelse return false;
            const object_id=pair.environment orelse return false; const actual=self.result.objects.items[@intFromEnum(object_id)];
            if(actual.kind!=.environment or actual.environment!=layout)return false;
            var represented=false;
            for(current.roots) |root| { try self.c.step(); represented=represented or self.result.region_nodes.items[@intFromEnum(root)].reference==object_id; }
            if(!represented)return false;
        }
        for(current.roots) |root| {
            try self.c.step(); const object_id=self.result.region_nodes.items[@intFromEnum(root)].reference; var paired=false;
            for(value.callables) |pair| { try self.c.step(); paired=paired or pair.environment==object_id; } if(!paired)return false;
        }
        // Reuse the current-version owning graph, not the environment's raw
        // shape alone. Unknown/missing/mutable descriptor paths cannot soften
        // an escape. This is a point-local classifier, not the deferred final
        // Borrow proof; later hard events remain irreversible.
        const scope=self.result.region_nodes.items[@intFromEnum(current.roots[0])].scope;
        if(self.result.region_scopes.items[@intFromEnum(scope)].hard)return false;
        var d=self.domain(); var holding=try relation.Holding.capture(&d,self.result.view(),scope,current,&state.relations,true); defer holding.deinit();
        if(!holding.complete or !holding.stable_complete)return false;
        var descriptors=false; for(holding.nodes.items) |node| { try self.c.step(); descriptors=descriptors or node.kind==.read_span; }
        if(descriptors and try holding.evaluate(&d,true)!=.proved)return false;
        return true;
    }
    fn transportReceiver(self: *Engine, receiver: facts.Value, array: bool, state: *const State) Error!bool {
        if(receiver.unknown or receiver.callable_unknown or receiver.objects.len==0 or receiver.tags.len==0 or receiver.cells.len!=0 or receiver.callables.len!=0)return false;
        const current=try facts.relation(self.c,receiver);
        // A known raw shape is not evidence of a local sink. Require genuine
        // current birth relations and keep absent/aged/external origins hard.
        if(!current.known or current.unresolved or current.empty or current.roots.len==0)return false;
        for(current.roots) |root| {
            try self.c.step(); const node=self.result.region_nodes.items[@intFromEnum(root)];
            if(self.result.region_scopes.items[@intFromEnum(node.scope)].hard)return false;
            var selected=false; for(receiver.objects) |object_id| { try self.c.step(); selected=selected or object_id==node.reference; }
            if(!selected)return false;
        }
        // Reuse actual raw reachability, rather than declaring global aliases
        // disjoint by type/name. Unknown global reachability remains a cap.
        var global_heap=try self.reachable(&.{},state.heap.view()); defer global_heap.deinit(self.c.allocator);
        var global_values=global_heap.view().iterator();
        while(global_values.next()) |entry| {
            try self.c.step(); if(entry.value.unknown or entry.value.callable_unknown)return false;
            for(receiver.objects) |object_id| {
                for(entry.value.objects) |external| { try self.c.step(); if(object_id==external)return false; }
                for(entry.value.callables) |pair| { try self.c.step(); if(pair.environment==object_id)return false; }
            }
        }
        const common=self.c.program.tables.mode.common;
        for(receiver.tags) |tag| {
            try self.c.step(); const kind=common.types[@intFromEnum(tag)].kind;
            if(if(array)kind!=.array else kind!=.reference and kind!=.value)return false;
            var represented=false;
            for(receiver.objects) |object_id| { try self.c.step(); represented=represented or self.result.objects.items[@intFromEnum(object_id)].@"type"==tag; }
            if(!represented)return false;
        }
        for(receiver.objects) |object_id| {
            try self.c.step(); const actual=self.result.objects.items[@intFromEnum(object_id)]; var tagged=false;
            if(actual.origin==.entry)return false;
            var versioned=false;
            for(current.roots) |root| { try self.c.step(); versioned=versioned or self.result.region_nodes.items[@intFromEnum(root)].reference==object_id; }
            if(!versioned)return false;
            for(receiver.tags) |tag| { try self.c.step(); tagged=tagged or actual.@"type"==tag; }
            if(!tagged or (if(array)actual.kind!=.array else actual.kind!=.reference and actual.kind!=.value))return false;
        }
        return true;
    }
    fn currentStore(self: *Engine, receiver: facts.Value, slot: relation.Slot, incoming: facts.Value, state: *State, transport: bool) Error!void {
        var d=self.domain(); try d.store(try facts.relation(self.c,receiver),slot,try facts.relation(self.c,incoming),&state.relations,!transport);
        // Aged aliases carry no selected roots, but can still revoke the birth
        // family. They never recover those roots or make a weak ID strong.
        const selected=try facts.relation(self.c,receiver);
        if(!transport and (selected.unresolved or selected.empty or selected.roots.len==0))try self.hardEscape(incoming,state.heap.view());
    }
    fn currentOwners(self: *Engine, receiver: facts.Value, state: *const State) Error!region_data.OwnedValue {
        const selected=try facts.relation(self.c,receiver);
        var out=region_data.OwnedValue{.known=true,.unresolved=selected.unresolved or selected.empty,.empty=selected.empty}; errdefer out.deinit(self.c.allocator);
        for(selected.roots) |root| { try self.c.step(); const node=self.result.region_nodes.items[@intFromEnum(root)]; const object_info=self.result.objects.items[@intFromEnum(node.reference)];
            if(object_info.kind==.array) { const one=[_]relation.Root{root}; _=try out.join(self.c,.{.known=true,.roots=&one}); }
            else if(object_info.kind==.read_span) {
                if(state.relations.get(root,.span_owner)) |owner|_=try out.join(self.c,owner) else out.unresolved=true;
            } else out.unresolved=true;
        }
        if(selected.roots.len==0)out.unresolved=true; return out;
    }
    fn copyRegion(self: *Engine, at: facts.Site, original: region_data.Value, copies: []const CopyPair, parent: ?usize, field: ?t.FieldRef, state: *State, depth: usize) Error!region_data.OwnedValue {
        try self.c.require(depth<=32); try self.c.step();
        var out=region_data.OwnedValue{.known=original.known,.unresolved=original.unresolved,.empty=original.empty,.number=original.number}; errdefer out.deinit(self.c.allocator);
        for(original.roots) |old_root| {
            try self.c.step(); const node=self.result.region_nodes.items[@intFromEnum(old_root)];
            if(self.result.objects.items[@intFromEnum(node.reference)].kind!=.value) { const one=[_]relation.Root{old_root}; _=try out.join(self.c,.{.known=true,.roots=&one}); continue; }
            var selected: ?usize=null;
            for(copies,0..) |pair,i| { try self.c.step(); if(pair.original==node.reference and pair.parent==parent and pair.field==field) { selected=i; break; } }
            if(selected==null) { out.unresolved=true; continue; }
            var fresh=try self.birth(at,copies[selected.?].copied,&state.relations,old_root,node.scope); defer fresh.deinit(self.c.allocator);
            _=try out.join(self.c,fresh.view()); if(fresh.roots.items.len==0)continue;
            const slots=state.relations.nodes.getPtr(old_root) orelse { out.unresolved=true; continue; };
            // Copy before inserting: another root can grow the outer map.
            var captured: relation.Heap=.{}; defer captured.deinit(self.c.allocator); try captured.reset(self.c,old_root);
            var iterator=slots.iterator(); while(iterator.next()) |entry| {
                try self.c.step(); var child=try region_data.OwnedValue.clone(self.c,entry.value_ptr.view()); errdefer child.deinit(self.c.allocator);
                try captured.nodes.getPtr(old_root).?.put(self.c.allocator,entry.key_ptr.*,child);
            }
            var source=captured.nodes.getPtr(old_root).?.iterator(); while(source.next()) |entry| {
                try self.c.step(); var child=if(entry.key_ptr.*==.field)
                    try self.copyRegion(at,entry.value_ptr.view(),copies,selected,entry.key_ptr.field,state,depth+1)
                    else try region_data.OwnedValue.clone(self.c,entry.value_ptr.view());
                errdefer child.deinit(self.c.allocator);
                if(entry.key_ptr.*==.field) {
                    if(state.heap.entries.getPtr(.{.field=.{.object=copies[selected.?].copied,.field=entry.key_ptr.field}})) |raw|try self.setRegion(raw,child.view());
                }
                try state.relations.nodes.getPtr(fresh.roots.items[0]).?.put(self.c.allocator,entry.key_ptr.*,child);
            }
        }
        return out;
    }
    fn constructorFrame(self: *Engine, at: facts.Site, construction: t.ConstructionIndex, new_target: t.TypeRef, parent: ?facts.FrameId, weak: bool) Error!facts.FrameId {
        const key=FrameKey{.activation=self.info(at.context).activation,.location=at.location,.construction=construction,.new_target=new_target,.parent=parent};
        return self.internFrame(key,at,weak);
    }
    fn internFrame(self: *Engine, key: FrameKey, at: facts.Site, weak: bool) Error!facts.FrameId {
        for(self.frame_keys.items,0..) |old,i| {
            try self.c.charge(2); if(!std.meta.eql(old,key))continue;
            if(weak and !self.result.frames.items[i].weak) { try self.c.require(!self.replay); self.result.frames.items[i].weak=true; self.changed=true; }
            return @enumFromInt(i);
        }
        try self.c.require(!self.replay and self.frame_keys.items.len<4096);
        try self.c.charge(self.frame_keys.items.len+self.result.frames.items.len+2); try self.frame_keys.ensureUnusedCapacity(self.c.allocator,1); try self.result.frames.ensureUnusedCapacity(self.c.allocator,1);
        const id: facts.FrameId=@enumFromInt(self.frame_keys.items.len); self.frame_keys.appendAssumeCapacity(key);
        self.result.frames.appendAssumeCapacity(.{.site=at,.construction=key.construction,.new_target=key.new_target,.parent=key.parent,.weak=weak}); self.changed=true; return id;
    }
    fn selectedReceiverOrigin(self: *Engine, at: facts.Site, frame: t.RegisterRef, value: *V) Error!void {
        const f=self.c.program.functions[@intFromEnum(at.location.function)]; const abi_row=self.c.program.tables.mode.common.abis[@intFromEnum(f.abi)];
        if(abi_row.receiver_frame) |ordinal|if(f.blocks[0].parameters[ordinal]==frame) {
            // An ownership token for the selected payload, never a frame's
            // actual tag/object or an entry allocation fact.
            try self.origin(value,at.context,.{.parameter=frame});
        };
    }
    fn receiverFailure(self: *Engine, graph: *Graph, at: facts.Site, language: t.BlockRef, state: *const State) Error!void {
        var after=try State.clone(self.c,state); defer after.deinit(self.c);
        try receiver_actual.abortInitializers(self.c,&after.frames);
        const payload=V{.unknown=true}; try self.edge(graph,at,language,&after,&.{payload});
    }
    fn receiverOperation(self: *Engine, graph: *Graph, at: facts.Site, state: *State, op: ins.Instruction, arguments: []const V, weak: bool, value: *V, continues: *bool) Error!void {
        const common=self.c.program.tables.mode.common;
        switch(op.data) {
            .receiver_create => |v| {
                const frame=try self.constructorFrame(at,v.construction,v.new_target,null,weak);
                try receiver_actual.birth(self.c,&state.frames,frame,self.result.frames.items[@intFromEnum(frame)].weak); _=try value.frame(self.c,frame);
            },
            .receiver_child => |v| {
                for(arguments[0].frames.items) |parent| {
                    try self.c.step(); const parent_frame=self.result.frames.items[@intFromEnum(parent)];
                    const frame=try self.constructorFrame(at,v.construction,parent_frame.new_target,parent,weak or parent_frame.weak or arguments[0].frames.items.len!=1);
                    try receiver_actual.birth(self.c,&state.frames,frame,self.result.frames.items[@intFromEnum(frame)].weak); _=try value.frame(self.c,frame);
                }
                if(arguments[0].unknown or arguments[0].frames.items.len==0) { value.unknown=true; _=self.unknown(at.context); }
            },
            .receiver_allocate => {
                for(arguments[0].frames.items) |frame| {
                    try self.c.step(); const allocation_frame=self.result.frames.items[@intFromEnum(frame)];
                    const kind=common.types[@intFromEnum(allocation_frame.new_target)].kind;
                    try self.c.require(kind==.reference or kind==.value);
                    var selected=try self.makeObject(at,if(kind==.value).value else .reference,allocation_frame.new_target,weak or allocation_frame.weak or arguments[0].frames.items.len!=1); defer selected.deinit(self.c.allocator);
                    // Raw IDs can summarize repeated allocation families.
                    // A new instance never inherits an old initialized field
                    // merely because the analysis reuses that family ID.
                    var old=state.heap.entries.iterator(); while(old.next()) |entry| {
                        try self.c.step(); if(entry.key_ptr.*!=.field or entry.key_ptr.field.object!=selected.objects.items[0])continue;
                        entry.value_ptr.deinit(self.c.allocator); entry.value_ptr.*=.{.unknown=true,.callable_unknown=true};
                    }
                    var current=try self.birth(at,selected.objects.items[0],&state.relations,null,null); defer current.deinit(self.c.allocator); try self.setRegion(&selected,current.view());
                    _=try value.join(self.c,selected.view());
                }
                if(arguments[0].unknown or arguments[0].frames.items.len==0)_=try value.join(self.c,self.unknown(at.context));
            },
            inline .receiver_bind,.receiver_get,.receiver_result => |v| {
                continues.*=false;
                for(arguments[0].frames.items) |frame| {
                    try self.c.step(); const selected_frame=self.result.frames.items[@intFromEnum(frame)];
                    const saved=state.frames.entries.getPtr(frame) orelse { _=self.unknown(at.context); continue; };
                    var selected: V=.{}; defer selected.deinit(self.c.allocator);
                    var normal=false; var language=false; const binding=op.data!=.receiver_result;
                    if(op.data==.receiver_bind) {
                        normal=saved.unbound or saved.unresolved; language=!saved.bound.view().bottom() or saved.unresolved;
                        if(normal)selected=try V.clone(self.c,arguments[1].view());
                    } else if(op.data==.receiver_get) {
                        normal=!saved.bound.view().bottom() or saved.unresolved; language=saved.unbound or saved.unresolved;
                        if(normal)selected=try V.clone(self.c,saved.bound.view());
                    } else {
                        const owner=common.members.constructions[@intFromEnum(selected_frame.construction)].owner;
                        const base_constructor=common.types[@intFromEnum(owner)].base==null;
                        var fallback=arguments.len==1; var invalid=false;
                        if(arguments.len==2) {
                            const explicit=arguments[1].view(); selected=try receiver_actual.objectsOnly(self.c,self.result.view(),explicit);
                            normal=!selected.view().bottom();
                            for(explicit.tags) |tag| {
                                const category=try receiver_actual.objectKind(self.c,tag);
                                if(category==.object)continue;
                                if(category==.pending) { _=self.unknown(at.context); normal=true; selected.unknown=true; }
                                const is_undefined=common.types[@intFromEnum(tag)].kind==.@"undefined";
                                fallback=fallback or base_constructor or is_undefined; invalid=invalid or (!base_constructor and !is_undefined);
                            }
                            // Unknown callable code does not turn a known
                            // function-object tag into a possible primitive.
                            if(explicit.unknown) { _=self.unknown(at.context); selected.unknown=true; normal=true; fallback=true; invalid=!base_constructor; }
                        }
                        if(fallback) {
                            if(!saved.bound.view().bottom() or saved.unresolved) { _=try selected.join(self.c,saved.bound.view()); normal=true; }
                            language=saved.unbound or saved.unresolved;
                        }
                        language=language or invalid;
                    }
                    if(saved.unresolved and normal) { selected.unknown=true; _=self.unknown(at.context); }
                    if(normal) {
                        if(op.data==.receiver_bind) {
                            var after=try State.clone(self.c,state); defer after.deinit(self.c);
                            try receiver_actual.bind(self.c,&after.frames,frame,selected.view());
                            try self.selectedReceiverOrigin(at,op.operands[0],&selected);
                            try self.edge(graph,at,v.normal,&after,&.{selected});
                        } else {
                            // Only bind changes fork-local frames; edge owns its copy.
                            if(binding)try self.selectedReceiverOrigin(at,op.operands[0],&selected);
                            try self.edge(graph,at,v.normal,state,&.{selected});
                        }
                    }
                    if(language)try self.receiverFailure(graph,at,v.language,state);
                }
                if(arguments[0].unknown or arguments[0].frames.items.len==0) {
                    var unknown_receiver=try V.clone(self.c,self.unknown(at.context)); defer unknown_receiver.deinit(self.c.allocator);
                    try self.edge(graph,at,v.normal,state,&.{unknown_receiver}); try self.receiverFailure(graph,at,v.language,state);
                }
            },
            .initialize_begin => {
                for(arguments[0].frames.items) |frame| {
                    try self.c.step(); const token=facts.Cursor{.frame=frame,.position=0};
                    try receiver_actual.advance(self.c,&state.frames,token,false); _=try value.cursor(self.c,token);
                }
                if(arguments[0].unknown or arguments[0].frames.items.len==0) { value.unknown=true; _=self.unknown(at.context); }
            },
            .initialize_field => |v| {
                // Raw heap fields use semantic FieldRef keys, never guessed
                // offsets. A replacement U needs the missing verified M12 route.
                var logical_field_route=!arguments[1].unknown and arguments[1].objects.items.len!=0;
                for(arguments[1].objects.items) |object_id| {
                    try self.c.step(); const actual=self.result.objects.items[@intFromEnum(object_id)].@"type" orelse { logical_field_route=false; continue; };
                    logical_field_route=logical_field_route and try self.extends(actual,common.members.fields[@intFromEnum(v.field)].owner);
                }
                // Fixed publication.storage.fields has not been admitted by
                // Runtime. Body actual tags cannot stand in for its upper.
                _=self.unknown(at.context);
                if(logical_field_route) {
                    try self.writeField(state,arguments[1].view(),v.field,arguments[2].view());
                    for(arguments[1].objects.items) |object_id| {
                        try self.c.step(); const member=try self.fieldFor(self.result.objects.items[@intFromEnum(object_id)].@"type".?,v.field);
                        var selected: V=.{}; defer selected.deinit(self.c.allocator); _=try selected.object(self.c,object_id); try self.projectRegion(&selected,arguments[1].view());
                        try self.currentStore(selected.view(),.{.field=member},arguments[2].view(),state,false);
                    }
                }
                for(arguments[0].cursors.items) |token| {
                    try self.c.step(); const next=facts.Cursor{.frame=token.frame,.position=token.position+1};
                    try receiver_actual.advance(self.c,&state.frames,next,false); _=try value.cursor(self.c,next);
                }
                if(arguments[0].unknown or arguments[0].cursors.items.len==0) { value.unknown=true; _=self.unknown(at.context); }
            },
            .initialize_end => for(arguments[0].cursors.items) |token|try receiver_actual.advance(self.c,&state.frames,token,true),
            else => return error.InvalidShape,
        }
    }
    fn operationRegion(self: *Engine, at: facts.Site, state: *State, op: ins.Instruction, arguments: []const V, value: *V) Error!void {
        if(self.c.program.tables.mode!=.common)return;
        switch(op.data) {
            .environment_alloc,.eh_construct,.common_typed_array_create,.domain_read_span => {
                if(value.objects.items.len!=1)return error.InvalidShape;
                var current=try self.birth(at,value.objects.items[0],&state.relations,null,null); defer current.deinit(self.c.allocator);
                try self.setRegion(value,current.view());
                switch(op.data) {
                    .environment_alloc => { if(arguments.len!=0)try self.currentStore(value.view(),.parent,arguments[0].view(),state,false); },
                    .common_typed_array_create => {
                        for(arguments,0..) |argument,index| { try self.c.step(); const transport=try self.transportReceiver(value.view(),true,state) and try self.wholeCallable(argument.view(),state); try self.currentStore(value.view(),.{.element=@intCast(index)},argument.view(),state,transport); }
                        const length=facts.Value{.number=@intCast(arguments.len),.region=.{.known=true,.empty=true,.number=@intCast(arguments.len)}};
                        try self.currentStore(value.view(),.length,length,state,false);
                    },
                    .domain_read_span => {
                        try self.currentStore(value.view(),.span_owner,arguments[0].view(),state,false);
                        try self.currentStore(value.view(),.span_start,arguments[1].view(),state,false);
                        try self.currentStore(value.view(),.span_length,arguments[2].view(),state,false);
                    },
                    else => {},
                }
            },
            .environment_parent => { var loaded=try self.currentLoad(arguments[0].view(),.parent,state); defer loaded.deinit(self.c.allocator); try self.setRegion(value,loaded.view()); },
            .environment_load => |slot| { var loaded=try self.currentLoad(arguments[0].view(),.{.environment_slot=slot.slot},state); defer loaded.deinit(self.c.allocator); try self.setRegion(value,loaded.view()); },
            inline .environment_init,.environment_store => |slot|try self.currentStore(arguments[0].view(),.{.environment_slot=slot.slot},arguments[1].view(),state,false),
            .function_make => { try self.setRegion(value,if(arguments.len==0).{.known=true,.empty=true} else try facts.relation(self.c,arguments[0].view())); },
            .global_store => try self.escape(arguments[0].view(),state,true),
            .domain_field_read => |read| {
                var selected=region_data.OwnedValue{.known=true,.unresolved=arguments[0].unknown}; defer selected.deinit(self.c.allocator);
                for(arguments[0].objects.items) |object_id| {
                    try self.c.step(); const member=try self.fieldFor(self.result.objects.items[@intFromEnum(object_id)].@"type".?,read.member);
                    var receiver: V=.{}; defer receiver.deinit(self.c.allocator); _=try receiver.object(self.c,object_id); try self.projectRegion(&receiver,arguments[0].view());
                    var loaded=try self.currentLoad(receiver.view(),.{.field=member},state); defer loaded.deinit(self.c.allocator); _=try selected.join(self.c,loaded.view());
                }
                if(arguments[0].objects.items.len==0)selected.unresolved=true; try self.setRegion(value,selected.view());
            },
            .domain_field_store => |write| {
                const transport=try self.transportReceiver(arguments[0].view(),false,state) and try self.wholeCallable(arguments[1].view(),state);
                for(arguments[0].objects.items) |object_id| { try self.c.step(); const member=try self.fieldFor(self.result.objects.items[@intFromEnum(object_id)].@"type".?,write.member); try self.currentStore(arguments[0].view(),.{.field=member},arguments[1].view(),state,transport); }
            },
            .eh_field_initialize => |write|try self.currentStore(arguments[0].view(),.{.field=write.field},arguments[1].view(),state,try self.transportReceiver(arguments[0].view(),false,state) and try self.wholeCallable(arguments[1].view(),state)),
            .domain_array_read,.domain_array_store,.domain_array_resize => {
                var owners_current=try self.currentOwners(arguments[0].view(),state); defer owners_current.deinit(self.c.allocator);
                var receiver: V=.{}; defer receiver.deinit(self.c.allocator); try self.setRegion(&receiver,owners_current.view());
                if(op.data==.domain_array_store)try self.currentStore(receiver.view(),.{.element=arguments[1].number},arguments[2].view(),state,try self.transportReceiver(arguments[0].view(),true,state) and try self.wholeCallable(arguments[2].view(),state))
                else if(op.data==.domain_array_resize)try self.currentStore(receiver.view(),.length,arguments[1].view(),state,false)
                else {
                    var index=arguments[1].number;
                    const source=try facts.relation(self.c,arguments[0].view());
                    for(source.roots) |root| { try self.c.step(); if(self.result.objects.items[@intFromEnum(self.result.region_nodes.items[@intFromEnum(root)].reference)].kind==.read_span)index=null; }
                    var d=self.domain(); var loaded=try d.load(owners_current.view(),.{.element=index},&state.relations); defer loaded.deinit(self.c.allocator);
                    loaded.empty=true;
                    if(index==null)loaded.unresolved=true;
                    for(owners_current.roots.items) |root| { try self.c.step(); if(state.relations.get(root,.{.element=null})) |wildcard| { _=try loaded.join(self.c,wildcard); loaded.unresolved=true; } }
                    try self.setRegion(value,loaded.view());
                }
            },
            else => {},
        }
        if(!value.view().bottom() and !value.region.known)try self.setRegion(value,try facts.relation(self.c,value.view()));
    }
    fn operate(self: *Engine, graph: *Graph, at: facts.Site, state: *State) Error!bool {
        const function=self.c.program.functions[@intFromEnum(at.location.function)];
        const op=function.blocks[@intFromEnum(at.location.block)].instructions[at.location.instruction];
        try self.c.charge(op.operands.len+1); try self.callback(true,at,state);
        // Snapshots own values across parallel edge assignments, heap writes
        // and nested context insertion; observers never retain these pointers.
        const arguments=try self.c.allocator.alloc(V,op.operands.len); @memset(arguments,.{});
        defer { for(arguments) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(arguments); }
        for(op.operands,arguments) |reg,*argument|argument.*=try V.clone(self.c,state.read(reg));
        var value: V=.{}; defer value.deinit(self.c.allocator); var continues=true;
        const weak=self.info(at.context).repeated or graph.loop[@intFromEnum(at.location.block)] or self.closureLegacy();
        const code=std.meta.activeTag(op.data);
        switch(op.data) {
            .@"const_bool" => |boolean| { value=try self.literal(try self.primitive("bool")); value.truth=if(boolean)2 else 1; },
            .@"const_i32",.@"const_integer",.@"const_float" => |bits| {
                const id=if(code==.@"const_i32")try self.primitive("i32") else try self.resultType(at.location.function,op.result.?);
                try self.c.require(try self.is(id,"scalar")); value=try self.literal(id);
                if(code!=.@"const_float") { if(code==.@"const_i32")value.number=@as(i32,@bitCast(@as(u32,@truncate(bits)))) else if(bits<=std.math.maxInt(i64))value.number=@intCast(bits); }
            },
            .domain_literal => |data| {
                if(try self.is(data.actual_type,"unknown"))value=try V.clone(self.c,self.unknown(at.context)) else value=try self.literal(data.actual_type);
                if(try self.is(data.actual_type,"function") or try self.is(data.actual_type,"callable"))value.callable_unknown=true;
            },
            .domain_view,.domain_refine,.eh_pack,.eh_presence_widen,.eh_carrier,.eh_assertion => value=try V.clone(self.c,arguments[0].view()),
            .domain_copy => value=try self.copyValue(at,arguments[0].view(),state,weak),
            .@"string_constant" => value=try self.literal(try self.primitive("string")),
            .@"string_concat",.@"string_slice" => value=try self.literal(try self.primitive("string")),
            .@"string_length",.@"string_codeunit",.@"string_compare",.@"convert_checked",.@"convert_wrap",.@"reinterpret" => {
                value=try self.literal(try self.resultType(at.location.function,op.result.?));
                for(arguments) |argument|if(argument.unknown) { value.unknown=true; self.result.unresolved=true; };
            },
            .@"add",.@"sub",.@"mul",.@"div",.@"rem",.@"shl",.@"shr",.@"ushr",.@"and",.@"or",.@"xor",.@"neg",.@"not",.@"pos",.@"bool_not",.@"lt",.@"le",.@"gt",.@"ge" => {
                const actual_type=self.logical(at.location.function,op.result.?) orelse try self.resultType(at.location.function,op.result.?);
                value=try self.literal(actual_type);
                if(self.primitives.get("bool")) |boolean| { if(actual_type==boolean)value.truth=3; }
                for(arguments,op.operands) |argument,reg| {
                    if(argument.unknown or argument.callable_unknown) { value.unknown=true; _=self.unknown(at.context); continue; }
                    const expected=self.logical(at.location.function,reg) orelse try self.resultType(at.location.function,reg);
                    for(argument.tags.items) |tag| { try self.c.step(); try self.c.require(tag==expected); }
                }
                // No integer/FP evaluation is performed by this may solver.
            },
            .@"eq",.@"ne",.domain_presence_equal,.domain_identity_equal,.eh_equal => {
                value=try self.literal(try self.primitive("bool")); value.truth=3;
                const a=arguments[0].view(); const b=arguments[1].view();
                const unequal=code==.@"ne" or (code==.domain_presence_equal and op.data.domain_presence_equal.operator==.not_equal) or (code==.domain_identity_equal and op.data.domain_identity_equal.operator==.not_equal) or (code==.eh_equal and op.data.eh_equal.operator==.not_equal);
                if(!a.unknown and !b.unknown and a.tags.len!=0 and b.tags.len!=0) {
                    var intersects=false; for(a.tags) |left|for(b.tags) |right| { try self.c.step(); intersects=intersects or left==right; };
                    var same=false;
                    if(a.tags.len==1 and b.tags.len==1 and a.tags[0]==b.tags[0]) {
                        same=try self.is(a.tags[0],"undefined") or try self.is(a.tags[0],"null");
                        if(a.tags[0]==try self.primitive("bool") and (a.truth==1 or a.truth==2) and (b.truth==1 or b.truth==2)) {
                            value.truth=if((a.truth==b.truth)!=unequal)2 else 1;
                        }
                    }
                    if(!intersects or same)value.truth=if(same!=unequal)2 else 1;
                }
            },
            .eh_type_test => |data| {
                value=try self.literal(try self.primitive("bool")); const input=arguments[0].view(); var boolean=false; var other=input.unknown;
                for(input.tags) |id| { try self.c.step(); if(id==try self.primitive("bool"))boolean=true else other=true; }
                value.truth=(if(boolean)@as(u2,if(data.operator==.equal)2 else 1) else 0)|(if(other)@as(u2,if(data.operator==.equal)1 else 2) else 0);
            },
            .eh_cell => |data| {
                const id=try self.cell(at,data.binding,weak); _=try value.cell(self.c,id); _=try state.heap.put(self.c,.{.cell=id},.{},!self.result.cells.items[@intFromEnum(id)].weak);
            },
            .eh_store => { for(arguments[0].cells.items) |id| { try self.c.step(); _=try state.heap.put(self.c,.{.cell=id},arguments[1].view(),arguments[0].cells.items.len==1 and !self.result.cells.items[@intFromEnum(id)].weak); } },
            .eh_load => {
                for(arguments[0].cells.items) |id| { try self.c.step(); if(state.heap.view().get(.{.cell=id})) |stored|_=try value.join(self.c,stored); }
                if(arguments[0].unknown)_=try value.join(self.c,self.unknown(at.context));
            },
            .eh_project => |data| {
                value=try V.clone(self.c,arguments[0].view()); value.tags.clearRetainingCapacity();
                var selected=value.unknown; for(arguments[0].tags.items) |tag| { try self.c.step(); selected=selected or tag==data.target_type; }
                value.unknown=false; if(selected)_=try value.tag(self.c,data.target_type); value.truth=if(selected)if(value.truth==0)3 else value.truth else 0;
            },
            .global_load => |data| {
                if(state.heap.view().get(.{.global=data.global})) |stored|value=try V.clone(self.c,stored) else value=try V.clone(self.c,self.unknown(at.context));
                try self.origin(&value,at.context,.{.global=data.global});
            },
            .global_store => |data| { _=try state.heap.put(self.c,.{.global=data.global},arguments[0].view(),true); },
            .authorized_host => |data| {
                // The public boundary already checked the complete material
                // against this Runtime's compiled anchor. Do not infer a
                // Counter instance/storage value, or retag an unknown input.
                _=data; var scalar_input=false;
                if(self.host_material) |material| {
                    try self.c.step();
                    if(arguments.len==1) {
                        const input=arguments[0].view();
                        scalar_input=!input.unknown and !input.callable_unknown and input.objects.len==0 and
                            input.cells.len==0 and input.callables.len==0 and input.tags.len==1 and
                            input.tags[0]==try self.primitive(material.contract.abi.guest.parameters[0]);
                    }
                }
                if(scalar_input) {
                    // Fixed scalar-only, no callback/retain/borrow semantics
                    // touch only the two Host resources, not the caller heap.
                    // The post-write storage bits are arbitrary i32 here.
                    value=try self.literal(try self.primitive(self.host_material.?.contract.abi.guest.returns));
                } else {
                    for(arguments) |argument| { try self.c.step(); try self.escape(argument.view(),state,true); }
                    value=try V.clone(self.c,self.unknown(at.context)); try self.origin(&value,at.context,.unknown); try self.havoc(at.context,state);
                }
            },
            .environment_alloc => |data| {
                const id=try self.object(at,.environment,null,data.environment,weak); _=try value.object(self.c,id);
                if(arguments.len!=0)_=try state.heap.put(self.c,.{.parent=id},arguments[0].view(),!self.result.objects.items[@intFromEnum(id)].weak);
            },
            .environment_parent => {
                for(arguments[0].objects.items) |id| { try self.c.step(); try self.c.require(self.result.objects.items[@intFromEnum(id)].kind==.environment);
                    if(state.heap.view().get(.{.parent=id})) |stored|_=try value.join(self.c,stored) else _=try value.join(self.c,self.unknown(at.context));
                }
                if(arguments[0].unknown)_=try value.join(self.c,self.unknown(at.context));
            },
            inline .environment_init,.environment_store,.environment_load => |data| {
                const env=function.registers[@intFromEnum(op.operands[0])].carrier.environment;
                for(arguments[0].objects.items) |id| { try self.c.step(); const actual=self.result.objects.items[@intFromEnum(id)]; try self.c.require(actual.kind==.environment and actual.environment==env); }
                if(code==.environment_load) {
                    if(self.closureLegacy()) { if(self.captured.get(.{.environment=env,.slot=data.slot})) |stored|_=try value.join(self.c,stored.view()); }
                    else for(arguments[0].objects.items) |id| { try self.c.step(); if(state.heap.view().get(.{.environment_slot=.{.object=id,.slot=data.slot}})) |stored|_=try value.join(self.c,stored) else _=try value.join(self.c,self.unknown(at.context)); }
                    if(arguments[0].unknown)_=try value.join(self.c,self.unknown(at.context));
                    if(self.c.program.tables.mode==.common and self.c.program.tables.mode.common.closures.environments[@intFromEnum(env)].owner!=at.location.function)try self.origin(&value,at.context,.{.capture=.{.environment=env,.slot=data.slot}});
                } else {
                    for(arguments[0].objects.items) |id| { try self.c.step(); _=try state.heap.put(self.c,.{.environment_slot=.{.object=id,.slot=data.slot}},arguments[1].view(),arguments[0].objects.items.len==1 and !self.result.objects.items[@intFromEnum(id)].weak); }
                    if(self.closureLegacy() and !self.replay) { const found=try self.captured.getOrPut(self.c.allocator,.{.environment=env,.slot=data.slot}); if(!found.found_existing)found.value_ptr.*=.{}; if(try found.value_ptr.join(self.c,arguments[1].view()))self.changed=true; }
                }
            },
            .function_make => |data| {
                value=try self.literal(try self.codeType(data.function));
                if(arguments.len==0)_=try value.callable(self.c,.{.code=data.function,.environment=null}) else {
                    for(arguments[0].objects.items) |id| { try self.c.step(); _=try value.callable(self.c,.{.code=data.function,.environment=id}); }
                    if(arguments[0].unknown or arguments[0].objects.items.len==0) { value.callable_unknown=true; self.result.unresolved=true; }
                }
            },
            .eh_function => |data| {
                const v=self.c.program.tables.mode.exception; value=try self.literal(v.exceptions.functions[@intFromEnum(data.function)].@"type".?);
                const id=try self.object(at,.environment,null,null,weak);
                for(v.exceptions.functions[@intFromEnum(data.function)].captures,arguments) |binding,argument|_=try state.heap.put(self.c,.{.capture=.{.object=id,.binding=binding}},argument.view(),!self.result.objects.items[@intFromEnum(id)].weak);
                _=try value.callable(self.c,.{.code=data.function,.environment=id});
            },
            inline .common_typed_array_create,.domain_array_create => |data| {
                value=try self.makeObject(at,.array,data.actual_array_type,weak); const id=value.objects.items[0];
                for(arguments,0..) |argument,index|_=try state.heap.put(self.c,.{.element=.{.object=id,.index=@intCast(index)}},argument.view(),!self.result.objects.items[@intFromEnum(id)].weak);
                var length=try self.literal(try self.primitive("u32")); defer length.deinit(self.c.allocator); length.number=@intCast(arguments.len); _=try state.heap.put(self.c,.{.length=id},length.view(),!self.result.objects.items[@intFromEnum(id)].weak);
            },
            .domain_read_span => |data| {
                value=try self.makeObject(at,.read_span,data.static_view,weak); const id=value.objects.items[0];
                _=try state.heap.put(self.c,.{.span_owner=id},arguments[0].view(),!self.result.objects.items[@intFromEnum(id)].weak);
                _=try state.heap.put(self.c,.{.span_start=id},arguments[1].view(),!self.result.objects.items[@intFromEnum(id)].weak);
                _=try state.heap.put(self.c,.{.span_length=id},arguments[2].view(),!self.result.objects.items[@intFromEnum(id)].weak);
                try self.origins(&value,arguments[0].effect_origins.items);
            },
            .domain_array_length => {
                value=try self.literal(try self.primitive("u32"));
                if(arguments[0].unknown)value.unknown=true;
                try self.origins(&value,arguments[0].effect_origins.items);
            },
            .domain_array_read,.domain_array_store,.domain_array_resize => {
                var backing=try self.owners(state.heap.view(),arguments[0].view()); defer backing.deinit(self.c.allocator);
                var index=arguments[1].number;
                // A span index is relative to its stored start. Without an
                // exact address computation keep all backing elements and
                // absence, rather than selecting the wrong Array index.
                if(code==.domain_array_read)for(arguments[0].objects.items) |id| { try self.c.step(); if(self.result.objects.items[@intFromEnum(id)].kind==.read_span)index=null; };
                if(code==.domain_array_read) {
                    var definitely_initialized=backing.objects.items.len!=0 and !backing.unknown and index!=null and index.? >= 0;
                    for(backing.objects.items) |id| { try self.c.step(); const object_info=self.result.objects.items[@intFromEnum(id)];
                        const length=state.heap.view().get(.{.length=id});
                        var initialized=!object_info.weak and index!=null and length!=null and length.?.number!=null and index.? >= 0 and index.? < length.?.number.?;
                        var found=false; var iterator=state.heap.view().iterator();
                        while(iterator.next()) |entry| { try self.c.step(); if(entry.slot!=.element or entry.slot.element.object!=id)continue;
                            if(index==null or entry.slot.element.index==null or entry.slot.element.index==index) { _=try value.join(self.c,entry.value); found=true; }
                            if(entry.slot.element.index==null)initialized=false;
                        }
                        definitely_initialized=definitely_initialized and initialized and found;
                    }
                    if(!definitely_initialized)_=try value.tag(self.c,try self.primitive("undefined"));
                    if(backing.unknown)_=try value.join(self.c,self.unknown(at.context));
                    try self.origins(&value,arguments[0].effect_origins.items);
                } else for(backing.objects.items) |id| { try self.c.step(); const strong=backing.objects.items.len==1 and !backing.unknown and !self.result.objects.items[@intFromEnum(id)].weak;
                    if(code==.domain_array_store)_=try state.heap.put(self.c,.{.element=.{.object=id,.index=index}},arguments[2].view(),strong and index!=null)
                    else {
                        _=try state.heap.put(self.c,.{.length=id},arguments[1].view(),strong);
                        if(strong and index!=null) { var iterator=state.heap.entries.iterator(); while(iterator.next()) |entry| {
                            try self.c.step(); if(entry.key_ptr.*!=.element or entry.key_ptr.element.object!=id)continue;
                            if(entry.key_ptr.element.index) |element_index|if(element_index>=index.?) { entry.value_ptr.deinit(self.c.allocator); entry.value_ptr.*=try self.literal(try self.primitive("undefined")); };
                        } }
                    }
                }
            },
            .domain_field_read => |data| value=try self.readField(at.context,state.heap.view(),arguments[0].view(),data.member),
            .domain_field_store => |data| try self.writeField(state,arguments[0].view(),data.member,arguments[1].view()),
            .eh_construct => |data| {
                const kind=if(self.c.program.tables.mode==.exception) (if(self.c.program.tables.mode.exception.types[@intFromEnum(data.owner)].category==.value) facts.ObjectKind.value else facts.ObjectKind.reference)
                    else if(try self.is(data.owner,"value"))facts.ObjectKind.value else facts.ObjectKind.reference;
                value=try self.makeObject(at,kind,data.owner,weak);
            },
            .eh_field_initialize => |data| try self.writeField(state,arguments[0].view(),data.field,arguments[1].view()),
            .eh_field_read => |path| {
                // EH's admitted actual domain deliberately uses the declared
                // final field value, not a newly invented heap-callable model.
                const v=self.c.program.tables.mode.exception; const field=v.members.fields[@intFromEnum(path[path.len-1])];
                value=try self.declared(field.@"type"); try self.origins(&value,arguments[0].effect_origins.items);
            },
            .domain_member_present => { value=try self.literal(try self.primitive("bool")); value.truth=3; },
            .domain_numeric_use => |data| {
                const input=arguments[0].view(); const integer_type=try self.primitive("i32"); var normal=input.unknown; var trap=input.unknown;
                for(input.tags) |tag| { try self.c.step(); if(tag==integer_type)normal=true else { try self.c.require(try self.is(tag,"undefined")); trap=true; } }
                if(input.unknown) { self.info(at.context).actual_unresolved=true; self.info(at.context).unresolved=true; self.result.unresolved=true; }
                if(normal) { var selected=try self.literal(data.target_type); defer selected.deinit(self.c.allocator);
                    if(input.tags.len==1 and input.tags[0]==integer_type and !input.unknown)selected.number=input.number;
                    try self.edge(graph,at,data.normal_successor,state,&.{selected});
                }
                if(trap)try self.completion(at,.request_trap,.{},state); continues=false;
            },
            .@"br" => |data| { try self.edge(graph,at,data.destination,state,arguments); continues=false; },
            .@"cond_br" => |data| {
                const input=arguments[0].view(); const truth=if(self.closureLegacy() or input.unknown or input.truth==0)@as(u2,3) else input.truth;
                if(input.unknown) { self.info(at.context).actual_unresolved=true; self.info(at.context).unresolved=true; self.result.unresolved=true; }
                if(truth&2!=0)try self.edge(graph,at,data.true_destination,state,arguments[1..1+data.true_count]);
                if(truth&1!=0)try self.edge(graph,at,data.false_destination,state,arguments[1+data.true_count..]); continues=false;
            },
            .eh_route => |data| { if(data.completion==.@"throw")try receiver_actual.abortInitializers(self.c,&state.frames); try self.edge(graph,at,data.successor,state,arguments); continues=false; },
            .@"return" => { try self.completion(at,.normal,if(arguments.len==0).{} else arguments[0].view(),state); continues=false; },
            .eh_raise => { try receiver_actual.abortInitializers(self.c,&state.frames); try self.completion(at,.language,arguments[0].view(),state); continues=false; },
            .eh_unreachable => { continues=false; },
            .fuel,.eh_enter,.eh_publish => {},
            .receiver_create,.receiver_child,.receiver_allocate,.receiver_bind,.receiver_get,.receiver_result,.initialize_begin,.initialize_field,.initialize_end => try self.receiverOperation(graph,at,state,op,arguments,weak,&value,&continues),
            // Calls/constructions are handled together below so every path
            // uses the same argument marshalling and completion projection.
            .@"call",.function_call,.domain_method_call,.eh_invoke,.eh_invoke_indirect,.common_method_invoke,.domain_construct,.domain_super,.domain_initialize_fields,.domain_field_define,.domain_field_initialize => try self.calls(graph,at,state,op,arguments,weak,&value,&continues),
        }
        try self.operationRegion(at,state,op,arguments,&value);
        if(op.result) |result|try state.assign(self.c,result,value.view());
        try self.callback(false,at,state);
        if(continues)try self.notifyEdge(at,.{.function=at.location.function,.block=at.location.block,.instruction=at.location.instruction+1});
        return continues;
    }
    fn lexical(self: *Engine, target: t.FunctionRef) Error!?t.EnvironmentRef {
        switch(self.c.program.tables.mode) {
            inline .common,.legacy => |v| for(v.closures.functions) |row| { try self.c.step(); if(row.function==target)return row.lexical_environment; },
            .exception => return null,
        }
        return null;
    }
    fn codeType(self: *Engine, target: t.FunctionRef) Error!t.TypeRef {
        switch(self.c.program.tables.mode) {
            .exception => |v| return v.exceptions.functions[@intFromEnum(target)].@"type" orelse error.InvalidShape,
            .legacy => |v| { for(v.closures.functions) |row| { try self.c.step(); if(row.function==target)return row.@"type"; } },
            .common => |v| {
                const abi_row=v.abis[self.abi(target)]; try self.c.require(abi_row.receiver==null);
                const output=abi_row.result orelse try self.primitive("void");
                for(v.types,0..) |row,i| { try self.c.step(); if(row.kind!=.function or row.element!=output or row.members.len!=abi_row.parameters.len)continue;
                    var matches=true; for(row.members,abi_row.parameters) |id,binding| { try self.c.step(); matches=matches and id==v.storage.bindings[@intFromEnum(binding)].@"type"; }
                    if(matches)return @enumFromInt(i);
                }
            },
        }
        return error.InvalidShape;
    }
    fn calls(self: *Engine, graph: *Graph, at: facts.Site, state: *State, op: ins.Instruction, arguments: []const V, weak: bool, value: *V, continues: *bool) Error!void {
        const code=std.meta.activeTag(op.data);
        if(code==.@"call" or code==.eh_invoke) {
            const target=if(code==.@"call")op.data.@"call".callee else op.data.eh_invoke.callee;
            var called: V=.{}; defer called.deinit(self.c.allocator); _=try called.callable(self.c,.{.code=target,.environment=null}); try self.observe(at,called.view());
            try self.invoke(graph,at,target,arguments,state,if(code==.eh_invoke)op.data.eh_invoke.normal else null,if(code==.eh_invoke)op.data.eh_invoke.exceptional else null,weak,value,true);
            if(code==.eh_invoke)continues.*=false; return;
        }
        if(code==.function_call or code==.eh_invoke_indirect) {
            var input=arguments[0].view();
            if(input.callables.len==0)for(input.tags) |id| { try self.c.step(); if(try self.is(id,if(self.c.program.tables.mode==.exception)"callable" else "function"))input.callable_unknown=true; };
            try self.observe(at,input);
            const signature=if(code==.function_call)op.data.function_call.signature else op.data.eh_invoke_indirect.callable;
            for(input.callables) |pair| {
                try self.c.step(); try self.c.require(try self.codeType(pair.code)==signature);
                var passed: std.ArrayListUnmanaged(V)=.empty; defer { for(passed.items) |*argument|argument.deinit(self.c.allocator); passed.deinit(self.c.allocator); }
                var complete=true;
                if(self.c.program.tables.mode==.exception) {
                    const v=self.c.program.tables.mode.exception; const row=v.exceptions.functions[@intFromEnum(pair.code)];
                    try self.c.charge(arguments.len+row.captures.len);
                    try passed.ensureUnusedCapacity(self.c.allocator,arguments.len-1+row.captures.len);
                    for(arguments[1..]) |argument|passed.appendAssumeCapacity(try V.clone(self.c,argument.view()));
                    for(row.captures) |binding| { try self.c.step();
                        if(pair.environment) |env| {
                            if(state.heap.view().get(.{.capture=.{.object=env,.binding=binding}})) |stored|passed.appendAssumeCapacity(try V.clone(self.c,stored)) else complete=false;
                        } else complete=false;
                    }
                } else {
                    const environment=try self.lexical(pair.code);
                    try self.c.charge(arguments.len+@intFromBool(environment!=null));
                    try passed.ensureUnusedCapacity(self.c.allocator,arguments.len-1+@intFromBool(environment!=null));
                    if(environment) |env| {
                        if(pair.environment) |id| {
                            const object_info=self.result.objects.items[@intFromEnum(id)]; try self.c.require(object_info.kind==.environment and object_info.environment==env);
                            var actual: V=.{}; errdefer actual.deinit(self.c.allocator); _=try actual.object(self.c,id);
                            try self.projectRegion(&actual,input); passed.appendAssumeCapacity(actual);
                        } else complete=false;
                    } else try self.c.require(pair.environment==null);
                    for(arguments[1..]) |argument|passed.appendAssumeCapacity(try V.clone(self.c,argument.view()));
                }
                if(!complete) { self.info(at.context).actual_unresolved=true; self.info(at.context).unresolved=true; self.result.unresolved=true; continue; }
                try self.invoke(graph,at,pair.code,passed.items,state,if(code==.eh_invoke_indirect)op.data.eh_invoke_indirect.normal else null,if(code==.eh_invoke_indirect)op.data.eh_invoke_indirect.exceptional else null,weak,value,!input.unknown and !input.callable_unknown);
            }
            if(input.unknown or input.callable_unknown) {
                if(code==.eh_invoke_indirect)try self.unknownInvoke(graph,at,state,op.data.eh_invoke_indirect.normal,op.data.eh_invoke_indirect.exceptional)
                else { _=try value.join(self.c,self.unknown(at.context)); try self.origin(value,at.context,.unknown); try self.havoc(at.context,state); }
            }
            // Known absence/non-callable alternatives are not fictitious code
            // or a normal call. Leave this independent-consumption obligation
            // explicit; target coverage alone cannot discharge it.
            for(input.tags) |id| { try self.c.step();
                const expected=if(self.c.program.tables.mode==.exception)"callable" else "function";
                if(!try self.is(id,expected)) { self.result.unresolved=true; self.info(at.context).actual_unresolved=true; self.info(at.context).unresolved=true; try self.completion(at,.request_trap,input,state); }
            }
            if(code==.eh_invoke_indirect)continues.*=false; return;
        }
        if(code==.common_method_invoke or code==.domain_method_call) {
            const member=if(code==.common_method_invoke)op.data.common_method_invoke.member else op.data.domain_method_call.member;
            const dispatch=if(code==.common_method_invoke)op.data.common_method_invoke.dispatch else op.data.domain_method_call.dispatch;
            const input=arguments[0].view(); var called: V=.{}; defer called.deinit(self.c.allocator);
            called.unknown=input.unknown;
            for(input.tags) |tag| {
                try self.c.step(); const target=(try self.methodFor(tag,member)) orelse { called.unknown=true; self.result.unresolved=true; continue; }; const fn_row=self.c.program.functions[@intFromEnum(target)];
                const count=fn_row.blocks[0].parameters.len; try self.c.require(count>0 and count<=arguments.len);
                switch(self.c.program.tables.mode) {
                    inline .common,.legacy => |v| {
                        var matched=false; for(v.views.dispatch[@intFromEnum(dispatch)].method.arms) |arm| { try self.c.step(); if(arm.actual==tag) { try self.c.require(arm.target==target); matched=true; } }
                        try self.c.require(matched);
                    },
                    .exception => return error.WrongMode,
                }
                const passed=try self.c.allocator.alloc(V,count); @memset(passed,.{});
                defer { for(passed) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(passed); }
                for(arguments[0..count],passed) |argument,*out|out.*=try V.clone(self.c,argument.view());
                passed[0].tags.clearRetainingCapacity(); _=try passed[0].tag(self.c,tag); passed[0].objects.clearRetainingCapacity();
                for(input.objects) |id| { try self.c.step(); if(self.result.objects.items[@intFromEnum(id)].@"type"==tag)_=try passed[0].object(self.c,id); }
                try self.projectRegion(&passed[0],input);
                if(passed[0].objects.items.len==0) { called.unknown=true; self.result.unresolved=true; continue; }
                _=try called.callable(self.c,.{.code=target,.environment=null});
                try self.invoke(graph,at,target,passed,state,if(code==.common_method_invoke)op.data.common_method_invoke.normal else null,if(code==.common_method_invoke)op.data.common_method_invoke.exceptional else null,weak,value,!input.unknown);
            }
            try self.observe(at,called.view());
            if(input.unknown or (input.tags.len!=0 and called.callables.items.len==0)) {
                if(code==.common_method_invoke)try self.unknownInvoke(graph,at,state,op.data.common_method_invoke.normal,op.data.common_method_invoke.exceptional)
                else { _=try value.join(self.c,self.unknown(at.context)); try self.origin(value,at.context,.unknown); try self.havoc(at.context,state); }
            }
            if(code==.common_method_invoke)continues.*=false; return;
        }
        const legacy=self.c.program.tables.mode.legacy;
        switch(op.data) {
            .domain_construct => |data| {
                value.*=try self.makeObject(at,if(legacy.types[@intFromEnum(data.actual_type)].kind==.value).value else .reference,data.actual_type,weak);
                const passed=try self.c.allocator.alloc(V,arguments.len+1); @memset(passed,.{});
                defer { for(passed) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(passed); }
                passed[0]=try V.clone(self.c,value.view()); for(arguments,passed[1..]) |argument,*out|out.*=try V.clone(self.c,argument.view());
                var discarded: V=.{}; defer discarded.deinit(self.c.allocator);
                try self.invoke(graph,at,legacy.members.constructions[@intFromEnum(data.construction)].function,passed,state,null,null,weak,&discarded,true);
            },
            .domain_super => |data| try self.invoke(graph,at,legacy.members.constructions[@intFromEnum(data.construction)].function,arguments,state,null,null,weak,value,true),
            .domain_initialize_fields => {}, // The following define/init SSA operations carry the actual values.
            .domain_field_define => |data| {
                var absent=try self.literal(try self.primitive("undefined")); defer absent.deinit(self.c.allocator);
                try self.writeField(state,arguments[0].view(),data.field,absent.view());
            },
            .domain_field_initialize => |data| try self.writeField(state,arguments[0].view(),data.field,arguments[1].view()),
            else => return error.InvalidShape,
        }
    }
    fn successors(op: ins.Instruction) struct { blocks:[2]t.BlockRef=undefined, count:usize=0 } {
        return switch(op.data) {
            .@"br" => |v| .{.blocks=.{v.destination,v.destination},.count=1},
            .@"cond_br" => |v| .{.blocks=.{v.true_destination,v.false_destination},.count=2},
            inline .eh_invoke,.eh_invoke_indirect,.common_method_invoke => |v| .{.blocks=.{v.normal,v.exceptional},.count=2},
            inline .receiver_bind,.receiver_get,.receiver_result => |v| .{.blocks=.{v.normal,v.language},.count=2},
            .eh_route => |v| .{.blocks=.{v.successor,v.successor},.count=1},
            .domain_numeric_use => |v| .{.blocks=.{v.normal_successor,v.normal_successor},.count=1},
            else => .{},
        };
    }
    fn execute(self: *Engine, context: facts.ContextId) Error!void {
        const invocation=self.info(context); const function=self.c.program.functions[@intFromEnum(invocation.function)]; const count=function.blocks.len;
        try self.c.charge(count*3+1);
        var graph=allocate: {
            const incoming=try self.c.allocator.alloc(?State,count); errdefer self.c.allocator.free(incoming); @memset(incoming,null);
            const queued=try self.c.allocator.alloc(bool,count); errdefer self.c.allocator.free(queued); @memset(queued,false);
            const loops=try self.c.allocator.alloc(bool,count); @memset(loops,false);
            break :allocate Graph{.invocation=context,.incoming=incoming,.queued=queued,.loop=loops};
        }; defer graph.deinit(self.c);
        const incoming=graph.incoming; const queued=graph.queued; const loops=graph.loop;
        // Immutable CFG multiplicity, derived solely from actual typed edges.
        // Visits pay the common meter; no per-function or replay refill.
        const visited=try self.c.allocator.alloc(bool,count); defer self.c.allocator.free(visited);
        var pending: std.ArrayListUnmanaged(t.BlockRef)=.empty; defer pending.deinit(self.c.allocator);
        for(0..count) |start| {
            try self.c.charge(count); @memset(visited,false); pending.clearRetainingCapacity();
            const first=successors(function.blocks[start].instructions[function.blocks[start].instructions.len-1]);
            for(first.blocks[0..first.count]) |target| { try self.c.step(); try pending.append(self.c.allocator,target); }
            var cursor: usize=0;
            while(cursor<pending.items.len) : (cursor+=1) {
                try self.c.step(); const b=@intFromEnum(pending.items[cursor]); if(b==start) { loops[start]=true; break; }
                if(visited[b])continue; visited[b]=true;
                const edges=successors(function.blocks[b].instructions[function.blocks[b].instructions.len-1]);
                for(edges.blocks[0..edges.count]) |target| { try self.c.step(); if(!visited[@intFromEnum(target)])try pending.append(self.c.allocator,target); }
            }
        }
        incoming[0]=entry: {
            var state=try State.init(self.c,function.registers.len); errdefer state.deinit(self.c);
            state.heap=try Heap.clone(self.c,invocation.entry.view()); try self.c.require(invocation.arguments.len==function.blocks[0].parameters.len);
            state.relations=try relation.Heap.clone(self.c,&invocation.entry_relations);
            state.frames=try receiver_actual.clone(self.c,&invocation.entry_frames);
            for(function.blocks[0].parameters,invocation.arguments) |reg,argument| {
                try state.assign(self.c,reg,argument.view());
                if(function.registers[@intFromEnum(reg)].carrier!=.receiver and function.registers[@intFromEnum(reg)].carrier!=.initialization)try self.origin(&state.values[@intFromEnum(reg)],context,.{.parameter=reg});
            }
            break :entry state;
        };
        queued[0]=true; try graph.work.append(self.c.allocator,@enumFromInt(0)); var cursor: usize=0;
        while(cursor<graph.work.items.len) : (cursor+=1) {
            try self.c.step(); const block=graph.work.items[cursor]; const b=@intFromEnum(block); queued[b]=false;
            var state=try State.clone(self.c,&incoming[b].?); defer state.deinit(self.c);
            for(function.blocks[b].instructions,0..) |_,index| {
                const at=facts.Site{.context=context,.location=.{.function=invocation.function,.block=block,.instruction=@intCast(index)}};
                if(!try self.operate(&graph,at,&state))break;
            }
        }
        if(self.replay) {
            // Re-run each reached block once from its final incoming state.
            // Clients do not observe transient local work-list approximations.
            graph.collect=false; self.emit=true; defer self.emit=false;
            for(incoming,0..) |saved,b| { if(saved==null)continue;
                var state=try State.clone(self.c,&saved.?); defer state.deinit(self.c);
                if(b==0)try self.receiverLifetimes(.{.context=context,.location=.{.function=invocation.function,.block=@enumFromInt(b),.instruction=0}},&state,.entry);
                for(function.blocks[b].instructions,0..) |_,index| {
                    const at=facts.Site{.context=context,.location=.{.function=invocation.function,.block=@enumFromInt(b),.instruction=@intCast(index)}};
                    if(!try self.operate(&graph,at,&state))break;
                }
            }
        }
    }
    fn entryArray(self: *Engine, at: facts.Site, activation: usize, parameter: t.RegisterRef, heap: *Heap) Error!V {
        // The validated exported-input role promises an Array category, not its
        // actual storage tag, length, elements, uniqueness or a fresh birth.
        const id=try self.objectKey(at,.{.activation=activation,.location=at.location,.kind=.array,.@"type"=null,.environment=null,.entry_parameter=parameter},true);
        var result: V=.{}; errdefer result.deinit(self.c.allocator); _=try result.object(self.c,id);
        try self.setRegion(&result,try facts.relation(self.c,result.view()));
        const contents=V{.unknown=true,.callable_unknown=true,.region=.{.known=true,.unresolved=true}};
        _=try heap.put(self.c,.{.element=.{.object=id,.index=null}},contents.view(),true);
        return result;
    }
    fn seedRoot(self: *Engine, target: t.FunctionRef, new_target: ?t.TypeRef) Error!void {
        const function=self.c.program.functions[@intFromEnum(target)]; const parameters=function.blocks[0].parameters;
        try self.c.charge(parameters.len+1); const arguments=try self.c.allocator.alloc(V,parameters.len); @memset(arguments,.{});
        defer { for(arguments) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(arguments); }
        var frames: facts.FrameStore=.{}; defer receiver_actual.deinit(&frames,self.c.allocator);
        var entry_heap: ?Heap=null; defer if(entry_heap) |*heap|heap.deinit(self.c.allocator);
        var receiver: ?struct { frame: facts.FrameId, ordinal: u16 }=null;
        if(new_target) |actual| {
            const abi_row=self.c.program.tables.mode.common.abis[self.abi(target)];
            const construction: t.ConstructionIndex=@enumFromInt(@intFromEnum(abi_row.construction.?));
            const activation=try self.activationFor(target,null,actual);
            // A root owns an internal unbound control frame, not an arbitrary
            // language argument or a proved receiver allocation. Null location
            // distinguishes this entry birth from every receiver_create opcode.
            const at=facts.Site{.context=@enumFromInt(self.result.invocations.items.len),.location=.{.function=target,.block=@enumFromInt(0),.instruction=0}};
            const frame=try self.internFrame(.{.activation=activation,.location=null,.construction=construction,.new_target=actual,.parent=null},at,false);
            try receiver_actual.birth(self.c,&frames,frame,false);
            receiver=.{.frame=frame,.ordinal=abi_row.receiver_frame.?};
        }
        for(arguments,0..) |*argument,index| {
            switch(self.c.program.tables.mode) {
                .common => |v| {
                    if(receiver) |selected| {
                        if(index==selected.ordinal) {
                            _=try argument.frame(self.c,selected.frame);
                            // Match the same raw-to-relation boundary used by
                            // receiver_create results; no allocation root arises.
                            try self.setRegion(argument,try facts.relation(self.c,argument.view()));
                            continue;
                        }
                    }
                    const abi_row=v.abis[self.abi(target)];
                    const hidden=@as(usize,if(abi_row.lexical_environment!=null)1 else 0)+@as(usize,if(abi_row.receiver!=null)1 else 0);
                    if(index>=hidden) {
                        const binding=abi_row.parameters[index-hidden];
                        if(self.entry_roles.?.parameters[@intFromEnum(binding)]) |role| {
                            if(v.types[@intFromEnum(role.logical_type)].kind==.array) {
                                if(entry_heap==null) { entry_heap=try Heap.clone(self.c,self.initial_globals.view()); }
                                const at=facts.Site{.context=@enumFromInt(self.result.invocations.items.len),.location=.{.function=target,.block=@enumFromInt(0),.instruction=0}};
                                const activation=try self.activationFor(target,null,new_target);
                                argument.*=try self.entryArray(at,activation,parameters[index],&entry_heap.?);
                                continue;
                            }
                        }
                    }
                    // Uncovered entries and all internal transports retain the
                    // actual-storage unknown; a Source view is not a conversion.
                    argument.*=.{.unknown=true,.callable_unknown=true};
                },
                .exception => |v| {
                    const frame=v.storage.frames[@intFromEnum(v.abis[self.abi(target)].frame)];
                    argument.*=try self.declared(frame.slots[index].@"type");
                },
                .legacy => |v| {
                    const offset: usize=if((try self.lexical(target))!=null)1 else 0;
                    if(index<offset)argument.*=.{.unknown=true} else argument.*=try self.declared(v.abis[self.abi(target)].parameters[index-offset].view);
                },
            }
        }
        const id=try self.contextFor(target,arguments,if(entry_heap) |*heap|heap.view() else self.initial_globals.view(),null,true,false,null,null,if(receiver!=null)&frames else null,new_target);
        for(arguments) |argument|for(argument.objects.items) |object_id| {
            try self.c.charge(2); const object_info=&self.result.objects.items[@intFromEnum(object_id)];
            if(object_info.origin==.entry)object_info.origin.entry.context=id;
        };
        if(receiver) |selected| {
            // contextFor now owns the selected FrameStore. Its entry Site is a
            // representative of this root, never an instruction-birth proof.
            try self.c.charge(2); self.result.frames.items[@intFromEnum(selected.frame)].site.context=id;
        }
        // contextFor derives unresolved from the actual argument facets. A
        // known control frame does not erase unknown ordinary data parameters.
    }
    fn initialize(self: *Engine) Error!void {
        switch(self.c.program.tables.mode) {
            inline .common,.legacy,.exception => |v| for(v.types,0..) |row,index| {
                try self.c.charge(1+row.name.len/64); const kind=@tagName(row.kind);
                if(std.mem.eql(u8,kind,"scalar") or std.mem.eql(u8,kind,"string") or std.mem.eql(u8,kind,"undefined") or std.mem.eql(u8,kind,"null") or std.mem.eql(u8,kind,"void"))try self.primitives.put(self.c.allocator,row.name,@enumFromInt(index));
            },
        }
        switch(self.c.program.tables.mode) {
            .common => |v| {
                self.entry_roles=try entry_contracts.projectEntries(self.c);
                for(v.modules.globals,0..) |_,i| { try self.c.step(); _=try self.initial_globals.put(self.c,.{.global=@enumFromInt(i)},.{.unknown=true,.callable_unknown=true},true); }
                for(self.c.program.functions,0..) |function,i| {
                    try self.c.step(); const ref: t.FunctionRef=@enumFromInt(i); var is_root=function.role==.module_initializer;
                    for(v.closures.functions) |row| { try self.c.step(); if(row.function==ref) { is_root=row.parent==null; break; } }
                    if(function.role==.construction_body) {
                        if(!try receiverOutside(self.c,ref))continue;
                        const construction=v.members.constructions[@intFromEnum(v.abis[self.abi(ref)].construction.?)];
                        // The same body can be entered for its own nominal type
                        // or any derived dynamic newTarget. This also includes
                        // explicit ancestors of implicit-derived constructors;
                        // only already owned Runtime bodies are analyzed here.
                        for(v.types,0..) |row,type_index| {
                            try self.c.step(); if(row.kind!=.reference and row.kind!=.value)continue;
                            const actual: t.TypeRef=@enumFromInt(type_index);
                            if(try self.extends(actual,construction.owner))try self.seedRoot(ref,actual);
                        }
                    } else if(is_root)try self.seedRoot(ref,null);
                }
                // Global initial values are missing external actual facts as
                // well. A declared type or capacity is not their actual seed.
                if(v.modules.globals.len!=0)self.result.unresolved=true;
            },
            .exception => |v| for(self.c.program.functions,0..) |function,i| { try self.c.step(); if(function.role==.module_initializer or v.exceptions.functions[i].parent==null)try self.seedRoot(@enumFromInt(i),null); },
            .legacy => |v| {
                for(v.modules.globals,0..) |_,i| { try self.c.step(); _=try self.initial_globals.put(self.c,.{.global=@enumFromInt(i)},.{.unknown=true},true); }
                if(self.closureLegacy()) {
                    for(v.closures.functions) |row| { try self.c.step(); if(row.parent==null)try self.seedRoot(row.function,null); }
                } else {
                    for(v.modules.initialization) |function| { try self.c.step(); try self.seedRoot(function,null); }
                    for(v.modules.roots) |row| { try self.c.step(); try self.seedRoot(row.function,null); }
                }
            },
        }
    }
    fn contains(self: *Engine, list: []const t.FunctionRef, value: t.FunctionRef) Error!bool {
        for(list) |id| { try self.c.step(); if(id==value)return true; } return false;
    }
    fn finish(self: *Engine) Error!void {
        for(self.result.observations.items) |*observed| {
            try self.c.step(); const location=observed.location; const function=self.c.program.functions[@intFromEnum(location.function)];
            const op=function.blocks[@intFromEnum(location.block)].instructions[location.instruction];
            if(self.c.program.tables.mode==.common and std.meta.activeTag(op.data)==.eh_invoke_indirect) {
                const v=self.c.program.tables.mode.common; var claim: ?[]const t.FunctionRef=null;
                for(v.closures.calls) |row| { try self.c.step(); if(row.function==location.function and row.block==location.block and row.instruction==location.instruction) { claim=row.targets; break; } }
                const permitted=claim orelse return error.InvalidShape;
                if(observed.known.items.len==0)observed.unresolved=true;
                // Common wire17 admits complete finite rows, not TOP. Host
                // permission cannot forgive an observed code outside this
                // row. Unknown actual callers remain separately unresolved.
                for(observed.known.items) |target|try self.c.require(try self.contains(permitted,target));
                observed.relation=if(observed.unresolved).unresolved else .known_covered;
            } else if(self.closureLegacy()) {
                const v=self.c.program.tables.mode.legacy; var claim: ?[]const t.FunctionRef=null;
                for(v.closures.calls) |row| { try self.c.step(); if(row.function==location.function and row.block==location.block and row.instruction==location.instruction) { claim=row.targets; break; } }
                const permitted=claim orelse return error.InvalidShape;
                try self.c.require(!observed.unresolved and observed.known.items.len!=0 and observed.known.items.len==permitted.len);
                for(observed.known.items) |target|try self.c.require(try self.contains(permitted,target)); observed.relation=.exact_closed;
            } else observed.relation=if(observed.unresolved).unresolved else if(std.meta.activeTag(op.data)==.common_method_invoke).known_covered else .derived;
            self.result.unresolved=self.result.unresolved or observed.unresolved;
        }
        if(self.closureLegacy())for(self.c.program.tables.mode.legacy.closures.calls) |row| {
            try self.c.step(); var reached=false;
            for(self.result.observations.items) |observed| { try self.c.step(); if(observed.location.function==row.function and observed.location.block==row.block and observed.location.instruction==row.instruction) { reached=true; break; } }
            try self.c.require(reached);
        };
    }
};

// Preconditions: the same Context has completed typed references, layouts,
// SSA and derivable identities. This returns passive, owning analysis facts,
// not an admission token. It neither parses nor loads bytes or executes code.
// Missing external actual values and unscoped relations remain explicit; known
// Common code containment does not validate fixed-flow/HSC or full capacity.
// One fixed point and one final replay serve every supplied consumer.
// Any nonnull material must already have passed the complete artifact check at
// the public boundary using this same Context. It is data, not a validity flag;
// this internal analysis neither rechecks nor grants that boundary's proof.
pub fn analyze(c: *Context, material: ?*const host_binding.Bundle, observers: []const facts.Observer) Error!Analysis {
    try c.step(); // Borrowed owning Context identity on the returned analysis.
    var engine=Engine{.c=c,.host_material=material,.observers=observers,.result=.{.owner=c}}; defer engine.deinit(); errdefer engine.result.deinit(c.allocator);
    try engine.initialize();
    while(true) {
        try c.step(); engine.changed=false; var cursor: usize=0;
        while(cursor<engine.result.invocations.items.len) : (cursor+=1) { try c.step(); try engine.execute(@enumFromInt(cursor)); }
        if(!engine.changed)break;
    }
    try engine.finish(); try engine.refresh(); engine.replay=true;
    try c.charge(engine.result.region_scopes.items.len);
    const scopes=try c.allocator.dupe(relation.Scope,engine.result.region_scopes.items); defer c.allocator.free(scopes);
    for(0..engine.result.invocations.items.len) |index|try engine.execute(@enumFromInt(index));
    try c.require(!engine.changed);
    try c.require(scopes.len==engine.result.region_scopes.items.len);
    for(scopes,engine.result.region_scopes.items) |before,after| { try c.step(); try c.require(std.meta.eql(before,after)); }
    if(c.program.tables.mode==.common)for(engine.result.invocations.items) |invocation| {
        try c.step(); invocation.receiver_lifetimes.final_replay_complete=true;
    };
    try c.step(); engine.result.final_replay_complete=true;
    const result=engine.result; engine.result=.{}; return result;
}
