// SPDX-License-Identifier: MIT
// New-version engineering candidate. Source-free construction control proof.
// Preconditions: references/layout and ordinary CFG/SSA succeeded using this
// SAME Context. This adds lifecycle rights, not actual objects, runtime frame
// state, effects/ReturnOrigins, M12 slot presence, parser or admission.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

// Borrowed ordinary SSA facts; the caller creates and owns these once.
pub const Definition = struct { block: usize, position: i32 };
pub const Facts = struct {
    successors: [2]usize = .{ 0, 0 }, count: usize = 0,
    predecessors: [4]u64 = .{ 0, 0, 0, 0 }, predecessor_count: usize = 0,
    reachable: bool = false, condition: bool = false,
};
pub const GraphView = struct { definitions: []const Definition, facts: []const Facts };
const Frame = struct { construction: t.ConstructionIndex, parent: ?t.RegisterRef = null, root: t.RegisterRef, new_target: ?t.TypeRef };
const Value = struct { allocated: ?t.RegisterRef = null, constructed: ?t.RegisterRef = null, bound: ?t.RegisterRef = null, binding: ?t.RegisterRef = null };
const Token = struct { frame: t.RegisterRef, binding: t.RegisterRef, position: usize };
const Right = struct { binding: t.RegisterRef, token: ?t.RegisterRef = null };
const State = struct { block: usize, rights: []const Right };

