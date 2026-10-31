// SPDX-License-Identifier: MIT
// Checks references, layouts, CFG/SSA, derivable typed identities and Common
// actual targets, borrow and effects obligations through one shared analysis.
// Complete Host records are bound once to this Runtime's compiled anchor.
// Source and complete fixed-publication/fixed-flow validation remain separate;
// success is not full admission or permission to execute. This module neither
// reads bytes/JSON nor activates Runtime12.
const std = @import("std");
pub const model = @import("wire-program-model.zig");
const t = model.types;
const ins = model.instruction;
const context = @import("wire-program-refcheck-context.zig");
const table_refs = @import("wire-program-table-refs.zig");
const layout_check = @import("wire-program-layout-check.zig");
const ssa_check = @import("wire-program-ssa-check.zig");
const identity_check = @import("wire-program-identity-check.zig");
const fixed_publication_check = @import("wire-program-fixed-publication-check.zig");
const targets_check = @import("wire-program-targets-check.zig");
const borrow_check = @import("wire-program-borrow-check.zig");
const effects_check = @import("wire-program-effects-check.zig");
const host_artifact = @import("wire-program-host-artifact-check.zig");
pub const HostBundle = @import("wire-program-host-binding-check.zig").Bundle;
pub const Error = context.Error || effects_check.FinishError || host_artifact.Error;
const Context = context.Context;

// One budget belongs to the complete traversal; helpers cannot refill it.
// The returned count is accounting only, never a retained verified handle.
// Host-free callers explicitly pass null. Host callers supply complete typed
// records; their presence alone is no proof. The compiled-anchor check below
// owns verification, before any material enters the one solve/final replay.
pub fn check(allocator: std.mem.Allocator, program: *const model.Program, material: ?*const HostBundle) Error!usize {
    var c = Context{ .program = program, .allocator = allocator };
    try c.charge(12);
    model.requireFormat(program.envelope, program.target) catch return error.InvalidShape;
    try c.require(program.tables.sources.len > 0 and program.tables.sources.len <= 128 and
        program.functions.len > 0 and program.functions.len <= 4096);
    var previous: ?[]const u8 = null;
    for (program.tables.sources) |source| {
        try c.row(@TypeOf(source));
        try sourcePath(&c, source.path, true);
        if (previous) |p| {
            try c.charge(1 + @min(p.len, source.path.len) / 64);
            if (std.mem.order(u8, p, source.path) != .lt) return error.InvalidOrder;
        }
        previous = source.path;
    }
    const root = program.tables.sources[try c.ref(program.root_source, program.tables.sources.len)];
    try sourcePath(&c, program.source_path, false);
    try c.charge(2 + root.path.len / 64);
    try c.require(root.length == program.source_length and std.mem.eql(u8, root.path, program.source_path) and
        std.mem.eql(u8, &root.hash, &program.source_hash));
    try table_refs.check(&c);
    var identities = std.AutoHashMapUnmanaged(t.Hash, void){};
    defer identities.deinit(allocator);
    var string_units: usize = 0;
    for (program.functions, 0..) |*function, index| {
        try c.row(model.Function);
        const found = try identities.getOrPut(allocator, function.id);
        if (found.found_existing) return error.InvalidOrder;
        try functionShape(&c, function, index, &string_units);
    }
    try layout_check.check(&c);
    try ssa_check.check(&c);
    try identity_check.check(&c);
    // Fixed interface semantics also owns the Common-only boundary.
    try fixed_publication_check.checkInterfaces(&c);
    try host_artifact.check(&c, material);
    var actual: targets_check.Analysis = .{};
    defer actual.deinit(allocator);
    var borrowing = borrow_check.Observations.init(&c);
    defer borrowing.deinit();
    var effects = try effects_check.Collector.init(&c, material);
    defer effects.deinit();
    const observers = [_]targets_check.facts.Observer{ borrowing.observer(), effects.observer() };
    actual = try targets_check.analyze(&c, material, &observers);
    try borrowing.finish();
    try effects.finish();
    return model.format.max_work - c.remaining;
}

