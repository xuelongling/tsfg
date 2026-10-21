// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("root.zig");
const contract = @import("contract.zig");
const host_bindings = @import("host-bindings.zig");

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
    stringOutput: @import("string-output.zig").Mode = .strict,
};

const writeOutcome = @import("outcome-writer.zig").writeOutcome;

fn writeModuleOutcome(writer: *std.Io.Writer, outcome: *const runtime.RequestOutcome, host: *const runtime.Runtime, instance: *const runtime.ModuleInstance, counter: *const runtime.Counter, events_before: u64, mode: @import("string-output.zig").Mode) !void {
    var base: std.Io.Writer.Allocating = .init(host.allocator);
    defer base.deinit();
    try writeOutcome(&base.writer, outcome, host, mode);
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

// JSON/transport retain Init.gpa; guest storage uses the private allocator below.
// CLI guest frames/state are freed immediately by the locked stateless page allocator.
// Page rounding, backing calls and heap lifetime remain part of resource qualification.
const guest_allocator = std.heap.page_allocator;

const ParsedRequest = struct {
    function_id: runtime.FunctionId,
    arguments: []runtime.TypedValue,
    argument_storage: [64]runtime.TypedValue,
    argument_owner: ?*@import("string-value.zig").Owner = null,
    argument_count: usize,
    capabilities: [2]runtime.Capability,
    capability_count: usize,
    init_only: bool,
    limits: runtime.RequestLimits,
};

// The CLI owns typed argument slots and every String input root until invocation.
// Parse owns each original Value array until all synchronous evaluation/formatting
// finishes. Parsed.deinit releases arena blocks without revisiting Value tags.
// The bytes/arena/metadata retain their original heap and callback fees.
fn parseRequest(allocator: std.mem.Allocator, module: *const runtime.VerifiedModule, request: *const Request, counter: *runtime.Counter, parsed: *ParsedRequest, result_out: *runtime.RequestOutcome) !bool {
    const default_info = @import("bytecode.zig").moduleInfoView(module);
    var function_id = default_info.function_id;
    if (request.functionId) |text| {
        const id = if (std.mem.startsWith(u8, text, "sha256:")) text[7..] else text;
        if (id.len != 64) return error.FunctionId;
        for (id) |character| if (!std.ascii.isDigit(character) and !(character >= 'a' and character <= 'f')) return error.FunctionId;
        _ = try std.fmt.hexToBytes(&function_id, id);
    }
    // Parsed JSON and the VerifiedModule outlive this private request call.
    // Borrow their immutable records; outcomes retain the existing owned IDs.
    var selected: ?*const runtime.ModuleInfo = null;
    for (runtime.functions(module)) |*function| if (std.mem.eql(u8, &function_id, &function.info.function_id)) {
        selected = &function.info;
        break;
    };
    const info = selected orelse { result_out.* = .{ .failed = .{ .code = "r05-request-function", .category = "request", .function_id = function_id, .source = default_info.source, .fuel_remaining = request.semanticFuel } }; return false; };
    if (request.signatureHash) |text| {
        const expected = runtime.digestText(info.signature_hash);
        if (!std.mem.eql(u8, text, &expected)) { result_out.* = .{ .failed = .{ .code = "r05-request-signature", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    }
    var valid = request.arguments.len <= 64 and request.arguments.len == info.parameter_types.len;
    const arguments: []runtime.TypedValue = if (valid) parsed.argument_storage[0..request.arguments.len] else &.{};
    // Preserve the original typed JSON and write only into owned typed slots.
    // String roots are reclaimed even after a later argument fails validation.
    if (valid) for (request.arguments, 0..) |original, index| {
        const argument = &original;
        if (argument.* != .object or argument.object.count() != 2) {
            valid = false;
            break;
        }
        const type_value: *const std.json.Value = argument.object.getPtr("type") orelse {
            valid = false;
            break;
        };
        const value: *const std.json.Value = argument.object.getPtr("value") orelse {
            valid = false;
            break;
        };
        if (type_value.* != .string) {
            valid = false;
            break;
        }
        const code = info.parameter_types[index];
        if (std.mem.eql(u8, type_value.string, "bool") and code == 2 and value.* == .bool) arguments[index] = .{ .boolean = value.bool } else if (std.mem.eql(u8, type_value.string, contract.typeName(code)) and contract.integerType(code) and value.* == .string) {
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
        } else if (std.mem.eql(u8, type_value.string, contract.typeName(code)) and contract.floatType(code) and value.* == .string) {
            if (value.string.len != (if (code == 12) @as(usize, 8) else 16)) { valid = false; break; }
            for (value.string) |c| if (!std.ascii.isDigit(c) and !(c >= 'a' and c <= 'f')) { valid = false; break; };
            if (!valid) break;
            const bits = std.fmt.parseInt(u64, value.string, 16) catch { valid = false; break; };
            arguments[index] = runtime.typedValue(bits, code);
        } else if (code == 14 and std.mem.eql(u8, type_value.string, "string") and value.* == .array) {
            arguments[index] = .{ .string = @import("string-arguments.zig").read(allocator, &parsed.argument_owner, value.*, request.memoryBytes) catch |err| {
                if (err == error.OutOfMemory or err == error.IdentityExhausted) {
                    result_out.* = .{ .failed = .{ .code = "r05-execution-abort", .category = "execution-abort", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } };
                    return false;
                }
                valid = false; break;
            } };
        } else {
            valid = false;
            break;
        }
        parsed.argument_count += 1;
    };
    if (!valid) { result_out.* = .{ .failed = .{ .code = "r05-request-arguments", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const capabilities = &parsed.capabilities;
    var capabilities_valid = request.capabilities.len <= 128;
    if (capabilities_valid) for (request.capabilities, 0..) |value, index| {
        const capability = host_bindings.readCounterGrant(value) catch { capabilities_valid = false; break; };
        if (index < capabilities.len) capabilities[index] = .{ .id = capability.id, .signature = capability.signature, .semantic_contract = capability.semantic_contract, .counter = counter };
    };
    if (!capabilities_valid) { result_out.* = .{ .failed = .{ .code = "r05-request-capability", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const init_only = std.mem.eql(u8, request.kind, "module-initialization");
    if (!init_only and !std.mem.eql(u8, request.kind, "function")) { result_out.* = .{ .failed = .{ .code = "r05-request-kind", .category = "request", .function_id = function_id, .source = info.source, .fuel_remaining = request.semanticFuel } }; return false; }
    const limits: runtime.RequestLimits = .{ .memory_bytes = @intCast(request.memoryBytes), .instruction_budget = request.instructionBudget, .semantic_fuel = request.semanticFuel, .depth = request.depth, .host_time_ns = request.hostTimeNanos };
    parsed.function_id = function_id;
    parsed.arguments = arguments;
    parsed.argument_count = request.arguments.len;
    // All128 JSON records were validated in original order. With CLI-only
    // id31/counter, any N>=2 fails at the second original VM descriptor;
    // keep both so signature/counter/duplicate checks retain their order.
    parsed.capability_count = @min(request.capabilities.len, capabilities.len);
    parsed.init_only = init_only;
    parsed.limits = limits;
    return true;
}

fn evaluateRequest(host: *runtime.Runtime, module: *const runtime.VerifiedModule, request: *const Request, instance: ?*runtime.ModuleInstance, counter: *runtime.Counter, result_out: *runtime.RequestOutcome) !void {
    var parsed: ParsedRequest = undefined;
    parsed.argument_count = 0;
    parsed.argument_owner = null;
    defer {
        for (parsed.argument_storage[0..parsed.argument_count]) |*argument| if (argument.* == .string) argument.string.deinit();
        if (parsed.argument_owner) |owner| owner.release();
    }
    if (!try @call(.never_inline, parseRequest, .{ host.allocator, module, request, counter, &parsed, result_out })) return;
    var fresh: runtime.ModuleInstance = undefined;
    var owns_fresh = false;
    var active = false;
    defer {
        // Ordinary eval frees its VM instance before Runtime decrements;
        // initialization-only decrements before its fresh owner is freed.
        if (owns_fresh and !parsed.init_only) fresh.deinit();
        if (active) host.active_requests -= 1;
        if (owns_fresh and parsed.init_only) fresh.deinit();
    }
    var selected_instance = instance;
    if (selected_instance == null) {
        // Ordinary eval counts the request before State allocation; fresh
        // initialization-only counts only after successful allocation.
        if (!parsed.init_only) { host.active_requests += 1; active = true; }
        @call(.never_inline, initializeFreshInto, .{ host.allocator, module, &fresh }) catch |err| {
            if (parsed.init_only) return err;
            result_out.* = .{ .failed = .{ .code = "r05-execution-abort", .category = "execution-abort", .function_id = parsed.function_id,
                .source = @import("bytecode.zig").moduleInfoView(module).source, .fuel_remaining = parsed.limits.semantic_fuel } };
            return;
        };
        owns_fresh = true;
        selected_instance = &fresh;
    }
    if (!active) { host.active_requests += 1; active = true; }
    const selected = selected_instance.?;
    if (parsed.init_only) @call(.never_inline, invokeInitialize, .{ selected, &parsed, result_out })
        else @call(.never_inline, invokeEvaluate, .{ selected, &parsed, result_out });
}

// The existing State allocations/errdefer retain their order. Constructor
// by-value temporaries die on this private return; the caller owns the result.
fn initializeFreshInto(allocator: std.mem.Allocator, module: *const runtime.VerifiedModule, instance: *runtime.ModuleInstance) !void {
    instance.* = try runtime.ModuleInstance.init(allocator, module);
}

// Synchronous private branches borrow the caller's ParsedRequest and instance.
// Their complete active frames/callees remain part of the execution envelope.
fn invokeInitialize(instance: *runtime.ModuleInstance, parsed: *const ParsedRequest, result_out: *runtime.RequestOutcome) void {
    const arguments: []const runtime.TypedValue = &.{};
    const capabilities: []const runtime.Capability = parsed.capabilities[0..parsed.capability_count];
    tsfg_runtime_request_initialize_into(instance, &parsed.function_id, &arguments, &capabilities, &parsed.limits, result_out);
}
fn invokeEvaluate(instance: *runtime.ModuleInstance, parsed: *const ParsedRequest, result_out: *runtime.RequestOutcome) void {
    const arguments: []const runtime.TypedValue = parsed.arguments[0..parsed.argument_count];
    const capabilities: []const runtime.Capability = parsed.capabilities[0..parsed.capability_count];
    tsfg_runtime_request_evaluate_into(instance, &parsed.function_id, &arguments, &capabilities, &parsed.limits, result_out);
}
// These internal symbols are synchronous implementation seams, without a new
// SDK method or host adapter. ParsedRequest, instance and result_out stay owned
// by evaluateRequest's caller until both the link call and cleanup return.
extern fn tsfg_runtime_request_evaluate_into(instance: *runtime.ModuleInstance, id: *const runtime.FunctionId, arguments: *const []const runtime.TypedValue, capabilities: *const []const runtime.Capability, limits: *const runtime.RequestLimits, outcome: *runtime.RequestOutcome) callconv(.c) void;
extern fn tsfg_runtime_request_initialize_into(instance: *runtime.ModuleInstance, id: *const runtime.FunctionId, arguments: *const []const runtime.TypedValue, capabilities: *const []const runtime.Capability, limits: *const runtime.RequestLimits, outcome: *runtime.RequestOutcome) callconv(.c) void;

// The transport frames existing R04 packets; it does not add bytecode semantics.
fn runSequence(init: *const std.process.Init, bytes: []const u8, requests_json: []const u8) !u8 {
    var requests: std.json.Parsed([]const Request) = undefined;
    try @call(.never_inline, parseRequestsInto, .{ init.gpa, requests_json, &requests });
    defer @call(.never_inline, deinitRequests, .{ &requests });
    if (bytes.len < 12 or !std.mem.eql(u8, bytes[0..8], "TSFGREQ1")) return error.RequestSequence;
    const count = std.mem.readInt(u32, bytes[8..12], .little);
    if (count < 1 or count > 128 or count != requests.value.len) return error.RequestSequence;
    var cursor: usize = 12;
    for (0..count) |_| {
        if (bytes.len - cursor < 4) return error.RequestSequence;
        const length = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
        cursor += 4;
        if (length > bytes.len - cursor) return error.RequestSequence;
        cursor += length;
    }
    if (cursor != bytes.len) return error.RequestSequence;
    var host = runtime.Runtime.init(guest_allocator);
    defer host.deinit() catch unreachable;
    var counter: runtime.Counter = .{};
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    // Rewalk the immutable packet only after complete framing validation.
    cursor = 12;
    for (requests.value, 0..) |*request, index| {
        if (bytes.len - cursor < 4) return error.RequestSequence;
        const length = std.mem.readInt(u32, bytes[cursor..][0..4], .little);
        cursor += 4;
        if (length > bytes.len - cursor) return error.RequestSequence;
        const frame = bytes[cursor..][0..length];
        cursor += length;
        const module = switch (runtime.load(init.gpa, frame)) {
            .loaded => |module| module,
            .rejected => |failure| {
                try @call(.never_inline, writeLoadFailure, .{ init, &failure });
                return 3;
            },
        };
        defer runtime.unload(module);
        if (index != 0) try output.writer.writeByte(',');
        var outcome: runtime.RequestOutcome = undefined;
        try evaluateRequest(&host, module, request, null, &counter, &outcome);
        defer runtime.deinitOutcome(&outcome);
        try writeOutcome(&output.writer, &outcome, &host, request.stringOutput);
    }
    try output.writer.writeAll("]\n");
    try std.Io.File.stdout().writeStreamingAll(init.io, output.written());
    return 0;
}

fn readInput(init: *const std.process.Init) !?[]u8 {
    var read_buffer: [4096]u8 = undefined;
    var stdin_reader = std.Io.File.stdin().readerStreaming(init.io, &read_buffer);
    return stdin_reader.interface.allocRemaining(init.gpa, .limited(runtime.contract.max_bytes)) catch |err| {
        if (err == error.StreamTooLong) {
            try std.Io.File.stderr().writeStreamingAll(init.io, "{\"code\":\"r04-size\",\"offset\":0}\n");
            return null;
        }
        return err;
    };
}

// Cold parse/output temporaries return before synchronous guest execution.
// Parsed JSON and result storage remain owned by their original caller scope.
fn writeLoadFailure(init: *const std.process.Init, failure: *const runtime.LoadFailure) !void {
    const diagnostic = try std.json.Stringify.valueAlloc(init.gpa, .{ .code = failure.code, .offset = failure.offset }, .{});
    defer init.gpa.free(diagnostic);
    try std.Io.File.stderr().writeStreamingAll(init.io, diagnostic);
    try std.Io.File.stderr().writeStreamingAll(init.io, "\n");
}
fn writeModuleBytes(init: *const std.process.Init, module: *const runtime.VerifiedModule, inspect: bool) !void {
    const output = if (inspect) try runtime.inspect(module, init.gpa) else try runtime.serialize(module, init.gpa);
    defer init.gpa.free(output);
    try std.Io.File.stdout().writeStreamingAll(init.io, output);
    if (inspect) try std.Io.File.stdout().writeStreamingAll(init.io, "\n");
}
fn parseRequestsInto(allocator: std.mem.Allocator, json: []const u8, requests: *std.json.Parsed([]const Request)) !void {
    requests.* = try std.json.parseFromSlice([]const Request, allocator, json, .{});
}
fn deinitRequests(requests: *const std.json.Parsed([]const Request)) void {
    requests.deinit();
}

const Mode = enum { evaluate, inspect, roundtrip, sequence, module_requests };

fn run(init: std.process.Init) !u8 {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    var mode: Mode = .evaluate;
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

    const bytes = (try @call(.never_inline, readInput, .{&init})) orelse return 3;
    defer init.gpa.free(bytes);
    if (mode == .sequence) return @call(.never_inline, runSequence, .{ &init, bytes, requests_json });
    return @call(.never_inline, runMode, .{ &init, mode, bytes, requests_json });
}

fn runMode(init: *const std.process.Init, mode: Mode, bytes: []const u8, requests_json: []const u8) !u8 {
    const module = switch (runtime.load(init.gpa, bytes)) {
        .loaded => |module| module,
        .rejected => |failure| {
            try @call(.never_inline, writeLoadFailure, .{ init, &failure });
            return 3;
        },
    };
    defer runtime.unload(module);
    if (mode == .inspect or mode == .roundtrip) {
        try @call(.never_inline, writeModuleBytes, .{ init, module, mode == .inspect });
        return 0;
    }
    var requests: std.json.Parsed([]const Request) = undefined;
    try @call(.never_inline, parseRequestsInto, .{ init.gpa, requests_json, &requests });
    defer @call(.never_inline, deinitRequests, .{ &requests });
    var host = runtime.Runtime.init(guest_allocator);
    defer host.deinit() catch unreachable;
    var counter: runtime.Counter = .{};
    var output: std.Io.Writer.Allocating = .init(init.gpa);
    defer output.deinit();
    try output.writer.writeByte('[');
    var instance_storage: runtime.ModuleInstance = undefined;
    var instance: ?*runtime.ModuleInstance = null;
    if (mode == .module_requests) {
        try @call(.never_inline, initializeFreshInto, .{ host.allocator, module, &instance_storage });
        instance = &instance_storage;
    }
    defer if (instance) |value| value.deinit();
    for (requests.value, 0..) |*request, index| {
        if (index != 0) try output.writer.writeByte(',');
        const events_before = counter.events;
        var outcome: runtime.RequestOutcome = undefined;
        try evaluateRequest(&host, module, request, instance, &counter, &outcome);
        defer runtime.deinitOutcome(&outcome);
        if (mode == .module_requests) try writeModuleOutcome(&output.writer, &outcome, &host, instance.?, &counter, events_before, request.stringOutput) else try writeOutcome(&output.writer, &outcome, &host, request.stringOutput);
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
