// SPDX-License-Identifier: MIT
const std = @import("std");
const builtin = @import("builtin");
pub const contract = @import("contract.zig");
const Allocator = std.mem.Allocator;
const Sha256 = std.crypto.hash.sha2.Sha256;

pub const FunctionId = [32]u8;
pub const VerifiedModule = opaque {};
pub const Source = struct { path: []const u8, hash: [32]u8, start: u32, end: u32 };
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
};
pub const Instruction = struct {
    opcode: u8,
    type_code: u8,
    register: u16,
    immediate: i32,
    left: u16,
    right: u16,
    source: Source,
    edges: [2][]const u16 = .{ &.{}, &.{} },
};
pub const Parameter = struct { register: u16, type_code: u8 };
pub const Block = struct { parameters: []const Parameter, start: usize, count: u16 };
const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, info: ModuleInfo, instructions: []Instruction, blocks: []Block };
pub const LoadFailure = struct { code: []const u8, offset: usize };
pub const LoadOutcome = union(enum) { loaded: *VerifiedModule, rejected: LoadFailure };

const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    failure: LoadFailure = .{ .code = "r04-truncated", .offset = 0 },

    fn reject(self: *Reader, code: []const u8, offset: usize) error{Invalid} {
        self.failure = .{ .code = code, .offset = offset };
        return error.Invalid;
    }
    fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
        if (count > self.bytes.len - self.offset) return self.reject("r04-truncated", self.offset);
        const result = self.bytes[self.offset..][0..count];
        self.offset += count;
        return result;
    }
    fn int(self: *Reader, comptime T: type) error{Invalid}!T {
        const bytes = try self.take(@sizeOf(T));
        return std.mem.readInt(T, bytes[0..@sizeOf(T)], .little);
    }
    fn digest(self: *Reader) error{Invalid}![32]u8 {
        return (try self.take(32))[0..32].*;
    }
    fn string(self: *Reader, maximum: u32) error{Invalid}![]const u8 {
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
    try reader.expected(u32, 8, "r04-capability");
    const input_identity = try reader.digest();
    const source_hash = try reader.digest();
    const function_id = try reader.digest();
    const signature_offset = reader.offset;
    const signature_hash = try reader.digest();
    const type_id = try reader.digest();
    const source_path = try reader.string(4096);
    // A leading slash is the official frontend's logical source root, never
    // an instruction to open a host filesystem path. Preserve it in IDs/maps.
    if (std.mem.indexOfAny(u8, source_path, "\\:") != null) return reader.reject("r04-source", reader.offset - source_path.len);
    const logical_path = if (source_path[0] == '/') source_path[1..] else source_path;
    var components = std.mem.splitScalar(u8, logical_path, '/');
    while (components.next()) |component| {
        if (component.len == 0 or std.mem.eql(u8, component, ".") or std.mem.eql(u8, component, "..")) return reader.reject("r04-source", reader.offset - source_path.len);
    }
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
    const source_length = try reader.int(u32);
    const function_start = try reader.int(u32);
    const function_end = try reader.int(u32);
    if (!rangeValid(function_start, function_end, 0, source_length)) return reader.reject("r04-source-range", reader.offset - 8);
    const return_type = try reader.int(u8);
    if (return_type != 1 and return_type != 2) return reader.reject("r04-type", reader.offset - 1);
    const signature = if (return_type == 1) "tsfg.signature\x00()->i32" else "tsfg.signature\x00()->bool";
    const scalar_type = if (return_type == 1) "tsfg.type\x00i32" else "tsfg.type\x00bool";
    if (!std.mem.eql(u8, &signature_hash, &hash(signature))) return reader.reject("r04-signature", signature_offset);
    if (!std.mem.eql(u8, &type_id, &hash(scalar_type))) return reader.reject("r04-type", signature_offset + 32);
    if (!std.mem.eql(u8, &function_id, &expected_function_id)) return reader.reject("r04-function", signature_offset - 32);
    try reader.expected(u8, 0, "r04-signature");
    const register_count = try reader.int(u16);
    if (register_count < 1 or register_count > 4096) return reader.reject("r04-register", reader.offset - 2);
    const block_count = try reader.int(u16);
    if (block_count < 1 or block_count > 256) return reader.reject("r04-block", reader.offset - 2);
    const instruction_count = try reader.int(u16);
    if (instruction_count < 1 or instruction_count > 8192) return reader.reject("r04-instruction-count", reader.offset - 2);
    const blocks = try allocator.alloc(Block, block_count);
    module.blocks = blocks;
    var total: usize = 0;
    for (blocks, 0..) |*block, index| {
        const parameter_count = try reader.int(u16);
        if (parameter_count > register_count or (index == 0 and parameter_count != 0)) return reader.reject("r04-block-parameter", reader.offset - 2);
        const parameters = try allocator.alloc(Parameter, parameter_count);
        for (parameters) |*parameter| {
            parameter.register = try reader.int(u16);
            parameter.type_code = try reader.int(u8);
            try reader.expected(u8, 0, "r04-reserved");
            if (parameter.type_code != 1 and parameter.type_code != 2) return reader.reject("r04-type", reader.offset - 2);
        }
        const count = try reader.int(u16);
        if (count < 1 or count > instruction_count or total + count > instruction_count) return reader.reject("r04-instruction-count", reader.offset - 2);
        block.* = .{ .parameters = parameters, .start = total, .count = count };
        total += count;
    }
    if (total != instruction_count) return reader.reject("r04-instruction-count", reader.offset);
    const instruction_offset = reader.offset;
    const ops = try allocator.alloc(Instruction, instruction_count);
    module.instructions = ops;
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
            if (!rangeValid(start, end, function_start, function_end)) return reader.reject("r04-source-range", offset + 8);
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
                if (payload == 1 and (block_index != 0 or position != 0)) return reader.reject("r04-entry-fuel", offset);
                if (payload == 1 and (start != function_start or end != function_end)) return reader.reject("r04-source-range", offset + 8);
                if (payload == 2 and (block_index == 0 or position != 0)) return reader.reject("r04-fuel", offset);
                if (payload == 2) has_fuel[block_index] = true;
            } else {
                if (type_code != 1 and type_code != 2) return reader.reject("r04-type", offset + 1);
                if (opcode == 2) {
                    if (payload != 0) return reader.reject("r04-reserved", offset + 4);
                    if (type_code != return_type) return reader.reject("r04-type", offset + 1);
                } else {
                    if (opcode < 1 or opcode > 23) return reader.reject("r04-instruction", offset);
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
                }
            }
        }
    }
    if (next_register != register_count) return reader.reject("r04-register", reader.offset);
    if (ops[0].opcode != 26 or ops[0].immediate != 1) return reader.reject("r04-entry-fuel", instruction_offset);
    if (reader.offset != reader.bytes.len) return reader.reject("r04-trailing", reader.offset);
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
            if (op.opcode >= 4 and op.opcode <= 23) {
                const operand_type: u8 = if (op.opcode == 17) 2 else if (op.opcode == 18 or op.opcode == 19) (if (op.left < register_count) register_types[op.left] else 0) else 1;
                if (op.type_code != (if (op.opcode >= 17) @as(u8, 2) else 1)) return reader.reject("r04-type", instruction_offset);
                try use(reader, op.left, operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
                if (op.opcode < 15 or op.opcode > 17) try use(reader, op.right, operand_type, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
            }
            if (op.opcode == 24 or op.opcode == 25) {
                for (0..(if (op.opcode == 24) @as(usize, 1) else 2)) |edge| {
                    const target = if (edge == 0) op.left else op.right;
                    for (op.edges[edge], blocks[target].parameters) |argument, parameter| try use(reader, argument, parameter.type_code, block_index, global_position, register_count, &register_types, &definition_blocks, &definition_positions, &dominators);
                }
            }
        }
    }
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
    return .{ .function_id = function_id, .function_name = function_name, .source = .{ .path = source_path, .hash = source_hash, .start = function_start, .end = function_end }, .input_identity = input_identity, .signature_hash = signature_hash, .type_id = type_id, .source_utf16_length = source_length, .function_start = function_start, .function_end = function_end, .return_type = return_type, .register_count = register_count, .block_count = block_count, .instruction_count = instruction_count, .instruction_offset = instruction_offset };
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
    return decoded(module).instructions;
}

