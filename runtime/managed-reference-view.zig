// SPDX-License-Identifier: MIT
// A view changes member lookup only. Values, barriers and roots keep actual types.
const std = @import("std");
const managed = @import("managed-heap.zig");
const element = @import("array-element.zig");
const views = @import("typed-reference-views.zig");
pub const Error = managed.Error || views.Error;
pub const Value = struct {
    layout: element.Layout,
    value: element.Value,
    pub fn deinit(self: *Value, allocator: std.mem.Allocator) void { self.layout.deinit(allocator); self.value.deinit(allocator); }
};
pub const Callable = struct {
    function_id: views.Id, signature: views.Id, actual_type: views.Id, runtime_key: views.Id, receiver: managed.Handle,
};
pub fn read(heap: *managed.ManagedHeap, module: views.Module, receiver: managed.Handle,
    target: views.Id, member: views.Id, lifetime: managed.Lifetime) Error!Value {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const id = try module.field(actual, target, member);
    const field = actual.fields[try actual.fieldIndex(id)];
    const layout = try field.layout.clone(heap.allocator); errdefer layout.deinit(heap.allocator);
    return .{ .layout = layout, .value = try heap.readTypedField(receiver, actual, id, lifetime) };
}
// Input uses the actual representation returned by read, not a target field's
// physical layout. Source assignment adaptation belongs to formal lowering.
pub fn write(heap: *managed.ManagedHeap, module: views.Module, receiver: managed.Handle,
    target: views.Id, member: views.Id, value: Value) Error!void {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const id = try module.field(actual, target, member);
    if (!actual.fields[try actual.fieldIndex(id)].layout.same(value.layout)) return error.TypeMismatch;
    try heap.writeViewedField(module, receiver, target, member, value.layout,
        .{ .tag = value.value.tag, .bytes = value.value.bytes, .references = value.value.references });
}
pub fn method(heap: *managed.ManagedHeap, module: views.Module, receiver: managed.Handle,
    target: views.Id, member: views.Id, lifetime: managed.Lifetime) Error!Callable {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const selected = try module.method(actual, target, member);
    return .{ .function_id = selected.id, .signature = selected.signature, .actual_type = actual.type_id,
        .runtime_key = actual.runtime_key, .receiver = try heap.retain(receiver, lifetime) };
}
