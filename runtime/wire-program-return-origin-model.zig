// SPDX-License-Identifier: MIT
// Borrowed Graph5 equations only. No raw parser, Program, permission or wire adoption.
const std = @import("std");

pub const Ref = usize;
pub const Symbol = []const u8;
pub const Error = std.mem.Allocator.Error || error{ BudgetExceeded, InvalidGraph, InvalidReference, InvalidOrder };
pub const Budget = struct {
    context: *anyopaque,
    charge: *const fn (*anyopaque, usize) error{BudgetExceeded}!void,

    pub fn spend(self: *Budget, units: usize) error{BudgetExceeded}!void { try self.charge(self.context, units); }
    pub fn step(self: *Budget) error{BudgetExceeded}!void { try self.spend(1); }
    pub fn text(self: *Budget, bytes: usize) error{BudgetExceeded}!void { try self.spend(bytes / 8 + 1); }
    pub fn equal(self: *Budget, a: Symbol, b: Symbol) error{BudgetExceeded}!bool {
        try self.text(a.len); try self.text(b.len); return std.mem.eql(u8, a, b);
    }
    pub fn lookup(self: *Budget, count: usize, query_bytes: usize) error{BudgetExceeded}!void {
        var n = count; var depth: usize = 1;
        while (n != 0) : (n >>= 1) { try self.step(); depth += 2; }
        for (0..depth) |_| try self.text(query_bytes);
    }
};

pub const Completion = enum { normal, language };
pub const TypeKind = enum { scalar, string, @"undefined", @"null", @"void", array, read_span, value, reference, function, union_type, unknown, future };
pub const TypeRow = struct { id: Symbol, kind: TypeKind };
pub const FunctionKind = enum { source, method, construction_body, future };
pub const FunctionRow = struct {
    id: Symbol,
    kind: FunctionKind,
    // Logical vector includes an ordinary method receiver.
    parameter_types: []const Symbol,
    return_type: Symbol,
    environment_metadata_complete: bool,
    lexical_environment: ?Symbol,
    activation_environment: ?Symbol,
    construction: ?Constructor,
};
pub const Constructor = struct { id: Symbol, owner: Symbol, base: ?Symbol, receiver_index: Ref };
pub const Construction = struct { id: Symbol, owner: Symbol, base: ?Symbol, kind: enum { explicit, implicit_base, implicit_derived }, function_id: ?Symbol };
pub const EnvironmentSlot = struct { key: Symbol, @"type": Symbol, writable: bool };
pub const EnvironmentRow = struct { id: Symbol, parent: ?Symbol, slots: []const EnvironmentSlot };
pub const GlobalRow = struct { id: Symbol, @"type": Symbol };
// One immutable interpretation directory. It conveys no scope/group admission.
// Directory rows are canonical bytewise-id ordered, matching the fixed map seam.
pub const Directory = struct {
    types: []const TypeRow,
    functions: []const FunctionRow,
    globals: []const GlobalRow,
    environments: []const EnvironmentRow,
    fields: []const Symbol,
    constructions: []const Construction,
};
pub const Category = enum { @"undefined", other };
pub const ReceiverAction = enum { allocate, get, bind, result };
pub const Value = union(enum) {
    literal: struct { @"type": ?Symbol, category: Category },
    receiver_input: void,
    receiver_frame: struct { construction: Symbol, new_target: ?Symbol, parent: ?[]const Ref, site: Symbol, control: Ref },
    receiver_value: struct { @"type": ?Symbol, action: Ref },
    parameter: struct { @"type": Symbol, index: Ref },
    global: struct { @"type": Symbol, id: Symbol },
    capture: struct { @"type": Symbol, id: Symbol, layout: Symbol, environment: []const Ref, heap: Ref, control: Ref },
    environment_input: struct { layout: Symbol },
    environment_create: struct { layout: Symbol, parent: ?[]const Ref, site: Symbol, control: Ref },
    environment_parent: struct { layout: Symbol, bases: []const Ref, control: Ref },
    environment_component: struct { layout: Symbol, function_id: Symbol, callee: []const Ref, control: Ref },
    code: struct { @"type": Symbol, function_id: Symbol, environment: ?[]const Ref, control: Ref },
    local: struct { @"type": Symbol },
    nonowning: struct { @"type": Symbol },
    unknown: void,
    join: struct { @"type": ?Symbol, inputs: []const Ref },
    gate: struct { @"type": ?Symbol, inputs: []const Ref, control: Ref },
    projection: struct { @"type": Symbol, bases: []const Ref, selector: Symbol, view: Symbol, heap: Ref, control: Ref },
    copy: struct { @"type": Symbol, bases: []const Ref, site: Symbol, heap: Ref, control: Ref },
    call: struct { @"type": ?Symbol, call: Ref, completion: Completion },
};
pub const Heap = union(enum) {
    receiver_action: struct { previous: Ref, control: Ref, frames: []const Ref, action: ReceiverAction, operands: []const Ref, completion: Completion },
    entry: void,
    join: struct { inputs: []const Ref },
    store: struct { previous: Ref, bases: []const Ref, selector: Symbol, view: Symbol, values: []const Ref, control: Ref, initialize: bool },
    copy: struct { previous: Ref, value: Ref },
    call: struct { call: Ref, completion: Completion },
};
pub const Control = union(enum) {
    receiver_completion: struct { action: Ref },
    entry: void,
    join: struct { inputs: []const Ref },
    call: struct { call: Ref, completion: Completion },
};
pub const Call = struct { function_id: Symbol, arguments: []const []const Ref, environment: ?[]const Ref, callee: ?[]const Ref, receiver: ?[]const Ref, heap: Ref, control: Ref, site: Symbol };
pub const Exit = struct { heap: Ref, control: Ref };
pub const Exits = struct { normal: []const Exit, language: []const Exit };
pub const AccessFlag = enum { read, write, structural };
pub const Access = struct { values: []const Ref, flag: AccessFlag, control: Ref };
pub const Graph = struct {
    version: u32 = 5,
    nodes: []const Value,
    heaps: []const Heap,
    controls: []const Control,
    calls: []const Call,
    normal: []const Ref,
    language: []const Ref,
    exits: Exits,
    accesses: []const Access,
};
pub const Pending = enum { construction_frame, receiver_activation, environment_metadata, function_protocol };
pub const Validation = union(enum) { valid: void, pending: Pending };

