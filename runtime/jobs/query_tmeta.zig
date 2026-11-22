// SPDX-License-Identifier: MIT
//! Cold Query metadata and borrowed batch arguments. No executable entry is represented.
const std = @import("std");
const layout = @import("layout.zig");
const storage = @import("store.zig");
const effects_module = @import("query_effects.zig");
pub const schema_hash = "sha256:d598644bbd5360feb48a17cb2511dc93b4dbb2785d2a3f111759dfb6c1b2c69b";
pub const Error = error{ InvalidMetadata, MetadataLimit, IdentityMismatch, WrongStore, BindingMismatch, ReadOnly };
pub const ParallelAdmission = union(enum) {
    admitted: ParallelGroup,
    // IDs borrow the checked Document. Ends are ordered by the original request.
    conflict: struct { left: []const u8, right: []const u8, component: []const u8 },
};
pub const Source = effects_module.Source;
pub const Column = struct { access: storage.Access, alignment: u32, bufferArgument: u32, componentType: []const u8, index: u32, sourceComponentType: []const u8, stride: u32, strideArgument: u32 };
pub const Tuple = struct { bufferArgument: u32, columnIndex: u32, componentType: []const u8, mode: storage.Access, sourceBinding: []const u8, tupleIndex: u32 };
pub const Scalar = struct { argument: u32, sourceBinding: []const u8, sourceParameter: u32, type: []const u8 };
pub const ScalarValue = union(enum) { float32: f32, float64: f64 };
pub const Entry = struct { abiType: []const u8, columns: []const Column, entrySymbol: []const u8, logicalFunctionId: []const u8, loop: u32, queryBinding: []const u8, rowCountArgument: u32, scalars: []const Scalar, signatureHash: []const u8, source: Source, sourceFunctionId: []const u8, tupleOccurrences: []const Tuple };
pub const Payload = struct { batch: []const u8, batchHash: []const u8, componentLayouts: []const u8, effects: []const u8, effectsHash: []const u8, entries: []const Entry, functionIdentityDomain: []const u8, inputIdentity: []const u8, layoutHash: []const u8, packageId: []const u8, sourcePacket: []const u8, sourceRequest: []const u8, target: layout.Target };
const Envelope = struct { family: []const u8, payload: []const u8, payloadHash: []const u8, schemaHash: []const u8, version: u32 };
const SourceRequestHeader = struct { family: []const u8, schemaHash: []const u8, version: u32 };
const SourceProfile = struct { version: u32, schema: []const u8, request_domain: []const u8, package_domain: []const u8 };
const source_v5_schema = "sha256:a35185acc806a6095b3e80f6753bbf0cc314f4bde823b75ef5813843159ccce1";
const source_v6_schema = "sha256:32326256ba49bb78f12118d211b520c0f84aa8001422004e8d17dce86d8b814e";
/// Comes from the independent producer cold reader, never from the same untrusted envelope.
/// Fixing identity grants no Store lease, executable address, publication or execution authority.
pub const Expected = struct {
    payloadHash: []const u8,
    inputIdentity: []const u8,
    packageId: []const u8,
    llvmArtifact: ?struct { llvmHash: []const u8, batchHash: []const u8, metadataHash: []const u8 } = null,
};

fn querySelection(allocator: std.mem.Allocator, entry: *const Entry) ![]storage.Selection {
    const selection = try allocator.alloc(storage.Selection, entry.columns.len);
    for (entry.columns, selection) |column, *item|
        item.* = .{ .component = column.componentType, .access = column.access };
    return selection;
}

fn scalarType(value: ScalarValue) []const u8 {
    return switch (value) {
        .float32 => "f32",
        .float64 => "f64",
    };
}

fn checkScalarWidths(formals: []const Scalar, values: []const ScalarValue) Error!void {
    for (formals, values) |formal, actual|
        if (!std.mem.eql(u8, formal.type, scalarType(actual))) return error.BindingMismatch;
}

