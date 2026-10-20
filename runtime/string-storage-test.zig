// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const codec = @import("string-codec.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const expectError = std.testing.expectError;

const Vector = struct {
    id: []const u8,
    units: []const u16,
    bytes: []const u8,
};

const vectors = [_]Vector{
    .{ .id = "s00", .units = &[_]u16{}, .bytes = &[_]u8{} },
    .{ .id = "s01", .units = &[_]u16{0x0000}, .bytes = &[_]u8{0x00} },
    .{ .id = "s02", .units = &[_]u16{ 0xD83D, 0xDE00 }, .bytes = &[_]u8{ 0xF0, 0x9F, 0x98, 0x80 } },
    .{ .id = "s03", .units = &[_]u16{ 0xD83D, 0xDE00 }, .bytes = &[_]u8{ 0xF0, 0x9F, 0x98, 0x80 } },
    .{ .id = "s04", .units = &[_]u16{ 0xD83D, 0xDE00 }, .bytes = &[_]u8{ 0xF0, 0x9F, 0x98, 0x80 } },
    .{ .id = "s05", .units = &[_]u16{0xD800}, .bytes = &[_]u8{ 0xED, 0xA0, 0x80 } },
    .{ .id = "s06", .units = &[_]u16{0xDC00}, .bytes = &[_]u8{ 0xED, 0xB0, 0x80 } },
    .{ .id = "s07", .units = &[_]u16{ 0xDE00, 0xD83D }, .bytes = &[_]u8{ 0xED, 0xB8, 0x80, 0xED, 0xA0, 0xBD } },
    .{ .id = "s08", .units = &[_]u16{ 0x0041, 0xD800, 0x0000, 0xDC00, 0x005A }, .bytes = &[_]u8{ 0x41, 0xED, 0xA0, 0x80, 0x00, 0xED, 0xB0, 0x80, 0x5A } },
    .{ .id = "s09", .units = &[_]u16{ 0x005C, 0x0022, 0x000A, 0x000D, 0x0009, 0x0041, 0x0042 }, .bytes = &[_]u8{ 0x5C, 0x22, 0x0A, 0x0D, 0x09, 0x41, 0x42 } },
    .{ .id = "s10", .units = &[_]u16{ 0xD800, 0xDC00 }, .bytes = &[_]u8{ 0xF0, 0x90, 0x80, 0x80 } },
    .{ .id = "s11", .units = &[_]u16{0xE000}, .bytes = &[_]u8{ 0xEE, 0x80, 0x80 } },
    .{ .id = "s12", .units = &[_]u16{ 0x0065, 0x0301 }, .bytes = &[_]u8{ 0x65, 0xCC, 0x81 } },
    .{ .id = "s13", .units = &[_]u16{0x00E9}, .bytes = &[_]u8{ 0xC3, 0xA9 } },
    .{ .id = "emoji-high", .units = &[_]u16{0xD83D}, .bytes = &[_]u8{ 0xED, 0xA0, 0xBD } },
    .{ .id = "emoji-low", .units = &[_]u16{0xDE00}, .bytes = &[_]u8{ 0xED, 0xB8, 0x80 } },
    .{ .id = "high-endpoint", .units = &[_]u16{0xDBFF}, .bytes = &[_]u8{ 0xED, 0xAF, 0xBF } },
    .{ .id = "low-endpoint", .units = &[_]u16{0xDFFF}, .bytes = &[_]u8{ 0xED, 0xBF, 0xBF } },
    .{ .id = "max-supplementary", .units = &[_]u16{ 0xDBFF, 0xDFFF }, .bytes = &[_]u8{ 0xF4, 0x8F, 0xBF, 0xBF } },
    .{ .id = "bmp-encoding-boundaries", .units = &[_]u16{ 0x007F, 0x0080, 0x07FF, 0x0800, 0xD7FF, 0xE000, 0xFFFD, 0xFFFF }, .bytes = &[_]u8{ 0x7F, 0xC2, 0x80, 0xDF, 0xBF, 0xE0, 0xA0, 0x80, 0xED, 0x9F, 0xBF, 0xEE, 0x80, 0x80, 0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBF } },
    .{ .id = "interrupted-pair", .units = &[_]u16{ 0xD800, 0x0041, 0xDC00 }, .bytes = &[_]u8{ 0xED, 0xA0, 0x80, 0x41, 0xED, 0xB0, 0x80 } },
};

