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
    fn preflight(self: *ModuleInstance, id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, init_only: bool) ?RequestOutcome {
        const tables = bytecode.moduleTables(self.state.module);
        var selected: ?bytecode.Function = null;
        for (bytecode.functions(self.state.module)) |function| if (std.mem.eql(u8, &id, &function.info.function_id)) { selected = function; break; };
        const function = selected orelse return requestFailure("r05-request-function", id, bytecode.moduleInfo(self.state.module).source);
        if (function.info.initializer != init_only) return requestFailure("r05-request-function", id, function.info.source);
        if (init_only) {
            var root = false;
            for (tables.roots) |candidate| if (candidate.kind == 1 and std.mem.eql(u8, &bytecode.functions(self.state.module)[candidate.function_index].info.function_id, &id)) { root = true; break; };
            if (!root) return requestFailure("r05-request-function", id, function.info.source);
        }
        if (arguments.len != function.info.parameter_types.len) return requestFailure("r05-request-arguments", id, function.info.source);
        for (arguments, function.info.parameter_types) |argument, code| if (argument.typeCode() != code) return requestFailure("r05-request-arguments", id, function.info.source);
        for (capabilities, 0..) |capability, index| {
            var required = false;
            for (tables.hosts) |host| if (host.capability == capability.id) {
                required = true;
                const signature = capability.signature orelse return requestFailure("r05-request-capability", id, function.info.source);
                const counter = capability.counter orelse return requestFailure("r05-request-capability", id, function.info.source);
                if (!std.mem.eql(u8, &signature, &host.signature) or !counter.admitted()) return requestFailure("r05-request-capability", id, function.info.source);
            };
            if (!required) return requestFailure("r05-request-capability", id, function.info.source);
            for (capabilities[0..index]) |previous| if (previous.id == capability.id) return requestFailure("r05-request-capability", id, function.info.source);
        }
        for (tables.hosts) |host| {
            var authorized = false;
            for (capabilities) |capability| if (capability.id == host.capability) { authorized = true; break; };
            if (!authorized) return requestFailure("r05-request-capability", id, function.info.source);
        }
        return null;
    }
    fn run(self: *ModuleInstance, id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, init_only: bool) RequestOutcome {
        if (self.preflight(id, arguments, capabilities, init_only)) |rejected| {
            var outcome = rejected; finish(&outcome, limits, limits.semantic_fuel); return outcome;
        }
        if (self.state.status == .failed) {
            var outcome: RequestOutcome = .{ .failed = self.state.failure.? };
            finish(&outcome, limits, limits.semantic_fuel); return outcome;
        }
        if (self.state.status == .initializing) {
            var outcome = requestFailure("r05-request-instance", id, bytecode.moduleInfo(self.state.module).source);
            finish(&outcome, limits, limits.semantic_fuel); return outcome;
        }
        const time_limit = limits.host_time_ns orelse if (bytecode.moduleTables(self.state.module).hosts.len != 0) @as(?u64, 1000000000) else null;
        var budget: Budget = .{ .fuel = limits.semantic_fuel, .work = limits.instruction_budget, .deadline = clock.Deadline.init(time_limit) catch {
            var outcome = requestFailure("r05-execution-abort", id, bytecode.moduleInfo(self.state.module).source);
            finish(&outcome, limits, limits.semantic_fuel); return outcome;
        } };
        if (self.state.status == .uninitialized) {
            self.state.status = .initializing;
            for (bytecode.moduleTables(self.state.module).initialization) |initializer| {
                const function = bytecode.functions(self.state.module)[initializer];
                var outcome = execute(self.state.allocator, &self.state, function.info.function_id, &.{}, capabilities, limits, &budget);
                if (outcome == .failed) {
                    finish(&outcome, limits, budget.fuel);
                    self.state.fail(outcome.failed);
                    return outcome;
                }
            }
            self.state.status = .initialized;
        }
        var outcome = if (init_only) blk: {
            for (bytecode.functions(self.state.module)) |function| if (std.mem.eql(u8, &id, &function.info.function_id)) {
                break :blk @as(RequestOutcome, .{ .returned = .{ .result = .{ .i32 = 0 }, .function_id = id, .source = function.info.source } });
            };
            unreachable;
        } else execute(self.state.allocator, &self.state, id, arguments, capabilities, limits, &budget);
        finish(&outcome, limits, budget.fuel);
        return outcome;
    }
    pub fn evaluate(self: *ModuleInstance, id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
        return self.run(id, arguments, capabilities, limits, false);
    }
    /// Initialization-only requires an explicit module-initialization root.
    /// Generated initializer IDs remain invalid ordinary function requests.
    pub fn initialize(self: *ModuleInstance, id: FunctionId, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
        return self.run(id, &.{}, capabilities, limits, true);
    }
};
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

