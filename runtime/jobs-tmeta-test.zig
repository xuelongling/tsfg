// SPDX-License-Identifier: MIT
const std = @import("std");
const jobs = @import("jobs.zig");
const A = std.testing.allocator;
const T = jobs.query_tmeta;
const unused_expected: T.Expected = .{
    .payloadHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    .inputIdentity = "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    .packageId = "sha256:0000000000000000000000000000000000000000000000000000000000000000",
};

// Called only with whole actual producer fixtures and independently cold-verified expected identities.
fn exerciseProducer(bytes: []const u8, expected: T.Expected, shared_required: bool) !void {
    var document = try T.Document.load(A, bytes, expected);
    var document_live = true;
    defer if (document_live) document.deinit();
    try std.testing.expect(document.payload.entries.len > 0);
    if (bytes.len > 1048576) {
        const body = try std.json.Stringify.valueAlloc(A, document.payload, .{});
        defer A.free(body);
        try std.testing.expect(body.len > 1048576);
    }
    const entry = document.payload.entries[0];
    var store = try jobs.Store.init(A, &document.component_layout, 2);
    defer store.deinit() catch unreachable;
    const archetype = try store.addArchetype(document.component_layout.payload.components);
    for (0..3) |_| _ = try store.create(archetype, &.{});
    const selection = try A.alloc(jobs.Selection, entry.columns.len);
    defer A.free(selection);
    for (selection, entry.columns) |*item, column| item.* = .{ .component = column.componentType, .access = column.access };
    const query = try store.query(selection);
    var released = false;
    defer if (!released) query.release() catch unreachable;
    try std.testing.expectEqual(@as(usize, 2), try query.batchCount());
    const batch = try query.batch(0);
    const scalars = try A.alloc(T.ScalarValue, entry.scalars.len);
    defer A.free(scalars);
    for (scalars, entry.scalars, 0..) |*scalar, formal, index| scalar.* = if (std.mem.eql(u8, formal.type, "f64")) .{ .float64 = @as(f64, @floatFromInt(index)) + 16777217.25 } else .{ .float32 = @as(f32, @floatFromInt(index)) + 0.5 };
    var plan = try document.bind(A, &store, batch, 0, scalars);
    defer plan.deinit();
    try std.testing.expectEqual(@as(usize, 2), (try plan.argument(0)).row_count);
    try std.testing.expectEqualStrings(expected.payloadHash, plan.metadata_hash);
    try std.testing.expectEqualStrings(document.payload.effects, plan.effects);
    try std.testing.expectEqual(entry.loop, plan.loop);
    try std.testing.expectEqualStrings(entry.sourceFunctionId, plan.source_function_id);
    try std.testing.expectEqualStrings(entry.signatureHash, plan.signature_hash);
    for (entry.columns, 0..) |column, index| {
        const descriptor = (try plan.argument(column.bufferArgument)).column;
        try std.testing.expectEqualStrings(column.componentType, descriptor.component);
        try std.testing.expectEqual(@as(usize, column.stride), (try plan.argument(column.strideArgument)).stride);
        try std.testing.expectEqual(@intFromPtr((try batch.read(index)).ptr), @intFromPtr((try plan.readTuple(findTuple(entry, index))).ptr));
    }
    for (entry.scalars, 0..) |scalar, index| {
        const original = scalars[index];
        try std.testing.expect(std.meta.eql(original, (try plan.argument(scalar.argument)).scalar));
        scalars[index] = if (std.mem.eql(u8, scalar.type, "f64")) .{ .float64 = -100 } else .{ .float32 = -100 };
        try std.testing.expect(std.meta.eql(original, (try plan.argument(scalar.argument)).scalar));
        const wrong: T.ScalarValue = if (std.mem.eql(u8, scalar.type, "f64")) .{ .float32 = 1 } else .{ .float64 = 1 };
        const saved = scalars[index];
        scalars[index] = wrong;
        try std.testing.expectError(error.BindingMismatch, document.bind(A, &store, batch, 0, scalars));
        scalars[index] = saved;
    }
    var shared = false;
    for (entry.tupleOccurrences, 0..) |tuple, index| {
        if (tuple.mode == .read) try std.testing.expectError(error.ReadOnly, plan.writeTuple(index));
        for (entry.tupleOccurrences, 0..) |other, other_index| {
            if (tuple.columnIndex == other.columnIndex and tuple.mode == .read and other.mode == .write) {
                shared = true;
                const read = try plan.readTuple(index);
                const write = try plan.writeTuple(other_index);
                try std.testing.expectEqual(@intFromPtr(read.ptr), @intFromPtr(write.ptr));
                write[0] = 42;
                try std.testing.expectEqual(@as(u8, 42), read[0]);
            }
        }
    }
    if (shared_required) try std.testing.expect(shared);
    const too_many = try A.alloc(T.ScalarValue, scalars.len + 1);
    defer A.free(too_many);
    try std.testing.expectError(error.BindingMismatch, document.bind(A, &store, batch, 0, too_many));
    try std.testing.expectError(error.BindingMismatch, document.bind(A, &store, batch, document.payload.entries.len, scalars));
    try std.testing.expectError(error.BorrowConflict, store.deinit());
    var other_store = try jobs.Store.init(A, &document.component_layout, 2);
    defer other_store.deinit() catch unreachable;
    try std.testing.expectError(error.WrongStore, document.bind(A, &other_store, batch, 0, scalars));
    const other_archetype = try other_store.addArchetype(document.component_layout.payload.components);
    _ = try other_store.create(other_archetype, &.{});
    var changed = try A.dupe(jobs.Selection, selection);
    defer A.free(changed);
    changed[0].access = if (changed[0].access == .read) .write else .read;
    const wrong_access = try other_store.query(changed);
    defer wrong_access.release() catch unreachable;
    try std.testing.expectError(error.BindingMismatch, document.bind(A, &other_store, try wrong_access.batch(0), 0, scalars));
    var old_layout = try jobs.layout.Layout.load(A, @embedFile("jobs/testdata/component-layout.json"), .{
        .inputIdentity = "sha256:99a382a6b51842afce62faaecb7a14631aba5f82a7757582e5a7720bcfb1177e",
        .hirDigest = "sha256:9566fbc77c052dbfbc2d9fc5d69ccb626c6399b564c6ba34eb683a102a0d2654",
    });
    defer old_layout.deinit();
    var wrong_layout = try jobs.Store.init(A, &old_layout, 2);
    defer wrong_layout.deinit() catch unreachable;
    const old_archetype = try wrong_layout.addArchetype(old_layout.payload.components);
    _ = try wrong_layout.create(old_archetype, &.{});
    const old_query = try wrong_layout.query(&.{.{ .component = old_layout.payload.components[0], .access = .read }});
    defer old_query.release() catch unreachable;
    try std.testing.expectError(error.IdentityMismatch, document.bind(A, &wrong_layout, try old_query.batch(0), 0, scalars));
    try structuralNegatives(&document, expected);
    for (selection, plan.columns) |*item, column| item.component = column.component;
    document.deinit();
    document_live = false;
    try std.testing.expectEqualStrings(expected.inputIdentity, plan.input_identity);
    try std.testing.expectEqual(@as(usize, 2), (try plan.argument(0)).row_count);
    _ = try plan.readTuple(0);
    try query.release();
    released = true;
    const fresh = try store.query(selection);
    defer fresh.release() catch unreachable;
    try std.testing.expectError(error.InvalidLease, plan.argument(0));
    try std.testing.expectError(error.InvalidLease, plan.readTuple(0));
}

