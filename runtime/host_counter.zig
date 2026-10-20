// SPDX-License-Identifier: MIT
const semantics = @import("host-semantic-contract.zig");
const certificate = @import("host_certificate.zig");
const std = @import("std");
extern fn tsfg_host_counter(storage: *Counter, delta: u32) callconv(.c) u32;
extern fn tsfg_host_counter_bridge(storage: *Counter, delta: u32) callconv(.c) u32;

/// A snapshot belongs to the current thread and is consumed synchronously.
/// Object intervals must be wholly active-stack or wholly outside that stack;
/// straddling, overflow and pointers into inactive stack storage fail closed.
pub const StackSnapshot = struct {
    base: usize,
    pointer: usize,
    limit: usize,
    pub fn valid(self: StackSnapshot) bool { return self.limit != 0 and self.base > self.limit and self.base >= self.pointer and self.pointer >= self.limit; }
    pub fn activeBytes(self: StackSnapshot) ?usize { return if (self.valid()) self.base - self.pointer else null; }
    pub fn outsideBytes(self: StackSnapshot, address: usize, bytes: usize) ?usize {
        if (!self.valid()) return null;
        if (bytes == 0) return 0;
        if (address == 0) return null;
        const end = @addWithOverflow(address, bytes);
        if (end[1] != 0) return null;
        if (address >= self.pointer and end[0] <= self.base) return 0;
        if (end[0] <= self.limit or address >= self.base) return bytes;
        return null;
    }
    pub fn admits(self: StackSnapshot, future_stack: usize, other_storage: usize, memory: usize) bool {
        const active = self.activeBytes() orelse return false;
        if (future_stack > self.pointer - self.limit) return false;
        const stack = @addWithOverflow(active, future_stack);
        if (stack[1] != 0) return false;
        const total = @addWithOverflow(stack[0], other_storage);
        return total[1] == 0 and total[0] <= memory;
    }
    pub inline fn read() StackSnapshot {
        const pointer = asm volatile ("movq %%rsp, %[value]" : [value] "=r" (-> usize));
        const base = asm volatile ("movq %%gs:8, %[value]" : [value] "=r" (-> usize));
        const limit = asm volatile ("movq %%gs:0x10, %[value]" : [value] "=r" (-> usize));
        return .{ .base = base, .pointer = pointer, .limit = limit };
    }
};

/// Only this fixed Runtime-owned native callback is admitted. The formal build
/// supplies the certificate after decoding its actual object; no caller can
/// substitute a function pointer or declare a cost for unknown native code.
pub const Counter = extern struct {
    storage: u32 = 0,
    reserved: u32 = 0,
    events: u64 = 0,
    /// Check the actual loaded fixed symbols, including the resolved direct
    /// call. No request can supply a pointer, code bytes, cost or target here.
    pub fn machineMatches() bool {
        const leaf: [*]const volatile u8 = @ptrCast(&tsfg_host_counter);
        const bridge: [*]const volatile u8 = @ptrCast(&tsfg_host_counter_bridge);
        var loaded_leaf: [11]u8 = undefined;
        var loaded_bridge: [15]u8 = undefined;
        for (&loaded_leaf, 0..) |*byte, index| byte.* = leaf[index];
        for (&loaded_bridge, 0..) |*byte, index| byte.* = bridge[index];
        const leaf_bytes = [_]u8{ 0x89, 0xd0, 0x48, 0xff, 0x41, 0x08, 0x03, 0x01, 0x89, 0x01, 0xc3 };
        const bridge_prefix = [_]u8{ 0x48, 0x83, 0xec, 0x28, 0xe8 };
        const bridge_suffix = [_]u8{ 0x90, 0x48, 0x83, 0xc4, 0x28, 0xc3 };
        if (!std.mem.eql(u8, &loaded_leaf, &leaf_bytes) or !std.mem.eql(u8, loaded_bridge[0..5], &bridge_prefix)
            or !std.mem.eql(u8, loaded_bridge[9..15], &bridge_suffix)) return false;
        const displacement = std.mem.readInt(i32, loaded_bridge[5..9], .little);
        const target = @as(i128, @intFromPtr(bridge)) + 9 + @as(i128, displacement);
        return target == @as(i128, @intFromPtr(leaf));
    }
    pub fn admitted(_: *const Counter) bool { return certificate.qualified and machineMatches(); }
    pub fn instructionBound(_: *const Counter) u64 { return certificate.instruction_upper_bound; }
    // Bounds are emitted only from the exact current caller's machine proof.
    // Each includes its incoming return address; caller-owned shadow already
    // present in the measured baseline is not added for a second time.
    pub fn runStackBytes(_: *const Counter) ?usize {
        if (!@hasDecl(certificate, "run_stack_bytes")) return null;
        return if (certificate.run_stack_bytes != 0) certificate.run_stack_bytes else null;
    }
    pub fn admissionStackBytes(_: *const Counter) ?usize {
        if (!@hasDecl(certificate, "admission_stack_bytes")) return null;
        return if (certificate.admission_stack_bytes != 0) certificate.admission_stack_bytes else null;
    }
    pub fn executionStackBytes(_: *const Counter) ?usize {
        if (!@hasDecl(certificate, "execute_stack_bytes")) return null;
        return if (certificate.execute_stack_bytes != 0) certificate.execute_stack_bytes else null;
    }
    // Bridge incoming return8 + its allocation40 (including shadow32) + leaf
    // incoming return8. The current execute frame is already administrative.
    pub fn boundaryBytes(_: *const Counter) usize { return 56; }
    pub inline fn boundaryStackAvailable(_: *const Counter) bool {
        const snapshot = StackSnapshot.read();
        return snapshot.valid() and 56 <= snapshot.pointer - snapshot.limit;
    }
    pub inline fn call(self: *Counter, bits: u32) u32 {
        return tsfg_host_counter_bridge(self, bits);
    }
};

