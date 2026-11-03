// SPDX-License-Identifier: MIT
// Pure typed-metadata tests. No VM or complete effects/refcheck acceptance.
const std = @import("std");
const model = @import("wire-program-model.zig");
const decoder = @import("wire-program-decoder.zig");
const facts = @import("wire-program-actual-facts.zig");
const reference = @import("wire-program-reference-contracts-check.zig");
const targets = @import("wire-program-targets-check.zig");

fn expectRejectedEntry(c: *facts.Context) !void {
    if (reference.projectEntries(c)) |value| {
        var unexpected = value;
        unexpected.deinit();
        return error.TestExpectedInvalidEntryRole;
    } else |err| try std.testing.expect(err == error.InvalidShape);
}

test "entry roles join real exported selectors to raw ABI and source bindings" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const common = owned.program.tables.mode.common;
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    var roles = try reference.projectEntries(&c);
    defer roles.deinit();
    try std.testing.expectEqual(common.storage.bindings.len, roles.parameters.len);
    try std.testing.expect(common.views.entries.len > 0);
    for (common.views.entries) |entry| {
        const binding = common.storage.bindings[@intFromEnum(entry.parameter)];
        const function = owned.program.functions[@intFromEnum(entry.function)];
        const abi = common.abis[@intFromEnum(function.abi)];
        const ordinal = std.mem.indexOfScalar(model.types.BindingRef, abi.parameters, entry.parameter) orelse return error.TestExpectedParameter;
        try std.testing.expect(binding.owner == .param and binding.owner.param == entry.function);
        const origin = binding.origin orelse return error.TestExpectedOrigin;
        try std.testing.expect(origin.source == function.source and origin.start >= function.declaration.start and origin.end <= function.declaration.end);
        const role = roles.parameters[@intFromEnum(entry.parameter)] orelse return error.TestExpectedEntryRole;
        try std.testing.expectEqual(binding.@"type", abi.argument_types[ordinal]);
        try std.testing.expectEqual(binding.@"type", role.logical_type);
    }
    for (roles.parameters, 0..) |role, i| {
        if (role == null) continue;
        var selected = false;
        for (common.views.entries) |entry| if (@intFromEnum(entry.parameter) == i) { selected = true; };
        try std.testing.expect(selected);
    }
    try std.testing.expect(c.remaining < remaining);
}

test "entry roles reject wrong selectors duplicate missing extra entries and invalid selected candidates" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const common = owned.program.tables.mode.common;
    try std.testing.expectEqual(@as(usize, 1), common.views.entries.len);
    const original = common.views.entries[0];
    const Entry = @TypeOf(original);
    const constructor: model.types.FunctionRef = for (owned.program.functions, 0..) |function, i| {
        if (function.role == .construction_body) break @enumFromInt(i);
    } else return error.TestExpectedConstructor;
    const constructor_abi = common.abis[@intFromEnum(owned.program.functions[@intFromEnum(constructor)].abi)];
    try std.testing.expect(constructor_abi.parameters.len > 0);
    const unrelated = constructor_abi.parameters[0];
    // These borrowed views intentionally corrupt only the checked DTO boundary;
    // they are never claimed to be owned packets or reconstructed Source facts.
    var changed = owned.program;
    var c = facts.Context{ .program = &changed, .allocator = std.testing.allocator, .remaining = remaining };
    var wrong_function = [_]Entry{original}; wrong_function[0].function = constructor;
    changed.tables.mode.common.views.entries = &wrong_function;
    try expectRejectedEntry(&c);
    changed = owned.program;
    var wrong_binding = [_]Entry{original}; wrong_binding[0].parameter = unrelated;
    changed.tables.mode.common.views.entries = &wrong_binding;
    try expectRejectedEntry(&c);
    changed = owned.program;
    const duplicate = [_]Entry{ original, original };
    changed.tables.mode.common.views.entries = &duplicate;
    try expectRejectedEntry(&c);
    changed = owned.program;
    changed.tables.mode.common.views.entries = &.{};
    try expectRejectedEntry(&c);
    changed = owned.program;
    const extra = [_]Entry{ original, .{ .function = constructor, .parameter = unrelated, .roots = &.{} } };
    changed.tables.mode.common.views.entries = &extra;
    try expectRejectedEntry(&c);
    changed = owned.program;
    const binding = common.storage.bindings[@intFromEnum(original.parameter)];
    const nominal = common.types[@intFromEnum(binding.@"type")].element orelse return error.TestExpectedArrayElement;
    try std.testing.expect(common.types[@intFromEnum(nominal)].kind == .reference);
    const Proof = @TypeOf(common.views.compatibility[0]);
    const self_proof = [_]Proof{.{ .source_type = nominal, .target_type = nominal, .origin = binding.origin.?, .fields = &.{}, .methods = &.{} }};
    var invalid_candidate = [_]Entry{original}; invalid_candidate[0].roots = &.{@enumFromInt(0)};
    changed.tables.mode.common.views.compatibility = &self_proof;
    changed.tables.mode.common.views.entries = &invalid_candidate;
    try expectRejectedEntry(&c);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}

