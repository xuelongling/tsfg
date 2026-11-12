// SPDX-License-Identifier: MIT
//! Read-only consumption of the existing v3 component-level effects protocol.
const std = @import("std");
const layout = @import("layout.zig");
const Access = @import("store.zig").Access;
const Sha256 = std.crypto.hash.sha2.Sha256;
const Identity = [71]u8;
const max_helper_depth = 32;
const max_helper_parameters = 32;
const max_expression_depth = 32;
const scalar_types = std.StaticStringMap(void).initComptime(.{
    .{ "i8", {} },    .{ "i16", {} },   .{ "i32", {} },  .{ "i64", {} },
    .{ "u8", {} },    .{ "u16", {} },   .{ "u32", {} },  .{ "u64", {} },
    .{ "isize", {} }, .{ "usize", {} }, .{ "bool", {} }, .{ "f32", {} },
    .{ "f64", {} },
});
pub const Error = error{ InvalidEffects, EffectsLimit, UnknownSystem, InvalidPair };
const SourceCheckError = Error || std.mem.Allocator.Error;
pub const Source = struct { end: u32, path: []const u8, start: u32 };
pub const Capability = struct { componentType: []const u8, mode: Access, sourceComponentType: []const u8 };
pub const FieldEffects = struct { componentType: []const u8, field: []const u8, readCount: u32, sourceField: []const u8, writeCount: u32 };
pub const Call = struct { calleeSource: Source, functionId: []const u8, signatureHash: []const u8, source: Source, sourceHelperId: []const u8 };
pub const Column = struct { componentType: []const u8, mode: Access, source: Source, sourceBinding: []const u8, sourceComponentType: []const u8, tupleIndex: u32 };
pub const Operation = struct { callPath: []const Call, componentType: []const u8, field: []const u8, kind: Access, source: Source, sourceBinding: []const u8, sourceField: []const u8, tupleIndex: u32 };
pub const Loop = struct { calls: []const Call, capabilities: []const Capability, columns: []const Column, fieldEffects: []const FieldEffects, index: u32, operations: []const Operation, queryBinding: []const u8, selectionId: []const u8, source: Source };
pub const System = struct { calls: []const Call, capabilities: []const Capability, fieldEffects: []const FieldEffects, functionId: []const u8, loops: []const Loop, signatureHash: []const u8, source: Source, sourceFunctionId: []const u8 };
pub const Helper = struct { calls: []const Call, directCallees: []const []const u8, fieldEffects: []const FieldEffects, functionId: []const u8, signatureHash: []const u8, source: Source, sourceFunctionId: []const u8, sourceHelperId: []const u8, transitiveCallees: []const []const u8 };
pub const Conflict = struct { components: []const []const u8, left: []const u8, right: []const u8 };
pub const SourceFile = struct { path: []const u8, sha256: []const u8, utf16Length: u32 };
pub const Report = struct { conflicts: []const Conflict, coreVersion: []const u8, family: []const u8, inputIdentity: []const u8, packageId: []const u8, queryVersion: u32, scalarHelpers: []const Helper, source: SourceFile, systems: []const System, target: layout.Target, version: u32 };

// Project the Source declaration, type and call-anchor facts. Document owns the full packet.
const Decl = struct { id: []const u8, name: []const u8 = "", range: layout.Range, sourcePath: []const u8 };
const RawField = struct { id: []const u8, name: []const u8, origin: struct { end: u32, source: []const u8, start: u32 }, readonly: bool, type: []const u8 };
const RawType = struct { id: []const u8, name: ?[]const u8 = null, sourcePath: ?[]const u8 = null, declarationRange: ?layout.Range = null, nominalKey: ?struct { category: []const u8 } = null, fields: []const RawField = &.{} };
const RawItem = struct { componentType: []const u8, mode: Access };
pub const SourceParameter = struct { binding: struct { id: []const u8 }, logicalType: []const u8, query: ?struct { items: []const RawItem } };
const RawBinding = struct { componentType: []const u8, declaration: Decl, index: u32, mode: Access };
const RawExpression = struct {
    kind: enum { binary, bindingAssignment, bindingReference, bindingTarget, call, fieldAccess, fieldAssignment, fieldTarget, numericLiteral, parentheses },
    arguments: []const RawExpression = &.{},
    binding: []const u8 = "",
    callee: []const u8 = "",
    calleeRange: ?layout.Range = null,
    expression: ?*const RawExpression = null,
    left: ?*const RawExpression = null,
    operator: []const u8 = "",
    property: []const u8 = "",
    range: layout.Range,
    receiver: ?*const struct { binding: []const u8 } = null,
    right: ?*const RawExpression = null,
    target: ?*const RawExpression = null,
    value: ?*const RawExpression = null,
};
const RawStatement = struct { initializer: ?*const RawExpression = null, value: ?*const RawExpression = null };
const SourceView = struct { binding: []const u8, column: *const Column, mode: Access };
const SourceOperations = struct {
    remaining: []const Operation,
    columns: []const Column,
    views: []const SourceView = &.{},
    path: [max_helper_depth]*const Call = undefined,
    depth: usize = 0,
};
const SourceBodyRows = struct { calls: []const Call, operations: ?*SourceOperations = null };
const RawLoop = struct { bindings: []const RawBinding, queryBinding: []const u8, range: layout.Range, statements: []const RawStatement };
const RawSystem = struct { declaration: Decl, loops: []const RawLoop, parameters: []const SourceParameter, returnType: []const u8 };
const RawHelperParameter = struct {
    binding: struct { id: []const u8 },
    index: u32,
    logicalType: []const u8,
    query: ?struct {},
    view: ?struct { access: struct { componentType: []const u8, index: u32, mode: Access } },
};
const RawHelper = struct {
    declaration: Decl,
    id: []const u8,
    parameters: []const RawHelperParameter,
    returnType: []const u8,
    statements: []const RawStatement = &.{},
    value: ?*const RawExpression = null,
};
const Projection = struct { payload: struct { program: struct { files: []const SourceFile, rootFile: []const u8 }, scalarHelpers: []const RawHelper, systems: []const RawSystem, types: []const RawType } };

