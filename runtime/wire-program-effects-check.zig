// SPDX-License-Identifier: MIT
// Passive Common actual-effects subsumption, using the one actual solver's
// final read-only replay, plus the original normalized graph's independent
// complete-upper OWNER flow. That flow never produces actual values, targets,
// allocation versions or an actual World. Origins grant no allocation proof.
// References/layout/SSA/identity and complete fixed publication/flow remain
// separate prerequisites. Complete Host material, when present, must have been
// checked once by the public boundary against this Runtime's compiled anchor;
// matching package digests or a nonnull pointer alone never supply that proof.
// Success checks these observations against declared bounds; it is not Host,
// Runtime, kernel, borrow, Source, fixed-flow or execution admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const publication = @import("wire-program-publication.zig");
const facts = @import("wire-program-actual-facts.zig");
const host_binding = @import("wire-program-host-binding-check.zig");
const effect_env = @import("wire-program-effect-environments.zig");
const origin_model = @import("wire-program-return-origin-model.zig");
const construction_origins = @import("wire-program-return-origin-construction.zig");
const publication_refs = @import("wire-program-publication-refs.zig");
const body_origins = @import("wire-program-return-origin-body.zig");
const structural_origins = @import("wire-program-return-origins.zig");
const fixed_owners = @import("wire-program-return-origin-owners.zig");
const actual_targets = @import("wire-program-targets-check.zig");
const t = model.types;
const Context = facts.Context;
pub const Error = facts.Error;
pub const FinishError = Error || error{ FixedUpperEffectOriginPending, FixedUpperHostBindingPending };
const Access = enum { read, write, structural };
const Facet = enum { allocation, managed_reference, eh_control, may_throw, @"await", lock, escape, unknown_host };
const Capture = struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef };
const Managed = enum { empty, active, no, yes };

// Names in the fixed owner/content equations. They are not runtime objects or
// allocation generations; rebirth makes every prior reference unknown.
const PayloadOrigin = struct {
    type_id: t.TypeRef,
    source: union(enum) { birth: t.RegisterRef, fixed: effect_env.Fixed },
};
fn payloadKeyWork(c: *Context, key: PayloadOrigin) Error!void {
    try c.row(PayloadOrigin);
    if (key.source == .fixed) { try c.row(effect_env.Fixed); try c.row(effect_env.Invocation); }
}
const PayloadSet = struct {
    unknown: bool = false,
    items: std.ArrayListUnmanaged(PayloadOrigin) = .empty,
    fn deinit(self: *PayloadSet, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.* = .{}; }
    fn add(self: *PayloadSet, c: *Context, key: PayloadOrigin) Error!bool {
        for (self.items.items) |old| { try payloadKeyWork(c, key); if (std.meta.eql(old, key)) return false; }
        try payloadKeyWork(c, key); if (self.items.items.len == self.items.capacity) try c.charge(self.items.items.len + 1);
        try self.items.append(c.allocator, key); return true;
    }
    fn clone(c: *Context, source: *const PayloadSet) Error!PayloadSet {
        try c.charge(source.items.items.len + 1); var result = PayloadSet{ .unknown = source.unknown }; errdefer result.deinit(c.allocator);
        for (source.items.items) |key| try payloadKeyWork(c, key);
        try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    fn join(self: *PayloadSet, c: *Context, source: *const PayloadSet) Error!bool {
        try c.step(); var changed = source.unknown and !self.unknown; self.unknown = self.unknown or source.unknown;
        for (source.items.items) |key| changed = (try self.add(c, key)) or changed;
        return changed;
    }
    fn age(self: *PayloadSet, c: *Context, birth: ?t.RegisterRef, invocation: ?effect_env.Invocation) Error!void {
        var index: usize = 0;
        while (index < self.items.items.len) {
            const key = self.items.items[index]; try payloadKeyWork(c, key);
            const old = if (birth) |reg| key.source == .birth and key.source.birth == reg else key.source == .fixed and std.meta.eql(key.source.fixed.invocation, invocation.?);
            if (old) { _ = self.items.swapRemove(index); self.unknown = true; } else index += 1;
        }
    }
};

// The normalized fixed graph has a different domain from actual replay: only
// lexical effect roots cross its CFG. Fresh locals have no external root;
// unknown call/exception results retain an explicit unresolved root. They are
// not used as actual tags, code sets, heap entries or callable permissions.
const Owner = union(enum) { parameter: usize, global: t.GlobalRef, capture: Capture, local: void, unresolved: void };
const Owners = struct {
    // Bottom is an as-yet uncomputed RESULT, not an empty alias proof. A
    // represented nonowning value is a separate atom, not just an empty set.
    // Managed local definitions have a local atom, never an allocation/holding
    // identity. This is GraphEffects' lexical local: root category only.
    nonowning: bool = false,
    items: std.ArrayListUnmanaged(Owner) = .empty,
    environments: effect_env.Value = .{},
    payloads: PayloadSet = .{},
    fn known(self: *const Owners) bool { return self.nonowning or self.items.items.len != 0 or self.payloads.items.items.len != 0; }
    fn deinit(self: *Owners, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.environments.deinit(allocator); self.payloads.deinit(allocator); self.* = .{}; }
    fn add(self: *Owners, c: *Context, owner: Owner) Error!bool {
        // A lexical permission root says nothing about its value's code/env.
        for (self.items.items) |old| { try c.step(); if (std.meta.eql(old, owner)) return false; }
        try c.step(); try self.items.append(c.allocator, owner); return true;
    }
    fn makeOpaque(self: *Owners, c: *Context) Error!bool {
        const changed = !self.environments.callable_unknown or !self.environments.direct.unknown or !self.payloads.unknown;
        self.environments.callable_unknown = true; self.environments.direct.unknown = true;
        self.payloads.unknown = true;
        return (try self.add(c, .unresolved)) or changed;
    }
    fn clone(c: *Context, source: *const Owners) Error!Owners {
        try c.charge(source.items.items.len + 1); var result = Owners{ .nonowning = source.nonowning };
        errdefer result.deinit(c.allocator); result.environments = try effect_env.Value.clone(c, &source.environments); result.payloads = try PayloadSet.clone(c, &source.payloads);
        try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    fn join(self: *Owners, c: *Context, incoming: *const Owners) Error!bool {
        try c.step(); var changed = try self.environments.join(c, &incoming.environments);
        changed = (try self.payloads.join(c, &incoming.payloads)) or changed;
        changed = (incoming.nonowning and !self.nonowning) or changed; self.nonowning = self.nonowning or incoming.nonowning;
        for (incoming.items.items) |owner| changed = (try self.add(c, owner)) or changed;
        return changed;
    }
    fn replace(self: *Owners, c: *Context, source: *const Owners) Error!void {
        const replacement = try Owners.clone(c, source); self.deinit(c.allocator); self.* = replacement;
    }
};

const PayloadRecord = struct {
    // null is unknown/uninitialized. A present, empty Owners is the genuinely
    // empty Array element cell, never a scalar or an empty-payload proof.
    slots: []?Owners,
    fn init(c: *Context, count: usize) Error!PayloadRecord {
        try c.charge(count + 1); const slots = try c.allocator.alloc(?Owners, count); @memset(slots, null); return .{ .slots = slots };
    }
    fn deinit(self: *PayloadRecord, c: *Context) void { for (self.slots) |*slot| if (slot.*) |*value| value.deinit(c.allocator); c.allocator.free(self.slots); }
    fn clone(c: *Context, source: *const PayloadRecord) Error!PayloadRecord {
        var result = try PayloadRecord.init(c, source.slots.len); errdefer result.deinit(c);
        for (source.slots, result.slots) |*slot, *into| { try c.step(); if (slot.*) |*value| into.* = try Owners.clone(c, value); }
        return result;
    }
    fn join(self: *PayloadRecord, c: *Context, source: *const PayloadRecord) Error!bool {
        try c.require(self.slots.len == source.slots.len); var changed = false;
        for (self.slots, source.slots) |*slot, *incoming| {
            try c.step(); if (slot.*) |*value| {
                if (incoming.*) |*other| changed = (try value.join(c, other)) or changed else { value.deinit(c.allocator); slot.* = null; changed = true; }
            }
        }
        return changed;
    }
};


// Callee-relative lexical roots, never an actual result or selected heap.
// A result not yet derived is bottom only during private fixed-point work,
// never an empty owner proof. After that closure, missing result values acquire
// unresolved and propagate again before any effect permission is validated.
const PrivateAggregate = struct { actual_type: t.TypeRef, concrete: usize, block: usize, instruction: usize };
const AliasSummary = struct {
    normal: Owners = .{},
    language: Owners = .{},
    normal_seen: bool = false,
    language_seen: bool = false,
    normal_missing: bool = false,
    language_missing: bool = false,
    available: bool = false,
    transparent: bool = true,
    lexical_cells: bool = false,
    aggregates: std.AutoHashMapUnmanaged(t.RegisterRef, PrivateAggregate) = .empty,
    aggregate_handles: std.AutoHashMapUnmanaged(t.RegisterRef, t.RegisterRef) = .empty,
    fn deinit(self: *AliasSummary, allocator: std.mem.Allocator) void { self.normal.deinit(allocator); self.language.deinit(allocator); self.aggregates.deinit(allocator); self.aggregate_handles.deinit(allocator); }
};
const AliasLink = struct { from: usize, to: usize };
const AliasVisit = struct { function: usize, next: usize = 0 };
const UpperCompletions = struct {
    normal: bool = true, language: bool = false, language_state: ?UpperState = null,
    fn deinit(self: *UpperCompletions, c: *Context) void { if (self.language_state) |*state| state.deinit(c); self.language_state = null; }
};
// A logical Cell has no receiver; a private field uses its original SSA
// allocation handle. A closed same-block Cell protocol can share that key.
// Neither key is an ObjectID or dynamic version: storage is still lexical.
const OwnerSlot = struct { binding: t.BindingRef, receiver: ?t.RegisterRef = null, environment: ?effect_env.Origin = null };
const UpperState = struct {
    values: []Owners,
    slots: std.AutoHashMapUnmanaged(OwnerSlot, Owners) = .empty,
    parents: std.AutoHashMapUnmanaged(effect_env.Origin, effect_env.Set) = .empty,
    payloads: std.AutoHashMapUnmanaged(PayloadOrigin, PayloadRecord) = .empty,
    fn init(c: *Context, registers: usize) Error!UpperState {
        try c.charge(registers + 1);
        const values = try c.allocator.alloc(Owners, registers); errdefer c.allocator.free(values); @memset(values, .{});
        return .{ .values = values };
    }
    fn deinit(self: *UpperState, c: *Context) void {
        for (self.values) |*value| value.deinit(c.allocator); c.allocator.free(self.values);
        var entries = self.slots.valueIterator(); while (entries.next()) |value| value.deinit(c.allocator); self.slots.deinit(c.allocator);
        var parents = self.parents.valueIterator(); while (parents.next()) |value| value.deinit(c.allocator); self.parents.deinit(c.allocator);
        var payloads = self.payloads.valueIterator(); while (payloads.next()) |value| value.deinit(c); self.payloads.deinit(c.allocator);
    }
    fn clone(c: *Context, source: *const UpperState) Error!UpperState {
        var result = try UpperState.init(c, source.values.len); errdefer result.deinit(c);
        for (source.values, result.values) |*value, *copy| copy.* = try Owners.clone(c, value);
        var entries = source.slots.iterator(); while (entries.next()) |slot| {
            try c.step(); var copy = try Owners.clone(c, slot.value_ptr); errdefer copy.deinit(c.allocator);
            try result.slots.put(c.allocator, slot.key_ptr.*, copy);
        }
        var parents = source.parents.iterator(); while (parents.next()) |entry| {
            try c.step(); var copy = try effect_env.Set.clone(c, entry.value_ptr); errdefer copy.deinit(c.allocator);
            try result.parents.put(c.allocator, entry.key_ptr.*, copy);
        }
        try c.charge(source.payloads.capacity() + 1); var payloads = source.payloads.iterator(); while (payloads.next()) |entry| {
            try payloadKeyWork(c, entry.key_ptr.*); var copy = try PayloadRecord.clone(c, entry.value_ptr); errdefer copy.deinit(c);
            try result.putPayload(c, entry.key_ptr.*, copy);
        }
        return result;
    }
    fn join(self: *UpperState, c: *Context, source: *const UpperState) Error!bool {
        var changed = false;
        for (self.values, source.values) |*value, *incoming| changed = (try value.join(c, incoming)) or changed;
        // A Cell or private field absent on either path is uninitialized, not
        // a known local empty value. Preserve that alternative at the join.
        var previous = self.slots.iterator(); while (previous.next()) |slot| {
            try c.step(); if (!source.slots.contains(slot.key_ptr.*)) {
                // A fixed graph namespace is born with its complete checked
                // slot directory. Its absence on another target alternative
                // means that namespace was not born on that alternative.
                if (slot.key_ptr.environment) |origin| if (origin.source == .fixed) continue;
                changed = (try slot.value_ptr.makeOpaque(c)) or changed;
            }
        }
        var entries = source.slots.iterator(); while (entries.next()) |slot| {
            try c.step(); const destination = try self.slots.getOrPut(c.allocator, slot.key_ptr.*);
            if (!destination.found_existing) {
                destination.value_ptr.* = .{};
                const conditional = if (slot.key_ptr.environment) |origin| origin.source == .fixed else false;
                if (!conditional) _ = try destination.value_ptr.makeOpaque(c); changed = true;
            }
            changed = (try destination.value_ptr.join(c, slot.value_ptr)) or changed;
        }
        var old_parents = self.parents.iterator(); while (old_parents.next()) |entry| {
            try c.step(); if (!source.parents.contains(entry.key_ptr.*) and entry.key_ptr.source != .fixed and !entry.value_ptr.unknown) { entry.value_ptr.unknown = true; changed = true; }
        }
        var parents = source.parents.iterator(); while (parents.next()) |entry| {
            try c.step(); const destination = try self.parents.getOrPut(c.allocator, entry.key_ptr.*);
            if (!destination.found_existing) { destination.value_ptr.* = .{ .unknown = entry.key_ptr.source != .fixed }; changed = true; }
            changed = (try destination.value_ptr.join(c, entry.value_ptr)) or changed;
        }
        try c.charge(source.payloads.capacity() + 1); var payloads = source.payloads.iterator(); while (payloads.next()) |entry| {
            try payloadKeyWork(c, entry.key_ptr.*);
            if (self.payloads.getPtr(entry.key_ptr.*)) |old| changed = (try old.join(c, entry.value_ptr)) or changed else {
                var copy = try PayloadRecord.clone(c, entry.value_ptr); errdefer copy.deinit(c);
                try self.putPayload(c, entry.key_ptr.*, copy); changed = true;
            }
        }
        return changed;
    }
    fn putPayload(self: *UpperState, c: *Context, key: PayloadOrigin, value: PayloadRecord) Error!void {
        try payloadKeyWork(c, key);
        if (self.payloads.getPtr(key)) |old| { old.deinit(c); old.* = value; return; }
        try c.charge(self.payloads.capacity() + 4 * (self.payloads.count() + 1) + 1);
        try self.payloads.ensureUnusedCapacity(c.allocator, 1);
        self.payloads.putAssumeCapacity(key, value);
    }
    fn agePayloads(self: *UpperState, c: *Context, birth_site: ?t.RegisterRef, invocation: ?effect_env.Invocation) Error!void {
        for (self.values) |*value| { try c.step(); try value.payloads.age(c, birth_site, invocation); }
        try c.charge(self.slots.capacity() + 1); var selected = self.slots.valueIterator(); while (selected.next()) |value| { try c.step(); try value.payloads.age(c, birth_site, invocation); }
        var remove: std.ArrayListUnmanaged(PayloadOrigin) = .empty; defer remove.deinit(c.allocator);
        try c.charge(self.payloads.capacity() + 1); var entries = self.payloads.iterator(); while (entries.next()) |entry| {
            const key = entry.key_ptr.*; try payloadKeyWork(c, key);
            const old = if (birth_site) |reg| key.source == .birth and key.source.birth == reg else key.source == .fixed and std.meta.eql(key.source.fixed.invocation, invocation.?);
            if (old) {
                if (remove.items.len == remove.capacity) try c.charge(remove.items.len + 1);
                try remove.append(c.allocator, key);
            }
            for (entry.value_ptr.slots) |*slot| {
                try c.step(); if (slot.*) |*value| {
                    try value.payloads.age(c, birth_site, invocation);
                    if (birth_site) |reg| try value.environments.age(c, reg) else try value.environments.ageFixed(c, invocation.?);
                }
            }
        }
        for (remove.items) |key| { try payloadKeyWork(c, key); var old = self.payloads.fetchRemove(key).?.value; old.deinit(c); }
    }
    fn birthPayload(self: *UpperState, c: *Context, reg: t.RegisterRef, type_id: t.TypeRef, count: usize) Error!PayloadOrigin {
        try self.agePayloads(c, reg, null);
        const key = PayloadOrigin{ .type_id = type_id, .source = .{ .birth = reg } };
        var record = try PayloadRecord.init(c, count); errdefer record.deinit(c);
        try self.putPayload(c, key, record); return key;
    }
    fn store(self: *UpperState, c: *Context, slot: OwnerSlot, value: *const Owners) Error!void {
        try c.step(); const destination = try self.slots.getOrPut(c.allocator, slot);
        if (!destination.found_existing) destination.value_ptr.* = .{};
        try destination.value_ptr.replace(c, value);
    }
    fn birth(self: *UpperState, c: *Context, handle: t.RegisterRef, layout: t.EnvironmentRef, parent: *const effect_env.Set) Error!void {
        try self.agePayloads(c, handle, null);
        // A static SSA definition is not an instance ID. Age every old value,
        // callable association and selected relation before reusing its key.
        for (self.values) |*value| { try c.step(); try value.environments.age(c, handle); }
        var remove: std.ArrayListUnmanaged(OwnerSlot) = .empty; defer remove.deinit(c.allocator);
        var entries = self.slots.iterator(); while (entries.next()) |entry| {
            try c.step(); try entry.value_ptr.environments.age(c, handle);
            if (entry.key_ptr.environment) |origin| if (origin.source == .birth and origin.source.birth == handle) try remove.append(c.allocator, entry.key_ptr.*);
        }
        for (remove.items) |key| { try c.step(); const old = self.slots.fetchRemove(key).?; var value = old.value; value.deinit(c.allocator); }
        var parents = self.parents.valueIterator(); while (parents.next()) |value| { try c.step(); try value.age(c, handle); }
        const origin = effect_env.Origin{ .layout = layout, .source = .{ .birth = handle } };
        if (self.parents.fetchRemove(origin)) |old| { var value = old.value; value.deinit(c.allocator); }
        var copy = try effect_env.Set.clone(c, parent); errdefer copy.deinit(c.allocator);
        try copy.age(c, handle); try self.parents.put(c.allocator, origin, copy);
    }
    fn fixedBirth(self: *UpperState, c: *Context, invocation: effect_env.Invocation) Error!void {
        try self.agePayloads(c, null, invocation);
        for (self.values) |*value| { try c.step(); try value.environments.ageFixed(c, invocation); }
        var remove: std.ArrayListUnmanaged(OwnerSlot) = .empty; defer remove.deinit(c.allocator);
        var entries = self.slots.iterator(); while (entries.next()) |entry| {
            try c.step(); try entry.value_ptr.environments.ageFixed(c, invocation);
            if (entry.key_ptr.environment) |origin| if (origin.source == .fixed and std.meta.eql(origin.source.fixed.invocation, invocation)) {
                if (remove.items.len == remove.capacity) try c.charge(remove.items.len + 1);
                try c.step(); try remove.append(c.allocator, entry.key_ptr.*);
            };
        }
        for (remove.items) |key| { try c.step(); const old = self.slots.fetchRemove(key).?; var value = old.value; value.deinit(c.allocator); }
        var old_parents: std.ArrayListUnmanaged(effect_env.Origin) = .empty; defer old_parents.deinit(c.allocator);
        var parents = self.parents.iterator(); while (parents.next()) |entry| {
            try c.step(); try entry.value_ptr.ageFixed(c, invocation);
            if (entry.key_ptr.source == .fixed and std.meta.eql(entry.key_ptr.source.fixed.invocation, invocation)) {
                if (old_parents.items.len == old_parents.capacity) try c.charge(old_parents.items.len + 1);
                try c.step(); try old_parents.append(c.allocator, entry.key_ptr.*);
            }
        }
        for (old_parents.items) |key| { try c.step(); const old = self.parents.fetchRemove(key).?; var value = old.value; value.deinit(c.allocator); }
    }
    fn dirtyCapture(self: *UpperState, c: *Context, binding_id: t.BindingRef) Error!void {
        try c.step();
        // Binding equality is used only to revoke all possibly affected
        // selected values. It never identifies a positive Env instance.
        var entries = self.slots.iterator(); while (entries.next()) |entry| {
            try c.step(); if (entry.key_ptr.environment == null or entry.key_ptr.binding != binding_id) continue;
            var missing: Owners = .{}; defer missing.deinit(c.allocator); _ = try missing.makeOpaque(c);
            try entry.value_ptr.replace(c, &missing);
        }
    }
    fn dirtyEnvironments(self: *UpperState, c: *Context) Error!void {
        var entries = self.slots.iterator(); while (entries.next()) |entry| {
            try c.step(); if (entry.key_ptr.environment == null) continue;
            var missing: Owners = .{}; defer missing.deinit(c.allocator); _ = try missing.makeOpaque(c);
            try entry.value_ptr.replace(c, &missing);
        }
        var parents = self.parents.valueIterator(); while (parents.next()) |value| { try c.step(); value.unknown = true; }
    }
    fn dirtyPayloads(self: *UpperState, c: *Context) Error!void {
        try c.charge(self.payloads.capacity() + 1); var records = self.payloads.valueIterator(); while (records.next()) |record| {
            try c.step(); for (record.slots) |*slot| { try c.step(); if (slot.*) |*value| value.deinit(c.allocator); slot.* = null; }
        }
    }
};

// Equivalent seam to C++ GraphEffects, not a second actual interpreter. Every
// normal edge and both conditional edges are considered. A complete callee
// upper opens the language edge even when the actual callee never threw.
// Rebind one immutable Graph5 result into the existing lexical OWNER domain.
// Only enum directory references and copied owner/parent/slot sets escape the
// temporary Analysis. No Actual object, callee register or arena pointer does.
const InputBinding = struct { value: Owners, payload: ?PayloadOrigin = null, environment: ?effect_env.Origin = null };
const PayloadInputs = struct {
    g: *UpperGraph, saved: *const UpperState, a: std.mem.Allocator, invocation: effect_env.Invocation,
    locations: std.ArrayListUnmanaged(fixed_owners.Location) = .empty,
    bindings: std.ArrayListUnmanaged(InputBinding) = .empty,
    data: std.AutoHashMapUnmanaged(PayloadOrigin, usize) = .empty,
    envs: std.AutoHashMapUnmanaged(effect_env.Origin, usize) = .empty,
    data_work: std.ArrayListUnmanaged(PayloadOrigin) = .empty,
    env_work: std.ArrayListUnmanaged(effect_env.Origin) = .empty,
    heap: std.ArrayListUnmanaged(fixed_owners.InitialAddress) = .empty,
    parents: std.ArrayListUnmanaged(fixed_owners.Environment) = .empty,
    initial: fixed_owners.Initial = .{ .locations = &.{}, .arguments = &.{}, .environment = &.{}, .heap = &.{}, .parents = &.{} },
    unavailable: bool = false,
    fn deinit(self: *PayloadInputs) void { for (self.bindings.items) |*entry| entry.value.deinit(self.g.collector.c.allocator); }
    fn append(self: *PayloadInputs, comptime T: type, list: *std.ArrayListUnmanaged(T), item: T) Error!void {
        const c = self.g.collector.c; try c.step(); if (list.items.len == list.capacity) try c.charge(list.items.len + 1);
        try list.append(self.a, item);
    }
    fn node(self: *PayloadInputs, row: fixed_owners.Location, source_value: *const Owners, payload_origin: ?PayloadOrigin, env_origin: ?effect_env.Origin) Error!usize {
        const c = self.g.collector.c; var copy = try Owners.clone(c, source_value); errdefer copy.deinit(c.allocator);
        try copy.payloads.age(c, null, self.invocation); try copy.environments.ageFixed(c, self.invocation);
        const id = self.locations.items.len;
        try self.append(fixed_owners.Location, &self.locations, row);
        try self.append(InputBinding, &self.bindings, .{ .value = copy, .payload = payload_origin, .environment = env_origin });
        return id;
    }
    fn symbol(self: *PayloadInputs, hash: t.Hash) Error!origin_model.Symbol { return publication_refs.symbol(self.g.collector.c, self.a, hash); }
    fn payload(self: *PayloadInputs, key: PayloadOrigin) Error!?usize {
        const c = self.g.collector.c; try payloadKeyWork(c, key);
        if (key.source == .fixed and std.meta.eql(key.source.fixed.invocation, self.invocation)) return null;
        if (self.data.get(key)) |id| return id;
        if (!self.saved.payloads.contains(key)) return null;
        const id = try self.node(.{ .kind = .payload, .owner = .local, .type_id = try self.symbol(self.g.collector.common().types[@intFromEnum(key.type_id)].id) }, &.{}, key, null);
        try c.charge(self.data.capacity() + 4 * (self.data.count() + 1) + 1); try self.data.ensureUnusedCapacity(self.a, 1); self.data.putAssumeCapacity(key, id);
        try self.append(PayloadOrigin, &self.data_work, key); return id;
    }
    fn environment(self: *PayloadInputs, key: effect_env.Origin) Error!?usize {
        const c = self.g.collector.c; try c.row(effect_env.Origin);
        if (key.source == .fixed and std.meta.eql(key.source.fixed.invocation, self.invocation)) return null;
        if (self.envs.get(key)) |id| return id;
        const id = try self.node(.{ .kind = if (key.source == .input) .environment_input else .environment_local, .owner = if (key.source == .input) .nonowning else .local,
            .layout = try self.symbol(self.g.collector.common().closures.environments[@intFromEnum(key.layout)].id) }, &.{}, null, key);
        try c.charge(self.envs.capacity() + 4 * (self.envs.count() + 1) + 1); try self.envs.ensureUnusedCapacity(self.a, 1); self.envs.putAssumeCapacity(key, id);
        try self.append(effect_env.Origin, &self.env_work, key); return id;
    }
    fn value(self: *PayloadInputs, source: *const Owners, empty: bool) Error![]const usize {
        const c = self.g.collector.c; const v = self.g.collector.common(); var value_copy = try Owners.clone(c, source); defer value_copy.deinit(c.allocator);
        try value_copy.payloads.age(c, null, self.invocation); try value_copy.environments.ageFixed(c, self.invocation);
        var refs: std.ArrayListUnmanaged(usize) = .empty;
        for (value_copy.payloads.items.items) |key| {
            try payloadKeyWork(c, key);
            if (try self.payload(key)) |id| try self.append(usize, &refs, id) else value_copy.payloads.unknown = true;
        }
        var paired = false; try c.charge(value_copy.environments.callables.capacity() + 1); var callables = value_copy.environments.callables.iterator();
        while (callables.next()) |entry| {
            try c.step(); const target = entry.key_ptr.*; const abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(target)].abi)];
            if (entry.value_ptr.unknown) value_copy.environments.callable_unknown = true;
            if (abi.lexical_environment == null) {
                if (entry.value_ptr.items.items.len != 0) { value_copy.environments.callable_unknown = true; continue; }
                const id = self.locations.items.len;
                _ = try self.node(.{ .kind = .code, .owner = .{ .input = id }, .function_id = try self.symbol(c.program.functions[@intFromEnum(target)].id) }, &value_copy, null, null);
                try self.append(usize, &refs, id); paired = true;
            } else for (entry.value_ptr.items.items) |origin| {
                try c.row(effect_env.Origin);
                if (try self.environment(origin)) |env| {
                    const id = self.locations.items.len;
                    _ = try self.node(.{ .kind = .code, .owner = .{ .input = id }, .function_id = try self.symbol(c.program.functions[@intFromEnum(target)].id), .environment = env }, &value_copy, null, null);
                    try self.append(usize, &refs, id); paired = true;
                } else value_copy.environments.callable_unknown = true;
            }
            if (abi.lexical_environment != null and entry.value_ptr.items.items.len == 0) value_copy.environments.callable_unknown = true;
        }
        var labeled = false;
        for (value_copy.items.items) |root| { try c.step(); if (root != .local) labeled = true; }
        const unknown = value_copy.payloads.unknown or value_copy.environments.callable_unknown or value_copy.environments.direct.unknown;
        if (unknown or (labeled and !paired) or (value_copy.nonowning and !paired) or (refs.items.len == 0 and (!empty or value_copy.known()))) {
            if (!value_copy.known()) _ = try value_copy.makeOpaque(c);
            const id = self.locations.items.len; _ = try self.node(.{ .kind = .root, .owner = .{ .input = id } }, &value_copy, null, null);
            try self.append(usize, &refs, id);
        }
        return refs.items;
    }
    fn build(self: *PayloadInputs, target: t.FunctionRef, op: model.instruction.Instruction, offset: usize, count: usize) Error!void {
        const c = self.g.collector.c; const v = self.g.collector.common(); const abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(target)].abi)];
        try c.require(offset <= op.operands.len and count <= op.operands.len - offset);
        try c.charge(count + 1); const arguments = try self.a.alloc([]const usize, count);
        for (arguments, 0..) |*into, index| {
            try c.step(); into.* = if (abi.construction != null and index == 0) &.{} else try self.value(&self.saved.values[@intFromEnum(op.operands[offset + index])], false);
        }
        var environments: std.ArrayListUnmanaged(usize) = .empty;
        if (abi.lexical_environment != null) {
            var supplied: effect_env.Set = .{}; defer supplied.deinit(c.allocator); try self.g.callEnvironments(target, op, self.saved, &supplied);
            if (supplied.unknown or supplied.items.items.len == 0) self.unavailable = true;
            for (supplied.items.items) |origin| { try c.row(effect_env.Origin); if (try self.environment(origin)) |id| try self.append(usize, &environments, id) else self.unavailable = true; }
        }
        var data_cursor: usize = 0; var env_cursor: usize = 0;
        while (data_cursor < self.data_work.items.len or env_cursor < self.env_work.items.len) {
            if (data_cursor < self.data_work.items.len) {
                const key = self.data_work.items[data_cursor]; data_cursor += 1; try payloadKeyWork(c, key);
                const base = self.data.get(key).?; const record = self.saved.payloads.getPtr(key).?;
                const slots = try self.g.payloadCount(key.type_id) orelse { self.unavailable = true; continue; };
                if (slots != record.slots.len) { self.unavailable = true; continue; }
                for (record.slots, 0..) |*slot, index| {
                    try c.step(); const contents = if (slot.*) |*value_ptr| value_ptr else continue;
                    const array = v.types[@intFromEnum(key.type_id)].kind == .array;
                    var selector: origin_model.Symbol = "element";
                    if (!array) {
                        const concrete = self.g.collector.concrete[@intFromEnum(key.type_id)].?; const field = v.storage.concrete[concrete].body.?.fields[index].field;
                        const id = try self.symbol(v.members.fields[@intFromEnum(field)].id); try c.charge(id.len + 7); selector = try std.mem.concat(self.a, u8, &.{ "field:", id });
                    }
                    const refs = try self.value(contents, array);
                    try self.append(fixed_owners.InitialAddress, &self.heap, .{ .base = base, .selector = selector, .view = try self.symbol(v.types[@intFromEnum(key.type_id)].id), .values = refs });
                }
            }
            if (env_cursor < self.env_work.items.len) {
                const origin = self.env_work.items[env_cursor]; env_cursor += 1; try c.row(effect_env.Origin);
                const base = self.envs.get(origin).?; const row = v.closures.environments[@intFromEnum(origin.layout)];
                var parents: std.ArrayListUnmanaged(usize) = .empty;
                if (row.parent != null) {
                    var selected: effect_env.Set = .{}; defer selected.deinit(c.allocator); _ = try selected.add(c, origin);
                    var parent_set: effect_env.Set = .{}; defer parent_set.deinit(c.allocator); try self.g.parentEnvironments(self.saved, &selected, &parent_set);
                    if (parent_set.unknown or parent_set.items.items.len == 0) self.unavailable = true;
                    for (parent_set.items.items) |parent| { try c.row(effect_env.Origin); if (try self.environment(parent)) |id| try self.append(usize, &parents, id) else self.unavailable = true; }
                }
                try self.append(fixed_owners.Environment, &self.parents, .{ .location = base, .parents = parents.items });
                for (row.slots, 0..) |slot, index| {
                    try c.step(); var value_copy: Owners = .{}; defer value_copy.deinit(c.allocator);
                    if (origin.source == .input) _ = try value_copy.add(c, .{ .capture = .{ .environment = origin.layout, .slot = @enumFromInt(index) } });
                    if (self.saved.slots.getPtr(.{ .binding = slot.binding, .environment = origin })) |stored| _ = try value_copy.join(c, stored) else if (origin.source != .input) continue else {
                        value_copy.environments.callable_unknown = true; value_copy.environments.direct.unknown = true;
                    }
                    const key = try self.symbol(slot.key); try c.charge(key.len + 9); const selector = try std.mem.concat(self.a, u8, &.{ "capture:", key });
                    const layout = try self.symbol(row.id); try c.charge(layout.len + 5); const view = try std.mem.concat(self.a, u8, &.{ "env:", layout });
                    try self.append(fixed_owners.InitialAddress, &self.heap, .{ .base = base, .selector = selector, .view = view, .values = try self.value(&value_copy, false) });
                }
            }
        }
        self.initial = .{ .locations = self.locations.items, .arguments = arguments, .environment = environments.items, .heap = self.heap.items, .parents = self.parents.items };
    }
};

