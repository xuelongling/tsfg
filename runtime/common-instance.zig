// SPDX-License-Identifier: MIT
// Formal Common20 active execution admission, module initialization, persistent
// global state, exclusive Host/GPU lease bridge, and Common20 SSA evaluator.
const std = @import("std");
const model = @import("wire-program-model.zig");
const reader = @import("wire-program-checked-reader.zig");
const t = @import("wire-program-types.zig");
const inst = @import("wire-program-instruction.zig");
const tables = @import("wire-program-tables.zig");

pub const Status = enum(u8) {
    uninitialized = 0,
    initializing = 1,
    initialized = 2,
    failed = 3,
};

pub const AdmissionSpec = struct {
    expected_input_identity: ?t.Hash = null,
    expected_scope_digest: ?t.Hash = null,
    expected_published_digest: ?t.Hash = null,
    expected_target: ?[]const u8 = null,
    material: ?*const reader.HostBundle = null,
};

pub const AdmissionError = reader.Error || error{
    NotCommonProgram,
    IdentityMismatch,
    ScopeDigestMismatch,
    PublishedDigestMismatch,
    TargetMismatch,
};

pub const Value = union(enum) {
    void,
    @"undefined",
    @"null",
    bool: bool,
    i32: i32,
    u32: u32,
    i64: i64,
    u64: u64,
    f32: f32,
    f64: f64,
    raw64: u64,

    pub fn asI32Bits(self: Value) ?u32 {
        return switch (self) {
            .i32 => |v| @bitCast(v),
            .u32 => |v| v,
            else => null,
        };
    }

    pub fn asBool(self: Value) ?bool {
        return switch (self) {
            .bool => |b| b,
            else => null,
        };
    }
};

pub const GlobalSlot = struct {
    id: t.Hash,
    name: []const u8,
    writable: bool,
    initialized: bool = false,
    value: Value = .@"undefined",
};

pub const RequestLimits = struct {
    semantic_fuel: u64 = 4097,
    call_depth: u32 = 64,
};

pub const Trap = struct {
    code: []const u8,
    source_start: u32 = 0,
    source_end: u32 = 0,
};

pub const CallOutcome = struct {
    status: enum { ok, trap, invalid_request },
    value: Value = .void,
    trap: ?Trap = null,
    fuel_remaining: u64 = 0,
    depth_limit: u32 = 0,
};

pub const GlobalWrite = struct {
    id: t.Hash,
    value: Value,
};

