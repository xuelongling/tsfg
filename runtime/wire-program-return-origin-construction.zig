// SPDX-License-Identifier: MIT
// Canonical symbolic interpretation of the admitted immutable Graph5 subset.
// No Actual tags, Source provenance, dynamic activation or permission is made.
const std = @import("std");
const model = @import("wire-program-return-origin-model.zig");
const publication = @import("wire-program-publication.zig");
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
    // A foreign birth retains its owning analysis namespace, never a bare Ref
    // borrowed as a caller node. Child analyses are stable parent-arena objects.
    source: union(enum) { node: Ref, allocation: Ref, language_error: Ref, scoped_allocation: struct { analysis: *const Analysis, frame: Ref, completion: model.Completion } },
    category: Category,
};
pub const Pending = enum { entry_state, fixed_call, fixed_contract, fixed_completion, fixed_origin, call_entry, data_protocol, heap_protocol, unknown_origin, parent_activation, frame_activation, scalar_initialization };
pub const PublicationContract = @typeInfo(@FieldType(publication.Publication, "contracts")).pointer.child;
pub const ScopeFunction = @typeInfo(@FieldType(publication.StableScope, "functions")).pointer.child;
// Borrow the complete already-owned immutable rows. No narrowed graph-only
// upper, verification marker or selected actual state is accepted here.
pub const FixedFunction = struct { function_id: model.Symbol, contract: *const PublicationContract, declaration: *const ScopeFunction, initialization_fields: ?[]const model.Symbol = null };
pub const FormalInput = struct { function_id: model.Symbol, fixed: []const FixedFunction = &.{} };
pub const ExitBinding = struct { live: bool = false, unbound: bool = false, atoms: []const Atom = &.{}, missing_fields: ?[]const model.Symbol = null };
pub const InputExits = struct { input: Ref, normal: ExitBinding = .{}, language: ExitBinding = .{} };
pub const CallFact = struct { caller_graph: *const model.Graph, call: Ref, receiver: Ref, graph: *const model.Graph, input: Ref, fixed: *const FixedFunction, analysis: *const Analysis, arguments: []const []const Atom };
pub const Initialization = struct { store: Ref, base: Atom, value: Atom };
pub const FrameSummary = struct {
    // A formal receiver's null new_target is a universal compatible-target
    // parameter, not an owner/leaf choice or a known Actual allocation type.
    construction: ?model.Symbol = null, new_target: ?model.Symbol = null, parent: ?Ref = null,
    bound: []const Atom = &.{}, may_unbound: bool = false,
    // Per-completion MUST facts over ALL final live exits. The prefix MAY
    // summary above is deliberately insufficient for a managed Data argument.
    normal: ExitBinding = .{}, language: ExitBinding = .{},
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
    // Shared formal receiver continuation facts. Content interpreters borrow
    // these worlds' liveness; they do not repeat the receiver state machine.
    heap_live: []const bool = &.{},
    // Child Analysis objects and ALL their arena chunks belong to this parent
    // arena. calls[].analysis is a read-only borrowed view: never separately
    // deinit it or allocate through its arena after this parent result moves.
    // Destroying only this owning arena releases the entire call tree once.
    // Graphs/contracts/directory rows remain borrowed and outlive this result.
    calls: []const CallFact = &.{}, input_exits: ?InputExits = null,
    pub fn deinit(self: *Analysis) void { self.arena.deinit(); }
};
const Atoms = std.ArrayListUnmanaged(Atom);
const Refs = std.ArrayListUnmanaged(Ref);
const Initializations = std.ArrayListUnmanaged(Initialization);
const Fact = struct { atoms: Atoms = .empty, frames: Refs = .empty };
const Binding = struct { unbound: bool = true, atoms: Atoms = .empty };
const Obligation = struct { frame: Ref, field: model.Symbol };
const Completed = struct { frame: Ref, fields: []const model.Symbol };
const World = struct { live: bool = false, bindings: []Binding, missing: []bool, initializations: Initializations = .empty };
const Frame = struct { role: ?*const model.Construction = null, new_target: ?model.Symbol = null, parent: ?Ref = null };

