// SPDX-License-Identifier: MIT
// Complete independent Node-authored wire gold, consumed only by the formal
// loader/inspector/serializer. No guest evaluation occurs in these tests.
const std = @import("std");
const b = @import("bytecode.zig");
const a = std.testing.allocator;
const gold = @embedFile("testdata/formal-string-lossless.tbc");
fn load(bytes: []const u8) !*b.VerifiedModule {
    return switch (b.load(a, bytes)) { .loaded => |module| module, .rejected => |failure| {
        std.debug.print("unexpected {s} at {d}\n", .{ failure.code, failure.offset });
        return error.UnexpectedRejection;
    } };
}
fn rejected(bytes: []const u8, code: []const u8) !void {
    switch (b.load(a, bytes)) {
        .loaded => |module| { b.unload(module); return error.UnexpectedAdmission; },
        .rejected => |failure| try std.testing.expectEqualStrings(code, failure.code),
    }
}
fn repair(bytes: []u8) void {
    std.mem.writeInt(u32, bytes[44..48], @intCast(bytes.len), .little);
    std.crypto.hash.sha2.Sha256.hash(bytes[80..], bytes[48..80], .{});
}
test "formal reader preserves every function and exact UTF16 literals in whole gold packages" {
    const inputs = [_][]const u8{ gold, @embedFile("testdata/formal-string-asi.tbc"), @embedFile("testdata/formal-string-concat.tbc") };
    for (inputs, [_]usize{ 14, 1, 6 }) |bytes, count| {
        const module = try load(bytes);
        defer b.unload(module);
        try std.testing.expectEqual(count, b.functions(module).len);
        for (b.functions(module)) |function| {
            try std.testing.expectEqual(@as(u8, 14), function.info.return_type);
            try std.testing.expectEqual(@as(u8, 26), function.instructions[0].opcode);
        }
        const owned = try b.serialize(module, a);
        defer a.free(owned);
        try std.testing.expectEqualSlices(u8, bytes, owned);
        const text = try b.inspect(module, a);
        defer a.free(text);
        const json = try std.json.parseFromSlice(std.json.Value, a, text, .{});
        defer json.deinit();
        try std.testing.expectEqualStrings("0.10.0", json.value.object.get("semver").?.string);
        try std.testing.expectEqual(count, json.value.object.get("functions").?.array.items.len);
    }
    const module = try load(gold);
    defer b.unload(module);
    const functions = b.functions(module);
    try std.testing.expectEqualSlices(u16, &.{0xd800}, functions[5].instructions[1].code_units);
    try std.testing.expectEqualSlices(u16, &.{0xdc00}, functions[6].instructions[1].code_units);
    try std.testing.expectEqualSlices(u16, &.{ 0x65, 0x301 }, functions[12].instructions[1].code_units);
}
test "formal reader rejects old mixed corrupt and identity-invalid String packets" {
    var bytes: [gold.len]u8 = gold.*;
    bytes[8] = 9;
    try rejected(&bytes, "r04-version");
    bytes = gold.*; bytes[12] ^= 1;
    try rejected(&bytes, "r04-schema");
    bytes = gold.*; bytes[80] ^= 1;
    try rejected(&bytes, "r04-integrity");
    const module = try load(gold);
    defer b.unload(module);
    const offset = b.functions(module)[0].info.instruction_offset;
    const identity_offset = std.mem.indexOf(u8, gold, &b.functions(module)[0].info.function_id).?;
    bytes = gold.*; bytes[identity_offset] ^= 1;
    repair(&bytes);
    try rejected(&bytes, "r04-function");
    bytes = gold.*; bytes[220] = 19;
    repair(&bytes);
    try rejected(&bytes, "r04-capability");
    bytes = gold.*;
    // First String constant follows the fixed sixteen-byte entry fuel record.
    bytes[offset + 17] = 1;
    repair(&bytes);
    try rejected(&bytes, "r04-type");
    bytes = gold.*;
    std.mem.writeInt(u32, bytes[offset + 20 ..][0..4], 16385, .little);
    repair(&bytes);
    try rejected(&bytes, "r04-string-limit");
    bytes = gold.*;
    // A hash-repaired typed result still cannot return an undefined register.
    std.mem.writeInt(u16, bytes[offset + 34 ..][0..2], 1, .little);
    repair(&bytes);
    try rejected(&bytes, "r04-register");
    for (0..80) |length| {
        switch (b.load(a, gold[0..length])) {
            .loaded => |unexpected| { b.unload(unexpected); return error.UnexpectedAdmission; },
            .rejected => {},
        }
    }
}
test "formal String loader frees every partial allocation on OOM" {
    var reached_success = false;
    for (0..512) |index| {
        var failing = std.testing.FailingAllocator.init(a, .{ .fail_index = index });
        failing.resize_fail_index = 0;
        switch (b.load(failing.allocator(), gold)) {
            .loaded => |module| { b.unload(module); reached_success = true; },
            .rejected => |failure| try std.testing.expectEqualStrings("r04-allocation", failure.code),
        }
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (reached_success) break;
    }
    try std.testing.expect(reached_success);
}

