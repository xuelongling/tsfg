// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("root.zig");
const fixture = @import("fixture.zig");

test "loader preserves an official absolute logical source path" {
    const old_path = "fixture.ts";
    const prefix = "/src/";
    const path_offset = std.mem.indexOf(u8, &fixture.bytes, old_path).?;
    var bytes: [fixture.bytes.len + prefix.len]u8 = undefined;
    @memcpy(bytes[0..path_offset], fixture.bytes[0..path_offset]);
    @memcpy(bytes[path_offset..][0..prefix.len], prefix);
    @memcpy(bytes[path_offset + prefix.len ..], fixture.bytes[path_offset..]);
    std.mem.writeInt(u32, bytes[44..48], bytes.len, .little);
    std.mem.writeInt(u32, bytes[path_offset - 4 ..][0..4], old_path.len + prefix.len, .little);
    var digest = std.crypto.hash.sha2.Sha256.init(.{});
    digest.update("tsfg.function\x00/src/fixture.ts\x00constant\x00ac9438b17e41c86e042aaa640f76bd95693245676c19c4cbfd89cf43315df6f9");
    const function_offset = path_offset - 4 - 96;
    digest.final(bytes[function_offset..][0..32]);
    std.crypto.hash.sha2.Sha256.hash(bytes[80..], bytes[48..80], .{});
    const module = switch (runtime.load(std.testing.allocator, &bytes)) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedLogicalPathRejection,
    };
    defer runtime.unload(module);
    try std.testing.expectEqualStrings("/src/fixture.ts", runtime.moduleInfo(module).source.path);
}

test "verified bytecode returns a typed i32 through a Runtime request" {
    const loaded = runtime.load(std.testing.allocator, &fixture.bytes);
    const module = switch (loaded) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedRejection,
    };
    defer runtime.unload(module);
    var host = runtime.Runtime.init(std.testing.allocator);
    const result = runtime.eval_bytecode(&host, module, runtime.moduleInfo(module).function_id, &.{}, &.{}, .{});
    switch (result) {
        .returned => |value| try std.testing.expectEqual(@as(i32, 42), value.result.i32),
        .failed => return error.UnexpectedRequestFailure,
    }
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
}

test "verified module owns canonical bytes and exposes the original source" {
    var bytes = fixture.bytes;
    const module = switch (runtime.load(std.testing.allocator, &bytes)) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedRejection,
    };
    defer runtime.unload(module);
    @memset(&bytes, 0);
    const roundtrip = try runtime.serialize(module, std.testing.allocator);
    defer std.testing.allocator.free(roundtrip);
    try std.testing.expectEqualSlices(u8, &fixture.bytes, roundtrip);
    const view = try runtime.inspect(module, std.testing.allocator);
    defer std.testing.allocator.free(view);
    const json = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, view, .{});
    defer json.deinit();
    try std.testing.expectEqualStrings("fixture.ts", json.value.object.get("source").?.object.get("path").?.string);
}

test "Runtime cleans failed requests and accepts another request on the same host" {
    const module = switch (runtime.load(std.testing.allocator, &fixture.bytes)) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedRejection,
    };
    defer runtime.unload(module);
    var host = runtime.Runtime.init(std.testing.allocator);
    const id = runtime.moduleInfo(module).function_id;
    const limits = [_]runtime.RequestLimits{ .{ .memory_bytes = 3 }, .{ .instruction_budget = 0 }, .{ .instruction_budget = 1 }, .{ .depth = 0 } };
    const codes = [_][]const u8{ "r05-request-memory", "r05-execution-abort", "r05-execution-abort", "r05-request-depth" };
    for (limits, codes) |limit, code| {
        switch (runtime.eval_bytecode(&host, module, id, &.{}, &.{}, limit)) {
            .failed => |failure| try std.testing.expectEqualStrings(code, failure.code),
            .returned => return error.ExpectedRequestFailure,
        }
        try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
        switch (runtime.eval_bytecode(&host, module, id, &.{}, &.{}, .{})) {
            .returned => |value| try std.testing.expectEqual(@as(i32, 42), value.result.i32),
            .failed => return error.UnexpectedRequestFailure,
        }
    }
}

test "Runtime recovers from allocator failure without retaining a request" {
    const module = switch (runtime.load(std.testing.allocator, &fixture.bytes)) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedRejection,
    };
    defer runtime.unload(module);
    var allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    var host = runtime.Runtime.init(allocator.allocator());
    const id = runtime.moduleInfo(module).function_id;
    switch (runtime.eval_bytecode(&host, module, id, &.{}, &.{}, .{})) {
        .failed => |failure| try std.testing.expectEqualStrings("r05-request-allocation", failure.code),
        .returned => return error.ExpectedRequestFailure,
    }
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
    allocator.fail_index = std.math.maxInt(usize);
    switch (runtime.eval_bytecode(&host, module, id, &.{}, &.{}, .{})) {
        .returned => |value| try std.testing.expectEqual(@as(i32, 42), value.result.i32),
        .failed => return error.UnexpectedRequestFailure,
    }
}

