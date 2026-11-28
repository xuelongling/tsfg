// SPDX-License-Identifier: MIT
//! Zig Runtime `.tsfgabi` validator, DataLayout verifier, and runtime ABI handshake.
const std = @import("std");
const id = @import("r04-identity.zig");

pub const AbiError = id.EnvelopeError || error{
    UnsupportedCallingConvention,
    WrongTarget,
    WrongTriple,
    WrongDataLayout,
    AbiHashMismatch,
    ForbiddenAbiType,
    InvalidLayout,
    InvalidHandleLayout,
    OutOfMemory,
};

pub const TargetInfo = struct {
    llvmDataLayout: []const u8,
    pointerBits: u32,
    target: []const u8,
    triple: []const u8,
};

pub const HandleField = struct {
    name: []const u8,
    offset: u32,
    type: []const u8,
};

pub const HandleLayout = struct {
    @"align": u32,
    fields: []const HandleField,
    size: u32,
    stride: u32,
};

pub const AbiField = struct {
    name: []const u8,
    offset: u32,
    readonly: bool,
    type: []const u8,
};

pub const PaddingInterval = struct {
    end: u32,
    start: u32,
};

pub const AbiType = struct {
    @"align": u32,
    byteSize: u32,
    fields: []const AbiField = &.{},
    id: []const u8,
    kind: []const u8,
    name: []const u8,
    padding: []const PaddingInterval = &.{},
    sourcePath: []const u8 = "",
    stride: u32,
    underlyingType: ?[]const u8 = null,
    tagType: ?[]const u8 = null,
    payloadOffset: ?u32 = null,
    payloadSize: ?u32 = null,
    payloadAlign: ?u32 = null,
    elementType: ?[]const u8 = null,
    targetTypeId: ?[]const u8 = null,
    returnType: ?[]const u8 = null,
    signatureHash: ?[]const u8 = null,
};

pub const AbiParam = struct {
    extension: []const u8,
    location: []const u8,
    mode: []const u8,
    name: []const u8,
    semanticKind: []const u8,
    slot: u32,
    type: []const u8,
};

pub const AbiReturn = struct {
    extension: []const u8,
    mode: []const u8,
    register: []const u8,
    type: []const u8,
};

pub const AbiFunction = struct {
    callingConvention: []const u8,
    functionId: []const u8,
    name: []const u8,
    params: []const AbiParam,
    returnClass: AbiReturn,
    signatureHash: []const u8,
    sourcePath: []const u8,
    symbol: []const u8,
};

pub const AbiPayload = struct {
    abiHash: []const u8,
    callingConvention: []const u8,
    functions: []const AbiFunction,
    handleLayout: HandleLayout,
    target: TargetInfo,
    types: []const AbiType,
};

