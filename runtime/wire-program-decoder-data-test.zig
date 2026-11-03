// SPDX-License-Identifier: MIT
// Passive Common18 data decoding and ABI directory regressions.
// No Context/refcheck/SSA/correspondence, VM, State or instruction dispatch.
const std = @import("std");
const decoder = @import("wire-program-decoder.zig");
// Frozen private Common18 caller allowance (wire-program-model.zig:24).
const initial_work: usize = 4_000_000;

test "passive decoder owns new Common18 data and preserves required plans" {
    const positive = @embedFile("test-data/common18-decoder/positive.tbc");
    const borrowed = try std.testing.allocator.dupe(u8, positive);
    defer std.testing.allocator.free(borrowed);
    var remaining = initial_work;
    var owned = try decoder.readOwned(std.testing.allocator, borrowed, &remaining);
    defer owned.deinit();
    try std.testing.expect(owned.encoded.ptr != borrowed.ptr);
    try std.testing.expectEqualSlices(u8, positive, owned.encoded);
    @memset(borrowed, 0);
    try std.testing.expectEqualSlices(u8, positive, owned.encoded);
    try std.testing.expectEqualStrings("/src/main.ts", owned.program.source_path);
    try std.testing.expectEqual(@as(u32, 248), owned.program.source_length);
    try std.testing.expectEqual(@as(usize, 3), owned.program.functions.len);
    const common = owned.program.tables.mode.common;
    try std.testing.expectEqual(@as(usize, 3), common.abis.len);
    for (common.abis, owned.program.functions, 0..) |abi, function, index| {
        try std.testing.expectEqual(index, @as(usize, @intFromEnum(abi.function)));
        try std.testing.expectEqual(index, @as(usize, @intFromEnum(function.abi)));
        try std.testing.expectEqualSlices(u8, &abi.signature, &function.signature);
    }
    try std.testing.expectEqual(@as(usize, 5), common.abis[0].source_plan.blocks.len);
    try std.testing.expectEqual(@as(usize, 1), common.abis[1].source_plan.blocks.len);
    try std.testing.expectEqual(@as(usize, 3), common.abis[2].source_plan.blocks.len);
    try std.testing.expect(remaining < initial_work);
}

test "passive decoder rejects ABI function directory mismatch" {
    var remaining = initial_work;
    try std.testing.expectError(error.InvalidReference, decoder.readOwned(std.testing.allocator,
        @embedFile("test-data/common18-decoder/abi-function-mismatch.tbc"), &remaining));
    try std.testing.expect(remaining < initial_work);
}

test "passive decoder rejects actual Function ABI directory mismatch" {
    var remaining = initial_work;
    try std.testing.expectError(error.InvalidReference, decoder.readOwned(std.testing.allocator,
        @embedFile("test-data/common18-decoder/actual-function-abi-mismatch.tbc"), &remaining));
    try std.testing.expect(remaining < initial_work);
}

test "passive decoder rejects ABI and actual Function signature mismatch" {
    var remaining = initial_work;
    try std.testing.expectError(error.InvalidRecord, decoder.readOwned(std.testing.allocator,
        @embedFile("test-data/common18-decoder/abi-signature-mismatch.tbc"), &remaining));
    try std.testing.expect(remaining < initial_work);
}

test "passive decoder requires SourcePlan in every actual ABI row" {
    var remaining = initial_work;
    try std.testing.expectError(error.InvalidShape, decoder.readOwned(std.testing.allocator,
        @embedFile("test-data/common18-decoder/missing-source-plan.tbc"), &remaining));
    try std.testing.expect(remaining < initial_work);
}
