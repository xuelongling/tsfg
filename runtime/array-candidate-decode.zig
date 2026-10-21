// SPDX-License-Identifier: MIT
// Exact TSFGARR1 records, never a Core/Source parser or execution decoder.
const m = @import("array-candidate-model.zig");
fn scalarUse(r: *m.Reader, returning: bool) m.Error!m.ScalarUse {
    const kind = try r.int(u8);
    try r.require(kind >= (if (returning) @as(u8, 2) else 1) and kind <= (if (returning) @as(u8, 6) else 5), "r04-array-shape");
    return .{ .kind = kind, .binding = if (kind == 3) try r.readDigest() else null, .typeId = try r.readDigest(), .range = try r.range() };
}
fn scalar(r: *m.Reader) m.Error!m.ScalarUse {
    return scalarUse(r, false);
}
fn optionalRange(r: *m.Reader) m.Error!?m.Range {
    return switch (try r.int(u8)) {
        0 => null,
        1 => try r.range(),
        else => r.reject("r04-array-shape"),
    };
}
fn optionalDigest(r: *m.Reader) m.Error!?m.Digest {
    return switch (try r.int(u8)) {
        0 => null,
        1 => try r.readDigest(),
        else => r.reject("r04-array-shape"),
    };
}
fn local(r: *m.Reader) m.Error!m.Local {
    const id = try r.readDigest();
    const name = try r.string();
    const statement = try r.range();
    const declaration = try r.range();
    const name_range = try r.range();
    const annotation_flag = try r.int(u8);
    const annotations: m.Annotations = switch (annotation_flag) {
        0 => .none,
        1 => .{ .typed = .{ .annotationRange = try r.range(), .elementAnnotationRange = try r.range() } },
        else => return r.reject("r04-array-shape"),
    };
    return .{ .id = id, .name = name, .statementRange = statement, .declarationRange = declaration, .nameRange = name_range, .annotations = annotations };
}
fn read(r: *m.Reader) m.Error!m.Read {
    return .{ .receiverBinding = try r.readDigest(), .receiverRange = try r.range(), .index = try scalar(r) };
}
fn instruction(r: *m.Reader, a: m.Allocator) m.Error!m.Instruction {
    const opcode = try r.int(u8);
    const result_type = try r.int(u8);
    const result = try r.int(u16);
    const source = try r.range();
    const operands = try r.table(u16, a, try r.int(u16), 256, 2);
    for (operands) |*value| value.* = try r.int(u16);
    const tail: m.Tail = switch (opcode) {
        1 => .{ .fuel = .{ .event = try r.int(u8) } },
        2 => .{ .constant = .{ .value = switch (result_type) {
            1 => .{ .floating = try r.int(u64) },
            2 => .{ .integer = try r.int(u32) },
            else => return r.reject("r04-array-type"),
        } } },
        3 => .{ .create = .{ .allocationSite = try r.readDigest(), .local = try local(r) } },
        4 => .{ .alias = .{ .targetBinding = try r.readDigest(), .local = try local(r) } },
        5 => .{ .read = try read(r) },
        6 => .{ .store = .{
            .target = .{ .receiverBinding = try r.readDigest(), .receiverRange = try r.range(), .index = try scalar(r), .range = try r.range() },
            .value = try scalar(r),
            .expressionRange = try r.range(),
            .operatorRange = try r.range(),
        } },
        7 => .{ .resize = .{
            .receiverBinding = try r.readDigest(),
            .receiverRange = try r.range(),
            .property = try r.readDigest(),
            .propertyNameRange = try r.range(),
            .targetRange = try r.range(),
            .newLength = try scalar(r),
            .expressionRange = try r.range(),
            .operatorRange = try r.range(),
        } },
        8 => .{ .view_create = .{
            .intrinsic = try r.readDigest(),
            .receiverBinding = try r.readDigest(),
            .receiverRange = try r.range(),
            .calleeRange = try r.range(),
            .start = try scalar(r),
            .length = try scalar(r),
            .local = try local(r),
        } },
        9 => blk: {
            const value = try read(r);
            break :blk .{ .view_read = .{ .receiverBinding = value.receiverBinding, .receiverRange = value.receiverRange, .index = value.index, .statementRange = try optionalRange(r) } };
        },
        10 => .{ .view_length = .{
            .receiverBinding = try r.readDigest(),
            .receiverRange = try r.range(),
            .property = try r.readDigest(),
            .propertyNameRange = try r.range(),
            .statementRange = try r.range(),
        } },
        11 => blk: {
            const callee = try r.string();
            const id = try r.readDigest();
            const signature = try r.readDigest();
            const binding = try r.readDigest();
            const callee_range = try r.range();
            const args = try r.table(m.ScalarUse, a, try r.int(u8), 8, 41);
            for (args) |*value| value.* = try scalar(r);
            break :blk .{ .call = .{ .callee = callee, .functionId = id, .signatureHash = signature, .sourceCallee = binding, .calleeRange = callee_range, .arguments = args, .statementRange = try r.range(), .consumedDigest = try optionalDigest(r) } };
        },
        12 => .{ .returned = .{ .value = try scalarUse(r, true) } },
        13 => .{ .view_alias = .{ .targetBinding = try r.readDigest(), .local = try local(r) } },
        else => return r.reject("r04-array-shape"),
    };
    return .{ .opcode = opcode, .resultType = result_type, .resultRegister = result, .sourceRange = source, .operands = operands, .metadata = tail };
}
fn function(r: *m.Reader, a: m.Allocator) m.Error!m.Function {
    var value: m.Function = undefined;
    value.name = try r.string();
    value.functionId = try r.readDigest();
    value.signatureHash = try r.readDigest();
    value.returnTypeId = try r.readDigest();
    value.sourceRange = try r.range();
    value.sourceBinding = try r.readDigest();
    value.nameRange = try r.range();
    value.returnAnnotationRange = try r.range();
    const parameters = try r.table(m.Parameter, a, try r.int(u8), 8, 63);
    for (parameters) |*p| {
        p.id = try r.readDigest();
        p.name = try r.string();
        p.type = try r.int(u8);
        p.writable = try r.int(u8);
        p.declarationRange = try r.range();
        p.nameRange = try r.range();
        p.annotationRange = try r.range();
        p.elementAnnotationRange = if (p.type == 3 or p.type == 4) try r.range() else null;
    }
    value.parameters = parameters;
    value.registerCount = try r.int(u16);
    value.blockCount = try r.int(u8);
    value.entryArgumentCount = try r.int(u8);
    const roots = try r.table(m.CallRoots, a, try r.int(u8), 32, 7);
    var root_entries: usize = 0;
    for (roots) |*row| {
        row.block = try r.int(u8);
        row.instruction = try r.int(u16);
        inline for (.{ "arrayRegisters", "viewRegisters" }) |key| {
            const registers = try r.table(u16, a, try r.int(u16), 4219, 2);
            if (registers.len > 1048576 - root_entries) return r.reject("r04-array-limit");
            root_entries += registers.len;
            for (registers) |*item| item.* = try r.int(u16);
            @field(row, key) = registers;
        }
    }
    value.callRoots = roots;
    const views = try r.table(m.ViewLifetime, a, try r.int(u8), 25, 7);
    for (views) |*row| {
        row.viewRegister = try r.int(u16);
        row.owner = switch (try r.int(u8)) {
            1 => .{ .array = try r.int(u16) },
            2 => .{ .parameter = try r.int(u8) },
            else => return r.reject("r04-array-owner"),
        };
        row.origin = switch (try r.int(u8)) {
            1 => .{ .parameter = try r.int(u8) },
            2 => .{ .create = try r.int(u16) },
            else => return r.reject("r04-array-lifetime"),
        };
        row.lastUseInstruction = switch (try r.int(u8)) {
            0 => null,
            1 => try r.int(u16),
            else => return r.reject("r04-array-lifetime"),
        };
    }
    value.viewLifetimes = views;
    const operations = try r.table(m.Instruction, a, try r.int(u16), 4245, 15);
    if (operations.len < 2) return r.reject("r04-array-shape");
    for (operations) |*op| op.* = try instruction(r, a);
    value.instructions = operations;
    return value;
}
fn typeOrigin(r: *m.Reader, index: usize) m.Error!m.TypeOrigin {
    var value: m.TypeOrigin = .{ .id = try r.readDigest(), .kind = try r.string(), .name = try r.string(), .sourcePath = try r.string(), .declarationRange = try r.range(), .nameRange = try r.range() };
    if (index == 1 or index == 3) {
        value.elementType = try r.readDigest();
        value.indexSignatureRange = try r.range();
    }
    if (index == 3) value.readonly = try r.int(u8);
    return value;
}
fn arrayProperty(r: *m.Reader) m.Error!m.ArrayLength {
    return .{ .id = try r.readDigest(), .kind = try r.string(), .name = try r.string(), .ownerType = try r.readDigest(), .officialType = try r.string(), .writeType = try r.readDigest(), .sourcePath = try r.string(), .declarationRange = try r.range(), .nameRange = try r.range(), .typeRange = try r.range() };
}
fn viewProperty(r: *m.Reader) m.Error!m.ViewLength {
    return .{ .id = try r.readDigest(), .kind = try r.string(), .name = try r.string(), .ownerType = try r.readDigest(), .officialType = try r.string(), .readType = try r.readDigest(), .readonly = try r.int(u8), .sourcePath = try r.string(), .declarationRange = try r.range(), .nameRange = try r.range(), .typeRange = try r.range() };
}
fn intrinsic(r: *m.Reader, a: m.Allocator) m.Error!m.Intrinsic {
    var value: m.Intrinsic = undefined;
    value.id = try r.readDigest();
    value.kind = try r.string();
    value.name = try r.string();
    value.sourcePath = try r.string();
    value.declarationRange = try r.range();
    value.nameRange = try r.range();
    value.typeParameterRange = try r.range();
    const count = try r.int(u8);
    try r.require(count == 3, "r04-array-metadata");
    const parameters = try r.table(m.IntrinsicParameter, a, count, 3, 29);
    for (parameters) |*p| p.* = .{ .name = try r.string(), .declarationRange = try r.range(), .nameRange = try r.range(), .typeRange = try r.range() };
    value.parameters = parameters;
    value.returnTypeRange = try r.range();
    return value;
}
fn flag(r: *m.Reader) m.Error!bool {
    return switch (try r.int(u8)) {
        0 => false,
        1 => true,
        else => r.reject("r04-array-publication"),
    };
}
fn publication(r: *m.Reader, a: m.Allocator) m.Error!?m.Publication {
    switch (try r.int(u8)) {
        0 => return null,
        1 => {},
        else => return r.reject("r04-array-publication"),
    }
    // Exact fixed head119 plus at least one PublishedContract101, before any dependent allocation.
    try r.require(r.remaining() >= 220, "r04-array-limit");
    var value: m.Publication = undefined;
    value.family = try r.string();
    value.version = try r.int(u8);
    value.mode = try r.string();
    value.scopeDigest = try r.readDigest();
    value.expectedDigest = try r.readDigest();
    const count = try r.int(u8);
    try r.require(count > 0, "r04-array-publication");
    const rows = try r.table(m.PublishedContract, a, count, 16, 101);
    for (rows) |*row| {
        row.functionId = try r.readDigest();
        row.signatureHash = try r.readDigest();
        const parameters = try r.table(m.PublishedParameter, a, try r.int(u8), 8, 4);
        for (parameters) |*p| p.* = .{ .index = try r.int(u8), .read = try flag(r), .write = try flag(r), .structural = try flag(r) };
        row.upper = .{ .parameters = parameters, .local = .{ .read = try flag(r), .write = try flag(r), .structural = try flag(r) } };
        try r.require(try r.int(u8) == 0, "r04-array-publication");
        row.digest = try r.readDigest();
    }
    value.contracts = rows;
    return value;
}
pub fn parse(r: *m.Reader, a: m.Allocator) m.Error!m.Snapshot {
    const header: m.Header = .{ .magic = try r.take(8), .version = try r.int(u32), .schema = try r.readDigest(), .totalBytes = try r.int(u32), .payloadHash = try r.readDigest() };
    try r.require(m.text(header.magic, "TSFGARR1") and header.version == 2, "r04-array-format");
    try r.require(m.eq(header.schema, m.schema), "r04-array-schema");
    try r.require(header.totalBytes == r.bytes.len, "r04-array-framing");
    try r.require(m.eq(header.payloadHash, m.hash(r.bytes[80..])), "r04-array-hash");
    var p: m.Payload = undefined;
    p.coreVersion = try r.string();
    p.inputIdentity = try r.readDigest();
    p.sourceHash = try r.readDigest();
    p.sourcePath = try r.string();
    p.target = try r.string();
    p.triple = try r.string();
    p.dataLayout = try r.string();
    p.formalBytecodeSchema = try r.readDigest();
    p.sourceLength = try r.int(u32);
    p.marker = .{ .family = try r.string(), .version = try r.int(u8), .schema = try r.readDigest(), .profile = try r.string(), .factsVersion = try r.int(u8) };
    p.requestId = try r.readDigest();
    const source_count = try r.int(u8);
    try r.require(source_count == 2, "r04-array-metadata");
    const sources = try r.table(m.Source, a, source_count, 2, 41);
    for (sources) |*s| s.* = .{ .path = try r.string(), .hash = try r.readDigest(), .utf16Length = try r.int(u32) };
    p.sources = sources;
    const type_count = try r.int(u8);
    try r.require(type_count == 4 and r.remaining() >= 333, "r04-array-limit");
    const types = try r.table(m.TypeOrigin, a, type_count, 4, 63);
    for (types, 0..) |*value, index| value.* = try typeOrigin(r, index);
    p.types = types;
    p.lengthProperty = try arrayProperty(r);
    p.viewLengthProperty = try viewProperty(r);
    p.viewIntrinsic = try intrinsic(r, a);
    const ids = try r.table(m.Digest, a, try r.int(u8), 16, 32);
    try r.require(ids.len > 0, "r04-array-shape");
    for (ids) |*value| value.* = try r.readDigest();
    p.functionIds = ids;
    const exports = try r.table(m.Export, a, try r.int(u8), 16, 37);
    for (exports) |*value| value.* = .{ .name = try r.string(), .functionId = try r.readDigest() };
    p.exports = exports;
    const function_count = try r.int(u8);
    try r.require(function_count == ids.len, "r04-array-shape");
    // Function260 is the exact admitted constant-return structural floor.
    const functions = try r.table(m.Function, a, function_count, 16, 260);
    for (functions) |*value| value.* = try function(r, a);
    p.functions = functions;
    p.publication = try publication(r, a);
    try r.require(r.remaining() == 0, "r04-array-framing");
    return .{ .header = header, .payload = p };
}
