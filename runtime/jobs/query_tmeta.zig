// SPDX-License-Identifier: MIT
//! Cold Query metadata and borrowed batch arguments. No executable entry is represented.
const std = @import("std");
const layout = @import("layout.zig");
const storage = @import("store.zig");
const effects_module = @import("query_effects.zig");
pub const schema_hash = "sha256:d598644bbd5360feb48a17cb2511dc93b4dbb2785d2a3f111759dfb6c1b2c69b";
pub const Error = error{ InvalidMetadata, MetadataLimit, IdentityMismatch, WrongStore, BindingMismatch, ReadOnly };
pub const Source = effects_module.Source;
pub const Column = struct { access: storage.Access, alignment: u32, bufferArgument: u32, componentType: []const u8, index: u32, sourceComponentType: []const u8, stride: u32, strideArgument: u32 };
pub const Tuple = struct { bufferArgument: u32, columnIndex: u32, componentType: []const u8, mode: storage.Access, sourceBinding: []const u8, tupleIndex: u32 };
pub const Scalar = struct { argument: u32, sourceBinding: []const u8, sourceParameter: u32, type: []const u8 };
pub const ScalarValue = union(enum) { float32: f32, float64: f64 };
pub const Entry = struct { abiType: []const u8, columns: []const Column, entrySymbol: []const u8, logicalFunctionId: []const u8, loop: u32, queryBinding: []const u8, rowCountArgument: u32, scalars: []const Scalar, signatureHash: []const u8, source: Source, sourceFunctionId: []const u8, tupleOccurrences: []const Tuple };
pub const Payload = struct { batch: []const u8, batchHash: []const u8, componentLayouts: []const u8, effects: []const u8, effectsHash: []const u8, entries: []const Entry, functionIdentityDomain: []const u8, inputIdentity: []const u8, layoutHash: []const u8, packageId: []const u8, sourcePacket: []const u8, sourceRequest: []const u8, target: layout.Target };
const Envelope = struct { family: []const u8, payload: []const u8, payloadHash: []const u8, schemaHash: []const u8, version: u32 };
/// Comes from the independent producer cold reader, never from the same untrusted envelope.
/// Fixing identity grants no Store lease, executable address, publication or execution authority.
pub const Expected = struct { payloadHash: []const u8, inputIdentity: []const u8, packageId: []const u8 };

