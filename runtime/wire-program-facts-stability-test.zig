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

test "constructor roots receive legal hidden control frames and unknown ordinary inputs" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const after_decode = remaining;
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = after_decode };
    defer remaining = c.remaining;
    var actual = try targets.analyze(&c, null, &.{});
    defer actual.deinit(std.testing.allocator);
    const common = owned.program.tables.mode.common;
    var constructor_roots: usize = 0;
    var ordinary_inputs: usize = 0;
    var no_throw_constructor_roots: usize = 0;
    for (actual.invocations.items, 0..) |invocation, invocation_index| {
        if (!invocation.root) continue;
        const function = owned.program.functions[@intFromEnum(invocation.function)];
        if (function.role != .construction_body) continue;
        constructor_roots += 1;
        const contract = for (common.authority.fixed_publication.publication.contracts) |*row| {
            if (std.mem.eql(u8, &row.function_id, &function.id)) break row;
        } else return error.TestExpectedConstructorContract;
        // This fixture's no-throw constructor returns normally. Keep the real
        // typed upper as the guard instead of banning valid throwing bodies.
        if (!contract.upper.facets.may_throw) {
            no_throw_constructor_roots += 1;
            try std.testing.expect(!invocation.language);
            try std.testing.expect(invocation.normal);
        }
        const abi = common.abis[@intFromEnum(function.abi)];
        const ordinal = abi.receiver_frame orelse return error.TestExpectedConstructorReceiver;
        const construction = abi.construction orelse return error.TestExpectedConstruction;
        try std.testing.expectEqual(abi.physical_parameters.len, invocation.arguments.len);
        try std.testing.expect(ordinal < abi.physical_parameters.len);
        try std.testing.expect(abi.physical_parameters[ordinal] == .receiver);
        try std.testing.expectEqual(@as(u32, @intFromEnum(construction)), @intFromEnum(abi.physical_parameters[ordinal].receiver));
        const receiver = invocation.arguments[ordinal].view();
        try std.testing.expect(!receiver.unknown and !receiver.callable_unknown);
        try std.testing.expectEqual(@as(usize, 1), receiver.frames.len);
        try std.testing.expectEqual(@as(usize, 0), receiver.cursors.len);
        try std.testing.expectEqual(@as(usize, 0), receiver.objects.len);
        try std.testing.expectEqual(@as(usize, 0), receiver.tags.len);
        try std.testing.expectEqual(@as(usize, 0), receiver.callables.len);
        try std.testing.expectEqual(@as(usize, 0), receiver.region.roots.len);
        const frame_id = receiver.frames[0];
        const frame = actual.frames.items[@intFromEnum(frame_id)];
        try std.testing.expectEqual(construction, frame.construction);
        try std.testing.expectEqual(invocation_index, @as(usize, @intFromEnum(frame.site.context)));
        try std.testing.expectEqual(invocation.function, frame.site.location.function);
        const entry = invocation.entry_frames.entries.get(frame_id) orelse return error.TestExpectedEntryFrame;
        try std.testing.expect(entry.unbound and entry.bound.view().bottom());
        try std.testing.expect(!entry.unresolved and !entry.initializing and !entry.aborted);
        try std.testing.expectEqual(@as(u16, 0), entry.prefix_min);
        try std.testing.expectEqual(@as(u16, 0), entry.prefix_max);
        // The dynamic construction target must be the body's owner or a real
        // descendant in the typed nominal directory, never an invented ID.
        const owner = common.members.constructions[@intFromEnum(construction)].owner;
        var selected: ?model.types.TypeRef = frame.new_target;
        var compatible = false;
        var traversed: usize = 0;
        while (selected != null and traversed < common.types.len) : (traversed += 1) {
            if (selected.? == owner) { compatible = true; break; }
            selected = common.types[@intFromEnum(selected.?)].base;
        }
        try std.testing.expect(compatible);
        for (invocation.arguments, 0..) |argument, i| {
            if (i == ordinal) continue;
            ordinary_inputs += 1;
            try std.testing.expect(argument.unknown and argument.callable_unknown);
            try std.testing.expectEqual(@as(usize, 0), argument.frames.items.len);
            try std.testing.expectEqual(@as(usize, 0), argument.cursors.items.len);
        }
    }
    try std.testing.expect(constructor_roots > 0);
    try std.testing.expect(ordinary_inputs > 0);
    try std.testing.expect(no_throw_constructor_roots > 0);
    try std.testing.expect(actual.owner == &c and actual.final_replay_complete);
    try std.testing.expect(c.remaining > 0 and c.remaining < after_decode);
}
