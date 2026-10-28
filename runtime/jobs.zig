// SPDX-License-Identifier: MIT
//! tsfg-jobs storage foundation. Layout checksums provide integrity, not execution authority.
pub const layout = @import("jobs/layout.zig");
pub const Store = @import("jobs/store.zig").Store;
pub const Entity = @import("jobs/store.zig").Entity;
pub const ComponentValue = @import("jobs/store.zig").ComponentValue;
pub const Access = @import("jobs/store.zig").Access;
pub const Selection = @import("jobs/store.zig").Selection;
pub const query_tmeta = @import("jobs/query_tmeta.zig");
