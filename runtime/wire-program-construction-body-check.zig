// SPDX-License-Identifier: MIT
// Common construction protocol over normalized typed operations and the CFG.
// Preconditions on this SAME Context: refs/layout/SSA/identity, construction
// and M12 contracts, complete fixed-target flow and complete effects checks.
// In particular a false mayThrow is consumed only after those checks succeed.
// This is not SourcePlan, an actual heap/instance or an admission certificate.
// Missing SourcePlan does not authorize the C++ initializer exception/escape
// exemptions: all possible language edges and ordinary exposing uses remain.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Instruction = model.instruction.Instruction;
const Context = context.Context;
pub const Error = context.Error;
const Points = std.AutoHashMapUnmanaged(usize, void);
const Edge = struct { from: usize, to: usize };
const Cuts = std.AutoHashMapUnmanaged(Edge, void);
const empty_points: Points = .empty;
const empty_cuts: Cuts = .empty;
const Path = struct { from: usize, target: usize, reset: usize };
const Registers = std.AutoHashMapUnmanaged(t.RegisterRef, void);
const Origin = struct {
    fresh: Registers = .empty,
    direct: Registers = .empty,
    receiver: bool = false,
    unknown: bool = false,
    fn deinit(self: *Origin, allocator: std.mem.Allocator) void {
        self.fresh.deinit(allocator); self.direct.deinit(allocator);
    }
};
const Point = struct { block: t.BlockRef, instruction: usize };
const Edges = struct { items: [2]usize = undefined, count: usize = 0 };
const Allocation = struct { owner: t.TypeRef, point: usize, calls: std.ArrayListUnmanaged(usize) = .empty };

const Catalogue = struct {
    c: *Context,
    common: tables.CommonTables,
    constructions: []?t.ConstructionRef,
    owners: []?t.TypeRef,
    upper: std.AutoHashMapUnmanaged(t.Hash, *const publication.EffectUpper) = .empty,
    fn init(c: *Context, common: tables.CommonTables) Error!Catalogue {
        try c.charge(common.types.len + c.program.functions.len);
        const constructions = try c.allocator.alloc(?t.ConstructionRef, common.types.len);
        errdefer c.allocator.free(constructions);
        const owners = try c.allocator.alloc(?t.TypeRef, c.program.functions.len);
        @memset(constructions, null); @memset(owners, null);
        return .{ .c = c, .common = common, .constructions = constructions, .owners = owners };
    }
    fn deinit(self: *Catalogue) void {
        self.c.allocator.free(self.constructions); self.c.allocator.free(self.owners); self.upper.deinit(self.c.allocator);
    }
    fn fill(self: *Catalogue) Error!void {
        for (self.common.members.constructions, 0..) |row, index| {
            try self.c.step(); self.constructions[@intFromEnum(row.owner)] = @enumFromInt(index);
            if (row.function) |function| self.owners[@intFromEnum(function)] = row.owner;
        }
        for (self.common.authority.fixed_publication.publication.contracts) |*row| {
            try self.c.step(); try self.upper.put(self.c.allocator, row.function_id, &row.upper);
        }
    }
    fn parent(self: *const Catalogue, owner: t.TypeRef) ?t.TypeRef { return self.common.types[@intFromEnum(owner)].base; }
    fn ancestor(self: *Catalogue, child: t.TypeRef, base: t.TypeRef) Error!bool {
        var current: ?t.TypeRef = child;
        while (current) |owner| { try self.c.step(); if (owner == base) return true; current = self.parent(owner); }
        return false;
    }
    fn construction(self: *const Catalogue, owner: t.TypeRef) @import("wire-program-members.zig").CommonConstruction {
        return self.common.members.constructions[@intFromEnum(self.constructions[@intFromEnum(owner)].?)];
    }
    fn first(self: *Catalogue, start: ?t.TypeRef) Error!?t.FunctionRef {
        var current = start;
        while (current) |owner| {
            try self.c.step(); if (self.construction(owner).function) |function| return function; current = self.parent(owner);
        }
        return null;
    }
    fn fieldIn(self: *Catalogue, owner: t.TypeRef, member: t.FieldRef) Error!bool {
        for (self.construction(owner).initialization_fields) |field| { try self.c.step(); if (field == member) return true; }
        return false;
    }
    fn throwing(self: *Catalogue, function: t.FunctionRef) Error!bool {
        try self.c.step(); const bound = self.upper.get(self.c.program.functions[@intFromEnum(function)].id) orelse return true;
        return bound.facets.may_throw;
    }
};

