// SPDX-License-Identifier: MIT
const std = @import("std");
const nullable = @import("bytecode.zig").nullable;
const Case = struct {
    name: []const u8,
    hex: []const u8,
    bytes: usize,
    sha256: []const u8,
    target: struct { cursor: usize, countOffset: usize, count: usize, minRecordBytes: usize, remaining: usize },
    expected: struct { code: []const u8, offset: usize },
};
const Cases = struct { cases: []const Case };

// Prefix/input allocations are allowed. An oversized arena growth is observed,
// not silently satisfied; resize/remap cannot hide that reservation in place.
const Limited = struct {
    backing: std.mem.Allocator = std.testing.allocator,
    cutoff: usize,
    blocked: usize = 0,
    largest: usize = 0,
    live: usize = 0,
    fn allocator(self: *Limited) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(ctx: *anyopaque, size: usize, alignment: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.largest = @max(self.largest, size);
        if (size > self.cutoff) {
            self.blocked += 1;
            return null;
        }
        const memory = self.backing.rawAlloc(size, alignment, ra) orelse return null;
        self.live += size;
        return memory;
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool {
        return false;
    }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 {
        return null;
    }
    fn free(ctx: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ra: usize) void {
        const self: *Limited = @ptrCast(@alignCast(ctx));
        self.live -= memory.len;
        self.backing.rawFree(memory, alignment, ra);
    }
};

fn boundary(index: usize, cutoff: usize) !void {
    const parsed = try std.json.parseFromSlice(Cases, std.testing.allocator, @embedFile("testdata/nullable-count-remaining-negative.json"), .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    try std.testing.expectEqual(@as(usize, 4), parsed.value.cases.len);
    const case = parsed.value.cases[index];
    const bytes = try std.testing.allocator.alloc(u8, case.bytes);
    defer std.testing.allocator.free(bytes);
    _ = try std.fmt.hexToBytes(bytes, case.hex);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    try std.testing.expectEqualStrings(case.sha256, &std.fmt.bytesToHex(digest, .lower));
    try std.testing.expectEqual(@as(u32, @intCast(bytes.len)), std.mem.readInt(u32, bytes[44..48], .little));
    std.crypto.hash.sha2.Sha256.hash(bytes[80..], &digest, .{});
    try std.testing.expectEqualSlices(u8, &digest, bytes[48..80]);
    try std.testing.expectEqual(case.target.count, @as(usize, std.mem.readInt(u16, bytes[case.target.countOffset..][0..2], .little)));
    try std.testing.expectEqual(case.target.remaining, bytes.len - case.target.cursor);
    try std.testing.expect(case.target.count > case.target.remaining / case.target.minRecordBytes);
    var limited: Limited = .{ .cutoff = cutoff };
    switch (nullable.load(limited.allocator(), bytes)) {
        .loaded => |module| {
            nullable.unload(module);
            return error.UnexpectedAdmission;
        },
        .rejected => |failure| {
            std.debug.print("count boundary {s}: {s} at{d}, cutoff{d}, largest{d}, blocked{d}, live{d}\n", .{ case.name, failure.code, failure.offset, cutoff, limited.largest, limited.blocked, limited.live });
            // Even RED must show the blocked reservation is at the target cursor,
            // after all ordinary prefix allocations, with no leaked ownership.
            try std.testing.expectEqual(case.expected.offset, failure.offset);
            try std.testing.expectEqual(@as(usize, 0), limited.live);
            try std.testing.expectEqual(@as(usize, 0), limited.blocked);
            try std.testing.expectEqualStrings(case.expected.code, failure.code);
        },
    }
}

test "Function count cannot reserve before encoded records remain" {
    try boundary(0, 4096);
}
test "Block count cannot reserve before encoded records remain" {
    try boundary(1, 4096);
}
test "Parameter count cannot reserve before encoded records remain" {
    try boundary(2, 8192);
}
test "Instruction count cannot reserve before encoded records remain" {
    try boundary(3, 65536);
}
