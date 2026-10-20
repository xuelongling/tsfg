// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const n = bytecode.nullable;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const Input = struct { hex: []const u8 };
const FunctionOffsets = struct { role: usize, id: usize, return_type: usize, register_count: usize, block_count: usize, instruction_count: usize, instructions: []const usize };
const Offsets = struct { function_count: usize, functions: []const FunctionOffsets };

fn actual() ![1721]u8 {
    const input = try std.json.parseFromSlice(Input, std.testing.allocator, @embedFile("testdata/nullable-cold-packet.json"), .{ .ignore_unknown_fields = true });
    defer input.deinit();
    var bytes: [1721]u8 = undefined;
    _ = try std.fmt.hexToBytes(&bytes, input.value.hex);
    return bytes;
}
fn put(bytes: []u8, offset: usize, comptime T: type, value: T) void {
    std.mem.writeInt(T, bytes[offset..][0..@sizeOf(T)], value, .little);
}
fn repair(bytes: []u8) void {
    put(bytes, 44, u32, @intCast(bytes.len));
    std.crypto.hash.sha2.Sha256.hash(bytes[80..], bytes[48..80], .{});
}
fn rejected(bytes: []const u8, code: []const u8) !void {
    switch (n.load(std.testing.allocator, bytes)) {
        .loaded => |value| {
            n.unload(value);
            return error.UnexpectedAdmission;
        },
        .rejected => |failure| {
            try std.testing.expectEqualStrings(code, failure.code);
            try expect(failure.offset <= bytes.len);
        },
    }
}
fn load(bytes: []const u8) !*n.VerifiedNullableModule {
    return switch (n.load(std.testing.allocator, bytes)) {
        .loaded => |value| value,
        .rejected => |failure| {
            std.debug.print("unexpected {s} at {d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    };
}

test "opaque admission owns input and preserves serialization without becoming a VM handle" {
    try expect(n.VerifiedNullableModule != bytecode.VerifiedModule);
    var bytes = try actual();
    const original = bytes;
    const module = try load(&bytes);
    defer n.unload(module);
    @memset(&bytes, 0);
    const copied = try n.serialize(module, std.testing.allocator);
    defer std.testing.allocator.free(copied);
    try std.testing.expectEqualSlices(u8, &original, copied);
    const text = try n.inspect(module, std.testing.allocator);
    defer std.testing.allocator.free(text);
    try std.testing.expectEqualStrings(std.mem.trim(u8, @embedFile("testdata/nullable-cold-expected.json"), "\r\n"), text);
    const second = try load(copied);
    defer n.unload(second);
    try equal(@as(usize, 0), n.snapshot(second).entry_index);
}

test "cold outer identity truncation and exact EOF rejection remain distinct" {
    const original = try actual();
    var bytes = original;
    bytes[0] ^= 1;
    try rejected(&bytes, "r04-nullable-magic");
    bytes = original;
    bytes[8] = 2;
    try rejected(&bytes, "r04-nullable-format");
    bytes = original;
    bytes[12] ^= 1;
    try rejected(&bytes, "r04-nullable-schema");
    bytes = original;
    bytes[80] ^= 1;
    try rejected(&bytes, "r04-nullable-integrity");
    for ([_]usize{ 0, 1, 7, 8, 11, 43, 47, 79 }) |length| try rejected(original[0..length], "r04-nullable-truncated");
    bytes = original;
    repair(bytes[0 .. bytes.len - 1]);
    // The new instruction minimum rejects before reserving a table with its final byte missing.
    try rejected(bytes[0 .. bytes.len - 1], "r04-nullable-limit");
    var trailing: [1722]u8 = undefined;
    @memcpy(trailing[0..1721], &original);
    trailing[1721] = 0;
    repair(&trailing);
    try rejected(&trailing, "r04-nullable-trailing");
    const huge = try std.testing.allocator.alloc(u8, 1048577);
    defer std.testing.allocator.free(huge);
    @memset(huge, 0);
    try rejected(huge, "r04-nullable-limit");
}

test "hash repaired mutations reach role identity register call dominance and nonempty tag checks" {
    const parsed = try std.json.parseFromSlice(Offsets, std.testing.allocator, @embedFile("testdata/nullable-cold-offsets.json"), .{ .ignore_unknown_fields = true });
    defer parsed.deinit();
    const layout = parsed.value;
    const entry = layout.functions[0];
    const classify = layout.functions[2];
    const original = try actual();
    var bytes = original;
    bytes[entry.id] ^= 1;
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-identity");
    bytes = original;
    bytes[entry.role] = 1;
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-role");
    bytes = original;
    bytes[entry.role + 1] = 1;
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-format");
    bytes = original;
    put(&bytes, layout.function_count, u16, 513);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-limit");
    bytes = original;
    put(&bytes, entry.register_count, u16, 4097);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-limit");
    bytes = original;
    put(&bytes, entry.block_count, u16, 257);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-limit");
    bytes = original;
    put(&bytes, entry.instruction_count, u16, 8193);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-limit");
    bytes = original;
    put(&bytes, entry.instructions[1] + 2, u16, 14);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-register");
    bytes = original;
    bytes[entry.instructions[3] + 1] = 1;
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-type");
    bytes = original;
    put(&bytes, entry.instructions[3] + 4, u32, 0);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-cfg");
    bytes = original;
    put(&bytes, entry.instructions[0] + 4, u32, 2);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-fuel");
    bytes = original;
    put(&bytes, entry.instructions[4] + 4, u32, 3);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-type");
    // A late i32 result has the right type but cannot dominate this earlier equality.
    bytes = original;
    put(&bytes, entry.instructions[2] + 4, u32, 65536 | 14);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-dominance");
    // The join call cannot use a value defined only in the separate present predecessor.
    bytes = original;
    put(&bytes, entry.instructions[17] + 18, u16, 11);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-dominance");
    bytes = original;
    put(&bytes, entry.instructions[17] + 4, u32, 4);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-call");
    // Source0 is not the identity refined by the later test of echoNull's result4.
    bytes = original;
    put(&bytes, classify.instructions[11] + 4, u32, 0);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-proof");
    // Testing null instead of undefined leaves undefined on the false edge to retype242.
    bytes = original;
    put(&bytes, classify.instructions[1] + 4, u32, 131072);
    repair(&bytes);
    try rejected(&bytes, "r04-nullable-proof");
    const valid = try load(&original);
    n.unload(valid);
}

test "every observed cold allocation failure releases all temporary and unpublished storage" {
    const bytes = try actual();
    var successes: usize = 0;
    var failures: usize = 0;
    for (0..512) |offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = offset });
        failing.resize_fail_index = 0;
        switch (n.load(failing.allocator(), &bytes)) {
            .rejected => |failure| {
                try std.testing.expectEqualStrings("r04-nullable-allocation", failure.code);
                failures += 1;
            },
            .loaded => |module| {
                n.unload(module);
                successes += 1;
            },
        }
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (successes != 0) break;
    }
    try equal(@as(usize, 1), successes);
    try expect(failures > 0);
    std.debug.print("nullable cold actual allocation failures {d}; success reached\n", .{failures});
    const later = try load(&bytes);
    n.unload(later);
}

