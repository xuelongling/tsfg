// SPDX-License-Identifier: MIT
// Pure symbolic input/Graph/Directory DTOs. No Program factory, Source package,
// loader, State, ActualAnalysis, selected instance or VM is involved.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const directory = m.Directory{
    .types = &.{ .{ .id = "array", .kind = .array }, .{ .id = "box", .kind = .value }, .{ .id = "reference", .kind = .reference } },
    .functions = &.{
        .{ .id = "empty", .kind = .source, .parameter_types = &.{}, .return_type = "array", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
        .{ .id = "f", .kind = .source, .parameter_types = &.{"box"}, .return_type = "box", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
    },
    .environments = &.{}, .globals = &.{}, .fields = &.{"field"},
    .constructions = &.{ .{ .id = "box-role", .owner = "box", .base = null, .kind = .implicit_base, .function_id = null }, .{ .id = "reference-role", .owner = "reference", .base = null, .kind = .implicit_base, .function_id = null } },
};
const physical = [_]owners.Physical{.{ .type_id = "box", .fields = &.{.{ .id = "field", .view = "box", .physical = 0, .type_id = "reference" }} }};
const graph = m.Graph{
    .nodes = &.{ .{ .parameter = .{ .@"type" = "box", .index = 0 } }, .{ .copy = .{ .@"type" = "box", .bases = &.{0}, .site = "copy-input", .heap = 0, .control = 0 } } },
    .heaps = &.{ .entry, .{ .copy = .{ .previous = 0, .value = 1 } } }, .controls = &.{.entry}, .calls = &.{},
    .normal = &.{1}, .language = &.{0}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{.{ .heap = 0, .control = 0 }} }, .accesses = &.{},
};
const input = owners.Initial{
    .locations = &.{
        .{ .kind = .payload, .owner = .{ .input = 0 }, .type_id = "box" },
        .{ .kind = .root, .owner = .{ .input = 1 }, .type_id = "reference" },
    },
    .arguments = &.{&.{0}}, .environment = &.{}, .parents = &.{},
    .heap = &.{.{ .base = 0, .selector = "field:field", .view = "box", .values = &.{1} }},
};
const fixed = [_]owners.Fixed{.{ .function_id = "f", .graph = &graph, .parameters = &.{.{}}, .captures = &.{}, .may_throw = true }};
const Meter = struct {
    remaining: usize = 50_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer)); if (units > self.remaining) return error.BudgetExceeded; self.remaining -= units;
    }
};
fn typed(budget: *m.Budget, function: m.Symbol, body: *const m.Graph) !void {
    try m.validateDirectory(std.testing.allocator, &directory, budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &directory, function, body, budget)) == .valid);
}

test "typed saved payloads use the existing physical Value copy and both completion heaps" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, "f", &graph);
    const before = meter.remaining;
    var result = try owners.analyzeInputs(std.testing.allocator, &directory, &physical, "f", &graph, &fixed, &budget, null, &input); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len); try std.testing.expectEqual(@as(usize, 1), result.language.len);
    const copied = result.normal[0]; const original = result.language[0];
    try std.testing.expect(copied != original);
    try std.testing.expectEqual(owners.Kind.copied, result.locations[copied].kind);
    try std.testing.expectEqual(owners.Kind.payload, result.locations[original].kind);
    try std.testing.expectEqual(@as(?usize, 0), result.locations[original].input);
    try std.testing.expectEqual(@as(?usize, null), result.locations[copied].input);
    for ([_][]const owners.Payload{ result.normal_payloads, result.language_payloads }, 0..) |rows, completion| {
        try std.testing.expectEqual(@as(usize, 1), rows.len);
        try std.testing.expectEqual(if (completion == 0) copied else original, rows[0].location);
        try std.testing.expectEqualStrings("box", rows[0].type_id);
        try std.testing.expectEqual(@as(usize, 1), rows[0].slots.len);
        const slot = rows[0].slots[0]; try std.testing.expectEqual(@as(?usize, 0), slot.physical);
        try std.testing.expectEqualStrings("field:field", slot.selector); try std.testing.expectEqualStrings("box", slot.view);
        var leaf = false;
        for (slot.values) |value| {
            const root = result.locations[value].owner; if (root == .input and root.input == 1) leaf = true;
        }
        try std.testing.expect(leaf);
    }
    try std.testing.expect(meter.remaining < before and meter.remaining != 0);
}

