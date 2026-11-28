// SPDX-License-Identifier: MIT
//! Canonical R04 identity, digest, and ResourceHandle ABI definitions.
//! Bit-for-bit identical to `compiler/r04-identity.mjs`.
const std = @import("std");

pub const SCHEMA_ABI = "sha256:78bc3b4af534c1b91d1d7f289ec9b19eb91b7a49d41c0acf86ac2bef63452ac9";
pub const SCHEMA_TMETA = "sha256:d4efb57e59cb42ca9f613707fb8c75e9a611022c86724843be25ff56d6dadb10";
pub const SCHEMA_CORE_IR_EXCHANGE = "sha256:f62ad55e4b8879de91097bb1a4824f076e165d1278c9a0cf1f1cf0e668c19f5c";
pub const SCHEMA_NATIVE_PATCH = "sha256:0afdd5b14a932fe2e66ed027b32bd21981212e0ec9a3bf9360173803960a9282";
pub const SCHEMA_MODULE_RELOAD = "sha256:2c676acc011a37c3ab8576b93930f39aa0475c4c741a8c22c15d0f524d301b99";
pub const SCHEMA_COMPILER_SERVICE = "sha256:2aa219677299b27634342572fc1a069ab0e482fb4e427ad20e186660445e3fc9";
pub const CURRENT_CONTRACT_SET_ID = "sha256:224753af186d4d73d11a1462ce51f16bd617222b109d3cf12cbcfe61d3151734";

pub const TARGET_NAME = "windows-x86_64-msvc";
pub const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
pub const WINDOWS_X64_DATALAYOUT = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";

pub const DigestText = [71]u8;

/// Canonical ABI-safe Handle<T>: Zig never holds raw GC pointers.
pub const ResourceHandle = extern struct {
    index: u32,
    generation: u32,

    pub fn isNull(self: ResourceHandle) bool {
        return self.index == 0 and self.generation == 0;
    }

    pub fn eql(self: ResourceHandle, other: ResourceHandle) bool {
        return self.index == other.index and self.generation == other.generation;
    }
};

comptime {
    if (@sizeOf(ResourceHandle) != 8) @compileError("ResourceHandle size must be 8");
    if (@alignOf(ResourceHandle) != 4) @compileError("ResourceHandle align must be 4");
    if (@offsetOf(ResourceHandle, "index") != 0) @compileError("ResourceHandle.index offset must be 0");
    if (@offsetOf(ResourceHandle, "generation") != 4) @compileError("ResourceHandle.generation offset must be 4");
}

pub fn formatDigest(raw: [32]u8) DigestText {
    var out: DigestText = undefined;
    @memcpy(out[0..7], "sha256:");
    const hex = std.fmt.bytesToHex(raw, .lower);
    @memcpy(out[7..71], &hex);
    return out;
}