const FixedExport = struct {
    g: *UpperGraph, analysis: *const fixed_owners.Analysis, target: t.FunctionRef,
    op: model.instruction.Instruction, offset: usize, saved: *const UpperState,
    destination: *UpperState, invocation: effect_env.Invocation,
    allocator: std.mem.Allocator, environments: []effect_env.Set,
    inputs: ?*const PayloadInputs = null, payloads: []?PayloadOrigin = &.{},
    completion: origin_model.Completion = .normal,
    fn directoryRef(self: *FixedExport, comptime Ref: type, rows: anytype, id: origin_model.Symbol) Error!Ref {
        const c = self.g.collector.c;
        for (rows, 0..) |row, index| {
            const symbol = try publication_refs.symbol(c, self.allocator, row.id);
            try c.charge(symbol.len / 8 + id.len / 8 + 2); if (std.mem.eql(u8, symbol, id)) return @enumFromInt(index);
        }
        return error.InvalidReference;
    }
    fn captureRef(self: *FixedExport, key: origin_model.Symbol) Error!Capture {
        const c = self.g.collector.c;
        try c.charge(self.g.collector.common().closures.environments.len);
        for (self.g.collector.common().closures.environments, 0..) |environment, e| for (environment.slots, 0..) |slot, s| {
            const symbol = try publication_refs.symbol(c, self.allocator, slot.key);
            try c.charge(symbol.len / 8 + key.len / 8 + 2);
            if (std.mem.eql(u8, symbol, key)) return .{ .environment = @enumFromInt(e), .slot = @enumFromInt(s) };
        };
        return error.InvalidReference;
    }
    fn root(self: *FixedExport, source: fixed_owners.Root) Error!Owners {
        const c = self.g.collector.c; var result: Owners = .{}; errdefer result.deinit(c.allocator);
        switch (source) {
            .nonowning => result.nonowning = true,
            .local => _ = try result.add(c, .local),
            .parameter => |index| { try c.require(self.offset <= self.op.operands.len and index < self.op.operands.len - self.offset); _ = try result.join(c, &self.saved.values[@intFromEnum(self.op.operands[self.offset + index])]); },
            .global => |id| { const ref = try self.directoryRef(t.GlobalRef, self.g.collector.common().modules.globals, id); _ = try result.add(c, .{ .global = ref }); },
            .capture => |key| try self.g.projectCapture(self.target, self.op, self.saved, try self.captureRef(key), &result),
            .input => |id| {
                const input = self.inputs orelse return error.InvalidShape; try c.require(id < input.bindings.items.len);
                const source_value = &input.bindings.items[id].value;
                result.nonowning = source_value.nonowning; try c.charge(source_value.items.items.len);
                for (source_value.items.items) |owner| _ = try result.add(c, owner);
                result.payloads.unknown = source_value.payloads.unknown;
                result.environments.callable_unknown = source_value.environments.callable_unknown;
                result.environments.direct.unknown = source_value.environments.direct.unknown;
            },
        }
        return result;
    }
    fn exportValue(self: *FixedExport, id: usize) Error!Owners {
        if (self.payloads.len == 0 and (self.analysis.normal_payloads.len != 0 or self.analysis.language_payloads.len != 0)) {
            if (!try self.initialize()) { var missing: Owners = .{}; errdefer missing.deinit(self.g.collector.c.allocator); _ = try missing.makeOpaque(self.g.collector.c); return missing; }
        }
        const c = self.g.collector.c; try c.step(); const node = self.analysis.locations[id];
        var result = try self.root(node.owner); errdefer result.deinit(c.allocator);
        if (id < self.payloads.len and self.payloads[id] != null) {
            _ = try result.payloads.add(c, self.payloads[id].?);
        } else if (node.kind == .projection and node.owner == .input and node.key != null and node.view != null) {
            const input = self.inputs orelse return error.InvalidShape;
            const source_value = &input.bindings.items[node.owner.input].value;
            const view = try self.directoryRef(t.TypeRef, self.g.collector.common().types, node.view.?);
            var field: ?t.FieldRef = null;
            try c.charge(node.key.?.len / 8 + 1);
            if (std.mem.startsWith(u8, node.key.?, "field:")) field = try self.directoryRef(t.FieldRef, self.g.collector.common().members.fields, node.key.?[6..]);
            var selected: Owners = .{}; defer selected.deinit(c.allocator);
            try self.g.selectPayload(self.saved, source_value, view, field, &selected);
            _ = try result.join(c, &selected);
        } else if (node.owner == .local and node.kind != .code and node.kind != .environment_local) {
            const type_ref = if (node.type_id) |type_id| try self.directoryRef(t.TypeRef, self.g.collector.common().types, type_id) else null;
            if (type_ref == null) _ = try result.makeOpaque(c) else switch (self.g.collector.common().types[@intFromEnum(type_ref.?)].kind) {
                .reference, .value, .array, .readSpan, .function, .unknown, .@"union" => _ = try result.makeOpaque(c),
                else => {},
            }
        }
        // A projected object field is not its base's callable payload. Ordinary
        // parameter roots retain the supplied complete code/env associations.
        const direct_capture = node.kind == .projection and node.owner == .capture and node.source != null and
            (self.analysis.locations[node.source.?].kind == .environment_input or self.analysis.locations[node.source.?].kind == .environment_component);
        if ((node.kind == .projection or node.kind == .copied) and !direct_capture and !(id < self.payloads.len and self.payloads[id] != null) and node.owner != .input) {
            result.environments.deinit(c.allocator); result.environments = .{ .callable_unknown = true, .direct = .{ .unknown = true } };
        }
        if (node.kind == .code) {
            result.environments.deinit(c.allocator); result.environments = .{};
            const function = try self.directoryRef(t.FunctionRef, c.program.functions, node.function_id.?);
            var selected: effect_env.Set = .{}; defer selected.deinit(c.allocator);
            if (node.environment) |environment| _ = try selected.join(c, &self.environments[environment]);
            try result.environments.pair(c, function, &selected);
        } else if (node.kind == .environment_input or node.kind == .environment_local or node.kind == .environment_component) {
            result.environments.deinit(c.allocator); result.environments = .{};
            _ = try result.environments.direct.join(c, &self.environments[id]);
        } else if (node.kind == .root and node.owner == .global) {
            result.environments.callable_unknown = true; result.environments.direct.unknown = true;
        }
        // Saved incoming relations from a prior visit to THIS invocation must
        // not collide with newly installed local relationships of this visit.
        if (node.kind != .code and node.kind != .environment_local) try result.environments.ageFixed(c, self.invocation);
        return result;
    }
    fn initialize(self: *FixedExport) Error!bool {
        const c = self.g.collector.c; const v = self.g.collector.common();
        try c.charge(self.analysis.locations.len + 1); self.payloads = try self.allocator.alloc(?PayloadOrigin, self.analysis.locations.len); @memset(self.payloads, null);
        for (self.analysis.locations, 0..) |node, index| {
            try c.step(); if (node.input) |input| {
                const inputs = self.inputs orelse return false; try c.require(input < inputs.bindings.items.len);
                self.payloads[index] = inputs.bindings.items[input].payload;
                if (inputs.bindings.items[input].environment) |origin| _ = try self.environments[index].add(c, origin);
            }
        }
        const completions = [_][]const fixed_owners.Payload{ if (self.completion == .normal) self.analysis.normal_payloads else self.analysis.language_payloads };
        for (completions) |rows| for (rows) |payload| {
            try c.step(); const actual = try self.directoryRef(t.TypeRef, v.types, payload.type_id);
            if (self.payloads[payload.location] == null) self.payloads[payload.location] = .{ .type_id = actual, .source = .{ .fixed = .{ .invocation = self.invocation, .location = payload.location } } };
        };
        // Install identities before their slots: cycles and Code+ENV/data
        // references use this one namespace, independently of traversal order.
        try c.charge(self.analysis.locations.len + 1); const installed = try self.allocator.alloc(bool, self.analysis.locations.len); @memset(installed, false);
        for (completions) |rows| for (rows) |payload| {
            try c.step(); if (installed[payload.location]) continue; installed[payload.location] = true;
            const key = self.payloads[payload.location].?;
            const count = try self.g.payloadCount(key.type_id) orelse return false;
            if (count != payload.slots.len) return false;
            var record = try PayloadRecord.init(c, count); var owned = true; defer if (owned) record.deinit(c);
            try self.destination.putPayload(c, key, record); owned = false;
        };
        for (self.analysis.locations, 0..) |node, index| {
            try c.step(); if (node.layout == null) continue;
            if (node.input != null and self.environments[index].items.items.len != 0) continue;
            const layout = try self.directoryRef(t.EnvironmentRef, v.closures.environments, node.layout.?);
            switch (node.kind) {
                .environment_local => _ = try self.environments[index].add(c, .{ .layout = layout, .source = .{ .fixed = .{ .invocation = self.invocation, .location = index } } }),
                .environment_input => {
                    var supplied: effect_env.Set = .{}; defer supplied.deinit(c.allocator);
                    try self.g.callEnvironments(self.target, self.op, self.saved, &supplied);
                    try self.g.atEnvironment(self.saved, &supplied, layout, &self.environments[index]);
                    try self.environments[index].ageFixed(c, self.invocation);
                },
                else => {},
            }
        }
        for (self.analysis.locations, 0..) |node, index| {
            try c.step(); if (node.kind != .environment_component) continue;
            var source = try self.exportValue(node.source.?); defer source.deinit(c.allocator);
            const function = try self.directoryRef(t.FunctionRef, c.program.functions, node.function_id.?);
            self.environments[index].unknown = source.environments.callable_unknown;
            if (source.environments.callables.getPtr(function)) |selected| _ = try self.environments[index].join(c, selected) else self.environments[index].unknown = true;
            try self.environments[index].ageFixed(c, self.invocation);
        }
        for (self.environments) |*set| { try c.step(); if (set.unknown) return false; }
        for (completions) |rows| for (rows) |payload| {
            try c.step(); const key = self.payloads[payload.location].?;
            for (payload.slots, 0..) |slot, ordinal| {
                try c.step(); const physical = slot.physical orelse ordinal;
                var value: Owners = .{}; defer value.deinit(c.allocator);
                for (slot.values) |id| { try c.step(); var child = try self.exportValue(id); defer child.deinit(c.allocator); _ = try value.join(c, &child); }
                try payloadKeyWork(c, key); const record = self.destination.payloads.getPtr(key).?; try c.require(physical < record.slots.len);
                if (record.slots[physical]) |*old| _ = try old.join(c, &value) else record.slots[physical] = try Owners.clone(c, &value);
            }
        };
        const heaps = [_][]const fixed_owners.Address{ if (self.completion == .normal) self.analysis.normal_heap else self.analysis.language_heap };
        // Reserve all possible new records before the publication loops. This
        // pays allocation/rehash work for existing map capacity and prospective
        // entries once, rather than hiding a growing map behind a unit lookup.
        var parent_records: usize = 0; var slot_records: usize = 0;
        for (self.analysis.environments) |environment| {
            try c.step(); if (self.analysis.locations[environment.location].kind == .environment_local) parent_records += self.environments[environment.location].items.items.len;
        }
        for (heaps) |heap| {
            try c.step(); for (heap) |address| {
                try c.step(); if (self.analysis.locations[address.base].kind == .environment_local and std.mem.startsWith(u8, address.selector, "capture:")) slot_records += self.environments[address.base].items.items.len;
            }
        }
        try c.charge(self.destination.parents.capacity() + 4 * (self.destination.parents.count() + parent_records) + 1);
        try self.destination.parents.ensureUnusedCapacity(c.allocator, @intCast(parent_records));
        try c.charge(self.destination.slots.capacity() + 4 * (self.destination.slots.count() + slot_records) + 1);
        try self.destination.slots.ensureUnusedCapacity(c.allocator, @intCast(slot_records));
        for (self.analysis.environments) |environment| {
            try c.step(); const node = self.analysis.locations[environment.location]; if (node.kind != .environment_local) continue;
            var parents: effect_env.Set = .{}; defer parents.deinit(c.allocator);
            for (environment.parents) |parent| { try c.step(); _ = try parents.join(c, &self.environments[parent]); }
            for (self.environments[environment.location].items.items) |origin| {
                try c.step(); const destination = self.destination.parents.getOrPutAssumeCapacity(origin);
                if (!destination.found_existing) destination.value_ptr.* = .{};
                _ = try destination.value_ptr.join(c, &parents);
            }
        }
        // Completion heaps carry their own final slot relationships. Prefix
        // heaps are used by the domain for effects and initialization checks,
        // never substituted for a returned closure's saved contents.
        for (heaps) |heap| for (heap) |address| {
            try c.step(); const node = self.analysis.locations[address.base];
            if (node.kind != .environment_local or !std.mem.startsWith(u8, address.selector, "capture:")) continue;
            const selected = try self.captureRef(address.selector[8..]);
            const slot = v.closures.environments[@intFromEnum(selected.environment)].slots[@intFromEnum(selected.slot)];
            var payload: Owners = .{}; defer payload.deinit(c.allocator);
            for (address.values.items) |id| { var value = try self.exportValue(id); defer value.deinit(c.allocator); _ = try payload.join(c, &value); }
            for (self.environments[address.base].items.items) |origin| {
                try c.step(); const destination = self.destination.slots.getOrPutAssumeCapacity(.{ .binding = slot.binding, .environment = origin });
                if (!destination.found_existing) destination.value_ptr.* = .{};
                _ = try destination.value_ptr.join(c, &payload);
            }
        };
        return true;
    }
};

