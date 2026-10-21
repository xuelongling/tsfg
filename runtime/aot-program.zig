// SPDX-License-Identifier: MIT
// Borrow only immutable linker data. This is not a descriptor loader: neither
// requests nor disk input can supply these pointers, code or compiled identity.
const std = @import("std");
const bytecode = @import("bytecode.zig");
const model = @import("bytecode_model.zig");
const format = @import("module_format.zig");
const contract = @import("contract.zig");
const Hash = [32]u8;
pub const Error = error{InvalidCompiledMetadata};

pub const Bytes = extern struct { data: ?[*]const u8, length: u32, reserved: u32 };
pub const Source = extern struct { path: Bytes, hash: Hash, length: u32, reserved: u32 };
pub const Function = extern struct {
    id: Hash, signature: Hash, type_id: Hash, name: Bytes,
    source: u32, start: u32, end: u32,
    registers: u16, instructions: u16, blocks: u16, result: u8, initializer: u8,
    physical_count: u16, logical_count: u16,
    parameter_types: ?[*]const u8, presence_masks: ?[*]const u8,
};
pub const Module = extern struct {
    id: Hash, source: u32, initializer: u32, dependency_count: u32, selected: u32,
    dependencies: ?[*]const u16,
};
pub const Global = extern struct {
    id: Hash, name: Bytes, source: u32, start: u32, end: u32,
    type_code: u8, writable: u8, generated: u8, reserved: u8,
};
pub const Host = extern struct {
    id: Hash, signature: Hash, name: Bytes,
    source: u32, capability: u32, start: u32, end: u32, required: u32, reserved: u32,
};
pub const Root = extern struct { kind: u32, source: u32, function: u32, reserved: u32, name: Bytes };
pub const Program = extern struct {
    version: u32, bytes: u32, compiled_table_id: Hash, input_identity: Hash,
    function_count: u32, source_count: u32, module_count: u32, global_count: u32,
    host_count: u32, root_count: u32, initialization_count: u32, default_function: u32,
    functions: ?[*]const Function, sources: ?[*]const Source, modules: ?[*]const Module,
    globals: ?[*]const Global, hosts: ?[*]const Host, roots: ?[*]const Root,
    initialization: ?[*]const u16,
};
extern const tsfg_aot_program_v1: Program;
extern const tsfg_aot_compiled_table_id_v4: Hash;

fn slice(comptime T: type, pointer: ?[*]const T, count: usize) Error![]const T {
    const data = pointer orelse {
        if (count != 0) return error.InvalidCompiledMetadata;
        return &.{};
    };
    const address = @intFromPtr(data);
    if (address % @alignOf(T) != 0 or count > (std.math.maxInt(usize) - address) / @sizeOf(T))
        return error.InvalidCompiledMetadata;
    return data[0..count];
}
fn text(bytes: Bytes) Error![]const u8 {
    if (bytes.reserved != 0 or bytes.length == 0 or bytes.length > 4096) return error.InvalidCompiledMetadata;
    const value = try slice(u8, bytes.data, bytes.length);
    if (!std.unicode.utf8ValidateSlice(value) or std.mem.indexOfScalar(u8, value, 0) != null) return error.InvalidCompiledMetadata;
    return value;
}
fn equal(a: Hash, b: Hash) bool { return std.mem.eql(u8, &a, &b); }
fn scalar(code: u8) bool { return code >= 1 and code <= 13; }
fn span(start: u32, end: u32, lower: u32, upper: u32) bool { return lower <= start and start < end and end <= upper; }
fn digest(parts: []const []const u8) Hash { return format.identity(parts); }
fn sourceView(source: Source, start: u32, end: u32) bytecode.Source {
    return .{ .path = text(source.path) catch unreachable, .hash = source.hash, .start = start, .end = end };
}

