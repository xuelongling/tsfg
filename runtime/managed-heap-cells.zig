// SPDX-License-Identifier: MIT
// Typed field mutation is the same graph barrier as Array mutation.
const std = @import("std");
const model = @import("managed-heap-model.zig");
const cells = @import("managed-cell.zig");
const arrays = @import("managed-heap-arrays.zig");
const element = @import("array-element.zig");
pub const Error = cells.Error || arrays.Error;
pub fn cell(object: *model.Object, expected: cells.Layout) Error!*cells.Cell {
    if (object.payload != .cell or !object.payload.cell.layout.same(expected)) return error.TypeMismatch;
    return &object.payload.cell;
}
pub fn create(allocator: std.mem.Allocator, state: *model.State, identity: u64, layout: cells.Layout) Error!*model.Object {
    const payload = try cells.Cell.init(allocator, layout);
    errdefer payload.deinit(allocator);
    const edges = try allocator.alloc(?*model.Object, layout.reference_count);
    errdefer allocator.free(edges);
    @memset(edges, null);
    const object = try allocator.create(model.Object);
    object.* = .{ .identity = identity, .type_id = 0, .payload = .{ .cell = payload }, .edges = edges, .index = state.objects.items.len };
    return object;
}
pub fn write(allocator: std.mem.Allocator, state: *model.State, owner: u64, object: *model.Object,
    expected: cells.Layout, field_id: [32]u8, input: element.Input, initialize: bool) Error!void {
    const value = try cell(object, expected);
    const index = try value.layout.fieldIndex(field_id);
    const field = value.layout.fields[index];
    if (initialize) {
        if (value.initialized[index]) return error.AlreadyInitialized;
    } else {
        if (!value.initialized[index]) return error.UninitializedField;
        if (field.readonly) return error.ReadonlyField;
    }
    const edges = try arrays.edges(allocator, state, owner, field.layout, input);
    defer allocator.free(edges);
    field.layout.copyBytes(input.tag, value.fieldBytes(index), input.bytes);
    @memcpy(object.edges[field.reference_offset..][0..field.layout.reference_count], edges);
    value.tags[index] = input.tag;
    value.initialized[index] = true;
}
pub fn createValue(allocator: std.mem.Allocator, state: *model.State, owner: u64, identity: u64,
    layout: cells.Layout, expected: element.Layout, input: element.Input) Error!*model.Object {
    const object = try create(allocator, state, identity, layout);
    errdefer { object.payload.deinit(allocator); allocator.free(object.edges); allocator.destroy(object); }
    try object.payload.cell.unpack(allocator, expected, input);
    const edges = try arrays.edges(allocator, state, owner, expected, input);
    allocator.free(object.edges); object.edges = edges; return object;
}
