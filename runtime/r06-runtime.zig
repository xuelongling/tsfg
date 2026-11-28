// SPDX-License-Identifier: MIT
//! R06 Unified Zig Runtime:
//!   - Value Plane: `ValueArena`, `ValueSpan<T>`, `StringView` (strict UTF-8)
//!   - Reference Plane: `GenGc` (moving young + pinned old + write barrier + incremental mark)
//!   - Generation-Checked `HandleTable` using canonical R04 `ResourceHandle { index: u32, generation: u32 }`
//!   - `CapabilityTable` & Host Resource Registry
//!   - `ModuleRegistry` (load/unload lifecycle, active-frame refcount, `StaticStateBlock` with schema hash)
//!   - ABI Exception Isolation (`BoundaryResult` — managed exceptions NEVER cross Zig/C ABI!)
const std = @import("std");
const r04_id = @import("r04-identity.zig");
const gc_mod = @import("r06-gen-gc.zig");

pub const ResourceHandle = r04_id.ResourceHandle;
pub const GenGc = gc_mod.GenGc;
pub const GcObject = gc_mod.GcObject;
pub const RootFrame = gc_mod.RootFrame;
pub const RootSlot = gc_mod.RootSlot;
pub const RootKind = gc_mod.RootKind;

pub const RuntimeError = gc_mod.GcError || error{
    StaleHandle,
    HandleTypeMismatch,
    CapabilityDenied,
    InvalidUtf8,
    ModuleAlreadyLoaded,
    ModuleNotFound,
    ModuleBusy,
    StaticSchemaMismatch,
    ArenaOverflow,
};

// ============================================================================
// 1. Value Plane: Bump Arena, Typed ValueSpan, Strict UTF-8 StringView
// ============================================================================
pub const ValueArena = struct {
    buf: []u8,
    offset: usize = 0,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, capacity: usize) RuntimeError!ValueArena {
        const buf = allocator.alloc(u8, capacity) catch return error.OutOfMemory;
        return .{ .buf = buf, .offset = 0, .allocator = allocator };
    }

    pub fn deinit(self: *ValueArena) void {
        self.allocator.free(self.buf);
        self.* = undefined;
    }

    pub fn allocSlice(self: *ValueArena, comptime T: type, count: usize) RuntimeError![]T {
        const align_val = @alignOf(T);
        const start = std.mem.alignForward(usize, self.offset, align_val);
        const byte_len = count * @sizeOf(T);
        if (start + byte_len > self.buf.len) return error.ArenaOverflow;
        self.offset = start + byte_len;
        const slice: [*]T = @ptrCast(@alignCast(self.buf.ptr + start));
        return slice[0..count];
    }

    pub fn reset(self: *ValueArena) void {
        self.offset = 0;
    }
};

pub const StringView = extern struct {
    ptr: [*]const u8,
    len: usize,

    pub fn fromStrictUtf8(bytes: []const u8) RuntimeError!StringView {
        if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
        return .{ .ptr = bytes.ptr, .len = bytes.len };
    }

    pub fn slice(self: StringView) []const u8 {
        return self.ptr[0..self.len];
    }
};

// ============================================================================
// 2. Generation-Checked Handle<T> Table (Zig NEVER holds raw GC pointers!)
// ============================================================================
const HandleSlot = struct {
    generation: u32 = 1,
    type_id: u64 = 0,
    object: ?*GcObject = null,
};

