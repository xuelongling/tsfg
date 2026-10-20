// SPDX-License-Identifier: MIT
const std = @import("std");
const m = @import("nullable-model.zig");
const path_rules = @import("module_format.zig");
const Reader = m.Reader;
const Allocator = m.Allocator;
// role/reserved + hashes + nonempty string + range + type/count +
// register/block/instruction counts + one block + one instruction base.
const minimum_function_bytes = 4 + 3 * 32 + 5 + 8 + 2 + 6 + 4 + 16;

fn encodedRecords(reader: *Reader, count: usize, comptime minimum: usize) error{Invalid}!void {
    // Divide remaining bytes, never multiply untrusted counts.
    if (count > (reader.bytes.len - reader.offset) / minimum) return reader.reject("r04-nullable-limit");
}

fn operands(reader: *Reader, allocator: Allocator, limit: usize) m.Error![]const u16 {
    const count = try reader.int(u16);
    if (count > limit or count > (reader.bytes.len - reader.offset) / 2) return reader.reject("r04-nullable-limit");
    const values = try allocator.alloc(u16, count);
    for (values) |*value| value.* = try reader.int(u16);
    return values;
}
fn known(opcode: u8) bool {
    return (opcode >= 1 and opcode <= 28) or opcode == 32 or opcode == 33 or (opcode >= 240 and opcode <= 244);
}
fn function(reader: *Reader, allocator: Allocator, source: m.Hash, path: []const u8, length: u32) m.Error!m.Function {
    const role = try reader.int(u8);
    if (role > 1) return reader.reject("r04-nullable-role");
    for (0..3) |_| try reader.expected(u8, 0);
    const id = try reader.digest();
    const signature = try reader.digest();
    const type_id = try reader.digest();
    const name = try reader.string(256);
    const start = try reader.int(u32);
    const end = try reader.int(u32);
    if (start >= end or end > length) return reader.reject("r04-nullable-range");
    const return_type = try reader.int(u8);
    if (!m.valid(return_type)) return reader.reject("r04-nullable-type");
    const count = try reader.int(u8);
    if (count > 64) return reader.reject("r04-nullable-limit");
    const parameters = try reader.take(count);
    for (parameters) |code| if (!m.valid(code)) return reader.reject("r04-nullable-type");
    if (role == 0) {
        if (!m.scalar.validType(return_type)) return reader.reject("r04-nullable-role");
        for (parameters) |code| if (!m.scalar.validType(code)) return reader.reject("r04-nullable-role");
    }
    if (!std.mem.eql(u8, &type_id, &(try m.typeHash(allocator, return_type))) or
        !std.mem.eql(u8, &signature, &(try m.signatureHash(allocator, parameters, return_type))) or
        !std.mem.eql(u8, &id, &(try m.functionHash(allocator, name, signature, source, path))))
        return reader.reject("r04-nullable-identity");
    const register_count = try reader.int(u16);
    const block_count = try reader.int(u16);
    const instruction_count = try reader.int(u16);
    if (register_count == 0 or register_count > 4096 or block_count == 0 or block_count > 256 or
        instruction_count == 0 or instruction_count > 8192 or block_count > instruction_count)
        return reader.reject("r04-nullable-limit");
    try encodedRecords(reader, block_count, 4); // u16 parameter count + u16 instruction count
    const blocks = try allocator.alloc(m.Block, block_count);
    var total: usize = 0;
    for (blocks, 0..) |*block, index| {
        const size = try reader.int(u16);
        if (size > register_count or (index == 0 and size != count)) return reader.reject("r04-nullable-cfg");
        try encodedRecords(reader, size, 4); // register:u16, type:u8, reserved:u8
        const args = try allocator.alloc(m.Parameter, size);
        for (args, 0..) |*argument, i| {
            argument.* = .{ .register = try reader.int(u16), .type_code = try reader.int(u8) };
            try reader.expected(u8, 0);
            if (!m.valid(argument.type_code) or (index == 0 and argument.type_code != parameters[i])) return reader.reject("r04-nullable-type");
        }
        const size_ops = try reader.int(u16);
        if (size_ops == 0 or size_ops > instruction_count - total) return reader.reject("r04-nullable-cfg");
        block.* = .{ .parameters = args, .start = total, .count = size_ops };
        total += size_ops;
    }
    if (total != instruction_count) return reader.reject("r04-nullable-cfg");
    try encodedRecords(reader, instruction_count, 16); // fixed instruction prefix; extensions only add bytes
    const instructions = try allocator.alloc(m.Instruction, instruction_count);
    const types = try allocator.alloc(u8, register_count);
    var next: usize = 0;
    for (blocks) |block| {
        for (block.parameters) |parameter| {
            if (next >= register_count or parameter.register != next) return reader.reject("r04-nullable-register");
            types[next] = parameter.type_code;
            next += 1;
        }
        for (instructions[block.start..][0..block.count]) |*op| {
            const opcode = try reader.int(u8);
            const code = try reader.int(u8);
            const reg = try reader.int(u16);
            const immediate = try reader.int(u32);
            const a = try reader.int(u32);
            const b = try reader.int(u32);
            if (!known(opcode)) return reader.reject("r04-nullable-opcode");
            if (a < start or a >= b or b > end) return reader.reject("r04-nullable-range");
            op.* = .{ .opcode = opcode, .type_code = code, .register = reg, .immediate = immediate, .source_start = a, .source_end = b };
            if (m.result(opcode)) {
                if (!m.valid(code) or next >= register_count or reg != next) return reader.reject("r04-nullable-register");
                types[next] = code;
                next += 1;
            } else if (opcode == 2) {
                if (code != return_type or immediate != 0) return reader.reject("r04-nullable-type");
            } else if (opcode == 25) {
                if (code != 2) return reader.reject("r04-nullable-type");
            } else if (code != 0 or reg != 0) return reader.reject("r04-nullable-type");
            if (opcode == 28 or opcode == 32) op.literal_bits = try reader.int(u64);
            if (opcode == 24 or opcode == 25) {
                op.edges[0] = try operands(reader, allocator, register_count);
                if (opcode == 25) op.edges[1] = try operands(reader, allocator, register_count);
            } else if (opcode == 27) op.edges[0] = try operands(reader, allocator, 64);
        }
    }
    if (next != register_count) return reader.reject("r04-nullable-register");
    return .{ .role = role, .id = id, .signature = signature, .type_id = type_id, .name = name, .start = start, .end = end, .return_type = return_type, .parameter_types = parameters, .register_count = register_count, .blocks = blocks, .register_types = types, .instructions = instructions };
}

