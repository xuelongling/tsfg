// SPDX-License-Identifier: MIT
// Stable host identities contain no object or backing-store address.
pub const Handle = struct { owner: u64, slot: usize, generation: u64 };
pub const Lifetime = enum { persistent, temporary };
pub const Scope = struct { owner: u64, serial: u64, parent: u64 };
