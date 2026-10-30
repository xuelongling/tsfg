// SPDX-License-Identifier: MIT
// Typed publication/Scope shape and directory joins only. No digest is recomputed
// and no declared effect, capability, selected-entry or lifetime claim is granted.
const std = @import("std");
const ctx = @import("wire-program-refcheck-context.zig");
const t = @import("wire-program-types.zig");
const model = @import("wire-program-publication.zig");
const Context = ctx.Context;
const Error = ctx.Error;
const HashSet = std.AutoHashMapUnmanaged(t.Hash, void);
const StringSet = std.StringHashMapUnmanaged(void);
const Policy = enum { any, unique, sorted };
fn bound(c: *Context, length: usize, maximum: usize) Error!void { try c.require(length <= maximum); }
fn build(c: *Context, rows: anytype, comptime key: []const u8, maximum: usize, ordered: bool) Error!HashSet {
    try bound(c, rows.len, maximum); try c.charge(rows.len + 1); var out: HashSet = .{}; errdefer out.deinit(c.allocator); try out.ensureTotalCapacity(c.allocator, @intCast(rows.len));
    var previous: ?t.Hash = null; for (rows) |row| { try c.step(); const id = @field(row, key); if (out.getOrPutAssumeCapacity(id).found_existing) return error.InvalidOrder;
        if (ordered) { if (previous) |p| if (std.mem.order(u8, &p, &id) != .lt) return error.InvalidOrder; previous = id; } }
    return out;
}
fn hashRef(c: *Context, value: t.Hash, directory: *const HashSet) Error!void { try c.step(); if (!directory.contains(value)) return error.InvalidReference; }
fn hashRefs(c: *Context, values: []const t.Hash, directory: *const HashSet, maximum: usize, policy: Policy) Error!void {
    try bound(c, values.len, maximum); var seen: HashSet = .{}; defer seen.deinit(c.allocator); if (policy == .unique) { try c.charge(values.len + 1); try seen.ensureTotalCapacity(c.allocator, @intCast(values.len)); }
    var previous: ?t.Hash = null; for (values) |value| { try hashRef(c, value, directory); if (policy == .sorted) { if (previous) |p| if (std.mem.order(u8, &p, &value) != .lt) return error.InvalidOrder; previous = value; }
        if (policy == .unique) { try c.step(); if (seen.getOrPutAssumeCapacity(value).found_existing) return error.InvalidOrder; } }
}
fn textList(c: *Context, values: []const []const u8, maximum: usize, width: usize, minimum: usize, policy: Policy) Error!void {
    try bound(c, values.len, maximum); var seen: StringSet = .{}; defer seen.deinit(c.allocator); if (policy == .unique) { try c.charge(values.len + 1); try seen.ensureTotalCapacity(c.allocator, @intCast(values.len)); }
    var previous: ?[]const u8 = null; for (values) |value| { try c.text(value, width, minimum); if (policy == .sorted) { if (previous) |p| if (std.mem.order(u8, p, value) != .lt) return error.InvalidOrder; previous = value; }
        if (policy == .unique) { try c.step(); if (seen.getOrPutAssumeCapacity(value).found_existing) return error.InvalidOrder; } }
}
const RootKey = struct { kind: u8, name: []const u8, source_index: ?u16, source_path: []const u8, function: ?u16, target: ?t.Hash };
const RootHash = struct {
    pub fn hash(_: @This(), key: RootKey) u64 {
        var state = std.hash.Wyhash.init(0); state.update(&.{key.kind}); state.update(key.name); state.update("\x00"); state.update(key.source_path); state.update("\x00");
        if (key.source_index) |index| state.update(std.mem.asBytes(&index)); if (key.function) |function| state.update(std.mem.asBytes(&function)); if (key.target) |target| state.update(&target); return state.final();
    }
    pub fn eql(_: @This(), a: RootKey, b: RootKey) bool { return a.kind == b.kind and std.mem.eql(u8, a.name, b.name) and std.mem.eql(u8, a.source_path, b.source_path) and std.meta.eql(a.source_index, b.source_index) and std.meta.eql(a.function, b.function) and std.meta.eql(a.target, b.target); }
};
// Three closed typed root records share their exact tuple-duplicate rule.
// No unknown JSON value or protocol spelling is inspected here.
pub fn roots(c: *Context, rows: anytype) Error!void {
    try bound(c, rows.len, 128); try c.charge(rows.len + 1); var seen: std.HashMapUnmanaged(RootKey, void, RootHash, 80) = .{}; defer seen.deinit(c.allocator); try seen.ensureTotalCapacity(c.allocator, @intCast(rows.len));
    for (rows) |row| { const Row = @TypeOf(row); try c.row(Row); try c.text(row.name, 4096, 1);
        const kind: u8 = if (@typeInfo(@TypeOf(row.kind)) == .int) row.kind else @intFromEnum(row.kind); try c.require(kind <= 5);
        const key: RootKey = .{ .kind = kind, .name = row.name, .source_index = if (@hasField(Row, "source")) @intFromEnum(row.source) else null,
            .source_path = if (@hasField(Row, "source_path")) row.source_path else "", .function = if (@hasField(Row, "function")) @intFromEnum(row.function) else null, .target = if (@hasField(Row, "target")) row.target else null };
        if (@hasField(Row, "source")) { _ = try c.ref(row.source, c.program.tables.sources.len); } else try c.text(row.source_path, 4096, 1);
        if (@hasField(Row, "function")) { _ = try c.ref(row.function, c.program.functions.len); }
        try c.charge(2 + 2 * (key.name.len / 64 + key.source_path.len / 64)); if (seen.getOrPutAssumeCapacity(key).found_existing) return error.InvalidOrder;
    }
}

