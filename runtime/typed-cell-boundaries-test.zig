// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const cells = @import("managed-cell.zig");
const element = @import("array-element.zig");
const Heap = managed.ManagedHeap;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const allocator = std.testing.allocator;
const scalar: element.Layout = .{ .type_id = .{10} ** 32, .byte_size = 4, .alignment = 4, .reference_count = 0,
    .variants = &.{.{ .tag = 0, .fields = &.{.{ .offset = 0, .code = 1 }} }} };
const object: cells.Layout = .{ .type_id = .{11} ** 32, .runtime_key = .{12} ** 32, .kind = .reference, .byte_size = 4,
    .alignment = 4, .reference_count = 0, .fields = &.{.{ .id = .{13} ** 32, .layout = scalar, .offset = 0, .reference_offset = 0 }} };
const reference: element.Layout = .{ .type_id = object.type_id, .byte_size = 0, .alignment = 1, .reference_count = 1,
    .variants = &.{.{ .tag = 0, .references = &.{.{ .slot = 0, .type = .{ .cell = object.type_id } }} }} };
const maybe: element.Layout = .{ .type_id = .{14} ** 32, .byte_size = 2, .alignment = 2, .reference_count = 1,
    .variants = &.{ .{ .tag = 0, .kind = .undefined_value }, .{ .tag = 1, .children = &.{.{ .tag_offset = 0, .offset = 2,
        .reference_offset = 0, .layout = &reference }} } } };
const pair: element.Layout = .{ .type_id = .{15} ** 32, .byte_size = 4, .alignment = 2, .reference_count = 1,
    .variants = &.{.{ .tag = 0, .children = &.{.{ .tag_offset = 0, .offset = 2, .reference_offset = 0, .layout = &maybe }} }} };
const holder: cells.Layout = .{ .type_id = .{16} ** 32, .runtime_key = .{17} ** 32, .kind = .value, .byte_size = 4,
    .alignment = 2, .reference_count = 1, .fields = &.{.{ .id = .{18} ** 32, .layout = pair, .offset = 0, .reference_offset = 0 }} };

test "nested value union retains only active roots and copies bits without sharing values" {
    var heap = Heap.init(allocator); defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope(); const child = try heap.createTypedCell(object, .temporary);
    try heap.writeTypedField(child, object, object.fields[0].id, .{ .bytes = &.{ 7, 0, 0, 0 }, .references = &.{} }, true);
    const owner = try heap.createTypedArray(pair, &.{.{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{child} }}, .persistent);
    const value_cell = try heap.createTypedCell(holder, .persistent);
    try heap.writeTypedField(value_cell, holder, holder.fields[0].id, .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{child} }, true);
    try heap.endScope(scope); try heap.collect();
    const read_scope = try heap.beginScope();
    var copy = try heap.readTypedArray(owner, pair, 0, .temporary); defer copy.deinit(allocator);
    try heap.storeTypedArray(owner, pair, 0, .{ .bytes = &.{ 0, 0, 255, 255 }, .references = &.{child} });
    var empty = try heap.readTypedArray(owner, pair, 0, .temporary); defer empty.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 0 }, empty.bytes); try expect(empty.references[0] == null);
    try std.testing.expectEqualSlices(u8, &.{ 1, 0, 0, 0 }, copy.bytes);
    try heap.writeTypedField(value_cell, holder, holder.fields[0].id, .{ .bytes = &.{ 0, 0, 255, 255 }, .references = &.{child} }, false);
    try heap.collect(); try equal(@as(usize, 3), try heap.objectCount());
    var number = try heap.readTypedField(copy.references[0].?, object, object.fields[0].id, .temporary); defer number.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 7, 0, 0, 0 }, number.bytes);
    try heap.endScope(read_scope); try heap.collect(); try equal(@as(usize, 2), try heap.objectCount());
    try std.testing.expectError(error.InvalidArrayElement, heap.storeTypedArray(owner, pair, 0, .{ .bytes = &.{ 2, 0, 0, 0 }, .references = &.{null} }));
}

test "cell initialization bits readonly fields foreign roots and full type identity are checked" {
    var heap = Heap.init(allocator); defer heap.deinit() catch unreachable;
    var other = Heap.init(allocator); defer other.deinit() catch unreachable;
    const foreign = try other.createTypedCell(object, .persistent);
    const value = try heap.createTypedCell(holder, .persistent);
    try std.testing.expectError(error.UninitializedField, heap.writeTypedField(value, holder, holder.fields[0].id,
        .{ .bytes = &.{ 0, 0, 0, 0 }, .references = &.{null} }, false));
    try std.testing.expectError(error.InvalidHandle, heap.writeTypedField(value, holder, holder.fields[0].id,
        .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{foreign} }, true));
    try expect(!try heap.hasTypedField(value, holder, holder.fields[0].id));
    var readonly = object; readonly.type_id[31] ^= 1;
    var fields = [_]cells.Field{object.fields[0]}; fields[0].readonly = true; readonly.fields = &fields;
    const constant = try heap.createTypedCell(readonly, .persistent);
    try heap.writeTypedField(constant, readonly, fields[0].id, .{ .bytes = &.{ 3, 0, 0, 0 }, .references = &.{} }, true);
    try std.testing.expectError(error.ReadonlyField, heap.writeTypedField(constant, readonly, fields[0].id,
        .{ .bytes = &.{ 4, 0, 0, 0 }, .references = &.{} }, false));
    try std.testing.expectError(error.TypeMismatch, heap.readTypedField(constant, object, fields[0].id, .persistent));
}

