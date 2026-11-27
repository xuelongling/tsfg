// SPDX-License-Identifier: MIT
//! Production owner for compiled CPU Query native code versions and execution leases.
//! Binds a verified LLVM IR artifact and its compiled native module to a checked
//! `query_tmeta.Document`, ensuring the executable lease stays alive across every
//! worker thread in `ParallelGroup.dispatchSystemStages` and fails closed on unload
//! while any lease is active.
const std = @import("std");
const storage = @import("store.zig");
const tmeta = @import("query_tmeta.zig");

const HMODULE = *anyopaque;
const FARPROC = *const anyopaque;

extern "kernel32" fn LoadLibraryA(lpLibFileName: [*:0]const u8) callconv(.winapi) ?HMODULE;
extern "kernel32" fn GetProcAddress(hModule: HMODULE, lpProcName: [*:0]const u8) callconv(.winapi) ?FARPROC;
extern "kernel32" fn FreeLibrary(hLibModule: HMODULE) callconv(.winapi) c_int;

pub const Error = error{
    LibraryLoadFailed,
    SymbolNotFound,
    UnsupportedAbi,
    LeaseActive,
    InvalidCodeVersion,
};

pub const BoundEntry = struct {
    identity: tmeta.Plan.CodeIdentity,
    symbol: []const u8,
    column_count: usize,
    scalar_types: []const ScalarKind,
    fn_ptr: FARPROC,
};

pub const ScalarKind = enum(u8) { f32, f64 };

pub const ExecutionStats = struct {
    batches_executed: usize,
    distinct_threads: usize,
};

/// Active execution lease pinning a `CodeVersion` for the duration of a dispatch.
pub const CodeLease = struct {
    owner: *CodeVersion,
    released: bool = false,

    pub fn release(self: *CodeLease) void {
        if (self.released) return;
        self.released = true;
        _ = self.owner.active_leases.fetchSub(1, .release);
    }
};