pub const Document = struct {
    arena: std.heap.ArenaAllocator,
    payload: Payload,
    payload_hash: []const u8,
    component_layout: layout.Layout,
    effects: effects_module.Analysis,

    pub fn load(allocator: std.mem.Allocator, bytes: []const u8, expected: Expected) !Document {
        if (bytes.len == 0 or bytes.len > 8388608 or bytes[bytes.len - 1] != '\n') return error.InvalidMetadata;
        try jsonBudget(bytes);
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const own = arena.allocator();
        const decoded = std.json.parseFromSlice(Envelope, own, bytes, .{ .allocate = .alloc_always, .max_value_len = 8388608 }) catch |err| return if (err == error.OutOfMemory) err else error.InvalidMetadata;
        const env = decoded.value;
        if (env.version != 2 or !std.mem.eql(u8, env.family, "tsfg.query-tmeta") or !std.mem.eql(u8, env.schemaHash, schema_hash)) return error.InvalidMetadata;
        if (env.payload.len > 8388608) return error.MetadataLimit;
        if (!digestId(expected.payloadHash) or !digestId(expected.inputIdentity) or !digestId(expected.packageId) or !std.mem.eql(u8, env.payloadHash, expected.payloadHash)) return error.IdentityMismatch;
        if (!std.mem.eql(u8, &digest("tsfg.query-tmeta.v2\x00", env.payload), env.payloadHash)) return error.InvalidMetadata;
        try jsonBudget(env.payload);
        const decoded_payload = std.json.parseFromSlice(Payload, own, env.payload, .{ .allocate = .alloc_always, .max_value_len = 8388608 }) catch |err| return if (err == error.OutOfMemory) err else error.InvalidMetadata;
        const payload = decoded_payload.value;
        if (!std.mem.eql(u8, try std.json.Stringify.valueAlloc(own, env, .{}), bytes[0 .. bytes.len - 1]) or !std.mem.eql(u8, try std.json.Stringify.valueAlloc(own, payload, .{}), env.payload)) return error.InvalidMetadata;
        if (!std.mem.eql(u8, payload.inputIdentity, expected.inputIdentity) or !std.mem.eql(u8, payload.packageId, expected.packageId) or !std.mem.eql(u8, payload.functionIdentityDomain, "tsfg.module-callable-function.candidate.v1")) return error.IdentityMismatch;
        inline for (std.meta.fields(layout.Target)) |field| if (!std.mem.eql(u8, @field(payload.target, field.name), @field(layout.Target.native, field.name))) return error.WrongTarget;
        if (!std.mem.eql(u8, &digest("", payload.batch), payload.batchHash) or !std.mem.eql(u8, &digest("", payload.componentLayouts), payload.layoutHash) or !std.mem.eql(u8, &digest("", payload.effects), payload.effectsHash)) return error.InvalidMetadata;
        for ([_][]const u8{ payload.batch, payload.componentLayouts, payload.effects, payload.sourcePacket, payload.sourceRequest }) |text| if (text.len == 0 or text[text.len - 1] != '\n') return error.InvalidMetadata;
        var component_layout = try layout.Layout.loadCatalog(allocator, payload.componentLayouts, payload.inputIdentity);
        errdefer component_layout.deinit();
        if (payload.entries.len > 4096) return error.MetadataLimit;
        var work: usize = 1000000;
        for (payload.entries, 0..) |entry, entry_index| {
            try charge(&work, 1 + entry.columns.len + entry.tupleOccurrences.len + entry.scalars.len);
            if (!digestId(entry.logicalFunctionId) or !digestId(entry.sourceFunctionId) or !digestId(entry.signatureHash) or !digestId(entry.queryBinding) or entry.rowCountArgument != 0 or entry.source.start > entry.source.end or !sourcePath(entry.source.path)) return error.InvalidMetadata;
            const previous = if (entry_index > 0) payload.entries[entry_index - 1] else null;
            if (previous) |row| {
                if (std.mem.eql(u8, row.logicalFunctionId, entry.logicalFunctionId)) {
                    if (entry.loop != row.loop + 1 or !std.mem.eql(u8, row.sourceFunctionId, entry.sourceFunctionId) or !std.mem.eql(u8, row.signatureHash, entry.signatureHash) or !std.mem.eql(u8, row.source.path, entry.source.path) or row.source.end > entry.source.start) return error.InvalidMetadata;
                } else if (entry.loop != 0) return error.InvalidMetadata;
            } else if (entry.loop != 0) return error.InvalidMetadata;
            if (previous == null or !std.mem.eql(u8, previous.?.logicalFunctionId, entry.logicalFunctionId)) for (payload.entries[0..entry_index]) |row| {
                try charge(&work, 1);
                if (std.mem.eql(u8, row.logicalFunctionId, entry.logicalFunctionId) or std.mem.eql(u8, row.sourceFunctionId, entry.sourceFunctionId)) return error.InvalidMetadata;
            };
            if (!std.mem.eql(u8, entry.entrySymbol, try std.fmt.allocPrint(own, "batch_{s}_{d}", .{ entry.logicalFunctionId[7..], entry.loop }))) return error.InvalidMetadata;
            if (entry.columns.len == 0 or entry.columns.len > 4096 or entry.tupleOccurrences.len == 0 or entry.tupleOccurrences.len > 4096 or entry.scalars.len > 4096) return error.MetadataLimit;
            var arguments: std.ArrayList([]const u8) = .empty;
            try arguments.append(own, "index");
            for (entry.columns, 0..) |column, index| {
                if (column.index != index or column.bufferArgument != 1 + 2 * index or column.strideArgument != 2 + 2 * index or column.sourceComponentType.len != 72 or !std.mem.startsWith(u8, column.sourceComponentType, "nominal:")) return error.InvalidMetadata;
                for (column.sourceComponentType[8..]) |byte| if (!(byte >= '0' and byte <= '9') and !(byte >= 'a' and byte <= 'f')) return error.InvalidMetadata;
                if (index > 0 and std.mem.order(u8, entry.columns[index - 1].componentType, column.componentType) != .lt) return error.InvalidMetadata;
                const row = component_layout.find(column.componentType) orelse return error.InvalidMetadata;
                if (row.kind != .component or column.stride != row.stride or column.alignment != row.alignment) return error.InvalidMetadata;
                var found = false;
                var access: storage.Access = .read;
                for (entry.tupleOccurrences) |tuple| {
                    try charge(&work, 1);
                    if (tuple.columnIndex == index) {
                        found = true;
                        if (tuple.mode == .write) access = .write;
                    }
                }
                if (!found or column.access != access) return error.InvalidMetadata;
                try arguments.appendSlice(own, &.{ "memref<?xi8>", "index" });
            }
            for (entry.tupleOccurrences, 0..) |tuple, index| {
                if (tuple.tupleIndex != index or tuple.columnIndex >= entry.columns.len or !digestId(tuple.sourceBinding)) return error.InvalidMetadata;
                const column = entry.columns[tuple.columnIndex];
                if (tuple.bufferArgument != column.bufferArgument or !std.mem.eql(u8, tuple.componentType, column.componentType) or (tuple.mode == .write and column.access != .write)) return error.InvalidMetadata;
                for (entry.tupleOccurrences[0..index]) |row| {
                    try charge(&work, 1);
                    if (std.mem.eql(u8, row.sourceBinding, tuple.sourceBinding)) return error.InvalidMetadata;
                }
            }
            for (entry.scalars, 0..) |scalar, index| {
                if (scalar.argument != 1 + 2 * entry.columns.len + index or !digestId(scalar.sourceBinding) or (!std.mem.eql(u8, scalar.type, "f32") and !std.mem.eql(u8, scalar.type, "f64")) or (index > 0 and entry.scalars[index - 1].sourceParameter >= scalar.sourceParameter)) return error.InvalidMetadata;
                try arguments.append(own, scalar.type);
            }
            const joined = try std.mem.join(own, ", ", arguments.items);
            if (!std.mem.eql(u8, entry.abiType, try std.fmt.allocPrint(own, "({s}) -> ()", .{joined}))) return error.InvalidMetadata;
        }
        const effects = try effects_module.decode(own, payload.effects, payload.sourcePacket, payload.inputIdentity, payload.packageId, payload.target, &component_layout);
        var expected_entries: usize = 0;
        for (effects.report.systems) |system| expected_entries += system.loops.len;
        if (expected_entries != payload.entries.len) return error.InvalidEffects;
        for (payload.entries) |entry| {
            const system = effects.system(entry.logicalFunctionId) orelse return error.InvalidEffects;
            if (!std.mem.eql(u8, system.sourceFunctionId, entry.sourceFunctionId) or !std.mem.eql(u8, system.signatureHash, entry.signatureHash) or entry.loop >= system.loops.len) return error.InvalidEffects;
            const loop = system.loops[entry.loop];
            if (!effects_module.sameSource(loop.source, entry.source) or !std.mem.eql(u8, loop.queryBinding, entry.queryBinding) or loop.capabilities.len != entry.columns.len or loop.columns.len != entry.tupleOccurrences.len) return error.InvalidEffects;
            for (loop.capabilities, entry.columns) |capability, column| if (!std.mem.eql(u8, capability.componentType, column.componentType) or !std.mem.eql(u8, capability.sourceComponentType, column.sourceComponentType) or capability.mode != column.access) return error.InvalidEffects;
            for (loop.columns, entry.tupleOccurrences) |column, tuple| if (column.tupleIndex != tuple.tupleIndex or !std.mem.eql(u8, column.sourceBinding, tuple.sourceBinding) or !std.mem.eql(u8, column.componentType, tuple.componentType) or column.mode != tuple.mode) return error.InvalidEffects;
        }
        // Both metadata and typed effects allocations finish before this final arena transfer.
        return .{ .arena = arena, .payload = payload, .payload_hash = env.payloadHash, .component_layout = component_layout, .effects = effects };
    }
    pub fn deinit(self: *Document) void {
        self.component_layout.deinit();
        self.arena.deinit();
        self.* = undefined;
    }
    pub fn bind(self: *const Document, allocator: std.mem.Allocator, store: *storage.Store, batch: storage.Store.Batch, entry_index: usize, scalars: []const ScalarValue) !Plan {
        if (batch.store != store) return error.WrongStore;
        if (!std.mem.eql(u8, &store.layout_identity, &self.component_layout.payload_hash)) return error.IdentityMismatch;
        if (entry_index >= self.payload.entries.len) return error.BindingMismatch;
        const entry = self.payload.entries[entry_index];
        if (scalars.len != entry.scalars.len or try batch.columnCount() != entry.columns.len) return error.BindingMismatch;
        for (entry.scalars, scalars) |formal, actual| {
            const width = switch (actual) {
                .float32 => "f32",
                .float64 => "f64",
            };
            if (!std.mem.eql(u8, formal.type, width)) return error.BindingMismatch;
        }
        const rows = try batch.rowCount();
        if (rows > 65536) return error.BindingMismatch;
        for (entry.columns, 0..) |column, index| {
            const actual = try batch.column(index);
            if (!std.mem.eql(u8, actual.component, column.componentType) or actual.stride != column.stride or actual.access != column.access) return error.BindingMismatch;
            const bytes = try batch.read(index);
            if (bytes.len != try std.math.mul(usize, rows, column.stride) or @intFromPtr(bytes.ptr) % column.alignment != 0) return error.BindingMismatch;
        }
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const own = arena.allocator();
        const tuples = try own.alloc(Plan.TupleBinding, entry.tupleOccurrences.len);
        for (entry.tupleOccurrences, tuples) |tuple, *binding| binding.* = .{ .column = tuple.columnIndex, .access = tuple.mode };
        const columns = try own.alloc(Plan.ColumnBinding, entry.columns.len);
        for (entry.columns, columns) |column, *binding| binding.* = .{ .component = try own.dupe(u8, column.componentType), .stride = column.stride, .access = column.access };
        // Transfer the final allocator state after all owned allocations, including new arena blocks.
        var result: Plan = .{ .arena = undefined, .batch = batch, .rows = rows, .columns = columns, .tuples = tuples, .scalars = try own.dupe(ScalarValue, scalars), .entry_symbol = try own.dupe(u8, entry.entrySymbol), .logical_function_id = try own.dupe(u8, entry.logicalFunctionId), .source_function_id = try own.dupe(u8, entry.sourceFunctionId), .signature_hash = try own.dupe(u8, entry.signatureHash), .entry_index = entry_index, .loop = entry.loop, .source = .{ .path = try own.dupe(u8, entry.source.path), .start = entry.source.start, .end = entry.source.end }, .query_binding = try own.dupe(u8, entry.queryBinding), .metadata_hash = try own.dupe(u8, self.payload_hash), .input_identity = try own.dupe(u8, self.payload.inputIdentity), .package_id = try own.dupe(u8, self.payload.packageId), .effects = try own.dupe(u8, self.payload.effects), .effects_hash = try own.dupe(u8, self.payload.effectsHash) };
        result.arena = arena;
        return result;
    }
};