pub const Document = struct {
    pub const SystemCode = struct { entries: []const Plan.CodeIdentity, llvm_ir: []const u8 };
    arena: std.heap.ArenaAllocator,
    payload: Payload,
    payload_hash: []const u8,
    llvm_hash: ?[71]u8,
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
        const llvm_hash: ?[71]u8 = if (expected.llvmArtifact) |artifact| paired: {
            if (!digestId(artifact.llvmHash) or !std.mem.eql(u8, artifact.batchHash, payload.batchHash) or
                !std.mem.eql(u8, artifact.metadataHash, env.payloadHash)) return error.IdentityMismatch;
            break :paired artifact.llvmHash[0..71].*;
        } else null;
        for ([_][]const u8{ payload.batch, payload.componentLayouts, payload.effects, payload.sourcePacket, payload.sourceRequest }) |text| if (text.len == 0 or text[text.len - 1] != '\n') return error.InvalidMetadata;
        var work: usize = 1000000;
        const source_profile = try verifySourceRequest(own, payload.sourceRequest, payload.inputIdentity, &work);
        try verifySourcePacket(payload.sourcePacket, payload.inputIdentity, payload.packageId, source_profile, &work);
        var component_layout = try layout.Layout.loadCatalog(allocator, payload.componentLayouts, payload.inputIdentity);
        errdefer component_layout.deinit();
        if (payload.entries.len > 4096) return error.MetadataLimit;
        var logical_functions = std.StringHashMap(void).init(allocator);
        defer logical_functions.deinit();
        var source_functions = std.StringHashMap(void).init(allocator);
        defer source_functions.deinit();
        for (payload.entries, 0..) |entry, entry_index| {
            try charge(&work, 1 + entry.columns.len + entry.tupleOccurrences.len + entry.scalars.len);
            if (!digestId(entry.logicalFunctionId) or !digestId(entry.sourceFunctionId) or !digestId(entry.signatureHash) or !digestId(entry.queryBinding) or entry.rowCountArgument != 0 or entry.source.start > entry.source.end or !sourcePath(entry.source.path)) return error.InvalidMetadata;
            const previous = if (entry_index > 0) payload.entries[entry_index - 1] else null;
            if (previous != null and std.mem.eql(u8, previous.?.logicalFunctionId, entry.logicalFunctionId)) {
                const row = previous.?;
                if (entry.loop != row.loop + 1 or !std.mem.eql(u8, row.sourceFunctionId, entry.sourceFunctionId) or !std.mem.eql(u8, row.signatureHash, entry.signatureHash) or !std.mem.eql(u8, row.source.path, entry.source.path) or row.source.end > entry.source.start) return error.InvalidMetadata;
            } else {
                if (entry.loop != 0 or (try logical_functions.getOrPut(entry.logicalFunctionId)).found_existing or
                    (try source_functions.getOrPut(entry.sourceFunctionId)).found_existing) return error.InvalidMetadata;
            }
            if (!std.mem.eql(u8, entry.entrySymbol, try std.fmt.allocPrint(own, "batch_{s}_{d}", .{ entry.logicalFunctionId[7..], entry.loop }))) return error.InvalidMetadata;
            if (entry.columns.len == 0 or entry.columns.len > 4096 or entry.tupleOccurrences.len == 0 or entry.tupleOccurrences.len > 4096 or entry.scalars.len > 4096) return error.MetadataLimit;
            // Each occurrence contributes once to its column's access and has a unique Source binding.
            const column_access = try allocator.alloc(?storage.Access, entry.columns.len);
            defer allocator.free(column_access);
            @memset(column_access, null);
            var source_bindings = std.StringHashMap(void).init(allocator);
            defer source_bindings.deinit();
            try source_bindings.ensureTotalCapacity(@intCast(entry.tupleOccurrences.len));
            for (entry.tupleOccurrences, 0..) |tuple, index| {
                if (tuple.tupleIndex != index or tuple.columnIndex >= entry.columns.len or !digestId(tuple.sourceBinding)) return error.InvalidMetadata;
                const column = entry.columns[tuple.columnIndex];
                if (tuple.bufferArgument != column.bufferArgument or !std.mem.eql(u8, tuple.componentType, column.componentType)) return error.InvalidMetadata;
                if (source_bindings.getOrPutAssumeCapacity(tuple.sourceBinding).found_existing) return error.InvalidMetadata;
                const access = &column_access[tuple.columnIndex];
                if (access.* == null or tuple.mode == .write) access.* = tuple.mode;
            }
            var arguments: std.ArrayList([]const u8) = .empty;
            try arguments.append(own, "index");
            for (entry.columns, 0..) |column, index| {
                if (column.index != index or column.bufferArgument != 1 + 2 * index or column.strideArgument != 2 + 2 * index or column.sourceComponentType.len != 72 or !std.mem.startsWith(u8, column.sourceComponentType, "nominal:")) return error.InvalidMetadata;
                for (column.sourceComponentType[8..]) |byte| if (!(byte >= '0' and byte <= '9') and !(byte >= 'a' and byte <= 'f')) return error.InvalidMetadata;
                if (index > 0 and std.mem.order(u8, entry.columns[index - 1].componentType, column.componentType) != .lt) return error.InvalidMetadata;
                const row = component_layout.find(column.componentType) orelse return error.InvalidMetadata;
                if (row.kind != .component or column.stride != row.stride or column.alignment != row.alignment) return error.InvalidMetadata;
                if (column_access[index] != column.access) return error.InvalidMetadata;
                try arguments.appendSlice(own, &.{ "memref<?xi8>", "index" });
            }
            for (entry.scalars, 0..) |scalar, index| {
                if (scalar.argument != 1 + 2 * entry.columns.len + index or !digestId(scalar.sourceBinding) or (!std.mem.eql(u8, scalar.type, "f32") and !std.mem.eql(u8, scalar.type, "f64")) or (index > 0 and entry.scalars[index - 1].sourceParameter >= scalar.sourceParameter)) return error.InvalidMetadata;
                try arguments.append(own, scalar.type);
            }
            const joined = try std.mem.join(own, ", ", arguments.items);
            if (!std.mem.eql(u8, entry.abiType, try std.fmt.allocPrint(own, "({s}) -> ()", .{joined}))) return error.InvalidMetadata;
        }
        const effects = try effects_module.decode(own, allocator, payload.effects, payload.sourcePacket, payload.inputIdentity, payload.packageId, payload.target, &component_layout);
        var expected_entries: usize = 0;
        for (effects.report.systems) |system| expected_entries += system.loops.len;
        if (expected_entries != payload.entries.len) return error.InvalidEffects;
        var entry_index: usize = 0;
        try charge(&work, effects.source_system_order.len);
        for (effects.source_system_order) |system_index| {
            const system = &effects.report.systems[system_index];
            const parameters = effects.source_parameters[system_index];
            for (system.loops, 0..) |*loop, loop_index| {
                try charge(&work, 1 + parameters.len);
                const entry = &payload.entries[entry_index];
                entry_index += 1;
                if (entry.loop != loop_index or !std.mem.eql(u8, system.functionId, entry.logicalFunctionId) or !std.mem.eql(u8, system.sourceFunctionId, entry.sourceFunctionId) or !std.mem.eql(u8, system.signatureHash, entry.signatureHash)) return error.InvalidEffects;
                // Ordinary Source parameters retain their original positions, skipping Queries.
                var scalar_index: usize = 0;
                for (parameters, 0..) |parameter, source_index| {
                    if (parameter.query != null) continue;
                    if (scalar_index == entry.scalars.len) return error.InvalidMetadata;
                    const scalar = entry.scalars[scalar_index];
                    if (scalar.sourceParameter != source_index or !std.mem.eql(u8, scalar.sourceBinding, parameter.binding.id) or !std.mem.eql(u8, scalar.type, parameter.logicalType)) return error.InvalidMetadata;
                    scalar_index += 1;
                }
                if (scalar_index != entry.scalars.len) return error.InvalidMetadata;
                if (!effects_module.sameSource(loop.source, entry.source) or !std.mem.eql(u8, loop.queryBinding, entry.queryBinding) or loop.capabilities.len != entry.columns.len or loop.columns.len != entry.tupleOccurrences.len) return error.InvalidEffects;
                for (loop.capabilities, entry.columns) |capability, column| if (!std.mem.eql(u8, capability.componentType, column.componentType) or !std.mem.eql(u8, capability.sourceComponentType, column.sourceComponentType) or capability.mode != column.access) return error.InvalidEffects;
                for (loop.columns, entry.tupleOccurrences) |column, tuple| if (column.tupleIndex != tuple.tupleIndex or !std.mem.eql(u8, column.sourceBinding, tuple.sourceBinding) or !std.mem.eql(u8, column.componentType, tuple.componentType) or column.mode != tuple.mode) return error.InvalidEffects;
            }
        }
        // Both metadata and typed effects allocations finish before this final arena transfer.
        return .{ .arena = arena, .payload = payload, .payload_hash = env.payloadHash, .llvm_hash = llvm_hash, .component_layout = component_layout, .effects = effects };
    }
    pub fn deinit(self: *Document) void {
        self.component_layout.deinit();
        self.arena.deinit();
        self.* = undefined;
    }

    /// Admit the requested parallel group as a whole, before opening any Store
    /// query. Invalid identities are rejected in request order. For a conflict,
    /// choose the earliest requested pair, then its first canonical component.
    pub fn admitParallelGroup(self: *const Document, allocator: std.mem.Allocator, system_ids: []const []const u8) !ParallelAdmission {
        if (system_ids.len == 0 or system_ids.len > self.effects.report.systems.len) return error.InvalidGroup;
        var ranks = std.StringHashMap(usize).init(allocator);
        defer ranks.deinit();
        try ranks.ensureTotalCapacity(@intCast(system_ids.len));
        for (system_ids, 0..) |id, rank| {
            const system = self.effects.system(id) orelse return error.UnknownSystem;
            const slot = ranks.getOrPutAssumeCapacity(system.functionId);
            if (slot.found_existing) return error.DuplicateSystem;
            slot.value_ptr.* = rank;
        }
        var first = [2]usize{ system_ids.len, system_ids.len };
        var refusal: ?ParallelAdmission = null;
        for (self.effects.report.conflicts) |edge| {
            const left = ranks.get(edge.left) orelse continue;
            const right = ranks.get(edge.right) orelse continue;
            const earlier = @min(left, right);
            const later = @max(left, right);
            if (earlier > first[0] or (earlier == first[0] and later >= first[1])) continue;
            first = .{ earlier, later };
            refusal = .{ .conflict = .{
                .left = if (left < right) edge.left else edge.right,
                .right = if (left < right) edge.right else edge.left,
                .component = edge.components[0],
            } };
        }
        if (refusal) |result| return result;

        const selected = try allocator.alloc(ParallelGroup.System, system_ids.len);
        var start: usize = 0;
        for (self.effects.source_system_order) |index| {
            const system = self.effects.report.systems[index];
            const end = start + system.loops.len;
            if (ranks.get(system.functionId)) |rank|
                selected[rank] = .{ .function_id = system.functionId, .entries = self.payload.entries[start..end], .first_entry = start };
            start = end;
        }
        return .{ .admitted = .{ .allocator = allocator, .document = self, .systems = selected } };
    }

    /// Hand off every loop of one checked Source system in its original order.
    /// Check the whole code receipt before the first lease. With no code
    /// receipt this entry only hands off metadata and data for inspection.
    /// Each callback receives the selected entry even if it has zero batches.
    /// Return or error releases the current loop before proceeding or stopping.
    pub fn withSystemPlans(self: *const Document, allocator: std.mem.Allocator, store: *storage.Store, function_id: []const u8, scalars: []const ScalarValue, code: ?SystemCode, arguments: anytype, comptime call: anytype) !void {
        const admission = try self.admitParallelGroup(allocator, &.{function_id});
        var group = admission.admitted; // A one-system selection has no conflict pair.
        defer group.deinit();
        const system = group.systems[0];
        // Source parameter positions also exist for systems with no loops.
        const parameters = self.effects.source_parameters[self.effects.systemIndex(system.function_id).?];
        var scalar_index: usize = 0;
        for (parameters) |formal| {
            if (formal.query != null) continue;
            if (scalar_index == scalars.len or !std.mem.eql(u8, formal.logicalType, scalarType(scalars[scalar_index])))
                return error.BindingMismatch;
            scalar_index += 1;
        }
        if (scalar_index != scalars.len) return error.BindingMismatch;
        if (code) |checked| {
            if (checked.entries.len != system.entries.len) return error.BindingMismatch;
            const llvm_hash = self.llvm_hash orelse return error.IdentityMismatch;
            try Plan.checkLlvmArtifact(llvm_hash, checked.llvm_ir);
            for (system.entries, checked.entries) |*entry, identity| try self.checkEntryCode(entry, identity);
        }
        if (system.entries.len == 0) return;
        _ = try self.entryForStore(store, system.first_entry);
        const snapshot = try allocator.dupe(ScalarValue, scalars);
        defer allocator.free(snapshot);
        for (system.entries, 0..) |*entry, index| {
            try group.withPlans(allocator, store, &.{.{ .loop = index, .scalars = snapshot }}, .{entry} ++ arguments, call);
        }
    }

    fn checkEntryCode(self: *const Document, entry: *const Entry, candidate: Plan.CodeIdentity) Error!void {
        return candidate.verify(.{
            .metadata_hash = self.payload_hash,
            .batch_hash = self.payload.batchHash,
            .entry_symbol = entry.entrySymbol,
            .logical_function_id = entry.logicalFunctionId,
            .signature_hash = entry.signatureHash,
            .abi_type = entry.abiType,
        });
    }

    fn entryForStore(self: *const Document, store: *const storage.Store, entry_index: usize) Error!*const Entry {
        if (!std.mem.eql(u8, &store.layout_identity, &self.component_layout.payload_hash)) return error.IdentityMismatch;
        if (entry_index >= self.payload.entries.len) return error.BindingMismatch;
        return &self.payload.entries[entry_index];
    }

    /// Opens the Store's complete borrow session for the checked entry columns.
    pub fn query(self: *const Document, allocator: std.mem.Allocator, store: *storage.Store, entry_index: usize) !storage.Store.Query {
        const entry = try self.entryForStore(store, entry_index);
        const selection = try querySelection(allocator, entry);
        defer allocator.free(selection);
        return store.query(selection);
    }

    pub fn bind(self: *const Document, allocator: std.mem.Allocator, store: *storage.Store, batch: storage.Store.Batch, entry_index: usize, scalars: []const ScalarValue) !Plan {
        if (batch.store != store) return error.WrongStore;
        const entry = try self.entryForStore(store, entry_index);
        const rows = try checkBatch(entry, batch, scalars);
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        var result = try self.makePlan(arena.allocator(), batch, rows, entry_index, scalars, true);
        // Transfer the final allocator state after all owned allocations.
        result.arena = arena;
        return result;
    }

    fn checkBatch(entry: *const Entry, batch: storage.Store.Batch, scalars: []const ScalarValue) !usize {
        if (scalars.len != entry.scalars.len or try batch.columnCount() != entry.columns.len) return error.BindingMismatch;
        try checkScalarWidths(entry.scalars, scalars);
        const rows = try batch.rowCount();
        if (rows > 65536) return error.BindingMismatch;
        for (entry.columns, 0..) |column, index| {
            const actual = try batch.column(index);
            if (!std.mem.eql(u8, actual.component, column.componentType) or actual.stride != column.stride or actual.access != column.access) return error.BindingMismatch;
            const bytes = try batch.read(index);
            if (bytes.len != try std.math.mul(usize, rows, column.stride) or @intFromPtr(bytes.ptr) % column.alignment != 0) return error.BindingMismatch;
        }
        return rows;
    }

    fn makePlan(self: *const Document, allocator: std.mem.Allocator, batch: storage.Store.Batch, rows: usize, entry_index: usize, scalars: []const ScalarValue, comptime owning: bool) !Plan {
        const entry = &self.payload.entries[entry_index];
        const tuples = try allocator.alloc(Plan.TupleBinding, entry.tupleOccurrences.len);
        for (entry.tupleOccurrences, tuples) |tuple, *binding| binding.* = .{ .column = tuple.columnIndex, .access = tuple.mode };
        const columns = try allocator.alloc(Plan.ColumnBinding, entry.columns.len);
        for (entry.columns, columns) |column, *binding| binding.* = .{
            .component = if (owning) try allocator.dupe(u8, column.componentType) else column.componentType,
            .stride = column.stride,
            .access = column.access,
        };
        const scoped: Plan = .{
            .arena = null,
            .batch = batch,
            .rows = rows,
            .columns = columns,
            .tuples = tuples,
            .scalars = try allocator.dupe(ScalarValue, scalars),
            .entry_symbol = entry.entrySymbol,
            .logical_function_id = entry.logicalFunctionId,
            .source_function_id = entry.sourceFunctionId,
            .signature_hash = entry.signatureHash,
            .entry_index = entry_index,
            .loop = entry.loop,
            .source = entry.source,
            .query_binding = entry.queryBinding,
            .metadata_hash = self.payload_hash,
            .batch_hash = self.payload.batchHash,
            .llvm_hash = self.llvm_hash,
            .abi_type = entry.abiType,
            .input_identity = self.payload.inputIdentity,
            .package_id = self.payload.packageId,
            .effects = self.payload.effects,
            .effects_hash = self.payload.effectsHash,
            .loop_effects = self.effects.system(entry.logicalFunctionId).?.loops[entry.loop],
        };
        if (!owning) return scoped;
        var result = scoped;
        inline for (.{ "entry_symbol", "logical_function_id", "source_function_id", "signature_hash",
            "query_binding", "metadata_hash", "batch_hash", "abi_type", "input_identity", "package_id", "effects", "effects_hash" }) |field|
            @field(result, field) = try allocator.dupe(u8, @field(scoped, field));
        result.source.path = try allocator.dupe(u8, scoped.source.path);
        result.loop_effects = try ownEffectValue(allocator, scoped.loop_effects);
        return result;
    }
};

