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
const receiver_domain = @import("wire-program-return-origin-construction.zig");

pub const FixedContract = struct { function_id: Symbol, graph: ?*const Graph, complete: ?*const receiver_domain.FixedFunction = null };
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

fn certificateConstruction(directory: *const model.Directory, id: Symbol, budget: *Budget) Error!bool {
    try budget.spend(directory.constructions.len);
    for (directory.constructions) |row| {
        try budget.step();
        if (try budget.equal(row.id, id)) return row.kind == .explicit or row.kind == .implicit_base;
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
                if (row.initialize != other.initialize) return false;
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


// A strict finite equation correspondence for the checked call-free receiver
// protocol. The existing construction Engine supplies formal completion facts;
// this object only pairs original Ref/site names and checks every core row.
const ReceiverCertificate = struct {
    const Kind = enum { value, heap, control, call };
    const View = union(enum) { id: Ref, dead: void, pending: void };
    const Pair = struct { kind: Kind, left: Ref, right: Ref };
    const Site = struct { left: Symbol, right: Symbol };
    allocator: std.mem.Allocator, budget: *Budget,
    graphs: [2]*const Graph, analyses: [2]*const receiver_domain.Analysis,
    maps: [2][4][]?Ref,
    pending: std.ArrayListUnmanaged(Pair) = .empty,
    sites: std.ArrayListUnmanaged(Site) = .empty,

    fn init(allocator: std.mem.Allocator, budget: *Budget, body_graph: *const Graph, upper_graph: *const Graph, body_analysis: *const receiver_domain.Analysis, upper_analysis: *const receiver_domain.Analysis) Error!ReceiverCertificate {
        var result = ReceiverCertificate{ .allocator = allocator, .budget = budget, .graphs = .{ body_graph, upper_graph }, .analyses = .{ body_analysis, upper_analysis }, .maps = undefined };
        for (result.graphs, 0..) |graph, side| {
            const sizes = [_]usize{ graph.nodes.len, graph.heaps.len, graph.controls.len, graph.calls.len };
            for (sizes, 0..) |size, kind| {
                try budget.spend(size + 1);
                result.maps[side][kind] = try allocator.alloc(?Ref, size);
                @memset(result.maps[side][kind], null);
            }
        }
        return result;
    }
    fn append(self: *ReceiverCertificate, comptime T: type, into: *std.ArrayListUnmanaged(T), value: T) Error!void {
        try self.budget.step();
        if (into.items.len == into.capacity) try self.budget.spend(into.items.len + 1);
        try into.append(self.allocator, value);
    }
    fn controlView(self: *ReceiverCertificate, side: usize, start: Ref) Error!View {
        const graph = self.graphs[side]; var id = start;
        if (!self.analyses[side].controls[id]) return .dead;
        for (0..graph.controls.len + 1) |_| {
            try self.budget.step(); switch (graph.controls[id]) {
                .join => |row| { if (row.inputs.len == 0) return .dead; if (row.inputs.len != 1) return .{ .id = id }; id = row.inputs[0]; },
                .entry, .receiver_completion, .call => return .{ .id = id },
            }
        }
        return .pending; // No seed may be invented for a cyclic wrapper.
    }
    fn valueView(self: *ReceiverCertificate, side: usize, start: Ref) Error!View {
        const graph = self.graphs[side]; var id = start; var terminal = false;
        for (0..graph.nodes.len + 1) |_| {
            try self.budget.step(); switch (graph.nodes[id]) {
                .join => |row| { if (row.inputs.len == 0) return .dead; if (row.inputs.len != 1) { terminal = true; break; } id = row.inputs[0]; },
                .gate => |row| {
                    const predicate = try self.controlView(side, row.control);
                    if (predicate == .dead) return .dead;
                    if (predicate == .pending or row.inputs.len != 1) return .pending;
                    id = row.inputs[0];
                },
                .receiver_value => |row| { if (self.analyses[side].action_results[row.action].len == 0) return .dead; terminal = true; break; },
                .call => |row| {
                    var completion = false; var live = false;
                    for (graph.heaps, 0..) |heap, index| {
                        try self.budget.step(); if (heap == .call and heap.call.call == row.call and heap.call.completion == row.completion) { completion = true; live = live or self.analyses[side].heap_live[index]; }
                    }
                    if (!completion) return .pending; if (!live) return .dead; terminal = true; break;
                },
                inline .copy, .receiver_frame, .environment_create, .environment_parent, .environment_component, .capture, .code, .projection => |row| { if (try self.controlView(side, row.control) != .id) return .pending; terminal = true; break; },
                .receiver_input, .parameter, .literal, .nonowning, .environment_input, .global, .local => { terminal = true; break; },
                else => return .pending,
            }
        }
        if (!terminal) return .pending;
        const core = graph.nodes[id]; var cursor = start;
        // A may-live control is never a universal predicate. An erased gate
        // must be entry, or exactly the intrinsic predicate of its input copy
        // or receiver action. Every other controlled gate is a core equation,
        // never erased merely because its predicate may be live.
        for (0..graph.nodes.len + 1) |_| {
            try self.budget.step(); if (cursor == id) return .{ .id = id };
            switch (graph.nodes[cursor]) {
                .join => |row| cursor = row.inputs[0],
                .gate => |row| {
                    const predicate = (try self.controlView(side, row.control)).id;
                    if (graph.controls[predicate] != .entry) {
                        const same = switch (core) {
                            inline .copy, .receiver_frame, .environment_create, .environment_parent, .environment_component, .capture, .code, .projection => |controlled| blk: { const intrinsic = try self.controlView(side, controlled.control); break :blk intrinsic == .id and intrinsic.id == predicate; },
                            .receiver_value => |value_row| graph.controls[predicate] == .receiver_completion and graph.controls[predicate].receiver_completion.action == value_row.action,
                            .call => |value_row| graph.controls[predicate] == .call and graph.controls[predicate].call.call == value_row.call and graph.controls[predicate].call.completion == value_row.completion,
                            else => false,
                        };
                        if (!same) return .{ .id = cursor };
                    }
                    cursor = row.inputs[0];
                },
                else => return .pending,
            }
        }
        return .pending;
    }
    fn heapView(self: *ReceiverCertificate, side: usize, start: Ref) Error!View {
        const graph = self.graphs[side]; var id = start;
        for (0..graph.heaps.len + 1) |_| {
            try self.budget.step(); switch (graph.heaps[id]) {
                .join => |row| { if (row.inputs.len == 0) return .dead; if (row.inputs.len != 1) return .{ .id = id }; id = row.inputs[0]; },
                .receiver_action => { if (self.analyses[side].action_results[id].len == 0) return .dead; return .{ .id = id }; },
                .store => |row| { if (try self.controlView(side, row.control) != .id) return .pending; return .{ .id = id }; },
                .copy => |row| { if (graph.nodes[row.value] != .copy) return .pending; if (try self.controlView(side, graph.nodes[row.value].copy.control) != .id) return .pending; return .{ .id = id }; },
                .entry => return .{ .id = id },
                .call => { if (!self.analyses[side].heap_live[id]) return .dead; return .{ .id = id }; },
            }
        }
        return .pending;
    }
    fn view(self: *ReceiverCertificate, side: usize, kind: Kind, id: Ref) Error!View {
        return switch (kind) { .value => self.valueView(side, id), .heap => self.heapView(side, id), .control => self.controlView(side, id), .call => .{ .id = id } };
    }
    fn pair(self: *ReceiverCertificate, kind: Kind, left: Ref, right: Ref) Error!bool {
        const a = try self.view(0, kind, left); const b = try self.view(1, kind, right);
        if (a == .pending or b == .pending) return false;
        if (a == .dead or b == .dead) return a == .dead and b == .dead;
        const left_map = self.maps[0][@intFromEnum(kind)]; const right_map = self.maps[1][@intFromEnum(kind)];
        try self.budget.spend(2);
        if (left_map[a.id]) |old| return old == b.id and right_map[b.id] != null and right_map[b.id].? == a.id;
        if (right_map[b.id] != null) return false;
        left_map[a.id] = b.id; right_map[b.id] = a.id;
        try self.append(Pair, &self.pending, .{ .kind = kind, .left = a.id, .right = b.id }); return true;
    }
    fn values(self: *ReceiverCertificate, left: []const Ref, right: []const Ref) Error!bool {
        var normalized: [2][]Ref = undefined; var counts = [_]usize{ 0, 0 };
        for ([_][]const Ref{ left, right }, 0..) |source, side| {
            try self.budget.spend(source.len + 1); normalized[side] = try self.allocator.alloc(Ref, source.len);
            for (source) |id| {
                try self.budget.step(); const resolved = try self.valueView(side, id);
                if (resolved == .pending) return false;
                if (resolved == .id) { normalized[side][counts[side]] = resolved.id; counts[side] += 1; }
            }
        }
        if (counts[0] != counts[1]) return false;
        for (normalized[0][0..counts[0]], normalized[1][0..counts[1]]) |a, b| if (!try self.pair(.value, a, b)) return false;
        return true;
    }
    fn site(self: *ReceiverCertificate, left: Symbol, right: Symbol) Error!bool {
        // Site spelling is a local name. Both directions must preserve its
        // identity class across the entire owned function, including copies
        // whose result is discarded; no fresh/alias claim comes from a name.
        for (self.sites.items) |row| {
            try self.budget.step(); const same_left = try self.budget.equal(row.left, left); const same_right = try self.budget.equal(row.right, right);
            if (same_left or same_right) return same_left and same_right;
        }
        try self.budget.text(left.len); try self.budget.text(right.len);
        try self.append(Site, &self.sites, .{ .left = left, .right = right }); return true;
    }
    fn scalar(self: *ReceiverCertificate, kind: Kind, left: Ref, right: Ref) Error!bool {
        try self.budget.step(); const a = self.graphs[0]; const b = self.graphs[1];
        return switch (kind) {
            .control => switch (a.controls[left]) { .entry => b.controls[right] == .entry, .receiver_completion => b.controls[right] == .receiver_completion, .join => b.controls[right] == .join, .call => b.controls[right] == .call },
            .value => blk: {
                const x = a.nodes[left]; const y = b.nodes[right];
                if (std.meta.activeTag(x) != std.meta.activeTag(y)) break :blk false;
                break :blk switch (x) {
                    .receiver_input, .parameter, .literal, .nonowning, .environment_input, .global, .local => try exactEquation(model.Value, x, y, self.budget),
                    .environment_create => |row| try self.budget.equal(row.layout, y.environment_create.layout) and (row.parent == null) == (y.environment_create.parent == null),
                    .environment_parent => |row| try self.budget.equal(row.layout, y.environment_parent.layout),
                    .environment_component => |row| try self.budget.equal(row.layout, y.environment_component.layout) and try self.budget.equal(row.function_id, y.environment_component.function_id),
                    .capture => |row| try self.budget.equal(row.@"type", y.capture.@"type") and try self.budget.equal(row.id, y.capture.id) and try self.budget.equal(row.layout, y.capture.layout),
                    .code => |row| try self.budget.equal(row.@"type", y.code.@"type") and try self.budget.equal(row.function_id, y.code.function_id) and (row.environment == null) == (y.code.environment == null),
                    .projection => |row| try self.budget.equal(row.@"type", y.projection.@"type") and try self.budget.equal(row.selector, y.projection.selector) and try self.budget.equal(row.view, y.projection.view),
                    inline .copy, .gate, .join => |row, tag| try exactEquation(?Symbol, row.@"type", @field(y, @tagName(tag)).@"type", self.budget),
                    .receiver_value => |row| try exactEquation(?Symbol, row.@"type", y.receiver_value.@"type", self.budget),
                    .call => |row| row.completion == y.call.completion and try exactEquation(?Symbol, row.@"type", y.call.@"type", self.budget),
                    // The reader joined this immutable construction ID to its
                    // complete kind/owner role in the shared Directory.
                    .receiver_frame => |row| try self.budget.equal(row.construction, y.receiver_frame.construction) and
                        try exactEquation(?Symbol, row.new_target, y.receiver_frame.new_target, self.budget) and
                        (row.parent == null) == (y.receiver_frame.parent == null),
                    else => false,
                };
            },
            .call => blk: {
                const x = a.calls[left]; const y = b.calls[right];
                break :blk try self.budget.equal(x.function_id, y.function_id) and x.arguments.len == y.arguments.len and (x.environment == null) == (y.environment == null) and (x.callee == null) == (y.callee == null) and (x.receiver == null) == (y.receiver == null);
            },
            .heap => blk: {
                const x = a.heaps[left]; const y = b.heaps[right];
                if (std.meta.activeTag(x) != std.meta.activeTag(y)) break :blk false;
                break :blk switch (x) {
                    .entry, .copy, .join => true,
                    .store => |row| row.initialize == y.store.initialize and try self.budget.equal(row.selector, y.store.selector) and try self.budget.equal(row.view, y.store.view),
                    .receiver_action => |row| row.action == y.receiver_action.action and row.completion == y.receiver_action.completion,
                    .call => |row| row.completion == y.call.completion,
                };
            },
        };
    }
    fn match(self: *ReceiverCertificate, obligation: Pair) Error!bool {
        if (!try self.scalar(obligation.kind, obligation.left, obligation.right)) return false;
        const a = self.graphs[0]; const b = self.graphs[1];
        switch (obligation.kind) {
            .value => switch (a.nodes[obligation.left]) {
                .receiver_input, .parameter, .literal, .nonowning, .environment_input, .global, .local => {},
                .environment_create => |row| {
                    const other = b.nodes[obligation.right].environment_create;
                    if (!try self.site(row.site, other.site) or !try self.pair(.control, row.control, other.control)) return false;
                    if (row.parent) |parent| if (!try self.values(parent, other.parent.?)) return false;
                },
                .environment_parent => |row| { const other = b.nodes[obligation.right].environment_parent; if (!try self.values(row.bases, other.bases) or !try self.pair(.control, row.control, other.control)) return false; },
                .environment_component => |row| { const other = b.nodes[obligation.right].environment_component; if (!try self.values(row.callee, other.callee) or !try self.pair(.control, row.control, other.control)) return false; },
                .capture => |row| {
                    const other = b.nodes[obligation.right].capture;
                    if (!try self.values(row.environment, other.environment) or !try self.pair(.heap, row.heap, other.heap) or !try self.pair(.control, row.control, other.control)) return false;
                },
                .code => |row| {
                    const other = b.nodes[obligation.right].code;
                    if (!try self.pair(.control, row.control, other.control)) return false;
                    if (row.environment) |environment| if (!try self.values(environment, other.environment.?)) return false;
                },
                .projection => |row| {
                    const other = b.nodes[obligation.right].projection;
                    if (!try self.values(row.bases, other.bases) or !try self.pair(.heap, row.heap, other.heap) or !try self.pair(.control, row.control, other.control)) return false;
                },
                .join => |row| {
                    const other = b.nodes[obligation.right].join;
                    if (row.inputs.len != other.inputs.len) return false;
                    // A phi is a core equation. Keep every incoming identity,
                    // including its control gate; no dead input is erased.
                    try self.budget.spend(row.inputs.len);
                    for (row.inputs, other.inputs) |left, right| {
                        try self.budget.step();
                        if (try self.valueView(0, left) != .id or try self.valueView(1, right) != .id) return false;
                        if (!try self.pair(.value, left, right)) return false;
                    }
                },
                .gate => |row| {
                    const other = b.nodes[obligation.right].gate;
                    if (!try self.pair(.control, row.control, other.control) or !try self.values(row.inputs, other.inputs)) return false;
                },
                .receiver_value => |row| { if (!try self.pair(.heap, row.action, b.nodes[obligation.right].receiver_value.action)) return false; },
                .call => |row| { if (!try self.pair(.call, row.call, b.nodes[obligation.right].call.call)) return false; },
                .receiver_frame => |row| {
                    const other = b.nodes[obligation.right].receiver_frame;
                    if (!try self.site(row.site, other.site) or !try self.pair(.control, row.control, other.control)) return false;
                    if (row.parent) |parent| if (!try self.values(parent, other.parent.?)) return false;
                },
                .copy => |row| {
                    const other = b.nodes[obligation.right].copy;
                    if (!try self.site(row.site, other.site) or !try self.values(row.bases, other.bases) or !try self.pair(.heap, row.heap, other.heap) or !try self.pair(.control, row.control, other.control)) return false;
                },
                else => return false,
            },
            .heap => switch (a.heaps[obligation.left]) {
                .entry => {},
                .join => |row| {
                    const other = b.heaps[obligation.right].join;
                    if (row.inputs.len != other.inputs.len) return false;
                    try self.budget.spend(row.inputs.len);
                    for (row.inputs, other.inputs) |left, right| {
                        try self.budget.step();
                        if (try self.heapView(0, left) != .id or try self.heapView(1, right) != .id) return false;
                        if (!try self.pair(.heap, left, right)) return false;
                    }
                },
                .call => |row| { if (!try self.pair(.call, row.call, b.heaps[obligation.right].call.call)) return false; },
                .copy => |row| { const other = b.heaps[obligation.right].copy; if (!try self.pair(.heap, row.previous, other.previous) or !try self.pair(.value, row.value, other.value)) return false; },
                .store => |row| {
                    const other = b.heaps[obligation.right].store;
                    if (!try self.pair(.heap, row.previous, other.previous) or !try self.pair(.control, row.control, other.control) or !try self.values(row.bases, other.bases) or !try self.values(row.values, other.values)) return false;
                },
                .receiver_action => |row| {
                    const other = b.heaps[obligation.right].receiver_action;
                    if (!try self.pair(.heap, row.previous, other.previous) or !try self.pair(.control, row.control, other.control) or !try self.values(row.frames, other.frames) or !try self.values(row.operands, other.operands)) return false;
                },
            },
            .call => {
                const row = a.calls[obligation.left]; const other = b.calls[obligation.right];
                if (!try self.site(row.site, other.site) or !try self.pair(.heap, row.heap, other.heap) or !try self.pair(.control, row.control, other.control)) return false;
                for (row.arguments, other.arguments) |left, right| { try self.budget.step(); if (!try self.values(left, right)) return false; }
                if (row.receiver) |left| if (!try self.values(left, other.receiver.?)) return false;
                if (row.environment) |left| if (!try self.values(left, other.environment.?)) return false;
                if (row.callee) |left| if (!try self.values(left, other.callee.?)) return false;
            },
            .control => switch (a.controls[obligation.left]) {
                .entry => {},
                .receiver_completion => |row| { if (!try self.pair(.heap, row.action, b.controls[obligation.right].receiver_completion.action)) return false; },
                .call => |row| { if (row.completion != b.controls[obligation.right].call.completion or !try self.pair(.call, row.call, b.controls[obligation.right].call.call)) return false; },
                .join => |row| {
                    const other = b.controls[obligation.right].join;
                    if (row.inputs.len != other.inputs.len) return false;
                    // Keep every alternative. A proved-dead edge cannot be
                    // erased into a universal seed by this finite subset.
                    try self.budget.spend(row.inputs.len);
                    for (row.inputs, other.inputs) |left, right| {
                        try self.budget.step();
                        if (!self.analyses[0].controls[left] or !self.analyses[1].controls[right]) return false;
                        if (!try self.pair(.control, left, right)) return false;
                    }
                },
            },
        }
        return true;
    }
    fn drain(self: *ReceiverCertificate) Error!bool {
        while (self.pending.pop()) |obligation| { try self.budget.step(); if (!try self.match(obligation)) return false; }
        return true;
    }
    fn exits(self: *ReceiverCertificate, completion: model.Completion) Error!bool {
        var selected: [2][]model.Exit = undefined; var counts = [_]usize{ 0, 0 };
        for (self.graphs, 0..) |graph, side| {
            const source = if (completion == .normal) graph.exits.normal else graph.exits.language;
            try self.budget.spend(source.len + 1); selected[side] = try self.allocator.alloc(model.Exit, source.len);
            for (source) |row| { try self.budget.step(); if (self.analyses[side].controls[row.control]) { selected[side][counts[side]] = row; counts[side] += 1; } }
        }
        if (counts[0] != counts[1]) return false;
        for (selected[0][0..counts[0]], selected[1][0..counts[1]]) |a, b| if (!try self.pair(.heap, a.heap, b.heap) or !try self.pair(.control, a.control, b.control)) return false;
        return self.values(if (completion == .normal) self.graphs[0].normal else self.graphs[0].language, if (completion == .normal) self.graphs[1].normal else self.graphs[1].language);
    }
    fn accesses(self: *ReceiverCertificate) Error!bool {
        var selected: [2][]model.Access = undefined; var counts = [_]usize{ 0, 0 };
        for (self.graphs, 0..) |graph, side| {
            try self.budget.spend(graph.accesses.len + 1); selected[side] = try self.allocator.alloc(model.Access, graph.accesses.len);
            for (graph.accesses) |row| { try self.budget.step(); if (self.analyses[side].controls[row.control]) { selected[side][counts[side]] = row; counts[side] += 1; } }
        }
        if (counts[0] != counts[1]) return false;
        for (selected[0][0..counts[0]], selected[1][0..counts[1]]) |a, b| if (a.flag != b.flag or !try self.pair(.control, a.control, b.control) or !try self.values(a.values, b.values)) return false;
        return true;
    }
    fn run(self: *ReceiverCertificate) Error!bool {
        if (!try self.exits(.normal) or !try self.exits(.language) or !try self.accesses() or !try self.drain()) return false;
        // Match all remaining core equations as well, including live prefixes
        // with no exit or an ignored result. Only a unique structural anchor
        // may extend the bijection; ambiguous alternatives remain Pending.
        while (true) {
            var remaining = false; var progress = false;
            for ([_]Kind{ .heap, .value, .control, .call }) |kind| {
                const left_map = self.maps[0][@intFromEnum(kind)]; const right_map = self.maps[1][@intFromEnum(kind)];
                for (left_map, 0..) |mapped, left| {
                    try self.budget.step(); const resolved = try self.view(0, kind, left);
                    if (resolved == .pending) return false;
                    if (resolved != .id or resolved.id != left or mapped != null) continue;
                    remaining = true; var candidate: ?Ref = null; var ambiguous = false;
                    for (right_map, 0..) |paired, right| {
                        try self.budget.step(); if (paired != null) continue;
                        const other = try self.view(1, kind, right);
                        if (other == .pending) return false;
                        if (other != .id or other.id != right or !try self.scalar(kind, left, right)) continue;
                        if (candidate != null) { ambiguous = true; break; }
                        candidate = right;
                    }
                    if (candidate == null) return false;
                    if (ambiguous) continue;
                    if (!try self.pair(kind, left, candidate.?) or !try self.drain()) return false;
                    progress = true;
                }
            }
            if (!remaining) break;
            if (!progress) return false;
        }
        // The reverse pass prevents an extra upper row/name from hiding a
        // missing current-body equation, Heap.copy or control/exit obligation.
        for ([_]Kind{ .heap, .value, .control, .call }) |kind| for (self.maps[1][@intFromEnum(kind)], 0..) |mapped, id| {
            try self.budget.step(); const resolved = try self.view(1, kind, id);
            if (resolved == .pending) return false;
            if (resolved == .id and resolved.id == id and mapped == null) return false;
        };
        return true;
    }
};

fn receiverCovered(allocator: std.mem.Allocator, directory: *const model.Directory, function_id: Symbol, body_graph: *const Graph, upper_graph: *const Graph, fixed: []const FixedContract, budget: *Budget) Error!bool {
    var complete: std.ArrayListUnmanaged(receiver_domain.FixedFunction) = .empty;
    if (body_graph.calls.len != 0 or upper_graph.calls.len != 0) {
        try budget.spend(fixed.len + 1); try complete.ensureTotalCapacityPrecise(allocator, fixed.len);
        for (fixed) |row| { try budget.step(); const original = row.complete orelse return false; complete.appendAssumeCapacity(original.*); }
    }
    const input = receiver_domain.FormalInput{ .function_id = function_id, .fixed = complete.items };
    // Same formal receiver protocol/Engine as return interpretation. No
    // selected actual state or effect proof enters this complete certificate.
    var body_analysis = try receiver_domain.analyzeReturns(allocator, directory, body_graph, budget, input); defer body_analysis.deinit();
    if (body_analysis.pending != null) return false;
    var upper_analysis = try receiver_domain.analyzeReturns(allocator, directory, upper_graph, budget, input); defer upper_analysis.deinit();
    if (upper_analysis.pending != null) return false;
    var certificate = try ReceiverCertificate.init(allocator, budget, body_graph, upper_graph, &body_analysis, &upper_analysis);
    return certificate.run();
}

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
        if (function.construction) |role| if (!try certificateConstruction(directory, role.id, budget)) return .{ .pending = .graph_protocol };
        // The initial subset is call-free. Thus its complete fixed dependency
        // closure is the selected graph, and no null/unknown callee or
        // uninterpreted frame activation is treated as the same invocation.
        // Constructor calls require their complete original fixed source rows
        // before either graph can acquire formal receiver completion facts.
        if (body.calls.len != 0 or bound.calls.len != 0) for (fixed) |row| { try budget.step(); if (row.complete == null) return .{ .pending = .graph_protocol }; };
        for ([_]*const Graph{ body, bound }) |graph| {
            try budget.spend(graph.nodes.len);
            for (graph.nodes) |node| {
                try budget.step();
                if (node == .unknown) return .{ .pending = .unknown_data_origin };
                if (node == .receiver_frame and !try certificateConstruction(directory, node.receiver_frame.construction, budget)) return .{ .pending = .graph_protocol };
                // A constructor's frame Pending can precede (and therefore
                // mask) a referenced Code/Env metadata Pending in the reader.
                switch (node) {
                    inline .code, .environment_component => |row| if (!(try model.findFunction(directory, row.function_id, budget)).environment_metadata_complete) return .{ .pending = .graph_protocol },
                    else => {},
                }
            }
        }
        if (try exactEquation(Graph, body.*, bound.*, budget)) return .covered;
        if (try receiverCovered(workspace, directory, function_id, body, bound, fixed, budget)) return .covered;
        return .{ .pending = .receiver_no_exact_certificate };
    }
    var engine: Engine = .{ .allocator = workspace, .budget = budget, .body = body, .upper = bound, .fixed = validated };
    return engine.run();
}
