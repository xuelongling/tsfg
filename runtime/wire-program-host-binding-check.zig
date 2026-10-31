// SPDX-License-Identifier: MIT
// Passive data binding for the accepted ECP-0040 Counter profile. Complete
// typed records, not caller safe flags or two unexamined digest claims, are
// checked against the Common Program's original fixed context/dependencies.
// This checks record consistency and reviewed implementation-hash membership.
// It does NOT attest that an artifact was built from these caller-supplied
// records, issue an HSC, or grant Host/Runtime/kernel/execution admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error || error{MissingHostBinding};

// These are full existing JSON record shapes. An external decoder must reject
// unknown/duplicate properties and malformed digest strings before producing
// these typed values; this module is not a raw JSON/transport decoder. Strings
// and all profile/identity constraints are checked here before hashing them.
pub const BuildOptions = struct {
    programCore: ?t.Hash,
    simdDispatch: []const u8,
    sourceTarget: []const u8,
};
pub const BuildIdentity = struct {
    buildInputSetDigest: t.Hash,
    digest: t.Hash,
    options: BuildOptions,
    profile: []const u8,
    source_date_epoch: []const u8,
    target: []const u8,
    toolchainClosureDigest: t.Hash,
};
pub const BuildInput = struct {
    normalizedMode: []const u8,
    projectId: []const u8,
    repositoryRelativePath: []const u8,
    sha256: t.Hash,
};
pub const BuildInputSet = struct {
    digest: t.Hash,
    entries: []const BuildInput,
    schemaVersion: []const u8,
};
pub const Abi = struct {
    callingConvention: []const u8,
    context: struct {
        alignment: u32,
        bytes: u32,
        fields: []const struct { name: []const u8, offset: u32, @"type": []const u8 },
    },
    guest: struct { parameters: []const []const u8, returns: []const u8 },
    native: struct { parameters: []const []const u8, returns: []const u8 },
    target: []const u8,
};
pub const Binding = struct { adapter: []const u8, id: u32, signatureHash: t.Hash, symbol: []const u8 };
pub const Implementation = struct { path: []const u8, sha256: t.Hash };
pub const Semantics = struct {
    borrowedParameters: []const u32,
    callbacks: []const u32,
    callerResources: []const u8,
    effects: []const struct { access: []const u8, operation: []const u8, resource: []const u8 },
    profile: []const u8,
    retainedParameters: []const u32,
    @"return": []const u8,
};
pub const HostSemanticContract = struct {
    abi: Abi,
    binding: Binding,
    buildIdentityDigest: t.Hash,
    digest: t.Hash,
    family: []const u8,
    implementation: []const Implementation,
    semantics: Semantics,
    version: u32,
};
pub const Bundle = struct {
    contract: HostSemanticContract,
    buildIdentity: BuildIdentity,
    buildInputSet: BuildInputSet,
};

fn literal(comptime hex: []const u8) t.Hash {
    if (hex.len != 64) @compileError("Counter profile digest must be complete");
    var out: t.Hash = undefined;
    for (0..32) |i| {
        const a = hex[2 * i]; const b = hex[2 * i + 1];
        out[i] = (if (a <= '9') a - '0' else a - 'a' + 10) * 16 +
            (if (b <= '9') b - '0' else b - 'a' + 10);
    }
    return out;
}
// Exact reviewed profile constants from contracts/host-counter-semantic-v1.json.
// The bridge's native signature is NOT the Source semantic callable signature.
const bridge_signature = literal("76a2b373b39865c4ebbc583bf6084f46f2cc9d396cb7d36953e67d586f472af4");
const implementations = [_]Implementation{
    .{ .path = "runtime/host_counter.c", .sha256 = literal("03da2e65ee50df094e34501ed8aa286b564b19356a437b20479257f458ab2b5e") },
    .{ .path = "runtime/host_counter_bridge.c", .sha256 = literal("8918919374d087a9c5ab0fed04c6f33e35d5c30dee7c64684c3f017679fdcad4") },
};

