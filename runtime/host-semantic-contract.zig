// SPDX-License-Identifier: MIT
const std = @import("std");
// This module is generated after createIdentity in the formal build's owned
// stage. It cannot be supplied by a request, Counter pointer or safety flags.
const identity = @import("host_semantic_identity.zig");
pub const context_bytes = identity.context_bytes;
pub const context_alignment = identity.context_alignment;
pub const build_identity = identity.build_identity;
pub const contract_hash = identity.contract_hash;
comptime {
    if (identity.version != 1 or identity.capability_id != 31) @compileError("unsupported Counter semantic contract");
}
pub fn accepts(capability_id: u32, signature: *const [32]u8, claim: *const [32]u8) bool {
    return capability_id == identity.capability_id and
        std.mem.eql(u8, signature, &identity.signature_hash) and
        std.mem.eql(u8, claim, &identity.contract_hash);
}
