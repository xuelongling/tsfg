// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const VerifiedModule = bytecode.VerifiedModule;
const Source = bytecode.Source;
pub const TypedValue = union(enum) { i32: i32, boolean: bool };
pub const Capability = struct { id: u32 };
pub const RequestLimits = struct { memory_bytes: usize = 16384, instruction_budget: u64 = 4097, depth: u32 = 1 };
pub const Returned = struct { result: TypedValue, function_id: FunctionId, source: Source };
pub const RequestFailure = struct { code: []const u8, category: []const u8, function_id: FunctionId, source: Source };
pub const RequestOutcome = union(enum) { returned: Returned, failed: RequestFailure };
fn requestFailure(code: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = function_id, .source = source } };
}

pub fn evaluate(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
    const info = bytecode.moduleInfo(module);
    if (!std.mem.eql(u8, &function_id, &info.function_id)) return requestFailure("r05-request-function", function_id, info.source);
    if (arguments.len != 0) return requestFailure("r05-request-arguments", function_id, info.source);
    if (capabilities.len != 0) return requestFailure("r05-request-capability", function_id, info.source);
    if (limits.depth < 1) return requestFailure("r05-request-depth", function_id, info.source);
    if (limits.memory_bytes < @as(usize, info.register_count) * @sizeOf(i32)) return requestFailure("r05-request-memory", function_id, info.source);
    const frame = allocator.alloc(i32, info.register_count) catch return requestFailure("r05-request-allocation", function_id, info.source);
    defer allocator.free(frame);
    var remaining = limits.instruction_budget;
    for (bytecode.instructions(module)) |instruction| {
        const source = instruction.source;
        if (remaining == 0) return requestFailure("r05-execution-abort", function_id, source);
        remaining -= 1;
        const op = instruction;
        switch (op.opcode) {
            1, 3 => frame[op.register] = op.immediate,
            2 => return .{ .returned = .{ .result = if (op.type_code == 1) .{ .i32 = frame[op.register] } else .{ .boolean = frame[op.register] != 0 }, .function_id = function_id, .source = op.source } },
            4 => frame[op.register] = frame[op.left] +% frame[op.right],
            else => unreachable,
        }
    }
    // The loader requires a return terminator, so this is never an untrusted-input path.
    unreachable;
}