fn require(condition: bool) Error!void { if (!condition) return error.InvalidGraph; }
fn reference(budget: *Budget, id: Ref, length: usize) Error!void {
    try budget.step(); if (id > 9007199254740991 or id >= length) return error.InvalidReference;
}
fn references(budget: *Budget, ids: []const Ref, length: usize) Error!void {
    try budget.step(); try budget.spend(ids.len);
    var previous: ?Ref = null;
    for (ids) |id| {
        try reference(budget, id, length);
        if (previous) |old| if (old >= id) return error.InvalidOrder;
        previous = id;
    }
}
fn nullableReferences(budget: *Budget, ids: ?[]const Ref, length: usize) Error!void {
    if (ids) |values| try references(budget, values, length) else try budget.step();
}
fn find(comptime Row: type, rows: []const Row, id: Symbol, budget: *Budget) Error!?*const Row {
    try budget.lookup(rows.len, id.len);
    var low: usize = 0; var high = rows.len;
    while (low < high) {
        const mid = low + (high - low) / 2;
        switch (std.mem.order(u8, rows[mid].id, id)) {
            .lt => low = mid + 1,
            .gt => high = mid,
            .eq => return &rows[mid],
        }
    }
    return null;
}
pub fn findFunction(directory: *const Directory, id: Symbol, budget: *Budget) Error!*const FunctionRow {
    return try find(FunctionRow, directory.functions, id, budget) orelse error.InvalidReference;
}
fn ownedType(directory: *const Directory, id: Symbol, budget: *Budget) Error!*const TypeRow {
    try budget.text(id.len);
    return try find(TypeRow, directory.types, id, budget) orelse error.InvalidReference;
}
fn ownedEnvironment(directory: *const Directory, id: Symbol, budget: *Budget) Error!*const EnvironmentRow {
    try budget.text(id.len);
    return try find(EnvironmentRow, directory.environments, id, budget) orelse error.InvalidReference;
}
fn signature(directory: *const Directory, function: *const FunctionRow, budget: *Budget) Error!void {
    try budget.step(); try budget.spend(function.parameter_types.len);
    for (function.parameter_types) |id| _ = try ownedType(directory, id, budget);
    _ = try ownedType(directory, function.return_type, budget);
}
fn protocol(function: *const FunctionRow, budget: *Budget) Error!?Pending {
    try budget.step();
    if (function.kind == .construction_body) return .construction_frame;
    if (!function.environment_metadata_complete) return .environment_metadata;
    if (function.kind != .source and function.kind != .method) return .function_protocol;
    return null;
}
fn ownedConstruction(directory: *const Directory, id: Symbol, budget: *Budget) Error!*const Construction {
    return try find(Construction, directory.constructions, id, budget) orelse error.InvalidReference;
}
fn constructionForOwner(directory: *const Directory, owner: Symbol, budget: *Budget) Error!*const Construction {
    try budget.spend(directory.constructions.len);
    for (directory.constructions) |*row| { try budget.step(); if (try budget.equal(row.owner, owner)) return row; }
    return error.InvalidReference;
}
fn constructionProtocol(directory: *const Directory, function: *const FunctionRow, budget: *Budget) Error!void {
    try budget.step();
    if (function.kind != .construction_body) { try require(function.construction == null); return; }
    const metadata = function.construction orelse return error.InvalidGraph;
    const row = try ownedConstruction(directory, metadata.id, budget);
    try require(metadata.receiver_index == 0 and function.parameter_types.len != 0 and row.function_id != null);
    try require(try budget.equal(row.function_id.?, function.id));
    try require(try budget.equal(metadata.owner, row.owner));
    try require(try budget.equal(function.parameter_types[0], row.owner));
    try require((metadata.base == null) == (row.base == null));
    if (metadata.base) |base| try require(try budget.equal(base, row.base.?));
}
fn sortedRows(comptime Row: type, rows: []const Row, budget: *Budget) Error!void {
    try budget.step(); try budget.spend(rows.len);
    var previous: ?Symbol = null;
    for (rows) |row| {
        try budget.step(); try budget.text(row.id.len);
        if (previous) |old| {
            try budget.text(old.len);
            if (std.mem.order(u8, old, row.id) != .lt) return error.InvalidOrder;
        }
        previous = row.id;
    }
}

