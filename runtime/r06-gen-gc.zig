// SPDX-License-Identifier: MIT
//! R06 Incremental Generational Tracing GC with:
//!   - Moving young generation (copying evacuation; physical addresses genuinely relocate)
//!   - Non-moving old generation (promoted objects remain pinned at stable addresses)
//!   - Old->Young write barrier + Remembered Set (updates old edges on young relocation)
//!   - Incremental tri-color (white/gray/black) major marking with SATB barrier & bounded work steps
//!   - Explicit Interpreter Root Frames + Owned Deep-Copied Multi-Function AOT StackMaps
//!   - Chained AOT Shadow Stack (`AotShadowFrame`) so nested AOT->AOT calls relocate ALL caller frames
//!   - Strict OOM byte budget + multi-threaded Safepoint Coordinator + Real Profiler Instrumentation
const std = @import("std");
const proto = @import("r04-protocols.zig");
const profiler = @import("tsfg-profiler.zig");

pub const Generation = enum(u8) {
    young = 0,
    old = 1,
};

pub const MarkColor = enum(u8) {
    white = 0,
    gray = 1,
    black = 2,
};

pub const GcError = error{
    OutOfMemory,
    InvalidObject,
    InvalidEdge,
    InvalidRoot,
    InvalidStackMap,
};

pub const ObjectKind = enum(u8) {
    class_instance = 0,
    closure_env = 1,
    array_backing = 2,
    string_obj = 3,
};

/// Managed heap object. Young objects are reallocated to a brand-new address on every minor GC;
/// old objects stay pinned at their allocated address until swept.
pub const GcObject = struct {
    id: u64,
    type_id: u64,
    kind: ObjectKind,
    generation: Generation,
    age: u8,
    color: MarkColor,
    in_remembered_set: bool,
    scalars: []u64,
    edges: []?*GcObject,
    approx_bytes: usize,
};

/// Tagged slot used by interpreter frames & AOT stack frames.
pub const RootKind = enum(u8) {
    scalar = 0,
    live_ref = 1,
    nullable_ref = 2,
    union_active_ref = 3,
    derived_span = 4,
};

pub const RootSlot = struct {
    kind: RootKind = .scalar,
    ptr: ?*GcObject = null,
    /// For union_active_ref, only trace `ptr` when `active_tag == expected_ref_tag`.
    active_tag: u16 = 0,
    expected_ref_tag: u16 = 5,

    pub fn isTraceable(self: RootSlot) bool {
        return switch (self.kind) {
            .scalar => false,
            .live_ref, .nullable_ref, .derived_span => self.ptr != null,
            .union_active_ref => self.active_tag == self.expected_ref_tag and self.ptr != null,
        };
    }
};

/// Linked interpreter / native-bridge root frame.
pub const RootFrame = struct {
    slots: []RootSlot,
    prev: ?*RootFrame = null,
};

/// Owned deep-copied AOT stackmap entry so releasing the caller's JSON/arena parser
/// NEVER leaves dangling slices in `GenGc.aot_stackmaps`.
pub const OwnedRootDesc = struct {
    kind: RootKind,
    slot_offset: i32,
    tag_offset: i32,
};

pub const OwnedSafepointEntry = struct {
    frame_size: i32,
    pc_offset: u32,
    roots: []OwnedRootDesc,
};

/// Chained AOT Shadow Frame pushed by native code around safepoints/calls so nested
/// AOT -> AOT calls walk and relocate young GC pointers across ALL active native frames!
pub const AotShadowFrame = struct {
    code_id: u64,
    pc_offset: u32,
    frame_mem: []align(8) u8,
    prev: ?*AotShadowFrame = null,
};

/// External handle entry updated by GC whenever a young object relocates or an object is swept.
pub const HandleHook = struct {
    ctx: *anyopaque,
    visit_fn: *const fn (ctx: *anyopaque, updater: *const fn (gc: *GenGc, slot: *?*GcObject) GcError!void, gc: *GenGc) GcError!void,
};

