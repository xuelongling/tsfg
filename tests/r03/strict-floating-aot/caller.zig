// SPDX-License-Identifier: MIT
// Compile/link only; raw IEEE conversion does not perform arithmetic.
const Slot = extern struct { low: u32, high: u32 };
const Event = *const fn (?*anyopaque, u32, u32, u32, u32, u64) callconv(.c) u32;
extern const tsfg_native_abi_version: u32;
extern fn tsfg_native_invoke_v3(?*anyopaque, Event, u32, u32, ?[*]const u8, u8,
    ?[*]const Slot, *Slot) callconv(.c) u32;
comptime {
    if (@sizeOf(Slot) != 8 or @alignOf(Slot) != 4 or @offsetOf(Slot, "high") != 4) @compileError("ABI3 slot");
    if (@bitSizeOf(f32) != 32 or @bitSizeOf(f64) != 64) @compileError("IEEE formats");
}
export fn tsfg_zig_float_probe(state: ?*anyopaque, event: Event, index: u32,
    single: f32, wide: f64, output: *Slot) callconv(.c) u32 {
    const a: u32 = @bitCast(single);
    const b: u64 = @bitCast(wide);
    const types = [_]u8{12, 13};
    const arguments = [_]Slot{ .{ .low = a, .high = 0 }, .{ .low = @truncate(b), .high = @truncate(b >> 32) } };
    if (tsfg_native_abi_version != 3) return 0;
    return tsfg_native_invoke_v3(state, event, index, 2, &types, 13, &arguments, output);
}
