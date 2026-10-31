// SPDX-License-Identifier: MIT
// Common current-allocation relations, separate from raw abstract identity.
// The actual transfer must supply roots, scopes and selected relation slots.
// Today's actual-facts has no such facet: neither a weak ObjectId, its first
// creation site nor an effect-origin token can manufacture a current root.
// This module is a finite relation kernel and a negative-only replay observer;
// its plain answers are not coverage, Source, borrow or execution admission.
const std = @import("std");
const facts = @import("wire-program-actual-facts.zig");
const model = @import("wire-program-model.zig");
const t = model.types;
const Context = facts.Context;
pub const Error = facts.Error;
pub const Outcome = enum { proved, disproved, unresolved };
pub const Root = enum(u32) { _ };
pub const ScopeRef = enum(u16) { _ };
const RootSet = std.AutoHashMapUnmanaged(Root, void);

pub const Value = struct {
    roots: []const Root = &.{},
    known: bool = false,
    unresolved: bool = false,
    empty: bool = false,
    number: ?i64 = null,
};
pub const OwnedValue = struct {
    roots: std.ArrayListUnmanaged(Root) = .empty,
    known: bool = false,
    unresolved: bool = false,
    empty: bool = false,
    number: ?i64 = null,

    pub fn view(self: *const OwnedValue) Value {
        return .{ .roots = self.roots.items, .known = self.known, .unresolved = self.unresolved, .empty = self.empty, .number = self.number };
    }
    pub fn deinit(self: *OwnedValue, allocator: std.mem.Allocator) void { self.roots.deinit(allocator); self.* = .{}; }
    pub fn clone(c: *Context, source: Value) Error!OwnedValue {
        var result: OwnedValue = .{}; errdefer result.deinit(c.allocator);
        _ = try result.join(c, source); return result;
    }
    pub fn join(self: *OwnedValue, c: *Context, incoming: Value) Error!bool {
        try c.step();
        const bottom = !self.unresolved and !self.empty and self.roots.items.len == 0;
        const next_number = if (bottom) incoming.number else if (self.number == incoming.number) self.number else null;
        const incoming_unresolved = incoming.unresolved or !incoming.known;
        var changed = !self.known or (incoming_unresolved and !self.unresolved) or (incoming.empty and !self.empty) or self.number != next_number;
        self.known = true; self.unresolved = self.unresolved or incoming_unresolved;
        self.empty = self.empty or incoming.empty; self.number = next_number;
        for (incoming.roots) |root| {
            var position: usize = 0;
            while (position < self.roots.items.len) : (position += 1) {
                try c.step(); if (@intFromEnum(self.roots.items[position]) >= @intFromEnum(root)) break;
            }
            if (position < self.roots.items.len and self.roots.items[position] == root) continue;
            // This is Common's existing current-allocation alternative bound.
            try c.require(self.roots.items.len < 256); try c.charge(self.roots.items.len - position + 1);
            try self.roots.insert(c.allocator, position, root); changed = true;
        }
        return changed;
    }
    pub fn age(self: *OwnedValue, c: *Context) Error!void {
        try c.charge(self.roots.items.len + 1);
        if (self.roots.items.len != 0) { self.roots.clearRetainingCapacity(); self.known = true; self.unresolved = true; }
    }
};

// No relation roots can be recovered from the raw fallback. Even a strong raw
// object is not, by itself, a selected current-version relation.
pub fn fallback(c: *Context, raw: facts.Value) Error!Value {
    try c.charge(raw.objects.len + raw.cells.len + raw.callables.len + 1);
    var result = Value{ .known = true, .number = raw.number,
        .unresolved = raw.unknown or raw.callable_unknown or raw.objects.len != 0 or raw.cells.len != 0 };
    for (raw.callables) |pair| {
        if (pair.environment == null) result.empty = true else result.unresolved = true;
    }
    result.empty = result.empty or (raw.tags.len != 0 and raw.objects.len == 0 and raw.callables.len == 0);
    return result;
}

