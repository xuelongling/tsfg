// SPDX-License-Identifier: MIT
// Real Common20 right.tbc admission, module initialization, persistent globals,
// exclusive Host lease, atomic writeback, and CPU execution oracle tests.
const std = @import("std");
const ci = @import("common-instance.zig");
const t = @import("wire-program-types.zig");

const right_packet = @embedFile("test-data/common20/right.tbc");
const alloc = std.testing.allocator;

fn parseHex32(hex: []const u8) t.Hash {
    var out: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&out, hex) catch unreachable;
    return out;
}

const right_input_id = parseHex32("3dce93bcece355dbd642fe88f4f1fb140442cb1af5a81f19588cce7889945f16");
const right_scope_digest = parseHex32("3537a7bc1f5f4b9faf5e18e94db851f6d46fe0d792faa70cd677799296b24d1f");
const right_published_digest = parseHex32("a971de0970840b7d4b2284f3c3d4bf9b1cdb0e4cc7aa42cb1cc63a6ba3e04065");
const right_total_global_id = parseHex32("c6b03719e7decf93073046e91b968d431e63276831f788ccda16039c954fcee3");

test "admit rejects mismatched inputIdentity, scopeDigest, publishedDigest, and target before instance creation" {
    var bad_id = right_input_id;
    bad_id[0] ^= 0xff;
    try std.testing.expectError(error.IdentityMismatch, ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_input_identity = bad_id,
    }));

    var bad_scope = right_scope_digest;
    bad_scope[0] ^= 0xff;
    try std.testing.expectError(error.ScopeDigestMismatch, ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_scope_digest = bad_scope,
    }));

    var bad_pub = right_published_digest;
    bad_pub[0] ^= 0xff;
    try std.testing.expectError(error.PublishedDigestMismatch, ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_published_digest = bad_pub,
    }));

    try std.testing.expectError(error.TargetMismatch, ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_target = "linux-x86_64-gnu",
    }));
}

test "admit + initialize real right.tbc sets leftTotal=0 and rightTotal=0 and executes sequential requests" {
    var instance = try ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_input_identity = right_input_id,
        .expected_scope_digest = right_scope_digest,
        .expected_published_digest = right_published_digest,
        .expected_target = "windows-x86_64-msvc",
    });
    defer instance.deinit();

    // Before init: globals unreadable, lease denied.
    try std.testing.expectEqual(ci.Status.uninitialized, instance.status);
    try std.testing.expect(instance.readGlobalById(right_total_global_id) == null);
    try std.testing.expect(!instance.acquireLease());

    // Initialize module.
    const init_out = instance.initialize(.{ .semantic_fuel = 100, .call_depth = 8 });
    try std.testing.expectEqual(.ok, init_out.status);
    try std.testing.expectEqual(ci.Status.initialized, instance.status);
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalByName("leftTotal").?.asI32Bits());
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalById(right_total_global_id).?.asI32Bits());

    // Execute right(11) with fuel=1 -> returns 11, rightTotal=11, leftTotal=0, fuel=0.
    const r1 = instance.callFunctionByName("right", &.{.{ .i32 = 11 }}, .{ .semantic_fuel = 1, .call_depth = 1 });
    try std.testing.expectEqual(.ok, r1.status);
    try std.testing.expectEqual(@as(?u32, 11), r1.value.asI32Bits());
    try std.testing.expectEqual(@as(u64, 0), r1.fuel_remaining);
    try std.testing.expectEqual(@as(?u32, 11), instance.readGlobalById(right_total_global_id).?.asI32Bits());
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalByName("leftTotal").?.asI32Bits());

    // Execute right(-4) with fuel=1 -> returns 7, rightTotal=7, leftTotal=0, fuel=0.
    const r2 = instance.callFunctionByName("right", &.{.{ .i32 = -4 }}, .{ .semantic_fuel = 1, .call_depth = 1 });
    try std.testing.expectEqual(.ok, r2.status);
    try std.testing.expectEqual(@as(?u32, 7), r2.value.asI32Bits());
    try std.testing.expectEqual(@as(u64, 0), r2.fuel_remaining);
    try std.testing.expectEqual(@as(?u32, 7), instance.readGlobalById(right_total_global_id).?.asI32Bits());
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalByName("leftTotal").?.asI32Bits());

    // Execute right(5) with fuel=0 -> traps r01-t-fuel, rightTotal stays 7, leftTotal stays 0.
    const r3 = instance.callFunctionByName("right", &.{.{ .i32 = 5 }}, .{ .semantic_fuel = 0, .call_depth = 1 });
    try std.testing.expectEqual(.trap, r3.status);
    try std.testing.expectEqualStrings("r01-t-fuel", r3.trap.?.code);
    try std.testing.expectEqual(@as(u64, 0), r3.fuel_remaining);
    try std.testing.expectEqual(@as(?u32, 7), instance.readGlobalById(right_total_global_id).?.asI32Bits());
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalByName("leftTotal").?.asI32Bits());
}

test "exclusive lease and atomic writeback reject duplicate/unknown globals without mutating state" {
    var instance = try ci.CommonInstance.admit(alloc, right_packet, .{
        .expected_input_identity = right_input_id,
    });
    defer instance.deinit();
    try std.testing.expectEqual(.ok, instance.initialize(.{}).status);

    try std.testing.expect(instance.acquireLease());
    // Exclusive: second lease fails while active.
    try std.testing.expect(!instance.acquireLease());

    // Bad writeback with unknown id leaves rightTotal unchanged.
    var bad_id = right_total_global_id;
    bad_id[31] ^= 1;
    try std.testing.expect(!instance.commitGlobalWrites(&.{
        .{ .id = right_total_global_id, .value = .{ .i32 = 99 } },
        .{ .id = bad_id, .value = .{ .i32 = 1 } },
    }));
    try std.testing.expectEqual(@as(?u32, 0), instance.readGlobalById(right_total_global_id).?.asI32Bits());

    // Valid writeback updates rightTotal to 11.
    try std.testing.expect(instance.commitGlobalWrites(&.{
        .{ .id = right_total_global_id, .value = .{ .i32 = 11 } },
    }));
    try std.testing.expectEqual(@as(?u32, 11), instance.readGlobalById(right_total_global_id).?.asI32Bits());
    instance.releaseLease();
    try std.testing.expect(instance.acquireLease());
    instance.releaseLease();
}
