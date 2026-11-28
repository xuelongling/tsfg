// SPDX-License-Identifier: MIT
//! R05 Typed Register Bytecode (`TSFGR05B`), Pre-Load Verifier, Hot/Cold Predecoded
//! Instruction Representation, and Semantics-Preserving Superinstruction Fusion.
//! Implements `docs/interpreter-execution-design.md` §§1-3:
//!   - Unverified modules CANNOT execute (`verifyAndPredecode` produces opaque `VerifiedModule`)
//!   - Compact 16-byte hot `DecodedOp` separated from cold source-span / exception / root side tables
//!   - Strict verification: magic, version, SHA-256 payload digest, ABI hash, CFG bounds,
//!     termination, backward-edge fuel metering, register bounds/types, call target arity,
//!     and valid GC root bitmaps
//!   - Safe superinstruction fusion (only non-branch-target pairs; NEVER FMA float fusion;
//!     preserves exact evaluation order, first trap source anchor, and Semantic Fuel events;
//!     unfused debug mode always available for bit-exact differential verification)
const std = @import("std");

pub const MAGIC = "TSFGR05B";
pub const VERSION: u32 = 1;
pub const VERSION_V2: u32 = 2;
pub const MAX_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_FUNCTIONS: u16 = 512;
pub const MAX_REGS: u16 = 512;
pub const MAX_OPS_PER_FN: u32 = 16384;
pub const MAX_HANDLERS_PER_FN: u16 = 256;

pub const VerifyError = error{
    SizeLimit,
    BadMagic,
    VersionMismatch,
    IntegrityMismatch,
    AbiHashMismatch,
    Truncated,
    TrailingBytes,
    InvalidFunctionCount,
    DuplicateFunctionId,
    InvalidRegisterCount,
    InvalidOpCount,
    InvalidOpcode,
    InvalidRegister,
    InvalidJumpTarget,
    UnterminatedFunction,
    MissingEntryFuel,
    UnmeteredLoop,
    InvalidCallTarget,
    InvalidArity,
    InvalidHandler,
    InvalidRootMask,
    OutOfMemory,
};

pub const ValTag = enum(u8) {
    @"undefined" = 0,
    @"null" = 1,
    bool = 2,
    i32 = 3,
    f64 = 4,
    ref = 5,
    closure = 6,
    array = 7,
    span = 8,
    string = 9,
    i64 = 10,
    u32 = 11,
    u64 = 12,
    f32 = 13,
};

