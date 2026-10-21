// SPDX-License-Identifier: MIT
// Concrete owned payloads share the real heap graph lifecycle; no handles or borrowed views live here.
const std = @import("std");
const Allocator = std.mem.Allocator;
const codec = @import("string-codec.zig");

pub const Error = Allocator.Error || error{
    TypeMismatch,
    StringTooLarge,
    InvalidString,
    IndexOutOfBounds,
    BufferTooSmall,
    ArrayTooLarge,
    UninitializedGrowth,
};
const StringPayload = struct { bytes: []u8, utf16_length: usize };
const ArrayPayload = struct { items: []f64, length: usize };

pub const Payload = union(enum) {
    scalar: u64,
    string: StringPayload,
    array_f64: ArrayPayload,

    pub fn fromString(allocator: Allocator, units: []const u16) Error!Payload {
        const bytes = codec.encodeAlloc(allocator, units) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.LengthOverflow => return error.StringTooLarge,
            error.BufferTooSmall => unreachable,
        };
        errdefer allocator.free(bytes);
        const length = codec.canonicalLength(bytes) catch return error.InvalidString;
        if (length != units.len) return error.InvalidString;
        return .{ .string = .{ .bytes = bytes, .utf16_length = units.len } };
    }

    pub fn fromConcat(allocator: Allocator, left: Payload, right: Payload) Error!Payload {
        const lhs = try left.asString();
        const rhs = try right.asString();
        if (lhs.utf16_length > std.math.maxInt(usize) - rhs.utf16_length) return error.StringTooLarge;
        const length = lhs.utf16_length + rhs.utf16_length;
        const bytes = codec.concatAlloc(allocator, lhs.bytes, rhs.bytes) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.LengthOverflow => return error.StringTooLarge,
            error.InvalidCanonicalWtf8 => return error.InvalidString,
        };
        errdefer allocator.free(bytes);
        const actual_length = codec.canonicalLength(bytes) catch return error.InvalidString;
        if (actual_length != length) return error.InvalidString;
        return .{ .string = .{ .bytes = bytes, .utf16_length = length } };
    }

    pub fn fromStringSlice(allocator: Allocator, source: Payload, start: usize, end: usize) Error!Payload {
        const value = try source.asString();
        const bytes = codec.sliceAlloc(allocator, value.bytes, start, end) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.LengthOverflow => return error.StringTooLarge,
            error.InvalidCanonicalWtf8 => return error.InvalidString,
            error.IndexOutOfBounds => return error.IndexOutOfBounds,
        };
        return .{ .string = .{ .bytes = bytes, .utf16_length = end - start } };
    }

    pub fn compareStrings(self: Payload, other: Payload) Error!std.math.Order {
        const left = try self.asString();
        const right = try other.asString();
        return codec.compare(left.bytes, right.bytes) catch |err| switch (err) {
            error.LengthOverflow => return error.StringTooLarge,
            error.InvalidCanonicalWtf8 => return error.InvalidString,
        };
    }

    pub fn fromArrayF64(allocator: Allocator, values: []const f64) Error!Payload {
        if (values.len > std.math.maxInt(u32)) return error.ArrayTooLarge;
        return .{ .array_f64 = .{ .items = try allocator.dupe(f64, values), .length = values.len } };
    }

    pub fn deinit(self: Payload, allocator: Allocator) void {
        switch (self) {
            .scalar => {},
            .string => |value| allocator.free(value.bytes),
            .array_f64 => |value| allocator.free(value.items),
        }
    }

    pub fn clone(self: Payload, allocator: Allocator) Error!Payload {
        return switch (self) {
            .scalar => |value| .{ .scalar = value },
            .string => |value| .{ .string = .{
                .bytes = try allocator.dupe(u8, value.bytes),
                .utf16_length = value.utf16_length,
            } },
            // Only the initialized logical prefix survives; capacity is private and may change at GC.
            .array_f64 => |value| try fromArrayF64(allocator, value.items[0..value.length]),
        };
    }

    fn asString(self: Payload) Error!StringPayload {
        return switch (self) {
            .string => |value| value,
            else => error.TypeMismatch,
        };
    }

    pub fn stringLength(self: Payload) Error!usize {
        return (try self.asString()).utf16_length;
    }

    pub fn stringByteLength(self: Payload) Error!usize {
        return (try self.asString()).bytes.len;
    }

    pub fn copyStringCodeUnits(self: Payload, out: []u16) Error!usize {
        return codec.decodeInto((try self.asString()).bytes, out) catch |err| switch (err) {
            error.InvalidCanonicalWtf8 => error.InvalidString,
            error.LengthOverflow => error.StringTooLarge,
            error.BufferTooSmall => error.BufferTooSmall,
        };
    }

    pub fn readStringCodeUnit(self: Payload, index: usize) Error!u16 {
        const value = try self.asString();
        if (index >= value.utf16_length) return error.IndexOutOfBounds;
        const length = codec.canonicalLength(value.bytes) catch return error.InvalidString;
        if (length != value.utf16_length) return error.InvalidString;
        return codec.codeUnitAt(value.bytes, index) catch |err| switch (err) {
            error.InvalidCanonicalWtf8 => return error.InvalidString,
            error.IndexOutOfBounds => return error.IndexOutOfBounds,
        };
    }

    pub fn copyStringBytes(self: Payload, out: []u8) Error!usize {
        const value = try self.asString();
        if (out.len < value.bytes.len) return error.BufferTooSmall;
        const length = codec.canonicalLength(value.bytes) catch return error.InvalidString;
        if (length != value.utf16_length) return error.InvalidString;
        @memcpy(out[0..value.bytes.len], value.bytes);
        return value.bytes.len;
    }

    pub fn arrayF64Length(self: Payload) Error!u32 {
        return switch (self) {
            .array_f64 => |value| @intCast(value.length),
            else => error.TypeMismatch,
        };
    }

    pub fn readArrayF64(self: Payload, index: u32) Error!f64 {
        return switch (self) {
            .array_f64 => |value| if (index < value.length) value.items[index] else error.IndexOutOfBounds,
            else => error.TypeMismatch,
        };
    }

    pub fn storeArrayF64(self: *Payload, allocator: Allocator, index: u32, element: f64) Error!void {
        switch (self.*) {
            .array_f64 => |*value| {
                if (index > value.length) return error.IndexOutOfBounds;
                if (index < value.length) {
                    value.items[index] = element;
                    return;
                }
                const maximum: usize = std.math.maxInt(u32);
                if (value.length == maximum) return error.ArrayTooLarge;
                if (value.length < value.items.len) {
                    value.items[value.length] = element;
                    value.length += 1;
                    return;
                }
                const growth = @min(maximum - value.items.len, value.items.len / 2 + 1);
                const capacity = @max(@as(usize, 8), value.items.len + growth);
                const replacement = try allocator.alloc(f64, capacity);
                @memcpy(replacement[0..value.length], value.items[0..value.length]);
                replacement[value.length] = element;
                // All fallible work precedes this commit; failed append retains the old prefix.
                allocator.free(value.items);
                value.items = replacement;
                value.length += 1;
            },
            else => return error.TypeMismatch,
        }
    }

    pub fn resizeArrayF64(self: *Payload, length: u32) Error!void {
        switch (self.*) {
            .array_f64 => |*value| {
                if (length > value.length) return error.UninitializedGrowth;
                value.length = length;
            },
            else => return error.TypeMismatch,
        }
    }
};
