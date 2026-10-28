// SPDX-License-Identifier: MIT
// Checked Source Array views over the ordinary Heap Array and collector.
const std = @import("std");
const views = @import("typed-reference-views.zig");
const finite = @import("finite-backing-domain.zig");
const codec = @import("typed-backing-value.zig");
const element = @import("array-element.zig");
const managed = @import("managed-heap.zig");
const access = @import("managed-reference-view.zig");
const Id = views.Id;
pub const Error = views.Error;
pub const Array = struct { type_id: Id, element_type: Id, domain: finite.Domain, views: []Id };
pub const Literal = codec.Active;
pub const Value = opaque {};
const Captured = struct { heap: *managed.ManagedHeap, input_identity: Id, actual_type: Id, source_view: Id, payload: access.Value };
fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
pub const Module = struct {
    arena: std.heap.ArenaAllocator, authority: views.Module, arrays: []Array,
    pub fn deinit(self: *Module) void { self.authority.deinit(); self.arena.deinit(); self.* = undefined; }
    pub fn array(self: Module, id: Id) Error!Array {
        for (self.arrays) |row| if (same(row.type_id, id)) return row;
        return error.InvalidViewModule;
    }
    fn elementType(self: Module, target: Id, writing: bool) Error!Id {
        const entry = try self.authority.layouts.find(target);
        if (!codec.container(entry.name)) return error.InvalidViewModule;
        if (writing and std.mem.startsWith(u8, entry.name, "ReadSpan<")) return error.ReadonlyField;
        return entry.layout.variants[0].references[0].type.array;
    }
    fn checked(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, writing: bool) managed.Error!Array {
        const row = try self.array(try heap.typedArrayIdentity(receiver));
        _ = try heap.typedArrayLength(receiver, row.domain.layout);
        _ = try self.elementType(target, writing);
        for (row.views) |id| if (same(id, target)) return row;
        return error.MissingView;
    }
    pub fn create(self: Module, heap: *managed.ManagedHeap, id: Id, initial: []const Literal, lifetime: managed.Lifetime) managed.Error!managed.Handle {
        const row = try self.array(id);
        const encoded = try heap.allocator.alloc(element.Value, initial.len); defer heap.allocator.free(encoded);
        var count: usize = 0; defer for (encoded[0..count]) |*value| value.deinit(heap.allocator);
        const inputs = try heap.allocator.alloc(element.Input, initial.len); defer heap.allocator.free(inputs);
        for (initial, encoded, inputs) |value, *destination, *input| {
            if (!try codec.assignment(self.authority, value.type_id, row.element_type)) return error.TypeMismatch;
            destination.* = try codec.pack(heap, self.authority, row.domain, value); count += 1;
            input.* = .{ .tag = destination.tag, .bytes = destination.bytes, .references = destination.references };
        }
        return heap.createBackedArray(self, id, inputs, lifetime);
    }
    pub fn write(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, index: u32, literal: Literal) managed.Error!void {
        const row = try self.checked(heap, receiver, target, true);
        if (!try codec.assignment(self.authority, literal.type_id, try self.elementType(target, true))) return error.TypeMismatch;
        try self.store(heap, receiver, row, index, literal);
    }
    fn store(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, row: Array, index: u32, active: Literal) managed.Error!void {
        var encoded = try codec.pack(heap, self.authority, row.domain, active); defer encoded.deinit(heap.allocator);
        try heap.storeTypedArray(receiver, row.domain.layout, index, .{ .tag = encoded.tag, .bytes = encoded.bytes, .references = encoded.references });
    }
    pub fn resize(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, count: u32) managed.Error!void {
        const row = try self.checked(heap, receiver, target, true); try heap.resizeTypedArray(receiver, row.domain.layout, count);
    }
    pub fn length(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id) managed.Error!u32 {
        const row = try self.checked(heap, receiver, target, false); return heap.typedArrayLength(receiver, row.domain.layout);
    }
    pub fn read(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, index: u32, lifetime: managed.Lifetime) managed.Error!access.Value {
        const row = try self.checked(heap, receiver, target, false);
        const layout = try row.domain.layout.clone(heap.allocator); errdefer layout.deinit(heap.allocator);
        return .{ .layout = layout, .value = try heap.readTypedArray(receiver, row.domain.layout, index, lifetime) };
    }
    pub fn capture(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, index: u32) managed.Error!*Value {
        const row = try self.checked(heap, receiver, target, false);
        const result = try heap.allocator.create(Captured); errdefer heap.allocator.destroy(result);
        result.* = .{ .heap = heap, .input_identity = self.authority.input_identity, .actual_type = row.type_id, .source_view = target,
            .payload = try self.read(heap, receiver, target, index, .persistent) };
        return @ptrCast(result);
    }
    pub fn release(self: Module, value: *Value) managed.Error!void {
        const captured: *Captured = @ptrCast(@alignCast(value));
        if (!same(captured.input_identity, self.authority.input_identity)) return error.InvalidViewModule;
        defer { captured.payload.deinit(captured.heap.allocator); captured.heap.allocator.destroy(captured); }
        for (captured.payload.value.references) |reference| if (reference) |handle| try captured.heap.release(handle);
    }
    pub fn copy(self: Module, heap: *managed.ManagedHeap, receiver: managed.Handle, target: Id, index: u32, value: *const Value) managed.Error!void {
        const captured: *const Captured = @ptrCast(@alignCast(value));
        if (captured.heap != heap or !same(captured.input_identity, self.authority.input_identity)) return error.InvalidViewModule;
        const source = try self.array(captured.actual_type); const destination = try self.checked(heap, receiver, target, true);
        var found = false; for (source.views) |id| { if (same(id, captured.source_view)) found = true; }
        if (!found or !captured.payload.layout.same(source.domain.layout)) return error.InvalidViewModule;
        if (!try codec.assignment(self.authority, try self.elementType(captured.source_view, false), try self.elementType(target, true))) return error.TypeMismatch;
        try self.store(heap, receiver, destination, index, try codec.unpack(heap, source.domain, captured.payload.value));
    }
};
pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (bytes.len > 2097152) return error.LayoutLimit;
    var arena = std.heap.ArenaAllocator.init(allocator); errdefer arena.deinit();
    var reader = finite.Reader{ .bytes = bytes, .allocator = arena.allocator() };
    if (!std.mem.eql(u8, try reader.take(8), "TSGARR01")) return error.InvalidViewModule;
    const size = std.mem.readInt(u32, (try reader.take(4))[0..4], .little);
    var authority = try views.load(allocator, try reader.take(size)); errdefer authority.deinit();
    const count = try reader.word(); if (count > 4096) return error.LayoutLimit;
    const arrays = try reader.allocator.alloc(Array, count);
    for (arrays, 0..) |*row, index| {
        const id = try reader.id(); const member = try reader.id();
        const entry = try authority.layouts.find(id);
        if (!std.mem.startsWith(u8, entry.name, "Array<") or !same(entry.layout.variants[0].references[0].type.array, member) or
            (index != 0 and std.mem.order(u8, &arrays[index - 1].type_id, &id) != .lt)) return error.InvalidViewModule;
        const domain = try reader.arrayDomain(authority); const view_count = try reader.word();
        if (view_count == 0 or view_count > 4096) return error.LayoutLimit;
        const targets = try reader.allocator.alloc(Id, view_count); var own_view = false;
        for (targets, 0..) |*target, at| {
            target.* = try reader.id(); const static = try authority.layouts.find(target.*);
            if (!codec.container(static.name) or (at != 0 and std.mem.order(u8, &targets[at - 1], target) != .lt)) return error.InvalidViewModule;
            own_view = own_view or same(id, target.*);
        }
        if (!own_view) return error.InvalidViewModule;
        row.* = .{ .type_id = id, .element_type = member, .domain = domain, .views = targets };
    }
    if (reader.at != bytes.len) return error.InvalidViewModule;
    return .{ .arena = arena, .authority = authority, .arrays = arrays };
}