const UpperGraph = struct {
    collector: *Collector,
    function: t.FunctionRef,
    lexical_cells: bool = false,
    // Private analysis phase, not an admission/coverage bit. The same typed
    // transfer computes lexical summaries; only the final pass checks effects.
    summarizing: bool = false,
    changed: bool = false,
    block: t.BlockRef = @enumFromInt(0), instruction: u16 = 0,
    fn payloadCount(self: *UpperGraph, actual: t.TypeRef) Error!?usize {
        const c = self.collector.c; const v = self.collector.common(); try c.step();
        return switch (v.types[@intFromEnum(actual)].kind) {
            .array => 1,
            .reference, .value => if (self.collector.concrete[@intFromEnum(actual)]) |index| if (v.storage.concrete[index].body) |body| body.fields.len else null else null,
            else => null,
        };
    }
    fn payloadSlot(self: *UpperGraph, actual: t.TypeRef, view: t.TypeRef, field: ?t.FieldRef) Error!?usize {
        const c = self.collector.c; const v = self.collector.common(); try c.step();
        if (field == null) return if (v.types[@intFromEnum(actual)].kind == .array and (v.types[@intFromEnum(view)].kind == .array or actual == view)) 0 else null;
        const concrete = self.collector.concrete[@intFromEnum(actual)] orelse return null; const body = v.storage.concrete[concrete].body orelse return null;
        var selected: ?t.FieldRef = if (actual == view) field else null;
        if (actual != view) for (v.views.compatibility) |compatibility| {
            try c.step(); if (compatibility.source_type != actual or compatibility.target_type != view) continue;
            for (compatibility.fields) |mapping| {
                try c.step(); if (mapping.target == .field and mapping.target.field == field.? and mapping.actual != null and mapping.actual.? == .field) selected = mapping.actual.?.field;
            }
        };
        const physical_field = selected orelse return null;
        for (body.fields, 0..) |physical, index| { try c.step(); if (physical.field == physical_field) return index; }
        return null;
    }
    fn selectPayload(self: *UpperGraph, state: *const UpperState, source: *const Owners, view: t.TypeRef, field: ?t.FieldRef, into: *Owners) Error!void {
        const c = self.collector.c; try c.step(); var missing = source.payloads.unknown or source.payloads.items.items.len == 0;
        for (source.payloads.items.items) |key| {
            try payloadKeyWork(c, key);
            const index = try self.payloadSlot(key.type_id, view, field) orelse { missing = true; continue; };
            const record = state.payloads.getPtr(key) orelse { missing = true; continue; };
            if (index >= record.slots.len) { missing = true; continue; }
            if (record.slots[index]) |*value| { if (value.known()) _ = try into.join(c, value) else missing = true; } else missing = true;
        }
        if (into.known()) for (source.items.items) |root| { try c.step(); if (root != .local) _ = try into.add(c, root); };
        if (missing or !into.known()) _ = try into.makeOpaque(c);
    }
    fn storePayload(self: *UpperGraph, state: *UpperState, receiver: *const Owners, view: t.TypeRef, field: ?t.FieldRef, value: *const Owners, initialize: bool) Error!void {
        const c = self.collector.c; try c.step();
        if (receiver.payloads.unknown or receiver.payloads.items.items.len == 0) { try state.dirtyPayloads(c); return; }
        var copy = try Owners.clone(c, value); defer copy.deinit(c.allocator);
        for (receiver.payloads.items.items) |key| {
            try payloadKeyWork(c, key); const index = try self.payloadSlot(key.type_id, view, field) orelse { try state.dirtyPayloads(c); return; };
            const record = state.payloads.getPtr(key) orelse { try state.dirtyPayloads(c); return; };
            if (index >= record.slots.len) { try state.dirtyPayloads(c); return; }
            // A May store can add aliases to an established cell. Only a
            // unique explicit initialization can establish missing contents.
            if (record.slots[index]) |*old| _ = try old.join(c, &copy) else if (initialize and receiver.payloads.items.items.len == 1) record.slots[index] = try Owners.clone(c, &copy);
        }
    }
    fn copyPayload(self: *UpperGraph, state: *UpperState, reg: t.RegisterRef, source: *const Owners, into: *Owners) Error!void {
        const c = self.collector.c;
        // This is the caller transfer of already exported physical records.
        // The fixed graph's equations/initialization remain in owners.Engine.
        var saved = try UpperState.clone(c, state); defer saved.deinit(c);
        var input = try Owners.clone(c, source); defer input.deinit(c.allocator);
        try state.agePayloads(c, reg, null);
        const Pair = struct { source: PayloadOrigin, target: PayloadOrigin };
        var work: std.ArrayListUnmanaged(Pair) = .empty; defer work.deinit(c.allocator);
        var seen: PayloadSet = .{}; defer seen.deinit(c.allocator);
        const Transfer = struct {
            fn value(g: *UpperGraph, snapshot: *const UpperState, birth: t.RegisterRef, original: *const Owners, output: *Owners, pending: *std.ArrayListUnmanaged(Pair)) Error!void {
                const ctx = g.collector.c; output.* = try Owners.clone(ctx, original);
                output.payloads.deinit(ctx.allocator); output.payloads = .{ .unknown = original.payloads.unknown };
                for (original.payloads.items.items) |key| {
                    try payloadKeyWork(ctx, key);
                    if (g.collector.common().types[@intFromEnum(key.type_id)].kind != .value) { _ = try output.payloads.add(ctx, key); continue; }
                    _ = try g.payloadCount(key.type_id) orelse { output.payloads.unknown = true; continue; };
                    try payloadKeyWork(ctx, key); if (!snapshot.payloads.contains(key)) { output.payloads.unknown = true; continue; }
                    const target = PayloadOrigin{ .type_id = key.type_id, .source = .{ .birth = birth } };
                    _ = try output.payloads.add(ctx, target);
                    if (pending.items.len == pending.capacity) try ctx.charge(pending.items.len + 1); try ctx.step();
                    try pending.append(ctx.allocator, .{ .source = key, .target = target });
                }
            }
        };
        var result: Owners = .{}; defer result.deinit(c.allocator); try Transfer.value(self, &saved, reg, &input, &result, &work);
        var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try c.step(); const pair = work.items[cursor]; if (!try seen.add(c, pair.source)) continue;
            try payloadKeyWork(c, pair.source); const original = saved.payloads.getPtr(pair.source).?;
            const count = try self.payloadCount(pair.target.type_id) orelse return error.InvalidShape; try c.require(count == original.slots.len);
            var record = try PayloadRecord.init(c, count); var owned = true; defer if (owned) record.deinit(c);
            for (original.slots, record.slots) |*slot, *dest| {
                try c.step(); if (slot.*) |*value| {
                    if (!value.known() and !self.summarizing) self.collector.fixed_upper_origin_pending = true;
                    var mapped: Owners = .{}; errdefer mapped.deinit(c.allocator); try Transfer.value(self, &saved, reg, value, &mapped, &work); dest.* = mapped;
                } else if (!self.summarizing) self.collector.fixed_upper_origin_pending = true;
            }
            try payloadKeyWork(c, pair.target);
            if (state.payloads.getPtr(pair.target)) |old| _ = try old.join(c, &record) else { try state.putPayload(c, pair.target, record); owned = false; }
        }
        try into.replace(c, &result);
    }
    fn markContents(self: *UpperGraph, state: *const UpperState, source: *const Owners, mode: Access) Error!void {
        const c = self.collector.c; var work: std.ArrayListUnmanaged(*const Owners) = .empty; defer work.deinit(c.allocator);
        var data_seen: PayloadSet = .{}; defer data_seen.deinit(c.allocator); var env_seen: effect_env.Set = .{}; defer env_seen.deinit(c.allocator);
        try c.charge(1); try work.append(c.allocator, source); var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try c.step(); const value = work.items[cursor]; try self.mark(value, mode);
            if (value.payloads.unknown and !self.summarizing) self.collector.fixed_upper_origin_pending = true;
            for (value.payloads.items.items) |key| {
                if (!try data_seen.add(c, key)) continue;
                try payloadKeyWork(c, key); const record = state.payloads.getPtr(key) orelse { if (!self.summarizing) self.collector.fixed_upper_origin_pending = true; continue; };
                for (record.slots) |*slot| {
                    try c.step(); if (slot.*) |*child| {
                        if (!child.known() and self.collector.common().types[@intFromEnum(key.type_id)].kind == .array) continue;
                        if (work.items.len == work.capacity) try c.charge(work.items.len + 1); try c.step(); try work.append(c.allocator, child);
                    } else if (!self.summarizing) self.collector.fixed_upper_origin_pending = true;
                }
            }
            var selected: effect_env.Set = .{}; defer selected.deinit(c.allocator);
            _ = try selected.join(c, &value.environments.direct);
            try c.charge(value.environments.callables.capacity() + 1); var pairs = value.environments.callables.valueIterator(); while (pairs.next()) |env| { try c.step(); _ = try selected.join(c, env); }
            // An unknown callable does not change a known external permission
            // label. Dependent invocation still checks every target's pair.
            var env_work: std.ArrayListUnmanaged(effect_env.Origin) = .empty; defer env_work.deinit(c.allocator);
            try c.charge(selected.items.items.len + 1); try env_work.appendSlice(c.allocator, selected.items.items);
            var env_cursor: usize = 0;
            while (env_cursor < env_work.items.len) : (env_cursor += 1) {
                const origin = env_work.items[env_cursor]; if (!try env_seen.add(c, origin)) continue;
                const layout = self.collector.common().closures.environments[@intFromEnum(origin.layout)];
                if (layout.parent != null) {
                    var one: effect_env.Set = .{}; defer one.deinit(c.allocator); _ = try one.add(c, origin);
                    var parent: effect_env.Set = .{}; defer parent.deinit(c.allocator); try self.parentEnvironments(state, &one, &parent);
                    if (parent.unknown and !self.summarizing) self.collector.fixed_upper_origin_pending = true;
                    for (parent.items.items) |p| {
                        try c.row(effect_env.Origin); if (env_work.items.len == env_work.capacity) try c.charge(env_work.items.len + 1);
                        try env_work.append(c.allocator, p);
                    }
                }
                for (layout.slots, 0..) |slot, index| {
                    try c.step();
                    if (origin.source == .input and !self.summarizing) try self.collector.capture(self.function, origin.layout, @enumFromInt(index), mode);
                    if (state.slots.getPtr(.{ .binding = slot.binding, .environment = origin })) |child| {
                        if (work.items.len == work.capacity) try c.charge(work.items.len + 1); try c.step(); try work.append(c.allocator, child);
                    } else if (origin.source != .input and !self.summarizing) self.collector.fixed_upper_origin_pending = true;
                }
            }
        }
    }
    fn proveLexicalCells(self: *UpperGraph) Error!bool {
        const c = self.collector.c; const v = self.collector.common(); const function = c.program.functions[@intFromEnum(self.function)];
        var created: std.AutoHashMapUnmanaged(t.BindingRef, struct { cell: t.CellRef, handle: t.RegisterRef }) = .empty; defer created.deinit(c.allocator);
        for (function.blocks) |block| for (block.instructions) |op| {
            try c.step(); switch (op.data) {
                .eh_cell => |cell| {
                    const id = v.exceptions.bindings[@intFromEnum(cell.binding)].binding;
                    const binding_row = v.storage.bindings[@intFromEnum(id)];
                    const owner = switch (binding_row.owner) { .param, .local, .receiver => |owner_id| owner_id, else => return false };
                    if (owner != self.function) return false;
                    // No environment slot may name this binding, including an
                    // otherwise unobserved capture. A nonescaping handle alone
                    // would not exclude that independently declared alias.
                    try c.step(); if (self.collector.captures[@intFromEnum(id)] != null) return false;
                    const one = try created.getOrPut(c.allocator, id);
                    if (one.found_existing) return false;
                    one.value_ptr.* = .{ .cell = cell.binding, .handle = op.result.? };
                },
                else => {},
            }
        };
        // SSA owns dominance; all handle uses must name this single static
        // birth without phi, capture, call argument or returned-handle aliases.
        // Backedges are valid: the existing owner-state fixed point joins
        // lexical contents, and each execution of eh_cell kills the old binding
        // before a new store/load. This identifies no dynamic allocation/version
        // and grants no Region/holding fact or initialization from an upper.
        for (function.blocks) |block| for (block.instructions) |op| for (op.operands, 0..) |reg, i| {
            try c.step(); const carrier = function.registers[@intFromEnum(reg)].carrier;
            if (carrier != .cell) continue;
            const id = v.exceptions.bindings[@intFromEnum(carrier.cell)].binding;
            const one = created.get(id) orelse return false;
            if (i != 0 or one.cell != carrier.cell or one.handle != reg) return false;
            switch (op.data) {
                .eh_load => |load| if (load.binding != carrier.cell) { return false; },
                .eh_store => |store| if (store.binding != carrier.cell) { return false; },
                else => return false,
            }
        };
        return true;
    }
    fn provePrivateAggregates(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)];
        const summary = &collector.aliases[@intFromEnum(self.function)];
        const aggregates = &summary.aggregates; const handles = &summary.aggregate_handles;
        aggregates.clearRetainingCapacity();
        handles.clearRetainingCapacity();
        for (function.blocks, 0..) |block, block_index| for (block.instructions, 0..) |op, op_index| {
            try c.step(); if (op.data != .eh_construct) continue;
            const allocation = op.data.eh_construct; const row = v.types[@intFromEnum(allocation.owner)];
            const construction = v.members.constructions[@intFromEnum(allocation.constructor)];
            // Common80 itself allocates. This first slice excludes all body
            // invocation/super/value paths: a root's inline 81 initializers are
            // still checked separately by the existing construction boundary.
            if (row.kind != .reference or row.base != null or construction.kind != .@"implicit-base" or
                construction.function != null or construction.parameters.len != 0) continue;
            const concrete = collector.concrete[@intFromEnum(allocation.owner)] orelse return error.InvalidShape;
            try aggregates.put(c.allocator, op.result.?, .{ .actual_type = allocation.owner, .concrete = concrete, .block = block_index, .instruction = op_index });
        };
        // Source const lowering creates Cell72, reference-copy45 and store74
        // after the initializer. Admit only one readonly local binding, with
        // every birth, store, load and receiver use in this same basic block.
        // Thus each block execution rebinds the Cell before any load; a loop
        // cannot turn a previous object's fields into this birth's contents.
        // This is a closed operand protocol, not an allocation-site identity
        // or a second CFG/actual solve. Inter-block and further transport stay
        // outside it, even when a Cell is otherwise independently private.
        if (summary.lexical_cells) {
            var entries = aggregates.iterator();
            transport: while (entries.next()) |entry| {
                try c.step(); const original = entry.key_ptr.*; const aggregate = entry.value_ptr.*;
                const instructions = function.blocks[aggregate.block].instructions;
                var copy_at: ?usize = null;
                for (instructions[aggregate.instruction + 1 ..], aggregate.instruction + 1 ..) |op, index| {
                    try c.step(); if (op.data != .domain_copy or op.operands[0] != original) continue;
                    if (copy_at != null or op.data.domain_copy.static_view != aggregate.actual_type) continue :transport;
                    copy_at = index;
                }
                const copied_at = copy_at orelse continue;
                const copied = instructions[copied_at].result.?;
                var store_at: ?usize = null;
                for (instructions[copied_at + 1 ..], copied_at + 1 ..) |op, index| {
                    try c.step(); if (op.data != .eh_store or op.operands[1] != copied) continue;
                    if (store_at != null or !op.data.eh_store.initialize) continue :transport;
                    store_at = index;
                }
                const stored_at = store_at orelse continue;
                const store_op = instructions[stored_at]; const cell_id = store_op.data.eh_store.binding;
                const cell_handle = store_op.operands[0];
                const binding_id = v.exceptions.bindings[@intFromEnum(cell_id)].binding;
                const binding_row = v.storage.bindings[@intFromEnum(binding_id)];
                if (binding_row.owner != .local or binding_row.owner.local != self.function or binding_row.writable or
                    binding_row.@"type" != aggregate.actual_type or binding_row.declaration_kind == null or
                    binding_row.declaration_kind.? != .local) continue;
                // proveLexicalCells already excludes every declared capture
                // and all handle aliases, with one birth for this binding.
                var cell_at: ?usize = null;
                for (instructions[aggregate.instruction + 1 .. copied_at], aggregate.instruction + 1 ..) |op, index| {
                    try c.step(); if (op.data == .eh_cell and op.data.eh_cell.binding == cell_id and op.result.? == cell_handle) cell_at = index;
                }
                const born_at = cell_at orelse continue;
                var local_handles: std.AutoHashMapUnmanaged(t.RegisterRef, void) = .empty; defer local_handles.deinit(c.allocator);
                try c.charge(2); try local_handles.put(c.allocator, original, {}); try local_handles.put(c.allocator, copied, {});
                // Every Cell use must be this sole initialization or a later
                // load. No missing initialization, alternative write, handle
                // phi, capture or escape is inferred from the declaration.
                for (function.blocks, 0..) |block, block_index| for (block.instructions, 0..) |op, index| {
                    try c.step();
                    if (op.data == .eh_store and v.exceptions.bindings[@intFromEnum(op.data.eh_store.binding)].binding == binding_id and
                        (block_index != aggregate.block or index != stored_at)) continue :transport;
                    for (op.operands, 0..) |reg, operand| {
                        try c.step(); if (reg != cell_handle) continue;
                        if (block_index != aggregate.block or operand != 0) continue :transport;
                        switch (op.data) {
                            .eh_store => {}, // Sole binding initialization checked above.
                            .eh_load => {
                                if (index <= stored_at) continue :transport;
                                try c.step(); try local_handles.put(c.allocator, op.result.?, {});
                            },
                            else => continue :transport,
                        }
                    }
                };
                // Ref-copy preserves this reference (never a value body).
                // Only its one Cell store consumes the copy; loaded handles
                // may only access own fields, with no further transport or 81.
                for (function.blocks, 0..) |block, block_index| for (block.instructions, 0..) |op, index| {
                    try c.step(); for (op.operands, 0..) |reg, operand| {
                        try c.step(); if (!local_handles.contains(reg)) continue;
                        if (block_index != aggregate.block) continue :transport;
                        if (reg == copied) {
                            if (index != stored_at or operand != 1) continue :transport;
                            continue;
                        }
                        if (reg == original and index == copied_at and operand == 0) continue;
                        const allowed = operand == 0 and switch (op.data) {
                            .eh_field_initialize => |write| reg == original and index < born_at and v.members.fields[@intFromEnum(write.field)].owner == aggregate.actual_type,
                            else => self.ownFieldAccess(op, aggregate.actual_type),
                        };
                        if (!allowed) continue :transport;
                    }
                };
                var aliases = local_handles.keyIterator(); while (aliases.next()) |reg| {
                    try c.step(); try handles.put(c.allocator, reg.*, original);
                }
            }
        }
        // Other aggregates retain the direct-receiver-only rule. The handles
        // above already have their entire operand inventory checked once.
        for (function.blocks) |block| for (block.instructions) |op| for (op.operands, 0..) |reg, index| {
            try c.step(); if (handles.contains(reg)) continue;
            const aggregate = aggregates.get(reg) orelse continue;
            const allowed = index == 0 and switch (op.data) {
                .eh_field_initialize => |write| v.members.fields[@intFromEnum(write.field)].owner == aggregate.actual_type,
                else => self.ownFieldAccess(op, aggregate.actual_type),
            };
            if (!allowed) _ = aggregates.remove(reg);
        };
    }
    fn ownFieldAccess(self: *const UpperGraph, op: model.instruction.Instruction, actual_type: t.TypeRef) bool {
        const fields = self.collector.common().members.fields;
        return switch (op.data) {
            .domain_field_read => |read| read.receiver_view == actual_type and fields[@intFromEnum(read.member)].owner == actual_type,
            .domain_field_store => |write| write.receiver_view == actual_type and fields[@intFromEnum(write.member)].owner == actual_type and !fields[@intFromEnum(write.member)].readonly,
            else => false,
        };
    }
    fn privateField(self: *UpperGraph, receiver: t.RegisterRef, field: t.FieldRef) ?OwnerSlot {
        const summary = &self.collector.aliases[@intFromEnum(self.function)];
        const original = summary.aggregate_handles.get(receiver) orelse receiver;
        if (!summary.aggregates.contains(original)) return null;
        return .{ .binding = self.collector.common().members.fields[@intFromEnum(field)].binding, .receiver = original };
    }
    fn mark(self: *UpperGraph, owners: *const Owners, mode: Access) Error!void {
        if (self.summarizing) return;
        const collector = self.collector; const c = collector.c;
        try c.step(); if (!owners.known()) { collector.fixed_upper_origin_pending = true; return; }
        for (owners.items.items) |owner| {
            try c.step(); switch (owner) {
                .parameter => |index| {
                    const upper_bound = collector.upper(self.function) orelse continue;
                    const v = collector.common(); const function = c.program.functions[@intFromEnum(self.function)];
                    const abi = v.abis[@intFromEnum(function.abi)];
                    const binding_id = if (abi.receiver != null and index == 0) abi.receiver.? else abi.parameters[index - @as(usize, if (abi.receiver != null) 1 else 0)];
                    if (!try collector.managedType(v.storage.bindings[@intFromEnum(binding_id)].@"type")) continue;
                    const access_mode = upper_bound.parameters[index];
                    try c.require(switch (mode) { .read => access_mode.read, .write => access_mode.write, .structural => access_mode.structural });
                },
                .global => |id| try collector.global(self.function, id, mode),
                .capture => |slot| try collector.capture(self.function, slot.environment, slot.slot, mode),
                .local => {}, // Typed lexical local origin, no external access root.
                // The fixed contract has no return/throw alias-root mapping.
                // Dropping this token would turn missing evidence into empty.
                .unresolved => collector.fixed_upper_origin_pending = true,
            }
        }
    }
    fn binding(self: *UpperGraph, state: *UpperState, id: t.BindingRef, loaded: *Owners, incoming: ?*const Owners, initialize: bool) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common(); const b = @intFromEnum(id);
        const owner = switch (v.storage.bindings[b].owner) { .param, .local, .receiver => |function| function, else => return error.InvalidShape };
        if (owner != self.function) {
            const captured = collector.captures[b] orelse {
                if (!self.summarizing) collector.fixed_upper_origin_pending = true;
                if (incoming == null) _ = try loaded.makeOpaque(c);
                return;
            };
            if (!self.summarizing) try collector.capture(self.function, captured.environment, captured.slot, if (incoming != null) .write else .read);
            if (incoming == null) {
                if (try collector.managedType(v.storage.bindings[b].@"type")) _ = try loaded.add(c, .{ .capture = captured });
                // This binding path has no selected payload, unlike env_load.
                loaded.environments.callable_unknown = true; loaded.environments.direct.unknown = true;
            }
        } else if (incoming) |value| {
            const destination = try state.slots.getOrPut(c.allocator, .{ .binding = id });
            if (!destination.found_existing) destination.value_ptr.* = .{};
            if (!initialize) try self.mark(destination.value_ptr, .write);
            try destination.value_ptr.replace(c, value);
        } else if (state.slots.getPtr(.{ .binding = id })) |value| try loaded.replace(c, value) else _ = try loaded.makeOpaque(c);
    }
    fn parentEnvironments(self: *UpperGraph, state: *const UpperState, source: *const effect_env.Set, into: *effect_env.Set) Error!void {
        const c = self.collector.c; const rows = self.collector.common().closures.environments;
        try c.step(); into.unknown = into.unknown or source.unknown or source.items.items.len == 0;
        for (source.items.items) |origin| {
            try c.step(); const parent = rows[@intFromEnum(origin.layout)].parent orelse { into.unknown = true; continue; };
            switch (origin.source) {
                .input => _ = try into.add(c, .{ .layout = parent, .source = .input }),
                .birth, .fixed => if (state.parents.getPtr(origin)) |saved| {
                    if (saved.items.items.len == 0) into.unknown = true;
                    _ = try into.join(c, saved);
                } else { into.unknown = true; },
            }
        }
    }
    fn atEnvironment(self: *UpperGraph, state: *const UpperState, source: *const effect_env.Set, layout: t.EnvironmentRef, into: *effect_env.Set) Error!void {
        const c = self.collector.c;
        var pending = try effect_env.Set.clone(c, source); defer pending.deinit(c.allocator);
        var seen: effect_env.Set = .{}; defer seen.deinit(c.allocator);
        into.unknown = into.unknown or source.unknown or source.items.items.len == 0;
        var cursor: usize = 0;
        while (cursor < pending.items.items.len) : (cursor += 1) {
            try c.step(); const origin = pending.items.items[cursor]; if (!try seen.add(c, origin)) continue;
            if (origin.layout == layout) { _ = try into.add(c, origin); continue; }
            var selected: effect_env.Set = .{}; defer selected.deinit(c.allocator); _ = try selected.add(c, origin);
            var parents: effect_env.Set = .{}; defer parents.deinit(c.allocator);
            try self.parentEnvironments(state, &selected, &parents);
            into.unknown = into.unknown or parents.unknown; _ = try pending.join(c, &parents);
        }
    }
    fn callEnvironments(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, into: *effect_env.Set) Error!void {
        const c = self.collector.c; const v = self.collector.common();
        try c.step(); const abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(target)].abi)];
        const layout = abi.lexical_environment orelse return;
        var saved: effect_env.Set = .{}; defer saved.deinit(c.allocator);
        switch (op.data) {
            .eh_invoke => _ = try saved.join(c, &state.values[@intFromEnum(op.operands[0])].environments.direct),
            .eh_invoke_indirect => {
                const value = &state.values[@intFromEnum(op.operands[0])].environments;
                saved.unknown = value.callable_unknown;
                if (value.callables.getPtr(target)) |pair| _ = try saved.join(c, pair) else saved.unknown = true;
            },
            else => saved.unknown = true,
        }
        // The target is a case of the complete permitted call, not evidence
        // of a missing environment pair. Missing cases remain unknown.
        try self.atEnvironment(state, &saved, layout, into);
    }
    fn projectCapture(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, saved: *const UpperState, selected: Capture, into: *Owners) Error!void {
        const c = self.collector.c; const v = self.collector.common();
        const slot = v.closures.environments[@intFromEnum(selected.environment)].slots[@intFromEnum(selected.slot)];
        var supplied: effect_env.Set = .{}; defer supplied.deinit(c.allocator);
        try self.callEnvironments(target, op, saved, &supplied);
        var sources: effect_env.Set = .{}; defer sources.deinit(c.allocator);
        try self.atEnvironment(saved, &supplied, selected.environment, &sources);
        if (sources.unknown or sources.items.items.len == 0) _ = try into.makeOpaque(c);
        for (sources.items.items) |source| {
            try c.step();
            // A foreign formal ENV remains c:key. Static lexical stores may
            // add aliases, but no selected Actual payload can replace c:key.
            if (source.source == .input) _ = try into.add(c, .{ .capture = selected });
            if (saved.slots.getPtr(.{ .binding = slot.binding, .environment = source })) |payload| {
                _ = try into.join(c, payload);
            } else if (source.source == .input) {
                into.environments.callable_unknown = true; into.environments.direct.unknown = true;
            } else _ = try into.makeOpaque(c);
        }
    }
    fn applyCaptureUpper(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, saved: *const UpperState, full: *const publication.EffectUpper) Error!void {
        const c = self.collector.c; const v = self.collector.common();
        for (full.captures) |capture| {
            try c.step(); if (!capture.read and !capture.write and !capture.structural) continue;
            var selected: ?Capture = null;
            for (self.collector.captures) |row| {
                try c.step(); const found = row orelse continue;
                const key = v.closures.environments[@intFromEnum(found.environment)].slots[@intFromEnum(found.slot)].key;
                try c.charge(9); if (std.mem.eql(u8, &key, &capture.slot)) { selected = found; break; }
            }
            const slot = selected orelse return error.InvalidReference;
            var projected: Owners = .{}; defer projected.deinit(c.allocator);
            try self.projectCapture(target, op, saved, slot, &projected);
            if (capture.read) try self.markContents(saved, &projected, .read);
            if (capture.write) try self.markContents(saved, &projected, .write);
            if (capture.structural) try self.markContents(saved, &projected, .structural);
        }
    }
    fn environment(self: *UpperGraph, state: *UpperState, roots: *const effect_env.Set, selected: Capture, loaded: *Owners, incoming: ?*const Owners, initialize: bool) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const slot = v.closures.environments[@intFromEnum(selected.environment)].slots[@intFromEnum(selected.slot)];
        const binding_row = v.storage.bindings[@intFromEnum(slot.binding)];
        const owner = switch (binding_row.owner) { .param, .local, .receiver => |function| function, else => return error.InvalidShape };
        const foreign = owner != self.function;
        if (foreign and !self.summarizing) try collector.capture(self.function, selected.environment, selected.slot, if (incoming != null) .write else .read);
        var origins: effect_env.Set = .{}; defer origins.deinit(c.allocator);
        try self.atEnvironment(state, roots, selected.environment, &origins);
        const uncertain = origins.unknown or origins.items.items.len == 0;
        if (uncertain) {
            if (incoming != null) try state.dirtyCapture(c, slot.binding);
            if (!self.summarizing) collector.fixed_upper_origin_pending = true;
            if (incoming == null) _ = try loaded.makeOpaque(c);
        }
        if (incoming == null and foreign) {
            // EffectUpper names the lexical capture, not its payload's p/G
            // aliases. The selected payload contributes only code/env data.
            _ = try loaded.add(c, .{ .capture = selected });
        }
        for (origins.items.items) |origin| {
            try c.step(); const key = OwnerSlot{ .binding = slot.binding, .environment = origin };
            if (incoming) |value| {
                if (!initialize and !foreign and !self.summarizing) {
                    if (state.slots.getPtr(key)) |old| try self.mark(old, .write) else collector.fixed_upper_origin_pending = true;
                }
                if (!uncertain and origins.items.items.len == 1) {
                    try state.store(c, key, value);
                } else {
                    const destination = try state.slots.getOrPut(c.allocator, key);
                    if (!destination.found_existing) { destination.value_ptr.* = .{}; _ = try destination.value_ptr.makeOpaque(c); }
                    _ = try destination.value_ptr.join(c, value);
                }
            } else if (state.slots.getPtr(key)) |value| {
                if (foreign) { _ = try loaded.environments.join(c, &value.environments); _ = try loaded.payloads.join(c, &value.payloads); } else _ = try loaded.join(c, value);
            } else if (origin.source == .input and foreign) {
                // An input is a formal Env, never a concrete slot payload.
                // Callable/returned-closure contents require their own graph.
                loaded.environments.callable_unknown = true;
                loaded.environments.direct.unknown = true;
            } else _ = try loaded.makeOpaque(c);
        }
    }
    fn projectEnvironments(self: *UpperGraph, source: *const effect_env.Set, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, into: *effect_env.Set) Error!void {
        const c = self.collector.c; try c.step(); into.unknown = into.unknown or source.unknown;
        for (source.items.items) |origin| {
            try c.step(); switch (origin.source) {
                .input => {
                    var supplied: effect_env.Set = .{}; defer supplied.deinit(c.allocator);
                    try self.callEnvironments(target, op, state, &supplied);
                    try self.atEnvironment(state, &supplied, origin.layout, into);
                },
                // A callee-local activation cannot be rebound by reusing its
                // SSA number in the caller. Escaped Env graphs stay unknown.
                .birth, .fixed => into.unknown = true,
            }
        }
    }
    fn edge(self: *UpperGraph, entries: []?UpperState, queued: []bool, pending: *std.ArrayListUnmanaged(t.BlockRef), target: t.BlockRef, state: *const UpperState, arguments: []const Owners) Error!void {
        const c = self.collector.c; const function = c.program.functions[@intFromEnum(self.function)]; const b = @intFromEnum(target);
        const parameters = function.blocks[b].parameters; try c.require(parameters.len == arguments.len);
        var incoming = try UpperState.clone(c, state); var owns = true; defer if (owns) incoming.deinit(c);
        for (parameters, arguments) |reg, *argument| try incoming.values[@intFromEnum(reg)].replace(c, argument);
        const changed = if (entries[b]) |*old| try old.join(c, &incoming) else blk: { entries[b] = incoming; owns = false; break :blk true; };
        if (changed and !queued[b]) { queued[b] = true; try pending.append(c.allocator, target); }
    }
    fn projectSummary(self: *UpperGraph, source: *const Owners, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, offset: usize, into: *Owners) Error!void {
        const c = self.collector.c;
        // A known-empty summary must survive projection, while bottom may not
        // become known merely because this call has a normal continuation.
        try c.step(); into.nonowning = into.nonowning or source.nonowning;
        for (source.items.items) |owner| {
            try c.step(); switch (owner) {
                .parameter => |index| {
                    try c.require(offset <= op.operands.len and index < op.operands.len - offset);
                    _ = try into.join(c, &state.values[@intFromEnum(op.operands[offset + index])]);
                },
                .global, .local => _ = try into.add(c, owner),
                // A lexical capture key alone is not a cross-instance env
                // content projection. This slice does not synthesize one.
                .capture, .unresolved => _ = try into.makeOpaque(c),
            }
        }
        try self.projectEnvironments(&source.environments.direct, target, op, state, &into.environments.direct);
        into.environments.callable_unknown = into.environments.callable_unknown or source.environments.callable_unknown;
        var pairs = source.environments.callables.iterator(); while (pairs.next()) |pair| {
            try c.step(); var selected: effect_env.Set = .{}; defer selected.deinit(c.allocator);
            try self.projectEnvironments(pair.value_ptr, target, op, state, &selected);
            try into.environments.pair(c, pair.key_ptr.*, &selected);
        }
    }
    fn noFixedBodyProof(self: *UpperGraph, full: *const publication.EffectUpper, returned: *Owners, thrown: *Owners) Error!bool {
        if (!self.summarizing) self.collector.fixed_upper_origin_pending = true;
        _ = try returned.makeOpaque(self.collector.c);
        if (full.facets.may_throw) _ = try thrown.makeOpaque(self.collector.c);
        return true;
    }
    fn physicalFields(self: *UpperGraph, allocator: std.mem.Allocator, directory: *const origin_model.Directory) Error![]const fixed_owners.Physical {
        const c = self.collector.c; const v = self.collector.common();
        try c.charge(directory.types.len + 1); const result = try allocator.alloc(fixed_owners.Physical, directory.types.len);
        for (directory.types, result) |type_row, *into| {
            try c.step(); into.* = .{ .type_id = type_row.id, .fields = null };
            if (type_row.kind != .value and type_row.kind != .reference) continue;
            for (v.storage.concrete) |concrete| {
                try c.step(); const actual = try publication_refs.symbol(c, allocator, v.types[@intFromEnum(concrete.@"type")].id);
                try c.charge(actual.len / 8 + type_row.id.len / 8 + 2); if (!std.mem.eql(u8, actual, type_row.id)) continue;
                const body = concrete.body orelse break;
                var fields: std.ArrayListUnmanaged(fixed_owners.Field) = .empty;
                for (body.fields, 0..) |physical, index| {
                    try c.step(); const field = v.members.fields[@intFromEnum(physical.field)];
                    if (fields.items.len == fields.capacity) try c.charge(fields.items.len + 1); try c.row(fixed_owners.Field);
                    try fields.append(allocator, .{ .id = try publication_refs.symbol(c, allocator, field.id), .view = actual, .physical = index, .type_id = try publication_refs.symbol(c, allocator, v.types[@intFromEnum(field.@"type")].id) });
                }
                for (v.views.compatibility) |compatibility| {
                    try c.step(); if (compatibility.source_type != concrete.@"type") continue;
                    const view = try publication_refs.symbol(c, allocator, v.types[@intFromEnum(compatibility.target_type)].id);
                    for (compatibility.fields) |mapping| {
                        try c.step(); if (mapping.target != .field or mapping.actual == null or mapping.actual.? != .field) continue;
                        for (body.fields, 0..) |physical, index| {
                            try c.step(); if (physical.field != mapping.actual.?.field) continue;
                            const field = v.members.fields[@intFromEnum(mapping.target.field)];
                            if (fields.items.len == fields.capacity) try c.charge(fields.items.len + 1); try c.row(fixed_owners.Field);
                            try fields.append(allocator, .{ .id = try publication_refs.symbol(c, allocator, field.id), .view = view, .physical = index, .type_id = try publication_refs.symbol(c, allocator, v.types[@intFromEnum(field.@"type")].id) });
                            break;
                        }
                    }
                }
                into.fields = fields.items; break;
            }
        }
        return result;
    }
    fn unselectedReadOnlyGlobals(c: *Context, upper: *const publication.EffectUpper) Error!?[]const t.Hash {
        try c.charge(5);
        if (upper.captures.len != 0 or upper.globals.writes.len != 0 or upper.host_resources.reads.len != 0 or upper.host_resources.writes.len != 0) return null;
        inline for (std.meta.fields(@TypeOf(upper.facets))) |field| {
            if (comptime !std.mem.eql(u8, field.name, "managed_reference")) {
                try c.step();
                if (@field(upper.facets, field.name)) return null;
            }
        }
        return upper.globals.reads;
    }

    fn fixedOwnersGraph(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, saved: *const UpperState, destination: *UpperState, offset: usize, full: *const publication.EffectUpper, directory: *const origin_model.Directory, function_id: origin_model.Symbol, graph: *const origin_model.Graph, budget: *origin_model.Budget, allocator: std.mem.Allocator, receiver: ?*const construction_origins.Analysis, returned: *Owners, thrown: *Owners, completions: ?*UpperCompletions) Error!bool {
        const c = self.collector.c; const publication_rows = self.collector.common().authority.fixed_publication.publication.contracts;
        try c.charge(publication_rows.len + 1); const rows = try allocator.alloc(fixed_owners.Fixed, publication_rows.len);
        for (publication_rows, rows) |*row, *into| {
            try c.charge(row.upper.parameters.len + row.upper.captures.len + 2);
            const parameters = try allocator.alloc(fixed_owners.Flags, row.upper.parameters.len);
            for (row.upper.parameters, parameters) |flags, *parameter| { try c.step(); parameter.* = .{ .read = flags.read, .write = flags.write, .structural = flags.structural }; }
            const captures = try allocator.alloc(fixed_owners.Capture, row.upper.captures.len);
            for (row.upper.captures, captures) |capture, *entry| { try c.step(); entry.* = .{ .key = try publication_refs.symbol(c, allocator, capture.slot), .flags = .{ .read = capture.read, .write = capture.write, .structural = capture.structural } }; }
            into.* = .{ .function_id = try publication_refs.symbol(c, allocator, row.function_id), .graph = if (row.return_origins) |*value| value else null, .parameters = parameters, .captures = captures, .may_throw = row.upper.facets.may_throw,
                .unselected_read_only_globals = if (row.return_origins != null) try unselectedReadOnlyGlobals(c, &row.upper) else null };
        }
        const physical = try self.physicalFields(allocator, directory);
        const invocation = effect_env.Invocation{ .caller = self.function, .block = self.block, .instruction = self.instruction, .target = target };
        var inputs = PayloadInputs{ .g = self, .saved = saved, .a = allocator, .invocation = invocation }; defer inputs.deinit();
        try inputs.build(target, op, offset, full.parameters.len);
        if (inputs.unavailable) return self.noFixedBodyProof(full, returned, thrown);
        var analysis = fixed_owners.analyzeInputs(c.allocator, directory, physical, function_id, graph, rows, budget, receiver, &inputs.initial) catch |err| return publication_refs.graphFailure(err);
        defer analysis.deinit();
        if (analysis.pending != null or (full.facets.may_throw and !analysis.language_live)) return self.noFixedBodyProof(full, returned, thrown);
        // The namespace is shared across completions; mutable saved contents
        // are not. Clone the invalidated pre-result state before either exit
        // installs its complete heap relationships.
        var language_state: ?UpperState = if (full.facets.may_throw) try UpperState.clone(c, destination) else null;
        defer if (language_state) |*state| state.deinit(c);
        var root_export = FixedExport{ .g = self, .analysis = &analysis, .target = target, .op = op, .offset = offset, .saved = saved, .destination = destination, .invocation = invocation, .allocator = allocator, .environments = &.{}, .inputs = &inputs };
        for (analysis.effects) |effect| {
            var projected = try root_export.root(effect.root); defer projected.deinit(c.allocator);
            try self.mark(&projected, switch (effect.flag) { .read => .read, .write => .write, .structural => .structural });
        }
        const outputs = [_][]const usize{ analysis.normal, analysis.language }; const into = [_]*Owners{ returned, thrown };
        const live = [_]bool{ analysis.normal_live, analysis.language_live and full.facets.may_throw };
        for (outputs, into, live, 0..) |values, owners, reachable, index| {
            try c.step(); if (!reachable) continue;
            const state = if (index == 0) destination else &language_state.?;
            try state.fixedBirth(c, invocation);
            try c.charge(analysis.locations.len + 1); const environments = try c.allocator.alloc(effect_env.Set, analysis.locations.len); @memset(environments, .{});
            defer { for (environments) |*environment_set| environment_set.deinit(c.allocator); c.allocator.free(environments); }
            var export_graph = FixedExport{ .g = self, .analysis = &analysis, .target = target, .op = op, .offset = offset, .saved = saved, .destination = state, .invocation = invocation, .allocator = allocator, .environments = environments, .inputs = &inputs, .completion = @enumFromInt(index) };
            if (!try export_graph.initialize()) return self.noFixedBodyProof(full, returned, thrown);
            if (values.len == 0) owners.nonowning = true;
            for (values) |id| { var value = try export_graph.exportValue(id); defer value.deinit(c.allocator); _ = try owners.join(c, &value); }
        }
        if (completions) |outgoing| {
            outgoing.normal = analysis.normal_live;
            if (outgoing.language_state) |*old| old.deinit(c);
            outgoing.language_state = language_state; language_state = null;
        }
        return true;
    }
    fn fixedGraphSummary(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, destination: *UpperState, offset: usize, full: *const publication.EffectUpper, returned: *Owners, thrown: *Owners, completions: ?*UpperCompletions) Error!bool {
        const collector = self.collector; const c = collector.c;
        const contract_index = collector.contracts[@intFromEnum(target)] orelse return false;
        const fixed = &c.program.tables.mode.common.authority.fixed_publication;
        const graph = if (fixed.publication.contracts[contract_index].return_origins) |*value| value else {
            // Null is an unavailable relation, not an invitation to substitute
            // this callee's current body. Only a dependent use of this opaque
            // result requests owner proof; complete permissions still apply.
            try self.applyCaptureUpper(target, op, state, full);
            _ = try returned.makeOpaque(c); if (full.facets.may_throw) _ = try thrown.makeOpaque(c); return true;
        };
        var receiver = false;
        for (graph.nodes) |node| { try c.step(); if (node == .receiver_input or node == .receiver_frame or node == .receiver_value) { receiver = true; break; } }
        // References, complete original contracts and directory ownership were
        // checked by this same Context before Collector. Reuse their typed
        // immutable projection; current-body AliasSummary is not fixed data.
        var arena = std.heap.ArenaAllocator.init(c.allocator); defer arena.deinit();
        const directory = try publication_refs.returnOriginDirectory(c, arena.allocator(), fixed.*);
        var budget: origin_model.Budget = .{ .context = c, .charge = publication_refs.graphCharge };
        var body = try body_origins.project(c, target, &directory, &budget); defer body.deinit();
        if (body.pending != null) {
            return self.noFixedBodyProof(full, returned, thrown);
        }
        const function_id = try publication_refs.symbol(c, arena.allocator(), c.program.functions[@intFromEnum(target)].id);
        const constructor_input = try publication_refs.returnOriginConstructorInput(c, arena.allocator(), fixed.*, function_id);
        try c.charge(fixed.publication.contracts.len + 1);
        const contracts = try arena.allocator().alloc(structural_origins.FixedContract, fixed.publication.contracts.len);
        for (fixed.publication.contracts, constructor_input.fixed, contracts) |*row, *complete, *entry| {
            try c.step(); entry.* = .{ .function_id = try publication_refs.symbol(c, arena.allocator(), row.function_id), .graph = if (row.return_origins) |*value| value else null, .complete = complete };
        }
        // Body is independently derived ONLY from the current owned SSA/ABI.
        // The immutable complete fixed contract vector is solely the upper.
        const coverage = structural_origins.covered(c.allocator, &directory, function_id, &body.graph.?, contracts, &budget) catch |err| return publication_refs.graphFailure(err);
        if (coverage == .pending) return self.noFixedBodyProof(full, returned, thrown);
        if (!receiver) return self.fixedOwnersGraph(target, op, state, destination, offset, full, &directory, function_id, graph, &budget, arena.allocator(), null, returned, thrown, completions);
        // Receiver return interpretation is owned by the independently checked
        // construction-frame protocol. It is not selected actual entrances or
        // the cached effect proof. Complete current-body inclusion above stays
        // mandatory before any immutable fixed return value is consumed.
        if (receiver) {
            try c.charge(2); const target_function = c.program.functions[@intFromEnum(target)];
            if (target_function.role != .construction_body or collector.common().abis[@intFromEnum(target_function.abi)].construction == null) return self.noFixedBodyProof(full, returned, thrown);
        }
        var analysis = construction_origins.analyzeReturns(c.allocator, &directory, graph, &budget, constructor_input) catch |err| return publication_refs.graphFailure(err);
        defer analysis.deinit();
        if (analysis.pending != null) return self.noFixedBodyProof(full, returned, thrown);
        for(analysis.initializations) |*write| {
            try c.row(construction_origins.Initialization);
            // Domain stores are restricted to the REAL allocated bound
            // receiver. Consume all live prefix write owners, including stores
            // preceding language completion/nontermination, through the same
            // owner projection and permission transfer as other fixed facts.
            if(write.base.category!=.object or write.base.source!=.allocation)return self.noFixedBodyProof(full,returned,thrown);
            var origin:Owners=.{}; defer origin.deinit(c.allocator); _=try origin.add(c,.local);
            var projected:Owners=.{}; defer projected.deinit(c.allocator);
            try self.projectSummary(&origin,target,op,state,offset,&projected); try self.mark(&projected,.write);
        }
        return self.fixedOwnersGraph(target, op, state, destination, offset, full, &directory, function_id, graph, &budget, arena.allocator(), &analysis, returned, thrown, completions);
    }
    fn consume(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *UpperState, incoming: *const UpperState, offset: usize, prefix: bool, returned: *Owners, thrown: *Owners, completions: *UpperCompletions) Error!void {
        const collector = self.collector; const c = collector.c;
        completions.deinit(c); completions.normal = true; completions.language = false;
        const full = if (self.summarizing) original: {
            try c.step(); break :original collector.upper(target) orelse return error.InvalidShape;
        } else try collector.consumeUpper(self.function, target);
        const target_abi = collector.common().abis[@intFromEnum(c.program.functions[@intFromEnum(target)].abi)];
        if(target_abi.construction!=null and !self.summarizing and (try collector.receiverProof(target))==null)collector.fixed_upper_origin_pending=true;
        if (target_abi.lexical_environment != null) {
            var supplied: effect_env.Set = .{}; defer supplied.deinit(c.allocator);
            try self.callEnvironments(target, op, state, &supplied);
            if (!self.summarizing and (supplied.unknown or supplied.items.items.len == 0)) collector.fixed_upper_origin_pending = true;
        }
        try c.require(offset <= op.operands.len);
        try c.require(if (prefix) full.parameters.len <= op.operands.len - offset else full.parameters.len == op.operands.len - offset);
        if (!self.summarizing) for (full.parameters, 0..) |access_mode, i| {
            if(target_abi.construction!=null and i==0)continue; // The hidden frame is not an actual receiver object.
            try c.step(); const argument = &state.values[@intFromEnum(op.operands[offset + i])];
            if (access_mode.read) try self.markContents(incoming, argument, .read);
            if (access_mode.write) try self.markContents(incoming, argument, .write);
            if (access_mode.structural) try self.markContents(incoming, argument, .structural);
        };
        for (full.parameters) |flags| { try c.step(); if (flags.write or flags.structural) { try state.dirtyPayloads(c); break; } }
        try c.step(); if (full.globals.writes.len != 0 or full.host_resources.writes.len != 0) try state.dirtyPayloads(c);
        // Complete declared writes revoke PRE-call selected contents on both
        // continuations. Fixed return relationships are then installed from
        // their immutable graph using the saved pre-call input, so a returned
        // activation is not accidentally revoked as an old captured value.
        for (full.captures) |captured| {
            try c.step(); if (!captured.write) continue;
            try state.dirtyPayloads(c);
            for (collector.captures, 0..) |slot, id| {
                try c.step(); const found = slot orelse continue;
                const key = collector.common().closures.environments[@intFromEnum(found.environment)].slots[@intFromEnum(found.slot)].key;
                if (std.mem.eql(u8, &key, &captured.slot)) try state.dirtyCapture(c, @enumFromInt(id));
            }
        }
        if (full.facets.unknown_host or full.facets.@"await") { try state.dirtyEnvironments(c); try state.dirtyPayloads(c); }
        const fixed = try self.fixedGraphSummary(target, op, incoming, state, offset, full, returned, thrown, completions);
        const summary = &collector.aliases[@intFromEnum(target)];
        const project = summary.transparent and (self.summarizing or summary.available);
        if (!fixed) {
            if (project and (summary.normal_seen or summary.normal_missing)) {
                try self.projectSummary(&summary.normal, target, op, incoming, offset, returned);
            } else if (!self.summarizing or !summary.transparent) {
                _ = try returned.makeOpaque(c);
            }
        }
        if (full.facets.may_throw) {
            if (!fixed) {
                if (project and (summary.language_seen or summary.language_missing)) {
                    try self.projectSummary(&summary.language, target, op, incoming, offset, thrown);
                } else if (!self.summarizing or !summary.transparent) {
                    _ = try thrown.makeOpaque(c);
                }
            }
            completions.language = true;
            if (completions.language_state == null) completions.language_state = try UpperState.clone(c, state);
        }
    }
    fn consumeAlternative(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, input: *const UpperState, alternatives: *?UpperState, offset: usize, prefix: bool, returned: *Owners, thrown: *Owners, completions: *UpperCompletions) Error!void {
        const c = self.collector.c; var branch = try UpperState.clone(c, input); var owns = true; defer if (owns) branch.deinit(c);
        var outgoing: UpperCompletions = .{}; defer outgoing.deinit(c);
        try self.consume(target, op, &branch, input, offset, prefix, returned, thrown, &outgoing);
        completions.normal = completions.normal or outgoing.normal; completions.language = completions.language or outgoing.language;
        if (outgoing.normal) {
            if (alternatives.*) |*old| _ = try old.join(c, &branch) else { alternatives.* = branch; owns = false; }
        }
        if (outgoing.language_state) |*state| {
            if (completions.language_state) |*old| _ = try old.join(c, state) else { completions.language_state = outgoing.language_state; outgoing.language_state = null; }
        }
    }
    fn prepare(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)];
        const summary = &collector.aliases[@intFromEnum(self.function)];
        summary.lexical_cells = try self.proveLexicalCells();
        try self.provePrivateAggregates();
        summary.transparent = true;
        // This is a deliberately finite transparent seam: direct parameter /
        // global roots, scalar work, copies, phi/route, and recursive calls. The old
        // Selected fields retain the nonescaping profile above. Env contents
        // use symbolic input/birth provenance; escaped callee-local Env graphs
        // and managed capture-return permissions remain unresolved.
        for (function.blocks) |block| for (block.instructions) |op| {
            try c.step(); switch (op.data) {
                .eh_cell, .eh_load, .eh_store => if (!summary.lexical_cells) { summary.transparent = false; },
                .domain_array_read, .domain_array_store, .domain_array_resize,
                .common_typed_array_create, .domain_read_span => summary.transparent = false,
                .domain_field_read => |read| if (self.privateField(op.operands[0], read.member) == null) { summary.transparent = false; },
                .domain_field_store => |write| if (self.privateField(op.operands[0], write.member) == null) { summary.transparent = false; },
                .eh_field_initialize => |write| if (self.privateField(op.operands[0], write.field) == null) { summary.transparent = false; },
                .eh_construct => if (!summary.aggregates.contains(op.result.?)) { summary.transparent = false; },
                .domain_literal => |data| if (v.types[@intFromEnum(data.actual_type)].kind == .reference) { summary.transparent = false; },
                else => {},
            }
        };
    }
    fn run(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)]; const abi = v.abis[@intFromEnum(function.abi)];
        const summary = &collector.aliases[@intFromEnum(self.function)];
        // A constructor's receiver language gates need the complete current
        // body's formal control protocol, never its own-return certificate or
        // narrower actual replay. Unsupported bodies keep the original flow.
        var control_arena = std.heap.ArenaAllocator.init(c.allocator); defer control_arena.deinit();
        var control_body: ?body_origins.Projection = null; defer if (control_body) |*body| body.deinit();
        var control_analysis: ?construction_origins.Analysis = null; defer if (control_analysis) |*analysis| analysis.deinit();
        const effect_proof = try collector.receiverProof(self.function);
        var receiver_flow: ?body_origins.ReceiverFlow = null;
        if (effect_proof) |proof| { try c.row(body_origins.ReceiverFlow); try c.row(origin_model.Graph); receiver_flow = proof.flow; }
        if (receiver_flow == null and abi.construction != null) {
            const fixed = &v.authority.fixed_publication;
            const directory = try publication_refs.returnOriginDirectory(c, control_arena.allocator(), fixed.*);
            var budget: origin_model.Budget = .{ .context = c, .charge = publication_refs.graphCharge };
            control_body = try body_origins.projectReceiverControls(c, self.function, &directory, &budget);
            if (control_body.?.pending == null) {
                const function_id = try publication_refs.symbol(c, control_arena.allocator(), function.id);
                const constructor_input = try publication_refs.returnOriginConstructorInput(c, control_arena.allocator(), fixed.*, function_id);
                control_analysis = construction_origins.analyzeControls(c.allocator, &directory, &control_body.?.graph.?, &budget, constructor_input) catch |err| return publication_refs.graphFailure(err);
                if (control_analysis.?.pending == null) {
                    try c.row(body_origins.ReceiverFlow); try c.row(origin_model.Graph);
                    receiver_flow = .{ .graph = control_body.?.graph.?, .block_controls = control_body.?.block_controls, .receiver_actions = control_body.?.receiver_actions, .controls = control_analysis.?.controls, .action_results = control_analysis.?.action_results };
                }
            }
        }
        const controlled = receiver_flow != null;
        self.lexical_cells = summary.lexical_cells;
        try c.charge(function.blocks.len * 2 + 1);
        const entries = try c.allocator.alloc(?UpperState, function.blocks.len); @memset(entries, null);
        defer { for (entries) |*entry| if (entry.*) |*saved| saved.deinit(c); c.allocator.free(entries); }
        const queued = try c.allocator.alloc(bool, function.blocks.len); defer c.allocator.free(queued); @memset(queued, false);
        var pending: std.ArrayListUnmanaged(t.BlockRef) = .empty; defer pending.deinit(c.allocator);
        var initial = try UpperState.init(c, function.registers.len); var owns = true; defer if (owns) initial.deinit(c);
        const hidden: usize = if (abi.lexical_environment != null) 1 else 0;
        if (!self.summarizing and hidden != 0) try collector.facet(self.function, .managed_reference);
        if (abi.lexical_environment) |layout| {
            // A formal input tied to this SSA entry, not every instance of
            // its layout. No caller payload, object or permitted code is seeded.
            _ = try initial.values[@intFromEnum(function.blocks[0].parameters[0])].environments.direct.add(c, .{ .layout = layout, .source = .input });
        }
        const count = abi.parameters.len + @as(usize, if (abi.receiver != null) 1 else 0);
        for (0..count) |i| {
            if(abi.construction!=null and i==0)continue; // Selected this ownership starts at bind/get, never at frame entry.
            try c.step(); const id = if (abi.receiver != null and i == 0) abi.receiver.? else abi.parameters[i - @as(usize, if (abi.receiver != null) 1 else 0)];
            // Alias identity also matters for a callable/scalar later returned
            // or packed as a language payload. Access permissions remain
            // managed-only in mark(), just like the actual observer.
            const owner = Owner{ .parameter = i };
            const binding_value = try initial.slots.getOrPut(c.allocator, .{ .binding = id });
            if (!binding_value.found_existing) binding_value.value_ptr.* = .{};
            _ = try binding_value.value_ptr.add(c, owner);
            const entry_register = function.blocks[0].parameters[hidden + i];
            const entry = &initial.values[@intFromEnum(entry_register)];
            _ = try entry.add(c, owner);
            // A formal callable contributes no pair. Its unknown alternative
            // must survive a phi with a locally constructed, paired closure.
            var unknown_callable = try collector.callablePayload(v.storage.bindings[@intFromEnum(id)].@"type");
            // Logical views do not constrain the actual carrier's capacity.
            switch (function.registers[@intFromEnum(entry_register)].carrier) {
                .@"type" => |actual| unknown_callable = (try collector.callablePayload(actual)) or unknown_callable,
                .domain => |actual| for (v.domains[@intFromEnum(actual)].actual_types) |member| {
                    try c.step(); unknown_callable = (try collector.callablePayload(member)) or unknown_callable;
                },
                .payload => unknown_callable = true,
                else => {},
            }
            binding_value.value_ptr.environments.callable_unknown = unknown_callable;
            entry.environments.callable_unknown = unknown_callable;
            if (!self.summarizing and try collector.managedType(v.storage.bindings[@intFromEnum(id)].@"type")) {
                try collector.facet(self.function, .managed_reference);
            }
        }
        if (!self.summarizing) if (abi.result) |result| if (try collector.managedType(result)) try collector.facet(self.function, .managed_reference);
        entries[0] = initial; owns = false; queued[0] = true; try pending.append(c.allocator, @enumFromInt(0));
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const b = @intFromEnum(pending.items[cursor]); queued[b] = false;
            if (controlled) { try c.step(); if (!receiver_flow.?.controls[receiver_flow.?.block_controls[b]]) continue; }
            var state = try UpperState.clone(c, &entries[b].?); defer state.deinit(c);
            for (function.blocks[b].instructions, 0..) |op, index| {
                self.block = @enumFromInt(b); self.instruction = @intCast(index);
                try c.charge(op.operands.len + 1); var result: Owners = .{}; defer result.deinit(c.allocator);
                if (!self.summarizing) if (op.result) |reg| {
                    const saved = function.registers[@intFromEnum(reg)];
                    const logical: ?t.TypeRef = saved.view orelse if (saved.carrier == .@"type") saved.carrier.@"type" else null;
                    if (logical) |id| if (try collector.managedType(id)) try collector.facet(self.function, .managed_reference);
                };
                switch (op.data) {
                    .global_load => |data| {
                        if (!self.summarizing) try collector.global(self.function, data.global, .read);
                        _ = try result.add(c, .{ .global = data.global });
                        // A global permission label is known; its selected
                        // callable/Env payload has not been derived here.
                        result.environments.callable_unknown = true; result.environments.direct.unknown = true;
                    },
                    .global_store => |data| if (!self.summarizing) { try collector.global(self.function, data.global, .write); },
                    .eh_cell => |data| {
                        const id = v.exceptions.bindings[@intFromEnum(data.binding)].binding;
                        if (state.slots.fetchRemove(.{ .binding = id })) |removed| { var old = removed.value; old.deinit(c.allocator); }
                    },
                    .eh_load => |data| {
                        try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, null, false);
                        // Only the unique, private lexical-Cell protocol above
                        // connects a dynamic handle to the lexical binding flow.
                        if (!self.lexical_cells) _ = try result.makeOpaque(c);
                    },
                    .eh_store => |data| try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, &state.values[@intFromEnum(op.operands[1])], data.initialize),
                    inline .environment_load, .environment_store, .environment_init => |data| {
                        const env = function.registers[@intFromEnum(op.operands[0])].carrier.environment;
                        // Resolve the receiver before a store can reallocate
                        // selected slot maps. This is a borrowed register facet.
                        try self.environment(&state, &state.values[@intFromEnum(op.operands[0])].environments.direct,
                            .{ .environment = env, .slot = data.slot }, &result,
                            if (op.data == .environment_load) null else &state.values[@intFromEnum(op.operands[1])], op.data == .environment_init);
                    },
                    .environment_parent => {
                        _ = try result.add(c, .local);
                        try self.parentEnvironments(&state, &state.values[@intFromEnum(op.operands[0])].environments.direct, &result.environments.direct);
                    },
                    .domain_field_read => |read| {
                        const receiver = op.operands[0]; try self.mark(&state.values[@intFromEnum(receiver)], .read);
                        if (self.privateField(receiver, read.member)) |slot| {
                            if (state.slots.getPtr(slot)) |stored| try result.replace(c, stored) else _ = try result.makeOpaque(c);
                        } else try self.selectPayload(&state, &state.values[@intFromEnum(receiver)], read.receiver_view, read.member, &result);
                    },
                    .domain_array_read => {
                        const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .read);
                        const view = function.registers[@intFromEnum(op.operands[0])].view orelse return error.InvalidShape;
                        try self.selectPayload(&state, receiver, view, null, &result);
                    },
                    .domain_array_length => { try self.mark(&state.values[@intFromEnum(op.operands[0])], .read); result.nonowning = true; },
                    .domain_field_store => |write| {
                        try self.mark(&state.values[@intFromEnum(op.operands[0])], .write);
                        if (self.privateField(op.operands[0], write.member)) |slot| try state.store(c, slot, &state.values[@intFromEnum(op.operands[1])]);
                        try self.storePayload(&state, &state.values[@intFromEnum(op.operands[0])], write.receiver_view, write.member, &state.values[@intFromEnum(op.operands[1])], false);
                    },
                    .eh_field_initialize => |write| {
                        // Legality/phase/anchors remain the existing upstream
                        // construction duty. Track only the actual operand's
                        // lexical roots; private storage grants no 81 privilege.
                        if (self.privateField(op.operands[0], write.field)) |slot| try state.store(c, slot, &state.values[@intFromEnum(op.operands[1])]);
                        try self.storePayload(&state, &state.values[@intFromEnum(op.operands[0])], function.registers[@intFromEnum(op.operands[0])].view orelse return error.InvalidShape, write.field, &state.values[@intFromEnum(op.operands[1])], true);
                    },
                    .receiver_create,.receiver_child,.initialize_begin,.initialize_end => { result.nonowning=true; },
                    .receiver_allocate => {
                        _=try result.add(c,.local); result.payloads.unknown = true;
                        if(!self.summarizing) { try collector.facet(self.function,.allocation); try collector.facet(self.function,.managed_reference); }
                    },
                    .initialize_field => {
                        // Consume the same complete prefix-field evidence as
                        // the actual observer, then retain the lexical access.
                        if(!self.summarizing and !try collector.receiverField(self.function,b,index))collector.fixed_upper_origin_pending=true;
                        try self.mark(&state.values[@intFromEnum(op.operands[1])],.write); result.nonowning=true;
                    },
                    .domain_array_store => |write| { const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .write); try self.mark(receiver, .structural);
                        try self.storePayload(&state, receiver, write.receiver_view, null, &state.values[@intFromEnum(op.operands[2])], false);
                    },
                    .domain_array_resize => { const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .write); try self.mark(receiver, .structural); },
                    .domain_copy => try self.copyPayload(&state, op.result.?, &state.values[@intFromEnum(op.operands[0])], &result),
                    .domain_view, .domain_refine, .eh_assertion, .eh_presence_widen => try result.replace(c, &state.values[@intFromEnum(op.operands[0])]),
                    .domain_read_span => { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); _ = try result.makeOpaque(c); },
                    .eh_pack => { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing) try collector.facet(self.function, .eh_control); },
                    .eh_carrier => |view| { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing and view == null) try collector.facet(self.function, .eh_control); },
                    .function_make => {
                        if (op.operands.len == 0) { result.nonowning = true; var empty: effect_env.Set = .{}; defer empty.deinit(c.allocator); try result.environments.pair(c, op.data.function_make.function, &empty); } else {
                            _ = try result.add(c, .local);
                            var selected = try effect_env.Set.clone(c, &state.values[@intFromEnum(op.operands[0])].environments.direct);
                            defer selected.deinit(c.allocator); if (selected.items.items.len == 0) selected.unknown = true;
                            try result.environments.pair(c, op.data.function_make.function, &selected);
                        }
                    },
                    .environment_alloc => |data| {
                        const handle = op.result.?;
                        var parent: effect_env.Set = .{}; defer parent.deinit(c.allocator);
                        if (op.operands.len != 0) _ = try parent.join(c, &state.values[@intFromEnum(op.operands[0])].environments.direct);
                        try state.birth(c, handle, data.environment, &parent);
                        _ = try result.add(c, .local);
                        _ = try result.environments.direct.add(c, .{ .layout = data.environment, .source = .{ .birth = handle } });
                        if (!self.summarizing) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    inline .common_typed_array_create, .domain_array_create => |array| {
                        const key = try state.birthPayload(c, op.result.?, array.actual_array_type, 1); _ = try result.payloads.add(c, key); _ = try result.add(c, .local);
                        var elements: Owners = .{}; defer elements.deinit(c.allocator);
                        for (op.operands) |operand| { try c.step(); _ = try elements.join(c, &state.values[@intFromEnum(operand)]); }
                        try payloadKeyWork(c, key); state.payloads.getPtr(key).?.slots[0] = try Owners.clone(c, &elements);
                        if (!self.summarizing) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .string_concat => {
                        _ = try result.add(c, .local);
                        if (!self.summarizing) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .eh_construct => |data| {
                        _ = try result.add(c, .local);
                        if (try self.payloadCount(data.owner)) |field_count| { const key = try state.birthPayload(c, op.result.?, data.owner, field_count); _ = try result.payloads.add(c, key); } else result.payloads.unknown = true;
                        if (summary.aggregates.get(op.result.?)) |aggregate| {
                            // A repeated static birth kills every old lexical
                            // field fact before 81/56 stores. Missing fields are
                            // never defaulted to empty or a declared Type value.
                            for (v.storage.concrete[aggregate.concrete].body.?.fields) |field| {
                                try c.step();
                                if (state.slots.fetchRemove(.{ .binding = field.binding, .receiver = op.result.? })) |removed| { var old = removed.value; old.deinit(c.allocator); }
                            }
                        }
                        if (!self.summarizing and v.types[@intFromEnum(data.owner)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .domain_literal => |data| {
                        switch (v.types[@intFromEnum(data.actual_type)].kind) {
                            .scalar, .@"null", .@"undefined" => result.nonowning = true,
                            .string => _ = try result.add(c, .local),
                            .reference, .value, .array, .readSpan => { _ = try result.add(c, .local); result.payloads.unknown = true; },
                            else => _ = try result.makeOpaque(c),
                        }
                        if (!self.summarizing and v.types[@intFromEnum(data.actual_type)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .eh_enter => if (!self.summarizing) { try collector.facet(self.function, .eh_control); },
                    .authorized_host => {
                        if (!self.summarizing) try collector.hostEffects(self.function);
                        try state.dirtyPayloads(c);
                        // A verified scalar result carries no external owner.
                        // Missing material remains pending, never an empty root.
                        if (collector.host_material == null) _ = try result.makeOpaque(c) else result.nonowning = true;
                    },
                    .string_constant => _ = try result.add(c, .local),
                    .const_i32, .const_integer, .const_float, .const_bool, .add, .sub, .mul, .div, .rem,
                    .shl, .shr, .ushr, .@"and", .@"or", .xor, .neg, .not, .pos, .bool_not, .eq, .ne,
                    .lt, .le, .gt, .ge, .eh_equal => result.nonowning = true,
                    else => {},
                }
                if (op.result) |reg| try state.values[@intFromEnum(reg)].replace(c, &result);
                switch (op.data) {
                    inline .receiver_bind,.receiver_get,.receiver_result => |control| {
                        // Control alone never closes owner/field coverage. Only
                        // the complete shared current-body proof closes this duty.
                        if(!self.summarizing and effect_proof==null)collector.fixed_upper_origin_pending=true;
                        var selected: Owners=.{}; defer selected.deinit(c.allocator);
                        var failure: Owners=.{}; defer failure.deinit(c.allocator);
                        if (controlled) {
                            var action: ?body_origins.ReceiverControl = null;
                            for (receiver_flow.?.receiver_actions) |row| {
                                try c.charge(2); if (row.block == b and row.instruction == index) { action = row; break; }
                            }
                            const row = action orelse return error.InvalidShape;
                            const atoms = [_][]const construction_origins.Atom{ receiver_flow.?.action_results[row.normal], receiver_flow.?.action_results[row.language] };
                            const owners = [_]*Owners{ &selected, &failure };
                            for (atoms, owners) |values, into| for (values) |atom| {
                                try c.step(); switch (atom.source) {
                                    .allocation, .scoped_allocation, .language_error => { _ = try into.add(c, .local); into.payloads.unknown = true; },
                                    .node => |id| switch (receiver_flow.?.graph.nodes[id]) {
                                        .local => { _ = try into.add(c, .local); },
                                        .parameter => |parameter| { _ = try into.add(c, .{ .parameter = parameter.index }); },
                                        else => { _ = try into.makeOpaque(c); },
                                    },
                                }
                            };
                            try c.charge(2);
                            if (receiver_flow.?.controls[row.normal_control]) try self.edge(entries,queued,&pending,control.normal,&state,&.{selected});
                            if (receiver_flow.?.controls[row.language_control]) try self.edge(entries,queued,&pending,control.language,&state,&.{failure});
                        } else {
                            _=try selected.makeOpaque(c); _=try failure.makeOpaque(c);
                            try self.edge(entries,queued,&pending,control.normal,&state,&.{selected});
                            try self.edge(entries,queued,&pending,control.language,&state,&.{failure});
                        }
                    },
                    .eh_invoke, .eh_invoke_indirect, .common_method_invoke => {
                        var completions: UpperCompletions = .{ .normal = false }; defer completions.deinit(c); var found = false;
                        var input = try UpperState.clone(c, &state); defer input.deinit(c);
                        var alternatives: ?UpperState = null; defer if (alternatives) |*saved| saved.deinit(c);
                        var returned: Owners = .{}; defer returned.deinit(c.allocator);
                        var thrown: Owners = .{}; defer thrown.deinit(c.allocator);
                        switch (op.data) {
                            .eh_invoke => |call| { const target_abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(call.callee)].abi)]; try self.consumeAlternative(call.callee, op, &input, &alternatives, if (target_abi.lexical_environment != null) 1 else 0, false, &returned, &thrown, &completions); found = true; },
                            .common_method_invoke => |call| for (v.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| { try c.step(); const target = arm.target orelse return error.InvalidShape; try self.consumeAlternative(target, op, &input, &alternatives, 0, true, &returned, &thrown, &completions); found = true; },
                            .eh_invoke_indirect => {
                                // Permission roots do not establish or refute
                                // code/env pairs. consume checks the independently
                                // retained pair for EVERY permitted target.
                                for (v.closures.calls) |row| {
                                    try c.step(); if (row.function != self.function or @intFromEnum(row.block) != b or row.instruction != index) continue;
                                    for (row.targets) |target| { try c.step(); try self.consumeAlternative(target, op, &input, &alternatives, 1, false, &returned, &thrown, &completions); found = true; }
                                }
                            },
                            else => unreachable,
                        }
                        if (alternatives) |saved| { state.deinit(c); state = saved; alternatives = null; }
                        if (!found) {
                            if (!self.summarizing) collector.fixed_upper_origin_pending = true;
                            completions.normal = true; completions.language = true;
                            _ = try returned.makeOpaque(c); _ = try thrown.makeOpaque(c);
                        }
                        const normal = switch (op.data) { .eh_invoke => |call| call.normal, .eh_invoke_indirect => |call| call.normal, .common_method_invoke => |call| call.normal, else => unreachable };
                        const exceptional = switch (op.data) { .eh_invoke => |call| call.exceptional, .eh_invoke_indirect => |call| call.exceptional, .common_method_invoke => |call| call.exceptional, else => unreachable };
                        // Only an immutable complete exit relation can close
                        // an edge. A missing/bottom result cannot do so.
                        if (completions.normal) try self.edge(entries, queued, &pending, normal, &state, if (function.blocks[@intFromEnum(normal)].parameters.len == 0) &.{} else &.{returned});
                        if (completions.language) try self.edge(entries, queued, &pending, exceptional, if (completions.language_state) |*outgoing| outgoing else &state, &.{thrown});
                    },
                    .@"br", .eh_route => {
                        const target = switch (op.data) { .@"br" => |branch| branch.destination, .eh_route => |route| route.successor, else => unreachable };
                        try c.charge(op.operands.len); const arguments = try c.allocator.alloc(Owners, op.operands.len); defer c.allocator.free(arguments);
                        for (op.operands, arguments) |reg, *argument| argument.* = state.values[@intFromEnum(reg)];
                        try self.edge(entries, queued, &pending, target, &state, arguments);
                    },
                    .@"cond_br" => |branch| {
                        try c.charge(op.operands.len); const arguments = try c.allocator.alloc(Owners, op.operands.len - 1); defer c.allocator.free(arguments);
                        for (op.operands[1..], arguments) |reg, *argument| argument.* = state.values[@intFromEnum(reg)];
                        try self.edge(entries, queued, &pending, branch.true_destination, &state, arguments[0..branch.true_count]);
                        try self.edge(entries, queued, &pending, branch.false_destination, &state, arguments[branch.true_count..]);
                    },
                    .domain_numeric_use => |guard| try self.edge(entries, queued, &pending, guard.normal_successor, &state, &.{Owners{ .nonowning = true }}),
                    .eh_raise => {
                        if (self.summarizing) {
                            const value = &state.values[@intFromEnum(op.operands[0])];
                            if (value.known() and !summary.language_seen) { summary.language_seen = true; self.changed = true; }
                            self.changed = (try summary.language.join(c, value)) or self.changed;
                        } else try collector.facet(self.function, .may_throw);
                    },
                    .@"return" => {
                        if (self.summarizing) {
                            const known = op.operands.len == 0 or state.values[@intFromEnum(op.operands[0])].known();
                            if (known and !summary.normal_seen) { summary.normal_seen = true; self.changed = true; }
                            if (op.operands.len == 0 and !summary.normal.nonowning) { summary.normal.nonowning = true; self.changed = true; }
                        }
                        if (op.operands.len != 0) {
                            if (self.summarizing) {
                                self.changed = (try summary.normal.join(c, &state.values[@intFromEnum(op.operands[0])])) or self.changed;
                            } else if (abi.result) |id| if (try collector.managedType(id)) try collector.facet(self.function, .escape);
                        }
                    },
                    else => {},
                }
            }
        }
    }
};

// init is deliberately Common-only. Legacy Published Domain bounds and EH's
// empty Authority are not an empty effect contract or effect permission.
// The caller multiplexes observer() with Borrow on the same final replay, then
// calls finish(). This module never invokes an engine or creates a Program.
// The private owner flow at finish covers complete-upper language paths absent
// from actual replay. Unknown effect-root and Host bindings remain explicit.
pub const Collector = struct {
    c: *Context,
    host_material: ?*const host_binding.Bundle,
    contracts: []?usize,
    concrete: []?usize,
    captures: []?Capture,
    managed: []Managed,
    aliases: []AliasSummary,
    receiver_effects: []?*body_origins.ReceiverEffects,
    unresolved: bool = false,
    fixed_upper_origin_pending: bool = false,
    // Borrowed only during finish, after actual fixed point AND replay checks.
    final_actual: ?*const actual_targets.Analysis = null,
    fixed_upper_host_pending: bool = false,
    host_binding_required: bool = false,

    // Internal typed consumer: material was fully verified by the public
    // compiled-anchor boundary with this same Context, not merely supplied.
    pub fn init(c: *Context, material: ?*const host_binding.Bundle) Error!Collector {
        if (c.program.tables.mode != .common) return error.WrongMode;
        const v = c.program.tables.mode.common;
        try c.charge(3 * c.program.functions.len + 2 * v.types.len + v.storage.bindings.len);
        const contracts = try c.allocator.alloc(?usize, c.program.functions.len);
        errdefer c.allocator.free(contracts);
        const concrete = try c.allocator.alloc(?usize, v.types.len);
        errdefer c.allocator.free(concrete);
        const captures = try c.allocator.alloc(?Capture, v.storage.bindings.len);
        errdefer c.allocator.free(captures);
        const managed = try c.allocator.alloc(Managed, v.types.len);
        errdefer c.allocator.free(managed);
        const aliases = try c.allocator.alloc(AliasSummary, c.program.functions.len);
        errdefer c.allocator.free(aliases); @memset(aliases, .{});
        const receiver_effects = try c.allocator.alloc(?*body_origins.ReceiverEffects, c.program.functions.len);
        errdefer c.allocator.free(receiver_effects); @memset(receiver_effects, null);
        @memset(contracts, null); @memset(concrete, null);
        @memset(captures, null); @memset(managed, .empty);
        var ids: std.AutoHashMapUnmanaged(t.Hash, usize) = .empty;
        defer ids.deinit(c.allocator);
        for (c.program.functions, 0..) |f, i| {
            try c.step(); try ids.put(c.allocator, f.id, i);
        }
        for (v.authority.fixed_publication.publication.contracts, 0..) |row, i| {
            try c.step(); const f = ids.get(row.function_id) orelse return error.InvalidReference;
            try c.require(c.program.functions[f].role != .module_initializer and contracts[f] == null);
            contracts[f] = i;
        }
        for (c.program.functions, 0..) |f, i| {
            try c.require((f.role == .module_initializer) == (contracts[i] == null));
        }
        for (v.storage.concrete, 0..) |row, i| {
            try c.step(); concrete[@intFromEnum(row.@"type")] = i;
        }
        for (v.closures.environments, 0..) |env, e| for (env.slots, 0..) |slot, s| {
            try c.step(); const b = @intFromEnum(slot.binding);
            try c.require(captures[b] == null);
            captures[b] = .{ .environment = @enumFromInt(e), .slot = @enumFromInt(s) };
        };
        var result = Collector{ .c = c, .host_material = material, .contracts = contracts, .concrete = concrete, .captures = captures, .managed = managed, .aliases = aliases, .receiver_effects = receiver_effects };
        // An unreachable Host instruction still requires its original metadata
        // dependency. Its runtime effect permission follows actual replay.
        for (c.program.functions, 0..) |f, i| for (f.blocks) |block| for (block.instructions) |op| {
            try c.step(); if (op.data == .authorized_host) try result.hostMetadata(@enumFromInt(i), op.data.authorized_host.host);
        };
        return result;
    }
    pub fn deinit(self: *Collector) void {
        for (self.receiver_effects) |entry| if (entry) |owned| { owned.deinit(); self.c.allocator.destroy(owned); };
        self.c.allocator.free(self.receiver_effects);
        self.c.allocator.free(self.contracts); self.c.allocator.free(self.concrete);
        self.c.allocator.free(self.captures); self.c.allocator.free(self.managed);
        for (self.aliases) |*summary| summary.deinit(self.c.allocator); self.c.allocator.free(self.aliases);
    }
    // One owned complete current-body proof is shared by actual replay and the
    // independent complete-upper owner flow. A cached Pending stays Pending.
    fn receiverProof(self: *Collector, function: t.FunctionRef) Error!?*const body_origins.ReceiverEffectProof {
        const c = self.c; const index = @intFromEnum(function); try c.charge(3);
        const f = c.program.functions[index];
        if (self.common().abis[@intFromEnum(f.abi)].construction == null) return null;
        const owned = self.receiver_effects[index] orelse blk: {
            try c.charge(2); const entry = try c.allocator.create(body_origins.ReceiverEffects); errdefer c.allocator.destroy(entry);
            entry.* = try body_origins.coverReceiverEffects(c, function);
            self.receiver_effects[index] = entry; break :blk entry;
        };
        if (owned.proof) |*proof| return proof;
        return null;
    }
    fn receiverField(self: *Collector, function: t.FunctionRef, block: usize, instruction: usize) Error!bool {
        const proof = try self.receiverProof(function) orelse return false;
        for (proof.fields) |field| {
            try self.c.charge(2); if (field.block != block or field.instruction != instruction) continue;
            // The owning kernel requires these live prefix stores to target the
            // real bound allocation. This is lexical Local, no holding/alias
            // authority; the existing access/mark still checks each observation.
            for (proof.initializations) |write| { try self.c.step(); if (write.store == field.store) return true; }
            return false;
        }
        return false;
    }
    fn common(self: *const Collector) tables.CommonTables { return self.c.program.tables.mode.common; }
    fn upper(self: *Collector, function: t.FunctionRef) ?*const publication.EffectUpper {
        const index = self.contracts[@intFromEnum(function)] orelse return null;
        return &self.c.program.tables.mode.common.authority.fixed_publication.publication.contracts[index].upper;
    }
    fn facet(self: *Collector, function: t.FunctionRef, flag: Facet) Error!void {
        try self.c.step(); const bound = self.upper(function) orelse return;
        const allowed = switch (flag) {
            .allocation => bound.facets.allocation, .managed_reference => bound.facets.managed_reference,
            .eh_control => bound.facets.eh_control, .may_throw => bound.facets.may_throw,
            .@"await" => bound.facets.@"await", .lock => bound.facets.lock,
            .escape => bound.facets.escape, .unknown_host => bound.facets.unknown_host,
        };
        try self.c.require(allowed);
    }
    fn global(self: *Collector, function: t.FunctionRef, id: t.GlobalRef, access_mode: Access) Error!void {
        try self.c.step();
        const bound = self.upper(function) orelse return;
        const actual = self.common().modules.globals[@intFromEnum(id)].id;
        const allowed = if (access_mode == .read) bound.globals.reads else bound.globals.writes;
        for (allowed) |key| { try self.c.step(); if (std.mem.eql(u8, &key, &actual)) return; }
        return error.InvalidShape;
    }
    fn capture(self: *Collector, function: t.FunctionRef, env: t.EnvironmentRef, slot: t.EnvironmentSlotRef, access_mode: Access) Error!void {
        try self.c.step();
        const bound = self.upper(function) orelse return;
        const key = self.common().closures.environments[@intFromEnum(env)].slots[@intFromEnum(slot)].key;
        for (bound.captures) |row| {
            try self.c.step(); if (!std.mem.eql(u8, &key, &row.slot)) continue;
            try self.c.require(switch (access_mode) { .read => row.read, .write => row.write, .structural => row.structural }); return;
        }
        return error.InvalidShape;
    }
    fn callablePayload(self: *Collector, ref: t.TypeRef) Error!bool {
        try self.c.step(); const row = self.common().types[@intFromEnum(ref)];
        switch (row.kind) {
            .function, .unknown => return true,
            .@"union" => for (row.members) |member| { if (try self.callablePayload(member)) return true; },
            else => {},
        }
        return false;
    }
    fn managedType(self: *Collector, ref: t.TypeRef) Error!bool {
        const c = self.c; const id = @intFromEnum(ref); try c.step();
        if (self.managed[id] == .yes) return true;
        if (self.managed[id] == .no) return false;
        try c.require(self.managed[id] == .empty); self.managed[id] = .active;
        const v = self.common(); const row = v.types[id]; var answer = false;
        switch (row.kind) {
            .array, .reference, .readSpan, .string, .unknown => answer = true,
            .@"union" => for (row.members) |child| { if (try self.managedType(child)) answer = true; },
            .value => {
                const index = self.concrete[id] orelse return error.InvalidShape;
                for (v.storage.concrete[index].body.?.fields) |field| {
                    try c.step(); if (try self.managedType(v.members.fields[@intFromEnum(field.field)].@"type")) answer = true;
                }
            },
            else => {}, // A callable's reserved ABI root is not a captured env.
        }
        self.managed[id] = if (answer) .yes else .no; return answer;
    }
    fn managedValue(self: *Collector, world: facts.WorldView, value: facts.Value) Error!bool {
        try self.c.step(); if (value.unknown or value.callable_unknown or value.cells.len != 0) return true;
        for (value.callables) |pair| { try self.c.step(); if (pair.environment != null) return true; }
        for (value.objects) |id| {
            try self.c.step(); const object = world.object(id);
            if (object.kind != .value) return true;
            if (object.@"type") |tag| {
                const index = self.concrete[@intFromEnum(tag)] orelse return error.InvalidShape;
                if (self.common().storage.concrete[index].carrier.layout.reference_count != 0) return true;
            } else return true;
        }
        for (value.tags) |tag| {
            try self.c.step(); if (self.common().types[@intFromEnum(tag)].kind == .function) continue;
            const index = self.concrete[@intFromEnum(tag)] orelse return error.InvalidShape;
            if (self.common().storage.concrete[index].carrier.layout.reference_count != 0) return true;
        }
        return false;
    }
    fn parameter(self: *Collector, site: facts.Site, entry: t.RegisterRef, access_mode: Access) Error!void {
        const c = self.c; const v = self.common(); const f = c.program.functions[@intFromEnum(site.location.function)];
        const abi = v.abis[@intFromEnum(f.abi)]; const hidden: usize = if (abi.lexical_environment != null) 1 else 0;
        for (f.blocks[0].parameters, 0..) |reg, physical| {
            try c.step(); if (reg != entry) continue;
            if (physical < hidden) return;
            const logical = physical - hidden;
            const binding = if (abi.receiver != null and logical == 0) abi.receiver.? else abi.parameters[logical - @as(usize, if (abi.receiver != null) 1 else 0)];
            if (!try self.managedType(v.storage.bindings[@intFromEnum(binding)].@"type")) return;
            const bound = self.upper(site.location.function) orelse return;
            const allowed = bound.parameters[logical];
            try c.require(switch (access_mode) { .read => allowed.read, .write => allowed.write, .structural => allowed.structural }); return;
        }
        self.unresolved = true;
    }
    fn access(self: *Collector, site: facts.Site, value: facts.Value, mode: Access) Error!void {
        if (value.effect_origins.len == 0 and (value.unknown or value.callable_unknown)) self.unresolved = true;
        for (value.effect_origins) |origin| {
            try self.c.step();
            if (origin.context != site.context) { self.unresolved = true; continue; }
            switch (origin.owner) {
                .parameter => |entry| try self.parameter(site, entry, mode),
                .global => |id| try self.global(site.location.function, id, mode),
                .capture => |slot| {
                    const row = self.common().closures.environments[@intFromEnum(slot.environment)].slots[@intFromEnum(slot.slot)];
                    if (try self.managedType(row.@"type")) try self.capture(site.location.function, slot.environment, slot.slot, mode);
                },
                .unknown => self.unresolved = true,
            }
        }
    }
    fn resources(self: *Collector, function: t.FunctionRef, resource: []const u8, write: bool) Error!void {
        try self.c.step();
        const bound = self.upper(function) orelse return;
        const allowed = if (write) bound.host_resources.writes else bound.host_resources.reads;
        for (allowed) |id| {
            try self.c.charge(1 + id.len / 64 + resource.len / 64);
            if (std.mem.eql(u8, id, resource)) return;
        }
        return error.InvalidShape;
    }
    fn hostEffects(self: *Collector, function: t.FunctionRef) Error!void {
        try self.c.step();
        const material = self.host_material orelse { self.fixed_upper_host_pending = true; return; };
        // The owning boundary verified exact fixed Counter read-write rows,
        // scalar-only caller resources and empty callback/borrow/retain lists.
        // Read the complete original resource rows, including unobserved paths.
        for (material.contract.semantics.effects) |effect| {
            try self.c.step();
            try self.resources(function, effect.resource, false);
            try self.resources(function, effect.resource, true);
        }
    }
    fn hostMetadata(self: *Collector, function: t.FunctionRef, host: t.HostRef) Error!void {
        const c = self.c; const v = self.common(); const row = v.modules.hosts[@intFromEnum(host)];
        self.host_binding_required = true;
        try c.charge(1 + row.name.len / 64);
        try c.require(row.capability == 31 and std.mem.eql(u8, row.name, "Counter") and row.parameter_types.len == 1);
        const input = v.types[@intFromEnum(row.parameter_types[0])]; const output = v.types[@intFromEnum(row.return_type)];
        try c.require(input.kind == .scalar and input.native_code == 1 and output.kind == .scalar and output.native_code == 1);
        // These are metadata joins, not an implementation/HSC verification.
        const scope = v.authority.fixed_publication.stable_scope.host_context orelse return error.InvalidShape;
        try c.require(std.mem.eql(u8, &scope.contract_digest, &row.contract_digest) and std.mem.eql(u8, &scope.build_identity_digest, &row.build_identity_digest));
        for (v.authority.fixed_publication.dependencies[@intFromEnum(function)].hosts) |edge| {
            try c.step(); if (!std.mem.eql(u8, &edge.host_id, &row.id)) continue;
            try c.require(std.mem.eql(u8, &edge.contract_digest, &row.contract_digest) and std.mem.eql(u8, &edge.build_identity_digest, &row.build_identity_digest)); return;
        }
        return error.InvalidShape;
    }
    fn consumeUpper(self: *Collector, function: t.FunctionRef, target: t.FunctionRef) Error!*const publication.EffectUpper {
        const c = self.c; const v = self.common(); const f = c.program.functions[@intFromEnum(target)];
        const contract_index = self.contracts[@intFromEnum(target)] orelse return error.InvalidShape;
        const contract = v.authority.fixed_publication.publication.contracts[contract_index]; const full = contract.upper;
        var joined = false;
        for (v.authority.fixed_publication.dependencies[@intFromEnum(function)].callees) |edge| {
            try c.step(); if (!std.mem.eql(u8, &edge.function_id, &f.id)) continue;
            try c.require(std.mem.eql(u8, &edge.digest, &contract.digest)); joined = true; break;
        }
        try c.require(joined);
        try c.charge(std.meta.fields(Facet).len);
        // may_throw opens the independent upper graph's exceptional successor;
        // only a reachable language completion adds the caller's may_throw.
        inline for (std.meta.fields(Facet)) |field| {
            if (field.value != @intFromEnum(Facet.may_throw) and @field(full.facets, field.name))
                try self.facet(function, @enumFromInt(field.value));
        }
        for (full.globals.reads) |id| try self.inheritGlobal(function, id, .read);
        for (full.globals.writes) |id| try self.inheritGlobal(function, id, .write);
        for (full.host_resources.reads) |id| try self.resources(function, id, false);
        for (full.host_resources.writes) |id| try self.resources(function, id, true);
        // Capture flags are not textual caller-key inheritance. UpperGraph
        // consumes this COMPLETE vector through the saved Code+ENV graph,
        // including non-read slots and every permitted target.
        return &v.authority.fixed_publication.publication.contracts[contract_index].upper;
    }
    fn consume(self: *Collector, site: facts.Site, state: facts.StateView, target: t.FunctionRef, offset: usize, prefix: bool) Error!void {
        const c = self.c; const full = try self.consumeUpper(site.location.function, target);
        const op = c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        const constructor=self.common().abis[@intFromEnum(c.program.functions[@intFromEnum(target)].abi)].construction!=null;
        if(constructor and (try self.receiverProof(target))==null)self.fixed_upper_origin_pending=true;
        try c.require(offset <= op.operands.len);
        try c.require(if (prefix) full.parameters.len <= op.operands.len - offset else full.parameters.len == op.operands.len - offset);
        for (full.parameters, 0..) |wanted, i| {
            if(constructor and i==0)continue;
            try c.step(); const argument = state.values.reg(op.operands[offset + i]);
            if (wanted.read) try self.access(site, argument, .read);
            if (wanted.write) try self.access(site, argument, .write);
            if (wanted.structural) try self.access(site, argument, .structural);
        }
    }
    fn inheritGlobal(self: *Collector, function: t.FunctionRef, id: t.Hash, access_mode: Access) Error!void {
        for (self.common().modules.globals, 0..) |row, index| {
            try self.c.step(); if (std.mem.eql(u8, &id, &row.id)) return self.global(function, @enumFromInt(index), access_mode);
        }
        return error.InvalidReference;
    }
    fn environment(self: *Collector, site: facts.Site, state: facts.StateView, slot: t.EnvironmentSlotRef, store: bool, initialize: bool) Error!void {
        const c = self.c; const v = self.common(); const op = c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        const receiver = state.values.reg(op.operands[0]);
        const env = c.program.functions[@intFromEnum(site.location.function)].registers[@intFromEnum(op.operands[0])].carrier.environment;
        if (v.closures.environments[@intFromEnum(env)].owner != site.location.function) {
            try self.capture(site.location.function, env, slot, if (store) .write else .read); return;
        }
        if (!store or initialize) return;
        if (receiver.unknown or receiver.objects.len == 0) self.unresolved = true;
        for (receiver.objects) |object| {
            try c.step(); if (state.heap.get(.{ .environment_slot = .{ .object = object, .slot = slot } })) |old|
                try self.access(site, old, .write) else self.unresolved = true;
        }
    }
    fn cell(self: *Collector, site: facts.Site, state: facts.StateView, binding: t.CellRef, store: bool, initialize: bool) Error!void {
        const c = self.c; const v = self.common(); const b = @intFromEnum(v.exceptions.bindings[@intFromEnum(binding)].binding);
        const owner = v.storage.bindings[b].owner;
        const function = switch (owner) { .param, .local, .receiver => |f| f, else => return error.InvalidShape };
        if (function != site.location.function) {
            const captured = self.captures[b] orelse { self.unresolved = true; return; };
            try self.capture(site.location.function, captured.environment, captured.slot, if (store) .write else .read); return;
        }
        if (!store or initialize) return;
        const op = c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        const receiver = state.values.reg(op.operands[0]);
        if (receiver.unknown or receiver.cells.len == 0) self.unresolved = true;
        for (receiver.cells) |id| {
            try c.step(); if (state.heap.get(.{ .cell = id })) |old| try self.access(site, old, .write) else self.unresolved = true;
        }
    }
    fn before(self: *Collector, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const c = self.c; const function = site.location.function; const f = c.program.functions[@intFromEnum(function)];
        const op = f.blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction]; try c.step();
        if (site.location.instruction == 0) for (f.blocks[@intFromEnum(site.location.block)].parameters) |r| {
            try c.step(); if (f.registers[@intFromEnum(r)].carrier != .cell and try self.managedValue(world, state.values.reg(r))) try self.facet(function, .managed_reference);
        };
        switch (op.data) {
            .receiver_allocate => { try self.facet(function,.allocation); try self.facet(function,.managed_reference); },
            .initialize_field => { if(!try self.receiverField(function,@intFromEnum(site.location.block),site.location.instruction))self.fixed_upper_origin_pending=true; try self.access(site,state.values.reg(op.operands[1]),.write); },
            .receiver_bind,.receiver_get,.receiver_result => if((try self.receiverProof(function))==null) { self.fixed_upper_origin_pending=true; },
            .global_load => |v| try self.global(function, v.global, .read),
            .global_store => |v| try self.global(function, v.global, .write),
            .environment_load => |v| try self.environment(site, state, v.slot, false, false),
            .environment_store => |v| try self.environment(site, state, v.slot, true, false),
            .environment_init => |v| try self.environment(site, state, v.slot, true, true),
            .eh_load => |v| try self.cell(site, state, v.binding, false, false),
            .eh_store => |v| try self.cell(site, state, v.binding, true, v.initialize),
            .domain_field_read, .domain_array_read, .domain_array_length => try self.access(site, state.values.reg(op.operands[0]), .read),
            .domain_field_store => try self.access(site, state.values.reg(op.operands[0]), .write),
            .domain_array_store, .domain_array_resize => {
                try self.access(site, state.values.reg(op.operands[0]), .write);
                try self.access(site, state.values.reg(op.operands[0]), .structural);
            },
            .common_typed_array_create, .environment_alloc, .string_concat => {
                try self.facet(function, .allocation); try self.facet(function, .managed_reference);
            },
            .domain_literal => |v| if (self.common().types[@intFromEnum(v.actual_type)].kind == .reference) {
                try self.facet(function, .allocation); try self.facet(function, .managed_reference);
            },
            .eh_enter => try self.facet(function, .eh_control),
            .eh_carrier => |view| if (view == null) try self.facet(function, .eh_control),
            .authorized_host => try self.hostEffects(function),
            .eh_invoke => |v| {
                const abi = self.common().abis[@intFromEnum(c.program.functions[@intFromEnum(v.callee)].abi)];
                try self.consume(site, state, v.callee, if (abi.lexical_environment != null) 1 else 0, false);
            },
            .common_method_invoke => |v| {
                const receiver = state.values.reg(op.operands[0]); if (receiver.unknown) self.unresolved = true;
                for (self.common().views.dispatch[@intFromEnum(v.dispatch)].method.arms) |arm| {
                    try c.step(); try self.consume(site, state, arm.target.?, 0, true);
                }
            },
            .eh_invoke_indirect => {
                const callee = state.values.reg(op.operands[0]);
                if (callee.unknown or callee.callable_unknown) { try self.facet(function, .unknown_host); self.unresolved = true; }
                var found = false;
                for (self.common().closures.calls) |row| {
                    try c.step(); if (row.function != function or row.block != site.location.block or row.instruction != site.location.instruction) continue;
                    found = true; for (row.targets) |target| { try c.step(); try self.consume(site, state, target, 1, false); }
                }
                try c.require(found);
            },
            else => {}, // No effect permission is inferred from a carrier/view.
        }
    }
    fn after(self: *Collector, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const f = self.c.program.functions[@intFromEnum(site.location.function)];
        const op = f.blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        if (op.result) |r| {
            try self.c.step(); if (f.registers[@intFromEnum(r)].carrier != .cell and try self.managedValue(world, state.values.reg(r))) try self.facet(site.location.function, .managed_reference);
        }
    }
    fn completed(self: *Collector, world: facts.WorldView, site: facts.Site, completion: facts.Completion, value: facts.Value) Error!void {
        try self.c.step(); switch (completion) {
            .normal => if (try self.managedValue(world, value)) try self.facet(site.location.function, .escape),
            .language => try self.facet(site.location.function, .may_throw),
            .request_trap => {},
        }
    }
    pub fn observer(self: *Collector) facts.Observer {
        return .{ .client = self, .before = onBefore, .after = onAfter, .completed = onCompleted };
    }
    fn aliasDependency(self: *Collector, from: usize, target: t.FunctionRef, links: *std.AutoHashMapUnmanaged(AliasLink, void), callers: []std.ArrayListUnmanaged(usize), callees: []std.ArrayListUnmanaged(usize)) Error!void {
        const c = self.c; const to = @intFromEnum(target); try c.step();
        const edge = try links.getOrPut(c.allocator, .{ .from = from, .to = to });
        if (!edge.found_existing) { try callers[to].append(c.allocator, from); try callees[from].append(c.allocator, to); }
    }
    fn solveAliases(self: *Collector, callers: []const std.ArrayListUnmanaged(usize), queued: []bool, pending: *std.ArrayListUnmanaged(usize)) Error!void {
        const c = self.c; var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const function = pending.items[cursor]; queued[function] = false;
            var graph = UpperGraph{ .collector = self, .function = @enumFromInt(function), .summarizing = true };
            try graph.run();
            if (!graph.changed) continue;
            for (callers[function].items) |caller| {
                try c.step(); if (queued[caller]) continue;
                try pending.append(c.allocator, caller); queued[caller] = true;
            }
        }
    }
    fn upperFlows(self: *Collector) Error!void {
        const c = self.c; const v = self.common(); const count = c.program.functions.len;
        try c.charge(count * 4 + 1);
        const callers = try c.allocator.alloc(std.ArrayListUnmanaged(usize), count); @memset(callers, .empty);
        defer { for (callers) |*rows| rows.deinit(c.allocator); c.allocator.free(callers); }
        const callees = try c.allocator.alloc(std.ArrayListUnmanaged(usize), count); @memset(callees, .empty);
        defer { for (callees) |*rows| rows.deinit(c.allocator); c.allocator.free(callees); }
        const entered = try c.allocator.alloc(bool, count); defer c.allocator.free(entered); @memset(entered, false);
        const queued = try c.allocator.alloc(bool, count); defer c.allocator.free(queued); @memset(queued, false);
        var links: std.AutoHashMapUnmanaged(AliasLink, void) = .empty; defer links.deinit(c.allocator);
        // Both dependency directions come from ALL typed call instructions and
        // complete permitted target tables, never claimed dependency rows or
        // actual selected arms. They schedule only lexical OWNER equations.
        for (c.program.functions, 0..) |function, from| for (function.blocks, 0..) |block, b| for (block.instructions, 0..) |op, i| {
            try c.step(); switch (op.data) {
                .eh_invoke => |call| try self.aliasDependency(from, call.callee, &links, callers, callees),
                .common_method_invoke => |call| for (v.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| {
                    try c.step(); try self.aliasDependency(from, arm.target orelse return error.InvalidShape, &links, callers, callees);
                },
                .eh_invoke_indirect => for (v.closures.calls) |row| {
                    try c.step(); if (@intFromEnum(row.function) != from or @intFromEnum(row.block) != b or row.instruction != i) continue;
                    for (row.targets) |target| { try c.step(); try self.aliasDependency(from, target, &links, callers, callees); }
                },
                else => {},
            }
        };
        // Classify every body before using any summary. Local structural
        // transparency is immutable; SCC membership grants no such property.
        for (0..count) |function| {
            try c.step(); var graph = UpperGraph{ .collector = self, .function = @enumFromInt(function) }; try graph.prepare();
        }
        var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator);
        var stack: std.ArrayListUnmanaged(AliasVisit) = .empty; defer stack.deinit(c.allocator);
        // Iterative postorder keeps acyclic callees first without host-stack
        // recursion. Within an SCC, later growth requeues all dependent callers.
        for (0..count) |function| {
            try c.step(); if (entered[function]) continue;
            try stack.append(c.allocator, .{ .function = function }); entered[function] = true;
            while (stack.items.len != 0) {
                try c.step(); const last = stack.items.len - 1; const at = stack.items[last].function;
                if (stack.items[last].next < callees[at].items.len) {
                    const target = callees[at].items[stack.items[last].next]; stack.items[last].next += 1;
                    if (!entered[target]) { try stack.append(c.allocator, .{ .function = target }); entered[target] = true; }
                } else {
                    try pending.append(c.allocator, at); queued[at] = true; stack.items.len -= 1;
                }
            }
        }
        // Phase 1 is the least RESULT closure of parameter/global transfer and
        // typed return/raise nodes. Normal control is always open; language
        // control follows upper.mayThrow. Bottom DATA is not a known-empty
        // value, but an ignored bottom does not taint independently computed p.
        try self.solveAliases(callers, queued, &pending);
        pending.clearRetainingCapacity();
        // A result still bottom after closure means UNKNOWN, not an empty owner
        // set. Seed only that missing RESULT and saturate once more. All upper
        // control paths already participated: g():void{throw0}; f(p){g();return
        // p} therefore derives f.normal=p before any fallback is installed.
        // A catch returning q is likewise independent of an unknown payload.
        for (self.aliases, 0..) |*summary, function| {
            try c.step(); var changed = false;
            if (!summary.normal_seen) {
                summary.normal_missing = true; changed = (try summary.normal.makeOpaque(c)) or changed;
            }
            if (self.upper(@enumFromInt(function))) |bound| {
                if (bound.facets.may_throw and !summary.language_seen) {
                    summary.language_missing = true; changed = (try summary.language.makeOpaque(c)) or changed;
                }
            }
            if (!changed) continue;
            for (callers[function].items) |caller| {
                try c.step(); if (queued[caller]) continue;
                try pending.append(c.allocator, caller); queued[caller] = true;
            }
        }
        try self.solveAliases(callers, queued, &pending);
        // Only a closed summary is consumed by validation. This flag is wholly
        // private availability, not an exported effect/admission certificate.
        for (self.aliases) |*summary| { try c.step(); summary.available = true; }
        // Phase 3 covers complete-upper normal/language CFG effects. Trial
        // iterations neither set sticky pending flags nor check a permission
        // using an interim alias. Final observations retain all old barriers.
        for (0..count) |function| {
            try c.step();
            var graph = UpperGraph{ .collector = self, .function = @enumFromInt(function) }; try graph.run();
        }
    }
    pub fn finish(self: *Collector, actual: *const actual_targets.Analysis) FinishError!void {
        try self.c.step(); try self.c.require(actual.owner==self.c and actual.final_replay_complete);
        self.final_actual=actual; defer self.final_actual=null;
        try self.upperFlows();
        // Missing origin facts remain a capability gap, never an empty effect.
        try self.c.require(!self.unresolved);
        try self.c.step();
        if (self.fixed_upper_host_pending) return error.FixedUpperHostBindingPending;
        if (self.fixed_upper_origin_pending) return error.FixedUpperEffectOriginPending;
    }
    fn onBefore(client: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const self: *Collector = @ptrCast(@alignCast(client)); try self.before(world, site, state);
    }
    fn onAfter(client: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, state: facts.StateView) Error!void {
        const self: *Collector = @ptrCast(@alignCast(client)); try self.after(world, site, state);
    }
    fn onCompleted(client: *anyopaque, _: *Context, world: facts.WorldView, site: facts.Site, completion: facts.Completion, value: facts.Value, _: facts.HeapView) Error!void {
        const self: *Collector = @ptrCast(@alignCast(client)); try self.completed(world, site, completion, value);
    }
};