const Check = struct {
    c: *Context, common: tables.CommonTables, f: *const model.Function, view: GraphView,
    frames: []?Frame, values: []?Value, tokens: []?Token, entry_frame: ?t.RegisterRef = null,

    fn carrier(self: *const Check, r: t.RegisterRef) t.Carrier { return self.f.registers[@intFromEnum(r)].carrier; }
    fn languageValue(self: *Check, r: t.RegisterRef) Error!void {
        const value = self.carrier(r);
        try self.c.require(value == .@"type" or value == .domain or value == .payload);
    }
    fn selected(self: *Check, r: t.RegisterRef, owner: t.TypeRef) Error!void {
        try self.c.require(self.f.registers[@intFromEnum(r)].view == owner);
        try self.languageValue(r);
    }
    fn bodyFrame(self: *Check, r: t.RegisterRef) Error!void {
        // An explicit local frame delegates its entire Construct to invoke.
        // Only its owning constructor ABI entry may execute the body protocol;
        // implicit constructions have no body function and remain inline.
        const value = self.carrier(r);
        const row = self.common.members.constructions[@intFromEnum(value.receiver)];
        const abi = self.common.abis[@intFromEnum(self.f.abi)];
        try self.c.charge(6);
        if (row.function) |function| {
            try self.c.require(row.kind == .explicit and self.entry_frame == r and self.f.role == .construction_body and abi.function == function and abi.construction != null and @intFromEnum(abi.construction.?) == @intFromEnum(value.receiver));
        } else try self.c.require(row.kind != .explicit);
    }
    fn control(self: *Check, r: t.RegisterRef, construction: t.ConstructionIndex, initialization: bool) Error!void {
        const value = self.carrier(r);
        try self.c.require(if (initialization) value == .initialization else value == .receiver);
        const directory = if (initialization) value.initialization else value.receiver;
        try self.c.require(@intFromEnum(directory) == @intFromEnum(construction) and self.f.registers[@intFromEnum(r)].view == null);
    }
    fn exclusive(self: *Check, from: usize, normal: t.BlockRef, language: t.BlockRef, owner: t.TypeRef) Error!t.RegisterRef {
        for ([_]t.BlockRef{ normal, language }) |target| {
            const fact = self.view.facts[@intFromEnum(target)];
            try self.c.require(fact.predecessor_count == 1 and fact.predecessors[from / 64] & (@as(u64, 1) << @as(u6, @intCast(from % 64))) != 0);
        }
        const result = self.f.blocks[@intFromEnum(normal)].parameters[0];
        try self.selected(result, owner);
        const failure = self.f.blocks[@intFromEnum(language)].parameters[0];
        try self.c.require(self.carrier(failure) == .payload);
        return result;
    }
    fn shapes(self: *Check) Error!void {
        const c = self.c;
        for (self.f.blocks, 0..) |block, b| for (block.instructions) |op| {
            try c.charge(op.operands.len + 1);
            switch (op.data) {
                .receiver_create => |v| {
                    const row = self.common.members.constructions[@intFromEnum(v.construction)];
                    try c.require(row.owner == v.new_target); try self.control(op.result.?, v.construction, false);
                },
                .receiver_child => |v| try self.control(op.result.?, v.construction, false),
                .receiver_allocate => |v| {
                    const row = self.common.members.constructions[@intFromEnum(v.construction)];
                    try self.control(op.operands[0], v.construction, false);
                    try c.require(self.common.types[@intFromEnum(row.owner)].base == null); try self.selected(op.result.?, row.owner);
                },
                inline .receiver_bind, .receiver_get, .receiver_result => |v| {
                    const row = self.common.members.constructions[@intFromEnum(v.construction)];
                    try self.control(op.operands[0], v.construction, false);
                    _ = try self.exclusive(b, v.normal, v.language, row.owner);
                    if (op.data == .receiver_result and op.operands.len == 2) try self.languageValue(op.operands[1]);
                },
                .initialize_begin => |v| {
                    try self.control(op.operands[0], v.construction, false); try self.control(op.result.?, v.construction, true);
                },
                .initialize_field => |v| {
                    try self.control(op.operands[0], v.construction, true); try self.control(op.result.?, v.construction, true);
                    const field = self.common.members.fields[@intFromEnum(v.field)];
                    try c.require(field.owner == self.common.members.constructions[@intFromEnum(v.construction)].owner);
                    const capacity = self.common.storage.bindings[@intFromEnum(field.binding)].carrier;
                    try c.require(std.meta.eql(self.carrier(op.operands[2]), capacity));
                },
                .initialize_end => |v| try self.control(op.operands[0], v.construction, true),
                .eh_invoke => |call| {
                    const abi = self.common.abis[@intFromEnum(c.program.functions[@intFromEnum(call.callee)].abi)];
                    if (abi.construction) |construction| {
                        const row = self.common.members.constructions[@intFromEnum(construction)];
                        _ = try self.exclusive(b, call.normal, call.exceptional, row.owner);
                    }
                },
                else => {},
            }
            for (op.operands, 0..) |r, ordinal| {
                const value = self.carrier(r);
                if (value == .initialization) try c.require(ordinal == 0 and (op.data == .initialize_field or op.data == .initialize_end));
                if (value != .receiver) continue;
                const allowed = switch (op.data) {
                    .receiver_child, .receiver_allocate, .receiver_bind, .receiver_get, .receiver_result, .initialize_begin => blk: {
                        try self.bodyFrame(r); break :blk ordinal == 0;
                    },
                    .eh_invoke => |call| blk: {
                        const abi = self.common.abis[@intFromEnum(self.c.program.functions[@intFromEnum(call.callee)].abi)];
                        break :blk abi.construction != null and abi.receiver_frame != null and ordinal == abi.receiver_frame.? and @intFromEnum(value.receiver) == @intFromEnum(abi.construction.?);
                    },
                    else => false,
                };
                try c.require(allowed);
            }
            if (op.result) |r| {
                if (self.carrier(r) == .receiver) try c.require(op.data == .receiver_create or op.data == .receiver_child);
                if (self.carrier(r) == .initialization) try c.require(op.data == .initialize_begin or op.data == .initialize_field);
            }
        };
        for (self.f.blocks) |block| for (block.parameters) |r| {
            try c.step(); try c.require(self.carrier(r) != .initialization);
            if (self.carrier(r) == .receiver) {
                // The ordinary SSA directory already identifies the defining
                // entry; control frames cannot be ordinary phi alternatives.
                const definition = self.view.definitions[@intFromEnum(r)];
                try c.require(self.entry_frame == r and definition.block == 0 and definition.position == -1);
            }
        };
    }
    fn lineage(self: *Check) Error!void {
        const c = self.c;
        var changed = true;
        while (changed) {
            changed = false;
            for (self.f.blocks) |block| for (block.instructions) |op| {
                try c.charge(op.operands.len + 1);
                if (op.data == .receiver_create) {
                    const r = op.result.?; const v = op.data.receiver_create;
                    if (self.frames[@intFromEnum(r)] == null) { self.frames[@intFromEnum(r)] = .{ .construction = v.construction, .root = r, .new_target = v.new_target }; changed = true; }
                } else if (op.data == .receiver_child) {
                    const r = op.result.?; const parent = self.frames[@intFromEnum(op.operands[0])] orelse continue;
                    const construction = op.data.receiver_child.construction;
                    const owner = self.common.members.constructions[@intFromEnum(construction)].owner;
                    const parent_owner = self.common.members.constructions[@intFromEnum(parent.construction)].owner;
                    try c.require(self.common.types[@intFromEnum(parent_owner)].base == owner);
                    if (self.frames[@intFromEnum(r)] == null) { self.frames[@intFromEnum(r)] = .{ .construction = construction, .parent = op.operands[0], .root = parent.root, .new_target = parent.new_target }; changed = true; }
                } else if (op.data == .receiver_allocate) {
                    const r = op.result.?;
                    if (self.frames[@intFromEnum(op.operands[0])] != null and self.values[@intFromEnum(r)] == null) { self.values[@intFromEnum(r)] = .{ .allocated = op.operands[0] }; changed = true; }
                } else if (op.data == .domain_view or op.data == .eh_carrier) {
                    const r = op.result.?;
                    if (self.values[@intFromEnum(r)] == null) if (self.values[@intFromEnum(op.operands[0])]) |input| { self.values[@intFromEnum(r)] = input; changed = true; };
                } else if (op.data == .receiver_bind or op.data == .receiver_get or op.data == .receiver_result) {
                    const frame_reg = op.operands[0]; const frame = self.frames[@intFromEnum(frame_reg)] orelse continue;
                    const normal = switch (op.data) { inline .receiver_bind, .receiver_get, .receiver_result => |v| v.normal, else => unreachable };
                    const r = self.f.blocks[@intFromEnum(normal)].parameters[0];
                    if (self.values[@intFromEnum(r)] != null) continue;
                    var value: Value = .{};
                    if (op.data == .receiver_result) value.constructed = frame_reg else if (op.data == .receiver_get) value.bound = frame_reg else {
                        const input = self.values[@intFromEnum(op.operands[1])] orelse continue;
                        const owner = self.common.members.constructions[@intFromEnum(frame.construction)].owner;
                        if (self.common.types[@intFromEnum(owner)].base) |base| {
                            const child = self.frames[@intFromEnum(input.constructed orelse continue)] orelse continue;
                            try c.require(child.parent == frame_reg and self.common.members.constructions[@intFromEnum(child.construction)].owner == base and child.root == frame.root and child.new_target == frame.new_target);
                        } else try c.require(input.allocated == frame_reg);
                        value.bound = frame_reg; value.binding = r;
                    }
                    self.values[@intFromEnum(r)] = value; changed = true;
                } else if (op.data == .eh_invoke) {
                    const call = op.data.eh_invoke;
                    const abi = self.common.abis[@intFromEnum(c.program.functions[@intFromEnum(call.callee)].abi)];
                    const construction = abi.construction orelse continue;
                    const r = self.f.blocks[@intFromEnum(call.normal)].parameters[0];
                    const frame_reg = op.operands[abi.receiver_frame.?];
                    const frame = self.frames[@intFromEnum(frame_reg)] orelse continue;
                    try c.require(frame.construction == construction);
                    if (self.values[@intFromEnum(r)] == null) { self.values[@intFromEnum(r)] = .{ .constructed = frame_reg }; changed = true; }
                } else if (op.data == .initialize_begin) {
                    const r = op.result.?; if (self.tokens[@intFromEnum(r)] != null) continue;
                    const input = self.values[@intFromEnum(op.operands[1])] orelse continue;
                    try c.require(self.frames[@intFromEnum(op.operands[0])] != null and input.bound == op.operands[0] and input.binding != null);
                    self.tokens[@intFromEnum(r)] = .{ .frame = op.operands[0], .binding = input.binding.?, .position = 0 }; changed = true;
                } else if (op.data == .initialize_field) {
                    const r = op.result.?; if (self.tokens[@intFromEnum(r)] != null) continue;
                    const token = self.tokens[@intFromEnum(op.operands[0])] orelse continue;
                    const input = self.values[@intFromEnum(op.operands[1])] orelse continue;
                    const frame = self.frames[@intFromEnum(token.frame)].?;
                    const fields = self.common.members.constructions[@intFromEnum(frame.construction)].initialization_fields;
                    try c.require(token.position < fields.len and fields[token.position] == op.data.initialize_field.field and input.bound == token.frame and input.binding == token.binding);
                    self.tokens[@intFromEnum(r)] = .{ .frame = token.frame, .binding = token.binding, .position = token.position + 1 }; changed = true;
                }
            };
        }
        for (self.f.blocks) |block| for (block.instructions) |op| {
            try c.step();
            switch (op.data) {
                .receiver_create, .receiver_child => try c.require(self.frames[@intFromEnum(op.result.?)] != null),
                .receiver_allocate => try c.require(self.values[@intFromEnum(op.result.?)] != null),
                inline .receiver_bind, .receiver_get, .receiver_result => |v| try c.require(self.values[@intFromEnum(self.f.blocks[@intFromEnum(v.normal)].parameters[0])] != null),
                .initialize_begin, .initialize_field => try c.require(self.tokens[@intFromEnum(op.result.?)] != null),
                .initialize_end => {
                    const token = self.tokens[@intFromEnum(op.operands[0])] orelse return error.InvalidShape;
                    const input = self.values[@intFromEnum(op.operands[1])] orelse return error.InvalidShape;
                    const frame = self.frames[@intFromEnum(token.frame)].?;
                    try c.require(token.position == self.common.members.constructions[@intFromEnum(frame.construction)].initialization_fields.len and input.bound == token.frame and input.binding == token.binding);
                },
                .@"return" => if (self.entry_frame) |frame| {
                    const value = self.values[@intFromEnum(op.operands[0])] orelse return error.InvalidShape;
                    try c.require(value.constructed == frame);
                },
                else => {},
            }
        };
    }
    fn enqueue(self: *Check, states: *std.ArrayListUnmanaged(State), block: usize, rights: []const Right) Error!void {
        // Compare before allocating. All sequence comparison/copy work is paid
        // before traversal; sorted bindings give canonical join alternatives.
        for (states.items) |state| {
            try self.c.step(); if (state.block != block or state.rights.len != rights.len) continue;
            try self.c.charge(rights.len); var equal = true;
            for (state.rights, rights) |a, b| if (!std.meta.eql(a, b)) { equal = false; break; };
            if (equal) return;
        }
        // ArrayList growth can copy the already retained State directory too.
        try self.c.charge(rights.len + states.items.len + 1);
        const copy = try self.c.allocator.dupe(Right, rights); errdefer self.c.allocator.free(copy);
        try states.append(self.c.allocator, .{ .block = block, .rights = copy });
    }
    fn unfinished(self: *Check, rights: []const Right, frame: t.RegisterRef) Error!void {
        for (rights) |right| { try self.c.step(); try self.c.require(self.values[@intFromEnum(right.binding)].?.bound != frame); }
    }
    fn checkRights(self: *Check) Error!void {
        const c = self.c;
        var states: std.ArrayListUnmanaged(State) = .empty;
        defer { for (states.items) |state| c.allocator.free(state.rights); states.deinit(c.allocator); }
        try self.enqueue(&states, 0, &.{});
        var cursor: usize = 0;
        while (cursor < states.items.len) : (cursor += 1) {
            const state = states.items[cursor];
            var current: std.ArrayListUnmanaged(Right) = .empty; defer current.deinit(c.allocator);
            try c.charge(state.rights.len + 1); try current.appendSlice(c.allocator, state.rights);
            const block = self.f.blocks[state.block];
            for (block.instructions) |op| {
                try c.charge(op.operands.len + 1);
                if (op.data == .initialize_begin or op.data == .initialize_field or op.data == .initialize_end) {
                    const token = self.tokens[@intFromEnum(if (op.data == .initialize_begin) op.result.? else op.operands[0])].?;
                    var found: ?usize = null;
                    for (current.items, 0..) |right, i| { try c.step(); if (right.binding == token.binding) { found = i; break; } }
                    const index = found orelse return error.InvalidShape;
                    try c.require(current.items[index].token == if (op.data == .initialize_begin) null else op.operands[0]);
                    if (op.data == .initialize_end) { try c.charge(current.items.len - index); _ = current.orderedRemove(index); }
                    else current.items[index].token = op.result.?;
                } else if (op.data == .receiver_create or op.data == .receiver_child) try self.unfinished(current.items, op.result.?);
                switch (op.data) {
                    inline .receiver_bind, .receiver_get, .receiver_result => |v| {
                        if (op.data != .receiver_get) try self.unfinished(current.items, op.operands[0]);
                        if (op.data == .receiver_bind) {
                            const binding = self.f.blocks[@intFromEnum(v.normal)].parameters[0]; var index: usize = 0;
                            while (index < current.items.len) : (index += 1) { try c.step(); if (@intFromEnum(current.items[index].binding) >= @intFromEnum(binding)) break; }
                            try c.require(index == current.items.len or current.items[index].binding != binding);
                            try c.charge(2 * current.items.len + 1); try current.insert(c.allocator, index, .{ .binding = binding });
                        }
                        try self.enqueue(&states, @intFromEnum(v.normal), current.items); try self.enqueue(&states, @intFromEnum(v.language), &.{});
                    },
                    inline .eh_invoke, .eh_invoke_indirect, .common_method_invoke => |v| {
                        try self.enqueue(&states, @intFromEnum(v.normal), current.items); try self.enqueue(&states, @intFromEnum(v.exceptional), &.{});
                    },
                    .@"return" => try c.require(current.items.len == 0),
                    .eh_route => |v| try self.enqueue(&states, @intFromEnum(v.successor), if (v.completion == .@"throw") &.{} else current.items),
                    .br, .cond_br, .domain_numeric_use => for (self.view.facts[state.block].successors[0..self.view.facts[state.block].count]) |next| try self.enqueue(&states, next, current.items),
                    else => {}, // throw/unreachable/request termination abandons rights only.
                }
            }
        }
    }
};

