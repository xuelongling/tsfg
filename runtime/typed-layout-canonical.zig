// SPDX-License-Identifier: MIT
// Derive physical layout independently from semantic definitions and identities.
const std = @import("std");
const input = @import("typed-layout-input.zig");
const element = @import("array-element.zig");
const cells = @import("managed-cell.zig");
pub const Error = input.Error || cells.Error;
pub const Entry = struct { type_id: [32]u8, name: []const u8, layout: element.Layout, cell: ?cells.Layout = null, base: ?[32]u8 = null };
pub const Module = struct {
    arena: std.heap.ArenaAllocator,
    entries: []Entry,
    pub fn deinit(self: *Module) void { self.arena.deinit(); self.* = undefined; }
    pub fn find(self: Module, id: [32]u8) Error!*const Entry {
        for (self.entries) |*entry| if (std.mem.eql(u8, &entry.type_id, &id)) return entry;
        return error.InvalidLayoutModule;
    }
};
const names = [_][]const u8{ "", "i32", "bool", "i8", "i16", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64" };
const Builder = struct {
    allocator: std.mem.Allocator,
    source: input.Input,
    names: []?[]const u8,
    layouts: []?element.Layout,
    naming: []bool,
    laying: []bool,
    work: usize = 100000,
    fn spend(self: *Builder, depth: usize) Error!void {
        if (depth > 32 or self.work == 0) return error.LayoutLimit;
        self.work -= 1;
    }
    fn name(self: *Builder, index: usize, depth: usize) Error![]const u8 {
        try self.spend(depth);
        if (self.names[index]) |value| return value;
        if (self.naming[index]) return error.InvalidLayoutModule;
        self.naming[index] = true;
        const type_def = self.source.types[index];
        const result = switch (type_def.kind) {
            .scalar => names[type_def.code],
            .undefined_value => "undefined", .null_value => "null", .void_value => "void", .string => "string",
            .reference, .value => blk: {
                const hex = std.fmt.bytesToHex(type_def.runtime_key, .lower);
                break :blk try std.fmt.allocPrint(self.allocator, "{s}<sha256:{s}>", .{ if (type_def.kind == .value) "value" else "ref", hex });
            },
            .array, .read_span => try std.fmt.allocPrint(self.allocator, "{s}<{s}>", .{
                if (type_def.kind == .array) "Array" else "ReadSpan", try self.name(try self.source.index(type_def.element.?), depth + 1) }),
            .union_value => blk: {
                const members = try self.allocator.alloc([]const u8, type_def.members.len);
                for (type_def.members, members) |id, *out| {
                    const at = try self.source.index(id);
                    if (self.source.types[at].kind == .union_value) return error.InvalidLayoutModule;
                    out.* = try self.name(at, depth + 1);
                }
                std.mem.sort([]const u8, members, {}, less);
                const joined = try std.mem.join(self.allocator, ",", members);
                break :blk try std.fmt.allocPrint(self.allocator, "Union<{s}>", .{joined});
            },
        };
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00"); hash.update(result);
        if (!std.mem.eql(u8, &hash.finalResult(), &type_def.id)) return error.InvalidLayoutModule;
        self.names[index] = result; self.naming[index] = false; return result;
    }
    fn fields(self: *Builder, index: usize, depth: usize, out: *std.ArrayList(input.Field), active: []bool) Error!void {
        try self.spend(depth);
        if (active[index]) return error.InvalidLayoutModule;
        active[index] = true;
        const type_def = self.source.types[index];
        if (type_def.base) |base| {
            const at = try self.source.index(base);
            if (type_def.kind != .reference or self.source.types[at].kind != .reference) return error.InvalidLayoutModule;
            try self.fields(at, depth + 1, out, active);
        }
        const hex = std.fmt.bytesToHex(type_def.id, .lower);
        for (type_def.fields) |field| {
            if (out.items.len == 256) return error.LayoutLimit;
            var hash = std.crypto.hash.sha2.Sha256.init(.{});
            hash.update("tsfg.field\x00sha256:"); hash.update(&hex); hash.update("\x00"); hash.update(field.name);
            if (!std.mem.eql(u8, &hash.finalResult(), &field.id)) return error.InvalidLayoutModule;
            for (out.items) |prior| if (std.mem.eql(u8, &prior.id, &field.id)) return error.InvalidLayoutModule;
            if (self.source.types[try self.source.index(field.type_id)].kind == .void_value) return error.InvalidLayoutModule;
            try out.append(self.allocator, field);
        }
        active[index] = false;
    }
    fn allFields(self: *Builder, index: usize) Error![]input.Field {
        const active = try self.allocator.alloc(bool, self.source.types.len); @memset(active, false);
        var result: std.ArrayList(input.Field) = .empty;
        try self.fields(index, 0, &result, active); return result.items;
    }
    fn layout(self: *Builder, index: usize, depth: usize) Error!element.Layout {
        try self.spend(depth);
        if (self.layouts[index]) |value| return value;
        if (self.laying[index]) return error.InvalidLayoutModule;
        self.laying[index] = true;
        const type_def = self.source.types[index];
        const variants = try self.allocator.alloc(element.Variant, if (type_def.kind == .union_value) type_def.members.len else 1);
        @memset(variants, .{ .tag = 0 });
        var result = element.Layout{ .type_id = type_def.id, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = variants };
        switch (type_def.kind) {
            .scalar => {
                const size = element.fieldSize(type_def.code).?;
                result.byte_size = size; result.alignment = @intCast(size);
                const fields_list = try self.allocator.alloc(element.Field, 1);
                fields_list[0] = .{ .offset = 0, .code = type_def.code }; variants[0].fields = fields_list;
            },
            .null_value => variants[0].kind = .null_value,
            .undefined_value, .void_value => variants[0].kind = .undefined_value,
            .reference, .string, .array, .read_span => {
                const references = try self.allocator.alloc(element.Reference, 1);
                references[0] = .{ .slot = 0, .type = switch (type_def.kind) {
                    .reference => .{ .cell = type_def.id }, .string => .string, else => .{ .array = type_def.element.? },
                } };
                variants[0].references = references; result.reference_count = 1;
                if (type_def.element) |id| {
                    const at = try self.source.index(id);
                    if (self.source.types[at].kind == .void_value) return error.InvalidLayoutModule;
                }
                if (type_def.kind == .read_span) {
                    result.byte_size = 8; result.alignment = 4;
                    const fields_list = try self.allocator.alloc(element.Field, 2);
                    fields_list[0] = .{ .offset = 0, .code = 8 }; fields_list[1] = .{ .offset = 4, .code = 8 }; variants[0].fields = fields_list;
                }
            },
            .value => {
                const fields_list = try self.allFields(index);
                const children = try self.allocator.alloc(element.Child, fields_list.len);
                for (fields_list, children) |field, *child| {
                    const nested = try self.allocator.create(element.Layout);
                    nested.* = try self.layout(try self.source.index(field.type_id), depth + 1);
                    const tag_offset = aligned(result.byte_size, 2);
                    const offset = aligned(tag_offset + 2, nested.alignment);
                    child.* = .{ .tag_offset = tag_offset, .offset = offset, .reference_offset = result.reference_count, .layout = nested };
                    result.byte_size = offset + nested.byte_size;
                    result.alignment = @max(result.alignment, 2, nested.alignment);
                    result.reference_count = try referenceSum(result.reference_count, nested.reference_count);
                }
                variants[0].children = children; result.byte_size = aligned(result.byte_size, result.alignment);
            },
            .union_value => {
                for (type_def.members, variants, 0..) |id, *variant, tag| {
                    const at = try self.source.index(id);
                    const nested = try self.allocator.create(element.Layout); nested.* = try self.layout(at, depth + 1);
                    const absent = self.source.types[at].kind;
                    result.alignment = @max(result.alignment, 2, nested.alignment);
                    result.reference_count = @max(result.reference_count, nested.reference_count);
                    variant.* = .{ .tag = @intCast(tag) };
                    if (absent == .null_value or absent == .undefined_value) {
                        variant.kind = if (absent == .null_value) .null_value else .undefined_value;
                    } else {
                        if (absent == .void_value) return error.InvalidLayoutModule;
                        const offset = aligned(2, nested.alignment);
                        result.byte_size = @max(result.byte_size, offset + nested.byte_size);
                        const children = try self.allocator.alloc(element.Child, 1);
                        children[0] = .{ .tag_offset = 0, .offset = offset, .reference_offset = 0, .layout = nested }; variant.children = children;
                    }
                }
                result.byte_size = aligned(result.byte_size, result.alignment);
            },
        }
        try result.validate(); self.layouts[index] = result; self.laying[index] = false; return result;
    }
    fn cell(self: *Builder, index: usize) Error!cells.Layout {
        const type_def = self.source.types[index];
        const source_fields = try self.allFields(index);
        const fields_list = try self.allocator.alloc(cells.Field, source_fields.len);
        var size: u32 = 0; var alignment: u8 = 1; var references: u16 = 0;
        for (source_fields, fields_list) |field, *out| {
            const value = try self.layout(try self.source.index(field.type_id), 0);
            const offset = aligned(size, value.alignment);
            out.* = .{ .id = field.id, .layout = value, .offset = offset, .reference_offset = references, .readonly = field.readonly };
            size = offset + value.byte_size; alignment = @max(alignment, value.alignment);
            references = try referenceSum(references, value.reference_count);
        }
        const result = cells.Layout{ .type_id = type_def.id, .runtime_key = type_def.runtime_key,
            .kind = if (type_def.kind == .value) .value else .reference, .byte_size = aligned(size, alignment),
            .alignment = alignment, .reference_count = references, .fields = fields_list };
        try result.validate(); return result;
    }
};
fn aligned(value: u32, alignment: u8) u32 { return (value + alignment - 1) / alignment * alignment; }
fn referenceSum(a: u16, b: u16) Error!u16 { const sum = @as(u32, a) + b; if (sum > 256) return error.LayoutLimit; return @intCast(sum); }
fn less(_: void, a: []const u8, b: []const u8) bool { return std.mem.lessThan(u8, a, b); }

pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (@import("builtin").cpu.arch != .x86_64 or @import("builtin").os.tag != .windows) return error.InvalidLayoutModule;
    var source = try input.read(allocator, bytes); defer source.deinit();
    var arena = std.heap.ArenaAllocator.init(allocator); errdefer arena.deinit();
    const alloc = arena.allocator(); const count = source.types.len;
    var builder = Builder{ .allocator = alloc, .source = source, .names = try alloc.alloc(?[]const u8, count),
        .layouts = try alloc.alloc(?element.Layout, count), .naming = try alloc.alloc(bool, count), .laying = try alloc.alloc(bool, count) };
    @memset(builder.names, null); @memset(builder.layouts, null); @memset(builder.naming, false); @memset(builder.laying, false);
    const entries = try alloc.alloc(Entry, count);
    for (source.types, entries, 0..) |type_def, *entry, index| {
        entry.* = .{ .type_id = type_def.id, .name = try builder.name(index, 0), .layout = try builder.layout(index, 0), .base = type_def.base };
        if (type_def.kind == .value or type_def.kind == .reference) entry.cell = try builder.cell(index);
    }
    return .{ .arena = arena, .entries = entries };
}
