// SPDX-License-Identifier: MIT
//! R09 Production FunctionCell Hot-Reload Runtime, Epoch Reclamation, and
//! Explicit Transactional Module Reload (Zero Compiler Dependency).
//!
//! Guarantees:
//!   - Atomic single-pointer publication of immutable `SlotDescriptor` (callers
//!     NEVER observe mixed entry/tier/version/metadata).
//!   - Strict 3-phase hot reload: Old Native DLL -> Verified R05 Bytecode -> New Native DLL.
//!   - Active-frame & delayed-lease reference counting: old DLLs and their AOT GC
//!     stackmaps are NEVER unregistered/unloaded until active_frames == 0.
//!   - Closures store `function_id` + GC env pointer (NEVER raw code addresses).
//!   - Exact compatibility enforcement on `signature_hash`, Published Call Contract
//!     `effect_hash`, `capture_layout_hash`, and `static_schema_hash` (function-level
//!     patch ALWAYS rejects static schema change with `DataMigrationForbidden`).
//!   - Explicit transactional `ModuleReloadTx` (`begin` -> `stage` -> `validate` -> `commit` | `rollback`)
//!     for static state schema evolution.
const std = @import("std");
const r04_id = @import("r04-identity.zig");
const proto = @import("r04-protocols.zig");
const bc = @import("r05-bytecode.zig");
const vm = @import("r05-vm.zig");
const gc_mod = @import("r06-gen-gc.zig");
const rt_mod = @import("r06-runtime.zig");

const HMODULE = *anyopaque;
const FARPROC = *const anyopaque;

extern "kernel32" fn LoadLibraryW(lpLibFileName: [*:0]const u16) callconv(.winapi) ?HMODULE;
extern "kernel32" fn GetProcAddress(hModule: HMODULE, lpProcName: [*:0]const u8) callconv(.winapi) ?FARPROC;
extern "kernel32" fn FreeLibrary(hLibModule: HMODULE) callconv(.winapi) c_int;

pub const HotReloadError = error{
    FunctionNotFound,
    FunctionAlreadyRegistered,
    SignatureMismatch,
    EffectContractMismatch,
    CaptureLayoutMismatch,
    DataMigrationForbidden,
    StaleCodeVersion,
    PatchVerificationFailed,
    DllDigestMismatch,
    AbiHandshakeMismatch,
    LibraryLoadFailed,
    SymbolNotFound,
    BytecodeVerificationFailed,
    ReloadTxAlreadyActive,
    NoActiveReloadTx,
    ReloadTxNotStaged,
    InvalidMigrationEpoch,
    MigrationTransformFailed,
    OutOfMemory,
};

pub const Tier = enum(u8) {
    bytecode = 0,
    native = 1,
};

pub const R09RtCallbacks = extern struct {
    gc_alloc: *const fn (*anyopaque, u64, u64, u64) callconv(.c) ?*anyopaque,
    obj_read_scalar: *const fn (*anyopaque, ?*anyopaque, u64) callconv(.c) i64,
    obj_write_scalar: *const fn (*anyopaque, ?*anyopaque, u64, i64) callconv(.c) void,
    gc_safepoint: *const fn (*anyopaque, u64, u32, [*]u8, i32) callconv(.c) void,
    call_hot_i32: *const fn (*anyopaque, i32, i32) callconv(.c) i32,
    set_trap: *const fn (*anyopaque, i32) callconv(.c) void,
};

pub const NativeI32Fn = *const fn (*anyopaque, *const R09RtCallbacks, i32, i32) callconv(.c) i32;

/// SpinLock using atomics (portable across Zig 0.16 Windows without std.Thread.Mutex churn).
const SpinLock = struct {
    state: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    fn lock(self: *SpinLock) void {
        while (self.state.cmpxchgWeak(0, 1, .acquire, .monotonic) != null) {
            std.atomic.spinLoopHint();
        }
    }

    fn unlock(self: *SpinLock) void {
        self.state.store(0, .release);
    }
};

/// Owns a loaded Windows x64 Patch DLL + registered AOT GC stackmap ID.
/// Unloaded ONLY when its owning `SlotDescriptor` has `active_frames == 0` and is reclaimed.
pub const NativePatchHandle = struct {
    handle: ?HMODULE,
    code_id: u64,
    code_version: u64,
    has_stackmap: bool,
    unloaded: bool = false,

    pub fn unload(self: *NativePatchHandle, gc: *gc_mod.GenGc) void {
        if (self.unloaded) return;
        if (self.has_stackmap) {
            gc.unregisterAotStackMap(self.code_id);
        }
        if (self.handle) |h| {
            _ = FreeLibrary(h);
            self.handle = null;
        }
        self.unloaded = true;
    }
};

/// Immutable published descriptor for one version of a FunctionCell.
/// Swapped atomically via a single pointer store so callers NEVER observe torn fields.
pub const SlotDescriptor = struct {
    function_id: u32,
    code_version: u64,
    tier: Tier,
    signature_hash: [71]u8,
    effect_hash: [71]u8,
    capture_layout_hash: [71]u8,
    static_schema_hash: [71]u8,
    native_entry: ?NativeI32Fn = null,
    native_patch: ?*NativePatchHandle = null,
    bc_module: ?*bc.VerifiedModule = null,
    bc_fn_id: [32]u8 = [_]u8{0} ** 32,
    active_frames: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    retired_epoch: u64 = 0,
    retired: bool = false,

    fn destroyOwned(self: *SlotDescriptor, allocator: std.mem.Allocator, gc: *gc_mod.GenGc) void {
        if (self.native_patch) |np| {
            np.unload(gc);
            allocator.destroy(np);
            self.native_patch = null;
        }
        if (self.bc_module) |m| {
            m.deinit();
            allocator.destroy(m);
            self.bc_module = null;
        }
        allocator.destroy(self);
    }
};

