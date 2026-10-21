// SPDX-License-Identifier: MIT
// Compile/link-only probe, deliberately outside the production Runtime API.
const Slot = extern struct { low: u32, high: u32 };
const LegacySlot = extern struct { integer: i32, boolean: u8, reserved: [3]u8 };
const Event = *const fn (?*anyopaque, u32, u32, u32, u32, u64) callconv(.c) u32;
extern const tsfg_native_abi_version: u32;
extern fn tsfg_native_invoke_v3(?*anyopaque, Event, u32, u32, ?[*]const u8, u8,
    ?[*]const Slot, *Slot) callconv(.c) u32;
comptime {
    if (@sizeOf(Slot) != 8 or @alignOf(Slot) != 4 or @offsetOf(Slot, "low") != 0 or @offsetOf(Slot, "high") != 4) @compileError("word slot layout");
    if (@sizeOf(LegacySlot) != 8 or @alignOf(LegacySlot) != 4 or @offsetOf(LegacySlot, "boolean") != 4 or @offsetOf(LegacySlot, "reserved") != 5) @compileError("legacy slot layout");
    if (@sizeOf(usize) != 8 or @alignOf(usize) != 8 or @sizeOf(?*anyopaque) != 8) @compileError("pointer layout");
}
export fn tsfg_zig_abi_probe(state: ?*anyopaque, event: Event, index: u32,
    count: u32, types: ?[*]const u8, result_type: u8, arguments: ?[*]const Slot,
    output: *Slot) callconv(.c) u32 {
    if (tsfg_native_abi_version != 3) return 0;
    return tsfg_native_invoke_v3(state, event, index, count, types, result_type, arguments, output);
}
