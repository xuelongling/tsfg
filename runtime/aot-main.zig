// SPDX-License-Identifier: MIT
// Production static-program entry. Code and complete immutable metadata enter
// only through the linker. JSON selects an existing root and typed arguments.
const std = @import("std");
const program = @import("aot-program.zig");
const abi = @import("aot-instance.zig");
const request = @import("request.zig");
const json = @import("request-json.zig");
const Runtime = @import("runtime-state.zig").Runtime;
const Counter = @import("host_counter.zig").Counter;
const evaluate = @import("aot-request.zig").evaluate;

fn moduleStatus(instance: *const ?abi.Instance) []const u8 {
    if (instance.* == null) return "uninitialized";
    const value = &instance.*.?;
    return switch (value.record.status) {
        0 => "uninitialized", 1 => "initializing", 2 => "initialized", 3 => "failed", else => unreachable,
    };
}
fn run(init: std.process.Init) !u8 {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    var persistent = false;
    var text: []const u8 = "[{}]";
    if (args.len == 3 and (std.mem.eql(u8, args[1], "--requests") or std.mem.eql(u8, args[1], "--module-requests"))) {
        persistent = std.mem.eql(u8, args[1], "--module-requests");
        text = args[2];
    } else if (args.len != 1) return error.Usage;
    if (text.len > @import("contract.zig").max_bytes) return error.RequestTooLong;
    var metadata = try program.Metadata.init();
    const parsed = try std.json.parseFromSlice([]const json.Request, init.gpa, text, .{});
    defer parsed.deinit();
    var host = Runtime.init(std.heap.page_allocator);
    defer host.deinit() catch unreachable;
    var counter: Counter = .{};
    var instance: ?abi.Instance = null;
    defer if (instance) |*value| value.deinit();
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    for (parsed.value, 0..) |*original, index| {
        if (index != 0) try output.writer.writeByte(',');
        const before = counter.events;
        var outcome: request.RequestOutcome = undefined;
        try evaluate(&host, &metadata, original, if (persistent) &instance else null, &counter, &outcome);
        defer request.deinitOutcome(&outcome);
        if (persistent) try @import("module-outcome-writer.zig").write(&output.writer, &outcome, &host,
            moduleStatus(&instance), &counter, before, original.stringOutput)
        else try @import("outcome-writer.zig").writeOutcome(&output.writer, &outcome, &host, original.stringOutput);
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
