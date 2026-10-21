// SPDX-License-Identifier: MIT
// Formal wire String decoding and typed operands; never evaluates a guest.
const std = @import("std");
const Instruction = @import("bytecode_model.zig").Instruction;
pub const Operand = struct { register: u16, type_code: u8 };

pub fn decode(reader: anytype, allocator: std.mem.Allocator, op: *Instruction, total: *usize) !void {
    const expected: u8 = switch (op.opcode) { 34, 35, 38 => 14, 36 => 11, 37 => 7, 39 => 1, else => unreachable };
    if (op.type_code != expected) return reader.reject("r04-type", reader.offset);
    if (op.opcode == 34) {
        const count: u32 = @bitCast(op.immediate);
        if (count > 16384 or count > 65536 - total.* or count > (reader.bytes.len - reader.offset) / 2)
            return reader.reject("r04-string-limit", reader.offset);
        const units = try allocator.alloc(u16, count);
        for (units) |*unit| unit.* = try reader.int(u16);
        op.code_units = units;
        total.* += count;
    } else if (op.opcode == 36 and op.right != 0) {
        return reader.reject("r04-reserved", reader.offset);
    } else if (op.opcode == 38) op.third = try reader.int(u16);
}

pub fn operands(op: Instruction, out: *[3]Operand) []const Operand {
    if (op.opcode == 34) return out[0..0];
    out[0] = .{ .register = op.left, .type_code = 14 };
    if (op.opcode == 36) return out[0..1];
    out[1] = .{ .register = op.right, .type_code = if (op.opcode == 37 or op.opcode == 38) 11 else 14 };
    if (op.opcode != 38) return out[0..2];
    out[2] = .{ .register = op.third, .type_code = 11 };
    return out[0..3];
}
