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

test "current private Array loader refuses all30 historical complete packet v2 modules" {
    const Inputs = struct { packets: []const struct { bytes: usize, hex: []const u8 } };
    const allocator = std.testing.allocator;
    var count: usize = 0;
    inline for (.{ "testdata/array-packet-v2-inputs.json", "testdata/array-packet-v2-legacy-inputs.json", "testdata/array-packet-v2-additional-inputs.json" }) |file| {
        const inputs = try std.json.parseFromSlice(Inputs, allocator, @embedFile(file), .{ .ignore_unknown_fields = true });
        defer inputs.deinit();
        for (inputs.value.packets) |packet| {
            const bytes = try allocator.alloc(u8, packet.bytes);
            defer allocator.free(bytes);
            _ = try std.fmt.hexToBytes(bytes, packet.hex);
            try std.testing.expectEqual(@as(u32, 2), std.mem.readInt(u32, bytes[8..12], .little));
            switch (s.load(allocator, bytes)) {
                .loaded => |handle| {
                    s.unload(handle);
                    return error.HistoricalVersionUnexpectedlyAdmitted;
                },
                .rejected => |failure| try std.testing.expectEqualStrings("r04-array-format", failure.code),
            }
            count += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 30), count);
}
