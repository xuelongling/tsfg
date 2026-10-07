// SPDX-License-Identifier: MIT
const std = @import("std");
const builtin = @import("builtin");
pub const contract = @import("contract.zig");
const Allocator = std.mem.Allocator;
const Sha256 = std.crypto.hash.sha2.Sha256;
pub const module_format = @import("module_format.zig");

pub const FunctionId = [32]u8;
pub const VerifiedModule = opaque {};
pub const Source = module_format.Source;
pub const ModuleInfo = struct {
    function_id: FunctionId,
    function_name: []const u8,
    source: Source,
    input_identity: [32]u8,
    signature_hash: [32]u8,
    type_id: [32]u8,
    source_utf16_length: u32,
    function_start: u32,
    function_end: u32,
    return_type: u8,
    register_count: u16,
    instruction_count: u16,
    instruction_offset: usize,
    block_count: u16,
    parameter_types: []const u8 = &.{},
    source_index: u16 = 0,
    initializer: bool = false,
};
pub const Instruction = struct {
    opcode: u8,
    type_code: u8,
    register: u16,
    immediate: i32,
    literal_bits: u64 = 0,
    left: u16,
    right: u16,
    source: Source,
    edges: [2][]const u16 = .{ &.{}, &.{} },
};
pub const Parameter = struct { register: u16, type_code: u8 };
pub const Block = struct { parameters: []const Parameter, start: usize, count: u16 };
pub const Function = struct { info: ModuleInfo, instructions: []const Instruction, blocks: []const Block, register_types: []const u8 };
const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, info: ModuleInfo, functions: []Function, tables: module_format.Tables = .{} };
const Global = struct { input_identity: [32]u8, source_hash: [32]u8, source_path: []const u8, source_length: u32 };
pub const LoadFailure = struct { code: []const u8, offset: usize };
pub const LoadOutcome = union(enum) { loaded: *VerifiedModule, rejected: LoadFailure };

const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    failure: LoadFailure = .{ .code = "r04-truncated", .offset = 0 },

    pub fn reject(self: *Reader, code: []const u8, offset: usize) error{Invalid} {
        self.failure = .{ .code = code, .offset = offset };
        return error.Invalid;
    }
    fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
        if (count > self.bytes.len - self.offset) return self.reject("r04-truncated", self.offset);
        const result = self.bytes[self.offset..][0..count];
        self.offset += count;
        return result;
    }
    pub fn int(self: *Reader, comptime T: type) error{Invalid}!T {
        const bytes = try self.take(@sizeOf(T));
        return std.mem.readInt(T, bytes[0..@sizeOf(T)], .little);
    }
    pub fn digest(self: *Reader) error{Invalid}![32]u8 {
        return (try self.take(32))[0..32].*;
    }
    pub fn string(self: *Reader, maximum: u32) error{Invalid}![]const u8 {
        const start = self.offset;
        const count = try self.int(u32);
        if (count == 0 or count > maximum) return self.reject("r04-string", start);
        const bytes = try self.take(count);
        if (!std.unicode.utf8ValidateSlice(bytes) or std.mem.indexOfScalar(u8, bytes, 0) != null)
            return self.reject("r04-string", start);
        return bytes;
    }
    fn expected(self: *Reader, comptime T: type, value: T, code: []const u8) error{Invalid}!void {
        const start = self.offset;
        if (try self.int(T) != value) return self.reject(code, start);
    }
    fn expectedString(self: *Reader, value: []const u8, code: []const u8) error{Invalid}!void {
        const start = self.offset;
        if (!std.mem.eql(u8, try self.string(4096), value)) return self.reject(code, start);
    }
};

fn hash(bytes: []const u8) [32]u8 {
    var digest: [32]u8 = undefined;
    Sha256.hash(bytes, &digest, .{});
    return digest;
}

fn rangeValid(start: u32, end: u32, lower: u32, upper: u32) bool {
    return lower <= start and start < end and end <= upper;
}

