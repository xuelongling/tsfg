// SPDX-License-Identifier: MIT
// Checks already constructed typed table references and shape. This is neither
// a byte/JSON decoder nor an independent SSA/effects/borrow admission result.
const std = @import("std");
const ctx = @import("wire-program-refcheck-context.zig");
const t = @import("wire-program-types.zig");
const tables = @import("wire-program-tables.zig");
const member = @import("wire-program-members.zig");
const storage = @import("wire-program-storage.zig");
const control = @import("wire-program-control.zig");
const publication = @import("wire-program-publication-refs.zig");
const Context = ctx.Context;
const Error = ctx.Error;
const Policy = enum { any, unique, sorted };

fn bound(c: *Context, length: usize, maximum: usize) Error!void { try c.require(length <= maximum); }
fn refs(c: *Context, values: anytype, count: usize, maximum: usize, policy: Policy) Error!void {
    try bound(c, values.len, maximum);
    var seen: std.AutoHashMapUnmanaged(usize, void) = .{}; defer seen.deinit(c.allocator);
    if (policy == .unique) { try c.charge(values.len + 1); try seen.ensureTotalCapacity(c.allocator, @intCast(values.len)); }
    var previous: ?usize = null;
    for (values) |value| { const index = try c.ref(value, count);
        if (policy == .sorted) { if (previous) |p| if (p >= index) return error.InvalidOrder; previous = index; }
        if (policy == .unique) { try c.step(); if (seen.getOrPutAssumeCapacity(index).found_existing) return error.InvalidOrder; }
    }
}
fn ids(c: *Context, rows: anytype, maximum: usize) Error!void {
    try bound(c, rows.len, maximum); var previous: ?t.Hash = null;
    for (rows) |row| { try c.charge(2); if (previous) |p| if (std.mem.order(u8, &p, &row.id) != .lt) return error.InvalidOrder; previous = row.id; }
}
fn texts(c: *Context, values: []const []const u8, maximum: usize, minimum: usize) Error!void {
    try bound(c, values.len, maximum); for (values) |value| try c.text(value, 4096, minimum);
}
fn numbers(c: *Context, values: []const u32, maximum: usize, limit: u32) Error!void {
    try bound(c, values.len, maximum); for (values) |value| try c.require(value <= limit);
}
fn physical(c: *Context, bytes: u32, alignment: u16, roots: u16, maximum: u32) Error!void {
    try c.charge(3); try c.require(bytes <= maximum and roots <= 256 and (alignment == 1 or alignment == 2 or alignment == 4 or alignment == 8));
}
fn ehLayout(c: *Context, value: storage.ExceptionLayout) Error!void {
    try bound(c, value.roots.len, 256); try physical(c, value.bytes, value.alignment, @intCast(value.roots.len), 65536);
    try numbers(c, value.roots, 256, value.bytes); try numbers(c, value.offsets, 4096, 65536);
}
fn ehCarrier(c: *Context, value: storage.ExceptionCarrier) Error!void {
    try c.step(); const n = c.counts(); switch (value) { .domain => |v| { _ = try c.ref(v, n.domains); }, .@"type" => |v| { _ = try c.ref(v, n.types); }, .payload => try c.step() }
}
fn abiCarrier(c: *Context, value: t.Carrier) Error!void { try c.carrier(value); if (value == .cell) return error.InvalidShape; }
fn optionalOrigin(c: *Context, value: ?t.Origin) Error!void { if (value) |v| try c.origin(v) else try c.step(); }
fn parameterRef(c: *Context, value: member.ConstructorParameterRef) Error!void {
    const v = switch (c.program.tables.mode) { .common => |v| v, else => return error.WrongMode };
    const index = try c.ref(value.construction, v.members.constructions.len);
    try c.require(value.parameter < v.members.constructions[index].parameters.len);
}
fn parameter(c: *Context, value: member.ConstructorParameter) Error!void {
    try c.row(@TypeOf(value)); try c.maybeRef(value.binding, c.counts().bindings); _ = try c.ref(value.@"type", c.counts().types); try c.origin(value.origin);
    if (value.inherited_from) |v| try parameterRef(c, v);
}
fn dispatches(c: *Context, values: []const tables.Dispatch) Error!void {
    const n = c.counts(); try bound(c, values.len, 100000); try c.charge(values.len);
    for (values) |row| switch (row) { inline else => |v, tag| {
        try c.row(@TypeOf(v)); _ = try c.ref(v.view, n.types); _ = try c.ref(v.member, if (tag == .field) n.fields else n.methods);
        try c.require(v.arms.len >= 1 and v.arms.len <= 256); var previous: ?usize = null;
        for (v.arms) |arm| { try c.row(@TypeOf(arm)); const actual = try c.ref(arm.actual, n.types);
            if (previous) |p| if (p >= actual) return error.InvalidOrder; previous = actual;
            try c.maybeRef(arm.target, if (tag == .field) n.fields else c.program.functions.len); try c.maybeRef(arm.abi, n.abis);
        }
    }};
    // Canonical JSON row spelling/order is a future strict decoder obligation.
}
fn legacyClosures(c: *Context, v: control.LegacyClosures) Error!void {
    const n = c.counts(); try bound(c, v.functions.len, 4096); try uniqueIds(c, v.environments, 4096); try bound(c, v.calls.len, 8192);
    for (v.functions) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); try c.maybeRef(row.parent, c.program.functions.len);
        try c.maybeRef(row.lexical_environment, n.environments); try c.maybeRef(row.activation_environment, n.environments); _ = try c.ref(row.@"type", n.types); try c.text(row.scope, 4096, 1); }
    for (v.environments) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, c.program.functions.len); try c.maybeRef(row.parent, n.environments);
        try physical(c, row.byte_size, row.alignment, row.reference_count, 65536); try bound(c, row.slots.len, 256);
        for (row.slots) |slot| { try c.row(@TypeOf(slot)); _ = try c.ref(slot.@"type", n.types); try c.require(slot.offset <= 65536 and slot.state_offset <= 65536 and slot.reference_offset <= 256 and slot.declaration_index <= 8192); }
    }
    for (v.calls) |row| { try c.row(@TypeOf(row)); const f = try c.ref(row.function, c.program.functions.len); const b = try c.ref(row.block, c.program.functions[f].blocks.len);
        try c.require(row.instruction < c.program.functions[f].blocks[b].instructions.len); try refs(c, row.targets, c.program.functions.len, 4096, .sorted); }
}
fn exceptionControl(c: *Context, v: control.ExceptionControl) Error!void {
    const n = c.counts(); try ids(c, v.bindings, 4096); try ids(c, v.scopes, 8192); try bound(c, v.functions.len, 4096); if (c.program.tables.mode == .exception) try c.require(v.functions.len == c.program.functions.len);
    for (v.functions) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.module, n.modules); try c.maybeRef(row.parent, c.program.functions.len); try c.maybeRef(row.@"type", n.types);
        try refs(c, row.parameters, n.cells, 64, .unique); try refs(c, row.captures, n.cells, 4096, .unique); }
    for (v.bindings) |row| { try c.row(@TypeOf(row)); const owner = try c.ref(row.owner, c.program.functions.len); _ = try c.ref(row.scope, n.scopes); _ = try c.ref(row.@"type", n.types);
        try c.text(row.name, 4096, 1); try c.anchor(row.range, c.program.functions[owner].source); try ehCarrier(c, row.carrier); }
    for (v.scopes) |row| { try c.row(@TypeOf(row)); const owner = try c.ref(row.owner, c.program.functions.len); try c.maybeRef(row.parent, n.scopes); try c.anchor(row.range, c.program.functions[owner].source);
        try bound(c, row.path.len, 128); for (row.path) |part| { try c.step(); try c.text(part.slot, 4096, 1); } }
}
fn legacyAuthority(c: *Context, v: @import("wire-program-publication.zig").LegacyAuthority) Error!void {
    const n = c.counts(); try bound(c, v.exports.len, 4096); try bound(c, v.entries.len, 100000); try bound(c, v.resources.len, 100000); try bound(c, v.published.len, 4096);
    for (v.exports) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); try c.text(row.name, 4096, 1); }
    for (v.entries) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); _ = try c.ref(row.view, n.types); try c.require(row.parameter <= 255); try c.origin(row.origin);
        try bound(c, row.roots.len, 4096); for (row.roots) |pair| { try c.row(@TypeOf(pair)); _ = try c.ref(pair.source, n.types); _ = try c.ref(pair.target, n.types); } }
    for (v.resources) |row| { try c.row(@TypeOf(row)); try c.text(row.id, 4096, 1); _ = try c.ref(row.semantic_type, n.types); try refs(c, row.owners, v.resources.len, 100000, .unique);
        try refs(c, row.aliases, v.resources.len, 100000, .unique); try refs(c, row.elements, n.types, 256, .unique); }
    for (v.published) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); _ = try c.ref(row.abi, n.abis);
        try refs(c, row.parameter_bounds, n.domains, 256, .any); try c.maybeRef(row.result_bound, n.domains); }
}