/// Owns a loaded native Query code module verified against a `query_tmeta.Document`
/// and its paired LLVM IR bytes. Must outlive all `CodeLease` handles.
pub const CodeVersion = struct {
    allocator: std.mem.Allocator,
    module: HMODULE,
    llvm_ir: []u8,
    entries: []BoundEntry,
    active_leases: std.atomic.Value(usize) = .init(0),

    /// Load a compiled Windows DLL whose exports implement every entry in `document`,
    /// after verifying `llvm_ir` against `document.llvm_hash`.
    pub fn load(
        allocator: std.mem.Allocator,
        document: *const tmeta.Document,
        llvm_ir: []const u8,
        dll_path: []const u8,
    ) !CodeVersion {
        const expected_llvm_hash = document.llvm_hash orelse return error.IdentityMismatch;
        if (llvm_ir.len == 0 or llvm_ir.len > 8 * 1024 * 1024) return error.MetadataLimit;
        var sha = std.crypto.hash.sha2.Sha256.init(.{});
        sha.update(llvm_ir);
        var digest_raw: [32]u8 = undefined;
        sha.final(&digest_raw);
        var digest_text: [71]u8 = undefined;
        @memcpy(digest_text[0..7], "sha256:");
        const hex = std.fmt.bytesToHex(digest_raw, .lower);
        @memcpy(digest_text[7..], &hex);
        if (!std.mem.eql(u8, &digest_text, &expected_llvm_hash)) return error.IdentityMismatch;

        const z_path = try allocator.dupeZ(u8, dll_path);
        defer allocator.free(z_path);
        const mod = LoadLibraryA(z_path.ptr) orelse return error.LibraryLoadFailed;
        errdefer _ = FreeLibrary(mod);

        const owned_llvm = try allocator.dupe(u8, llvm_ir);
        errdefer allocator.free(owned_llvm);

        const bound = try allocator.alloc(BoundEntry, document.payload.entries.len);
        var initialized_count: usize = 0;
        errdefer {
            for (bound[0..initialized_count]) |entry| {
                allocator.free(entry.symbol);
                allocator.free(entry.scalar_types);
            }
            allocator.free(bound);
        }

        for (document.payload.entries, 0..) |entry, i| {
            if (entry.columns.len == 0 or entry.columns.len > 4 or entry.scalars.len > 2) {
                return error.UnsupportedAbi;
            }
            const z_sym = try allocator.dupeZ(u8, entry.entrySymbol);
            defer allocator.free(z_sym);
            const proc = GetProcAddress(mod, z_sym.ptr) orelse return error.SymbolNotFound;

            const scalar_kinds = try allocator.alloc(ScalarKind, entry.scalars.len);
            errdefer allocator.free(scalar_kinds);
            for (entry.scalars, 0..) |s, si| {
                scalar_kinds[si] = if (std.mem.eql(u8, s.type, "f32"))
                    .f32
                else if (std.mem.eql(u8, s.type, "f64"))
                    .f64
                else
                    return error.UnsupportedAbi;
            }

            const owned_sym = try allocator.dupe(u8, entry.entrySymbol);
            bound[i] = .{
                .identity = .{
                    .metadata_hash = document.payload_hash,
                    .batch_hash = document.payload.batchHash,
                    .entry_symbol = entry.entrySymbol,
                    .logical_function_id = entry.logicalFunctionId,
                    .signature_hash = entry.signatureHash,
                    .abi_type = entry.abiType,
                },
                .symbol = owned_sym,
                .column_count = entry.columns.len,
                .scalar_types = scalar_kinds,
                .fn_ptr = proc,
            };
            initialized_count += 1;
        }

        return .{
            .allocator = allocator,
            .module = mod,
            .llvm_ir = owned_llvm,
            .entries = bound,
            .active_leases = .init(0),
        };
    }

    pub fn deinit(self: *CodeVersion) Error!void {
        if (self.active_leases.load(.acquire) != 0) return error.LeaseActive;
        _ = FreeLibrary(self.module);
        for (self.entries) |entry| {
            self.allocator.free(entry.symbol);
            self.allocator.free(entry.scalar_types);
        }
        self.allocator.free(self.entries);
        self.allocator.free(self.llvm_ir);
        self.* = undefined;
    }

    pub fn acquireLease(self: *CodeVersion) CodeLease {
        _ = self.active_leases.fetchAdd(1, .acquire);
        return .{ .owner = self, .released = false };
    }

    pub fn findBound(self: *const CodeVersion, entry_symbol: []const u8) ?*const BoundEntry {
        for (self.entries) |*entry| {
            if (std.mem.eql(u8, entry.symbol, entry_symbol)) return entry;
        }
        return null;
    }

    /// Execute every stage of an admitted `ParallelGroup` using compiled native LLVM
    /// batch kernels under an active `CodeLease`. The lease is held until all worker
    /// threads have exited and all Store leases have been released.
    pub fn executeParallelGroup(
        self: *CodeVersion,
        allocator: std.mem.Allocator,
        group: *const tmeta.ParallelGroup,
        store: *storage.Store,
        scalars: []const []const tmeta.ScalarValue,
        pool: std.Io,
        worker_count: usize,
    ) !ExecutionStats {
        return self.executeParallelGroupWithHook(allocator, group, store, scalars, pool, worker_count, {}, null);
    }

    pub fn executeParallelGroupWithHook(
        self: *CodeVersion,
        allocator: std.mem.Allocator,
        group: *const tmeta.ParallelGroup,
        store: *storage.Store,
        scalars: []const []const tmeta.ScalarValue,
        pool: std.Io,
        worker_count: usize,
        hook_ctx: anytype,
        comptime before_invoke: anytype,
    ) !ExecutionStats {
        var lease = self.acquireLease();
        defer lease.release();

        const rows = try allocator.alloc([]const tmeta.Plan.CodeIdentity, group.systems.len);
        defer {
            for (rows) |row| if (row.len > 0) allocator.free(row);
            allocator.free(rows);
        }
        @memset(rows, &.{});

        for (group.systems, 0..) |system, si| {
            const ids = try allocator.alloc(tmeta.Plan.CodeIdentity, system.entries.len);
            for (system.entries, 0..) |entry, li| {
                const bound = self.findBound(entry.entrySymbol) orelse return error.SymbolNotFound;
                ids[li] = bound.identity;
            }
            rows[si] = ids;
        }

        const HookCtx = @TypeOf(hook_ctx);
        const DispatchContext = struct {
            code: *const CodeVersion,
            hook: HookCtx,
            batches: std.atomic.Value(usize) = .init(0),
            thread_mutex: std.atomic.Mutex = .unlocked,
            seen_threads: [64]std.Thread.Id = [_]std.Thread.Id{0} ** 64,
            seen_count: usize = 0,

            fn recordThread(ctx: *@This()) void {
                const tid = std.Thread.getCurrentId();
                while (!ctx.thread_mutex.tryLock()) std.atomic.spinLoopHint();
                defer ctx.thread_mutex.unlock();
                for (ctx.seen_threads[0..ctx.seen_count]) |existing| {
                    if (existing == tid) return;
                }
                if (ctx.seen_count < ctx.seen_threads.len) {
                    ctx.seen_threads[ctx.seen_count] = tid;
                    ctx.seen_count += 1;
                }
            }

            fn runBatch(ctx: *@This(), batch: tmeta.ParallelGroup.DispatchBatch) !void {
                ctx.recordThread();
                if (@TypeOf(before_invoke) != @TypeOf(null)) {
                    before_invoke(ctx.hook, batch);
                }
                const bound = ctx.code.findBound(batch.entry.entrySymbol) orelse return error.SymbolNotFound;
                try invokeBound(bound, batch.arguments);
                _ = ctx.batches.fetchAdd(1, .monotonic);
            }
        };

        var ctx: DispatchContext = .{ .code = self, .hook = hook_ctx };
        try group.dispatchSystemStages(
            allocator,
            store,
            scalars,
            .{ .entries = rows, .llvm_ir = self.llvm_ir },
            pool,
            worker_count,
            &ctx,
            DispatchContext.runBatch,
        );

        return .{
            .batches_executed = ctx.batches.load(.acquire),
            .distinct_threads = ctx.seen_count,
        };
    }
};

