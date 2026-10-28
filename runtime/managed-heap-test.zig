// SPDX-License-Identifier: MIT
// Standalone entry point: imports only std and the production managed heap.
const std = @import("std");
const managed = @import("managed-heap.zig");
const Heap = managed.ManagedHeap;
const Handle = managed.Handle;
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const expectError = std.testing.expectError;

// Physical addresses are observed only inside this collector test. The host
// interface returns scalar snapshots and Handles, never these Object pointers.
fn address(heap: *Heap, handle: Handle) usize {
    return managed.testing.location(heap, handle) catch unreachable;
}

fn verifyGraph(heap: *Heap, a: Handle, b: Handle) !void {
    const first = (try heap.retainEdge(a, 0, .persistent)).?;
    defer heap.release(first) catch unreachable;
    const second = (try heap.retainEdge(a, 1, .persistent)).?;
    defer heap.release(second) catch unreachable;
    const back = (try heap.retainEdge(b, 0, .persistent)).?;
    defer heap.release(back) catch unreachable;
    try expect(try heap.sameObject(first, b));
    try expect(try heap.sameObject(first, second));
    try expect(try heap.sameObject(back, a));
    try equal(@as(u64, 21), (try heap.read(b, 200)).scalar);
}

test "copying collector rewrites actual roots and shared cyclic object edges" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const a = try heap.create(100, 10, 2, .persistent);
    const b = try heap.create(200, 20, 1, .persistent);
    const alias = try heap.retain(a, .persistent);
    try heap.setEdge(a, 0, b);
    try heap.setEdge(a, 1, b);
    try heap.setEdge(b, 0, a);
    try heap.write(b, 200, 21);
    const a_identity = (try heap.read(a, 100)).identity;
    const b_identity = (try heap.read(b, 200)).identity;
    var previous_a = address(&heap, a);
    var previous_b = address(&heap, b);
    for (0..3) |_| {
        try heap.collect();
        try expect(previous_a != address(&heap, a));
        try expect(previous_b != address(&heap, b));
        try equal(address(&heap, a), address(&heap, alias));
        try equal(address(&heap, b), (try managed.testing.edgeLocation(&heap, a, 0)).?);
        try equal(address(&heap, a), (try managed.testing.edgeLocation(&heap, b, 0)).?);
        try equal(a_identity, (try heap.read(a, 100)).identity);
        try equal(b_identity, (try heap.read(b, 200)).identity);
        try verifyGraph(&heap, a, b);
        previous_a = address(&heap, a);
        previous_b = address(&heap, b);
    }
    try heap.write(alias, 100, 11);
    try equal(@as(u64, 11), (try heap.read(a, 100)).scalar);
    try expectError(error.TypeMismatch, heap.read(a, 200));
    try expectError(error.TypeMismatch, heap.write(a, 200, 999));
    try expectError(error.InvalidField, heap.setEdge(a, 2, b));
}

test "edges retain objects after handles release and unreachable cycles are reclaimed" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const a = try heap.create(1, 0, 1, .persistent);
    const b = try heap.create(1, 0, 1, .persistent);
    const garbage = try heap.create(2, 0, 0, .persistent);
    try heap.setEdge(a, 0, b);
    try heap.setEdge(b, 0, a);
    try heap.release(b);
    try heap.release(garbage);
    try heap.collect();
    try equal(@as(usize, 2), try heap.objectCount());
    const edge = (try heap.retainEdge(a, 0, .persistent)).?;
    try equal(@as(u64, 1), (try heap.read(edge, 1)).type_id);
    try heap.release(edge);
    try heap.release(a);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

fn failedRequest(heap: *Heap, persistent: Handle, temporary_out: *Handle) !void {
    const scope = try heap.beginScope();
    defer heap.endScope(scope) catch unreachable;
    temporary_out.* = try heap.retain(persistent, .temporary);
    _ = try heap.create(2, 0, 0, .temporary);
    return error.SimulatedRequestAbort;
}

