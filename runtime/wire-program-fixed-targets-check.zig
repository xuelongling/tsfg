// SPDX-License-Identifier: MIT
// Independent fixed code-flow over the already checked Common graph. Only
// Codes and logical storage maysets flow here: no actual heap, numeric value,
// allocation identity, Env instance or Region is manufactured from a bound.
const std = @import("std");
const fixed = @import("wire-program-fixed-callable-domain.zig");
const model = @import("wire-program-model.zig");
const t = fixed.t;
const Codes = fixed.Codes;
const Value = fixed.Value;
const Context = fixed.Context;
pub const Error = fixed.Error;
pub const Site = struct { function: t.FunctionRef, block: t.BlockRef, instruction: u16 };
// Preserve the existing Common fixed siteKey recipe. Finally clones share
// fn/start/end even though their physical instruction locations differ.
const Occurrence = struct { function: t.FunctionRef, start: u32, end: u32 };
pub const Flow = struct {
    // Owning, complete original-occurrence CODE sets at each physical site;
    // never a narrower actual World or a permission.
    sites: std.AutoHashMapUnmanaged(Site, Codes) = .empty,
    // Type-family birth-prefix meet only; no object, actual capacity or owner
    // identity is granted by this fixed-storage fact.
    initialized_arrays: std.AutoHashMapUnmanaged(t.TypeRef, usize) = .empty,
    pub fn deinit(self: *Flow, a: std.mem.Allocator) void {
        var it = self.sites.valueIterator(); while (it.next()) |value| value.deinit(a);
        self.sites.deinit(a); self.initialized_arrays.deinit(a); self.* = .{};
    }
};
const State = struct {
    values: []Value,
    cells: std.AutoHashMapUnmanaged(t.BindingRef, Codes) = .empty,
    fn init(c: *Context, count: usize) Error!State {
        try c.charge(count); const values = try c.allocator.alloc(Value, count); @memset(values, null); return .{ .values = values };
    }
    fn deinit(self: *State, c: *Context) void {
        for (self.values) |*v| fixed.deinitValue(v, c.allocator); c.allocator.free(self.values);
        var it = self.cells.valueIterator(); while (it.next()) |value| value.deinit(c.allocator); self.cells.deinit(c.allocator);
    }
    fn clone(c: *Context, source: *const State) Error!State {
        var out = try init(c, source.values.len); errdefer out.deinit(c);
        for (source.values, out.values) |value, *destination| { try c.step(); destination.* = try fixed.cloneValue(c, value); }
        var it = source.cells.iterator(); while (it.next()) |entry| { try c.step(); const target = try out.cells.getOrPut(c.allocator, entry.key_ptr.*); target.value_ptr.* = .{}; _ = try target.value_ptr.join(c, entry.value_ptr.*); }
        return out;
    }
    fn join(self: *State, c: *Context, incoming: *const State) Error!bool {
        var changed = false;
        for (self.values, incoming.values) |*old, value| { try c.step(); changed = (try fixed.joinValue(c, old, value)) or changed; }
        var it = incoming.cells.iterator(); while (it.next()) |entry| { try c.step(); const target = try self.cells.getOrPut(c.allocator, entry.key_ptr.*); if (!target.found_existing) target.value_ptr.* = .{};
            changed = (try target.value_ptr.join(c, entry.value_ptr.*)) or !target.found_existing or changed;
        }
        return changed;
    }
    fn store(self: *State, d: *fixed.Domain, binding: t.BindingRef, value: Value) Error!void {
        if (value) |codes| { try d.c.step(); const entry = try self.cells.getOrPut(d.c.allocator, binding); if (!entry.found_existing) entry.value_ptr.* = .{};
            const replacement = try Codes.clone(d.c, codes);
            entry.value_ptr.deinit(d.c.allocator); entry.value_ptr.* = replacement; try d.storeCaptured(binding, codes);
        }
    }
    fn load(self: *const State, d: *fixed.Domain, binding: t.BindingRef) Error!Value {
        if (try d.captured(binding)) |value| return value;
        if (self.cells.get(binding)) |value| return try Codes.clone(d.c, value);
        return Codes{};
    }
};

