// SPDX-License-Identifier: MIT
//! Zig Runtime strict validators for R04 artifact & protocol families:
//!   - tsfg.tmeta (v1)
//!   - tsfg.core-ir-exchange (v1)
//!   - tsfg.native-patch (v1, .tpatch — cross-tier call + AOT GC safepoint root map)
//!   - tsfg.module-reload (v1 — explicit transactional schema migration)
//!   - tsfg.compiler-service (v1 — versioned RPC request/response)
const std = @import("std");
const id = @import("r04-identity.zig");

pub const ProtocolError = id.EnvelopeError || error{
    InvalidDigest,
    WrongTarget,
    ReflectionDigestMismatch,
    IrDigestMismatch,
    UnsupportedDialect,
    DataMigrationForbidden,
    StaleCodeVersion,
    AbiHashMismatch,
    StaticSchemaMismatch,
    SignatureMismatch,
    EffectMismatch,
    CaptureLayoutMismatch,
    InvalidTierAdapter,
    InvalidArtifactFormat,
    InvalidRootKind,
    InvalidRootSlot,
    DuplicateRootSlot,
    InvalidReloadPhase,
    InvalidMigrationMode,
    InvalidEpochSequence,
    MissingMigrationHook,
    InvalidRollbackPolicy,
    InvalidServiceDirection,
    InvalidServiceOperation,
    InvalidServiceStatus,
    InvalidDiagnosticState,
    StaleEpoch,
    ContractSetMismatch,
    OutOfMemory,
};

pub const TargetInfo = struct {
    llvmDataLayout: []const u8,
    pointerBits: u32,
    target: []const u8,
    triple: []const u8,
};

fn validateTarget(t: TargetInfo) ProtocolError!void {
    if (!std.mem.eql(u8, t.target, id.TARGET_NAME) or
        !std.mem.eql(u8, t.triple, id.TARGET_TRIPLE) or
        !std.mem.eql(u8, t.llvmDataLayout, id.WINDOWS_X64_DATALAYOUT) or
        t.pointerBits != 64)
    {
        return error.WrongTarget;
    }
}

// ============================================================================
// 1. tsfg.tmeta (v1)
// ============================================================================
pub const TmetaFunction = struct {
    captureLayoutHash: []const u8,
    effectHash: []const u8,
    functionId: []const u8,
    name: []const u8,
    signatureHash: []const u8,
    staticSchemaHash: []const u8,
};

pub const TmetaPayload = struct {
    abiHash: []const u8,
    components: []const []const u8,
    contractSetId: []const u8,
    functions: []const TmetaFunction,
    inputIdentity: []const u8,
    reflectionDigest: []const u8,
    target: TargetInfo,
};

pub fn validateTmetaEnvelope(allocator: std.mem.Allocator, bytes: []const u8, expected_abi_hash: ?[]const u8) ProtocolError!void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.tmeta", 1, "1", id.SCHEMA_TMETA, 8388608, 64);
    const parsed = std.json.parseFromSlice(TmetaPayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    try validateTarget(p.target);
    if (!id.isValidDigest(p.abiHash) or !id.isValidDigest(p.contractSetId) or
        !id.isValidDigest(p.inputIdentity) or !id.isValidDigest(p.reflectionDigest))
    {
        return error.InvalidDigest;
    }
    if (expected_abi_hash) |exp| {
        if (!std.mem.eql(u8, p.abiHash, exp)) return error.AbiHashMismatch;
    }
    for (p.functions) |f| {
        if (!id.isValidDigest(f.functionId) or !id.isValidDigest(f.signatureHash) or
            !id.isValidDigest(f.effectHash) or !id.isValidDigest(f.captureLayoutHash) or
            !id.isValidDigest(f.staticSchemaHash))
        {
            return error.InvalidDigest;
        }
    }
}

// ============================================================================
// 2. tsfg.core-ir-exchange (v1)
// ============================================================================
pub const CoreIrExchangePayload = struct {
    abiHash: []const u8,
    canonicalIr: []const u8,
    contractSetId: []const u8,
    inputIdentity: []const u8,
    irDialect: []const u8,
    irDigest: []const u8,
    sourceDigest: []const u8,
    target: TargetInfo,
};

pub fn validateCoreIrExchange(allocator: std.mem.Allocator, bytes: []const u8) ProtocolError!void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.core-ir-exchange", 1, "1", id.SCHEMA_CORE_IR_EXCHANGE, 8388608, 32);
    const parsed = std.json.parseFromSlice(CoreIrExchangePayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    try validateTarget(p.target);
    if (!std.mem.eql(u8, p.irDialect, "tsfg_core") and
        !std.mem.eql(u8, p.irDialect, "tsfg_program") and
        !std.mem.eql(u8, p.irDialect, "tsfg_query"))
    {
        return error.UnsupportedDialect;
    }
    if (p.canonicalIr.len == 0 or !id.isValidDigest(p.abiHash) or !id.isValidDigest(p.irDigest)) {
        return error.InvalidDigest;
    }
    const actual_ir = id.sha256Parts(&.{p.canonicalIr});
    if (!std.mem.eql(u8, p.irDigest, &actual_ir)) return error.IrDigestMismatch;
}

