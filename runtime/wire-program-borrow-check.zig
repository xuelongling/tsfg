// SPDX-License-Identifier: MIT
// Static borrowing of an already reference/layout/SSA/identity-checked Program.
// Actual owner observations must come from the shared typed data-flow solve;
// neither a serialized effect table nor a type/family label proves an instance.
// Feed observer() only the shared solve's final replay, then call finish().
// RegionDomain/Holding and multi-context creation-component proofs are not
// supplied here: obligations needing them remain conservative failures.
const std = @import("std");
const context = @import("wire-program-refcheck-context.zig");
const facts = @import("wire-program-actual-facts.zig");
const model = @import("wire-program-model.zig");
const Context = context.Context;
const t = model.types;
pub const Error = context.Error;

const Set = std.AutoHashMapUnmanaged(usize, void);
const Evidence = struct { owners: []const usize, pending: bool };
const Sharing = enum { disjoint, may_share, unknown };
const OwnerPair = struct { first: usize, second: usize };
const Binding = struct { parameter: usize, argument: usize };
const Value = struct { owners: []usize, pending: bool, definition: ?usize = null };
const Point = struct {
    parameters: Set = .empty,
    definitions: Set = .empty,
    uses: Set = .empty,
    live: Set = .empty,
    incoming: std.ArrayListUnmanaged(usize) = .empty,
    outgoing: std.ArrayListUnmanaged(usize) = .empty,
    fn deinit(self: *Point, allocator: std.mem.Allocator) void {
        self.parameters.deinit(allocator); self.definitions.deinit(allocator);
        self.uses.deinit(allocator); self.live.deinit(allocator);
        self.incoming.deinit(allocator); self.outgoing.deinit(allocator);
    }
};
const Edge = struct { from: usize, to: usize, bindings: std.AutoHashMapUnmanaged(usize, usize) = .empty };
const Effect = struct { point: usize, owners: []usize, pending: bool, eligible: ?Set };

// Same finite backward-liveness equations as finite::BorrowFlow. Descriptors
// and owners have different identities: an edge binds descriptor values while
// sharing relates the independently reconstructed owner instances.
const Flow = struct {
    c: *Context,
    points: std.ArrayListUnmanaged(Point) = .empty,
    values: std.ArrayListUnmanaged(Value) = .empty,
    edges: std.ArrayListUnmanaged(Edge) = .empty,
    effects: std.ArrayListUnmanaged(Effect) = .empty,
    relations: std.AutoHashMapUnmanaged(OwnerPair, Sharing) = .empty,

    fn deinit(self: *Flow) void {
        const a = self.c.allocator;
        for (self.points.items) |*point| point.deinit(a);
        for (self.values.items) |value| a.free(value.owners);
        for (self.edges.items) |*edge| edge.bindings.deinit(a);
        for (self.effects.items) |*effect| { a.free(effect.owners); if (effect.eligible) |*eligible| eligible.deinit(a); }
        self.points.deinit(a); self.values.deinit(a); self.edges.deinit(a);
        self.effects.deinit(a); self.relations.deinit(a);
    }
    fn addPoint(self: *Flow) Error!usize {
        try self.c.step(); const id = self.points.items.len;
        try self.points.append(self.c.allocator, .{}); return id;
    }
    fn addValue(self: *Flow, evidence: Evidence) Error!usize {
        try self.c.charge(1 + evidence.owners.len);
        const owners = try self.c.allocator.dupe(usize, evidence.owners);
        errdefer self.c.allocator.free(owners);
        const id = self.values.items.len;
        try self.values.append(self.c.allocator, .{ .owners = owners, .pending = evidence.pending }); return id;
    }
    fn define(self: *Flow, at: usize, id: usize, parameter: bool) Error!void {
        try self.c.require(self.values.items[id].definition == null);
        self.values.items[id].definition = at;
        const point = &self.points.items[at];
        if (parameter) try point.parameters.put(self.c.allocator, id, {})
        else try point.definitions.put(self.c.allocator, id, {});
    }
    fn use(self: *Flow, at: usize, id: usize) Error!void {
        try self.c.step(); try self.points.items[at].uses.put(self.c.allocator, id, {});
    }
    fn addEdge(self: *Flow, from: usize, to: usize, bindings: []const Binding) Error!void {
        try self.c.step(); var edge = Edge{ .from = from, .to = to };
        errdefer edge.bindings.deinit(self.c.allocator);
        for (bindings) |binding| {
            try self.c.require(self.points.items[to].parameters.contains(binding.parameter));
            try self.c.require(binding.argument < self.values.items.len);
            const entry = try edge.bindings.getOrPut(self.c.allocator, binding.parameter);
            try self.c.require(!entry.found_existing); entry.value_ptr.* = binding.argument;
        }
        try self.c.require(edge.bindings.count() == self.points.items[to].parameters.count());
        const id = self.edges.items.len;
        // Reserve first: after ownership is transferred no fallible operation
        // may leave an edge map owned both here and by edges.
        try self.edges.ensureUnusedCapacity(self.c.allocator, 1);
        try self.points.items[from].outgoing.ensureUnusedCapacity(self.c.allocator, 1);
        try self.points.items[to].incoming.ensureUnusedCapacity(self.c.allocator, 1);
        self.edges.appendAssumeCapacity(edge);
        self.points.items[from].outgoing.appendAssumeCapacity(id);
        self.points.items[to].incoming.appendAssumeCapacity(id);
    }
    fn addEffect(self: *Flow, at: usize, evidence: Evidence, restriction: ?[]const usize) Error!void {
        try self.c.charge(1 + evidence.owners.len);
        const owners = try self.c.allocator.dupe(usize, evidence.owners);
        errdefer self.c.allocator.free(owners);
        var eligible: ?Set = if (restriction != null) .empty else null;
        errdefer if (eligible) |*set| set.deinit(self.c.allocator);
        if (restriction) |ids| for (ids) |id| {
            try self.c.require(id < self.values.items.len);
            try eligible.?.put(self.c.allocator, id, {});
        };
        try self.effects.append(self.c.allocator, .{ .point = at, .owners = owners, .pending = evidence.pending, .eligible = eligible });
    }
    fn sharing(self: *Flow, a: usize, b: usize, relation: Sharing) Error!void {
        try self.c.require(a != b or relation == .may_share);
        const pair = OwnerPair{ .first = @min(a, b), .second = @max(a, b) };
        const entry = try self.relations.getOrPut(self.c.allocator, pair);
        if (entry.found_existing) try self.c.require(entry.value_ptr.* == relation)
        else entry.value_ptr.* = relation;
    }
    fn solve(self: *Flow) Error!void {
        const c = self.c;
        for (self.values.items) |value| { try c.step(); try c.require(value.definition != null); }
        if (self.effects.items.len == 0) return;
        var work: std.ArrayListUnmanaged(usize) = .empty; defer work.deinit(c.allocator);
        try c.charge(self.points.items.len);
        const queued = try c.allocator.alloc(bool, self.points.items.len); defer c.allocator.free(queued);
        @memset(queued, true);
        for (self.points.items, 0..) |*point, id| {
            try c.step(); try work.append(c.allocator, id);
            var uses = point.uses.keyIterator();
            while (uses.next()) |value| { try c.step(); try point.live.put(c.allocator, value.*, {}); }
        }
        var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try c.step(); const id = work.items[cursor]; queued[id] = false; var changed = false;
            const point = &self.points.items[id];
            // Collect before mutating live: loop/phi self-edges may otherwise
            // invalidate their own HashMap iterator while adding a binding.
            var inherited: Set = .empty; defer inherited.deinit(c.allocator);
            for (point.outgoing.items) |edge_id| {
                try c.step(); const edge = &self.edges.items[edge_id];
                var next = self.points.items[edge.to].live.keyIterator();
                while (next.next()) |value| {
                    try c.step(); const input = edge.bindings.get(value.*) orelse value.*;
                    if (!point.definitions.contains(input)) try inherited.put(c.allocator, input, {});
                }
            }
            var inputs = inherited.keyIterator();
            while (inputs.next()) |input| {
                try c.step(); const entry = try point.live.getOrPut(c.allocator, input.*);
                changed = !entry.found_existing or changed;
            }
            if (changed) for (point.incoming.items) |edge_id| {
                try c.step(); const prior = self.edges.items[edge_id].from;
                if (!queued[prior]) { try work.append(c.allocator, prior); queued[prior] = true; }
            };
        }
        for (self.effects.items) |effect| {
            try c.step(); var live = self.points.items[effect.point].live.keyIterator();
            while (live.next()) |id| {
                try c.step(); if (effect.eligible) |set| { if (!set.contains(id.*)) continue; }
                const value = self.values.items[id.*];
                // Missing evidence is pending, never separation authority.
                try c.require(!value.pending and !effect.pending and value.owners.len != 0 and effect.owners.len != 0);
                for (value.owners) |a| for (effect.owners) |b| {
                    try c.step(); const pair = OwnerPair{ .first = @min(a, b), .second = @max(a, b) };
                    const relation = if (a == b) Sharing.may_share else self.relations.get(pair) orelse .unknown;
                    try c.require(relation == .disjoint);
                };
            }
        }
    }
};