fn findTuple(entry: T.Entry, column: usize) usize {
    for (entry.tupleOccurrences, 0..) |tuple, index| if (tuple.columnIndex == column) return index;
    unreachable;
}

fn structuralNegatives(document: *const T.Document, expected: T.Expected) !void {
    var changed_expected = expected;
    changed_expected.packageId = unused_expected.packageId;
    // A complete original artifact still has to match the external cold-reader identity.
    const original = try encodePayload(document.payload);
    defer A.free(original.bytes);
    try std.testing.expectError(error.IdentityMismatch, T.Document.load(A, original.bytes, changed_expected));
    var payload = document.payload;
    const entries = try A.dupe(T.Entry, payload.entries);
    defer A.free(entries);
    payload.entries = entries;
    const columns = try A.dupe(T.Column, entries[0].columns);
    defer A.free(columns);
    entries[0].columns = columns;
    columns[0].stride += 1;
    try expectStructuralRejection(payload, expected);
    columns[0] = document.payload.entries[0].columns[0];
    columns[0].access = if (columns[0].access == .read) .write else .read;
    try expectStructuralRejection(payload, expected);
    columns[0] = document.payload.entries[0].columns[0];
    columns[0].sourceComponentType = columns[0].componentType;
    try expectStructuralRejection(payload, expected);
    columns[0] = document.payload.entries[0].columns[0];
    const tuples = try A.dupe(T.Tuple, entries[0].tupleOccurrences);
    defer A.free(tuples);
    entries[0].tupleOccurrences = tuples;
    tuples[0].bufferArgument += 1;
    try expectStructuralRejection(payload, expected);
    tuples[0] = document.payload.entries[0].tupleOccurrences[0];
    tuples[0].tupleIndex += 1;
    try expectStructuralRejection(payload, expected);
    tuples[0] = document.payload.entries[0].tupleOccurrences[0];
    entries[0].entrySymbol = "another_entry";
    try expectStructuralRejection(payload, expected);
}