fn verifyFunction(function: Function, source: Source) Error!void {
    const name = try text(function.name);
    const path = try text(source.path);
    if (function.initializer > 1 or !scalar(function.result) or function.registers < 1 or function.registers > 4096
        or function.instructions < 1 or function.instructions > 8192 or function.blocks < 1 or function.blocks > 256
        or function.physical_count > 128 or function.logical_count > 64) return error.InvalidCompiledMetadata;
    const initializer = function.initializer == 1;
    if (!span(function.start, function.end, 0, source.length)
        and !(initializer and function.start == 0 and function.end == 0 and source.length == 0)) return error.InvalidCompiledMetadata;
    if (initializer and (!std.mem.eql(u8, name, "$moduleInit") or function.start != 0 or function.end != source.length
        or function.result != 1 or function.physical_count != 0 or function.logical_count != 0)) return error.InvalidCompiledMetadata;
    const types = try slice(u8, function.parameter_types, function.physical_count);
    const masks = try slice(u8, function.presence_masks, function.logical_count);
    for (types) |code| if (!scalar(code)) return error.InvalidCompiledMetadata;
    var signature = std.crypto.hash.sha2.Sha256.init(.{});
    signature.update("tsfg.signature\x00(");
    var physical: usize = 0;
    for (masks, 0..) |mask, index| {
        if (!model.validPresenceMask(mask) or physical >= types.len) return error.InvalidCompiledMetadata;
        if (index != 0) signature.update(",");
        signature.update(contract.typeName(types[physical]));
        physical += 1;
        if (mask != 0) {
            const suffix = [_]u8{ '@', '0', "0123456789abcdef"[mask] };
            signature.update(&suffix);
        }
        if (mask & 3 != 0) {
            if (physical >= types.len or types[physical] != 1) return error.InvalidCompiledMetadata;
            physical += 1;
        }
    }
    if (physical != types.len or function.registers < types.len) return error.InvalidCompiledMetadata;
    signature.update(")->"); signature.update(contract.typeName(function.result));
    var expected: Hash = undefined; signature.final(&expected);
    if (!equal(function.signature, expected) or !equal(function.type_id, digest(&.{ "tsfg.type\x00", contract.typeName(function.result) })))
        return error.InvalidCompiledMetadata;
    const signature_hex = std.fmt.bytesToHex(function.signature, .lower);
    if (initializer) {
        const source_hex = std.fmt.bytesToHex(source.hash, .lower);
        const module_hex = std.fmt.bytesToHex(digest(&.{ "tsfg.module\x00", path }), .lower);
        expected = digest(&.{ "tsfg.module-initializer.v1\x00", path, "\x00sha256:", &source_hex, "\x00sha256:", &module_hex, "\x00sha256:", &signature_hex });
    } else expected = digest(&.{ "tsfg.function\x00", path, "\x00", name, "\x00", &signature_hex });
    if (!equal(function.id, expected)) return error.InvalidCompiledMetadata;
}

fn verifyGlobal(global: Global, source: Source) Error!void {
    const name = try text(global.name);
    const path = try text(source.path);
    if (!scalar(global.type_code) or global.writable > 1 or global.generated > 1 or global.reserved != 0
        or global.writable == 1 and global.generated == 1 or !span(global.start, global.end, 0, source.length)) return error.InvalidCompiledMetadata;
    var expected = digest(&.{ "tsfg.global\x00", path, "\x00", name, "\x00", contract.typeName(global.type_code) });
    if (global.generated == 1) {
        const source_hex = std.fmt.bytesToHex(source.hash, .lower);
        const module_hex = std.fmt.bytesToHex(digest(&.{ "tsfg.module\x00", path }), .lower);
        var start_buffer: [10]u8 = undefined; var end_buffer: [10]u8 = undefined;
        const start = std.fmt.bufPrint(&start_buffer, "{d}", .{global.start}) catch unreachable;
        const end = std.fmt.bufPrint(&end_buffer, "{d}", .{global.end}) catch unreachable;
        expected = digest(&.{ "tsfg.default-export-binding.v1\x00", path, "\x00sha256:", &source_hex,
            "\x00sha256:", &module_hex, "\x00", contract.typeName(global.type_code), "\x00", start, "\x00", end });
    }
    if (!equal(global.id, expected)) return error.InvalidCompiledMetadata;
}

fn visit(modules: []const Module, index: usize, visited: *[128]bool, expected: *[128]u16, next: *usize) void {
    if (visited[index]) return;
    visited[index] = true;
    for (slice(u16, modules[index].dependencies, modules[index].dependency_count) catch unreachable) |dependency|
        visit(modules, dependency, visited, expected, next);
    expected[next.*] = @intCast(modules[index].initializer);
    next.* += 1;
}

pub const EntitySource = struct { id: bytecode.FunctionId, source: bytecode.Source };

