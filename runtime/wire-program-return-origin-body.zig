// SPDX-License-Identifier: MIT
// Independent current normalized-body projection. No fixed graph/Source AST is
// an input. References/layout/SSA/identity are owned by the same Context first.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const refs = @import("wire-program-publication-refs.zig");
const origin = @import("wire-program-return-origin-model.zig");
const construction_domain = @import("wire-program-return-origin-construction.zig");
const t = wire.types;
pub const Pending = enum { mode, control_flow, entry_protocol, raw_input, operation, view, archive_type, literal_protocol, receiver_fields, implicit_protocol, archive_construction, archive_field, archive_global, global_payload, span_transfer, array_view };
pub const Projection = struct {
    // Node storage is owned here; type symbols borrow Directory, which must
    // outlive this projection (the real consumer's arena encloses both).
    arena: std.heap.ArenaAllocator, pending: ?Pending = null, graph: ?origin.Graph = null,
    // Effect-only control projection: original block and receiver action joins.
    block_controls: []const origin.Ref = &.{}, receiver_actions: []const ReceiverControl = &.{},
    field_stores: []const ReceiverField = &.{},
    pub fn deinit(self: *Projection) void { self.arena.deinit(); }
};
pub const ReceiverField = struct { block: usize, instruction: usize, field: t.FieldRef, store: origin.Ref };
pub const ReceiverControl = struct { block: usize, instruction: usize, normal: origin.Ref, language: origin.Ref, normal_control: origin.Ref, language_control: origin.Ref };
const Builder = struct {
    c: *context.Context, allocator: std.mem.Allocator, directory: *const origin.Directory, budget: *origin.Budget,
    nodes: std.ArrayListUnmanaged(origin.Value) = .empty, registers: []?origin.Ref,
    pending: ?Pending = null,
    fn value(self: *Builder, row: origin.Value) context.Error!origin.Ref {
        const fields: usize = switch (row) { .receiver_input, .unknown => 0, inline else => |payload| @typeInfo(@TypeOf(payload)).@"struct".fields.len };
        try self.c.charge(fields + 1);
        if (self.nodes.items.len == self.nodes.capacity) try self.c.charge(self.nodes.items.len + 1);
        const id = self.nodes.items.len; try self.nodes.append(self.allocator, row); return id;
    }
    fn findTypeSymbol(self: *Builder, ref: t.TypeRef) context.Error!?origin.Symbol {
        const row = &self.c.program.tables.mode.common.types[@intFromEnum(ref)];
        const id = try refs.symbol(self.c, self.allocator, row.id);
        self.budget.lookup(self.directory.types.len, id.len) catch |err| return refs.graphFailure(err);
        var lo: usize = 0; var hi = self.directory.types.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            switch (std.mem.order(u8, self.directory.types[mid].id, id)) { .eq => return self.directory.types[mid].id, .lt => lo = mid + 1, .gt => hi = mid }
        }
        return null;
    }
    fn typeSymbol(self: *Builder, ref: t.TypeRef) context.Error!?origin.Symbol {
        const found = try self.findTypeSymbol(ref);
        if (found == null) self.pending = .archive_type;
        return found;
    }
    fn view(self: *Builder, f: *const wire.Function, reg: t.RegisterRef) context.Error!?origin.Symbol {
        const ref = f.registers[@intFromEnum(reg)].view orelse { self.pending = .view; return null; };
        return self.typeSymbol(ref);
    }
};

