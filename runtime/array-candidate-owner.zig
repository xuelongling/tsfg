// SPDX-License-Identifier: MIT
// Static owner/density/View proof from actual SSA uses, never storage execution.
const m = @import("array-candidate-model.zig");
pub fn verify(r: *m.Reader, f: m.Function) m.Error!void {
    var owners: [4219]u16 = @splat(65535);
    var types: [4219]u8 = @splat(0);
    var parameter_owner: [4219]bool = @splat(false);
    var lengths: [4219]i64 = @splat(-1);
    var literals: [4219]i64 = @splat(-1);
    var views: [17]m.ViewLifetime = undefined;
    var view_by_register: [4219]u16 = @splat(65535);
    var view_count: usize = 0;
    for (f.parameters, 0..) |p, i| {
        types[i] = p.type;
        if (p.type == 3) {
            owners[i] = @intCast(i);
            parameter_owner[i] = true;
        }
    }
    for (f.instructions, 0..) |op, i| {
        if (op.resultType != 0) types[op.resultRegister] = op.resultType;
        switch (op.opcode) {
            2 => if (op.resultType == 2) {
                literals[op.resultRegister] = op.metadata.constant.value.integer;
            },
            3 => owners[op.resultRegister] = op.resultRegister,
            4 => {
                const root = owners[op.operands[0]];
                try r.require(root != 65535, "r04-array-owner");
                owners[op.resultRegister] = root;
            },
            8 => {
                const root = owners[op.operands[0]];
                try r.require(root != 65535 and view_count < 17, "r04-array-owner");
                views[view_count] = .{ .viewRegister = op.resultRegister, .ownerRegister = root, .createInstruction = @intCast(i), .lastUseInstruction = @intCast(i) };
                view_by_register[op.resultRegister] = @intCast(view_count);
                view_count += 1;
            },
            else => {},
        }
    }
    for (f.instructions, 0..) |op, i| for (op.operands) |reg| {
        if (types[reg] != 4) continue;
        const index = view_by_register[reg];
        try r.require(index < view_count and i > views[index].createInstruction, "r04-array-lifetime");
        views[index].lastUseInstruction = @intCast(i);
    };
    try r.require(f.viewLifetimes.len == view_count, "r04-array-lifetime");
    for (f.viewLifetimes, views[0..view_count]) |supplied, actual| {
        try r.require(supplied.viewRegister == actual.viewRegister and supplied.ownerRegister == actual.ownerRegister and supplied.createInstruction == actual.createInstruction and supplied.lastUseInstruction == actual.lastUseInstruction, "r04-array-lifetime");
    }
    for (f.instructions, 0..) |op, i| {
        if (op.opcode == 3) lengths[owners[op.resultRegister]] = @intCast(op.operands.len);
        if (op.opcode == 6 or op.opcode == 7) {
            const owner = owners[op.operands[0]];
            try r.require(owner != 65535, "r04-array-owner");
            const n = literals[op.operands[1]];
            const old = lengths[owner];
            const store = op.opcode == 6;
            const known = !parameter_owner[owner] and old >= 0 and n >= 0;
            const nonstructural = known and (if (store) n < old else n == old);
            for (views[0..view_count]) |view| {
                const overlaps = view.ownerRegister == owner or (parameter_owner[view.ownerRegister] and parameter_owner[owner]);
                try r.require(!(overlaps and view.createInstruction < i and i < view.lastUseInstruction and !nonstructural), "r04-array-borrow");
            }
            if (n < 0 or parameter_owner[owner]) lengths[owner] = -1 else {
                try r.require(old < 0 or n <= old, "r04-array-density");
                lengths[owner] = if (!store) n else if (old < 0) -1 else @max(old, n + 1);
            }
        }
        if (op.opcode == 11) {
            for (views[0..view_count]) |view| try r.require(!(view.createInstruction < i and i < view.lastUseInstruction), "r04-array-borrow");
            for (op.operands) |reg| if (types[reg] == 3) {
                try r.require(owners[reg] != 65535, "r04-array-owner");
                lengths[owners[reg]] = -1;
            };
        }
    }
}
