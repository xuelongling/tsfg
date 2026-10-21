// SPDX-License-Identifier: MIT
// Concrete element layout, independent of protocol objects and moving addresses.
const std = @import("std");
const handles = @import("managed-handles.zig");
const Allocator = std.mem.Allocator;
pub const Error = Allocator.Error || error{ InvalidArrayLayout, InvalidArrayElement, TypeMismatch, ArrayTooLarge, IndexOutOfBounds, UninitializedGrowth };
pub const ReferenceType = union(enum) { object: u64, string: void, array: [32]u8 };
pub const Reference = struct { slot: u16, type: ReferenceType };
pub const Field = struct { offset: u32, code: u8 };
pub const Variant = struct {
    tag: u16,
    kind: enum { value, null_value, undefined_value } = .value,
    fields: []const Field = &.{},
    references: []const Reference = &.{},
};
pub const Layout = struct {
    type_id: [32]u8,
    byte_size: u32,
    alignment: u8,
    reference_count: u16,
    variants: []const Variant,

    pub fn validate(self: Layout) Error!void {
        if (std.mem.allEqual(u8, &self.type_id, 0) or self.byte_size > 65536 or self.reference_count > 256 or
            self.alignment == 0 or self.alignment > 8 or !std.math.isPowerOfTwo(self.alignment) or
            self.byte_size % self.alignment != 0 or self.variants.len == 0 or self.variants.len > 256)
            return error.InvalidArrayLayout;
        for (self.variants, 0..) |variant, index| {
            for (self.variants[0..index]) |prior| if (variant.tag == prior.tag) return error.InvalidArrayLayout;
            if (variant.kind != .value and (variant.fields.len != 0 or variant.references.len != 0)) return error.InvalidArrayLayout;
            if (variant.fields.len > 256 or variant.references.len > self.reference_count) return error.InvalidArrayLayout;
            var previous_end: u32 = 0;
            for (variant.fields) |field| {
                const size = fieldSize(field.code) orelse return error.InvalidArrayLayout;
                if (field.offset < previous_end or field.offset > self.byte_size or size > self.byte_size - field.offset)
                    return error.InvalidArrayLayout;
                previous_end = field.offset + size;
            }
            var previous_slot: ?u16 = null;
            for (variant.references) |reference| {
                if (reference.slot >= self.reference_count or (previous_slot != null and reference.slot <= previous_slot.?))
                    return error.InvalidArrayLayout;
                switch (reference.type) {
                    .array => |id| if (std.mem.allEqual(u8, &id, 0)) return error.InvalidArrayLayout,
                    else => {},
                }
                previous_slot = reference.slot;
            }
        }
    }

    pub fn selectVariant(self: Layout, tag: u16) Error!Variant {
        for (self.variants) |value| if (value.tag == tag) return value;
        return error.InvalidArrayElement;
    }

    pub fn checkBytes(self: Layout, tag: u16, bytes: []const u8) Error!Variant {
        if (bytes.len != self.byte_size) return error.InvalidArrayElement;
        const selected = try self.selectVariant(tag);
        for (selected.fields) |field| {
            if (field.code == 2 and bytes[field.offset] > 1) return error.InvalidArrayElement;
        }
        return selected;
    }

    // Padding and inactive payload are not source values. Normalize them without
    // observing their contents; only selected fields participate in value copies.
    pub fn copyBytes(self: Layout, tag: u16, destination: []u8, source: []const u8) void {
        @memset(destination, 0);
        const selected = self.selectVariant(tag) catch unreachable;
        for (selected.fields) |field| {
            const end = field.offset + fieldSize(field.code).?;
            @memcpy(destination[field.offset..end], source[field.offset..end]);
        }
    }

    pub fn clone(self: Layout, allocator: Allocator) Error!Layout {
        const variants = try allocator.alloc(Variant, self.variants.len);
        var initialized: usize = 0;
        errdefer {
            for (variants[0..initialized]) |value| {
                allocator.free(value.fields);
                allocator.free(value.references);
            }
            allocator.free(variants);
        }
        for (self.variants, variants) |source, *destination| {
            const fields = try allocator.dupe(Field, source.fields);
            errdefer allocator.free(fields);
            const references = try allocator.dupe(Reference, source.references);
            destination.* = .{ .tag = source.tag, .kind = source.kind, .fields = fields, .references = references };
            initialized += 1;
        }
        var result = self;
        result.variants = variants;
        return result;
    }

    pub fn deinit(self: Layout, allocator: Allocator) void {
        for (self.variants) |value| {
            allocator.free(value.fields);
            allocator.free(value.references);
        }
        allocator.free(self.variants);
    }

    pub fn same(self: Layout, other: Layout) bool {
        if (!std.mem.eql(u8, &self.type_id, &other.type_id) or self.byte_size != other.byte_size or
            self.alignment != other.alignment or self.reference_count != other.reference_count or self.variants.len != other.variants.len) return false;
        for (self.variants, other.variants) |left, right| {
            if (left.tag != right.tag or left.kind != right.kind or left.fields.len != right.fields.len or left.references.len != right.references.len) return false;
            for (left.fields, right.fields) |a, b| if (a.offset != b.offset or a.code != b.code) return false;
            for (left.references, right.references) |a, b| {
                if (a.slot != b.slot or !std.meta.eql(a.type, b.type)) return false;
            }
        }
        return true;
    }
};

pub fn fieldSize(code: u8) ?u32 {
    return switch (code) {
        2, 3, 6 => 1,
        4, 7 => 2,
        1, 8, 12 => 4,
        5, 9, 10, 11, 13 => 8,
        else => null,
    };
}

pub const Input = struct { tag: u16 = 0, bytes: []const u8, references: []const ?handles.Handle };
// Buffer ownership and root ownership differ: deinit frees these copies only.
// Temporary returned roots end with their scope; persistent roots must be released.
pub const Value = struct {
    tag: u16,
    bytes: []u8,
    references: []?handles.Handle,
    pub fn deinit(self: *Value, allocator: Allocator) void {
        allocator.free(self.bytes);
        allocator.free(self.references);
        self.* = undefined;
    }
};