// Not a whole-Program validator. No Program is constructed or published here.
pub fn check(c: *Context, function: usize, view: GraphView) Error!void {
    if (c.program.tables.mode != .common) return error.WrongMode;
    const f = &c.program.functions[function]; const common = c.program.tables.mode.common;
    const abi = common.abis[@intFromEnum(f.abi)];
    var relevant = abi.construction != null;
    for (f.registers) |r| { try c.step(); if (r.carrier == .receiver or r.carrier == .initialization) relevant = true; }
    for (f.blocks) |block| for (block.instructions) |op| {
        try c.step();
        switch (op.data) {
            .receiver_create, .receiver_child, .receiver_allocate, .receiver_bind, .receiver_get, .receiver_result, .initialize_begin, .initialize_field, .initialize_end => relevant = true,
            else => {},
        }
    };
    if (!relevant) return;
    try c.charge(3 * f.registers.len);
    const frames = try c.allocator.alloc(?Frame, f.registers.len); defer c.allocator.free(frames); @memset(frames, null);
    const values = try c.allocator.alloc(?Value, f.registers.len); defer c.allocator.free(values); @memset(values, null);
    const tokens = try c.allocator.alloc(?Token, f.registers.len); defer c.allocator.free(tokens); @memset(tokens, null);
    var proof = Check{ .c = c, .common = common, .f = f, .view = view, .frames = frames, .values = values, .tokens = tokens };
    if (abi.construction) |construction| {
        const entry = f.blocks[0].parameters[abi.receiver_frame.?]; proof.entry_frame = entry;
        frames[@intFromEnum(entry)] = .{ .construction = construction, .root = entry, .new_target = null };
    }
    try proof.shapes(); try proof.lineage(); try proof.checkRights();
}
