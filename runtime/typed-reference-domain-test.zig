// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const domains = @import("typed-reference-domains.zig");
const storage = @import("managed-reference-domain.zig");
const access = @import("managed-reference-view.zig");
const allocator = std.testing.allocator;
const root = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-reference-domain-captures/";
fn load(name: []const u8) !domains.Module {
    const file = try std.mem.concat(allocator, u8, &.{ root, name, ".bin" }); defer allocator.free(file);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, allocator, .limited(2097152)); defer allocator.free(bytes);
    return domains.load(allocator, bytes);
}
fn cells(module: domains.Module) !struct { base: managed.CellLayout, derived: managed.CellLayout, narrow: domains.Id, wide: domains.Id } {
    for (module.views.layouts.entries) |entry| if (entry.base) |base_id| {
        var narrow: ?domains.Id = null; var wide: ?domains.Id = null;
        for (module.arrays) |plan| {
            if (std.mem.eql(u8, &plan.element_type, &entry.type_id)) narrow = plan.type_id;
            if (std.mem.eql(u8, &plan.element_type, &base_id)) wide = plan.type_id;
        }
        return .{ .base = (try module.views.layouts.find(base_id)).cell.?, .derived = entry.cell.?, .narrow = narrow.?, .wide = wide.? };
    };
    return error.MissingDerived;
}
fn initialize(heap: *managed.ManagedHeap, handle: managed.Handle, layout: managed.CellLayout, value: u32) !void {
    var bytes: [4]u8 = undefined; std.mem.writeInt(u32, &bytes, value, .little);
    for (layout.fields) |field| try heap.writeTypedField(handle, layout, field.id, .{ .bytes = &bytes, .references = &.{} }, true);
}
test "actual owned array plans preserve replacement identity through narrower alias parameter return and moving collection" {
    for ([_][]const u8{ "direct", "parameter-return" }) |name| {
        var module = try load(name); defer module.deinit(); const types = try cells(module);
        var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.views.layouts);
        const derived = try heap.createTypedCell(types.derived, .persistent); try initialize(&heap, derived, types.derived, 2);
        const replacement = try heap.createTypedCell(types.base, .persistent); try initialize(&heap, replacement, types.base, 7);
        const narrow = try module.create(&heap, types.narrow, &.{try module.cell(&heap, derived)}, .persistent);
        const wide = try module.alias(&heap, narrow, types.wide, .persistent);
        // The same operation supplies a parameter or returned Array carrier:
        // it retains the original heap identity, never copies its elements.
        const returned = try module.alias(&heap, wide, types.wide, .persistent);
        try std.testing.expect(try heap.sameObject(narrow.handle, returned.handle));
        try module.store(&heap, returned, 0, try module.cell(&heap, replacement));
        const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
        const observed = try module.assign(try module.read(&heap, narrow, 0, .temporary), types.base.type_id);
        try std.testing.expect(try heap.sameObject(observed.actual.cell, replacement));
        try heap.release(derived); try heap.release(replacement); try heap.collect();
        const actual = try heap.copyTypedCellLayout(observed.actual.cell); defer actual.deinit(allocator);
        try std.testing.expectEqualSlices(u8, &types.base.type_id, &actual.type_id);
        try std.testing.expectEqualSlices(u8, &types.base.runtime_key, &actual.runtime_key);
        var value = try access.read(&heap, module.views, observed.actual.cell, types.base.type_id, types.base.fields[0].id, .temporary); defer value.deinit(allocator);
        try std.testing.expectEqualSlices(u8, &.{ 7, 0, 0, 0 }, value.value.bytes);
        try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
        const returned_value = try module.retain(&heap, observed, .persistent);
        try heap.release(narrow.handle); try heap.release(wide.handle); try heap.release(returned.handle);
        try heap.collect();
        try std.testing.expectEqual(@as(usize, 1), try heap.objectCount());
        const returned_identity = try heap.copyTypedCellLayout(returned_value.actual.cell); defer returned_identity.deinit(allocator);
        try std.testing.expectEqualSlices(u8, &types.base.runtime_key, &returned_identity.runtime_key);
    }
}
test "reference storage discriminants preserve null undefined and actual cells while gap growth and OOM stay transactional" {
    var module = try load("direct"); defer module.deinit(); const types = try cells(module);
    var failures: usize = 0;
    for (0..64) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.views.layouts);
        const object = try heap.createTypedCell(types.base, .persistent);
        const array = try storage.create(&heap, &.{ .null_value, .undefined_value, .{ .cell = object } }, .persistent);
        try std.testing.expectEqual(storage.Value.null_value, try storage.read(&heap, array, 0, .persistent));
        try std.testing.expectEqual(storage.Value.undefined_value, try storage.read(&heap, array, 1, .persistent));
        try std.testing.expectError(error.IndexOutOfBounds, storage.store(&heap, array, 4, .null_value));
        try std.testing.expectError(error.UninitializedGrowth, storage.resize(&heap, array, 4));
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        storage.store(&heap, array, 3, .{ .cell = object }) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try std.testing.expectEqual(@as(u32, 3), try heap.typedArrayLength(array, storage.layout));
            try heap.collect(); continue;
        };
        failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
        try std.testing.expectEqual(@as(u32, 4), try heap.typedArrayLength(array, storage.layout));
        try storage.resize(&heap, array, 2); try heap.release(object); try heap.collect();
        try std.testing.expectEqual(@as(usize, 1), try heap.objectCount()); break;
    } else return error.NoSuccessfulAppend;
    try std.testing.expect(failures > 0); std.debug.print("reference-domain append {d} real OOM points then commit\n", .{failures});
}
test "pure reference assertion retains undefined and actual runtime identity rather than retagging the static target" {
    var module = try load("presence"); defer module.deinit(); const plan = module.arrays[0];
    const view = module.views.views[0]; const actual_cell = (try module.views.layouts.find(view.actual)).cell.?;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.views.layouts);
    const array = try module.create(&heap, plan.type_id, &.{.{ .actual = .undefined_value, .view_type = plan.element_type }}, .persistent);
    const absent = try module.assertView(try module.read(&heap, array, 0, .persistent), view.target);
    try std.testing.expectEqual(storage.Value.undefined_value, absent.actual);
    try std.testing.expectEqualSlices(u8, &view.target, &absent.view_type);
    const object = try heap.createTypedCell(actual_cell, .persistent);
    try module.store(&heap, array, 0, try module.cell(&heap, object));
    const converted = try module.assertView(try module.read(&heap, array, 0, .persistent), view.target);
    try std.testing.expect(try heap.sameObject(object, converted.actual.cell));
    const identity = try heap.copyTypedCellLayout(converted.actual.cell); defer identity.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &actual_cell.runtime_key, &identity.runtime_key);
}
test "reference-domain publication and decoding release partial allocations and reject invalid owner or nonreference payload" {
    var module = try load("direct"); defer module.deinit(); const types = try cells(module);
    var failures: usize = 0;
    for (0..128) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.views.layouts);
        const object = try heap.createTypedCell(types.derived, .persistent);
        const value = try module.cell(&heap, object);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        _ = module.create(&heap, types.narrow, &.{value}, .persistent) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try heap.collect(); try std.testing.expectEqual(@as(usize, 1), try heap.objectCount()); continue;
        };
        break;
    } else return error.NoSuccessfulCreate;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    const array = try storage.create(&heap, &.{.undefined_value}, .persistent);
    const scalar = try heap.create(42, 7, 0, .persistent);
    try std.testing.expectError(error.TypeMismatch, storage.store(&heap, array, 0, .{ .cell = scalar }));
    var other = managed.ManagedHeap.init(allocator); defer other.deinit() catch unreachable;
    const foreign = try other.createTypedCell(types.base, .persistent);
    try std.testing.expectError(error.InvalidHandle, storage.store(&heap, array, 0, .{ .cell = foreign }));
    try std.testing.expectEqual(storage.Value.undefined_value, try storage.read(&heap, array, 0, .persistent));
    const file = try std.mem.concat(allocator, u8, &.{ root, "direct.bin" }); defer allocator.free(file);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, allocator, .limited(2097152)); defer allocator.free(bytes);
    var decode_failures: usize = 0;
    for (0..64) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = offset });
        var decoded = domains.load(failing.allocator(), bytes) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); decode_failures += 1; continue;
        };
        decoded.deinit(); break;
    } else return error.NoSuccessfulDecode;
    try std.testing.expectError(error.InvalidReferenceDomain, domains.load(allocator, bytes[0 .. bytes.len - 1]));
    const forged = try allocator.dupe(u8, bytes); defer allocator.free(forged);
    var scalar_id: ?domains.Id = null;
    for (module.views.layouts.entries) |entry| if (std.mem.eql(u8, entry.name, "i32")) { scalar_id = entry.type_id; break; };
    @memcpy(forged[forged.len - 32 ..], &scalar_id.?);
    try std.testing.expectError(error.InvalidReferenceDomain, domains.load(allocator, forged));
    try std.testing.expect(decode_failures > 0);
    std.debug.print("reference-domain create {d} real OOM points then publication\n", .{failures});
    std.debug.print("reference-domain decode {d} real OOM points then success\n", .{decode_failures});
}
test "whole-array pure assertion preserves actual absence across returned aliases and later storage" {
    var module = try load("whole-presence"); defer module.deinit();
    var narrow: ?domains.Id = null; var wide: ?domains.Id = null;
    for (module.arrays) |plan| {
        const count = (try module.views.layouts.find(plan.element_type)).layout.variants.len;
        if (count == 3) narrow = plan.type_id else if (count == 1) wide = plan.type_id;
    }
    var element_type: ?domains.Id = null;
    for (module.arrays) |plan| if (std.mem.eql(u8, &plan.type_id, &narrow.?)) { element_type = plan.element_type; break; };
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.views.layouts);
    const array = try module.create(&heap, narrow.?, &.{.{ .actual = .undefined_value, .view_type = element_type.? }}, .persistent);
    try std.testing.expectError(error.MissingView, module.alias(&heap, array, wide.?, .persistent));
    const asserted = try module.assertArray(&heap, array, wide.?, .persistent);
    const returned = try module.alias(&heap, asserted, wide.?, .persistent);
    try std.testing.expect(try heap.sameObject(array.handle, returned.handle));
    const value = try module.read(&heap, returned, 0, .persistent);
    try std.testing.expectEqual(storage.Value.undefined_value, value.actual);
    try module.store(&heap, returned, 1, value); try heap.collect();
    try std.testing.expectEqual(storage.Value.undefined_value, (try module.read(&heap, array, 1, .persistent)).actual);
    try std.testing.expectError(error.IndexOutOfBounds, module.read(&heap, array, 2, .persistent));
}
test "Source readonly permits actual Frozen field writes only through its verified writable static member view" {
    var module = try load("readonly"); defer module.deinit(); const view = module.views.views[0];
    const actual = (try module.views.layouts.find(view.actual)).cell.?;
    const target = (try module.views.layouts.find(view.target)).cell.?;
    try std.testing.expect(actual.fields[0].readonly); try std.testing.expect(!target.fields[0].readonly);
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.views.layouts);
    const object = try heap.createTypedCell(actual, .persistent); try initialize(&heap, object, actual, 1);
    var value = try access.read(&heap, module.views, object, target.type_id, target.fields[0].id, .persistent); defer value.deinit(allocator);
    value.value.bytes[0] = 7;
    // The strict physical API is not the Source static permission boundary.
    try std.testing.expectError(error.ReadonlyField, heap.writeTypedField(object, actual, actual.fields[0].id,
        .{ .bytes = value.value.bytes, .references = &.{} }, false));
    try access.write(&heap, module.views, object, target.type_id, target.fields[0].id, value);
    var observed = try access.read(&heap, module.views, object, actual.type_id, actual.fields[0].id, .persistent); defer observed.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 7, 0, 0, 0 }, observed.value.bytes);
    try std.testing.expectError(error.ReadonlyField, access.write(&heap, module.views, object, actual.type_id, actual.fields[0].id, value));
    const identity = try heap.copyTypedCellLayout(object); defer identity.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &actual.runtime_key, &identity.runtime_key);
}
test "invalid static array plan fails before publishing a persistent element root" {
    var module = try load("direct"); defer module.deinit(); const types = try cells(module);
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.views.layouts);
    const object = try heap.createTypedCell(types.base, .persistent);
    const array = try module.create(&heap, types.wide, &.{try module.cell(&heap, object)}, .persistent);
    var invalid = array; invalid.type_id = .{0} ** 32;
    try std.testing.expectError(error.InvalidReferenceDomain, module.read(&heap, invalid, 0, .persistent));
    try heap.release(object); try heap.release(array.handle); try heap.collect();
    try std.testing.expectEqual(@as(usize, 0), try heap.objectCount());
}
