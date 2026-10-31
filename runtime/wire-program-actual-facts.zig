// SPDX-License-Identifier: MIT
// Plain abstract-flow data shared by target analysis and later observers.
// An ordinal identifies an analysis object/context, never a Runtime handle or
// a dynamic allocation proof. Repeated/merged origins remain explicitly weak.
// These records grant no Source, capacity, effects, borrow or entry authority.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const data = @import("wire-program-actual-data.zig");
const t = model.types;
pub const Context = context.Context;
pub const Error = context.Error;
pub const ContextId = data.ContextId;
pub const ObjectId = data.ObjectId;
pub const CellId = data.CellId;
pub const Location = data.Location;
pub const Site = data.Site;
pub const Callable = struct { code: t.FunctionRef, environment: ?ObjectId };
// Source-effect ownership is separate from physical aliasing. A callee's
// parameter does not become a global just because its current object came
// from that global. No such token is an actual tag, target or holding edge.
pub const EffectOrigin = struct { context: ContextId, owner: union(enum) {
    parameter: t.RegisterRef, global: t.GlobalRef,
    capture: struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef }, unknown: void,
} };
pub const ObjectKind = enum { reference, value, array, read_span, environment };
pub const ObjectOrigin = union(enum) {
    allocation: Site,
    entry: struct { context: ContextId, parameter: t.RegisterRef },
    copy: struct { site: Site, original: ObjectId },
};
pub const ObjectInfo = struct {
    // origin is a representative. A single physical activation may have
    // multiple abstract argument/heap contexts; all observed creation points
    // remain available instead of upgrading that representative to uniqueness.
    origin: ObjectOrigin,
    creations: []const Site=&.{},
    kind: ObjectKind,
    @"type": ?t.TypeRef,
    environment: ?t.EnvironmentRef,
    weak: bool,
};
pub const CellInfo = struct { origin: Site, binding: t.CellRef, weak: bool };
pub const Element = struct { object: ObjectId, index: ?i64 };
pub const Slot = union(enum) {
    field: struct { object: ObjectId, field: t.FieldRef },
    element: Element,
    length: ObjectId,
    span_owner: ObjectId,
    span_start: ObjectId,
    span_length: ObjectId,
    environment_slot: struct { object: ObjectId, slot: t.EnvironmentSlotRef },
    capture: struct { object: ObjectId, binding: t.CellRef },
    parent: ObjectId,
    cell: CellId,
    global: t.GlobalRef,
};
pub const Value = struct {
    tags: []const t.TypeRef=&.{},
    objects: []const ObjectId=&.{},
    cells: []const CellId=&.{},
    callables: []const Callable=&.{},
    effect_origins: []const EffectOrigin=&.{},
    region: data.Value=.{},
    truth: u2=0,
    number: ?i64=null,
    unknown: bool=false,
    callable_unknown: bool=false,
    pub fn bottom(self: Value) bool {
        return self.tags.len==0 and self.objects.len==0 and self.cells.len==0 and
            self.callables.len==0 and !self.unknown and !self.callable_unknown;
    }
};
// Absent relation evidence is not a selected allocation version. This is the
// single raw-to-relation fallback; consumers never reconstruct roots from IDs.
pub fn relation(c: *Context, raw: Value) Error!data.Value {
    try c.step(); if(raw.region.known)return raw.region;
    try c.charge(raw.objects.len+raw.cells.len+raw.callables.len);
    var result=data.Value{.known=true,.number=raw.number,
        .unresolved=raw.unknown or raw.callable_unknown or raw.objects.len!=0 or raw.cells.len!=0};
    for(raw.callables) |pair| {
        if(pair.environment==null)result.empty=true else result.unresolved=true;
    }
    result.empty=result.empty or (raw.tags.len!=0 and raw.objects.len==0 and raw.callables.len==0);
    return result;
}
pub fn equal(c: *Context, a: Value, b: Value) Error!bool {
    try c.charge(5);
    if(a.truth!=b.truth or a.number!=b.number or a.unknown!=b.unknown or a.callable_unknown!=b.callable_unknown)return false;
    inline for(.{"tags","objects","cells","callables","effect_origins"}) |name| {
        const left=@field(a,name); const right=@field(b,name); try c.step();
        if(left.len!=right.len)return false;
        for(left,right) |x,y| { try c.step(); if(!std.meta.eql(x,y))return false; }
    }
    return data.equal(c,a.region,b.region);
}

