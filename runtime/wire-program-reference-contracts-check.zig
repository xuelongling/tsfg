// SPDX-License-Identifier: MIT
// Common M12 logical/member relationships over the already owned typed graph.
// Reference/layout/SSA/identity checks must have succeeded with this Context.
// Compatibility rows are obligations, not authority merely because two rows
// agree: reconstruct effective members, logical dependencies and dispatch.
// No Source, actual heap/code target, allocation or execution proof is made.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;

const Pair = struct { source: t.TypeRef, target: t.TypeRef };
const ProofKey = struct { origin: t.Origin, pair: Pair };
const PairSet = std.AutoHashMapUnmanaged(Pair, void);
const Member = union(enum) { field: t.FieldRef, method: t.MethodRef, length: t.TypeRef };
const MemberSet = std.AutoHashMapUnmanaged(Member, void);
const MethodProjection = struct { pair: Pair, member: t.MethodRef };
const FieldProjection = struct { pair: Pair, member: t.FieldRef, actual: t.FieldRef };
const LogicalFrame = struct {
    pair: Pair,
    any: bool = false,
    next: usize = 0,
    children: std.ArrayListUnmanaged(Pair) = .empty,
    fn deinit(self: *LogicalFrame, allocator: std.mem.Allocator) void {
        self.children.deinit(allocator);
    }
};

