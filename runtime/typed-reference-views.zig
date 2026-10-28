// SPDX-License-Identifier: MIT
// Bounded development access plans. Offsets always come from the actual cell.
const std = @import("std");
const canonical = @import("typed-layout-canonical.zig");
const cells = @import("managed-cell.zig");
const element = @import("array-element.zig");
pub const Error = canonical.Error || error{InvalidViewModule, MissingView, InvalidViewMember};
pub const Id = [32]u8;
pub const Pair = struct { source: Id, target: Id, missing: bool = false };
pub const Declaration = struct { owner: Id, id: Id, name: []const u8, read_type: Id, declared_type: Id, optional: bool };
pub const FieldSelection = union(enum) { actual: Id, missing };
pub const Method = struct { id: Id, owner: Id, signature: Id, override_target: ?Id = null };
pub const View = struct { actual: Id, target: Id, fields: []Pair, methods: []Pair };
fn same(a: Id, b: Id) bool { return std.mem.eql(u8, &a, &b); }
fn spend(work: *usize, amount: usize) Error!void { if (amount > work.*) return error.LayoutLimit; work.* -= amount; }
pub const Module = struct {
    arena: std.heap.ArenaAllocator,
    layouts: canonical.Module,
    input_identity: Id,
    methods: []Method,
    views: []View,
    declarations: []const Declaration = &.{},
    pub fn deinit(self: *Module) void { self.layouts.deinit(); self.arena.deinit(); self.* = undefined; }
    pub fn readonly(self: Module, target: Id, member: Id) Error!bool {
        const value = (try self.layouts.find(target)).cell orelse return error.InvalidViewModule;
        return value.fields[try value.fieldIndex(member)].readonly;
    }
    pub fn view(self: Module, actual: cells.Layout, target: Id) Error!View {
        const entry = try self.layouts.find(actual.type_id);
        if (entry.cell == null or !entry.cell.?.same(actual)) return error.InvalidViewModule;
        for (self.views) |value| if (same(value.actual, actual.type_id) and same(value.target, target)) return value;
        return error.MissingView;
    }
    pub fn field(self: Module, actual: cells.Layout, target: Id, member: Id) Error!Id {
        return switch (try self.resolveField(actual, target, member)) { .actual => |id| id, .missing => error.InvalidViewMember };
    }
    pub fn resolveField(self: Module, actual: cells.Layout, target: Id, member: Id) Error!FieldSelection {
        if (same(actual.type_id, target)) {
            const entry = (try self.layouts.find(target)).cell orelse return error.InvalidViewModule;
            if (!entry.same(actual)) return error.InvalidViewModule;
            _ = try actual.fieldIndex(member); return .{ .actual = member };
        }
        for ((try self.view(actual, target)).fields) |pair| if (same(pair.target, member)) {
            return if (pair.missing) .missing else .{ .actual = pair.source };
        };
        return error.InvalidViewMember;
    }
    pub fn declaredType(self: Module, target: Id, member: Id) Error!Id {
        const entry = (try self.layouts.find(target)).cell orelse return error.InvalidViewModule;
        const field_value = entry.fields[try entry.fieldIndex(member)];
        return if (self.declarations.len != 0) (try self.declaration(member)).declared_type else field_value.layout.type_id;
    }
    fn declaration(self: Module, id: Id) Error!Declaration {
        for (self.declarations) |value| if (same(value.id, id)) return value;
        return error.InvalidViewModule;
    }
    fn named(self: Module, actual: cells.Layout, name: []const u8, work: *usize) Error!?Id {
        var index = actual.fields.len;
        while (index != 0) { index -= 1; try spend(work, 1 + self.declarations.len);
            const declaration_value = try self.declaration(actual.fields[index].id);
            if (std.mem.eql(u8, declaration_value.name, name)) return declaration_value.id;
        }
        return null;
    }
    pub fn method(self: Module, actual: cells.Layout, target: Id, member: Id) Error!Method {
        if (same(actual.type_id, target)) {
            const entry = (try self.layouts.find(target)).cell orelse return error.InvalidViewModule;
            if (!entry.same(actual)) return error.InvalidViewModule;
            var work: usize = 100000;
            if (!try self.effective(target, member, &work)) return error.InvalidViewMember;
            return self.findMethod(member);
        }
        for ((try self.view(actual, target)).methods) |pair| if (same(pair.target, member)) return self.findMethod(pair.source);
        return error.InvalidViewMember;
    }
    fn findMethod(self: Module, id: Id) Error!Method {
        for (self.methods) |value| if (same(value.id, id)) return value;
        return error.InvalidViewModule;
    }
    fn ancestor(self: Module, actual: Id, target: Id, work: *usize) Error!bool {
        var id: ?Id = actual;
        while (id) |current| {
            try spend(work, 1 + self.layouts.entries.len);
            if (same(current, target)) return true;
            id = (try self.layouts.find(current)).base;
        }
        return false;
    }
    fn effective(self: Module, owner: Id, method_id: Id, work: *usize) Error!bool {
        if (!try self.ancestor(owner, (try self.findMethod(method_id)).owner, work)) return false;
        for (self.methods) |candidate| {
            try spend(work, 1);
            if (!try self.ancestor(owner, candidate.owner, work)) continue;
            var id = candidate.override_target;
            while (id) |current| {
                try spend(work, 1 + self.methods.len);
                if (same(current, method_id)) return false;
                id = (try self.findMethod(current)).override_target;
            }
        }
        return true;
    }
};
const Reader = struct {
    bytes: []const u8, at: usize = 0, work: usize = 100000, allocator: std.mem.Allocator,
    fn take(self: *Reader, n: usize) Error![]const u8 {
        if (n > self.bytes.len - self.at or self.work == 0) return error.InvalidViewModule;
        self.work -= 1; const result = self.bytes[self.at..][0..n]; self.at += n; return result;
    }
    fn word(self: *Reader) Error!u16 { return std.mem.readInt(u16, (try self.take(2))[0..2], .little); }
    fn id(self: *Reader) Error!Id {
        const result: Id = (try self.take(32))[0..32].*;
        if (std.mem.allEqual(u8, &result, 0)) return error.InvalidViewModule;
        return result;
    }
    fn pairs(self: *Reader, presence: bool) Error![]Pair {
        const count = try self.word(); if (count > 256) return error.LayoutLimit;
        const result = try self.allocator.alloc(Pair, count);
        for (result, 0..) |*pair, i| {
            const flag = if (presence) (try self.take(1))[0] else 0;
            if (flag > 1) return error.InvalidViewModule;
            const source = if (flag == 0) try self.id() else [_]u8{0} ** 32;
            pair.* = .{ .source = source, .target = try self.id(), .missing = flag == 1 };
            if (i != 0 and std.mem.order(u8, &result[i - 1].target, &pair.target) != .lt) return error.InvalidViewModule;
        }
        return result;
    }
};
fn undefinedType() Id {
    var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00undefined"); return hash.finalResult();
}
fn leafTypes(layouts: canonical.Module, id: Id, out: *[257]Id, work: *usize) Error!usize {
    try spend(work, 1 + layouts.entries.len);
    const row = try layouts.find(id);
    if (!std.mem.startsWith(u8, row.name, "Union<")) { out[0] = id; return 1; }
    const variants = row.layout.variants; if (variants.len > 256) return error.InvalidViewModule;
    for (variants, 0..) |variant, index| {
        try spend(work, 1);
        out[index] = if (variant.kind == .undefined_value) undefinedType() else if (variant.kind == .null_value) blk: {
            var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.type\x00null"); break :blk hash.finalResult();
        } else if (variant.kind == .value and variant.children.len == 1) variant.children[0].layout.type_id else return error.InvalidViewModule;
    }
    return variants.len;
}
fn readDeclarations(reader: *Reader, layouts: canonical.Module) Error![]const Declaration {
    const count = try reader.word(); const result = try reader.allocator.alloc(Declaration, count);
    for (result, 0..) |*value, index| {
        const owner = try reader.id(); const id = try reader.id(); const name = try reader.allocator.dupe(u8, try reader.take(try reader.word()));
        try spend(&reader.work, name.len);
        if (name.len == 0 or !std.unicode.utf8ValidateSlice(name)) return error.InvalidViewModule;
        const read_type = try reader.id(); const declared_type = try reader.id(); const flag = (try reader.take(1))[0];
        if (flag > 1 or (index != 0 and std.mem.order(u8, &result[index - 1].id, &id) != .lt)) return error.InvalidViewModule;
        var hash = std.crypto.hash.sha2.Sha256.init(.{}); hash.update("tsfg.field\x00sha256:"); hash.update(&std.fmt.bytesToHex(owner, .lower)); hash.update("\x00"); hash.update(name);
        if (!same(hash.finalResult(), id)) return error.InvalidViewModule;
        try spend(&reader.work, 1 + layouts.entries.len);
        const cell = (try layouts.find(owner)).cell orelse return error.InvalidViewModule;
        if (!same(cell.fields[try cell.fieldIndex(id)].layout.type_id, read_type)) return error.InvalidViewModule;
        var actual: [257]Id = undefined; var expected: [257]Id = undefined;
        const actual_count = try leafTypes(layouts, read_type, &actual, &reader.work);
        var expected_count = try leafTypes(layouts, declared_type, &expected, &reader.work);
        if (flag == 1) {
            var found = false; for (expected[0..expected_count]) |member| { try spend(&reader.work, 1); found = found or same(member, undefinedType()); }
            if (!found) { expected[expected_count] = undefinedType(); expected_count += 1; }
        }
        if (actual_count != expected_count) return error.InvalidViewModule;
        for (actual[0..actual_count]) |member| {
            var found = false; for (expected[0..expected_count]) |candidate| { try spend(&reader.work, 1); found = found or same(member, candidate); }
            if (!found) return error.InvalidViewModule;
        }
        value.* = .{ .owner = owner, .id = id, .name = name, .read_type = read_type, .declared_type = declared_type, .optional = flag == 1 };
    }
    // Every real inherited/own slot has one declaration; no omitted name can
    // turn a same-name actual field into a legitimate structural absence.
    for (layouts.entries) |entry| if (entry.cell) |cell| {
        for (cell.fields) |field| {
            var found = false; for (result) |value| { try spend(&reader.work, 1);
                if (same(value.id, field.id)) { if (!same(value.read_type, field.layout.type_id)) return error.InvalidViewModule; found = true; }
            }
            if (!found) return error.InvalidViewModule;
        }
    };
    return result;
}
pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (bytes.len > 2097152) return error.LayoutLimit;
    var arena = std.heap.ArenaAllocator.init(allocator); errdefer arena.deinit();
    var reader = Reader{ .bytes = bytes, .allocator = arena.allocator() };
    const magic = try reader.take(8); const presence = std.mem.eql(u8, magic, "TSGVIEW2");
    if (!presence and !std.mem.eql(u8, magic, "TSGVIEW1")) return error.InvalidViewModule;
    const identity = try reader.id();
    const size = std.mem.readInt(u32, (try reader.take(4))[0..4], .little);
    var layouts = try canonical.load(allocator, try reader.take(size)); errdefer layouts.deinit();
    const declarations = if (presence) try readDeclarations(&reader, layouts) else &.{};
    const method_count = try reader.word(); if (method_count > 4096) return error.LayoutLimit;
    const methods = try reader.allocator.alloc(Method, method_count);
    for (methods, 0..) |*method, i| {
        method.* = .{ .id = try reader.id(), .owner = try reader.id(), .signature = try reader.id() };
        const flag = (try reader.take(1))[0]; if (flag > 1) return error.InvalidViewModule;
        if (flag == 1) method.override_target = try reader.id();
        if (i != 0 and std.mem.order(u8, &methods[i - 1].id, &method.id) != .lt) return error.InvalidViewModule;
        const owner = (try layouts.find(method.owner)).cell orelse return error.InvalidViewModule;
        if (owner.kind != .reference) return error.InvalidViewModule;
    }
    const count = try reader.word(); if (count > 4096) return error.LayoutLimit;
    const views = try reader.allocator.alloc(View, count);
    // Validation borrows the tables; the local arena remains their sole owner
    // until every reader allocation has finished successfully.
    const lookup = Module{ .arena = undefined, .layouts = layouts, .input_identity = identity, .methods = methods, .views = views, .declarations = declarations };
    for (methods) |method| if (method.override_target) |id| {
        const prior = try lookup.findMethod(id);
        const base = (try layouts.find(method.owner)).base orelse return error.InvalidViewModule;
        if (!try lookup.ancestor(base, prior.owner, &reader.work)) return error.InvalidViewModule;
    };
    for (views, 0..) |*view, i| {
        view.* = .{ .actual = try reader.id(), .target = try reader.id(), .fields = try reader.pairs(presence), .methods = try reader.pairs(false) };
        if (i != 0) {
            const order = std.mem.order(u8, &views[i - 1].actual, &view.actual);
            if (order == .gt or (order == .eq and std.mem.order(u8, &views[i - 1].target, &view.target) != .lt)) return error.InvalidViewModule;
        }
        const actual = (try layouts.find(view.actual)).cell orelse return error.InvalidViewModule;
        const target = (try layouts.find(view.target)).cell orelse return error.InvalidViewModule;
        if (actual.kind != .reference or target.kind != .reference or view.fields.len != target.fields.len) return error.InvalidViewModule;
        try spend(&reader.work, 2 * layouts.entries.len);
        for (view.fields) |pair| {
            try spend(&reader.work, actual.fields.len + target.fields.len);
            _ = try target.fieldIndex(pair.target);
            if (pair.missing) {
                const declaration_value = try lookup.declaration(pair.target);
                if (!declaration_value.optional or try lookup.named(actual, declaration_value.name, &reader.work) != null) return error.InvalidViewModule;
            } else {
                _ = try actual.fieldIndex(pair.source);
                if (presence and !std.mem.eql(u8, (try lookup.declaration(pair.source)).name, (try lookup.declaration(pair.target)).name)) return error.InvalidViewModule;
            }
        }
        var expected_methods: usize = 0;
        for (methods) |method| if (try lookup.effective(target.type_id, method.id, &reader.work)) { expected_methods += 1; };
        if (view.methods.len != expected_methods) return error.InvalidViewModule;
        for (view.methods) |pair| if (!try lookup.effective(actual.type_id, pair.source, &reader.work) or
            !try lookup.effective(target.type_id, pair.target, &reader.work)) return error.InvalidViewModule;
    }
    if (reader.at != bytes.len) return error.InvalidViewModule;
    return .{ .arena = arena, .layouts = layouts, .input_identity = identity, .methods = methods, .views = views, .declarations = declarations };
}
