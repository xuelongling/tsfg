// SPDX-License-Identifier: MIT
const std = @import("std");
const jobs = @import("jobs.zig");
const L = jobs.layout;
const A = std.testing.allocator;
const nested_bytes = @embedFile("jobs/testdata/component-layout-nested.json");
const nested_expected: L.Expected = .{
    .inputIdentity = "sha256:a46f4d6d8f0e6647989a0d2a26d34fb1c4fc05326d209c0fb35e142fbd279658",
    .hirDigest = "sha256:d42d1f2dc2d13af016711ccc3a7ade06c0c8f2cc0d54c4ac4f5f6ea3e3ff6d3e",
};
const Child = extern struct { x: i32 };
const Parent = extern struct { child: Child, active: u8 };
const InheritedPosition = extern struct { base_x: f32, base_y: f32, x: f32, y: f32 };

fn Value(comptime level: usize) type {
    if (level == 0) return extern struct { leaf: i32 };
    return extern struct { child: Value(level - 1) };
}
const Depth32 = extern struct { fast: Value(2), deep: Value(29) };

test "actual nested component ABI is inline and enters the real column store" {
    var source = try L.Layout.load(A, nested_bytes, nested_expected);
    defer source.deinit();
    var parent: ?*const L.Type = null;
    inline for (.{ .{ "Child", Child }, .{ "Parent", Parent } }) |item| {
        for (source.payload.types) |*row| if (std.mem.eql(u8, row.name, item[0])) {
            try std.testing.expectEqual(L.Kind.component, row.kind);
            try std.testing.expectEqual(@sizeOf(item[1]), row.byteSize);
            try std.testing.expectEqual(@alignOf(item[1]), row.alignment);
            inline for (std.meta.fields(item[1]), 0..) |field, index| {
                try std.testing.expectEqualStrings(field.name, row.fields[index].name);
                try std.testing.expectEqual(@offsetOf(item[1], field.name), row.fields[index].offset);
            }
            if (std.mem.eql(u8, row.name, "Parent")) parent = row;
        };
    }
    try std.testing.expect(parent != null);
    const child = source.find(parent.?.fields[0].type).?;
    try std.testing.expectEqualStrings("Child", child.name);
    try std.testing.expectEqual(L.Kind.component, child.kind);
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    const archetype = try store.addArchetype(&.{parent.?.id});
    var initial = std.mem.zeroes(Parent);
    initial.child.x = 73;
    initial.active = 1;
    const entity = try store.create(archetype, &.{.{ .component = parent.?.id, .bytes = std.mem.asBytes(&initial) }});
    const view = try store.borrowWrite(entity, parent.?.id);
    const values: *Parent = @ptrCast(@alignCast((try view.bytes()).ptr));
    try std.testing.expectEqual(@as(i32, 73), values.child.x);
    values.child.x = -29;
    try view.release();
    var actual: Parent = undefined;
    try store.read(entity, parent.?.id, std.mem.asBytes(&actual));
    try std.testing.expectEqual(@as(i32, -29), actual.child.x);
    try std.testing.expectEqual(@as(u8, 1), actual.active);
    try store.remove(entity);
}

test "equal storage size cannot substitute a different scalar identity" {
    var original = try L.Layout.load(A, nested_bytes, nested_expected);
    defer original.deinit();
    const rows = try A.dupe(L.Type, original.payload.types);
    defer A.free(rows);
    for (rows) |*row| {
        if (row.kind == .scalar and std.mem.eql(u8, row.scalar, "i32")) {
            row.name = "f32";
            row.scalar = "f32";
            break;
        }
    } else return error.MissingI32Fixture;
    var payload = original.payload;
    payload.types = rows;
    try expectInvalidLayout(payload, nested_expected);
}

test "actual inherited layout preserves distinct shadowing field declarations" {
    // Exact layout envelope from the official v6 loop-inheritance Query artifact.
    const bytes = @embedFile("jobs/testdata/component-layout-inheritance.json");
    const input = "sha256:e3e07cea503f25c01339fe209c03685b91278b3b28a07162b14da60e952db3f3";
    const position_id = "sha256:cb824c755704becef7c0bf4673267f1fd3275acfb472b491dde070a54924363d";
    var source = try L.Layout.loadCatalog(A, bytes, input);
    defer source.deinit();
    const position = source.find(position_id) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@sizeOf(InheritedPosition), position.byteSize);
    try std.testing.expectEqual(@alignOf(InheritedPosition), position.alignment);
    try std.testing.expectEqual(@as(usize, 4), position.fields.len);
    inline for (std.meta.fields(InheritedPosition), .{ "x", "y", "x", "y" }, 0..) |field, name, index| {
        const row = &position.fields[index];
        try std.testing.expectEqualStrings(name, row.name);
        try std.testing.expectEqual(@offsetOf(InheritedPosition, field.name), row.offset);
    }
    try std.testing.expect(!std.mem.eql(u8, position.fields[0].id, position.fields[2].id));
    try std.testing.expect(position.fields[0].range.start < position.fields[2].range.start);

    var payload = source.payload;
    const rows = try A.dupe(L.Type, payload.types);
    defer A.free(rows);
    payload.types = rows;
    var fields: [4]L.Field = position.fields[0..4].*;
    for (rows) |*row| if (std.mem.eql(u8, row.id, position_id)) {
        row.fields = &fields;
    };
    const expected: L.Expected = .{ .inputIdentity = input, .hirDigest = source.payload.hirDigest };
    fields[2].id = fields[0].id;
    try expectInvalidLayout(payload, expected);
    fields[2].id = position.fields[2].id;
    fields[2].range = fields[0].range;
    try expectInvalidLayout(payload, expected);
}