test "a May store cannot invent missing saved initialization or a physical copy layout" {
    inline for (.{ false, true }) |missing_layout| {
        var initial = input; if (!missing_layout) initial.heap = &.{};
        const absent = [_]owners.Physical{.{ .type_id = "box", .fields = null }};
        var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, "f", &graph);
        var result = try owners.analyzeInputs(std.testing.allocator, &directory, if (missing_layout) &absent else &physical, "f", &graph, &fixed, &budget, null, &initial); defer result.deinit();
        try std.testing.expectEqual(if (missing_layout) owners.Pending.copy_layout else owners.Pending.payload_uninitialized, result.pending.?);
    }
}

test "an actual empty element initializer is distinct from unknown or bottom" {
    const empty = m.Graph{ .nodes = &.{.{ .local = .{ .@"type" = "array" } }},
        .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{0}, .selector = "element", .view = "array", .values = &.{}, .control = 0, .initialize = true } } },
        .controls = &.{.entry}, .calls = &.{}, .normal = &.{0}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{} }, .accesses = &.{},
    };
    const rows = [_]owners.Fixed{.{ .function_id = "empty", .graph = &empty, .parameters = &.{}, .captures = &.{}, .may_throw = false }};
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, "empty", &empty);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "empty", &empty, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expectEqual(@as(usize, 1), result.normal_payloads.len);
    try std.testing.expectEqual(@as(usize, 1), result.normal_payloads[0].slots.len);
    try std.testing.expectEqual(@as(usize, 0), result.normal_payloads[0].slots[0].values.len);
    var no_init = empty; var heaps = empty.heaps[0..2].*; heaps[1].store.initialize = false; no_init.heaps = &heaps;
    const bad_rows = [_]owners.Fixed{.{ .function_id = "empty", .graph = &no_init, .parameters = &.{}, .captures = &.{}, .may_throw = false }};
    try typed(&budget, "empty", &no_init);
    var missing = try owners.analyze(std.testing.allocator, &directory, &.{}, "empty", &no_init, &bad_rows, &budget); defer missing.deinit();
    try std.testing.expectEqual(owners.Pending.payload_uninitialized, missing.pending.?);
}

test "typed payload import and completeness use the same remaining budget" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, "f", &graph);
    meter.remaining = 1;
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeInputs(std.testing.allocator, &directory, &physical, "f", &graph, &fixed, &budget, null, &input));
}

test "an established empty Array input retains presence without inventing missing or unknown input" {
    var functions = directory.functions[0..2].*;
    functions[1].parameter_types = &.{"array"}; functions[1].return_type = "array";
    var scope = directory; scope.functions = &functions;
    const body = m.Graph{ .nodes = &.{.{ .parameter = .{ .@"type" = "array", .index = 0 } }}, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{},
        .normal = &.{0}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{} }, .accesses = &.{},
    };
    const initial = owners.Initial{ .locations = &.{.{ .kind = .payload, .owner = .local, .type_id = "array" }}, .arguments = &.{&.{0}}, .environment = &.{}, .parents = &.{},
        .heap = &.{.{ .base = 0, .selector = "element", .view = "array", .values = &.{} }},
    };
    const rows = [_]owners.Fixed{.{ .function_id = "f", .graph = &body, .parameters = &.{.{}}, .captures = &.{}, .may_throw = false }};
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &body, &budget)) == .valid);
    var result = try owners.analyzeInputs(std.testing.allocator, &scope, &.{}, "f", &body, &rows, &budget, null, &initial); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expectEqual(@as(usize, 1), result.normal_payloads.len);
    try std.testing.expectEqual(@as(usize, 1), result.normal_payloads[0].slots.len);
    try std.testing.expectEqual(@as(usize, 0), result.normal_payloads[0].slots[0].values.len);
    var absent = initial; absent.heap = &.{};
    var missing = try owners.analyzeInputs(std.testing.allocator, &scope, &.{}, "f", &body, &rows, &budget, null, &absent); defer missing.deinit();
    try std.testing.expectEqual(owners.Pending.payload_uninitialized, missing.pending.?);
    const unknown = m.Graph{ .nodes = &.{.unknown}, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{0}, .language = &.{}, .exits = body.exits, .accesses = &.{} };
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &unknown, &budget)) == .valid);
    const unknown_rows = [_]owners.Fixed{.{ .function_id = "f", .graph = &unknown, .parameters = &.{.{}}, .captures = &.{}, .may_throw = false }};
    var unresolved = try owners.analyzeInputs(std.testing.allocator, &scope, &.{}, "f", &unknown, &unknown_rows, &budget, null, &initial); defer unresolved.deinit();
    try std.testing.expectEqual(owners.Pending.unknown_origin, unresolved.pending.?);
}

