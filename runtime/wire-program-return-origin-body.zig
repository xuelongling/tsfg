// SPDX-License-Identifier: MIT
// Independent current normalized-body projection. No fixed graph/Source AST is
// an input. References/layout/SSA/identity are owned by the same Context first.
const std = @import("std");
const wire = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const refs = @import("wire-program-publication-refs.zig");
const origin = @import("wire-program-return-origin-model.zig");
const t = wire.types;
pub const Pending = enum { mode, control_flow, entry_protocol, raw_input, operation, view, archive_type, literal_protocol };
pub const Projection = struct {
    // Node storage is owned here; type symbols borrow Directory, which must
    // outlive this projection (the real consumer's arena encloses both).
    arena: std.heap.ArenaAllocator, pending: ?Pending = null, graph: ?origin.Graph = null,
    pub fn deinit(self: *Projection) void { self.arena.deinit(); }
};
const Builder = struct {
    c: *context.Context, allocator: std.mem.Allocator, directory: *const origin.Directory, budget: *origin.Budget,
    nodes: std.ArrayListUnmanaged(origin.Value) = .empty, registers: []?origin.Ref,
    pending: ?Pending = null,
    fn node(self: *Builder, reg: t.RegisterRef, value: origin.Value) context.Error!void {
        // The only constructed variants here are the two-field parameter and
        // literal payloads: the existing row header + two field-copy units.
        try self.c.charge(3);
        if (self.nodes.items.len == self.nodes.capacity) try self.c.charge(self.nodes.items.len + 1);
        self.registers[@intFromEnum(reg)] = self.nodes.items.len;
        try self.nodes.append(self.allocator, value);
    }
    fn typeSymbol(self: *Builder, ref: t.TypeRef) context.Error!?origin.Symbol {
        const row = &self.c.program.tables.mode.common.types[@intFromEnum(ref)];
        const id = try refs.symbol(self.c, self.allocator, row.id);
        self.budget.lookup(self.directory.types.len, id.len) catch |err| return refs.graphFailure(err);
        var lo: usize = 0; var hi = self.directory.types.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            switch (std.mem.order(u8, self.directory.types[mid].id, id)) { .eq => return self.directory.types[mid].id, .lt => lo = mid + 1, .gt => hi = mid }
        }
        self.pending = .archive_type; return null;
    }
    fn view(self: *Builder, f: *const wire.Function, reg: t.RegisterRef) context.Error!?origin.Symbol {
        const ref = f.registers[@intFromEnum(reg)].view orelse { self.pending = .view; return null; };
        return self.typeSymbol(ref);
    }
};

// Directory/typed current Fn are borrowed from this Context's complete owning
// validation. Budget must charge that same Context; it is never reset here.
pub fn project(c: *context.Context, function: t.FunctionRef, directory: *const origin.Directory, budget: *origin.Budget) context.Error!Projection {
    var result = Projection{ .arena = std.heap.ArenaAllocator.init(c.allocator) }; errdefer result.deinit();
    if (c.program.tables.mode != .common) { result.pending = .mode; return result; }
    const f = &c.program.functions[@intFromEnum(function)]; const v = &c.program.tables.mode.common;
    const abi = &v.abis[@intFromEnum(f.abi)];
    if (f.role != .ordinary or abi.receiver != null or abi.construction != null or abi.receiver_frame != null or abi.lexical_environment != null) { result.pending = .entry_protocol; return result; }
    if (f.blocks.len != 1) { result.pending = .control_flow; return result; }
    for (abi.parameters, abi.argument_types, 0..) |binding, incoming, index| {
        try c.step(); const declared = v.storage.bindings[@intFromEnum(binding)].@"type";
        if (incoming != declared or f.registers[@intFromEnum(f.blocks[0].parameters[index])].view != declared) { result.pending = .raw_input; return result; }
    }
    // This complete-op preflight does not omit dead definitions, side effects,
    // calls, handlers or terminators. Unsupported semantics make the WHOLE body
    // unavailable; all malformed references were already rejected upstream.
    for (f.blocks[0].instructions) |op| {
        try c.step(); switch (op.data) {
            .fuel, .const_i32, .const_integer, .const_bool, .const_float, .string_constant, .domain_literal, .domain_view, .@"return", .eh_unreachable => {},
            else => { result.pending = .operation; return result; },
        }
    }
    const a = result.arena.allocator();
    try c.charge(f.registers.len); const registers = try a.alloc(?origin.Ref, f.registers.len); @memset(registers, null);
    var builder = Builder{ .c = c, .allocator = a, .directory = directory, .budget = budget, .registers = registers };
    for (abi.parameters, 0..) |binding, index| {
        try c.step(); const reg = f.blocks[0].parameters[index];
        const id = try builder.typeSymbol(v.storage.bindings[@intFromEnum(binding)].@"type") orelse break;
        try builder.node(reg, .{ .parameter = .{ .@"type" = id, .index = index } });
    }
    if (builder.pending) |reason| { result.pending = reason; return result; }
    var normal: []const origin.Ref = &.{}; var normal_exit = false;
    for (f.blocks[0].instructions) |op| {
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
                try builder.node(reg, .{ .literal = .{ .@"type" = view, .category = category } });
            },
            .domain_view => {
                const input = op.operands[0]; const output = op.result.?;
                const from = &f.registers[@intFromEnum(input)]; const into = &f.registers[@intFromEnum(output)];
                // Only the exact no-copy/no-control identity subset is known.
                // A different view/carrier or any assert/pack/Value copy stays
                // Pending rather than manufacturing a cast/clone witness.
                if (from.view != into.view or !std.meta.eql(from.carrier, into.carrier)) { builder.pending = .view; break; }
                _ = try builder.view(f, output) orelse break;
                try c.step(); registers[@intFromEnum(output)] = registers[@intFromEnum(input)];
            },
            .@"return" => {
                normal_exit = true;
                if (op.operands.len != 0) {
                    const id = registers[@intFromEnum(op.operands[0])] orelse { builder.pending = .operation; break; };
                    try c.charge(2); const values = try a.alloc(origin.Ref, 1); values[0] = id; normal = values;
                }
            },
            .eh_unreachable => {},
            else => unreachable,
        }
    }
    if (builder.pending) |reason| { result.pending = reason; return result; }
    try c.step(); const heaps = try a.alloc(origin.Heap, 1); heaps[0] = .entry;
    try c.step(); const controls = try a.alloc(origin.Control, 1); controls[0] = .entry;
    var exits: []const origin.Exit = &.{};
    if (normal_exit) { try c.row(origin.Exit); const rows = try a.alloc(origin.Exit, 1); rows[0] = .{ .heap = 0, .control = 0 }; exits = rows; }
    try c.row(origin.Graph);
    result.graph = .{ .nodes = builder.nodes.items, .heaps = heaps, .controls = controls, .calls = &.{}, .normal = normal, .language = &.{}, .exits = .{ .normal = exits, .language = &.{} }, .accesses = &.{} };
    return result;
}
