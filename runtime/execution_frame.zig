// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const module_state = @import("module.zig");
const request = @import("request.zig");
const contract = bytecode.contract;
const Capability = request.Capability;
const RequestLimits = request.RequestLimits;
const RequestOutcome = request.RequestOutcome;
const scalar = @import("scalar.zig");
const floatArithmetic = scalar.floatArithmetic;
const floatCompare = scalar.floatCompare;
const storeArithmeticTrap = request.storeArithmeticTrap;

// The VerifiedModule owns immutable descriptors and outlives every State and
// execution frame. Borrow that descriptor instead of duplicating it per call.
pub const Frame = struct { previous: ?*Frame, function: *const bytecode.Function, registers: []u64, transfer: []u64, cursor: usize = 0, return_register: u16 = 0, bytes: usize };
pub fn frameSize(function: *const bytecode.Function) usize {
    var max_parameters: usize = 0;
    for (function.blocks) |block| max_parameters = @max(max_parameters, block.parameters.len);
    return @sizeOf(Frame) + (@as(usize, function.info.register_count) + max_parameters) * @sizeOf(u64);
}
pub fn enter(allocator: std.mem.Allocator, function: *const bytecode.Function, previous: ?*Frame) AllocatorError!*Frame {
    comptime {
        if (@alignOf(Frame) > @alignOf(u64) or @sizeOf(Frame) % @sizeOf(u64) != 0)
            @compileError("Frame must fit aligned u64 backing");
    }
    const bytes = frameSize(function);
    const backing = try allocator.alloc(u64, bytes / @sizeOf(u64));
    const frame: *Frame = @ptrCast(backing.ptr);
    const registers_start = @sizeOf(Frame) / @sizeOf(u64);
    const transfer_start = registers_start + @as(usize, function.info.register_count);
    frame.* = .{ .previous = previous, .function = function,
        .registers = backing[registers_start..transfer_start],
        .transfer = backing[transfer_start..], .bytes = bytes };
    return frame;
}
const AllocatorError = std.mem.Allocator.Error;
const StackSnapshot = @import("host_counter.zig").StackSnapshot;
// Persistent bodies that are already wholly in the active stack envelope are
// charged by that envelope. Off-stack bodies and owned child storage are added
// once. A partial overlap or address/size overflow is never treated as outside.
pub fn hostStorage(state: *const module_state.State, capabilities: []const Capability, snapshot: StackSnapshot) ?usize {
    var storage = snapshot.outsideBytes(@intFromPtr(state), @sizeOf(module_state.State)) orelse return null;
    const global_size = @mulWithOverflow(state.globals.len, @sizeOf(u64));
    const initialized_size = @mulWithOverflow(state.initialized.len, @sizeOf(bool));
    if (global_size[1] != 0 or initialized_size[1] != 0) return null;
    const globals = snapshot.outsideBytes(@intFromPtr(state.globals.ptr), global_size[0]) orelse return null;
    const initialized = snapshot.outsideBytes(@intFromPtr(state.initialized.ptr), initialized_size[0]) orelse return null;
    for ([_]usize{ globals, initialized }) |bytes| {
        const sum = @addWithOverflow(storage, bytes);
        if (sum[1] != 0) return null;
        storage = sum[0];
    }
    for (capabilities, 0..) |*capability, index| if (capability.counter) |counter| {
        var seen = false;
        for (capabilities[0..index]) |*previous| if (previous.counter == counter) { seen = true; break; };
        if (!seen) {
            const bytes = snapshot.outsideBytes(@intFromPtr(counter), @sizeOf(@import("host_counter.zig").Counter)) orelse return null;
            const sum = @addWithOverflow(storage, bytes);
            if (sum[1] != 0) return null;
            storage = sum[0];
        }
    };
    return storage;
}
// Inlined in evaluate/initialize: no run prologue may precede this check.
pub const Admission = enum { allowed, depth, abort };
pub fn preRunAdmission(state: *const module_state.State, selected: *const bytecode.Function, capabilities: []const Capability, limits: RequestLimits, snapshot: StackSnapshot, guard_stack: usize) Admission {
    if (bytecode.moduleTablesView(state.module).hosts.len == 0) return .allowed;
    if (!selected.info.initializer and limits.depth < 1) return .depth;
    const storage = hostStorage(state, capabilities, snapshot) orelse return .abort;
    const heap = @addWithOverflow(storage, frameSize(selected));
    if (heap[1] != 0) return .abort;
    var future: usize = guard_stack;
    for (capabilities) |capability| if (capability.counter) |counter| {
        const run_stack = counter.runStackBytes() orelse return .abort;
        const execute_stack = counter.executionStackBytes() orelse return .abort;
        const frames = @addWithOverflow(run_stack, execute_stack);
        if (frames[1] != 0) return .abort;
        const peak = @addWithOverflow(frames[0], counter.boundaryBytes());
        if (peak[1] != 0) return .abort;
        future = @max(future, peak[0]);
    };
    return if (snapshot.admits(future, heap[0], limits.memory_bytes)) .allowed else .abort;
}
// This compact private decision avoids duplicating failure payloads in run.
// The caller forbids inlining; its actual frame/callees require separate proof.
pub fn preExecuteAdmission(state: *const module_state.State, function: *const bytecode.Function, capabilities: []const Capability, limits: RequestLimits) Admission {
    if (!function.info.initializer and limits.depth < 1) return .depth;
    if (bytecode.moduleTablesView(state.module).hosts.len == 0) {
        const storage = if (bytecode.moduleTablesView(state.module).present) state.storageBytes() else 0;
        return if (storage > limits.memory_bytes or frameSize(function) > limits.memory_bytes - storage)
            .abort else .allowed;
    }
    const snapshot = StackSnapshot.read();
    const storage = hostStorage(state, capabilities, snapshot) orelse return .abort;
    const heap = @addWithOverflow(storage, frameSize(function));
    if (heap[1] != 0) return .abort;
    var future_stack: usize = 0;
    for (capabilities) |capability| if (capability.counter) |counter| {
        const execute_stack = counter.executionStackBytes() orelse return .abort;
        const peak = @addWithOverflow(execute_stack, counter.boundaryBytes());
        if (peak[1] != 0) return .abort;
        future_stack = @max(future_stack, peak[0]);
    };
    return if (snapshot.admits(future_stack, heap[0], limits.memory_bytes)) .allowed else .abort;
}
pub fn leave(allocator: std.mem.Allocator, frame: *Frame) void {
    const backing: [*]u64 = @ptrCast(frame);
    allocator.free(backing[0 .. frame.bytes / @sizeOf(u64)]);
}
// Borrowed Frame/Instruction remain owned by the synchronous run; no address escapes.
pub fn executeArithmeticInstruction(current: *Frame, op: *const bytecode.Instruction, result_out: *RequestOutcome) bool {
    const frame = current.registers;
    const current_id = &current.function.info.function_id;
    const source = &op.source;
    if (op.opcode == 4) {
            frame[op.register] = if (contract.floatType(op.type_code)) floatArithmetic(op.opcode, op.type_code, frame[op.left], frame[op.right]) else (frame[op.left] +% frame[op.right]) & contract.mask(op.type_code);
        } else if (op.opcode == 5) {
            frame[op.register] = if (contract.floatType(op.type_code)) floatArithmetic(op.opcode, op.type_code, frame[op.left], frame[op.right]) else (frame[op.left] -% frame[op.right]) & contract.mask(op.type_code);
        } else if (op.opcode == 6) {
            frame[op.register] = if (contract.floatType(op.type_code)) floatArithmetic(op.opcode, op.type_code, frame[op.left], frame[op.right]) else (frame[op.left] *% frame[op.right]) & contract.mask(op.type_code);
        } else if (op.opcode == 7 or op.opcode == 8) {
            const left = frame[op.left];
            const right = frame[op.right];
            if (contract.floatType(op.type_code)) { frame[op.register] = floatArithmetic(op.opcode, op.type_code, left, right); return true; }
            // Guard before native division/remainder, including MIN / -1.
            if (right == 0) { if (op.opcode == 7) storeArithmeticTrap(result_out, "r01-t-divide-zero", "r01-division", current_id, source) else storeArithmeticTrap(result_out, "r01-t-remainder-zero", "r01-division", current_id, source); return false; }
            if (contract.signedType(op.type_code)) {
                const a = contract.signedValue(left, op.type_code); const b = contract.signedValue(right, op.type_code);
                const result = if (a == std.math.minInt(i64) and b == -1)
                    (if (op.opcode == 7) std.math.minInt(i64) else @as(i64, 0))
                else if (op.opcode == 7) @divTrunc(a, b) else @rem(a, b);
                frame[op.register] = @as(u64, @bitCast(result)) & contract.mask(op.type_code);
            } else frame[op.register] = if (op.opcode == 7) left / right else left % right;

    } else unreachable;
    return true;
}