// BEGIN independent fixed-capture adapter DTO tests.
// These literal metadata records exercise the production consumeUpper ->
// fixedGraphSummary(null relation) -> projectCapture/mark path. They are not a
// decoded Runtime Program, Source package, verified ActualAnalysis or entry
// receipt. No body/SSA/VM admission is claimed; the tested dependency digest
// comparison and COMPLETE EffectUpper records below are real inputs.
const CaptureAdapterFixture = struct {
    const Storage = @import("wire-program-storage.zig");
    const Closures = @import("wire-program-control.zig").CommonClosures;
    const ContractRow = std.meta.Child(@FieldType(publication.Publication, "contracts"));
    const ParameterRow = std.meta.Child(@FieldType(publication.EffectUpper, "parameters"));
    const CaptureRow = std.meta.Child(@FieldType(publication.EffectUpper, "captures"));
    const EnvironmentRow = std.meta.Child(@FieldType(Closures, "environments"));
    const SlotRow = std.meta.Child(@FieldType(EnvironmentRow, "slots"));
    const ClosureRow = std.meta.Child(@FieldType(Closures, "functions"));
    program: model.Program, c: Context, collector: Collector,
    functions: [3]model.Function, abis: [3]Storage.CommonAbi,
    bindings: [2]Storage.CommonBinding, contracts: [3]ContractRow,
    parameter: [1]ParameterRow, caller_capture: [1]CaptureRow, target_capture: [1]CaptureRow,
    environment_rows: [1]EnvironmentRow, slots: [1]SlotRow, closures: [3]ClosureRow,
    contract_indices: [3]?usize, concrete: [2]?usize, capture_indices: [2]?Capture, managed: [2]Managed,
    fn init(self: *CaptureAdapterFixture, parameter_flags: fixed_owners.Flags, caller_flags: fixed_owners.Flags, target_flags: fixed_owners.Flags, foreign_input: bool) void {
        const ref_carrier = t.Carrier{ .@"type" = @enumFromInt(0) };
        const owner: t.FunctionRef = @enumFromInt(if (foreign_input) @as(usize, 2) else 0);
        const anchor = t.Origin{ .source = @enumFromInt(0), .start = 0, .end = 1 };
        var common = std.mem.zeroes(tables.CommonTables);
        common.types = &.{
            .{ .id = @splat(0x66), .kind = .reference, .name = "AdapterReference", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
            .{ .id = @splat(0x88), .kind = .function, .name = "AdapterFunction", .native_code = 0, .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null },
        };
        self.bindings = .{
            .{ .id = "p", .owner = .{ .param = @enumFromInt(0) }, .name = "p", .@"type" = @enumFromInt(0), .writable = false, .origin = anchor, .carrier = ref_carrier, .scope = @enumFromInt(0), .declaration_kind = .parameter },
            .{ .id = "slot", .owner = .{ .local = owner }, .name = "slot", .@"type" = @enumFromInt(0), .writable = true, .origin = anchor, .carrier = ref_carrier, .scope = @enumFromInt(if (foreign_input) @as(usize, 2) else 0), .declaration_kind = .local },
        };
        common.storage.bindings = &self.bindings;
        self.slots = .{.{ .binding = @enumFromInt(1), .key = @splat(0x55), .kind = .local, .@"type" = @enumFromInt(0), .writable = true }};
        self.environment_rows = .{.{ .id = @splat(0x77), .owner = owner, .parent = null, .slots = &self.slots }};
        common.closures.environments = &self.environment_rows;
        common.storage.environments = &.{.{ .environment = @enumFromInt(0), .byte_size = 8, .alignment = 8, .reference_count = 1, .parent_offset = null, .slot_offsets = &.{0} }};
        for (&self.functions, &self.abis, &self.closures, 0..) |*function, *abi, *closure, index| {
            function.* = .{ .id = @splat(@as(u8, @intCast((index + 1) * 0x11))), .signature = @splat(0x99), .abi = @enumFromInt(index), .source = @enumFromInt(0), .role = .ordinary, .declaration = .{ .start = 0, .end = 1 }, .name = "captureAdapterDto", .registers = &.{}, .blocks = &.{} };
            abi.* = .{ .kind = .common, .function = @enumFromInt(index), .signature = @splat(0x99), .parameters = &.{}, .argument_types = &.{}, .receiver = null, .construction = null, .receiver_frame = null, .lexical_environment = null, .physical_parameters = &.{}, .result = @enumFromInt(0), .result_carrier = ref_carrier, .source_plan = .{ .carriers = &.{}, .blocks = &.{} } };
            closure.* = .{ .function = @enumFromInt(index), .parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{} };
        }
        self.abis[0].parameters = &.{@enumFromInt(0)}; self.abis[0].argument_types = &.{@enumFromInt(0)};
        self.abis[0].lexical_environment = if (foreign_input) @enumFromInt(0) else null;
        self.abis[0].physical_parameters = if (foreign_input) &.{ .{ .environment = @enumFromInt(0) }, ref_carrier } else &.{ref_carrier};
        self.abis[1].lexical_environment = @enumFromInt(0); self.abis[1].physical_parameters = &.{.{ .environment = @enumFromInt(0) }};
        self.closures[0].parent = if (foreign_input) @enumFromInt(2) else null;
        self.closures[0].lexical_environment = self.abis[0].lexical_environment;
        self.closures[@intFromEnum(owner)].activation_environment = @enumFromInt(0);
        self.closures[1].parent = owner; self.closures[1].lexical_environment = @enumFromInt(0);
        self.closures[1].captures = &.{.{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }};
        common.closures.functions = &self.closures; common.abis = &self.abis;
        common.closures.calls = &.{.{ .function = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 0, .signature = @splat(0x99), .targets = &.{@enumFromInt(1)} }};
        self.parameter = .{.{ .index = 0, .read = parameter_flags.read, .write = parameter_flags.write, .structural = parameter_flags.structural }};
        self.caller_capture = .{.{ .slot = @splat(0x55), .read = caller_flags.read, .write = caller_flags.write, .structural = caller_flags.structural }};
        self.target_capture = .{.{ .slot = @splat(0x55), .read = target_flags.read, .write = target_flags.write, .structural = target_flags.structural }};
        for (&self.contracts, 0..) |*contract_row, index| {
            contract_row.* = std.mem.zeroes(ContractRow); contract_row.function_id = self.functions[index].id;
            contract_row.signature_hash = @splat(0x99); contract_row.digest = @splat(@as(u8, @intCast((index + 3) * 0x11)));
        }
        self.contracts[0].upper.parameters = &self.parameter;
        if (caller_flags.read or caller_flags.write or caller_flags.structural) self.contracts[0].upper.captures = &self.caller_capture;
        self.contracts[1].upper.captures = &self.target_capture;
        common.authority.fixed_publication.publication.contracts = &self.contracts;
        common.authority.fixed_publication.dependencies = &.{
            .{ .function_id = @splat(0x11), .callees = &.{.{ .function_id = @splat(0x22), .digest = @splat(0x44) }}, .hosts = &.{} },
            .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
            .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
        };
        self.program = .{ .envelope = std.mem.zeroes(model.Envelope), .target = std.mem.zeroes(model.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &.{.{ .hash = @splat(0xaa), .path = "capture-adapter-dto.ts", .length = 1 }}, .mode = .{ .common = common } }, .functions = &self.functions };
        self.c = .{ .program = &self.program, .allocator = std.testing.allocator };
        self.contract_indices = .{ 0, 1, 2 }; self.concrete = .{ null, null };
        self.capture_indices = .{ null, .{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) } }; self.managed = .{ .empty, .empty };
        self.collector = .{ .c = &self.c, .host_material = null, .contracts = &self.contract_indices, .concrete = &self.concrete, .captures = &self.capture_indices, .managed = &self.managed, .aliases = &.{}, .receiver_effects = &.{} };
    }
    fn saved(self: *CaptureAdapterFixture, origin: effect_env.Origin, with_slot: bool) Error!UpperState {
        var state = try UpperState.init(&self.c, 3); errdefer state.deinit(&self.c);
        _ = try state.values[0].add(&self.c, .{ .parameter = 0 });
        _ = try state.values[1].environments.direct.add(&self.c, origin);
        if (with_slot) try state.store(&self.c, .{ .binding = @enumFromInt(1), .environment = origin }, &state.values[0]);
        return state;
    }
    fn apply(self: *CaptureAdapterFixture, state: *UpperState, indirect: bool) Error!void {
        var graph = UpperGraph{ .collector = &self.collector, .function = @enumFromInt(0) };
        const full = try self.collector.consumeUpper(@enumFromInt(0), @enumFromInt(1));
        const op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = null,
            .operands = if (indirect) &.{@enumFromInt(2)} else &.{@enumFromInt(1)},
            .data = if (indirect) .{ .eh_invoke_indirect = .{ .callable = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } else .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
        var returned: Owners = .{}; defer returned.deinit(self.c.allocator);
        var thrown: Owners = .{}; defer thrown.deinit(self.c.allocator);
        try self.c.require(try graph.fixedGraphSummary(@enumFromInt(1), op, state, state, if (indirect) 1 else 0, full, &returned, &thrown, null));
    }
};

test "fixed capture adapter projects all local ENV flags without a caller child key" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .read = true, .write = true, .structural = true }, .{}, .{ .read = true, .write = true, .structural = true }, false);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    try fixture.apply(&state, false); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    inline for (.{ "read", "write", "structural" }) |flag| {
        @field(fixture.parameter[0], flag) = false;
        try std.testing.expectError(error.InvalidShape, fixture.apply(&state, false));
        @field(fixture.parameter[0], flag) = true;
    }
}

