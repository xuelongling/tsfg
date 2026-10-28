// SPDX-License-Identifier: MIT
// One owned physical definition per semantic TypeId for the entire heap. Import
// admission and object publication commit only after every clone succeeds.
const std = @import("std");
const element = @import("array-element.zig");
const cells = @import("managed-cell.zig");
const canonical = @import("typed-layout-canonical.zig");
pub const Error = canonical.Error;
const Entry = struct {
    layout: element.Layout,
    cell: ?cells.Layout = null,
    fn deinit(self: Entry, allocator: std.mem.Allocator) void {
        self.layout.deinit(allocator); if (self.cell) |value| value.deinit(allocator);
    }
};
fn measure(layout: element.Layout, remaining: *usize) Error!void {
    var cost: usize = 1;
    for (layout.variants) |variant| cost += 1 + variant.fields.len + variant.references.len + variant.children.len;
    if (cost > remaining.*) return error.LayoutLimit;
    remaining.* -= cost;
    for (layout.variants) |variant| for (variant.children) |child| try measure(child.layout.*, remaining);
}
pub const Registry = struct {
    entries: std.ArrayList(Entry) = .empty,
    // Canonical semantic entries remain unchanged. Each actual class admits one
    // fixed whole-module backing contract, cloned independently of its reader.
    backings: std.ArrayList(cells.Layout) = .empty,
    array_backings: std.ArrayList(struct { type_id: [32]u8, layout: element.Layout }) = .empty,
    pub fn deinit(self: *Registry, allocator: std.mem.Allocator) void {
        for (self.entries.items) |entry| entry.deinit(allocator);
        self.entries.deinit(allocator);
        for (self.backings.items) |value| value.deinit(allocator);
        self.backings.deinit(allocator);
        for (self.array_backings.items) |value| value.layout.deinit(allocator);
        self.array_backings.deinit(allocator);
    }
    pub fn admitArrayBacking(self: *Registry, allocator: std.mem.Allocator, id: [32]u8, member: [32]u8, backing: element.Layout) Error!void {
        const entry = self.entries.items[self.index(id) orelse return error.TypeMismatch];
        const variant = try entry.layout.selectVariant(0);
        if (entry.cell != null or variant.references.len != 1 or variant.references[0].type != .array or
            !std.mem.eql(u8, &variant.references[0].type.array, &member)) return error.TypeMismatch;
        try backing.validate(); var work: usize = 100000; try measure(backing, &work);
        for (self.array_backings.items) |prior| if (std.mem.eql(u8, &prior.type_id, &id)) {
            if (!prior.layout.same(backing)) return error.TypeMismatch;
            return;
        };
        if (self.array_backings.items.len == 4096) return error.LayoutLimit;
        const owned = try backing.clone(allocator); errdefer owned.deinit(allocator);
        try self.array_backings.append(allocator, .{ .type_id = id, .layout = owned });
    }
    pub fn admitBacking(self: *Registry, allocator: std.mem.Allocator, declared: cells.Layout, backing: cells.Layout) Error!void {
        const entry = self.entries.items[self.index(declared.type_id) orelse return error.TypeMismatch];
        if (entry.cell == null or !entry.cell.?.same(declared) or
            !std.mem.eql(u8, &declared.type_id, &backing.type_id) or !std.mem.eql(u8, &declared.runtime_key, &backing.runtime_key) or
            declared.kind != .reference or backing.kind != .reference or declared.fields.len != backing.fields.len) return error.TypeMismatch;
        try backing.validate();
        for (declared.fields, backing.fields) |a, b| if (!std.mem.eql(u8, &a.id, &b.id) or a.readonly != b.readonly) return error.TypeMismatch;
        for (self.backings.items) |prior| if (std.mem.eql(u8, &prior.type_id, &backing.type_id)) {
            if (!prior.same(backing)) return error.TypeMismatch;
            return;
        };
        if (self.backings.items.len == 4096) return error.LayoutLimit;
        var work: usize = 100000; for (backing.fields) |field| try measure(field.layout, &work);
        const owned = try backing.clone(allocator); errdefer owned.deinit(allocator);
        try self.backings.append(allocator, owned);
    }
    fn index(self: Registry, id: [32]u8) ?usize {
        for (self.entries.items, 0..) |entry, i| if (std.mem.eql(u8, &entry.layout.type_id, &id)) return i;
        return null;
    }
    fn collect(allocator: std.mem.Allocator, proposals: *std.ArrayList(Entry), layout: element.Layout, cell: ?cells.Layout) Error!void {
        for (proposals.items) |*entry| if (std.mem.eql(u8, &entry.layout.type_id, &layout.type_id)) {
            if (!entry.layout.same(layout)) return error.TypeMismatch;
            if (cell) |value| {
                if (entry.cell) |prior| { if (!prior.same(value)) return error.TypeMismatch; }
                entry.cell = value;
            }
            return;
        };
        if (proposals.items.len == 4096) return error.LayoutLimit;
        try proposals.append(allocator, .{ .layout = layout, .cell = cell });
        for (layout.variants) |variant| for (variant.children) |child| try collect(allocator, proposals, child.layout.*, null);
        if (cell) |value| for (value.fields) |field| try collect(allocator, proposals, field.layout, null);
    }
    fn commit(self: *Registry, allocator: std.mem.Allocator, proposals: []const Entry) Error!void {
        const Change = struct { index: ?usize, entry: Entry };
        var changes: std.ArrayList(Change) = .empty;
        defer changes.deinit(allocator);
        var committed = false;
        var clone_work: usize = 100000;
        var new_entries: usize = 0;
        defer if (!committed) { for (changes.items) |change| change.entry.deinit(allocator); };
        for (proposals) |proposal| {
            const at = self.index(proposal.layout.type_id);
            if (at) |i| {
                const prior = self.entries.items[i];
                if (!prior.layout.same(proposal.layout)) return error.TypeMismatch;
                if (prior.cell) |cell| { if (proposal.cell) |value| { if (!cell.same(value)) return error.TypeMismatch; } continue; }
                if (proposal.cell == null) continue;
            }
            if (at == null) new_entries += 1;
            try measure(proposal.layout, &clone_work);
            if (proposal.cell) |cell| for (cell.fields) |field| try measure(field.layout, &clone_work);
            const layout = try proposal.layout.clone(allocator);
            errdefer layout.deinit(allocator);
            const cell = if (proposal.cell) |value| try value.clone(allocator) else null;
            errdefer if (cell) |value| value.deinit(allocator);
            try changes.append(allocator, .{ .index = at, .entry = .{ .layout = layout, .cell = cell } });
        }
        if (self.entries.items.len + new_entries > 4096) return error.LayoutLimit;
        try self.entries.ensureUnusedCapacity(allocator, new_entries);
        for (changes.items) |change| {
            if (change.index) |i| { self.entries.items[i].deinit(allocator); self.entries.items[i] = change.entry; }
            else self.entries.appendAssumeCapacity(change.entry);
        }
        committed = true;
    }
    pub fn admitLayout(self: *Registry, allocator: std.mem.Allocator, layout: element.Layout) Error!void {
        try layout.validate();
        var proposals: std.ArrayList(Entry) = .empty; defer proposals.deinit(allocator);
        try collect(allocator, &proposals, layout, null); try self.commit(allocator, proposals.items);
    }
    pub fn admitCell(self: *Registry, allocator: std.mem.Allocator, cell: cells.Layout) Error!void {
        try cell.validate();
        var proposals: std.ArrayList(Entry) = .empty; defer proposals.deinit(allocator);
        const root = try cell.elementLayout(allocator); defer root.deinit(allocator);
        try collect(allocator, &proposals, root, cell); try self.commit(allocator, proposals.items);
    }
    pub fn admitModule(self: *Registry, allocator: std.mem.Allocator, module: canonical.Module) Error!void {
        var proposals: std.ArrayList(Entry) = .empty; defer proposals.deinit(allocator);
        for (module.entries) |entry| {
            try entry.layout.validate();
            if (!std.mem.eql(u8, &entry.type_id, &entry.layout.type_id)) return error.TypeMismatch;
            if (entry.cell) |cell| {
                try cell.validate();
                if (!std.mem.eql(u8, &entry.type_id, &cell.type_id)) return error.TypeMismatch;
            }
            try collect(allocator, &proposals, entry.layout, entry.cell);
        }
        try self.commit(allocator, proposals.items);
    }
};