pub const Analysis = struct {
    report: Report,
    source_parameters: []const []const SourceParameter,
    source_system_order: []const usize,

    pub fn systemIndex(self: *const Analysis, id: []const u8) ?usize {
        for (self.report.systems, 0..) |row, index| if (same(row.functionId, id)) return index;
        return null;
    }
    pub fn system(self: *const Analysis, id: []const u8) ?*const System {
        return &self.report.systems[self.systemIndex(id) orelse return null];
    }
    /// Only distinct known systems are a protocol pair; this does not choose scheduling.
    pub fn conflictComponents(self: *const Analysis, left: []const u8, right: []const u8) Error![]const []const u8 {
        if (self.system(left) == null or self.system(right) == null) return error.UnknownSystem;
        if (same(left, right)) return error.InvalidPair;
        for (self.report.conflicts) |row| if ((same(row.left, left) and same(row.right, right)) or (same(row.left, right) and same(row.right, left))) return row.components;
        return &.{};
    }
};

/// Allocations belong to the metadata owner's arena. No local allocator/context escapes.
pub fn decode(allocator: std.mem.Allocator, bytes: []const u8, packet: []const u8, input_identity: []const u8, package_id: []const u8, target: layout.Target, catalog: *const layout.Layout) !Analysis {
    if (bytes.len == 0 or bytes.len > 8388608 or bytes[bytes.len - 1] != '\n') return error.InvalidEffects;
    try jsonBudget(bytes);
    const parsed = std.json.parseFromSlice(Report, allocator, bytes, .{ .allocate = .alloc_always, .max_value_len = 8388608 }) catch |err| return if (err == error.OutOfMemory) err else error.InvalidEffects;
    const report = parsed.value;
    if (!same(try std.json.Stringify.valueAlloc(allocator, report, .{}), bytes[0 .. bytes.len - 1]) or report.version != 3 or report.queryVersion != 3 or !same(report.coreVersion, "0.12.0") or !same(report.family, "tsfg.system-query-effects-candidate") or !same(report.inputIdentity, input_identity) or !same(report.packageId, package_id)) return error.InvalidEffects;
    inline for (std.meta.fields(layout.Target)) |field| if (!same(@field(report.target, field.name), @field(target, field.name))) return error.InvalidEffects;
    if (packet.len > 8388608) return error.EffectsLimit;
    try jsonBudget(packet);
    const projected = std.json.parseFromSlice(Projection, allocator, packet, .{ .allocate = .alloc_always, .max_value_len = 8388608, .ignore_unknown_fields = true }) catch |err| return if (err == error.OutOfMemory) err else error.InvalidEffects;
    var context: Context = .{ .allocator = allocator, .report = &report, .facts = projected.value, .catalog = catalog };
    if (report.systems.len != context.facts.payload.systems.len or report.scalarHelpers.len != context.facts.payload.scalarHelpers.len or report.systems.len > 4096 or report.scalarHelpers.len > 64) return error.InvalidEffects;
    var primary: ?SourceFile = null;
    for (context.facts.payload.program.files) |file| if (same(file.path, context.facts.payload.program.rootFile)) {
        primary = file;
    };
    const original_file = primary orelse return error.InvalidEffects;
    if (!same(report.source.path, original_file.path) or report.source.utf16Length != original_file.utf16Length or !same(report.source.sha256, try std.fmt.allocPrint(allocator, "sha256:{s}", .{original_file.sha256}))) return error.InvalidEffects;
    for (report.scalarHelpers, 0..) |helper, index| {
        try context.spend(1);
        if (!digestId(helper.functionId) or !digestId(helper.signatureHash) or (index > 0 and std.mem.order(u8, report.scalarHelpers[index - 1].functionId, helper.functionId) != .lt)) return error.InvalidEffects;
        for (report.scalarHelpers[0..index]) |previous| if (same(previous.sourceHelperId, helper.sourceHelperId) or same(previous.sourceFunctionId, helper.sourceFunctionId)) return error.InvalidEffects;
        var original: ?*const RawHelper = null;
        for (context.facts.payload.scalarHelpers) |*row| {
            try context.spend(1);
            if (same(row.id, helper.sourceHelperId)) {
                if (original != null) return error.InvalidEffects;
                original = row;
            }
        }
        const raw = original orelse return error.InvalidEffects;
        if (!same(helper.sourceFunctionId, raw.declaration.id) or !sameSource(helper.source, declarationSource(raw.declaration))) return error.InvalidEffects;
        try context.source(helper.source, null);
        try context.helperIdentity(raw, &helper);
        try context.spend(1);
        context.source_helpers[index] = raw;
    }
    for (report.scalarHelpers, 0..) |helper, index| {
        // Call targets may be forward references. Validate all identities first.
        try context.spend(1);
        const raw = context.source_helpers[index];
        if (raw.value == null and raw.statements.len == 0) return error.InvalidEffects;
        try context.sourceBody(raw.statements, raw.value, helper.source, .{ .calls = helper.calls });
        try context.fieldRows(helper.fieldEffects);
        var direct: std.ArrayList([]const u8) = .empty;
        for (helper.calls) |call| if (!contains(direct.items, call.functionId)) {
            try direct.append(allocator, call.functionId);
        };
        std.mem.sort([]const u8, direct.items, {}, lessString);
        if (!sameStrings(direct.items, helper.directCallees)) return error.InvalidEffects;
        var pending: std.ArrayList([]const u8) = .empty;
        try pending.appendSlice(allocator, direct.items);
        var transitive: std.ArrayList([]const u8) = .empty;
        var at: usize = 0;
        while (at < pending.items.len) : (at += 1) {
            try context.spend(1);
            const next = pending.items[at];
            if (same(next, helper.functionId)) return error.InvalidEffects;
            if (contains(transitive.items, next)) continue;
            try transitive.append(allocator, next);
            const child_index = (try context.helperIndex(next)) orelse return error.InvalidEffects;
            const child = &report.scalarHelpers[child_index];
            for (child.calls) |call| try pending.append(allocator, call.functionId);
        }
        std.mem.sort([]const u8, transitive.items, {}, lessString);
        if (!sameStrings(transitive.items, helper.transitiveCallees)) return error.InvalidEffects;
    }
    try context.spend(2 * report.systems.len);
    const source_parameters = try allocator.alloc([]const SourceParameter, report.systems.len);
    const source_system_order = try allocator.alloc(usize, report.systems.len);
    const unassigned = std.math.maxInt(usize);
    @memset(source_system_order, unassigned);
    for (report.systems, 0..) |system, index| {
        try context.spend(1);
        if (!digestId(system.functionId) or !digestId(system.signatureHash) or (index > 0 and std.mem.order(u8, report.systems[index - 1].functionId, system.functionId) != .lt)) return error.InvalidEffects;
        var original: ?usize = null;
        for (context.facts.payload.systems, 0..) |*row, source_index| {
            try context.spend(1);
            if (same(row.declaration.id, system.sourceFunctionId)) {
                if (original != null) return error.InvalidEffects;
                original = source_index;
            }
        }
        const source_index = original orelse return error.InvalidEffects;
        try context.spend(4);
        if (source_system_order[source_index] != unassigned) return error.InvalidEffects;
        source_system_order[source_index] = index;
        const raw = &context.facts.payload.systems[source_index];
        source_parameters[index] = raw.parameters;
        if (!sameSource(system.source, declarationSource(raw.declaration)) or system.loops.len != raw.loops.len) return error.InvalidEffects;
        try context.source(system.source, null);
        var declared: std.ArrayList(Capability) = .empty;
        try context.systemIdentity(raw, &system, &declared);
        std.mem.sort(Capability, declared.items, {}, lessCapability);
        try context.capabilities(system.capabilities);
        if (!sameCapabilities(declared.items, system.capabilities)) return error.InvalidEffects;
        var system_operations: std.ArrayList(Operation) = .empty;
        var system_calls: std.ArrayList(Call) = .empty;
        for (system.loops, raw.loops, 0..) |loop, original_loop, loop_index| {
            try context.spend(1);
            if (loop.index != loop_index or !digestId(loop.selectionId) or !digestId(loop.queryBinding) or !same(loop.queryBinding, original_loop.queryBinding) or !sameSource(loop.source, .{ .path = raw.declaration.sourcePath, .start = original_loop.range.start, .end = original_loop.range.end }) or loop.columns.len != original_loop.bindings.len) return error.InvalidEffects;
            try context.source(loop.source, system.source);
            const query = try context.queryItems(raw.parameters, loop.queryBinding);
            if (query.len != loop.columns.len) return error.InvalidEffects;
            var loop_caps: std.ArrayList(Capability) = .empty;
            for (loop.columns, original_loop.bindings, query, 0..) |column, binding, item, tuple_index| {
                try context.spend(2);
                // Source component IDs are nominal digests. Bound the tuple comparison before reading either ID.
                if (item.componentType.len != "nominal:".len + 64 or !same(binding.componentType, item.componentType) or binding.mode != item.mode) return error.InvalidEffects;
                if (column.tupleIndex != tuple_index or column.tupleIndex != binding.index or !same(column.sourceBinding, binding.declaration.id) or !same(column.sourceComponentType, binding.componentType) or !same(column.componentType, try context.componentId(binding.componentType)) or column.mode != binding.mode or !sameSource(column.source, declarationSource(binding.declaration))) return error.InvalidEffects;
                try context.source(column.source, loop.source);
                try context.addCapability(&loop_caps, .{ .componentType = column.componentType, .sourceComponentType = column.sourceComponentType, .mode = column.mode });
            }
            try context.selectionIdentity(loop.columns, loop.selectionId);
            std.mem.sort(Capability, loop_caps.items, {}, lessCapability);
            try context.capabilities(loop.capabilities);
            if (!sameCapabilities(loop_caps.items, loop.capabilities)) return error.InvalidEffects;
            var operations: SourceOperations = .{ .remaining = loop.operations, .columns = loop.columns };
            try context.sourceBody(original_loop.statements, null, loop.source, .{ .calls = loop.calls, .operations = &operations });
            if (operations.remaining.len != 0) return error.InvalidEffects;
            for (loop.operations) |operation| {
                try context.spend(1);
                if (operation.tupleIndex >= loop.columns.len) return error.InvalidEffects;
                const column = loop.columns[operation.tupleIndex];
                if (!same(operation.componentType, column.componentType) or !same(operation.sourceBinding, column.sourceBinding) or (operation.kind == .write and column.mode != .write)) return error.InvalidEffects;
                try context.field(operation.componentType, operation.field, operation.sourceField, operation.kind == .write);
            }
            try context.fieldRows(loop.fieldEffects);
            try context.fieldSummary(loop.fieldEffects, loop.operations);
            try system_operations.appendSlice(allocator, loop.operations);
            try system_calls.appendSlice(allocator, loop.calls);
        }
        if (system_calls.items.len != system.calls.len) return error.InvalidEffects;
        for (system_calls.items, system.calls) |*left, *right| if (!sameCall(left, right)) return error.InvalidEffects;
        try context.fieldRows(system.fieldEffects);
        try context.fieldSummary(system.fieldEffects, system_operations.items);
    }
    try context.spend(1);
    if (@popCount(context.helper_effects_checked) != report.scalarHelpers.len) return error.InvalidEffects;
    var edge: usize = 0;
    for (report.systems, 0..) |left, i| for (report.systems[i + 1 ..]) |right| {
        try context.spend(1);
        var components: std.ArrayList([]const u8) = .empty;
        for (left.capabilities) |a| for (right.capabilities) |b| {
            try context.spend(1);
            if (same(a.componentType, b.componentType) and (a.mode == .write or b.mode == .write)) try components.append(allocator, a.componentType);
        };
        if (components.items.len == 0) continue;
        if (edge >= report.conflicts.len) return error.InvalidEffects;
        const actual = report.conflicts[edge];
        if (!same(actual.left, left.functionId) or !same(actual.right, right.functionId) or !sameStrings(actual.components, components.items)) return error.InvalidEffects;
        edge += 1;
    };
    if (edge != report.conflicts.len) return error.InvalidEffects;
    return .{ .report = report, .source_parameters = source_parameters, .source_system_order = source_system_order };
}

