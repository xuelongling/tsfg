// SPDX-License-Identifier: MIT
// Symbolic inputs of the existing lexical OWNER transfer, not actual Env IDs.
// An input denotes this invocation's hidden Env and its typed parent chain.
// Unknown callable inputs never acquire a code/env pair. A birth denotes
// only the current definition: rebirth ages every retained reference to it.
// No solver, Source interpreter, execution handle or permission is defined.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

pub const Origin = struct {
    layout: t.EnvironmentRef,
    source: union(enum) { input: void, birth: t.RegisterRef },
};
pub const Set = struct {
    unknown: bool = false,
    items: std.ArrayListUnmanaged(Origin) = .empty,
    pub fn deinit(self: *Set, allocator: std.mem.Allocator) void { self.items.deinit(allocator); self.* = .{}; }
    pub fn add(self: *Set, c: *Context, origin: Origin) Error!bool {
        for (self.items.items) |old| { try c.step(); if (std.meta.eql(old, origin)) return false; }
        try c.step(); try self.items.append(c.allocator, origin); return true;
    }
    pub fn clone(c: *Context, source: *const Set) Error!Set {
        try c.charge(source.items.items.len + 1); var result = Set{ .unknown = source.unknown };
        errdefer result.deinit(c.allocator); try result.items.appendSlice(c.allocator, source.items.items); return result;
    }
    pub fn join(self: *Set, c: *Context, incoming: *const Set) Error!bool {
        try c.step(); var changed = incoming.unknown and !self.unknown; self.unknown = self.unknown or incoming.unknown;
        for (incoming.items.items) |origin| changed = (try self.add(c, origin)) or changed;
        return changed;
    }
    pub fn age(self: *Set, c: *Context, handle: t.RegisterRef) Error!void {
        var index: usize = 0;
        while (index < self.items.items.len) {
            try c.step(); const origin = self.items.items[index];
            if (origin.source == .birth and origin.source.birth == handle) {
                _ = self.items.swapRemove(index); self.unknown = true;
            } else index += 1;
        }
    }
};

// Callable code/env associations are independent of declared target tables.
// Missing or unknown associations never remove a permitted call arm.
pub const Value = struct {
    direct: Set = .{},
    callable_unknown: bool = false,
    callables: std.AutoHashMapUnmanaged(t.FunctionRef, Set) = .empty,
    pub fn deinit(self: *Value, allocator: std.mem.Allocator) void {
        self.direct.deinit(allocator);
        var entries = self.callables.valueIterator(); while (entries.next()) |value| value.deinit(allocator);
        self.callables.deinit(allocator); self.* = .{};
    }
    pub fn clone(c: *Context, source: *const Value) Error!Value {
        var result = Value{ .callable_unknown = source.callable_unknown }; errdefer result.deinit(c.allocator);
        result.direct = try Set.clone(c, &source.direct);
        var entries = source.callables.iterator(); while (entries.next()) |entry| {
            try c.step(); var copy = try Set.clone(c, entry.value_ptr); errdefer copy.deinit(c.allocator);
            try result.callables.put(c.allocator, entry.key_ptr.*, copy);
        }
        return result;
    }
    pub fn join(self: *Value, c: *Context, incoming: *const Value) Error!bool {
        var changed = try self.direct.join(c, &incoming.direct);
        changed = (incoming.callable_unknown and !self.callable_unknown) or changed;
        self.callable_unknown = self.callable_unknown or incoming.callable_unknown;
        var entries = incoming.callables.iterator(); while (entries.next()) |entry| {
            try c.step(); const destination = try self.callables.getOrPut(c.allocator, entry.key_ptr.*);
            if (!destination.found_existing) { destination.value_ptr.* = .{}; changed = true; }
            changed = (try destination.value_ptr.join(c, entry.value_ptr)) or changed;
        }
        return changed;
    }
    pub fn pair(self: *Value, c: *Context, target: t.FunctionRef, environment: *const Set) Error!void {
        try c.step(); const destination = try self.callables.getOrPut(c.allocator, target);
        if (!destination.found_existing) destination.value_ptr.* = .{};
        _ = try destination.value_ptr.join(c, environment);
    }
    pub fn age(self: *Value, c: *Context, handle: t.RegisterRef) Error!void {
        try self.direct.age(c, handle);
        var entries = self.callables.valueIterator(); while (entries.next()) |value| { try c.step(); try value.age(c, handle); }
    }
};
