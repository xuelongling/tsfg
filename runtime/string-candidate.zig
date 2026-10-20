// SPDX-License-Identifier: MIT
// Immutable private data admission only: this handle is never a VM VerifiedModule.
const std = @import("std");
const m = @import("string-candidate-model.zig");
const decode = @import("string-candidate-decode.zig");
const proof = @import("string-candidate-verify.zig");
pub const ValidatedStringCandidate = opaque {};
pub const Failure = m.Failure;
pub const Outcome = union(enum) { loaded: *ValidatedStringCandidate, rejected: Failure };
pub const Snapshot = m.Snapshot;
fn owned(handle: *const ValidatedStringCandidate) *const m.Module {
    return @ptrCast(@alignCast(handle));
}
pub fn load(allocator: m.Allocator, bytes: []const u8) Outcome {
    if (bytes.len > 8388608) return .{ .rejected = .{ .code = "r04-string-limit", .offset = 0 } };
    if (bytes.len < 80) return .{ .rejected = .{ .code = "r04-string-truncated", .offset = 0 } };
    const module = allocator.create(m.Module) catch return .{ .rejected = .{ .code = "r04-string-allocation", .offset = 0 } };
    module.allocator = allocator;
    module.arena = std.heap.ArenaAllocator.init(allocator);
    module.bytes = module.arena.allocator().dupe(u8, bytes) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-string-allocation", .offset = 0 } };
    };
    var reader: m.Reader = .{ .bytes = module.bytes };
    const value = decode.parse(&reader, module.arena.allocator()) catch |err| {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = if (err == error.OutOfMemory) .{ .code = "r04-string-allocation", .offset = reader.offset } else reader.failure };
    };
    proof.verify(&reader, value) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = reader.failure };
    };
    module.snapshot = value;
    // All bytes and typed relations are validated before the sole publication.
    return .{ .loaded = @ptrCast(module) };
}
pub fn unload(handle: *ValidatedStringCandidate) void {
    const module: *m.Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    module.arena.deinit();
    allocator.destroy(module);
}
/// Every nested view is readonly, owned by this handle and valid only until unload.
pub fn snapshot(handle: *const ValidatedStringCandidate) Snapshot {
    return owned(handle).snapshot;
}
pub fn serialize(handle: *const ValidatedStringCandidate, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return allocator.dupe(u8, owned(handle).bytes);
}
pub fn inspect(handle: *const ValidatedStringCandidate, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return std.json.Stringify.valueAlloc(allocator, snapshot(handle), .{});
}
