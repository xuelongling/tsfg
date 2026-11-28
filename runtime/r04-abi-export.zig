// SPDX-License-Identifier: MIT
//! Zig `comptime` ABI exporter: reflects existing Zig `extern struct` and `enum`
//! declarations directly into canonical R04 `.tsfgabi` descriptor records so
//! Zig-authored APIs and tsfg-authored `@abi` APIs share one exact single source of truth.
const std = @import("std");
const id = @import("r04-identity.zig");

pub const ExportedField = struct {
    name: []const u8,
    offset: u32,
    type_name: []const u8,
};

pub const ExportedType = struct {
    name: []const u8,
    kind: []const u8,
    byte_size: u32,
    alignment: u32,
    underlying_type: ?[]const u8 = null,
    fields: []const ExportedField = &.{},
};

pub fn tsfgScalarName(comptime T: type) []const u8 {
    return switch (T) {
        i8 => "i8",
        u8 => "u8",
        i16 => "i16",
        u16 => "u16",
        i32 => "i32",
        u32 => "u32",
        i64 => "i64",
        u64 => "u64",
        isize => "isize",
        usize => "usize",
        f32 => "f32",
        f64 => "f64",
        void => "void",
        bool => "bool",
        else => @typeName(T),
    };
}

/// Comptime-reflect an `extern struct` into exact R04 layout metadata.
pub fn reflectExternStruct(comptime name: []const u8, comptime T: type) ExportedType {
    const ti = @typeInfo(T);
    if (ti != .@"struct" or ti.@"struct".layout != .@"extern") {
        @compileError("reflectExternStruct requires an `extern struct`");
    }
    const fields_info = ti.@"struct".fields;
    comptime var out_fields: [fields_info.len]ExportedField = undefined;
    inline for (fields_info, 0..) |f, i| {
        out_fields[i] = .{
            .name = f.name,
            .offset = @offsetOf(T, f.name),
            .type_name = comptime tsfgScalarName(f.type),
        };
    }
    const frozen = out_fields;
    return .{
        .name = name,
        .kind = "struct",
        .byte_size = @sizeOf(T),
        .alignment = @alignOf(T),
        .fields = &frozen,
    };
}

/// Comptime-reflect an integer-backed `enum` into exact R04 layout metadata.
pub fn reflectBackedEnum(comptime name: []const u8, comptime E: type) ExportedType {
    const ti = @typeInfo(E);
    if (ti != .@"enum") @compileError("reflectBackedEnum requires an enum");
    return .{
        .name = name,
        .kind = "enum",
        .byte_size = @sizeOf(E),
        .alignment = @alignOf(E),
        .underlying_type = tsfgScalarName(ti.@"enum".tag_type),
    };
}

/// Append canonical JSON describing Zig `extern` types into `out`.
pub fn appendExportedSpecsJson(allocator: std.mem.Allocator, out: *std.ArrayListUnmanaged(u8), types: []const ExportedType) !void {
    try out.appendSlice(allocator, "{\"target\":\"");
    try out.appendSlice(allocator, id.TARGET_NAME);
    try out.appendSlice(allocator, "\",\"triple\":\"");
    try out.appendSlice(allocator, id.TARGET_TRIPLE);
    try out.appendSlice(allocator, "\",\"types\":[");
    for (types, 0..) |t, ti| {
        if (ti > 0) try out.append(allocator, ',');
        try out.print(allocator, "{{\"align\":{d},\"byteSize\":{d},\"fields\":[", .{ t.alignment, t.byte_size });
        for (t.fields, 0..) |f, fi| {
            if (fi > 0) try out.append(allocator, ',');
            try out.print(allocator, "{{\"name\":\"{s}\",\"offset\":{d},\"type\":\"{s}\"}}", .{ f.name, f.offset, f.type_name });
        }
        try out.print(allocator, "],\"kind\":\"{s}\",\"name\":\"{s}\"", .{ t.kind, t.name });
        if (t.underlying_type) |u| {
            try out.print(allocator, ",\"underlyingType\":\"{s}\"", .{u});
        }
        try out.append(allocator, '}');
    }
    try out.appendSlice(allocator, "]}");
}

test "Zig comptime ABI exporter reflects extern struct and enum layouts accurately" {
    const SmallPair = extern struct { tag: u8, pad_val: i32 };
    const Vec3 = extern struct { x: f32, y: f32, z: f32 };
    const LargePose = extern struct { a: f64, b: f64, c: i64, flag: u8 };
    const Mode = enum(u16) { idle = 0, active = 1 };

    const specs = [_]ExportedType{
        reflectExternStruct("SmallPair", SmallPair),
        reflectExternStruct("Vec3", Vec3),
        reflectExternStruct("LargePose", LargePose),
        reflectBackedEnum("Mode", Mode),
    };

    try std.testing.expectEqual(@as(u32, 8), specs[0].byte_size);
    try std.testing.expectEqual(@as(u32, 4), specs[0].alignment);
    try std.testing.expectEqual(@as(u32, 4), specs[0].fields[1].offset);

    try std.testing.expectEqual(@as(u32, 12), specs[1].byte_size);
    try std.testing.expectEqual(@as(u32, 4), specs[1].alignment);

    try std.testing.expectEqual(@as(u32, 32), specs[2].byte_size);
    try std.testing.expectEqual(@as(u32, 8), specs[2].alignment);
    try std.testing.expectEqual(@as(u32, 24), specs[2].fields[3].offset);

    try std.testing.expectEqual(@as(u32, 2), specs[3].byte_size);
    try std.testing.expectEqualStrings("u16", specs[3].underlying_type.?);

    var buf: std.ArrayListUnmanaged(u8) = .empty;
    defer buf.deinit(std.testing.allocator);
    try appendExportedSpecsJson(std.testing.allocator, &buf, &specs);
    try std.testing.expect(std.mem.indexOf(u8, buf.items, "\"name\":\"LargePose\"") != null);
}