pub fn evaluate(allocator: std.mem.Allocator, module: *const VerifiedModule, function_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits) RequestOutcome {
    var instance = ModuleInstance.init(allocator, module) catch {
        var outcome = requestFailure("r05-execution-abort", function_id, bytecode.moduleInfo(module).source);
        finish(&outcome, limits, limits.semantic_fuel); return outcome;
    };
    defer instance.deinit();
    return instance.evaluate(function_id, arguments, capabilities, limits);
}

const Frame = struct { previous: ?*Frame, function: bytecode.Function, registers: []u64, transfer: []u64, cursor: usize = 0, return_register: u16 = 0, bytes: usize };
fn frameSize(function: bytecode.Function) usize {
    var max_parameters: usize = 0;
    for (function.blocks) |block| max_parameters = @max(max_parameters, block.parameters.len);
    return @sizeOf(Frame) + (@as(usize, function.info.register_count) + max_parameters) * @sizeOf(u64);
}
fn enter(allocator: std.mem.Allocator, function: bytecode.Function, previous: ?*Frame) AllocatorError!*Frame {
    const frame = try allocator.create(Frame);
    errdefer allocator.destroy(frame);
    const registers = try allocator.alloc(u64, function.info.register_count);
    errdefer allocator.free(registers);
    const count = (frameSize(function) - @sizeOf(Frame)) / @sizeOf(u64) - function.info.register_count;
    const transfer = try allocator.alloc(u64, count);
    frame.* = .{ .previous = previous, .function = function, .registers = registers, .transfer = transfer, .bytes = frameSize(function) };
    return frame;
}
const AllocatorError = std.mem.Allocator.Error;
fn leave(allocator: std.mem.Allocator, frame: *Frame) void {
    allocator.free(frame.registers);
    allocator.free(frame.transfer);
    allocator.destroy(frame);
}