const Walker = struct {
    d: *fixed.Domain,
    output: *Flow,
    function: t.FunctionRef,
    entries: []?State = &.{},
    queued: []bool = &.{},
    pending: std.ArrayListUnmanaged(t.BlockRef) = .empty,
    fn deinit(self: *Walker) void {
        for (self.entries) |*entry| if (entry.*) |*state| state.deinit(self.d.c);
        self.d.c.allocator.free(self.entries); self.d.c.allocator.free(self.queued); self.pending.deinit(self.d.c.allocator);
    }
    fn record(self: *const Walker) *const model.Function { return &self.d.c.program.functions[@intFromEnum(self.function)]; }
    fn edge(self: *Walker, target: t.BlockRef, state: *const State, arguments: []const Value) Error!void {
        const c = self.d.c; const index = @intFromEnum(target); const parameters = self.record().blocks[index].parameters;
        try c.charge(parameters.len + 1); var incoming = try State.clone(c, state); defer incoming.deinit(c);
        for (parameters, arguments) |reg, value| try fixed.replaceValue(c, &incoming.values[@intFromEnum(reg)], value);
        var changed = false;
        if (self.entries[index]) |*old| { changed = try old.join(c, &incoming); } else { self.entries[index] = incoming; incoming = .{ .values = &.{} }; changed = true; }
        if (changed and !self.queued[index]) { try self.pending.append(c.allocator, target); self.queued[index] = true; }
    }
    fn unknown(self: *Walker, op: model.instruction.Instruction, state: *const State, called: Codes, normal: ?t.BlockRef) Error!void {
        try self.d.exposeClosures(called);
        for (op.operands) |reg| { try self.d.c.step(); if (self.d.logical(self.function, reg)) |view| try self.d.expose(view); if (state.values[@intFromEnum(reg)]) |value| try self.d.exposeClosures(value); }
        if (normal) |block| { const parameters = self.record().blocks[@intFromEnum(block)].parameters;
            if (parameters.len != 0) { if (self.d.logical(self.function, parameters[0])) |view| try self.d.expose(view); }
        } else if (op.result) |reg| { if (self.d.logical(self.function, reg)) |view| try self.d.expose(view); }
    }
    fn invoke(self: *Walker, at: Site, op: model.instruction.Instruction, state: *const State) Error!Value {
        const c = self.d.c; var called: Codes = .{}; defer called.deinit(c.allocator); var indirect = false;
        var normal: ?t.BlockRef = null; var output_view: ?t.TypeRef = null;
        switch (op.data) {
            .@"call" => |call| { try called.functions.put(c.allocator, call.callee, {}); },
            .eh_invoke => |call| { try called.functions.put(c.allocator, call.callee, {}); normal = call.normal; },
            .function_call => { indirect = true; called = try Codes.clone(c, state.values[@intFromEnum(op.operands[0])] orelse Codes{ .top = true }); },
            .eh_invoke_indirect => |call| { indirect = true; normal = call.normal; called = try Codes.clone(c, state.values[@intFromEnum(op.operands[0])] orelse Codes{ .top = true }); },
            inline .domain_method_call, .common_method_invoke => |call| {
                if (op.data == .common_method_invoke) normal = op.data.common_method_invoke.normal;
                // checkCompatibility has independently rebuilt this complete
                // nominal/structural method selection, before this flow runs.
                for (self.d.common.views.dispatch[@intFromEnum(call.dispatch)].method.arms) |arm| { try c.step(); try called.functions.put(c.allocator, arm.target orelse return error.InvalidShape, {}); }
            },
            else => return error.InvalidShape,
        }
        if (normal) |block| { const parameters = self.record().blocks[@intFromEnum(block)].parameters; if (parameters.len != 0) output_view = self.d.logical(self.function, parameters[0]); }
        else if (op.result) |reg| { output_view = self.d.logical(self.function, reg); }
        if (indirect) { try c.step(); const entry = try self.output.sites.getOrPut(c.allocator, at); if (!entry.found_existing) entry.value_ptr.* = .{}; _ = try entry.value_ptr.join(c, called); }
        var result: Value = if (try self.d.callable(output_view)) Codes{} else null; errdefer fixed.deinitValue(&result, c.allocator);
        var targets = called.functions.keyIterator(); while (targets.next()) |target| {
            try c.step(); const abi = self.d.abi(target.*); const bound = &self.d.bounds[@intFromEnum(target.*)]; try c.require(bound.contract != null);
            const skip: usize = if (indirect) 1 else @as(usize, if (abi.lexical_environment != null) 1 else 0) + @as(usize, if (abi.receiver != null) 1 else 0);
            try c.require(skip + abi.parameters.len <= op.operands.len);
            for (abi.parameters, 0..) |binding, index| {
                try c.step(); const reg = op.operands[skip + index]; const argument = state.values[@intFromEnum(reg)]; const expected = self.d.common.storage.bindings[@intFromEnum(binding)].@"type";
                try self.d.erase(expected, self.d.logical(self.function, reg), argument, false);
                if (try self.d.callable(expected)) { try c.require(argument != null); try self.d.observe(target.*, index, argument.?); }
            }
            if (result) |*value| { try c.require(bound.returned != null); _ = try value.join(c, bound.returned.?); }
            if (self.d.original(target.*).facets.unknown_host) { var one: Codes = .{}; defer one.deinit(c.allocator); try one.functions.put(c.allocator, target.*, {}); try self.unknown(op, state, one, normal); }
        }
        if (called.top) { try self.unknown(op, state, called, normal); if (result) |*value| value.top = true; }
        return result;
    }
    fn storageBinding(self: *Walker, reg: t.RegisterRef, slot: t.EnvironmentSlotRef) t.BindingRef {
        const environment = self.record().registers[@intFromEnum(reg)].carrier.environment;
        return self.d.common.closures.environments[@intFromEnum(environment)].slots[@intFromEnum(slot)].binding;
    }
    fn transfer(self: *Walker, at: Site, op: model.instruction.Instruction, state: *State) Error!void {
        const c = self.d.c; try c.charge(op.operands.len + 1);
        var view = if (op.result) |reg| self.d.logical(self.function, reg) else null;
        // The normalized Common reader takes these declared views from their
        // typed payload/directory, not from a wider physical result carrier.
        switch (op.data) {
            .global_load => |load| view = self.d.common.modules.globals[@intFromEnum(load.global)].@"type",
            .domain_field_read => |read| view = self.d.common.members.fields[@intFromEnum(read.member)].@"type",
            .eh_load => |load| { const binding = self.d.common.exceptions.bindings[@intFromEnum(load.binding)].binding; view = self.d.common.storage.bindings[@intFromEnum(binding)].@"type"; },
            .environment_load => |load| view = self.d.common.storage.bindings[@intFromEnum(self.storageBinding(op.operands[0], load.slot))].@"type",
            .domain_array_read => |read| view = read.element_view,
            inline .domain_view, .domain_copy => |transport| view = transport.static_view,
            .eh_carrier => |target| { if (target) |id| view = id; },
            .eh_assertion => |assertion| view = assertion.static_view,
            else => {},
        }
        var value: Value = null; defer fixed.deinitValue(&value, c.allocator);
        switch (op.data) {
            inline .function_make, .eh_function => |made| { value = Codes{}; try value.?.functions.put(c.allocator, made.function, {}); },
            .domain_literal => |literal| { const kind = self.d.common.types[@intFromEnum(literal.actual_type)].kind; if (kind == .@"null" or kind == .@"undefined") value = Codes{}; },
            .eh_cell => |cell| { const binding = self.d.common.exceptions.bindings[@intFromEnum(cell.binding)].binding; try state.store(self.d, binding, Codes{}); },
            .eh_load => |load| if (try self.d.callable(view)) { value = try state.load(self.d, self.d.common.exceptions.bindings[@intFromEnum(load.binding)].binding); },
            .environment_load => |load| if (try self.d.callable(view)) { value = try state.load(self.d, self.storageBinding(op.operands[0], load.slot)); },
            .eh_store => |store| { const binding = self.d.common.exceptions.bindings[@intFromEnum(store.binding)].binding; const incoming = state.values[@intFromEnum(op.operands[1])];
                try self.d.erase(self.d.common.storage.bindings[@intFromEnum(binding)].@"type", self.d.logical(self.function, op.operands[1]), incoming, false); try state.store(self.d, binding, incoming);
            },
            inline .environment_init, .environment_store => |store| { const binding = self.storageBinding(op.operands[0], store.slot); const incoming = state.values[@intFromEnum(op.operands[1])];
                try self.d.erase(self.d.common.storage.bindings[@intFromEnum(binding)].@"type", self.d.logical(self.function, op.operands[1]), incoming, false); try state.store(self.d, binding, incoming);
            },
            .global_load => { if (view) |id| try self.d.expose(id); if (try self.d.callable(view)) value = .{ .top = true }; },
            .global_store => { if (self.d.logical(self.function, op.operands[0])) |id| try self.d.expose(id); if (state.values[@intFromEnum(op.operands[0])]) |codes| try self.d.exposeClosures(codes); },
            .domain_field_read => |read| if (try self.d.callable(view)) { value = try Codes.clone(c, self.d.fields[try self.d.fieldRoot(read.member)].value); },
            .eh_field_read => |path| if (try self.d.callable(view)) { value = try Codes.clone(c, self.d.fields[try self.d.fieldRoot(path[path.len - 1])].value); },
            .domain_field_store => |write| { const incoming = state.values[@intFromEnum(op.operands[1])]; try self.d.erase(self.d.common.members.fields[@intFromEnum(write.member)].@"type", self.d.logical(self.function, op.operands[1]), incoming, false); try self.d.fieldWrite(write.member, incoming); },
            .eh_field_initialize => |write| { const incoming = state.values[@intFromEnum(op.operands[1])]; try self.d.erase(self.d.common.members.fields[@intFromEnum(write.field)].@"type", self.d.logical(self.function, op.operands[1]), incoming, false); try self.d.fieldWrite(write.field, incoming); },
            inline .domain_array_create, .common_typed_array_create => |creation| {
                try self.d.birth(creation.actual_array_type, op.operands.len); const element = self.d.common.types[@intFromEnum(creation.actual_array_type)].element.?;
                for (op.operands) |reg| { try c.step(); const incoming = state.values[@intFromEnum(reg)]; try self.d.erase(element, self.d.logical(self.function, reg), incoming, false); try self.d.arrayWrite(creation.actual_array_type, incoming); }
            },
            // Common53's first encoded view is its element view (the shared
            // record retains the older receiver_view field spelling).
            .domain_array_store => |store| { const incoming = state.values[@intFromEnum(op.operands[2])]; try self.d.erase(store.receiver_view, self.d.logical(self.function, op.operands[2]), incoming, false); try self.d.arrayWrite(self.d.logical(self.function, op.operands[0]).?, incoming); },
            .domain_array_read => { if (try self.d.callable(view)) { value = try self.d.arrayRead(self.d.logical(self.function, op.operands[0]).?); } else if (view) |id| { try self.d.expose(id); } },
            .domain_array_resize => try self.d.cancel(self.d.logical(self.function, op.operands[0]).?),
            .domain_read_span => |span| try self.d.linkArrays(self.d.logical(self.function, op.operands[0]).?, span.static_view),
            .domain_view, .domain_copy, .domain_refine, .eh_project, .eh_presence_widen, .eh_carrier, .eh_assertion, .eh_pack => {
                value = try fixed.cloneValue(c, state.values[@intFromEnum(op.operands[0])]);
                const is_packed = op.data == .eh_pack or (op.data == .eh_carrier and op.data.eh_carrier == null);
                if (is_packed) { if (self.d.logical(self.function, op.operands[0])) |id| try self.d.expose(id); if (value) |codes| try self.d.exposeClosures(codes); }
                else try self.d.erase(view, self.d.logical(self.function, op.operands[0]), value, op.data == .eh_assertion);
                if (value == null and try self.d.callable(view)) value = .{ .top = true };
            },
            .@"call", .function_call, .domain_method_call, .eh_invoke, .eh_invoke_indirect, .common_method_invoke => value = try self.invoke(at, op, state),
            // These Source-old construction records are not Common's typed
            // constructor ABI (80/81 plus85). Refuse rather than drop effects.
            .domain_construct, .domain_super, .domain_initialize_fields, .domain_field_define, .domain_field_initialize => return error.WrongMode,
            else => {}, // Pure non-code data operations do not create Codes.
        }
        if (op.result) |reg| try fixed.replaceValue(c, &state.values[@intFromEnum(reg)], value);
        switch (op.data) {
            inline .eh_invoke, .eh_invoke_indirect, .common_method_invoke => |call| {
                const parameters = self.record().blocks[@intFromEnum(call.normal)].parameters;
                try self.edge(call.normal, state, if (parameters.len == 0) &.{} else &.{value});
                try self.edge(call.exceptional, state, &.{null});
            },
            .br => |branch| { const args = try self.borrowArguments(state, op.operands); defer c.allocator.free(args); try self.edge(branch.destination, state, args); },
            .eh_route => |route| { const args = try self.borrowArguments(state, op.operands); defer c.allocator.free(args); try self.edge(route.successor, state, args); },
            .cond_br => |branch| { const args = try self.borrowArguments(state, op.operands[1..]); defer c.allocator.free(args); try self.edge(branch.true_destination, state, args[0..branch.true_count]); try self.edge(branch.false_destination, state, args[branch.true_count..]); },
            .domain_numeric_use => |numeric| try self.edge(numeric.normal_successor, state, &.{null}),
            .@"return" => { if (op.operands.len != 0) {
                const incoming = state.values[@intFromEnum(op.operands[0])]; const abi = self.d.abi(self.function);
                try self.d.erase(abi.result, self.d.logical(self.function, op.operands[0]), incoming, false);
                if (self.d.external[@intFromEnum(self.function)]) { if (incoming) |codes| try self.d.exposeClosures(codes); }
                if (self.d.bounds[@intFromEnum(self.function)].result_observed) |*observed| { _ = try observed.join(c, incoming orelse Codes{ .top = true }); }
            } },
            .eh_raise => { if (self.d.logical(self.function, op.operands[0])) |id| try self.d.expose(id); if (state.values[@intFromEnum(op.operands[0])]) |codes| try self.d.exposeClosures(codes); },
            else => {},
        }
    }
    fn borrowArguments(self: *Walker, state: *const State, operands: []const t.RegisterRef) Error![]Value {
        try self.d.c.charge(operands.len); const out = try self.d.c.allocator.alloc(Value, operands.len);
        // Borrowed Code views only until edge() makes the incoming STATE copy.
        for (operands, out) |reg, *value| value.* = state.values[@intFromEnum(reg)]; return out;
    }
    fn run(self: *Walker) Error!void {
        const c = self.d.c; const function = self.record(); try c.charge(function.blocks.len * 2);
        self.entries = try c.allocator.alloc(?State, function.blocks.len); @memset(self.entries, null);
        self.queued = try c.allocator.alloc(bool, function.blocks.len); @memset(self.queued, false);
        var initial = try State.init(c, function.registers.len); defer initial.deinit(c);
        const abi = self.d.abi(self.function); const bound = self.d.bounds[@intFromEnum(self.function)];
        if (bound.contract != null) {
            const offset: usize = @as(usize, if (abi.lexical_environment != null) 1 else 0) + @as(usize, if (abi.receiver != null) 1 else 0);
            for (abi.parameters, 0..) |binding, i| { try c.step(); if (!try self.d.callable(self.d.common.storage.bindings[@intFromEnum(binding)].@"type")) continue;
                const entry = try initial.cells.getOrPut(c.allocator, binding); entry.value_ptr.* = .{}; _ = try entry.value_ptr.join(c, bound.parameters[i]);
                try fixed.replaceValue(c, &initial.values[@intFromEnum(function.blocks[0].parameters[offset + i])], bound.parameters[i]);
            }
        }
        self.entries[0] = initial; initial = .{ .values = &.{} }; try self.pending.append(c.allocator, @enumFromInt(0)); self.queued[0] = true;
        var cursor: usize = 0;
        while (cursor < self.pending.items.len) : (cursor += 1) {
            try c.step(); const block_ref = self.pending.items[cursor]; const b = @intFromEnum(block_ref); self.queued[b] = false;
            var state = try State.clone(c, &self.entries[b].?); defer state.deinit(c);
            for (function.blocks[b].instructions, 0..) |op, i| try self.transfer(.{ .function = self.function, .block = block_ref, .instruction = @intCast(i) }, op, &state);
        }
    }
};