fn physicalParameters(c: *Context, index: usize) Error!usize {
    try c.step();
    const f = c.program.functions[index];
    const a = try c.ref(f.abi, c.counts().abis);
    return switch (c.program.tables.mode) {
        .legacy => |v| v.abis[a].parameters.len + @as(usize, if (v.abis[a].kind == .closure and
            v.closures.functions[index].lexical_environment != null) 1 else 0),
        .exception => |v| v.abis[a].physical_parameters,
        .common => |v| v.abis[a].physical_parameters.len,
    };
}

fn sourcePath(c: *Context, value: []const u8, declarations: bool) Error!void {
    try c.text(value, 4096, 1);
    try c.require(value[0] == '/' and std.mem.endsWith(u8, value, ".ts") and
        (declarations or !std.mem.endsWith(u8, value, ".d.ts")) and std.mem.indexOfScalar(u8, value, '\\') == null);
    var parts = std.mem.splitScalar(u8, value[1..], '/');
    while (parts.next()) |part| {
        try c.step();
        try c.require(part.len > 0 and !std.mem.eql(u8, part, ".") and !std.mem.eql(u8, part, ".."));
    }
}

fn hasResult(c: *Context, index: usize) Error!bool {
    const a = try c.ref(c.program.functions[index].abi, c.counts().abis);
    return switch (c.program.tables.mode) {
        .legacy => |v| v.abis[a].result != null,
        .exception => |v| v.abis[a].result != null,
        .common => |v| v.abis[a].result_carrier != null,
    };
}

fn functionShape(c: *Context, f: *const model.Function, index: usize, string_units: *usize) Error!void {
    try c.anchor(f.declaration, f.source);
    try c.text(f.name, 4096, 1);
    try c.require(f.blocks.len > 0 and f.blocks.len <= 256 and f.registers.len <= 4096);
    const a = try c.ref(f.abi, c.counts().abis);
    switch (c.program.tables.mode) {
        .legacy => |v| try c.require(@intFromEnum(v.abis[a].function) == index and
            std.mem.eql(u8, &v.abis[a].source_signature, &f.signature)),
        .exception => |v| try c.require(@intFromEnum(v.abis[a].function) == index and
            std.mem.eql(u8, &v.abis[a].signature, &f.signature) and f.role != .construction_body),
        .common => |v| try c.require(@intFromEnum(v.abis[a].function) == index and
            std.mem.eql(u8, &v.abis[a].signature, &f.signature)),
    }
    const entry_parameters = switch (c.program.tables.mode) {
        .exception => |v| blk: {
            try c.step();
            break :blk v.storage.frames[@intFromEnum(v.abis[a].frame)].slots.len;
        },
        else => try physicalParameters(c, index),
    };
    try c.require(f.blocks[0].parameters.len == entry_parameters);
    for (f.registers) |r| {
        try c.row(model.Register);
        try c.carrier(r.carrier);
        try c.maybeRef(r.view, c.counts().types);
        if (std.meta.activeTag(r.carrier) == .cell or std.meta.activeTag(r.carrier) == .environment) try c.require(r.view == null);
    }
    // Definition-directory uniqueness is structural. Dominance, use-before-def
    // and actual capacity remain the independent SSA validator's obligations.
    var defined = std.AutoHashMapUnmanaged(t.RegisterRef, void){};
    defer defined.deinit(c.allocator);
    var total: usize = 0;
    for (f.blocks) |b| {
        try c.row(model.Block);
        try c.require(b.parameters.len <= (if (std.meta.activeTag(c.program.tables.mode) == .common) @as(usize, 64) else 4096) and
            b.instructions.len > 0 and b.instructions.len <= 8192 - total);
        total += b.instructions.len;
        for (b.parameters) |r| {
            _ = try c.ref(r, f.registers.len);
            const found = try defined.getOrPut(c.allocator, r);
            if (found.found_existing) return error.InvalidShape;
        }
        for (b.instructions, 0..) |*op, i| {
            try c.row(ins.Instruction);
            if (op.result) |r| {
                _ = try c.ref(r, f.registers.len);
                const found = try defined.getOrPut(c.allocator, r);
                if (found.found_existing) return error.InvalidShape;
            }
            try instructionShape(c, f, index, op, i + 1 == b.instructions.len, string_units);
        }
    }
    // Every declared register belongs to one block parameter or result record.
    try c.charge(f.registers.len);
    try c.require(defined.count() == f.registers.len);
}