fn expectStructuralRejection(payload: T.Payload, expected: T.Expected) !void {
    const negative = try encodePayload(payload);
    defer A.free(negative.bytes);
    var negative_expected = expected;
    negative_expected.payloadHash = &negative.hash;
    // Deliberately recomputed identity is a negative control, never a cold-verified producer receipt.
    try std.testing.expectError(error.InvalidMetadata, T.Document.load(A, negative.bytes, negative_expected));
}

fn encodePayload(payload: T.Payload) !struct { bytes: []u8, hash: [71]u8 } {
    const body = try std.json.Stringify.valueAlloc(A, payload, .{});
    defer A.free(body);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("tsfg.query-tmeta.v2\x00");
    hash.update(body);
    var value: [32]u8 = undefined;
    hash.final(&value);
    var rendered: [71]u8 = undefined;
    @memcpy(rendered[0..7], "sha256:");
    const hex = std.fmt.bytesToHex(value, .lower);
    @memcpy(rendered[7..], &hex);
    const envelope = try std.json.Stringify.valueAlloc(A, .{ .family = "tsfg.query-tmeta", .payload = body, .payloadHash = @as([]const u8, &rendered), .schemaHash = T.schema_hash, .version = @as(u32, 2) }, .{});
    defer A.free(envelope);
    return .{ .bytes = try std.mem.concat(A, u8, &.{ envelope, "\n" }), .hash = rendered };
}

test "Query metadata rejects malformed and wrong-version unknown bytes before binding" {
    try std.testing.expectError(error.InvalidMetadata, T.Document.load(A, "", unused_expected));
    try std.testing.expectError(error.InvalidMetadata, T.Document.load(A, "{}\n", unused_expected));
    const wrong_version = "{\"family\":\"tsfg.query-tmeta\",\"payload\":\"{}\",\"payloadHash\":\"sha256:0000000000000000000000000000000000000000000000000000000000000000\",\"schemaHash\":\"" ++ T.schema_hash ++ "\",\"version\":1}\n";
    try std.testing.expectError(error.InvalidMetadata, T.Document.load(A, wrong_version, unused_expected));
    const deep = "[" ** 129 ++ "]" ** 129 ++ "\n";
    try std.testing.expectError(error.MetadataLimit, T.Document.load(A, deep, unused_expected));
}