test "fixed value cells pack into Arrays and reconstruct independent initialized copies" {
    var heap = Heap.init(allocator); defer heap.deinit() catch unreachable;
    const value_layout = try holder.elementLayout(allocator); defer value_layout.deinit(allocator);
    const scope = try heap.beginScope();
    const child = try heap.createTypedCell(object, .temporary);
    const original = try heap.createTypedCell(holder, .temporary);
    try std.testing.expectError(error.UninitializedField, heap.readTypedValue(original, holder, value_layout, .temporary));
    try heap.writeTypedField(original, holder, holder.fields[0].id, .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{child} }, true);
    var value = try heap.readTypedValue(original, holder, value_layout, .temporary); defer value.deinit(allocator);
    const array = try heap.createTypedArray(value_layout, &.{.{ .bytes = value.bytes, .references = value.references }}, .persistent);
    var read_back = try heap.readTypedArray(array, value_layout, 0, .temporary); defer read_back.deinit(allocator);
    const copy = try heap.createTypedValue(holder, value_layout, .{ .bytes = read_back.bytes, .references = read_back.references }, .persistent);
    try expect(!try heap.sameObject(original, copy));
    try heap.writeTypedField(original, holder, holder.fields[0].id, .{ .bytes = &.{ 0, 0, 0, 0 }, .references = &.{null} }, false);
    var unchanged = try heap.readTypedField(copy, holder, holder.fields[0].id, .temporary); defer unchanged.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 1, 0, 0, 0 }, unchanged.bytes);
    try heap.endScope(scope); try heap.collect(); try equal(@as(usize, 3), try heap.objectCount());
    try heap.resizeTypedArray(array, value_layout, 0);
    try heap.writeTypedField(copy, holder, holder.fields[0].id, .{ .bytes = &.{ 0, 0, 0, 0 }, .references = &.{null} }, false);
    try heap.collect(); try equal(@as(usize, 2), try heap.objectCount());
}

const Operation = enum { create, initialize, overwrite, read, value_create, value_read, collect };
fn failures(operation: Operation) !void {
    var count: usize = 0;
    for (0..512) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{}); var heap = Heap.init(failing.allocator());
        defer heap.deinit() catch unreachable;
        const child = try heap.createTypedCell(object, .persistent);
        const owner = try heap.createTypedCell(holder, .persistent);
        const initialized = operation != .initialize;
        if (initialized) try heap.writeTypedField(owner, holder, holder.fields[0].id,
            .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{child} }, true);
        const scope = try heap.beginScope();
        const value_layout = try holder.elementLayout(heap.allocator); defer value_layout.deinit(heap.allocator);
        var copied_input: ?managed.ArrayValue = null;
        if (operation == .value_create) copied_input = try heap.readTypedValue(owner, holder, value_layout, .temporary);
        defer if (copied_input) |*value| value.deinit(heap.allocator);
        while (true) {
            const stats = try managed.testing.rootStats(&heap); if (stats.count == stats.capacity) break;
            _ = try heap.retain(owner, .temporary);
        }
        const roots = (try managed.testing.rootStats(&heap)).count; const objects = try heap.objectCount();
        const identity = heap.next_identity; const location = try managed.testing.location(&heap, owner);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        const result: ?managed.Error = attempt: {
            switch (operation) {
                .create => {
                    var next = holder; next.type_id[31] ^= 1;
                    _ = heap.createTypedCell(next, .persistent) catch |err| break :attempt err;
                },
                .initialize, .overwrite => heap.writeTypedField(owner, holder, holder.fields[0].id,
                    .{ .bytes = &.{ 0, 0, 99, 98 }, .references = &.{null} }, !initialized) catch |err| break :attempt err,
                .read => { var read_value = heap.readTypedField(owner, holder, holder.fields[0].id, .temporary) catch |err| break :attempt err; read_value.deinit(heap.allocator); },
                .value_create => { _ = heap.createTypedValue(holder, value_layout, .{ .bytes = copied_input.?.bytes, .references = copied_input.?.references }, .persistent) catch |err| break :attempt err; },
                .value_read => { var value = heap.readTypedValue(owner, holder, value_layout, .temporary) catch |err| break :attempt err; value.deinit(heap.allocator); },
                .collect => heap.collect() catch |err| break :attempt err,
            }
            break :attempt null;
        };
        failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
        if (result) |err| {
            try equal(error.OutOfMemory, err); count += 1;
            try equal(roots, (try managed.testing.rootStats(&heap)).count); try equal(objects, try heap.objectCount());
            try equal(identity, heap.next_identity); try equal(location, try managed.testing.location(&heap, owner));
            try equal(initialized, try heap.hasTypedField(owner, holder, holder.fields[0].id));
            if (initialized) {
                var value = try heap.readTypedField(owner, holder, holder.fields[0].id, .temporary); defer value.deinit(heap.allocator);
                try std.testing.expectEqualSlices(u8, &.{ 1, 0, 0, 0 }, value.bytes); try expect(try heap.sameObject(child, value.references[0].?));
            }
        }
        try heap.endScope(scope); try heap.collect();
        if (result == null) { try expect(count > 0); std.debug.print("typed cell {s}: {d} real OOM points then success\n", .{ @tagName(operation), count }); return; }
    }
    return error.NoSuccessfulAttempt;
}
test "typed cell planes bits roots catalogue and collection survive every allocation failure" {
    inline for (std.meta.tags(Operation)) |operation| try failures(operation);
}