const Context = struct {
    allocator: std.mem.Allocator,
    report: *const Report,
    facts: Projection,
    catalog: *const layout.Layout,
    source_helpers: [64]*const RawHelper = undefined,
    helper_effects_checked: u64 = 0,
    remaining: usize = 1000000,
    fn spend(self: *Context, amount: usize) Error!void {
        if (amount > self.remaining) return error.EffectsLimit;
        self.remaining -= amount;
    }
    fn source(self: *Context, value: Source, owner: ?Source) Error!void {
        try self.spend(2);
        if (value.start >= value.end) return error.InvalidEffects;
        if (owner) |parent| {
            // The admitted parent already establishes the file and its bounds.
            try self.spend(5 + 2 * (@min(value.path.len, parent.path.len) / 64));
            if (value.start < parent.start or value.end > parent.end or !same(value.path, parent.path)) return error.InvalidEffects;
            return;
        }
        for (self.facts.payload.program.files) |*file| {
            try self.spend(3);
            try self.spend(2 + 2 * (@min(value.path.len, file.path.len) / 64));
            if (!same(value.path, file.path)) continue;
            if (value.end > file.utf16Length) return error.InvalidEffects;
            return;
        }
        return error.InvalidEffects;
    }
    fn componentId(self: *Context, raw: []const u8) Error![]const u8 {
        for (self.facts.payload.types) |*row| {
            try self.spend(1 + @min(raw.len, row.id.len) / 64);
            if (!same(row.id, raw)) continue;
            const kind = row.nominalKey orelse return error.InvalidEffects;
            const range = row.declarationRange orelse return error.InvalidEffects;
            if (!same(kind.category, "component")) return error.InvalidEffects;
            const name = row.name orelse return error.InvalidEffects;
            const path = row.sourcePath orelse return error.InvalidEffects;
            for (self.catalog.payload.types) |*component| {
                try self.spend(1);
                if (component.kind != .component or component.range.start != range.start or component.range.end != range.end) continue;
                try self.spend(2 + @min(name.len, component.name.len) / 64 + @min(path.len, component.sourcePath.len) / 64);
                if (same(component.name, name) and same(component.sourcePath, path)) return component.id;
            }
        }
        return error.InvalidEffects;
    }
    fn queryItems(self: *Context, parameters: []const SourceParameter, binding: []const u8) Error![]const RawItem {
        var selected: ?[]const RawItem = null;
        for (parameters) |parameter| {
            try self.spend(1);
            if (!same(parameter.binding.id, binding)) continue;
            if (selected != null) return error.InvalidEffects;
            selected = (parameter.query orelse return error.InvalidEffects).items;
        }
        return selected orelse error.InvalidEffects;
    }
    fn systemIdentity(self: *Context, raw: *const RawSystem, system: *const System, declared: *std.ArrayList(Capability)) !void {
        try self.spend(4);
        if (!same(raw.returnType, "void")) return error.InvalidEffects;
        var signature = signatureHasher();
        for (raw.parameters, 0..) |*parameter, index| {
            try self.spend(4);
            const id = if (parameter.query) |query| param: {
                if (!same(parameter.logicalType, "Query")) return error.InvalidEffects;
                var selection = selectionHasher();
                for (query.items, 0..) |*item, item_index| {
                    try self.spend(1);
                    const component = try self.componentId(item.componentType);
                    try self.accessItem(&selection, item_index, component, item.mode);
                    try self.addCapability(declared, .{ .componentType = component, .sourceComponentType = item.componentType, .mode = item.mode });
                }
                selection.update("]");
                break :param finishIdentity(&selection);
            } else param: {
                if (!scalar_types.has(parameter.logicalType)) return error.InvalidEffects;
                break :param hashIdentity("tsfg.type\x00", parameter.logicalType);
            };
            addSignatureParameter(&signature, index, &id);
        }
        try self.callableIdentity(&raw.declaration, system.functionId, system.signatureHash, &signature, raw.returnType);
    }
    fn helperIdentity(self: *Context, raw: *const RawHelper, reported: *const Helper) !void {
        try self.spend(4);
        if (!digestId(raw.id) or raw.parameters.len > max_helper_parameters or !floatType(raw.returnType)) return error.InvalidEffects;
        const declaration = &raw.declaration;
        // The Source helper ID names this declaration by its original range and path.
        try self.spend(8 + 16 * (declaration.sourcePath.len / 64 + 1));
        const source_key = try std.json.Stringify.valueAlloc(self.allocator, .{
            .declarationRange = declaration.range,
            .sourcePath = declaration.sourcePath,
        }, .{});
        defer self.allocator.free(source_key);
        if (!same(raw.id, &hashIdentity("tsfg.array-facts.function.v8\x00", source_key))) return error.InvalidEffects;

        var signature = signatureHasher();
        for (raw.parameters, 0..) |*parameter, index| {
            try self.spend(4);
            if (parameter.index != index or parameter.query != null) return error.InvalidEffects;
            const id = if (parameter.view) |view| param: {
                const access = view.access;
                if (access.index != 0 or parameter.logicalType.len != "nominal:".len + 64 or !same(parameter.logicalType, access.componentType)) return error.InvalidEffects;
                const component = try self.componentId(parameter.logicalType);
                var view_hash = Sha256.init(.{});
                view_hash.update("tsfg.query.view.v1\x00");
                try self.accessItem(&view_hash, 0, component, access.mode);
                break :param finishIdentity(&view_hash);
            } else param: {
                if (!floatType(parameter.logicalType)) return error.InvalidEffects;
                break :param hashIdentity("tsfg.type\x00", parameter.logicalType);
            };
            addSignatureParameter(&signature, index, &id);
        }
        try self.callableIdentity(declaration, reported.functionId, reported.signatureHash, &signature, raw.returnType);
    }
    fn callableIdentity(self: *Context, declaration: *const Decl, function_id: []const u8, signature_hash: []const u8, signature: *Sha256, return_type: []const u8) !void {
        if (declaration.name.len == 0) return error.InvalidEffects;
        signature.update("],\"returns\":\"");
        signature.update(&hashIdentity("tsfg.type\x00", return_type));
        signature.update("\"}");
        const signature_id = finishIdentity(signature);
        if (!same(signature_hash, &signature_id)) return error.InvalidEffects;

        // Prepay both canonical JSON encodings and the final hash. The
        // nested name is encoded once as an object and again as a string.
        const source_bytes = declaration.name.len + declaration.sourcePath.len;
        try self.spend(16 + 32 * (source_bytes / 64 + 1));
        const name = try std.json.Stringify.valueAlloc(self.allocator, .{
            .kind = "function",
            .name = declaration.name,
            .path = [_]u32{},
        }, .{});
        defer self.allocator.free(name);
        const preimage = try std.json.Stringify.valueAlloc(self.allocator, .{
            .name = name,
            .path = declaration.sourcePath,
            .signatureHash = @as([]const u8, &signature_id),
        }, .{});
        defer self.allocator.free(preimage);
        if (!same(function_id, &hashIdentity("tsfg.module-callable-function.candidate.v1\x00", preimage))) return error.InvalidEffects;
    }
    fn accessItem(self: *Context, hash: *Sha256, index: usize, component: []const u8, mode: Access) Error!void {
        try self.spend(2);
        if (!digestId(component)) return error.InvalidEffects;
        // The fixed digest and the two Access tags need no JSON escaping.
        hash.update(if (index == 0) "{\"componentType\":\"" else ",{\"componentType\":\"");
        hash.update(component);
        hash.update(switch (mode) {
            .read => "\",\"mode\":\"read\"}",
            .write => "\",\"mode\":\"write\"}",
        });
    }
    fn selectionIdentity(self: *Context, columns: []const Column, expected: []const u8) Error!void {
        try self.spend(2);
        var hash = selectionHasher();
        for (columns, 0..) |*column, index|
            try self.accessItem(&hash, index, column.componentType, column.mode);
        hash.update("]");
        if (!same(expected, &finishIdentity(&hash))) return error.InvalidEffects;
    }
    fn capabilities(self: *Context, rows: []const Capability) Error!void {
        for (rows, 0..) |row, index| {
            try self.spend(1);
            if (!same(row.componentType, try self.componentId(row.sourceComponentType)) or (index > 0 and std.mem.order(u8, rows[index - 1].componentType, row.componentType) != .lt)) return error.InvalidEffects;
        }
    }
    fn addCapability(self: *Context, list: *std.ArrayList(Capability), item: Capability) !void {
        try self.spend(1);
        for (list.items) |*row| if (same(row.componentType, item.componentType)) {
            if (!same(row.sourceComponentType, item.sourceComponentType)) return error.InvalidEffects;
            if (item.mode == .write) row.mode = .write;
            return;
        };
        try list.append(self.allocator, item);
    }
    fn helperIndex(self: *Context, id: []const u8) Error!?usize {
        try self.spend(2);
        if (!digestId(id)) return null;
        for (self.report.scalarHelpers, 0..) |*row, index| {
            try self.spend(5);
            if (same(row.functionId, id)) return index;
        }
        return null;
    }
    fn call(self: *Context, value: *const Call, owner: Source) Error!usize {
        const index = (try self.helperIndex(value.functionId)) orelse return error.InvalidEffects;
        try self.spend(10);
        const target = &self.report.scalarHelpers[index];
        if (!same(target.signatureHash, value.signatureHash) or !same(target.sourceHelperId, value.sourceHelperId)) return error.InvalidEffects;
        try self.source(value.source, owner);
        try self.source(value.calleeSource, value.source);
        return index;
    }
    fn sourceBody(self: *Context, statements: []const RawStatement, legacy_value: ?*const RawExpression, owner: Source, rows: SourceBodyRows) SourceCheckError!void {
        var remaining = rows;
        if (legacy_value) |expression| {
            if (statements.len != 0) return error.InvalidEffects;
            try self.sourceExpression(expression, &remaining, owner, 0);
        } else for (statements) |*statement| {
            try self.spend(1);
            const expression = statement.initializer orelse statement.value orelse return error.InvalidEffects;
            try self.sourceExpression(expression, &remaining, owner, 0);
        }
        if (remaining.calls.len != 0) return error.InvalidEffects;
    }
    fn sourceExpression(self: *Context, expression: *const RawExpression, rows: *SourceBodyRows, owner: Source, depth: usize) SourceCheckError!void {
        try self.spend(1);
        if (depth >= max_expression_depth) return error.EffectsLimit;
        const next_depth = depth + 1;
        switch (expression.kind) {
            .fieldAccess => if (rows.operations) |operations|
                try self.sourceFieldOperation(operations, .read, expression, expression.range, owner),
            .call => {
                // Direct calls in arguments precede the enclosing call in the report.
                for (expression.arguments) |*argument| try self.sourceExpression(argument, rows, owner, next_depth);
                // Four range fields and fixed-width helper identity checks.
                try self.spend(12);
                const callee_range = expression.calleeRange orelse return error.InvalidEffects;
                if (rows.calls.len == 0 or !digestId(expression.callee)) return error.InvalidEffects;
                const edge = &rows.calls[0];
                if (edge.source.start != expression.range.start or edge.source.end != expression.range.end or
                    edge.calleeSource.start != callee_range.start or edge.calleeSource.end != callee_range.end or
                    !same(edge.sourceHelperId, expression.callee)) return error.InvalidEffects;
                const target = try self.call(edge, owner);
                rows.calls = rows.calls[1..];
                if (rows.operations) |operations|
                    try self.sourceHelperOperations(operations, edge, target, expression.arguments);
            },
            .binary => {
                try self.sourceExpression(expression.left orelse return error.InvalidEffects, rows, owner, next_depth);
                try self.sourceExpression(expression.right orelse return error.InvalidEffects, rows, owner, next_depth);
            },
            .fieldAssignment => {
                const target = if (rows.operations != null) expression.target orelse return error.InvalidEffects else null;
                if (target) |field_target| {
                    try self.spend(2);
                    if (field_target.kind != .fieldTarget) return error.InvalidEffects;
                    if (!same(expression.operator, "="))
                        try self.sourceFieldOperation(rows.operations.?, .read, field_target, field_target.range, owner);
                }
                try self.sourceExpression(expression.value orelse return error.InvalidEffects, rows, owner, next_depth);
                if (target) |field_target|
                    try self.sourceFieldOperation(rows.operations.?, .write, field_target, expression.range, owner);
            },
            .bindingAssignment => try self.sourceExpression(expression.value orelse return error.InvalidEffects, rows, owner, next_depth),
            .parentheses => try self.sourceExpression(expression.expression orelse return error.InvalidEffects, rows, owner, next_depth),
            else => {},
        }
    }
    fn sourceViewArgument(self: *Context, original: *const RawExpression) Error![]const u8 {
        var expression = original;
        for (0..max_expression_depth) |_| {
            try self.spend(1);
            switch (expression.kind) {
                .parentheses => expression = expression.expression orelse return error.InvalidEffects,
                .bindingReference => return expression.binding,
                else => return error.InvalidEffects,
            }
        }
        return error.EffectsLimit;
    }
    fn sourceView(self: *Context, operations: *const SourceOperations, binding: []const u8) Error!SourceView {
        try self.spend(3);
        if (!digestId(binding)) return error.InvalidEffects;
        if (operations.depth == 0) {
            for (operations.columns) |*column| {
                try self.spend(5);
                if (same(column.sourceBinding, binding)) return .{ .binding = binding, .column = column, .mode = column.mode };
            }
        } else {
            for (operations.views) |*view| {
                try self.spend(5);
                if (same(view.binding, binding)) {
                    try self.spend(4);
                    return view.*;
                }
            }
        }
        return error.InvalidEffects;
    }
    fn sourceHelperOperations(self: *Context, operations: *SourceOperations, call_edge: *const Call, target: usize, arguments: []const RawExpression) SourceCheckError!void {
        try self.spend(8);
        if (operations.depth >= operations.path.len) return error.EffectsLimit;
        const raw = self.source_helpers[target];
        if (arguments.len != raw.parameters.len) return error.InvalidEffects;
        var views: [max_helper_parameters]SourceView = undefined;
        var count: usize = 0;
        for (raw.parameters, arguments) |*formal, *argument| {
            try self.spend(2);
            const view = if (formal.view) |*value| value else continue;
            const actual = try self.sourceView(operations, try self.sourceViewArgument(argument));
            try self.spend(9);
            if (!digestId(formal.binding.id) or !same(formal.logicalType, actual.column.sourceComponentType) or
                (view.access.mode == .write and actual.mode != .write)) return error.InvalidEffects;
            views[count] = .{ .binding = formal.binding.id, .column = actual.column, .mode = view.access.mode };
            count += 1;
        }
        const previous_views = operations.views;
        operations.views = views[0..count];
        operations.path[operations.depth] = call_edge;
        operations.depth += 1;
        defer {
            operations.depth -= 1;
            operations.views = previous_views;
        }
        const helper_row = &self.report.scalarHelpers[target];
        try self.spend(4);
        const checked_bit = @as(u64, 1) << @as(u6, @intCast(target));
        const before: ?[]const Operation = if (self.helper_effects_checked & checked_bit == 0) operations.remaining else null;
        try self.sourceBody(raw.statements, raw.value, helper_row.source, .{ .calls = helper_row.calls, .operations = operations });
        if (before) |start| {
            // The cursor enters after argument evaluation. Same-type view
            // substitution preserves the helper's component-level counts.
            try self.spend(3);
            const consumed = start.len - operations.remaining.len;
            try self.fieldSummary(helper_row.fieldEffects, start[0..consumed]);
            self.helper_effects_checked |= checked_bit;
        }
    }
    fn sourceFieldOperation(self: *Context, operations: *SourceOperations, kind: Access, field_expression: *const RawExpression, range: layout.Range, owner: Source) Error!void {
        try self.spend(16);
        if (operations.remaining.len == 0) return error.InvalidEffects;
        const operation = &operations.remaining[0];
        const receiver = field_expression.receiver orelse return error.InvalidEffects;
        const binding = if (operations.depth == 0) receiver.binding else actual: {
            const view = try self.sourceView(operations, receiver.binding);
            if (kind == .write and view.mode != .write) return error.InvalidEffects;
            break :actual view.column.sourceBinding;
        };
        if (!digestId(receiver.binding) or !digestId(field_expression.property) or operation.kind != kind or
            operation.source.start != range.start or operation.source.end != range.end or
            !same(operation.sourceBinding, binding) or !same(operation.sourceField, field_expression.property) or
            operation.callPath.len != operations.depth) return error.InvalidEffects;
        for (operation.callPath, 0..) |*reported, index| {
            try self.spend(2);
            const expected = operations.path[index];
            try self.spend(20 + 2 * (expected.source.path.len / 64 + expected.calleeSource.path.len / 64));
            if (!sameCall(reported, expected)) return error.InvalidEffects;
        }
        try self.source(operation.source, owner);
        operations.remaining = operations.remaining[1..];
    }
    fn field(self: *Context, component: []const u8, id: []const u8, source_id: []const u8, writable: bool) Error!void {
        try self.spend(1);
        const row = self.catalog.find(component) orelse return error.InvalidEffects;
        if (row.kind != .component or !digestId(source_id)) return error.InvalidEffects;
        for (row.fields) |*item| {
            try self.spend(1);
            if (!same(item.id, id)) continue;
            if (writable and item.readonly) return error.InvalidEffects;
            for (self.facts.payload.types) |*raw| {
                try self.spend(1);
                for (raw.fields) |*original| {
                    try self.spend(1);
                    if (!same(original.id, source_id)) continue;
                    try self.spend(3 + @min(original.name.len, item.name.len) / 64 + @min(original.origin.source.len, item.sourcePath.len) / 64);
                    if (!same(original.name, item.name) or !same(original.origin.source, item.sourcePath) or original.origin.start != item.range.start or original.origin.end != item.range.end) continue;
                    try self.spend(5);
                    if (original.readonly != item.readonly or !scalar_types.has(original.type)) return error.InvalidEffects;
                    const expected_type = hashIdentity("tsfg.type\x00", original.type);
                    if (!same(item.type, &expected_type)) return error.InvalidEffects;
                    return;
                }
            }
            return error.InvalidEffects;
        }
        return error.InvalidEffects;
    }
    fn fieldRows(self: *Context, rows: []const FieldEffects) Error!void {
        for (rows, 0..) |row, index| {
            try self.field(row.componentType, row.field, row.sourceField, row.writeCount != 0);
            if ((row.readCount == 0 and row.writeCount == 0) or (index > 0 and !lessField({}, rows[index - 1], row))) return error.InvalidEffects;
        }
    }
    fn fieldSummary(self: *Context, fields: []const FieldEffects, operations: []const Operation) SourceCheckError!void {
        try self.spend(1);
        if (fields.len > operations.len) return error.InvalidEffects;
        const Counts = struct { reads: u32, writes: u32 };
        try self.spend(2 + 3 * fields.len);
        const remaining = try self.allocator.alloc(Counts, fields.len);
        defer self.allocator.free(remaining);
        for (fields, remaining) |*row, *counts| {
            counts.* = .{ .reads = row.readCount, .writes = row.writeCount };
        }
        for (operations) |*operation| {
            try self.spend(5);
            const index = find: {
                var low: usize = 0;
                var high = fields.len;
                while (low < high) {
                    try self.spend(20);
                    const mid = low + (high - low) / 2;
                    switch (fieldOrder(&fields[mid], operation.componentType, operation.field, operation.sourceField)) {
                        .lt => low = mid + 1,
                        .gt => high = mid,
                        .eq => break :find mid,
                    }
                }
                return error.InvalidEffects;
            };
            const counts = &remaining[index];
            const count = switch (operation.kind) {
                .read => &counts.reads,
                .write => &counts.writes,
            };
            if (count.* == 0) return error.InvalidEffects;
            count.* -= 1;
        }
        for (remaining) |*counts| {
            try self.spend(1);
            if (counts.reads != 0 or counts.writes != 0) return error.InvalidEffects;
        }
    }
};
pub fn sameSource(a: Source, b: Source) bool {
    return a.start == b.start and a.end == b.end and same(a.path, b.path);
}
fn declarationSource(value: Decl) Source {
    return .{ .path = value.sourcePath, .start = value.range.start, .end = value.range.end };
}
fn same(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
fn contains(rows: []const []const u8, value: []const u8) bool {
    for (rows) |row| if (same(row, value)) return true;
    return false;
}
fn sameStrings(a: []const []const u8, b: []const []const u8) bool {
    if (a.len != b.len) return false;
    for (a, b) |left, right| if (!same(left, right)) return false;
    return true;
}
fn lessString(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.order(u8, a, b) == .lt;
}
fn lessCapability(_: void, a: Capability, b: Capability) bool {
    return lessString({}, a.componentType, b.componentType);
}
fn sameCapabilities(a: []const Capability, b: []const Capability) bool {
    if (a.len != b.len) return false;
    for (a, b) |left, right| if (!same(left.componentType, right.componentType) or !same(left.sourceComponentType, right.sourceComponentType) or left.mode != right.mode) return false;
    return true;
}
fn lessField(_: void, a: FieldEffects, b: FieldEffects) bool {
    return fieldOrder(&a, b.componentType, b.field, b.sourceField) == .lt;
}
fn fieldOrder(row: *const FieldEffects, component_type: []const u8, field_id: []const u8, source_field: []const u8) std.math.Order {
    const component = std.mem.order(u8, row.componentType, component_type);
    if (component != .eq) return component;
    const field = std.mem.order(u8, row.field, field_id);
    if (field != .eq) return field;
    return std.mem.order(u8, row.sourceField, source_field);
}
fn sameCall(a: *const Call, b: *const Call) bool {
    return same(a.functionId, b.functionId) and same(a.signatureHash, b.signatureHash) and same(a.sourceHelperId, b.sourceHelperId) and sameSource(a.source, b.source) and sameSource(a.calleeSource, b.calleeSource);
}
fn selectionHasher() Sha256 {
    var hash = Sha256.init(.{});
    hash.update("tsfg.query.type.v1\x00[");
    return hash;
}
fn signatureHasher() Sha256 {
    var hash = Sha256.init(.{});
    hash.update("tsfg.module-callable-signature.candidate.v1\x00{\"parameters\":[");
    return hash;
}
fn addSignatureParameter(hash: *Sha256, index: usize, id: *const Identity) void {
    if (index != 0) hash.update(",");
    hash.update("\"");
    hash.update(id);
    hash.update("\"");
}
fn floatType(value: []const u8) bool {
    return same(value, "f32") or same(value, "f64");
}
fn finishIdentity(hash: *Sha256) Identity {
    var value: [Sha256.digest_length]u8 = undefined;
    hash.final(&value);
    return "sha256:".* ++ std.fmt.bytesToHex(value, .lower);
}
fn hashIdentity(prefix: []const u8, text: []const u8) Identity {
    var hash = Sha256.init(.{});
    hash.update(prefix);
    hash.update(text);
    return finishIdentity(&hash);
}
fn digestId(value: []const u8) bool {
    if (value.len != 71 or !std.mem.startsWith(u8, value, "sha256:")) return false;
    for (value[7..]) |byte| if (!(byte >= '0' and byte <= '9') and !(byte >= 'a' and byte <= 'f')) return false;
    return true;
}
fn jsonBudget(bytes: []const u8) Error!void {
    var depth: usize = 0;
    var tokens: usize = 0;
    var quoted = false;
    var escaped = false;
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
            if (depth > 128) return error.EffectsLimit;
        } else if (byte == '}' or byte == ']') {
            if (depth == 0) return error.InvalidEffects;
            depth -= 1;
        } else if (byte == ',' or byte == ':') {
            tokens += 1;
        }
        if (tokens > 1000000) return error.EffectsLimit;
    }
    if (depth != 0 or quoted) return error.InvalidEffects;
}
