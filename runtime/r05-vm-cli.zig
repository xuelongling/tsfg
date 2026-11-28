// SPDX-License-Identifier: MIT
//! Standalone Zero-Compiler-Dependency Zig R05 Predecoded Register VM CLI (`tsfg-r05-vm.exe`).
//! Accepts `TSFGR05B` binary bytecode on stdin, runs strict pre-load verification,
//! and executes requests exclusively via `r05-vm.eval_bytecode` on `r06-runtime.R06Runtime`.
const std = @import("std");
const bc = @import("r05-bytecode.zig");
const vm = @import("r05-vm.zig");
const rt_mod = @import("r06-runtime.zig");

fn writeStdout(io: std.Io, bytes: []const u8) !void {
    const stdout_file = std.Io.File.stdout();
    var write_buf: [4096]u8 = undefined;
    var writer = stdout_file.writer(io, &write_buf);
    try writer.interface.writeAll(bytes);
    try writer.interface.flush();
}

fn readStdinAll(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    const stdin_file = std.Io.File.stdin();
    var read_buf: [4096]u8 = undefined;
    var reader = stdin_file.reader(io, &read_buf);
    return reader.interface.allocRemaining(allocator, .limited(8 * 1024 * 1024));
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;
    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 2) {
        std.debug.print("r05-vm-usage: --verify-only | --run <fn_idx> [--unfused] [--fuel N] [--args a,b] | --bench <fn_idx> <iters> [--args a,b]\n", .{});
        std.process.exit(2);
    }

    const bytes = readStdinAll(allocator, io) catch |err| {
        std.debug.print("r05-vm-stdin: {s}\n", .{@errorName(err)});
        std.process.exit(3);
    };
    defer allocator.free(bytes);

    var mod = bc.verifyAndPredecode(allocator, bytes, null) catch |err| {
        std.debug.print("r05-verify-reject:{s}\n", .{@errorName(err)});
        std.process.exit(4);
    };
    defer mod.deinit();

    if (std.mem.eql(u8, args[1], "--verify-only")) {
        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        var total_fused: u32 = 0;
        for (mod.functions) |f| total_fused += f.fused_count;
        try out.print(allocator, "{{\"status\":\"verified\",\"functions\":{d},\"fusedSuperinstructions\":{d}}}\n", .{ mod.functions.len, total_fused });
        try writeStdout(io, out.items);
        return;
    }

    var unfused = false;
    var fuel: u64 = 100_000;
    var init_fn_idx: ?usize = null;
    var call_args: std.ArrayListUnmanaged(vm.TypedVal) = .empty;
    defer call_args.deinit(allocator);

    var ai: usize = 3;
    const is_bench = std.mem.eql(u8, args[1], "--bench");
    const bench_iters: usize = if (is_bench and args.len >= 4) try std.fmt.parseInt(usize, args[3], 10) else 1;
    if (is_bench) ai = 4;

    while (ai < args.len) : (ai += 1) {
        if (std.mem.eql(u8, args[ai], "--unfused")) {
            unfused = true;
        } else if (std.mem.eql(u8, args[ai], "--fuel") and ai + 1 < args.len) {
            ai += 1;
            fuel = try std.fmt.parseInt(u64, args[ai], 10);
        } else if (std.mem.eql(u8, args[ai], "--init-fn") and ai + 1 < args.len) {
            ai += 1;
            init_fn_idx = try std.fmt.parseInt(usize, args[ai], 10);
        } else if (std.mem.eql(u8, args[ai], "--args") and ai + 1 < args.len) {
            ai += 1;
            var it = std.mem.splitScalar(u8, args[ai], ',');
            while (it.next()) |tok| {
                if (tok.len == 0) continue;
                if (std.mem.eql(u8, tok, "undefined")) {
                    try call_args.append(allocator, vm.TypedVal.undef());
                } else if (std.mem.eql(u8, tok, "null")) {
                    try call_args.append(allocator, vm.TypedVal.nullVal());
                } else if (std.mem.eql(u8, tok, "true")) {
                    try call_args.append(allocator, vm.TypedVal.fromBool(true));
                } else if (std.mem.eql(u8, tok, "false")) {
                    try call_args.append(allocator, vm.TypedVal.fromBool(false));
                } else if (std.mem.startsWith(u8, tok, "f64:")) {
                    const f = try std.fmt.parseFloat(f64, tok[4..]);
                    try call_args.append(allocator, vm.TypedVal.fromF64Bits(@bitCast(f)));
                } else {
                    const n = try std.fmt.parseInt(i32, tok, 10);
                    try call_args.append(allocator, vm.TypedVal.fromI32(n));
                }
            }
        }
    }

    const fn_idx = try std.fmt.parseInt(usize, args[2], 10);
    if (fn_idx >= mod.functions.len) {
        std.debug.print("r05-vm-fn-oob\n", .{});
        std.process.exit(5);
    }
    const init_fid: ?[32]u8 = if (init_fn_idx) |ii| blk: {
        if (ii >= mod.functions.len) {
            std.debug.print("r05-vm-init-fn-oob\n", .{});
            std.process.exit(5);
        }
        break :blk mod.functions[ii].function_id;
    } else null;

    const rt = try rt_mod.R06Runtime.create(allocator, 4 * 1024 * 1024, 65536);
    defer rt.destroy();

    if (is_bench) {
        var timer = std.Io.Timestamp.now(io, .awake);
        var last_val: i32 = 0;
        for (0..bench_iters) |_| {
            const o = vm.eval_bytecode_with_init(rt, &mod, init_fid, mod.functions[fn_idx].function_id, call_args.items, &rt.capabilities, .{
                .semantic_fuel = fuel,
                .physical_instructions = 10_000_000,
                .use_superinstructions = !unfused,
            }, null);
            last_val = o.value.asI32();
        }
        const elapsed_ns = timer.untilNow(io, .awake).toNanoseconds();
        const expanded_bytes = mod.functions[fn_idx].fused_ops.len * @sizeOf(bc.DecodedOp);
        var out: std.ArrayListUnmanaged(u8) = .empty;
        defer out.deinit(allocator);
        try out.print(
            allocator,
            "{{\"mode\":\"{s}\",\"iters\":{d},\"value\":{d},\"elapsedNs\":{d},\"fusedOps\":{d},\"expandedBytes\":{d}}}\n",
            .{ if (unfused) "unfused" else "fused", bench_iters, last_val, elapsed_ns, mod.functions[fn_idx].fused_count, expanded_bytes },
        );
        try writeStdout(io, out.items);
        return;
    }

    var str_buf: std.ArrayListUnmanaged(u8) = .empty;
    defer str_buf.deinit(allocator);
    const res = vm.eval_bytecode_with_init(rt, &mod, init_fid, mod.functions[fn_idx].function_id, call_args.items, &rt.capabilities, .{
        .semantic_fuel = fuel,
        .use_superinstructions = !unfused,
    }, &str_buf);
    var out: std.ArrayListUnmanaged(u8) = .empty;
    defer out.deinit(allocator);
    try out.print(
        allocator,
        "{{\"status\":\"{s}\",\"tag\":{d},\"i32\":{d},\"f64Bits\":\"{x:0>16}\",\"bool\":{},\"str\":",
        .{
            @tagName(res.status),
            @intFromEnum(res.value.tag),
            res.value.asI32(),
            res.value.payload,
            res.value.payload != 0,
        },
    );
    // JSON-escaped string output
    try out.append(allocator, '"');
    for (str_buf.items) |ch| {
        if (ch == '"' or ch == '\\') {
            try out.append(allocator, '\\');
            try out.append(allocator, ch);
        } else if (ch == '\n') {
            try out.appendSlice(allocator, "\\n");
        } else if (ch == '\r') {
            try out.appendSlice(allocator, "\\r");
        } else if (ch == '\t') {
            try out.appendSlice(allocator, "\\t");
        } else {
            try out.append(allocator, ch);
        }
    }
    try out.print(
        allocator,
        "\",\"code\":\"{s}\",\"fuelConsumed\":{d},\"instructions\":{d},\"sourceStart\":{d},\"sourceEnd\":{d}}}\n",
        .{
            res.code,
            res.fuel_consumed,
            res.instructions_executed,
            res.source_start,
            res.source_end,
        },
    );
    try writeStdout(io, out.items);
}
