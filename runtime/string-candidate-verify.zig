// SPDX-License-Identifier: MIT
// Prove the concrete String profile/identity/source relations before publication.
const std = @import("std");
const m = @import("string-candidate-model.zig");

fn logicalPath(path: []const u8) bool {
    if (path.len == 0 or path[0] != '/' or std.mem.indexOfScalar(u8, path, '\\') != null) return false;
    var parts = std.mem.splitScalar(u8, path[1..], '/');
    while (parts.next()) |part| if (part.len == 0 or std.mem.eql(u8, part, ".") or std.mem.eql(u8, part, "..")) return false;
    return true;
}
fn enclosed(outer: m.Instruction, inner: m.Instruction) bool {
    return inner.start >= outer.start and inner.end <= outer.end;
}
fn operation(reader: *m.Reader, op: m.Instruction, opcode: u8, code: u8, result: u8, function: m.Function) error{Invalid}!void {
    if (op.opcode != opcode or op.type != code or op.result != result) return reader.reject("r04-string-profile");
    if (op.start >= op.end or op.start < function.start or op.end > function.end) return reader.reject("r04-string-source");
}
fn body(reader: *m.Reader, function: m.Function, facts: u8) error{Invalid}!void {
    const ops = function.instructions;
    const fuel = ops[0];
    const returned = ops[ops.len - 1];
    try operation(reader, fuel, 1, 0, 255, function);
    if (fuel.data.fuel != 1 or fuel.start != function.start or fuel.end != function.end) return reader.reject("r04-string-profile");
    try operation(reader, returned, 4, 1, 255, function);
    if (returned.start <= function.start or returned.end >= function.end) return reader.reject("r04-string-source");
    for (ops[1..][0..facts], 0..) |leaf, i| {
        try operation(reader, leaf, 2, 1, @intCast(i), function);
        if (!enclosed(returned, leaf) or leaf.end - leaf.start < 2) return reader.reject("r04-string-source");
    }
    if (facts == 1) {
        if (ops[1].start <= returned.start or returned.data.returned != 0) return reader.reject("r04-string-profile");
    } else {
        const left = ops[1];
        const right = ops[2];
        const expr = ops[3];
        try operation(reader, expr, 3, 1, 2, function);
        const concat = expr.data.concat;
        if (concat.left != 0 or concat.right != 1 or returned.data.returned != 2) return reader.reject("r04-string-profile");
        // <= preserves valid ASI where the expression and return end together.
        if (!enclosed(returned, expr) or expr.start <= returned.start or expr.start != left.start or expr.end != right.end or
            concat.operatorStart >= concat.operatorEnd or concat.operatorEnd - concat.operatorStart != 1 or
            left.end > concat.operatorStart or concat.operatorEnd > right.start)
            return reader.reject("r04-string-source");
        const a = left.data.constant.len;
        const b = right.data.constant.len;
        if (a > 32768 or b > 32768 - a) return reader.reject("r04-string-limit");
    }
}
pub fn verify(reader: *m.Reader, value: m.Snapshot) error{Invalid}!void {
    const payload = value.payload;
    if (!logicalPath(payload.sourcePath)) return reader.reject("r04-string-source");
    for (payload.functions, 0..) |function, index| {
        if (!m.equal(function.typeId, m.string_type) or !m.equal(function.signatureHash, m.string_signature) or
            !m.equal(function.functionId, m.functionHash(payload.sourcePath, function.name)))
            return reader.reject("r04-string-identity");
        if (function.start >= function.end or function.end > payload.sourceUTF16Length or
            (index > 0 and payload.functions[index - 1].end > function.start)) return reader.reject("r04-string-source");
        for (payload.functions[0..index]) |previous| {
            if (std.mem.eql(u8, previous.name, function.name) or m.equal(previous.functionId, function.functionId))
                return reader.reject("r04-string-identity");
        }
        try body(reader, function, payload.factsVersion);
    }
}
