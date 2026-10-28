// SPDX-License-Identifier: MIT
//! Read-only consumption of the existing v3 component-level effects protocol.
const std = @import("std");
const layout = @import("layout.zig");
const Access = @import("store.zig").Access;
pub const Error = error{ InvalidEffects, EffectsLimit, UnknownSystem, InvalidPair };
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

// Only the already-owned packet's declaration/type/loop facts directory is projected.
// The full original packet remains in Document; no syntax AST or expression is interpreted.
const Decl = struct { id: []const u8, range: layout.Range, sourcePath: []const u8 };
const RawField = struct { id: []const u8, name: []const u8, origin: struct { end: u32, source: []const u8, start: u32 } };
const RawType = struct { id: []const u8, name: ?[]const u8 = null, sourcePath: ?[]const u8 = null, declarationRange: ?layout.Range = null, nominalKey: ?struct { category: []const u8 } = null, fields: []const RawField = &.{} };
const RawItem = struct { componentType: []const u8, mode: Access };
const RawParameter = struct { binding: struct { id: []const u8 }, query: ?struct { items: []const RawItem } };
const RawBinding = struct { componentType: []const u8, declaration: Decl, index: u32, mode: Access };
const RawLoop = struct { bindings: []const RawBinding, queryBinding: []const u8, range: layout.Range };
const RawSystem = struct { declaration: Decl, loops: []const RawLoop, parameters: []const RawParameter };
const Projection = struct { payload: struct { program: struct { files: []const SourceFile, rootFile: []const u8 }, scalarHelpers: []const struct { declaration: Decl, id: []const u8 }, systems: []const RawSystem, types: []const RawType } };