const RefList = std.ArrayListUnmanaged(origin.Ref);
const Flow = struct { heap: origin.Ref, control: origin.Ref };
const CFG = struct {
    const FieldAddress = struct { id: origin.Symbol, view: origin.Symbol };
    b: *Builder, f: *const wire.Function, receiver_protocol: bool = false,
    cells: []?origin.Ref = &.{}, cell_inputs: []RefList = &.{},
    receiver_actions: std.ArrayListUnmanaged(ReceiverControl) = .empty,
    field_stores: std.ArrayListUnmanaged(ReceiverField) = .empty,
    heaps: std.ArrayListUnmanaged(origin.Heap) = .empty, controls: std.ArrayListUnmanaged(origin.Control) = .empty,
    values: []RefList, incoming_heaps: []RefList, incoming_controls: []RefList,
    blocks: []Flow, normal: RefList = .empty, language: RefList = .empty,
    normal_exits: std.ArrayListUnmanaged(origin.Exit) = .empty, language_exits: std.ArrayListUnmanaged(origin.Exit) = .empty,
    accesses: std.ArrayListUnmanaged(origin.Access) = .empty, access_keys: std.ArrayListUnmanaged(origin.Symbol) = .empty,
    fn init(b: *Builder, f: *const wire.Function) context.Error!CFG {
        try b.c.charge(f.registers.len); const values = try b.allocator.alloc(RefList, f.registers.len); @memset(values, .empty);
        try b.c.charge(f.blocks.len); const heaps = try b.allocator.alloc(RefList, f.blocks.len); @memset(heaps, .empty);
        try b.c.charge(f.blocks.len); const controls = try b.allocator.alloc(RefList, f.blocks.len); @memset(controls, .empty);
        try b.c.charge(f.blocks.len); const blocks = try b.allocator.alloc(Flow, f.blocks.len);
        return .{ .b = b, .f = f, .values = values, .incoming_heaps = heaps, .incoming_controls = controls, .blocks = blocks };
    }
    fn start(self: *CFG) context.Error!void {
        // Allocate one stable Data equation per SSA register before visiting
        // definitions/edges; phi and loop backedges only extend these joins.
        for (self.f.registers, 0..) |*reg, index| {
            try self.b.c.step(); if (reg.carrier == .initialization) continue;
            // SSA aliases keep actual inputs even when a private static view
            // is absent from the public archive. This optional join annotation
            // grants no Data/category fact; semantic type uses remain strict.
            const view = if (reg.carrier != .receiver and reg.view != null) try self.b.findTypeSymbol(reg.view.?) else null;
            if (self.b.pending != null) return;
            self.b.registers[index] = try self.b.value(.{ .join = .{ .@"type" = view, .inputs = &.{} } });
        }
        const entry_heap = try self.heap(.entry); const entry_control = try self.control(.entry);
        for (self.blocks) |*flow| { try self.b.c.charge(3); flow.* = .{ .heap = try self.heap(.{ .join = .{ .inputs = &.{} } }), .control = try self.control(.{ .join = .{ .inputs = &.{} } }) }; }
        try self.insert(&self.incoming_heaps[0], entry_heap); try self.insert(&self.incoming_controls[0], entry_control);
    }
    fn finish(self: *CFG, result: *Projection) context.Error!void {
        for (self.cells, self.cell_inputs) |id, incoming| { try self.b.c.step(); if (id) |node_id| self.b.nodes.items[node_id].join.inputs = incoming.items; }
        for (self.b.registers, self.values) |id, incoming| { try self.b.c.step(); if (id) |node_id| self.b.nodes.items[node_id].join.inputs = incoming.items; }
        for (self.blocks, self.incoming_heaps, self.incoming_controls) |flow, heaps, controls| { try self.b.c.charge(3); self.heaps.items[flow.heap].join.inputs = heaps.items; self.controls.items[flow.control].join.inputs = controls.items; }
        if (self.receiver_protocol) {
            try self.b.c.charge(self.blocks.len); const block_controls = try self.b.allocator.alloc(origin.Ref, self.blocks.len);
            for (self.blocks, block_controls) |flow, *control_id| { try self.b.c.step(); control_id.* = flow.control; }
            try self.b.c.charge(3); result.block_controls = block_controls; result.receiver_actions = self.receiver_actions.items; result.field_stores = self.field_stores.items;
        }
        try self.b.c.row(origin.Graph); result.graph = .{ .nodes = self.b.nodes.items, .heaps = self.heaps.items, .controls = self.controls.items, .calls = &.{}, .normal = self.normal.items, .language = self.language.items, .exits = .{ .normal = self.normal_exits.items, .language = self.language_exits.items }, .accesses = self.accesses.items };
    }
    fn insert(self: *CFG, into: *RefList, id: origin.Ref) context.Error!void {
        var at: usize = 0;
        while (at < into.items.len) : (at += 1) { try self.b.c.step(); if (into.items[at] == id) return; if (into.items[at] > id) break; }
        try self.b.c.charge(into.items.len - at + 1);
        if (into.items.len == into.capacity) try self.b.c.charge(into.items.len + 1);
        try into.insert(self.b.allocator, at, id);
    }
    fn heap(self: *CFG, row: origin.Heap) context.Error!origin.Ref {
        const fields: usize = switch (row) { .entry => 0, inline else => |payload| @typeInfo(@TypeOf(payload)).@"struct".fields.len };
        try self.b.c.charge(fields + 1);
        if (self.heaps.items.len == self.heaps.capacity) try self.b.c.charge(self.heaps.items.len + 1);
        const id = self.heaps.items.len; try self.heaps.append(self.b.allocator, row); return id;
    }
    fn control(self: *CFG, row: origin.Control) context.Error!origin.Ref {
        const fields: usize = switch (row) { .entry => 0, inline else => |payload| @typeInfo(@TypeOf(payload)).@"struct".fields.len };
        try self.b.c.charge(fields + 1);
        if (self.controls.items.len == self.controls.capacity) try self.b.c.charge(self.controls.items.len + 1);
        const id = self.controls.items.len; try self.controls.append(self.b.allocator, row); return id;
    }
    fn one(self: *CFG, id: origin.Ref) context.Error![]const origin.Ref {
        try self.b.c.charge(2); const row = try self.b.allocator.alloc(origin.Ref, 1); row[0] = id; return row;
    }
    fn registerRef(self: *CFG, ref: t.RegisterRef) origin.Ref { return self.b.registers[@intFromEnum(ref)].?; }
    fn define(self: *CFG, reg: t.RegisterRef, value: origin.Ref, control_id: origin.Ref) context.Error!void {
        const target = self.b.registers[@intFromEnum(reg)].?;
        const view = self.b.nodes.items[target].join.@"type";
        const gated = try self.b.value(.{ .gate = .{ .@"type" = view, .inputs = try self.one(value), .control = control_id } });
        try self.insert(&self.values[@intFromEnum(reg)], gated);
    }
    fn connect(self: *CFG, target: t.BlockRef, flow: Flow, arguments: []const origin.Ref) context.Error!void {
        const index = @intFromEnum(target);
        try self.insert(&self.incoming_heaps[index], flow.heap); try self.insert(&self.incoming_controls[index], flow.control);
        for (self.f.blocks[index].parameters, arguments) |reg, value| { try self.b.c.step(); try self.insert(&self.values[@intFromEnum(reg)], value); }
    }
    fn branch(self: *CFG, target: t.BlockRef, flow: Flow, operands: []const t.RegisterRef) context.Error!void {
        try self.b.c.charge(operands.len); const args = try self.b.allocator.alloc(origin.Ref, operands.len);
        for (operands, args) |reg, *value| { try self.b.c.step(); value.* = self.registerRef(reg); }
        try self.connect(target, flow, args);
    }
    fn action(self: *CFG, flow: Flow, name: origin.ReceiverAction, frame: origin.Ref, operands: []const origin.Ref, completion: origin.Completion, view: ?origin.Symbol) context.Error!struct { flow: Flow, value: origin.Ref } {
        const h = try self.heap(.{ .receiver_action = .{ .previous = flow.heap, .control = flow.control, .frames = try self.one(frame), .action = name, .operands = operands, .completion = completion } });
        const control_id = try self.control(.{ .receiver_completion = .{ .action = h } });
        const value = try self.b.value(.{ .receiver_value = .{ .@"type" = view, .action = h } });
        try self.b.c.charge(3);
        return .{ .flow = .{ .heap = h, .control = control_id }, .value = value };
    }
    fn exit(self: *CFG, into: *std.ArrayListUnmanaged(origin.Exit), flow: Flow) context.Error!void {
        var at: usize = 0;
        while (at < into.items.len) : (at += 1) {
            try self.b.c.step(); const old = &into.items[at];
            if (old.heap == flow.heap and old.control == flow.control) return;
            if (old.heap > flow.heap or (old.heap == flow.heap and old.control > flow.control)) break;
        }
        try self.b.c.charge(into.items.len - at + 1);
        if (into.items.len == into.capacity) try self.b.c.charge(into.items.len + 1);
        try into.insert(self.b.allocator, at, .{ .heap = flow.heap, .control = flow.control });
    }
    fn fieldAddress(self: *CFG, index: t.FieldRef, receiver_view: t.TypeRef) context.Error!?FieldAddress {
        const field = &self.b.c.program.tables.mode.common.members.fields[@intFromEnum(index)];
        const view = try self.b.typeSymbol(receiver_view) orelse return null;
        const id = try refs.symbol(self.b.c, self.b.allocator, field.id);
        self.b.budget.lookup(self.b.directory.fields.len, id.len) catch |err| return refs.graphFailure(err);
        var lo: usize = 0; var hi = self.b.directory.fields.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            switch (std.mem.order(u8, self.b.directory.fields[mid], id)) {
                .lt => lo = mid + 1, .gt => hi = mid,
                .eq => { try self.b.c.charge(3); return .{ .id = self.b.directory.fields[mid], .view = view }; },
            }
        }
        self.b.pending = .archive_field; return null;
    }
    fn access(self: *CFG, flow: Flow, bases: []const origin.Ref, flag: origin.AccessFlag) context.Error!void {
        // Canonical keys order by decimal JSON text, not numeric Ref order.
        // Count/render, allocation, comparisons and both list shifts are paid.
        try self.b.c.charge(2 * (80 + 24 * (bases.len + 1)));
        const key = try std.json.Stringify.valueAlloc(self.b.allocator, .{ .control = flow.control, .flag = @tagName(flag), .values = bases }, .{});
        var at: usize = 0; var found = false;
        while (at < self.access_keys.items.len) : (at += 1) {
            try self.b.c.step(); try self.b.c.charge(key.len / 8 + self.access_keys.items[at].len / 8 + 2);
            const order = std.mem.order(u8, self.access_keys.items[at], key);
            if (order == .eq) { found = true; break; } if (order == .gt) break;
        }
        if (!found) {
            try self.b.c.charge(2 * (self.access_keys.items.len - at + 1) + 4);
            if (self.accesses.items.len == self.accesses.capacity) try self.b.c.charge(self.accesses.items.len + 1);
            if (self.access_keys.items.len == self.access_keys.capacity) try self.b.c.charge(self.access_keys.items.len + 1);
            try self.accesses.insert(self.b.allocator, at, .{ .values = bases, .flag = flag, .control = flow.control });
            try self.access_keys.insert(self.b.allocator, at, key);
        }
    }
    fn store(self: *CFG, flow: Flow, bases: []const origin.Ref, selector: origin.Symbol, view: origin.Symbol, values: []const origin.Ref, initialize: bool) context.Error!Flow {
        try self.access(flow, bases, .write);
        const next = try self.heap(.{ .store = .{ .previous = flow.heap, .bases = bases, .selector = selector, .view = view, .values = values, .control = flow.control, .initialize = initialize } });
        try self.b.c.charge(3); return .{ .heap = next, .control = flow.control };
    }
    fn fieldSelector(self: *CFG, id: origin.Symbol) context.Error!origin.Symbol {
        // Original semantic identity, never an offset or capacity route.
        try self.b.c.charge(id.len + 7); return std.mem.concat(self.b.allocator, u8, &.{ "field:", id });
    }
    fn select(self: *CFG, flow: Flow, bases: []const origin.Ref, selector: origin.Symbol, view: origin.Symbol, result_type: origin.Symbol) context.Error!origin.Ref {
        try self.access(flow, bases, .read);
        return self.b.value(.{ .projection = .{ .@"type" = result_type, .bases = bases, .selector = selector, .view = view, .heap = flow.heap, .control = flow.control } });
    }
    fn site(self: *CFG, function_id: origin.Symbol, op: *const wire.instruction.Instruction, block: usize, ordinal: usize) context.Error!origin.Symbol {
        try self.b.c.charge(128); const suffix = try std.fmt.allocPrint(self.b.allocator, "body-copy:{d}:{d}", .{ block, ordinal });
        try self.b.c.charge(2 * (function_id.len + suffix.len + 64));
        return std.json.Stringify.valueAlloc(self.b.allocator, .{ function_id, op.source.start, op.source.end, suffix }, .{});
    }
    fn global(self: *CFG, index: t.GlobalRef) context.Error!?origin.Ref {
        const row = &self.b.c.program.tables.mode.common.modules.globals[@intFromEnum(index)];
        const view = try self.b.typeSymbol(row.@"type") orelse return null;
        const id = try refs.symbol(self.b.c, self.b.allocator, row.id);
        self.b.budget.lookup(self.b.directory.globals.len, id.len) catch |err| return refs.graphFailure(err);
        var lo: usize = 0; var hi = self.b.directory.globals.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2; const original = &self.b.directory.globals[mid];
            switch (std.mem.order(u8, original.id, id)) {
                .lt => lo = mid + 1, .gt => hi = mid,
                .eq => {
                    if (!(self.b.budget.equal(original.@"type", view) catch |err| return refs.graphFailure(err))) break;
                    return try self.b.value(.{ .global = .{ .@"type" = view, .id = original.id } });
                },
            }
        }
        self.b.pending = .archive_global; return null;
    }
    fn arrayView(self: *CFG, receiver: t.RegisterRef) context.Error!?origin.Symbol {
        const ref = self.f.registers[@intFromEnum(receiver)].view orelse { self.b.pending = .view; return null; };
        try self.b.c.step();
        // A span needs its backing-owner/start projection, which is not an
        // Array identity. This is an interpretation gate, not an Actual tag.
        const kind = self.b.c.program.tables.mode.common.types[@intFromEnum(ref)].kind;
        if (kind != .array) { self.b.pending = if (kind == .readSpan) .span_transfer else .array_view; return null; }
        return self.b.typeSymbol(ref);
    }
    fn construction(self: *CFG, index: t.ConstructionIndex) context.Error!?origin.Symbol {
        const v = &self.b.c.program.tables.mode.common; const current = &v.members.constructions[@intFromEnum(index)];
        const implicit_base = current.kind == .@"implicit-base";
        if (current.kind != .explicit and !implicit_base) { self.b.pending = .implicit_protocol; return null; }
        // These are existing checked declaration facts, not an invented body.
        // Only the empty implicit-base signature is covered by this projection;
        // every real inline operation/field/token remains in the current graph.
        if (implicit_base) {
            try self.b.c.charge(4);
            if (current.function != null or v.types[@intFromEnum(current.owner)].base != null or current.parameters.len != 0 or current.signature.parameters.len != 0) {
                self.b.pending = .implicit_protocol; return null;
            }
        }
        const id = try refs.symbol(self.b.c, self.b.allocator, current.id);
        const owner = try self.b.typeSymbol(current.owner) orelse return null;
        const base = if (v.types[@intFromEnum(current.owner)].base) |ref| try self.b.typeSymbol(ref) else null;
        if (self.b.pending != null) return null;
        const function = if (current.function) |ref| try refs.symbol(self.b.c, self.b.allocator, self.b.c.program.functions[@intFromEnum(ref)].id) else null;
        self.b.budget.lookup(self.b.directory.constructions.len, id.len) catch |err| return refs.graphFailure(err);
        var lo: usize = 0; var hi = self.b.directory.constructions.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2; const row = &self.b.directory.constructions[mid];
            switch (std.mem.order(u8, row.id, id)) {
                .lt => lo = mid + 1, .gt => hi = mid,
                .eq => {
                    const same_owner = self.b.budget.equal(owner, row.owner) catch |err| return refs.graphFailure(err);
                    var same_base = (base == null) == (row.base == null);
                    if (same_base and base != null) same_base = self.b.budget.equal(base.?, row.base.?) catch |err| return refs.graphFailure(err);
                    var same_function = if (implicit_base) function == null and row.function_id == null else function != null and row.function_id != null;
                    if (same_function and function != null) same_function = self.b.budget.equal(function.?, row.function_id.?) catch |err| return refs.graphFailure(err);
                    if ((implicit_base and row.kind != .implicit_base) or (!implicit_base and row.kind != .explicit) or !same_owner or !same_base or !same_function) break;
                    return id;
                },
            }
        }
        self.b.pending = .archive_construction; return null;
    }
};

