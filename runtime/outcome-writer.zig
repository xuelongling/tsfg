// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("runtime-state.zig");
const request = @import("request-values.zig");
const bytecode = @import("bytecode.zig");
const contract = @import("contract.zig");
const string_output = @import("string-output.zig");

pub const ModuleFields = struct {
    moduleStatus: []const u8,
    hostEvents: u64,
    requestHostEvents: u64,
    hostCounter: u32,
};

fn writeFields(json: *std.json.Stringify, fields: anytype) !void {
    inline for (std.meta.fields(@TypeOf(fields))) |field| {
        try json.objectField(field.name);
        try json.write(@field(fields, field.name));
    }
}

pub fn writeOutcome(writer: *std.Io.Writer, outcome: *const request.RequestOutcome, host: *const runtime.Runtime, mode: string_output.Mode) !void {
    try write(writer, outcome, host, mode, null);
}

pub fn write(writer: *std.Io.Writer, outcome: *const request.RequestOutcome, host: *const runtime.Runtime, mode: string_output.Mode, module: ?ModuleFields) !void {
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
    var failure: ?request.RequestFailure = if (outcome.* == .failed) outcome.failed else null;
    var lease: string_output.Lease = .{};
    const token: ?string_output.Token = if (outcome.* == .returned and outcome.returned.result == .string)
        lease.begin(host.allocator, outcome.returned.result.string, mode, contract.max_bytes) catch |err| failed: {
            const invalid_utf8 = err == error.InvalidUtf8;
            failure = .{
                .code = if (invalid_utf8) "r05-string-invalid-utf8" else "r05-execution-abort",
                .category = if (invalid_utf8) "string-output" else "execution-abort",
                .rule_ids = if (invalid_utf8) &.{"r01-string"} else &.{},
                .function_id = function_id,
                .source = source,
            };
            break :failed null;
        }
    else null;
    defer if (token != null) lease.end() catch unreachable;

    var json: std.json.Stringify = .{ .writer = writer };
    try json.beginObject();
    if (failure) |failed| {
        try writeFields(&json, .{ .status = if (failed.exception_kind != null) "exception" else "failed", .code = failed.code, .category = failed.category });
        if (failed.exception_kind) |kind| try writeFields(&json, .{ .exceptionKind = kind });
        try writeFields(&json, .{ .ruleIds = failed.rule_ids, .functionId = @as([]const u8, &function_hex), .source = source_view });
    } else {
        try writeFields(&json, .{ .status = "returned" });
        const result = outcome.returned.result;
        switch (result) {
            .string => {
                const borrowed = token.?;
                const length = try lease.byteLength(borrowed);
                try json.objectField("result");
                try json.beginObject();
                try writeFields(&json, .{ .type = "string" });
                try json.objectField("value");
                try json.beginWriteRaw();
                try lease.writeJson(borrowed, writer);
                json.endWriteRaw();
                try writeFields(&json, .{ .byteLength = length, .encoding = @tagName(mode) });
                try json.endObject();
            },
            .boolean => |value| try writeFields(&json, .{ .result = .{ .type = "bool", .value = value } }),
            else => {
                const code = result.typeCode();
                const bits = result.bits();
                const text = switch (code) {
                    12 => try std.fmt.bufPrint(&buffers[3], "{x:0>8}", .{bits}),
                    13 => try std.fmt.bufPrint(&buffers[3], "{x:0>16}", .{bits}),
                    else => if (contract.signedType(code)) try std.fmt.bufPrint(&buffers[3], "{d}", .{contract.signedValue(bits, code)}) else try std.fmt.bufPrint(&buffers[3], "{d}", .{bits}),
                };
                try writeFields(&json, .{ .result = .{ .type = contract.typeName(code), .value = text } });
            },
        }
        try writeFields(&json, .{ .source = source_view, .functionId = @as([]const u8, &function_hex) });
    }
    try writeFields(&json, .{ .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed });
    if (module) |fields| try writeFields(&json, fields);
    try json.endObject();
}
