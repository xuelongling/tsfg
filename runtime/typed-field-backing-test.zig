// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const backing = @import("typed-field-backing.zig");
const allocator = std.testing.allocator;
const file = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures/wide-backing.bin";
fn bytes() ![]u8 { return std.Io.Dir.cwd().readFileAlloc(std.testing.io, file, allocator, .limited(2097152)); }

test "Source field value copy uses static i32 provenance while retaining active undefined" {
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io,
        "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures/copy.bin", allocator, .limited(2097152));
    defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = module.authority.views[0]; const pair = view.fields[0]; const row = try module.cell(view.actual);
    const absent = row.fields[0].domain.members[0];
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    const object = try module.create(&heap, view.actual, .temporary);
    try module.write(&heap, object, view.target, pair.target, absent, .{ .bytes = &.{}, .references = &.{} });
    var captured = try module.read(&heap, object, view.actual, pair.source, .temporary); defer captured.deinit(allocator);
    try std.testing.expectEqual(.undefined_value, (try captured.layout.selectVariant(captured.value.tag)).kind);
    const copied = try module.capture(&heap, object, view.actual, pair.source); defer module.release(copied) catch unreachable;
    const wide_value = try module.capture(&heap, object, view.target, pair.target); defer module.release(wide_value) catch unreachable;
    try std.testing.expectError(error.TypeMismatch, module.copy(&heap, object, view.actual, pair.source, wide_value));
    try std.testing.expectError(error.TypeMismatch, module.write(&heap, object, view.actual, pair.source, absent,
        .{ .bytes = &.{}, .references = &.{} }));
    try module.copy(&heap, object, view.actual, pair.source, copied);
    var result = try module.read(&heap, object, view.actual, pair.source, .temporary); defer result.deinit(allocator);
    try std.testing.expectEqual(.undefined_value, (try result.layout.selectVariant(result.value.tag)).kind);
}

test "Source wider field write and original narrow alias retain actual absence across moving GC" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = module.authority.views[0]; const pair = view.fields[0];
    const contract = try module.cell(view.actual);
    const field = contract.fields[0];
    try std.testing.expectEqual(@as(u32, 4), contract.declared.fields[0].layout.byte_size);
    try std.testing.expectEqual(@as(u32, 8), contract.backing.fields[0].layout.byte_size);
    try std.testing.expect(!std.mem.eql(u8, &field.semantic_type, &field.domain.id));
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const object = try module.create(&heap, view.actual, .persistent);
    const alias = try heap.retain(object, .persistent);
    try std.testing.expectError(error.UninitializedField, module.read(&heap, object, view.actual, pair.source, .persistent));
    // Canonical concrete payloads enter the production encoder, which chooses
    // backing tags and offsets. No numeric tag from another layout is reused.
    try module.write(&heap, object, view.actual, pair.source, field.semantic_type,
        .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{} });
    const undefined_id = field.domain.members[0];
    try std.testing.expectEqual(.undefined_value, (try module.authority.layouts.find(undefined_id)).layout.variants[0].kind);
    try module.write(&heap, alias, view.target, pair.target, undefined_id, .{ .bytes = &.{}, .references = &.{} });
    try heap.collect();
    var read = try module.read(&heap, object, view.actual, pair.source, .temporary); defer read.deinit(allocator);
    try std.testing.expectEqual(.undefined_value, (try read.layout.selectVariant(read.value.tag)).kind);
    try std.testing.expect(try heap.sameObject(object, alias));
    const header = try heap.copyTypedCellLayout(object); defer header.deinit(allocator);
    try std.testing.expect(contract.backing.same(header));
    try std.testing.expectEqualSlices(u8, &contract.declared.runtime_key, &header.runtime_key);
    try std.testing.expectError(error.TypeMismatch, heap.readTypedField(object, contract.declared, pair.source, .temporary));
    try module.write(&heap, alias, view.target, pair.target, field.semantic_type,
        .{ .bytes = &.{ 7, 0, 0, 0 }, .references = &.{} });
    try heap.collect();
    var native = try module.read(&heap, object, view.actual, pair.source, .temporary); defer native.deinit(allocator);
    const child = (try native.layout.selectVariant(native.value.tag)).children[0];
    try std.testing.expectEqual(@as(i32, 7), std.mem.readInt(i32, native.value.bytes[child.offset..][0..4], .little));
    try heap.release(object); try heap.release(alias); try heap.collect();
    try std.testing.expectEqual(@as(usize, 0), try heap.objectCount());
}

