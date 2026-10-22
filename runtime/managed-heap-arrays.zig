// SPDX-License-Identifier: MIT
// Heap-private typed mutation and reference validation. No pointer escapes Heap.
const std = @import("std");
const model = @import("managed-heap-model.zig");
const element = @import("array-element.zig");
const arrays = @import("managed-array.zig");
const Allocator = std.mem.Allocator;
pub const Error = element.Error || error{InvalidHandle};
pub fn array(object: *model.Object, expected: element.Layout) Error!*arrays.Array {
    switch (object.payload) {
        .array => |*value| {
            try value.check(expected);
            return value;
        },
        else => return error.TypeMismatch,
    }
}

fn checkReference(object: *model.Object, expected: element.ReferenceType) Error!void {
    const valid = switch (expected) {
        .object => |id| object.payload == .scalar and object.type_id == id,
        .string => object.payload == .string,
        .cell_domain => object.payload == .cell and object.payload.cell.layout.kind == .reference,
        .array => |id| object.payload == .array and std.mem.eql(u8, &object.payload.array.layout.type_id, &id),
        .cell => |id| object.payload == .cell and std.mem.eql(u8, &object.payload.cell.layout.type_id, &id),
    };
    if (!valid) return error.TypeMismatch;
}

pub fn edges(allocator: Allocator, state: *model.State, owner: u64, layout: element.Layout, input: element.Input) Error![]?*model.Object {
    const variant = try layout.checkBytes(input.tag, input.bytes);
    if (input.references.len != layout.reference_count) return error.InvalidArrayElement;
    const result = try allocator.alloc(?*model.Object, layout.reference_count);
    errdefer allocator.free(result);
    @memset(result, null);
    try activeEdges(state, owner, variant, input.bytes, input.references, result);
    return result;
}

fn activeEdges(state: *model.State, owner: u64, variant: element.Variant, bytes: []const u8, references: []const ?@import("managed-handles.zig").Handle, out: []?*model.Object) Error!void {
    for (variant.references) |reference| {
        const handle = references[reference.slot] orelse return error.InvalidArrayElement;
        const target = try model.resolve(state, owner, handle);
        try checkReference(target, reference.type);
        out[reference.slot] = target;
    }
    for (variant.children) |child| {
        const selected = try child.layout.selectVariant(element.childTag(child, bytes));
        const start = child.reference_offset;
        try activeEdges(state, owner, selected, bytes[child.offset..][0..child.layout.byte_size],
            references[start..][0..child.layout.reference_count], out[start..][0..child.layout.reference_count]);
    }
}

pub fn create(allocator: Allocator, state: *model.State, owner: u64, identity: u64, layout: element.Layout, inputs: []const element.Input) Error!*model.Object {
    const payload = try arrays.Array.init(allocator, layout, inputs);
    errdefer payload.deinit(allocator);
    const references = try allocator.alloc(?*model.Object, try arrays.Array.referenceCount(layout, inputs.len));
    errdefer allocator.free(references);
    for (inputs, 0..) |input, index| {
        const selected = try edges(allocator, state, owner, layout, input);
        defer allocator.free(selected);
        @memcpy(references[index * layout.reference_count ..][0..layout.reference_count], selected);
    }
    const object = try allocator.create(model.Object);
    object.* = .{ .identity = identity, .type_id = 0, .payload = .{ .array = payload }, .edges = references, .index = state.objects.items.len };
    return object;
}

pub fn store(allocator: Allocator, state: *model.State, owner: u64, object: *model.Object, expected: element.Layout, index: u32, input: element.Input) Error!void {
    const value = try array(object, expected);
    if (index > value.length) return error.IndexOutOfBounds;
    const selected = try edges(allocator, state, owner, value.layout, input);
    defer allocator.free(selected);
    const edge_start = @as(usize, index) * value.layout.reference_count;
    if (index < value.length) {
        const start = @as(usize, index) * value.layout.byte_size;
        value.layout.copyBytes(input.tag, value.bytes[start..][0..value.layout.byte_size], input.bytes);
        value.tags[index] = input.tag;
        @memcpy(object.edges[edge_start..][0..selected.len], selected);
        return;
    }
    const replacement = try value.replacement(allocator, input);
    errdefer replacement.deinit(allocator);
    const references = try allocator.alloc(?*model.Object, try arrays.Array.referenceCount(value.layout, replacement.length));
    @memcpy(references[0..edge_start], object.edges[0..edge_start]);
    @memcpy(references[edge_start..], selected);
    // Both value and reference planes are complete; this is the serial write
    // barrier/commit. No user callback or collection can observe a half-write.
    value.deinit(allocator);
    allocator.free(object.edges);
    value.* = replacement;
    object.edges = references;
}

pub fn resize(object: *model.Object, expected: element.Layout, length: u32) Error!void {
    const value = try array(object, expected);
    if (length > value.length) return error.UninitializedGrowth;
    const remaining = try arrays.Array.referenceCount(value.layout, length);
    @memset(object.edges[remaining..], null);
    value.length = length;
}
