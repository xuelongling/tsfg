// SPDX-License-Identifier: MIT
// Fixed CODE upper domain. It has no ActualValue, allocation, environment
// instance, heap, Region or execution meaning. Contract inputs live only here;
// body observations must independently fit those inputs/return assumptions.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const context = @import("wire-program-refcheck-context.zig");
const publication = @import("wire-program-publication.zig");
const storage = @import("wire-program-storage.zig");
const fixed_interface = @import("wire-program-fixed-publication-check.zig");
pub const t = model.types;
pub const Context = context.Context;
pub const Error = context.Error;

pub const Codes = struct {
    top: bool = false,
    functions: std.AutoHashMapUnmanaged(t.FunctionRef, void) = .empty,
    pub fn deinit(self: *Codes, a: std.mem.Allocator) void { self.functions.deinit(a); self.* = .{}; }
    pub fn clone(c: *Context, value: Codes) Error!Codes {
        var result = Codes{ .top = value.top }; errdefer result.deinit(c.allocator);
        _ = try result.join(c, value); return result;
    }
    pub fn join(self: *Codes, c: *Context, value: Codes) Error!bool {
        try c.step(); var changed = value.top and !self.top; self.top = self.top or value.top;
        var it = value.functions.keyIterator(); while (it.next()) |id| {
            try c.step(); if (self.functions.contains(id.*)) continue;
            if (self.functions.count() == 256) return error.WorkLimit;
            try self.functions.put(c.allocator, id.*, {}); changed = true;
        }
        return changed;
    }
    pub fn equal(c: *Context, a: Codes, b: Codes) Error!bool {
        try c.step(); if (a.top != b.top or a.functions.count() != b.functions.count()) return false;
        var it = a.functions.keyIterator(); while (it.next()) |id| { try c.step(); if (!b.functions.contains(id.*)) return false; }
        return true;
    }
    pub fn subset(c: *Context, body: Codes, upper: Codes) Error!bool {
        try c.step(); if (upper.top) return true; if (body.top) return false;
        var it = body.functions.keyIterator(); while (it.next()) |id| { try c.step(); if (!upper.functions.contains(id.*)) return false; }
        return true;
    }
};
// null means a noncallable expression, .{} a represented EMPTY code set.
// TOP is distinct from both and is never expanded into actual instances.
pub const Value = ?Codes;
pub fn cloneValue(c: *Context, value: Value) Error!Value { return if (value) |v| try Codes.clone(c, v) else null; }
pub fn deinitValue(value: *Value, a: std.mem.Allocator) void { if (value.*) |*v| v.deinit(a); value.* = null; }
pub fn joinValue(c: *Context, into: *Value, value: Value) Error!bool {
    try c.step(); if (value) |v| { if (into.*) |*old| return old.join(c, v); into.* = try Codes.clone(c, v); return true; } return false;
}
pub fn replaceValue(c: *Context, into: *Value, value: Value) Error!void {
    const copied = try cloneValue(c, value); deinitValue(into, c.allocator); into.* = copied;
}

pub const Bound = struct {
    contract: ?usize = null,
    parameters: []Codes = &.{},
    observations: []Codes = &.{},
    returned: Value = null,
    result_observed: Value = null,
};
const Capture = union(enum) { none, parameter: struct { function: t.FunctionRef, index: usize }, local };
const Field = struct { parent: usize = 0, callable: bool = false, exposed: bool = false, value: Codes = .{}, captured: Codes = .{} };
const Array = struct {
    parent: ?usize = null, exposed: bool = false, unsafe: bool = false, missing: bool = false,
    minimum: ?usize = null, value: Codes = .{}, captured: Codes = .{},
};
const Pair = struct { from: t.TypeRef, to: t.TypeRef };