// Checks only interpretation-directory structure. Stable scope/schema/group/hash
// admission remains the caller's separate prerequisite, never a returned token.
pub fn validateDirectory(allocator: std.mem.Allocator, directory: *const Directory, budget: *Budget) Error!void {
    _ = allocator;
    try sortedRows(TypeRow, directory.types, budget);
    try sortedRows(FunctionRow, directory.functions, budget);
    try sortedRows(GlobalRow, directory.globals, budget);
    try sortedRows(EnvironmentRow, directory.environments, budget);
    try sortedRows(Construction, directory.constructions, budget);
    try budget.step(); try budget.spend(directory.fields.len);
    var previous: ?Symbol = null;
    for (directory.fields) |field| {
        try budget.step(); try budget.text(field.len);
        if (previous) |old| {
            try budget.text(old.len);
            if (std.mem.order(u8, old, field) != .lt) return error.InvalidOrder;
        }
        previous = field;
    }
    try budget.spend(directory.functions.len);
    for (directory.functions) |function| {
        try signature(directory, &function, budget);
        try constructionProtocol(directory, &function, budget);
        if (function.lexical_environment) |id| _ = try ownedEnvironment(directory, id, budget);
        if (function.activation_environment) |id| _ = try ownedEnvironment(directory, id, budget);
    }
    try budget.spend(directory.constructions.len);
    for (directory.constructions, 0..) |row, index| {
        try budget.step(); const owner = try ownedType(directory, row.owner, budget);
        try require(owner.kind == .reference or owner.kind == .value);
        try require((row.kind == .explicit) == (row.function_id != null));
        if (row.function_id) |id| {
            const function = try findFunction(directory, id, budget); try require(function.kind == .construction_body);
            const metadata = function.construction orelse return error.InvalidGraph;
            try require(try budget.equal(metadata.id, row.id));
        }
        if (row.base) |base| { const shape = try ownedType(directory, base, budget); try require(shape.kind == .reference or shape.kind == .value); }
        try require(row.kind != .implicit_base or row.base == null); try require(row.kind != .implicit_derived or row.base != null);
        for (directory.constructions[0..index]) |old| { try budget.step(); try require(!try budget.equal(old.owner, row.owner)); }
    }
    for (directory.types) |row| {
        try budget.step(); if (row.kind != .reference and row.kind != .value) continue;
        const initial = try constructionForOwner(directory, row.id, budget); var base = initial.base; var depth: usize = 0;
        while (base) |id| {
            try budget.step(); if (depth >= directory.constructions.len) return error.InvalidGraph;
            base = (try constructionForOwner(directory, id, budget)).base; depth += 1;
        }
    }
    try budget.spend(directory.globals.len);
    for (directory.globals) |global| _ = try ownedType(directory, global.@"type", budget);
    try budget.spend(directory.environments.len);
    for (directory.environments) |environment| {
        try budget.step(); try budget.spend(environment.slots.len);
        for (environment.slots, 0..) |slot, index| {
            try budget.step(); try budget.text(slot.key.len); _ = try ownedType(directory, slot.@"type", budget);
            // Slot order is retained. Its identity is unique within this layout.
            try budget.spend(index);
            for (environment.slots[0..index]) |old| if (try budget.equal(old.key, slot.key)) return error.InvalidOrder;
        }
        var parent = environment.parent; var depth: usize = 0;
        while (parent) |id| {
            try budget.step();
            if (depth >= directory.environments.len) return error.InvalidGraph;
            const row = try ownedEnvironment(directory, id, budget);
            parent = row.parent; depth += 1;
        }
    }
}

