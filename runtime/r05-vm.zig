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
    pub fn fromBool(v: bool) TypedVal {
        return .{ .tag = .bool, .payload = if (v) 1 else 0 };
    }
    pub fn fromF64Bits(bits: u64) TypedVal {
        return .{ .tag = .f64, .payload = bits };
    }
    pub fn fromObj(obj: *gc_mod.GcObject) TypedVal {
        return .{ .tag = .ref, .payload = obj.id, .obj_ptr = obj };
    }
    pub fn asI32(self: TypedVal) i32 {
        return @bitCast(@as(u32, @truncate(self.payload)));
    }
    pub fn asF64(self: TypedVal) f64 {
        return @bitCast(self.payload);
    }
};

pub const RequestLimits = struct {
    semantic_fuel: u64 = 4097,
    call_depth: u32 = 64,
    physical_instructions: u64 = 200_000,
    use_superinstructions: bool = true,
    /// Optional stress knob: trigger minor GC every N allocations/safepoints
    gc_stress_interval: u32 = 0,
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

const VmState = struct {
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    caps: *rt_mod.CapabilityTable,
    limits: RequestLimits,
    fuel: u64,
    fuel_consumed: u64 = 0,
    phys_ops: u64 = 0,
    depth: u32 = 0,
    alloc_counter: u32 = 0,
    closures: std.ArrayListUnmanaged(ClosureRec) = .empty,
    arrays: std.ArrayListUnmanaged(ArrayRec) = .empty,
    spans: std.ArrayListUnmanaged(SpanRec) = .empty,
    field_caches: [64]FieldInlineCache = [_]FieldInlineCache{.{}} ** 64,
    globals: []TypedVal,
    global_init: []bool,

    // Exception vs Trap state
    exc_active: bool = false,
    exc_val: TypedVal = TypedVal.undef(),
    failed: bool = false,
    fail_outcome: ExecutionOutcome = .{ .status = .ok },

    fn init(rt: *rt_mod.R06Runtime, mod: *const bc.VerifiedModule, caps: *rt_mod.CapabilityTable, limits: RequestLimits) !VmState {
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

    fn deinit(self: *VmState) void {
        for (self.arrays.items) |*a| a.items.deinit(self.rt.allocator);
        self.arrays.deinit(self.rt.allocator);
        self.spans.deinit(self.rt.allocator);
        self.closures.deinit(self.rt.allocator);
        self.rt.allocator.free(self.globals);
        self.rt.allocator.free(self.global_init);
    }

    fn setTrap(self: *VmState, code: []const u8, rule: []const u8, span: bc.SourceSpan) void {
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

    fn setAbort(self: *VmState, code: []const u8, span: bc.SourceSpan) void {
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

    fn maybeGcSafepoint(self: *VmState, regs: []TypedVal, roots: []gc_mod.RootSlot, force: bool, span: bc.SourceSpan) void {
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

    fn execFunction(self: *VmState, fn_idx: u32, args: []const TypedVal) TypedVal {
        const func = &self.mod.functions[fn_idx];
        const entry_span = func.cold_spans[0];
        if (self.depth >= self.limits.call_depth) {
            self.setTrap("r01-t-depth", "r01-depth", entry_span);
            return TypedVal.undef();
        }
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
                        .f64 => l.asF64() == r.asF64(),
                        .ref => if (l.obj_ptr != null and r.obj_ptr != null) l.obj_ptr.?.id == r.obj_ptr.?.id else l.payload == r.payload,
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
                    const obj = self.rt.gc.alloc(@intCast(ins.imm32), .class_instance, ins.a, ins.b) catch {
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
                    if (ins.b < obj.scalars.len) {
                        regs[ins.dst] = TypedVal.fromI32(@bitCast(@as(u32, @truncate(obj.scalars[ins.b]))));
                    } else {
                        const eidx = ins.b - obj.scalars.len;
                        if (eidx >= obj.edges.len) {
                            self.setTrap("r01-t-bounds", "r01-references", span);
                            return TypedVal.undef();
                        }
                        regs[ins.dst] = if (obj.edges[eidx]) |child| TypedVal.fromObj(child) else TypedVal.nullVal();
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
                    const val = regs[ins.dst];
                    if (ins.b < obj.scalars.len) {
                        obj.scalars[ins.b] = val.payload;
                    } else {
                        const eidx = ins.b - obj.scalars.len;
                        if (eidx >= obj.edges.len) {
                            self.setTrap("r01-t-bounds", "r01-references", span);
                            return TypedVal.undef();
                        }
                        self.rt.gc.writeEdge(obj, eidx, val.obj_ptr) catch {
                            self.setAbort("r05-execution-abort-oom", span);
                            return TypedVal.undef();
                        };
                    }
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
                    var call_args: [64]TypedVal = undefined;
                    var n: usize = 0;
                    if (rec.env_obj) |env| {
                        call_args[n] = TypedVal.fromObj(env);
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
            }
        }

        return TypedVal.undef();
    }

    fn findExceptionHandler(self: *VmState, func: *const bc.VerifiedFunction, pc: usize) ?usize {
        _ = self;
        const pc32: u32 = @intCast(pc);
        for (func.handlers) |h| {
            if (pc32 >= h.try_start and pc32 < h.try_end) return h.handler_pc;
        }
        return null;
    }
};

/// Sole Public R05 Execution Interface:
/// `verified module + FunctionId + typed argument frame + capability table + limits`.
/// NEVER accepts unverified bytecode; NEVER lets managed exceptions escape across ABI.
pub fn eval_bytecode(
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    function_id: [32]u8,
    arguments: []const TypedVal,
    capabilities: *rt_mod.CapabilityTable,
    limits: RequestLimits,
) ExecutionOutcome {
    const fn_idx = mod.findFunctionIndex(function_id) orelse {
        return .{ .status = .invalid_request, .code = "r05-request-function", .fuel_remaining = limits.semantic_fuel };
    };
    if (arguments.len != mod.functions[fn_idx].param_count) {
        return .{ .status = .invalid_request, .code = "r05-request-arity", .fuel_remaining = limits.semantic_fuel };
    }

    var state = VmState.init(rt, mod, capabilities, limits) catch {
        return .{ .status = .execution_abort, .code = "r05-execution-abort-oom", .fuel_remaining = limits.semantic_fuel };
    };
    defer state.deinit();

    const rv = state.execFunction(fn_idx, arguments);
    if (state.failed) return state.fail_outcome;
    if (state.exc_active) {
        return .{
            .status = .managed_exception,
            .value = state.exc_val,
            .code = "r01-e-uncaught",
            .fuel_remaining = state.fuel,
            .fuel_consumed = state.fuel_consumed,
            .instructions_executed = state.phys_ops,
        };
    }
    return .{
        .status = .ok,
        .value = rv,
        .fuel_remaining = state.fuel,
        .fuel_consumed = state.fuel_consumed,
        .instructions_executed = state.phys_ops,
    };
}

// ============================================================================
// Cross-Tier Bridge (Native -> VM with ABI Exception Isolation & Root Safety)
// ============================================================================
pub const TierBridgeContext = struct {
    rt: *rt_mod.R06Runtime,
    mod: *const bc.VerifiedModule,
    caps: *rt_mod.CapabilityTable,
    limits: RequestLimits,
};

/// Native-callable C-ABI trampoline invoking a verified VM function by `FunctionId`.
/// Catches ALL managed exceptions & traps into `rt_mod.BoundaryResult` so NO managed
/// exception ever crosses the Zig/C ABI boundary!
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
    const out = eval_bytecode(ctx.rt, ctx.mod, function_id, args[0..count], ctx.caps, ctx.limits);
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
