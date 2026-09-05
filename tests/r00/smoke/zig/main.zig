// SPDX-License-Identifier: MIT

const builtin = @import("builtin");

const message = "tsfg-r00-zig-smoke: ok\n";

const windows = struct {
    extern "kernel32" fn GetStdHandle(kind: i32) callconv(.winapi) ?*anyopaque;
    extern "kernel32" fn WriteFile(
        handle: ?*anyopaque,
        buffer: [*]const u8,
        count: u32,
        written: *u32,
        overlapped: ?*anyopaque,
    ) callconv(.winapi) i32;
};

fn linuxWrite(buffer: [*]const u8, count: usize) usize {
    return asm volatile ("syscall"
        : [result] "={rax}" (-> usize),
        : [number] "{rax}" (1),
          [fd] "{rdi}" (2),
          [buffer] "{rsi}" (@intFromPtr(buffer)),
          [count] "{rdx}" (count),
        : .{ .rcx = true, .r11 = true, .memory = true });
}

fn linuxExit(status: usize) noreturn {
    _ = asm volatile ("syscall"
        : [result] "={rax}" (-> usize),
        : [number] "{rax}" (60),
          [status] "{rdi}" (status),
        : .{ .rcx = true, .r11 = true, .memory = true });
    @trap();
}

pub export fn _start() callconv(.c) noreturn {
    _ = linuxWrite(message.ptr, message.len);
    linuxExit(0);
}

pub export fn main() callconv(.c) c_int {
    if (builtin.os.tag == .windows) {
        var written: u32 = 0;
        const stderr = windows.GetStdHandle(-12);
        _ = windows.WriteFile(stderr, message.ptr, message.len, &written, null);
    }
    return 0;
}
