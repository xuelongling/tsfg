// SPDX-License-Identifier: MIT
//! Comprehensive R06 Zig Runtime, Incremental Generational GC, Handle<T>,
//! ValueArena, CapabilityTable, ModuleRegistry, OOM, AOT StackMap, and
//! Multi-Threaded Concurrent Safepoint Test Suite.
const std = @import("std");
const gc_mod = @import("r06-gen-gc.zig");
const rt_mod = @import("r06-runtime.zig");
const proto = @import("r04-protocols.zig");

test "R06 GenGC: young relocation, old promotion & pinning, write barrier remembered set, and incremental major mark/sweep" {
    const alloc = std.testing.allocator;
    const rt = try rt_mod.R06Runtime.create(alloc, 1024 * 1024, 4096);
    defer rt.destroy();

    // 1. Allocate young object wrapped in generation-checked Handle<T>
    const h_parent = try rt.allocManagedHandle(101, .class_instance, 2, 1);
    const p0 = try rt.handles.resolve(h_parent, 101);
    p0.scalars[0] = 0xCAFE;
    const addr_y0 = @intFromPtr(p0);
    try std.testing.expectEqual(gc_mod.Generation.young, p0.generation);

    // 2. Minor GC #1: young object MUST genuinely relocate to a brand-new address!
    try rt.gc.collectMinor();
    const p1 = try rt.handles.resolve(h_parent, 101);
    const addr_y1 = @intFromPtr(p1);
    try std.testing.expect(addr_y1 != addr_y0);
    try std.testing.expectEqual(@as(u64, 0xCAFE), p1.scalars[0]);
    try std.testing.expectEqual(gc_mod.Generation.young, p1.generation);

    // 3. Minor GC #2: reaches promotion_age (2) -> promotes to NON-MOVING old generation!
    try rt.gc.collectMinor();
    const p_old = try rt.handles.resolve(h_parent, 101);
    const addr_old = @intFromPtr(p_old);
    try std.testing.expectEqual(gc_mod.Generation.old, p_old.generation);
    try std.testing.expectEqual(@as(u64, 0xCAFE), p_old.scalars[0]);

    // 4. Allocate young child and write Old -> Young edge through write barrier (Remembered Set)
    const child_raw = try rt.gc.alloc(202, .class_instance, 1, 0);
    child_raw.scalars[0] = 777;
    const child_addr0 = @intFromPtr(child_raw);
    try rt.gc.writeEdge(p_old, 0, child_raw);
    try std.testing.expect(p_old.in_remembered_set);
    try std.testing.expect(rt.gc.stats.write_barriers_fired >= 1);

    // 5. Minor GC #3: old parent MUST stay pinned at `addr_old`; young child MUST relocate & remain reachable via remembered set!
    try rt.gc.collectMinor();
    const p_old_after = try rt.handles.resolve(h_parent, 101);
    try std.testing.expectEqual(addr_old, @intFromPtr(p_old_after)); // Old gen is PINNED!
    const child_after = p_old_after.edges[0].?;
    try std.testing.expect(@intFromPtr(child_after) != child_addr0); // Young child RELOCATED!
    try std.testing.expectEqual(@as(u64, 777), child_after.scalars[0]);

    // 6. Allocate unreachable garbage old object + run incremental tri-color major marking in bounded steps
    const h_dead = try rt.allocManagedHandle(303, .class_instance, 1, 0);
    try rt.gc.collectMinor();
    try rt.gc.collectMinor(); // promotes h_dead to old gen
    try rt.handles.release(h_dead);
    // Stale handle MUST fail immediately with StaleHandle!
    try std.testing.expectError(error.StaleHandle, rt.handles.resolve(h_dead, 303));
    // Type mismatch MUST fail with HandleTypeMismatch!
    try std.testing.expectError(error.HandleTypeMismatch, rt.handles.resolve(h_parent, 999));

    const old_before = rt.gc.stats.old_count;
    try rt.gc.beginMajorMark();
    var steps: usize = 0;
    while (!(try rt.gc.incrementalMarkStep(1))) : (steps += 1) {
        try std.testing.expect(steps < 1000);
    }
    try std.testing.expect(rt.gc.stats.old_count < old_before);
    try std.testing.expectEqual(addr_old, @intFromPtr(try rt.handles.resolve(h_parent, 101)));
}

