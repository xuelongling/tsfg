// SPDX-License-Identifier: MIT
const std = @import("std");
const backing = @import("typed-array-backing.zig");
const codec = @import("typed-backing-value.zig");
const managed = @import("managed-heap.zig");
const allocator = std.testing.allocator;
fn load(name: []const u8) !backing.Module {
    const file = try std.fmt.allocPrint(allocator, "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/array-backing-captures/{s}.bin", .{name}); defer allocator.free(file);
    const bytes = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, allocator, .limited(2097152)); defer allocator.free(bytes);
    return backing.load(allocator, bytes);
}
fn absent(module: backing.Module, row: backing.Array) ![32]u8 {
    for (row.domain.members) |id| if ((try module.authority.layouts.find(id)).layout.variants[0].kind == .undefined_value) return id;
    unreachable;
}
test "reference snapshot roots survive overwrite shrink release source and moving collection" {
    var module = try load("reference"); defer module.deinit(); const row = module.arrays[0];
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    var id: ?[32]u8 = null;
    for (row.domain.members) |member| if ((try module.authority.layouts.find(member)).cell != null) { id = member; break; };
    const layout = (try module.authority.layouts.find(id.?)).cell.?;
    const child = try heap.createTypedCell(layout, .temporary);
    const object = try module.create(&heap, row.type_id, &.{.{ .type_id = id.?, .input = .{ .bytes = &.{}, .references = &.{child} } }}, .persistent);
    const captured = try module.capture(&heap, object, row.type_id, 0);
    try heap.release(child);
    try module.write(&heap, object, row.type_id, 0, .{ .type_id = try absent(module, row), .input = .{ .bytes = &.{}, .references = &.{} } });
    try module.resize(&heap, object, row.type_id, 0); try heap.collect();
    try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
    try module.copy(&heap, object, row.type_id, 0, captured);
    var result = try module.read(&heap, object, row.type_id, 0, .temporary); defer result.deinit(allocator);
    const active = try codec.unpack(&heap, row.domain, result.value);
    const header = try heap.copyTypedCellLayout(active.input.references[0].?); defer header.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &layout.type_id, &header.type_id);
    try std.testing.expectEqualSlices(u8, &layout.runtime_key, &header.runtime_key);
    try module.release(captured);
    for (result.value.references) |reference| if (reference) |handle| try heap.release(handle);
    try module.resize(&heap, object, row.type_id, 0); try heap.collect();
    try std.testing.expectEqual(@as(usize, 1), try heap.objectCount());
    try heap.release(object); try heap.collect(); try std.testing.expectEqual(@as(usize, 0), try heap.objectCount());
}
test "canonical value variants and native numeric variants encode and copy without retagging" {
    for ([_][]const u8{ "value", "scalar" }) |name| {
        var module = try load(name); defer module.deinit(); const row = module.arrays[0];
        var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.authority.layouts);
        const object = try module.create(&heap, row.type_id, &.{}, .persistent);
        for (row.domain.members) |id| {
            const concrete = (try module.authority.layouts.find(id)).layout;
            const bytes = try allocator.alloc(u8, concrete.byte_size); defer allocator.free(bytes); @memset(bytes, 0);
            const refs = try allocator.alloc(?managed.Handle, concrete.reference_count); defer allocator.free(refs); @memset(refs, null);
            try module.write(&heap, object, row.type_id, 0, .{ .type_id = id, .input = .{ .bytes = bytes, .references = refs } });
            const snapshot = try module.capture(&heap, object, row.type_id, 0); defer module.release(snapshot) catch unreachable;
            try module.copy(&heap, object, row.type_id, 1, snapshot);
            var read = try module.read(&heap, object, row.type_id, 1, .persistent); defer read.deinit(allocator);
            const active = try codec.unpack(&heap, row.domain, read.value);
            try std.testing.expectEqualSlices(u8, &id, &active.type_id);
            try std.testing.expectEqualSlices(u8, bytes, active.input.bytes);
            try module.resize(&heap, object, row.type_id, 0); try heap.collect();
            try std.testing.expectEqualSlices(u8, &row.type_id, &(try heap.typedArrayIdentity(object)));
        }
    }
}
test "nested backed Array edges preserve original child element identity" {
    var module = try load("nested"); defer module.deinit();
    var inner = module.arrays[0]; var outer = module.arrays[1];
    if (std.mem.eql(u8, &inner.element_type, &outer.type_id)) { const temp = inner; inner = outer; outer = temp; }
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const child = try module.create(&heap, inner.type_id, &.{.{ .type_id = inner.element_type, .input = .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{} } }}, .persistent);
    const object = try module.create(&heap, outer.type_id, &.{.{ .type_id = inner.type_id, .input = .{ .bytes = &.{}, .references = &.{child} } }}, .persistent);
    try heap.release(child); try heap.collect();
    var read = try module.read(&heap, object, outer.type_id, 0, .persistent); defer read.deinit(allocator);
    const active = try codec.unpack(&heap, outer.domain, read.value); const alias = active.input.references[0].?;
    try module.write(&heap, alias, inner.type_id, 1, .{ .type_id = inner.element_type, .input = .{ .bytes = &.{ 2, 0, 0, 0 }, .references = &.{} } });
    try std.testing.expectEqual(@as(u32, 2), try heap.typedArrayLength(alias, inner.domain.layout));
    try std.testing.expectEqualSlices(u8, &inner.type_id, &(try heap.typedArrayIdentity(alias)));
}
test "readonly static access cannot mutate while mutable alias retains string identity" {
    var module = try load("readonly"); defer module.deinit(); const row = module.arrays[0];
    var target: ?[32]u8 = null; var string_id: ?[32]u8 = null;
    for (row.views) |id| if (std.mem.startsWith(u8, (try module.authority.layouts.find(id)).name, "ReadSpan<")) { target = id; };
    for (row.domain.members) |id| if (std.mem.eql(u8, (try module.authority.layouts.find(id)).name, "string")) { string_id = id; };
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const child = try heap.createString(&.{65}, .persistent);
    const literal = backing.Literal{ .type_id = string_id.?, .input = .{ .bytes = &.{}, .references = &.{child} } };
    const object = try module.create(&heap, row.type_id, &.{literal}, .persistent);
    try std.testing.expectError(error.ReadonlyField, module.write(&heap, object, target.?, 0, literal));
    try std.testing.expectError(error.ReadonlyField, module.resize(&heap, object, target.?, 0));
    const captured = try module.capture(&heap, object, target.?, 0); defer module.release(captured) catch unreachable;
    try module.write(&heap, object, row.type_id, 0, .{ .type_id = try absent(module, row), .input = .{ .bytes = &.{}, .references = &.{} } });
    try heap.collect(); try module.copy(&heap, object, row.type_id, 0, captured);
    var result = try module.read(&heap, object, target.?, 0, .persistent); defer result.deinit(allocator);
    const active = try codec.unpack(&heap, row.domain, result.value);
    try std.testing.expect(try heap.sameObject(child, active.input.references[0].?));
}
test "empty Source construction has bottom capacity without invented defined elements" {
    var module = try load("empty"); defer module.deinit();
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    for (module.arrays) |row| {
        if (row.domain.members.len != 0) continue;
        const object = try module.create(&heap, row.type_id, &.{}, .persistent);
        try std.testing.expectEqual(@as(u32, 0), try heap.typedArrayLength(object, row.domain.layout));
        try std.testing.expectError(error.IndexOutOfBounds, module.read(&heap, object, row.type_id, 0, .persistent));
        try std.testing.expectError(error.UninitializedGrowth, module.resize(&heap, object, row.type_id, 1));
        try heap.collect(); try std.testing.expectEqualSlices(u8, &row.type_id, &(try heap.typedArrayIdentity(object)));
    }
}
test "reference capture failures publish no roots and preserve the initialized Array" {
    var module = try load("reference"); defer module.deinit(); const row = module.arrays[0];
    var id: ?[32]u8 = null;
    for (row.domain.members) |member| if ((try module.authority.layouts.find(member)).cell != null) { id = member; break; };
    const layout = (try module.authority.layouts.find(id.?)).cell.?;
    var failures: usize = 0;
    for (0..256) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.authority.layouts);
        const child = try heap.createTypedCell(layout, .persistent);
        const object = try module.create(&heap, row.type_id, &.{.{ .type_id = id.?, .input = .{ .bytes = &.{}, .references = &.{child} } }}, .persistent);
        const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
        while (true) { const stats = try managed.testing.rootStats(&heap); if (stats.count == stats.capacity) break; _ = try heap.retain(object, .temporary); }
        const roots = (try managed.testing.rootStats(&heap)).count;
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        var snapshot: ?*backing.Value = null;
        const attempt: ?managed.Error = blk: { snapshot = module.capture(&heap, object, row.type_id, 0) catch |err| break :blk err; break :blk null; };
        failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
        if (attempt) |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
            try std.testing.expectEqual(roots, (try managed.testing.rootStats(&heap)).count);
            try std.testing.expectEqual(@as(u32, 1), try module.length(&heap, object, row.type_id));
            try heap.collect(); try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
        } else { try module.release(snapshot.?); break; }
    }
    try std.testing.expect(failures > 0);
}
