// SPDX-License-Identifier: MIT
const std = @import("std");
const canonical = @import("typed-layout-canonical.zig");
const element = @import("array-element.zig");
const managed = @import("managed-heap.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const allocator = std.testing.allocator;
const root = "E:/ws/pro_tsfg/.scratch/tsfg_r03/M25-formal-array-checks-20261022/typed-layout-captures/";
fn member(value: std.json.Value, name: []const u8) std.json.Value { return value.object.get(name).?; }
fn number(value: std.json.Value, name: []const u8) i64 { return member(value, name).integer; }
fn id(value: std.json.Value, name: []const u8) ![32]u8 {
    const text = member(value, name).string;
    try equal(@as(usize, 71), text.len); try std.testing.expectEqualStrings("sha256:", text[0..7]);
    var out: [32]u8 = undefined; _ = try std.fmt.hexToBytes(&out, text[7..]); return out;
}
fn compareLayout(actual: element.Layout, expected: std.json.Value) !void {
    try std.testing.expectEqualSlices(u8, &try id(expected, "typeId"), &actual.type_id);
    try equal(number(expected, "byteSize"), actual.byte_size); try equal(number(expected, "alignment"), actual.alignment);
    try equal(number(expected, "referenceCount"), actual.reference_count);
    const variants = member(expected, "variants").array.items; try equal(variants.len, actual.variants.len);
    for (variants, actual.variants) |want, got| {
        try equal(number(want, "tag"), got.tag);
        try std.testing.expectEqualStrings(member(want, "kind").string, switch (got.kind) { .value => "value", .null_value => "null", .undefined_value => "undefined" });
        const fields = member(want, "fields").array.items; try equal(fields.len, got.fields.len);
        for (fields, got.fields) |a, b| { try equal(number(a, "offset"), b.offset); try equal(number(a, "code"), b.code); }
        const refs = member(want, "references").array.items; try equal(refs.len, got.references.len);
        for (refs, got.references) |a, b| {
            try equal(number(a, "slot"), b.slot);
            switch (b.type) {
                .string => try std.testing.expectEqualStrings("string", member(a, "kind").string),
                .cell, .array => |type_id| {
                    try std.testing.expectEqualStrings(if (b.type == .cell) "cell" else "array", member(a, "kind").string);
                    try std.testing.expectEqualSlices(u8, &try id(a, "typeId"), &type_id);
                },
                .object => return error.UnexpectedLegacyDomain,
                .cell_domain => return error.UnexpectedBackingDomain,
            }
        }
        const children = member(want, "children").array.items; try equal(children.len, got.children.len);
        for (children, got.children) |a, b| {
            try equal(number(a, "tagOffset"), b.tag_offset); try equal(number(a, "offset"), b.offset);
            try equal(number(a, "referenceOffset"), b.reference_offset); try compareLayout(b.layout.*, member(a, "layout"));
        }
    }
}
fn read(suffix: []const u8) ![]u8 { return std.Io.Dir.cwd().readFileAlloc(std.testing.io, suffix, allocator, .limited(2097152)); }
test "actual Node modules independently reconstruct every canonical physical layout in Zig" {
    const index = try read(root ++ "index.txt"); defer allocator.free(index);
    var lines = std.mem.tokenizeScalar(u8, index, '\n'); var count: usize = 0;
    while (lines.next()) |name| {
        const binary_path = try std.fmt.allocPrint(allocator, "{s}{s}.bin", .{ root, name }); defer allocator.free(binary_path);
        const json_path = try std.fmt.allocPrint(allocator, "{s}{s}.json", .{ root, name }); defer allocator.free(json_path);
        const binary = try read(binary_path); defer allocator.free(binary);
        const json = try read(json_path); defer allocator.free(json);
        var module = try canonical.load(allocator, binary); defer module.deinit();
        var expected = try std.json.parseFromSlice(std.json.Value, allocator, json, .{}); defer expected.deinit();
        const entries = member(expected.value, "entries").array.items; try equal(entries.len, module.entries.len);
        for (entries, module.entries) |a, b| {
            try std.testing.expectEqualSlices(u8, &try id(a, "typeId"), &b.type_id); try compareLayout(b.layout, member(a, "layout"));
            if (a.object.get("cell")) |cell| {
                const actual = b.cell.?;
                try std.testing.expectEqualSlices(u8, &try id(cell, "runtimeKey"), &actual.runtime_key);
                try equal(number(cell, "byteSize"), actual.byte_size); try equal(number(cell, "alignment"), actual.alignment);
                try equal(number(cell, "referenceCount"), actual.reference_count);
                const fields = member(cell, "fields").array.items; try equal(fields.len, actual.fields.len);
                for (fields, actual.fields) |left, right| {
                    try std.testing.expectEqualSlices(u8, &try id(left, "id"), &right.id);
                    try std.testing.expectEqualSlices(u8, &try id(left, "typeId"), &right.layout.type_id);
                    try equal(number(left, "offset"), right.offset); try equal(number(left, "referenceOffset"), right.reference_offset);
                    try equal(member(left, "readonly").bool, right.readonly);
                }
            } else try expect(b.cell == null);
        }
        count += 1;
    }
    try equal(@as(usize, 41), count);
}

test "actual Source Box cell and Array share roots moving collection and full identities" {
    const bytes = try read(root ++ "38ac49ad717fc41a9c3fdc4178ac0284ce2e9f26794790d42bb41d6eeba66fe3.bin"); defer allocator.free(bytes);
    var module = try canonical.load(allocator, bytes); defer module.deinit();
    var entry: ?*const canonical.Entry = null;
    for (module.entries) |*row| if (row.cell != null) { entry = row; break; };
    const box = entry.?.cell.?; const layout = entry.?.layout; const field = box.fields[0];
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module);
    const scope = try heap.beginScope(); const object = try heap.createTypedCell(box, .temporary);
    try std.testing.expectError(error.UninitializedField, heap.readTypedField(object, box, field.id, .temporary));
    try expect(!try heap.hasTypedField(object, box, field.id));
    try heap.writeTypedField(object, box, field.id, .{ .bytes = &.{ 42, 0, 0, 0 }, .references = &.{} }, true);
    try std.testing.expectError(error.AlreadyInitialized, heap.writeTypedField(object, box, field.id, .{ .bytes = &.{ 1, 0, 0, 0 }, .references = &.{} }, true));
    const array = try heap.createTypedArray(layout, &.{.{ .bytes = &.{}, .references = &.{object} }}, .persistent);
    const alias = try heap.retain(array, .persistent); try heap.endScope(scope); try heap.collect();
    const read_scope = try heap.beginScope();
    var reference = try heap.readTypedArray(alias, layout, 0, .temporary); defer reference.deinit(allocator);
    var value = try heap.readTypedField(reference.references[0].?, box, field.id, .temporary); defer value.deinit(allocator);
    try std.testing.expectEqualSlices(u8, &.{ 42, 0, 0, 0 }, value.bytes);
    var wrong = box; wrong.runtime_key[31] ^= 1;
    try std.testing.expectError(error.TypeMismatch, heap.readTypedField(reference.references[0].?, wrong, field.id, .temporary));
    try std.testing.expectError(error.TypeMismatch, heap.setEdge(reference.references[0].?, 0, null));
    try heap.resizeTypedArray(array, layout, 0); try heap.collect(); try equal(@as(usize, 2), try heap.objectCount());
    try heap.endScope(read_scope); try heap.collect(); try equal(@as(usize, 1), try heap.objectCount());
}

