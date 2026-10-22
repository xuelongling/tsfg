// SPDX-License-Identifier: MIT
test {
    _ = @import("typed-array-backing-test.zig");
    _ = @import("typed-array-backing-generic-test.zig");
    _ = @import("typed-field-backing-test.zig");
    _ = @import("array-typed-storage-first-test.zig");
    _ = @import("array-typed-storage-test.zig");
    _ = @import("array-typed-storage-oom-test.zig");
}
