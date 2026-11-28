// SPDX-License-Identifier: MIT
//! R05 Production Predecoded Register Interpreter & Sole Public `eval_bytecode` Interface.
//! Executes verified `r05-bytecode.VerifiedModule` on top of `r06-runtime.R06Runtime`:
//!   - Live GC root table per VM frame (objects genuinely relocate in young gen & promote to old gen)
//!   - Semantic Fuel, Active Call Depth, Physical Instruction Budget, and Hard OOM Isolation
//!   - Strict Exception (catch/finally) vs Trap/ExecutionAbort separation (traps skip user finally)
//!   - Validity-bound field/method inline cache keyed by `code_version`
//!   - Real Cross-Tier Native <-> VM Bridge (`invokeVmFromNative` / `callNativeFromVm`)
const std = @import("std");
const bc = @import("r05-bytecode.zig");
const gc_mod = @import("r06-gen-gc.zig");
const rt_mod = @import("r06-runtime.zig");

pub const ValTag = bc.ValTag;
pub const Op = bc.Op;

pub const CANON_NAN_F64: u64 = 0x7ff8000000000000;
pub const CANON_NAN_F32: u32 = 0x7fc00000;

pub const TypedVal = struct {
    tag: ValTag = .@"undefined",
    payload: u64 = 0,
    obj_ptr: ?*gc_mod.GcObject = null,

    pub fn undef() TypedVal {
        return .{ .tag = .@"undefined" };
    }
    pub fn nullVal() TypedVal {
        return .{ .tag = .@"null" };
    }
    pub fn fromI32(v: i32) TypedVal {
        return .{ .tag = .i32, .payload = @as(u32, @bitCast(v)) };
    }
    pub fn fromU32(v: u32) TypedVal {
        return .{ .tag = .u32, .payload = v };
    }
    pub fn fromI64(v: i64) TypedVal {
        return .{ .tag = .i64, .payload = @bitCast(v) };
    }
    pub fn fromU64(v: u64) TypedVal {
        return .{ .tag = .u64, .payload = v };
    }
    pub fn fromBool(v: bool) TypedVal {
        return .{ .tag = .bool, .payload = if (v) 1 else 0 };
    }
    pub fn fromF32Bits(bits: u32) TypedVal {
        return .{ .tag = .f32, .payload = bits };
    }
    pub fn fromF64Bits(bits: u64) TypedVal {
        return .{ .tag = .f64, .payload = bits };
    }
    pub fn fromObj(obj: *gc_mod.GcObject) TypedVal {
        return .{ .tag = .ref, .payload = obj.id, .obj_ptr = obj };
    }
    pub fn fromString(str_id: u64) TypedVal {
        return .{ .tag = .string, .payload = str_id };
    }
    pub fn asI32(self: TypedVal) i32 {
        return @bitCast(@as(u32, @truncate(self.payload)));
    }
    pub fn asU32(self: TypedVal) u32 {
        return @truncate(self.payload);
    }
    pub fn asI64(self: TypedVal) i64 {
        return switch (self.tag) {
            .i64 => @bitCast(self.payload),
            .u64 => @bitCast(self.payload),
            .u32 => @intCast(self.asU32()),
            else => @intCast(self.asI32()),
        };
    }
    pub fn asF32(self: TypedVal) f32 {
        return @bitCast(@as(u32, @truncate(self.payload)));
    }
    pub fn asF64(self: TypedVal) f64 {
        return switch (self.tag) {
            .f64 => @bitCast(self.payload),
            .f32 => @floatCast(self.asF32()),
            .i64 => @floatFromInt(self.asI64()),
            .u64 => @floatFromInt(self.payload),
            .u32 => @floatFromInt(self.asU32()),
            else => @floatFromInt(self.asI32()),
        };
    }
};

pub const DebugBreakpoint = struct {
    fn_idx: ?u32 = null,
    pc: ?u32 = null,
    source_offset: ?u32 = null,
};

pub const DebugLocalSnapshot = struct {
    reg: u16,
    tag: ValTag,
    i32_val: i32,
    payload: u64,
};

pub const DebugPauseEvent = struct {
    fn_idx: u32,
    pc: u32,
    source_start: u32,
    source_end: u32,
    call_depth: u32,
    call_stack_len: u8,
    call_stack: [16]u32,
    local_count: u8,
    locals: [16]DebugLocalSnapshot,
};

pub const DebugHook = struct {
    breakpoints: []const DebugBreakpoint = &.{},
    step_all: bool = false,
    max_events: usize = 64,
    events: std.ArrayListUnmanaged(DebugPauseEvent) = .empty,

    pub fn deinit(self: *DebugHook, allocator: std.mem.Allocator) void {
        self.events.deinit(allocator);
    }

    fn matches(self: *const DebugHook, fn_idx: u32, pc: u32, span: bc.SourceSpan) bool {
        if (self.step_all) return true;
        for (self.breakpoints) |bp| {
            if (bp.fn_idx) |bf| {
                if (bf != fn_idx) continue;
            }
            if (bp.pc) |bpc| {
                if (bpc == pc) return true;
                continue;
            }
            if (bp.source_offset) |off| {
                if (off >= span.start and off < @max(span.end, span.start + 1)) return true;
                continue;
            }
            if (bp.fn_idx != null) return true;
        }
        return false;
    }
};

pub const RequestLimits = struct {
    semantic_fuel: u64 = 4097,
    call_depth: u32 = 64,
    physical_instructions: u64 = 200_000,
    use_superinstructions: bool = true,
    /// Optional stress knob: trigger minor GC every N allocations/safepoints
    gc_stress_interval: u32 = 0,
    /// Optional live VM debugger hook (breakpoints & step tracing)
    debug_hook: ?*DebugHook = null,
};

pub const OutcomeStatus = enum(u8) {
    ok = 0,
    managed_exception = 1,
    trap = 2,
    execution_abort = 3,
    invalid_request = 4,
};

pub const ExecutionOutcome = struct {
    status: OutcomeStatus,
    value: TypedVal = TypedVal.undef(),
    code: []const u8 = "",
    rule_id: []const u8 = "",
    source_start: u32 = 0,
    source_end: u32 = 0,
    fuel_remaining: u64 = 0,
    fuel_consumed: u64 = 0,
    instructions_executed: u64 = 0,
};

/// Validity-bound inline field cache (invalidated whenever `code_version` changes!).
pub const FieldInlineCache = struct {
    code_version: u64 = 0,
    type_id: u64 = 0,
    field_idx: u16 = 0,
    hits: u64 = 0,
    misses: u64 = 0,

    pub fn lookup(self: *FieldInlineCache, ver: u64, tid: u64, fidx: u16) bool {
        if (self.code_version == ver and self.type_id == tid and self.field_idx == fidx) {
            self.hits += 1;
            return true;
        }
        self.code_version = ver;
        self.type_id = tid;
        self.field_idx = fidx;
        self.misses += 1;
        return false;
    }
};

const ClosureRec = struct {
    fn_idx: u32,
    env_obj: ?*gc_mod.GcObject,
};

const ArrayRec = struct {
    items: std.ArrayListUnmanaged(TypedVal) = .empty,
    active_readers: u32 = 0,
};

const SpanRec = struct {
    array_idx: u32,
    start: u32,
    len: u32,
    live: bool = true,
};