const rejected = [_][]const u8{
    &[_]u8{0x80},
    &[_]u8{ 0xC0, 0x80 },
    &[_]u8{ 0xE0, 0x80, 0x80 },
    &[_]u8{ 0xF0, 0x80, 0x80, 0x80 },
    &[_]u8{0xC2},
    &[_]u8{ 0xE2, 0x82 },
    &[_]u8{ 0xF0, 0x9F, 0x98 },
    &[_]u8{ 0xF4, 0x90, 0x80, 0x80 },
    &[_]u8{ 0xF5, 0x80, 0x80, 0x80 },
    &[_]u8{ 0xED, 0xA0, 0x80, 0xED, 0xB0, 0x80 },
};

fn verifyOutOfBounds(heap: *Heap, handle: Handle, length: usize) !void {
    const beyond = if (length == 0) 1 else length + 1;
    try expectError(error.IndexOutOfBounds, heap.readStringCodeUnit(handle, length));
    try expectError(error.IndexOutOfBounds, heap.readStringCodeUnit(handle, beyond));
    try expectError(error.IndexOutOfBounds, heap.readStringCodeUnit(handle, @as(usize, 0xFFFF_FFFF)));
}

fn verifyString(heap: *Heap, handle: Handle, vector: Vector) !void {
    try equal(vector.units.len, try heap.stringLength(handle));
    try equal(vector.bytes.len, try heap.stringByteLength(handle));
    var bytes: [64]u8 = undefined;
    const byte_length = try heap.copyStringBytes(handle, bytes[0..]);
    try equal(vector.bytes.len, byte_length);
    try expect(std.mem.eql(u8, vector.bytes, bytes[0..byte_length]));
    for (vector.units, 0..) |unit, index| {
        try equal(unit, try heap.readStringCodeUnit(handle, index));
    }
    try verifyOutOfBounds(heap, handle, vector.units.len);
}

test "canonical WTF-8 vectors survive real heap storage and moving collection" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var handles: [vectors.len]Handle = undefined;
    var mutable: [32]u16 = undefined;
    for (vectors, 0..) |vector, index| {
        @memcpy(mutable[0..vector.units.len], vector.units);
        handles[index] = try heap.createString(mutable[0..vector.units.len], .persistent);
        @memset(mutable[0..vector.units.len], 0xFFFF);
        try verifyString(&heap, handles[index], vector);
    }
    try equal(@as(usize, vectors.len), try heap.objectCount());
    try heap.collect();
    for (vectors, 0..) |vector, index| try verifyString(&heap, handles[index], vector);
    try heap.collect();
    for (vectors, 0..) |vector, index| try verifyString(&heap, handles[index], vector);
}

test "canonical validator rejects malformed encodings" {
    for (rejected) |bytes| {
        try expectError(error.InvalidCanonicalWtf8, codec.canonicalLength(bytes));
    }
}

test "string payload is distinct from scalar payloads and owns its input" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scalar = try heap.create(7, 42, 0, .persistent);
    const string = try heap.createString(&[_]u16{ 0x0041, 0x0000 }, .persistent);
    try equal(@as(u64, 42), (try heap.read(scalar, 7)).scalar);
    try equal(@as(u64, 7), (try heap.read(scalar, 7)).type_id);
    try expectError(error.TypeMismatch, heap.read(string, 0));
    try expectError(error.TypeMismatch, heap.read(string, 7));
    try expectError(error.TypeMismatch, heap.write(string, 0, 1));
    try expectError(error.TypeMismatch, heap.stringLength(scalar));
    try expectError(error.TypeMismatch, heap.stringByteLength(scalar));
    try expectError(error.TypeMismatch, heap.readStringCodeUnit(scalar, 0));
    var one_byte: [1]u8 = undefined;
    try expectError(error.TypeMismatch, heap.copyStringBytes(scalar, one_byte[0..]));
    try expectError(error.InvalidField, heap.setEdge(string, 0, scalar));

    const input = try std.testing.allocator.dupe(u16, &[_]u16{ 0xD83D, 0xDE00, 0x0041 });
    const owned = try heap.createString(input, .persistent);
    std.testing.allocator.free(input);
    try equal(@as(usize, 3), try heap.stringLength(owned));
    try equal(@as(u16, 0xD83D), try heap.readStringCodeUnit(owned, 0));
    try equal(@as(u16, 0xDE00), try heap.readStringCodeUnit(owned, 1));
    try equal(@as(u16, 0x0041), try heap.readStringCodeUnit(owned, 2));
    var bytes: [16]u8 = undefined;
    try equal(@as(usize, 5), try heap.copyStringBytes(owned, bytes[0..]));
    try expect(std.mem.eql(u8, &[_]u8{ 0xF0, 0x9F, 0x98, 0x80, 0x41 }, bytes[0..5]));
    try expectError(error.BufferTooSmall, heap.copyStringBytes(owned, bytes[0..4]));
}