// Move init's result into stable caller storage before borrowing either cache.
// find overwrites only selected_info; synchronous parse copies IDs and Source
// into outcomes and never retains a pointer to these two descriptor slots.
pub const Metadata = struct {
    program: *const Program,
    default_info: bytecode.ModuleInfo,
    selected_info: bytecode.ModuleInfo,

    pub fn init() Error!Metadata {
        const program = &tsfg_aot_program_v1;
        if (program.version != 1 or program.bytes != @sizeOf(Program) or program.default_function != 0
            or !equal(program.compiled_table_id, tsfg_aot_compiled_table_id_v4)
            or program.function_count < 1 or program.function_count > 512 or program.source_count < 1 or program.source_count > 128
            or program.module_count > 128 or program.global_count > 4096 or program.host_count > 128
            or program.root_count < 1 or program.root_count > 512 or program.initialization_count > program.module_count)
            return error.InvalidCompiledMetadata;
        const sources = try slice(Source, program.sources, program.source_count);
        const functions = try slice(Function, program.functions, program.function_count);
        const modules = try slice(Module, program.modules, program.module_count);
        const globals = try slice(Global, program.globals, program.global_count);
        const hosts = try slice(Host, program.hosts, program.host_count);
        const roots = try slice(Root, program.roots, program.root_count);
        const initialization = try slice(u16, program.initialization, program.initialization_count);
        for (sources, 0..) |source, index| {
            const path = try text(source.path);
            if (source.reserved != 0 or !format.validSourcePath(path, true)) return error.InvalidCompiledMetadata;
            for (sources[0..index]) |previous| if (std.mem.eql(u8, path, try text(previous.path))) return error.InvalidCompiledMetadata;
        }
        for (functions, 0..) |function, index| {
            if (function.source >= sources.len or std.mem.endsWith(u8, try text(sources[function.source].path), ".d.ts")) return error.InvalidCompiledMetadata;
            try verifyFunction(function, sources[function.source]);
            for (functions[0..index]) |previous| if (equal(previous.id, function.id)
                or previous.source == function.source and previous.initializer == function.initializer
                and std.mem.eql(u8, try text(previous.name), try text(function.name))) return error.InvalidCompiledMetadata;
        }
        var owners = [_]?usize{null} ** 128;
        var selected_count: usize = 0;
        for (modules, 0..) |module, index| {
            if (module.source >= sources.len or owners[module.source] != null or module.initializer >= functions.len
                or module.selected > 1 or module.dependency_count > 128) return error.InvalidCompiledMetadata;
            const path = try text(sources[module.source].path);
            if (std.mem.endsWith(u8, path, ".d.ts") or !equal(module.id, digest(&.{ "tsfg.module\x00", path }))) return error.InvalidCompiledMetadata;
            owners[module.source] = index;
            const function = functions[module.initializer];
            if (function.initializer != 1 or function.source != module.source) return error.InvalidCompiledMetadata;
            for (modules[0..index]) |previous| if (previous.initializer == module.initializer) return error.InvalidCompiledMetadata;
            const dependencies = try slice(u16, module.dependencies, module.dependency_count);
            for (dependencies, 0..) |dependency, position| {
                if (dependency >= modules.len or std.mem.indexOfScalar(u16, dependencies[0..position], dependency) != null
                    or module.selected == 1 and modules[dependency].selected != 1) return error.InvalidCompiledMetadata;
            }
            selected_count += module.selected;
        }
        if (modules.len == 0) {
            if (sources.len != 1 or globals.len != 0 or hosts.len != 0 or initialization.len != 0 or roots.len != functions.len)
                return error.InvalidCompiledMetadata;
            for (functions) |function| if (function.source != 0 or function.initializer != 0) return error.InvalidCompiledMetadata;
        } else for (functions, 0..) |function, index| {
            const owner = owners[function.source] orelse return error.InvalidCompiledMetadata;
            if ((function.initializer == 1) != (modules[owner].initializer == index)) return error.InvalidCompiledMetadata;
        }
        for (globals, 0..) |global, index| {
            if (global.source >= sources.len or owners[global.source] == null) return error.InvalidCompiledMetadata;
            try verifyGlobal(global, sources[global.source]);
            for (globals[0..index]) |previous| if (equal(global.id, previous.id)
                or global.generated == 1 and previous.generated == 1 and global.source == previous.source) return error.InvalidCompiledMetadata;
        }
        for (hosts, 0..) |host, index| {
            if (host.source >= sources.len or host.required > 1 or host.reserved != 0) return error.InvalidCompiledMetadata;
            const path = try text(sources[host.source].path);
            const name = try text(host.name);
            const signature_hex = std.fmt.bytesToHex(host.signature, .lower);
            if (!std.mem.endsWith(u8, path, ".d.ts") or !span(host.start, host.end, 0, sources[host.source].length)
                or !equal(host.id, digest(&.{ "tsfg.host\x00", path, "\x00", name, "\x00sha256:", &signature_hex }))
                or host.required == 1 and (host.capability != 31 or !equal(host.signature, digest(&.{"tsfg.signature\x00(i32)->i32"}))))
                return error.InvalidCompiledMetadata;
            for (hosts[0..index]) |previous| if (equal(host.id, previous.id)) return error.InvalidCompiledMetadata;
        }
        for (roots, 0..) |root, index| {
            const name = try text(root.name);
            if (root.reserved != 0 or root.kind >= 6 or root.source >= sources.len or root.function >= functions.len
                or (functions[root.function].initializer == 1) != (root.kind == 1)) return error.InvalidCompiledMetadata;
            if (root.kind == 1 and (functions[root.function].source != root.source or !std.mem.eql(u8, name, "$moduleInit")))
                return error.InvalidCompiledMetadata;
            if (modules.len == 0) {
                if (root.kind != 0 or root.source != 0 or !std.mem.eql(u8, name, try text(functions[root.function].name))) return error.InvalidCompiledMetadata;
                for (roots[0..index]) |previous| if (root.function == previous.function) return error.InvalidCompiledMetadata;
            } else {
                const owner = owners[root.source] orelse return error.InvalidCompiledMetadata;
                const target_owner = owners[functions[root.function].source] orelse return error.InvalidCompiledMetadata;
                if (modules[owner].selected != 1 or modules[target_owner].selected != 1) return error.InvalidCompiledMetadata;
            }
            for (roots[0..index]) |previous| if (root.kind == previous.kind and root.source == previous.source
                and std.mem.eql(u8, name, try text(previous.name))) return error.InvalidCompiledMetadata;
        }
        if (selected_count != initialization.len) return error.InvalidCompiledMetadata;
        var visited = [_]bool{false} ** 128;
        var expected: [128]u16 = undefined;
        var next: usize = 0;
        if (modules.len != 0) for (roots) |root| visit(modules, owners[root.source].?, &visited, &expected, &next);
        var order: [128]usize = undefined;
        var count: usize = 0;
        for (modules, 0..) |module, index| if (module.selected == 1) { order[count] = index; count += 1; };
        for (0..count) |a| for (a + 1..count) |b| {
            if (std.mem.order(u8, try text(sources[modules[order[a]].source].path), try text(sources[modules[order[b]].source].path)) == .gt)
                std.mem.swap(usize, &order[a], &order[b]);
        };
        for (order[0..count]) |index| visit(modules, index, &visited, &expected, &next);
        if (next != initialization.len or !std.mem.eql(u16, expected[0..next], initialization)) return error.InvalidCompiledMetadata;
        var metadata: Metadata = .{ .program = program, .default_info = undefined, .selected_info = undefined };
        metadata.default_info = metadata.info(0);
        return metadata;
    }

    pub fn info(self: *const Metadata, index: usize) bytecode.ModuleInfo {
        std.debug.assert(index < self.program.function_count);
        const function = self.program.functions.?[index];
        const source = self.program.sources.?[function.source];
        return .{ .function_id = function.id, .function_name = text(function.name) catch unreachable,
            .source = sourceView(source, function.start, function.end), .input_identity = self.program.input_identity,
            .signature_hash = function.signature, .type_id = function.type_id, .source_utf16_length = source.length,
            .function_start = function.start, .function_end = function.end, .return_type = function.result,
            .register_count = function.registers, .instruction_count = function.instructions, .block_count = function.blocks,
            // Compiled tables have no wire instruction offset; this view never decodes instructions.
            .instruction_offset = 0, .parameter_types = slice(u8, function.parameter_types, function.physical_count) catch unreachable,
            .presence_masks = slice(u8, function.presence_masks, function.logical_count) catch unreachable,
            .source_index = @intCast(function.source), .initializer = function.initializer == 1 };
    }
    pub fn defaultInfo(self: *const Metadata) *const bytecode.ModuleInfo { return &self.default_info; }
    pub fn find(self: *Metadata, id: bytecode.FunctionId) ?*const bytecode.ModuleInfo {
        for (0..self.program.function_count) |index| if (equal(id, self.program.functions.?[index].id)) {
            self.selected_info = self.info(index);
            return &self.selected_info;
        };
        return null;
    }
    pub fn rootIndex(self: *const Metadata, function_index: usize, init_only: bool) ?u32 {
        if (function_index >= self.program.function_count or (self.program.functions.?[function_index].initializer == 1) != init_only) return null;
        for (0..self.program.root_count) |index| {
            const root = self.program.roots.?[index];
            if (root.function == function_index and (root.kind == 1) == init_only) return @intCast(index);
        }
        return null;
    }
    pub fn sourceForEntity(self: *const Metadata, entity: u32, source_index: u32, start: u32, end: u32) ?EntitySource {
        if (source_index >= self.program.source_count) return null;
        const source = self.program.sources.?[source_index];
        if (entity & 0x80000000 != 0) {
            const index = entity & 0x7fffffff;
            if (index >= self.program.host_count) return null;
            const host = self.program.hosts.?[index];
            // Host events carry the caller's callsite, not the declaration.
            // The execution bridge additionally checks its active function.
            if (!span(start, end, 0, source.length)) return null;
            return .{ .id = host.id, .source = sourceView(source, start, end) };
        }
        if (entity >= self.program.function_count) return null;
        const function = self.program.functions.?[entity];
        if (source_index != function.source) return null;
        if (!span(start, end, function.start, function.end)
            and !(function.initializer == 1 and function.start == 0 and function.end == 0 and start == 0 and end == 0)) return null;
        return .{ .id = function.id, .source = sourceView(source, start, end) };
    }
};

