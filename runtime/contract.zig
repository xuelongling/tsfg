// SPDX-License-Identifier: MIT
const std = @import("std");

pub const version: u32 = 4;
pub const schema_hash_hex = "cd7152bad3cdcb1f307adb550b8b4dc58334df38b7e690b942fa81e5b99374a7";
pub const schema_hash = hexDigest(schema_hash_hex);
pub const max_bytes = 1048576;
pub const target = "windows-x86_64-msvc";
pub const triple = "x86_64-pc-windows-msvc";
pub const data_layout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";

pub fn hexDigest(comptime hex: []const u8) [32]u8 {
    var result: [32]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, hex) catch unreachable;
    return result;
}
