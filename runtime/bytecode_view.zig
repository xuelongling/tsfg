// SPDX-License-Identifier: MIT
const std = @import("std");
const model = @import("bytecode_model.zig");
const Allocator = std.mem.Allocator;
const contract = model.contract;
const module_format = model.module_format;
const FunctionId = model.FunctionId;
const VerifiedModule = model.VerifiedModule;
const Source = model.Source;
const ModuleInfo = model.ModuleInfo;
const Instruction = model.Instruction;
const Parameter = model.Parameter;
const Block = model.Block;
const Function = model.Function;
const Module = model.Module;
const LoadFailure = model.LoadFailure;
const LoadOutcome = model.LoadOutcome;
const decoded = model.decoded;

/// Text slices remain valid until unload; evaluation never borrows caller input.
pub fn moduleInfo(module: *const VerifiedModule) ModuleInfo {
    return decoded(module).info;
}

/// Only loader-verified instructions are exposed, owned until unload.
pub fn instructions(module: *const VerifiedModule) []const Instruction {
    return decoded(module).functions[0].instructions;
}

pub fn blockTable(module: *const VerifiedModule) []const Block {
    return decoded(module).functions[0].blocks;
}
pub fn functions(module: *const VerifiedModule) []const Function {
    return decoded(module).functions;
}

pub fn moduleTables(module: *const VerifiedModule) module_format.Tables {
    return decoded(module).tables;
}

/// Runtime-private borrowed views avoid copying complete verified tables or
/// descriptors into every Debug admission temporary. The verified module must
/// outlive the serial instance; these views never authorize mutation.
pub fn moduleTablesView(module: *const VerifiedModule) *const module_format.Tables {
    return &decoded(module).tables;
}
pub fn moduleInfoView(module: *const VerifiedModule) *const ModuleInfo {
    return &decoded(module).info;
}

pub fn serialize(module: *const VerifiedModule, allocator: Allocator) Allocator.Error![]u8 {
    return allocator.dupe(u8, decoded(module).bytes);
}

pub fn digestText(value: [32]u8) [71]u8 {
    var text: [71]u8 = undefined;
    @memcpy(text[0..7], "sha256:");
    @memcpy(text[7..], &std.fmt.bytesToHex(value, .lower));
    return text;
}

