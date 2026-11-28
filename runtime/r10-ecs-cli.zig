// SPDX-License-Identifier: MIT
//! R10 3-Way ECS Workload Benchmark & Bit-Exact Oracle CLI (`tsfg-r10-ecs.exe`).
//! Runs 16,384 entities (256 chunks x 64) through:
//!   1. Scalar Reference Oracle
//!   2. 4-Wide Batch SIMD Interpreter (4-thread work-stealing)
//!   3. REAL Windows x64 Vectorized `<4 x float>` AOT Patch DLL (4-thread work-stealing)
//! Verifies bit-exact f32 equivalence across ALL 16,384 entities and reports real timing baselines!
const std = @import("std");
const ecs = @import("r10-ecs-jobs.zig");

const HMODULE = *anyopaque;
const FARPROC = *const anyopaque;

extern "kernel32" fn LoadLibraryW(lpLibFileName: [*:0]const u16) callconv(.winapi) ?HMODULE;
extern "kernel32" fn GetProcAddress(hModule: HMODULE, lpProcName: [*:0]const u8) callconv(.winapi) ?FARPROC;
extern "kernel32" fn FreeLibrary(hLibModule: HMODULE) callconv(.winapi) c_int;
extern "kernel32" fn QueryPerformanceCounter(lpPerformanceCount: *i64) callconv(.winapi) c_int;
extern "kernel32" fn QueryPerformanceFrequency(lpFrequency: *i64) callconv(.winapi) c_int;

const AotChunkFn = *const fn ([*]f32, [*]f32, [*]const f32, [*]const f32, i32, f32) callconv(.c) i32;

fn nowQpc() i64 {
    var v: i64 = 0;
    _ = QueryPerformanceCounter(&v);
    return v;
}

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

