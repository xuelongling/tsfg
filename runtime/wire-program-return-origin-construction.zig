// SPDX-License-Identifier: MIT
// Canonical symbolic interpretation of the admitted immutable Graph5 subset.
// No Actual tags, Source provenance, dynamic activation or permission is made.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const Ref = model.Ref;
const Budget = model.Budget;
const Error = model.Error;
pub const Category = enum { object, @"undefined", other };
// Borrowed original directory IDs derived from ALL final current entrances.
// Only an actually proved unbound root with known newTarget is representable.
pub const Entry = struct {
    function_id: model.Symbol, construction: model.Symbol, new_target: model.Symbol,
    // Original FieldIDs with BOTH a native storage join AND ALL current SSA
    // store payloads independently proved native by the real exact-body
    // consumer. Not a Graph view inference, values, tags or physical offsets.
    scalar_fields: []const model.Symbol = &.{},
};
pub const Atom = struct {
    source: union(enum) { node: Ref, allocation: Ref, language_error: Ref },
    category: Category,
};
pub const Pending = enum { entry_state, fixed_call, data_protocol, heap_protocol, unknown_origin, parent_activation, frame_activation, scalar_initialization };
pub const Initialization = struct { store: Ref, base: Atom, value: Atom };
pub const FrameSummary = struct {
    construction: ?model.Symbol = null, new_target: ?model.Symbol = null, parent: ?Ref = null,
    bound: []const Atom = &.{}, may_unbound: bool = false,
};
pub const Analysis = struct {
    arena: std.heap.ArenaAllocator,
    pending: ?Pending = null,
    normal: []const Atom = &.{}, language: []const Atom = &.{},
    normal_live: bool = false, language_live: bool = false,
    frames: []const FrameSummary = &.{},
    // Actual live symbolic prefix stores, including language/nonterminating
    // prefixes. StoreRef retains original selector/view/control/previous heap.
    initializations: []const Initialization = &.{},
    // Control-only results borrow this arena; they confer no heap/field proof.
    controls: []const bool = &.{}, action_results: []const []const Atom = &.{},
    pub fn deinit(self: *Analysis) void { self.arena.deinit(); }
};
const Atoms = std.ArrayListUnmanaged(Atom);
const Refs = std.ArrayListUnmanaged(Ref);
const Initializations = std.ArrayListUnmanaged(Initialization);
const Fact = struct { atoms: Atoms = .empty, frames: Refs = .empty };
const Binding = struct { unbound: bool = true, atoms: Atoms = .empty };
const World = struct { live: bool = false, bindings: []Binding, initializations: Initializations = .empty };
const Frame = struct { role: ?*const model.Construction = null, new_target: ?model.Symbol = null, parent: ?Ref = null };