/// The Store must outlive this plan, exactly as it must outlive its Query/Batch.
/// A plan owns metadata/scalars; original component columns remain borrowed without copying.
pub const Plan = struct {
    const TupleBinding = struct { column: usize, access: storage.Access };
    const ColumnBinding = struct { component: []const u8, stride: usize, access: storage.Access };
    pub const Argument = union(enum) { row_count: usize, column: ColumnBinding, stride: usize, scalar: ScalarValue };
    arena: std.heap.ArenaAllocator,
    batch: storage.Store.Batch,
    rows: usize,
    columns: []const ColumnBinding,
    tuples: []const TupleBinding,
    scalars: []const ScalarValue,
    entry_symbol: []const u8,
    logical_function_id: []const u8,
    source_function_id: []const u8,
    signature_hash: []const u8,
    entry_index: usize,
    loop: u32,
    source: Source,
    query_binding: []const u8,
    metadata_hash: []const u8,
    input_identity: []const u8,
    package_id: []const u8,
    effects: []const u8,
    effects_hash: []const u8,

    pub fn deinit(self: *Plan) void {
        self.arena.deinit();
        self.* = undefined;
    }
    pub fn argument(self: *const Plan, index: usize) !Argument {
        _ = try self.batch.rowCount();
        if (index == 0) return .{ .row_count = self.rows };
        if (index < 1 + 2 * self.columns.len) {
            const column = self.columns[(index - 1) / 2];
            return if (index % 2 == 1) .{ .column = column } else .{ .stride = column.stride };
        }
        const scalar = index - (1 + 2 * self.columns.len);
        if (scalar >= self.scalars.len) return error.BindingMismatch;
        return .{ .scalar = self.scalars[scalar] };
    }
    pub fn readTuple(self: *const Plan, index: usize) ![]const u8 {
        if (index >= self.tuples.len) return error.BindingMismatch;
        return self.batch.read(self.tuples[index].column);
    }
    pub fn writeTuple(self: *const Plan, index: usize) ![]u8 {
        if (index >= self.tuples.len) return error.BindingMismatch;
        if (self.tuples[index].access != .write) return error.ReadOnly;
        return self.batch.write(self.tuples[index].column);
    }
};
fn charge(remaining: *usize, count: usize) Error!void {
    if (count > remaining.*) return error.MetadataLimit;
    remaining.* -= count;
}
fn digest(prefix: []const u8, bytes: []const u8) [71]u8 {
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(prefix);
    hash.update(bytes);
    var value: [32]u8 = undefined;
    hash.final(&value);
    var out: [71]u8 = undefined;
    @memcpy(out[0..7], "sha256:");
    const hex = std.fmt.bytesToHex(value, .lower);
    @memcpy(out[7..], &hex);
    return out;
}
fn digestId(value: []const u8) bool {
    if (value.len != 71 or !std.mem.startsWith(u8, value, "sha256:")) return false;
    for (value[7..]) |byte| if (!(byte >= '0' and byte <= '9') and !(byte >= 'a' and byte <= 'f')) return false;
    return true;
}
fn sourcePath(value: []const u8) bool {
    if (value.len < 2 or value[0] != '/' or std.mem.indexOfAny(u8, value, "\\\x00") != null) return false;
    var segments = std.mem.splitScalar(u8, value[1..], '/');
    while (segments.next()) |segment| if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return false;
    return true;
}
fn jsonBudget(bytes: []const u8) Error!void {
    var depth: usize = 0;
    var quoted = false;
    var escaped = false;
    var tokens: usize = 0;
    for (bytes) |byte| {
        if (quoted) {
            if (escaped) {
                escaped = false;
            } else if (byte == '\\') {
                escaped = true;
            } else if (byte == '"') {
                quoted = false;
            }
        } else if (byte == '"') {
            quoted = true;
            tokens += 1;
        } else if (byte == '{' or byte == '[') {
            depth += 1;
            tokens += 1;
            if (depth > 128) return error.MetadataLimit;
        } else if (byte == '}' or byte == ']') {
            if (depth == 0) return error.InvalidMetadata;
            depth -= 1;
        } else if (byte == ',' or byte == ':') {
            tokens += 1;
        }
        if (tokens > 1000000) return error.MetadataLimit;
    }
    if (depth != 0 or quoted) return error.InvalidMetadata;
}
