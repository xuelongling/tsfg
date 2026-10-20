// SPDX-License-Identifier: MIT
// Independently verifies typed SSA, complete calls and semantic-fuel CFG legality.
const std = @import("std");
const m = @import("nullable-model.zig");
pub const Graph = struct { successors: [][2]?u16, definitions: []const u16 };
const Definitions = struct { blocks: []u16, positions: []usize, dominators: [][4]u64 };

fn use(reader: *m.Reader, fnc: m.Function, defs: Definitions, reg: u16, expected: u8, block: usize, position: usize) m.Error!void {
    if (reg >= fnc.register_count) return reader.reject("r04-nullable-register");
    if (expected == 0 or fnc.register_types[reg] != expected) return reader.reject("r04-nullable-type");
    const owner = defs.blocks[reg];
    if ((owner == block and defs.positions[reg] > position) or
        defs.dominators[block][owner / 64] & (@as(u64, 1) << @as(u6, @intCast(owner % 64))) == 0)
        return reader.reject("r04-nullable-dominance");
}
fn edge(reader: *m.Reader, fnc: m.Function, defs: Definitions, target: u16, args: []const u16, block: usize, position: usize) m.Error!void {
    if (target == 0 or target >= fnc.blocks.len) return reader.reject("r04-nullable-cfg");
    const parameters = fnc.blocks[target].parameters;
    if (args.len != parameters.len) return reader.reject("r04-nullable-cfg");
    for (args, parameters) |arg, parameter| try use(reader, fnc, defs, arg, parameter.type_code, block, position);
}
fn operation(reader: *m.Reader, fnc: m.Function, all: []const m.Function, defs: Definitions, op: m.Instruction, block: usize, position: usize) m.Error!void {
    const lo: u16 = @truncate(op.immediate);
    const hi: u16 = @truncate(op.immediate >> 16);
    const code = op.type_code;
    const opcode = op.opcode;
    if (opcode == 1) {
        if (code != 1) return reader.reject("r04-nullable-type");
    } else if (opcode == 3) {
        if (code != 2 or op.immediate > 1) return reader.reject("r04-nullable-type");
    } else if (opcode == 28 or opcode == 32) {
        const valid = if (opcode == 28) m.scalar.integerType(code) and code >= 3 else m.scalar.floatType(code);
        if (!valid or op.immediate != 0 or op.literal_bits & ~m.scalar.mask(code) != 0) return reader.reject("r04-nullable-type");
    } else if (opcode >= 4 and opcode <= 23 or opcode == 33) {
        if (lo >= fnc.register_count) return reader.reject("r04-nullable-register");
        const operand = fnc.register_types[lo];
        const integer = m.scalar.integerType(operand);
        const floating = m.scalar.floatType(operand);
        const unary = opcode >= 15 and opcode <= 17 or opcode == 33;
        if (opcode == 17) {
            if (operand != 2) return reader.reject("r04-nullable-type");
        } else if (opcode == 33) {
            if (!floating) return reader.reject("r04-nullable-type");
        } else if (opcode == 18 or opcode == 19) {
            if (!m.scalar.validType(operand)) return reader.reject("r04-nullable-type");
        } else if (!integer and !(floating and (opcode <= 8 or opcode == 15 or opcode >= 20))) return reader.reject("r04-nullable-type");
        const result_type: u8 = if (opcode >= 17 and opcode <= 23) 2 else operand;
        if (code != result_type or unary and hi != 0) return reader.reject("r04-nullable-type");
        try use(reader, fnc, defs, lo, operand, block, position);
        if (!unary) try use(reader, fnc, defs, hi, if (opcode >= 9 and opcode <= 11) 1 else operand, block, position);
    } else if (opcode == 2) {
        try use(reader, fnc, defs, op.register, fnc.return_type, block, position);
    } else if (opcode == 24 or opcode == 25) {
        if (opcode == 24 and hi != 0) return reader.reject("r04-nullable-cfg");
        if (opcode == 25) try use(reader, fnc, defs, op.register, 2, block, position);
        try edge(reader, fnc, defs, lo, op.edges[0], block, position);
        if (opcode == 25) try edge(reader, fnc, defs, hi, op.edges[1], block, position);
    } else if (opcode == 27) {
        if (hi != 0 or lo >= all.len) return reader.reject("r04-nullable-call");
        const target = all[lo];
        if (code != target.return_type or op.edges[0].len != target.parameter_types.len) return reader.reject("r04-nullable-call");
        for (op.edges[0], target.parameter_types) |arg, parameter| try use(reader, fnc, defs, arg, parameter, block, position);
    } else if (opcode >= 240 and opcode <= 244) {
        if (opcode == 241) {
            if (!m.nullable(code) or op.immediate < 1 or op.immediate > 2 or
                m.allowed(code) & (@as(u8, 1) << @as(u3, @intCast(op.immediate))) == 0)
                return reader.reject("r04-nullable-type");
            return;
        }
        if (lo >= fnc.register_count) return reader.reject("r04-nullable-register");
        const operand = fnc.register_types[lo];
        if (opcode == 240) {
            if (!m.nullable(code) or hi != 0) return reader.reject("r04-nullable-type");
            try use(reader, fnc, defs, lo, 1, block, position);
        } else {
            if (!m.nullable(operand) or (opcode == 242 and (code != 2 or hi > 2)) or
                (opcode == 243 and (code != 1 or hi != 0)) or
                (opcode == 244 and (!m.nullable(code) or hi != 0))) return reader.reject("r04-nullable-type");
            try use(reader, fnc, defs, lo, operand, block, position);
        }
    }
}

