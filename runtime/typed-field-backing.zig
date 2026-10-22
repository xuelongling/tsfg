// SPDX-License-Identifier: MIT
// A verified finite field domain owns physical backing, never a new semantic
// TypeId. Declared member permissions and full actual cell identity stay intact.
const std = @import("std");
const views = @import("typed-reference-views.zig");
const cells = @import("managed-cell.zig");
const element = @import("array-element.zig");
const managed = @import("managed-heap.zig");
const access = @import("managed-reference-view.zig");
const codec = @import("typed-backing-value.zig");
pub const Error = views.Error;
const Id = views.Id;
pub const Domain = @import("finite-backing-domain.zig").Domain;
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
        var encoded = try codec.pack(heap, self.authority, field_value.domain, .{ .type_id = source_type, .input = input });
        defer encoded.deinit(heap.allocator);
        try heap.writeViewedField(self, receiver, target, member, field_value.domain.layout,
            .{ .tag = encoded.tag, .bytes = encoded.bytes, .references = encoded.references });
    }
    fn accepted(self: Module, source: Id, target: element.Layout) Error!bool { return codec.assignment(self.authority, source, target.type_id); }
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
        const active = try codec.unpack(heap, field_value.domain, captured.payload.value);
        try self.storeActive(heap, receiver, target, member, active.type_id, active.input);
    }
    fn assignment(self: Module, from: element.Layout, to: element.Layout) Error!bool { return codec.assignment(self.authority, from.type_id, to.type_id); }
};
const Reader = @import("finite-backing-domain.zig").Reader;
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
