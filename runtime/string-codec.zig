// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;

pub const FormatError = error{InvalidCanonicalWtf8};
pub const LengthError = FormatError || error{LengthOverflow};
pub const ReadError = FormatError || error{IndexOutOfBounds};
pub const EncodeError = error{ LengthOverflow, BufferTooSmall };

const Sequence = struct {
    bytes: usize,
    units: u8,
    first: u16,
    second: u16 = 0,
};

fn isContinuation(byte: u8) bool {
    return byte & 0xC0 == 0x80;
}

fn sequenceAt(bytes: []const u8, index: usize) FormatError!Sequence {
    const lead = bytes[index];
    if (lead < 0x80) return .{ .bytes = 1, .units = 1, .first = lead };
    if (lead < 0xC2) return error.InvalidCanonicalWtf8;
    if (lead <= 0xDF) {
        if (index + 1 >= bytes.len or !isContinuation(bytes[index + 1])) return error.InvalidCanonicalWtf8;
        const value: u16 = (@as(u16, lead & 0x1F) << 6) | (bytes[index + 1] & 0x3F);
        return .{ .bytes = 2, .units = 1, .first = value };
    }
    if (lead <= 0xEF) {
        if (index + 2 >= bytes.len or !isContinuation(bytes[index + 1]) or !isContinuation(bytes[index + 2]))
            return error.InvalidCanonicalWtf8;
        if (lead == 0xE0 and bytes[index + 1] < 0xA0) return error.InvalidCanonicalWtf8;
        if (lead == 0xED and bytes[index + 1] >= 0xA0 and bytes[index + 1] <= 0xAF) {
            if (index + 5 < bytes.len and bytes[index + 3] == 0xED and
                bytes[index + 4] >= 0xB0 and bytes[index + 4] <= 0xBF and isContinuation(bytes[index + 5]))
                return error.InvalidCanonicalWtf8;
        }
        const value: u16 = (@as(u16, lead & 0x0F) << 12) |
            (@as(u16, bytes[index + 1] & 0x3F) << 6) | (bytes[index + 2] & 0x3F);
        return .{ .bytes = 3, .units = 1, .first = value };
    }
    if (lead <= 0xF4) {
        if (index + 3 >= bytes.len or !isContinuation(bytes[index + 1]) or
            !isContinuation(bytes[index + 2]) or !isContinuation(bytes[index + 3]))
            return error.InvalidCanonicalWtf8;
        if (lead == 0xF0 and bytes[index + 1] < 0x90) return error.InvalidCanonicalWtf8;
        if (lead == 0xF4 and bytes[index + 1] > 0x8F) return error.InvalidCanonicalWtf8;
        const scalar: u21 = (@as(u21, lead & 0x07) << 18) |
            (@as(u21, bytes[index + 1] & 0x3F) << 12) |
            (@as(u21, bytes[index + 2] & 0x3F) << 6) |
            (bytes[index + 3] & 0x3F);
        const adjusted: u21 = scalar - 0x10000;
        return .{
            .bytes = 4,
            .units = 2,
            .first = 0xD800 + @as(u16, @intCast(adjusted >> 10)),
            .second = 0xDC00 + @as(u16, @intCast(adjusted & 0x3FF)),
        };
    }
    return error.InvalidCanonicalWtf8;
}

pub fn canonicalLength(bytes: []const u8) LengthError!usize {
    var index: usize = 0;
    var units: usize = 0;
    while (index < bytes.len) {
        const sequence = try sequenceAt(bytes, index);
        if (units > std.math.maxInt(usize) - @as(usize, sequence.units)) return error.LengthOverflow;
        units += sequence.units;
        index += sequence.bytes;
    }
    return units;
}

pub fn encodedLength(units: []const u16) error{LengthOverflow}!usize {
    var index: usize = 0;
    var bytes: usize = 0;
    while (index < units.len) {
        const unit = units[index];
        var width: usize = undefined;
        if (unit < 0x80) {
            width = 1;
        } else if (unit < 0x800) {
            width = 2;
        } else if (unit >= 0xD800 and unit <= 0xDBFF and index + 1 < units.len and
            units[index + 1] >= 0xDC00 and units[index + 1] <= 0xDFFF)
        {
            width = 4;
            index += 1;
        } else {
            width = 3;
        }
        if (bytes > std.math.maxInt(usize) - width) return error.LengthOverflow;
        bytes += width;
        index += 1;
    }
    return bytes;
}

pub fn encodeInto(units: []const u16, out: []u8) EncodeError!usize {
    const needed = try encodedLength(units);
    if (out.len < needed) return error.BufferTooSmall;
    var source: usize = 0;
    var target: usize = 0;
    while (source < units.len) {
        const unit = units[source];
        if (unit < 0x80) {
            out[target] = @intCast(unit);
            target += 1;
        } else if (unit < 0x800) {
            out[target] = 0xC0 | @as(u8, @intCast(unit >> 6));
            out[target + 1] = 0x80 | @as(u8, @intCast(unit & 0x3F));
            target += 2;
        } else if (unit >= 0xD800 and unit <= 0xDBFF and source + 1 < units.len and
            units[source + 1] >= 0xDC00 and units[source + 1] <= 0xDFFF)
        {
            const scalar: u21 = 0x10000 +
                (@as(u21, unit - 0xD800) << 10) + (units[source + 1] - 0xDC00);
            out[target] = 0xF0 | @as(u8, @intCast(scalar >> 18));
            out[target + 1] = 0x80 | @as(u8, @intCast((scalar >> 12) & 0x3F));
            out[target + 2] = 0x80 | @as(u8, @intCast((scalar >> 6) & 0x3F));
            out[target + 3] = 0x80 | @as(u8, @intCast(scalar & 0x3F));
            target += 4;
            source += 1;
        } else {
            out[target] = 0xE0 | @as(u8, @intCast(unit >> 12));
            out[target + 1] = 0x80 | @as(u8, @intCast((unit >> 6) & 0x3F));
            out[target + 2] = 0x80 | @as(u8, @intCast(unit & 0x3F));
            target += 3;
        }
        source += 1;
    }
    return target;
}