fn declaration(c: *Context, value: model.DeclarationKey) Error!void { try c.row(@TypeOf(value)); try c.text(value.name, 4096, 1); try c.text(value.source_path, 4096, 1); try textList(c, value.path, 128, 4096, 1, .any); }
fn shape(c: *Context, value: model.ScopeShape, labels: *const StringSet) Error!void {
    const checkLabel = struct { fn run(context: *Context, label: []const u8, set: *const StringSet, empty: bool) Error!void { try context.text(label, 1048576, if (empty) 0 else 1); try context.step(); if ((!empty or label.len != 0) and !set.contains(label)) return error.InvalidReference; } }.run;
    switch (value) {
        .primitive => |v| { try c.row(@TypeOf(v)); try c.text(v.label, 1048576, 1); },
        .function => |v| { try c.row(@TypeOf(v)); try c.text(v.label, 1048576, 1); try bound(c, v.parameters.len, 64); for (v.parameters) |p| try checkLabel(c, p, labels, false); try checkLabel(c, v.return_type, labels, false); },
        .union_type => |v| { try c.row(@TypeOf(v)); try c.text(v.label, 1048576, 1); try c.require(v.members.len >= 2); try textList(c, v.members, 256, 1048576, 1, .unique); for (v.members) |m| { try c.charge(1 + m.len / 64); if (!labels.contains(m)) return error.InvalidReference; } },
        .element => |v| { try c.row(@TypeOf(v)); try c.text(v.label, 1048576, 1); try checkLabel(c, v.element_type, labels, false); },
        .nominal => |v| { try c.row(@TypeOf(v)); try c.text(v.label, 1048576, 1); if (v.base) |base| try checkLabel(c, base, labels, true);
            try bound(c, v.construction.parameters.len, 64); for (v.construction.parameters) |p| try checkLabel(c, p, labels, false); try checkLabel(c, v.construction.return_type, labels, false);
            try bound(c, v.fields.len, 256); for (v.fields) |field| { try c.row(@TypeOf(field)); try c.text(field.name, 4096, 1); try c.require(field.index <= 255); try checkLabel(c, field.@"type", labels, false); }
            if (v.methods) |methods| { try bound(c, methods.len, 4096); for (methods) |method| { try c.row(@TypeOf(method)); try c.text(method.name, 4096, 1); try bound(c, method.parameters.len, 64); for (method.parameters) |p| try checkLabel(c, p, labels, false); try checkLabel(c, method.return_type, labels, false); } }
        },
    }
}
fn scope(c: *Context, value: model.StableScope, functions: *const HashSet, types: *const HashSet, globals: *const HashSet, environments: *const HashSet, modules: *const HashSet, hosts: *const HashSet) Error!void {
    try c.row(@TypeOf(value)); try c.text(value.root_file, 4096, 1); var type_ids = try build(c, value.types, "id", 4096, true); defer type_ids.deinit(c.allocator);
    var function_ids = try build(c, value.functions, "function_id", 4096, true); defer function_ids.deinit(c.allocator); var global_ids = try build(c, value.globals, "global_id", 4096, true); defer global_ids.deinit(c.allocator);
    var environment_ids = try build(c, value.environments, "id", 4096, true); defer environment_ids.deinit(c.allocator); var module_ids = try build(c, value.modules, "id", 128, false); defer module_ids.deinit(c.allocator);
    var host_ids = try build(c, value.host_imports, "id", 128, true); defer host_ids.deinit(c.allocator);
    try c.charge(value.types.len + 1); var labels: StringSet = .{}; defer labels.deinit(c.allocator); try labels.ensureTotalCapacity(c.allocator, @intCast(value.types.len));
    for (value.types) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.id, types); try c.text(row.label, 1048576, 1); if (labels.getOrPutAssumeCapacity(row.label).found_existing) return error.InvalidOrder; }
    for (value.types) |row| { try shape(c, row.shape, &labels); switch (row.shape) { inline else => |v| { try c.charge(1 + row.label.len / 64 + v.label.len / 64); try c.require(std.mem.eql(u8, row.label, v.label)); } } }
    var slot_count: usize = 0; for (value.environments) |env| { try c.step(); try c.require(env.slots.len <= 65536 - slot_count); slot_count += env.slots.len; }
    try c.charge(slot_count + 1); var all_slots: HashSet = .{}; defer all_slots.deinit(c.allocator); try all_slots.ensureTotalCapacity(c.allocator, @intCast(slot_count));
    for (value.environments) |env| for (env.slots) |slot| { try c.step(); _ = all_slots.getOrPutAssumeCapacity(slot.key); };
    if (value.host_context != null) try c.charge(2);
    for (value.functions) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.function_id, functions); try declaration(c, row.decl_key); try hashRefs(c, row.parameter_types, types, 65, .any); try hashRef(c, row.return_type, types);
        if (row.lexical_parent) |parent| try hashRef(c, parent, functions); if (row.lexical_environment) |env| try hashRef(c, env, environments); if (row.activation_environment) |env| try hashRef(c, env, environments);
        try hashRefs(c, row.captures, &all_slots, 65536, .sorted);
    }
    for (value.globals) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.global_id, globals); try hashRef(c, row.@"type", types); try declaration(c, row.decl_key); }
    for (value.environments) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.id, environments); try hashRef(c, row.owner, functions); if (row.parent) |parent| try hashRef(c, parent, environments);
        try bound(c, row.slots.len, 65536); var previous: ?t.Hash = null; for (row.slots) |slot| { try c.row(@TypeOf(slot)); try hashRef(c, slot.@"type", types); if (previous) |p| if (std.mem.order(u8, &p, &slot.key) != .lt) return error.InvalidOrder; previous = slot.key; }
    }
    try bound(c, value.host_imports.len, 128); for (value.host_imports) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.id, hosts); try c.text(row.name, 4096, 1); try c.text(row.source_path, 4096, 1); try c.require(row.capability_id == 31); try hashRefs(c, row.parameter_types, types, 64, .any); try hashRef(c, row.return_type, types); }
    for (value.modules) |row| { try c.row(@TypeOf(row)); try hashRef(c, row.id, modules); try c.text(row.source_path, 4096, 1); try hashRef(c, row.initializer, functions); try textList(c, row.dependencies, 128, 4096, 1, .unique); try hashRefs(c, row.globals, globals, 4096, .unique);
        try bound(c, row.imports.len, 65536); for (row.imports) |import| { try c.row(@TypeOf(import)); try c.text(import.source_path, 4096, 1); try c.text(import.specifier, 4096, 1); try bound(c, import.bindings.len, 65536);
            for (import.bindings) |binding| { try c.row(@TypeOf(binding)); try c.text(binding.imported, 4096, 1); try c.text(binding.name, 4096, 1); try c.text(binding.target_source_path, 4096, 1); try alias(c, binding.kind, binding.target, functions, types, globals, modules); } }
        try bound(c, row.exports.len, 65536); var previous: ?[]const u8 = null; for (row.exports) |e| { try c.row(@TypeOf(e)); try c.text(e.name, 4096, 1); try c.text(e.target_source_path, 4096, 1); try alias(c, e.kind, e.target, functions, types, globals, modules); if (previous) |p| if (std.mem.order(u8, p, e.name) != .lt) return error.InvalidOrder; previous = e.name; }
    }
    inline for (.{ value.roots.roots, value.roots.required_roots }) |rows| { try roots(c, rows); for (rows) |root| try hashRef(c, root.target, functions); }
}
fn alias(c: *Context, kind: model.ModuleBindingKind, target: t.Hash, functions: *const HashSet, types: *const HashSet, globals: *const HashSet, modules: *const HashSet) Error!void {
    try hashRef(c, target, switch (kind) { .namespace => modules, .function => functions, .global => globals, .@"type" => types });
}

