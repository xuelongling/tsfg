// SPDX-License-Identifier: MIT
// Independent literal Directory/Graph DTOs at the existing owners.analyze API.
// No source packet, parser, loader, Program factory, ActualAnalysis or VM.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const reference = "reference";
const callable = "function";
const directory = m.Directory{
    .types = &.{ .{ .id = callable, .kind = .function }, .{ .id = reference, .kind = .reference } },
    .functions = &.{
        .{ .id = "a", .kind = .method, .parameter_types = &.{ reference, reference }, .return_type = callable, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = "a-env", .construction = null },
        .{ .id = "b", .kind = .method, .parameter_types = &.{reference}, .return_type = callable, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = "b-env", .construction = null },
        .{ .id = "child-a", .kind = .source, .parameter_types = &.{}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = "a-env", .activation_environment = null, .construction = null },
        .{ .id = "child-b", .kind = .source, .parameter_types = &.{}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = "b-env", .activation_environment = null, .construction = null },
        .{ .id = "root", .kind = .source, .parameter_types = &.{ reference, reference }, .return_type = callable, .environment_metadata_complete = true, .lexical_environment = "parent-env", .activation_environment = null, .construction = null },
    },
    .environments = &.{
        .{ .id = "a-env", .parent = null, .slots = &.{ .{ .key = "a-argument", .@"type" = reference, .writable = true }, .{ .key = "a-receiver", .@"type" = reference, .writable = true } } },
        .{ .id = "b-env", .parent = null, .slots = &.{.{ .key = "b-receiver", .@"type" = reference, .writable = true }} },
        .{ .id = "parent-env", .parent = null, .slots = &.{.{ .key = "foreign", .@"type" = reference, .writable = true }} },
    },
    .constructions = &.{.{ .id = "reference-role", .owner = reference, .base = null, .kind = .implicit_base, .function_id = null }},
    .globals = &.{}, .fields = &.{},
};
const a_nodes = [_]m.Value{
    .{ .parameter = .{ .@"type" = reference, .index = 0 } },
    .{ .parameter = .{ .@"type" = reference, .index = 1 } },
    .{ .environment_create = .{ .layout = "a-env", .parent = null, .site = "a-activation", .control = 0 } },
    .{ .code = .{ .@"type" = callable, .function_id = "child-a", .environment = &.{2}, .control = 0 } },
    .{ .copy = .{ .@"type" = callable, .bases = &.{3}, .site = "a-copy", .heap = 2, .control = 0 } },
};
const a_heaps = [_]m.Heap{
    .entry,
    .{ .store = .{ .previous = 0, .bases = &.{2}, .selector = "capture:a-receiver", .view = "env:a-env", .values = &.{0}, .control = 0, .initialize = true } },
    .{ .store = .{ .previous = 1, .bases = &.{2}, .selector = "capture:a-argument", .view = "env:a-env", .values = &.{1}, .control = 0, .initialize = true } },
    .{ .copy = .{ .previous = 2, .value = 4 } },
};
const a_graph = m.Graph{ .nodes = &a_nodes, .heaps = &a_heaps, .controls = &.{.entry}, .calls = &.{}, .normal = &.{4}, .language = &.{1},
    .exits = .{ .normal = &.{.{ .heap = 3, .control = 0 }}, .language = &.{.{ .heap = 2, .control = 0 }} }, .accesses = &.{} };
