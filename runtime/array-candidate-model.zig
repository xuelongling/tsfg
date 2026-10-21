// SPDX-License-Identifier: MIT
// Array's exact private DTO and binary primitives. String/nullable domain rules
// differ, so only std primitives are shared; this is not an execution model.
const std = @import("std");
const contract = @import("contract.zig");
pub const Allocator = std.mem.Allocator;
pub const Error = error{Invalid} || Allocator.Error;
pub const Range = [2]u32;
pub const Failure = struct { code: []const u8, offset: usize };
pub const Digest = struct {
    bytes: [32]u8,
    pub fn jsonStringify(self: Digest, w: anytype) !void {
        var encoded: [71]u8 = undefined;
        @memcpy(encoded[0..7], "sha256:");
        @memcpy(encoded[7..], &std.fmt.bytesToHex(self.bytes, .lower));
        try w.write(@as([]const u8, &encoded));
    }
};
pub fn digest(comptime hex: []const u8) Digest {
    return .{ .bytes = contract.hexDigest(hex) };
}
pub fn eq(a: Digest, b: Digest) bool {
    return std.mem.eql(u8, &a.bytes, &b.bytes);
}
pub fn text(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}
pub fn same(a: Range, b: Range) bool {
    return a[0] == b[0] and a[1] == b[1];
}
pub fn encloses(a: Range, b: Range) bool {
    return a[0] <= b[0] and b[1] <= a[1];
}
pub fn hash(bytes: []const u8) Digest {
    var value: Digest = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &value.bytes, .{});
    return value;
}
pub const schema = digest("807b15d87fea3ab8f30d1f20893992509e50f8a8bdc96c62db0d66dfdc4c4e91");
pub const formal_schema = digest("3dea6ce5de996dfa3e7141cced985243ea74ac9bb80f03636c6694343118f2a6");
pub const core_schema = digest("4099a1f8633db0326e39bf81f514e63e6287a2589f2128ac7a23e65404e82b06");
pub const f64_id = digest("dfbc72c48bec549ea679cd6aff531f9ebef95e001f6ae0bf419d2f33bf988a6c");
pub const array_id = digest("74dab77c8fbdacf6cf058e37cac033757417c808d57ee23a9c8866565202cb68");
pub const u32_id = digest("b72109639ea1cc95816abe01a09e7e4c78c11902a1251c00090a5715cf9b979c");
pub const view_id = digest("6130247c334f8a7ba10e89f40381e26b0877d57f96860df21befbe668bb6545e");
pub fn typeId(tag: u8) ?Digest {
    return switch (tag) {
        1 => f64_id,
        2 => u32_id,
        3 => array_id,
        4 => view_id,
        else => null,
    };
}
pub const Header = struct { magic: []const u8, version: u32, schema: Digest, totalBytes: u32, payloadHash: Digest };
pub const Marker = struct { family: []const u8, version: u8, schema: Digest, profile: []const u8, factsVersion: u8 };
pub const Source = struct { path: []const u8, hash: Digest, utf16Length: u32 };
pub const TypeOrigin = struct {
    id: Digest,
    kind: []const u8,
    name: []const u8,
    sourcePath: []const u8,
    declarationRange: Range,
    nameRange: Range,
    elementType: ?Digest = null,
    indexSignatureRange: ?Range = null,
    readonly: ?u8 = null,
    pub fn jsonStringify(self: TypeOrigin, w: anytype) !void {
        try w.beginObject();
        inline for (.{ "id", "kind", "name", "sourcePath", "declarationRange", "nameRange" }) |key| {
            try w.objectField(key);
            try w.write(@field(self, key));
        }
        if (self.elementType) |value| {
            try w.objectField("elementType");
            try w.write(value);
        }
        if (self.indexSignatureRange) |value| {
            try w.objectField("indexSignatureRange");
            try w.write(value);
        }
        if (self.readonly) |value| {
            try w.objectField("readonly");
            try w.write(value);
        }
        try w.endObject();
    }
};
pub const ArrayLength = struct { id: Digest, kind: []const u8, name: []const u8, ownerType: Digest, officialType: []const u8, writeType: Digest, sourcePath: []const u8, declarationRange: Range, nameRange: Range, typeRange: Range };
pub const ViewLength = struct { id: Digest, kind: []const u8, name: []const u8, ownerType: Digest, officialType: []const u8, readType: Digest, readonly: u8, sourcePath: []const u8, declarationRange: Range, nameRange: Range, typeRange: Range };
pub const IntrinsicParameter = struct { name: []const u8, declarationRange: Range, nameRange: Range, typeRange: Range };
pub const Intrinsic = struct { id: Digest, kind: []const u8, name: []const u8, sourcePath: []const u8, declarationRange: Range, nameRange: Range, typeParameterRange: Range, parameters: []const IntrinsicParameter, returnTypeRange: Range };
pub const Export = struct { name: []const u8, functionId: Digest };
pub const Parameter = struct {
    id: Digest,
    name: []const u8,
    type: u8,
    writable: u8,
    declarationRange: Range,
    nameRange: Range,
    annotationRange: Range,
    elementAnnotationRange: ?Range = null,
    pub fn jsonStringify(self: Parameter, w: anytype) !void {
        try w.beginObject();
        inline for (.{ "id", "name", "type", "writable", "declarationRange", "nameRange", "annotationRange" }) |key| {
            try w.objectField(key);
            try w.write(@field(self, key));
        }
        if (self.elementAnnotationRange) |value| {
            try w.objectField("elementAnnotationRange");
            try w.write(value);
        }
        try w.endObject();
    }
};
pub const Annotations = union(enum) {
    none,
    typed: struct { annotationRange: Range, elementAnnotationRange: Range },
    pub fn jsonStringify(self: Annotations, w: anytype) !void {
        try w.beginObject();
        try w.objectField("annotationRange");
        switch (self) {
            .none => try w.write([0]u32{}),
            .typed => |value| try w.write(value.annotationRange),
        }
        try w.objectField("elementAnnotationRange");
        switch (self) {
            .none => try w.write([0]u32{}),
            .typed => |value| try w.write(value.elementAnnotationRange),
        }
        try w.endObject();
    }
};
pub const Local = struct { id: Digest, name: []const u8, statementRange: Range, declarationRange: Range, nameRange: Range, annotations: Annotations };
pub const ScalarUse = struct {
    kind: u8,
    binding: ?Digest,
    typeId: Digest,
    range: Range,
    pub fn jsonStringify(self: ScalarUse, w: anytype) !void {
        try w.beginObject();
        try w.objectField("kind");
        try w.write(self.kind);
        try w.objectField("binding");
        if (self.binding) |value| try w.write(value) else try w.write(@as([]const u8, ""));
        try w.objectField("typeId");
        try w.write(self.typeId);
        try w.objectField("range");
        try w.write(self.range);
        try w.endObject();
    }
};
pub const ElementTarget = struct { receiverBinding: Digest, receiverRange: Range, index: ScalarUse, range: Range };
pub const CallRoots = struct { block: u8, instruction: u16, registers: []const u16 };
pub const ViewLifetime = struct { viewRegister: u16, ownerRegister: u16, createInstruction: u16, lastUseInstruction: u16 };
pub const Literal = union(enum) {
    floating: u64,
    integer: u32,
    pub fn jsonStringify(self: Literal, w: anytype) !void {
        switch (self) {
            .integer => |value| try w.write(value),
            .floating => |value| {
                var bits: [8]u8 = undefined;
                std.mem.writeInt(u64, &bits, value, .big);
                const hex = std.fmt.bytesToHex(bits, .lower);
                try w.write(@as([]const u8, &hex));
            },
        }
    }
};
pub const Read = struct { receiverBinding: Digest, receiverRange: Range, index: ScalarUse };
pub const Tail = union(enum) {
    fuel: struct { event: u8 },
    constant: struct { value: Literal },
    create: struct { allocationSite: Digest, local: Local },
    alias: struct { targetBinding: Digest, local: Local },
    read: Read,
    store: struct { target: ElementTarget, value: ScalarUse, expressionRange: Range, operatorRange: Range },
    resize: struct { receiverBinding: Digest, receiverRange: Range, property: Digest, propertyNameRange: Range, targetRange: Range, newLength: ScalarUse, expressionRange: Range, operatorRange: Range },
    view_create: struct { intrinsic: Digest, receiverBinding: Digest, receiverRange: Range, calleeRange: Range, start: ScalarUse, length: ScalarUse, local: Local },
    view_read: Read,
    view_length: struct { receiverBinding: Digest, receiverRange: Range, property: Digest, propertyNameRange: Range, statementRange: Range },
    call: struct { callee: []const u8, sourceCallee: Digest, calleeRange: Range, arguments: []const ScalarUse, statementRange: Range, functionId: Digest, signatureHash: Digest },
    returned: void,
};
pub const Instruction = struct {
    opcode: u8,
    resultType: u8,
    resultRegister: u16,
    sourceRange: Range,
    operands: []const u16,
    metadata: Tail,
    pub fn jsonStringify(self: Instruction, w: anytype) !void {
        try w.beginObject();
        inline for (.{ "opcode", "resultType", "resultRegister", "sourceRange", "operands" }) |key| {
            try w.objectField(key);
            try w.write(@field(self, key));
        }
        try w.objectField("metadata");
        switch (self.metadata) {
            .returned => {
                try w.beginObject();
                try w.endObject();
            },
            inline else => |value| try w.write(value),
        }
        try w.endObject();
    }
};
pub const Function = struct {
    name: []const u8,
    functionId: Digest,
    signatureHash: Digest,
    returnTypeId: Digest,
    sourceRange: Range,
    sourceBinding: Digest,
    nameRange: Range,
    returnAnnotationRange: Range,
    parameters: []const Parameter,
    registerCount: u16,
    blockCount: u8,
    entryArgumentCount: u8,
    callRoots: []const CallRoots,
    viewLifetimes: []const ViewLifetime,
    instructions: []const Instruction,
};
pub const Payload = struct {
    coreVersion: []const u8,
    inputIdentity: Digest,
    sourceHash: Digest,
    sourcePath: []const u8,
    target: []const u8,
    triple: []const u8,
    dataLayout: []const u8,
    formalBytecodeSchema: Digest,
    sourceLength: u32,
    marker: Marker,
    requestId: Digest,
    sources: []const Source,
    types: []const TypeOrigin,
    lengthProperty: ArrayLength,
    viewLengthProperty: ViewLength,
    viewIntrinsic: Intrinsic,
    functionIds: []const Digest,
    exports: []const Export,
    functions: []const Function,
};
pub const Snapshot = struct { header: Header, payload: Payload };
pub const Module = struct { allocator: Allocator, arena: std.heap.ArenaAllocator, bytes: []u8, snapshot: Snapshot };
pub const Reader = struct {
    bytes: []const u8,
    offset: usize = 0,
    failure: Failure = .{ .code = "r04-array-truncated", .offset = 0 },
    pub fn reject(self: *Reader, code: []const u8) error{Invalid} {
        self.failure = .{ .code = code, .offset = self.offset };
        return error.Invalid;
    }
    pub fn require(self: *Reader, ok: bool, code: []const u8) error{Invalid}!void {
        if (!ok) return self.reject(code);
    }
    pub fn remaining(self: *const Reader) usize {
        return self.bytes.len - self.offset;
    }
    pub fn take(self: *Reader, count: usize) error{Invalid}![]const u8 {
        if (count > self.remaining()) return self.reject("r04-array-truncated");
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
    pub fn string(self: *Reader) error{Invalid}![]const u8 {
        const count = try self.int(u32);
        if (count == 0 or count > 1048576) return self.reject("r04-array-limit");
        const value = try self.take(count);
        if (!std.unicode.utf8ValidateSlice(value) or std.mem.indexOfScalar(u8, value, 0) != null) return self.reject("r04-array-utf8");
        return value;
    }
    pub fn range(self: *Reader) error{Invalid}!Range {
        const value: Range = .{ try self.int(u32), try self.int(u32) };
        try self.require(value[0] < value[1] and value[1] <= 65536, "r04-array-source");
        return value;
    }
    pub fn table(self: *Reader, comptime T: type, a: Allocator, count: usize, maximum: usize, minimum: usize) Error![]T {
        // The division is done before multiplication/allocation, including zero tables.
        if (count > maximum or count > self.remaining() / minimum) return self.reject("r04-array-limit");
        return a.alloc(T, count);
    }
};
