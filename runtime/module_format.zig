// SPDX-License-Identifier: MIT
const std = @import("std");
const contract = @import("contract.zig");
const module_plan = @import("module-plan.zig");
const Hash = [32]u8;
const Sha256 = std.crypto.hash.sha2.Sha256;
pub const Source = struct { path: []const u8, hash: Hash, start: u32, end: u32 };
pub const SourceFile = struct { path: []const u8, hash: Hash, length: u32 };
pub const ModuleDeclaration = struct { id: Hash, source_index: u16, initializer: u16, dependencies: []const u16 };
pub const GlobalDeclaration = struct { id: Hash, source_index: u16, name: []const u8, type_code: u8, writable: bool, generated: bool, start: u32, end: u32 };
pub const HostDeclaration = struct { id: Hash, source_index: u16, name: []const u8, capability: u32, signature: Hash, start: u32, end: u32 };
pub const Root = struct { kind: u8, source_index: u16, name: []const u8, function_index: u16 };
pub const Tables = struct {
    present: bool = false,
    sources: []const SourceFile = &.{},
    modules: []const ModuleDeclaration = &.{},
    globals: []const GlobalDeclaration = &.{},
    hosts: []const HostDeclaration = &.{},
    roots: []const Root = &.{},
    initialization: []const u16 = &.{},
    plan: module_plan.Plan = .{},
};
pub fn identity(parts: []const []const u8) Hash {
    var hash = Sha256.init(.{});
    for (parts) |part| hash.update(part);
    var result: Hash = undefined; hash.final(&result); return result;
}
// Paths are logical source metadata; colon never selects a host drive.
pub fn validSourcePath(path: []const u8, allow_declarations: bool) bool {
    if (path.len == 0 or path.len > 4096 or !std.unicode.utf8ValidateSlice(path) or std.mem.indexOfScalar(u8, path, 0) != null
        or !allow_declarations and std.mem.endsWith(u8, path, ".d.ts") or path[0] != '/' or !std.mem.endsWith(u8, path, ".ts") or std.mem.indexOfScalar(u8, path, '\\') != null) return false;
    var parts = std.mem.splitScalar(u8, path[1..], '/');
    while (parts.next()) |part| if (part.len == 0 or std.mem.eql(u8, part, ".") or std.mem.eql(u8, part, "..")) return false;
    return true;
}
fn count(reader: anytype, maximum: u16, minimum: u16) !u16 {
    const value = try reader.int(u16);
    if (value < minimum or value > maximum) return reader.reject("r04-module-count", reader.offset - 2);
    return value;
}
fn sourceIndex(reader: anytype, tables: Tables) !u16 {
    const index = try reader.int(u16);
    if (index >= tables.sources.len) return reader.reject("r04-module-source", reader.offset - 2);
    return index;
}
fn owns(tables: Tables, index: u16) bool {
    for (tables.modules) |module| if (module.source_index == index) return true;
    return false;
}
fn range(reader: anytype, tables: Tables, source: u16, start: u32, end: u32) !void {
    if (start >= end or end > tables.sources[source].length) return reader.reject("r04-source-range", reader.offset - 8);
}

