// SPDX-License-Identifier: MIT
const std = @import("std");
const jobs = @import("jobs.zig");
const A = std.testing.allocator;
const E = jobs.query_effects;
const T = jobs.query_tmeta;
const Oracle = struct {
    derivation: []const u8,
    family: []const u8,
    rule: []const u8,
    version: u32,
    cases: []const struct {
        name: []const u8,
        receipt: T.Expected,
        effectsHash: []const u8,
        sourceRefs: struct { checkedBatchSHA256: []const u8, factsSHA256: []const u8, metadata: []const u8, metadataSHA256: []const u8, requestSHA256: []const u8, sourceFiles: []const E.SourceFile },
        nonConflicts: []const struct { left: []const u8, right: []const u8 },
        systemNames: []const struct { functionId: []const u8, sourceFunctionId: []const u8, name: []const u8 },
        expectedEffects: E.Report,
    },
};

test "actual owned metadata exposes a typed Runtime effects consumer" {
    const receipt = try std.json.parseFromSlice(jobs.query_tmeta.Expected, A, @embedFile("jobs/testdata/query-tmeta-parenthesized-receipt.json"), .{});
    defer receipt.deinit();
    var document = try jobs.query_tmeta.Document.load(A, @embedFile("jobs/testdata/query-tmeta-parenthesized.tmeta"), receipt.value);
    defer document.deinit();
    if (comptime @hasField(jobs.query_tmeta.Document, "effects")) {
        try std.testing.expect(document.effects.report.systems.len > 0);
    } else {
        try std.testing.expect(false);
    }
}

test "actual multi systems and loops preserve the complete independent effects graph" {
    const oracle = try std.json.parseFromSlice(Oracle, A, @embedFile("jobs/testdata/query-effects-expected.json"), .{ .max_value_len = 8388608 });
    defer oracle.deinit();
    try std.testing.expectEqualStrings("tsfg.query-effects-independent-oracle", oracle.value.family);
    try std.testing.expectEqual(@as(u32, 1), oracle.value.version);
    try std.testing.expectEqual(@as(usize, 4), oracle.value.cases.len);
    inline for (.{ "multi", "multiple", "shared", "double-loop" }) |name| {
        var found = false;
        for (oracle.value.cases) |case| if (std.mem.eql(u8, case.name, name)) {
            found = true;
            var document = try T.Document.load(A, @embedFile("jobs/testdata/query-effects-" ++ name ++ ".tmeta"), case.receipt);
            defer document.deinit();
            const actual = try std.json.Stringify.valueAlloc(A, document.effects.report, .{});
            defer A.free(actual);
            const expected = try std.json.Stringify.valueAlloc(A, case.expectedEffects, .{});
            defer A.free(expected);
            try std.testing.expectEqualStrings(expected, actual);
            try std.testing.expectEqualStrings(case.effectsHash, document.payload.effectsHash);
            for (case.systemNames) |named| {
                const system = document.effects.system(named.functionId).?;
                try std.testing.expectEqualStrings(named.sourceFunctionId, system.sourceFunctionId);
                try std.testing.expect(document.effects.system(named.sourceFunctionId) == null);
            }
            var missing_body_read = false;
            const systems = document.effects.report.systems;
            for (systems, 0..) |left, index| {
                if (left.loops.len == 0 and left.capabilities.len > 0 and left.fieldEffects.len == 0) missing_body_read = true;
                try std.testing.expectError(error.InvalidPair, document.effects.conflictComponents(left.functionId, left.functionId));
                for (systems[index + 1 ..]) |right| {
                    var components: []const []const u8 = &.{};
                    for (case.expectedEffects.conflicts) |edge| if (std.mem.eql(u8, edge.left, left.functionId) and std.mem.eql(u8, edge.right, right.functionId)) {
                        components = edge.components;
                    };
                    const forward = try document.effects.conflictComponents(left.functionId, right.functionId);
                    const reverse = try document.effects.conflictComponents(right.functionId, left.functionId);
                    try std.testing.expectEqual(components.len, forward.len);
                    try std.testing.expectEqual(components.len, reverse.len);
                    for (components, forward, reverse) |wanted, a, b| {
                        try std.testing.expectEqualStrings(wanted, a);
                        try std.testing.expectEqualStrings(wanted, b);
                    }
                }
            }
            try std.testing.expectError(error.UnknownSystem, document.effects.conflictComponents("sha256:" ++ "0" ** 64, systems[0].functionId));
            if (comptime std.mem.eql(u8, name, "multi")) {
                try std.testing.expect(missing_body_read);
                try std.testing.expectEqual(@as(usize, 7), systems.len);
                try std.testing.expectEqual(@as(usize, 13), document.effects.report.conflicts.len);
            }
            if (comptime std.mem.eql(u8, name, "multiple")) try std.testing.expectEqual(@as(usize, 3), systems[0].loops[0].capabilities.len);
            if (comptime std.mem.eql(u8, name, "shared")) {
                const loop = systems[0].loops[0];
                try std.testing.expectEqual(@as(usize, 2), loop.columns.len);
                try std.testing.expectEqual(@as(usize, 1), loop.capabilities.len);
                try std.testing.expectEqual(jobs.Access.write, loop.capabilities[0].mode);
            }
            if (comptime std.mem.eql(u8, name, "double-loop")) {
                try std.testing.expectEqual(@as(usize, 1), systems.len);
                try std.testing.expectEqual(@as(usize, 2), systems[0].loops.len);
                try std.testing.expectEqual(@as(u32, 1), systems[0].loops[1].index);
                try std.testing.expectEqual(@as(u32, 1), document.payload.entries[1].loop);
            }
        };
        try std.testing.expect(found);
    }
}