/// Persistent VM Instance owning module globals, closures, arrays, spans, strings,
/// and inline caches across multiple calls/frames. Registers a live GC HandleHook so
/// every heap reference inside globals, closures, arrays, and active exceptions is
/// traced and relocated across minor/major collections (zero UAF!).
pub const VmInstance = struct {
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    caps: *rt_mod.CapabilityTable,
    limits: RequestLimits,
    fuel: u64,
    fuel_consumed: u64 = 0,
    phys_ops: u64 = 0,
    depth: u32 = 0,
    call_stack_len: usize = 0,
    call_stack: [64]u32 = [_]u32{0} ** 64,
    alloc_counter: u32 = 0,
    closures: std.ArrayListUnmanaged(ClosureRec) = .empty,
    arrays: std.ArrayListUnmanaged(ArrayRec) = .empty,
    spans: std.ArrayListUnmanaged(SpanRec) = .empty,
    strings: std.ArrayListUnmanaged([]u16) = .empty,
    field_caches: [64]FieldInlineCache = [_]FieldInlineCache{.{}} ** 64,
    globals: []TypedVal,
    global_init: []bool,
    hook_attached: bool = false,

    // Exception vs Trap state
    exc_active: bool = false,
    exc_val: TypedVal = TypedVal.undef(),
    failed: bool = false,
    fail_outcome: ExecutionOutcome = .{ .status = .ok },

    pub fn create(
        rt: *rt_mod.R06Runtime,
        mod: *const bc.VerifiedModule,
        caps: *rt_mod.CapabilityTable,
        limits: RequestLimits,
    ) !*VmInstance {
        const inst = try rt.allocator.create(VmInstance);
        errdefer rt.allocator.destroy(inst);
        inst.* = try init(rt, mod, caps, limits);
        errdefer inst.deinitInternal();
        try inst.attachGcRoots();
        return inst;
    }

    pub fn destroy(self: *VmInstance) void {
        const alloc = self.rt.allocator;
        self.deinitInternal();
        alloc.destroy(self);
    }

    fn init(rt: *rt_mod.R06Runtime, mod: *const bc.VerifiedModule, caps: *rt_mod.CapabilityTable, limits: RequestLimits) !VmInstance {
        const g = try rt.allocator.alloc(TypedVal, mod.global_count);
        errdefer rt.allocator.free(g);
        @memset(g, TypedVal.undef());
        const gi = try rt.allocator.alloc(bool, mod.global_count);
        errdefer rt.allocator.free(gi);
        @memset(gi, false);
        return .{
            .rt = rt,
            .mod = mod,
            .caps = caps,
            .limits = limits,
            .fuel = limits.semantic_fuel,
            .globals = g,
            .global_init = gi,
        };
    }

    fn attachGcRoots(self: *VmInstance) !void {
        if (self.hook_attached) return;
        try self.rt.gc.registerHandleHook(.{
            .ctx = self,
            .visit_fn = &visitVmRoots,
        });
        self.hook_attached = true;
    }

    fn visitVmRoots(ctx: *anyopaque, updater: *const fn (*gc_mod.GenGc, *?*gc_mod.GcObject) gc_mod.GcError!void, gc: *gc_mod.GenGc) gc_mod.GcError!void {
        const self: *VmInstance = @ptrCast(@alignCast(ctx));
        // 1. Module globals
        for (self.globals) |*gv| {
            if (gv.tag == .ref and gv.obj_ptr != null) {
                try updater(gc, &gv.obj_ptr);
            }
        }
        // 2. Closure captured environment objects
        for (self.closures.items) |*cl| {
            if (cl.env_obj != null) {
                try updater(gc, &cl.env_obj);
            }
        }
        // 3. Array elements holding heap references
        for (self.arrays.items) |*arr| {
            for (arr.items.items) |*elem| {
                if (elem.tag == .ref and elem.obj_ptr != null) {
                    try updater(gc, &elem.obj_ptr);
                }
            }
        }
        // 4. Active propagating exception object
        if (self.exc_active and self.exc_val.tag == .ref and self.exc_val.obj_ptr != null) {
            try updater(gc, &self.exc_val.obj_ptr);
        }
    }

    fn deinitInternal(self: *VmInstance) void {
        if (self.hook_attached) {
            self.rt.gc.unregisterHandleHook(self);
            self.hook_attached = false;
        }
        for (self.arrays.items) |*a| a.items.deinit(self.rt.allocator);
        self.arrays.deinit(self.rt.allocator);
        self.spans.deinit(self.rt.allocator);
        for (self.strings.items) |s| self.rt.allocator.free(s);
        self.strings.deinit(self.rt.allocator);
        self.closures.deinit(self.rt.allocator);
        self.rt.allocator.free(self.globals);
        self.rt.allocator.free(self.global_init);
    }

    pub fn resetRequestBudget(self: *VmInstance, limits: RequestLimits) void {
        self.limits = limits;
        self.fuel = limits.semantic_fuel;
        self.fuel_consumed = 0;
        self.phys_ops = 0;
        self.depth = 0;
        self.call_stack_len = 0;
        self.exc_active = false;
        self.exc_val = TypedVal.undef();
        self.failed = false;
        self.fail_outcome = .{ .status = .ok };
    }

    pub fn callFunction(
        self: *VmInstance,
        function_id: [32]u8,
        arguments: []const TypedVal,
        limits: RequestLimits,
        out_str_utf8: ?*std.ArrayListUnmanaged(u8),
    ) ExecutionOutcome {
        const fn_idx = self.mod.findFunctionIndex(function_id) orelse {
            return .{ .status = .invalid_request, .code = "r05-request-function", .fuel_remaining = limits.semantic_fuel };
        };
        if (arguments.len != self.mod.functions[fn_idx].param_count) {
            return .{ .status = .invalid_request, .code = "r05-request-arity", .fuel_remaining = limits.semantic_fuel };
        }
        self.resetRequestBudget(limits);
        const t0 = self.rt.trace.beginScope();
        defer self.rt.trace.endScope(t0, "vm", "vm_call", @intCast(fn_idx));

        const rv = self.execFunction(fn_idx, arguments);
        if (self.failed) return self.fail_outcome;
        if (self.exc_active) {
            return .{
                .status = .managed_exception,
                .value = self.exc_val,
                .code = "r01-e-uncaught",
                .fuel_remaining = self.fuel,
                .fuel_consumed = self.fuel_consumed,
                .instructions_executed = self.phys_ops,
            };
        }
        if (rv.tag == .string) {
            if (out_str_utf8) |dst_buf| {
                if (self.getString(rv)) |units| {
                    const utf8 = std.unicode.utf16LeToUtf8Alloc(self.rt.allocator, units) catch null;
                    if (utf8) |u8s| {
                        defer self.rt.allocator.free(u8s);
                        dst_buf.appendSlice(self.rt.allocator, u8s) catch {};
                    }
                }
            }
        }
        return .{
            .status = .ok,
            .value = rv,
            .fuel_remaining = self.fuel,
            .fuel_consumed = self.fuel_consumed,
            .instructions_executed = self.phys_ops,
        };
    }

    fn allocString(self: *VmInstance, units: []const u16) !TypedVal {
        const copy = try self.rt.allocator.dupe(u16, units);
        errdefer self.rt.allocator.free(copy);
        try self.strings.append(self.rt.allocator, copy);
        return TypedVal.fromString(self.strings.items.len);
    }

    pub fn getString(self: *const VmInstance, v: TypedVal) ?[]const u16 {
        if (v.tag != .string or v.payload == 0 or v.payload > self.strings.items.len) return null;
        return self.strings.items[@intCast(v.payload - 1)];
    }

    fn asNumF64(v: TypedVal) f64 {
        return v.asF64();
    }

    fn setTrap(self: *VmInstance, code: []const u8, rule: []const u8, span: bc.SourceSpan) void {
        if (!self.failed) {
            self.failed = true;
            self.fail_outcome = .{
                .status = .trap,
                .code = code,
                .rule_id = rule,
                .source_start = span.start,
                .source_end = span.end,
                .fuel_remaining = self.fuel,
                .fuel_consumed = self.fuel_consumed,
                .instructions_executed = self.phys_ops,
            };
        }
    }

    fn setAbort(self: *VmInstance, code: []const u8, span: bc.SourceSpan) void {
        if (!self.failed) {
            self.failed = true;
            self.fail_outcome = .{
                .status = .execution_abort,
                .code = code,
                .source_start = span.start,
                .source_end = span.end,
                .fuel_remaining = self.fuel,
                .fuel_consumed = self.fuel_consumed,
                .instructions_executed = self.phys_ops,
            };
        }
    }

    fn canonF64(v: f64) u64 {
        if (std.math.isNan(v)) return CANON_NAN_F64;
        return @bitCast(v);
    }

    fn canonF32(v: f32) u32 {
        if (std.math.isNan(v)) return CANON_NAN_F32;
        return @bitCast(v);
    }

    fn syncRootsFromRegs(regs: []const TypedVal, roots: []gc_mod.RootSlot) void {
        for (regs, 0..) |r, i| {
            if (r.tag == .ref and r.obj_ptr != null) {
                roots[i] = .{ .kind = .live_ref, .ptr = r.obj_ptr };
            } else {
                roots[i] = .{ .kind = .scalar, .ptr = null };
            }
        }
    }

    fn syncRegsFromRoots(regs: []TypedVal, roots: []const gc_mod.RootSlot) void {
        for (roots, 0..) |slot, i| {
            if (slot.kind == .live_ref and slot.ptr != null) {
                regs[i].obj_ptr = slot.ptr;
            }
        }
    }

    fn maybeGcSafepoint(self: *VmInstance, regs: []TypedVal, roots: []gc_mod.RootSlot, force: bool, span: bc.SourceSpan) void {
        self.alloc_counter += 1;
        const trigger = force or (self.limits.gc_stress_interval > 0 and (self.alloc_counter % self.limits.gc_stress_interval == 0));
        if (!trigger) return;
        syncRootsFromRegs(regs, roots);
        self.rt.gc.collectMinor() catch {
            self.setAbort("r05-execution-abort-oom", span);
            return;
        };
        syncRegsFromRoots(regs, roots);
    }

    fn recordDebugPause(self: *VmInstance, hook: *DebugHook, fn_idx: u32, pc: u32, span: bc.SourceSpan, regs: []const TypedVal) void {
        if (hook.events.items.len >= hook.max_events) return;
        var ev = DebugPauseEvent{
            .fn_idx = fn_idx,
            .pc = pc,
            .source_start = span.start,
            .source_end = span.end,
            .call_depth = self.depth,
            .call_stack_len = @intCast(@min(self.call_stack_len, 16)),
            .call_stack = [_]u32{0} ** 16,
            .local_count = 0,
            .locals = undefined,
        };
        for (0..ev.call_stack_len) |ci| {
            ev.call_stack[ci] = self.call_stack[ci];
        }
        var lcnt: u8 = 0;
        for (regs, 0..) |r, ri| {
            if (lcnt >= 16) break;
            if (r.tag != .@"undefined") {
                ev.locals[lcnt] = .{
                    .reg = @intCast(ri),
                    .tag = r.tag,
                    .i32_val = r.asI32(),
                    .payload = r.payload,
                };
                lcnt += 1;
            }
        }
        ev.local_count = lcnt;
        hook.events.append(self.rt.allocator, ev) catch {};
    }

    fn execFunction(self: *VmInstance, fn_idx: u32, args: []const TypedVal) TypedVal {
        const func = &self.mod.functions[fn_idx];
        const entry_span = func.cold_spans[0];
        if (self.depth >= self.limits.call_depth) {
            self.setTrap("r01-t-depth", "r01-depth", entry_span);
            return TypedVal.undef();
        }
        if (self.call_stack_len < self.call_stack.len) {
            self.call_stack[self.call_stack_len] = fn_idx;
            self.call_stack_len += 1;
        }
        defer if (self.call_stack_len > 0) {
            self.call_stack_len -= 1;
        };
        self.depth += 1;
        defer self.depth -= 1;

        const regs = self.rt.allocator.alloc(TypedVal, func.reg_count) catch {
            self.setAbort("r05-execution-abort-oom", entry_span);
            return TypedVal.undef();
        };
        defer self.rt.allocator.free(regs);
        @memset(regs, TypedVal.undef());

        const root_slots = self.rt.allocator.alloc(gc_mod.RootSlot, func.reg_count) catch {
            self.setAbort("r05-execution-abort-oom", entry_span);
            return TypedVal.undef();
        };
        defer self.rt.allocator.free(root_slots);
        @memset(root_slots, .{});

        for (0..@min(args.len, func.param_count)) |i| regs[i] = args[i];
        syncRootsFromRegs(regs, root_slots);

        var root_frame = gc_mod.RootFrame{ .slots = root_slots };
        self.rt.gc.pushRootFrame(&root_frame);
        defer self.rt.gc.popRootFrame(&root_frame);

        const ops = if (self.limits.use_superinstructions) func.fused_ops else func.unfused_ops;
        var pc: usize = 0;

        while (pc < ops.len) {
            if (self.failed) return TypedVal.undef();
            const ins = ops[pc];
            const span = func.cold_spans[ins.aux];
            if (self.limits.debug_hook) |dbg| {
                if (dbg.matches(fn_idx, @intCast(pc), span)) {
                    self.recordDebugPause(dbg, fn_idx, @intCast(pc), span, regs);
                }
            }
            const phys_cost: u64 = if (ins.flags == 1) 2 else 1;
            if (self.phys_ops + phys_cost > self.limits.physical_instructions) {
                self.setAbort("r05-execution-abort-budget", span);
                return TypedVal.undef();
            }
            self.phys_ops += phys_cost;

            const op_e: Op = @enumFromInt(ins.op);
            switch (op_e) {
                .nop => {
                    pc += 1;
                },
                .fuel => {
                    if (self.fuel == 0) {
                        self.setTrap("r01-t-fuel", "r01-fuel", span);
                        return TypedVal.undef();
                    }
                    self.fuel -= 1;
                    self.fuel_consumed += 1;
                    pc += 1;
                },
                .const_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(ins.imm32);
                    pc += 1;
                },
                .const_bool => {
                    regs[ins.dst] = TypedVal.fromBool(ins.imm32 != 0);
                    pc += 1;
                },
                .const_undef => {
                    regs[ins.dst] = TypedVal.undef();
                    pc += 1;
                },
                .const_null => {
                    regs[ins.dst] = TypedVal.nullVal();
                    pc += 1;
                },
                .const_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(self.mod.const_pool_f64[@intCast(ins.imm32)]);
                    pc += 1;
                },
                .mov => {
                    regs[ins.dst] = regs[ins.a];
                    pc += 1;
                },
                .add_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() +% regs[ins.b].asI32());
                    pc += 1;
                },
                .sub_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() -% regs[ins.b].asI32());
                    pc += 1;
                },
                .mul_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() *% regs[ins.b].asI32());
                    pc += 1;
                },
                .div_i32 => {
                    const a = regs[ins.a].asI32();
                    const b = regs[ins.b].asI32();
                    if (b == 0 or (a == std.math.minInt(i32) and b == -1)) {
                        self.setTrap("r01-t-div-zero", "r01-i32-div", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = TypedVal.fromI32(@divTrunc(a, b));
                    pc += 1;
                },
                .rem_i32 => {
                    const a = regs[ins.a].asI32();
                    const b = regs[ins.b].asI32();
                    if (b == 0) {
                        self.setTrap("r01-t-div-zero", "r01-i32-rem", span);
                        return TypedVal.undef();
                    }
                    const res: i32 = if (a == std.math.minInt(i32) and b == -1) 0 else @rem(a, b);
                    regs[ins.dst] = TypedVal.fromI32(res);
                    pc += 1;
                },
                .neg_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(0 -% regs[ins.a].asI32());
                    pc += 1;
                },
                .bit_and => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() & regs[ins.b].asI32());
                    pc += 1;
                },
                .bit_or => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() | regs[ins.b].asI32());
                    pc += 1;
                },
                .bit_xor => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() ^ regs[ins.b].asI32());
                    pc += 1;
                },
                .shl_i32 => {
                    const s: u5 = @truncate(@as(u32, @bitCast(regs[ins.b].asI32())));
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() << s);
                    pc += 1;
                },
                .shr_i32 => {
                    const s: u5 = @truncate(@as(u32, @bitCast(regs[ins.b].asI32())));
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() >> s);
                    pc += 1;
                },
                .ushr_i32 => {
                    const s: u5 = @truncate(@as(u32, @bitCast(regs[ins.b].asI32())));
                    const u: u32 = @bitCast(regs[ins.a].asI32());
                    regs[ins.dst] = TypedVal.fromI32(@bitCast(u >> s));
                    pc += 1;
                },
                .lt_i32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI32() < regs[ins.b].asI32());
                    pc += 1;
                },
                .le_i32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI32() <= regs[ins.b].asI32());
                    pc += 1;
                },
                .gt_i32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI32() > regs[ins.b].asI32());
                    pc += 1;
                },
                .ge_i32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI32() >= regs[ins.b].asI32());
                    pc += 1;
                },
                .add_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(canonF64(regs[ins.a].asF64() + regs[ins.b].asF64()));
                    pc += 1;
                },
                .sub_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(canonF64(regs[ins.a].asF64() - regs[ins.b].asF64()));
                    pc += 1;
                },
                .mul_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(canonF64(regs[ins.a].asF64() * regs[ins.b].asF64()));
                    pc += 1;
                },
                .div_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(canonF64(regs[ins.a].asF64() / regs[ins.b].asF64()));
                    pc += 1;
                },
                .lt_f64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asF64() < regs[ins.b].asF64());
                    pc += 1;
                },
                .strict_eq => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    const eq = if (l.tag != r.tag) false else switch (l.tag) {
                        .@"undefined", .@"null" => true,
                        .f32 => l.asF32() == r.asF32(),
                        .f64 => l.asF64() == r.asF64(),
                        .ref => if (l.obj_ptr != null and r.obj_ptr != null) l.obj_ptr.?.id == r.obj_ptr.?.id else l.payload == r.payload,
                        .string => blk: {
                            const sl = self.getString(l) orelse break :blk false;
                            const sr = self.getString(r) orelse break :blk false;
                            break :blk std.mem.eql(u16, sl, sr);
                        },
                        else => l.payload == r.payload,
                    };
                    regs[ins.dst] = TypedVal.fromBool(if (ins.imm32 != 0) !eq else eq);
                    pc += 1;
                },
                .bool_not => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].payload == 0);
                    pc += 1;
                },
                .narrow_i32 => {
                    const v = regs[ins.a];
                    if (v.tag == .@"undefined") {
                        self.setTrap("r01-t-undefined-numeric", "r01-unions", span);
                        return TypedVal.undef();
                    }
                    if (v.tag != .i32) {
                        self.setTrap("r01-t-narrow", "r01-unions", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = v;
                    pc += 1;
                },
                .br => {
                    pc = @intCast(ins.imm32);
                },
                .cond_br => {
                    if (regs[ins.a].payload != 0) {
                        pc = @intCast(ins.imm32);
                    } else {
                        pc += 1;
                    }
                },
                .ret => {
                    return if (ins.a == 0xFFFF) TypedVal.undef() else regs[ins.a];
                },
                .super_add_i32_imm => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() +% ins.imm32);
                    pc += 2;
                },
                .super_br_if_lt_i32 => {
                    const cond = regs[ins.a].asI32() < regs[ins.b].asI32();
                    regs[ins.dst] = TypedVal.fromBool(cond);
                    if (cond) {
                        pc = @intCast(ins.imm32);
                    } else {
                        pc += 2;
                    }
                },
                .super_inc_local_i32 => {
                    regs[ins.dst] = TypedVal.fromI32(regs[ins.a].asI32() +% ins.imm32);
                    pc += 2;
                },
                .global_get => {
                    const slot: usize = @intCast(ins.imm32);
                    if (!self.global_init[slot]) {
                        self.setTrap("r01-e-reference", "r01-modules", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = self.globals[slot];
                    pc += 1;
                },
                .global_set => {
                    const slot: usize = @intCast(ins.imm32);
                    self.globals[slot] = regs[ins.a];
                    self.global_init[slot] = true;
                    pc += 1;
                },
                .new_obj => {
                    syncRootsFromRegs(regs, root_slots);
                    const field_count: usize = @max(@as(usize, ins.a) + @as(usize, ins.b), 1);
                    const obj = self.rt.gc.alloc(@intCast(ins.imm32), .class_instance, 1 + 2 * field_count, field_count) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    syncRegsFromRoots(regs, root_slots);
                    regs[ins.dst] = TypedVal.fromObj(obj);
                    self.maybeGcSafepoint(regs, root_slots, false, span);
                    pc += 1;
                },
                .new_obj_dyn => {
                    const tid: u64 = @intCast(@as(u32, @bitCast(regs[@intCast(ins.imm32)].asI32())));
                    syncRootsFromRegs(regs, root_slots);
                    const field_count: usize = @max(@as(usize, ins.a), 1);
                    const obj = self.rt.gc.alloc(tid, .class_instance, 1 + 2 * field_count, field_count) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    syncRegsFromRoots(regs, root_slots);
                    regs[ins.dst] = TypedVal.fromObj(obj);
                    self.maybeGcSafepoint(regs, root_slots, false, span);
                    pc += 1;
                },
                .clone_obj => {
                    const src = regs[ins.a].obj_ptr orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-values", span);
                        return TypedVal.undef();
                    };
                    syncRootsFromRegs(regs, root_slots);
                    const dst_obj = self.rt.gc.alloc(src.type_id, src.kind, src.scalars.len, src.edges.len) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    syncRegsFromRoots(regs, root_slots);
                    const fresh_src = regs[ins.a].obj_ptr.?;
                    @memcpy(dst_obj.scalars, fresh_src.scalars);
                    for (fresh_src.edges, 0..) |e, ei| {
                        self.rt.gc.writeEdge(dst_obj, ei, e) catch {
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                    }
                    regs[ins.dst] = TypedVal.fromObj(dst_obj);
                    pc += 1;
                },
                .field_get => {
                    const obj = regs[ins.a].obj_ptr orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-references", span);
                        return TypedVal.undef();
                    };
                    const cslot: usize = @intCast(@as(u32, @bitCast(ins.imm32)) % 64);
                    _ = self.field_caches[cslot].lookup(self.mod.code_version, obj.type_id, ins.b);
                    const fidx: usize = ins.b;
                    if (fidx >= obj.edges.len or 1 + 2 * fidx + 1 >= obj.scalars.len) {
                        self.setTrap("r01-t-bounds", "r01-references", span);
                        return TypedVal.undef();
                    }
                    const raw_tag: u8 = @truncate(obj.scalars[1 + 2 * fidx]);
                    const tag: ValTag = @enumFromInt(raw_tag);
                    const payload = obj.scalars[1 + 2 * fidx + 1];
                    if (tag == .ref) {
                        regs[ins.dst] = if (obj.edges[fidx]) |child| TypedVal.fromObj(child) else TypedVal.nullVal();
                    } else {
                        regs[ins.dst] = .{ .tag = tag, .payload = payload };
                    }
                    pc += 1;
                },
                .field_set => {
                    const obj = regs[ins.a].obj_ptr orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-references", span);
                        return TypedVal.undef();
                    };
                    const cslot: usize = @intCast(@as(u32, @bitCast(ins.imm32)) % 64);
                    _ = self.field_caches[cslot].lookup(self.mod.code_version, obj.type_id, ins.b);
                    const fidx: usize = ins.b;
                    if (fidx >= obj.edges.len or 1 + 2 * fidx + 1 >= obj.scalars.len) {
                        self.setTrap("r01-t-bounds", "r01-references", span);
                        return TypedVal.undef();
                    }
                    const val = regs[ins.dst];
                    obj.scalars[1 + 2 * fidx] = @intFromEnum(val.tag);
                    obj.scalars[1 + 2 * fidx + 1] = val.payload;
                    self.rt.gc.writeEdge(obj, fidx, if (val.tag == .ref) val.obj_ptr else null) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    pc += 1;
                },
                .make_closure => {
                    const env_ptr = if (ins.a == 0xFFFF) null else regs[ins.a].obj_ptr;
                    self.closures.append(self.rt.allocator, .{
                        .fn_idx = @intCast(ins.imm32),
                        .env_obj = env_ptr,
                    }) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = .{ .tag = .closure, .payload = self.closures.items.len };
                    pc += 1;
                },
                .call_direct, .call_method => {
                    const callee_idx: u32 = @intCast(ins.imm32);
                    const slice = regs[ins.a .. ins.a + ins.b];
                    syncRootsFromRegs(regs, root_slots);
                    const rv = self.execFunction(callee_idx, slice);
                    syncRegsFromRoots(regs, root_slots);
                    if (self.failed) return TypedVal.undef();
                    if (self.exc_active) {
                        if (self.findExceptionHandler(func, pc)) |hpc| {
                            pc = hpc;
                            continue;
                        }
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = rv;
                    pc += 1;
                },
                .call_indirect => {
                    const cl_val = regs[ins.a];
                    if (cl_val.tag != .closure or cl_val.payload == 0 or cl_val.payload > self.closures.items.len) {
                        self.setTrap("r01-t-invalid-handle", "r01-closures", span);
                        return TypedVal.undef();
                    }
                    const rec = self.closures.items[@intCast(cl_val.payload - 1)];
                    const expects_env = self.mod.functions[rec.fn_idx].param_count == ins.b + 1;
                    const total_args: usize = @as(usize, ins.b) + (if (expects_env) @as(usize, 1) else 0);
                    var stack_args: [64]TypedVal = undefined;
                    var heap_args: ?[]TypedVal = null;
                    defer if (heap_args) |ha| self.rt.allocator.free(ha);
                    const call_args: []TypedVal = if (total_args <= stack_args.len)
                        stack_args[0..total_args]
                    else blk: {
                        const ha = self.rt.allocator.alloc(TypedVal, total_args) catch {
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                        heap_args = ha;
                        break :blk ha;
                    };
                    var n: usize = 0;
                    if (expects_env) {
                        if (rec.env_obj) |env| {
                            call_args[n] = TypedVal.fromObj(env);
                        } else {
                            call_args[n] = TypedVal.nullVal();
                        }
                        n += 1;
                    }
                    for (0..ins.b) |k| {
                        call_args[n] = regs[ins.a + 1 + k];
                        n += 1;
                    }
                    syncRootsFromRegs(regs, root_slots);
                    const rv = self.execFunction(rec.fn_idx, call_args[0..n]);
                    syncRegsFromRoots(regs, root_slots);
                    if (self.failed) return TypedVal.undef();
                    if (self.exc_active) {
                        if (self.findExceptionHandler(func, pc)) |hpc| {
                            pc = hpc;
                            continue;
                        }
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = rv;
                    pc += 1;
                },
                .array_new => {
                    var arr = ArrayRec{};
                    for (0..ins.b) |k| {
                        arr.items.append(self.rt.allocator, regs[ins.a + k]) catch {
                            arr.items.deinit(self.rt.allocator);
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                    }
                    self.arrays.append(self.rt.allocator, arr) catch {
                        arr.items.deinit(self.rt.allocator);
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = .{ .tag = .array, .payload = self.arrays.items.len };
                    pc += 1;
                },
                .array_len => {
                    const recv = regs[ins.a];
                    if (recv.tag == .array and recv.payload > 0 and recv.payload <= self.arrays.items.len) {
                        const arr = &self.arrays.items[@intCast(recv.payload - 1)];
                        regs[ins.dst] = TypedVal.fromI32(@intCast(arr.items.items.len));
                    } else if (recv.tag == .span and recv.payload > 0 and recv.payload <= self.spans.items.len) {
                        const sp = &self.spans.items[@intCast(recv.payload - 1)];
                        if (!sp.live) {
                            self.setTrap("r01-t-span-expired", "r01-span", span);
                            return TypedVal.undef();
                        }
                        regs[ins.dst] = TypedVal.fromI32(@intCast(sp.len));
                    } else {
                        self.setTrap("r01-t-invalid-handle", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    pc += 1;
                },
                .array_get => {
                    const recv = regs[ins.a];
                    const idx_i = regs[ins.b].asI32();
                    if (idx_i < 0) {
                        self.setTrap("r01-t-bounds", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    const idx: usize = @intCast(idx_i);
                    if (recv.tag == .array and recv.payload > 0 and recv.payload <= self.arrays.items.len) {
                        const arr = &self.arrays.items[@intCast(recv.payload - 1)];
                        if (idx >= arr.items.items.len) {
                            self.setTrap("r01-t-bounds", "r01-vector", span);
                            return TypedVal.undef();
                        }
                        regs[ins.dst] = arr.items.items[idx];
                    } else if (recv.tag == .span and recv.payload > 0 and recv.payload <= self.spans.items.len) {
                        const sp = &self.spans.items[@intCast(recv.payload - 1)];
                        if (!sp.live) {
                            self.setTrap("r01-t-span-expired", "r01-span", span);
                            return TypedVal.undef();
                        }
                        if (idx >= sp.len) {
                            self.setTrap("r01-t-bounds", "r01-span", span);
                            return TypedVal.undef();
                        }
                        const arr = &self.arrays.items[sp.array_idx];
                        regs[ins.dst] = arr.items.items[sp.start + idx];
                    } else {
                        self.setTrap("r01-t-invalid-handle", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    pc += 1;
                },
                .array_set => {
                    const recv = regs[ins.a];
                    if (recv.tag == .span) {
                        self.setTrap("r01-t-span-readonly", "r01-span", span);
                        return TypedVal.undef();
                    }
                    if (recv.tag != .array or recv.payload == 0 or recv.payload > self.arrays.items.len) {
                        self.setTrap("r01-t-invalid-handle", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    const arr = &self.arrays.items[@intCast(recv.payload - 1)];
                    const idx_i = regs[ins.b].asI32();
                    if (idx_i < 0 or @as(usize, @intCast(idx_i)) >= arr.items.items.len) {
                        self.setTrap("r01-t-bounds", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    arr.items.items[@intCast(idx_i)] = regs[ins.dst];
                    pc += 1;
                },
                .span_new => {
                    const arr_v = regs[ins.a];
                    if (arr_v.tag != .array or arr_v.payload == 0 or arr_v.payload > self.arrays.items.len) {
                        self.setTrap("r01-t-invalid-handle", "r01-span", span);
                        return TypedVal.undef();
                    }
                    const arr_idx: u32 = @intCast(arr_v.payload - 1);
                    const arr = &self.arrays.items[arr_idx];
                    const st_i = regs[ins.b].asI32();
                    const ln_i = regs[@intCast(ins.imm32)].asI32();
                    if (st_i < 0 or ln_i < 0 or @as(u64, @intCast(st_i)) + @as(u64, @intCast(ln_i)) > arr.items.items.len) {
                        self.setTrap("r01-t-bounds", "r01-span", span);
                        return TypedVal.undef();
                    }
                    arr.active_readers += 1;
                    self.spans.append(self.rt.allocator, .{
                        .array_idx = arr_idx,
                        .start = @intCast(st_i),
                        .len = @intCast(ln_i),
                        .live = true,
                    }) catch {
                        arr.active_readers -= 1;
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = .{ .tag = .span, .payload = self.spans.items.len };
                    pc += 1;
                },
                .span_release => {
                    const sp_v = regs[ins.a];
                    if (sp_v.tag == .span and sp_v.payload > 0 and sp_v.payload <= self.spans.items.len) {
                        const sp = &self.spans.items[@intCast(sp_v.payload - 1)];
                        if (sp.live) {
                            sp.live = false;
                            if (self.arrays.items[sp.array_idx].active_readers > 0) {
                                self.arrays.items[sp.array_idx].active_readers -= 1;
                            }
                        }
                    }
                    pc += 1;
                },
                .throw_exc => {
                    self.exc_active = true;
                    self.exc_val = regs[ins.a];
                    if (self.findExceptionHandler(func, pc)) |hpc| {
                        pc = hpc;
                    } else {
                        return TypedVal.undef();
                    }
                },
                .catch_take => {
                    regs[ins.dst] = self.exc_val;
                    self.exc_active = false;
                    self.exc_val = TypedVal.undef();
                    pc += 1;
                },
                .host_call => {
                    const cap_id: u32 = @bitCast(ins.imm32);
                    if (self.fuel == 0) {
                        self.setTrap("r01-t-fuel", "r01-fuel", span);
                        return TypedVal.undef();
                    }
                    self.fuel -= 1;
                    self.fuel_consumed += 1;
                    syncRootsFromRegs(regs, root_slots);
                    const res = self.caps.invoke(cap_id, regs[ins.a].asI32(), regs[ins.b].asI32()) catch {
                        self.setTrap("r05-capability-denied", "r05-capabilities", span);
                        return TypedVal.undef();
                    };
                    syncRegsFromRoots(regs, root_slots);
                    regs[ins.dst] = TypedVal.fromI32(@truncate(res));
                    pc += 1;
                },
                .gc_safepoint => {
                    self.maybeGcSafepoint(regs, root_slots, true, span);
                    pc += 1;
                },
                .bit_not => {
                    regs[ins.dst] = TypedVal.fromI32(~regs[ins.a].asI32());
                    pc += 1;
                },
                .neg_f64 => {
                    regs[ins.dst] = TypedVal.fromF64Bits(canonF64(-regs[ins.a].asF64()));
                    pc += 1;
                },
                .le_f64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asF64() <= regs[ins.b].asF64());
                    pc += 1;
                },
                .gt_f64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asF64() > regs[ins.b].asF64());
                    pc += 1;
                },
                .ge_f64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asF64() >= regs[ins.b].asF64());
                    pc += 1;
                },
                .assert_non_null => {
                    const v = regs[ins.a];
                    if (v.tag == .@"undefined" or v.tag == .@"null") {
                        self.setTrap("r01-t-narrow", "r01-unions", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = v;
                    pc += 1;
                },
                .array_resize => {
                    const recv = regs[ins.a];
                    if (recv.tag != .array or recv.payload == 0 or recv.payload > self.arrays.items.len) {
                        self.setTrap("r01-t-invalid-handle", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    const arr = &self.arrays.items[@intCast(recv.payload - 1)];
                    if (arr.active_readers > 0) {
                        self.setTrap("r01-t-borrow-conflict", "r01-span", span);
                        return TypedVal.undef();
                    }
                    const new_len_i = regs[ins.b].asI32();
                    if (new_len_i < 0) {
                        self.setTrap("r01-t-bounds", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    const new_len: usize = @intCast(new_len_i);
                    if (new_len > arr.items.items.len and ins.dst == 0xFFFF) {
                        self.setTrap("r01-t-bounds", "r01-vector", span);
                        return TypedVal.undef();
                    }
                    const fill = if (ins.dst == 0xFFFF) TypedVal.undef() else regs[ins.dst];
                    while (arr.items.items.len < new_len) {
                        arr.items.append(self.rt.allocator, fill) catch {
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                    }
                    if (arr.items.items.len > new_len) arr.items.shrinkRetainingCapacity(new_len);
                    pc += 1;
                },
                .get_type_id => {
                    const obj = regs[ins.a].obj_ptr orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-references", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = TypedVal.fromI32(@intCast(@as(u32, @truncate(obj.type_id))));
                    pc += 1;
                },
                .mark_uninit => {
                    if (regs[ins.a].obj_ptr) |obj| {
                        obj.scalars[0] |= 1;
                    }
                    pc += 1;
                },
                .mark_init => {
                    if (regs[ins.a].obj_ptr) |obj| {
                        obj.scalars[0] &= ~@as(u64, 1);
                    }
                    pc += 1;
                },
                .check_init => {
                    const obj = regs[ins.a].obj_ptr orelse {
                        self.setTrap("r01-t-tdz", "r01-references", span);
                        return TypedVal.undef();
                    };
                    if ((obj.scalars[0] & 1) != 0) {
                        self.setTrap("r01-t-tdz", "r01-references", span);
                        return TypedVal.undef();
                    }
                    pc += 1;
                },
                .unreachable_trap => {
                    self.setTrap("r01-t-invalid-handle", "r01-control", span);
                    return TypedVal.undef();
                },
                .const_str => {
                    const units = self.mod.const_pool_str[@intCast(ins.imm32)];
                    regs[ins.dst] = self.allocString(units) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    pc += 1;
                },
                .str_len => {
                    const s = self.getString(regs[ins.a]) orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-strings", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = TypedVal.fromI32(@intCast(s.len));
                    pc += 1;
                },
                .str_concat => {
                    const sl = self.getString(regs[ins.a]) orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-strings", span);
                        return TypedVal.undef();
                    };
                    const sr = self.getString(regs[ins.b]) orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-strings", span);
                        return TypedVal.undef();
                    };
                    const merged = self.rt.allocator.alloc(u16, sl.len + sr.len) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    @memcpy(merged[0..sl.len], sl);
                    @memcpy(merged[sl.len..], sr);
                    self.strings.append(self.rt.allocator, merged) catch {
                        self.rt.allocator.free(merged);
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    regs[ins.dst] = TypedVal.fromString(self.strings.items.len);
                    pc += 1;
                },
                .str_slice => {
                    const s = self.getString(regs[ins.a]) orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-strings", span);
                        return TypedVal.undef();
                    };
                    const len_i: i32 = @intCast(s.len);
                    var st = regs[ins.b].asI32();
                    var en = regs[@intCast(ins.imm32)].asI32();
                    if (st < 0) st = @max(len_i + st, 0);
                    if (st > len_i) st = len_i;
                    if (en < 0) en = @max(len_i + en, 0);
                    if (en > len_i) en = len_i;
                    if (en < st) en = st;
                    regs[ins.dst] = self.allocString(s[@intCast(st)..@intCast(en)]) catch {
                        self.setAbort("r05-execution-abort-oom", span);
                        return TypedVal.undef();
                    };
                    pc += 1;
                },
                .str_char_code_at => {
                    const s = self.getString(regs[ins.a]) orelse {
                        self.setTrap("r01-t-invalid-handle", "r01-strings", span);
                        return TypedVal.undef();
                    };
                    const idx_i = regs[ins.b].asI32();
                    if (idx_i < 0 or @as(usize, @intCast(idx_i)) >= s.len) {
                        self.setTrap("r01-t-bounds", "r01-strings", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = TypedVal.fromI32(@intCast(s[@intCast(idx_i)]));
                    pc += 1;
                },
                .add_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    if (l.tag == .string and r.tag == .string) {
                        const sl = self.getString(l).?;
                        const sr = self.getString(r).?;
                        const merged = self.rt.allocator.alloc(u16, sl.len + sr.len) catch {
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                        @memcpy(merged[0..sl.len], sl);
                        @memcpy(merged[sl.len..], sr);
                        self.strings.append(self.rt.allocator, merged) catch {
                            self.rt.allocator.free(merged);
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                        regs[ins.dst] = TypedVal.fromString(self.strings.items.len);
                    } else if (l.tag == .f64 or r.tag == .f64) {
                        regs[ins.dst] = TypedVal.fromF64Bits(canonF64(asNumF64(l) + asNumF64(r)));
                    } else if (l.tag == .f32 or r.tag == .f32) {
                        const fa: f32 = if (l.tag == .f32) l.asF32() else @floatFromInt(l.asI32());
                        const fb: f32 = if (r.tag == .f32) r.asF32() else @floatFromInt(r.asI32());
                        regs[ins.dst] = TypedVal.fromF32Bits(canonF32(fa + fb));
                    } else {
                        regs[ins.dst] = TypedVal.fromI32(l.asI32() +% r.asI32());
                    }
                    pc += 1;
                },
                .sub_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    if (l.tag == .f64 or r.tag == .f64) {
                        regs[ins.dst] = TypedVal.fromF64Bits(canonF64(asNumF64(l) - asNumF64(r)));
                    } else if (l.tag == .f32 or r.tag == .f32) {
                        const fa: f32 = if (l.tag == .f32) l.asF32() else @floatFromInt(l.asI32());
                        const fb: f32 = if (r.tag == .f32) r.asF32() else @floatFromInt(r.asI32());
                        regs[ins.dst] = TypedVal.fromF32Bits(canonF32(fa - fb));
                    } else {
                        regs[ins.dst] = TypedVal.fromI32(l.asI32() -% r.asI32());
                    }
                    pc += 1;
                },
                .mul_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    if (l.tag == .f64 or r.tag == .f64) {
                        regs[ins.dst] = TypedVal.fromF64Bits(canonF64(asNumF64(l) * asNumF64(r)));
                    } else if (l.tag == .f32 or r.tag == .f32) {
                        const fa: f32 = if (l.tag == .f32) l.asF32() else @floatFromInt(l.asI32());
                        const fb: f32 = if (r.tag == .f32) r.asF32() else @floatFromInt(r.asI32());
                        regs[ins.dst] = TypedVal.fromF32Bits(canonF32(fa * fb));
                    } else {
                        regs[ins.dst] = TypedVal.fromI32(l.asI32() *% r.asI32());
                    }
                    pc += 1;
                },
                .div_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    if (l.tag == .f64 or r.tag == .f64) {
                        regs[ins.dst] = TypedVal.fromF64Bits(canonF64(asNumF64(l) / asNumF64(r)));
                    } else if (l.tag == .f32 or r.tag == .f32) {
                        const fa: f32 = if (l.tag == .f32) l.asF32() else @floatFromInt(l.asI32());
                        const fb: f32 = if (r.tag == .f32) r.asF32() else @floatFromInt(r.asI32());
                        regs[ins.dst] = TypedVal.fromF32Bits(canonF32(fa / fb));
                    } else {
                        const a = l.asI32();
                        const b = r.asI32();
                        if (b == 0 or (a == std.math.minInt(i32) and b == -1)) {
                            self.setTrap("r01-t-div-zero", "r01-i32-div", span);
                            return TypedVal.undef();
                        }
                        regs[ins.dst] = TypedVal.fromI32(@divTrunc(a, b));
                    }
                    pc += 1;
                },
                .lt_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    const res = if (l.tag == .f64 or r.tag == .f64) asNumF64(l) < asNumF64(r) else if (l.tag == .f32 or r.tag == .f32) (if (l.tag == .f32) l.asF32() else @as(f32, @floatFromInt(l.asI32()))) < (if (r.tag == .f32) r.asF32() else @as(f32, @floatFromInt(r.asI32()))) else l.asI32() < r.asI32();
                    regs[ins.dst] = TypedVal.fromBool(res);
                    pc += 1;
                },
                .le_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    const res = if (l.tag == .f64 or r.tag == .f64) asNumF64(l) <= asNumF64(r) else if (l.tag == .f32 or r.tag == .f32) (if (l.tag == .f32) l.asF32() else @as(f32, @floatFromInt(l.asI32()))) <= (if (r.tag == .f32) r.asF32() else @as(f32, @floatFromInt(r.asI32()))) else l.asI32() <= r.asI32();
                    regs[ins.dst] = TypedVal.fromBool(res);
                    pc += 1;
                },
                .gt_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    const res = if (l.tag == .f64 or r.tag == .f64) asNumF64(l) > asNumF64(r) else if (l.tag == .f32 or r.tag == .f32) (if (l.tag == .f32) l.asF32() else @as(f32, @floatFromInt(l.asI32()))) > (if (r.tag == .f32) r.asF32() else @as(f32, @floatFromInt(r.asI32()))) else l.asI32() > r.asI32();
                    regs[ins.dst] = TypedVal.fromBool(res);
                    pc += 1;
                },
                .ge_dyn => {
                    const l = regs[ins.a];
                    const r = regs[ins.b];
                    const res = if (l.tag == .f64 or r.tag == .f64) asNumF64(l) >= asNumF64(r) else if (l.tag == .f32 or r.tag == .f32) (if (l.tag == .f32) l.asF32() else @as(f32, @floatFromInt(l.asI32()))) >= (if (r.tag == .f32) r.asF32() else @as(f32, @floatFromInt(r.asI32()))) else l.asI32() >= r.asI32();
                    regs[ins.dst] = TypedVal.fromBool(res);
                    pc += 1;
                },
                .neg_dyn => {
                    const v = regs[ins.a];
                    if (v.tag == .f64) {
                        regs[ins.dst] = TypedVal.fromF64Bits(canonF64(-v.asF64()));
                    } else if (v.tag == .f32) {
                        regs[ins.dst] = TypedVal.fromF32Bits(canonF32(-v.asF32()));
                    } else if (v.tag == .i64) {
                        regs[ins.dst] = TypedVal.fromI64(0 -% v.asI64());
                    } else {
                        regs[ins.dst] = TypedVal.fromI32(0 -% v.asI32());
                    }
                    pc += 1;
                },
                .const_i64 => {
                    regs[ins.dst] = TypedVal.fromI64(@bitCast(self.mod.const_pool_f64[@intCast(ins.imm32)]));
                    pc += 1;
                },
                .const_u32 => {
                    regs[ins.dst] = TypedVal.fromU32(@bitCast(ins.imm32));
                    pc += 1;
                },
                .const_u64 => {
                    regs[ins.dst] = TypedVal.fromU64(self.mod.const_pool_f64[@intCast(ins.imm32)]);
                    pc += 1;
                },
                .const_f32 => {
                    regs[ins.dst] = TypedVal.fromF32Bits(@bitCast(ins.imm32));
                    pc += 1;
                },
                .add_i64 => {
                    regs[ins.dst] = TypedVal.fromI64(regs[ins.a].asI64() +% regs[ins.b].asI64());
                    pc += 1;
                },
                .sub_i64 => {
                    regs[ins.dst] = TypedVal.fromI64(regs[ins.a].asI64() -% regs[ins.b].asI64());
                    pc += 1;
                },
                .mul_i64 => {
                    regs[ins.dst] = TypedVal.fromI64(regs[ins.a].asI64() *% regs[ins.b].asI64());
                    pc += 1;
                },
                .div_i64 => {
                    const a = regs[ins.a].asI64();
                    const b = regs[ins.b].asI64();
                    if (b == 0 or (a == std.math.minInt(i64) and b == -1)) {
                        self.setTrap("r01-t-div-zero", "r01-i64-div", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = TypedVal.fromI64(@divTrunc(a, b));
                    pc += 1;
                },
                .rem_i64 => {
                    const a = regs[ins.a].asI64();
                    const b = regs[ins.b].asI64();
                    if (b == 0) {
                        self.setTrap("r01-t-div-zero", "r01-i64-rem", span);
                        return TypedVal.undef();
                    }
                    const res: i64 = if (a == std.math.minInt(i64) and b == -1) 0 else @rem(a, b);
                    regs[ins.dst] = TypedVal.fromI64(res);
                    pc += 1;
                },
                .lt_i64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI64() < regs[ins.b].asI64());
                    pc += 1;
                },
                .le_i64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI64() <= regs[ins.b].asI64());
                    pc += 1;
                },
                .gt_i64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI64() > regs[ins.b].asI64());
                    pc += 1;
                },
                .ge_i64 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asI64() >= regs[ins.b].asI64());
                    pc += 1;
                },
                .div_u32 => {
                    const b = regs[ins.b].asU32();
                    if (b == 0) {
                        self.setTrap("r01-t-div-zero", "r01-u32-div", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = TypedVal.fromU32(regs[ins.a].asU32() / b);
                    pc += 1;
                },
                .rem_u32 => {
                    const b = regs[ins.b].asU32();
                    if (b == 0) {
                        self.setTrap("r01-t-div-zero", "r01-u32-rem", span);
                        return TypedVal.undef();
                    }
                    regs[ins.dst] = TypedVal.fromU32(regs[ins.a].asU32() % b);
                    pc += 1;
                },
                .lt_u32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asU32() < regs[ins.b].asU32());
                    pc += 1;
                },
                .le_u32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asU32() <= regs[ins.b].asU32());
                    pc += 1;
                },
                .gt_u32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asU32() > regs[ins.b].asU32());
                    pc += 1;
                },
                .ge_u32 => {
                    regs[ins.dst] = TypedVal.fromBool(regs[ins.a].asU32() >= regs[ins.b].asU32());
                    pc += 1;
                },
                .f32_round => {
                    const f: f32 = @floatCast(regs[ins.a].asF64());
                    regs[ins.dst] = TypedVal.fromF32Bits(canonF32(f));
                    pc += 1;
                },
                .int_wrap => {
                    const raw: u64 = regs[ins.a].payload;
                    regs[ins.dst] = switch (ins.imm32) {
                        8 => TypedVal.fromI32(@as(i32, @as(i8, @bitCast(@as(u8, @truncate(raw)))))),
                        -8 => TypedVal.fromU32(@as(u32, @as(u8, @truncate(raw)))),
                        16 => TypedVal.fromI32(@as(i32, @as(i16, @bitCast(@as(u16, @truncate(raw)))))),
                        -16 => TypedVal.fromU32(@as(u32, @as(u16, @truncate(raw)))),
                        -32 => TypedVal.fromU32(@as(u32, @truncate(raw))),
                        else => TypedVal.fromI32(@bitCast(@as(u32, @truncate(raw)))),
                    };
                    pc += 1;
                },
            }
        }

        return TypedVal.undef();
    }

    fn findExceptionHandler(self: *VmInstance, func: *const bc.VerifiedFunction, pc: usize) ?usize {
        _ = self;
        const pc32: u32 = @intCast(pc);
        for (func.handlers) |h| {
            if (pc32 >= h.try_start and pc32 < h.try_end) return h.handler_pc;
        }
        return null;
    }
};

