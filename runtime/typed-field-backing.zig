// SPDX-License-Identifier: MIT
// A verified finite field domain owns physical backing, never a new semantic
// TypeId. Declared member permissions and full actual cell identity stay intact.
const std = @import("std");
const views = @import("typed-reference-views.zig");
const cells = @import("managed-cell.zig");
const element = @import("array-element.zig");
const managed = @import("managed-heap.zig");
const access = @import("managed-reference-view.zig");
pub const Error = views.Error;
const Id = views.Id;
pub const Domain = struct { id: Id, members: []Id, layout: element.Layout };
pub const Field = struct { id: Id, semantic_type: Id, domain: Domain };
pub const Cell = struct { declared: cells.Layout, backing: cells.Layout, fields: []Field };
// Only a checked capture constructs this carrier. A caller cannot substitute a
// target type or a bool for the original static member authority.
pub const Value = opaque {};
const Captured = struct {
    heap: *managed.ManagedHeap, input_identity: Id, actual_type: Id, actual_field: Id,
    source_view: Id, source_member: Id, payload: access.Value,
};
fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
fn aligned(n: u32, width: u8) u32 { return (n + width - 1) / width * width; }
const undefined_variant = [_]element.Variant{.{ .tag = 0, .kind = .undefined_value }};
fn concrete(authority: views.Module, id: Id) Error!element.Layout {
    if (authority.layouts.find(id)) |entry| return entry.layout else |err| {
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00undefined");
        if (!same(id, hash.finalResult())) return err;
        // Definition analysis may add this language intrinsic without changing
        // the Source semantic catalogue. It is absence, never native zero.
        return .{ .type_id = id, .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &undefined_variant };
    }
}
pub const Module = struct {
    arena: std.heap.ArenaAllocator, authority: views.Module, cells: []Cell,
    pub fn deinit(self: *Module) void { self.authority.deinit(); self.arena.deinit(); self.* = undefined; }
    pub fn cell(self: Module, id: Id) Error!Cell {
        for (self.cells) |value| if (same(value.backing.type_id, id)) return value;
        return error.InvalidViewModule;
    }
    fn actual(self: Module, layout: cells.Layout) Error!Cell {
        const value = try self.cell(layout.type_id);
        if (!value.backing.same(layout)) return error.InvalidViewModule;
        return value;
    }
    pub fn field(self: Module, layout: cells.Layout, target: Id, member: Id) Error!Id {
        return self.authority.field((try self.actual(layout)).declared, target, member);
    }
    pub fn readonly(self: Module, target: Id, member: Id) Error!bool { return self.authority.readonly(target, member); }
    pub fn method(self: Module, layout: cells.Layout, target: Id, member: Id) Error!views.Method {
        return self.authority.method((try self.actual(layout)).declared, target, member);
    }
    pub fn create(self: Module, heap: *managed.ManagedHeap, id: Id, lifetime: managed.Lifetime) managed.Error!managed.Handle {
        return heap.createBackedCell(self, id, lifetime);
    }
    // The source carrier supplies its concrete active member and canonical
    // payload. Packing is production code; inactive bytes/references stay zero.
    // Static target permission is checked before any mutation or root publish.
    pub fn write(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, member: Id,
        source_type: Id, input: element.Input) managed.Error!void {
        const target_cell = (try self.authority.layouts.find(target)).cell orelse return error.InvalidViewModule;
        const target_layout = target_cell.fields[try target_cell.fieldIndex(member)].layout;
        if (!try self.accepted(source_type, target_layout)) return error.TypeMismatch;
        try self.storeActive(heap, receiver, target, member, source_type, input);
    }
    fn storeActive(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, member: Id,
        source_type: Id, input: element.Input) managed.Error!void {
        const actual_layout = try heap.copyTypedCellLayout(receiver); defer actual_layout.deinit(heap.allocator);
        const row = try self.actual(actual_layout);
        const id = try self.field(actual_layout, target, member);
        if (try self.readonly(target, member)) return error.ReadonlyField;
        const field_value = row.fields[try actual_layout.fieldIndex(id)];
        const source_layout = try concrete(self.authority, source_type);
        _ = try source_layout.checkBytes(input.tag, input.bytes);
        if (input.references.len != source_layout.reference_count) return error.TypeMismatch;
        var selected: ?usize = null;
        for (field_value.domain.members, 0..) |value, index| if (same(value, source_type)) { selected = index; break; };
        const index = selected orelse return error.TypeMismatch;
        const layout = field_value.domain.layout;
        const bytes = try heap.allocator.alloc(u8, layout.byte_size); defer heap.allocator.free(bytes); @memset(bytes, 0);
        const references = try heap.allocator.alloc(?managed.Handle, layout.reference_count); defer heap.allocator.free(references); @memset(references, null);
        if (field_value.domain.members.len == 1) {
            source_layout.copyBytes(input.tag, bytes, input.bytes); @memcpy(references, input.references);
        } else if (layout.variants.len == 1) {
            if (input.references.len != 1 or input.references[0] == null) return error.TypeMismatch;
            const header = try heap.copyTypedCellLayout(input.references[0].?); defer header.deinit(heap.allocator);
            if (!same(header.type_id, source_type)) return error.TypeMismatch;
            @memcpy(references, input.references);
        } else if (layout.variants[index].kind == .value) {
            const child = layout.variants[index].children[0];
            std.mem.writeInt(u16, bytes[child.tag_offset..][0..2], input.tag, .little);
            source_layout.copyBytes(input.tag, bytes[child.offset..][0..source_layout.byte_size], input.bytes);
            @memcpy(references[child.reference_offset..][0..source_layout.reference_count], input.references);
        }
        try heap.writeViewedField(self, receiver, target, member, layout, .{
            .tag = if (layout.variants.len == 1) input.tag else @intCast(index), .bytes = bytes, .references = references });
    }
    fn accepted(self: Module, source: Id, target: element.Layout) Error!bool {
        if (same(source, target.type_id)) return true;
        const target_entry = try self.authority.layouts.find(target.type_id);
        if (std.mem.startsWith(u8, target_entry.name, "Union<")) for (target.variants) |variant| {
            if (variant.kind != .value) {
                const source_layout = try concrete(self.authority, source);
                if (source_layout.variants.len == 1 and source_layout.variants[0].kind == variant.kind) return true;
            }
            for (variant.children) |child| if (try self.accepted(source, child.layout.*)) return true;
        };
        if (target_entry.cell == null or target_entry.cell.?.kind != .reference) return false;
        const from = (try self.authority.layouts.find(source)).cell orelse return false;
        if (from.kind != .reference) return false;
        _ = self.authority.view(from, target.type_id) catch |err| { if (err == error.MissingView) return false else return err; };
        return true;
    }
    pub fn read(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, member: Id,
        lifetime: managed.Lifetime) managed.Error!access.Value {
        return access.read(heap, self, receiver, target, member, lifetime);
    }
    // The captured payload owns persistent roots, independent of the source
    // object's later mutation or scope. All fallible provenance/allocation work
    // precedes read's transactional root publication.
    pub fn capture(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, member: Id) managed.Error!*Value {
        const actual_layout = try heap.copyTypedCellLayout(receiver); defer actual_layout.deinit(heap.allocator);
        const actual_field = try self.field(actual_layout, target, member);
        const result = try heap.allocator.create(Captured); errdefer heap.allocator.destroy(result);
        result.* = .{ .heap = heap, .input_identity = self.authority.input_identity, .actual_type = actual_layout.type_id,
            .actual_field = actual_field, .source_view = target, .source_member = member,
            .payload = try access.read(heap, self, receiver, target, member, .persistent) };
        return @ptrCast(result);
    }
    pub fn release(self: Module, value: *Value) managed.Error!void {
        const captured: *Captured = @ptrCast(@alignCast(value));
        if (!same(captured.input_identity, self.authority.input_identity)) return error.InvalidViewModule;
        defer { captured.payload.deinit(captured.heap.allocator); captured.heap.allocator.destroy(captured); }
        for (captured.payload.value.references) |reference| if (reference) |handle| try captured.heap.release(handle);
    }
    pub fn copy(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, member: Id, value: *const Value) managed.Error!void {
        const captured: *const Captured = @ptrCast(@alignCast(value));
        if (captured.heap != heap or !same(captured.input_identity, self.authority.input_identity)) return error.InvalidViewModule;
        const source = try self.cell(captured.actual_type);
        if (!same(try self.authority.field(source.declared, captured.source_view, captured.source_member), captured.actual_field)) return error.InvalidViewModule;
        const source_static = (try self.authority.layouts.find(captured.source_view)).cell orelse return error.InvalidViewModule;
        const target_static = (try self.authority.layouts.find(target)).cell orelse return error.InvalidViewModule;
        const from = source_static.fields[try source_static.fieldIndex(captured.source_member)].layout;
        const to = target_static.fields[try target_static.fieldIndex(member)].layout;
        if (!try self.assignment(from, to)) return error.TypeMismatch;
        const field_value = source.fields[try source.backing.fieldIndex(captured.actual_field)];
        if (!captured.payload.layout.same(field_value.domain.layout)) return error.InvalidViewModule;
        const payload = captured.payload.value; const layout = field_value.domain.layout;
        if (field_value.domain.members.len == 1) {
            try self.storeActive(heap, receiver, target, member, field_value.domain.members[0],
                .{ .tag = payload.tag, .bytes = payload.bytes, .references = payload.references });
        } else if (layout.variants.len == 1) {
            const handle = payload.references[0] orelse return error.InvalidArrayElement;
            const header = try heap.copyTypedCellLayout(handle); defer header.deinit(heap.allocator);
            try self.storeActive(heap, receiver, target, member, header.type_id, .{ .bytes = &.{}, .references = payload.references });
        } else {
            const variant = try layout.selectVariant(payload.tag);
            const active = field_value.domain.members[payload.tag];
            if (variant.kind != .value) try self.storeActive(heap, receiver, target, member, active, .{ .bytes = &.{}, .references = &.{} })
            else {
                const child = variant.children[0];
                try self.storeActive(heap, receiver, target, member, active, .{ .tag = element.childTag(child, payload.bytes),
                    .bytes = payload.bytes[child.offset..][0..child.layout.byte_size],
                    .references = payload.references[child.reference_offset..][0..child.layout.reference_count] });
            }
        }
    }
    fn assignment(self: Module, from: element.Layout, to: element.Layout) Error!bool {
        if (same(from.type_id, to.type_id)) return true;
        const entry = try self.authority.layouts.find(from.type_id);
        if (!std.mem.startsWith(u8, entry.name, "Union<")) return self.accepted(from.type_id, to);
        for (from.variants) |variant| {
            if (variant.kind == .value) { if (!try self.accepted(variant.children[0].layout.type_id, to)) return false; }
            else {
                var hash = std.crypto.hash.sha2.Sha256.init(.{});
                hash.update(if (variant.kind == .undefined_value) "tsfg.type\x00undefined" else "tsfg.type\x00null");
                if (!try self.accepted(hash.finalResult(), to)) return false;
            }
        }
        return true;
    }
};
const Reader = struct {
    bytes: []const u8, at: usize = 0, work: usize = 100000, allocator: std.mem.Allocator,
    fn take(self: *Reader, n: usize) Error![]const u8 {
        if (n > self.bytes.len - self.at or self.work == 0) return error.InvalidViewModule;
        self.work -= 1; const result = self.bytes[self.at..][0..n]; self.at += n; return result;
    }
    fn word(self: *Reader) Error!u16 { return std.mem.readInt(u16, (try self.take(2))[0..2], .little); }
    fn id(self: *Reader) Error!Id {
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
    fn domain(self: *Reader, authority: views.Module) Error!Domain {
        const id_value = try self.id(); const count = try self.word();
        if (count == 0 or count > 256) return error.LayoutLimit;
        const members = try self.allocator.alloc(Id, count);
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.actual-domain.v1\x00[");
        for (members, 0..) |*member, index| {
            member.* = try self.id();
            if (index != 0) { if (std.mem.order(u8, &members[index - 1], member) != .lt) return error.InvalidViewModule; hash.update(","); }
            hash.update("\"sha256:"); hash.update(&std.fmt.bytesToHex(member.*, .lower)); hash.update("\"");
        }
        hash.update("]"); if (!same(id_value, hash.finalResult())) return error.InvalidViewModule;
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
pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (bytes.len > 2097152) return error.LayoutLimit;
    var arena = std.heap.ArenaAllocator.init(allocator); errdefer arena.deinit();
    var reader = Reader{ .bytes = bytes, .allocator = arena.allocator() };
    if (!std.mem.eql(u8, try reader.take(8), "TSGFLD01")) return error.InvalidViewModule;
    const size = std.mem.readInt(u32, (try reader.take(4))[0..4], .little);
    var authority = try views.load(allocator, try reader.take(size)); errdefer authority.deinit();
    const count = try reader.word(); if (count > 4096) return error.LayoutLimit;
    const entries = try reader.allocator.alloc(Cell, count);
    for (entries, 0..) |*entry, index| {
        const id = try reader.id(); const declared = (try authority.layouts.find(id)).cell orelse return error.InvalidViewModule;
        if (declared.kind != .reference or (index != 0 and std.mem.order(u8, &entries[index - 1].declared.type_id, &id) != .lt)) return error.InvalidViewModule;
        const fields_count = try reader.word(); if (fields_count != declared.fields.len) return error.InvalidViewModule;
        const fields = try reader.allocator.alloc(Field, fields_count); const physical = try reader.allocator.alloc(cells.Field, fields_count);
        var backing = declared; backing.byte_size = 0; backing.alignment = 1; backing.reference_count = 0;
        for (fields, physical, declared.fields) |*field_value, *destination, source| {
            if (!same(try reader.id(), source.id)) return error.InvalidViewModule;
            const domain = try reader.domain(authority);
            field_value.* = .{ .id = source.id, .semantic_type = source.layout.type_id, .domain = domain };
            destination.* = .{ .id = source.id, .readonly = source.readonly, .layout = domain.layout,
                .offset = aligned(backing.byte_size, domain.layout.alignment), .reference_offset = backing.reference_count };
            backing.byte_size = destination.offset + domain.layout.byte_size; backing.alignment = @max(backing.alignment, domain.layout.alignment);
            const refs = @as(u32, backing.reference_count) + domain.layout.reference_count;
            if (refs > 256) return error.LayoutLimit; backing.reference_count = @intCast(refs);
        }
        backing.byte_size = aligned(backing.byte_size, backing.alignment); backing.fields = physical; try backing.validate();
        entry.* = .{ .declared = declared, .backing = backing, .fields = fields };
    }
    if (reader.at != bytes.len) return error.InvalidViewModule;
    return .{ .arena = arena, .authority = authority, .cells = entries };
}
