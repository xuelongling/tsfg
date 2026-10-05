// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("root.zig");

const Request = struct {
    functionId: ?[]const u8 = null,
    arguments: []const std.json.Value = &.{},
    capabilities: []const std.json.Value = &.{},
    memoryBytes: u64 = 4,
    instructionBudget: u64 = 2,
    depth: u32 = 1,
};

fn writeOutcome(writer: *std.Io.Writer, outcome: runtime.RequestOutcome, host: *const runtime.Runtime) !void {
    const function_id = switch (outcome) {
        .returned => |r| r.function_id,
        .failed => |r| r.function_id,
    };
    const source = switch (outcome) {
        .returned => |r| r.source,
        .failed => |r| r.source,
    };
    const function_hex = runtime.digestText(function_id);
    const source_hex = runtime.digestText(source.hash);
    var buffers: [4][32]u8 = undefined;
    const start = try std.fmt.bufPrint(&buffers[0], "{d}", .{source.start});
    const end = try std.fmt.bufPrint(&buffers[1], "{d}", .{source.end});
    const active = try std.fmt.bufPrint(&buffers[2], "{d}", .{host.activeRequests()});
    const source_view = .{ .path = source.path, .hash = @as([]const u8, &source_hex), .start = start, .end = end };
    switch (outcome) {
        .returned => |returned| {
            const value = try std.fmt.bufPrint(&buffers[3], "{d}", .{returned.result.i32});
            try std.json.Stringify.value(.{ .status = "returned", .result = .{ .type = "i32", .value = value }, .source = source_view, .functionId = @as([]const u8, &function_hex), .activeRequests = active }, .{}, writer);
        },
        .failed => |failed| try std.json.Stringify.value(.{ .status = "failed", .code = failed.code, .category = failed.category, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active }, .{}, writer),
    }
}

fn run(init: std.process.Init) !u8 {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    var mode: enum { evaluate, inspect, roundtrip } = .evaluate;
    var requests_json: []const u8 = "[{}]";
    if (args.len == 2 and std.mem.eql(u8, args[1], "--inspect")) {
        mode = .inspect;
    } else if (args.len == 2 and std.mem.eql(u8, args[1], "--roundtrip")) {
        mode = .roundtrip;
    } else if (args.len == 3 and std.mem.eql(u8, args[1], "--requests")) {
        requests_json = args[2];
        if (requests_json.len > runtime.contract.max_bytes) return error.RequestTooLong;
    } else if (args.len != 1) return error.Usage;

    var read_buffer: [4096]u8 = undefined;
    var stdin_reader = std.Io.File.stdin().readerStreaming(init.io, &read_buffer);
    const bytes = stdin_reader.interface.allocRemaining(init.gpa, .limited(runtime.contract.max_bytes)) catch |err| {
        if (err == error.StreamTooLong) {
            try std.Io.File.stderr().writeStreamingAll(init.io, "{\"code\":\"r04-size\",\"offset\":0}\n");
            return 3;
        }
        return err;
    };
    defer init.gpa.free(bytes);
    const module = switch (runtime.load(init.gpa, bytes)) {
        .loaded => |module| module,
        .rejected => |failure| {
            const diagnostic = try std.json.Stringify.valueAlloc(init.gpa, .{ .code = failure.code, .offset = failure.offset }, .{});
            defer init.gpa.free(diagnostic);
            try std.Io.File.stderr().writeStreamingAll(init.io, diagnostic);
            try std.Io.File.stderr().writeStreamingAll(init.io, "\n");
            return 3;
        },
    };
    defer runtime.unload(module);
    if (mode == .inspect or mode == .roundtrip) {
        const output = if (mode == .inspect) try runtime.inspect(module, init.gpa) else try runtime.serialize(module, init.gpa);
        defer init.gpa.free(output);
        try std.Io.File.stdout().writeStreamingAll(init.io, output);
        if (mode == .inspect) try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    const requests = try std.json.parseFromSlice([]const Request, init.gpa, requests_json, .{});
    defer requests.deinit();
    var host = runtime.Runtime.init(init.gpa);
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    for (requests.value, 0..) |request, index| {
        if (index != 0) try output.writer.writeByte(',');
        var function_id = runtime.moduleInfo(module).function_id;
        if (request.functionId) |text| {
            const id = if (std.mem.startsWith(u8, text, "sha256:")) text[7..] else text;
            if (id.len != 64) return error.FunctionId;
            for (id) |character| if (!std.ascii.isDigit(character) and !(character >= 'a' and character <= 'f')) return error.FunctionId;
            _ = try std.fmt.hexToBytes(&function_id, id);
        }
        const outcome = runtime.eval_bytecode(&host, module, function_id, if (request.arguments.len == 0) &.{} else &.{.{ .i32 = 0 }}, if (request.capabilities.len == 0) &.{} else &.{.{ .id = 0 }}, .{ .memory_bytes = @intCast(request.memoryBytes), .instruction_budget = request.instructionBudget, .depth = request.depth });
        try writeOutcome(&output.writer, outcome, &host);
    }
    try output.writer.writeAll("]\n");
    try std.Io.File.stdout().writeStreamingAll(init.io, output.written());
    return 0;
}

pub fn main(init: std.process.Init) void {
    const status = run(init) catch |err| {
        var buffer: [256]u8 = undefined;
        const message = std.fmt.bufPrint(&buffer, "r05-cli-{s}\n", .{@errorName(err)}) catch "r05-cli-internal\n";
        std.Io.File.stderr().writeStreamingAll(init.io, message) catch {};
        std.process.exit(2);
    };
    if (status != 0) std.process.exit(status);
}
