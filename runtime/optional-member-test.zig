// SPDX-License-Identifier: MIT
// Actual complete selected307B Source artifacts, through existing managed
// consumers. Constructor event calls below are controlled component seams,
// not Source execution or a replacement backend.
const std = @import("std");
const managed = @import("managed-heap.zig");
const views = @import("typed-reference-views.zig");
const backing = @import("typed-field-backing.zig");
const access = @import("managed-reference-view.zig");
const codec = @import("typed-backing-value.zig");
const allocator = std.testing.allocator;
const root = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M20-member-presence-core-checks-20261025/captures/";
test "affected existing typed view backing and domain consumers" {
    _ = @import("typed-reference-view-test.zig");
    _ = @import("typed-field-backing-test.zig");
    _ = @import("typed-reference-domain-test.zig");
}
fn bytes(name: []const u8) ![]u8 {
    const path = try std.mem.concat(allocator, u8, &.{ root, name, ".bin" }); defer allocator.free(path);
    return std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, allocator, .limited(2097152));
}
fn same(a: views.Id, b: views.Id) bool { return std.mem.eql(u8, &a, &b); }
const Selected = struct { target: views.Id, member: views.Id, missing: views.Id, present: views.Id, present_field: views.Id };
fn selected(module: backing.Module) !Selected {
    const declaration = for (module.authority.declarations) |value| {
        if (value.optional and std.mem.eql(u8, value.name, "value")) break value;
    } else return error.MissingOptionalDeclaration;
    var missing: ?views.Id = null; var present: ?views.Id = null; var actual_field: ?views.Id = null;
    for (module.authority.views) |view| if (same(view.target, declaration.owner)) {
        for (view.fields) |pair| if (same(pair.target, declaration.id)) {
            if (pair.missing) missing = view.actual else { present = view.actual; actual_field = pair.source; }
        };
    };
    return .{ .target = declaration.owner, .member = declaration.id, .missing = missing orelse return error.MissingAbsentView,
        .present = present orelse return error.MissingActualView, .present_field = actual_field.? };
}
fn undefinedId() views.Id {
    var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00undefined"); return hash.finalResult();
}
fn word(raw: []const u8, at: *usize) u16 { const result = std.mem.readInt(u16, raw[at.*..][0..2], .little); at.* += 2; return result; }
fn absenceOffsets(raw: []const u8) !struct { optional: usize, declared: usize, actual_pair: usize } {
    var at: usize = 44 + std.mem.readInt(u32, raw[40..44], .little);
    const count = word(raw, &at); var optional: ?usize = null; var declared: usize = 0; var member: views.Id = undefined;
    for (0..count) |_| {
        const id: views.Id = raw[at + 32 ..][0..32].*; at += 64;
        const length = word(raw, &at); at += length + 64;
        if (raw[at] == 1) { optional = at; declared = at - 32; member = id; } at += 1;
    }
    const methods = word(raw, &at);
    for (0..methods) |_| { at += 96; const flag = raw[at]; at += 1 + @as(usize, flag) * 32; }
    const count_views = word(raw, &at);
    for (0..count_views) |_| {
        at += 64; const fields = word(raw, &at);
        for (0..fields) |_| {
            const flag_at = at; const flag = raw[at]; at += 1;
            if (flag == 0) at += 32;
            const target: views.Id = raw[at..][0..32].*; at += 32;
            if (flag == 0 and same(target, member)) return .{ .optional = optional.?, .declared = declared, .actual_pair = flag_at };
        }
        const count_methods = word(raw, &at); at += @as(usize, count_methods) * 64;
    }
    return error.NoActualOptionalPair;
}
fn defineUndefined(module: backing.Module, heap: *managed.ManagedHeap, receiver: managed.Handle, owner: views.Id, field: views.Id) !void {
    const cell = try module.cell(owner); const index = try cell.backing.fieldIndex(field);
    var encoded = try codec.pack(heap, module.authority, cell.fields[index].domain,
        .{ .type_id = undefinedId(), .input = .{ .bytes = &.{}, .references = &.{} } }); defer encoded.deinit(heap.allocator);
    // Existing internal construction-event commit, separate from explicit
    // source assignment's declared-type permission.
    try heap.writeTypedField(receiver, cell.backing, field,
        .{ .tag = encoded.tag, .bytes = encoded.bytes, .references = encoded.references }, true);
}
test "actual Missing read is native undefined and Present(undefined) remains present across moving GC and capture" {
    const raw = try bytes("fields"); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit(); const s = try selected(module);
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const absent = try module.create(&heap, s.missing, .persistent);
    const present = try module.create(&heap, s.present, .persistent);
    const maybe = try module.create(&heap, s.target, .persistent);
    try std.testing.expect(!try module.present(&heap, absent, s.target, s.member));
    try std.testing.expect(!try module.present(&heap, maybe, s.target, s.member));
    try module.write(&heap, present, s.present, s.present_field, undefinedId(), .{ .bytes = &.{}, .references = &.{} });
    try std.testing.expect(try module.present(&heap, present, s.target, s.member));
    try std.testing.expectError(error.TypeMismatch, module.write(&heap, maybe, s.target, s.member, undefinedId(), .{ .bytes = &.{}, .references = &.{} }));
    try std.testing.expect(!try module.present(&heap, maybe, s.target, s.member));
    try defineUndefined(module, &heap, maybe, s.target, s.member);
    try std.testing.expect(try module.present(&heap, maybe, s.target, s.member));
    var empty = try module.read(&heap, absent, s.target, s.member, .persistent); defer empty.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 0), empty.layout.byte_size);
    try std.testing.expectEqual(@as(u16, 0), empty.layout.reference_count);
    try std.testing.expectEqual(@as(usize, 0), empty.value.bytes.len);
    try std.testing.expectEqual(@as(usize, 0), empty.value.references.len);
    try std.testing.expectEqual(.undefined_value, (try empty.layout.selectVariant(empty.value.tag)).kind);
    const captured = try module.capture(&heap, absent, s.target, s.member); defer module.release(captured) catch unreachable;
    try std.testing.expectError(error.TypeMismatch, module.copy(&heap, maybe, s.target, s.member, captured));
    try module.copy(&heap, present, s.present, s.present_field, captured);
    try heap.collect();
    try std.testing.expect(!try module.present(&heap, absent, s.target, s.member));
    try std.testing.expect(try module.present(&heap, present, s.target, s.member));
    var result = try module.read(&heap, present, s.target, s.member, .persistent); defer result.deinit(allocator);
    try std.testing.expectEqual(.undefined_value, (try result.layout.selectVariant(result.value.tag)).kind);
    const unknown = [_]u8{99} ** 32;
    try std.testing.expectError(error.InvalidViewMember, module.read(&heap, absent, s.target, unknown, .persistent));
}
test "TSGVIEW2 rejects old-magic relabels truncation and malformed discriminants transactionally" {
    const raw = try bytes("views"); defer allocator.free(raw);
    var module = try views.load(allocator, raw); module.deinit();
    const corrupt = try allocator.dupe(u8, raw); defer allocator.free(corrupt);
    corrupt[7] = '1'; try std.testing.expectError(error.InvalidViewModule, views.load(allocator, corrupt));
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, raw[0 .. raw.len - 1]));
    const offsets = try absenceOffsets(raw); @memcpy(corrupt, raw);
    corrupt[offsets.optional] = 0; try std.testing.expectError(error.InvalidViewModule, views.load(allocator, corrupt));
    @memcpy(corrupt, raw); @memcpy(corrupt[offsets.declared..][0..32], &undefinedId());
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, corrupt));
    @memcpy(corrupt, raw); corrupt[offsets.actual_pair] = 2;
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, corrupt));
    // A structurally valid missing discriminant cannot conceal the actual
    // same-name field. Remove its source ID, keeping the following grammar.
    const forged = try allocator.alloc(u8, raw.len - 32); defer allocator.free(forged);
    @memcpy(forged[0 .. offsets.actual_pair + 1], raw[0 .. offsets.actual_pair + 1]); forged[offsets.actual_pair] = 1;
    @memcpy(forged[offsets.actual_pair + 1 ..], raw[offsets.actual_pair + 33 ..]);
    try std.testing.expectError(error.InvalidViewModule, views.load(allocator, forged));
    for (0..512) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = offset });
        var decoded = views.load(failing.allocator(), raw) catch |err| { try std.testing.expectEqual(error.OutOfMemory, err); continue; };
        decoded.deinit(); break;
    } else return error.NoSuccessfulDecode;
}
test "missing read and opaque capture allocate transactionally without adding roots" {
    const raw = try bytes("fields"); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit(); const s = try selected(module);
    var failures: usize = 0;
    for (0..64) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.authority.layouts);
        const object = try module.create(&heap, s.missing, .persistent);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        const captured = module.capture(&heap, object, s.target, s.member) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1;
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try std.testing.expect(!try module.present(&heap, object, s.target, s.member));
            try heap.collect(); try std.testing.expectEqual(@as(usize, 1), try heap.objectCount()); continue;
        };
        try module.release(captured); break;
    } else return error.NoSuccessfulCapture;
    try std.testing.expect(failures > 0);
}
