// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;
const payloads = @import("managed-payload.zig");
const model = @import("managed-heap-model.zig");
const collector = @import("managed-heap-collector.zig");
const arrays = @import("managed-heap-arrays.zig");
const element = @import("array-element.zig");
const cells = @import("managed-heap-cells.zig");
const roots = @import("managed-heap-roots.zig");

// IDs never derive from wrapper addresses. Exhaustion permanently refuses new owners.
var next_owner = std.atomic.Value(u64).init(1);
fn reserveOwner() error{IdentityExhausted}!u64 {
    var candidate = next_owner.load(.monotonic);
    while (candidate != std.math.maxInt(u64)) {
        if (next_owner.cmpxchgWeak(candidate, candidate + 1, .monotonic, .monotonic)) |observed| {
            candidate = observed;
        } else return candidate;
    }
    return error.IdentityExhausted;
}

pub const Error = payloads.Error || @import("typed-layout-registry.zig").Error || error{
    InvalidOwner,
    HeapDestroyed,
    InvalidHandle,
    TypeMismatch,
    InvalidField,
    ScopeRequired,
    InvalidScope,
    IdentityExhausted,
};
pub const Handle = @import("managed-handles.zig").Handle;
pub const Lifetime = @import("managed-handles.zig").Lifetime;
pub const Scope = @import("managed-handles.zig").Scope;
pub const ArrayLayout = element.Layout;
pub const ArrayInput = element.Input;
pub const ArrayValue = element.Value;
pub const CellLayout = @import("managed-cell.zig").Layout;
pub const Value = struct { identity: u64, type_id: u64, scalar: u64, edge_count: usize };
const Payload = payloads.Payload;
const Object = model.Object;
const State = model.State;