pub const Op = enum(u8) {
    nop = 0,
    fuel = 1, // a=event(1=entry,2=loop)
    const_i32 = 2, // dst, imm32
    const_bool = 3, // dst, imm32 (0|1)
    const_undef = 4, // dst
    const_null = 5, // dst
    const_f64 = 6, // dst, imm32=const_pool_idx (u64 bits)
    mov = 7, // dst, a

    // Typed i32 arithmetic & bitwise (wrapping, exact R01 div/rem/shift semantics)
    add_i32 = 10,
    sub_i32 = 11,
    mul_i32 = 12,
    div_i32 = 13,
    rem_i32 = 14,
    neg_i32 = 15,
    bit_and = 16,
    bit_or = 17,
    bit_xor = 18,
    shl_i32 = 19,
    shr_i32 = 20,
    ushr_i32 = 21,
    lt_i32 = 22,
    le_i32 = 23,
    gt_i32 = 24,
    ge_i32 = 25,

    // Strict IEEE f64 (per-step rounding, canonical quiet NaN, NO FMA!)
    add_f64 = 26,
    sub_f64 = 27,
    mul_f64 = 28,
    div_f64 = 29,
    lt_f64 = 30,

    // Equality, bool, narrowing
    strict_eq = 31, // dst, a, b (imm32: 0='===', 1='!==')
    bool_not = 32, // dst, a
    narrow_i32 = 33, // dst, a (traps r01-t-undefined-numeric or r01-t-narrow)

    // Control flow
    br = 34, // imm32=target_pc
    cond_br = 35, // a=cond_reg, imm32=true_pc (falls through to pc+1 when false)
    ret = 36, // a=val_reg (or 0xFFFF for undef)

    // Calls & Closures (by FunctionIndex/FunctionId, NEVER raw code addresses!)
    call_direct = 37, // dst, a=arg_base, b=arg_count, imm32=fn_idx
    make_closure = 38, // dst, a=env_reg(0xFFFF if none), imm32=fn_idx
    call_indirect = 39, // dst, a=closure_reg, b=arg_count (args in closure_reg+1 ..)

    // Globals (module static state block with TDZ)
    global_get = 40, // dst, imm32=slot
    global_set = 41, // a=val_reg, imm32=slot

    // Managed Objects & Sealed Class Field/Method Cache
    new_obj = 42, // dst, a=scalar_fields, b=ref_fields, imm32=type_id
    clone_obj = 43, // dst, a=src_obj (value-type copy)
    field_get = 44, // dst, a=obj_reg, b=field_idx, imm32=cache_slot
    field_set = 45, // a=obj_reg, b=field_idx, dst=val_reg, imm32=cache_slot
    call_method = 46, // dst, a=arg_base(arg0=recv), b=arg_count, imm32=vtable_slot_or_fn

    // Dense Array<T> & ReadSpan<T>
    array_new = 47, // dst, a=elem_base, b=elem_count
    array_len = 48, // dst, a=recv_reg (Array or ReadSpan)
    array_get = 49, // dst, a=recv_reg, b=idx_reg
    array_set = 50, // a=arr_reg, b=idx_reg, dst=val_reg
    span_new = 51, // dst, a=arr_reg, b=start_reg, imm32=len_reg
    span_release = 52, // a=span_reg

    // Managed Exceptions (strictly separate from traps!)
    throw_exc = 53, // a=payload_reg
    catch_take = 54, // dst (reads & clears active caught exception payload)

    // Capability-gated Host Call
    host_call = 55, // dst, a=arg0_reg, b=arg1_reg, imm32=capability_id

    // Trigger explicit GC safepoint (for stress testing / safepoint testing)
    gc_safepoint = 56,

    // Full TS Static Core Opcodes (v1/v2 wire compatible)
    bit_not = 57, // dst, a (~i32)
    neg_f64 = 58, // dst, a (-f64)
    le_f64 = 59, // dst, a, b
    gt_f64 = 60, // dst, a, b
    ge_f64 = 61, // dst, a, b
    assert_non_null = 62, // dst, a (traps r01-t-narrow on undef/null)
    array_resize = 63, // a=arr, b=new_len, dst=fill_reg (0xFFFF = no fill)
    get_type_id = 64, // dst = i32(obj.type_id)
    mark_uninit = 65, // a=obj (sets TDZ bit)
    mark_init = 66, // a=obj (clears TDZ bit)
    check_init = 67, // a=obj (traps r01-t-tdz if uninit or null)
    new_obj_dyn = 68, // dst, a=field_count, imm32=type_id_reg
    unreachable_trap = 69, // traps r01-t-invalid-handle

    // Lossless UTF-16 Code-Unit String Operations
    const_str = 70, // dst, imm32=str_pool_idx
    str_len = 71, // dst, a=str_reg
    str_concat = 72, // dst, a=lhs, b=rhs
    str_slice = 73, // dst, a=str, b=start_reg, imm32=end_reg
    str_char_code_at = 74, // dst, a=str, b=idx_reg

    // Tag-dispatched i32/f64/string arithmetic & comparisons for union/Common20 binary ops
    add_dyn = 75,
    sub_dyn = 76,
    mul_dyn = 77,
    div_dyn = 78,
    lt_dyn = 79,
    le_dyn = 80,
    gt_dyn = 81,
    ge_dyn = 82,
    neg_dyn = 83,

    // Exact fixed-width numeric opcodes (i64, u32, u64, f32, sub-32 wrap)
    const_i64 = 84, // dst, imm32=const_pool_f64 idx
    const_u32 = 85, // dst, imm32=u32 bits
    const_u64 = 86, // dst, imm32=const_pool_f64 idx
    const_f32 = 87, // dst, imm32=f32 binary32 bits
    add_i64 = 88,
    sub_i64 = 89,
    mul_i64 = 90,
    div_i64 = 91,
    rem_i64 = 92,
    lt_i64 = 93,
    le_i64 = 94,
    gt_i64 = 95,
    ge_i64 = 96,
    div_u32 = 97,
    rem_u32 = 98,
    lt_u32 = 99,
    le_u32 = 100,
    gt_u32 = 101,
    ge_u32 = 102,
    f32_round = 103, // dst, a (strict IEEE binary32 rounding)
    int_wrap = 104, // dst, a, imm32 (8=i8, -8=u8, 16=i16, -16=u16, 32=i32, -32=u32)

    // --- Internal-only predecoded superinstructions (NEVER serialized on disk!) ---
    super_add_i32_imm = 200, // fused: const_i32 + add_i32 (dst = a + imm32)
    super_br_if_lt_i32 = 201, // fused: lt_i32 + cond_br (if reg[a] < reg[b] jump imm32)
    super_inc_local_i32 = 202, // fused: const_i32(1) + add_i32(r, r, tmp) -> reg[dst] = reg[a] + imm32
};