const b_graph = m.Graph{
    .nodes = &.{ .{ .parameter = .{ .@"type" = reference, .index = 0 } },
        .{ .environment_create = .{ .layout = "b-env", .parent = null, .site = "b-activation", .control = 0 } },
        .{ .code = .{ .@"type" = callable, .function_id = "child-b", .environment = &.{1}, .control = 0 } },
    },
    .heaps = &.{ .entry, .{ .store = .{ .previous = 0, .bases = &.{1}, .selector = "capture:b-receiver", .view = "env:b-env", .values = &.{0}, .control = 0, .initialize = true } } },
    .controls = &.{.entry}, .calls = &.{}, .normal = &.{2}, .language = &.{0},
    .exits = .{ .normal = &.{.{ .heap = 1, .control = 0 }}, .language = &.{.{ .heap = 1, .control = 0 }} }, .accesses = &.{},
};
const root_graph = m.Graph{
    .nodes = &.{ .{ .parameter = .{ .@"type" = reference, .index = 0 } }, .{ .parameter = .{ .@"type" = reference, .index = 1 } },
        .{ .environment_input = .{ .layout = "parent-env" } },
        .{ .call = .{ .@"type" = callable, .call = 0, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } },
        .{ .call = .{ .@"type" = callable, .call = 1, .completion = .normal } }, .{ .call = .{ .@"type" = null, .call = 1, .completion = .language } },
        .{ .join = .{ .@"type" = callable, .inputs = &.{ 3, 5 } } }, .{ .join = .{ .@"type" = null, .inputs = &.{ 4, 6 } } },
    },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } },
        .{ .join = .{ .inputs = &.{ 1, 3 } } }, .{ .join = .{ .inputs = &.{ 2, 4 } } },
    },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } },
        .{ .call = .{ .call = 1, .completion = .normal } }, .{ .call = .{ .call = 1, .completion = .language } },
        .{ .join = .{ .inputs = &.{ 1, 3 } } }, .{ .join = .{ .inputs = &.{ 2, 4 } } },
    },
    // Receiver is logical argument zero. A dispatch's second implementation
    // consumes a shorter prefix; neither target borrows a construction frame.
    .calls = &.{
        .{ .function_id = "a", .arguments = &.{ &.{0}, &.{1} }, .environment = null, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "dispatch-site" },
        .{ .function_id = "b", .arguments = &.{&.{0}}, .environment = null, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "dispatch-site" },
    },
    .normal = &.{7}, .language = &.{8}, .exits = .{ .normal = &.{.{ .heap = 5, .control = 5 }}, .language = &.{.{ .heap = 6, .control = 6 }} }, .accesses = &.{},
};
const fixed = [_]owners.Fixed{
    .{ .function_id = "a", .graph = &a_graph, .parameters = &.{ .{ .write = true }, .{ .read = true } }, .captures = &.{}, .may_throw = true },
    .{ .function_id = "b", .graph = &b_graph, .parameters = &.{.{ .structural = true }}, .captures = &.{}, .may_throw = true },
    .{ .function_id = "child-a", .graph = null, .parameters = &.{}, .captures = &.{}, .may_throw = false },
    .{ .function_id = "child-b", .graph = null, .parameters = &.{}, .captures = &.{}, .may_throw = false },
    .{ .function_id = "root", .graph = &root_graph, .parameters = &.{ .{}, .{} }, .captures = &.{.{ .key = "foreign", .flags = .{ .read = true } }}, .may_throw = true },
};
const Meter = struct {
    remaining: usize = 50_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer)); if (units > self.remaining) return error.BudgetExceeded; self.remaining -= units;
    }
};
fn typed(budget: *m.Budget, rows: []const owners.Fixed) !void {
    try m.validateDirectory(std.testing.allocator, &directory, budget);
    for (rows) |row| if (row.graph) |graph| try std.testing.expect((try m.validateGraph(std.testing.allocator, &directory, row.function_id, graph, budget)) == .valid);
}