const clock = @import("clock.zig");
const Budget = struct { fuel: u64, work: u64, deadline: clock.Deadline };
fn managedReference(function_id: FunctionId, source: Source) RequestOutcome {
    return .{ .failed = .{ .code = "r01-e-reference", .category = "managed-exception", .exception_kind = "ReferenceError", .rule_ids = &.{"r01-modules"}, .function_id = function_id, .source = source } };
}
fn execute(allocator: std.mem.Allocator, state: *module_state.State, requested_id: FunctionId, arguments: []const TypedValue, capabilities: []const Capability, limits: RequestLimits, budget: *Budget) RequestOutcome {
    const module = state.module;
    const all_functions = bytecode.functions(module);
    var selected: ?bytecode.Function = null;
    for (all_functions) |function| if (std.mem.eql(u8, &requested_id, &function.info.function_id)) {
        selected = function;
        break;
    };
    const function = selected orelse return requestFailure("r05-request-function", requested_id, bytecode.moduleInfo(module).source);
    const info = function.info;
    const function_id = info.function_id;
    if (!info.initializer and limits.depth < 1) return arithmeticTrap("r01-t-depth", "r01-depth", function_id, info.source);
    var storage = if (bytecode.moduleTables(module).present) state.storageBytes() else 0;
    // The verified fixed execute-frame allocation already exists at native
    // entry. It was absent from the legacy heap-frame accounting, so admit it
    // once as administrative baseline before any guest initialization effect.
    // The adapter's future incoming return address is charged only at opcode31.
    for (capabilities) |capability| if (capability.counter) |counter| { storage += counter.administrativeBytes(); };
    if (storage > limits.memory_bytes or frameSize(function) > limits.memory_bytes - storage) return requestFailure("r05-execution-abort", function_id, info.source);
    var active: ?*Frame = enter(allocator, function, null) catch return requestFailure("r05-execution-abort", function_id, info.source);
    defer while (active) |frame| {
        active = frame.previous;
        leave(allocator, frame);
    };
    for (arguments, function.blocks[0].parameters) |argument, parameter| active.?.registers[parameter.register] = argument.bits();
    var used_memory = frameSize(function) + storage;
    var depth: u32 = if (info.initializer) 0 else 1;
    while (true) {
        const current = active.?;
        const frame = current.registers;
        const transfer = current.transfer;
        const current_id = current.function.info.function_id;
        const instruction = current.function.instructions[current.cursor];
        current.cursor += 1;
        const source = instruction.source;
        if (instruction.opcode == 26) {
            if (budget.fuel == 0) return arithmeticTrap("r01-t-fuel", "r01-fuel", current_id, source);
            budget.fuel -= 1;
        }
        if (budget.work == 0) return requestFailure("r05-execution-abort", current_id, source);
        budget.work -= 1;
        if (budget.deadline.expired() catch true) return requestFailure("r05-execution-abort", current_id, source);
        const op = instruction;
        switch (op.opcode) {
            1 => frame[op.register] = @as(u32, @bitCast(op.immediate)),
            3 => frame[op.register] = @intCast(op.immediate),
            28 => frame[op.register] = op.literal_bits,
            2 => {
                const result = frame[op.register];
                if (current.previous) |caller| {
                    caller.registers[current.return_register] = result;
                    used_memory -= current.bytes;
                    depth -= 1;
                    active = caller;
                    leave(allocator, current);
                } else return .{ .returned = .{ .result = typedValue(result, op.type_code), .function_id = current_id, .source = op.source } };
            },
            4 => frame[op.register] = (frame[op.left] +% frame[op.right]) & contract.mask(op.type_code),
            5 => frame[op.register] = (frame[op.left] -% frame[op.right]) & contract.mask(op.type_code),
            6 => frame[op.register] = (frame[op.left] *% frame[op.right]) & contract.mask(op.type_code),
            7, 8 => {
                const left = frame[op.left];
                const right = frame[op.right];
                // Guard before native division/remainder, including MIN / -1.
                if (right == 0) return if (op.opcode == 7) arithmeticTrap("r01-t-divide-zero", "r01-division", current_id, source) else arithmeticTrap("r01-t-remainder-zero", "r01-division", current_id, source);
                if (contract.signedType(op.type_code)) {
                    const a = contract.signedValue(left, op.type_code); const b = contract.signedValue(right, op.type_code);
                    const result = if (a == std.math.minInt(i64) and b == -1)
                        (if (op.opcode == 7) std.math.minInt(i64) else @as(i64, 0))
                    else if (op.opcode == 7) @divTrunc(a, b) else @rem(a, b);
                    frame[op.register] = @as(u64, @bitCast(result)) & contract.mask(op.type_code);
                } else frame[op.register] = if (op.opcode == 7) left / right else left % right;
            },
            9...11 => {
                const signed_count: i32 = @bitCast(@as(u32, @truncate(frame[op.right])));
                // Range-check signed counts before narrowing or shifting.
                if (signed_count < 0 or signed_count >= contract.bitWidth(op.type_code)) return arithmeticTrap("r01-t-shift-count", "r01-shifts", current_id, source);
                const count: u6 = @intCast(signed_count);
                const bits = frame[op.left];
                frame[op.register] = switch (op.opcode) {
                    9 => (bits << count) & contract.mask(op.type_code),
                    10 => if (contract.signedType(op.type_code)) @as(u64, @bitCast(contract.signedValue(bits, op.type_code) >> count)) & contract.mask(op.type_code) else bits >> count,
                    11 => bits >> count,
                    else => unreachable,
                };
            },
            12 => frame[op.register] = frame[op.left] & frame[op.right],
            13 => frame[op.register] = frame[op.left] | frame[op.right],
            14 => frame[op.register] = frame[op.left] ^ frame[op.right],
            15 => frame[op.register] = (0 -% frame[op.left]) & contract.mask(op.type_code),
            16 => frame[op.register] = ~frame[op.left] & contract.mask(op.type_code),
            17 => frame[op.register] = @intFromBool(frame[op.left] == 0),
            18...23 => {
                const code = current.function.register_types[op.left];
                const signed = contract.signedType(code);
                const a = contract.signedValue(frame[op.left], code); const b = contract.signedValue(frame[op.right], code);
                frame[op.register] = @intFromBool(switch (op.opcode) {
                18 => frame[op.left] == frame[op.right],
                19 => frame[op.left] != frame[op.right],
                20 => if (signed) a < b else frame[op.left] < frame[op.right],
                21 => if (signed) a <= b else frame[op.left] <= frame[op.right],
                22 => if (signed) a > b else frame[op.left] > frame[op.right],
                23 => if (signed) a >= b else frame[op.left] >= frame[op.right],
                else => unreachable,
                });
            },
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
            29 => {
                if (!state.initialized[op.left]) return managedReference(current_id, source);
                frame[op.register] = state.globals[op.left];
            },
            30 => {
                if (op.right == 0 and !state.initialized[op.left]) return managedReference(current_id, source);
                state.globals[op.left] = frame[op.register];
                state.initialized[op.left] = true;
            },
            31 => {
                const declaration = bytecode.moduleTables(module).hosts[op.left];
                var adapter: ?*(@import("host_counter.zig").Counter) = null;
                for (capabilities) |capability| if (capability.id == declaration.capability) { adapter = capability.counter; break; };
                const counter = adapter.?;
                if (depth >= limits.depth) return arithmeticTrap("r01-t-depth", "r01-depth", declaration.id, source);
                if (budget.fuel == 0) return arithmeticTrap("r01-t-fuel", "r01-fuel", declaration.id, source);
                budget.fuel -= 1;
                const work = counter.instructionBound();
                if (counter.boundaryBytes() > limits.memory_bytes - used_memory or work > budget.work) return requestFailure("r05-execution-abort", declaration.id, source);
                budget.work -= work;
                if (budget.deadline.expired() catch true) return requestFailure("r05-execution-abort", declaration.id, source);
                frame[op.register] = counter.call(@truncate(frame[op.right]));
                if (budget.deadline.expired() catch true) return requestFailure("r05-execution-abort", declaration.id, source);
            },
            else => unreachable,
        }
    }
}
