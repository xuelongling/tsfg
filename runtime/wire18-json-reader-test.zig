// SPDX-License-Identifier: MIT
// Syntax/ownership tests only: no bytecode envelope, Program, graph or VM.
const std = @import("std");
const json = @import("wire18-json-reader.zig");
const types = @import("wire-program-types.zig");
const tables = @import("wire-program-tables.zig");

test "canonical JSON preserves primitive values and owned UTF8 text" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    var source = [_]u8{ '"', 'o', 'k', '"' };
    const text = try decoder.parse(&source);
    source[1] = 'x';
    try std.testing.expectEqualStrings("ok", text.string);
    const node = try decoder.parse("{\"a\":[null,true,false,9007199254740991],\"b\":\"é\"}");
    const rows = try decoder.object(node);
    const items = (try decoder.get(rows, "a")).array;
    try std.testing.expect(items[0] == .null);
    try std.testing.expect(items[1].boolean);
    try std.testing.expect(!items[2].boolean);
    try std.testing.expectEqual(@as(u64, 9007199254740991), items[3].integer);
    try std.testing.expectEqualStrings("é", (try decoder.get(rows, "b")).string);
}

test "JSON rejects noncanonical numeric spelling and trailing syntax" {
    const invalid = [_][]const u8{ " null", "null ", "truefalse", "[1,]", "01", "-1", "1.0", "1e0", "9007199254740992", "{\"a\":}" };
    for (invalid) |source| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        var meter = json.Meter{};
        var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
        try std.testing.expectError(error.InvalidJson, decoder.parse(source));
    }
}

test "JSON requires unique sorted ASCII keys and canonical escapes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    try std.testing.expectError(error.InvalidOrder, decoder.parse("{\"a\":0,\"a\":1}"));
    try std.testing.expectError(error.InvalidOrder, decoder.parse("{\"b\":0,\"a\":1}"));
    try std.testing.expectError(error.InvalidJson, decoder.parse("{\"é\":0}"));
    try std.testing.expectError(error.InvalidJson, decoder.parse("\"\\u0061\""));
    try std.testing.expectError(error.InvalidJson, decoder.parse("\"\\u000a\""));
    try std.testing.expectError(error.InvalidJson, decoder.parse(&.{ '"', 0xff, '"' }));
    try std.testing.expectEqualStrings("\x01\n\"\\", (try decoder.parse("\"\\u0001\\n\\\"\\\\\"")).string);
}

test "JSON depth32 succeeds and depth33 rejects" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    var allowed: [68]u8 = undefined;
    @memset(allowed[0..32], '[');
    @memcpy(allowed[32..36], "null");
    @memset(allowed[36..], ']');
    _ = try decoder.parse(&allowed);
    var too_deep: [70]u8 = undefined;
    @memset(too_deep[0..33], '[');
    @memcpy(too_deep[33..37], "null");
    @memset(too_deep[37..], ']');
    try std.testing.expectError(error.DepthLimit, decoder.parse(&too_deep));
}

test "JSON work balance is shared and exhausted failures cannot refill it" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{ .remaining = 30 };
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    _ = try decoder.parse("null");
    const after_first = meter.remaining;
    _ = try decoder.parse("null");
    try std.testing.expect(meter.remaining < after_first);
    meter.remaining = 1;
    try std.testing.expectError(error.WorkLimit, decoder.parse("null"));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
    try std.testing.expectError(error.WorkLimit, decoder.parse("null"));
}

fn parseWithFailingAllocator(allocator: std.mem.Allocator) !void {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    const node = try decoder.parse("{\"a\":[0,1,2,3,4,5,6,7,8,9],\"b\":{\"c\":\"owned string\"}}");
    try std.testing.expectEqual(@as(usize, 2), node.object.len);
}

test "JSON arena releases every allocation failure path" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, parseWithFailingAllocator, .{});
}

test "JSON carrier tags preserve widths and reject extra payload" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    const domain = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":0,\"ref\":4294967295}"));
    try std.testing.expectEqual(@as(u32, 4294967295), @intFromEnum(domain.domain));
    const environment = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":1,\"ref\":65535}"));
    try std.testing.expectEqual(@as(u16, 65535), @intFromEnum(environment.environment));
    const native_type = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":2,\"ref\":65535}"));
    try std.testing.expectEqual(@as(u16, 65535), @intFromEnum(native_type.@"type"));
    const cell = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":3,\"ref\":4294967295}"));
    try std.testing.expectEqual(@as(u32, 4294967295), @intFromEnum(cell.cell));
    try std.testing.expect((try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":4,\"ref\":0}"))) == .payload);
    const receiver = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":5,\"ref\":65536}"));
    try std.testing.expectEqual(@as(u32, 65536), @intFromEnum(receiver.receiver));
    const initialization = try decoder.convert(types.Carrier, try decoder.parse("{\"kind\":6,\"ref\":4294967295}"));
    try std.testing.expectEqual(@as(u32, 4294967295), @intFromEnum(initialization.initialization));
    for ([_][]const u8{ "{\"kind\":7,\"ref\":0}", "{\"kind\":4,\"ref\":1}", "{\"kind\":2,\"ref\":65536}", "{\"kind\":0,\"ref\":4294967296}", "{\"extra\":0,\"kind\":0,\"ref\":0}", "{\"kind\":0}" }) |source| {
        try std.testing.expectError(error.InvalidShape, decoder.convert(types.Carrier, try decoder.parse(source)));
    }
}

test "JSON source rows preserve hash and reject invalid numeric or record shape" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    const hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const row = try decoder.convert(tables.Source, try decoder.parse("{\"hash\":\"" ++ hash ++ "\",\"length\":3,\"path\":\"a.ts\"}"));
    try std.testing.expectEqual([_]u8{0} ** 32, row.hash);
    try std.testing.expectEqual(@as(u32, 3), row.length);
    try std.testing.expectEqualStrings("a.ts", row.path);
    try std.testing.expectError(error.InvalidShape, decoder.convert(tables.Source, try decoder.parse("{\"hash\":\"" ++ hash ++ "\",\"length\":4294967296,\"path\":\"a.ts\"}")));
    try std.testing.expectError(error.InvalidShape, decoder.convert(tables.Source, try decoder.parse("{\"hash\":\"" ++ hash ++ "\",\"path\":\"a.ts\"}")));
    try std.testing.expectError(error.InvalidShape, decoder.convert(types.Hash, try decoder.parse("\"sha256:000000000000000000000000000000000000000000000000000000000000000A\"")));
}

test "JSON flattened field layout keeps all offsets and rejects narrowing" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    const layout = try decoder.convert(types.FieldLayout, try decoder.parse("{\"alignment\":4,\"byteSize\":8,\"fieldOffsets\":[0,4],\"referenceCount\":0}"));
    try std.testing.expectEqual(@as(u32, 8), layout.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 4), layout.layout.alignment);
    try std.testing.expectEqualSlices(u32, &.{ 0, 4 }, layout.field_offsets);
    try std.testing.expectError(error.InvalidShape, decoder.convert(types.FieldLayout, try decoder.parse("{\"alignment\":65536,\"byteSize\":8,\"fieldOffsets\":[0,4],\"referenceCount\":0}")));
    try std.testing.expectError(error.InvalidShape, decoder.convert(types.FieldLayout, try decoder.parse("{\"alignment\":4,\"byteSize\":8,\"fieldOffsets\":[4294967296],\"referenceCount\":0}")));
}
