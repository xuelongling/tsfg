// SPDX-License-Identifier: MIT
const certificate = @import("host_certificate.zig");
extern fn tsfg_host_counter(storage: *Counter, delta: u32) callconv(.c) u32;

/// Only this fixed Runtime-owned native callback is admitted. The formal build
/// supplies the certificate after decoding its actual object; no caller can
/// substitute a function pointer or declare a cost for unknown native code.
pub const Counter = extern struct {
    storage: u32 = 0,
    reserved: u32 = 0,
    events: u64 = 0,
    pub fn admitted(_: *const Counter) bool { return certificate.qualified; }
    pub fn instructionBound(_: *const Counter) u64 { return certificate.instruction_upper_bound; }
    pub fn administrativeBytes(_: *const Counter) usize {
        return if (certificate.qualified) certificate.call_boundary_bytes - 8 + @sizeOf(Counter) else 0;
    }
    pub fn boundaryBytes(_: *const Counter) usize { return 8; }
    pub inline fn call(self: *Counter, bits: u32) u32 {
        return tsfg_host_counter(self, bits);
    }
};

comptime {
    if (@sizeOf(Counter) != 16 or @alignOf(Counter) != 8 or @offsetOf(Counter, "storage") != 0 or @offsetOf(Counter, "events") != 8)
        @compileError("counter ABI differs from certified uint32/reserved/uint64 layout");
}
