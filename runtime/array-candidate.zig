// SPDX-License-Identifier: MIT
// Explicit private admission. No conversion to VerifiedModule or execution API.
const std = @import("std");
const m = @import("array-candidate-model.zig");
const decode = @import("array-candidate-decode.zig");
const metadata = @import("array-candidate-metadata.zig");
const body = @import("array-candidate-body.zig");
const owner = @import("array-candidate-owner.zig");
const roots = @import("array-candidate-roots.zig");
const graph = @import("array-candidate-graph.zig");
const publication = @import("array-candidate-publication.zig");
pub const ValidatedArrayCandidate = opaque {};
pub const Failure = m.Failure;
pub const Snapshot = m.Snapshot;
pub const Outcome = union(enum) { loaded: *ValidatedArrayCandidate, rejected: Failure };
fn owned(handle: *const ValidatedArrayCandidate) *const m.Module {
    return @ptrCast(@alignCast(handle));
}
fn validate(r: *m.Reader, p: m.Payload) m.Error!void {
    try metadata.verify(r, p);
    try body.verify(r, p);
    const cyclic = try graph.verify(r, p);
    try publication.verifyContext(r, p, cyclic);
    const origins = try owner.ReturnOrigins.derive(r, p);
    try origins.verify(r, p);
    var work: usize = 0;
    var owner_work: usize = 0;
    var effects: publication.Analysis = .{};
    for (p.functions, 0..) |f, index| {
        const model = try owner.derive(r, p, f, &origins, &owner_work);
        try effects.add(r, p, index, &model, &owner_work);
        try owner.verify(r, p, f, &model);
        try roots.verify(r, f, &work, &model);
    }
    try effects.verify(r, p, &owner_work);
}
pub fn load(allocator: m.Allocator, bytes: []const u8) Outcome {
    if (bytes.len > 8388608) return .{ .rejected = .{ .code = "r04-array-limit", .offset = 0 } };
    if (bytes.len < 80) return .{ .rejected = .{ .code = "r04-array-truncated", .offset = 0 } };
    const module = allocator.create(m.Module) catch return .{ .rejected = .{ .code = "r04-array-allocation", .offset = 0 } };
    module.allocator = allocator;
    module.arena = std.heap.ArenaAllocator.init(allocator);
    module.bytes = module.arena.allocator().dupe(u8, bytes) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-array-allocation", .offset = 0 } };
    };
    var reader: m.Reader = .{ .bytes = module.bytes };
    const value = decode.parse(&reader, module.arena.allocator()) catch |err| {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = if (err == error.OutOfMemory) .{ .code = "r04-array-allocation", .offset = reader.offset } else reader.failure };
    };
    validate(&reader, value.payload) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = reader.failure };
    };
    module.snapshot = value;
    // One publication only, after all independent proofs; failed input is private.
    return .{ .loaded = @ptrCast(module) };
}
pub fn unload(handle: *ValidatedArrayCandidate) void {
    const module: *m.Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    module.arena.deinit();
    allocator.destroy(module);
}
/// All nested views are readonly, owned by this handle and valid until unload.
pub fn snapshot(handle: *const ValidatedArrayCandidate) Snapshot {
    return owned(handle).snapshot;
}
pub fn inspect(handle: *const ValidatedArrayCandidate, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return std.json.Stringify.valueAlloc(allocator, snapshot(handle), .{});
}
pub fn serialize(handle: *const ValidatedArrayCandidate, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return allocator.dupe(u8, owned(handle).bytes);
}