pub const CommonInstance = struct {
    allocator: std.mem.Allocator,
    owned: model.OwnedProgram,
    status: Status = .uninitialized,
    globals: []GlobalSlot,
    module_published: []bool,
    lease_active: bool = false,
    work_charged: usize = 0,

    pub fn admit(allocator: std.mem.Allocator, bytes: []const u8, spec: AdmissionSpec) AdmissionError!CommonInstance {
        var work: usize = 0;
        var owned = try reader.readOwnedChecked(allocator, bytes, spec.material, &work);
        errdefer owned.deinit();

        const prog = &owned.program;
        if (prog.tables.mode != .common) return error.NotCommonProgram;
        const common = &prog.tables.mode.common;

        if (spec.expected_input_identity) |exp| {
            if (!std.mem.eql(u8, &prog.input_identity, &exp)) return error.IdentityMismatch;
        }
        if (spec.expected_scope_digest) |exp| {
            if (!std.mem.eql(u8, &common.authority.fixed_publication.publication.scope_digest, &exp)) {
                return error.ScopeDigestMismatch;
            }
        }
        if (spec.expected_published_digest) |exp| {
            if (!std.mem.eql(u8, &common.authority.fixed_publication.publication.expected_digest, &exp)) {
                return error.PublishedDigestMismatch;
            }
        }
        if (spec.expected_target) |exp| {
            if (!std.mem.eql(u8, prog.target.target, exp)) return error.TargetMismatch;
        }

        const mod_globals = common.modules.globals;
        const slots = try allocator.alloc(GlobalSlot, mod_globals.len);
        errdefer allocator.free(slots);
        for (mod_globals, 0..) |g, i| {
            slots[i] = .{
                .id = g.id,
                .name = g.name,
                .writable = g.writable,
                .initialized = false,
                .value = .@"undefined",
            };
        }

        const published = try allocator.alloc(bool, common.modules.modules.len);
        errdefer allocator.free(published);
        @memset(published, false);

        return .{
            .allocator = allocator,
            .owned = owned,
            .status = .uninitialized,
            .globals = slots,
            .module_published = published,
            .lease_active = false,
            .work_charged = work,
        };
    }

    pub fn deinit(self: *CommonInstance) void {
        self.allocator.free(self.globals);
        self.allocator.free(self.module_published);
        self.owned.deinit();
        self.* = undefined;
    }

    pub fn commonTables(self: *const CommonInstance) *const tables.CommonTables {
        return &self.owned.program.tables.mode.common;
    }

    pub fn inputIdentity(self: *const CommonInstance) t.Hash {
        return self.owned.program.input_identity;
    }

    pub fn scopeDigest(self: *const CommonInstance) t.Hash {
        return self.commonTables().authority.fixed_publication.publication.scope_digest;
    }

    pub fn publishedDigest(self: *const CommonInstance) t.Hash {
        return self.commonTables().authority.fixed_publication.publication.expected_digest;
    }

    pub fn initialize(self: *CommonInstance, limits: RequestLimits) CallOutcome {
        if (self.status == .initialized) {
            return .{ .status = .ok, .value = .void, .fuel_remaining = limits.semantic_fuel, .depth_limit = limits.call_depth };
        }
        if (self.status == .failed or self.status == .initializing) {
            return .{
                .status = .invalid_request,
                .trap = .{ .code = "r05-module-init-failed" },
                .fuel_remaining = limits.semantic_fuel,
                .depth_limit = limits.call_depth,
            };
        }

        self.status = .initializing;
        var fuel = limits.semantic_fuel;
        const common = self.commonTables();

        for (common.modules.initialization) |mod_ref| {
            const mod_idx: usize = @intFromEnum(mod_ref);
            const mod = common.modules.modules[mod_idx];
            const fn_idx: usize = @intFromEnum(mod.initializer);
            const outcome = self.execFunction(fn_idx, &.{}, &fuel, limits.call_depth, 0);
            if (outcome.status != .ok) {
                // Failed initialization never publishes partial state and never auto-retries.
                for (self.globals) |*g| {
                    g.initialized = false;
                    g.value = .@"undefined";
                }
                @memset(self.module_published, false);
                self.status = .failed;
                return .{
                    .status = outcome.status,
                    .trap = outcome.trap,
                    .fuel_remaining = fuel,
                    .depth_limit = limits.call_depth,
                };
            }
            self.module_published[mod_idx] = true;
        }

        // Verify all owned globals are initialized after module initialization.
        for (self.globals) |g| {
            if (!g.initialized) {
                self.status = .failed;
                return .{
                    .status = .trap,
                    .trap = .{ .code = "r01-t-uninitialized-global" },
                    .fuel_remaining = fuel,
                    .depth_limit = limits.call_depth,
                };
            }
        }

        self.status = .initialized;
        return .{
            .status = .ok,
            .value = .void,
            .fuel_remaining = fuel,
            .depth_limit = limits.call_depth,
        };
    }

    pub fn findGlobalIndexById(self: *const CommonInstance, id: t.Hash) ?usize {
        for (self.globals, 0..) |g, i| {
            if (std.mem.eql(u8, &g.id, &id)) return i;
        }
        return null;
    }

    pub fn findGlobalIndexByName(self: *const CommonInstance, name: []const u8) ?usize {
        for (self.globals, 0..) |g, i| {
            if (std.mem.eql(u8, g.name, name)) return i;
        }
        return null;
    }

    pub fn readGlobalById(self: *const CommonInstance, id: t.Hash) ?Value {
        if (self.status != .initialized) return null;
        const idx = self.findGlobalIndexById(id) orelse return null;
        if (!self.globals[idx].initialized) return null;
        return self.globals[idx].value;
    }

    pub fn readGlobalByName(self: *const CommonInstance, name: []const u8) ?Value {
        if (self.status != .initialized) return null;
        const idx = self.findGlobalIndexByName(name) orelse return null;
        if (!self.globals[idx].initialized) return null;
        return self.globals[idx].value;
    }

    pub fn acquireLease(self: *CommonInstance) bool {
        if (self.status != .initialized or self.lease_active) return false;
        self.lease_active = true;
        return true;
    }

    pub fn releaseLease(self: *CommonInstance) void {
        self.lease_active = false;
    }

    pub fn validateWritableGlobals(self: *const CommonInstance, ids: []const t.Hash) bool {
        if (self.status != .initialized) return false;
        for (ids, 0..) |id, i| {
            const idx = self.findGlobalIndexById(id) orelse return false;
            if (!self.globals[idx].writable or !self.globals[idx].initialized) return false;
            for (ids[0..i]) |prev| {
                if (std.mem.eql(u8, &prev, &id)) return false;
            }
        }
        return true;
    }

    /// Atomically publishes global writebacks; on any validation error leaves every global unchanged.
    pub fn commitGlobalWrites(self: *CommonInstance, writes: []const GlobalWrite) bool {
        if (self.status != .initialized or !self.lease_active) return false;
        // Phase 1: validate every target and check distinctness.
        for (writes, 0..) |w, i| {
            const idx = self.findGlobalIndexById(w.id) orelse return false;
            if (!self.globals[idx].writable or !self.globals[idx].initialized) return false;
            for (writes[0..i]) |prev| {
                if (std.mem.eql(u8, &prev.id, &w.id)) return false;
            }
        }
        // Phase 2: commit atomically.
        for (writes) |w| {
            const idx = self.findGlobalIndexById(w.id).?;
            self.globals[idx].value = w.value;
        }
        return true;
    }

    pub fn findFunctionIndexByName(self: *const CommonInstance, name: []const u8) ?usize {
        for (self.owned.program.functions, 0..) |f, i| {
            if (std.mem.eql(u8, f.name, name)) return i;
        }
        return null;
    }

    pub fn findFunctionIndexById(self: *const CommonInstance, id: t.Hash) ?usize {
        for (self.owned.program.functions, 0..) |f, i| {
            if (std.mem.eql(u8, &f.id, &id)) return i;
        }
        return null;
    }

    pub fn callFunctionByName(self: *CommonInstance, name: []const u8, args: []const Value, limits: RequestLimits) CallOutcome {
        if (self.status != .initialized or self.lease_active) {
            return .{
                .status = .invalid_request,
                .trap = .{ .code = "r05-instance-not-ready" },
                .fuel_remaining = limits.semantic_fuel,
                .depth_limit = limits.call_depth,
            };
        }
        const fn_idx = self.findFunctionIndexByName(name) orelse {
            return .{
                .status = .invalid_request,
                .trap = .{ .code = "r05-request-function" },
                .fuel_remaining = limits.semantic_fuel,
                .depth_limit = limits.call_depth,
            };
        };
        var fuel = limits.semantic_fuel;
        const out = self.execFunction(fn_idx, args, &fuel, limits.call_depth, 0);
        return .{
            .status = out.status,
            .value = out.value,
            .trap = out.trap,
            .fuel_remaining = fuel,
            .depth_limit = limits.call_depth,
        };
    }

    fn execFunction(
        self: *CommonInstance,
        fn_idx: usize,
        args: []const Value,
        fuel: *u64,
        depth_limit: u32,
        current_depth: u32,
    ) CallOutcome {
        const func = &self.owned.program.functions[fn_idx];
        const next_depth = current_depth + 1;
        if (next_depth > depth_limit) {
            return .{
                .status = .trap,
                .trap = .{ .code = "r01-t-depth", .source_start = func.declaration.start, .source_end = func.declaration.end },
                .fuel_remaining = fuel.*,
                .depth_limit = depth_limit,
            };
        }

        const regs = self.allocator.alloc(Value, func.registers.len) catch {
            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
        };
        defer self.allocator.free(regs);
        @memset(regs, .@"undefined");

        const cell_count = self.commonTables().storage.bindings.len;
        const cells = self.allocator.alloc(Value, cell_count) catch {
            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
        };
        defer self.allocator.free(cells);
        @memset(cells, .@"undefined");
        const cell_init = self.allocator.alloc(bool, cell_count) catch {
            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
        };
        defer self.allocator.free(cell_init);
        @memset(cell_init, false);

        // Bind entry block parameters from call arguments.
        if (func.blocks.len == 0) {
            return .{ .status = .trap, .trap = .{ .code = "r05-empty-function" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
        }
        const entry_params = func.blocks[0].parameters;
        if (args.len != entry_params.len) {
            return .{ .status = .invalid_request, .trap = .{ .code = "r05-request-arguments" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
        }
        for (entry_params, 0..) |param_reg, i| {
            regs[@intFromEnum(param_reg)] = args[i];
        }

        var current_block: usize = 0;
        while (true) {
            const blk = &func.blocks[current_block];
            var jumped = false;
            for (blk.instructions) |op| {
                switch (op.data) {
                    .fuel => {
                        if (fuel.* == 0) {
                            return .{
                                .status = .trap,
                                .trap = .{ .code = "r01-t-fuel", .source_start = op.source.start, .source_end = op.source.end },
                                .fuel_remaining = 0,
                                .depth_limit = depth_limit,
                            };
                        }
                        fuel.* -= 1;
                    },
                    .const_i32 => |bits| {
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(@as(u32, @truncate(bits))) };
                    },
                    .const_bool => |b| {
                        regs[@intFromEnum(op.result.?)] = .{ .bool = b };
                    },
                    .const_integer => |bits| {
                        regs[@intFromEnum(op.result.?)] = .{ .raw64 = bits };
                    },
                    .const_float => |bits| {
                        regs[@intFromEnum(op.result.?)] = .{ .f64 = @bitCast(bits) };
                    },
                    .global_load => |g| {
                        const gi: usize = @intFromEnum(g.global);
                        if (!self.globals[gi].initialized) {
                            return .{
                                .status = .trap,
                                .trap = .{ .code = "r01-t-uninitialized-global", .source_start = op.source.start, .source_end = op.source.end },
                                .fuel_remaining = fuel.*,
                                .depth_limit = depth_limit,
                            };
                        }
                        regs[@intFromEnum(op.result.?)] = self.globals[gi].value;
                    },
                    .global_store => |g| {
                        const gi: usize = @intFromEnum(g.global);
                        const val = regs[@intFromEnum(op.operands[0])];
                        self.globals[gi].value = val;
                        if (g.initialize) self.globals[gi].initialized = true;
                    },
                    .add => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const r: i32 = @bitCast(a +% b);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = r };
                    },
                    .sub => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const r: i32 = @bitCast(a -% b);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = r };
                    },
                    .mul => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const r: i32 = @bitCast(a *% b);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = r };
                    },
                    .div => {
                        const a: i32 = @bitCast(regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        const b: i32 = @bitCast(regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        if (b == 0) return trapAt("r01-t-div-zero", op, fuel.*, depth_limit);
                        if (a == std.math.minInt(i32) and b == -1) return trapAt("r01-t-div-overflow", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @divTrunc(a, b) };
                    },
                    .rem => {
                        const a: i32 = @bitCast(regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        const b: i32 = @bitCast(regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        if (b == 0) return trapAt("r01-t-div-zero", op, fuel.*, depth_limit);
                        if (a == std.math.minInt(i32) and b == -1) {
                            regs[@intFromEnum(op.result.?)] = .{ .i32 = 0 };
                        } else {
                            regs[@intFromEnum(op.result.?)] = .{ .i32 = @rem(a, b) };
                        }
                    },
                    .@"and" => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(a & b) };
                    },
                    .@"or" => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(a | b) };
                    },
                    .xor => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(a ^ b) };
                    },
                    .shl => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        if (b >= 32) return trapAt("r01-t-shift-count", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(a << @intCast(b)) };
                    },
                    .shr => {
                        const a: i32 = @bitCast(regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        if (b >= 32) return trapAt("r01-t-shift-count", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = a >> @intCast(b) };
                    },
                    .ushr => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const b = regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        if (b >= 32) return trapAt("r01-t-shift-count", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(a >> @intCast(b)) };
                    },
                    .neg => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(@as(u32, 0) -% a) };
                    },
                    .not => {
                        const a = regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .i32 = @bitCast(~a) };
                    },
                    .pos => {
                        regs[@intFromEnum(op.result.?)] = regs[@intFromEnum(op.operands[0])];
                    },
                    .bool_not => {
                        const b = regs[@intFromEnum(op.operands[0])].asBool() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = .{ .bool = !b };
                    },
                    .eq, .ne, .lt, .le, .gt, .ge => {
                        const a: i32 = @bitCast(regs[@intFromEnum(op.operands[0])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        const b: i32 = @bitCast(regs[@intFromEnum(op.operands[1])].asI32Bits() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit));
                        const res = switch (op.data) {
                            .eq => a == b,
                            .ne => a != b,
                            .lt => a < b,
                            .le => a <= b,
                            .gt => a > b,
                            .ge => a >= b,
                            else => unreachable,
                        };
                        regs[@intFromEnum(op.result.?)] = .{ .bool = res };
                    },
                    .domain_view, .domain_copy => {
                        regs[@intFromEnum(op.result.?)] = regs[@intFromEnum(op.operands[0])];
                    },
                    .domain_literal => {
                        const v = if (op.operands.len > 0) regs[@intFromEnum(op.operands[0])] else Value.@"undefined";
                        regs[@intFromEnum(op.result.?)] = v;
                    },
                    .domain_numeric_use => |nu| {
                        const val = regs[@intFromEnum(op.operands[0])];
                        if (val.asI32Bits() == null) {
                            return trapAt("r01-t-numeric-use", op, fuel.*, depth_limit);
                        }
                        const next_blk: usize = @intFromEnum(nu.normal_successor);
                        const dst_params = func.blocks[next_blk].parameters;
                        if (dst_params.len > 0) {
                            regs[@intFromEnum(dst_params[0])] = val;
                        }
                        current_block = next_blk;
                        jumped = true;
                        break;
                    },
                    .eh_cell => |c| {
                        regs[@intFromEnum(op.result.?)] = .{ .raw64 = @intFromEnum(c.binding) };
                    },
                    .eh_store => |s| {
                        const ci: usize = @intFromEnum(s.binding);
                        const val = regs[@intFromEnum(op.operands[1])];
                        cells[ci] = val;
                        if (s.initialize) cell_init[ci] = true;
                    },
                    .eh_load => |l| {
                        const ci: usize = @intFromEnum(l.binding);
                        if (!cell_init[ci]) return trapAt("r01-t-uninitialized-cell", op, fuel.*, depth_limit);
                        regs[@intFromEnum(op.result.?)] = cells[ci];
                    },
                    .eh_publish => |pub_op| {
                        self.module_published[@intFromEnum(pub_op.module)] = true;
                    },
                    .br => |b| {
                        const next_blk: usize = @intFromEnum(b.destination);
                        const dst_params = func.blocks[next_blk].parameters;
                        const tmp = self.allocator.alloc(Value, dst_params.len) catch {
                            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
                        };
                        defer self.allocator.free(tmp);
                        for (dst_params, 0..) |_, i| tmp[i] = regs[@intFromEnum(op.operands[i])];
                        for (dst_params, 0..) |p, i| regs[@intFromEnum(p)] = tmp[i];
                        current_block = next_blk;
                        jumped = true;
                        break;
                    },
                    .cond_br => |cb| {
                        const cond = regs[@intFromEnum(op.operands[0])].asBool() orelse return trapAt("r01-t-type", op, fuel.*, depth_limit);
                        const next_blk: usize = if (cond) @intFromEnum(cb.true_destination) else @intFromEnum(cb.false_destination);
                        const arg_start: usize = if (cond) 1 else 1 + @as(usize, cb.true_count);
                        const dst_params = func.blocks[next_blk].parameters;
                        const tmp = self.allocator.alloc(Value, dst_params.len) catch {
                            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
                        };
                        defer self.allocator.free(tmp);
                        for (dst_params, 0..) |_, i| tmp[i] = regs[@intFromEnum(op.operands[arg_start + i])];
                        for (dst_params, 0..) |p, i| regs[@intFromEnum(p)] = tmp[i];
                        current_block = next_blk;
                        jumped = true;
                        break;
                    },
                    .call => |c| {
                        const call_args = self.allocator.alloc(Value, op.operands.len) catch {
                            return .{ .status = .trap, .trap = .{ .code = "r05-execution-abort" }, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
                        };
                        defer self.allocator.free(call_args);
                        for (op.operands, 0..) |reg_ref, i| call_args[i] = regs[@intFromEnum(reg_ref)];
                        const sub = self.execFunction(@intFromEnum(c.callee), call_args, fuel, depth_limit, next_depth);
                        if (sub.status != .ok) return sub;
                        if (op.result) |res_reg| regs[@intFromEnum(res_reg)] = sub.value;
                    },
                    .@"return" => {
                        const ret = if (op.operands.len > 0) regs[@intFromEnum(op.operands[0])] else Value.void;
                        return .{ .status = .ok, .value = ret, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
                    },
                    else => {
                        return trapAt("r05-unimplemented-opcode", op, fuel.*, depth_limit);
                    },
                }
            }
            if (!jumped) {
                return .{ .status = .ok, .value = .void, .fuel_remaining = fuel.*, .depth_limit = depth_limit };
            }
        }
    }

    fn trapAt(code: []const u8, op: inst.Instruction, fuel_remaining: u64, depth_limit: u32) CallOutcome {
        return .{
            .status = .trap,
            .trap = .{ .code = code, .source_start = op.source.start, .source_end = op.source.end },
            .fuel_remaining = fuel_remaining,
            .depth_limit = depth_limit,
        };
    }
};