fn commonTypes(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try ids(c, v.types, 4109); try c.require(v.types.len >= 1); try ids(c, v.domains, 4096);
    for (v.types) |row| { try c.row(@TypeOf(row)); try c.text(row.name, 4096, 0); try c.require(row.native_code <= 14); try c.maybeRef(row.base, n.types); try c.maybeRef(row.element, n.types);
        try refs(c, row.members, n.types, 256, .any); if (row.methods) |items| try refs(c, items, n.methods, 4096, .unique);
        const nominal = row.kind == .reference or row.kind == .value; try c.require(nominal == (row.nominal_key != null)); if (!nominal) try c.require(row.methods == null);
        if (row.nominal_key) |key| { try c.row(@TypeOf(key)); _ = try c.ref(key.source, c.program.tables.sources.len); try texts(c, key.declaration_path, 32, 1); try c.require(key.declaration_path.len > 0); }
    }
    for (v.domains) |row| { try c.row(@TypeOf(row)); try physical(c, row.byte_size, row.alignment, row.reference_count, 65536); try c.require(row.tag_bytes == 0 or row.tag_bytes == 2); try refs(c, row.actual_types, n.types, 256, .unique); }
}
fn commonMembers(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try ids(c, v.members.fields, 65536); try ids(c, v.members.methods, 4096); try ids(c, v.members.constructions, 4096); try uniqueField(c, v.members.methods, "function", c.program.functions.len); try uniqueField(c, v.members.constructions, "owner", n.types);
    for (v.members.fields) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); _ = try c.ref(row.@"type", n.types); _ = try c.ref(row.declared_type, n.types);
        _ = try c.ref(row.binding, n.bindings); try c.text(row.name, 4096, 1); try c.require(row.ordinal <= 255); try c.origin(row.origin); }
    for (v.members.methods) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); _ = try c.ref(row.function, c.program.functions.len); try c.text(row.name, 4096, 1); }
    for (v.members.constructions) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); try c.maybeRef(row.function, c.program.functions.len); try c.origin(row.origin);
        try bound(c, row.parameters.len, 64); for (row.parameters) |p| try parameter(c, p);
        try c.row(@TypeOf(row.signature)); try c.row(@TypeOf(row.source_signature)); try refs(c, row.signature.parameters, n.types, 64, .any); _ = try c.ref(row.signature.return_type, n.types); try c.origin(row.source_signature.origin);
        try refs(c, row.initialization_fields, n.fields, 256, .unique);
        if (row.implicit_forward) |f| { try c.row(@TypeOf(f)); _ = try c.ref(f.target, n.constructions); try c.origin(f.origin); try c.row(@TypeOf(f.base_signature)); try bound(c, f.base_signature.parameters.len, 64);
            for (f.base_signature.parameters) |p| try parameter(c, p); _ = try c.ref(f.base_signature.@"return", n.types); try bound(c, f.parameters.len, 64);
            for (f.parameters) |p| { try c.row(@TypeOf(p)); try parameterRef(c, p.source); try parameterRef(c, p.target); _ = try c.ref(p.compatibility, n.compatibilities); }
        }
    }
}
fn commonStorage(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try bound(c, v.storage.bindings.len, 65536); var prior: ?[]const u8 = null;
    for (v.storage.bindings) |row| { try c.row(@TypeOf(row)); try c.text(row.id, 4096, 1); if (prior) |p| if (std.mem.order(u8, p, row.id) != .lt) return error.InvalidOrder; prior = row.id;
        try c.text(row.name, 4096, 1); _ = try c.ref(row.@"type", n.types); try c.carrier(row.carrier); try c.maybeRef(row.scope, n.scopes); try optionalOrigin(c, row.origin);
        try c.step(); switch (row.owner) { .param, .local, .receiver => |f| { _ = try c.ref(f, c.program.functions.len); try c.require(row.scope != null); },
            .global => |g| { _ = try c.ref(g, n.globals); try c.require(row.scope == null); }, .field => |f| { _ = try c.ref(f, n.fields); try c.require(row.scope == null); },
            .element => |e| { _ = try c.ref(e, n.types); try c.require(row.scope == null); } }
    }
    try bound(c, v.storage.concrete.len, 4109); try bound(c, v.storage.arrays.len, 4096); try bound(c, v.storage.environments.len, 4096); try uniqueField(c, v.storage.concrete, "type", n.types); try uniqueField(c, v.storage.arrays, "type", n.types); try uniqueField(c, v.storage.environments, "environment", n.environments);
    for (v.storage.concrete) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.@"type", n.types); const p = row.carrier.layout; try physical(c, p.byte_size, p.alignment, p.reference_count, 65536);
        try numbers(c, row.carrier.field_offsets, 65536, p.byte_size); if (row.body) |body| { try c.row(@TypeOf(body)); try physical(c, body.byte_size, body.alignment, body.reference_count, 65536); try bound(c, body.fields.len, 65536);
            for (body.fields) |f| { try c.row(@TypeOf(f)); _ = try c.ref(f.field, n.fields); _ = try c.ref(f.binding, n.bindings); try c.require(f.offset <= body.byte_size and f.reference_offset <= body.reference_count); } }
    }
    for (v.storage.arrays) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.@"type", n.types); try c.carrier(row.element_carrier); }
    for (v.storage.environments) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.environment, n.environments); try physical(c, row.byte_size, row.alignment, row.reference_count, 65536);
        if (row.parent_offset) |offset| try c.require(offset <= row.byte_size); try numbers(c, row.slot_offsets, 65536, row.byte_size); }
    try c.require(v.storage.payload.byte_size == 16 and v.storage.payload.alignment == 8 and v.storage.payload.reference_count == 1);
    try bound(c, v.abis.len, 4096); try c.require(v.abis.len == c.program.functions.len); try uniqueField(c, v.abis, "function", c.program.functions.len);
    for (v.abis) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); try refs(c, row.parameters, n.bindings, 64, .unique);
        try c.maybeRef(row.receiver, n.bindings); try c.maybeRef(row.lexical_environment, n.environments); try c.maybeRef(row.result, n.types); try bound(c, row.physical_parameters.len, 64);
        for (row.physical_parameters) |carrier| try abiCarrier(c, carrier); if (row.result_carrier) |carrier| try abiCarrier(c, carrier); }
}
fn fieldLike(c: *Context, value: tables.FieldLike) Error!void { try c.step(); switch (value) { .field => |v| { _ = try c.ref(v, c.counts().fields); }, .length => |v| { const i = try c.ref(v, c.counts().types); const data = switch (c.program.tables.mode) { .common => |data| data, else => return error.WrongMode }; try c.require(data.types[i].kind == .array or data.types[i].kind == .readSpan); } } }
fn commonViews(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try bound(c, v.views.compatibility.len, 100000); var previous: ?[5]usize = null;
    for (v.views.compatibility) |row| { try c.row(@TypeOf(row)); const a = try c.ref(row.source_type, n.types); const b = try c.ref(row.target_type, n.types); try c.origin(row.origin);
        const key = [5]usize{ @intFromEnum(row.origin.source), row.origin.start, row.origin.end, a, b }; if (previous) |p| if (std.mem.order(usize, &p, &key) != .lt) return error.InvalidOrder; previous = key;
        try bound(c, row.fields.len, 65536); for (row.fields) |pair| { try c.row(@TypeOf(pair)); try fieldLike(c, pair.target); if (pair.actual) |actual| try fieldLike(c, actual); }
        try bound(c, row.methods.len, 4096); for (row.methods) |pair| { try c.row(@TypeOf(pair)); _ = try c.ref(pair.actual, n.methods); _ = try c.ref(pair.target, n.methods); }
    }
    try dispatches(c, v.views.dispatch); try bound(c, v.views.entries.len, 65536); var entry_key: ?[2]usize = null;
    for (v.views.entries) |row| { try c.row(@TypeOf(row)); const f = try c.ref(row.function, c.program.functions.len); const p = try c.ref(row.parameter, n.bindings);
        const key = [2]usize{ f, p }; if (entry_key) |old| if (std.mem.order(usize, &old, &key) != .lt) return error.InvalidOrder; entry_key = key; try refs(c, row.roots, n.compatibilities, 100000, .sorted); }
}