fn arity(c: *Context, op: *const ins.Instruction, count: usize, result: bool) Error!void {
    try c.require(op.operands.len == count and (op.result != null) == result);
}
fn block(c: *Context, f: *const model.Function, r: t.BlockRef) Error!usize {
    const n = try c.ref(r, f.blocks.len);
    if (std.meta.activeTag(c.program.tables.mode) != .legacy) try c.require(n != 0);
    return n;
}
fn nestedAnchor(c: *Context, op: *const ins.Instruction, a: t.Anchor) Error!void {
    try c.anchor(a, op.source.source);
    try c.require(a.start >= op.source.start and a.end <= op.source.end and
        (std.meta.activeTag(c.program.tables.mode) == .common or a.start < a.end));
}
fn slot(c: *Context, f: *const model.Function, op: *const ins.Instruction, r: t.EnvironmentSlotRef) Error!void {
    const receiver = f.registers[@intFromEnum(op.operands[0])].carrier;
    try c.require(std.meta.activeTag(receiver) == .environment);
    const e = @intFromEnum(receiver.environment);
    const count = switch (c.program.tables.mode) {
        .legacy => |v| v.closures.environments[e].slots.len,
        .common => |v| v.closures.environments[e].slots.len,
        .exception => return error.WrongMode,
    };
    _ = try c.ref(r, count);
}
fn scope(c: *Context, r: t.ScopeRef, owner: usize) Error!void {
    const n = try c.ref(r, c.counts().scopes);
    try c.require(switch (c.program.tables.mode) {
        .common => |v| @intFromEnum(v.exceptions.scopes[n].owner) == owner,
        .exception => |v| @intFromEnum(v.exceptions.scopes[n].owner) == owner,
        .legacy => false,
    });
}

