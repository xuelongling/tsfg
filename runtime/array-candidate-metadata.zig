// SPDX-License-Identifier: MIT
// Finite Core11 origin/identity grammar. No Source reconstruction or generic JCS.
const std = @import("std");
const m = @import("array-candidate-model.zig");
const Sha = std.crypto.hash.sha2.Sha256;
fn finish(state: *Sha) m.Digest {
    var value: m.Digest = undefined;
    state.final(&value.bytes);
    return value;
}
fn decimal(state: *Sha, value: u32) void {
    var buffer: [10]u8 = undefined;
    state.update(std.fmt.bufPrint(&buffer, "{d}", .{value}) catch unreachable);
}
fn quote(state: *Sha, value: []const u8) void {
    state.update("\"");
    for (value) |c| switch (c) {
        '"' => state.update("\\\""),
        '\\' => state.update("\\\\"),
        8 => state.update("\\b"),
        12 => state.update("\\f"),
        10 => state.update("\\n"),
        13 => state.update("\\r"),
        9 => state.update("\\t"),
        else => if (c < 32) {
            const hex = "0123456789abcdef";
            state.update(&.{ '\\', 'u', '0', '0', hex[c >> 4], hex[c & 15] });
        } else state.update(&.{c}),
    };
    state.update("\"");
}
pub fn sourceIdentity(path: []const u8, anchor: m.Range, site: bool) m.Digest {
    var state = Sha.init(.{});
    state.update(if (site) "tsfg.array-facts.allocation-site.v1\x00" else "tsfg.array-facts.binding.v1\x00");
    state.update(if (site) "{\"range\":{\"end\":" else "{\"nameRange\":{\"end\":");
    decimal(&state, anchor[1]);
    state.update(",\"start\":");
    decimal(&state, anchor[0]);
    state.update("},\"sourcePath\":");
    quote(&state, path);
    state.update("}");
    return finish(&state);
}
fn signature(parameters: []const m.Parameter) m.Digest {
    var state = Sha.init(.{});
    state.update("tsfg.signature\x00(");
    for (parameters, 0..) |p, i| {
        if (i != 0) state.update(",");
        state.update(switch (p.type) {
            1 => "f64",
            2 => "u32",
            3 => "array.f64",
            else => unreachable,
        });
    }
    state.update(")->f64");
    return finish(&state);
}
fn functionIdentity(path: []const u8, name: []const u8, sig: m.Digest) m.Digest {
    var state = Sha.init(.{});
    state.update("tsfg.function\x00");
    state.update(path);
    state.update("\x00");
    state.update(name);
    state.update("\x00");
    state.update(&std.fmt.bytesToHex(sig.bytes, .lower));
    return finish(&state);
}
fn pathValid(path: []const u8) bool {
    if (path.len == 0 or path[0] != '/' or std.mem.indexOfScalar(u8, path, '\\') != null) return false;
    var parts = std.mem.splitScalar(u8, path[1..], '/');
    while (parts.next()) |part| if (part.len == 0 or m.text(part, ".") or m.text(part, "..")) return false;
    return true;
}
fn sources(r: *m.Reader, p: m.Payload) m.Error![]const u8 {
    try r.require(p.sourceLength <= 65536 and pathValid(p.sourcePath), "r04-array-source");
    var root = false;
    var dts: []const u8 = "";
    for (p.sources, 0..) |s, i| {
        try r.require(pathValid(s.path) and s.utf16Length <= 65536 and (i == 0 or std.mem.lessThan(u8, p.sources[i - 1].path, s.path)), "r04-array-source");
        if (m.text(s.path, p.sourcePath)) {
            try r.require(!root and std.mem.endsWith(u8, s.path, ".ts") and !std.mem.endsWith(u8, s.path, ".d.ts") and m.eq(s.hash, p.sourceHash) and s.utf16Length == p.sourceLength, "r04-array-identity");
            root = true;
        } else {
            try r.require(std.mem.endsWith(u8, s.path, "/minimal-arrays-v3.d.ts") and s.utf16Length == 484 and m.eq(s.hash, m.digest("282b335a6e0e0493fa74a3c1dd56f234f8c679079acdaf0600cefb8306c26415")), "r04-array-identity");
            dts = s.path;
        }
    }
    try r.require(root and dts.len > 0, "r04-array-source");
    const slash = std.mem.lastIndexOfScalar(u8, dts, '/').?;
    try r.require(std.mem.startsWith(u8, p.sourcePath, dts[0 .. slash + 1]), "r04-array-source");
    return dts;
}
fn origins(r: *m.Reader, p: m.Payload, dts: []const u8) m.Error!void {
    const ids = [_]m.Digest{ m.f64_id, m.array_id, m.u32_id, m.view_id };
    const kinds = [_][]const u8{ "scalar", "managedReference", "scalar", "view" };
    const names = [_][]const u8{ "f64", "Array", "u32", "ReadSpan" };
    const declarations = [_]m.Range{ .{ 293, 311 }, .{ 238, 292 }, .{ 312, 330 }, .{ 331, 403 } };
    const name_ranges = [_]m.Range{ .{ 298, 301 }, .{ 248, 253 }, .{ 317, 320 }, .{ 341, 349 } };
    for (p.types, 0..) |row, i| {
        try r.require(m.eq(row.id, ids[i]) and m.text(row.kind, kinds[i]) and m.text(row.name, names[i]) and m.text(row.sourcePath, dts), "r04-array-identity");
        try r.require(m.same(row.declarationRange, declarations[i]) and m.same(row.nameRange, name_ranges[i]), "r04-array-source");
        if (i == 1 or i == 3) {
            try r.require(m.eq(row.elementType.?, m.f64_id) and m.same(row.indexSignatureRange.?, if (i == 1) .{ 259, 274 } else .{ 355, 379 }), "r04-array-source");
        }
        if (i == 3) try r.require(row.readonly.? == 1, "r04-array-metadata");
    }
    const ap = p.lengthProperty;
    try r.require(m.text(ap.kind, "property") and m.text(ap.name, "length") and m.eq(ap.ownerType, m.array_id) and m.text(ap.officialType, "number") and m.eq(ap.writeType, m.u32_id) and m.text(ap.sourcePath, dts), "r04-array-identity");
    try r.require(m.same(ap.declarationRange, .{ 275, 290 }) and m.same(ap.nameRange, .{ 275, 281 }) and m.same(ap.typeRange, .{ 283, 289 }), "r04-array-source");
    try r.require(m.eq(ap.id, sourceIdentity(dts, ap.nameRange, false)), "r04-array-identity");
    const vp = p.viewLengthProperty;
    try r.require(m.text(vp.kind, "property") and m.text(vp.name, "length") and m.eq(vp.ownerType, m.view_id) and m.text(vp.officialType, "number") and m.eq(vp.readType, m.u32_id) and vp.readonly == 1 and m.text(vp.sourcePath, dts), "r04-array-identity");
    try r.require(m.same(vp.declarationRange, .{ 380, 401 }) and m.same(vp.nameRange, .{ 389, 395 }) and m.same(vp.typeRange, .{ 397, 400 }), "r04-array-source");
    try r.require(m.eq(vp.id, sourceIdentity(dts, vp.nameRange, false)), "r04-array-identity");
    const vi = p.viewIntrinsic;
    try r.require(m.text(vi.kind, "intrinsic") and m.text(vi.name, "readSpan") and m.text(vi.sourcePath, dts) and m.eq(vi.id, sourceIdentity(dts, vi.nameRange, false)), "r04-array-identity");
    try r.require(m.same(vi.declarationRange, .{ 404, 483 }) and m.same(vi.nameRange, .{ 421, 429 }) and m.same(vi.typeParameterRange, .{ 430, 431 }) and m.same(vi.returnTypeRange, .{ 471, 482 }), "r04-array-source");
    const param_names = [_][]const u8{ "owner", "start", "length" };
    const param_decls = [_]m.Range{ .{ 433, 443 }, .{ 445, 455 }, .{ 457, 468 } };
    const param_ranges = [_]m.Range{ .{ 433, 438 }, .{ 445, 450 }, .{ 457, 463 } };
    const param_types = [_]m.Range{ .{ 440, 443 }, .{ 452, 455 }, .{ 465, 468 } };
    for (vi.parameters, 0..) |row, i| try r.require(m.text(row.name, param_names[i]) and m.same(row.declarationRange, param_decls[i]) and m.same(row.nameRange, param_ranges[i]) and m.same(row.typeRange, param_types[i]), "r04-array-source");
}
fn parameter(r: *m.Reader, p: m.Payload, f: m.Function, value: m.Parameter, previous: u32) m.Error!void {
    try r.require(value.type >= 1 and value.type <= 3 and value.writable == 1, "r04-array-type");
    const d = value.declarationRange;
    const n = value.nameRange;
    const t = value.annotationRange;
    try r.require(m.encloses(f.sourceRange, d) and d[0] > previous and d[1] < f.returnAnnotationRange[0] and d[0] == n[0] and d[1] == t[1] and n[1] < t[0] and m.encloses(d, n) and m.encloses(d, t), "r04-array-source");
    if (value.type == 3) {
        const element = value.elementAnnotationRange.?;
        try r.require(m.encloses(t, element) and element[1] < t[1], "r04-array-source");
    }
    try r.require(m.eq(value.id, sourceIdentity(p.sourcePath, n, false)), "r04-array-identity");
}
// The explicit registry includes private/unreachable functions and every local;
// supplied equal-looking digests never bypass global original-binding uniqueness.
const Bindings = struct {
    values: [419]m.Digest = undefined,
    count: usize = 0,
    fn add(self: *Bindings, r: *m.Reader, value: m.Digest) m.Error!void {
        for (self.values[0..self.count]) |old| try r.require(!m.eq(old, value), "r04-array-identity");
        try r.require(self.count < self.values.len, "r04-array-limit");
        self.values[self.count] = value;
        self.count += 1;
    }
};
pub fn verify(r: *m.Reader, p: m.Payload) m.Error!void {
    try r.require(m.text(p.coreVersion, "0.9.0") and m.text(p.target, "windows-x86_64-msvc") and m.text(p.triple, "x86_64-pc-windows-msvc") and m.text(p.dataLayout, "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128") and m.eq(p.formalBytecodeSchema, m.formal_schema), "r04-array-identity");
    try r.require(m.text(p.marker.family, "tsfg.core-array-candidate") and p.marker.version == 11 and m.eq(p.marker.schema, m.core_schema) and m.text(p.marker.profile, "dense-f64-array-local-readspan-checked-v11") and p.marker.factsVersion == 7, "r04-array-identity");
    const dts = try sources(r, p);
    try origins(r, p, dts);
    var bindings: Bindings = .{};
    try bindings.add(r, p.lengthProperty.id);
    try bindings.add(r, p.viewLengthProperty.id);
    try bindings.add(r, p.viewIntrinsic.id);
    var previous: u32 = 0;
    for (p.functions, 0..) |f, i| {
        const d = f.sourceRange;
        const n = f.nameRange;
        const t = f.returnAnnotationRange;
        try r.require(d[1] <= p.sourceLength and d[0] >= previous and m.encloses(d, n) and m.encloses(d, t) and n[0] > d[0] and n[1] < t[0] and t[1] < d[1], "r04-array-source");
        for (p.functions[0..i]) |old| try r.require(!m.text(old.name, f.name), "r04-array-identity");
        try r.require(m.eq(f.sourceBinding, sourceIdentity(p.sourcePath, n, false)), "r04-array-identity");
        try bindings.add(r, f.sourceBinding);
        var prior = n[1];
        for (f.parameters, 0..) |param, j| {
            try parameter(r, p, f, param, prior);
            for (f.parameters[0..j]) |old| try r.require(!m.text(old.name, param.name), "r04-array-identity");
            try bindings.add(r, param.id);
            prior = param.declarationRange[1];
        }
        const sig = signature(f.parameters);
        const id = functionIdentity(p.sourcePath, f.name, sig);
        try r.require(m.eq(f.signatureHash, sig) and m.eq(f.functionId, id) and m.eq(p.functionIds[i], id) and m.eq(f.returnTypeId, m.f64_id), "r04-array-identity");
        for (p.functions[0..i]) |old| try r.require(!m.eq(old.functionId, id), "r04-array-identity");
        previous = d[1];
    }
    for (p.functions) |f| for (f.instructions) |op| {
        const loc: ?m.Local = switch (op.metadata) {
            .create => |v| v.local,
            .alias => |v| v.local,
            .view_create => |v| v.local,
            else => null,
        };
        if (loc) |value| try bindings.add(r, value.id);
    };
    for (p.exports, 0..) |ex, i| {
        try r.require(i == 0 or std.mem.lessThan(u8, p.exports[i - 1].name, ex.name), "r04-array-identity");
        var found = false;
        for (p.functions) |f| if (m.text(ex.name, f.name) and m.eq(ex.functionId, f.functionId)) {
            found = true;
        };
        try r.require(found, "r04-array-identity");
    }
}