test "fixed capture adapter cannot replace parameter write with the child capture key" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{}, .{ .write = true }, .{ .write = true }, false);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    try std.testing.expectError(error.InvalidShape, fixture.apply(&state, false));
}

test "fixed capture adapter preserves foreign input capture rights instead of parameter rights" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{}, .{ .write = true }, true);
    var state = try fixture.saved(.{ .layout = @enumFromInt(0), .source = .input }, false); defer state.deinit(&fixture.c);
    try std.testing.expectError(error.InvalidShape, fixture.apply(&state, false));
    fixture.contracts[0].upper.captures = &fixture.caller_capture; fixture.caller_capture[0].write = true;
    try fixture.apply(&state, false); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
}

test "fixed capture adapter keeps unknown indirect pairs and missing local slots pending" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{ .write = true }, .{ .write = true }, false);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var missing = try fixture.saved(origin, false); defer missing.deinit(&fixture.c);
    try fixture.apply(&missing, false); try std.testing.expect(fixture.collector.fixed_upper_origin_pending);
    fixture.collector.fixed_upper_origin_pending = false;
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    state.values[2].environments.callable_unknown = true;
    try fixture.apply(&state, true); try std.testing.expect(fixture.collector.fixed_upper_origin_pending);
}

test "fixed capture adapter consumes known fixed return ENV pairs and the real dependency digest" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{}, .{ .write = true }, false);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .fixed = .{ .invocation = .{ .caller = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 7, .target = @enumFromInt(2) }, .location = 3 } } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    var selected: effect_env.Set = .{}; defer selected.deinit(fixture.c.allocator); _ = try selected.add(&fixture.c, origin);
    try state.values[2].environments.pair(&fixture.c, @enumFromInt(1), &selected);
    try fixture.apply(&state, true); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    fixture.contracts[1].digest = @splat(0xee);
    try std.testing.expectError(error.InvalidShape, fixture.apply(&state, true));
}

test "fixed capture adapter unions explicit foreign stores without replacing the foreign key" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{}, .{ .write = true }, .{ .write = true }, true);
    var state = try fixture.saved(.{ .layout = @enumFromInt(0), .source = .input }, true); defer state.deinit(&fixture.c);
    // The fixed lexical store adds p; its presence cannot erase c:key, and
    // c:key alone cannot erase the explicitly stored parameter alternative.
    try std.testing.expectError(error.InvalidShape, fixture.apply(&state, false));
    fixture.parameter[0].write = true;
    try fixture.apply(&state, false); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    fixture.contracts[0].upper.captures = &.{};
    try std.testing.expectError(error.InvalidShape, fixture.apply(&state, false));
}

