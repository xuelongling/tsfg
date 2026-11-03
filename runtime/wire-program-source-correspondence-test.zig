// SPDX-License-Identifier: MIT
// Direct passive metadata checker regressions.
// No decoder, bytecode loader, evaluator, VM state, dispatch or active admission.
// Program is only the existing Context's ordinary typed metadata container.
// Its unused envelope/target/authority fields are zero placeholders, not a valid
// package or a publication receipt. These tests establish no such validity.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const control = @import("wire-program-control.zig");
const context = @import("wire-program-refcheck-context.zig");
const ssa = @import("wire-program-ssa-check.zig");
const correspondence = @import("wire-program-source-correspondence.zig");
const t = model.types;
const ins = model.instruction;

const i32_type: t.TypeRef = @enumFromInt(0);
const array_type: t.TypeRef = @enumFromInt(1);
const r0: t.RegisterRef = @enumFromInt(0);
const r1: t.RegisterRef = @enumFromInt(1);
const r2: t.RegisterRef = @enumFromInt(2);
const r3: t.RegisterRef = @enumFromInt(3);
const i32_carrier: t.Carrier = .{ .@"type" = i32_type };
const array_carrier: t.Carrier = .{ .@"type" = array_type };
const i32_text = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const array_text = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const declaration: t.Origin = .{ .source = @enumFromInt(0), .start = 0, .end = 20 };
const first: t.Origin = .{ .source = @enumFromInt(0), .start = 2, .end = 3 };
const second: t.Origin = .{ .source = @enumFromInt(0), .start = 4, .end = 5 };
const third: t.Origin = .{ .source = @enumFromInt(0), .start = 6, .end = 7 };
const last: t.Origin = .{ .source = @enumFromInt(0), .start = 18, .end = 19 };
const fuel_properties = [_]t.JsonMember{.{ .key = "event", .value = .{ .integer = 1 } }};
const seven_properties = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "7" } }};
const nine_properties = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "9" } }};
const zero_properties = [_]t.JsonMember{.{ .key = "decimal", .value = .{ .string = "0" } }};
const copy_properties = [_]t.JsonMember{.{ .key = "type", .value = .{ .string = array_text } }};
const read_properties = [_]t.JsonMember{.{ .key = "element", .value = .{ .string = i32_text } }};
const neg_properties = [_]t.JsonMember{.{ .key = "operator", .value = .{ .string = "-" } }};

