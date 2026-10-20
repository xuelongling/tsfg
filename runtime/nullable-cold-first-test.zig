// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");

test "actual private packet is independently cold admitted with its complete authored model" {
    try std.testing.expect(@hasDecl(bytecode, "nullable"));
    if (comptime @hasDecl(bytecode, "nullable")) {
        const Input = struct { hex: []const u8 };
        const input = try std.json.parseFromSlice(Input, std.testing.allocator, @embedFile("testdata/nullable-cold-packet.json"), .{ .ignore_unknown_fields = true });
        defer input.deinit();
        var bytes: [1721]u8 = undefined;
        _ = try std.fmt.hexToBytes(&bytes, input.value.hex);
        const module = switch (bytecode.nullable.load(std.testing.allocator, &bytes)) {
            .loaded => |value| value,
            .rejected => |failure| { std.debug.print("cold rejection {s} at {d}\n", .{ failure.code, failure.offset }); return error.UnexpectedRejection; },
        };
        defer bytecode.nullable.unload(module);
        const text = try bytecode.nullable.inspect(module, std.testing.allocator);
        defer std.testing.allocator.free(text);
        try std.testing.expectEqualStrings(std.mem.trim(u8, @embedFile("testdata/nullable-cold-expected.json"), "\r\n"), text);
        const copied = try bytecode.nullable.serialize(module, std.testing.allocator);
        defer std.testing.allocator.free(copied);
        try std.testing.expectEqualSlices(u8, &bytes, copied);
    }
}