test "formal reader verifies general String operations parameters calls and CFG transfers" {
    const bytes = @embedFile("testdata/formal-string-general.tbc");
    const module = try load(bytes);
    defer b.unload(module);
    const functions = b.functions(module);
    try std.testing.expectEqual(@as(usize, 3), functions.len);
    var seen = [_]bool{false} ** 6;
    var call = false;
    var edge = false;
    for (functions) |function| for (function.instructions) |op| {
        if (op.opcode >= 34 and op.opcode <= 39) seen[op.opcode - 34] = true;
        if (op.opcode == 27) call = true;
        if (op.opcode == 24 or op.opcode == 25) edge = true;
    };
    for (seen) |found| try std.testing.expect(found);
    try std.testing.expect(call and edge);
    const serialized = try b.serialize(module, a);
    defer a.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
}

test "formal String reader preserves original maximum function and parameter capacities" {
    const bytes = @embedFile("testdata/formal-string-max-functions.tbc");
    const module = try load(bytes);
    defer b.unload(module);
    const functions = b.functions(module);
    try std.testing.expectEqual(@as(usize, 512), functions.len);
    for (functions[2..]) |function| {
        try std.testing.expectEqual(@as(usize, 64), function.info.parameter_types.len);
        for (function.info.parameter_types) |type_code| try std.testing.expectEqual(@as(u8, 14), type_code);
    }
    const serialized = try b.serialize(module, a);
    defer a.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
}

test "current scalar fixture remains a complete formal loader positive" {
    const bytes = &@import("fixture.zig").bytes;
    const module = try load(bytes);
    defer b.unload(module);
    try std.testing.expectEqual(@as(usize, 1), b.functions(module).len);
    try std.testing.expectEqual(@as(u8, 1), b.moduleInfo(module).return_type);
    const instructions = b.functions(module)[0].instructions;
    try std.testing.expectEqual(@as(u8, 1), instructions[1].opcode);
    try std.testing.expectEqual(@as(i32, 42), instructions[1].immediate);
    const serialized = try b.serialize(module, a);
    defer a.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
}

test "formal String globals preserve complete module initialization and source tables" {
    const bytes = @embedFile("testdata/formal-string-globals.tbc");
    const module = try load(bytes);
    defer b.unload(module);
    const functions = b.functions(module);
    const tables = b.moduleTables(module);
    try std.testing.expect(tables.present);
    try std.testing.expectEqual(@as(usize, 3), functions.len);
    try std.testing.expectEqual(@as(usize, 1), tables.globals.len);
    try std.testing.expectEqual(@as(u8, 14), tables.globals[0].type_code);
    try std.testing.expectEqual(@as(usize, 1), tables.initialization.len);
    try std.testing.expect(functions[tables.initialization[0]].info.initializer);
    var load_seen = false;
    var store_seen = false;
    for (functions) |function| for (function.instructions) |op| {
        if (op.opcode == 29) load_seen = true;
        if (op.opcode == 30) store_seen = true;
    };
    try std.testing.expect(load_seen and store_seen);
    const serialized = try b.serialize(module, a);
    defer a.free(serialized);
    try std.testing.expectEqualSlices(u8, bytes, serialized);
}