pub const VerifiedAbi = struct {
    arena: std.heap.ArenaAllocator,
    payload: AbiPayload,

    pub fn deinit(self: *VerifiedAbi) void {
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn findType(self: *const VerifiedAbi, name: []const u8) ?*const AbiType {
        for (self.payload.types) |*t| {
            if (std.mem.eql(u8, t.name, name)) return t;
        }
        return null;
    }

    pub fn verifyHandshake(self: *const VerifiedAbi, expected_abi_hash: []const u8, expected_triple: []const u8) AbiError!void {
        if (!std.mem.eql(u8, self.payload.target.triple, expected_triple)) return error.WrongTriple;
        if (!std.mem.eql(u8, self.payload.abiHash, expected_abi_hash)) return error.AbiHashMismatch;
    }
};

fn isForbiddenKind(kind: []const u8) bool {
    return std.mem.eql(u8, kind, "any") or
        std.mem.eql(u8, kind, "bare_gc_ref") or
        std.mem.eql(u8, kind, "closure_env") or
        std.mem.eql(u8, kind, "js_object") or
        std.mem.eql(u8, kind, "managed_string") or
        std.mem.eql(u8, kind, "unspecialized_generic");
}

fn scalarSizeAlign(name: []const u8) ?[2]u32 {
    if (std.mem.eql(u8, name, "void")) return .{ 0, 1 };
    if (std.mem.eql(u8, name, "bool") or std.mem.eql(u8, name, "i8") or std.mem.eql(u8, name, "u8")) return .{ 1, 1 };
    if (std.mem.eql(u8, name, "i16") or std.mem.eql(u8, name, "u16")) return .{ 2, 2 };
    if (std.mem.eql(u8, name, "i32") or std.mem.eql(u8, name, "u32") or std.mem.eql(u8, name, "f32")) return .{ 4, 4 };
    if (std.mem.eql(u8, name, "i64") or std.mem.eql(u8, name, "u64") or std.mem.eql(u8, name, "f64") or
        std.mem.eql(u8, name, "isize") or std.mem.eql(u8, name, "usize")) return .{ 8, 8 };
    return null;
}

pub fn validateAbiEnvelope(allocator: std.mem.Allocator, bytes: []const u8) AbiError!VerifiedAbi {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.abi", 1, "1", id.SCHEMA_ABI, 4194304, 32);
    const parsed = std.json.parseFromSlice(AbiPayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    if (!std.mem.eql(u8, p.callingConvention, "win64_c")) return error.UnsupportedCallingConvention;
    if (!std.mem.eql(u8, p.target.target, id.TARGET_NAME)) return error.WrongTarget;
    if (!std.mem.eql(u8, p.target.triple, id.TARGET_TRIPLE)) return error.WrongTriple;
    if (!std.mem.eql(u8, p.target.llvmDataLayout, id.WINDOWS_X64_DATALAYOUT) or p.target.pointerBits != 64) {
        return error.WrongDataLayout;
    }
    if (!id.isValidDigest(p.abiHash)) return error.AbiHashMismatch;
    if (p.handleLayout.size != @sizeOf(id.ResourceHandle) or p.handleLayout.@"align" != @alignOf(id.ResourceHandle)) {
        return error.InvalidHandleLayout;
    }

    var verified = VerifiedAbi{ .arena = arena, .payload = p };

    // Re-verify every type's layout against native x86-64 DataLayout rules
    for (p.types) |t| {
        if (isForbiddenKind(t.kind)) return error.ForbiddenAbiType;
        if (!id.isValidDigest(t.id)) return error.InvalidLayout;
        if (t.@"align" == 0 or !std.math.isPowerOfTwo(t.@"align") or t.byteSize != t.stride) {
            return error.InvalidLayout;
        }
        if (std.mem.eql(u8, t.kind, "scalar")) {
            const sa = scalarSizeAlign(t.name) orelse return error.InvalidLayout;
            if (t.byteSize != sa[0] or t.@"align" != sa[1]) return error.InvalidLayout;
        } else if (std.mem.eql(u8, t.kind, "struct")) {
            var off: u32 = 0;
            var max_a: u32 = 1;
            for (t.fields) |f| {
                const ft = verified.findType(f.type) orelse return error.InvalidLayout;
                const aligned = std.mem.alignForward(u32, off, ft.@"align");
                if (f.offset != aligned) return error.InvalidLayout;
                off = aligned + ft.byteSize;
                max_a = @max(max_a, ft.@"align");
            }
            const total = std.mem.alignForward(u32, off, max_a);
            if (t.@"align" != max_a or t.byteSize != total) return error.InvalidLayout;
        } else if (std.mem.eql(u8, t.kind, "handle")) {
            if (t.byteSize != 8 or t.@"align" != 4) return error.InvalidHandleLayout;
        } else if (std.mem.eql(u8, t.kind, "span") or std.mem.eql(u8, t.kind, "read_span") or std.mem.eql(u8, t.kind, "string_view")) {
            if (t.byteSize != 16 or t.@"align" != 8) return error.InvalidLayout;
        }
    }

    return verified;
}

/// Runtime ABI handshake helper usable by generated Zig bindings & C/Zig hosts.
pub fn verifyAbiHandshakeRaw(
    expected_hash: []const u8,
    actual_hash: []const u8,
    expected_triple: []const u8,
    actual_triple: []const u8,
) bool {
    return std.mem.eql(u8, expected_hash, actual_hash) and std.mem.eql(u8, expected_triple, actual_triple);
}

test "r04-abi runtime handshake accepts exact match and rejects mismatch" {
    const h = id.SCHEMA_ABI;
    try std.testing.expect(verifyAbiHandshakeRaw(h, h, id.TARGET_TRIPLE, id.TARGET_TRIPLE));
    try std.testing.expect(!verifyAbiHandshakeRaw(h, id.SCHEMA_TMETA, id.TARGET_TRIPLE, id.TARGET_TRIPLE));
    try std.testing.expect(!verifyAbiHandshakeRaw(h, h, id.TARGET_TRIPLE, "x86_64-unknown-linux-gnu"));
}
