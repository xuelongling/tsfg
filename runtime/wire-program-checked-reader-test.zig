// SPDX-License-Identifier: MIT
// Cold-path rejection controls for the prospective Common20 checked reader.
// These use the real retained Common18 packet as a wrong-version input; no
// synthetic Common20 packet stands in for the missing producer output.
const std = @import("std");
const model = @import("wire-program-model.zig");
const reader = @import("wire-program-checked-reader.zig");

const common18 = @embedFile("test-data/common18-decoder/positive.tbc");
const max_work = model.format.max_work;

test "checked reader rejects the retained Common18 packet before any typed check" {
    var work: usize = max_work;
    try std.testing.expectError(error.WrongFormat,
        reader.readOwnedChecked(std.testing.allocator, common18, null, &work));
    try std.testing.expect(work > 0 and work <= max_work);
}

test "checked reader rejects a truncated envelope and retains the charge" {
    var work: usize = max_work;
    try std.testing.expectError(error.PacketLimit,
        reader.readOwnedChecked(std.testing.allocator, common18[0..79], null, &work));
    try std.testing.expectEqual(@as(usize, 0), work);
}

test "owned decoder refuses a source allowance above the fixed cold budget" {
    var remaining: usize = max_work + 1;
    try std.testing.expectError(error.WorkLimit,
        @import("wire-program-decoder.zig").readOwned(std.testing.allocator, common18, &remaining));
    try std.testing.expectEqual(max_work + 1, remaining);
}

test "checked reader reports accounting rather than trusting a caller budget" {
    var work: usize = std.math.maxInt(usize);
    try std.testing.expectError(error.WrongFormat,
        reader.readOwnedChecked(std.testing.allocator, common18, null, &work));
    try std.testing.expect(work > 0 and work <= max_work);
}

test "checked reader rejects a packet over the fixed byte limit" {
    const oversized = try std.testing.allocator.alloc(u8, model.format.max_bytes + 1);
    defer std.testing.allocator.free(oversized);
    @memset(oversized, 0);
    @memcpy(oversized[0..8], "TSFGTBC0");
    var work: usize = std.math.maxInt(usize);
    try std.testing.expectError(error.PacketLimit,
        reader.readOwnedChecked(std.testing.allocator, oversized, null, &work));
    try std.testing.expectEqual(@as(usize, 0), work);
}

test "checked reader rejects a real packet whose payload digest does not match" {
    const corrupted = try std.testing.allocator.dupe(u8, common18);
    defer std.testing.allocator.free(corrupted);
    corrupted[common18.len - 1] ^= 0x01;
    var work: usize = max_work;
    try std.testing.expectError(error.InvalidIntegrity,
        reader.readOwnedChecked(std.testing.allocator, corrupted, null, &work));
    try std.testing.expect(work > 0 and work <= max_work);
}

test "checked reader rejects a byte count that disagrees with the envelope" {
    const extra = try std.testing.allocator.alloc(u8, common18.len + 1);
    defer std.testing.allocator.free(extra);
    @memcpy(extra[0..common18.len], common18);
    extra[common18.len] = 0;
    var work: usize = max_work;
    try std.testing.expectError(error.PacketLimit,
        reader.readOwnedChecked(std.testing.allocator, extra, null, &work));
    try std.testing.expect(work > 0 and work <= max_work);
}
