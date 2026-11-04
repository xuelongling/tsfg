// SPDX-License-Identifier: MIT
// Hand-authored Graph5/Directory DTOs at the fixed owner-domain seam. These are
// independent equations, not a Source package, VM input or identity witness.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const ref_type = "reference";
const function_type = "function-type";
const child = "child";
const maker = "maker";
const root = "root";
const child_env = "child-env";
const parent_env = "parent-env";
const foreign = "foreign-slot";
const owned = "owned-slot";
const global = "global";
const unused = "unused-global";
const directory = m.Directory{
    .types = &.{ .{ .id = function_type, .kind = .function }, .{ .id = ref_type, .kind = .reference } },
    .functions = &.{
        .{ .id = child, .kind = .source, .parameter_types = &.{}, .return_type = ref_type, .environment_metadata_complete = true, .lexical_environment = child_env, .activation_environment = null, .construction = null },
        .{ .id = maker, .kind = .source, .parameter_types = &.{ref_type}, .return_type = function_type, .environment_metadata_complete = true, .lexical_environment = parent_env, .activation_environment = child_env, .construction = null },
        .{ .id = root, .kind = .source, .parameter_types = &.{ref_type}, .return_type = ref_type, .environment_metadata_complete = true, .lexical_environment = parent_env, .activation_environment = null, .construction = null },
    },
    .environments = &.{
        .{ .id = child_env, .parent = parent_env, .slots = &.{.{ .key = owned, .@"type" = ref_type, .writable = true }} },
        .{ .id = parent_env, .parent = null, .slots = &.{.{ .key = foreign, .@"type" = ref_type, .writable = true }} },
    },
    .globals = &.{ .{ .id = global, .@"type" = ref_type }, .{ .id = unused, .@"type" = ref_type } },
    .fields = &.{},
    .constructions = &.{.{ .id = "reference-construction", .owner = ref_type, .base = null, .kind = .implicit_base, .function_id = null }},
};
const child_nodes = [_]m.Value{
    .{ .environment_input = .{ .layout = child_env } },
    .{ .capture = .{ .@"type" = ref_type, .id = owned, .layout = child_env, .environment = &.{0}, .heap = 0, .control = 0 } },
    .{ .environment_parent = .{ .layout = parent_env, .bases = &.{0}, .control = 0 } },
    .{ .capture = .{ .@"type" = ref_type, .id = foreign, .layout = parent_env, .environment = &.{2}, .heap = 0, .control = 0 } },
};
const child_graph = m.Graph{ .nodes = &child_nodes, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{}, .normal = &.{1}, .language = &.{3},
    .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{.{ .heap = 0, .control = 0 }} }, .accesses = &.{} };
const maker_nodes = [_]m.Value{
    .{ .parameter = .{ .@"type" = ref_type, .index = 0 } },
    .{ .environment_input = .{ .layout = parent_env } },
    .{ .environment_create = .{ .layout = child_env, .parent = &.{1}, .site = "make-child-env", .control = 0 } },
    .{ .code = .{ .@"type" = function_type, .function_id = child, .environment = &.{2}, .control = 0 } },
    .{ .copy = .{ .@"type" = function_type, .bases = &.{3}, .site = "copy-closure", .heap = 1, .control = 0 } },
};
const maker_heaps = [_]m.Heap{
    .entry,
    .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "capture:" ++ owned, .view = "env:" ++ child_env, .values = &.{0}, .control = 0, .initialize = true } },
    .{ .copy = .{ .previous = 1, .value = 4 } },
};
const maker_graph = m.Graph{ .nodes = &maker_nodes, .heaps = &maker_heaps, .controls = &.{.entry}, .calls = &.{}, .normal = &.{4}, .language = &.{4},
    .exits = .{ .normal = &.{.{ .heap = 2, .control = 0 }}, .language = &.{.{ .heap = 2, .control = 0 }} }, .accesses = &.{} };