pub const GcStats = struct {
    minor_collections: u64 = 0,
    major_collections: u64 = 0,
    objects_relocated: u64 = 0,
    objects_promoted: u64 = 0,
    objects_swept: u64 = 0,
    write_barriers_fired: u64 = 0,
    incremental_mark_steps: u64 = 0,
    live_bytes: usize = 0,
    young_count: usize = 0,
    old_count: usize = 0,
};

fn parseRootKind(s: []const u8) GcError!RootKind {
    if (std.mem.eql(u8, s, "live_ref")) return .live_ref;
    if (std.mem.eql(u8, s, "nullable_ref")) return .nullable_ref;
    if (std.mem.eql(u8, s, "union_active_ref")) return .union_active_ref;
    if (std.mem.eql(u8, s, "derived_span")) return .derived_span;
    return error.InvalidStackMap;
}

pub const GenGc = struct {
    allocator: std.mem.Allocator,
    max_heap_bytes: usize,
    promotion_age: u8 = 2,
    next_id: u64 = 1,
    young: std.ArrayListUnmanaged(*GcObject) = .empty,
    old: std.ArrayListUnmanaged(*GcObject) = .empty,
    remembered: std.ArrayListUnmanaged(*GcObject) = .empty,
    gray_stack: std.ArrayListUnmanaged(*GcObject) = .empty,
    major_marking_active: bool = false,
    root_frame_top: ?*RootFrame = null,
    aot_shadow_top: ?*AotShadowFrame = null,
    /// Temporary evacuation map during minor GC: old_ptr -> new_ptr
    forwarding: std.AutoHashMapUnmanaged(usize, *GcObject) = .empty,
    /// Registered handle tables / VM root providers
    handle_hooks: std.ArrayListUnmanaged(HandleHook) = .empty,
    /// Owned deep-copied AOT stackmaps by code_id (supports multiple functions per DLL!)
    aot_stackmaps: std.AutoHashMapUnmanaged(u64, std.ArrayListUnmanaged(OwnedSafepointEntry)) = .empty,
    trace_recorder: ?*profiler.TraceRecorder = null,
    stats: GcStats = .{},

    pub fn init(allocator: std.mem.Allocator, max_heap_bytes: usize) GenGc {
        return .{
            .allocator = allocator,
            .max_heap_bytes = max_heap_bytes,
        };
    }

    pub fn deinit(self: *GenGc) void {
        for (self.young.items) |obj| self.freeObjectRaw(obj);
        for (self.old.items) |obj| self.freeObjectRaw(obj);
        self.young.deinit(self.allocator);
        self.old.deinit(self.allocator);
        self.remembered.deinit(self.allocator);
        self.gray_stack.deinit(self.allocator);
        self.forwarding.deinit(self.allocator);
        self.handle_hooks.deinit(self.allocator);
        var sm_it = self.aot_stackmaps.valueIterator();
        while (sm_it.next()) |list| {
            for (list.items) |e| self.allocator.free(e.roots);
            list.deinit(self.allocator);
        }
        self.aot_stackmaps.deinit(self.allocator);
    }

    fn objectBytes(scalar_count: usize, edge_count: usize) usize {
        return @sizeOf(GcObject) + scalar_count * @sizeOf(u64) + edge_count * @sizeOf(?*GcObject);
    }

    fn freeObjectRaw(self: *GenGc, obj: *GcObject) void {
        self.allocator.free(obj.scalars);
        self.allocator.free(obj.edges);
        self.allocator.destroy(obj);
    }

    pub fn registerHandleHook(self: *GenGc, hook: HandleHook) GcError!void {
        self.handle_hooks.append(self.allocator, hook) catch return error.OutOfMemory;
    }

    pub fn unregisterHandleHook(self: *GenGc, ctx: *anyopaque) void {
        var i: usize = 0;
        while (i < self.handle_hooks.items.len) {
            if (self.handle_hooks.items[i].ctx == ctx) {
                _ = self.handle_hooks.swapRemove(i);
            } else {
                i += 1;
            }
        }
    }

    pub fn pushRootFrame(self: *GenGc, frame: *RootFrame) void {
        frame.prev = self.root_frame_top;
        self.root_frame_top = frame;
    }

    pub fn popRootFrame(self: *GenGc, frame: *RootFrame) void {
        std.debug.assert(self.root_frame_top == frame);
        self.root_frame_top = frame.prev;
        frame.prev = null;
    }

    pub fn pushAotShadowFrame(self: *GenGc, frame: *AotShadowFrame) void {
        frame.prev = self.aot_shadow_top;
        self.aot_shadow_top = frame;
    }

    pub fn popAotShadowFrame(self: *GenGc, frame: *AotShadowFrame) void {
        std.debug.assert(self.aot_shadow_top == frame);
        self.aot_shadow_top = frame.prev;
        frame.prev = null;
    }

    /// Deep-copies and merges `entries` under `code_id` so multi-function DLLs never overwrite
    /// earlier functions' stackmaps and caller parse arenas can be freed immediately after publish.
    pub fn registerAotStackMap(self: *GenGc, code_id: u64, entries: []const proto.SafepointEntry) GcError!void {
        const gop = self.aot_stackmaps.getOrPut(self.allocator, code_id) catch return error.OutOfMemory;
        if (!gop.found_existing) {
            gop.value_ptr.* = .empty;
        }
        const list = gop.value_ptr;
        for (entries) |e| {
            const owned_roots = self.allocator.alloc(OwnedRootDesc, e.roots.len) catch return error.OutOfMemory;
            errdefer self.allocator.free(owned_roots);
            for (e.roots, 0..) |r, idx| {
                owned_roots[idx] = .{
                    .kind = try parseRootKind(r.kind),
                    .slot_offset = r.slotOffset,
                    .tag_offset = r.tagOffset,
                };
            }
            list.append(self.allocator, .{
                .frame_size = e.frameSize,
                .pc_offset = e.pcOffset,
                .roots = owned_roots,
            }) catch {
                self.allocator.free(owned_roots);
                return error.OutOfMemory;
            };
        }
    }

    pub fn unregisterAotStackMap(self: *GenGc, code_id: u64) void {
        if (self.aot_stackmaps.fetchRemove(code_id)) |kv| {
            var list = kv.value;
            for (list.items) |e| self.allocator.free(e.roots);
            list.deinit(self.allocator);
        }
    }

    fn lookupSafepoint(self: *const GenGc, code_id: u64, pc_offset: u32) GcError!OwnedSafepointEntry {
        const list = self.aot_stackmaps.get(code_id) orelse return error.InvalidStackMap;
        for (list.items) |e| {
            if (e.pc_offset == pc_offset) return e;
        }
        return error.InvalidStackMap;
    }

    fn visitAotShadowFrames(
        self: *GenGc,
        comptime updater: fn (*GenGc, *?*GcObject) GcError!void,
        write_back: bool,
    ) GcError!void {
        var cur = self.aot_shadow_top;
        while (cur) |sf| : (cur = sf.prev) {
            const sp = try self.lookupSafepoint(sf.code_id, sf.pc_offset);
            if (@as(usize, @intCast(sp.frame_size)) > sf.frame_mem.len) return error.InvalidStackMap;
            for (sp.roots) |r| {
                const off: usize = @intCast(r.slot_offset);
                if (off + @sizeOf(usize) > sf.frame_mem.len) return error.InvalidStackMap;
                var is_active = true;
                if (r.kind == .union_active_ref and r.tag_offset >= 0) {
                    const toff: usize = @intCast(r.tag_offset);
                    if (toff + 2 > sf.frame_mem.len) return error.InvalidStackMap;
                    const tag_val = std.mem.readInt(u16, sf.frame_mem[toff..][0..2], .little);
                    is_active = (tag_val == 5);
                }
                if (!is_active) continue;
                const raw_ptr = std.mem.readInt(usize, sf.frame_mem[off..][0..@sizeOf(usize)], .little);
                var obj_ptr: ?*GcObject = if (raw_ptr == 0) null else @ptrFromInt(raw_ptr);
                if (obj_ptr != null) {
                    try updater(self, &obj_ptr);
                    if (write_back) {
                        const new_raw: usize = if (obj_ptr) |p| @intFromPtr(p) else 0;
                        std.mem.writeInt(usize, sf.frame_mem[off..][0..@sizeOf(usize)], new_raw, .little);
                    }
                }
            }
        }
    }

    /// Allocate a new object in the moving young generation, enforcing `max_heap_bytes`.
    pub fn alloc(self: *GenGc, type_id: u64, kind: ObjectKind, scalar_count: usize, edge_count: usize) GcError!*GcObject {
        const bytes = objectBytes(scalar_count, edge_count);
        if (self.stats.live_bytes + bytes > self.max_heap_bytes) {
            try self.collectMinor();
            if (self.stats.live_bytes + bytes > self.max_heap_bytes) {
                try self.collectMajorFull();
            }
            if (self.stats.live_bytes + bytes > self.max_heap_bytes) {
                return error.OutOfMemory;
            }
        }

        const obj = self.allocator.create(GcObject) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(obj);
        const scalars = self.allocator.alloc(u64, scalar_count) catch return error.OutOfMemory;
        errdefer self.allocator.free(scalars);
        @memset(scalars, 0);
        const edges = self.allocator.alloc(?*GcObject, edge_count) catch return error.OutOfMemory;
        errdefer self.allocator.free(edges);
        @memset(edges, null);

        obj.* = .{
            .id = self.next_id,
            .type_id = type_id,
            .kind = kind,
            .generation = .young,
            .age = 0,
            .color = if (self.major_marking_active) .black else .white,
            .in_remembered_set = false,
            .scalars = scalars,
            .edges = edges,
            .approx_bytes = bytes,
        };
        self.young.append(self.allocator, obj) catch return error.OutOfMemory;
        self.next_id += 1;
        self.stats.live_bytes += bytes;
        self.stats.young_count = self.young.items.len;
        return obj;
    }

    /// Write barrier: maintains both generational Remembered Set (old->young) and
    /// incremental SATB/Yuasa tri-color invariant (shading old target / new target gray).
    pub fn writeEdge(self: *GenGc, parent: *GcObject, edge_idx: usize, child: ?*GcObject) GcError!void {
        if (edge_idx >= parent.edges.len) return error.InvalidEdge;
        const prev = parent.edges[edge_idx];

        if (self.major_marking_active) {
            if (prev) |old_child| {
                if (old_child.generation == .old and old_child.color == .white) {
                    old_child.color = .gray;
                    self.gray_stack.append(self.allocator, old_child) catch return error.OutOfMemory;
                    self.stats.write_barriers_fired += 1;
                }
            }
            if (child) |new_child| {
                if (new_child.generation == .old and new_child.color == .white) {
                    new_child.color = .gray;
                    self.gray_stack.append(self.allocator, new_child) catch return error.OutOfMemory;
                    self.stats.write_barriers_fired += 1;
                }
            }
        }

        if (parent.generation == .old) {
            if (child) |c| {
                if (c.generation == .young and !parent.in_remembered_set) {
                    parent.in_remembered_set = true;
                    self.remembered.append(self.allocator, parent) catch {
                        parent.in_remembered_set = false;
                        return error.OutOfMemory;
                    };
                    self.stats.write_barriers_fired += 1;
                }
            }
        }

        parent.edges[edge_idx] = child;
    }

    fn evacuateYoungPtr(self: *GenGc, slot: *?*GcObject) GcError!void {
        const cur = slot.* orelse return;
        if (cur.generation == .old) return;

        const key = @intFromPtr(cur);
        if (self.forwarding.get(key)) |relocated| {
            slot.* = relocated;
            return;
        }

        const dst = self.allocator.create(GcObject) catch return error.OutOfMemory;
        errdefer self.allocator.destroy(dst);
        const scalars = self.allocator.dupe(u64, cur.scalars) catch return error.OutOfMemory;
        errdefer self.allocator.free(scalars);
        const edges = self.allocator.dupe(?*GcObject, cur.edges) catch return error.OutOfMemory;
        errdefer self.allocator.free(edges);

        const next_age = cur.age +| 1;
        const promote = next_age >= self.promotion_age;
        dst.* = .{
            .id = cur.id,
            .type_id = cur.type_id,
            .kind = cur.kind,
            .generation = if (promote) .old else .young,
            .age = next_age,
            .color = if (self.major_marking_active) .black else .white,
            .in_remembered_set = false,
            .scalars = scalars,
            .edges = edges,
            .approx_bytes = cur.approx_bytes,
        };

        self.forwarding.put(self.allocator, key, dst) catch {
            self.freeObjectRaw(dst);
            return error.OutOfMemory;
        };
        self.stats.objects_relocated += 1;
        if (promote) self.stats.objects_promoted += 1;
        slot.* = dst;
    }

    /// Minor GC: evacuates all reachable young objects to fresh addresses, promotes mature
    /// objects to pinned old gen, updates all interpreter frames + chained AOT shadow frames
    /// + external handle/VM hooks + remembered-set old->young edges, and sweeps dead young objects.
    pub fn collectMinor(self: *GenGc) GcError!void {
        const t0 = if (self.trace_recorder) |tr| tr.beginScope() else 0;
        const reloc_before = self.stats.objects_relocated;
        defer if (self.trace_recorder) |tr| tr.endScope(t0, "gc", "gc_minor", @intCast(self.stats.objects_relocated - reloc_before));

        if (self.young.items.len == 0) {
            self.stats.minor_collections += 1;
            return;
        }
        self.forwarding.clearRetainingCapacity();

        // 1. Evacuate roots from linked interpreter / bridge frames
        var f = self.root_frame_top;
        while (f) |frame| {
            for (frame.slots) |*slot| {
                if (slot.isTraceable()) {
                    try self.evacuateYoungPtr(&slot.ptr);
                }
            }
            f = frame.prev;
        }

        // 1b. Evacuate roots across ALL chained native AOT shadow frames (rewriting in place)
        try self.visitAotShadowFrames(evacuateYoungPtr, true);

        // 2. Evacuate external handle table & VM global/closure/array/exception roots
        for (self.handle_hooks.items) |hook| {
            try hook.visit_fn(hook.ctx, &evacuateYoungPtr, self);
        }

        // 3. Evacuate remembered set (old -> young edges)
        for (self.remembered.items) |old_parent| {
            for (old_parent.edges) |*edge| {
                try self.evacuateYoungPtr(edge);
            }
        }

        // 4. Cheney-style transitive scan of newly evacuated objects
        var scan_queue: std.ArrayListUnmanaged(*GcObject) = .empty;
        defer scan_queue.deinit(self.allocator);
        {
            var it = self.forwarding.valueIterator();
            while (it.next()) |val_ptr| {
                scan_queue.append(self.allocator, val_ptr.*) catch return error.OutOfMemory;
            }
        }
        var cursor: usize = 0;
        while (cursor < scan_queue.items.len) : (cursor += 1) {
            const obj = scan_queue.items[cursor];
            for (obj.edges) |*edge| {
                const before_count = self.forwarding.count();
                try self.evacuateYoungPtr(edge);
                if (self.forwarding.count() > before_count) {
                    if (edge.*) |newly| {
                        scan_queue.append(self.allocator, newly) catch return error.OutOfMemory;
                    }
                }
            }
        }

        // 5. Partition survivors into next_young and promoted old; rebuild remembered set
        var next_young: std.ArrayListUnmanaged(*GcObject) = .empty;
        errdefer next_young.deinit(self.allocator);
        for (scan_queue.items) |survivor| {
            if (survivor.generation == .old) {
                self.old.append(self.allocator, survivor) catch return error.OutOfMemory;
            } else {
                next_young.append(self.allocator, survivor) catch return error.OutOfMemory;
            }
        }

        var swept_bytes: usize = 0;
        var swept_count: u64 = 0;
        for (self.young.items) |dead_or_copied| {
            const was_copied = self.forwarding.contains(@intFromPtr(dead_or_copied));
            if (!was_copied) {
                swept_bytes += dead_or_copied.approx_bytes;
                swept_count += 1;
            }
            self.freeObjectRaw(dead_or_copied);
        }
        self.young.deinit(self.allocator);
        self.young = next_young;

        var next_rem: std.ArrayListUnmanaged(*GcObject) = .empty;
        for (self.old.items) |old_obj| {
            var has_young = false;
            for (old_obj.edges) |e| {
                if (e) |child| if (child.generation == .young) {
                    has_young = true;
                    break;
                };
            }
            old_obj.in_remembered_set = has_young;
            if (has_young) {
                next_rem.append(self.allocator, old_obj) catch return error.OutOfMemory;
            }
        }
        self.remembered.deinit(self.allocator);
        self.remembered = next_rem;

        self.forwarding.clearRetainingCapacity();
        self.stats.live_bytes -|= swept_bytes;
        self.stats.objects_swept += swept_count;
        self.stats.young_count = self.young.items.len;
        self.stats.old_count = self.old.items.len;
        self.stats.minor_collections += 1;
    }

    fn shadeOldGray(self: *GenGc, slot: *?*GcObject) GcError!void {
        const obj = slot.* orelse return;
        if (obj.generation == .old and obj.color == .white) {
            obj.color = .gray;
            self.gray_stack.append(self.allocator, obj) catch return error.OutOfMemory;
        }
    }

    pub fn beginMajorMark(self: *GenGc) GcError!void {
        if (self.major_marking_active) return;
        for (self.old.items) |o| o.color = .white;
        self.gray_stack.clearRetainingCapacity();
        self.major_marking_active = true;

        var f = self.root_frame_top;
        while (f) |frame| {
            for (frame.slots) |*slot| {
                if (slot.isTraceable()) try self.shadeOldGray(&slot.ptr);
            }
            f = frame.prev;
        }
        try self.visitAotShadowFrames(shadeOldGray, false);
        for (self.handle_hooks.items) |hook| {
            try hook.visit_fn(hook.ctx, &shadeOldGray, self);
        }
        for (self.young.items) |y| {
            for (y.edges) |*e| try self.shadeOldGray(e);
        }
    }

    pub fn incrementalMarkStep(self: *GenGc, work_budget: usize) GcError!bool {
        if (!self.major_marking_active) try self.beginMajorMark();
        var steps: usize = 0;
        while (steps < work_budget and self.gray_stack.items.len > 0) : (steps += 1) {
            const obj = self.gray_stack.pop().?;
            for (obj.edges) |*edge| {
                try self.shadeOldGray(edge);
            }
            obj.color = .black;
            self.stats.incremental_mark_steps += 1;
        }
        if (self.gray_stack.items.len == 0) {
            try self.finishMajorSweep();
            return true;
        }
        return false;
    }

    fn finishMajorSweep(self: *GenGc) GcError!void {
        const t0 = if (self.trace_recorder) |tr| tr.beginScope() else 0;
        var f = self.root_frame_top;
        while (f) |frame| {
            for (frame.slots) |*slot| {
                if (slot.isTraceable()) try self.shadeOldGray(&slot.ptr);
            }
            f = frame.prev;
        }
        try self.visitAotShadowFrames(shadeOldGray, false);
        for (self.handle_hooks.items) |hook| {
            try hook.visit_fn(hook.ctx, &shadeOldGray, self);
        }
        while (self.gray_stack.items.len > 0) {
            const obj = self.gray_stack.pop().?;
            for (obj.edges) |*edge| try self.shadeOldGray(edge);
            obj.color = .black;
        }

        var survivors: std.ArrayListUnmanaged(*GcObject) = .empty;
        errdefer survivors.deinit(self.allocator);
        var swept_bytes: usize = 0;
        var swept_count: u64 = 0;
        for (self.old.items) |o| {
            if (o.color == .black) {
                o.color = .white;
                survivors.append(self.allocator, o) catch return error.OutOfMemory;
            } else {
                swept_bytes += o.approx_bytes;
                swept_count += 1;
                self.freeObjectRaw(o);
            }
        }
        self.old.deinit(self.allocator);
        self.old = survivors;

        self.remembered.clearRetainingCapacity();
        for (self.old.items) |o| {
            var has_young = false;
            for (o.edges) |e| if (e) |c| if (c.generation == .young) {
                has_young = true;
                break;
            };
            o.in_remembered_set = has_young;
            if (has_young) {
                self.remembered.append(self.allocator, o) catch return error.OutOfMemory;
            }
        }

        self.major_marking_active = false;
        self.stats.live_bytes -|= swept_bytes;
        self.stats.objects_swept += swept_count;
        self.stats.old_count = self.old.items.len;
        self.stats.major_collections += 1;
        if (self.trace_recorder) |tr| tr.endScope(t0, "gc", "gc_major_sweep", @intCast(swept_count));
    }

    pub fn collectMajorFull(self: *GenGc) GcError!void {
        try self.collectMinor();
        try self.beginMajorMark();
        while (!(try self.incrementalMarkStep(64))) {}
    }

    /// Walk the current AOT stack frame AND all chained caller `AotShadowFrame`s using
    /// registered owned `SafepointEntry` tables, relocating ALL live young roots in place.
    pub fn collectAtAotSafepoint(self: *GenGc, code_id: u64, pc_offset: u32, frame_mem: []align(8) u8) GcError!void {
        _ = try self.lookupSafepoint(code_id, pc_offset);
        var leaf = AotShadowFrame{
            .code_id = code_id,
            .pc_offset = pc_offset,
            .frame_mem = frame_mem,
        };
        const already_pushed = if (self.aot_shadow_top) |top|
            (top.frame_mem.ptr == frame_mem.ptr and top.code_id == code_id)
        else
            false;
        if (!already_pushed) {
            self.pushAotShadowFrame(&leaf);
        }
        defer if (!already_pushed) self.popAotShadowFrame(&leaf);
        try self.collectMinor();
    }
};

