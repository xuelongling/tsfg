// SPDX-License-Identifier: MIT
// Independent literal Graph/Directory DTOs. No Source packet, Program factory,
// parser, loader, State, ActualAnalysis or VM is used by this seam.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const construction = @import("wire-program-return-origin-construction.zig");
const owners = @import("wire-program-return-origin-owners.zig");
pub const reference = "sha256:" ++ "66" ** 32;
pub const callable = "sha256:" ++ "88" ** 32;
pub const caller = "sha256:" ++ "11" ** 32;
pub const child = "sha256:" ++ "22" ** 32;
pub const constructor = "sha256:" ++ "33" ** 32;
pub const parent_env = "sha256:" ++ "77" ** 32;
pub const child_env = "sha256:" ++ "99" ** 32;
pub const foreign_slot = "sha256:" ++ "55" ** 32;
pub const local_slot = "sha256:" ++ "aa" ** 32;
pub const role = "sha256:" ++ "bb" ** 32;
pub const directory = m.Directory{
    .types = &.{ .{ .id = reference, .kind = .reference }, .{ .id = callable, .kind = .function } },
    .functions = &.{
        .{ .id = caller, .kind = .source, .parameter_types = &.{reference}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = parent_env, .construction = null },
        .{ .id = child, .kind = .source, .parameter_types = &.{}, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = child_env, .activation_environment = null, .construction = null },
        .{ .id = constructor, .kind = .construction_body, .parameter_types = &.{ reference, reference }, .return_type = reference, .environment_metadata_complete = true, .lexical_environment = parent_env, .activation_environment = child_env, .construction = .{ .id = role, .owner = reference, .base = null, .receiver_index = 0 } },
    },
    .environments = &.{
        .{ .id = parent_env, .parent = null, .slots = &.{.{ .key = foreign_slot, .@"type" = reference, .writable = true }} },
        .{ .id = child_env, .parent = parent_env, .slots = &.{.{ .key = local_slot, .@"type" = reference, .writable = true }} },
    },
    .constructions = &.{.{ .id = role, .owner = reference, .base = null, .kind = .explicit, .function_id = constructor }},
    .globals = &.{}, .fields = &.{},
};
pub const nodes = [_]m.Value{
    .{ .environment_input = .{ .layout = parent_env } },
    .receiver_input,
    .{ .parameter = .{ .@"type" = reference, .index = 1 } },
    .{ .environment_create = .{ .layout = child_env, .parent = &.{0}, .site = "new-child-env", .control = 0 } },
    .{ .capture = .{ .@"type" = reference, .id = local_slot, .layout = child_env, .environment = &.{3}, .heap = 1, .control = 0 } },
    .{ .code = .{ .@"type" = callable, .function_id = child, .environment = &.{3}, .control = 0 } },
    .{ .copy = .{ .@"type" = callable, .bases = &.{5}, .site = "copy-child-code", .heap = 2, .control = 0 } },
    .{ .receiver_value = .{ .@"type" = reference, .action = 4 } },
    .{ .receiver_value = .{ .@"type" = null, .action = 5 } },
    .{ .environment_parent = .{ .layout = parent_env, .bases = &.{3}, .control = 0 } },
};
pub const heaps = [_]m.Heap{
    .entry,
    .{ .store = .{ .previous = 0, .bases = &.{3}, .selector = "capture:" ++ local_slot, .view = "env:" ++ child_env, .values = &.{2}, .control = 0, .initialize = true } },
    .{ .store = .{ .previous = 1, .bases = &.{3}, .selector = "capture:" ++ local_slot, .view = "env:" ++ child_env, .values = &.{4}, .control = 0, .initialize = false } },
    .{ .copy = .{ .previous = 2, .value = 6 } },
    .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{6}, .completion = .normal } },
    .{ .receiver_action = .{ .previous = 3, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{6}, .completion = .language } },
};
pub const graph = m.Graph{
    .nodes = &nodes, .heaps = &heaps,
    .controls = &.{ .entry, .{ .receiver_completion = .{ .action = 4 } }, .{ .receiver_completion = .{ .action = 5 } } },
    .calls = &.{}, .normal = &.{7}, .language = &.{8},
    .exits = .{ .normal = &.{.{ .heap = 4, .control = 1 }}, .language = &.{.{ .heap = 5, .control = 2 }} }, .accesses = &.{},
};
pub fn contracts(input: *const m.Graph) [1]owners.Fixed {
    // These complete capture obligations deliberately exceed the graph's
    // explicit reads: mutable local contents and the unread foreign input.
    return .{.{ .function_id = constructor, .graph = input, .parameters = &.{ .{}, .{} }, .captures = &.{
        .{ .key = foreign_slot, .flags = .{ .read = true, .write = true, .structural = true } },
        .{ .key = local_slot, .flags = .{ .read = true, .write = true, .structural = true } },
    }, .may_throw = false }};
}
const Meter = struct {
    remaining: usize = 50_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer));
        if (units > self.remaining) return error.BudgetExceeded;
        self.remaining -= units;
    }
};
fn typed(budget: *m.Budget, input: *const m.Graph) !void {
    try m.validateDirectory(std.testing.allocator, &directory, budget);
    const validation = try m.validateGraph(std.testing.allocator, &directory, constructor, input, budget);
    try std.testing.expect(validation == .pending);
    try std.testing.expectEqual(m.Pending.construction_frame, validation.pending);
}