fn captureSlot(directory: *const Directory, layout: Symbol, key: Symbol, budget: *Budget) Error!*const EnvironmentSlot {
    const environment = try ownedEnvironment(directory, layout, budget);
    try budget.spend(environment.slots.len);
    for (environment.slots) |*slot| {
        try budget.step(); if (try budget.equal(slot.key, key)) return slot;
    }
    return error.InvalidReference;
}
fn selector(directory: *const Directory, selected: Symbol, budget: *Budget) Error!void {
    try budget.text(selected.len);
    if (try budget.equal(selected, "element")) return;
    try budget.text(selected.len);
    if (!std.mem.startsWith(u8, selected, "field:")) return error.InvalidGraph;
    const id = selected[6..]; try budget.lookup(directory.fields.len, id.len);
    var low: usize = 0; var high = directory.fields.len;
    while (low < high) {
        const mid = low + (high - low) / 2;
        switch (std.mem.order(u8, directory.fields[mid], id)) {
            .lt => low = mid + 1, .gt => high = mid, .eq => return,
        }
    }
    return error.InvalidReference;
}
fn storeAddress(directory: *const Directory, selected: Symbol, view: Symbol, budget: *Budget) Error!void {
    try budget.text(selected.len); try budget.text(view.len);
    if (std.mem.startsWith(u8, selected, "capture:")) {
        if (!std.mem.startsWith(u8, view, "env:")) return error.InvalidGraph;
        _ = try captureSlot(directory, view[4..], selected[8..], budget);
    } else {
        try selector(directory, selected, budget); _ = try ownedType(directory, view, budget);
    }
}
fn states(rows: []const Exit, graph: *const Graph, budget: *Budget) Error!void {
    try budget.step(); try budget.spend(rows.len); var previous: ?Exit = null;
    for (rows) |row| {
        try reference(budget, row.heap, graph.heaps.len); try reference(budget, row.control, graph.controls.len);
        if (previous) |old| if (row.heap < old.heap or (row.heap == old.heap and row.control <= old.control)) return error.InvalidOrder;
        previous = row;
    }
}

// All graph index ranges are checked before this workspace traverses them.
const Carriers = struct {
    allocator: std.mem.Allocator,
    graph: *const Graph,
    budget: *Budget,
    seen: []bool,
    pending: []Ref,
    leaves: []Ref,
    ordinary: bool = false,
    frames: bool = false,
    fn init(allocator: std.mem.Allocator, graph: *const Graph, budget: *Budget) Error!Carriers {
        try budget.spend(graph.nodes.len);
        const seen = try allocator.alloc(bool, graph.nodes.len); errdefer allocator.free(seen);
        try budget.spend(graph.nodes.len);
        const pending = try allocator.alloc(Ref, graph.nodes.len); errdefer allocator.free(pending);
        try budget.spend(graph.nodes.len);
        const leaves = try allocator.alloc(Ref, graph.nodes.len);
        return .{ .allocator = allocator, .graph = graph, .budget = budget, .seen = seen, .pending = pending, .leaves = leaves };
    }
    fn deinit(self: *Carriers) void { self.allocator.free(self.seen); self.allocator.free(self.pending); self.allocator.free(self.leaves); }
    fn collect(self: *Carriers, roots: []const Ref) Error![]const Ref {
        try self.budget.spend(self.seen.len); @memset(self.seen, false); self.ordinary = false; self.frames = false;
        var count: usize = 0; var leaves: usize = 0;
        try self.budget.spend(roots.len);
        for (roots) |id| {
            try self.budget.step();
            if (!self.seen[id]) { self.seen[id] = true; self.pending[count] = id; count += 1; }
        }
        while (count != 0) {
            try self.budget.step(); count -= 1; const id = self.pending[count];
            switch (self.graph.nodes[id]) {
                inline .join, .gate => |row| {
                    try self.budget.spend(row.inputs.len);
                    for (row.inputs) |input| { try self.budget.step(); if (!self.seen[input]) { self.seen[input] = true; self.pending[count] = input; count += 1; } }
                },
                .receiver_input, .receiver_frame => { self.frames = true; self.leaves[leaves] = id; leaves += 1; },
                .environment_input, .environment_create, .environment_parent, .environment_component => { self.leaves[leaves] = id; leaves += 1; },
                else => self.ordinary = true,
            }
        }
        return self.leaves[0..leaves];
    }
    fn environment(self: *Carriers, values: []const Ref, expected: Symbol) Error!void {
        const selected = try self.collect(values); try require(!self.ordinary and !self.frames); try self.budget.spend(selected.len);
        for (selected) |id| {
            const layout = switch (self.graph.nodes[id]) { inline .environment_input, .environment_create, .environment_parent, .environment_component => |row| row.layout, else => unreachable };
            try self.budget.step(); try require(try self.budget.equal(layout, expected));
        }
    }
    fn environmentUnknown(self: *Carriers, values: []const Ref) Error!void { _ = try self.collect(values); try require(!self.ordinary and !self.frames); }
    fn payload(self: *Carriers, values: []const Ref) Error!void { try require((try self.collect(values)).len == 0 and !self.frames); }
    fn frame(self: *Carriers, values: []const Ref) Error!void { const selected = try self.collect(values); try require(selected.len != 0 and !self.ordinary and self.frames);
        for (selected) |id| { try self.budget.step(); try require(self.graph.nodes[id] == .receiver_input or self.graph.nodes[id] == .receiver_frame); }
    }
};