/// Systems follow the request order; a system's entries retain its original
/// sequential loop order. The Document must outlive the group and its views.
/// Admission owns only this selection. Store queries keep their normal owner
/// and lifetime, and binding still uses the original Document.
pub const ParallelGroup = struct {
    pub const System = struct { function_id: []const u8, entries: []const Entry, first_entry: usize };
    pub const BatchBinding = struct { loop: usize, batch: storage.Store.Batch, scalars: []const ScalarValue };
    pub const LoopBinding = struct { loop: usize, scalars: []const ScalarValue };
    const StageCode = struct { entries: []const ?Plan.CodeIdentity, llvm_ir: []const u8 };
    allocator: std.mem.Allocator,
    document: *const Document,
    systems: []const System,

    pub fn deinit(self: *ParallelGroup) void {
        self.allocator.free(self.systems);
        self.* = undefined;
    }

    fn entryIndex(self: *const ParallelGroup, system_index: usize, loop_index: usize) Error!usize {
        if (system_index >= self.systems.len) return error.BindingMismatch;
        const system = self.systems[system_index];
        if (loop_index >= system.entries.len) return error.BindingMismatch;
        return system.first_entry + loop_index;
    }

    pub fn query(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, system_index: usize, loop_index: usize) !storage.Store.Query {
        return self.document.query(allocator, store, try self.entryIndex(system_index, loop_index));
    }

    /// Acquire one selected loop per participating system in request order.
    /// Pass null for systems without a loop in this stage and for each vacant
    /// output slot. Success transfers the usual independently released Query
    /// handles; failure keeps all output slots and existing Store leases intact.
    pub fn acquire(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, loops: []const ?usize, output: []?storage.Store.Query) !void {
        if (loops.len != self.systems.len or output.len != self.systems.len) return error.BindingMismatch;
        for (output) |slot| if (slot != null) return error.InvalidLease;
        for (loops) |loop| {
            if (loop != null) break;
        } else return;
        var temporary = std.heap.ArenaAllocator.init(allocator);
        defer temporary.deinit();
        const scratch = temporary.allocator();
        const selections = try scratch.alloc(?[]const storage.Selection, loops.len);
        for (loops, selections, 0..) |loop, *selection, index| {
            selection.* = if (loop) |ordinal| try querySelection(scratch,
                try self.document.entryForStore(store, try self.entryIndex(index, ordinal))) else null;
        }
        return store.queryGroup(selections, output);
    }

    pub fn bind(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, batch: storage.Store.Batch, system_index: usize, loop_index: usize, scalars: []const ScalarValue) !Plan {
        return self.document.bind(allocator, store, batch, try self.entryIndex(system_index, loop_index), scalars);
    }

    /// Prepare the participating batches in admitted-system order. The caller
    /// retains the live query leases and provides one vacant slot per system.
    /// Only a complete result transfers Plans to those slots for later use.
    pub fn bindBatches(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, bindings: []const ?BatchBinding, output: []?Plan) !void {
        if (bindings.len != self.systems.len or output.len != self.systems.len) return error.BindingMismatch;
        for (output) |slot| if (slot != null) return error.BindingMismatch;
        for (bindings) |binding| {
            if (binding != null) break;
        } else return;

        const staged = try allocator.alloc(?Plan, bindings.len);
        defer allocator.free(staged);
        @memset(staged, null);
        errdefer for (staged) |*slot| if (slot.*) |*plan| plan.deinit();
        for (bindings, staged, 0..) |binding, *slot, index| {
            if (binding) |value| slot.* = try self.bind(allocator, store, value.batch, index, value.loop, value.scalars);
        }
        @memcpy(output, staged);
    }

    /// Borrow every batch for one selected loop per participating system.
    /// The callback receives Plans in system order, then Store batch order.
    /// All batches stay pinned through the synchronous callback. The callback
    /// must not retain Plans, query aliases or borrowed column views.
    pub fn withPlans(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, bindings: []const ?LoopBinding, arguments: anytype, comptime call: anytype) !void {
        return self.withStage(allocator, store, bindings, null, arguments, call);
    }

    /// Check the paired LLVM and each selected loop's independent code identity
    /// before acquiring Store leases, including for loops with no batches.
    /// Code entries follow bindings in system order and share their null slots.
    pub fn withCheckedPlans(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, bindings: []const ?LoopBinding, code: []const ?Plan.CodeIdentity, llvm_ir: []const u8, arguments: anytype, comptime call: anytype) !void {
        return self.withStage(allocator, store, bindings, .{ .entries = code, .llvm_ir = llvm_ir }, arguments, call);
    }

    fn withStage(self: *const ParallelGroup, allocator: std.mem.Allocator, store: *storage.Store, bindings: []const ?LoopBinding, code: ?StageCode, arguments: anytype, comptime call: anytype) !void {
        if (bindings.len != self.systems.len) return error.BindingMismatch;
        if (code) |checked| if (checked.entries.len != bindings.len) return error.BindingMismatch;
        var temporary = std.heap.ArenaAllocator.init(allocator);
        defer temporary.deinit();
        const scratch = temporary.allocator();
        const loops = try scratch.alloc(?usize, bindings.len);
        for (bindings, loops, 0..) |binding, *loop, index| {
            loop.* = null;
            if (binding) |selected| {
                const entry_index = try self.entryIndex(index, selected.loop);
                const entry = &self.document.payload.entries[entry_index];
                const formals = entry.scalars;
                if (selected.scalars.len != formals.len) return error.BindingMismatch;
                try checkScalarWidths(formals, selected.scalars);
                if (code) |checked| {
                    const candidate = checked.entries[index] orelse return error.BindingMismatch;
                    try self.document.checkEntryCode(entry, candidate);
                }
                loop.* = selected.loop;
            } else if (code) |checked| {
                if (checked.entries[index] != null) return error.BindingMismatch;
            }
        }
        if (code) |checked| {
            const llvm_hash = self.document.llvm_hash orelse return error.IdentityMismatch;
            try Plan.checkLlvmArtifact(llvm_hash, checked.llvm_ir);
        }
        const queries = try scratch.alloc(?storage.Store.Query, bindings.len);
        @memset(queries, null);
        try self.acquire(allocator, store, loops, queries);
        defer for (queries) |maybe_lease| if (maybe_lease) |lease| lease.release() catch unreachable;

        var count: usize = 0;
        for (queries) |maybe_lease| if (maybe_lease) |lease| {
            count += try lease.batchCount();
        };
        const plans = try scratch.alloc(Plan, count);
        const batches = try scratch.alloc(storage.Store.Batch, count);
        var bound: usize = 0;
        for (bindings, queries, 0..) |binding, maybe_lease, index| {
            if (maybe_lease) |lease| {
                const selected = binding.?;
                const entry_index = try self.entryIndex(index, selected.loop);
                const entry = &self.document.payload.entries[entry_index];
                const first = bound;
                // One immutable plan view and scalar snapshot per selected
                // loop. Each batch still supplies its own validated row count.
                for (0..try lease.batchCount()) |batch_index| {
                    const batch = try lease.batch(batch_index);
                    const rows = try Document.checkBatch(entry, batch, selected.scalars);
                    if (bound == first) {
                        plans[bound] = try self.document.makePlan(scratch, batch, rows, entry_index, selected.scalars, false);
                    } else {
                        plans[bound] = plans[first];
                        plans[bound].batch = batch;
                        plans[bound].rows = rows;
                    }
                    batches[bound] = batch;
                    bound += 1;
                }
            }
        }
        return store.withActiveCalls(batches, .{@as([]const Plan, plans)} ++ arguments, call);
    }
};

