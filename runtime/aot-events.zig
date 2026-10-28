// SPDX-License-Identifier: MIT
// The compiled ABI calls this trusted Runtime bridge at the same ordered Core
// boundaries as the VM. It never accepts instructions or callback addresses
// from request JSON. Actual machine Resource qualification remains separate.
const std = @import("std");
const abi = @import("aot-instance.zig");
const program = @import("aot-program.zig");
const request = @import("request.zig");
const bytecode = @import("bytecode.zig");
const host = @import("host_counter.zig");
const clock = @import("clock.zig");

pub const Context = struct {
    allocator: std.mem.Allocator,
    metadata: *const program.Metadata,
    instance: *const abi.Instance,
    invocation: *abi.Request,
    counter: *host.Counter,
    limits: request.RequestLimits,
    fuel: u64,
    work: u64,
    deadline: clock.Deadline,
    frames: std.ArrayList(u32) = .empty,
    depth: u32 = 0,
    requested: u32,
    returned_source: ?bytecode.Source = null,
    failure_notified: bool = false,
    invalid_event: bool = false,

    pub fn deinit(self: *Context) void { self.frames.deinit(self.allocator); }

    fn fail(self: *Context, kind: u32, reason: u32, entity: u32, source: u32, start: u32, end: u32) bool {
        if (self.invocation.failure.kind == 0) self.invocation.failure = .{
            .kind = kind, .reason = reason, .function_index = entity,
            .source_index = source, .start = start, .end = end,
        };
        return false;
    }
    fn abort(self: *Context, entity: u32, source: u32, start: u32, end: u32) bool {
        return self.fail(2, 9, entity, source, start, end);
    }
    fn bad(self: *Context, entity: u32, source: u32, start: u32, end: u32) bool {
        self.invalid_event = true;
        return self.abort(entity, source, start, end);
    }
    fn expired(self: *Context, entity: u32, source: u32, start: u32, end: u32) bool {
        if (self.deadline.expired() catch true) return !self.abort(entity, source, start, end);
        return false;
    }
    // Count the live machine stack and every owned off-stack array exactly
    // once. Partial overlaps and size arithmetic fail closed. This observes
    // current storage; it does not claim a future machine-frame proof.
    fn memory(self: *const Context, future: usize) bool {
        const snapshot = host.StackSnapshot.read();
        var outside: usize = 0;
        const regions = [_]struct { address: usize, bytes: usize }{
            .{ .address = @intFromPtr(self), .bytes = @sizeOf(Context) },
            .{ .address = @intFromPtr(self.invocation), .bytes = @sizeOf(abi.Request) },
            .{ .address = @intFromPtr(self.instance), .bytes = @sizeOf(abi.Instance) },
            .{ .address = @intFromPtr(self.counter), .bytes = @sizeOf(host.Counter) },
            .{ .address = @intFromPtr(self.instance.globals.ptr), .bytes = self.instance.globals.len * @sizeOf(u64) },
            .{ .address = @intFromPtr(self.instance.initialized.ptr), .bytes = self.instance.initialized.len },
            .{ .address = @intFromPtr(self.instance.hosts.ptr), .bytes = self.instance.hosts.len * @sizeOf(abi.Host31) },
            .{ .address = @intFromPtr(self.frames.items.ptr), .bytes = self.frames.capacity * @sizeOf(u32) },
        };
        for (regions) |region| {
            const bytes = snapshot.outsideBytes(region.address, region.bytes) orelse return false;
            const added = @addWithOverflow(outside, bytes);
            if (added[1] != 0) return false;
            outside = added[0];
        }
        return snapshot.admits(future, outside, self.limits.memory_bytes);
    }
    fn pop(self: *Context, entity: u32) bool {
        if (self.frames.items.len == 0 or self.frames.items[self.frames.items.len - 1] != entity) return false;
        const function = self.metadata.program.functions.?[entity];
        self.frames.items.len -= 1;
        if (function.initializer == 0) self.depth -= 1;
        return true;
    }
    fn notifyFailure(self: *Context, kind: u32, entity: u32, start: u32, end: u32) bool {
        const failure = self.invocation.failure;
        if (kind == 3) {
            if (!self.pop(entity)) self.invalid_event = true;
            return false;
        }
        if (kind == 8) return false;
        // A conversion/arithmetic guard first stores its precise failure,
        // then emits its one mandatory notification. No later work is allowed.
        const reason: u32 = switch (kind) { 5 => 1, 6 => 2, 7 => 3, 9 => 4, 10 => 5, 11 => 15, else => 0 };
        if (!self.failure_notified and reason != 0 and failure.reason == reason
            and failure.function_index == entity and failure.start == start and failure.end == end)
        {
            self.failure_notified = true;
            return false;
        }
        self.invalid_event = true;
        return false;
    }
    fn handle(self: *Context, kind: u32, entity: u32, start: u32, end: u32) bool {
        const is_host = entity & 0x80000000 != 0;
        const active = if (self.frames.items.len == 0) null else self.frames.items[self.frames.items.len - 1];
        const source = if (is_host) blk: {
            const caller = active orelse return self.bad(entity, 0, start, end);
            const function = self.metadata.program.functions.?[caller];
            if (start < function.start or end > function.end or start >= end) return self.bad(entity, function.source, start, end);
            break :blk function.source;
        } else blk: {
            if (entity >= self.metadata.program.function_count) return self.bad(entity, 0, start, end);
            break :blk self.metadata.program.functions.?[entity].source;
        };
        const location = self.metadata.sourceForEntity(entity, source, start, end) orelse return self.bad(entity, source, start, end);
        if (self.invocation.failure.kind != 0) return self.notifyFailure(kind, entity, start, end);
        if (kind == 8) return self.frames.items.len == 0;
        if (kind == 0) {
            if (is_host) return self.bad(entity, source, start, end);
            const function = self.metadata.program.functions.?[entity];
            if (function.initializer == 0 and self.depth >= self.limits.depth) return self.fail(1, 8, entity, source, start, end);
            if (self.expired(entity, source, start, end)) return false;
            if (self.frames.items.len == self.frames.capacity) {
                if (!self.memory(@sizeOf(u32))) return self.abort(entity, source, start, end);
                self.frames.ensureTotalCapacityPrecise(self.allocator, self.frames.items.len + 1)
                    catch return self.abort(entity, source, start, end);
            }
            self.frames.appendAssumeCapacity(entity);
            if (!self.memory(0)) { self.frames.items.len -= 1; return self.abort(entity, source, start, end); }
            if (function.initializer == 0) self.depth += 1;
            return true;
        }
        if (is_host) {
            if (kind != 13 and kind != 14) return self.bad(entity, source, start, end);
            if (kind == 14) return !self.expired(entity, source, start, end);
            if (self.depth >= self.limits.depth) return self.fail(1, 8, entity, source, start, end);
            if (self.fuel == 0) return self.fail(1, 7, entity, source, start, end);
            self.fuel -= 1;
            const work = self.counter.instructionBound();
            if (work > self.work or !self.memory(self.counter.boundaryBytes()) or !self.counter.boundaryStackAvailable())
                return self.abort(entity, source, start, end);
            self.work -= work;
            return !self.expired(entity, source, start, end);
        }
        if (active == null or active.? != entity) return self.bad(entity, source, start, end);
        if (kind == 3) return if (self.pop(entity)) true else self.bad(entity, source, start, end);
        if (kind == 4) {
            if (entity == self.requested and self.frames.items.len == 1) self.returned_source = location.source;
            return true;
        }
        if (kind != 1 and kind != 2) return self.bad(entity, source, start, end);
        if (kind == 1) {
            if (self.fuel == 0) return self.fail(1, 7, entity, source, start, end);
            self.fuel -= 1;
        }
        if (self.work == 0 or !self.memory(0)) return self.abort(entity, source, start, end);
        self.work -= 1;
        return !self.expired(entity, source, start, end);
    }
    pub fn event(raw: ?*anyopaque, kind: u32, entity: u32, start: u32, end: u32, interval: u64) callconv(.c) i32 {
        const self: *Context = @ptrCast(@alignCast(raw orelse return 0));
        if (interval == 0) return @intFromBool(self.bad(entity, 0, start, end));
        return @intFromBool(self.handle(kind, entity, start, end));
    }
};