fn typedCarriers(allocator: std.mem.Allocator, directory: *const Directory, current: *const FunctionRow, graph: *const Graph, budget: *Budget) Error!void {
    var carriers = try Carriers.init(allocator, graph, budget); defer carriers.deinit();
    try budget.spend(graph.nodes.len);
    for (graph.nodes) |node| {
        try budget.step();
        switch (node) {
            .environment_create => |row| if (row.parent) |parent| { const environment = try ownedEnvironment(directory, row.layout, budget); try carriers.environment(parent, environment.parent.?); },
            .environment_parent => |row| {
                const selected = try carriers.collect(row.bases); try require(!carriers.ordinary and !carriers.frames); try budget.spend(selected.len);
                for (selected) |id| {
                    const layout = switch (graph.nodes[id]) { inline .environment_input, .environment_create, .environment_parent, .environment_component => |entry| entry.layout, else => unreachable };
                    const environment = try ownedEnvironment(directory, layout, budget);
                    try require(environment.parent != null); try require(try budget.equal(environment.parent.?, row.layout));
                }
            },
            .capture => |row| try carriers.environment(row.environment, row.layout),
            .environment_component => |row| try carriers.payload(row.callee),
            .code => |row| if (row.environment) |environment| {
                const function = try findFunction(directory, row.function_id, budget);
                if (function.environment_metadata_complete) try carriers.environment(environment, function.lexical_environment.?) else try carriers.environmentUnknown(environment);
            },
            inline .projection, .copy => |row| try carriers.payload(row.bases),
            .receiver_frame => |row| if (row.parent) |parent| {
                try carriers.frame(parent); const child = try ownedConstruction(directory, row.construction, budget);
                for (try carriers.collect(parent)) |id| {
                    try budget.step(); const parent_id = switch (graph.nodes[id]) { .receiver_input => current.construction.?.id, .receiver_frame => |entry| entry.construction, else => unreachable };
                    const owner = try ownedConstruction(directory, parent_id, budget);
                    try require(owner.base != null); try require(try budget.equal(owner.base.?, child.owner));
                }
            },
            .receiver_value => |row| { try require(graph.heaps[row.action] == .receiver_action); const action = graph.heaps[row.action].receiver_action; try require((action.completion == .language) == (row.@"type" == null)); },
            else => {},
        }
    }
    try budget.spend(graph.heaps.len);
    for (graph.heaps) |heap| {
        try budget.step();
        if (heap == .receiver_action) {
            const action = heap.receiver_action;
            try carriers.frame(action.frames); try carriers.payload(action.operands);
            if (action.action == .allocate) for (try carriers.collect(action.frames)) |id| {
                try budget.step();
                const construction = switch (graph.nodes[id]) { .receiver_input => current.construction.?.id, .receiver_frame => |row| row.construction, else => unreachable };
                try require((try ownedConstruction(directory, construction, budget)).base == null);
            };
        }
        if (heap == .store) {
            const row = heap.store; try budget.text(row.selector.len);
            if (std.mem.startsWith(u8, row.selector, "capture:")) try carriers.environment(row.bases, row.view[4..]) else try carriers.payload(row.bases);
            try carriers.payload(row.values);
        }
    }
    try budget.spend(graph.calls.len);
    for (graph.calls) |call| {
        try budget.step(); try budget.spend(call.arguments.len);
        for (call.arguments) |argument| try carriers.payload(argument);
        const function = try findFunction(directory, call.function_id, budget);
        if (call.receiver) |receiver| {
            try carriers.frame(receiver);
            for (try carriers.collect(receiver)) |id| {
                try budget.step(); const owner = switch (graph.nodes[id]) { .receiver_input => current.construction.?.id, .receiver_frame => |entry| entry.construction, else => unreachable };
                try require(try budget.equal(owner, function.construction.?.id));
            }
        }
        if (call.callee) |callee| {
            try carriers.payload(callee);
            if (call.environment) |environment| {
                if (function.environment_metadata_complete) try carriers.environment(environment, function.lexical_environment.?) else try carriers.environmentUnknown(environment);
                const selected = try carriers.collect(environment); try budget.spend(selected.len);
                for (selected) |id| {
                    try budget.step(); if (graph.nodes[id] != .environment_component) return error.InvalidGraph;
                    const component = graph.nodes[id].environment_component;
                    try require(try budget.equal(component.function_id, call.function_id));
                    try require(component.callee.len == callee.len); try budget.spend(callee.len);
                    try require(std.mem.eql(Ref, component.callee, callee));
                }
            }
        } else if (call.environment) |environment| {
            if (function.environment_metadata_complete) try carriers.environment(environment, function.lexical_environment.?) else try carriers.environmentUnknown(environment);
        }
    }
    try carriers.payload(graph.normal); try carriers.payload(graph.language);
    try budget.spend(graph.accesses.len);
    for (graph.accesses) |access| { try budget.step(); try carriers.payload(access.values); }
}

