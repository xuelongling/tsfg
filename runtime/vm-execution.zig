// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const VerifiedModule = bytecode.VerifiedModule;
const request = @import("request.zig");
const host_semantics = @import("host-semantic-contract.zig");
const module_state = @import("module.zig");
const execution_frame = @import("execution_frame.zig");
const Frame = execution_frame.Frame;
const frameSize = execution_frame.frameSize;
const enter = execution_frame.enter;
const hostStorage = execution_frame.hostStorage;
const Admission = execution_frame.Admission;
const preRunAdmission = execution_frame.preRunAdmission;
const preExecuteAdmission = execution_frame.preExecuteAdmission;
const leave = execution_frame.leave;
const executeArithmeticInstruction = execution_frame.executeArithmeticInstruction;
const executeBitInstruction = execution_frame.executeBitInstruction;
const executeComparisonInstruction = execution_frame.executeComparisonInstruction;

pub const TypedValue = request.TypedValue;
const typedValue = request.typedValue;
const Capability = request.Capability;
const RequestLimits = request.RequestLimits;
const RequestOutcome = request.RequestOutcome;
const storeRequestFailure = request.storeRequestFailure;
const storeArithmeticTrap = request.storeArithmeticTrap;
const storeManagedReference = request.storeManagedReference;
const storeReturned = request.storeReturned;
const StackSnapshot = @import("host_counter.zig").StackSnapshot;
const strings = @import("string-value.zig");
const string_frame = @import("string-frame.zig");
const clock = @import("clock.zig");
pub const Budget = struct { fuel: u64, work: u64, deadline: clock.Deadline };

// The loop owns Frames/cursor and all cleanup. This synchronous private helper
// borrows only live immutable descriptors and the current mutable register slice.
// Its actual frame and each child path remain part of the future envelope.
pub fn executeHost(state: *const module_state.State, current: *const Frame, op: *const bytecode.Instruction, capabilities: []const Capability, limits: *const RequestLimits, budget: *Budget, depth: u32, used_memory: usize, result_out: *RequestOutcome) bool {
    const declaration = &bytecode.moduleTablesView(state.module).hosts[op.left];
    const source = &op.source;
    var adapter: ?*(@import("host_counter.zig").Counter) = null;
    for (capabilities) |*capability| if (capability.id == declaration.capability) { adapter = capability.counter; break; };
    const counter = adapter.?;
    if (depth >= limits.depth) { storeArithmeticTrap(result_out, "r01-t-depth", "r01-depth", &declaration.id, source); return false; }
    if (budget.fuel == 0) { storeArithmeticTrap(result_out, "r01-t-fuel", "r01-fuel", &declaration.id, source); return false; }
    budget.fuel -= 1;
    const work = counter.instructionBound();
    if (counter.boundaryBytes() > limits.memory_bytes - used_memory or work > budget.work or !counter.boundaryStackAvailable()) {
        storeRequestFailure(result_out, "r05-execution-abort", &declaration.id, source); return false;
    }
    budget.work -= work;
    if (budget.deadline.expired() catch true) { storeRequestFailure(result_out, "r05-execution-abort", &declaration.id, source); return false; }
    const registers = current.registers;
    registers[op.register] = counter.call(@truncate(registers[op.right]));
    if (budget.deadline.expired() catch true) { storeRequestFailure(result_out, "r05-execution-abort", &declaration.id, source); return false; }
    return true;
}

// The existing run owner reuses this synchronous context for serial initializers
// and the requested function. Pending pointers refer only to live guest Frames
// or immutable VerifiedModule records, never the returned step's native stack.
pub const ExecutionState = struct {
    active: ?*Frame,
    used_memory: usize,
    depth: u32,
    root_pending: bool,
    started: bool,
    pending_frame: ?*Frame = null,
    pending_function: ?*const bytecode.Function = null,
    pending_instruction: ?*const bytecode.Instruction = null,
    pending_bytes: usize = 0,
    pending_return: u64 = 0,
    pending_string_register: u16 = 0,
};
const ExecutionAction = enum { enter_root, call_guest, return_guest, call_host, terminal };

// Terminal cleanup retains the active.previous detach/free order. Host suspend
// deliberately keeps the same allocated chain alive in its existing run owner.
pub fn cleanupExecution(allocator: std.mem.Allocator, execution: *ExecutionState) void {
    while (execution.active) |frame| {
        execution.active = frame.previous;
        leave(allocator, frame);
    }
}

