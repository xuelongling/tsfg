// SPDX-License-Identifier: MIT
// Cold data tests for the retained Common20 right packet.
const std = @import("std");
const model = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const reader = @import("wire-program-checked-reader.zig");

const packet = @embedFile("test-data/common20/right.tbc");
const allocator = std.testing.allocator;

test "checked reader accepts the real right packet and owns its decoded bytes" {
    const borrowed = try allocator.dupe(u8, packet);
    defer allocator.free(borrowed);
    var work: usize = 0;
    var owned = try reader.readOwnedChecked(allocator, borrowed, null, &work);
    defer owned.deinit();
    @memset(borrowed, 0);
    try std.testing.expectEqualSlices(u8, packet, owned.encoded);
    try std.testing.expect(work > 0 and work <= model.format.max_work);
    const program = &owned.program;
    try std.testing.expectEqualStrings("3dce93bcece355dbd642fe88f4f1fb140442cb1af5a81f19588cce7889945f16",
        &std.fmt.bytesToHex(program.input_identity, .lower));
    try std.testing.expectEqual(@as(usize, 0), program.tables.mode.common.modules.hosts.len);
    try std.testing.expectEqual(@as(usize, 3), program.functions.len);
    for (program.functions) |function| {
        if (!std.mem.eql(u8, function.name, "right")) continue;
        try std.testing.expectEqualStrings("0de954af1dcdd4d55cab1e92db5ec1e7e4a2af709b91ea6eb4f51af916ae7769",
            &std.fmt.bytesToHex(function.id, .lower));
        return;
    }
    return error.MissingRightFunction;
}

test "checked reader frees the decoded arena if independent verification runs out of memory" {
    var tracker = std.testing.FailingAllocator.init(allocator, .{});
    var remaining: usize = model.format.max_work;
    var decoded = try decoder.readOwned(tracker.allocator(), packet, &remaining);
    decoded.deinit();
    try std.testing.expectEqual(tracker.allocated_bytes, tracker.freed_bytes);

    // Fail the first allocation after the same packet has decoded successfully.
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = tracker.alloc_index });
    var work: usize = 0;
    try std.testing.expectError(error.OutOfMemory, reader.readOwnedChecked(failing.allocator(), packet, null, &work));
    try std.testing.expect(failing.has_induced_failure);
    try std.testing.expect(work > model.format.max_work - remaining and work <= model.format.max_work);
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}
