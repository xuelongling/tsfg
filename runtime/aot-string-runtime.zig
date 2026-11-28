// SPDX-License-Identifier: MIT
//! Production Windows AOT C-ABI bridge for lossless WTF-8 Strings, StringViews,
//! strict/lossy UTF-8 output boundary, persistent string globals, and moving GC.
//! Built directly on `string-value.zig`, `string-output.zig`, and `managed-heap.zig`.
const std = @import("std");
const managed = @import("managed-heap.zig");
const values = @import("string-value.zig");
const output = @import("string-output.zig");

pub const StringAotContext = struct {
    allocator: std.mem.Allocator,
    owner: *values.Owner,
    handles: std.ArrayListUnmanaged(managed.Handle) = .empty,
    globals: [64]?managed.Handle = [_]?managed.Handle{null} ** 64,
    global_init: [64]bool = [_]bool{false} ** 64,
    fuel: u64 = 1000,
    trap_code: u32 = 0, // 0=ok, 1=fuel, 2=bounds, 3=oom, 4=uninit-global, 5=invalid-utf8
    trap_start: u32 = 0,
    trap_end: u32 = 0,

    fn allocId(self: *StringAotContext, h: managed.Handle) !u64 {
        const idx = self.handles.items.len + 1;
        try self.handles.append(self.allocator, h);
        return @intCast(idx);
    }

    fn getHandle(self: *const StringAotContext, id: u64) ?managed.Handle {
        if (id == 0 or id > self.handles.items.len) return null;
        return self.handles.items[@intCast(id - 1)];
    }

    fn setTrap(self: *StringAotContext, code: u32, start: u32, end: u32) void {
        if (self.trap_code == 0) {
            self.trap_code = code;
            self.trap_start = start;
            self.trap_end = end;
        }
    }
};

export fn tsfg_aot_str_create(fuel: u64) ?*StringAotContext {
    const alloc = std.heap.page_allocator;
    const owner = values.Owner.create(alloc) catch return null;
    const ctx = alloc.create(StringAotContext) catch {
        owner.release();
        return null;
    };
    ctx.* = .{
        .allocator = alloc,
        .owner = owner,
        .fuel = fuel,
    };
    return ctx;
}

export fn tsfg_aot_str_reset_request(ctx: ?*StringAotContext, fuel: u64) void {
    const c = ctx orelse return;
    c.fuel = fuel;
    c.trap_code = 0;
    c.trap_start = 0;
    c.trap_end = 0;
}

export fn tsfg_aot_str_destroy(ctx: ?*StringAotContext) void {
    const c = ctx orelse return;
    for (c.handles.items) |h| {
        c.owner.heap.release(h) catch {};
    }
    c.handles.deinit(c.allocator);
    for (c.globals) |mg| {
        if (mg) |h| c.owner.heap.release(h) catch {};
    }
    c.owner.release();
    c.allocator.destroy(c);
}

export fn tsfg_aot_str_fuel(ctx: ?*StringAotContext, start: u32, end: u32) i32 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    if (c.fuel == 0) {
        c.setTrap(1, start, end);
        return 0;
    }
    c.fuel -= 1;
    return 1;
}

export fn tsfg_aot_str_trap_code(ctx: ?*const StringAotContext) u32 {
    const c = ctx orelse return 3;
    return c.trap_code;
}

export fn tsfg_aot_str_trap_start(ctx: ?*const StringAotContext) u32 {
    const c = ctx orelse return 0;
    return c.trap_start;
}

export fn tsfg_aot_str_trap_end(ctx: ?*const StringAotContext) u32 {
    const c = ctx orelse return 0;
    return c.trap_end;
}

export fn tsfg_aot_str_from_u16(ctx: ?*StringAotContext, ptr: [*]const u16, len: usize) u64 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const slice = if (len == 0) &[_]u16{} else ptr[0..len];
    const h = c.owner.heap.createString(slice, .persistent) catch {
        c.setTrap(3, 0, 0);
        return 0;
    };
    return c.allocId(h) catch {
        c.owner.heap.release(h) catch {};
        c.setTrap(3, 0, 0);
        return 0;
    };
}

export fn tsfg_aot_str_length(ctx: ?*StringAotContext, id: u64, start: u32, end: u32) u64 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const h = c.getHandle(id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    return c.owner.heap.stringLength(h) catch {
        c.setTrap(3, start, end);
        return 0;
    };
}

export fn tsfg_aot_str_codeunit(ctx: ?*StringAotContext, id: u64, idx: u64, start: u32, end: u32) u16 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const h = c.getHandle(id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    if (idx > std.math.maxInt(usize)) {
        c.setTrap(2, start, end);
        return 0;
    }
    return c.owner.heap.readStringCodeUnit(h, @intCast(idx)) catch |err| {
        c.setTrap(if (err == error.IndexOutOfBounds) 2 else 3, start, end);
        return 0;
    };
}

