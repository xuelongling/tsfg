// SPDX-License-Identifier: MIT
const std = @import("std");
const model = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const facts = @import("wire-program-actual-facts.zig");
const targets = @import("wire-program-targets-check.zig");

test "heap merges preserve synthetic scalar identity and explicit allocation facts" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    const scalar = for (owned.program.tables.mode.common.types, 0..) |row, i| {
        if (std.mem.eql(u8, row.name, "u32")) break @as(model.types.TypeRef, @enumFromInt(i));
    } else return error.TestExpectedU32;
    var original: facts.Heap = .{};
    defer original.deinit(std.testing.allocator);
    const length: facts.Slot = .{ .length = @enumFromInt(0) };
    const synthetic = facts.Value{ .tags = &.{scalar}, .number = 1 };
    try std.testing.expect(try original.put(&c, length, synthetic, true));
    var merged = try facts.Heap.clone(&c, original.view());
    defer merged.deinit(std.testing.allocator);
    // Revisiting the same abstract world adds no fact and must not create a
    // different invocation key merely by materializing implicit scalar data.
    try std.testing.expect(!try merged.join(&c, original.view()));
    try std.testing.expect(!try merged.put(&c, length, synthetic, true));
    try std.testing.expectEqual(@as(?i64, 1), merged.view().get(length).?.number);

    const allocation: facts.Slot = .{ .element = .{ .object = @enumFromInt(0), .index = 0 } };
    const explicit = facts.Value{ .objects = &.{@enumFromInt(1)}, .region = .{ .known = true, .roots = &.{@enumFromInt(0)} } };
    try std.testing.expect(try original.put(&c, allocation, explicit, true));
    try std.testing.expect(try merged.join(&c, original.view()));
    const saved = merged.view().get(allocation).?;
    try std.testing.expect(saved.region.known);
    try std.testing.expect(!saved.region.unresolved);
    try std.testing.expectEqual(@as(usize, 1), saved.region.roots.len);
    try std.testing.expectEqual(explicit.region.roots[0], saved.region.roots[0]);
    try std.testing.expect(!try merged.join(&c, original.view()));

    const uninitialized: facts.Slot = .{ .cell = @enumFromInt(0) };
    try std.testing.expect(try merged.put(&c, uninitialized, .{}, true));
    const bottom = merged.view().get(uninitialized).?;
    try std.testing.expect(bottom.bottom());
    try std.testing.expect(!bottom.region.known);
    try std.testing.expect(c.remaining < remaining);
}

// This target-only check has no observers and does not establish complete
// effects/refcheck acceptance.
test "targets fixed point completes for Common18 synthetic length with a shared balance" {
    const initial_work: usize = model.format.max_work;
    var remaining = initial_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const after_decode = remaining;
    try std.testing.expect(after_decode < initial_work);
    try std.testing.expectEqual(@as(usize, 0), owned.program.tables.mode.common.modules.hosts.len);
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = after_decode };
    defer remaining = c.remaining;
    var actual = try targets.analyze(&c, null, &.{});
    defer actual.deinit(std.testing.allocator);
    try std.testing.expect(actual.owner == &c);
    try std.testing.expect(actual.final_replay_complete);
    try std.testing.expect(actual.invocations.items.len > 0);
    try std.testing.expect(c.remaining > 0 and c.remaining < after_decode);
}
