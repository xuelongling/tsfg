// SPDX-License-Identifier: MIT
const std = @import("std");
pub const Object = struct {
    identity: u64,
    type_id: u64,
    payload: @import("managed-payload.zig").Payload,
    edges: []?*Object,
    index: usize,
};
pub const Root = struct { object: ?*Object = null, generation: u64 = 1, scope: u64 = 0, retired: bool = false };
pub const State = struct { objects: std.ArrayList(*Object) = .empty, roots: std.ArrayList(Root) = .empty,
    types: @import("typed-layout-registry.zig").Registry = .{} };

pub fn resolve(state: *State, owner: u64, handle: @import("managed-handles.zig").Handle) error{InvalidHandle}!*Object {
    if (handle.owner != owner or handle.slot >= state.roots.items.len) return error.InvalidHandle;
    const root = state.roots.items[handle.slot];
    if (root.retired or root.generation != handle.generation) return error.InvalidHandle;
    return root.object orelse error.InvalidHandle;
}