test "a returned local Array with parameter contents rejects a caller missing that parameter write" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{}, .{}, .{}, false);
    var aliases: [3]AliasSummary = .{ .{}, .{}, .{} };
    defer for (&aliases) |*summary| summary.deinit(fixture.c.allocator);
    fixture.collector.aliases = &aliases;
    const reference_id = "sha256:6666666666666666666666666666666666666666666666666666666666666666";
    const array_id = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const function_id = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    var types: [3]tables.CommonType = undefined;
    @memcpy(types[0..2], fixture.program.tables.mode.common.types);
    types[2] = types[0]; types[2].id = @splat(0xaa); types[2].kind = .array; types[2].name = "ReturnedArray"; types[2].element = @enumFromInt(0);
    fixture.program.tables.mode.common.types = &types;
    fixture.abis[2].result = @enumFromInt(2); fixture.abis[2].result_carrier = .{ .@"type" = @enumFromInt(2) };
    var bindings: [4]CaptureAdapterFixture.Storage.CommonBinding = undefined; @memcpy(bindings[0..2], &fixture.bindings);
    bindings[2] = fixture.bindings[0]; bindings[2].id = "array-argument"; bindings[2].name = "array-argument";
    bindings[2].owner = .{ .param = @enumFromInt(1) }; bindings[2].@"type" = @enumFromInt(2); bindings[2].carrier = .{ .@"type" = @enumFromInt(2) };
    bindings[3] = fixture.bindings[0]; bindings[3].id = "creator-argument"; bindings[3].name = "creator-argument";
    bindings[3].owner = .{ .param = @enumFromInt(2) };
    fixture.program.tables.mode.common.storage.bindings = &bindings;
    fixture.abis[1].parameters = &.{@enumFromInt(2)}; fixture.abis[1].argument_types = &.{@enumFromInt(2)};
    fixture.abis[1].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(2) } };
    fixture.abis[2].parameters = &.{@enumFromInt(3)}; fixture.abis[2].argument_types = &.{@enumFromInt(0)};
    fixture.abis[2].physical_parameters = &.{.{ .@"type" = @enumFromInt(0) }};
    fixture.contracts[1].upper.parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }};
    fixture.contracts[2].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
    fixture.program.tables.mode.common.authority.fixed_publication.dependencies = &.{
        .{ .function_id = @splat(0x11), .callees = &.{ .{ .function_id = @splat(0x22), .digest = @splat(0x44) }, .{ .function_id = @splat(0x33), .digest = @splat(0x55) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
        .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
    };
    var managed: [3]Managed = .{ .empty, .empty, .empty }; fixture.collector.managed = &managed;
    var concrete: [3]?usize = .{ null, null, null }; fixture.collector.concrete = &concrete;
    const interpretation = origin_model.Directory{
        .types = &.{ .{ .id = reference_id, .kind = .reference }, .{ .id = array_id, .kind = .array } },
        .functions = &.{.{ .id = function_id, .kind = .source, .parameter_types = &.{reference_id}, .return_type = array_id, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null }},
        .environments = &.{}, .globals = &.{}, .fields = &.{},
        .constructions = &.{.{ .id = "reference-construction", .owner = reference_id, .base = null, .kind = .implicit_base, .function_id = null }},
    };
    const nodes = [_]origin_model.Value{ .{ .parameter = .{ .@"type" = reference_id, .index = 0 } }, .{ .local = .{ .@"type" = array_id } } };
    const input = origin_model.Graph{ .nodes = &nodes, .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "element", .view = array_id, .values = &.{0}, .control = 0, .initialize = true } } }, .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{} }, .accesses = &.{} };
    fixture.contracts[2].return_origins = input;
    fixture.contracts[0].upper.facets.allocation = true; fixture.contracts[0].upper.facets.managed_reference = true; fixture.contracts[0].upper.facets.escape = true;
    fixture.contracts[2].upper.facets.allocation = true; fixture.contracts[2].upper.facets.managed_reference = true; fixture.contracts[2].upper.facets.escape = true;
    const fixed = [_]fixed_owners.Fixed{.{ .function_id = function_id, .graph = &input, .parameters = &.{.{}}, .captures = &.{}, .may_throw = false }};
    var budget = origin_model.Budget{ .context = &fixture.c, .charge = publication_refs.graphCharge };
    try origin_model.validateDirectory(fixture.c.allocator, &interpretation, &budget);
    try std.testing.expect((try origin_model.validateGraph(fixture.c.allocator, &interpretation, function_id, &input, &budget)) == .valid);
    var analysis = try fixed_owners.analyze(fixture.c.allocator, &interpretation, &.{}, function_id, &input, &fixed, &budget); defer analysis.deinit();
    try std.testing.expectEqual(@as(?fixed_owners.Pending, null), analysis.pending);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    var graph = UpperGraph{ .collector = &fixture.collector, .function = @enumFromInt(0) };
    _ = try fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    const creator_op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = @enumFromInt(0), .operands = &.{@enumFromInt(0)}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    const op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = null, .operands = &.{ @enumFromInt(1), @enumFromInt(0) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var export_graph = FixedExport{ .g = &graph, .analysis = &analysis, .target = @enumFromInt(2), .op = creator_op, .offset = 0, .saved = &state, .destination = &state, .invocation = .{ .caller = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 0, .target = @enumFromInt(2) }, .allocator = analysis.arena.allocator(), .environments = &.{} };
    var value = try export_graph.exportValue(analysis.normal[0]); defer value.deinit(fixture.c.allocator);
    try state.values[0].replace(&fixture.c, &value);
    var saved = try UpperState.clone(&fixture.c, &state); defer saved.deinit(&fixture.c);
    var returned: Owners = .{}; defer returned.deinit(fixture.c.allocator);
    var thrown: Owners = .{}; defer thrown.deinit(fixture.c.allocator);
    var completions: UpperCompletions = .{};
    // This is the same production full-parameter transfer as a later call.
    // Its return is ignored; missing exported element ownership still cannot
    // turn p's externally reachable data into a known-empty Local proof.
    try std.testing.expectError(error.InvalidShape, graph.consume(@enumFromInt(1), op, &state, &saved, 1, false, &returned, &thrown, &completions));
}
// END independent fixed-capture adapter DTO tests.

test "receiver shared owner exporter preserves saved parent slots and the callable ENV pair" {
    const dto = struct {
        const reference = "sha256:" ++ "66" ** 32;
        const callable = "sha256:" ++ "88" ** 32;
        const caller = "sha256:" ++ "11" ** 32;
        const child = "sha256:" ++ "22" ** 32;
        const constructor = "sha256:" ++ "33" ** 32;
        const parent_env = "sha256:" ++ "77" ** 32;
        const child_env = "sha256:" ++ "99" ** 32;
        const foreign_slot = "sha256:" ++ "55" ** 32;
        const local_slot = "sha256:" ++ "aa" ** 32;
        const role = "sha256:" ++ "bb" ** 32;
        const directory = origin_model.Directory{
            .types = &.{ .{ .id = reference, .kind = .reference }, .{ .id = callable, .kind = .function } },
            .functions = &.{
                .{ .id = caller, .kind = .source, .parameter_types = &.{reference}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = parent_env, .construction = null },
                .{ .id = child, .kind = .source, .parameter_types = &.{}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = child_env, .activation_environment = null, .construction = null },
                .{ .id = constructor, .kind = .construction_body, .parameter_types = &.{ reference, reference }, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = parent_env, .activation_environment = child_env, .construction = .{ .id = role, .owner = reference, .base = null, .receiver_index = 0 } },
            },
            .environments = &.{
                .{ .id = parent_env, .parent = null, .slots = &.{.{ .key = foreign_slot, .@"type" = reference, .writable = true }} },
                .{ .id = child_env, .parent = parent_env, .slots = &.{.{ .key = local_slot, .@"type" = reference, .writable = true }} },
            },
            .constructions = &.{.{ .id = role, .owner = reference, .base = null, .kind = .explicit, .function_id = constructor }},
            .globals = &.{}, .fields = &.{},
        };
        const graph = origin_model.Graph{
            .nodes = &.{
                .{ .environment_input = .{ .layout = parent_env } }, .receiver_input,
                .{ .parameter = .{ .@"type" = reference, .index = 1 } },
                .{ .environment_create = .{ .layout = child_env, .parent = &.{0}, .site = "new-child-env", .control = 0 } },
                .{ .capture = .{ .@"type" = reference, .id = local_slot, .layout = child_env, .environment = &.{3}, .heap = 1, .control = 0 } },
                .{ .code = .{ .@"type" = callable, .function_id = child, .environment = &.{3}, .control = 0 } },
                .{ .copy = .{ .@"type" = callable, .bases = &.{5}, .site = "copy-child-code", .heap = 2, .control = 0 } },
                .{ .receiver_value = .{ .@"type" = reference, .action = 4 } },
                .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
                .{ .environment_parent = .{ .layout = parent_env, .bases = &.{3}, .control = 0 } },
            },
            .heaps = &.{
                .entry,
                .{ .store = .{ .previous = 0, .bases = &.{3}, .selector = "capture:" ++ local_slot, .view = "env:" ++ child_env, .values = &.{2}, .control = 0, .initialize = true } },
                .{ .store = .{ .previous = 1, .bases = &.{3}, .selector = "capture:" ++ local_slot, .view = "env:" ++ child_env, .values = &.{4}, .control = 0, .initialize = false } },
                .{ .copy = .{ .previous = 2, .value = 6 } },
                .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{6}, .completion = .normal } },
                .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{6}, .completion = .language } },
            },
            .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } } },
            .calls = &.{}, .normal = &.{7}, .language = &.{8},
            .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 5, .control = 2 }} }, .accesses = &.{},
        };
    };
    var fixture: CaptureAdapterFixture = undefined;
    fixture.init(.{ .read = true, .write = true, .structural = true }, .{}, .{ .write = true }, false);
    var aliases: [3]AliasSummary = .{ .{}, .{}, .{} };
    defer for (&aliases) |*summary| summary.deinit(fixture.c.allocator);
    fixture.collector.aliases = &aliases;
    // This is literal metadata at the production adapter seam, with no body,
    // SSA/canonical-admission or ActualAnalysis claim. The same creator target
    // owns the Directory, ABI, fixed contract, receiver and exported call.
    var bindings: [4]CaptureAdapterFixture.Storage.CommonBinding = undefined;
    @memcpy(bindings[0..2], &fixture.bindings);
    bindings[2] = fixture.bindings[0]; bindings[2].id = "constructor-value"; bindings[2].name = "constructor-value";
    bindings[2].owner = .{ .param = @enumFromInt(2) };
    bindings[3] = bindings[2]; bindings[3].id = "constructor-receiver"; bindings[3].name = "this";
    bindings[3].owner = .{ .receiver = @enumFromInt(2) }; bindings[3].declaration_kind = null;
    fixture.program.tables.mode.common.storage.bindings = &bindings;
    fixture.program.tables.mode.common.members.constructions = &.{.{
        .id = @splat(0xbb), .owner = @enumFromInt(0), .function = @enumFromInt(2), .kind = .explicit, .origin = bindings[2].origin.?,
        .parameters = &.{.{ .binding = @enumFromInt(2), .inherited_from = null, .origin = bindings[2].origin.?, .@"type" = @enumFromInt(0) }},
        .signature = .{ .parameters = &.{@enumFromInt(0)}, .return_type = @enumFromInt(0) },
        .source_signature = .{ .id = @splat(0x99), .origin = bindings[2].origin.? },
        .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public,
    }};
    const EnvironmentRow = CaptureAdapterFixture.EnvironmentRow;
    const environments = [_]EnvironmentRow{ fixture.environment_rows[0],
        .{ .id = @splat(0x99), .owner = @enumFromInt(2), .parent = @enumFromInt(0), .slots = &.{.{ .binding = @enumFromInt(2), .key = @splat(0xaa), .kind = .parameter, .@"type" = @enumFromInt(0), .writable = true }} },
    };
    fixture.program.tables.mode.common.closures.environments = &environments;
    fixture.program.tables.mode.common.storage.environments = &.{
        .{ .environment = @enumFromInt(0), .byte_size = 8, .alignment = 8, .reference_count = 1, .parent_offset = null, .slot_offsets = &.{0} },
        .{ .environment = @enumFromInt(1), .byte_size = 16, .alignment = 8, .reference_count = 2, .parent_offset = 0, .slot_offsets = &.{8} },
    };
    fixture.functions[2].role = .construction_body;
    fixture.abis[2].parameters = &.{@enumFromInt(2)}; fixture.abis[2].argument_types = &.{@enumFromInt(0)};
    fixture.abis[2].receiver = @enumFromInt(3); fixture.abis[2].construction = @enumFromInt(0); fixture.abis[2].receiver_frame = 1;
    fixture.abis[2].lexical_environment = @enumFromInt(0);
    fixture.abis[2].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .receiver = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } };
    fixture.abis[1].lexical_environment = @enumFromInt(1); fixture.abis[1].physical_parameters = &.{.{ .environment = @enumFromInt(1) }};
    fixture.closures[1].parent = @enumFromInt(2); fixture.closures[1].lexical_environment = @enumFromInt(1);
    fixture.closures[1].captures = &.{.{ .environment = @enumFromInt(1), .slot = @enumFromInt(0) }};
    fixture.closures[2].parent = @enumFromInt(0); fixture.closures[2].lexical_environment = @enumFromInt(0); fixture.closures[2].activation_environment = @enumFromInt(1);
    fixture.target_capture[0].slot = @splat(0xaa);
    fixture.contracts[2].return_origins = dto.graph;
    fixture.contracts[2].upper.parameters = &.{
        .{ .index = 0, .read = false, .write = false, .structural = false },
        .{ .index = 1, .read = false, .write = false, .structural = false },
    };
    fixture.contracts[2].upper.captures = &.{
        .{ .slot = @splat(0x55), .read = true, .write = true, .structural = true },
        .{ .slot = @splat(0xaa), .read = true, .write = true, .structural = true },
    };
    fixture.contracts[2].upper.facets.allocation = true; fixture.contracts[2].upper.facets.managed_reference = true; fixture.contracts[2].upper.facets.escape = true;
    fixture.contracts[0].upper.facets = fixture.contracts[2].upper.facets;
    fixture.program.tables.mode.common.authority.fixed_publication.dependencies = &.{
        .{ .function_id = @splat(0x11), .callees = &.{ .{ .function_id = @splat(0x22), .digest = @splat(0x44) }, .{ .function_id = @splat(0x33), .digest = @splat(0x55) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
        .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
    };
    var capture_indices: [4]?Capture = .{ null, .{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }, .{ .environment = @enumFromInt(1), .slot = @enumFromInt(0) }, null };
    var managed: [4]Managed = .{ .empty, .empty, .empty, .empty };
    fixture.collector.captures = &capture_indices; fixture.collector.managed = &managed;
    var budget = origin_model.Budget{ .context = &fixture.c, .charge = publication_refs.graphCharge };
    try origin_model.validateDirectory(fixture.c.allocator, &dto.directory, &budget);
    const validation = try origin_model.validateGraph(fixture.c.allocator, &dto.directory, dto.constructor, &dto.graph, &budget);
    try std.testing.expect(validation == .pending); try std.testing.expectEqual(origin_model.Pending.construction_frame, validation.pending);
    var receiver = try construction_origins.analyzeReturns(fixture.c.allocator, &dto.directory, &dto.graph, &budget, .{ .function_id = dto.constructor }); defer receiver.deinit();
    try std.testing.expectEqual(@as(?construction_origins.Pending, null), receiver.pending);
    var state = try fixture.saved(.{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } }, true); defer state.deinit(&fixture.c);
    state.values[2].nonowning = true; // The physical frame is never a Data owner.
    var incoming = try UpperState.clone(&fixture.c, &state); defer incoming.deinit(&fixture.c);
    const creator_op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = @enumFromInt(2), .operands = &.{ @enumFromInt(1), @enumFromInt(2), @enumFromInt(0) },
        .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var graph = UpperGraph{ .collector = &fixture.collector, .function = @enumFromInt(0) };
    const full = try fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    var arena = std.heap.ArenaAllocator.init(fixture.c.allocator); defer arena.deinit();
    var returned: Owners = .{}; defer returned.deinit(fixture.c.allocator);
    var thrown: Owners = .{}; defer thrown.deinit(fixture.c.allocator);
    try std.testing.expect(try graph.fixedOwnersGraph(@enumFromInt(2), creator_op, &incoming, &state, 1, full, &dto.directory, dto.constructor, &dto.graph, &budget, arena.allocator(), &receiver, &returned, &thrown, null));
    try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    for (returned.items.items) |owner| try std.testing.expect(owner != .unresolved);
    const pair = returned.environments.callables.getPtr(@enumFromInt(1)).?;
    try std.testing.expect(!returned.environments.callable_unknown and !pair.unknown);
    try std.testing.expectEqual(@as(usize, 1), pair.items.items.len);
    const child_origin = pair.items.items[0]; try std.testing.expect(child_origin.source == .fixed);
    try std.testing.expectEqual(@as(t.FunctionRef, @enumFromInt(2)), child_origin.source.fixed.invocation.target);
    const parents = state.parents.getPtr(child_origin).?;
    try std.testing.expectEqual(@as(usize, 1), parents.items.items.len);
    try std.testing.expect(parents.items.items[0].source == .birth);
    const contents = state.slots.getPtr(.{ .binding = @enumFromInt(2), .environment = child_origin }).?;
    try std.testing.expect(contents.items.items.len == 1 and contents.items.items[0] == .parameter);
    try std.testing.expectEqual(@as(usize, 0), contents.items.items[0].parameter);
    try state.values[2].replace(&fixture.c, &returned);
    var before_child = try UpperState.clone(&fixture.c, &state); defer before_child.deinit(&fixture.c);
    const child_op = model.instruction.Instruction{ .source = creator_op.source, .result = null, .operands = &.{@enumFromInt(2)},
        .data = .{ .eh_invoke_indirect = .{ .callable = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var child_return: Owners = .{}; defer child_return.deinit(fixture.c.allocator);
    var child_throw: Owners = .{}; defer child_throw.deinit(fixture.c.allocator); var completions: UpperCompletions = .{};
    try graph.consume(@enumFromInt(1), child_op, &state, &before_child, 1, false, &child_return, &child_throw, &completions);
    try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    before_child.values[2].environments.callable_unknown = true;
    try graph.consume(@enumFromInt(1), child_op, &state, &before_child, 1, false, &child_return, &child_throw, &completions);
    try std.testing.expect(fixture.collector.fixed_upper_origin_pending);
    fixture.collector.fixed_upper_origin_pending = false;
    // Complete capture flags still transfer when the immutable graph did not
    // explicitly read the parent slot. A caller child key cannot replace p.
    inline for (.{ "read", "write", "structural" }) |flag| {
        @field(fixture.parameter[0], flag) = false;
        var destination = try UpperState.clone(&fixture.c, &incoming); defer destination.deinit(&fixture.c);
        var rejected: Owners = .{}; defer rejected.deinit(fixture.c.allocator);
        var rejected_throw: Owners = .{}; defer rejected_throw.deinit(fixture.c.allocator);
        try std.testing.expectError(error.InvalidShape, graph.fixedOwnersGraph(@enumFromInt(2), creator_op, &incoming, &destination, 1, full, &dto.directory, dto.constructor, &dto.graph, &budget, arena.allocator(), &receiver, &rejected, &rejected_throw, null));
        @field(fixture.parameter[0], flag) = true;
    }
}

// The method adapter uses a self-contained literal metadata DTO, not a test
// module import or Source packet. No canonical identity or Actual admission is
// claimed. Layout/SSA/SourcePlan/Directory and the real fixed adapter are tested.
const MethodAdapterDTO = struct {
    const wire = model;
    const storage = @import("wire-program-storage.zig");
    const control = @import("wire-program-control.zig");
    const context = @import("wire-program-refcheck-context.zig");
    const origin = origin_model;
    const refs = publication_refs;
    const layout = @import("wire-program-layout-check.zig");
    const ssa = @import("wire-program-ssa-check.zig");
    const correspondence = @import("wire-program-source-correspondence.zig");
    const ins = wire.instruction;
    const a_type: t.TypeRef = @enumFromInt(0);
    const b_type: t.TypeRef = @enumFromInt(1);
    const a_text = "sha256:" ++ "11" ** 32;
    const b_text = "sha256:" ++ "22" ** 32;
    const caller_text = "sha256:" ++ "44" ** 32;
    const method_a_text = "sha256:" ++ "55" ** 32;
    const method_b_text = "sha256:" ++ "66" ** 32;
    const method_a_id = "sha256:" ++ "aa" ** 32;
    const method_b_id = "sha256:" ++ "bb" ** 32;
    const domain_text = "sha256:" ++ "cc" ** 32;
    const signature_a = "sha256:" ++ "dd" ** 32;
    const signature_b = "sha256:" ++ "ee" ** 32;
    const environment_text = "sha256:" ++ "77" ** 32;
    const payload_text = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";
    const ac: t.Carrier = .{ .@"type" = a_type };
    const bc: t.Carrier = .{ .@"type" = b_type };
    const dc: t.Carrier = .{ .domain = @enumFromInt(0) };
    const ec: t.Carrier = .{ .environment = @enumFromInt(0) };
    const r0: t.RegisterRef = @enumFromInt(0);
    const r1: t.RegisterRef = @enumFromInt(1);
    const r2: t.RegisterRef = @enumFromInt(2);
    const r3: t.RegisterRef = @enumFromInt(3);
    const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 80 };
    const operation: t.Origin = .{ .source = @enumFromInt(0), .start = 10, .end = 20 };
    const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
    const view_properties = [_]t.JsonMember{.{ .key = "target", .value = .{ .string = a_text } }};
    const invoke_properties = [_]t.JsonMember{
        .{ .key = "function_id", .value = .{ .string = method_a_text } },
        .{ .key = "signature_hash", .value = .{ .string = signature_a } },
        .{ .key = "dispatch", .value = .{ .array = &.{
            .{ .object = &.{ .{ .key = "receiver_type", .value = .{ .string = a_text } }, .{ .key = "target", .value = .{ .string = method_a_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_a } } } },
            .{ .object = &.{ .{ .key = "receiver_type", .value = .{ .string = b_text } }, .{ .key = "target", .value = .{ .string = method_b_text } }, .{ .key = "signature_hash", .value = .{ .string = signature_b } } } },
        } } },
    };

    // These entry vectors are module-owned constants. Runtime variant selection
    // chooses a persistent slice; no pointer targets an init-stack array.
    const method_a_parameters_env = [_]t.RegisterRef{ r2, r0, r1 };
    const method_a_parameters_plain = [_]t.RegisterRef{ r0, r1 };
    const method_a_physical_env = [_]t.Carrier{ ec, ac, ac };
    const method_a_physical_plain = [_]t.Carrier{ ac, ac };
    const method_a_semantic_env = [_][]const u8{ a_text, a_text, "env:" ++ environment_text };
    const method_a_semantic_plain = [_][]const u8{ a_text, a_text };
    const caller_registers = [_]wire.Register{
                    .{ .carrier = dc, .view = a_type }, .{ .carrier = ac, .view = a_type }, .{ .carrier = dc, .view = a_type }, .{ .carrier = .payload, .view = null },
                };
    const method_b_registers = [_]wire.Register{ .{ .carrier = bc, .view = b_type }, .{ .carrier = bc, .view = a_type } };
    const method_b_instructions = [_]ins.Instruction{
                .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
                .{ .source = operation, .result = r1, .operands = &.{r0}, .data = .{ .domain_view = .{ .static_view = a_type } } },
                .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
            };
    const method_b_blocks = [_]wire.Block{.{ .parameters = &.{r0}, .instructions = &method_b_instructions }};
    const method_b_operations = [_]control.SourcePlanOperation{
                .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
                .{ .name = "view", .view = a_text, .properties = &view_properties, .result = r1, .operands = &.{r0}, .successors = &.{}, .source = operation },
                .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
            };
    const method_b_plan = [_]control.SourcePlanBlock{.{ .parameters = &.{r0}, .operations = &method_b_operations }};

    const ClosureFunction = @typeInfo(@FieldType(control.CommonClosures, "functions")).pointer.child;

    const Fixture = struct {
        program: wire.Program,
        sources: [1]tables.Source,
        types: [2]tables.CommonType,
        bindings: [5]storage.CommonBinding,
        abis: [3]storage.CommonAbi,
        functions: [3]wire.Function,
        caller_instructions: [4]ins.Instruction,
        caller_operations: [4]control.SourcePlanOperation,
        caller_blocks: [3]wire.Block,
        caller_plan: [3]control.SourcePlanBlock,
        method_a_registers: [3]wire.Register,
        method_a_instructions: [2]ins.Instruction,
        method_a_operations: [2]control.SourcePlanOperation,
        method_a_blocks: [1]wire.Block,
        method_a_plan: [1]control.SourcePlanBlock,
        closure_functions: [3]ClosureFunction,

        fn init(self: *Fixture, hidden_environment: bool) void {
            self.sources = .{.{ .hash = @splat(0x88), .path = "method-body-literal-dto.ts", .length = 80 }};
            const base: tables.CommonType = .{ .id = @splat(0x11), .kind = .reference, .name = "A", .native_code = 0,
                .base = null, .element = null, .members = &.{}, .methods = &.{@enumFromInt(0)}, .nominal_key = null, .runtime_key = null };
            self.types = .{ base, base }; self.types[1].id = @splat(0x22); self.types[1].name = "B";
            self.types[1].base = a_type; self.types[1].methods = &.{@enumFromInt(1)};
            self.bindings = .{
                .{ .id = "caller-receiver", .owner = .{ .param = @enumFromInt(0) }, .name = "receiver", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = dc, .scope = @enumFromInt(0), .declaration_kind = .parameter },
                .{ .id = "caller-argument", .owner = .{ .param = @enumFromInt(0) }, .name = "argument", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(0), .declaration_kind = .parameter },
                .{ .id = "method-a-receiver", .owner = .{ .receiver = @enumFromInt(1) }, .name = "this", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(1), .declaration_kind = null },
                .{ .id = "method-a-argument", .owner = .{ .param = @enumFromInt(1) }, .name = "argument", .@"type" = a_type, .writable = false, .origin = declaration, .carrier = ac, .scope = @enumFromInt(1), .declaration_kind = .parameter },
                .{ .id = "method-b-receiver", .owner = .{ .receiver = @enumFromInt(2) }, .name = "this", .@"type" = b_type, .writable = false, .origin = declaration, .carrier = bc, .scope = @enumFromInt(2), .declaration_kind = null },
            };
            self.caller_instructions = .{
                .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
                .{ .source = operation, .result = null, .operands = &.{ r0, r1 }, .data = .{ .common_method_invoke = .{ .receiver_view = a_type, .member = @enumFromInt(0), .dispatch = @enumFromInt(0), .normal = @enumFromInt(1), .exceptional = @enumFromInt(2) } } },
                .{ .source = operation, .result = null, .operands = &.{r2}, .data = .@"return" },
                .{ .source = operation, .result = null, .operands = &.{r3}, .data = .eh_raise },
            };
            self.caller_operations = .{
                .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
                .{ .name = "invoke_method", .view = "void", .properties = &invoke_properties, .result = null, .operands = &.{ r0, r1 }, .successors = &.{ @enumFromInt(1), @enumFromInt(2) }, .source = operation },
                .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r2}, .successors = &.{}, .source = operation },
                .{ .name = "return_throw", .view = "void", .properties = &.{}, .result = null, .operands = &.{r3}, .successors = &.{}, .source = operation },
            };
            self.caller_blocks = .{ .{ .parameters = &.{ r0, r1 }, .instructions = self.caller_instructions[0..2] }, .{ .parameters = &.{r2}, .instructions = self.caller_instructions[2..3] }, .{ .parameters = &.{r3}, .instructions = self.caller_instructions[3..4] } };
            self.caller_plan = .{ .{ .parameters = &.{ r0, r1 }, .operations = self.caller_operations[0..2] }, .{ .parameters = &.{r2}, .operations = self.caller_operations[2..3] }, .{ .parameters = &.{r3}, .operations = self.caller_operations[3..4] } };
            const prototype: storage.CommonAbi = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0xdd),
                .parameters = &.{ @enumFromInt(0), @enumFromInt(1) }, .argument_types = &.{ a_type, a_type }, .receiver = null, .construction = null, .receiver_frame = null,
                .lexical_environment = null, .physical_parameters = &.{ dc, ac }, .result = a_type, .result_carrier = dc,
                .source_plan = .{ .carriers = &.{ a_text, a_text, a_text, payload_text }, .blocks = &self.caller_plan } };
            self.abis = .{ prototype, prototype, prototype };
            const function: wire.Function = .{ .id = @splat(0x44), .signature = @splat(0xdd), .abi = @enumFromInt(0), .source = @enumFromInt(0), .role = .ordinary,
                .declaration = .{ .start = 0, .end = 80 }, .name = "methodCaller", .registers = &caller_registers, .blocks = &self.caller_blocks };
            self.functions = .{ function, function, function };
            self.method_a_registers = .{ .{ .carrier = ac, .view = a_type }, .{ .carrier = ac, .view = a_type }, .{ .carrier = ec, .view = null } };
            self.functions[1].id = @splat(0x55); self.functions[1].abi = @enumFromInt(1); self.functions[1].name = "methodA";
            self.functions[1].registers = self.method_a_registers[0..if (hidden_environment) 3 else 2];
            self.method_a_instructions = .{
                .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
                .{ .source = operation, .result = null, .operands = &.{r1}, .data = .@"return" },
            };
            self.method_a_blocks = .{.{ .parameters = if (hidden_environment) &method_a_parameters_env else &method_a_parameters_plain, .instructions = &self.method_a_instructions }};
            self.functions[1].blocks = &self.method_a_blocks;
            self.abis[1].function = @enumFromInt(1); self.abis[1].parameters = &.{@enumFromInt(3)}; self.abis[1].argument_types = &.{a_type}; self.abis[1].receiver = @enumFromInt(2);
            self.abis[1].method_minimum_argument_count = 1;
            self.abis[1].lexical_environment = if (hidden_environment) @enumFromInt(0) else null; self.abis[1].physical_parameters = if (hidden_environment) &method_a_physical_env else &method_a_physical_plain;
            self.abis[1].result_carrier = ac;
            self.method_a_operations = .{
                .{ .name = "fuel", .view = "void", .properties = &fuel_properties, .result = null, .operands = &.{}, .successors = &.{}, .source = declaration },
                .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r1}, .successors = &.{}, .source = operation },
            };
            self.method_a_plan = .{.{ .parameters = if (hidden_environment) &method_a_parameters_env else &method_a_parameters_plain, .operations = &self.method_a_operations }};
            self.abis[1].source_plan = .{ .carriers = if (hidden_environment) &method_a_semantic_env else &method_a_semantic_plain, .blocks = &self.method_a_plan };
            self.functions[2].id = @splat(0x66); self.functions[2].signature = @splat(0xee); self.functions[2].abi = @enumFromInt(2); self.functions[2].name = "methodB";
            self.functions[2].registers = &method_b_registers;
            self.functions[2].blocks = &method_b_blocks;
            self.abis[2].function = @enumFromInt(2); self.abis[2].signature = @splat(0xee); self.abis[2].parameters = &.{}; self.abis[2].argument_types = &.{}; self.abis[2].receiver = @enumFromInt(4);
            self.abis[2].method_minimum_argument_count = 0;
            self.abis[2].physical_parameters = &.{bc}; self.abis[2].result_carrier = bc;
            self.abis[2].source_plan = .{ .carriers = &.{ b_text, a_text }, .blocks = &method_b_plan };
            if (hidden_environment) {
                // Keep the method's independent ENV entrance legal without
                // pretending the dynamic dispatch transports any hidden ENV.
                self.functions[0].registers = self.functions[0].registers[0..2];
                self.caller_instructions[1] = .{ .source = operation, .result = null, .operands = &.{r0}, .data = .@"return" };
                self.caller_operations[1] = .{ .name = "func.return", .view = "", .properties = &.{}, .result = null, .operands = &.{r0}, .successors = &.{}, .source = operation };
                self.functions[0].blocks = self.caller_blocks[0..1]; self.abis[0].source_plan.carriers = &.{ a_text, a_text }; self.abis[0].source_plan.blocks = self.caller_plan[0..1];
            }
            var common = std.mem.zeroes(tables.CommonTables); common.types = &self.types; common.abis = &self.abis; common.storage.bindings = &self.bindings;
            common.domains = &.{.{ .id = @splat(0xcc), .actual_types = &.{ a_type, b_type }, .representation = .reference, .byte_size = 8, .alignment = 8, .reference_count = 1, .tag_bytes = 0 }};
            common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
            common.storage.concrete = &.{
                .{ .@"type" = a_type, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
                .{ .@"type" = b_type, .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
            };
            common.members.methods = &.{
                .{ .id = @splat(0xaa), .owner = a_type, .function = @enumFromInt(1), .name = "choose", .signature = @splat(0xdd), .override = null, .access = .public },
                .{ .id = @splat(0xbb), .owner = b_type, .function = @enumFromInt(2), .name = "choose", .signature = @splat(0xee), .override = @as(t.Hash, @splat(0xaa)), .access = .public },
            };
            common.views.dispatch = &.{.{ .method = .{ .view = a_type, .member = @enumFromInt(0), .arms = &.{
                .{ .actual = a_type, .target = @enumFromInt(1), .abi = @enumFromInt(1) }, .{ .actual = b_type, .target = @enumFromInt(2), .abi = @enumFromInt(2) },
            } } }};
            common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{"function"} }, .{ .owner = @enumFromInt(1), .path = &.{"function"} }, .{ .owner = @enumFromInt(2), .path = &.{"function"} } };
            common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(3), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(4), .scope = @enumFromInt(2) } };
            common.exceptions.functions = &.{ .{ .function = @enumFromInt(0), .handlers = &.{} }, .{ .function = @enumFromInt(1), .handlers = &.{} }, .{ .function = @enumFromInt(2), .handlers = &.{} } };
            self.closure_functions = .{
                .{ .function = @enumFromInt(0), .parent = null, .lexical_environment = null, .activation_environment = if (hidden_environment) @enumFromInt(0) else null, .captures = &.{} },
                .{ .function = @enumFromInt(1), .parent = if (hidden_environment) @enumFromInt(0) else null, .lexical_environment = if (hidden_environment) @enumFromInt(0) else null, .activation_environment = null, .captures = &.{} },
                .{ .function = @enumFromInt(2), .parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{} },
            };
            common.closures.functions = &self.closure_functions;
            if (hidden_environment) {
                common.closures.environments = &.{.{ .id = @splat(0x77), .owner = @enumFromInt(0), .parent = null, .slots = &.{} }};
                common.storage.environments = &.{.{ .environment = @enumFromInt(0), .byte_size = 0, .alignment = 1, .reference_count = 0, .parent_offset = null, .slot_offsets = &.{} }};
            }
            self.program = .{ .envelope = std.mem.zeroes(wire.Envelope), .target = std.mem.zeroes(wire.Target), .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0, .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } }, .functions = &self.functions };
        }
    };


    fn typedInput(c: *context.Context, budget: *origin.Budget, interpretation: *const origin.Directory) !void {
        for (c.program.functions) |f| {
            try c.anchor(f.declaration, f.source);
            for (f.registers) |reg| { try c.carrier(reg.carrier); try c.maybeRef(reg.view, c.counts().types); }
            for (f.blocks) |block| for (block.instructions) |op| try c.origin(op.source);
        }
        try layout.check(c); try ssa.check(c); try correspondence.check(c); try origin.validateDirectory(c.allocator, interpretation, budget);
    }


};

