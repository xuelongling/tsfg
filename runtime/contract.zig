// SPDX-License-Identifier: MIT
const std = @import("std");

pub const version: u32 = 6;
pub const schema_hash_hex = "2119acbdab7a604f5947b765f607d596d534f11fb88d81770e7230011f3de13b";
pub const schema_hash = hexDigest(schema_hash_hex);
pub const max_bytes = 1048576;
pub const target = "windows-x86_64-msvc";
pub const triple = "x86_64-pc-windows-msvc";
pub const data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";

pub fn typeName(code: u8) []const u8 {
    return switch (code) { 1 => "i32", 2 => "bool", 3 => "i8", 4 => "i16", 5 => "i64", 6 => "u8", 7 => "u16", 8 => "u32", 9 => "u64", 10 => "isize", 11 => "usize", else => "none" };
}
pub fn validType(code: u8) bool { return code >= 1 and code <= 11; }
pub fn integerType(code: u8) bool { return validType(code) and code != 2; }
pub fn bitWidth(code: u8) u8 {
    return switch (code) { 3, 6 => 8, 4, 7 => 16, 1, 8 => 32, 10, 11 => @bitSizeOf(usize), else => 64 };
}
pub fn signedType(code: u8) bool { return code == 1 or code == 3 or code == 4 or code == 5 or code == 10; }
pub fn mask(code: u8) u64 { const width = bitWidth(code); return if (width == 64) std.math.maxInt(u64) else (@as(u64, 1) << @as(u6, @intCast(width))) - 1; }
pub fn signedValue(bits: u64, code: u8) i64 {
    const width = bitWidth(code);
    if (width == 64) return @bitCast(bits);
    const shift: u6 = @intCast(64 - width);
    return @as(i64, @bitCast(bits << shift)) >> shift;
}

pub fn hexDigest(comptime hex: []const u8) [32]u8 {
    var result: [32]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, hex) catch unreachable;
    return result;
}