/// The Store must outlive this plan, exactly as it must outlive its Query/Batch.
/// Standalone binding owns metadata and scalars. A synchronous stage borrows
/// immutable metadata from its Document and shares stage-local scalar copies.
/// Original component columns stay borrowed in both cases.
pub const Plan = struct {
    const TupleBinding = struct { column: usize, access: storage.Access };
    const ColumnBinding = struct { component: []const u8, stride: usize, access: storage.Access };
    pub const Argument = union(enum) { row_count: usize, column: ColumnBinding, stride: usize, scalar: ScalarValue };
    pub const LLVMArgument = union(enum) {
        index: u64,
        read_pointer: [*]const u8,
        write_pointer: [*]u8,
        float32: f32,
        float64: f64,
    };
    pub const CodeIdentity = struct {
        metadata_hash: []const u8,
        batch_hash: []const u8,
        entry_symbol: []const u8,
        logical_function_id: []const u8,
        signature_hash: []const u8,
        abi_type: []const u8,

        fn verify(self: CodeIdentity, expected: anytype) Error!void {
            inline for (std.meta.fields(CodeIdentity)) |field| {
                if (!std.mem.eql(u8, @field(expected, field.name), @field(self, field.name))) return error.IdentityMismatch;
            }
        }
    };
    pub const CheckedCall = struct { plan: *const Plan, code: CodeIdentity };
    arena: ?std.heap.ArenaAllocator,
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
    batch_hash: []const u8,
    llvm_hash: ?[71]u8,
    abi_type: []const u8,
    input_identity: []const u8,
    package_id: []const u8,
    effects: []const u8,
    effects_hash: []const u8,
    loop_effects: effects_module.Loop,

    pub fn deinit(self: *Plan) void {
        if (self.arena) |*arena| arena.deinit();
        self.* = undefined;
    }
    /// Compare checked entry and batch identities supplied by a code owner.
    /// The code owner's executable lease and the Store borrow remain separate.
    pub fn verifyCodeIdentity(self: *const Plan, candidate: CodeIdentity) Error!void {
        return candidate.verify(self);
    }
    /// Keep this plan and the code version alive through the synchronous call.
    /// The callback must not retain argument or column views after returning.
    pub fn withCheckedBatch(self: *const Plan, candidate: CodeIdentity, llvm_ir: []const u8, context: anytype, comptime call: anytype) !void {
        try self.verifyCodeIdentity(candidate);
        const llvm_hash = self.llvm_hash orelse return error.IdentityMismatch;
        try checkLlvmArtifact(llvm_hash, llvm_ir);
        return self.batch.withActiveCall(.{ self, context }, call);
    }
    /// Pin the ordered group from one Store and one paired artifact for a
    /// synchronous call. The caller keeps the requests, Plans and code version
    /// alive and unchanged, and releases all borrowed views on return.
    pub fn withCheckedBatches(allocator: std.mem.Allocator, requests: []const CheckedCall, llvm_ir: []const u8, context: anytype, comptime call: anytype) !void {
        if (requests.len == 0) return error.BindingMismatch;
        const first = requests[0].plan;
        const llvm_hash = first.llvm_hash orelse return error.IdentityMismatch;
        const batches = try allocator.alloc(storage.Store.Batch, requests.len);
        defer allocator.free(batches);
        for (requests, batches) |request, *batch| {
            try request.plan.verifyCodeIdentity(request.code);
            const paired = request.plan.llvm_hash orelse return error.IdentityMismatch;
            if (!std.mem.eql(u8, &paired, &llvm_hash) or
                !std.mem.eql(u8, request.plan.metadata_hash, first.metadata_hash) or
                !std.mem.eql(u8, request.plan.batch_hash, first.batch_hash)) return error.IdentityMismatch;
            batch.* = request.plan.batch;
        }
        try checkLlvmArtifact(llvm_hash, llvm_ir);
        return first.batch.store.withActiveCalls(batches, .{ requests, context }, call);
    }
    fn checkLlvmArtifact(llvm_hash: [71]u8, llvm_ir: []const u8) Error!void {
        if (llvm_ir.len > 8 * 1024 * 1024) return error.MetadataLimit;
        if (llvm_ir.len == 0 or !std.mem.eql(u8, &digest("", llvm_ir), &llvm_hash)) return error.IdentityMismatch;
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
    /// Flatten the checked batch's arguments in the emitted LLVM entry order.
    /// Calls use the column pointers inside the checked single, group or stage callback.
    pub fn llvmArgument(self: *const Plan, index: usize) !LLVMArgument {
        _ = try self.batch.rowCount();
        if (index == 0) return .{ .index = self.rows };
        // A one-dimensional byte memref expands to two pointers, offset,
        // byte length and unit stride. The row stride follows the memref.
        const column_arguments = self.columns.len * 6;
        const position = index - 1;
        if (position >= column_arguments) {
            const scalar = position - column_arguments;
            if (scalar >= self.scalars.len) return error.BindingMismatch;
            return switch (self.scalars[scalar]) {
                .float32 => |value| .{ .float32 = value },
                .float64 => |value| .{ .float64 = value },
            };
        }
        const column_index = position / 6;
        const column = self.columns[column_index];
        return switch (position % 6) {
            0, 1 => switch (column.access) {
                .read => .{ .read_pointer = (try self.batch.read(column_index)).ptr },
                .write => .{ .write_pointer = (try self.batch.write(column_index)).ptr },
            },
            2 => .{ .index = 0 },
            3 => .{ .index = (try self.batch.read(column_index)).len },
            4 => .{ .index = 1 },
            5 => .{ .index = column.stride },
            else => unreachable,
        };
    }
    pub fn readTuple(self: *const Plan, index: usize) ![]const u8 {
        const tuple = try self.tupleBinding(index);
        return self.batch.read(tuple.column);
    }
    pub fn writeTuple(self: *const Plan, index: usize) ![]u8 {
        const tuple = try self.tupleBinding(index);
        if (tuple.access != .write) {
            _ = try self.batch.rowCount();
            return error.ReadOnly;
        }
        return self.batch.write(tuple.column);
    }
    fn tupleBinding(self: *const Plan, index: usize) !TupleBinding {
        if (index < self.tuples.len) return self.tuples[index];
        _ = try self.batch.rowCount();
        return error.BindingMismatch;
    }
};
// The checked Loop's value tree contains immutable slices, records and scalar values.
fn ownEffectValue(allocator: std.mem.Allocator, value: anytype) std.mem.Allocator.Error!@TypeOf(value) {
    const Value = @TypeOf(value);
    switch (@typeInfo(Value)) {
        .@"struct" => {
            var result: Value = undefined;
            inline for (std.meta.fields(Value)) |field|
                @field(result, field.name) = try ownEffectValue(allocator, @field(value, field.name));
            return result;
        },
        .pointer => |pointer| {
            if (pointer.size != .slice) @compileError("Query loop metadata must own a slice");
            if (pointer.child == u8) return allocator.dupe(u8, value);
            const items = try allocator.alloc(pointer.child, value.len);
            for (items, value) |*item, original| item.* = try ownEffectValue(allocator, original);
            return items;
        },
        .int, .@"enum" => return value,
        else => @compileError("unsupported checked Query loop metadata field"),
    }
}
fn charge(remaining: *usize, count: usize) Error!void {
    if (count > remaining.*) return error.MetadataLimit;
    remaining.* -= count;
}
fn verifySourceRequest(allocator: std.mem.Allocator, bytes: []const u8, identity: []const u8, work: *usize) !SourceProfile {
    // Prepay the depth scan, header parse and request hash.
    try charge(work, 3 * (bytes.len / 64 + 1));
    try jsonBudget(bytes);
    const header = std.json.parseFromSliceLeaky(SourceRequestHeader, allocator, bytes, .{ .ignore_unknown_fields = true, .max_value_len = 8388608 }) catch |err| return if (err == error.OutOfMemory) err else error.InvalidMetadata;
    if (!std.mem.eql(u8, header.family, "tsfg.system-query-facts-request-candidate")) return error.InvalidMetadata;
    const profile: SourceProfile = switch (header.version) {
        5 => .{ .version = 5, .schema = source_v5_schema, .request_domain = "tsfg.system-query.request.v5\x00", .package_domain = "tsfg.system-query.package.v5\x00" ++ source_v5_schema ++ "\x00" },
        6 => .{ .version = 6, .schema = source_v6_schema, .request_domain = "tsfg.system-query.request.v6\x00", .package_domain = "tsfg.system-query.package.v6\x00" ++ source_v6_schema ++ "\x00" },
        else => return error.InvalidMetadata,
    };
    if (!std.mem.eql(u8, header.schemaHash, profile.schema) or !std.mem.eql(u8, &digest(profile.request_domain, bytes), identity)) return error.IdentityMismatch;
    return profile;
}
fn verifySourcePacket(packet: []const u8, input_identity: []const u8, package_id: []const u8, profile: SourceProfile, work: *usize) Error!void {
    // Prepay the envelope formatting and comparisons, domain hash and digest check.
    try charge(work, 18 + packet.len / 64 + 1);
    // Expected IDs have already been checked as fixed digests. The canonical
    // envelope delimits the original payload bytes without copying its body.
    var prefix_buffer: [192]u8 = undefined;
    var suffix_buffer: [192]u8 = undefined;
    const prefix = std.fmt.bufPrint(&prefix_buffer, "{{\"family\":\"tsfg.system-query-facts-package-candidate\",\"packageId\":\"{s}\",\"payload\":", .{package_id}) catch unreachable;
    const suffix = std.fmt.bufPrint(&suffix_buffer, ",\"requestId\":\"{s}\",\"schemaHash\":\"{s}\",\"version\":{d}}}\n", .{ input_identity, profile.schema, profile.version }) catch unreachable;
    if (packet.len <= prefix.len + suffix.len or !std.mem.startsWith(u8, packet, prefix) or !std.mem.endsWith(u8, packet, suffix)) return error.IdentityMismatch;
    const source_payload = packet[prefix.len .. packet.len - suffix.len];
    if (source_payload[0] != '{' or source_payload[source_payload.len - 1] != '}') return error.InvalidMetadata;
    if (!std.mem.eql(u8, &digest(profile.package_domain, source_payload), package_id)) return error.IdentityMismatch;
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