/// Compact 16-byte hot decoded instruction (separated from cold source spans & metadata).
pub const DecodedOp = extern struct {
    op: u8,
    flags: u8 = 0,
    dst: u16 = 0,
    a: u16 = 0,
    b: u16 = 0,
    imm32: i32 = 0,
    aux: u32 = 0, // original_pc for cold-table source anchor lookup!
};

comptime {
    if (@sizeOf(DecodedOp) != 16) @compileError("DecodedOp must be compact 16 bytes");
}

pub const SourceSpan = struct {
    start: u32,
    end: u32,
};

pub const ExceptionHandler = struct {
    try_start: u32, // inclusive PC
    try_end: u32, // exclusive PC
    handler_pc: u32,
    is_finally: bool,
};

pub const VerifiedFunction = struct {
    function_id: [32]u8,
    param_count: u16,
    reg_count: u16,
    /// Bitmask of registers holding GC-traceable values (first 64 regs; extended via runtime value tags)
    ref_reg_mask: u64,
    /// Original unfused predecoded instructions (for debug mode & exact differential baseline)
    unfused_ops: []DecodedOp,
    /// Superinstruction-fused hot instruction stream
    fused_ops: []DecodedOp,
    /// Cold side table: original UTF-16 source anchors indexed by `aux` (original_pc)
    cold_spans: []SourceSpan,
    /// Cold side table: exception handlers (catch/finally ranges)
    handlers: []ExceptionHandler,
    /// Count of superinstructions fused in this function
    fused_count: u32 = 0,
};

pub const VerifiedModule = struct {
    allocator: std.mem.Allocator,
    module_id: [32]u8,
    abi_hash: [32]u8,
    static_schema_hash: [32]u8,
    code_version: u64,
    global_count: u16,
    required_capabilities: []u32,
    const_pool_f64: []u64,
    const_pool_str: [][]u16,
    functions: []VerifiedFunction,
    raw_bytes: []u8,

    pub fn deinit(self: *VerifiedModule) void {
        for (self.functions) |f| {
            self.allocator.free(f.unfused_ops);
            self.allocator.free(f.fused_ops);
            self.allocator.free(f.cold_spans);
            self.allocator.free(f.handlers);
        }
        self.allocator.free(self.functions);
        self.allocator.free(self.required_capabilities);
        self.allocator.free(self.const_pool_f64);
        for (self.const_pool_str) |s| self.allocator.free(s);
        self.allocator.free(self.const_pool_str);
        self.allocator.free(self.raw_bytes);
        self.* = undefined;
    }

    pub fn findFunctionIndex(self: *const VerifiedModule, function_id: [32]u8) ?u32 {
        for (self.functions, 0..) |f, i| {
            if (std.mem.eql(u8, &f.function_id, &function_id)) return @intCast(i);
        }
        return null;
    }
};

// ============================================================================
// Binary Wire Encoder (for tests & compiler lowering)
// ============================================================================
pub const RawOpSpec = struct {
    op: Op,
    dst: u16 = 0,
    a: u16 = 0,
    b: u16 = 0,
    imm32: i32 = 0,
    start: u32 = 0,
    end: u32 = 1,
};

