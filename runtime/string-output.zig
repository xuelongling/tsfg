// SPDX-License-Identifier: MIT
// The CLI's synchronous byte consumer owns a bounded copy and an independent
// source root. Tokens authorize reads only during this exact lease.
const std = @import("std");
const values = @import("string-value.zig");
pub const Mode = enum { strict, lossy };
pub const Token = struct { owner: u64, slot: usize, generation: u64 };
pub const Lease = struct {
    allocator: std.mem.Allocator = undefined,
    source: values.String = undefined,
    storage: []u8 = &.{},
    token: Token = .{ .owner = 0, .slot = 0, .generation = 0 },
    active: bool = false,
    binding: usize = 0,

    // In-place publication binds immediately, before any owned value can be
    // copied. Empty wrappers own nothing; tokens retain no wrapper address.
    pub fn begin(self: *Lease, allocator: std.mem.Allocator, source: values.String, mode: Mode, maximum: usize) !Token {
        if (self.binding != 0 and self.binding != @intFromPtr(self)) return error.InvalidStringLease;
        if (self.active) return error.ActiveStringLease;
        var kept = try values.String.retain(source.owner, source.handle);
        errdefer kept.deinit();
        const heap = &source.owner.heap;
        const byte_length = try heap.stringByteLength(source.handle);
        if (byte_length > maximum) return error.OutputLimit;
        // A surrogate's replacement has the same three-byte width. Valid pairs
        // retain four bytes, so canonical WTF-8 length is also the output bound.
        const bytes = try allocator.alloc(u8, byte_length);
        errdefer allocator.free(bytes);
        _ = try heap.copyStringBytes(source.handle, bytes);
        if (mode == .strict) {
            if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
        } else {
            // Canonical WTF8 encodes every isolated surrogate as ED A0..BF xx.
            // Valid pairs are already four-byte scalars. Replace exactly those
            // three-byte sequences in the owned copy, with no extra unit buffer
            // or repeated O(n) logical indexing for a large output.
            var i: usize = 0;
            while (i < bytes.len) : (i += 1) {
                if (bytes[i] == 0xed and i + 2 < bytes.len and bytes[i + 1] >= 0xa0 and bytes[i + 1] <= 0xbf) {
                    @memcpy(bytes[i..][0..3], &[_]u8{ 0xef, 0xbf, 0xbd });
                    i += 2;
                }
            }
        }
        self.* = .{ .allocator = allocator, .source = kept, .storage = bytes, .active = true, .binding = @intFromPtr(self),
            .token = .{ .owner = kept.handle.owner, .slot = kept.handle.slot, .generation = kept.handle.generation } };
        return self.token;
    }
    fn validate(self: *Lease, token: Token) !void {
        if (self.binding != 0 and self.binding != @intFromPtr(self)) return error.InvalidStringLease;
        self.binding = @intFromPtr(self);
        if (!self.active or token.owner != self.token.owner or token.slot != self.token.slot or token.generation != self.token.generation)
            return error.ExpiredStringView;
        _ = try self.source.owner.heap.stringLength(self.source.handle);
    }
    pub fn byteLength(self: *Lease, token: Token) !usize { try self.validate(token); return self.storage.len; }
    pub fn readByte(self: *Lease, token: Token, index: usize) !u8 {
        try self.validate(token);
        if (index >= self.storage.len) return error.IndexOutOfBounds;
        return self.storage[index];
    }
    pub fn writeJson(self: *Lease, token: Token, writer: *std.Io.Writer) !void {
        try self.validate(token);
        try std.json.Stringify.value(@as([]const u8, self.storage), .{}, writer);
    }
    pub fn end(self: *Lease) !void {
        if (self.binding != 0 and self.binding != @intFromPtr(self)) return error.InvalidStringLease;
        self.binding = @intFromPtr(self);
        if (!self.active) return;
        self.active = false;
        self.allocator.free(self.storage);
        self.storage = &.{};
        self.source.deinit();
    }
};
