// SPDX-License-Identifier: MIT
const std = @import("std");
const backing = @import("typed-array-backing.zig");
const managed = @import("managed-heap.zig");
const allocator = std.testing.allocator;
const file = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/array-backing-captures/narrow.bin";
fn bytes() ![]u8 { return std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, allocator, .limited(2097152)); }
fn wide(row: backing.Array) [32]u8 {
    for (row.views) |id| if (!std.mem.eql(u8, &id, &row.type_id)) return id;
    unreachable;
}
fn absent(module: backing.Module, row: backing.Array) ![32]u8 {
    for (row.domain.members) |id| if ((try module.authority.layouts.find(id)).layout.variants[0].kind == .undefined_value) return id;
    unreachable;
}
test "real Source narrow Array preserves actual U, static copy permission and original identity" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const row = module.arrays[0]; const target = wide(row); const undefined_id = try absent(module, row);
    try std.testing.expectEqual(@as(u32, 4), (try module.authority.layouts.find(row.element_type)).layout.byte_size);
    try std.testing.expect(!std.mem.eql(u8, &row.type_id, &row.domain.id));
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    const object = try module.create(&heap, row.type_id, &.{.{ .type_id = row.element_type, .input = .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{} } }}, .persistent);
    const alias = try heap.retain(object, .persistent);
    try module.write(&heap, alias, target, 0, .{ .type_id = undefined_id, .input = .{ .bytes = &.{}, .references = &.{} } });
    const copied = try module.capture(&heap, object, row.type_id, 0); defer module.release(copied) catch unreachable;
    const wide_value = try module.capture(&heap, alias, target, 0); defer module.release(wide_value) catch unreachable;
    try std.testing.expectError(error.TypeMismatch, module.copy(&heap, object, row.type_id, 0, wide_value));
    try std.testing.expectError(error.TypeMismatch, module.write(&heap, object, row.type_id, 0, .{ .type_id = undefined_id, .input = .{ .bytes = &.{}, .references = &.{} } }));
    try module.write(&heap, alias, target, 0, .{ .type_id = row.element_type, .input = .{ .bytes = &.{ 9, 0, 0, 0 }, .references = &.{} } });
    try heap.collect();
    try module.copy(&heap, object, row.type_id, 0, copied);
    var result = try module.read(&heap, object, row.type_id, 0, .temporary); defer result.deinit(allocator);
    try std.testing.expectEqual(.undefined_value, (try result.layout.selectVariant(result.value.tag)).kind);
    try std.testing.expect(try heap.sameObject(object, alias));
    try std.testing.expectEqualSlices(u8, &row.type_id, &(try heap.typedArrayIdentity(object)));
    try std.testing.expectError(error.TypeMismatch, heap.readTypedArray(object, (try module.authority.layouts.find(row.element_type)).layout, 0, .temporary));
}
test "backed Array retains dense append, shrink and Q12 checked bounds across collection" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit(); const row = module.arrays[0];
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const object = try module.create(&heap, row.type_id, &.{}, .persistent);
    const value = backing.Literal{ .type_id = try absent(module, row), .input = .{ .bytes = &.{}, .references = &.{} } };
    try std.testing.expectError(error.IndexOutOfBounds, module.write(&heap, object, wide(row), 1, value));
    try std.testing.expectEqual(@as(u32, 0), try heap.typedArrayLength(object, row.domain.layout));
    try module.write(&heap, object, wide(row), 0, value);
    try module.write(&heap, object, wide(row), 1, value);
    try std.testing.expectError(error.UninitializedGrowth, module.resize(&heap, object, row.type_id, 3));
    try module.resize(&heap, object, row.type_id, 0); try heap.collect();
    try std.testing.expectError(error.IndexOutOfBounds, module.read(&heap, object, row.type_id, 0, .persistent));
    try module.write(&heap, object, wide(row), 0, value);
    try std.testing.expectEqualSlices(u8, &row.type_id, &(try heap.typedArrayIdentity(object)));
}
test "Array reader rejects corrupt domain, trailing data and every decode allocation failure" {
    const raw = try bytes(); defer allocator.free(raw);
    const corrupt = try allocator.dupe(u8, raw); defer allocator.free(corrupt);
    const offset = 12 + std.mem.readInt(u32, raw[8..12], .little) + 2 + 64;
    corrupt[offset] ^= 1;
    try std.testing.expectError(error.InvalidViewModule, backing.load(allocator, corrupt));
    const extra = try allocator.alloc(u8, raw.len + 1); defer allocator.free(extra); @memcpy(extra[0..raw.len], raw); extra[raw.len] = 0;
    try std.testing.expectError(error.InvalidViewModule, backing.load(allocator, extra));
    try std.testing.expectError(error.InvalidViewModule, backing.load(allocator, raw[0 .. raw.len - 1]));
    try std.testing.checkAllAllocationFailures(allocator, decode, .{raw});
}
fn decode(a: std.mem.Allocator, raw: []const u8) !void { var module = try backing.load(a, raw); defer module.deinit(); }

test "backed Array create append overwrite and snapshots are transactional on allocation failure" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const row = module.arrays[0]; const value = backing.Literal{ .type_id = try absent(module, row), .input = .{ .bytes = &.{}, .references = &.{} } };
    for (0..4) |operation| {
        var failures: usize = 0;
        for (0..256) |offset| {
            var failing = std.testing.FailingAllocator.init(allocator, .{});
            var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
            try heap.installTypedLayouts(module.authority.layouts);
            const object = try module.create(&heap, row.type_id, &.{}, .persistent);
            try module.write(&heap, object, wide(row), 0, value);
            const identity = heap.next_identity; const roots = (try managed.testing.rootStats(&heap)).count;
            failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
            const attempt: ?managed.Error = blk: {
                if (operation == 0) { const created = module.create(&heap, row.type_id, &.{}, .persistent) catch |err| break :blk err; try heap.release(created); }
                if (operation == 1 or operation == 2) module.write(&heap, object, wide(row), if (operation == 1) 1 else 0, value) catch |err| break :blk err;
                if (operation == 3) { const captured = module.capture(&heap, object, row.type_id, 0) catch |err| break :blk err; try module.release(captured); }
                break :blk null;
            };
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            if (attempt) |err| {
                try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
                try std.testing.expectEqual(identity, heap.next_identity);
                try std.testing.expectEqual(roots, (try managed.testing.rootStats(&heap)).count);
                try std.testing.expectEqual(@as(u32, 1), try heap.typedArrayLength(object, row.domain.layout));
                var observed = try module.read(&heap, object, row.type_id, 0, .persistent); defer observed.deinit(heap.allocator);
                try std.testing.expectEqual(.undefined_value, (try observed.layout.selectVariant(observed.value.tag)).kind);
            } else break;
        }
        try std.testing.expect(failures > 0);
    }
}
