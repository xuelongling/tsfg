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
    unresolved: bool=false,
    arguments: []V,
    entry: Heap=.{},
    returned: V=.{}, thrown: V=.{},
    normal_heap: Heap=.{}, language_heap: Heap=.{},
    normal: bool=false, language: bool=false,
};
pub const Analysis = struct {
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
    region_correlation_available: bool=false,

    pub fn view(self: *const Analysis) facts.WorldView {
        return .{.objects=self.objects.items,.cells=self.cells.items,.contexts=self.contexts.items};
    }
    pub fn deinit(self: *Analysis, allocator: std.mem.Allocator) void {
        for(self.invocations.items) |item| {
            for(item.arguments) |*value|value.deinit(allocator); allocator.free(item.arguments);
            item.entry.deinit(allocator); item.returned.deinit(allocator); item.thrown.deinit(allocator);
            item.normal_heap.deinit(allocator); item.language_heap.deinit(allocator); allocator.destroy(item);
        }
        for(self.observations.items) |*row|row.known.deinit(allocator);
        for(self.creation_storage.items) |*sites|sites.deinit(allocator); self.creation_storage.deinit(allocator);
        self.objects.deinit(allocator); self.cells.deinit(allocator); self.invocations.deinit(allocator);
        self.contexts.deinit(allocator); self.observations.deinit(allocator); self.*=.{};
    }
};
const State = struct {
    values: []V,
    heap: Heap=.{},
    fn init(c: *Context, count: usize) Error!State {
        try c.charge(count); const values=try c.allocator.alloc(V,count); @memset(values,.{}); return .{.values=values};
    }
    fn deinit(self: *State, c: *Context) void {
        for(self.values) |*v|v.deinit(c.allocator); c.allocator.free(self.values); self.heap.deinit(c.allocator);
    }
    fn view(self: *const State) facts.StateView { return .{.values=.{.values=self.values},.heap=self.heap.view()}; }
    fn read(self: *const State, r: t.RegisterRef) facts.Value { return self.values[@intFromEnum(r)].view(); }
    fn assign(self: *State, c: *Context, r: t.RegisterRef, value: facts.Value) Error!void {
        const replacement=try V.clone(c,value); const target=&self.values[@intFromEnum(r)];
        target.deinit(c.allocator); target.*=replacement;
    }
    fn clone(c: *Context, source: *const State) Error!State {
        var result=try State.init(c,source.values.len); errdefer result.deinit(c);
        for(source.values,0..) |value,i| { result.values[i]=try V.clone(c,value.view()); }
        result.heap=try Heap.clone(c,source.heap.view()); return result;
    }
    fn join(self: *State, c: *Context, incoming: *const State) Error!bool {
        var changed=try self.heap.join(c,incoming.heap.view());
        for(self.values,incoming.values) |*a,b| { if(try a.join(c,b.view()))changed=true; } return changed;
    }
};
const Engine = struct {
    const Activation = struct { function: t.FunctionRef, parent: ?usize, site: ?facts.Location, recursive: bool };
    const ObjectKey = struct {
        activation: usize, location: facts.Location, kind: facts.ObjectKind, @"type": ?t.TypeRef, environment: ?t.EnvironmentRef,
        copy_source: ?facts.ObjectId=null, copy_parent: ?facts.ObjectId=null, copy_field: ?t.FieldRef=null,
    };
    c: *Context,
    result: Analysis=.{},
    observers: []const facts.Observer=&.{},
    replay: bool=false,
    emit: bool=false,
    changed: bool=false,
    initial_globals: Heap=.{},
    activations: std.ArrayListUnmanaged(Activation)=.empty,
    object_keys: std.ArrayListUnmanaged(ObjectKey)=.empty,
    cell_activations: std.ArrayListUnmanaged(usize)=.empty,
    captured: std.AutoHashMapUnmanaged(struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef },V)=.{},
    primitives: std.StringHashMapUnmanaged(t.TypeRef)=.{},

    fn deinit(self: *Engine) void {
        self.initial_globals.deinit(self.c.allocator); self.activations.deinit(self.c.allocator);
        self.object_keys.deinit(self.c.allocator); self.cell_activations.deinit(self.c.allocator);
        var iterator=self.captured.valueIterator(); while(iterator.next()) |value|value.deinit(self.c.allocator); self.captured.deinit(self.c.allocator);
        self.primitives.deinit(self.c.allocator);
    }
    fn activationFor(self: *Engine, function: t.FunctionRef, parent: ?facts.Site) Error!usize {
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
        for(self.activations.items,0..) |row,i| { try self.c.step();
            if(row.function==function and row.parent==owner and row.recursive==recursive and std.meta.eql(row.site,site))return i;
        }
        if(self.replay)return error.InvalidShape;
        try self.activations.append(self.c.allocator,.{.function=function,.parent=owner,.site=site,.recursive=recursive}); return self.activations.items.len-1;
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
            try self.c.step(); try self.result.contexts.append(self.c.allocator,.{.function=invocation.function,
                .arguments=.{.values=invocation.arguments},.entry=invocation.entry.view(),.root=invocation.root,
                .repeated=invocation.repeated,.unresolved=invocation.unresolved});
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
    fn contextFor(self: *Engine, function: t.FunctionRef, arguments: []const V, heap: facts.HeapView, parent: ?facts.Site, is_root: bool, repeated: bool) Error!facts.ContextId {
        const activation=try self.activationFor(function,parent);
        const summarized=repeated or self.activations.items[activation].recursive;
        var entry=try self.reachable(arguments,heap); defer entry.deinit(self.c.allocator);
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
            try self.c.step(); if(invocation.function!=function or invocation.root!=is_root or invocation.repeated!=summarized or invocation.activation!=activation or invocation.arguments.len!=arguments.len)continue;
            var same=true;
            for(invocation.arguments,arguments) |a,b| { if(!try self.dataEqual(a.view(),b.view())) { same=false; break; } }
            if(same and try self.heapEqual(invocation.entry.view(),entry.view())) {
                if(self.replay) {
                    for(invocation.arguments,arguments) |a,b|try self.provenanceSubset(a.view(),b.view());
                    var iterator=entry.view().iterator(); while(iterator.next()) |slot| { try self.c.step(); try self.provenanceSubset(invocation.entry.view().get(slot.slot).?,slot.value); }
                    return @enumFromInt(i);
                }
                for(invocation.arguments,arguments) |*a,b| { if(try a.join(self.c,b.view()))self.changed=true; }
                if(try invocation.entry.join(self.c,entry.view()))self.changed=true;
                return @enumFromInt(i);
            }
        }
        if(self.replay)return error.InvalidShape; // Final replay never invents contexts.
        if(self.c.program.tables.mode!=.legacy)try self.c.require(self.result.invocations.items.len<4096);
        const invocation=try self.c.allocator.create(Invocation); errdefer self.c.allocator.destroy(invocation);
        const values=try self.c.allocator.alloc(V,arguments.len); errdefer self.c.allocator.free(values); @memset(values,.{});
        var copied_count: usize=0; errdefer for(values[0..copied_count]) |*value|value.deinit(self.c.allocator);
        for(arguments,0..) |value,i| { values[i]=try V.clone(self.c,value.view()); copied_count+=1; }
        var unresolved=false; for(values) |value| { try self.c.step(); unresolved=unresolved or value.unknown or value.callable_unknown; }
        invocation.*=.{.function=function,.parent=parent,.root=is_root,.repeated=summarized,.activation=activation,.arguments=values,.entry=entry,.unresolved=unresolved}; entry=.{};
        self.result.unresolved=self.result.unresolved or unresolved;
        errdefer invocation.entry.deinit(self.c.allocator);
        try self.result.invocations.append(self.c.allocator,invocation); self.changed=true; return @enumFromInt(self.result.invocations.items.len-1);
    }
    fn object(self: *Engine, at: facts.Site, kind: facts.ObjectKind, actual_type: ?t.TypeRef, environment: ?t.EnvironmentRef, weak: bool) Error!facts.ObjectId {
        const key=ObjectKey{.activation=self.info(at.context).activation,.location=at.location,.kind=kind,.@"type"=actual_type,.environment=environment};
        return self.objectKey(at,key,weak);
    }
    fn objectKey(self: *Engine, at: facts.Site, key: ObjectKey, weak: bool) Error!facts.ObjectId {
        for(self.object_keys.items,0..) |prior,i| {
            try self.c.step(); if(!std.meta.eql(prior,key))continue; const row=&self.result.objects.items[i];
            var found=false; for(self.result.creation_storage.items[i].items) |site| { try self.c.step(); if(std.meta.eql(site,at)) { found=true; break; } }
            if(!found) { if(self.replay)return error.InvalidShape; try self.result.creation_storage.items[i].append(self.c.allocator,at); row.creations=self.result.creation_storage.items[i].items; }
            if(weak and !row.weak) { if(self.replay)return error.InvalidShape; row.weak=true; self.changed=true; } return @enumFromInt(i);
        }
        if(self.replay)return error.InvalidShape;
        var sites: std.ArrayListUnmanaged(facts.Site)=.empty; errdefer sites.deinit(self.c.allocator); try sites.append(self.c.allocator,at);
        try self.object_keys.ensureUnusedCapacity(self.c.allocator,1); try self.result.creation_storage.ensureUnusedCapacity(self.c.allocator,1);
        try self.result.objects.append(self.c.allocator,.{.origin=.{.allocation=at},.kind=key.kind,.@"type"=key.@"type",.environment=key.environment,.weak=weak});
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
        // Only the legacy/EH typed-entry contracts promise declared values.
        // Common has actual-storage semantics instead; its missing callers
        // are handled by unknown(), not this recipe or a carrier maximum.
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
    fn callback(self: *Engine, before: bool, at: facts.Site, state: *const State) Error!void {
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
        const invocation=self.info(at.context);
        if(kind!=.request_trap and !self.replay) {
            const normal=kind==.normal; const flag=if(normal)&invocation.normal else &invocation.language;
            if(!flag.*) { flag.*=true; self.changed=true; }
            const returned=if(normal)&invocation.returned else &invocation.thrown;
            if(try returned.join(self.c,value))self.changed=true;
            var roots: std.ArrayListUnmanaged(V)=.empty; defer roots.deinit(self.c.allocator);
            try self.c.charge(invocation.arguments.len+1); try roots.appendSlice(self.c.allocator,invocation.arguments);
            var extra=try V.clone(self.c,value); defer extra.deinit(self.c.allocator); try roots.append(self.c.allocator,extra);
            var heap=try self.reachable(roots.items,state.heap.view()); defer heap.deinit(self.c.allocator);
            if(try (if(normal)&invocation.normal_heap else &invocation.language_heap).join(self.c,heap.view()))self.changed=true;
        }
        if(self.emit)for(self.observers) |observer| { try self.c.step(); if(observer.completed) |f|try f(observer.client,self.c,self.result.view(),at,kind,value,state.heap.view()); };
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
        const function=self.c.program.functions[@intFromEnum(at.location.function)]; const b=@intFromEnum(target);
        const parameters=function.blocks[b].parameters; try self.c.require(parameters.len==arguments.len);
        try self.notifyEdge(at,.{.function=at.location.function,.block=target,.instruction=0});
        if(!graph.collect)return;
        var incoming=try State.clone(self.c,state); var owns=true; defer if(owns)incoming.deinit(self.c);
        for(parameters,arguments) |parameter,argument|try incoming.assign(self.c,parameter,argument.view());
        const grew=if(graph.incoming[b]) |*old|try old.join(self.c,&incoming) else blk: {
            graph.incoming[b]=incoming; owns=false; break :blk true;
        };
        if(grew and !graph.queued[b]) { try self.c.step(); graph.queued[b]=true; try graph.work.append(self.c.allocator,target); }
    }
    fn copyOrigins(self: *Engine, at: facts.Site, callee: facts.ContextId, passed: []const V, value: facts.Value) Error!V {
        var result=try V.clone(self.c,value); errdefer result.deinit(self.c.allocator); result.effect_origins.clearRetainingCapacity();
        const target=self.c.program.functions[@intFromEnum(self.info(callee).function)];
        for(value.effect_origins) |source| { try self.c.step();
            if(source.context==callee) switch(source.owner) {
                .parameter => |reg| {
                    var found=false;
                    for(target.blocks[0].parameters,0..) |entry,i| { try self.c.step(); if(entry!=reg)continue;
                        found=true; for(passed[i].effect_origins.items) |origin_value|_=try result.effectOrigin(self.c,origin_value); break;
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
    fn invoke(self: *Engine, graph: *Graph, at: facts.Site, target: t.FunctionRef, arguments: []const V, state: *State, normal: ?t.BlockRef, language: ?t.BlockRef, weak: bool, output: *V) Error!void {
        const callee=try self.contextFor(target,arguments,state.heap.view(),at,false,weak);
        const next=facts.Location{.function=at.location.function,.block=normal orelse at.location.block,.instruction=if(normal==null)at.location.instruction+1 else 0};
        try self.notifyCall(at,callee,next,if(language) |b| .{.function=at.location.function,.block=b,.instruction=0} else null);
        const called=self.info(callee);
        if(normal) |b| {
            if(called.normal) {
                var after=try State.clone(self.c,state); defer after.deinit(self.c); try self.overlay(&after,called.normal_heap.view());
                var value=try self.copyOrigins(at,callee,arguments,called.returned.view()); defer value.deinit(self.c.allocator);
                const count=self.c.program.functions[@intFromEnum(at.location.function)].blocks[@intFromEnum(b)].parameters.len;
                try self.edge(graph,at,b,&after,if(count==0)&.{} else @as([]const V, &.{value}));
            }
            if(called.language) {
                var after=try State.clone(self.c,state); defer after.deinit(self.c); try self.overlay(&after,called.language_heap.view());
                var value=try self.copyOrigins(at,callee,arguments,called.thrown.view()); defer value.deinit(self.c.allocator);
                try self.edge(graph,at,language.?,&after,&.{value});
            }
        } else {
            // The legacy closure contract is a context-insensitive language
            // may graph; its non-CPS calls do not prune the following block
            // according to a callee's current completion approximation.
            var value=try self.copyOrigins(at,callee,arguments,called.returned.view()); defer value.deinit(self.c.allocator);
            _=try output.join(self.c,value.view()); try self.overlay(state,called.normal_heap.view());
        }
    }
    fn havoc(self: *Engine, context: facts.ContextId, state: *State) Error!void {
        // Without caller code a call may mutate every reachable argument and
        // global. Preserve object identity/weakness, not invented field facts.
        var present: V=.{}; defer present.deinit(self.c.allocator);
        var slots=state.heap.view().iterator(); while(slots.next()) |entry| { try self.c.step();
            switch(entry.slot) {
                inline .field,.element,.environment_slot,.capture => |v| { _=try present.object(self.c,v.object); },
                .length,.span_owner,.span_start,.span_length,.parent => |v| { _=try present.object(self.c,v); },
                .cell,.global => {},
            }
        }
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
    fn copied(self: *Engine, at: facts.Site, input: facts.Value, state: *State, weak: bool) Error!V {
        var result=try V.clone(self.c,input); errdefer result.deinit(self.c.allocator); result.objects.clearRetainingCapacity();
        // An inline value copy copies its value children, not references or
        // closure environments. A work list handles shared/cyclic references
        // without reinterpreting a site as a runtime instance.
        const Pair=struct { original: facts.ObjectId, copied: facts.ObjectId, parent: ?usize };
        var copies: std.ArrayListUnmanaged(Pair)=.empty; defer copies.deinit(self.c.allocator);
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
                _=try stored.object(self.c,child_copy); try copies.append(self.c.allocator,.{.original=child,.copied=child_copy,.parent=cursor});
            }
            try entries.append(self.c.allocator,.{.slot=.{.field=.{.object=pair.copied,.field=entry.slot.field.field}},.value=stored});
        } }
        for(entries.items) |entry|_=try state.heap.put(self.c,entry.slot,entry.value.view(),!self.result.objects.items[@intFromEnum(entry.slot.field.object)].weak);
        return result;
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
            .domain_copy => value=try self.copied(at,arguments[0].view(),state,weak),
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
                // This graph contains the claimed HSC/BI digests, not their
                // verified external binding. Do not seed actual return tags
                // or heap purity from that claim. The effects consumer may
                // separately discharge its fixed Counter metadata subset.
                _=data; value=try V.clone(self.c,self.unknown(at.context)); try self.origin(&value,at.context,.unknown); try self.havoc(at.context,state);
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
                if(input.unknown) { self.info(at.context).unresolved=true; self.result.unresolved=true; }
                if(normal) { var selected=try self.literal(data.target_type); defer selected.deinit(self.c.allocator);
                    if(input.tags.len==1 and input.tags[0]==integer_type and !input.unknown)selected.number=input.number;
                    try self.edge(graph,at,data.normal_successor,state,&.{selected});
                }
                if(trap)try self.completion(at,.request_trap,.{},state); continues=false;
            },
            .@"br" => |data| { try self.edge(graph,at,data.destination,state,arguments); continues=false; },
            .@"cond_br" => |data| {
                const input=arguments[0].view(); const truth=if(self.closureLegacy() or input.unknown or input.truth==0)@as(u2,3) else input.truth;
                if(input.unknown) { self.info(at.context).unresolved=true; self.result.unresolved=true; }
                if(truth&2!=0)try self.edge(graph,at,data.true_destination,state,arguments[1..1+data.true_count]);
                if(truth&1!=0)try self.edge(graph,at,data.false_destination,state,arguments[1+data.true_count..]); continues=false;
            },
            .eh_route => |data| { try self.edge(graph,at,data.successor,state,arguments); continues=false; },
            .@"return" => { try self.completion(at,.normal,if(arguments.len==0).{} else arguments[0].view(),state); continues=false; },
            .eh_raise => { try self.completion(at,.language,arguments[0].view(),state); continues=false; },
            .eh_unreachable => { continues=false; },
            .fuel,.eh_enter,.eh_publish => {},
            // Calls/constructions are handled together below so every path
            // uses the same argument marshalling and completion projection.
            .@"call",.function_call,.domain_method_call,.eh_invoke,.eh_invoke_indirect,.common_method_invoke,.domain_construct,.domain_super,.domain_initialize_fields,.domain_field_define,.domain_field_initialize => try self.calls(graph,at,state,op,arguments,weak,&value,&continues),
        }
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
            try self.invoke(graph,at,target,arguments,state,if(code==.eh_invoke)op.data.eh_invoke.normal else null,if(code==.eh_invoke)op.data.eh_invoke.exceptional else null,weak,value);
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
                            var actual: V=.{}; errdefer actual.deinit(self.c.allocator); _=try actual.object(self.c,id); passed.appendAssumeCapacity(actual);
                        } else complete=false;
                    } else try self.c.require(pair.environment==null);
                    for(arguments[1..]) |argument|passed.appendAssumeCapacity(try V.clone(self.c,argument.view()));
                }
                if(!complete) { self.info(at.context).unresolved=true; self.result.unresolved=true; continue; }
                try self.invoke(graph,at,pair.code,passed.items,state,if(code==.eh_invoke_indirect)op.data.eh_invoke_indirect.normal else null,if(code==.eh_invoke_indirect)op.data.eh_invoke_indirect.exceptional else null,weak,value);
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
                if(!try self.is(id,expected)) { self.result.unresolved=true; self.info(at.context).unresolved=true; try self.completion(at,.request_trap,input,state); }
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
                if(passed[0].objects.items.len==0) { called.unknown=true; self.result.unresolved=true; continue; }
                _=try called.callable(self.c,.{.code=target,.environment=null});
                try self.invoke(graph,at,target,passed,state,if(code==.common_method_invoke)op.data.common_method_invoke.normal else null,if(code==.common_method_invoke)op.data.common_method_invoke.exceptional else null,weak,value);
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
                try self.invoke(graph,at,legacy.members.constructions[@intFromEnum(data.construction)].function,passed,state,null,null,weak,&discarded);
            },
            .domain_super => |data| try self.invoke(graph,at,legacy.members.constructions[@intFromEnum(data.construction)].function,arguments,state,null,null,weak,value),
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
            for(function.blocks[0].parameters,invocation.arguments) |reg,argument| {
                try state.assign(self.c,reg,argument.view()); try self.origin(&state.values[@intFromEnum(reg)],context,.{.parameter=reg});
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
                for(function.blocks[b].instructions,0..) |_,index| {
                    const at=facts.Site{.context=context,.location=.{.function=invocation.function,.block=@enumFromInt(b),.instruction=@intCast(index)}};
                    if(!try self.operate(&graph,at,&state))break;
                }
            }
        }
    }
    fn root(self: *Engine, target: t.FunctionRef) Error!void {
        const function=self.c.program.functions[@intFromEnum(target)]; const parameters=function.blocks[0].parameters;
        try self.c.charge(parameters.len+1); const arguments=try self.c.allocator.alloc(V,parameters.len); @memset(arguments,.{});
        defer { for(arguments) |*argument|argument.deinit(self.c.allocator); self.c.allocator.free(arguments); }
        for(arguments,0..) |*argument,index| {
            switch(self.c.program.tables.mode) {
                .common => { argument.*=.{.unknown=true,.callable_unknown=true}; },
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
        const id=try self.contextFor(target,arguments,self.initial_globals.view(),null,true,false);
        if(parameters.len!=0 and self.c.program.tables.mode==.common) { self.info(id).unresolved=true; self.result.unresolved=true; }
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
                for(v.modules.globals,0..) |_,i| { try self.c.step(); _=try self.initial_globals.put(self.c,.{.global=@enumFromInt(i)},.{.unknown=true,.callable_unknown=true},true); }
                for(self.c.program.functions,0..) |function,i| {
                    try self.c.step(); const ref: t.FunctionRef=@enumFromInt(i); var is_root=function.role==.module_initializer;
                    for(v.closures.functions) |row| { try self.c.step(); if(row.function==ref) { is_root=row.parent==null; break; } }
                    if(is_root)try self.root(ref);
                }
                // Global initial values are missing external actual facts as
                // well. A declared type or capacity is not their actual seed.
                if(v.modules.globals.len!=0)self.result.unresolved=true;
            },
            .exception => |v| for(self.c.program.functions,0..) |function,i| { try self.c.step(); if(function.role==.module_initializer or v.exceptions.functions[i].parent==null)try self.root(@enumFromInt(i)); },
            .legacy => |v| {
                for(v.modules.globals,0..) |_,i| { try self.c.step(); _=try self.initial_globals.put(self.c,.{.global=@enumFromInt(i)},.{.unknown=true},true); }
                if(self.closureLegacy()) {
                    for(v.closures.functions) |row| { try self.c.step(); if(row.parent==null)try self.root(row.function); }
                } else {
                    for(v.modules.initialization) |function| { try self.c.step(); try self.root(function); }
                    for(v.modules.roots) |row| { try self.c.step(); try self.root(row.function); }
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
// Missing external actual values/region correlation remain explicit; known
// Common code containment does not validate fixed-flow/HSC or full capacity.
// One fixed point and one final replay serve every supplied consumer.
pub fn analyze(c: *Context, observers: []const facts.Observer) Error!Analysis {
    var engine=Engine{.c=c,.observers=observers}; defer engine.deinit(); errdefer engine.result.deinit(c.allocator);
    try engine.initialize();
    while(true) {
        try c.step(); engine.changed=false; var cursor: usize=0;
        while(cursor<engine.result.invocations.items.len) : (cursor+=1) { try c.step(); try engine.execute(@enumFromInt(cursor)); }
        if(!engine.changed)break;
    }
    try engine.finish(); try engine.refresh(); engine.replay=true;
    for(0..engine.result.invocations.items.len) |index|try engine.execute(@enumFromInt(index));
    try c.require(!engine.changed);
    const result=engine.result; engine.result=.{}; return result;
}
