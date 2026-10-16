// SPDX-License-Identifier: MIT
// S1 regression coverage for the opcode33 unary-plus dispatch seam.
// Every fixture below is a complete wire-v8 module: it must pass the full
// loader verification before execution, and each case below is executed by the
// real State/executeStep dispatcher through the public eval_bytecode path.
const std = @import("std");
const runtime = @import("root.zig");
const contract = @import("contract.zig");
const Sha256 = std.crypto.hash.sha2.Sha256;

const Fixture = struct { bytes: []u8, unary_offset: usize };

const Encoder = struct {
    bytes: []u8,
    at: usize = 0,
    fn put(self: *Encoder, value: []const u8) void {
        @memcpy(self.bytes[self.at .. self.at + value.len], value);
        self.at += value.len;
    }
    fn byte(self: *Encoder, value: u8) void {
        self.bytes[self.at] = value;
        self.at += 1;
    }
    fn le16(self: *Encoder, value: u16) void {
        std.mem.writeInt(u16, self.bytes[self.at..][0..2], value, .little);
        self.at += 2;
    }
    fn le32(self: *Encoder, value: u32) void {
        std.mem.writeInt(u32, self.bytes[self.at..][0..4], value, .little);
        self.at += 4;
    }
    fn le64(self: *Encoder, value: u64) void {
        std.mem.writeInt(u64, self.bytes[self.at..][0..8], value, .little);
        self.at += 8;
    }
    fn str(self: *Encoder, value: []const u8) void {
        self.le32(@intCast(value.len));
        self.put(value);
    }
};

fn hashText(parts: []const []const u8) [32]u8 {
    var digest = Sha256.init(.{});
    for (parts) |part| digest.update(part);
    var result: [32]u8 = undefined;
    digest.final(&result);
    return result;
}

// One single-block function whose body is entry fuel then either
// `return +parameter` (parameter) or `return +literal` (constant opcode32).
fn unaryPlusFixture(allocator: std.mem.Allocator, comptime type_code: u8, comptime parameter: bool, comptime literal_bits: u64) !Fixture {
    const signature_text = comptime if (parameter)
        (if (type_code == 12) "tsfg.signature\x00(f32)->f32" else "tsfg.signature\x00(f64)->f64")
    else
        (if (type_code == 12) "tsfg.signature\x00()->f32" else "tsfg.signature\x00()->f64");
    const type_text = comptime if (type_code == 12) "tsfg.type\x00f32" else "tsfg.type\x00f64";
    const function_name = comptime if (parameter)
        (if (type_code == 12) "unary32" else "unary64")
    else
        (if (type_code == 12) "unarylit32" else "unarylit64");
    const signature_hash = hashText(&.{signature_text});
    const type_id = hashText(&.{type_text});
    const signature_hex = std.fmt.bytesToHex(signature_hash, .lower);
    const function_id = hashText(&.{ "tsfg.function\x00/opcode33.ts\x00", function_name, "\x00", &signature_hex });

    var buffer: [1024]u8 = undefined;
    var writer = Encoder{ .bytes = &buffer };
    const zeros = [_]u8{0} ** 32;
    writer.put("TSFGTBC0");
    writer.le32(contract.version);
    writer.put(&contract.schema_hash);
    writer.le32(0); // total length, sealed after the exact slice exists
    writer.put(&zeros); // payload digest placeholder
    writer.str(contract.target);
    writer.str(contract.triple);
    writer.str(contract.data_layout);
    writer.le16(@sizeOf(i32));
    writer.le16(@alignOf(i32));
    writer.le16(@bitSizeOf(usize));
    writer.le16(@alignOf(usize));
    writer.le32(19);
    writer.put(&zeros); // input identity; module mode0 does not cross-check it
    writer.put(&zeros); // source hash; module mode0 does not cross-check it
    writer.str("/opcode33.ts");
    writer.le32(10); // source length
    writer.byte(0); // module mode
    writer.le16(1); // function count
    writer.put(&function_id);
    writer.put(&signature_hash);
    writer.put(&type_id);
    writer.str(function_name);
    writer.le32(0); // function start
    writer.le32(10); // function end
    writer.byte(type_code); // return type
    writer.byte(if (parameter) 1 else 0); // signature parameter count
    if (parameter) writer.byte(type_code);
    writer.le16(2); // register count
    writer.le16(1); // block count
    writer.le16(if (parameter) 3 else 4); // instruction count
    writer.le16(if (parameter) 1 else 0); // block parameter count
    if (parameter) {
        writer.le16(0);
        writer.byte(type_code);
        writer.byte(0);
    }
    writer.le16(if (parameter) 3 else 4); // block instruction count
    writer.byte(26); // entry fuel
    writer.byte(0);
    writer.le16(0);
    writer.le32(1);
    writer.le32(0);
    writer.le32(10);
    if (!parameter) {
        writer.byte(32); // float constant
        writer.byte(type_code);
        writer.le16(0);
        writer.le32(0);
        writer.le32(1);
        writer.le32(9);
        writer.le64(literal_bits);
    }
    const unary_offset = writer.at;
    writer.byte(33); // unary plus of register 0
    writer.byte(type_code);
    writer.le16(1);
    writer.le32(0);
    writer.le32(1);
    writer.le32(9);
    writer.byte(2); // return register 1
    writer.byte(type_code);
    writer.le16(1);
    writer.le32(0);
    writer.le32(1);
    writer.le32(9);
    std.debug.assert(writer.at <= buffer.len);
    const bytes = try allocator.dupe(u8, buffer[0..writer.at]);
    errdefer allocator.free(bytes);
    std.mem.writeInt(u32, bytes[44..48], @intCast(bytes.len), .little);
    Sha256.hash(bytes[80..], bytes[48..80], .{});
    return .{ .bytes = bytes, .unary_offset = unary_offset };
}