test "Runtime rejects unknown functions and unsupported argument and capability tables" {
    const module = switch (runtime.load(std.testing.allocator, &fixture.bytes)) {
        .loaded => |module| module,
        .rejected => return error.UnexpectedRejection,
    };
    defer runtime.unload(module);
    var host = runtime.Runtime.init(std.testing.allocator);
    const id = runtime.moduleInfo(module).function_id;
    const outcomes = [_]runtime.RequestOutcome{
        runtime.eval_bytecode(&host, module, [_]u8{0} ** 32, &.{}, &.{}, .{}),
        runtime.eval_bytecode(&host, module, id, &.{.{ .i32 = 42 }}, &.{}, .{}),
        runtime.eval_bytecode(&host, module, id, &.{}, &.{.{ .id = 1 }}, .{}),
    };
    const codes = [_][]const u8{ "r05-request-function", "r05-request-arguments", "r05-request-capability" };
    for (outcomes, codes) |outcome, code| switch (outcome) {
        .failed => |failure| try std.testing.expectEqualStrings(code, failure.code),
        .returned => return error.ExpectedRequestFailure,
    };
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
}

fn reject(bytes: []const u8, expected: ?[]const u8) !void {
    switch (runtime.load(std.testing.allocator, bytes)) {
        .loaded => |module| {
            runtime.unload(module);
            return error.ExpectedLoadFailure;
        },
        .rejected => |failure| if (expected) |code| try std.testing.expectEqualStrings(code, failure.code),
    }
}

test "loader rejects every truncated prefix before execution" {
    for (0..fixture.bytes.len) |length| try reject(fixture.bytes[0..length], null);
}

test "loader rejects wrong identities and malformed typed instructions" {
    var bytes = fixture.bytes;
    bytes[8] = 1;
    try reject(&bytes, "r04-version");
    bytes = fixture.bytes;
    bytes[12] ^= 1;
    try reject(&bytes, "r04-schema");
    bytes = fixture.bytes;
    bytes[bytes.len - 24] ^= 1;
    try reject(&bytes, "r04-integrity");
    const mutations = [_]struct { offset: usize, value: u8, code: []const u8 }{
        .{ .offset = 84, .value = 'x', .code = "r04-target" },
        .{ .offset = bytes.len - 32, .value = 255, .code = "r04-instruction" },
        .{ .offset = bytes.len - 31, .value = 2, .code = "r04-type" },
        .{ .offset = bytes.len - 30, .value = 1, .code = "r04-register" },
        .{ .offset = bytes.len - 12, .value = 1, .code = "r04-reserved" },
        .{ .offset = bytes.len - 4, .value = 255, .code = "r04-source-range" },
    };
    for (mutations) |mutation| {
        bytes = fixture.bytes;
        bytes[mutation.offset] = mutation.value;
        std.crypto.hash.sha2.Sha256.hash(bytes[80..], bytes[48..80], .{});
        try reject(&bytes, mutation.code);
    }
}

test "loader recomputes entity identities and checks the target layout" {
    var bytes = fixture.bytes;
    var signature: [32]u8 = undefined;
    _ = try std.fmt.hexToBytes(&signature, "ac9438b17e41c86e042aaa640f76bd95693245676c19c4cbfd89cf43315df6f9");
    const signature_offset = std.mem.indexOf(u8, &fixture.bytes, &signature).?;
    const mutations = [_]struct { offset: usize, code: []const u8 }{
        .{ .offset = signature_offset, .code = "r04-signature" },
        .{ .offset = signature_offset + 32, .code = "r04-type" },
        .{ .offset = signature_offset - 32, .code = "r04-function" },
        .{ .offset = std.mem.indexOf(u8, &fixture.bytes, "e-m:w-").?, .code = "r04-layout" },
    };
    for (mutations) |mutation| {
        bytes = fixture.bytes;
        bytes[mutation.offset] ^= 1;
        std.crypto.hash.sha2.Sha256.hash(bytes[80..], bytes[48..80], .{});
        try reject(&bytes, mutation.code);
    }
}

fn loadWithAllocationFailure(allocator: std.mem.Allocator) !void {
    switch (runtime.load(allocator, &fixture.bytes)) {
        .loaded => |module| runtime.unload(module),
        .rejected => |failure| {
            if (std.mem.eql(u8, failure.code, "r04-allocation")) return error.OutOfMemory;
            return error.UnexpectedRejection;
        },
    }
}

test "loader cleans partial owned state on every allocation failure" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, loadWithAllocationFailure, .{});
}
