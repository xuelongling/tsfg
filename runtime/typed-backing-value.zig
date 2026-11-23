// SPDX-License-Identifier: MIT
// Concrete active encoding and static assignment are separate operations.
const std = @import("std");
const views = @import("typed-reference-views.zig");
const finite = @import("finite-backing-domain.zig");
const element = @import("array-element.zig");
const managed = @import("managed-heap.zig");
const Id = views.Id;
fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
fn memberIndex(members: []const Id, type_id: Id) ?usize {
    for (members, 0..) |id, index| if (same(id, type_id)) return index;
    return null;
}
pub const Active = struct { type_id: Id, input: element.Input };
pub fn assignment(authority: views.Module, from: Id, to: Id) views.Error!bool {
    var work: usize = 100000; return relation(authority, from, to, 0, &work);
}
fn relation(authority: views.Module, from: Id, to: Id, depth: usize, work: *usize) views.Error!bool {
    if (depth > 32 or work.* == 0) return error.LayoutLimit; work.* -= 1;
    if (same(from, to)) return true;
    const source = try finite.concrete(authority, from); const target = try finite.concrete(authority, to);
    const a = authority.layouts.find(from) catch null; const b = authority.layouts.find(to) catch null;
    if (a != null and std.mem.startsWith(u8, a.?.name, "Union<")) {
        for (source.variants) |variant| {
            const id = try member(authority, variant);
            if (!try relation(authority, id, to, depth + 1, work)) return false;
        }
        return true;
    }
    if (b != null and std.mem.startsWith(u8, b.?.name, "Union<")) {
        for (target.variants) |variant| if (try relation(authority, from, try member(authority, variant), depth + 1, work)) return true;
        return false;
    }
    if (a != null and b != null) {
        if (container(a.?.name) and container(b.?.name)) {
            if (std.mem.startsWith(u8, a.?.name, "ReadSpan<") and std.mem.startsWith(u8, b.?.name, "Array<")) return false;
            return relation(authority, source.variants[0].references[0].type.array, target.variants[0].references[0].type.array, depth + 1, work);
        }
        if (a.?.cell != null and b.?.cell != null and a.?.cell.?.kind == .reference and b.?.cell.?.kind == .reference) {
            _ = authority.view(a.?.cell.?, to) catch |err| { if (err == error.MissingView) return false else return err; };
            return true;
        }
    }
    return false;
}
pub fn container(name: []const u8) bool { return std.mem.startsWith(u8, name, "Array<") or std.mem.startsWith(u8, name, "ReadSpan<"); }
fn member(authority: views.Module, variant: element.Variant) views.Error!Id {
    _ = authority;
    if (variant.kind == .value) {
        if (variant.children.len != 1) return error.InvalidViewModule;
        return variant.children[0].layout.type_id;
    }
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(if (variant.kind == .undefined_value) "tsfg.type\x00undefined" else "tsfg.type\x00null"); return hash.finalResult();
}
pub fn pack(heap: *managed.ManagedHeap, authority: views.Module, domain: finite.Domain, active: Active) managed.Error!element.Value {
    const source = try finite.concrete(authority, active.type_id);
    _ = try source.checkBytes(active.input.tag, active.input.bytes);
    if (active.input.references.len != source.reference_count) return error.TypeMismatch;
    const index = memberIndex(domain.members, active.type_id) orelse return error.TypeMismatch;
    const layout = domain.layout;
    const bytes = try heap.allocator.alloc(u8, layout.byte_size); errdefer heap.allocator.free(bytes); @memset(bytes, 0);
    const references = try heap.allocator.alloc(?managed.Handle, layout.reference_count); errdefer heap.allocator.free(references); @memset(references, null);
    var tag: u16 = @intCast(index);
    if (domain.members.len == 1) {
        tag = active.input.tag; source.copyBytes(tag, bytes, active.input.bytes); @memcpy(references, active.input.references);
    } else if (layout.variants.len == 1) {
        tag = 0;
        if (references.len != 1 or active.input.references[0] == null) return error.TypeMismatch;
        if (!same(try heap.typedCellIdentity(active.input.references[0].?), active.type_id)) return error.TypeMismatch;
        @memcpy(references, active.input.references);
    } else if (layout.variants[index].kind == .value) {
        const child = layout.variants[index].children[0];
        std.mem.writeInt(u16, bytes[child.tag_offset..][0..2], active.input.tag, .little);
        source.copyBytes(active.input.tag, bytes[child.offset..][0..source.byte_size], active.input.bytes);
        @memcpy(references[child.reference_offset..][0..source.reference_count], active.input.references);
    }
    return .{ .tag = tag, .bytes = bytes, .references = references };
}
pub fn unpack(heap: *managed.ManagedHeap, domain: finite.Domain, value: element.Value) managed.Error!Active {
    if (domain.members.len == 1) return .{ .type_id = domain.members[0], .input = .{ .tag = value.tag, .bytes = value.bytes, .references = value.references } };
    if (domain.layout.variants.len == 1) {
        if (value.references.len != 1) return error.InvalidArrayElement;
        const handle = value.references[0] orelse return error.InvalidArrayElement;
        const type_id = try heap.typedCellIdentity(handle);
        if (memberIndex(domain.members, type_id) == null) return error.InvalidArrayElement;
        return .{ .type_id = type_id, .input = .{ .bytes = &.{}, .references = value.references } };
    }
    const variant = try domain.layout.selectVariant(value.tag);
    if (value.tag >= domain.members.len) return error.InvalidArrayElement;
    const id = domain.members[value.tag];
    if (variant.kind != .value) return .{ .type_id = id, .input = .{ .bytes = &.{}, .references = &.{} } };
    const child = variant.children[0];
    return .{ .type_id = id, .input = .{ .tag = element.childTag(child, value.bytes), .bytes = value.bytes[child.offset..][0..child.layout.byte_size],
        .references = value.references[child.reference_offset..][0..child.layout.reference_count] } };
}
