// SPDX-License-Identifier: MIT
// Exact TSFGSTR1 framing and bounded decoding, without evaluating String operations.
const std = @import("std");
const m = @import("string-candidate-model.zig");
const contract = @import("contract.zig");
const Budget = struct { units: usize = 0, literals: usize = 0, concats: usize = 0 };

fn instruction(reader: *m.Reader, allocator: m.Allocator, budget: *Budget) m.Error!m.Instruction {
    var value: m.Instruction = .{
        .opcode = try reader.int(u8),
        .type = try reader.int(u8),
        .result = try reader.int(u8),
        .start = try reader.int(u32),
        .end = try reader.int(u32),
        .data = undefined,
    };
    switch (value.opcode) {
        1 => value.data = .{ .fuel = try reader.int(u8) },
        2 => {
            const count = try reader.int(u16);
            // Prove encoded storage and the remaining package budget before allocation.
            if (count > 16384 or count > reader.remaining() / 2 or count > 65536 - budget.units)
                return reader.reject("r04-string-limit");
            const units = try allocator.alloc(u16, count);
            for (units) |*unit| unit.* = try reader.int(u16);
            value.data = .{ .constant = units };
            budget.units += count;
            budget.literals += 1;
        },
        3 => {
            value.data = .{ .concat = .{
                .left = try reader.int(u8),
                .right = try reader.int(u8),
                .operatorStart = try reader.int(u32),
                .operatorEnd = try reader.int(u32),
            } };
            budget.concats += 1;
        },
        4 => value.data = .{ .returned = try reader.int(u8) },
        else => return reader.reject("r04-string-opcode"),
    }
    return value;
}
fn function(reader: *m.Reader, allocator: m.Allocator, facts: u8, budget: *Budget) m.Error!m.Function {
    var value: m.Function = .{
        .functionId = try reader.readDigest(),
        .signatureHash = try reader.readDigest(),
        .typeId = try reader.readDigest(),
        .name = try reader.string(true),
        .start = try reader.int(u32),
        .end = try reader.int(u32),
        .parameterCount = try reader.int(u8),
        .resultType = try reader.int(u8),
        .registerCount = try reader.int(u8),
        .blockCount = try reader.int(u8),
        .instructionCount = try reader.int(u8),
        .blockArgumentCount = try reader.int(u8),
        .instructions = undefined,
    };
    const count: usize = if (facts == 1) 3 else 5;
    if (value.parameterCount != 0 or value.resultType != 1 or value.registerCount != (if (facts == 1) @as(u8, 1) else 3) or
        value.blockCount != 1 or value.instructionCount != count or value.blockArgumentCount != 0)
        return reader.reject("r04-string-profile");
    // The complete fixed profile costs 37/71 bytes even when every literal is empty.
    const minimum: usize = if (facts == 1) 37 else 71;
    if (count > reader.remaining() / 12 or minimum > reader.remaining()) return reader.reject("r04-string-limit");
    const instructions = try allocator.alloc(m.Instruction, count);
    for (instructions) |*value_op| value_op.* = try instruction(reader, allocator, budget);
    value.instructions = instructions;
    return value;
}
pub fn parse(reader: *m.Reader, allocator: m.Allocator) m.Error!m.Snapshot {
    if (reader.bytes.len > 8388608) return reader.reject("r04-string-limit");
    if (reader.bytes.len < 80) return reader.reject("r04-string-truncated");
    const magic = try reader.take(8);
    if (!std.mem.eql(u8, magic, "TSFGSTR1")) return reader.reject("r04-string-magic");
    const header: m.Header = .{
        .magic = magic,
        .wireVersion = try reader.expectInt(u32, 1),
        .schemaHash = try reader.expectDigest(m.schema),
        .totalBytes = try reader.expectInt(u32, @intCast(reader.bytes.len)),
        .payloadHash = try reader.readDigest(),
    };
    if (!m.equal(header.payloadHash, m.hash(reader.bytes[80..]))) return reader.reject("r04-string-integrity");
    var payload: m.Payload = .{
        .target = try reader.text(contract.target),
        .triple = try reader.text(contract.triple),
        .dataLayout = try reader.text(contract.data_layout),
        .coreVersion = try reader.text("0.9.0"),
        .formalBytecodeSchema = try reader.expectDigest(m.formal_schema),
        // These two digests are opaque provenance, not Source authority.
        .inputIdentity = try reader.readDigest(),
        .sourceHash = try reader.readDigest(),
        .sourcePath = try reader.string(false),
        .sourceUTF16Length = try reader.int(u32),
        .coreStringFamily = try reader.text("tsfg.core-string-candidate"),
        .coreStringVersion = try reader.expectInt(u8, 1),
        .coreStringSchema = try reader.expectDigest(m.core_schema),
        .coreStringProfile = try reader.text("utf16-constant-and-concat-v1"),
        .factsVersion = try reader.int(u8),
        .functionCount = try reader.int(u8),
        .functions = undefined,
    };
    if (payload.sourceUTF16Length > 65536 or payload.functionCount == 0 or payload.functionCount > 64)
        return reader.reject("r04-string-limit");
    if (payload.factsVersion != 1 and payload.factsVersion != 2) return reader.reject("r04-string-profile");
    // 115-byte minimum prefix + the complete 37/71-byte instruction profile.
    // Divide before reserving the function table; no untrusted multiplication.
    const minimum: usize = if (payload.factsVersion == 1) 152 else 186;
    if (payload.functionCount > reader.remaining() / minimum) return reader.reject("r04-string-limit");
    const functions = try allocator.alloc(m.Function, payload.functionCount);
    var budget: Budget = .{};
    for (functions) |*value| value.* = try function(reader, allocator, payload.factsVersion, &budget);
    if (reader.offset != reader.bytes.len) return reader.reject("r04-string-trailing");
    payload.functions = functions;
    return .{ .header = header, .payload = payload, .derived = .{
        .functions = functions,
        .literalCount = budget.literals,
        .concatCount = budget.concats,
        .literalCodeUnits = budget.units,
    } };
}