test "method adapter consumes every fixed arm prefix and saved receiver through both completions" {
    var fixture: MethodAdapterDTO.Fixture = undefined; fixture.init(false);
    const a_id: t.Hash = @splat(0x11); const b_id: t.Hash = @splat(0x22);
    const constructor_a: t.Hash = @splat(0x31); const constructor_b: t.Hash = @splat(0x32);
    fixture.program.tables.mode.common.members.constructions = &.{
        .{ .id = constructor_a, .owner = @enumFromInt(0), .function = null, .kind = .@"implicit-base", .origin = MethodAdapterDTO.declaration,
            .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = @enumFromInt(0) }, .source_signature = .{ .id = constructor_a, .origin = MethodAdapterDTO.declaration },
            .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public },
        .{ .id = constructor_b, .owner = @enumFromInt(1), .function = null, .kind = .@"implicit-derived", .origin = MethodAdapterDTO.declaration,
            .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = @enumFromInt(1) }, .source_signature = .{ .id = constructor_b, .origin = MethodAdapterDTO.declaration },
            .implicit_forward = .{ .target = @enumFromInt(0), .origin = MethodAdapterDTO.declaration, .base_signature = .{ .parameters = &.{}, .@"return" = @enumFromInt(0) }, .parameters = &.{} },
            .initialization_phase = .@"after-successful-super", .initialization_fields = &.{}, .access = .public },
    };
    const ScopeFunction = std.meta.Child(@FieldType(publication.StableScope, "functions"));
    var scope_functions: [3]ScopeFunction = undefined;
    for (&scope_functions, 0..) |*row, index| row.* = .{
        .function_id = fixture.functions[index].id, .signature_hash = fixture.functions[index].signature,
        .kind = if (index == 0) .source else .method,
        .decl_key = .{ .kind = if (index == 0) .function else .method, .name = if (index == 0) "methodCaller" else "choose", .path = if (index == 0) &.{} else if (index == 1) &.{"A"} else &.{"B"}, .source_path = fixture.sources[0].path },
        .parameter_types = if (index < 2) &.{ a_id, a_id } else &.{b_id}, .return_type = a_id,
        .method_minimum_argument_count = fixture.abis[index].method_minimum_argument_count,
        .construction = null, .lexical_parent = null, .lexical_environment = null, .activation_environment = null, .captures = &.{}, .access = .public,
    };
    var scope = std.mem.zeroes(publication.StableScope); scope.root_file = fixture.sources[0].path;
    scope.functions = &scope_functions;
    scope.types = &.{
        .{ .id = a_id, .label = "A", .shape = .{ .nominal = .{ .kind = .reference, .label = "A", .base = null,
            .construction = .{ .access = .public, .parameters = &.{}, .return_type = "A", .argument_signature = null }, .fields = &.{},
            .methods = &.{.{ .access = .public, .name = "choose", .parameters = &.{"A"}, .return_type = "A", .minimum_argument_count = 1 }} } } },
        .{ .id = b_id, .label = "B", .shape = .{ .nominal = .{ .kind = .reference, .label = "B", .base = "A",
            .construction = .{ .access = .public, .parameters = &.{}, .return_type = "B", .argument_signature = null }, .fields = &.{},
            .methods = &.{.{ .access = .public, .name = "choose", .parameters = &.{}, .return_type = "A", .minimum_argument_count = 0 }} } } },
    };
    scope.constructions = &.{
        .{ .id = constructor_a, .owner = a_id, .base = null, .kind = .@"implicit-base", .function_id = null },
        .{ .id = constructor_b, .owner = b_id, .base = a_id, .kind = .@"implicit-derived", .function_id = null },
    };
    const a_graph = origin_model.Graph{
        .nodes = &.{ .{ .parameter = .{ .@"type" = MethodAdapterDTO.a_text, .index = 0 } }, .{ .parameter = .{ .@"type" = MethodAdapterDTO.a_text, .index = 1 } } },
        .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{1},
        .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{.{ .heap = 0, .control = 0 }} }, .accesses = &.{},
    };
    const b_graph = origin_model.Graph{
        .nodes = &.{.{ .parameter = .{ .@"type" = MethodAdapterDTO.b_text, .index = 0 } }},
        .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{0}, .language = &.{0},
        .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{.{ .heap = 0, .control = 0 }} }, .accesses = &.{},
    };
    const ContractRow = CaptureAdapterFixture.ContractRow;
    var contracts: [3]ContractRow = undefined;
    for (&contracts, 0..) |*row, index| {
        row.* = std.mem.zeroes(ContractRow); row.function_id = fixture.functions[index].id; row.signature_hash = fixture.functions[index].signature;
        row.digest = @splat(@as(u8, @intCast((index + 1) * 0x11))); row.upper.facets.may_throw = true;
        // Every DTO function has managed inputs and a managed normal return.
        row.upper.facets.managed_reference = true; row.upper.facets.escape = true;
    }
    var permissions: [2]CaptureAdapterFixture.ParameterRow = .{
        .{ .index = 0, .read = false, .write = true, .structural = true },
        .{ .index = 1, .read = true, .write = false, .structural = false },
    };
    contracts[0].upper.parameters = &permissions;
    contracts[1].return_origins = a_graph; contracts[1].upper.parameters = &.{
        .{ .index = 0, .read = false, .write = true, .structural = false },
        .{ .index = 1, .read = true, .write = false, .structural = false },
    };
    contracts[2].return_origins = b_graph; contracts[2].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = true }};
    const fixed = &fixture.program.tables.mode.common.authority.fixed_publication;
    fixed.stable_scope = scope; fixed.publication.scope = scope; fixed.publication.contracts = &contracts;
    fixed.dependencies = &.{
        .{ .function_id = @splat(0x44), .callees = &.{ .{ .function_id = @splat(0x55), .digest = @splat(0x22) }, .{ .function_id = @splat(0x66), .digest = @splat(0x33) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x55), .callees = &.{}, .hosts = &.{} }, .{ .function_id = @splat(0x66), .callees = &.{}, .hosts = &.{} },
    };
    var c = Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    var budget = origin_model.Budget{ .context = &c, .charge = publication_refs.graphCharge };
    var arena = std.heap.ArenaAllocator.init(c.allocator); defer arena.deinit();
    const directory = try publication_refs.returnOriginDirectory(&c, arena.allocator(), fixed.*);
    try MethodAdapterDTO.typedInput(&c, &budget, &directory);
    try std.testing.expect((try origin_model.validateGraph(c.allocator, &directory, MethodAdapterDTO.method_a_text, &a_graph, &budget)) == .valid);
    try std.testing.expect((try origin_model.validateGraph(c.allocator, &directory, MethodAdapterDTO.method_b_text, &b_graph, &budget)) == .valid);
    var collector = try Collector.init(&c, null); defer collector.deinit();
    var graph = UpperGraph{ .collector = &collector, .function = @enumFromInt(0) };
    // Run the real complete-dispatch loop and both caller continuations.
    // The current method bodies do not write/throw; their COMPLETE fixed
    // permissions and exceptional relationships must still be consumed.
    try graph.run(); try std.testing.expect(!collector.fixed_upper_origin_pending);
    inline for (.{ .{ @as(usize, 0), "write" }, .{ @as(usize, 0), "structural" }, .{ @as(usize, 1), "read" } }) |missing| {
        @field(permissions[missing[0]], missing[1]) = false;
        try std.testing.expectError(error.InvalidShape, graph.run());
        @field(permissions[missing[0]], missing[1]) = true;
    }
    contracts[0].upper.facets.may_throw = false;
    try std.testing.expectError(error.InvalidShape, graph.run()); contracts[0].upper.facets.may_throw = true;
    contracts[2].digest = @splat(0xee);
    try std.testing.expectError(error.InvalidShape, graph.run()); contracts[2].digest = @splat(0x33);
    var incoming = try UpperState.init(&c, fixture.functions[0].registers.len); defer incoming.deinit(&c);
    _ = try incoming.values[0].add(&c, .{ .parameter = 0 }); _ = try incoming.values[1].add(&c, .{ .parameter = 1 });
    const op = fixture.caller_instructions[1];
    var alternatives: ?UpperState = null; defer if (alternatives) |*state| state.deinit(&c);
    var returned: Owners = .{}; defer returned.deinit(c.allocator);
    var thrown: Owners = .{}; defer thrown.deinit(c.allocator); var completions: UpperCompletions = .{}; defer completions.deinit(&c);
    try graph.consumeAlternative(@enumFromInt(1), op, &incoming, &alternatives, 0, true, &returned, &thrown, &completions);
    try graph.consumeAlternative(@enumFromInt(2), op, &incoming, &alternatives, 0, true, &returned, &thrown, &completions);
    try std.testing.expect(completions.language and !collector.fixed_upper_origin_pending);
    for ([_]*const Owners{ &returned, &thrown }) |output| {
        try std.testing.expectEqual(@as(usize, 2), output.items.items.len);
        var receiver = false; var argument = false;
        for (output.items.items) |owner| {
            try std.testing.expect(owner == .parameter);
            receiver = receiver or owner.parameter == 0; argument = argument or owner.parameter == 1;
        }
        try std.testing.expect(receiver and argument);
    }
    // A missing fixed relationship is not replaced by the current method's
    // body even though that body trivially returns its receiver.
    contracts[2].return_origins = null;
    var unavailable: Owners = .{}; defer unavailable.deinit(c.allocator);
    var unavailable_throw: Owners = .{}; defer unavailable_throw.deinit(c.allocator);
    try graph.consumeAlternative(@enumFromInt(2), op, &incoming, &alternatives, 0, true, &unavailable, &unavailable_throw, &completions);
    try graph.mark(&unavailable, .write); try std.testing.expect(collector.fixed_upper_origin_pending);
}

test "returned Array contents with full caller parameter rights survive fixed export and consumer write" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{}, .{}, false);
    var aliases: [3]AliasSummary = .{ .{}, .{}, .{} };
    defer for (&aliases) |*summary| summary.deinit(fixture.c.allocator);
    fixture.collector.aliases = &aliases;
    const reference_id = "sha256:6666666666666666666666666666666666666666666666666666666666666666";
    const array_id = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const function_id = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    var types: [3]tables.CommonType = undefined;
    @memcpy(types[0..2], fixture.program.tables.mode.common.types);
    types[2] = types[0]; types[2].id = @splat(0xaa); types[2].kind = .array; types[2].name = "ReturnedArray"; types[2].element = @enumFromInt(0);
    fixture.program.tables.mode.common.types = &types;
    fixture.abis[2].result = @enumFromInt(2); fixture.abis[2].result_carrier = .{ .@"type" = @enumFromInt(2) };
    var bindings: [4]CaptureAdapterFixture.Storage.CommonBinding = undefined; @memcpy(bindings[0..2], &fixture.bindings);
    bindings[2] = fixture.bindings[0]; bindings[2].id = "array-argument"; bindings[2].name = "array-argument";
    bindings[2].owner = .{ .param = @enumFromInt(1) }; bindings[2].@"type" = @enumFromInt(2); bindings[2].carrier = .{ .@"type" = @enumFromInt(2) };
    bindings[3] = fixture.bindings[0]; bindings[3].id = "creator-argument"; bindings[3].name = "creator-argument";
    bindings[3].owner = .{ .param = @enumFromInt(2) };
    fixture.program.tables.mode.common.storage.bindings = &bindings;
    fixture.abis[1].parameters = &.{@enumFromInt(2)}; fixture.abis[1].argument_types = &.{@enumFromInt(2)};
    fixture.abis[1].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(2) } };
    fixture.abis[2].parameters = &.{@enumFromInt(3)}; fixture.abis[2].argument_types = &.{@enumFromInt(0)};
    fixture.abis[2].physical_parameters = &.{.{ .@"type" = @enumFromInt(0) }};
    fixture.contracts[1].upper.parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }};
    fixture.contracts[2].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
    fixture.program.tables.mode.common.authority.fixed_publication.dependencies = &.{
        .{ .function_id = @splat(0x11), .callees = &.{ .{ .function_id = @splat(0x22), .digest = @splat(0x44) }, .{ .function_id = @splat(0x33), .digest = @splat(0x55) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
        .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
    };
    var managed: [3]Managed = .{ .empty, .empty, .empty }; fixture.collector.managed = &managed;
    var concrete: [3]?usize = .{ null, null, null }; fixture.collector.concrete = &concrete;
    const interpretation = origin_model.Directory{
        .types = &.{ .{ .id = reference_id, .kind = .reference }, .{ .id = array_id, .kind = .array } },
        .functions = &.{.{ .id = function_id, .kind = .source, .parameter_types = &.{reference_id}, .return_type = array_id, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null }},
        .environments = &.{}, .globals = &.{}, .fields = &.{},
        .constructions = &.{.{ .id = "reference-construction", .owner = reference_id, .base = null, .kind = .implicit_base, .function_id = null }},
    };
    const nodes = [_]origin_model.Value{ .{ .parameter = .{ .@"type" = reference_id, .index = 0 } }, .{ .local = .{ .@"type" = array_id } } };
    const input = origin_model.Graph{ .nodes = &nodes, .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "element", .view = array_id, .values = &.{0}, .control = 0, .initialize = true } } }, .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{} }, .accesses = &.{} };
    fixture.contracts[2].return_origins = input;
    fixture.contracts[0].upper.facets.allocation = true; fixture.contracts[0].upper.facets.managed_reference = true; fixture.contracts[0].upper.facets.escape = true;
    fixture.contracts[2].upper.facets.allocation = true; fixture.contracts[2].upper.facets.managed_reference = true; fixture.contracts[2].upper.facets.escape = true;
    const fixed = [_]fixed_owners.Fixed{.{ .function_id = function_id, .graph = &input, .parameters = &.{.{}}, .captures = &.{}, .may_throw = false }};
    var budget = origin_model.Budget{ .context = &fixture.c, .charge = publication_refs.graphCharge };
    try origin_model.validateDirectory(fixture.c.allocator, &interpretation, &budget);
    try std.testing.expect((try origin_model.validateGraph(fixture.c.allocator, &interpretation, function_id, &input, &budget)) == .valid);
    var analysis = try fixed_owners.analyze(fixture.c.allocator, &interpretation, &.{}, function_id, &input, &fixed, &budget); defer analysis.deinit();
    try std.testing.expectEqual(@as(?fixed_owners.Pending, null), analysis.pending);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    var graph = UpperGraph{ .collector = &fixture.collector, .function = @enumFromInt(0) };
    _ = try fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    const creator_op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = @enumFromInt(0), .operands = &.{@enumFromInt(0)}, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    const op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = null, .operands = &.{ @enumFromInt(1), @enumFromInt(0) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var export_graph = FixedExport{ .g = &graph, .analysis = &analysis, .target = @enumFromInt(2), .op = creator_op, .offset = 0, .saved = &state, .destination = &state, .invocation = .{ .caller = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 0, .target = @enumFromInt(2) }, .allocator = analysis.arena.allocator(), .environments = &.{} };
    var value = try export_graph.exportValue(analysis.normal[0]); defer value.deinit(fixture.c.allocator);
    try state.values[0].replace(&fixture.c, &value);
    var saved = try UpperState.clone(&fixture.c, &state); defer saved.deinit(&fixture.c);
    var returned: Owners = .{}; defer returned.deinit(fixture.c.allocator);
    var thrown: Owners = .{}; defer thrown.deinit(fixture.c.allocator);
    var completions: UpperCompletions = .{};
    // This is the same production full-parameter transfer as a later call.
    // Its return is ignored; missing exported element ownership still cannot
    // turn p's externally reachable data into a known-empty Local proof.
    try graph.consume(@enumFromInt(1), op, &state, &saved, 1, false, &returned, &thrown, &completions);
    try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
}

test "normal returned Array contents do not inherit the language exit owners before a full consumer write" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{}, .{}, false);
    var aliases: [3]AliasSummary = .{ .{}, .{}, .{} };
    defer for (&aliases) |*summary| summary.deinit(fixture.c.allocator);
    fixture.collector.aliases = &aliases;
    const reference_id = "sha256:6666666666666666666666666666666666666666666666666666666666666666";
    const array_id = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const function_id = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    var types: [3]tables.CommonType = undefined;
    @memcpy(types[0..2], fixture.program.tables.mode.common.types);
    types[2] = types[0]; types[2].id = @splat(0xaa); types[2].kind = .array; types[2].name = "ReturnedArray"; types[2].element = @enumFromInt(0);
    fixture.program.tables.mode.common.types = &types;
    fixture.abis[2].result = @enumFromInt(2); fixture.abis[2].result_carrier = .{ .@"type" = @enumFromInt(2) };
    var bindings: [6]CaptureAdapterFixture.Storage.CommonBinding = undefined; @memcpy(bindings[0..2], &fixture.bindings);
    bindings[2] = fixture.bindings[0]; bindings[2].id = "array-argument"; bindings[2].name = "array-argument";
    bindings[2].owner = .{ .param = @enumFromInt(1) }; bindings[2].@"type" = @enumFromInt(2); bindings[2].carrier = .{ .@"type" = @enumFromInt(2) };
    bindings[3] = fixture.bindings[0]; bindings[3].id = "creator-argument"; bindings[3].name = "creator-argument";
    bindings[3].owner = .{ .param = @enumFromInt(2) };
    bindings[4] = bindings[3]; bindings[4].id = "creator-q"; bindings[4].name = "creator-q";
    bindings[5] = bindings[0]; bindings[5].id = "caller-q"; bindings[5].name = "caller-q";
    var caller_permissions: [2]CaptureAdapterFixture.ParameterRow = .{ fixture.parameter[0], .{ .index = 1, .read = false, .write = false, .structural = false } };
    fixture.contracts[0].upper.parameters = &caller_permissions;
    fixture.abis[0].parameters = &.{ @enumFromInt(0), @enumFromInt(5) }; fixture.abis[0].argument_types = &.{ @enumFromInt(0), @enumFromInt(0) };
    fixture.abis[0].physical_parameters = &.{ .{ .@"type" = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } };
    fixture.program.tables.mode.common.storage.bindings = &bindings;
    fixture.abis[1].parameters = &.{@enumFromInt(2)}; fixture.abis[1].argument_types = &.{@enumFromInt(2)};
    fixture.abis[1].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(2) } };
    fixture.abis[2].parameters = &.{ @enumFromInt(3), @enumFromInt(4) }; fixture.abis[2].argument_types = &.{ @enumFromInt(0), @enumFromInt(0) };
    fixture.abis[2].physical_parameters = &.{ .{ .@"type" = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } };
    fixture.contracts[1].upper.parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }};
    fixture.contracts[2].upper.parameters = &.{ .{ .index = 0, .read = false, .write = false, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } };
    fixture.program.tables.mode.common.authority.fixed_publication.dependencies = &.{
        .{ .function_id = @splat(0x11), .callees = &.{ .{ .function_id = @splat(0x22), .digest = @splat(0x44) }, .{ .function_id = @splat(0x33), .digest = @splat(0x55) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
        .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
    };
    var managed: [3]Managed = .{ .empty, .empty, .empty }; fixture.collector.managed = &managed;
    var concrete: [3]?usize = .{ null, null, null }; fixture.collector.concrete = &concrete;
    const interpretation = origin_model.Directory{
        .types = &.{ .{ .id = reference_id, .kind = .reference }, .{ .id = array_id, .kind = .array } },
        .functions = &.{.{ .id = function_id, .kind = .source, .parameter_types = &.{ reference_id, reference_id }, .return_type = array_id, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null }},
        .environments = &.{}, .globals = &.{}, .fields = &.{},
        .constructions = &.{.{ .id = "reference-construction", .owner = reference_id, .base = null, .kind = .implicit_base, .function_id = null }},
    };
    const nodes = [_]origin_model.Value{ .{ .parameter = .{ .@"type" = reference_id, .index = 0 } }, .{ .parameter = .{ .@"type" = reference_id, .index = 1 } }, .{ .local = .{ .@"type" = array_id } } };
    const input = origin_model.Graph{
        .nodes = &nodes, .heaps = &.{ .entry,
            .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "element", .view = array_id, .values = &.{0}, .control = 0, .initialize = true } },
            .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "element", .view = array_id, .values = &.{1}, .control = 0, .initialize = true } },
        }, .controls = &.{.entry}, .calls = &.{}, .normal = &.{2}, .language = &.{2},
        .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{.{ .heap = 2, .control = 0 }} }, .accesses = &.{},
    };
    fixture.contracts[2].return_origins = input;
    fixture.contracts[0].upper.facets.allocation = true; fixture.contracts[0].upper.facets.managed_reference = true; fixture.contracts[0].upper.facets.escape = true;
    fixture.contracts[2].upper.facets.allocation = true; fixture.contracts[2].upper.facets.managed_reference = true; fixture.contracts[2].upper.facets.escape = true;
    fixture.contracts[2].upper.facets.may_throw = true;
    const fixed = [_]fixed_owners.Fixed{.{ .function_id = function_id, .graph = &input, .parameters = &.{ .{}, .{} }, .captures = &.{}, .may_throw = true }};
    var budget = origin_model.Budget{ .context = &fixture.c, .charge = publication_refs.graphCharge };
    try origin_model.validateDirectory(fixture.c.allocator, &interpretation, &budget);
    try std.testing.expect((try origin_model.validateGraph(fixture.c.allocator, &interpretation, function_id, &input, &budget)) == .valid);
    var analysis = try fixed_owners.analyze(fixture.c.allocator, &interpretation, &.{}, function_id, &input, &fixed, &budget); defer analysis.deinit();
    try std.testing.expectEqual(@as(?fixed_owners.Pending, null), analysis.pending);
    const origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } };
    var state = try fixture.saved(origin, true); defer state.deinit(&fixture.c);
    _ = try state.values[2].add(&fixture.c, .{ .parameter = 1 });
    var graph = UpperGraph{ .collector = &fixture.collector, .function = @enumFromInt(0) };
    _ = try fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    const creator_op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = @enumFromInt(0), .operands = &.{ @enumFromInt(0), @enumFromInt(2) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    const op = model.instruction.Instruction{ .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = null, .operands = &.{ @enumFromInt(1), @enumFromInt(0) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var export_graph = FixedExport{ .g = &graph, .analysis = &analysis, .target = @enumFromInt(2), .op = creator_op, .offset = 0, .saved = &state, .destination = &state, .invocation = .{ .caller = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 0, .target = @enumFromInt(2) }, .allocator = analysis.arena.allocator(), .environments = &.{} };
    var value = try export_graph.exportValue(analysis.normal[0]); defer value.deinit(fixture.c.allocator);
    try state.values[0].replace(&fixture.c, &value);
    var saved = try UpperState.clone(&fixture.c, &state); defer saved.deinit(&fixture.c);
    var returned: Owners = .{}; defer returned.deinit(fixture.c.allocator);
    var thrown: Owners = .{}; defer thrown.deinit(fixture.c.allocator);
    var completions: UpperCompletions = .{};
    // This is the same production full-parameter transfer as a later call.
    // Its return is ignored; missing exported element ownership still cannot
    // turn p's externally reachable data into a known-empty Local proof.
    try graph.consume(@enumFromInt(1), op, &state, &saved, 1, false, &returned, &thrown, &completions);
    try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    // The other completion really carries q; it is not dropped from Analysis.
    try std.testing.expect(analysis.normal_live and analysis.language_live);
    try std.testing.expectEqual(@as(usize, 1), analysis.normal_payloads.len);
    try std.testing.expectEqual(@as(usize, 1), analysis.language_payloads.len);
    const normal_child = analysis.locations[analysis.normal_payloads[0].slots[0].values[0]].owner;
    const language_child = analysis.locations[analysis.language_payloads[0].slots[0].values[0]].owner;
    try std.testing.expect(normal_child == .parameter and normal_child.parameter == 0);
    try std.testing.expect(language_child == .parameter and language_child.parameter == 1);
    caller_permissions[0].write = false;
    var denied = try UpperState.clone(&fixture.c, &saved); defer denied.deinit(&fixture.c);
    try std.testing.expectError(error.InvalidShape, graph.consume(@enumFromInt(1), op, &denied, &saved, 1, false, &returned, &thrown, &completions));
}


// Literal metadata at the existing private FX adapter seam. This is not a
// Source packet, body-coverage certificate, ActualAnalysis or VM receipt.
test "closure Array fixed export preserves Code ENV parent slots and every caller content permission" {
    const ClosureDTO = struct {
        const reference_id = "sha256:" ++ "66" ** 32;
        const callable_id = "sha256:" ++ "88" ** 32;
        const array_id = "sha256:" ++ "aa" ** 32;
        const caller_id = "sha256:" ++ "11" ** 32;
        const consumer_id = "sha256:" ++ "22" ** 32;
        const creator_id = "sha256:" ++ "33" ** 32;
        const outer_id = "sha256:" ++ "44" ** 32;
        const parent_id = "sha256:" ++ "77" ** 32;
        const child_id = "sha256:" ++ "99" ** 32;
        const parent_slot = "sha256:" ++ "55" ** 32;
        const child_slot = "sha256:" ++ "ab" ** 32;
        const global_id = "sha256:" ++ "bb" ** 32;
        const directory = origin_model.Directory{
            .types = &.{
                .{ .id = reference_id, .kind = .reference },
                .{ .id = callable_id, .kind = .function },
                .{ .id = array_id, .kind = .array },
            },
            .functions = &.{
                .{ .id = caller_id, .kind = .source, .parameter_types = &.{reference_id}, .return_type = reference_id, .environment_metadata_complete = true, .lexical_environment = parent_id, .activation_environment = null, .construction = null },
                .{ .id = consumer_id, .kind = .source, .parameter_types = &.{array_id}, .return_type = reference_id, .environment_metadata_complete = true, .lexical_environment = child_id, .activation_environment = null, .construction = null },
                .{ .id = creator_id, .kind = .source, .parameter_types = &.{reference_id}, .return_type = array_id, .environment_metadata_complete = true, .lexical_environment = parent_id, .activation_environment = child_id, .construction = null },
                .{ .id = outer_id, .kind = .source, .parameter_types = &.{}, .return_type = reference_id, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = parent_id, .construction = null },
            },
            .environments = &.{
                .{ .id = parent_id, .parent = null, .slots = &.{.{ .key = parent_slot, .@"type" = reference_id, .writable = true }} },
                .{ .id = child_id, .parent = parent_id, .slots = &.{.{ .key = child_slot, .@"type" = reference_id, .writable = true }} },
            },
            .globals = &.{.{ .id = global_id, .@"type" = reference_id }},
            .fields = &.{},
            .constructions = &.{.{ .id = "closure-reference-role", .owner = reference_id, .base = null, .kind = .implicit_base, .function_id = null }},
        };
        // All slices below are persistent const backing, independent of any
        // initializer stack. The creator is an ordinary source function.
        const relation = origin_model.Graph{
            .nodes = &.{
                .{ .environment_input = .{ .layout = parent_id } },
                .{ .parameter = .{ .@"type" = reference_id, .index = 0 } },
                .{ .environment_create = .{ .layout = child_id, .parent = &.{0}, .site = "closure-activation", .control = 0 } },
                .{ .code = .{ .@"type" = callable_id, .function_id = consumer_id, .environment = &.{2}, .control = 0 } },
                .{ .local = .{ .@"type" = array_id } },
            },
            .heaps = &.{
                .entry,
                .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "capture:" ++ child_slot, .view = "env:" ++ child_id, .values = &.{1}, .control = 0, .initialize = true } },
                .{ .store = .{ .previous = 1, .bases = &.{4}, .selector = "element", .view = array_id, .values = &.{3}, .control = 0, .initialize = true } },
            },
            .controls = &.{.entry}, .calls = &.{}, .normal = &.{4}, .language = &.{},
            .exits = .{ .normal = &.{.{ .heap = 2, .control = 0 }}, .language = &.{} }, .accesses = &.{},
        };
    };
    var closure_fixture: CaptureAdapterFixture = undefined;
    closure_fixture.init(.{ .read = true, .write = true, .structural = true }, .{ .read = true, .write = true, .structural = true }, .{ .read = true, .write = true, .structural = true }, true);
    var closure_types: [3]tables.CommonType = undefined;
    @memcpy(closure_types[0..2], closure_fixture.program.tables.mode.common.types);
    closure_types[2] = closure_types[0]; closure_types[2].id = @splat(0xaa); closure_types[2].kind = .array;
    closure_types[2].name = "ClosureArray"; closure_types[2].element = @enumFromInt(1);
    closure_fixture.program.tables.mode.common.types = &closure_types;
    var closure_functions: [4]model.Function = undefined;
    @memcpy(closure_functions[0..3], &closure_fixture.functions);
    closure_functions[3] = closure_functions[0]; closure_functions[3].id = @splat(0x44); closure_functions[3].abi = @enumFromInt(3);
    closure_fixture.program.functions = &closure_functions;
    var closure_bindings: [6]CaptureAdapterFixture.Storage.CommonBinding = undefined;
    @memcpy(closure_bindings[0..2], &closure_fixture.bindings);
    closure_bindings[1].owner = .{ .local = @enumFromInt(3) }; closure_bindings[1].scope = @enumFromInt(3);
    closure_bindings[2] = closure_bindings[0]; closure_bindings[2].id = "closure-child-slot"; closure_bindings[2].name = "childSlot";
    closure_bindings[2].owner = .{ .local = @enumFromInt(2) }; closure_bindings[2].scope = @enumFromInt(2);
    closure_bindings[2].writable = true; closure_bindings[2].declaration_kind = .local;
    closure_bindings[3] = closure_bindings[0]; closure_bindings[3].id = "closure-consumer-array"; closure_bindings[3].name = "array";
    closure_bindings[3].owner = .{ .param = @enumFromInt(1) }; closure_bindings[3].scope = @enumFromInt(1);
    closure_bindings[3].@"type" = @enumFromInt(2); closure_bindings[3].carrier = .{ .@"type" = @enumFromInt(2) };
    closure_bindings[4] = closure_bindings[0]; closure_bindings[4].id = "closure-creator-parameter"; closure_bindings[4].name = "p";
    closure_bindings[4].owner = .{ .param = @enumFromInt(2) }; closure_bindings[4].scope = @enumFromInt(2);
    closure_bindings[5] = closure_bindings[0]; closure_bindings[5].id = "closure-global"; closure_bindings[5].name = "G";
    closure_bindings[5].owner = .{ .global = @enumFromInt(0) }; closure_bindings[5].scope = null;
    closure_bindings[5].writable = true; closure_bindings[5].declaration_kind = null;
    closure_fixture.program.tables.mode.common.storage.bindings = &closure_bindings;
    const closure_env_rows = [_]CaptureAdapterFixture.EnvironmentRow{
        .{ .id = @splat(0x77), .owner = @enumFromInt(3), .parent = null, .slots = &.{.{ .binding = @enumFromInt(1), .key = @splat(0x55), .kind = .local, .@"type" = @enumFromInt(0), .writable = true }} },
        .{ .id = @splat(0x99), .owner = @enumFromInt(2), .parent = @enumFromInt(0), .slots = &.{.{ .binding = @enumFromInt(2), .key = @splat(0xab), .kind = .local, .@"type" = @enumFromInt(0), .writable = true }} },
    };
    closure_fixture.program.tables.mode.common.closures.environments = &closure_env_rows;
    closure_fixture.program.tables.mode.common.storage.environments = &.{
        .{ .environment = @enumFromInt(0), .byte_size = 8, .alignment = 8, .reference_count = 1, .parent_offset = null, .slot_offsets = &.{0} },
        .{ .environment = @enumFromInt(1), .byte_size = 16, .alignment = 8, .reference_count = 2, .parent_offset = 0, .slot_offsets = &.{8} },
    };
    var closure_abis: [4]CaptureAdapterFixture.Storage.CommonAbi = undefined;
    @memcpy(closure_abis[0..3], &closure_fixture.abis);
    closure_abis[1].parameters = &.{@enumFromInt(3)}; closure_abis[1].argument_types = &.{@enumFromInt(2)};
    closure_abis[1].lexical_environment = @enumFromInt(1);
    closure_abis[1].physical_parameters = &.{ .{ .environment = @enumFromInt(1) }, .{ .@"type" = @enumFromInt(2) } };
    closure_abis[2].parameters = &.{@enumFromInt(4)}; closure_abis[2].argument_types = &.{@enumFromInt(0)};
    closure_abis[2].lexical_environment = @enumFromInt(0);
    closure_abis[2].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } };
    closure_abis[2].result = @enumFromInt(2); closure_abis[2].result_carrier = .{ .@"type" = @enumFromInt(2) };
    closure_abis[3] = closure_fixture.abis[2]; closure_abis[3].function = @enumFromInt(3);
    closure_fixture.program.tables.mode.common.abis = &closure_abis;
    var closure_rows: [4]CaptureAdapterFixture.ClosureRow = undefined;
    @memcpy(closure_rows[0..3], &closure_fixture.closures);
    closure_rows[0].parent = @enumFromInt(3); closure_rows[0].activation_environment = null;
    closure_rows[0].captures = &.{.{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }};
    closure_rows[1].parent = @enumFromInt(2); closure_rows[1].lexical_environment = @enumFromInt(1);
    closure_rows[1].captures = &.{
        .{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) },
        .{ .environment = @enumFromInt(1), .slot = @enumFromInt(0) },
    };
    closure_rows[2].parent = @enumFromInt(3); closure_rows[2].lexical_environment = @enumFromInt(0); closure_rows[2].activation_environment = @enumFromInt(1);
    closure_rows[2].captures = &.{.{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }};
    closure_rows[3] = .{ .function = @enumFromInt(3), .parent = null, .lexical_environment = null, .activation_environment = @enumFromInt(0), .captures = &.{} };
    closure_fixture.program.tables.mode.common.closures.functions = &closure_rows;
    closure_fixture.program.tables.mode.common.modules.globals = &.{.{
        .id = @splat(0xbb), .source = @enumFromInt(0), .name = "G", .@"type" = @enumFromInt(0), .carrier = .{ .@"type" = @enumFromInt(0) },
        .writable = true, .generated = false, .start = 0, .end = 1,
        .decl_key = .{ .kind = .global, .name = "G", .path = &.{}, .source_path = "capture-adapter-dto.ts" }, .binding = @enumFromInt(5),
    }};
    closure_fixture.contracts[0].upper.globals = .{ .reads = &.{@splat(0xbb)}, .writes = &.{@splat(0xbb)} };
    closure_fixture.contracts[0].upper.facets.allocation = true;
    closure_fixture.contracts[0].upper.facets.managed_reference = true;
    closure_fixture.contracts[0].upper.facets.escape = true;
    closure_fixture.contracts[1].upper.parameters = &.{.{ .index = 0, .read = true, .write = true, .structural = true }};
    closure_fixture.contracts[2].upper.parameters = &.{.{ .index = 0, .read = false, .write = false, .structural = false }};
    closure_fixture.contracts[2].return_origins = ClosureDTO.relation;
    closure_fixture.contracts[2].upper.facets.allocation = true;
    closure_fixture.contracts[2].upper.facets.managed_reference = true;
    closure_fixture.contracts[2].upper.facets.escape = true;
    closure_fixture.program.tables.mode.common.authority.fixed_publication.dependencies = &.{
        .{ .function_id = @splat(0x11), .callees = &.{ .{ .function_id = @splat(0x22), .digest = @splat(0x44) }, .{ .function_id = @splat(0x33), .digest = @splat(0x55) } }, .hosts = &.{} },
        .{ .function_id = @splat(0x22), .callees = &.{}, .hosts = &.{} },
        .{ .function_id = @splat(0x33), .callees = &.{}, .hosts = &.{} },
    };
    var closure_contracts: [4]?usize = .{ 0, 1, 2, null }; closure_fixture.collector.contracts = &closure_contracts;
    var closure_captures: [6]?Capture = .{ null, .{ .environment = @enumFromInt(0), .slot = @enumFromInt(0) }, .{ .environment = @enumFromInt(1), .slot = @enumFromInt(0) }, null, null, null };
    closure_fixture.collector.captures = &closure_captures;
    var closure_managed: [3]Managed = .{ .empty, .empty, .empty }; closure_fixture.collector.managed = &closure_managed;
    var closure_concrete: [3]?usize = .{ null, null, null }; closure_fixture.collector.concrete = &closure_concrete;
    var closure_aliases: [4]AliasSummary = .{ .{}, .{}, .{}, .{} }; closure_fixture.collector.aliases = &closure_aliases;
    defer for (&closure_aliases) |*closure_summary| closure_summary.deinit(closure_fixture.c.allocator);
    var closure_budget = origin_model.Budget{ .context = &closure_fixture.c, .charge = publication_refs.graphCharge };
    try origin_model.validateDirectory(closure_fixture.c.allocator, &ClosureDTO.directory, &closure_budget);
    try std.testing.expect((try origin_model.validateGraph(closure_fixture.c.allocator, &ClosureDTO.directory, ClosureDTO.creator_id, &ClosureDTO.relation, &closure_budget)) == .valid);

    var closure_state = try UpperState.init(&closure_fixture.c, 5); defer closure_state.deinit(&closure_fixture.c);
    _ = try closure_state.values[0].add(&closure_fixture.c, .{ .parameter = 0 });
    const closure_parent_origin = effect_env.Origin{ .layout = @enumFromInt(0), .source = .input };
    _ = try closure_state.values[1].environments.direct.add(&closure_fixture.c, closure_parent_origin);
    var closure_global: Owners = .{}; defer closure_global.deinit(closure_fixture.c.allocator);
    _ = try closure_global.add(&closure_fixture.c, .{ .global = @enumFromInt(0) });
    try closure_state.store(&closure_fixture.c, .{ .binding = @enumFromInt(1), .environment = closure_parent_origin }, &closure_global);
    var closure_incoming = try UpperState.clone(&closure_fixture.c, &closure_state); defer closure_incoming.deinit(&closure_fixture.c);
    var closure_graph = UpperGraph{ .collector = &closure_fixture.collector, .function = @enumFromInt(0) };
    const closure_creator_op = model.instruction.Instruction{
        .source = .{ .source = @enumFromInt(0), .start = 0, .end = 1 }, .result = @enumFromInt(2), .operands = &.{ @enumFromInt(1), @enumFromInt(0) },
        .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } },
    };
    const closure_creator_upper = try closure_fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    var closure_arena = std.heap.ArenaAllocator.init(closure_fixture.c.allocator); defer closure_arena.deinit();
    var closure_returned: Owners = .{}; defer closure_returned.deinit(closure_fixture.c.allocator);
    var closure_thrown: Owners = .{}; defer closure_thrown.deinit(closure_fixture.c.allocator);
    // The real adapter constructs typed Initial input, runs the one owner
    // engine, and publishes Array/Code/ENV/slot identities through FixedExport.
    try std.testing.expect(try closure_graph.fixedOwnersGraph(@enumFromInt(2), closure_creator_op, &closure_incoming, &closure_state, 1, closure_creator_upper, &ClosureDTO.directory, ClosureDTO.creator_id, &ClosureDTO.relation, &closure_budget, closure_arena.allocator(), null, &closure_returned, &closure_thrown, null));
    try std.testing.expect(!closure_fixture.collector.fixed_upper_origin_pending);
    try std.testing.expect(closure_returned.known() and !closure_returned.payloads.unknown);
    try std.testing.expectEqual(@as(usize, 1), closure_returned.payloads.items.items.len);
    const closure_array_key = closure_returned.payloads.items.items[0];
    try std.testing.expect(closure_array_key.source == .fixed);
    try std.testing.expectEqual(@as(t.FunctionRef, @enumFromInt(2)), closure_array_key.source.fixed.invocation.target);
    const closure_array_record = closure_state.payloads.getPtr(closure_array_key).?;
    try std.testing.expectEqual(@as(usize, 1), closure_array_record.slots.len);
    try std.testing.expect(closure_array_record.slots[0] != null);
    try closure_state.values[2].replace(&closure_fixture.c, &closure_returned);
    try closure_graph.copyPayload(&closure_state, @enumFromInt(3), &closure_state.values[2], &closure_state.values[3]);
    // Invoke the Code recovered by a caller Array read; never substitute the
    // original parent ENV register for the child's Code+ENV association.
    try closure_graph.selectPayload(&closure_state, &closure_state.values[3], @enumFromInt(2), null, &closure_state.values[4]);
    const closure_selected = &closure_state.values[4];
    try std.testing.expect(closure_selected.known() and !closure_selected.environments.callable_unknown);
    try std.testing.expectEqual(@as(usize, 1), closure_selected.environments.callables.count());
    const closure_pair = closure_selected.environments.callables.getPtr(@enumFromInt(1)).?;
    try std.testing.expect(!closure_pair.unknown);
    try std.testing.expectEqual(@as(usize, 1), closure_pair.items.items.len);
    const closure_child_origin = closure_pair.items.items[0];
    try std.testing.expectEqual(@as(t.EnvironmentRef, @enumFromInt(1)), closure_child_origin.layout);
    try std.testing.expect(closure_child_origin.source == .fixed);
    try std.testing.expectEqual(@as(t.FunctionRef, @enumFromInt(2)), closure_child_origin.source.fixed.invocation.target);
    const closure_parents = closure_state.parents.getPtr(closure_child_origin).?;
    try std.testing.expect(!closure_parents.unknown);
    try std.testing.expectEqual(@as(usize, 1), closure_parents.items.items.len);
    try std.testing.expect(std.meta.eql(closure_parent_origin, closure_parents.items.items[0]));
    const closure_child_contents = closure_state.slots.getPtr(.{ .binding = @enumFromInt(2), .environment = closure_child_origin }).?;
    try std.testing.expectEqual(@as(usize, 1), closure_child_contents.items.items.len);
    try std.testing.expect(closure_child_contents.items.items[0] == .parameter);
    try std.testing.expectEqual(@as(usize, 0), closure_child_contents.items.items[0].parameter);
    const closure_parent_contents = closure_state.slots.getPtr(.{ .binding = @enumFromInt(1), .environment = closure_parent_origin }).?;
    try std.testing.expectEqual(@as(usize, 1), closure_parent_contents.items.items.len);
    try std.testing.expect(closure_parent_contents.items.items[0] == .global);
    try std.testing.expectEqual(@as(t.GlobalRef, @enumFromInt(0)), closure_parent_contents.items.items[0].global);

    const closure_consumer_op = model.instruction.Instruction{ .source = closure_creator_op.source, .result = null, .operands = &.{ @enumFromInt(4), @enumFromInt(3) },
        .data = .{ .eh_invoke_indirect = .{ .callable = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var closure_before_consumer = try UpperState.clone(&closure_fixture.c, &closure_state); defer closure_before_consumer.deinit(&closure_fixture.c);
    var closure_consumer_return: Owners = .{}; defer closure_consumer_return.deinit(closure_fixture.c.allocator);
    var closure_consumer_throw: Owners = .{}; defer closure_consumer_throw.deinit(closure_fixture.c.allocator);
    var closure_completions: UpperCompletions = .{};
    defer closure_completions.deinit(&closure_fixture.c);
    try closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_state, &closure_before_consumer, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions);
    try std.testing.expect(!closure_fixture.collector.fixed_upper_origin_pending);
    // Each missing flag must fail from the same saved complete closure. The
    // foreign capture/global roots cannot be paid by the parameter's rights.
    inline for (.{ "read", "write", "structural" }) |closure_flag| {
        @field(closure_fixture.parameter[0], closure_flag) = false;
        var closure_no_parameter = try UpperState.clone(&closure_fixture.c, &closure_before_consumer); defer closure_no_parameter.deinit(&closure_fixture.c);
        try std.testing.expectError(error.InvalidShape, closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_no_parameter, &closure_before_consumer, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions));
        @field(closure_fixture.parameter[0], closure_flag) = true;
        @field(closure_fixture.caller_capture[0], closure_flag) = false;
        var closure_no_capture = try UpperState.clone(&closure_fixture.c, &closure_before_consumer); defer closure_no_capture.deinit(&closure_fixture.c);
        try std.testing.expectError(error.InvalidShape, closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_no_capture, &closure_before_consumer, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions));
        @field(closure_fixture.caller_capture[0], closure_flag) = true;
    }
    inline for (.{ "reads", "writes" }) |closure_global_mode| {
        @field(closure_fixture.contracts[0].upper.globals, closure_global_mode) = &.{};
        var closure_no_global = try UpperState.clone(&closure_fixture.c, &closure_before_consumer); defer closure_no_global.deinit(&closure_fixture.c);
        try std.testing.expectError(error.InvalidShape, closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_no_global, &closure_before_consumer, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions));
        @field(closure_fixture.contracts[0].upper.globals, closure_global_mode) = &.{@splat(0xbb)};
    }
    closure_fixture.contracts[1].digest = @splat(0xee);
    var closure_wrong_digest = try UpperState.clone(&closure_fixture.c, &closure_before_consumer); defer closure_wrong_digest.deinit(&closure_fixture.c);
    try std.testing.expectError(error.InvalidShape, closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_wrong_digest, &closure_before_consumer, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions));
    closure_fixture.contracts[1].digest = @splat(0x44);
    try std.testing.expect(!closure_fixture.collector.fixed_upper_origin_pending);
    // A known Array cannot bless an unknown callable association.
    var closure_unknown_pair = try UpperState.clone(&closure_fixture.c, &closure_before_consumer); defer closure_unknown_pair.deinit(&closure_fixture.c);
    closure_unknown_pair.values[4].environments.callable_unknown = true;
    var closure_unknown_saved = try UpperState.clone(&closure_fixture.c, &closure_unknown_pair); defer closure_unknown_saved.deinit(&closure_fixture.c);
    try closure_graph.consume(@enumFromInt(1), closure_consumer_op, &closure_unknown_pair, &closure_unknown_saved, 1, false, &closure_consumer_return, &closure_consumer_throw, &closure_completions);
    try std.testing.expect(closure_fixture.collector.fixed_upper_origin_pending);
}