test "a full capture closes a local Array to its smaller numbered parameter child" {
    var scope = directory;
    scope.types = &.{ .{ .id = "array", .kind = .array }, .{ .id = "box", .kind = .value }, .{ .id = "function", .kind = .function }, .{ .id = "reference", .kind = .reference } };
    scope.functions = &.{
        .{ .id = "child", .kind = .source, .parameter_types = &.{}, .return_type = "reference", .environment_metadata_complete = true, .lexical_environment = "env", .activation_environment = null, .construction = null },
        .{ .id = "f", .kind = .source, .parameter_types = &.{"reference"}, .return_type = "function", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = "env", .construction = null },
    };
    scope.environments = &.{.{ .id = "env", .parent = null, .slots = &.{.{ .key = "slot", .@"type" = "array", .writable = true }} }};
    const body = m.Graph{
        .nodes = &.{ .{ .parameter = .{ .@"type" = "reference", .index = 0 } }, .{ .local = .{ .@"type" = "array" } },
            .{ .environment_create = .{ .layout = "env", .parent = null, .site = "capture-env", .control = 0 } },
            .{ .code = .{ .@"type" = "function", .function_id = "child", .environment = &.{2}, .control = 0 } },
        },
        .heaps = &.{ .entry,
            .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "element", .view = "array", .values = &.{0}, .control = 0, .initialize = true } },
            .{ .store = .{ .previous = 1, .bases = &.{2}, .selector = "capture:slot", .view = "env:env", .values = &.{1}, .control = 0, .initialize = true } },
        }, .controls = &.{.entry}, .calls = &.{}, .normal = &.{3}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 2, .control = 0 }}, .language = &.{} }, .accesses = &.{},
    };
    const rows = [_]owners.Fixed{.{ .function_id = "f", .graph = &body, .parameters = &.{.{}}, .captures = &.{.{ .key = "slot", .flags = .{ .read = true, .write = true, .structural = true } }}, .may_throw = false }};
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &body, &budget)) == .valid);
    var result = try owners.analyze(std.testing.allocator, &scope, &.{}, "f", &body, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    inline for (std.meta.tags(m.AccessFlag)) |flag| {
        var found = false;
        for (result.effects) |effect| if (effect.root == .parameter and effect.root.parameter == 0 and effect.flag == flag) { found = true; };
        try std.testing.expect(found);
    }
}

test "a smaller numbered nested Value is still checked for complete initialization" {
    var scope = directory; var functions = directory.functions[0..2].*;
    functions[1].parameter_types = &.{}; functions[1].return_type = "array"; scope.functions = &functions;
    const body = m.Graph{ .nodes = &.{ .{ .local = .{ .@"type" = "box" } }, .{ .local = .{ .@"type" = "array" } } },
        .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "element", .view = "array", .values = &.{0}, .control = 0, .initialize = true } } },
        .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{} }, .accesses = &.{},
    };
    const rows = [_]owners.Fixed{.{ .function_id = "f", .graph = &body, .parameters = &.{}, .captures = &.{}, .may_throw = false }};
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &body, &budget)) == .valid);
    var result = try owners.analyze(std.testing.allocator, &scope, &physical, "f", &body, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, .payload_uninitialized), result.pending);
}

