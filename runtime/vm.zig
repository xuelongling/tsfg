// SPDX-License-Identifier: MIT
const std = @import("std");
const bytecode = @import("bytecode.zig");
const FunctionId = bytecode.FunctionId;
const VerifiedModule = bytecode.VerifiedModule;
const Source = bytecode.Source;
const contract = bytecode.contract;
const request = @import("request.zig");
const module_state = @import("module.zig");
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
fn requestFailure(code: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = function_id, .source = source } };
}

fn arithmeticTrap(comptime code: []const u8, comptime rule_id: []const u8, function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = code, .category = "trap", .rule_ids = &.{rule_id}, .function_id = function_id, .source = source } };
}

fn finish(outcome: *RequestOutcome, limits: RequestLimits, fuel: u64) void {
    switch (outcome.*) {
        .returned => |*result| { result.fuel_remaining = fuel; result.fuel_consumed = limits.semantic_fuel - fuel; },
        .failed => |*failure| { failure.fuel_remaining = fuel; failure.fuel_consumed = limits.semantic_fuel - fuel; },
    }
}

pub inline fn evaluate(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
    var instance = ModuleInstance.init(allocator, module) catch {
        var outcome = requestFailure("r05-execution-abort", function_id, bytecode.moduleInfoView(module).source);
        finish(&outcome, limits, limits.semantic_fuel); return outcome;
    };
    defer instance.deinit();
    return instance.evaluate(function_id, arguments, capabilities, limits);
}