pub fn encodeAlloc(allocator: Allocator, units: []const u16) (Allocator.Error || EncodeError)![]u8 {
    const needed = try encodedLength(units);
    const out = try allocator.alloc(u8, needed);
    errdefer allocator.free(out);
    _ = try encodeInto(units, out);
    return out;
}

/// Concatenate logical code units while retaining canonical WTF-8 at the join.
/// Only an isolated high/low boundary changes bytes; no Unicode normalization.
pub fn concatAlloc(allocator: Allocator, left: []const u8, right: []const u8) (Allocator.Error || LengthError)![]u8 {
    _ = try canonicalLength(left);
    _ = try canonicalLength(right);
    if (left.len > std.math.maxInt(usize) - right.len) return error.LengthOverflow;
    const total = left.len + right.len;
    const high_tail = left.len >= 3 and left[left.len - 3] == 0xED and
        left[left.len - 2] >= 0xA0 and left[left.len - 2] <= 0xAF;
    const low_head = right.len >= 3 and right[0] == 0xED and
        right[1] >= 0xB0 and right[1] <= 0xBF;
    const merge = high_tail and low_head;
    const needed = if (merge) total - 2 else total;
    const out = try allocator.alloc(u8, needed);
    errdefer allocator.free(out);
    if (merge) {
        const prefix = left.len - 3;
        @memcpy(out[0..prefix], left[0..prefix]);
        const pair = [_]u16{ (try sequenceAt(left, prefix)).first, (try sequenceAt(right, 0)).first };
        // Validated high/low units encode to exactly four bytes in this exact slice.
        _ = encodeInto(&pair, out[prefix .. prefix + 4]) catch unreachable;
        @memcpy(out[prefix + 4 ..], right[3..]);
    } else {
        @memcpy(out[0..left.len], left);
        @memcpy(out[left.len..], right);
    }
    return out;
}

pub fn codeUnitAt(bytes: []const u8, index: usize) ReadError!u16 {
    var byte_index: usize = 0;
    var unit_index: usize = 0;
    while (byte_index < bytes.len) {
        const sequence = try sequenceAt(bytes, byte_index);
        if (index == unit_index) return sequence.first;
        if (sequence.units == 2 and index == unit_index + 1) return sequence.second;
        unit_index += sequence.units;
        byte_index += sequence.bytes;
    }
    return error.IndexOutOfBounds;
}

// A slice is a contiguous logical code-unit range, even across a four-byte pair.
fn slicePass(bytes: []const u8, start: usize, end: usize, out: ?[]u8) LengthError!usize {
    var source: usize = 0;
    var unit: usize = 0;
    var target: usize = 0;
    while (source < bytes.len) {
        const sequence = try sequenceAt(bytes, source);
        const first = unit >= start and unit < end;
        const second = sequence.units == 2 and unit + 1 >= start and unit + 1 < end;
        if (first or second) {
            const cut_pair = sequence.units == 2 and first != second;
            const width: usize = if (cut_pair) 3 else sequence.bytes;
            if (target > std.math.maxInt(usize) - width) return error.LengthOverflow;
            if (out) |buffer| {
                if (cut_pair) {
                    const isolated = [_]u16{if (first) sequence.first else sequence.second};
                    _ = encodeInto(&isolated, buffer[target .. target + width]) catch unreachable;
                } else @memcpy(buffer[target .. target + width], bytes[source .. source + width]);
            }
            target += width;
        }
        source += sequence.bytes;
        unit += sequence.units;
    }
    return target;
}

/// Exact UTF16 [start,end); language argument adaptation is a separate boundary.
pub fn sliceAlloc(allocator: Allocator, bytes: []const u8, start: usize, end: usize) (Allocator.Error || LengthError || error{IndexOutOfBounds})![]u8 {
    const length = try canonicalLength(bytes);
    if (start > end or end > length) return error.IndexOutOfBounds;
    const needed = try slicePass(bytes, start, end, null);
    const out = try allocator.alloc(u8, needed);
    errdefer allocator.free(out);
    _ = try slicePass(bytes, start, end, out);
    return out;
}

const CodeUnits = struct {
    bytes: []const u8,
    index: usize = 0,
    pending: ?u16 = null,

    fn next(self: *CodeUnits) FormatError!?u16 {
        if (self.pending) |unit| {
            self.pending = null;
            return unit;
        }
        if (self.index == self.bytes.len) return null;
        const sequence = try sequenceAt(self.bytes, self.index);
        self.index += sequence.bytes;
        if (sequence.units == 2) self.pending = sequence.second;
        return sequence.first;
    }
};

/// Validate both complete encodings before any early lexicographic decision.
pub fn compare(left: []const u8, right: []const u8) LengthError!std.math.Order {
    _ = try canonicalLength(left);
    _ = try canonicalLength(right);
    var lhs: CodeUnits = .{ .bytes = left };
    var rhs: CodeUnits = .{ .bytes = right };
    while (true) {
        const a = try lhs.next();
        const b = try rhs.next();
        if (a == null) return if (b == null) .eq else .lt;
        if (b == null) return .gt;
        if (a.? < b.?) return .lt;
        if (a.? > b.?) return .gt;
    }
}