// One reusable typed fixture owns every mutable row. init receives its final
// address before connecting slices, avoiding pointers into a returned local.
// Only finite, in-range references and complete definitions are constructed.
// The direct SSA API assumes the separate references/layout boundary; this test
// deliberately does not claim that the unused package/publication is valid.
const Fixture = struct {
    program: model.Program,
    sources: [2]tables.Source,
    types: [2]tables.CommonType,
    bindings: [1]storage.CommonBinding,
    abis: [1]storage.CommonAbi,
    functions: [1]model.Function,
    registers: [4]model.Register,
    blocks: [2]model.Block,
    instructions: [5]ins.Instruction,
    plan_blocks: [1]control.SourcePlanBlock,
    operations: [5]control.SourcePlanOperation,
    carriers: [4][]const u8,

    const Kind = enum { alpha, array_length, array_read, numeric };

    fn init(self: *Fixture, kind: Kind) void {
        self.sources = .{
            .{ .hash = @splat(0x31), .path = "passive-fixture.ts", .length = 20 },
            .{ .hash = @splat(0x32), .path = "other-fixture.ts", .length = 20 },
        };
        self.types = .{
            .{ .id = @splat(0x11), .kind = .scalar, .name = "i32", .native_code = 1,
                .base = null, .element = null, .members = &.{}, .methods = null,
                .nominal_key = null, .runtime_key = null },
            .{ .id = @splat(0x22), .kind = .array, .name = "i32[]", .native_code = 0,
                .base = null, .element = i32_type, .members = &.{}, .methods = null,
                .nominal_key = null, .runtime_key = null },
        };
        self.bindings[0] = .{ .id = "fixture-array-param", .owner = .{ .param = @enumFromInt(0) },
            .name = "array", .@"type" = array_type, .writable = false, .origin = first,
            .carrier = array_carrier, .scope = null, .declaration_kind = .parameter };
        @memset(&self.registers, .{ .carrier = i32_carrier, .view = i32_type });
        @memset(&self.carriers, i32_text);
        self.instructions[0] = .{ .source = declaration, .result = null, .operands = &.{}, .data = .{ .fuel = .{ .event = .entry } } };
        self.operations[0] = .{ .name = "fuel", .view = "void", .properties = &fuel_properties,
            .result = null, .operands = &.{}, .successors = &.{}, .source = declaration };

        var register_count: usize = 0;
        var instruction_count: usize = 0;
        var operation_count: usize = 0;
        var block_count: usize = 1;
        var carrier_count: usize = 0;
        var parameters: []const t.RegisterRef = &.{};
        var argument_types: []const t.TypeRef = &.{};
        var physical_parameters: []const t.Carrier = &.{};
        switch (kind) {
            .alpha => {
                register_count = 2; instruction_count = 4; operation_count = 4; carrier_count = 2;
                self.instructions[1] = .{ .source = first, .result = r0, .operands = &.{}, .data = .{ .const_i32 = 7 } };
                self.instructions[2] = .{ .source = second, .result = r1, .operands = &.{}, .data = .{ .const_i32 = 9 } };
                self.instructions[3] = .{ .source = last, .result = null, .operands = &.{r1}, .data = .@"return" };
                // Deliberately reverse logical IDs: raw0 -> logical1, raw1 -> logical0.
                self.operations[1] = .{ .name = "constant", .view = i32_text, .properties = &seven_properties,
                    .result = r1, .operands = &.{}, .successors = &.{}, .source = first };
                self.operations[2] = .{ .name = "constant", .view = i32_text, .properties = &nine_properties,
                    .result = r0, .operands = &.{}, .successors = &.{}, .source = second };
                self.operations[3] = .{ .name = "func.return", .view = "", .properties = &.{},
                    .result = null, .operands = &.{r0}, .successors = &.{}, .source = last };
            },
            .array_length, .array_read => {
                register_count = 4; instruction_count = 5; operation_count = 5; carrier_count = 4;
                parameters = &.{r0}; argument_types = &.{array_type}; physical_parameters = &.{array_carrier};
                self.registers[0] = .{ .carrier = array_carrier, .view = array_type };
                self.registers[1] = .{ .carrier = array_carrier, .view = array_type };
                self.carriers[0] = array_text; self.carriers[1] = array_text;
                self.instructions[1] = .{ .source = first, .result = r1, .operands = &.{r0},
                    .data = .{ .domain_copy = .{ .static_view = array_type } } };
                self.instructions[2] = .{ .source = second, .result = r2, .operands = &.{}, .data = .{ .const_i32 = 0 } };
                self.instructions[3] = if (kind == .array_length)
                    .{ .source = third, .result = r3, .operands = &.{r1}, .data = .domain_array_length }
                else
                    .{ .source = third, .result = r3, .operands = &.{ r1, r2 }, .data = .{ .domain_array_read = .{ .element_view = i32_type } } };
                self.instructions[4] = .{ .source = last, .result = null, .operands = &.{r3}, .data = .@"return" };
                self.operations[1] = .{ .name = "value_copy", .view = array_text, .properties = &copy_properties,
                    .result = r1, .operands = &.{r0}, .successors = &.{}, .source = first };
                self.operations[2] = .{ .name = "constant", .view = i32_text, .properties = &zero_properties,
                    .result = r2, .operands = &.{}, .successors = &.{}, .source = second };
                self.operations[3] = if (kind == .array_length)
                    .{ .name = "array_length", .view = i32_text, .properties = &.{},
                        .result = r3, .operands = &.{r1}, .successors = &.{}, .source = third }
                else
                    .{ .name = "array_read", .view = i32_text, .properties = &read_properties,
                        .result = r3, .operands = &.{ r1, r2 }, .successors = &.{}, .source = third };
                self.operations[4] = .{ .name = "func.return", .view = "", .properties = &.{},
                    .result = null, .operands = &.{r3}, .successors = &.{}, .source = last };
            },
            .numeric => {
                register_count = 3; instruction_count = 3; operation_count = 4; carrier_count = 2; block_count = 2;
                self.instructions[1] = .{ .source = first, .result = r0, .operands = &.{}, .data = .{ .const_i32 = 7 } };
                self.instructions[2] = .{ .source = second, .result = null, .operands = &.{r0},
                    .data = .{ .domain_numeric_use = .{ .target_type = i32_type, .numeric_operator = .neg,
                        .numeric_arity = 1, .numeric_operand = 0, .numeric_group = i32_text, .normal_successor = @enumFromInt(1) } } };
                self.instructions[3] = .{ .source = second, .result = r2, .operands = &.{r1}, .data = .neg };
                self.instructions[4] = .{ .source = last, .result = null, .operands = &.{r2}, .data = .@"return" };
                self.blocks[1] = .{ .parameters = &.{r1}, .instructions = self.instructions[3..5] };
                self.operations[1] = .{ .name = "constant", .view = i32_text, .properties = &seven_properties,
                    .result = r0, .operands = &.{}, .successors = &.{}, .source = first };
                self.operations[2] = .{ .name = "unary", .view = i32_text, .properties = &neg_properties,
                    .result = r1, .operands = &.{r0}, .successors = &.{}, .source = second };
                self.operations[3] = .{ .name = "func.return", .view = "", .properties = &.{},
                    .result = null, .operands = &.{r1}, .successors = &.{}, .source = last };
            },
        }
        self.blocks[0] = .{ .parameters = parameters, .instructions = self.instructions[0..instruction_count] };
        self.plan_blocks[0] = .{ .parameters = parameters, .operations = self.operations[0..operation_count] };
        self.abis[0] = .{ .kind = .common, .function = @enumFromInt(0), .signature = @splat(0x41),
            .parameters = if (kind == .array_length or kind == .array_read) &.{@enumFromInt(0)} else &.{},
            .argument_types = argument_types, .receiver = null, .construction = null, .receiver_frame = null,
            .lexical_environment = null, .physical_parameters = physical_parameters,
            .result = i32_type, .result_carrier = i32_carrier,
            .source_plan = .{ .carriers = self.carriers[0..carrier_count], .blocks = &self.plan_blocks } };
        self.functions[0] = .{ .id = @splat(0x51), .signature = @splat(0x41), .abi = @enumFromInt(0),
            .source = @enumFromInt(0), .role = .ordinary, .declaration = .{ .start = declaration.start, .end = declaration.end },
            .name = "passiveFixture", .registers = self.registers[0..register_count], .blocks = self.blocks[0..block_count] };
        var common = std.mem.zeroes(tables.CommonTables);
        common.types = &self.types; common.abis = &self.abis;
        if (kind == .array_length or kind == .array_read) common.storage.bindings = &self.bindings;
        self.program = .{ .envelope = std.mem.zeroes(model.Envelope), .target = std.mem.zeroes(model.Target),
            .input_identity = @splat(0), .source_hash = @splat(0), .source_path = "", .source_length = 0,
            .root_source = @enumFromInt(0), .tables = .{ .sources = &self.sources, .mode = .{ .common = common } },
            .functions = &self.functions };
    }
};

