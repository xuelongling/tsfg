// SPDX-License-Identifier: MIT
const std = @import("std");

pub const version: u32 = 8;
pub const schema_hash_hex = "5e080a9472ede4ee7c15de242c00999ac63a65534dfb489afabdf020a442fdc6";
pub const schema_hash = hexDigest(schema_hash_hex);
pub const max_bytes = 1048576;
pub const target = "windows-x86_64-msvc";
pub const triple = "x86_64-pc-windows-msvc";
pub const data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";

pub fn typeName(code: u8) []const u8 {
    if (code == 1) return "i32";
    if (code == 2) return "bool";
    if (code == 3) return "i8";
    if (code == 4) return "i16";
    if (code == 5) return "i64";
    if (code == 6) return "u8";
    if (code == 7) return "u16";
    if (code == 8) return "u32";
    if (code == 9) return "u64";
    if (code == 10) return "isize";
    if (code == 11) return "usize";
    if (code == 12) return "f32";
    if (code == 13) return "f64";
    return "none";
}
pub fn validType(code: u8) bool { return code >= 1 and code <= 13; }
pub fn integerType(code: u8) bool { return code >= 1 and code <= 11 and code != 2; }
pub fn floatType(code: u8) bool { return code == 12 or code == 13; }
pub fn bitWidth(code: u8) u8 {
    if (code == 3 or code == 6) return 8;
    if (code == 4 or code == 7) return 16;
    if (code == 1 or code == 8 or code == 12) return 32;
    if (code == 10 or code == 11) return @bitSizeOf(usize);
    return 64;
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
