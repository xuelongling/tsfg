// SPDX-License-Identifier: MIT
// Managed ownership components only. No instruction dispatch or VM entry runs.
const std = @import("std");
const values = @import("string-value.zig");
const Roots = @import("string-frame.zig").Roots;
const arguments = @import("string-arguments.zig");
const heap_testing = @import("managed-heap.zig").testing;
const a = std.testing.allocator;

test "parallel String roots retain aliases before overwriting destinations" {
    const owner = try values.Owner.create(a);
    defer owner.release();
    var roots = try Roots.init(a, owner, 3, 3);
    defer roots.deinit(a);
    roots.install(0, try owner.heap.createString(&.{0xd800}, .persistent));
    roots.install(1, try owner.heap.createString(&.{0xdc00}, .persistent));
    const parameters = [_]@import("bytecode_model.zig").Parameter{
        .{ .register = 0, .type_code = 14 }, .{ .register = 1, .type_code = 14 }, .{ .register = 2, .type_code = 14 },
    };
    try roots.branch(&.{ 1, 0, 1 }, &parameters);
    try owner.heap.collect();
    try std.testing.expectEqual(@as(u16, 0xdc00), try owner.heap.readStringCodeUnit(roots.registers[0].?, 0));
    try std.testing.expectEqual(@as(u16, 0xd800), try owner.heap.readStringCodeUnit(roots.registers[1].?, 0));
    try std.testing.expect(try owner.heap.sameObject(roots.registers[0].?, roots.registers[2].?));
}

test "returned String remains valid after activation and instance owners release" {
    const owner = try values.Owner.create(a);
    var roots = try Roots.init(a, owner, 1, 0);
    roots.install(0, try owner.heap.createString(&.{ 0x41, 0xd83d, 0xde00 }, .persistent));
    var result = try values.String.retain(owner, roots.registers[0].?);
    defer result.deinit();
    roots.deinit(a);
    owner.release();
    try result.owner.heap.collect();
    try std.testing.expectEqual(@as(usize, 3), try result.owner.heap.stringLength(result.handle));
    try std.testing.expectEqual(@as(u16, 0xde00), try result.owner.heap.readStringCodeUnit(result.handle, 2));
}

test "cross-instance arguments preserve code units with independent ownership" {
    const first = try values.Owner.create(a);
    const second = try values.Owner.create(a);
    defer second.release();
    const handle = try first.heap.createString(&.{ 0, 0xdc00 }, .persistent);
    var argument = try values.String.retain(first, handle);
    try first.heap.release(handle);
    first.release();
    second.budget.limit = 0;
    try std.testing.expectError(error.OutOfMemory, argument.import(second));
    try argument.owner.heap.collect();
    try std.testing.expectEqual(@as(u16, 0xdc00), try argument.owner.heap.readStringCodeUnit(argument.handle, 1));
    second.budget.limit = std.math.maxInt(usize);
    const copied = try argument.import(second);
    defer second.heap.release(copied) catch unreachable;
    argument.deinit();
    try second.heap.collect();
    try std.testing.expectEqual(@as(u16, 0xdc00), try second.heap.readStringCodeUnit(copied, 1));
}

test "UTF16 argument takes its only free root after allocation failures" {
    const fixture = try std.json.parseFromSlice(std.json.Value, a, "[0,56320]", .{});
    defer fixture.deinit();
    var failures: usize = 0;
    for (0..32) |offset| {
        var failing = std.testing.FailingAllocator.init(a, .{});
        const owner = try values.Owner.create(failing.allocator());
        defer owner.release();
        var owner_slot: ?*values.Owner = owner;
        const existing = try owner.heap.createString(&.{0x41}, .persistent);
        defer owner.heap.release(existing) catch unreachable;
        var aliases: std.ArrayList(values.Handle) = .empty;
        defer aliases.deinit(a);
        defer for (aliases.items) |alias| owner.heap.release(alias) catch unreachable;
        while (true) {
            const roots = try heap_testing.rootStats(&owner.heap);
            if (roots.count == roots.capacity) break;
            try aliases.append(a, try owner.heap.retain(existing, .persistent));
        }
        const vacant = aliases.pop() orelse return error.NoSpareRootSlot;
        try owner.heap.release(vacant);
        owner.budget.limit = 65536;
        const before = try heap_testing.rootStats(&owner.heap);
        const used = owner.budget.used;
        failing.fail_index = failing.alloc_index + offset;
        const attempt = arguments.read(failing.allocator(), &owner_slot, fixture.value, 65536);
        failing.fail_index = std.math.maxInt(usize);
        try std.testing.expectEqual(owner, owner_slot.?);
        if (attempt) |owned| {
            {
                var argument = owned;
                defer argument.deinit();
                try std.testing.expect(failures > 0);
                try std.testing.expectEqual(before.count, (try heap_testing.rootStats(&owner.heap)).count);
                try std.testing.expectEqual(vacant.slot, argument.handle.slot);
                try std.testing.expectEqual(@as(usize, 2), owner.references);
                try owner.heap.collect();
                var units: [2]u16 = undefined;
                try std.testing.expectEqual(@as(usize, 2), try owner.heap.copyStringCodeUnits(argument.handle, &units));
                try std.testing.expectEqualSlices(u16, &.{ 0, 0xdc00 }, &units);
            }
            try owner.heap.collect();
            try std.testing.expectEqual(@as(usize, 1), try owner.heap.objectCount());
            try std.testing.expectEqual(@as(usize, 1), owner.references);
            return;
        } else |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            failures += 1;
            try std.testing.expectEqual(@as(usize, 1), try owner.heap.objectCount());
            try std.testing.expectEqual(before.count, (try heap_testing.rootStats(&owner.heap)).count);
            try std.testing.expectEqual(@as(usize, 1), owner.references);
            try std.testing.expectEqual(used, owner.budget.used);
            try std.testing.expectEqual(@as(u16, 0x41), try owner.heap.readStringCodeUnit(existing, 0));
        }
    }
    return error.StringArgumentDidNotSucceed;
}

