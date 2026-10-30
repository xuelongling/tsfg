// SPDX-License-Identifier: MIT
// Shared, non-refillable work budget for checks of an already owned data graph.
// No packet, JSON value, loader, execution state or validity receipt lives here.
const std = @import("std");
const model = @import("wire-program-model.zig");
const t = model.types;

pub const Error = error{ WorkLimit, InvalidReference, InvalidOrigin, InvalidShape, InvalidOrder, WrongMode, OutOfMemory };
pub const Counts = struct {
    types: usize, fields: usize, methods: usize, constructions: usize,
    domains: usize, bindings: usize, cells: usize, scopes: usize,
    environments: usize, abis: usize, modules: usize, globals: usize,
    hosts: usize, compatibilities: usize, dispatches: usize,
};

pub const Context = struct {
    program: *const model.Program,
    allocator: std.mem.Allocator,
    remaining: usize = model.format.max_work,

    pub fn charge(self: *Context, count: usize) Error!void {
        if (count > self.remaining) {
            self.remaining = 0;
            return error.WorkLimit;
        }
        self.remaining -= count;
    }
    pub fn step(self: *Context) Error!void { try self.charge(1); }
    pub fn row(self: *Context, comptime Row: type) Error!void {
        // A typed record's fixed scalar fields are work too; its dynamic edges
        // and nested rows are charged separately when actually traversed.
        try self.charge(1 + @typeInfo(Row).@"struct".fields.len);
    }
    pub fn require(self: *Context, condition: bool) Error!void {
        try self.step();
        if (!condition) return error.InvalidShape;
    }
    // The generic preserves the concrete enum's directory type at callers.
    pub fn ref(self: *Context, value: anytype, count: usize) Error!usize {
        try self.step();
        const index = @intFromEnum(value);
        if (index >= count) return error.InvalidReference;
        return @intCast(index);
    }
    pub fn maybeRef(self: *Context, value: anytype, count: usize) Error!void {
        if (value) |present| { _ = try self.ref(present, count); } else try self.step();
    }
    pub fn anchor(self: *Context, value: t.Anchor, source: t.SourceRef) Error!void {
        const index = try self.ref(source, self.program.tables.sources.len);
        try self.charge(2);
        if (value.start > value.end or value.end > self.program.tables.sources[index].length)
            return error.InvalidOrigin;
    }
    pub fn origin(self: *Context, value: t.Origin) Error!void {
        try self.anchor(.{ .start = value.start, .end = value.end }, value.source);
    }
    pub fn text(self: *Context, value: []const u8, maximum: usize, minimum: usize) Error!void {
        // Charge bounded chunks before either linear byte scan takes place.
        try self.charge(1 + value.len / 64);
        if (value.len < minimum or value.len > maximum or std.mem.indexOfScalar(u8, value, 0) != null or
            !std.unicode.utf8ValidateSlice(value)) return error.InvalidShape;
    }
    pub fn counts(self: *const Context) Counts {
        return switch (self.program.tables.mode) {
            .legacy => |v| .{ .types=v.types.len, .fields=v.members.fields.len, .methods=v.members.methods.len,
                .constructions=v.members.constructions.len, .domains=v.domains.len, .bindings=0,
                .cells=v.exceptions.bindings.len, .scopes=v.exceptions.scopes.len,
                .environments=v.closures.environments.len, .abis=v.abis.len, .modules=v.modules.modules.len,
                .globals=v.modules.globals.len, .hosts=v.modules.hosts.len,
                .compatibilities=v.views.compatibility.len, .dispatches=v.views.dispatch.len },
            .exception => |v| .{ .types=v.types.len, .fields=v.members.fields.len, .methods=0,
                .constructions=v.members.constructions.len, .domains=v.domains.len, .bindings=0,
                .cells=v.exceptions.bindings.len, .scopes=v.exceptions.scopes.len,
                .environments=v.closures.environments.len, .abis=v.abis.len, .modules=v.modules.modules.len,
                .globals=0, .hosts=0, .compatibilities=0, .dispatches=0 },
            .common => |v| .{ .types=v.types.len, .fields=v.members.fields.len, .methods=v.members.methods.len,
                .constructions=v.members.constructions.len, .domains=v.domains.len, .bindings=v.storage.bindings.len,
                .cells=v.exceptions.bindings.len, .scopes=v.exceptions.scopes.len,
                .environments=v.closures.environments.len, .abis=v.abis.len, .modules=v.modules.modules.len,
                .globals=v.modules.globals.len, .hosts=v.modules.hosts.len,
                .compatibilities=v.views.compatibility.len, .dispatches=v.views.dispatch.len },
        };
    }
    pub fn carrier(self: *Context, value: t.Carrier) Error!void {
        try self.step();
        const n = self.counts();
        switch (value) {
            .domain => |v| { _ = try self.ref(v, n.domains); },
            .environment => |v| { _ = try self.ref(v, n.environments); },
            .@"type" => |v| { _ = try self.ref(v, n.types); },
            .cell => |v| { _ = try self.ref(v, n.cells); },
            .payload => try self.step(),
        }
        // Legacy finite/closure carriers cannot silently become EH/Common cells.
        if (std.meta.activeTag(self.program.tables.mode) == .legacy and std.meta.activeTag(value) != .domain and std.meta.activeTag(value) != .environment)
            return error.WrongMode;
    }
};
