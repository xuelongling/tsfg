// SPDX-License-Identifier: MIT
// Independent symbolic saved-content DTOs; no Source/Program/Actual/VM input.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const owners = @import("wire-program-return-origin-owners.zig");
const scope = m.Directory{
    .types = &.{ .{ .id = "array", .kind = .array }, .{ .id = "function", .kind = .function }, .{ .id = "reference", .kind = .reference } },
    .functions = &.{
        .{ .id = "f", .kind = .source, .parameter_types = &.{"array"}, .return_type = "array", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
        .{ .id = "g", .kind = .source, .parameter_types = &.{}, .return_type = "reference", .environment_metadata_complete = true, .lexical_environment = "child", .activation_environment = null, .construction = null },
        .{ .id = "h", .kind = .source, .parameter_types = &.{"array"}, .return_type = "array", .environment_metadata_complete = true, .lexical_environment = null, .activation_environment = null, .construction = null },
    },
    .environments = &.{
        .{ .id = "child", .parent = "parent", .slots = &.{.{ .key = "child-slot", .@"type" = "reference", .writable = true }} },
        .{ .id = "parent", .parent = null, .slots = &.{.{ .key = "parent-slot", .@"type" = "reference", .writable = true }} },
    },
    .globals = &.{.{ .id = "G", .@"type" = "reference" }}, .fields = &.{},
    .constructions = &.{.{ .id = "reference-role", .owner = "reference", .base = null, .kind = .implicit_base, .function_id = null }},
};
const identity = m.Graph{
    .nodes = &.{.{ .parameter = .{ .@"type" = "array", .index = 0 } }}, .heaps = &.{.entry}, .controls = &.{.entry}, .calls = &.{},
    .normal = &.{0}, .language = &.{0}, .exits = .{ .normal = &.{.{ .heap = 0, .control = 0 }}, .language = &.{.{ .heap = 0, .control = 0 }} }, .accesses = &.{},
};
const graph = m.Graph{
    .nodes = &.{ .{ .parameter = .{ .@"type" = "array", .index = 0 } }, .{ .call = .{ .@"type" = null, .call = 0, .completion = .language } }, .{ .call = .{ .@"type" = "array", .call = 0, .completion = .normal } } },
    .heaps = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } } },
    .controls = &.{ .entry, .{ .call = .{ .call = 0, .completion = .normal } }, .{ .call = .{ .call = 0, .completion = .language } } },
    .calls = &.{.{ .function_id = "h", .arguments = &.{&.{0}}, .environment = null, .callee = null, .receiver = null, .heap = 0, .control = 0, .site = "full-content-consumer" }},
    .normal = &.{2}, .language = &.{1}, .exits = .{ .normal = &.{.{ .heap = 1, .control = 1 }}, .language = &.{.{ .heap = 2, .control = 2 }} }, .accesses = &.{},
};
const saved = owners.Initial{
    .locations = &.{
        .{ .kind = .payload, .owner = .local, .type_id = "array" },
        .{ .kind = .code, .owner = .local, .type_id = "function", .function_id = "g", .environment = 2 },
        .{ .kind = .environment_local, .owner = .local, .layout = "child" },
        .{ .kind = .environment_input, .owner = .nonowning, .layout = "parent" },
        .{ .kind = .root, .owner = .{ .input = 4 }, .type_id = "reference" },
        .{ .kind = .root, .owner = .{ .capture = "parent-slot" }, .type_id = "reference" },
        .{ .kind = .root, .owner = .{ .global = "G" }, .type_id = "reference" },
    },
    .arguments = &.{&.{0}}, .environment = &.{}, .parents = &.{ .{ .location = 2, .parents = &.{3} }, .{ .location = 3, .parents = &.{} } },
    .heap = &.{
        .{ .base = 0, .selector = "element", .view = "array", .values = &.{1} },
        .{ .base = 2, .selector = "capture:child-slot", .view = "env:child", .values = &.{4} },
        .{ .base = 3, .selector = "capture:parent-slot", .view = "env:parent", .values = &.{ 5, 6 } },
    },
};
const rows = [_]owners.Fixed{
    .{ .function_id = "f", .graph = &graph, .parameters = &.{.{}}, .captures = &.{}, .may_throw = true },
    .{ .function_id = "g", .graph = null, .parameters = &.{}, .captures = &.{}, .may_throw = false },
    .{ .function_id = "h", .graph = &identity, .parameters = &.{.{ .read = true, .write = true, .structural = true }}, .captures = &.{}, .may_throw = true },
};
const Meter = struct {
    remaining: usize = 50_000_000,
    fn charge(pointer: *anyopaque, units: usize) error{BudgetExceeded}!void {
        const self: *Meter = @ptrCast(@alignCast(pointer)); if (units > self.remaining) return error.BudgetExceeded; self.remaining -= units;
    }
};
test "saved Array Code ENV parents preserve input global capture effects and both completion payloads" {
    var meter: Meter = .{}; var budget = m.Budget{ .context = &meter, .charge = Meter.charge };
    try m.validateDirectory(std.testing.allocator, &scope, &budget);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "f", &graph, &budget)) == .valid);
    try std.testing.expect((try m.validateGraph(std.testing.allocator, &scope, "h", &identity, &budget)) == .valid);
    var result = try owners.analyzeInputs(std.testing.allocator, &scope, &.{}, "f", &graph, &rows, &budget, null, &saved); defer result.deinit();
    try std.testing.expectEqual(@as(?owners.Pending, null), result.pending);
    try std.testing.expect(result.normal_live and result.language_live);
    for ([_][]const owners.Payload{ result.normal_payloads, result.language_payloads }, [_][]const usize{ result.normal, result.language }) |payloads, outputs| {
        try std.testing.expectEqual(@as(usize, 1), payloads.len); try std.testing.expectEqual(@as(usize, 1), outputs.len);
        try std.testing.expectEqual(outputs[0], payloads[0].location);
        try std.testing.expectEqualStrings("array", payloads[0].type_id);
        const elements = payloads[0].slots[0].values; try std.testing.expectEqual(@as(usize, 1), elements.len);
        const code = result.locations[elements[0]]; try std.testing.expectEqual(owners.Kind.code, code.kind);
        try std.testing.expectEqualStrings("g", code.function_id.?); try std.testing.expect(code.environment != null);
        const env = code.environment.?; try std.testing.expectEqualStrings("child", result.locations[env].layout.?);
        var parents: ?[]const usize = null;
        for (result.environments) |row| if (row.location == env) { parents = row.parents; };
        try std.testing.expect(parents != null); try std.testing.expectEqual(@as(usize, 1), parents.?.len);
        try std.testing.expectEqualStrings("parent", result.locations[parents.?[0]].layout.?);
    }
    inline for (.{ m.AccessFlag.read, m.AccessFlag.write, m.AccessFlag.structural }) |flag| {
        var parameter = false; var capture = false; var global = false;
        for (result.effects) |effect| {
            if (effect.flag != flag) continue;
            switch (effect.root) {
                .input => |index| if (index == 4) { parameter = true; },
                .capture => |key| if (std.mem.eql(u8, key, "parent-slot")) { capture = true; },
                .global => |key| if (std.mem.eql(u8, key, "G")) { global = true; },
                else => {},
            }
        }
        try std.testing.expect(parameter and capture and global);
    }
}