// Follow only literal provenance, independently of join/gate static views.
// Bounded iterative closure: cycles without a literal seed prove nothing.
fn nativeLiterals(a:std.mem.Allocator,directory:*const model.Directory,graph:*const model.Graph,roots:[]const Ref,budget:*Budget) Error!bool {
    try budget.spend(graph.nodes.len*2+1);
    const seen=try a.alloc(bool,graph.nodes.len); @memset(seen,false);
    const pending=try a.alloc(Ref,graph.nodes.len); var count:usize=0; var cursor:usize=0; var literal=false;
    for(roots) |id| { try budget.step(); if(!seen[id]) { seen[id]=true; pending[count]=id; count+=1; } }
    while(cursor<count) : (cursor+=1) {
        try budget.step(); switch(graph.nodes[pending[cursor]]) {
            .literal=>|row|{
                if(row.category!=.other or row.@"type"==null)return false;
                const id=row.@"type".?; try budget.lookup(directory.types.len,id.len); var lo:usize=0; var hi=directory.types.len; var scalar=false;
                while(lo<hi) { const mid=lo+(hi-lo)/2; switch(std.mem.order(u8,directory.types[mid].id,id)){.lt=>lo=mid+1,.gt=>hi=mid,.eq=>{scalar=directory.types[mid].kind==.scalar;break;}} }
                if(!scalar)return false; literal=true;
            },
            inline .join,.gate=>|row|for(row.inputs) |id| { try budget.step(); if(!seen[id]) { seen[id]=true; pending[count]=id; count+=1; } },
            else=>return false,
        }
    }
    return literal;
}
const Engine = struct {
    allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget,
    values: []Fact, worlds: []World, controls: []bool, frames: []Frame, results: []Atoms,
    input: ?Ref = null,
    changed: bool = false, pending: ?Pending = null, control_only: bool = false,
    fn insert(self: *Engine, comptime T: type, into: *std.ArrayListUnmanaged(T), value: T) Error!bool {
        for (into.items) |old| { try self.budget.step(); if (std.meta.eql(old, value)) return false; }
        try self.budget.step();
        if (into.items.len == into.capacity) try self.budget.spend(into.items.len + 1);
        try into.append(self.allocator, value); return true;
    }
    fn add(self: *Engine, comptime T: type, into: *std.ArrayListUnmanaged(T), value: T) Error!void {
        self.changed = (try self.insert(T, into, value)) or self.changed;
    }
    fn atoms(self: *Engine, into: *Atoms, source: []const Atom) Error!void {
        for (source) |atom| try self.add(Atom, into, atom);
    }
    fn refs(self: *Engine, into: *Refs, source: []const Ref) Error!void {
        for (source) |id| try self.add(Ref, into, id);
    }
    fn initializations(self:*Engine,into:*Initializations,source:[]const Initialization) Error!void {
        for(source) |*row| { try self.budget.spend(3); try self.add(Initialization,into,row.*); }
    }
    fn construction(self: *Engine, id: model.Symbol) Error!*const model.Construction {
        for (self.directory.constructions) |*row| { try self.budget.step(); if (try self.budget.equal(row.id, id)) return row; }
        return error.InvalidReference;
    }
    fn merge(self: *Engine, into: *World, from: *const World, frame: ?Ref, replacement: ?[]const Atom, unbound: ?bool) Error!void {
        try self.budget.step();
        if (!from.live) return;
        const first = !into.live;
        if (first) { into.live = true; self.changed = true; }
        for (into.bindings, from.bindings, 0..) |*target, *source, index| {
            try self.budget.step(); const selected = frame != null and frame.? == index;
            const absent = if (selected and unbound != null) unbound.? else source.unbound;
            const next = if (first) absent else target.unbound or absent;
            if (target.unbound != next) { target.unbound = next; self.changed = true; }
            try self.atoms(&target.atoms, if (selected and replacement != null) replacement.? else source.atoms.items);
        }
        try self.initializations(&into.initializations,from.initializations.items);
    }
    fn storeReady(self:*Engine,row:@FieldType(model.Heap,"store")) Error!bool {
        const frame=self.input orelse return false; const before=&self.worlds[row.previous].bindings[frame];
        if(before.unbound or before.atoms.items.len==0 or row.bases.len==0 or row.values.len==0)return false;
        for(row.bases) |id| {
            try self.budget.step(); const value=&self.values[id]; if(value.frames.items.len!=0 or value.atoms.items.len==0)return false;
            for(value.atoms.items) |atom| {
                try self.budget.step(); if(atom.category!=.object or atom.source!=.allocation or atom.source.allocation!=frame)return false;
                var bound=false; for(before.atoms.items) |old| { try self.budget.step(); if(std.meta.eql(old,atom)) { bound=true; break; } }
                if(!bound)return false;
            }
        }
        for(row.values) |id| {
            try self.budget.step(); const value=&self.values[id]; if(value.frames.items.len!=0 or value.atoms.items.len==0)return false;
            for(value.atoms.items) |atom| { try self.budget.step(); if(atom.category!=.other or atom.source!=.node or self.graph.nodes[atom.source.node]!=.literal)return false; }
        }
        return true;
    }
    fn initialize(self:*Engine,index:Ref,row:@FieldType(model.Heap,"store")) Error!void {
        if(!self.controls[row.control] or !self.worlds[row.previous].live or !try self.storeReady(row))return;
        try self.merge(&self.worlds[index],&self.worlds[row.previous],null,null,null);
        for(row.bases) |base| { try self.budget.step(); for(self.values[base].atoms.items) |object| {
            try self.budget.step(); for(row.values) |value| { try self.budget.step(); for(self.values[value].atoms.items) |atom| {
                try self.budget.spend(4); try self.add(Initialization,&self.worlds[index].initializations,.{.store=index,.base=object,.value=atom});
            } }
        } }
    }
    fn outcome(self: *Engine, index: Ref, source: *const World, frame: Ref, values: []const Atom, replacement: ?[]const Atom, unbound: ?bool) Error!void {
        try self.merge(&self.worlds[index], source, frame, replacement, unbound);
        try self.atoms(&self.results[index], values);
    }
    fn action(self: *Engine, index: Ref, row: @FieldType(model.Heap, "receiver_action")) Error!void {
        if (!self.controls[row.control] or !self.worlds[row.previous].live) return;
        var selected: Atoms = .empty;
        var has_undefined = row.operands.len == 0; var has_other = false;
        try self.budget.spend(row.operands.len);
        for (row.operands) |operand| for (self.values[operand].atoms.items) |atom| {
            try self.budget.step(); switch (atom.category) {
                .object => { _ = try self.insert(Atom, &selected, atom); },
                .@"undefined" => has_undefined = true, .other => has_other = true,
            }
        };
        try self.budget.spend(row.frames.len);
        for (row.frames) |operand| for (self.values[operand].frames.items) |id| {
            try self.budget.step(); const role = self.frames[id].role orelse continue;
            const before = &self.worlds[row.previous].bindings[id]; const normal = row.completion == .normal;
            const source = &self.worlds[row.previous];
            const failure = [_]Atom{.{ .source = .{ .language_error = index }, .category = .object }};
            switch (row.action) {
                .allocate => if (normal) {
                    const value = [_]Atom{.{ .source = .{ .allocation = id }, .category = .object }};
                    try self.outcome(index, source, id, &value, null, null);
                },
                .bind => {
                    if (normal and before.unbound and selected.items.len != 0) try self.outcome(index, source, id, selected.items, selected.items, false);
                    if (!normal and before.atoms.items.len != 0) try self.outcome(index, source, id, &failure, null, null);
                },
                .get => {
                    if (normal and before.atoms.items.len != 0) try self.outcome(index, source, id, before.atoms.items, null, false);
                    if (!normal and before.unbound) try self.outcome(index, source, id, &failure, null, null);
                },
                .result => {
                    const fallback = has_undefined or (has_other and role.base == null);
                    if (normal) {
                        if (selected.items.len != 0) try self.outcome(index, source, id, selected.items, null, null);
                        if (fallback and before.atoms.items.len != 0) try self.outcome(index, source, id, before.atoms.items, null, false);
                    } else if ((has_other and role.base != null) or (fallback and before.unbound)) try self.outcome(index, source, id, &failure, null, null);
                },
            }
        };
    }
    fn run(self: *Engine) Error!void {
        while (true) {
            self.changed = false;
            for (self.graph.nodes, 0..) |node, index| {
                try self.budget.step(); const into = &self.values[index];
                switch (node) {
                    .receiver_input => try self.add(Ref, &into.frames, index),
                    .literal => |row| try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = if (row.category == .@"undefined") .@"undefined" else .other }),
                    .local => try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = .object }),
                    .code => |row| if (self.controls[row.control]) { try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = .object }); },
                    .unknown => if (self.control_only) {
                        inline for (std.meta.tags(Category)) |category| try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = category });
                    },
                    .parameter, .global, .nonowning => inline for (std.meta.tags(Category)) |category| {
                        try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = category });
                    },
                    inline .join, .gate => |row| {
                        if (@hasField(@TypeOf(row), "control")) if (!self.controls[row.control]) continue;
                        try self.budget.spend(row.inputs.len);
                        for (row.inputs) |input| { try self.atoms(&into.atoms, self.values[input].atoms.items); try self.refs(&into.frames, self.values[input].frames.items); }
                    },
                    .copy => |row| {
                        if (!self.controls[row.control]) continue;
                        for (row.bases) |base| {
                            try self.budget.step();
                            const value = &self.values[base];
                            if (value.frames.items.len != 0) { self.pending = .data_protocol; continue; }
                            for (value.atoms.items) |atom| {
                                try self.budget.step();
                                // Preserve category without turning a copy into
                                // an allocation, retained actual tag or alias.
                                try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = atom.category });
                            }
                        }
                    },
                    .receiver_frame => |row| {
                        if (!self.controls[row.control]) continue;
                        var parent: ?Ref = null;
                        if (row.parent) |parents| {
                            var choices: Refs = .empty;
                            try self.budget.spend(parents.len);
                            for (parents) |input| for (self.values[input].frames.items) |id| { _ = try self.insert(Ref, &choices, id); };
                            if (choices.items.len == 0) continue;
                            if (choices.items.len != 1) { self.pending = .parent_activation; continue; }
                            parent = choices.items[0]; if (self.frames[parent.?].role == null) continue;
                        }
                        if (self.frames[index].role == null) {
                            try self.budget.spend(4);
                            self.frames[index] = .{ .role = try self.construction(row.construction), .new_target = if (parent) |id| self.frames[id].new_target else row.new_target, .parent = parent };
                        }
                        try self.add(Ref, &into.frames, index);
                    },
                    .receiver_value => |row| try self.atoms(&into.atoms, self.results[row.action].items),
                    else => unreachable, // The complete subset check precedes work.
                }
            }
            for (self.graph.heaps, 0..) |heap, index| {
                try self.budget.step(); switch (heap) {
                    .entry => if (!self.worlds[index].live) { self.worlds[index].live = true; self.changed = true; },
                    .join => |row| for (row.inputs) |input| try self.merge(&self.worlds[index], &self.worlds[input], null, null, null),
                    .receiver_action => |row| try self.action(index, row),
                    .store => |row| try self.initialize(index,row),
                    else => unreachable,
                }
            }
            for (self.graph.controls, 0..) |control, index| {
                try self.budget.step(); if (self.controls[index]) continue;
                const live = switch (control) {
                    .entry => true,
                    .join => |row| live: { for (row.inputs) |input| { try self.budget.step(); if (self.controls[input]) break :live true; } break :live false; },
                    .receiver_completion => |row| self.worlds[row.action].live,
                    else => unreachable,
                };
                if (live) { self.controls[index] = true; self.changed = true; }
            }
            if (!self.changed) break;
        }
    }
};