test "R06 AOT StackMap safepoint relocation + inactive union scalar slot untouched" {
    const alloc = std.testing.allocator;
    var gc = gc_mod.GenGc.init(alloc, 1024 * 1024);
    defer gc.deinit();

    const roots_desc = [_]proto.RootEntry{
        .{ .kind = "live_ref", .slotOffset = 0, .tagOffset = -1 },
        .{ .kind = "nullable_ref", .slotOffset = 8, .tagOffset = -1 },
        .{ .kind = "union_active_ref", .slotOffset = 24, .tagOffset = 16 },
        .{ .kind = "union_active_ref", .slotOffset = 40, .tagOffset = 32 },
    };
    const sp_entries = [_]proto.SafepointEntry{
        .{ .frameSize = 48, .pcOffset = 12, .roots = &roots_desc },
    };
    try gc.registerAotStackMap(0xABCD, &sp_entries);

    const o1 = try gc.alloc(10, .class_instance, 1, 0);
    o1.scalars[0] = 111;
    const o2 = try gc.alloc(20, .class_instance, 1, 0);
    o2.scalars[0] = 222;
    const o1_before = @intFromPtr(o1);
    const o2_before = @intFromPtr(o2);

    var frame: [48]u8 align(8) = [_]u8{0} ** 48;
    // slot 0: live_ref = o1
    std.mem.writeInt(usize, frame[0..8], o1_before, .little);
    // slot 8: nullable_ref = null (0)
    std.mem.writeInt(usize, frame[8..16], 0, .little);
    // slot 24: union_active_ref with tag=5 (ref active!) = o2
    std.mem.writeInt(u16, frame[16..18], 5, .little);
    std.mem.writeInt(usize, frame[24..32], o2_before, .little);
    // slot 40: union_active_ref with tag=3 (i32 scalar active!) = 0xDEADBEEF (MUST NOT be traced!)
    std.mem.writeInt(u16, frame[32..34], 3, .little);
    std.mem.writeInt(usize, frame[40..48], 0xDEADBEEF, .little);

    try gc.collectAtAotSafepoint(0xABCD, 12, &frame);

    const o1_after = std.mem.readInt(usize, frame[0..8], .little);
    const null_after = std.mem.readInt(usize, frame[8..16], .little);
    const o2_after = std.mem.readInt(usize, frame[24..32], .little);
    const scalar_after = std.mem.readInt(usize, frame[40..48], .little);

    try std.testing.expect(o1_after != o1_before);
    try std.testing.expectEqual(@as(u64, 111), @as(*gc_mod.GcObject, @ptrFromInt(o1_after)).scalars[0]);
    try std.testing.expectEqual(@as(usize, 0), null_after);
    try std.testing.expect(o2_after != o2_before);
    try std.testing.expectEqual(@as(u64, 222), @as(*gc_mod.GcObject, @ptrFromInt(o2_after)).scalars[0]);
    try std.testing.expectEqual(@as(usize, 0xDEADBEEF), scalar_after);
}

