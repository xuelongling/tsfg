// SPDX-License-Identifier: MIT
const std = @import("std");
const Allocator = std.mem.Allocator;

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

pub const Error = Allocator.Error || error{
    InvalidOwner, HeapDestroyed, InvalidHandle, TypeMismatch,
    InvalidField, ScopeRequired, InvalidScope, IdentityExhausted,
};
pub const Handle = struct { owner: u64, slot: usize, generation: u64 };
pub const Lifetime = enum { persistent, temporary };
pub const Scope = struct { owner: u64, serial: u64, parent: u64 };
pub const Value = struct { identity: u64, type_id: u64, scalar: u64, edge_count: usize };
const Object = struct {
    identity: u64,
    type_id: u64,
    scalar: u64,
    edges: []?*Object,
    index: usize,
};
const Root = struct {
    object: ?*Object = null,
    generation: u64 = 1,
    scope: u64 = 0,
    retired: bool = false,
};

const State = struct {
    objects: std.ArrayList(*Object) = .empty,
    roots: std.ArrayList(Root) = .empty,
};

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
            for (state.objects.items) |object| self.destroyObject(object);
            state.objects.deinit(self.allocator);
            state.roots.deinit(self.allocator);
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
            try self.parents.append(self.allocator, .{ .owner = self.owner,
                .serial = self.active_scope, .parent = self.active_parent });
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
                if (root.object != null and root.scope == scope.serial) invalidate(root);
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
        _ = try self.ensureState();
        for (self.owned().roots.items, 0..) |root, index| {
            if (root.object == null and !root.retired) return index;
        }
        try self.owned().roots.ensureUnusedCapacity(self.allocator, 1);
        return self.owned().roots.items.len;
    }

    fn installRoot(self: *ManagedHeap, index: usize, object: *Object, scope: u64) Handle {
        if (index == self.owned().roots.items.len) self.owned().roots.appendAssumeCapacity(.{});
        const root = &self.owned().roots.items[index];
        root.object = object;
        root.scope = scope;
        return .{ .owner = self.owner, .slot = index, .generation = root.generation };
    }

    fn resolve(self: *ManagedHeap, handle: Handle) Error!*Object {
        try self.check();
        if (handle.owner != self.owner or self.storage == null or handle.slot >= self.owned().roots.items.len) return error.InvalidHandle;
        const root = self.owned().roots.items[handle.slot];
        if (root.retired or root.generation != handle.generation) return error.InvalidHandle;
        return root.object orelse error.InvalidHandle;
    }

    fn invalidate(root: *Root) void {
        root.object = null;
        root.scope = 0;
        // Never wrap a generation into a value an old Handle could carry.
        if (root.generation == std.math.maxInt(u64)) root.retired = true else root.generation += 1;
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
        object.* = .{ .identity = self.next_identity, .type_id = type_id, .scalar = scalar,
            .edges = edges, .index = self.owned().objects.items.len };
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
        invalidate(&self.owned().roots.items[handle.slot]);
    }

    pub fn read(self: *ManagedHeap, handle: Handle, expected_type: u64) Error!Value {
        const object = try self.resolve(handle);
        if (object.type_id != expected_type) return error.TypeMismatch;
        return .{ .identity = object.identity, .type_id = object.type_id,
            .scalar = object.scalar, .edge_count = object.edges.len };
    }

    pub fn write(self: *ManagedHeap, handle: Handle, expected_type: u64, scalar: u64) Error!void {
        const object = try self.resolve(handle);
        if (object.type_id != expected_type) return error.TypeMismatch;
        object.scalar = scalar;
    }

    pub fn sameObject(self: *ManagedHeap, left: Handle, right: Handle) Error!bool {
        const left_object = try self.resolve(left);
        return left_object == try self.resolve(right);
    }

    pub fn setEdge(self: *ManagedHeap, handle: Handle, index: usize, target: ?Handle) Error!void {
        const object = try self.resolve(handle);
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

    fn destroyObject(self: *ManagedHeap, object: *Object) void {
        self.allocator.free(object.edges);
        self.allocator.destroy(object);
    }

    fn copyObject(self: *ManagedHeap, old: *Object, forwarded: []?*Object, copies: *std.ArrayList(*Object)) Error!*Object {
        if (forwarded[old.index]) |copy| return copy;
        const copy = try self.allocator.create(Object);
        errdefer self.allocator.destroy(copy);
        const edges = try self.allocator.dupe(?*Object, old.edges);
        copy.* = old.*;
        copy.edges = edges;
        copy.index = copies.items.len;
        copies.appendAssumeCapacity(copy);
        forwarded[old.index] = copy;
        return copy;
    }

    /// Copies reachable objects while old allocations are still live, so each
    /// surviving object moves. Forwarding is collector-local; roots and heap
    /// edges store actual addresses and are rewritten at the commit point.
    /// All fallible work precedes root publication; OOM leaves the old graph valid.
    pub fn collect(self: *ManagedHeap) Error!void {
        try self.check();
        if (self.storage == null or self.owned().objects.items.len == 0) return;
        const forwarded = try self.allocator.alloc(?*Object, self.owned().objects.items.len);
        defer self.allocator.free(forwarded);
        @memset(forwarded, null);
        var copies: std.ArrayList(*Object) = .empty;
        errdefer {
            for (copies.items) |object| self.destroyObject(object);
            copies.deinit(self.allocator);
        }
        try copies.ensureTotalCapacity(self.allocator, self.owned().objects.items.len);
        for (self.owned().roots.items) |root| {
            if (root.object) |object| _ = try self.copyObject(object, forwarded, &copies);
        }
        var cursor: usize = 0;
        while (cursor < copies.items.len) : (cursor += 1) {
            for (copies.items[cursor].edges) |*edge| {
                if (edge.*) |old| edge.* = try self.copyObject(old, forwarded, &copies);
            }
        }
        for (self.owned().roots.items) |*root| {
            if (root.object) |old| root.object = forwarded[old.index].?;
        }
        for (self.owned().objects.items) |object| self.destroyObject(object);
        self.owned().objects.deinit(self.allocator);
        self.owned().objects = copies;
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
