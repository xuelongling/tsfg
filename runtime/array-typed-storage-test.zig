// SPDX-License-Identifier: MIT
const std = @import("std");
const managed = @import("managed-heap.zig");
const element = @import("array-element.zig");
const Heap = managed.ManagedHeap;
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const expectError = std.testing.expectError;
const scalar: managed.ArrayLayout = .{ .type_id = .{1} ** 32, .byte_size = 8, .alignment = 8, .reference_count = 0, .variants = &.{.{ .tag = 0, .fields = &.{.{ .offset = 0, .code = 13 }} }} };
const sum: managed.ArrayLayout = .{ .type_id = .{2} ** 32, .byte_size = 8, .alignment = 8, .reference_count = 1, .variants = &.{
    .{ .tag = 0, .fields = &.{.{ .offset = 0, .code = 1 }} },
    .{ .tag = 1, .kind = .undefined_value },
    .{ .tag = 2, .kind = .null_value },
    .{ .tag = 3, .references = &.{.{ .slot = 0, .type = .{ .object = 77 } }} },
    .{ .tag = 4, .references = &.{.{ .slot = 0, .type = .string }} },
} };
const zero = [_]u8{0} ** 8;
fn bits(value: u64) [8]u8 {
    var bytes: [8]u8 = undefined;
    std.mem.writeInt(u64, &bytes, value, .little);
    return bytes;
}
fn input(value: *const [8]u8) managed.ArrayInput {
    return .{ .bytes = value, .references = &.{} };
}
test "scalar element layouts preserve IEEE bits and shared owner while rejecting gaps and growth" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const negative_zero = bits(0x8000000000000000);
    const nan = bits(0x7FF8000000000042);
    const original = try heap.createTypedArray(scalar, &.{ input(&negative_zero), input(&nan) }, .persistent);
    const alias = try heap.retain(original, .persistent);
    const independent = try heap.createTypedArray(scalar, &.{input(&negative_zero)}, .persistent);
    const replacement = bits(0x3FF0000000000000);
    try heap.storeTypedArray(alias, scalar, 1, input(&replacement));
    try expectError(error.IndexOutOfBounds, heap.storeTypedArray(alias, scalar, 4, input(&nan)));
    try expectError(error.UninitializedGrowth, heap.resizeTypedArray(original, scalar, 4));
    try heap.storeTypedArray(original, scalar, 2, input(&nan));
    try equal(@as(u32, 3), try heap.typedArrayLength(alias, scalar));
    var value = try heap.readTypedArray(alias, scalar, 2, .persistent);
    defer value.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u8, &nan, value.bytes);
    try heap.collect();
    var other = try heap.readTypedArray(independent, scalar, 0, .persistent);
    defer other.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u8, &negative_zero, other.bytes);
    try heap.resizeTypedArray(alias, scalar, 0);
    try expectError(error.IndexOutOfBounds, heap.readTypedArray(original, scalar, 0, .persistent));
    try expectError(error.IndexOutOfBounds, heap.readTypedArray(original, scalar, std.math.maxInt(u32), .persistent));
    try heap.storeTypedArray(alias, scalar, 0, input(&negative_zero));
    try equal(@as(u32, 1), try heap.typedArrayLength(original, scalar));
}

test "undefined null fields and padding are separate from missing and normalized on ownership" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var bytes = [_]u8{ 42, 0, 0, 0, 99, 98, 97, 96 };
    const array = try heap.createTypedArray(sum, &.{
        .{ .tag = 0, .bytes = &bytes, .references = &.{null} },
        .{ .tag = 1, .bytes = &bytes, .references = &.{null} },
        .{ .tag = 2, .bytes = &bytes, .references = &.{null} },
    }, .persistent);
    bytes[0] = 100;
    var value = try heap.readTypedArray(array, sum, 0, .persistent);
    defer value.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u8, &.{ 42, 0, 0, 0, 0, 0, 0, 0 }, value.bytes);
    var undefined_value = try heap.readTypedArray(array, sum, 1, .persistent);
    defer undefined_value.deinit(std.testing.allocator);
    try equal(@as(u16, 1), undefined_value.tag);
    try std.testing.expectEqualSlices(u8, &zero, undefined_value.bytes);
    var null_value = try heap.readTypedArray(array, sum, 2, .persistent);
    defer null_value.deinit(std.testing.allocator);
    try equal(@as(u16, 2), null_value.tag);
    try expectError(error.IndexOutOfBounds, heap.readTypedArray(array, sum, 3, .persistent));
    try expectError(error.InvalidArrayElement, heap.storeTypedArray(array, sum, 0, .{ .tag = 9, .bytes = &zero, .references = &.{null} }));
    try expectError(error.InvalidArrayElement, heap.storeTypedArray(array, sum, 0, .{ .tag = 0, .bytes = &.{0}, .references = &.{null} }));
    try equal(@as(u32, 3), try heap.typedArrayLength(array, sum));
}