// The owning model reader already checked every row/ref/carrier and creation
// activation gate using this same immutable directory and cumulative Budget.
// Optional entry carries only original IDs for an independently proved unbound
// root. It must belong to this graph's owning function and completed same-
// Context actual analysis. No raw payload, Source/FDI or permission is accepted.
fn analyzeImpl(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, entry: ?Entry, formal_function: ?model.Symbol) Error!Analysis {
    var result = Analysis{ .arena = std.heap.ArenaAllocator.init(allocator) }; errdefer result.deinit();
    if (!try model.receiverActivations(allocator, graph, budget)) { result.pending = .frame_activation; return result; }
    if (graph.calls.len != 0) { result.pending = .fixed_call; return result; }
    var input: ?Ref = null;
    for (graph.nodes,0..) |node,index| {
        try budget.step(); switch (node) {
            .receiver_input => { if((entry==null and formal_function==null) or input!=null) { result.pending = .entry_state; return result; } input=index; },
            .unknown => if (formal_function==null) { result.pending = .unknown_origin; return result; },
            .copy => if (formal_function==null) { result.pending = .data_protocol; return result; },
            .literal, .local, .parameter, .global, .nonowning, .join, .gate, .receiver_frame, .receiver_value => {},
            .code => |row| if (row.environment != null) { result.pending = .data_protocol; return result; },
            else => { result.pending = .data_protocol; return result; },
        }
    }
    const a = result.arena.allocator();
    // The proved immutable entry is shared by every store and its frame seed.
    const entry_function=if(input!=null)try model.findFunction(directory,formal_function orelse entry.?.function_id,budget) else null;
    for (graph.heaps) |heap| { try budget.step(); switch (heap) {
        .entry, .join, .receiver_action => {},
        .store=>|row|{
            if(entry==null or input==null or !row.initialize) { result.pending=.scalar_initialization; return result; }
            const function=entry_function.?;
            try budget.text(row.selector.len);
            if(function.construction==null or !try budget.equal(function.construction.?.owner,row.view) or !std.mem.startsWith(u8,row.selector,"field:")) { result.pending=.scalar_initialization; return result; }
            var owned=false;
            for(entry.?.scalar_fields) |id| { try budget.step(); if(try budget.equal(id,row.selector[6..])) { owned=true; break; } }
            if(!owned or !try nativeLiterals(a,directory,graph,row.values,budget)) { result.pending=.scalar_initialization; return result; }
        },
        else => { result.pending = .heap_protocol; return result; },
    } }
    try budget.spend(graph.nodes.len); const values = try a.alloc(Fact, graph.nodes.len); @memset(values, .{});
    try budget.spend(graph.nodes.len); const frames = try a.alloc(Frame, graph.nodes.len); @memset(frames, .{});
    try budget.spend(graph.controls.len); const controls = try a.alloc(bool, graph.controls.len); @memset(controls, false);
    try budget.spend(graph.heaps.len); const worlds = try a.alloc(World, graph.heaps.len);
    for (worlds) |*world| { try budget.spend(graph.nodes.len + 1); world.* = .{ .bindings = try a.alloc(Binding, graph.nodes.len) }; @memset(world.bindings, .{}); }
    try budget.spend(graph.heaps.len); const results = try a.alloc(Atoms, graph.heaps.len); @memset(results, .empty);
    var engine = Engine{ .allocator = a, .directory = directory, .graph = graph, .budget = budget, .values = values, .worlds = worlds, .controls = controls, .frames = frames, .results = results, .input = input, .control_only = formal_function != null };
    if(input) |id| {
      if (formal_function != null) {
        // The admitted construction-body interface owns an initially unbound
        // formal control frame. Ordinary Data inputs remain arbitrary, and this
        // seed is never an actual entrance, allocation or initialization proof.
        try budget.spend(5); const function = entry_function.?;
        if (function.kind != .construction_body or function.construction == null) { result.pending = .entry_state; return result; }
        const role = try engine.construction(function.construction.?.id);
        if (role.kind != .explicit or role.base != null or role.function_id == null or !try budget.equal(role.function_id.?, function.id)) { result.pending = .entry_state; return result; }
        try budget.spend(4); frames[id] = .{ .role = role, .new_target = role.owner, .parent = null };
    } else {
        try budget.spend(4); const seed=entry.?; const function=entry_function.?;
        const role=try engine.construction(seed.construction); try budget.spend(7);
        if(function.kind!=.construction_body or function.construction==null or role.kind!=.explicit or role.base!=null or
            !try budget.equal(function.construction.?.id,role.id) or !try budget.equal(seed.new_target,role.owner)) { result.pending=.entry_state; return result; }
        // Every heap entry starts from this observed unbound state. No frame
        // data/category is invented and no bound entry payload is supported.
        frames[id]=.{.role=role,.new_target=seed.new_target,.parent=null};
      }
    }
    try engine.run(); if (engine.pending) |reason| { result.pending = reason; return result; }
    for(graph.heaps) |heap| if(heap==.store) {
        try budget.step(); const row=heap.store; if(!controls[row.control])continue;
        if(!worlds[row.previous].live or !try engine.storeReady(row)) { result.pending=.scalar_initialization; return result; }
    };
    // A circular/uncomputed data equation is bottom, never a known-empty
    // payload. Only an actually absent operand vector denotes generated U.
    for (graph.heaps) |heap| if (heap == .receiver_action) {
        const row = heap.receiver_action; try budget.step();
        if (!controls[row.control] or !worlds[row.previous].live) continue;
        for (row.operands) |id| { try budget.step(); if (values[id].atoms.items.len == 0) { result.pending = .unknown_origin; return result; } }
    };
    var normal: Atoms = .empty; var language: Atoms = .empty;
    for (graph.exits.normal) |exit| {
        try budget.step(); if (controls[exit.control] and !worlds[exit.heap].live) { result.pending = .heap_protocol; return result; }
        result.normal_live = result.normal_live or (controls[exit.control] and worlds[exit.heap].live);
    }
    for (graph.exits.language) |exit| {
        try budget.step(); if (controls[exit.control] and !worlds[exit.heap].live) { result.pending = .heap_protocol; return result; }
        result.language_live = result.language_live or (controls[exit.control] and worlds[exit.heap].live);
    }
    if (result.normal_live) for (graph.normal) |id| {
        try budget.step(); if (values[id].atoms.items.len == 0) { result.pending = .unknown_origin; return result; }
        try engine.atoms(&normal, values[id].atoms.items);
    };
    if (result.language_live) for (graph.language) |id| {
        try budget.step(); if (values[id].atoms.items.len == 0) { result.pending = .unknown_origin; return result; }
        try engine.atoms(&language, values[id].atoms.items);
    };
    try budget.spend(graph.nodes.len); const summary = try a.alloc(FrameSummary, graph.nodes.len); @memset(summary, .{});
    for (frames, summary, 0..) |frame, *row, index| {
        try budget.step(); if (frame.role) |role| {
            try budget.spend(4); row.* = .{ .construction = role.id, .new_target = frame.new_target, .parent = frame.parent };
            var bound: Atoms = .empty;
            for (worlds) |world| { try budget.step(); if (!world.live) continue; row.may_unbound = row.may_unbound or world.bindings[index].unbound; try engine.atoms(&bound, world.bindings[index].atoms.items); }
            row.bound = bound.items;
        } else if (graph.nodes[index] == .receiver_frame and controls[graph.nodes[index].receiver_frame.control]) { result.pending = .frame_activation; return result; }
    }
    var writes:Initializations=.empty;
    // Include every live prefix, not just normal returns or language exits.
    // Histories are finite sets of original store/base/literal atoms; joins do
    // not invent counts, generations, last-value or physical alias evidence.
    for(worlds) |*world| { try budget.step(); if(world.live)try engine.initializations(&writes,world.initializations.items); }
    result.initializations=writes.items;
    result.normal = normal.items; result.language = language.items; result.frames = summary;
    if (formal_function != null) {
        try budget.spend(results.len); const action_results = try a.alloc([]const Atom, results.len);
        for (results, action_results) |value, *into| { try budget.step(); into.* = value.items; }
        try budget.spend(2); result.controls = controls; result.action_results = action_results;
    }
    return result;
}

// Original immutable certificate interpretation retains its stronger entry and
// native-field requirements. The effect-only boundary below does not relax it.
pub fn analyze(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, entry: ?Entry) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, entry, null);
}

// The graph is the complete current normalized constructor control projection,
// not its fixed own-return certificate. Unsupported calls and data/heap forms
// retain Pending; callers must keep complete callee uppers independently.
pub fn analyzeControls(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, function_id: model.Symbol) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, null, function_id);
}