export fn tsfg_aot_str_concat(ctx: ?*StringAotContext, a_id: u64, b_id: u64, start: u32, end: u32) u64 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const a = c.getHandle(a_id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    const b = c.getHandle(b_id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    const h = c.owner.heap.concatStrings(a, b, .persistent) catch {
        c.setTrap(3, start, end);
        return 0;
    };
    return c.allocId(h) catch {
        c.owner.heap.release(h) catch {};
        c.setTrap(3, start, end);
        return 0;
    };
}

export fn tsfg_aot_str_slice(ctx: ?*StringAotContext, id: u64, from: u64, to: u64, start: u32, end: u32) u64 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const h = c.getHandle(id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    if (from > std.math.maxInt(usize) or to > std.math.maxInt(usize)) {
        c.setTrap(2, start, end);
        return 0;
    }
    const res = c.owner.heap.sliceString(h, @intCast(from), @intCast(to), .persistent) catch |err| {
        c.setTrap(if (err == error.IndexOutOfBounds) 2 else 3, start, end);
        return 0;
    };
    return c.allocId(res) catch {
        c.owner.heap.release(res) catch {};
        c.setTrap(3, start, end);
        return 0;
    };
}

export fn tsfg_aot_str_compare(ctx: ?*StringAotContext, a_id: u64, b_id: u64, start: u32, end: u32) i32 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0) return 0;
    const a = c.getHandle(a_id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    const b = c.getHandle(b_id) orelse {
        c.setTrap(3, start, end);
        return 0;
    };
    const ord = c.owner.heap.compareStrings(a, b) catch {
        c.setTrap(3, start, end);
        return 0;
    };
    return switch (ord) {
        .lt => -1,
        .eq => 0,
        .gt => 1,
    };
}

export fn tsfg_aot_str_global_store(ctx: ?*StringAotContext, slot: u32, id: u64, init_flag: u32) void {
    const c = ctx orelse return;
    if (c.trap_code != 0 or slot >= c.globals.len) return;
    const h = c.getHandle(id) orelse {
        c.setTrap(3, 0, 0);
        return;
    };
    const retained = c.owner.heap.retain(h, .persistent) catch {
        c.setTrap(3, 0, 0);
        return;
    };
    if (c.globals[slot]) |old| {
        c.owner.heap.release(old) catch {};
    }
    c.globals[slot] = retained;
    if (init_flag != 0) c.global_init[slot] = true;
}

export fn tsfg_aot_str_global_load(ctx: ?*StringAotContext, slot: u32, start: u32, end: u32) u64 {
    const c = ctx orelse return 0;
    if (c.trap_code != 0 or slot >= c.globals.len) return 0;
    if (!c.global_init[slot] or c.globals[slot] == null) {
        c.setTrap(4, start, end);
        return 0;
    }
    const retained = c.owner.heap.retain(c.globals[slot].?, .persistent) catch {
        c.setTrap(3, start, end);
        return 0;
    };
    return c.allocId(retained) catch {
        c.owner.heap.release(retained) catch {};
        c.setTrap(3, start, end);
        return 0;
    };
}

/// Trigger real moving GC compaction on the underlying ManagedHeap.
export fn tsfg_aot_str_gc_collect(ctx: ?*StringAotContext) i32 {
    const c = ctx orelse return 0;
    c.owner.heap.collect() catch return 0;
    return 1;
}

/// Export a string handle through the production `string-output.Lease` (strict or lossy UTF-8).
/// Returns: 0 = ok, 1 = r05-string-invalid-utf8, 2 = error/buffer too small.
export fn tsfg_aot_str_export_utf8(
    ctx: ?*StringAotContext,
    id: u64,
    strict: u32,
    out_buf: [*]u8,
    out_cap: usize,
    out_len: *usize,
) i32 {
    const c = ctx orelse return 2;
    const h = c.getHandle(id) orelse return 2;
    var s = values.String.retain(c.owner, h) catch return 2;
    defer s.deinit();

    var lease: output.Lease = .{};
    defer lease.end() catch {};
    const mode: output.Mode = if (strict != 0) .strict else .lossy;
    const tok = lease.begin(c.allocator, s, mode, out_cap) catch |err| {
        return if (err == error.InvalidUtf8) 1 else 2;
    };
    const blen = lease.byteLength(tok) catch return 2;
    if (blen > out_cap) return 2;
    for (0..blen) |i| {
        out_buf[i] = lease.readByte(tok, i) catch return 2;
    }
    out_len.* = blen;
    return 0;
}