/// Execute zero or more module initializers in topological order followed by `function_id`
/// on a GC-rooted `VmInstance`.
pub fn eval_bytecode_with_inits(
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    init_function_ids: []const [32]u8,
    function_id: [32]u8,
    arguments: []const TypedVal,
    capabilities: *rt_mod.CapabilityTable,
    limits: RequestLimits,
    out_str_utf8: ?*std.ArrayListUnmanaged(u8),
) ExecutionOutcome {
    const fn_idx = mod.findFunctionIndex(function_id) orelse {
        return .{ .status = .invalid_request, .code = "r05-request-function", .fuel_remaining = limits.semantic_fuel };
    };
    if (arguments.len != mod.functions[fn_idx].param_count) {
        return .{ .status = .invalid_request, .code = "r05-request-arity", .fuel_remaining = limits.semantic_fuel };
    }

    const inst = VmInstance.create(rt, mod, capabilities, limits) catch {
        return .{ .status = .execution_abort, .code = "r05-execution-abort-oom", .fuel_remaining = limits.semantic_fuel };
    };
    defer inst.destroy();

    for (init_function_ids) |init_id| {
        if (mod.findFunctionIndex(init_id)) |init_idx| {
            _ = inst.execFunction(init_idx, &.{});
            if (inst.failed) return inst.fail_outcome;
            if (inst.exc_active) {
                return .{
                    .status = .managed_exception,
                    .value = inst.exc_val,
                    .code = "r01-e-uncaught",
                    .fuel_remaining = inst.fuel,
                    .fuel_consumed = inst.fuel_consumed,
                    .instructions_executed = inst.phys_ops,
                };
            }
        }
    }

    const t0 = rt.trace.beginScope();
    defer rt.trace.endScope(t0, "vm", "eval_bytecode", @intCast(fn_idx));

    const rv = inst.execFunction(fn_idx, arguments);
    if (inst.failed) return inst.fail_outcome;
    if (inst.exc_active) {
        return .{
            .status = .managed_exception,
            .value = inst.exc_val,
            .code = "r01-e-uncaught",
            .fuel_remaining = inst.fuel,
            .fuel_consumed = inst.fuel_consumed,
            .instructions_executed = inst.phys_ops,
        };
    }
    if (rv.tag == .string) {
        if (out_str_utf8) |dst_buf| {
            if (inst.getString(rv)) |units| {
                const utf8 = std.unicode.utf16LeToUtf8Alloc(rt.allocator, units) catch null;
                if (utf8) |u8s| {
                    defer rt.allocator.free(u8s);
                    dst_buf.appendSlice(rt.allocator, u8s) catch {};
                }
            }
        }
    }
    return .{
        .status = .ok,
        .value = rv,
        .fuel_remaining = inst.fuel,
        .fuel_consumed = inst.fuel_consumed,
        .instructions_executed = inst.phys_ops,
    };
}