test "passive correspondence accepts alpha-renamed data with one shared meter" {
    var fixture: Fixture = undefined; fixture.init(.alpha);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    const after_ssa = c.remaining;
    try correspondence.check(&c);
    try std.testing.expect(after_ssa < model.format.max_work and c.remaining < after_ssa);
}

test "passive correspondence rejects physical operand substitution after SSA succeeds" {
    var fixture: Fixture = undefined; fixture.init(.alpha);
    fixture.instructions[3].operands = &.{r0};
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, correspondence.check(&c));
}

test "passive correspondence rejects logical operand substitution after SSA succeeds" {
    var fixture: Fixture = undefined; fixture.init(.alpha);
    fixture.operations[3].operands = &.{r1};
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, correspondence.check(&c));
}

test "passive correspondence compares the complete SourceRef tuple" {
    var fixture: Fixture = undefined; fixture.init(.alpha);
    // Both directories contain this same in-range [18,19) interval.
    fixture.operations[3].source.source = @enumFromInt(1);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, correspondence.check(&c));
}

test "passive SSA rejects a self use before any correspondence call" {
    var fixture: Fixture = undefined; fixture.init(.array_read);
    fixture.instructions[1].operands = &.{r1};
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try std.testing.expectError(error.InvalidShape, ssa.check(&c));
}

test "passive array length accepts its actual original view" {
    var fixture: Fixture = undefined; fixture.init(.array_length);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c); try correspondence.check(&c);
}

test "passive array length cannot reconstruct its required original view from a carrier" {
    var fixture: Fixture = undefined; fixture.init(.array_length);
    fixture.registers[1].view = null;
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, correspondence.check(&c));
}

test "passive array read accepts its actual original view" {
    var fixture: Fixture = undefined; fixture.init(.array_read);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c); try correspondence.check(&c);
}

test "passive array read permits the Cpp typed carrier fallback" {
    var fixture: Fixture = undefined; fixture.init(.array_read);
    fixture.registers[1].view = null;
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c); try correspondence.check(&c);
}

test "passive numeric adapter accepts its actual original view" {
    var fixture: Fixture = undefined; fixture.init(.numeric);
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c); try correspondence.check(&c);
}

test "passive numeric adapter cannot reconstruct its required original view from a carrier" {
    var fixture: Fixture = undefined; fixture.init(.numeric);
    fixture.registers[0].view = null;
    var c = context.Context{ .program = &fixture.program, .allocator = std.testing.allocator };
    try ssa.check(&c);
    try std.testing.expectError(error.InvalidShape, correspondence.check(&c));
}

test "passive correspondence prepays its map storage and never refills a spent meter" {
    var fixture: Fixture = undefined; fixture.init(.alpha);
    var no_bytes: [0]u8 = .{};
    var no_storage = std.heap.FixedBufferAllocator.init(&no_bytes);
    // An allocation before the up-front map charge would return OutOfMemory.
    var c = context.Context{ .program = &fixture.program, .allocator = no_storage.allocator(), .remaining = 2 };
    try std.testing.expectError(error.WorkLimit, correspondence.check(&c));
    try std.testing.expectEqual(@as(usize, 0), c.remaining);
    try std.testing.expectError(error.WorkLimit, correspondence.check(&c));
    try std.testing.expectEqual(@as(usize, 0), c.remaining);
}