const ReceiverMode = enum { certificate, control, effects };
fn receiverBody(c: *context.Context, function: t.FunctionRef, directory: *const origin.Directory, budget: *origin.Budget, result: *Projection, mode: ReceiverMode) context.Error!void {
    const control_only = mode == .control;
    const v = &c.program.tables.mode.common; const f = &c.program.functions[@intFromEnum(function)]; const abi = &v.abis[@intFromEnum(f.abi)];
    if (abi.lexical_environment != null or abi.construction == null or abi.receiver_frame == null) { result.pending = .entry_protocol; return; }
    // Every block/op has already passed the same Context's SSA AND receiver
    // protocol checker. These checks only bound this projection's semantics.
    for (f.registers) |*reg| { try c.step(); switch (reg.carrier) { .domain, .@"type", .payload, .receiver, .initialization, .cell => {}, else => { result.pending = .entry_protocol; return; } } }
    if (mode == .certificate) for (abi.parameters, abi.argument_types, 0..) |binding, incoming, index| {
        // This joins the graph parameter annotation to its admitted interface.
        // It does not constrain or convert the actual Data category.
        try c.charge(3); const declared = v.storage.bindings[@intFromEnum(binding)].@"type";
        if (incoming != declared or f.registers[@intFromEnum(f.blocks[0].parameters[index + 1])].view != declared) { result.pending = .raw_input; return; }
    };
    for (f.blocks) |*block| for (block.instructions) |*op| {
        try c.step();
        // A checked implicit-base child stays a separate frame and allocation.
        // Its parent/newTarget edge, both completions, initialization prefix and
        // later explicit parent bind are all projected below without shortening.
        // Other delegated constructor bodies still require a call-aware domain.
        if (op.data == .receiver_child and v.members.constructions[@intFromEnum(op.data.receiver_child.construction)].kind != .@"implicit-base") {
            result.pending = .implicit_protocol; return;
        }
        switch (op.data) {
            .fuel, .const_i32, .const_integer, .const_bool, .const_float, .string_constant, .domain_literal, .domain_view,
            .receiver_create, .receiver_child, .receiver_allocate, .receiver_bind, .receiver_get, .receiver_result, .initialize_begin, .initialize_end,
            .br, .@"return", .eh_raise, .eh_unreachable => {},
            .eh_cell, .eh_load, .eh_store, .cond_br, .eh_route, .domain_refine, .eh_assertion, .eh_pack, .eh_carrier, .eh_presence_widen, .domain_copy, .initialize_field => {},
            else => { result.pending = .operation; return; },
        }
    };
    const a = result.arena.allocator();
    try c.charge(f.registers.len); const registers = try a.alloc(?origin.Ref, f.registers.len); @memset(registers, null);
    var b = Builder{ .c = c, .allocator = a, .directory = directory, .budget = budget, .registers = registers };
    var cfg = try CFG.init(&b, f); cfg.receiver_protocol = true;
    _ = try cfg.construction(abi.construction.?);
    if (b.pending) |reason| { result.pending = reason; return; }
    const root = &v.members.constructions[@intFromEnum(abi.construction.?)];
    if (root.function != function) { result.pending = .entry_protocol; return; }
    try cfg.start();
    if (b.pending) |reason| { result.pending = reason; return; }
    const input = try b.value(.receiver_input);
    const frame_register = f.blocks[0].parameters[abi.receiver_frame.?];
    try cfg.insert(&cfg.values[@intFromEnum(frame_register)], input);
    for (abi.parameters, 0..) |_, index| {
        try c.step(); const reg = f.blocks[0].parameters[index + 1];
        // Actual data categories remain arbitrary: neither raw nor static Type
        // is an entry conversion or an actual-tag proof. Control frames cannot
        // be stored in a language Cell under the prerequisite SSA protocol.
        const value = if (!control_only) blk: {
            const view = try b.typeSymbol(abi.argument_types[index]) orelse break;
            break :blk try b.value(.{ .parameter = .{ .@"type" = view, .index = index + 1 } });
        } else try b.value(.unknown);
        try cfg.insert(&cfg.values[@intFromEnum(reg)], value);
    }
    if (!control_only) {
        // Conditional lexical Cell owners, never Object or Frame identities.
        // All control-gated writes join; old values across repeated births are
        // retained conservatively, with no last-value or alias proof.
        try c.charge(2 * v.exceptions.bindings.len);
        cfg.cells = try a.alloc(?origin.Ref, v.exceptions.bindings.len); @memset(cfg.cells, null);
        cfg.cell_inputs = try a.alloc(RefList, v.exceptions.bindings.len); @memset(cfg.cell_inputs, .empty);
        for (f.blocks) |*block| for (block.instructions) |*op| {
            try c.step(); if (op.data != .eh_cell) continue;
            const index = @intFromEnum(op.data.eh_cell.binding);
            const binding = v.storage.bindings[@intFromEnum(v.exceptions.bindings[index].binding)];
            const owner = switch (binding.owner) { .param, .local, .receiver => |owner_id| owner_id, else => { result.pending = .entry_protocol; return; } };
            if (owner != function) { result.pending = .entry_protocol; return; }
            if (cfg.cells[index] == null) { const view = try b.typeSymbol(binding.@"type") orelse break; cfg.cells[index] = try b.value(.{ .join = .{ .@"type" = view, .inputs = &.{} } }); }
        };
    }
    if (b.pending) |reason| { result.pending = reason; return; }
    const function_id = try refs.symbol(c, a, f.id);
    for (f.blocks, 0..) |*block, block_index| {
        try c.row(Flow); var flow = cfg.blocks[block_index];
        for (block.instructions, 0..) |*op, ordinal| {
            try c.step(); switch (op.data) {
                .fuel => {},
                .const_i32, .const_integer, .const_bool, .const_float, .string_constant, .domain_literal => {
                    const reg = op.result.?; const view = if (f.registers[@intFromEnum(reg)].view) |ref| try b.typeSymbol(ref) else null;
                    if (b.pending != null) break;
                    var category: origin.Category = .other;
                    if (op.data == .domain_literal) switch (v.types[@intFromEnum(op.data.domain_literal.actual_type)].kind) {
                        .@"undefined" => category = .@"undefined", .scalar, .string, .@"null", .@"void" => {}, else => { b.pending = .literal_protocol; break; },
                    };
                    const value = try b.value(.{ .literal = .{ .@"type" = view, .category = category } }); try cfg.define(reg, value, flow.control);
                },
                .eh_cell => {},
                .eh_store => |row| if (!control_only) {
                    const index = @intFromEnum(row.binding);
                    if (cfg.cells[index] == null) { b.pending = .entry_protocol; break; }
                    const value = try b.value(.{ .gate = .{ .@"type" = null, .inputs = try cfg.one(cfg.registerRef(op.operands[1])), .control = flow.control } });
                    try cfg.insert(&cfg.cell_inputs[index], value);
                },
                .eh_load => |row| {
                    const value = if (!control_only) cfg.cells[@intFromEnum(row.binding)] orelse { b.pending = .entry_protocol; break; } else try b.value(.unknown);
                    try cfg.define(op.result.?, value, flow.control);
                },
                .domain_copy => |row| {
                    const view = try b.typeSymbol(row.static_view) orelse break;
                    // Keep the original copy equation. A return certificate
                    // also retains its heap edge; control/effect projections
                    // grant no physical clone, alias or holding proof.
                    const copied = try b.value(.{ .copy = .{ .@"type" = view, .bases = try cfg.one(cfg.registerRef(op.operands[0])), .site = try cfg.site(function_id, op, block_index, ordinal), .heap = flow.heap, .control = flow.control } });
                    if (mode == .certificate) flow.heap = try cfg.heap(.{ .copy = .{ .previous = flow.heap, .value = copied } });
                    try cfg.define(op.result.?, copied, flow.control);
                },
                .domain_refine, .eh_assertion, .eh_pack, .eh_carrier, .eh_presence_widen => try cfg.define(op.result.?, cfg.registerRef(op.operands[0]), flow.control),
                .domain_view => {
                    if (mode != .certificate) { try cfg.define(op.result.?, cfg.registerRef(op.operands[0]), flow.control); continue; }
                    const from = &f.registers[@intFromEnum(op.operands[0])]; const into = &f.registers[@intFromEnum(op.result.?)];
                    var view_supported = from.view == into.view;
                    if (!view_supported) {
                        // A pure view does not convert the original Data. Only
                        // this same owned reference carrier has an alias proof;
                        // no frame, token, Cell, Env or new category is inferred.
                        try c.charge(4);
                        view_supported = from.carrier == .@"type" and into.carrier == .@"type" and
                            from.carrier.@"type" == into.carrier.@"type" and
                            v.types[@intFromEnum(from.carrier.@"type")].kind == .reference;
                    }
                    if (!view_supported or !std.meta.eql(from.carrier, into.carrier) or from.carrier == .initialization) { b.pending = .view; break; }
                    try cfg.define(op.result.?, cfg.registerRef(op.operands[0]), flow.control);
                },
                inline .receiver_create, .receiver_child => |row| {
                    const role = try cfg.construction(row.construction) orelse break;
                    const target = if (@hasField(@TypeOf(row), "new_target")) try b.typeSymbol(row.new_target) else null;
                    if (b.pending != null) break;
                    // Both formatters count then render; prepay both bounded
                    // passes using the existing per-byte work, before either.
                    try c.charge(128); const suffix = try std.fmt.allocPrint(a, "receiver-frame:{d}:{d}", .{ block_index, ordinal });
                    try c.charge(2 * (function_id.len + suffix.len + 64));
                    const site = try std.json.Stringify.valueAlloc(a, .{ function_id, op.source.start, op.source.end, suffix }, .{});
                    const parent = if (op.data == .receiver_child) try cfg.one(cfg.registerRef(op.operands[0])) else null;
                    const frame = try b.value(.{ .receiver_frame = .{ .construction = role, .new_target = target, .parent = parent, .site = site, .control = flow.control } });
                    try cfg.define(op.result.?, frame, flow.control);
                },
                .receiver_allocate => |row| {
                    _ = try cfg.construction(row.construction) orelse break;
                    const view = try b.view(f, op.result.?) orelse break;
                    const selected = try cfg.action(flow, .allocate, cfg.registerRef(op.operands[0]), &.{}, .normal, view);
                    flow = selected.flow; try cfg.define(op.result.?, selected.value, flow.control);
                },
                inline .receiver_bind, .receiver_get, .receiver_result => |row| {
                    _ = try cfg.construction(row.construction) orelse break;
                    const view = try b.view(f, f.blocks[@intFromEnum(row.normal)].parameters[0]) orelse break;
                    const operands = if (op.operands.len == 2) try cfg.one(cfg.registerRef(op.operands[1])) else &.{};
                    const name: origin.ReceiverAction = switch (op.data) { .receiver_bind => .bind, .receiver_get => .get, .receiver_result => .result, else => unreachable };
                    const normal = try cfg.action(flow, name, cfg.registerRef(op.operands[0]), operands, .normal, view);
                    const language = try cfg.action(flow, name, cfg.registerRef(op.operands[0]), operands, .language, null);
                    try cfg.connect(row.normal, normal.flow, try cfg.one(normal.value)); try cfg.connect(row.language, language.flow, try cfg.one(language.value));
                    try c.row(ReceiverControl);
                    if (cfg.receiver_actions.items.len == cfg.receiver_actions.capacity) try c.charge(cfg.receiver_actions.items.len + 1);
                    try cfg.receiver_actions.append(a, .{ .block = block_index, .instruction = ordinal, .normal = normal.flow.heap, .language = language.flow.heap, .normal_control = normal.flow.control, .language_control = language.flow.control });
                },
                inline .initialize_begin, .initialize_end => |row| { _ = try cfg.construction(row.construction) orelse break; },
                .initialize_field => |row| {
                    _ = try cfg.construction(row.construction) orelse break;
                    // This projection establishes control only. Language data
                    // stores do not bind a receiver frame; owner/field duties
                    // remain with the complete UpperGraph and Borrow checks.
                    if (control_only) continue;
                    {
                        const field = &v.members.fields[@intFromEnum(row.field)];
                        const owner = v.members.constructions[@intFromEnum(row.construction)].owner;
                        if (field.owner != owner) { b.pending = .receiver_fields; break; }
                        const address = try cfg.fieldAddress(row.field, owner) orelse break;
                        flow = try cfg.store(flow, try cfg.one(cfg.registerRef(op.operands[1])), try cfg.fieldSelector(address.id), address.view, try cfg.one(cfg.registerRef(op.operands[2])), true);
                        try c.row(ReceiverField);
                        if (cfg.field_stores.items.len == cfg.field_stores.capacity) try c.charge(cfg.field_stores.items.len + 1);
                        try cfg.field_stores.append(a, .{ .block = block_index, .instruction = ordinal, .field = row.field, .store = flow.heap });
                        continue;
                    }
                },
                .br => |row| {
                    try cfg.branch(row.destination, flow, op.operands);
                },
                .cond_br => |row| {
                    try cfg.branch(row.true_destination, flow, op.operands[1 .. 1 + row.true_count]);
                    try cfg.branch(row.false_destination, flow, op.operands[1 + row.true_count ..]);
                },
                .eh_route => |row| try cfg.branch(row.successor, flow, op.operands),
                .@"return", .eh_raise => {
                    const refs_into = if (op.data == .eh_raise) &cfg.language else &cfg.normal;
                    for (op.operands) |reg| { try c.step(); try cfg.insert(refs_into, cfg.registerRef(reg)); }
                    try cfg.exit(if (op.data == .eh_raise) &cfg.language_exits else &cfg.normal_exits, flow);
                },
                .eh_unreachable => {},
                else => unreachable,
            }
            if (b.pending != null) break;
        }
        if (b.pending != null) break;
    }
    if (b.pending) |reason| { result.pending = reason; return; }
    try cfg.finish(result);
}

