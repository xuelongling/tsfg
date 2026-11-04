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
    // implicit structural proof. Only an exact same-origin row supplies it; a
    // null origin provides no nonidentity reference proof.
    fn logical(self: *Checker, pair: Pair, origin: ?t.Origin) Error!bool {
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
                try c.step();
                const matched = if (origin) |proof_origin| blk: {
                    if (from.kind != .reference or to.kind != .reference) break :blk false;
                    try c.step();
                    break :blk self.proofs.contains(.{ .origin = proof_origin, .pair = frame.pair });
                } else false;
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
    fn methodCompatible(self: *Checker, actual: t.MethodRef, target: t.MethodRef, origin: ?t.Origin) Error!void {
        const c = self.c;
        try c.charge(6);
        const from = self.methodAbi(actual);
        const to = self.methodAbi(target);
        const result = to.result orelse self.void_type orelse return error.InvalidShape;
        try c.step();
        if (self.common.types[@intFromEnum(result)].kind != .@"void") {
            try c.require(try self.logical(.{ .source = from.result orelse self.void_type orelse return error.InvalidShape, .target = result }, origin));
        }
        // Keep the existing total-count and logical-type rules. Explicit minima
        // do not authorize omitted call operands, parameter padding or defaults.
        try c.require(from.parameters.len <= to.parameters.len);
        try c.require(from.method_minimum_argument_count.? <= to.method_minimum_argument_count.?);
        for (0..from.parameters.len) |index| {
            try c.charge(3);
            const a = self.common.storage.bindings[@intFromEnum(from.parameters[index])].@"type";
            const b = self.common.storage.bindings[@intFromEnum(to.parameters[index])].@"type";
            try c.require(try self.logical(.{ .source = b, .target = a }, origin));
        }
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
                try self.methodCompatible(mapping.actual, mapping.target, proof.origin);
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
        const Entry = struct { key: MethodProjection, actual: t.MethodRef, origin: t.Origin };
        var original: std.ArrayListUnmanaged(Entry) = .empty;
        defer original.deinit(self.c.allocator);
        var count: usize = 0;
        for (self.common.views.compatibility) |proof| { try self.c.step(); count += proof.methods.len; }
        try self.c.charge(count);
        try original.ensureTotalCapacityPrecise(self.c.allocator, count);
        // Preserve every original declaration's exact origin, including multiple
        // origins for one projection; the derived map contains no proof origin.
        for (self.common.views.compatibility) |proof| {
            try self.c.step();
            for (proof.methods) |mapping| {
                try self.c.charge(8);
                original.appendAssumeCapacity(.{ .key = .{ .pair = .{ .source = proof.source_type, .target = proof.target_type }, .member = mapping.target },
                    .actual = mapping.actual, .origin = proof.origin });
            }
        }
        for (original.items) |entry| for (self.common.types, 0..) |_, index| {
            try self.c.step();
            const actual: t.TypeRef = @enumFromInt(index);
            if (!self.nominal(actual) or !try self.ancestry(actual, entry.key.pair.source)) continue;
            const selected = try self.implementation(actual, entry.actual) orelse return error.InvalidShape;
            try self.methodCompatible(selected, entry.key.member, entry.origin);
            try self.addProjection(.{ .pair = .{ .source = actual, .target = entry.key.pair.target }, .member = entry.key.member }, selected);
        };
    }
    fn selectedMethod(self: *Checker, actual: t.TypeRef, view: t.TypeRef, member: t.MethodRef) Error!?t.MethodRef {
        try self.c.charge(4);
        if (self.method_projections.get(.{ .pair = .{ .source = actual, .target = view }, .member = member })) |mapped| {
            // Reuse the final choice already checked under its original proof
            // origin, even when the nominal route can reach the same member.
            const selected = try self.implementation(actual, mapped) orelse return error.InvalidShape;
            if (try self.implementation(actual, member)) |direct| try self.c.require(direct == selected);
            return selected;
        }
        if (try self.implementation(actual, member)) |selected| {
            // A nominal route carries no structural proof origin. Only the
            // intrinsic logical rules may establish this final override shape.
            try self.methodCompatible(selected, member, null);
            return selected;
        }
        return null;
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

// A typed exported-input role is separate from physical carrier capacity. This
// projection consumes the original parameter selector and its complete logical
// candidate set once. It grants no actual tag, allocation, lifetime or noalias.
pub const EntryRole = struct { logical_type: t.TypeRef };
pub const EntryRoles = struct {
    allocator: std.mem.Allocator,
    parameters: []?EntryRole,
    pub fn deinit(self: *EntryRoles) void { self.allocator.free(self.parameters); }
};
fn entryPush(c: *Context, pending: *std.ArrayListUnmanaged(t.TypeRef), id: t.TypeRef) Error!void {
    try c.charge(1+@as(usize,if(pending.items.len==pending.capacity)pending.items.len else 0));
    try pending.append(c.allocator,id);
}
fn entryPair(c: *Context, pairs: *PairSet, pair: Pair) Error!void {
    try c.step(); if(pairs.contains(pair))return;
    if(pairs.available==0) {
        const previous=pairs.capacity(); const next=@max(@as(usize,8),@as(usize,previous)*2);
        try c.charge(previous+next+pairs.count()+1); try pairs.ensureUnusedCapacity(c.allocator,1);
    }
    pairs.putAssumeCapacityNoClobber(pair,{});
}
pub fn projectEntries(c: *Context) Error!EntryRoles {
    const v=switch(c.program.tables.mode) { .common => |value|value, else=>return error.WrongMode };
    try c.charge(v.storage.bindings.len*2+v.types.len);
    const parameters=try c.allocator.alloc(?EntryRole,v.storage.bindings.len); errdefer c.allocator.free(parameters); @memset(parameters,null);
    const expected=try c.allocator.alloc(bool,v.storage.bindings.len); defer c.allocator.free(expected); @memset(expected,false);
    const seen=try c.allocator.alloc(bool,v.types.len); defer c.allocator.free(seen);
    // Export aliases share the one real function/parameter occurrence.
    for(v.modules.modules) |module| {
        try c.step(); if(module.source!=c.program.root_source)continue;
        for(module.exports) |item| {
            try c.step(); if(item.kind!=.function)continue;
            var selected: ?t.FunctionRef=null;
            for(c.program.functions,0..) |function,index| {
                try c.charge(5); if(std.mem.eql(u8,&function.id,&item.target)) { selected=@enumFromInt(index); break; }
            }
            const function=selected orelse return error.InvalidReference;
            for(v.abis[@intFromEnum(c.program.functions[@intFromEnum(function)].abi)].parameters) |binding| { try c.step(); expected[@intFromEnum(binding)]=true; }
        }
    }
    var pending: std.ArrayListUnmanaged(t.TypeRef)=.empty; defer pending.deinit(c.allocator);
    var overrides: std.ArrayListUnmanaged(t.Hash)=.empty; defer overrides.deinit(c.allocator);
    for(v.views.entries) |row| {
        try c.row(@TypeOf(row));
        const index=@intFromEnum(row.parameter); const binding=v.storage.bindings[index];
        const function=c.program.functions[@intFromEnum(row.function)]; const abi=v.abis[@intFromEnum(function.abi)];
        try c.require(expected[index] and parameters[index]==null and binding.owner==.param and binding.owner.param==row.function);
        try c.charge(abi.parameters.len); const ordinal=std.mem.indexOfScalar(t.BindingRef,abi.parameters,row.parameter) orelse return error.InvalidShape;
        const origin=binding.origin orelse return error.InvalidOrigin;
        try c.require(origin.source==function.source and origin.start>=function.declaration.start and origin.end<=function.declaration.end);
        // Raw input views precede defaults; the logical declaration cannot
        // replace them. The target consumer may conservatively omit that role.
        const raw=abi.argument_types[ordinal];
        expected[index]=false;
        try c.charge(seen.len); @memset(seen,false); pending.clearRetainingCapacity(); try entryPush(c,&pending,binding.@"type");
        var cursor: usize=0;
        while(cursor<pending.items.len) : (cursor+=1) {
            try c.step(); const id=pending.items[cursor]; const at=@intFromEnum(id); if(seen[at])continue; seen[at]=true;
            const value=v.types[at];
            if(value.kind==.array or value.kind==.readSpan or value.kind==.function)try entryPush(c,&pending,value.element.?);
            if(value.kind==.@"union" or value.kind==.function)for(value.members) |member| { try c.step(); try entryPush(c,&pending,member); };
            if(value.kind!=.reference and value.kind!=.value)continue;
            overrides.clearRetainingCapacity(); var ancestor: ?t.TypeRef=id;
            while(ancestor) |owner| {
                try c.step();
                for(v.members.fields) |field| { try c.step(); if(field.owner==owner)try entryPush(c,&pending,field.@"type"); }
                for(v.members.methods) |method| {
                    try c.step(); if(method.owner!=owner)continue;
                    var hidden=false;
                    for(overrides.items) |old| { try c.charge(5); if(std.mem.eql(u8,&old,&method.id)) { hidden=true; break; } }
                    if(!hidden) {
                        const method_abi=v.abis[@intFromEnum(c.program.functions[@intFromEnum(method.function)].abi)];
                        for(method_abi.parameters) |parameter| { try c.step(); try entryPush(c,&pending,v.storage.bindings[@intFromEnum(parameter)].@"type"); }
                        if(method_abi.result) |result|try entryPush(c,&pending,result);
                    }
                    // Even a hidden intermediate override suppresses its own
                    // ancestor, matching the effective-method payload closure.
                    if(method.override) |old| {
                        try c.charge(1+@as(usize,if(overrides.items.len==overrides.capacity)overrides.items.len else 0));
                        try overrides.append(c.allocator,old);
                    }
                }
                ancestor=v.types[@intFromEnum(owner)].base;
            }
        }
        var selected: PairSet=.{}; defer selected.deinit(c.allocator);
        var available: PairSet=.{}; defer available.deinit(c.allocator);
        var candidates: PairSet=.{}; defer candidates.deinit(c.allocator);
        var expected_candidates: PairSet=.{}; defer expected_candidates.deinit(c.allocator);
        // Nominal ancestry is declaration authority, not a selected structural
        // proof. Every nominal alternative appears in both complete sets.
        for(v.types,0..) |target,target_index| {
            try c.step(); if(!seen[target_index] or target.kind!=.reference)continue;
            for(v.types,0..) |actual,actual_index| {
                try c.step(); if(actual.kind!=.reference)continue;
                var ancestor: ?t.TypeRef=@enumFromInt(actual_index);
                while(ancestor) |owner| {
                    try c.step(); if(@intFromEnum(owner)==target_index) {
                        const pair=Pair{.source=@enumFromInt(actual_index),.target=@enumFromInt(target_index)};
                        try entryPair(c,&candidates,pair); try entryPair(c,&expected_candidates,pair); break;
                    }
                    ancestor=v.types[@intFromEnum(owner)].base;
                }
            }
        }
        for(row.roots) |ref| {
            try c.step(); const proof=v.views.compatibility[@intFromEnum(ref)];
            try c.charge(4); try c.require(std.meta.eql(proof.origin,origin));
            try c.require(proof.source_type!=proof.target_type and v.types[@intFromEnum(proof.source_type)].kind==.reference and
                seen[@intFromEnum(proof.target_type)] and v.types[@intFromEnum(proof.target_type)].kind==.reference);
            const pair=Pair{.source=proof.source_type,.target=proof.target_type}; try entryPair(c,&selected,pair); try entryPair(c,&candidates,pair);
        }
        // All same-occurrence candidate proofs must be consumed as entry roots;
        // removing a root while retaining its proof is not a smaller valid role.
        for(v.views.compatibility) |proof| {
            try c.charge(5); if(!std.meta.eql(proof.origin,origin))continue;
            if(proof.source_type==proof.target_type or v.types[@intFromEnum(proof.source_type)].kind!=.reference or
                !seen[@intFromEnum(proof.target_type)] or v.types[@intFromEnum(proof.target_type)].kind!=.reference)continue;
            const pair=Pair{.source=proof.source_type,.target=proof.target_type}; try entryPair(c,&available,pair); try entryPair(c,&expected_candidates,pair);
        }
        try c.require(selected.count()==available.count() and candidates.count()==expected_candidates.count());
        var selected_it=selected.keyIterator(); while(selected_it.next()) |pair| { try c.step(); try c.require(available.contains(pair.*)); }
        var candidates_it=candidates.keyIterator(); while(candidates_it.next()) |pair| { try c.step(); try c.require(expected_candidates.contains(pair.*)); }
        parameters[index]=if(raw==binding.@"type") .{.logical_type=raw} else null;
    }
    for(expected) |missing| { try c.step(); try c.require(!missing); }
    return .{.allocator=c.allocator,.parameters=parameters};
}