test "all fixed method targets retain receiver zero, shorter prefixes, saved ENV pairs and both completions" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &fixed);
    const before = meter.remaining;
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "root", &root_graph, &fixed, &budget); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 2), result.normal.len);
    var a = false; var b = false;
    for (result.normal) |id| {
        const code = result.locations[id]; try std.testing.expectEqual(owners.Kind.code, code.kind);
        const env = code.environment.?;
        if (std.mem.eql(u8, code.function_id.?, "child-a")) {
            a = true; try std.testing.expectEqualStrings("a-env", result.locations[env].layout.?);
        } else {
            try std.testing.expectEqualStrings("child-b", code.function_id.?); b = true;
            try std.testing.expectEqualStrings("b-env", result.locations[env].layout.?);
        }
        var receiver = false;
        for (result.normal_heap) |address| if (address.base == env) {
            for (address.values.items) |value| {
                const root = result.locations[value].owner; try std.testing.expect(root == .parameter);
                if (std.mem.endsWith(u8, address.selector, "receiver")) { try std.testing.expectEqual(@as(usize, 0), root.parameter); receiver = true; }
                if (std.mem.endsWith(u8, address.selector, "argument")) try std.testing.expectEqual(@as(usize, 1), root.parameter);
            }
        };
        try std.testing.expect(receiver);
    }
    try std.testing.expect(a and b);
    try std.testing.expectEqual(@as(usize, 2), result.language.len);
    var language_receiver = false; var language_argument = false;
    for (result.language) |id| {
        const root = result.locations[id].owner; try std.testing.expect(root == .parameter);
        language_receiver = language_receiver or root.parameter == 0; language_argument = language_argument or root.parameter == 1;
    }
    try std.testing.expect(language_receiver and language_argument);
    var receiver_write = false; var receiver_structural = false; var argument_read = false; var foreign_read = false;
    for (result.effects) |effect| switch (effect.root) {
        .parameter => |index| { receiver_write = receiver_write or (index == 0 and effect.flag == .write); receiver_structural = receiver_structural or (index == 0 and effect.flag == .structural); argument_read = argument_read or (index == 1 and effect.flag == .read); },
        .capture => |key| { try std.testing.expectEqualStrings("foreign", key); foreign_read = foreign_read or effect.flag == .read; },
        else => return error.UnexpectedMethodEffect,
    };
    try std.testing.expect(receiver_write and receiver_structural and argument_read and foreign_read);
    try std.testing.expect(meter.remaining < before and meter.remaining != 0);
}

test "every born method target still requires initialization on its own saved path" {
    inline for (.{ @as(u2, 1), @as(u2, 2), @as(u2, 3) }) |missing| {
        var changed_a_heaps = a_heaps;
        var changed_b_heaps = b_graph.heaps[0..2].*;
        if ((missing & 1) != 0) changed_a_heaps[1].store.initialize = false;
        if ((missing & 2) != 0) changed_b_heaps[1].store.initialize = false;
        var changed_a = a_graph; changed_a.heaps = &changed_a_heaps;
        var changed_b = b_graph; changed_b.heaps = &changed_b_heaps;
        var rows = fixed; rows[0].graph = &changed_a; rows[1].graph = &changed_b;
        var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &rows);
        var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "root", &root_graph, &rows, &budget); defer result.deinit();
        try std.testing.expectEqual(owners.Pending.capture_uninitialized, result.pending.?);
    }
}

test "a method ENV absent from every saved heap branch has no initializing witness" {
    var lost = root_graph;
    // Both returned Code alternatives remain live, but the claimed final heap
    // keeps only B's branch. A's namespace is unborn on every queried path;
    // skipping those paths must not invent a successful initialization.
    lost.exits.normal = &.{.{ .heap = 3, .control = 5 }};
    var rows = fixed; rows[4].graph = &lost;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &rows);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "root", &lost, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.capture_uninitialized, result.pending.?);
}

test "unknown method data and an unavailable permitted target never disappear" {
    inline for (.{ false, true }) |missing_fixed| {
        var changed_nodes = a_nodes; changed_nodes[0] = .unknown;
        var changed = a_graph; changed.nodes = &changed_nodes;
        var rows = fixed; rows[0].graph = if (missing_fixed) null else &changed;
        var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &rows);
        var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "root", &root_graph, &rows, &budget); defer result.deinit();
        try std.testing.expectEqual(if (missing_fixed) owners.Pending.missing_fixed else owners.Pending.unknown_origin, result.pending.?);
    }
}

test "a complete method mayThrow upper still requires its language relation" {
    var normal_only = a_graph; normal_only.language = &.{}; normal_only.exits.language = &.{};
    var rows = fixed; rows[0].graph = &normal_only;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &rows);
    var result = try owners.analyze(std.testing.allocator, &directory, &.{}, "root", &root_graph, &rows, &budget); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.incomplete_completion, result.pending.?);
}

test "method initialization walks use the same exhausted budget" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &fixed);
    meter.remaining = 1;
    try std.testing.expectError(error.BudgetExceeded, owners.analyze(std.testing.allocator, &directory, &.{}, "root", &root_graph, &fixed, &budget));
}