/// Multi-threaded Stop-The-World Safepoint Coordinator for concurrent mutators.
/// Uses a strict 2-phase barrier (`parked_count` + `in_barrier` + monotonic `epoch`)
/// so back-to-back STW pauses can NEVER deadlock or drop a mutator under OS preemption.
pub const SafepointCoordinator = struct {
    mutator_count: u32,
    stop_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    parked_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    in_barrier: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    epoch: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    safepoints_hit: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),

    pub fn init(mutator_count: u32) SafepointCoordinator {
        return .{ .mutator_count = mutator_count };
    }

    pub fn pollSafepoint(self: *SafepointCoordinator) void {
        if (!self.stop_requested.load(.acquire)) return;
        const my_epoch = self.epoch.load(.acquire);
        if (!self.stop_requested.load(.acquire)) return;
        _ = self.in_barrier.fetchAdd(1, .acq_rel);
        defer _ = self.in_barrier.fetchSub(1, .acq_rel);
        _ = self.safepoints_hit.fetchAdd(1, .monotonic);
        _ = self.parked_count.fetchAdd(1, .acq_rel);
        while (self.epoch.load(.acquire) == my_epoch) {
            std.atomic.spinLoopHint();
        }
    }

    pub fn stopTheWorld(self: *SafepointCoordinator, ctx: anytype, comptime callback: fn (@TypeOf(ctx)) anyerror!void) !void {
        while (self.in_barrier.load(.acquire) > 0) {
            std.atomic.spinLoopHint();
        }
        self.parked_count.store(0, .release);
        self.stop_requested.store(true, .release);
        while (self.parked_count.load(.acquire) < self.mutator_count) {
            std.atomic.spinLoopHint();
        }
        defer {
            self.stop_requested.store(false, .release);
            _ = self.epoch.fetchAdd(1, .acq_rel);
            while (self.in_barrier.load(.acquire) > 0) {
                std.atomic.spinLoopHint();
            }
        }
        try callback(ctx);
    }
};
