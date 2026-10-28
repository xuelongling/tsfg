// SPDX-License-Identifier: MIT
// Per-activation roots and parallel edge transfers, separate from scalar bits.
const std = @import("std");
const values = @import("string-value.zig");
pub const Roots = struct {
    owner: *values.Owner,
    registers: []?values.Handle,
    transfer: []?values.Handle,

    pub fn init(allocator: std.mem.Allocator, owner: *values.Owner, count: usize, parameters: usize) !Roots {
        const registers = try allocator.alloc(?values.Handle, count);
        errdefer allocator.free(registers);
        const transfer = try allocator.alloc(?values.Handle, parameters);
        @memset(registers, null);
        @memset(transfer, null);
        return .{ .owner = owner, .registers = registers, .transfer = transfer };
    }
    pub fn deinit(self: *Roots, allocator: std.mem.Allocator) void {
        for (self.registers) |handle| if (handle) |root| self.owner.heap.release(root) catch unreachable;
        for (self.transfer) |handle| if (handle) |root| self.owner.heap.release(root) catch unreachable;
        allocator.free(self.registers);
        allocator.free(self.transfer);
    }
    // On success consumes a newly owned root. Publication cannot fail.
    pub fn install(self: *Roots, register: u16, owned: values.Handle) void {
        if (self.registers[register]) |old| self.owner.heap.release(old) catch unreachable;
        self.registers[register] = owned;
    }
    pub fn copy(self: *Roots, register: u16, source: values.Handle) !void {
        const kept = try self.owner.heap.retain(source, .persistent);
        self.install(register, kept);
    }
    // Reserve every edge source before overwriting any destination. Failure
    // releases all temporary roots and leaves the original activation intact.
    pub fn branch(self: *Roots, arguments: []const u16, parameters: anytype) !void {
        var prepared: usize = 0;
        errdefer for (self.transfer[0..prepared]) |*root| {
            if (root.*) |handle| self.owner.heap.release(handle) catch unreachable;
            root.* = null;
        };
        for (arguments, parameters, 0..) |argument, parameter, i| {
            if (parameter.type_code == 14) self.transfer[i] = try self.owner.heap.retain(self.registers[argument].?, .persistent);
            prepared += 1;
        }
        for (parameters, 0..) |parameter, i| if (parameter.type_code == 14) {
            self.install(parameter.register, self.transfer[i].?);
            self.transfer[i] = null;
        };
    }
};

pub fn execute(roots: *Roots, scalars: []u64, op: @import("bytecode_model.zig").Instruction) !void {
    const heap = &roots.owner.heap;
    // Every active value is represented in the heap's root table. Collect at
    // allocation boundaries so loop iterations do not accumulate dead payloads;
    // collector temporaries obey the same physical request memory bound.
    if (op.opcode == 34 or op.opcode == 35 or op.opcode == 38) try heap.collect();
    if (op.opcode == 34) roots.install(op.register, try heap.createString(op.code_units, .persistent))
    else if (op.opcode == 35) roots.install(op.register, try heap.concatStrings(roots.registers[op.left].?, roots.registers[op.right].?, .persistent))
    else if (op.opcode == 36) scalars[op.register] = try heap.stringLength(roots.registers[op.left].?)
    else if (op.opcode == 37) scalars[op.register] = try heap.readStringCodeUnit(roots.registers[op.left].?, @intCast(scalars[op.right]))
    else if (op.opcode == 38) roots.install(op.register, try heap.sliceString(roots.registers[op.left].?, @intCast(scalars[op.right]), @intCast(scalars[op.third]), .persistent))
    else if (op.opcode == 39) {
        const order = try heap.compareStrings(roots.registers[op.left].?, roots.registers[op.right].?);
        const value: i32 = if (order == .lt) -1 else if (order == .gt) 1 else 0;
        scalars[op.register] = @as(u32, @bitCast(value));
    } else unreachable;
}
