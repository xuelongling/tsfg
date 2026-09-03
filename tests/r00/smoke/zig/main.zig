// SPDX-License-Identifier: MIT

const std = @import("std");

pub fn main() void {
    std.debug.assert(2 + 2 == 4);
    std.debug.print("tsfg-r00-zig-smoke: ok\n", .{});
}
