// SPDX-License-Identifier: MIT
const std = @import("std");

// Derived from complete verified tables, never serialized or supplied by a
// request. Bounded bitsets keep immutable table views cheap to copy.
pub const Plan = struct {
    functions: [8]u64 = [_]u64{0} ** 8,
    modules: [2]u64 = [_]u64{0} ** 2,
    hosts: [2]u64 = [_]u64{0} ** 2,

    pub fn functionActive(self: *const Plan, index: usize) bool { return contains(&self.functions, index); }
    pub fn moduleActive(self: *const Plan, index: usize) bool { return contains(&self.modules, index); }
    pub fn hostRequired(self: *const Plan, index: usize) bool { return contains(&self.hosts, index); }
    pub fn hasRequiredHosts(self: *const Plan) bool { return self.hosts[0] != 0 or self.hosts[1] != 0; }
};

pub const Error = error{
    InvalidCount, InvalidSource, InvalidDependency, InvalidInitialization,
    InvalidRoot, InvalidCallTarget, InvalidGlobal, InvalidHost,
};

fn contains(bits: []const u64, index: usize) bool {
    return index / 64 < bits.len and bits[index / 64] & (@as(u64, 1) << @as(u6, @intCast(index % 64))) != 0;
}
fn mark(bits: []u64, index: usize) bool {
    const mask = @as(u64, 1) << @as(u6, @intCast(index % 64));
    const previous = bits[index / 64] & mask != 0;
    bits[index / 64] |= mask;
    return previous;
}

fn retainFunction(plan: *Plan, pending: *[512]u16, next: *usize, index: u16) void {
    if (mark(&plan.functions, index)) return;
    pending[next.*] = index;
    next.* += 1;
}
fn retainModule(tables: anytype, plan: *Plan, pending: *[512]u16, next: *usize, index: u16) void {
    if (mark(&plan.modules, index)) return;
    retainFunction(plan, pending, next, tables.modules[index].initializer);
    for (tables.modules[index].dependencies) |dependency| retainModule(tables, plan, pending, next, dependency);
}
fn visit(tables: anytype, index: u16, visited: *[128]bool, expected: *[128]u16, next: *usize) void {
    // Mark before descending: active static dependency cycles are legal.
    if (visited[index]) return;
    visited[index] = true;
    for (tables.modules[index].dependencies) |dependency| visit(tables, dependency, visited, expected, next);
    expected[next.*] = tables.modules[index].initializer;
    next.* += 1;
}

/// This graph consumer imports no loader or executor. Its bounds and edge
/// checks cover the complete universe, including declarations never selected.
/// Function identities, instruction types and initializer signatures remain
/// the reader's separate whole-program validation responsibility.
pub fn derive(tables: anytype, functions: anytype) Error!Plan {
    if (tables.sources.len < 1 or tables.sources.len > 128 or tables.modules.len < 1 or tables.modules.len > 128
        or tables.globals.len > 4096 or tables.hosts.len > 128 or tables.roots.len < 1 or tables.roots.len > 128
        or functions.len < 1 or functions.len > 512 or tables.initialization.len > tables.modules.len) return error.InvalidCount;
    var owners = [_]?u16{null} ** 128;
    for (tables.modules, 0..) |module, index| {
        if (module.source_index >= tables.sources.len or owners[module.source_index] != null) return error.InvalidSource;
        owners[module.source_index] = @intCast(index);
        if (module.initializer >= functions.len) return error.InvalidInitialization;
        if (module.dependencies.len > 128) return error.InvalidDependency;
        for (module.dependencies, 0..) |dependency, position| {
            if (dependency >= tables.modules.len or std.mem.indexOfScalar(u16, module.dependencies[0..position], dependency) != null)
                return error.InvalidDependency;
        }
    }
    for (tables.globals) |global| {
        if (global.source_index >= tables.sources.len or owners[global.source_index] == null) return error.InvalidGlobal;
    }
    for (tables.hosts) |host| if (host.source_index >= tables.sources.len) return error.InvalidHost;
    for (functions) |function| {
        if (function.info.source_index >= tables.sources.len or owners[function.info.source_index] == null) return error.InvalidSource;
        for (function.instructions) |op| switch (op.opcode) {
            27 => {
                if (op.left >= functions.len) return error.InvalidCallTarget;
                if (functions[op.left].info.initializer) return error.InvalidInitialization;
            },
            29, 30 => if (op.left >= tables.globals.len) return error.InvalidGlobal,
            31 => if (op.left >= tables.hosts.len) return error.InvalidHost,
            else => {},
        };
    }
    for (tables.roots) |root| {
        if (root.kind >= 6 or root.source_index >= tables.sources.len or owners[root.source_index] == null
            or root.function_index >= functions.len) return error.InvalidRoot;
        const function = functions[root.function_index];
        if (function.info.initializer != (root.kind == 1)
            or root.kind == 1 and function.info.source_index != root.source_index) return error.InvalidRoot;
    }

    var plan: Plan = .{};
    var pending: [512]u16 = undefined;
    var pending_count: usize = 0;
    for (tables.roots) |root| {
        retainFunction(&plan, &pending, &pending_count, root.function_index);
        retainModule(tables, &plan, &pending, &pending_count, owners[root.source_index].?);
    }
    while (pending_count != 0) {
        pending_count -= 1;
        const function = functions[pending[pending_count]];
        retainModule(tables, &plan, &pending, &pending_count, owners[function.info.source_index].?);
        for (function.instructions) |op| switch (op.opcode) {
            27 => retainFunction(&plan, &pending, &pending_count, op.left),
            29, 30 => retainModule(tables, &plan, &pending, &pending_count, owners[tables.globals[op.left].source_index].?),
            31 => { _ = mark(&plan.hosts, op.left); },
            else => {},
        };
    }

    var visited = [_]bool{false} ** 128;
    var expected: [128]u16 = undefined;
    var next: usize = 0;
    for (tables.roots) |root| visit(tables, owners[root.source_index].?, &visited, &expected, &next);
    var order: [128]u16 = undefined;
    var count: usize = 0;
    for (tables.modules, 0..) |_, index| if (plan.moduleActive(index)) {
        order[count] = @intCast(index);
        count += 1;
    };
    for (0..count) |a| for (a + 1..count) |b| {
        if (std.mem.order(u8, tables.sources[tables.modules[order[a]].source_index].path,
            tables.sources[tables.modules[order[b]].source_index].path) == .gt) std.mem.swap(u16, &order[a], &order[b]);
    };
    for (order[0..count]) |index| visit(tables, index, &visited, &expected, &next);
    if (next != tables.initialization.len or !std.mem.eql(u16, expected[0..next], tables.initialization)) return error.InvalidInitialization;
    return plan;
}

