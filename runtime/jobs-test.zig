// SPDX-License-Identifier: MIT
const std = @import("std");
const jobs = @import("jobs.zig");
const L = jobs.layout;
const A = std.testing.allocator;
const source_layout = @embedFile("jobs/testdata/component-layout.json");
const expected: L.Expected = .{
    .inputIdentity = "sha256:99a382a6b51842afce62faaecb7a14631aba5f82a7757582e5a7720bcfb1177e",
    .hirDigest = "sha256:9566fbc77c052dbfbc2d9fc5d69ccb626c6399b564c6ba34eb683a102a0d2654",
};
const Vec = extern struct { x: f32, y: f32 };
const Position = extern struct { x: f32, y: f32, active: u8, count: i32 };
const Stats = extern struct { p: Vec, mass: f64, tag: u8 };
const ScalarEdges = extern struct { b: u8, s8: i8, u8: u8, s16: i16, u16: u16, s32: i32, u32: u32, s64: i64, u64: u64, si: isize, ui: usize, single: f32, double: f64 };
const Empty = extern struct {};
fn named(source: *const L.Layout, name: []const u8) *const L.Type {
    for (source.payload.types) |*row| if (std.mem.eql(u8, row.name, name)) return row;
    unreachable;
}

test "actual LLVM DataLayout agrees with independent Zig extern types field by field" {
    var source = try L.Layout.load(A, source_layout, expected);
    defer source.deinit();
    inline for (.{ .{ "Vec", Vec }, .{ "Position", Position }, .{ "Stats", Stats } }) |item| {
        const row = named(&source, item[0]);
        try std.testing.expectEqual(@sizeOf(item[1]), row.byteSize);
        try std.testing.expectEqual(@sizeOf(item[1]), row.stride);
        try std.testing.expectEqual(@alignOf(item[1]), row.alignment);
        inline for (std.meta.fields(item[1]), 0..) |field, index| {
            try std.testing.expectEqualStrings(field.name, row.fields[index].name);
            try std.testing.expectEqual(@offsetOf(item[1], field.name), row.fields[index].offset);
        }
    }
    try std.testing.expectEqual(L.Kind.component, named(&source, "Position").kind);
    try std.testing.expectEqual(L.Kind.component, named(&source, "Stats").kind);
    try std.testing.expectEqual(L.Kind.value, named(&source, "Vec").kind);
}

test "actual thirteen scalar layouts and empty component agree with independent Zig extern ABI" {
    var source = try L.Layout.load(A, @embedFile("jobs/testdata/component-layout-scalars.json"), .{
        .inputIdentity = "sha256:6b1863b93d5b407b9685e63903276e9c3670725324c74156dabcdd891e5fc356",
        .hirDigest = "sha256:a1fdc42e03cbd70883a95332f6e38c479170f66f4f40d65f8ad320faae0c4719",
    });
    defer source.deinit();
    inline for (.{ .{ "ScalarEdges", ScalarEdges }, .{ "Empty", Empty } }) |item| {
        const row = named(&source, item[0]);
        try std.testing.expectEqual(@sizeOf(item[1]), row.byteSize);
        try std.testing.expectEqual(@alignOf(item[1]), row.alignment);
        inline for (std.meta.fields(item[1]), 0..) |field, index| {
            try std.testing.expectEqualStrings(field.name, row.fields[index].name);
            try std.testing.expectEqual(@offsetOf(item[1], field.name), row.fields[index].offset);
        }
    }
    const empty = named(&source, "Empty");
    if (empty.kind == .component) {
        var world = try jobs.Store.init(A, &source, 2);
        defer world.deinit() catch unreachable;
        const archetype = try world.addArchetype(&.{empty.id});
        const entity = try world.create(archetype, &.{});
        const view = try world.borrowRead(entity, empty.id);
        try std.testing.expectEqual(@as(usize, 0), (try view.bytes()).len);
        try view.release();
        try world.remove(entity);
    }
}