// A root is an allocation VERSION supplied by the same transfer. reference is
// only a raw alias family used to revoke scopes after roots have been aged.
pub const Node = struct { scope: ScopeRef, reference: facts.ObjectId };
pub const Scope = struct {
    function: t.FunctionRef,
    // Representative for reporting only. Distinct argument/heap contexts can
    // describe one physical activation; no equality/uniqueness follows here.
    activation: facts.ContextId,
    blocked: bool = false,
    hard: bool = false,
};
pub const Slot = union(enum) {
    field: t.FieldRef,
    element: ?i64,
    length: void,
    span_owner: void,
    span_start: void,
    span_length: void,
    environment_slot: t.EnvironmentSlotRef,
    parent: void,
};
const Slots = std.AutoHashMapUnmanaged(Slot, OwnedValue);
pub const Heap = struct {
    nodes: std.AutoHashMapUnmanaged(Root, Slots) = .empty,

    pub fn deinit(self: *Heap, allocator: std.mem.Allocator) void {
        var nodes_it = self.nodes.valueIterator();
        while (nodes_it.next()) |slots| {
            var values_it = slots.valueIterator(); while (values_it.next()) |stored| stored.deinit(allocator);
            slots.deinit(allocator);
        }
        self.nodes.deinit(allocator); self.* = .{};
    }
    // The allocation transfer calls this for a real current birth, including
    // an empty initialized object. It never infers a birth from a load/site.
    pub fn reset(self: *Heap, c: *Context, root: Root) Error!void {
        try c.step(); const found = try self.nodes.getOrPut(c.allocator, root);
        if (found.found_existing) {
            try c.charge(found.value_ptr.count());
            var values_it = found.value_ptr.valueIterator(); while (values_it.next()) |stored| stored.deinit(c.allocator);
            found.value_ptr.clearRetainingCapacity();
        } else found.value_ptr.* = .empty;
    }
    pub fn get(self: *const Heap, root: Root, slot: Slot) ?Value {
        const slots = self.nodes.getPtr(root) orelse return null;
        const stored = slots.getPtr(slot) orelse return null; return stored.view();
    }
    pub fn clone(c: *Context, source: *const Heap) Error!Heap {
        var result: Heap = .{}; errdefer result.deinit(c.allocator);
        var nodes_it = source.nodes.iterator();
        while (nodes_it.next()) |entry| {
            try result.reset(c, entry.key_ptr.*);
            var slots_it = entry.value_ptr.iterator();
            while (slots_it.next()) |stored| {
                try c.step(); var copied = try OwnedValue.clone(c, stored.value_ptr.view()); errdefer copied.deinit(c.allocator);
                try result.nodes.getPtr(entry.key_ptr.*).?.put(c.allocator, stored.key_ptr.*, copied);
            }
        }
        return result;
    }
    pub fn join(self: *Heap, c: *Context, source: *const Heap) Error!bool {
        // Missing slots on either incoming path are unproved, not empty.
        // Do not alias the two heaps: incoming is the other immutable path.
        try c.step(); if (self == source) return false;
        var changed = false; var nodes_it = source.nodes.iterator();
        while (nodes_it.next()) |entry| {
            try c.step(); const found = try self.nodes.getOrPut(c.allocator, entry.key_ptr.*);
            if (!found.found_existing) {
                found.value_ptr.* = .empty; changed = true;
                var slots_it = entry.value_ptr.iterator();
                while (slots_it.next()) |stored| {
                    try c.step(); var copied = try OwnedValue.clone(c, stored.value_ptr.view()); errdefer copied.deinit(c.allocator);
                    try found.value_ptr.put(c.allocator, stored.key_ptr.*, copied);
                }
                continue;
            }
            var old_it = found.value_ptr.iterator();
            while (old_it.next()) |stored| {
                try c.step(); if (!entry.value_ptr.contains(stored.key_ptr.*) and !stored.value_ptr.unresolved) { stored.value_ptr.unresolved = true; changed = true; }
            }
            var slots_it = entry.value_ptr.iterator();
            while (slots_it.next()) |stored| {
                try c.step(); const previous = try found.value_ptr.getOrPut(c.allocator, stored.key_ptr.*);
                if (!previous.found_existing) {
                    previous.value_ptr.* = .{};
                    previous.value_ptr.* = try OwnedValue.clone(c, stored.value_ptr.view()); previous.value_ptr.unresolved = true; changed = true;
                } else changed = (try previous.value_ptr.join(c, stored.value_ptr.view())) or changed;
            }
        }
        return changed;
    }
};