test "receiver result preserves copied child Code ENV, parent contents and all fixed capture flags" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try typed(&budget, &graph);
    var receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, constructor); defer receiver.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), receiver.pending);
    try std.testing.expect(receiver.heap_live[4] and !receiver.heap_live[5]);
    const before = meter.remaining; const fixed = contracts(&graph);
    var result = try owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &graph, &fixed, &budget, &receiver); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and !result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len);
    try std.testing.expectEqual(@as(usize, 0), result.language.len);
    const code = result.locations[result.normal[0]];
    try std.testing.expectEqual(owners.Kind.code, code.kind); try std.testing.expectEqualStrings(child, code.function_id.?);
    const environment = code.environment.?; try std.testing.expectEqualStrings(child_env, result.locations[environment].layout.?);
    var parent: ?usize = null;
    for (result.environments) |row| if (row.location == environment) {
        try std.testing.expectEqual(@as(usize, 1), row.parents.len); parent = row.parents[0];
    };
    try std.testing.expectEqual(owners.Kind.environment_input, result.locations[parent.?].kind);
    try std.testing.expectEqualStrings(parent_env, result.locations[parent.?].layout.?);
    var slot_found = false;
    for (result.normal_heap) |address| if (address.base == environment and std.mem.eql(u8, address.selector, "capture:" ++ local_slot)) {
        slot_found = true; try std.testing.expectEqual(@as(usize, 1), address.values.items.len);
        const root = result.locations[address.values.items[0]].owner;
        try std.testing.expect(root == .parameter); try std.testing.expectEqual(@as(usize, 1), root.parameter);
    };
    try std.testing.expect(slot_found);
    inline for (std.meta.tags(m.AccessFlag)) |flag| {
        var local_effect = false; var foreign_effect = false;
        for (result.effects) |effect| {
            if (effect.flag != flag) continue;
            if (effect.root == .parameter and effect.root.parameter == 1) local_effect = true;
            if (effect.root == .capture and std.mem.eql(u8, effect.root.capture, foreign_slot)) foreign_effect = true;
        }
        try std.testing.expect(local_effect and foreign_effect);
    }
    try std.testing.expect(meter.remaining < before and meter.remaining != 0);
}

test "receiver closure completion cannot hide missing init or a copy heap that drops its prefix" {
    inline for (.{ false, true }) |lost_copy_prefix| {
        var changed_heaps = heaps;
        if (lost_copy_prefix) changed_heaps[3].copy.previous = 0 else changed_heaps[1].store.initialize = false;
        var changed = graph; changed.heaps = &changed_heaps;
        var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &changed);
        var receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &changed, &budget, constructor); defer receiver.deinit();
        try std.testing.expectEqual(@as(?construction.Pending, null), receiver.pending);
        const fixed = contracts(&changed);
        var result = try owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &changed, &fixed, &budget, &receiver); defer result.deinit();
        try std.testing.expectEqual(owners.Pending.capture_uninitialized, result.pending.?);
    }
}

test "receiver Code ENV and parent layout mismatches fail the real typed boundary" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &directory, &budget);
    var changed_nodes = nodes; changed_nodes[5].code.environment = &.{0}; var changed = graph; changed.nodes = &changed_nodes;
    try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &directory, constructor, &changed, &budget));
    changed_nodes = nodes; changed_nodes[3].environment_create.parent = &.{3};
    try std.testing.expectError(error.InvalidGraph, m.validateGraph(std.testing.allocator, &directory, constructor, &changed, &budget));
}