fn parse(reader: *Reader, allocator: Allocator, module: *Module) (error{Invalid} || Allocator.Error)!ModuleInfo {
    if (reader.bytes.len > contract.max_bytes) return reader.reject("r04-size", 0);
    if (!std.mem.eql(u8, try reader.take(8), "TSFGTBC0")) return reader.reject("r04-magic", 0);
    try reader.expected(u32, contract.version, "r04-version");
    if (!std.mem.eql(u8, &(try reader.digest()), &contract.schema_hash)) return reader.reject("r04-schema", 12);
    try reader.expected(u32, @intCast(reader.bytes.len), "r04-size");
    const payload_hash = try reader.digest();
    if (!std.mem.eql(u8, &payload_hash, &hash(reader.bytes[80..]))) return reader.reject("r04-integrity", 48);
    try reader.expectedString(contract.target, "r04-target");
    try reader.expectedString(contract.triple, "r04-target");
    try reader.expectedString(contract.data_layout, "r04-layout");
    if (builtin.os.tag != .windows or builtin.cpu.arch != .x86_64) return reader.reject("r04-target", 80);
    try reader.expected(u16, @sizeOf(i32), "r04-layout");
    try reader.expected(u16, @alignOf(i32), "r04-layout");
    try reader.expected(u16, @bitSizeOf(usize), "r04-layout");
    try reader.expected(u16, @alignOf(usize), "r04-layout");
    try reader.expected(u32, 18, "r04-capability");
    const input_identity = try reader.digest();
    const source_hash = try reader.digest();
    const source_path = try reader.string(4096);
    // A leading slash is the official frontend's logical source root, never
    // an instruction to open a host filesystem path. Preserve it in IDs/maps.
    if (std.mem.indexOfAny(u8, source_path, "\\:") != null) return reader.reject("r04-source", reader.offset - source_path.len);
    const logical_path = if (source_path[0] == '/') source_path[1..] else source_path;
    var components = std.mem.splitScalar(u8, logical_path, '/');
    while (components.next()) |component| {
        if (component.len == 0 or std.mem.eql(u8, component, ".") or std.mem.eql(u8, component, "..")) return reader.reject("r04-source", reader.offset - source_path.len);
    }
    if (source_path[0] != '/' or !std.mem.endsWith(u8, source_path, ".ts") or std.mem.endsWith(u8, source_path, ".d.ts")) return reader.reject("r04-source", reader.offset);
    const source_length = try reader.int(u32);
    module.tables = try module_format.parse(reader, allocator);
    if (module.tables.present) {
        var matched = false;
        for (module.tables.sources) |source| if (std.mem.eql(u8, source.path, source_path)) {
            if (!std.mem.eql(u8, &source.hash, &source_hash) or source.length != source_length) return reader.reject("r04-module-source", reader.offset);
            matched = true;
        };
        if (!matched) return reader.reject("r04-module-source", reader.offset);
    }
    const count = try reader.int(u16);
    if (count < 1 or count > 256) return reader.reject("r04-function-count", reader.offset - 2);
    module.functions = try allocator.alloc(Function, count);
    const global: Global = .{ .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = source_length };
    for (module.functions, 0..) |*function, index| {
        function.* = try parseFunction(reader, allocator, global, module.tables);
        for (module.functions[0..index]) |previous| if (std.mem.eql(u8, &previous.info.function_id, &function.info.function_id) or previous.info.source_index == function.info.source_index and std.mem.eql(u8, previous.info.function_name, function.info.function_name)) return reader.reject("r04-function", reader.offset);
    }
    if (reader.offset != reader.bytes.len) return reader.reject("r04-trailing", reader.offset);
    for (module.functions) |function| for (function.instructions) |op| if (op.opcode == 27) {
        if (op.left >= count) return reader.reject("r04-call-target", function.info.instruction_offset);
        const target = module.functions[op.left];
        if (op.type_code != target.info.return_type) return reader.reject("r04-type", function.info.instruction_offset);
        if (op.edges[0].len != target.info.parameter_types.len) return reader.reject("r04-call-arity", function.info.instruction_offset);
        for (op.edges[0], target.info.parameter_types) |argument, type_code| if (function.register_types[argument] != type_code) return reader.reject("r04-type", function.info.instruction_offset);
    };
    try module_format.verify(reader, module.tables, module.functions);
    return module.functions[0].info;
}

