// SPDX-License-Identifier: MIT
const std = @import("std");
const runtime = @import("root.zig");

const request_json = @import("request-json.zig");
const Request = request_json.Request;
const ParsedRequest = request_json.ParsedRequest;

const writeOutcome = @import("outcome-writer.zig").writeOutcome;

fn writeModuleOutcome(writer: *std.Io.Writer, outcome: *const runtime.RequestOutcome, host: *const runtime.Runtime, instance: *const runtime.ModuleInstance, counter: *const runtime.Counter, events_before: u64, mode: @import("string-output.zig").Mode) !void {
    try @import("module-outcome-writer.zig").write(writer, outcome, host,
        @tagName(instance.status()), counter, events_before, mode);
}

// JSON/transport retain Init.gpa; guest storage uses the private allocator below.
// CLI guest frames/state are freed immediately by the locked stateless page allocator.
// Page rounding, backing calls and heap lifetime remain part of resource qualification.
const guest_allocator = std.heap.page_allocator;

fn evaluateRequest(host: *runtime.Runtime, module: *const runtime.VerifiedModule, request: *const Request, instance: ?*runtime.ModuleInstance, counter: *runtime.Counter, result_out: *runtime.RequestOutcome) !void {
    var parsed: ParsedRequest = undefined;
    parsed.argument_count = 0;
    parsed.argument_owner = null;
    defer {
        for (parsed.argument_storage[0..parsed.argument_count]) |*argument| if (argument.* == .string) argument.string.deinit();
        if (parsed.argument_owner) |owner| owner.release();
    }
    if (!try @call(.never_inline, request_json.parseRequest, .{ host.allocator, request_json.VmMetadata{ .module = module }, request, counter, &parsed, result_out })) return;
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