test "request scopes clean temporary roots on success and error and preserve persistent roots" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    try expectError(error.ScopeRequired, heap.create(1, 0, 0, .temporary));
    const outer = try heap.beginScope();
    const temporary = try heap.create(1, 10, 0, .temporary);
    const persistent = try heap.retain(temporary, .persistent);
    const inner = try heap.beginScope();
    const nested = try heap.retain(temporary, .temporary);
    try expectError(error.InvalidScope, heap.endScope(outer));
    var forged = inner;
    forged.parent = 0;
    try expectError(error.InvalidScope, heap.endScope(forged));
    forged.parent = inner.serial;
    try expectError(error.InvalidScope, heap.endScope(forged));
    forged = inner;
    forged.owner += 1;
    try expectError(error.InvalidScope, heap.endScope(forged));
    try heap.endScope(inner);
    try expectError(error.InvalidHandle, heap.read(nested, 1));
    try equal(@as(u64, 10), (try heap.read(temporary, 1)).scalar);
    try heap.endScope(outer);
    try expectError(error.InvalidScope, heap.endScope(outer));
    try expectError(error.InvalidHandle, heap.read(temporary, 1));
    var failed_temporary: Handle = undefined;
    try expectError(error.SimulatedRequestAbort, failedRequest(&heap, persistent, &failed_temporary));
    try expectError(error.InvalidHandle, heap.read(failed_temporary, 1));
    try heap.collect();
    try equal(@as(usize, 1), try heap.objectCount());
    try equal(@as(u64, 10), (try heap.read(persistent, 1)).scalar);
    const next = try heap.beginScope();
    try heap.endScope(next);
    try heap.release(persistent);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "handles reject wrong heap slot generation released and destroyed ownership" {
    var left = Heap.init(std.testing.allocator);
    var right = Heap.init(std.testing.allocator);
    defer right.deinit() catch unreachable;
    const old = try left.create(1, 8, 0, .persistent);
    const other = try right.create(1, 9, 1, .persistent);
    try expectError(error.InvalidHandle, right.read(old, 1));
    try expectError(error.InvalidHandle, right.setEdge(other, 0, old));
    var bad = old;
    bad.slot = std.math.maxInt(usize);
    try expectError(error.InvalidHandle, left.read(bad, 1));
    bad = old;
    bad.generation += 1;
    try expectError(error.InvalidHandle, left.release(bad));
    try left.release(old);
    try expectError(error.InvalidHandle, left.release(old));
    const replacement = try left.create(1, 10, 0, .persistent);
    try equal(old.slot, replacement.slot);
    try expect(old.generation != replacement.generation);
    try expectError(error.InvalidHandle, left.read(old, 1));
    var copy = left;
    try expectError(error.InvalidOwner, copy.read(replacement, 1));
    try expectError(error.InvalidOwner, copy.deinit());
    try left.deinit();
    try expectError(error.HeapDestroyed, left.read(replacement, 1));
    try expectError(error.HeapDestroyed, left.deinit());
    try expectError(error.InvalidOwner, copy.deinit());
    // Reinitializing the same wrapper address cannot revive the old owner ID.
    left = Heap.init(std.testing.allocator);
    defer left.deinit() catch unreachable;
    const fresh = try left.create(1, 12, 0, .persistent);
    try expect(fresh.owner != replacement.owner);
    try expectError(error.InvalidHandle, left.read(replacement, 1));
}

test "generation wrap retires the slot and identity scope exhaustion cannot wrap" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const old = try heap.create(1, 0, 0, .persistent);
    // White-box boundary injection avoids an impossible 2^64 release loop.
    const final = try managed.testing.forceGeneration(&heap, old, std.math.maxInt(u64));
    try heap.release(final);
    const fresh = try heap.create(1, 0, 0, .persistent);
    try expect(fresh.slot != old.slot);
    try expectError(error.InvalidHandle, heap.read(old, 1));
    try expectError(error.InvalidHandle, heap.read(final, 1));
    heap.next_identity = std.math.maxInt(u64);
    try expectError(error.IdentityExhausted, heap.create(1, 0, 0, .persistent));
    heap.next_scope = std.math.maxInt(u64);
    try expectError(error.IdentityExhausted, heap.beginScope());
    try equal(@as(u64, 0), (try heap.read(fresh, 1)).scalar);
}

const Operation = enum { create, retain, edge, collect };
fn attempt(heap: *Heap, operation: Operation, a: Handle) !void {
    switch (operation) {
        .create => _ = try heap.create(300, 30, 2, .persistent),
        .retain => _ = try heap.retain(a, .persistent),
        .edge => _ = try heap.retainEdge(a, 0, .persistent),
        .collect => try heap.collect(),
    }
}