/// Active execution lease pinning a `SlotDescriptor` across the entire call (or delayed call).
/// While ANY `SlotLease` is alive, `desc.active_frames > 0` and epoch reclamation WILL NOT
/// unload the native DLL or free the bytecode module or unregister AOT GC stackmaps.
pub const SlotLease = struct {
    desc: *SlotDescriptor,
    released: bool = false,

    pub fn release(self: *SlotLease) void {
        if (self.released) return;
        self.released = true;
        _ = self.desc.active_frames.fetchSub(1, .acq_rel);
    }

    pub fn codeVersion(self: SlotLease) u64 {
        return self.desc.code_version;
    }

    pub fn tier(self: SlotLease) Tier {
        return self.desc.tier;
    }
};

pub const FunctionContract = struct {
    signature_hash: []const u8,
    effect_hash: []const u8,
    capture_layout_hash: []const u8,
    static_schema_hash: []const u8,
};

fn copyDigest71(src: []const u8) HotReloadError![71]u8 {
    if (src.len != 71) return error.PatchVerificationFailed;
    var out: [71]u8 = undefined;
    @memcpy(&out, src);
    return out;
}

/// Closure value: stores stable `function_id` + GC-managed environment object pointer.
/// NEVER stores raw native function pointers, so hot reload updates closure targets automatically.
pub const HotClosure = struct {
    function_id: u32,
    env_obj: ?*gc_mod.GcObject,
    capture_layout_hash: [71]u8,
};

/// Static module state block separated from function code, guarded by `static_schema_hash` & `epoch`.
pub const StaticStateBlock = struct {
    schema_hash: [71]u8,
    epoch: u64,
    values: []i64,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, schema_hash: []const u8, epoch: u64, initial: []const i64) HotReloadError!StaticStateBlock {
        const vals = allocator.dupe(i64, initial) catch return error.OutOfMemory;
        errdefer allocator.free(vals);
        return .{
            .schema_hash = try copyDigest71(schema_hash),
            .epoch = epoch,
            .values = vals,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *StaticStateBlock) void {
        self.allocator.free(self.values);
        self.* = undefined;
    }
};

/// Explicit transactional module reload for schema-breaking state migration.
pub const ModuleReloadTx = struct {
    from_epoch: u64,
    to_epoch: u64,
    new_schema_hash: [71]u8,
    staged_values: ?[]i64 = null,
    validated: bool = false,
};

pub const CallOutcome = struct {
    status: rt_mod.BoundaryStatus,
    value: i32 = 0,
    code_version: u64 = 0,
    tier: Tier = .native,
    trap_code: i32 = 0,
};

pub const ReclaimStats = struct {
    reclaimed_descriptors: u64 = 0,
    unloaded_dlls: u64 = 0,
    deferred_active: u64 = 0,
};

pub const FunctionCell = struct {
    function_id: u32,
    current: std.atomic.Value(*SlotDescriptor),
};

const HostCallbackState = struct {
    table: *HotReloadRuntime,
    trap_code: i32 = 0,
    safepoints_hit: u32 = 0,
};

fn hrCbGcAlloc(raw: *anyopaque, type_id: u64, scalars: u64, edges: u64) callconv(.c) ?*anyopaque {
    const st: *HostCallbackState = @ptrCast(@alignCast(raw));
    const obj = st.table.rt.gc.alloc(type_id, .class_instance, @intCast(scalars), @intCast(edges)) catch {
        st.trap_code = 12;
        return null;
    };
    return obj;
}

fn hrCbObjReadScalar(_: *anyopaque, obj_raw: ?*anyopaque, field_idx: u64) callconv(.c) i64 {
    const obj: *gc_mod.GcObject = @ptrCast(@alignCast(obj_raw orelse return 0));
    return @bitCast(obj.scalars[@intCast(field_idx)]);
}

fn hrCbObjWriteScalar(_: *anyopaque, obj_raw: ?*anyopaque, field_idx: u64, val: i64) callconv(.c) void {
    const obj: *gc_mod.GcObject = @ptrCast(@alignCast(obj_raw orelse return));
    obj.scalars[@intCast(field_idx)] = @bitCast(val);
}

fn hrCbGcSafepoint(raw: *anyopaque, code_id: u64, pc_offset: u32, frame_ptr: [*]u8, frame_size: i32) callconv(.c) void {
    const st: *HostCallbackState = @ptrCast(@alignCast(raw));
    st.safepoints_hit += 1;
    const aligned_ptr: [*]align(8) u8 = @alignCast(frame_ptr);
    const frame_slice: []align(8) u8 = aligned_ptr[0..@intCast(frame_size)];
    st.table.rt.gc.collectAtAotSafepoint(code_id, pc_offset, frame_slice) catch {
        st.trap_code = 13;
        return;
    };
}

fn hrCbCallHotI32(raw: *anyopaque, cell_slot: i32, arg0: i32) callconv(.c) i32 {
    const st: *HostCallbackState = @ptrCast(@alignCast(raw));
    const fid: u32 = @intCast(cell_slot);
    const out = st.table.invokeI32(fid, arg0, 0) catch {
        st.trap_code = 7;
        return 0;
    };
    if (out.status != .ok) {
        st.trap_code = if (out.trap_code != 0) out.trap_code else 8;
        return 0;
    }
    return out.value;
}

fn hrCbSetTrap(raw: *anyopaque, code: i32) callconv(.c) void {
    const st: *HostCallbackState = @ptrCast(@alignCast(raw));
    if (st.trap_code == 0) st.trap_code = code;
}