test "one heap refuses conflicting imported and nested layouts before publishing an object" {
    const bytes = try read(root ++ "38ac49ad717fc41a9c3fdc4178ac0284ce2e9f26794790d42bb41d6eeba66fe3.bin"); defer allocator.free(bytes);
    var module = try canonical.load(allocator, bytes); defer module.deinit();
    var heap = managed.ManagedHeap.init(allocator); defer heap.deinit() catch unreachable;
    try heap.installTypedLayouts(module); try heap.installTypedLayouts(module);
    var scalar: ?element.Layout = null; var cell: ?managed.CellLayout = null;
    for (module.entries) |entry| {
        if (std.mem.eql(u8, entry.name, "i32")) scalar = entry.layout;
        if (entry.cell) |value| cell = value;
    }
    var wrong = scalar.?;
    wrong.variants = &.{.{ .tag = 0, .fields = &.{.{ .offset = 0, .code = 12 }} }};
    try std.testing.expectError(error.TypeMismatch, heap.createTypedArray(wrong, &.{}, .persistent));
    const nested = element.Layout{ .type_id = .{99} ** 32, .byte_size = 8, .alignment = 4, .reference_count = 0,
        .variants = &.{.{ .tag = 0, .children = &.{.{ .tag_offset = 0, .offset = 4, .reference_offset = 0, .layout = &wrong }} }} };
    try std.testing.expectError(error.TypeMismatch, heap.createTypedArray(nested, &.{}, .persistent));
    var fields = [_]@import("managed-cell.zig").Field{cell.?.fields[0]}; fields[0].readonly = !fields[0].readonly;
    var bad_cell = cell.?; bad_cell.fields = &fields;
    try std.testing.expectError(error.TypeMismatch, heap.createTypedCell(bad_cell, .persistent));
    try equal(@as(usize, 0), try heap.objectCount()); try equal(@as(u64, 1), heap.next_identity);
}

