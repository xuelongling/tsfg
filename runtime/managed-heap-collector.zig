// SPDX-License-Identifier: MIT
const std = @import("std");
const model = @import("managed-heap-model.zig");
const Allocator = std.mem.Allocator;
const Object = model.Object;
pub const Error = @import("managed-payload.zig").Error;

pub fn destroy(allocator: Allocator, object: *Object) void {
    object.payload.deinit(allocator);
    allocator.free(object.edges);
    allocator.destroy(object);
}

fn copyObject(allocator: Allocator, old: *Object, forwarded: []?*Object, copies: *std.ArrayList(*Object)) Error!*Object {
    if (forwarded[old.index]) |copy| return copy;
    const copy = try allocator.create(Object);
    errdefer allocator.destroy(copy);
    // Array payload cloning keeps only the initialized prefix. Match that
    // length in the reference plane so removed slots cost nothing to copy.
    const live_edges = switch (old.payload) {
        .array => |array| old.edges[0 .. @as(usize, array.length) * array.layout.reference_count],
        else => old.edges,
    };
    const edges = try allocator.dupe(?*Object, live_edges);
    errdefer allocator.free(edges);
    copy.* = .{ .identity = old.identity, .type_id = old.type_id, .payload = try old.payload.clone(allocator), .edges = edges, .index = copies.items.len };
    copies.appendAssumeCapacity(copy);
    forwarded[old.index] = copy;
    return copy;
}

// The same moving graph serves all payloads. Fallible copying finishes before
// roots/edges are committed; failed collection leaves the original graph intact.
pub fn collect(allocator: Allocator, state: *model.State) Error!void {
    if (state.objects.items.len == 0) return;
    const forwarded = try allocator.alloc(?*Object, state.objects.items.len);
    defer allocator.free(forwarded);
    @memset(forwarded, null);
    var copies: std.ArrayList(*Object) = .empty;
    errdefer {
        for (copies.items) |object| destroy(allocator, object);
        copies.deinit(allocator);
    }
    try copies.ensureTotalCapacity(allocator, state.objects.items.len);
    for (state.roots.items) |root| if (root.object) |object| {
        _ = try copyObject(allocator, object, forwarded, &copies);
    };
    var cursor: usize = 0;
    while (cursor < copies.items.len) : (cursor += 1) {
        for (copies.items[cursor].edges) |*edge| if (edge.*) |old| {
            edge.* = try copyObject(allocator, old, forwarded, &copies);
        };
    }
    for (state.roots.items) |*root| if (root.object) |old| {
        root.object = forwarded[old.index].?;
    };
    for (state.objects.items) |object| destroy(allocator, object);
    state.objects.deinit(allocator);
    state.objects = copies;
}