fn instructionShape(c: *Context, f: *const model.Function, owner: usize, op: *const ins.Instruction,
    terminal: bool, string_units: *usize) Error!void {
    const n = c.counts();
    const code = std.meta.activeTag(op.data);
    const common = std.meta.activeTag(c.program.tables.mode) == .common;
    const exception = std.meta.activeTag(c.program.tables.mode) == .exception;
    try c.origin(op.source);
    try c.require(op.operands.len <= 4096);
    for (op.operands) |r| { _ = try c.ref(r, f.registers.len); }
    if (op.operator_anchor) |a| try nestedAnchor(c, op, a);
    if (op.target_anchor) |a| try nestedAnchor(c, op, a);
    if (!common) {
        try c.require(op.source.source == f.source and op.source.start >= f.declaration.start and op.source.end <= f.declaration.end);
        if (exception) try c.require(op.operator_anchor == null and op.target_anchor == null);
    }
    const ends = switch (code) {
        .@"return", .br, .cond_br, .domain_numeric_use, .eh_invoke, .eh_invoke_indirect,
        .eh_route, .eh_raise, .eh_unreachable, .common_method_invoke => true,
        else => false,
    };
    try c.require(terminal == ends);
    if (common) {
        // This is the actual Common graph-reader vocabulary, not all 94 opcodes
        // merely because another mode has assigned a typed record to them.
        switch (code) {
            .call, .string_length, .string_codeunit, .string_slice, .string_compare,
            .convert_checked, .convert_wrap, .reinterpret, .domain_refine,
            .domain_presence_equal, .domain_identity_equal, .domain_array_create,
            .domain_construct, .domain_super, .domain_initialize_fields, .domain_field_define,
            .domain_field_initialize, .domain_method_call, .domain_member_present, .function_call,
            .eh_project, .eh_pack, .eh_type_test, .eh_presence_widen, .eh_field_read,
            .eh_function, .eh_publish => return error.WrongMode,
            else => {},
        }
    } else if (exception) {
        const value = @intFromEnum(code);
        try c.require(value <= 26 or value == 28 or value == 32 or value == 33 or value == 43 or value == 64 or
            (value >= 72 and value <= 92));
    } else {
        try c.require(@intFromEnum(code) <= 71);
        if (@intFromEnum(code) >= 65) {
            const rows = c.program.tables.mode.legacy;
            try c.require(rows.abis[@intFromEnum(f.abi)].kind == .closure and rows.closures.functions.len == c.program.functions.len);
        }
    }

    switch (code) {
        .const_i32, .const_bool, .const_integer, .const_float, .string_constant, .domain_literal,
        .global_load, .eh_cell, .eh_construct => try arity(c, op, 0, true),
        .@"return" => { try c.require(op.result == null and op.operands.len == @as(usize, if (try hasResult(c, owner)) 1 else 0)); },
        .add, .sub, .mul, .div, .rem, .shl, .shr, .ushr, .@"and", .@"or", .xor,
        .eq, .ne, .lt, .le, .gt, .ge, .string_concat, .string_codeunit, .string_compare,
        .domain_presence_equal, .domain_identity_equal, .domain_array_read, .eh_equal => try arity(c, op, 2, true),
        .neg, .@"not", .bool_not, .pos, .string_length, .convert_checked, .convert_wrap, .reinterpret,
        .domain_view, .domain_copy, .domain_refine, .domain_array_length, .domain_field_read,
        .domain_member_present, .environment_parent, .environment_load, .eh_load, .eh_project,
        .eh_pack, .eh_type_test, .eh_presence_widen, .eh_field_read, .eh_carrier, .eh_assertion => try arity(c, op, 1, true),
        .string_slice, .domain_read_span => try arity(c, op, 3, true),
        .global_store => try arity(c, op, 1, false),
        .domain_array_store => try arity(c, op, 3, false),
        .domain_array_resize, .domain_field_store, .domain_field_initialize,
        .environment_init, .environment_store, .eh_store, .eh_field_initialize => try arity(c, op, 2, false),
        .domain_initialize_fields, .domain_field_define => try arity(c, op, 1, false),
        .fuel, .eh_enter, .eh_publish, .eh_unreachable => try arity(c, op, 0, false),
        .domain_numeric_use, .eh_raise => try arity(c, op, 1, false),
        .br, .cond_br, .domain_super, .eh_route, .eh_invoke, .eh_invoke_indirect,
        .common_method_invoke => try c.require(op.result == null),
        .domain_array_create, .common_typed_array_create, .domain_construct,
        .function_make, .function_call, .eh_function, .environment_alloc => try c.require(op.result != null),
        .authorized_host, .call, .domain_method_call => {}, // Descriptor-specific arity below.
    }
    switch (op.data) {
        .const_i32 => |bits| try c.require(bits <= std.math.maxInt(u32)),
        .string_constant => |units| {
            try c.require(units.len <= 16384 and units.len <= 65536 - string_units.*);
            try c.charge(units.len);
            string_units.* += units.len;
        },
        .br => |v| { const b = try block(c, f, v.destination); try c.require(op.operands.len == f.blocks[b].parameters.len); },
        .cond_br => |v| {
            const a = try block(c, f, v.true_destination); const b = try block(c, f, v.false_destination);
            try c.require(op.operands.len > 0 and v.true_count <= op.operands.len - 1);
            try c.require(f.blocks[a].parameters.len == v.true_count and f.blocks[b].parameters.len == op.operands.len - 1 - v.true_count);
        },
        .call => |v| {
            const target = try c.ref(v.callee, c.program.functions.len);
            try c.require(c.program.functions[target].role == .ordinary);
            try arity(c, op, try physicalParameters(c, target), try hasResult(c, target));
        },
        .global_load => |v| { _ = try c.ref(v.global, n.globals); },
        .global_store => |v| { _ = try c.ref(v.global, n.globals); },
        .authorized_host => |v| {
            const h = try c.ref(v.host, n.hosts);
            const args: usize = switch (c.program.tables.mode) { .common => |rows| rows.modules.hosts[h].parameter_types.len, .legacy => 1, .exception => return error.WrongMode };
            try arity(c, op, args, true);
        },
        .domain_literal => |v| { _ = try c.ref(v.actual_type, n.types); },
        inline .domain_view, .domain_copy => |v| { _ = try c.ref(v.static_view, n.types); },
        .domain_refine => |v| {
            _ = try c.ref(v.static_view, n.types); _ = try c.ref(v.absent_type, n.types);
            _ = try c.ref(v.predicate, f.registers.len); _ = try block(c, f, v.selected_successor);
        },
        .domain_read_span => |v| {
            const index = try c.ref(v.static_view, n.types);
            try c.require(switch (c.program.tables.mode) { .common => |rows| rows.types[index].kind == .readSpan, .legacy => |rows| rows.types[index].kind == .readSpan, .exception => false });
        },
        .domain_array_create => |v| {
            const index = try c.ref(v.actual_array_type, n.types); _ = try c.ref(v.element_domain, n.domains); try c.text(v.owner, 4096, 1);
            try c.require(c.program.tables.mode.legacy.types[index].kind == .array);
        },
        .domain_array_read => |v| { _ = try c.ref(v.element_view, n.types); },
        .domain_array_store => |v| { _ = try c.ref(v.receiver_view, n.types); _ = try c.ref(v.rhs_view, n.types); },
        .domain_array_resize => |v| { _ = try c.ref(v.receiver_view, n.types); },
        inline .domain_field_read, .domain_field_store, .domain_member_present => |v| {
            _ = try c.ref(v.receiver_view, n.types); _ = try c.ref(v.member, n.fields); const d = try c.ref(v.dispatch, n.dispatches);
            const row = switch (c.program.tables.mode) { .common => |rows| rows.views.dispatch[d], .legacy => |rows| rows.views.dispatch[d], .exception => return error.WrongMode };
            try c.require(std.meta.activeTag(row) == .field); try c.require(row.field.view == v.receiver_view and row.field.member == v.member);
            if (code == .domain_field_store) _ = try c.ref(op.data.domain_field_store.rhs_view, n.types);
        },
        .domain_method_call => |v| {
            _ = try c.ref(v.receiver_view, n.types); _ = try c.ref(v.member, n.methods); const d = try c.ref(v.dispatch, n.dispatches);
            const row = c.program.tables.mode.legacy.views.dispatch[d]; try c.require(std.meta.activeTag(row) == .method);
            try c.require(row.method.view == v.receiver_view and row.method.member == v.member and op.operands.len > 0);
            for (row.method.arms) |arm| {
                try c.step(); const target = try c.ref(arm.target orelse return error.InvalidShape, c.program.functions.len);
                try arity(c, op, try physicalParameters(c, target), try hasResult(c, target));
            }
        },
        .domain_construct => |v| {
            const target = try c.ref(v.construction, n.constructions); _ = try c.ref(v.actual_type, n.types);
            const construction = c.program.tables.mode.legacy.members.constructions[target];
            try c.require(construction.owner == v.actual_type);
            const fnref = construction.function;
            const args = try physicalParameters(c, try c.ref(fnref, c.program.functions.len));
            try c.require(args > 0); try arity(c, op, args - 1, true);
        },
        .domain_super => |v| {
            const target = try c.ref(v.construction, n.constructions);
            const fnref = c.program.tables.mode.legacy.members.constructions[target].function;
            try c.require(f.role == .construction_body);
            try arity(c, op, try physicalParameters(c, try c.ref(fnref, c.program.functions.len)), false);
        },
        .domain_initialize_fields => |v| {
            const target = try c.ref(v.construction, n.constructions); _ = try c.ref(v.owner_type, n.types);
            const construction = c.program.tables.mode.legacy.members.constructions[target];
            try c.require(construction.owner == v.owner_type and @intFromEnum(construction.function) == owner and f.role == .construction_body);
        },
        inline .domain_field_define, .domain_field_initialize => |v| {
            const target = try c.ref(v.construction, n.constructions); _ = try c.ref(v.owner_type, n.types); _ = try c.ref(v.field, n.fields);
            const construction = c.program.tables.mode.legacy.members.constructions[target]; const events = construction.events;
            try c.require(construction.owner == v.owner_type and @intFromEnum(construction.function) == owner and f.role == .construction_body);
            try c.require(v.ordinal < events.len and v.ordinal <= 511);
            try c.require(events[v.ordinal].field == v.field);
        },
        .domain_numeric_use => |v| {
            _ = try c.ref(v.target_type, n.types); const successor = try block(c, f, v.normal_successor);
            const operation = @intFromEnum(v.numeric_operator);
            const expected: u8 = if ((operation >= 4 and operation <= 14) or (operation >= 20 and operation <= 23)) 2 else
                if (operation == 15 or operation == 16 or operation == 33) 1 else 0;
            try c.require(expected != 0 and v.numeric_arity == expected and v.numeric_operand < expected);
            try c.require(successor != 0 and f.blocks[successor].parameters.len == 1 and op.operator_anchor == null and op.target_anchor == null);
            try c.text(v.numeric_group, 4096, 1);
        },
        .environment_alloc => |v| {
            const e = try c.ref(v.environment, n.environments);
            const parent = switch (c.program.tables.mode) { .common => |rows| rows.closures.environments[e].parent, .legacy => |rows| rows.closures.environments[e].parent, .exception => return error.WrongMode };
            try arity(c, op, if (parent == null) 0 else 1, true); try c.require(!common or v.anchor_kind == .source);
            const output = f.registers[@intFromEnum(op.result.?)].carrier;
            try c.require(std.meta.activeTag(output) == .environment); try c.require(output.environment == v.environment);
        },
        .environment_parent => {
            const input = f.registers[@intFromEnum(op.operands[0])].carrier;
            const output = f.registers[@intFromEnum(op.result.?)].carrier;
            try c.require(std.meta.activeTag(input) == .environment and std.meta.activeTag(output) == .environment);
            const e = @intFromEnum(input.environment);
            const parent = switch (c.program.tables.mode) { .common => |rows| rows.closures.environments[e].parent, .legacy => |rows| rows.closures.environments[e].parent, .exception => return error.WrongMode };
            try c.require(parent != null); try c.require(output.environment == parent.?);
        },
        .environment_init => |v| { try slot(c, f, op, v.slot); try c.require(!common or v.anchor_kind == .source); },
        inline .environment_load, .environment_store => |v| try slot(c, f, op, v.slot),
        .function_make => |v| {
            const target = try c.ref(v.function, c.program.functions.len);
            try c.require(c.program.functions[target].role == .ordinary);
            var lexical = false;
            switch (c.program.tables.mode) {
                .common => |rows| {
                    var found = false;
                    for (rows.closures.functions) |row| { try c.step(); if (@intFromEnum(row.function) == target) { found = true; lexical = row.lexical_environment != null; } }
                    try c.require(found);
                },
                .legacy => |rows| { lexical = rows.closures.functions[target].lexical_environment != null; },
                .exception => return error.WrongMode,
            }
            try arity(c, op, if (lexical) 1 else 0, true);
        },
        .function_call => |v| try callable(c, f, op, v.signature, null, null),
        inline .eh_cell, .eh_load, .eh_store => |v| {
            _ = try c.ref(v.binding, n.cells);
            const r = if (code == .eh_cell) op.result.? else op.operands[0];
            const carrier = f.registers[@intFromEnum(r)].carrier;
            try c.require(std.meta.activeTag(carrier) == .cell); try c.require(carrier.cell == v.binding);
        },
        .eh_enter => |v| try scope(c, v.scope, owner),
        .eh_project => |v| { _ = try c.ref(v.binding, n.cells); _ = try c.ref(v.target_type, n.types); },
        .eh_pack => |v| { _ = try c.ref(v.payload_type, n.types); },
        .eh_construct => |v| {
            _ = try c.ref(v.owner, n.types); const target = try c.ref(v.constructor, n.constructions);
            const actual = switch (c.program.tables.mode) { .common => |rows| rows.members.constructions[target].owner, .exception => |rows| rows.members.constructions[target].owner, .legacy => return error.WrongMode };
            try c.require(actual == v.owner);
        },
        .eh_field_initialize => |v| { _ = try c.ref(v.field, n.fields); },
        .eh_field_read => |path| { try c.require(path.len > 0 and path.len <= 32); for (path) |r| { _ = try c.ref(r, n.fields); } },
        .eh_function => |v| {
            const target = try c.ref(v.function, c.program.functions.len);
            try c.require(c.program.functions[target].role == .ordinary);
            const captures = switch (c.program.tables.mode) { .exception => |rows| rows.exceptions.functions[target].captures.len, else => return error.WrongMode };
            try arity(c, op, captures, true);
            for (op.operands, c.program.tables.mode.exception.exceptions.functions[target].captures) |r, capture| {
                try c.step(); const carrier = f.registers[@intFromEnum(r)].carrier;
                try c.require(std.meta.activeTag(carrier) == .cell); try c.require(carrier.cell == capture);
            }
        },
        .eh_publish => |v| {
            const m = try c.ref(v.module, n.modules); try c.require(f.role == .module_initializer);
            const initializer = c.program.tables.mode.exception.modules.modules[m].initializer orelse return error.InvalidShape;
            try c.require(@intFromEnum(initializer) == owner);
        },
        .eh_invoke => |v| {
            const target = try c.ref(v.callee, c.program.functions.len);
            try invocation(c, f, op, target, v.normal, v.exceptional);
        },
        .eh_invoke_indirect => |v| {
            try callable(c, f, op, v.callable, v.normal, v.exceptional);
        },
        .eh_route => |v| {
            try scope(c, v.scope, owner); const target = try block(c, f, v.successor);
            try c.require(op.operands.len == f.blocks[target].parameters.len and op.operands.len == @as(usize, if (v.completion == .normal) 0 else 1));
        },
        .eh_carrier => |v| try c.maybeRef(v, n.types),
        .eh_assertion => |v| { _ = try c.ref(v.static_view, n.types); try nestedAnchor(c, op, v.annotation); try nestedAnchor(c, op, v.operator_anchor); },
        .common_method_invoke => |v| {
            _ = try c.ref(v.receiver_view, n.types); _ = try c.ref(v.member, n.methods); const d = try c.ref(v.dispatch, n.dispatches);
            try c.require(op.operands.len > 0); try dualEdges(c, f, v.normal, v.exceptional);
            const rows = c.program.tables.mode.common;
            const row = rows.views.dispatch[d]; try c.require(std.meta.activeTag(row) == .method);
            try c.require(row.method.view == v.receiver_view and row.method.member == v.member);
            // The static method owns the complete evaluated argument list and
            // result shape. An adapted implementation may consume its prefix.
            const method = rows.members.methods[@intFromEnum(v.member)];
            const definition = try c.ref(method.function, c.program.functions.len);
            const static_abi = rows.abis[try c.ref(c.program.functions[definition].abi, rows.abis.len)];
            try c.require(op.operands.len == static_abi.parameters.len + 1);
            const valued = static_abi.result != null;
            try c.require(f.blocks[@intFromEnum(v.normal)].parameters.len == @as(usize, if (valued) 1 else 0));
            for (row.method.arms) |arm| {
                try c.step(); const target = try c.ref(arm.target orelse return error.InvalidShape, c.program.functions.len);
                const implementation = rows.abis[try c.ref(c.program.functions[target].abi, rows.abis.len)];
                try c.require(c.program.functions[target].role == .ordinary and implementation.physical_parameters.len > 0 and
                    implementation.physical_parameters.len <= op.operands.len and (!valued or implementation.result_carrier != null));
            }
        },
        .common_typed_array_create => |v| {
            const index = try c.ref(v.actual_array_type, n.types); try c.carrier(v.element_carrier); try c.text(v.allocation, 4096, 1);
            try c.require(c.program.tables.mode.common.types[index].kind == .array);
        },
        else => try c.step(), // Typed enums/bools/void have no additional directory edge.
    }
}