const root_nodes = [_]m.Value{
    .{ .parameter = .{ .@"type" = ref_type, .index = 0 } },
    .{ .environment_input = .{ .layout = parent_env } },
    .{ .call = .{ .@"type" = function_type, .call = 0, .completion = .normal } },
    .{ .environment_component = .{ .layout = child_env, .function_id = child, .callee = &.{2}, .control = 1 } },
    .{ .call = .{ .@"type" = ref_type, .call = 1, .completion = .normal } },
    .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } },
    .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
    .{ .call = .{ .@"type" = function_type, .call = 2, .completion = .normal } },
    .{ .global = .{ .@"type" = ref_type, .id = global } },
};
const root_calls = [_]m.Call{
    .{ .function_id = maker, .arguments = &.{&.{0}}, .environment = &.{1}, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "first-maker" },
    .{ .function_id = child, .arguments = &.{}, .environment = &.{3}, .callee = &.{2}, .receiver = null, .heap = 1, .control = 1, .site = "invoke-first-closure" },
    .{ .function_id = maker, .arguments = &.{&.{8}}, .environment = &.{1}, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "second-maker" },
};
const root_graph = m.Graph{
    .nodes = &root_nodes,
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } } },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } } },
    .calls = &root_calls, .normal = &.{4}, .language = &.{ 5, 6 },
    .exits = .{ .normal = &.{.{ .heap = 3, .control = 3 }}, .language = &.{ .{ .heap = 2, .control = 2 }, .{ .heap = 4, .control = 4 } } }, .accesses = &.{},
};
const fixed = [_]owners.Fixed{
    .{ .function_id = child, .graph = &child_graph, .parameters = &.{}, .captures = &.{ .{ .key = owned, .flags = .{ .write = true } }, .{ .key = foreign, .flags = .{ .read = true } } }, .may_throw = true },
    // The complete fixed parameter write remains, although maker's graph only
    // initializes a local slot. A current-body observation cannot shrink it.
    .{ .function_id = maker, .graph = &maker_graph, .parameters = &.{.{ .write = true }}, .captures = &.{}, .may_throw = true },
    .{ .function_id = root, .graph = &root_graph, .parameters = &.{.{}}, .captures = &.{}, .may_throw = true },
};
const Meter = struct {
    remaining: usize = 50_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer)); if (units > self.remaining) return error.BudgetExceeded; self.remaining -= units;
    }
};
fn typed(budget: *m.Budget, input_directory: *const m.Directory, root_input: *const m.Graph, rows: []const owners.Fixed) !void {
    try m.validateDirectory(std.testing.allocator, input_directory, budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, input_directory, root, root_input, budget)) == .valid);
    for (rows) |row| if (row.graph) |graph| try std.testing.expect((try m.validateGraph(std.testing.allocator, input_directory, row.function_id, graph, budget)) == .valid);
}

test "saved fixed calls preserve parent slots, copied Code ENV pairs, both completions and full uppers" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &directory, &root_graph, &fixed);
    const before = meter.remaining;
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &fixed, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live); try std.testing.expect(result.normal.len != 0);
    for (result.normal) |id| {
        const actual = result.locations[id].owner; try std.testing.expect(actual == .parameter); try std.testing.expectEqual(@as(usize, 0), actual.parameter);
    }
    var foreign_language = false; var thrown_closure = false;
    for (result.language) |id| {
        const location = result.locations[id];
        if (location.owner == .capture) { try std.testing.expectEqualStrings(foreign, location.owner.capture); foreign_language = true; }
        if (location.kind == .code) { try std.testing.expectEqualStrings(child, location.function_id.?); try std.testing.expect(location.environment != null); thrown_closure = true; }
    }
    try std.testing.expect(foreign_language and thrown_closure);
    var parameter_write = false; var global_write = false; var capture_read = false;
    for (result.effects) |effect| switch (effect.root) {
        .parameter => |index| { try std.testing.expectEqual(@as(usize, 0), index); parameter_write = parameter_write or effect.flag == .write; },
        .global => |id| { try std.testing.expectEqualStrings(global, id); global_write = global_write or effect.flag == .write; },
        .capture => |id| { try std.testing.expectEqualStrings(foreign, id); capture_read = capture_read or effect.flag == .read; },
        else => return error.TestUnexpectedRoot,
    };
    try std.testing.expect(parameter_write and global_write and capture_read);
    var activations: usize = 0;
    for (result.locations) |location| if (location.kind == .environment_local) { activations += 1; try std.testing.expectEqualStrings(child_env, location.layout.?); };
    try std.testing.expectEqual(@as(usize, 2), activations);
    try std.testing.expect(meter.remaining < before and meter.remaining > 0);
}