pub const Domain = struct {
    c: *Context,
    common: tables.CommonTables,
    functions: std.AutoHashMapUnmanaged(t.Hash, t.FunctionRef) = .empty,
    bounds: []Bound = &.{},
    captures: []Capture = &.{},
    captured_values: []Codes = &.{},
    closure_rows: []?usize = &.{},
    external: []bool = &.{},
    exposed: []bool = &.{},
    fields: []Field = &.{},
    arrays: []Array = &.{},
    dirty: bool = false,

    pub fn deinit(self: *Domain) void {
        const a = self.c.allocator;
        for (self.bounds) |*bound| {
            for (bound.parameters) |*v| v.deinit(a); a.free(bound.parameters);
            for (bound.observations) |*v| v.deinit(a); a.free(bound.observations);
            deinitValue(&bound.returned, a); deinitValue(&bound.result_observed, a);
        }
        for (self.captured_values) |*v| v.deinit(a);
        for (self.fields) |*f| { f.value.deinit(a); f.captured.deinit(a); }
        for (self.arrays) |*v| { v.value.deinit(a); v.captured.deinit(a); }
        a.free(self.bounds); a.free(self.captures); a.free(self.captured_values); a.free(self.closure_rows);
        a.free(self.external); a.free(self.exposed); a.free(self.fields); a.free(self.arrays); self.functions.deinit(a);
    }
    pub fn abi(self: *const Domain, id: t.FunctionRef) *const storage.CommonAbi {
        return &self.common.abis[@intFromEnum(self.c.program.functions[@intFromEnum(id)].abi)];
    }
    pub fn logical(self: *const Domain, function: t.FunctionRef, reg: t.RegisterRef) ?t.TypeRef {
        const row = self.c.program.functions[@intFromEnum(function)].registers[@intFromEnum(reg)];
        return row.view orelse if (row.carrier == .@"type") row.carrier.@"type" else null;
    }
    pub fn callable(self: *Domain, id: ?t.TypeRef) Error!bool {
        const ref = id orelse { try self.c.step(); return false; };
        return (try fixed_interface.callableType(self.c, self.common, ref)) != null;
    }
    pub fn original(self: *const Domain, id: t.FunctionRef) *const publication.EffectUpper {
        return &self.common.authority.fixed_publication.publication.contracts[self.bounds[@intFromEnum(id)].contract.?].upper;
    }
    fn readCodes(self: *Domain, declared: publication.CodeTargets) Error!Codes {
        var out = Codes{ .top = declared.top }; errdefer out.deinit(self.c.allocator);
        for (declared.functions) |id| { try self.c.step(); const code = self.functions.get(id) orelse return error.InvalidReference; try out.functions.put(self.c.allocator, code, {}); }
        return out;
    }
    pub fn observe(self: *Domain, id: t.FunctionRef, index: usize, value: Codes) Error!void {
        _ = try self.bounds[@intFromEnum(id)].observations[index].join(self.c, value);
    }
    pub fn captured(self: *Domain, binding: t.BindingRef) Error!Value {
        try self.c.step(); return switch (self.captures[@intFromEnum(binding)]) {
            .parameter => |p| try Codes.clone(self.c, self.bounds[@intFromEnum(p.function)].parameters[p.index]),
            .local => try Codes.clone(self.c, self.captured_values[@intFromEnum(binding)]), .none => null,
        };
    }
    pub fn storeCaptured(self: *Domain, binding: t.BindingRef, value: Codes) Error!void {
        try self.c.step(); switch (self.captures[@intFromEnum(binding)]) {
            .parameter => |p| try self.observe(p.function, p.index, value),
            .local => { if (try self.captured_values[@intFromEnum(binding)].join(self.c, value)) self.dirty = true; }, .none => {},
        }
    }
    pub fn fieldRoot(self: *Domain, ref: t.FieldRef) Error!usize {
        var index: usize = @intFromEnum(ref); while (true) { try self.c.step(); const next = self.fields[index].parent; if (next == index) return index; index = next; }
    }
    pub fn fieldWrite(self: *Domain, ref: t.FieldRef, value: Value) Error!void {
        const key = try self.fieldRoot(ref); const observed = value orelse Codes{ .top = true };
        if (self.fields[key].callable and try self.fields[key].value.join(self.c, observed)) self.dirty = true;
        if (value != null or try self.mayCallable(self.common.members.fields[@intFromEnum(ref)].@"type", false)) {
            if (try self.fields[key].captured.join(self.c, observed)) self.dirty = true;
            if (self.fields[key].exposed) try self.exposeClosures(observed);
        }
    }
    fn familiesInto(self: *Domain, id: t.TypeRef, seen: *std.AutoHashMapUnmanaged(t.TypeRef, void), out: *std.AutoHashMapUnmanaged(usize, void)) Error!void {
        try self.c.step(); const index = @intFromEnum(id); if ((try seen.getOrPut(self.c.allocator, id)).found_existing) return;
        if (self.arrays[index].parent != null) { try out.put(self.c.allocator, try self.arrayRoot(index), {}); return; }
        const row = self.common.types[index]; if (row.kind == .@"union") { for (row.members) |child| try self.familiesInto(child, seen, out); }
    }
    pub fn families(self: *Domain, id: t.TypeRef) Error!std.AutoHashMapUnmanaged(usize, void) {
        var seen: std.AutoHashMapUnmanaged(t.TypeRef, void) = .empty; defer seen.deinit(self.c.allocator);
        var result: std.AutoHashMapUnmanaged(usize, void) = .empty; errdefer result.deinit(self.c.allocator);
        try self.familiesInto(id, &seen, &result); return result;
    }
    pub fn arrayRoot(self: *Domain, index: usize) Error!usize {
        var current = index; while (true) { try self.c.step(); const next = self.arrays[current].parent orelse return error.InvalidShape; if (next == current) return current; current = next; }
    }
    pub fn linkArrays(self: *Domain, from: t.TypeRef, to: t.TypeRef) Error!void {
        var left = try self.families(from); defer left.deinit(self.c.allocator); var right = try self.families(to); defer right.deinit(self.c.allocator);
        var a = left.keyIterator(); while (a.next()) |x| { var b = right.keyIterator(); while (b.next()) |y| {
            try self.c.step(); const first = try self.arrayRoot(x.*); const second = try self.arrayRoot(y.*); if (first == second) continue;
            const first_exposed = self.arrays[first].exposed; const second_exposed = self.arrays[second].exposed;
            var pending: Codes = .{}; defer pending.deinit(self.c.allocator);
            if (first_exposed and !second_exposed) _ = try pending.join(self.c, self.arrays[second].captured);
            if (second_exposed and !first_exposed) _ = try pending.join(self.c, self.arrays[first].captured);
            self.arrays[first].parent = second; self.arrays[second].exposed = first_exposed or second_exposed;
            self.arrays[second].unsafe = self.arrays[second].unsafe or self.arrays[first].unsafe;
            self.arrays[second].missing = self.arrays[second].missing or self.arrays[first].missing;
            if (self.arrays[first].minimum) |n| { self.arrays[second].minimum = if (self.arrays[second].minimum) |old| @min(n, old) else n; }
            _ = try self.arrays[second].value.join(self.c, self.arrays[first].value);
            _ = try self.arrays[second].captured.join(self.c, self.arrays[first].captured); self.dirty = true;
            if (pending.top or pending.functions.count() != 0) try self.exposeClosures(pending);
        } }
    }
    pub fn mayCallable(self: *Domain, id: t.TypeRef, element: bool) Error!bool {
        try self.c.step(); const row = self.common.types[@intFromEnum(id)];
        if (!element and row.kind == .function) return true;
        if (row.kind == .@"union") { for (row.members) |member| if (try self.mayCallable(member, element)) return true; }
        else if (element and (row.kind == .array or row.kind == .readSpan)) return self.mayCallable(row.element.?, false);
        return false;
    }
    pub fn arrayWrite(self: *Domain, id: t.TypeRef, value: Value) Error!void {
        const observes = value != null or try self.mayCallable(id, true); const observed = value orelse Codes{ .top = true };
        var keys = try self.families(id); defer keys.deinit(self.c.allocator); var it = keys.keyIterator();
        while (it.next()) |key| { try self.c.step(); if (try self.arrays[key.*].value.join(self.c, observed)) self.dirty = true;
            if (observes) { if (try self.arrays[key.*].captured.join(self.c, observed)) self.dirty = true; if (self.arrays[key.*].exposed) try self.exposeClosures(observed); }
        }
    }
    pub fn arrayRead(self: *Domain, id: t.TypeRef) Error!Codes {
        var result: Codes = .{}; errdefer result.deinit(self.c.allocator); var keys = try self.families(id); defer keys.deinit(self.c.allocator);
        if (keys.count() == 0) result.top = true;
        var it = keys.keyIterator(); while (it.next()) |key| { try self.c.step(); _ = try result.join(self.c, self.arrays[key.*].value); result.top = result.top or self.arrays[key.*].exposed or self.arrays[key.*].missing; }
        return result;
    }
    pub fn birth(self: *Domain, id: t.TypeRef, count: usize) Error!void {
        var keys = try self.families(id); defer keys.deinit(self.c.allocator); var it = keys.keyIterator();
        while (it.next()) |key| { try self.c.step(); self.arrays[key.*].minimum = if (self.arrays[key.*].minimum) |n| @min(n, count) else count; }
    }
    pub fn cancel(self: *Domain, id: t.TypeRef) Error!void {
        var keys = try self.families(id); defer keys.deinit(self.c.allocator); var it = keys.keyIterator(); while (it.next()) |key| { try self.c.step(); self.arrays[key.*].unsafe = true; }
    }
    pub fn exposeArray(self: *Domain, id: t.TypeRef) Error!void {
        var keys = try self.families(id); defer keys.deinit(self.c.allocator); var it = keys.keyIterator();
        while (it.next()) |key| { try self.c.step(); self.arrays[key.*].unsafe = true; if (self.arrays[key.*].exposed) continue;
            self.arrays[key.*].exposed = true; self.dirty = true; try self.exposeClosures(self.arrays[key.*].captured);
        }
    }
    pub fn expose(self: *Domain, id: t.TypeRef) Error!void {
        try self.c.step(); const index = @intFromEnum(id); if (self.exposed[index]) return; self.exposed[index] = true;
        const row = self.common.types[index];
        switch (row.kind) {
            .@"union" => { for (row.members) |member| try self.expose(member); },
            .array, .readSpan => { try self.exposeArray(id); try self.expose(row.element.?); },
            .function => { for (row.members) |member| try self.expose(member); try self.expose(row.element.?); },
            .reference, .value => {
                var owner: ?t.TypeRef = id;
                while (owner) |ref| { try self.c.step(); for (self.common.members.fields, 0..) |field, f| { try self.c.step(); if (field.owner != ref) continue;
                    const key = try self.fieldRoot(@enumFromInt(f)); if (!self.fields[key].exposed) { self.fields[key].exposed = true; try self.exposeClosures(self.fields[key].captured); }
                    if (self.fields[key].callable and try self.fields[key].value.join(self.c, .{ .top = true })) self.dirty = true;
                    try self.expose(field.@"type");
                } owner = self.common.types[@intFromEnum(ref)].base; }
                for (self.common.types, 0..) |child, i| { try self.c.step(); if (child.base == id) try self.expose(@enumFromInt(i)); }
            },
            else => {},
        }
    }
    pub fn exposeClosures(self: *Domain, value: Codes) Error!void {
        try self.c.step(); if (!value.top and value.functions.count() == 0) return;
        // Exposure can grow the shared capture rows; iterate an owned Codes
        // copy rather than invalidate an iterator into one of those rows.
        var observed = try Codes.clone(self.c, value); defer observed.deinit(self.c.allocator);
        var seen: std.AutoHashMapUnmanaged(t.FunctionRef, void) = .empty; defer seen.deinit(self.c.allocator);
        var pending: std.ArrayListUnmanaged(t.FunctionRef) = .empty; defer pending.deinit(self.c.allocator);
        if (observed.top) { for (self.bounds, 0..) |bound, i| { try self.c.step(); if (bound.contract != null) { try seen.put(self.c.allocator, @enumFromInt(i), {}); try pending.append(self.c.allocator, @enumFromInt(i)); } } }
        else { var it = observed.functions.keyIterator(); while (it.next()) |code| { try self.c.step(); try seen.put(self.c.allocator, code.*, {}); try pending.append(self.c.allocator, code.*); } }
        var cursor: usize = 0;
        while (cursor < pending.items.len) : (cursor += 1) {
            try self.c.step(); const ordinal = self.closure_rows[@intFromEnum(pending.items[cursor])] orelse return error.InvalidShape;
            for (self.common.closures.functions[ordinal].captures) |capture| {
                try self.c.step(); const slot = self.common.closures.environments[@intFromEnum(capture.environment)].slots[@intFromEnum(capture.slot)];
                try self.expose(slot.@"type"); if (!try self.callable(slot.@"type")) continue;
                for (self.bounds, 0..) |bound, i| { try self.c.step(); if (bound.contract == null) continue; const code: t.FunctionRef = @enumFromInt(i); if ((try seen.getOrPut(self.c.allocator, code)).found_existing) continue; try pending.append(self.c.allocator, code); }
            }
        }
    }
    fn verified(self: *Domain, from: t.TypeRef, to: t.TypeRef, witnesses: bool, seen: *std.AutoHashMapUnmanaged(Pair, void)) Error!bool {
        try self.c.step(); if (from == to) return true;
        const key = Pair{ .from = from, .to = to }; const entry = try seen.getOrPut(self.c.allocator, key); if (entry.found_existing) return false; defer _ = seen.remove(key);
        const a = self.common.types[@intFromEnum(from)]; const b = self.common.types[@intFromEnum(to)];
        if (a.kind == .@"union") { for (a.members) |child| { try self.c.step(); const kind = self.common.types[@intFromEnum(child)].kind;
            if (kind != .@"null" and kind != .@"undefined" and !try self.verified(child, to, witnesses, seen)) return false; } return true;
        }
        if (b.kind == .@"union") { for (b.members) |child| if (try self.verified(from, child, witnesses, seen)) return true; return false; }
        if ((a.kind == .array or a.kind == .readSpan) and (b.kind == .array or b.kind == .readSpan)) return self.verified(a.element.?, b.element.?, witnesses, seen);
        if (witnesses) { for (self.common.views.compatibility) |row| { try self.c.step(); if (row.source_type == from and row.target_type == to) return true; } }
        return false;
    }
    pub fn erase(self: *Domain, expected: ?t.TypeRef, actual: ?t.TypeRef, value: Value, assertion: bool) Error!void {
        try self.c.step(); const a = actual orelse return; const e = expected orelse return;
        if (self.common.types[@intFromEnum(e)].kind == .unknown) { try self.expose(a); if (value) |codes| try self.exposeClosures(codes); return; }
        var seen: std.AutoHashMapUnmanaged(Pair, void) = .empty; defer seen.deinit(self.c.allocator);
        if (assertion) { if (try self.verified(a, e, true, &seen)) try self.linkArrays(a, e) else { try self.expose(a); try self.expose(e); if (value) |codes| try self.exposeClosures(codes); } return; }
        var left = try self.families(a); defer left.deinit(self.c.allocator); var right = try self.families(e); defer right.deinit(self.c.allocator);
        if (left.count() != 0 and right.count() != 0) { if (try self.verified(a, e, false, &seen)) try self.linkArrays(a, e) else { try self.expose(a); try self.expose(e); } }
    }
    fn unknownArrays(self: *Domain, id: t.TypeRef, seen: *std.AutoHashMapUnmanaged(t.TypeRef, void)) Error!void {
        try self.c.step(); if ((try seen.getOrPut(self.c.allocator, id)).found_existing) return; const row = self.common.types[@intFromEnum(id)];
        switch (row.kind) {
            .array, .readSpan => try self.expose(id),
            .@"union" => { for (row.members) |member| try self.unknownArrays(member, seen); },
            .reference, .value => { for (self.common.members.fields) |field| { try self.c.step(); if (field.owner == id) try self.unknownArrays(field.@"type", seen); } if (row.base) |base| try self.unknownArrays(base, seen); },
            else => {},
        }
    }
    pub fn complete(self: *Domain) Error!bool {
        var missing = false;
        for (self.common.members.fields, 0..) |_, i| { try self.c.step(); const key = try self.fieldRoot(@enumFromInt(i)); if (!self.fields[key].callable) continue;
            if (!self.fields[key].value.top and self.fields[key].value.functions.count() == 0) { _ = try self.fields[key].value.join(self.c, .{ .top = true }); self.dirty = true; missing = true; }
        }
        for (self.arrays, 0..) |row, i| { try self.c.step(); if (row.parent == null) continue; const element = self.common.types[@intFromEnum(self.common.types[i].element.?)]; if (element.kind != .function) continue;
            const key = try self.arrayRoot(i); if (!self.arrays[key].value.top and self.arrays[key].value.functions.count() == 0 and !self.arrays[key].missing) { self.arrays[key].missing = true; self.dirty = true; missing = true; }
        }
        return missing;
    }
    pub fn discharge(self: *Domain) Error!void {
        for (self.bounds) |bound| { try self.c.step(); if (bound.contract == null) continue;
            for (bound.parameters, bound.observations) |upper, body| try self.c.require(try Codes.subset(self.c, body, upper));
            if (bound.result_observed) |body| try self.c.require(try Codes.subset(self.c, body, bound.returned.?));
        }
    }

    pub fn init(c: *Context) Error!Domain {
        const common = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
        var self = Domain{ .c = c, .common = common }; errdefer self.deinit(); const a = c.allocator;
        try c.charge(c.program.functions.len * 3 + common.storage.bindings.len * 2 + common.types.len * 2 + common.members.fields.len);
        self.bounds = try a.alloc(Bound, c.program.functions.len); @memset(self.bounds, .{});
        self.closure_rows = try a.alloc(?usize, c.program.functions.len); @memset(self.closure_rows, null);
        self.external = try a.alloc(bool, c.program.functions.len); @memset(self.external, false);
        self.captures = try a.alloc(Capture, common.storage.bindings.len); @memset(self.captures, .none);
        self.captured_values = try a.alloc(Codes, common.storage.bindings.len); @memset(self.captured_values, .{});
        self.exposed = try a.alloc(bool, common.types.len); @memset(self.exposed, false);
        self.arrays = try a.alloc(Array, common.types.len); @memset(self.arrays, .{});
        self.fields = try a.alloc(Field, common.members.fields.len); @memset(self.fields, .{});
        for (c.program.functions, 0..) |function, i| { try c.step(); try self.functions.put(a, function.id, @enumFromInt(i)); }
        for (common.types, 0..) |row, i| { try c.step(); if (row.kind == .array or row.kind == .readSpan) self.arrays[i].parent = i; }
        for (common.members.fields, 0..) |_, i| self.fields[i].parent = i;
        for (common.closures.functions, 0..) |row, i| { try c.step(); self.closure_rows[@intFromEnum(row.function)] = i;
            for (row.captures) |capture| { try c.step(); const slot = common.closures.environments[@intFromEnum(capture.environment)].slots[@intFromEnum(capture.slot)]; if (try self.callable(slot.@"type")) self.captures[@intFromEnum(slot.binding)] = .local; }
        }
        for (common.authority.fixed_publication.publication.contracts, 0..) |row, i| {
            try c.step(); const code = self.functions.get(row.function_id) orelse return error.InvalidReference; const bound = &self.bounds[@intFromEnum(code)]; bound.contract = i;
            const params = self.abi(code).parameters; try c.charge(params.len * 2); bound.parameters = try a.alloc(Codes, params.len); @memset(bound.parameters, .{});
            bound.observations = try a.alloc(Codes, params.len); @memset(bound.observations, .{});
            for (row.callables.parameters) |parameter| { try c.step(); bound.parameters[parameter.index] = try self.readCodes(parameter.allowed); }
            if (row.callables.returns) |returned| { bound.returned = try self.readCodes(returned); bound.result_observed = Codes{}; }
            for (params, 0..) |binding, index| { try c.step(); if (self.captures[@intFromEnum(binding)] != .none) self.captures[@intFromEnum(binding)] = .{ .parameter = .{ .function = code, .index = index } }; }
        }
        for (common.types, 0..) |row, i| { try c.step(); if (row.kind == .@"union") { for (row.members) |member| { try c.step(); try self.linkArrays(@enumFromInt(i), member); } } }
        for (common.views.compatibility) |row| { for (row.fields) |pair| { try c.step(); const from = pair.actual orelse continue; if (from != .field or pair.target != .field) continue;
            const first = try self.fieldRoot(from.field); const second = try self.fieldRoot(pair.target.field); if (first != second) self.fields[first].parent = second;
            try self.linkArrays(common.members.fields[@intFromEnum(from.field)].@"type", common.members.fields[@intFromEnum(pair.target.field)].@"type");
        } }
        for (common.members.fields, 0..) |field, i| { try c.step(); if (try self.callable(field.@"type")) self.fields[try self.fieldRoot(@enumFromInt(i))].callable = true; }
        for (common.modules.roots.roots) |root| { try c.step(); if (root.kind == .@"module-initialization") continue;
            const id = self.functions.get(root.target) orelse return error.InvalidReference; self.external[@intFromEnum(id)] = true;
            for (self.abi(id).parameters, 0..) |binding, index| { try c.step(); const param_type = common.storage.bindings[@intFromEnum(binding)].@"type";
                if (try self.callable(param_type)) try self.observe(id, index, .{ .top = true }); try self.expose(param_type);
            }
            if (self.abi(id).result) |returned| try self.expose(returned);
        }
        var seen: std.AutoHashMapUnmanaged(t.TypeRef, void) = .empty; defer seen.deinit(a);
        for (self.bounds, 0..) |bound, i| { try c.step(); if (bound.contract == null) continue; for (self.abi(@enumFromInt(i)).parameters) |binding| { try c.step(); seen.clearRetainingCapacity(); try self.unknownArrays(common.storage.bindings[@intFromEnum(binding)].@"type", &seen); } }
        for (common.modules.globals) |global| { try c.step(); seen.clearRetainingCapacity(); try self.unknownArrays(global.@"type", &seen); }
        for (common.modules.modules) |module| { for (module.exports) |exported| { try c.step(); if (exported.kind != .global) continue; for (common.modules.globals) |global| { try c.step(); if (std.mem.eql(u8, &exported.target, &global.id)) try self.expose(global.@"type"); } } }
        return self;
    }
};
