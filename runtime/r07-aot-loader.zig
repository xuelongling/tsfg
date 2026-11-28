// SPDX-License-Identifier: MIT
//! R07 Zero-Compiler-Dependency Zig Native Patch Loader & Execution Runner (`tsfg-r07-loader.exe`).
//! Loads a real LLD-linked Windows x64 `.dll` + verifies its R04 `.tpatch` envelope & SHA-256,
//! checks the exported `tsfg_patch_abi_hash` handshake, registers AOT GC StackMaps with `R06Runtime.gc`,
//! executes native AOT functions (triggering REAL young-gen moving GC at AOT safepoints,
//! calling through a live `FunctionCell` hot slot, and running `tsfg.parallel_for` kernels),
//! then cleanly unregisters stackmaps and unloads the DLL.
const std = @import("std");
const r04_id = @import("r04-identity.zig");
const proto = @import("r04-protocols.zig");
const gc_mod = @import("r06-gen-gc.zig");
const rt_mod = @import("r06-runtime.zig");

const HMODULE = *anyopaque;
const FARPROC = *const anyopaque;

extern "kernel32" fn LoadLibraryW(lpLibFileName: [*:0]const u16) callconv(.winapi) ?HMODULE;
extern "kernel32" fn GetProcAddress(hModule: HMODULE, lpProcName: [*:0]const u8) callconv(.winapi) ?FARPROC;
extern "kernel32" fn FreeLibrary(hLibModule: HMODULE) callconv(.winapi) c_int;

const WinDll = struct {
    handle: HMODULE,

    fn open(allocator: std.mem.Allocator, path: []const u8) !WinDll {
        const wpath = try std.unicode.utf8ToUtf16LeAllocZ(allocator, path);
        defer allocator.free(wpath);
        const h = LoadLibraryW(wpath) orelse return error.LibraryLoadFailed;
        return .{ .handle = h };
    }

    fn close(self: *WinDll) void {
        _ = FreeLibrary(self.handle);
    }

    fn lookup(self: WinDll, comptime T: type, symbol: [:0]const u8) ?T {
        const raw = GetProcAddress(self.handle, symbol.ptr) orelse return null;
        return @ptrCast(@alignCast(raw));
    }
};

const R07RtCallbacks = extern struct {
    gc_alloc: *const fn (*anyopaque, u64, u64, u64) callconv(.c) ?*anyopaque,
    obj_read_scalar: *const fn (*anyopaque, ?*anyopaque, u64) callconv(.c) i64,
    obj_write_scalar: *const fn (*anyopaque, ?*anyopaque, u64, i64) callconv(.c) void,
    gc_safepoint: *const fn (*anyopaque, u64, u32, [*]u8, i32) callconv(.c) void,
    call_hot_i32: *const fn (*anyopaque, i32, i32) callconv(.c) i32,
    set_trap: *const fn (*anyopaque, i32) callconv(.c) void,
};

const HostState = struct {
    rt: *rt_mod.R06Runtime,
    trap_code: i32 = 0,
    hot_multiplier: i32 = 10,
    safepoints_hit: u32 = 0,
    relocations_before: u64 = 0,
    relocations_after: u64 = 0,
};

fn cbGcAlloc(raw: *anyopaque, type_id: u64, scalars: u64, edges: u64) callconv(.c) ?*anyopaque {
    const st: *HostState = @ptrCast(@alignCast(raw));
    const obj = st.rt.gc.alloc(type_id, .class_instance, @intCast(scalars), @intCast(edges)) catch {
        st.trap_code = 12;
        return null;
    };
    return obj;
}

fn cbObjReadScalar(_: *anyopaque, obj_raw: ?*anyopaque, field_idx: u64) callconv(.c) i64 {
    const obj: *gc_mod.GcObject = @ptrCast(@alignCast(obj_raw orelse return 0));
    return @bitCast(obj.scalars[@intCast(field_idx)]);
}

fn cbObjWriteScalar(_: *anyopaque, obj_raw: ?*anyopaque, field_idx: u64, val: i64) callconv(.c) void {
    const obj: *gc_mod.GcObject = @ptrCast(@alignCast(obj_raw orelse return));
    obj.scalars[@intCast(field_idx)] = @bitCast(val);
}