const Synthetic = struct { name: []const u8, hex: []const u8, expected: []const u8, functions: usize = 0, entry: usize = 0, registers: usize = 0, blocks: usize = 0, flowCells: usize = 0 };
const SyntheticSet = struct { cases: []const Synthetic };
test "independent loops empty proofs real maxima scalar bits and nonfirst entry cold cases" {
    const data = try std.json.parseFromSlice(SyntheticSet, std.testing.allocator, @embedFile("testdata/nullable-cold-synthetic.json"), .{ .ignore_unknown_fields = true });
    defer data.deinit();
    try equal(@as(usize, 8), data.value.cases.len);
    for (data.value.cases) |case| {
        std.debug.print("nullable cold synthetic {s}\n", .{case.name});
        const bytes = try std.testing.allocator.alloc(u8, case.hex.len / 2);
        defer std.testing.allocator.free(bytes);
        _ = try std.fmt.hexToBytes(bytes, case.hex);
        if (!std.mem.eql(u8, case.expected, "accept")) {
            try rejected(bytes, case.expected);
            continue;
        }
        const module = try load(bytes);
        defer n.unload(module);
        const view = n.snapshot(module);
        try equal(case.functions, view.functions.len);
        try equal(case.entry, view.entry_index);
        if (case.registers != 0) try equal(case.registers, view.functions[0].register_count);
        if (case.blocks != 0) try equal(case.blocks, view.functions[0].blocks.len);
        if (case.flowCells != 0) try equal(case.flowCells, @as(usize, view.functions[0].register_count) * view.functions[0].blocks.len);
        if (std.mem.eql(u8, case.name, "all-thirteen-scalars")) {
            try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 }, view.functions[0].parameter_types);
            try equal(@as(u64, 0x8000000000000000), view.functions[4].instructions[1].literal_bits);
            try equal(@as(u64, 0x7FC00001), view.functions[11].instructions[1].literal_bits);
            try equal(@as(u64, 0xFFF8000000000001), view.functions[12].instructions[1].literal_bits);
        }
        const copied = try n.serialize(module, std.testing.allocator);
        defer std.testing.allocator.free(copied);
        try std.testing.expectEqualSlices(u8, bytes, copied);
    }
}
