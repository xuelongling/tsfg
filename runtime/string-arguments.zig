// SPDX-License-Identifier: MIT
// CLI String inputs preserve exact UTF16 units; JSON text cannot represent every
// String without replacement by a JSON decoder, so the value is a unit array.
const std = @import("std");
const strings = @import("string-value.zig");
pub fn read(allocator: std.mem.Allocator, owner_slot: *?*strings.Owner, value: std.json.Value, maximum: u64) !strings.String {
    if (value != .array or value.array.items.len > 65536) return error.InvalidStringArgument;
    if (owner_slot.* == null) owner_slot.* = try strings.Owner.create(allocator);
    const owner = owner_slot.*.?;
    owner.budget.limit = std.math.cast(usize, maximum) orelse return error.InvalidStringArgument;
    const temporary = owner.budget.allocator();
    const units = try temporary.alloc(u16, value.array.items.len);
    defer temporary.free(units);
    for (value.array.items, units) |item, *unit| {
        if (item != .integer or item.integer < 0 or item.integer > 65535) return error.InvalidStringArgument;
        unit.* = @intCast(item.integer);
    }
    const root = try owner.heap.createString(units, .persistent);
    defer owner.heap.release(root) catch unreachable;
    return strings.String.retain(owner, root);
}