fn layout(comptime T: type, comptime size: usize, comptime names: anytype, comptime offsets: anytype) void {
    if (@sizeOf(T) != size or @alignOf(T) != 8) @compileError("compiled metadata size/alignment differs from aot-program.h");
    inline for (names, offsets) |name, offset| if (@offsetOf(T, name) != offset) @compileError("compiled metadata field offset differs from aot-program.h");
}
comptime {
    if (@sizeOf(usize) != 8) @compileError("compiled metadata requires Win64 pointers");
    layout(Bytes, 16, .{ "data", "length", "reserved" }, .{ 0, 8, 12 });
    layout(Source, 56, .{ "path", "hash", "length", "reserved" }, .{ 0, 16, 48, 52 });
    layout(Function, 152, .{ "id", "signature", "type_id", "name", "source", "start", "end", "registers", "instructions", "blocks", "result", "initializer", "physical_count", "logical_count", "parameter_types", "presence_masks" },
        .{ 0, 32, 64, 96, 112, 116, 120, 124, 126, 128, 130, 131, 132, 134, 136, 144 });
    layout(Module, 56, .{ "id", "source", "initializer", "dependency_count", "selected", "dependencies" }, .{ 0, 32, 36, 40, 44, 48 });
    layout(Global, 64, .{ "id", "name", "source", "start", "end", "type_code", "writable", "generated", "reserved" }, .{ 0, 32, 48, 52, 56, 60, 61, 62, 63 });
    layout(Host, 104, .{ "id", "signature", "name", "source", "capability", "start", "end", "required", "reserved" }, .{ 0, 32, 64, 80, 84, 88, 92, 96, 100 });
    layout(Root, 32, .{ "kind", "source", "function", "reserved", "name" }, .{ 0, 4, 8, 12, 16 });
    layout(Program, 160, .{ "version", "bytes", "compiled_table_id", "input_identity", "function_count", "source_count", "module_count", "global_count", "host_count", "root_count", "initialization_count", "default_function", "functions", "sources", "modules", "globals", "hosts", "roots", "initialization" },
        .{ 0, 4, 8, 40, 72, 76, 80, 84, 88, 92, 96, 100, 104, 112, 120, 128, 136, 144, 152 });
}