test "reference elements move with their owner and removed tails stop retaining children" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const scope = try heap.beginScope();
    const child = try heap.create(77, 41, 0, .temporary);
    const text = try heap.createString(&.{ 0xD800, 0 }, .temporary);
    const array = try heap.createTypedArray(sum, &.{
        .{ .tag = 3, .bytes = &zero, .references = &.{child} },
        .{ .tag = 4, .bytes = &zero, .references = &.{text} },
    }, .persistent);
    const alias = try heap.retain(array, .persistent);
    try heap.endScope(scope);
    const before = try managed.testing.location(&heap, array);
    try heap.collect();
    try expect(before != try managed.testing.location(&heap, alias));
    const read_scope = try heap.beginScope();
    var value = try heap.readTypedArray(alias, sum, 0, .temporary);
    defer value.deinit(std.testing.allocator);
    try heap.resizeTypedArray(array, sum, 0);
    try heap.collect();
    try equal(@as(usize, 2), try heap.objectCount());
    try equal(@as(u64, 41), (try heap.read(value.references[0].?, 77)).scalar);
    try heap.endScope(read_scope);
    try heap.collect();
    try equal(@as(usize, 1), try heap.objectCount());
    try heap.release(array);
    try heap.release(alias);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "descriptor identity and active reference maps reject wrong owners types widths and bypasses" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var foreign = Heap.init(std.testing.allocator);
    defer foreign.deinit() catch unreachable;
    const array = try heap.createTypedArray(sum, &.{.{ .tag = 1, .bytes = &zero, .references = &.{null} }}, .persistent);
    const wrong = try heap.create(78, 1, 0, .persistent);
    const outsider = try foreign.create(77, 1, 0, .persistent);
    try expectError(error.TypeMismatch, heap.storeTypedArray(array, sum, 0, .{ .tag = 3, .bytes = &zero, .references = &.{wrong} }));
    try expectError(error.InvalidHandle, heap.storeTypedArray(array, sum, 0, .{ .tag = 3, .bytes = &zero, .references = &.{outsider} }));
    try expectError(error.InvalidArrayElement, heap.storeTypedArray(array, sum, 0, .{ .tag = 1, .bytes = &zero, .references = &.{} }));
    try expectError(error.InvalidArrayElement, heap.storeTypedArray(array, sum, 0, .{ .tag = 3, .bytes = &zero, .references = &.{null} }));
    try expectError(error.TypeMismatch, heap.setEdge(array, 0, wrong));
    var wrong_id = sum;
    wrong_id.type_id[0] = 9;
    try expectError(error.TypeMismatch, heap.typedArrayLength(array, wrong_id));
    var wrong_layout = sum;
    wrong_layout.byte_size = 16;
    try expectError(error.TypeMismatch, heap.typedArrayLength(array, wrong_layout));
    try equal(@as(u32, 1), try heap.typedArrayLength(array, sum));
    // Inactive references are not values and must never be resolved or retained.
    try heap.storeTypedArray(array, sum, 0, .{ .tag = 1, .bytes = &zero, .references = &.{outsider} });
    try heap.collect();
    var value = try heap.readTypedArray(array, sum, 0, .persistent);
    defer value.deinit(std.testing.allocator);
    try expect(value.references[0] == null);
}

test "all scalar fields validate physical width and preserve their bit patterns" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    for (1..14) |code| {
        const width = element.fieldSize(@intCast(code)).?;
        const layout: managed.ArrayLayout = .{ .type_id = .{@as(u8, @intCast(code + 10))} ** 32, .byte_size = width, .alignment = @intCast(width), .reference_count = 0, .variants = &.{.{ .tag = 0, .fields = &.{.{ .offset = 0, .code = @intCast(code) }} }} };
        var bytes = [_]u8{0xA5} ** 8;
        if (code == 2) bytes[0] = 1;
        const array = try heap.createTypedArray(layout, &.{.{ .bytes = bytes[0..width], .references = &.{} }}, .persistent);
        var value = try heap.readTypedArray(array, layout, 0, .persistent);
        defer value.deinit(std.testing.allocator);
        try std.testing.expectEqualSlices(u8, bytes[0..width], value.bytes);
        if (code == 2) try expectError(error.InvalidArrayElement, heap.storeTypedArray(array, layout, 0, .{ .bytes = &.{2}, .references = &.{} }));
        try heap.release(array);
    }
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());
}