fn construction(directory: *const model.Directory, id: model.Symbol, budget: *Budget) Error!*const model.Construction {
    for (directory.constructions) |*row| { try budget.step(); if (try budget.equal(row.id, id)) return row; }
    return error.InvalidReference;
}

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
const PreparedCall = struct { call: Ref, analysis: *const Analysis };
const Engine = struct {
    allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget,
    values: []Fact, worlds: []World, controls: []bool, frames: []Frame, results: []Atoms,
    // Only callFact can supply these paid category snapshots after proving
    // original caller refs. Public formal entry points cannot narrow Data.
    arguments: []const []const Atom = &.{}, prepared: ?[]const PreparedCall = null,
    input: ?Ref = null, obligations: []const Obligation = &.{},
    changed: bool = false, pending: ?Pending = null, control_only: bool = false, effect_origins: bool = false,
    formal_environments: bool = false, formal_input: ?FormalInput = null,
    calls: std.ArrayListUnmanaged(CallFact) = .empty, call_results: [][2]Atoms = &.{}, call_live: [][2]bool = &.{},
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
    fn merge(self: *Engine, into: *World, from: *const World, frame: ?Ref, replacement: ?[]const Atom, unbound: ?bool, completed: ?Completed) Error!void {
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
        // MAY missing fields are the complement of MUST initialized fields.
        // Every live predecessor contributes, including late loop/join edges.
        for (self.obligations, from.missing, into.missing) |obligation, absent, *target| {
            try self.budget.step(); var cleared = false;
            if (completed) |proof| if (proof.frame == obligation.frame) {
                for (proof.fields) |field| { try self.budget.step(); if (try self.budget.equal(field, obligation.field)) { cleared = true; break; } }
            };
            if (absent and !cleared and !target.*) { target.* = true; self.changed = true; }
        }
        try self.initializations(&into.initializations,from.initializations.items);
    }
    fn storeReady(self:*Engine,row:@FieldType(model.Heap,"store")) Error!bool {
        if(self.input==null or row.bases.len==0 or row.values.len==0)return false;
        for(row.bases) |id| {
            try self.budget.step(); const value=&self.values[id]; if(value.frames.items.len!=0 or value.atoms.items.len==0)return false;
            for(value.atoms.items) |atom| {
                try self.budget.step(); if(atom.category!=.object or atom.source!=.allocation)return false;
                try self.budget.spend(4); const frame=atom.source.allocation;
                const role=self.frames[frame].role orelse return false;
                if(frame!=self.input.? and self.frames[frame].parent==null)return false;
                if(!try self.budget.equal(row.view,role.owner))return false;
                const before=&self.worlds[row.previous].bindings[frame];
                if(before.unbound or before.atoms.items.len==0)return false;
                var bound=false; for(before.atoms.items) |old| { try self.budget.step(); if(std.meta.eql(old,atom)) { bound=true; break; } }
                if(!bound)return false;
            }
        }
        for(row.values) |id| {
            try self.budget.step(); const value=&self.values[id]; if(value.frames.items.len!=0 or value.atoms.items.len==0)return false;
            if (!self.effect_origins) for(value.atoms.items) |atom| { try self.budget.step(); if(atom.category!=.other or atom.source!=.node or self.graph.nodes[atom.source.node]!=.literal)return false; };
        }
        return true;
    }
    fn initialize(self:*Engine,index:Ref,row:@FieldType(model.Heap,"store")) Error!void {
        if(!self.controls[row.control] or !self.worlds[row.previous].live or !try self.storeReady(row))return;
        // A store through alternative receiver allocations is not a MUST write
        // to any single one of them, even when each alternative is bound.
        var selected: ?Ref = null; var single = true;
        for (row.bases) |base| { try self.budget.step(); for (self.values[base].atoms.items) |atom| {
            try self.budget.step(); const frame = atom.source.allocation;
            if (selected) |old| { if (old != frame) single = false; } else selected = frame;
        } }
        const fields = [_]model.Symbol{row.selector[6..]};
        try self.merge(&self.worlds[index],&self.worlds[row.previous],null,null,null,if (single and selected != null) .{ .frame = selected.?, .fields = &fields } else null);
        for(row.bases) |base| { try self.budget.step(); for(self.values[base].atoms.items) |object| {
            try self.budget.step(); for(row.values) |value| { try self.budget.step(); for(self.values[value].atoms.items) |atom| {
                try self.budget.spend(4); try self.add(Initialization,&self.worlds[index].initializations,.{.store=index,.base=object,.value=atom});
            } }
        } }
    }
    fn outcome(self: *Engine, index: Ref, source: *const World, frame: Ref, values: []const Atom, replacement: ?[]const Atom, unbound: ?bool) Error!void {
        try self.merge(&self.worlds[index], source, frame, replacement, unbound, null);
        try self.atoms(&self.results[index], values);
    }
    fn fixedFunction(self: *Engine, id: model.Symbol) Error!?*const FixedFunction {
        const input = self.formal_input orelse return null;
        if (input.fixed.len != self.directory.functions.len) return null;
        var selected: ?*const FixedFunction = null;
        for (input.fixed, self.directory.functions) |*row, function| {
            try self.budget.step();
            if (!try self.budget.equal(row.function_id, function.id)) return null;
            if (try self.budget.equal(row.function_id, id)) selected = row;
        }
        return selected;
    }
    // Only the original caller state can prove that managed Data already
    // denotes an initialized, bound allocation. A declared Ref view alone
    // grants no category, object tag, receiver binding or field proof.
    fn referenceArgument(self: *Engine, argument: []const Ref, expected: model.Symbol, heap: Ref) Error!bool {
        var found = false;
        for (argument) |id| {
            try self.budget.step(); const value = self.values[id];
            if (value.frames.items.len != 0 or value.atoms.items.len == 0) return false;
            for (value.atoms.items) |atom| {
                try self.budget.step(); if (atom.category != .object) return false;
                if (atom.source == .scoped_allocation) {
                    const source = atom.source.scoped_allocation;
                    // A foreign birth uses its original Analysis/frame and
                    // its own completion's MUST initialization. Equal frame
                    // numbers never let another completion license this one.
                    try self.budget.step();
                    if (source.analysis.pending != null or source.frame >= source.analysis.frames.len) return false;
                    const frame = source.analysis.frames[source.frame];
                    const exit = if (source.completion == .normal) frame.normal else frame.language;
                    const role = try construction(self.directory, frame.construction orelse return false, self.budget);
                    if (role.kind != .explicit or role.base != null or frame.parent != null or frame.new_target == null or
                        !try self.budget.equal(frame.new_target.?, role.owner)) return false;
                    const fixed = try self.fixedFunction(role.function_id orelse return false) orelse return false;
                    _ = fixed.initialization_fields orelse return false;
                    var reference = false;
                    for (self.directory.types) |row| { try self.budget.step(); if (try self.budget.equal(row.id, frame.new_target.?)) { reference = row.kind == .reference; break; } }
                    if (!reference or !exit.live or exit.unbound or exit.missing_fields == null or exit.missing_fields.?.len != 0) return false;
                    var bound = false;
                    for (exit.atoms) |old| { try self.budget.step(); if (old.category == .object and old.source == .allocation and old.source.allocation == source.frame) bound = true; }
                    if (!bound) return false;
                    found = true; continue;
                }
                if (atom.source != .allocation) return false;
                const frame = atom.source.allocation; const role = self.frames[frame].role orelse return false;
                if (role.base != null or self.frames[frame].parent != null or self.frames[frame].new_target == null or
                    !try self.budget.equal(self.frames[frame].new_target.?, expected) or !try self.budget.equal(role.owner, expected)) return false;
                const fixed = try self.fixedFunction(role.function_id orelse return false) orelse return false;
                _ = fixed.initialization_fields orelse return false;
                const before = self.worlds[heap].bindings[frame];
                if (before.unbound or before.atoms.items.len == 0) return false;
                var bound = false; for (before.atoms.items) |old| { try self.budget.step(); if (std.meta.eql(old, atom)) bound = true; }
                if (!bound) return false;
                for (self.obligations, self.worlds[heap].missing) |obligation, missing| {
                    try self.budget.step(); if (obligation.frame == frame and missing) return false;
                }
                found = true;
            }
        }
        return found;
    }
    fn callFact(self: *Engine, ordinal: Ref, frame: Ref) Error!?*const CallFact {
        for (self.calls.items) |*fact| { try self.budget.step(); if (fact.call == ordinal and fact.receiver == frame) return fact; }
        const call = self.graph.calls[ordinal];
        const fixed = try self.fixedFunction(call.function_id) orelse { self.pending = .fixed_call; return null; };
        const function = try model.findFunction(self.directory, call.function_id, self.budget);
        const role = function.construction orelse { self.pending = .fixed_call; return null; };
        const declared = fixed.declaration.construction orelse { self.pending = .fixed_contract; return null; };
        if (function.kind != .construction_body or fixed.declaration.kind != .@"construction-body" or !function.environment_metadata_complete or
            function.parameter_types.len != call.arguments.len + 1 or fixed.declaration.parameter_types.len != function.parameter_types.len or fixed.contract.upper.parameters.len != function.parameter_types.len or
            fixed.declaration.lexical_environment != null or fixed.declaration.activation_environment != null or fixed.declaration.captures.len != 0 or fixed.contract.upper.captures.len != 0 or
            function.lexical_environment != null or function.activation_environment != null or declared.receiver_index != 0) { self.pending = .fixed_contract; return null; }
        for (fixed.contract.upper.parameters, 0..) |parameter, index| {
            try self.budget.step(); if (parameter.index != index) { self.pending = .fixed_contract; return null; }
        }
        try self.budget.spend(function.parameter_types.len);
        const arguments = try self.allocator.alloc([]const Atom, function.parameter_types.len); @memset(arguments, &.{});
        for (call.arguments, 1..) |argument, parameter_index| {
            const expected = function.parameter_types[parameter_index]; var scalar = false; var reference = false;
            for (self.directory.types) |row| { try self.budget.step(); if (try self.budget.equal(row.id, expected)) { scalar = row.kind == .scalar; reference = row.kind == .reference; break; } }
            if ((!scalar and !reference) or argument.len == 0) { self.pending = .data_protocol; return null; }
            if (reference) {
                // Uncomputed inputs defer this call within the same Engine.
                // The final stable caller state is checked again below; an
                // early cached child never licenses a later missing path.
                if (!try self.referenceArgument(argument, expected, call.heap)) return null;
                var origins: Atoms = .empty;
                for (argument) |id| { try self.budget.step(); for (self.values[id].atoms.items) |atom| { _ = try self.insert(Atom, &origins, atom); } }
                arguments[parameter_index] = origins.items;
            }
            // A typed wrapper is not evidence that its leaves have this type.
            // Retain the original Data inputs; the owner equations transport
            // their relationships into each ordered parameter, separately from input0.
            try self.budget.spend(2 * self.graph.nodes.len);
            const seen = try self.allocator.alloc(bool, self.graph.nodes.len); @memset(seen, false);
            const work = try self.allocator.alloc(Ref, self.graph.nodes.len); var count: usize = 0; var cursor: usize = 0; var leaf = false;
            for (argument) |id| {
                try self.budget.step(); const node = self.graph.nodes[id];
                const type_id: ?model.Symbol = switch (node) { inline .literal, .parameter, .nonowning, .join, .gate, .receiver_value, .call => |row| row.@"type", else => null };
                // A Ref catch has an explicit static view at the argument
                // boundary. An untyped payload is never that boundary.
                if (type_id == null or !try self.budget.equal(type_id.?, expected)) { self.pending = .data_protocol; return null; }
                if (!seen[id]) { seen[id] = true; work[count] = id; count += 1; }
            }
            while (cursor < count) : (cursor += 1) {
                try self.budget.step(); const node = self.graph.nodes[work[cursor]];
                const type_id: ?model.Symbol = switch (node) { inline .literal, .parameter, .nonowning, .join, .gate, .receiver_value, .call => |row| row.@"type", else => null };
                // Graph's language-call result MUST be null-typed. A typed
                // catch view may retain that original payload through null
                // joins/gates. referenceArgument above has already proved
                // every actual atom is a complete original object; this does
                // not turn a view annotation into an actual-type proof.
                const language_payload = reference and type_id == null and switch (node) { .join, .gate => true, .call => |row| row.completion == .language, else => false };
                if (!language_payload and (type_id == null or !try self.budget.equal(type_id.?, expected))) { self.pending = .data_protocol; return null; }
                switch (node) {
                    inline .join, .gate => |row| { if (row.inputs.len == 0) { self.pending = .data_protocol; return null; } for (row.inputs) |id| { try self.budget.step(); if (!seen[id]) { seen[id] = true; work[count] = id; count += 1; } } },
                    .receiver_value, .call => { if (!reference) { self.pending = .data_protocol; return null; } leaf = true; },
                    .literal => |row| { if (reference or row.category != .other) { self.pending = .data_protocol; return null; } leaf = true; },
                    .parameter, .nonowning => { if (reference) { self.pending = .data_protocol; return null; } leaf = true; },
                    else => unreachable,
                }
            }
            if (!leaf) { self.pending = .data_protocol; return null; }
        }
        if (self.frames[frame].role == null or self.frames[frame].parent != null or !try self.budget.equal(self.frames[frame].role.?.id, role.id)) { self.pending = .call_entry; return null; }
        const graph = if (fixed.contract.return_origins) |*value| value else { self.pending = .fixed_call; return null; };
        // Nested fixed graphs keep their original rows. Their finite no-Data
        // dependencies were solved postorder with this same Engine/Budget.
        // Ordinary leaf scalar/RefData calls still use the proved caller seed.
        var analysis: *const Analysis = undefined;
        if (self.prepared) |prepared| {
            var selected: ?*const Analysis = null;
            for (prepared) |row| { try self.budget.step(); if (row.call == ordinal) selected = row.analysis; }
            analysis = selected orelse { self.pending = .fixed_call; return null; };
        } else if (graph.calls.len != 0) {
            if (call.arguments.len != 0) { self.pending = .data_protocol; return null; }
            analysis = try fixedTree(self.allocator, self.directory, fixed, self.formal_input.?.fixed, self.budget);
        } else {
            try self.budget.spend(1); const leaf = try self.allocator.create(Analysis);
            leaf.* = try analyzeImpl(self.allocator, self.directory, graph, self.budget, null, .{ .function_id = function.id, .fixed = self.formal_input.?.fixed }, arguments, true, true, &.{});
            analysis = leaf;
        }
        if (analysis.pending) |reason| { self.pending = reason; return null; }
        if (fixed.contract.upper.facets.may_throw and !analysis.language_live) { self.pending = .fixed_completion; return null; }
        const exits = analysis.input_exits orelse { self.pending = .call_entry; return null; };
        if (self.calls.items.len == self.calls.capacity) try self.budget.spend(self.calls.items.len + 1);
        try self.budget.step(); try self.calls.append(self.allocator, .{ .caller_graph = self.graph, .call = ordinal, .receiver = frame, .graph = graph, .input = exits.input, .fixed = fixed, .analysis = analysis, .arguments = arguments });
        return &self.calls.items[self.calls.items.len - 1];
    }
    fn imported(self: *Engine, fact: *const CallFact, completion: model.Completion, values: []const Atom, into: *Atoms) Error!bool {
        var error_site: ?Ref = null;
        for (values) |atom| {
            try self.budget.step(); const value: Atom = switch (atom.source) {
                .allocation => |source| if (source == fact.input) .{ .source = .{ .allocation = fact.receiver }, .category = atom.category } else .{ .source = .{ .scoped_allocation = .{ .analysis = fact.analysis, .frame = source, .completion = completion } }, .category = atom.category },
                .scoped_allocation => atom,
                .language_error => blk: {
                    // A generated callee error remains local to this original
                    // caller completion. CallFact retains its exact callee
                    // action origin; no callee Ref is reinterpreted as caller.
                    if (error_site == null) for (self.graph.heaps, 0..) |heap, index| {
                        try self.budget.step(); if (heap == .call and heap.call.call == fact.call and heap.call.completion == completion) { error_site = index; break; }
                    };
                    const site = error_site orelse { self.pending = .fixed_origin; return false; };
                    break :blk .{ .source = .{ .language_error = site }, .category = atom.category };
                },
                .node => |source| {
                    // A callee parameter keeps its own node identity. Follow
                    // its original caller refs only at this import boundary.
                    const node = fact.graph.nodes[source];
                    if (node != .parameter or node.parameter.index == 0) { self.pending = .fixed_origin; return false; }
                    const parameter = node.parameter.index;
                    if (parameter > self.graph.calls[fact.call].arguments.len) { self.pending = .fixed_origin; return false; }
                    for (self.graph.calls[fact.call].arguments[parameter - 1]) |id| {
                        try self.budget.step(); for (self.values[id].atoms.items) |origin| { _ = try self.insert(Atom, into, origin); }
                    }
                    continue;
                },
            };
            // Temporary mapped equations do not advance the fixed point.
            // Only their merge into persistent caller facts may set changed.
            _ = try self.insert(Atom, into, value);
        }
        return true;
    }
    fn fixedCall(self: *Engine, heap_index: Ref, row: @FieldType(model.Heap, "call")) Error!void {
        const call = self.graph.calls[row.call];
        if (!self.controls[call.control] or !self.worlds[call.heap].live) return;
        if (call.receiver == null or call.callee != null or call.environment != null) { self.pending = .fixed_call; return; }
        var selected: Refs = .empty;
        for (call.receiver.?) |id| { try self.budget.step(); for (self.values[id].frames.items) |frame| { _ = try self.insert(Ref, &selected, frame); } }
        if (selected.items.len == 0) return;
        if (selected.items.len != 1) { self.pending = .call_entry; return; }
        const frame = selected.items[0]; const before = &self.worlds[call.heap].bindings[frame];
        if (!before.unbound or before.atoms.items.len != 0) { self.pending = .call_entry; return; }
        const fact = try self.callFact(row.call, frame) orelse return;
        const binding = if (row.completion == .normal) fact.analysis.input_exits.?.normal else fact.analysis.input_exits.?.language;
        if (!binding.live) return;
        var replacement: Atoms = .empty;
        if (!try self.imported(fact, row.completion, binding.atoms, &replacement)) return;
        var returned: Atoms = .empty;
        if (!try self.imported(fact, row.completion, if (row.completion == .normal) fact.analysis.normal else fact.analysis.language, &returned)) return;
        try self.atoms(&self.call_results[row.call][@intFromEnum(row.completion)], returned.items);
        var completed: std.ArrayListUnmanaged(model.Symbol) = .empty;
        if (binding.missing_fields) |missing| {
            const inventory = fact.fixed.initialization_fields orelse { self.pending = .data_protocol; return; };
            for (inventory) |field| {
                try self.budget.step(); var absent = false; for (missing) |id| { try self.budget.step(); if (try self.budget.equal(field, id)) { absent = true; break; } }
                if (!absent) { if (completed.items.len == completed.capacity) try self.budget.spend(completed.items.len + 1); try self.budget.step(); try completed.append(self.allocator, field); }
            }
        }
        try self.merge(&self.worlds[heap_index], &self.worlds[call.heap], frame, replacement.items, binding.unbound, .{ .frame = frame, .fields = completed.items });
        const live = &self.call_live[row.call][@intFromEnum(row.completion)]; if (!live.*) { live.* = true; self.changed = true; }
    }
    // Empty Data is not normally an absence proof. Only a finite, nonempty
    // wrapper DAG whose every leaf is a resolved impossible receiver or fixed
    // call completion explains an inactive root. No roots or prefixes are removed.
    fn inactiveReceiverRoot(self: *Engine, root: Ref) Error!bool {
        const length = self.graph.nodes.len;
        try self.budget.spend(3 * length);
        const marks = try self.allocator.alloc(u2, length); @memset(marks, 0);
        const next = try self.allocator.alloc(usize, length); @memset(next, 0);
        const stack = try self.allocator.alloc(Ref, length);
        try self.budget.spend(3); marks[root] = 1; stack[0] = root; var count: usize = 1;
        while (count != 0) {
            try self.budget.step(); const id = stack[count - 1];
            const inputs: []const Ref = switch (self.graph.nodes[id]) {
                .call => |row| {
                    // An empty call value alone is not absence. Only an active
                    // original call with complete, successful original facts
                    // can prove that this exact completion has no live exit.
                    try self.budget.spend(6); const call = self.graph.calls[row.call];
                    if (!self.controls[call.control] or !self.worlds[call.heap].live or self.call_live[row.call][@intFromEnum(row.completion)]) return false;
                    var found = false;
                    for (self.calls.items) |fact| {
                        try self.budget.step(); if (fact.call != row.call) continue;
                        try self.budget.spend(5);
                        if (fact.caller_graph != self.graph or fact.analysis.pending != null) return false;
                        const exits = fact.analysis.input_exits orelse return false;
                        const completion = if (row.completion == .normal) exits.normal else exits.language;
                        if (completion.live) return false;
                        found = true;
                    }
                    if (!found) return false;
                    try self.budget.spend(2); marks[id] = 2; count -= 1; continue;
                },
                .receiver_value => |row| {
                    // validateGraph already owns the receiver_action/carrier
                    // join. Readiness below uses computed formal facts, not a
                    // declaration, selected Actual entrance or upper bound.
                    try self.budget.spend(4);
                    const receiver_action_row = self.graph.heaps[row.action].receiver_action;
                    if (self.worlds[row.action].live or !self.controls[receiver_action_row.control] or !self.worlds[receiver_action_row.previous].live) return false;
                    try self.budget.spend(receiver_action_row.frames.len);
                    for (receiver_action_row.frames) |operand| {
                        const selected = self.values[operand].frames.items;
                        if (selected.len == 0) return false;
                        try self.budget.spend(selected.len);
                        for (selected) |frame| if (self.frames[frame].role == null) return false;
                    }
                    // All active receiver operands were checked after Engine
                    // closure. This resolved action has no possible completion.
                    try self.budget.spend(2); marks[id] = 2; count -= 1; continue;
                },
                inline .join, .gate => |row| row.inputs,
                .copy => |row| row.bases,
                else => return false,
            };
            if (inputs.len == 0) return false;
            if (next[id] == inputs.len) {
                try self.budget.spend(2); marks[id] = 2; count -= 1; continue;
            }
            try self.budget.spend(2); const input = inputs[next[id]]; next[id] += 1;
            switch (marks[input]) {
                1 => return false, // A circular/uncomputed equation stays Need.
                2 => {},
                else => { try self.budget.spend(2); marks[input] = 1; stack[count] = input; count += 1; },
            }
        }
        return true;
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
                    .environment_input, .environment_create, .environment_parent, .environment_component => {},
                    inline .capture, .projection => |row| if (self.controls[row.control]) {
                        // Category is intentionally universal, like a formal
                        // parameter. The separate owner/content equations must
                        // prove the saved ENV/heap relation before consumption.
                        inline for (std.meta.tags(Category)) |category| try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = category });
                    },
                    .unknown => if (self.control_only) {
                        inline for (std.meta.tags(Category)) |category| try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = category });
                    },
                    .parameter => |row| {
                        const arguments = self.arguments;
                        if (row.index < arguments.len and arguments[row.index].len != 0) {
                            for (arguments[row.index]) |origin| { try self.budget.step(); try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = origin.category }); }
                        } else inline for (std.meta.tags(Category)) |category| try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = category });
                    },
                    .global, .nonowning => inline for (std.meta.tags(Category)) |category| {
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
                                if (self.effect_origins) {
                                    // Conditional lexical may-owner roots, as in
                                    // Graph5 copied(Parameter/EntryProjection).
                                    // This is not actual identity or a clone/hold
                                    // proof. Actual local Value shapes stay Open.
                                    try self.add(Atom, &into.atoms, atom);
                                } else {
                                    // Control-only copies establish categories.
                                    try self.add(Atom, &into.atoms, .{ .source = .{ .node = index }, .category = atom.category });
                                }
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
                            const role = try construction(self.directory, row.construction, self.budget);
                            if (parent != null) {
                                // Model's owning typed-carrier boundary already
                                // proved the direct-base relation. Limit this
                                // interpreter's new capability to implicit Base.
                                try self.budget.step();
                                if (role.kind != .implicit_base) { self.pending = .parent_activation; continue; }
                            }
                            try self.budget.spend(4);
                            self.frames[index] = .{ .role = role, .new_target = if (parent) |id| self.frames[id].new_target else row.new_target, .parent = parent };
                        }
                        try self.add(Ref, &into.frames, index);
                    },
                    .receiver_value => |row| try self.atoms(&into.atoms, self.results[row.action].items),
                    .call => |row| try self.atoms(&into.atoms, self.call_results[row.call][@intFromEnum(row.completion)].items),
                }
            }
            for (self.graph.heaps, 0..) |heap, index| {
                try self.budget.step(); switch (heap) {
                    .entry => if (!self.worlds[index].live) { try self.budget.spend(self.obligations.len); self.worlds[index].live = true; @memset(self.worlds[index].missing, true); self.changed = true; },
                    .join => |row| for (row.inputs) |input| try self.merge(&self.worlds[index], &self.worlds[input], null, null, null, null),
                    .receiver_action => |row| try self.action(index, row),
                    .call => |row| try self.fixedCall(index, row),
                    .store => |row| {
                        if (self.formal_environments and std.mem.startsWith(u8, row.selector, "capture:")) {
                            // The typed carrier boundary owns this ENV address.
                            // It cannot bind or initialize a receiver field.
                            if (self.controls[row.control]) try self.merge(&self.worlds[index], &self.worlds[row.previous], null, null, null, null);
                        } else try self.initialize(index,row);
                    },
                    .copy => |row| {
                        // A typed Data copy cannot mutate receiver controls.
                        // Keep its complete heap edge and prefix history; this
                        // domain makes no copied physical Value/holding proof.
                        try self.merge(&self.worlds[index], &self.worlds[row.previous], null, null, null, null);
                    },
                }
            }
            for (self.graph.controls, 0..) |control, index| {
                try self.budget.step(); if (self.controls[index]) continue;
                const live = switch (control) {
                    .entry => true,
                    .join => |row| live: { for (row.inputs) |input| { try self.budget.step(); if (self.controls[input]) break :live true; } break :live false; },
                    .receiver_completion => |row| self.worlds[row.action].live,
                    .call => |row| self.call_live[row.call][@intFromEnum(row.completion)],
                };
                if (live) { self.controls[index] = true; self.changed = true; }
            }
            if (!self.changed) break;
        }
    }
};