pub fn parse(reader: anytype, allocator: std.mem.Allocator) !Tables {
    const mode = try reader.int(u8);
    if (mode > 1) return reader.reject("r04-module-mode", reader.offset - 1);
    if (mode == 0) return .{};
    var tables: Tables = .{ .present = true };
    const sources = try allocator.alloc(SourceFile, try count(reader, 128, 1));
    for (sources, 0..) |*source, index| {
        source.* = .{ .hash = try reader.digest(), .path = try reader.string(4096), .length = try reader.int(u32) };
        if (!validSourcePath(source.path, true)) return reader.reject("r04-module-source", reader.offset);
        for (sources[0..index]) |previous| if (std.mem.eql(u8, source.path, previous.path)) return reader.reject("r04-module-source", reader.offset);
    }
    tables.sources = sources;
    const modules = try allocator.alloc(ModuleDeclaration, try count(reader, 128, 1));
    for (modules, 0..) |*module, index| {
        const id = try reader.digest(); const source = try sourceIndex(reader, tables); const initializer = try reader.int(u16);
        if (std.mem.endsWith(u8, sources[source].path, ".d.ts") or !std.mem.eql(u8, &id, &identity(&.{ "tsfg.module\x00", sources[source].path }))) return reader.reject("r04-module-identity", reader.offset);
        for (modules[0..index]) |previous| if (previous.source_index == source or previous.initializer == initializer) return reader.reject("r04-module-identity", reader.offset);
        const dependencies = try allocator.alloc(u16, try count(reader, 128, 0));
        for (dependencies, 0..) |*dependency, position| {
            dependency.* = try reader.int(u16);
            if (dependency.* >= modules.len or std.mem.indexOfScalar(u16, dependencies[0..position], dependency.*) != null) return reader.reject("r04-module-dependency", reader.offset);
        }
        module.* = .{ .id = id, .source_index = source, .initializer = initializer, .dependencies = dependencies };
    }
    tables.modules = modules;
    const globals = try allocator.alloc(GlobalDeclaration, try count(reader, 4096, 0));
    for (globals, 0..) |*global, index| {
        const id = try reader.digest(); const source = try sourceIndex(reader, tables); const name = try reader.string(4096);
        const type_code = try reader.int(u8); const flags = try reader.int(u8); const start = try reader.int(u32); const end = try reader.int(u32);
        if (!owns(tables, source) or !contract.validType(type_code) or flags > 2) return reader.reject("r04-module-global", reader.offset);
        try range(reader, tables, source, start, end);
        var expected = identity(&.{ "tsfg.global\x00", sources[source].path, "\x00", name, "\x00", contract.typeName(type_code) });
        if (flags == 2) {
            const source_hex = std.fmt.bytesToHex(sources[source].hash, .lower);
            const module_hex = std.fmt.bytesToHex(identity(&.{ "tsfg.module\x00", sources[source].path }), .lower);
            var start_buffer: [10]u8 = undefined; var end_buffer: [10]u8 = undefined;
            const start_text = std.fmt.bufPrint(&start_buffer, "{d}", .{start}) catch return reader.reject("r04-module-global", reader.offset);
            const end_text = std.fmt.bufPrint(&end_buffer, "{d}", .{end}) catch return reader.reject("r04-module-global", reader.offset);
            expected = identity(&.{ "tsfg.default-export-binding.v1\x00", sources[source].path, "\x00sha256:", &source_hex,
                "\x00sha256:", &module_hex, "\x00", contract.typeName(type_code), "\x00", start_text, "\x00", end_text });
            for (globals[0..index]) |previous| if (previous.generated and previous.source_index == source) return reader.reject("r04-module-global", reader.offset);
        }
        if (!std.mem.eql(u8, &id, &expected)) return reader.reject("r04-module-global", reader.offset);
        for (globals[0..index]) |previous| if (std.mem.eql(u8, &id, &previous.id)) return reader.reject("r04-module-global", reader.offset);
        global.* = .{ .id = id, .source_index = source, .name = name, .type_code = type_code, .writable = flags == 1, .generated = flags == 2, .start = start, .end = end };
    }
    tables.globals = globals;
    const hosts = try allocator.alloc(HostDeclaration, try count(reader, 128, 0));
    for (hosts, 0..) |*host, index| {
        const id = try reader.digest(); const source = try sourceIndex(reader, tables); const name = try reader.string(4096);
        const capability = try reader.int(u32); const signature = try reader.digest(); const start = try reader.int(u32); const end = try reader.int(u32);
        const hex = std.fmt.bytesToHex(signature, .lower);
        if (!std.mem.endsWith(u8, sources[source].path, ".d.ts") or capability != 31
            or !std.mem.eql(u8, &signature, &identity(&.{"tsfg.signature\x00(i32)->i32"}))
            or !std.mem.eql(u8, &id, &identity(&.{ "tsfg.host\x00", sources[source].path, "\x00", name, "\x00sha256:", &hex }))) return reader.reject("r04-module-host", reader.offset);
        try range(reader, tables, source, start, end);
        for (hosts[0..index]) |previous| if (std.mem.eql(u8, &id, &previous.id)) return reader.reject("r04-module-host", reader.offset);
        host.* = .{ .id = id, .source_index = source, .name = name, .capability = capability, .signature = signature, .start = start, .end = end };
    }
    tables.hosts = hosts;
    const roots = try allocator.alloc(Root, try count(reader, 128, 1));
    for (roots, 0..) |*root, index| {
        root.* = .{ .kind = try reader.int(u8), .source_index = try sourceIndex(reader, tables), .name = try reader.string(4096), .function_index = try reader.int(u16) };
        if (root.kind >= 6 or !owns(tables, root.source_index) or root.kind == 1 and !std.mem.eql(u8, root.name, "$moduleInit")) return reader.reject("r04-module-root", reader.offset);
        for (roots[0..index]) |previous| if (root.kind == previous.kind and root.source_index == previous.source_index and std.mem.eql(u8, root.name, previous.name)) return reader.reject("r04-module-root", reader.offset);
    }
    tables.roots = roots;
    const initialization = try allocator.alloc(u16, try count(reader, @intCast(modules.len), 0));
    for (initialization, 0..) |*function, index| {
        function.* = try reader.int(u16);
        if (std.mem.indexOfScalar(u16, initialization[0..index], function.*) != null) return reader.reject("r04-module-initialization", reader.offset);
    }
    tables.initialization = initialization;
    return tables;
}