const Graph = struct {
    catalogue: *Catalogue,
    function_ref: t.FunctionRef,
    function: *const model.Function,
    current: ?t.TypeRef,
    points: []Point,
    starts: []usize,
    edges: []Edges,
    origins: []Origin,
    allocations: std.AutoHashMapUnmanaged(t.RegisterRef, Allocation) = .empty,
    stores: std.AutoHashMapUnmanaged(t.BindingRef, std.ArrayListUnmanaged(t.RegisterRef)) = .empty,
    paths: std.AutoHashMapUnmanaged(Path, bool) = .empty,
    supers: std.ArrayListUnmanaged(usize) = .empty,
    changed: bool = false,

    fn init(catalogue: *Catalogue, function_ref: t.FunctionRef) Error!Graph {
        const c = catalogue.c; const function = &c.program.functions[@intFromEnum(function_ref)]; var count: usize = 0;
        for (function.blocks) |block| { try c.step(); count += block.instructions.len; }
        try c.charge(count * 2 + function.blocks.len + function.registers.len);
        const points = try c.allocator.alloc(Point, count); errdefer c.allocator.free(points);
        const starts = try c.allocator.alloc(usize, function.blocks.len); errdefer c.allocator.free(starts);
        const edges = try c.allocator.alloc(Edges, count); errdefer c.allocator.free(edges);
        const origins = try c.allocator.alloc(Origin, function.registers.len);
        @memset(edges, .{}); @memset(origins, .{});
        return .{ .catalogue = catalogue, .function_ref = function_ref, .function = function,
            .current = catalogue.owners[@intFromEnum(function_ref)], .points = points, .starts = starts, .edges = edges, .origins = origins };
    }
    fn deinit(self: *Graph) void {
        const allocator = self.catalogue.c.allocator;
        allocator.free(self.points); allocator.free(self.starts); allocator.free(self.edges);
        for (self.origins) |*provenance| provenance.deinit(allocator); allocator.free(self.origins);
        var allocations = self.allocations.valueIterator(); while (allocations.next()) |value| value.calls.deinit(allocator);
        var stores = self.stores.valueIterator(); while (stores.next()) |value| value.deinit(allocator);
        self.allocations.deinit(allocator); self.stores.deinit(allocator); self.paths.deinit(allocator); self.supers.deinit(allocator);
    }
    fn op(self: *const Graph, point: usize) Instruction {
        const at = self.points[point]; return self.function.blocks[@intFromEnum(at.block)].instructions[at.instruction];
    }
    fn origin(self: *Graph, reg: t.RegisterRef) *Origin { return &self.origins[@intFromEnum(reg)]; }
    fn unknown(self: *Graph, reg: t.RegisterRef) Error!void {
        try self.catalogue.c.step(); const value = self.origin(reg);
        if (!value.unknown) { value.unknown = true; self.changed = true; }
    }
    fn merge(self: *Graph, into: t.RegisterRef, source: t.RegisterRef, direct: bool) Error!void {
        const c = self.catalogue.c; const from = self.origin(source);
        // SSA identity copies and loop phi may mention the same register.
        if (into == source) { try c.step(); return; }
        const to = self.origin(into); try c.charge(from.fresh.count() + from.direct.count() + 1);
        var fresh = from.fresh.keyIterator(); while (fresh.next()) |key| {
            if (!(try to.fresh.getOrPut(c.allocator, key.*)).found_existing) self.changed = true;
        }
        if (direct) { var values = from.direct.keyIterator(); while (values.next()) |key| {
            if (!(try to.direct.getOrPut(c.allocator, key.*)).found_existing) self.changed = true;
        } }
        if (from.receiver and !to.receiver) { to.receiver = true; self.changed = true; }
        if (from.unknown and !to.unknown) { to.unknown = true; self.changed = true; }
    }
    fn edgeValues(self: *Graph, op_value: Instruction, target: t.BlockRef, offset: usize, count: usize) Error!void {
        const parameters = self.function.blocks[@intFromEnum(target)].parameters;
        // Typed SSA already established this edge's arity and dominance.
        for (parameters, op_value.operands[offset..][0..count]) |parameter, argument| try self.merge(parameter, argument, false);
    }
    fn callThrows(self: *Graph, point: usize) Error!bool {
        const c = self.catalogue.c; const call = self.op(point);
        switch (call.data) {
            .eh_invoke => |data| return self.catalogue.throwing(data.callee),
            .common_method_invoke => |data| {
                for (self.catalogue.common.views.dispatch[@intFromEnum(data.dispatch)].method.arms) |arm| {
                    try c.step(); if (try self.catalogue.throwing(arm.target.?)) return true;
                }
                return false;
            },
            .eh_invoke_indirect => {
                const at = self.points[point];
                for (self.catalogue.common.closures.calls) |site| {
                    try c.step(); if (site.function != self.function_ref or site.block != at.block or site.instruction != at.instruction) continue;
                    for (site.targets) |target| { try c.step(); if (try self.catalogue.throwing(target)) return true; }
                    return false;
                }
                return error.InvalidShape; // Complete fixed-site discharge is a prerequisite.
            },
            else => return true,
        }
    }
    fn build(self: *Graph) Error!void {
        const c = self.catalogue.c; var index: usize = 0;
        for (self.function.blocks, 0..) |block, b| {
            try c.step(); self.starts[b] = index;
            for (block.instructions, 0..) |_, i| { try c.step(); self.points[index] = .{ .block = @enumFromInt(b), .instruction = i }; index += 1; }
        }
        for (self.points, 0..) |point, n| {
            try c.step(); const instruction = self.op(n); const edges = &self.edges[n];
            if (point.instruction + 1 < self.function.blocks[@intFromEnum(point.block)].instructions.len) {
                edges.items[0] = n + 1; edges.count = 1;
            } else switch (instruction.data) {
                .br => |data| { edges.items[0] = self.starts[@intFromEnum(data.destination)]; edges.count = 1; },
                .cond_br => |data| { edges.items = .{ self.starts[@intFromEnum(data.true_destination)], self.starts[@intFromEnum(data.false_destination)] }; edges.count = 2; },
                .eh_route => |data| { edges.items[0] = self.starts[@intFromEnum(data.successor)]; edges.count = 1; },
                .domain_numeric_use => |data| { edges.items[0] = self.starts[@intFromEnum(data.normal_successor)]; edges.count = 1; },
                inline .eh_invoke, .eh_invoke_indirect, .common_method_invoke => |data| {
                    edges.items[0] = self.starts[@intFromEnum(data.normal)]; edges.count = 1;
                    if (try self.callThrows(n)) { edges.items[1] = self.starts[@intFromEnum(data.exceptional)]; edges.count = 2; }
                },
                else => {},
            }
            switch (instruction.data) {
                .eh_construct => |data| {
                    const result = instruction.result.?;
                    try self.allocations.put(c.allocator, result, .{ .owner = data.owner, .point = n });
                    try self.origin(result).fresh.put(c.allocator, result, {}); try self.origin(result).direct.put(c.allocator, result, {});
                },
                .eh_store => |data| {
                    const binding = self.catalogue.common.exceptions.bindings[@intFromEnum(data.binding)].binding;
                    const entry = try self.stores.getOrPut(c.allocator, binding); if (!entry.found_existing) entry.value_ptr.* = .empty;
                    try entry.value_ptr.append(c.allocator, instruction.operands[1]);
                },
                inline .environment_init, .environment_store => |data| {
                    const environment = self.function.registers[@intFromEnum(instruction.operands[0])].carrier.environment;
                    const binding = self.catalogue.common.closures.environments[@intFromEnum(environment)].slots[@intFromEnum(data.slot)].binding;
                    const entry = try self.stores.getOrPut(c.allocator, binding); if (!entry.found_existing) entry.value_ptr.* = .empty;
                    try entry.value_ptr.append(c.allocator, instruction.operands[1]);
                },
                else => {},
            }
        }
        const abi = self.catalogue.common.abis[@intFromEnum(self.function.abi)];
        const receiver: usize = if (abi.lexical_environment == null) 0 else 1;
        for (self.function.blocks[0].parameters, 0..) |reg, i| {
            try c.step(); if (self.current != null and i == receiver) self.origin(reg).receiver = true else self.origin(reg).unknown = true;
        }
        while (true) {
            self.changed = false;
            for (self.points, 0..) |_, n| {
                try c.step(); const instruction = self.op(n);
                if (instruction.result) |result| if (instruction.data != .eh_construct) {
                    switch (instruction.data) {
                        .domain_view, .eh_carrier, .eh_assertion => try self.merge(result, instruction.operands[0], true),
                        .domain_copy => {
                            const carrier = self.function.registers[@intFromEnum(result)].carrier;
                            if (carrier == .@"type" and self.catalogue.common.types[@intFromEnum(carrier.@"type")].kind == .reference)
                                try self.merge(result, instruction.operands[0], true) else try self.unknown(result);
                        },
                        .eh_load => |data| {
                            const binding = self.catalogue.common.exceptions.bindings[@intFromEnum(data.binding)].binding;
                            if (self.stores.get(binding)) |values| { for (values.items) |value| try self.merge(result, value, false); } else try self.unknown(result);
                        },
                        .environment_load => |data| {
                            const environment = self.function.registers[@intFromEnum(instruction.operands[0])].carrier.environment;
                            const binding = self.catalogue.common.closures.environments[@intFromEnum(environment)].slots[@intFromEnum(data.slot)].binding;
                            if (self.stores.get(binding)) |values| { for (values.items) |value| try self.merge(result, value, false); } else try self.unknown(result);
                        },
                        else => try self.unknown(result),
                    }
                };
                switch (instruction.data) {
                    .br => |data| try self.edgeValues(instruction, data.destination, 0, instruction.operands.len),
                    .eh_route => |data| try self.edgeValues(instruction, data.successor, 0, instruction.operands.len),
                    .cond_br => |data| {
                        try self.edgeValues(instruction, data.true_destination, 1, data.true_count);
                        try self.edgeValues(instruction, data.false_destination, 1 + data.true_count, instruction.operands.len - 1 - data.true_count);
                    },
                    inline .eh_invoke, .eh_invoke_indirect, .common_method_invoke => |data| {
                        for (self.function.blocks[@intFromEnum(data.normal)].parameters) |reg| try self.unknown(reg);
                        for (self.function.blocks[@intFromEnum(data.exceptional)].parameters) |reg| try self.unknown(reg);
                    },
                    .domain_numeric_use => |data| for (self.function.blocks[@intFromEnum(data.normal_successor)].parameters) |reg| try self.unknown(reg),
                    else => {},
                }
            }
            if (!self.changed) break;
        }
    }
    fn reaches(self: *Graph, from: usize, target: usize, reset: usize) Error!bool {
        const c = self.catalogue.c; const key = Path{ .from = from, .target = target, .reset = reset }; try c.step();
        if (self.paths.get(key)) |known| return known;
        var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator);
        var seen: Points = .empty; defer seen.deinit(c.allocator); try pending.append(c.allocator, from);
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const point = pending.items[cursor];
            if (point == reset or (try seen.getOrPut(c.allocator, point)).found_existing) continue;
            if (point == target) { try self.paths.put(c.allocator, key, true); return true; }
            const edges = self.edges[point]; try c.charge(edges.count); try pending.appendSlice(c.allocator, edges.items[0..edges.count]);
        }
        try self.paths.put(c.allocator, key, false); return false;
    }
    fn bypass(self: *Graph, target: usize, cut_edges: *const Cuts, cut_points: *const Points, from: usize) Error!bool {
        const c = self.catalogue.c;
        var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator); try c.step(); try pending.append(c.allocator, from);
        var seen: Points = .empty; defer seen.deinit(c.allocator); var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const point = pending.items[cursor];
            if (cut_points.contains(point) or (try seen.getOrPut(c.allocator, point)).found_existing) continue;
            if (point == target) return true;
            const edges = self.edges[point];
            for (edges.items[0..edges.count]) |next| {
                try c.step(); if (!cut_edges.contains(.{ .from = point, .to = next })) try pending.append(c.allocator, next);
            }
        }
        return false;
    }
    fn normalPoint(self: *const Graph, call: usize) usize { return self.starts[@intFromEnum(self.op(call).data.eh_invoke.normal)]; }
    fn afterSuper(self: *Graph, target: usize) Error!bool {
        var cuts: Cuts = .empty; defer cuts.deinit(self.catalogue.c.allocator);
        for (self.supers.items) |call| { try self.catalogue.c.step(); try cuts.put(self.catalogue.c.allocator, .{ .from = call, .to = self.normalPoint(call) }, {}); }
        return cuts.count() != 0 and !try self.bypass(target, &cuts, &empty_points, self.starts[0]);
    }
    fn beforeSuper(self: *Graph, start: usize) Error!bool {
        const c = self.catalogue.c; var pending: std.ArrayListUnmanaged(usize) = .empty; defer pending.deinit(c.allocator);
        const first_edges = self.edges[start]; try c.charge(first_edges.count); try pending.appendSlice(c.allocator, first_edges.items[0..first_edges.count]);
        var seen: Points = .empty; defer seen.deinit(c.allocator); var cursor: usize = 0; var paired = false;
        while (cursor < pending.items.len) : (cursor += 1) {
            try c.step(); const point = pending.items[cursor]; if ((try seen.getOrPut(c.allocator, point)).found_existing) continue;
            var is_super = false; for (self.supers.items) |call| { try c.step(); if (call == point) { is_super = true; break; } }
            if (is_super) { paired = true; continue; }
            if (self.op(point).data == .@"return") return false;
            // An initializer range is not a SourcePlan proof. In particular a
            // throwing ordinary call and its catch-return cannot be pruned.
            const edges = self.edges[point]; try c.charge(edges.count); try pending.appendSlice(c.allocator, edges.items[0..edges.count]);
        }
        return paired;
    }
    fn declaration(self: *const Graph, instruction: Instruction, field: t.FieldRef) bool {
        return std.meta.eql(instruction.source, self.catalogue.common.members.fields[@intFromEnum(field)].origin);
    }
    fn initialized(self: *Graph, member: t.FieldRef, target: usize) Error!bool {
        const c = self.catalogue.c; var cuts: Points = .empty; defer cuts.deinit(c.allocator);
        for (self.points, 0..) |_, n| {
            try c.step(); const instruction = self.op(n); if (instruction.data != .eh_field_initialize or instruction.data.eh_field_initialize.field != member) continue;
            const receiver = self.origin(instruction.operands[0]);
            if (receiver.receiver and !receiver.unknown and receiver.fresh.count() == 0 and self.declaration(instruction, member)) try cuts.put(c.allocator, n, {});
        }
        return cuts.count() != 0 and !try self.bypass(target, &empty_cuts, &cuts, self.starts[0]);
    }
    fn baseComplete(self: *Graph, owner: t.TypeRef, target: usize) Error!bool {
        const catalogue = self.catalogue; var base = catalogue.parent(owner);
        while (base) |ancestor| {
            try catalogue.c.step(); const row = catalogue.construction(ancestor);
            if (row.function != null) return self.afterSuper(target);
            for (row.initialization_fields) |field| { try catalogue.c.step(); if (!try self.initialized(field, target)) return false; }
            base = catalogue.parent(ancestor);
        }
        return true;
    }
    fn exposed(self: *Graph, allocation_ref: t.RegisterRef, target: usize) Error!bool {
        const c = self.catalogue.c; const allocation = self.allocations.get(allocation_ref).?;
        for (self.points, 0..) |_, n| {
            try c.step(); if (n == target or n == allocation.point) continue; const instruction = self.op(n); var used = false;
            for (instruction.operands) |operand| { try c.step(); used = used or self.origin(operand).fresh.contains(allocation_ref); }
            if (!used) continue;
            switch (instruction.data) {
                .domain_view, .domain_copy, .eh_carrier, .eh_assertion, .br, .cond_br => continue,
                .eh_field_initialize => if (self.origin(instruction.operands[0]).fresh.contains(allocation_ref)) { continue; },
                .eh_invoke => {
                    var constructor = false; for (allocation.calls.items) |call| { try c.step(); if (n == call) { constructor = true; break; } }
                    if (constructor) continue;
                },
                else => {},
            }
            // No Source-range-only exception: a real ordinary use can publish
            // this receiver even when its anchor resembles an initializer.
            if (try self.reaches(n, target, allocation.point)) return true;
        }
        return false;
    }
    fn invoke(self: *Graph, point: usize, instruction: Instruction) Error!void {
        const catalogue = self.catalogue; const c = catalogue.c; const target = instruction.data.eh_invoke.callee;
        if (c.program.functions[@intFromEnum(target)].role != .construction_body) return;
        const target_owner = catalogue.owners[@intFromEnum(target)].?; const receiver = self.origin(instruction.operands[0]);
        try c.require(!receiver.unknown and (receiver.receiver or receiver.fresh.count() != 0));
        if (receiver.receiver) {
            const current = self.current orelse return error.InvalidShape;
            try c.require(target_owner != current and try catalogue.first(catalogue.parent(current)) == target);
            if (receiver.fresh.count() == 0) { try c.step(); try self.supers.append(c.allocator, point); }
        }
        var fresh = receiver.fresh.keyIterator(); while (fresh.next()) |allocation_ref| {
            try c.step(); const allocation = self.allocations.getPtr(allocation_ref.*).?;
            try c.require(receiver.direct.contains(allocation_ref.*) and try catalogue.first(allocation.owner) == target);
            try c.require(std.meta.eql(self.op(allocation.point).source, instruction.source));
            try allocation.calls.append(c.allocator, point);
        }
    }
    fn write(self: *Graph, point: usize, instruction: Instruction, member: t.FieldRef, initial: bool) Error!void {
        const catalogue = self.catalogue; const c = catalogue.c; const receiver = self.origin(instruction.operands[0]);
        const field_owner = catalogue.common.members.fields[@intFromEnum(member)].owner;
        try c.require(!receiver.unknown and (receiver.receiver or receiver.fresh.count() != 0));
        if (receiver.receiver) {
            const current = self.current orelse return error.InvalidShape;
            if (!initial) {
                try c.require(field_owner == current and try self.baseComplete(current, point));
            } else {
                try c.require(try catalogue.ancestor(current, field_owner) and try catalogue.fieldIn(field_owner, member) and self.declaration(instruction, member));
                if (field_owner == current) {
                    try c.require(catalogue.parent(current) != null and try self.baseComplete(current, point));
                } else {
                    const selected = try catalogue.first(catalogue.parent(current));
                    if (selected != null and field_owner == catalogue.owners[@intFromEnum(selected.?)].? and catalogue.parent(field_owner) == null) {
                        try c.require(try self.beforeSuper(point));
                    } else {
                        if (selected) |function| try c.require(try catalogue.ancestor(field_owner, catalogue.owners[@intFromEnum(function)].?));
                        try c.require(catalogue.construction(field_owner).function == null and try self.baseComplete(field_owner, point));
                    }
                }
            }
        }
        var fresh = receiver.fresh.keyIterator(); while (fresh.next()) |allocation_ref| {
            try c.step(); const allocation = self.allocations.get(allocation_ref.*).?;
            try c.require(initial and receiver.direct.contains(allocation_ref.*) and try catalogue.ancestor(allocation.owner, field_owner) and
                try catalogue.fieldIn(field_owner, member) and self.declaration(instruction, member));
            if (try catalogue.first(allocation.owner)) |callee| {
                const explicit_owner = catalogue.owners[@intFromEnum(callee)].?;
                if (field_owner == explicit_owner) {
                    try c.require(catalogue.parent(field_owner) == null);
                    for (allocation.calls.items) |call| {
                        const edges = self.edges[call]; for (edges.items[0..edges.count]) |next| try c.require(!try self.reaches(next, point, allocation.point));
                    }
                } else {
                    try c.require(catalogue.construction(field_owner).function == null and try catalogue.ancestor(field_owner, explicit_owner) and allocation.calls.items.len != 0);
                    var cuts: Cuts = .empty; defer cuts.deinit(c.allocator);
                    for (allocation.calls.items) |call| { try c.step(); try cuts.put(c.allocator, .{ .from = call, .to = self.normalPoint(call) }, {}); }
                    try c.require(!try self.bypass(point, &cuts, &empty_points, allocation.point));
                }
            }
            try c.require(!try self.exposed(allocation_ref.*, point));
        }
    }
    fn run(self: *Graph) Error!void {
        const c = self.catalogue.c; try self.build();
        for (self.points, 0..) |_, n| { try c.step(); const instruction = self.op(n); if (instruction.data == .eh_invoke) try self.invoke(n, instruction); }
        var allocations = self.allocations.iterator(); while (allocations.next()) |entry| {
            const allocation = entry.value_ptr;
            for (allocation.calls.items) |before| for (allocation.calls.items) |after| {
                try c.step(); const edges = self.edges[before];
                for (edges.items[0..edges.count]) |next| try c.require(!try self.reaches(next, after, allocation.point));
            };
            for (allocation.calls.items) |after| {
                try c.step();
                try c.require(!try self.exposed(entry.key_ptr.*, after));
            }
        }
        for (self.points, 0..) |_, n| {
            try c.step(); const instruction = self.op(n);
            switch (instruction.data) {
                .eh_field_initialize => |data| try self.write(n, instruction, data.field, true),
                .domain_field_store => |data| {
                    var targets: std.AutoHashMapUnmanaged(t.FieldRef, void) = .empty; defer targets.deinit(c.allocator);
                    try targets.put(c.allocator, data.member, {});
                    for (self.catalogue.common.views.dispatch[@intFromEnum(data.dispatch)].field.arms) |arm| { try c.step(); try targets.put(c.allocator, arm.target.?, {}); }
                    var fields = targets.keyIterator(); while (fields.next()) |field| {
                        try c.step(); if (self.catalogue.common.members.fields[@intFromEnum(field.*)].readonly) try self.write(n, instruction, field.*, false);
                    }
                },
                else => {},
            }
        }
    }
};

// Called after the one fixed-code solve and complete effects.finish, before
// returning from the public typed checker. This runs no code, Source walker,
// Actual transfer or second SSA verifier, and returns no permission handle.
pub fn checkBodies(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
    var catalogue = try Catalogue.init(c, common); defer catalogue.deinit(); try catalogue.fill();
    for (c.program.functions, 0..) |_, index| {
        try c.step(); var graph = try Graph.init(&catalogue, @enumFromInt(index)); defer graph.deinit(); try graph.run();
    }
}