pub fn eval_bytecode_with_init(
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    init_function_id: ?[32]u8,
    function_id: [32]u8,
    arguments: []const TypedVal,
    capabilities: *rt_mod.CapabilityTable,
    limits: RequestLimits,
    out_str_utf8: ?*std.ArrayListUnmanaged(u8),
) ExecutionOutcome {
    if (init_function_id) |id| {
        const ids = [_][32]u8{id};
        return eval_bytecode_with_inits(rt, mod, &ids, function_id, arguments, capabilities, limits, out_str_utf8);
    }
    return eval_bytecode_with_inits(rt, mod, &.{}, function_id, arguments, capabilities, limits, out_str_utf8);
}

pub fn eval_bytecode(
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    function_id: [32]u8,
    arguments: []const TypedVal,
    capabilities: *rt_mod.CapabilityTable,
    limits: RequestLimits,
) ExecutionOutcome {
    return eval_bytecode_with_inits(rt, mod, &.{}, function_id, arguments, capabilities, limits, null);
}

// ============================================================================
// Bidirectional Cross-Tier Bridge (Native <-> VM with ABI Exception Isolation)
// ============================================================================
pub const TierBridgeContext = struct {
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    caps: *rt_mod.CapabilityTable,
    limits: RequestLimits,
};

pub const NativeCallBridge = struct {
    ctx: *anyopaque,
    invoke_fn: *const fn (ctx: *anyopaque, args: []const TypedVal) rt_mod.BoundaryResult,
};