test "receiver allocation and error symbols do not collide or invent a formal Actual type" {
    // Node one is the formal frame. Heap one also produces a language error;
    // they are deliberately the same integer in different namespaces.
    const local_nodes = [_]m.Value{ .{ .environment_input = .{ .layout = parent_env } }, .receiver_input,
        .{ .literal = .{ .@"type" = null, .category = .@"undefined" } },
        .{ .receiver_value = .{ .@"type" = null, .action = 1 } },
        .{ .receiver_value = .{ .@"type" = reference, .action = 2 } },
    };
    var input = graph; input.nodes = &local_nodes;
    input.heaps = &.{ .entry,
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .result, .operands = &.{2}, .completion = .language } },
        .{ .receiver_action = .{ .previous = 0, .control = 0, .frames = &.{1}, .action = .allocate, .operands = &.{}, .completion = .normal } },
    };
    input.controls = &.{ .entry, .{ .receiver_completion = .{ .action = 1 } }, .{ .receiver_completion = .{ .action = 2 } } };
    input.normal = &.{4}; input.language = &.{3};
    input.exits = .{ .normal = &.{.{ .heap = 2, .control = 2 }}, .language = &.{.{ .heap = 1, .control = 1 }} };
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &input);
    var receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &input, &budget, constructor); defer receiver.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), receiver.pending);
    try std.testing.expectEqual(@as(?m.Symbol, null), receiver.frames[1].new_target);
    const fixed = [_]owners.Fixed{.{ .function_id = constructor, .graph = &input, .parameters = &.{ .{}, .{} }, .captures = &.{}, .may_throw = true }};
    var result = try owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &input, &fixed, &budget, &receiver); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    try std.testing.expectEqual(@as(usize, 1), result.normal.len); try std.testing.expectEqual(@as(usize, 1), result.language.len);
    try std.testing.expect(result.normal[0] != result.language[0]);
    try std.testing.expectEqual(@as(?m.Symbol, null), result.locations[result.normal[0]].type_id);
    try std.testing.expectEqualStrings("receiver-allocation", result.locations[result.normal[0]].key.?);
    try std.testing.expectEqualStrings("receiver-language-error", result.locations[result.language[0]].key.?);
    var copy_nodes: [6]m.Value = undefined; @memcpy(copy_nodes[0..5], &local_nodes);
    copy_nodes[5] = .{ .copy = .{ .@"type" = reference, .bases = &.{4}, .site = "copy-unknown-target", .heap = 2, .control = 2 } };
    var copied = input; copied.nodes = &copy_nodes;
    var copy_heaps: [4]m.Heap = undefined; @memcpy(copy_heaps[0..3], input.heaps);
    copy_heaps[3] = .{ .copy = .{ .previous = 2, .value = 5 } }; copied.heaps = &copy_heaps;
    copied.normal = &.{5}; copied.exits.normal = &.{.{ .heap = 3, .control = 2 }}; try typed(&budget, &copied);
    var copy_receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &copied, &budget, constructor); defer copy_receiver.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), copy_receiver.pending);
    const copy_fixed = [_]owners.Fixed{.{ .function_id = constructor, .graph = &copied, .parameters = &.{ .{}, .{} }, .captures = &.{}, .may_throw = true }};
    var copy_result = try owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &copied, &copy_fixed, &budget, &copy_receiver); defer copy_result.deinit();
    try std.testing.expectEqual(owners.Pending.copy_layout, copy_result.pending.?);
}

test "receiver bridge spends the same remaining budget and cannot refill it" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &graph);
    var receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &graph, &budget, constructor); defer receiver.deinit();
    try std.testing.expectEqual(@as(?construction.Pending, null), receiver.pending);
    meter.remaining = 1; const fixed = contracts(&graph);
    try std.testing.expectError(error.BudgetExceeded, owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &graph, &fixed, &budget, &receiver));
}

test "receiver unknown Data and calls remain explicit unfinished boundaries" {
    var changed_nodes = nodes; changed_nodes[2] = .unknown; var unknown = graph; unknown.nodes = &changed_nodes;
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge }; try typed(&budget, &unknown);
    var unknown_receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &unknown, &budget, constructor); defer unknown_receiver.deinit();
    try std.testing.expectEqual(construction.Pending.unknown_origin, unknown_receiver.pending.?);
    var with_call = graph;
    with_call.calls = &.{.{ .function_id = child, .arguments = &.{}, .environment = &.{3}, .callee = null, .receiver = null, .heap = 2, .control = 0, .site = "unfinished-constructor-call" }};
    try typed(&budget, &with_call);
    var call_receiver = try construction.analyzeReturns(std.testing.allocator, &directory, &with_call, &budget, constructor); defer call_receiver.deinit();
    try std.testing.expectEqual(construction.Pending.fixed_call, call_receiver.pending.?);
    const fixed = contracts(&with_call);
    var result = try owners.analyzeReceiver(std.testing.allocator, &directory, &.{}, constructor, &with_call, &fixed, &budget, &call_receiver); defer result.deinit();
    try std.testing.expectEqual(owners.Pending.receiver_protocol, result.pending.?);
}