pub const Analysis = struct {
    report: Report,
    pub fn system(self: *const Analysis, id: []const u8) ?*const System {
        for (self.report.systems) |*row| if (same(row.functionId, id)) return row;
        return null;
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
        var original: ?Decl = null;
        for (context.facts.payload.scalarHelpers) |row| {
            try context.spend(1);
            if (same(row.id, helper.sourceHelperId)) {
                if (original != null) return error.InvalidEffects;
                original = row.declaration;
            }
        }
        const decl = original orelse return error.InvalidEffects;
        if (!same(helper.sourceFunctionId, decl.id) or !sameSource(helper.source, declarationSource(decl))) return error.InvalidEffects;
        try context.source(helper.source, null);
    }
    for (report.scalarHelpers) |helper| {
        try context.calls(helper.calls, helper.source);
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
            const child = context.helper(next) orelse return error.InvalidEffects;
            for (child.calls) |call| try pending.append(allocator, call.functionId);
        }
        std.mem.sort([]const u8, transitive.items, {}, lessString);
        if (!sameStrings(transitive.items, helper.transitiveCallees)) return error.InvalidEffects;
    }
    for (report.systems, 0..) |system, index| {
        try context.spend(1);
        if (!digestId(system.functionId) or !digestId(system.signatureHash) or (index > 0 and std.mem.order(u8, report.systems[index - 1].functionId, system.functionId) != .lt)) return error.InvalidEffects;
        var original: ?RawSystem = null;
        for (context.facts.payload.systems) |row| {
            try context.spend(1);
            if (same(row.declaration.id, system.sourceFunctionId)) {
                if (original != null) return error.InvalidEffects;
                original = row;
            }
        }
        const raw = original orelse return error.InvalidEffects;
        if (!sameSource(system.source, declarationSource(raw.declaration)) or system.loops.len != raw.loops.len) return error.InvalidEffects;
        for (report.systems[0..index]) |previous| if (same(previous.sourceFunctionId, system.sourceFunctionId)) return error.InvalidEffects;
        try context.source(system.source, null);
        var declared: std.ArrayList(Capability) = .empty;
        for (raw.parameters) |parameter| if (parameter.query) |query| for (query.items) |item| {
            try context.addCapability(&declared, .{ .componentType = try context.componentId(item.componentType), .sourceComponentType = item.componentType, .mode = item.mode });
        };
        std.mem.sort(Capability, declared.items, {}, lessCapability);
        try context.capabilities(system.capabilities);
        if (!sameCapabilities(declared.items, system.capabilities)) return error.InvalidEffects;
        var system_operations: std.ArrayList(Operation) = .empty;
        var system_calls: std.ArrayList(Call) = .empty;
        for (system.loops, raw.loops, 0..) |loop, original_loop, loop_index| {
            try context.spend(1);
            if (loop.index != loop_index or !digestId(loop.selectionId) or !same(loop.queryBinding, original_loop.queryBinding) or !sameSource(loop.source, .{ .path = raw.declaration.sourcePath, .start = original_loop.range.start, .end = original_loop.range.end }) or loop.columns.len != original_loop.bindings.len) return error.InvalidEffects;
            try context.source(loop.source, system.source);
            var loop_caps: std.ArrayList(Capability) = .empty;
            for (loop.columns, original_loop.bindings, 0..) |column, binding, tuple_index| {
                try context.spend(1);
                if (column.tupleIndex != tuple_index or column.tupleIndex != binding.index or !same(column.sourceBinding, binding.declaration.id) or !same(column.sourceComponentType, binding.componentType) or !same(column.componentType, try context.componentId(binding.componentType)) or column.mode != binding.mode or !sameSource(column.source, declarationSource(binding.declaration))) return error.InvalidEffects;
                try context.source(column.source, loop.source);
                try context.addCapability(&loop_caps, .{ .componentType = column.componentType, .sourceComponentType = column.sourceComponentType, .mode = column.mode });
            }
            std.mem.sort(Capability, loop_caps.items, {}, lessCapability);
            try context.capabilities(loop.capabilities);
            if (!sameCapabilities(loop_caps.items, loop.capabilities)) return error.InvalidEffects;
            try context.calls(loop.calls, loop.source);
            for (loop.operations) |operation| {
                try context.spend(1);
                if (operation.tupleIndex >= loop.columns.len) return error.InvalidEffects;
                const column = loop.columns[operation.tupleIndex];
                if (!same(operation.componentType, column.componentType) or !same(operation.sourceBinding, column.sourceBinding) or (operation.kind == .write and column.mode != .write) or operation.callPath.len > 32) return error.InvalidEffects;
                try context.field(operation.componentType, operation.field, operation.sourceField, operation.kind == .write);
                var owner = loop.source;
                var available = loop.calls;
                for (operation.callPath) |call| {
                    try context.spend(1);
                    var found = false;
                    for (available) |candidate| if (sameCall(call, candidate)) {
                        found = true;
                        break;
                    };
                    if (!found) return error.InvalidEffects;
                    try context.call(call, owner);
                    const next = context.helper(call.functionId).?;
                    owner = next.source;
                    available = next.calls;
                }
                try context.source(operation.source, owner);
            }
            try context.fieldRows(loop.fieldEffects);
            if (!sameFieldRows(try context.countFields(loop.operations), loop.fieldEffects)) return error.InvalidEffects;
            try system_operations.appendSlice(allocator, loop.operations);
            try system_calls.appendSlice(allocator, loop.calls);
        }
        if (system_calls.items.len != system.calls.len) return error.InvalidEffects;
        for (system_calls.items, system.calls) |left, right| if (!sameCall(left, right)) return error.InvalidEffects;
        try context.fieldRows(system.fieldEffects);
        if (!sameFieldRows(try context.countFields(system_operations.items), system.fieldEffects)) return error.InvalidEffects;
    }
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
    return .{ .report = report };
}

