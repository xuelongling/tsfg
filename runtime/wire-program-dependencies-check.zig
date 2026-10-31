// SPDX-License-Identifier: MIT
// Independently derive direct Host dependency membership from actual typed
// instruction records, not from declared dependency rows or actual-path facts.
// This is the Host-site subrelation of the original fixed dependency check;
// effective callee flow, transitive effects/resources, full fixed publication,
// artifact provenance and execution/admission remain separate obligations.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

// Preconditions: typed references/layouts/SSA/identity and fixed-interface
// checks already succeeded using this SAME Context. Identity owns the complete
// per-function dependency inventory and original Host digest joins. This pass
// adds the reverse membership equality, not another shape/hash/HSC check.
//
// Scan every function, including module initializers, and every typed block:
// Host metadata dependencies cover even an unvisited language-completion arm.
// A callee's resource effects do not create a direct Host site in its caller.
// Unused module Host declarations are retained without inventing a dependency.
pub fn checkHostSites(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) {
        .common => |value| value,
        else => return error.WrongMode,
    };
    const dependencies = common.authority.fixed_publication.dependencies;
    for (c.program.functions, 0..) |function, index| {
        try c.step();
        var sites: std.AutoHashMapUnmanaged(t.Hash, void) = .empty;
        defer sites.deinit(c.allocator);
        for (function.blocks) |block| {
            try c.step();
            for (block.instructions) |op| {
                try c.step();
                if (op.data == .authorized_host) {
                    try c.step();
                    const host = common.modules.hosts[@intFromEnum(op.data.authorized_host.host)];
                    try sites.put(c.allocator, host.id, {});
                }
            }
        }
        const claimed = dependencies[index].hosts;
        try c.require(claimed.len == sites.count());
        // Prior reference admission guarantees unique claimed Host IDs. Equal
        // cardinality plus membership therefore proves both directions against
        // the independently collected instruction set, including no extras.
        for (claimed) |edge| {
            try c.step();
            try c.require(sites.contains(edge.host_id));
        }
    }
}