fn less(comptime T: type, a: T, b: T) bool {
    if(T==Callable) {
        if(a.code!=b.code)return @intFromEnum(a.code)<@intFromEnum(b.code);
        if(a.environment==null)return b.environment!=null;
        return b.environment!=null and @intFromEnum(a.environment.?)<@intFromEnum(b.environment.?);
    } else if(T==EffectOrigin) {
        if(a.context!=b.context)return @intFromEnum(a.context)<@intFromEnum(b.context);
        const left=@intFromEnum(std.meta.activeTag(a.owner)); const right=@intFromEnum(std.meta.activeTag(b.owner));
        if(left!=right)return left<right;
        return switch(a.owner) {
            .parameter => |v| @intFromEnum(v)<@intFromEnum(b.owner.parameter),
            .global => |v| @intFromEnum(v)<@intFromEnum(b.owner.global),
            .capture => |v| if(v.environment!=b.owner.capture.environment) @intFromEnum(v.environment)<@intFromEnum(b.owner.capture.environment) else @intFromEnum(v.slot)<@intFromEnum(b.owner.capture.slot),
            .unknown => false,
        };
    } else return @intFromEnum(a)<@intFromEnum(b);
}
fn add(comptime T: type, c: *Context, into: *std.ArrayListUnmanaged(T), value: T) Error!bool {
    // Common's ActualValue explicitly caps each of these four facets at 256
    // (common-program-abstract.cpp, merge/recordCapacity). EH and the legacy
    // closure target domain have no such per-value cap; their visits remain
    // bounded by this same Context meter and their actual typed directories.
    // Canonical set order is internal equality/context-key data, not wire IDs.
    var at: usize=0;
    while(at<into.items.len) : (at+=1) {
        try c.step();
        if(std.meta.eql(into.items[at],value))return false;
        if(less(T,value,into.items[at]))break;
    }
    if(T!=EffectOrigin and c.program.tables.mode==.common)try c.require(into.items.len<256);
    try c.charge(into.items.len-at+1);
    try into.insert(c.allocator,at,value); return true;
}
pub const OwnedValue = struct {
    tags: std.ArrayListUnmanaged(t.TypeRef)=.empty,
    objects: std.ArrayListUnmanaged(ObjectId)=.empty,
    cells: std.ArrayListUnmanaged(CellId)=.empty,
    callables: std.ArrayListUnmanaged(Callable)=.empty,
    effect_origins: std.ArrayListUnmanaged(EffectOrigin)=.empty,
    region: data.OwnedValue=.{},
    truth: u2=0, number: ?i64=null, unknown: bool=false, callable_unknown: bool=false,

    pub fn view(self: *const OwnedValue) Value {
        return .{.tags=self.tags.items,.objects=self.objects.items,.cells=self.cells.items,.callables=self.callables.items,
            .effect_origins=self.effect_origins.items,.region=self.region.view(),.truth=self.truth,.number=self.number,.unknown=self.unknown,.callable_unknown=self.callable_unknown};
    }
    pub fn deinit(self: *OwnedValue, allocator: std.mem.Allocator) void {
        self.tags.deinit(allocator); self.objects.deinit(allocator); self.cells.deinit(allocator); self.callables.deinit(allocator); self.effect_origins.deinit(allocator); self.region.deinit(allocator); self.*=.{};
    }
    pub fn tag(self: *OwnedValue, c: *Context, id: t.TypeRef) Error!bool { return add(t.TypeRef,c,&self.tags,id); }
    pub fn object(self: *OwnedValue, c: *Context, id: ObjectId) Error!bool { return add(ObjectId,c,&self.objects,id); }
    pub fn cell(self: *OwnedValue, c: *Context, id: CellId) Error!bool { return add(CellId,c,&self.cells,id); }
    pub fn callable(self: *OwnedValue, c: *Context, pair: Callable) Error!bool { return add(Callable,c,&self.callables,pair); }
    pub fn effectOrigin(self: *OwnedValue, c: *Context, origin: EffectOrigin) Error!bool { return add(EffectOrigin,c,&self.effect_origins,origin); }
    pub fn clone(c: *Context, value: Value) Error!OwnedValue {
        try c.charge(value.tags.len+value.objects.len+value.cells.len+value.callables.len+value.effect_origins.len+1);
        var result: OwnedValue=.{}; errdefer result.deinit(c.allocator);
        try result.tags.appendSlice(c.allocator,value.tags); try result.objects.appendSlice(c.allocator,value.objects);
        try result.cells.appendSlice(c.allocator,value.cells); try result.callables.appendSlice(c.allocator,value.callables);
        try result.effect_origins.appendSlice(c.allocator,value.effect_origins);
        result.region=try data.OwnedValue.clone(c,value.region);
        result.truth=value.truth; result.number=value.number; result.unknown=value.unknown; result.callable_unknown=value.callable_unknown;
        return result;
    }
    pub fn join(self: *OwnedValue, c: *Context, incoming: Value) Error!bool {
        try c.step(); const was_bottom=self.view().bottom(); var changed=false;
        if(!was_bottom and !self.region.known) { changed=try self.region.join(c,try relation(c,self.view())); }
        if(!incoming.bottom() or incoming.region.known) { changed=(try self.region.join(c,try relation(c,incoming))) or changed; }
        for(incoming.tags) |id| { if(try self.tag(c,id))changed=true; }
        for(incoming.objects) |id| { if(try self.object(c,id))changed=true; }
        for(incoming.cells) |id| { if(try self.cell(c,id))changed=true; }
        for(incoming.callables) |pair| { if(try self.callable(c,pair))changed=true; }
        for(incoming.effect_origins) |origin| { if(try self.effectOrigin(c,origin))changed=true; }
        try c.charge(5);
        const truth=self.truth|incoming.truth; const unknown=self.unknown or incoming.unknown;
        const callable_unknown=self.callable_unknown or incoming.callable_unknown;
        const number=if(incoming.bottom())self.number else if(was_bottom)incoming.number else if(self.number==incoming.number)self.number else null;
        changed=changed or truth!=self.truth or unknown!=self.unknown or callable_unknown!=self.callable_unknown or number!=self.number;
        self.truth=truth; self.unknown=unknown; self.callable_unknown=callable_unknown; self.number=number; return changed;
    }
};

