// SPDX-License-Identifier: MIT
// Shared finite storage domains derive physical capacity without new semantic TypeIds.
const std = @import("std");
const views = @import("typed-reference-views.zig");

const element = @import("array-element.zig");


pub const Error = views.Error;
const Id = views.Id;
pub const Domain = struct { id: Id, members: []Id, layout: element.Layout };


fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
fn aligned(n: u32, width: u8) u32 { return (n + width - 1) / width * width; }
const undefined_variant = [_]element.Variant{.{ .tag = 0, .kind = .undefined_value }};
pub fn concrete(authority: views.Module, id: Id) Error!element.Layout {
    if (authority.layouts.find(id)) |entry| return entry.layout else |err| {
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00undefined");
        if (!same(id, hash.finalResult())) return err;
        // Definition analysis may add this language intrinsic without changing
        // the Source semantic catalogue. It is absence, never native zero.
        return .{ .type_id = id, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &undefined_variant };
    }
}
pub const Reader = struct {
    bytes: []const u8, at: usize = 0, work: usize = 100000, allocator: std.mem.Allocator,
    pub fn take(self: *Reader, n: usize) Error![]const u8 {
        if (n > self.bytes.len - self.at or self.work == 0) return error.InvalidViewModule;
        self.work -= 1; const result = self.bytes[self.at..][0..n]; self.at += n; return result;
    }
    pub fn word(self: *Reader) Error!u16 { return std.mem.readInt(u16, (try self.take(2))[0..2], .little); }
    pub fn id(self: *Reader) Error!Id {
        const result: Id = (try self.take(32))[0..32].*;
        if (std.mem.allEqual(u8, &result, 0)) return error.InvalidViewModule;
        return result;
    }
    fn charge(self: *Reader, layout: element.Layout) Error!void {
        var cost: usize = 1;
        for (layout.variants) |variant| cost += 1 + variant.fields.len + variant.references.len + variant.children.len;
        if (cost > self.work) return error.LayoutLimit; self.work -= cost;
        for (layout.variants) |variant| for (variant.children) |child| try self.charge(child.layout.*);
    }
    pub fn domain(self: *Reader, authority: views.Module) Error!Domain { return self.readDomain(authority, false); }
    pub fn arrayDomain(self: *Reader, authority: views.Module) Error!Domain { return self.readDomain(authority, true); }
    fn readDomain(self: *Reader, authority: views.Module, allow_empty: bool) Error!Domain {
        const id_value = try self.id(); const count = try self.word();
        if ((!allow_empty and count == 0) or count > 256) return error.LayoutLimit;
        const members = try self.allocator.alloc(Id, count);
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.actual-domain.v1\x00[");
        for (members, 0..) |*member, index| {
            member.* = try self.id();
            if (index != 0) { if (std.mem.order(u8, &members[index - 1], member) != .lt) return error.InvalidViewModule; hash.update(","); }
            hash.update("\"sha256:"); hash.update(&std.fmt.bytesToHex(member.*, .lower)); hash.update("\"");
        }
        hash.update("]"); if (!same(id_value, hash.finalResult())) return error.InvalidViewModule;
        if (count == 0) return .{ .id = id_value, .members = members, .layout = .{
            .type_id = id_value, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &empty_variant } };
        var layout = try concrete(authority, members[0]); layout.type_id = id_value;
        var all_references = true;
        for (members) |member| {
            _ = try self.take(0);
            const candidate = try concrete(authority, member);
            if (candidate.variants.len != 1) return error.InvalidViewModule;
            const entry = authority.layouts.find(member) catch null;
            if (entry != null and std.mem.eql(u8, entry.?.name, "void")) return error.InvalidViewModule;
            all_references = all_references and entry != null and entry.?.cell != null and entry.?.cell.?.kind == .reference;
        }
        if (count != 1 and all_references) {
            const variants = try self.allocator.alloc(element.Variant, 1);
            const refs = try self.allocator.alloc(element.Reference, 1); refs[0] = .{ .slot = 0, .type = .cell_domain };
            variants[0] = .{ .tag = 0, .references = refs };
            layout = .{ .type_id = id_value, .byte_size = 0, .alignment = 1, .reference_count = 1, .variants = variants };
        } else if (count != 1) {
            layout = .{ .type_id = id_value, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &.{} };
            const variants = try self.allocator.alloc(element.Variant, count);
            for (members, variants, 0..) |member, *variant, index| {
                _ = try self.take(0);
                const child = try self.allocator.create(element.Layout); child.* = try concrete(authority, member);
                const absent = child.variants.len == 1 and child.variants[0].kind != .value;
                variant.* = .{ .tag = @intCast(index), .kind = if (absent) child.variants[0].kind else .value };
                layout.alignment = @max(layout.alignment, 2, child.alignment);
                layout.reference_count = @max(layout.reference_count, child.reference_count);
                if (!absent) {
                    const children = try self.allocator.alloc(element.Child, 1);
                    children[0] = .{ .tag_offset = 0, .offset = aligned(2, child.alignment), .reference_offset = 0, .layout = child };
                    variant.children = children; layout.byte_size = @max(layout.byte_size, children[0].offset + child.byte_size);
                }
            }
            layout.byte_size = aligned(layout.byte_size, layout.alignment); layout.variants = variants;
        }
        try self.charge(layout); try layout.validate(); return .{ .id = id_value, .members = members, .layout = layout };
    }
};
// Bottom capacity is useful only for an empty Array. No member can be encoded,
// and checked bounds reject every read; this never manufactures a native zero.
const empty_variant = [_]element.Variant{.{ .tag = 0 }};