fn loadOrFail(allocator: std.mem.Allocator, bytes: []const u8) !*runtime.VerifiedModule {
    switch (runtime.load(allocator, bytes)) {
        .loaded => |module| return module,
        .rejected => |failure| {
            std.debug.print("fixture rejected: {s} @ {d}\n", .{ failure.code, failure.offset });
            return error.UnexpectedRejection;
        },
    }
}

fn expectF32(host: *runtime.Runtime, module: *const runtime.VerifiedModule, id: runtime.FunctionId, input: u32, expected: u32, label: []const u8) !void {
    const outcome = runtime.eval_bytecode(host, module, id, &.{.{ .f32_bits = input }}, &.{}, .{});
    switch (outcome) {
        .returned => |returned| {
            if (returned.result.f32_bits != expected) {
                std.debug.print("case {s}: input=0x{x:0>8} expected=0x{x:0>8} actual=0x{x:0>8}\n", .{ label, input, expected, returned.result.f32_bits });
                return error.Opcode33BitsMismatch;
            }
        },
        .failed => |failure| {
            std.debug.print("case {s}: unexpected {s}\n", .{ label, failure.code });
            return error.UnexpectedRequestFailure;
        },
    }
}

fn expectF64(host: *runtime.Runtime, module: *const runtime.VerifiedModule, id: runtime.FunctionId, input: u64, expected: u64, label: []const u8) !void {
    const outcome = runtime.eval_bytecode(host, module, id, &.{.{ .f64_bits = input }}, &.{}, .{});
    switch (outcome) {
        .returned => |returned| {
            if (returned.result.f64_bits != expected) {
                std.debug.print("case {s}: input=0x{x:0>16} expected=0x{x:0>16} actual=0x{x:0>16}\n", .{ label, input, expected, returned.result.f64_bits });
                return error.Opcode33BitsMismatch;
            }
        },
        .failed => |failure| {
            std.debug.print("case {s}: unexpected {s}\n", .{ label, failure.code });
            return error.UnexpectedRequestFailure;
        },
    }
}