fn inspectFunction(module: *const VerifiedModule, function: Function, allocator: Allocator) Allocator.Error![]u8 {
    const info = function.info;
    const function_id = digestText(info.function_id);
    const input_identity = digestText(info.input_identity);
    const signature_hash = digestText(info.signature_hash);
    const type_id = digestText(info.type_id);
    const source_hash = digestText(info.source.hash);
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const temporary = arena.allocator();
    const View = struct { codeUnits: ?[]const u16 = null, third: ?u16 = null, opcode: []const u8, type: []const u8, register: []const u8, immediate: ?[]const u8 = null, left: ?[]const u8 = null, right: ?[]const u8 = null, target: ?[]const u8 = null, trueTarget: ?[]const u8 = null, falseTarget: ?[]const u8 = null, arguments: ?[]const []const u8 = null, trueArguments: ?[]const []const u8 = null, falseArguments: ?[]const []const u8 = null, event: ?[]const u8 = null, start: []const u8, end: []const u8 };
    const views = try temporary.alloc(View, info.instruction_count);
    for (function.instructions, views) |op, *view| {
        const names = [_][]const u8{ "add", "sub", "mul", "div", "rem", "shl", "shr", "ushr", "and", "or", "xor", "neg", "not", "bool_not", "eq", "ne", "lt", "le", "gt", "ge" };
        view.* = .{ .opcode = switch (op.opcode) {
            1 => "const_i32",
            2 => if (op.type_code == 14) "return_string" else if (op.type_code == 1) "return_i32" else if (op.type_code == 2) "return_bool" else if (contract.floatType(op.type_code)) "return_float" else "return_integer",
            3 => "const_bool",
            4...23 => names[op.opcode - 4],
            24 => "br",
            25 => "cond_br",
            26 => "fuel",
            27 => "call",
            28 => "const_integer",
            29 => "global_load",
            30 => "global_store",
            31 => "authorized_host",
            32 => "const_float",
            33 => "pos",
            34 => "string_constant",
            35 => "string_concat",
            36 => "string_length",
            37 => "string_code_unit",
            38 => "string_slice",
            39 => "string_compare",
            else => unreachable,
        }, .type = contract.typeName(op.type_code), .register = try std.fmt.allocPrint(temporary, "{d}", .{op.register}), .start = try std.fmt.allocPrint(temporary, "{d}", .{op.source.start}), .end = try std.fmt.allocPrint(temporary, "{d}", .{op.source.end}) };
        if (op.opcode == 34) view.codeUnits = op.code_units;
        if (op.opcode == 38) view.third = op.third;
        if (op.opcode == 1 or op.opcode == 3) view.immediate = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode == 28) view.immediate = if (contract.signedType(op.type_code)) try std.fmt.allocPrint(temporary, "{d}", .{contract.signedValue(op.literal_bits, op.type_code)}) else try std.fmt.allocPrint(temporary, "{d}", .{op.literal_bits});
        if (op.opcode == 32) view.immediate = if (op.type_code == 12) try std.fmt.allocPrint(temporary, "{x:0>8}", .{op.literal_bits}) else try std.fmt.allocPrint(temporary, "{x:0>16}", .{op.literal_bits});
        if ((op.opcode >= 4 and op.opcode <= 23) or op.opcode == 33 or (op.opcode >= 35 and op.opcode <= 39)) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if ((op.opcode < 15 or op.opcode > 17) and op.opcode != 33 and op.opcode != 36) view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
        if (op.opcode >= 29 and op.opcode <= 31) {
            view.left = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            view.right = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
        }
        if (op.opcode == 26) view.event = try std.fmt.allocPrint(temporary, "{d}", .{op.immediate});
        if (op.opcode == 27) {
            view.target = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            const arguments = try temporary.alloc([]const u8, op.edges[0].len);
            for (op.edges[0], arguments) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
            view.arguments = arguments;
        }
        if (op.opcode == 24 or op.opcode == 25) {
            const first_args = try temporary.alloc([]const u8, op.edges[0].len);
            for (op.edges[0], first_args) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
            const first_target = try std.fmt.allocPrint(temporary, "{d}", .{op.left});
            if (op.opcode == 24) {
                view.target = first_target;
                view.arguments = first_args;
            } else {
                view.trueTarget = first_target;
                view.trueArguments = first_args;
                view.falseTarget = try std.fmt.allocPrint(temporary, "{d}", .{op.right});
                const second_args = try temporary.alloc([]const u8, op.edges[1].len);
                for (op.edges[1], second_args) |argument, *text| text.* = try std.fmt.allocPrint(temporary, "{d}", .{argument});
                view.falseArguments = second_args;
            }
        }
    }
    const ParameterView = struct { register: []const u8, type: []const u8 };
    const BlockView = struct { parameters: []ParameterView, instructionStart: []const u8, instructionCount: []const u8 };
    const block_views = try temporary.alloc(BlockView, info.block_count);
    for (function.blocks, block_views) |block, *view| {
        const parameters = try temporary.alloc(ParameterView, block.parameters.len);
        for (block.parameters, parameters) |parameter, *parameter_view| parameter_view.* = .{ .register = try std.fmt.allocPrint(temporary, "{d}", .{parameter.register}), .type = contract.typeName(parameter.type_code) };
        view.* = .{ .parameters = parameters, .instructionStart = try std.fmt.allocPrint(temporary, "{d}", .{block.start}), .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{block.count}) };
    }
    const parameter_types = try temporary.alloc([]const u8, info.parameter_types.len);
    for (info.parameter_types, parameter_types) |type_code, *type_name| type_name.* = contract.typeName(type_code);
    return std.json.Stringify.valueAlloc(allocator, .{
        .familyId = "tsfg.bytecode",
        .semver = "0.10.0",
        .schemaHash = "sha256:" ++ contract.schema_hash_hex,
        .target = contract.target,
        .triple = contract.triple,
        .llvmDataLayout = contract.data_layout,
        .i32Bytes = "4",
        .i32Align = "4",
        .pointerBits = "64",
        .pointerAlign = "8",
        .capabilities = "51",
        .totalBytes = try std.fmt.allocPrint(temporary, "{d}", .{decoded(module).bytes.len}),
        .inputIdentity = @as([]const u8, &input_identity),
        .functionId = @as([]const u8, &function_id),
        .signatureHash = @as([]const u8, &signature_hash),
        .typeId = @as([]const u8, &type_id),
        .source = .{ .path = info.source.path, .hash = @as([]const u8, &source_hash), .utf16Length = try std.fmt.allocPrint(temporary, "{d}", .{info.source_utf16_length}) },
        .functionName = info.function_name,
        .sourceIndex = try std.fmt.allocPrint(temporary, "{d}", .{info.source_index}),
        .initializer = info.initializer,
        .functionStart = try std.fmt.allocPrint(temporary, "{d}", .{info.function_start}),
        .functionEnd = try std.fmt.allocPrint(temporary, "{d}", .{info.function_end}),
        .returnType = contract.typeName(info.return_type),
        .parameterCount = try std.fmt.allocPrint(temporary, "{d}", .{info.parameter_types.len}),
        .parameterTypes = parameter_types,
        .registerCount = try std.fmt.allocPrint(temporary, "{d}", .{info.register_count}),
        .blockCount = try std.fmt.allocPrint(temporary, "{d}", .{info.block_count}),
        .instructionCount = try std.fmt.allocPrint(temporary, "{d}", .{info.instruction_count}),
        .blocks = block_views,
        .instructions = views,
    }, .{ .emit_null_optional_fields = false });
}

