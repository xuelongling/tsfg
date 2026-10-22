// SPDX-License-Identifier: MIT
// Bounded development access plans. Offsets always come from the actual cell.
const std = @import("std");
const canonical = @import("typed-layout-canonical.zig");
const cells = @import("managed-cell.zig");
pub const Error = canonical.Error || error{InvalidViewModule, MissingView, InvalidViewMember};
pub const Id = [32]u8;
pub const Pair = struct { source: Id, target: Id };
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
    pub fn deinit(self: *Module) void { self.layouts.deinit(); self.arena.deinit(); self.* = undefined; }
    pub fn view(self: Module, actual: cells.Layout, target: Id) Error!View {
        const entry = try self.layouts.find(actual.type_id);
        if (entry.cell == null or !entry.cell.?.same(actual)) return error.InvalidViewModule;
        for (self.views) |value| if (same(value.actual, actual.type_id) and same(value.target, target)) return value;
        return error.MissingView;
    }
    pub fn field(self: Module, actual: cells.Layout, target: Id, member: Id) Error!Id {
        for ((try self.view(actual, target)).fields) |pair| if (same(pair.target, member)) return pair.source;
        return error.InvalidViewMember;
    }
    pub fn method(self: Module, actual: cells.Layout, target: Id, member: Id) Error!Method {
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
    fn pairs(self: *Reader) Error![]Pair {
        const count = try self.word(); if (count > 256) return error.LayoutLimit;
        const result = try self.allocator.alloc(Pair, count);
        for (result, 0..) |*pair, i| {
            pair.* = .{ .source = try self.id(), .target = try self.id() };
            if (i != 0 and std.mem.order(u8, &result[i - 1].target, &pair.target) != .lt) return error.InvalidViewModule;
        }
        return result;
    }
};
pub fn load(allocator: std.mem.Allocator, bytes: []const u8) Error!Module {
    if (bytes.len > 2097152) return error.LayoutLimit;
    var arena = std.heap.ArenaAllocator.init(allocator); errdefer arena.deinit();
    var reader = Reader{ .bytes = bytes, .allocator = arena.allocator() };
    if (!std.mem.eql(u8, try reader.take(8), "TSGVIEW1")) return error.InvalidViewModule;
    const identity = try reader.id();
    const size = std.mem.readInt(u32, (try reader.take(4))[0..4], .little);
    var layouts = try canonical.load(allocator, try reader.take(size)); errdefer layouts.deinit();
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
    const lookup = Module{ .arena = undefined, .layouts = layouts, .input_identity = identity, .methods = methods, .views = views };
    for (methods) |method| if (method.override_target) |id| {
        const prior = try lookup.findMethod(id);
        const base = (try layouts.find(method.owner)).base orelse return error.InvalidViewModule;
        if (!try lookup.ancestor(base, prior.owner, &reader.work)) return error.InvalidViewModule;
    };
    for (views, 0..) |*view, i| {
        view.* = .{ .actual = try reader.id(), .target = try reader.id(), .fields = try reader.pairs(), .methods = try reader.pairs() };
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
            _ = try actual.fieldIndex(pair.source); _ = try target.fieldIndex(pair.target);
        }
        var expected_methods: usize = 0;
        for (methods) |method| if (try lookup.effective(target.type_id, method.id, &reader.work)) { expected_methods += 1; };
        if (view.methods.len != expected_methods) return error.InvalidViewModule;
        for (view.methods) |pair| if (!try lookup.effective(actual.type_id, pair.source, &reader.work) or
            !try lookup.effective(target.type_id, pair.target, &reader.work)) return error.InvalidViewModule;
    }
    if (reader.at != bytes.len) return error.InvalidViewModule;
    return .{ .arena = arena, .layouts = layouts, .input_identity = identity, .methods = methods, .views = views };
}