fn names(c: *Context, rows: anytype, maximum: usize, sorted: bool) Error!void {
    try bound(c, rows.len, maximum); var seen: std.StringHashMapUnmanaged(void) = .{}; defer seen.deinit(c.allocator);
    if (!sorted) { try c.charge(rows.len + 1); try seen.ensureTotalCapacity(c.allocator, @intCast(rows.len)); }
    var previous: ?[]const u8 = null; for (rows) |row| { try c.text(row.name, 4096, 1);
        if (sorted) { if (previous) |p| if (std.mem.order(u8, p, row.name) != .lt) return error.InvalidOrder; previous = row.name; }
        else { try c.step(); if (seen.getOrPutAssumeCapacity(row.name).found_existing) return error.InvalidOrder; }
    }
}
fn declaration(c: *Context, value: @import("wire-program-publication.zig").DeclarationKey) Error!void {
    try c.row(@TypeOf(value)); try c.text(value.name, 4096, 1); try c.text(value.source_path, 4096, 1); try texts(c, value.path, 128, 1);
}
fn commonModules(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try ids(c, v.modules.modules, 128); try ids(c, v.modules.globals, 4096); try ids(c, v.modules.hosts, 128);
    for (v.modules.globals) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.@"type", n.types); _ = try c.ref(row.binding, n.bindings); try c.carrier(row.carrier); try c.text(row.name, 4096, 1);
        try c.anchor(.{ .start = row.start, .end = row.end }, row.source); try declaration(c, row.decl_key); }
    for (v.modules.hosts) |row| { try c.row(@TypeOf(row)); try c.text(row.name, 4096, 1); try c.require(row.capability == 31); try c.anchor(.{ .start = row.start, .end = row.end }, row.source);
        try refs(c, row.parameter_types, n.types, 64, .any); _ = try c.ref(row.return_type, n.types); }
    for (v.modules.modules) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.source, c.program.tables.sources.len); _ = try c.ref(row.initializer, c.program.functions.len); try c.require(row.external);
        try refs(c, row.dependencies, n.modules, 128, .unique); try refs(c, row.globals, n.globals, 4096, .unique); try bound(c, row.imports.len, 65536); try names(c, row.exports, 65536, true);
        for (row.exports) |alias| { try c.row(@TypeOf(alias)); _ = try c.ref(alias.target_source, c.program.tables.sources.len); }
        for (row.imports) |import| { try c.row(@TypeOf(import)); _ = try c.ref(import.source, c.program.tables.sources.len); try c.text(import.specifier, 4096, 1); try names(c, import.bindings, 65536, false);
            for (import.bindings) |binding| { try c.row(@TypeOf(binding)); try c.text(binding.imported, 4096, 1); _ = try c.ref(binding.target_source, c.program.tables.sources.len); } }
    }
    try c.require(v.modules.initialization.len == n.modules); try refs(c, v.modules.initialization, n.modules, 128, .unique);
    inline for (.{ v.modules.roots.roots, v.modules.roots.required_roots }) |rows| try publication.roots(c, rows);
}
fn pathOrder(c: *Context, a: []const []const u8, b: []const []const u8) Error!std.math.Order {
    for (a[0..@min(a.len, b.len)], b[0..@min(a.len, b.len)]) |x, y| { try c.charge(1 + x.len / 64 + y.len / 64); const order = std.mem.order(u8, x, y); if (order != .eq) return order; }
    try c.step(); return std.math.order(a.len, b.len);
}
fn commonControl(c: *Context, v: tables.CommonTables) Error!void {
    const n = c.counts(); try ids(c, v.closures.environments, 4096); var total_slots: usize = 0;
    for (v.closures.environments) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, c.program.functions.len); try c.maybeRef(row.parent, n.environments);
        try c.require(row.slots.len <= 65536 - total_slots); total_slots += row.slots.len; var previous: ?t.Hash = null;
        for (row.slots) |slot| { try c.row(@TypeOf(slot)); _ = try c.ref(slot.binding, n.bindings); _ = try c.ref(slot.@"type", n.types); if (previous) |p| if (std.mem.order(u8, &p, &slot.key) != .lt) return error.InvalidOrder; previous = slot.key; }
    }
    try bound(c, v.closures.functions.len, 4096); var prior_function: ?usize = null;
    for (v.closures.functions) |row| { try c.row(@TypeOf(row)); const f = try c.ref(row.function, c.program.functions.len); if (prior_function) |p| if (p >= f) return error.InvalidOrder; prior_function = f;
        try c.require(c.program.functions[f].role != .module_initializer); try c.maybeRef(row.parent, c.program.functions.len); try c.maybeRef(row.lexical_environment, n.environments); try c.maybeRef(row.activation_environment, n.environments);
        try bound(c, row.captures.len, 65536); var prior: ?[2]usize = null; for (row.captures) |capture| { const env = try c.ref(capture.environment, n.environments); const slot = try c.ref(capture.slot, v.closures.environments[env].slots.len);
            const key = [2]usize{ env, slot }; if (prior) |p| if (std.mem.order(usize, &p, &key) != .lt) return error.InvalidOrder; prior = key; }
    }
    try bound(c, v.closures.calls.len, 100000); for (v.closures.calls) |row| { try c.row(@TypeOf(row)); const f = try c.ref(row.function, c.program.functions.len); const b = try c.ref(row.block, c.program.functions[f].blocks.len);
        try c.require(row.instruction < c.program.functions[f].blocks[b].instructions.len); try refs(c, row.targets, c.program.functions.len, 4096, .sorted); }
    try bound(c, v.exceptions.scopes.len, 8192); var prior_owner: ?usize = null; var prior_path: []const []const u8 = &.{};
    for (v.exceptions.scopes) |row| { try c.row(@TypeOf(row)); const owner = try c.ref(row.owner, c.program.functions.len); try texts(c, row.path, 128, 1);
        if (prior_owner) |p| if (p > owner or p == owner and try pathOrder(c, prior_path, row.path) != .lt) return error.InvalidOrder; prior_owner = owner; prior_path = row.path; }
    try bound(c, v.exceptions.bindings.len, 65536); var prior_binding: ?usize = null;
    for (v.exceptions.bindings) |row| { try c.row(@TypeOf(row)); const binding = try c.ref(row.binding, n.bindings); _ = try c.ref(row.scope, n.scopes); if (prior_binding) |p| if (p >= binding) return error.InvalidOrder; prior_binding = binding; }
    try bound(c, v.exceptions.functions.len, 4096); try c.require(v.exceptions.functions.len == c.program.functions.len); for (v.exceptions.functions, 0..) |row, i| { try c.row(@TypeOf(row)); const f = try c.ref(row.function, c.program.functions.len); try c.require(f == i); try bound(c, row.handlers.len, 8192);
        for (row.handlers) |handler| { try c.row(@TypeOf(handler)); try c.text(handler.id, 4096, 1); try c.anchor(handler.range, handler.source); try c.maybeRef(handler.catch_binding, n.bindings); try c.maybeRef(handler.catch_block, c.program.functions[f].blocks.len); try c.require(handler.has_catch or handler.catch_binding == null and handler.catch_block == null); try c.require(handler.has_finally or handler.finally_blocks.len == 0);
            try bound(c, handler.finally_blocks.len, 256); for (handler.finally_blocks) |block| { try c.row(@TypeOf(block)); _ = try c.ref(block.block, c.program.functions[f].blocks.len); } }
    }
}