/// Unified R09 Hot-Reload Runtime managing FunctionCells, Epoch Reclamation,
/// Cross-Tier Invocation, and Explicit Transactional Module Reload.
pub const HotReloadRuntime = struct {
    allocator: std.mem.Allocator,
    rt: *rt_mod.R06Runtime,
    caps: rt_mod.CapabilityTable,
    cells: std.AutoHashMapUnmanaged(u32, *FunctionCell) = .empty,
    retired: std.ArrayListUnmanaged(*SlotDescriptor) = .empty,
    static_state: StaticStateBlock,
    active_tx: ?ModuleReloadTx = null,
    publish_lock: SpinLock = .{},
    global_epoch: std.atomic.Value(u64) = std.atomic.Value(u64).init(1),
    next_code_id: u64 = 5000,
    total_reclaimed: u64 = 0,
    total_dlls_unloaded: u64 = 0,
    total_publishes: u64 = 0,
    total_rejections: u64 = 0,

    pub fn init(
        allocator: std.mem.Allocator,
        rt: *rt_mod.R06Runtime,
        initial_schema_hash: []const u8,
        initial_static_values: []const i64,
    ) HotReloadError!HotReloadRuntime {
        const state = try StaticStateBlock.init(allocator, initial_schema_hash, 1, initial_static_values);
        return .{
            .allocator = allocator,
            .rt = rt,
            .caps = rt_mod.CapabilityTable.init(allocator),
            .static_state = state,
        };
    }

    pub fn deinit(self: *HotReloadRuntime) void {
        if (self.active_tx) |*tx| {
            if (tx.staged_values) |sv| self.allocator.free(sv);
            self.active_tx = null;
        }
        // Reclaim all retired descriptors & unload their DLLs
        for (self.retired.items) |desc| {
            desc.destroyOwned(self.allocator, &self.rt.gc);
            self.total_reclaimed += 1;
        }
        self.retired.deinit(self.allocator);

        // Destroy all active cells & unload remaining DLLs on process exit
        var it = self.cells.valueIterator();
        while (it.next()) |cell_ptr| {
            const cell = cell_ptr.*;
            const desc = cell.current.load(.acquire);
            desc.destroyOwned(self.allocator, &self.rt.gc);
            self.allocator.destroy(cell);
        }
        self.cells.deinit(self.allocator);
        self.caps.deinit();
        self.static_state.deinit();
    }

    /// Acquire an atomic, immutable `SlotLease` for `function_id`.
    /// Callers may hold this lease across delayed execution; the descriptor's
    /// native DLL / bytecode / GC stackmaps remain pinned until `lease.release()`.
    pub fn acquireLease(self: *HotReloadRuntime, function_id: u32) HotReloadError!SlotLease {
        self.publish_lock.lock();
        const cell = self.cells.get(function_id) orelse {
            self.publish_lock.unlock();
            return error.FunctionNotFound;
        };
        const desc = cell.current.load(.acquire);
        _ = desc.active_frames.fetchAdd(1, .acq_rel);
        self.publish_lock.unlock();
        return .{ .desc = desc };
    }

    /// Execute a function using an already-acquired `SlotLease` (supports testing
    /// delayed calls that obtained an old entry before a hot-reload published!).
    pub fn invokeWithLease(self: *HotReloadRuntime, lease: SlotLease, arg0: i32, arg1: i32) CallOutcome {
        const desc = lease.desc;
        if (desc.tier == .native) {
            const entry = desc.native_entry orelse return .{
                .status = .execution_abort,
                .code_version = desc.code_version,
                .tier = .native,
                .trap_code = 99,
            };
            var host = HostCallbackState{ .table = self };
            const cbs = R09RtCallbacks{
                .gc_alloc = &hrCbGcAlloc,
                .obj_read_scalar = &hrCbObjReadScalar,
                .obj_write_scalar = &hrCbObjWriteScalar,
                .gc_safepoint = &hrCbGcSafepoint,
                .call_hot_i32 = &hrCbCallHotI32,
                .set_trap = &hrCbSetTrap,
            };
            const rv = entry(&host, &cbs, arg0, arg1);
            if (host.trap_code != 0) {
                return .{
                    .status = .trap,
                    .value = 0,
                    .code_version = desc.code_version,
                    .tier = .native,
                    .trap_code = host.trap_code,
                };
            }
            return .{
                .status = .ok,
                .value = rv,
                .code_version = desc.code_version,
                .tier = .native,
            };
        } else {
            const mod = desc.bc_module orelse return .{
                .status = .execution_abort,
                .code_version = desc.code_version,
                .tier = .bytecode,
                .trap_code = 98,
            };
            const bridge = vm.TierBridgeContext{
                .rt = self.rt,
                .mod = mod,
                .caps = &self.caps,
                .limits = .{},
            };
            const br = vm.invokeVmFromNative(&bridge, desc.bc_fn_id, arg0, arg1);
            const val_i32: i32 = @bitCast(@as(u32, @truncate(br.value_payload)));
            return .{
                .status = br.status,
                .value = if (br.status == .ok) val_i32 else 0,
                .code_version = desc.code_version,
                .tier = .bytecode,
                .trap_code = if (br.status == .ok) 0 else 1,
            };
        }
    }

    /// Standard call through FunctionCell: atomically acquires lease, executes, releases lease.
    pub fn invokeI32(self: *HotReloadRuntime, function_id: u32, arg0: i32, arg1: i32) HotReloadError!CallOutcome {
        var lease = try self.acquireLease(function_id);
        defer lease.release();
        return self.invokeWithLease(lease, arg0, arg1);
    }

    /// Invoke a `HotClosure` indirectly via its stable `function_id` (NEVER a raw code address).
    /// Passes the first scalar of the captured GC environment as `arg1`.
    pub fn invokeClosureI32(self: *HotReloadRuntime, closure: HotClosure, arg0: i32) HotReloadError!CallOutcome {
        var lease = try self.acquireLease(closure.function_id);
        defer lease.release();
        if (!std.mem.eql(u8, &lease.desc.capture_layout_hash, &closure.capture_layout_hash)) {
            return error.CaptureLayoutMismatch;
        }
        const env_val: i32 = if (closure.env_obj) |o| @intCast(@as(i64, @bitCast(o.scalars[0]))) else 0;
        return self.invokeWithLease(lease, arg0, env_val);
    }

    /// Register an initial function cell backed by an in-process native function pointer (for unit/stress tests).
    pub fn registerInProcessNative(
        self: *HotReloadRuntime,
        function_id: u32,
        code_version: u64,
        contract: FunctionContract,
        entry: NativeI32Fn,
    ) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        if (self.cells.contains(function_id)) return error.FunctionAlreadyRegistered;

        const desc = self.allocator.create(SlotDescriptor) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(desc);
        desc.* = .{
            .function_id = function_id,
            .code_version = code_version,
            .tier = .native,
            .signature_hash = try copyDigest71(contract.signature_hash),
            .effect_hash = try copyDigest71(contract.effect_hash),
            .capture_layout_hash = try copyDigest71(contract.capture_layout_hash),
            .static_schema_hash = try copyDigest71(contract.static_schema_hash),
            .native_entry = entry,
        };
        const cell = self.allocator.create(FunctionCell) catch return error.OutOfMemory;
        cell.* = .{
            .function_id = function_id,
            .current = std.atomic.Value(*SlotDescriptor).init(desc),
        };
        self.cells.put(self.allocator, function_id, cell) catch {
            self.allocator.destroy(cell);
            return error.OutOfMemory;
        };
        self.total_publishes += 1;
    }

    fn verifyCompatibleUpgrade(
        self: *HotReloadRuntime,
        old_desc: *const SlotDescriptor,
        new_version: u64,
        contract: FunctionContract,
    ) HotReloadError!void {
        if (new_version <= old_desc.code_version) {
            self.total_rejections += 1;
            return error.StaleCodeVersion;
        }
        if (!std.mem.eql(u8, &old_desc.static_schema_hash, contract.static_schema_hash) or
            !std.mem.eql(u8, &self.static_state.schema_hash, contract.static_schema_hash))
        {
            self.total_rejections += 1;
            return error.DataMigrationForbidden;
        }
        if (!std.mem.eql(u8, &old_desc.signature_hash, contract.signature_hash)) {
            self.total_rejections += 1;
            return error.SignatureMismatch;
        }
        if (!std.mem.eql(u8, &old_desc.effect_hash, contract.effect_hash)) {
            self.total_rejections += 1;
            return error.EffectContractMismatch;
        }
        if (!std.mem.eql(u8, &old_desc.capture_layout_hash, contract.capture_layout_hash)) {
            self.total_rejections += 1;
            return error.CaptureLayoutMismatch;
        }
    }

    /// Publish an in-process native replacement (for concurrency/stress tests).
    pub fn publishInProcessNative(
        self: *HotReloadRuntime,
        function_id: u32,
        code_version: u64,
        contract: FunctionContract,
        entry: NativeI32Fn,
    ) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        const cell = self.cells.get(function_id) orelse return error.FunctionNotFound;
        const old_desc = cell.current.load(.acquire);
        try self.verifyCompatibleUpgrade(old_desc, code_version, contract);

        const new_desc = self.allocator.create(SlotDescriptor) catch return error.OutOfMemory;
        new_desc.* = .{
            .function_id = function_id,
            .code_version = code_version,
            .tier = .native,
            .signature_hash = old_desc.signature_hash,
            .effect_hash = old_desc.effect_hash,
            .capture_layout_hash = old_desc.capture_layout_hash,
            .static_schema_hash = old_desc.static_schema_hash,
            .native_entry = entry,
        };
        try self.swapAndRetireLocked(cell, old_desc, new_desc);
    }

    /// Phase 2 (or initial): Verify `TSFGR05B` bytecode BEFORE publishing, enforce exact
    /// signature/effect/capture/static-schema compatibility, and atomically publish `.bytecode` tier!
    pub fn publishBytecode(
        self: *HotReloadRuntime,
        function_id: u32,
        code_version: u64,
        contract: FunctionContract,
        bytecode_bytes: []const u8,
        bc_fn_id: [32]u8,
    ) HotReloadError!void {
        // Pre-load strict bytecode verification BEFORE acquiring publish lock!
        const verified_ptr = self.allocator.create(bc.VerifiedModule) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(verified_ptr);
        verified_ptr.* = bc.verifyAndPredecode(self.allocator, bytecode_bytes, null) catch {
            self.publish_lock.lock();
            self.total_rejections += 1;
            self.publish_lock.unlock();
            return error.BytecodeVerificationFailed;
        };
        errdefer verified_ptr.deinit();

        if (verified_ptr.findFunctionIndex(bc_fn_id) == null) {
            self.publish_lock.lock();
            self.total_rejections += 1;
            self.publish_lock.unlock();
            return error.SymbolNotFound;
        }

        self.publish_lock.lock();
        defer self.publish_lock.unlock();

        if (self.cells.get(function_id)) |cell| {
            const old_desc = cell.current.load(.acquire);
            try self.verifyCompatibleUpgrade(old_desc, code_version, contract);

            const new_desc = self.allocator.create(SlotDescriptor) catch return error.OutOfMemory;
            new_desc.* = .{
                .function_id = function_id,
                .code_version = code_version,
                .tier = .bytecode,
                .signature_hash = old_desc.signature_hash,
                .effect_hash = old_desc.effect_hash,
                .capture_layout_hash = old_desc.capture_layout_hash,
                .static_schema_hash = old_desc.static_schema_hash,
                .bc_module = verified_ptr,
                .bc_fn_id = bc_fn_id,
            };
            try self.swapAndRetireLocked(cell, old_desc, new_desc);
        } else {
            const desc = self.allocator.create(SlotDescriptor) catch return error.OutOfMemory;
            errdefer self.allocator.destroy(desc);
            desc.* = .{
                .function_id = function_id,
                .code_version = code_version,
                .tier = .bytecode,
                .signature_hash = try copyDigest71(contract.signature_hash),
                .effect_hash = try copyDigest71(contract.effect_hash),
                .capture_layout_hash = try copyDigest71(contract.capture_layout_hash),
                .static_schema_hash = try copyDigest71(contract.static_schema_hash),
                .bc_module = verified_ptr,
                .bc_fn_id = bc_fn_id,
            };
            const cell = self.allocator.create(FunctionCell) catch return error.OutOfMemory;
            cell.* = .{
                .function_id = function_id,
                .current = std.atomic.Value(*SlotDescriptor).init(desc),
            };
            self.cells.put(self.allocator, function_id, cell) catch {
                self.allocator.destroy(cell);
                return error.OutOfMemory;
            };
            self.total_publishes += 1;
        }
    }

    /// Phase 1 / Phase 3: Load a REAL Windows x64 LLD `.dll` + `.tpatch`, verify envelope,
    /// verify DLL SHA-256, check `tsfg_patch_abi_hash` handshake, register AOT GC StackMaps
    /// BEFORE publishing, enforce compatibility, and atomically publish `.native` tier!
    /// On ANY error, unloads the candidate DLL, unregisters its stackmap, and leaves the
    /// previous working version completely untouched.
    pub fn publishNativeDll(
        self: *HotReloadRuntime,
        io: std.Io,
        function_id: u32,
        symbol_name: [:0]const u8,
        dll_path: []const u8,
        tpatch_path: []const u8,
        contract: FunctionContract,
    ) HotReloadError!u64 {
        // 1. Read & verify R04 `.tpatch` envelope strictly BEFORE touching LoadLibraryW
        const tpatch_bytes = std.Io.Dir.cwd().readFileAlloc(io, tpatch_path, self.allocator, .limited(8 * 1024 * 1024)) catch {
            self.recordReject();
            return error.PatchVerificationFailed;
        };
        defer self.allocator.free(tpatch_bytes);

        proto.validateNativePatch(self.allocator, tpatch_bytes, null) catch {
            self.recordReject();
            return error.PatchVerificationFailed;
        };

        var arena = std.heap.ArenaAllocator.init(self.allocator);
        defer arena.deinit();
        const a = arena.allocator();
        const env = r04_id.verifyEnvelope(a, tpatch_bytes, "tsfg.native-patch", 1, "1", r04_id.SCHEMA_NATIVE_PATCH, 8388608, 32) catch {
            self.recordReject();
            return error.PatchVerificationFailed;
        };
        const parsed = std.json.parseFromSlice(proto.NativePatchPayload, a, env.value.payload, .{
            .allocate = .alloc_always,
            .ignore_unknown_fields = true,
        }) catch {
            self.recordReject();
            return error.PatchVerificationFailed;
        };
        const patch = parsed.value;

        // 2. Verify DLL file bytes match `.tpatch` artifact SHA-256
        const dll_bytes = std.Io.Dir.cwd().readFileAlloc(io, dll_path, self.allocator, .limited(16 * 1024 * 1024)) catch {
            self.recordReject();
            return error.LibraryLoadFailed;
        };
        defer self.allocator.free(dll_bytes);
        const actual_dll_sha = r04_id.sha256Parts(&.{dll_bytes});
        if (!std.mem.eql(u8, &actual_dll_sha, patch.artifact.sha256)) {
            self.recordReject();
            return error.DllDigestMismatch;
        }

        // 3. Load DLL via Win32 LoadLibraryW
        const wpath = std.unicode.utf8ToUtf16LeAllocZ(self.allocator, dll_path) catch return error.OutOfMemory;
        defer self.allocator.free(wpath);
        const hmod = LoadLibraryW(wpath) orelse {
            self.recordReject();
            return error.LibraryLoadFailed;
        };
        var keep_loaded = false;
        defer if (!keep_loaded) {
            _ = FreeLibrary(hmod);
        };

        // 4. Verify exported `tsfg_patch_abi_hash` symbol matches `.tpatch` abiHash
        const abi_raw = GetProcAddress(hmod, "tsfg_patch_abi_hash") orelse {
            self.recordReject();
            return error.AbiHandshakeMismatch;
        };
        const abi_cstr: [*:0]const u8 = @ptrCast(abi_raw);
        if (!std.mem.eql(u8, std.mem.span(abi_cstr), patch.abiHash)) {
            self.recordReject();
            return error.AbiHandshakeMismatch;
        }

        // 5. Resolve target function symbol
        const fn_raw = GetProcAddress(hmod, symbol_name.ptr) orelse {
            self.recordReject();
            return error.SymbolNotFound;
        };
        const entry_fn: NativeI32Fn = @ptrCast(@alignCast(fn_raw));

        // 6. Lock, verify upgrade compatibility, register AOT GC StackMaps BEFORE publish, atomic swap!
        self.publish_lock.lock();
        defer self.publish_lock.unlock();

        const code_ver: u64 = patch.codeVersion;
        const existing_cell = self.cells.get(function_id);
        if (existing_cell) |cell| {
            const old_desc = cell.current.load(.acquire);
            try self.verifyCompatibleUpgrade(old_desc, code_ver, contract);
        } else {
            if (!std.mem.eql(u8, &self.static_state.schema_hash, contract.static_schema_hash)) {
                self.total_rejections += 1;
                return error.DataMigrationForbidden;
            }
        }

        const code_id = self.next_code_id;
        self.next_code_id += 1;
        var has_sm = false;
        for (patch.functions) |f| {
            if (f.stackMap.len > 0) {
                self.rt.gc.registerAotStackMap(code_id, f.stackMap) catch return error.OutOfMemory;
                has_sm = true;
            }
        }
        errdefer if (has_sm) self.rt.gc.unregisterAotStackMap(code_id);

        const np = self.allocator.create(NativePatchHandle) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(np);
        np.* = .{
            .handle = hmod,
            .code_id = code_id,
            .code_version = code_ver,
            .has_stackmap = has_sm,
        };

        const new_desc = self.allocator.create(SlotDescriptor) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(new_desc);
        new_desc.* = .{
            .function_id = function_id,
            .code_version = code_ver,
            .tier = .native,
            .signature_hash = try copyDigest71(contract.signature_hash),
            .effect_hash = try copyDigest71(contract.effect_hash),
            .capture_layout_hash = try copyDigest71(contract.capture_layout_hash),
            .static_schema_hash = try copyDigest71(contract.static_schema_hash),
            .native_entry = entry_fn,
            .native_patch = np,
        };

        if (existing_cell) |cell| {
            const old_desc = cell.current.load(.acquire);
            try self.swapAndRetireLocked(cell, old_desc, new_desc);
        } else {
            const cell = self.allocator.create(FunctionCell) catch return error.OutOfMemory;
            cell.* = .{
                .function_id = function_id,
                .current = std.atomic.Value(*SlotDescriptor).init(new_desc),
            };
            self.cells.put(self.allocator, function_id, cell) catch {
                self.allocator.destroy(cell);
                return error.OutOfMemory;
            };
            self.total_publishes += 1;
        }
        keep_loaded = true;
        return code_ver;
    }

    fn recordReject(self: *HotReloadRuntime) void {
        self.publish_lock.lock();
        self.total_rejections += 1;
        self.publish_lock.unlock();
    }

    fn swapAndRetireLocked(self: *HotReloadRuntime, cell: *FunctionCell, old_desc: *SlotDescriptor, new_desc: *SlotDescriptor) HotReloadError!void {
        const ep = self.global_epoch.fetchAdd(1, .acq_rel) + 1;
        old_desc.retired_epoch = ep;
        old_desc.retired = true;
        self.retired.append(self.allocator, old_desc) catch return error.OutOfMemory;
        // Single atomic pointer release store!
        cell.current.store(new_desc, .release);
        self.total_publishes += 1;
    }

    /// Epoch reclamation: destroys retired descriptors & unloads old DLLs + AOT GC stackmaps
    /// ONLY for retired descriptors whose `active_frames == 0`.
    pub fn reclaimRetired(self: *HotReloadRuntime) ReclaimStats {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        var stats = ReclaimStats{};
        var i: usize = 0;
        while (i < self.retired.items.len) {
            const desc = self.retired.items[i];
            if (desc.active_frames.load(.acquire) == 0) {
                const had_dll = desc.native_patch != null and desc.native_patch.?.handle != null;
                desc.destroyOwned(self.allocator, &self.rt.gc);
                _ = self.retired.swapRemove(i);
                stats.reclaimed_descriptors += 1;
                self.total_reclaimed += 1;
                if (had_dll) {
                    stats.unloaded_dlls += 1;
                    self.total_dlls_unloaded += 1;
                }
            } else {
                stats.deferred_active += 1;
                i += 1;
            }
        }
        return stats;
    }

    // ========================================================================
    // Explicit Transactional Module Reload & Schema Migration (NEVER silent!)
    // ========================================================================
    pub fn beginModuleReload(self: *HotReloadRuntime, new_schema_hash: []const u8, to_epoch: u64) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        if (self.active_tx != null) return error.ReloadTxAlreadyActive;
        if (to_epoch != self.static_state.epoch + 1) return error.InvalidMigrationEpoch;
        self.active_tx = .{
            .from_epoch = self.static_state.epoch,
            .to_epoch = to_epoch,
            .new_schema_hash = try copyDigest71(new_schema_hash),
        };
    }

    pub fn stageModuleMigration(
        self: *HotReloadRuntime,
        transform: *const fn ([]const i64, std.mem.Allocator) anyerror![]i64,
    ) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        var tx = &(self.active_tx orelse return error.NoActiveReloadTx);
        const transformed = transform(self.static_state.values, self.allocator) catch {
            // Automatic rollback on transform failure, preserving previous state intact!
            if (tx.staged_values) |sv| self.allocator.free(sv);
            self.active_tx = null;
            return error.MigrationTransformFailed;
        };
        if (tx.staged_values) |sv| self.allocator.free(sv);
        tx.staged_values = transformed;
        tx.validated = true;
    }

    pub fn commitModuleReload(self: *HotReloadRuntime) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        const tx = self.active_tx orelse return error.NoActiveReloadTx;
        if (!tx.validated or tx.staged_values == null) return error.ReloadTxNotStaged;

        // Swap static state block atomically & update active cells' static_schema_hash
        self.allocator.free(self.static_state.values);
        self.static_state.values = tx.staged_values.?;
        self.static_state.schema_hash = tx.new_schema_hash;
        self.static_state.epoch = tx.to_epoch;

        var it = self.cells.valueIterator();
        while (it.next()) |cell_ptr| {
            const old_desc = cell_ptr.*.current.load(.acquire);
            old_desc.static_schema_hash = tx.new_schema_hash;
        }
        self.active_tx = null;
    }

    pub fn rollbackModuleReload(self: *HotReloadRuntime) HotReloadError!void {
        self.publish_lock.lock();
        defer self.publish_lock.unlock();
        const tx = self.active_tx orelse return error.NoActiveReloadTx;
        if (tx.staged_values) |sv| self.allocator.free(sv);
        self.active_tx = null;
    }
};

