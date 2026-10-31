// SPDX-License-Identifier: MIT
// Shared actual identity and current-allocation relation data. These types
// carry observations from one actual transfer, not admission or Runtime handles.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const shared = @This();
pub const Context = context.Context;
pub const Error = context.Error;
pub const ContextId = enum(u32) { _ };
pub const ObjectId = enum(u32) { _ };
pub const CellId = enum(u32) { _ };
pub const Location = struct { function: t.FunctionRef, block: t.BlockRef, instruction: u16 };
pub const Site = struct { context: ContextId, location: Location };
pub const Root = enum(u32) { _ };
pub const ScopeRef = enum(u16) { _ };

pub const Value = struct {
    roots: []const Root = &.{},
    known: bool = false,
    unresolved: bool = false,
    empty: bool = false,
    number: ?i64 = null,
};
pub fn equal(c: *Context, left: Value, right: Value) Error!bool {
    try c.charge(5);
    if (left.known != right.known or left.unresolved != right.unresolved or left.empty != right.empty or left.number != right.number or left.roots.len != right.roots.len) return false;
    for (left.roots, right.roots) |a, b| { try c.step(); if (a != b) return false; }
    return true;
}
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
        try c.charge(source.roots.len + 1);
        var result = OwnedValue{ .known = source.known, .unresolved = source.unresolved, .empty = source.empty, .number = source.number };
        errdefer result.deinit(c.allocator);
        try result.roots.appendSlice(c.allocator, source.roots); return result;
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

// A root is an allocation VERSION supplied by the same transfer. reference is
// only a raw alias family used to revoke scopes after roots have been aged.
pub const Node = struct { scope: ScopeRef, reference: ObjectId };
pub const Scope = struct {
    function: t.FunctionRef,
    // Representative for reporting only. Distinct argument/heap contexts can
    // describe one physical activation; no equality/uniqueness follows here.
    activation: ContextId,
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
    // A real allocation birth resets the version, including an empty object.
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
    pub fn equal(self: *const Heap, c: *Context, other: *const Heap) Error!bool {
        try c.step(); if (self.nodes.count() != other.nodes.count()) return false;
        var nodes_it = self.nodes.iterator();
        while (nodes_it.next()) |entry| {
            try c.step(); const slots = other.nodes.getPtr(entry.key_ptr.*) orelse return false;
            if (entry.value_ptr.count() != slots.count()) return false;
            var slots_it = entry.value_ptr.iterator();
            while (slots_it.next()) |stored| {
                try c.step(); const selected = slots.getPtr(stored.key_ptr.*) orelse return false;
                if (!try shared.equal(c, stored.value_ptr.view(), selected.view())) return false;
            }
        }
        return true;
    }
    pub fn clone(c: *Context, source: *const Heap) Error!Heap {
        var result: Heap = .{}; errdefer result.deinit(c.allocator);
        try result.overlay(c, source); return result;
    }
    // A callee completion replaces every selected node it actually supplies;
    // caller nodes absent from that completion remain present.
    pub fn overlay(self: *Heap, c: *Context, source: *const Heap) Error!void {
        try c.step(); if (self == source) return;
        var nodes_it = source.nodes.iterator();
        while (nodes_it.next()) |entry| {
            try c.step(); var copied: Slots = .empty;
            errdefer {
                var values_it = copied.valueIterator(); while (values_it.next()) |stored| stored.deinit(c.allocator);
                copied.deinit(c.allocator);
            }
            var slots_it = entry.value_ptr.iterator();
            while (slots_it.next()) |stored| {
                try c.step(); var selected = try OwnedValue.clone(c, stored.value_ptr.view()); errdefer selected.deinit(c.allocator);
                try copied.put(c.allocator, stored.key_ptr.*, selected);
            }
            const destination = try self.nodes.getOrPut(c.allocator, entry.key_ptr.*);
            if (destination.found_existing) {
                try c.charge(destination.value_ptr.count());
                var values_it = destination.value_ptr.valueIterator(); while (values_it.next()) |stored| stored.deinit(c.allocator);
                destination.value_ptr.deinit(c.allocator);
            }
            destination.value_ptr.* = copied;
        }
    }
    pub fn join(self: *Heap, c: *Context, source: *const Heap) Error!bool {
        // Missing slots on either incoming path are unproved, not empty.
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