test "nested Value copy records the actual recursive source rather than only its outer output" {
    var scope = directory;
    scope.types = &.{ .{ .id = "array", .kind = .array }, .{ .id = "box", .kind = .value }, .{ .id = "inner", .kind = .value }, .{ .id = "reference", .kind = .reference } };
    scope.fields = &.{ "field", "inner-field" };
    scope.constructions = &.{ .{ .id = "box-role", .owner = "box", .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "inner-role", .owner = "inner", .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "reference-role", .owner = "reference", .base = null, .kind = .implicit_base, .function_id = null },
    };
    const fields = [_]owners.Physical{
        .{ .type_id = "box", .fields = &.{.{ .id = "field", .view = "box", .physical = 0, .type_id = "inner" }} },
        .{ .type_id = "inner", .fields = &.{.{ .id = "inner-field", .view = "inner", .physical = 0, .type_id = "reference" }} },
    };
    const initial = owners.Initial{
        .locations = &.{ .{ .kind = .payload, .owner = .{ .input = 0 }, .type_id = "box" }, .{ .kind = .payload, .owner = .{ .input = 1 }, .type_id = "inner" }, .{ .kind = .root, .owner = .{ .input = 2 }, .type_id = "reference" } },
        .arguments = &.{&.{0}}, .environment = &.{}, .parents = &.{},
        .heap = &.{ .{ .base = 0, .selector = "field:field", .view = "box", .values = &.{1} }, .{ .base = 1, .selector = "field:inner-field", .view = "inner", .values = &.{2} } },
    };
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &graph, &budget)) == .valid);
    var result = try owners.analyzeInputs(std.testing.allocator, &scope, &fields, "f", &graph, &fixed, &budget, null, &initial); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expectEqual(@as(usize, 2), result.normal_payloads.len); try std.testing.expectEqual(@as(usize, 2), result.language_payloads.len);
    var copied_inner = false; var original_inner = false;
    for (result.normal_payloads) |row| if (std.mem.eql(u8, row.type_id, "inner")) {
        copied_inner = true; try std.testing.expectEqual(owners.Kind.copied, result.locations[row.location].kind);
        try std.testing.expectEqual(@as(?usize, null), result.locations[row.location].input);
    };
    for (result.language_payloads) |row| if (std.mem.eql(u8, row.type_id, "inner")) {
        original_inner = true; try std.testing.expectEqual(@as(?usize, 1), result.locations[row.location].input);
    };
    try std.testing.expect(copied_inner and original_inner);
}

test "a pure fixed callee still consumes the full parameter write on saved Array contents" {
    var scope = directory;
    scope.functions = &.{
        .{ .id = "f", .kind = .source, .parameter_types = &.{"array"}, .return_type = "array", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
        .{ .id = "g", .kind = .source, .parameter_types = &.{"array"}, .return_type = "array", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
    };
    const identity = m.Graph{ .nodes = &.{.{ .parameter = .{ .@"type" = "array", .index = 0 } }}, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{0}, .language = &.{},
        .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{} }, .accesses = &.{},
    };
    const body = m.Graph{
        .nodes = &.{ .{ .parameter = .{ .@"type" = "array", .index = 0 } }, .{ .call = .{ .@"type" = "array", .call = 0, .completion = .normal } } },
        .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } }, .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } } },
        .calls = &.{.{ .function_id = "g", .arguments = &.{&.{0}}, .environment = null, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "pure-callee" }},
        .normal = &.{1}, .language = &.{}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{} }, .accesses = &.{},
    };
    const initial = owners.Initial{
        .locations = &.{ .{ .kind = .payload, .owner = .local, .type_id = "array" }, .{ .kind = .root, .owner = .{ .input = 1 }, .type_id = "reference" } },
        .arguments = &.{&.{0}}, .environment = &.{}, .parents = &.{}, .heap = &.{.{ .base = 0, .selector = "element", .view = "array", .values = &.{1} }},
    };
    const rows = [_]owners.Fixed{
        .{ .function_id = "f", .graph = &body, .parameters = &.{.{}}, .captures = &.{}, .may_throw = false },
        .{ .function_id = "g", .graph = &identity, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = false },
    };
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &body, &budget)) == .valid);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "g", &identity, &budget)) == .valid);
    var result = try owners.analyzeInputs(std.testing.allocator, &scope, &.{}, "f", &body, &rows, &budget, null, &initial); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    var written = false;
    for (result.effects) |effect| if (effect.root == .input and effect.root.input == 1 and effect.flag == .write) { written = true; };
    try std.testing.expect(written);
}
