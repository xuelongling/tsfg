// SPDX-License-Identifier: MIT
// Decode a claim only. Authority comes from the Runtime's generated contract.
const std = @import("std");
const bytecode = @import("bytecode.zig");
pub const Error = error{ InvalidCapability, SemanticContractMissing };
pub const CounterGrant = struct { id: u32, signature: [32]u8, semantic_contract: [32]u8 };
fn readDigest(value: std.json.Value) Error![32]u8 {
    if (value != .string or value.string.len != 71 or !std.mem.startsWith(u8, value.string, "sha256:")) return error.InvalidCapability;
    var hash: [32]u8 = undefined;
    _ = std.fmt.hexToBytes(&hash, value.string[7..]) catch return error.InvalidCapability;
    const canonical = bytecode.digestText(hash);
    if (!std.mem.eql(u8, &canonical, value.string)) return error.InvalidCapability;
    return hash;
}
pub fn readCounterGrant(value: std.json.Value) Error!CounterGrant {
    if (value != .object or (value.object.count() != 3 and value.object.count() != 4)) return error.InvalidCapability;
    const id = value.object.get("id") orelse return error.InvalidCapability;
    const signature = value.object.get("signatureHash") orelse return error.InvalidCapability;
    const adapter = value.object.get("adapter") orelse return error.InvalidCapability;
    if (id != .integer or id.integer != 31 or adapter != .string or !std.mem.eql(u8, adapter.string, "counter")) return error.InvalidCapability;
    const hash = try readDigest(signature);
    const claim = value.object.get("semanticContractHash") orelse {
        if (value.object.count() == 3) return error.SemanticContractMissing;
        return error.InvalidCapability;
    };
    if (value.object.count() != 4) return error.InvalidCapability;
    return .{ .id = 31, .signature = hash, .semantic_contract = try readDigest(claim) };
}