// Pure graph fixtures deliberately have no loader, VM, Host bridge, certificate
// or executable guest body. The expected sets and order are hand-authored.
const Fixture = struct {
    const Source = struct { path: []const u8 };
    const Module = struct { source_index: u16, initializer: u16, dependencies: []const u16 = &.{} };
    const Global = struct { source_index: u16 };
    const Host = struct { source_index: u16 };
    const Root = struct { kind: u8 = 0, source_index: u16, function_index: u16 };
    const Info = struct { source_index: u16, initializer: bool = false };
    const Op = struct { opcode: u8, left: u16 };
    const Function = struct { info: Info, instructions: []const Op = &.{} };
    const Tables = struct {
        sources: []const Source,
        modules: []const Module,
        globals: []const Global,
        hosts: []const Host,
        roots: []const Root,
        initialization: []const u16,
    };
    sources: [5]Source = .{ .{ .path = "/root.ts" }, .{ .path = "/dep.ts" }, .{ .path = "/calls.ts" }, .{ .path = "/globals.ts" }, .{ .path = "/dead.ts" } },
    modules: [5]Module = .{
        .{ .source_index = 0, .initializer = 0, .dependencies = &.{1} },
        .{ .source_index = 1, .initializer = 2, .dependencies = &.{0} },
        .{ .source_index = 2, .initializer = 4 },
        .{ .source_index = 3, .initializer = 5 },
        .{ .source_index = 4, .initializer = 7 },
    },
    globals: [1]Global = .{.{ .source_index = 3 }},
    hosts: [3]Host = .{ .{ .source_index = 0 }, .{ .source_index = 0 }, .{ .source_index = 4 } },
    functions: [8]Function = .{
        .{ .info = .{ .source_index = 0, .initializer = true } },
        .{ .info = .{ .source_index = 0 }, .instructions = &.{ .{ .opcode = 27, .left = 3 }, .{ .opcode = 29, .left = 0 }, .{ .opcode = 30, .left = 0 }, .{ .opcode = 31, .left = 0 } } },
        .{ .info = .{ .source_index = 1, .initializer = true } },
        .{ .info = .{ .source_index = 2 }, .instructions = &.{.{ .opcode = 31, .left = 1 }} },
        .{ .info = .{ .source_index = 2, .initializer = true } },
        .{ .info = .{ .source_index = 3, .initializer = true } },
        .{ .info = .{ .source_index = 4 }, .instructions = &.{.{ .opcode = 31, .left = 2 }} },
        .{ .info = .{ .source_index = 4, .initializer = true }, .instructions = &.{.{ .opcode = 31, .left = 2 }} },
    },
    roots: [1]Root = .{.{ .source_index = 0, .function_index = 1 }},
    initialization: [4]u16 = .{ 2, 0, 4, 5 },
    fn tables(self: *const Fixture) Tables {
        return .{ .sources = &self.sources, .modules = &self.modules, .globals = &self.globals,
            .hosts = &self.hosts, .roots = &self.roots, .initialization = &self.initialization };
    }
};

