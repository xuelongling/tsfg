// SPDX-License-Identifier: MIT
// Existing Publication4 hashes and independent finite owner-effect coverage.
// No Source authority: these recipes use only the complete retained packet fields.
const std = @import("std");
const m = @import("array-candidate-model.zig");
const metadata = @import("array-candidate-metadata.zig");
const owners = @import("array-candidate-owner.zig");
const Sha = std.crypto.hash.sha2.Sha256;
const JsonHash = struct {
    state: Sha,
    fn init(domain: []const u8) JsonHash {
        var value: JsonHash = .{ .state = Sha.init(.{}) };
        value.raw(domain);
        return value;
    }
    fn raw(self: *JsonHash, bytes: []const u8) void {
        self.state.update(bytes);
    }
    fn string(self: *JsonHash, bytes: []const u8) void {
        metadata.quote(&self.state, bytes);
    }
    fn number(self: *JsonHash, value: u32) void {
        metadata.decimal(&self.state, value);
    }
    fn digest(self: *JsonHash, value: m.Digest) void {
        self.raw("\"sha256:");
        self.raw(&std.fmt.bytesToHex(value.bytes, .lower));
        self.raw("\"");
    }
    fn flag(self: *JsonHash, value: bool) void {
        self.raw(if (value) "true" else "false");
    }
    fn flags(self: *JsonHash, value: anytype) void {
        self.raw("{\"read\":");
        self.flag(value.read);
        self.raw(",\"structural\":");
        self.flag(value.structural);
        self.raw(",\"write\":");
        self.flag(value.write);
        self.raw("}");
    }
    fn upper(self: *JsonHash, value: m.PublishedUpper) void {
        self.raw("{\"local\":");
        self.flags(value.local);
        self.raw(",\"parameters\":[");
        for (value.parameters, 0..) |parameter, i| {
            if (i != 0) self.raw(",");
            self.raw("{\"index\":");
            self.number(parameter.index);
            self.raw(",\"read\":");
            self.flag(parameter.read);
            self.raw(",\"structural\":");
            self.flag(parameter.structural);
            self.raw(",\"write\":");
            self.flag(parameter.write);
            self.raw("}");
        }
        self.raw("],\"returnOrigin\":null}");
    }
    fn contract(self: *JsonHash, value: m.PublishedContract, include_digest: bool) void {
        self.raw("{");
        if (include_digest) {
            self.raw("\"digest\":");
            self.digest(value.digest);
            self.raw(",");
        }
        self.raw("\"functionId\":");
        self.digest(value.functionId);
        self.raw(",\"signatureHash\":");
        self.digest(value.signatureHash);
        self.raw(",\"upper\":");
        self.upper(value.upper);
        self.raw("}");
    }
    fn finish(self: *JsonHash) m.Digest {
        return metadata.finish(&self.state);
    }
};
fn less(functions: []const m.Function, left: usize, right: usize) bool {
    return std.mem.lessThan(u8, &functions[left].functionId.bytes, &functions[right].functionId.bytes);
}
fn logical(tag: u8) []const u8 {
    return switch (tag) {
        1 => "f64",
        2 => "u32",
        3 => "array.f64",
        4 => "readspan.f64",
        else => unreachable,
    };
}
fn scope(p: m.Payload, order: []const usize) m.Digest {
    var json = JsonHash.init("tsfg.array-call-scope.v4\x00");
    json.raw("{\"exports\":[");
    for (p.exports, 0..) |ex, i| {
        if (i != 0) json.raw(",");
        json.raw("{\"functionId\":");
        json.digest(ex.functionId);
        json.raw(",\"name\":");
        json.string(ex.name);
        json.raw("}");
    }
    json.raw("],\"functions\":[");
    for (order, 0..) |index, i| {
        const f = p.functions[index];
        if (i != 0) json.raw(",");
        json.raw("{\"functionId\":");
        json.digest(f.functionId);
        json.raw(",\"name\":");
        json.string(f.name);
        json.raw(",\"parameterTypes\":[");
        for (f.parameters, 0..) |parameter, j| {
            if (j != 0) json.raw(",");
            json.string(logical(parameter.type));
        }
        json.raw("],\"returnType\":\"f64\",\"signatureHash\":");
        json.digest(f.signatureHash);
        json.raw(",\"sourcePath\":");
        json.string(p.sourcePath);
        json.raw("}");
    }
    json.raw("],\"profile\":\"array-readspan-array-origin-return-scc-owner-relative-fixed-v4\",\"rootFile\":");
    json.string(p.sourcePath);
    json.raw("}");
    return json.finish();
}
pub fn contract(p: m.Payload, id: m.Digest) ?m.PublishedContract {
    if (p.publication) |publication| for (publication.contracts) |row| if (m.eq(row.functionId, id)) return row;
    return null;
}
pub fn verifyContext(r: *m.Reader, p: m.Payload, cyclic: bool) m.Error!void {
    var has_view = false;
    for (p.functions) |f| {
        for (f.parameters) |parameter| if (parameter.type == 4) {
            has_view = true;
        };
        for (f.instructions) |op| if (op.resultType == 4 or op.opcode == 9 or op.opcode == 10) {
            has_view = true;
        };
    }
    if (p.publication) |publication| {
        try r.require(m.text(publication.family, "tsfg.array-publication-context-candidate") and publication.version == 4 and m.text(publication.mode, "fixed") and publication.contracts.len == p.functions.len, "r04-array-publication");
        var order: [16]usize = undefined;
        for (0..p.functions.len) |i| order[i] = i;
        std.mem.sort(usize, order[0..p.functions.len], p.functions, less);
        for (publication.contracts, order[0..p.functions.len]) |row, index| {
            const f = p.functions[index];
            try r.require(m.eq(row.functionId, f.functionId) and m.eq(row.signatureHash, f.signatureHash), "r04-array-publication");
            var count: usize = 0;
            for (f.parameters, 0..) |parameter, slot| {
                if (parameter.type != 3 and parameter.type != 4) continue;
                try r.require(count < row.upper.parameters.len, "r04-array-publication");
                const upper = row.upper.parameters[count];
                try r.require(upper.index == slot and (parameter.type != 4 or (!upper.write and !upper.structural)), "r04-array-publication");
                count += 1;
            }
            try r.require(count == row.upper.parameters.len, "r04-array-publication");
            var json = JsonHash.init("tsfg.array-published-contract.v4\x00");
            json.contract(row, false);
            try r.require(m.eq(row.digest, json.finish()), "r04-array-publication-hash");
        }
        try r.require(m.eq(publication.scopeDigest, scope(p, order[0..p.functions.len])), "r04-array-publication-hash");
        var json = JsonHash.init("tsfg.array-publication.v4\x00");
        json.raw("{\"contracts\":[");
        for (publication.contracts, 0..) |row, i| {
            if (i != 0) json.raw(",");
            json.contract(row, true);
        }
        json.raw("],\"scopeDigest\":");
        json.digest(publication.scopeDigest);
        json.raw("}");
        try r.require(m.eq(publication.expectedDigest, json.finish()), "r04-array-publication-hash");
    } else try r.require(!has_view and !cyclic, "r04-array-publication");
    for (p.functions) |f| for (f.instructions) |op| {
        if (op.opcode != 11) continue;
        if (contract(p, op.metadata.call.functionId)) |row| {
            try r.require(op.metadata.call.consumedDigest != null and m.eq(op.metadata.call.consumedDigest.?, row.digest), "r04-array-publication");
        } else try r.require(p.publication == null and op.metadata.call.consumedDigest == null, "r04-array-publication");
    };
}
fn mask(flags: anytype) u3 {
    return @as(u3, if (flags.read) 1 else 0) | @as(u3, if (flags.write) 2 else 0) | @as(u3, if (flags.structural) 4 else 0);
}
// f64-only results cannot export a fresh owner. For coverage, all distinct local
// allocations/call-local owners share the upper.local facet; actual borrow owner
// identity remains distinct in owners.Model. No transmitted field is projected.
pub const Analysis = struct {
    const Call = struct { target: usize, slots: [8]u8 = @splat(255) };
    direct: [16][9]u3 = @splat(@splat(0)),
    calls: [16][32]Call = undefined,
    counts: [16]usize = @splat(0),
    fn slot(model: *const owners.Model, reg: u16) u8 {
        return model.parameter(model.owner(reg)) orelse 8;
    }
    pub fn add(self: *Analysis, r: *m.Reader, p: m.Payload, index: usize, model: *const owners.Model, work: *usize) m.Error!void {
        for (p.functions[index].instructions) |op| {
            try owners.charge(r, work, 1);
            const flags: u3 = switch (op.opcode) {
                5, 8, 9 => 1,
                6 => 6,
                7 => 4,
                else => 0,
            };
            if (flags != 0) self.direct[index][slot(model, op.operands[0])] |= flags;
            if (op.opcode != 11) continue;
            var target: usize = 0;
            while (target < p.functions.len and !m.eq(p.functions[target].functionId, op.metadata.call.functionId)) : (target += 1) {}
            try r.require(target < p.functions.len and self.counts[index] < 32, "r04-array-call");
            var call: Call = .{ .target = target };
            for (op.operands, 0..) |reg, full_slot| if (model.types[reg] == 3 or model.types[reg] == 4) {
                call.slots[full_slot] = slot(model, reg);
            };
            self.calls[index][self.counts[index]] = call;
            self.counts[index] += 1;
        }
    }
    pub fn verify(self: *const Analysis, r: *m.Reader, p: m.Payload, work: *usize) m.Error!void {
        if (p.publication == null) return;
        var derived = self.direct;
        var grew = true;
        while (grew) {
            grew = false;
            for (0..p.functions.len) |i| for (self.calls[i][0..self.counts[i]]) |call| {
                for (derived[call.target], 0..) |flags, target_slot| {
                    if (flags == 0) continue;
                    try owners.charge(r, work, 1);
                    const mapped = if (target_slot == 8) 8 else call.slots[target_slot];
                    try r.require(mapped < 9, "r04-array-publication");
                    const next = derived[i][mapped] | flags;
                    grew = grew or next != derived[i][mapped];
                    derived[i][mapped] = next;
                }
            };
        }
        var effective = self.direct;
        for (0..p.functions.len) |i| for (self.calls[i][0..self.counts[i]]) |call| {
            const upper = contract(p, p.functions[call.target].functionId).?.upper;
            for (upper.parameters) |parameter| {
                try owners.charge(r, work, 1);
                const mapped = call.slots[parameter.index];
                try r.require(mapped < 9, "r04-array-publication");
                effective[i][mapped] |= mask(parameter);
            }
            effective[i][8] |= mask(upper.local);
        };
        for (p.functions, 0..) |f, i| {
            const upper = contract(p, f.functionId).?.upper;
            for (upper.parameters) |parameter| try r.require(((effective[i][parameter.index] | derived[i][parameter.index]) & ~mask(parameter)) == 0, "r04-array-publication-coverage");
            try r.require(((effective[i][8] | derived[i][8]) & ~mask(upper.local)) == 0, "r04-array-publication-coverage");
        }
    }
};
