// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const VerifiedModule = bytecode.VerifiedModule;
const request = @import("request.zig");
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
pub const ModuleInstance = struct {
    state: module_state.State,
    pub fn init(allocator: std.mem.Allocator, module: *const VerifiedModule) !ModuleInstance {
        return .{ .state = try module_state.State.init(allocator, module) };
    }
    pub fn deinit(self: *ModuleInstance) void { self.state.deinit(); }
    pub fn status(self: *const ModuleInstance) module_state.State.Status { return self.state.status; }
    const Preflight = struct { code: ?[]const u8 = null, selected: ?*const bytecode.Function = null };
    fn preflight(self: *ModuleInstance, id: *const FunctionId, arguments: []const TypedValue, capabilities: []const Capability, init_only: bool) Preflight {
        const tables = bytecode.moduleTablesView(self.state.module);
        var selected: ?*const bytecode.Function = null;
        for (bytecode.functions(self.state.module)) |*function| if (std.mem.eql(u8, id, &function.info.function_id)) { selected = function; break; };
        const function = selected orelse return .{ .code = "r05-request-function" };
        if (function.info.initializer != init_only) return .{ .code = "r05-request-function", .selected = function };
        if (init_only) {
            var root = false;
            for (tables.roots) |candidate| if (candidate.kind == 1 and std.mem.eql(u8, &bytecode.functions(self.state.module)[candidate.function_index].info.function_id, id)) { root = true; break; };
            if (!root) return .{ .code = "r05-request-function", .selected = function };
        }
        if (arguments.len != function.info.parameter_types.len) return .{ .code = "r05-request-arguments", .selected = function };
        for (arguments, function.info.parameter_types) |argument, code| if (argument.typeCode() != code) return .{ .code = "r05-request-arguments", .selected = function };
        for (capabilities, 0..) |capability, index| {
            var required = false;
            for (tables.hosts) |host| if (host.capability == capability.id) {
                required = true;
                const signature = capability.signature orelse return .{ .code = "r05-request-capability", .selected = function };
                const counter = capability.counter orelse return .{ .code = "r05-request-capability", .selected = function };
                if (!std.mem.eql(u8, &signature, &host.signature) or !counter.admitted()) return .{ .code = "r05-request-capability", .selected = function };
            };
            if (!required) return .{ .code = "r05-request-capability", .selected = function };
            for (capabilities[0..index]) |previous| if (previous.id == capability.id) return .{ .code = "r05-request-capability", .selected = function };
        }
        for (tables.hosts) |host| {
            var authorized = false;
            for (capabilities) |capability| if (capability.id == host.capability) { authorized = true; break; };
            if (!authorized) return .{ .code = "r05-request-capability", .selected = function };
        }
        return .{ .selected = function };
    }
    const LifecycleDecision = struct {
        kind: enum { allowed, request, memo, depth, abort },
        code: ?[]const u8 = null,
        function: ?*const bytecode.Function = null,
    };
    fn admitLifecycle(self: *ModuleInstance, id: *const FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: *const RequestLimits, init_only: bool) LifecycleDecision {
        const checked = self.preflight(id, arguments, capabilities, init_only);
        if (checked.code) |code| return .{ .kind = .request, .code = code, .function = checked.selected };
        if (self.state.status == .failed) return .{ .kind = .memo };
        if (self.state.status == .initializing) return .{ .kind = .request, .code = "r05-request-instance" };
        const tables = bytecode.moduleTablesView(self.state.module);
        var function = checked.selected orelse return .{ .kind = .request, .code = "r05-request-function" };
        if (self.state.status == .uninitialized and tables.initialization.len != 0) {
            // The verified table owns these indexes. Iterate both immutable
            // views instead of creating an unchecked optional/index access in
            // the public pre-admission path. Malformed associations remain a
            // structured rejection even if a future verifier changes.
            var initializer: ?*const bytecode.Function = null;
            for (tables.initialization) |first| {
                for (bytecode.functions(self.state.module), 0..) |*candidate, index| {
                    if (index == first) { initializer = candidate; break; }
                }
                break;
            }
            function = initializer orelse return .{ .kind = .request, .code = "r05-request-instance", .function = function };
        }
        var admitted: Admission = .allowed;
        if (tables.hosts.len != 0) {
            if (!function.info.initializer and limits.depth < 1) {
                admitted = .depth;
            } else {
                const snapshot = StackSnapshot.read();
                var guard_stack: usize = 0;
                for (capabilities) |capability| if (capability.counter) |counter| {
                    guard_stack = @max(guard_stack, counter.admissionStackBytes() orelse { admitted = .abort; break; });
                };
                if (admitted != .abort) {
                    if (!snapshot.admits(guard_stack, 0, limits.memory_bytes)) admitted = .abort
                    else admitted = preRunAdmission(&self.state, function, capabilities, limits.*, snapshot, guard_stack);
                }
            }
        }
        if (admitted == .depth) return .{ .kind = .depth, .function = function };
        if (admitted == .abort) return .{ .kind = .abort, .function = function };
        return .{ .kind = .allowed, .function = function };
    }
    fn finishAdmission(self: *ModuleInstance, decision: LifecycleDecision, id: *const FunctionId, limits: *const RequestLimits, outcome: *RequestOutcome) void {
        if (decision.kind == .memo) {
            outcome.* = .{ .failed = self.state.failure.? };
        } else if (decision.kind == .depth) {
            const function = decision.function.?;
            storeArithmeticTrap(outcome, "r01-t-depth", "r01-depth", &function.info.function_id, &function.info.source);
        } else {
            const source = if (decision.function) |function| &function.info.source else &bytecode.moduleInfoView(self.state.module).source;
            const failed_id = if (decision.kind == .abort) &decision.function.?.info.function_id else id;
            storeRequestFailure(outcome, if (decision.kind == .abort) "r05-execution-abort" else decision.code.?, failed_id, source);
        }
        finish(outcome, limits.*, limits.semantic_fuel);
        if (decision.kind == .abort and self.state.status == .uninitialized and bytecode.moduleTablesView(self.state.module).initialization.len != 0)
            self.state.fail(outcome.failed);
    }
    // The initializer result remains caller-owned. Its failure is copied
    // into State before returning; this cold frame returns before the next
    // initializer or ordinary execute phase. Its full subtree remains charged.
    fn finishInitializer(self: *ModuleInstance, limits: *const RequestLimits, fuel: u64, outcome: *RequestOutcome) bool {
        if (outcome.* != .failed) return false;
        finish(outcome, limits.*, fuel);
        self.state.fail(outcome.failed);
        return true;
    }
    // The public invocation owns one result slot through admission and run.
    // Initializers reuse it serially; State.fail copies its owned memo before
    // returning. No guest Frame or allocator storage aliases or retains it.
    fn run(self: *ModuleInstance, id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, init_only: bool, outcome: *RequestOutcome, budget: *Budget) void {
        var execution: ExecutionState = .{ .active = null, .used_memory = 0, .depth = 0, .root_pending = false, .started = false };
        if (self.state.status == .uninitialized) {
            self.state.status = .initializing;
            for (bytecode.moduleTablesView(self.state.module).initialization) |initializer| {
                const function = &bytecode.functions(self.state.module)[initializer];
                const admitted = @call(.never_inline, preExecuteAdmission, .{ &self.state, function, capabilities, limits });
                if (admitted == .depth) storeArithmeticTrap(outcome, "r01-t-depth", "r01-depth", &function.info.function_id, &function.info.source)
                else if (admitted == .abort) storeRequestFailure(outcome, "r05-execution-abort", &function.info.function_id, &function.info.source)
                else {
                    execution.started = false;
                    while (!execute(self.state.allocator, &self.state, &function.info.function_id, &.{}, capabilities, limits, budget, &execution, outcome)) {
                        const current = execution.pending_frame.?;
                        const instruction = execution.pending_instruction.?;
                        const accepted = @call(.never_inline, executeHost, .{ &self.state, current, instruction, capabilities, &limits, budget, execution.depth, execution.used_memory, outcome });
                        execution.pending_frame = null;
                        execution.pending_instruction = null;
                        if (!accepted) {
                            @call(.never_inline, cleanupExecution, .{ self.state.allocator, &execution });
                            break;
                        }
                    }
                }
                if (@call(.never_inline, finishInitializer, .{ self, &limits, budget.fuel, outcome })) return;
            }
            self.state.status = .initialized;
        }
        var selected: ?*const bytecode.Function = null;
        for (bytecode.functions(self.state.module)) |*function| if (std.mem.eql(u8, &id, &function.info.function_id)) {
            selected = function;
            break;
        };
        const function = selected orelse unreachable;
        if (init_only) storeReturned(outcome, .{ .i32 = 0 }, &id, &function.info.source)
        else {
            const admitted = @call(.never_inline, preExecuteAdmission, .{ &self.state, function, capabilities, limits });
            if (admitted == .depth) storeArithmeticTrap(outcome, "r01-t-depth", "r01-depth", &function.info.function_id, &function.info.source)
            else if (admitted == .abort) storeRequestFailure(outcome, "r05-execution-abort", &function.info.function_id, &function.info.source)
            else {
                execution.started = false;
                while (!execute(self.state.allocator, &self.state, &id, arguments, capabilities, limits, budget, &execution, outcome)) {
                    const current = execution.pending_frame.?;
                    const instruction = execution.pending_instruction.?;
                    const accepted = @call(.never_inline, executeHost, .{ &self.state, current, instruction, capabilities, &limits, budget, execution.depth, execution.used_memory, outcome });
                    execution.pending_frame = null;
                    execution.pending_instruction = null;
                    if (!accepted) {
                        @call(.never_inline, cleanupExecution, .{ self.state.allocator, &execution });
                        break;
                    }
                }
            }
        }
        finish(outcome, limits, budget.fuel);
    }
    // The inline seam borrows immutable invocation values and the caller-owned
    // result only for this synchronous admission/run. State.fail owns its memo.
    inline fn invokeInto(self: *ModuleInstance, id: *const FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: *const RequestLimits, init_only: bool, outcome: *RequestOutcome) void {
        const decision = @call(.never_inline, admitLifecycle, .{ self, id, arguments, capabilities, limits, init_only });
        if (decision.kind != .allowed) {
            self.finishAdmission(decision, id, limits, outcome);
            return;
        }
        const caller_environment = FloatingEnvironment.read();
        caller_environment.establish();
        defer caller_environment.restore();
        // Preserve the original clock-before-no-host-depth ordering. This
        // Budget and the result are owned by this synchronous public call.
        const time_limit = limits.host_time_ns orelse if (bytecode.moduleTablesView(self.state.module).hosts.len != 0) @as(?u64, 1000000000) else null;
        var budget: Budget = .{ .fuel = limits.semantic_fuel, .work = limits.instruction_budget, .deadline = clock.Deadline.init(time_limit) catch {
            storeRequestFailure(outcome, "r05-execution-abort", id, &bytecode.moduleInfoView(self.state.module).source);
            finish(outcome, limits.*, limits.semantic_fuel); return;
        } };
        const function = decision.function.?;
        if (!init_only and !function.info.initializer and limits.depth < 1) {
            // Empty initialization previously completed before the ordinary
            // depth rejection. Keep that owned State transition observable.
            if (self.state.status == .uninitialized and bytecode.moduleTablesView(self.state.module).initialization.len == 0)
                self.state.status = .initialized;
            self.finishAdmission(.{ .kind = .depth, .function = function }, id, limits, outcome);
            return;
        }
        const output: AdmittedOutput = .{ .init_only = init_only, .outcome = outcome, .budget = &budget };
        if (tsfg_runtime_admitted_entry(self, id, &arguments, &capabilities, limits, &output) != 0)
            self.finishAdmission(.{ .kind = .abort, .function = function }, id, limits, outcome);
    }
    const AdmittedOutput = struct { init_only: bool, outcome: *RequestOutcome, budget: *Budget };
    // Public by-value ABI remains; only one owned local result survives run.
    pub fn evaluate(self: *ModuleInstance, id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
        var outcome: RequestOutcome = undefined;
        self.invokeInto(&id, arguments, capabilities, &limits, false, &outcome);
        return outcome;
    }
    /// Initialization-only requires an explicit module-initialization root.
    pub fn initialize(self: *ModuleInstance, id: FunctionId, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
        var outcome: RequestOutcome = undefined;
        self.invokeInto(&id, &.{}, capabilities, &limits, true, &outcome);
        return outcome;
    }
};
// Internal link symbols only: public evaluate/initialize retain their by-value
// API. All six borrows expire when this synchronous guarded call returns.
extern fn tsfg_runtime_admitted_entry(instance: *ModuleInstance, id: *const FunctionId, arguments: *const []const TypedValue, capabilities: *const []const Capability, limits: *const RequestLimits, output: *const ModuleInstance.AdmittedOutput) callconv(.c) u32;
// Link-only CLI seams borrow all invocation values and the caller-owned result
// until invokeInto returns. No borrowed address enters Frame, State or memo.
// The public by-value evaluate/initialize methods retain their existing ABI.
export fn tsfg_runtime_request_evaluate_into(instance: *ModuleInstance, id: *const FunctionId, arguments: *const []const TypedValue, capabilities: *const []const Capability, limits: *const RequestLimits, outcome: *RequestOutcome) callconv(.c) void {
    instance.invokeInto(id, arguments.*, capabilities.*, limits, false, outcome);
}
export fn tsfg_runtime_request_initialize_into(instance: *ModuleInstance, id: *const FunctionId, arguments: *const []const TypedValue, capabilities: *const []const Capability, limits: *const RequestLimits, outcome: *RequestOutcome) callconv(.c) void {
    instance.invokeInto(id, arguments.*, capabilities.*, limits, true, outcome);
}
export fn tsfg_runtime_admitted_body(instance: *ModuleInstance, id: *const FunctionId, arguments: *const []const TypedValue, capabilities: *const []const Capability, limits: *const RequestLimits, output: *const ModuleInstance.AdmittedOutput) callconv(.c) u32 {
    instance.run(id.*, arguments.*, capabilities.*, limits.*, output.init_only, output.outcome, output.budget);
    return 0;
}
pub const TypedValue = request.TypedValue;
pub const typedValue = request.typedValue;
pub const Capability = request.Capability;
pub const RequestLimits = request.RequestLimits;
pub const Returned = request.Returned;
pub const RequestFailure = request.RequestFailure;
pub const RequestOutcome = request.RequestOutcome;
const requestFailure = request.requestFailure;
const finish = request.finish;
const storeRequestFailure = request.storeRequestFailure;
const storeArithmeticTrap = request.storeArithmeticTrap;
const storeManagedReference = request.storeManagedReference;
const storeReturned = request.storeReturned;
pub inline fn evaluate(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
    var instance = ModuleInstance.init(allocator, module) catch {
        var outcome = requestFailure("r05-execution-abort", function_id, bytecode.moduleInfoView(module).source);
        finish(&outcome, limits, limits.semantic_fuel); return outcome;
    };
    defer instance.deinit();
    return instance.evaluate(function_id, arguments, capabilities, limits);
}