fn failedStringRequest(heap: *Heap, persistent: Handle, temporary_out: *Handle) !void {
    const scope = try heap.beginScope();
    defer heap.endScope(scope) catch unreachable;
    temporary_out.* = try heap.retain(persistent, .temporary);
    _ = try heap.createString(&[_]u16{0x0042}, .temporary);
    return error.SimulatedRequestAbort;
}

test "string roots scopes retain release and edges survive collection" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    const temporary = try heap.createString(&[_]u16{ 0x0041, 0xD83D }, .temporary);
    const persistent = try heap.retain(temporary, .persistent);
    const alias = try heap.retain(persistent, .persistent);
    const nested = try heap.beginScope();
    const nested_handle = try heap.retain(temporary, .temporary);
    try heap.endScope(nested);
    try expectError(error.InvalidHandle, heap.readStringCodeUnit(nested_handle, 0));
    try heap.release(persistent);
    try equal(@as(u16, 0xD83D), try heap.readStringCodeUnit(alias, 1));
    try equal(@as(u16, 0x0041), try heap.readStringCodeUnit(temporary, 0));
    try heap.endScope(scope);
    try expectError(error.InvalidHandle, heap.readStringCodeUnit(temporary, 0));
    try equal(@as(u16, 0x0041), try heap.readStringCodeUnit(alias, 0));

    var failed_temporary: Handle = undefined;
    try expectError(error.SimulatedRequestAbort, failedStringRequest(&heap, alias, &failed_temporary));
    try expectError(error.InvalidHandle, heap.readStringCodeUnit(failed_temporary, 0));
    try equal(@as(u16, 0x0041), try heap.readStringCodeUnit(alias, 0));

    const scalar = try heap.create(9, 1, 1, .persistent);
    try heap.setEdge(scalar, 0, alias);
    try heap.release(alias);
    try heap.collect();
    const via_edge = (try heap.retainEdge(scalar, 0, .persistent)).?;
    try equal(@as(u16, 0xD83D), try heap.readStringCodeUnit(via_edge, 1));
    try heap.release(via_edge);
    try heap.release(scalar);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "string handles reject foreign stale released destroyed and copied owner" {
    var left = Heap.init(std.testing.allocator);
    var right = Heap.init(std.testing.allocator);
    defer right.deinit() catch unreachable;
    const left_handle = try left.createString(&[_]u16{0x0041}, .persistent);
    const right_handle = try right.createString(&[_]u16{0x0042}, .persistent);
    try expectError(error.InvalidHandle, right.readStringCodeUnit(left_handle, 0));
    try expectError(error.InvalidHandle, left.readStringCodeUnit(right_handle, 0));
    var copy = left;
    try expectError(error.InvalidOwner, copy.stringLength(left_handle));
    try left.release(left_handle);
    try expectError(error.InvalidHandle, left.stringLength(left_handle));
    const replacement = try left.createString(&[_]u16{0x0043}, .persistent);
    try expectError(error.InvalidHandle, left.stringLength(left_handle));
    var bad = replacement;
    bad.slot = std.math.maxInt(usize);
    try expectError(error.InvalidHandle, left.stringLength(bad));
    bad = replacement;
    bad.generation += 1;
    try expectError(error.InvalidHandle, left.readStringCodeUnit(bad, 0));
    try left.deinit();
    try expectError(error.HeapDestroyed, left.stringLength(replacement));
    try expectError(error.InvalidOwner, copy.deinit());
}

