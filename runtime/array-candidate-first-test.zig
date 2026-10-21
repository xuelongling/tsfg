// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");

test "private ArrayCandidate admits the independent complete module as immutable data" {
    try std.testing.expect(@hasDecl(bytecode, "arrayCandidate"));
    if (comptime @hasDecl(bytecode, "arrayCandidate")) {
        const Inputs = struct { packets: []const struct { hex: []const u8 } };
        const inputs = try std.json.parseFromSlice(Inputs, std.testing.allocator, @embedFile("testdata/array-packet-inputs.json"), .{ .ignore_unknown_fields = true });
        defer inputs.deinit();
        var bytes: [4573]u8 = undefined;
        _ = try std.fmt.hexToBytes(&bytes, inputs.value.packets[0].hex);
        const handle = switch (bytecode.arrayCandidate.load(std.testing.allocator, &bytes)) {
            .loaded => |value| value,
            .rejected => |failure| {
                std.debug.print("ArrayCandidate cold failure {s} at {d}\n", .{ failure.code, failure.offset });
                return error.UnexpectedRejection;
            },
        };
        defer bytecode.arrayCandidate.unload(handle);
        const oracle = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, @embedFile("testdata/array-packet-oracle.json"), .{});
        defer oracle.deinit();
        const expected = oracle.value.object.get("cases").?.array.items[0].object.get("decoded").?;
        const expectedText = try std.json.Stringify.valueAlloc(std.testing.allocator, expected, .{});
        defer std.testing.allocator.free(expectedText);
        const observed = try bytecode.arrayCandidate.inspect(handle, std.testing.allocator);
        defer std.testing.allocator.free(observed);
        try std.testing.expectEqualStrings(expectedText, observed);
        const copy = try bytecode.arrayCandidate.serialize(handle, std.testing.allocator);
        defer std.testing.allocator.free(copy);
        try std.testing.expectEqualSlices(u8, &bytes, copy);
    }
}