const StackSnapshot = @import("host_counter.zig").StackSnapshot;

// The supported Runtime target is x86_64. This is thread state, never global
// process configuration. Bit-only transport does not load NaNs into FP registers.
pub const FloatingEnvironment = struct {
    mxcsr: u32,
    x87_control: u16,
    pub fn read() FloatingEnvironment {
        var state: FloatingEnvironment = undefined;
        asm volatile ("stmxcsr (%[ptr])" : : [ptr] "r" (&state.mxcsr) : .{ .memory = true });
        asm volatile ("fnstcw (%[ptr])" : : [ptr] "r" (&state.x87_control) : .{ .memory = true });
        return state;
    }
    pub fn restore(self: FloatingEnvironment) void {
        asm volatile ("ldmxcsr (%[ptr])" : : [ptr] "r" (&self.mxcsr) : .{ .memory = true });
        asm volatile ("fldcw (%[ptr])" : : [ptr] "r" (&self.x87_control) : .{ .memory = true });
    }
    pub fn establish(self: FloatingEnvironment) void {
        // Clear rounding mode, FTZ/DAZ and pending SSE flags; mask exceptions.
        const strict: FloatingEnvironment = .{ .mxcsr = (self.mxcsr & ~@as(u32, 0xe07f)) | 0x1f80,
            .x87_control = (self.x87_control & ~@as(u16, 0x0c00)) | 0x003f };
        strict.restore();
    }
};