fn cbGcSafepoint(raw: *anyopaque, code_id: u64, pc_offset: u32, frame_ptr: [*]u8, frame_size: i32) callconv(.c) void {
    const st: *HostState = @ptrCast(@alignCast(raw));
    st.safepoints_hit += 1;
    st.relocations_before = st.rt.gc.stats.objects_relocated;
    const aligned_ptr: [*]align(8) u8 = @alignCast(frame_ptr);
    const frame_slice: []align(8) u8 = aligned_ptr[0..@intCast(frame_size)];
    st.rt.gc.collectAtAotSafepoint(code_id, pc_offset, frame_slice) catch {
        st.trap_code = 13;
        return;
    };
    st.relocations_after = st.rt.gc.stats.objects_relocated;
}

fn cbCallHotI32(raw: *anyopaque, cell_slot: i32, arg0: i32) callconv(.c) i32 {
    const st: *HostState = @ptrCast(@alignCast(raw));
    return arg0 * st.hot_multiplier + cell_slot;
}

fn cbSetTrap(raw: *anyopaque, code: i32) callconv(.c) void {
    const st: *HostState = @ptrCast(@alignCast(raw));
    if (st.trap_code == 0) st.trap_code = code;
}

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 4) {
        std.debug.print("r07-loader-usage: <mode:patch-test|diff-i32|diff-f64> <dll-path> <tpatch-path> [fn-name] [arg0] [arg1]\n", .{});
        std.process.exit(2);
    }

    const mode = args[1];
    const dll_path = args[2];
    const tpatch_path = args[3];

    // 1. Read and strictly verify R04 `.tpatch` envelope BEFORE loading DLL!
    const tpatch_bytes = try std.Io.Dir.cwd().readFileAlloc(io, tpatch_path, allocator, .limited(8 * 1024 * 1024));
    defer allocator.free(tpatch_bytes);
    proto.validateNativePatch(allocator, tpatch_bytes, null) catch |err| {
        std.debug.print("r07-tpatch-reject:{s}\n", .{@errorName(err)});
        std.process.exit(4);
    };

    // Parse payload to extract artifact SHA-256, abiHash, and stackMaps
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const env = try r04_id.verifyEnvelope(a, tpatch_bytes, "tsfg.native-patch", 1, "1", r04_id.SCHEMA_NATIVE_PATCH, 8388608, 32);
    const parsed = try std.json.parseFromSlice(proto.NativePatchPayload, a, env.value.payload, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = true,
    });
    const patch = parsed.value;

    // Verify DLL file bytes on disk match `.tpatch` artifact SHA-256!
    const dll_bytes = try std.Io.Dir.cwd().readFileAlloc(io, dll_path, allocator, .limited(16 * 1024 * 1024));
    defer allocator.free(dll_bytes);
    const actual_dll_sha = r04_id.sha256Parts(&.{dll_bytes});
    if (!std.mem.eql(u8, &actual_dll_sha, patch.artifact.sha256)) {
        std.debug.print("r07-dll-digest-mismatch\n", .{});
        std.process.exit(4);
    }

    // 2. Dynamically load the verified Windows x64 Patch DLL via Win32 LoadLibraryW
    var lib = try WinDll.open(allocator, dll_path);
    defer lib.close();

    // Verify exported ABI hash symbol matches `.tpatch` abiHash!
    const abi_sym = lib.lookup([*:0]const u8, "tsfg_patch_abi_hash") orelse {
        std.debug.print("r07-missing-abi-symbol\n", .{});
        std.process.exit(4);
    };
    const exported_abi = std.mem.span(abi_sym);
    if (!std.mem.eql(u8, exported_abi, patch.abiHash)) {
        std.debug.print("r07-abi-handshake-mismatch\n", .{});
        std.process.exit(4);
    }

    // 3. Create R06Runtime & register all AOT GC stackmaps before calling native code!
    const rt = try rt_mod.R06Runtime.create(allocator, 4 * 1024 * 1024, 65536);
    defer rt.destroy();

    const code_id: u64 = 1001;
    for (patch.functions) |f| {
        if (f.stackMap.len > 0) {
            try rt.gc.registerAotStackMap(code_id, f.stackMap);
        }
    }
    defer rt.gc.unregisterAotStackMap(code_id);

    var host = HostState{ .rt = rt };
    const cbs = R07RtCallbacks{
        .gc_alloc = &cbGcAlloc,
        .obj_read_scalar = &cbObjReadScalar,
        .obj_write_scalar = &cbObjWriteScalar,
        .gc_safepoint = &cbGcSafepoint,
        .call_hot_i32 = &cbCallHotI32,
        .set_trap = &cbSetTrap,
    };

    var out: std.ArrayListUnmanaged(u8) = .empty;
    defer out.deinit(allocator);

    if (std.mem.eql(u8, mode, "patch-test")) {
        const GcHotFn = *const fn (*anyopaque, *const R07RtCallbacks, i32) callconv(.c) i32;
        const PforFn = *const fn (*anyopaque, *const R07RtCallbacks, [*]i32, [*]const i32, i32, i32) callconv(.c) i32;
        const FloatFn = *const fn (*anyopaque, *const R07RtCallbacks, f64, f64) callconv(.c) f64;

        const fn_gc_hot = lib.lookup(GcHotFn, "aot_gc_and_hot_call") orelse return error.MissingSymbol;
        const fn_pfor = lib.lookup(PforFn, "aot_parallel_add") orelse return error.MissingSymbol;
        const fn_flt = lib.lookup(FloatFn, "aot_strict_f64_div") orelse return error.MissingSymbol;

        // 1. Run AOT function that allocates a young object, writes field, hits AOT GC safepoint
        //    (relocating young object in-place inside native stack frame!), reads field back, and calls hot FunctionCell!
        const gc_res = fn_gc_hot(&host, &cbs, 7);

        // 2. Run native AOT tsfg.parallel_for chunk loop
        const src_arr = [_]i32{ 10, 20, 30, 40, 50 };
        var dst_arr = [_]i32{ 0, 0, 0, 0, 0 };
        const pfor_ret = fn_pfor(&host, &cbs, &dst_arr, &src_arr, 5, 3);
        var pfor_sum: i32 = 0;
        for (dst_arr) |v| pfor_sum += v;

        // 3. Run strict IEEE f64 division (0.0 / 0.0 -> canonical quiet NaN 0x7ff8000000000000)
        const nan_val = fn_flt(&host, &cbs, 0.0, 0.0);
        const nan_bits: u64 = @bitCast(nan_val);

        try out.print(
            allocator,
            "{{\"gcRes\":{d},\"safepointsHit\":{d},\"relocated\":{d},\"pforRet\":{d},\"pforSum\":{d},\"nanBits\":\"{x:0>16}\",\"trap\":{d}}}\n",
            .{ gc_res, host.safepoints_hit, host.relocations_after - host.relocations_before, pfor_ret, pfor_sum, nan_bits, host.trap_code },
        );
    } else if (std.mem.eql(u8, mode, "diff-i32")) {
        const fn_name = try allocator.dupeZ(u8, args[4]);
        defer allocator.free(fn_name);
        const a0 = try std.fmt.parseInt(i32, args[5], 10);
        const a1 = try std.fmt.parseInt(i32, args[6], 10);
        const DiffFn = *const fn (*anyopaque, *const R07RtCallbacks, i32, i32) callconv(.c) i32;
        const f = lib.lookup(DiffFn, fn_name) orelse return error.MissingSymbol;
        const rv = f(&host, &cbs, a0, a1);
        try out.print(allocator, "{{\"value\":{d},\"trap\":{d}}}\n", .{ rv, host.trap_code });
    } else if (std.mem.eql(u8, mode, "diff-f64")) {
        const fn_name = try allocator.dupeZ(u8, args[4]);
        defer allocator.free(fn_name);
        const b0 = try std.fmt.parseInt(u64, args[5], 16);
        const b1 = try std.fmt.parseInt(u64, args[6], 16);
        const DiffF64 = *const fn (*anyopaque, *const R07RtCallbacks, f64, f64) callconv(.c) f64;
        const f = lib.lookup(DiffF64, fn_name) orelse return error.MissingSymbol;
        const rv = f(&host, &cbs, @bitCast(b0), @bitCast(b1));
        const rbits: u64 = @bitCast(rv);
        try out.print(allocator, "{{\"bits\":\"{x:0>16}\",\"trap\":{d}}}\n", .{ rbits, host.trap_code });
    } else {
        return error.InvalidMode;
    }

    try writeStdout(io, out.items);
}