test "typed effects reject rehashed noncanonical edges and invalid members modes and identities" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-effects-multi-receipt.json"), .{});
    defer receipt.deinit();
    var document = try T.Document.load(A, @embedFile("jobs/testdata/query-effects-multi.tmeta"), receipt.value);
    defer document.deinit();
    var report = document.effects.report;
    const original_edges = report.conflicts;
    try std.testing.expect(original_edges.len > 0);
    report.conflicts = original_edges[1..];
    try rejectReport(&document, report);
    const edges = try A.dupe(E.Conflict, original_edges);
    defer A.free(edges);
    report.conflicts = edges;
    edges[0].left = original_edges[0].right;
    edges[0].right = original_edges[0].left;
    try rejectReport(&document, report);
    edges[0] = original_edges[0];
    edges[0].components = &.{};
    try rejectReport(&document, report);
    const extra_edges = try std.mem.concat(A, E.Conflict, &.{ original_edges, original_edges[0..1] });
    defer A.free(extra_edges);
    report.conflicts = extra_edges;
    try rejectReport(&document, report);
    report.conflicts = original_edges;
    const systems = try A.dupe(E.System, report.systems);
    defer A.free(systems);
    report.systems = systems;
    systems[0].sourceFunctionId = systems[0].functionId;
    try rejectReport(&document, report);
    systems[0] = document.effects.report.systems[0];
    const caps = try A.dupe(E.Capability, systems[0].capabilities);
    defer A.free(caps);
    systems[0].capabilities = caps;
    caps[0].mode = if (caps[0].mode == .read) .write else .read;
    try rejectReport(&document, report);
    caps[0] = document.effects.report.systems[0].capabilities[0];
    caps[0].componentType = "sha256:" ++ "0" ** 64;
    try rejectReport(&document, report);
    systems[0] = document.effects.report.systems[0];
    for (systems) |*system| if (system.loops.len > 0 and system.loops[0].fieldEffects.len > 0) {
        const loops = try A.dupe(E.Loop, system.loops);
        defer A.free(loops);
        system.loops = loops;
        const fields = try A.dupe(E.FieldEffects, loops[0].fieldEffects);
        defer A.free(fields);
        loops[0].fieldEffects = fields;
        fields[0].readCount += 1;
        try rejectReport(&document, report);
        break;
    };
    @memcpy(systems, document.effects.report.systems);
    for (systems, 0..) |*system, index| if (system.loops.len > 0) {
        const loops = try A.dupe(E.Loop, system.loops);
        defer A.free(loops);
        system.loops = loops;
        loops[0].index += 1;
        try rejectReport(&document, report);
        loops[0] = document.effects.report.systems[index].loops[0];
        loops[0].source.start += 1;
        try rejectReport(&document, report);
        system.* = document.effects.report.systems[index];
        break;
    };
    for (systems) |*system| if (system.loops.len == 0 and system.capabilities.len > 0) {
        system.capabilities = &.{};
        var without: std.ArrayList(E.Conflict) = .empty;
        defer without.deinit(A);
        for (original_edges) |edge| if (!std.mem.eql(u8, edge.left, system.functionId) and !std.mem.eql(u8, edge.right, system.functionId)) try without.append(A, edge);
        report.conflicts = without.items;
        try rejectReport(&document, report);
        break;
    };
}

