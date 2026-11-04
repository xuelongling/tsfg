// SPDX-License-Identifier: MIT
// Prospective private Common20 data, not an activated Runtime contract or VM handle.
// The formal candidate decoder owns every slice in arena before publishing this
// value. Type construction alone proves no schema, effects, SSA or lifetime.
const std = @import("std");
pub const types = @import("wire-program-types.zig");
const tables = @import("wire-program-tables.zig");
pub const instruction = @import("wire-program-instruction.zig");

pub const format = struct {
    pub const magic = "TSFGTBC0".*;
    pub const version: u32 = 20;
    pub const capability: u32 = 1020;
    pub const schema_hash_hex = "08b3b4b43f12a7b7a86fe89ebe0c16b1d0a5585bdcac6569f00cabd5fed4c775";
    pub const schema_hash: types.Hash = .{ 0x08, 0xb3, 0xb4, 0xb4, 0x3f, 0x12, 0xa7, 0xb7, 0xa8, 0x6f, 0xe8, 0x9e, 0xbe, 0x0c, 0x16, 0xb1, 0xd0, 0xa5, 0x58, 0x5b, 0xdc, 0xac, 0x65, 0x69, 0xf0, 0x0c, 0xab, 0xd5, 0xfe, 0xd4, 0xc7, 0x75 };
    pub const max_bytes: usize = 8388608;
    // One trusted private Common cold allowance, shared by decoding and all
    // typed checks. This never changes or restores a Source/warm allowance.
    pub const max_work: usize = 4000000;
    pub const table_count: u8 = 11;
    pub const target = "windows-x86_64-msvc";
    pub const triple = "x86_64-pc-windows-msvc";
    pub const data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
};

pub const Envelope = struct {
    magic: [8]u8,
    version: u32,
    schema_hash: types.Hash,
    total_bytes: u32,
    payload_hash: types.Hash,
};
pub const Target = struct {
    target: []const u8,
    triple: []const u8,
    data_layout: []const u8,
    i32_bytes: u16,
    i32_alignment: u16,
    pointer_bits: u16,
    pointer_alignment: u16,
    capability: u32,
};
pub const FunctionRole = enum(u8) { ordinary = 0, construction_body = 1, module_initializer = 2 };
pub const Register = struct { carrier: types.Carrier, view: ?types.TypeRef };
pub const Block = struct { parameters: []const types.RegisterRef, instructions: []const instruction.Instruction };
pub const Function = struct {
    id: types.Hash,
    signature: types.Hash,
    abi: types.AbiRef,
    source: types.SourceRef,
    role: FunctionRole,
    declaration: types.Anchor,
    name: []const u8,
    registers: []const Register,
    blocks: []const Block,
};
pub const Program = struct {
    envelope: Envelope,
    target: Target,
    input_identity: types.Hash,
    source_hash: types.Hash,
    source_path: []const u8,
    source_length: u32,
    root_source: types.SourceRef,
    tables: tables.Tables,
    functions: []const Function,
};

// No init-from-borrowed-Program API: such a shallow copy would falsely claim
// ownership of caller memory. The prospective decoder transfers its private arena
// and complete original bytes here; all views expire together at deinit.
pub const OwnedProgram = struct {
    arena: std.heap.ArenaAllocator,
    encoded: []const u8,
    program: Program,

    pub fn deinit(self: *OwnedProgram) void {
        self.arena.deinit();
        self.* = undefined;
    }
};

// Identity/size checks only. Payload hashing, strict JSON admission, every
// reference join and independent graph proofs remain separate typed-check duties.
pub fn requireFormat(envelope: Envelope, target: Target) error{WrongFormat, WrongTarget, PacketLimit}!void {
    if (!std.mem.eql(u8, &envelope.magic, &format.magic) or envelope.version != format.version or
        !std.mem.eql(u8, &envelope.schema_hash, &format.schema_hash) or target.capability != format.capability)
        return error.WrongFormat;
    if (envelope.total_bytes < 80 or envelope.total_bytes > format.max_bytes) return error.PacketLimit;
    if (!std.mem.eql(u8, target.target, format.target) or !std.mem.eql(u8, target.triple, format.triple) or
        !std.mem.eql(u8, target.data_layout, format.data_layout) or target.i32_bytes != 4 or target.i32_alignment != 4 or
        target.pointer_bits != 64 or target.pointer_alignment != 8) return error.WrongTarget;
}
