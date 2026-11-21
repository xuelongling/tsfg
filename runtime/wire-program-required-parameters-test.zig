// SPDX-License-Identifier: MIT
// Pure typed declaration-domain tests, not Source/packet admission, actual
// parameter classification, execution, or a replacement for binding checks.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const context = @import("wire-program-refcheck-context.zig");
const identity = @import("wire-program-identity-check.zig");
const t = model.types;

const types = blk: {
    const scalar: tables.CommonType = .{ .id = @splat(0), .kind = .scalar, .name = "bool", .native_code = 1,
        .base = null, .element = null, .members = &.{}, .methods = null, .nominal_key = null, .runtime_key = null };
    var rows = [_]tables.CommonType{scalar} ** 10;
    for (&rows, 0..) |*row, index| row.id = @splat(@as(u8, @intCast(index)));
    rows[1].kind = .@"undefined"; rows[1].name = "undefined";
    rows[2].kind = .unknown; rows[2].name = "unknown";
    rows[3].kind = .@"void"; rows[3].name = "void";
    rows[4].kind = .@"null"; rows[4].name = "null";
    rows[5].kind = .@"union"; rows[5].members = &.{ @enumFromInt(0), @enumFromInt(1) };
    rows[6].kind = .@"union"; rows[6].members = &.{ @enumFromInt(0), @enumFromInt(4) };
    rows[7].kind = .array; rows[7].element = @enumFromInt(1);
    rows[8].kind = .@"union"; rows[8].members = &.{@enumFromInt(8)};
    rows[9].kind = .function; rows[9].element = @enumFromInt(3); rows[9].members = &.{@enumFromInt(1)};
    break :blk rows;
};

// The predicate consumes only the explicit typed arrays and shared meter.
// Context's other records are ordinary zero placeholders, not a valid package.
const metadata_program: model.Program = .{ .envelope = std.mem.zeroes(model.Envelope), .target = std.mem.zeroes(model.Target),
    .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0,
    .root_source = @enumFromInt(0), .tables = .{ .sources = &.{}, .mode = .{ .common = std.mem.zeroes(tables.CommonTables) } }, .functions = &.{} };

fn prove(declared: []const t.TypeRef, incoming: []const t.TypeRef, minimum: usize, remaining: *usize) !bool {
    var c = context.Context{ .program = &metadata_program, .allocator = std.testing.allocator, .remaining = remaining.* };
    defer remaining.* = c.remaining;
    return identity.requiredConstructorArguments(&c, &types, declared, incoming, minimum);
}

fn typeId(comptime digest: []const u8) t.Hash {
    var result: t.Hash = undefined;
    _ = std.fmt.hexToBytes(&result, digest) catch unreachable;
    return result;
}

test "retained scalar default declarations agree with the raw ABI and last required ordinal" {
    // These are the actual Source3 i32, undefined and i32|undefined
    // TypeIDs from the Derived and Numeric intermediate artifact.
    var current = types;
    current[0].id = comptime typeId("a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727");
    current[0].name = "i32";
    current[1].id = comptime typeId("64128720a4ac06ed43e1e6705520af7acda9bd2132f79ba2e1c65fe3eb24272b");
    current[1].native_code = 0;
    current[5].id = comptime typeId("29488c80c16bf5eb4fc0b96448ad2e1009612ec64942c1ab71c049658d8ebfea");
    current[5].members = &.{ @enumFromInt(1), @enumFromInt(0) };
    current[5].name = "union";
    current[5].native_code = 0;
    const i32_view: t.TypeRef = @enumFromInt(0);
    const scalar_default: t.TypeRef = @enumFromInt(5);
    const foreign: t.TypeRef = @enumFromInt(6);
    var c = context.Context{ .program = &metadata_program, .allocator = std.testing.allocator };
    try std.testing.expect(!try identity.requiredConstructorArguments(&c, &current, &.{i32_view}, &.{scalar_default}, 0));
    try std.testing.expect(!try identity.requiredConstructorArguments(&c, &current, &.{ i32_view, i32_view }, &.{ scalar_default, scalar_default }, 0));
    try std.testing.expectError(error.InvalidShape, identity.requiredConstructorArguments(&c, &current, &.{i32_view}, &.{scalar_default}, 1));
    try std.testing.expectError(error.InvalidShape, identity.requiredConstructorArguments(&c, &current, &.{ i32_view, i32_view }, &.{ scalar_default, scalar_default }, 1));
    try std.testing.expect(!try identity.requiredConstructorArguments(&c, &current, &.{ i32_view, i32_view }, &.{ i32_view, scalar_default }, 1));
    try std.testing.expectError(error.InvalidShape, identity.requiredConstructorArguments(&c, &current, &.{ i32_view, i32_view }, &.{ i32_view, scalar_default }, 0));
    try std.testing.expectError(error.InvalidShape, identity.requiredConstructorArguments(&c, &current, &.{i32_view}, &.{foreign}, 0));
}

