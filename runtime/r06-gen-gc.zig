// SPDX-License-Identifier: MIT
//! R06 Incremental Generational Tracing GC with:
//!   - Moving young generation (copying evacuation; physical addresses genuinely relocate)
//!   - Non-moving old generation (promoted objects remain pinned at stable addresses)
//!   - Old->Young write barrier + Remembered Set (updates old edges on young relocation)
//!   - Incremental tri-color (white/gray/black) major marking with SATB barrier & bounded work steps
//!   - Explicit Interpreter Root Frames + AOT StackMap safepoint scanning
//!   - Strict OOM byte budget + multi-threaded Safepoint Coordinator
const std = @import("std");
const proto = @import("r04-protocols.zig");

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
    /// Temporary evacuation map during minor GC: old_ptr -> new_ptr
    forwarding: std.AutoHashMapUnmanaged(usize, *GcObject) = .empty,
    /// Registered handle tables / external root providers
    handle_hooks: std.ArrayListUnmanaged(HandleHook) = .empty,
    /// Registered AOT stackmaps by code_id
    aot_stackmaps: std.AutoHashMapUnmanaged(u64, []const proto.SafepointEntry) = .empty,
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

    pub fn pushRootFrame(self: *GenGc, frame: *RootFrame) void {
        frame.prev = self.root_frame_top;
        self.root_frame_top = frame;
    }

    pub fn popRootFrame(self: *GenGc, frame: *RootFrame) void {
        std.debug.assert(self.root_frame_top == frame);
        self.root_frame_top = frame.prev;
        frame.prev = null;
    }

    pub fn registerAotStackMap(self: *GenGc, code_id: u64, entries: []const proto.SafepointEntry) GcError!void {
        self.aot_stackmaps.put(self.allocator, code_id, entries) catch return error.OutOfMemory;
    }

    pub fn unregisterAotStackMap(self: *GenGc, code_id: u64) void {
        _ = self.aot_stackmaps.remove(code_id);
    }

    /// Allocate a new object in the moving young generation, enforcing `max_heap_bytes`.
    pub fn alloc(self: *GenGc, type_id: u64, kind: ObjectKind, scalar_count: usize, edge_count: usize) GcError!*GcObject {
        const bytes = objectBytes(scalar_count, edge_count);
        if (self.stats.live_bytes + bytes > self.max_heap_bytes) {
            // Attempt minor + major collection before reporting OOM
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

        // SATB barrier during incremental major marking: preserve overwritten white old ref
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

        // Generational barrier: record old -> young pointer in remembered set
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
        if (cur.generation == .old) return; // Old generation is NON-MOVING (pinned!)

        const key = @intFromPtr(cur);
        if (self.forwarding.get(key)) |relocated| {
            slot.* = relocated;
            return;
        }

        // Allocate a BRAND-NEW object node so physical address genuinely relocates!
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
    /// objects to pinned old gen, updates all roots + remembered-set old->young edges + handle hooks,
    /// and sweeps dead young objects. Old-gen object addresses NEVER change.
    pub fn collectMinor(self: *GenGc) GcError!void {
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

        // 2. Evacuate external handle table roots
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

        // Sweep old young-space objects (freed after all pointers updated)
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

        // Refresh remembered set: keep only old objects that still point to at least one young object
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

    /// Start an incremental major marking cycle (marks roots gray; old objects stay pinned!).
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
        for (self.handle_hooks.items) |hook| {
            try hook.visit_fn(hook.ctx, &shadeOldGray, self);
        }
        for (self.young.items) |y| {
            for (y.edges) |*e| try self.shadeOldGray(e);
        }
    }

    /// Perform up to `work_budget` incremental tri-color mark steps. Returns `true` when marking finishes.
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
        // Re-scan roots atomically to satisfy final remark
        var f = self.root_frame_top;
        while (f) |frame| {
            for (frame.slots) |*slot| {
                if (slot.isTraceable()) try self.shadeOldGray(&slot.ptr);
            }
            f = frame.prev;
        }
        for (self.handle_hooks.items) |hook| {
            try hook.visit_fn(hook.ctx, &shadeOldGray, self);
        }
        while (self.gray_stack.items.len > 0) {
            const obj = self.gray_stack.pop().?;
            for (obj.edges) |*edge| try self.shadeOldGray(edge);
            obj.color = .black;
        }

        // Sweep unmarked (white) old-generation objects; survivors NEVER move!
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

        // Rebuild remembered set without swept pointers
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
    }

    pub fn collectMajorFull(self: *GenGc) GcError!void {
        try self.collectMinor();
        try self.beginMajorMark();
        while (!(try self.incrementalMarkStep(64))) {}
    }

    /// Walk a raw AOT stack frame byte buffer using a registered R04 `SafepointEntry`,
    /// building a temporary RootFrame and running minor GC so young AOT roots relocate cleanly!
    pub fn collectAtAotSafepoint(self: *GenGc, code_id: u64, pc_offset: u32, frame_mem: []align(8) u8) GcError!void {
        const entries = self.aot_stackmaps.get(code_id) orelse return error.InvalidStackMap;
        const sp = for (entries) |e| {
            if (e.pcOffset == pc_offset) break e;
        } else return error.InvalidStackMap;

        if (@as(usize, @intCast(sp.frameSize)) > frame_mem.len) return error.InvalidStackMap;

        const slots = self.allocator.alloc(RootSlot, sp.roots.len) catch return error.OutOfMemory;
        defer self.allocator.free(slots);

        for (sp.roots, 0..) |r, idx| {
            const off: usize = @intCast(r.slotOffset);
            if (off + @sizeOf(usize) > frame_mem.len) return error.InvalidStackMap;
            const kind: RootKind = if (std.mem.eql(u8, r.kind, "live_ref"))
                .live_ref
            else if (std.mem.eql(u8, r.kind, "nullable_ref"))
                .nullable_ref
            else if (std.mem.eql(u8, r.kind, "union_active_ref"))
                .union_active_ref
            else if (std.mem.eql(u8, r.kind, "derived_span"))
                .derived_span
            else
                return error.InvalidStackMap;

            var tag_val: u16 = 5;
            if (kind == .union_active_ref and r.tagOffset >= 0) {
                const toff: usize = @intCast(r.tagOffset);
                if (toff + 2 > frame_mem.len) return error.InvalidStackMap;
                tag_val = std.mem.readInt(u16, frame_mem[toff..][0..2], .little);
            }
            const is_active = kind != .union_active_ref or tag_val == 5;
            const raw_ptr = std.mem.readInt(usize, frame_mem[off..][0..@sizeOf(usize)], .little);
            const obj_ptr: ?*GcObject = if (!is_active or raw_ptr == 0) null else @ptrFromInt(raw_ptr);
            slots[idx] = .{
                .kind = kind,
                .ptr = obj_ptr,
                .active_tag = tag_val,
                .expected_ref_tag = 5,
            };
        }

        var rf = RootFrame{ .slots = slots };
        self.pushRootFrame(&rf);
        defer self.popRootFrame(&rf);
        try self.collectMinor();

        // Write relocated pointers back into the AOT stack frame in place (never touching inactive union payloads!)
        for (sp.roots, 0..) |r, idx| {
            if (slots[idx].kind == .union_active_ref and slots[idx].active_tag != slots[idx].expected_ref_tag) continue;
            const off: usize = @intCast(r.slotOffset);
            const new_raw: usize = if (slots[idx].ptr) |p| @intFromPtr(p) else 0;
            std.mem.writeInt(usize, frame_mem[off..][0..@sizeOf(usize)], new_raw, .little);
        }
    }
};

