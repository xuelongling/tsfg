// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("root.zig");
const contract = @import("contract.zig");

const Request = struct {
    kind: []const u8 = "function",
    functionId: ?[]const u8 = null,
    signatureHash: ?[]const u8 = null,
    arguments: []const std.json.Value = &.{},
    capabilities: []const std.json.Value = &.{},
    memoryBytes: u64 = 16384,
    instructionBudget: u64 = 4097,
    semanticFuel: u64 = 4097,
    depth: u32 = 1,
    hostTimeNanos: ?u64 = null,
};

fn writeOutcome(writer: *std.Io.Writer, outcome: runtime.RequestOutcome, host: *const runtime.Runtime) !void {
    const function_id = switch (outcome) {
        .returned => |r| r.function_id,
        .failed => |r| r.function_id,
    };
    const source = switch (outcome) {
        .returned => |r| r.source,
        .failed => |r| r.source,
    };
    const function_hex = runtime.digestText(function_id);
    const source_hex = runtime.digestText(source.hash);
    var buffers: [6][32]u8 = undefined;
    const start = try std.fmt.bufPrint(&buffers[0], "{d}", .{source.start});
    const end = try std.fmt.bufPrint(&buffers[1], "{d}", .{source.end});
    const active = try std.fmt.bufPrint(&buffers[2], "{d}", .{host.activeRequests()});
    const fuel_remaining = try std.fmt.bufPrint(&buffers[4], "{d}", .{switch (outcome) {
        .returned => |r| r.fuel_remaining,
        .failed => |r| r.fuel_remaining,
    }});
    const fuel_consumed = try std.fmt.bufPrint(&buffers[5], "{d}", .{switch (outcome) {
        .returned => |r| r.fuel_consumed,
        .failed => |r| r.fuel_consumed,
    }});
    const source_view = .{ .path = source.path, .hash = @as([]const u8, &source_hex), .start = start, .end = end };
    switch (outcome) {
        .returned => |returned| {
            switch (returned.result) {
                .boolean => |value| try std.json.Stringify.value(.{ .status = "returned", .result = .{ .type = "bool", .value = value }, .source = source_view, .functionId = @as([]const u8, &function_hex), .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer),
                else => {
                    const code = returned.result.typeCode();
                    const text = if (contract.signedType(code)) try std.fmt.bufPrint(&buffers[3], "{d}", .{contract.signedValue(returned.result.bits(), code)}) else try std.fmt.bufPrint(&buffers[3], "{d}", .{returned.result.bits()});
                    try std.json.Stringify.value(.{ .status = "returned", .result = .{ .type = contract.typeName(code), .value = text }, .source = source_view, .functionId = @as([]const u8, &function_hex), .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer);
                },
            }
        },
        .failed => |failed| if (failed.exception_kind) |exception_kind| try std.json.Stringify.value(.{ .status = "exception", .code = failed.code, .category = failed.category, .exceptionKind = exception_kind, .ruleIds = failed.rule_ids, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer) else try std.json.Stringify.value(.{ .status = "failed", .code = failed.code, .category = failed.category, .ruleIds = failed.rule_ids, .functionId = @as([]const u8, &function_hex), .source = source_view, .activeRequests = active, .fuelRemaining = fuel_remaining, .fuelConsumed = fuel_consumed }, .{}, writer),
    }
}

fn writeModuleOutcome(writer: *std.Io.Writer, outcome: runtime.RequestOutcome, host: *const runtime.Runtime, instance: *const runtime.ModuleInstance, counter: *const runtime.Counter, events_before: u64) !void {
    var base: std.Io.Writer.Allocating = .init(host.allocator);
    defer base.deinit();
    try writeOutcome(&base.writer, outcome, host);
    const bytes = base.written();
    try writer.writeAll(bytes[0..bytes.len - 1]);
    try writer.writeAll(",\"moduleStatus\":");
    try std.json.Stringify.value(@tagName(instance.status()), .{}, writer);
    try writer.writeAll(",\"hostEvents\":");
    try std.json.Stringify.value(counter.events, .{}, writer);
    try writer.writeAll(",\"requestHostEvents\":");
    try std.json.Stringify.value(counter.events -% events_before, .{}, writer);
    try writer.writeAll(",\"hostCounter\":");
    try std.json.Stringify.value(counter.storage, .{}, writer);
    try writer.writeByte('}');
}

fn evaluateRequest(host: *runtime.Runtime, module: *const runtime.VerifiedModule, request: Request, instance: ?*runtime.ModuleInstance, counter: *runtime.Counter) !runtime.RequestOutcome {
    var function_id = runtime.moduleInfo(module).function_id;
    if (request.functionId) |text| {
        const id = if (std.mem.startsWith(u8, text, "sha256:")) text[7..] else text;
        if (id.len != 64) return error.FunctionId;
        for (id) |character| if (!std.ascii.isDigit(character) and !(character >= 'a' and character <= 'f')) return error.FunctionId;
        _ = try std.fmt.hexToBytes(&function_id, id);
    }
    var selected: ?runtime.ModuleInfo = null;
    for (runtime.functions(module)) |function| if (std.mem.eql(u8, &function_id, &function.info.function_id)) {
        selected = function.info;
        break;
    };
    const info = selected orelse return .{ .failed = .{ .code = "r05-request-function", .category = "request", .function_id = function_id, .source = runtime.moduleInfo(module).source, .fuel_remaining = request.semanticFuel } };
    if (request.signatureHash) |text| {
        const expected = runtime.digestText(info.signature_hash);
        if (!std.mem.eql(u8, text, &expected)) return .{ .failed = .{ .code = "r05-request-signature", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
    }
    var arguments: [64]runtime.TypedValue = undefined;
    var valid = request.arguments.len <= 64 and request.arguments.len == info.parameter_types.len;
    if (valid) for (request.arguments, 0..) |argument, index| {
        if (argument != .object or argument.object.count() != 2) {
            valid = false;
            break;
        }
        const type_value = argument.object.get("type") orelse {
            valid = false;
            break;
        };
        const value = argument.object.get("value") orelse {
            valid = false;
            break;
        };
        if (type_value != .string) {
            valid = false;
            break;
        }
        const code = info.parameter_types[index];
        if (std.mem.eql(u8, type_value.string, "bool") and code == 2 and value == .bool) arguments[index] = .{ .boolean = value.bool } else if (std.mem.eql(u8, type_value.string, contract.typeName(code)) and contract.integerType(code) and value == .string) {
            var bits: u64 = undefined;
            var buffer: [32]u8 = undefined;
            const canonical = if (contract.signedType(code)) blk: {
                const integer = std.fmt.parseInt(i64, value.string, 10) catch { valid = false; break; };
                bits = @as(u64, @bitCast(integer)) & contract.mask(code);
                if (contract.signedValue(bits, code) != integer) { valid = false; break; }
                break :blk try std.fmt.bufPrint(&buffer, "{d}", .{integer});
            } else blk: {
                bits = std.fmt.parseInt(u64, value.string, 10) catch { valid = false; break; };
                if (bits & ~contract.mask(code) != 0) { valid = false; break; }
                break :blk try std.fmt.bufPrint(&buffer, "{d}", .{bits});
            };
            if (!std.mem.eql(u8, value.string, canonical)) {
                valid = false;
                break;
            }
            arguments[index] = runtime.typedValue(bits, code);
        } else {
            valid = false;
            break;
        }
    };
    if (!valid) return .{ .failed = .{ .code = "r05-request-arguments", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
    var capabilities: [128]runtime.Capability = undefined;
    var capabilities_valid = request.capabilities.len <= capabilities.len;
    if (capabilities_valid) for (request.capabilities, 0..) |value, index| {
        if (value != .object or value.object.count() != 3) { capabilities_valid = false; break; }
        const id = value.object.get("id") orelse { capabilities_valid = false; break; };
        const signature = value.object.get("signatureHash") orelse { capabilities_valid = false; break; };
        const adapter = value.object.get("adapter") orelse { capabilities_valid = false; break; };
        if (id != .integer or id.integer != 31 or signature != .string or signature.string.len != 71 or !std.mem.startsWith(u8, signature.string, "sha256:")
            or adapter != .string or !std.mem.eql(u8, adapter.string, "counter")) { capabilities_valid = false; break; }
        var hash: [32]u8 = undefined;
        _ = std.fmt.hexToBytes(&hash, signature.string[7..]) catch { capabilities_valid = false; break; };
        const canonical = runtime.digestText(hash);
        if (!std.mem.eql(u8, &canonical, signature.string)) { capabilities_valid = false; break; }
        capabilities[index] = .{ .id = 31, .signature = hash, .counter = counter };
    };
    if (!capabilities_valid) return .{ .failed = .{ .code = "r05-request-capability", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
    const init_only = std.mem.eql(u8, request.kind, "module-initialization");
    if (!init_only and !std.mem.eql(u8, request.kind, "function")) return .{ .failed = .{ .code = "r05-request-kind", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
    const limits: runtime.RequestLimits = .{ .memory_bytes = @intCast(request.memoryBytes), .instruction_budget = request.instructionBudget, .semantic_fuel = request.semanticFuel, .depth = request.depth, .host_time_ns = request.hostTimeNanos };
    if (instance) |persistent| {
        host.active_requests += 1;
        defer host.active_requests -= 1;
        return if (init_only) persistent.initialize(function_id, capabilities[0..request.capabilities.len], limits)
            else persistent.evaluate(function_id, arguments[0..request.arguments.len], capabilities[0..request.capabilities.len], limits);
    }
    if (init_only) {
        var fresh = try runtime.ModuleInstance.init(host.allocator, module);
        defer fresh.deinit();
        host.active_requests += 1;
        defer host.active_requests -= 1;
        return fresh.initialize(function_id, capabilities[0..request.capabilities.len], limits);
    }
    return runtime.eval_bytecode(host, module, function_id, arguments[0..request.arguments.len], capabilities[0..request.capabilities.len], limits);
}

// The transport frames existing R04 packets; it does not add bytecode semantics.
fn runSequence(init: std.process.Init, bytes: []const u8, requests_json: []const u8) !u8 {
    const requests = try std.json.parseFromSlice([]const Request, init.gpa, requests_json, .{});
    defer requests.deinit();
    if (bytes.len < 12 or !std.mem.eql(u8, bytes[0..8], "TSFGREQ1")) return error.RequestSequence;
    const count = std.mem.readInt(u32, bytes[8..12], .little);
    if (count < 1 or count > 128 or count != requests.value.len) return error.RequestSequence;
    var frames: [128][]const u8 = undefined;
    var cursor: usize = 12;
    for (frames[0..count]) |*frame| {
        if (bytes.len - cursor < 4) return error.RequestSequence;
        const length = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
        cursor += 4;
        if (length > bytes.len - cursor) return error.RequestSequence;
        frame.* = bytes[cursor..][0..length];
        cursor += length;
    }
    if (cursor != bytes.len) return error.RequestSequence;
    var host = runtime.Runtime.init(init.gpa);
    var counter: runtime.Counter = .{};
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    for (frames[0..count], requests.value, 0..) |frame, request, index| {
        const module = switch (runtime.load(init.gpa, frame)) {
            .loaded => |module| module,
            .rejected => |failure| {
                const diagnostic = try std.json.Stringify.valueAlloc(init.gpa, .{ .code = failure.code, .offset = failure.offset }, .{});
                defer init.gpa.free(diagnostic);
                try std.Io.File.stderr().writeStreamingAll(init.io, diagnostic);
                try std.Io.File.stderr().writeStreamingAll(init.io, "\n");
                return 3;
            },
        };
        defer runtime.unload(module);
        if (index != 0) try output.writer.writeByte(',');
        try writeOutcome(&output.writer, try evaluateRequest(&host, module, request, null, &counter), &host);
    }
    try output.writer.writeAll("]\n");
    try std.Io.File.stdout().writeStreamingAll(init.io, output.written());
    return 0;
}

fn run(init: std.process.Init) !u8 {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    var mode: enum { evaluate, inspect, roundtrip, sequence, module_requests } = .evaluate;
    var requests_json: []const u8 = "[{}]";
    if (args.len == 2 and std.mem.eql(u8, args[1], "--inspect")) {
        mode = .inspect;
    } else if (args.len == 2 and std.mem.eql(u8, args[1], "--roundtrip")) {
        mode = .roundtrip;
    } else if (args.len == 3 and (std.mem.eql(u8, args[1], "--requests") or std.mem.eql(u8, args[1], "--request-sequence") or std.mem.eql(u8, args[1], "--module-requests"))) {
        if (std.mem.eql(u8, args[1], "--request-sequence")) mode = .sequence;
        if (std.mem.eql(u8, args[1], "--module-requests")) mode = .module_requests;
        requests_json = args[2];
        if (requests_json.len > runtime.contract.max_bytes) return error.RequestTooLong;
    } else if (args.len != 1) return error.Usage;

    var read_buffer: [4096]u8 = undefined;
    var stdin_reader = std.Io.File.stdin().readerStreaming(init.io, &read_buffer);
    const bytes = stdin_reader.interface.allocRemaining(init.gpa, .limited(runtime.contract.max_bytes)) catch |err| {
        if (err == error.StreamTooLong) {
            try std.Io.File.stderr().writeStreamingAll(init.io, "{\"code\":\"r04-size\",\"offset\":0}\n");
            return 3;
        }
        return err;
    };
    defer init.gpa.free(bytes);
    if (mode == .sequence) return runSequence(init, bytes, requests_json);
    const module = switch (runtime.load(init.gpa, bytes)) {
        .loaded => |module| module,
        .rejected => |failure| {
            const diagnostic = try std.json.Stringify.valueAlloc(init.gpa, .{ .code = failure.code, .offset = failure.offset }, .{});
            defer init.gpa.free(diagnostic);
            try std.Io.File.stderr().writeStreamingAll(init.io, diagnostic);
            try std.Io.File.stderr().writeStreamingAll(init.io, "\n");
            return 3;
        },
    };
    defer runtime.unload(module);
    if (mode == .inspect or mode == .roundtrip) {
        const output = if (mode == .inspect) try runtime.inspect(module, init.gpa) else try runtime.serialize(module, init.gpa);
        defer init.gpa.free(output);
        try std.Io.File.stdout().writeStreamingAll(init.io, output);
        if (mode == .inspect) try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
        return 0;
    }
    const requests = try std.json.parseFromSlice([]const Request, init.gpa, requests_json, .{});
    defer requests.deinit();
    var host = runtime.Runtime.init(init.gpa);
    var counter: runtime.Counter = .{};
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    var instance: ?runtime.ModuleInstance = if (mode == .module_requests) try runtime.ModuleInstance.init(init.gpa, module) else null;
    defer if (instance) |*value| value.deinit();
    for (requests.value, 0..) |request, index| {
        if (index != 0) try output.writer.writeByte(',');
        const events_before = counter.events;
        const outcome = try evaluateRequest(&host, module, request, if (instance) |*value| value else null, &counter);
        if (mode == .module_requests) try writeModuleOutcome(&output.writer, outcome, &host, &instance.?, &counter, events_before) else try writeOutcome(&output.writer, outcome, &host);
    }
    try output.writer.writeAll("]\n");
    try std.Io.File.stdout().writeStreamingAll(init.io, output.written());
    return 0;
}

pub fn main(init: std.process.Init) void {
    const status = run(init) catch |err| {
        var buffer: [256]u8 = undefined;
        const message = std.fmt.bufPrint(&buffer, "r05-cli-{s}\n", .{@errorName(err)}) catch "r05-cli-internal\n";
        std.Io.File.stderr().writeStreamingAll(init.io, message) catch {};
        std.process.exit(2);
    };
    if (status != 0) std.process.exit(status);
}