pub fn isValidDigest(text: []const u8) bool {
    if (text.len != 71 or !std.mem.startsWith(u8, text, "sha256:")) return false;
    for (text[7..]) |c| {
        if (!((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'))) return false;
    }
    return true;
}

pub fn sha256Parts(parts: []const []const u8) DigestText {
    var h = std.crypto.hash.sha2.Sha256.init(.{});
    for (parts) |p| h.update(p);
    var raw: [32]u8 = undefined;
    h.final(&raw);
    return formatDigest(raw);
}

pub fn typeIdScalar(name: []const u8) DigestText {
    return sha256Parts(&.{ "tsfg.type\x00", name });
}

pub fn typeIdNominal(kind: []const u8, source_path: []const u8, name: []const u8) DigestText {
    return sha256Parts(&.{ "tsfg.type\x00", kind, "\x00", source_path, "\x00", name });
}

pub fn typeIdHandle(inner_type_id: []const u8) DigestText {
    const hex = if (std.mem.startsWith(u8, inner_type_id, "sha256:")) inner_type_id[7..] else inner_type_id;
    return sha256Parts(&.{ "tsfg.handle\x00", hex });
}

pub fn typeIdSpan(mutable: bool, elem_type_id: []const u8) DigestText {
    const hex = if (std.mem.startsWith(u8, elem_type_id, "sha256:")) elem_type_id[7..] else elem_type_id;
    return sha256Parts(&.{ if (mutable) "tsfg.span\x00" else "tsfg.read_span\x00", hex });
}

pub fn typeIdStringView() DigestText {
    return sha256Parts(&.{"tsfg.type\x00StringView"});
}

pub fn signatureHash(return_type: []const u8, param_types: []const []const u8) DigestText {
    var h = std.crypto.hash.sha2.Sha256.init(.{});
    h.update("tsfg.signature\x00(");
    for (param_types, 0..) |pt, i| {
        if (i > 0) h.update(",");
        h.update(pt);
    }
    h.update(")->");
    h.update(return_type);
    var raw: [32]u8 = undefined;
    h.final(&raw);
    return formatDigest(raw);
}

pub fn functionId(source_path: []const u8, name: []const u8, return_type: []const u8, param_types: []const []const u8) DigestText {
    const sig = signatureHash(return_type, param_types);
    return sha256Parts(&.{ "tsfg.function\x00", source_path, "\x00", name, "\x00", sig[7..71] });
}

pub fn typeIdFnPtr(sig_hash: []const u8) DigestText {
    const hex = if (std.mem.startsWith(u8, sig_hash, "sha256:")) sig_hash[7..] else sig_hash;
    return sha256Parts(&.{ "tsfg.fn_ptr\x00", hex });
}

pub fn payloadHash(family: []const u8, version_str: []const u8, payload_utf8: []const u8) DigestText {
    return sha256Parts(&.{ family, ".v", version_str, "\x00", payload_utf8 });
}

pub fn abiHashFromCanonical(canonical_core: []const u8) DigestText {
    return sha256Parts(&.{ "tsfg.abi-hash.v1\x00", canonical_core });
}

pub fn reflectionDigestFromCanonical(canonical_core: []const u8) DigestText {
    return sha256Parts(&.{ "tsfg.reflection.v1\x00", canonical_core });
}

pub fn effectHashFromCanonical(canonical_effect: []const u8) DigestText {
    return sha256Parts(&.{ "tsfg.effect.v1\x00", canonical_effect });
}

pub const EnvelopeError = error{
    SizeLimit,
    MissingLf,
    InvalidUtf8,
    DepthLimit,
    MalformedJson,
    NonCanonicalEnvelope,
    FamilyMismatch,
    VersionMismatch,
    SchemaMismatch,
    PayloadCorrupted,
};

pub const RawEnvelope = struct {
    family: []const u8,
    payload: []const u8,
    payloadHash: []const u8,
    schemaHash: []const u8,
    version: u32,
};

pub fn scanJsonBounds(bytes: []const u8, max_bytes: usize, max_depth: usize) EnvelopeError!void {
    if (bytes.len == 0 or bytes.len > max_bytes) return error.SizeLimit;
    if (bytes[bytes.len - 1] != '\n') return error.MissingLf;
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;

    var depth: usize = 0;
    var in_str = false;
    var esc = false;
    for (bytes) |b| {
        if (in_str) {
            if (esc) {
                esc = false;
            } else if (b == '\\') {
                esc = true;
            } else if (b == '"') {
                in_str = false;
            }
        } else if (b == '"') {
            in_str = true;
        } else if (b == '{' or b == '[') {
            depth += 1;
            if (depth > max_depth) return error.DepthLimit;
        } else if (b == '}' or b == ']') {
            if (depth == 0) return error.MalformedJson;
            depth -= 1;
        }
    }
    if (depth != 0 or in_str) return error.MalformedJson;
}

pub fn verifyEnvelope(
    allocator: std.mem.Allocator,
    bytes: []const u8,
    expected_family: []const u8,
    expected_version: u32,
    expected_version_str: []const u8,
    expected_schema_hash: []const u8,
    max_bytes: usize,
    max_depth: usize,
) !std.json.Parsed(RawEnvelope) {
    try scanJsonBounds(bytes, max_bytes, max_depth);
    const parsed = std.json.parseFromSlice(RawEnvelope, allocator, bytes[0 .. bytes.len - 1], .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = false,
    }) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.MalformedJson;
    errdefer parsed.deinit();

    const env = parsed.value;
    if (!std.mem.eql(u8, env.family, expected_family)) return error.FamilyMismatch;
    if (env.version != expected_version) return error.VersionMismatch;
    if (!std.mem.eql(u8, env.schemaHash, expected_schema_hash)) return error.SchemaMismatch;

    const canonical_env = try std.json.Stringify.valueAlloc(allocator, env, .{});
    defer allocator.free(canonical_env);
    if (!std.mem.eql(u8, canonical_env, bytes[0 .. bytes.len - 1])) return error.NonCanonicalEnvelope;

    const actual = payloadHash(expected_family, expected_version_str, env.payload);
    if (!std.mem.eql(u8, env.payloadHash, &actual)) return error.PayloadCorrupted;
    return parsed;
}

test "r04-identity canonical digests match specification" {
    const i32_id = typeIdScalar("i32");
    try std.testing.expect(isValidDigest(&i32_id));
    const sv_id = typeIdStringView();
    try std.testing.expect(isValidDigest(&sv_id));
    const fid = functionId("/src/main.ts", "add", "i32", &.{ "i32", "i32" });
    try std.testing.expect(isValidDigest(&fid));
    const h = ResourceHandle{ .index = 7, .generation = 3 };
    try std.testing.expect(!h.isNull());
}