// Append inside the Effects module: this exercises private production seams.
// Literal metadata, layouts and graphs only; no Source/Actual admission claim.
test "Value physical fields survive both fixed exits and copying before the complete consumer upper" {
    var fixture: CaptureAdapterFixture = undefined; fixture.init(.{ .write = true }, .{}, .{}, false);
    const ref_id: t.Hash = @splat(0x66); const fn_id: t.Hash = @splat(0x88); const box_id: t.Hash = @splat(0xaa);
    const field_id: t.Hash = @splat(0xbb); const anchor = fixture.bindings[0].origin.?;
    const ref_text = "sha256:" ++ "66" ** 32; const box_text = "sha256:" ++ "aa" ** 32;
    const field_text = "sha256:" ++ "bb" ** 32; const creator_text = "sha256:" ++ "33" ** 32;
    const consumer_text = "sha256:" ++ "22" ** 32; const env_text = "sha256:" ++ "77" ** 32;
    var aliases: [3]AliasSummary = .{ .{}, .{}, .{} }; defer for (&aliases) |*row| row.deinit(fixture.c.allocator);
    fixture.collector.aliases = &aliases;
    var types: [3]tables.CommonType = undefined; @memcpy(types[0..2], fixture.program.tables.mode.common.types);
    types[2] = types[0]; types[2].id = box_id; types[2].kind = .value; types[2].name = "Box"; types[2].members = &.{@enumFromInt(0)};
    fixture.program.tables.mode.common.types = &types;
    var bindings: [7]CaptureAdapterFixture.Storage.CommonBinding = undefined; @memcpy(bindings[0..2], &fixture.bindings);
    bindings[2] = bindings[0]; bindings[2].id = "consumer-box"; bindings[2].name = "consumer-box"; bindings[2].owner = .{ .param = @enumFromInt(1) }; bindings[2].scope = @enumFromInt(1); bindings[2].@"type" = @enumFromInt(2); bindings[2].carrier = .{ .@"type" = @enumFromInt(2) };
    bindings[3] = bindings[0]; bindings[3].id = "creator-p"; bindings[3].name = "creator-p"; bindings[3].owner = .{ .param = @enumFromInt(2) }; bindings[3].scope = @enumFromInt(2);
    bindings[4] = bindings[3]; bindings[4].id = "creator-q"; bindings[4].name = "creator-q";
    bindings[5] = bindings[0]; bindings[5].id = "caller-q"; bindings[5].name = "caller-q";
    bindings[6] = .{ .id = "box-field", .owner = .{ .field = @enumFromInt(0) }, .name = "field", .@"type" = @enumFromInt(0), .writable = true, .origin = anchor, .carrier = .{ .@"type" = @enumFromInt(0) }, .scope = null, .declaration_kind = null };
    const common = &fixture.program.tables.mode.common; common.storage.bindings = &bindings;
    common.storage.payload = .{ .byte_size = 16, .alignment = 8, .reference_count = 1 };
    common.members.fields = &.{.{ .id = field_id, .owner = @enumFromInt(2), .ordinal = 0, .name = "field", .@"type" = @enumFromInt(0), .declared_type = @enumFromInt(0), .readonly = false, .optional = false, .access = .public, .origin = anchor, .binding = @enumFromInt(6) }};
    common.storage.concrete = &.{
        .{ .@"type" = @enumFromInt(0), .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = .{ .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} } },
        .{ .@"type" = @enumFromInt(1), .carrier = .{ .layout = .{ .byte_size = 40, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{} }, .body = null },
        .{ .@"type" = @enumFromInt(2), .carrier = .{ .layout = .{ .byte_size = 8, .alignment = 8, .reference_count = 1 }, .field_offsets = &.{0} }, .body = .{ .byte_size = 8, .alignment = 8, .reference_count = 1, .fields = &.{.{ .field = @enumFromInt(0), .binding = @enumFromInt(6), .offset = 0, .reference_offset = 0 }} } },
    };
    common.members.constructions = &.{
        .{ .id = @splat(0x30), .owner = @enumFromInt(0), .function = null, .kind = .@"implicit-base", .origin = anchor, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = @enumFromInt(0) }, .source_signature = .{ .id = @splat(0x30), .origin = anchor }, .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public },
        .{ .id = @splat(0x31), .owner = @enumFromInt(2), .function = null, .kind = .@"implicit-base", .origin = anchor, .parameters = &.{}, .signature = .{ .parameters = &.{}, .return_type = @enumFromInt(2) }, .source_signature = .{ .id = @splat(0x31), .origin = anchor }, .implicit_forward = null, .initialization_phase = .@"before-body", .initialization_fields = &.{}, .access = .public },
    };
    common.exceptions.scopes = &.{ .{ .owner = @enumFromInt(0), .path = &.{} }, .{ .owner = @enumFromInt(1), .path = &.{} }, .{ .owner = @enumFromInt(2), .path = &.{} } };
    common.exceptions.bindings = &.{ .{ .binding = @enumFromInt(0), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(1), .scope = @enumFromInt(0) }, .{ .binding = @enumFromInt(2), .scope = @enumFromInt(1) }, .{ .binding = @enumFromInt(3), .scope = @enumFromInt(2) }, .{ .binding = @enumFromInt(4), .scope = @enumFromInt(2) }, .{ .binding = @enumFromInt(5), .scope = @enumFromInt(0) } };
    fixture.abis[0].parameters = &.{ @enumFromInt(0), @enumFromInt(5) }; fixture.abis[0].argument_types = &.{ @enumFromInt(0), @enumFromInt(0) }; fixture.abis[0].physical_parameters = &.{ .{ .@"type" = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } };
    fixture.abis[1].parameters = &.{@enumFromInt(2)}; fixture.abis[1].argument_types = &.{@enumFromInt(2)}; fixture.abis[1].physical_parameters = &.{ .{ .environment = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(2) } }; fixture.abis[1].result = @enumFromInt(2); fixture.abis[1].result_carrier = .{ .@"type" = @enumFromInt(2) };
    fixture.abis[2].parameters = &.{ @enumFromInt(3), @enumFromInt(4) }; fixture.abis[2].argument_types = &.{ @enumFromInt(0), @enumFromInt(0) }; fixture.abis[2].physical_parameters = &.{ .{ .@"type" = @enumFromInt(0) }, .{ .@"type" = @enumFromInt(0) } }; fixture.abis[2].result = @enumFromInt(2); fixture.abis[2].result_carrier = .{ .@"type" = @enumFromInt(2) };
    const registers = [_]@import("wire-program-model.zig").Register{ .{ .carrier = .{ .environment = @enumFromInt(0) }, .view = null }, .{ .carrier = .{ .@"type" = @enumFromInt(2) }, .view = @enumFromInt(2) } };
    fixture.functions[1].registers = &registers;
    fixture.functions[1].blocks = &.{.{ .parameters = &.{ @enumFromInt(0), @enumFromInt(1) }, .instructions = &.{
        .{ .source = anchor, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } },
        .{ .source = anchor, .result = null, .operands = &.{@enumFromInt(1)}, .data = .@"return" },
    } }};
    var permissions: [2]CaptureAdapterFixture.ParameterRow = .{ fixture.parameter[0], .{ .index = 1, .read = false, .write = false, .structural = false } };
    fixture.contracts[0].upper.parameters = &permissions;
    fixture.contracts[1].upper.parameters = &.{.{ .index = 0, .read = false, .write = true, .structural = false }};
    fixture.contracts[2].upper.parameters = &.{ .{ .index = 0, .read = false, .write = false, .structural = false }, .{ .index = 1, .read = false, .write = false, .structural = false } };
    fixture.contracts[2].upper.facets.may_throw = true;
    for (&fixture.contracts) |*row| { row.upper.facets.managed_reference = true; row.upper.facets.escape = true; row.upper.facets.allocation = true; }
    const identity = origin_model.Graph{ .nodes = &.{ .{ .environment_input = .{ .layout = env_text } }, .{ .parameter = .{ .@"type" = box_text, .index = 0 } } }, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{} }, .accesses = &.{} };
    const creator = origin_model.Graph{
        .nodes = &.{ .{ .parameter = .{ .@"type" = ref_text, .index = 0 } }, .{ .parameter = .{ .@"type" = ref_text, .index = 1 } }, .{ .local = .{ .@"type" = box_text } } },
        .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "field:" ++ field_text, .view = box_text, .values = &.{0}, .control = 0, .initialize = true } }, .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "field:" ++ field_text, .view = box_text, .values = &.{1}, .control = 0, .initialize = true } } },
        .controls = &.{.entry}, .calls = &.{}, .normal = &.{2}, .language = &.{2}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{.{ .heap = 2, .control = 0 }} }, .accesses = &.{},
    };
    fixture.contracts[1].return_origins = identity; fixture.contracts[2].return_origins = creator;
    const ScopeFunction = std.meta.Child(@FieldType(publication.StableScope, "functions")); var scope_functions: [3]ScopeFunction = undefined;
    for (&scope_functions, 0..) |*row, index| row.* = .{ .function_id = fixture.functions[index].id, .signature_hash = fixture.functions[index].signature, .kind = .source,
        .decl_key = .{ .kind = .function, .name = if (index == 0) "caller" else if (index == 1) "consumer" else "creator", .path = &.{}, .source_path = fixture.program.tables.sources[0].path },
        .parameter_types = if (index == 1) &.{box_id} else &.{ ref_id, ref_id }, .return_type = if (index == 0) ref_id else box_id, .construction = null,
        .lexical_parent = if (index == 1) fixture.functions[0].id else null, .lexical_environment = if (index == 1) @as(t.Hash, @splat(0x77)) else null, .activation_environment = if (index == 0) @as(t.Hash, @splat(0x77)) else null, .captures = &.{}, .access = .public,
    };
    var scope = std.mem.zeroes(publication.StableScope); scope.root_file = fixture.program.tables.sources[0].path; scope.functions = &scope_functions;
    scope.types = &.{
        .{ .id = ref_id, .label = "Ref", .shape = .{ .nominal = .{ .kind = .reference, .label = "Ref", .base = null, .construction = .{ .access = .public, .parameters = &.{}, .return_type = "Ref", .argument_signature = null }, .fields = &.{}, .methods = null } } },
        .{ .id = fn_id, .label = "Fn", .shape = .{ .function = .{ .kind = .function, .label = "Fn", .parameters = &.{"Box"}, .return_type = "Box" } } },
        .{ .id = box_id, .label = "Box", .shape = .{ .nominal = .{ .kind = .value, .label = "Box", .base = null, .construction = .{ .access = .public, .parameters = &.{}, .return_type = "Box", .argument_signature = null }, .fields = &.{.{ .access = .public, .index = 0, .name = "field", .readonly = false, .@"type" = "Ref" }}, .methods = null } } },
    };
    scope.environments = &.{.{ .id = @splat(0x77), .owner = fixture.functions[0].id, .parent = null, .slots = &.{.{ .key = @splat(0x55), .kind = .local, .@"type" = ref_id, .writable = true }} }};
    scope.constructions = &.{ .{ .id = @splat(0x30), .owner = ref_id, .base = null, .kind = .@"implicit-base", .function_id = null }, .{ .id = @splat(0x31), .owner = box_id, .base = null, .kind = .@"implicit-base", .function_id = null } };
    const fixed = &common.authority.fixed_publication; fixed.stable_scope = scope; fixed.publication.scope = scope;
    fixed.dependencies = &.{ .{ .function_id = fixture.functions[0].id, .callees = &.{ .{ .function_id = fixture.functions[1].id, .digest = fixture.contracts[1].digest }, .{ .function_id = fixture.functions[2].id, .digest = fixture.contracts[2].digest } }, .hosts = &.{} }, .{ .function_id = fixture.functions[1].id, .callees = &.{}, .hosts = &.{} }, .{ .function_id = fixture.functions[2].id, .callees = &.{}, .hosts = &.{} } };
    var concrete: [3]?usize = .{ 0, 1, 2 }; fixture.collector.concrete = &concrete;
    var managed: [3]Managed = .{ .empty, .empty, .empty }; fixture.collector.managed = &managed;
    var arena = std.heap.ArenaAllocator.init(fixture.c.allocator); defer arena.deinit(); var budget = origin_model.Budget{ .context = &fixture.c, .charge = publication_refs.graphCharge };
    try @import("wire-program-layout-check.zig").check(&fixture.c);
    const directory = try publication_refs.returnOriginDirectory(&fixture.c, arena.allocator(), fixed.*); try origin_model.validateDirectory(fixture.c.allocator, &directory, &budget);
    try std.testing.expect((try origin_model.validateGraph(fixture.c.allocator, &directory, creator_text, &creator, &budget)) == .valid);
    try std.testing.expect((try origin_model.validateGraph(fixture.c.allocator, &directory, consumer_text, &identity, &budget)) == .valid);
    var graph = UpperGraph{ .collector = &fixture.collector, .function = @enumFromInt(0) }; const physical = try graph.physicalFields(arena.allocator(), &directory);
    const rows = [_]fixed_owners.Fixed{ .{ .function_id = consumer_text, .graph = &identity, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false }, .{ .function_id = creator_text, .graph = &creator, .parameters = &.{ .{}, .{} }, .captures = &.{}, .may_throw = true } };
    var analysis = try fixed_owners.analyze(fixture.c.allocator, &directory, physical, creator_text, &creator, &rows, &budget); defer analysis.deinit(); try std.testing.expectEqual(@as(?fixed_owners.Pending, null), analysis.pending);
    var initial = try UpperState.init(&fixture.c, 5); defer initial.deinit(&fixture.c); _ = try initial.values[0].add(&fixture.c, .{ .parameter = 0 }); _ = try initial.values[2].add(&fixture.c, .{ .parameter = 1 });
    const parent = effect_env.Origin{ .layout = @enumFromInt(0), .source = .{ .birth = @enumFromInt(1) } }; _ = try initial.values[1].environments.direct.add(&fixture.c, parent); try initial.store(&fixture.c, .{ .binding = @enumFromInt(1), .environment = parent }, &initial.values[0]);
    _ = try fixture.collector.consumeUpper(@enumFromInt(0), @enumFromInt(2));
    const creator_op = model.instruction.Instruction{ .source = anchor, .result = @enumFromInt(4), .operands = &.{ @enumFromInt(0), @enumFromInt(2) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(2), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var normal = try UpperState.clone(&fixture.c, &initial); defer normal.deinit(&fixture.c); var language = try UpperState.clone(&fixture.c, &initial); defer language.deinit(&fixture.c);
    for ([_]*UpperState{ &normal, &language }, 0..) |state, completion| {
        var exporter = FixedExport{ .g = &graph, .analysis = &analysis, .target = @enumFromInt(2), .op = creator_op, .offset = 0, .saved = &initial, .destination = state, .invocation = .{ .caller = @enumFromInt(0), .block = @enumFromInt(0), .instruction = 0, .target = @enumFromInt(2) }, .allocator = arena.allocator(), .environments = &.{}, .completion = @enumFromInt(completion) };
        var value = try exporter.exportValue(if (completion == 0) analysis.normal[0] else analysis.language[0]); defer value.deinit(fixture.c.allocator); try state.values[4].replace(&fixture.c, &value);
        var field: Owners = .{}; defer field.deinit(fixture.c.allocator); try graph.selectPayload(state, &state.values[4], @enumFromInt(2), @enumFromInt(0), &field);
        try std.testing.expectEqual(@as(usize, 1), field.items.items.len); try std.testing.expect(field.items.items[0] == .parameter and field.items.items[0].parameter == completion);
    }
    var copy: Owners = .{}; defer copy.deinit(fixture.c.allocator); try graph.copyPayload(&normal, @enumFromInt(3), &normal.values[4], &copy); try normal.values[3].replace(&fixture.c, &copy);
    try std.testing.expect(!std.meta.eql(normal.values[4].payloads.items.items[0], copy.payloads.items.items[0]));
    try graph.storePayload(&normal, &normal.values[4], @enumFromInt(2), @enumFromInt(0), &normal.values[2], false);
    var copy_field: Owners = .{}; defer copy_field.deinit(fixture.c.allocator); try graph.selectPayload(&normal, &normal.values[3], @enumFromInt(2), @enumFromInt(0), &copy_field);
    try std.testing.expectEqual(@as(usize, 1), copy_field.items.items.len); try std.testing.expect(copy_field.items.items[0] == .parameter and copy_field.items.items[0].parameter == 0);
    const consume_op = model.instruction.Instruction{ .source = anchor, .result = null, .operands = &.{ @enumFromInt(1), @enumFromInt(3) }, .data = .{ .eh_invoke = .{ .callee = @enumFromInt(1), .normal = @enumFromInt(0), .exceptional = @enumFromInt(0) } } };
    var saved_normal = try UpperState.clone(&fixture.c, &normal); defer saved_normal.deinit(&fixture.c); var returned: Owners = .{}; defer returned.deinit(fixture.c.allocator); var thrown: Owners = .{}; defer thrown.deinit(fixture.c.allocator); var completions: UpperCompletions = .{}; defer completions.deinit(&fixture.c);
    try graph.consume(@enumFromInt(1), consume_op, &normal, &saved_normal, 1, false, &returned, &thrown, &completions); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    var after: Owners = .{}; defer after.deinit(fixture.c.allocator); try graph.selectPayload(&normal, &returned, @enumFromInt(2), @enumFromInt(0), &after); try std.testing.expectEqual(@as(usize, 1), after.items.items.len); try std.testing.expect(after.items.items[0] == .parameter and after.items.items[0].parameter == 0);
    const language_op = model.instruction.Instruction{ .source = anchor, .result = null, .operands = &.{ @enumFromInt(1), @enumFromInt(4) }, .data = consume_op.data };
    var saved_language = try UpperState.clone(&fixture.c, &language); defer saved_language.deinit(&fixture.c);
    try std.testing.expectError(error.InvalidShape, graph.consume(@enumFromInt(1), language_op, &language, &saved_language, 1, false, &returned, &thrown, &completions));
    permissions[0].write = false; permissions[1].write = true;
    var language_return: Owners = .{}; defer language_return.deinit(fixture.c.allocator);
    try graph.consume(@enumFromInt(1), language_op, &language, &saved_language, 1, false, &language_return, &thrown, &completions); try std.testing.expect(!fixture.collector.fixed_upper_origin_pending);
    var last: Owners = .{}; defer last.deinit(fixture.c.allocator); try graph.selectPayload(&language, &language_return, @enumFromInt(2), @enumFromInt(0), &last); try std.testing.expectEqual(@as(usize, 1), last.items.items.len); try std.testing.expect(last.items.items[0] == .parameter and last.items.items[0].parameter == 1);
}
