// SPDX-License-Identifier: MIT
// Development logical catalogue input; no caller-supplied physical offsets.
const std = @import("std");
pub const Error = std.mem.Allocator.Error || error{ InvalidLayoutModule, LayoutLimit };
pub const Kind = enum(u8) { scalar = 1, undefined_value, null_value, void_value, union_value, array, read_span, reference, value, string };
pub const Field = struct { id: [32]u8, name: []const u8, type_id: [32]u8, readonly: bool };
pub const Type = struct {
    id: [32]u8,
    kind: Kind,
    code: u8 = 0,
    element: ?[32]u8 = null,
    members: [][32]u8 = &.{},
    runtime_key: [32]u8 = .{0} ** 32,
    base: ?[32]u8 = null,
    fields: []Field = &.{},
};
pub const Input = struct {
    arena: std.heap.ArenaAllocator,
    types: []Type,
    pub fn deinit(self: *Input) void { self.arena.deinit(); self.* = undefined; }
    pub fn index(self: Input, id: [32]u8) Error!usize {
        for (self.types, 0..) |value, i| if (std.mem.eql(u8, &value.id, &id)) return i;
        return error.InvalidLayoutModule;
    }
};
const Reader = struct {
    bytes: []const u8,
    at: usize = 0,
    work: usize = 100000,
    allocator: std.mem.Allocator,
    fn take(self: *Reader, n: usize) Error![]const u8 {
        if (n > self.bytes.len - self.at or self.work == 0) return error.InvalidLayoutModule;
        self.work -= 1;
        const value = self.bytes[self.at..][0..n]; self.at += n; return value;
    }
    fn byte(self: *Reader) Error!u8 { return (try self.take(1))[0]; }
    fn word(self: *Reader) Error!u16 { return std.mem.readInt(u16, (try self.take(2))[0..2], .little); }
    fn id(self: *Reader) Error![32]u8 {
        const result: [32]u8 = (try self.take(32))[0..32].*;
        if (std.mem.allEqual(u8, &result, 0)) return error.InvalidLayoutModule;
        return result;
    }
    fn flag(self: *Reader) Error!bool { const value = try self.byte(); if (value > 1) return error.InvalidLayoutModule; return value == 1; }
};
pub fn read(allocator: std.mem.Allocator, bytes: []const u8) Error!Input {
    if (bytes.len > 2097152) return error.LayoutLimit;
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    var reader = Reader{ .bytes = bytes, .allocator = arena.allocator() };
    if (!std.mem.eql(u8, try reader.take(8), "TSGLAY01")) return error.InvalidLayoutModule;
    const count = try reader.word();
    if (count == 0 or count > 4096) return error.LayoutLimit;
    const types = try reader.allocator.alloc(Type, count);
    for (types, 0..) |*out, index| {
        const id = try reader.id();
        if (index != 0 and std.mem.order(u8, &types[index - 1].id, &id) != .lt) return error.InvalidLayoutModule;
        const kind = std.enums.fromInt(Kind, try reader.byte()) orelse return error.InvalidLayoutModule;
        out.* = .{ .id = id, .kind = kind };
        switch (kind) {
            .scalar => { out.code = try reader.byte(); if (out.code < 1 or out.code > 13) return error.InvalidLayoutModule; },
            .array, .read_span => out.element = try reader.id(),
            .union_value => {
                const length = try reader.word(); if (length < 2 or length > 256) return error.LayoutLimit;
                out.members = try reader.allocator.alloc([32]u8, length);
                for (out.members, 0..) |*member, i| {
                    member.* = try reader.id();
                    if (i != 0 and std.mem.order(u8, &out.members[i - 1], member) != .lt) return error.InvalidLayoutModule;
                }
            },
            .reference, .value => {
                out.runtime_key = try reader.id();
                if (try reader.flag()) out.base = try reader.id();
                if (kind == .value and out.base != null) return error.InvalidLayoutModule;
                const length = try reader.word(); if (length > 256) return error.LayoutLimit;
                out.fields = try reader.allocator.alloc(Field, length);
                for (out.fields) |*field| {
                    const field_id = try reader.id();
                    const size = try reader.word(); if (size == 0 or size > 4096) return error.LayoutLimit;
                    const name = try reader.take(size);
                    if (!std.unicode.utf8ValidateSlice(name) or std.mem.indexOfScalar(u8, name, 0) != null) return error.InvalidLayoutModule;
                    field.* = .{ .id = field_id, .name = try reader.allocator.dupe(u8, name), .type_id = try reader.id(), .readonly = try reader.flag() };
                }
            },
            else => {},
        }
    }
    if (reader.at != bytes.len) return error.InvalidLayoutModule;
    return .{ .arena = arena, .types = types };
}