test "a local returned closure requires initialize before every slot use" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var heaps = maker_heaps; heaps[1].store.initialize = false; var missing = maker_graph; missing.heaps = &heaps;
    var rows = fixed; rows[1].graph = &missing; try typed(&budget, &directory, &root_graph, &rows);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.capture_uninitialized, result.pending.?);
}

test "an unread uninitialized slot is retained in returned ENV completeness" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var environments = directory.environments[0..2].*;
    environments[0].slots = &.{ .{ .key = owned, .@"type" = ref_type, .writable = true }, .{ .key = "unread-slot", .@"type" = ref_type, .writable = false } };
    var incomplete = directory; incomplete.environments = &environments; try typed(&budget, &incomplete, &root_graph, &fixed);
    var result = try owners.analyze(std.testing.allocator, &incomplete, &.{}, root, &root_graph, &fixed, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.capture_uninitialized, result.pending.?);
}

test "Code environment components stay associated with the same callee refs" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var nodes = root_nodes; nodes[3].environment_component.callee = &.{7}; var wrong = root_graph; wrong.nodes = &nodes;
    try m.validateDirectory(std.testing.allocator, &directory, &budget);
    try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &directory, root, &wrong, &budget));
}

test "missing fixed return relation and unknown origins remain pending" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var rows = fixed; rows[1].graph = null; try typed(&budget, &directory, &root_graph, &rows);
    var absent = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &rows, &budget); defer absent.deinit();
    try std.testing.expectEqual(owners.Pending.missing_fixed, absent.pending.?);
    var nodes = root_nodes; nodes[8] = .unknown; var unknown = root_graph; unknown.nodes = &nodes;
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &unknown, &fixed, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.unknown_origin, result.pending.?);
}

test "a complete upper mayThrow cannot be narrowed by a normal-only fixed relation" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var normal_only = child_graph; normal_only.exits.language = &.{}; normal_only.language = &.{};
    var rows = fixed; rows[0].graph = &normal_only; try typed(&budget, &directory, &root_graph, &rows);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.incomplete_completion, result.pending.?);
}

test "an inactive nonthrowing call alternative does not poison a different live language value" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    var normal_only = child_graph; normal_only.exits.language = &.{}; normal_only.language = &.{};
    var rows = fixed; rows[0].graph = &normal_only; rows[0].may_throw = false;
    try typed(&budget, &directory, &root_graph, &rows);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live and result.normal.len != 0 and result.language.len != 0);
    for (result.normal) |id| { const actual = result.locations[id].owner; try std.testing.expect(actual == .parameter and actual.parameter == 0); }
    // Only maker's explicitly thrown closure reaches this union. The inactive
    // child-language capture has neither data nor an exception continuation.
    for (result.language) |id| {
        const location = result.locations[id]; try std.testing.expectEqual(owners.Kind.code, location.kind);
        try std.testing.expectEqualStrings(child, location.function_id.?); try std.testing.expect(location.environment != null);
    }
}

test "the same owning budget is exhausted without a per-call refill" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &directory, &root_graph, &fixed);
    try budget.spend(meter.remaining);
    try std.testing.expectError(error.BudgetExceeded, owners.analyze(std.testing.allocator, &directory, &.{}, root, &root_graph, &fixed, &budget));
    try std.testing.expectEqual(@as(usize, 0), meter.remaining);
}