pub fn blockTable(module: *const VerifiedModule) []const Block {
    return decoded(module).blocks;
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

pub fn inspect(module: *const VerifiedModule, allocator: Allocator) Allocator.Error![]u8 {
    const info = moduleInfo(module);
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
    for (instructions(module), views) |op, *view| {
        const names = [_][]const u8{ "add", "sub", "mul", "div", "rem", "shl", "shr", "ushr", "and", "or", "xor", "neg", "not", "bool_not", "eq", "ne", "lt", "le", "gt", "ge" };
        view.* = .{ .opcode = switch (op.opcode) {
            1 => "const_i32",
            2 => if (op.type_code == 1) "return_i32" else "return_bool",
            3 => "const_bool",
            4...23 => names[op.opcode - 4],
            24 => "br",
            25 => "cond_br",
            26 => "fuel",
            else => unreachable,
        }, .type = if (op.type_code == 0) "none" else if (op.type_code == 1) "i32" else "bool", .register = try std.fmt.allocPrint(temporary, "{d}", .{op.register}), .start = try std.fmt.allocPrint(temporary, "{d}", .{op.source.start}), .end = try std.fmt.allocPrint(temporary, "{d}", .{op.source.end}) };
        if (op.opcode == 1 or op.opcode == 3) view.immediate = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode >= 4 and op.opcode <= 23) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if (op.opcode < 15 or op.opcode > 17) view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
        if (op.opcode == 26) view.event = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
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
    for (blockTable(module), block_views) |block, *view| {
        const parameters = try temporary.alloc(ParameterView, block.parameters.len);
        for (block.parameters, parameters) |parameter, *parameter_view| parameter_view.* = .{ .register = try std.fmt.allocPrint(temporary, "{d}", .{parameter.register}), .type = if (parameter.type_code == 1) "i32" else "bool" };
        view.* = .{ .parameters = parameters, .instructionStart = try std.fmt.allocPrint(temporary, "{d}", .{block.start}), .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{block.count}) };
    }
    return std.json.Stringify.valueAlloc(allocator, .{
        .familyId = "tsfg.bytecode",
        .semver = "0.4.0",
        .schemaHash = "sha256:" ++ contract.schema_hash_hex,
        .target = contract.target,
        .triple = contract.triple,
        .llvmDataLayout = contract.data_layout,
        .i32Bytes = "4",
        .i32Align = "4",
        .capabilities = "8",
        .totalBytes = try std.fmt.allocPrint(temporary, "{d}", .{decoded(module).bytes.len}),
        .inputIdentity = @as([]const u8, &input_identity),
        .functionId = @as([]const u8, &function_id),
        .signatureHash = @as([]const u8, &signature_hash),
        .typeId = @as([]const u8, &type_id),
        .source = .{ .path = info.source.path, .hash = @as([]const u8, &source_hash), .utf16Length = try std.fmt.allocPrint(temporary, "{d}", .{info.source_utf16_length}) },
        .functionName = info.function_name,
        .functionStart = try std.fmt.allocPrint(temporary, "{d}", .{info.function_start}),
        .functionEnd = try std.fmt.allocPrint(temporary, "{d}", .{info.function_end}),
        .returnType = if (info.return_type == 1) "i32" else "bool",
        .parameterCount = "0",
        .registerCount = try std.fmt.allocPrint(temporary, "{d}", .{info.register_count}),
        .blockCount = try std.fmt.allocPrint(temporary, "{d}", .{info.block_count}),
        .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{info.instruction_count}),
        .blocks = block_views,
        .instructions = views,
    }, .{ .emit_null_optional_fields = false });
}