fn parseFunction(reader: *Reader, allocator: Allocator, global: Global, tables: module_format.Tables) (error{Invalid} || Allocator.Error)!Function {
    const input_identity = global.input_identity;
    var source_hash = global.source_hash;
    var source_path = global.source_path;
    var source_length = global.source_length;
    var source_index: u16 = 0;
    var initializer = false;
    if (tables.present) {
        source_index = try reader.int(u16);
        const marker = try reader.int(u8);
        try reader.expected(u8, 0, "r04-reserved");
        if (source_index >= tables.sources.len or marker > 1) return reader.reject("r04-module-source", reader.offset);
        initializer = marker == 1;
        const source = tables.sources[source_index]; source_hash = source.hash; source_path = source.path; source_length = source.length;
    }
    const function_id = try reader.digest();
    const signature_offset = reader.offset;
    const signature_hash = try reader.digest();
    const type_id = try reader.digest();
    const function_name = try reader.string(4096);
    var function_hash = Sha256.init(.{});
    function_hash.update("tsfg.function\x00");
    function_hash.update(source_path);
    function_hash.update("\x00");
    function_hash.update(function_name);
    function_hash.update("\x00");
    function_hash.update(&std.fmt.bytesToHex(signature_hash, .lower));
    var expected_function_id: [32]u8 = undefined;
    function_hash.final(&expected_function_id);
    const function_start = try reader.int(u32);
    const function_end = try reader.int(u32);
    if (!rangeValid(function_start, function_end, 0, source_length) and !(initializer and function_start == 0 and function_end == 0 and source_length == 0)) return reader.reject("r04-source-range", reader.offset - 8);
    const return_type = try reader.int(u8);
    if (!contract.validType(return_type)) return reader.reject("r04-type", reader.offset - 1);
    const signature_parameter_count = try reader.int(u8);
    if (signature_parameter_count > 64) return reader.reject("r04-signature", reader.offset - 1);
    const parameter_types = try allocator.dupe(u8, try reader.take(signature_parameter_count));
    var signature = Sha256.init(.{});
    signature.update("tsfg.signature\x00(");
    for (parameter_types, 0..) |type_code, index| {
        if (!contract.validType(type_code)) return reader.reject("r04-type", reader.offset);
        if (index != 0) signature.update(",");
        signature.update(contract.typeName(type_code));
    }
    signature.update(")->"); signature.update(contract.typeName(return_type));
    var expected_signature: [32]u8 = undefined;
    signature.final(&expected_signature);
    var type_hash = Sha256.init(.{}); type_hash.update("tsfg.type\x00"); type_hash.update(contract.typeName(return_type));
    var expected_type_id: [32]u8 = undefined; type_hash.final(&expected_type_id);
    if (!std.mem.eql(u8, &signature_hash, &expected_signature)) return reader.reject("r04-signature", signature_offset);
    if (!std.mem.eql(u8, &type_id, &expected_type_id)) return reader.reject("r04-type", signature_offset + 32);
    if (!std.mem.eql(u8, &function_id, &expected_function_id)) return reader.reject("r04-function", signature_offset - 32);
    const register_count = try reader.int(u16);
    if (register_count < 1 or register_count > 4096) return reader.reject("r04-register", reader.offset - 2);
    const block_count = try reader.int(u16);
    if (block_count < 1 or block_count > 256) return reader.reject("r04-block", reader.offset - 2);
    const instruction_count = try reader.int(u16);
    if (instruction_count < 1 or instruction_count > 8192) return reader.reject("r04-instruction-count", reader.offset - 2);
    const blocks = try allocator.alloc(Block, block_count);
    var total: usize = 0;
    for (blocks, 0..) |*block, index| {
        const parameter_count = try reader.int(u16);
        if (parameter_count > register_count or (index == 0 and parameter_count != parameter_types.len)) return reader.reject("r04-block-parameter", reader.offset - 2);
        const parameters = try allocator.alloc(Parameter, parameter_count);
        for (parameters) |*parameter| {
            parameter.register = try reader.int(u16);
            parameter.type_code = try reader.int(u8);
            try reader.expected(u8, 0, "r04-reserved");
            if (!contract.validType(parameter.type_code)) return reader.reject("r04-type", reader.offset - 2);
        }
        if (index == 0) for (parameters, parameter_types) |parameter, type_code| if (parameter.type_code != type_code) return reader.reject("r04-signature", reader.offset);
        const count = try reader.int(u16);
        if (count < 1 or count > instruction_count or total + count > instruction_count) return reader.reject("r04-instruction-count", reader.offset - 2);
        block.* = .{ .parameters = parameters, .start = total, .count = count };
        total += count;
    }
    if (total != instruction_count) return reader.reject("r04-instruction-count", reader.offset);
    const instruction_offset = reader.offset;
    const ops = try allocator.alloc(Instruction, instruction_count);
    var register_types = [_]u8{0} ** 4096;
    var definition_blocks: [4096]u16 = undefined;
    var definition_positions: [4096]usize = undefined;
    var next_register: usize = 0;
    var successors = [_][2]?u16{.{ null, null }} ** 256;
    var has_fuel = [_]bool{false} ** 256;
    for (blocks, 0..) |block, block_index| {
        for (block.parameters) |parameter| {
            if (parameter.register != next_register or next_register >= register_count) return reader.reject("r04-register", reader.offset);
            register_types[next_register] = parameter.type_code;
            definition_blocks[next_register] = @intCast(block_index);
            definition_positions[next_register] = block.start;
            next_register += 1;
        }
        for (ops[block.start..][0..block.count], 0..) |*op, position| {
            const offset = reader.offset;
            const opcode = try reader.int(u8);
            const type_code = try reader.int(u8);
            const reg = try reader.int(u16);
            const payload = try reader.int(u32);
            const start = try reader.int(u32);
            const end = try reader.int(u32);
            if (!rangeValid(start, end, function_start, function_end) and !(initializer and function_start == 0 and function_end == 0 and start == 0 and end == 0)) return reader.reject("r04-source-range", offset + 8);
            const terminator = opcode == 2 or opcode == 24 or opcode == 25;
            if (terminator != (position + 1 == block.count)) return reader.reject("r04-terminator", offset);
            op.* = .{ .opcode = opcode, .type_code = type_code, .register = reg, .immediate = @bitCast(payload), .left = @truncate(payload), .right = @truncate(payload >> 16), .source = .{ .path = source_path, .hash = source_hash, .start = start, .end = end } };
            if (opcode == 24 or opcode == 25) {
                if (type_code != (if (opcode == 24) @as(u8, 0) else 2)) return reader.reject("r04-type", offset + 1);
                if (opcode == 24 and (reg != 0 or payload >> 16 != 0)) return reader.reject("r04-reserved", offset + 2);
                const edge_count: usize = if (opcode == 24) 1 else 2;
                for (0..edge_count) |edge| {
                    const target = if (edge == 0) op.left else op.right;
                    if (target >= block_count or target == 0) return reader.reject("r04-block", offset + 4);
                    successors[block_index][edge] = target;
                    const count = try reader.int(u16);
                    if (count != blocks[target].parameters.len) return reader.reject("r04-edge-arity", reader.offset - 2);
                    const arguments = try allocator.alloc(u16, count);
                    for (arguments) |*argument| argument.* = try reader.int(u16);
                    op.edges[edge] = arguments;
                }
            } else if (opcode == 26) {
                if (type_code != 0 or reg != 0 or (payload != 1 and payload != 2)) return reader.reject("r04-fuel", offset);
                if (payload == 1 and (initializer or block_index != 0 or position != 0)) return reader.reject("r04-entry-fuel", offset);
                if (payload == 1 and (start != function_start or end != function_end)) return reader.reject("r04-source-range", offset + 8);
                if (payload == 2 and (block_index == 0 or position != 0)) return reader.reject("r04-fuel", offset);
                if (payload == 2) has_fuel[block_index] = true;
            } else {
                if (!contract.validType(type_code)) return reader.reject("r04-type", offset + 1);
                if (opcode == 30) {
                    if (!tables.present or op.left >= tables.globals.len or op.right > 1) return reader.reject("r04-module-global", offset);
                } else if (opcode == 2) {
                    if (payload != 0) return reader.reject("r04-reserved", offset + 4);
                    if (type_code != return_type) return reader.reject("r04-type", offset + 1);
                } else {
                    if (opcode < 1 or (opcode > 23 and opcode != 27 and opcode != 28 and opcode != 29 and opcode != 31)) return reader.reject("r04-instruction", offset);
                    if ((opcode == 29 or opcode == 31) and !tables.present) return reader.reject("r04-module-mode", offset);
                    if (reg != next_register or next_register >= register_count) return reader.reject("r04-register", offset + 2);
                    register_types[next_register] = type_code;
                    definition_blocks[next_register] = @intCast(block_index);
                    // Parameters are available at block start; operation results only after execution.
                    definition_positions[next_register] = block.start + position + 1;
                    next_register += 1;
                    if (opcode == 1 or opcode == 3) {
                        if (type_code != (if (opcode == 1) @as(u8, 1) else 2)) return reader.reject("r04-type", offset + 1);
                        if (opcode == 3 and payload > 1) return reader.reject("r04-boolean", offset + 4);
                    } else if (opcode >= 15 and opcode <= 17 and payload >> 16 != 0) return reader.reject("r04-reserved", offset + 6);
                    if (opcode == 28) {
                        if (type_code < 3 or payload != 0) return reader.reject("r04-type", offset + 1);
                        op.literal_bits = try reader.int(u64);
                        if (op.literal_bits & ~contract.mask(type_code) != 0) return reader.reject("r04-integer-range", reader.offset - 8);
                    }
                    if (opcode == 27) {
                        if (payload >> 16 != 0) return reader.reject("r04-reserved", offset + 6);
                        const count = try reader.int(u16);
                        if (count > 64) return reader.reject("r04-call-arity", reader.offset - 2);
                        const arguments = try allocator.alloc(u16, count);
                        for (arguments) |*argument| argument.* = try reader.int(u16);
                        op.edges[0] = arguments;
                    }
                }
            }
        }
    }
    if (next_register != register_count) return reader.reject("r04-register", reader.offset);
    if (!initializer and (ops[0].opcode != 26 or ops[0].immediate != 1)) return reader.reject("r04-entry-fuel", instruction_offset);
    // Reachability and dominance are computed independently of producer verification.
    var reachable = [_]bool{false} ** 256;
    reachable[0] = true;
    var changed = true;
    while (changed) {
        changed = false;
        for (0..block_count) |from| if (reachable[from]) {
            for (successors[from]) |maybe| if (maybe) |to| {
                if (!reachable[to]) {
                    reachable[to] = true;
                    changed = true;
                }
            };
        };
    }
    for (reachable[0..block_count]) |reached| if (!reached) return reader.reject("r04-unreachable", instruction_offset);
    var dominators: [256][4]u64 = undefined;
    for (0..block_count) |block| dominators[block] = if (block == 0) .{ 1, 0, 0, 0 } else .{ std.math.maxInt(u64), std.math.maxInt(u64), std.math.maxInt(u64), std.math.maxInt(u64) };
    changed = true;
    while (changed) {
        changed = false;
        for (1..block_count) |block| {
            var next = [_]u64{std.math.maxInt(u64)} ** 4;
            for (0..block_count) |from| {
                for (successors[from]) |maybe| if (maybe == @as(?u16, @intCast(block))) {
                    for (0..4) |word| next[word] &= dominators[from][word];
                };
            }
            next[block / 64] |= @as(u64, 1) << @as(u6, @intCast(block % 64));
            for (0..4) |word| if (next[word] != dominators[block][word]) {
                dominators[block][word] = next[word];
                changed = true;
            };
        }
    }
    for (blocks, 0..) |block, block_index| {
        for (ops[block.start..][0..block.count], 0..) |op, position| {
            const global_position = block.start + position;
            if (op.opcode == 2 or op.opcode == 25) try use(reader, op.register, op.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if (op.opcode == 30) try use(reader, op.register, op.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if (op.opcode == 31) try use(reader, op.right, 1, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if (op.opcode >= 4 and op.opcode <= 23) {
                if (op.left >= register_count) return reader.reject("r04-register", instruction_offset);
                const operand_type = register_types[op.left];
                if (op.opcode == 17) {
                    if (operand_type != 2) return reader.reject("r04-type", instruction_offset);
                } else if (op.opcode != 18 and op.opcode != 19 and !contract.integerType(operand_type)) return reader.reject("r04-type", instruction_offset);
                if (op.type_code != (if (op.opcode >= 17) @as(u8, 2) else operand_type)) return reader.reject("r04-type", instruction_offset);
                try use(reader, op.left, operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
                if (op.opcode < 15 or op.opcode > 17) try use(reader, op.right, if (op.opcode >= 9 and op.opcode <= 11) 1 else operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            }
            if (op.opcode == 24 or op.opcode == 25) {
                for (0..(if (op.opcode == 24) @as(usize, 1) else 2)) |edge| {
                    const target = if (edge == 0) op.left else op.right;
                    for (op.edges[edge], blocks[target].parameters) |argument, parameter| try use(reader, argument, parameter.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
                }
            }
            if (op.opcode == 27) for (op.edges[0]) |argument| {
                if (argument >= register_count) return reader.reject("r04-register", reader.offset);
                try use(reader, argument, register_types[argument], block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            };
        }
    }
    if (initializer) for (tables.globals, 0..) |global_declaration, global_index| {
        if (global_declaration.source_index != source_index) continue;
        var initialization_block: ?usize = null;
        var initialization_position: usize = 0;
        for (blocks, 0..) |block, block_index| for (ops[block.start..][0..block.count], 0..) |op, position| {
            if (op.opcode == 30 and op.left == global_index and op.right == 1) {
                if (initialization_block != null or op.source.start > global_declaration.start or op.source.end < global_declaration.end) return reader.reject("r04-module-initialization", instruction_offset);
                initialization_block = block_index; initialization_position = block.start + position;
            }
        };
        const definition = initialization_block orelse return reader.reject("r04-module-initialization", instruction_offset);
        for (blocks, 0..) |block, block_index| {
            const last = block.start + block.count - 1;
            if (ops[last].opcode == 2 and (dominators[block_index][definition / 64] & (@as(u64, 1) << @as(u6, @intCast(definition % 64))) == 0 or definition == block_index and initialization_position >= last)) return reader.reject("r04-module-initialization", instruction_offset);
        }
    };
    // Remove all while-event blocks. A cycle in the remaining graph is a path
    // that can run forever without a logical debit, even inside a fuel-bearing SCC.
    var indegree = [_]u16{0} ** 256;
    var no_fuel_count: usize = 0;
    for (0..block_count) |from| if (!has_fuel[from]) {
        no_fuel_count += 1;
        for (successors[from]) |maybe| if (maybe) |to| {
            if (!has_fuel[to]) indegree[to] += 1;
        };
    };
    var removed = [_]bool{false} ** 256;
    var removed_count: usize = 0;
    changed = true;
    while (changed) {
        changed = false;
        for (0..block_count) |from| if (!has_fuel[from] and !removed[from] and indegree[from] == 0) {
            removed[from] = true;
            removed_count += 1;
            changed = true;
            for (successors[from]) |maybe| if (maybe) |to| {
                if (!has_fuel[to]) indegree[to] -= 1;
            };
        };
    }
    if (removed_count != no_fuel_count) return reader.reject("r04-fuel-cycle", instruction_offset);
    return .{ .info = .{ .function_id = function_id, .function_name = function_name, .source = .{ .path = source_path, .hash = source_hash, .start = function_start, .end = function_end }, .input_identity = input_identity, .signature_hash = signature_hash, .type_id = type_id, .source_utf16_length = source_length, .function_start = function_start, .function_end = function_end, .return_type = return_type, .register_count = register_count, .block_count = block_count, .instruction_count = instruction_count, .instruction_offset = instruction_offset, .parameter_types = parameter_types, .source_index = source_index, .initializer = initializer }, .instructions = ops, .blocks = blocks, .register_types = try allocator.dupe(u8, register_types[0..register_count]) };
}

fn use(reader: *Reader, reg: u16, expected_type: u8, block: usize, position: usize, count: u16, types: *const [4096]u8, definitions: *const [4096]u16, positions: *const [4096]usize, dominators: *const [256][4]u64) error{Invalid}!void {
    if (reg >= count) return reader.reject("r04-register", reader.offset);
    if (expected_type == 0 or types[reg] != expected_type) return reader.reject("r04-type", reader.offset);
    const definition = definitions[reg];
    if ((definition == block and positions[reg] > position) or (dominators[block][definition / 64] & (@as(u64, 1) << @as(u6, @intCast(definition % 64)))) == 0) return reader.reject("r04-dominance", reader.offset);
}

pub fn load(allocator: Allocator, bytes: []const u8) LoadOutcome {
    if (bytes.len > contract.max_bytes) return .{ .rejected = .{ .code = "r04-size", .offset = 0 } };
    const module = allocator.create(Module) catch return .{ .rejected = .{ .code = "r04-allocation", .offset = 0 } };
    module.allocator = allocator;
    module.arena = std.heap.ArenaAllocator.init(allocator);
    const owned = module.arena.allocator().dupe(u8, bytes) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-allocation", .offset = 0 } };
    };
    var reader: Reader = .{ .bytes = owned };
    module.bytes = owned;
    module.info = parse(&reader, module.arena.allocator(), module) catch |err| {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = if (err == error.OutOfMemory) .{ .code = "r04-allocation", .offset = reader.offset } else reader.failure };
    };
    return .{ .loaded = @ptrCast(module) };
}
fn decoded(module: *const VerifiedModule) *const Module {
    return @ptrCast(@alignCast(module));
}

pub fn unload(handle: *VerifiedModule) void {
    const module: *Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    module.arena.deinit();
    allocator.destroy(module);
}

/// Text slices remain valid until unload; evaluation never borrows caller input.
pub fn moduleInfo(module: *const VerifiedModule) ModuleInfo {
    return decoded(module).info;
}

/// Only loader-verified instructions are exposed, owned until unload.
pub fn instructions(module: *const VerifiedModule) []const Instruction {
    return decoded(module).functions[0].instructions;
}

pub fn blockTable(module: *const VerifiedModule) []const Block {
    return decoded(module).functions[0].blocks;
}
pub fn functions(module: *const VerifiedModule) []const Function {
    return decoded(module).functions;
}

pub fn moduleTables(module: *const VerifiedModule) module_format.Tables {
    return decoded(module).tables;
}

pub fn serialize(module: *const VerifiedModule, allocator: Allocator) Allocator.Error![]u8 {
    return allocator.dupe(u8, decoded(module).bytes);
}

pub fn digestText(value: [32]u8) [71]u8 {
    var text: [71]u8 = undefined;
    @memcpy(text[0..7], "sha256:");
    @memcpy(text[7..], &std.fmt.bytesToHex(value, .lower));
    return text;
}

fn inspectFunction(module: *const VerifiedModule, function: Function, allocator: Allocator) Allocator.Error![]u8 {
    const info = function.info;
    const function_id = digestText(info.function_id);
    const input_identity = digestText(info.input_identity);
    const signature_hash = digestText(info.signature_hash);
    const type_id = digestText(info.type_id);
    const source_hash = digestText(info.source.hash);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const temporary = arena.allocator();
    const View = struct { opcode: []const u8, type: []const u8, register: []const u8, immediate: ?[]const u8 = null, left: ?[]const u8 = null, right: ?[]const u8 = null, target: ?[]const u8 = null, trueTarget: ?[]const u8 = null, falseTarget: ?[]const u8 = null, arguments: ?[]const []const u8 = null, trueArguments: ?[]const []const u8 = null, falseArguments: ?[]const []const u8 = null, event: ?[]const u8 = null, start: []const u8, end: []const u8 };
    const views = try temporary.alloc(View, info.instruction_count);
    for (function.instructions, views) |op, *view| {
        const names = [_][]const u8{ "add", "sub", "mul", "div", "rem", "shl", "shr", "ushr", "and", "or", "xor", "neg", "not", "bool_not", "eq", "ne", "lt", "le", "gt", "ge" };
        view.* = .{ .opcode = switch (op.opcode) {
            1 => "const_i32",
            2 => if (op.type_code == 1) "return_i32" else if (op.type_code == 2) "return_bool" else "return_integer",
            3 => "const_bool",
            4...23 => names[op.opcode - 4],
            24 => "br",
            25 => "cond_br",
            26 => "fuel",
            27 => "call",
            28 => "const_integer",
            29 => "global_load",
            30 => "global_store",
            31 => "authorized_host",
            else => unreachable,
        }, .type = contract.typeName(op.type_code), .register = try std.fmt.allocPrint(temporary, "{d}", .{op.register}), .start = try std.fmt.allocPrint(temporary, "{d}", .{op.source.start}), .end = try std.fmt.allocPrint(temporary, "{d}", .{op.source.end}) };
        if (op.opcode == 1 or op.opcode == 3) view.immediate = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode == 28) view.immediate = if (contract.signedType(op.type_code)) try std.fmt.allocPrint(temporary, "{d}", .{contract.signedValue(op.literal_bits, op.type_code)}) else try std.fmt.allocPrint(temporary, "{d}", .{op.literal_bits});
        if (op.opcode >= 4 and op.opcode <= 23) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if (op.opcode < 15 or op.opcode > 17) view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
        if (op.opcode >= 29 and op.opcode <= 31) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
        if (op.opcode == 26) view.event = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode == 27) {
            view.target = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            const arguments = try temporary.alloc([]const u8, op.edges[0].len);
            for (op.edges[0], arguments) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
            view.arguments = arguments;
        }
        if (op.opcode == 24 or op.opcode == 25) {
            const first_args = try temporary.alloc([]const u8, op.edges[0].len);
            for (op.edges[0], first_args) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
            const first_target = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if (op.opcode == 24) {
                view.target = first_target;
                view.arguments = first_args;
            } else {
                view.trueTarget = first_target;
                view.trueArguments = first_args;
                view.falseTarget = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
                const second_args = try temporary.alloc([]const u8, op.edges[1].len);
                for (op.edges[1], second_args) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
                view.falseArguments = second_args;
            }
        }
    }
    const ParameterView = struct { register: []const u8, type: []const u8 };
    const BlockView = struct { parameters: []ParameterView, instructionStart: []const u8, instructionCount: []const u8 };
    const block_views = try temporary.alloc(BlockView, info.block_count);
    for (function.blocks, block_views) |block, *view| {
        const parameters = try temporary.alloc(ParameterView, block.parameters.len);
        for (block.parameters, parameters) |parameter, *parameter_view| parameter_view.* = .{ .register = try std.fmt.allocPrint(temporary, "{d}", .{parameter.register}), .type = contract.typeName(parameter.type_code) };
        view.* = .{ .parameters = parameters, .instructionStart = try std.fmt.allocPrint(temporary, "{d}", .{block.start}), .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{block.count}) };
    }
    const parameter_types = try temporary.alloc([]const u8, info.parameter_types.len);
    for (info.parameter_types, parameter_types) |type_code, *type_name| type_name.* = contract.typeName(type_code);
    return std.json.Stringify.valueAlloc(allocator, .{
        .familyId = "tsfg.bytecode",
        .semver = "0.7.0",
        .schemaHash = "sha256:" ++ contract.schema_hash_hex,
        .target = contract.target,
        .triple = contract.triple,
        .llvmDataLayout = contract.data_layout,
        .i32Bytes = "4",
        .i32Align = "4",
        .pointerBits = "64",
        .pointerAlign = "8",
        .capabilities = "18",
        .totalBytes = try std.fmt.allocPrint(temporary, "{d}", .{decoded(module).bytes.len}),
        .inputIdentity = @as([]const u8, &input_identity),
        .functionId = @as([]const u8, &function_id),
        .signatureHash = @as([]const u8, &signature_hash),
        .typeId = @as([]const u8, &type_id),
        .source = .{ .path = info.source.path, .hash = @as([]const u8, &source_hash), .utf16Length = try std.fmt.allocPrint(temporary, "{d}", .{info.source_utf16_length}) },
        .functionName = info.function_name,
        .functionStart = try std.fmt.allocPrint(temporary, "{d}", .{info.function_start}),
        .functionEnd = try std.fmt.allocPrint(temporary, "{d}", .{info.function_end}),
        .returnType = contract.typeName(info.return_type),
        .parameterCount = try std.fmt.allocPrint(temporary, "{d}", .{info.parameter_types.len}),
        .parameterTypes = parameter_types,
        .registerCount = try std.fmt.allocPrint(temporary, "{d}", .{info.register_count}),
        .blockCount = try std.fmt.allocPrint(temporary, "{d}", .{info.block_count}),
        .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{info.instruction_count}),
        .blocks = block_views,
        .instructions = views,
    }, .{ .emit_null_optional_fields = false });
}

pub fn inspect(module: *const VerifiedModule, allocator: Allocator) Allocator.Error![]u8 {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const temp = arena.allocator();
    var views: std.array_list.Managed(std.json.Value) = .init(temp);
    for (functions(module)) |function| {
        const bytes = try inspectFunction(module, function, temp);
        const parsed = std.json.parseFromSlice(std.json.Value, temp, bytes, .{ .allocate = .alloc_always }) catch return error.OutOfMemory;
        try views.append(parsed.value);
    }
    var top = views.items[0];
    top.object = try top.object.clone(temp);
    try top.object.put(temp, "functions", .{ .array = views });
    return std.json.Stringify.valueAlloc(allocator, top, .{});
}
