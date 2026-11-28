// SPDX-License-Identifier: MIT
//! R09 End-to-End 3-Phase Hot-Reload CLI (`tsfg-r09-hot-reload.exe`).
//! Drives REAL Windows x64 Patch DLL v1 -> Verified R05 Bytecode -> Patch DLL v2
//! with delayed old-frame protection, closure indirection, tamper/mismatch rejection,
//! concurrent caller verification, and full epoch DLL unloading!
const std = @import("std");
const rt_mod = @import("r06-runtime.zig");
const hr_mod = @import("r09-hot-reload.zig");

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

fn parseHex32(hex: []const u8) ![32]u8 {
    if (hex.len != 64) return error.InvalidHex;
    var out: [32]u8 = undefined;
    for (0..32) |i| {
        out[i] = try std.fmt.parseInt(u8, hex[i * 2 .. i * 2 + 2], 16);
    }
    return out;
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 13) {
        std.debug.print(
            "usage: r09-hot-reload-cli <v1.dll> <v1.tpatch> <v2.tbc> <v2_fn_hex32> <v3.dll> <v3.tpatch> <bad.tpatch> <fn_sym> <sig> <eff> <cap> <schema>\n",
            .{},
        );
        std.process.exit(2);
    }

    const v1_dll = args[1];
    const v1_tpatch = args[2];
    const v2_tbc_path = args[3];
    const v2_fn_id = try parseHex32(args[4]);
    const v3_dll = args[5];
    const v3_tpatch = args[6];
    const bad_tpatch = args[7];
    const fn_sym = try allocator.dupeZ(u8, args[8]);
    defer allocator.free(fn_sym);

    const contract = hr_mod.FunctionContract{
        .signature_hash = args[9],
        .effect_hash = args[10],
        .capture_layout_hash = args[11],
        .static_schema_hash = args[12],
    };

    const rt = try rt_mod.R06Runtime.create(allocator, 4 * 1024 * 1024, 65536);
    defer rt.destroy();

    var hr = try hr_mod.HotReloadRuntime.init(allocator, rt, contract.static_schema_hash, &.{ 10, 20 });
    defer hr.deinit();

    // Phase 1: Publish & execute REAL Windows x64 DLL v1 (code_version = 1)
    const ver1 = try hr.publishNativeDll(io, 1, fn_sym, v1_dll, v1_tpatch, contract);
    const p1_res = try hr.invokeI32(1, 7, 3);

    // Pin a DELAYED lease on DLL v1 BEFORE Phase 2 switching!
    var delayed_v1 = try hr.acquireLease(1);

    // Negative check: tampered `.tpatch` must be rejected while v1 stays live!
    var bad_rejected = false;
    if (hr.publishNativeDll(io, 1, fn_sym, v3_dll, bad_tpatch, contract)) |_| {
        bad_rejected = false;
    } else |_| {
        bad_rejected = true;
    }

    // Phase 2: Publish & execute verified R05 Bytecode v2 (code_version = 2)
    const v2_bytes = try std.Io.Dir.cwd().readFileAlloc(io, v2_tbc_path, allocator, .limited(4 * 1024 * 1024));
    defer allocator.free(v2_bytes);
    try hr.publishBytecode(1, 2, contract, v2_bytes, v2_fn_id);
    const p2_res = try hr.invokeI32(1, 7, 3);

    // Reclaim while delayed_v1 is STILL pinned: v1 DLL MUST stay loaded (deferred = 1)!
    const rec_while_pinned = hr.reclaimRetired();

    // Delayed old-native v1 frame executes to completion safely AFTER bytecode phase is live!
    const delayed_res = hr.invokeWithLease(delayed_v1, 7, 3);
    delayed_v1.release();

    // Now v1 DLL must be reclaimed & unloaded via FreeLibrary!
    const rec_after_v1_release = hr.reclaimRetired();

    // Phase 3: Publish & execute REAL Windows x64 DLL v3 (code_version = 3)
    const ver3 = try hr.publishNativeDll(io, 1, fn_sym, v3_dll, v3_tpatch, contract);
    const p3_res = try hr.invokeI32(1, 7, 3);

    // Reclaim Phase 2 bytecode descriptor!
    const rec_after_v3 = hr.reclaimRetired();

    var out: std.ArrayListUnmanaged(u8) = .empty;
    defer out.deinit(allocator);
    try out.print(
        allocator,
        "{{\"ver1\":{d},\"p1Val\":{d},\"p1Tier\":\"{s}\",\"badRejected\":{},\"p2Val\":{d},\"p2Tier\":\"{s}\",\"p2Ver\":{d},\"delayedVal\":{d},\"delayedVer\":{d},\"deferredWhilePinned\":{d},\"unloadedAfterRelease\":{d},\"ver3\":{d},\"p3Val\":{d},\"p3Tier\":\"{s}\",\"reclaimedAfterV3\":{d},\"totalPublishes\":{d},\"totalRejections\":{d},\"remainingRetired\":{d}}}\n",
        .{
            ver1,
            p1_res.value,
            @tagName(p1_res.tier),
            bad_rejected,
            p2_res.value,
            @tagName(p2_res.tier),
            p2_res.code_version,
            delayed_res.value,
            delayed_res.code_version,
            rec_while_pinned.deferred_active,
            rec_after_v1_release.unloaded_dlls,
            ver3,
            p3_res.value,
            @tagName(p3_res.tier),
            rec_after_v3.reclaimed_descriptors,
            hr.total_publishes,
            hr.total_rejections,
            hr.retired.items.len,
        },
    );
    try writeStdout(io, out.items);
}
