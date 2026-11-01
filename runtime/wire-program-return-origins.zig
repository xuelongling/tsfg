// SPDX-License-Identifier: MIT
// Structural Graph5 certificates only. Receiver equations have a finite exact
// certificate; no entry-state, Actual/SSA, permission or wire activation proof.
const std = @import("std");
pub const model = @import("wire-program-return-origin-model.zig");
const Graph = model.Graph;
const Ref = model.Ref;
const Error = model.Error;
const Budget = model.Budget;
const Symbol = model.Symbol;

pub const FixedContract = struct { function_id: Symbol, graph: ?*const Graph };
const ValidatedContract = struct { function_id: Symbol, graph: ?*const Graph, protocol_pending: bool };
pub const Pending = enum {
    graph_protocol, missing_return_graph, unknown_data_origin, missing_fixed_call,
    unmatched_completion, unmatched_live_call, no_structural_certificate,
    receiver_no_exact_certificate,
};
// A sufficient structural certificate, never a Runtime permission or admission.
pub const Inclusion = union(enum) { covered: void, pending: Pending };

const TaskKind = enum { values, node, value_choice, heap_choice, heap_alternatives, call_choice, heap, call };
const Task = struct { kind: TaskKind, left: Ref = 0, right: Ref = 0, left_refs: []const Ref = &.{}, right_refs: []const Ref = &.{} };
const SeenKey = struct { kind: TaskKind, left: Ref, right: Ref };
const Certificate = struct {
    pending: std.ArrayListUnmanaged(Task) = .empty,
    seen: std.AutoHashMapUnmanaged(SeenKey, void) = .empty,
    copies: std.StringHashMapUnmanaged(Symbol) = .empty,
    locals: std.AutoHashMapUnmanaged(Ref, Ref) = .empty,
    calls: std.AutoHashMapUnmanaged(Ref, Ref) = .empty,
};
const GraphState = struct { graph: *const Graph, controls: []bool };

// Complete typed equations, not a digest, pointer identity or selected roots.
// Recursion follows the finite DTO type depth; reference edges are compared as
// ordinals, never recursively unfolded. Symbols and every outer edge are paid
// before inspection. No allocation or second serialized graph is needed.
fn exactEquation(comptime T: type, left: T, right: T, budget: *Budget) Error!bool {
    try budget.step();
    return switch (@typeInfo(T)) {
        .void => true,
        .int, .bool, .@"enum" => left == right,
        .optional => |info| blk: {
            if ((left == null) != (right == null)) break :blk false;
            break :blk if (left) |value| try exactEquation(info.child, value, right.?, budget) else true;
        },
        .pointer => |info| blk: {
            if (info.size != .slice) @compileError("Graph equations contain only borrowed slices");
            if (info.child == u8) break :blk try budget.equal(left, right);
            if (left.len != right.len) break :blk false;
            try budget.spend(left.len);
            for (left, right) |a, b| if (!try exactEquation(info.child, a, b, budget)) break :blk false;
            break :blk true;
        },
        .@"struct" => |info| blk: {
            try budget.spend(info.fields.len);
            inline for (info.fields) |field| if (!try exactEquation(field.type, @field(left, field.name), @field(right, field.name), budget)) break :blk false;
            break :blk true;
        },
        .@"union" => blk: {
            if (std.meta.activeTag(left) != std.meta.activeTag(right)) break :blk false;
            break :blk switch (left) {
                inline else => |value, tag| try exactEquation(@TypeOf(value), value, @field(right, @tagName(tag)), budget),
            };
        },
        else => @compileError("Unrepresented Graph equation field"),
    };
}

fn explicitConstruction(directory: *const model.Directory, id: Symbol, budget: *Budget) Error!bool {
    try budget.spend(directory.constructions.len);
    for (directory.constructions) |row| {
        try budget.step();
        if (try budget.equal(row.id, id)) return row.kind == .explicit;
    }
    return error.InvalidReference; // The owning reader has already joined it.
}

