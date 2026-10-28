// SPDX-License-Identifier: MIT
// Development storage selection, not executable bytecode. Static views choose
// permissions; the value remains its original actual cell/absence domain.
const std = @import("std");
const managed = @import("managed-heap.zig");
const storage = @import("managed-reference-domain.zig");
const views = @import("typed-reference-views.zig");
const element = @import("array-element.zig");
pub const Id = views.Id;
pub const Error = managed.Error || views.Error || error{InvalidReferenceDomain};
pub const Array = struct { handle: managed.Handle, type_id: Id };
pub const Value = struct { actual: storage.Value, view_type: Id };
const Plan = struct { type_id: Id, element_type: Id };
fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
pub const Module = struct {
    allocator: std.mem.Allocator, views: views.Module, arrays: []Plan,
    pub fn deinit(self: *Module) void { self.views.deinit(); self.allocator.free(self.arrays); self.* = undefined; }
    fn plan(self: Module, id: Id) Error!Plan {
        for (self.arrays) |value| if (same(value.type_id, id)) return value;
        return error.InvalidReferenceDomain;
    }
    fn variants(self: Module, id: Id) Error![]const element.Variant { return (try self.views.layouts.find(id)).layout.variants; }
    fn referenceId(variant: element.Variant) Error!Id {
        if (variant.fields.len != 0) return error.InvalidReferenceDomain;
        if (variant.children.len == 1 and variant.references.len == 0) {
            const child = variant.children[0].layout;
            if (child.byte_size != 0 or child.variants.len != 1) return error.InvalidReferenceDomain;
            return referenceId(child.variants[0]);
        }
        if (variant.children.len != 0 or variant.references.len != 1 or variant.references[0].type != .cell) return error.InvalidReferenceDomain;
        return variant.references[0].type.cell;
    }
    fn reference(self: Module, id: Id) Error!void {
        const entry = try self.views.layouts.find(id);
        if (std.mem.eql(u8, entry.name, "void")) return error.InvalidReferenceDomain;
        for (entry.layout.variants) |variant| {
            if (variant.kind != .value) continue;
            const cell_layout = (try self.views.layouts.find(try referenceId(variant))).cell orelse return error.InvalidReferenceDomain;
            if (cell_layout.kind != .reference) return error.InvalidReferenceDomain;
        }
    }
    fn relation(self: Module, source: Id, target: Id) Error!void {
        if (same(source, target)) return;
        var work: usize = 100000;
        for (try self.variants(source)) |from| {
            var selected = false;
            for (try self.variants(target)) |to| {
                const cost = 1 + self.views.layouts.entries.len + self.views.views.len;
                if (cost > work) return error.LayoutLimit;
                work -= cost;
                if (from.kind != to.kind) continue;
                if (from.kind != .value) { selected = true; break; }
                const a = try referenceId(from); const b = try referenceId(to);
                if (same(a, b)) { selected = true; break; }
                const actual = (try self.views.layouts.find(a)).cell.?;
                _ = self.views.view(actual, b) catch |err| { if (err == error.MissingView) continue else return err; };
                selected = true; break;
            }
            if (!selected) return error.MissingView;
        }
    }
    // New cell results begin with the verified actual type. Assignment, call
    // arguments and returned carriers subsequently change only the static view.
    pub fn cell(self: Module, heap: *managed.ManagedHeap, handle: managed.Handle) Error!Value {
        const actual = try heap.copyTypedCellLayout(handle); defer actual.deinit(heap.allocator);
        const entry = (try self.views.layouts.find(actual.type_id)).cell orelse return error.InvalidReferenceDomain;
        if (actual.kind != .reference or !entry.same(actual)) return error.InvalidReferenceDomain;
        return .{ .actual = .{ .cell = handle }, .view_type = actual.type_id };
    }
    pub fn assign(self: Module, value: Value, target: Id) Error!Value {
        try self.reference(value.view_type); try self.reference(target); try self.relation(value.view_type, target);
        return .{ .actual = value.actual, .view_type = target };
    }
    pub fn retain(self: Module, heap: *managed.ManagedHeap, value: Value, lifetime: managed.Lifetime) Error!Value {
        try self.reference(value.view_type);
        return .{ .actual = if (value.actual == .cell) .{ .cell = try heap.retain(value.actual.cell, lifetime) } else value.actual,
            .view_type = value.view_type };
    }
    fn assertion(self: Module, source: Id, target: Id) Error!void {
        try self.reference(source); try self.reference(target);
        const source_variants = try self.variants(source); const target_variants = try self.variants(target);
        var target_subset = true;
        for (target_variants) |to| if (to.kind == .value) {
            var found = false;
            for (source_variants) |from| if (from.kind == .value and same(try referenceId(from), try referenceId(to))) { found = true; break; };
            target_subset = target_subset and found;
        };
        if (!target_subset) {
            // Presence alone is removed from the static relation; it remains in
            // the actual carrier, including returned values and later stores.
            for (source_variants) |from| if (from.kind == .value) {
                try self.relation(try referenceId(from), target);
            };
        }
    }
    pub fn assertView(self: Module, value: Value, target: Id) Error!Value {
        try self.assertion(value.view_type, target);
        return .{ .actual = value.actual, .view_type = target };
    }
    pub fn create(self: Module, heap: *managed.ManagedHeap, type_id: Id, values: []const Value, lifetime: managed.Lifetime) Error!Array {
        if (values.len > std.math.maxInt(u32)) return error.ArrayTooLarge;
        const plan_value = try self.plan(type_id);
        const inputs = try heap.allocator.alloc(storage.Value, values.len); defer heap.allocator.free(inputs);
        for (values, inputs) |value, *input| { _ = try self.assign(value, plan_value.element_type); input.* = value.actual; }
        return .{ .handle = try storage.create(heap, inputs, lifetime), .type_id = type_id };
    }
    pub fn alias(self: Module, heap: *managed.ManagedHeap, array: Array, target: Id, lifetime: managed.Lifetime) Error!Array {
        try self.relation((try self.plan(array.type_id)).element_type, (try self.plan(target)).element_type);
        return .{ .handle = try heap.retain(array.handle, lifetime), .type_id = target };
    }
    pub fn assertArray(self: Module, heap: *managed.ManagedHeap, array: Array, target: Id, lifetime: managed.Lifetime) Error!Array {
        try self.assertion((try self.plan(array.type_id)).element_type, (try self.plan(target)).element_type);
        return .{ .handle = try heap.retain(array.handle, lifetime), .type_id = target };
    }
    pub fn read(self: Module, heap: *managed.ManagedHeap, array: Array, index: u32, lifetime: managed.Lifetime) Error!Value {
        const element_type = (try self.plan(array.type_id)).element_type;
        return .{ .actual = try storage.read(heap, array.handle, index, lifetime), .view_type = element_type };
    }
    pub fn store(self: Module, heap: *managed.ManagedHeap, array: Array, index: u32, value: Value) Error!void {
        _ = try self.assign(value, (try self.plan(array.type_id)).element_type);
        try storage.store(heap, array.handle, index, value.actual);
    }
};
pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (bytes.len < 14 or bytes.len > 2097152 or !std.mem.eql(u8, bytes[0..8], "TSREFD01")) return error.InvalidReferenceDomain;
    const size = std.mem.readInt(u32, bytes[8..12], .little); const count = std.mem.readInt(u16, bytes[12..14], .little);
    if (size > bytes.len - 14 or count > 4096 or bytes.len - 14 - size != @as(usize, count) * 64) return error.InvalidReferenceDomain;
    var module_views = try views.load(allocator, bytes[14..][0..size]); errdefer module_views.deinit();
    const plans = try allocator.alloc(Plan, count); errdefer allocator.free(plans);
    const result = Module{ .allocator = allocator, .views = module_views, .arrays = plans };
    for (plans, 0..) |*plan_value, i| {
        const start = 14 + size + i * 64;
        plan_value.* = .{ .type_id = bytes[start..][0..32].*, .element_type = bytes[start + 32 ..][0..32].* };
        if (i != 0 and std.mem.order(u8, &plans[i - 1].type_id, &plan_value.type_id) != .lt) return error.InvalidReferenceDomain;
        const layout = (try result.views.layouts.find(plan_value.type_id)).layout;
        if (layout.byte_size != 0 or layout.variants.len != 1 or layout.variants[0].references.len != 1 or layout.variants[0].references[0].type != .array
            or !same(layout.variants[0].references[0].type.array, plan_value.element_type)) return error.InvalidReferenceDomain;
        try result.reference(plan_value.element_type);
    }
    return result;
}
