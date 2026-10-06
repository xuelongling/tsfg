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

fn execute(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, fuel_remaining: *u64) RequestOutcome {
    const info = bytecode.moduleInfo(module);
    if (!std.mem.eql(u8, &function_id, &info.function_id)) return requestFailure("r05-request-function", function_id, info.source);
    if (arguments.len != 0) return requestFailure("r05-request-arguments", function_id, info.source);
    if (capabilities.len != 0) return requestFailure("r05-request-capability", function_id, info.source);
    if (limits.depth < 1) return arithmeticTrap("r01-t-depth", "r01-depth", function_id, info.source);
    var max_parameters: usize = 0;
    for (bytecode.blockTable(module)) |block| max_parameters = @max(max_parameters, block.parameters.len);
    if (limits.memory_bytes < (@as(usize, info.register_count) + max_parameters) * @sizeOf(i32)) return requestFailure("r05-execution-abort", function_id, info.source);
    const frame = allocator.alloc(i32, info.register_count) catch return requestFailure("r05-execution-abort", function_id, info.source);
    defer allocator.free(frame);
    const transfer = allocator.alloc(i32, max_parameters) catch return requestFailure("r05-execution-abort", function_id, info.source);
    defer allocator.free(transfer);
    var remaining = limits.instruction_budget;
    var cursor: usize = 0;
    const ops = bytecode.instructions(module);
    while (true) {
        const instruction = ops[cursor];
        cursor += 1;
        const source = instruction.source;
        if (instruction.opcode == 26) {
            if (fuel_remaining.* == 0) return arithmeticTrap("r01-t-fuel", "r01-fuel", function_id, source);
            fuel_remaining.* -= 1;
        }
        if (remaining == 0) return requestFailure("r05-execution-abort", function_id, source);
        remaining -= 1;
        const op = instruction;
        switch (op.opcode) {
            1, 3 => frame[op.register] = op.immediate,
            2 => return .{ .returned = .{ .result = if (op.type_code == 1) .{ .i32 = frame[op.register] } else .{ .boolean = frame[op.register] != 0 }, .function_id = function_id, .source = op.source } },
            4 => frame[op.register] = frame[op.left] +% frame[op.right],
            5 => frame[op.register] = frame[op.left] -% frame[op.right],
            6 => frame[op.register] = frame[op.left] *% frame[op.right],
            7, 8 => {
                const left = frame[op.left];
                const right = frame[op.right];
                // Guard before native division/remainder, including MIN / -1.
                if (right == 0) return if (op.opcode == 7) arithmeticTrap("r01-t-divide-zero", "r01-division", function_id, source) else arithmeticTrap("r01-t-remainder-zero", "r01-division", function_id, source);
                frame[op.register] = if (left == std.math.minInt(i32) and right == -1)
                    (if (op.opcode == 7) std.math.minInt(i32) else 0)
                else if (op.opcode == 7) @divTrunc(left, right) else @rem(left, right);
            },
            9...11 => {
                const signed_count = frame[op.right];
                // Range-check signed counts before narrowing or shifting.
                if (signed_count < 0 or signed_count > 31) return arithmeticTrap("r01-t-shift-count", "r01-shifts", function_id, source);
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
                const block = bytecode.blockTable(module)[target];
                for (op.edges[edge], 0..) |reg, i| transfer[i] = frame[reg];
                for (block.parameters, 0..) |parameter, i| frame[parameter.register] = transfer[i];
                cursor = block.start;
            },
            26 => {},
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