// ============================================================================
// Embedded R09 Unit & Concurrency Tests
// ============================================================================
fn mockNativeV1(_: *anyopaque, _: *const R09RtCallbacks, a: i32, b: i32) callconv(.c) i32 {
    return a + b + 100;
}

fn mockNativeV2(_: *anyopaque, _: *const R09RtCallbacks, a: i32, b: i32) callconv(.c) i32 {
    return a * 2 + b + 200;
}

fn mockRecursiveV1(raw: *anyopaque, cbs: *const R09RtCallbacks, n: i32, _: i32) callconv(.c) i32 {
    if (n <= 0) return 1;
    return n + cbs.call_hot_i32(raw, 2, n - 1);
}

fn mockRecursiveV2(raw: *anyopaque, cbs: *const R09RtCallbacks, n: i32, _: i32) callconv(.c) i32 {
    if (n <= 0) return 10;
    return n * 2 + cbs.call_hot_i32(raw, 2, n - 1);
}

fn migrateAddSlot(old: []const i64, allocator: std.mem.Allocator) ![]i64 {
    const out = try allocator.alloc(i64, old.len + 1);
    @memcpy(out[0..old.len], old);
    out[old.len] = 999;
    return out;
}

fn migrateFail(_: []const i64, _: std.mem.Allocator) ![]i64 {
    return error.SimulatedMigrationFailure;
}