test "a real physical Value field copy retains its nested Code ENV relationship" {
    const box = "box-type"; const field = "box-field";
    var input_directory = directory;
    input_directory.types = &.{ .{ .id = box, .kind = .value }, .{ .id = function_type, .kind = .function }, .{ .id = ref_type, .kind = .reference } };
    input_directory.fields = &.{field};
    input_directory.constructions = &.{
        .{ .id = "box-construction", .owner = box, .base = null, .kind = .implicit_base, .function_id = null },
        .{ .id = "reference-construction", .owner = ref_type, .base = null, .kind = .implicit_base, .function_id = null },
    };
    const nodes = [_]m.Value{
        maker_nodes[0], maker_nodes[1], maker_nodes[2], maker_nodes[3],
        .{ .local = .{ .@"type" = box } },
        .{ .copy = .{ .@"type" = box, .bases = &.{4}, .site = "copy-container", .heap = 2, .control = 0 } },
        .{ .projection = .{ .@"type" = function_type, .bases = &.{5}, .selector = "field:" ++ field, .view = box, .heap = 3, .control = 0 } },
        .{ .copy = .{ .@"type" = function_type, .bases = &.{6}, .site = "copy-nested-closure", .heap = 3, .control = 0 } },
    };
    const heaps = [_]m.Heap{
        maker_heaps[0], maker_heaps[1],
        .{ .store = .{ .previous = 1, .bases = &.{4}, .selector = "field:" ++ field, .view = box, .values = &.{3}, .control = 0, .initialize = true } },
        .{ .copy = .{ .previous = 2, .value = 5 } },
        .{ .copy = .{ .previous = 3, .value = 7 } },
    };
    var containing = maker_graph; containing.nodes = &nodes; containing.heaps = &heaps;
    containing.normal = &.{7}; containing.language = &.{7};
    containing.exits = .{ .normal = &.{.{ .heap = 4, .control = 0 }}, .language = &.{.{ .heap = 4, .control = 0 }} };
    var rows = fixed; rows[1].graph = &containing;
    const physical = [_]owners.Physical{.{ .type_id = box, .fields = &.{.{ .id = field, .view = box, .physical = 0, .type_id = function_type }} }};
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try typed(&budget, &input_directory, &root_graph, &rows);
    var result = try owners.analyze(std.testing.allocator, &input_directory, &physical, root, &root_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending); try std.testing.expect(result.normal.len != 0);
    for (result.normal) |id| { const actual = result.locations[id].owner; try std.testing.expect(actual == .parameter and actual.parameter == 0); }
    var copies: usize = 0;
    for (result.locations) |location| if (location.kind == .copied) { copies += 1; try std.testing.expectEqualStrings(box, location.type_id.?); };
    try std.testing.expectEqual(@as(usize, 2), copies);
    const absent = [_]owners.Physical{.{ .type_id = box, .fields = null }};
    var missing = try owners.analyze(std.testing.allocator, &input_directory, &absent, root, &root_graph, &rows, &budget); defer missing.deinit();
    try std.testing.expectEqual(owners.Pending.copy_layout, missing.pending.?);
}

test "the root complete capture upper applies even when its graph does not read the slots" {
    const captures = [_]owners.Capture{
        .{ .key = foreign, .flags = .{ .write = true } },
        .{ .key = owned, .flags = .{ .structural = true } },
    };
    var rows = fixed; rows[1].captures = &captures;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &directory, &budget);
    for (rows) |row| if (row.graph) |graph| try std.testing.expect((try m.validateGraph(std.testing.allocator, &directory, row.function_id, graph, &budget)) == .valid);
    // maker only initializes a new slot and returns a copied closure. The
    // declared upper, independently, includes both capture obligations.
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, maker, &maker_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    var foreign_write = false; var parameter_structural = false;
    for (result.effects) |effect| switch (effect.root) {
        .capture => |id| { try std.testing.expectEqualStrings(foreign, id); foreign_write = foreign_write or effect.flag == .write; },
        .parameter => |index| { try std.testing.expectEqual(@as(usize, 0), index); parameter_structural = parameter_structural or effect.flag == .structural; },
        else => return error.TestUnexpectedRoot,
    };
    try std.testing.expect(foreign_write and parameter_structural);
}