const Engine = struct {
    allocator: std.mem.Allocator,
    budget: *Budget,
    body: *const Graph,
    upper: *const Graph,
    fixed: []const ValidatedContract,
    graphs: std.ArrayListUnmanaged(GraphState) = .empty,
    indices: std.AutoHashMapUnmanaged(*const Graph, usize) = .empty,
    search: std.ArrayListUnmanaged(Certificate) = .empty,

    fn append(self: *Engine, comptime T: type, into: *std.ArrayListUnmanaged(T), value: T) Error!void {
        try self.budget.step();
        if (into.items.len == into.capacity) try self.budget.spend(into.items.len + 1);
        try into.append(self.allocator, value);
    }
    fn copySlice(self: *Engine, comptime T: type, source: []const T) Error![]T {
        try self.budget.spend(source.len + 1);
        return self.allocator.dupe(T, source);
    }
    fn graphIndex(self: *Engine, graph: *const Graph) Error!usize {
        try self.budget.lookup(self.indices.count(), @sizeOf(usize));
        return self.indices.get(graph).?;
    }
    fn addGraph(self: *Engine, graph: *const Graph) Error!void {
        try self.budget.lookup(self.indices.count(), @sizeOf(usize));
        if (self.indices.contains(graph)) return;
        try self.budget.spend(graph.controls.len + 1);
        const controls = try self.allocator.alloc(bool, graph.controls.len);
        @memset(controls, false);
        try self.budget.spend(self.indices.count() + 2);
        try self.indices.put(self.allocator, graph, self.graphs.items.len);
        try self.append(GraphState, &self.graphs, .{ .graph = graph, .controls = controls });
    }
    fn fixedContract(self: *Engine, id: Symbol) Error!?*const ValidatedContract {
        try self.budget.lookup(self.fixed.len, id.len);
        var lo: usize = 0;
        var hi = self.fixed.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            switch (std.mem.order(u8, self.fixed[mid].function_id, id)) {
                .eq => return &self.fixed[mid],
                .lt => lo = mid + 1,
                .gt => hi = mid,
            }
        }
        return null;
    }
    fn fixedGraph(self: *Engine, id: Symbol) Error!?*const Graph {
        const row = try self.fixedContract(id) orelse return null;
        return row.graph;
    }
    fn live(self: *Engine, graph: *const Graph, id: Ref) Error!bool {
        return self.graphs.items[try self.graphIndex(graph)].controls[id];
    }
    fn completes(self: *Engine, graph: *const Graph, completion: model.Completion) Error!bool {
        const exits = if (completion == .normal) graph.exits.normal else graph.exits.language;
        for (exits) |state| {
            try self.budget.step();
            if (try self.live(graph, state.control)) return true;
        }
        return false;
    }
    fn valueLive(self: *Engine, graph: *const Graph, node: model.Value) Error!bool {
        try self.budget.step();
        return switch (node) {
            inline .gate, .copy, .projection, .capture, .environment_create, .environment_parent, .environment_component, .code => |row| self.live(graph, row.control),
            .call => |row| blk: {
                const call = graph.calls[row.call];
                if (!try self.live(graph, call.control)) break :blk false;
                break :blk try self.completes((try self.fixedGraph(call.function_id)).?, row.completion);
            },
            else => true,
        };
    }
    fn controlClosure(self: *Engine) Error!void {
        var changed = true;
        while (changed) {
            changed = false;
            for (self.graphs.items) |state| {
                try self.budget.step();
                for (state.graph.controls, 0..) |control, id| {
                    try self.budget.step();
                    if (state.controls[id]) continue;
                    const value = switch (control) {
                        .receiver_completion => return error.InvalidGraph, // validateGraph keeps receiver protocols Pending.
                        .entry => true,
                        .join => |row| blk: {
                            for (row.inputs) |parent| {
                                try self.budget.step();
                                if (state.controls[parent]) break :blk true;
                            }
                            break :blk false;
                        },
                        .call => |row| blk: {
                            const call = state.graph.calls[row.call];
                            break :blk try self.live(state.graph, call.control) and try self.completes((try self.fixedGraph(call.function_id)).?, row.completion);
                        },
                    };
                    if (value) { state.controls[id] = true; changed = true; }
                }
            }
        }
    }
    fn visit(self: *Engine, seen: *std.AutoHashMapUnmanaged(Ref, void), id: Ref) Error!bool {
        try self.budget.lookup(seen.count(), @sizeOf(Ref));
        try self.budget.step();
        if (seen.contains(id)) return false;
        try self.budget.spend(seen.count() + 1);
        try seen.put(self.allocator, id, {});
        return true;
    }
    fn atoms(self: *Engine, graph: *const Graph, refs: []const Ref) Error![]const Ref {
        var pending: std.ArrayListUnmanaged(Ref) = .empty;
        try self.budget.spend(refs.len + 1);
        try pending.appendSlice(self.allocator, refs);
        var seen: std.AutoHashMapUnmanaged(Ref, void) = .empty;
        var out: std.ArrayListUnmanaged(Ref) = .empty;
        while (pending.pop()) |id| {
            try self.budget.step();
            if (!try self.visit(&seen, id)) continue;
            const row = graph.nodes[id];
            if (!try self.valueLive(graph, row) or row == .nonowning) continue;
            switch (row) {
                inline .join, .gate => |join| {
                    try self.budget.spend(join.inputs.len);
                    for (join.inputs) |input| try self.append(Ref, &pending, input);
                },
                else => try self.append(Ref, &out, id),
            }
        }
        return out.items;
    }
    fn heapAtoms(self: *Engine, graph: *const Graph, refs: []const Ref, optional: bool) Error![]const Ref {
        var pending: std.ArrayListUnmanaged(Ref) = .empty;
        try self.budget.spend(refs.len + 1);
        try pending.appendSlice(self.allocator, refs);
        var seen: std.AutoHashMapUnmanaged(Ref, void) = .empty;
        var out: std.ArrayListUnmanaged(Ref) = .empty;
        while (pending.pop()) |id| {
            try self.budget.step();
            if (!try self.visit(&seen, id)) continue;
            switch (graph.heaps[id]) {
                .join => |join| {
                    try self.budget.spend(join.inputs.len);
                    for (join.inputs) |input| try self.append(Ref, &pending, input);
                    continue;
                },
                .store => |store| {
                    const inactive = !try self.live(graph, store.control) or (try self.atoms(graph, store.values)).len == 0;
                    if (inactive or optional) try self.append(Ref, &pending, store.previous);
                    if (inactive) continue;
                },
                .copy => |copy| {
                    const inactive = (try self.atoms(graph, &.{copy.value})).len == 0;
                    if (inactive or optional) try self.append(Ref, &pending, copy.previous);
                    if (inactive) continue;
                },
                else => {},
            }
            try self.append(Ref, &out, id);
        }
        return out.items;
    }
    fn task(self: *Engine, state: *Certificate, value: Task) Error!void { try self.append(Task, &state.pending, value); }
    fn values(self: *Engine, state: *Certificate, left: []const Ref, right: []const Ref) Error!void {
        // Slices are immutable input or arena-owned derived sets. Branches may
        // safely share them; only each branch's pending container is copied.
        try self.task(state, .{ .kind = .values, .left_refs = left, .right_refs = right });
    }
    fn choice(self: *Engine, state: *Certificate, kind: TaskKind, left: Ref, right: []const Ref) Error!void {
        try self.task(state, .{ .kind = kind, .left = left, .right_refs = right });
    }
    fn heap(self: *Engine, state: *Certificate, left: Ref, right: Ref) Error!void {
        const refs = try self.copySlice(Ref, &.{right});
        try self.choice(state, .heap_choice, left, refs);
    }
    fn pair(self: *Engine, state: *Certificate, kind: TaskKind, left: Ref, right: Ref) Error!void {
        try self.task(state, .{ .kind = kind, .left = left, .right = right });
    }
    fn visitedPair(self: *Engine, state: *Certificate, obligation: Task) Error!bool {
        const key: SeenKey = .{ .kind = obligation.kind, .left = obligation.left, .right = obligation.right };
        try self.budget.lookup(state.seen.count(), @sizeOf(SeenKey));
        try self.budget.step();
        if (state.seen.contains(key)) return true;
        try self.budget.spend(state.seen.count() + 1);
        try state.seen.put(self.allocator, key, {});
        return false;
    }
    fn alpha(self: *Engine, mapping: *std.AutoHashMapUnmanaged(Ref, Ref), left: Ref, right: Ref) Error!bool {
        try self.budget.lookup(mapping.count(), @sizeOf(Ref));
        if (mapping.get(left)) |old| return old == right;
        try self.budget.spend(mapping.count() + 2);
        try mapping.put(self.allocator, left, right);
        return true;
    }
    fn copyAlpha(self: *Engine, state: *Certificate, left: Symbol, right: Symbol) Error!bool {
        try self.budget.lookup(state.copies.count(), left.len);
        if (state.copies.get(left)) |old| return self.budget.equal(old, right);
        try self.budget.text(left.len); try self.budget.text(right.len);
        try self.budget.spend(state.copies.count() + 2);
        try state.copies.put(self.allocator, left, right);
        return true;
    }
    fn fork(self: *Engine, state: *const Certificate, kind: TaskKind, left: Ref, right: Ref) Error!void {
        try self.budget.spend(state.pending.items.len + state.seen.count() + state.locals.count() * 2 + state.calls.count() * 2 + state.copies.count() * 2 + 1);
        var symbols = state.copies.iterator();
        while (symbols.next()) |row| { try self.budget.text(row.key_ptr.*.len); try self.budget.text(row.value_ptr.*.len); }
        var next: Certificate = .{};
        try next.pending.appendSlice(self.allocator, state.pending.items);
        next.seen = try state.seen.clone(self.allocator);
        next.locals = try state.locals.clone(self.allocator);
        next.calls = try state.calls.clone(self.allocator);
        next.copies = try state.copies.clone(self.allocator);
        try self.pair(&next, kind, left, right);
        try self.append(Certificate, &self.search, next);
    }
    fn initial(self: *Engine, state: *Certificate) Error!?Pending {
        inline for (.{ model.Completion.normal, model.Completion.language }) |completion| {
            const right_exits = if (completion == .normal) self.upper.exits.normal else self.upper.exits.language;
            const left_exits = if (completion == .normal) self.body.exits.normal else self.body.exits.language;
            var right: std.ArrayListUnmanaged(Ref) = .empty;
            for (right_exits) |exit| { try self.budget.step(); if (try self.live(self.upper, exit.control)) try self.append(Ref, &right, exit.heap); }
            var reachable = false;
            for (left_exits) |exit| {
                try self.budget.step();
                if (try self.live(self.body, exit.control)) { reachable = true; try self.choice(state, .heap_choice, exit.heap, right.items); }
            }
            if (reachable and right.items.len == 0) return .unmatched_completion;
            if (reachable) try self.values(state, if (completion == .normal) self.body.normal else self.body.language, if (completion == .normal) self.upper.normal else self.upper.language);
        }
        for (self.body.accesses) |access| {
            try self.budget.step(); if (!try self.live(self.body, access.control)) continue;
            var right: std.ArrayListUnmanaged(Ref) = .empty;
            for (self.upper.accesses) |allowed| {
                try self.budget.step();
                if (access.flag == allowed.flag and try self.live(self.upper, allowed.control)) {
                    try self.budget.spend(allowed.values.len);
                    for (allowed.values) |id| try self.append(Ref, &right, id);
                }
            }
            try self.values(state, access.values, right.items);
        }
        // Prefix effects survive a discarded result or nonterminating call.
        for (self.body.calls, 0..) |call, left| {
            try self.budget.step(); if (!try self.live(self.body, call.control)) continue;
            var right: std.ArrayListUnmanaged(Ref) = .empty;
            for (self.upper.calls, 0..) |allowed, id| {
                try self.budget.step();
                if (try self.live(self.upper, allowed.control) and try self.budget.equal(call.function_id, allowed.function_id)) try self.append(Ref, &right, id);
            }
            if (right.items.len == 0) return .unmatched_live_call;
            try self.choice(state, .call_choice, left, right.items);
        }
        return null;
    }
    fn matchCall(self: *Engine, state: *Certificate, obligation: Task) Error!bool {
        const a = self.body.calls[obligation.left]; const b = self.upper.calls[obligation.right];
        if (!try self.alpha(&state.calls, obligation.left, obligation.right)) return false;
        if (!try self.budget.equal(a.function_id, b.function_id) or a.arguments.len != b.arguments.len or (a.environment == null) != (b.environment == null) or (a.callee == null) != (b.callee == null)) return false;
        if (try self.visitedPair(state, obligation)) return true;
        if (try self.live(self.body, a.control) and !try self.live(self.upper, b.control)) return false;
        try self.budget.spend(a.arguments.len + 1);
        for (a.arguments, b.arguments) |left, right| try self.values(state, left, right);
        if (a.environment) |left| try self.values(state, left, b.environment.?);
        if (a.callee) |left| try self.values(state, left, b.callee.?);
        try self.heap(state, a.heap, b.heap); return true;
    }
    fn matchNode(self: *Engine, state: *Certificate, obligation: Task) Error!bool {
        const a = self.body.nodes[obligation.left]; const b = self.upper.nodes[obligation.right];
        if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
        switch (a) {
            .parameter => |row| return row.index == b.parameter.index,
            .global => |row| return self.budget.equal(row.id, b.global.id),
            .environment_input => |row| return self.budget.equal(row.layout, b.environment_input.layout),
            .literal => |row| return row.category == b.literal.category,
            .unknown => return true, // Overall scan already leaves this pending.
            .local => |row| return try self.budget.equal(row.@"type", b.local.@"type") and try self.alpha(&state.locals, obligation.left, obligation.right),
            .environment_create => |row| {
                if (!try self.budget.equal(row.layout, b.environment_create.layout) or (row.parent == null) != (b.environment_create.parent == null)) return false;
                if (!try self.alpha(&state.locals, obligation.left, obligation.right)) return false;
            },
            .copy => |row| if (!try self.copyAlpha(state, row.site, b.copy.site)) return false,
            else => {},
        }
        if (try self.visitedPair(state, obligation)) return true;
        switch (a) {
            .capture => |row| {
                const other = b.capture;
                if (!try self.budget.equal(row.id, other.id) or !try self.budget.equal(row.layout, other.layout)) return false;
                try self.values(state, row.environment, other.environment); try self.heap(state, row.heap, other.heap);
            },
            .environment_create => |row| if (row.parent) |left| { try self.values(state, left, b.environment_create.parent.?); },
            .environment_parent => |row| {
                if (!try self.budget.equal(row.layout, b.environment_parent.layout)) return false;
                try self.values(state, row.bases, b.environment_parent.bases);
            },
            .environment_component => |row| {
                const other = b.environment_component;
                if (!try self.budget.equal(row.layout, other.layout) or !try self.budget.equal(row.function_id, other.function_id)) return false;
                try self.values(state, row.callee, other.callee);
            },
            .code => |row| {
                const other = b.code;
                if (!try self.budget.equal(row.function_id, other.function_id) or (row.environment == null) != (other.environment == null)) return false;
                if (row.environment) |left| try self.values(state, left, other.environment.?);
            },
            .projection => |row| {
                const other = b.projection;
                if (!try self.budget.equal(row.selector, other.selector) or !try self.budget.equal(row.view, other.view)) return false;
                try self.values(state, row.bases, other.bases); try self.heap(state, row.heap, other.heap);
            },
            .copy => |row| { try self.values(state, row.bases, b.copy.bases); try self.heap(state, row.heap, b.copy.heap); },
            .call => |row| { if (row.completion != b.call.completion) return false; try self.pair(state, .call, row.call, b.call.call); },
            else => return false,
        }
        return true;
    }
    fn matchHeap(self: *Engine, state: *Certificate, obligation: Task) Error!bool {
        const a = self.body.heaps[obligation.left]; const b = self.upper.heaps[obligation.right];
        if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
        if (try self.visitedPair(state, obligation)) return true;
        switch (a) {
            .entry => {},
            .store => |row| {
                const other = b.store;
                if (!try self.budget.equal(row.selector, other.selector) or !try self.budget.equal(row.view, other.view)) return false;
                try self.values(state, row.bases, other.bases); try self.values(state, row.values, other.values); try self.heap(state, row.previous, other.previous);
            },
            .copy => |row| { try self.pair(state, .node, row.value, b.copy.value); try self.heap(state, row.previous, b.copy.previous); },
            .call => |row| { if (row.completion != b.call.completion) return false; try self.pair(state, .call, row.call, b.call.call); },
            .receiver_action => return false, // No receiver-state certificate is claimed.
            .join => return false,
        }
        return true;
    }
    fn run(self: *Engine) Error!Inclusion {
        try self.budget.spend(self.fixed.len + 3);
        try self.addGraph(self.body); try self.addGraph(self.upper);
        // Every supplied graph was validated. Proof capability propagates only
        // through complete syntactic call dependencies, never actual/live arms.
        // An unrelated null/unknown graph therefore cannot taint this proof.
        var index: usize = 0;
        while (index < self.graphs.items.len) : (index += 1) {
            try self.budget.step();
            const graph = self.graphs.items[index].graph;
            for (graph.nodes) |node| { try self.budget.step(); if (node == .unknown) return .{ .pending = .unknown_data_origin }; }
            for (graph.calls) |call| {
                try self.budget.step();
                const row = (try self.fixedContract(call.function_id)).?;
                if (row.protocol_pending) return .{ .pending = .graph_protocol };
                const dependency = row.graph orelse return .{ .pending = .missing_fixed_call };
                try self.addGraph(dependency);
            }
        }
        // Least positive continuation closure is solved before coinduction.
        // Seedless data/heap unions remain empty relations, not dead control.
        try self.controlClosure();
        var first: Certificate = .{};
        if (try self.initial(&first)) |reason| return .{ .pending = reason };
        try self.append(Certificate, &self.search, first);
        while (self.search.pop()) |saved| {
            try self.budget.step(); var state = saved; var failed = false;
            while (state.pending.pop()) |obligation| {
                try self.budget.step();
                switch (obligation.kind) {
                    .values => {
                        const right = try self.atoms(self.upper, obligation.right_refs);
                        const left = try self.atoms(self.body, obligation.left_refs);
                        for (left) |id| try self.choice(&state, .value_choice, id, right);
                    },
                    .value_choice, .heap_alternatives, .call_choice => {
                        const kind: TaskKind = switch (obligation.kind) { .value_choice => .node, .heap_alternatives => .heap, else => .call };
                        for (obligation.right_refs) |right| { try self.budget.step(); try self.fork(&state, kind, obligation.left, right); }
                        failed = true;
                    },
                    .heap_choice => {
                        const right = try self.heapAtoms(self.upper, obligation.right_refs, true);
                        const left = try self.heapAtoms(self.body, &.{obligation.left}, false);
                        for (left) |id| try self.choice(&state, .heap_alternatives, id, right);
                    },
                    .call => { failed = !try self.matchCall(&state, obligation); },
                    .node => { failed = !try self.matchNode(&state, obligation); },
                    .heap => { failed = !try self.matchHeap(&state, obligation); },
                }
                if (failed) break;
            }
            if (!failed) return .{ .covered = {} };
        }
        return .{ .pending = .no_structural_certificate };
    }
};