test "Array-of-Array aliases cycles and multiple reference fields survive actual graph tracing" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    const layout: managed.ArrayLayout = .{ .type_id = .{3} ** 32, .byte_size = 0, .alignment = 1, .reference_count = 1, .variants = &.{.{ .tag = 0, .references = &.{.{ .slot = 0, .type = .{ .array = .{3} ** 32 } }} }} };
    const array = try heap.createTypedArray(layout, &.{}, .persistent);
    try heap.storeTypedArray(array, layout, 0, .{ .bytes = &.{}, .references = &.{array} });
    try heap.collect();
    const scope = try heap.beginScope();
    var self = try heap.readTypedArray(array, layout, 0, .temporary);
    defer self.deinit(std.testing.allocator);
    try expect(try heap.sameObject(array, self.references[0].?));
    try heap.endScope(scope);
    try heap.release(array);
    try heap.collect();
    try equal(@as(usize, 0), try heap.objectCount());

    const record: managed.ArrayLayout = .{ .type_id = .{4} ** 32, .byte_size = 8, .alignment = 4, .reference_count = 2, .variants = &.{.{ .tag = 0, .fields = &.{ .{ .offset = 0, .code = 1 }, .{ .offset = 4, .code = 2 } }, .references = &.{ .{ .slot = 0, .type = .{ .object = 77 } }, .{ .slot = 1, .type = .string } } }} };
    const child = try heap.create(77, 12, 0, .persistent);
    const text = try heap.createString(&.{0xDFFF}, .persistent);
    const owner = try heap.createTypedArray(record, &.{.{ .bytes = &.{ 8, 0, 0, 0, 1, 22, 33, 44 }, .references = &.{ child, text } }}, .persistent);
    try heap.release(child);
    try heap.release(text);
    try heap.collect();
    const read_scope = try heap.beginScope();
    defer heap.endScope(read_scope) catch unreachable;
    var value = try heap.readTypedArray(owner, record, 0, .temporary);
    defer value.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u8, &.{ 8, 0, 0, 0, 1, 0, 0, 0 }, value.bytes);
    try equal(@as(u64, 12), (try heap.read(value.references[0].?, 77)).scalar);
    try equal(@as(u16, 0xDFFF), try heap.readStringCodeUnit(value.references[1].?, 0));
}

test "descriptor and input buffers are owned independently of mutable caller storage" {
    var heap = Heap.init(std.testing.allocator);
    defer heap.deinit() catch unreachable;
    var fields = [_]element.Field{.{ .offset = 0, .code = 13 }};
    var variants = [_]element.Variant{.{ .tag = 0, .fields = &fields }};
    const layout: managed.ArrayLayout = .{ .type_id = scalar.type_id, .byte_size = 8, .alignment = 8, .reference_count = 0, .variants = &variants };
    var bytes = bits(0x3FF0000000000000);
    const array = try heap.createTypedArray(layout, &.{input(&bytes)}, .persistent);
    fields[0].code = 2;
    variants[0].tag = 4;
    bytes[0] = 99;
    try expectError(error.TypeMismatch, heap.typedArrayLength(array, layout));
    var value = try heap.readTypedArray(array, scalar, 0, .persistent);
    defer value.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(u8, &bits(0x3FF0000000000000), value.bytes);
}

test "layouts reject overlapping fields duplicate tags and invalid reference maps" {
    var bad = scalar;
    bad.alignment = 3;
    try expectError(error.InvalidArrayLayout, bad.validate());
    bad = scalar;
    bad.variants = &.{.{ .tag = 0, .fields = &.{ .{ .offset = 0, .code = 13 }, .{ .offset = 4, .code = 1 } } }};
    try expectError(error.InvalidArrayLayout, bad.validate());
    bad = sum;
    bad.variants = &.{ .{ .tag = 1 }, .{ .tag = 1 } };
    try expectError(error.InvalidArrayLayout, bad.validate());
    bad = sum;
    bad.variants = &.{.{ .tag = 0, .references = &.{.{ .slot = 1, .type = .string }} }};
    try expectError(error.InvalidArrayLayout, bad.validate());
    bad = sum;
    bad.variants = &.{.{ .tag = 0, .kind = .undefined_value, .references = &.{.{ .slot = 0, .type = .string }} }};
    try expectError(error.InvalidArrayLayout, bad.validate());
}
