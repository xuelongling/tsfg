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