pub const HandleTable = struct {
    allocator: std.mem.Allocator,
    slots: std.ArrayListUnmanaged(HandleSlot) = .empty,
    free_list: std.ArrayListUnmanaged(u32) = .empty,

    pub fn init(allocator: std.mem.Allocator) HandleTable {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *HandleTable) void {
        self.slots.deinit(self.allocator);
        self.free_list.deinit(self.allocator);
    }

    pub fn attachToGc(self: *HandleTable, gc: *GenGc) RuntimeError!void {
        try gc.registerHandleHook(.{
            .ctx = self,
            .visit_fn = &visitRoots,
        });
    }

    fn visitRoots(ctx: *anyopaque, updater: *const fn (*GenGc, *?*GcObject) gc_mod.GcError!void, gc: *GenGc) gc_mod.GcError!void {
        const self: *HandleTable = @ptrCast(@alignCast(ctx));
        for (self.slots.items) |*slot| {
            if (slot.object != null) {
                try updater(gc, &slot.object);
            }
        }
    }

    pub fn create(self: *HandleTable, obj: *GcObject) RuntimeError!ResourceHandle {
        if (self.free_list.pop()) |idx| {
            const s = &self.slots.items[idx - 1];
            s.object = obj;
            s.type_id = obj.type_id;
            return .{ .index = idx, .generation = s.generation };
        }
        const idx: u32 = @intCast(self.slots.items.len + 1);
        self.slots.append(self.allocator, .{
            .generation = 1,
            .type_id = obj.type_id,
            .object = obj,
        }) catch return error.OutOfMemory;
        return .{ .index = idx, .generation = 1 };
    }

    pub fn resolve(self: *const HandleTable, h: ResourceHandle, expected_type_id: ?u64) RuntimeError!*GcObject {
        if (h.index == 0 or h.index > self.slots.items.len) return error.StaleHandle;
        const s = &self.slots.items[h.index - 1];
        if (s.generation != h.generation or s.object == null) return error.StaleHandle;
        if (expected_type_id) |tid| {
            if (s.type_id != tid) return error.HandleTypeMismatch;
        }
        return s.object.?;
    }

    pub fn release(self: *HandleTable, h: ResourceHandle) RuntimeError!void {
        if (h.index == 0 or h.index > self.slots.items.len) return error.StaleHandle;
        const s = &self.slots.items[h.index - 1];
        if (s.generation != h.generation or s.object == null) return error.StaleHandle;
        s.object = null;
        s.type_id = 0;
        s.generation +%= 1;
        if (s.generation == 0) s.generation = 1;
        self.free_list.append(self.allocator, h.index) catch return error.OutOfMemory;
    }

    pub fn liveCount(self: *const HandleTable) usize {
        var n: usize = 0;
        for (self.slots.items) |s| if (s.object != null) {
            n += 1;
        };
        return n;
    }
};

// ============================================================================
// 3. Host Capability Table & Resource Registry
// ============================================================================
pub const HostCallbackFn = *const fn (ctx: *anyopaque, arg0: i64, arg1: i64) i64;

pub const CapabilityGrant = struct {
    id: u32,
    name: []const u8,
    ctx: *anyopaque,
    callback: HostCallbackFn,
    call_count: u64 = 0,
};

pub const CapabilityTable = struct {
    allocator: std.mem.Allocator,
    grants: std.ArrayListUnmanaged(CapabilityGrant) = .empty,

    pub fn init(allocator: std.mem.Allocator) CapabilityTable {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *CapabilityTable) void {
        self.grants.deinit(self.allocator);
    }

    pub fn grant(self: *CapabilityTable, id: u32, name: []const u8, ctx: *anyopaque, callback: HostCallbackFn) RuntimeError!void {
        for (self.grants.items) |*g| {
            if (g.id == id) {
                g.name = name;
                g.ctx = ctx;
                g.callback = callback;
                return;
            }
        }
        self.grants.append(self.allocator, .{ .id = id, .name = name, .ctx = ctx, .callback = callback }) catch return error.OutOfMemory;
    }

    pub fn revoke(self: *CapabilityTable, id: u32) void {
        for (self.grants.items, 0..) |g, i| {
            if (g.id == id) {
                _ = self.grants.swapRemove(i);
                return;
            }
        }
    }

    pub fn invoke(self: *CapabilityTable, id: u32, arg0: i64, arg1: i64) RuntimeError!i64 {
        for (self.grants.items) |*g| {
            if (g.id == id) {
                g.call_count += 1;
                return g.callback(g.ctx, arg0, arg1);
            }
        }
        return error.CapabilityDenied;
    }
};

// ============================================================================
// 4. Module Lifecycle & Static State Blocks (Schema-Hashed)
// ============================================================================
pub const StaticStateBlock = struct {
    module_id: [32]u8,
    schema_hash: [32]u8,
    code_version: u64,
    active_frames: u32 = 0,
    slots: []u64,
    slot_init: []bool,
};