// Directory/typed current Fn are borrowed from this Context's complete owning
// validation. Budget must charge that same Context; it is never reset here.
pub fn project(c: *context.Context, function: t.FunctionRef, directory: *const origin.Directory, budget: *origin.Budget) context.Error!Projection {
    var result = Projection{ .arena = std.heap.ArenaAllocator.init(c.allocator) }; errdefer result.deinit();
    if (c.program.tables.mode != .common) { result.pending = .mode; return result; }
    const f = &c.program.functions[@intFromEnum(function)]; const v = &c.program.tables.mode.common;
    const abi = &v.abis[@intFromEnum(f.abi)];
    if (f.role == .construction_body) { try receiverBody(c, function, directory, budget, &result, .certificate); return result; }
    if (f.role != .ordinary or abi.receiver != null or abi.construction != null or abi.receiver_frame != null or abi.lexical_environment != null) { result.pending = .entry_protocol; return result; }
    for (f.registers) |*reg| { try c.step(); switch (reg.carrier) { .domain, .@"type", .payload => {}, else => { result.pending = .entry_protocol; return result; } } }
    for (abi.parameters, abi.argument_types, 0..) |binding, incoming, index| {
        try c.step(); const declared = v.storage.bindings[@intFromEnum(binding)].@"type";
        if (incoming != declared or f.registers[@intFromEnum(f.blocks[0].parameters[index])].view != declared) { result.pending = .raw_input; return result; }
    }
    // This complete-op preflight does not omit dead definitions, side effects,
    // calls, handlers or terminators. Unsupported semantics make the WHOLE body
    // unavailable; all malformed references were already rejected upstream.
    for (f.blocks) |*block| { try c.step(); for (block.instructions) |*op| {
        try c.step(); switch (op.data) {
            .fuel, .const_i32, .const_integer, .const_bool, .const_float, .string_constant, .domain_literal, .domain_view,
            .br, .cond_br, .eh_pack, .@"return", .eh_raise, .eh_unreachable,
            .global_load, .domain_field_read, .domain_field_store, .domain_array_read, .domain_array_store, .domain_array_length, .domain_array_resize,
            .common_typed_array_create, .domain_array_create, .domain_copy => {},
            .global_store => { result.pending = .global_payload; return result; },
            .domain_read_span => { result.pending = .span_transfer; return result; },
            .add, .sub, .mul, .div, .rem, .shl, .shr, .ushr, .@"and", .@"or", .xor, .neg, .@"not", .pos, .bool_not, .eq, .ne, .lt, .le, .gt, .ge => {
                // These native operations produce an i32 (or native bool)
                // on success, independently of the operands' Source views.
                // Request aborts (zero divisor/invalid shift), like fuel, have
                // neither normal nor language completion. This may projection
                // conservatively retains the successful result, not an abort
                // or language payload. No numeric evaluation is performed.
                // Domain/assert/copy/convert operations are not this proof.
                const input_code: u8 = if (op.data == .bool_not) 2 else 1;
                for (op.operands) |reg| {
                    try c.charge(4); const row = &f.registers[@intFromEnum(reg)];
                    if (row.carrier != .@"type") { result.pending = .operation; return result; }
                    const actual = &v.types[@intFromEnum(row.carrier.@"type")];
                    if (actual.kind != .scalar or actual.native_code != input_code or row.view != row.carrier.@"type") { result.pending = .operation; return result; }
                }
                const boolean = switch (op.data) { .bool_not, .eq, .ne, .lt, .le, .gt, .ge => true, else => false };
                try c.charge(4); const row = &f.registers[@intFromEnum(op.result.?)];
                if (row.carrier != .@"type") { result.pending = .operation; return result; }
                const actual = &v.types[@intFromEnum(row.carrier.@"type")];
                if (actual.kind != .scalar or actual.native_code != @as(u8, if (boolean) 2 else 1) or row.view != row.carrier.@"type") { result.pending = .operation; return result; }
            },
            else => { result.pending = .operation; return result; },
        }
    } }
    const a = result.arena.allocator();
    try c.charge(f.registers.len); const registers = try a.alloc(?origin.Ref, f.registers.len); @memset(registers, null);
    var builder = Builder{ .c = c, .allocator = a, .directory = directory, .budget = budget, .registers = registers };
    var cfg = try CFG.init(&builder, f); try cfg.start();
    if (builder.pending) |reason| { result.pending = reason; return result; }
    for (abi.parameters, 0..) |binding, index| {
        try c.step(); const reg = f.blocks[0].parameters[index];
        const id = try builder.typeSymbol(v.storage.bindings[@intFromEnum(binding)].@"type") orelse break;
        const input = try builder.value(.{ .parameter = .{ .@"type" = id, .index = index } });
        try cfg.insert(&cfg.values[@intFromEnum(reg)], input);
    }
    if (builder.pending) |reason| { result.pending = reason; return result; }
    const function_id = try refs.symbol(c, a, f.id);
    for (f.blocks, 0..) |*block, block_index| {
        try c.row(Flow); var flow = cfg.blocks[block_index];
        for (block.instructions, 0..) |*op, ordinal| {
        try c.step(); switch (op.data) {
            .fuel => {}, // Request fuel control is not a Graph5 language exit.
            .const_i32, .const_integer, .const_bool, .const_float, .string_constant, .domain_literal => {
                const reg = op.result.?;
                const view = try builder.view(f, reg) orelse break;
                var category: origin.Category = .other;
                if (op.data == .domain_literal) {
                    const actual = v.types[@intFromEnum(op.data.domain_literal.actual_type)].kind;
                    switch (actual) {
                        .@"undefined" => category = .@"undefined",
                        .scalar, .string, .@"null", .@"void" => {},
                        else => { builder.pending = .literal_protocol; break; },
                    }
                    if (builder.pending != null) break;
                }
                // Category is justified by the literal opcode/actual_type,
                // independently of the full retained static Source view.
                const value = try builder.value(.{ .literal = .{ .@"type" = view, .category = category } });
                try cfg.define(reg, value, flow.control);
            },
            .domain_view => {
                const input = op.operands[0]; const output = op.result.?;
                const from = &f.registers[@intFromEnum(input)]; const into = &f.registers[@intFromEnum(output)];
                // A pure view keeps ordinary reference/scalar/String Data.
                // Its optional static annotation need not be in the public
                // archive; ABI, copy and field type uses remain mandatory.
                try c.charge(6);
                const data_alias = from.carrier == .@"type" and into.carrier == .@"type" and
                    from.carrier.@"type" == into.carrier.@"type" and
                    (v.types[@intFromEnum(from.carrier.@"type")].kind == .reference or v.types[@intFromEnum(from.carrier.@"type")].kind == .scalar or v.types[@intFromEnum(from.carrier.@"type")].kind == .string);
                if ((!data_alias and from.view != into.view) or !std.meta.eql(from.carrier, into.carrier)) { builder.pending = .view; break; }
                if (!data_alias) _ = try builder.view(f, output) orelse break;
                try cfg.define(output, cfg.registerRef(input), flow.control);
            },
            .eh_pack => {
                // Actual packing retains the complete Data atom/category. A
                // payload carrier is not a new primitive/undefined literal.
                try cfg.define(op.result.?, cfg.registerRef(op.operands[0]), flow.control);
            },
            .domain_copy => |row| {
                // The real opcode copies actual Value children, retaining
                // reference/code identities. Its full Source view does not
                // choose the actual category or erase the cloning heap edge.
                const view = try builder.typeSymbol(row.static_view) orelse break;
                const copied = try builder.value(.{ .copy = .{ .@"type" = view, .bases = try cfg.one(cfg.registerRef(op.operands[0])), .site = try cfg.site(function_id, op, block_index, ordinal), .heap = flow.heap, .control = flow.control } });
                flow.heap = try cfg.heap(.{ .copy = .{ .previous = flow.heap, .value = copied } });
                try cfg.define(op.result.?, copied, flow.control);
            },
            .global_load => |row| {
                // Graph.global denotes the owned global root. No store is
                // admitted in this body, and calls cannot replace its payload.
                const value = try cfg.global(row.global) orelse break;
                try cfg.access(flow, try cfg.one(value), .read);
                try cfg.define(op.result.?, value, flow.control);
            },
            .domain_field_read => |row| {
                const field = try cfg.fieldAddress(row.member, row.receiver_view) orelse break;
                const view = try builder.view(f, op.result.?) orelse break;
                const selected = try cfg.select(flow, try cfg.one(cfg.registerRef(op.operands[0])), try cfg.fieldSelector(field.id), field.view, view);
                try cfg.define(op.result.?, selected, flow.control);
            },
            .domain_field_store => |row| {
                const field = try cfg.fieldAddress(row.member, row.receiver_view) orelse break;
                flow = try cfg.store(flow, try cfg.one(cfg.registerRef(op.operands[0])), try cfg.fieldSelector(field.id), field.view, try cfg.one(cfg.registerRef(op.operands[1])), false);
            },
            .domain_array_read => {
                const view = try cfg.arrayView(op.operands[0]) orelse break;
                const result_type = try builder.view(f, op.result.?) orelse break;
                // The original Graph protocol intentionally merges indices
                // into one element selector. Every index definition remains
                // in the complete graph; no sampled bound prunes the load.
                const selected = try cfg.select(flow, try cfg.one(cfg.registerRef(op.operands[0])), "element", view, result_type);
                try cfg.define(op.result.?, selected, flow.control);
            },
            .domain_array_store => |row| {
                _ = try cfg.arrayView(op.operands[0]) orelse break;
                const view = try builder.typeSymbol(row.receiver_view) orelse break;
                const bases = try cfg.one(cfg.registerRef(op.operands[0]));
                flow = try cfg.store(flow, bases, "element", view, try cfg.one(cfg.registerRef(op.operands[2])), false);
                try cfg.access(flow, bases, .structural);
            },
            .domain_array_length => {
                _ = try cfg.arrayView(op.operands[0]) orelse break;
                try cfg.access(flow, try cfg.one(cfg.registerRef(op.operands[0])), .read);
                const view = try builder.view(f, op.result.?) orelse break;
                // Successful Array length is a native scalar by opcode,
                // independently of the retained view. Request traps have no
                // normal/language completion, just as for native arithmetic.
                const value = try builder.value(.{ .literal = .{ .@"type" = view, .category = .other } });
                try cfg.define(op.result.?, value, flow.control);
            },
            .domain_array_resize => |row| {
                _ = try cfg.arrayView(op.operands[0]) orelse break;
                _ = try builder.typeSymbol(row.receiver_view) orelse break;
                const bases = try cfg.one(cfg.registerRef(op.operands[0]));
                try cfg.access(flow, bases, .write); try cfg.access(flow, bases, .structural);
                // Source Graph5 has no length/index-delete cell. Its May heap
                // retains former element owners after a shrink; no alias is
                // erased or fabricated. The real structural write is kept.
            },
            inline .common_typed_array_create, .domain_array_create => |row| {
                const actual = try builder.typeSymbol(row.actual_array_type) orelse break;
                const value = try builder.value(.{ .local = .{ .@"type" = actual } });
                var elements: RefList = .empty;
                for (op.operands) |reg| { try c.step(); try cfg.insert(&elements, cfg.registerRef(reg)); }
                // Value clones are separate current SSA domain_copy ops. Do
                // not add an AST-inspired copy or drop an existing one.
                flow = try cfg.store(flow, try cfg.one(value), "element", actual, elements.items, true);
                try cfg.define(op.result.?, value, flow.control);
            },
            .add, .sub, .mul, .div, .rem, .shl, .shr, .ushr, .@"and", .@"or", .xor, .neg, .@"not", .pos, .bool_not, .eq, .ne, .lt, .le, .gt, .ge => {
                const reg = op.result.?; const view = try builder.view(f, reg) orelse break;
                // This is the independently defined successful scalar result,
                // not a reclassification of an input by its static view. No
                // external owner, heap write or language completion is added.
                const value = try builder.value(.{ .literal = .{ .@"type" = view, .category = .other } });
                try cfg.define(reg, value, flow.control);
            },
            .br => |row| try cfg.branch(row.destination, flow, op.operands),
            .cond_br => |row| {
                // Same may-control/heap enters BOTH successors. The already
                // owned SSA vectors, not a Source condition or sampled value,
                // select the corresponding phi inputs. No branch is pruned.
                try cfg.branch(row.true_destination, flow, op.operands[1..1 + row.true_count]);
                try cfg.branch(row.false_destination, flow, op.operands[1 + row.true_count..]);
            },
            .@"return", .eh_raise => {
                const into = if (op.data == .eh_raise) &cfg.language else &cfg.normal;
                for (op.operands) |reg| { try c.step(); try cfg.insert(into, cfg.registerRef(reg)); }
                try cfg.exit(if (op.data == .eh_raise) &cfg.language_exits else &cfg.normal_exits, flow);
            },
            .eh_unreachable => {},
            else => unreachable,
        }
        if (builder.pending != null) break;
        }
        if (builder.pending != null) break;
    }
    if (builder.pending) |reason| { result.pending = reason; return result; }
    try cfg.finish(&result);
    return result;
}

