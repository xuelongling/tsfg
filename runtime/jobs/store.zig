// SPDX-License-Identifier: MIT
const std = @import("std");
const layout = @import("layout.zig");
pub const Error = error{ InvalidEntity, InvalidArchetype, ComponentMissing, InvalidLease, BorrowConflict, SizeMismatch, StorageLimit };
pub const Entity = struct { index: u32, generation: u32 };
pub const ComponentValue = struct { component: []const u8, bytes: []const u8 };
pub const Access = enum { read, write };
pub const Selection = struct { component: []const u8, access: Access };
const Resolved = struct { component: u32, access: Access };
const Component = struct { id: []const u8, size: usize, stride: usize, alignment: std.mem.Alignment };
const Column = struct { component: u32, allocation: []u8, readers: u32 = 0, writer: bool = false };
const Chunk = struct { columns: []Column, entities: []u32, len: usize = 0, active: usize = 0 };
const Archetype = struct { components: []u32, chunks: std.ArrayListUnmanaged(*Chunk) = .empty };
const Slot = struct { generation: u32 = 1, live: bool = false, archetype: u32 = 0, chunk: u32 = 0, row: u32 = 0 };
const Lease = struct { token: u64, chunk: *Chunk, column: usize, writable: bool, query: bool = false };
const QueryState = struct { token: u64, selection: []Resolved, chunks: []*Chunk };