fn allocationFailures(operation: Operation) !void {
    var reached_success = false;
    for (0..32) |fail_offset| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        var heap = Heap.init(failing.allocator());
        var live = true;
        defer if (live) heap.deinit() catch unreachable;
        const a = try heap.create(100, 10, 2, .persistent);
        const b = try heap.create(200, 21, 1, .persistent);
        const garbage = try heap.create(300, 0, 0, .persistent);
        try heap.setEdge(a, 0, b);
        try heap.setEdge(a, 1, b);
        try heap.setEdge(b, 0, a);
        try heap.release(garbage);
        // Fill all root slots so root creation/retain must grow the real table.
        _ = try heap.retain(a, .persistent);
        while (true) {
            const stats = try managed.testing.rootStats(&heap);
            if (stats.count == stats.capacity) break;
            _ = try heap.retain(a, .persistent);
        }
        const old_a = address(&heap, a);
        const old_b = address(&heap, b);
        const identity_a = (try heap.read(a, 100)).identity;
        const identity_b = (try heap.read(b, 200)).identity;
        const before_count = try heap.objectCount();
        const before_roots = (try managed.testing.rootStats(&heap)).count;
        failing.fail_index = failing.alloc_index + fail_offset;
        failing.resize_fail_index = failing.resize_index;
        var failed = false;
        attempt(&heap, operation, a) catch |err| {
            try expect(err == error.OutOfMemory);
            failed = true;
        };
        failing.fail_index = std.math.maxInt(usize);
        failing.resize_fail_index = std.math.maxInt(usize);
        if (failed) {
            try equal(old_a, address(&heap, a));
            try equal(old_b, address(&heap, b));
            try equal(before_count, try heap.objectCount());
            try equal(before_roots, (try managed.testing.rootStats(&heap)).count);
        } else reached_success = true;
        try equal(identity_a, (try heap.read(a, 100)).identity);
        try equal(identity_b, (try heap.read(b, 200)).identity);
        try verifyGraph(&heap, a, b);
        // The same heap continues to mutate and collect after every injected OOM.
        try heap.write(a, 100, 11);
        try heap.collect();
        try verifyGraph(&heap, a, b);
        try heap.deinit();
        live = false;
        try equal(failing.allocated_bytes, failing.freed_bytes);
        if (reached_success) break;
    }
    try expect(reached_success);
}

test "every create retain edge-retain and moving collection allocation fails transactionally" {
    inline for (.{ Operation.create, Operation.retain, Operation.edge, Operation.collect }) |operation| {
        try allocationFailures(operation);
    }
}

fn allAllocationPaths(allocator: std.mem.Allocator) !void {
    var heap = Heap.init(allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    defer heap.endScope(scope) catch unreachable;
    var first: ?Handle = null;
    for (0..40) |index| {
        const handle = try heap.create(1, index, 1, .temporary);
        if (first) |prior| try heap.setEdge(handle, 0, prior);
        first = handle;
    }
    const nested = try heap.beginScope();
    defer heap.endScope(nested) catch unreachable;
    const retained = try heap.retain(first.?, .persistent);
    _ = try heap.retainEdge(retained, 0, .persistent);
    try heap.collect();
}

test "all allocator failure paths release every allocation" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allAllocationPaths, .{});
}

test "empty request scope allocates nothing and nested scope OOM preserves parent" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    var heap = Heap.init(failing.allocator());
    const empty = try heap.beginScope();
    try heap.endScope(empty);
    try equal(@as(usize, 0), failing.allocations);
    failing.fail_index = std.math.maxInt(usize);
    const parent = try heap.beginScope();
    const temporary = try heap.create(1, 33, 0, .temporary);
    failing.fail_index = failing.alloc_index;
    failing.resize_fail_index = failing.resize_index;
    try expectError(error.OutOfMemory, heap.beginScope());
    try equal(@as(u64, 33), (try heap.read(temporary, 1)).scalar);
    failing.fail_index = std.math.maxInt(usize);
    failing.resize_fail_index = std.math.maxInt(usize);
    const child = try heap.beginScope();
    try heap.endScope(child);
    try heap.endScope(parent);
    try expectError(error.InvalidHandle, heap.read(temporary, 1));
    try heap.deinit();
    try equal(failing.allocated_bytes, failing.freed_bytes);
}