fn text(c: *Context, actual: []const u8, expected: []const u8) context.Error!void {
    try c.charge(1 + @min(actual.len, expected.len) / 64);
    try c.require(std.mem.eql(u8, actual, expected));
}
fn equal(c: *Context, actual: t.Hash, expected: t.Hash) context.Error!void {
    try c.require(std.mem.eql(u8, &actual, &expected));
}
fn fieldOrder(comptime T: type) [@typeInfo(T).@"struct".fields.len]usize {
    @setEvalBranchQuota(10000);
    const fields = @typeInfo(T).@"struct".fields;
    var indices: [fields.len]usize = undefined;
    for (fields, 0..) |field, i| {
        var at = i;
        while (at != 0 and std.mem.order(u8, fields[indices[at - 1]].name, field.name) == .gt) : (at -= 1)
            indices[at] = indices[at - 1];
        indices[at] = i;
    }
    return indices;
}
// All accepted strings below are fixed ASCII, input paths or decimal digits.
// No floating-point JSON occurs. This streaming JCS encoder neither allocates
// an unmetered canonical copy nor changes the shared Context's work balance.
const JsonHash = struct {
    c: *Context,
    hash: std.crypto.hash.sha2.Sha256 = std.crypto.hash.sha2.Sha256.init(.{}),
    bytes: usize = 0,
    limit: usize = std.math.maxInt(usize),
    fn raw(self: *JsonHash, input: []const u8) context.Error!void {
        try self.c.charge(1 + input.len / 64);
        if (input.len > self.limit - self.bytes) return error.InvalidShape;
        self.bytes += input.len; self.hash.update(input);
    }
    fn string(self: *JsonHash, input: []const u8) context.Error!void {
        try self.c.charge(1 + input.len / 64);
        try self.raw("\""); var start: usize = 0;
        for (input, 0..) |ch, i| {
            const escape: ?[]const u8 = switch (ch) {
                '"' => "\\\"", '\\' => "\\\\", 8 => "\\b", 12 => "\\f", 10 => "\\n", 13 => "\\r", 9 => "\\t", else => null,
            };
            if (escape != null or ch < 32) {
                try self.raw(input[start..i]);
                if (escape) |bytes| try self.raw(bytes) else {
                    const digits = "0123456789abcdef";
                    const bytes = [6]u8{ '\\', 'u', '0', '0', digits[ch >> 4], digits[ch & 15] };
                    try self.raw(&bytes);
                }
                start = i + 1;
            }
        }
        try self.raw(input[start..]); try self.raw("\"");
    }
    fn value(self: *JsonHash, input: anytype) context.Error!void {
        const T = @TypeOf(input);
        if (T == t.Hash) {
            const hex = std.fmt.bytesToHex(input, .lower); var bytes: [71]u8 = undefined;
            @memcpy(bytes[0..7], "sha256:"); @memcpy(bytes[7..], &hex); return self.string(&bytes);
        }
        if (T == BuildOptions) {
            try self.raw("{");
            if (input.programCore) |id| { try self.raw("\"programCore\":"); try self.value(id); try self.raw(","); }
            try self.raw("\"simdDispatch\":"); try self.value(input.simdDispatch);
            try self.raw(",\"sourceTarget\":"); try self.value(input.sourceTarget); return self.raw("}");
        }
        switch (@typeInfo(T)) {
            .int, .comptime_int => { var bytes: [32]u8 = undefined; try self.raw(std.fmt.bufPrint(&bytes, "{d}", .{input}) catch unreachable); },
            .pointer => |p| {
                if (p.size == .one) {
                    if (@typeInfo(p.child) == .array and @typeInfo(p.child).array.child == u8) return self.string(input);
                    return self.value(input.*);
                }
                if (p.size != .slice) @compileError("canonical Host data needs slices or single pointers");
                if (p.child == u8) return self.string(input);
                try self.raw("["); for (input, 0..) |v, i| { try self.c.step(); if (i != 0) try self.raw(","); try self.value(v); } try self.raw("]");
            },
            .array => {
                try self.raw("["); for (input, 0..) |v, i| { try self.c.step(); if (i != 0) try self.raw(","); try self.value(v); } try self.raw("]");
            },
            .@"struct" => |info| {
                try self.raw("{");
                inline for (comptime fieldOrder(T), 0..) |index, i| {
                    try self.c.step(); if (i != 0) try self.raw(",");
                    const field = info.fields[index]; try self.string(field.name); try self.raw(":"); try self.value(@field(input, field.name));
                }
                try self.raw("}");
            },
            else => @compileError("unsupported Host canonical record value"),
        }
    }
    fn finish(self: *JsonHash) t.Hash { var result: t.Hash = undefined; self.hash.final(&result); return result; }
};
fn digest(c: *Context, domain: ?[]const u8, value: anytype) context.Error!t.Hash {
    var out = JsonHash{ .c = c };
    if (domain) |prefix| { try out.raw(prefix); try out.raw("\x00"); }
    try out.value(value); return out.finish();
}

