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

const ProducerFixture = enum { copy, copy_conflict, compound, literal, f32_view, inheritance };

// Called only with whole actual producer fixtures and independently cold-verified expected identities.
fn exerciseProducer(bytes: []const u8, expected: T.Expected, shared_required: bool, producer_fixture: ?ProducerFixture) !void {
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
    const query = try document.query(A, &store, 0);
    var released = false;
    defer if (!released) query.release() catch unreachable;
    try std.testing.expectEqual(@as(usize, 2), try query.batchCount());
    const batch = try query.batch(0);
    const scalars = try A.alloc(T.ScalarValue, entry.scalars.len);
    defer A.free(scalars);
    for (scalars, entry.scalars, 0..) |*scalar, formal, index| scalar.* = if (std.mem.eql(u8, formal.type, "f64")) .{ .float64 = @as(f64, @floatFromInt(index)) + 16777217.25 } else .{ .float32 = @as(f32, @floatFromInt(index)) + 0.5 };
    const checked_system = document.effects.system(entry.logicalFunctionId) orelse return error.TestUnexpectedResult;
    const original_loop = try std.json.Stringify.valueAlloc(A, checked_system.loops[entry.loop], .{});
    defer A.free(original_loop);
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
    if (producer_fixture == .f32_view) {
        try expectF32ViewBinding(&document, entry, &plan);
    } else if (producer_fixture == .inheritance) {
        try expectInheritanceBinding(&document, &plan, batch);
    } else if (producer_fixture) |fixture| {
        const system_count: usize = if (fixture == .copy_conflict) 2 else 1;
        var destination: ?*const jobs.layout.Type = null;
        var source: ?*const jobs.layout.Type = null;
        var integer: ?*const jobs.layout.Type = null;
        for (document.component_layout.payload.types) |*row| {
            if (std.mem.eql(u8, row.name, "CopyDestination")) destination = row;
            if (std.mem.eql(u8, row.name, "CopySource")) source = row;
            if (row.kind == .scalar and std.mem.eql(u8, row.scalar, "i32")) integer = row;
        }
        try std.testing.expect(destination != null and source != null and integer != null);
        const dst = destination.?;
        const src = source.?;
        try std.testing.expectEqual(jobs.layout.Kind.component, dst.kind);
        try std.testing.expectEqual(jobs.layout.Kind.component, src.kind);
        try std.testing.expectEqual(@as(u32, 4), integer.?.byteSize);
        try std.testing.expectEqual(@as(u32, 8), dst.byteSize);
        try std.testing.expectEqual(@as(u32, 8), dst.stride);
        try std.testing.expectEqual(@as(u32, 4), src.byteSize);
        try std.testing.expectEqual(@as(u32, 4), src.stride);
        try std.testing.expectEqual(@as(usize, 2), dst.fields.len);
        try std.testing.expectEqual(@as(usize, 1), src.fields.len);
        try std.testing.expectEqualStrings("n", dst.fields[1].name);
        try std.testing.expectEqualStrings("n", src.fields[0].name);
        try std.testing.expectEqualStrings(integer.?.id, dst.fields[1].type);
        try std.testing.expectEqualStrings(integer.?.id, src.fields[0].type);
        try std.testing.expectEqual(@as(u32, 4), dst.fields[1].offset);
        try std.testing.expectEqual(@as(u32, 0), src.fields[0].offset);
        try std.testing.expectEqual(system_count, document.payload.entries.len);
        for (document.payload.entries, 0..) |i32_entry, entry_index| {
            try std.testing.expectEqual(@as(usize, 0), i32_entry.scalars.len);
            try std.testing.expectEqual(@as(usize, 2), i32_entry.columns.len);
            try std.testing.expectEqual(@as(usize, 2), i32_entry.tupleOccurrences.len);
            var i32_plan = try document.bind(A, &store, batch, entry_index, &.{});
            defer i32_plan.deinit();
            try std.testing.expectEqualStrings(i32_entry.logicalFunctionId, i32_plan.logical_function_id);
            var writes: usize = 0;
            var reads: usize = 0;
            for (i32_entry.tupleOccurrences, 0..) |tuple, tuple_index| {
                const column = i32_entry.columns[tuple.columnIndex];
                const backing = try batch.read(tuple.columnIndex);
                const borrowed = try i32_plan.readTuple(tuple_index);
                try std.testing.expectEqual(@intFromPtr(backing.ptr), @intFromPtr(borrowed.ptr));
                try std.testing.expectEqual(backing.len, borrowed.len);
                if (std.mem.eql(u8, column.componentType, dst.id)) {
                    writes += 1;
                    try std.testing.expectEqual(jobs.Access.write, tuple.mode);
                    try std.testing.expectEqual(@as(u32, 8), column.stride);
                    try std.testing.expectEqual(@as(usize, 16), borrowed.len);
                    const writable = try i32_plan.writeTuple(tuple_index);
                    try std.testing.expectEqual(@intFromPtr(backing.ptr), @intFromPtr(writable.ptr));
                    // The sentinel checks write access at the nonzero field offset.
                    const sentinel = [_]u8{ 0x81, 0x00, 0xfe, 0x7f };
                    @memcpy(writable[4..8], &sentinel);
                    try std.testing.expectEqualSlices(u8, &sentinel, borrowed[4..8]);
                    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 4), borrowed[0..4]);
                    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 8), borrowed[8..16]);
                } else {
                    reads += 1;
                    try std.testing.expectEqualStrings(src.id, column.componentType);
                    try std.testing.expectEqual(jobs.Access.read, tuple.mode);
                    try std.testing.expectEqual(@as(u32, 4), column.stride);
                    try std.testing.expectEqual(@as(usize, 8), borrowed.len);
                    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 8), borrowed);
                    try std.testing.expectError(error.ReadOnly, i32_plan.writeTuple(tuple_index));
                }
            }
            try std.testing.expectEqual(@as(usize, 1), writes);
            try std.testing.expectEqual(@as(usize, 1), reads);
        }
        const systems = document.effects.report.systems;
        try std.testing.expectEqual(system_count, systems.len);
        if (fixture == .compound or fixture == .literal) {
            try expectProducerInputs(document.payload, if (fixture == .compound) .{
                "15b61f2629dc0a5f5b4cf236f5b584462481fe3d7eef5740f51aa3f3934a803a",
                "8ec279d5f9a3887c0b3be3bd996461db38fd6ccdc4fd0e1563e6a6ed32867937",
                "5276dc35b780e6f773f79a79ecccd81a4a5b8d1b3f76d1f56b8f53d9371c730e",
            } else .{
                "608871bee13bc30e7e4aec5d3ed8753f6b2312a7ebdaae432f02378df85d515b",
                "7d0b17c43c908e2145c804935ab213acb9971b19b1ee588b3e2f911aa98e2a89",
                "1f863b3cb80a83fc1c2659a2d10bced03c2715e2fc8e471cd219367b50269a7a",
            });
            try std.testing.expectEqual(@as(usize, 1), systems[0].loops.len);
            try std.testing.expectEqualStrings(systems[0].functionId, entry.logicalFunctionId);
            const operations = systems[0].loops[0].operations;
            // UTF-16 ranges from the respective retained Source oracles.
            const Operation = struct { kind: jobs.Access, tuple_index: u32, start: u32, end: u32 };
            const order: []const Operation = if (fixture == .compound) &.{
                .{ .kind = .read, .tuple_index = 0, .start = 368, .end = 373 },
                .{ .kind = .read, .tuple_index = 1, .start = 377, .end = 382 },
                .{ .kind = .write, .tuple_index = 0, .start = 368, .end = 382 },
            } else &.{
                .{ .kind = .write, .tuple_index = 0, .start = 368, .end = 387 },
                .{ .kind = .write, .tuple_index = 0, .start = 393, .end = 412 },
            };
            try std.testing.expectEqual(order.len, operations.len);
            for (operations, order) |operation, wanted| {
                const destination_tuple = wanted.tuple_index == 0;
                const component = if (destination_tuple) dst else src;
                const field_index: usize = if (destination_tuple) 1 else 0;
                const field = component.fields[field_index];
                try std.testing.expectEqual(wanted.kind, operation.kind);
                try std.testing.expectEqual(wanted.tuple_index, operation.tupleIndex);
                try std.testing.expectEqualStrings(component.id, operation.componentType);
                try std.testing.expectEqualStrings(field.id, operation.field);
                try std.testing.expectEqualStrings(entry.tupleOccurrences[wanted.tuple_index].sourceBinding, operation.sourceBinding);
                try std.testing.expectEqualStrings("/src/main.ts", operation.source.path);
                try std.testing.expectEqual(wanted.start, operation.source.start);
                try std.testing.expectEqual(wanted.end, operation.source.end);
                try std.testing.expectEqual(@as(usize, 0), operation.callPath.len);
            }
            if (fixture == .literal) try expectI32LiteralFacts(document.payload.sourcePacket);
        }
        if (system_count == 2) {
            try std.testing.expect(!std.mem.eql(u8, systems[0].functionId, systems[1].functionId));
            try std.testing.expectEqual(@as(usize, 1), document.effects.report.conflicts.len);
            const forward = try document.effects.conflictComponents(systems[0].functionId, systems[1].functionId);
            const reverse = try document.effects.conflictComponents(systems[1].functionId, systems[0].functionId);
            try std.testing.expectEqual(@as(usize, 1), forward.len);
            try std.testing.expectEqual(@as(usize, 1), reverse.len);
            try std.testing.expectEqualStrings(dst.id, forward[0]);
            try std.testing.expectEqualStrings(dst.id, reverse[0]);
            try std.testing.expect(!std.mem.eql(u8, src.id, forward[0]));
        } else {
            try std.testing.expectEqual(@as(usize, 0), document.effects.report.conflicts.len);
        }
    }
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
    const selection = try A.alloc(jobs.Selection, plan.columns.len);
    defer A.free(selection);
    for (selection, plan.columns) |*item, column| item.* = .{ .component = column.component, .access = column.access };
    const correct_access = selection[0].access;
    selection[0].access = if (correct_access == .read) .write else .read;
    const wrong_access = try other_store.query(selection);
    defer wrong_access.release() catch unreachable;
    try std.testing.expectError(error.BindingMismatch, document.bind(A, &other_store, try wrong_access.batch(0), 0, scalars));
    selection[0].access = correct_access;
    var old_layout = try jobs.layout.Layout.load(A, @embedFile("jobs/testdata/component-layout.json"), .{
        .inputIdentity = "sha256:99a382a6b51842afce62faaecb7a14631aba5f82a7757582e5a7720bcfb1177e",
        .hirDigest = "sha256:d347ff9a236976c1b537870ca2eaade5da668b996be5be06d00dc1b80b45a6e4",
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
    document.deinit();
    document_live = false;
    const owned_loop = try std.json.Stringify.valueAlloc(A, plan.loop_effects, .{});
    defer A.free(owned_loop);
    try std.testing.expectEqualStrings(original_loop, owned_loop);
    try std.testing.expectEqualStrings(expected.inputIdentity, plan.input_identity);
    try std.testing.expectEqual(@as(usize, 2), (try plan.argument(0)).row_count);
    _ = try plan.readTuple(0);
    try std.testing.expectError(error.BindingMismatch, plan.readTuple(plan.tuples.len));
    try std.testing.expectError(error.BindingMismatch, plan.writeTuple(plan.tuples.len));
    try query.release();
    released = true;
    const fresh = try store.query(selection);
    defer fresh.release() catch unreachable;
    try std.testing.expectError(error.InvalidLease, plan.argument(0));
    for (0..plan.tuples.len) |index| {
        try std.testing.expectError(error.InvalidLease, plan.writeTuple(index));
        try std.testing.expectError(error.InvalidLease, plan.readTuple(index));
    }
    try std.testing.expectError(error.InvalidLease, plan.readTuple(plan.tuples.len));
    try std.testing.expectError(error.InvalidLease, plan.writeTuple(plan.tuples.len));
}

// Digests are from the independently retained batch, Source facts and Source request.
fn expectProducerInputs(payload: T.Payload, digests: [3][]const u8) !void {
    const inputs = [_][]const u8{ payload.batch, payload.sourcePacket, payload.sourceRequest };
    for (inputs, digests) |input, expected_hash| {
        var hash: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(input, &hash, .{});
        try std.testing.expectEqualStrings(expected_hash, &std.fmt.bytesToHex(hash, .lower));
    }
}

fn expectF32ViewBinding(document: *const T.Document, entry: T.Entry, plan: *const T.Plan) !void {
    try expectProducerInputs(document.payload, .{
        "33de722b859c08d84e08669333eca9084641be6a8ac7e14f157e80cfd8910e4b",
        "379d840fbe0cba553731af74927211fec6e9802b87a86aa7392e60f3decbc291",
        "375fcf0db5d43d591462d6b0f98e4aa0c8f518cbe8ae0cc33396ff58ce235001",
    });
    try std.testing.expectEqual(@as(usize, 1), document.payload.entries.len);
    try std.testing.expectEqual(@as(usize, 2), entry.tupleOccurrences.len);
    try std.testing.expectEqual(@as(usize, 1), entry.scalars.len);
    const dt = entry.scalars[0];
    try std.testing.expectEqual(@as(u32, 1), dt.sourceParameter);
    try std.testing.expectEqualStrings("sha256:e36773f38a1f006954680546e7196037668a45b0e8ef3f9dc2c1f3e6e08f8b9f", dt.sourceBinding);
    try std.testing.expectEqual(@as(u32, 5), dt.argument);
    try std.testing.expectEqual(@as(f32, 0.5), (try plan.argument(5)).scalar.float32);

    const systems = document.effects.report.systems;
    try std.testing.expectEqual(@as(usize, 1), systems.len);
    try std.testing.expectEqual(@as(usize, 1), systems[0].loops.len);
    const loop = systems[0].loops[0];
    try std.testing.expectEqual(@as(usize, 1), loop.calls.len);
    const call = loop.calls[0];
    try std.testing.expectEqualDeep(T.Source{ .path = "/src/main.ts", .start = 323, .end = 337 }, call.source);
    try std.testing.expectEqualDeep(T.Source{ .path = "/src/main.ts", .start = 323, .end = 329 }, call.calleeSource);
    // update reads p.x, reads v.x, then writes p.x on the original bound tuples.
    const position_x = "sha256:229cc76f801c19a2e92c8318a81b7ddc139a6199dd1c3732d01daa45b15dd95b";
    const velocity_x = "sha256:cfb4509e0896869ec005947fe723d03e7f37c4cfc00dc4c987d301a65b36a4a6";
    const order = [_]struct { kind: jobs.Access, tuple_index: u32, start: u32, end: u32, field: []const u8 }{
        .{ .kind = .read, .tuple_index = 0, .start = 592, .end = 595, .field = position_x },
        .{ .kind = .read, .tuple_index = 1, .start = 611, .end = 614, .field = velocity_x },
        .{ .kind = .write, .tuple_index = 0, .start = 634, .end = 643, .field = position_x },
    };
    try std.testing.expect(loop.operations.len >= 1 + order.len);
    for (loop.operations[1..][0..order.len], order) |operation, wanted| {
        try std.testing.expectEqual(@as(usize, 1), operation.callPath.len);
        try std.testing.expectEqualDeep(call, operation.callPath[0]);
        try std.testing.expectEqualDeep(T.Source{ .path = "/src/main.ts", .start = wanted.start, .end = wanted.end }, operation.source);
        try std.testing.expectEqual(wanted.kind, operation.kind);
        try std.testing.expectEqual(wanted.tuple_index, operation.tupleIndex);
        try std.testing.expectEqualStrings(wanted.field, operation.field);
        const tuple = entry.tupleOccurrences[wanted.tuple_index];
        const column = (try plan.argument(tuple.bufferArgument)).column;
        try std.testing.expectEqualStrings(operation.sourceBinding, tuple.sourceBinding);
        try std.testing.expectEqualStrings(operation.componentType, column.component);
        const expected_access: jobs.Access = if (wanted.tuple_index == 0) .write else .read;
        try std.testing.expectEqual(expected_access, tuple.mode);
        try std.testing.expectEqual(expected_access, column.access);
    }
    // The writable helper receiver still reaches the same Store bytes.
    try std.testing.expectEqual(@intFromPtr((try plan.readTuple(0)).ptr), @intFromPtr((try plan.writeTuple(0)).ptr));
}

fn expectI32LiteralFacts(bytes: []const u8) !void {
    const Literal = struct { decimal: []const u8, flowType: []const u8, kind: []const u8, range: jobs.layout.Range, token: []const u8, type: []const u8 };
    const Statement = struct { value: struct { kind: []const u8, operator: []const u8, value: Literal } };
    const Packet = struct { payload: struct { systems: []const struct { loops: []const struct { statements: []const Statement } } } };
    const facts = try std.json.parseFromSlice(Packet, A, bytes, .{ .ignore_unknown_fields = true });
    defer facts.deinit();
    const systems = facts.value.payload.systems;
    try std.testing.expectEqual(@as(usize, 1), systems.len);
    try std.testing.expectEqual(@as(usize, 1), systems[0].loops.len);
    const statements = systems[0].loops[0].statements;
    const literals = [_]struct { token: []const u8, value: i32, range: jobs.layout.Range }{
        .{ .token = "-2147483648", .value = std.math.minInt(i32), .range = .{ .start = 376, .end = 387 } },
        .{ .token = "0X7fff_ffff", .value = std.math.maxInt(i32), .range = .{ .start = 401, .end = 412 } },
    };
    try std.testing.expectEqual(literals.len, statements.len);
    for (statements, literals) |statement, expected| {
        const assignment = statement.value;
        try std.testing.expectEqualStrings("fieldAssignment", assignment.kind);
        try std.testing.expectEqualStrings("=", assignment.operator);
        const literal = assignment.value;
        try std.testing.expectEqualStrings("numericLiteral", literal.kind);
        try std.testing.expectEqualStrings("i32", literal.type);
        try std.testing.expectEqualStrings("i32", literal.flowType);
        try std.testing.expectEqualStrings(expected.token, literal.token);
        try std.testing.expectEqual(expected.value, try std.fmt.parseInt(i32, literal.decimal, 10));
        try std.testing.expectEqualDeep(expected.range, literal.range);
    }
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
    try expectMetadataRejection(error.InvalidMetadata, payload, expected);
}

fn expectMetadataRejection(wanted: anyerror, payload: T.Payload, expected: T.Expected) !void {
    const negative = try encodePayload(payload);
    defer A.free(negative.bytes);
    var negative_expected = expected;
    negative_expected.payloadHash = &negative.hash;
    // Deliberately recomputed identity is a negative control, never a cold-verified producer receipt.
    if (T.Document.load(A, negative.bytes, negative_expected)) |loaded| {
        var unexpected = loaded;
        unexpected.deinit();
        return error.TestExpectedError;
    } else |err| {
        try std.testing.expectEqual(wanted, err);
    }
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

test "actual second Query loop keeps typed effects after Document release" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-effects-double-loop-receipt.json"), .{});
    defer receipt.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-effects-double-loop.tmeta"), receipt.value);
    var document_live = true;
    defer if (document_live) document.deinit();
    const entry = document.payload.entries[1];
    const system = document.effects.system(entry.logicalFunctionId) orelse return error.TestUnexpectedResult;
    const expected = system.loops[1];
    try std.testing.expectEqual(@as(u32, 1), entry.loop);
    try std.testing.expectEqual(@as(usize, 6), expected.operations.len);
    try std.testing.expectEqualDeep(T.Source{ .path = "/src/main.ts", .start = 333, .end = 396 }, expected.source);
    const canonical_loop = try std.json.Stringify.valueAlloc(A, expected, .{});
    defer A.free(canonical_loop);
    const logical_function_id = try A.dupe(u8, entry.logicalFunctionId);
    defer A.free(logical_function_id);
    const signature_hash = try A.dupe(u8, entry.signatureHash);
    defer A.free(signature_hash);
    const code_identity: T.Plan.CodeIdentity = .{
        .metadata_hash = receipt.value.payloadHash,
        .batch_hash = "sha256:2b1b6c5b3772283c7311e3ec48296b23a4c56fe4546c28652958d58485ffb6d1",
        .entry_symbol = "batch_63f739f624e4c62125bfac010a40bdd62add8bc09ce0149b365d26c0551e1ecd_1",
        .logical_function_id = logical_function_id,
        .signature_hash = signature_hash,
        .abi_type = "(index, memref<?xi8>, index, f32) -> ()",
    };

    var store = try jobs.Store.init(A, &document.component_layout, 2);
    defer store.deinit() catch unreachable;
    const archetype = try store.addArchetype(document.component_layout.payload.components);
    for (0..3) |_| _ = try store.create(archetype, &.{});
    const query = try document.query(A, &store, 1);
    var released = false;
    defer if (!released) query.release() catch unreachable;
    var plan = try document.bind(A, &store, try query.batch(0), 1, &.{.{ .float32 = 0.5 }});
    defer plan.deinit();
    var other_batch = try document.bind(A, &store, try query.batch(1), 1, &.{.{ .float32 = 0.5 }});
    defer other_batch.deinit();
    try std.testing.expect(plan.loop_effects.operations.ptr != expected.operations.ptr);
    try std.testing.expect(plan.loop_effects.source.path.ptr != expected.source.path.ptr);
    document.deinit();
    document_live = false;

    try plan.verifyCodeIdentity(code_identity);
    var wrong_code = code_identity;
    wrong_code.batch_hash = unused_expected.payloadHash;
    try std.testing.expectError(error.IdentityMismatch, plan.verifyCodeIdentity(wrong_code));
    wrong_code = code_identity;
    wrong_code.abi_type = "(index, memref<?xi8>, index, f64) -> ()";
    try std.testing.expectError(error.IdentityMismatch, plan.verifyCodeIdentity(wrong_code));
    wrong_code = code_identity;
    wrong_code.entry_symbol = "batch_63f739f624e4c62125bfac010a40bdd62add8bc09ce0149b365d26c0551e1ecd_0";
    try std.testing.expectError(error.IdentityMismatch, plan.verifyCodeIdentity(wrong_code));

    const Call = struct {
        query: jobs.Store.Query,
        other: *const T.Plan,
        identity: T.Plan.CodeIdentity,

        fn unexpected(_: *const T.Plan, _: void) !void {
            return error.TestUnexpectedResult;
        }
        fn read(plan_to_read: *const T.Plan, rows: usize) !void {
            try std.testing.expectEqual(rows, (try plan_to_read.argument(0)).row_count);
            _ = try plan_to_read.readTuple(0);
        }
        fn checkPinned(active: *const T.Plan, context: @This()) !void {
            try std.testing.expectError(error.BorrowConflict, context.query.release());
            try std.testing.expectError(error.BorrowConflict, active.batch.release());
            try std.testing.expectError(error.BorrowConflict, active.withCheckedBatch(context.identity, {}, unexpected));
            try context.other.withCheckedBatch(context.identity, @as(usize, 1), read);
            try read(active, 2);
            return error.TestCallFailed;
        }
    };
    try std.testing.expectError(error.IdentityMismatch, plan.withCheckedBatch(wrong_code, {}, Call.unexpected));
    try std.testing.expectError(error.TestCallFailed, plan.withCheckedBatch(code_identity,
        Call{ .query = query, .other = &other_batch, .identity = code_identity }, Call.checkPinned));
    try plan.withCheckedBatch(code_identity, @as(usize, 2), Call.read);
    try std.testing.expectEqual(@as(usize, 2), (try plan.argument(0)).row_count);
    _ = try plan.readTuple(0);
    try query.release();
    released = true;
    try std.testing.expectError(error.InvalidLease, plan.readTuple(0));
    try std.testing.expectError(error.InvalidLease, plan.withCheckedBatch(code_identity, {}, Call.unexpected));
    const retained_loop = try std.json.Stringify.valueAlloc(A, plan.loop_effects, .{});
    defer A.free(retained_loop);
    try std.testing.expectEqualStrings(canonical_loop, retained_loop);
}
test "actual Query metadata opens its checked Store selection" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-v6-f32-view-receipt.json"), .{});
    defer receipt.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-v6-f32-view.tmeta"), receipt.value);
    defer document.deinit();
    const other_receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-literal-receipt.json"), .{});
    defer other_receipt.deinit();
    var other_document = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-i32-literal.tmeta"), other_receipt.value);
    defer other_document.deinit();
    var other_store = try jobs.Store.init(A, &other_document.component_layout, 2);
    defer other_store.deinit() catch unreachable;
    try std.testing.expectError(error.IdentityMismatch, document.query(A, &other_store, 0));

    var store = try jobs.Store.init(A, &document.component_layout, 2);
    defer store.deinit() catch unreachable;
    try std.testing.expectError(error.BindingMismatch, document.query(A, &store, document.payload.entries.len));
    var failing = std.testing.FailingAllocator.init(A, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, document.query(failing.allocator(), &store, 0));
    {
        const empty = try document.query(A, &store, 0);
        defer empty.release() catch unreachable;
        try std.testing.expectEqual(@as(usize, 0), try empty.batchCount());
        try std.testing.expectError(error.BorrowConflict, store.deinit());
    }
    const archetype = try store.addArchetype(document.component_layout.payload.components);
    for (0..3) |_| _ = try store.create(archetype, &.{});
    {
        const query = try document.query(A, &store, 0);
        defer query.release() catch unreachable;
        try std.testing.expectEqual(@as(usize, 2), try query.batchCount());
        try std.testing.expectError(error.BorrowConflict, document.query(A, &store, 0));
        const first = try query.batch(0);
        const last = try query.batch(1);
        try std.testing.expectEqual(@as(usize, 2), try first.rowCount());
        try std.testing.expectEqual(@as(usize, 1), try last.rowCount());
        const entry = document.payload.entries[0];
        try std.testing.expectEqual(entry.columns.len, try first.columnCount());
        for (entry.columns, 0..) |column, index| {
            const actual = try first.column(index);
            try std.testing.expectEqualStrings(column.componentType, actual.component);
            try std.testing.expectEqual(column.access, actual.access);
            try std.testing.expectEqual(@as(usize, column.stride), actual.stride);
        }
    }
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
const ScalarMetadataChange = enum { position, binding, width, missing };

fn expectScalarMetadataRejection(change: ScalarMetadataChange) !void {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-f64-mixed-receipt.json"), .{});
    defer receipt.deinit();
    var original = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-f64-mixed.tmeta"), receipt.value);
    defer original.deinit();
    var payload = original.payload;
    const entries = try A.dupe(T.Entry, payload.entries);
    defer A.free(entries);
    payload.entries = entries;
    const entry = &entries[0];
    const scalars = try A.dupe(T.Scalar, entry.scalars);
    defer A.free(scalars);
    try std.testing.expectEqual(@as(usize, 2), scalars.len);
    try std.testing.expectEqual(@as(u32, 1), scalars[0].sourceParameter);
    try std.testing.expectEqual(@as(u32, 2), scalars[1].sourceParameter);
    try std.testing.expectEqualStrings("f64", scalars[0].type);
    try std.testing.expectEqualStrings("f32", scalars[1].type);
    entry.scalars = scalars;
    const original_suffix = ", f32) -> ()";
    try std.testing.expect(std.mem.endsWith(u8, entry.abiType, original_suffix));
    const suffix = switch (change) {
        .position => suffix: {
            scalars[1].sourceParameter += 1;
            break :suffix original_suffix;
        },
        .binding => suffix: {
            scalars[1].sourceBinding = scalars[0].sourceBinding;
            break :suffix original_suffix;
        },
        .width => suffix: {
            scalars[1].type = "f64";
            break :suffix ", f64) -> ()";
        },
        .missing => suffix: {
            entry.scalars = scalars[0..1];
            break :suffix ") -> ()";
        },
    };
    const abi = try std.mem.concat(A, u8, &.{ entry.abiType[0 .. entry.abiType.len - original_suffix.len], suffix });
    defer A.free(abi);
    entry.abiType = abi;
    try expectStructuralRejection(payload, receipt.value);
}

test "Query metadata rejects a scalar at a different Source position" {
    try expectScalarMetadataRejection(.position);
}

test "Query metadata rejects a scalar with another Source binding" {
    try expectScalarMetadataRejection(.binding);
}

test "Query metadata rejects a scalar width inconsistent with Source" {
    try expectScalarMetadataRejection(.width);
}

test "Query metadata rejects an incomplete Source scalar sequence" {
    try expectScalarMetadataRejection(.missing);
}

test "actual f64 view helper metadata retains its original borrowed batch" {
    try exerciseFixture("f64-helper", false);
}
test "actual v6 f32 view helper binds original column permissions and scalar" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-v6-f32-view-receipt.json"), .{});
    defer receipt.deinit();
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-v6-f32-view.tmeta"), receipt.value, false, .f32_view);
}

