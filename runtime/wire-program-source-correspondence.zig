// SPDX-License-Identifier: MIT
// Exact logical witness / independently checked physical CFG correspondence.
// The caller has already checked table references, definitions, dominance,
// opcode shape, ABI, fuel and numeric groups. source_plan is only a witness:
// this module proves no Source ownership, effects, holding, lifetime or execution
// permission. It borrows the same Context and never replaces actual static views.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const control = @import("wire-program-control.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const ins = model.instruction;
const Context = context.Context;
pub const Error = context.Error;
const none = std.math.maxInt(usize);
const semantic_payload = "payload:sha256:db46cd091d08f951a4a1564e8cf24702dca6137fe0585bbfe256c522e6ee3332";

fn equal(c: *Context, a: []const u8, b: []const u8) Error!bool {
    try c.charge(1 + @min(a.len, b.len) / 64);
    return std.mem.eql(u8, a, b);
}
fn hashText(c: *Context, value: t.Hash) Error![71]u8 {
    // Prepay fixed hex generation; equal() separately charges comparison.
    try c.charge(1 + 71 / 32);
    var out: [71]u8 = undefined;
    @memcpy(out[0..7], "sha256:");
    @memcpy(out[7..], &std.fmt.bytesToHex(value, .lower));
    return out;
}
// Fixed identity encoding from the actual original Source tuple. Only this
// finite metadata object is hashed; no witness content is used as authority.
fn allocationIdentity(c: *Context, source: t.Origin) Error!t.Hash {
    const path = c.program.tables.sources[@intFromEnum(source.source)].path;
    try c.charge(8 + path.len / 16);
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update("tsfg.array-facts.allocation.v8\x00{\"declarationRange\":{\"end\":");
    var buffer: [32]u8 = undefined;
    hash.update(std.fmt.bufPrint(&buffer, "{d}", .{source.end}) catch unreachable);
    hash.update(",\"start\":");
    hash.update(std.fmt.bufPrint(&buffer, "{d}", .{source.start}) catch unreachable);
    hash.update("},\"sourcePath\":\"");
    for (path) |byte| switch (byte) {
        '"' => hash.update("\\\""), '\\' => hash.update("\\\\"),
        8 => hash.update("\\b"), 12 => hash.update("\\f"), 10 => hash.update("\\n"), 13 => hash.update("\\r"), 9 => hash.update("\\t"),
        else => if (byte < 32) {
            const digits = "0123456789abcdef";
            const escaped = [_]u8{ '\\', 'u', '0', '0', digits[byte >> 4], digits[byte & 15] };
            hash.update(&escaped);
        } else hash.update(&.{byte}),
    };
    hash.update("\"}");
    var result: t.Hash = undefined; hash.final(&result); return result;
}
const Identity = union(enum) { text: []const u8, hash: t.Hash, carrier: t.Carrier };
fn sameIdentity(c: *Context, common: tables.CommonTables, text: []const u8, identity: Identity) Error!bool {
    return switch (identity) {
        .text => |value| equal(c, text, value),
        .hash => |value| blk: { const bytes = try hashText(c, value); break :blk equal(c, text, &bytes); },
        .carrier => |carrier| blk: {
            const label: struct { prefix: []const u8, value: Identity } = switch (carrier) {
                .domain => |v| .{ .prefix = "", .value = .{ .hash = common.domains[@intFromEnum(v)].id } },
                .@"type" => |v| .{ .prefix = "", .value = .{ .hash = common.types[@intFromEnum(v)].id } },
                .environment => |v| .{ .prefix = "env:", .value = .{ .hash = common.closures.environments[@intFromEnum(v)].id } },
                // CellRef is an EH-directory index, not a BindingRef. Both
                // joins are necessary even when the integer values coincide.
                .cell => |v| .{ .prefix = "cell:", .value = .{ .text = common.storage.bindings[@intFromEnum(common.exceptions.bindings[@intFromEnum(v)].binding)].id } },
                .receiver => |v| .{ .prefix = "receiver:", .value = .{ .hash = common.types[@intFromEnum(common.members.constructions[@intFromEnum(v)].owner)].id } },
                .initialization => |v| .{ .prefix = "initialization:", .value = .{ .hash = common.types[@intFromEnum(common.members.constructions[@intFromEnum(v)].owner)].id } },
                .payload => break :blk equal(c, text, semantic_payload),
            };
            if (text.len < label.prefix.len or !try equal(c, text[0..label.prefix.len], label.prefix)) break :blk false;
            break :blk sameIdentity(c, common, text[label.prefix.len..], label.value);
        },
    };
}
fn staticView(f: *const model.Function, common: tables.CommonTables, r: t.RegisterRef) Identity {
    const row = f.registers[@intFromEnum(r)];
    return if (row.view) |v| .{ .hash = common.types[@intFromEnum(v)].id } else .{ .carrier = row.carrier };
}
const Properties = struct {
    c: *Context,
    common: tables.CommonTables,
    members: []const t.JsonMember,
    fn count(self: Properties, expected: usize) Error!void { try self.c.require(self.members.len == expected); }
    fn get(self: Properties, key: []const u8) Error!t.JsonValue {
        for (self.members) |member| if (try equal(self.c, member.key, key)) return member.value;
        return error.InvalidShape;
    }
    fn identity(self: Properties, key: []const u8, expected: Identity) Error!void {
        const value = try self.get(key);
        try self.c.require(value == .string);
        try self.c.require(try sameIdentity(self.c, self.common, value.string, expected));
    }
    fn text(self: Properties, key: []const u8, expected: []const u8) Error!void { try self.identity(key, .{ .text = expected }); }
    fn boolean(self: Properties, key: []const u8, expected: bool) Error!void {
        const value = try self.get(key); try self.c.require(value == .boolean and value.boolean == expected);
    }
    fn integer(self: Properties, key: []const u8, expected: u64) Error!void {
        const value = try self.get(key); try self.c.require(value == .integer and value.integer == expected);
    }
    fn object(self: Properties, key: []const u8) Error!Properties {
        const value = try self.get(key); try self.c.require(value == .object);
        return .{ .c = self.c, .common = self.common, .members = value.object };
    }
    fn anchor(self: Properties, key: []const u8, expected: t.Anchor) Error!void {
        const value = try self.object(key); try value.count(2);
        try value.integer("start", expected.start); try value.integer("end", expected.end);
    }
};
fn token(code: ins.Opcode) ?[]const u8 {
    return switch (code) {
        .add, .pos, .string_concat => "+", .sub, .neg => "-", .mul => "*", .div => "/", .rem => "%",
        .shl => "<<", .shr => ">>", .ushr => ">>>", .@"and" => "&", .@"or" => "|", .xor => "^",
        .@"not" => "~", .bool_not => "!", .eq => "===", .ne => "!==", .lt => "<", .le => "<=", .gt => ">", .ge => ">=",
        else => null,
    };
}
const Edges = struct { values: [2]t.BlockRef = undefined, count: usize = 0 };
fn edges(op: *const ins.Instruction) Edges {
    return switch (op.data) {
        .br => |v| .{ .values = .{ v.destination, v.destination }, .count = 1 },
        .cond_br => |v| .{ .values = .{ v.true_destination, v.false_destination }, .count = 2 },
        .domain_numeric_use => |v| .{ .values = .{ v.normal_successor, v.normal_successor }, .count = 1 },
        inline .eh_invoke, .eh_invoke_indirect, .common_method_invoke => |v| .{ .values = .{ v.normal, v.exceptional }, .count = 2 },
        inline .receiver_bind, .receiver_get, .receiver_result => |v| .{ .values = .{ v.normal, v.language }, .count = 2 },
        .eh_route => |v| .{ .values = .{ v.successor, v.successor }, .count = 1 },
        else => .{},
    };
}
const Match = struct {
    c: *Context,
    common: tables.CommonTables,
    function: usize,
    f: *const model.Function,
    plan: control.SourcePlan,
    values: []usize,
    blocks: []usize,
    origins: []?t.Origin,
    i32_hash: ?t.Hash,

    fn bind(self: *Match, raw: t.RegisterRef, semantic: t.RegisterRef) Error!void {
        try self.c.step(); const slot = &self.values[@intFromEnum(raw)]; const value = @intFromEnum(semantic);
        try self.c.require(slot.* == none or slot.* == value); slot.* = value;
    }
    fn resolve(self: *Match, raw: t.RegisterRef) usize { return self.values[@intFromEnum(raw)]; }
    fn originalView(self: *Match, ref: t.RegisterRef) Error!t.TypeRef {
        try self.c.step();
        return self.f.registers[@intFromEnum(ref)].view orelse error.InvalidShape;
    }
    fn typeIdentity(self: *const Match, ref: t.TypeRef) Identity { return .{ .hash = self.common.types[@intFromEnum(ref)].id }; }
    fn name(self: *Match, expected: *const control.SourcePlanOperation, actual: []const u8) Error!void {
        try self.c.require(try equal(self.c, expected.name, actual));
    }
    fn matchView(self: *Match, expected: *const control.SourcePlanOperation, actual: Identity) Error!void {
        try self.c.require(try sameIdentity(self.c, self.common, expected.view, actual));
    }
    fn sourceNumeric(self: *Match, op: *const control.SourcePlanOperation) Error!bool {
        const unary = try equal(self.c, op.name, "unary");
        if (!unary and !try equal(self.c, op.name, "binary")) return false;
        const p = Properties{ .c = self.c, .common = self.common, .members = op.properties };
        const property = try p.get("operator");
        if (property != .string) return false;
        const choices: []const []const u8 = if (unary) &.{ "+", "-", "~" } else &.{ "+", "-", "*", "/", "%", "<<", ">>", ">>>", "&", "|", "^", "<", "<=", ">", ">=" };
        var numeric = false;
        for (choices) |choice| if (try equal(self.c, property.string, choice)) { numeric = true; break; };
        if (!numeric) return false;
        // The actual scalar catalog, not witness text or an assumed TypeRef,
        // selects i32. IDs here are directory identities, never a graph proof.
        const id = self.i32_hash orelse return false;
        for (op.operands) |r| if (!try sameIdentity(self.c, self.common, self.plan.carriers[@intFromEnum(r)], .{ .hash = id })) return false;
        return true;
    }
    fn handler(self: *Match, scope: t.ScopeRef, block: usize, op: *const ins.Instruction, expected: *const control.SourcePlanOperation) Error!void {
        const c = self.c; const row = self.common.exceptions.scopes[@intFromEnum(scope)];
        try c.require(@intFromEnum(row.owner) == self.function and row.path.len != 0);
        var path: std.ArrayListUnmanaged(u8) = .empty; defer path.deinit(c.allocator);
        const id = try hashText(c, self.f.id); try c.charge(id.len / 64 + 2);
        // Reserve an upper bound once, before any append. Every rendered
        // segment fits in segment.len+1 bytes, so no old prefix is relocated.
        var capacity: usize = id.len + "/body".len;
        for (row.path) |segment| { try c.step(); capacity += segment.len + 1; }
        try c.charge(capacity); try path.ensureTotalCapacityPrecise(c.allocator, capacity);
        path.appendSliceAssumeCapacity(&id); path.appendSliceAssumeCapacity("/body");
        var role: []const u8 = "";
        for (row.path, 0..) |segment, index| {
            try c.charge(2 + segment.len / 32);
            const split = std.mem.lastIndexOfScalar(u8, segment, ':') orelse return error.InvalidShape;
            const kind = segment[0..split]; const ordinal = segment[split + 1 ..];
            path.appendAssumeCapacity('/'); path.appendSliceAssumeCapacity(ordinal);
            if (index + 1 == row.path.len) { role = kind; continue; }
            if (try equal(c, kind, "block")) continue;
            path.appendAssumeCapacity('/');
            const suffix = if (try equal(c, kind, "while")) "body" else if (try equal(c, kind, "if:then")) "then" else if (try equal(c, kind, "if:else")) "else" else kind;
            path.appendSliceAssumeCapacity(suffix);
        }
        var matched = false;
        for (self.common.exceptions.functions[self.function].handlers) |entry| {
            if (!try equal(c, entry.id, path.items)) continue;
            try c.require(!matched); matched = true;
            const p = Properties{ .c = c, .common = self.common, .members = expected.properties };
            try p.text("handler", entry.id);
            if (op.data == .eh_enter) {
                if (try equal(c, role, "try")) {
                    try self.name(expected, "enter_handler"); try p.count(3);
                    try p.boolean("hasCatch", entry.has_catch); try p.boolean("hasFinally", entry.has_finally);
                } else {
                    try c.require(try equal(c, role, "finally")); try self.name(expected, "finally_enter"); try p.count(2);
                    var clone = false;
                    for (entry.finally_blocks) |final| { try c.step(); if (@intFromEnum(final.block) != block) continue;
                        try c.require(!clone); clone = true; try p.text("completion", @tagName(final.completion)); }
                    try c.require(clone);
                }
            } else {
                const route = op.data.eh_route; try self.name(expected, "route"); try p.count(2);
                try p.text("completion", @tagName(route.completion));
                if (try equal(c, role, "catch")) try c.require(route.completion == .@"throw" and entry.catch_block == route.successor)
                else try c.require(try equal(c, role, "finally") and entry.has_finally);
            }
        }
        try c.require(matched);
    }
    fn operation(self: *Match, block: usize, position: usize, actual: *const ins.Instruction, expected: *const control.SourcePlanOperation) Error!void {
        const c = self.c; const common = self.common; const code = std.meta.activeTag(actual.data);
        const p = Properties{ .c = c, .common = common, .members = expected.properties };
        var view: Identity = if (actual.result) |r| staticView(self.f, common, r) else .{ .text = "void" };
        switch (actual.data) {
            .const_i32, .const_integer, .const_float => |bits| {
                const carrier = self.f.registers[@intFromEnum(actual.result.?)].carrier;
                try c.require(carrier == .@"type"); const row = common.types[@intFromEnum(carrier.@"type")];
                const native = row.native_code; try c.require(row.kind == .scalar and native >= 1 and native <= 13);
                const widths = [_]u7{ 32, 1, 8, 16, 64, 8, 16, 32, 64, 64, 64, 32, 64 };
                const width = widths[native - 1];
                try c.require((code == .const_i32 and native == 1) or (code == .const_float and native >= 12) or
                    (code == .const_integer and native != 1 and native != 2 and native < 12));
                if (width < 64) try c.require(bits >> @as(u6, @intCast(width)) == 0);
                var buffer: [80]u8 = undefined; try p.count(1);
                if (code == .const_float) {
                    try self.name(expected, "floating");
                    var bytes: [8]u8 = undefined; std.mem.writeInt(u64, &bytes, bits, .big);
                    const hex = std.fmt.bytesToHex(bytes, .lower);
                    try p.text("bits", hex[if (width == 32) 8 else 0 ..]);
                } else {
                    try self.name(expected, "constant");
                    const signed = native == 1 or native == 3 or native == 4 or native == 5 or native == 10;
                    const decimal = if (signed) signed_value: {
                        // Sign extend the original width before formatting; a
                        // positive u64 spelling cannot substitute for -1.
                        const shift: u6 = @intCast(64 - width);
                        const value: i64 = @as(i64, @bitCast(bits << shift)) >> shift;
                        break :signed_value std.fmt.bufPrint(&buffer, "{d}", .{value}) catch unreachable;
                    } else std.fmt.bufPrint(&buffer, "{d}", .{bits}) catch unreachable;
                    try p.text("decimal", decimal);
                }
            },
            .const_bool => |value| {
                const carrier = self.f.registers[@intFromEnum(actual.result.?)].carrier;
                try c.require(carrier == .@"type"); const row = common.types[@intFromEnum(carrier.@"type")];
                try c.require(row.kind == .scalar and row.native_code == 2);
                try self.name(expected, "boolean"); try p.count(1); try p.boolean("value", value);
            },
            .string_constant => |units| {
                try self.name(expected, "string"); try p.count(1); const value = try p.get("codeUnits");
                try c.require(value == .array and value.array.len == units.len);
                for (value.array, units) |unit, wanted| { try c.step(); try c.require(unit == .integer and unit.integer == wanted); }
            },
            .add, .sub, .mul, .div, .rem, .shl, .shr, .ushr, .@"and", .@"or", .xor, .neg, .@"not", .bool_not,
            .eq, .ne, .lt, .le, .gt, .ge, .pos, .string_concat => {
                try self.name(expected, if (code == .neg or code == .@"not" or code == .bool_not or code == .pos) "unary" else "binary");
                try p.count(1); try p.text("operator", token(code).?);
            },
            .domain_literal => |v| {
                const row = common.types[@intFromEnum(v.actual_type)];
                try c.require(row.kind == .@"null" or row.kind == .@"undefined");
                try self.name(expected, @tagName(row.kind)); try p.count(0); view = self.typeIdentity(v.actual_type);
            },
            inline .domain_view, .domain_copy => |v| {
                try self.name(expected, if (code == .domain_view) "view" else "value_copy"); try p.count(1);
                view = self.typeIdentity(v.static_view); try p.identity(if (code == .domain_view) "target" else "type", view);
            },
            .eh_carrier => |target| {
                if (target) |v| {
                    try self.name(expected, "carrier_cast"); view = self.typeIdentity(v); try p.count(1);
                    try p.identity("carrier", .{ .carrier = self.f.registers[@intFromEnum(actual.result.?)].carrier });
                } else {
                    const logical = self.f.registers[@intFromEnum(actual.operands[0])].view orelse return error.InvalidShape;
                    try self.name(expected, "pack"); view = self.typeIdentity(logical); try p.count(1); try p.identity("type", view);
                }
            },
            .eh_assertion => |v| {
                try self.name(expected, "assert"); view = self.typeIdentity(v.static_view); try p.count(3);
                try p.text("operator", if (v.operator == .as) "as" else "type-assertion");
                try p.anchor("annotationRange", v.annotation); try p.anchor("operatorRange", v.operator_anchor);
            },
            .eh_equal => |v| { try self.name(expected, "strict_equal"); try p.count(1); try p.text("operator", if (v.operator == .equal) "===" else "!=="); },
            .@"return", .br, .cond_br => {
                try self.name(expected, if (code == .@"return") "func.return" else if (code == .br) "cf.br" else "cf.cond_br");
                try p.count(0); view = .{ .text = "" };
            },
            .fuel => |v| { try self.name(expected, "fuel"); try p.count(1); try p.integer("event", @intFromEnum(v.event)); },
            inline .global_load, .global_store => |v| {
                const row = common.modules.globals[@intFromEnum(v.global)];
                try self.name(expected, if (code == .global_load) "global_load" else "global_store");
                try p.count(if (code == .global_load) 1 else 2); try p.identity("global", .{ .hash = row.id });
                if (comptime @hasField(@TypeOf(v), "initialize")) try p.boolean("initialize", v.initialize) else view = self.typeIdentity(row.@"type");
            },
            .authorized_host => |v| {
                const host = common.modules.hosts[@intFromEnum(v.host)];
                try self.name(expected, "host_call"); view = self.typeIdentity(host.return_type); try p.count(3);
                try p.identity("host_id", .{ .hash = host.id }); try p.identity("signature_hash", .{ .hash = host.signature });
                try p.identity("contract_hash", .{ .hash = host.contract_digest });
            },
            .domain_read_span => |v| { try self.name(expected, "readspan"); try p.count(0); view = self.typeIdentity(v.static_view); },
            .domain_array_length => {
                const ref = try self.originalView(actual.operands[0]);

                const kind = common.types[@intFromEnum(ref)].kind; try c.require(kind == .array or kind == .readSpan);
                try self.name(expected, if (kind == .array) "array_length" else "readspan_length"); try p.count(0);
            },
            .domain_array_read => |v| {
                try self.name(expected, "array_read"); view = self.typeIdentity(v.element_view); try p.count(1); try p.identity("element", view);
            },
            .domain_array_store => |v| {
                try self.name(expected, "array_store"); try p.count(1); try p.identity("element", self.typeIdentity(v.receiver_view));
                try c.require((try self.originalView(actual.operands[2])) == v.rhs_view);
            },
            .domain_array_resize => |v| {
                try self.name(expected, "array_resize"); try p.count(0);
                try c.require((try self.originalView(actual.operands[0])) == v.receiver_view);
            },
            inline .domain_field_read, .domain_field_store => |v| {
                const field = common.members.fields[@intFromEnum(v.member)];
                try self.name(expected, if (code == .domain_field_read) "field_load" else "field_store");
                try p.count(if (code == .domain_field_read) 1 else 2); try p.identity("field", .{ .hash = field.id });
                try c.require((try self.originalView(actual.operands[0])) == v.receiver_view);
                if (comptime @hasField(@TypeOf(v), "rhs_view")) {
                    try p.boolean("initialize", false);
                    try c.require((try self.originalView(actual.operands[1])) == v.rhs_view);
                } else view = self.typeIdentity(field.@"type");
            },
            .eh_construct => |v| {
                const row = common.types[@intFromEnum(v.owner)];
                try c.require(row.kind == .reference or row.kind == .value);
                try self.name(expected, if (row.kind == .reference) "allocate_reference" else "construct_value");
                view = self.typeIdentity(v.owner); try p.count(2); try p.identity("type", view);
                try p.identity("construction", .{ .hash = common.members.constructions[@intFromEnum(v.constructor)].id });
            },
            .eh_field_initialize => |v| {
                try self.name(expected, "field_store"); try p.count(2);
                try p.identity("field", .{ .hash = common.members.fields[@intFromEnum(v.field)].id }); try p.boolean("initialize", true);
            },            .common_typed_array_create => |v| {
                try self.name(expected, "array_create"); view = self.typeIdentity(v.actual_array_type); try p.count(1); try p.text("allocation", v.allocation);
                var found = false;
                for (common.storage.arrays) |array| { try c.step(); if (array.@"type" != v.actual_array_type) continue;
                    try c.require(!found and std.meta.eql(array.element_carrier, v.element_carrier)); found = true; }
                try c.require(found);
                const identity = try allocationIdentity(c, actual.source);
                try c.require(try sameIdentity(c, common, v.allocation, .{ .hash = identity }));
            },
            inline .eh_cell, .eh_load, .eh_store => |v| {
                const binding = common.storage.bindings[@intFromEnum(common.exceptions.bindings[@intFromEnum(v.binding)].binding)];
                try self.name(expected, if (code == .eh_cell) "cell" else if (code == .eh_load) "load" else "store");
                try p.count(if (code == .eh_store) 2 else 1); try p.text("binding", binding.id);
                if (comptime @hasField(@TypeOf(v), "initialize")) try p.boolean("initialize", v.initialize) else view = self.typeIdentity(binding.@"type");
            },
            .environment_alloc => |v| {
                const row = common.closures.environments[@intFromEnum(v.environment)];
                try self.name(expected, "env_alloc"); try p.count(1); try p.identity("layout", .{ .hash = row.id });
                view = .{ .carrier = .{ .environment = v.environment } };
            },
            .environment_parent => {
                const receiver = self.f.registers[@intFromEnum(actual.operands[0])].carrier.environment;
                const parent = common.closures.environments[@intFromEnum(receiver)].parent.?;
                try self.name(expected, "env_parent"); try p.count(1); try p.identity("layout", .{ .hash = common.closures.environments[@intFromEnum(parent)].id });
            },
            inline .environment_init, .environment_load, .environment_store => |v| {
                const receiver = self.f.registers[@intFromEnum(actual.operands[0])].carrier.environment;
                const environment = common.closures.environments[@intFromEnum(receiver)]; const slot = environment.slots[@intFromEnum(v.slot)];
                try self.name(expected, if (code == .environment_init) "env_init" else if (code == .environment_load) "env_load" else "env_store");
                try p.count(3); try p.identity("layout", .{ .hash = environment.id }); try p.identity("key", .{ .hash = slot.key });
                try p.text("binding", common.storage.bindings[@intFromEnum(slot.binding)].id);
                if (code == .environment_load) view = self.typeIdentity(slot.@"type");
            },
            .function_make => |v| {
                const target = self.c.program.functions[@intFromEnum(v.function)];
                try self.name(expected, "make_closure"); try p.count(3);
                try p.identity("function_id", .{ .hash = target.id }); try p.identity("signature_hash", .{ .hash = target.signature });
                var found = false;
                for (common.closures.functions) |closure| { try c.step(); if (closure.function != v.function) continue;
                    try c.require(!found); found = true;
                    if (closure.lexical_environment) |env| try p.identity("environment_layout", .{ .hash = common.closures.environments[@intFromEnum(env)].id })
                    else try c.require(try p.get("environment_layout") == .null);
                }
                try c.require(found);
            },
            .eh_invoke => |v| {
                const target = c.program.functions[@intFromEnum(v.callee)];
                try self.name(expected, "invoke"); try p.count(2); try p.identity("function_id", .{ .hash = target.id });
                try p.identity("signature_hash", .{ .hash = target.signature });
            },
            .eh_invoke_indirect => {
                try self.name(expected, "invoke_indirect"); try p.count(2); var found = false;
                for (common.closures.calls) |call| { try c.step();
                    if (@intFromEnum(call.function) != self.function or @intFromEnum(call.block) != block or call.instruction != position) continue;
                    try c.require(!found); found = true; try p.identity("signature_hash", .{ .hash = call.signature });
                    const target = try p.object("targets"); try target.count(2); try target.boolean("top", false);
                    const functions = try target.get("functions"); try c.require(functions == .array and functions.array.len == call.targets.len);
                    for (functions.array, call.targets) |claim, ref| {
                        try c.require(claim == .object); const target_fn = c.program.functions[@intFromEnum(ref)];
                        const fields = Properties{ .c = c, .common = common, .members = claim.object }; try fields.count(2);
                        try fields.identity("function_id", .{ .hash = target_fn.id }); try fields.identity("signature_hash", .{ .hash = target_fn.signature });
                    }
                }
                try c.require(found);
            },
            .common_method_invoke => |v| {
                const method = common.members.methods[@intFromEnum(v.member)]; const target = c.program.functions[@intFromEnum(method.function)];
                try self.name(expected, "invoke_method"); try p.count(3); try p.identity("function_id", .{ .hash = target.id });
                try p.identity("signature_hash", .{ .hash = method.signature });
                const dispatch = try p.get("dispatch"); const arms = common.views.dispatch[@intFromEnum(v.dispatch)].method.arms;
                try c.require(dispatch == .array and dispatch.array.len == arms.len);
                for (dispatch.array, arms) |claim, arm| {
                    try c.require(claim == .object); const arm_fn = c.program.functions[@intFromEnum(arm.target.?)];
                    const fields = Properties{ .c = c, .common = common, .members = claim.object }; try fields.count(3);
                    try fields.identity("receiver_type", self.typeIdentity(arm.actual)); try fields.identity("target", .{ .hash = arm_fn.id });
                    try fields.identity("signature_hash", .{ .hash = arm_fn.signature });
                }
            },
            .eh_enter => |v| try self.handler(v.scope, block, actual, expected),
            .eh_route => |v| try self.handler(v.scope, block, actual, expected),
            .eh_raise => { try self.name(expected, "return_throw"); try p.count(0); },
            .eh_unreachable => { try self.name(expected, "unreachable"); try p.count(0); },
            inline .receiver_create, .receiver_child, .receiver_allocate, .receiver_bind, .receiver_get, .receiver_result,
            .initialize_begin, .initialize_field, .initialize_end => |v| {
                const construction = common.members.constructions[@intFromEnum(v.construction)];
                try self.name(expected, @tagName(code));
                try p.count(if (code == .receiver_create or code == .initialize_field) 3 else 2);
                try p.identity("owner", self.typeIdentity(construction.owner)); try p.identity("construction", .{ .hash = construction.id });
                if (comptime @hasField(@TypeOf(v), "new_target")) try p.identity("new_target", self.typeIdentity(v.new_target));
                if (comptime @hasField(@TypeOf(v), "field")) try p.identity("field", .{ .hash = common.members.fields[@intFromEnum(v.field)].id });
            },
            // These typed arms belong to other mode vocabularies and were
            // rejected by instructionShape; no fallback or legacy shim exists.
            else => return error.WrongMode,
        }
        try self.matchView(expected, view);
    }
    fn run(self: *Match) Error!void {
        const c = self.c; const f = self.f; const plan = self.plan;
        try c.charge(3 * f.blocks.len);
        var predecessors: [256]usize = undefined; var numeric: [256]bool = undefined; var seen: [256]bool = undefined;
        @memset(predecessors[0..f.blocks.len], 0); @memset(numeric[0..f.blocks.len], false); @memset(seen[0..f.blocks.len], false);
        for (f.blocks) |block| for (block.instructions) |*op| {
            try c.step(); const next = edges(op);
            for (next.values[0..next.count]) |target| { try c.step(); predecessors[@intFromEnum(target)] += 1; }
        };
        for (f.blocks) |block| for (block.instructions) |op| {
            try c.step(); if (op.data != .domain_numeric_use) continue;
            const target = @intFromEnum(op.data.domain_numeric_use.normal_successor);
            try c.require(target != 0 and predecessors[target] == 1 and !numeric[target]); numeric[target] = true;
        };
        var cursor: usize = 0;
        for (plan.blocks, 0..) |block, semantic| {
            try c.step(); if (block.operations.len == 0) continue;
            while (cursor < f.blocks.len and numeric[cursor]) { try c.step(); cursor += 1; }
            try c.require(cursor < f.blocks.len); self.blocks[semantic] = cursor; cursor += 1;
        }
        while (cursor < f.blocks.len and numeric[cursor]) { try c.step(); cursor += 1; }
        try c.require(cursor == f.blocks.len);
        // Source origins of logical producers are independent from adapter
        // placement; the exact SourceRef remains part of every remembered tuple.
        for (plan.blocks) |block| for (block.operations) |op| {
            try c.step(); if (op.result) |r| self.origins[@intFromEnum(r)] = op.source;
            if (try equal(c, op.name, "invoke") or try equal(c, op.name, "invoke_method") or try equal(c, op.name, "invoke_indirect")) {
                for (plan.blocks[@intFromEnum(op.successors[0])].parameters) |r| { try c.step(); self.origins[@intFromEnum(r)] = op.source; }
            }
        };
        for (plan.blocks, 0..) |block, semantic| {
            try c.step(); if (block.operations.len == 0) continue;
            const actual = f.blocks[self.blocks[semantic]].parameters;
            try c.require(actual.len == block.parameters.len);
            for (actual, block.parameters) |raw, value| try self.bind(raw, value);
        }
        for (plan.blocks, 0..) |logical, semantic| {
            try c.step(); if (logical.operations.len == 0) continue;
            var block = self.blocks[semantic]; var position: usize = 0;
            try c.require(!seen[block]); seen[block] = true;
            for (logical.operations) |*expected| {
                const source_numeric = try self.sourceNumeric(expected); var checked: usize = 0;
                while (true) {
                    try c.step(); try c.require(position < f.blocks[block].instructions.len);
                    const adapter = &f.blocks[block].instructions[position];
                    if (adapter.data == .eh_carrier and adapter.data.eh_carrier != null) {
                        const value = self.resolve(adapter.operands[0]); try c.require(value != none);
                        try c.require(try sameIdentity(c, self.common, plan.carriers[value], self.typeIdentity(adapter.data.eh_carrier.?)));
                        const current_origin = std.meta.eql(adapter.source, expected.source);
                        const producer_origin = if (self.origins[value]) |origin| std.meta.eql(adapter.source, origin) else false;
                        try c.require(current_origin or producer_origin);
                        try self.bind(adapter.result.?, @enumFromInt(value)); position += 1; continue;
                    }
                    if (adapter.data == .domain_numeric_use) {
                        const use = adapter.data.domain_numeric_use;
                        try c.require(source_numeric and checked < expected.operands.len);
                        try c.require(self.resolve(adapter.operands[0]) == @intFromEnum(expected.operands[checked]) and
                            std.meta.eql(adapter.source, expected.source) and use.numeric_operand == checked and use.numeric_arity == expected.operands.len);
                        const p = Properties{ .c = c, .common = self.common, .members = expected.properties };
                        try p.text("operator", token(use.numeric_operator) orelse return error.InvalidShape);
                        const target_type = self.common.types[@intFromEnum(use.target_type)]; try c.require(target_type.kind == .scalar and target_type.native_code == 1);
                        const operand_view = try self.originalView(adapter.operands[0]);
                        try c.require(operand_view == use.target_type);
                        try c.require(try sameIdentity(c, self.common, plan.carriers[@intFromEnum(expected.operands[checked])], self.typeIdentity(operand_view)));
                        const next = @intFromEnum(use.normal_successor); try c.require(!seen[next]); seen[next] = true;
                        try self.bind(f.blocks[next].parameters[0], expected.operands[checked]); checked += 1; block = next; position = 0; continue;
                    }
                    break;
                }
                const actual = &f.blocks[block].instructions[position];
                try c.require(checked == (if (source_numeric) expected.operands.len else 0));
                try c.require(std.meta.eql(actual.source, expected.source) and (actual.result == null) == (expected.result == null) and actual.operands.len == expected.operands.len);
                for (actual.operands, expected.operands) |raw, value| { try c.step(); try c.require(self.resolve(raw) == @intFromEnum(value)); }
                const actual_edges = edges(actual); try c.require(actual_edges.count == expected.successors.len);
                for (actual_edges.values[0..actual_edges.count], expected.successors) |raw, value| {
                    try c.step(); try c.require(self.blocks[@intFromEnum(value)] != none and self.blocks[@intFromEnum(value)] == @intFromEnum(raw));
                }
                try self.operation(block, position, actual, expected);
                if (expected.result) |value| try self.bind(actual.result.?, value);
                position += 1;
            }
            try c.require(position == f.blocks[block].instructions.len);
        }
        for (seen[0..f.blocks.len]) |visited| try c.require(visited);
        for (self.values, 0..) |semantic, raw| {
            try c.require(semantic != none);
            // Compare against the wire's immutable original logical view (or
            // its physical carrier when no view is present). Never assign it
            // from the plan, including pack's logical TypeRef/payload split.
            try c.require(try sameIdentity(c, self.common, plan.carriers[semantic], staticView(f, self.common, @enumFromInt(raw))));
        }
    }
};

// Call immediately after the existing SSA checker with this same Context.
// Non-Common paths retain their own vocabulary. No view map or authority token
// escapes: failure and success both keep every charge on the caller's meter.
pub fn check(c: *Context) Error!void {
    const common = switch (c.program.tables.mode) { .common => |v| v, else => return };
    var i32_hash: ?t.Hash = null;
    for (common.types) |row| { try c.step(); if (row.kind == .scalar and row.native_code == 1) { i32_hash = row.id; break; } }
    for (c.program.functions, 0..) |*function, index| {
        try c.step(); const plan = common.abis[index].source_plan;
        try c.charge(function.registers.len + plan.blocks.len + plan.carriers.len);
        const values = try c.allocator.alloc(usize, function.registers.len); defer c.allocator.free(values); @memset(values, none);
        const blocks = try c.allocator.alloc(usize, plan.blocks.len); defer c.allocator.free(blocks); @memset(blocks, none);
        const origins = try c.allocator.alloc(?t.Origin, plan.carriers.len); defer c.allocator.free(origins); @memset(origins, null);
        var match = Match{ .c = c, .common = common, .function = index, .f = function, .plan = plan, .values = values, .blocks = blocks, .origins = origins, .i32_hash = i32_hash };
        try match.run();
    }
}
