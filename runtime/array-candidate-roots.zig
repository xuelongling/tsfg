// SPDX-License-Identifier: MIT
// One-block live-before Array SSA roots. Alias registers remain distinct;
// ownership and View lifetime proofs are deliberately separate responsibilities.
const m = @import("array-candidate-model.zig");
const owner = @import("array-candidate-owner.zig");
pub fn verify(r: *m.Reader, f: m.Function, whole_work: *usize, model: *const owner.Model) m.Error!void {
    var pass_work: usize = 0;
    for (f.instructions) |op| {
        try r.require(op.operands.len + 1 <= 1000000 - pass_work, "r04-array-roots");
        pass_work += 1 + op.operands.len;
    }
    // The generic Core algorithm does one fixed-point scan and one point scan
    // for this exact one-block/no-successor domain. Retain its full work budget.
    try r.require(pass_work <= (1000000 - whole_work.*) / 2, "r04-array-roots");
    whole_work.* += 2 * pass_work;
    var live: [4219]bool = @splat(false);
    var point = f.callRoots.len;
    var entries: usize = 0;
    var index = f.instructions.len;
    while (index > 0) {
        index -= 1;
        const op = f.instructions[index];
        if (op.resultType != 0) live[op.resultRegister] = false;
        for (op.operands) |reg| if (model.types[reg] == 3 or model.types[reg] == 4) {
            live[reg] = true;
        };
        if (op.opcode != 11) continue;
        try r.require(point > 0, "r04-array-roots");
        point -= 1;
        const row = f.callRoots[point];
        try r.require(row.arrayRegisters.len <= 25 and row.viewRegisters.len <= 57 and row.arrayRegisters.len + row.viewRegisters.len <= 57, "r04-array-roots");
        try r.require(row.block == 0 and row.instruction == index, "r04-array-roots");
        var arrays: [4219]bool = @splat(false);
        var views: [4219]bool = @splat(false);
        for (live[0..f.registerCount], 0..) |present, reg| if (present) {
            if (model.types[reg] == 3) arrays[reg] = true;
            if (model.types[reg] == 4) {
                views[reg] = true;
                switch (model.owner(@intCast(reg))) {
                    .array => |root| arrays[root] = true,
                    .parameter => {},
                }
            }
        };
        inline for (.{ "arrayRegisters", "viewRegisters" }, 0..) |key, kind| {
            var count: usize = 0;
            const expected = if (kind == 0) arrays else views;
            const supplied = @field(row, key);
            for (expected[0..f.registerCount], 0..) |present, reg| if (present) {
                try r.require(count < supplied.len and supplied[count] == reg, "r04-array-roots");
                count += 1;
            };
            try r.require(count == supplied.len and count <= 1048576 - entries, "r04-array-roots");
            entries += count;
        }
    }
    try r.require(point == 0, "r04-array-roots");
}
