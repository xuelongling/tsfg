// SPDX-License-Identifier: MIT
// Constructor-control abstract state, shared by the existing actual solver.
// No evaluator, Context, work pool, parser, Program/State/VM or trusted receipt.
const std = @import("std");
const model = @import("wire-program-model.zig");
const facts = @import("wire-program-actual-facts.zig");
const t = model.types;
const Context = facts.Context;
pub const Error = facts.Error;
pub const Store = facts.FrameStore;
pub const Binding = facts.FrameState;
const V = facts.OwnedValue;

// Ownership moves only after all fallible work succeeds. At a growth boundary
// prepay old metadata scanning, new metadata initialization and entry rehash.
// FrameStore never deletes entries; the qualified std map exposes `available`.
fn insertNew(c: *Context, store: *Store, id: facts.FrameId, value: Binding) Error!void {
    try c.step();
    if(store.entries.available==0) {
        const previous=store.entries.capacity(); const next=@max(@as(usize,8),@as(usize,previous)*2);
        try c.charge(previous+next+store.entries.count()+1);
        try store.entries.ensureUnusedCapacity(c.allocator,1);
    }
    store.entries.putAssumeCapacityNoClobber(id,value);
}

pub fn deinit(store: *Store, allocator: std.mem.Allocator) void {
    var values = store.entries.valueIterator(); while (values.next()) |value| value.bound.deinit(allocator);
    store.entries.deinit(allocator); store.* = .{};
}
pub fn copyBinding(c: *Context, source: *const Binding) Error!Binding {
    try c.charge(7); var result = source.*; result.bound = try V.clone(c, source.bound.view()); return result;
}
pub fn equal(c: *Context, a: *const Store, b: *const Store) Error!bool {
    try c.step(); if (a.entries.count() != b.entries.count()) return false;
    var iterator = a.entries.iterator();
    while (iterator.next()) |row| {
        try c.step(); const other = b.entries.getPtr(row.key_ptr.*) orelse return false; const value = row.value_ptr;
        try c.charge(7);
        // Context keys ignore the same lexical effect tokens as Engine.dataEqual.
        var left=value.bound.view(); var right=other.bound.view(); left.effect_origins=&.{}; right.effect_origins=&.{};
        if (value.unbound != other.unbound or value.unresolved != other.unresolved or value.initializing != other.initializing or value.aborted != other.aborted or value.prefix_min != other.prefix_min or value.prefix_max != other.prefix_max or !try facts.equal(c, left, right)) return false;
    }
    return true;
}
pub fn overlay(c: *Context, into: *Store, source: *const Store) Error!void {
    if (into == source) return;
    var iterator = source.entries.iterator();
    while (iterator.next()) |row| {
        try c.step(); var copied = try copyBinding(c, row.value_ptr); errdefer copied.bound.deinit(c.allocator);
        if(into.entries.getPtr(row.key_ptr.*)) |old| {
            old.bound.deinit(c.allocator); old.*=copied;
        } else try insertNew(c,into,row.key_ptr.*,copied);
    }
}
pub fn clone(c: *Context, source: *const Store) Error!Store {
    var result: Store = .{}; errdefer deinit(&result, c.allocator); try overlay(c, &result, source); return result;
}
pub fn join(c: *Context, into: *Store, source: *const Store) Error!bool {
    if (into == source) return false;
    var changed = false; var iterator = source.entries.iterator();
    while (iterator.next()) |row| {
        try c.step(); const value = into.entries.getPtr(row.key_ptr.*) orelse {
            var copied=try copyBinding(c,row.value_ptr); errdefer copied.bound.deinit(c.allocator);
            try insertNew(c,into,row.key_ptr.*,copied); changed=true; continue;
        };
        const incoming = row.value_ptr;
        if (try value.bound.join(c, incoming.bound.view())) changed = true;
        try c.charge(7);
        const unbound = value.unbound or incoming.unbound; const unresolved = value.unresolved or incoming.unresolved;
        const initializing = value.initializing or incoming.initializing; const aborted = value.aborted or incoming.aborted;
        const minimum = @min(value.prefix_min, incoming.prefix_min); const maximum = @max(value.prefix_max, incoming.prefix_max);
        changed = changed or unbound != value.unbound or unresolved != value.unresolved or initializing != value.initializing or aborted != value.aborted or minimum != value.prefix_min or maximum != value.prefix_max;
        value.unbound = unbound; value.unresolved = unresolved; value.initializing = initializing; value.aborted = aborted; value.prefix_min = minimum; value.prefix_max = maximum;
    }
    return changed;
}
pub fn select(c: *Context, source: *const Store, arguments: []const V) Error!Store {
    var result: Store = .{}; errdefer deinit(&result, c.allocator);
    for (arguments) |argument| for (argument.frames.items) |id| {
        try c.step(); if (result.entries.contains(id)) continue;
        const value = source.entries.getPtr(id) orelse continue;
        var copied = try copyBinding(c, value); errdefer copied.bound.deinit(c.allocator);
        try insertNew(c,&result,id,copied);
    };
    return result;
}
pub fn retained(c: *Context, store: *const Store, arguments: []const V) Error!V {
    var roots: V = .{}; errdefer roots.deinit(c.allocator);
    for (arguments) |argument| for (argument.frames.items) |id| {
        try c.step(); if (store.entries.getPtr(id)) |value| _ = try roots.join(c, value.bound.view());
    };
    return roots;
}
pub fn birth(c: *Context, store: *Store, id: facts.FrameId, weak: bool) Error!void {
    try c.step();
    if(store.entries.getPtr(id)) |old| {
        if (weak) { old.unbound = true; old.unresolved = true; return; }
        old.bound.deinit(c.allocator); old.*=.{.unresolved=weak};
    } else try insertNew(c,store,id,.{.unresolved=weak});
}
pub fn bind(c: *Context, store: *Store, id: facts.FrameId, selected: facts.Value) Error!void {
    // This owning conversion stores data in a control frame; it never turns
    // another Frame or initializer cursor into a language payload.
    try c.require(selected.frames.len==0 and selected.cursors.len==0);
    const old = store.entries.getPtr(id) orelse return error.InvalidShape;
    const copied = try V.clone(c, selected); old.bound.deinit(c.allocator); old.bound = copied;
    old.unbound = false; old.initializing = false; old.aborted = false; old.prefix_min = 0; old.prefix_max = 0;
}
// Only the final actual replay calls this accumulator. Each store belongs to
// one analysis context; unrelated nested frames remain distinct map entries.
// Values come only from the actual FrameState, never a view/capacity/upper.
pub fn observeLifetimes(c: *Context, into: *facts.ReceiverLifetimes, world: facts.WorldView,
    context: facts.ContextId, source: *const Store, phase: facts.ReceiverPhase) Error!void {
    try c.charge(2); const invocation=&world.contexts[@intFromEnum(context)];
    into.unresolved=into.unresolved or invocation.unresolved;
    var iterator=source.entries.iterator();
    while(iterator.next()) |entry| {
        try c.charge(2); const binding=entry.value_ptr; const info=&world.frames[@intFromEnum(entry.key_ptr.*)];
        var row=into.entries.getPtr(entry.key_ptr.*);
        if(row==null) {
            var created=facts.ReceiverLifetime{.payload=try V.clone(c,binding.bound.view())};
            errdefer created.payload.deinit(c.allocator);
            try c.step();
            if(into.entries.available==0) {
                const previous=into.entries.capacity(); const next=@max(@as(usize,8),@as(usize,previous)*2);
                try c.charge(previous+next+into.entries.count()+1);
                try into.entries.ensureUnusedCapacity(c.allocator,1);
            }
            into.entries.putAssumeCapacityNoClobber(entry.key_ptr.*,created);
            row=into.entries.getPtr(entry.key_ptr.*);
        } else _=try row.?.payload.join(c,binding.bound.view());
        try c.charge(4); const saved=row.?;
        saved.unbound=saved.unbound or binding.unbound;
        saved.unresolved=saved.unresolved or binding.unresolved or invocation.unresolved;
        saved.weak=saved.weak or info.weak or invocation.repeated;
        switch(phase) { .entry=>saved.phases.entry=true, .prefix=>saved.phases.prefix=true,
            .normal=>saved.phases.normal=true, .language=>saved.phases.language=true, .request_trap=>saved.phases.request_trap=true }
    }
}
pub fn abortInitializers(c: *Context, store: *Store) Error!void {
    var values = store.entries.valueIterator(); while (values.next()) |value| {
        try c.step(); if (value.initializing) { value.initializing = false; value.aborted = true; }
    }
}
pub fn advance(c: *Context, store: *Store, token: facts.Cursor, end: bool) Error!void {
    try c.step(); const value = store.entries.getPtr(token.frame) orelse return error.InvalidShape;
    if (end) value.initializing = false else {
        value.initializing = true; value.prefix_min = token.position; value.prefix_max = token.position;
    }
}
pub const ReturnKind = enum { object, primitive, pending };
pub fn objectKind(c: *Context, tag: t.TypeRef) Error!ReturnKind {
    try c.step(); if (c.program.tables.mode != .common) return error.WrongMode;
    // This is the semantic actual-kind directory, NOT physical GC/managedness.
    // String, null and all scalar primitives are not constructor object returns.
    return switch (c.program.tables.mode.common.types[@intFromEnum(tag)].kind) {
        .reference, .value, .array, .function => .object,
        .readSpan => .pending, // Borrow-view contract does not prove JS Object classification.
        .scalar, .string, .@"undefined", .@"null", .@"void" => .primitive,
        else => return error.InvalidShape,
    };
}
pub fn objectsOnly(c: *Context, world: facts.WorldView, input: facts.Value) Error!V {
    var result = try V.clone(c, input); errdefer result.deinit(c.allocator);
    result.tags.clearRetainingCapacity(); result.objects.clearRetainingCapacity();
    for (input.tags) |tag| if (try objectKind(c, tag) != .primitive) { _ = try result.tag(c, tag); };
    for (input.objects) |id| {
        try c.step(); const tag = world.object(id).@"type" orelse continue;
        if (try objectKind(c, tag) != .primitive) _ = try result.object(c, id);
    }
    // A split cannot recover per-alternative allocation-version correlation.
    if (result.tags.items.len != input.tags.len) { result.region.unresolved = true; result.region.roots.clearRetainingCapacity(); }
    if (result.view().bottom()) { result.region.deinit(c.allocator); result.effect_origins.clearRetainingCapacity(); }
    return result;
}