test "opcode33 unary plus preserves f32 identity bits and canonicalizes NaN" {
    const fixture = try unaryPlusFixture(std.testing.allocator, 12, true, 0);
    defer std.testing.allocator.free(fixture.bytes);
    const module = try loadOrFail(std.testing.allocator, fixture.bytes);
    defer runtime.unload(module);
    var host = runtime.Runtime.init(std.testing.allocator);
    const id = runtime.moduleInfo(module).function_id;
    const cases = [_]struct { input: u32, expected: u32, label: []const u8 }{
        .{ .input = 0x00000000, .expected = 0x00000000, .label = "positive zero" },
        .{ .input = 0x80000000, .expected = 0x80000000, .label = "negative zero" },
        .{ .input = 0x3f800000, .expected = 0x3f800000, .label = "one" },
        .{ .input = 0x00000001, .expected = 0x00000001, .label = "smallest subnormal" },
        .{ .input = 0x7f7fffff, .expected = 0x7f7fffff, .label = "largest finite" },
        .{ .input = 0x7f800000, .expected = 0x7f800000, .label = "positive infinity" },
        .{ .input = 0xff800000, .expected = 0xff800000, .label = "negative infinity" },
        .{ .input = 0x7fc00000, .expected = 0x7fc00000, .label = "canonical quiet NaN" },
        .{ .input = 0x7f800001, .expected = 0x7fc00000, .label = "signaling NaN" },
        .{ .input = 0xff800001, .expected = 0x7fc00000, .label = "negative signaling NaN" },
        .{ .input = 0xffc00000, .expected = 0x7fc00000, .label = "negative quiet NaN" },
        .{ .input = 0x7fc12345, .expected = 0x7fc00000, .label = "NaN payload" },
    };
    for (cases) |case| try expectF32(&host, module, id, case.input, case.expected, case.label);
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
}

test "opcode33 unary plus preserves f64 identity bits and canonicalizes NaN" {
    const fixture = try unaryPlusFixture(std.testing.allocator, 13, true, 0);
    defer std.testing.allocator.free(fixture.bytes);
    const module = try loadOrFail(std.testing.allocator, fixture.bytes);
    defer runtime.unload(module);
    var host = runtime.Runtime.init(std.testing.allocator);
    const id = runtime.moduleInfo(module).function_id;
    const cases = [_]struct { input: u64, expected: u64, label: []const u8 }{
        .{ .input = 0x0000000000000000, .expected = 0x0000000000000000, .label = "positive zero" },
        .{ .input = 0x8000000000000000, .expected = 0x8000000000000000, .label = "negative zero" },
        .{ .input = 0x3ff0000000000000, .expected = 0x3ff0000000000000, .label = "one" },
        .{ .input = 0x0000000000000001, .expected = 0x0000000000000001, .label = "smallest subnormal" },
        .{ .input = 0x7fefffffffffffff, .expected = 0x7fefffffffffffff, .label = "largest finite" },
        .{ .input = 0x7ff0000000000000, .expected = 0x7ff0000000000000, .label = "positive infinity" },
        .{ .input = 0xfff0000000000000, .expected = 0xfff0000000000000, .label = "negative infinity" },
        .{ .input = 0x7ff8000000000000, .expected = 0x7ff8000000000000, .label = "canonical quiet NaN" },
        .{ .input = 0x7ff0000000000001, .expected = 0x7ff8000000000000, .label = "signaling NaN" },
        .{ .input = 0xfff0000000000001, .expected = 0x7ff8000000000000, .label = "negative signaling NaN" },
        .{ .input = 0xfff8000000000000, .expected = 0x7ff8000000000000, .label = "negative quiet NaN" },
        .{ .input = 0x7ff8123456789abc, .expected = 0x7ff8000000000000, .label = "NaN payload" },
    };
    for (cases) |case| try expectF64(&host, module, id, case.input, case.expected, case.label);
    try std.testing.expectEqual(@as(usize, 0), host.activeRequests());
}

