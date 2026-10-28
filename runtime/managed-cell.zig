// SPDX-License-Identifier: MIT
// Fixed class/value fields own bytes and initialization bits; edges stay in Heap.
const std = @import("std");
const element = @import("array-element.zig");
const Allocator = std.mem.Allocator;
pub const Error = element.Error || error{ InvalidCellLayout, InvalidField, UninitializedField, AlreadyInitialized, ReadonlyField };
pub const Field = struct {
    id: [32]u8,
    layout: element.Layout,
    offset: u32,
    reference_offset: u16,
    readonly: bool = false,
};
pub const Layout = struct {
    type_id: [32]u8,
    runtime_key: [32]u8,
    kind: enum { reference, value },
    byte_size: u32,
    alignment: u8,
    reference_count: u16,
    fields: []const Field,

    pub fn validate(self: Layout) Error!void {
        if (std.mem.allEqual(u8, &self.type_id, 0) or std.mem.allEqual(u8, &self.runtime_key, 0) or
            self.byte_size > 65536 or self.reference_count > 256 or self.fields.len > 256 or
            self.alignment == 0 or self.alignment > 8 or !std.math.isPowerOfTwo(self.alignment) or self.byte_size % self.alignment != 0)
            return error.InvalidCellLayout;
        var end: u32 = 0;
        var references: u32 = 0;
        for (self.fields, 0..) |field, index| {
            try field.layout.validate();
            if (std.mem.allEqual(u8, &field.id, 0) or field.offset < end or field.offset > self.byte_size or
                field.layout.byte_size > self.byte_size - field.offset or field.offset % field.layout.alignment != 0 or field.layout.alignment > self.alignment or
                field.reference_offset != references) return error.InvalidCellLayout;
            for (self.fields[0..index]) |prior| if (std.mem.eql(u8, &prior.id, &field.id)) return error.InvalidCellLayout;
            end = field.offset + field.layout.byte_size;
            references += field.layout.reference_count;
        }
        if (references != self.reference_count) return error.InvalidCellLayout;
    }
    pub fn fieldIndex(self: Layout, id: [32]u8) Error!usize {
        for (self.fields, 0..) |field, index| if (std.mem.eql(u8, &field.id, &id)) return index;
        return error.InvalidField;
    }
    pub fn same(self: Layout, other: Layout) bool {
        if (!std.mem.eql(u8, &self.type_id, &other.type_id) or !std.mem.eql(u8, &self.runtime_key, &other.runtime_key) or
            self.kind != other.kind or self.byte_size != other.byte_size or self.alignment != other.alignment or
            self.reference_count != other.reference_count or self.fields.len != other.fields.len) return false;
        for (self.fields, other.fields) |left, right| if (!std.mem.eql(u8, &left.id, &right.id) or left.offset != right.offset or
            left.reference_offset != right.reference_offset or left.readonly != right.readonly or !left.layout.same(right.layout)) return false;
        return true;
    }
    pub fn clone(self: Layout, allocator: Allocator) Error!Layout {
        const fields = try allocator.alloc(Field, self.fields.len);
        var count: usize = 0;
        errdefer { for (fields[0..count]) |field| field.layout.deinit(allocator); allocator.free(fields); }
        for (self.fields, fields) |source, *target| {
            target.* = source; target.layout = try source.layout.clone(allocator); count += 1;
        }
        var result = self; result.fields = fields; return result;
    }
    pub fn deinit(self: Layout, allocator: Allocator) void {
        for (self.fields) |field| field.layout.deinit(allocator);
        allocator.free(self.fields);
    }
    // A value cell's field planes are an initialization representation. Packed
    // value copies retain every child discriminant and have no cell alias.
    pub fn elementLayout(self: Layout, allocator: Allocator) Error!element.Layout {
        var result = element.Layout{ .type_id = self.type_id, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &.{} };
        var variant = element.Variant{ .tag = 0 };
        const references = [_]element.Reference{.{ .slot = 0, .type = .{ .cell = self.type_id } }};
        const children = try allocator.alloc(element.Child, if (self.kind == .value) self.fields.len else 0);
        defer allocator.free(children);
        if (self.kind == .reference) { result.reference_count = 1; variant.references = &references; }
        else {
            for (self.fields, children) |*field, *child| {
                const tag_offset = (result.byte_size + 1) / 2 * 2;
                const alignment = field.layout.alignment;
                const offset = (tag_offset + 2 + alignment - 1) / alignment * alignment;
                child.* = .{ .tag_offset = tag_offset, .offset = offset, .reference_offset = result.reference_count, .layout = &field.layout };
                result.byte_size = offset + field.layout.byte_size; result.alignment = @max(result.alignment, 2, alignment);
                const count = @as(u32, result.reference_count) + field.layout.reference_count;
                if (count > 256) return error.InvalidCellLayout; result.reference_count = @intCast(count);
            }
            result.byte_size = (result.byte_size + result.alignment - 1) / result.alignment * result.alignment; variant.children = children;
        }
        result.variants = (&variant)[0..1]; try result.validate(); return result.clone(allocator);
    }
};

