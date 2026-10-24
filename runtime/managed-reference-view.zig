// SPDX-License-Identifier: MIT
// A view changes member lookup only. Values, barriers and roots keep actual types.
const std = @import("std");
const managed = @import("managed-heap.zig");
const element = @import("array-element.zig");
const views = @import("typed-reference-views.zig");
const codec = @import("typed-backing-value.zig");
pub const Error = managed.Error || views.Error;
pub const Value = struct {
    layout: element.Layout,
    value: element.Value,
    pub fn deinit(self: *Value, allocator: std.mem.Allocator) void { self.layout.deinit(allocator); self.value.deinit(allocator); }
};
pub const Callable = struct {
    function_id: views.Id, signature: views.Id, actual_type: views.Id, runtime_key: views.Id, receiver: managed.Handle,
};
pub fn undefinedValue(allocator: std.mem.Allocator) Error!Value {
    var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00undefined");
    const variants = [_]element.Variant{.{ .tag = 0, .kind = .undefined_value }};
    const source = element.Layout{ .type_id = hash.finalResult(), .byte_size = 0, .alignment = 1, .reference_count = 0, .variants = &variants };
    const layout = try source.clone(allocator); errdefer layout.deinit(allocator);
    const bytes = try allocator.alloc(u8, 0); errdefer allocator.free(bytes);
    return .{ .layout = layout, .value = .{ .tag = 0, .bytes = bytes, .references = try allocator.alloc(?managed.Handle, 0) } };
}
pub fn present(heap: *managed.ManagedHeap, module: anytype, receiver: managed.Handle, target: views.Id, member: views.Id) Error!bool {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    return switch (try module.resolveField(actual, target, member)) {
        .missing => false, .actual => |id| try heap.hasTypedField(receiver, actual, id),
    };
}
pub fn read(heap: *managed.ManagedHeap, module: anytype, receiver: managed.Handle,
    target: views.Id, member: views.Id, lifetime: managed.Lifetime) Error!Value {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const id = switch (try module.resolveField(actual, target, member)) { .missing => return undefinedValue(heap.allocator), .actual => |id| id };
    const field = actual.fields[try actual.fieldIndex(id)];
    const layout = try field.layout.clone(heap.allocator); errdefer layout.deinit(heap.allocator);
    return .{ .layout = layout, .value = try heap.readTypedField(receiver, actual, id, lifetime) };
}
// Input uses the actual representation returned by read, not a target field's
// physical layout. Source assignment adaptation belongs to formal lowering.
pub fn write(heap: *managed.ManagedHeap, module: anytype, receiver: managed.Handle,
    target: views.Id, member: views.Id, value: Value) Error!void {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const id = try module.field(actual, target, member);
    if (!actual.fields[try actual.fieldIndex(id)].layout.same(value.layout)) return error.TypeMismatch;
    const authority = if (@TypeOf(module) == views.Module) module else module.authority;
    if (authority.declarations.len != 0) {
        const entry = try authority.layouts.find(value.layout.type_id);
        var source = value.layout.type_id;
        if (std.mem.startsWith(u8, entry.name, "Union<")) {
            const variant = try value.layout.selectVariant(value.value.tag);
            if (variant.kind == .value and variant.children.len == 1) source = variant.children[0].layout.type_id else {
                var hash = std.crypto.hash.sha2.Sha256.init(.{});
                hash.update(if (variant.kind == .undefined_value) "tsfg.type\x00undefined" else "tsfg.type\x00null"); source = hash.finalResult();
            }
        }
        if (!try codec.assignment(authority, source, try authority.declaredType(target, member))) return error.TypeMismatch;
    }
    try heap.writeViewedField(module, receiver, target, member, value.layout,
        .{ .tag = value.value.tag, .bytes = value.value.bytes, .references = value.value.references });
}
pub fn method(heap: *managed.ManagedHeap, module: anytype, receiver: managed.Handle,
    target: views.Id, member: views.Id, lifetime: managed.Lifetime) Error!Callable {
    const actual = try heap.copyTypedCellLayout(receiver); defer actual.deinit(heap.allocator);
    const selected = try module.method(actual, target, member);
    return .{ .function_id = selected.id, .signature = selected.signature, .actual_type = actual.type_id,
        .runtime_key = actual.runtime_key, .receiver = try heap.retain(receiver, lifetime) };
}