// Syntactic closure checking and evaluation use explicit stacks. Active original
// graph identities detect cycles; separate call sites remain separate analyses.
// All storage and traversal is charged to the caller's cumulative Budget.
fn fixedClosure(engine: *Engine) Error!?Pending {
    const a = engine.allocator;
    const Cursor = struct { graph: *const model.Graph, next: usize = 0 };
    var stack: std.ArrayListUnmanaged(Cursor) = .empty;
    try engine.budget.spend(1); try stack.append(a, .{ .graph = engine.graph });
    while (stack.items.len != 0) {
        try engine.budget.step(); const cursor = &stack.items[stack.items.len - 1];
        if (cursor.next == cursor.graph.calls.len) { _ = stack.pop(); continue; }
        const call = cursor.graph.calls[cursor.next]; cursor.next += 1;
        const fixed = try engine.fixedFunction(call.function_id) orelse return .fixed_call;
        const graph = if (fixed.contract.return_origins) |*row| row else return .fixed_call;
        for (graph.nodes) |node| { try engine.budget.step(); if (node == .unknown) return .unknown_origin; }
        for (stack.items) |active| { try engine.budget.step(); if (active.graph == graph) return .fixed_call; }
        // Only nested no-Data closure is added here. Existing standalone leaf
        // Data arguments are still proved by the ordinary original caller.
        if ((stack.items.len > 1 or graph.calls.len != 0) and call.arguments.len != 0) return .data_protocol;
        if (stack.items.len == stack.capacity) try engine.budget.spend(stack.items.len + 1);
        try engine.budget.step(); try stack.append(a, .{ .graph = graph });
    }
    return null;
}
fn fixedTree(a: std.mem.Allocator, directory: *const model.Directory, root: *const FixedFunction, fixed: []const FixedFunction, budget: *Budget) Error!*const Analysis {
    const Job = struct { fixed: *const FixedFunction, call: Ref, next: usize = 0, children: std.ArrayListUnmanaged(PreparedCall) = .empty };
    var jobs: std.ArrayListUnmanaged(Job) = .empty;
    try budget.spend(1); try jobs.append(a, .{ .fixed = root, .call = 0 });
    while (jobs.items.len != 0) {
        try budget.step(); const job = &jobs.items[jobs.items.len - 1]; const graph = &job.fixed.contract.return_origins.?;
        if (job.next != graph.calls.len) {
            const ordinal = job.next; job.next += 1; const call = graph.calls[ordinal];
            var selected: ?*const FixedFunction = null;
            for (fixed) |*row| { try budget.step(); if (try budget.equal(row.function_id, call.function_id)) selected = row; }
            // fixedClosure already checked presence and acyclicity under this
            // exact fixed vector. No target or default summary is invented.
            const dependency = selected orelse return error.InvalidReference;
            if (jobs.items.len == jobs.capacity) try budget.spend(jobs.items.len + 1);
            try budget.step(); try jobs.append(a, .{ .fixed = dependency, .call = ordinal }); continue;
        }
        try budget.spend(1); const analysis = try a.create(Analysis);
        analysis.* = try analyzeImpl(a, directory, graph, budget, null, .{ .function_id = job.fixed.function_id, .fixed = fixed }, &.{}, true, true, job.children.items);
        const completed = jobs.pop().?;
        if (jobs.items.len == 0) return analysis;
        const parent = &jobs.items[jobs.items.len - 1];
        if (parent.children.items.len == parent.children.capacity) try budget.spend(parent.children.items.len + 1);
        try budget.step(); try parent.children.append(a, .{ .call = completed.call, .analysis = analysis });
    }
    unreachable;
}

