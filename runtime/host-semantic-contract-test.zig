// SPDX-License-Identifier: MIT
// Staged component test, bound to the independently frozen old real identity.
// This does not execute the VM or grant any new Runtime build authority.
const std = @import("std");
const semantics = @import("host-semantic-contract.zig");
const signature = [_]u8{118,162,179,115,179,152,101,196,235,188,88,59,246,8,79,70,242,204,157,57,108,183,211,105,83,230,125,88,111,71,42,244};
const claim = [_]u8{31,105,176,155,243,59,32,47,107,210,34,118,47,7,236,148,108,148,242,29,94,37,47,216,137,194,110,211,71,38,214,80};
test "M22 fixed compiled identity accepts only its exact Counter claim" {
    try std.testing.expect(semantics.accepts(31, &signature, &claim));
    try std.testing.expectEqual(@as(usize,16), semantics.context_bytes);
    try std.testing.expectEqual(@as(usize,8), semantics.context_alignment);
    const identity = [_]u8{ 35, 135, 27, 174, 47, 187, 94, 43, 147, 156, 201, 78, 249, 109, 248, 74, 169, 138, 196, 37, 66, 56, 188, 208, 168, 238, 71, 53, 24, 165, 24, 101 };
    try std.testing.expectEqualSlices(u8, &identity, &semantics.build_identity);
}
test "M22 capability and semantic mismatch reject independently" {
    var wrong_claim = claim;
    wrong_claim[0] ^= 1;
    var wrong_signature = signature;
    wrong_signature[31] ^= 1;
    try std.testing.expect(!semantics.accepts(32, &signature, &claim));
    try std.testing.expect(!semantics.accepts(31, &wrong_signature, &claim));
    try std.testing.expect(!semantics.accepts(31, &signature, &wrong_claim));
    const arbitrary_same_string = [_]u8{0} ** 32;
    try std.testing.expect(!semantics.accepts(31, &signature, &arbitrary_same_string));
}
