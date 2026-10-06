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
};
pub const Instruction = struct {
    opcode: u8,
    type_code: u8,
    register: u16,
    immediate: i32,
    left: u16,
    right: u16,
    source: Source,
};
const Module = struct { allocator: Allocator, bytes: []u8, info: ModuleInfo, instructions: []Instruction };
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

fn parse(reader: *Reader) error{Invalid}!ModuleInfo {
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
    try reader.expected(u32, 4, "r04-capability");
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
    try reader.expected(u16, 1, "r04-block");
    const instruction_count = try reader.int(u16);
    if (instruction_count != register_count + 1) return reader.reject("r04-instruction-count", reader.offset - 2);
    const instruction_offset = reader.offset;
    var register_types: [4096]u8 = undefined;
    var return_start: u32 = 0;
    var return_end: u32 = 0;
    for (0..instruction_count) |index| {
        const offset = reader.offset;
        const opcode = try reader.int(u8);
        const type_code = try reader.int(u8);
        const reg = try reader.int(u16);
        const payload = try reader.int(u32);
        const start = try reader.int(u32);
        const end = try reader.int(u32);
        if (!rangeValid(start, end, function_start, function_end)) return reader.reject("r04-source-range", offset + 8);
        if (type_code != 1 and type_code != 2) return reader.reject("r04-type", offset + 1);
        if (index == register_count) {
            if (opcode != 2) return reader.reject("r04-instruction", offset);
            if (reg >= register_count) return reader.reject("r04-register", offset + 2);
            if (type_code != return_type or register_types[reg] != return_type) return reader.reject("r04-type", offset + 1);
            if (payload != 0) return reader.reject("r04-reserved", offset + 4);
            return_start = start;
            return_end = end;
        } else {
            if (reg != index) return reader.reject("r04-register", offset + 2);
            if (opcode == 1 or opcode == 3) {
                if (type_code != (if (opcode == 1) @as(u8, 1) else 2)) return reader.reject("r04-type", offset + 1);
                if (opcode == 3 and payload > 1) return reader.reject("r04-boolean", offset + 4);
            } else if ((opcode >= 4 and opcode <= 14) or (opcode >= 18 and opcode <= 23)) {
                const left: u16 = @truncate(payload);
                const right: u16 = @truncate(payload >> 16);
                if (left >= index or right >= index) return reader.reject("r04-register", offset + 4);
                const operand_type = register_types[left];
                if (operand_type != register_types[right] or type_code != (if (opcode >= 18) @as(u8, 2) else 1)
                    or (operand_type != 1 and !(opcode == 18 or opcode == 19))) return reader.reject("r04-type", offset + 1);
            } else if (opcode >= 15 and opcode <= 17) {
                const operand: u16 = @truncate(payload);
                if (operand >= index) return reader.reject("r04-register", offset + 4);
                if (payload >> 16 != 0) return reader.reject("r04-reserved", offset + 6);
                const expected_type: u8 = if (opcode == 17) 2 else 1;
                if (type_code != expected_type or register_types[operand] != expected_type) return reader.reject("r04-type", offset + 1);
            } else return reader.reject("r04-instruction", offset);
            register_types[reg] = type_code;
        }
    }
    // Executed local initializers may precede the return. Every anchor stays
    // inside the function and ends no later than the reached return statement.
    var ranges: Reader = .{ .bytes = reader.bytes, .offset = instruction_offset };
    for (0..register_count) |_| {
        _ = try ranges.take(8);
        const start = try ranges.int(u32);
        const end = try ranges.int(u32);
        if (!rangeValid(start, end, function_start, return_end)) return reader.reject("r04-source-range", ranges.offset - 8);
    }
    if (reader.offset != reader.bytes.len) return reader.reject("r04-trailing", reader.offset);
    return .{ .function_id = function_id, .function_name = function_name, .source = .{ .path = source_path, .hash = source_hash, .start = return_start, .end = return_end }, .input_identity = input_identity, .signature_hash = signature_hash, .type_id = type_id, .source_utf16_length = source_length, .function_start = function_start, .function_end = function_end, .return_type = return_type, .register_count = register_count, .instruction_count = instruction_count, .instruction_offset = instruction_offset };
}

