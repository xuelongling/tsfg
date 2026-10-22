// SPDX-License-Identifier: MIT
// Root table publication is infallible after capacity reservation. No addresses
// leave the heap's private modules; public values contain only owner/generation.
const std = @import("std");
const model = @import("managed-heap-model.zig");
const handles = @import("managed-handles.zig");
pub fn available(allocator: std.mem.Allocator, state: *model.State) std.mem.Allocator.Error!usize {
    for (state.roots.items, 0..) |root, index| if (root.object == null and !root.retired) return index;
    try state.roots.ensureUnusedCapacity(allocator, 1);
    return state.roots.items.len;
}
pub fn install(state: *model.State, owner: u64, index: usize, object: *model.Object, scope: u64) handles.Handle {
    if (index == state.roots.items.len) state.roots.appendAssumeCapacity(.{});
    const root = &state.roots.items[index]; root.object = object; root.scope = scope;
    return .{ .owner = owner, .slot = index, .generation = root.generation };
}
pub fn invalidate(root: *model.Root) void {
    root.object = null; root.scope = 0;
    if (root.generation == std.math.maxInt(u64)) root.retired = true else root.generation += 1;
}
