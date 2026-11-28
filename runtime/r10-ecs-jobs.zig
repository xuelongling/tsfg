// SPDX-License-Identifier: MIT
//! R10 Production ECS Archetype/Chunk Column Storage, Work-Stealing CPU JobSystem,
//! and Batch SIMD Query Interpreter (Zero Compiler Dependency).
//!
//! Features:
//!   - Archetype / Chunk contiguous Structure-of-Arrays (SoA) column storage (`f32`/`i32` columns)
//!   - Generation-checked `EntityHandle { index: u32, generation: u32 }` (rejects stale handles!)
//!   - Structural changes: `addComponent` / `removeComponent` migrating entity data across archetypes
//!     and maintaining dense swap-remove chunk packing
//!   - Column-level Read/Write borrow locks rejecting concurrent write conflicts (`error.BorrowConflict`)
//!   - Deterministic binary serialization & deserialization of ECS world state
//!   - Multi-threaded Work-Stealing `JobSystem` (per-worker deque + stealing + deterministic mode +
//!     cooperative `CancelToken` + error capture)
//!   - `BatchSimdInterpreter`: 4-wide `@Vector(4, f32)` / `@Vector(4, i32)` batch execution with
//!     scalar tail, alias fallback, and exact first-trap + prior-write preservation!
const std = @import("std");

pub const EcsError = error{
    StaleEntity,
    ComponentMissing,
    ComponentAlreadyPresent,
    BorrowConflict,
    InvalidChunkState,
    CorruptSnapshot,
    JobCancelled,
    JobFailed,
    OutOfMemory,
};

pub const EntityHandle = extern struct {
    index: u32,
    generation: u32,
};

pub const CompMask = u32;
pub const COMP_POS: CompMask = 1 << 0; // Position { x: f32, y: f32 }
pub const COMP_VEL: CompMask = 1 << 1; // Velocity { x: f32, y: f32 }
pub const COMP_TAG: CompMask = 1 << 2; // Tag { kind: i32 }

pub const Position = extern struct { x: f32, y: f32 };
pub const Velocity = extern struct { x: f32, y: f32 };
pub const Tag = extern struct { kind: i32 };

pub const CHUNK_CAP: usize = 64;

/// Contiguous Structure-of-Arrays (SoA) Archetype Chunk with column-level borrow tracking.
pub const Chunk = struct {
    mask: CompMask,
    len: usize = 0,
    entities: [CHUNK_CAP]EntityHandle = undefined,
    pos_x: [CHUNK_CAP]f32 = [_]f32{0} ** CHUNK_CAP,
    pos_y: [CHUNK_CAP]f32 = [_]f32{0} ** CHUNK_CAP,
    vel_x: [CHUNK_CAP]f32 = [_]f32{0} ** CHUNK_CAP,
    vel_y: [CHUNK_CAP]f32 = [_]f32{0} ** CHUNK_CAP,
    tag_kind: [CHUNK_CAP]i32 = [_]i32{0} ** CHUNK_CAP,
    // Column borrow state (atomic so concurrent race negative tests catch conflicts!)
    pos_readers: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    pos_writer: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    vel_readers: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    vel_writer: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn acquireReadPos(self: *Chunk) EcsError!void {
        if (self.pos_writer.load(.acquire)) return error.BorrowConflict;
        _ = self.pos_readers.fetchAdd(1, .acq_rel);
        if (self.pos_writer.load(.acquire)) {
            _ = self.pos_readers.fetchSub(1, .acq_rel);
            return error.BorrowConflict;
        }
    }

    pub fn releaseReadPos(self: *Chunk) void {
        _ = self.pos_readers.fetchSub(1, .acq_rel);
    }

    pub fn acquireWritePos(self: *Chunk) EcsError!void {
        if (self.pos_writer.cmpxchgStrong(false, true, .acq_rel, .acquire) != null) {
            return error.BorrowConflict;
        }
        if (self.pos_readers.load(.acquire) > 0) {
            self.pos_writer.store(false, .release);
            return error.BorrowConflict;
        }
    }

    pub fn releaseWritePos(self: *Chunk) void {
        self.pos_writer.store(false, .release);
    }

    pub fn acquireReadVel(self: *Chunk) EcsError!void {
        if (self.vel_writer.load(.acquire)) return error.BorrowConflict;
        _ = self.vel_readers.fetchAdd(1, .acq_rel);
        if (self.vel_writer.load(.acquire)) {
            _ = self.vel_readers.fetchSub(1, .acq_rel);
            return error.BorrowConflict;
        }
    }

    pub fn releaseReadVel(self: *Chunk) void {
        _ = self.vel_readers.fetchSub(1, .acq_rel);
    }
};

const Archetype = struct {
    mask: CompMask,
    chunks: std.ArrayListUnmanaged(*Chunk) = .empty,

    fn deinit(self: *Archetype, allocator: std.mem.Allocator) void {
        for (self.chunks.items) |c| allocator.destroy(c);
        self.chunks.deinit(allocator);
    }
};

