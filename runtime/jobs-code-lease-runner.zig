// SPDX-License-Identifier: MIT
//! Native CPU Query runner exercising `jobs.code_lease.CodeVersion` + `Store` +
//! `ParallelGroup.dispatchSystemStages` with real LLVM-compiled Windows DLL kernels.
const std = @import("std");
const jobs = @import("jobs.zig");
const T = jobs.query_tmeta;
const CL = jobs.code_lease;

const Receipt = struct {
    payloadHash: []const u8,
    inputIdentity: []const u8,
    packageId: []const u8,
    llvmHash: []const u8,
    batchHash: []const u8,
};

fn readAll(allocator: std.mem.Allocator, io: std.Io, path: []const u8) ![]u8 {
    return std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(16 * 1024 * 1024));
}

fn findComponent(layout: *const jobs.layout.Layout, name: []const u8) ![]const u8 {
    for (layout.payload.types) |row| {
        if (row.kind == .component and std.mem.eql(u8, row.name, name)) return row.id;
    }
    return error.ComponentMissing;
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 6) {
        std.debug.print("usage: runner <mode> <tmeta> <ll> <dll> <receipt-json> [chunkCap] [rows] [workers] [scalar0]\n", .{});
        std.process.exit(2);
    }
    const mode = args[1];
    const tmeta_bytes = try readAll(allocator, io, args[2]);
    defer allocator.free(tmeta_bytes);
    const llvm_bytes = try readAll(allocator, io, args[3]);
    defer allocator.free(llvm_bytes);
    const dll_path = args[4];
    const receipt_bytes = try readAll(allocator, io, args[5]);
    defer allocator.free(receipt_bytes);

    const chunk_cap: usize = if (args.len > 6) try std.fmt.parseInt(usize, args[6], 10) else 4;
    const row_count: usize = if (args.len > 7) try std.fmt.parseInt(usize, args[7], 10) else 15;
    const worker_count: usize = if (args.len > 8) try std.fmt.parseInt(usize, args[8], 10) else 4;

    const parsed = try std.json.parseFromSlice(Receipt, allocator, receipt_bytes, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    const r = parsed.value;

    var doc = try T.Document.load(allocator, tmeta_bytes, .{
        .payloadHash = r.payloadHash,
        .inputIdentity = r.inputIdentity,
        .packageId = r.packageId,
        .llvmArtifact = .{
            .llvmHash = r.llvmHash,
            .batchHash = r.batchHash,
            .metadataHash = r.payloadHash,
        },
    });
    defer doc.deinit();

    // Negative check 1: corrupted LLVM IR byte must fail closed with IdentityMismatch before DLL load.
    const bad_llvm = try allocator.dupe(u8, llvm_bytes);
    defer allocator.free(bad_llvm);
    bad_llvm[0] ^= 0x01;
    var bad_code = CL.CodeVersion.load(allocator, &doc, bad_llvm, dll_path);
    if (bad_code) |*ok| {
        ok.deinit() catch {};
        return error.ExpectedIdentityMismatch;
    } else |err| {
        if (err != error.IdentityMismatch) return err;
    }

    // Load real native DLL kernel under CodeVersion ownership.
    var code = try CL.CodeVersion.load(allocator, &doc, llvm_bytes, dll_path);
    var code_live = true;
    defer if (code_live) code.deinit() catch unreachable;

    // Negative check 2: unloading while a CodeLease is active MUST fail closed with LeaseActive.
    {
        var guard = code.acquireLease();
        defer guard.release();
        if (code.deinit()) |_| return error.ExpectedLeaseActive else |err| {
            if (err != error.LeaseActive) return err;
        }
    }

    var pool = std.Io.Threaded.init(std.heap.page_allocator, .{ .concurrent_limit = .limited(worker_count + 2) });
    defer pool.deinit();

    const Barrier = struct {
        target: usize,
        arrived: std.atomic.Value(usize) = .init(0),
        fn wait(self: *@This(), _: T.ParallelGroup.DispatchBatch) void {
            if (self.target <= 1) return;
            _ = self.arrived.fetchAdd(1, .acq_rel);
            var spins: usize = 0;
            while (self.arrived.load(.acquire) < self.target and spins < 50_000_000) : (spins += 1) {
                std.atomic.spinLoopHint();
            }
        }
    };
    var barrier: Barrier = .{ .target = if (worker_count >= 2) 2 else 1 };

    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(allocator);

    if (std.mem.eql(u8, mode, "i32-copy") or std.mem.eql(u8, mode, "i32-compound")) {
        const src_id = try findComponent(&doc.component_layout, "CopySource");
        const dst_id = try findComponent(&doc.component_layout, "CopyDestination");
        var store = try jobs.Store.init(allocator, &doc.component_layout, chunk_cap);
        defer store.deinit() catch unreachable;
        const archetype = try store.addArchetype(doc.component_layout.payload.components);

        const entities = try allocator.alloc(jobs.Entity, row_count);
        defer allocator.free(entities);

        const CopySource = extern struct { n: i32 };
        const CopyDest = extern struct { pad: i32, n: i32 };
        const seed_src = [_]i32{ 0, 1, -1, 42, -42, 2147483647, -2147483648, 123456, -987654, 7, 1000000000, -1000000000, 13, -13, 999999 };
        const seed_dst = [_]i32{ 10, 20, -30, 100, -100, 5, -5, 2147483640, -2147483640, 3, 1500000000, -1500000000, 77, -77, 1 };

        for (0..row_count) |i| {
            const s = CopySource{ .n = seed_src[i % seed_src.len] };
            const d = CopyDest{ .pad = @as(i32, @intCast(0x1000 + i)), .n = seed_dst[i % seed_dst.len] };
            entities[i] = try store.create(archetype, &.{
                .{ .component = src_id, .bytes = std.mem.asBytes(&s) },
                .{ .component = dst_id, .bytes = std.mem.asBytes(&d) },
            });
        }

        const sys_id = doc.effects.report.systems[0].functionId;
        const admission = try doc.admitParallelGroup(allocator, &.{sys_id});
        var group = switch (admission) {
            .admitted => |g| g,
            .conflict => return error.UnexpectedConflict,
        };
        defer group.deinit();

        const stats = try code.executeParallelGroupWithHook(allocator, &group, &store, &.{&.{}}, pool.io(), worker_count, &barrier, Barrier.wait);

        // Verify post-execution Store re-borrow works cleanly (all Store leases released!).
        const reborrow = try store.borrowWrite(entities[0], dst_id);
        try reborrow.release();

        try out.print(allocator, "{{\"batchesExecuted\":{d},\"distinctThreads\":{d},\"rows\":[", .{ stats.batches_executed, stats.distinct_threads });
        for (entities, 0..) |entity, i| {
            var s: CopySource = undefined;
            var d: CopyDest = undefined;
            try store.read(entity, src_id, std.mem.asBytes(&s));
            try store.read(entity, dst_id, std.mem.asBytes(&d));
            if (i > 0) try out.append(allocator, ',');
            try out.print(allocator, "{{\"srcN\":{d},\"dstPad\":{d},\"dstN\":{d}}}", .{ s.n, d.pad, d.n });
        }
        try out.appendSlice(allocator, "]}\n");
    } else if (std.mem.eql(u8, mode, "multi-f64-add")) {
        const dt: f64 = if (args.len > 9) try std.fmt.parseFloat(f64, args[9]) else 0.25;
        const pos_id = try findComponent(&doc.component_layout, "Position");
        const vel_id = try findComponent(&doc.component_layout, "Velocity");
        var store = try jobs.Store.init(allocator, &doc.component_layout, chunk_cap);
        defer store.deinit() catch unreachable;
        const archetype = try store.addArchetype(doc.component_layout.payload.components);

        const entities = try allocator.alloc(jobs.Entity, row_count);
        defer allocator.free(entities);

        const Vec2 = extern struct { x: f64, y: f64 };
        for (0..row_count) |i| {
            const p = Vec2{ .x = @as(f64, @floatFromInt(i)) * 1.5, .y = @as(f64, @floatFromInt(i)) * -2.25 };
            const v = Vec2{ .x = @as(f64, @floatFromInt(i + 1)) * 4.0, .y = @as(f64, @floatFromInt(i + 1)) * 0.5 };
            entities[i] = try store.create(archetype, &.{
                .{ .component = pos_id, .bytes = std.mem.asBytes(&p) },
                .{ .component = vel_id, .bytes = std.mem.asBytes(&v) },
            });
        }

        const sys_id = doc.effects.report.systems[0].functionId;
        const admission = try doc.admitParallelGroup(allocator, &.{sys_id});
        var group = switch (admission) {
            .admitted => |g| g,
            .conflict => return error.UnexpectedConflict,
        };
        defer group.deinit();

        const scalars = [_]T.ScalarValue{.{ .float64 = dt }};
        const stats = try code.executeParallelGroup(allocator, &group, &store, &.{&scalars}, pool.io(), worker_count);

        try out.print(allocator, "{{\"batchesExecuted\":{d},\"distinctThreads\":{d},\"rows\":[", .{ stats.batches_executed, stats.distinct_threads });
        for (entities, 0..) |entity, i| {
            var p: Vec2 = undefined;
            var v: Vec2 = undefined;
            try store.read(entity, pos_id, std.mem.asBytes(&p));
            try store.read(entity, vel_id, std.mem.asBytes(&v));
            if (i > 0) try out.append(allocator, ',');
            try out.print(allocator, "{{\"px\":{d},\"py\":{d},\"vx\":{d},\"vy\":{d}}}", .{ p.x, p.y, v.x, v.y });
        }
        try out.appendSlice(allocator, "]}\n");
    } else if (std.mem.eql(u8, mode, "multi-conflict-and-parallel")) {
        // Exercise multi-system parallel admission + conflict rejection + concurrent multi-system native execution!
        var store = try jobs.Store.init(allocator, &doc.component_layout, chunk_cap);
        defer store.deinit() catch unreachable;
        const archetype = try store.addArchetype(doc.component_layout.payload.components);
        const entities = try allocator.alloc(jobs.Entity, row_count);
        defer allocator.free(entities);
        for (0..row_count) |i| {
            entities[i] = try store.create(archetype, &.{});
        }

        // Verify at least one conflicting pair is rejected cleanly
        var conflicts_rejected: usize = 0;
        for (doc.effects.report.conflicts) |edge| {
            const adm = try doc.admitParallelGroup(allocator, &.{ edge.left, edge.right });
            switch (adm) {
                .conflict => conflicts_rejected += 1,
                .admitted => |g| {
                    var mut_g = g;
                    mut_g.deinit();
                    return error.ExpectedConflict;
                },
            }
        }

        // Find an independent pair of systems with loops and execute them CONCURRENTLY in one ParallelGroup!
        var pair_left: ?[]const u8 = null;
        var pair_right: ?[]const u8 = null;
        var left_scalars_n: usize = 0;
        var right_scalars_n: usize = 0;
        outer: for (doc.effects.report.systems, 0..) |sa, ia| {
            if (sa.loops.len == 0) continue;
            for (doc.effects.report.systems[ia + 1 ..]) |sb| {
                if (sb.loops.len == 0) continue;
                const adm = try doc.admitParallelGroup(allocator, &.{ sa.functionId, sb.functionId });
                switch (adm) {
                    .admitted => |g| {
                        var mut_g = g;
                        left_scalars_n = mut_g.systems[0].entries[0].scalars.len;
                        right_scalars_n = mut_g.systems[1].entries[0].scalars.len;
                        mut_g.deinit();
                        pair_left = sa.functionId;
                        pair_right = sb.functionId;
                        break :outer;
                    },
                    .conflict => {},
                }
            }
        }
        if (pair_left == null or pair_right == null) return error.NoIndependentPair;

        const adm = try doc.admitParallelGroup(allocator, &.{ pair_left.?, pair_right.? });
        var group = adm.admitted;
        defer group.deinit();

        const s_left = try allocator.alloc(T.ScalarValue, left_scalars_n);
        defer allocator.free(s_left);
        for (s_left, 0..) |*sv, idx| {
            const formal = group.systems[0].entries[0].scalars[idx];
            sv.* = if (std.mem.eql(u8, formal.type, "f64")) .{ .float64 = 1.5 } else .{ .float32 = 1.5 };
        }
        const s_right = try allocator.alloc(T.ScalarValue, right_scalars_n);
        defer allocator.free(s_right);
        for (s_right, 0..) |*sv, idx| {
            const formal = group.systems[1].entries[0].scalars[idx];
            sv.* = if (std.mem.eql(u8, formal.type, "f64")) .{ .float64 = 2.5 } else .{ .float32 = 2.5 };
        }

        const stats = try code.executeParallelGroupWithHook(allocator, &group, &store, &.{ s_left, s_right }, pool.io(), worker_count, &barrier, Barrier.wait);
        try out.print(allocator, "{{\"conflictsRejected\":{d},\"batchesExecuted\":{d},\"distinctThreads\":{d}}}\n", .{
            conflicts_rejected,
            stats.batches_executed,
            stats.distinct_threads,
        });
    } else {
        return error.UnsupportedMode;
    }

    // Verify clean CodeVersion teardown succeeds after all workers exited and leases released.
    try code.deinit();
    code_live = false;

    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(out.items);
    try writer.interface.flush();
}