fn inspectTables(tables: module_format.Tables, allocator: Allocator) Allocator.Error![]u8 {
    const SourceView = struct { path: []const u8, hash: []const u8, utf16Length: []const u8 };
    const ModuleView = struct { id: []const u8, sourceIndex: []const u8, initializer: []const u8, dependencies: []const []const u8 };
    const GlobalView = struct { id: []const u8, sourceIndex: []const u8, name: []const u8, bindingKind: []const u8, type: []const u8, writable: bool, start: []const u8, end: []const u8 };
    const HostView = struct { id: []const u8, sourceIndex: []const u8, name: []const u8, capabilityId: []const u8, signatureHash: []const u8, start: []const u8, end: []const u8 };
    const RootView = struct { kind: []const u8, sourceIndex: []const u8, name: []const u8, functionIndex: []const u8 };
    const sources = try allocator.alloc(SourceView, tables.sources.len);
    for (tables.sources, sources) |entry, *view| view.* = .{ .path = entry.path, .hash = try allocator.dupe(u8, &digestText(entry.hash)), .utf16Length = try std.fmt.allocPrint(allocator, "{d}", .{entry.length}) };
    const modules = try allocator.alloc(ModuleView, tables.modules.len);
    for (tables.modules, modules) |entry, *view| {
        const dependencies = try allocator.alloc([]const u8, entry.dependencies.len);
        for (entry.dependencies, dependencies) |value, *text| text.* = try std.fmt.allocPrint(allocator, "{d}", .{value});
        view.* = .{ .id = try allocator.dupe(u8, &digestText(entry.id)), .sourceIndex = try std.fmt.allocPrint(allocator, "{d}", .{entry.source_index}), .initializer = try std.fmt.allocPrint(allocator, "{d}", .{entry.initializer}), .dependencies = dependencies };
    }
    const globals = try allocator.alloc(GlobalView, tables.globals.len);
    for (tables.globals, globals) |entry, *view| view.* = .{ .id = try allocator.dupe(u8, &digestText(entry.id)), .sourceIndex = try std.fmt.allocPrint(allocator, "{d}", .{entry.source_index}), .name = entry.name, .bindingKind = if(entry.generated) "default-export-expression" else "source", .type = contract.typeName(entry.type_code), .writable = entry.writable, .start = try std.fmt.allocPrint(allocator, "{d}", .{entry.start}), .end = try std.fmt.allocPrint(allocator, "{d}", .{entry.end}) };
    const hosts = try allocator.alloc(HostView, tables.hosts.len);
    for (tables.hosts, hosts) |entry, *view| view.* = .{ .id = try allocator.dupe(u8, &digestText(entry.id)), .sourceIndex = try std.fmt.allocPrint(allocator, "{d}", .{entry.source_index}), .name = entry.name, .capabilityId = try std.fmt.allocPrint(allocator, "{d}", .{entry.capability}), .signatureHash = try allocator.dupe(u8, &digestText(entry.signature)), .start = try std.fmt.allocPrint(allocator, "{d}", .{entry.start}), .end = try std.fmt.allocPrint(allocator, "{d}", .{entry.end}) };
    const root_kinds = [_][]const u8{ "application", "module-initialization", "host-export", "host-callback", "hot-function", "kernel" };
    const roots = try allocator.alloc(RootView, tables.roots.len);
    for (tables.roots, roots) |entry, *view| view.* = .{ .kind = root_kinds[entry.kind], .sourceIndex = try std.fmt.allocPrint(allocator, "{d}", .{entry.source_index}), .name = entry.name, .functionIndex = try std.fmt.allocPrint(allocator, "{d}", .{entry.function_index}) };
    const initialization = try allocator.alloc([]const u8, tables.initialization.len);
    for (tables.initialization, initialization) |value, *text| text.* = try std.fmt.allocPrint(allocator, "{d}", .{value});
    return std.json.Stringify.valueAlloc(allocator, .{ .sources = sources, .modules = modules, .globals = globals, .hosts = hosts, .roots = roots, .initialization = initialization }, .{});
}

pub fn inspect(module: *const VerifiedModule, allocator: Allocator) Allocator.Error![]u8 {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const temp = arena.allocator();
    var views: std.array_list.Managed(std.json.Value) = .init(temp);
    for (functions(module)) |function| {
        const bytes = try inspectFunction(module, function, temp);
        const parsed = std.json.parseFromSlice(std.json.Value, temp, bytes, .{ .allocate = .alloc_always }) catch return error.OutOfMemory;
        try views.append(parsed.value);
    }
    var top = views.items[0];
    top.object = try top.object.clone(temp);
    try top.object.put(temp, "functions", .{ .array = views });
    const tables = moduleTables(module);
    try top.object.put(temp, "moduleMode", .{ .string = if (tables.present) "modules" else "single-source" });
    if (tables.present) {
        const bytes = try inspectTables(tables, temp);
        const parsed = std.json.parseFromSlice(std.json.Value, temp, bytes, .{ .allocate = .alloc_always }) catch return error.OutOfMemory;
        try top.object.put(temp, "moduleTables", parsed.value);
    }
    return std.json.Stringify.valueAlloc(allocator, top, .{});
}