// ============================================================================
// 3. tsfg.native-patch (v1, .tpatch)
// ============================================================================
pub const RootEntry = struct {
    kind: []const u8,
    slotOffset: i32,
    tagOffset: i32 = -1,
};

pub const SafepointEntry = struct {
    frameSize: i32,
    pcOffset: u32,
    roots: []const RootEntry,
};

pub const PatchFunction = struct {
    abiCallConv: []const u8,
    captureLayoutHash: []const u8,
    effectHash: []const u8,
    entrySymbol: []const u8,
    functionId: []const u8,
    signatureHash: []const u8,
    stackMap: []const SafepointEntry,
    tierAdapter: []const u8,
};

pub const PatchArtifact = struct {
    byteSize: u64,
    format: []const u8,
    sha256: []const u8,
};

pub const NativePatchPayload = struct {
    abiHash: []const u8,
    artifact: PatchArtifact,
    codeVersion: u64,
    epoch: u64,
    forbidDataMigration: bool,
    functions: []const PatchFunction,
    moduleId: []const u8,
    patchId: []const u8,
    staticSchemaHash: []const u8,
    target: TargetInfo,
};

pub const LiveFunctionCell = struct {
    functionId: []const u8,
    signatureHash: []const u8,
    effectHash: []const u8,
    captureLayoutHash: []const u8,
};

pub const LiveModuleState = struct {
    codeVersion: u64,
    abiHash: []const u8,
    staticSchemaHash: []const u8,
    cells: []const LiveFunctionCell = &.{},
};

fn isValidRootKind(k: []const u8) bool {
    return std.mem.eql(u8, k, "live_ref") or
        std.mem.eql(u8, k, "nullable_ref") or
        std.mem.eql(u8, k, "union_active_ref") or
        std.mem.eql(u8, k, "derived_span");
}

pub fn validateNativePatch(allocator: std.mem.Allocator, bytes: []const u8, live: ?LiveModuleState) ProtocolError!void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.native-patch", 1, "1", id.SCHEMA_NATIVE_PATCH, 8388608, 32);
    const parsed = std.json.parseFromSlice(NativePatchPayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    try validateTarget(p.target);
    if (!p.forbidDataMigration) return error.DataMigrationForbidden;
    if (p.codeVersion == 0) return error.StaleCodeVersion;
    if (!std.mem.eql(u8, p.artifact.format, "coff-dll") and !std.mem.eql(u8, p.artifact.format, "coff-obj")) {
        return error.InvalidArtifactFormat;
    }
    if (!id.isValidDigest(p.abiHash) or !id.isValidDigest(p.staticSchemaHash) or !id.isValidDigest(p.artifact.sha256)) {
        return error.InvalidDigest;
    }

    for (p.functions) |f| {
        if (!std.mem.eql(u8, f.tierAdapter, "direct_c_abi") and !std.mem.eql(u8, f.tierAdapter, "vm_trampoline")) {
            return error.InvalidTierAdapter;
        }
        if (!id.isValidDigest(f.functionId) or !id.isValidDigest(f.signatureHash) or
            !id.isValidDigest(f.effectHash) or !id.isValidDigest(f.captureLayoutHash))
        {
            return error.InvalidDigest;
        }
        for (f.stackMap) |sp| {
            if (sp.frameSize < 0) return error.InvalidRootSlot;
            for (sp.roots, 0..) |r, ri| {
                if (!isValidRootKind(r.kind)) return error.InvalidRootKind;
                if (r.slotOffset < 0 or r.slotOffset >= sp.frameSize) return error.InvalidRootSlot;
                for (sp.roots[0..ri]) |prev| {
                    if (prev.slotOffset == r.slotOffset) return error.DuplicateRootSlot;
                }
            }
        }
    }

    if (live) |st| {
        if (p.codeVersion <= st.codeVersion) return error.StaleCodeVersion;
        if (!std.mem.eql(u8, p.abiHash, st.abiHash)) return error.AbiHashMismatch;
        if (!std.mem.eql(u8, p.staticSchemaHash, st.staticSchemaHash)) return error.StaticSchemaMismatch;
        for (p.functions) |f| {
            for (st.cells) |cell| {
                if (std.mem.eql(u8, f.functionId, cell.functionId)) {
                    if (!std.mem.eql(u8, f.signatureHash, cell.signatureHash)) return error.SignatureMismatch;
                    if (!std.mem.eql(u8, f.effectHash, cell.effectHash)) return error.EffectMismatch;
                    if (!std.mem.eql(u8, f.captureLayoutHash, cell.captureLayoutHash)) return error.CaptureLayoutMismatch;
                }
            }
        }
    }
}

