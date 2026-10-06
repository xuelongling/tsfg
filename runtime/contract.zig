// SPDX-License-Identifier: MIT
const std = @import("std");

pub const version: u32 = 3;
pub const schema_hash_hex = "80745002f3315a96fd01679dd5d4a3052785dfb6acf8f4bdb56f7e040e1dfb72";
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
