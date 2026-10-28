// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");

test "private StringCandidate admits the independent whole packet as immutable data" {
    try std.testing.expect(@hasDecl(bytecode, "stringCandidate"));
    if (comptime @hasDecl(bytecode, "stringCandidate")) {
        const Input = struct { packets: []const struct { hex: []const u8 } };
        const inputs = try std.json.parseFromSlice(Input, std.testing.allocator, @embedFile("testdata/string-packet-inputs.json"), .{ .ignore_unknown_fields = true });
        defer inputs.deinit();
        var bytes: [2648]u8 = undefined;
        _ = try std.fmt.hexToBytes(&bytes, inputs.value.packets[0].hex);
        const handle = switch (bytecode.stringCandidate.load(std.testing.allocator, &bytes)) {
            .loaded => |value| value,
            .rejected => |failure| {
                std.debug.print("StringCandidate cold failure {s} at {d}\n", .{ failure.code, failure.offset });
                return error.UnexpectedRejection;
            },
        };
        defer bytecode.stringCandidate.unload(handle);
        const oracle = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, @embedFile("testdata/string-packet-oracle.json"), .{});
        defer oracle.deinit();
        const expected = oracle.value.object.get("cases").?.array.items[0].object.get("decoded").?;
        const expectedText = try std.json.Stringify.valueAlloc(std.testing.allocator, expected, .{});
        defer std.testing.allocator.free(expectedText);
        const observed = try bytecode.stringCandidate.inspect(handle, std.testing.allocator);
        defer std.testing.allocator.free(observed);
        try std.testing.expectEqualStrings(expectedText, observed);
        const copy = try bytecode.stringCandidate.serialize(handle, std.testing.allocator);
        defer std.testing.allocator.free(copy);
        try std.testing.expectEqualSlices(u8, &bytes, copy);
    }
}
