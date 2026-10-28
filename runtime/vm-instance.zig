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

const exec = @import("vm-execution.zig");
const Budget = exec.Budget;
const ExecutionState = exec.ExecutionState;
const execute = exec.execute;
const executeHost = exec.executeHost;
const cleanupExecution = exec.cleanupExecution;
const FloatingEnvironment = @import("floating-environment.zig").FloatingEnvironment;
const clock = @import("clock.zig");
const StackSnapshot = @import("host_counter.zig").StackSnapshot;
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
        var selected_index: usize = 0;
        for (bytecode.functions(self.state.module), 0..) |*function, index| if (std.mem.eql(u8, id, &function.info.function_id)) { selected = function; selected_index = index; break; };
        const function = selected orelse return .{ .code = "r05-request-function" };
        if (function.info.initializer != init_only) return .{ .code = "r05-request-function", .selected = function };
        if (tables.present or init_only) {
            var root = false;
            for (tables.roots) |candidate| if (candidate.function_index == selected_index and (candidate.kind == 1) == init_only) { root = true; break; };
            if (!root) return .{ .code = "r05-request-function", .selected = function };
        }
        if (!request.acceptsArguments(&function.info, arguments)) return .{ .code = "r05-request-arguments", .selected = function };
        for (capabilities, 0..) |capability, index| {
            var required = false;
            for (tables.hosts, 0..) |host, host_index| if (tables.plan.hostRequired(host_index) and host.capability == capability.id) {
                required = true;
                const signature = capability.signature orelse return .{ .code = "r05-request-capability", .selected = function };
                const claim = capability.semantic_contract orelse return .{ .code = "r05-request-host-contract", .selected = function };
                if (!host_semantics.accepts(capability.id, &signature, &claim)) return .{ .code = "r05-request-host-contract", .selected = function };
                const counter = capability.counter orelse return .{ .code = "r05-request-capability", .selected = function };
                if (!std.mem.eql(u8, &signature, &host.signature) or !counter.admitted()) return .{ .code = "r05-request-capability", .selected = function };
            };
            if (!required) return .{ .code = "r05-request-capability", .selected = function };
            for (capabilities[0..index]) |previous| if (previous.id == capability.id) return .{ .code = "r05-request-capability", .selected = function };
        }
        for (tables.hosts, 0..) |host, host_index| {
            if (!tables.plan.hostRequired(host_index)) continue;
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
        if (tables.plan.hasRequiredHosts()) {
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
        defer {
            // Activation cleanup has already released its roots. Collection is
            // transactional; an exhausted cleanup budget reports Abort while
            // retained globals and result roots still identify valid objects.
            self.state.strings.budget.limit = limits.memory_bytes - @min(limits.memory_bytes, self.state.storageBytes());
            // Failed requests have already released activation roots; preserve
            // their first failure rather than starting optional collection.
            if (outcome.* == .returned and self.state.strings.heap.owner != 0) self.state.strings.heap.collect() catch {
                const source = switch (outcome.*) { .returned => |r| r.source, .failed => |r| r.source };
                const failed_id = switch (outcome.*) { .returned => |r| r.function_id, .failed => |r| r.function_id };
                request.deinitOutcome(outcome);
                storeRequestFailure(outcome, "r05-execution-abort", &failed_id, &source);
                finish(outcome, limits, budget.fuel);
            };
        }
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
                        const accepted = @call(.never_inline, executeHost, .{ &self.state, current, instruction, capabilities, &limits, budget, execution.depth, execution.used_memory + self.state.strings.budget.used, outcome });
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
                    const accepted = @call(.never_inline, executeHost, .{ &self.state, current, instruction, capabilities, &limits, budget, execution.depth, execution.used_memory + self.state.strings.budget.used, outcome });
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
        const time_limit = limits.host_time_ns orelse if (bytecode.moduleTablesView(self.state.module).plan.hasRequiredHosts()) @as(?u64, 1000000000) else null;
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