fn dualEdges(c: *Context, f: *const model.Function, normal: t.BlockRef, exceptional: t.BlockRef) Error!void {
    const a = try block(c, f, normal); const b = try block(c, f, exceptional);
    try c.require(a != b and f.blocks[b].parameters.len == 1);
}
fn invocation(c: *Context, f: *const model.Function, op: *const ins.Instruction, target: usize,
    normal: t.BlockRef, exceptional: t.BlockRef) Error!void {
    try dualEdges(c, f, normal, exceptional);
    const a = try c.ref(c.program.functions[target].abi, c.counts().abis);
    const args = switch (c.program.tables.mode) {
        .common => |v| v.abis[a].physical_parameters.len,
        .exception => |v| v.abis[a].carriers.len + v.abis[a].captures.len,
        .legacy => return error.WrongMode,
    };
    try c.require(op.operands.len == args and c.program.functions[target].role != .module_initializer);
    const returns: usize = if (std.meta.activeTag(c.program.tables.mode) == .exception or try hasResult(c, target)) 1 else 0;
    try c.require(f.blocks[@intFromEnum(normal)].parameters.len == returns);
}

fn callable(c: *Context, f: *const model.Function, op: *const ins.Instruction, signature: t.TypeRef,
    normal: ?t.BlockRef, exceptional: ?t.BlockRef) Error!void {
    const index = try c.ref(signature, c.counts().types);
    var parameters: usize = 0;
    var returns = true;
    switch (c.program.tables.mode) {
        .common => |v| {
            const row = v.types[index]; try c.require(row.kind == .function and row.element != null);
            parameters = row.members.len;
            const result = try c.ref(row.element.?, v.types.len); returns = v.types[result].kind != .@"void";
        },
        .legacy => |v| {
            const row = v.types[index]; try c.require(row.kind == .function and row.element != null);
            parameters = row.members.len;
            const result = try c.ref(row.element.?, v.types.len); returns = v.types[result].kind != .@"void";
        },
        .exception => |v| {
            const row = v.types[index]; try c.require(row.kind == .callable);
            parameters = row.parameters.len;
        },
    }
    try c.require(op.operands.len == parameters + 1);
    if (normal) |a| {
        const b = exceptional orelse return error.InvalidShape;
        try c.require(op.result == null); try dualEdges(c, f, a, b);
        try c.require(f.blocks[@intFromEnum(a)].parameters.len == @as(usize, if (returns) 1 else 0));
    } else try c.require(exceptional == null and (op.result != null) == returns);
}