// This facet does not allocate raw objects, select calls, interpret an opcode,
// or solve SSA. Its input directories are derived by the ONE actual transfer.
// Root/Scope ordinals and root references must belong to those directories.
pub const Domain = struct {
    c: *Context,
    nodes: []const Node,
    scopes: []Scope,

    pub fn init(c: *Context, nodes: []const Node, scopes: []Scope) Error!Domain {
        try c.require(c.program.tables.mode == .common);
        try c.require(nodes.len <= 65536 and scopes.len <= 4096);
        for (nodes) |node| { try c.step(); try c.require(@intFromEnum(node.scope) < scopes.len); }
        return .{ .c = c, .nodes = nodes, .scopes = scopes };
    }
    pub fn load(self: *Domain, receiver: Value, slot: Slot, heap: *const Heap) Error!OwnedValue {
        var result = OwnedValue{ .known = true, .unresolved = !receiver.known or receiver.unresolved or receiver.empty or receiver.roots.len == 0 };
        errdefer result.deinit(self.c.allocator);
        for (receiver.roots) |root| {
            try self.c.step();
            if (heap.get(root, slot)) |stored| { _ = try result.join(self.c, stored); } else result.unresolved = true;
        }
        return result;
    }
    pub fn escape(self: *Domain, initial: Value, heap: *const Heap, hard: bool) Error!void {
        var pending: std.ArrayListUnmanaged(Root) = .empty; defer pending.deinit(self.c.allocator);
        var seen: RootSet = .empty; defer seen.deinit(self.c.allocator);
        try self.c.charge(initial.roots.len); try pending.appendSlice(self.c.allocator, initial.roots);
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try self.c.step(); const root = pending.items[cursor];
            const found = try seen.getOrPut(self.c.allocator, root); if (found.found_existing) continue;
            const node = self.nodes[@intFromEnum(root)]; const scope = &self.scopes[@intFromEnum(node.scope)];
            scope.blocked = true; scope.hard = scope.hard or hard;
            if (heap.nodes.getPtr(root)) |slots| {
                var slots_it = slots.valueIterator();
                while (slots_it.next()) |stored| { try self.c.charge(stored.roots.items.len + 1); try pending.appendSlice(self.c.allocator, stored.roots.items); }
            }
        }
    }
    pub fn store(self: *Domain, receiver: Value, slot: Slot, incoming: Value, heap: *Heap, hard: bool) Error!void {
        const c = self.c;
        var closed = receiver.known and !receiver.unresolved and !receiver.empty and receiver.roots.len != 0;
        for (incoming.roots) |referent| for (receiver.roots) |root| {
            try c.step(); closed = closed and heap.nodes.contains(root) and self.nodes[@intFromEnum(root)].scope == self.nodes[@intFromEnum(referent)].scope;
        };
        if (!closed and incoming.roots.len != 0) try self.escape(incoming, heap, hard);
        const strong = receiver.known and !receiver.unresolved and !receiver.empty and receiver.roots.len == 1;
        for (receiver.roots) |root| {
            try c.step(); const slots = heap.nodes.getPtr(root) orelse continue;
            if (slot == .length) {
                const old = slots.getPtr(.length);
                if (old != null and (incoming.number == null or old.?.unresolved or old.?.number == null or incoming.number.? < old.?.number.?)) {
                    var removed: std.ArrayListUnmanaged(Slot) = .empty; defer removed.deinit(c.allocator);
                    var keys = slots.keyIterator();
                    while (keys.next()) |key| {
                        try c.step(); if (key.* != .element) continue;
                        const index = key.element;
                        if (index == null or incoming.number == null or old.?.number == null or index.? >= @max(@as(i64, 0), incoming.number.?)) try removed.append(c.allocator, key.*);
                    }
                    for (removed.items) |key| { try c.step(); var discarded = slots.fetchRemove(key).?.value; discarded.deinit(c.allocator); }
                }
            }
            const prior = try slots.getOrPut(c.allocator, slot);
            if (!prior.found_existing) prior.value_ptr.* = .{};
            if (strong or !prior.found_existing) {
                var replacement = try OwnedValue.clone(c, incoming); errdefer replacement.deinit(c.allocator);
                if (!strong) replacement.unresolved = true;
                if (prior.found_existing) prior.value_ptr.deinit(c.allocator);
                prior.value_ptr.* = replacement;
            } else _ = try prior.value_ptr.join(c, incoming);
        }
    }
    // demanded is the post-phi live relation closure, INCLUDING relations
    // reached through its raw selected heap/Cells. The actual engine supplies
    // it at a real natural-loop feedback/exit cut; this kernel does not guess
    // liveness, a header or transport from callback order/source spelling.
    pub fn cut(self: *Domain, demanded: []const Value, globals: []const Value, registers: []OwnedValue, heap: *Heap) Error!void {
        for (demanded) |selected| { try self.c.step(); try self.escape(selected, heap, false); }
        for (globals) |selected| { try self.c.step(); try self.escape(selected, heap, true); }
        for (registers) |*stored| try stored.age(self.c);
        // Raw values/heaps and old BorrowFlow definitions are not modified.
        var nodes_it = heap.nodes.valueIterator();
        while (nodes_it.next()) |slots| {
            try self.c.step(); var stored_it = slots.valueIterator();
            while (stored_it.next()) |stored| try self.c.charge(stored.roots.items.len + 1);
        }
        heap.deinit(self.c.allocator);
    }
    // The actual call consumer supplies ALL affected birth scopes from the
    // complete permitted-target boundary, never just the observed narrow arms.
    // A soft transport blocker and a hard escape retain different meanings.
    pub fn boundary(self: *Domain, affected: []const ScopeRef, hard: bool) Error!void {
        for (affected) |scope_ref| {
            try self.c.step(); const scope = &self.scopes[@intFromEnum(scope_ref)];
            scope.blocked = true; scope.hard = scope.hard or hard;
        }
    }
    pub fn returned(self: *Domain, scope: ?ScopeRef, root_context: bool, returned_value: Value, heap: *const Heap) Error!void {
        for (returned_value.roots) |root| {
            try self.c.step(); if (scope == null or self.nodes[@intFromEnum(root)].scope != scope.?) { try self.escape(returned_value, heap, root_context); break; }
        }
    }
};

