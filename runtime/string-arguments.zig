// SPDX-License-Identifier: MIT
// CLI String inputs preserve exact UTF16 units; JSON text cannot represent every
// String without replacement by a JSON decoder, so the value is a unit array.
const std = @import("std");
const strings = @import("string-value.zig");
pub fn accepts(value: std.json.Value) bool {
    if (value != .array or value.array.items.len > 65536) return false;
    for (value.array.items) |item| {
        if (item != .integer or item.integer < 0 or item.integer > 65535) return false;
    }
    return true;
}
pub fn read(allocator: std.mem.Allocator, owner_slot: *?*strings.Owner, value: std.json.Value, maximum: u64) !strings.String {
    if (!accepts(value)) return error.InvalidStringArgument;
    return readValidated(allocator, owner_slot, value.array.items, maximum);
}

// The caller has validated the immutable JSON array with accepts.
pub fn readValidated(allocator: std.mem.Allocator, owner_slot: *?*strings.Owner, items: []const std.json.Value, maximum: u64) !strings.String {
    const limit = std.math.cast(usize, maximum) orelse return error.InvalidStringArgument;
    const previous = owner_slot.*;
    const owner = previous orelse try strings.Owner.create(allocator);
    errdefer if (previous == null) owner.release();
    const previous_limit = owner.budget.limit;
    owner.budget.limit = limit;
    errdefer owner.budget.limit = previous_limit;
    const temporary = owner.budget.allocator();
    const units = try temporary.alloc(u16, items.len);
    defer temporary.free(units);
    for (items, units) |item, *unit| unit.* = @intCast(item.integer);
    try owner.retain();
    errdefer owner.release();
    const root = try owner.heap.createString(units, .persistent);
    owner_slot.* = owner;
    return .{ .owner = owner, .handle = root };
}
