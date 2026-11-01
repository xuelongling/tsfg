// SPDX-License-Identifier: MIT
// Typed fixed storage declarations, not body facts or an admission receipt.
// The caller has checked the Common type/member directories. Whole publication
// hashes, SCCs, schema and actual-in-upper inclusion remain separate obligations.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

pub const Storage = @import("wire-program-publication.zig").FixedStorage;
pub const Field = std.meta.Child(@TypeOf(@as(Storage, undefined).fields));
pub const Result = std.meta.Child(@TypeOf(@as(Storage, undefined).results));
pub const Upper = struct {
    actual_type_ids: []const t.Hash = &.{},
    // null preserves the complete finite ID set but lacks a current physical
    // interpretation. It is neither Bottom, TOP nor a shortened finite upper.
    actual_types: ?[]const t.TypeRef = &.{},
    unknown: bool = false,
    pub fn isBottom(self: Upper) bool { return !self.unknown and self.actual_types != null and self.actual_types.?.len == 0; }
};
pub const Reference = union(enum) {
    field: t.Hash,
    result: struct { construction: t.Hash, new_target: t.Hash },
};
pub const Selection = struct { publication_digest: t.Hash, reference: Reference, upper: Upper };
const Key = struct { construction: t.ConstructionRef, new_target: t.TypeRef };

pub const Directory = struct {
    allocator: std.mem.Allocator,
    publication_digest: t.Hash,
    metadata_available: bool,
    fields: []Upper,
    field_ids: []const @import("wire-program-members.zig").CommonField,
    type_ids: []const @import("wire-program-tables.zig").CommonType,
    construction_ids: []const @import("wire-program-members.zig").CommonConstruction,
    results: std.AutoHashMapUnmanaged(Key, Upper) = .empty,

    // Input Hash slices and the verified owning directories are borrowed for this
    // Directory's lifetime. Only mapped TypeRef slices and lookup storage are owned.
    pub fn deinit(self: *Directory) void {
        for (self.fields) |upper| if (upper.actual_types) |refs| self.allocator.free(refs);
        self.allocator.free(self.fields);
        var values = self.results.valueIterator();
        while (values.next()) |upper| if (upper.actual_types) |refs| self.allocator.free(refs);
        self.results.deinit(self.allocator);
        self.* = undefined;
    }

    // This is the contribution permitted through logical FieldId, not the read
    // bound or capacity of a shared physical property. Reads/copies/GC require
    // the independently verified union of every co-visible alias contribution.
    pub fn fieldWriteUpper(self: *const Directory, c: *Context, id: t.FieldRef) Error!Selection {
        const index = try c.ref(id, self.field_ids.len);
        if (!self.metadata_available) return error.FixedInterpretationPending;
        if (self.fields[index].actual_types == null) return error.FixedInterpretationPending;
        return .{ .publication_digest = self.publication_digest,
            .reference = .{ .field = self.field_ids[index].id }, .upper = self.fields[index] };
    }

    // A pair outside the declared ancestor closure is unresolved, never Bottom.
    pub fn result(self: *const Directory, c: *Context, construction: t.ConstructionRef, new_target: t.TypeRef) Error!?Selection {
        const ci = try c.ref(construction, self.construction_ids.len);
        const ti = try c.ref(new_target, self.type_ids.len);
        try c.step();
        if (!self.metadata_available) {
            const target = self.type_ids[ti];
            try c.require(target.kind == .reference or target.kind == .value);
            var cursor: ?t.TypeRef = new_target; var depth: usize = 0;
            while (cursor) |current| {
                const owner = try c.ref(current, self.type_ids.len);
                try c.require(depth < self.type_ids.len); depth += 1;
                if (current == self.construction_ids[ci].owner) return error.FixedInterpretationPending;
                cursor = self.type_ids[owner].base;
            }
            return error.InvalidReference;
        }
        const upper = self.results.get(.{ .construction = construction, .new_target = new_target }) orelse return null;
        if (upper.actual_types == null) return error.FixedInterpretationPending;
        return .{ .publication_digest = self.publication_digest,
            .reference = .{ .result = .{ .construction = self.construction_ids[ci].id,
                .new_target = self.type_ids[ti].id } }, .upper = upper };
    }
};

fn sameTags(c: *Context, left: []const t.Hash, right: []const t.Hash) Error!void {
    try c.require(left.len == right.len);
    try c.charge(left.len);
    for (left, right) |a, b| try c.require(std.mem.eql(u8, &a, &b));
}

fn mapUpper(c: *Context, types: *const std.AutoHashMapUnmanaged(t.Hash, t.TypeRef), ids: []const t.Hash, unknown: bool) Error!Upper {
    try c.charge(ids.len + 1);
    const refs = try c.allocator.alloc(t.TypeRef, ids.len);
    errdefer c.allocator.free(refs);
    var complete = true;
    for (ids, 0..) |id, i| {
        try c.step();
        if (i != 0) try c.require(std.mem.order(u8, &ids[i - 1], &id) == .lt);
        if (types.get(id)) |ref| refs[i] = ref else complete = false;
    }
    if (!complete) { c.allocator.free(refs); return .{ .actual_type_ids = ids, .actual_types = null, .unknown = unknown }; }
    // Empty+known is a proved empty set; unknown+empty stays unknown. No kind
    // filtering or declaration/body-derived replacement is permitted here.
    return .{ .actual_type_ids = ids, .actual_types = refs, .unknown = unknown };
}

