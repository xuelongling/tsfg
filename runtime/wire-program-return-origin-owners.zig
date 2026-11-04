// SPDX-License-Identifier: MIT
// Fixed Graph5 lexical-owner/content equations. This is not an Actual/SSA
// solver: locations are finite symbolic relationships, never Object/Env IDs,
// selected targets, allocation generations, holding or permission evidence.
const std = @import("std");
const m = @import("wire-program-return-origin-model.zig");
const construction = @import("wire-program-return-origin-construction.zig");
const R = m.Ref;
const S = m.Symbol;
const E = m.Error;
const B = m.Budget;
const Set = std.ArrayListUnmanaged(R);
pub const Root = union(enum) { nonowning: void, local: void, parameter: usize, global: S, capture: S, input: usize };
pub const Flags = struct { read: bool = false, write: bool = false, structural: bool = false };
pub const Capture = struct { key: S, flags: Flags };
pub const Fixed = struct { function_id: S, graph: ?*const m.Graph, parameters: []const Flags, captures: []const Capture, may_throw: bool };
// Full physical directory projected from the already checked CommonStorage and
// CommonViews. null fields means unavailable, including removed private types.
pub const Field = struct { id: S, view: S, physical: usize, type_id: S };
pub const Physical = struct { type_id: S, fields: ?[]const Field };
pub const Pending = enum { graph_protocol, unknown_origin, missing_fixed, receiver_protocol, environment_protocol, capture_uninitialized, payload_uninitialized, payload_layout, copy_layout, incomplete_completion, unresolved_value };
pub const Kind = enum { root, payload, projection, copied, environment_input, environment_local, environment_component, code };
pub const Location = struct {
    kind: Kind, owner: Root, type_id: ?S = null,
    // scope/node/source are names in these equations, never runtime identities.
    scope: usize = 0, node: usize = 0, source: ?R = null,
    layout: ?S = null, function_id: ?S = null, key: ?S = null,
    environment: ?R = null,
    view: ?S = null,
    // Index in the caller's typed symbolic input graph, not an Actual ID.
    input: ?R = null,
};
pub const Address = struct { base: R, selector: S, view: S, values: Set = .empty };
const Heap = std.ArrayListUnmanaged(Address);
pub const Effect = struct { root: Root, flag: m.AccessFlag };
pub const Environment = struct { location: R, parents: []const R };
pub const ContentSlot = struct { selector: S, view: S, physical: ?usize, values: []const R };
pub const Payload = struct { location: R, type_id: S, slots: []ContentSlot };
pub const InitialAddress = struct { base: R, selector: S, view: S, values: []const R };
// Payload locations are canonical saved allocation/copy relationships. Aliases
// use the same index; distinct payload indices require distinct source graph
// births/copies. Unknown/formal alternatives remain root/projection locations.
pub const Initial = struct {
    locations: []const Location, arguments: []const []const R,
    environment: []const R, heap: []const InitialAddress, parents: []const Environment,
};
pub const Analysis = struct {
    arena: std.heap.ArenaAllocator, pending: ?Pending = null,
    normal: []const R = &.{}, language: []const R = &.{},
    normal_live: bool = false, language_live: bool = false,
    locations: []const Location = &.{}, environments: []const Environment = &.{},
    normal_heap: []const Address = &.{}, language_heap: []const Address = &.{},
    effects: []const Effect = &.{},
    normal_payloads: []const Payload = &.{}, language_payloads: []const Payload = &.{},
    pub fn deinit(self: *Analysis) void { self.arena.deinit(); }
};
const Source = struct { frame: usize, heap: R };
const CopySource = struct { target: R, source: R, frame: usize, action: R, heap: R };
const ReceiverImport = struct { caller: usize, fact: *const construction.CallFact };
const Frame = struct {
    graph: *const m.Graph, function_id: S, scope_graph: *const m.Graph, scope_call: usize,
    arguments: []Set, environment: Set, input: Heap,
    values: []Set, heaps: []Heap, controls: []bool, ready: []bool, heap_ready: []bool,
    targets: []Set, sources: std.ArrayListUnmanaged(Source) = .empty,
    output: [2]Set = .{ .empty, .empty }, output_heap: [2]Heap = .{ .empty, .empty },
    live: [2]bool = .{ false, false }, completed: [2]bool = .{ false, false },
    receiver: ?*const construction.Analysis = null,
    receiver_import: ?ReceiverImport = null,
    output_payloads: [2]std.ArrayListUnmanaged(Payload) = .{ .empty, .empty },
};
const Engine = struct {
    a: std.mem.Allocator, directory: *const m.Directory, physical: []const Physical, fixed: []const Fixed, budget: *B,
    frames: std.ArrayListUnmanaged(*Frame) = .empty,
    locations: std.ArrayListUnmanaged(Location) = .empty,
    parents: std.ArrayListUnmanaged(Set) = .empty,
    effects: std.ArrayListUnmanaged(Effect) = .empty,
    changed: bool = false, pending: ?Pending = null,
    receiver: ?*const construction.Analysis = null,
    initial_heap: []const Address = &.{},
    copies: std.ArrayListUnmanaged(CopySource) = .empty,
    fn append(self: *Engine, comptime T: type, list: *std.ArrayListUnmanaged(T), value: T) E!void {
        try self.budget.step(); if (list.items.len == list.capacity) try self.budget.spend(list.items.len + 1);
        try list.append(self.a, value);
    }
    fn allocate(self: *Engine, comptime T: type, count: usize) E![]T {
        try self.budget.spend(count + 1); return self.a.alloc(T, count);
    }
    fn add(self: *Engine, set: *Set, value: R) E!void {
        var at: usize = 0;
        while (at < set.items.len) : (at += 1) { try self.budget.step(); if (set.items[at] == value) return; if (set.items[at] > value) break; }
        try self.budget.spend(set.items.len - at + 1); if (set.items.len == set.capacity) try self.budget.spend(set.items.len + 1);
        try set.insert(self.a, at, value); self.changed = true;
    }
    fn merge(self: *Engine, into: *Set, source: []const R) E!void { try self.budget.spend(source.len); for (source) |id| try self.add(into, id); }
    fn sameSet(self: *Engine, a: []const R, b: []const R) E!bool { try self.budget.spend(a.len + b.len + 1); return std.mem.eql(R, a, b); }
    fn sameOptional(self: *Engine, a: ?S, b: ?S) E!bool { if (a) |id| return b != null and try self.budget.equal(id, b.?); return b == null; }
    fn sameRoot(self: *Engine, a: Root, b: Root) E!bool {
        try self.budget.step(); if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
        return switch (a) { .parameter => |id| id == b.parameter, .input => |id| id == b.input, .global => |id| self.budget.equal(id, b.global), .capture => |id| self.budget.equal(id, b.capture), else => true };
    }
    fn location(self: *Engine, row: Location) E!R {
        for (self.locations.items, 0..) |old, id| {
            try self.budget.step(); if (old.kind != row.kind or old.scope != row.scope or old.node != row.node or old.source != row.source or old.environment != row.environment or old.input != row.input) continue;
            if (try self.sameRoot(old.owner, row.owner) and try self.sameOptional(old.type_id, row.type_id) and try self.sameOptional(old.layout, row.layout) and try self.sameOptional(old.function_id, row.function_id) and try self.sameOptional(old.key, row.key) and try self.sameOptional(old.view, row.view)) return id;
        }
        const id = self.locations.items.len; try self.append(Location, &self.locations, row); try self.append(Set, &self.parents, .empty); self.changed = true; return id;
    }
    fn environmentRow(self: *Engine, id: S) E!*const m.EnvironmentRow {
        try self.budget.lookup(self.directory.environments.len, id.len);
        var lo: usize = 0; var hi = self.directory.environments.len;
        while (lo < hi) { const mid = lo + (hi - lo) / 2; switch (std.mem.order(u8, self.directory.environments[mid].id, id)) { .lt => lo = mid + 1, .gt => hi = mid, .eq => return &self.directory.environments[mid] } }
        return error.InvalidReference;
    }
    fn typeRow(self: *Engine, id: S) E!*const m.TypeRow {
        try self.budget.lookup(self.directory.types.len, id.len);
        var lo: usize = 0; var hi = self.directory.types.len;
        while (lo < hi) { const mid = lo + (hi - lo) / 2; switch (std.mem.order(u8, self.directory.types[mid].id, id)) { .lt => lo = mid + 1, .gt => hi = mid, .eq => return &self.directory.types[mid] } }
        return error.InvalidReference;
    }
    fn contract(self: *Engine, id: S) E!?*const Fixed {
        for (self.fixed) |*row| { try self.budget.step(); if (try self.budget.equal(row.function_id, id)) return row; }
        return null;
    }
    fn resolved(self: *Engine, frame: *const Frame, refs: []const R) E!Set {
        var set: Set = .empty; try self.budget.spend(refs.len); for (refs) |id| try self.merge(&set, frame.values[id].items); return set;
    }
    fn readyRefs(self: *Engine, frame: *const Frame, refs: []const R) E!bool {
        try self.budget.spend(refs.len);
        for (refs) |id| {
            try self.budget.step();
            // Output/argument vectors are unions of differently controlled
            // alternatives. An explicitly inactive completion contributes no
            // value; it must not make another live alternative unresolved.
            // Uncomputed joins, unknown values and cycles remain possible.
            const active = switch (frame.graph.nodes[id]) {
                inline .gate, .copy, .projection, .capture, .environment_create, .environment_parent, .environment_component, .code => |row| frame.controls[row.control],
                .call => |row| active: {
                    for (frame.targets[row.call].items) |target| { try self.budget.step(); if (self.frames.items[target].live[@intFromEnum(row.completion)]) break :active true; }
                    break :active false;
                },
                .receiver_value => |row| if (frame.receiver) |receiver| receiver.heap_live[row.action] else true,
                else => true,
            };
            if (active and !frame.ready[id]) return false;
        }
        return true;
    }
    fn ready(self: *Engine, value: *bool, defined: bool) void { if (defined and !value.*) { value.* = true; self.changed = true; } }
    fn envKind(kind: Kind) bool { return kind == .environment_input or kind == .environment_local or kind == .environment_component; }
    fn entryEnvironment(self: *Engine, layout: S) E!R {
        const row = try self.environmentRow(layout);
        const id = try self.location(.{ .kind = .environment_input, .owner = .nonowning, .layout = row.id });
        if (row.parent) |parent| { const target = try self.entryEnvironment(parent); try self.add(&self.parents.items[id], target); }
        return id;
    }
    fn component(self: *Engine, source: R, function_id: S, layout: S) E!R {
        const row = try self.environmentRow(layout);
        const id = try self.location(.{ .kind = .environment_component, .owner = self.locations.items[source].owner, .layout = row.id, .source = source, .function_id = function_id });
        if (row.parent) |parent| { const target = try self.component(source, function_id, parent); try self.add(&self.parents.items[id], target); }
        return id;
    }
    fn selectEnvironments(self: *Engine, bases: []const R, layout: S) E!Set {
        var work: Set = .empty; try self.merge(&work, bases); var seen: Set = .empty; var selected: Set = .empty; var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try self.budget.step(); const id = work.items[cursor];
            var found = false; for (seen.items) |old| { try self.budget.step(); if (old == id) { found = true; break; } } if (found) continue;
            try self.add(&seen, id); const row = self.locations.items[id];
            if (!envKind(row.kind)) { self.pending = .environment_protocol; continue; }
            if (try self.budget.equal(row.layout.?, layout)) { try self.add(&selected, id); continue; }
            const current = try self.environmentRow(row.layout.?);
            if (current.parent == null) { self.pending = .environment_protocol; continue; }
            // Work is a sorted set: adding lower IDs could move the cursor.
            // Traverse all discovered parents through a separate append list.
            for (self.parents.items[id].items) |parent| { try self.budget.step(); try self.append(R, &work, parent); }
        }
        return selected;
    }
    fn put(self: *Engine, heap: *Heap, base: R, selector: S, view: S, values: []const R) E!void {
        if (values.len == 0) return;
        for (heap.items) |*row| {
            try self.budget.step(); if (row.base == base and try self.budget.equal(row.selector, selector) and try self.budget.equal(row.view, view)) { try self.merge(&row.values, values); return; }
        }
        var row = Address{ .base = base, .selector = selector, .view = view }; try self.merge(&row.values, values); try self.append(Address, heap, row); self.changed = true;
    }
    fn mergeHeap(self: *Engine, into: *Heap, source: []const Address) E!void { try self.budget.spend(source.len); for (source) |row| try self.put(into, row.base, row.selector, row.view, row.values.items); }
    fn sameHeap(self: *Engine, left: []const Address, right: []const Address) E!bool {
        try self.budget.spend(left.len + right.len + 1); if (left.len != right.len) return false;
        for (left) |a| {
            var found = false; for (right) |b| { try self.budget.step(); if (a.base == b.base and try self.budget.equal(a.selector, b.selector) and try self.budget.equal(a.view, b.view) and try self.sameSet(a.values.items, b.values.items)) { found = true; break; } }
            if (!found) return false;
        }
        return true;
    }
    fn mayAlias(self: *Engine, a: R, b: R) E!bool {
        try self.budget.step(); if (a == b) return true; const x = self.locations.items[a]; const y = self.locations.items[b];
        if (envKind(x.kind) or envKind(y.kind)) return envKind(x.kind) and envKind(y.kind) and try self.budget.equal(x.layout.?, y.layout.?) and (x.kind != .environment_local or y.kind != .environment_local);
        if (x.owner == .nonowning or y.owner == .nonowning or x.kind == .copied or y.kind == .copied) return false;
        if (x.kind == .payload and y.kind == .payload) return false;
        // Local births are distinct from each other. A formal/global value can
        // still alias a local's published contents, never the local birth itself.
        if (x.owner == .local or y.owner == .local) return false;
        return true;
    }
    fn sameSlot(self: *Engine, base: R, a: S, av: S, b: S, bv: S, must: bool) E!bool {
        if (try self.budget.equal(a, b)) return true;
        if (try self.budget.equal(a, "element") or try self.budget.equal(b, "element")) return false;
        if (!std.mem.startsWith(u8, a, "field:") or !std.mem.startsWith(u8, b, "field:")) return false;
        if (self.locations.items[base].type_id) |actual| {
            for (self.physical) |physical| {
                try self.budget.step(); if (!try self.budget.equal(actual, physical.type_id)) continue;
                if (physical.fields) |fields| {
                    var left: ?usize = null; var right: ?usize = null;
                    for (fields) |field| {
                        try self.budget.step();
                        if (try self.budget.equal(field.id, a[6..]) and try self.budget.equal(field.view, av)) left = field.physical;
                        if (try self.budget.equal(field.id, b[6..]) and try self.budget.equal(field.view, bv)) right = field.physical;
                    }
                    if (left != null and right != null) return left.? == right.?;
                }
                break;
            }
        }
        // Unknown physical correspondence is a May alias, never a MUST
        // initialization or copied-layout witness.
        return !must and !try self.budget.equal(av, bv);
    }
    fn read(self: *Engine, heap: []const Address, base: R, selector: S, view: S, scope: usize, node: usize, type_id: ?S) E!Set {
        try self.budget.step();
        var result: Set = .empty; const row = self.locations.items[base];
        if (row.owner != .local and row.owner != .nonowning) try self.add(&result, try self.location(.{ .kind = .projection, .owner = row.owner, .type_id = type_id, .source = base, .scope = scope, .node = node, .key = selector, .view = view }));
        for (heap) |stored| {
            try self.budget.step(); if (!try self.mayAlias(base, stored.base)) continue;
            if (try self.sameSlot(base, selector, view, stored.selector, stored.view, false)) try self.merge(&result, stored.values.items);
        }
        return result;
    }
    fn captureValues(self: *Engine, heap: []const Address, bases: []const R, layout: S, key: S) E!Set {
        const row = try self.environmentRow(layout); var type_id: ?S = null;
        for (row.slots) |slot| { try self.budget.step(); if (try self.budget.equal(slot.key, key)) { type_id = slot.@"type"; break; } }
        if (type_id == null) return error.InvalidReference;
        const environments = try self.selectEnvironments(bases, layout); var result: Set = .empty;
        for (environments.items) |base| {
            try self.budget.step();
            const node = self.locations.items[base];
            if (node.kind == .environment_input or node.kind == .environment_component) try self.add(&result, try self.location(.{ .kind = .projection, .owner = if (node.kind == .environment_input) .{ .capture = key } else node.owner, .type_id = type_id, .source = base, .key = key }));
            for (heap) |stored| {
                try self.budget.step(); if (!std.mem.startsWith(u8, stored.selector, "capture:") or !std.mem.startsWith(u8, stored.view, "env:")) continue;
                if (try self.budget.equal(stored.selector[8..], key) and try self.budget.equal(stored.view[4..], layout) and try self.mayAlias(base, stored.base)) try self.merge(&result, stored.values.items);
            }
        }
        return result;
    }
    fn effect(self: *Engine, root: Root, flag: m.AccessFlag) E!void {
        if (root == .nonowning or root == .local) return;
        for (self.effects.items) |old| { try self.budget.step(); if (old.flag == flag and try self.sameRoot(old.root, root)) return; }
        try self.append(Effect, &self.effects, .{ .root = root, .flag = flag });
    }
    fn valueEffects(self: *Engine, values: []const R, flags: Flags) E!void {
        for (values) |id| { try self.budget.step(); const owner = self.locations.items[id].owner;
            if (flags.read) try self.effect(owner, .read); if (flags.write) try self.effect(owner, .write); if (flags.structural) try self.effect(owner, .structural);
        }
    }
    fn contentEffects(self: *Engine, heap: []const Address, values: []const R, flags: Flags) E!void {
        try self.budget.step(); if (!flags.read and !flags.write and !flags.structural) return;
        var work: Set = .empty; var seen: Set = .empty; for (values) |value| try self.append(R, &work, value); var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try self.budget.step(); const value = work.items[cursor]; var visited = false;
            for (seen.items) |old| { try self.budget.step(); if (old == value) { visited = true; break; } }
            if (visited) continue; try self.add(&seen, value);
            const node = self.locations.items[value]; try self.valueEffects(&.{value}, flags);
            if (node.kind == .code) { if (node.environment) |environment| try self.append(R, &work, environment); continue; }
            if (envKind(node.kind)) {
                for (self.parents.items[value].items) |parent| { try self.budget.step(); try self.append(R, &work, parent); }
                const environment = try self.environmentRow(node.layout.?);
                for (environment.slots) |slot| {
                    try self.budget.step(); const selected = try self.captureValues(heap, &.{value}, environment.id, slot.key); for (selected.items) |child| try self.append(R, &work, child);
                }
                continue;
            }
            if (node.kind != .payload and node.kind != .copied and (node.kind != .root or node.owner != .local)) continue;
            // Every known prefix value contributes. This is a May effect
            // closure; returned MUST contents are checked independently.
            for (heap) |address| {
                try self.budget.step(); if (std.mem.startsWith(u8, address.selector, "capture:")) continue;
                if (try self.mayAlias(value, address.base)) for (address.values.items) |child| try self.append(R, &work, child);
            }
        }
    }
    fn ensure(self: *Engine, graph: *const m.Graph, function_id: S, scope_graph: *const m.Graph, scope_call: usize, arguments: []Set, environment: Set, input: []const Address, source: ?Source, receiver: ?*const construction.Analysis, receiver_import: ?ReceiverImport) E!usize {
        for (self.frames.items, 0..) |frame, index| {
            try self.budget.step(); if (frame.graph != graph or frame.scope_graph != scope_graph or frame.scope_call != scope_call or frame.receiver != receiver or !std.meta.eql(frame.receiver_import, receiver_import) or frame.arguments.len != arguments.len or !try self.sameSet(frame.environment.items, environment.items)) continue;
            var same = true; for (frame.arguments, arguments) |a, b| { try self.budget.step(); if (!try self.sameSet(a.items, b.items)) { same = false; break; } }
            if (!same or !try self.sameHeap(frame.input.items, input)) continue;
            if (source) |entry| { var found = false; for (frame.sources.items) |old| { try self.budget.step(); if (std.meta.eql(old, entry)) { found = true; break; } } if (!found) try self.append(Source, &frame.sources, entry); }
            return index;
        }
        try self.budget.step(); const frame = try self.a.create(Frame);
        const args = try self.allocate(Set, arguments.len); @memset(args, .empty); for (args, arguments) |*into, from| try self.merge(into, from.items);
        var env: Set = .empty; try self.merge(&env, environment.items); var heap: Heap = .empty; try self.mergeHeap(&heap, input);
        const values = try self.allocate(Set, graph.nodes.len); @memset(values, .empty);
        const heaps = try self.allocate(Heap, graph.heaps.len); @memset(heaps, .empty);
        const controls = try self.allocate(bool, graph.controls.len); @memset(controls, false);
        const ready_nodes = try self.allocate(bool, graph.nodes.len); @memset(ready_nodes, false);
        const ready_heaps = try self.allocate(bool, graph.heaps.len); @memset(ready_heaps, false);
        const targets = try self.allocate(Set, graph.calls.len); @memset(targets, .empty);
        frame.* = .{ .graph = graph, .function_id = function_id, .scope_graph = scope_graph, .scope_call = scope_call, .arguments = args, .environment = env, .input = heap, .values = values, .heaps = heaps, .controls = controls, .ready = ready_nodes, .heap_ready = ready_heaps, .targets = targets, .receiver = receiver, .receiver_import = receiver_import };
        if (source) |entry| try self.append(Source, &frame.sources, entry);
        const id = self.frames.items.len; try self.append(*Frame, &self.frames, frame); self.changed = true; return id;
    }
    fn size(self: *Engine) E!usize {
        var count = self.locations.items.len + self.frames.items.len + self.copies.items.len;
        for (self.parents.items) |set| { try self.budget.step(); count += set.items.len; }
        for (self.frames.items) |frame| {
            try self.budget.step(); count += frame.sources.items.len;
            for (frame.values, frame.ready) |set, defined| { try self.budget.step(); count += set.items.len + @intFromBool(defined); }
            for (frame.heaps, frame.heap_ready) |heap, defined| { try self.budget.step(); count += @intFromBool(defined) + heap.items.len; for (heap.items) |row| { try self.budget.step(); count += row.values.items.len; } }
            for (frame.controls) |live| { try self.budget.step(); count += @intFromBool(live); }
            for (frame.targets) |targets| { try self.budget.step(); count += targets.items.len; }
            inline for (0..2) |completion| { count += frame.output[completion].items.len + frame.output_heap[completion].items.len + @intFromBool(frame.live[completion]) + @intFromBool(frame.completed[completion]); for (frame.output_heap[completion].items) |row| { try self.budget.step(); count += row.values.items.len; } }
        }
        return count;
    }
    fn receiverFacts(self: *Engine, graph: *const m.Graph, facts: *const construction.Analysis) E!bool {
        try self.budget.step();
        return facts.pending == null and facts.controls.len == graph.controls.len and facts.heap_live.len == graph.heaps.len and facts.action_results.len == graph.heaps.len and facts.frames.len == graph.nodes.len;
    }
    fn receiverRefs(self: *Engine, frame: *const Frame, refs: []const R, receiver: R) E!bool {
        // Resolve only original frame-carrier aliases. This binds a borrowed
        // CallFact to this call; receiver state remains construction's job.
        var work: Set = .empty; for (refs) |ref| try self.append(R, &work, ref);
        var seen: Set = .empty; var cursor: usize = 0; var found = false;
        while (cursor < work.items.len) : (cursor += 1) {
            const id = work.items[cursor]; if (id >= frame.graph.nodes.len) return false;
            var visited = false; for (seen.items) |old| { try self.budget.step(); if (old == id) { visited = true; break; } } if (visited) continue;
            try self.add(&seen, id);
            switch (frame.graph.nodes[id]) {
                .receiver_frame => { if (id != receiver) return false; found = true; },
                .join => |row| for (row.inputs) |input| try self.append(R, &work, input),
                .gate => |row| if (frame.controls[row.control]) { for (row.inputs) |input| try self.append(R, &work, input); },
                else => return false,
            }
        }
        return found;
    }
    fn receiverLocation(self: *Engine, index: usize, source: R, allocation: bool) E!?R {
        const frame = self.frames.items[index];
        const receiver = frame.receiver orelse { self.pending = .receiver_protocol; return null; };
        if (frame.receiver_import) |entry| {
            if (allocation) {
                if (source != entry.fact.input) { self.pending = .receiver_protocol; return null; }
                return self.receiverLocation(entry.caller, entry.fact.receiver, true);
            }
            // Match construction's import of a generated callee error to the
            // original caller language completion, never a callee HeapRef.
            const caller = self.frames.items[entry.caller];
            for (caller.graph.heaps, 0..) |heap, ordinal| {
                try self.budget.step();
                if (heap == .call and heap.call.call == entry.fact.call and heap.call.completion == .language) return self.receiverLocation(entry.caller, ordinal, false);
            }
            self.pending = .receiver_protocol; return null;
        }
        if (allocation) {
            if (source >= receiver.frames.len) { self.pending = .receiver_protocol; return null; }
            return try self.location(.{ .kind = .root, .owner = .local, .type_id = receiver.frames[source].new_target, .scope = index, .node = source, .key = "receiver-allocation" });
        }
        if (source >= frame.graph.heaps.len) { self.pending = .receiver_protocol; return null; }
        return try self.location(.{ .kind = .root, .owner = .local, .scope = index, .node = source, .key = "receiver-language-error" });
    }
    fn processCalls(self: *Engine, index: usize, frame: *Frame) E!void {
        for (frame.graph.calls, 0..) |call, ordinal| {
            try self.budget.step(); if (!frame.controls[call.control] or !frame.heap_ready[call.heap]) continue;
            var ready_arguments = true;
            for (call.arguments) |argument| { try self.budget.step(); if (!try self.readyRefs(frame, argument)) ready_arguments = false; }
            if (!ready_arguments) continue;
            if (call.environment) |environment| if (!try self.readyRefs(frame, environment)) continue;
            if (call.callee) |callee| if (!try self.readyRefs(frame, callee)) continue;
            const fixed = try self.contract(call.function_id) orelse { self.pending = .missing_fixed; return; };
            const graph = fixed.graph orelse { self.pending = .missing_fixed; return; };
            const protocol = try m.findFunction(self.directory, call.function_id, self.budget);
            if (!protocol.environment_metadata_complete) { self.pending = .environment_protocol; return; }
            if (protocol.construction != null or call.receiver != null) {
                const receiver = frame.receiver orelse { self.pending = .receiver_protocol; return; };
                const role = protocol.construction orelse { self.pending = .receiver_protocol; return; };
                const refs = call.receiver orelse { self.pending = .receiver_protocol; return; };
                // The borrowed construction analysis has already interpreted
                // this supported proved-Data/no-ENV, standalone fixed leaf. Keep
                // its original graph and facts in this same ordinary Engine.
                if (frame.receiver_import != null or call.environment != null or call.callee != null or protocol.parameter_types.len != call.arguments.len + 1 or protocol.lexical_environment != null or protocol.activation_environment != null or role.base != null or role.receiver_index != 0) { self.pending = .receiver_protocol; return; }
                var selected: ?*const construction.CallFact = null;
                for (receiver.calls) |*fact| {
                    try self.budget.step(); if (fact.call != ordinal) continue;
                    if (selected != null) { self.pending = .receiver_protocol; return; } selected = fact;
                }
                const fact = selected orelse { self.pending = .receiver_protocol; return; };
                if (fact.caller_graph != frame.graph or fact.fixed.contract.return_origins == null or fact.graph != &fact.fixed.contract.return_origins.? or fact.graph != graph or !try self.budget.equal(fact.fixed.function_id, call.function_id) or fact.receiver >= frame.graph.nodes.len or fact.input >= graph.nodes.len or graph.nodes[fact.input] != .receiver_input or graph.calls.len != 0 or fact.analysis.calls.len != 0 or !try self.receiverFacts(graph, fact.analysis) or !try self.receiverRefs(frame, refs, fact.receiver)) { self.pending = .receiver_protocol; return; }
                const upper = fact.fixed.contract.upper;
                if (fixed.parameters.len != protocol.parameter_types.len or fixed.captures.len != 0 or upper.parameters.len != fixed.parameters.len or upper.captures.len != 0 or fixed.may_throw != upper.facets.may_throw) { self.pending = .receiver_protocol; return; }
                for (fixed.parameters, upper.parameters, 0..) |flags, parameter, parameter_index| {
                    try self.budget.step(); if (parameter.index != parameter_index or flags.read != parameter.read or flags.write != parameter.write or flags.structural != parameter.structural) { self.pending = .receiver_protocol; return; }
                }
                const caller_frame = frame.graph.nodes[fact.receiver].receiver_frame;
                if (caller_frame.parent != null or caller_frame.new_target == null or !try self.budget.equal(caller_frame.construction, role.id) or fact.analysis.input_exits == null or fact.analysis.input_exits.?.input != fact.input) { self.pending = .receiver_protocol; return; }
                if (receiver.frames[fact.receiver].construction == null or !try self.budget.equal(receiver.frames[fact.receiver].construction.?, role.id) or !try self.sameOptional(receiver.frames[fact.receiver].new_target, caller_frame.new_target) or receiver.frames[fact.receiver].parent != null or fact.analysis.frames[fact.input].construction == null or !try self.budget.equal(fact.analysis.frames[fact.input].construction.?, role.id) or fact.analysis.frames[fact.input].new_target != null or fact.analysis.frames[fact.input].parent != null) { self.pending = .receiver_protocol; return; }
                const arguments = try self.allocate(Set, protocol.parameter_types.len); @memset(arguments, .empty);
                const receiver_location = try self.receiverLocation(index, fact.receiver, true) orelse return;
                try self.add(&arguments[0], receiver_location);
                for (call.arguments, 1..) |refs_argument, parameter_index| {
                    const expected = protocol.parameter_types[parameter_index];
                    const kind = (try self.typeRow(expected)).kind;
                    if (kind != .scalar and kind != .reference) { self.pending = .receiver_protocol; return; }
                    arguments[parameter_index] = try self.resolved(frame, refs_argument);
                    if (arguments[parameter_index].items.len == 0) { self.pending = .receiver_protocol; return; }
                    for (arguments[parameter_index].items) |location_id| {
                        try self.budget.step(); const value = self.locations.items[location_id];
                        if (value.kind != .root or value.type_id == null or !try self.budget.equal(value.type_id.?, expected)) { self.pending = .receiver_protocol; return; }
                    }
                }
                const target = try self.ensure(graph, call.function_id, frame.graph, ordinal, arguments, .empty, frame.heaps[call.heap].items, .{ .frame = index, .heap = call.heap }, fact.analysis, .{ .caller = index, .fact = fact });
                try self.add(&frame.targets[ordinal], target); continue;
            }
            const arguments = try self.allocate(Set, call.arguments.len);
            for (arguments, call.arguments) |*into, refs| into.* = try self.resolved(frame, refs);
            var selected: std.ArrayListUnmanaged(Set) = .empty;
            var supplied: Set = .empty; if (call.environment) |refs| supplied = try self.resolved(frame, refs);
            if (call.callee) |refs| {
                const codes = try self.resolved(frame, refs);
                for (codes.items) |id| {
                    try self.budget.step(); const code = self.locations.items[id];
                    if (code.kind == .code) {
                        if (!try self.budget.equal(code.function_id.?, call.function_id)) continue;
                        if (protocol.lexical_environment == null) { if (code.environment != null or call.environment != null) { self.pending = .environment_protocol; return; } try self.append(Set, &selected, .empty); }
                        else {
                            for (supplied.items) |env| {
                                try self.budget.step(); if (code.environment == env) { var one: Set = .empty; try self.add(&one, env); try self.append(Set, &selected, one); }
                            }
                        }
                    } else if (code.owner != .nonowning and code.owner != .local) {
                        if (protocol.lexical_environment == null) { if (call.environment != null) { self.pending = .environment_protocol; return; } try self.append(Set, &selected, .empty); }
                        else {
                            for (supplied.items) |env| {
                                try self.budget.step(); const component_row = self.locations.items[env];
                                if (component_row.kind == .environment_component and component_row.source == id and try self.budget.equal(component_row.function_id.?, call.function_id) and try self.budget.equal(component_row.layout.?, protocol.lexical_environment.?)) {
                                    var one: Set = .empty; try self.add(&one, env); try self.append(Set, &selected, one);
                                }
                            }
                        }
                    } else { self.pending = .environment_protocol; return; }
                }
            } else if (protocol.lexical_environment) |layout| {
                const environments = try self.selectEnvironments(supplied.items, layout); if (environments.items.len != 0) try self.append(Set, &selected, environments);
            } else try self.append(Set, &selected, .empty);
            for (selected.items) |environment| {
                const target = try self.ensure(graph, call.function_id, frame.graph, ordinal, arguments, environment, frame.heaps[call.heap].items, .{ .frame = index, .heap = call.heap }, null, null);
                try self.add(&frame.targets[ordinal], target);
            }
        }
    }
    fn copied(self: *Engine, frame: *const Frame, value: R, site: S, scope: usize) E!R {
        const original = self.locations.items[value];
        if (original.type_id == null and original.owner == .local) { self.pending = .copy_layout; return value; }
        if (original.type_id == null or (original.kind != .payload and original.kind != .copied and (original.kind != .root or original.owner != .local))) return value;
        if ((try self.typeRow(original.type_id.?)).kind != .value) return value;
        // One symbolic copy site/type can conservatively contain multiple
        // same-type source alternatives; it never denotes an actual instance.
        _ = frame;
        return self.location(.{ .kind = .copied, .owner = original.owner, .type_id = original.type_id, .scope = scope, .key = site });
    }
    fn evalValue(self: *Engine, index: usize, frame: *Frame, ordinal: usize, node: m.Value) E!void {
        const out = &frame.values[ordinal]; var defined = false;
        switch (node) {
            .unknown => { self.pending = .unknown_origin; return; },
            .receiver_input, .receiver_frame => {
                // Receiver frames are control carriers, never Data owners.
                if (frame.receiver == null) { self.pending = .receiver_protocol; return; }
                defined = true;
            },
            .receiver_value => |row| {
                const receiver = frame.receiver orelse { self.pending = .receiver_protocol; return; };
                if (!receiver.heap_live[row.action]) return;
                defined = true;
                for (receiver.action_results[row.action]) |atom| {
                    try self.budget.step();
                    switch (atom.source) {
                        .node => |source| {
                            if (source >= frame.values.len) { self.pending = .receiver_protocol; return; }
                            try self.merge(out, frame.values[source].items);
                            defined = defined and frame.ready[source];
                        },
                        .allocation => |source| {
                            // A formal newTarget is universally quantified.
                            // Its construction owner is not an Actual type.
                            const receiver_location = try self.receiverLocation(index, source, true) orelse return;
                            try self.add(out, receiver_location);
                        },
                        .language_error => |source| {
                            const receiver_location = try self.receiverLocation(index, source, false) orelse return;
                            try self.add(out, receiver_location);
                        },
                    }
                }
            },
            .parameter => |row| { try self.merge(out, frame.arguments[row.index].items); defined = true; },
            .global => |row| { try self.add(out, try self.location(.{ .kind = .root, .owner = .{ .global = row.id }, .type_id = row.@"type" })); defined = true; },
            .literal => |row| { try self.add(out, try self.location(.{ .kind = .root, .owner = .nonowning, .type_id = row.@"type", .node = @intFromEnum(row.category) })); defined = true; },
            .nonowning => |row| { try self.add(out, try self.location(.{ .kind = .root, .owner = .nonowning, .type_id = row.@"type" })); defined = true; },
            .local => |row| { try self.add(out, try self.location(.{ .kind = .root, .owner = .local, .type_id = row.@"type", .scope = index, .node = ordinal })); defined = true; },
            .environment_input => { try self.merge(out, frame.environment.items); defined = frame.environment.items.len != 0; },
            .environment_create => |row| {
                if (!frame.controls[row.control]) return;
                const id = try self.location(.{ .kind = .environment_local, .owner = .local, .layout = row.layout, .scope = index, .node = ordinal, .key = row.site });
                if (row.parent) |refs| { const bases = try self.resolved(frame, refs); const layout = (try self.environmentRow(row.layout)).parent.?; const parents = try self.selectEnvironments(bases.items, layout); try self.merge(&self.parents.items[id], parents.items); }
                try self.add(out, id); defined = row.parent == null or try self.readyRefs(frame, row.parent.?);
            },
            .environment_parent => |row| { if (!frame.controls[row.control]) return; const bases = try self.resolved(frame, row.bases); const parents = try self.selectEnvironments(bases.items, row.layout); try self.merge(out, parents.items); defined = try self.readyRefs(frame, row.bases); },
            .environment_component => |row| {
                if (!frame.controls[row.control] or !try self.readyRefs(frame, row.callee)) return;
                const codes = try self.resolved(frame, row.callee);
                for (codes.items) |source| {
                    try self.budget.step(); const code = self.locations.items[source];
                    if (code.kind == .code) { if (!try self.budget.equal(code.function_id.?, row.function_id)) continue; if (code.environment) |env| try self.add(out, env) else { self.pending = .environment_protocol; return; } }
                    else if (code.owner != .nonowning and code.owner != .local) try self.add(out, try self.component(source, row.function_id, row.layout))
                    else { self.pending = .environment_protocol; return; }
                }
                defined = true;
            },
            .capture => |row| {
                if (!frame.controls[row.control]) return; const bases = try self.resolved(frame, row.environment);
                const selected = try self.captureValues(frame.heaps[row.heap].items, bases.items, row.layout, row.id); try self.merge(out, selected.items);
                defined = frame.heap_ready[row.heap] and try self.readyRefs(frame, row.environment);
            },
            .code => |row| {
                if (!frame.controls[row.control]) return;
                if (row.environment) |refs| {
                    const bases = try self.resolved(frame, refs); const function = try m.findFunction(self.directory, row.function_id, self.budget);
                    const environments = try self.selectEnvironments(bases.items, function.lexical_environment.?);
                    for (environments.items) |env| { try self.budget.step(); try self.add(out, try self.location(.{ .kind = .code, .owner = self.locations.items[env].owner, .type_id = row.@"type", .function_id = row.function_id, .environment = env })); }
                    defined = try self.readyRefs(frame, refs);
                } else { try self.add(out, try self.location(.{ .kind = .code, .owner = .nonowning, .type_id = row.@"type", .function_id = row.function_id })); defined = true; }
            },
            .join => |row| { const values = try self.resolved(frame, row.inputs); try self.merge(out, values.items); defined = row.inputs.len == 0; for (row.inputs) |input| { try self.budget.step(); defined = defined or frame.ready[input]; } },
            .gate => |row| { if (!frame.controls[row.control]) return; const values = try self.resolved(frame, row.inputs); try self.merge(out, values.items); defined = try self.readyRefs(frame, row.inputs); },
            .projection => |row| {
                if (!frame.controls[row.control]) return; const bases = try self.resolved(frame, row.bases);
                for (bases.items) |base| { const values = try self.read(frame.heaps[row.heap].items, base, row.selector, row.view, index, ordinal, row.@"type"); try self.merge(out, values.items); }
                defined = frame.heap_ready[row.heap] and try self.readyRefs(frame, row.bases);
            },
            .copy => |row| {
                if (!frame.controls[row.control]) return; const bases = try self.resolved(frame, row.bases);
                for (bases.items) |base| try self.add(out, try self.copied(frame, base, row.site, index));
                defined = frame.heap_ready[row.heap] and try self.readyRefs(frame, row.bases);
            },
            .call => |row| {
                const completion = @intFromEnum(row.completion);
                for (frame.targets[row.call].items) |target| {
                    try self.budget.step(); const called = self.frames.items[target]; if (!called.live[completion]) continue;
                    try self.merge(out, called.output[completion].items); defined = defined or called.completed[completion];
                    if (row.completion == .normal and called.graph.normal.len == 0 and row.@"type" != null and (try self.typeRow(row.@"type".?)).kind == .@"void") try self.add(out, try self.location(.{ .kind = .root, .owner = .nonowning, .type_id = row.@"type" }));
                }
            },
        }
        self.ready(&frame.ready[ordinal], defined);
    }
    fn evalHeap(self: *Engine, index: usize, frame: *Frame, ordinal: usize, row: m.Heap) E!void {
        const out = &frame.heaps[ordinal]; var defined = false;
        if (frame.receiver) |receiver| if (!receiver.heap_live[ordinal]) return;
        switch (row) {
            .entry => { try self.mergeHeap(out, frame.input.items); defined = true; },
            .join => |join| for (join.inputs) |input| { try self.budget.step(); try self.mergeHeap(out, frame.heaps[input].items); defined = defined or frame.heap_ready[input]; },
            .store => |store| {
                try self.mergeHeap(out, frame.heaps[store.previous].items);
                if (frame.controls[store.control]) {
                    const bases = try self.resolved(frame, store.bases); const values = try self.resolved(frame, store.values);
                    for (bases.items) |base| try self.put(out, base, store.selector, store.view, values.items);
                    defined = frame.heap_ready[store.previous] and try self.readyRefs(frame, store.bases) and try self.readyRefs(frame, store.values);
                }
            },
            .copy => |copy| {
                try self.mergeHeap(out, frame.heaps[copy.previous].items); const operation = frame.graph.nodes[copy.value].copy;
                if (!frame.controls[operation.control]) return;
                const roots = try self.resolved(frame, operation.bases); var work: Set = .empty; try self.merge(&work, roots.items); var seen: Set = .empty; var cursor: usize = 0;
                while (cursor < work.items.len) : (cursor += 1) {
                    try self.budget.step(); const original = work.items[cursor]; var visited = false; for (seen.items) |old| { try self.budget.step(); if (old == original) { visited = true; break; } } if (visited) continue; try self.add(&seen, original);
                    const target = try self.copied(frame, original, operation.site, index); if (target == original) continue;
                    const edge = CopySource{ .target = target, .source = original, .frame = index, .action = ordinal, .heap = operation.heap };
                    var represented = false;
                    for (self.copies.items) |old| { try self.budget.step(); if (std.meta.eql(old, edge)) { represented = true; break; } }
                    if (!represented) try self.append(CopySource, &self.copies, edge);
                    const type_id = self.locations.items[original].type_id.?; var fields: ?[]const Field = null;
                    for (self.physical) |physical| { try self.budget.step(); if (try self.budget.equal(type_id, physical.type_id)) { fields = physical.fields; break; } }
                    const complete = fields orelse { self.pending = .copy_layout; return; };
                    for (complete) |field| {
                        try self.budget.text(field.id.len); try self.budget.spend(field.id.len + 7); const selector = try std.mem.concat(self.a, u8, &.{ "field:", field.id });
                        const values = try self.read(frame.heaps[operation.heap].items, original, selector, field.view, index, copy.value, field.type_id); var children: Set = .empty;
                        for (values.items) |child| { const copied_child = try self.copied(frame, child, operation.site, index); try self.add(&children, copied_child); if (copied_child != child) try self.append(R, &work, child); }
                        try self.put(out, target, selector, field.view, children.items);
                    }
                }
                defined = frame.heap_ready[copy.previous] and frame.ready[copy.value];
            },
            .call => |call| for (frame.targets[call.call].items) |target| { try self.budget.step(); const called = self.frames.items[target]; const completion = @intFromEnum(call.completion); try self.mergeHeap(out, called.output_heap[completion].items); defined = defined or called.completed[completion]; },
            .receiver_action => |action| {
                if (frame.receiver == null) { self.pending = .receiver_protocol; return; }
                try self.mergeHeap(out, frame.heaps[action.previous].items);
                defined = frame.heap_ready[action.previous] and try self.readyRefs(frame, action.operands);
            },
        }
        self.ready(&frame.heap_ready[ordinal], defined);
    }
    fn run(self: *Engine) E!void {
        while (true) {
            const before = try self.size(); var index: usize = 0;
            while (index < self.frames.items.len) : (index += 1) {
                try self.budget.step(); const frame = self.frames.items[index]; const graph = frame.graph;
                try self.processCalls(index, frame); if (self.pending != null) return;
                for (graph.controls, 0..) |control, ordinal| {
                    try self.budget.step(); var live = false;
                    if (frame.receiver) |receiver| {
                        live = receiver.controls[ordinal];
                    } else {
                        switch (control) {
                            .entry => live = true,
                            .join => |row| for (row.inputs) |input| { try self.budget.step(); live = live or frame.controls[input]; },
                            .call => |row| for (frame.targets[row.call].items) |target| { try self.budget.step(); live = live or self.frames.items[target].live[@intFromEnum(row.completion)]; },
                            .receiver_completion => { self.pending = .receiver_protocol; return; },
                        }
                    }
                    self.ready(&frame.controls[ordinal], live);
                }
                for (graph.nodes, 0..) |node, ordinal| { try self.budget.step(); try self.evalValue(index, frame, ordinal, node); if (self.pending != null) return; }
                for (graph.heaps, 0..) |row, ordinal| { try self.budget.step(); try self.evalHeap(index, frame, ordinal, row); if (self.pending != null) return; }
                inline for (0..2) |completion| {
                    const exits = if (completion == 0) graph.exits.normal else graph.exits.language;
                    for (exits) |exit| { try self.budget.step(); if (!frame.controls[exit.control]) continue; self.ready(&frame.live[completion], true); self.ready(&frame.completed[completion], frame.heap_ready[exit.heap]); try self.mergeHeap(&frame.output_heap[completion], frame.heaps[exit.heap].items); }
                    if (frame.live[completion]) { const values = try self.resolved(frame, if (completion == 0) graph.normal else graph.language); try self.merge(&frame.output[completion], values.items); }
                }
            }
            if (try self.size() == before) return;
        }
    }
    fn possibleHeap(self: *Engine, start: Source) E!bool {
        var work: std.ArrayListUnmanaged(Source) = .empty; var seen: std.ArrayListUnmanaged(Source) = .empty;
        try self.append(Source, &work, start); var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            const current = work.items[cursor]; var visited = false;
            for (seen.items) |old| { try self.budget.step(); if (std.meta.eql(old, current)) { visited = true; break; } } if (visited) continue; try self.append(Source, &seen, current);
            const frame = self.frames.items[current.frame];
            switch (frame.graph.heaps[current.heap]) {
                .entry => return true,
                .join => |row| for (row.inputs) |parent| try self.append(Source, &work, .{ .frame = current.frame, .heap = parent }),
                .store => |row| if (frame.controls[row.control]) { try self.append(Source, &work, .{ .frame = current.frame, .heap = row.previous }); },
                .copy => |row| if (frame.controls[frame.graph.nodes[row.value].copy.control]) { try self.append(Source, &work, .{ .frame = current.frame, .heap = row.previous }); },
                .call => |row| for (frame.targets[row.call].items) |target| { try self.budget.step(); if (self.frames.items[target].live[@intFromEnum(row.completion)]) return true; },
                .receiver_action => |row| {
                    const receiver = frame.receiver orelse { self.pending = .receiver_protocol; return false; };
                    if (receiver.heap_live[current.heap]) try self.append(Source, &work, .{ .frame = current.frame, .heap = row.previous });
                },
            }
        }
        return false;
    }
    fn initialized(self: *Engine, start: Source, base: R, selector: S, view: S) E!bool {
        const Task = struct { source: Source, base: R };
        var work: std.ArrayListUnmanaged(Task) = .empty; var seen: std.ArrayListUnmanaged(Task) = .empty;
        try self.append(Task, &work, .{ .source = start, .base = base }); var cursor: usize = 0; var defined = false;
        while (cursor < work.items.len) : (cursor += 1) {
            const current = work.items[cursor]; var visited = false;
            for (seen.items) |old| { try self.budget.step(); if (std.meta.eql(old, current)) { visited = true; break; } } if (visited) continue; try self.append(Task, &seen, current);
            const frame = self.frames.items[current.source.frame]; const node = self.locations.items[current.base];
            switch (frame.graph.heaps[current.source.heap]) {
                .entry => {
                    if (node.input != null) {
                        var found = false;
                        for (self.initial_heap) |slot| {
                            try self.budget.step(); if (slot.base == current.base and try self.sameSlot(current.base, selector, view, slot.selector, slot.view, true)) { found = true; break; }
                        }
                        if (found) { defined = true; continue; }
                        if (frame.sources.items.len == 0) return false;
                        for (frame.sources.items) |source| try self.append(Task, &work, .{ .source = source, .base = current.base });
                        continue;
                    }
                    if (node.scope == current.source.frame) return false;
                    // A callee-local ENV does not exist on an alternative
                    // target's branch before its own activation. That absence
                    // is not an uninitialized instance of the same ENV. A
                    // path through the owning frame's entry still fails, and
                    // a walk with no actual initializing path stays false.
                    if (frame.sources.items.len == 0) continue;
                    for (frame.sources.items) |source| try self.append(Task, &work, .{ .source = source, .base = current.base });
                },
                .join => |row| for (row.inputs) |parent| { const source = Source{ .frame = current.source.frame, .heap = parent }; if (try self.possibleHeap(source)) try self.append(Task, &work, .{ .source = source, .base = current.base }); },
                .store => |row| {
                    if (row.initialize and frame.controls[row.control] and try self.sameSlot(current.base, selector, view, row.selector, row.view, true)) {
                        const bases = try self.resolved(frame, row.bases); const values = try self.resolved(frame, row.values);
                        const empty_array = row.values.len == 0 and try self.budget.equal(selector, "element") and node.type_id != null and (try self.typeRow(node.type_id.?)).kind == .array;
                        if (bases.items.len == 1 and bases.items[0] == current.base and (values.items.len != 0 or empty_array)) { defined = true; continue; }
                    }
                    try self.append(Task, &work, .{ .source = .{ .frame = current.source.frame, .heap = row.previous }, .base = current.base });
                },
                .copy => |row| {
                    const operation = frame.graph.nodes[row.value].copy;
                    if (node.kind == .copied and node.key != null and try self.budget.equal(node.key.?, operation.site)) {
                        var matched = false;
                        // Includes recursive Value fields, which are not the
                        // top-level Data.copy result. Every edge was recorded
                        // by that real copy's physical field expansion.
                        for (self.copies.items) |edge| {
                            try self.budget.step(); if (edge.frame != current.source.frame or edge.action != current.source.heap or edge.target != current.base) continue;
                            matched = true; try self.append(Task, &work, .{ .source = .{ .frame = edge.frame, .heap = edge.heap }, .base = edge.source });
                        }
                        if (matched) continue;
                    }
                    try self.append(Task, &work, .{ .source = .{ .frame = current.source.frame, .heap = row.previous }, .base = current.base });
                },
                .call => |row| {
                    var found = false;
                    for (frame.targets[row.call].items) |target| {
                        try self.budget.step();
                        const called = self.frames.items[target]; const exits = if (row.completion == .normal) called.graph.exits.normal else called.graph.exits.language;
                        for (exits) |exit| { try self.budget.step(); if (called.controls[exit.control]) { found = true; try self.append(Task, &work, .{ .source = .{ .frame = target, .heap = exit.heap }, .base = current.base }); } }
                    }
                    if (!found) return false;
                },
                .receiver_action => |row| {
                    const receiver = frame.receiver orelse { self.pending = .receiver_protocol; return false; };
                    if (receiver.heap_live[current.source.heap]) try self.append(Task, &work, .{ .source = .{ .frame = current.source.frame, .heap = row.previous }, .base = current.base });
                },
            }
        }
        return defined;
    }
    fn completeCapture(self: *Engine, source: Source, bases: []const R, layout: S, key: S) E!void {
        const environments = try self.selectEnvironments(bases, layout);
        if (environments.items.len == 0) { self.pending = .environment_protocol; return; }
        for (environments.items) |environment| {
            if (self.locations.items[environment].kind == .environment_local) {
                try self.budget.spend(key.len + layout.len + 14);
                const selector = try std.mem.concat(self.a, u8, &.{ "capture:", key });
                const view = try std.mem.concat(self.a, u8, &.{ "env:", layout });
                if (!try self.initialized(source, environment, selector, view)) { self.pending = .capture_uninitialized; return; }
            }
            const values = try self.captureValues(self.frames.items[source.frame].heaps[source.heap].items, &.{environment}, layout, key);
            if (values.items.len == 0) { self.pending = .unresolved_value; return; }
        }
    }
    fn completeContents(self: *Engine, source: Source, values: []const R, payloads: *std.ArrayListUnmanaged(Payload)) E!void {
        var work: Set = .empty; for (values) |value| try self.append(R, &work, value); var seen: Set = .empty; var cursor: usize = 0;
        while (cursor < work.items.len) : (cursor += 1) {
            try self.budget.step(); const value = work.items[cursor]; var visited = false; for (seen.items) |old| { try self.budget.step(); if (old == value) { visited = true; break; } } if (visited) continue; try self.add(&seen, value);
            const node = self.locations.items[value];
            if (node.kind == .code) { if (node.environment) |environment| try self.append(R, &work, environment); continue; }
            if (!envKind(node.kind)) {
                if (node.kind != .payload and node.kind != .copied and (node.kind != .root or node.owner != .local)) continue;
                const type_id = node.type_id orelse continue;
                const shape = try self.typeRow(type_id);
                var slots: std.ArrayListUnmanaged(ContentSlot) = .empty;
                if (shape.kind == .array) {
                    if (!try self.initialized(source, value, "element", type_id)) { self.pending = .payload_uninitialized; return; }
                    const selected = try self.read(self.frames.items[source.frame].heaps[source.heap].items, value, "element", type_id, source.frame, 0, null);
                    try self.append(ContentSlot, &slots, .{ .selector = "element", .view = type_id, .physical = null, .values = selected.items });
                    for (selected.items) |child| try self.append(R, &work, child);
                } else if (shape.kind == .reference or shape.kind == .value) {
                    var fields: ?[]const Field = null;
                    for (self.physical) |physical| { try self.budget.step(); if (try self.budget.equal(physical.type_id, type_id)) { fields = physical.fields; break; } }
                    const complete = fields orelse { self.pending = .payload_layout; return; };
                    for (complete) |field| {
                        try self.budget.step(); if (!try self.budget.equal(field.view, type_id)) continue;
                        try self.budget.spend(field.id.len + 7); const selector = try std.mem.concat(self.a, u8, &.{ "field:", field.id });
                        if (!try self.initialized(source, value, selector, field.view)) { self.pending = .payload_uninitialized; return; }
                        const selected = try self.read(self.frames.items[source.frame].heaps[source.heap].items, value, selector, field.view, source.frame, 0, field.type_id);
                        if (selected.items.len == 0) { self.pending = .unresolved_value; return; }
                        try self.append(ContentSlot, &slots, .{ .selector = selector, .view = field.view, .physical = field.physical, .values = selected.items });
                        for (selected.items) |child| try self.append(R, &work, child);
                    }
                } else if (shape.kind == .function or shape.kind == .read_span or shape.kind == .unknown or shape.kind == .union_type) { self.pending = .payload_layout; return; } else continue;
                var previous: ?usize = null;
                for (payloads.items, 0..) |old, i| { try self.budget.step(); if (old.location == value) { previous = i; break; } }
                if (previous) |i| {
                    const old = &payloads.items[i]; if (old.slots.len != slots.items.len) return error.InvalidGraph;
                    for (old.slots, slots.items) |*slot, incoming| {
                        var merged: Set = .empty; try self.merge(&merged, slot.values); try self.merge(&merged, incoming.values); slot.values = merged.items;
                    }
                } else try self.append(Payload, payloads, .{ .location = value, .type_id = type_id, .slots = slots.items });
                continue;
            }
            const row = try self.environmentRow(node.layout.?);
            if (row.parent != null and self.parents.items[value].items.len == 0) { self.pending = .environment_protocol; return; }
            for (self.parents.items[value].items) |parent| try self.append(R, &work, parent);
            for (row.slots) |slot| {
                try self.completeCapture(source, &.{value}, row.id, slot.key); if (self.pending != null) return;
                // A returned slot may itself contain a captured closure; its
                // full ENV graph, including cycles, is part of the same check.
                const selected = try self.captureValues(self.frames.items[source.frame].heaps[source.heap].items, &.{value}, row.id, slot.key);
                for (selected.items) |child| try self.append(R, &work, child);
            }
        }
    }
    fn validate(self: *Engine) E!void {
        for (self.frames.items, 0..) |frame, index| {
            const graph = frame.graph;
            inline for (0..2) |completion| {
                const exits = if (completion == 0) graph.exits.normal else graph.exits.language;
                const refs = if (completion == 0) graph.normal else graph.language;
                for (exits) |exit| {
                    try self.budget.step(); if (!frame.controls[exit.control]) continue;
                    if (!frame.heap_ready[exit.heap]) { self.pending = .incomplete_completion; return; }
                    if (!try self.readyRefs(frame, refs)) { self.pending = .unresolved_value; return; }
                    const values = try self.resolved(frame, refs);
                    if (refs.len != 0 and values.items.len == 0) { self.pending = .unresolved_value; return; }
                    try self.completeContents(.{ .frame = index, .heap = exit.heap }, values.items, &frame.output_payloads[completion]); if (self.pending != null) return;
                }
            }
            for (graph.nodes, 0..) |node, ordinal| {
                try self.budget.step(); switch (node) {
                    .capture => |row| if (frame.controls[row.control]) { const bases = try self.resolved(frame, row.environment); try self.completeCapture(.{ .frame = index, .heap = row.heap }, bases.items, row.layout, row.id); },
                    .environment_parent => |row| if (frame.controls[row.control] and frame.values[ordinal].items.len == 0) { self.pending = .environment_protocol; },
                    .environment_create => |row| if (frame.controls[row.control] and (try self.environmentRow(row.layout)).parent != null) { for (frame.values[ordinal].items) |environment| { try self.budget.step(); if (self.parents.items[environment].items.len == 0) self.pending = .environment_protocol; } },
                    .copy => |row| if (frame.controls[row.control] and try self.possibleHeap(.{ .frame = index, .heap = row.heap })) {
                        const values = try self.resolved(frame, row.bases); if (!frame.ready[ordinal] or values.items.len == 0) self.pending = .unresolved_value;
                    },
                    else => {},
                }
                if (self.pending != null) return;
            }
            for (graph.calls, frame.targets) |call, targets| {
                try self.budget.step(); if (!frame.controls[call.control]) continue;
                if (targets.items.len == 0) { self.pending = .environment_protocol; return; }
                const upper = (try self.contract(call.function_id)).?;
                for (targets.items) |target| {
                    try self.budget.step();
                    const called = self.frames.items[target];
                    // A mayThrow permission is a complete continuation bound.
                    // A missing language relation cannot be proved empty from
                    // the current body or replaced with a local scalar.
                    if (upper.may_throw and !called.live[1]) { self.pending = .incomplete_completion; return; }
                    if (upper.parameters.len != called.arguments.len) return error.InvalidGraph;
                    for (upper.parameters, called.arguments) |flags, argument| try self.contentEffects(called.input.items, argument.items, flags);
                    for (upper.captures) |capture| try self.captureEffects(target, capture);
                }
            }
            for (graph.accesses) |access| {
                try self.budget.step(); if (!frame.controls[access.control]) continue;
                const values = try self.resolved(frame, access.values);
                if (!try self.readyRefs(frame, access.values) or (access.values.len != 0 and values.items.len == 0)) { self.pending = .unresolved_value; return; }
                for (values.items) |value_id| try self.effect(self.locations.items[value_id].owner, access.flag);
            }
            // Every live store prefix is included, even without a completion.
            for (graph.heaps, 0..) |row, heap_id| {
                try self.budget.step(); if (row != .store or !frame.controls[row.store.control]) continue;
                const store = row.store;
                if (!try self.possibleHeap(.{ .frame = index, .heap = store.previous })) continue;
                const bases = try self.resolved(frame, store.bases); const values = try self.resolved(frame, store.values);
                const empty_elements = store.initialize and store.values.len == 0 and try self.budget.equal(store.selector, "element");
                if (!frame.heap_ready[heap_id] or bases.items.len == 0 or (values.items.len == 0 and !empty_elements)) { self.pending = .unresolved_value; return; }
                if (std.mem.startsWith(u8, store.selector, "capture:") and !store.initialize) {
                    // A later store does not make an uninitialized lexical
                    // slot initialized; every live predecessor must have init.
                    try self.completeCapture(.{ .frame = index, .heap = store.previous }, bases.items, store.view[4..], store.selector[8..]);
                    if (self.pending != null) return;
                }
            }
        }
    }
    fn captureEffects(self: *Engine, start: usize, capture: Capture) E!void {
        var layout: ?S = null;
        for (self.directory.environments) |row| {
            try self.budget.step();
            for (row.slots) |slot| { try self.budget.step(); if (try self.budget.equal(slot.key, capture.key)) layout = row.id; }
        }
        const id = layout orelse return error.InvalidReference;
        var work: Set = .empty; try self.add(&work, start); var seen: Set = .empty; var cursor: usize = 0; var found = false;
        while (cursor < work.items.len) : (cursor += 1) {
            const index = work.items[cursor]; var visited = false; for (seen.items) |old| { try self.budget.step(); if (old == index) { visited = true; break; } } if (visited) continue; try self.add(&seen, index);
            const frame = self.frames.items[index]; const protocol = try m.findFunction(self.directory, frame.function_id, self.budget);
            var lexical = protocol.lexical_environment;
            while (lexical) |current| {
                if (try self.budget.equal(current, id)) {
                    const values = try self.captureValues(frame.input.items, frame.environment.items, id, capture.key);
                    if (values.items.len == 0) { self.pending = .environment_protocol; return; }
                    try self.contentEffects(frame.input.items, values.items, capture.flags); found = true; break;
                }
                lexical = (try self.environmentRow(current)).parent;
            }
            if (protocol.activation_environment) |activation| if (try self.budget.equal(activation, id)) {
                for (frame.graph.nodes, 0..) |node, ordinal| {
                    try self.budget.step();
                    if (node != .environment_create or !frame.controls[node.environment_create.control]) continue;
                    // Include every reachable heap prefix that carries the
                    // closure's slot, not only a sampled return exit.
                    for (frame.graph.heaps, 0..) |_, heap_id| {
                        try self.budget.step(); if (!frame.heap_ready[heap_id]) continue;
                        const values = try self.captureValues(frame.heaps[heap_id].items, frame.values[ordinal].items, id, capture.key);
                        if (values.items.len != 0) { try self.contentEffects(frame.heaps[heap_id].items, values.items, capture.flags); found = true; }
                    }
                }
            };
            for (frame.targets) |targets| { try self.budget.step(); for (targets.items) |target| try self.append(R, &work, target); }
        }
        if (!found) self.pending = .environment_protocol;
    }
};