// Borrowed Frame/Instruction remain owned by the synchronous run; no address escapes.
pub fn executeBitInstruction(current: *Frame, op: *const bytecode.Instruction, result_out: *RequestOutcome) bool {
    const frame = current.registers;
    const current_id = &current.function.info.function_id;
    const source = &op.source;
    if (op.opcode >= 9 and op.opcode <= 11) {
            const signed_count: i32 = @bitCast(@as(u32, @truncate(frame[op.right])));
            // Range-check signed counts before narrowing or shifting.
            if (signed_count < 0 or signed_count >= contract.bitWidth(op.type_code)) { storeArithmeticTrap(result_out, "r01-t-shift-count", "r01-shifts", current_id, source); return false; }
            const count: u6 = @intCast(signed_count);
            const bits = frame[op.left];
            frame[op.register] = if (op.opcode == 9) (bits << count) & contract.mask(op.type_code)
                else if (op.opcode == 10 and contract.signedType(op.type_code)) @as(u64, @bitCast(contract.signedValue(bits, op.type_code) >> count)) & contract.mask(op.type_code)
                else bits >> count;
        } else if (op.opcode == 12) {
            frame[op.register] = frame[op.left] & frame[op.right];
        } else if (op.opcode == 13) {
            frame[op.register] = frame[op.left] | frame[op.right];
        } else if (op.opcode == 14) {
            frame[op.register] = frame[op.left] ^ frame[op.right];
        } else if (op.opcode == 15 or op.opcode == 33) {
            frame[op.register] = if (contract.floatType(op.type_code)) floatArithmetic(op.opcode, op.type_code, frame[op.left], 0) else (0 -% frame[op.left]) & contract.mask(op.type_code);
        } else if (op.opcode == 16) {
            frame[op.register] = ~frame[op.left] & contract.mask(op.type_code);
        } else if (op.opcode == 17) {
            frame[op.register] = @intFromBool(frame[op.left] == 0);

    } else unreachable;
    return true;
}

