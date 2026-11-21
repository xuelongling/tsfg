// SPDX-License-Identifier: MIT
const std = @import("std");
const Runtime = @import("runtime-state.zig").Runtime;
const request = @import("request-values.zig");

pub fn write(writer: *std.Io.Writer, outcome: *const request.RequestOutcome, host: *const Runtime,
    status: []const u8, host_events: u64, events_before: u64, host_counter: u32, mode: @import("string-output.zig").Mode) !void
{
    try @import("outcome-writer.zig").write(writer, outcome, host, mode, .{
        .moduleStatus = status,
        .hostEvents = host_events,
        .requestHostEvents = host_events -% events_before,
        .hostCounter = host_counter,
    });
}
