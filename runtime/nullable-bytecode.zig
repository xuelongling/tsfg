// SPDX-License-Identifier: MIT
// Real private-format cold admission. A distinct opaque type cannot enter the scalar VM.
const std = @import("std");
const m = @import("nullable-model.zig");
const decode = @import("nullable-decode.zig");
const cfg = @import("nullable-cfg.zig");
const tags = @import("nullable-tags.zig");
pub const VerifiedNullableModule = opaque {};
pub const Failure = m.Failure;
pub const Outcome = union(enum) { loaded: *VerifiedNullableModule, rejected: Failure };
pub const Snapshot = m.Snapshot;
fn owned(handle: *const VerifiedNullableModule) *const m.Module {
    return @ptrCast(@alignCast(handle));
}

fn verify(reader: *m.Reader, allocator: m.Allocator, module: *m.Module) m.Error!void {
    module.snapshot = try decode.parse(reader, module.arena.allocator());
    for (module.snapshot.functions) |function| {
        // Analysis state is temporary per function, bounded independently of module ownership.
        var scratch = std.heap.ArenaAllocator.init(allocator);
        defer scratch.deinit();
        const graph = try cfg.verify(reader, scratch.allocator(), function, module.snapshot.functions);
        try tags.verify(reader, scratch.allocator(), function, graph);
    }
}
pub fn load(allocator: m.Allocator, bytes: []const u8) Outcome {
    if (bytes.len > 1048576) return .{ .rejected = .{ .code = "r04-nullable-limit", .offset = 0 } };
    const module = allocator.create(m.Module) catch return .{ .rejected = .{ .code = "r04-nullable-allocation", .offset = 0 } };
    module.allocator = allocator;
    module.arena = std.heap.ArenaAllocator.init(allocator);
    module.bytes = module.arena.allocator().dupe(u8, bytes) catch {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = .{ .code = "r04-nullable-allocation", .offset = 0 } };
    };
    var reader: m.Reader = .{ .bytes = module.bytes };
    verify(&reader, allocator, module) catch |err| {
        module.arena.deinit();
        allocator.destroy(module);
        return .{ .rejected = if (err == error.OutOfMemory) .{ .code = "r04-nullable-allocation", .offset = reader.offset } else reader.failure };
    };
    // No partially decoded or merely hash-valid packet crosses this publication point.
    return .{ .loaded = @ptrCast(module) };
}
pub fn unload(handle: *VerifiedNullableModule) void {
    const module: *m.Module = @ptrCast(@alignCast(handle));
    const allocator = module.allocator;
    module.arena.deinit();
    allocator.destroy(module);
}
/// All borrowed nested slices are readonly and valid only until unload.
pub fn snapshot(handle: *const VerifiedNullableModule) Snapshot {
    return owned(handle).snapshot;
}
pub fn serialize(handle: *const VerifiedNullableModule, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return allocator.dupe(u8, owned(handle).bytes);
}
pub fn inspect(handle: *const VerifiedNullableModule, allocator: m.Allocator) m.Allocator.Error![]u8 {
    return std.json.Stringify.valueAlloc(allocator, snapshot(handle), .{});
}
