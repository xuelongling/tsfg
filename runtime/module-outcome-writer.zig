// SPDX-License-Identifier: MIT
const std = @import("std");
const Runtime = @import("runtime-state.zig").Runtime;
const request = @import("request.zig");
const Counter = @import("host_counter.zig").Counter;

pub fn write(writer: *std.Io.Writer, outcome: *const request.RequestOutcome, host: *const Runtime,
    status: []const u8, counter: *const Counter, events_before: u64, mode: @import("string-output.zig").Mode) !void
{
    var base: std.Io.Writer.Allocating = .init(host.allocator);
    defer base.deinit();
    try @import("outcome-writer.zig").writeOutcome(&base.writer, outcome, host, mode);
    const bytes = base.written();
    try writer.writeAll(bytes[0..bytes.len - 1]);
    try writer.writeAll(",\"moduleStatus\":");
    try std.json.Stringify.value(status, .{}, writer);
    try writer.writeAll(",\"hostEvents\":");
    try std.json.Stringify.value(counter.events, .{}, writer);
    try writer.writeAll(",\"requestHostEvents\":");
    try std.json.Stringify.value(counter.events -% events_before, .{}, writer);
    try writer.writeAll(",\"hostCounter\":");
    try std.json.Stringify.value(counter.storage, .{}, writer);
    try writer.writeByte('}');
}