// Complete current constructor control projection, separate from return-origin
// certificates and their stronger heap/data admission. All calls are unsupported
// here: complete fixed-callee mayThrow remains in the independent UpperGraph.
pub fn projectReceiverControls(c: *context.Context, function: t.FunctionRef, directory: *const origin.Directory, budget: *origin.Budget) context.Error!Projection {
    var result = Projection{ .arena = std.heap.ArenaAllocator.init(c.allocator) }; errdefer result.deinit();
    if (c.program.tables.mode != .common or c.program.functions[@intFromEnum(function)].role != .construction_body) { result.pending = .entry_protocol; return result; }
    try receiverBody(c, function, directory, budget, &result, .control); return result;
}

// Complete current-body lexical effect origins, separate from actual heap,
// holding and own-return certificates. Owned storage retains all original IDs
// and live-prefix field writes for the one shared consumer.
pub const ReceiverFlow = struct {
    graph: origin.Graph, block_controls: []const origin.Ref, receiver_actions: []const ReceiverControl,
    controls: []const bool, action_results: []const []const construction_domain.Atom,
};
pub const ReceiverEffectProof = struct { flow: ReceiverFlow, fields: []const ReceiverField, initializations: []const construction_domain.Initialization };
pub const ReceiverEffects = struct {
    arena: std.heap.ArenaAllocator, body: Projection, analysis: ?construction_domain.Analysis = null,
    proof: ?ReceiverEffectProof = null,
    pub fn deinit(self: *ReceiverEffects) void { if (self.analysis) |*analysis| analysis.deinit(); self.body.deinit(); self.arena.deinit(); }
};