test "actual i32 copy metadata binds original columns and preserves two-system conflicts" {
    inline for (.{ "i32-copy", "i32-copy-conflict" }, 0..) |name, index| {
        const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-" ++ name ++ "-receipt.json"), .{});
        defer receipt.deinit();
        try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-" ++ name ++ ".tmeta"), receipt.value, false, if (index == 0) .copy else .copy_conflict);
    }
}

test "actual i32 compound metadata binds original columns and retains ordered read read write" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-compound-receipt.json"), .{});
    defer receipt.deinit();
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-i32-compound.tmeta"), receipt.value, false, .compound);
}

test "actual i32 literal metadata binds original columns and retains two writes of exact Source literals" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-literal-receipt.json"), .{});
    defer receipt.deinit();
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-i32-literal.tmeta"), receipt.value, false, .literal);
}

test "Query metadata rejects entry rows in a different Source system order" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-copy-conflict-receipt.json"), .{});
    defer receipt.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-i32-copy-conflict.tmeta"), receipt.value);
    defer document.deinit();
    var payload = document.payload;
    try std.testing.expectEqual(@as(usize, 2), payload.entries.len);
    try std.testing.expect(!std.mem.eql(u8, payload.entries[0].sourceFunctionId, payload.entries[1].sourceFunctionId));
    const reversed = [_]T.Entry{ payload.entries[1], payload.entries[0] };
    payload.entries = &reversed;
    const negative = try encodePayload(payload);
    defer A.free(negative.bytes);
    var expected = receipt.value;
    // Recomputing the outer digest isolates the entry directory check.
    expected.payloadHash = &negative.hash;
    if (T.Document.load(A, negative.bytes, expected)) |loaded| {
        var unexpected = loaded;
        unexpected.deinit();
        return error.TestExpectedError;
    } else |err| try std.testing.expectEqual(error.InvalidEffects, err);
}