test "R06 ValueArena, strict UTF-8 StringView, CapabilityTable, ModuleRegistry, and Hard OOM" {
    const alloc = std.testing.allocator;
    // Tiny heap budget (1024 bytes) to trigger real OOM without corrupting live handle!
    const rt = try rt_mod.R06Runtime.create(alloc, 1024, 128);
    defer rt.destroy();

    // 1. ValueArena
    const s1 = try rt.arena.allocSlice(i32, 16); // 64 bytes
    s1[0] = 42;
    try std.testing.expectError(error.ArenaOverflow, rt.arena.allocSlice(i32, 32)); // 128 bytes > remaining
    rt.arena.reset();
    const s2 = try rt.arena.allocSlice(i32, 16);
    try std.testing.expectEqual(@intFromPtr(s1.ptr), @intFromPtr(s2.ptr));

    // 2. Strict UTF-8 StringView
    const sv_ok = try rt_mod.StringView.fromStrictUtf8("hello-tsfg");
    try std.testing.expectEqualStrings("hello-tsfg", sv_ok.slice());
    try std.testing.expectError(error.InvalidUtf8, rt_mod.StringView.fromStrictUtf8(&.{ 0xFF, 0xFE }));

    // 3. CapabilityTable
    var host_acc: i64 = 10;
    const cb = struct {
        fn add(ctx: *anyopaque, a: i64, b: i64) i64 {
            const p: *i64 = @ptrCast(@alignCast(ctx));
            p.* += a + b;
            return p.*;
        }
    }.add;
    try std.testing.expectError(error.CapabilityDenied, rt.capabilities.invoke(7, 1, 2));
    try rt.capabilities.grant(7, "host.counter", &host_acc, &cb);
    try std.testing.expectEqual(@as(i64, 15), try rt.capabilities.invoke(7, 2, 3));
    rt.capabilities.revoke(7);
    try std.testing.expectError(error.CapabilityDenied, rt.capabilities.invoke(7, 1, 2));

    // 4. ModuleRegistry lifecycle & active frame guard
    const mod_id = [_]u8{1} ** 32;
    const schema_id = [_]u8{2} ** 32;
    const blk = try rt.modules.loadModule(mod_id, schema_id, 1, 4);
    try std.testing.expectError(error.ModuleAlreadyLoaded, rt.modules.loadModule(mod_id, schema_id, 1, 4));
    blk.active_frames = 1;
    try std.testing.expectError(error.ModuleBusy, rt.modules.unloadModule(mod_id));
    blk.active_frames = 0;
    try rt.modules.unloadModule(mod_id);
    try std.testing.expectError(error.ModuleNotFound, rt.modules.unloadModule(mod_id));

    // 5. Hard OOM preserves previously allocated live handle intact!
    const h_live = try rt.allocManagedHandle(55, .class_instance, 2, 0);
    (try rt.handles.resolve(h_live, 55)).scalars[0] = 9876;
    try std.testing.expectError(error.OutOfMemory, rt.allocManagedHandle(55, .class_instance, 200, 0));
    try std.testing.expectEqual(@as(u64, 9876), (try rt.handles.resolve(h_live, 55)).scalars[0]);
}

test "R06 Multi-Threaded Concurrent Safepoint Coordinator (4 mutators + GC STW pauses)" {
    var coord = gc_mod.SafepointCoordinator.init(4);
    var stop_mutators = std.atomic.Value(bool).init(false);
    var mutator_iters = std.atomic.Value(u64).init(0);

    const Worker = struct {
        fn run(c: *gc_mod.SafepointCoordinator, stop: *std.atomic.Value(bool), iters: *std.atomic.Value(u64)) void {
            while (!stop.load(.acquire)) {
                c.pollSafepoint();
                _ = iters.fetchAdd(1, .monotonic);
            }
        }
    };

    var threads: [4]std.Thread = undefined;
    for (&threads) |*th| {
        th.* = try std.Thread.spawn(.{}, Worker.run, .{ &coord, &stop_mutators, &mutator_iters });
    }

    // Trigger 8 real Stop-The-World safepoint pauses while all 4 mutators spin!
    var stw_count: u32 = 0;
    const Callback = struct {
        fn onPause(cnt: *u32) !void {
            cnt.* += 1;
        }
    };
    for (0..8) |_| {
        try coord.stopTheWorld(&stw_count, Callback.onPause);
    }

    stop_mutators.store(true, .release);
    for (&threads) |*th| th.join();

    try std.testing.expectEqual(@as(u32, 8), stw_count);
    try std.testing.expect(coord.safepoints_hit.load(.acquire) >= 32);
    try std.testing.expect(mutator_iters.load(.acquire) > 0);
}
