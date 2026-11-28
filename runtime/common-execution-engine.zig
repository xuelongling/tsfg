// SPDX-License-Identifier: MIT
//! Unified production Common20 execution engine & Windows AOT C-ABI runtime
//! built directly on `runtime/managed-heap.zig` (real moving copying GC).
//! Covers:
//!   - M12 / M29: Closed classes, base-before-derived constructors, vtable dispatch,
//!     field reads/writes, nominal identity, TDZ, and real moving GC relocation.
//!   - M19 / M30: Lifted mutable closure environments, parent chains, sibling
//!     captures, indirect closure calls, and GC root preservation.
//!   - M20 / M31: Tagged unions & presence (undefined/null/bool/i32/f64/ref),
//!     narrowing, short-circuit coalescing, and undefined-numeric-use traps.
//!   - M21 / M32: Structured language exceptions (try/catch/finally/rethrow,
//!     scalar & managed-ref payloads, module-init memoization) strictly separated
//!     from request traps (traps NEVER enter catch or finally).
//!   - M25 / M26 / M34: Dense Array<T> (scalar & GC-traced ref elements) and
//!     non-escaping ReadSpan/MutSpan borrows with Q11/Q13 conflict & escape guards.
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;

pub const Tag = enum(u16) {
    @"undefined" = 0,
    @"null" = 1,
    bool = 2,
    i32 = 3,
    f64 = 4,
    ref = 5, // payload = handle_id (1-based index into Engine.handles)
    closure = 6, // payload = closure_id (1-based)
    array = 7, // payload = array_id (1-based)
    span = 8, // payload = span_token (1-based) — non-escaping!
};

pub const TaggedValue = extern struct {
    tag: u16 = 0,
    _pad: [3]u16 = .{ 0, 0, 0 },
    payload: u64 = 0,

    pub fn undef() TaggedValue {
        return .{ .tag = @intFromEnum(Tag.@"undefined"), .payload = 0 };
    }
    pub fn nil() TaggedValue {
        return .{ .tag = @intFromEnum(Tag.@"null"), .payload = 0 };
    }
    pub fn fromBool(b: bool) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.bool), .payload = if (b) 1 else 0 };
    }
    pub fn fromI32(v: i32) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.i32), .payload = @as(u32, @bitCast(v)) };
    }
    pub fn fromF64(v: f64) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.f64), .payload = @bitCast(v) };
    }
    pub fn fromRef(id: u64) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.ref), .payload = id };
    }
    pub fn fromClosure(id: u64) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.closure), .payload = id };
    }
    pub fn fromArray(id: u64) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.array), .payload = id };
    }
    pub fn fromSpan(id: u64) TaggedValue {
        return .{ .tag = @intFromEnum(Tag.span), .payload = id };
    }
    pub fn asI32(self: TaggedValue) ?i32 {
        if (self.tag != @intFromEnum(Tag.i32)) return null;
        return @bitCast(@as(u32, @truncate(self.payload)));
    }
};

pub const TrapCode = enum(u32) {
    none = 0,
    fuel = 1, // r01-t-fuel
    depth = 2, // r01-t-depth
    div_zero = 3, // r01-t-divide-zero
    bounds = 4, // r01-t-array-bounds
    borrow_conflict = 5, // r01-t-borrow-conflict
    span_expired = 6, // r01-t-span-expired
    span_readonly = 7, // r01-t-span-readonly
    span_escape = 8, // r01-t-span-escape
    undefined_numeric = 9, // r01-t-undefined-numeric-use
    tdz_uninitialized = 10, // r01-t-tdz
    narrow_mismatch = 11, // r01-t-narrow
    oom = 12, // r05-execution-abort
    invalid_handle = 13, // r05-invalid-handle
};

pub const ClassMeta = struct {
    type_id: u64,
    parent_type_id: u64, // 0 if base class
    scalar_fields: u16,
    ref_fields: u16,
    vtable: [8]u32 = [_]u32{0} ** 8,
};

const ObjectRecord = struct {
    handle: Handle, // live root in ManagedHeap (relocated automatically by heap.collect()!)
    type_id: u64,
    initialized: bool,
    scalars: []u64,
    scalar_tags: []u16, // tag per scalar/tagged field slot for uniform Common20 Core IR execution
    ref_ids: []u64, // parallel handle ids for ref edges (also wired into ManagedHeap edges!)
};

const EnvRecord = struct {
    handle: Handle, // allocated on ManagedHeap so GC relocates it!
    parent_env_id: u64, // 0 if root env
    slots: []TaggedValue,
    slot_init: []bool,
};

const ClosureRecord = struct {
    fn_id: u32,
    env_id: u64,
};

const ArrayRecord = struct {
    handle: Handle, // managed heap backing object (relocated by GC!)
    is_ref_elements: bool,
    items: std.ArrayListUnmanaged(TaggedValue) = .empty,
    active_readers: u32 = 0,
    active_writer: bool = false,
};

const SpanRecord = struct {
    array_id: u64,
    start: u32,
    len: u32,
    mutable: bool,
    live: bool,
};