fn argU64(a: tmeta.Plan.LLVMArgument) Error!u64 {
    return switch (a) {
        .index => |v| v,
        else => error.UnsupportedAbi,
    };
}

fn argPtr(a: tmeta.Plan.LLVMArgument) Error!usize {
    return switch (a) {
        .read_pointer => |p| @intFromPtr(p),
        .write_pointer => |p| @intFromPtr(p),
        else => error.UnsupportedAbi,
    };
}

fn argF32(a: tmeta.Plan.LLVMArgument) Error!f32 {
    return switch (a) {
        .float32 => |v| v,
        else => error.UnsupportedAbi,
    };
}

fn argF64(a: tmeta.Plan.LLVMArgument) Error!f64 {
    return switch (a) {
        .float64 => |v| v,
        else => error.UnsupportedAbi,
    };
}

const ColArgs = struct { p0: usize, p1: usize, off: u64, len: u64, ustride: u64, rstride: u64 };

fn unpackCol(args: []const tmeta.Plan.LLVMArgument, idx: usize) Error!ColArgs {
    const base = 1 + idx * 6;
    return .{
        .p0 = try argPtr(args[base + 0]),
        .p1 = try argPtr(args[base + 1]),
        .off = try argU64(args[base + 2]),
        .len = try argU64(args[base + 3]),
        .ustride = try argU64(args[base + 4]),
        .rstride = try argU64(args[base + 5]),
    };
}

