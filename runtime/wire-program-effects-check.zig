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
    fn known(self: *const Owners) bool { return self.nonowning or self.items.items.len != 0; }
    fn deinit(self: *Owners, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.environments.deinit(allocator); self.* = .{}; }
    fn add(self: *Owners, c: *Context, owner: Owner) Error!bool {
        // A lexical permission root says nothing about its value's code/env.
        for (self.items.items) |old| { try c.step(); if (std.meta.eql(old, owner)) return false; }
        try c.step(); try self.items.append(c.allocator, owner); return true;
    }
    fn makeOpaque(self: *Owners, c: *Context) Error!bool {
        const changed = !self.environments.callable_unknown or !self.environments.direct.unknown;
        self.environments.callable_unknown = true; self.environments.direct.unknown = true;
        return (try self.add(c, .unresolved)) or changed;
    }
    fn clone(c: *Context, source: *const Owners) Error!Owners {
        try c.charge(source.items.items.len + 1); var result = Owners{ .nonowning = source.nonowning };
        errdefer result.deinit(c.allocator); result.environments = try effect_env.Value.clone(c, &source.environments);
        try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    fn join(self: *Owners, c: *Context, incoming: *const Owners) Error!bool {
        try c.step(); var changed = try self.environments.join(c, &incoming.environments);
        changed = (incoming.nonowning and !self.nonowning) or changed; self.nonowning = self.nonowning or incoming.nonowning;
        for (incoming.items.items) |owner| changed = (try self.add(c, owner)) or changed;
        return changed;
    }
    fn replace(self: *Owners, c: *Context, source: *const Owners) Error!void {
        const replacement = try Owners.clone(c, source); self.deinit(c.allocator); self.* = replacement;
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
const UpperCompletions = struct { language: bool = false };
// A logical Cell has no receiver; a private field uses its original SSA
// allocation handle. A closed same-block Cell protocol can share that key.
// Neither key is an ObjectID or dynamic version: storage is still lexical.
const OwnerSlot = struct { binding: t.BindingRef, receiver: ?t.RegisterRef = null, environment: ?effect_env.Origin = null };
const UpperState = struct {
    values: []Owners,
    slots: std.AutoHashMapUnmanaged(OwnerSlot, Owners) = .empty,
    parents: std.AutoHashMapUnmanaged(effect_env.Origin, effect_env.Set) = .empty,
    fn init(c: *Context, registers: usize) Error!UpperState {
        try c.charge(registers + 1);
        const values = try c.allocator.alloc(Owners, registers); errdefer c.allocator.free(values); @memset(values, .{});
        return .{ .values = values };
    }
    fn deinit(self: *UpperState, c: *Context) void {
        for (self.values) |*value| value.deinit(c.allocator); c.allocator.free(self.values);
        var entries = self.slots.valueIterator(); while (entries.next()) |value| value.deinit(c.allocator); self.slots.deinit(c.allocator);
        var parents = self.parents.valueIterator(); while (parents.next()) |value| value.deinit(c.allocator); self.parents.deinit(c.allocator);
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
        return changed;
    }
    fn store(self: *UpperState, c: *Context, slot: OwnerSlot, value: *const Owners) Error!void {
        try c.step(); const destination = try self.slots.getOrPut(c.allocator, slot);
        if (!destination.found_existing) destination.value_ptr.* = .{};
        try destination.value_ptr.replace(c, value);
    }
    fn birth(self: *UpperState, c: *Context, handle: t.RegisterRef, layout: t.EnvironmentRef, parent: *const effect_env.Set) Error!void {
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
};

// Equivalent seam to C++ GraphEffects, not a second actual interpreter. Every
// normal edge and both conditional edges are considered. A complete callee
// upper opens the language edge even when the actual callee never threw.
// Rebind one immutable Graph5 result into the existing lexical OWNER domain.
// Only enum directory references and copied owner/parent/slot sets escape the
// temporary Analysis. No Actual object, callee register or arena pointer does.
const FixedExport = struct {
    g: *UpperGraph, analysis: *const fixed_owners.Analysis, target: t.FunctionRef,
    op: model.instruction.Instruction, offset: usize, saved: *const UpperState,
    destination: *UpperState, invocation: effect_env.Invocation,
    allocator: std.mem.Allocator, environments: []effect_env.Set,
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
        }
        return result;
    }
    fn exportValue(self: *FixedExport, id: usize) Error!Owners {
        const c = self.g.collector.c; try c.step(); const node = self.analysis.locations[id];
        var result = try self.root(node.owner); errdefer result.deinit(c.allocator);
        if (node.owner == .local and node.kind != .code and node.kind != .environment_local) {
            // Ordinary aggregate contents are not yet persisted in UpperState.
            // A local Array/Value/Reference may contain p/G/Code+ENV; exporting
            // only Local would silently erase that relation before a later
            // full-parameter write. Keep that capability explicitly opaque.
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
        if ((node.kind == .projection or node.kind == .copied) and !direct_capture) {
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
        for (self.analysis.locations, 0..) |node, index| {
            try c.step(); if (node.layout == null) continue;
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
        const heaps = [_][]const fixed_owners.Address{ self.analysis.normal_heap, self.analysis.language_heap };
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
            if (capture.read) try self.mark(&projected, .read);
            if (capture.write) try self.mark(&projected, .write);
            if (capture.structural) try self.mark(&projected, .structural);
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
                if (foreign) _ = try loaded.environments.join(c, &value.environments) else _ = try loaded.join(c, value);
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
    fn fixedOwnersGraph(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, saved: *const UpperState, destination: *UpperState, offset: usize, full: *const publication.EffectUpper, directory: *const origin_model.Directory, function_id: origin_model.Symbol, graph: *const origin_model.Graph, budget: *origin_model.Budget, allocator: std.mem.Allocator, receiver: ?*const construction_origins.Analysis, returned: *Owners, thrown: *Owners) Error!bool {
        const c = self.collector.c; const publication_rows = self.collector.common().authority.fixed_publication.publication.contracts;
        try c.charge(publication_rows.len + 1); const rows = try allocator.alloc(fixed_owners.Fixed, publication_rows.len);
        for (publication_rows, rows) |*row, *into| {
            try c.charge(row.upper.parameters.len + row.upper.captures.len + 2);
            const parameters = try allocator.alloc(fixed_owners.Flags, row.upper.parameters.len);
            for (row.upper.parameters, parameters) |flags, *parameter| { try c.step(); parameter.* = .{ .read = flags.read, .write = flags.write, .structural = flags.structural }; }
            const captures = try allocator.alloc(fixed_owners.Capture, row.upper.captures.len);
            for (row.upper.captures, captures) |capture, *entry| { try c.step(); entry.* = .{ .key = try publication_refs.symbol(c, allocator, capture.slot), .flags = .{ .read = capture.read, .write = capture.write, .structural = capture.structural } }; }
            into.* = .{ .function_id = try publication_refs.symbol(c, allocator, row.function_id), .graph = if (row.return_origins) |*value| value else null, .parameters = parameters, .captures = captures, .may_throw = row.upper.facets.may_throw };
        }
        const physical = try self.physicalFields(allocator, directory);
        var analysis = (if (receiver) |flow|
            fixed_owners.analyzeReceiver(c.allocator, directory, physical, function_id, graph, rows, budget, flow)
        else fixed_owners.analyze(c.allocator, directory, physical, function_id, graph, rows, budget)) catch |err| return publication_refs.graphFailure(err);
        defer analysis.deinit();
        if (analysis.pending != null or (full.facets.may_throw and !analysis.language_live)) return self.noFixedBodyProof(full, returned, thrown);
        const invocation = effect_env.Invocation{ .caller = self.function, .block = self.block, .instruction = self.instruction, .target = target };
        // All incoming source relationships are borrowed from the pre-call
        // snapshot. Expire the old graph at this site before installing its
        // newly derived parent/slot/code relationships as one namespace.
        try destination.fixedBirth(c, invocation);
        try c.charge(analysis.locations.len + 1); const environments = try c.allocator.alloc(effect_env.Set, analysis.locations.len); @memset(environments, .{});
        defer { for (environments) |*environment_set| environment_set.deinit(c.allocator); c.allocator.free(environments); }
        var export_graph = FixedExport{ .g = self, .analysis = &analysis, .target = target, .op = op, .offset = offset, .saved = saved, .destination = destination, .invocation = invocation, .allocator = allocator, .environments = environments };
        if (!try export_graph.initialize()) return self.noFixedBodyProof(full, returned, thrown);
        for (analysis.effects) |effect| {
            var projected = try export_graph.root(effect.root); defer projected.deinit(c.allocator);
            try self.mark(&projected, switch (effect.flag) { .read => .read, .write => .write, .structural => .structural });
        }
        const outputs = [_][]const usize{ analysis.normal, analysis.language }; const into = [_]*Owners{ returned, thrown };
        const live = [_]bool{ analysis.normal_live, analysis.language_live };
        for (outputs, into, live) |values, owners, reachable| {
            try c.step(); if (!reachable) continue;
            if (values.len == 0) owners.nonowning = true;
            for (values) |id| { var value = try export_graph.exportValue(id); defer value.deinit(c.allocator); _ = try owners.join(c, &value); }
        }
        return true;
    }
    fn fixedGraphSummary(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, destination: *UpperState, offset: usize, full: *const publication.EffectUpper, returned: *Owners, thrown: *Owners) Error!bool {
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
        try c.charge(fixed.publication.contracts.len + 1);
        const contracts = try arena.allocator().alloc(structural_origins.FixedContract, fixed.publication.contracts.len);
        for (fixed.publication.contracts, contracts) |*row, *entry| {
            try c.step(); entry.* = .{ .function_id = try publication_refs.symbol(c, arena.allocator(), row.function_id), .graph = if (row.return_origins) |*value| value else null };
        }
        const function_id = try publication_refs.symbol(c, arena.allocator(), c.program.functions[@intFromEnum(target)].id);
        // Body is independently derived ONLY from the current owned SSA/ABI.
        // The immutable complete fixed contract vector is solely the upper.
        const coverage = structural_origins.covered(c.allocator, &directory, function_id, &body.graph.?, contracts, &budget) catch |err| return publication_refs.graphFailure(err);
        if (coverage == .pending) return self.noFixedBodyProof(full, returned, thrown);
        if (!receiver) return self.fixedOwnersGraph(target, op, state, destination, offset, full, &directory, function_id, graph, &budget, arena.allocator(), null, returned, thrown);
        // Receiver return interpretation is owned by the independently checked
        // construction-frame protocol. It is not selected actual entrances or
        // the cached effect proof. Complete current-body inclusion above stays
        // mandatory before any immutable fixed return value is consumed.
        if (receiver) {
            try c.charge(2); const target_function = c.program.functions[@intFromEnum(target)];
            if (target_function.role != .construction_body or collector.common().abis[@intFromEnum(target_function.abi)].construction == null) return self.noFixedBodyProof(full, returned, thrown);
        }
        var analysis = construction_origins.analyzeReturns(c.allocator, &directory, graph, &budget, function_id) catch |err| return publication_refs.graphFailure(err);
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
        return self.fixedOwnersGraph(target, op, state, destination, offset, full, &directory, function_id, graph, &budget, arena.allocator(), &analysis, returned, thrown);
    }
    fn consume(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *UpperState, incoming: *const UpperState, offset: usize, prefix: bool, returned: *Owners, thrown: *Owners, completions: *UpperCompletions) Error!void {
        const collector = self.collector; const c = collector.c;
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
            if (access_mode.read) try self.mark(argument, .read);
            if (access_mode.write) try self.mark(argument, .write);
            if (access_mode.structural) try self.mark(argument, .structural);
        };
        // Complete declared writes revoke PRE-call selected contents on both
        // continuations. Fixed return relationships are then installed from
        // their immutable graph using the saved pre-call input, so a returned
        // activation is not accidentally revoked as an old captured value.
        for (full.captures) |captured| {
            try c.step(); if (!captured.write) continue;
            for (collector.captures, 0..) |slot, id| {
                try c.step(); const found = slot orelse continue;
                const key = collector.common().closures.environments[@intFromEnum(found.environment)].slots[@intFromEnum(found.slot)].key;
                if (std.mem.eql(u8, &key, &captured.slot)) try state.dirtyCapture(c, @enumFromInt(id));
            }
        }
        if (full.facets.unknown_host or full.facets.@"await") try state.dirtyEnvironments(c);
        const fixed = try self.fixedGraphSummary(target, op, incoming, state, offset, full, returned, thrown);
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
        }
    }
    fn consumeAlternative(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, input: *const UpperState, alternatives: *?UpperState, offset: usize, prefix: bool, returned: *Owners, thrown: *Owners, completions: *UpperCompletions) Error!void {
        const c = self.collector.c; var branch = try UpperState.clone(c, input); var owns = true; defer if (owns) branch.deinit(c);
        try self.consume(target, op, &branch, input, offset, prefix, returned, thrown, completions);
        if (alternatives.*) |*old| _ = try old.join(c, &branch) else { alternatives.* = branch; owns = false; }
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
                control_analysis = construction_origins.analyzeControls(c.allocator, &directory, &control_body.?.graph.?, &budget, function_id) catch |err| return publication_refs.graphFailure(err);
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
                        } else {
                            try result.replace(c, &state.values[@intFromEnum(receiver)]);
                            _ = try result.makeOpaque(c);
                        }
                    },
                    .domain_array_read => {
                        try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); try self.mark(&result, .read);
                        // A fresh container has no external receiver root, but
                        // a loaded element/field can still alias p, G or a
                        // capture. No selected-content alias proof exists in
                        // this owner-only domain. Keep that absence explicit,
                        // including when the loaded value later becomes a
                        // callable or is transported through Cells/env slots.
                        _ = try result.makeOpaque(c);
                    },
                    .domain_array_length => { try self.mark(&state.values[@intFromEnum(op.operands[0])], .read); result.nonowning = true; },
                    .domain_field_store => |write| {
                        try self.mark(&state.values[@intFromEnum(op.operands[0])], .write);
                        if (self.privateField(op.operands[0], write.member)) |slot| try state.store(c, slot, &state.values[@intFromEnum(op.operands[1])]);
                    },
                    .eh_field_initialize => |write| {
                        // Legality/phase/anchors remain the existing upstream
                        // construction duty. Track only the actual operand's
                        // lexical roots; private storage grants no 81 privilege.
                        if (self.privateField(op.operands[0], write.field)) |slot| try state.store(c, slot, &state.values[@intFromEnum(op.operands[1])]);
                    },
                    .receiver_create,.receiver_child,.initialize_begin,.initialize_end => { result.nonowning=true; },
                    .receiver_allocate => {
                        _=try result.add(c,.local);
                        if(!self.summarizing) { try collector.facet(self.function,.allocation); try collector.facet(self.function,.managed_reference); }
                    },
                    .initialize_field => {
                        // Consume the same complete prefix-field evidence as
                        // the actual observer, then retain the lexical access.
                        if(!self.summarizing and !try collector.receiverField(self.function,b,index))collector.fixed_upper_origin_pending=true;
                        try self.mark(&state.values[@intFromEnum(op.operands[1])],.write); result.nonowning=true;
                    },
                    .domain_array_store, .domain_array_resize => { const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .write); try self.mark(receiver, .structural); },
                    .domain_view, .domain_refine, .domain_copy, .domain_read_span, .eh_assertion, .eh_presence_widen => try result.replace(c, &state.values[@intFromEnum(op.operands[0])]),
                    .eh_pack => { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing) try collector.facet(self.function, .eh_control); },
                    .eh_carrier => |view| { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing and view == null) try collector.facet(self.function, .eh_control); },
                    .function_make => {
                        if (op.operands.len == 0) result.nonowning = true else {
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
                    .common_typed_array_create, .string_concat => {
                        _ = try result.add(c, .local);
                        if (!self.summarizing) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .eh_construct => |data| {
                        _ = try result.add(c, .local);
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
                            .reference, .value, .string, .array, .readSpan => _ = try result.add(c, .local),
                            else => _ = try result.makeOpaque(c),
                        }
                        if (!self.summarizing and v.types[@intFromEnum(data.actual_type)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .eh_enter => if (!self.summarizing) { try collector.facet(self.function, .eh_control); },
                    .authorized_host => {
                        if (!self.summarizing) try collector.hostEffects(self.function);
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
                                    .allocation, .language_error => { _ = try into.add(c, .local); },
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
                        var completions: UpperCompletions = .{}; var found = false;
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
                            completions = .{ .language = true };
                            _ = try returned.makeOpaque(c); _ = try thrown.makeOpaque(c);
                        }
                        const normal = switch (op.data) { .eh_invoke => |call| call.normal, .eh_invoke_indirect => |call| call.normal, .common_method_invoke => |call| call.normal, else => unreachable };
                        const exceptional = switch (op.data) { .eh_invoke => |call| call.exceptional, .eh_invoke_indirect => |call| call.exceptional, .common_method_invoke => |call| call.exceptional, else => unreachable };
                        // GraphEffects normal control is unconditional. Only
                        // the RESULT may be bottom; an ignored result cannot
                        // gate independently computed caller data/effects.
                        try self.edge(entries, queued, &pending, normal, &state, if (function.blocks[@intFromEnum(normal)].parameters.len == 0) &.{} else &.{returned});
                        if (completions.language) try self.edge(entries, queued, &pending, exceptional, &state, &.{thrown});
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
        try self.c.require(try graph.fixedGraphSummary(@enumFromInt(1), op, state, state, if (indirect) 1 else 0, full, &returned, &thrown));
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

test "a returned local Array with parameter contents stays pending at a later full parameter write" {
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
    try graph.consume(@enumFromInt(1), op, &state, &saved, 1, false, &returned, &thrown, &completions);
    try std.testing.expect(fixture.collector.fixed_upper_origin_pending);
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
    var receiver = try construction_origins.analyzeReturns(fixture.c.allocator, &dto.directory, &dto.graph, &budget, dto.constructor); defer receiver.deinit();
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
    try std.testing.expect(try graph.fixedOwnersGraph(@enumFromInt(2), creator_op, &incoming, &state, 1, full, &dto.directory, dto.constructor, &dto.graph, &budget, arena.allocator(), &receiver, &returned, &thrown));
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
        try std.testing.expectError(error.InvalidShape, graph.fixedOwnersGraph(@enumFromInt(2), creator_op, &incoming, &destination, 1, full, &dto.directory, dto.constructor, &dto.graph, &budget, arena.allocator(), &receiver, &rejected, &rejected_throw));
        @field(fixture.parameter[0], flag) = true;
    }
}