test "Source3 required bool declaration needs no initializer expression" {
    // Real conditional-super-bool Source3 has one bool step, no initializer,
    // hasParameterExpressions=false, and minimumArgumentCount=1.
    var remaining: usize = 100_000;
    try std.testing.expect(try prove(&.{@enumFromInt(0)}, &.{@enumFromInt(0)}, 1, &remaining));
    try std.testing.expect(remaining > 0 and remaining < 100_000);
}

test "default before required remains pending despite minimum equal to length" {
    // (first: bool = true, second: bool) has minimum 2, but raw0 includes U.
    var remaining: usize = 100_000;
    try std.testing.expect(!try prove(&.{ @enumFromInt(0), @enumFromInt(0) }, &.{ @enumFromInt(5), @enumFromInt(0) }, 2, &remaining));
    try std.testing.expectError(error.InvalidShape, prove(&.{ @enumFromInt(0), @enumFromInt(0) }, &.{ @enumFromInt(5), @enumFromInt(0) }, 1, &remaining));
}

test "a declared U union default cannot pass merely because raw equals declared" {
    // (first: bool|undefined = true, second: bool): equal raw/declaration
    // vectors and minimum2 still do not exclude the first initializer.
    var remaining: usize = 100_000;
    try std.testing.expect(!try prove(&.{ @enumFromInt(5), @enumFromInt(0) }, &.{ @enumFromInt(5), @enumFromInt(0) }, 2, &remaining));
}

test "unknown and void do not prove required parameter domains" {
    var remaining: usize = 100_000;
    try std.testing.expect(!try prove(&.{@enumFromInt(2)}, &.{@enumFromInt(2)}, 1, &remaining));
    try std.testing.expect(!try prove(&.{@enumFromInt(3)}, &.{@enumFromInt(3)}, 1, &remaining));
}

test "element and callable result presence do not widen the top parameter domain" {
    var remaining: usize = 100_000;
    try std.testing.expect(try prove(&.{@enumFromInt(7)}, &.{@enumFromInt(7)}, 1, &remaining));
    try std.testing.expect(try prove(&.{@enumFromInt(9)}, &.{@enumFromInt(9)}, 1, &remaining));
}

test "complete nonpresence union is required while a cyclic union supplies no proof" {
    var remaining: usize = 100_000;
    try std.testing.expect(try prove(&.{@enumFromInt(6)}, &.{@enumFromInt(6)}, 1, &remaining));
    try std.testing.expect(!try prove(&.{@enumFromInt(8)}, &.{@enumFromInt(8)}, 1, &remaining));
    try std.testing.expect(remaining > 0);
}

test "raw and declaration ordinals must agree" {
    var remaining: usize = 100_000;
    try std.testing.expect(!try prove(&.{ @enumFromInt(0), @enumFromInt(4) }, &.{ @enumFromInt(4), @enumFromInt(0) }, 2, &remaining));
}

test "only complete required vectors or the empty signature qualify" {
    var remaining: usize = 100_000;
    try std.testing.expect(try prove(&.{}, &.{}, 0, &remaining));
    try std.testing.expectError(error.InvalidShape, prove(&.{@enumFromInt(0)}, &.{@enumFromInt(0)}, 0, &remaining));
    try std.testing.expect(!try prove(&.{@enumFromInt(0)}, &.{}, 1, &remaining));
}

test "parameter proof spends the existing balance without refilling" {
    var remaining: usize = 0;
    try std.testing.expectError(error.WorkLimit, prove(&.{@enumFromInt(0)}, &.{@enumFromInt(0)}, 1, &remaining));
    try std.testing.expectEqual(@as(usize, 0), remaining);
}
