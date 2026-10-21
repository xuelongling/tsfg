// SPDX-License-Identifier: MIT
const std = @import("std");
const model = @import("bytecode_model.zig");
const Allocator = std.mem.Allocator;
const contract = model.contract;
const module_format = model.module_format;
const FunctionId = model.FunctionId;
const VerifiedModule = model.VerifiedModule;
const Source = model.Source;
const ModuleInfo = model.ModuleInfo;
const Instruction = model.Instruction;
const Parameter = model.Parameter;
const Block = model.Block;
const Function = model.Function;
const Module = model.Module;
const LoadFailure = model.LoadFailure;
const LoadOutcome = model.LoadOutcome;
const builtin = @import("builtin");
const Sha256 = std.crypto.hash.sha2.Sha256;
const Global = struct { input_identity: [32]u8, source_hash: [32]u8, source_path: []const u8, source_length: u32 };
const strings = @import("string-instructions.zig");

// Complete bounded decode/verification owns load failure and storage cleanup.
const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    string_units: usize = 0,
    failure: LoadFailure = .{ .code = "r04-truncated", .offset = 0 },

    pub fn reject(self: *Reader, code: []const u8, offset: usize) error{Invalid} {
        self.failure = .{ .code = code, .offset = offset };
        return error.Invalid;
    }
    pub fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
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
    try reader.expected(u32, 119, "r04-capability");
    const input_identity = try reader.digest();
    const source_hash = try reader.digest();
    const source_path = try reader.string(4096);
    // Preserve exact logical path bytes in IDs/maps; never open a host path.
    if (!module_format.validSourcePath(source_path, false)) return reader.reject("r04-source", reader.offset - source_path.len);
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
    if (count < 1 or count > 512) return reader.reject("r04-function-count", reader.offset - 2);
    module.functions = try allocator.alloc(Function, count);
    const global: Global = .{ .input_identity = input_identity, .source_hash = source_hash, .source_path = source_path, .source_length = source_length };
    for (module.functions, 0..) |*function, index| {
        function.* = try parseFunction(reader, allocator, global, module.tables);
        for (module.functions[0..index]) |previous| if (std.mem.eql(u8, &previous.info.function_id, &function.info.function_id) or previous.info.source_index == function.info.source_index and previous.info.initializer == function.info.initializer and std.mem.eql(u8, previous.info.function_name, function.info.function_name)) return reader.reject("r04-function", reader.offset);
    }
    if (reader.offset != reader.bytes.len) return reader.reject("r04-trailing", reader.offset);
    try model.verifyCalls(reader,module.functions);
    try module_format.verify(reader, &module.tables, module.functions);
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
    function_hash.update(if (initializer) "tsfg.module-initializer.v1\x00" else "tsfg.function\x00");
    function_hash.update(source_path);
    function_hash.update("\x00");
    if (initializer) {
        function_hash.update("sha256:");
        function_hash.update(&std.fmt.bytesToHex(source_hash, .lower));
        function_hash.update("\x00sha256:");
        const module_id = module_format.identity(&.{"tsfg.module\x00", source_path});
        function_hash.update(&std.fmt.bytesToHex(module_id, .lower));
    } else function_hash.update(function_name);
    function_hash.update("\x00");
    if (initializer) function_hash.update("sha256:");
    function_hash.update(&std.fmt.bytesToHex(signature_hash, .lower));
    var expected_function_id: [32]u8 = undefined;
    function_hash.final(&expected_function_id);
    const function_start = try reader.int(u32);
    const function_end = try reader.int(u32);
    if (!rangeValid(function_start, function_end, 0, source_length) and !(initializer and function_start == 0 and function_end == 0 and source_length == 0)) return reader.reject("r04-source-range", reader.offset - 8);
    const return_type = try reader.int(u8);
    if (!contract.validType(return_type)) return reader.reject("r04-type", reader.offset - 1);
    const shape = try model.readParameterShape(reader,allocator,return_type);
    const parameter_types = shape.types;
    const expected_signature = shape.signature;
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
                    if (opcode < 1 or (opcode > 23 and (opcode < 27 or opcode > 42))) return reader.reject("r04-instruction", offset);
                    if ((opcode == 29 or opcode == 31) and !tables.present) return reader.reject("r04-module-mode", offset);
                    if (reg != next_register or next_register >= register_count) return reader.reject("r04-register", offset + 2);
                    register_types[next_register] = type_code;
                    definition_blocks[next_register] = @intCast(block_index);
                    // Parameters are available at block start; operation results only after execution.
                    definition_positions[next_register] = block.start + position + 1;
                    next_register += 1;
                    if (opcode >= 34 and opcode <= 39) try strings.decode(reader, allocator, op, &reader.string_units);
                    if (opcode == 1 or opcode == 3) {
                        if (type_code != (if (opcode == 1) @as(u8, 1) else 2)) return reader.reject("r04-type", offset + 1);
                        if (opcode == 3 and payload > 1) return reader.reject("r04-boolean", offset + 4);
                    } else if (((opcode >= 15 and opcode <= 17) or opcode == 33) and payload >> 16 != 0) return reader.reject("r04-reserved", offset + 6);
                    if (opcode >= 40 and opcode <= 42) {
                        if (payload >> 24 != 0) return reader.reject("r04-reserved", offset + 7);
                        const source_type: u8 = @truncate(payload >> 16);
                        if ((!contract.integerType(source_type) and !contract.floatType(source_type)) or
                            (!contract.integerType(type_code) and !contract.floatType(type_code))) return reader.reject("r04-conversion-type", offset + 1);
                        if (opcode == 41 and (!contract.integerType(source_type) or !contract.integerType(type_code))) return reader.reject("r04-conversion-type", offset + 1);
                        if (opcode == 42 and contract.bitWidth(source_type) != contract.bitWidth(type_code)) return reader.reject("r04-conversion-type", offset + 1);
                    }
                    if (opcode == 28) {
                        if (type_code < 3 or !contract.integerType(type_code) or payload != 0) return reader.reject("r04-type", offset + 1);
                        op.literal_bits = try reader.int(u64);
                        if (op.literal_bits & ~contract.mask(type_code) != 0) return reader.reject("r04-integer-range", reader.offset - 8);
                    }
                    if (opcode == 32) {
                        if (!contract.floatType(type_code) or payload != 0) return reader.reject("r04-type", offset + 1);
                        op.literal_bits = try reader.int(u64);
                        if (op.literal_bits & ~contract.mask(type_code) != 0) return reader.reject("r04-float-bits", reader.offset - 8);
                    }
                    if (opcode == 27) {
                        if (payload >> 16 != 0) return reader.reject("r04-reserved", offset + 6);
                        const count = try reader.int(u16);
                        if (count > 128) return reader.reject("r04-call-arity", reader.offset - 2);
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
            if (op.opcode >= 40 and op.opcode <= 42) try use(reader, op.left, @intCast(op.right), block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if (op.opcode == 30) try use(reader, op.register, op.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if (op.opcode == 31) try use(reader, op.right, 1, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            if ((op.opcode >= 4 and op.opcode <= 23) or op.opcode == 33) {
                if (op.left >= register_count) return reader.reject("r04-register", instruction_offset);
                const operand_type = register_types[op.left];
                if (operand_type == 14) return reader.reject("r04-type", instruction_offset);
                if (op.opcode == 17) {
                    if (operand_type != 2) return reader.reject("r04-type", instruction_offset);
                } else if (op.opcode == 33) {
                    if (!contract.floatType(operand_type)) return reader.reject("r04-type", instruction_offset);
                } else if (op.opcode != 18 and op.opcode != 19 and !contract.integerType(operand_type)
                    and !(contract.floatType(operand_type) and (op.opcode <= 8 or op.opcode == 15 or op.opcode >= 20))) return reader.reject("r04-type", instruction_offset);
                if (op.type_code != (if (op.opcode >= 17 and op.opcode <= 23) @as(u8, 2) else operand_type)) return reader.reject("r04-type", instruction_offset);
                try use(reader, op.left, operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
                if ((op.opcode < 15 or op.opcode > 17) and op.opcode != 33) try use(reader, op.right, if (op.opcode >= 9 and op.opcode <= 11) 1 else operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            }
            if (op.opcode >= 34 and op.opcode <= 39) {
                var operands: [3]strings.Operand = undefined;
                for (strings.operands(op, &operands)) |operand|
                    try use(reader, operand.register, operand.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
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
    return .{ .info = .{ .function_id = function_id, .function_name = function_name, .source = .{ .path = source_path, .hash = source_hash, .start = function_start, .end = function_end }, .input_identity = input_identity, .signature_hash = signature_hash, .type_id = type_id, .source_utf16_length = source_length, .function_start = function_start, .function_end = function_end, .return_type = return_type, .register_count = register_count, .block_count = block_count, .instruction_count = instruction_count, .instruction_offset = instruction_offset, .parameter_types = parameter_types, .presence_masks = shape.masks, .source_index = source_index, .initializer = initializer }, .instructions = ops, .blocks = blocks, .register_types = try allocator.dupe(u8, register_types[0..register_count]) };
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

pub fn unload(handle: *VerifiedModule) void {
    const module: *Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    module.arena.deinit();
    allocator.destroy(module);
}