comptime {
    if (@sizeOf(Counter) != semantics.context_bytes or @alignOf(Counter) != semantics.context_alignment or
        @offsetOf(Counter, "storage") != 0 or @offsetOf(Counter, "reserved") != 4 or @offsetOf(Counter, "events") != 8)
        @compileError("counter ABI differs from certified uint32/reserved/uint64 layout");
}

test "active stack intervals are counted once and straddling fails closed" {
    const snapshot: StackSnapshot = .{ .base = 10000, .pointer = 8000, .limit = 1000 };
    try std.testing.expectEqual(@as(?usize, 2000), snapshot.activeBytes());
    try std.testing.expectEqual(@as(?usize, 0), snapshot.outsideBytes(8016, 16));
    try std.testing.expectEqual(@as(?usize, 16), snapshot.outsideBytes(10000, 16));
    try std.testing.expectEqual(@as(?usize, 16), snapshot.outsideBytes(984, 16));
    try std.testing.expectEqual(@as(?usize, null), snapshot.outsideBytes(9992, 16));
    try std.testing.expectEqual(@as(?usize, null), snapshot.outsideBytes(992, 16));
    try std.testing.expectEqual(@as(?usize, null), snapshot.outsideBytes(7992, 16));
    try std.testing.expectEqual(@as(?usize, null), snapshot.outsideBytes(0, 16));
    try std.testing.expectEqual(@as(?usize, null), snapshot.outsideBytes(std.math.maxInt(usize) - 8, 16));
}
test "stack envelope exact thresholds include future storage without overflow" {
    const snapshot: StackSnapshot = .{ .base = 10000, .pointer = 8000, .limit = 1000 };
    try std.testing.expect(snapshot.admits(56, 16, 2072));
    try std.testing.expect(!snapshot.admits(56, 16, 2071));
    try std.testing.expect(snapshot.admits(7000, 16, 9016));
    try std.testing.expect(!snapshot.admits(7001, 16, 9017));
    try std.testing.expect(!snapshot.admits(56, std.math.maxInt(usize), std.math.maxInt(usize)));
    const backwards: StackSnapshot = .{ .base = 7999, .pointer = 8000, .limit = 1000 };
    try std.testing.expect(!backwards.admits(0, 0, std.math.maxInt(usize)));
    const below_limit: StackSnapshot = .{ .base = 10000, .pointer = 999, .limit = 1000 };
    try std.testing.expect(!below_limit.admits(0, 0, std.math.maxInt(usize)));
    const empty: StackSnapshot = .{ .base = 0, .pointer = 0, .limit = 0 };
    try std.testing.expect(!empty.valid());
}
test "current thread NT_TIB stack snapshot has ordered bounds" {
    const snapshot = StackSnapshot.read();
    try std.testing.expect(snapshot.valid());
    try std.testing.expect(snapshot.activeBytes().? != 0);
    try std.testing.expect(snapshot.admits(0, 0, snapshot.activeBytes().?));
}
