// SPDX-License-Identifier: MIT
// Frozen before v2 implementation. Version-only RED/GREEN, not new-domain coverage.
const std = @import("std");
const s = @import("bytecode.zig").arrayCandidate;

test "current private Array loader refuses the historical complete packet v1" {
    const Inputs = struct { packets: []const struct { hex: []const u8 } };
    const inputs = try std.json.parseFromSlice(Inputs, std.testing.allocator, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
    defer inputs.deinit();
    var bytes: [4573]u8 = undefined;
    _ = try std.fmt.hexToBytes(&bytes, inputs.value.packets[0].hex);
    try std.testing.expectEqual(@as(u32, 1), std.mem.readInt(u32, bytes[8..12], .little));
    switch (s.load(std.testing.allocator, &bytes)) {
        .loaded => |handle| {
            s.unload(handle);
            return error.HistoricalVersionUnexpectedlyAdmitted;
        },
        .rejected => |failure| try std.testing.expectEqualStrings("r04-array-format", failure.code),
    }
}