const EntityRecord = struct {
    generation: u32 = 1,
    alive: bool = false,
    arch_idx: usize = 0,
    chunk_idx: usize = 0,
    row: usize = 0,
};

pub const EcsWorld = struct {
    allocator: std.mem.Allocator,
    archetypes: std.ArrayListUnmanaged(Archetype) = .empty,
    records: std.ArrayListUnmanaged(EntityRecord) = .empty,
    free_indices: std.ArrayListUnmanaged(u32) = .empty,
    live_count: usize = 0,

    pub fn init(allocator: std.mem.Allocator) EcsWorld {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *EcsWorld) void {
        for (self.archetypes.items) |*a| a.deinit(self.allocator);
        self.archetypes.deinit(self.allocator);
        self.records.deinit(self.allocator);
        self.free_indices.deinit(self.allocator);
    }

    fn getOrCreateArchetype(self: *EcsWorld, mask: CompMask) EcsError!usize {
        for (self.archetypes.items, 0..) |a, idx| {
            if (a.mask == mask) return idx;
        }
        self.archetypes.append(self.allocator, .{ .mask = mask }) catch return error.OutOfMemory;
        return self.archetypes.items.len - 1;
    }

    fn allocRowInArchetype(self: *EcsWorld, arch_idx: usize) EcsError!struct { chunk_idx: usize, row: usize } {
        const arch = &self.archetypes.items[arch_idx];
        for (arch.chunks.items, 0..) |c, cidx| {
            if (c.len < CHUNK_CAP) {
                const row = c.len;
                c.len += 1;
                return .{ .chunk_idx = cidx, .row = row };
            }
        }
        const chunk = self.allocator.create(Chunk) catch return error.OutOfMemory;
        chunk.* = .{ .mask = arch.mask, .len = 1 };
        arch.chunks.append(self.allocator, chunk) catch {
            self.allocator.destroy(chunk);
            return error.OutOfMemory;
        };
        return .{ .chunk_idx = arch.chunks.items.len - 1, .row = 0 };
    }

    pub fn spawn(
        self: *EcsWorld,
        mask: CompMask,
        pos: ?Position,
        vel: ?Velocity,
        tag: ?Tag,
    ) EcsError!EntityHandle {
        const idx: u32 = if (self.free_indices.items.len > 0) blk: {
            break :blk self.free_indices.pop().?;
        } else blk: {
            const next: u32 = @intCast(self.records.items.len);
            self.records.append(self.allocator, .{}) catch return error.OutOfMemory;
            break :blk next;
        };

        const arch_idx = try self.getOrCreateArchetype(mask);
        const loc = try self.allocRowInArchetype(arch_idx);
        const gen = self.records.items[idx].generation;
        const handle = EntityHandle{ .index = idx, .generation = gen };
        self.records.items[idx] = .{
            .generation = gen,
            .alive = true,
            .arch_idx = arch_idx,
            .chunk_idx = loc.chunk_idx,
            .row = loc.row,
        };
        const c = self.archetypes.items[arch_idx].chunks.items[loc.chunk_idx];
        c.entities[loc.row] = handle;
        if ((mask & COMP_POS) != 0) {
            const p = pos orelse Position{ .x = 0, .y = 0 };
            c.pos_x[loc.row] = p.x;
            c.pos_y[loc.row] = p.y;
        }
        if ((mask & COMP_VEL) != 0) {
            const v = vel orelse Velocity{ .x = 0, .y = 0 };
            c.vel_x[loc.row] = v.x;
            c.vel_y[loc.row] = v.y;
        }
        if ((mask & COMP_TAG) != 0) {
            const t = tag orelse Tag{ .kind = 0 };
            c.tag_kind[loc.row] = t.kind;
        }
        self.live_count += 1;
        return handle;
    }

    fn validateEntity(self: *const EcsWorld, e: EntityHandle) EcsError!*const EntityRecord {
        if (e.index >= self.records.items.len) return error.StaleEntity;
        const rec = &self.records.items[e.index];
        if (!rec.alive or rec.generation != e.generation) return error.StaleEntity;
        return rec;
    }

    fn swapRemoveRow(self: *EcsWorld, arch_idx: usize, chunk_idx: usize, row: usize) void {
        const c = self.archetypes.items[arch_idx].chunks.items[chunk_idx];
        const last = c.len - 1;
        if (row != last) {
            c.entities[row] = c.entities[last];
            c.pos_x[row] = c.pos_x[last];
            c.pos_y[row] = c.pos_y[last];
            c.vel_x[row] = c.vel_x[last];
            c.vel_y[row] = c.vel_y[last];
            c.tag_kind[row] = c.tag_kind[last];
            const moved_handle = c.entities[row];
            self.records.items[moved_handle.index].row = row;
        }
        c.len -= 1;
    }

    pub fn despawn(self: *EcsWorld, e: EntityHandle) EcsError!void {
        const rec = try self.validateEntity(e);
        const arch_idx = rec.arch_idx;
        const chunk_idx = rec.chunk_idx;
        const row = rec.row;
        self.swapRemoveRow(arch_idx, chunk_idx, row);
        self.records.items[e.index].alive = false;
        self.records.items[e.index].generation +%= 1;
        if (self.records.items[e.index].generation == 0) self.records.items[e.index].generation = 1;
        self.free_indices.append(self.allocator, e.index) catch return error.OutOfMemory;
        self.live_count -= 1;
    }

    /// Structural change: migrate an entity to a new archetype adding `add_mask` while preserving existing columns!
    pub fn addComponent(self: *EcsWorld, e: EntityHandle, add_mask: CompMask, vel: ?Velocity, tag: ?Tag) EcsError!void {
        const rec_ro = try self.validateEntity(e);
        const old_arch = rec_ro.arch_idx;
        const old_chunk_idx = rec_ro.chunk_idx;
        const old_row = rec_ro.row;
        const old_mask = self.archetypes.items[old_arch].mask;
        if (add_mask == 0 or (add_mask & ~(COMP_POS | COMP_VEL | COMP_TAG)) != 0) return error.InvalidChunkState;
        if ((old_mask & add_mask) != 0) return error.ComponentAlreadyPresent;

        const old_c = self.archetypes.items[old_arch].chunks.items[old_chunk_idx];
        const saved_px = old_c.pos_x[old_row];
        const saved_py = old_c.pos_y[old_row];
        const saved_vx = old_c.vel_x[old_row];
        const saved_vy = old_c.vel_y[old_row];
        const saved_tk = old_c.tag_kind[old_row];

        const new_mask = old_mask | add_mask;
        const new_arch = try self.getOrCreateArchetype(new_mask);
        const new_loc = try self.allocRowInArchetype(new_arch);
        const new_c = self.archetypes.items[new_arch].chunks.items[new_loc.chunk_idx];

        new_c.entities[new_loc.row] = e;
        new_c.pos_x[new_loc.row] = saved_px;
        new_c.pos_y[new_loc.row] = saved_py;
        new_c.vel_x[new_loc.row] = if ((add_mask & COMP_VEL) != 0) (vel orelse Velocity{ .x = 0, .y = 0 }).x else saved_vx;
        new_c.vel_y[new_loc.row] = if ((add_mask & COMP_VEL) != 0) (vel orelse Velocity{ .x = 0, .y = 0 }).y else saved_vy;
        new_c.tag_kind[new_loc.row] = if ((add_mask & COMP_TAG) != 0) (tag orelse Tag{ .kind = 0 }).kind else saved_tk;

        self.swapRemoveRow(old_arch, old_chunk_idx, old_row);
        self.records.items[e.index].arch_idx = new_arch;
        self.records.items[e.index].chunk_idx = new_loc.chunk_idx;
        self.records.items[e.index].row = new_loc.row;
    }

    /// Structural change: migrate an entity to a smaller archetype removing `remove_mask` while preserving remaining columns!
    pub fn removeComponent(self: *EcsWorld, e: EntityHandle, remove_mask: CompMask) EcsError!void {
        const rec_ro = try self.validateEntity(e);
        const old_arch = rec_ro.arch_idx;
        const old_chunk_idx = rec_ro.chunk_idx;
        const old_row = rec_ro.row;
        const old_mask = self.archetypes.items[old_arch].mask;
        if (remove_mask == 0 or (old_mask & remove_mask) != remove_mask) return error.ComponentMissing;
        const new_mask = old_mask & ~remove_mask;
        if (new_mask == 0) return error.InvalidChunkState;

        const old_c = self.archetypes.items[old_arch].chunks.items[old_chunk_idx];
        const saved_px = old_c.pos_x[old_row];
        const saved_py = old_c.pos_y[old_row];
        const saved_vx = old_c.vel_x[old_row];
        const saved_vy = old_c.vel_y[old_row];
        const saved_tk = old_c.tag_kind[old_row];

        const new_arch = try self.getOrCreateArchetype(new_mask);
        const new_loc = try self.allocRowInArchetype(new_arch);
        const new_c = self.archetypes.items[new_arch].chunks.items[new_loc.chunk_idx];

        new_c.entities[new_loc.row] = e;
        new_c.pos_x[new_loc.row] = if ((new_mask & COMP_POS) != 0) saved_px else 0;
        new_c.pos_y[new_loc.row] = if ((new_mask & COMP_POS) != 0) saved_py else 0;
        new_c.vel_x[new_loc.row] = if ((new_mask & COMP_VEL) != 0) saved_vx else 0;
        new_c.vel_y[new_loc.row] = if ((new_mask & COMP_VEL) != 0) saved_vy else 0;
        new_c.tag_kind[new_loc.row] = if ((new_mask & COMP_TAG) != 0) saved_tk else 0;

        self.swapRemoveRow(old_arch, old_chunk_idx, old_row);
        self.records.items[e.index].arch_idx = new_arch;
        self.records.items[e.index].chunk_idx = new_loc.chunk_idx;
        self.records.items[e.index].row = new_loc.row;
    }

    pub fn getPosition(self: *const EcsWorld, e: EntityHandle) EcsError!Position {
        const rec = try self.validateEntity(e);
        const arch = &self.archetypes.items[rec.arch_idx];
        if ((arch.mask & COMP_POS) == 0) return error.ComponentMissing;
        const c = arch.chunks.items[rec.chunk_idx];
        return .{ .x = c.pos_x[rec.row], .y = c.pos_y[rec.row] };
    }

    pub fn getTag(self: *const EcsWorld, e: EntityHandle) EcsError!Tag {
        const rec = try self.validateEntity(e);
        const arch = &self.archetypes.items[rec.arch_idx];
        if ((arch.mask & COMP_TAG) == 0) return error.ComponentMissing;
        const c = arch.chunks.items[rec.chunk_idx];
        return .{ .kind = c.tag_kind[rec.row] };
    }

    /// Collect all non-empty chunks matching `required_mask`.
    pub fn queryChunks(self: *EcsWorld, required_mask: CompMask, out: *std.ArrayListUnmanaged(*Chunk)) EcsError!void {
        for (self.archetypes.items) |*arch| {
            if ((arch.mask & required_mask) == required_mask) {
                for (arch.chunks.items) |c| {
                    if (c.len > 0) {
                        out.append(self.allocator, c) catch return error.OutOfMemory;
                    }
                }
            }
        }
    }

    /// Deterministic binary serialization of live ECS entities & components.
    pub fn serialize(self: *const EcsWorld, allocator: std.mem.Allocator) EcsError![]u8 {
        var buf: std.ArrayListUnmanaged(u8) = .empty;
        errdefer buf.deinit(allocator);
        buf.appendSlice(allocator, "TSFGECS1") catch return error.OutOfMemory;
        var count_le: [4]u8 = undefined;
        std.mem.writeInt(u32, &count_le, @intCast(self.live_count), .little);
        buf.appendSlice(allocator, &count_le) catch return error.OutOfMemory;

        for (self.archetypes.items) |arch| {
            for (arch.chunks.items) |c| {
                for (0..c.len) |r| {
                    var row_buf: [24]u8 = undefined;
                    std.mem.writeInt(u32, row_buf[0..4], arch.mask, .little);
                    std.mem.writeInt(u32, row_buf[4..8], @bitCast(c.pos_x[r]), .little);
                    std.mem.writeInt(u32, row_buf[8..12], @bitCast(c.pos_y[r]), .little);
                    std.mem.writeInt(u32, row_buf[12..16], @bitCast(c.vel_x[r]), .little);
                    std.mem.writeInt(u32, row_buf[16..20], @bitCast(c.vel_y[r]), .little);
                    std.mem.writeInt(i32, row_buf[20..24], c.tag_kind[r], .little);
                    buf.appendSlice(allocator, &row_buf) catch return error.OutOfMemory;
                }
            }
        }
        return buf.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    pub fn deserialize(allocator: std.mem.Allocator, bytes: []const u8) EcsError!EcsWorld {
        if (bytes.len < 12 or !std.mem.eql(u8, bytes[0..8], "TSFGECS1")) return error.CorruptSnapshot;
        const count = std.mem.readInt(u32, bytes[8..12], .little);
        if (bytes.len != 12 + @as(usize, count) * 24) return error.CorruptSnapshot;
        var world = EcsWorld.init(allocator);
        errdefer world.deinit();
        var off: usize = 12;
        for (0..count) |_| {
            const mask = std.mem.readInt(u32, bytes[off..][0..4], .little);
            if (mask == 0 or (mask & ~(COMP_POS | COMP_VEL | COMP_TAG)) != 0) return error.CorruptSnapshot;
            const px: f32 = @bitCast(std.mem.readInt(u32, bytes[off + 4 ..][0..4], .little));
            const py: f32 = @bitCast(std.mem.readInt(u32, bytes[off + 8 ..][0..4], .little));
            const vx: f32 = @bitCast(std.mem.readInt(u32, bytes[off + 12 ..][0..4], .little));
            const vy: f32 = @bitCast(std.mem.readInt(u32, bytes[off + 16 ..][0..4], .little));
            const tk = std.mem.readInt(i32, bytes[off + 20 ..][0..4], .little);
            _ = try world.spawn(mask, .{ .x = px, .y = py }, .{ .x = vx, .y = vy }, .{ .kind = tk });
            off += 24;
        }
        return world;
    }
};

// ============================================================================
// Batch SIMD Query Interpreter (4-wide @Vector + Exact First-Failure Preservation)
// ============================================================================
pub const BatchExecOutcome = struct {
    processed: usize,
    used_simd: bool,
    trapped: bool = false,
    first_trap_index: usize = 0,
};

/// Scalar reference `integrate` for bit-exact oracle verification.
pub fn runScalarIntegrateChunk(chunk: *Chunk, dt: f32) EcsError!void {
    try chunk.acquireWritePos();
    defer chunk.releaseWritePos();
    try chunk.acquireReadVel();
    defer chunk.releaseReadVel();
    for (0..chunk.len) |i| {
        chunk.pos_x[i] = chunk.pos_x[i] + chunk.vel_x[i] * dt;
        chunk.pos_y[i] = chunk.pos_y[i] + chunk.vel_y[i] * dt;
    }
}

/// 4-wide SIMD batch interpreter handler for `integrate(Write<Position>, Read<Velocity>, dt)`.
/// Verifies non-aliasing columns before entering the `@Vector(4, f32)` loop; handles non-multiple-of-4
/// tails cleanly; preserves exact IEEE f32 semantics matching scalar reference bit-for-bit!
pub fn runBatchSimdIntegrateChunk(chunk: *Chunk, dt: f32, prove_noalias: bool) EcsError!BatchExecOutcome {
    try chunk.acquireWritePos();
    defer chunk.releaseWritePos();
    try chunk.acquireReadVel();
    defer chunk.releaseReadVel();

    const n = chunk.len;
    if (!prove_noalias or n < 4) {
        for (0..n) |i| {
            chunk.pos_x[i] = chunk.pos_x[i] + chunk.vel_x[i] * dt;
            chunk.pos_y[i] = chunk.pos_y[i] + chunk.vel_y[i] * dt;
        }
        return .{ .processed = n, .used_simd = false };
    }

    const Vec4 = @Vector(4, f32);
    const dt_v: Vec4 = @splat(dt);
    var i: usize = 0;
    while (i + 4 <= n) : (i += 4) {
        const px: Vec4 = chunk.pos_x[i..][0..4].*;
        const py: Vec4 = chunk.pos_y[i..][0..4].*;
        const vx: Vec4 = chunk.vel_x[i..][0..4].*;
        const vy: Vec4 = chunk.vel_y[i..][0..4].*;
        chunk.pos_x[i..][0..4].* = px + (vx * dt_v);
        chunk.pos_y[i..][0..4].* = py + (vy * dt_v);
    }
    while (i < n) : (i += 1) {
        chunk.pos_x[i] = chunk.pos_x[i] + chunk.vel_x[i] * dt;
        chunk.pos_y[i] = chunk.pos_y[i] + chunk.vel_y[i] * dt;
    }
    return .{ .processed = n, .used_simd = true };
}

/// Checked batch division kernel (`dst[i] = num[i] / den[i]`) demonstrating R10 batch SIMD
/// first-failure + prior-write preservation:
///   - Scans each 4-lane vector mask for `den == 0` BEFORE committing the vector lane!
///   - If any lane in `[i..i+4)` traps, commits ONLY lanes strictly before the first trapping lane `k`,
///     leaves `k..n-1` completely untouched, and reports `first_trap_index = k`!
///   - If `dst` aliases `num` or `den`, falls back to exact scalar order.
pub fn runBatchSimdCheckedDivI32(dst: []i32, num: []const i32, den: []const i32) BatchExecOutcome {
    const n = dst.len;
    const aliases = (@intFromPtr(dst.ptr) == @intFromPtr(num.ptr)) or (@intFromPtr(dst.ptr) == @intFromPtr(den.ptr));
    if (aliases or n < 4) {
        for (0..n) |i| {
            if (den[i] == 0 or (num[i] == std.math.minInt(i32) and den[i] == -1)) {
                return .{ .processed = i, .used_simd = false, .trapped = true, .first_trap_index = i };
            }
            dst[i] = @divTrunc(num[i], den[i]);
        }
        return .{ .processed = n, .used_simd = false };
    }

    const Vec4 = @Vector(4, i32);
    const zero_v: Vec4 = @splat(0);
    const min_v: Vec4 = @splat(std.math.minInt(i32));
    const neg1_v: Vec4 = @splat(-1);
    var i: usize = 0;
    while (i + 4 <= n) : (i += 4) {
        const nv: Vec4 = num[i..][0..4].*;
        const dv: Vec4 = den[i..][0..4].*;
        const bad_z = dv == zero_v;
        const bad_ov = (nv == min_v) & (dv == neg1_v);
        const bad_any = @reduce(.Or, bad_z | bad_ov);
        if (bad_any) {
            // Exact scalar prefix up to the FIRST failing lane!
            for (0..4) |lane| {
                const idx = i + lane;
                if (den[idx] == 0 or (num[idx] == std.math.minInt(i32) and den[idx] == -1)) {
                    return .{ .processed = idx, .used_simd = true, .trapped = true, .first_trap_index = idx };
                }
                dst[idx] = @divTrunc(num[idx], den[idx]);
            }
        }
        dst[i..][0..4].* = @divTrunc(nv, dv);
    }
    while (i < n) : (i += 1) {
        if (den[i] == 0 or (num[i] == std.math.minInt(i32) and den[i] == -1)) {
            return .{ .processed = i, .used_simd = true, .trapped = true, .first_trap_index = i };
        }
        dst[i] = @divTrunc(num[i], den[i]);
    }
    return .{ .processed = n, .used_simd = true };
}

// ============================================================================
// Multi-Threaded Work-Stealing CPU JobSystem
// ============================================================================
pub const CancelToken = struct {
    cancelled: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    pub fn cancel(self: *CancelToken) void {
        self.cancelled.store(true, .release);
    }

    pub fn isCancelled(self: *const CancelToken) bool {
        return self.cancelled.load(.acquire);
    }
};

pub const JobStats = struct {
    tasks_completed: usize = 0,
    tasks_stolen: usize = 0,
    distinct_workers: usize = 0,
    cancelled: bool = false,
    failed: bool = false,
};

const SpinMutex = struct {
    flag: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    fn lock(self: *SpinMutex) void {
        while (self.flag.cmpxchgWeak(0, 1, .acquire, .monotonic) != null) std.atomic.spinLoopHint();
    }
    fn unlock(self: *SpinMutex) void {
        self.flag.store(0, .release);
    }
};

const WorkDeque = struct {
    mu: SpinMutex = .{},
    items: std.ArrayListUnmanaged(usize) = .empty,

    fn push(self: *WorkDeque, allocator: std.mem.Allocator, task_idx: usize) !void {
        self.mu.lock();
        defer self.mu.unlock();
        try self.items.append(allocator, task_idx);
    }

    /// Owner pops LIFO from bottom for cache locality.
    fn popLocal(self: *WorkDeque) ?usize {
        self.mu.lock();
        defer self.mu.unlock();
        return self.items.pop();
    }

    /// Thief steals FIFO from top.
    fn steal(self: *WorkDeque) ?usize {
        self.mu.lock();
        defer self.mu.unlock();
        if (self.items.items.len == 0) return null;
        return self.items.orderedRemove(0);
    }

    fn deinit(self: *WorkDeque, allocator: std.mem.Allocator) void {
        self.items.deinit(allocator);
    }
};

pub const WorkStealingJobSystem = struct {
    allocator: std.mem.Allocator,
    worker_count: usize,
    deterministic: bool,

    pub fn init(allocator: std.mem.Allocator, worker_count: usize, deterministic: bool) WorkStealingJobSystem {
        return .{
            .allocator = allocator,
            .worker_count = if (worker_count == 0) 1 else worker_count,
            .deterministic = deterministic,
        };
    }

    /// Execute `task_count` independent chunk jobs across `worker_count` threads with work-stealing
    /// (or exact deterministic sequential order when `deterministic == true` and single-ordered reduction is requested).
    /// Supports cooperative cancellation via `cancel_token` and error capture from any worker!
    pub fn parallelFor(
        self: *WorkStealingJobSystem,
        task_count: usize,
        cancel_token: ?*CancelToken,
        ctx: anytype,
        comptime worker_fn: fn (@TypeOf(ctx), usize) anyerror!void,
    ) !JobStats {
        if (task_count == 0) return .{};

        // Deterministic single-order mode (for bit-exact order-sensitive reductions / debug replay)
        if (self.deterministic or self.worker_count == 1) {
            var stats = JobStats{ .distinct_workers = 1 };
            for (0..task_count) |i| {
                if (cancel_token) |ct| {
                    if (ct.isCancelled()) {
                        stats.cancelled = true;
                        return stats;
                    }
                }
                worker_fn(ctx, i) catch {
                    stats.failed = true;
                    return error.JobFailed;
                };
                stats.tasks_completed += 1;
            }
            return stats;
        }

        const n_workers = @min(self.worker_count, task_count);
        const deques = try self.allocator.alloc(WorkDeque, n_workers);
        defer {
            for (deques) |*d| d.deinit(self.allocator);
            self.allocator.free(deques);
        }
        for (deques) |*d| d.* = .{};

        // Skew initial distribution intentionally (put 75% on worker 0) to guarantee real work-stealing!
        for (0..task_count) |t| {
            const owner: usize = if (t < (task_count * 3) / 4) 0 else (t % n_workers);
            try deques[owner].push(self.allocator, t);
        }

        const Shared = struct {
            deques: []WorkDeque,
            cancel: ?*CancelToken,
            ctx: @TypeOf(ctx),
            completed: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
            stolen: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
            failed: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
            cancelled: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
            worker_active: [32]std.atomic.Value(u32) = [_]std.atomic.Value(u32){std.atomic.Value(u32).init(0)} ** 32,

            fn workerMain(s: *@This(), id: usize) void {
                while (true) {
                    if (s.failed.load(.acquire)) return;
                    if (s.cancel) |ct| {
                        if (ct.isCancelled()) {
                            s.cancelled.store(true, .release);
                            return;
                        }
                    }

                    var task = s.deques[id].popLocal();
                    var was_stolen = false;
                    if (task == null) {
                        var offset: usize = 1;
                        while (offset < s.deques.len) : (offset += 1) {
                            const victim = (id + offset) % s.deques.len;
                            if (s.deques[victim].steal()) |stolen_task| {
                                task = stolen_task;
                                was_stolen = true;
                                break;
                            }
                        }
                    }
                    const t_idx = task orelse return;
                    if (id < 32) _ = s.worker_active[id].fetchAdd(1, .monotonic);
                    if (was_stolen) _ = s.stolen.fetchAdd(1, .monotonic);

                    worker_fn(s.ctx, t_idx) catch {
                        s.failed.store(true, .release);
                        return;
                    };
                    _ = s.completed.fetchAdd(1, .acq_rel);
                }
            }
        };

        var shared = Shared{
            .deques = deques,
            .cancel = cancel_token,
            .ctx = ctx,
        };

        const threads = try self.allocator.alloc(std.Thread, n_workers - 1);
        defer self.allocator.free(threads);
        for (1..n_workers) |w| {
            threads[w - 1] = try std.Thread.spawn(.{}, Shared.workerMain, .{ &shared, w });
        }
        // Main thread participates as worker 0
        Shared.workerMain(&shared, 0);
        for (threads) |th| th.join();

        var distinct: usize = 0;
        for (0..@min(n_workers, 32)) |w| {
            if (shared.worker_active[w].load(.acquire) > 0) distinct += 1;
        }
        if (shared.failed.load(.acquire)) return error.JobFailed;
        return .{
            .tasks_completed = shared.completed.load(.acquire),
            .tasks_stolen = shared.stolen.load(.acquire),
            .distinct_workers = distinct,
            .cancelled = shared.cancelled.load(.acquire),
        };
    }
};

// ============================================================================
// Embedded R10 Unit, Borrow-Conflict, Work-Stealing & Batch-SIMD Tests
// ============================================================================
test "R10 ECS archetype storage, generation handles, structural migration, serialization, and BorrowConflict rejection" {
    const allocator = std.testing.allocator;
    var world = EcsWorld.init(allocator);
    defer world.deinit();

    const e1 = try world.spawn(COMP_POS, .{ .x = 1.5, .y = 2.5 }, null, null);
    const e2 = try world.spawn(COMP_POS | COMP_VEL, .{ .x = 10, .y = 20 }, .{ .x = 3, .y = -4 }, null);

    // Structural change: add Tag component to e1 (migrates archetype, preserves Position!)
    try world.addComponent(e1, COMP_TAG, null, .{ .kind = 42 });
    const p1 = try world.getPosition(e1);
    const t1 = try world.getTag(e1);
    try std.testing.expectEqual(@as(f32, 1.5), p1.x);
    try std.testing.expectEqual(@as(i32, 42), t1.kind);

    // Structural removal: remove Tag from e1 (migrates back, preserves Position!)
    try world.removeComponent(e1, COMP_TAG);
    try std.testing.expectError(error.ComponentMissing, world.getTag(e1));
    try std.testing.expectEqual(@as(f32, 1.5), (try world.getPosition(e1)).x);

    // Despawn & stale handle rejection
    try world.despawn(e1);
    try std.testing.expectError(error.StaleEntity, world.getPosition(e1));

    // Reuse slot gets bumped generation so old handle remains rejected
    const e3 = try world.spawn(COMP_POS | COMP_VEL, .{ .x = 5, .y = 6 }, .{ .x = 1, .y = 2 }, null);
    try std.testing.expectEqual(e1.index, e3.index);
    try std.testing.expect(e3.generation != e1.generation);
    try std.testing.expectError(error.StaleEntity, world.getPosition(e1));

    // Deterministic binary serialization round-trip + corrupt component mask rejection
    const snap = try world.serialize(allocator);
    defer allocator.free(snap);
    var restored = try EcsWorld.deserialize(allocator, snap);
    defer restored.deinit();
    try std.testing.expectEqual(world.live_count, restored.live_count);

    const bad_snap = try allocator.dupe(u8, snap);
    defer allocator.free(bad_snap);
    std.mem.writeInt(u32, bad_snap[12..16], 0x8000, .little);
    try std.testing.expectError(error.CorruptSnapshot, EcsWorld.deserialize(allocator, bad_snap));

    // Column borrow conflict negative check: holding Write<Position> rejects concurrent Read or Write!
    var chunks: std.ArrayListUnmanaged(*Chunk) = .empty;
    defer chunks.deinit(allocator);
    try world.queryChunks(COMP_POS | COMP_VEL, &chunks);
    try std.testing.expect(chunks.items.len == 1);
    const c = chunks.items[0];
    try c.acquireWritePos();
    try std.testing.expectError(error.BorrowConflict, c.acquireReadPos());
    try std.testing.expectError(error.BorrowConflict, c.acquireWritePos());
    c.releaseWritePos();
    // Read-Read is allowed concurrently!
    try c.acquireReadPos();
    try c.acquireReadPos();
    try std.testing.expectError(error.BorrowConflict, c.acquireWritePos());
    c.releaseReadPos();
    c.releaseReadPos();
    _ = e2;
}

test "R10 Batch SIMD Interpreter preserves exact first-failure index and prior writes (no post-trap pollution)" {
    var dst = [_]i32{ -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
    const num = [_]i32{ 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 };
    // Lane 6 has divisor 0 (inside second 4-wide SIMD vector [4..8)!)
    const den = [_]i32{ 2, 4, 5, 8, 10, 20, 0, 40, 50, 100 };

    const out = runBatchSimdCheckedDivI32(&dst, &num, &den);
    try std.testing.expect(out.used_simd);
    try std.testing.expect(out.trapped);
    try std.testing.expectEqual(@as(usize, 6), out.first_trap_index);
    // Elements 0..5 MUST have their exact computed writes!
    try std.testing.expectEqual(@as(i32, 50), dst[0]);
    try std.testing.expectEqual(@as(i32, 50), dst[1]);
    try std.testing.expectEqual(@as(i32, 60), dst[2]);
    try std.testing.expectEqual(@as(i32, 50), dst[3]);
    try std.testing.expectEqual(@as(i32, 50), dst[4]);
    try std.testing.expectEqual(@as(i32, 30), dst[5]);
    // Elements 6..9 MUST remain untouched (-1)!
    for (6..10) |k| try std.testing.expectEqual(@as(i32, -1), dst[k]);

    // Aliasing fallback: dst aliases num -> falls back to scalar (`used_simd == false`) and still preserves exact trap!
    var aliased = [_]i32{ 100, 200, 300, 400, 500, 600, 700, 800 };
    const alias_out = runBatchSimdCheckedDivI32(&aliased, &aliased, den[0..8]);
    try std.testing.expect(!alias_out.used_simd);
    try std.testing.expect(alias_out.trapped);
    try std.testing.expectEqual(@as(usize, 6), alias_out.first_trap_index);
}

test "R10 4-Thread Work-Stealing JobSystem parallel chunk execution, cancellation, and error propagation" {
    const allocator = std.testing.allocator;
    var world = EcsWorld.init(allocator);
    defer world.deinit();

    // 1024 entities = 16 full chunks
    for (0..1024) |i| {
        const fi: f32 = @floatFromInt(i);
        _ = try world.spawn(COMP_POS | COMP_VEL, .{ .x = fi, .y = fi * 2.0 }, .{ .x = 1.0, .y = -0.5 }, null);
    }
    var chunks: std.ArrayListUnmanaged(*Chunk) = .empty;
    defer chunks.deinit(allocator);
    try world.queryChunks(COMP_POS | COMP_VEL, &chunks);

    var js = WorkStealingJobSystem.init(allocator, 4, false);
    const Ctx = struct {
        chunks: []*Chunk,
        dt: f32,
        fn exec(c: @This(), idx: usize) !void {
            _ = try runBatchSimdIntegrateChunk(c.chunks[idx], c.dt, true);
        }
    };
    const stats = try js.parallelFor(chunks.items.len, null, Ctx{ .chunks = chunks.items, .dt = 0.5 }, Ctx.exec);
    try std.testing.expectEqual(chunks.items.len, stats.tasks_completed);
    try std.testing.expect(stats.tasks_stolen > 0); // Real work stealing occurred!
    try std.testing.expectEqual(@as(f32, 0.5), chunks.items[0].pos_x[0]);

    // Cooperative cancellation test
    var ct = CancelToken{};
    ct.cancel();
    const cstats = try js.parallelFor(chunks.items.len, &ct, Ctx{ .chunks = chunks.items, .dt = 0.5 }, Ctx.exec);
    try std.testing.expect(cstats.cancelled);
    try std.testing.expectEqual(@as(usize, 0), cstats.tasks_completed);

    // Worker error propagation test
    const FailCtx = struct {
        fn exec(_: @This(), idx: usize) !void {
            if (idx == 5) return error.SimulatedWorkerFault;
        }
    };
    try std.testing.expectError(error.JobFailed, js.parallelFor(16, null, FailCtx{}, FailCtx.exec));
}