pub const ModuleRegistry = struct {
    allocator: std.mem.Allocator,
    modules: std.ArrayListUnmanaged(StaticStateBlock) = .empty,

    pub fn init(allocator: std.mem.Allocator) ModuleRegistry {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ModuleRegistry) void {
        for (self.modules.items) |*m| {
            self.allocator.free(m.slots);
            self.allocator.free(m.slot_init);
        }
        self.modules.deinit(self.allocator);
    }

    pub fn loadModule(self: *ModuleRegistry, module_id: [32]u8, schema_hash: [32]u8, code_version: u64, slot_count: usize) RuntimeError!*StaticStateBlock {
        for (self.modules.items) |m| {
            if (std.mem.eql(u8, &m.module_id, &module_id)) return error.ModuleAlreadyLoaded;
        }
        const slots = self.allocator.alloc(u64, slot_count) catch return error.OutOfMemory;
        errdefer self.allocator.free(slots);
        @memset(slots, 0);
        const slot_init = self.allocator.alloc(bool, slot_count) catch return error.OutOfMemory;
        errdefer self.allocator.free(slot_init);
        @memset(slot_init, false);

        self.modules.append(self.allocator, .{
            .module_id = module_id,
            .schema_hash = schema_hash,
            .code_version = code_version,
            .active_frames = 0,
            .slots = slots,
            .slot_init = slot_init,
        }) catch return error.OutOfMemory;
        return &self.modules.items[self.modules.items.len - 1];
    }

    pub fn findModule(self: *ModuleRegistry, module_id: [32]u8) ?*StaticStateBlock {
        for (self.modules.items) |*m| {
            if (std.mem.eql(u8, &m.module_id, &module_id)) return m;
        }
        return null;
    }

    pub fn unloadModule(self: *ModuleRegistry, module_id: [32]u8) RuntimeError!void {
        for (self.modules.items, 0..) |*m, i| {
            if (std.mem.eql(u8, &m.module_id, &module_id)) {
                if (m.active_frames > 0) return error.ModuleBusy;
                self.allocator.free(m.slots);
                self.allocator.free(m.slot_init);
                _ = self.modules.swapRemove(i);
                return;
            }
        }
        return error.ModuleNotFound;
    }
};

// ============================================================================
// 5. ABI Exception Isolation & Unified R06Runtime
// ============================================================================
pub const BoundaryStatus = enum(u8) {
    ok = 0,
    managed_exception = 1,
    trap = 2,
    execution_abort = 3,
};

pub const BoundaryResult = struct {
    status: BoundaryStatus,
    value_tag: u16 = 0,
    value_payload: u64 = 0,
    code: []const u8 = "",
    source_start: u32 = 0,
    source_end: u32 = 0,
    fuel_remaining: u64 = 0,
};

pub const R06Runtime = struct {
    allocator: std.mem.Allocator,
    gc: GenGc,
    handles: HandleTable,
    arena: ValueArena,
    capabilities: CapabilityTable,
    modules: ModuleRegistry,

    pub fn create(allocator: std.mem.Allocator, max_heap_bytes: usize, arena_bytes: usize) RuntimeError!*R06Runtime {
        const rt = allocator.create(R06Runtime) catch return error.OutOfMemory;
        errdefer allocator.destroy(rt);
        rt.* = .{
            .allocator = allocator,
            .gc = GenGc.init(allocator, max_heap_bytes),
            .handles = HandleTable.init(allocator),
            .arena = try ValueArena.init(allocator, arena_bytes),
            .capabilities = CapabilityTable.init(allocator),
            .modules = ModuleRegistry.init(allocator),
        };
        errdefer rt.gc.deinit();
        errdefer rt.handles.deinit();
        errdefer rt.arena.deinit();
        errdefer rt.capabilities.deinit();
        errdefer rt.modules.deinit();
        try rt.handles.attachToGc(&rt.gc);
        return rt;
    }

    pub fn destroy(self: *R06Runtime) void {
        self.modules.deinit();
        self.capabilities.deinit();
        self.arena.deinit();
        self.handles.deinit();
        self.gc.deinit();
        self.allocator.destroy(self);
    }

    /// Allocate a GC object and immediately wrap it in a generation-checked `ResourceHandle`.
    pub fn allocManagedHandle(self: *R06Runtime, type_id: u64, kind: gc_mod.ObjectKind, scalars: usize, edges: usize) RuntimeError!ResourceHandle {
        const obj = try self.gc.alloc(type_id, kind, scalars, edges);
        return self.handles.create(obj);
    }
};
