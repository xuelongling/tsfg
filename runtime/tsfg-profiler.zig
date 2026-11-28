// SPDX-License-Identifier: MIT
//! Real Windows x64 High-Resolution Runtime Profiler & Chrome Trace Event Collector.
//! Uses Win32 `QueryPerformanceCounter` / `QueryPerformanceFrequency` to capture real
//! microsecond timestamps and durations across GC, VM, AOT, Hot-Reload, ECS/Jobs, and Vulkan GPU.
const std = @import("std");

extern "kernel32" fn QueryPerformanceCounter(lpPerformanceCount: *i64) callconv(.winapi) c_int;
extern "kernel32" fn QueryPerformanceFrequency(lpFrequency: *i64) callconv(.winapi) c_int;
extern "kernel32" fn GetCurrentThreadId() callconv(.winapi) u32;
extern "kernel32" fn GetCurrentProcessId() callconv(.winapi) u32;

pub fn nowTicks() i64 {
    var v: i64 = 0;
    _ = QueryPerformanceCounter(&v);
    return v;
}

pub fn ticksPerSecond() i64 {
    var f: i64 = 1;
    _ = QueryPerformanceFrequency(&f);
    return if (f > 0) f else 1;
}

pub fn ticksToUs(delta_ticks: i64) u64 {
    if (delta_ticks <= 0) return 0;
    const freq = ticksPerSecond();
    return @intCast(@divTrunc(@as(i128, delta_ticks) * 1_000_000, freq));
}

pub const TraceEvent = struct {
    category: []const u8,
    name: []const u8,
    ts_us: u64,
    dur_us: u64,
    pid: u32,
    tid: u32,
    detail_i64: i64 = 0,
};

const SpinLock = struct {
    state: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    fn lock(self: *SpinLock) void {
        while (self.state.cmpxchgWeak(0, 1, .acquire, .monotonic) != null) {
            std.atomic.spinLoopHint();
        }
    }
    fn unlock(self: *SpinLock) void {
        self.state.store(0, .release);
    }
};

pub const TraceRecorder = struct {
    allocator: std.mem.Allocator,
    enabled: bool = false,
    origin_ticks: i64 = 0,
    max_events: usize = 4096,
    lock: SpinLock = .{},
    events: std.ArrayListUnmanaged(TraceEvent) = .empty,

    pub fn init(allocator: std.mem.Allocator, enabled: bool) TraceRecorder {
        return .{
            .allocator = allocator,
            .enabled = enabled,
            .origin_ticks = nowTicks(),
        };
    }

    pub fn deinit(self: *TraceRecorder) void {
        self.events.deinit(self.allocator);
    }

    pub fn setEnabled(self: *TraceRecorder, enabled: bool) void {
        self.lock.lock();
        defer self.lock.unlock();
        if (enabled and !self.enabled) {
            self.origin_ticks = nowTicks();
        }
        self.enabled = enabled;
    }

    pub fn beginScope(self: *const TraceRecorder) i64 {
        if (!self.enabled) return 0;
        return nowTicks();
    }

    pub fn endScope(self: *TraceRecorder, start_ticks: i64, category: []const u8, name: []const u8, detail_i64: i64) void {
        if (!self.enabled or start_ticks == 0) return;
        const end_ticks = nowTicks();
        self.recordTicks(start_ticks, end_ticks, category, name, detail_i64);
    }

    pub fn recordTicks(self: *TraceRecorder, start_ticks: i64, end_ticks: i64, category: []const u8, name: []const u8, detail_i64: i64) void {
        self.lock.lock();
        defer self.lock.unlock();
        if (!self.enabled) return;
        if (self.events.items.len >= self.max_events) return;
        const ev = TraceEvent{
            .category = category,
            .name = name,
            .ts_us = ticksToUs(start_ticks - self.origin_ticks),
            .dur_us = ticksToUs(end_ticks - start_ticks),
            .pid = GetCurrentProcessId(),
            .tid = GetCurrentThreadId(),
            .detail_i64 = detail_i64,
        };
        self.events.append(self.allocator, ev) catch {};
    }

    pub fn toChromeTraceJsonAlloc(self: *TraceRecorder, allocator: std.mem.Allocator) ![]u8 {
        self.lock.lock();
        defer self.lock.unlock();
        var out: std.ArrayListUnmanaged(u8) = .empty;
        errdefer out.deinit(allocator);
        try out.appendSlice(allocator, "{\"traceEvents\":[");
        for (self.events.items, 0..) |ev, i| {
            if (i > 0) try out.append(allocator, ',');
            try out.print(
                allocator,
                "{{\"cat\":\"{s}\",\"name\":\"{s}\",\"ph\":\"X\",\"ts\":{d},\"dur\":{d},\"pid\":{d},\"tid\":{d},\"args\":{{\"detail\":{d}}}}}",
                .{ ev.category, ev.name, ev.ts_us, ev.dur_us, ev.pid, ev.tid, ev.detail_i64 },
            );
        }
        try out.appendSlice(allocator, "]}");
        return out.toOwnedSlice(allocator);
    }
};