test "invalid UTF16 argument preserves the owner slot and prior limit" {
    const fixture = try std.json.parseFromSlice(std.json.Value, a, "[65536]", .{});
    defer fixture.deinit();
    var slot: ?*values.Owner = null;
    defer if (slot) |owner| owner.release();
    try std.testing.expectError(error.InvalidStringArgument, arguments.read(a, &slot, fixture.value, 65536));
    try std.testing.expect(slot == null);
    const existing = try values.Owner.create(a);
    defer existing.release();
    var reused: ?*values.Owner = existing;
    try std.testing.expectError(error.InvalidStringArgument, arguments.read(a, &reused, fixture.value, 65536));
    try std.testing.expectEqual(existing, reused.?);
    try std.testing.expectEqual(std.math.maxInt(usize), existing.budget.limit);
    try std.testing.expectEqual(@as(usize, 1), existing.references);
    try std.testing.expectEqual(@as(usize, 0), existing.budget.used);
}

test "request heap budget includes collector temporaries and failed collection preserves roots" {
    const owner = try values.Owner.create(a);
    defer owner.release();
    const handle = try owner.heap.createString(&.{ 0x41, 0xd800 }, .persistent);
    defer owner.heap.release(handle) catch unreachable;
    owner.budget.limit = owner.budget.used;
    try std.testing.expectError(error.OutOfMemory, owner.heap.collect());
    try std.testing.expectEqual(@as(u16, 0xd800), try owner.heap.readStringCodeUnit(handle, 1));
    try std.testing.expectError(error.OutOfMemory, owner.heap.createString(&.{0x42}, .persistent));
    owner.budget.limit = std.math.maxInt(usize);
    try owner.heap.collect();
    try std.testing.expectEqual(@as(u16, 0x41), try owner.heap.readStringCodeUnit(handle, 0));
}

test "independent UTF16 order and cut-pair rejoin remain lossless under the owned heap" {
    const owner = try values.Owner.create(a);
    defer owner.release();
    const pair = try owner.heap.createString(&.{ 0xd83d, 0xde00 }, .persistent);
    const bmp = try owner.heap.createString(&.{0xe000}, .persistent);
    const decomposed = try owner.heap.createString(&.{ 0x61, 0x301 }, .persistent);
    const precomposed = try owner.heap.createString(&.{0xe1}, .persistent);
    defer for ([_]values.Handle{ pair, bmp, decomposed, precomposed }) |root| owner.heap.release(root) catch unreachable;
    try std.testing.expectEqual(std.math.Order.lt, try owner.heap.compareStrings(pair, bmp));
    try std.testing.expectEqual(std.math.Order.lt, try owner.heap.compareStrings(decomposed, precomposed));
    const high = try owner.heap.sliceString(pair, 0, 1, .persistent);
    const low = try owner.heap.sliceString(pair, 1, 2, .persistent);
    defer owner.heap.release(high) catch unreachable;
    defer owner.heap.release(low) catch unreachable;
    try std.testing.expectEqual(@as(u16, 0xd83d), try owner.heap.readStringCodeUnit(high, 0));
    try std.testing.expectEqual(@as(u16, 0xde00), try owner.heap.readStringCodeUnit(low, 0));
    const joined = try owner.heap.concatStrings(high, low, .persistent);
    defer owner.heap.release(joined) catch unreachable;
    try owner.heap.collect();
    try std.testing.expectEqual(std.math.Order.eq, try owner.heap.compareStrings(pair, joined));
    var bytes: [4]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 4), try owner.heap.copyStringBytes(joined, &bytes));
    try std.testing.expectEqualSlices(u8, &.{ 0xf0, 0x9f, 0x98, 0x80 }, &bytes);
}
