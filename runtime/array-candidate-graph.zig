// SPDX-License-Identifier: MIT
// Complete local call closure, including private/unreachable functions.
const m = @import("array-candidate-model.zig");
pub fn verify(r: *m.Reader, p: m.Payload) m.Error!bool {
    var reachable: [16][16]bool = @splat(@splat(false));
    for (p.functions, 0..) |f, i| for (f.instructions) |op| {
        if (op.opcode != 11) continue;
        var found = false;
        for (p.functions, 0..) |target, j| if (m.text(target.name, op.metadata.call.callee)) {
            reachable[i][j] = true;
            found = true;
        };
        try r.require(found, "r04-array-call");
    };
    const count = p.functions.len;
    for (0..count) |k| for (0..count) |i| for (0..count) |j| {
        reachable[i][j] = reachable[i][j] or (reachable[i][k] and reachable[k][j]);
    };
    var cyclic = false;
    for (0..count) |i| {
        if (!reachable[i][i]) continue;
        cyclic = true;
        for (p.functions, 0..) |f, j| {
            if (i != j and !reachable[i][j]) continue;
            try r.require(!m.eq(f.returnTypeId, m.view_id), "r04-array-call");
            for (f.parameters) |parameter| try r.require(parameter.type != 4, "r04-array-call");
            for (f.instructions) |op| try r.require(op.opcode != 3 and op.resultType != 4 and op.opcode != 9 and op.opcode != 10, "r04-array-call");
        }
    }
    return cyclic;
}