fn expectInvalidLayout(payload: L.Payload, expected: L.Expected) !void {
    const payload_bytes = try std.json.Stringify.valueAlloc(A, payload, .{});
    defer A.free(payload_bytes);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("tsfg.component-layout.v1\x00");
    hash.update(payload_bytes);
    var digest: [32]u8 = undefined;
    hash.final(&digest);
    const payload_hash = "sha256:" ++ std.fmt.bytesToHex(digest, .lower);
    const envelope = try std.json.Stringify.valueAlloc(A, .{
        .family = "tsfg.component-layout-candidate",
        .payload = payload_bytes,
        .payloadHash = &payload_hash,
        .schemaHash = L.schema_hash,
        .version = @as(u32, 1),
    }, .{});
    defer A.free(envelope);
    const bytes = try std.fmt.allocPrint(A, "{s}\n", .{envelope});
    defer A.free(bytes);
    if (L.Layout.load(A, bytes, expected)) |loaded| {
        var unexpected = loaded;
        unexpected.deinit();
        return error.TestExpectedError;
    } else |err| try std.testing.expectEqual(error.InvalidLayout, err);
}

test "actual complete32-node layout matches the independent extern chain ABI" {
    var source = try L.Layout.load(A, @embedFile("jobs/testdata/component-layout-depth32.json"), .{
        .inputIdentity = "sha256:73a4505ed88dd42599f6a18b34a19eca6f8df80659d9142cc1f925a7b3c4fb9b",
        .hirDigest = "sha256:f64f28284e9a520f637c854798ce8154bc5e60724c764c3ca60618de4408aea0",
    });
    defer source.deinit();
    try std.testing.expectEqual(@as(usize, 32), source.payload.types.len);
    const names = .{ "V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17", "V18", "V19", "V20", "V21", "V22", "V23", "V24", "V25", "V26", "V27", "V28", "V29" };
    inline for (names, 0..) |name, level| {
        var found = false;
        for (source.payload.types) |row| if (std.mem.eql(u8, row.name, name)) {
            found = true;
            try std.testing.expectEqual(@sizeOf(Value(level)), row.byteSize);
            try std.testing.expectEqual(@alignOf(Value(level)), row.alignment);
            try std.testing.expectEqual(@as(usize, 1), row.fields.len);
            const field = if (level == 0) "leaf" else "child";
            try std.testing.expectEqualStrings(field, row.fields[0].name);
            try std.testing.expectEqual(@offsetOf(Value(level), field), row.fields[0].offset);
        };
        try std.testing.expect(found);
    }
    const root = source.find(source.payload.components[0]).?;
    try std.testing.expectEqualStrings("Depth32", root.name);
    try std.testing.expectEqual(@sizeOf(Depth32), root.byteSize);
    try std.testing.expectEqual(@alignOf(Depth32), root.alignment);
    inline for (std.meta.fields(Depth32), 0..) |field, index| {
        try std.testing.expectEqualStrings(field.name, root.fields[index].name);
        try std.testing.expectEqual(@offsetOf(Depth32, field.name), root.fields[index].offset);
    }
}

test "actual invalid old-producer cached-DAG layout cannot bypass32-node bound" {
    // Real pre-fix producer output for the complete overflow Source, not a fabricated DTO.
    if (L.Layout.load(A, @embedFile("jobs/testdata/component-layout-invalid-depth.json"), .{
        .inputIdentity = "sha256:906289580967785b1f372ef8921771444c9b484b1789b2a9ef3fad1a6ea50e02",
        .hirDigest = "sha256:2b8977c9695f17cba7916cf4562bc23a1922aec9001a1b7facdda1567905ed64",
    })) |loaded| {
        var unexpected = loaded;
        unexpected.deinit();
        return error.TestExpectedError;
    } else |err| {
        // Fresh excessive paths and cached-height paths are both explicit layout errors.
        try std.testing.expect(err == error.LayoutLimit or err == error.InvalidLayout);
    }
}