// The owning model reader already checked every row/ref/carrier and creation
// activation gate using this same immutable directory and cumulative Budget.
// Optional entry carries only original IDs for an independently proved unbound
// root. It must belong to this graph's owning function and completed same-
// Context actual analysis. No raw payload, Source/FDI or permission is accepted.
fn analyzeImpl(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, entry: ?Entry, formal_input: ?FormalInput, arguments: []const []const Atom, effect_origins: bool, return_origins: bool, prepared: ?[]const PreparedCall) Error!Analysis {
    const formal_function = if (formal_input) |input| input.function_id else null;
    var result = Analysis{ .arena = std.heap.ArenaAllocator.init(allocator) }; errdefer result.deinit();
    if (!try model.receiverActivations(allocator, graph, budget)) { result.pending = .frame_activation; return result; }
    if (graph.calls.len != 0 and (formal_input == null or formal_input.?.fixed.len == 0)) { result.pending = .fixed_call; return result; }
    var input: ?Ref = null;
    for (graph.nodes,0..) |node,index| {
        try budget.step(); switch (node) {
            .receiver_input => { if((entry==null and formal_function==null) or input!=null) { result.pending = .entry_state; return result; } input=index; },
            .unknown => if (formal_function==null or effect_origins) { result.pending = .unknown_origin; return result; },
            .copy => if (formal_function==null) { result.pending = .data_protocol; return result; },
            .local => |row| if (effect_origins) {
                // Only a Local carries an independently admitted actual tag.
                // This small domain has no complete physical Value field map.
                var known = false;
                for (directory.types) |actual| {
                    try budget.step(); if (!try budget.equal(actual.id, row.@"type")) continue;
                    known = actual.kind != .value and actual.kind != .unknown and actual.kind != .union_type and actual.kind != .future; break;
                }
                if (!known) { result.pending = .data_protocol; return result; }
            },
            .literal, .parameter, .global, .nonowning, .join, .gate, .receiver_frame, .receiver_value => {},
            .call => if (formal_input == null or formal_input.?.fixed.len == 0) { result.pending = .fixed_call; return result; },
            .code => |row| if (formal_function == null and row.environment != null) { result.pending = .data_protocol; return result; },
            .environment_input, .environment_create, .environment_parent, .environment_component, .capture, .projection => if (formal_function == null) { result.pending = .data_protocol; return result; },
        }
    }
    if (return_origins and input == null) { result.pending = .entry_state; return result; }
    const a = result.arena.allocator();
    // The proved immutable entry is shared by every store and its frame seed.
    const entry_function=if(input!=null)try model.findFunction(directory,formal_function orelse entry.?.function_id,budget) else null;
    for (graph.heaps) |heap| { try budget.step(); switch (heap) {
        .entry, .join, .receiver_action => {},
        .call => if (formal_input == null or formal_input.?.fixed.len == 0) { result.pending = .fixed_call; return result; },
        .copy => if (!return_origins) { result.pending = .heap_protocol; return result; },
        .store=>|row|{
            if (formal_function != null and std.mem.startsWith(u8, row.selector, "capture:")) continue;
            if((entry==null and !effect_origins) or input==null or !row.initialize) { result.pending=.scalar_initialization; return result; }
            const function=entry_function.?;
            try budget.text(row.selector.len);
            if(function.construction==null or !std.mem.startsWith(u8,row.selector,"field:")) { result.pending=.scalar_initialization; return result; }
            // The owning Body boundary already joined the original FieldID to
            // this construction's exact token/prefix. Here an implicit child
            // owner is only a candidate; every live base must still prove its
            // own bound allocation in storeReady, in the store's input World.
            var owner=try budget.equal(function.construction.?.owner,row.view);
            if(!owner and effect_origins) for(graph.nodes) |node| {
                try budget.step(); if(node!=.receiver_frame or node.receiver_frame.parent==null)continue;
                const role=try construction(directory,node.receiver_frame.construction,budget);
                if(role.kind==.implicit_base and try budget.equal(role.owner,row.view)) { owner=true; break; }
            };
            if(!owner) { result.pending=.scalar_initialization; return result; }
            if (effect_origins) {
                var owned = false;
                for (directory.fields) |id| { try budget.step(); if (try budget.equal(id, row.selector[6..])) { owned = true; break; } }
                if (!owned) { result.pending = .scalar_initialization; return result; }
                continue;
            }
            var owned=false;
            for(entry.?.scalar_fields) |id| { try budget.step(); if(try budget.equal(id,row.selector[6..])) { owned=true; break; } }
            if(!owned or !try nativeLiterals(a,directory,graph,row.values,budget)) { result.pending=.scalar_initialization; return result; }
        },
    } }
    try budget.spend(graph.nodes.len); const values = try a.alloc(Fact, graph.nodes.len); @memset(values, .{});
    try budget.spend(graph.nodes.len); const frames = try a.alloc(Frame, graph.nodes.len); @memset(frames, .{});
    try budget.spend(graph.controls.len); const controls = try a.alloc(bool, graph.controls.len); @memset(controls, false);
    // Build obligations from the original typed construction inventory once.
    // null inventory remains UNKNOWN; an explicit empty inventory is meaningful.
    var obligations: std.ArrayListUnmanaged(Obligation) = .empty;
    if (formal_input) |formal| for (graph.nodes, 0..) |node, frame| {
        try budget.step(); const role_id: ?model.Symbol = switch (node) { .receiver_input => entry_function.?.construction.?.id, .receiver_frame => |row| row.construction, else => null };
        const role = try construction(directory, role_id orelse continue, budget);
        const function_id = role.function_id orelse continue;
        for (formal.fixed) |fixed| { try budget.step(); if (!try budget.equal(fixed.function_id, function_id)) continue;
            if (fixed.initialization_fields) |fields| for (fields) |field| {
                try budget.step(); if (obligations.items.len == obligations.capacity) try budget.spend(obligations.items.len + 1);
                try obligations.append(a, .{ .frame = frame, .field = field });
            };
            break;
        }
    };
    try budget.spend(graph.heaps.len); const worlds = try a.alloc(World, graph.heaps.len);
    for (worlds) |*world| { try budget.spend(graph.nodes.len + obligations.items.len + 1); world.* = .{ .bindings = try a.alloc(Binding, graph.nodes.len), .missing = try a.alloc(bool, obligations.items.len) }; @memset(world.bindings, .{}); @memset(world.missing, false); }
    try budget.spend(graph.heaps.len); const results = try a.alloc(Atoms, graph.heaps.len); @memset(results, .empty);
    var engine = Engine{ .allocator = a, .directory = directory, .graph = graph, .budget = budget, .values = values, .worlds = worlds, .controls = controls, .frames = frames, .results = results, .input = input, .control_only = formal_function != null, .effect_origins = effect_origins, .formal_environments = formal_function != null, .formal_input = formal_input, .arguments = arguments, .prepared = prepared, .obligations = obligations.items };
    try budget.spend(2 * graph.calls.len);
    engine.call_results = try a.alloc([2]Atoms, graph.calls.len); @memset(engine.call_results, .{ .empty, .empty });
    engine.call_live = try a.alloc([2]bool, graph.calls.len); @memset(engine.call_live, .{ false, false });
    if(input) |id| {
      if (formal_function != null) {
        // The admitted construction-body interface owns an initially unbound
        // formal control frame. Ordinary Data inputs remain arbitrary, and this
        // seed is never an actual entrance, allocation or initialization proof.
        try budget.spend(5); const function = entry_function.?;
        if (function.kind != .construction_body or function.construction == null) { result.pending = .entry_state; return result; }
        const role = try construction(directory,function.construction.?.id,budget);
        if (role.kind != .explicit or role.function_id == null or !try budget.equal(role.function_id.?, function.id)) { result.pending = .entry_state; return result; }
        // No transfer reads new_target: only the construction role, binding
        // state and arbitrary Data categories affect these equations. A null
        // formal target is therefore parametric over ALL compatible nominal
        // descendants; children inherit that same unknown parameter. It is
        // never replaced by the owner's class or used as an Actual type tag.
        try budget.spend(4); frames[id] = .{ .role = role, .new_target = null, .parent = null };
    } else {
        try budget.spend(4); const seed=entry.?; const function=entry_function.?;
        const role=try construction(directory,seed.construction,budget); try budget.spend(7);
        if(function.kind!=.construction_body or function.construction==null or role.kind!=.explicit or role.base!=null or
            !try budget.equal(function.construction.?.id,role.id) or !try budget.equal(seed.new_target,role.owner)) { result.pending=.entry_state; return result; }
        // Every heap entry starts from this observed unbound state. No frame
        // data/category is invented and no bound entry payload is supported.
        frames[id]=.{.role=role,.new_target=seed.new_target,.parent=null};
      }
    }
    // All immutable source graphs/metadata were validated at the same owning
    // boundary. Every syntactic fixed dependency must still be available; an
    // inactive completion is never permission to omit a target or solve a cycle.
    for (graph.calls) |call| {
        try budget.step(); const fixed = try engine.fixedFunction(call.function_id) orelse { result.pending = .fixed_call; return result; };
        const dependency = if (fixed.contract.return_origins) |*value| value else { result.pending = .fixed_call; return result; };
        for (dependency.nodes) |node| { try budget.step(); if (node == .unknown) { result.pending = .unknown_origin; return result; } }
    }
    if (prepared == null and graph.calls.len != 0) if (try fixedClosure(&engine)) |reason| { result.pending = reason; return result; };
    try engine.run(); result.calls = engine.calls.items; if (engine.pending) |reason| { result.pending = reason; return result; }
    if (formal_function != null and input != null) {
        try budget.step(); const root = input.?;
        if (frames[root].role.?.base != null) {
            // Only the newly supported resolved direct implicit-Base child
            // protocol opens a derived formal entry. A result-only derived
            // graph still lacks this capability, even if it returns Object.
            var child = false;
            for (frames) |frame| {
                try budget.spend(2);
                if (frame.parent == root and frame.role != null and frame.role.?.kind == .implicit_base) { child = true; break; }
            }
            if (!child) { result.pending = .entry_state; return result; }
        }
    }
    for(graph.heaps) |heap| if(heap==.store) {
        try budget.step(); const row=heap.store; if(!controls[row.control])continue;
        if (formal_function != null and std.mem.startsWith(u8, row.selector, "capture:")) continue;
        if(!worlds[row.previous].live or !try engine.storeReady(row)) { result.pending=.scalar_initialization; return result; }
    };
    if (return_origins) for (graph.heaps) |heap| {
        try budget.step(); if (heap != .copy) continue;
        const row = heap.copy; const operation = graph.nodes[row.value].copy;
        if (!controls[operation.control] or !worlds[row.previous].live) continue;
        // An ignored copy result still needs an established Data input before
        // its normal heap can witness completion. Frame-valued copies already
        // set Engine.pending=data_protocol in the shared value transfer.
        try budget.step();
        if (values[row.value].atoms.items.len == 0) { result.pending = .unknown_origin; return result; }
        try budget.spend(operation.bases.len);
        for (operation.bases) |base| {
            try budget.step(); if (values[base].atoms.items.len == 0) { result.pending = .unknown_origin; return result; }
        }
    };
    // A circular/uncomputed data equation is bottom, never a known-empty
    // payload. Only an actually absent operand vector denotes generated U.
    for (graph.heaps) |heap| if (heap == .receiver_action) {
        const row = heap.receiver_action; try budget.step();
        if (!controls[row.control] or !worlds[row.previous].live) continue;
        for (row.operands) |id| { try budget.step(); if (values[id].atoms.items.len == 0) { result.pending = .unknown_origin; return result; } }
    };
    for (graph.calls, 0..) |call, call_ordinal| {
        try budget.step(); if (!controls[call.control] or !worlds[call.heap].live) continue;
        const function = try model.findFunction(directory, call.function_id, budget);
        for (call.arguments, 1..) |argument, parameter_index| {
            const expected = function.parameter_types[parameter_index]; var reference = false;
            for (directory.types) |type_row| { try budget.step(); if (try budget.equal(type_row.id, expected)) { reference = type_row.kind == .reference; break; } }
            if (reference and !try engine.referenceArgument(argument, expected, call.heap)) { result.pending = .data_protocol; return result; }
        }
        for (engine.calls.items) |*fact| {
            try budget.step(); if (fact.call != call_ordinal) continue;
            try budget.spend(function.parameter_types.len);
            const final_arguments = try a.alloc([]const Atom, function.parameter_types.len); @memset(final_arguments, &.{});
            for (call.arguments, 1..) |argument, parameter| {
                try budget.step(); var originals: Atoms = .empty;
                for (argument) |id| { try budget.step(); for (values[id].atoms.items) |atom| { _ = try engine.insert(Atom, &originals, atom); } }
                final_arguments[parameter] = originals.items;
            }
            fact.arguments = final_arguments;
        }
        const receiver = call.receiver orelse { result.pending = .fixed_call; return result; };
        var resolved = false;
        for (receiver) |id| { try budget.step(); resolved = resolved or values[id].frames.items.len != 0; }
        if (!resolved) { result.pending = .unknown_origin; return result; }
    }
    var normal: Atoms = .empty; var language: Atoms = .empty;
    for (graph.exits.normal) |exit| {
        try budget.step(); if (controls[exit.control] and !worlds[exit.heap].live) { result.pending = .heap_protocol; return result; }
        result.normal_live = result.normal_live or (controls[exit.control] and worlds[exit.heap].live);
    }
    for (graph.exits.language) |exit| {
        try budget.step(); if (controls[exit.control] and !worlds[exit.heap].live) { result.pending = .heap_protocol; return result; }
        result.language_live = result.language_live or (controls[exit.control] and worlds[exit.heap].live);
    }
    if (result.normal_live) {
        for (graph.normal) |id| {
            try budget.step();
            if (values[id].atoms.items.len == 0) {
                if (try engine.inactiveReceiverRoot(id)) continue;
                result.pending = .unknown_origin; return result;
            }
            try engine.atoms(&normal, values[id].atoms.items);
        }
        try budget.step();
        if (graph.normal.len != 0 and normal.items.len == 0) { result.pending = .unknown_origin; return result; }
    }
    if (result.language_live) {
        for (graph.language) |id| {
            try budget.step();
            if (values[id].atoms.items.len == 0) {
                if (try engine.inactiveReceiverRoot(id)) continue;
                result.pending = .unknown_origin; return result;
            }
            try engine.atoms(&language, values[id].atoms.items);
        }
        try budget.step();
        if (graph.language.len != 0 and language.items.len == 0) { result.pending = .unknown_origin; return result; }
    }
    try budget.spend(graph.nodes.len); const summary = try a.alloc(FrameSummary, graph.nodes.len); @memset(summary, .{});
    for (frames, summary, 0..) |frame, *row, index| {
        try budget.step(); if (frame.role) |role| {
            try budget.spend(4); row.* = .{ .construction = role.id, .new_target = frame.new_target, .parent = frame.parent };
            var bound: Atoms = .empty;
            for (worlds) |world| { try budget.step(); if (!world.live) continue; row.may_unbound = row.may_unbound or world.bindings[index].unbound; try engine.atoms(&bound, world.bindings[index].atoms.items); }
            row.bound = bound.items;
            // The role's own inventory is authoritative, including known-empty
            // versus UNKNOWN. Never substitute the containing function's input0.
            var inventory: ?[]const model.Symbol = null;
            if (formal_input) |formal| if (role.function_id) |function_id| for (formal.fixed) |fixed| {
                try budget.step(); if (try budget.equal(fixed.function_id, function_id)) { inventory = fixed.initialization_fields; break; }
            };
            inline for (.{ model.Completion.normal, model.Completion.language }) |completion| {
                try budget.step();
                const source = if (completion == .normal) graph.exits.normal else graph.exits.language;
                const into = if (completion == .normal) &row.normal else &row.language;
                var exit_atoms: Atoms = .empty;
                for (source) |exit| {
                    try budget.step(); if (!controls[exit.control] or !worlds[exit.heap].live) continue;
                    into.live = true; into.unbound = into.unbound or worlds[exit.heap].bindings[index].unbound;
                    try engine.atoms(&exit_atoms, worlds[exit.heap].bindings[index].atoms.items);
                }
                into.atoms = exit_atoms.items;
                if (inventory) |fields| {
                    var missing: std.ArrayListUnmanaged(model.Symbol) = .empty;
                    try budget.step();
                    for (fields) |field| {
                        try budget.step(); var absent = false;
                        for (engine.obligations, 0..) |obligation, ordinal| {
                            try budget.step(); if (obligation.frame != index or !try budget.equal(obligation.field, field)) continue;
                            for (source) |exit| { try budget.step(); if (controls[exit.control] and worlds[exit.heap].live) absent = absent or worlds[exit.heap].missing[ordinal]; }
                        }
                        if (absent) { if (missing.items.len == missing.capacity) try budget.spend(missing.items.len + 1); try budget.step(); try missing.append(a, field); }
                    }
                    into.missing_fields = missing.items;
                }
            }
        } else if (graph.nodes[index] == .receiver_frame and controls[graph.nodes[index].receiver_frame.control]) { result.pending = .frame_activation; return result; }
    }
    var writes:Initializations=.empty;
    // Include every live prefix, not just normal returns or language exits.
    // Histories are finite sets of original store/base/literal atoms; joins do
    // not invent counts, generations, last-value or physical alias evidence.
    for(worlds) |*world| { try budget.step(); if(world.live)try engine.initializations(&writes,world.initializations.items); }
    result.initializations=writes.items;
    result.normal = normal.items; result.language = language.items; result.frames = summary;
    if (input) |id| { try budget.step(); result.input_exits = .{ .input = id, .normal = summary[id].normal, .language = summary[id].language }; }
    if (formal_function != null) {
        try budget.spend(results.len); const action_results = try a.alloc([]const Atom, results.len);
        for (results, action_results) |value, *into| { try budget.step(); into.* = value.items; }
        try budget.spend(worlds.len); const heap_live = try a.alloc(bool, worlds.len);
        for (worlds, heap_live) |world, *live| { try budget.step(); live.* = world.live; }
        try budget.spend(3); result.controls = controls; result.action_results = action_results; result.heap_live = heap_live;
    }
    return result;
}

