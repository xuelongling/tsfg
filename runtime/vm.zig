// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const VerifiedModule = bytecode.VerifiedModule;
const Source = bytecode.Source;
pub const TypedValue = union(enum) { i32: i32, boolean: bool };
pub const Capability = struct { id: u32 };
pub const RequestLimits = struct { memory_bytes: usize = 16384, instruction_budget: u64 = 4097, semantic_fuel: u64 = 4097, depth: u32 = 1 };
pub const Returned = struct { result: TypedValue, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestFailure = struct { code: []const u8, category: []const u8, rule_ids: []const []const u8 = &.{}, function_id: FunctionId, source: Source, fuel_remaining: u64 = 0, fuel_consumed: u64 = 0 };
pub const RequestOutcome = union(enum) { returned: Returned, failed: RequestFailure };
fn requestFailure(code: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = function_id, .source = source } };
}

fn arithmeticTrap(comptime code: []const u8, comptime rule_id: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = "trap", .rule_ids = &.{rule_id}, .function_id = function_id, .source = source } };
}

const Frame = struct { previous: ?*Frame, function: bytecode.Function, registers: []i32, transfer: []i32, cursor: usize = 0, return_register: u16 = 0, bytes: usize };
fn frameSize(function: bytecode.Function) usize {
    var max_parameters: usize = 0;
    for (function.blocks) |block| max_parameters = @max(max_parameters, block.parameters.len);
    return @sizeOf(Frame) + (@as(usize, function.info.register_count) + max_parameters) * @sizeOf(i32);
}
fn enter(allocator: std.mem.Allocator, function: bytecode.Function, previous: ?*Frame) AllocatorError!*Frame {
    const frame = try allocator.create(Frame);
    errdefer allocator.destroy(frame);
    const registers = try allocator.alloc(i32, function.info.register_count);
    errdefer allocator.free(registers);
    const count = (frameSize(function) - @sizeOf(Frame)) / @sizeOf(i32) - function.info.register_count;
    const transfer = try allocator.alloc(i32, count);
    frame.* = .{ .previous = previous, .function = function, .registers = registers, .transfer = transfer, .bytes = frameSize(function) };
    return frame;
}
const AllocatorError = std.mem.Allocator.Error;
fn leave(allocator: std.mem.Allocator, frame: *Frame) void {
    allocator.free(frame.registers);
    allocator.free(frame.transfer);
    allocator.destroy(frame);
}