const clock = @import("clock.zig");
const Budget = struct { fuel: u64, work: u64, deadline: clock.Deadline };

// The loop owns Frames/cursor and all cleanup. This synchronous private helper
// borrows only live immutable descriptors and the current mutable register slice.
// Its actual frame and each child path remain part of the future envelope.
fn executeHost(state: *const module_state.State, current: *const Frame, op: *const bytecode.Instruction, capabilities: []const Capability, limits: *const RequestLimits, budget: *Budget, depth: u32, used_memory: usize, result_out: *RequestOutcome) bool {
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
const ExecutionState = struct {
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
};
const ExecutionAction = enum { enter_root, call_guest, return_guest, call_host, terminal };

// Terminal cleanup retains the active.previous detach/free order. Host suspend
// deliberately keeps the same allocated chain alive in its existing run owner.
fn cleanupExecution(allocator: std.mem.Allocator, execution: *ExecutionState) void {
    while (execution.active) |frame| {
        execution.active = frame.previous;
        leave(allocator, frame);
    }
}

fn execute(allocator: std.mem.Allocator, state: *module_state.State, requested_id: *const FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, budget: *Budget, execution: *ExecutionState, result_out: *RequestOutcome) bool {
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
        var storage = if (bytecode.moduleTablesView(module).present) state.storageBytes() else 0;
        if (bytecode.moduleTablesView(module).hosts.len != 0) {
            const snapshot = StackSnapshot.read();
            const active_stack = snapshot.activeBytes() orelse { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            const outside = hostStorage(state, capabilities, snapshot) orelse { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            const combined = @addWithOverflow(active_stack, outside);
            if (combined[1] != 0) { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; }
            storage = combined[0];
        }
        if (storage > limits.memory_bytes or frameSize(function) > limits.memory_bytes - storage) { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; }
        execution.* = .{ .root_pending = true, .started = true, .active = null, .used_memory = frameSize(function) + storage, .depth = if (info.initializer) 0 else 1 };
    }
    var suspended_host = false;
    defer if (!suspended_host) @call(.never_inline, cleanupExecution, .{ allocator, execution });
    while (true) {
        const action = @call(.never_inline, executeStep, .{ execution, state, &limits, budget, result_out });
        if (action == .terminal) return true;
        if (action == .call_host) { suspended_host = true; return false; }
        if (action == .enter_root) {
            execution.active = enter(allocator, function, null) catch { storeRequestFailure(result_out, "r05-execution-abort", function_id, &info.source); return true; };
            for (arguments, function.blocks[0].parameters) |argument, parameter| execution.active.?.registers[parameter.register] = argument.bits();
        } else if (action == .call_guest) {
            const callee = execution.pending_function.?;
            const current = execution.pending_frame.?;
            const op = execution.pending_instruction.?;
            const next = enter(allocator, callee, current) catch { storeRequestFailure(result_out, "r05-execution-abort", &callee.info.function_id, &callee.info.source); return true; };
            for (op.edges[0], callee.blocks[0].parameters) |argument, parameter| next.registers[parameter.register] = current.registers[argument];
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
            caller.registers[current.return_register] = execution.pending_return;
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
            const result = frame[op.register];
            if (current.previous != null) {
                execution.pending_frame = current;
                execution.pending_return = result;
                return .return_guest;
            } else { storeReturned(result_out, typedValue(result, op.type_code), current_id, &op.source); return .terminal; }
        } else if (op.opcode >= 4 and op.opcode <= 8) {
            if (!@call(.never_inline, executeArithmeticInstruction, .{ current, op, result_out })) return .terminal;
        } else if ((op.opcode >= 9 and op.opcode <= 17) or op.opcode == 33) {
            if (!@call(.never_inline, executeBitInstruction, .{ current, op, result_out })) return .terminal;
        } else if (op.opcode >= 18 and op.opcode <= 25) {
            if (!@call(.never_inline, executeComparisonInstruction, .{ current, op })) return .terminal;
        } else if (op.opcode == 26) {

        } else if (op.opcode == 27) {
            const callee = &all_functions[op.left];
            if (execution.depth >= limits.depth) { storeArithmeticTrap(result_out, "r01-t-depth", "r01-depth", &callee.info.function_id, &callee.info.source); return .terminal; }
            const bytes = frameSize(callee);
            if (bytes > limits.memory_bytes - execution.used_memory) { storeRequestFailure(result_out, "r05-execution-abort", &callee.info.function_id, &callee.info.source); return .terminal; }
            execution.pending_function = callee;
            execution.pending_frame = current;
            execution.pending_instruction = op;
            execution.pending_bytes = bytes;
            return .call_guest;
        } else if (op.opcode == 29) {
            if (!state.initialized[op.left]) { storeManagedReference(result_out, current_id, source); return .terminal; }
            frame[op.register] = state.globals[op.left];
        } else if (op.opcode == 30) {
            if (op.right == 0 and !state.initialized[op.left]) { storeManagedReference(result_out, current_id, source); return .terminal; }
            state.globals[op.left] = frame[op.register];
            state.initialized[op.left] = true;
        } else if (op.opcode == 31) {
            execution.pending_frame = current;
            execution.pending_instruction = op;
            return .call_host;
        } else {
            unreachable;
        }
    }
}