// Exact JSON access-key order without allocating JSON or sorting reference lists.
// The digits iterator emits the same control,flag,values canonical row bytes.
const AccessKey = struct {
    access: Access,
    phase: enum { prefix, control, flag_prefix, flag, values_prefix, value, comma, suffix, done } = .prefix,
    offset: usize = 0,
    index: usize = 0,
    digits: [24]u8 = undefined,
    digit_count: usize = 0,
    fn number(self: *AccessKey, value: Ref) void {
        const text = std.fmt.bufPrint(&self.digits, "{d}", .{value}) catch unreachable;
        self.digit_count = text.len; self.offset = 0;
    }
    fn chunk(self: *AccessKey, bytes: Symbol, next_phase: @TypeOf(self.phase)) ?u8 {
        if (self.offset < bytes.len) { const byte = bytes[self.offset]; self.offset += 1; return byte; }
        self.phase = next_phase; self.offset = 0; return null;
    }
    fn next(self: *AccessKey) ?u8 {
        while (true) {
            switch (self.phase) {
                .prefix => if (self.chunk("{\"control\":", .control)) |byte| return byte else self.number(self.access.control),
                .control => if (self.chunk(self.digits[0..self.digit_count], .flag_prefix)) |byte| return byte,
                .flag_prefix => if (self.chunk(",\"flag\":\"", .flag)) |byte| return byte,
                .flag => if (self.chunk(@tagName(self.access.flag), .values_prefix)) |byte| return byte,
                .values_prefix => if (self.chunk("\",\"values\":[", if (self.access.values.len == 0) .suffix else .value)) |byte| return byte else if (self.access.values.len != 0) self.number(self.access.values[0]),
                .value => if (self.chunk(self.digits[0..self.digit_count], if (self.index + 1 == self.access.values.len) .suffix else .comma)) |byte| return byte,
                .comma => { self.index += 1; self.number(self.access.values[self.index]); self.phase = .value; return ','; },
                .suffix => if (self.chunk("]}", .done)) |byte| return byte,
                .done => return null,
            }
        }
    }
};
fn accessKeyFee(row: Access, budget: *Budget) Error!usize {
    // Same canonical-key preparation rate; bytes are streamed, never allocated.
    try budget.spend(row.values.len); try budget.spend(32);
    for (row.values) |_| try budget.spend(24);
    const capacity = std.math.mul(usize, row.values.len, 24) catch return error.BudgetExceeded;
    try budget.text(std.math.add(usize, capacity, 80) catch return error.BudgetExceeded);
    var length: usize = 0; var iterator: AccessKey = .{ .access = row };
    // The complete upper fee precedes both decimal conversion and traversal.
    try budget.spend(row.values.len);
    while (iterator.next() != null) length += 1;
    return length;
}
fn accessOrder(a: Access, b: Access, a_length: usize, b_length: usize, budget: *Budget) Error!bool {
    try budget.text(a_length); try budget.text(b_length);
    var left: AccessKey = .{ .access = a }; var right: AccessKey = .{ .access = b };
    while (true) {
        const x = left.next(); const y = right.next();
        if (x == null) return y != null;
        if (y == null) return false;
        if (x.? != y.?) return x.? < y.?;
    }
}

// A static creation site cannot represent a fresh bind-once frame when its
// activation control depends on a cycle. Input-frame uses create no new frame.
// All ranges and carrier roles have already been checked by validateGraph.
pub fn receiverActivations(allocator: std.mem.Allocator, graph: *const Graph, budget: *Budget) Error!bool {
    var creates = false;
    for (graph.nodes) |node| { try budget.step(); if (node == .receiver_frame) { creates = true; break; } }
    if (!creates) return true;
    try budget.spend(graph.controls.len);
    const marks = try allocator.alloc(u2, graph.controls.len); defer allocator.free(marks); @memset(marks, 0);
    try budget.spend(graph.controls.len);
    const next = try allocator.alloc(usize, graph.controls.len); defer allocator.free(next); @memset(next, 0);
    try budget.spend(graph.controls.len);
    const stack = try allocator.alloc(Ref, graph.controls.len); defer allocator.free(stack);
    for (graph.nodes) |node| {
        try budget.step(); if (node != .receiver_frame) continue;
        const root = node.receiver_frame.control;
        if (marks[root] == 2) continue;
        marks[root] = 1; stack[0] = root; var count: usize = 1;
        while (count != 0) {
            try budget.step(); const id = stack[count - 1];
            const control = graph.controls[id];
            const length: usize = switch (control) { .entry => 0, .join => |row| row.inputs.len, .call, .receiver_completion => 1 };
            if (next[id] == length) { marks[id] = 2; count -= 1; continue; }
            const parent = switch (control) {
                .entry => unreachable,
                .join => |row| row.inputs[next[id]],
                .call => |row| graph.calls[row.call].control,
                .receiver_completion => |row| graph.heaps[row.action].receiver_action.control,
            };
            next[id] += 1;
            if (marks[parent] == 1) return false;
            if (marks[parent] == 0) { marks[parent] = 1; stack[count] = parent; count += 1; }
        }
    }
    return true;
}

