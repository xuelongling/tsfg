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
    fn known(self: *const Owners) bool { return self.nonowning or self.items.items.len != 0; }
    fn deinit(self: *Owners, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.* = .{}; }
    fn add(self: *Owners, c: *Context, owner: Owner) Error!bool {
        for (self.items.items) |old| { try c.step(); if (std.meta.eql(old, owner)) return false; }
        try c.step(); try self.items.append(c.allocator, owner); return true;
    }
    fn clone(c: *Context, source: *const Owners) Error!Owners {
        try c.charge(source.items.items.len + 1); var result = Owners{ .nonowning = source.nonowning };
        errdefer result.deinit(c.allocator); try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    fn join(self: *Owners, c: *Context, incoming: *const Owners) Error!bool {
        try c.step(); var changed = incoming.nonowning and !self.nonowning; self.nonowning = self.nonowning or incoming.nonowning;
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
const PrivateAggregate = struct { actual_type: t.TypeRef, concrete: usize };
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
    fn deinit(self: *AliasSummary, allocator: std.mem.Allocator) void { self.normal.deinit(allocator); self.language.deinit(allocator); self.aggregates.deinit(allocator); }
};
const AliasLink = struct { from: usize, to: usize };
const AliasVisit = struct { function: usize, next: usize = 0 };
const UpperCompletions = struct { language: bool = false };
// A logical Cell has no receiver; a private field has the single SSA receiver
// handle whose actual uses were checked below. Neither key is an ObjectID or a
// dynamic allocation/version. Both use the existing lexical OWNER fixed point.
const OwnerSlot = struct { binding: t.BindingRef, receiver: ?t.RegisterRef = null };
const UpperState = struct {
    values: []Owners,
    slots: std.AutoHashMapUnmanaged(OwnerSlot, Owners) = .empty,
    fn init(c: *Context, registers: usize) Error!UpperState {
        try c.charge(registers + 1);
        const values = try c.allocator.alloc(Owners, registers); errdefer c.allocator.free(values); @memset(values, .{});
        return .{ .values = values };
    }
    fn deinit(self: *UpperState, c: *Context) void {
        for (self.values) |*value| value.deinit(c.allocator); c.allocator.free(self.values);
        var entries = self.slots.valueIterator(); while (entries.next()) |value| value.deinit(c.allocator); self.slots.deinit(c.allocator);
    }
    fn clone(c: *Context, source: *const UpperState) Error!UpperState {
        var result = try UpperState.init(c, source.values.len); errdefer result.deinit(c);
        for (source.values, result.values) |*value, *copy| copy.* = try Owners.clone(c, value);
        var entries = source.slots.iterator(); while (entries.next()) |slot| {
            try c.step(); var copy = try Owners.clone(c, slot.value_ptr); errdefer copy.deinit(c.allocator);
            try result.slots.put(c.allocator, slot.key_ptr.*, copy);
        }
        return result;
    }
    fn join(self: *UpperState, c: *Context, source: *const UpperState) Error!bool {
        var changed = false;
        for (self.values, source.values) |*value, *incoming| changed = (try value.join(c, incoming)) or changed;
        // A Cell or private field absent on either path is uninitialized, not
        // a known local empty value. Preserve that alternative at the join.
        var previous = self.slots.iterator(); while (previous.next()) |slot| {
            try c.step(); if (!source.slots.contains(slot.key_ptr.*)) changed = (try slot.value_ptr.add(c, .unresolved)) or changed;
        }
        var entries = source.slots.iterator(); while (entries.next()) |slot| {
            try c.step(); const destination = try self.slots.getOrPut(c.allocator, slot.key_ptr.*);
            if (!destination.found_existing) {
                destination.value_ptr.* = .{}; _ = try destination.value_ptr.add(c, .unresolved); changed = true;
            }
            changed = (try destination.value_ptr.join(c, slot.value_ptr)) or changed;
        }
        return changed;
    }
    fn store(self: *UpperState, c: *Context, slot: OwnerSlot, value: *const Owners) Error!void {
        try c.step(); const destination = try self.slots.getOrPut(c.allocator, slot);
        if (!destination.found_existing) destination.value_ptr.* = .{};
        try destination.value_ptr.replace(c, value);
    }
};

// Equivalent seam to C++ GraphEffects, not a second actual interpreter. Every
// normal edge and both conditional edges are considered. A complete callee
// upper opens the language edge even when the actual callee never threw.
const UpperGraph = struct {
    collector: *Collector,
    function: t.FunctionRef,
    lexical_cells: bool = false,
    // Private analysis phase, not an admission/coverage bit. The same typed
    // transfer computes lexical summaries; only the final pass checks effects.
    summarizing: bool = false,
    changed: bool = false,
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
        const aggregates = &collector.aliases[@intFromEnum(self.function)].aggregates;
        aggregates.clearRetainingCapacity();
        for (function.blocks) |block| for (block.instructions) |op| {
            try c.step(); if (op.data != .eh_construct) continue;
            const allocation = op.data.eh_construct; const row = v.types[@intFromEnum(allocation.owner)];
            const construction = v.members.constructions[@intFromEnum(allocation.constructor)];
            // Common80 itself allocates. This first slice excludes all body
            // invocation/super/value paths: a root's inline 81 initializers are
            // still checked separately by the existing construction boundary.
            if (row.kind != .reference or row.base != null or construction.kind != .@"implicit-base" or
                construction.function != null or construction.parameters.len != 0) continue;
            const concrete = collector.concrete[@intFromEnum(allocation.owner)] orelse return error.InvalidShape;
            try aggregates.put(c.allocator, op.result.?, .{ .actual_type = allocation.owner, .concrete = concrete });
        };
        // An alias can only be made through a real operand use. In particular
        // named local/Cell or SourceBinding capture transport requires a store
        // of this value and is excluded, even if that Cell was separately
        // proved private. No relation is inferred from Source ranges or IDs.
        for (function.blocks) |block| for (block.instructions) |op| for (op.operands, 0..) |reg, index| {
            try c.step(); const aggregate = aggregates.get(reg) orelse continue;
            const allowed = index == 0 and switch (op.data) {
                .domain_field_read => |read| read.receiver_view == aggregate.actual_type and v.members.fields[@intFromEnum(read.member)].owner == aggregate.actual_type,
                .domain_field_store => |write| write.receiver_view == aggregate.actual_type and v.members.fields[@intFromEnum(write.member)].owner == aggregate.actual_type and !v.members.fields[@intFromEnum(write.member)].readonly,
                .eh_field_initialize => |write| v.members.fields[@intFromEnum(write.field)].owner == aggregate.actual_type,
                else => false,
            };
            if (!allowed) _ = aggregates.remove(reg);
        };
    }
    fn privateField(self: *UpperGraph, receiver: t.RegisterRef, field: t.FieldRef) ?OwnerSlot {
        const summary = &self.collector.aliases[@intFromEnum(self.function)];
        if (!summary.aggregates.contains(receiver)) return null;
        return .{ .binding = self.collector.common().members.fields[@intFromEnum(field)].binding, .receiver = receiver };
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
                if (incoming == null) _ = try loaded.add(c, .unresolved);
                return;
            };
            if (!self.summarizing) try collector.capture(self.function, captured.environment, captured.slot, if (incoming != null) .write else .read);
            if (incoming == null and try collector.managedType(v.storage.bindings[b].@"type")) _ = try loaded.add(c, .{ .capture = captured });
        } else if (incoming) |value| {
            const destination = try state.slots.getOrPut(c.allocator, .{ .binding = id });
            if (!destination.found_existing) destination.value_ptr.* = .{};
            if (!initialize) try self.mark(destination.value_ptr, .write);
            try destination.value_ptr.replace(c, value);
        } else if (state.slots.getPtr(.{ .binding = id })) |value| try loaded.replace(c, value) else _ = try loaded.add(c, .unresolved);
    }
    fn edge(self: *UpperGraph, entries: []?UpperState, queued: []bool, pending: *std.ArrayListUnmanaged(t.BlockRef), target: t.BlockRef, state: *const UpperState, arguments: []const Owners) Error!void {
        const c = self.collector.c; const function = c.program.functions[@intFromEnum(self.function)]; const b = @intFromEnum(target);
        const parameters = function.blocks[b].parameters; try c.require(parameters.len == arguments.len);
        var incoming = try UpperState.clone(c, state); var owns = true; defer if (owns) incoming.deinit(c);
        for (parameters, arguments) |reg, *argument| try incoming.values[@intFromEnum(reg)].replace(c, argument);
        const changed = if (entries[b]) |*old| try old.join(c, &incoming) else blk: { entries[b] = incoming; owns = false; break :blk true; };
        if (changed and !queued[b]) { queued[b] = true; try pending.append(c.allocator, target); }
    }
    fn projectSummary(self: *UpperGraph, source: *const Owners, op: model.instruction.Instruction, state: *const UpperState, offset: usize, into: *Owners) Error!void {
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
                .capture, .unresolved => _ = try into.add(c, .unresolved),
            }
        }
    }
    fn consume(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, offset: usize, prefix: bool, returned: *Owners, thrown: *Owners, completions: *UpperCompletions) Error!void {
        const collector = self.collector; const c = collector.c;
        const full = if (self.summarizing) original: {
            try c.step(); break :original collector.upper(target) orelse return error.InvalidShape;
        } else try collector.consumeUpper(self.function, target);
        if (!self.summarizing and op.data == .eh_invoke and offset != 0) for (full.captures) |captured| {
            try c.step();
            // A typed hidden env/layout identifies a lexical slot, not the
            // external aliases in this instance of that slot. No selected
            // env-content proof is supplied to this owner-only walk.
            if (captured.read or captured.write or captured.structural) collector.fixed_upper_origin_pending = true;
        };
        try c.require(offset <= op.operands.len);
        try c.require(if (prefix) full.parameters.len <= op.operands.len - offset else full.parameters.len == op.operands.len - offset);
        if (!self.summarizing) for (full.parameters, 0..) |access_mode, i| {
            try c.step(); const argument = &state.values[@intFromEnum(op.operands[offset + i])];
            if (access_mode.read) try self.mark(argument, .read);
            if (access_mode.write) try self.mark(argument, .write);
            if (access_mode.structural) try self.mark(argument, .structural);
        };
        const summary = &collector.aliases[@intFromEnum(target)];
        const project = summary.transparent and (self.summarizing or summary.available);
        if (project and (summary.normal_seen or summary.normal_missing)) {
            try self.projectSummary(&summary.normal, op, state, offset, returned);
        } else if (!self.summarizing or !summary.transparent) {
            _ = try returned.add(c, .unresolved);
        }
        if (full.facets.may_throw) {
            if (project and (summary.language_seen or summary.language_missing)) {
                try self.projectSummary(&summary.language, op, state, offset, thrown);
            } else if (!self.summarizing or !summary.transparent) {
                _ = try thrown.add(c, .unresolved);
            }
            completions.language = true;
        }
    }
    fn prepare(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)]; const abi = v.abis[@intFromEnum(function.abi)];
        const summary = &collector.aliases[@intFromEnum(self.function)];
        summary.lexical_cells = try self.proveLexicalCells();
        try self.provePrivateAggregates();
        summary.transparent = abi.lexical_environment == null;
        // This is a deliberately finite transparent seam: direct parameter /
        // global roots, scalar work, copies, phi/route, and recursive calls. The old
        // Selected content remains unresolved except the nonescaping implicit
        // root reference profile proved above. Env-instance data stays opaque.
        for (function.blocks) |block| for (block.instructions) |op| {
            try c.step(); switch (op.data) {
                .eh_cell, .eh_load, .eh_store => if (!summary.lexical_cells) { summary.transparent = false; },
                .environment_alloc, .environment_load, .environment_store,
                .environment_init, .environment_parent, .domain_array_read, .domain_array_store, .domain_array_resize,
                .common_typed_array_create, .domain_read_span => summary.transparent = false,
                .domain_field_read, .domain_field_store, .eh_field_initialize => if (!summary.aggregates.contains(op.operands[0])) { summary.transparent = false; },
                .eh_construct => if (!summary.aggregates.contains(op.result.?)) { summary.transparent = false; },
                .function_make => if (op.operands.len != 0) { summary.transparent = false; },
                .domain_literal => |data| if (v.types[@intFromEnum(data.actual_type)].kind == .reference) { summary.transparent = false; },
                else => {},
            }
        };
    }
    fn run(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)]; const abi = v.abis[@intFromEnum(function.abi)];
        const summary = &collector.aliases[@intFromEnum(self.function)];
        self.lexical_cells = summary.lexical_cells;
        try c.charge(function.blocks.len * 2 + 1);
        const entries = try c.allocator.alloc(?UpperState, function.blocks.len); @memset(entries, null);
        defer { for (entries) |*entry| if (entry.*) |*saved| saved.deinit(c); c.allocator.free(entries); }
        const queued = try c.allocator.alloc(bool, function.blocks.len); defer c.allocator.free(queued); @memset(queued, false);
        var pending: std.ArrayListUnmanaged(t.BlockRef) = .empty; defer pending.deinit(c.allocator);
        var initial = try UpperState.init(c, function.registers.len); var owns = true; defer if (owns) initial.deinit(c);
        const hidden: usize = if (abi.lexical_environment != null) 1 else 0;
        if (!self.summarizing and hidden != 0) try collector.facet(self.function, .managed_reference);
        const count = abi.parameters.len + @as(usize, if (abi.receiver != null) 1 else 0);
        for (0..count) |i| {
            try c.step(); const id = if (abi.receiver != null and i == 0) abi.receiver.? else abi.parameters[i - @as(usize, if (abi.receiver != null) 1 else 0)];
            // Alias identity also matters for a callable/scalar later returned
            // or packed as a language payload. Access permissions remain
            // managed-only in mark(), just like the actual observer.
            const owner = Owner{ .parameter = i };
            const binding_value = try initial.slots.getOrPut(c.allocator, .{ .binding = id });
            if (!binding_value.found_existing) binding_value.value_ptr.* = .{};
            _ = try binding_value.value_ptr.add(c, owner);
            _ = try initial.values[@intFromEnum(function.blocks[0].parameters[hidden + i])].add(c, owner);
            if (!self.summarizing and try collector.managedType(v.storage.bindings[@intFromEnum(id)].@"type")) {
                try collector.facet(self.function, .managed_reference);
            }
        }
        if (!self.summarizing) if (abi.result) |result| if (try collector.managedType(result)) try collector.facet(self.function, .managed_reference);
        entries[0] = initial; owns = false; queued[0] = true; try pending.append(c.allocator, @enumFromInt(0));
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const b = @intFromEnum(pending.items[cursor]); queued[b] = false;
            var state = try UpperState.clone(c, &entries[b].?); defer state.deinit(c);
            for (function.blocks[b].instructions, 0..) |op, index| {
                try c.charge(op.operands.len + 1); var result: Owners = .{}; defer result.deinit(c.allocator);
                if (!self.summarizing) if (op.result) |reg| {
                    const saved = function.registers[@intFromEnum(reg)];
                    const logical: ?t.TypeRef = saved.view orelse if (saved.carrier == .@"type") saved.carrier.@"type" else null;
                    if (logical) |id| if (try collector.managedType(id)) try collector.facet(self.function, .managed_reference);
                };
                switch (op.data) {
                    .global_load => |data| { if (!self.summarizing) try collector.global(self.function, data.global, .read); _ = try result.add(c, .{ .global = data.global }); },
                    .global_store => |data| if (!self.summarizing) { try collector.global(self.function, data.global, .write); },
                    .eh_cell => |data| {
                        const id = v.exceptions.bindings[@intFromEnum(data.binding)].binding;
                        if (state.slots.fetchRemove(.{ .binding = id })) |removed| { var old = removed.value; old.deinit(c.allocator); }
                    },
                    .eh_load => |data| {
                        try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, null, false);
                        // Only the unique, private lexical-Cell protocol above
                        // connects a dynamic handle to the lexical binding flow.
                        if (!self.lexical_cells) _ = try result.add(c, .unresolved);
                    },
                    .eh_store => |data| try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, &state.values[@intFromEnum(op.operands[1])], data.initialize),
                    inline .environment_load, .environment_store, .environment_init => |data| {
                        const env = function.registers[@intFromEnum(op.operands[0])].carrier.environment;
                        const id = v.closures.environments[@intFromEnum(env)].slots[@intFromEnum(data.slot)].binding;
                        try self.binding(&state, id, &result, if (op.data == .environment_load) null else &state.values[@intFromEnum(op.operands[1])], op.data == .environment_init);
                        if (op.data == .environment_load) _ = try result.add(c, .unresolved);
                    },
                    .environment_parent => _ = try result.add(c, .unresolved),
                    .domain_field_read => |read| {
                        const receiver = op.operands[0]; try self.mark(&state.values[@intFromEnum(receiver)], .read);
                        if (self.privateField(receiver, read.member)) |slot| {
                            if (state.slots.getPtr(slot)) |stored| try result.replace(c, stored) else _ = try result.add(c, .unresolved);
                        } else {
                            try result.replace(c, &state.values[@intFromEnum(receiver)]);
                            _ = try result.add(c, .unresolved);
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
                        _ = try result.add(c, .unresolved);
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
                    .domain_array_store, .domain_array_resize => { const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .write); try self.mark(receiver, .structural); },
                    .domain_view, .domain_refine, .domain_copy, .domain_read_span, .eh_assertion, .eh_presence_widen => try result.replace(c, &state.values[@intFromEnum(op.operands[0])]),
                    .eh_pack => { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing) try collector.facet(self.function, .eh_control); },
                    .eh_carrier => |view| { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (!self.summarizing and view == null) try collector.facet(self.function, .eh_control); },
                    .function_make => {
                        if (op.operands.len == 0) result.nonowning = true else {
                            try result.replace(c, &state.values[@intFromEnum(op.operands[0])]);
                            _ = try result.add(c, .unresolved);
                        }
                    },
                    .common_typed_array_create, .environment_alloc, .string_concat => {
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
                            else => _ = try result.add(c, .unresolved),
                        }
                        if (!self.summarizing and v.types[@intFromEnum(data.actual_type)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); }
                    },
                    .eh_enter => if (!self.summarizing) { try collector.facet(self.function, .eh_control); },
                    .authorized_host => {
                        if (!self.summarizing) try collector.hostEffects(self.function);
                        // A verified scalar result carries no external owner.
                        // Missing material remains pending, never an empty root.
                        if (collector.host_material == null) _ = try result.add(c, .unresolved) else result.nonowning = true;
                    },
                    .string_constant => _ = try result.add(c, .local),
                    .const_i32, .const_integer, .const_float, .const_bool, .add, .sub, .mul, .div, .rem,
                    .shl, .shr, .ushr, .@"and", .@"or", .xor, .neg, .not, .pos, .bool_not, .eq, .ne,
                    .lt, .le, .gt, .ge, .eh_equal => result.nonowning = true,
                    else => {},
                }
                if (op.result) |reg| try state.values[@intFromEnum(reg)].replace(c, &result);
                switch (op.data) {
                    .eh_invoke, .eh_invoke_indirect, .common_method_invoke => {
                        var completions: UpperCompletions = .{}; var found = false;
                        var returned: Owners = .{}; defer returned.deinit(c.allocator);
                        var thrown: Owners = .{}; defer thrown.deinit(c.allocator);
                        switch (op.data) {
                            .eh_invoke => |call| { const target_abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(call.callee)].abi)]; try self.consume(call.callee, op, &state, if (target_abi.lexical_environment != null) 1 else 0, false, &returned, &thrown, &completions); found = true; },
                            .common_method_invoke => |call| for (v.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| { try c.step(); const target = arm.target orelse return error.InvalidShape; try self.consume(target, op, &state, 0, true, &returned, &thrown, &completions); found = true; },
                            .eh_invoke_indirect => {
                                // A lexical alias identifies whose value this
                                // is, not that callable's captured env contents.
                                // Pure, env-free function_make has no roots;
                                // external/loaded/returned aliases grant no
                                // cross-closure instance proof here.
                                if (!self.summarizing) for (state.values[@intFromEnum(op.operands[0])].items.items) |_| {
                                    try c.step(); collector.fixed_upper_origin_pending = true;
                                };
                                for (v.closures.calls) |row| {
                                    try c.step(); if (row.function != self.function or @intFromEnum(row.block) != b or row.instruction != index) continue;
                                    for (row.targets) |target| { try c.step(); try self.consume(target, op, &state, 1, false, &returned, &thrown, &completions); found = true; }
                                }
                            },
                            else => unreachable,
                        }
                        if (!found) {
                            if (!self.summarizing) collector.fixed_upper_origin_pending = true;
                            completions = .{ .language = true };
                            _ = try returned.add(c, .unresolved); _ = try thrown.add(c, .unresolved);
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
    unresolved: bool = false,
    fixed_upper_origin_pending: bool = false,
    fixed_upper_host_pending: bool = false,
    host_binding_required: bool = false,

    // Internal typed consumer: material was fully verified by the public
    // compiled-anchor boundary with this same Context, not merely supplied.
    pub fn init(c: *Context, material: ?*const host_binding.Bundle) Error!Collector {
        if (c.program.tables.mode != .common) return error.WrongMode;
        const v = c.program.tables.mode.common;
        try c.charge(2 * c.program.functions.len + 2 * v.types.len + v.storage.bindings.len);
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
        var result = Collector{ .c = c, .host_material = material, .contracts = contracts, .concrete = concrete, .captures = captures, .managed = managed, .aliases = aliases };
        // An unreachable Host instruction still requires its original metadata
        // dependency. Its runtime effect permission follows actual replay.
        for (c.program.functions, 0..) |f, i| for (f.blocks) |block| for (block.instructions) |op| {
            try c.step(); if (op.data == .authorized_host) try result.hostMetadata(@enumFromInt(i), op.data.authorized_host.host);
        };
        return result;
    }
    pub fn deinit(self: *Collector) void {
        self.c.allocator.free(self.contracts); self.c.allocator.free(self.concrete);
        self.c.allocator.free(self.captures); self.c.allocator.free(self.managed);
        for (self.aliases) |*summary| summary.deinit(self.c.allocator); self.c.allocator.free(self.aliases);
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
        for (full.captures) |wanted| {
            try c.step(); const bound = self.upper(function) orelse continue;
            var found = false;
            for (bound.captures) |allowed| {
                try c.step(); if (!std.mem.eql(u8, &wanted.slot, &allowed.slot)) continue;
                try c.require((!wanted.read or allowed.read) and (!wanted.write or allowed.write) and (!wanted.structural or allowed.structural)); found = true; break;
            }
            try c.require(found);
        }
        return &v.authority.fixed_publication.publication.contracts[contract_index].upper;
    }
    fn consume(self: *Collector, site: facts.Site, state: facts.StateView, target: t.FunctionRef, offset: usize, prefix: bool) Error!void {
        const c = self.c; const full = try self.consumeUpper(site.location.function, target);
        const op = c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        try c.require(offset <= op.operands.len);
        try c.require(if (prefix) full.parameters.len <= op.operands.len - offset else full.parameters.len == op.operands.len - offset);
        for (full.parameters, 0..) |wanted, i| {
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
                summary.normal_missing = true; changed = (try summary.normal.add(c, .unresolved)) or changed;
            }
            if (self.upper(@enumFromInt(function))) |bound| {
                if (bound.facets.may_throw and !summary.language_seen) {
                    summary.language_missing = true; changed = (try summary.language.add(c, .unresolved)) or changed;
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
    pub fn finish(self: *Collector) FinishError!void {
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