/// Multi-threaded Stop-The-World Safepoint Coordinator for concurrent mutators.
pub const SafepointCoordinator = struct {
    mutator_count: u32,
    stop_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    parked_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    epoch: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),
    safepoints_hit: std.atomic.Value(u64) = std.atomic.Value(u64).init(0),

    pub fn init(mutator_count: u32) SafepointCoordinator {
        return .{ .mutator_count = mutator_count };
    }

    /// Called by mutator threads at safe loop/call boundaries.
    pub fn pollSafepoint(self: *SafepointCoordinator) void {
        if (!self.stop_requested.load(.acquire)) return;
        const my_epoch = self.epoch.load(.acquire);
        _ = self.safepoints_hit.fetchAdd(1, .monotonic);
        _ = self.parked_count.fetchAdd(1, .acq_rel);
        // Wait until collector advances epoch and clears stop_requested
        while (self.stop_requested.load(.acquire) and self.epoch.load(.acquire) == my_epoch) {
            std.atomic.spinLoopHint();
        }
    }

    /// Called by GC coordinator thread: pauses all mutators, runs `callback`, then resumes all.
    pub fn stopTheWorld(self: *SafepointCoordinator, ctx: anytype, comptime callback: fn (@TypeOf(ctx)) anyerror!void) !void {
        self.parked_count.store(0, .release);
        self.stop_requested.store(true, .release);
        while (self.parked_count.load(.acquire) < self.mutator_count) {
            std.atomic.spinLoopHint();
        }
        defer {
            _ = self.epoch.fetchAdd(1, .acq_rel);
            self.stop_requested.store(false, .release);
        }
        try callback(ctx);
    }
};