pub fn parse(reader: *Reader, allocator: Allocator) m.Error!m.Snapshot {
    if (reader.bytes.len > 1048576) return reader.reject("r04-nullable-limit");
    if (reader.bytes.len < 80) return reader.reject("r04-nullable-truncated");
    if (!std.mem.eql(u8, try reader.take(8), "TSFGNUL1")) return reader.reject("r04-nullable-magic");
    try reader.expected(u32, 1);
    if (!std.mem.eql(u8, &(try reader.digest()), &m.schema)) return reader.reject("r04-nullable-schema");
    try reader.expected(u32, @intCast(reader.bytes.len));
    const digest = try reader.digest();
    if (!std.mem.eql(u8, &digest, &m.hash(reader.bytes[80..]))) return reader.reject("r04-nullable-integrity");
    const target = try reader.text(m.scalar.target);
    const triple = try reader.text(m.scalar.triple);
    const layout = try reader.text(m.scalar.data_layout);
    try reader.expected(u16, 4);
    try reader.expected(u16, 4);
    try reader.expected(u16, 64);
    try reader.expected(u16, 8);
    try reader.expected(u32, 0);
    const identity = try reader.digest();
    const source = try reader.digest();
    const path = try reader.string(4096);
    if (!path_rules.validSourcePath(path, false)) return reader.reject("r04-nullable-source");
    const length = try reader.int(u32);
    try reader.expected(u8, 0);
    const count = try reader.int(u16);
    if (count == 0 or count > 512) return reader.reject("r04-nullable-limit");
    try encodedRecords(reader, count, minimum_function_bytes);
    const functions = try allocator.alloc(m.Function, count);
    var entry: ?usize = null;
    for (functions, 0..) |*fnc, i| {
        fnc.* = try function(reader, allocator, source, path, length);
        if (fnc.role == 0) {
            if (entry != null) return reader.reject("r04-nullable-role");
            entry = i;
        }
        for (functions[0..i]) |previous| if (std.mem.eql(u8, &previous.id, &fnc.id) or std.mem.eql(u8, previous.name, fnc.name))
            return reader.reject("r04-nullable-identity");
    }
    if (reader.offset != reader.bytes.len) return reader.reject("r04-nullable-trailing");
    return .{ .packet_bytes = reader.bytes.len, .target = target, .triple = triple, .data_layout = layout, .input_identity = identity, .source_hash = source, .source_path = path, .source_length = length, .entry_index = entry orelse return reader.reject("r04-nullable-role"), .functions = functions };
}