// validateDirectory must have checked this borrowed directory once at the owning
// public entry. No scope/hash revalidation or permission-success marker is added.
pub fn validateGraph(allocator: std.mem.Allocator, directory: *const Directory, function_id: Symbol, graph: *const Graph, budget: *Budget) Error!Validation {
    const current = try findFunction(directory, function_id, budget);
    var pending = try protocol(current, budget);
    try signature(directory, current, budget); try budget.step(); try require(graph.version == 5);
    try budget.spend(graph.calls.len);
    for (graph.calls) |call| {
        try budget.step(); const function = try findFunction(directory, call.function_id, budget);
        if (try protocol(function, budget)) |reason| { if (pending == null) pending = reason; }
        try signature(directory, function, budget); try constructionProtocol(directory, function, budget);
        try require(call.arguments.len + @intFromBool(function.construction != null) == function.parameter_types.len);
        try require((call.receiver != null) == (function.construction != null));
        if (call.receiver != null) try require(call.callee == null);
        try nullableReferences(budget, call.receiver, graph.nodes.len);
        try reference(budget, call.heap, graph.heaps.len); try reference(budget, call.control, graph.controls.len); try budget.text(call.site.len);
        try nullableReferences(budget, call.environment, graph.nodes.len); try nullableReferences(budget, call.callee, graph.nodes.len);
        if (function.environment_metadata_complete) try require((function.lexical_environment != null) == (call.environment != null));
        try budget.spend(call.arguments.len);
        for (call.arguments) |argument| try references(budget, argument, graph.nodes.len);
    }
    try budget.spend(graph.nodes.len);
    for (graph.nodes) |node| {
        try budget.step();
        switch (node) {
            .literal => |row| { if (row.@"type") |id| _ = try ownedType(directory, id, budget); },
            .receiver_input => { try require(current.construction != null); if (pending == null) pending = .construction_frame; },
            .receiver_frame => |row| {
                _ = try ownedConstruction(directory, row.construction, budget);
                try require((row.new_target != null) == (row.parent == null));
                if (row.new_target) |id| {
                    const shape = try ownedType(directory, id, budget); try require(shape.kind == .reference or shape.kind == .value);
                    const requested = try ownedConstruction(directory, row.construction, budget); var target = try constructionForOwner(directory, id, budget); var depth: usize = 0;
                    while (!try budget.equal(target.owner, requested.owner)) {
                        try budget.step(); if (depth >= directory.constructions.len) return error.InvalidGraph;
                        target = try constructionForOwner(directory, target.base orelse return error.InvalidGraph, budget); depth += 1;
                    }
                }
                try nullableReferences(budget, row.parent, graph.nodes.len); try budget.text(row.site.len); try reference(budget, row.control, graph.controls.len);
                if (pending == null) pending = .construction_frame;
            },
            .receiver_value => |row| { if (row.@"type") |id| _ = try ownedType(directory, id, budget); try reference(budget, row.action, graph.heaps.len); if (pending == null) pending = .construction_frame; },
            .parameter => |row| { try require(current.construction == null or row.index != 0); _ = try ownedType(directory, row.@"type", budget); try reference(budget, row.index, current.parameter_types.len); try require(try budget.equal(row.@"type", current.parameter_types[row.index])); },
            .global => |row| { _ = try ownedType(directory, row.@"type", budget); const global = try find(GlobalRow, directory.globals, row.id, budget) orelse return error.InvalidReference; try require(try budget.equal(row.@"type", global.@"type")); },
            .capture => |row| {
                _ = try ownedType(directory, row.@"type", budget); const slot = try captureSlot(directory, row.layout, row.id, budget); try require(try budget.equal(row.@"type", slot.@"type"));
                try references(budget, row.environment, graph.nodes.len); try reference(budget, row.heap, graph.heaps.len); try reference(budget, row.control, graph.controls.len);
            },
            .environment_input => |row| {
                _ = try ownedEnvironment(directory, row.layout, budget);
                if (current.environment_metadata_complete) { try require(current.lexical_environment != null); try require(try budget.equal(row.layout, current.lexical_environment.?)); }
            },
            .environment_create => |row| {
                const environment = try ownedEnvironment(directory, row.layout, budget);
                if (current.environment_metadata_complete) { try require(current.activation_environment != null); try require(try budget.equal(row.layout, current.activation_environment.?)); }
                try require((environment.parent != null) == (row.parent != null)); try nullableReferences(budget, row.parent, graph.nodes.len); try budget.text(row.site.len); try reference(budget, row.control, graph.controls.len);
            },
            .environment_parent => |row| { _ = try ownedEnvironment(directory, row.layout, budget); try references(budget, row.bases, graph.nodes.len); try reference(budget, row.control, graph.controls.len); },
            .environment_component => |row| {
                _ = try ownedEnvironment(directory, row.layout, budget); const function = try findFunction(directory, row.function_id, budget);
                try require(function.kind == .source);
                if (!function.environment_metadata_complete) { if (pending == null) pending = .environment_metadata; } else { try require(function.lexical_environment != null); try require(try budget.equal(row.layout, function.lexical_environment.?)); }
                try references(budget, row.callee, graph.nodes.len); try reference(budget, row.control, graph.controls.len);
            },
            .code => |row| {
                const shape = try ownedType(directory, row.@"type", budget); const function = try findFunction(directory, row.function_id, budget);
                try require(function.kind == .source and shape.kind == .function);
                if (!function.environment_metadata_complete) { if (pending == null) pending = .environment_metadata; } else try require((function.lexical_environment != null) == (row.environment != null));
                try nullableReferences(budget, row.environment, graph.nodes.len); try reference(budget, row.control, graph.controls.len);
            },
            .local => |row| { const shape = try ownedType(directory, row.@"type", budget); try require(shape.kind != .unknown and shape.kind != .union_type and shape.kind != .@"void" and shape.kind != .future); },
            .nonowning => |row| { _ = try ownedType(directory, row.@"type", budget); },
            .unknown => {},
            inline .join, .gate => |row| { if (row.@"type") |id| _ = try ownedType(directory, id, budget); try references(budget, row.inputs, graph.nodes.len); if (@hasField(@TypeOf(row), "control")) try reference(budget, row.control, graph.controls.len); },
            .projection => |row| { _ = try ownedType(directory, row.@"type", budget); _ = try ownedType(directory, row.view, budget); try selector(directory, row.selector, budget); try references(budget, row.bases, graph.nodes.len); try reference(budget, row.heap, graph.heaps.len); try reference(budget, row.control, graph.controls.len); },
            .copy => |row| { _ = try ownedType(directory, row.@"type", budget); try budget.text(row.site.len); try references(budget, row.bases, graph.nodes.len); try reference(budget, row.heap, graph.heaps.len); try reference(budget, row.control, graph.controls.len); },
            .call => |row| {
                try reference(budget, row.call, graph.calls.len); if (row.@"type") |id| _ = try ownedType(directory, id, budget);
                if (row.completion == .language) try require(row.@"type" == null) else {
                    const function = try findFunction(directory, graph.calls[row.call].function_id, budget); try require(row.@"type" != null); try require(try budget.equal(row.@"type".?, if (function.construction) |construction| construction.owner else function.return_type));
                }
            },
        }
    }
    try budget.spend(graph.heaps.len);
    for (graph.heaps) |heap| {
        try budget.step();
        switch (heap) {
            .receiver_action => |row| {
                try reference(budget, row.previous, graph.heaps.len); try reference(budget, row.control, graph.controls.len); try references(budget, row.frames, graph.nodes.len); try references(budget, row.operands, graph.nodes.len);
                if (row.action == .allocate or row.action == .get) try require(row.operands.len == 0);
                if (pending == null) pending = .construction_frame;
            },
            .entry => {},
            .join => |row| try references(budget, row.inputs, graph.heaps.len),
            .store => |row| { try reference(budget, row.previous, graph.heaps.len); try references(budget, row.bases, graph.nodes.len); try references(budget, row.values, graph.nodes.len); try reference(budget, row.control, graph.controls.len); try storeAddress(directory, row.selector, row.view, budget); },
            .copy => |row| { try reference(budget, row.previous, graph.heaps.len); try reference(budget, row.value, graph.nodes.len); try require(graph.nodes[row.value] == .copy); },
            .call => |row| try reference(budget, row.call, graph.calls.len),
        }
    }
    try budget.spend(graph.controls.len);
    for (graph.controls) |control| {
        try budget.step(); switch (control) { .receiver_completion => |row| { try reference(budget, row.action, graph.heaps.len); try require(graph.heaps[row.action] == .receiver_action); if (pending == null) pending = .construction_frame; }, .entry => {}, .join => |row| try references(budget, row.inputs, graph.controls.len), .call => |row| try reference(budget, row.call, graph.calls.len) }
    }
    try references(budget, graph.normal, graph.nodes.len); try references(budget, graph.language, graph.nodes.len);
    try states(graph.exits.normal, graph, budget); try states(graph.exits.language, graph, budget);
    try budget.spend(graph.accesses.len); var previous: ?Access = null; var previous_length: usize = 0;
    for (graph.accesses) |access| {
        try budget.step(); try references(budget, access.values, graph.nodes.len); try reference(budget, access.control, graph.controls.len);
        const length = try accessKeyFee(access, budget);
        if (previous) |old| if (!try accessOrder(old, access, previous_length, length, budget)) return error.InvalidOrder;
        previous = access; previous_length = length;
    }
    try typedCarriers(allocator, directory, current, graph, budget);
    if (!try receiverActivations(allocator, graph, budget)) return .{ .pending = .receiver_activation };
    return if (pending) |reason| .{ .pending = reason } else .valid;
}