const Edge = struct { value: Value, nonowning: bool };
const ProjectedNode = struct {
    root: Root,
    kind: facts.ObjectKind,
    element: ?t.TypeRef = null,
    fields: []const Edge = &.{},
    owner: ?Value = null,
};

// Compact selected VERSION graph, captured only at a return/storage obligation.
// No raw heap is retained. It can be evaluated after every caller cut/escape.
pub const Holding = struct {
    arena: std.heap.ArenaAllocator,
    scope: ?ScopeRef,
    root: Value = .{},
    nodes: std.ArrayListUnmanaged(ProjectedNode) = .empty,
    positions: std.AutoHashMapUnmanaged(Root, usize) = .empty,
    complete: bool = true,
    stable_complete: bool = true,
    stable_projection: bool,

    pub fn deinit(self: *Holding) void { self.arena.deinit(); }
    fn copied(self: *Holding, c: *Context, original: Value) Error!Value {
        try c.charge(original.roots.len + 1); const roots = try self.arena.allocator().dupe(Root, original.roots);
        var result = original; result.roots = roots; return result;
    }
    pub fn capture(domain: *Domain, world: facts.WorldView, scope: ?ScopeRef, initial: Value, heap: *const Heap, stable_projection: bool) Error!Holding {
        const c = domain.c;
        if (scope) |scope_ref| try c.require(@intFromEnum(scope_ref) < domain.scopes.len);
        var result = Holding{ .arena = std.heap.ArenaAllocator.init(c.allocator), .scope = scope, .stable_projection = stable_projection };
        errdefer result.deinit(); result.root = try result.copied(c, initial);
        result.complete = scope != null and initial.known and !initial.unresolved and initial.roots.len != 0;
        result.stable_complete = !initial.empty;
        var pending: std.ArrayListUnmanaged(Root) = .empty; defer pending.deinit(c.allocator);
        try c.charge(initial.roots.len); try pending.appendSlice(c.allocator, initial.roots);
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const root = pending.items[cursor]; if (result.positions.contains(root)) continue;
            try c.require(@intFromEnum(root) < domain.nodes.len);
            const origin = domain.nodes[@intFromEnum(root)];
            if (scope == null or origin.scope != scope.?) result.complete = false;
            try c.require(@intFromEnum(origin.reference) < world.objects.len);
            const shape = world.object(origin.reference);
            var projected = ProjectedNode{ .root = root, .kind = shape.kind };
            try result.positions.put(result.arena.allocator(), root, result.nodes.items.len);
            // Absence is not an initialized empty version.
            const slots = heap.nodes.getPtr(root);
            if (slots == null) { result.complete = false; try result.nodes.append(result.arena.allocator(), projected); continue; }
            if (shape.kind == .environment) {
                if (shape.environment) |layout_ref| {
                    const layout = c.program.tables.mode.common.closures.environments[@intFromEnum(layout_ref)];
                    for (layout.slots, 0..) |slot, i| {
                        try c.step(); const stored = heap.get(root, .{ .environment_slot = @enumFromInt(i) });
                        if (stored == null) { result.complete = false; continue; }
                        const child = stored.?; const kind = c.program.tables.mode.common.types[@intFromEnum(slot.@"type")].kind;
                        const childless = kind == .scalar or kind == .string;
                        const scalar_array = if (kind == .array) blk: {
                            const element = c.program.tables.mode.common.types[@intFromEnum(slot.@"type")].element;
                            break :blk element != null and c.program.tables.mode.common.types[@intFromEnum(element.?)].kind == .scalar;
                        } else false;
                        const inline_value = kind == .value and child.known and !child.empty and !child.unresolved and child.roots.len != 0;
                        const mutable_array = stable_projection and slot.writable and scalar_array and child.known and !child.empty and !child.unresolved and child.roots.len != 0;
                        const scalar_only = childless and child.known and child.empty and !child.unresolved and child.roots.len == 0;
                        if (slot.writable and !inline_value and !mutable_array and !scalar_only) result.stable_complete = false;
                        if (!childless and (child.empty or child.roots.len == 0)) result.stable_complete = false;
                        if (stable_projection and (!child.known or child.unresolved or (!child.empty and child.roots.len == 0))) result.complete = false;
                    }
                    if (layout.parent != null and heap.get(root, .parent) == null) result.complete = false;
                } else result.complete = false;
            } else if (shape.@"type") |type_ref| {
                const types = c.program.tables.mode.common.types;
                const typed = types[@intFromEnum(type_ref)]; projected.element = typed.element;
                if (typed.kind == .reference or typed.kind == .value) {
                    var current: ?t.TypeRef = type_ref;
                    while (current) |owner| {
                        try c.step();
                        for (c.program.tables.mode.common.members.fields, 0..) |field, i| {
                            try c.step(); if (field.owner != owner) continue;
                            const stored = heap.get(root, .{ .field = @enumFromInt(i) });
                            if (stored == null) { result.complete = false; continue; }
                            const kind = types[@intFromEnum(field.@"type")].kind;
                            const scalar_only = (kind == .scalar or kind == .string) and stored.?.known and stored.?.empty and !stored.?.unresolved and stored.?.roots.len == 0;
                            if (typed.kind != .value and !field.readonly and !scalar_only) result.stable_complete = false;
                        }
                        current = types[@intFromEnum(owner)].base;
                    }
                } else if ((typed.kind != .array and typed.kind != .readSpan) or typed.element == null or types[@intFromEnum(typed.element.?)].kind != .scalar) result.stable_complete = false;
            } else result.complete = false;
            if (shape.kind == .read_span) {
                if (heap.get(root, .span_owner)) |owner| projected.owner = try result.copied(c, owner) else result.complete = false;
            }
            var edges: std.ArrayListUnmanaged(Edge) = .empty;
            var slots_it = slots.?.iterator();
            while (slots_it.next()) |stored| {
                try c.step(); const child = stored.value_ptr.view();
                if (!child.known or child.unresolved) result.complete = false;
                try c.charge(child.roots.len); try pending.appendSlice(c.allocator, child.roots);
                var selected = false; var nonowning = false;
                switch (stored.key_ptr.*) {
                    .field => |field| {
                        selected = shape.kind == .reference or shape.kind == .value;
                        nonowning = stable_projection and !c.program.tables.mode.common.members.fields[@intFromEnum(field)].readonly;
                    },
                    .environment_slot => |slot| {
                        selected = shape.kind == .environment;
                        if (shape.environment) |layout_ref| {
                            const row = c.program.tables.mode.common.closures.environments[@intFromEnum(layout_ref)].slots[@intFromEnum(slot)];
                            const typed = c.program.tables.mode.common.types[@intFromEnum(row.@"type")];
                            nonowning = stable_projection and row.writable and typed.kind == .array and typed.element != null and
                                c.program.tables.mode.common.types[@intFromEnum(typed.element.?)].kind == .scalar;
                        }
                    },
                    .parent => selected = shape.kind == .environment,
                    .element => |index| if (shape.kind == .array) {
                        if (heap.get(root, .length)) |length| selected = index != null and length.known and !length.unresolved and length.number != null and
                            index.? >= 0 and index.? < length.number.? and heap.get(root, .{ .element = null }) == null;
                        if (stable_projection) selected = true;
                        nonowning = stable_projection;
                    },
                    else => {}, // Span.owner is inspected, NEVER an owning edge.
                }
                if (child.roots.len != 0 and shape.kind != .environment and shape.kind != .reference and shape.kind != .value and
                    !(shape.kind == .read_span and stored.key_ptr.* == .span_owner)) result.stable_complete = false;
                if (selected) try edges.append(result.arena.allocator(), .{ .value = try result.copied(c, child), .nonowning = nonowning });
            }
            projected.fields = try edges.toOwnedSlice(result.arena.allocator());
            try result.nodes.append(result.arena.allocator(), projected);
        }
        return result;
    }

    // Version-level booleans answer one descriptor/owner pair. This is not a
    // copy of Borrow's raw strong/must owner-set graph. Array versions are the
    // base fact; fields coexist (OR), alternatives meet (AND). The second least
    // fixed point meets only paths which can carry this descriptor, retaining
    // each selected prefix's unconditional ownership. Cycles start at false.
    fn pair(self: *const Holding, c: *Context, descriptor: Root, owner: Root) Error!bool {
        const n = self.nodes.items.len; try c.charge(3 * n);
        const held = try c.allocator.alloc(bool, n); defer c.allocator.free(held); @memset(held, false);
        const reaches = try c.allocator.alloc(bool, n); defer c.allocator.free(reaches); @memset(reaches, false);
        const conditional = try c.allocator.alloc(bool, n); defer c.allocator.free(conditional); @memset(conditional, false);
        var changed = true;
        while (changed) {
            changed = false;
            for (self.nodes.items, 0..) |node, i| {
                try c.step(); var next = node.kind == .array and node.root == owner;
                for (node.fields) |edge| {
                    try c.step(); if (self.stable_projection and edge.nonowning) continue;
                    var guaranteed = edge.value.known and !edge.value.unresolved and !edge.value.empty and edge.value.roots.len != 0;
                    for (edge.value.roots) |root| { try c.step(); guaranteed = guaranteed and held[self.positions.get(root).?]; }
                    next = next or guaranteed;
                }
                if (next and !held[i]) { held[i] = true; changed = true; }
            }
        }
        changed = true;
        while (changed) {
            changed = false;
            for (self.nodes.items, 0..) |node, i| {
                try c.step(); var next = node.root == descriptor;
                for (node.fields) |edge| {
                    try c.step(); next = next or edge.value.unresolved;
                    for (edge.value.roots) |root| { try c.step(); next = next or reaches[self.positions.get(root).?]; }
                }
                if (next and !reaches[i]) { reaches[i] = true; changed = true; }
            }
        }
        changed = true;
        while (changed) {
            changed = false;
            for (self.nodes.items, 0..) |node, i| {
                try c.step(); if (!reaches[i]) continue;
                var all_paths = true; var any_path = false;
                for (node.fields) |edge| {
                    try c.step(); var relevant = edge.value.unresolved; var selected = !edge.value.unresolved;
                    for (edge.value.roots) |root| {
                        try c.step(); const index = self.positions.get(root).?;
                        if (reaches[index]) { relevant = true; selected = selected and conditional[index]; }
                    }
                    if (relevant) { any_path = true; all_paths = all_paths and selected; }
                }
                const next = held[i] or (any_path and all_paths);
                if (next and !conditional[i]) { conditional[i] = true; changed = true; }
            }
        }
        var unconditional = self.root.known and !self.root.unresolved and !self.root.empty and self.root.roots.len != 0;
        var selected = !self.root.unresolved; var any_path = false;
        for (self.root.roots) |root| {
            try c.step(); const index = self.positions.get(root).?; unconditional = unconditional and held[index];
            if (reaches[index]) { any_path = true; selected = selected and conditional[index]; }
        }
        return unconditional or (any_path and selected);
    }
    pub fn evaluate(self: *const Holding, domain: *Domain, stable_return: bool) Error!Outcome {
        const c = domain.c; try c.step();
        if (!self.complete or self.scope == null or (stable_return and !self.stable_complete)) return .unresolved;
        const scope = domain.scopes[@intFromEnum(self.scope.?)];
        if (scope.hard or (!stable_return and scope.blocked)) return .disproved;
        var descriptors: usize = 0;
        for (self.nodes.items) |node| {
            try c.step(); const owner_value = node.owner orelse continue; descriptors += 1;
            if (!owner_value.known or owner_value.unresolved) return .unresolved;
            if (owner_value.empty or owner_value.roots.len == 0) return .disproved;
            for (owner_value.roots) |owner| {
                try c.step(); const index = self.positions.get(owner) orelse return .unresolved;
                const candidate = self.nodes.items[index];
                if (candidate.kind != .array or candidate.element == null or candidate.element != node.element) return .disproved;
                if (!try self.pair(c, node.root, owner)) return .disproved;
            }
        }
        return if (descriptors != 0) .proved else .unresolved;
    }
};

