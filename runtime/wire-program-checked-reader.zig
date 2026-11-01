// SPDX-License-Identifier: MIT
// Sole owning composition of formal Common decoding and the canonical typed
// reference checker. Prospective only: no active legacy Runtime loader route.
const std = @import("std");
const model = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const refcheck = @import("wire-program-refcheck.zig");
pub const Error = decoder.Error || refcheck.Error;
pub const HostBundle = refcheck.HostBundle;

// The returned owned data remains unverified for complete Source, fixed upper,
// Host permission, Runtime and execution admission. This API creates no new
// validity type/token. `work` is accounting on success OR error, never proof.
// Missing Host/EffectOrigin/interpretation facts propagate unchanged; on any
// check failure, the already decoded arena is destroyed rather than returned.
pub fn readOwnedChecked(allocator: std.mem.Allocator, bytes: []const u8,
    material: ?*const HostBundle, work: *usize) Error!model.OwnedProgram {
    var remaining: usize = model.format.max_work;
    defer work.* = model.format.max_work - remaining;
    var owned = try decoder.readOwned(allocator, bytes, &remaining);
    errdefer owned.deinit();
    // Borrow precisely this owned Program for the existing canonical algorithm;
    // no shallow Program clone or decoder/checker budget refill occurs here.
    _ = try refcheck.check(allocator, &owned.program, material, &remaining);
    return owned;
}
