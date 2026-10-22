// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const views = @import("typed-reference-views.zig");
const access = @import("managed-reference-view.zig");
const element = @import("array-element.zig");
const allocator = std.testing.allocator;
const root = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-view-captures/";
fn bytes(name: []const u8) ![]u8 {
    const path = try std.mem.concat(allocator, u8, &.{ root, name, ".bin" }); defer allocator.free(path);
    return std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(2097152));
}
fn load(name: []const u8) !views.Module { const raw = try bytes(name); defer allocator.free(raw); return views.load(allocator, raw); }
fn scalar(heap: *managed.ManagedHeap, object: managed.Handle, cell: managed.CellLayout, index: usize, value: u32) !void {
    var data: [4]u8 = undefined; std.mem.writeInt(u32, &data, value, .little);
    try heap.writeTypedField(object, cell, cell.fields[index].id, .{ .bytes = &data, .references = &.{} }, true);
}
fn childType(layout: element.Layout) ?views.Id {
    for (layout.variants) |variant| {
        for (variant.references) |reference| if (reference.type == .cell) return reference.type.cell;
        for (variant.children) |child| if (childType(child.layout.*)) |id| return id;
    }
    return null;
}
// Fixed stack backing makes a missing free a finite accounting failure, not a
// process heap leak. Refusing resize forces actual arena buffer growth.
const GrowthTracker = struct {
    backing: std.mem.Allocator,
    regions: [64]struct { address: usize, length: usize, freed: bool } = undefined,
    count: usize = 0,
    live: usize = 0,
    fn allocator(self: *GrowthTracker) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = alloc, .resize = resize, .remap = remap, .free = free } };
    }
    fn alloc(ctx: *anyopaque, length: usize, alignment: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *GrowthTracker = @ptrCast(@alignCast(ctx));
        if (self.count == self.regions.len) return null;
        const ptr = self.backing.rawAlloc(length, alignment, ra) orelse return null;
        self.regions[self.count] = .{ .address = @intFromPtr(ptr), .length = length, .freed = false };
        self.count += 1; self.live += length; return ptr;
    }
    fn resize(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) bool { return false; }
    fn remap(_: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize, _: usize) ?[*]u8 { return null; }
    fn free(ctx: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ra: usize) void {
        const self: *GrowthTracker = @ptrCast(@alignCast(ctx));
        for (self.regions[0..self.count]) |*region| if (region.address == @intFromPtr(memory.ptr)) {
            std.debug.assert(!region.freed and region.length == memory.len);
            region.freed = true; self.live -= memory.len; self.backing.rawFree(memory, alignment, ra); return;
        };
        unreachable;
    }
    fn regionIndex(self: GrowthTracker, address: usize) !usize {
        for (self.regions[0..self.count], 0..) |block, i| if (address >= block.address and address - block.address < block.length) return i;
        return error.UnknownArenaBuffer;
    }
};
test "successful view parsing transfers every arena buffer allocated after its view table" {
    const raw = try bytes("arena"); defer allocator.free(raw);
    var buffer: [65536]u8 = undefined; var fixed = std.heap.FixedBufferAllocator.init(&buffer);
    var tracker = GrowthTracker{ .backing = fixed.allocator() };
    var module = try views.load(tracker.allocator(), raw);
    const table = try tracker.regionIndex(@intFromPtr(module.views.ptr));
    var grew_after_table = false;
    for (module.views) |view| if (view.fields.len != 0) {
        if (try tracker.regionIndex(@intFromPtr(view.fields.ptr)) != table) grew_after_table = true;
    };
    // Establish the causal allocation shape before checking deinitialization.
    try std.testing.expect(grew_after_table);
    const count = tracker.count; module.deinit();
    try std.testing.expectEqual(@as(usize, 0), tracker.live);
    for (tracker.regions[0..tracker.count]) |region| try std.testing.expect(region.freed);
    std.debug.print("success-growth {d} buffers, later pair buffer proven, all released\n", .{count});
}
test "actual offset view aliases retain actual layout and survive array storage moving GC" {
    var module = try load("offset"); defer module.deinit(); const view = module.views[0];
    const actual = (try module.layouts.find(view.actual)).cell.?;
    const target = (try module.layouts.find(view.target)).cell.?;
    try std.testing.expectEqual(@as(u32, 4), actual.fields[1].offset);
    try std.testing.expectEqual(@as(u32, 0), target.fields[0].offset);
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.layouts);
    const scope = try heap.beginScope(); const object = try heap.createTypedCell(actual, .temporary);
    try std.testing.expectError(error.UninitializedField, access.read(&heap, module, object, target.type_id, target.fields[0].id, .temporary));
    try scalar(&heap, object, actual, 0, 11); try scalar(&heap, object, actual, 1, 42);
    // The old direct API correctly refuses reinterpretation as the target.
    try std.testing.expectError(error.TypeMismatch, heap.readTypedField(object, target, target.fields[0].id, .temporary));
    const layout = (try module.layouts.find(actual.type_id)).layout;
    const array = try heap.createTypedArray(layout, &.{.{ .bytes = &.{}, .references = &.{object} }}, .persistent);
    const alias = try heap.retain(array, .persistent); try heap.endScope(scope); try heap.collect();
    const read_scope = try heap.beginScope(); defer heap.endScope(read_scope) catch unreachable;
    var element_value = try heap.readTypedArray(alias, layout, 0, .temporary); defer element_value.deinit(allocator);
    var value = try access.read(&heap, module, element_value.references[0].?, target.type_id, target.fields[0].id, .temporary); defer value.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 42, 0, 0, 0 }, value.value.bytes);
    try std.testing.expect(value.layout.same(actual.fields[1].layout));
    value.value.bytes[0] = 63; try access.write(&heap, module, element_value.references[0].?, target.type_id, target.fields[0].id, value);
    try heap.collect();
    var reread = try heap.readTypedField(element_value.references[0].?, actual, actual.fields[1].id, .temporary); defer reread.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 63, 0, 0, 0 }, reread.bytes);
    const identity = try heap.copyTypedCellLayout(element_value.references[0].?); defer identity.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &actual.runtime_key, &identity.runtime_key);
}
test "nested nullable reference views preserve actual tags roots and child runtime identities" {
    var module = try load("nested"); defer module.deinit();
    var selected: ?views.View = null;
    for (module.views) |view| {
        const cell = (try module.layouts.find(view.actual)).cell.?;
        if (cell.reference_count == 1) selected = view;
    }
    const view = selected.?; const cell = (try module.layouts.find(view.actual)).cell.?; const field = cell.fields[0];
    const child_entry = try module.layouts.find(childType(field.layout).?); const child_cell = child_entry.cell.?;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.layouts);
    const child = try heap.createTypedCell(child_cell, .persistent); try scalar(&heap, child, child_cell, 0, 77);
    const object = try heap.createTypedCell(cell, .persistent);
    const data = try allocator.alloc(u8, field.layout.byte_size); defer allocator.free(data); @memset(data, 0);
    var tag: u16 = 0; var absent: u16 = 0;
    for (field.layout.variants) |variant| { if (variant.kind == .value) tag = variant.tag else absent = variant.tag; }
    try heap.writeTypedField(object, cell, field.id, .{ .tag = tag, .bytes = data, .references = &.{child} }, true);
    const scope = try heap.beginScope();
    var value = try access.read(&heap, module, object, view.target, view.fields[0].target, .temporary); defer value.deinit(allocator);
    try std.testing.expectEqual(tag, value.value.tag); try std.testing.expect(value.layout.same(field.layout));
    try heap.release(child); try heap.collect();
    const child_actual = try heap.copyTypedCellLayout(value.value.references[0].?); defer child_actual.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &child_cell.runtime_key, &child_actual.runtime_key);
    const nested = for (module.views) |candidate| { if (std.mem.eql(u8, &candidate.actual, &child_cell.type_id)) break candidate; } else return error.MissingNestedView;
    var leaf = try access.read(&heap, module, value.value.references[0].?, nested.target, nested.fields[0].target, .temporary); defer leaf.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 77, 0, 0, 0 }, leaf.value.bytes);
    value.value.tag = absent; value.value.references[0] = null;
    try access.write(&heap, module, object, view.target, view.fields[0].target, value);
    try heap.endScope(scope); try heap.collect(); try std.testing.expectEqual(@as(usize, 1), try heap.objectCount());
    var missing = try access.read(&heap, module, object, view.target, view.fields[0].target, .persistent); defer missing.deinit(allocator);
    try std.testing.expectEqual(absent, missing.value.tag); try std.testing.expectEqual(@as(?managed.Handle, null), missing.value.references[0]);
}
test "method view selects the actual callable signature and roots the same receiver" {
    var module = try load("method"); defer module.deinit(); const view = module.views[0]; const pair = view.methods[0];
    const cell = (try module.layouts.find(view.actual)).cell.?;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.layouts); const object = try heap.createTypedCell(cell, .persistent);
    const callable = try access.method(&heap, module, object, view.target, pair.target, .persistent);
    try std.testing.expectEqualSlices(u8, &pair.source, &callable.function_id);
    for (module.methods) |method| if (std.mem.eql(u8, &method.id, &pair.source)) {
        try std.testing.expectEqualSlices(u8, &method.signature, &callable.signature);
    };
    try std.testing.expect(try heap.sameObject(object, callable.receiver));
    try std.testing.expectEqualSlices(u8, &cell.runtime_key, &callable.runtime_key);
    try heap.release(object); try heap.collect();
    const actual = try heap.copyTypedCellLayout(callable.receiver); defer actual.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &cell.type_id, &actual.type_id);
    try heap.release(callable.receiver); try heap.collect(); try std.testing.expectEqual(@as(usize, 0), try heap.objectCount());
}
test "viewed inline value copies keep the actual nonnullable value domain" {
    var module = try load("value"); defer module.deinit(); const view = module.views[0];
    const actual = (try module.layouts.find(view.actual)).cell.?;
    const target = (try module.layouts.find(view.target)).cell.?;
    const value_entry = try module.layouts.find(actual.fields[0].layout.type_id); const value_cell = value_entry.cell.?;
    try std.testing.expect(!actual.fields[0].layout.same(target.fields[0].layout));
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.layouts); const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    const fixed = try heap.createTypedCell(value_cell, .temporary); try scalar(&heap, fixed, value_cell, 0, 91);
    var fixed_value = try heap.readTypedValue(fixed, value_cell, value_entry.layout, .temporary); defer fixed_value.deinit(allocator);
    const object = try heap.createTypedCell(actual, .persistent);
    try heap.writeTypedField(object, actual, actual.fields[0].id, .{ .bytes = fixed_value.bytes, .references = fixed_value.references }, true);
    var read = try access.read(&heap, module, object, view.target, view.fields[0].target, .temporary); defer read.deinit(allocator);
    try std.testing.expect(read.layout.same(value_entry.layout)); try std.testing.expectEqual(@as(u16, 0), read.value.tag);
    const offset = value_entry.layout.variants[0].children[0].offset;
    try std.testing.expectEqualSlices(u8, &.{ 91, 0, 0, 0 }, read.value.bytes[offset..][0..4]);
    read.value.bytes[offset] = 24; try access.write(&heap, module, object, view.target, view.fields[0].target, read);
    var unchanged = try heap.readTypedValue(fixed, value_cell, value_entry.layout, .temporary); defer unchanged.deinit(allocator);
    try std.testing.expectEqual(@as(u8, 91), unchanged.bytes[offset]);
    var wrong = actual; wrong.runtime_key[31] ^= 1;
    try std.testing.expectError(error.InvalidViewModule, module.view(wrong, view.target));
}
test "view decoding and projected reads release every failed allocation before publication" {
    const raw = try bytes("offset"); defer allocator.free(raw);
    var decode_failures: usize = 0;
    for (0..512) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = offset });
        var module = views.load(failing.allocator(), raw) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); decode_failures += 1; continue;
        };
        module.deinit(); break;
    } else return error.NoSuccessfulDecode;
    try std.testing.expect(decode_failures > 0);
    var module = try load("offset"); defer module.deinit(); const view = module.views[0];
    const cell = (try module.layouts.find(view.actual)).cell.?; var failures: usize = 0;
    for (0..64) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.layouts); const object = try heap.createTypedCell(cell, .persistent);
        try scalar(&heap, object, cell, 0, 7); try scalar(&heap, object, cell, 1, 42);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        var read = access.read(&heap, module, object, view.target, view.fields[0].target, .persistent) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try heap.collect(); try std.testing.expectEqual(@as(usize, 1), try heap.objectCount()); continue;
        };
        read.deinit(failing.allocator()); break;
    } else return error.NoSuccessfulRead;
    try std.testing.expect(failures > 0);
    std.debug.print("view decode {d} / read {d} real OOM points then success\n", .{ decode_failures, failures });
}
test "view module rejects wrong identities missing mappings and truncation" {
    const raw = try bytes("offset"); defer allocator.free(raw);
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, raw[0..39]));
    const forged = try allocator.dupe(u8, raw); defer allocator.free(forged);
    var module = try load("offset"); defer module.deinit(); const pair = module.views[0].fields[0];
    const at = std.mem.lastIndexOf(u8, forged, &pair.source).?; forged[at + 31] ^= 1;
    try std.testing.expectError(error.InvalidField, views.load(allocator, forged));
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, raw[0 .. raw.len - 1]));
}