pub fn load(allocator: Allocator, bytes: []const u8) LoadOutcome {
    var reader: Reader = .{ .bytes = bytes };
    var info = parse(&reader) catch return .{ .rejected = reader.failure };
    const module = allocator.create(Module) catch return .{ .rejected = .{ .code = "r04-allocation", .offset = 0 } };
    const owned = allocator.dupe(u8, bytes) catch {
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-allocation", .offset = 0 } };
    };
    const path_offset = @intFromPtr(info.source.path.ptr) - @intFromPtr(bytes.ptr);
    const name_offset = @intFromPtr(info.function_name.ptr) - @intFromPtr(bytes.ptr);
    info.source.path = owned[path_offset..][0..info.source.path.len];
    info.function_name = owned[name_offset..][0..info.function_name.len];
    const ops = allocator.alloc(Instruction, info.instruction_count) catch {
        allocator.free(owned);
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-allocation", .offset = 0 } };
    };
    var instructions_reader: Reader = .{ .bytes = owned, .offset = info.instruction_offset };
    for (ops) |*op| {
        const opcode = instructions_reader.int(u8) catch unreachable;
        const type_code = instructions_reader.int(u8) catch unreachable;
        const reg = instructions_reader.int(u16) catch unreachable;
        const immediate = instructions_reader.int(i32) catch unreachable;
        var source = info.source;
        source.start = instructions_reader.int(u32) catch unreachable;
        source.end = instructions_reader.int(u32) catch unreachable;
        const payload: u32 = @bitCast(immediate);
        op.* = .{ .opcode = opcode, .type_code = type_code, .register = reg, .immediate = immediate, .left = @truncate(payload), .right = @truncate(payload >> 16), .source = source };
    }
    module.* = .{ .allocator = allocator, .bytes = owned, .info = info, .instructions = ops };
    return .{ .loaded = @ptrCast(module) };
}

fn decoded(module: *const VerifiedModule) *const Module {
    return @ptrCast(@alignCast(module));
}

pub fn unload(handle: *VerifiedModule) void {
    const module: *Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    allocator.free(module.bytes);
    allocator.free(module.instructions);
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
    const View = struct { opcode: []const u8, type: []const u8, register: []const u8, immediate: ?[]const u8 = null, left: ?[]const u8 = null, right: ?[]const u8 = null, start: []const u8, end: []const u8 };
    const views = try temporary.alloc(View, info.instruction_count);
    for (instructions(module), views) |op, *view| {
        const names = [_][]const u8{ "add", "sub", "mul", "div", "rem", "shl", "shr", "ushr", "and", "or", "xor", "neg", "not", "bool_not", "eq", "ne", "lt", "le", "gt", "ge" };
        view.* = .{ .opcode = switch (op.opcode) { 1 => "const_i32", 2 => if (op.type_code == 1) "return_i32" else "return_bool", 3 => "const_bool", 4...23 => names[op.opcode - 4], else => unreachable },
            .type = if (op.type_code == 1) "i32" else "bool",
            .register = try std.fmt.allocPrint(temporary, "{d}", .{op.register}),
            .start = try std.fmt.allocPrint(temporary, "{d}", .{op.source.start}),
            .end = try std.fmt.allocPrint(temporary, "{d}", .{op.source.end}) };
        if (op.opcode == 1 or op.opcode == 3) view.immediate = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode >= 4) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if (op.opcode < 15 or op.opcode > 17) view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
    }
    return std.json.Stringify.valueAlloc(allocator, .{
        .familyId = "tsfg.bytecode", .semver = "0.3.0", .schemaHash = "sha256:" ++ contract.schema_hash_hex,
        .target = contract.target, .triple = contract.triple, .llvmDataLayout = contract.data_layout,
        .i32Bytes = "4", .i32Align = "4", .capabilities = "4",
        .totalBytes = try std.fmt.allocPrint(temporary, "{d}", .{decoded(module).bytes.len}),
        .inputIdentity = @as([]const u8, &input_identity), .functionId = @as([]const u8, &function_id),
        .signatureHash = @as([]const u8, &signature_hash), .typeId = @as([]const u8, &type_id),
        .source = .{ .path = info.source.path, .hash = @as([]const u8, &source_hash), .utf16Length = try std.fmt.allocPrint(temporary, "{d}", .{info.source_utf16_length}) },
        .functionName = info.function_name,
        .functionStart = try std.fmt.allocPrint(temporary, "{d}", .{info.function_start}),
        .functionEnd = try std.fmt.allocPrint(temporary, "{d}", .{info.function_end}),
        .returnType = if (info.return_type == 1) "i32" else "bool", .parameterCount = "0",
        .registerCount = try std.fmt.allocPrint(temporary, "{d}", .{info.register_count}), .blockCount = "1",
        .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{info.instruction_count}), .instructions = views,
    }, .{ .emit_null_optional_fields = false });
}