// This boundary checks graph ownership and complete fixed-directory membership.
// The enclosing publication reader must separately admit scope/schema/group
// identity. Every function is bound to its immutable signature and optional
// fixed graph; null grants no data proof and is never replaced by a body graph.
pub fn covered(allocator: std.mem.Allocator, directory: *const model.Directory, function_id: Symbol, body: *const Graph, fixed: []const FixedContract, budget: *Budget) Error!Inclusion {
    try model.validateDirectory(allocator, directory, budget);
    if (fixed.len != directory.functions.len) return error.InvalidReference;
    var arena = std.heap.ArenaAllocator.init(allocator); defer arena.deinit();
    const workspace = arena.allocator();
    try budget.spend(fixed.len + 1);
    const validated = try workspace.alloc(ValidatedContract, fixed.len);
    var protocol_pending = false;
    var upper_validation: model.Validation = .valid;
    var selected = false;
    var upper: ?*const Graph = null;
    for (fixed, directory.functions, 0..) |row, function, index| {
        try budget.step();
        if (!try budget.equal(row.function_id, function.id)) return error.InvalidOrder;
        const validation: model.Validation = if (row.graph) |graph| try model.validateGraph(allocator, directory, row.function_id, graph, budget) else .valid;
        const pending = validation == .pending;
        validated[index] = .{ .function_id = row.function_id, .graph = row.graph, .protocol_pending = pending };
        if (try budget.equal(row.function_id, function_id)) {
            selected = true; upper = row.graph; protocol_pending = pending;
            upper_validation = validation;
        }
    }
    if (!selected) return error.InvalidReference;
    const body_validation = try model.validateGraph(allocator, directory, function_id, body, budget);
    if (body_validation == .pending) protocol_pending = true;
    const bound = upper orelse return .{ .pending = .missing_return_graph };
    if (protocol_pending) {
        // Only the unsupported semantic frame interpretation can be bypassed
        // by a complete identity simulation. Activation/metadata/protocol
        // failures remain Pending after ALL supplied graphs were validated.
        if (upper_validation == .pending and upper_validation.pending != .construction_frame) return .{ .pending = .graph_protocol };
        if (body_validation == .pending and body_validation.pending != .construction_frame) return .{ .pending = .graph_protocol };
        const function = try model.findFunction(directory, function_id, budget);
        if (!function.environment_metadata_complete or (function.kind != .source and function.kind != .method and function.kind != .construction_body)) return .{ .pending = .graph_protocol };
        if (function.construction) |role| if (!try explicitConstruction(directory, role.id, budget)) return .{ .pending = .graph_protocol };
        // The initial subset is call-free. Thus its complete fixed dependency
        // closure is the selected graph, and no null/unknown callee or implicit
        // activation is silently treated as the same invocation.
        if (body.calls.len != 0 or bound.calls.len != 0) return .{ .pending = .graph_protocol };
        for ([_]*const Graph{ body, bound }) |graph| {
            try budget.spend(graph.nodes.len);
            for (graph.nodes) |node| {
                try budget.step();
                if (node == .unknown) return .{ .pending = .unknown_data_origin };
                if (node == .receiver_frame and !try explicitConstruction(directory, node.receiver_frame.construction, budget)) return .{ .pending = .graph_protocol };
                // A constructor's frame Pending can precede (and therefore
                // mask) a referenced Code/Env metadata Pending in the reader.
                switch (node) {
                    inline .code, .environment_component => |row| if (!(try model.findFunction(directory, row.function_id, budget)).environment_metadata_complete) return .{ .pending = .graph_protocol },
                    else => {},
                }
            }
        }
        if (try exactEquation(Graph, body.*, bound.*, budget)) return .covered;
        return .{ .pending = .receiver_no_exact_certificate };
    }
    var engine: Engine = .{ .allocator = workspace, .budget = budget, .body = body, .upper = bound, .fixed = validated };
    return engine.run();
}