test "column allocation initializes bytes, writes and reads, and keeps columns contiguous" {
    var source = try L.Layout.load(A, source_layout, expected);
    defer source.deinit();
    const position = named(&source, "Position").id;
    const stats = named(&source, "Stats").id;
    var world = try jobs.Store.init(A, &source, 2);
    defer world.deinit() catch unreachable;
    const archetype = try world.addArchetype(&.{ position, stats });
    try std.testing.expectEqual(archetype, try world.addArchetype(&.{ position, stats }));
    const one = try world.create(archetype, &.{});
    const two = try world.create(archetype, &.{});
    var zero: [@sizeOf(Position)]u8 = undefined;
    try world.read(one, position, &zero);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** @sizeOf(Position)), &zero);
    var initial = std.mem.zeroes(Position);
    initial.x = 10;
    initial.y = 20;
    initial.active = 1;
    initial.count = 30;
    try world.write(two, position, std.mem.asBytes(&initial));
    const read = try world.borrowRead(one, position);
    const bytes = try read.bytes();
    try std.testing.expectEqual(2 * @sizeOf(Position), bytes.len);
    try std.testing.expectEqualSlices(u8, std.mem.asBytes(&initial), bytes[@sizeOf(Position)..]);
    const pointer = @intFromPtr(bytes.ptr);
    try read.release();
    const write = try world.borrowWrite(one, position);
    const mutable = try write.bytes();
    try std.testing.expectEqual(pointer, @intFromPtr(mutable.ptr));
    const first: *Position = @ptrCast(@alignCast(mutable.ptr));
    first.x = 77;
    try write.release();
    var actual: Position = undefined;
    try world.read(one, position, std.mem.asBytes(&actual));
    try std.testing.expectEqual(@as(f32, 77), actual.x);
}

test "swap removal updates moved handles and generations reject all stale handles" {
    var source = try L.Layout.load(A, source_layout, expected);
    defer source.deinit();
    const position = named(&source, "Position").id;
    var world = try jobs.Store.init(A, &source, 3);
    defer world.deinit() catch unreachable;
    const archetype = try world.addArchetype(&.{position});
    const one = try world.create(archetype, &.{});
    var value = std.mem.zeroes(Position);
    value.count = 92;
    const two = try world.create(archetype, &.{.{ .component = position, .bytes = std.mem.asBytes(&value) }});
    try world.remove(one);
    var actual: Position = undefined;
    try std.testing.expectError(error.InvalidEntity, world.read(one, position, std.mem.asBytes(&actual)));
    try world.read(two, position, std.mem.asBytes(&actual));
    try std.testing.expectEqual(@as(i32, 92), actual.count);
    const reused = try world.create(archetype, &.{});
    try std.testing.expectEqual(one.index, reused.index);
    try std.testing.expect(one.generation != reused.generation);
    try std.testing.expectError(error.InvalidEntity, world.remove(one));
    try world.remove(two);
    try world.remove(reused);
    const after = try world.create(archetype, &.{});
    try world.read(after, position, std.mem.asBytes(&actual));
    try std.testing.expectEqual(@as(i32, 0), actual.count);
}

test "leases reject conflicting access and preserve live views across other chunk growth" {
    var source = try L.Layout.load(A, source_layout, expected);
    defer source.deinit();
    const position = named(&source, "Position").id;
    const stats = named(&source, "Stats").id;
    var world = try jobs.Store.init(A, &source, 2);
    defer world.deinit() catch unreachable;
    const archetype = try world.addArchetype(&.{ position, stats });
    const one = try world.create(archetype, &.{});
    const first = try world.borrowRead(one, position);
    const second = try world.borrowRead(one, position);
    const original = try first.bytes();
    try std.testing.expectError(error.BorrowConflict, world.borrowWrite(one, position));
    try std.testing.expectError(error.BorrowConflict, world.write(one, position, &([_]u8{0} ** @sizeOf(Position))));
    try std.testing.expectError(error.BorrowConflict, world.remove(one));
    try std.testing.expectError(error.BorrowConflict, world.deinit());
    const independent = try world.borrowWrite(one, stats);
    try independent.release();
    const other = try world.create(archetype, &.{});
    try std.testing.expectEqual(@intFromPtr(original.ptr), @intFromPtr((try first.bytes()).ptr));
    try std.testing.expectEqual(@sizeOf(Position), (try first.bytes()).len);
    try world.remove(other);
    try first.release();
    try second.release();
    try std.testing.expectError(error.InvalidLease, first.release());
    try std.testing.expectError(error.InvalidLease, first.bytes());
    const writer = try world.borrowWrite(one, position);
    var bytes: [@sizeOf(Position)]u8 = undefined;
    try std.testing.expectError(error.BorrowConflict, world.read(one, position, &bytes));
    try std.testing.expectError(error.BorrowConflict, world.borrowRead(one, position));
    try writer.release();
    try world.remove(one);
}