/// Invoke a compiled LLVM batch kernel using the exact Windows x64 C ABI lowered
/// from MLIR `(index, (memref<?xi8>, index)^C, scalar^S) -> ()`.
pub fn invokeBound(bound: *const BoundEntry, args: []const tmeta.Plan.LLVMArgument) Error!void {
    const expected_len = 1 + bound.column_count * 6 + bound.scalar_types.len;
    if (args.len != expected_len) return error.UnsupportedAbi;
    const rows = try argU64(args[0]);
    const sbase = 1 + bound.column_count * 6;

    switch (bound.column_count) {
        1 => {
            const c0 = try unpackCol(args, 0);
            switch (bound.scalar_types.len) {
                0 => {
                    const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64) callconv(.c) void;
                    @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride);
                },
                1 => switch (bound.scalar_types[0]) {
                    .f32 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, f32) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, try argF32(args[sbase]));
                    },
                    .f64 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, f64) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, try argF64(args[sbase]));
                    },
                },
                else => return error.UnsupportedAbi,
            }
        },
        2 => {
            const c0 = try unpackCol(args, 0);
            const c1 = try unpackCol(args, 1);
            switch (bound.scalar_types.len) {
                0 => {
                    const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64) callconv(.c) void;
                    @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride);
                },
                1 => switch (bound.scalar_types[0]) {
                    .f32 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f32) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF32(args[sbase]));
                    },
                    .f64 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f64) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF64(args[sbase]));
                    },
                },
                2 => {
                    const s0 = bound.scalar_types[0];
                    const s1 = bound.scalar_types[1];
                    if (s0 == .f32 and s1 == .f32) {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f32, f32) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF32(args[sbase]), try argF32(args[sbase + 1]));
                    } else if (s0 == .f64 and s1 == .f64) {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f64, f64) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF64(args[sbase]), try argF64(args[sbase + 1]));
                    } else if (s0 == .f32 and s1 == .f64) {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f32, f64) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF32(args[sbase]), try argF64(args[sbase + 1]));
                    } else {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f64, f32) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, try argF64(args[sbase]), try argF32(args[sbase + 1]));
                    }
                },
                else => return error.UnsupportedAbi,
            }
        },
        3 => {
            const c0 = try unpackCol(args, 0);
            const c1 = try unpackCol(args, 1);
            const c2 = try unpackCol(args, 2);
            switch (bound.scalar_types.len) {
                0 => {
                    const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64) callconv(.c) void;
                    @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, c2.p0, c2.p1, c2.off, c2.len, c2.ustride, c2.rstride);
                },
                1 => switch (bound.scalar_types[0]) {
                    .f32 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f32) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, c2.p0, c2.p1, c2.off, c2.len, c2.ustride, c2.rstride, try argF32(args[sbase]));
                    },
                    .f64 => {
                        const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, f64) callconv(.c) void;
                        @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, c2.p0, c2.p1, c2.off, c2.len, c2.ustride, c2.rstride, try argF64(args[sbase]));
                    },
                },
                else => return error.UnsupportedAbi,
            }
        },
        4 => {
            const c0 = try unpackCol(args, 0);
            const c1 = try unpackCol(args, 1);
            const c2 = try unpackCol(args, 2);
            const c3 = try unpackCol(args, 3);
            if (bound.scalar_types.len != 0) return error.UnsupportedAbi;
            const Fn = *const fn (u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64, usize, usize, u64, u64, u64, u64) callconv(.c) void;
            @as(Fn, @ptrCast(@alignCast(bound.fn_ptr)))(rows, c0.p0, c0.p1, c0.off, c0.len, c0.ustride, c0.rstride, c1.p0, c1.p1, c1.off, c1.len, c1.ustride, c1.rstride, c2.p0, c2.p1, c2.off, c2.len, c2.ustride, c2.rstride, c3.p0, c3.p1, c3.off, c3.len, c3.ustride, c3.rstride);
        },
        else => return error.UnsupportedAbi,
    }
}
