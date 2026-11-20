// SPDX-License-Identifier: MIT
const std = @import("std");
const Runtime = @import("runtime-state.zig").Runtime;
const request = @import("request-values.zig");

pub fn write(writer: *std.Io.Writer, output_allocator: std.mem.Allocator, outcome: *const request.RequestOutcome, host: *const Runtime,
    status: []const u8, host_events: u64, events_before: u64, host_counter: u32, mode: @import("string-output.zig").Mode) !void
{
    var base: std.Io.Writer.Allocating = .init(output_allocator);
    defer base.deinit();
    try @import("outcome-writer.zig").writeOutcome(&base.writer, outcome, host, mode);
    const bytes = base.written();
    try writer.writeAll(bytes[0..bytes.len - 1]);
    try writer.writeAll(",\"moduleStatus\":");
    try std.json.Stringify.value(status, .{}, writer);
    try writer.writeAll(",\"hostEvents\":");
    try std.json.Stringify.value(host_events, .{}, writer);
    try writer.writeAll(",\"requestHostEvents\":");
    try std.json.Stringify.value(host_events -% events_before, .{}, writer);
    try writer.writeAll(",\"hostCounter\":");
    try std.json.Stringify.value(host_counter, .{}, writer);
    try writer.writeByte('}');
}