test "only an explicit entry role projects a weak untagged array family" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const common = owned.program.tables.mode.common;
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    // analyze owns the one deep EntryRole projection for this request.
    var actual = try targets.analyze(&c, null, &.{});
    defer actual.deinit(std.testing.allocator);
    var projected: usize = 0;
    var unknown_constructor_inputs: usize = 0;
    for (actual.invocations.items, 0..) |invocation, context_index| {
        if (!invocation.root) continue;
        const function = owned.program.functions[@intFromEnum(invocation.function)];
        const abi = common.abis[@intFromEnum(function.abi)];
        if (function.role == .construction_body) {
            const receiver = abi.receiver_frame orelse return error.TestExpectedReceiver;
            for (invocation.arguments, 0..) |argument, i| {
                if (i == receiver) continue;
                unknown_constructor_inputs += 1;
                try std.testing.expect(argument.unknown and argument.callable_unknown);
                try std.testing.expectEqual(@as(usize, 0), argument.objects.items.len);
                try std.testing.expectEqual(@as(usize, 0), argument.tags.items.len);
            }
        }
        for (common.views.entries) |entry| {
            if (entry.function != invocation.function) continue;
            const ordinal = std.mem.indexOfScalar(model.types.BindingRef, abi.parameters, entry.parameter) orelse return error.TestExpectedParameter;
            const binding = common.storage.bindings[@intFromEnum(entry.parameter)];
            if (common.types[@intFromEnum(binding.@"type")].kind != .array) continue;
            // The tracked export is an ordinary run(out), with no hidden slots.
            try std.testing.expect(abi.receiver == null and abi.lexical_environment == null);
            const value = invocation.arguments[ordinal].view();
            try std.testing.expectEqual(@as(usize, 0), value.tags.len);
            try std.testing.expectEqual(@as(usize, 1), value.objects.len);
            try std.testing.expectEqual(@as(usize, 0), value.region.roots.len);
            try std.testing.expect(value.region.unresolved);
            const object_id = value.objects[0];
            const object = actual.objects.items[@intFromEnum(object_id)];
            try std.testing.expect(object.kind == .array and object.@"type" == null and object.weak);
            try std.testing.expectEqual(@as(usize, 0), object.creations.len);
            try std.testing.expect(object.origin == .entry);
            try std.testing.expectEqual(context_index, @as(usize, @intFromEnum(object.origin.entry.context)));
            try std.testing.expectEqual(function.blocks[0].parameters[ordinal], object.origin.entry.parameter);
            const wildcard = invocation.entry.view().get(.{ .element = .{ .object = object_id, .index = null } }) orelse return error.TestExpectedUnknownContents;
            try std.testing.expect(wildcard.unknown and wildcard.callable_unknown);
            try std.testing.expectEqual(@as(usize, 0), wildcard.tags.len);
            try std.testing.expectEqual(@as(usize, 0), wildcard.region.roots.len);
            try std.testing.expect(wildcard.region.unresolved);
            if (invocation.entry.view().get(.{ .length = object_id })) |length| try std.testing.expect(length.number == null);
            projected += 1;
        }
    }
    try std.testing.expect(projected > 0 and unknown_constructor_inputs > 0);
    try std.testing.expect(actual.owner == &c and actual.final_replay_complete);
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}

test "actual undefined survives fact storage transport without a view conversion" {
    var remaining: usize = model.format.max_work;
    var owned = try decoder.readOwned(std.testing.allocator, @embedFile("test-data/common18-decoder/positive.tbc"), &remaining);
    defer owned.deinit();
    const common = owned.program.tables.mode.common;
    const undefined_type: model.types.TypeRef = for (common.types, 0..) |row, i| {
        if (row.kind == .@"undefined") break @enumFromInt(i);
    } else return error.TestExpectedUndefined;
    try std.testing.expect(common.types[@intFromEnum(common.storage.bindings[@intFromEnum(common.views.entries[0].parameter)].@"type")].kind == .array);
    var c = facts.Context{ .program = &owned.program, .allocator = std.testing.allocator, .remaining = remaining };
    const input = facts.Value{ .tags = &.{undefined_type} };
    var alias = try facts.OwnedValue.clone(&c, input);
    defer alias.deinit(std.testing.allocator);
    var storage: facts.Heap = .{};
    defer storage.deinit(std.testing.allocator);
    const slot: facts.Slot = .{ .cell = @enumFromInt(0) };
    _ = try storage.put(&c, slot, alias.view(), true);
    var returned = try facts.OwnedValue.clone(&c, storage.view().get(slot).?);
    defer returned.deinit(std.testing.allocator);
    try std.testing.expectEqualSlices(model.types.TypeRef, &.{undefined_type}, returned.tags.items);
    try std.testing.expectEqual(@as(usize, 0), returned.objects.items.len);
    try std.testing.expect(returned.number == null);
    // Predicate-only malformed ABI view: an undefined raw input cannot borrow
    // the declared Array category. This is not a valid Source packet claim.
    const entry = common.views.entries[0];
    const function = owned.program.functions[@intFromEnum(entry.function)];
    const abi_index = @intFromEnum(function.abi);
    const ordinal = std.mem.indexOfScalar(model.types.BindingRef, common.abis[abi_index].parameters, entry.parameter) orelse return error.TestExpectedParameter;
    const Abi = @TypeOf(common.abis[0]);
    const abis = try std.testing.allocator.dupe(Abi, common.abis);
    defer std.testing.allocator.free(abis);
    const raw_types = try std.testing.allocator.dupe(model.types.TypeRef, common.abis[abi_index].argument_types);
    defer std.testing.allocator.free(raw_types);
    raw_types[ordinal] = undefined_type;
    abis[abi_index].argument_types = raw_types;
    var changed = owned.program;
    changed.tables.mode.common.abis = abis;
    c.program = &changed;
    var roles = try reference.projectEntries(&c);
    defer roles.deinit();
    try std.testing.expect(roles.parameters[@intFromEnum(entry.parameter)] == null);
    // This is a pure transport seam, not a Source as/return or numeric-trap oracle.
    try std.testing.expect(c.remaining > 0 and c.remaining < remaining);
}