// Original immutable certificate interpretation retains its stronger entry and
// native-field requirements. The effect-only boundary below does not relax it.
pub fn analyze(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, entry: ?Entry) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, entry, null, &.{}, false, false, null);
}

// The graph is the complete current normalized constructor control projection,
// not its fixed own-return certificate. Unsupported calls and data/heap forms
// retain Pending; callers must keep complete callee uppers independently.
pub fn analyzeControls(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, input: FormalInput) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, null, input, &.{}, false, false, null);
}

// Effect-only lexical owner flow through all current live-prefix field stores.
// Formal roots retain arbitrary categories and conditional owners across copy;
// no actual allocation, identity, freshness, holding or return proof is made.
pub fn analyzeEffects(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, input: FormalInput) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, null, input, &.{}, true, false, null);
}

// Pure interpretation of an independently typed construction-frame return
// graph. The caller must separately prove the complete current-body graph is
// included in the immutable fixed graph. No effect-proof object, selected actual
// entrance, allocation authority, physical Value clone or holding is accepted.
pub fn analyzeReturns(allocator: std.mem.Allocator, directory: *const model.Directory, graph: *const model.Graph, budget: *Budget, input: FormalInput) Error!Analysis {
    return analyzeImpl(allocator, directory, graph, budget, null, input, &.{}, true, true, null);
}