// ============================================================================
// 4. tsfg.module-reload (v1)
// ============================================================================
pub const ModuleReloadPayload = struct {
    abiHash: []const u8,
    fromEpoch: u64,
    migrationHookFunctionId: []const u8,
    migrationMode: []const u8,
    moduleId: []const u8,
    nextSchemaHash: []const u8,
    patchDigest: []const u8,
    phase: []const u8,
    previousSchemaHash: []const u8,
    rollbackPolicy: []const u8,
    toEpoch: u64,
    transactionId: []const u8,
};

pub fn validateModuleReload(allocator: std.mem.Allocator, bytes: []const u8) ProtocolError!void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.module-reload", 1, "1", id.SCHEMA_MODULE_RELOAD, 4194304, 32);
    const parsed = std.json.parseFromSlice(ModuleReloadPayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    const valid_phase = std.mem.eql(u8, p.phase, "begin") or std.mem.eql(u8, p.phase, "validate") or
        std.mem.eql(u8, p.phase, "stage") or std.mem.eql(u8, p.phase, "commit") or std.mem.eql(u8, p.phase, "rollback");
    if (!valid_phase) return error.InvalidReloadPhase;

    const valid_mode = std.mem.eql(u8, p.migrationMode, "none") or
        std.mem.eql(u8, p.migrationMode, "explicit_transform") or
        std.mem.eql(u8, p.migrationMode, "reset_state");
    if (!valid_mode) return error.InvalidMigrationMode;

    if (p.toEpoch != p.fromEpoch + 1) return error.InvalidEpochSequence;
    if (!std.mem.eql(u8, p.rollbackPolicy, "restore_previous_snapshot")) return error.InvalidRollbackPolicy;
    if (!id.isValidDigest(p.abiHash) or !id.isValidDigest(p.previousSchemaHash) or
        !id.isValidDigest(p.nextSchemaHash) or !id.isValidDigest(p.patchDigest))
    {
        return error.InvalidDigest;
    }

    const schema_changed = !std.mem.eql(u8, p.previousSchemaHash, p.nextSchemaHash);
    if (schema_changed and std.mem.eql(u8, p.migrationMode, "none")) return error.DataMigrationForbidden;
    if (std.mem.eql(u8, p.migrationMode, "explicit_transform") and !id.isValidDigest(p.migrationHookFunctionId)) {
        return error.MissingMigrationHook;
    }
}

// ============================================================================
// 5. tsfg.compiler-service (v1)
// ============================================================================
pub const CompilerServicePayload = struct {
    direction: []const u8,
    operation: []const u8,
    epoch: u64,
    requestId: []const u8,
    contractSetId: ?[]const u8 = null,
    inputDigest: ?[]const u8 = null,
    status: ?[]const u8 = null,
    diagnosticCode: ?[]const u8 = null,
};

pub fn validateCompilerServiceMessage(
    allocator: std.mem.Allocator,
    bytes: []const u8,
    min_epoch: u64,
    expected_contract_set: ?[]const u8,
) ProtocolError!void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const env = try id.verifyEnvelope(a, bytes, "tsfg.compiler-service", 1, "1", id.SCHEMA_COMPILER_SERVICE, 8388608, 32);
    const parsed = std.json.parseFromSlice(CompilerServicePayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;

    const p = parsed.value;
    const valid_op = std.mem.eql(u8, p.operation, "compile_patch") or
        std.mem.eql(u8, p.operation, "compile_module_reload") or
        std.mem.eql(u8, p.operation, "inspect_abi") or
        std.mem.eql(u8, p.operation, "health");
    if (!valid_op) return error.InvalidServiceOperation;
    if (p.epoch < min_epoch) return error.StaleEpoch;

    if (std.mem.eql(u8, p.direction, "request")) {
        const cs = p.contractSetId orelse return error.InvalidDigest;
        const inp = p.inputDigest orelse return error.InvalidDigest;
        if (!id.isValidDigest(cs) or !id.isValidDigest(inp)) return error.InvalidDigest;
        if (expected_contract_set) |exp| {
            if (!std.mem.eql(u8, cs, exp)) return error.ContractSetMismatch;
        }
    } else if (std.mem.eql(u8, p.direction, "response")) {
        const st = p.status orelse return error.InvalidServiceStatus;
        const diag = p.diagnosticCode orelse "";
        const valid_st = std.mem.eql(u8, st, "ok") or std.mem.eql(u8, st, "rejected") or std.mem.eql(u8, st, "error");
        if (!valid_st) return error.InvalidServiceStatus;
        if (std.mem.eql(u8, st, "ok") and diag.len != 0) return error.InvalidDiagnosticState;
        if (!std.mem.eql(u8, st, "ok") and diag.len == 0) return error.InvalidDiagnosticState;
    } else {
        return error.InvalidServiceDirection;
    }
}