pub fn init(c: *Context, scope: Storage, publication: Storage, expected_digest: t.Hash) Error!Directory {
    // The real caller first validates complete archive/Graph/storage references
    // and semantic identities. Mapping does not fill gaps from a current body.
    const owned = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
    try c.require(scope.fields.len == publication.fields.len and scope.results.len == publication.results.len);
    try c.step(); const available = publication.fields.len != 0 or publication.results.len != 0;
    if (available) try c.require(publication.fields.len == owned.members.fields.len);
    try c.charge(owned.types.len + owned.members.fields.len + owned.members.constructions.len + publication.results.len + 5);
    try c.require(owned.types.len <= std.math.maxInt(u32) and owned.members.fields.len <= std.math.maxInt(u32) and
        owned.members.constructions.len <= std.math.maxInt(u32) and publication.results.len <= std.math.maxInt(u32));
    var types: std.AutoHashMapUnmanaged(t.Hash, t.TypeRef) = .empty;
    defer types.deinit(c.allocator);
    var fields: std.AutoHashMapUnmanaged(t.Hash, t.FieldRef) = .empty;
    defer fields.deinit(c.allocator);
    var constructions: std.AutoHashMapUnmanaged(t.Hash, t.ConstructionRef) = .empty;
    defer constructions.deinit(c.allocator);
    try types.ensureTotalCapacity(c.allocator, @intCast(owned.types.len));
    try fields.ensureTotalCapacity(c.allocator, @intCast(owned.members.fields.len));
    try constructions.ensureTotalCapacity(c.allocator, @intCast(owned.members.constructions.len));
    for (owned.types, 0..) |row, i| { try c.step(); types.putAssumeCapacityNoClobber(row.id, @enumFromInt(i)); }
    for (owned.members.fields, 0..) |row, i| { try c.step(); fields.putAssumeCapacityNoClobber(row.id, @enumFromInt(i)); }
    for (owned.members.constructions, 0..) |row, i| { try c.step(); constructions.putAssumeCapacityNoClobber(row.id, @enumFromInt(i)); }

    const field_count = if (available) owned.members.fields.len else 0;
    try c.charge(field_count + owned.types.len + 2);
    const owner_constructor = try c.allocator.alloc(?t.ConstructionRef, owned.types.len);
    defer c.allocator.free(owner_constructor);
    @memset(owner_constructor, null);
    const mapped_fields = try c.allocator.alloc(Upper, field_count);
    @memset(mapped_fields, .{});
    var directory = Directory{ .allocator = c.allocator, .publication_digest = expected_digest,
        .metadata_available = available,
        .fields = mapped_fields, .field_ids = owned.members.fields, .type_ids = owned.types,
        .construction_ids = owned.members.constructions };
    errdefer directory.deinit();
    try directory.results.ensureTotalCapacity(c.allocator, @intCast(publication.results.len));
    for (owned.members.constructions, 0..) |row, i| {
        const owner = try c.ref(row.owner, owned.types.len);
        try c.require(owner_constructor[owner] == null);
        owner_constructor[owner] = @enumFromInt(i);
    }
    for (publication.fields, scope.fields, 0..) |row, fixed, i| {
        try c.row(Field);
        if (i != 0) try c.require(std.mem.order(u8, &publication.fields[i - 1].field_id, &row.field_id) == .lt);
        try c.require(std.mem.eql(u8, &row.field_id, &fixed.field_id) and row.unknown == fixed.unknown);
        try sameTags(c, row.actual_types, fixed.actual_types);
        const ref = fields.get(row.field_id) orelse return error.InvalidReference;
        directory.fields[@intFromEnum(ref)] = try mapUpper(c, &types, row.actual_types, row.unknown);
    }
    for (publication.results, scope.results, 0..) |row, fixed, i| {
        try c.row(Result);
        if (i != 0) {
            const prior = publication.results[i - 1];
            const first = std.mem.order(u8, &prior.construction, &row.construction);
            try c.require(first == .lt or (first == .eq and std.mem.order(u8, &prior.new_target, &row.new_target) == .lt));
        }
        try c.require(std.mem.eql(u8, &row.construction, &fixed.construction) and
            std.mem.eql(u8, &row.new_target, &fixed.new_target) and row.unknown == fixed.unknown);
        try sameTags(c, row.actual_types, fixed.actual_types);
        const construction = constructions.get(row.construction) orelse return error.InvalidReference;
        const target = types.get(row.new_target) orelse return error.InvalidReference;
        const upper = try mapUpper(c, &types, row.actual_types, row.unknown);
        directory.results.putAssumeCapacityNoClobber(.{ .construction = construction, .new_target = target }, upper);
    }
    // Every owned class/value construction target contributes its complete
    // ancestor constructor pairs, even if no current body contains a new site.
    var pairs: usize = 0;
    for (owned.types, 0..) |row, i| {
        try c.step();
        if ((row.kind != .reference and row.kind != .value) or owner_constructor[i] == null) continue;
        var cursor: ?t.TypeRef = @enumFromInt(i);
        var depth: usize = 0;
        while (cursor) |current| {
            const owner = try c.ref(current, owned.types.len);
            try c.require(depth < owned.types.len);
            depth += 1;
            if (owner_constructor[owner]) |construction| {
                try c.step();
                if (available) try c.require(directory.results.contains(.{ .construction = construction, .new_target = @enumFromInt(i) }));
                pairs += 1;
            }
            cursor = owned.types[owner].base;
        }
    }
    if (available) try c.require(pairs == publication.results.len);
    return directory;
}