test "wrong identity target digest canonical envelope and size limits fail at the boundary" {
    var wrong = expected;
    wrong.inputIdentity = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    try std.testing.expectError(error.IdentityMismatch, L.Layout.load(A, source_layout, wrong));
    wrong = expected;
    wrong.target.pointerBits = "32";
    try std.testing.expectError(error.WrongTarget, L.Layout.load(A, source_layout, wrong));
    const corrupt = try A.dupe(u8, source_layout);
    defer A.free(corrupt);
    const at = std.mem.indexOf(u8, corrupt, "payloadHash").? + "payloadHash\":\"sha256:".len;
    corrupt[at] = if (corrupt[at] == 'a') 'b' else 'a';
    try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, corrupt, expected));
    const whitespace = try std.mem.concat(A, u8, &.{ " ", source_layout });
    defer A.free(whitespace);
    try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, whitespace, expected));
    try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, source_layout[0 .. source_layout.len - 1], expected));
    const oversized = try A.alloc(u8, L.max_bytes + 1);
    defer A.free(oversized);
    @memset(oversized, ' ');
    try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, oversized, expected));
}

fn encoded(allocator: std.mem.Allocator, payload: L.Payload) ![]u8 {
    const text = try std.json.Stringify.valueAlloc(allocator, payload, .{});
    defer allocator.free(text);
    var sha = std.crypto.hash.sha2.Sha256.init(.{});
    sha.update("tsfg.component-layout.v1\x00");
    sha.update(text);
    var digest: [32]u8 = undefined;
    sha.final(&digest);
    const hex = std.fmt.bytesToHex(digest, .lower);
    const hash = try std.mem.concat(allocator, u8, &.{ "sha256:", &hex });
    defer allocator.free(hash);
    const envelope = .{ .family = "tsfg.component-layout-candidate", .payload = text, .payloadHash = hash, .schemaHash = L.schema_hash, .version = @as(u32, 1) };
    const json = try std.json.Stringify.valueAlloc(allocator, envelope, .{});
    defer allocator.free(json);
    return std.mem.concat(allocator, u8, &.{ json, "\n" });
}

test "self-consistent checksums never allow malformed field ABI or unclosed type graphs" {
    for (0..7) |mutation| {
        var source = try L.Layout.load(A, source_layout, expected);
        defer source.deinit();
        const row = @constCast(named(&source, "Position"));
        const fields = @constCast(row.fields);
        switch (mutation) {
            0 => row.alignment = 3,
            1 => fields[1].offset = 0,
            2 => fields[0].type = "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            3 => std.mem.swap(L.Field, &fields[0], &fields[1]),
            4 => fields[0].id = fields[1].id,
            5 => row.byteSize += 1,
            6 => fields[0].range.start = fields[0].range.end + 1,
            else => unreachable,
        }
        const bytes = try encoded(A, source.payload);
        defer A.free(bytes);
        try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, bytes, expected));
    }
}

test "untrusted forward alignments and zero-size cycles fail without unsafe arithmetic" {
    {
        var source = try L.Layout.load(A, source_layout, expected);
        defer source.deinit();
        // Position precedes this i32 row in the semantic directory.
        @constCast(named(&source, "i32")).alignment = 0;
        const bytes = try encoded(A, source.payload);
        defer A.free(bytes);
        try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, bytes, expected));
    }
    {
        var source = try L.Layout.load(A, source_layout, expected);
        defer source.deinit();
        var rows = [_]L.Type{ named(&source, "Vec").*, named(&source, "Position").* };
        var value_field = [_]L.Field{rows[0].fields[0]};
        var component_field = [_]L.Field{rows[1].fields[0]};
        value_field[0].type = rows[0].id;
        component_field[0].type = rows[0].id;
        for (&rows) |*row| {
            row.byteSize = 0;
            row.stride = 0;
            row.alignment = 1;
        }
        rows[0].fields = &value_field;
        rows[1].fields = &component_field;
        var payload = source.payload;
        payload.types = &rows;
        payload.components = &.{rows[1].id};
        const bytes = try encoded(A, payload);
        defer A.free(bytes);
        try std.testing.expectError(error.InvalidLayout, L.Layout.load(A, bytes, expected));
    }
}

fn allocationScenario(allocator: std.mem.Allocator) !void {
    var source = try L.Layout.load(allocator, source_layout, expected);
    defer source.deinit();
    var world = try jobs.Store.init(allocator, &source, 2);
    defer world.deinit() catch unreachable;
    const position = named(&source, "Position").id;
    const archetype = try world.addArchetype(&.{position});
    const entity = try world.create(archetype, &.{});
    const view = try world.borrowWrite(entity, position);
    try view.release();
    try world.remove(entity);
}
test "allocation failures roll back layout chunks metadata and leases without leaks" {
    try std.testing.checkAllAllocationFailures(A, allocationScenario, .{});
}
