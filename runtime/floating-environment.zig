// SPDX-License-Identifier: MIT
pub const FloatingEnvironment = struct {
    mxcsr: u32,
    x87_control: u16,
    pub fn read() FloatingEnvironment {
        var state: FloatingEnvironment = undefined;
        asm volatile ("stmxcsr (%[ptr])" : : [ptr] "r" (&state.mxcsr) : .{ .memory = true });
        asm volatile ("fnstcw (%[ptr])" : : [ptr] "r" (&state.x87_control) : .{ .memory = true });
        return state;
    }
    pub fn restore(self: FloatingEnvironment) void {
        asm volatile ("ldmxcsr (%[ptr])" : : [ptr] "r" (&self.mxcsr) : .{ .memory = true });
        asm volatile ("fldcw (%[ptr])" : : [ptr] "r" (&self.x87_control) : .{ .memory = true });
    }
    pub fn establish(self: FloatingEnvironment) void {
        // Clear rounding mode, FTZ/DAZ and pending SSE flags; mask exceptions.
        const strict: FloatingEnvironment = .{ .mxcsr = (self.mxcsr & ~@as(u32, 0xe07f)) | 0x1f80,
            .x87_control = (self.x87_control & ~@as(u16, 0x0c00)) | 0x003f };
        strict.restore();
    }
};