// The owning entry has already validated this directory and the complete typed
// graphs with this same Budget. Raw JSON, Source, permission tokens and selected
// Actual entrances are intentionally absent from this seam.
pub fn analyze(allocator: std.mem.Allocator, directory: *const m.Directory, physical: []const Physical, function_id: S, graph: *const m.Graph, fixed: []const Fixed, budget: *B) E!Analysis {
    return analyzeImpl(allocator, directory, physical, function_id, graph, fixed, budget, null, null);
}
// The production caller borrows the single construction-domain interpretation
// of this same immutable graph. No receiver machine is duplicated here; the
// ordinary contents/ENV equations consume only its continuation facts.
pub fn analyzeReceiver(allocator: std.mem.Allocator, directory: *const m.Directory, physical: []const Physical, function_id: S, graph: *const m.Graph, fixed: []const Fixed, budget: *B, receiver: *const construction.Analysis) E!Analysis {
    return analyzeImpl(allocator, directory, physical, function_id, graph, fixed, budget, receiver, null);
}
// Input rows come from the caller's existing symbolic owner/content state.
// Present heap rows are established slots; missing rows stay unknown. This is
// the same Engine and Budget, with no runtime tags, SSA or receiver seed added.
pub fn analyzeInputs(allocator: std.mem.Allocator, directory: *const m.Directory, physical: []const Physical, function_id: S, graph: *const m.Graph, fixed: []const Fixed, budget: *B, receiver: ?*const construction.Analysis, initial: *const Initial) E!Analysis {
    return analyzeImpl(allocator, directory, physical, function_id, graph, fixed, budget, receiver, initial);
}
fn analyzeImpl(allocator: std.mem.Allocator, directory: *const m.Directory, physical: []const Physical, function_id: S, graph: *const m.Graph, fixed: []const Fixed, budget: *B, receiver: ?*const construction.Analysis, initial: ?*const Initial) E!Analysis {
    var result = Analysis{ .arena = std.heap.ArenaAllocator.init(allocator) }; errdefer result.deinit();
    var engine = Engine{ .a = result.arena.allocator(), .directory = directory, .physical = physical, .fixed = fixed, .budget = budget, .receiver = receiver };
    const protocol = try m.findFunction(directory, function_id, budget);
    if (!protocol.environment_metadata_complete) { result.pending = .environment_protocol; return result; }
    if ((protocol.construction != null) != (receiver != null)) { result.pending = .receiver_protocol; return result; }
    if (receiver) |facts| {
        try budget.step();
        if (!try engine.receiverFacts(graph, facts)) { result.pending = .receiver_protocol; return result; }
    }
    const arguments = try engine.allocate(Set, protocol.parameter_types.len); @memset(arguments, .empty);
    var environment: Set = .empty; var input_heap: Heap = .empty;
    if (initial) |input| {
        try budget.step(); if (input.arguments.len != arguments.len) return error.InvalidGraph;
        const mapping = try engine.allocate(R, input.locations.len);
        for (input.locations, mapping, 0..) |row, *into, index| {
            try budget.step(); var copy = row; copy.scope = std.math.maxInt(usize); copy.node = index; copy.source = null; copy.environment = null; copy.input = index;
            into.* = try engine.location(copy);
        }
        for (input.locations, mapping) |row, into| {
            try budget.step();
            if (row.source) |source| { if (source >= mapping.len) return error.InvalidGraph; engine.locations.items[into].source = mapping[source]; }
            if (row.environment) |env| { if (env >= mapping.len) return error.InvalidGraph; engine.locations.items[into].environment = mapping[env]; }
        }
        for (input.arguments, arguments, 0..) |refs, *into, index| {
            try budget.step(); if (receiver != null and index == 0) continue;
            for (refs) |ref| { try budget.step(); if (ref >= mapping.len) return error.InvalidGraph; try engine.add(into, mapping[ref]); }
            if (into.items.len == 0) { result.pending = .unresolved_value; return result; }
        }
        for (input.environment) |ref| { try budget.step(); if (ref >= mapping.len) return error.InvalidGraph; try engine.add(&environment, mapping[ref]); }
        if ((protocol.lexical_environment != null) != (environment.items.len != 0)) { result.pending = .environment_protocol; return result; }
        for (input.parents) |entry| {
            try budget.step(); if (entry.location >= mapping.len) return error.InvalidGraph;
            for (entry.parents) |parent| { try budget.step(); if (parent >= mapping.len) return error.InvalidGraph; try engine.add(&engine.parents.items[mapping[entry.location]], mapping[parent]); }
        }
        for (input.heap) |address| {
            try budget.step(); if (address.base >= mapping.len) return error.InvalidGraph; var values: Set = .empty;
            for (address.values) |ref| { try budget.step(); if (ref >= mapping.len) return error.InvalidGraph; try engine.add(&values, mapping[ref]); }
            if (values.items.len == 0) {
                const node = engine.locations.items[mapping[address.base]];
                if (node.kind != .payload or node.type_id == null or !try budget.equal(address.selector, "element") or (try engine.typeRow(node.type_id.?)).kind != .array) { result.pending = .payload_uninitialized; return result; }
                // Only Initial's explicitly established empty Array cell is
                // retained here. General May put(empty) remains unchanged.
                try engine.append(Address, &input_heap, .{ .base = mapping[address.base], .selector = address.selector, .view = address.view });
            } else try engine.put(&input_heap, mapping[address.base], address.selector, address.view, values.items);
        }
        engine.initial_heap = input_heap.items;
    } else {
        for (protocol.parameter_types, 0..) |type_id, index| {
            try budget.step(); if (receiver != null and index == 0) continue;
            const location = try engine.location(.{ .kind = .root, .owner = .{ .parameter = index }, .type_id = type_id }); try engine.add(&arguments[index], location);
        }
        if (protocol.lexical_environment) |layout| { const input = try engine.entryEnvironment(layout); try engine.add(&environment, input); }
    }
    _ = try engine.ensure(graph, function_id, graph, std.math.maxInt(usize), arguments, environment, input_heap.items, null, receiver, null);
    try engine.run(); if (engine.pending == null) try engine.validate();
    if (engine.pending == null) {
        // The selected function's full capture upper is an effect obligation
        // even when its fixed graph never reads that slot. Transfer it through
        // all saved environments in the complete fixed call closure.
        const upper = try engine.contract(function_id) orelse { result.pending = .missing_fixed; return result; };
        for (upper.captures) |capture| {
            try budget.step();
            if (!capture.flags.read and !capture.flags.write and !capture.flags.structural) continue;
            try engine.captureEffects(0, capture); if (engine.pending != null) break;
        }
    }
    if (engine.pending) |pending| { result.pending = pending; return result; }
    const root = engine.frames.items[0];
    // Export symbolic parent/slot graphs with the Analysis arena. The adapter
    // must rebind them as one graph, never as caller RegisterRef births.
    var environments: std.ArrayListUnmanaged(Environment) = .empty;
    for (engine.locations.items, 0..) |location, index| {
        try budget.step(); if (!Engine.envKind(location.kind)) continue;
        try engine.append(Environment, &environments, .{ .location = index, .parents = engine.parents.items[index].items });
    }
    result.normal = root.output[0].items; result.language = root.output[1].items;
    result.normal_live = root.live[0]; result.language_live = root.live[1]; result.locations = engine.locations.items;
    result.normal_heap = root.output_heap[0].items; result.language_heap = root.output_heap[1].items;
    result.effects = engine.effects.items; result.environments = environments.items;
    result.normal_payloads = root.output_payloads[0].items; result.language_payloads = root.output_payloads[1].items;
    return result;
}
