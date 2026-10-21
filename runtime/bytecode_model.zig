// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;
pub const contract = @import("contract.zig");
pub const module_format = @import("module_format.zig");

// Owned verified storage and immutable borrowed views shared only inside the loader.
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
    presence_masks: []const u8 = &.{},
    source_index: u16 = 0,
    initializer: bool = false,
};
pub const Instruction = struct {
    opcode: u8,
    type_code: u8,
    register: u16,
    immediate: i32,
    literal_bits: u64 = 0,
    code_units: []const u16 = &.{},
    third: u16 = 0,
    left: u16,
    right: u16,
    source: Source,
    edges: [2][]const u16 = .{ &.{}, &.{} },
};
pub const Parameter = struct { register: u16, type_code: u8 };
pub const Block = struct { parameters: []const Parameter, start: usize, count: u16 };
pub const Function = struct { info: ModuleInfo, instructions: []const Instruction, blocks: []const Block, register_types: []const u8 };
pub const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, info: ModuleInfo, functions: []Function, tables: module_format.Tables = .{} };
pub const LoadFailure = struct { code: []const u8, offset: usize };
pub const LoadOutcome = union(enum) { loaded: *VerifiedModule, rejected: LoadFailure };

pub fn decoded(module: *const VerifiedModule) *const Module {
    return @ptrCast(@alignCast(module));
}

// The physical register ABI and logical request membership are distinct views
// of one verified descriptor. No descriptor state is inferred by the executor.
pub fn validPresenceMask(value: u8) bool {
    return value <= 15 and (value & 4 == 0 or value & 1 != 0) and (value & 8 == 0 or value & 5 == 5);
}
pub const ParameterShape = struct { types: []const u8, masks: []const u8, signature: [32]u8 };
pub fn readParameterShape(reader: anytype, allocator: Allocator, return_type: u8) (error{Invalid} || Allocator.Error)!ParameterShape {
    const Sha256 = std.crypto.hash.sha2.Sha256;
    const signature_parameter_count = try reader.int(u8);
    if (signature_parameter_count > 128) return reader.reject("r04-signature", reader.offset - 1);
    const parameter_types = try allocator.dupe(u8, try reader.take(signature_parameter_count));
    const logical_parameter_count = try reader.int(u8);
    if (logical_parameter_count > 64) return reader.reject("r04-presence-map", reader.offset - 1);
    const presence_masks = try allocator.dupe(u8, try reader.take(logical_parameter_count));
    var signature = Sha256.init(.{});
    signature.update("tsfg.signature\x00(");
    for (parameter_types) |type_code| if (!contract.validType(type_code)) return reader.reject("r04-type", reader.offset);
    var physical: usize = 0;
    for (presence_masks, 0..) |mask, index| {
        if (!validPresenceMask(mask) or physical >= parameter_types.len) return reader.reject("r04-presence-map", reader.offset);
        const type_code = parameter_types[physical];
        if (type_code == 14 and mask != 0) return reader.reject("r04-presence-map", reader.offset);
        physical += 1;
        if (!contract.validType(type_code)) return reader.reject("r04-type", reader.offset);
        if (index != 0) signature.update(",");
        signature.update(contract.typeName(type_code));
        if (mask != 0) {
            const digits = "0123456789abcdef";
            const suffix = [_]u8{ '@', '0', digits[mask] };
            signature.update(&suffix);
        }
        if (mask & 3 != 0) {
            if (physical >= parameter_types.len or parameter_types[physical] != 1) return reader.reject("r04-presence-map", reader.offset);
            physical += 1;
        }
    }
    if (physical != parameter_types.len) return reader.reject("r04-presence-map", reader.offset);
    signature.update(")->");
    signature.update(contract.typeName(return_type));
    var expected_signature: [32]u8 = undefined;
    signature.final(&expected_signature);
    return .{ .types = parameter_types, .masks = presence_masks, .signature = expected_signature };
}

pub fn verifyCalls(reader: anytype, functions: []const Function) error{Invalid}!void {
    for (functions) |function| {
        var known = [_]?u64{null} ** 4096;
        for (function.instructions) |op| switch (op.opcode) {
            1, 3 => known[op.register] = @as(u32, @bitCast(op.immediate)),
            28, 32 => known[op.register] = op.literal_bits,
            else => {},
        };
        for (function.instructions) |op| if (op.opcode == 27) {
            if (op.left >= functions.len) return reader.reject("r04-call-target", function.info.instruction_offset);
            const target = functions[op.left];
            if (op.type_code != target.info.return_type) return reader.reject("r04-type", function.info.instruction_offset);
            if (op.edges[0].len != target.info.parameter_types.len) return reader.reject("r04-call-arity", function.info.instruction_offset);
            for (op.edges[0], target.info.parameter_types) |argument, type_code| if (function.register_types[argument] != type_code) return reader.reject("r04-type", function.info.instruction_offset);
            var physical: usize = 0;
            for (target.info.presence_masks) |mask| {
                const payload = known[op.edges[0][physical]];
                physical += 1;
                if (mask & 3 == 0) continue;
                const state = known[op.edges[0][physical]];
                physical += 1;
                if (state) |bits| {
                    if (bits > 2 or bits == 1 and mask & 1 == 0 or bits == 2 and mask & 2 == 0 or bits != 0 and payload != null and payload.? != 0)
                        return reader.reject("r04-presence-state", function.info.instruction_offset);
                }
            }
        };
    }
}