// The VerifiedModule owns immutable descriptors and outlives every State and
// execution frame. Borrow that descriptor instead of duplicating it per call.
const Frame = struct { previous: ?*Frame, function: *const bytecode.Function, registers: []u64, transfer: []u64, cursor: usize = 0, return_register: u16 = 0, bytes: usize };
fn frameSize(function: *const bytecode.Function) usize {
    var max_parameters: usize = 0;
    for (function.blocks) |block| max_parameters = @max(max_parameters, block.parameters.len);
    return @sizeOf(Frame) + (@as(usize, function.info.register_count) + max_parameters) * @sizeOf(u64);
}
fn enter(allocator: std.mem.Allocator, function: *const bytecode.Function, previous: ?*Frame) AllocatorError!*Frame {
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
fn hostStorage(state: *const module_state.State, capabilities: []const Capability, snapshot: StackSnapshot) ?usize {
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
const Admission = enum { allowed, depth, abort };
fn preRunAdmission(state: *const module_state.State, selected: *const bytecode.Function, capabilities: []const Capability, limits: RequestLimits, snapshot: StackSnapshot, guard_stack: usize) Admission {
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
fn preExecuteAdmission(state: *const module_state.State, function: *const bytecode.Function, capabilities: []const Capability, limits: RequestLimits) Admission {
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
fn leave(allocator: std.mem.Allocator, frame: *Frame) void {
    const backing: [*]u64 = @ptrCast(frame);
    allocator.free(backing[0 .. frame.bytes / @sizeOf(u64)]);
}

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

fn floatNan(code: u8, bits: u64) bool {
    return if (code == 12) bits & 0x7f800000 == 0x7f800000 and bits & 0x007fffff != 0
        else bits & 0x7ff0000000000000 == 0x7ff0000000000000 and bits & 0x000fffffffffffff != 0;
}
fn canonicalNan(code: u8) u64 { return if (code == 12) 0x7fc00000 else 0x7ff8000000000000; }

// fmod: exact binary significand long division; no libm or floating division
// quotient overflow. The remainder is representable in the input precision.
fn floatRemainder(code: u8, left: u64, right: u64) u64 {
    const fraction: u6 = if (code == 12) 23 else 52;
    const sign_mask: u64 = if (code == 12) 0x80000000 else 0x8000000000000000;
    const infinity: u64 = if (code == 12) 0x7f800000 else 0x7ff0000000000000;
    const sign = left & sign_mask;
    const a = left & ~sign_mask; const b = right & ~sign_mask;
    if (floatNan(code, left) or floatNan(code, right) or a == infinity or b == 0) return canonicalNan(code);
    if (a < b or b == infinity) return left;
    if (a == b) return sign;
    const implicit = @as(u64, 1) << fraction;
    var x = a & (implicit - 1); var y = b & (implicit - 1);
    var ex: i32 = @intCast(a >> fraction); var ey: i32 = @intCast(b >> fraction);
    if (ex != 0) { x |= implicit; } else { ex = 1; while (x < implicit) { x <<= 1; ex -= 1; } }
    if (ey != 0) { y |= implicit; } else { ey = 1; while (y < implicit) { y <<= 1; ey -= 1; } }
    while (ex > ey) : (ex -= 1) { if (x >= y) x -= y; if (x == 0) return sign; x <<= 1; }
    if (x >= y) x -= y;
    if (x == 0) return sign;
    while (x < implicit) { x <<= 1; ey -= 1; }
    return sign | if (ey > 0) ((@as(u64, @intCast(ey)) << fraction) | (x - implicit)) else (x >> @as(u6, @intCast(1 - ey)));
}

fn floatArithmetic(opcode: u8, code: u8, left: u64, right: u64) u64 {
    @setFloatMode(.strict);
    if (floatNan(code, left) or (opcode <= 8 and floatNan(code, right))) return canonicalNan(code);
    if (opcode == 8) return floatRemainder(code, left, right);
    if (opcode == 15) return left ^ (if (code == 12) @as(u64, 0x80000000) else 0x8000000000000000);
    if (opcode == 33) return left;
    const bits: u64 = if (code == 12) blk: {
        const a: f32 = @bitCast(@as(u32, @truncate(left))); const b: f32 = @bitCast(@as(u32, @truncate(right)));
        const value: f32 = if (opcode == 4) a + b else if (opcode == 5) a - b else if (opcode == 6) a * b else if (opcode == 7) a / b else unreachable;
        break :blk @as(u32, @bitCast(value));
    } else blk: {
        const a: f64 = @bitCast(left); const b: f64 = @bitCast(right);
        const value: f64 = if (opcode == 4) a + b else if (opcode == 5) a - b else if (opcode == 6) a * b else if (opcode == 7) a / b else unreachable;
        break :blk @bitCast(value);
    };
    return if (floatNan(code, bits)) canonicalNan(code) else bits;
}

fn floatCompare(opcode: u8, code: u8, left: u64, right: u64) bool {
    @setFloatMode(.strict);
    if (floatNan(code, left) or floatNan(code, right)) return opcode == 19;
    return if (code == 12) blk: {
        const a: f32 = @bitCast(@as(u32, @truncate(left))); const b: f32 = @bitCast(@as(u32, @truncate(right)));
        break :blk if (opcode == 18) a == b else if (opcode == 19) a != b else if (opcode == 20) a < b else if (opcode == 21) a <= b else if (opcode == 22) a > b else if (opcode == 23) a >= b else unreachable;
    } else blk: {
        const a: f64 = @bitCast(left); const b: f64 = @bitCast(right);
        break :blk if (opcode == 18) a == b else if (opcode == 19) a != b else if (opcode == 20) a < b else if (opcode == 21) a <= b else if (opcode == 22) a > b else if (opcode == 23) a >= b else unreachable;
    };
}

const clock = @import("clock.zig");
const Budget = struct { fuel: u64, work: u64, deadline: clock.Deadline };
fn managedReference(function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = "r01-e-reference", .category = "managed-exception", .exception_kind = "ReferenceError", .rule_ids = &.{"r01-modules"}, .function_id = function_id, .source = source } };
}
// These private writers share the caller-owned outcome slot. Guest Frames
// and verified descriptor storage never alias it; no writer retains its address.
fn storeRequestFailure(out: *RequestOutcome, code: []const u8, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = code, .category = if (std.mem.eql(u8, code, "r05-execution-abort")) "execution-abort" else "request", .function_id = id.*, .source = source.* } };
}
fn storeArithmeticTrap(out: *RequestOutcome, comptime code: []const u8, comptime rule_id: []const u8, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = code, .category = "trap", .rule_ids = &.{rule_id}, .function_id = id.*, .source = source.* } };
}
fn storeManagedReference(out: *RequestOutcome, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .failed = .{ .code = "r01-e-reference", .category = "managed-exception", .exception_kind = "ReferenceError", .rule_ids = &.{"r01-modules"}, .function_id = id.*, .source = source.* } };
}
fn storeReturned(out: *RequestOutcome, value: TypedValue, id: *const FunctionId, source: *const Source) void {
    out.* = .{ .returned = .{ .result = value, .function_id = id.*, .source = source.* } };
}

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
        } else if (op.opcode >= 9 and op.opcode <= 17) {
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

// Borrowed Frame/Instruction remain owned by the synchronous run; no address escapes.
fn executeArithmeticInstruction(current: *Frame, op: *const bytecode.Instruction, result_out: *RequestOutcome) bool {
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
fn executeBitInstruction(current: *Frame, op: *const bytecode.Instruction, result_out: *RequestOutcome) bool {
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
fn executeComparisonInstruction(current: *Frame, op: *const bytecode.Instruction) bool {
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
