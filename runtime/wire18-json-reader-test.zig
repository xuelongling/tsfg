// SPDX-License-Identifier: MIT
// Syntax/ownership tests only: no bytecode envelope, Program, graph or VM.
const std = @import("std");
const json = @import("wire18-json-reader.zig");
const types = @import("wire-program-types.zig");
const tables = @import("wire-program-tables.zig");
const control = @import("wire-program-control.zig");

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
    const invalid = [_][]const u8{ " null", "null ", "truefalse", "[1,]", "01", "1.0", "1e0", "{\"a\":}" };
    for (invalid) |source| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        var meter = json.Meter{};
        var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
        try std.testing.expectError(error.InvalidJson, decoder.parse(source));
    }
}

test "JSON requires unique sorted keys and canonical escapes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    try std.testing.expectError(error.InvalidOrder, decoder.parse("{\"a\":0,\"a\":1}"));
    try std.testing.expectError(error.InvalidOrder, decoder.parse("{\"b\":0,\"a\":1}"));
    try std.testing.expectEqualStrings("é", (try decoder.parse("{\"é\":0}")).object[0].key);
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

const plan_sources = [_]tables.Source{.{ .hash = [_]u8{0} ** 32, .path = "/a.ts", .length = 3 }};
const plan_source = "\"source\":{\"end\":3,\"path\":\"/a.ts\",\"start\":0}";
const plan_return = "{\"name\":\"func.return\",\"operands\":[0],\"properties\":{},\"result\":null," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}";
const plan_valid = "{\"blocks\":[{\"operations\":[" ++ plan_return ++ "],\"parameters\":[0]}],\"carriers\":[\"i32\"]}";

fn sourcePlanFixture(allocator: std.mem.Allocator, carriers: []const u8, parameters: []const u8, operations: []const u8) ![]const u8 {
    return std.fmt.allocPrint(allocator, "{{\"blocks\":[{{\"operations\":{s},\"parameters\":{s}}}],\"carriers\":{s}}}", .{ operations, parameters, carriers });
}

// This test uses only the original Decoder API and pre-existing object shape;
// it is also a causal RED against the old unsigned/ASCII-only parser.
test "JSON open property signed fraction and Unicode regression" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter };
    _ = try decoder.parse("{\"fraction\":-0.5,\"é\":true}");
    for ([_][]const u8{ "-1", "0.25", "1e+21", "1e-7", "9007199254740992", "5e-324" }) |source| {
        _ = try decoder.parse(source);
    }
    for ([_][]const u8{ "-0", "1.0", "1e0", "1e21", "1e+021", "1E+21", "1e999", "-01" }) |source| {
        try std.testing.expectError(error.InvalidJson, decoder.parse(source));
    }
    const rows = (try decoder.parse("{\"\\u0000\":0,\"é\":-1,\"😀\":0.25,\"\u{e000}\":1e+21}")).object;
    try std.testing.expectEqualStrings("😀", rows[2].key);
    try std.testing.expectError(error.InvalidOrder, decoder.parse("{\"\u{e000}\":0,\"😀\":1}"));
}

test "sourcePlan converts to typed owned references on the live decoder meter" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter, .sources = &plan_sources };
    const node = try decoder.parse(plan_valid);
    const after_parse = meter.remaining;
    const plan = try decoder.convert(control.SourcePlan, node);
    try std.testing.expect(meter.remaining < after_parse);
    try std.testing.expectEqualStrings("i32", plan.carriers[0]);
    try std.testing.expectEqual(@as(u16, 0), @intFromEnum(plan.blocks[0].parameters[0]));
    const op = plan.blocks[0].operations[0];
    try std.testing.expectEqual(@as(u16, 0), @intFromEnum(op.source.source));
    try std.testing.expectEqual(@as(u32, 3), op.source.end);
    try std.testing.expectEqual(@as(usize, 0), op.properties.len);
    const properties = "[{\"name\":\"func.return\",\"operands\":[0],\"properties\":{\"é\":-0.5},\"result\":null," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}]";
    const rich_source = try sourcePlanFixture(arena.allocator(), "[\"i32\"]", "[0]", properties);
    const rich = try decoder.convert(control.SourcePlan, try decoder.parse(rich_source));
    try std.testing.expectEqualStrings("é", rich.blocks[0].operations[0].properties[0].key);
    try std.testing.expectEqualStrings("-0.5", rich.blocks[0].operations[0].properties[0].value.number.canonical);
    var borrowed = [_]u8{ '-', '0', '.', '5' };
    const owned = try decoder.parse(&borrowed);
    borrowed[3] = '9';
    try std.testing.expectEqualStrings("-0.5", owned.number.canonical);
    meter.remaining = 1;
    try std.testing.expectError(error.WorkLimit, decoder.convert(control.SourcePlan, node));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
    try std.testing.expectError(error.WorkLimit, decoder.convert(control.SourcePlan, node));
}

test "sourcePlan requires exact records and explicit nullable result" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter, .sources = &plan_sources };
    const node = try decoder.parse(plan_valid);
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, .null));
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, .{ .object = node.object[0..1] }));
    const extra = [_]json.Member{ node.object[0], node.object[1], .{ .key = "extra", .value = .null } };
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, .{ .object = &extra }));
    const missing_result = "[{\"name\":\"func.return\",\"operands\":[0],\"properties\":{}," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}]";
    const source = try sourcePlanFixture(arena.allocator(), "[\"i32\"]", "[0]", missing_result);
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, try decoder.parse(source)));
}