const Checker = struct {
    c: *Context,
    common: tables.CommonTables,
    members: []MemberSet,
    own_fields: []std.ArrayListUnmanaged(t.FieldRef),
    own_methods: []std.ArrayListUnmanaged(t.MethodRef),
    methods: std.AutoHashMapUnmanaged(t.Hash, t.MethodRef) = .empty,
    proofs: std.AutoHashMapUnmanaged(ProofKey, void) = .empty,
    compatible: PairSet = .empty,
    method_projections: std.AutoHashMapUnmanaged(MethodProjection, t.MethodRef) = .empty,
    projected_methods: PairSet = .empty,
    field_projections: std.AutoHashMapUnmanaged(FieldProjection, void) = .empty,
    u32_type: ?t.TypeRef = null,
    void_type: ?t.TypeRef = null,

    fn init(c: *Context, common: tables.CommonTables) Error!Checker {
        try c.charge(common.types.len * 3);
        const members = try c.allocator.alloc(MemberSet, common.types.len);
        errdefer c.allocator.free(members);
        const own_fields = try c.allocator.alloc(std.ArrayListUnmanaged(t.FieldRef), common.types.len);
        errdefer c.allocator.free(own_fields);
        const own_methods = try c.allocator.alloc(std.ArrayListUnmanaged(t.MethodRef), common.types.len);
        @memset(members, .empty);
        @memset(own_fields, .empty);
        @memset(own_methods, .empty);
        return .{ .c = c, .common = common, .members = members, .own_fields = own_fields, .own_methods = own_methods };
    }
    fn deinit(self: *Checker) void {
        const allocator = self.c.allocator;
        for (self.members) |*row| row.deinit(allocator);
        for (self.own_fields) |*row| row.deinit(allocator);
        for (self.own_methods) |*row| row.deinit(allocator);
        allocator.free(self.members);
        allocator.free(self.own_fields);
        allocator.free(self.own_methods);
        self.methods.deinit(allocator);
        self.proofs.deinit(allocator);
        self.compatible.deinit(allocator);
        self.method_projections.deinit(allocator);
        self.projected_methods.deinit(allocator);
        self.field_projections.deinit(allocator);
    }
    fn nominal(self: *const Checker, id: t.TypeRef) bool {
        const kind = self.common.types[@intFromEnum(id)].kind;
        return kind == .reference or kind == .value;
    }
    fn ancestry(self: *Checker, actual: t.TypeRef, target: t.TypeRef) Error!bool {
        var current: ?t.TypeRef = actual;
        var count: usize = 0;
        while (current) |id| {
            try self.c.step();
            if (count == self.common.types.len) return error.InvalidShape;
            count += 1;
            if (id == target) return true;
            current = self.common.types[@intFromEnum(id)].base;
        }
        return false;
    }
    fn sameName(self: *Checker, left: []const u8, right: []const u8) Error!bool {
        try self.c.charge(1 + @min(left.len, right.len) / 64);
        return std.mem.eql(u8, left, right);
    }
    fn overrideOf(self: *Checker, method: t.MethodRef) Error!?t.MethodRef {
        try self.c.step();
        const id = self.common.members.methods[@intFromEnum(method)].override orelse return null;
        return self.methods.get(id) orelse error.InvalidReference;
    }
    fn implementation(self: *Checker, actual: t.TypeRef, member: t.MethodRef) Error!?t.MethodRef {
        var owner: ?t.TypeRef = actual;
        while (owner) |id| {
            try self.c.step();
            var selected: ?t.MethodRef = null;
            for (self.own_methods[@intFromEnum(id)].items) |candidate| {
                var current: ?t.MethodRef = candidate;
                var count: usize = 0;
                while (current) |method| {
                    try self.c.step();
                    if (count == self.common.members.methods.len) return error.InvalidShape;
                    count += 1;
                    if (method == member) {
                        try self.c.require(selected == null);
                        selected = candidate;
                        break;
                    }
                    current = try self.overrideOf(method);
                }
            }
            if (selected != null) return selected;
            owner = self.common.types[@intFromEnum(id)].base;
        }
        return null;
    }
    fn catalogue(self: *Checker) Error!void {
        const c = self.c;
        for (self.common.types, 0..) |row, index| {
            try c.step();
            if (row.kind == .scalar and row.native_code == 8) self.u32_type = @enumFromInt(index);
            if (row.kind == .@"void") self.void_type = @enumFromInt(index);
            if (row.base) |base| {
                try c.require(self.nominal(@enumFromInt(index)) and self.nominal(base));
                try c.require(!try self.ancestry(base, @enumFromInt(index)));
            }
        }
        for (self.common.members.fields, 0..) |field, index| {
            try c.step();
            try self.own_fields[@intFromEnum(field.owner)].append(c.allocator, @enumFromInt(index));
        }
        for (self.common.members.methods, 0..) |method, index| {
            try c.step();
            try c.require(self.nominal(method.owner));
            const implementation_fn = c.program.functions[@intFromEnum(method.function)];
            const owner_source = self.common.types[@intFromEnum(method.owner)].nominal_key.?.source;
            try c.require(implementation_fn.role == .ordinary and implementation_fn.source == owner_source);
            try c.require(try self.sameName(implementation_fn.name, method.name));
            try self.methods.put(c.allocator, method.id, @enumFromInt(index));
            try self.own_methods[@intFromEnum(method.owner)].append(c.allocator, @enumFromInt(index));
        }
        // The complete original own-method vector is a business join, not a
        // consequence of a valid MethodRef or a correctly hashed method ID.
        for (self.common.types, 0..) |row, index| {
            try c.step();
            const owned = self.own_methods[index].items;
            const listed = row.methods orelse &.{};
            try c.require(listed.len == owned.len);
            for (listed) |method| {
                try c.step();
                try c.require(@intFromEnum(self.common.members.methods[@intFromEnum(method)].owner) == index);
            }
            var names: std.StringHashMapUnmanaged(void) = .empty;
            defer names.deinit(c.allocator);
            for (owned) |method| {
                const actual = self.common.members.methods[@intFromEnum(method)];
                try c.charge(1 + actual.name.len / 64);
                try c.require(!(try names.getOrPut(c.allocator, actual.name)).found_existing);
                var nearest: ?t.MethodRef = null;
                var base = row.base;
                while (base) |parent| {
                    try c.step();
                    for (self.own_methods[@intFromEnum(parent)].items) |candidate| {
                        const inherited = self.common.members.methods[@intFromEnum(candidate)];
                        if (try self.sameName(actual.name, inherited.name)) {
                            try c.require(nearest == null);
                            nearest = candidate;
                        }
                    }
                    if (nearest != null) break;
                    base = self.common.types[@intFromEnum(parent)].base;
                }
                try c.require(try self.overrideOf(method) == nearest);
                if (nearest) |parent_method| {
                    const effective = try self.implementation(row.base.?, parent_method);
                    try c.require(effective == parent_method);
                }
            }
        }
        // Base to derived order preserves inherited fields, and replaces only
        // the exact overridden method, as the normalized C++ member catalogue.
        var chain: std.ArrayListUnmanaged(t.TypeRef) = .empty;
        defer chain.deinit(c.allocator);
        for (self.common.types, 0..) |row, index| {
            try c.step();
            const id: t.TypeRef = @enumFromInt(index);
            if (row.kind == .array or row.kind == .readSpan) {
                try self.members[index].put(c.allocator, .{ .length = id }, {});
                continue;
            }
            if (!self.nominal(id)) continue;
            chain.clearRetainingCapacity();
            var current: ?t.TypeRef = id;
            while (current) |owner| {
                try c.step();
                try chain.append(c.allocator, owner);
                current = self.common.types[@intFromEnum(owner)].base;
            }
            var at = chain.items.len;
            while (at != 0) {
                at -= 1;
                for (self.own_fields[@intFromEnum(chain.items[at])].items) |field| {
                    try c.step();
                    try self.members[index].put(c.allocator, .{ .field = field }, {});
                }
                for (self.own_methods[@intFromEnum(chain.items[at])].items) |method| {
                    try c.step();
                    if (try self.overrideOf(method)) |base_method| try c.require(self.members[index].remove(.{ .method = base_method }));
                    try self.members[index].put(c.allocator, .{ .method = method }, {});
                }
            }
        }
        for (self.common.views.compatibility) |proof| {
            try c.step();
            const pair = Pair{ .source = proof.source_type, .target = proof.target_type };
            try self.proofs.put(c.allocator, .{ .origin = proof.origin, .pair = pair }, {});
            try self.compatible.put(c.allocator, pair, {});
        }
    }

    fn popLogical(self: *Checker, frames: *std.ArrayListUnmanaged(LogicalFrame), active: *PairSet) void {
        var frame = frames.pop().?;
        _ = active.remove(frame.pair);
        frame.deinit(self.c.allocator);
    }
    // Iterative M12 relation. Source union is ALL; target union is ANY.
    // No dependency ledger escapes this boolean check. Cross Array/Span and
    // undefined->void use the Common policy; nominal inheritance is NOT an
    // implicit structural proof. Only an exact same-origin row supplies it.
    fn logical(self: *Checker, pair: Pair, origin: t.Origin) Error!bool {
        const c = self.c;
        var active: PairSet = .empty;
        defer active.deinit(c.allocator);
        var frames: std.ArrayListUnmanaged(LogicalFrame) = .empty;
        defer { for (frames.items) |*frame| frame.deinit(c.allocator); frames.deinit(c.allocator); }
        try c.step();
        try frames.append(c.allocator, .{ .pair = pair });
        var completed: ?bool = null;
        while (true) {
            try c.step();
            if (completed) |result| {
                if (frames.items.len == 0) return result;
                const parent = &frames.items[frames.items.len - 1];
                completed = null;
                if (if (parent.any) result else !result) {
                    self.popLogical(&frames, &active);
                    completed = result;
                    continue;
                }
                if (parent.next == parent.children.items.len) {
                    const outcome = !parent.any;
                    self.popLogical(&frames, &active);
                    completed = outcome;
                    continue;
                }
                const child = parent.children.items[parent.next];
                parent.next += 1;
                try c.step();
                try frames.append(c.allocator, .{ .pair = child });
                continue;
            }
            const frame = &frames.items[frames.items.len - 1];
            try c.require(!(try active.getOrPut(c.allocator, frame.pair)).found_existing);
            const from = self.common.types[@intFromEnum(frame.pair.source)];
            const to = self.common.types[@intFromEnum(frame.pair.target)];
            if (frame.pair.source == frame.pair.target) {
                self.popLogical(&frames, &active);
                completed = true;
                continue;
            }
            if (from.kind == .@"union" or to.kind == .@"union") {
                frame.any = from.kind != .@"union";
                const alternatives = if (frame.any) to.members else from.members;
                try c.charge(alternatives.len);
                for (alternatives) |alternative| try frame.children.append(c.allocator, if (frame.any)
                    .{ .source = frame.pair.source, .target = alternative }
                else .{ .source = alternative, .target = frame.pair.target });
            } else if ((from.kind == .array or from.kind == .readSpan) and (to.kind == .array or to.kind == .readSpan)) {
                try c.step();
                try frame.children.append(c.allocator, .{ .source = from.element.?, .target = to.element.? });
            } else {
                const matched = from.kind == .reference and to.kind == .reference and
                    self.proofs.contains(.{ .origin = origin, .pair = frame.pair });
                const outcome = matched or (from.kind == .@"undefined" and to.kind == .@"void");
                self.popLogical(&frames, &active);
                completed = outcome;
                continue;
            }
            if (frame.children.items.len == 0) {
                self.popLogical(&frames, &active);
                completed = false;
                continue;
            }
            const child = frame.children.items[0];
            frame.next = 1;
            try c.step();
            try frames.append(c.allocator, .{ .pair = child });
        }
    }
    fn fieldMember(value: tables.FieldLike) Member {
        return switch (value) { .field => |id| .{ .field = id }, .length => |id| .{ .length = id } };
    }
    fn memberName(self: *const Checker, member: Member) []const u8 {
        return switch (member) {
            .field => |id| self.common.members.fields[@intFromEnum(id)].name,
            .method => |id| self.common.members.methods[@intFromEnum(id)].name,
            .length => "length",
        };
    }
    fn memberHash(self: *const Checker, member: Member) t.Hash {
        return switch (member) {
            .field => |id| self.common.members.fields[@intFromEnum(id)].id,
            .method => |id| self.common.members.methods[@intFromEnum(id)].id,
            .length => |id| self.common.types[@intFromEnum(id)].id,
        };
    }
    fn memberOrder(self: *Checker, left: Member, right: Member) Error!std.math.Order {
        try self.c.step();
        // The normalized pseudo-key is "length:<TypeId>", before sha256 IDs.
        if ((left == .length) != (right == .length)) return if (left == .length) .lt else .gt;
        const left_hash = self.memberHash(left);
        const right_hash = self.memberHash(right);
        return std.mem.order(u8, &left_hash, &right_hash);
    }
    fn fieldType(self: *const Checker, member: Member) Error!t.TypeRef {
        return switch (member) {
            .field => |id| self.common.members.fields[@intFromEnum(id)].@"type",
            .length => self.u32_type orelse error.InvalidShape,
            .method => error.InvalidShape,
        };
    }
    fn methodAbi(self: *const Checker, method: t.MethodRef) *const @import("wire-program-storage.zig").CommonAbi {
        const function = self.common.members.methods[@intFromEnum(method)].function;
        return &self.common.abis[@intFromEnum(self.c.program.functions[@intFromEnum(function)].abi)];
    }
    fn addProjection(self: *Checker, key: MethodProjection, actual: t.MethodRef) Error!void {
        try self.c.step();
        const found = try self.method_projections.getOrPut(self.c.allocator, key);
        if (found.found_existing) try self.c.require(found.value_ptr.* == actual) else found.value_ptr.* = actual;
        try self.projected_methods.put(self.c.allocator, key.pair, {});
    }
    fn checkRows(self: *Checker) Error!void {
        const c = self.c;
        for (self.common.views.compatibility) |proof| {
            try c.step();
            const pair = Pair{ .source = proof.source_type, .target = proof.target_type };
            const actual_members = &self.members[@intFromEnum(pair.source)];
            const target_members = &self.members[@intFromEnum(pair.target)];
            var covered: MemberSet = .empty;
            defer covered.deinit(c.allocator);
            var previous_field: ?Member = null;
            for (proof.fields) |mapping| {
                try c.step();
                const actual = fieldMember(mapping.actual orelse return error.InvalidShape);
                const target = fieldMember(mapping.target);
                try c.require(actual_members.contains(actual) and target_members.contains(target));
                if (previous_field) |previous| try c.require(try self.memberOrder(previous, target) == .lt);
                previous_field = target;
                try c.require(!(try covered.getOrPut(c.allocator, target)).found_existing);
                try c.require(try self.sameName(self.memberName(actual), self.memberName(target)));
                try c.require(try self.logical(.{ .source = try self.fieldType(actual), .target = try self.fieldType(target) }, proof.origin));
                if (actual == .field and target == .field) {
                    try self.field_projections.put(c.allocator, .{ .pair = pair, .member = target.field, .actual = actual.field }, {});
                }
            }
            var previous_method: ?Member = null;
            for (proof.methods) |mapping| {
                try c.step();
                const actual = Member{ .method = mapping.actual };
                const target = Member{ .method = mapping.target };
                try c.require(actual_members.contains(actual) and target_members.contains(target));
                if (previous_method) |previous| try c.require(try self.memberOrder(previous, target) == .lt);
                previous_method = target;
                try c.require(!(try covered.getOrPut(c.allocator, target)).found_existing);
                try c.require(try self.sameName(self.memberName(actual), self.memberName(target)));
                const from = self.methodAbi(mapping.actual);
                const to = self.methodAbi(mapping.target);
                const result = to.result orelse self.void_type orelse return error.InvalidShape;
                if (self.common.types[@intFromEnum(result)].kind != .@"void") {
                    try c.require(try self.logical(.{ .source = from.result orelse self.void_type orelse return error.InvalidShape, .target = result }, proof.origin));
                }
                for (0..@min(from.parameters.len, to.parameters.len)) |index| {
                    try c.step();
                    const a = self.common.storage.bindings[@intFromEnum(from.parameters[index])].@"type";
                    const b = self.common.storage.bindings[@intFromEnum(to.parameters[index])].@"type";
                    try c.require(try self.logical(.{ .source = b, .target = a }, proof.origin));
                }
                try self.addProjection(.{ .pair = pair, .member = mapping.target }, mapping.actual);
            }
            // All selected keys came from the independently reconstructed
            // target directory, with no duplicates; cardinality proves its
            // complete coverage. Every reference leaf was looked up by exact
            // origin/Type pair above and its own row is also checked.
            try c.require(covered.count() == target_members.count());
        }
    }
    fn inheritProjections(self: *Checker) Error!void {
        const Entry = struct { key: MethodProjection, actual: t.MethodRef };
        var original: std.ArrayListUnmanaged(Entry) = .empty;
        defer original.deinit(self.c.allocator);
        try self.c.charge(self.method_projections.count());
        var entries = self.method_projections.iterator();
        while (entries.next()) |entry| try original.append(self.c.allocator, .{ .key = entry.key_ptr.*, .actual = entry.value_ptr.* });
        for (original.items) |entry| for (self.common.types, 0..) |_, index| {
            try self.c.step();
            const actual: t.TypeRef = @enumFromInt(index);
            if (!self.nominal(actual) or !try self.ancestry(actual, entry.key.pair.source)) continue;
            const selected = try self.implementation(actual, entry.actual) orelse return error.InvalidShape;
            try self.addProjection(.{ .pair = .{ .source = actual, .target = entry.key.pair.target }, .member = entry.key.member }, selected);
        };
    }
    fn selectedMethod(self: *Checker, actual: t.TypeRef, view: t.TypeRef, member: t.MethodRef) Error!?t.MethodRef {
        if (try self.implementation(actual, member)) |selected| return selected;
        const mapped = self.method_projections.get(.{ .pair = .{ .source = actual, .target = view }, .member = member }) orelse return null;
        return self.implementation(actual, mapped);
    }
    fn fieldProjected(self: *Checker, actual: t.TypeRef, view: t.TypeRef, member: t.FieldRef, selected: t.FieldRef) Error!bool {
        if (member == selected) return true;
        var current: ?t.TypeRef = actual;
        while (current) |source| {
            try self.c.step();
            if (self.field_projections.contains(.{ .pair = .{ .source = source, .target = view }, .member = member, .actual = selected })) return true;
            current = self.common.types[@intFromEnum(source)].base;
        }
        return false;
    }
    fn fieldEligible(self: *Checker, actual: t.TypeRef, view: t.TypeRef) Error!bool {
        var current: ?t.TypeRef = actual;
        while (current) |source| {
            try self.c.step();
            if (source == view or self.compatible.contains(.{ .source = source, .target = view })) return true;
            current = self.common.types[@intFromEnum(source)].base;
        }
        return false;
    }
    fn dispatches(self: *Checker) Error!void {
        const c = self.c;
        try c.charge(self.common.types.len);
        const provided = try c.allocator.alloc(bool, self.common.types.len);
        defer c.allocator.free(provided);
        for (self.common.views.dispatch) |dispatch| {
            try c.step();
            try c.charge(provided.len);
            @memset(provided, false);
            switch (dispatch) {
                .method => |row| {
                    try c.require(self.members[@intFromEnum(row.view)].contains(.{ .method = row.member }));
                    for (row.arms) |arm| {
                        try c.step();
                        try c.require(self.nominal(arm.actual));
                        const selected = try self.selectedMethod(arm.actual, row.view, row.member) orelse return error.InvalidShape;
                        const target = self.common.members.methods[@intFromEnum(selected)].function;
                        try c.require(arm.target == target and arm.abi == c.program.functions[@intFromEnum(target)].abi);
                        provided[@intFromEnum(arm.actual)] = true;
                    }
                    for (self.common.types, 0..) |_, index| {
                        try c.step();
                        const actual: t.TypeRef = @enumFromInt(index);
                        var expected = false;
                        if (self.nominal(actual) and (try self.ancestry(actual, row.view) or self.projected_methods.contains(.{ .source = actual, .target = row.view }))) {
                            expected = try self.selectedMethod(actual, row.view, row.member) != null;
                        }
                        try c.require(provided[index] == expected);
                    }
                },
                .field => |row| {
                    try c.require(self.members[@intFromEnum(row.view)].contains(.{ .field = row.member }));
                    for (row.arms) |arm| {
                        try c.step();
                        try c.require(self.nominal(arm.actual));
                        const target = arm.target orelse return error.InvalidShape;
                        try c.require(arm.abi == null and self.members[@intFromEnum(arm.actual)].contains(.{ .field = target }));
                        try c.require(try self.fieldProjected(arm.actual, row.view, row.member, target));
                        provided[@intFromEnum(arm.actual)] = true;
                    }
                    for (self.common.types, 0..) |_, index| {
                        try c.step();
                        const actual: t.TypeRef = @enumFromInt(index);
                        const expected = self.nominal(actual) and try self.fieldEligible(actual, row.view);
                        try c.require(provided[index] == expected);
                    }
                },
            }
        }
    }
};

// One passive typed business boundary, called once before compatibility rows
// may connect fixed-domain slots or authorize a method projection. The same
// Context owns every allocation/traversal charge. No marker or receipt is
// returned and neither the Program nor any producer table is modified.
pub fn checkCompatibility(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) { .common => |value| value, else => return error.WrongMode };
    var checker = try Checker.init(c, common);
    defer checker.deinit();
    try checker.catalogue();
    try checker.checkRows();
    try checker.inheritProjections();
    try checker.dispatches();
}
