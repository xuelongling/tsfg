// SPDX-License-Identifier: MIT
// Common construction declarations joined to the already owned typed graph.
// References/layout/SSA/identity are prerequisites with this same Context.
// This does not recover Source syntax or prove the 80/81/85 constructor-body
// protocol, allocation freshness, actual values, borrow safety or admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const members = @import("wire-program-members.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

const Checker = struct {
    c: *Context,
    common: tables.CommonTables,
    constructors: []?t.ConstructionRef,
    own_fields: []std.ArrayListUnmanaged(t.FieldRef),

    fn init(c: *Context, common: tables.CommonTables) Error!Checker {
        try c.charge(common.types.len * 2);
        const constructors = try c.allocator.alloc(?t.ConstructionRef, common.types.len);
        errdefer c.allocator.free(constructors);
        const own_fields = try c.allocator.alloc(std.ArrayListUnmanaged(t.FieldRef), common.types.len);
        @memset(constructors, null);
        @memset(own_fields, .empty);
        return .{ .c = c, .common = common, .constructors = constructors, .own_fields = own_fields };
    }
    fn deinit(self: *Checker) void {
        for (self.own_fields) |*fields| fields.deinit(self.c.allocator);
        self.c.allocator.free(self.own_fields);
        self.c.allocator.free(self.constructors);
    }
    fn sameText(self: *Checker, left: []const u8, right: []const u8) Error!void {
        try self.c.charge(1 + @min(left.len, right.len) / 64);
        try self.c.require(std.mem.eql(u8, left, right));
    }
    fn catalogue(self: *Checker) Error!void {
        const c = self.c;
        for (self.common.members.fields, 0..) |field, index| {
            try c.step();
            // Layout already owns field-binding role/owner and the physical
            // carrier. These are the missing logical declaration joins.
            const owner = self.common.types[@intFromEnum(field.owner)];
            try c.require(field.origin.source == owner.nominal_key.?.source and field.@"type" == field.declared_type and !field.optional);
            const binding = self.common.storage.bindings[@intFromEnum(field.binding)];
            try c.require(binding.@"type" == field.@"type" and binding.writable != field.readonly and
                std.meta.eql(binding.origin orelse return error.InvalidShape, field.origin));
            try self.sameText(binding.name, field.name);
            try self.own_fields[@intFromEnum(field.owner)].append(c.allocator, @enumFromInt(index));
        }
        for (self.common.members.constructions, 0..) |construction, index| {
            try c.step();
            // References already establishes uniqueness of the owner; this
            // table is the derived lookup used for direct-base forwarding.
            self.constructors[@intFromEnum(construction.owner)] = @enumFromInt(index);
        }
        for (self.common.types, 0..) |row, index| {
            try c.step();
            const nominal = row.kind == .reference or row.kind == .value;
            try c.require(nominal == (self.constructors[index] != null));
        }
    }
    fn initialization(self: *Checker, construction: members.CommonConstruction) Error!void {
        const c = self.c;
        const owned = self.own_fields[@intFromEnum(construction.owner)].items;
        // The original initialization vector is all and only the owner's own
        // fields. Ordinary fields precede parameter properties; their order
        // comes from Source positions and parameter ordinals respectively.
        try c.require(construction.initialization_fields.len == owned.len);
        var ordinary: std.ArrayListUnmanaged(t.FieldRef) = .empty;
        defer ordinary.deinit(c.allocator);
        var properties: [64]?t.FieldRef = undefined;
        try c.charge(construction.parameters.len);
        const selected = properties[0..construction.parameters.len];
        @memset(selected, null);
        for (owned) |field_ref| {
            try c.step();
            const field = self.common.members.fields[@intFromEnum(field_ref)];
            var property = false;
            if (construction.kind == .explicit) for (construction.parameters, 0..) |parameter, index| {
                try c.step();
                if (std.meta.eql(field.origin, parameter.origin)) {
                    try c.require(field.@"type" == parameter.@"type" and selected[index] == null);
                    selected[index] = field_ref;
                    property = true;
                    break;
                }
            };
            if (!property) try ordinary.append(c.allocator, field_ref);
        }
        // Existing layout bounds each own field set to at most 256 entries.
        // Pay the finite sorting work before its comparator reads positions.
        try c.charge(ordinary.items.len * 8 + selected.len + 1);
        std.mem.sort(t.FieldRef, ordinary.items, self.common.members.fields, struct {
            fn less(fields: []const members.CommonField, left: t.FieldRef, right: t.FieldRef) bool {
                return fields[@intFromEnum(left)].origin.start < fields[@intFromEnum(right)].origin.start;
            }
        }.less);
        for (selected) |property| if (property) |field| try ordinary.append(c.allocator, field);
        for (ordinary.items, construction.initialization_fields) |expected, actual| {
            try c.step();
            try c.require(expected == actual);
        }
    }
    fn explicit(self: *Checker, construction: members.CommonConstruction) Error!void {
        const c = self.c;
        const function_ref = construction.function.?;
        const function = c.program.functions[@intFromEnum(function_ref)];
        const abi = self.common.abis[@intFromEnum(function.abi)];
        try c.require(function.role == .construction_body and function.source == construction.origin.source and
            function.declaration.start == construction.origin.start and function.declaration.end == construction.origin.end);
        try self.sameText(function.name, "constructor");
        try c.require(abi.result == construction.owner and abi.parameters.len == construction.parameters.len and
            std.meta.eql(construction.origin, construction.source_signature.origin));
        // ABI layout already checked parameter binding role/owner and physical
        // argument order. Join the construction's declared parameter catalogue
        // to those actual bindings, rather than merely to its own signature.
        for (construction.parameters, abi.parameters) |parameter, actual| {
            try c.step();
            try c.require(parameter.binding == actual and parameter.inherited_from == null);
            const binding = self.common.storage.bindings[@intFromEnum(actual)];
            try c.require(binding.@"type" == parameter.@"type" and
                std.meta.eql(binding.origin orelse return error.InvalidShape, parameter.origin));
        }
    }
    fn derived(self: *Checker, construction_ref: t.ConstructionRef, construction: members.CommonConstruction) Error!void {
        const c = self.c;
        const base = self.common.types[@intFromEnum(construction.owner)].base orelse return error.InvalidShape;
        const base_ref = self.constructors[@intFromEnum(base)] orelse return error.InvalidShape;
        const parent = self.common.members.constructions[@intFromEnum(base_ref)];
        const forward = construction.implicit_forward orelse return error.InvalidShape;
        var declaration = construction.origin;
        var ancestor: ?t.TypeRef = base;
        while (ancestor) |owner| {
            try c.step();
            // The previous typed type/layout pass excludes inheritance cycles;
            // this walk follows its chain without inventing another resolver.
            const ancestor_ref = self.constructors[@intFromEnum(owner)] orelse return error.InvalidShape;
            const inherited = self.common.members.constructions[@intFromEnum(ancestor_ref)];
            if (inherited.kind == .explicit) { declaration = inherited.origin; break; }
            ancestor = self.common.types[@intFromEnum(owner)].base;
        }
        try c.require(forward.target == base_ref and construction.access == parent.access and
            std.meta.eql(forward.origin, construction.origin) and std.meta.eql(construction.source_signature.origin, declaration));
        try c.require(forward.base_signature.@"return" == base and
            forward.base_signature.parameters.len == parent.parameters.len and
            construction.parameters.len == parent.parameters.len and forward.parameters.len == construction.parameters.len);
        for (forward.base_signature.parameters, parent.parameters) |given, actual| {
            // ConstructorParameter has only five bounded scalar/typed fields.
            try c.charge(5);
            try c.require(std.meta.eql(given, actual));
        }
        for (construction.parameters, parent.parameters, forward.parameters, 0..) |parameter, inherited, edge, index| {
            try c.step();
            const ordinal: u16 = @intCast(index);
            const target = members.ConstructorParameterRef{ .construction = base_ref, .parameter = ordinal };
            const source = members.ConstructorParameterRef{ .construction = construction_ref, .parameter = ordinal };
            try c.require(parameter.binding == null and std.meta.eql(parameter.inherited_from orelse return error.InvalidShape, target) and
                parameter.@"type" == inherited.@"type" and std.meta.eql(parameter.origin, inherited.origin));
            try c.require(std.meta.eql(edge.source, source) and std.meta.eql(edge.target, target));
            const proof = self.common.views.compatibility[@intFromEnum(edge.compatibility)];
            try c.require(proof.source_type == parameter.@"type" and proof.target_type == parameter.@"type" and
                std.meta.eql(proof.origin, construction.origin));
        }
    }
    fn run(self: *Checker) Error!void {
        const c = self.c;
        try c.charge(c.program.functions.len);
        const bodies = try c.allocator.alloc(bool, c.program.functions.len);
        defer c.allocator.free(bodies);
        @memset(bodies, false);
        for (self.common.members.constructions, 0..) |construction, index| {
            try c.step();
            const owner = self.common.types[@intFromEnum(construction.owner)];
            try c.require(construction.origin.source == owner.nominal_key.?.source);
            try c.require((construction.kind == .explicit) == (construction.function != null));
            try c.require(construction.signature.return_type == construction.owner and
                construction.parameters.len == construction.signature.parameters.len);
            for (construction.parameters, construction.signature.parameters) |parameter, declared| {
                try c.step();
                try c.require(parameter.@"type" == declared);
            }
            const phase: members.Phase = if (owner.base == null) .@"before-body" else .@"after-successful-super";
            try c.require(construction.initialization_phase == phase);
            try self.initialization(construction);
            if (construction.kind != .@"implicit-derived") try c.require(construction.implicit_forward == null);
            switch (construction.kind) {
                .explicit => {
                    try self.explicit(construction);
                    bodies[@intFromEnum(construction.function.?)] = true;
                },
                .@"implicit-base" => try c.require(owner.base == null and construction.parameters.len == 0 and construction.access == .public and
                    std.meta.eql(construction.origin, construction.source_signature.origin)),
                .@"implicit-derived" => try self.derived(@enumFromInt(index), construction),
            }
        }
        for (c.program.functions, 0..) |function, index| {
            try c.step();
            try c.require((function.role == .construction_body) == bodies[index]);
        }
    }
};

// One passive business phase. It returns no marker or retained authority and
// never parses, constructs a Program, evaluates instructions or changes data.
pub fn checkConstructions(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
    var checker = try Checker.init(c, common);
    defer checker.deinit();
    try checker.catalogue();
    try checker.run();
}
