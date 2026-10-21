// SPDX-License-Identifier: MIT
// One canonical owner/family reconstruction, shared by borrow, roots and fixed coverage.
const std = @import("std");
const m = @import("array-candidate-model.zig");
pub const Model = struct {
    owners: [4219]u16 = @splat(65535),
    types: [4219]u8 = @splat(0),
    parameter_owner: [4219]bool = @splat(false),
    family: [4219]u16 = @splat(65535),
    views: [25]m.ViewLifetime = undefined,
    count: usize = 0,
    pub fn owner(self: *const Model, reg: u16) m.ViewOwner {
        return if (self.types[reg] == 4) self.views[self.family[reg]].owner else .{ .array = self.owners[reg] };
    }
    pub fn parameter(self: *const Model, value: m.ViewOwner) ?u8 {
        return switch (value) {
            .parameter => |slot| slot,
            .array => |reg| if (self.parameter_owner[reg]) @intCast(reg) else null,
        };
    }
    pub fn mayAlias(self: *const Model, left: m.ViewOwner, right: m.ViewOwner) bool {
        return std.meta.eql(left, right) or (self.parameter(left) != null and self.parameter(right) != null);
    }
    fn append(self: *Model, r: *m.Reader, reg: u16, value: m.ViewOwner, origin: m.ViewOrigin, family: ?u16) m.Error!void {
        try r.require(self.count < self.views.len, "r04-array-limit");
        self.family[reg] = family orelse @intCast(self.count);
        self.views[self.count] = .{ .viewRegister = reg, .owner = value, .origin = origin, .lastUseInstruction = null };
        self.count += 1;
    }
};
pub fn charge(r: *m.Reader, work: *usize, count: usize) m.Error!void {
    try r.require(count <= 16384 - work.*, "r04-array-limit");
    work.* += count;
}
pub fn derive(r: *m.Reader, f: m.Function, work: *usize) m.Error!Model {
    var model: Model = .{};
    for (f.parameters, 0..) |p, i| {
        model.types[i] = p.type;
        if (p.type == 3) {
            model.owners[i] = @intCast(i);
            model.parameter_owner[i] = true;
        }
        if (p.type == 4) try model.append(r, @intCast(i), .{ .parameter = @intCast(i) }, .{ .parameter = @intCast(i) }, null);
    }
    for (f.instructions, 0..) |op, i| {
        try charge(r, work, 1);
        if (op.resultType != 0) model.types[op.resultRegister] = op.resultType;
        switch (op.opcode) {
            3 => model.owners[op.resultRegister] = op.resultRegister,
            4 => {
                const root = model.owners[op.operands[0]];
                try r.require(root != 65535, "r04-array-owner");
                model.owners[op.resultRegister] = root;
            },
            8 => {
                const root = model.owners[op.operands[0]];
                try r.require(root != 65535, "r04-array-owner");
                try model.append(r, op.resultRegister, .{ .array = root }, .{ .create = @intCast(i) }, null);
            },
            13 => {
                const family = model.family[op.operands[0]];
                try r.require(family < model.count, "r04-array-owner");
                const first = model.views[family];
                try model.append(r, op.resultRegister, first.owner, first.origin, family);
            },
            else => {},
        }
    }
    for (f.instructions, 0..) |op, i| for (op.operands) |reg| {
        if (model.types[reg] != 4) continue;
        try charge(r, work, 1);
        const family = model.family[reg];
        try r.require(family < model.count, "r04-array-lifetime");
        model.views[family].lastUseInstruction = @intCast(i);
    };
    // Family last use propagates to each distinct original alias SSA row.
    for (model.views[0..model.count]) |*view| view.lastUseInstruction = model.views[model.family[view.viewRegister]].lastUseInstruction;
    return model;
}
fn active(view: m.ViewLifetime, index: usize, call: bool) bool {
    const last = view.lastUseInstruction orelse return false;
    const began = switch (view.origin) {
        .parameter => true,
        .create => |at| at < index,
    };
    return began and (if (call) index <= last else index < last);
}
pub fn verify(r: *m.Reader, p: m.Payload, f: m.Function, model: *const Model) m.Error!void {
    try r.require(f.viewLifetimes.len == model.count, "r04-array-lifetime");
    for (f.viewLifetimes, model.views[0..model.count]) |supplied, actual| try r.require(std.meta.eql(supplied, actual), "r04-array-lifetime");
    var lengths: [4219]i64 = @splat(-1);
    var borrow_lengths: [4219]i64 = @splat(-1);
    var literals: [4219]i64 = @splat(-1);
    for (f.instructions, 0..) |op, i| {
        if (op.opcode == 2 and op.resultType == 2) literals[op.resultRegister] = op.metadata.constant.value.integer;
        if (op.opcode == 3) {
            lengths[op.resultRegister] = @intCast(op.operands.len);
            borrow_lengths[op.resultRegister] = @intCast(op.operands.len);
        }
        if (op.opcode == 6 or op.opcode == 7) {
            const root = model.owners[op.operands[0]];
            try r.require(root != 65535, "r04-array-owner");
            const n = literals[op.operands[1]];
            const old = lengths[root];
            const borrow_old = borrow_lengths[root];
            const store = op.opcode == 6;
            const known = !model.parameter_owner[root] and borrow_old >= 0 and n >= 0;
            const nonstructural = known and (if (store) n < borrow_old else n == borrow_old);
            for (model.views[0..model.count]) |view| if (active(view, i, false)) {
                try r.require(!model.mayAlias(view.owner, .{ .array = root }) or nonstructural, "r04-array-borrow");
            };
            if (n < 0 or model.parameter_owner[root]) {
                lengths[root] = -1;
                borrow_lengths[root] = -1;
            } else {
                try r.require(old < 0 or n <= old, "r04-array-density");
                lengths[root] = if (!store) n else if (old < 0) -1 else @max(old, n + 1);
                borrow_lengths[root] = if (!store) n else if (borrow_old < 0) -1 else @max(borrow_old, n + 1);
            }
        }
        if (op.opcode == 11) {
            const target = op.metadata.call;
            if (p.publication) |publication| for (publication.contracts) |contract| {
                if (!m.eq(contract.functionId, target.functionId)) continue;
                for (contract.upper.parameters) |slot| {
                    if (!slot.structural) continue;
                    const mapped = model.owner(op.operands[slot.index]);
                    for (model.views[0..model.count]) |view| if (active(view, i, true)) {
                        // Fixed effects precede argument completion: equality with last-use still holds.
                        try r.require(!model.mayAlias(view.owner, mapped), "r04-array-borrow");
                    };
                }
            };
            for (op.operands) |reg| {
                if (model.types[reg] == 3) lengths[model.owners[reg]] = -1;
                if (model.types[reg] == 3 or model.types[reg] == 4) switch (model.owner(reg)) {
                    .array => |root| borrow_lengths[root] = -1,
                    .parameter => {},
                };
            }
        }
    }
}