fn execute(allocator: std.mem.Allocator, module: *const VerifiedModule, requested_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, fuel_remaining: *u64) RequestOutcome {
    const all_functions = bytecode.functions(module);
    var selected: ?bytecode.Function = null;
    for (all_functions) |function| if (std.mem.eql(u8, &requested_id, &function.info.function_id)) {
        selected = function;
        break;
    };
    const function = selected orelse return requestFailure("r05-request-function", requested_id, bytecode.moduleInfo(module).source);
    const info = function.info;
    if (arguments.len != info.parameter_types.len) return requestFailure("r05-request-arguments", requested_id, info.source);
    for (arguments, info.parameter_types) |argument, type_code| if ((type_code == 1 and argument != .i32) or (type_code == 2 and argument != .boolean)) return requestFailure("r05-request-arguments", requested_id, info.source);
    const function_id = info.function_id;
    if (capabilities.len != 0) return requestFailure("r05-request-capability", function_id, info.source);
    if (limits.depth < 1) return arithmeticTrap("r01-t-depth", "r01-depth", function_id, info.source);
    if (limits.memory_bytes < frameSize(function)) return requestFailure("r05-execution-abort", function_id, info.source);
    var active: ?*Frame = enter(allocator, function, null) catch return requestFailure("r05-execution-abort", function_id, info.source);
    defer while (active) |frame| {
        active = frame.previous;
        leave(allocator, frame);
    };
    for (arguments, function.blocks[0].parameters) |argument, parameter| active.?.registers[parameter.register] = switch (argument) {
        .i32 => |value| value,
        .boolean => |value| @intFromBool(value),
    };
    var used_memory = frameSize(function);
    var depth: u32 = 1;
    var remaining = limits.instruction_budget;
    while (true) {
        const current = active.?;
        const frame = current.registers;
        const transfer = current.transfer;
        const current_id = current.function.info.function_id;
        const instruction = current.function.instructions[current.cursor];
        current.cursor += 1;
        const source = instruction.source;
        if (instruction.opcode == 26) {
            if (fuel_remaining.* == 0) return arithmeticTrap("r01-t-fuel", "r01-fuel", current_id, source);
            fuel_remaining.* -= 1;
        }
        if (remaining == 0) return requestFailure("r05-execution-abort", current_id, source);
        remaining -= 1;
        const op = instruction;
        switch (op.opcode) {
            1, 3 => frame[op.register] = op.immediate,
            2 => {
                const result = frame[op.register];
                if (current.previous) |caller| {
                    caller.registers[current.return_register] = result;
                    used_memory -= current.bytes;
                    depth -= 1;
                    active = caller;
                    leave(allocator, current);
                } else return .{ .returned = .{ .result = if (op.type_code == 1) .{ .i32 = result } else .{ .boolean = result != 0 }, .function_id = current_id, .source = op.source } };
            },
            4 => frame[op.register] = frame[op.left] +% frame[op.right],
            5 => frame[op.register] = frame[op.left] -% frame[op.right],
            6 => frame[op.register] = frame[op.left] *% frame[op.right],
            7, 8 => {
                const left = frame[op.left];
                const right = frame[op.right];
                // Guard before native division/remainder, including MIN / -1.
                if (right == 0) return if (op.opcode == 7) arithmeticTrap("r01-t-divide-zero", "r01-division", current_id, source) else arithmeticTrap("r01-t-remainder-zero", "r01-division", current_id, source);
                frame[op.register] = if (left == std.math.minInt(i32) and right == -1)
                    (if (op.opcode == 7) std.math.minInt(i32) else 0)
                else if (op.opcode == 7) @divTrunc(left, right) else @rem(left, right);
            },
            9...11 => {
                const signed_count = frame[op.right];
                // Range-check signed counts before narrowing or shifting.
                if (signed_count < 0 or signed_count > 31) return arithmeticTrap("r01-t-shift-count", "r01-shifts", current_id, source);
                const count: u5 = @intCast(signed_count);
                const bits: u32 = @bitCast(frame[op.left]);
                frame[op.register] = switch (op.opcode) {
                    9 => @bitCast(bits << count),
                    10 => frame[op.left] >> count,
                    11 => @bitCast(bits >> count),
                    else => unreachable,
                };
            },
            12 => frame[op.register] = frame[op.left] & frame[op.right],
            13 => frame[op.register] = frame[op.left] | frame[op.right],
            14 => frame[op.register] = frame[op.left] ^ frame[op.right],
            15 => frame[op.register] = 0 -% frame[op.left],
            16 => frame[op.register] = ~frame[op.left],
            17 => frame[op.register] = @intFromBool(frame[op.left] == 0),
            18...23 => frame[op.register] = @intFromBool(switch (op.opcode) {
                18 => frame[op.left] == frame[op.right],
                19 => frame[op.left] != frame[op.right],
                20 => frame[op.left] < frame[op.right],
                21 => frame[op.left] <= frame[op.right],
                22 => frame[op.left] > frame[op.right],
                23 => frame[op.left] >= frame[op.right],
                else => unreachable,
            }),
            24, 25 => {
                const edge: usize = if (op.opcode == 24 or frame[op.register] != 0) 0 else 1;
                const target = if (edge == 0) op.left else op.right;
                const block = current.function.blocks[target];
                for (op.edges[edge], 0..) |reg, i| transfer[i] = frame[reg];
                for (block.parameters, 0..) |parameter, i| frame[parameter.register] = transfer[i];
                current.cursor = block.start;
            },
            26 => {},
            27 => {
                const callee = all_functions[op.left];
                if (depth >= limits.depth) return arithmeticTrap("r01-t-depth", "r01-depth", callee.info.function_id, callee.info.source);
                const bytes = frameSize(callee);
                if (bytes > limits.memory_bytes - used_memory) return requestFailure("r05-execution-abort", callee.info.function_id, callee.info.source);
                const next = enter(allocator, callee, current) catch return requestFailure("r05-execution-abort", callee.info.function_id, callee.info.source);
                for (op.edges[0], callee.blocks[0].parameters) |argument, parameter| next.registers[parameter.register] = frame[argument];
                next.return_register = op.register;
                active = next;
                depth += 1;
                used_memory += bytes;
            },
            else => unreachable,
        }
    }
}

pub fn evaluate(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
    var fuel_remaining = limits.semantic_fuel;
    var outcome = execute(allocator, module, function_id, arguments, capabilities, limits, &fuel_remaining);
    switch (outcome) {
        .returned => |*result| {
            result.fuel_remaining = fuel_remaining;
            result.fuel_consumed = limits.semantic_fuel - fuel_remaining;
        },
        .failed => |*failure| {
            failure.fuel_remaining = fuel_remaining;
            failure.fuel_consumed = limits.semantic_fuel - fuel_remaining;
        },
    }
    return outcome;
}