const Context = struct {
    allocator: std.mem.Allocator,
    report: *const Report,
    facts: Projection,
    catalog: *const layout.Layout,
    remaining: usize = 1000000,
    fn spend(self: *Context, amount: usize) Error!void {
        if (amount > self.remaining) return error.EffectsLimit;
        self.remaining -= amount;
    }
    fn source(self: *Context, value: Source, owner: ?Source) Error!void {
        try self.spend(1);
        for (self.facts.payload.program.files) |file| if (same(value.path, file.path)) {
            if (value.start >= value.end or value.end > file.utf16Length) return error.InvalidEffects;
            if (owner) |parent| if (!same(value.path, parent.path) or value.start < parent.start or value.end > parent.end) return error.InvalidEffects;
            return;
        };
        return error.InvalidEffects;
    }
    fn componentId(self: *Context, raw: []const u8) Error![]const u8 {
        for (self.facts.payload.types) |row| {
            try self.spend(1);
            if (!same(row.id, raw)) continue;
            const kind = row.nominalKey orelse return error.InvalidEffects;
            const range = row.declarationRange orelse return error.InvalidEffects;
            if (!same(kind.category, "component")) return error.InvalidEffects;
            for (self.catalog.payload.types) |component| if (component.kind == .component and same(component.name, row.name orelse return error.InvalidEffects) and same(component.sourcePath, row.sourcePath orelse return error.InvalidEffects) and component.range.start == range.start and component.range.end == range.end) return component.id;
        }
        return error.InvalidEffects;
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
    fn helper(self: *const Context, id: []const u8) ?*const Helper {
        for (self.report.scalarHelpers) |*row| if (same(row.functionId, id)) return row;
        return null;
    }
    fn call(self: *Context, value: Call, owner: Source) Error!void {
        try self.spend(1);
        const target = self.helper(value.functionId) orelse return error.InvalidEffects;
        if (!same(target.signatureHash, value.signatureHash) or !same(target.sourceHelperId, value.sourceHelperId)) return error.InvalidEffects;
        try self.source(value.source, owner);
        try self.source(value.calleeSource, value.source);
    }
    fn calls(self: *Context, rows: []const Call, owner: Source) Error!void {
        for (rows) |row| try self.call(row, owner);
    }
    fn field(self: *Context, component: []const u8, id: []const u8, source_id: []const u8, writable: bool) Error!void {
        try self.spend(1);
        const row = self.catalog.find(component) orelse return error.InvalidEffects;
        if (row.kind != .component or !digestId(source_id)) return error.InvalidEffects;
        for (row.fields) |item| if (same(item.id, id)) {
            if (writable and item.readonly) return error.InvalidEffects;
            for (self.facts.payload.types) |raw| for (raw.fields) |original| {
                try self.spend(1);
                if (same(original.id, source_id) and same(original.name, item.name) and same(original.origin.source, item.sourcePath) and original.origin.start == item.range.start and original.origin.end == item.range.end) return;
            };
            return error.InvalidEffects;
        };
        return error.InvalidEffects;
    }
    fn fieldRows(self: *Context, rows: []const FieldEffects) Error!void {
        for (rows, 0..) |row, index| {
            try self.field(row.componentType, row.field, row.sourceField, row.writeCount != 0);
            if ((row.readCount == 0 and row.writeCount == 0) or (index > 0 and !lessField({}, rows[index - 1], row))) return error.InvalidEffects;
        }
    }
    fn countFields(self: *Context, operations: []const Operation) ![]const FieldEffects {
        var fields: std.ArrayList(FieldEffects) = .empty;
        for (operations) |operation| {
            try self.spend(1);
            var found = false;
            for (fields.items) |*row| if (same(row.componentType, operation.componentType) and same(row.field, operation.field) and same(row.sourceField, operation.sourceField)) {
                if (operation.kind == .read) row.readCount = std.math.add(u32, row.readCount, 1) catch return error.EffectsLimit else row.writeCount = std.math.add(u32, row.writeCount, 1) catch return error.EffectsLimit;
                found = true;
                break;
            };
            if (!found) try fields.append(self.allocator, .{ .componentType = operation.componentType, .field = operation.field, .sourceField = operation.sourceField, .readCount = if (operation.kind == .read) 1 else 0, .writeCount = if (operation.kind == .write) 1 else 0 });
        }
        std.mem.sort(FieldEffects, fields.items, {}, lessField);
        return fields.items;
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
    const component = std.mem.order(u8, a.componentType, b.componentType);
    if (component != .eq) return component == .lt;
    const field = std.mem.order(u8, a.field, b.field);
    if (field != .eq) return field == .lt;
    return lessString({}, a.sourceField, b.sourceField);
}
fn sameFieldRows(a: []const FieldEffects, b: []const FieldEffects) bool {
    if (a.len != b.len) return false;
    for (a, b) |left, right| if (!same(left.componentType, right.componentType) or !same(left.field, right.field) or !same(left.sourceField, right.sourceField) or left.readCount != right.readCount or left.writeCount != right.writeCount) return false;
    return true;
}
fn sameCall(a: Call, b: Call) bool {
    return same(a.functionId, b.functionId) and same(a.signatureHash, b.signatureHash) and same(a.sourceHelperId, b.sourceHelperId) and sameSource(a.source, b.source) and sameSource(a.calleeSource, b.calleeSource);
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