test "Query metadata rejects the Source request from another genuine input" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-copy-receipt.json"), .{});
    defer receipt.deinit();
    const other_receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-copy-conflict-receipt.json"), .{});
    defer other_receipt.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-i32-copy.tmeta"), receipt.value);
    defer document.deinit();
    var other = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-i32-copy-conflict.tmeta"), other_receipt.value);
    defer other.deinit();
    try std.testing.expect(!std.mem.eql(u8, receipt.value.inputIdentity, other_receipt.value.inputIdentity));

    var payload = document.payload;
    payload.sourceRequest = other.payload.sourceRequest;
    try expectMetadataRejection(error.IdentityMismatch, payload, receipt.value);
}

test "Query metadata rejects a Source packet carrying another genuine package identity" {
    try rejectSourcePacket(.identity);
}

test "Query metadata rejects a changed Source packet body with the original package identity" {
    try rejectSourcePacket(.body);
}

fn rejectSourcePacket(comptime change: enum { identity, body }) !void {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-copy-receipt.json"), .{});
    defer receipt.deinit();
    const other = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-i32-copy-conflict-receipt.json"), .{});
    defer other.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-tmeta-i32-copy.tmeta"), receipt.value);
    defer document.deinit();
    const needle = if (change == .identity) receipt.value.packageId else "\"positionUnit\":\"utf16\"";
    const replacement = if (change == .identity) other.value.packageId else "\"positionUnit\":\"utf8\"";
    try std.testing.expect(!std.mem.eql(u8, needle, replacement));
    try std.testing.expectEqual(@as(usize, 1), std.mem.count(u8, document.payload.sourcePacket, needle));
    const changed = try std.mem.replaceOwned(u8, A, document.payload.sourcePacket, needle, replacement);
    defer A.free(changed);
    var payload = document.payload;
    payload.sourcePacket = changed;
    try expectMetadataRejection(error.IdentityMismatch, payload, receipt.value);
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
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-" ++ name ++ ".tmeta"), receipt.value, shared, null);
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
        .hirDigest = "sha256:d347ff9a236976c1b537870ca2eaade5da668b996be5be06d00dc1b80b45a6e4",
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

fn expectInheritanceBinding(document: *const T.Document, plan: *const T.Plan, batch: jobs.Store.Batch) !void {
    try expectProducerInputs(document.payload, .{
        "d8c6c3f4a243e4c77c363fc6c6a33c062d570ca84f3be161b746f294e4992e05",
        "69d722c999c4d37d745685a0d2388553c8d127a7e4fdc4c551a51bbfa7b9a986",
        "7477dbeef54e48316b531084be9e622025e641616b4a1d70f97b522f4d8393de",
    });
    var effects_hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(document.payload.effects, &effects_hash, .{});
    try std.testing.expectEqualStrings("0607efdd19138b02d6c599c81a28e3e2f71fcbbd8ac87d5e5faa4b8ad8487e4a", &std.fmt.bytesToHex(effects_hash, .lower));

    const position_id = "sha256:cb824c755704becef7c0bf4673267f1fd3275acfb472b491dde070a54924363d";
    const velocity_id = "sha256:aee79d3f99577389544c923954b4ee58a29cb090974ec9a6cf7516ef91af3963";
    const position = document.component_layout.find(position_id) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(usize, 4), position.fields.len);
    for (position.fields, [_]u32{ 0, 4, 8, 12 }) |field, offset| try std.testing.expectEqual(offset, field.offset);
    for (position.fields[0..2], position.fields[2..4]) |base, derived| {
        try std.testing.expectEqualStrings(base.name, derived.name);
        try std.testing.expect(!std.mem.eql(u8, base.id, derived.id));
    }

    const velocity = (try plan.argument(1)).column;
    const destination = (try plan.argument(3)).column;
    try std.testing.expectEqualStrings(velocity_id, velocity.component);
    try std.testing.expectEqualStrings(position_id, destination.component);
    try std.testing.expectEqual(jobs.Access.read, velocity.access);
    try std.testing.expectEqual(jobs.Access.write, destination.access);
    try std.testing.expectEqual(@as(usize, 8), (try plan.argument(2)).stride);
    try std.testing.expectEqual(@as(usize, 16), (try plan.argument(4)).stride);
    try std.testing.expectEqual(@as(f32, 0.5), (try plan.argument(5)).scalar.float32);

    const borrowed_position = try batch.read(1);
    const writable = try plan.writeTuple(0);
    const readonly = try plan.readTuple(1);
    try std.testing.expectEqual(@intFromPtr(borrowed_position.ptr), @intFromPtr(writable.ptr));
    try std.testing.expectEqual(@intFromPtr((try batch.read(0)).ptr), @intFromPtr(readonly.ptr));
    try std.testing.expectEqual(@as(usize, 32), writable.len);
    try std.testing.expectEqual(@as(usize, 16), readonly.len);

    const operations = document.effects.report.systems[0].loops[0].operations;
    try std.testing.expectEqual(@as(usize, 6), operations.len);
    // Mark only the selected derived lanes in row zero.
    const writes = [_]struct { index: usize, anchor: jobs.layout.Range, marker: [4]u8 }{
        .{ .index = 2, .anchor = .{ .start = 337, .end = 352 }, .marker = .{ 1, 2, 3, 4 } },
        .{ .index = 5, .anchor = .{ .start = 356, .end = 371 }, .marker = .{ 5, 6, 7, 8 } },
    };
    for (position.fields[2..4], writes) |field, write| {
        const operation = operations[write.index];
        try std.testing.expectEqual(jobs.Access.write, operation.kind);
        try std.testing.expectEqual(@as(u32, 0), operation.tupleIndex);
        try std.testing.expectEqualStrings(position_id, operation.componentType);
        try std.testing.expectEqualStrings(field.id, operation.field);
        try std.testing.expectEqualStrings("/src/main.ts", operation.source.path);
        try std.testing.expectEqual(write.anchor.start, operation.source.start);
        try std.testing.expectEqual(write.anchor.end, operation.source.end);
        const offset: usize = field.offset;
        @memcpy(writable[offset .. offset + write.marker.len], &write.marker);
    }
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 8), borrowed_position[0..8]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 }, borrowed_position[8..16]);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 16), borrowed_position[16..32]);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 16), readonly);
}

test "actual inherited Query binds shadow field offsets to the original borrowed columns" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-tmeta-inheritance-receipt.json"), .{});
    defer receipt.deinit();
    try exerciseProducer(@embedFile("jobs/testdata/query-tmeta-inheritance.tmeta"), receipt.value, false, .inheritance);
}

test {
    _ = @import("jobs-effects-test.zig");
    _ = @import("jobs-query-test.zig");
    _ = @import("jobs-test.zig");
    _ = @import("jobs-layout-test.zig");
}