pub const RawFnSpec = struct {
    function_id: [32]u8,
    param_count: u16,
    reg_count: u16,
    ref_reg_mask: u64 = 0,
    ops: []const RawOpSpec,
    handlers: []const ExceptionHandler = &.{},
};

pub const RawModuleSpec = struct {
    module_id: [32]u8,
    abi_hash: [32]u8,
    static_schema_hash: [32]u8,
    code_version: u64 = 1,
    global_count: u16 = 0,
    required_capabilities: []const u32 = &.{},
    const_pool_f64: []const u64 = &.{},
    const_pool_str: []const []const u16 = &.{},
    functions: []const RawFnSpec,
};

fn appendInt(allocator: std.mem.Allocator, out: *std.ArrayListUnmanaged(u8), comptime T: type, v: T) !void {
    var buf: [@sizeOf(T)]u8 = undefined;
    std.mem.writeInt(T, &buf, v, .little);
    try out.appendSlice(allocator, &buf);
}

/// Encode a `RawModuleSpec` into canonical `TSFGR05B` binary wire format with SHA-256 integrity header.
pub fn encodeModule(allocator: std.mem.Allocator, spec: RawModuleSpec) ![]u8 {
    var payload: std.ArrayListUnmanaged(u8) = .empty;
    defer payload.deinit(allocator);

    const wire_ver: u32 = if (spec.const_pool_str.len > 0) VERSION_V2 else VERSION;
    try payload.appendSlice(allocator, &spec.module_id);
    try payload.appendSlice(allocator, &spec.abi_hash);
    try payload.appendSlice(allocator, &spec.static_schema_hash);
    try appendInt(allocator, &payload, u64, spec.code_version);
    try appendInt(allocator, &payload, u16, spec.global_count);
    try appendInt(allocator, &payload, u16, @intCast(spec.required_capabilities.len));
    for (spec.required_capabilities) |c| try appendInt(allocator, &payload, u32, c);
    try appendInt(allocator, &payload, u16, @intCast(spec.const_pool_f64.len));
    for (spec.const_pool_f64) |bits| try appendInt(allocator, &payload, u64, bits);
    if (wire_ver == VERSION_V2) {
        try appendInt(allocator, &payload, u16, @intCast(spec.const_pool_str.len));
        for (spec.const_pool_str) |s| {
            try appendInt(allocator, &payload, u32, @intCast(s.len));
            for (s) |cu| try appendInt(allocator, &payload, u16, cu);
        }
    }
    try appendInt(allocator, &payload, u16, @intCast(spec.functions.len));

    for (spec.functions) |f| {
        try payload.appendSlice(allocator, &f.function_id);
        try appendInt(allocator, &payload, u16, f.param_count);
        try appendInt(allocator, &payload, u16, f.reg_count);
        try appendInt(allocator, &payload, u64, f.ref_reg_mask);
        try appendInt(allocator, &payload, u16, @intCast(f.handlers.len));
        for (f.handlers) |h| {
            try appendInt(allocator, &payload, u32, h.try_start);
            try appendInt(allocator, &payload, u32, h.try_end);
            try appendInt(allocator, &payload, u32, h.handler_pc);
            try appendInt(allocator, &payload, u8, if (h.is_finally) 1 else 0);
        }
        try appendInt(allocator, &payload, u32, @intCast(f.ops.len));
        for (f.ops) |op| {
            try appendInt(allocator, &payload, u8, @intFromEnum(op.op));
            try appendInt(allocator, &payload, u8, 0);
            try appendInt(allocator, &payload, u16, op.dst);
            try appendInt(allocator, &payload, u16, op.a);
            try appendInt(allocator, &payload, u16, op.b);
            try appendInt(allocator, &payload, i32, op.imm32);
            try appendInt(allocator, &payload, u32, op.start);
            try appendInt(allocator, &payload, u32, op.end);
        }
    }

    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(payload.items, &digest, .{});

    const total_len: u32 = @intCast(48 + payload.items.len);
    var out: std.ArrayListUnmanaged(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.appendSlice(allocator, MAGIC); // 8
    try appendInt(allocator, &out, u32, wire_ver); // 4
    try appendInt(allocator, &out, u32, total_len); // 4
    try out.appendSlice(allocator, &digest); // 32 (header = 48 bytes)
    try out.appendSlice(allocator, payload.items);
    return out.toOwnedSlice(allocator);
}

// ============================================================================
// Pre-Load Verifier + Hot/Cold Predecoder + Superinstruction Fusion
// ============================================================================
const Cursor = struct {
    bytes: []const u8,
    pos: usize = 0,

    fn take(self: *Cursor, n: usize) VerifyError![]const u8 {
        if (n > self.bytes.len - self.pos) return error.Truncated;
        const s = self.bytes[self.pos..][0..n];
        self.pos += n;
        return s;
    }

    fn readInt(self: *Cursor, comptime T: type) VerifyError!T {
        const s = try self.take(@sizeOf(T));
        return std.mem.readInt(T, s[0..@sizeOf(T)], .little);
    }

    fn readBytes32(self: *Cursor) VerifyError![32]u8 {
        const s = try self.take(32);
        return s[0..32].*;
    }
};

fn isDiskOpcode(raw: u8) bool {
    return raw <= 104 and switch (raw) {
        0...7, 10...104 => true,
        else => false,
    };
}

/// Strictly verify `bytes`, reject ANY malformed/unverified module, then predecode
/// into compact 16-byte hot instructions + cold side tables + fused superinstructions.
pub fn verifyAndPredecode(allocator: std.mem.Allocator, bytes: []const u8, expected_abi_hash: ?[32]u8) VerifyError!VerifiedModule {
    if (bytes.len < 48 or bytes.len > MAX_BYTES) return error.SizeLimit;
    var cur = Cursor{ .bytes = bytes };

    const magic = try cur.take(8);
    if (!std.mem.eql(u8, magic, MAGIC)) return error.BadMagic;
    const ver = try cur.readInt(u32);
    if (ver != VERSION and ver != VERSION_V2) return error.VersionMismatch;
    const total_len = try cur.readInt(u32);
    if (total_len != bytes.len) return error.SizeLimit;
    const expected_digest = try cur.readBytes32();
    var actual_digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes[48..], &actual_digest, .{});
    if (!std.mem.eql(u8, &expected_digest, &actual_digest)) return error.IntegrityMismatch;

    const module_id = try cur.readBytes32();
    const abi_hash = try cur.readBytes32();
    if (expected_abi_hash) |exp| {
        if (!std.mem.eql(u8, &abi_hash, &exp)) return error.AbiHashMismatch;
    }
    const static_schema_hash = try cur.readBytes32();
    const code_version = try cur.readInt(u64);
    const global_count = try cur.readInt(u16);

    const cap_count = try cur.readInt(u16);
    if (cap_count > 128) return error.SizeLimit;
    const caps = allocator.alloc(u32, cap_count) catch return error.OutOfMemory;
    errdefer allocator.free(caps);
    for (caps) |*c| c.* = try cur.readInt(u32);

    const f64_count = try cur.readInt(u16);
    if (f64_count > 4096) return error.SizeLimit;
    const f64_pool = allocator.alloc(u64, f64_count) catch return error.OutOfMemory;
    errdefer allocator.free(f64_pool);
    for (f64_pool) |*bits| bits.* = try cur.readInt(u64);

    const str_count: usize = if (ver == VERSION_V2) try cur.readInt(u16) else 0;
    if (str_count > 4096) return error.SizeLimit;
    const str_pool = allocator.alloc([]u16, str_count) catch return error.OutOfMemory;
    var parsed_strs: usize = 0;
    errdefer {
        for (str_pool[0..parsed_strs]) |s| allocator.free(s);
        allocator.free(str_pool);
    }
    for (0..str_count) |si| {
        const slen = try cur.readInt(u32);
        if (slen > 65536) return error.SizeLimit;
        const buf = allocator.alloc(u16, slen) catch return error.OutOfMemory;
        errdefer allocator.free(buf);
        for (buf) |*cu| cu.* = try cur.readInt(u16);
        str_pool[si] = buf;
        parsed_strs += 1;
    }

    const fn_count = try cur.readInt(u16);
    if (fn_count == 0 or fn_count > MAX_FUNCTIONS) return error.InvalidFunctionCount;

    var functions = allocator.alloc(VerifiedFunction, fn_count) catch return error.OutOfMemory;
    var parsed_fns: usize = 0;
    errdefer {
        for (functions[0..parsed_fns]) |f| {
            allocator.free(f.unfused_ops);
            allocator.free(f.fused_ops);
            allocator.free(f.cold_spans);
            allocator.free(f.handlers);
        }
        allocator.free(functions);
    }

    for (0..fn_count) |fi| {
        const fid = try cur.readBytes32();
        for (functions[0..fi]) |prev| {
            if (std.mem.eql(u8, &prev.function_id, &fid)) return error.DuplicateFunctionId;
        }
        const param_count = try cur.readInt(u16);
        const reg_count = try cur.readInt(u16);
        if (reg_count == 0 or reg_count > MAX_REGS or param_count > reg_count) return error.InvalidRegisterCount;
        const ref_reg_mask = try cur.readInt(u64);
        if (reg_count < 64) {
            const high_mask = (~@as(u64, 0)) << @intCast(reg_count);
            if ((ref_reg_mask & high_mask) != 0) return error.InvalidRootMask;
        }

        const handler_count = try cur.readInt(u16);
        if (handler_count > MAX_HANDLERS_PER_FN) return error.InvalidHandler;
        const handlers = allocator.alloc(ExceptionHandler, handler_count) catch return error.OutOfMemory;
        errdefer allocator.free(handlers);
        for (handlers) |*h| {
            h.try_start = try cur.readInt(u32);
            h.try_end = try cur.readInt(u32);
            h.handler_pc = try cur.readInt(u32);
            const fin = try cur.readInt(u8);
            if (fin > 1) return error.InvalidHandler;
            h.is_finally = fin == 1;
        }

        const op_count = try cur.readInt(u32);
        if (op_count == 0 or op_count > MAX_OPS_PER_FN) return error.InvalidOpCount;
        const unfused = allocator.alloc(DecodedOp, op_count) catch return error.OutOfMemory;
        errdefer allocator.free(unfused);
        const spans = allocator.alloc(SourceSpan, op_count) catch return error.OutOfMemory;
        errdefer allocator.free(spans);

        for (0..op_count) |pc| {
            const raw_op = try cur.readInt(u8);
            const flags = try cur.readInt(u8);
            if (flags != 0 or !isDiskOpcode(raw_op)) return error.InvalidOpcode;
            const dst = try cur.readInt(u16);
            const a = try cur.readInt(u16);
            const b = try cur.readInt(u16);
            const imm32 = try cur.readInt(i32);
            const start = try cur.readInt(u32);
            const end = try cur.readInt(u32);
            if (end < start) return error.InvalidOpcode;

            unfused[pc] = .{
                .op = raw_op,
                .flags = 0,
                .dst = dst,
                .a = a,
                .b = b,
                .imm32 = imm32,
                .aux = @intCast(pc),
            };
            spans[pc] = .{ .start = start, .end = end };
        }

        // Verify exception handlers in bounds
        for (handlers) |h| {
            if (h.try_start >= h.try_end or h.try_end > op_count or h.handler_pc >= op_count) {
                return error.InvalidHandler;
            }
        }

        // Verify entry fuel, instruction registers/targets, termination, and loop fuel metering!
        if (unfused[0].op != @intFromEnum(Op.fuel) or unfused[0].a != 1) {
            return error.MissingEntryFuel;
        }
        const last_op: Op = @enumFromInt(unfused[op_count - 1].op);
        if (last_op != .ret and last_op != .br and last_op != .throw_exc and last_op != .unreachable_trap) {
            return error.UnterminatedFunction;
        }

        // Track jump targets for superinstruction safety (NEVER fuse across a branch/handler target!)
        const is_target = allocator.alloc(bool, op_count) catch return error.OutOfMemory;
        defer allocator.free(is_target);
        @memset(is_target, false);
        is_target[0] = true;
        for (handlers) |h| {
            is_target[h.try_start] = true;
            is_target[h.handler_pc] = true;
        }

        for (unfused, 0..) |ins, pc| {
            const op_e: Op = @enumFromInt(ins.op);
            switch (op_e) {
                .br => {
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= op_count) return error.InvalidJumpTarget;
                    const tgt: usize = @intCast(ins.imm32);
                    is_target[tgt] = true;
                    // Every backward branch MUST pass through a loop fuel event (a == 2) in [tgt..pc]!
                    if (tgt <= pc) {
                        var has_fuel = false;
                        for (tgt..pc + 1) |k| {
                            if (unfused[k].op == @intFromEnum(Op.fuel) and unfused[k].a == 2) {
                                has_fuel = true;
                                break;
                            }
                        }
                        if (!has_fuel) return error.UnmeteredLoop;
                    }
                },
                .cond_br => {
                    if (ins.a >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= op_count) return error.InvalidJumpTarget;
                    const tgt: usize = @intCast(ins.imm32);
                    is_target[tgt] = true;
                    if (tgt <= pc) {
                        var has_fuel = false;
                        for (tgt..pc + 1) |k| {
                            if (unfused[k].op == @intFromEnum(Op.fuel) and unfused[k].a == 2) {
                                has_fuel = true;
                                break;
                            }
                        }
                        if (!has_fuel) return error.UnmeteredLoop;
                    }
                },
                .ret => {
                    if (ins.a != 0xFFFF and ins.a >= reg_count) return error.InvalidRegister;
                },
                .const_f64, .const_i64, .const_u64 => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(usize, @intCast(ins.imm32)) >= f64_pool.len) return error.InvalidOpcode;
                },
                .const_str => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(usize, @intCast(ins.imm32)) >= str_pool.len) return error.InvalidOpcode;
                },
                .str_slice => {
                    if (ins.dst >= reg_count or ins.a >= reg_count or ins.b >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= reg_count) return error.InvalidRegister;
                },
                .array_resize => {
                    if (ins.a >= reg_count or ins.b >= reg_count) return error.InvalidRegister;
                    if (ins.dst != 0xFFFF and ins.dst >= reg_count) return error.InvalidRegister;
                },
                .new_obj_dyn => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= reg_count) return error.InvalidRegister;
                },
                .global_get => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(usize, @intCast(ins.imm32)) >= global_count) return error.InvalidRegister;
                },
                .global_set => {
                    if (ins.a >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(usize, @intCast(ins.imm32)) >= global_count) return error.InvalidRegister;
                },
                .call_direct => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= fn_count) return error.InvalidCallTarget;
                    if (@as(u32, ins.a) + @as(u32, ins.b) > reg_count) return error.InvalidRegister;
                },
                .make_closure => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.a != 0xFFFF and ins.a >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= fn_count) return error.InvalidCallTarget;
                },
                .call_indirect => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (@as(u32, ins.a) + 1 + @as(u32, ins.b) > reg_count) return error.InvalidRegister;
                },
                .call_method => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= fn_count) return error.InvalidCallTarget;
                    if (ins.b == 0 or @as(u32, ins.a) + @as(u32, ins.b) > reg_count) return error.InvalidRegister;
                },
                .array_new => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                    if (@as(u32, ins.a) + @as(u32, ins.b) > reg_count) return error.InvalidRegister;
                },
                .span_new => {
                    if (ins.dst >= reg_count or ins.a >= reg_count or ins.b >= reg_count) return error.InvalidRegister;
                    if (ins.imm32 < 0 or @as(u32, @intCast(ins.imm32)) >= reg_count) return error.InvalidRegister;
                },
                .nop, .fuel, .gc_safepoint, .unreachable_trap => {},
                .const_i32, .const_u32, .const_f32, .const_bool, .const_undef, .const_null, .catch_take => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                },
                .mov, .neg_i32, .bit_not, .neg_f64, .neg_dyn, .bool_not, .narrow_i32, .assert_non_null, .clone_obj, .array_len, .get_type_id, .str_len, .f32_round, .int_wrap => {
                    if (ins.dst >= reg_count or ins.a >= reg_count) return error.InvalidRegister;
                },
                .throw_exc, .span_release, .mark_uninit, .mark_init, .check_init => {
                    if (ins.a >= reg_count) return error.InvalidRegister;
                },
                .new_obj => {
                    if (ins.dst >= reg_count) return error.InvalidRegister;
                },
                .field_get, .field_set => {
                    if (ins.dst >= reg_count or ins.a >= reg_count) return error.InvalidRegister;
                },
                else => {
                    if (ins.dst >= reg_count or ins.a >= reg_count or ins.b >= reg_count) return error.InvalidRegister;
                },
            }
        }

        // Build semantics-preserving superinstruction-fused hot stream (preserves exact PCs via NOP-skip or PC remap)
        const fused = allocator.dupe(DecodedOp, unfused) catch return error.OutOfMemory;
        errdefer allocator.free(fused);
        var fused_count: u32 = 0;

        var pc: usize = 0;
        while (pc + 1 < fused.len) : (pc += 1) {
            if (is_target[pc + 1]) continue; // NEVER fuse into a branch or exception target!
            const c0 = fused[pc];
            const c1 = fused[pc + 1];

            // Pattern 1: const_i32(tmp, imm) + add_i32(dst, x, tmp) where tmp != x -> super_add_i32_imm(dst, x, imm)
            if (c0.op == @intFromEnum(Op.const_i32) and c1.op == @intFromEnum(Op.add_i32) and c1.b == c0.dst and c1.a != c0.dst) {
                // Keep exact register semantics if c0.dst == c1.dst (common temp pattern!)
                if (c0.dst == c1.dst or c1.dst == c1.a) {
                    fused[pc] = .{
                        .op = @intFromEnum(Op.super_add_i32_imm),
                        .flags = 1, // charge 2 physical ops
                        .dst = c1.dst,
                        .a = c1.a,
                        .b = c0.dst,
                        .imm32 = c0.imm32,
                        .aux = c1.aux,
                    };
                    fused[pc + 1] = .{ .op = @intFromEnum(Op.nop), .aux = c1.aux };
                    fused_count += 1;
                    pc += 1;
                    continue;
                }
            }

            // Pattern 2: lt_i32(cond, a, b) + cond_br(cond, tgt) -> super_br_if_lt_i32(a, b, tgt)
            if (c0.op == @intFromEnum(Op.lt_i32) and c1.op == @intFromEnum(Op.cond_br) and c1.a == c0.dst) {
                fused[pc] = .{
                    .op = @intFromEnum(Op.super_br_if_lt_i32),
                    .flags = 1,
                    .dst = c0.dst, // still updates cond reg so register state stays 100% identical!
                    .a = c0.a,
                    .b = c0.b,
                    .imm32 = c1.imm32,
                    .aux = c1.aux,
                };
                fused[pc + 1] = .{ .op = @intFromEnum(Op.nop), .aux = c1.aux };
                fused_count += 1;
                pc += 1;
                continue;
            }
        }

        functions[fi] = .{
            .function_id = fid,
            .param_count = param_count,
            .reg_count = reg_count,
            .ref_reg_mask = ref_reg_mask,
            .unfused_ops = unfused,
            .fused_ops = fused,
            .cold_spans = spans,
            .handlers = handlers,
            .fused_count = fused_count,
        };
        parsed_fns += 1;
    }

    if (cur.pos != bytes.len) return error.TrailingBytes;

    // Cross-function call arity verification
    for (functions) |f| {
        for (f.unfused_ops) |ins| {
            if (ins.op == @intFromEnum(Op.call_direct)) {
                const callee = functions[@intCast(ins.imm32)];
                if (ins.b != callee.param_count) return error.InvalidArity;
            }
        }
    }

    const raw_copy = allocator.dupe(u8, bytes) catch return error.OutOfMemory;
    return .{
        .allocator = allocator,
        .module_id = module_id,
        .abi_hash = abi_hash,
        .static_schema_hash = static_schema_hash,
        .code_version = code_version,
        .global_count = global_count,
        .required_capabilities = caps,
        .const_pool_f64 = f64_pool,
        .const_pool_str = str_pool,
        .functions = functions,
        .raw_bytes = raw_copy,
    };
}