test "module boundaries reject short identities duplicate entries trailing bytes and forged semantic ids" {
    const bytes = try read(root ++ "cbac6d610ac7b060ecb571daaff89576dd49298be14d2ef68e48b069a4da46db.bin"); defer allocator.free(bytes);
    try std.testing.expectError(error.InvalidLayoutModule, canonical.load(allocator, bytes[0..41]));
    const corrupt = try allocator.dupe(u8, bytes); defer allocator.free(corrupt);
    corrupt[10] ^= 1; try std.testing.expectError(error.InvalidLayoutModule, canonical.load(allocator, corrupt));
    const extra = try std.mem.concat(allocator, u8, &.{ bytes, &.{0} }); defer allocator.free(extra);
    try std.testing.expectError(error.InvalidLayoutModule, canonical.load(allocator, extra));
    var module = try canonical.load(allocator, bytes); defer module.deinit();
    const primitive = module.entries[0].type_id;
    const duplicate = try std.mem.concat(allocator, u8, &.{ "TSGLAY01", &.{ 2, 0 }, &primitive, &.{ 1, 1 }, &primitive, &.{ 1, 1 } }); defer allocator.free(duplicate);
    try std.testing.expectError(error.InvalidLayoutModule, canonical.load(allocator, duplicate));
    for (module.entries) |entry| if (entry.cell) |cell| {
        const at = std.mem.indexOf(u8, bytes, &cell.runtime_key).?;
        @memcpy(corrupt, bytes); corrupt[at + 31] ^= 1;
        try std.testing.expectError(error.InvalidLayoutModule, canonical.load(allocator, corrupt));
        break;
    };
}

const LayoutId = [32]u8;
const LayoutRow = struct {
    id: LayoutId,
    kind: @import("typed-layout-input.zig").Kind,
    payload: []const u8 = &.{},
};

fn layoutTypeId(name: []const u8) LayoutId {
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("tsfg.type\x00"); hash.update(name); return hash.finalResult();
}

fn layoutWord(bytes: *std.ArrayList(u8), alloc: std.mem.Allocator, value: u16) !void {
    var word: [2]u8 = undefined;
    std.mem.writeInt(u16, &word, value, .little);
    try bytes.appendSlice(alloc, &word);
}

fn fixedLayoutRow(alloc: std.mem.Allocator, key: LayoutId, fields: []const LayoutId) !LayoutRow {
    var type_name: [78]u8 = undefined;
    const type_id = layoutTypeId(try std.fmt.bufPrint(&type_name, "value<sha256:{s}>", .{std.fmt.bytesToHex(key, .lower)}));
    var payload: std.ArrayList(u8) = .empty;
    try payload.appendSlice(alloc, &key);
    try payload.append(alloc, 0);
    try layoutWord(&payload, alloc, @intCast(fields.len));
    const type_hex = std.fmt.bytesToHex(type_id, .lower);
    for (fields, 0..) |field_type, index| {
        var name_buffer: [8]u8 = undefined;
        const name = try std.fmt.bufPrint(&name_buffer, "f{d}", .{index});
        var hash = std.crypto.hash.sha2.Sha256.init(.{});
        hash.update("tsfg.field\x00sha256:"); hash.update(&type_hex); hash.update("\x00"); hash.update(name);
        try payload.appendSlice(alloc, &hash.finalResult());
        try layoutWord(&payload, alloc, @intCast(name.len));
        try payload.appendSlice(alloc, name);
        try payload.appendSlice(alloc, &field_type);
        try payload.append(alloc, 0);
    }
    return .{ .id = type_id, .kind = .value, .payload = payload.items };
}