test "typed effects data ownership survives standard allocator growth and invalid-input cleanup" {
    const receipt = try std.json.parseFromSlice(T.Expected, A, @embedFile("jobs/testdata/query-effects-multi-receipt.json"), .{});
    defer receipt.deinit();
    for ([_]usize{ 0, 20 }) |boundary| {
        var backing = std.heap.ArenaAllocator.init(A);
        defer backing.deinit();
        var constrained = std.testing.FailingAllocator.init(backing.allocator(), .{ .resize_fail_index = boundary });
        var document = try T.Document.load(constrained.allocator(), @embedFile("jobs/testdata/query-effects-multi.tmeta"), receipt.value);
        document.deinit();
        try std.testing.expect(constrained.allocations > 1);
        try std.testing.expectEqual(constrained.allocations, constrained.deallocations);
        try std.testing.expectEqual(constrained.allocated_bytes, constrained.freed_bytes);
    }
}

fn digest(prefix: []const u8, bytes: []const u8) [71]u8 {
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(prefix);
    hash.update(bytes);
    var value: [32]u8 = undefined;
    hash.final(&value);
    var out: [71]u8 = undefined;
    @memcpy(out[0..7], "sha256:");
    const hex = std.fmt.bytesToHex(value, .lower);
    @memcpy(out[7..], &hex);
    return out;
}
fn rejectReport(document: *const T.Document, report: E.Report) !void {
    const effects_body = try std.json.Stringify.valueAlloc(A, report, .{});
    defer A.free(effects_body);
    const effects_bytes = try std.mem.concat(A, u8, &.{ effects_body, "\n" });
    defer A.free(effects_bytes);
    var payload = document.payload;
    payload.effects = effects_bytes;
    const effects_hash = digest("", effects_bytes);
    payload.effectsHash = &effects_hash;
    const body = try std.json.Stringify.valueAlloc(A, payload, .{});
    defer A.free(body);
    const identity = digest("tsfg.query-tmeta.v1\x00", body);
    const envelope = try std.json.Stringify.valueAlloc(A, .{ .family = "tsfg.query-tmeta", .payload = body, .payloadHash = @as([]const u8, &identity), .schemaHash = T.schema_hash, .version = @as(u32, 1) }, .{});
    defer A.free(envelope);
    const bytes = try std.mem.concat(A, u8, &.{ envelope, "\n" });
    defer A.free(bytes);
    // This deliberately forged expected hash is only a structural negative, never a cold receipt.
    try std.testing.expectError(error.InvalidEffects, T.Document.load(A, bytes, .{ .payloadHash = &identity, .inputIdentity = payload.inputIdentity, .packageId = payload.packageId }));
}