fn stringAllocationPaths(allocator: std.mem.Allocator) !void {
    var heap = Heap.init(allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    defer heap.endScope(scope) catch unreachable;
    const handle = try heap.createString(&[_]u16{ 0xD83D, 0xDE00, 0x0041 }, .temporary);
    const retained = try heap.retain(handle, .persistent);
    const scalar = try heap.create(3, 1, 1, .persistent);
    try heap.setEdge(scalar, 0, handle);
    const via_edge = (try heap.retainEdge(scalar, 0, .temporary)).?;
    while (true) {
        const stats = try managed.testing.rootStats(&heap);
        if (stats.count == stats.capacity) break;
        _ = try heap.retain(handle, .persistent);
    }
    _ = try heap.retain(handle, .persistent);
    var buffer: [16]u8 = undefined;
    try equal(@as(usize, 5), try heap.copyStringBytes(handle, buffer[0..]));
    try equal(@as(usize, 3), try heap.stringLength(handle));
    try equal(@as(u16, 0xD83D), try heap.readStringCodeUnit(handle, 0));
    try equal(@as(u16, 0x0041), try heap.readStringCodeUnit(via_edge, 2));
    try heap.collect();
    try equal(@as(u16, 0xDE00), try heap.readStringCodeUnit(retained, 1));
    try heap.release(via_edge);
    try heap.release(retained);
    try heap.release(handle);
    try heap.release(scalar);
    try heap.collect();
}

test "every string allocation path releases all allocations" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, stringAllocationPaths, .{});
}

// Equal values are independent roots even if a future storage policy interns bytes.
test "releasing independent equal strings preserves each surviving root" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var handles: [3]Handle = undefined;
    for (0..handles.len) |i| handles[i] = try heap.createString(vectors[i + 2].units, .persistent);
    for (handles, 0..) |handle, i| try verifyString(&heap, handle, vectors[i + 2]);
    try heap.release(handles[0]);
    try expectError(error.InvalidHandle, heap.stringLength(handles[0]));
    try heap.collect();
    try verifyString(&heap, handles[1], vectors[3]);
    try verifyString(&heap, handles[2], vectors[4]);
    try heap.release(handles[1]);
    try heap.collect();
    try verifyString(&heap, handles[2], vectors[4]);
    try heap.release(handles[2]);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

const StringOperation = enum { create, retain, edge, collect };

fn attemptStringAllocation(heap: *Heap, operation: StringOperation, input: []const u16, string: Handle, holder: Handle) !?Handle {
    return switch (operation) {
        .create => try heap.createString(input, .persistent),
        .retain => try heap.retain(string, .persistent),
        .edge => (try heap.retainEdge(holder, 0, .persistent)).?,
        .collect => blk: {
            try heap.collect();
            break :blk null;
        },
    };
}