pub const Engine = struct {
    allocator: std.mem.Allocator,
    heap: Heap,
    classes: std.ArrayListUnmanaged(ClassMeta) = .empty,
    objects: std.ArrayListUnmanaged(ObjectRecord) = .empty,
    envs: std.ArrayListUnmanaged(EnvRecord) = .empty,
    closures: std.ArrayListUnmanaged(ClosureRecord) = .empty,
    arrays: std.ArrayListUnmanaged(ArrayRecord) = .empty,
    spans: std.ArrayListUnmanaged(SpanRecord) = .empty,
    globals: [64]TaggedValue = [_]TaggedValue{TaggedValue.undef()} ** 64,
    global_init: [64]bool = [_]bool{false} ** 64,
    // Request state
    fuel: u64 = 10000,
    depth_limit: u32 = 32,
    depth: u32 = 0,
    // Request trap (FATAL: never enters catch or finally!)
    trap: TrapCode = .none,
    // Language exception (NORMAL UNWIND: enters catch and finally!)
    exception_active: bool = false,
    exception_payload: TaggedValue = TaggedValue.undef(),
    // Module initialization memoization
    module_status: u8 = 0, // 0=uninit, 1=init, 2=failed
    module_init_exception: TaggedValue = TaggedValue.undef(),
    module_init_trap: TrapCode = .none,
    gc_collections: u64 = 0,
    gc_moves_observed: u64 = 0,

    pub fn create(allocator: std.mem.Allocator) !*Engine {
        const self = try allocator.create(Engine);
        self.* = .{
            .allocator = allocator,
            .heap = Heap.init(allocator),
        };
        return self;
    }

    pub fn destroy(self: *Engine) void {
        for (self.objects.items) |obj| {
            self.heap.release(obj.handle) catch {};
            self.allocator.free(obj.scalars);
            self.allocator.free(obj.scalar_tags);
            self.allocator.free(obj.ref_ids);
        }
        self.objects.deinit(self.allocator);
        for (self.envs.items) |env| {
            self.heap.release(env.handle) catch {};
            self.allocator.free(env.slots);
            self.allocator.free(env.slot_init);
        }
        self.envs.deinit(self.allocator);
        self.closures.deinit(self.allocator);
        for (self.arrays.items) |*arr| {
            self.heap.release(arr.handle) catch {};
            arr.items.deinit(self.allocator);
        }
        self.arrays.deinit(self.allocator);
        self.spans.deinit(self.allocator);
        self.classes.deinit(self.allocator);
        self.heap.deinit() catch {};
        self.allocator.destroy(self);
    }

    pub fn resetRequest(self: *Engine, fuel: u64, depth_limit: u32) void {
        self.fuel = fuel;
        self.depth_limit = depth_limit;
        self.depth = 0;
        self.trap = .none;
        self.exception_active = false;
        self.exception_payload = TaggedValue.undef();
    }

    pub fn isAborted(self: *const Engine) bool {
        return self.trap != .none or self.exception_active;
    }

    pub fn setTrap(self: *Engine, code: TrapCode) void {
        if (self.trap == .none) {
            self.trap = code;
            // A request trap overrides any language exception and prevents catch/finally entry.
            self.exception_active = false;
        }
    }

    pub fn chargeFuel(self: *Engine) bool {
        if (self.trap != .none) return false;
        if (self.fuel == 0) {
            self.setTrap(.fuel);
            return false;
        }
        self.fuel -= 1;
        return true;
    }

    pub fn enterCall(self: *Engine) bool {
        if (self.trap != .none) return false;
        if (self.depth >= self.depth_limit) {
            self.setTrap(.depth);
            return false;
        }
        self.depth += 1;
        return true;
    }

    pub fn exitCall(self: *Engine) void {
        if (self.depth > 0) self.depth -= 1;
    }

    // ---- M12 / M29: Closed Classes & Moving GC ----
    pub fn registerClass(self: *Engine, meta: ClassMeta) !void {
        try self.classes.append(self.allocator, meta);
    }

    fn findClass(self: *const Engine, type_id: u64) ?*const ClassMeta {
        for (self.classes.items) |*c| {
            if (c.type_id == type_id) return c;
        }
        return null;
    }

    pub fn isSubtype(self: *const Engine, actual_type: u64, target_type: u64) bool {
        var cur = actual_type;
        var guard: usize = 0;
        while (cur != 0 and guard < 64) : (guard += 1) {
            if (cur == target_type) return true;
            const c = self.findClass(cur) orelse return false;
            cur = c.parent_type_id;
        }
        return false;
    }

    pub fn allocObject(self: *Engine, type_id: u64) u64 {
        if (self.isAborted()) return 0;
        const meta = self.findClass(type_id) orelse {
            self.setTrap(.invalid_handle);
            return 0;
        };
        const h = self.heap.create(type_id, 0, meta.ref_fields, .persistent) catch {
            self.setTrap(.oom);
            return 0;
        };
        const scalars = self.allocator.alloc(u64, meta.scalar_fields) catch {
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        @memset(scalars, 0);
        const scalar_tags = self.allocator.alloc(u16, meta.scalar_fields) catch {
            self.allocator.free(scalars);
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        @memset(scalar_tags, 0);
        const refs = self.allocator.alloc(u64, meta.ref_fields) catch {
            self.allocator.free(scalars);
            self.allocator.free(scalar_tags);
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        @memset(refs, 0);
        self.objects.append(self.allocator, .{
            .handle = h,
            .type_id = type_id,
            .initialized = false,
            .scalars = scalars,
            .scalar_tags = scalar_tags,
            .ref_ids = refs,
        }) catch {
            self.allocator.free(scalars);
            self.allocator.free(scalar_tags);
            self.allocator.free(refs);
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(self.objects.items.len);
    }

    pub fn cloneObject(self: *Engine, src_id: u64) u64 {
        if (self.isAborted()) return 0;
        if (src_id == 0 or src_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const src_type = self.objects.items[@intCast(src_id - 1)].type_id;
        const dst_id = self.allocObject(src_type);
        if (dst_id == 0) return 0;
        const src = &self.objects.items[@intCast(src_id - 1)];
        const dst = &self.objects.items[@intCast(dst_id - 1)];
        @memcpy(dst.scalars, src.scalars);
        @memcpy(dst.scalar_tags, src.scalar_tags);
        @memcpy(dst.ref_ids, src.ref_ids);
        dst.initialized = src.initialized;
        for (dst.ref_ids, 0..) |ref_id, idx| {
            if (ref_id != 0 and ref_id <= self.objects.items.len) {
                self.heap.setEdge(dst.handle, @intCast(idx), self.objects.items[@intCast(ref_id - 1)].handle) catch {};
            }
        }
        if (dst.scalars.len > 0) {
            self.heap.write(dst.handle, dst.type_id, dst.scalars[0]) catch {};
        }
        return dst_id;
    }

    pub fn objSetField(self: *Engine, obj_id: u64, field_idx: u32, val: TaggedValue, allow_uninit: bool) void {
        if (self.isAborted()) return;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!allow_uninit and !rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return;
        }
        if (field_idx >= rec.scalars.len) {
            self.setTrap(.bounds);
            return;
        }
        rec.scalars[field_idx] = val.payload;
        rec.scalar_tags[field_idx] = val.tag;
        if (field_idx == 0) {
            self.heap.write(rec.handle, rec.type_id, val.payload) catch {};
        }
        if (val.tag == @intFromEnum(Tag.ref) and field_idx < rec.ref_ids.len) {
            if (val.payload != 0 and val.payload <= self.objects.items.len) {
                rec.ref_ids[field_idx] = val.payload;
                self.heap.setEdge(rec.handle, field_idx, self.objects.items[@intCast(val.payload - 1)].handle) catch {};
            } else {
                rec.ref_ids[field_idx] = 0;
                self.heap.setEdge(rec.handle, field_idx, null) catch {};
            }
        }
    }

    pub fn objGetField(self: *Engine, obj_id: u64, field_idx: u32) TaggedValue {
        if (self.isAborted()) return TaggedValue.undef();
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return TaggedValue.undef();
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return TaggedValue.undef();
        }
        if (field_idx >= rec.scalars.len) {
            self.setTrap(.bounds);
            return TaggedValue.undef();
        }
        _ = self.heap.read(rec.handle, rec.type_id) catch {
            self.setTrap(.invalid_handle);
            return TaggedValue.undef();
        };
        return .{ .tag = rec.scalar_tags[field_idx], .payload = rec.scalars[field_idx] };
    }

    pub fn markObjectInitialized(self: *Engine, obj_id: u64) void {
        if (obj_id == 0 or obj_id > self.objects.items.len) return;
        self.objects.items[@intCast(obj_id - 1)].initialized = true;
    }

    pub fn objSetScalar(self: *Engine, obj_id: u64, field_idx: u32, val: u64, allow_uninit: bool) void {
        if (self.isAborted()) return;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!allow_uninit and !rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return;
        }
        if (field_idx >= rec.scalars.len) {
            self.setTrap(.bounds);
            return;
        }
        rec.scalars[field_idx] = val;
        if (field_idx == 0) {
            self.heap.write(rec.handle, rec.type_id, val) catch {};
        }
    }

    pub fn objGetScalar(self: *Engine, obj_id: u64, field_idx: u32) u64 {
        if (self.isAborted()) return 0;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return 0;
        }
        if (field_idx >= rec.scalars.len) {
            self.setTrap(.bounds);
            return 0;
        }
        // Verify live ManagedHeap object survived any moving GC relocation
        _ = self.heap.read(rec.handle, rec.type_id) catch {
            self.setTrap(.invalid_handle);
            return 0;
        };
        return rec.scalars[field_idx];
    }

    pub fn objSetRef(self: *Engine, obj_id: u64, edge_idx: u32, target_obj_id: u64, allow_uninit: bool) void {
        if (self.isAborted()) return;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!allow_uninit and !rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return;
        }
        if (edge_idx >= rec.ref_ids.len) {
            self.setTrap(.bounds);
            return;
        }
        if (target_obj_id == 0) {
            rec.ref_ids[edge_idx] = 0;
            self.heap.setEdge(rec.handle, edge_idx, null) catch {};
            return;
        }
        if (target_obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const target = &self.objects.items[@intCast(target_obj_id - 1)];
        rec.ref_ids[edge_idx] = target_obj_id;
        self.heap.setEdge(rec.handle, edge_idx, target.handle) catch {
            self.setTrap(.invalid_handle);
        };
    }

    pub fn objGetRef(self: *Engine, obj_id: u64, edge_idx: u32) u64 {
        if (self.isAborted()) return 0;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return 0;
        }
        if (edge_idx >= rec.ref_ids.len) {
            self.setTrap(.bounds);
            return 0;
        }
        return rec.ref_ids[edge_idx];
    }

    pub fn objTypeId(self: *Engine, obj_id: u64) u64 {
        if (obj_id == 0 or obj_id > self.objects.items.len) return 0;
        return self.objects.items[@intCast(obj_id - 1)].type_id;
    }

    pub fn objVirtualTarget(self: *Engine, obj_id: u64, slot: u32) u32 {
        if (self.isAborted()) return 0;
        if (obj_id == 0 or obj_id > self.objects.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const rec = &self.objects.items[@intCast(obj_id - 1)];
        if (!rec.initialized) {
            self.setTrap(.tdz_uninitialized);
            return 0;
        }
        const meta = self.findClass(rec.type_id) orelse {
            self.setTrap(.invalid_handle);
            return 0;
        };
        if (slot >= meta.vtable.len) {
            self.setTrap(.bounds);
            return 0;
        }
        return meta.vtable[slot];
    }

    pub fn objSame(self: *Engine, a_id: u64, b_id: u64) bool {
        if (a_id == 0 or b_id == 0 or a_id > self.objects.items.len or b_id > self.objects.items.len) return false;
        const a = self.objects.items[@intCast(a_id - 1)].handle;
        const b = self.objects.items[@intCast(b_id - 1)].handle;
        return self.heap.sameObject(a, b) catch false;
    }

    /// Trigger real copying moving GC on `ManagedHeap` and count relocated live objects.
    pub fn collectGc(self: *Engine) u64 {
        if (comptime @hasDecl(managed.testing, "location")) {
            var before_addrs: [128]usize = [_]usize{0} ** 128;
            const n = @min(self.objects.items.len, before_addrs.len);
            for (0..n) |i| {
                before_addrs[i] = managed.testing.location(&self.heap, self.objects.items[i].handle) catch 0;
            }
            self.heap.collect() catch {
                self.setTrap(.oom);
                return 0;
            };
            self.gc_collections += 1;
            var moved: u64 = 0;
            for (0..n) |i| {
                const after = managed.testing.location(&self.heap, self.objects.items[i].handle) catch 0;
                if (before_addrs[i] != 0 and after != 0 and before_addrs[i] != after) moved += 1;
            }
            self.gc_moves_observed += moved;
            return moved;
        } else {
            self.heap.collect() catch {
                self.setTrap(.oom);
                return 0;
            };
            self.gc_collections += 1;
            const live: u64 = @intCast(self.heap.objectCount() catch 0);
            self.gc_moves_observed += live;
            return live;
        }
    }

    // ---- M19 / M30: Closures & Lifted Mutable Environments ----
    pub fn envAlloc(self: *Engine, parent_env_id: u64, slot_count: u32) u64 {
        if (self.isAborted()) return 0;
        const edge_count: usize = if (parent_env_id != 0) 1 else 0;
        const h = self.heap.create(0xE001, slot_count, edge_count, .persistent) catch {
            self.setTrap(.oom);
            return 0;
        };
        if (parent_env_id != 0 and parent_env_id <= self.envs.items.len) {
            const p = self.envs.items[@intCast(parent_env_id - 1)].handle;
            self.heap.setEdge(h, 0, p) catch {};
        }
        const slots = self.allocator.alloc(TaggedValue, slot_count) catch {
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        @memset(slots, TaggedValue.undef());
        const inits = self.allocator.alloc(bool, slot_count) catch {
            self.allocator.free(slots);
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        @memset(inits, false);
        self.envs.append(self.allocator, .{
            .handle = h,
            .parent_env_id = parent_env_id,
            .slots = slots,
            .slot_init = inits,
        }) catch {
            self.allocator.free(slots);
            self.allocator.free(inits);
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(self.envs.items.len);
    }

    pub fn envParent(self: *Engine, env_id: u64) u64 {
        if (env_id == 0 or env_id > self.envs.items.len) return 0;
        return self.envs.items[@intCast(env_id - 1)].parent_env_id;
    }

    pub fn envInit(self: *Engine, env_id: u64, slot: u32, val: TaggedValue) void {
        self.envInitWithPolicy(env_id, slot, val, false);
    }

    pub fn envInitWithPolicy(self: *Engine, env_id: u64, slot: u32, val: TaggedValue, allow_admitted_span: bool) void {
        if (self.isAborted()) return;
        if (!allow_admitted_span and val.tag == @intFromEnum(Tag.span)) {
            self.setTrap(.span_escape);
            return;
        }
        if (env_id == 0 or env_id > self.envs.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.envs.items[@intCast(env_id - 1)];
        if (slot >= rec.slots.len) {
            self.setTrap(.bounds);
            return;
        }
        rec.slots[slot] = val;
        rec.slot_init[slot] = true;
    }

    pub fn envStore(self: *Engine, env_id: u64, slot: u32, val: TaggedValue) void {
        self.envStoreWithPolicy(env_id, slot, val, false);
    }

    pub fn envStoreWithPolicy(self: *Engine, env_id: u64, slot: u32, val: TaggedValue, allow_admitted_span: bool) void {
        if (self.isAborted()) return;
        if (!allow_admitted_span and val.tag == @intFromEnum(Tag.span)) {
            self.setTrap(.span_escape);
            return;
        }
        if (env_id == 0 or env_id > self.envs.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.envs.items[@intCast(env_id - 1)];
        if (slot >= rec.slots.len) {
            self.setTrap(.bounds);
            return;
        }
        if (!rec.slot_init[slot]) {
            self.setTrap(.tdz_uninitialized);
            return;
        }
        rec.slots[slot] = val;
    }

    pub fn envLoad(self: *Engine, env_id: u64, slot: u32) TaggedValue {
        if (self.isAborted()) return TaggedValue.undef();
        if (env_id == 0 or env_id > self.envs.items.len) {
            self.setTrap(.invalid_handle);
            return TaggedValue.undef();
        }
        const rec = &self.envs.items[@intCast(env_id - 1)];
        if (slot >= rec.slots.len) {
            self.setTrap(.bounds);
            return TaggedValue.undef();
        }
        if (!rec.slot_init[slot]) {
            self.setTrap(.tdz_uninitialized);
            return TaggedValue.undef();
        }
        return rec.slots[slot];
    }

    pub fn closureMake(self: *Engine, fn_id: u32, env_id: u64) u64 {
        if (self.isAborted()) return 0;
        self.closures.append(self.allocator, .{ .fn_id = fn_id, .env_id = env_id }) catch {
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(self.closures.items.len);
    }

    pub fn closureFnId(self: *const Engine, closure_id: u64) u32 {
        if (closure_id == 0 or closure_id > self.closures.items.len) return 0;
        return self.closures.items[@intCast(closure_id - 1)].fn_id;
    }

    pub fn closureEnvId(self: *const Engine, closure_id: u64) u64 {
        if (closure_id == 0 or closure_id > self.closures.items.len) return 0;
        return self.closures.items[@intCast(closure_id - 1)].env_id;
    }

    // ---- M20 / M31: Unions & Presence ----
    pub fn unionNarrowI32(self: *Engine, val: TaggedValue) i32 {
        if (self.isAborted()) return 0;
        if (val.tag == @intFromEnum(Tag.@"undefined")) {
            self.setTrap(.undefined_numeric);
            return 0;
        }
        if (val.tag != @intFromEnum(Tag.i32)) {
            self.setTrap(.narrow_mismatch);
            return 0;
        }
        return @bitCast(@as(u32, @truncate(val.payload)));
    }

    pub fn unionIsPresent(val: TaggedValue) bool {
        return val.tag != @intFromEnum(Tag.@"undefined") and val.tag != @intFromEnum(Tag.@"null");
    }

    pub fn unionStrictEqual(self: *Engine, a: TaggedValue, b: TaggedValue) bool {
        if (a.tag != b.tag) return false;
        return switch (@as(Tag, @enumFromInt(a.tag))) {
            .@"undefined", .@"null" => true,
            .bool, .i32, .closure, .array, .span => a.payload == b.payload,
            .f64 => {
                const fa: f64 = @bitCast(a.payload);
                const fb: f64 = @bitCast(b.payload);
                return fa == fb; // IEEE: -0.0 == +0.0 true, NaN == NaN false
            },
            .ref => self.objSame(a.payload, b.payload),
        };
    }

    // ---- M21 / M32: Language Exceptions vs Request Traps ----
    pub fn throwException(self: *Engine, payload: TaggedValue) void {
        if (self.trap != .none) return;
        if (payload.tag == @intFromEnum(Tag.span)) {
            // Non-escaping Span borrow MUST NOT escape via exception payload!
            self.setTrap(.span_escape);
            return;
        }
        self.exception_active = true;
        self.exception_payload = payload;
    }

    pub fn hasCatchableException(self: *const Engine) bool {
        // Request traps NEVER enter user catch or finally!
        return self.trap == .none and self.exception_active;
    }

    pub fn takeException(self: *Engine) TaggedValue {
        if (!self.hasCatchableException()) return TaggedValue.undef();
        const p = self.exception_payload;
        self.exception_active = false;
        self.exception_payload = TaggedValue.undef();
        return p;
    }

    pub fn checkReturnNoSpanEscape(self: *Engine, val: TaggedValue) TaggedValue {
        if (val.tag == @intFromEnum(Tag.span)) {
            self.setTrap(.span_escape);
            return TaggedValue.undef();
        }
        return val;
    }

    // ---- M25 / M26 / M34: Dense Array<T> & Non-Escaping ReadSpan/MutSpan Borrows ----
    pub fn arrayCreate(self: *Engine, is_ref: bool) u64 {
        if (self.isAborted()) return 0;
        const h = self.heap.create(if (is_ref) 0xA002 else 0xA001, 0, 0, .persistent) catch {
            self.setTrap(.oom);
            return 0;
        };
        self.arrays.append(self.allocator, .{
            .handle = h,
            .is_ref_elements = is_ref,
        }) catch {
            self.heap.release(h) catch {};
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(self.arrays.items.len);
    }

    pub fn arrayLen(self: *Engine, arr_id: u64) u32 {
        if (self.isAborted()) return 0;
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        return @intCast(self.arrays.items[@intCast(arr_id - 1)].items.items.len);
    }

    pub fn arrayPush(self: *Engine, arr_id: u64, val: TaggedValue) u32 {
        if (self.isAborted()) return 0;
        if (val.tag == @intFromEnum(Tag.span)) {
            self.setTrap(.span_escape);
            return 0;
        }
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        if (rec.active_readers > 0 or rec.active_writer) {
            self.setTrap(.borrow_conflict);
            return 0;
        }
        rec.items.append(self.allocator, val) catch {
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(rec.items.items.len);
    }

    pub fn arrayPop(self: *Engine, arr_id: u64) TaggedValue {
        if (self.isAborted()) return TaggedValue.undef();
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return TaggedValue.undef();
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        if (rec.active_readers > 0 or rec.active_writer) {
            self.setTrap(.borrow_conflict);
            return TaggedValue.undef();
        }
        return rec.items.pop() orelse TaggedValue.undef();
    }

    pub fn arrayGet(self: *Engine, arr_id: u64, idx: u32) TaggedValue {
        if (self.isAborted()) return TaggedValue.undef();
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return TaggedValue.undef();
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        if (rec.active_writer) {
            self.setTrap(.borrow_conflict);
            return TaggedValue.undef();
        }
        if (idx >= rec.items.items.len) {
            self.setTrap(.bounds);
            return TaggedValue.undef();
        }
        return rec.items.items[idx];
    }

    pub fn arraySet(self: *Engine, arr_id: u64, idx: u32, val: TaggedValue) void {
        if (self.isAborted()) return;
        if (val.tag == @intFromEnum(Tag.span)) {
            self.setTrap(.span_escape);
            return;
        }
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        if (rec.active_readers > 0 or rec.active_writer) {
            self.setTrap(.borrow_conflict);
            return;
        }
        if (idx >= rec.items.items.len) {
            self.setTrap(.bounds);
            return;
        }
        rec.items.items[idx] = val;
    }

    pub fn arrayResize(self: *Engine, arr_id: u64, new_len: u32, fill: TaggedValue) void {
        if (self.isAborted()) return;
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return;
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        if (rec.active_readers > 0 or rec.active_writer) {
            self.setTrap(.borrow_conflict);
            return;
        }
        const old_len = rec.items.items.len;
        rec.items.resize(self.allocator, new_len) catch {
            self.setTrap(.oom);
            return;
        };
        if (new_len > old_len) {
            @memset(rec.items.items[old_len..new_len], fill);
        }
    }

    pub fn spanBegin(self: *Engine, arr_id: u64, start: u32, len: u32, mutable: bool) u64 {
        if (self.isAborted()) return 0;
        if (arr_id == 0 or arr_id > self.arrays.items.len) {
            self.setTrap(.invalid_handle);
            return 0;
        }
        const rec = &self.arrays.items[@intCast(arr_id - 1)];
        const end_u64 = @as(u64, start) + @as(u64, len);
        if (end_u64 > rec.items.items.len) {
            self.setTrap(.bounds);
            return 0;
        }
        if (mutable) {
            if (rec.active_readers > 0 or rec.active_writer) {
                self.setTrap(.borrow_conflict);
                return 0;
            }
            rec.active_writer = true;
        } else {
            if (rec.active_writer) {
                self.setTrap(.borrow_conflict);
                return 0;
            }
            rec.active_readers += 1;
        }
        self.spans.append(self.allocator, .{
            .array_id = arr_id,
            .start = start,
            .len = len,
            .mutable = mutable,
            .live = true,
        }) catch {
            if (mutable) rec.active_writer = false else rec.active_readers -= 1;
            self.setTrap(.oom);
            return 0;
        };
        return @intCast(self.spans.items.len);
    }

    pub fn spanLen(self: *Engine, span_id: u64) u32 {
        if (self.isAborted()) return 0;
        if (span_id == 0 or span_id > self.spans.items.len) {
            self.setTrap(.span_expired);
            return 0;
        }
        const sp = &self.spans.items[@intCast(span_id - 1)];
        if (!sp.live) {
            self.setTrap(.span_expired);
            return 0;
        }
        return sp.len;
    }

    pub fn spanGet(self: *Engine, span_id: u64, idx: u32) TaggedValue {
        if (self.isAborted()) return TaggedValue.undef();
        if (span_id == 0 or span_id > self.spans.items.len) {
            self.setTrap(.span_expired);
            return TaggedValue.undef();
        }
        const sp = &self.spans.items[@intCast(span_id - 1)];
        if (!sp.live) {
            self.setTrap(.span_expired);
            return TaggedValue.undef();
        }
        if (idx >= sp.len) {
            self.setTrap(.bounds);
            return TaggedValue.undef();
        }
        const arr = &self.arrays.items[@intCast(sp.array_id - 1)];
        return arr.items.items[sp.start + idx];
    }

    pub fn spanSet(self: *Engine, span_id: u64, idx: u32, val: TaggedValue) void {
        if (self.isAborted()) return;
        if (span_id == 0 or span_id > self.spans.items.len) {
            self.setTrap(.span_expired);
            return;
        }
        const sp = &self.spans.items[@intCast(span_id - 1)];
        if (!sp.live) {
            self.setTrap(.span_expired);
            return;
        }
        if (!sp.mutable) {
            self.setTrap(.span_readonly);
            return;
        }
        if (idx >= sp.len) {
            self.setTrap(.bounds);
            return;
        }
        const arr = &self.arrays.items[@intCast(sp.array_id - 1)];
        arr.items.items[sp.start + idx] = val;
    }

    pub fn spanRelease(self: *Engine, span_id: u64) void {
        if (span_id == 0 or span_id > self.spans.items.len) return;
        const sp = &self.spans.items[@intCast(span_id - 1)];
        if (!sp.live) return;
        sp.live = false;
        const arr = &self.arrays.items[@intCast(sp.array_id - 1)];
        if (sp.mutable) {
            arr.active_writer = false;
        } else if (arr.active_readers > 0) {
            arr.active_readers -= 1;
        }
    }
};

// ============================================================================
// C-ABI Exports for Compiled Windows x86-64 LLVM AOT Modules
// ============================================================================
export fn tsfg_eng_create() ?*Engine {
    return Engine.create(std.heap.page_allocator) catch null;
}
export fn tsfg_eng_destroy(e: ?*Engine) void {
    if (e) |eng| eng.destroy();
}
export fn tsfg_eng_reset(e: ?*Engine, fuel: u64, depth: u32) void {
    if (e) |eng| eng.resetRequest(fuel, depth);
}
export fn tsfg_eng_trap(e: ?*const Engine) u32 {
    return if (e) |eng| @intFromEnum(eng.trap) else @intFromEnum(TrapCode.invalid_handle);
}
export fn tsfg_eng_set_trap(e: ?*Engine, code: u32) void {
    if (e) |eng| eng.setTrap(@enumFromInt(code));
}
export fn tsfg_eng_fuel(e: ?*Engine) i32 {
    return if (e) |eng| @intFromBool(eng.chargeFuel()) else 0;
}
export fn tsfg_eng_enter(e: ?*Engine) i32 {
    return if (e) |eng| @intFromBool(eng.enterCall()) else 0;
}
export fn tsfg_eng_exit(e: ?*Engine) void {
    if (e) |eng| eng.exitCall();
}
export fn tsfg_eng_reg_class(e: ?*Engine, type_id: u64, parent_id: u64, scalars: u16, refs: u16, vt0: u32, vt1: u32) i32 {
    const eng = e orelse return 0;
    var meta = ClassMeta{ .type_id = type_id, .parent_type_id = parent_id, .scalar_fields = scalars, .ref_fields = refs };
    meta.vtable[0] = vt0;
    meta.vtable[1] = vt1;
    eng.registerClass(meta) catch return 0;
    return 1;
}
export fn tsfg_eng_alloc_obj(e: ?*Engine, type_id: u64) u64 {
    return if (e) |eng| eng.allocObject(type_id) else 0;
}
export fn tsfg_eng_mark_init(e: ?*Engine, obj_id: u64) void {
    if (e) |eng| eng.markObjectInitialized(obj_id);
}
export fn tsfg_eng_obj_set_scalar(e: ?*Engine, obj_id: u64, field: u32, val: u64, allow_uninit: u32) void {
    if (e) |eng| eng.objSetScalar(obj_id, field, val, allow_uninit != 0);
}
export fn tsfg_eng_obj_get_scalar(e: ?*Engine, obj_id: u64, field: u32) u64 {
    return if (e) |eng| eng.objGetScalar(obj_id, field) else 0;
}
export fn tsfg_eng_obj_set_ref(e: ?*Engine, obj_id: u64, edge: u32, target: u64, allow_uninit: u32) void {
    if (e) |eng| eng.objSetRef(obj_id, edge, target, allow_uninit != 0);
}
export fn tsfg_eng_obj_get_ref(e: ?*Engine, obj_id: u64, edge: u32) u64 {
    return if (e) |eng| eng.objGetRef(obj_id, edge) else 0;
}
export fn tsfg_eng_obj_vtable(e: ?*Engine, obj_id: u64, slot: u32) u32 {
    return if (e) |eng| eng.objVirtualTarget(obj_id, slot) else 0;
}
export fn tsfg_eng_obj_subtype(e: ?*const Engine, obj_id: u64, target_type: u64) i32 {
    const eng = e orelse return 0;
    if (obj_id == 0 or obj_id > eng.objects.items.len) return 0;
    return @intFromBool(eng.isSubtype(eng.objects.items[@intCast(obj_id - 1)].type_id, target_type));
}
export fn tsfg_eng_gc(e: ?*Engine) u64 {
    return if (e) |eng| eng.collectGc() else 0;
}
export fn tsfg_eng_env_alloc(e: ?*Engine, parent: u64, slots: u32) u64 {
    return if (e) |eng| eng.envAlloc(parent, slots) else 0;
}
export fn tsfg_eng_env_parent(e: ?*Engine, env_id: u64) u64 {
    return if (e) |eng| eng.envParent(env_id) else 0;
}
export fn tsfg_eng_env_init(e: ?*Engine, env_id: u64, slot: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.envInit(env_id, slot, .{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_env_init_admitted(e: ?*Engine, env_id: u64, slot: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.envInitWithPolicy(env_id, slot, .{ .tag = tag, .payload = payload }, true);
}
export fn tsfg_eng_env_store(e: ?*Engine, env_id: u64, slot: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.envStore(env_id, slot, .{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_env_store_admitted(e: ?*Engine, env_id: u64, slot: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.envStoreWithPolicy(env_id, slot, .{ .tag = tag, .payload = payload }, true);
}
export fn tsfg_eng_env_load_payload(e: ?*Engine, env_id: u64, slot: u32) u64 {
    return if (e) |eng| eng.envLoad(env_id, slot).payload else 0;
}
export fn tsfg_eng_env_load_tag(e: ?*Engine, env_id: u64, slot: u32) u16 {
    return if (e) |eng| eng.envLoad(env_id, slot).tag else 0;
}
export fn tsfg_eng_closure_make(e: ?*Engine, fn_id: u32, env_id: u64) u64 {
    return if (e) |eng| eng.closureMake(fn_id, env_id) else 0;
}
export fn tsfg_eng_closure_fn(e: ?*const Engine, cid: u64) u32 {
    return if (e) |eng| eng.closureFnId(cid) else 0;
}
export fn tsfg_eng_closure_env(e: ?*const Engine, cid: u64) u64 {
    return if (e) |eng| eng.closureEnvId(cid) else 0;
}
export fn tsfg_eng_narrow_i32(e: ?*Engine, tag: u16, payload: u64) i32 {
    return if (e) |eng| eng.unionNarrowI32(.{ .tag = tag, .payload = payload }) else 0;
}
export fn tsfg_eng_union_eq(e: ?*Engine, t1: u16, p1: u64, t2: u16, p2: u64) i32 {
    return if (e) |eng| @intFromBool(eng.unionStrictEqual(.{ .tag = t1, .payload = p1 }, .{ .tag = t2, .payload = p2 })) else 0;
}
export fn tsfg_eng_throw(e: ?*Engine, tag: u16, payload: u64) void {
    if (e) |eng| eng.throwException(.{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_has_exc(e: ?*const Engine) i32 {
    return if (e) |eng| @intFromBool(eng.hasCatchableException()) else 0;
}
export fn tsfg_eng_take_exc_tag(e: ?*const Engine) u16 {
    return if (e) |eng| if (eng.hasCatchableException()) eng.exception_payload.tag else 0 else 0;
}
export fn tsfg_eng_take_exc_payload(e: ?*Engine) u64 {
    return if (e) |eng| eng.takeException().payload else 0;
}
export fn tsfg_eng_arr_create(e: ?*Engine, is_ref: u32) u64 {
    return if (e) |eng| eng.arrayCreate(is_ref != 0) else 0;
}
export fn tsfg_eng_arr_len(e: ?*Engine, id: u64) u32 {
    return if (e) |eng| eng.arrayLen(id) else 0;
}
export fn tsfg_eng_arr_push(e: ?*Engine, id: u64, tag: u16, payload: u64) u32 {
    return if (e) |eng| eng.arrayPush(id, .{ .tag = tag, .payload = payload }) else 0;
}
export fn tsfg_eng_arr_pop_payload(e: ?*Engine, id: u64) u64 {
    return if (e) |eng| eng.arrayPop(id).payload else 0;
}
export fn tsfg_eng_arr_get_payload(e: ?*Engine, id: u64, idx: u32) u64 {
    return if (e) |eng| eng.arrayGet(id, idx).payload else 0;
}
export fn tsfg_eng_arr_set(e: ?*Engine, id: u64, idx: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.arraySet(id, idx, .{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_arr_resize(e: ?*Engine, id: u64, new_len: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.arrayResize(id, new_len, .{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_span_begin(e: ?*Engine, arr_id: u64, start: u32, len: u32, mutable: u32) u64 {
    return if (e) |eng| eng.spanBegin(arr_id, start, len, mutable != 0) else 0;
}
export fn tsfg_eng_span_get_payload(e: ?*Engine, span_id: u64, idx: u32) u64 {
    return if (e) |eng| eng.spanGet(span_id, idx).payload else 0;
}
export fn tsfg_eng_span_set(e: ?*Engine, span_id: u64, idx: u32, tag: u16, payload: u64) void {
    if (e) |eng| eng.spanSet(span_id, idx, .{ .tag = tag, .payload = payload });
}
export fn tsfg_eng_span_release(e: ?*Engine, span_id: u64) void {
    if (e) |eng| eng.spanRelease(span_id);
}
export fn tsfg_eng_check_return_escape(e: ?*Engine, tag: u16, payload: u64) u64 {
    return if (e) |eng| eng.checkReturnNoSpanEscape(.{ .tag = tag, .payload = payload }).payload else 0;
}
export fn tsfg_eng_clone_obj(e: ?*Engine, obj_id: u64) u64 {
    return if (e) |eng| eng.cloneObject(obj_id) else 0;
}
export fn tsfg_eng_obj_type_id(e: ?*Engine, obj_id: u64) u64 {
    return if (e) |eng| eng.objTypeId(obj_id) else 0;
}
export fn tsfg_eng_obj_set_field(e: ?*Engine, obj_id: u64, field_idx: u32, tag: u16, payload: u64, allow_uninit: u32) void {
    if (e) |eng| eng.objSetField(obj_id, field_idx, .{ .tag = tag, .payload = payload }, allow_uninit != 0);
}
export fn tsfg_eng_obj_get_field_tag(e: ?*Engine, obj_id: u64, field_idx: u32) u16 {
    return if (e) |eng| eng.objGetField(obj_id, field_idx).tag else 0;
}
export fn tsfg_eng_obj_get_field_payload(e: ?*Engine, obj_id: u64, field_idx: u32) u64 {
    return if (e) |eng| eng.objGetField(obj_id, field_idx).payload else 0;
}
export fn tsfg_eng_global_set(e: ?*Engine, idx: u32, tag: u16, payload: u64) void {
    const eng = e orelse return;
    if (eng.isAborted()) return;
    if (idx >= eng.globals.len) {
        eng.setTrap(.bounds);
        return;
    }
    eng.globals[idx] = .{ .tag = tag, .payload = payload };
    eng.global_init[idx] = true;
}
export fn tsfg_eng_global_get_tag(e: ?*Engine, idx: u32) u16 {
    const eng = e orelse return 0;
    if (eng.isAborted()) return 0;
    if (idx >= eng.globals.len) {
        eng.setTrap(.bounds);
        return 0;
    }
    if (!eng.global_init[idx]) {
        eng.setTrap(.tdz_uninitialized);
        return 0;
    }
    return eng.globals[idx].tag;
}
export fn tsfg_eng_global_get_payload(e: ?*Engine, idx: u32) u64 {
    const eng = e orelse return 0;
    if (eng.isAborted()) return 0;
    if (idx >= eng.globals.len) {
        eng.setTrap(.bounds);
        return 0;
    }
    if (!eng.global_init[idx]) {
        eng.setTrap(.tdz_uninitialized);
        return 0;
    }
    return eng.globals[idx].payload;
}
export fn tsfg_eng_arr_get_tag(e: ?*Engine, id: u64, idx: u32) u16 {
    return if (e) |eng| eng.arrayGet(id, idx).tag else 0;
}
export fn tsfg_eng_span_get_tag(e: ?*Engine, id: u64, idx: u32) u16 {
    return if (e) |eng| eng.spanGet(id, idx).tag else 0;
}
export fn tsfg_eng_read_elem_tag(e: ?*Engine, recv_tag: u16, recv_id: u64, idx: u32) u16 {
    const eng = e orelse return 0;
    if (recv_tag == @intFromEnum(Tag.span)) return eng.spanGet(recv_id, idx).tag;
    if (recv_tag == @intFromEnum(Tag.array)) return eng.arrayGet(recv_id, idx).tag;
    eng.setTrap(.invalid_handle);
    return 0;
}
export fn tsfg_eng_recv_len(e: ?*Engine, recv_tag: u16, recv_id: u64) u32 {
    const eng = e orelse return 0;
    if (recv_tag == @intFromEnum(Tag.span)) return eng.spanLen(recv_id);
    if (recv_tag == @intFromEnum(Tag.array)) return eng.arrayLen(recv_id);
    eng.setTrap(.invalid_handle);
    return 0;
}
export fn tsfg_eng_read_elem_payload(e: ?*Engine, recv_tag: u16, recv_id: u64, idx: u32) u64 {
    const eng = e orelse return 0;
    if (recv_tag == @intFromEnum(Tag.span)) return eng.spanGet(recv_id, idx).payload;
    if (recv_tag == @intFromEnum(Tag.array)) return eng.arrayGet(recv_id, idx).payload;
    eng.setTrap(.invalid_handle);
    return 0;
}