fn layoutModuleBytes(alloc: std.mem.Allocator, rows: []LayoutRow) ![]const u8 {
    const order = struct {
        fn less(_: void, left: LayoutRow, right: LayoutRow) bool { return std.mem.lessThan(u8, &left.id, &right.id); }
    }.less;
    std.mem.sort(LayoutRow, rows, {}, order);
    var bytes: std.ArrayList(u8) = .empty;
    try bytes.appendSlice(alloc, "TSGLAY01");
    try layoutWord(&bytes, alloc, @intCast(rows.len));
    for (rows) |row| {
        try bytes.appendSlice(alloc, &row.id);
        try bytes.append(alloc, @intFromEnum(row.kind));
        try bytes.appendSlice(alloc, row.payload);
    }
    return bytes.items;
}

test "canonical layout limits a complete fixed value and its semantic optional wrapper" {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const alloc = arena.allocator();
    const scalar: LayoutRow = .{ .id = layoutTypeId("i64"), .kind = .scalar, .payload = &.{5} };
    const absence: LayoutRow = .{ .id = layoutTypeId("undefined"), .kind = .undefined_value };
    // Each aligned i64 field occupies 16 bytes including its inline tag.
    const group = try fixedLayoutRow(alloc, .{1} ** 32, &([_]LayoutId{scalar.id} ** 64));
    const tail = try fixedLayoutRow(alloc, .{2} ** 32, &([_]LayoutId{scalar.id} ** 32));
    // 63 * (1024 + 8) + (512 + 8) = 65536.
    const value = try fixedLayoutRow(alloc, .{3} ** 32, &(([_]LayoutId{group.id} ** 63) ++ [_]LayoutId{tail.id}));
    var plain = [_]LayoutRow{ scalar, absence, group, tail, value };
    var module = try canonical.load(allocator, try layoutModuleBytes(alloc, &plain));
    defer module.deinit();
    try equal(@as(u32, 65536), (try module.find(value.id)).layout.byte_size);

    const members = if (std.mem.lessThan(u8, &absence.id, &value.id)) absence.id ++ value.id else value.id ++ absence.id;
    const semantic_name = "Union<undefined,value<sha256:" ++ "03" ** 32 ++ ">>";
    const payload = [_]u8{ 2, 0 } ++ members;
    var boxed = plain ++ [_]LayoutRow{.{ .id = layoutTypeId(semantic_name), .kind = .union_value, .payload = &payload }};
    if (canonical.load(allocator, try layoutModuleBytes(alloc, &boxed))) |accepted| {
        var oversized = accepted;
        defer oversized.deinit();
        const actual = (try oversized.find(layoutTypeId(semantic_name))).layout.byte_size;
        try equal(@as(u32, 65544), actual);
        return error.AcceptedOversizedCanonicalLayout;
    } else |err| try equal(error.LayoutLimit, err);
}

test "logical module decoding and whole catalogue installation are atomic on OOM" {
    const bytes = try read(root ++ "38ac49ad717fc41a9c3fdc4178ac0284ce2e9f26794790d42bb41d6eeba66fe3.bin"); defer allocator.free(bytes);
    var decoded = try canonical.load(allocator, bytes); defer decoded.deinit();
    inline for (.{ false, true }) |install| {
        var failures: usize = 0;
        for (0..512) |offset| {
            var failing = std.testing.FailingAllocator.init(allocator, .{});
            var heap = managed.ManagedHeap.init(failing.allocator()); defer heap.deinit() catch unreachable;
            failing.fail_index = failing.alloc_index + offset; failing.resize_fail_index = failing.resize_index;
            const success = attempt: {
                if (install) {
                    heap.installTypedLayouts(decoded) catch |err| { try equal(error.OutOfMemory, err); break :attempt false; };
                } else {
                    var module = canonical.load(failing.allocator(), bytes) catch |err| { try equal(error.OutOfMemory, err); break :attempt false; };
                    module.deinit();
                }
                break :attempt true;
            };
            failing.fail_index = std.math.maxInt(usize); failing.resize_fail_index = std.math.maxInt(usize);
            if (!success) {
                failures += 1; try equal(@as(usize, 0), try heap.objectCount());
                // A failed import cannot reserve identities or partially install
                // a definition. Its complete original module remains admissible.
                try heap.installTypedLayouts(decoded);
            } else { try expect(failures > 0); std.debug.print("layout {s}: {d} real OOM points then success\n", .{ if (install) "install" else "decode", failures }); break; }
        } else return error.NoSuccessfulAttempt;
    }
}