pub fn coverReceiverEffects(c: *context.Context, function: t.FunctionRef) context.Error!ReceiverEffects {
    var result = ReceiverEffects{ .arena = std.heap.ArenaAllocator.init(c.allocator), .body = .{ .arena = std.heap.ArenaAllocator.init(c.allocator) } }; errdefer result.deinit();
    if (c.program.tables.mode != .common or c.program.functions[@intFromEnum(function)].role != .construction_body) { result.body.pending = .entry_protocol; return result; }
    const fixed = &c.program.tables.mode.common.authority.fixed_publication;
    const directory = try refs.returnOriginDirectory(c, result.arena.allocator(), fixed.*);
    var budget: origin.Budget = .{ .context = c, .charge = refs.graphCharge };
    try receiverBody(c, function, &directory, &budget, &result.body, .effects);
    if (result.body.pending != null) return result;
    const function_id = try refs.symbol(c, result.arena.allocator(), c.program.functions[@intFromEnum(function)].id);
    result.analysis = construction_domain.analyzeEffects(c.allocator, &directory, &result.body.graph.?, &budget, function_id) catch |err| return refs.graphFailure(err);
    if (result.analysis.?.pending != null) return result;
    try c.row(ReceiverEffectProof); try c.row(ReceiverFlow); try c.row(origin.Graph);
    result.proof = .{ .flow = .{ .graph = result.body.graph.?, .block_controls = result.body.block_controls, .receiver_actions = result.body.receiver_actions, .controls = result.analysis.?.controls, .action_results = result.analysis.?.action_results }, .fields = result.body.field_stores, .initializations = result.analysis.?.initializations };
    return result;
}