test "R09 FunctionCell delayed lease protection, closure indirection, compatibility rejections, and module reload rollback/commit" {
    const allocator = std.testing.allocator;
    const rt = try rt_mod.R06Runtime.create(allocator, 2 * 1024 * 1024, 65536);
    defer rt.destroy();

    const sig1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const sig2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    const eff1 = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    const eff2 = "sha256:4444444444444444444444444444444444444444444444444444444444444444";
    const cap1 = "sha256:5555555555555555555555555555555555555555555555555555555555555555";
    const cap2 = "sha256:6666666666666666666666666666666666666666666666666666666666666666";
    const sch1 = "sha256:7777777777777777777777777777777777777777777777777777777777777777";
    const sch2 = "sha256:8888888888888888888888888888888888888888888888888888888888888888";

    const contract = FunctionContract{
        .signature_hash = sig1,
        .effect_hash = eff1,
        .capture_layout_hash = cap1,
        .static_schema_hash = sch1,
    };

    var hr = try HotReloadRuntime.init(allocator, rt, sch1, &.{ 10, 20 });
    defer hr.deinit();

    try hr.registerInProcessNative(1, 1, contract, &mockNativeV1);
    try hr.registerInProcessNative(2, 1, contract, &mockRecursiveV1);

    // Closure stores stable FunctionId=1 + GC env object (captures 5), NEVER raw code address!
    const env_obj = try rt.gc.alloc(1, .closure_env, 1, 0);
    env_obj.scalars[0] = 5;
    const closure = HotClosure{
        .function_id = 1,
        .env_obj = env_obj,
        .capture_layout_hash = try copyDigest71(cap1),
    };
    const c1 = try hr.invokeClosureI32(closure, 7);
    try std.testing.expectEqual(@as(i32, 112), c1.value); // 7 + 5 + 100

    // Recursive v1: 3 + 2 + 1 + 1 = 7
    const r1 = try hr.invokeI32(2, 3, 0);
    try std.testing.expectEqual(@as(i32, 7), r1.value);

    // Acquire a DELAYED lease on v1 BEFORE publishing v2!
    var delayed_v1 = try hr.acquireLease(1);

    // Reject all incompatible upgrades while keeping v1 live!
    try std.testing.expectError(error.StaleCodeVersion, hr.publishInProcessNative(1, 1, contract, &mockNativeV2));
    try std.testing.expectError(error.SignatureMismatch, hr.publishInProcessNative(1, 2, .{
        .signature_hash = sig2,
        .effect_hash = eff1,
        .capture_layout_hash = cap1,
        .static_schema_hash = sch1,
    }, &mockNativeV2));
    try std.testing.expectError(error.EffectContractMismatch, hr.publishInProcessNative(1, 2, .{
        .signature_hash = sig1,
        .effect_hash = eff2,
        .capture_layout_hash = cap1,
        .static_schema_hash = sch1,
    }, &mockNativeV2));
    try std.testing.expectError(error.CaptureLayoutMismatch, hr.publishInProcessNative(1, 2, .{
        .signature_hash = sig1,
        .effect_hash = eff1,
        .capture_layout_hash = cap2,
        .static_schema_hash = sch1,
    }, &mockNativeV2));
    try std.testing.expectError(error.DataMigrationForbidden, hr.publishInProcessNative(1, 2, .{
        .signature_hash = sig1,
        .effect_hash = eff1,
        .capture_layout_hash = cap1,
        .static_schema_hash = sch2,
    }, &mockNativeV2));

    // Publish valid v2 for both functions
    try hr.publishInProcessNative(1, 2, contract, &mockNativeV2);
    try hr.publishInProcessNative(2, 2, contract, &mockRecursiveV2);

    // Reclaim attempt while delayed_v1 is STILL ACTIVE must defer v1!
    const s1 = hr.reclaimRetired();
    try std.testing.expectEqual(@as(u64, 1), s1.reclaimed_descriptors); // fn 2 v1 reclaimed
    try std.testing.expectEqual(@as(u64, 1), s1.deferred_active); // fn 1 v1 still pinned!

    // New closure invocation immediately hits v2 WITHOUT rebuilding the closure!
    const c2 = try hr.invokeClosureI32(closure, 7);
    try std.testing.expectEqual(@as(i32, 219), c2.value); // 7*2 + 5 + 200
    try std.testing.expectEqual(@as(u64, 2), c2.code_version);

    // Delayed v1 lease STILL executes v1 safely!
    const d1 = hr.invokeWithLease(delayed_v1, 7, 5);
    try std.testing.expectEqual(@as(i32, 112), d1.value);
    try std.testing.expectEqual(@as(u64, 1), d1.code_version);
    delayed_v1.release();

    // Now v1 is cleanly reclaimed!
    const s2 = hr.reclaimRetired();
    try std.testing.expectEqual(@as(u64, 1), s2.reclaimed_descriptors);
    try std.testing.expectEqual(@as(u64, 0), s2.deferred_active);

    // Recursive v2: 6 + 4 + 2 + 10 = 22
    const r2 = try hr.invokeI32(2, 3, 0);
    try std.testing.expectEqual(@as(i32, 22), r2.value);

    // Explicit Module Reload Transaction: failed transform rolls back cleanly preserving [10, 20]
    try hr.beginModuleReload(sch2, 2);
    try std.testing.expectError(error.MigrationTransformFailed, hr.stageModuleMigration(&migrateFail));
    try std.testing.expectEqual(@as(u64, 1), hr.static_state.epoch);
    try std.testing.expectEqual(@as(usize, 2), hr.static_state.values.len);

    // Explicit Module Reload Transaction: commit migrates state [10, 20] -> [10, 20, 999]
    try hr.beginModuleReload(sch2, 2);
    try hr.stageModuleMigration(&migrateAddSlot);
    try hr.commitModuleReload();
    try std.testing.expectEqual(@as(u64, 2), hr.static_state.epoch);
    try std.testing.expectEqual(@as(usize, 3), hr.static_state.values.len);
    try std.testing.expectEqual(@as(i64, 999), hr.static_state.values[2]);
}

