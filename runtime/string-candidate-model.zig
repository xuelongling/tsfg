// SPDX-License-Identifier: MIT
// Concrete private String data, independent of the scalar/nullable VM models.
const std = @import("std");
const contract = @import("contract.zig");
pub const Allocator = std.mem.Allocator;
pub const Error = error{Invalid} || Allocator.Error;
pub const Failure = struct { code: []const u8, offset: usize };
pub const Digest = struct {
    bytes: [32]u8,
    pub fn jsonStringify(self: Digest, writer: anytype) !void {
        var text: [71]u8 = undefined;
        @memcpy(text[0..7], "sha256:");
        @memcpy(text[7..], &std.fmt.bytesToHex(self.bytes, .lower));
        try writer.write(@as([]const u8, &text));
    }
};
pub fn digest(comptime text: []const u8) Digest {
    return .{ .bytes = contract.hexDigest(text) };
}
pub const schema = digest("99bdf69a1eeff00f5c9c4a3ed3d30ca856c1e27b9a0d2af0136a140a158a1944");
pub const formal_schema = digest("3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6");
pub const core_schema = digest("3727a29cc92bfc9974b45c4ed3676b3a6f74592e93be533012635e8deca25e8b");
pub const string_type = digest("7d62b2f4422bdcf8ffbd8d54487d799753faecc3655296bfd81d3e94b606a46e");
pub const string_signature = digest("854eb80faa738dba624abb80156ef142ab727222ac63c01620c51768ad44e5c4");
pub fn equal(a: Digest, b: Digest) bool {
    return std.mem.eql(u8, &a.bytes, &b.bytes);
}
pub fn hash(bytes: []const u8) Digest {
    var value: Digest = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &value.bytes, .{});
    return value;
}
pub fn functionHash(path: []const u8, name: []const u8) Digest {
    var state = std.crypto.hash.sha2.Sha256.init(.{});
    state.update("tsfg.function\x00");
    state.update(path);
    state.update("\x00");
    state.update(name);
    state.update("\x00");
    state.update(&std.fmt.bytesToHex(string_signature.bytes, .lower));
    var value: Digest = undefined;
    state.final(&value.bytes);
    return value;
}
pub const Header = struct {
    magic: []const u8,
    wireVersion: u32,
    schemaHash: Digest,
    totalBytes: u32,
    payloadHash: Digest,
};
pub const Concat = struct { left: u8, right: u8, operatorStart: u32, operatorEnd: u32 };
pub const Instruction = struct {
    opcode: u8,
    type: u8,
    result: u8,
    start: u32,
    end: u32,
    data: union(enum) { fuel: u8, constant: []const u16, concat: Concat, returned: u8 },
    pub fn jsonStringify(self: Instruction, writer: anytype) !void {
        try writer.beginObject();
        try writer.objectField("opcode");
        try writer.write(self.opcode);
        try writer.objectField("type");
        try writer.write(self.type);
        try writer.objectField("result");
        try writer.write(self.result);
        try writer.objectField("start");
        try writer.write(self.start);
        try writer.objectField("end");
        try writer.write(self.end);
        switch (self.data) {
            .fuel => |value| {
                try writer.objectField("event");
                try writer.write(value);
            },
            .constant => |value| {
                try writer.objectField("codeUnits");
                try writer.write(value);
            },
            .returned => |value| {
                try writer.objectField("value");
                try writer.write(value);
            },
            .concat => |value| {
                inline for (.{ "left", "right", "operatorStart", "operatorEnd" }) |field| {
                    try writer.objectField(field);
                    try writer.write(@field(value, field));
                }
            },
        }
        try writer.endObject();
    }
};
pub const Function = struct {
    functionId: Digest,
    signatureHash: Digest,
    typeId: Digest,
    name: []const u8,
    start: u32,
    end: u32,
    parameterCount: u8,
    resultType: u8,
    registerCount: u8,
    blockCount: u8,
    instructionCount: u8,
    blockArgumentCount: u8,
    instructions: []const Instruction,
};
pub const Payload = struct {
    target: []const u8,
    triple: []const u8,
    dataLayout: []const u8,
    coreVersion: []const u8,
    formalBytecodeSchema: Digest,
    inputIdentity: Digest,
    sourceHash: Digest,
    sourcePath: []const u8,
    sourceUTF16Length: u32,
    coreStringFamily: []const u8,
    coreStringVersion: u8,
    coreStringSchema: Digest,
    coreStringProfile: []const u8,
    factsVersion: u8,
    functionCount: u8,
    functions: []const Function,
};
pub const Derived = struct {
    // Borrow the same records; never create a second function-ID truth table.
    functions: []const Function,
    literalCount: usize,
    concatCount: usize,
    literalCodeUnits: usize,
    pub fn jsonStringify(self: Derived, writer: anytype) !void {
        try writer.beginObject();
        try writer.objectField("function_ids");
        try writer.beginArray();
        for (self.functions) |function| try writer.write(function.functionId);
        try writer.endArray();
        try writer.objectField("literalCount");
        try writer.write(self.literalCount);
        try writer.objectField("concatCount");
        try writer.write(self.concatCount);
        try writer.objectField("literalCodeUnits");
        try writer.write(self.literalCodeUnits);
        try writer.endObject();
    }
};
pub const Snapshot = struct { header: Header, payload: Payload, derived: Derived };
pub const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, snapshot: Snapshot };
pub const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    failure: Failure = .{ .code = "r04-string-truncated", .offset = 0 },
    pub fn reject(self: *Reader, code: []const u8) error{Invalid} {
        self.failure = .{ .code = code, .offset = self.offset };
        return error.Invalid;
    }
    pub fn remaining(self: *const Reader) usize {
        return self.bytes.len - self.offset;
    }
    pub fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
        if (count > self.remaining()) return self.reject("r04-string-truncated");
        const value = self.bytes[self.offset..][0..count];
        self.offset += count;
        return value;
    }
    pub fn int(self: *Reader, comptime T: type) error{Invalid}!T {
        return std.mem.readInt(T, (try self.take(@sizeOf(T)))[0..@sizeOf(T)], .little);
    }
    pub fn readDigest(self: *Reader) error{Invalid}!Digest {
        return .{ .bytes = (try self.take(32))[0..32].* };
    }
    pub fn string(self: *Reader, allow_nul: bool) error{Invalid}![]const u8 {
        const count = try self.int(u32);
        if (count == 0 or count > 1048576) return self.reject("r04-string-limit");
        const value = try self.take(count);
        if (!std.unicode.utf8ValidateSlice(value) or (!allow_nul and std.mem.indexOfScalar(u8, value, 0) != null))
            return self.reject("r04-string-utf8");
        return value;
    }
    pub fn text(self: *Reader, expected: []const u8) error{Invalid}![]const u8 {
        const value = try self.string(false);
        if (!std.mem.eql(u8, value, expected)) return self.reject("r04-string-target");
        return value;
    }
    pub fn expectInt(self: *Reader, comptime T: type, expected: T) error{Invalid}!T {
        const value = try self.int(T);
        if (value != expected) return self.reject("r04-string-format");
        return value;
    }
    pub fn expectDigest(self: *Reader, expected: Digest) error{Invalid}!Digest {
        const value = try self.readDigest();
        if (!equal(value, expected)) return self.reject("r04-string-schema");
        return value;
    }
};
