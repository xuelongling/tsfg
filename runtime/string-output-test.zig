// SPDX-License-Identifier: MIT
// Component seam only: no guest evaluator, host probe, or native inspector.
const std = @import("std");
const values = @import("string-value.zig");
const output = @import("string-output.zig");
const a = std.testing.allocator;

fn owned(allocator: std.mem.Allocator, units: []const u16) !values.String {
    const owner = try values.Owner.create(allocator);
    defer owner.release();
    const handle = try owner.heap.createString(units, .persistent);
    defer owner.heap.release(handle) catch unreachable;
    return values.String.retain(owner, handle);
}

test "strict writer keeps exact UTF8 bytes stable across source GC and result release" {
    var source = try owned(a, &.{ 0, 0x65, 0x301, 0xd83d, 0xde00 });
    var lease: output.Lease = .{};
    _ = try lease.begin(a, source, .strict, 8);
    defer lease.end() catch unreachable;
    try source.owner.heap.collect();
    source.deinit();
    try std.testing.expectEqual(@as(usize, 8), try lease.byteLength(lease.token));
    const oracle = [_]u8{ 0, 0x65, 0xcc, 0x81, 0xf0, 0x9f, 0x98, 0x80 };
    for (oracle, 0..) |byte, index| try std.testing.expectEqual(byte, try lease.readByte(lease.token, index));
    var writer: std.Io.Writer.Allocating = .init(a);
    defer writer.deinit();
    try lease.writeJson(lease.token, &writer.writer);
    const json = try std.json.parseFromSlice([]const u8, a, writer.written(), .{});
    defer json.deinit();
    try std.testing.expectEqualSlices(u8, &oracle, json.value);
}

test "isolated surrogates fail strict and require explicit lossy mode" {
    var source = try owned(a, &.{ 0xd800, 0x41, 0xdc00 });
    defer source.deinit();
    var strict: output.Lease = .{};
    try std.testing.expectError(error.InvalidUtf8, strict.begin(a, source, .strict, 7));
    var lease: output.Lease = .{};
    _ = try lease.begin(a, source, .lossy, 7);
    defer lease.end() catch unreachable;
    const oracle = [_]u8{ 0xef, 0xbf, 0xbd, 0x41, 0xef, 0xbf, 0xbd };
    try std.testing.expectEqual(@as(usize, 7), try lease.byteLength(lease.token));
    for (oracle, 0..) |byte, index| try std.testing.expectEqual(byte, try lease.readByte(lease.token, index));
}

test "empty output, byte bounds, cross-lease token and expired token rejection" {
    var source = try owned(a, &.{});
    defer source.deinit();
    var first: output.Lease = .{};
    _ = try first.begin(a, source, .strict, 0);
    var second: output.Lease = .{};
    _ = try second.begin(a, source, .strict, 0);
    defer second.end() catch unreachable;
    const expired = first.token;
    try std.testing.expectEqual(@as(usize, 0), try first.byteLength(expired));
    try std.testing.expectError(error.IndexOutOfBounds, first.readByte(expired, 0));
    try std.testing.expectError(error.ExpiredStringView, second.byteLength(expired));
    var saved_lease = first;
    try first.end();
    try std.testing.expectError(error.InvalidStringLease, saved_lease.readByte(expired, 0));
    try std.testing.expectError(error.ExpiredStringView, first.readByte(expired, 0));
    try std.testing.expectError(error.ExpiredStringView, first.byteLength(expired));
}

fn allocationScenario(allocator: std.mem.Allocator) !void {
    var source = try owned(allocator, &.{ 0xd83d, 0xde00, 0xd800 });
    defer source.deinit();
    var lease: output.Lease = .{};
    _ = try lease.begin(allocator, source, .lossy, 7);
    defer lease.end() catch unreachable;
    try source.owner.heap.collect();
    try std.testing.expectEqual(@as(u8, 0xf0), try lease.readByte(lease.token, 0));
}
test "lease and owned root publication are transactional at every allocation failure" {
    try std.testing.checkAllAllocationFailures(a, allocationScenario, .{});
}

test "output budget rejects before materializing bytes and leaves source valid" {
    var source = try owned(a, &.{ 0xd83d, 0xde00 });
    defer source.deinit();
    var lease: output.Lease = .{};
    try std.testing.expectError(error.OutputLimit, lease.begin(a, source, .strict, 3));
    try std.testing.expectEqual(@as(usize, 2), try source.owner.heap.stringLength(source.handle));
}

test "in-place lease publication rejects copies before the first byte read" {
    var source = try owned(a, &.{0x41});
    var original: output.Lease = .{};
    // Copying an empty wrapper copies no ownership and produces no live token.
    var empty_copy = original;
    try std.testing.expectError(error.ExpiredStringView, empty_copy.byteLength(empty_copy.token));
    const token = try original.begin(a, source, .strict, 1);
    var saved_before_read = original;
    source.deinit();
    try original.end();
    try std.testing.expectError(error.InvalidStringLease, saved_before_read.readByte(token, 0));
    try std.testing.expectError(error.InvalidStringLease, saved_before_read.end());
    try std.testing.expectError(error.ExpiredStringView, original.readByte(token, 0));
}