fn slotObject(slot: facts.Slot) ?facts.ObjectId {
    return switch (slot) {
        .field => |v| v.object, .element => |v| v.object,
        .length, .span_owner, .span_start, .span_length, .parent => |v| v,
        .environment_slot => |v| v.object, .capture => |v| v.object,
        .cell, .global => null,
    };
}

// This observer only revokes birth scopes. It never creates a root, relation
// edge, scope or successful holding answer. The actual engine must additionally
// feed the Domain's relation operations at allocation/copy/store/call/cut sites.
// In particular, unknown/incomplete call hard boundaries cannot be deduced from
// a narrower observed target set and are not certified complete by this adapter.
pub const HardEscapes = struct {
    domain: *Domain,

    pub fn init(domain: *Domain) HardEscapes { return .{ .domain = domain }; }
    pub fn observe(self: *HardEscapes, _: facts.WorldView, initial: facts.Value, heap: facts.HeapView) Error!void {
        const c = self.domain.c;
        var pending: std.ArrayListUnmanaged(facts.Value) = .empty; defer pending.deinit(c.allocator);
        var objects: std.AutoHashMapUnmanaged(facts.ObjectId, void) = .empty; defer objects.deinit(c.allocator);
        var cells: std.AutoHashMapUnmanaged(facts.CellId, void) = .empty; defer cells.deinit(c.allocator);
        try c.step(); try pending.append(c.allocator, initial); var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const selected = pending.items[cursor];
            for (selected.cells) |cell| {
                try c.step(); const found = try cells.getOrPut(c.allocator, cell); if (found.found_existing) continue;
                if (heap.get(.{ .cell = cell })) |stored| { try c.step(); try pending.append(c.allocator, stored); }
            }
            var references: std.ArrayListUnmanaged(facts.ObjectId) = .empty; defer references.deinit(c.allocator);
            try c.charge(selected.objects.len); try references.appendSlice(c.allocator, selected.objects);
            for (selected.callables) |pair| { try c.step(); if (pair.environment) |environment| try references.append(c.allocator, environment); }
            for (references.items) |object| {
                try c.step(); const found = try objects.getOrPut(c.allocator, object); if (found.found_existing) continue;
                for (self.domain.nodes) |node| {
                    try c.step(); if (node.reference != object) continue;
                    const scope = &self.domain.scopes[@intFromEnum(node.scope)]; scope.blocked = true; scope.hard = true;
                }
                var slots = heap.iterator();
                while (slots.next()) |stored| {
                    try c.step(); if (slotObject(stored.slot) == object) try pending.append(c.allocator, stored.value);
                }
            }
        }
    }
    pub fn observer(self: *HardEscapes) facts.Observer {
        return .{ .client = self, .before = before, .completed = completed };
    }
    fn before(pointer: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const self: *HardEscapes = @ptrCast(@alignCast(pointer));
        const op = self.domain.c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        if (op.data == .global_store) try self.observe(world, state.values.reg(op.operands[0]), state.heap);
        if (op.data == .authorized_host) for (op.operands) |reg| { try self.domain.c.step(); try self.observe(world, state.values.reg(reg), state.heap); };
    }
    fn completed(pointer: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, completion: facts.Completion, value: facts.Value, heap: facts.HeapView) Error!void {
        const self: *HardEscapes = @ptrCast(@alignCast(pointer));
        if (completion != .request_trap and world.invocation(site.context).root) try self.observe(world, value, heap);
    }
};