pub fn check(c: *Context, value: model.FixedPublication) Error!void {
    const v = switch (c.program.tables.mode) { .common => |v| v, else => return error.WrongMode };
    try c.row(@TypeOf(value)); try c.row(@TypeOf(value.publication)); try c.row(@TypeOf(value.request)); var functions = try build(c, c.program.functions, "id", 4096, true); defer functions.deinit(c.allocator);
    var types = try build(c, v.types, "id", 4109, true); defer types.deinit(c.allocator); var globals = try build(c, v.modules.globals, "id", 4096, true); defer globals.deinit(c.allocator);
    var environments = try build(c, v.closures.environments, "id", 4096, true); defer environments.deinit(c.allocator); var modules = try build(c, v.modules.modules, "id", 128, true); defer modules.deinit(c.allocator);
    var hosts = try build(c, v.modules.hosts, "id", 128, true); defer hosts.deinit(c.allocator);
    var contracts = try build(c, value.publication.contracts, "function_id", 4096, true); defer contracts.deinit(c.allocator);
    try scope(c, value.stable_scope, &functions, &types, &globals, &environments, &modules, &hosts);
    try c.row(@TypeOf(value.publication.format)); try c.require(value.publication.format.version == 2); try c.require(value.publication.contracts.len == value.stable_scope.functions.len);
    var slot_count: usize = 0; for (v.closures.environments) |env| { try c.step(); try c.require(env.slots.len <= 65536 - slot_count); slot_count += env.slots.len; }
    try c.charge(slot_count + 1); var slots: HashSet = .{}; defer slots.deinit(c.allocator); try slots.ensureTotalCapacity(c.allocator, @intCast(slot_count));
    for (v.closures.environments) |env| for (env.slots) |slot| { try c.step(); _ = slots.getOrPutAssumeCapacity(slot.key); };
    for (value.publication.contracts, 0..) |row, index| { try c.row(@TypeOf(row)); try hashRef(c, row.function_id, &functions); try c.require(std.mem.eql(u8, &row.function_id, &value.stable_scope.functions[index].function_id));
        const upper = row.upper; try c.row(@TypeOf(upper)); try c.row(@TypeOf(upper.globals)); try c.row(@TypeOf(upper.host_resources)); try c.row(@TypeOf(row.callables)); try hashRefs(c, upper.globals.reads, &globals, 4096, .sorted); try hashRefs(c, upper.globals.writes, &globals, 4096, .sorted);
        try textList(c, upper.host_resources.reads, 65536, 4096, 1, .sorted); try textList(c, upper.host_resources.writes, 65536, 4096, 1, .sorted); try c.row(@TypeOf(upper.facets));
        try bound(c, upper.parameters.len, 64); for (upper.parameters, 0..) |p, i| { try c.row(@TypeOf(p)); try c.require(p.index == i); }
        try bound(c, upper.captures.len, 65536); var prior_slot: ?t.Hash = null; for (upper.captures) |capture| { try c.row(@TypeOf(capture)); try hashRef(c, capture.slot, &slots); if (prior_slot) |p| if (std.mem.order(u8, &p, &capture.slot) != .lt) return error.InvalidOrder; prior_slot = capture.slot; }
        try bound(c, row.callables.parameters.len, 64); var prior_parameter: ?u16 = null; for (row.callables.parameters) |p| { try c.row(@TypeOf(p)); try c.require(p.index <= 63); if (prior_parameter) |old| if (old >= p.index) return error.InvalidOrder; prior_parameter = p.index; try c.row(@TypeOf(p.allowed)); try hashRefs(c, p.allowed.functions, &contracts, 256, .sorted); try c.step(); }
        if (row.callables.returns) |returned| { try c.row(@TypeOf(returned)); try hashRefs(c, returned.functions, &contracts, 256, .sorted); }
    }
    try c.require(value.dependencies.len == c.program.functions.len); for (value.dependencies, 0..) |row, index| { try c.row(@TypeOf(row)); try c.require(std.mem.eql(u8, &row.function_id, &c.program.functions[index].id));
        try bound(c, row.callees.len, 4096); var previous: ?t.Hash = null; for (row.callees) |callee| { try c.row(@TypeOf(callee)); try hashRef(c, callee.function_id, &contracts); if (previous) |p| if (std.mem.order(u8, &p, &callee.function_id) != .lt) return error.InvalidOrder; previous = callee.function_id; }
        try bound(c, row.hosts.len, 128); previous = null; for (row.hosts) |host| { try c.row(@TypeOf(host)); try hashRef(c, host.host_id, &hosts); if (previous) |p| if (std.mem.order(u8, &p, &host.host_id) != .lt) return error.InvalidOrder; previous = host.host_id; }
    }
    try c.require(value.request.targets.len != 1); try hashRefs(c, value.request.targets, &functions, 32, .unique);
}
