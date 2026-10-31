// SPDX-License-Identifier: MIT
// Passive Common actual-effects subsumption, using the one actual solver's
// final read-only replay. No Source walk, value transfer or second solve lives
// here. Entry/global/capture origins are observations, never allocation proof.
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
pub const FinishError = Error || error{FixedUpperLanguageCfgPending};
const Access = enum { read, write, structural };
const Facet = enum { allocation, managed_reference, eh_control, may_throw, @"await", lock, escape, unknown_host };
const Capture = struct { environment: t.EnvironmentRef, slot: t.EnvironmentSlotRef };
const Managed = enum { empty, active, no, yes };

// init is deliberately Common-only. Legacy Published Domain bounds and EH's
// empty Authority are not an empty effect contract or effect permission.
// The caller multiplexes observer() with Borrow on the same final replay, then
// calls finish(). This module never invokes an engine or creates a Program.
// A throwing callee upper can open language paths absent from actual replay.
// Until an independent complete-upper CFG consumer supplies that coverage,
// finish rejects such calls as pending rather than claiming their effects.
pub const Collector = struct {
    c: *Context,
    contracts: []?usize,
    concrete: []?usize,
    captures: []?Capture,
    managed: []Managed,
    unresolved: bool = false,
    fixed_upper_language_cfg_pending: bool = false,
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
    fn consume(self: *Collector, site: facts.Site, state: facts.StateView, target: t.FunctionRef, offset: usize, prefix: bool) Error!void {
        const c = self.c; const v = self.common(); const f = c.program.functions[@intFromEnum(target)];
        const contract_index = self.contracts[@intFromEnum(target)] orelse return error.InvalidShape;
        const contract = v.authority.fixed_publication.publication.contracts[contract_index]; const full = contract.upper;
        const op = c.program.functions[@intFromEnum(site.location.function)].blocks[@intFromEnum(site.location.block)].instructions[site.location.instruction];
        var joined = false;
        for (v.authority.fixed_publication.dependencies[@intFromEnum(site.location.function)].callees) |edge| {
            try c.step(); if (!std.mem.eql(u8, &edge.function_id, &f.id)) continue;
            try c.require(std.mem.eql(u8, &edge.digest, &contract.digest)); joined = true; break;
        }
        try c.require(joined);
        try c.charge(std.meta.fields(Facet).len);
        // may_throw is a completion, not a caller facet OR: catch/finally may
        // handle it. Actual replay cannot certify all paths opened by this
        // complete upper, even when an actual language edge was observed.
        if (full.facets.may_throw) self.fixed_upper_language_cfg_pending = true;
        inline for (std.meta.fields(Facet)) |field| {
            if (field.value != @intFromEnum(Facet.may_throw) and @field(full.facets, field.name))
                try self.facet(site.location.function, @enumFromInt(field.value));
        }
        for (full.globals.reads) |id| try self.inheritGlobal(site.location.function, id, .read);
        for (full.globals.writes) |id| try self.inheritGlobal(site.location.function, id, .write);
        for (full.host_resources.reads) |id| try self.resources(site.location.function, id, false);
        for (full.host_resources.writes) |id| try self.resources(site.location.function, id, true);
        for (full.captures) |wanted| {
            try c.step(); const bound = self.upper(site.location.function) orelse continue;
            var found = false;
            for (bound.captures) |allowed| {
                try c.step(); if (!std.mem.eql(u8, &wanted.slot, &allowed.slot)) continue;
                try c.require((!wanted.read or allowed.read) and (!wanted.write or allowed.write) and (!wanted.structural or allowed.structural)); found = true; break;
            }
            try c.require(found);
        }
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
        // Missing origin facts remain a capability gap, never an empty effect.
        try self.c.require(!self.unresolved);
        // This is an explicitly exposed coverage gap, not a mismatch between
        // callee.may_throw and the caller's possibly nonthrowing contract.
        try self.c.step();
        if (self.fixed_upper_language_cfg_pending) return error.FixedUpperLanguageCfgPending;
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