// ---------------------------------------------------------------------------
// C ABI bridge for C++ external software-device / Host consumers (M39).
// ---------------------------------------------------------------------------
pub const CGlobalWrite = extern struct {
    id: [32]u8,
    i32_bits: u32,
};

export fn tsfg_common20_admit(
    bytes_ptr: [*]const u8,
    bytes_len: usize,
    expected_input_id: ?*const [32]u8,
    expected_scope_digest: ?*const [32]u8,
    expected_published_digest: ?*const [32]u8,
) ?*CommonInstance {
    const alloc = std.heap.page_allocator;
    const inst_ptr = alloc.create(CommonInstance) catch return null;
    inst_ptr.* = CommonInstance.admit(alloc, bytes_ptr[0..bytes_len], .{
        .expected_input_identity = if (expected_input_id) |p| p.* else null,
        .expected_scope_digest = if (expected_scope_digest) |p| p.* else null,
        .expected_published_digest = if (expected_published_digest) |p| p.* else null,
        .expected_target = model.format.target,
    }) catch {
        alloc.destroy(inst_ptr);
        return null;
    };
    return inst_ptr;
}

export fn tsfg_common20_destroy(handle: ?*CommonInstance) void {
    const inst_ptr = handle orelse return;
    inst_ptr.deinit();
    std.heap.page_allocator.destroy(inst_ptr);
}