pub fn verify(reader: anytype, verified: *Tables, functions: anytype) !void {
    const tables = verified.*;
    if (!tables.present) return;
    for (tables.modules) |module| {
        if (module.initializer >= functions.len) return reader.reject("r04-module-initialization", reader.offset);
        const info = functions[module.initializer].info;
        if (!info.initializer or info.source_index != module.source_index or !std.mem.eql(u8, info.function_name, "$moduleInit")
            or info.return_type != 1 or info.parameter_types.len != 0 or info.function_start != 0 or info.function_end != tables.sources[module.source_index].length) return reader.reject("r04-module-initialization", reader.offset);
    }
    for (functions, 0..) |function, index| {
        if (!owns(tables, function.info.source_index)) return reader.reject("r04-module-source", reader.offset);
        var association: usize = 0;
        for (tables.modules) |module| if (module.initializer == index) { association += 1; };
        if (function.info.initializer != (association == 1)) return reader.reject("r04-module-initialization", reader.offset);
        for (function.instructions) |op| {
            if (op.opcode == 27) {
                if (op.left >= functions.len) return reader.reject("r04-call-target", reader.offset);
                if (functions[op.left].info.initializer) return reader.reject("r04-module-initialization", reader.offset);
            }
            if (op.opcode == 29 or op.opcode == 30) {
                if (op.left >= tables.globals.len) return reader.reject("r04-module-global", reader.offset);
                const global = tables.globals[op.left];
                if (op.type_code != global.type_code or op.opcode == 29 and op.right != 0 or op.opcode == 30 and op.right > 1
                    or op.opcode == 30 and op.right == 0 and !global.writable
                    or op.opcode == 30 and op.right == 1 and (!function.info.initializer or function.info.source_index != global.source_index)) return reader.reject("r04-module-global", reader.offset);
            }
            if (op.opcode == 31 and (op.left >= tables.hosts.len or op.type_code != 1)) return reader.reject("r04-module-host", reader.offset);
        }
    }
    for (tables.roots) |root| {
        if (root.function_index >= functions.len or functions[root.function_index].info.initializer != (root.kind == 1)) return reader.reject("r04-module-root", reader.offset);
        if (root.kind == 1 and functions[root.function_index].info.source_index != root.source_index) return reader.reject("r04-module-root", reader.offset);
    }
    verified.plan = module_plan.derive(tables, functions) catch |err| return reader.reject(switch (err) {
        error.InvalidCount => "r04-module-count",
        error.InvalidSource => "r04-module-source",
        error.InvalidDependency => "r04-module-dependency",
        error.InvalidInitialization => "r04-module-initialization",
        error.InvalidRoot => "r04-module-root",
        error.InvalidCallTarget => "r04-call-target",
        error.InvalidGlobal => "r04-module-global",
        error.InvalidHost => "r04-module-host",
    }, reader.offset);
}