// Borrowed Frame/Instruction remain owned by the synchronous run; no address escapes.
pub fn executeComparisonInstruction(current: *Frame, op: *const bytecode.Instruction) bool {
    const frame = current.registers;
    const transfer = current.transfer;
    if (op.opcode >= 18 and op.opcode <= 23) {
            const code = current.function.register_types[op.left];
            if (contract.floatType(code)) { frame[op.register] = @intFromBool(floatCompare(op.opcode, code, frame[op.left], frame[op.right])); return true; }
            const signed = contract.signedType(code);
            const a = contract.signedValue(frame[op.left], code); const b = contract.signedValue(frame[op.right], code);
            frame[op.register] = @intFromBool(if (op.opcode == 18) frame[op.left] == frame[op.right]
                else if (op.opcode == 19) frame[op.left] != frame[op.right]
                else if (op.opcode == 20) (if (signed) a < b else frame[op.left] < frame[op.right])
                else if (op.opcode == 21) (if (signed) a <= b else frame[op.left] <= frame[op.right])
                else if (op.opcode == 22) (if (signed) a > b else frame[op.left] > frame[op.right])
                else (if (signed) a >= b else frame[op.left] >= frame[op.right]));
        } else if (op.opcode == 24 or op.opcode == 25) {
            const edge: usize = if (op.opcode == 24 or frame[op.register] != 0) 0 else 1;
            const target = if (edge == 0) op.left else op.right;
            const block = &current.function.blocks[target];
            for (op.edges[edge], 0..) |reg, i| transfer[i] = frame[reg];
            for (block.parameters, 0..) |parameter, i| frame[parameter.register] = transfer[i];
            current.cursor = block.start;

    } else unreachable;
    return true;
}
