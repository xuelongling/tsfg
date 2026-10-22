// SPDX-License-Identifier: MIT
// Exact bounded catalogue limits, using the real logical reader and heap API.
const std = @import("std");
const canonical = @import("typed-layout-canonical.zig");
const managed = @import("managed-heap.zig");
const registry_model = @import("typed-layout-registry.zig");
const allocator = std.testing.allocator;
const equal = std.testing.expectEqual;
const Definition = struct { id: [32]u8, key: [32]u8 };
fn less(_: void, a: Definition, b: Definition) bool { return std.mem.lessThan(u8, &a.id, &b.id); }
fn definitionAt(index: usize) Definition {
    var key = [_]u8{0} ** 32; std.mem.writeInt(u32, key[0..4], @intCast(index + 1), .little);
    const hex = std.fmt.bytesToHex(key, .lower);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("tsfg.type\x00ref<sha256:"); hash.update(&hex); hash.update(">");
    return .{ .id = hash.finalResult(), .key = key };
}
fn moduleBytes(count: u16) ![]u8 {
    const definitions = try allocator.alloc(Definition, count); defer allocator.free(definitions);
    for (definitions, 0..) |*definition, index| {
        definition.* = definitionAt(index);
    }
    std.mem.sort(Definition, definitions, {}, less);
    var bytes: std.ArrayList(u8) = .empty; errdefer bytes.deinit(allocator);
    try bytes.appendSlice(allocator, "TSGLAY01");
    var length: [2]u8 = undefined; std.mem.writeInt(u16, &length, count, .little); try bytes.appendSlice(allocator, &length);
    for (definitions) |definition| {
        try bytes.appendSlice(allocator, &definition.id); try bytes.append(allocator, 8);
        try bytes.appendSlice(allocator, &definition.key); try bytes.appendSlice(allocator, &.{ 0, 0, 0 });
    }
    return bytes.toOwnedSlice(allocator);
}
test "an existing empty class Array may upgrade its cell within 4096 unique imported types" {
    const bytes = try moduleBytes(4096); defer allocator.free(bytes);
    var module = try canonical.load(allocator, bytes); defer module.deinit();
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    const class = module.entries[0];
    const array = try heap.createTypedArray(class.layout, &.{}, .persistent);
    try heap.installTypedLayouts(module);
    try equal(@as(u32, 0), try heap.typedArrayLength(array, class.layout));
    _ = try heap.createTypedCell(class.cell.?, .persistent);
    try equal(@as(usize, 2), try heap.objectCount());
}
test "metadata upgrade OOM is atomic at the unique-type limit and 4097 really rejects" {
    const bytes = try moduleBytes(4096); defer allocator.free(bytes);
    var module = try canonical.load(allocator, bytes); defer module.deinit();
    var failing = std.testing.FailingAllocator.init(allocator, .{});
    var registry = registry_model.Registry{}; defer registry.deinit(failing.allocator());
    const class = module.entries[0];
    try registry.admitLayout(failing.allocator(), class.layout);
    var remainder = module; remainder.entries = module.entries[1..]; try registry.admitModule(failing.allocator(), remainder);
    try equal(@as(usize, 4096), registry.entries.items.len); try std.testing.expect(registry.entries.items[0].cell == null);
    var upgrade = module; upgrade.entries = module.entries[0..1];
    var failures: usize = 0;
    for (0..32) |offset| {
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        const failure: ?registry_model.Error = failed: { registry.admitModule(failing.allocator(), upgrade) catch |err| break :failed err; break :failed null; };
        failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
        if (failure) |err| {
            try equal(error.OutOfMemory, err); failures += 1;
            try equal(@as(usize, 4096), registry.entries.items.len);
            try std.testing.expect(registry.entries.items[0].cell == null);
            try std.testing.expect(registry.entries.items[0].layout.same(class.layout));
        } else {
            try std.testing.expect(failures > 0);
            std.debug.print("4096-type cell upgrade: {d} real OOM points then success\n", .{failures}); break;
        }
    } else return error.NoSuccessfulAttempt;
    try equal(@as(usize, 4096), registry.entries.items.len);
    try std.testing.expect(registry.entries.items[0].cell.?.same(class.cell.?));
    const extra_definition = definitionAt(4096);
    const extra = managed.CellLayout{ .type_id = extra_definition.id, .runtime_key = extra_definition.key, .kind = .reference,
        .byte_size = 0, .alignment = 1, .reference_count = 0, .fields = &.{} };
    try std.testing.expectError(error.LayoutLimit, registry.admitCell(failing.allocator(), extra));
    try equal(@as(usize, 4096), registry.entries.items.len); try std.testing.expect(registry.entries.items[0].cell.?.same(class.cell.?));
    const oversized = try moduleBytes(4097); defer allocator.free(oversized);
    try std.testing.expectError(error.LayoutLimit, canonical.load(allocator, oversized));
}