test "backing reader rejects corrupt domain identity and owns all allocation failures" {
    const raw = try bytes(); defer allocator.free(raw);
    const corrupt = try allocator.dupe(u8, raw); defer allocator.free(corrupt);
    const authority_size = std.mem.readInt(u32, corrupt[8..12], .little);
    const domain_start = 12 + authority_size + 2 + 32 + 2 + 32;
    corrupt[domain_start + 31] ^= 1;
    try std.testing.expectError(error.InvalidViewModule, backing.load(allocator, corrupt));
    var failures: usize = 0;
    for (0..512) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{}); failing.fail_index = offset;
        var module = backing.load(failing.allocator(), raw) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err); failures += 1; continue;
        };
        module.deinit(); try std.testing.expect(failures > 0); break;
    } else return error.NoSuccessfulAttempt;
}

test "Source backing active cell roots survive alias GC and undefined overwrite releases their edges" {
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io,
        "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures/references.bin", allocator, .limited(2097152));
    defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = for (module.authority.views) |value| {
        if (value.fields.len == 1) {
            const row = try module.cell(value.actual);
            if (row.backing.reference_count == 1) break value;
        }
    } else return error.MissingReferenceFixture;
    const parent = try module.cell(view.actual); const pair = view.fields[0]; const field = parent.fields[0];
    const child_type = for (field.domain.members) |id| {
        const entry = try module.authority.layouts.find(id);
        if (entry.cell != null and entry.cell.?.kind == .reference) break id;
    } else return error.MissingChildFixture;
    const absence = for (field.domain.members) |id| {
        if ((try module.authority.layouts.find(id)).layout.variants[0].kind == .undefined_value) break id;
    } else return error.MissingAbsenceFixture;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const scope = try heap.beginScope();
    const object = try module.create(&heap, view.actual, .persistent);
    const child = try module.create(&heap, child_type, .temporary);
    try module.write(&heap, object, view.actual, pair.source, child_type, .{ .bytes = &.{}, .references = &.{child} });
    try heap.endScope(scope); try heap.collect();
    try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
    const read_scope = try heap.beginScope();
    var read = try module.read(&heap, object, view.actual, pair.source, .temporary); defer read.deinit(allocator);
    try std.testing.expect(read.value.references[0] != null);
    const saved = try module.capture(&heap, object, view.actual, pair.source);
    try module.write(&heap, object, view.actual, pair.source, absence, .{ .bytes = &.{}, .references = &.{} });
    try heap.endScope(read_scope); try heap.collect();
    try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
    try module.copy(&heap, object, view.actual, pair.source, saved);
    try module.release(saved); try heap.collect();
    try std.testing.expectEqual(@as(usize, 2), try heap.objectCount());
    try module.write(&heap, object, view.actual, pair.source, absence, .{ .bytes = &.{}, .references = &.{} });
    try heap.collect();
    try std.testing.expectEqual(@as(usize, 1), try heap.objectCount());
    try heap.release(object); try heap.collect();
    try std.testing.expectEqual(@as(usize, 0), try heap.objectCount());
}

