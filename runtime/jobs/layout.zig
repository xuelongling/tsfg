// SPDX-License-Identifier: MIT
const std = @import("std");
pub const schema_hash = "sha256:26a6e0fe97b3f269eba8aec94061c980c5985eb5f3595c9feb4bc7c13036db8f";
pub const max_bytes = 2097152;
pub const Error = error{ InvalidLayout, LayoutLimit, IdentityMismatch, WrongTarget };
pub const Range = struct { end: u32, start: u32 };
pub const Kind = enum { scalar, value, component };
pub const Field = struct { id: []const u8, name: []const u8, offset: u32, range: Range, readonly: bool, sourcePath: []const u8, type: []const u8 };
pub const Type = struct { alignment: u32, byteSize: u32, fields: []const Field, id: []const u8, kind: Kind, name: []const u8, range: Range, scalar: []const u8, sourcePath: []const u8, stride: u32 };
pub const Target = struct {
    llvmDataLayout: []const u8,
    pointerBits: []const u8,
    target: []const u8,
    triple: []const u8,
    pub const native: Target = .{
        .llvmDataLayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128",
        .pointerBits = "64",
        .target = "windows-x86_64-msvc",
        .triple = "x86_64-pc-windows-msvc",
    };
};
pub const Expected = struct { inputIdentity: []const u8, hirDigest: []const u8, target: Target = Target.native };
pub const Payload = struct { components: []const []const u8, hirDigest: []const u8, inputIdentity: []const u8, target: Target, types: []const Type };
const Envelope = struct { family: []const u8, payload: []const u8, payloadHash: []const u8, schemaHash: []const u8, version: u32 };
const Identity = union(enum) { external: Expected, catalog: []const u8 };
const Budget = struct {
    remaining: usize = 1000000,
    fn charge(self: *Budget, count: usize) Error!void {
        if (count > self.remaining) return error.LayoutLimit;
        self.remaining -= count;
    }
};