/// Serial, exclusively owned heap. init may be returned/copied before first use.
/// After first use this wrapper must remain at its address until deinit; copied
/// wrappers reject all operations before dereferencing owned storage. Runtime is
/// consequently also pinned after first use. Handles alone may be freely copied.
/// No method returns an Object pointer, borrowed edge array, or cross-GC view.
pub const ManagedHeap = struct {
    allocator: Allocator,
    owner: u64 = 0,
    binding: usize = 0,
    closed: bool = false,
    // Only stable bookkeeping is type-erased here; no moving object pointer is
    // exposed by the supported host interface or the wrapper field types.
    storage: ?*anyopaque = null,
    parents: std.ArrayList(Scope) = .empty,
    active_parent: u64 = 0,
    next_identity: u64 = 1,
    next_scope: u64 = 1,
    active_scope: u64 = 0,

    pub fn init(allocator: Allocator) ManagedHeap {
        return .{ .allocator = allocator };
    }

    fn check(self: *ManagedHeap) Error!void {
        if (self.binding != 0 and self.binding != @intFromPtr(self)) return error.InvalidOwner;
        if (self.closed) return error.HeapDestroyed;
        if (self.owner == 0) {
            self.owner = try reserveOwner();
            self.binding = @intFromPtr(self);
        }
    }

    pub fn deinit(self: *ManagedHeap) Error!void {
        try self.check();
        if (self.storage != null) {
            const state = self.owned();
            for (state.objects.items) |object| collector.destroy(self.allocator, object);
            state.objects.deinit(self.allocator);
            state.roots.deinit(self.allocator);
            state.types.deinit(self.allocator);
            self.allocator.destroy(state);
            self.storage = null;
        }
        self.parents.deinit(self.allocator);
        self.closed = true;
    }

    pub fn beginScope(self: *ManagedHeap) Error!Scope {
        try self.check();
        if (self.next_scope == std.math.maxInt(u64)) return error.IdentityExhausted;
        if (self.active_scope != 0) {
            try self.parents.append(self.allocator, .{ .owner = self.owner, .serial = self.active_scope, .parent = self.active_parent });
        }
        const scope: Scope = .{ .owner = self.owner, .serial = self.next_scope, .parent = self.active_scope };
        self.next_scope += 1;
        self.active_scope = scope.serial;
        self.active_parent = scope.parent;
        return scope;
    }

    pub fn endScope(self: *ManagedHeap, scope: Scope) Error!void {
        try self.check();
        if (scope.owner != self.owner or scope.serial == 0 or scope.serial != self.active_scope or scope.parent != self.active_parent)
            return error.InvalidScope;
        if (self.storage != null) {
            for (self.owned().roots.items) |*root| {
                if (root.object != null and root.scope == scope.serial) roots.invalidate(root);
            }
        }
        if (self.parents.pop()) |parent| {
            self.active_scope = parent.serial;
            self.active_parent = parent.parent;
        } else {
            self.active_scope = 0;
            self.active_parent = 0;
        }
    }

    fn scopeFor(self: *ManagedHeap, lifetime: Lifetime) Error!u64 {
        if (lifetime == .persistent) return 0;
        if (self.active_scope == 0) return error.ScopeRequired;
        return self.active_scope;
    }

    fn owned(self: *ManagedHeap) *State {
        return @ptrCast(@alignCast(self.storage.?));
    }

    fn ensureState(self: *ManagedHeap) Error!*State {
        if (self.storage == null) {
            const state = try self.allocator.create(State);
            state.* = .{};
            self.storage = state;
        }
        return self.owned();
    }

    fn availableRoot(self: *ManagedHeap) Error!usize {
        return roots.available(self.allocator, try self.ensureState());
    }

    fn installRoot(self: *ManagedHeap, index: usize, object: *Object, scope: u64) Handle {
        return roots.install(self.owned(), self.owner, index, object, scope);
    }

    fn resolve(self: *ManagedHeap, handle: Handle) Error!*Object {
        try self.check();
        if (self.storage == null) return error.InvalidHandle;
        return model.resolve(self.owned(), self.owner, handle);
    }

    pub fn create(self: *ManagedHeap, type_id: u64, scalar: u64, edge_count: usize, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot();
        try self.owned().objects.ensureUnusedCapacity(self.allocator, 1);
        const object = try self.allocator.create(Object);
        errdefer self.allocator.destroy(object);
        const edges = try self.allocator.alloc(?*Object, edge_count);
        @memset(edges, null);
        object.* = .{ .identity = self.next_identity, .type_id = type_id, .payload = .{ .scalar = scalar }, .edges = edges, .index = self.owned().objects.items.len };
        self.owned().objects.appendAssumeCapacity(object);
        self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn createString(self: *ManagedHeap, units: []const u16, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot();
        try self.owned().objects.ensureUnusedCapacity(self.allocator, 1);
        const payload = try Payload.fromString(self.allocator, units);
        errdefer payload.deinit(self.allocator);
        return self.publishString(payload, slot, scope);
    }

    /// New String ownership; both source handles and their payloads remain unchanged.
    pub fn concatStrings(self: *ManagedHeap, left: Handle, right: Handle, lifetime: Lifetime) Error!Handle {
        const lhs = (try self.resolve(left)).payload;
        const rhs = (try self.resolve(right)).payload;
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const payload = try Payload.fromConcat(self.allocator, lhs, rhs);
        errdefer payload.deinit(self.allocator);
        const slot = try self.availableRoot();
        try self.owned().objects.ensureUnusedCapacity(self.allocator, 1);
        return self.publishString(payload, slot, scope);
    }

    /// Independent owned String; exact logical range, with no borrowed payload view.
    pub fn sliceString(self: *ManagedHeap, source: Handle, start: usize, end: usize, lifetime: Lifetime) Error!Handle {
        const value = (try self.resolve(source)).payload;
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const payload = try Payload.fromStringSlice(self.allocator, value, start, end);
        errdefer payload.deinit(self.allocator);
        const slot = try self.availableRoot();
        try self.owned().objects.ensureUnusedCapacity(self.allocator, 1);
        return self.publishString(payload, slot, scope);
    }

    pub fn compareStrings(self: *ManagedHeap, left: Handle, right: Handle) Error!std.math.Order {
        const lhs = (try self.resolve(left)).payload;
        const rhs = (try self.resolve(right)).payload;
        return lhs.compareStrings(rhs);
    }

    // Owned String construction shares allocation and publication; the caller owns
    // the payload until publication succeeds.
    fn publishString(self: *ManagedHeap, payload: Payload, slot: usize, scope: u64) Error!Handle {
        const object = try self.allocator.create(Object);
        errdefer self.allocator.destroy(object);
        const edges = try self.allocator.alloc(?*Object, 0);
        @memset(edges, null);
        object.* = .{ .identity = self.next_identity, .type_id = 0, .payload = payload, .edges = edges, .index = self.owned().objects.items.len };
        self.owned().objects.appendAssumeCapacity(object);
        self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn retain(self: *ManagedHeap, handle: Handle, lifetime: Lifetime) Error!Handle {
        const object = try self.resolve(handle);
        const scope = try self.scopeFor(lifetime);
        const slot = try self.availableRoot();
        return self.installRoot(slot, object, scope);
    }

    pub fn release(self: *ManagedHeap, handle: Handle) Error!void {
        _ = try self.resolve(handle);
        roots.invalidate(&self.owned().roots.items[handle.slot]);
    }

    pub fn read(self: *ManagedHeap, handle: Handle, expected_type: u64) Error!Value {
        const object = try self.resolve(handle);
        if (object.type_id != expected_type) return error.TypeMismatch;
        const scalar = switch (object.payload) {
            .scalar => |value| value,
            .string, .array_f64, .array, .cell => return error.TypeMismatch,
        };
        return .{ .identity = object.identity, .type_id = object.type_id, .scalar = scalar, .edge_count = object.edges.len };
    }

    pub fn write(self: *ManagedHeap, handle: Handle, expected_type: u64, scalar: u64) Error!void {
        const object = try self.resolve(handle);
        if (object.type_id != expected_type) return error.TypeMismatch;
        switch (object.payload) {
            .scalar => |*value| value.* = scalar,
            .string, .array_f64, .array, .cell => return error.TypeMismatch,
        }
    }

    pub fn stringLength(self: *ManagedHeap, handle: Handle) Error!usize {
        return (try self.resolve(handle)).payload.stringLength();
    }

    pub fn stringByteLength(self: *ManagedHeap, handle: Handle) Error!usize {
        return (try self.resolve(handle)).payload.stringByteLength();
    }

    pub fn readStringCodeUnit(self: *ManagedHeap, handle: Handle, index: usize) Error!u16 {
        return (try self.resolve(handle)).payload.readStringCodeUnit(index);
    }

    pub fn copyStringBytes(self: *ManagedHeap, handle: Handle, out: []u8) Error!usize {
        return (try self.resolve(handle)).payload.copyStringBytes(out);
    }

    pub fn copyStringCodeUnits(self: *ManagedHeap, handle: Handle, out: []u16) Error!usize {
        return (try self.resolve(handle)).payload.copyStringCodeUnits(out);
    }

    pub fn createArrayF64(self: *ManagedHeap, values: []const f64, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot();
        try self.owned().objects.ensureUnusedCapacity(self.allocator, 1);
        const payload = try Payload.fromArrayF64(self.allocator, values);
        errdefer payload.deinit(self.allocator);
        const object = try self.allocator.create(Object);
        errdefer self.allocator.destroy(object);
        const edges = try self.allocator.alloc(?*Object, 0);
        object.* = .{ .identity = self.next_identity, .type_id = 0, .payload = payload, .edges = edges, .index = self.owned().objects.items.len };
        self.owned().objects.appendAssumeCapacity(object);
        self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn arrayF64Length(self: *ManagedHeap, handle: Handle) Error!u32 {
        return (try self.resolve(handle)).payload.arrayF64Length();
    }

    pub fn readArrayF64(self: *ManagedHeap, handle: Handle, index: u32) Error!f64 {
        return (try self.resolve(handle)).payload.readArrayF64(index);
    }

    pub fn storeArrayF64(self: *ManagedHeap, handle: Handle, index: u32, value: f64) Error!void {
        const object = try self.resolve(handle);
        try object.payload.storeArrayF64(self.allocator, index, value);
    }

    pub fn resizeArrayF64(self: *ManagedHeap, handle: Handle, length: u32) Error!void {
        const object = try self.resolve(handle);
        try object.payload.resizeArrayF64(length);
    }

    pub fn createTypedArray(self: *ManagedHeap, layout: ArrayLayout, inputs: []const ArrayInput, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot();
        const state = self.owned();
        try state.objects.ensureUnusedCapacity(self.allocator, 1);
        const object = try arrays.create(self.allocator, state, self.owner, self.next_identity, layout, inputs);
        errdefer collector.destroy(self.allocator, object);
        try state.types.admitLayout(self.allocator, layout);
        state.objects.appendAssumeCapacity(object);
        self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn typedArrayLength(self: *ManagedHeap, handle: Handle, expected: ArrayLayout) Error!u32 {
        return (try arrays.array(try self.resolve(handle), expected)).length;
    }

    pub fn readTypedArray(self: *ManagedHeap, handle: Handle, expected: ArrayLayout, index: u32, lifetime: Lifetime) Error!ArrayValue {
        const object = try self.resolve(handle);
        const value = try arrays.array(object, expected);
        const source = try value.readBytes(index);
        const start = @as(usize, index) * value.layout.reference_count;
        return self.rootedValue(value.layout, value.tags[index], source, object.edges[start..][0..value.layout.reference_count], lifetime);
    }

    fn rootedValue(self: *ManagedHeap, layout: ArrayLayout, tag: u16, source: []const u8, edges: []?*Object, lifetime: Lifetime) Error!ArrayValue {
        const scope = try self.scopeFor(lifetime);
        const bytes = try self.allocator.dupe(u8, source);
        errdefer self.allocator.free(bytes);
        const references = try self.allocator.alloc(?Handle, layout.reference_count);
        errdefer self.allocator.free(references);
        // Reserve every possible root before publishing even the first one.
        try self.owned().roots.ensureUnusedCapacity(self.allocator, references.len);
        for (references, edges) |*out, target| {
            out.* = if (target) |child| self.installRoot(try self.availableRoot(), child, scope) else null;
        }
        return .{ .tag = tag, .bytes = bytes, .references = references };
    }

    pub fn storeTypedArray(self: *ManagedHeap, handle: Handle, expected: ArrayLayout, index: u32, value: ArrayInput) Error!void {
        const object = try self.resolve(handle);
        try arrays.store(self.allocator, self.owned(), self.owner, object, expected, index, value);
    }

    pub fn resizeTypedArray(self: *ManagedHeap, handle: Handle, expected: ArrayLayout, length: u32) Error!void {
        try arrays.resize(try self.resolve(handle), expected, length);
    }

    pub fn createTypedCell(self: *ManagedHeap, layout: CellLayout, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot();
        const state = self.owned();
        try state.objects.ensureUnusedCapacity(self.allocator, 1);
        const object = try cells.create(self.allocator, state, self.next_identity, layout);
        errdefer collector.destroy(self.allocator, object);
        try state.types.admitCell(self.allocator, layout);
        state.objects.appendAssumeCapacity(object); self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn hasTypedField(self: *ManagedHeap, handle: Handle, expected: CellLayout, id: [32]u8) Error!bool {
        const value = try cells.cell(try self.resolve(handle), expected);
        return value.initialized[try value.layout.fieldIndex(id)];
    }

    pub fn installTypedLayouts(self: *ManagedHeap, module: @import("typed-layout-canonical.zig").Module) Error!void {
        try self.check();
        try (try self.ensureState()).types.admitModule(self.allocator, module);
    }

    pub fn readTypedField(self: *ManagedHeap, handle: Handle, expected: CellLayout, id: [32]u8, lifetime: Lifetime) Error!ArrayValue {
        const object = try self.resolve(handle);
        const value = try cells.cell(object, expected);
        const index = try value.layout.fieldIndex(id);
        if (!value.initialized[index]) return error.UninitializedField;
        const field = value.layout.fields[index];
        return self.rootedValue(field.layout, value.tags[index], value.fieldBytes(index),
            object.edges[field.reference_offset..][0..field.layout.reference_count], lifetime);
    }

    pub fn writeTypedField(self: *ManagedHeap, handle: Handle, expected: CellLayout, id: [32]u8, input: ArrayInput, initialize: bool) Error!void {
        const object = try self.resolve(handle);
        try cells.write(self.allocator, self.owned(), self.owner, object, expected, id, input, initialize);
    }

    pub fn createTypedValue(self: *ManagedHeap, layout: CellLayout, expected: ArrayLayout, input: ArrayInput, lifetime: Lifetime) Error!Handle {
        try self.check();
        const scope = try self.scopeFor(lifetime);
        if (self.next_identity == std.math.maxInt(u64)) return error.IdentityExhausted;
        const slot = try self.availableRoot(); const state = self.owned();
        try state.objects.ensureUnusedCapacity(self.allocator, 1);
        const object = try cells.createValue(self.allocator, state, self.owner, self.next_identity, layout, expected, input);
        errdefer collector.destroy(self.allocator, object);
        try state.types.admitCell(self.allocator, layout);
        state.objects.appendAssumeCapacity(object); self.next_identity += 1;
        return self.installRoot(slot, object, scope);
    }

    pub fn readTypedValue(self: *ManagedHeap, handle: Handle, expected: CellLayout, layout: ArrayLayout, lifetime: Lifetime) Error!ArrayValue {
        const object = try self.resolve(handle); const value = try cells.cell(object, expected);
        const bytes = try value.pack(self.allocator, layout); defer self.allocator.free(bytes);
        return self.rootedValue(layout, 0, bytes, object.edges, lifetime);
    }

    pub fn sameObject(self: *ManagedHeap, left: Handle, right: Handle) Error!bool {
        const left_object = try self.resolve(left);
        return left_object == try self.resolve(right);
    }

    pub fn setEdge(self: *ManagedHeap, handle: Handle, index: usize, target: ?Handle) Error!void {
        const object = try self.resolve(handle);
        // Typed elements must update through the variant-aware write barrier.
        if (object.payload == .array or object.payload == .cell) return error.TypeMismatch;
        if (index >= object.edges.len) return error.InvalidField;
        const edge = if (target) |value| try self.resolve(value) else null;
        object.edges[index] = edge;
    }

    pub fn retainEdge(self: *ManagedHeap, handle: Handle, index: usize, lifetime: Lifetime) Error!?Handle {
        const object = try self.resolve(handle);
        if (index >= object.edges.len) return error.InvalidField;
        const scope = try self.scopeFor(lifetime);
        const target = object.edges[index] orelse return null;
        const slot = try self.availableRoot();
        return self.installRoot(slot, target, scope);
    }

    pub fn objectCount(self: *ManagedHeap) Error!usize {
        try self.check();
        return if (self.storage != null) self.owned().objects.items.len else 0;
    }

    pub fn collect(self: *ManagedHeap) Error!void {
        try self.check();
        if (self.storage != null) try collector.collect(self.allocator, self.owned());
    }
};

// White-box observations exist only in standalone test builds. They return
// integer locations, never a pointer/view usable by a production host.
pub const testing = if (@import("builtin").is_test) struct {
    pub fn location(heap: *ManagedHeap, handle: Handle) Error!usize {
        return @intFromPtr(try heap.resolve(handle));
    }

    pub fn edgeLocation(heap: *ManagedHeap, handle: Handle, index: usize) Error!?usize {
        const object = try heap.resolve(handle);
        if (index >= object.edges.len) return error.InvalidField;
        return if (object.edges[index]) |edge| @intFromPtr(edge) else null;
    }

    pub fn rootStats(heap: *ManagedHeap) Error!struct { count: usize, capacity: usize } {
        try heap.check();
        const state = try heap.ensureState();
        return .{ .count = state.roots.items.len, .capacity = state.roots.capacity };
    }

    pub fn forceGeneration(heap: *ManagedHeap, handle: Handle, generation: u64) Error!Handle {
        _ = try heap.resolve(handle);
        heap.owned().roots.items[handle.slot].generation = generation;
        var changed = handle;
        changed.generation = generation;
        return changed;
    }
} else struct {};