/// A Store owns component metadata and columns. Its address must remain stable while views live.
/// Raw slices obtained from a view remain borrowed only until that view is released.
pub const Store = struct {
    allocator: std.mem.Allocator,
    metadata: std.heap.ArenaAllocator,
    components: []Component,
    capacity: usize,
    layout_identity: [71]u8,
    archetypes: std.ArrayListUnmanaged(Archetype) = .empty,
    slots: std.ArrayListUnmanaged(Slot) = .empty,
    leases: std.ArrayListUnmanaged(Lease) = .empty,
    queries: std.ArrayListUnmanaged(QueryState) = .empty,
    next_token: u64 = 1,
    mutex: std.atomic.Mutex = .unlocked,

    pub fn init(allocator: std.mem.Allocator, source: *const layout.Layout, chunk_capacity: usize) !Store {
        if (chunk_capacity == 0 or chunk_capacity > 65536) return error.StorageLimit;
        var metadata = std.heap.ArenaAllocator.init(allocator);
        errdefer metadata.deinit();
        const own = metadata.allocator();
        const components = try own.alloc(Component, source.payload.components.len);
        for (source.payload.components, 0..) |id, index| {
            const row = source.find(id).?;
            components[index] = .{ .id = try own.dupe(u8, row.id), .size = row.byteSize, .stride = row.stride, .alignment = .fromByteUnits(row.alignment) };
        }
        return .{ .allocator = allocator, .metadata = metadata, .components = components, .capacity = chunk_capacity, .layout_identity = source.payload_hash };
    }
    fn lock(self: *Store) void {
        while (!self.mutex.tryLock()) std.atomic.spinLoopHint();
    }

    pub fn deinit(self: *Store) Error!void {
        self.lock();
        if (self.leases.items.len != 0 or self.queries.items.len != 0) {
            self.mutex.unlock();
            return error.BorrowConflict;
        }
        for (self.archetypes.items) |*archetype| {
            for (archetype.chunks.items) |chunk| self.freeChunk(chunk);
            archetype.chunks.deinit(self.allocator);
            self.allocator.free(archetype.components);
        }
        self.archetypes.deinit(self.allocator);
        self.slots.deinit(self.allocator);
        self.leases.deinit(self.allocator);
        self.queries.deinit(self.allocator);
        self.metadata.deinit();
        self.mutex.unlock();
        self.* = undefined;
    }

    pub fn addArchetype(self: *Store, ids: []const []const u8) !u32 {
        self.lock();
        defer self.mutex.unlock();
        if (ids.len == 0 or ids.len > self.components.len or self.archetypes.items.len >= std.math.maxInt(u32)) return error.InvalidArchetype;
        const indices = try self.allocator.alloc(u32, ids.len);
        errdefer self.allocator.free(indices);
        for (ids, 0..) |id, index| {
            indices[index] = self.componentIndex(id) orelse return error.ComponentMissing;
            if (index > 0 and indices[index - 1] >= indices[index]) return error.InvalidArchetype;
        }
        for (self.archetypes.items, 0..) |archetype, index| {
            if (std.mem.eql(u32, indices, archetype.components)) {
                self.allocator.free(indices);
                return @intCast(index);
            }
        }
        const id: u32 = @intCast(self.archetypes.items.len);
        try self.archetypes.append(self.allocator, .{ .components = indices });
        return id;
    }

    /// New rows are zero-initialized; supplied complete component values overwrite those zeros.
    pub fn create(self: *Store, archetype_id: u32, initial: []const ComponentValue) !Entity {
        self.lock();
        defer self.mutex.unlock();
        const archetype = try self.archetypeAt(archetype_id);
        for (initial, 0..) |value, index| {
            const component = self.componentIndex(value.component) orelse return error.ComponentMissing;
            if (std.mem.indexOfScalar(u32, archetype.components, component) == null) return error.ComponentMissing;
            if (value.bytes.len != self.components[component].size) return error.SizeMismatch;
            for (initial[0..index]) |previous| if (std.mem.eql(u8, previous.component, value.component)) return error.ComponentMissing;
        }
        var free: ?u32 = null;
        for (self.slots.items, 0..) |slot, index| if (!slot.live and slot.generation != 0) {
            free = @intCast(index);
            break;
        };
        if (free == null) {
            if (self.slots.items.len >= std.math.maxInt(u32)) return error.StorageLimit;
            try self.slots.ensureUnusedCapacity(self.allocator, 1);
            free = @intCast(self.slots.items.len);
        }
        var chunk_index: usize = 0;
        while (chunk_index < archetype.chunks.items.len) : (chunk_index += 1) {
            const chunk = archetype.chunks.items[chunk_index];
            if (chunk.len < self.capacity and chunk.active == 0) break;
        }
        if (chunk_index == archetype.chunks.items.len) {
            if (chunk_index >= std.math.maxInt(u32)) return error.StorageLimit;
            try archetype.chunks.ensureUnusedCapacity(self.allocator, 1);
            const chunk = try self.makeChunk(archetype.components);
            archetype.chunks.appendAssumeCapacity(chunk);
        }
        const chunk = archetype.chunks.items[chunk_index];
        const row = chunk.len;
        for (chunk.columns) |column| {
            const component = self.components[column.component];
            const bytes = column.allocation[row * component.stride .. (row + 1) * component.stride];
            @memset(bytes, 0);
            for (initial) |value| if (std.mem.eql(u8, value.component, component.id)) {
                @memcpy(bytes, value.bytes);
                break;
            };
        }
        if (free.? == self.slots.items.len) self.slots.appendAssumeCapacity(.{});
        const slot = &self.slots.items[free.?];
        slot.live = true;
        slot.archetype = archetype_id;
        slot.chunk = @intCast(chunk_index);
        slot.row = @intCast(row);
        chunk.entities[row] = free.?;
        chunk.len += 1;
        return .{ .index = free.?, .generation = slot.generation };
    }

    pub fn remove(self: *Store, entity: Entity) !void {
        self.lock();
        defer self.mutex.unlock();
        const slot = try self.entityAt(entity);
        const chunk = self.archetypes.items[slot.archetype].chunks.items[slot.chunk];
        if (chunk.active != 0) return error.BorrowConflict;
        const last = chunk.len - 1;
        for (chunk.columns) |column| {
            const stride = self.components[column.component].stride;
            if (slot.row != last) @memcpy(column.allocation[slot.row * stride .. (slot.row + 1) * stride], column.allocation[last * stride .. (last + 1) * stride]);
            @memset(column.allocation[last * stride .. (last + 1) * stride], 0);
        }
        if (slot.row != last) {
            const moved = chunk.entities[last];
            chunk.entities[slot.row] = moved;
            self.slots.items[moved].row = slot.row;
        }
        chunk.len -= 1;
        slot.live = false;
        slot.generation = if (slot.generation == std.math.maxInt(u32)) 0 else slot.generation + 1;
    }

    pub fn write(self: *Store, entity: Entity, component_id: []const u8, bytes: []const u8) !void {
        self.lock();
        defer self.mutex.unlock();
        const location = try self.locate(entity, component_id);
        if (location.column.writer or location.column.readers != 0) return error.BorrowConflict;
        const component = self.components[location.column.component];
        if (bytes.len != component.size) return error.SizeMismatch;
        @memcpy(location.column.allocation[location.row * component.stride .. (location.row + 1) * component.stride], bytes);
    }
    pub fn read(self: *Store, entity: Entity, component_id: []const u8, out: []u8) !void {
        self.lock();
        defer self.mutex.unlock();
        const location = try self.locate(entity, component_id);
        if (location.column.writer) return error.BorrowConflict;
        const component = self.components[location.column.component];
        if (out.len != component.size) return error.SizeMismatch;
        @memcpy(out, location.column.allocation[location.row * component.stride .. (location.row + 1) * component.stride]);
    }

    pub const ReadView = struct {
        store: *Store,
        token: u64,
        pub fn bytes(self: ReadView) ![]const u8 {
            return self.store.viewBytes(self.token, false);
        }
        pub fn release(self: ReadView) !void {
            try self.store.release(self.token);
        }
    };
    pub const WriteView = struct {
        store: *Store,
        token: u64,
        pub fn bytes(self: WriteView) ![]u8 {
            return self.store.viewBytes(self.token, true);
        }
        pub fn release(self: WriteView) !void {
            try self.store.release(self.token);
        }
    };
    pub fn borrowRead(self: *Store, entity: Entity, component: []const u8) !ReadView {
        return .{ .store = self, .token = try self.borrow(entity, component, false) };
    }
    pub fn borrowWrite(self: *Store, entity: Entity, component: []const u8) !WriteView {
        return .{ .store = self, .token = try self.borrow(entity, component, true) };
    }
    fn borrow(self: *Store, entity: Entity, component_id: []const u8, writable: bool) !u64 {
        self.lock();
        defer self.mutex.unlock();
        const location = try self.locate(entity, component_id);
        if (location.column.writer or (writable and location.column.readers != 0)) return error.BorrowConflict;
        if (self.next_token == std.math.maxInt(u64) or location.column.readers == std.math.maxInt(u32)) return error.StorageLimit;
        const token = self.next_token;
        try self.leases.append(self.allocator, .{ .token = token, .chunk = location.chunk, .column = location.index, .writable = writable });
        self.next_token += 1;
        if (writable) location.column.writer = true else location.column.readers += 1;
        location.chunk.active += 1;
        return token;
    }
    fn viewBytes(self: *Store, token: u64, writable: bool) ![]u8 {
        self.lock();
        defer self.mutex.unlock();
        for (self.leases.items) |lease| if (lease.token == token) {
            if (lease.query or (writable and !lease.writable)) return error.InvalidLease;
            const column = lease.chunk.columns[lease.column];
            return column.allocation[0 .. lease.chunk.len * self.components[column.component].stride];
        };
        return error.InvalidLease;
    }
    fn release(self: *Store, token: u64) !void {
        self.lock();
        defer self.mutex.unlock();
        for (self.leases.items, 0..) |lease, index| if (lease.token == token) {
            if (lease.query) return error.InvalidLease;
            endLease(lease);
            _ = self.leases.swapRemove(index);
            return;
        };
        return error.InvalidLease;
    }
    fn endLease(lease: Lease) void {
        const column = &lease.chunk.columns[lease.column];
        if (lease.writable) column.writer = false else column.readers -= 1;
        lease.chunk.active -= 1;
    }

    /// Query and Batch are aliases of one complete borrow session. Releasing either
    /// releases the entire set; component slices are valid only while that session lives.
    pub const Query = struct {
        store: *Store,
        token: u64,
        pub fn batchCount(self: Query) !usize {
            self.store.lock();
            defer self.store.mutex.unlock();
            return (try self.store.queryAt(self.token)).chunks.len;
        }
        pub fn batch(self: Query, index: usize) !Batch {
            self.store.lock();
            defer self.store.mutex.unlock();
            _ = try self.store.queryBatch(self.token, index);
            return .{ .store = self.store, .token = self.token, .index = index };
        }
        pub fn release(self: Query) !void {
            try self.store.releaseQuery(self.token);
        }
    };
    pub const Batch = struct {
        store: *Store,
        token: u64,
        index: usize,
        pub fn rowCount(self: Batch) !usize {
            self.store.lock();
            defer self.store.mutex.unlock();
            return (try self.store.queryBatch(self.token, self.index)).chunk.len;
        }
        pub fn columnCount(self: Batch) !usize {
            self.store.lock();
            defer self.store.mutex.unlock();
            return (try self.store.queryBatch(self.token, self.index)).state.selection.len;
        }
        pub fn column(self: Batch, index: usize) !struct { component: []const u8, stride: usize, access: Access } {
            self.store.lock();
            defer self.store.mutex.unlock();
            const state = (try self.store.queryBatch(self.token, self.index)).state;
            if (index >= state.selection.len) return error.ComponentMissing;
            const item = state.selection[index];
            const component = self.store.components[item.component];
            return .{ .component = component.id, .stride = component.stride, .access = item.access };
        }
        pub fn read(self: Batch, column_index: usize) ![]const u8 {
            return self.store.queryBytes(self.token, self.index, column_index, false);
        }
        pub fn write(self: Batch, column_index: usize) ![]u8 {
            return self.store.queryBytes(self.token, self.index, column_index, true);
        }
        pub fn entity(self: Batch, row: usize) !Entity {
            self.store.lock();
            defer self.store.mutex.unlock();
            const chunk = (try self.store.queryBatch(self.token, self.index)).chunk;
            if (row >= chunk.len) return error.InvalidEntity;
            const index = chunk.entities[row];
            return .{ .index = index, .generation = self.store.slots.items[index].generation };
        }
        pub fn release(self: Batch) !void {
            try self.store.releaseQuery(self.token);
        }
    };

    pub fn query(self: *Store, selection: []const Selection) !Query {
        self.lock();
        defer self.mutex.unlock();
        if (selection.len == 0 or selection.len > self.components.len) return error.ComponentMissing;
        const resolved = try self.allocator.alloc(Resolved, selection.len);
        errdefer self.allocator.free(resolved);
        for (selection, 0..) |item, index| {
            const component = self.componentIndex(item.component) orelse return error.ComponentMissing;
            if (index > 0 and resolved[index - 1].component >= component) return error.ComponentMissing;
            resolved[index] = .{ .component = component, .access = item.access };
        }
        if (self.next_token == std.math.maxInt(u64)) return error.StorageLimit;
        var matches: std.ArrayListUnmanaged(*Chunk) = .empty;
        errdefer matches.deinit(self.allocator);
        for (self.archetypes.items) |archetype| {
            var included = true;
            for (resolved) |item| if (std.mem.indexOfScalar(u32, archetype.components, item.component) == null) {
                included = false;
                break;
            };
            if (!included) continue;
            for (archetype.chunks.items) |chunk| {
                if (chunk.len == 0) continue;
                _ = std.math.add(usize, chunk.active, resolved.len) catch return error.StorageLimit;
                for (resolved) |item| {
                    const column = chunk.columns[std.mem.indexOfScalar(u32, archetype.components, item.component).?];
                    if (column.writer or (item.access == .write and column.readers != 0)) return error.BorrowConflict;
                    if (item.access == .read and column.readers == std.math.maxInt(u32)) return error.StorageLimit;
                }
                try matches.append(self.allocator, chunk);
            }
        }
        const count = std.math.mul(usize, matches.items.len, resolved.len) catch return error.StorageLimit;
        try self.leases.ensureUnusedCapacity(self.allocator, count);
        try self.queries.ensureUnusedCapacity(self.allocator, 1);
        const chunks = try matches.toOwnedSlice(self.allocator);
        const token = self.next_token;
        for (chunks) |chunk| for (resolved) |item| {
            for (chunk.columns, 0..) |*column, column_index| if (column.component == item.component) {
                if (item.access == .write) column.writer = true else column.readers += 1;
                chunk.active += 1;
                self.leases.appendAssumeCapacity(.{ .token = token, .chunk = chunk, .column = column_index, .writable = item.access == .write, .query = true });
                break;
            };
        };
        self.queries.appendAssumeCapacity(.{ .token = token, .selection = resolved, .chunks = chunks });
        self.next_token += 1;
        return .{ .store = self, .token = token };
    }
    fn queryAt(self: *Store, token: u64) Error!*QueryState {
        for (self.queries.items) |*state| if (state.token == token) return state;
        return error.InvalidLease;
    }
    fn queryBatch(self: *Store, token: u64, batch_index: usize) Error!struct { state: *QueryState, chunk: *Chunk } {
        const state = try self.queryAt(token);
        if (batch_index >= state.chunks.len) return error.InvalidLease;
        return .{ .state = state, .chunk = state.chunks[batch_index] };
    }
    fn queryBytes(self: *Store, token: u64, batch_index: usize, column_index: usize, writable: bool) ![]u8 {
        self.lock();
        defer self.mutex.unlock();
        const bound = try self.queryBatch(token, batch_index);
        const chunk = bound.chunk;
        const state = bound.state;
        if (column_index >= state.selection.len) return error.ComponentMissing;
        const item = state.selection[column_index];
        if (writable and item.access != .write) return error.InvalidLease;
        for (chunk.columns) |column| if (column.component == item.component) return column.allocation[0 .. chunk.len * self.components[item.component].stride];
        unreachable;
    }
    fn releaseQuery(self: *Store, token: u64) !void {
        self.lock();
        defer self.mutex.unlock();
        for (self.queries.items, 0..) |state, state_index| if (state.token == token) {
            var index: usize = 0;
            while (index < self.leases.items.len) {
                const lease = self.leases.items[index];
                if (lease.token != token) {
                    index += 1;
                    continue;
                }
                endLease(lease);
                _ = self.leases.swapRemove(index);
            }
            self.allocator.free(state.selection);
            self.allocator.free(state.chunks);
            _ = self.queries.swapRemove(state_index);
            return;
        };
        return error.InvalidLease;
    }
    const Location = struct { chunk: *Chunk, column: *Column, index: usize, row: usize };
    fn locate(self: *Store, entity: Entity, component_id: []const u8) !Location {
        const slot = try self.entityAt(entity);
        const component = self.componentIndex(component_id) orelse return error.ComponentMissing;
        const chunk = self.archetypes.items[slot.archetype].chunks.items[slot.chunk];
        for (chunk.columns, 0..) |*column, index| if (column.component == component) return .{ .chunk = chunk, .column = column, .index = index, .row = slot.row };
        return error.ComponentMissing;
    }
    fn componentIndex(self: *const Store, id: []const u8) ?u32 {
        for (self.components, 0..) |component, index| if (std.mem.eql(u8, component.id, id)) return @intCast(index);
        return null;
    }
    fn archetypeAt(self: *Store, id: u32) Error!*Archetype {
        if (id >= self.archetypes.items.len) return error.InvalidArchetype;
        return &self.archetypes.items[id];
    }
    fn entityAt(self: *Store, entity: Entity) Error!*Slot {
        if (entity.index >= self.slots.items.len) return error.InvalidEntity;
        const slot = &self.slots.items[entity.index];
        if (!slot.live or slot.generation != entity.generation) return error.InvalidEntity;
        return slot;
    }
    fn makeChunk(self: *Store, components: []const u32) !*Chunk {
        const chunk = try self.allocator.create(Chunk);
        errdefer self.allocator.destroy(chunk);
        const entities = try self.allocator.alloc(u32, self.capacity);
        errdefer self.allocator.free(entities);
        const columns = try self.allocator.alloc(Column, components.len);
        var initialized: usize = 0;
        errdefer {
            for (columns[0..initialized]) |column| self.allocator.rawFree(column.allocation, self.components[column.component].alignment, @returnAddress());
            self.allocator.free(columns);
        }
        for (components, 0..) |id, index| {
            const component = self.components[id];
            const size = std.math.mul(usize, self.capacity, component.stride) catch return error.StorageLimit;
            const allocation = self.allocator.rawAlloc(@max(size, 1), component.alignment, @returnAddress()) orelse return error.OutOfMemory;
            columns[index] = .{ .component = id, .allocation = allocation[0..@max(size, 1)] };
            @memset(columns[index].allocation, 0);
            initialized += 1;
        }
        chunk.* = .{ .columns = columns, .entities = entities };
        return chunk;
    }
    fn freeChunk(self: *Store, chunk: *Chunk) void {
        for (chunk.columns) |column| self.allocator.rawFree(column.allocation, self.components[column.component].alignment, @returnAddress());
        self.allocator.free(chunk.columns);
        self.allocator.free(chunk.entities);
        self.allocator.destroy(chunk);
    }
};
