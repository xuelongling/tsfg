// SPDX-License-Identifier: MIT
//! Unified Standalone Windows x64 `tsfg-runtime.exe` CLI.
//! Single zero-compiler-dependency runtime host supporting:
//!   - `--version` / `--info` (reports ABI version, CPU target, subsystems)
//!   - `--verify <bc-file>` (strict R05 bytecode verification)
//!   - `--run <bc-file> <fn_idx> [--init-fns i0,i1] [--args ...] [--frames N] [--profile-trace]`
const std = @import("std");
const engine = @import("tsfg-runtime.zig");

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

    if (args.len < 2 or std.mem.eql(u8, args[1], "--version") or std.mem.eql(u8, args[1], "--info")) {
        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try out.print(
            allocator,
            "{{\"runtime\":\"tsfg-runtime\",\"abiVersion\":{d},\"target\":\"windows-x86_64-msvc\",\"subsystems\":[\"r04-abi\",\"r05-vm\",\"r06-gen-gc\",\"r09-hot-reload\",\"r10-ecs-jobs\",\"r11-vulkan-gpu\",\"qpc-profiler\"]}}\n",
            .{engine.ABI_VERSION},
        );
        try writeStdout(io, out.items);
        return;
    }

    if (std.mem.eql(u8, args[1], "--verify") and args.len >= 3) {
        const bytes = try std.Io.Dir.cwd().readFileAlloc(io, args[2], allocator, .limited(8 * 1024 * 1024));
        defer allocator.free(bytes);
        var mod = engine.bytecode.verifyAndPredecode(allocator, bytes, null) catch |err| {
            std.debug.print("tsfg-runtime-verify-reject:{s}\n", .{@errorName(err)});
            std.process.exit(4);
        };
        defer mod.deinit();
        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try out.print(allocator, "{{\"status\":\"verified\",\"functions\":{d},\"globals\":{d}}}\n", .{ mod.functions.len, mod.global_count });
        try writeStdout(io, out.items);
        return;
    }

    if (std.mem.eql(u8, args[1], "--run") and args.len >= 4) {
        const bc_bytes = try std.Io.Dir.cwd().readFileAlloc(io, args[2], allocator, .limited(8 * 1024 * 1024));
        defer allocator.free(bc_bytes);
        const fn_idx = try std.fmt.parseInt(usize, args[3], 10);

        var frames: usize = 1;
        var profile = false;
        var init_indices: std.ArrayListUnmanaged(usize) = .empty;
        defer init_indices.deinit(allocator);
        var call_args: std.ArrayListUnmanaged(engine.vm.TypedVal) = .empty;
        defer call_args.deinit(allocator);

        var ai: usize = 4;
        while (ai < args.len) : (ai += 1) {
            if (std.mem.eql(u8, args[ai], "--profile-trace")) {
                profile = true;
            } else if (std.mem.eql(u8, args[ai], "--frames") and ai + 1 < args.len) {
                ai += 1;
                frames = try std.fmt.parseInt(usize, args[ai], 10);
            } else if (std.mem.eql(u8, args[ai], "--init-fns") and ai + 1 < args.len) {
                ai += 1;
                var it = std.mem.splitScalar(u8, args[ai], ',');
                while (it.next()) |tok| {
                    if (tok.len == 0) continue;
                    try init_indices.append(allocator, try std.fmt.parseInt(usize, tok, 10));
                }
            } else if (std.mem.eql(u8, args[ai], "--args") and ai + 1 < args.len) {
                ai += 1;
                var it = std.mem.splitScalar(u8, args[ai], ',');
                while (it.next()) |tok| {
                    if (tok.len == 0) continue;
                    const n = try std.fmt.parseInt(i32, tok, 10);
                    try call_args.append(allocator, engine.vm.TypedVal.fromI32(n));
                }
            }
        }

        const schema = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
        const eng = try engine.TsfgEngine.create(allocator, 16 * 1024 * 1024, 65536, 4, schema);
        defer eng.destroy();
        eng.enableProfiling(profile);

        const inst = try eng.loadBytecodeInstance(bc_bytes, null);
        if (fn_idx >= inst.mod.functions.len) std.process.exit(5);
        for (init_indices.items) |ii| {
            if (ii < inst.mod.functions.len) {
                _ = inst.callFunction(inst.mod.functions[ii].function_id, &.{}, .{}, null);
            }
        }

        var last = engine.vm.ExecutionOutcome{ .status = .ok };
        var str_buf: std.ArrayListUnmanaged(u8) = .empty;
        defer str_buf.deinit(allocator);
        for (0..frames) |_| {
            str_buf.clearRetainingCapacity();
            last = inst.callFunction(inst.mod.functions[fn_idx].function_id, call_args.items, .{}, &str_buf);
            if (last.status != .ok) break;
        }

        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try out.print(
            allocator,
            "{{\"status\":\"{s}\",\"frames\":{d},\"i32\":{d},\"code\":\"{s}\",\"gcMinor\":{d},\"gcRelocated\":{d}",
            .{ @tagName(last.status), frames, last.value.asI32(), last.code, eng.rt.gc.stats.minor_collections, eng.rt.gc.stats.objects_relocated },
        );
        if (profile) {
            const tj = try eng.exportChromeTraceJsonAlloc(allocator);
            defer allocator.free(tj);
            try out.appendSlice(allocator, ",\"trace\":");
            try out.appendSlice(allocator, tj);
        }
        try out.appendSlice(allocator, "}\n");
        try writeStdout(io, out.items);
        return;
    }

    std.debug.print("tsfg-runtime-usage: --info | --verify <file.tbc> | --run <file.tbc> <fn_idx> [--frames N] [--profile-trace]\n", .{});
    std.process.exit(2);
}
