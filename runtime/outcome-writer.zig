// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("runtime-state.zig");
const request = @import("request-values.zig");
const bytecode = @import("bytecode.zig");
const contract = @import("contract.zig");
pub fn writeOutcome(writer: *std.Io.Writer, outcome: *const request.RequestOutcome, host: *const runtime.Runtime, mode: @import("string-output.zig").Mode) !void {
    const function_id = switch (outcome.*) {
        .returned => |r| r.function_id,
        .failed => |r| r.function_id,
    };
    const source = switch (outcome.*) {
        .returned => |r| r.source,
        .failed => |r| r.source,
    };
    const function_hex = bytecode.digestText(function_id);
    const source_hex = bytecode.digestText(source.hash);
    var buffers: [6][32]u8 = undefined;
    const start = try std.fmt.bufPrint(&buffers[0], "{d}", .{source.start});
    const end = try std.fmt.bufPrint(&buffers[1], "{d}", .{source.end});
    const active = try std.fmt.bufPrint(&buffers[2], "{d}", .{host.activeRequests()});
    const fuel_remaining = try std.fmt.bufPrint(&buffers[4], "{d}", .{switch (outcome.*) {
        .returned => |r| r.fuel_remaining,
        .failed => |r| r.fuel_remaining,
    }});
    const fuel_consumed = try std.fmt.bufPrint(&buffers[5], "{d}", .{switch (outcome.*) {
        .returned => |r| r.fuel_consumed,
        .failed => |r| r.fuel_consumed,
    }});
    const source_view = .{ .path = source.path, .hash = @as([]const u8, &source_hex), .start = start, .end = end };
    switch (outcome.*) {
        .returned => |returned| {
            switch (returned.result) {
                .string => |value| {
                    var lease: @import("string-output.zig").Lease = .{};
                    const token = lease.begin(host.allocator, value, mode, contract.max_bytes) catch |err| {
                        const code = if (err == error.InvalidUtf8) "r05-string-invalid-utf8" else "r05-execution-abort";
                        try std.json.Stringify.value(.{ .status = "failed", .code = code, .category = if (err == error.InvalidUtf8) "string-output" else "execution-abort", .ruleIds = [_][]const u8{"r01-strings"}, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer);
                        return;
                    };
                    defer lease.end() catch unreachable;
                    const length = try lease.byteLength(token);
                    try writer.writeAll("{\"status\":\"returned\",\"result\":{\"type\":\"string\",\"value\":");
                    try lease.writeJson(token, writer);
                    try writer.writeAll(",\"byteLength\":");
                    try std.json.Stringify.value(length, .{}, writer);
                    try writer.writeAll(",\"encoding\":");
                    try std.json.Stringify.value(@tagName(mode), .{}, writer);
                    try writer.writeAll("},\"source\":");
                    try std.json.Stringify.value(source_view, .{}, writer);
                    try writer.writeAll(",\"functionId\":");
                    try std.json.Stringify.value(@as([]const u8, &function_hex), .{}, writer);
                    try writer.writeAll(",\"activeRequests\":");
                    try std.json.Stringify.value(active, .{}, writer);
                    try writer.writeAll(",\"fuelRemaining\":");
                    try std.json.Stringify.value(fuel_remaining, .{}, writer);
                    try writer.writeAll(",\"fuelConsumed\":");
                    try std.json.Stringify.value(fuel_consumed, .{}, writer);
                    try writer.writeByte('}');
                },
                .boolean => |value| try std.json.Stringify.value(.{ .status = "returned", .result = .{ .type = "bool", .value = value }, .source = source_view, .functionId = @as([]const u8, &function_hex), .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer),
                else => {
                    const code = returned.result.typeCode();
                    const text = if (code == 12) try std.fmt.bufPrint(&buffers[3], "{x:0>8}", .{returned.result.bits()}) else if (code == 13) try std.fmt.bufPrint(&buffers[3], "{x:0>16}", .{returned.result.bits()}) else if (contract.signedType(code)) try std.fmt.bufPrint(&buffers[3], "{d}", .{contract.signedValue(returned.result.bits(), code)}) else try std.fmt.bufPrint(&buffers[3], "{d}", .{returned.result.bits()});
                    try std.json.Stringify.value(.{ .status = "returned", .result = .{ .type = contract.typeName(code), .value = text }, .source = source_view, .functionId = @as([]const u8, &function_hex), .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer);
                },
            }
        },
        .failed => |failed| if (failed.exception_kind) |exception_kind| try std.json.Stringify.value(.{ .status = "exception", .code = failed.code, .category = failed.category, .exceptionKind = exception_kind, .ruleIds = failed.rule_ids, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer) else try std.json.Stringify.value(.{ .status = "failed", .code = failed.code, .category = failed.category, .ruleIds = failed.rule_ids, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer),
    }
}