fn buildWorld(allocator: std.mem.Allocator, entity_count: usize) !ecs.EcsWorld {
    var w = ecs.EcsWorld.init(allocator);
    errdefer w.deinit();
    for (0..entity_count) |i| {
        const fi: f32 = @floatFromInt(i);
        _ = try w.spawn(
            ecs.COMP_POS | ecs.COMP_VEL,
            .{ .x = fi * 0.25, .y = fi * -0.125 },
            .{ .x = 1.5 + @as(f32, @floatFromInt(i % 7)), .y = -2.0 + @as(f32, @floatFromInt(i % 5)) },
            null,
        );
    }
    return w;
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len < 2) {
        std.debug.print("usage: r10-ecs-cli <vectorized_kernel.dll> [entity_count]\n", .{});
        std.process.exit(2);
    }

    const dll_path = args[1];
    const entity_count: usize = if (args.len >= 3) try std.fmt.parseInt(usize, args[2], 10) else 16384;
    const dt: f32 = 0.016666668;
    const steps: usize = 8;

    const wpath = try std.unicode.utf8ToUtf16LeAllocZ(allocator, dll_path);
    defer allocator.free(wpath);
    const hmod = LoadLibraryW(wpath) orelse return error.LibraryLoadFailed;
    defer _ = FreeLibrary(hmod);

    const raw_sym = GetProcAddress(hmod, "tsfg_chunk_integrate_f32_vec4") orelse return error.SymbolNotFound;
    const aot_fn: AotChunkFn = @ptrCast(@alignCast(raw_sym));

    var freq: i64 = 1;
    _ = QueryPerformanceFrequency(&freq);

    var w_scalar = try buildWorld(allocator, entity_count);
    defer w_scalar.deinit();
    var w_batch = try buildWorld(allocator, entity_count);
    defer w_batch.deinit();
    var w_aot = try buildWorld(allocator, entity_count);
    defer w_aot.deinit();

    var c_scalar: std.ArrayListUnmanaged(*ecs.Chunk) = .empty;
    defer c_scalar.deinit(allocator);
    try w_scalar.queryChunks(ecs.COMP_POS | ecs.COMP_VEL, &c_scalar);

    var c_batch: std.ArrayListUnmanaged(*ecs.Chunk) = .empty;
    defer c_batch.deinit(allocator);
    try w_batch.queryChunks(ecs.COMP_POS | ecs.COMP_VEL, &c_batch);

    var c_aot: std.ArrayListUnmanaged(*ecs.Chunk) = .empty;
    defer c_aot.deinit(allocator);
    try w_aot.queryChunks(ecs.COMP_POS | ecs.COMP_VEL, &c_aot);

    // 1. Scalar Reference
    const t0 = nowQpc();
    for (0..steps) |_| {
        for (c_scalar.items) |ch| try ecs.runScalarIntegrateChunk(ch, dt);
    }
    const t1 = nowQpc();

    // 2. 4-Thread Work-Stealing Batch SIMD Interpreter
    var js = ecs.WorkStealingJobSystem.init(allocator, 4, false);
    const BatchCtx = struct {
        chunks: []*ecs.Chunk,
        dt: f32,
        fn exec(c: @This(), idx: usize) !void {
            _ = try ecs.runBatchSimdIntegrateChunk(c.chunks[idx], c.dt, true);
        }
    };
    const t2 = nowQpc();
    var batch_stolen: usize = 0;
    for (0..steps) |_| {
        const st = try js.parallelFor(c_batch.items.len, null, BatchCtx{ .chunks = c_batch.items, .dt = dt }, BatchCtx.exec);
        batch_stolen += st.tasks_stolen;
    }
    const t3 = nowQpc();

    // 3. 4-Thread Work-Stealing REAL Windows x64 Vectorized AOT DLL
    const AotCtx = struct {
        chunks: []*ecs.Chunk,
        dt: f32,
        aot_fn: AotChunkFn,
        fn exec(c: @This(), idx: usize) !void {
            const ch = c.chunks[idx];
            try ch.acquireWritePos();
            defer ch.releaseWritePos();
            try ch.acquireReadVel();
            defer ch.releaseReadVel();
            _ = c.aot_fn(&ch.pos_x, &ch.pos_y, &ch.vel_x, &ch.vel_y, @intCast(ch.len), c.dt);
        }
    };
    const t4 = nowQpc();
    var aot_stolen: usize = 0;
    for (0..steps) |_| {
        const st = try js.parallelFor(c_aot.items.len, null, AotCtx{ .chunks = c_aot.items, .dt = dt, .aot_fn = aot_fn }, AotCtx.exec);
        aot_stolen += st.tasks_stolen;
    }
    const t5 = nowQpc();

    // Bit-exact f32 equivalence check across ALL entities!
    var mismatches: usize = 0;
    for (0..c_scalar.items.len) |ci| {
        const cs = c_scalar.items[ci];
        const cb = c_batch.items[ci];
        const ca = c_aot.items[ci];
        for (0..cs.len) |r| {
            const sx: u32 = @bitCast(cs.pos_x[r]);
            const sy: u32 = @bitCast(cs.pos_y[r]);
            const bx: u32 = @bitCast(cb.pos_x[r]);
            const by: u32 = @bitCast(cb.pos_y[r]);
            const ax: u32 = @bitCast(ca.pos_x[r]);
            const ay: u32 = @bitCast(ca.pos_y[r]);
            if (sx != bx or sy != by or sx != ax or sy != ay) mismatches += 1;
        }
    }

    const toUs = struct {
        fn calc(delta: i64, f: i64) u64 {
            if (delta <= 0) return 0;
            return @intCast(@divTrunc(@as(i128, delta) * 1_000_000, f));
        }
    }.calc;

    var out: std.ArrayListUnmanaged(u8) = .empty;
    defer out.deinit(allocator);
    try out.print(
        allocator,
        "{{\"entities\":{d},\"chunks\":{d},\"steps\":{d},\"bitExactMismatches\":{d},\"scalarUs\":{d},\"batchSimdUs\":{d},\"aotVec4Us\":{d},\"batchStolen\":{d},\"aotStolen\":{d}}}\n",
        .{
            entity_count,
            c_scalar.items.len,
            steps,
            mismatches,
            toUs(t1 - t0, freq),
            toUs(t3 - t2, freq),
            toUs(t5 - t4, freq),
            batch_stolen,
            aot_stolen,
        },
    );
    try writeStdout(io, out.items);
}