/// Owns all decoded strings/records. Store.init copies its component directory.
pub const Layout = struct {
    arena: std.heap.ArenaAllocator,
    payload: Payload,
    payload_hash: [71]u8,

    pub fn load(allocator: std.mem.Allocator, bytes: []const u8, expected: Expected) !Layout {
        return decode(allocator, bytes, .{ .external = expected });
    }
    /// Query metadata binds its complete verified catalog, rather than a Common HIR module.
    pub fn loadCatalog(allocator: std.mem.Allocator, bytes: []const u8, input_identity: []const u8) !Layout {
        return decode(allocator, bytes, .{ .catalog = input_identity });
    }
    fn decode(allocator: std.mem.Allocator, bytes: []const u8, identity: Identity) !Layout {
        if (bytes.len == 0 or bytes.len > max_bytes or bytes[bytes.len - 1] != '\n') return error.InvalidLayout;
        var budget: Budget = .{};
        try budget.charge(bytes.len);
        // Reject excessive JSON nesting before the JSON parser can allocate nested data.
        var depth: usize = 0;
        var quoted = false;
        var escaped = false;
        for (bytes) |byte| {
            if (quoted) {
                if (escaped) {
                    escaped = false;
                } else if (byte == '\\') {
                    escaped = true;
                } else if (byte == '"') {
                    quoted = false;
                }
            } else if (byte == '"') {
                quoted = true;
            } else if (byte == '{' or byte == '[') {
                depth += 1;
                if (depth > 32) return error.LayoutLimit;
            } else if (byte == '}' or byte == ']') {
                if (depth == 0) return error.InvalidLayout;
                depth -= 1;
            }
        }
        if (depth != 0 or quoted) return error.InvalidLayout;
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const owned = arena.allocator();
        try budget.charge(bytes.len);
        const envelope = std.json.parseFromSlice(Envelope, owned, bytes, .{ .allocate = .alloc_always }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidLayout;
        const env = envelope.value;
        if (!std.mem.eql(u8, env.family, "tsfg.component-layout-candidate") or env.version != 1 or !std.mem.eql(u8, env.schemaHash, schema_hash)) return error.InvalidLayout;
        try budget.charge(env.payload.len);
        var hash = std.crypto.hash.sha2.Sha256.init(.{});
        hash.update("tsfg.component-layout.v1\x00");
        hash.update(env.payload);
        var digest: [32]u8 = undefined;
        hash.final(&digest);
        var rendered: [71]u8 = undefined;
        @memcpy(rendered[0..7], "sha256:");
        const hex = std.fmt.bytesToHex(digest, .lower);
        @memcpy(rendered[7..], &hex);
        if (!std.mem.eql(u8, env.payloadHash, &rendered)) return error.InvalidLayout;
        try budget.charge(env.payload.len);
        const parsed = std.json.parseFromSlice(Payload, owned, env.payload, .{ .allocate = .alloc_always }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.InvalidLayout;
        const payload = parsed.value;
        // The exact canonical payload/envelope are part of the development exchange.
        try budget.charge(env.payload.len + bytes.len);
        const canonical_payload = try std.json.Stringify.valueAlloc(owned, payload, .{});
        const canonical_envelope = try std.json.Stringify.valueAlloc(owned, env, .{});
        if (!std.mem.eql(u8, canonical_payload, env.payload) or !std.mem.eql(u8, canonical_envelope, bytes[0 .. bytes.len - 1])) return error.InvalidLayout;
        const input_identity = switch (identity) {
            .external => |expected| expected.inputIdentity,
            .catalog => |expected| expected,
        };
        const target = switch (identity) {
            .external => |expected| expected.target,
            .catalog => Target.native,
        };
        if (!digestId(payload.inputIdentity) or !digestId(payload.hirDigest) or !std.mem.eql(u8, payload.inputIdentity, input_identity)) return error.IdentityMismatch;
        switch (identity) {
            .external => |expected| if (!std.mem.eql(u8, payload.hirDigest, expected.hirDigest)) {
                return error.IdentityMismatch;
            },
            .catalog => {},
        }
        inline for (std.meta.fields(Target)) |field| {
            if (!std.mem.eql(u8, @field(payload.target, field.name), @field(target, field.name)) or !std.mem.eql(u8, @field(payload.target, field.name), @field(Target.native, field.name))) return error.WrongTarget;
        }
        if (payload.types.len == 0 or payload.types.len > 4096 or payload.components.len > 4096) return error.LayoutLimit;
        var result: Layout = .{ .arena = arena, .payload = payload, .payload_hash = rendered };
        var component_count: usize = 0;
        for (payload.types, 0..) |row, index| {
            try budget.charge(1 + row.fields.len);
            if (!digestId(row.id) or row.name.len == 0 or row.fields.len > 256 or row.byteSize > 65536 or row.stride != row.byteSize or row.alignment == 0 or row.alignment > 65536 or !std.math.isPowerOfTwo(row.alignment) or row.byteSize % row.alignment != 0 or row.range.start > row.range.end) return error.InvalidLayout;
            if (index > 0 and std.mem.order(u8, payload.types[index - 1].id, row.id) != .lt) return error.InvalidLayout;
            if (row.kind == .scalar) {
                if (row.fields.len != 0 or row.sourcePath.len != 0 or row.range.start != 0 or row.range.end != 0 or !std.mem.eql(u8, row.name, row.scalar)) return error.InvalidLayout;
                const scalar = scalarLayout(row.scalar) orelse return error.InvalidLayout;
                if (row.byteSize != scalar[0] or row.alignment != scalar[1]) return error.InvalidLayout;
            } else {
                if (row.scalar.len != 0 or !sourcePath(row.sourcePath)) return error.InvalidLayout;
                if (row.kind == .component) component_count += 1;
                var end: u32 = 0;
                var alignment: u32 = 1;
                for (row.fields, 0..) |field, field_index| {
                    if (!digestId(field.id) or field.name.len == 0 or !sourcePath(field.sourcePath) or field.range.start > field.range.end) return error.InvalidLayout;
                    for (row.fields[0..field_index]) |previous| {
                        try budget.charge(1);
                        if (std.mem.eql(u8, previous.id, field.id) or std.mem.eql(u8, previous.name, field.name)) return error.InvalidLayout;
                    }
                    const child = try result.findCharged(field.type, &budget);
                    if (child.alignment == 0 or child.alignment > 65536 or !std.math.isPowerOfTwo(child.alignment) or child.byteSize > 65536) return error.InvalidLayout;
                    if (field.offset % child.alignment != 0 or field.offset != std.mem.alignForward(u32, end, child.alignment) or field.offset > row.byteSize or child.byteSize > row.byteSize - field.offset) return error.InvalidLayout;
                    end = field.offset + child.byteSize;
                    alignment = @max(alignment, child.alignment);
                }
                if (row.alignment != alignment or row.byteSize != std.mem.alignForward(u32, end, alignment)) return error.InvalidLayout;
            }
        }
        if (component_count != payload.components.len) return error.InvalidLayout;
        for (payload.components, 0..) |id, index| {
            try budget.charge(1);
            if (index > 0 and std.mem.order(u8, payload.components[index - 1], id) != .lt) return error.InvalidLayout;
            if ((try result.findCharged(id, &budget)).kind != .component) return error.InvalidLayout;
        }
        const states = try owned.alloc(u8, payload.types.len);
        @memset(states, 0);
        const heights = try owned.alloc(u8, payload.types.len);
        for (payload.types, 0..) |_, index| _ = try result.visit(index, states, heights, &budget, 0);
        switch (identity) {
            .external => {},
            .catalog => {
                const catalog = try std.json.Stringify.valueAlloc(owned, .{ .components = payload.components, .target = payload.target, .types = payload.types }, .{});
                var catalog_hash = std.crypto.hash.sha2.Sha256.init(.{});
                catalog_hash.update(catalog);
                catalog_hash.update("\n");
                catalog_hash.final(&digest);
                const catalog_hex = std.fmt.bytesToHex(digest, .lower);
                @memcpy(rendered[7..], &catalog_hex);
                if (!std.mem.eql(u8, payload.hirDigest, &rendered)) return error.IdentityMismatch;
            },
        }
        result.arena = arena;
        return result;
    }

    pub fn deinit(self: *Layout) void {
        self.arena.deinit();
        self.* = undefined;
    }
    pub fn find(self: *const Layout, id: []const u8) ?*const Type {
        var low: usize = 0;
        var high = self.payload.types.len;
        while (low < high) {
            const mid = low + (high - low) / 2;
            switch (std.mem.order(u8, self.payload.types[mid].id, id)) {
                .lt => low = mid + 1,
                .gt => high = mid,
                .eq => return &self.payload.types[mid],
            }
        }
        return null;
    }
    fn findCharged(self: *const Layout, id: []const u8, budget: *Budget) Error!*const Type {
        var low: usize = 0;
        var high = self.payload.types.len;
        while (low < high) {
            try budget.charge(1);
            const mid = low + (high - low) / 2;
            switch (std.mem.order(u8, self.payload.types[mid].id, id)) {
                .lt => low = mid + 1,
                .gt => high = mid,
                .eq => return &self.payload.types[mid],
            }
        }
        return error.InvalidLayout;
    }
    fn visit(self: *const Layout, index: usize, states: []u8, heights: []u8, budget: *Budget, depth: usize) Error!u8 {
        try budget.charge(1);
        if (depth >= 32 or states[index] == 1) return error.InvalidLayout;
        if (states[index] == 2) {
            if (depth + heights[index] > 32) return error.LayoutLimit;
            return heights[index];
        }
        states[index] = 1;
        var height: u8 = 1;
        for (self.payload.types[index].fields) |field| {
            try budget.charge(1);
            const child = try self.findCharged(field.type, budget);
            const child_index = (@intFromPtr(child) - @intFromPtr(self.payload.types.ptr)) / @sizeOf(Type);
            height = @max(height, 1 + try self.visit(child_index, states, heights, budget, depth + 1));
        }
        states[index] = 2;
        heights[index] = height;
        return height;
    }
};
fn digestId(value: []const u8) bool {
    if (value.len != 71 or !std.mem.startsWith(u8, value, "sha256:")) return false;
    for (value[7..]) |byte| if (!(byte >= '0' and byte <= '9') and !(byte >= 'a' and byte <= 'f')) return false;
    return true;
}
fn sourcePath(value: []const u8) bool {
    if (value.len < 2 or value[0] != '/' or std.mem.indexOfAny(u8, value, "\\\x00") != null) return false;
    var pieces = std.mem.splitScalar(u8, value[1..], '/');
    while (pieces.next()) |piece| if (piece.len == 0 or std.mem.eql(u8, piece, ".") or std.mem.eql(u8, piece, "..")) return false;
    return true;
}
fn scalarLayout(name: []const u8) ?[2]u32 {
    inline for (.{ .{ "bool", u8 }, .{ "i8", i8 }, .{ "u8", u8 }, .{ "i16", i16 }, .{ "u16", u16 }, .{ "i32", i32 }, .{ "u32", u32 }, .{ "f32", f32 }, .{ "i64", i64 }, .{ "u64", u64 }, .{ "isize", isize }, .{ "usize", usize }, .{ "f64", f64 } }) |scalar| {
        if (std.mem.eql(u8, name, scalar[0])) return .{ @sizeOf(scalar[1]), @alignOf(scalar[1]) };
    }
    return null;
}