test "sourcePlan rejects duplicate undefined and foreign directory references" {
    const invalid = [_]struct { carriers: []const u8, parameters: []const u8, operations: []const u8 }{
        .{ .carriers = "[\"i32\"]", .parameters = "[0,0]", .operations = "[" ++ plan_return ++ "]" },
        .{ .carriers = "[\"i32\",\"i32\"]", .parameters = "[0]", .operations = "[" ++ plan_return ++ "]" },
        .{ .carriers = "[\"i32\"]", .parameters = "[-1]", .operations = "[" ++ plan_return ++ "]" },
        .{ .carriers = "[\"i32\"]", .parameters = "[0]", .operations = "[{\"name\":\"copy\",\"operands\":[0],\"properties\":{},\"result\":0," ++ plan_source ++ ",\"successors\":[],\"view\":\"i32\"}]" },
        .{ .carriers = "[\"i32\"]", .parameters = "[0]", .operations = "[{\"name\":\"func.return\",\"operands\":[1],\"properties\":{},\"result\":null," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}]" },
        .{ .carriers = "[\"i32\"]", .parameters = "[0]", .operations = "[{\"name\":\"func.return\",\"operands\":[0],\"properties\":{},\"result\":null,\"source\":{\"end\":4,\"path\":\"/a.ts\",\"start\":0},\"successors\":[],\"view\":\"\"}]" },
        .{ .carriers = "[\"i32\"]", .parameters = "[0]", .operations = "[{\"name\":\"func.return\",\"operands\":[0],\"properties\":{},\"result\":null,\"source\":{\"end\":3,\"path\":\"/b.ts\",\"start\":0},\"successors\":[],\"view\":\"\"}]" },
    };
    for (invalid) |row| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        var meter = json.Meter{};
        var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter, .sources = &plan_sources };
        const source = try sourcePlanFixture(arena.allocator(), row.carriers, row.parameters, row.operations);
        try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, try decoder.parse(source)));
    }
}

test "sourcePlan completion edges and reserved blocks retain their exact rules" {
    const reserved = "{\"blocks\":[{\"operations\":[" ++ plan_return ++ "],\"parameters\":[0]},{\"operations\":[],\"parameters\":[1]}],\"carriers\":[\"i32\",\"i32\"]}";
    const branch = "{\"name\":\"cf.br\",\"operands\":[],\"properties\":{},\"result\":null," ++ plan_source ++ ",\"successors\":[1],\"view\":\"\"}";
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter, .sources = &plan_sources };
    _ = try decoder.convert(control.SourcePlan, try decoder.parse(reserved));
    const invalid = [_][]const u8{
        "{\"blocks\":[{\"operations\":[],\"parameters\":[]}],\"carriers\":[]}",
        "{\"blocks\":[{\"operations\":[" ++ branch ++ "," ++ plan_return ++ "],\"parameters\":[0]},{\"operations\":[],\"parameters\":[]}],\"carriers\":[\"i32\"]}",
        "{\"blocks\":[{\"operations\":[" ++ branch ++ "],\"parameters\":[]},{\"operations\":[],\"parameters\":[]}],\"carriers\":[]}",
        "{\"blocks\":[{\"operations\":[" ++ plan_return ++ "],\"parameters\":[]},{\"operations\":[],\"parameters\":[0]}],\"carriers\":[\"i32\"]}",
        "{\"blocks\":[{\"operations\":[{\"name\":\"invoke\",\"operands\":[0],\"properties\":{},\"result\":null," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}],\"parameters\":[0]}],\"carriers\":[\"i32\"]}",
    };
    for (invalid) |source| try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, try decoder.parse(source)));
}

test "sourcePlan enforces directory and cumulative operation caps" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var meter = json.Meter{};
    var decoder = json.Decoder{ .allocator = arena.allocator(), .meter = &meter, .sources = &plan_sources };
    const source = try sourcePlanFixture(arena.allocator(), "[" ++ ("\"i32\"," ** 4096) ++ "\"i32\"]", "[0]", "[" ++ plan_return ++ "]");
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, try decoder.parse(source)));
    const op = try decoder.parse("{\"name\":\"func.return\",\"operands\":[],\"properties\":{},\"result\":null," ++ plan_source ++ ",\"successors\":[],\"view\":\"\"}");
    const operations = try arena.allocator().alloc(json.Node, 4097);
    @memset(operations, op);
    const block_fields = [_]json.Member{ .{ .key = "operations", .value = .{ .array = operations } }, .{ .key = "parameters", .value = .{ .array = &.{} } } };
    const blocks = [_]json.Node{ .{ .object = &block_fields }, .{ .object = &block_fields } };
    const fields = [_]json.Member{ .{ .key = "blocks", .value = .{ .array = &blocks } }, .{ .key = "carriers", .value = .{ .array = &.{} } } };
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, .{ .object = &fields }));
    const too_many_blocks = try arena.allocator().alloc(json.Node, 257);
    @memset(too_many_blocks, .{ .object = &block_fields });
    const too_many_fields = [_]json.Member{ .{ .key = "blocks", .value = .{ .array = too_many_blocks } }, fields[1] };
    try std.testing.expectError(error.InvalidShape, decoder.convert(control.SourcePlan, .{ .object = &too_many_fields }));
}
