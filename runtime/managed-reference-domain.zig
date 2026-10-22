// SPDX-License-Identifier: MIT
// Physical reference values have an actual heap cell, or an absence tag. This
// storage identity is not a Source TypeId and never reinterprets a class layout.
const std = @import("std");
const heap = @import("managed-heap.zig");
const element = @import("array-element.zig");
pub const Value = union(enum) { cell: heap.Handle, null_value: void, undefined_value: void };
const id = std.crypto.hash.sha2.Sha256.hash;
const storage_id = blk: {
    @setEvalBranchQuota(10000);
    var result: [32]u8 = undefined;
    id("tsfg.storage.reference-domain.v1", &result, .{}); break :blk result;
};
pub const layout: element.Layout = .{
    .type_id = storage_id, .byte_size = 0, .alignment = 1, .reference_count = 1,
    .variants = &.{
        .{ .tag = 0, .references = &.{.{ .slot = 0, .type = .cell_domain }} },
        .{ .tag = 1, .kind = .null_value }, .{ .tag = 2, .kind = .undefined_value },
    },
};
pub fn create(owner: *heap.ManagedHeap, values: []const Value, lifetime: heap.Lifetime) heap.Error!heap.Handle {
    if (values.len > std.math.maxInt(u32)) return error.ArrayTooLarge;
    const inputs = try owner.allocator.alloc(element.Input, values.len); defer owner.allocator.free(inputs);
    const references = try owner.allocator.alloc(?heap.Handle, values.len); defer owner.allocator.free(references);
    for (values, inputs, references) |value, *input, *reference| {
        reference.* = if (value == .cell) value.cell else null;
        input.* = .{ .tag = tag(value), .bytes = &.{}, .references = @as([*]const ?heap.Handle, @ptrCast(reference))[0..1] };
    }
    return owner.createTypedArray(layout, inputs, lifetime);
}
fn tag(value: Value) u16 { return switch (value) { .cell => 0, .null_value => 1, .undefined_value => 2 }; }
pub fn read(owner: *heap.ManagedHeap, array: heap.Handle, index: u32, lifetime: heap.Lifetime) heap.Error!Value {
    var value = try owner.readTypedArray(array, layout, index, lifetime); defer value.deinit(owner.allocator);
    return switch (value.tag) { 0 => .{ .cell = value.references[0].? }, 1 => .null_value, 2 => .undefined_value, else => unreachable };
}
pub fn store(owner: *heap.ManagedHeap, array: heap.Handle, index: u32, value: Value) heap.Error!void {
    const reference: ?heap.Handle = if (value == .cell) value.cell else null;
    try owner.storeTypedArray(array, layout, index, .{ .tag = tag(value), .bytes = &.{}, .references = &.{reference} });
}
pub fn resize(owner: *heap.ManagedHeap, array: heap.Handle, length: u32) heap.Error!void { try owner.resizeTypedArray(array, layout, length); }