// A compact projection of current owning storage, not the actual heap itself.
// The adapter excludes Span.owner and keeps independent fields simultaneous;
// alternatives within one selected field meet rather than lend each other an
// owner. Weak/unclosed prefixes and opaque alternatives cannot prove survival.
const HoldingValue = struct {
    alternatives: []const usize,
    complete: bool,
    empty: bool,
    unresolved_alternative: bool,
    nonowning: bool = false,
};
const HoldingNode = struct {
    object: usize,
    kind: enum { array, reference, value, environment, span, other },
    weak: bool,
    complete: bool,
    closed_environment: bool,
    fields: []const HoldingValue,
};
const Holding = struct {
    c: *Context,
    nodes: []const HoldingNode,
    root: HoldingValue,
    stable_projection: bool,
    node_indexes: std.AutoHashMapUnmanaged(usize, usize) = .empty,

    fn merge(self: *Holding, into: *Set, from: *const Set) Error!bool {
        var changed = false; var keys = from.keyIterator();
        while (keys.next()) |key| {
            try self.c.step(); const entry = try into.getOrPut(self.c.allocator, key.*);
            changed = !entry.found_existing or changed;
        }
        return changed;
    }
    fn meet(self: *Holding, into: *Set, first: *bool, next: *const Set) Error!void {
        if (first.*) { _ = try self.merge(into, next); first.* = false; return; }
        var intersection: Set = .empty; errdefer intersection.deinit(self.c.allocator);
        var keys = into.keyIterator();
        while (keys.next()) |key| {
            try self.c.step(); if (next.contains(key.*)) try intersection.put(self.c.allocator, key.*, {});
        }
        into.deinit(self.c.allocator); into.* = intersection;
    }
    fn must(self: *Holding, value: HoldingValue, owned: []const Set) Error!Set {
        var result: Set = .empty; errdefer result.deinit(self.c.allocator);
        if (!value.complete or value.empty) return result;
        var first = true;
        for (value.alternatives) |object| {
            try self.c.step(); const index = self.node_indexes.get(object) orelse {
                result.deinit(self.c.allocator); return .empty;
            };
            try self.meet(&result, &first, &owned[index]);
        }
        return result;
    }
    fn relevant(self: *Holding, value: HoldingValue, reaches: []const bool) Error!bool {
        if (value.unresolved_alternative) return true;
        for (value.alternatives) |object| {
            try self.c.step(); if (self.node_indexes.get(object)) |index| { if (reaches[index]) return true; }
        }
        return false;
    }
    fn selected(self: *Holding, value: HoldingValue, reaches: []const bool, conditional: []const Set) Error!Set {
        var result: Set = .empty; errdefer result.deinit(self.c.allocator);
        // An opaque alternative is relevant and contributes an empty meet.
        var first = !value.unresolved_alternative;
        for (value.alternatives) |object| {
            try self.c.step(); const index = self.node_indexes.get(object) orelse continue;
            if (reaches[index]) try self.meet(&result, &first, &conditional[index]);
        }
        return result;
    }
    fn solve(self: *Holding, descriptor: ?usize) Error!Set {
        const c = self.c; defer self.node_indexes.deinit(c.allocator);
        try c.charge(self.nodes.len * 4);
        const owned = try c.allocator.alloc(Set, self.nodes.len);
        @memset(owned, .empty); defer { for (owned) |*set| set.deinit(c.allocator); c.allocator.free(owned); }
        const permitted = try c.allocator.alloc(bool, self.nodes.len); defer c.allocator.free(permitted);
        var array_count: usize = 0;
        for (self.nodes, 0..) |node, i| {
            try c.step(); const entry = try self.node_indexes.getOrPut(c.allocator, node.object);
            try c.require(!entry.found_existing); entry.value_ptr.* = i;
            permitted[i] = node.complete and !node.weak and switch (node.kind) {
                .array, .reference, .value => true, .environment => node.closed_environment, else => false,
            };
            if (permitted[i] and node.kind == .array) array_count += 1;
        }
        var changed = true;
        while (changed) {
            changed = false;
            for (self.nodes, 0..) |node, i| {
                try c.step(); if (!permitted[i]) continue;
                var next: Set = .empty; defer next.deinit(c.allocator);
                if (node.kind == .array) { try c.step(); try next.put(c.allocator, node.object, {}); }
                for (node.fields) |field| {
                    try c.step(); if (self.stable_projection and field.nonowning) continue;
                    var child = try self.must(field, owned); defer child.deinit(c.allocator);
                    _ = try self.merge(&next, &child);
                }
                changed = (try self.merge(&owned[i], &next)) or changed;
            }
        }
        var common = try self.must(self.root, owned); errdefer common.deinit(c.allocator);
        if (descriptor == null or common.count() == array_count) return common;
        // These separate least fixed points retain descriptor-path correlation.
        // A cycle starts empty and cannot bootstrap its own owning guarantee.
        const reaches = try c.allocator.alloc(bool, self.nodes.len); defer c.allocator.free(reaches);
        @memset(reaches, false);
        if (self.node_indexes.get(descriptor.?)) |index| reaches[index] = true;
        changed = true;
        while (changed) {
            changed = false;
            for (self.nodes, 0..) |node, i| {
                try c.step(); if (reaches[i]) continue;
                for (node.fields) |field| {
                    try c.step(); if (try self.relevant(field, reaches)) { reaches[i] = true; changed = true; break; }
                }
            }
        }
        try c.charge(self.nodes.len);
        const conditional = try c.allocator.alloc(Set, self.nodes.len);
        @memset(conditional, .empty); defer { for (conditional) |*set| set.deinit(c.allocator); c.allocator.free(conditional); }
        changed = true;
        while (changed) {
            changed = false;
            for (self.nodes, 0..) |node, i| {
                try c.step(); if (!permitted[i] or !reaches[i]) continue;
                var next: Set = .empty; defer next.deinit(c.allocator); var first = true;
                for (node.fields) |field| {
                    try c.step(); if (!(try self.relevant(field, reaches))) continue;
                    var child = try self.selected(field, reaches, conditional); defer child.deinit(c.allocator);
                    try self.meet(&next, &first, &child);
                }
                _ = try self.merge(&next, &owned[i]);
                changed = (try self.merge(&conditional[i], &next)) or changed;
            }
        }
        var result = try self.selected(self.root, reaches, conditional); errdefer result.deinit(c.allocator);
        _ = try self.merge(&result, &common); common.deinit(c.allocator); return result;
    }
};

const Collected = struct {
    ids: Set = .empty,
    pending: bool = false,
    fn deinit(self: *Collected, allocator: std.mem.Allocator) void { self.ids.deinit(allocator); }
    fn merge(self: *Collected, c: *Context, other: *const Collected) Error!void {
        try c.step(); self.pending = self.pending or other.pending;
        var iterator = other.ids.keyIterator();
        while (iterator.next()) |id| { try c.step(); try self.ids.put(c.allocator, id.*, {}); }
    }
};
const Scan = enum { use, escape, arrays, owning };
fn slotObject(slot: facts.Slot) ?facts.ObjectId {
    return switch (slot) {
        .field => |v| v.object, .element => |v| v.object, .environment_slot => |v| v.object, .capture => |v| v.object,
        .length, .span_owner, .span_start, .span_length, .parent => |v| v,
        .cell, .global => null,
    };
}
fn spanOwners(c: *Context, world: facts.WorldView, heap: facts.HeapView, span: facts.ObjectId) Error!Collected {
    try c.step(); var result: Collected = .{}; errdefer result.deinit(c.allocator);
    const value = heap.get(.{ .span_owner = span }) orelse { result.pending = true; return result; };
    result.pending = value.unknown or value.callable_unknown or value.cells.len != 0 or value.callables.len != 0;
    for (value.objects) |object| {
        try c.step(); if (world.object(object).kind == .array) try result.ids.put(c.allocator, @intFromEnum(object), {})
        else result.pending = true;
    }
    result.pending = result.pending or result.ids.count() == 0; return result;
}
fn collect(c: *Context, world: facts.WorldView, initial: facts.Value, heap: facts.HeapView, mode: Scan, deep: bool) Error!Collected {
    var result: Collected = .{}; errdefer result.deinit(c.allocator);
    var seen: Set = .empty; defer seen.deinit(c.allocator);
    var cells: std.AutoHashMapUnmanaged(facts.CellId, void) = .empty; defer cells.deinit(c.allocator);
    var pending: std.ArrayListUnmanaged(facts.Value) = .empty; defer pending.deinit(c.allocator);
    try pending.append(c.allocator, initial);
    var cursor: usize = 0;
    while (cursor < pending.items.len) : (cursor += 1) {
        try c.step(); const value = pending.items[cursor];
        result.pending = result.pending or value.unknown or value.callable_unknown;
        var roots: std.ArrayListUnmanaged(facts.ObjectId) = .empty; defer roots.deinit(c.allocator);
        try c.charge(value.objects.len); try roots.appendSlice(c.allocator, value.objects);
        if (deep) {
            for (value.cells) |cell| {
                try c.step(); const entry = try cells.getOrPut(c.allocator, cell);
                if (!entry.found_existing) {
                    if (heap.get(.{ .cell = cell })) |stored| try pending.append(c.allocator, stored)
                    else result.pending = true;
                }
            }
            if (mode != .use) for (value.callables) |pair| {
                try c.step(); if (pair.environment) |environment| try roots.append(c.allocator, environment)
                else if (requiresEnvironment(c, pair.code)) result.pending = true;
            };
        }
        for (roots.items) |object| {
            try c.step(); const entry = try seen.getOrPut(c.allocator, @intFromEnum(object));
            if (entry.found_existing) continue;
            const info = world.object(object);
            if (info.kind == .read_span) {
                switch (mode) {
                    .use, .escape => try result.ids.put(c.allocator, @intFromEnum(object), {}),
                    .arrays => { var owners = try spanOwners(c, world, heap, object); defer owners.deinit(c.allocator); try result.merge(c, &owners); },
                    .owning => {}, // Span.owner is deliberately not an owning path.
                }
                continue;
            }
            if (info.kind == .array and (mode == .arrays or mode == .owning)) {
                try result.ids.put(c.allocator, @intFromEnum(object), {});
                if (mode == .arrays) continue;
            }
            if (!deep or (info.kind == .environment and mode == .use)) continue;
            var slots = heap.iterator();
            while (slots.next()) |stored| {
                try c.step(); if (slotObject(stored.slot) != object) continue;
                const follow = switch (stored.slot) {
                    .field, .element => info.kind != .environment,
                    .environment_slot, .capture, .parent => info.kind == .environment,
                    else => false,
                };
                if (follow) try pending.append(c.allocator, stored.value);
            }
        }
    }
    return result;
}

