// SPDX-License-Identifier: MIT
const std = @import("std");
const bindings = @import("host-bindings.zig");
fn read(text: []const u8) !bindings.CounterGrant {
    const value = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, text, .{});
    defer value.deinit();
    return bindings.readCounterGrant(value.value);
}
// Old shape preservation was checked before contract enforcement (22a summary).
// This intentional internal protocol revision requires an explicit claim.
test "M22 current grant retains scalar authorization and exact contract claim" {
    const text = "{\"id\":31,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"counter\",\"semanticContractHash\":\"sha256:1f69b09bf33b202f6bd222762f07ec946c94f21d5e252fd889c26ed34726d650\"}";
    const actual = try read(text);
    try std.testing.expectEqual(@as(u32, 31), actual.id);
    const signature = [_]u8{118,162,179,115,179,152,101,196,235,188,88,59,246,8,79,70,242,204,157,57,108,183,211,105,83,230,125,88,111,71,42,244};
    try std.testing.expectEqualSlices(u8, &signature, &actual.signature);
    const claim = [_]u8{31,105,176,155,243,59,32,47,107,210,34,118,47,7,236,148,108,148,242,29,94,37,47,216,137,194,110,211,71,38,214,80};
    try std.testing.expectEqualSlices(u8, &claim, &actual.semantic_contract);
}
test "M22 malformed grant never supplies semantic authority" {
    const values = [_][]const u8{
        "null", "{}",
        "{\"id\":32,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"counter\"}",
        "{\"id\":31,\"signatureHash\":\"bad\",\"adapter\":\"counter\"}",
        "{\"id\":31,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"other\"}",
        "{\"id\":31,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"counter\",\"extra\":0}",
        "{\"id\":31,\"signatureHash\":\"sha256:76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4\",\"adapter\":\"counter\",\"semanticContractHash\":null}",
    };
    for (values) |value| try std.testing.expectError(error.InvalidCapability, read(value));
}
