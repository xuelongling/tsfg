// SPDX-License-Identifier: MIT
// Prospective private Common19 data, not an activated Runtime contract or VM handle.
// The formal candidate decoder owns every slice in arena before publishing this
// value. Type construction alone proves no schema, effects, SSA or lifetime.
const std = @import("std");
pub const types = @import("wire-program-types.zig");
const tables = @import("wire-program-tables.zig");
pub const instruction = @import("wire-program-instruction.zig");

pub const format = struct {
    pub const magic = "TSFGTBC0".*;
    pub const version: u32 = 19;
    pub const capability: u32 = 1019;
    pub const schema_hash_hex = "fd9668dd9f938d5b4ec6e1b1d7d5e54e49109ea7d0fd9a07bd67875719f37009";
    pub const schema_hash: types.Hash = .{ 0xfd, 0x96, 0x68, 0xdd, 0x9f, 0x93, 0x8d, 0x5b, 0x4e, 0xc6, 0xe1, 0xb1, 0xd7, 0xd5, 0xe5, 0x4e, 0x49, 0x10, 0x9e, 0xa7, 0xd0, 0xfd, 0x9a, 0x07, 0xbd, 0x67, 0x87, 0x57, 0x19, 0xf3, 0x70, 0x09 };
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