const DefinitionKey = struct { point: usize, descriptor: usize };
const ContextRecord = struct {
    entry: usize,
    incoming_owners: Set = .empty,
    normal: Set = .empty,
    language: Set = .empty,
    fn deinit(self: *ContextRecord, allocator: std.mem.Allocator) void {
        self.incoming_owners.deinit(allocator); self.normal.deinit(allocator); self.language.deinit(allocator);
    }
};
const FlowEdge = struct { from: usize, to: usize };
const Capture = struct { layout: t.EnvironmentRef, slot: t.EnvironmentSlotRef };
const StableStore = struct {
    point: usize,
    descriptors: Set = .empty,
    local_owners: Set = .empty,
    receivers: Set = .empty,
    fn deinit(self: *StableStore, allocator: std.mem.Allocator) void {
        self.descriptors.deinit(allocator); self.local_owners.deinit(allocator); self.receivers.deinit(allocator);
    }
};
const Boundary = struct {
    permitted: Set = .empty,
    connected: Set = .empty,
    existing: Set = .empty,
    arguments: Set = .empty,
    owners: Collected = .{},
    conservative: bool = false,
    escaping: bool = false,
    ordered: bool = false,
    fn deinit(self: *Boundary, allocator: std.mem.Allocator) void {
        self.permitted.deinit(allocator); self.connected.deinit(allocator);
        self.existing.deinit(allocator); self.arguments.deinit(allocator); self.owners.deinit(allocator);
    }
};

const Projection = struct {
    arena: std.heap.ArenaAllocator,
    nodes: std.ArrayListUnmanaged(HoldingNode) = .empty,
    root: HoldingValue = undefined,
    fn deinit(self: *Projection) void { self.arena.deinit(); }
    fn value(self: *Projection, c: *Context, value_in: facts.Value) Error!HoldingValue {
        var alternatives: Set = .empty; defer alternatives.deinit(c.allocator);
        var empty = false; var complete = !value_in.unknown and !value_in.callable_unknown and value_in.cells.len == 0;
        for (value_in.tags) |tag| {
            try c.step(); const permitted = switch (c.program.tables.mode) {
                .common => |v| switch (v.types[@intFromEnum(tag)].kind) { .array, .reference, .value, .function => true, else => false },
                .legacy => |v| switch (v.types[@intFromEnum(tag)].kind) { .array, .reference, .value, .function => true, else => false },
                .exception => |v| v.types[@intFromEnum(tag)].kind == .aggregate,
            };
            complete = complete and permitted;
        }
        for (value_in.objects) |object| { try c.step(); try alternatives.put(c.allocator, @intFromEnum(object), {}); }
        for (value_in.callables) |pair| {
            try c.step(); if (pair.environment) |environment| try alternatives.put(c.allocator, @intFromEnum(environment), {}) else empty = true;
        }
        try c.charge(alternatives.count()); const ids = try self.arena.allocator().alloc(usize, alternatives.count());
        var iterator = alternatives.keyIterator(); var i: usize = 0;
        while (iterator.next()) |id| : (i += 1) ids[i] = id.*;
        return .{ .alternatives = ids, .complete = complete, .empty = empty or ids.len == 0, .unresolved_alternative = value_in.unknown or value_in.callable_unknown };
    }
    fn build(self: *Projection, c: *Context, world: facts.WorldView, value_in: facts.Value, heap: facts.HeapView, stable: bool) Error!void {
        self.root = try self.value(c, value_in);
        var seen: Set = .empty; defer seen.deinit(c.allocator);
        var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator);
        try c.charge(self.root.alternatives.len); try pending.appendSlice(c.allocator, self.root.alternatives);
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const object: facts.ObjectId = @enumFromInt(pending.items[cursor]);
            const entry = try seen.getOrPut(c.allocator, @intFromEnum(object)); if (entry.found_existing) continue;
            const info = world.object(object);
            var node = HoldingNode{ .object = @intFromEnum(object), .kind = switch (info.kind) {
                .array => .array, .reference => .reference, .value => .value, .environment => .environment, .read_span => .span,
            }, .weak = info.weak or info.creations.len != 1 or (info.creations.len == 1 and world.invocation(info.creations[0].context).repeated), .complete = true, .closed_environment = false, .fields = &.{} };
            if (stable and (info.kind == .reference or info.kind == .value)) {
                node.complete = if (info.@"type") |ref| try stableNominal(c, ref, object, heap) else false;
            }
            if (stable and (info.kind == .array or info.kind == .read_span)) {
                const element = if (info.@"type") |ref| switch (c.program.tables.mode) {
                    .common => |v| v.types[@intFromEnum(ref)].element,
                    .legacy => |v| v.types[@intFromEnum(ref)].element,
                    .exception => null,
                } else null;
                node.complete = if (element) |ref| switch (c.program.tables.mode) {
                    .common => |v| v.types[@intFromEnum(ref)].kind == .scalar,
                    .legacy => |v| v.types[@intFromEnum(ref)].kind == .scalar,
                    .exception => false,
                } else false;
                const required: []const facts.Slot = if (info.kind == .array) &.{.{ .length = object }} else
                    &.{ .{ .span_owner = object }, .{ .span_start = object }, .{ .span_length = object } };
                for (required) |slot| {
                    try c.step(); if (heap.get(slot)) |stored| {
                        if (stored.unknown or stored.callable_unknown or stored.bottom() or stored.cells.len != 0 or stored.callables.len != 0) node.complete = false;
                    } else node.complete = false;
                }
            }
            if (info.kind == .environment) {
                // A single strong observed allocation is distinct from a raw
                // site/family. Weak relation-based closure remains unproved.
                if (info.creations.len == 1) node.closed_environment = !world.invocation(info.creations[0].context).repeated;
                if (stable) {
                    if (info.environment) |layout| {
                        const count = switch (c.program.tables.mode) {
                            .common => |v| v.closures.environments[@intFromEnum(layout)].slots.len,
                            .legacy => |v| v.closures.environments[@intFromEnum(layout)].slots.len,
                            .exception => 0,
                        };
                        for (0..count) |i| {
                            try c.step(); const stored = heap.get(.{ .environment_slot = .{ .object = object, .slot = @enumFromInt(i) } });
                            if (stored == null or stored.?.unknown or stored.?.callable_unknown or stored.?.bottom()) node.complete = false;
                        }
                        const parent = switch (c.program.tables.mode) {
                            .common => |v| v.closures.environments[@intFromEnum(layout)].parent,
                            .legacy => |v| v.closures.environments[@intFromEnum(layout)].parent,
                            .exception => null,
                        };
                        if (parent != null) {
                            if (heap.get(.{ .parent = object })) |stored| {
                                if (stored.unknown or stored.callable_unknown or stored.objects.len == 0) node.complete = false;
                            } else node.complete = false;
                        }
                    } else node.complete = false;
                }
            }
            var fields: std.ArrayListUnmanaged(HoldingValue) = .empty;
            var slots = heap.iterator();
            while (slots.next()) |stored| {
                try c.step(); if (slotObject(stored.slot) != object) continue;
                var selected = false; var nonowning = false;
                switch (stored.slot) {
                    .field => |slot| {
                        selected = info.kind == .reference or info.kind == .value;
                        if (stable) nonowning = switch (c.program.tables.mode) {
                            .common => |v| !v.members.fields[@intFromEnum(slot.field)].readonly,
                            .legacy => |v| !v.members.fields[@intFromEnum(slot.field)].readonly,
                            .exception => |v| !v.members.fields[@intFromEnum(slot.field)].readonly,
                        };
                    },
                    .element => |slot| if (info.kind == .array and slot.index != null) {
                        if (heap.get(.{ .length = object })) |length| selected = !length.unknown and length.number != null and slot.index.? >= 0 and slot.index.? < length.number.?;
                    },
                    .environment_slot => |slot| {
                        selected = info.kind == .environment;
                        if (stable and info.environment != null) nonowning = switch (c.program.tables.mode) {
                            .common => |v| v.closures.environments[@intFromEnum(info.environment.?)].slots[@intFromEnum(slot.slot)].writable and
                                (stored.value.unknown or stored.value.objects.len != 0 or stored.value.cells.len != 0 or stored.value.callables.len != 0),
                            .legacy => |v| v.closures.environments[@intFromEnum(info.environment.?)].slots[@intFromEnum(slot.slot)].writable and
                                (stored.value.unknown or stored.value.objects.len != 0 or stored.value.cells.len != 0 or stored.value.callables.len != 0),
                            .exception => false,
                        };
                    },
                    .parent, .capture => selected = info.kind == .environment,
                    else => {}, // In particular, Span.owner is not selected.
                }
                if (!selected) continue;
                var child = try self.value(c, stored.value); child.nonowning = nonowning;
                try fields.append(self.arena.allocator(), child);
                try c.charge(child.alternatives.len); try pending.appendSlice(c.allocator, child.alternatives);
            }
            node.fields = try fields.toOwnedSlice(self.arena.allocator());
            try self.nodes.append(self.arena.allocator(), node);
        }
    }
};
fn requiresEnvironment(c: *Context, function: t.FunctionRef) bool {
    const i = @intFromEnum(function);
    return switch (c.program.tables.mode) {
        .common => |v| v.abis[@intFromEnum(c.program.functions[i].abi)].lexical_environment != null,
        .legacy => |v| v.closures.functions.len != 0 and v.closures.functions[i].lexical_environment != null,
        .exception => |v| v.exceptions.functions[i].captures.len != 0,
    };
}
fn stableNominal(c: *Context, ref: t.TypeRef, object: facts.ObjectId, heap: facts.HeapView) Error!bool {
    var current: ?t.TypeRef = ref;
    while (current) |owner| {
        try c.step(); switch (c.program.tables.mode) {
            inline .common, .legacy => |v| {
                for (v.members.fields, 0..) |field, i| {
                    try c.step(); if (field.owner != owner) continue;
                    if (!field.readonly) return false;
                    const stored = heap.get(.{ .field = .{ .object = object, .field = @enumFromInt(i) } }) orelse return false;
                    if (stored.unknown or stored.callable_unknown or stored.bottom() or stored.cells.len != 0 or stored.callables.len != 0) return false;
                }
                current = v.types[@intFromEnum(owner)].base;
            },
            .exception => return false,
        }
    }
    return true;
}