pub const Heap = struct {
    entries: std.AutoHashMapUnmanaged(Slot,OwnedValue)=.{},
    pub fn deinit(self: *Heap, allocator: std.mem.Allocator) void {
        var iterator=self.entries.valueIterator(); while(iterator.next()) |value|value.deinit(allocator);
        self.entries.deinit(allocator); self.*=.{};
    }
    pub fn view(self: *const Heap) HeapView { return .{.heap=self}; }
    pub fn put(self: *Heap, c: *Context, slot: Slot, value: Value, strong: bool) Error!bool {
        try c.step(); const found=try self.entries.getOrPut(c.allocator,slot);
        if(!found.found_existing) { found.value_ptr.*=.{}; found.value_ptr.*=try OwnedValue.clone(c,value); return true; }
        if(!strong)return found.value_ptr.join(c,value);
        if(try equal(c,found.value_ptr.view(),value))return false;
        const replacement=try OwnedValue.clone(c,value);
        found.value_ptr.deinit(c.allocator); found.value_ptr.*=replacement; return true;
    }
    pub fn clone(c: *Context, source: HeapView) Error!Heap {
        var result: Heap=.{}; errdefer result.deinit(c.allocator); var iterator=source.iterator();
        while(iterator.next()) |entry| { _=try result.put(c,entry.slot,entry.value,true); } return result;
    }
    pub fn join(self: *Heap, c: *Context, source: HeapView) Error!bool {
        var changed=false; var iterator=source.iterator();
        while(iterator.next()) |entry| { if(try self.put(c,entry.slot,entry.value,false))changed=true; } return changed;
    }
};
pub const HeapView = struct {
    heap: *const Heap,
    // Borrowed selected current-version heap, when the same state has one.
    // Its lifetime is exactly the lifetime of this raw heap view.
    relations: ?*const data.Heap=null,
    pub fn get(self: HeapView, slot: Slot) ?Value {
        const value=self.heap.entries.getPtr(slot) orelse return null; return value.view();
    }
    pub const Entry = struct {slot: Slot,value: Value};
    pub const Iterator = struct {
        inner: std.AutoHashMapUnmanaged(Slot,OwnedValue).Iterator,
        pub fn next(self: *Iterator) ?Entry {
            const entry=self.inner.next() orelse return null; return .{.slot=entry.key_ptr.*,.value=entry.value_ptr.view()};
        }
    };
    pub fn iterator(self: HeapView) Iterator { return .{.inner=self.heap.entries.iterator()}; }
};
pub const ValuesView = struct {
    values: []const OwnedValue,
    pub fn len(self: ValuesView) usize { return self.values.len; }
    pub fn get(self: ValuesView, index: usize) Value { return self.values[index].view(); }
    pub fn reg(self: ValuesView, ref: t.RegisterRef) Value { return self.get(@intFromEnum(ref)); }
};
pub const StateView = struct {values: ValuesView,heap: HeapView,relations:?*const data.Heap=null};
pub const ContextInfo = struct {
    function: t.FunctionRef,
    // SSA entry-block arguments: Common includes hidden env/receiver, legacy
    // has one value per logical domain parameter plus a closure hidden env,
    // EH is the demarshalled
    // parameter+capture slots, not the one physical frame-pointer parameter.
    arguments: ValuesView,
    entry: HeapView,
    root: bool,
    repeated: bool,
    // An unresolved external argument/call is an absence of actual facts, not
    // an empty code set and not every function that happens to be in a module.
    unresolved: bool,
    region_scope: ?data.ScopeRef=null,
};
pub const WorldView = struct {
    objects: []const ObjectInfo,
    cells: []const CellInfo,
    contexts: []const ContextInfo,
    region_nodes: []const data.Node=&.{},
    region_scopes: []const data.Scope=&.{},
    pub fn object(self: WorldView, ref: ObjectId) ObjectInfo { return self.objects[@intFromEnum(ref)]; }
    pub fn cell(self: WorldView, ref: CellId) CellInfo { return self.cells[@intFromEnum(ref)]; }
    pub fn invocation(self: WorldView, ref: ContextId) ContextInfo { return self.contexts[@intFromEnum(ref)]; }
};
pub const CallEdge = struct {
    caller: Site,
    callee: ContextId,
    normal: Location,
    language: ?Location,
};
pub const Completion = enum { normal, language, request_trap };
pub const Observer = struct {
    // Views are borrowed for this callback only, until the next solver
    // mutation. Observers retain their own derived observations, not pointers.
    // Conventional callback client data, not a VM or a verified opaque value.
    client: *anyopaque,
    before: ?*const fn(*anyopaque,*Context,WorldView,Site,StateView) Error!void=null,
    after: ?*const fn(*anyopaque,*Context,WorldView,Site,StateView) Error!void=null,
    edge: ?*const fn(*anyopaque,*Context,WorldView,Site,Location) Error!void=null,
    call: ?*const fn(*anyopaque,*Context,WorldView,CallEdge) Error!void=null,
    completed: ?*const fn(*anyopaque,*Context,WorldView,Site,Completion,Value,HeapView) Error!void=null,
};