fn profile(c: *Context, h: *const HostSemanticContract) context.Error!void {
    try c.require(h.version == 1); try text(c, h.family, "tsfg.host-semantic-contract");
    try text(c, h.abi.callingConvention, "c-win64"); try text(c, h.abi.target, model.format.target);
    try c.require(h.abi.context.bytes == 16 and h.abi.context.alignment == 8 and h.abi.context.fields.len == 3);
    const names = [_][]const u8{ "storage", "reserved", "events" };
    const kinds = [_][]const u8{ "u32", "u32", "u64" };
    const offsets = [_]u32{ 0, 4, 8 };
    for (h.abi.context.fields, 0..) |field, i| {
        try c.step(); try text(c, field.name, names[i]); try text(c, field.@"type", kinds[i]); try c.require(field.offset == offsets[i]);
    }
    try c.require(h.abi.guest.parameters.len == 1 and h.abi.native.parameters.len == 2);
    try text(c, h.abi.guest.parameters[0], "i32"); try text(c, h.abi.guest.returns, "i32");
    try text(c, h.abi.native.parameters[0], "runtime-owned-counter-pointer"); try text(c, h.abi.native.parameters[1], "u32"); try text(c, h.abi.native.returns, "u32");
    try c.require(h.binding.id == 31); try text(c, h.binding.adapter, "counter"); try text(c, h.binding.symbol, "tsfg_host_counter_bridge"); try equal(c, h.binding.signatureHash, bridge_signature);
    try c.require(h.implementation.len == implementations.len);
    for (h.implementation, implementations) |actual, expected| { try c.step(); try text(c, actual.path, expected.path); try equal(c, actual.sha256, expected.sha256); }
    const s = h.semantics;
    try c.require(s.borrowedParameters.len == 0 and s.callbacks.len == 0 and s.retainedParameters.len == 0 and s.effects.len == 2);
    try text(c, s.callerResources, "scalar-values-only"); try text(c, s.profile, "runtime-owned-counter-wrapping-v1"); try text(c, s.@"return", "post-write-storage-bits");
    const resources = [_][]const u8{ "runtime.counter.storage", "runtime.counter.events" };
    const operations = [_][]const u8{ "add-modulo-u32", "increment-modulo-u64" };
    for (s.effects, 0..) |effect, i| {
        try c.step(); try text(c, effect.access, "read-write"); try text(c, effect.resource, resources[i]); try text(c, effect.operation, operations[i]);
    }
}
fn identity(c: *Context, bi: *const BuildIdentity, inputs: *const BuildInputSet) context.Error!void {
    try text(c, bi.target, model.format.target); try text(c, bi.profile, "debug"); try text(c, bi.options.simdDispatch, "runtime-detected");
    const aot = std.mem.eql(u8, bi.options.sourceTarget, "tsfg-aot");
    if (!aot) try text(c, bi.options.sourceTarget, "tsfg-vm");
    try c.require(aot == (bi.options.programCore != null));
    try c.charge(1 + bi.source_date_epoch.len / 64);
    try c.require(bi.source_date_epoch.len != 0 and bi.source_date_epoch[0] >= '1' and bi.source_date_epoch[0] <= '9');
    for (bi.source_date_epoch) |ch| if (ch < '0' or ch > '9') return error.InvalidShape;
    try text(c, inputs.schemaVersion, "1"); try c.require(inputs.entries.len > 0 and inputs.entries.len <= 4096);
    var previous: []const u8 = ""; var found = [_]bool{ false, false };
    for (inputs.entries) |entry| {
        try c.step(); try text(c, entry.projectId, "tsfg");
        if (!std.mem.eql(u8, entry.normalizedMode, "100644")) try text(c, entry.normalizedMode, "100755");
        const path = entry.repositoryRelativePath;
        try c.charge(1 + path.len / 64); try c.require(path.len != 0);
        var parts = std.mem.splitScalar(u8, path, '/');
        while (parts.next()) |part| {
            try c.step(); try c.require(part.len != 0 and !std.mem.eql(u8, part, ".") and !std.mem.eql(u8, part, ".."));
            for (part) |ch| if (!std.ascii.isAlphanumeric(ch) and ch != '_' and ch != '-' and ch != '.') return error.InvalidShape;
        }
        try c.charge(1 + @min(previous.len, path.len) / 64); try c.require(std.mem.order(u8, previous, path) == .lt); previous = path;
        for (implementations, 0..) |expected, i| {
            try c.charge(1 + @min(path.len, expected.path.len) / 64);
            if (std.mem.eql(u8, path, expected.path)) { try equal(c, entry.sha256, expected.sha256); found[i] = true; }
        }
    }
    try c.require(found[0] and found[1]);
    try equal(c, inputs.digest, try digest(c, null, .{ .entries = inputs.entries, .schemaVersion = inputs.schemaVersion }));
    try equal(c, bi.buildInputSetDigest, inputs.digest);
    try equal(c, bi.digest, try digest(c, null, .{
        .buildInputSetDigest = bi.buildInputSetDigest, .options = bi.options, .profile = bi.profile,
        .source_date_epoch = bi.source_date_epoch, .target = bi.target, .toolchainClosureDigest = bi.toolchainClosureDigest,
    }));
}