test "actual parenthesized producer metadata binds its original Store batch and scalars" {
    try exerciseFixture("parenthesized", false);
}
test "actual repeated read and write occurrences share one borrowed component column" {
    try exerciseFixture("shared", true);
}
test "actual above1MiB producer payload passes the same owning reader and batch binding" {
    try exerciseFixture("large", false);
}
test "actual f64 and f32 producer scalars bind independently without narrowing" {
    try exerciseFixture("f64-mixed", false);
}
test "actual f64 view helper metadata retains its original borrowed batch" {
    try exerciseFixture("f64-helper", false);
}
test "actual producer Layout releases arena growth without resize" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-parenthesized-receipt.json"), .{});
    defer receipt.deinit();
    // This original producer reaches a new catalog arena block after20 successful resizes.
    // The backing arena also cleans up the old-boundary negative control's lost block.
    var backing = std.heap.ArenaAllocator.init(A);
    defer backing.deinit();
    var no_resize = std.testing.FailingAllocator.init(backing.allocator(), .{ .resize_fail_index = 20 });
    var document = try T.Document.load(no_resize.allocator(), @embedFile("jobs/testdata/query-tmeta-parenthesized.tmeta"), receipt.value);
    document.deinit();
    try std.testing.expectEqual(@as(usize, 20), no_resize.resize_index);
    try std.testing.expect(no_resize.allocations > 1);
    try std.testing.expectEqual(no_resize.allocations, no_resize.deallocations);
    try std.testing.expectEqual(no_resize.allocated_bytes, no_resize.freed_bytes);
}
fn exerciseFixture(comptime name: []const u8, shared: bool) !void {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-" ++ name ++ "-receipt.json"), .{});
    defer receipt.deinit();
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-" ++ name ++ ".tmeta"), receipt.value, shared);
}

test "Query metadata explicitly admits strings above1MiB up to its own boundary without granting identity" {
    const payload = try A.alloc(u8, 1048577);
    defer A.free(payload);
    @memset(payload, 'x');
    const envelope = try std.json.Stringify.valueAlloc(A, .{ .family = "tsfg.query-tmeta", .payload = @as([]const u8, payload), .payloadHash = "sha256:" ++ "1" ** 64, .schemaHash = T.schema_hash, .version = @as(u32, 2) }, .{});
    defer A.free(envelope);
    const bytes = try std.mem.concat(A, u8, &.{ envelope, "\n" });
    defer A.free(bytes);
    // Reaching external identity mismatch proves parsing the large string succeeded.
    try std.testing.expectError(error.IdentityMismatch, T.Document.load(A, bytes, unused_expected));
    const excessive = try A.alloc(u8, 8388609);
    defer A.free(excessive);
    @memset(excessive, ' ');
    excessive[excessive.len - 1] = '\n';
    try std.testing.expectError(error.InvalidMetadata, T.Document.load(A, excessive, unused_expected));
}

test "Store batch directory and release retain the original borrowed session" {
    var source = try jobs.layout.Layout.load(A, @embedFile("jobs/testdata/component-layout.json"), .{
        .inputIdentity = "sha256:99a382a6b51842afce62faaecb7a14631aba5f82a7757582e5a7720bcfb1177e",
        .hirDigest = "sha256:9566fbc77c052dbfbc2d9fc5d69ccb626c6399b564c6ba34eb683a102a0d2654",
    });
    defer source.deinit();
    var store = try jobs.Store.init(A, &source, 2);
    defer store.deinit() catch unreachable;
    try std.testing.expectEqualStrings(&source.payload_hash, &store.layout_identity);
    const archetype = try store.addArchetype(source.payload.components);
    _ = try store.create(archetype, &.{});
    const selected = source.payload.components[0];
    const query = try store.query(&.{.{ .component = selected, .access = .read }});
    const batch = try query.batch(0);
    try std.testing.expectEqual(@as(usize, 1), try batch.columnCount());
    const pointer = @intFromPtr((try batch.read(0)).ptr);
    try std.testing.expectEqual(pointer, @intFromPtr((try batch.read(0)).ptr));
    try batch.release();
    const fresh = try store.query(&.{.{ .component = selected, .access = .write }});
    defer fresh.release() catch unreachable;
    try std.testing.expectError(error.InvalidLease, batch.columnCount());
}

test {
    _ = @import("jobs-effects-test.zig");
    _ = @import("jobs-query-test.zig");
    _ = @import("jobs-test.zig");
    _ = @import("jobs-layout-test.zig");
}