// Preconditions: same Context refs/layout/SSA/identity, fixed interface and
// checkCompatibility's complete Common member/M12/dispatch relation checks,
// plus the independently checked reviewed Host material when the
// Program has Host imports. This module does not replace that prerequisite.
// All original functions (including module init) and BOTH language
// arms participate. The contract is an input assumption only to this fixed
// realm; observations and call-site sets are independently propagated, then
// discharged, never initialized from the wire's site targets or dependencies.
// Result is plain derived CODE/storage data, not Source/HSC/actual or execution
// admission. No new Context, actual solver or per-instruction heap exists.
pub fn analyze(c: *Context) Error!Flow {
    var domain = try fixed.Domain.init(c); defer domain.deinit(); var result: Flow = .{}; errdefer result.deinit(c.allocator);
    while (true) {
        while (true) {
            try c.step(); domain.dirty = false;
            for (c.program.functions, 0..) |_, i| { try c.step(); var walker = Walker{ .d = &domain, .output = &result, .function = @enumFromInt(i) }; defer walker.deinit(); try walker.run(); }
            if (!domain.dirty) break;
        }
        if (!try domain.complete()) break;
    }
    try domain.discharge();
    // Terminal observation only: claims never feed this union, parameter
    // transfer, a callee result, or any actual domain. A nonclone has one
    // member; multiple finally clones contribute to the same original key.
    var occurrences: std.AutoHashMapUnmanaged(Occurrence, Codes) = .empty;
    defer { var values = occurrences.valueIterator(); while (values.next()) |value| value.deinit(c.allocator); occurrences.deinit(c.allocator); }
    var sites = result.sites.iterator();
    while (sites.next()) |site| {
        try c.step(); const at = site.key_ptr.*;
        const origin = c.program.functions[@intFromEnum(at.function)].blocks[@intFromEnum(at.block)].instructions[at.instruction].source;
        const entry = try occurrences.getOrPut(c.allocator, .{ .function = at.function, .start = origin.start, .end = origin.end });
        if (!entry.found_existing) entry.value_ptr.* = .{};
        _ = try entry.value_ptr.join(c, site.value_ptr.*);
    }
    sites = result.sites.iterator();
    while (sites.next()) |site| {
        try c.step(); const at = site.key_ptr.*;
        const origin = c.program.functions[@intFromEnum(at.function)].blocks[@intFromEnum(at.block)].instructions[at.instruction].source;
        const combined = occurrences.get(.{ .function = at.function, .start = origin.start, .end = origin.end }).?;
        const copied = try Codes.clone(c, combined); site.value_ptr.deinit(c.allocator); site.value_ptr.* = copied;
    }
    try c.require(result.sites.count() == domain.common.closures.calls.len);
    for (domain.common.closures.calls) |claim| {
        try c.step(); const derived = result.sites.get(.{ .function = claim.function, .block = claim.block, .instruction = claim.instruction }) orelse return error.InvalidShape;
        try c.require(!derived.top and derived.functions.count() == claim.targets.len);
        for (claim.targets) |target| { try c.step(); try c.require(derived.functions.contains(target)); }
    }
    for (domain.common.types, 0..) |row, i| { try c.step(); if (row.kind != .array) continue; const root = try domain.arrayRoot(i);
        if (!domain.arrays[root].unsafe) { if (domain.arrays[root].minimum) |n| try result.initialized_arrays.put(c.allocator, @enumFromInt(i), n); }
    }
    return result;
}
