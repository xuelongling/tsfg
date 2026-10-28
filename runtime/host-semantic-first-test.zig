// SPDX-License-Identifier: MIT
// Frozen before semantic enforcement: a real legacy capability lacks the required contract.
const std = @import("std");
const bindings = @import("host-bindings.zig");
test "M22 first missing Host Semantic Contract rejects before any host execution" {
    const value = try std.json.parseFromSlice(std.json.Value, std.testing.allocator,
        "{\"id\":31,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"counter\"}", .{});
    defer value.deinit();
    try std.testing.expectError(error.SemanticContractMissing, bindings.readCounterGrant(value.value));
}