pub fn storeFailure(metadata: *const program.Metadata, failure: abi.Failure, fallback: *const bytecode.ModuleInfo, out: *request.RequestOutcome) void {
    const location = metadata.sourceForEntity(failure.function_index, failure.source_index, failure.start, failure.end)
        orelse program.EntitySource{ .id = fallback.function_id, .source = fallback.source };
    const id = &location.id;
    const source = &location.source;
    if (failure.kind == 4 and failure.reason == 6) { request.storeManagedReference(out, id, source); return; }
    if (failure.kind == 1) switch (failure.reason) {
        1 => { request.storeArithmeticTrap(out, "r01-t-divide-zero", "r01-division", id, source); return; },
        2 => { request.storeArithmeticTrap(out, "r01-t-remainder-zero", "r01-division", id, source); return; },
        3 => { request.storeArithmeticTrap(out, "r01-t-shift-count", "r01-shifts", id, source); return; },
        4 => { request.storeArithmeticTrap(out, "r01-t-conversion-nonfinite", "r01-conversions", id, source); return; },
        5 => { request.storeArithmeticTrap(out, "r01-t-conversion-range", "r01-conversions", id, source); return; },
        7 => { request.storeArithmeticTrap(out, "r01-t-fuel", "r01-fuel", id, source); return; },
        8 => { request.storeArithmeticTrap(out, "r01-t-depth", "r01-depth", id, source); return; },
        else => {},
    };
    const code: []const u8 = if (failure.kind == 3) switch (failure.reason) {
        10 => "r05-request-instance", 11 => "r05-request-function", 12, 15 => "r05-request-arguments",
        13 => "r05-request-capability", 14 => "r05-request-host-contract", else => "r05-execution-abort",
    } else "r05-execution-abort";
    request.storeRequestFailure(out, code, id, source);
}