test "module plan retains complete tables but selects only root execution closure" {
    const fixture: Fixture = .{};
    const plan = try derive(fixture.tables(), &fixture.functions);
    for (0..8) |index| try std.testing.expectEqual(index < 6, plan.functionActive(index));
    for (0..5) |index| try std.testing.expectEqual(index < 4, plan.moduleActive(index));
    for (0..3) |index| try std.testing.expectEqual(index < 2, plan.hostRequired(index));
    try std.testing.expect(plan.hasRequiredHosts());
    try std.testing.expect(!plan.functionActive(512));
    try std.testing.expect(!plan.moduleActive(128));
    try std.testing.expect(!plan.hostRequired(128));
}

test "module plan initialization follows root list then UTF8 retained owner order" {
    var fixture: Fixture = .{};
    fixture.sources[2].path = "/\xc3\xa4.ts";
    fixture.sources[3].path = "/z.ts";
    fixture.initialization = .{ 2, 0, 5, 4 };
    _ = try derive(fixture.tables(), &fixture.functions);
    var tables = fixture.tables();
    tables.roots = &.{ .{ .kind = 1, .source_index = 4, .function_index = 7 }, .{ .source_index = 0, .function_index = 1 } };
    tables.initialization = &.{ 7, 2, 0, 5, 4 };
    const plan = try derive(tables, &fixture.functions);
    try std.testing.expect(plan.moduleActive(4));
    try std.testing.expect(plan.hostRequired(2));
    // Code retention still does not activate an uncalled ordinary function.
    try std.testing.expect(!plan.functionActive(6));
}

test "module plan rejects omitted excess and reordered initialization" {
    const fixture: Fixture = .{};
    var tables = fixture.tables();
    tables.initialization = &.{ 2, 0, 4 };
    try std.testing.expectError(error.InvalidInitialization, derive(tables, &fixture.functions));
    tables.initialization = &.{ 2, 0, 4, 5, 7 };
    try std.testing.expectError(error.InvalidInitialization, derive(tables, &fixture.functions));
    tables.initialization = &.{ 0, 2, 4, 5 };
    try std.testing.expectError(error.InvalidInitialization, derive(tables, &fixture.functions));
    tables.initialization = &.{};
    try std.testing.expectError(error.InvalidInitialization, derive(tables, &fixture.functions));
}

test "module plan rejects malformed edges even in dead functions" {
    var fixture: Fixture = .{};
    fixture.functions[6].instructions = &.{.{ .opcode = 27, .left = 8 }};
    try std.testing.expectError(error.InvalidCallTarget, derive(fixture.tables(), &fixture.functions));
    fixture.functions[6].instructions = &.{.{ .opcode = 27, .left = 7 }};
    try std.testing.expectError(error.InvalidInitialization, derive(fixture.tables(), &fixture.functions));
    fixture.functions[6].instructions = &.{.{ .opcode = 29, .left = 1 }};
    try std.testing.expectError(error.InvalidGlobal, derive(fixture.tables(), &fixture.functions));
    fixture.functions[6].instructions = &.{.{ .opcode = 31, .left = 3 }};
    try std.testing.expectError(error.InvalidHost, derive(fixture.tables(), &fixture.functions));
}

test "module plan rejects malformed module owners dependencies roots and bounds" {
    var fixture: Fixture = .{};
    fixture.modules[4].dependencies = &.{5};
    try std.testing.expectError(error.InvalidDependency, derive(fixture.tables(), &fixture.functions));
    fixture.modules[4].dependencies = &.{ 1, 1 };
    try std.testing.expectError(error.InvalidDependency, derive(fixture.tables(), &fixture.functions));
    fixture.modules[4].dependencies = &.{};
    fixture.modules[4].initializer = 8;
    try std.testing.expectError(error.InvalidInitialization, derive(fixture.tables(), &fixture.functions));
    fixture.modules[4].initializer = 7;
    fixture.functions[6].info.source_index = 5;
    try std.testing.expectError(error.InvalidSource, derive(fixture.tables(), &fixture.functions));
    fixture.functions[6].info.source_index = 4;
    fixture.roots[0].function_index = 8;
    try std.testing.expectError(error.InvalidRoot, derive(fixture.tables(), &fixture.functions));
    fixture.roots[0].function_index = 0;
    try std.testing.expectError(error.InvalidRoot, derive(fixture.tables(), &fixture.functions));
    fixture.roots[0].function_index = 1;
    var tables = fixture.tables();
    tables.sources = &.{};
    try std.testing.expectError(error.InvalidCount, derive(tables, &fixture.functions));
    tables = fixture.tables();
    tables.roots = &.{};
    try std.testing.expectError(error.InvalidCount, derive(tables, &fixture.functions));
    try std.testing.expectError(error.InvalidCount, derive(fixture.tables(), &[_]Fixture.Function{}));
}

test "module plan unused Host declarations impose no required grant" {
    var fixture: Fixture = .{};
    fixture.functions[1].instructions = &.{.{ .opcode = 27, .left = 3 }};
    fixture.functions[3].instructions = &.{};
    var tables = fixture.tables();
    tables.initialization = &.{ 2, 0, 4 };
    const plan = try derive(tables, &fixture.functions);
    try std.testing.expect(!plan.hasRequiredHosts());
    for (0..3) |index| try std.testing.expect(!plan.hostRequired(index));
}
