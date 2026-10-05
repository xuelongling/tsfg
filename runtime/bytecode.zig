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
    constant: i32,
    constant_start: u32,
    constant_end: u32,
};
pub const Instruction = union(enum) {
    const_i32: struct { register: u16, immediate: i32, source: Source },
    return_i32: struct { register: u16, source: Source },
};
const Module = struct { allocator: Allocator, bytes: []u8, info: ModuleInfo, instructions: [2]Instruction };
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
    try reader.expected(u32, 1, "r04-capability");
    const input_identity = try reader.digest();
    const source_hash = try reader.digest();
    const function_id = try reader.digest();
    const signature_offset = reader.offset;
    const signature_hash = try reader.digest();
    const type_id = try reader.digest();
    if (!std.mem.eql(u8, &signature_hash, &hash("tsfg.signature\x00()->i32"))) return reader.reject("r04-signature", signature_offset);
    if (!std.mem.eql(u8, &type_id, &hash("tsfg.type\x00i32"))) return reader.reject("r04-type", signature_offset + 32);
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
    if (!std.mem.eql(u8, &function_id, &expected_function_id)) return reader.reject("r04-function", signature_offset - 32);
    const source_length = try reader.int(u32);
    const function_start = try reader.int(u32);
    const function_end = try reader.int(u32);
    if (!rangeValid(function_start, function_end, 0, source_length)) return reader.reject("r04-source-range", reader.offset - 8);
    try reader.expected(u8, 1, "r04-type");
    try reader.expected(u8, 0, "r04-signature");
    try reader.expected(u16, 1, "r04-register");
    try reader.expected(u16, 1, "r04-block");
    try reader.expected(u16, 2, "r04-instruction-count");
    try reader.expected(u8, 1, "r04-instruction");
    try reader.expected(u8, 1, "r04-type");
    try reader.expected(u16, 0, "r04-register");
    const constant = try reader.int(i32);
    const constant_start = try reader.int(u32);
    const constant_end = try reader.int(u32);
    if (!rangeValid(constant_start, constant_end, function_start, function_end)) return reader.reject("r04-source-range", reader.offset - 8);
    try reader.expected(u8, 2, "r04-instruction");
    try reader.expected(u8, 1, "r04-type");
    try reader.expected(u16, 0, "r04-register");
    try reader.expected(u32, 0, "r04-reserved");
    const return_start = try reader.int(u32);
    const return_end = try reader.int(u32);
    if (!rangeValid(return_start, return_end, function_start, function_end)) return reader.reject("r04-source-range", reader.offset - 8);
    if (reader.offset != reader.bytes.len) return reader.reject("r04-trailing", reader.offset);
    return .{ .function_id = function_id, .function_name = function_name, .source = .{ .path = source_path, .hash = source_hash, .start = return_start, .end = return_end }, .input_identity = input_identity, .signature_hash = signature_hash, .type_id = type_id, .source_utf16_length = source_length, .function_start = function_start, .function_end = function_end, .constant = constant, .constant_start = constant_start, .constant_end = constant_end };
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
    var constant_source = info.source;
    constant_source.start = info.constant_start;
    constant_source.end = info.constant_end;
    module.* = .{ .allocator = allocator, .bytes = owned, .info = info, .instructions = .{
        .{ .const_i32 = .{ .register = 0, .immediate = info.constant, .source = constant_source } },
        .{ .return_i32 = .{ .register = 0, .source = info.source } },
    } };
    return .{ .loaded = @ptrCast(module) };
}

fn decoded(module: *const VerifiedModule) *const Module {
    return @ptrCast(@alignCast(module));
}

pub fn unload(handle: *VerifiedModule) void {
    const module: *Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    allocator.free(module.bytes);
    allocator.destroy(module);
}

/// Text slices remain valid until unload; evaluation never borrows caller input.
pub fn moduleInfo(module: *const VerifiedModule) ModuleInfo {
    return decoded(module).info;
}

/// Only loader-verified instructions are exposed, owned until unload.
pub fn instructions(module: *const VerifiedModule) []const Instruction {
    return &decoded(module).instructions;
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
    var buffers: [7][32]u8 = undefined;
    const constant = std.fmt.bufPrint(&buffers[0], "{d}", .{info.constant}) catch unreachable;
    const length = std.fmt.bufPrint(&buffers[1], "{d}", .{info.source_utf16_length}) catch unreachable;
    const start = std.fmt.bufPrint(&buffers[2], "{d}", .{info.function_start}) catch unreachable;
    const end = std.fmt.bufPrint(&buffers[3], "{d}", .{info.function_end}) catch unreachable;
    const const_start = std.fmt.bufPrint(&buffers[4], "{d}", .{info.constant_start}) catch unreachable;
    const const_end = std.fmt.bufPrint(&buffers[5], "{d}", .{info.constant_end}) catch unreachable;
    const total_bytes = std.fmt.bufPrint(&buffers[6], "{d}", .{decoded(module).bytes.len}) catch unreachable;
    var source_buffers: [2][32]u8 = undefined;
    const return_start = std.fmt.bufPrint(&source_buffers[0], "{d}", .{info.source.start}) catch unreachable;
    const return_end = std.fmt.bufPrint(&source_buffers[1], "{d}", .{info.source.end}) catch unreachable;
    return std.json.Stringify.valueAlloc(allocator, .{
        .familyId = "tsfg.bytecode",
        .semver = "0.1.0",
        .schemaHash = "sha256:" ++ contract.schema_hash_hex,
        .target = contract.target,
        .triple = contract.triple,
        .llvmDataLayout = contract.data_layout,
        .i32Bytes = "4",
        .i32Align = "4",
        .capabilities = "1",
        .totalBytes = total_bytes,
        .inputIdentity = @as([]const u8, &input_identity),
        .functionId = @as([]const u8, &function_id),
        .signatureHash = @as([]const u8, &signature_hash),
        .typeId = @as([]const u8, &type_id),
        .source = .{ .path = info.source.path, .hash = @as([]const u8, &source_hash), .utf16Length = length },
        .functionName = info.function_name,
        .functionStart = start,
        .functionEnd = end,
        .returnType = "i32",
        .parameterCount = "0",
        .registerCount = "1",
        .blockCount = "1",
        .instructionCount = "2",
        .instructions = .{
            .{ .opcode = "const_i32", .type = "i32", .register = "0", .immediate = constant, .start = const_start, .end = const_end },
            .{ .opcode = "return_i32", .type = "i32", .register = "0", .start = return_start, .end = return_end },
        },
    }, .{});
}