test "actual CLI result writer emits byte length and reports strict failure" {
    const request = @import("request-values.zig");
    var host = @import("runtime-state.zig").Runtime.init(a);
    defer host.deinit() catch unreachable;
    var result: request.RequestOutcome = .{ .returned = .{ .result = .{ .string = try owned(a, &.{ 0, 0xd83d, 0xde00 }) },
        .function_id = [_]u8{1} ** 32, .source = .{ .path = "/string.ts", .hash = [_]u8{2} ** 32, .start = 4, .end = 8 } } };
    defer request.deinitOutcome(&result);
    var writer: std.Io.Writer.Allocating = .init(a);
    defer writer.deinit();
    try @import("outcome-writer.zig").writeOutcome(&writer.writer, &result, &host, .strict);
    var json = try std.json.parseFromSlice(std.json.Value, a, writer.written(), .{});
    defer json.deinit();
    const actual = json.value.object.get("result").?.object;
    try std.testing.expectEqual(@as(i64, 5), actual.get("byteLength").?.integer);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0xf0, 0x9f, 0x98, 0x80 }, actual.get("value").?.string);
    result.returned.result.string.deinit();
    result.returned.result = .{ .string = try owned(a, &.{0xdc00}) };
    writer.clearRetainingCapacity();
    try @import("outcome-writer.zig").writeOutcome(&writer.writer, &result, &host, .strict);
    var failure = try std.json.parseFromSlice(std.json.Value, a, writer.written(), .{});
    defer failure.deinit();
    try std.testing.expectEqualStrings("r05-string-invalid-utf8", failure.value.object.get("code").?.string);
    writer.clearRetainingCapacity();
    try @import("outcome-writer.zig").writeOutcome(&writer.writer, &result, &host, .lossy);
    const lossy = try std.json.parseFromSlice(std.json.Value, a, writer.written(), .{});
    defer lossy.deinit();
    try std.testing.expectEqualSlices(u8, &.{ 0xef, 0xbf, 0xbd }, lossy.value.object.get("result").?.object.get("value").?.string);
}

test "active begin cannot overwrite ownership and restarting invalidates the old token" {
    var source = try owned(a, &.{0x41});
    defer source.deinit();
    var lease: output.Lease = .{};
    const previous = try lease.begin(a, source, .strict, 1);
    try std.testing.expectError(error.ActiveStringLease, lease.begin(a, source, .lossy, 1));
    try std.testing.expectEqual(@as(u8, 0x41), try lease.readByte(previous, 0));
    try lease.end();
    const current = try lease.begin(a, source, .strict, 1);
    defer lease.end() catch unreachable;
    try std.testing.expectError(error.ExpiredStringView, lease.byteLength(previous));
    try std.testing.expectEqual(@as(u8, 0x41), try lease.readByte(current, 0));
    var wrong = current; wrong.owner +%= 1;
    try std.testing.expectError(error.ExpiredStringView, lease.readByte(wrong, 0));
    wrong = current; wrong.slot +%= 1;
    try std.testing.expectError(error.ExpiredStringView, lease.readByte(wrong, 0));
    wrong = current; wrong.generation +%= 1;
    try std.testing.expectError(error.ExpiredStringView, lease.readByte(wrong, 0));
}

test "independent Q10 oracle fixes exact bytes for fourteen strict and lossy writer cases" {
    const Case = struct { name: []const u8, units: []const u16, strictHex: ?[]const u8 = null,
        strictError: ?[]const u8 = null, lossyHex: []const u8, byteLength: usize };
    const oracle = try std.json.parseFromSlice(struct { cases: []const Case }, a,
        @embedFile("testdata/formal-string-output-oracle.json"), .{ .ignore_unknown_fields = true });
    defer oracle.deinit();
    var host = @import("runtime-state.zig").Runtime.init(a);
    defer host.deinit() catch unreachable;
    for (oracle.value.cases) |case| {
        var result: @import("request-values.zig").RequestOutcome = .{ .returned = .{ .result = .{ .string = try owned(a, case.units) },
            .function_id = [_]u8{1} ** 32, .source = .{ .path = "/oracle.ts", .hash = [_]u8{2} ** 32, .start = 1, .end = 2 } } };
        defer @import("request-values.zig").deinitOutcome(&result);
        for ([_]output.Mode{ .strict, .lossy }) |mode| {
            var writer: std.Io.Writer.Allocating = .init(a);
            defer writer.deinit();
            try @import("outcome-writer.zig").writeOutcome(&writer.writer, &result, &host, mode);
            const parsed = try std.json.parseFromSlice(std.json.Value, a, writer.written(), .{});
            defer parsed.deinit();
            if (mode == .strict and case.strictError != null) {
                try std.testing.expectEqualStrings("r05-string-invalid-utf8", parsed.value.object.get("code").?.string);
            } else {
                const hex = if (mode == .strict) case.strictHex.? else case.lossyHex;
                const expected = try a.alloc(u8, hex.len / 2);
                defer a.free(expected);
                _ = try std.fmt.hexToBytes(expected, hex);
                const actual = parsed.value.object.get("result").?.object;
                try std.testing.expectEqualSlices(u8, expected, actual.get("value").?.string);
                try std.testing.expectEqual(case.byteLength, @as(usize, @intCast(actual.get("byteLength").?.integer)));
            }
        }
    }
}

test "actual writer allocation failure does not consume its returned root" {
    const request = @import("request-values.zig");
    var host = @import("runtime-state.zig").Runtime.init(a);
    defer host.deinit() catch unreachable;
    var result: request.RequestOutcome = .{ .returned = .{ .result = .{ .string = try owned(a, &.{ 0x41, 0x42 }) },
        .function_id = [_]u8{1} ** 32, .source = .{ .path = "/string.ts", .hash = [_]u8{2} ** 32, .start = 4, .end = 8 } } };
    defer request.deinitOutcome(&result);
    var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = 0 });
    var writer: std.Io.Writer.Allocating = .init(failing.allocator());
    defer writer.deinit();
    try std.testing.expectError(error.WriteFailed, @import("outcome-writer.zig").writeOutcome(&writer.writer, &result, &host, .strict));
    try result.returned.result.string.owner.heap.collect();
    try std.testing.expectEqual(@as(usize, 2), try result.returned.result.string.owner.heap.stringLength(result.returned.result.string.handle));
}