test "R09 4-thread concurrent callers interleaved with 20 rapid hot-reload publishes and epoch reclamation" {
    const allocator = std.testing.allocator;
    const rt = try rt_mod.R06Runtime.create(allocator, 2 * 1024 * 1024, 65536);
    defer rt.destroy();

    const sig1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const eff1 = "sha256:3333333333333333333333333333333333333333333333333333333333333333";
    const cap1 = "sha256:5555555555555555555555555555555555555555555555555555555555555555";
    const sch1 = "sha256:7777777777777777777777777777777777777777777777777777777777777777";
    const contract = FunctionContract{
        .signature_hash = sig1,
        .effect_hash = eff1,
        .capture_layout_hash = cap1,
        .static_schema_hash = sch1,
    };

    var hr = try HotReloadRuntime.init(allocator, rt, sch1, &.{1});
    defer hr.deinit();
    try hr.registerInProcessNative(1, 1, contract, &mockNativeV1);

    const WorkerCtx = struct {
        hr: *HotReloadRuntime,
        done: *std.atomic.Value(bool),
        started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        calls: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
        bad: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),

        fn run(ctx: *@This()) void {
            _ = ctx.started.fetchAdd(1, .acq_rel);
            while (!ctx.done.load(.acquire)) {
                const out = ctx.hr.invokeI32(1, 4, 3) catch {
                    _ = ctx.bad.fetchAdd(1, .monotonic);
                    continue;
                };
                // Must NEVER observe torn version/result!
                // Odd versions run mockNativeV1 (4+3+100 = 107), even versions run mockNativeV2 (8+3+200 = 211)
                const expected: i32 = if ((out.code_version % 2) == 1) 107 else 211;
                if (out.status != .ok or out.value != expected) {
                    _ = ctx.bad.fetchAdd(1, .monotonic);
                }
                _ = ctx.calls.fetchAdd(1, .monotonic);
            }
        }
    };

    var done = std.atomic.Value(bool).init(false);
    var ctx = WorkerCtx{ .hr = &hr, .done = &done };
    var threads: [3]std.Thread = undefined;
    for (0..3) |i| {
        threads[i] = try std.Thread.spawn(.{}, WorkerCtx.run, .{&ctx});
    }
    while (ctx.started.load(.acquire) < 3) {
        std.atomic.spinLoopHint();
    }

    // 20 rapid alternating hot-reload publishes while 3 threads hammer FunctionCell 1!
    for (2..22) |ver| {
        const before_calls = ctx.calls.load(.acquire);
        const target_fn: NativeI32Fn = if ((ver % 2) == 1) &mockNativeV1 else &mockNativeV2;
        try hr.publishInProcessNative(1, @intCast(ver), contract, target_fn);
        _ = hr.reclaimRetired();
        while (ctx.calls.load(.acquire) < before_calls + 25) {
            std.atomic.spinLoopHint();
        }
    }

    done.store(true, .release);
    for (0..3) |i| threads[i].join();

    _ = hr.reclaimRetired();
    try std.testing.expectEqual(@as(u64, 0), ctx.bad.load(.acquire));
    try std.testing.expect(ctx.calls.load(.acquire) > 100);
    try std.testing.expectEqual(@as(usize, 0), hr.retired.items.len);
}