// The existing scalar transaction test cannot observe String backing copies.
// Keep this fixture local so each failed operation is checked before cleanup.
fn stringAllocationFailures(operation: StringOperation, padding: usize) !usize {
    var reached_success = false;
    var failure_count: usize = 0;
    for (0..64) |fail_offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var heap = Heap.init(failing.allocator());
        var live = true;
        defer if (live) heap.deinit() catch unreachable;
        const scope = try heap.beginScope();
        const first = try heap.createString(vectors[8].units, .persistent);
        const second = try heap.createString(vectors[2].units, .persistent);
        const temporary = try heap.retain(first, .temporary);
        const holder = try heap.create(9, 42, 2, .persistent);
        try heap.setEdge(holder, 0, first);
        try heap.setEdge(holder, 1, second);
        // Vary the live object count across real table-growth boundaries.
        var padding_roots: [16]Handle = undefined;
        for (padding_roots[0..padding]) |*root| root.* = try heap.createString(vectors[2].units, .persistent);
        var roots: [64]Handle = undefined;
        var root_count: usize = 0;
        while (true) {
            const stats = try managed.testing.rootStats(&heap);
            if (stats.count == stats.capacity) break;
            try expect(root_count < roots.len);
            roots[root_count] = try heap.retain(first, .persistent);
            root_count += 1;
        }
        const first_location = try managed.testing.location(&heap, first);
        const second_location = try managed.testing.location(&heap, second);
        const holder_location = try managed.testing.location(&heap, holder);
        const holder_value = try heap.read(holder, 9);
        const before_count = try heap.objectCount();
        const before_roots = (try managed.testing.rootStats(&heap)).count;
        const next_identity = heap.next_identity;
        var input = [_]u16{ 0xD800, 0x0041, 0xDC00, 0x0000 };
        const original_input = input;
        failing.fail_index = failing.alloc_index + fail_offset;
        failing.resize_fail_index = failing.resize_index;
        var failed = false;
        const result = attemptStringAllocation(&heap, operation, &input, first, holder) catch |err| blk: {
            try expect(err == error.OutOfMemory);
            failed = true;
            failure_count += 1;
            break :blk null;
        };
        failing.fail_index = std.math.maxInt(usize);
        failing.resize_fail_index = std.math.maxInt(usize);
        try expect(std.mem.eql(u16, &original_input, &input));
        if (failed) {
            try equal(before_count, try heap.objectCount());
            try equal(before_roots, (try managed.testing.rootStats(&heap)).count);
            try equal(next_identity, heap.next_identity);
            try equal(first_location, try managed.testing.location(&heap, first));
            try equal(second_location, try managed.testing.location(&heap, second));
            try equal(holder_location, try managed.testing.location(&heap, holder));
        } else reached_success = true;
        try std.testing.expectEqualDeep(holder_value, try heap.read(holder, 9));
        try equal(try managed.testing.location(&heap, first), (try managed.testing.edgeLocation(&heap, holder, 0)).?);
        try equal(try managed.testing.location(&heap, second), (try managed.testing.edgeLocation(&heap, holder, 1)).?);
        try verifyString(&heap, first, vectors[8]);
        try verifyString(&heap, second, vectors[2]);
        try verifyString(&heap, temporary, vectors[8]);
        for (padding_roots[0..padding]) |root| try verifyString(&heap, root, vectors[2]);
        for (roots[0..root_count]) |root| try verifyString(&heap, root, vectors[8]);
        if (result) |handle| {
            if (operation == .create) {
                for (original_input, 0..) |unit, index| try equal(unit, try heap.readStringCodeUnit(handle, index));
            } else try verifyString(&heap, handle, vectors[8]);
            try heap.release(handle);
        }
        // A failed allocation must leave the same heap usable for roots, edges and GC.
        const recovered = (try heap.retainEdge(holder, 0, .persistent)).?;
        try verifyString(&heap, recovered, vectors[8]);
        try heap.release(recovered);
        try heap.write(holder, 9, 43);
        try heap.collect();
        try equal(@as(u64, 43), (try heap.read(holder, 9)).scalar);
        try verifyString(&heap, first, vectors[8]);
        try verifyString(&heap, second, vectors[2]);
        try equal(try managed.testing.location(&heap, first), (try managed.testing.edgeLocation(&heap, holder, 0)).?);
        try equal(try managed.testing.location(&heap, second), (try managed.testing.edgeLocation(&heap, holder, 1)).?);
        try heap.endScope(scope);
        try expectError(error.InvalidHandle, heap.stringLength(temporary));
        try verifyString(&heap, first, vectors[8]);
        try heap.deinit();
        live = false;
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (reached_success) break;
    }
    try expect(reached_success);
    try expect(failure_count > 0);
    std.debug.print("String transaction {s} padding {d}: {d} injected OOM points, success reached\n", .{ @tagName(operation), padding, failure_count });
    return failure_count;
}

test "string create retain edge-retain and collection OOM preserve existing state" {
    var object_growth_observed = false;
    for (0..16) |padding| {
        if (try stringAllocationFailures(.create, padding) > 3) object_growth_observed = true;
    }
    try expect(object_growth_observed);
    inline for (.{ StringOperation.retain, StringOperation.edge, StringOperation.collect }) |operation| {
        _ = try stringAllocationFailures(operation, 0);
    }
}