/// VM -> Native bridge: invokes a registered native callback with typed arguments and
/// returns a structured `BoundaryResult` (never allowing native errors to corrupt VM state).
pub fn callNativeFromVm(bridge: *const NativeCallBridge, args: []const TypedVal) rt_mod.BoundaryResult {
    return bridge.invoke_fn(bridge.ctx, args);
}

/// Generalized Native -> VM bridge supporting arbitrary argument counts & scalar/ref types.
pub fn invokeVmFromNativeArgs(
    ctx: *const TierBridgeContext,
    function_id: [32]u8,
    args: []const TypedVal,
) rt_mod.BoundaryResult {
    const fn_idx = ctx.mod.findFunctionIndex(function_id) orelse {
        return .{ .status = .trap, .code = "r05-request-function" };
    };
    const expected = ctx.mod.functions[fn_idx].param_count;
    if (args.len < expected) {
        return .{ .status = .trap, .code = "r05-request-arity" };
    }
    const out = eval_bytecode(ctx.rt, ctx.mod, function_id, args[0..expected], ctx.caps, ctx.limits);
    return switch (out.status) {
        .ok => .{
            .status = .ok,
            .value_tag = @intFromEnum(out.value.tag),
            .value_payload = out.value.payload,
            .fuel_remaining = out.fuel_remaining,
        },
        .managed_exception => .{
            .status = .managed_exception,
            .value_tag = @intFromEnum(out.value.tag),
            .value_payload = out.value.payload,
            .code = out.code,
            .fuel_remaining = out.fuel_remaining,
        },
        .trap => .{
            .status = .trap,
            .code = out.code,
            .source_start = out.source_start,
            .source_end = out.source_end,
            .fuel_remaining = out.fuel_remaining,
        },
        .execution_abort, .invalid_request => .{
            .status = .execution_abort,
            .code = out.code,
            .source_start = out.source_start,
            .source_end = out.source_end,
            .fuel_remaining = out.fuel_remaining,
        },
    };
}

/// Native-callable C-ABI trampoline invoking a verified VM function by `FunctionId`.
pub fn invokeVmFromNative(
    ctx: *const TierBridgeContext,
    function_id: [32]u8,
    arg0: i32,
    arg1: i32,
) rt_mod.BoundaryResult {
    const args = [_]TypedVal{ TypedVal.fromI32(arg0), TypedVal.fromI32(arg1) };
    const fn_idx = ctx.mod.findFunctionIndex(function_id) orelse {
        return .{ .status = .trap, .code = "r05-request-function" };
    };
    const count = @min(ctx.mod.functions[fn_idx].param_count, 2);
    return invokeVmFromNativeArgs(ctx, function_id, args[0..count]);
}
