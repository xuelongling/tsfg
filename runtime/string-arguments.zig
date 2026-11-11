// SPDX-License-Identifier: MIT
// CLI String inputs preserve exact UTF16 units; JSON text cannot represent every
// String without replacement by a JSON decoder, so the value is a unit array.
const std = @import("std");
const strings = @import("string-value.zig");
pub fn read(allocator: std.mem.Allocator, owner_slot: *?*strings.Owner, value: std.json.Value, maximum: u64) !strings.String {
    if (value != .array or value.array.items.len > 65536) return error.InvalidStringArgument;
    const limit = std.math.cast(usize, maximum) orelse return error.InvalidStringArgument;
    const previous = owner_slot.*;
    const owner = previous orelse try strings.Owner.create(allocator);
    errdefer if (previous == null) owner.release();
    const previous_limit = owner.budget.limit;
    owner.budget.limit = limit;
    errdefer owner.budget.limit = previous_limit;
    const temporary = owner.budget.allocator();
    const units = try temporary.alloc(u16, value.array.items.len);
    defer temporary.free(units);
    for (value.array.items, units) |item, *unit| {
        if (item != .integer or item.integer < 0 or item.integer > 65535) return error.InvalidStringArgument;
        unit.* = @intCast(item.integer);
    }
    try owner.retain();
    errdefer owner.release();
    const root = try owner.heap.createString(units, .persistent);
    owner_slot.* = owner;
    return .{ .owner = owner, .handle = root };
}