pub fn execute(allocator: std.mem.Allocator, state: *module_state.State, requested_id: *const FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, budget: *Budget, execution: *ExecutionState, result_out: *RequestOutcome) bool {
    const module = state.module;
    const all_functions = bytecode.functions(module);
    var selected: ?*const bytecode.Function = null;
    for (all_functions) |*function| if (std.mem.eql(u8, requested_id, &function.info.function_id)) {
        selected = function;
        break;
    };
    const function = selected orelse { storeRequestFailure(result_out, "r05-request-function", requested_id, &bytecode.moduleInfoView(module).source); return true; };
    const info = &function.info;
    const function_id = &info.function_id;
    if (!execution.started) {
        if (!info.initializer and limits.depth < 1) { storeArithmeticTrap(result_out, "r01-t-depth", "r01-depth", function_id, &info.source); return true; }
        var storage = state.storageBytes();
        if (bytecode.moduleTablesView(module).hosts.len != 0) {
            const snapshot = StackSnapshot.read();
            const active_stack = snapshot.activeBytes() orelse { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            const outside = hostStorage(state, capabilities, snapshot) orelse { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            const combined = @addWithOverflow(active_stack, outside);
            if (combined[1] != 0) { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; }
            // hostStorage includes the current managed allocations. Keep the
            // execution counter exclusive of them; the heap allocator charges
            // its changing live/collector storage separately at each boundary.
            storage = combined[0] - state.strings.budget.used;
        }
        if (storage > limits.memory_bytes or state.strings.budget.used > limits.memory_bytes - storage or frameSize(function) > limits.memory_bytes - storage - state.strings.budget.used) { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; }
        execution.* = .{ .root_pending = true, .started = true, .active = null, .used_memory = frameSize(function) + storage, .depth = if (info.initializer) 0 else 1 };
    }
    var suspended_host = false;
    defer if (!suspended_host) @call(.never_inline, cleanupExecution, .{ allocator, execution });
    while (true) {
        state.strings.budget.limit = limits.memory_bytes - execution.used_memory;
        const action = @call(.never_inline, executeStep, .{ execution, state, &limits, budget, result_out });
        if (action == .terminal) return true;
        if (action == .call_host) { suspended_host = true; return false; }
        if (action == .enter_root) {
            execution.active = enter(allocator, function, null, state.strings) catch { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            for (arguments, function.blocks[0].parameters) |argument, parameter| {
                if (argument == .string) {
                    const root = argument.string.import(state.strings) catch { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
                    execution.active.?.roots.install(parameter.register, root);
                } else execution.active.?.registers[parameter.register] = argument.bits();
            }
        } else if (action == .call_guest) {
            const callee = execution.pending_function.?;
            const current = execution.pending_frame.?;
            const op = execution.pending_instruction.?;
            state.strings.budget.limit = limits.memory_bytes - execution.used_memory - execution.pending_bytes;
            const next = enter(allocator, callee, current, state.strings) catch { storeRequestFailure(result_out, "r05-execution-abort", &callee.info.function_id, &callee.info.source); return true; };
            // Attach before copying: a failed retain is cleaned by the same
            // activation owner as every other request termination.
            execution.active = next;
            for (op.edges[0], callee.blocks[0].parameters) |argument, parameter| {
                if (parameter.type_code == 14) next.roots.copy(parameter.register, current.roots.registers[argument].?) catch { storeRequestFailure(result_out, "r05-execution-abort", &callee.info.function_id, &callee.info.source); return true; }
                else next.registers[parameter.register] = current.registers[argument];
            }
            next.return_register = op.register;
            execution.active = next;
            execution.depth += 1;
            execution.used_memory += execution.pending_bytes;
            execution.pending_frame = null;
            execution.pending_function = null;
            execution.pending_instruction = null;
        } else if (action == .return_guest) {
            const current = execution.pending_frame.?;
            const caller = current.previous.?;
            if (current.function.info.return_type == 14) {
                caller.roots.copy(current.return_register, current.roots.registers[execution.pending_string_register].?) catch { storeRequestFailure(result_out, "r05-execution-abort", &current.function.info.function_id, &current.function.info.source); return true; };
            } else caller.registers[current.return_register] = execution.pending_return;
            execution.used_memory -= current.bytes;
            execution.depth -= 1;
            execution.active = caller;
            execution.pending_frame = null;
            leave(allocator, current);
        } else unreachable;
    }
}

// Allocation and cleanup run only after this step has returned to its owner.
// One instruction's cursor/work/deadline decisions are consumed exactly once
// before publishing a guest call/return action. The Outcome slot stays owned.
fn executeStep(execution: *ExecutionState, state: *module_state.State, limits: *const RequestLimits, budget: *Budget, result_out: *RequestOutcome) ExecutionAction {
    if (execution.root_pending) {
        execution.root_pending = false;
        return .enter_root;
    }
    const all_functions = bytecode.functions(state.module);
    while (true) {
        const current = execution.active.?;
        const frame = current.registers;
        const current_id = &current.function.info.function_id;
        const instruction = &current.function.instructions[current.cursor];
        current.cursor += 1;
        const source = &instruction.source;
        if (instruction.opcode == 26) {
            if (budget.fuel == 0) { storeArithmeticTrap(result_out, "r01-t-fuel", "r01-fuel", current_id, source); return .terminal; }
            budget.fuel -= 1;
        }
        if (budget.work == 0) { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; }
        budget.work -= 1;
        if (budget.deadline.expired() catch true) { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; }
        const op = instruction;
        // Explicit decisions keep the candidate Debug caller free of an
        // unqualified native opcode jump table. Semantic dispatch charging
        // above remains one verified bytecode instruction, including opcode26.
        if (op.opcode == 1) {
            frame[op.register] = @as(u32, @bitCast(op.immediate));
        } else if (op.opcode == 3) {
            frame[op.register] = @intCast(op.immediate);
        } else if (op.opcode == 28 or op.opcode == 32) {
            frame[op.register] = op.literal_bits;
        } else if (op.opcode == 2) {
            const result = if (op.type_code == 14) 0 else frame[op.register];
            if (current.previous != null) {
                execution.pending_frame = current;
                execution.pending_return = result;
                execution.pending_string_register = op.register;
                return .return_guest;
            } else {
                if (op.type_code == 14) {
                    const owned = strings.String.retain(state.strings, current.roots.registers[op.register].?) catch { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; };
                    storeReturned(result_out, .{ .string = owned }, current_id, source);
                } else storeReturned(result_out, typedValue(result, op.type_code), current_id, source);
                return .terminal;
            }
        } else if (op.opcode >= 4 and op.opcode <= 8) {
            if (!@call(.never_inline, executeArithmeticInstruction, .{ current, op, result_out })) return .terminal;
        } else if ((op.opcode >= 9 and op.opcode <= 17) or op.opcode == 33) {
            if (!@call(.never_inline, executeBitInstruction, .{ current, op, result_out })) return .terminal;
        } else if (op.opcode >= 18 and op.opcode <= 25) {
            if (op.opcode == 24 or op.opcode == 25) {
                const edge: usize = if (op.opcode == 24 or frame[op.register] != 0) 0 else 1;
                const target = if (edge == 0) op.left else op.right;
                current.roots.branch(op.edges[edge], current.function.blocks[target].parameters) catch { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; };
            }
            if (!@call(.never_inline, executeComparisonInstruction, .{ current, op })) return .terminal;
        } else if (op.opcode == 26) {

        } else if (op.opcode == 27) {
            const callee = &all_functions[op.left];
            if (execution.depth >= limits.depth) { storeArithmeticTrap(result_out, "r01-t-depth", "r01-depth", &callee.info.function_id, &callee.info.source); return .terminal; }
            const bytes = frameSize(callee);
            if (state.strings.budget.used > limits.memory_bytes - execution.used_memory or bytes > limits.memory_bytes - execution.used_memory - state.strings.budget.used) { storeRequestFailure(result_out, "r05-execution-abort", &callee.info.function_id, &callee.info.source); return .terminal; }
            execution.pending_function = callee;
            execution.pending_frame = current;
            execution.pending_instruction = op;
            execution.pending_bytes = bytes;
            return .call_guest;
        } else if (op.opcode == 29) {
            if (!state.initialized[op.left]) { storeManagedReference(result_out, current_id, source); return .terminal; }
            if (op.type_code == 14) current.roots.copy(op.register, state.string_globals[op.left].?) catch { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; }
            else frame[op.register] = state.globals[op.left];
        } else if (op.opcode == 30) {
            if (op.right == 0 and !state.initialized[op.left]) { storeManagedReference(result_out, current_id, source); return .terminal; }
            if (op.type_code == 14) {
                const kept = state.strings.heap.retain(current.roots.registers[op.register].?, .persistent) catch { storeRequestFailure(result_out, "r05-execution-abort", current_id, source); return .terminal; };
                if (state.string_globals[op.left]) |old| state.strings.heap.release(old) catch unreachable;
                state.string_globals[op.left] = kept;
            } else state.globals[op.left] = frame[op.register];
            state.initialized[op.left] = true;
        } else if (op.opcode == 31) {
            execution.pending_frame = current;
            execution.pending_instruction = op;
            return .call_host;
        } else if (op.opcode >= 34 and op.opcode <= 39) {
            string_frame.execute(&current.roots, frame, op.*) catch |err| {
                if (err == error.IndexOutOfBounds) storeArithmeticTrap(result_out, "r01-t-string-range", "r01-strings", current_id, source)
                else storeRequestFailure(result_out, "r05-execution-abort", current_id, source);
                return .terminal;
            };
        } else {
            unreachable;
        }
    }
}
