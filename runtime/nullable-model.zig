// SPDX-License-Identifier: MIT
// Private nullable wire model; these values never alias the scalar VM model.
const std = @import("std");
pub const scalar = @import("contract.zig");
pub const Allocator = std.mem.Allocator;
pub const Hash = [32]u8;
pub const schema = scalar.hexDigest("30ad00db29b3809aa36bad19c525d9b3af8f3c77431efa5edcfe081f540fa4e8");
pub const core_schema = "sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd";
pub const Failure = struct { code: []const u8, offset: usize };
pub const Error = error{Invalid} || Allocator.Error;
pub const Parameter = struct { register: u16, type_code: u8 };
pub const Block = struct { parameters: []const Parameter, start: usize, count: u16 };
pub const Instruction = struct {
    opcode: u8,
    type_code: u8,
    register: u16,
    immediate: u32,
    literal_bits: u64 = 0,
    source_start: u32,
    source_end: u32,
    edges: [2][]const u16 = .{ &.{}, &.{} },
};
const NumericBytes = struct {
    values: []const u8,
    pub fn jsonStringify(self: NumericBytes, writer: anytype) !void {
        try writer.beginArray();
        for (self.values) |value| try writer.write(value);
        try writer.endArray();
    }
};
pub const Function = struct {
    role: u8,
    id: Hash,
    signature: Hash,
    type_id: Hash,
    name: []const u8,
    start: u32,
    end: u32,
    return_type: u8,
    parameter_types: []const u8,
    register_count: u16,
    blocks: []const Block,
    register_types: []const u8,
    instructions: []const Instruction,
    pub fn jsonStringify(self: Function, writer: anytype) !void {
        try writer.write(.{ .role = self.role, .id = NumericBytes{ .values = &self.id }, .signature = NumericBytes{ .values = &self.signature }, .type_id = NumericBytes{ .values = &self.type_id }, .name = self.name, .start = self.start, .end = self.end, .return_type = self.return_type, .parameter_types = NumericBytes{ .values = self.parameter_types }, .register_count = self.register_count, .blocks = self.blocks, .register_types = NumericBytes{ .values = self.register_types }, .instructions = self.instructions });
    }
};
pub const Snapshot = struct {
    wire_version: u32 = 1,
    wire_schema: Hash = schema,
    packet_bytes: usize,
    target: []const u8,
    triple: []const u8,
    data_layout: []const u8,
    input_identity: Hash,
    source_hash: Hash,
    source_path: []const u8,
    source_length: u32,
    entry_index: usize,
    functions: []const Function,
    pub fn jsonStringify(self: Snapshot, writer: anytype) !void {
        try writer.write(.{ .wire_version = self.wire_version, .wire_schema = NumericBytes{ .values = &self.wire_schema }, .packet_bytes = self.packet_bytes, .target = self.target, .triple = self.triple, .data_layout = self.data_layout, .input_identity = NumericBytes{ .values = &self.input_identity }, .source_hash = NumericBytes{ .values = &self.source_hash }, .source_path = self.source_path, .source_length = self.source_length, .entry_index = self.entry_index, .functions = self.functions });
    }
};
pub const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, snapshot: Snapshot };

pub const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    failure: Failure = .{ .code = "r04-nullable-truncated", .offset = 0 },
    pub fn reject(self: *Reader, code: []const u8) error{Invalid} {
        self.failure = .{ .code = code, .offset = self.offset };
        return error.Invalid;
    }
    pub fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
        if (count > self.bytes.len - self.offset) return self.reject("r04-nullable-truncated");
        const bytes = self.bytes[self.offset..][0..count];
        self.offset += count;
        return bytes;
    }
    pub fn int(self: *Reader, comptime T: type) error{Invalid}!T {
        return std.mem.readInt(T, (try self.take(@sizeOf(T)))[0..@sizeOf(T)], .little);
    }
    pub fn digest(self: *Reader) error{Invalid}!Hash {
        return (try self.take(32))[0..32].*;
    }
    pub fn string(self: *Reader, maximum: usize) error{Invalid}![]const u8 {
        const count = try self.int(u32);
        if (count == 0 or count > maximum) return self.reject("r04-nullable-string");
        const bytes = try self.take(count);
        if (!std.unicode.utf8ValidateSlice(bytes) or std.mem.indexOfScalar(u8, bytes, 0) != null)
            return self.reject("r04-nullable-string");
        return bytes;
    }
    pub fn expected(self: *Reader, comptime T: type, value: T) error{Invalid}!void {
        if (try self.int(T) != value) return self.reject("r04-nullable-format");
    }
    pub fn text(self: *Reader, value: []const u8) error{Invalid}![]const u8 {
        const bytes = try self.string(4096);
        if (!std.mem.eql(u8, bytes, value)) return self.reject("r04-nullable-target");
        return bytes;
    }
};
pub fn hash(bytes: []const u8) Hash {
    var digest: Hash = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    return digest;
}
pub fn nullable(code: u8) bool {
    return code >= 241 and code <= 243;
}
pub fn valid(code: u8) bool {
    return scalar.validType(code) or nullable(code);
}
pub fn allowed(code: u8) u8 {
    return if (nullable(code)) 1 | ((code - 240) << 1) else 0;
}
pub fn result(opcode: u8) bool {
    return opcode != 2 and opcode != 24 and opcode != 25 and opcode != 26;
}
pub fn prefix(value: Hash) [71]u8 {
    var text: [71]u8 = undefined;
    @memcpy(text[0..7], "sha256:");
    @memcpy(text[7..], &std.fmt.bytesToHex(value, .lower));
    return text;
}
fn recordHash(allocator: Allocator, domain: []const u8, value: anytype) Allocator.Error!Hash {
    // Each concrete record declares its fields in JCS key order; strings use JSON escaping.
    const json = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(json);
    var digest = std.crypto.hash.sha2.Sha256.init(.{});
    digest.update(domain);
    digest.update("\x00" ++ core_schema ++ "\x00");
    digest.update(json);
    var out: Hash = undefined;
    digest.final(&out);
    return out;
}
pub fn typeHash(allocator: Allocator, code: u8) Allocator.Error!Hash {
    const domain = "tsfg.core-nullable-candidate.type.v1";
    if (scalar.validType(code)) return recordHash(allocator, domain, .{ .kind = "scalar", .name = scalar.typeName(code) });
    return recordHash(allocator, domain, .{ .kind = "nullable-i32", .null = (code - 240) & 2 != 0, .undefined = (code - 240) & 1 != 0 });
}
pub fn signatureHash(allocator: Allocator, parameters: []const u8, returned: u8) Allocator.Error!Hash {
    const texts = try allocator.alloc([71]u8, parameters.len);
    defer allocator.free(texts);
    const views = try allocator.alloc([]const u8, parameters.len);
    defer allocator.free(views);
    for (parameters, texts, views) |code, *text, *view| {
        text.* = prefix(try typeHash(allocator, code));
        view.* = text;
    }
    const result_text = prefix(try typeHash(allocator, returned));
    return recordHash(allocator, "tsfg.core-nullable-candidate.signature.v1", .{ .parameters = views, .returnType = @as([]const u8, &result_text) });
}
pub fn functionHash(allocator: Allocator, name: []const u8, signature: Hash, source: Hash, path: []const u8) Allocator.Error!Hash {
    const signature_text = prefix(signature);
    const source_text = prefix(source);
    return recordHash(allocator, "tsfg.core-nullable-candidate.function.v1", .{ .name = name, .signatureHash = @as([]const u8, &signature_text), .source = .{ .digest = @as([]const u8, &source_text), .path = path } });
}
