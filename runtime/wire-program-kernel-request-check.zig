// SPDX-License-Identifier: MIT
// Kernel request relationships and conflicts between ORIGINAL declarations.
// A fixed upper is checked here as metadata, not accepted as proof of body
// effects. No actual subset can narrow the requested group or its bounds.
// Success is not body noninterference, resource qualification, fixed-flow,
// GPU/Host/Runtime execution permission or complete admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

// Reference admission already guarantees semantic sorted unique Global sets.
// Merge their full declarations; no actual-path or selected-target projection
// is allowed to erase a conflicting name from either set.
fn disjoint(c: *Context, left: []const t.Hash, right: []const t.Hash) Error!bool {
    try c.step();
    var a: usize = 0;
    var b: usize = 0;
    while (a < left.len and b < right.len) {
        try c.step();
        switch (std.mem.order(u8, &left[a], &right[b])) {
            .eq => return false,
            .lt => a += 1,
            .gt => b += 1,
        }
    }
    return true;
}

// Preconditions: the same Context completed refs/layout/SSA/identity and the
// fixed-publication interface checks. Source and full fixed body-flow remain
// separate. References already bound the unique request to zero or 2..32 IDs;
// this phase adds the original business ordering and kernel-root membership.
// Zero preserves the application-only request, not an invented kernel grant.
// No Host Bundle is needed: any DECLARED Host-resource access is rejected,
// rather than deriving Host purity or implementation trust from absent data.
pub fn checkDeclarations(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) {
        .common => |value| value,
        else => return error.WrongMode,
    };
    const fixed = common.authority.fixed_publication;
    const contracts = fixed.publication.contracts;
    var contract_indexes: std.AutoHashMapUnmanaged(t.Hash, usize) = .empty;
    defer contract_indexes.deinit(c.allocator);
    for (contracts, 0..) |row, index| {
        try c.step();
        try contract_indexes.put(c.allocator, row.function_id, index);
    }
    var kernel_roots: std.AutoHashMapUnmanaged(t.Hash, void) = .empty;
    defer kernel_roots.deinit(c.allocator);
    // Identity already joins these normalized roots to the complete Scope.
    // Required roots alone are compilation obligations, not kernel authority.
    for (common.modules.roots.roots) |root| {
        try c.step();
        if (root.kind == .kernel) try kernel_roots.put(c.allocator, root.target, {});
    }

    // The prefix is filled completely below before any pair reads it. The
    // prior bounded request check owns the 32-row ceiling; no heap is copied.
    var selected: [32]*const publication.EffectUpper = undefined;
    var previous: ?t.Hash = null;
    for (fixed.request.targets, 0..) |id, index| {
        try c.step();
        if (previous) |before| {
            try c.step();
            if (std.mem.order(u8, &before, &id) != .lt) return error.InvalidOrder;
        }
        previous = id;
        try c.require(kernel_roots.contains(id));
        const upper = &contracts[contract_indexes.get(id) orelse return error.InvalidReference].upper;
        try c.require(upper.host_resources.reads.len == 0 and upper.host_resources.writes.len == 0);
        for (upper.captures) |access| {
            try c.row(@TypeOf(access));
            try c.require(!access.read and !access.write and !access.structural);
        }
        const facets = upper.facets;
        try c.row(@TypeOf(facets));
        try c.require(!facets.allocation and !facets.managed_reference and !facets.eh_control and
            !facets.may_throw and !facets.@"await" and !facets.lock and !facets.escape and !facets.unknown_host);
        selected[index] = upper;
    }
    const group = selected[0..fixed.request.targets.len];
    for (group, 0..) |left, a| for (group[a + 1 ..]) |right| {
        try c.step();
        try c.require(try disjoint(c, left.globals.writes, right.globals.writes));
        try c.require(try disjoint(c, left.globals.writes, right.globals.reads));
        try c.require(try disjoint(c, left.globals.reads, right.globals.writes));
    };
}