// Collected from the shared solver's final readonly replay only. This client
// keeps compact events and owning projections, never per-instruction heaps.
// A successful finish is a borrow check, not Source re-admission, execution or
// the separate complete actual-effects-subsumption proof.
pub const Observations = struct {
    c: *Context,
    flow: Flow,
    points: std.AutoHashMapUnmanaged(facts.Site, usize) = .empty,
    contexts: std.AutoHashMapUnmanaged(facts.ContextId, ContextRecord) = .empty,
    definitions: std.AutoHashMapUnmanaged(DefinitionKey, Collected) = .empty,
    uses: std.AutoHashMapUnmanaged(usize, Set) = .empty,
    effects: std.AutoHashMapUnmanaged(usize, Collected) = .empty,
    edges: std.AutoHashMapUnmanaged(FlowEdge, void) = .empty,
    call_successors: std.AutoHashMapUnmanaged(FlowEdge, void) = .empty,
    boundaries: std.AutoHashMapUnmanaged(usize, Boundary) = .empty,
    calls: std.ArrayListUnmanaged(facts.CallEdge) = .empty,
    fresh: Set = .empty,
    external: Set = .empty,
    root_entries_collected: bool = false,
    stable_stores: std.ArrayListUnmanaged(StableStore) = .empty,
    catalogued: bool = false,
    function_indexes: std.AutoHashMapUnmanaged(t.Hash, usize) = .empty,
    global_indexes: std.AutoHashMapUnmanaged(t.Hash, t.GlobalRef) = .empty,
    contract_rows: std.AutoHashMapUnmanaged(usize, usize) = .empty,
    capture_slots: std.AutoHashMapUnmanaged(t.Hash, Capture) = .empty,

    pub fn init(c: *Context) Observations { return .{ .c = c, .flow = .{ .c = c } }; }
    pub fn deinit(self: *Observations) void {
        const a = self.c.allocator;
        var contexts_it = self.contexts.valueIterator(); while (contexts_it.next()) |row| row.deinit(a);
        var definitions_it = self.definitions.valueIterator(); while (definitions_it.next()) |row| row.deinit(a);
        var uses_it = self.uses.valueIterator(); while (uses_it.next()) |row| row.deinit(a);
        var effects_it = self.effects.valueIterator(); while (effects_it.next()) |row| row.deinit(a);
        var boundaries_it = self.boundaries.valueIterator(); while (boundaries_it.next()) |row| row.deinit(a);
        self.points.deinit(a); self.contexts.deinit(a); self.definitions.deinit(a); self.uses.deinit(a);
        self.effects.deinit(a); self.edges.deinit(a); self.call_successors.deinit(a); self.boundaries.deinit(a);
        self.calls.deinit(a); self.fresh.deinit(a); self.external.deinit(a); self.flow.deinit();
        for (self.stable_stores.items) |*stored| stored.deinit(a); self.stable_stores.deinit(a);
        self.function_indexes.deinit(a); self.global_indexes.deinit(a); self.contract_rows.deinit(a); self.capture_slots.deinit(a);
    }
    fn point(self: *Observations, site: facts.Site) Error!usize {
        try self.c.step(); if (self.points.get(site)) |id| return id;
        const id = try self.flow.addPoint(); try self.points.put(self.c.allocator, site, id); return id;
    }
    fn connect(self: *Observations, from: usize, to: usize) Error!void {
        try self.c.step(); try self.edges.put(self.c.allocator, .{ .from = from, .to = to }, {});
    }
    fn defineSpan(self: *Observations, world: facts.WorldView, at: usize, span: facts.ObjectId, heap: facts.HeapView) Error!void {
        var owners = try spanOwners(self.c, world, heap, span); defer owners.deinit(self.c.allocator);
        try self.c.step(); const entry = try self.definitions.getOrPut(self.c.allocator, .{ .point = at, .descriptor = @intFromEnum(span) });
        if (!entry.found_existing) entry.value_ptr.* = .{};
        try entry.value_ptr.merge(self.c, &owners);
    }
    fn addUses(self: *Observations, at: usize, descriptors: *const Set) Error!void {
        try self.c.step(); const entry = try self.uses.getOrPut(self.c.allocator, at);
        if (!entry.found_existing) entry.value_ptr.* = .empty;
        var ids = descriptors.keyIterator(); while (ids.next()) |id| { try self.c.step(); try entry.value_ptr.put(self.c.allocator, id.*, {}); }
    }
    fn addEffect(self: *Observations, at: usize, owners: *const Collected) Error!void {
        if (!owners.pending and owners.ids.count() == 0) return;
        try self.c.step(); const entry = try self.effects.getOrPut(self.c.allocator, at);
        if (!entry.found_existing) entry.value_ptr.* = .{};
        try entry.value_ptr.merge(self.c, owners);
    }
    fn seed(self: *Observations, world: facts.WorldView, record: *ContextRecord, value: facts.Value, heap: facts.HeapView, root: bool, incoming: bool) Error!void {
        if (incoming) {
            var owning = try collect(self.c, world, value, heap, .owning, true); defer owning.deinit(self.c.allocator);
            var owners_it = owning.ids.keyIterator();
            while (owners_it.next()) |owner| { try self.c.step(); try record.incoming_owners.put(self.c.allocator, owner.*, {}); }
        }
        var spans = try collect(self.c, world, value, heap, .escape, true); defer spans.deinit(self.c.allocator);
        var spans_it = spans.ids.keyIterator();
        while (spans_it.next()) |id| {
            const span: facts.ObjectId = @enumFromInt(id.*);
            var owners = try spanOwners(self.c, world, heap, span); defer owners.deinit(self.c.allocator);
            if (incoming) {
                var iterator = owners.ids.keyIterator();
                while (iterator.next()) |owner| { try self.c.step(); try record.incoming_owners.put(self.c.allocator, owner.*, {}); }
            }
            if (root) try self.defineSpan(world, record.entry, span, heap);
        }
    }
    fn entryObjects(self: *Observations, value: facts.Value) Error!void {
        for (value.objects) |object| { try self.c.step(); try self.external.put(self.c.allocator, @intFromEnum(object), {}); }
        for (value.callables) |pair| { try self.c.step(); if (pair.environment) |environment| try self.external.put(self.c.allocator, @intFromEnum(environment), {}); }
    }
    fn ensureContext(self: *Observations, world: facts.WorldView, id: facts.ContextId) Error!void {
        if (!self.root_entries_collected) {
            // The world is the complete, converged replay input. Classify every
            // root before any event: a later root can retain an earlier object.
            for (world.contexts) |root_context| {
                try self.c.step(); if (!root_context.root) continue;
                for (0..root_context.arguments.len()) |i| {
                    try self.c.step(); try self.entryObjects(root_context.arguments.get(i));
                }
                var entries = root_context.entry.iterator();
                while (entries.next()) |entry| { try self.c.step(); try self.entryObjects(entry.value); }
            }
            self.root_entries_collected = true;
        }
        try self.c.step(); if (self.contexts.contains(id)) return;
        const info = world.invocation(id);
        var record = ContextRecord{ .entry = try self.flow.addPoint() }; errdefer record.deinit(self.c.allocator);
        for (0..info.arguments.len()) |i| { try self.c.step(); try self.seed(world, &record, info.arguments.get(i), info.entry, info.root, true); }
        if (info.root) {
            // Existing global descriptors are definitions, not incoming-owner
            // survival authority. External classification was precollected.
            var slots = info.entry.iterator();
            while (slots.next()) |entry| {
                try self.c.step(); if (entry.slot == .global) try self.seed(world, &record, entry.value, info.entry, true, false);
            }
        }
        try self.connect(record.entry, try self.point(.{ .context = id, .location = .{ .function = info.function, .block = @enumFromInt(0), .instruction = 0 } }));
        try self.contexts.put(self.c.allocator, id, record);
    }
    fn observe(self: *Observations, world: facts.WorldView, at: usize, value: facts.Value, heap: facts.HeapView, deep: bool, expected_span: bool) Error!void {
        var spans = try collect(self.c, world, value, heap, .use, deep); defer spans.deinit(self.c.allocator);
        if (expected_span) {
            try self.c.require(!spans.pending and spans.ids.count() != 0);
            for (value.objects) |object| { try self.c.step(); try self.c.require(world.object(object).kind == .read_span); }
            for (value.tags) |tag| { try self.c.step(); try self.c.require(self.spanType(tag)); }
        }
        var iterator = spans.ids.keyIterator();
        while (iterator.next()) |id| {
            var owners = try spanOwners(self.c, world, heap, @enumFromInt(id.*)); defer owners.deinit(self.c.allocator);
            try self.c.require(!owners.pending);
        }
        try self.addUses(at, &spans.ids);
    }
    fn spanType(self: *const Observations, ref: t.TypeRef) bool {
        return switch (self.c.program.tables.mode) {
            .common => |v| v.types[@intFromEnum(ref)].kind == .readSpan,
            .legacy => |v| v.types[@intFromEnum(ref)].kind == .readSpan,
            .exception => false,
        };
    }
    fn instruction(self: *const Observations, site: facts.Site) *const model.instruction.Instruction {
        return &self.c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
    }
    fn catalogs(self: *Observations) Error!void {
        if (self.catalogued) return;
        const c = self.c;
        for (c.program.functions, 0..) |function, i| { try c.step(); try self.function_indexes.put(c.allocator, function.id, i); }
        if (c.program.tables.mode == .common) {
            const v = c.program.tables.mode.common;
            for (v.modules.globals, 0..) |row, i| { try c.step(); try self.global_indexes.put(c.allocator, row.id, @enumFromInt(i)); }
            for (v.authority.fixed_publication.publication.contracts, 0..) |row, i| {
                try c.step(); const function = self.function_indexes.get(row.function_id) orelse return error.InvalidShape;
                try self.contract_rows.put(c.allocator, function, i);
            }
            for (v.closures.environments, 0..) |environment, i| for (environment.slots, 0..) |slot, s| {
                try c.step(); const entry = try self.capture_slots.getOrPut(c.allocator, slot.key);
                try c.require(!entry.found_existing); entry.value_ptr.* = .{ .layout = @enumFromInt(i), .slot = @enumFromInt(s) };
            };
        }
        self.catalogued = true;
    }
    fn captureEffects(self: *Observations, world: facts.WorldView, roots: []const facts.ObjectId, wanted: Capture, heap: facts.HeapView, into: *Collected) Error!void {
        var pending: std.ArrayListUnmanaged(facts.ObjectId) = .empty; defer pending.deinit(self.c.allocator);
        var seen: Set = .empty; defer seen.deinit(self.c.allocator);
        try self.c.charge(roots.len); try pending.appendSlice(self.c.allocator, roots);
        if (roots.len == 0) into.pending = true;
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try self.c.step(); const object = pending.items[cursor];
            const entry = try seen.getOrPut(self.c.allocator, @intFromEnum(object)); if (entry.found_existing) continue;
            const info = world.object(object);
            if (info.environment == wanted.layout) {
                if (heap.get(.{ .environment_slot = .{ .object = object, .slot = wanted.slot } })) |stored| {
                    var owners = try collect(self.c, world, stored, heap, .arrays, true); defer owners.deinit(self.c.allocator);
                    try into.merge(self.c, &owners);
                } else into.pending = true;
            } else if (heap.get(.{ .parent = object })) |parent| {
                into.pending = into.pending or parent.unknown or parent.callable_unknown or parent.objects.len == 0;
                try self.c.charge(parent.objects.len); try pending.appendSlice(self.c.allocator, parent.objects);
            } else into.pending = true;
        }
    }
    fn upper(self: *Observations, world: facts.WorldView, site: facts.Site, target: usize, state: facts.StateView, bound: *Boundary) Error!void {
        const c = self.c; const v = c.program.tables.mode.common; const op = self.instruction(site);
        const contract = v.authority.fixed_publication.publication.contracts[self.contract_rows.get(target) orelse return error.InvalidShape];
        const effect = contract.upper; const indirect = op.data == .eh_invoke_indirect or op.data == .function_call;
        const abi = v.abis[@intFromEnum(c.program.functions[target].abi)];
        const offset: usize = if (indirect) 1 else if (op.data == .eh_invoke and abi.lexical_environment != null) 1 else 0;
        for (effect.parameters) |access| {
            try c.step();
            if (!access.structural) continue;
            if (access.index + offset < op.operands.len) {
                var owners = try collect(c, world, state.values.reg(op.operands[access.index + offset]), state.heap, .arrays, true); defer owners.deinit(c.allocator);
                try bound.owners.merge(c, &owners);
            } else bound.owners.pending = true;
        }
        for (effect.globals.writes) |global| {
            try c.step(); const id = self.global_indexes.get(global) orelse return error.InvalidShape;
            if (state.heap.get(.{ .global = id })) |value| {
                var owners = try collect(c, world, value, state.heap, .arrays, true); defer owners.deinit(c.allocator);
                try bound.owners.merge(c, &owners);
            }
        }
        var environments: std.ArrayListUnmanaged(facts.ObjectId) = .empty; defer environments.deinit(c.allocator);
        if (indirect) {
            const callee = state.values.reg(op.operands[0]);
            bound.owners.pending = bound.owners.pending or callee.unknown or callee.callable_unknown;
            for (callee.callables) |pair| {
                try c.step(); if (@intFromEnum(pair.code) != target) continue;
                if (pair.environment) |environment| try environments.append(c.allocator, environment);
            }
        } else if (op.data == .eh_invoke and abi.lexical_environment != null) {
            const lexical = state.values.reg(op.operands[0]); bound.owners.pending = bound.owners.pending or lexical.unknown;
            try c.charge(lexical.objects.len); try environments.appendSlice(c.allocator, lexical.objects);
        }
        for (effect.captures) |access| {
            try c.step();
            if (!access.structural) continue;
            if (self.capture_slots.get(access.slot)) |slot| try self.captureEffects(world, environments.items, slot, state.heap, &bound.owners)
            else bound.owners.pending = true;
        }
        if (effect.facets.unknown_host) { bound.conservative = true; bound.owners.pending = true; }
    }
    fn boundary(self: *Observations, world: facts.WorldView, site: facts.Site, at: usize, state: facts.StateView) Error!void {
        try self.catalogs(); const c = self.c; const op = self.instruction(site);
        try c.step(); const entry = try self.boundaries.getOrPut(c.allocator, at);
        if (!entry.found_existing) entry.value_ptr.* = .{};
        const bound = entry.value_ptr;
        switch (op.data) {
            .call => |v| try bound.permitted.put(c.allocator, @intFromEnum(v.callee), {}),
            .eh_invoke => |v| try bound.permitted.put(c.allocator, @intFromEnum(v.callee), {}),
            inline .domain_construct, .domain_super => |v| switch (c.program.tables.mode) {
                .legacy => |rows| try bound.permitted.put(c.allocator, @intFromEnum(rows.members.constructions[@intFromEnum(v.construction)].function), {}),
                .common => |rows| if (rows.members.constructions[@intFromEnum(v.construction)].function) |target| { try bound.permitted.put(c.allocator, @intFromEnum(target), {}); },
                .exception => return error.WrongMode,
            },
            .domain_method_call => |v| switch (c.program.tables.mode) {
                .common => |rows| for (rows.views.dispatch[@intFromEnum(v.dispatch)].method.arms) |arm| { try c.step(); if (arm.target) |target| try bound.permitted.put(c.allocator, @intFromEnum(target), {}); },
                .legacy => |rows| for (rows.views.dispatch[@intFromEnum(v.dispatch)].method.arms) |arm| { try c.step(); if (arm.target) |target| try bound.permitted.put(c.allocator, @intFromEnum(target), {}); },
                .exception => return error.WrongMode,
            },
            .common_method_invoke => |v| for (c.program.tables.mode.common.views.dispatch[@intFromEnum(v.dispatch)].method.arms) |arm| { try c.step(); if (arm.target) |target| try bound.permitted.put(c.allocator, @intFromEnum(target), {}); },
            .function_call, .eh_invoke_indirect => {
                switch (c.program.tables.mode) {
                    .common => |v| for (v.closures.calls) |row| {
                        try c.step(); if (row.function == site.location.function and row.block == site.location.block and row.instruction == site.location.instruction)
                            for (row.targets) |target| { try c.step(); try bound.permitted.put(c.allocator, @intFromEnum(target), {}); };
                    },
                    .legacy => |v| for (v.closures.calls) |row| {
                        try c.step(); if (row.function == site.location.function and row.block == site.location.block and row.instruction == site.location.instruction)
                            for (row.targets) |target| { try c.step(); try bound.permitted.put(c.allocator, @intFromEnum(target), {}); };
                    },
                    .exception => {}, // No invented EH targets authority table.
                }
                const callable = state.values.reg(op.operands[0]);
                bound.conservative = bound.conservative or callable.unknown or callable.callable_unknown;
            },
            else => unreachable,
        }
        if (bound.permitted.count() == 0) { bound.conservative = true; bound.owners.pending = true; }
        if (c.program.tables.mode == .common) {
            var targets = bound.permitted.keyIterator(); while (targets.next()) |target| { try c.step(); try self.upper(world, site, target.*, state, bound); }
        }
        for (op.operands) |reg| {
            try c.step(); const argument = state.values.reg(reg);
            var used = try collect(c, world, argument, state.heap, .use, true); defer used.deinit(c.allocator);
            var uses_it = used.ids.keyIterator(); while (uses_it.next()) |id| { try c.step(); try bound.arguments.put(c.allocator, id.*, {}); }
            var escaping = try collect(c, world, argument, state.heap, .escape, true); defer escaping.deinit(c.allocator);
            bound.escaping = bound.escaping or escaping.ids.count() != 0 or escaping.pending;
        }
        for (0..state.values.len()) |i| for (state.values.get(i).objects) |object| {
            try c.step(); if (world.object(object).kind == .read_span) try bound.existing.put(c.allocator, @intFromEnum(object), {});
        };
        var heap = state.heap.iterator();
        while (heap.next()) |stored| {
            try c.step(); for (stored.value.objects) |object| {
                try c.step(); if (world.object(object).kind == .read_span) try bound.existing.put(c.allocator, @intFromEnum(object), {});
            }
            if (stored.slot == .span_owner) try bound.existing.put(c.allocator, @intFromEnum(stored.slot.span_owner), {});
        }
    }
    fn constructorReceiver(self: *Observations, world: facts.WorldView, site: facts.Site, receiver: facts.Value) Error!bool {
        const c = self.c; const info = world.invocation(site.context);
        const function = c.program.functions[@intFromEnum(info.function)];
        if (function.role != .construction_body or receiver.unknown or receiver.callable_unknown or
            receiver.objects.len != 1 or receiver.cells.len != 0 or receiver.callables.len != 0) return false;
        try c.step(); if (world.object(receiver.objects[0]).weak) return false;
        var parameter: ?usize = null;
        switch (c.program.tables.mode) {
            .common => |v| {
                const abi = v.abis[@intFromEnum(function.abi)];
                if (abi.receiver != null) parameter = if (abi.lexical_environment != null) 1 else 0;
            },
            .legacy => |v| {
                const abi = v.abis[@intFromEnum(function.abi)];
                for (v.members.constructions) |construction| {
                    try c.step(); if (construction.function != info.function) continue;
                    const hidden: usize = if (v.closures.functions.len != 0 and v.closures.functions[@intFromEnum(info.function)].lexical_environment != null) 1 else 0;
                    for (abi.parameters, 0..) |row, i| {
                        try c.charge(1 + row.binding.len / 64);
                        if (std.mem.eql(u8, row.binding, construction.receiver_binding)) parameter = i + hidden;
                    }
                }
            },
            .exception => {},
        }
        if (parameter) |index| {
            const original = info.arguments.get(index);
            try c.step();
            return !original.unknown and !original.callable_unknown and original.objects.len == 1 and
                original.cells.len == 0 and original.callables.len == 0 and original.objects[0] == receiver.objects[0];
        }
        return false;
    }
    fn returned(self: *Observations, world: facts.WorldView, site: facts.Site, value: facts.Value, heap: facts.HeapView, spans: *const Collected) Error!void {
        if (spans.ids.count() == 0) return;
        const c = self.c; try c.require(!spans.pending);
        var projection = Projection{ .arena = std.heap.ArenaAllocator.init(c.allocator) }; defer projection.deinit();
        const stable = try self.referenceWrites(world, value, heap);
        try projection.build(c, world, value, heap, stable);
        var iterator = spans.ids.keyIterator();
        while (iterator.next()) |descriptor| {
            try c.step(); var owners = try spanOwners(c, world, heap, @enumFromInt(descriptor.*)); defer owners.deinit(c.allocator);
            try c.require(!owners.pending);
            var holding = Holding{ .c = c, .nodes = projection.nodes.items, .root = projection.root, .stable_projection = stable };
            var held = try holding.solve(descriptor.*); defer held.deinit(c.allocator);
            var owner_ids = owners.ids.keyIterator();
            while (owner_ids.next()) |owner| {
                try c.step(); if (self.contexts.get(site.context).?.incoming_owners.contains(owner.*) or held.contains(owner.*)) continue;
                try c.require(try self.retained(world, site.context, &projection, descriptor.*, owner.*));
            }
        }
        // A weak, opaque or unclosed graph is not repaired with a raw site.
        // RegionDomain/Holding correlation is a separate, unresolved facet.
    }
    fn referenceWrites(self: *Observations, world: facts.WorldView, initial: facts.Value, heap: facts.HeapView) Error!bool {
        const c = self.c; if (c.program.tables.mode != .common) return true;
        try self.catalogs(); const v = c.program.tables.mode.common;
        var pending: std.ArrayListUnmanaged(facts.Value) = .empty; defer pending.deinit(c.allocator);
        var seen: Set = .empty; defer seen.deinit(c.allocator);
        var cells: std.AutoHashMapUnmanaged(facts.CellId, void) = .empty; defer cells.deinit(c.allocator);
        try pending.append(c.allocator, initial); var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const value = pending.items[cursor];
            for (value.callables) |pair| {
                try c.step(); const contract = self.contract_rows.get(@intFromEnum(pair.code)) orelse return true;
                for (v.authority.fixed_publication.publication.contracts[contract].upper.captures) |capture| { try c.step(); if (capture.write) return true; }
                if (pair.environment) |environment| {
                    const entry = try seen.getOrPut(c.allocator, @intFromEnum(environment));
                    if (!entry.found_existing) {
                        var slots = heap.iterator(); while (slots.next()) |stored| { try c.step(); if (slotObject(stored.slot) == environment) try pending.append(c.allocator, stored.value); }
                    }
                }
            }
            for (value.objects) |object| {
                try c.step(); const entry = try seen.getOrPut(c.allocator, @intFromEnum(object)); if (entry.found_existing) continue;
                if (world.object(object).kind == .read_span) continue;
                var slots = heap.iterator(); while (slots.next()) |stored| { try c.step(); if (slotObject(stored.slot) == object) try pending.append(c.allocator, stored.value); }
            }
            for (value.cells) |cell| {
                try c.step(); const entry = try cells.getOrPut(c.allocator, cell);
                if (!entry.found_existing) if (heap.get(.{ .cell = cell })) |stored| { try pending.append(c.allocator, stored); };
            }
        }
        return false;
    }
    fn retained(self: *Observations, world: facts.WorldView, invocation_id: facts.ContextId, projection: *const Projection, descriptor: usize, owner: usize) Error!bool {
        const c = self.c; const span_info = world.object(@enumFromInt(descriptor)); const owner_info = world.object(@enumFromInt(owner));
        if (span_info.weak or owner_info.weak or span_info.creations.len != 1 or owner_info.creations.len != 1 or
            span_info.creations[0].context != invocation_id or owner_info.creations[0].context != invocation_id or world.invocation(invocation_id).repeated) return false;
        const span_type = span_info.@"type" orelse return false; const owner_type = owner_info.@"type" orelse return false;
        const same_element = switch (c.program.tables.mode) {
            .common => |v| v.types[@intFromEnum(span_type)].element == v.types[@intFromEnum(owner_type)].element,
            .legacy => |v| v.types[@intFromEnum(span_type)].element == v.types[@intFromEnum(owner_type)].element,
            .exception => false,
        };
        if (!same_element or projection.root.unresolved_alternative) return false;
        const Path = struct { object: usize, managed: bool, invalid: bool };
        var pending: std.ArrayListUnmanaged(Path) = .empty; defer pending.deinit(c.allocator);
        var seen: std.AutoHashMapUnmanaged(Path, void) = .empty; defer seen.deinit(c.allocator);
        var node_indexes: std.AutoHashMapUnmanaged(usize, usize) = .empty; defer node_indexes.deinit(c.allocator);
        for (projection.nodes.items, 0..) |node, i| { try c.step(); try node_indexes.put(c.allocator, node.object, i); }
        for (projection.root.alternatives) |object| { try c.step(); try pending.append(c.allocator, .{ .object = object, .managed = false, .invalid = false }); }
        var found = false; var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); var path = pending.items[cursor]; const entry = try seen.getOrPut(c.allocator, path); if (entry.found_existing) continue;
            if (path.object == descriptor) { if (path.invalid or !path.managed) return false; found = true; continue; }
            const node = projection.nodes.items[node_indexes.get(path.object) orelse return false]; const info = world.object(@enumFromInt(path.object));
            path.invalid = path.invalid or node.weak or !node.complete or self.external.contains(path.object) or
                info.creations.len != 1 or info.creations[0].context != invocation_id or node.kind == .environment;
            path.managed = path.managed or node.kind == .reference or node.kind == .array;
            for (node.fields) |field| for (field.alternatives) |child| {
                try c.step(); try pending.append(c.allocator, .{ .object = child, .managed = path.managed, .invalid = path.invalid or field.unresolved_alternative });
            };
        }
        // This local strong case does not pretend that an abstract creation
        // shared by multiple contexts is a unique dynamic invocation.
        return found;
    }
    fn stableArrayStore(self: *Observations, world: facts.WorldView, site: facts.Site, at: usize, destination: facts.Value, value: facts.Value, heap: facts.HeapView, spans: *const Collected) Error!bool {
        const c = self.c; if (destination.unknown or destination.objects.len == 0 or value.unknown or value.cells.len != 0 or value.callables.len != 0 or value.objects.len == 0) return false;
        const invocation_info = world.invocation(site.context);
        var stored = StableStore{ .point = at }; errdefer stored.deinit(c.allocator);
        for (destination.objects) |object| {
            try c.step(); if (world.object(object).kind != .array or self.fresh.contains(@intFromEnum(object))) { stored.deinit(c.allocator); return false; }
            var incoming = false;
            for (0..invocation_info.arguments.len()) |i| for (invocation_info.arguments.get(i).objects) |argument| { try c.step(); incoming = incoming or argument == object; };
            if (!incoming) { stored.deinit(c.allocator); return false; }
            try stored.receivers.put(c.allocator, @intFromEnum(object), {});
        }
        for (value.objects) |object| {
            try c.step(); const kind = world.object(object).kind;
            if (kind != .reference and kind != .value) { stored.deinit(c.allocator); return false; }
        }
        var projection = Projection{ .arena = std.heap.ArenaAllocator.init(c.allocator) }; defer projection.deinit();
        try projection.build(c, world, value, heap, true);
        for (projection.nodes.items) |node| {
            try c.step(); if (node.weak or !node.complete or node.kind == .environment) { stored.deinit(c.allocator); return false; }
            for (node.fields) |field| { try c.step(); if (field.nonowning or field.unresolved_alternative) { stored.deinit(c.allocator); return false; } }
        }
        var iterator = spans.ids.keyIterator();
        while (iterator.next()) |descriptor| {
            try c.step(); var owners = try spanOwners(c, world, heap, @enumFromInt(descriptor.*)); defer owners.deinit(c.allocator);
            if (owners.pending or owners.ids.count() != 1) { stored.deinit(c.allocator); return false; }
            var owning = Holding{ .c = c, .nodes = projection.nodes.items, .root = projection.root, .stable_projection = true };
            var held = try owning.solve(descriptor.*); defer held.deinit(c.allocator);
            var owner_ids = owners.ids.keyIterator(); const owner = owner_ids.next().?.*;
            const info = world.object(@enumFromInt(owner));
            if (!held.contains(owner) or info.weak or info.creations.len != 1 or info.creations[0].context != site.context or invocation_info.repeated) { stored.deinit(c.allocator); return false; }
            try stored.local_owners.put(c.allocator, owner, {}); try stored.descriptors.put(c.allocator, descriptor.*, {});
        }
        try self.addUses(at, &stored.descriptors);
        try self.stable_stores.append(c.allocator, stored); return true;
    }
    fn storageLifetime(self: *Observations, world: facts.WorldView, site: facts.Site, at: usize, destination: facts.Value, value: facts.Value, heap: facts.HeapView, global: bool) Error!void {
        const c = self.c; var external = global or destination.unknown;
        for (destination.objects) |object| { try c.step(); external = external or self.external.contains(@intFromEnum(object)); }
        if (!external or try self.constructorReceiver(world, site, destination)) return;
        var spans = try collect(c, world, value, heap, .escape, true); defer spans.deinit(c.allocator);
        if (spans.ids.count() == 0) return;
        try c.require(!spans.pending);
        if (!global and self.instruction(site).data == .domain_array_store and try self.stableArrayStore(world, site, at, destination, value, heap, &spans)) return;
        var previous = try collect(c, world, destination, heap, .escape, true); defer previous.deinit(c.allocator);
        var iterator = spans.ids.keyIterator();
        while (iterator.next()) |descriptor| { try c.step(); try c.require(previous.ids.contains(descriptor.*)); }
    }
    fn invocation(op: *const model.instruction.Instruction) bool {
        return switch (op.data) { .call, .function_call, .domain_construct, .domain_super, .domain_method_call, .eh_invoke, .eh_invoke_indirect, .common_method_invoke => true, else => false };
    }
    fn client(pointer: *anyopaque) *Observations { return @ptrCast(@alignCast(pointer)); }
    pub fn observer(self: *Observations) facts.Observer {
        return .{ .client = self, .before = before, .after = after, .edge = edge, .call = called, .completed = completed };
    }
    fn before(pointer: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const self = client(pointer); try self.ensureContext(world, site.context);
        const op = self.instruction(site); const at = try self.point(site);
        switch (op.data) {
            .domain_array_read, .domain_array_length => {
                const saved = self.c.program.functions[@intFromEnum(site.location.function)].registers[@intFromEnum(op.operands[0])];
                const actual = state.values.reg(op.operands[0]);
                var expected_span = false;
                switch (self.c.program.tables.mode) {
                    .common => {
                        const logical = saved.view orelse if (saved.carrier == .@"type") saved.carrier.@"type" else return error.InvalidShape;
                        expected_span = self.spanType(logical);
                    },
                    .legacy => |v| {
                        expected_span = if (saved.view) |view| self.spanType(view) else false;
                        const alternatives = v.domains[@intFromEnum(saved.carrier.domain)].alternatives;
                        var span_alternatives: usize = 0;
                        for (alternatives) |alternative| { try self.c.step(); if (self.spanType(alternative)) span_alternatives += 1; }
                        expected_span = expected_span or span_alternatives == alternatives.len;
                        // A mixed finite Array/Span carrier can select an Array,
                        // but unresolved data cannot erase a possible Span use.
                        if (span_alternatives != 0 and !expected_span) try self.c.require(!actual.unknown and !actual.callable_unknown and
                            actual.objects.len != 0 and actual.cells.len == 0 and actual.callables.len == 0);
                    },
                    .exception => {}, // This mode has no ReadSpan type.
                }
                try self.observe(world, at, actual, state.heap, false, expected_span);
            },
            .domain_array_store, .domain_array_resize => {
                const receiver = state.values.reg(op.operands[0]); const index = state.values.reg(op.operands[1]);
                var structural: Collected = .{ .pending = receiver.unknown or receiver.objects.len == 0 }; defer structural.deinit(self.c.allocator);
                for (receiver.objects) |object| {
                    try self.c.step(); const length = state.heap.get(.{ .length = object });
                    var unchanged = false;
                    if (length) |known| {
                        if (!known.unknown and !index.unknown and known.number != null and index.number != null) {
                            unchanged = if (op.data == .domain_array_resize) known.number == index.number else
                                index.number.? >= 0 and index.number.? < known.number.? and state.heap.get(.{ .element = .{ .object = object, .index = index.number } }) != null;
                        }
                    }
                    if (!unchanged) try structural.ids.put(self.c.allocator, @intFromEnum(object), {});
                }
                try self.addEffect(at, &structural);
                if (op.data == .domain_array_store) try self.storageLifetime(world, site, at, receiver, state.values.reg(op.operands[2]), state.heap, false);
            },
            .domain_field_store, .domain_field_initialize, .eh_field_initialize, .environment_init, .environment_store, .eh_store => {
                try self.storageLifetime(world, site, at, state.values.reg(op.operands[0]), state.values.reg(op.operands[1]), state.heap, false);
            },
            .global_store => try self.storageLifetime(world, site, at, .{}, state.values.reg(op.operands[0]), state.heap, true),
            else => {},
        }
        if (invocation(op)) try self.boundary(world, site, at, state);
        if (op.data == .authorized_host) {
            var unknown: Collected = .{ .pending = true }; defer unknown.deinit(self.c.allocator);
            try self.addEffect(at, &unknown);
            for (op.operands) |reg| try self.storageLifetime(world, site, at, .{}, state.values.reg(reg), state.heap, true);
        }
    }
    fn after(pointer: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const self = client(pointer); const op = self.instruction(site); const at = try self.point(site);
        if (op.data == .domain_read_span) {
            const result = state.values.reg(op.result.?);
            for (result.objects) |object| {
                try self.c.step(); try self.c.require(world.object(object).kind == .read_span);
                const point_id = if (world.object(object).weak) self.contexts.get(site.context).?.entry else at;
                try self.defineSpan(world, point_id, object, state.heap);
            }
        }
        if (op.data == .domain_array_create or op.data == .common_typed_array_create) {
            for (state.values.reg(op.result.?).objects) |object| {
                try self.c.step(); const info = world.object(object);
                if (info.kind == .array and !info.weak and info.creations.len == 1 and !world.invocation(info.creations[0].context).repeated)
                    try self.fresh.put(self.c.allocator, @intFromEnum(object), {});
            }
        }
        // Only the shared solve's edge callback establishes continuation. A
        // failed numeric guard/request trap must not acquire instruction+1.
    }
    fn edge(pointer: *anyopaque, _: *Context, _: facts.WorldView, from: facts.Site, to: facts.Location) Error!void {
        const self = client(pointer); const start = try self.point(from); const end = try self.point(.{ .context = from.context, .location = to });
        if (invocation(self.instruction(from))) {
            try self.c.step(); try self.call_successors.put(self.c.allocator, .{ .from = start, .to = end }, {});
        } else try self.connect(start, end);
    }
    fn called(pointer: *anyopaque, _: *Context, world: facts.WorldView, call: facts.CallEdge) Error!void {
        const self = client(pointer); try self.ensureContext(world, call.callee);
        const at = try self.point(call.caller); try self.c.step();
        const boundary_row = self.boundaries.getPtr(at) orelse return error.InvalidShape;
        try boundary_row.connected.put(self.c.allocator, @intFromEnum(world.invocation(call.callee).function), {});
        try self.calls.append(self.c.allocator, call); try self.connect(at, self.contexts.get(call.callee).?.entry);
    }
    fn completed(pointer: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, completion: facts.Completion, value: facts.Value, heap: facts.HeapView) Error!void {
        const self = client(pointer); try self.ensureContext(world, site.context); const at = try self.point(site);
        if (completion == .request_trap) return;
        const record = self.contexts.getPtr(site.context).?;
        if (completion == .normal) try record.normal.put(self.c.allocator, at, {}) else try record.language.put(self.c.allocator, at, {});
        try self.observe(world, at, value, heap, true, false);
        var spans = try collect(self.c, world, value, heap, .escape, true); defer spans.deinit(self.c.allocator);
        try self.addUses(at, &spans.ids);
        // Typed role alone does not prove that this result is the original
        // receiver; SourcePlan is not among this passive checker's inputs.
        if (completion == .normal and try self.constructorReceiver(world, site, value)) return;
        try self.returned(world, site, value, heap, &spans);
    }
    fn copyIds(self: *Observations, set: *const Set) Error![]usize {
        try self.c.charge(set.count()); const result = try self.c.allocator.alloc(usize, set.count());
        var iterator = set.keyIterator(); var i: usize = 0;
        while (iterator.next()) |id| : (i += 1) result[i] = id.*;
        return result;
    }
    fn descriptorValues(self: *Observations, descriptors: *const Set, index: *const std.AutoHashMapUnmanaged(usize, std.ArrayListUnmanaged(usize))) Error![]usize {
        var values: std.ArrayListUnmanaged(usize) = .empty; errdefer values.deinit(self.c.allocator);
        var iterator = descriptors.keyIterator();
        while (iterator.next()) |descriptor| {
            try self.c.step(); const rows = index.get(descriptor.*) orelse return error.InvalidShape;
            try self.c.charge(rows.items.len); try values.appendSlice(self.c.allocator, rows.items);
        }
        return values.toOwnedSlice(self.c.allocator);
    }
    pub fn finish(self: *Observations) Error!void {
        const c = self.c;
        var boundaries = self.boundaries.iterator();
        while (boundaries.next()) |entry| {
            try c.step(); const bound = entry.value_ptr;
            var complete = !bound.conservative and bound.permitted.count() != 0;
            var permitted = bound.permitted.keyIterator();
            while (permitted.next()) |target| { try c.step(); complete = complete and bound.connected.contains(target.*); }
            bound.ordered = complete;
            if (!complete) {
                if (c.program.tables.mode != .common) bound.owners.pending = true;
                try self.addEffect(entry.key_ptr.*, &bound.owners); try self.addUses(entry.key_ptr.*, &bound.arguments);
                try c.require(!bound.escaping);
            }
        }
        var descriptors: std.AutoHashMapUnmanaged(usize, std.ArrayListUnmanaged(usize)) = .empty;
        defer { var iterator = descriptors.valueIterator(); while (iterator.next()) |row| row.deinit(c.allocator); descriptors.deinit(c.allocator); }
        var definitions = self.definitions.iterator();
        while (definitions.next()) |entry| {
            try c.step(); const owners = try self.copyIds(&entry.value_ptr.ids); defer c.allocator.free(owners);
            const value = try self.flow.addValue(.{ .owners = owners, .pending = entry.value_ptr.pending });
            try self.flow.define(entry.key_ptr.point, value, false);
            const rows = try descriptors.getOrPut(c.allocator, entry.key_ptr.descriptor);
            if (!rows.found_existing) rows.value_ptr.* = .empty;
            try rows.value_ptr.append(c.allocator, value);
        }
        var call_successors = self.call_successors.keyIterator();
        while (call_successors.next()) |successor| {
            try c.step(); const bound = self.boundaries.get(successor.from) orelse return error.InvalidShape;
            if (!bound.ordered) try self.connect(successor.from, successor.to);
        }
        for (self.calls.items) |call| {
            try c.step(); const at = self.points.get(call.caller).?; const bound = self.boundaries.get(at).?;
            const callee = self.contexts.get(call.callee).?;
            for ([_]facts.Completion{ .normal, .language }) |completion| {
                try c.step();
                const location = if (completion == .normal) call.normal else call.language orelse continue;
                const successor = try self.point(.{ .context = call.caller.context, .location = location });
                var exits = if (completion == .normal) callee.normal.keyIterator() else callee.language.keyIterator();
                while (exits.next()) |exit| {
                    try c.step();
                    if (!bound.ordered or (!bound.owners.pending and bound.owners.ids.count() == 0)) {
                        try self.connect(exit.*, successor); continue;
                    }
                    // A complete call retains the full fixed upper at each
                    // normal/language exit, restricted to pre-call views.
                    const barrier = try self.flow.addPoint();
                    const owners = try self.copyIds(&bound.owners.ids); defer c.allocator.free(owners);
                    const eligible = try self.descriptorValues(&bound.existing, &descriptors); defer c.allocator.free(eligible);
                    try self.flow.addEffect(barrier, .{ .owners = owners, .pending = bound.owners.pending }, eligible);
                    try self.connect(exit.*, barrier); try self.connect(barrier, successor);
                }
            }
        }
        // External stable storage retains every transferred descriptor along
        // future actual edges, even if no local SSA use happens to follow it.
        var successors: std.AutoHashMapUnmanaged(usize, std.ArrayListUnmanaged(usize)) = .empty;
        defer { var iterator = successors.valueIterator(); while (iterator.next()) |row| row.deinit(c.allocator); successors.deinit(c.allocator); }
        var edges = self.edges.keyIterator();
        while (edges.next()) |link| {
            try c.step(); const row = try successors.getOrPut(c.allocator, link.from);
            if (!row.found_existing) row.value_ptr.* = .empty;
            try row.value_ptr.append(c.allocator, link.to);
        }
        for (self.stable_stores.items) |stored| {
            var seen: Set = .empty; defer seen.deinit(c.allocator);
            var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator);
            try pending.append(c.allocator, stored.point); try seen.put(c.allocator, stored.point, {});
            var cursor: usize = 0;
            while (cursor < pending.items.len) : (cursor += 1) {
                try c.step(); const at = pending.items[cursor]; try self.addUses(at, &stored.descriptors);
                if (successors.get(at)) |next| for (next.items) |point_id| {
                    try c.step(); const entry = try seen.getOrPut(c.allocator, point_id);
                    if (!entry.found_existing) try pending.append(c.allocator, point_id);
                };
            }
        }
        var uses = self.uses.iterator();
        while (uses.next()) |entry| {
            const values = try self.descriptorValues(entry.value_ptr, &descriptors); defer c.allocator.free(values);
            for (values) |value| { try c.step(); try self.flow.use(entry.key_ptr.*, value); }
        }
        var effects = self.effects.iterator();
        while (effects.next()) |entry| {
            try c.step(); const owners = try self.copyIds(&entry.value_ptr.ids); defer c.allocator.free(owners);
            var eligible: ?Set = null; defer if (eligible) |*set| set.deinit(c.allocator);
            for (self.stable_stores.items) |stored| {
                try c.step(); if (stored.point != entry.key_ptr.*) continue;
                if (eligible == null) eligible = .empty;
                for (self.flow.values.items, 0..) |value, i| {
                    try c.step(); var separate = !value.pending and !entry.value_ptr.pending and value.owners.len != 0;
                    for (value.owners) |owner| for (owners) |modified| {
                        try c.step(); separate = separate and owner != modified and stored.local_owners.contains(owner) and stored.receivers.contains(modified);
                    };
                    if (!separate) try eligible.?.put(c.allocator, i, {});
                }
            }
            const restricted = if (eligible) |*set| try self.copyIds(set) else null; defer if (restricted) |items| c.allocator.free(items);
            try self.flow.addEffect(entry.key_ptr.*, .{ .owners = owners, .pending = entry.value_ptr.pending }, restricted);
        }
        edges = self.edges.keyIterator();
        while (edges.next()) |link| { try c.step(); try self.flow.addEdge(link.from, link.to, &.{}); }
        // Two distinct verified fresh instances are disjoint. A different
        // ordinal, static type, parameter spelling or family is not that fact.
        for (self.flow.values.items) |value| for (value.owners) |owner| for (self.flow.effects.items) |effect| for (effect.owners) |modified| {
            try c.step(); const relation: Sharing = if (owner == modified) .may_share else if (self.fresh.contains(owner) and self.fresh.contains(modified)) .disjoint else .unknown;
            try self.flow.sharing(owner, modified, relation);
        };
        try self.flow.solve();
    }
};