test "opcode33 literal unary plus preserves signed zero and canonicalizes NaN" {
    const negative_zero = try unaryPlusFixture(std.testing.allocator, 12, false, 0x80000000);
    defer std.testing.allocator.free(negative_zero.bytes);
    const zero_module = try loadOrFail(std.testing.allocator, negative_zero.bytes);
    defer runtime.unload(zero_module);
    var zero_host = runtime.Runtime.init(std.testing.allocator);
    switch (runtime.eval_bytecode(&zero_host, zero_module, runtime.moduleInfo(zero_module).function_id, &.{}, &.{}, .{})) {
        .returned => |returned| try std.testing.expectEqual(@as(u32, 0x80000000), returned.result.f32_bits),
        .failed => |failure| {
            std.debug.print("negative zero literal: unexpected {s}\n", .{failure.code});
            return error.UnexpectedRequestFailure;
        },
    }

    const signaling = try unaryPlusFixture(std.testing.allocator, 12, false, 0x7f800001);
    defer std.testing.allocator.free(signaling.bytes);
    const signaling_module = try loadOrFail(std.testing.allocator, signaling.bytes);
    defer runtime.unload(signaling_module);
    var signaling_host = runtime.Runtime.init(std.testing.allocator);
    switch (runtime.eval_bytecode(&signaling_host, signaling_module, runtime.moduleInfo(signaling_module).function_id, &.{}, &.{}, .{})) {
        .returned => |returned| try std.testing.expectEqual(@as(u32, 0x7fc00000), returned.result.f32_bits),
        .failed => |failure| {
            std.debug.print("signaling literal: unexpected {s}\n", .{failure.code});
            return error.UnexpectedRequestFailure;
        },
    }

    const double_nan = try unaryPlusFixture(std.testing.allocator, 13, false, 0xfff8000000000000);
    defer std.testing.allocator.free(double_nan.bytes);
    const double_module = try loadOrFail(std.testing.allocator, double_nan.bytes);
    defer runtime.unload(double_module);
    var double_host = runtime.Runtime.init(std.testing.allocator);
    switch (runtime.eval_bytecode(&double_host, double_module, runtime.moduleInfo(double_module).function_id, &.{}, &.{}, .{})) {
        .returned => |returned| try std.testing.expectEqual(@as(u64, 0x7ff8000000000000), returned.result.f64_bits),
        .failed => |failure| {
            std.debug.print("double NaN literal: unexpected {s}\n", .{failure.code});
            return error.UnexpectedRequestFailure;
        },
    }
}

fn seal(bytes: []u8) void {
    Sha256.hash(bytes[80..], bytes[48..80], .{});
}

fn expectReject(bytes: []const u8, expected: []const u8) !void {
    switch (runtime.load(std.testing.allocator, bytes)) {
        .loaded => |module| {
            runtime.unload(module);
            return error.ExpectedLoadFailure;
        },
        .rejected => |failure| try std.testing.expectEqualStrings(expected, failure.code),
    }
}

test "opcode33 loader boundaries reject non-float type, reserved payload and unknown register" {
    const fixture = try unaryPlusFixture(std.testing.allocator, 12, true, 0);
    defer std.testing.allocator.free(fixture.bytes);
    const mutated = try std.testing.allocator.dupe(u8, fixture.bytes);
    defer std.testing.allocator.free(mutated);
    mutated[fixture.unary_offset + 1] = 1; // i32 type contradicts the f32 operand
    seal(mutated);
    try expectReject(mutated, "r04-type");
    @memcpy(mutated, fixture.bytes);
    std.mem.writeInt(u16, mutated[fixture.unary_offset + 6 ..][0..2], 1, .little); // reserved high payload half
    seal(mutated);
    try expectReject(mutated, "r04-reserved");
    @memcpy(mutated, fixture.bytes);
    std.mem.writeInt(u16, mutated[fixture.unary_offset + 4 ..][0..2], 5, .little); // unary operand outside register file
    seal(mutated);
    try expectReject(mutated, "r04-register");
}