pub fn verify(reader: *m.Reader, allocator: m.Allocator, fnc: m.Function, all: []const m.Function) m.Error!Graph {
    const count = fnc.blocks.len;
    if (count * @as(usize, fnc.register_count) > 1048576) return reader.reject("r04-nullable-limit");
    const successors = try allocator.alloc([2]?u16, count);
    const has_fuel = try allocator.alloc(bool, count);
    const defs: Definitions = .{ .blocks = try allocator.alloc(u16, fnc.register_count), .positions = try allocator.alloc(usize, fnc.register_count), .dominators = try allocator.alloc([4]u64, count) };
    var entries: usize = 0;
    for (fnc.blocks, 0..) |block, index| {
        successors[index] = .{ null, null };
        has_fuel[index] = false;
        for (block.parameters) |parameter| {
            defs.blocks[parameter.register] = @intCast(index);
            defs.positions[parameter.register] = 0;
        }
        for (fnc.instructions[block.start..][0..block.count], 0..) |op, position| {
            if (m.result(op.opcode)) {
                defs.blocks[op.register] = @intCast(index);
                defs.positions[op.register] = position + 1;
            }
            const terminal = op.opcode == 2 or op.opcode == 24 or op.opcode == 25;
            if (terminal != (position + 1 == block.count)) return reader.reject("r04-nullable-cfg");
            if (op.opcode == 26) {
                if (position != 0) return reader.reject("r04-nullable-fuel");
                if (op.immediate == 1) {
                    if (index != 0 or op.source_start != fnc.start or op.source_end != fnc.end) return reader.reject("r04-nullable-fuel");
                    entries += 1;
                } else if (op.immediate == 2 and index != 0) has_fuel[index] = true else return reader.reject("r04-nullable-fuel");
            }
            if (op.opcode == 24 or op.opcode == 25) {
                successors[index][0] = @truncate(op.immediate);
                if (op.opcode == 25) successors[index][1] = @truncate(op.immediate >> 16);
                for (successors[index]) |target| if (target) |to| {
                    if (to == 0 or to >= count) return reader.reject("r04-nullable-cfg");
                };
            }
        }
    }
    if (entries != 1 or fnc.instructions[0].opcode != 26) return reader.reject("r04-nullable-fuel");
    const reached = try allocator.alloc(bool, count);
    @memset(reached, false);
    reached[0] = true;
    var changed = true;
    while (changed) {
        changed = false;
        for (successors, 0..) |targets, from| if (reached[from]) {
            for (targets) |target| if (target) |to| if (!reached[to]) {
                reached[to] = true;
                changed = true;
            };
        };
    }
    for (reached) |live| if (!live) return reader.reject("r04-nullable-cfg");
    for (defs.dominators, 0..) |*value, index| value.* = if (index == 0) .{ 1, 0, 0, 0 } else .{ std.math.maxInt(u64), std.math.maxInt(u64), std.math.maxInt(u64), std.math.maxInt(u64) };
    changed = true;
    while (changed) {
        changed = false;
        for (1..count) |block| {
            var next = [_]u64{std.math.maxInt(u64)} ** 4;
            for (successors, 0..) |targets, from| for (targets) |target| if (target == @as(?u16, @intCast(block))) {
                for (0..4) |word| next[word] &= defs.dominators[from][word];
            };
            next[block / 64] |= @as(u64, 1) << @as(u6, @intCast(block % 64));
            for (0..4) |word| if (next[word] != defs.dominators[block][word]) {
                defs.dominators[block][word] = next[word];
                changed = true;
            };
        }
    }
    for (fnc.blocks, 0..) |block, index| for (fnc.instructions[block.start..][0..block.count], 0..) |op, position|
        try operation(reader, fnc, all, defs, op, index, position);
    const incoming = try allocator.alloc(u16, count);
    @memset(incoming, 0);
    var uncharged: usize = 0;
    for (successors, 0..) |targets, from| if (!has_fuel[from]) {
        uncharged += 1;
        for (targets) |target| if (target) |to| if (!has_fuel[to]) {
            incoming[to] += 1;
        };
    };
    const removed = try allocator.alloc(bool, count);
    @memset(removed, false);
    var total: usize = 0;
    changed = true;
    while (changed) {
        changed = false;
        for (successors, 0..) |targets, from| if (!has_fuel[from] and !removed[from] and incoming[from] == 0) {
            removed[from] = true;
            total += 1;
            changed = true;
            for (targets) |target| if (target) |to| if (!has_fuel[to]) {
                incoming[to] -= 1;
            };
        };
    }
    if (total != uncharged) return reader.reject("r04-nullable-fuel");
    return .{ .successors = successors, .definitions = defs.blocks };
}