// Preconditions: the Program's typed references/layout/identity checks succeeded
// with this same Context. The one non-refillable 100000 budget is shared with
// those checks. Bundle lifetime is the caller's; nothing is retained/allocated.
// A future decoder supplies the COMPLETE records above, not projected hashes.
// Build provenance, staged-input capture/last-touch epoch truth, toolchain
// provenance and actual artifact membership remain the normal builder's duties.
// Self-consistent records are not proof of those independent duties.
pub fn check(c: *Context, material: ?*const Bundle) Error!void {
    if (c.program.tables.mode != .common) return error.WrongMode;
    const v = c.program.tables.mode.common; const fixed = v.authority.fixed_publication;
    try c.step();
    if (v.modules.hosts.len == 0) { try c.require(fixed.stable_scope.host_context == null); return; }
    const bundle = material orelse return error.MissingHostBinding;
    const h = bundle.contract; const bi = bundle.buildIdentity;
    try c.require(v.modules.hosts.len == 1); try profile(c, &h); try identity(c, &bi, &bundle.buildInputSet);
    try equal(c, h.buildIdentityDigest, bi.digest);
    try equal(c, h.digest, try digest(c, "tsfg.host-semantic-contract.v1", .{
        .abi = h.abi, .binding = h.binding, .buildIdentityDigest = h.buildIdentityDigest,
        .family = h.family, .implementation = h.implementation, .semantics = h.semantics, .version = h.version,
    }));
    // Existing verifyCounterHostContract permits at most 16384 transport bytes:
    // canonical full contract plus its one LF. No raw transport is parsed here.
    var transport = JsonHash{ .c = c, .limit = 16383 }; try transport.value(h);
    const scope = fixed.stable_scope.host_context orelse return error.InvalidShape;
    try equal(c, scope.contract_digest, h.digest); try equal(c, scope.build_identity_digest, bi.digest);
    try text(c, c.program.target.target, h.abi.target);
    var scalar_hash = JsonHash{ .c = c }; try scalar_hash.raw("tsfg.type\x00i32"); const i32_id = scalar_hash.finish();
    const guest_signature = try digest(c, "tsfg.module-callable-signature.candidate.v1", .{ .parameters = [_]t.Hash{i32_id}, .returns = i32_id });
    for (v.modules.hosts) |host| {
        try c.step(); try c.require(host.capability == h.binding.id and host.parameter_types.len == 1);
        const input = v.types[@intFromEnum(host.parameter_types[0])]; const output = v.types[@intFromEnum(host.return_type)];
        try c.require(input.kind == .scalar and input.native_code == 1 and output.kind == .scalar and output.native_code == 1);
        try equal(c, input.id, i32_id); try equal(c, output.id, i32_id); try equal(c, host.signature, guest_signature);
        try equal(c, host.contract_digest, h.digest); try equal(c, host.build_identity_digest, bi.digest);
    }
    // Original dependencies remain committed records; do not re-sign or derive
    // narrower Host effects from current actual paths or a caller's return type.
    for (fixed.dependencies) |dependency| for (dependency.hosts) |edge| {
        try c.step(); var found = false;
        for (v.modules.hosts) |host| {
            try c.step(); if (!std.mem.eql(u8, &edge.host_id, &host.id)) continue;
            try equal(c, edge.contract_digest, h.digest); try equal(c, edge.build_identity_digest, bi.digest); found = true; break;
        }
        try c.require(found);
    };
}
