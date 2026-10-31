// SPDX-License-Identifier: MIT
// Passive Common actual-effects subsumption, using the one actual solver's
// final read-only replay, plus the original normalized graph's independent
// complete-upper OWNER flow. That flow never produces actual values, targets,
// allocation versions or an actual World. Origins grant no allocation proof.
// References/layout/SSA/identity, complete fixed publication/flow and independent
// implementation-bound HSC verification are separate prerequisites. The latter
// two are not supplied by today's typed checks or by two matching Host digests.
// Success checks these observations against declared bounds; it is not Host,
// Runtime, kernel, borrow, Source, fixed-flow or execution admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const publication = @import("wire-program-publication.zig");
const facts = @import("wire-program-actual-facts.zig");
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
const Owner = union(enum) { parameter: usize, global: t.GlobalRef, capture: Capture, unresolved: void };
const Owners = struct {
    items: std.ArrayListUnmanaged(Owner) = .empty,
    fn deinit(self: *Owners, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.* = .{}; }
    fn add(self: *Owners, c: *Context, owner: Owner) Error!bool {
        for (self.items.items) |old| { try c.step(); if (std.meta.eql(old, owner)) return false; }
        try c.step(); try self.items.append(c.allocator, owner); return true;
    }
    fn clone(c: *Context, source: *const Owners) Error!Owners {
        try c.charge(source.items.items.len + 1); var result: Owners = .{};
        errdefer result.deinit(c.allocator); try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    fn join(self: *Owners, c: *Context, incoming: *const Owners) Error!bool {
        var changed = false;
        for (incoming.items.items) |owner| changed = (try self.add(c, owner)) or changed;
        return changed;
    }
    fn replace(self: *Owners, c: *Context, source: *const Owners) Error!void {
        const replacement = try Owners.clone(c, source); self.deinit(c.allocator); self.* = replacement;
    }
};
const UpperState = struct {
    values: []Owners,
    bindings: std.AutoHashMapUnmanaged(t.BindingRef, Owners) = .empty,
    fn init(c: *Context, registers: usize) Error!UpperState {
        try c.charge(registers + 1);
        const values = try c.allocator.alloc(Owners, registers); errdefer c.allocator.free(values); @memset(values, .{});
        return .{ .values = values };
    }
    fn deinit(self: *UpperState, c: *Context) void {
        for (self.values) |*value| value.deinit(c.allocator); c.allocator.free(self.values);
        var cells = self.bindings.valueIterator(); while (cells.next()) |value| value.deinit(c.allocator); self.bindings.deinit(c.allocator);
    }
    fn clone(c: *Context, source: *const UpperState) Error!UpperState {
        var result = try UpperState.init(c, source.values.len); errdefer result.deinit(c);
        for (source.values, result.values) |*value, *copy| copy.* = try Owners.clone(c, value);
        var cells = source.bindings.iterator(); while (cells.next()) |cell| {
            try c.step(); var copy = try Owners.clone(c, cell.value_ptr); errdefer copy.deinit(c.allocator);
            try result.bindings.put(c.allocator, cell.key_ptr.*, copy);
        }
        return result;
    }
    fn join(self: *UpperState, c: *Context, source: *const UpperState) Error!bool {
        var changed = false;
        for (self.values, source.values) |*value, *incoming| changed = (try value.join(c, incoming)) or changed;
        var cells = source.bindings.iterator(); while (cells.next()) |cell| {
            try c.step(); const destination = try self.bindings.getOrPut(c.allocator, cell.key_ptr.*);
            if (!destination.found_existing) { destination.value_ptr.* = .{}; changed = true; }
            changed = (try destination.value_ptr.join(c, cell.value_ptr)) or changed;
        }
        return changed;
    }
};

// Equivalent seam to C++ GraphEffects, not a second actual interpreter. Every
// normal edge and both conditional edges are considered. A complete callee
// upper opens the language edge even when the actual callee never threw.
const UpperGraph = struct {
    collector: *Collector,
    function: t.FunctionRef,
    fn mark(self: *UpperGraph, owners: *const Owners, mode: Access) Error!void {
        const collector = self.collector; const c = collector.c;
        for (owners.items.items) |owner| {
            try c.step(); switch (owner) {
                .parameter => |index| {
                    const upper_bound = collector.upper(self.function) orelse continue;
                    const access_mode = upper_bound.parameters[index];
                    try c.require(switch (mode) { .read => access_mode.read, .write => access_mode.write, .structural => access_mode.structural });
                },
                .global => |id| try collector.global(self.function, id, mode),
                .capture => |slot| try collector.capture(self.function, slot.environment, slot.slot, mode),
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
            const captured = collector.captures[b] orelse { collector.fixed_upper_origin_pending = true; return; };
            try collector.capture(self.function, captured.environment, captured.slot, if (incoming != null) .write else .read);
            if (incoming == null and try collector.managedType(v.storage.bindings[b].@"type")) _ = try loaded.add(c, .{ .capture = captured });
        } else if (incoming) |value| {
            const destination = try state.bindings.getOrPut(c.allocator, id);
            if (!destination.found_existing) destination.value_ptr.* = .{};
            if (!initialize) try self.mark(destination.value_ptr, .write);
            try destination.value_ptr.replace(c, value);
        } else if (state.bindings.getPtr(id)) |value| try loaded.replace(c, value);
    }
    fn edge(self: *UpperGraph, entries: []?UpperState, queued: []bool, pending: *std.ArrayListUnmanaged(t.BlockRef), target: t.BlockRef, state: *const UpperState, arguments: []const Owners) Error!void {
        const c = self.collector.c; const function = c.program.functions[@intFromEnum(self.function)]; const b = @intFromEnum(target);
        const parameters = function.blocks[b].parameters; try c.require(parameters.len == arguments.len);
        var incoming = try UpperState.clone(c, state); var owns = true; defer if (owns) incoming.deinit(c);
        for (parameters, arguments) |reg, *argument| try incoming.values[@intFromEnum(reg)].replace(c, argument);
        const changed = if (entries[b]) |*old| try old.join(c, &incoming) else blk: { entries[b] = incoming; owns = false; break :blk true; };
        if (changed and !queued[b]) { queued[b] = true; try pending.append(c.allocator, target); }
    }
    fn consume(self: *UpperGraph, target: t.FunctionRef, op: model.instruction.Instruction, state: *const UpperState, offset: usize, prefix: bool) Error!bool {
        const collector = self.collector; const c = collector.c; const full = try collector.consumeUpper(self.function, target);
        if (op.data == .eh_invoke and offset != 0) for (full.captures) |captured| {
            try c.step();
            // A typed hidden env/layout identifies a lexical slot, not the
            // external aliases in this instance of that slot. No selected
            // env-content proof is supplied to this owner-only walk.
            if (captured.read or captured.write or captured.structural) collector.fixed_upper_origin_pending = true;
        };
        try c.require(offset <= op.operands.len);
        try c.require(if (prefix) full.parameters.len <= op.operands.len - offset else full.parameters.len == op.operands.len - offset);
        for (full.parameters, 0..) |access_mode, i| {
            try c.step(); const argument = &state.values[@intFromEnum(op.operands[offset + i])];
            if (access_mode.read) try self.mark(argument, .read);
            if (access_mode.write) try self.mark(argument, .write);
            if (access_mode.structural) try self.mark(argument, .structural);
        }
        return full.facets.may_throw;
    }
    fn run(self: *UpperGraph) Error!void {
        const collector = self.collector; const c = collector.c; const v = collector.common();
        const function = c.program.functions[@intFromEnum(self.function)]; const abi = v.abis[@intFromEnum(function.abi)];
        try c.charge(function.blocks.len * 2 + 1);
        const entries = try c.allocator.alloc(?UpperState, function.blocks.len); @memset(entries, null);
        defer { for (entries) |*entry| if (entry.*) |*saved| saved.deinit(c); c.allocator.free(entries); }
        const queued = try c.allocator.alloc(bool, function.blocks.len); defer c.allocator.free(queued); @memset(queued, false);
        var pending: std.ArrayListUnmanaged(t.BlockRef) = .empty; defer pending.deinit(c.allocator);
        var initial = try UpperState.init(c, function.registers.len); var owns = true; defer if (owns) initial.deinit(c);
        const hidden: usize = if (abi.lexical_environment != null) 1 else 0;
        if (hidden != 0) try collector.facet(self.function, .managed_reference);
        const count = abi.parameters.len + @as(usize, if (abi.receiver != null) 1 else 0);
        for (0..count) |i| {
            try c.step(); const id = if (abi.receiver != null and i == 0) abi.receiver.? else abi.parameters[i - @as(usize, if (abi.receiver != null) 1 else 0)];
            if (try collector.managedType(v.storage.bindings[@intFromEnum(id)].@"type")) {
                const owner = Owner{ .parameter = i };
                const binding_value = try initial.bindings.getOrPut(c.allocator, id);
                if (!binding_value.found_existing) binding_value.value_ptr.* = .{};
                _ = try binding_value.value_ptr.add(c, owner);
                _ = try initial.values[@intFromEnum(function.blocks[0].parameters[hidden + i])].add(c, owner);
                try collector.facet(self.function, .managed_reference);
            }
        }
        if (abi.result) |result| if (try collector.managedType(result)) try collector.facet(self.function, .managed_reference);
        entries[0] = initial; owns = false; queued[0] = true; try pending.append(c.allocator, @enumFromInt(0));
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const b = @intFromEnum(pending.items[cursor]); queued[b] = false;
            var state = try UpperState.clone(c, &entries[b].?); defer state.deinit(c);
            for (function.blocks[b].instructions, 0..) |op, index| {
                try c.charge(op.operands.len + 1); var result: Owners = .{}; defer result.deinit(c.allocator);
                if (op.result) |reg| {
                    const saved = function.registers[@intFromEnum(reg)];
                    const logical: ?t.TypeRef = saved.view orelse if (saved.carrier == .@"type") saved.carrier.@"type" else null;
                    if (logical) |id| if (try collector.managedType(id)) try collector.facet(self.function, .managed_reference);
                }
                switch (op.data) {
                    .global_load => |data| { try collector.global(self.function, data.global, .read); _ = try result.add(c, .{ .global = data.global }); },
                    .global_store => |data| try collector.global(self.function, data.global, .write),
                    .eh_load => |data| {
                        try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, null, false);
                        // Binding roots are lexical observations, not proof of
                        // this handle's selected dynamic Cell contents.
                        _ = try result.add(c, .unresolved);
                    },
                    .eh_store => |data| try self.binding(&state, v.exceptions.bindings[@intFromEnum(data.binding)].binding, &result, &state.values[@intFromEnum(op.operands[1])], data.initialize),
                    inline .environment_load, .environment_store, .environment_init => |data| {
                        const env = function.registers[@intFromEnum(op.operands[0])].carrier.environment;
                        const id = v.closures.environments[@intFromEnum(env)].slots[@intFromEnum(data.slot)].binding;
                        try self.binding(&state, id, &result, if (op.data == .environment_load) null else &state.values[@intFromEnum(op.operands[1])], op.data == .environment_init);
                        if (op.data == .environment_load) _ = try result.add(c, .unresolved);
                    },
                    .environment_parent => _ = try result.add(c, .unresolved),
                    .domain_field_read, .domain_array_read => {
                        try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); try self.mark(&result, .read);
                        // A fresh container has no external receiver root, but
                        // a loaded element/field can still alias p, G or a
                        // capture. No selected-content alias proof exists in
                        // this owner-only domain. Keep that absence explicit,
                        // including when the loaded value later becomes a
                        // callable or is transported through Cells/env slots.
                        _ = try result.add(c, .unresolved);
                    },
                    .domain_array_length => try self.mark(&state.values[@intFromEnum(op.operands[0])], .read),
                    .domain_field_store => try self.mark(&state.values[@intFromEnum(op.operands[0])], .write),
                    .domain_array_store, .domain_array_resize => { const receiver = &state.values[@intFromEnum(op.operands[0])]; try self.mark(receiver, .write); try self.mark(receiver, .structural); },
                    .domain_view, .domain_refine, .domain_copy, .domain_read_span, .eh_assertion, .eh_presence_widen => try result.replace(c, &state.values[@intFromEnum(op.operands[0])]),
                    .eh_pack => { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); try collector.facet(self.function, .eh_control); },
                    .eh_carrier => |view| { try result.replace(c, &state.values[@intFromEnum(op.operands[0])]); if (view == null) try collector.facet(self.function, .eh_control); },
                    .function_make => if (op.operands.len != 0) {
                        try result.replace(c, &state.values[@intFromEnum(op.operands[0])]);
                        _ = try result.add(c, .unresolved);
                    },
                    .common_typed_array_create, .environment_alloc, .string_concat => { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); },
                    .eh_construct => |data| if (v.types[@intFromEnum(data.owner)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); },
                    .domain_literal => |data| if (v.types[@intFromEnum(data.actual_type)].kind == .reference) { try collector.facet(self.function, .allocation); try collector.facet(self.function, .managed_reference); },
                    .eh_enter => try collector.facet(self.function, .eh_control),
                    .authorized_host => {
                        // This module has no compiled artifact binding material.
                        // Matching package metadata/HSC records do not supply it.
                        collector.fixed_upper_host_pending = true;
                        _ = try result.add(c, .unresolved);
                    },
                    else => {},
                }
                if (op.result) |reg| try state.values[@intFromEnum(reg)].replace(c, &result);
                switch (op.data) {
                    .eh_invoke, .eh_invoke_indirect, .common_method_invoke => {
                        var throwing = false; var found = false;
                        switch (op.data) {
                            .eh_invoke => |call| { const target_abi = v.abis[@intFromEnum(c.program.functions[@intFromEnum(call.callee)].abi)]; throwing = try self.consume(call.callee, op, &state, if (target_abi.lexical_environment != null) 1 else 0, false); found = true; },
                            .common_method_invoke => |call| for (v.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| { try c.step(); const target = arm.target orelse return error.InvalidShape; throwing = (try self.consume(target, op, &state, 0, true)) or throwing; found = true; },
                            .eh_invoke_indirect => {
                                // An indirect loaded callable can carry an
                                // unproved captured environment even though
                                // its complete permitted code set is known.
                                for (state.values[@intFromEnum(op.operands[0])].items.items) |owner| {
                                    try c.step(); if (owner == .unresolved) collector.fixed_upper_origin_pending = true;
                                }
                                for (v.closures.calls) |row| {
                                    try c.step(); if (row.function != self.function or @intFromEnum(row.block) != b or row.instruction != index) continue;
                                    for (row.targets) |target| { try c.step(); throwing = (try self.consume(target, op, &state, 1, false)) or throwing; found = true; }
                                }
                            },
                            else => unreachable,
                        }
                        if (!found) { collector.fixed_upper_origin_pending = true; throwing = true; }
                        const normal = switch (op.data) { .eh_invoke => |call| call.normal, .eh_invoke_indirect => |call| call.normal, .common_method_invoke => |call| call.normal, else => unreachable };
                        const exceptional = switch (op.data) { .eh_invoke => |call| call.exceptional, .eh_invoke_indirect => |call| call.exceptional, .common_method_invoke => |call| call.exceptional, else => unreachable };
                        var returned: Owners = .{}; defer returned.deinit(c.allocator); _ = try returned.add(c, .unresolved);
                        try self.edge(entries, queued, &pending, normal, &state, if (function.blocks[@intFromEnum(normal)].parameters.len == 0) &.{} else &.{returned});
                        if (throwing) try self.edge(entries, queued, &pending, exceptional, &state, &.{returned});
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
                    .domain_numeric_use => |guard| try self.edge(entries, queued, &pending, guard.normal_successor, &state, &.{Owners{}}),
                    .eh_raise => try collector.facet(self.function, .may_throw),
                    .@"return" => if (op.operands.len != 0) { if (abi.result) |id| if (try collector.managedType(id)) try collector.facet(self.function, .escape); },
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
    contracts: []?usize,
    concrete: []?usize,
    captures: []?Capture,
    managed: []Managed,
    unresolved: bool = false,
    fixed_upper_origin_pending: bool = false,
    fixed_upper_host_pending: bool = false,
    host_binding_required: bool = false,

    pub fn init(c: *Context) Error!Collector {
        if (c.program.tables.mode != .common) return error.WrongMode;
        const v = c.program.tables.mode.common;
        try c.charge(c.program.functions.len + 2 * v.types.len + v.storage.bindings.len);
        const contracts = try c.allocator.alloc(?usize, c.program.functions.len);
        errdefer c.allocator.free(contracts);
        const concrete = try c.allocator.alloc(?usize, v.types.len);
        errdefer c.allocator.free(concrete);
        const captures = try c.allocator.alloc(?Capture, v.storage.bindings.len);
        errdefer c.allocator.free(captures);
        const managed = try c.allocator.alloc(Managed, v.types.len);
        errdefer c.allocator.free(managed);
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
        var result = Collector{ .c = c, .contracts = contracts, .concrete = concrete, .captures = captures, .managed = managed };
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
            .authorized_host => {
                // Existing Counter profile v1, not an arbitrary Host/resource
                // table. Prior metadata joins do not claim HSC verification.
                inline for (.{ "runtime.counter.storage", "runtime.counter.events" }) |id| {
                    try self.resources(function, id, false); try self.resources(function, id, true);
                }
            },
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
    pub fn finish(self: *Collector) FinishError!void {
        for (self.c.program.functions, 0..) |_, index| {
            try self.c.step(); var graph = UpperGraph{ .collector = self, .function = @enumFromInt(index) }; try graph.run();
        }
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
