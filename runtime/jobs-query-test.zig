// SPDX-License-Identifier: MIT
const std = @import("std");
const jobs = @import("jobs.zig");
const A = std.testing.allocator;
const Position = extern struct { x: f32, y: f32, active: u8, count: i32 };
const Stats = extern struct { p: extern struct { x: f32, y: f32 }, mass: f64, tag: u8 };
fn load(allocator: std.mem.Allocator) !jobs.layout.Layout {
    return jobs.layout.Layout.load(allocator, @embedFile("jobs/testdata/component-layout.json"), .{
        .inputIdentity = "sha256:99a382a6b51842afce62faaecb7a14631aba5f82a7757582e5a7720bcfb1177e",
        .hirDigest = "sha256:9566fbc77c052dbfbc2d9fc5d69ccb626c6399b564c6ba34eb683a102a0d2654",
    });
}
fn component(source: *const jobs.layout.Layout, name: []const u8) []const u8 {
    for (source.payload.types) |row| if (std.mem.eql(u8, row.name, name)) return row.id;
    unreachable;
}

test "query validates the complete canonical selection before changing any ownership" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    const archetype = try store.addArchetype(&.{ p, s });
    const entity = try store.create(archetype, &.{});
    const old = try store.borrowWrite(entity, p);
    try std.testing.expectError(error.ComponentMissing, store.query(&.{}));
    try std.testing.expectError(error.ComponentMissing, store.query(&.{.{ .component = "absent", .access = .read }}));
    try std.testing.expectError(error.ComponentMissing, store.query(&.{ .{ .component = p, .access = .read }, .{ .component = p, .access = .write } }));
    try std.testing.expectError(error.ComponentMissing, store.query(&.{ .{ .component = s, .access = .read }, .{ .component = p, .access = .read } }));
    try std.testing.expectEqual(@sizeOf(Position), (try old.bytes()).len);
    try old.release();
    const query = try store.query(&.{.{ .component = p, .access = .write }});
    try std.testing.expectEqual(@as(usize, 1), try query.batchCount());
    try query.release();
}

test "query selects all nonempty matching chunks in stable archetype and chunk order" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    const only_p = try store.addArchetype(&.{p});
    const only_s = try store.addArchetype(&.{s});
    const both = try store.addArchetype(&.{ p, s });
    var wanted: [7]jobs.Entity = undefined;
    for (0..3) |i| wanted[i] = try store.create(only_p, &.{});
    _ = try store.create(only_s, &.{});
    for (3..7) |i| wanted[i] = try store.create(both, &.{});
    const empty = try store.create(both, &.{});
    try store.remove(empty);
    const query = try store.query(&.{.{ .component = p, .access = .read }});
    try std.testing.expectEqual(@as(usize, 4), try query.batchCount());
    const lengths = [_]usize{ 2, 1, 2, 2 };
    var cursor: usize = 0;
    for (lengths, 0..) |length, i| {
        const batch = try query.batch(i);
        try std.testing.expectEqual(length, try batch.rowCount());
        const info = try batch.column(0);
        try std.testing.expectEqualStrings(p, info.component);
        try std.testing.expectEqual(@sizeOf(Position), info.stride);
        try std.testing.expectEqual(jobs.Access.read, info.access);
        for (0..length) |row| {
            try std.testing.expectEqual(wanted[cursor], try batch.entity(row));
            cursor += 1;
        }
    }
    try std.testing.expectEqual(wanted.len, cursor);
    try query.release();
}

test "mixed query views are coherent const or mutable zero-copy original columns" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    const both = try store.addArchetype(&.{ p, s });
    var entities: [5]jobs.Entity = undefined;
    for (&entities, 0..) |*entity, i| {
        var value = std.mem.zeroes(Stats);
        value.mass = @floatFromInt(i);
        entity.* = try store.create(both, &.{.{ .component = s, .bytes = std.mem.asBytes(&value) }});
    }
    const original = try store.borrowRead(entities[0], s);
    const pointer = @intFromPtr((try original.bytes()).ptr);
    try original.release();
    const query = try store.query(&.{ .{ .component = p, .access = .read }, .{ .component = s, .access = .write } });
    try std.testing.expectEqual(@as(usize, 3), try query.batchCount());
    for (0..try query.batchCount()) |index| {
        const batch = try query.batch(index);
        const shared = try store.borrowRead(try batch.entity(0), p);
        try std.testing.expectEqual(@intFromPtr((try shared.bytes()).ptr), @intFromPtr((try batch.read(0)).ptr));
        try std.testing.expect(@TypeOf(try batch.read(0)) == []const u8);
        try shared.release();
        try std.testing.expectError(error.InvalidLease, batch.write(0));
        const bytes = try batch.write(1);
        if (index == 0) try std.testing.expectEqual(pointer, @intFromPtr(bytes.ptr));
        const values: []Stats = @alignCast(std.mem.bytesAsSlice(Stats, bytes));
        try std.testing.expectEqual(try batch.rowCount(), values.len);
        for (values) |*value| value.mass += 10;
    }
    try query.release();
    for (entities, 0..) |entity, i| {
        var value: Stats = undefined;
        try store.read(entity, s, std.mem.asBytes(&value));
        try std.testing.expectEqual(@as(f64, @floatFromInt(i + 10)), value.mass);
    }
}