fn uniqueIds(c: *Context, rows: anytype, maximum: usize) Error!void {
    try bound(c, rows.len, maximum); try c.charge(rows.len + 1); var seen: std.AutoHashMapUnmanaged(t.Hash, void) = .{}; defer seen.deinit(c.allocator); try seen.ensureTotalCapacity(c.allocator, @intCast(rows.len));
    for (rows) |row| { try c.step(); if (seen.getOrPutAssumeCapacity(row.id).found_existing) return error.InvalidOrder; }
}

fn uniqueField(c: *Context, rows: anytype, comptime key: []const u8, count: usize) Error!void {
    try c.charge(rows.len + 1); var seen: std.AutoHashMapUnmanaged(usize, void) = .{}; defer seen.deinit(c.allocator); try seen.ensureTotalCapacity(c.allocator, @intCast(rows.len));
    for (rows) |row| { try c.step(); const index = try c.ref(@field(row, key), count); if (seen.getOrPutAssumeCapacity(index).found_existing) return error.InvalidOrder; }
}
fn legacy(c: *Context, v: tables.LegacyTables) Error!void {
    try c.row(@TypeOf(v.exceptions));
    try c.require(v.exceptions.functions.len == 0 and v.exceptions.bindings.len == 0 and v.exceptions.scopes.len == 0);
    const n = c.counts(); try uniqueIds(c, v.types, 4109); try c.require(v.types.len > 0); try uniqueIds(c, v.domains, 100000); try c.require(v.domains.len > 0);
    for (v.types) |row| { try c.row(@TypeOf(row)); try c.text(row.name, 4096, 0); try c.require(row.native_code <= 14); try c.maybeRef(row.base, n.types); try c.maybeRef(row.element, n.types); try refs(c, row.members, n.types, 256, .any);
        if (row.nominal_key) |key| { try c.row(@TypeOf(key)); _ = try c.ref(key.source, c.program.tables.sources.len); try texts(c, key.declaration_path, 32, 1); try c.require(key.declaration_path.len > 0); } }
    for (v.domains) |row| { try c.row(@TypeOf(row)); try physical(c, row.byte_size, row.alignment, row.reference_count, 65544); try c.require(row.native_code <= 13 and (row.tag_bytes == 0 or row.tag_bytes == 2));
        try bound(c, row.alternatives.len, 256); var prior: ?t.Hash = null; for (row.alternatives) |value| { const index = try c.ref(value, n.types); const id = v.types[index].id;
            if (prior) |p| if (std.mem.order(u8, &p, &id) != .lt) return error.InvalidOrder; prior = id; } }
    try uniqueIds(c, v.members.fields, 65536); try uniqueIds(c, v.members.methods, 4096); try uniqueIds(c, v.members.constructions, 4096);
    for (v.members.fields) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); _ = try c.ref(row.@"type", n.types); _ = try c.ref(row.declared_type, n.types); try c.text(row.name, 4096, 1); try c.require(row.ordinal <= 255); try optionalOrigin(c, row.origin); }
    for (v.members.methods) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); _ = try c.ref(row.function, c.program.functions.len); }
    for (v.members.constructions) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.owner, n.types); _ = try c.ref(row.function, c.program.functions.len); try c.text(row.receiver_binding, 4096, 1); try bound(c, row.events.len, 512);
        for (row.events) |event| { try c.row(@TypeOf(event)); _ = try c.ref(event.field, n.fields); try c.require(event.ordinal <= 511); if (event.parameter) |p| try c.require(p <= 255); try c.origin(event.origin); } }
    try bound(c, v.storage.arrays.len, 4096); try bound(c, v.storage.concrete.len, 4096); try uniqueIds(c, v.storage.domains, 100000);
    for (v.storage.arrays) |row| { _ = try c.ref(row.@"type", n.types); _ = try c.ref(row.domain, n.domains); }
    for (v.storage.domains) |row| { try c.step(); _ = try c.ref(row.domain, n.domains); }
    for (v.storage.concrete) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.@"type", n.types); try physical(c, row.byte_size, row.alignment, row.reference_count, 65536); try bound(c, row.fields.len, 256);
        for (row.fields) |field| { try c.row(@TypeOf(field)); _ = try c.ref(field.field, n.fields); _ = try c.ref(field.domain, n.domains); try c.require(field.offset <= 65536 and field.state_offset <= 65536 and field.reference_offset <= 256); } }
    try bound(c, v.views.compatibility.len, 100000); for (v.views.compatibility) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.source_type, n.types); _ = try c.ref(row.target_type, n.types);
        try bound(c, row.fields.len, 256); for (row.fields) |pair| { _ = try c.ref(pair.target, n.fields); try c.maybeRef(pair.actual, n.fields); }
        try bound(c, row.methods.len, 4096); for (row.methods) |pair| { _ = try c.ref(pair.target, n.methods); _ = try c.ref(pair.actual, n.methods); } }
    try dispatches(c, v.views.dispatch); try bound(c, v.abis.len, 4096); try c.require(v.abis.len == c.program.functions.len); try uniqueField(c, v.abis, "function", c.program.functions.len);
    var closure_mode = false; for (v.abis) |row| { try c.step(); closure_mode = closure_mode or row.kind == .closure; }
    if (closure_mode) { try c.require(v.closures.functions.len == c.program.functions.len); for (v.closures.functions, 0..) |row, i| { try c.require(@intFromEnum(row.function) == i); } }
    for (v.abis) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); _ = try c.ref(row.source_result, n.types); try bound(c, row.parameters.len, 256); try bound(c, row.presence.len, 256);
        for (row.presence) |p| try c.require(p <= 15); for (row.parameters) |p| { try c.row(@TypeOf(p)); _ = try c.ref(p.view, n.types); _ = try c.ref(p.domain, n.domains); try c.require(p.presence <= 15); try c.text(p.binding, 4096, 1); try optionalOrigin(c, p.origin); }

        var physical_index: usize = 0;
        for (row.presence) |mask| { try c.charge(3); try c.require(row.kind == .native and mask <= 15 and (mask & 4 == 0 or mask & 1 != 0) and (mask & 8 == 0 or mask & 5 == 5));
            try c.require(physical_index < row.parameters.len); const payload = row.parameters[physical_index]; try c.require(payload.presence == mask); const domain = v.domains[@intFromEnum(payload.domain)];
            const is_string = domain.alternatives.len == 1 and v.types[@intFromEnum(domain.alternatives[0])].kind == .string; try c.require((domain.native_code != 0 or is_string) and (mask == 0 or !is_string));
            if (mask & 3 != 0) { try c.require(physical_index + 1 < row.parameters.len); const state = row.parameters[physical_index + 1]; try c.require(state.presence == 0 and v.domains[@intFromEnum(state.domain)].native_code == 1); }
            physical_index += if (mask & 3 != 0) @as(usize, 2) else 1;
        }
        try c.require(if (row.kind == .native) physical_index == row.parameters.len else row.presence.len == 0);
        if (row.result) |result| { _ = try c.ref(result.view, n.types); _ = try c.ref(result.domain, n.domains); } }
    try uniqueIds(c, v.modules.modules, 128); try uniqueIds(c, v.modules.globals, 4096); try uniqueIds(c, v.modules.hosts, 128); try bound(c, v.modules.roots.len, 128);
    for (v.modules.modules) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.source, c.program.tables.sources.len); _ = try c.ref(row.initializer, c.program.functions.len); try refs(c, row.dependencies, n.modules, 128, .unique); }
    for (v.modules.globals) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.view, n.types); _ = try c.ref(row.domain, n.domains); try c.text(row.name, 4096, 1); try c.anchor(.{ .start = row.start, .end = row.end }, row.source); }
    for (v.modules.hosts) |row| { try c.row(@TypeOf(row)); try c.text(row.name, 4096, 1); try c.require(row.capability == 31); try c.anchor(.{ .start = row.start, .end = row.end }, row.source); }
    try publication.roots(c, v.modules.roots);
    try refs(c, v.modules.initialization, c.program.functions.len, 128, .unique); try legacyAuthority(c, v.authority); try legacyClosures(c, v.closures);
}
fn exception(c: *Context, v: tables.ExceptionTables) Error!void {
    const n = c.counts(); try ids(c, v.types, 4096); try uniqueIds(c, v.domains, 4096); try uniqueIds(c, v.members.fields, 4096); try uniqueIds(c, v.members.constructions, 4096);
    for (v.types) |row| { try c.row(@TypeOf(row)); try c.text(row.name, 4096, 0); try c.require(row.mask <= 3); try c.maybeRef(row.base, n.types); try c.maybeRef(row.result, n.types); try c.maybeRef(row.source, c.program.tables.sources.len);
        try refs(c, row.parameters, n.types, 64, .any); try texts(c, row.path, 32, 1); try refs(c, row.field_indexes, n.fields, 4096, .unique); try refs(c, row.constructors, n.constructions, 4096, .unique);
        try bound(c, row.fields.len, 4096); for (row.fields) |field| { _ = try c.ref(field.@"type", n.types); } try ehLayout(c, row.layout); }
    for (v.domains) |row| { try c.row(@TypeOf(row)); try physical(c, row.byte_size, row.alignment, row.reference_count, 65544); try c.require(row.tag_bytes == 0 or row.tag_bytes == 2); try refs(c, row.actual_types, n.types, 256, .unique); }
    for (v.members.fields) |row| { try c.row(@TypeOf(row)); const owner = try c.ref(row.owner, n.types); _ = try c.ref(row.@"type", n.types); try c.text(row.name, 4096, 1);
        const source = v.types[owner].source orelse return error.InvalidOrigin; try c.anchor(row.range, source); }
    for (v.members.constructions) |row| { try c.row(@TypeOf(row)); const owner = try c.ref(row.owner, n.types); const source = v.types[owner].source orelse return error.InvalidOrigin; try c.anchor(row.range, source); }
    try bound(c, v.storage.frames.len, 4096); try c.require(v.storage.frames.len == c.program.functions.len); try uniqueField(c, v.storage.frames, "function", c.program.functions.len); for (v.storage.frames, 0..) |frame, i| { try c.require(@intFromEnum(frame.function) == i); try c.row(@TypeOf(frame)); _ = try c.ref(frame.function, c.program.functions.len); try c.require(frame.physical_parameters == 1 and frame.physical_bytes == 8);
        try ehLayout(c, frame.layout); try bound(c, frame.slots.len, 4096); for (frame.slots) |slot| { try c.row(@TypeOf(slot)); _ = try c.ref(slot.binding, n.cells); _ = try c.ref(slot.@"type", n.types); if (slot.carrier) |carrier| try ehCarrier(c, carrier); try c.require(slot.offset <= frame.layout.bytes); } }
    try bound(c, v.abis.len, 4096); try c.require(v.abis.len == c.program.functions.len); try uniqueField(c, v.abis, "function", c.program.functions.len); for (v.abis, 0..) |row, i| { try c.require(@intFromEnum(row.function) == i and @intFromEnum(row.frame) == i); try c.row(@TypeOf(row)); _ = try c.ref(row.function, c.program.functions.len); _ = try c.ref(row.frame, v.storage.frames.len); try refs(c, row.parameters, n.cells, 64, .unique);
        try refs(c, row.captures, n.cells, 4096, .unique); try c.maybeRef(row.result, n.types); try bound(c, row.carriers.len, 64); for (row.carriers) |carrier| try ehCarrier(c, carrier);
        try c.require(row.physical_parameters == 1); if (row.result_carrier) |carrier| try ehCarrier(c, carrier); }
    try uniqueIds(c, v.modules.modules, 128); for (v.modules.modules) |row| { try c.row(@TypeOf(row)); _ = try c.ref(row.source, c.program.tables.sources.len); try c.maybeRef(row.initializer, c.program.functions.len); try refs(c, row.functions, c.program.functions.len, 4096, .unique);
        try bound(c, row.imports.len, 4096); try names(c, row.exports, 4096, false); for (row.exports) |e| { _ = try c.ref(e.function, c.program.functions.len); try c.anchor(e.range, row.source); try c.anchor(e.definition, row.source); }
        for (row.imports) |import| { try c.row(@TypeOf(import)); _ = try c.ref(import.module, n.modules); try c.text(import.specifier, 4096, 1); try names(c, import.bindings, 4096, false);
            for (import.bindings) |binding| { try c.row(@TypeOf(binding)); _ = try c.ref(binding.function, c.program.functions.len); try c.anchor(binding.range, row.source); } } }
    try c.row(@TypeOf(v.authority)); try c.row(@TypeOf(v.closures)); try c.require(v.authority.exports.len == 0 and v.authority.entries.len == 0 and v.authority.resources.len == 0 and v.authority.published.len == 0);
    try c.require(v.closures.functions.len == 0 and v.closures.environments.len == 0 and v.closures.calls.len == 0); try exceptionControl(c, v.exceptions);
}

pub fn check(c: *Context) Error!void {
    try c.require(c.program.functions.len >= 1 and c.program.functions.len <= 4096);
    switch (c.program.tables.mode) {
        .legacy => |v| try legacy(c, v),
        .exception => |v| try exception(c, v),
        .common => |v| { try commonTypes(c, v); try commonMembers(c, v); try commonStorage(c, v); try commonViews(c, v); try commonModules(c, v); try commonControl(c, v); try publication.check(c, v.authority.fixed_publication); },
    }
}
