// SPDX-License-Identifier: MIT
// The original fixed contract's interface obligations, independently joined
// to the owned Common logical ABI and environment/global directories. These
// are not actual values: declared code bounds never seed an actual analysis.
// This checks parameter coverage, Global owner identity, capture write
// permission and callable signatures;
// it does not derive body fixed-flow/effective dependencies, kernel-group
// independence, Host resource trust, Source provenance or full admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

// Shared fixed-callable classification: one function signature, optionally
// plus null and/or undefined. References/Type structure already passed.
pub fn callableType(c: *Context, common: tables.CommonTables, id: t.TypeRef) Error!?t.TypeRef {
    try c.step();
    const row = common.types[@intFromEnum(id)];
    if (row.kind == .function) return id;
    if (row.kind != .@"union" or row.members.len < 2 or row.members.len > 3) return null;
    var payload: ?t.TypeRef = null;
    for (row.members) |member| {
        try c.step();
        switch (common.types[@intFromEnum(member)].kind) {
            .@"null", .@"undefined" => {},
            .function => {
                if (payload != null) return null;
                payload = member;
            },
            else => return null,
        }
    }
    return payload;
}

const Checker = struct {
    c: *Context,
    common: tables.CommonTables,
    functions: std.AutoHashMapUnmanaged(t.Hash, t.FunctionRef) = .empty,
    globals: std.AutoHashMapUnmanaged(t.Hash, void) = .empty,
    slots: std.AutoHashMapUnmanaged(t.Hash, bool) = .empty,

    fn deinit(self: *Checker) void {
        self.functions.deinit(self.c.allocator);
        self.globals.deinit(self.c.allocator);
        self.slots.deinit(self.c.allocator);
    }

    fn abiFor(self: *const Checker, function: t.FunctionRef) *const storage.CommonAbi {
        const record = self.c.program.functions[@intFromEnum(function)];
        return &self.common.abis[@intFromEnum(record.abi)];
    }

    fn checkTargetSet(self: *Checker, expected_type: t.TypeRef, allowed: publication.CodeTargets) Error!void {
        try self.c.step();
        const expected = self.common.types[@intFromEnum(expected_type)];
        for (allowed.functions) |id| {
            try self.c.step();
            const target = self.functions.get(id) orelse return error.InvalidReference;
            const target_abi = self.abiFor(target);
            // Hidden lexical environments are not logical parameters. A
            // method/constructor receiver cannot masquerade as a free code.
            try self.c.require(target_abi.receiver == null and target_abi.parameters.len == expected.members.len);
            const result_type = expected.element.?;
            if (target_abi.result) |result| {
                try self.c.require(result == result_type);
            } else {
                // A void logical result is null in the normalized Common ABI.
                // Use that representation rule, never the physical carrier.
                try self.c.require(self.common.types[@intFromEnum(result_type)].kind == .@"void");
            }
            for (target_abi.parameters, expected.members) |binding, parameter_type| {
                try self.c.step();
                try self.c.require(self.common.storage.bindings[@intFromEnum(binding)].@"type" == parameter_type);
            }
        }
        // TOP is retained as an original declaration here. Completeness and
        // body containment at individual call sites require fixed-flow, not
        // an invented finite expansion or an actual-value seed from this row.
    }

    fn checkContract(self: *Checker, row: anytype) Error!void {
        const c = self.c;
        try c.step();
        const function = self.functions.get(row.function_id) orelse return error.InvalidReference;
        const abi = self.abiFor(function);
        try c.require(c.program.functions[@intFromEnum(function)].role != .module_initializer);
        // Effects index receiver first, but callable transfer records name
        // logical Source parameters only; neither vector includes hidden env.
        try c.require(row.upper.parameters.len == abi.parameters.len + @as(usize, if (abi.receiver != null) 1 else 0));
        for (row.upper.globals.writes) |id| {
            try c.step();
            // A fixed Global upper names a conditional payload-owner root.
            // Binding replacement is checked at the Global store operation.
            if (!self.globals.contains(id)) return error.InvalidReference;
        }
        for (row.upper.captures) |access| {
            try c.step();
            const writable = self.slots.get(access.slot) orelse return error.InvalidReference;
            try c.require(!access.write or writable);
        }

        var record: usize = 0;
        for (abi.parameters, 0..) |binding, index| {
            try c.step();
            const parameter_type = self.common.storage.bindings[@intFromEnum(binding)].@"type";
            const callable = try callableType(c, self.common, parameter_type) orelse continue;
            try c.require(record < row.callables.parameters.len);
            const bound = row.callables.parameters[record];
            try c.require(bound.index == index);
            try self.checkTargetSet(callable, bound.allowed);
            record += 1;
        }
        try c.require(record == row.callables.parameters.len);
        const returned = if (abi.result) |id| try callableType(c, self.common, id) else null;
        if (returned) |callable| {
            try c.require(row.callables.returns != null);
            try self.checkTargetSet(callable, row.callables.returns.?);
        } else {
            try c.require(row.callables.returns == null);
        }
    }
};

// Preconditions: references/layouts/SSA/derivable identities have already
// succeeded with this SAME Context. In particular all semantic IDs, Type
// structure and ABI logical bindings are joined; no shape/UTF8/hash checks are
// repeated here. Every directory/parameter/capture/target edge traversed below
// pays the existing single non-refillable work budget. Success proves only the
// interface obligations named above, not a fixed-flow/admission certificate.
pub fn checkInterfaces(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) {
        .common => |value| value,
        else => return error.WrongMode,
    };
    var checker = Checker{ .c = c, .common = common };
    defer checker.deinit();
    for (c.program.functions, 0..) |function, index| {
        try c.step();
        try checker.functions.put(c.allocator, function.id, @enumFromInt(index));
    }
    for (common.modules.globals) |global| {
        try c.step();
        try checker.globals.put(c.allocator, global.id, {});
    }
    var has_captures = false;
    for (common.authority.fixed_publication.publication.contracts) |row| {
        try c.step();
        has_captures = has_captures or row.upper.captures.len != 0;
    }
    if (has_captures) for (common.closures.environments) |environment| {
        try c.step();
        for (environment.slots) |slot| {
            try c.step();
            const kind = common.types[@intFromEnum(slot.@"type")].kind;
            // A readonly binding can still write through its managed value.
            // Preserve the original rule's direct Array/reference/value kinds;
            // unions or scalar/string/Span bindings gain no such permission.
            const writable = slot.writable or kind == .array or kind == .reference or kind == .value;
            const entry = try checker.slots.getOrPut(c.allocator, slot.key);
            if (!entry.found_existing) entry.value_ptr.* = writable;
        }
    };
    for (common.authority.fixed_publication.publication.contracts) |row| try checker.checkContract(row);
}
