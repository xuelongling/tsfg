// SPDX-License-Identifier: MIT

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const executable = b.addExecutable(.{
        .name = "tsfg-r00-zig-smoke",
        .root_module = b.createModule(.{
            .root_source_file = b.path("main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    executable.lto = .none;
    if (target.result.os.tag == .windows) {
        executable.root_module.link_libc = true;
        executable.root_module.linkSystemLibrary("kernel32", .{});
    }
    b.installArtifact(executable);
}
