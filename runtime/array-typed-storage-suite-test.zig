// SPDX-License-Identifier: MIT
// Bounded real storage regression; no bytecode, VM, native runner or Source IO.
test {
    _ = @import("array-typed-storage-first-test.zig");
    _ = @import("array-typed-storage-test.zig");
    _ = @import("array-typed-storage-oom-test.zig");
    _ = @import("array-storage-test.zig");
    _ = @import("string-storage-test.zig");
}