test "late conflicting chunk refuses the whole new query and preserves old borrowers" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 1);
    defer store.deinit() catch unreachable;
    const both = try store.addArchetype(&.{ p, s });
    const first = try store.create(both, &.{});
    const last = try store.create(both, &.{});
    const old = try store.borrowRead(last, s);
    try std.testing.expectError(error.BorrowConflict, store.query(&.{ .{ .component = p, .access = .read }, .{ .component = s, .access = .write } }));
    try std.testing.expectEqual(@sizeOf(Stats), (try old.bytes()).len);
    const free = try store.borrowWrite(first, s);
    try free.release();
    try old.release();
    const reader = try store.query(&.{.{ .component = p, .access = .read }});
    const another = try store.query(&.{.{ .component = p, .access = .read }});
    try std.testing.expectError(error.BorrowConflict, store.query(&.{.{ .component = p, .access = .write }}));
    try another.release();
    try reader.release();
    const writer = try store.query(&.{.{ .component = p, .access = .write }});
    try std.testing.expectError(error.BorrowConflict, store.borrowRead(last, p));
    try std.testing.expectError(error.BorrowConflict, store.query(&.{.{ .component = p, .access = .read }}));
    try writer.release();
}

test "query aliases release the complete group and stale batches never recover reused tokens" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 1);
    defer store.deinit() catch unreachable;
    const both = try store.addArchetype(&.{ p, s });
    const entity = try store.create(both, &.{});
    _ = try store.create(both, &.{});
    const query = try store.query(&.{ .{ .component = p, .access = .write }, .{ .component = s, .access = .read } });
    const batch = try query.batch(0);
    try std.testing.expectError(error.InvalidLease, query.batch(2));
    try std.testing.expectError(error.ComponentMissing, batch.column(2));
    try std.testing.expectError(error.InvalidEntity, batch.entity(1));
    try std.testing.expectError(error.BorrowConflict, store.remove(entity));
    try std.testing.expectError(error.BorrowConflict, store.deinit());
    try batch.release();
    try std.testing.expectError(error.InvalidLease, query.release());
    try std.testing.expectError(error.InvalidLease, batch.release());
    try std.testing.expectError(error.InvalidLease, batch.read(0));
    try std.testing.expectError(error.InvalidLease, batch.entity(0));
    try std.testing.expectError(error.InvalidLease, query.batchCount());
    const fresh = try store.query(&.{.{ .component = p, .access = .write }});
    try std.testing.expectError(error.InvalidLease, batch.rowCount());
    try fresh.release();
    try store.remove(entity);
    const replacement = try store.create(both, &.{});
    try std.testing.expectEqual(entity.index, replacement.index);
    try std.testing.expect(entity.generation != replacement.generation);
    const current = try store.query(&.{.{ .component = p, .access = .read }});
    const current_batch = try current.batch(0);
    try std.testing.expectEqual(replacement, try current_batch.entity(0));
    try current.release();
}

test "no match sessions and safe external growth retain their acquisition snapshot" {
    var source = try load(A);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    const both = try store.addArchetype(&.{ p, s });
    const empty = try store.query(&.{.{ .component = p, .access = .read }});
    try std.testing.expectEqual(@as(usize, 0), try empty.batchCount());
    try std.testing.expectError(error.BorrowConflict, store.deinit());
    const first = try store.create(both, &.{});
    try std.testing.expectEqual(@as(usize, 0), try empty.batchCount());
    try empty.release();
    const query = try store.query(&.{.{ .component = p, .access = .read }});
    const batch = try query.batch(0);
    const pointer = @intFromPtr((try batch.read(0)).ptr);
    const other = try store.create(both, &.{});
    try std.testing.expectEqual(@as(usize, 1), try query.batchCount());
    try std.testing.expectEqual(@as(usize, 1), try batch.rowCount());
    try std.testing.expectEqual(pointer, @intFromPtr((try batch.read(0)).ptr));
    try store.remove(other);
    try std.testing.expectError(error.BorrowConflict, store.remove(first));
    try query.release();
}

fn allocationScenario(allocator: std.mem.Allocator, old_query: bool) !void {
    var source = try load(allocator);
    defer source.deinit();
    const p = component(&source, "Position");
    const s = component(&source, "Stats");
    var store = try jobs.Store.init(allocator, &source, 1);
    defer store.deinit() catch unreachable;
    const both = try store.addArchetype(&.{ p, s });
    var first: jobs.Entity = undefined;
    for (0..9) |i| {
        const entity = try store.create(both, &.{});
        if (i == 0) first = entity;
    }
    const old = try store.borrowRead(first, p);
    defer old.release() catch unreachable;
    var previous: ?jobs.Store.Query = null;
    if (old_query) previous = try store.query(&.{.{ .component = p, .access = .read }});
    defer if (previous) |query| query.release() catch unreachable;
    const old_count = store.leases.items.len;
    const query = store.query(&.{ .{ .component = p, .access = .read }, .{ .component = s, .access = .write } }) catch |err| {
        try std.testing.expectEqual(old_count, store.leases.items.len);
        try std.testing.expectEqual(@sizeOf(Position), (try old.bytes()).len);
        if (previous) |kept| try std.testing.expectEqual(@as(usize, 9), try kept.batchCount());
        return err;
    };
    try query.release();
}
test "all allocation failure points preserve complete old column and query ownership" {
    try std.testing.checkAllAllocationFailures(A, allocationScenario, .{false});
    try std.testing.checkAllAllocationFailures(A, allocationScenario, .{true});
}