export fn tsfg_common20_initialize(handle: ?*CommonInstance, fuel_in: u64, depth_limit: u32, fuel_out: ?*u64) i32 {
    const inst_ptr = handle orelse return -1;
    const out = inst_ptr.initialize(.{ .semantic_fuel = fuel_in, .call_depth = depth_limit });
    if (fuel_out) |p| p.* = out.fuel_remaining;
    return if (out.status == .ok) 0 else 1;
}

export fn tsfg_common20_status(handle: ?*const CommonInstance) u8 {
    const inst_ptr = handle orelse return @intFromEnum(Status.failed);
    return @intFromEnum(inst_ptr.status);
}

export fn tsfg_common20_lease_acquire(handle: ?*CommonInstance) i32 {
    const inst_ptr = handle orelse return 0;
    return if (inst_ptr.acquireLease()) 1 else 0;
}

export fn tsfg_common20_lease_release(handle: ?*CommonInstance) void {
    const inst_ptr = handle orelse return;
    inst_ptr.releaseLease();
}

export fn tsfg_common20_read_global_i32(handle: ?*const CommonInstance, id: *const [32]u8, out_bits: *u32) i32 {
    const inst_ptr = handle orelse return 0;
    const val = inst_ptr.readGlobalById(id.*) orelse return 0;
    const bits = val.asI32Bits() orelse return 0;
    out_bits.* = bits;
    return 1;
}

export fn tsfg_common20_validate_writable_globals(handle: ?*const CommonInstance, ids: [*]const [32]u8, count: usize) i32 {
    const inst_ptr = handle orelse return 0;
    return if (inst_ptr.validateWritableGlobals(ids[0..count])) 1 else 0;
}

export fn tsfg_common20_commit_globals_i32(handle: ?*CommonInstance, writes: [*]const CGlobalWrite, count: usize) i32 {
    const inst_ptr = handle orelse return 0;
    if (count > 64) return 0;
    var buf: [64]GlobalWrite = undefined;
    for (0..count) |i| {
        buf[i] = .{ .id = writes[i].id, .value = .{ .i32 = @bitCast(writes[i].i32_bits) } };
    }
    return if (inst_ptr.commitGlobalWrites(buf[0..count])) 1 else 0;
}