test "captured Source value allocation and copy OOM never lose the old field or publish stray roots" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = module.authority.views[0]; const pair = view.fields[0]; const row = try module.cell(view.actual);
    const absent = row.fields[0].domain.members[0];
    inline for (.{ false, true }) |copying| {
        var failures: usize = 0;
        for (0..128) |offset| {
            var failing = std.testing.FailingAllocator.init(allocator, .{});
            var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
            try heap.installTypedLayouts(module.authority.layouts);
            const object = try module.create(&heap, view.actual, .persistent);
            try module.write(&heap, object, view.target, pair.target, absent, .{ .bytes = &.{}, .references = &.{} });
            const value: ?*backing.Value = if (copying) try module.capture(&heap, object, view.actual, pair.source) else null;
            defer if (value) |saved| module.release(saved) catch unreachable;
            failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
            const success = attempt: {
                if (value) |saved| module.copy(&heap, object, view.actual, pair.source, saved) catch |err| {
                    try std.testing.expectEqual(error.OutOfMemory, err); break :attempt false;
                } else {
                    const captured = module.capture(&heap, object, view.actual, pair.source) catch |err| {
                        try std.testing.expectEqual(error.OutOfMemory, err); break :attempt false;
                    };
                    try module.release(captured);
                }
                break :attempt true;
            };
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            var read = try module.read(&heap, object, view.actual, pair.source, .persistent); defer read.deinit(failing.allocator());
            try std.testing.expectEqual(.undefined_value, (try read.layout.selectVariant(read.value.tag)).kind);
            try std.testing.expectEqual(@as(usize, 1), try heap.objectCount());
            try std.testing.expectError(error.TypeMismatch, module.write(&heap, object, view.actual, pair.source, absent,
                .{ .bytes = &.{}, .references = &.{} }));
            if (success) { try std.testing.expect(failures > 0); std.debug.print("Source {s}: {d} OOM points then success\n", .{if (copying) "copy" else "capture", failures}); break; }
            failures += 1;
        } else return error.NoSuccessfulAttempt;
    }
}

test "backing creation and packing failures leave no object or partial field mutation" {
    const raw = try bytes(); defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = module.authority.views[0]; const pair = view.fields[0]; const contract = try module.cell(view.actual);
    var creation_failures: usize = 0; var write_failures: usize = 0;
    for (0..128) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.authority.layouts);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        const handle = module.create(&heap, view.actual, .persistent) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try std.testing.expectEqual(@as(usize, 0), try heap.objectCount()); creation_failures += 1; continue;
        };
        try heap.release(handle); break;
    } else return error.NoSuccessfulCreation;
    for (0..32) |offset| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
        try heap.installTypedLayouts(module.authority.layouts);
        const handle = try module.create(&heap, view.actual, .persistent);
        failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
        module.write(&heap, handle, view.actual, pair.source, contract.fields[0].semantic_type,
            .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{} }) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            try std.testing.expect(!try heap.hasTypedField(handle, contract.backing, pair.source)); write_failures += 1; continue;
        };
        try heap.release(handle); break;
    } else return error.NoSuccessfulWrite;
    try std.testing.expect(creation_failures > 0 and write_failures > 0);
    std.debug.print("backing create {d} / pack {d} OOM points then success\n", .{creation_failures, write_failures});
}

test "actual Source readonly declaration permits mutable static alias and rejects readonly target" {
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io,
        "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-field-backing-captures/readonly.bin", allocator, .limited(2097152));
    defer allocator.free(raw);
    var module = try backing.load(allocator, raw); defer module.deinit();
    const view = for (module.authority.views) |value| {
        const actual = try module.cell(value.actual);
        const target = (try module.authority.layouts.find(value.target)).cell.?;
        if (actual.declared.fields[0].readonly and !target.fields[0].readonly) break value;
    } else return error.MissingReadonlyFixture;
    const pair = view.fields[0]; const row = try module.cell(view.actual); const native_type = row.fields[0].semantic_type;
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module.authority.layouts);
    const scope = try heap.beginScope(); defer heap.endScope(scope) catch unreachable;
    const object = try module.create(&heap, view.actual, .temporary);
    try std.testing.expectError(error.ReadonlyField, module.write(&heap, object, view.actual, pair.source, native_type,
        .{ .bytes = &.{ 7, 0, 0, 0 }, .references = &.{} }));
    try std.testing.expect(!try heap.hasTypedField(object, row.backing, pair.source));
    try module.write(&heap, object, view.target, pair.target, native_type, .{ .bytes = &.{ 7, 0, 0, 0 }, .references = &.{} });
    var result = try module.read(&heap, object, view.actual, pair.source, .temporary); defer result.deinit(allocator);
    const variant = try result.layout.selectVariant(result.value.tag);
    const offset = if (variant.children.len == 1) variant.children[0].offset else 0;
    try std.testing.expectEqual(@as(i32, 7), std.mem.readInt(i32, result.value.bytes[offset..][0..4], .little));
}