pub const Cell = struct {
    layout: Layout,
    bytes: []u8,
    tags: []u16,
    initialized: []bool,
    pub fn init(allocator: Allocator, layout: Layout) Error!Cell {
        try layout.validate();
        const owned = try layout.clone(allocator);
        errdefer owned.deinit(allocator);
        const bytes = try allocator.alloc(u8, layout.byte_size);
        errdefer allocator.free(bytes);
        const tags = try allocator.alloc(u16, layout.fields.len);
        errdefer allocator.free(tags);
        const initialized = try allocator.alloc(bool, layout.fields.len);
        @memset(bytes, 0); @memset(tags, 0); @memset(initialized, false);
        return .{ .layout = owned, .bytes = bytes, .tags = tags, .initialized = initialized };
    }
    pub fn clone(self: Cell, allocator: Allocator) Error!Cell {
        const result = try Cell.init(allocator, self.layout);
        @memcpy(result.bytes, self.bytes); @memcpy(result.tags, self.tags); @memcpy(result.initialized, self.initialized);
        return result;
    }
    pub fn deinit(self: Cell, allocator: Allocator) void {
        self.layout.deinit(allocator); allocator.free(self.bytes); allocator.free(self.tags); allocator.free(self.initialized);
    }
    pub fn fieldBytes(self: Cell, index: usize) []u8 {
        const field = self.layout.fields[index];
        return self.bytes[field.offset..][0..field.layout.byte_size];
    }
    pub fn pack(self: Cell, allocator: Allocator, expected: element.Layout) Error![]u8 {
        if (self.layout.kind != .value) return error.TypeMismatch;
        for (self.initialized) |ready| if (!ready) return error.UninitializedField;
        const canonical = try self.layout.elementLayout(allocator); defer canonical.deinit(allocator);
        if (!canonical.same(expected)) return error.TypeMismatch;
        const bytes = try allocator.alloc(u8, expected.byte_size); @memset(bytes, 0);
        for (expected.variants[0].children, 0..) |child, index| {
            std.mem.writeInt(u16, bytes[child.tag_offset..][0..2], self.tags[index], .little);
            child.layout.copyBytes(self.tags[index], bytes[child.offset..][0..child.layout.byte_size], self.fieldBytes(index));
        }
        return bytes;
    }
    pub fn unpack(self: *Cell, allocator: Allocator, expected: element.Layout, input: element.Input) Error!void {
        if (self.layout.kind != .value or input.tag != 0) return error.TypeMismatch;
        const canonical = try self.layout.elementLayout(allocator); defer canonical.deinit(allocator);
        if (!canonical.same(expected) or input.references.len != expected.reference_count) return error.TypeMismatch;
        _ = try expected.checkBytes(input.tag, input.bytes);
        for (expected.variants[0].children, 0..) |child, index| {
            const tag = element.childTag(child, input.bytes);
            child.layout.copyBytes(tag, self.fieldBytes(index), input.bytes[child.offset..][0..child.layout.byte_size]);
            self.tags[index] = tag; self.initialized[index] = true;
        }
    }
};
