// SPDX-License-Identifier: MIT
// Complete one-block Core12 statement grammar. All operations must be consumed,
// not merely well-typed; checked operations are retained and never evaluated.
const std = @import("std");
const m = @import("array-candidate-model.zig");
const ids = @import("array-candidate-metadata.zig");
const Scalar = struct { reg: u16, anchor: m.Range };
const Binding = struct { id: m.Digest, name: []const u8, reg: u16 };
const Body = struct {
    r: *m.Reader,
    p: m.Payload,
    f: m.Function,
    elements: *usize,
    types: [4219]u8 = @splat(0),
    bindings: [25]Binding = undefined,
    binding_count: usize = 0,
    position: usize = 1,
    previous: u32,
    locals: usize = 0,
    mutations: usize = 0,
    calls: usize = 0,
    fn need(self: *Body, value: bool, code: []const u8) m.Error!void {
        try self.r.require(value, code);
    }
    fn bind(self: *Body, id: m.Digest, name: []const u8, reg: u16) m.Error!void {
        for (self.bindings[0..self.binding_count]) |old| try self.need(!m.text(old.name, name) and !m.eq(old.id, id), "r04-array-identity");
        try self.need(self.binding_count < 25, "r04-array-limit");
        self.bindings[self.binding_count] = .{ .id = id, .name = name, .reg = reg };
        self.binding_count += 1;
    }
    fn binding(self: *Body, id: m.Digest) m.Error!u16 {
        for (self.bindings[0..self.binding_count]) |value| if (m.eq(value.id, id)) return value.reg;
        return self.r.reject("r04-array-identity");
    }
    fn receiver(self: *Body, id: m.Digest, anchor: m.Range, parent: m.Range) m.Error!u16 {
        try self.need(m.encloses(parent, anchor), "r04-array-source");
        return self.binding(id);
    }
    fn shape(self: *Body) m.Error!void {
        try self.need(self.f.blockCount == 1 and self.f.entryArgumentCount == self.f.parameters.len and self.f.registerCount <= 4219, "r04-array-shape");
        var next = self.f.parameters.len;
        for (self.f.parameters, 0..) |p, i| {
            self.types[i] = p.type;
            try self.bind(p.id, p.name, @intCast(i));
        }
        for (self.f.instructions) |op| {
            const result: u8 = switch (op.opcode) {
                1, 6, 7, 12 => 0,
                2 => op.resultType,
                3, 4 => 3,
                5, 9, 11 => 1,
                8, 13 => 4,
                10 => 2,
                else => return self.r.reject("r04-array-shape"),
            };
            try self.need(op.resultType == result, "r04-array-type");
            for (op.operands) |reg| try self.need(reg < next, "r04-array-ssa");
            if (result == 0) try self.need(op.resultRegister == 65535, "r04-array-ssa") else {
                try self.need(next < 4219 and op.resultRegister == next, "r04-array-ssa");
                self.types[next] = result;
                next += 1;
            }
            const arity: ?usize = switch (op.opcode) {
                1, 2 => 0,
                4, 10, 12, 13 => 1,
                5, 7, 9 => 2,
                6, 8 => 3,
                else => null,
            };
            if (arity) |n| try self.need(op.operands.len == n, "r04-array-shape");
            switch (op.opcode) {
                2 => {
                    try self.need(result == 1 or result == 2, "r04-array-type");
                    if (result == 1) try self.need((op.metadata.constant.value.floating & 0x7ff0000000000000) != 0x7ff0000000000000, "r04-array-type");
                },
                3 => for (op.operands) |reg| {
                    try self.need(self.types[reg] == 1, "r04-array-type");
                },
                4 => try self.need(self.types[op.operands[0]] == 3, "r04-array-type"),
                5, 9 => try self.need(self.types[op.operands[0]] == (if (op.opcode == 5) @as(u8, 3) else 4) and self.types[op.operands[1]] == 2, "r04-array-type"),
                6 => try self.need(self.types[op.operands[0]] == 3 and self.types[op.operands[1]] == 2 and self.types[op.operands[2]] == 1, "r04-array-type"),
                7 => try self.need(self.types[op.operands[0]] == 3 and self.types[op.operands[1]] == 2, "r04-array-type"),
                8 => try self.need(self.types[op.operands[0]] == 3 and self.types[op.operands[1]] == 2 and self.types[op.operands[2]] == 2, "r04-array-type"),
                10 => try self.need(self.types[op.operands[0]] == 4, "r04-array-type"),
                13 => try self.need(self.types[op.operands[0]] == 4, "r04-array-type"),
                12 => try self.need(self.types[op.operands[0]] == 1, "r04-array-type"),
                else => {},
            }
        }
        try self.need(next == self.f.registerCount, "r04-array-ssa");
        const fuel = self.f.instructions[0];
        try self.need(fuel.opcode == 1 and fuel.metadata.fuel.event == 1 and m.same(fuel.sourceRange, self.f.sourceRange), "r04-array-shape");
    }
    fn constant(self: *Body, index: usize, kind: u8, length: bool) m.Error!Scalar {
        try self.need(index < self.f.instructions.len, "r04-array-shape");
        const op = self.f.instructions[index];
        try self.need(op.opcode == 2 and op.resultType == kind, "r04-array-type");
        if (kind == 2 and !length) try self.need(op.metadata.constant.value.integer <= 4294967294, "r04-array-type");
        return .{ .reg = op.resultRegister, .anchor = op.sourceRange };
    }
    fn scalar(self: *Body, use: m.ScalarUse, kind: u8, length: bool) m.Error!Scalar {
        try self.need(m.eq(use.typeId, m.typeId(kind).?) and m.encloses(self.f.sourceRange, use.range), "r04-array-type");
        if (use.kind == 3) {
            const reg = try self.binding(use.binding.?);
            try self.need(reg < self.f.parameters.len and self.types[reg] == kind, "r04-array-type");
            return .{ .reg = reg, .anchor = use.range };
        }
        if (use.kind == (if (kind == 2) @as(u8, 1) else 2)) {
            const value = try self.constant(self.position, kind, length);
            self.position += 1;
            try self.need(m.same(value.anchor, use.range), "r04-array-source");
            return value;
        }
        if (kind == 1 and (use.kind == 4 or use.kind == 5)) {
            const value = try self.read(use.kind);
            try self.need(m.same(value.anchor, use.range), "r04-array-source");
            return value;
        }
        return self.r.reject("r04-array-shape");
    }
    fn read(self: *Body, expected: u8) m.Error!Scalar {
        var endpoint = self.position;
        if (endpoint < self.f.instructions.len and self.f.instructions[endpoint].opcode == 2) endpoint += 1;
        try self.need(endpoint < self.f.instructions.len, "r04-array-shape");
        const op = self.f.instructions[endpoint];
        try self.need((op.opcode == 5 or op.opcode == 9) and (expected == 0 or (op.opcode == 9) == (expected == 5)), "r04-array-shape");
        const data: m.Read = if (op.opcode == 5) op.metadata.read else .{ .receiverBinding = op.metadata.view_read.receiverBinding, .receiverRange = op.metadata.view_read.receiverRange, .index = op.metadata.view_read.index };
        if (op.opcode == 9) try self.need(op.metadata.view_read.statementRange == null, "r04-array-source");
        const reg = try self.receiver(data.receiverBinding, data.receiverRange, op.sourceRange);
        const index = try self.scalar(data.index, 2, false);
        try self.need(self.position == endpoint and op.operands[0] == reg and op.operands[1] == index.reg, "r04-array-ssa");
        try self.need(op.sourceRange[0] == data.receiverRange[0] and data.receiverRange[1] < index.anchor[0] and index.anchor[1] < op.sourceRange[1], "r04-array-source");
        self.position += 1;
        return .{ .reg = op.resultRegister, .anchor = op.sourceRange };
    }
    fn local(self: *Body, op: m.Instruction, value: m.Local, require_annotation: bool) m.Error!void {
        self.locals += 1;
        try self.need(self.locals <= 17, "r04-array-limit");
        const s = value.statementRange;
        const d = value.declarationRange;
        const n = value.nameRange;
        const init = op.sourceRange;
        try self.need(m.encloses(self.f.sourceRange, s) and s[0] >= self.previous and s[1] < self.f.sourceRange[1] and s[0] < d[0] and d[0] == n[0] and m.encloses(s, d) and m.encloses(d, n) and m.encloses(d, init) and init[1] == d[1] and n[1] < init[0], "r04-array-source");
        switch (value.annotations) {
            .none => try self.need(!require_annotation, "r04-array-source"),
            .typed => |a| try self.need(m.encloses(d, a.annotationRange) and m.encloses(a.annotationRange, a.elementAnnotationRange) and a.annotationRange[0] >= n[1] and a.annotationRange[1] < init[0], "r04-array-source"),
        }
        try self.need(m.eq(value.id, ids.sourceIdentity(self.p.sourcePath, n, false)), "r04-array-identity");
        try self.bind(value.id, value.name, op.resultRegister);
        self.previous = s[1];
    }
    fn arrayLocal(self: *Body, endpoint: usize) m.Error!void {
        const op = self.f.instructions[endpoint];
        const create = op.opcode == 3;
        if (create) {
            try self.need(op.operands.len == endpoint - self.position and op.sourceRange[1] - op.sourceRange[0] >= 2, "r04-array-shape");
            var previous = op.sourceRange[0];
            var leaf: usize = 0;
            while (self.position < endpoint) : (leaf += 1) {
                const value = try self.constant(self.position, 1, false);
                self.position += 1;
                try self.need(op.operands[leaf] == value.reg, "r04-array-ssa");
                try self.need(value.anchor[0] > op.sourceRange[0] and value.anchor[0] >= previous and value.anchor[1] < op.sourceRange[1], "r04-array-source");
                previous = value.anchor[1];
            }
            try self.need(op.operands.len <= 4096 - self.elements.*, "r04-array-limit");
            self.elements.* += op.operands.len;
            try self.need(m.eq(op.metadata.create.allocationSite, ids.sourceIdentity(self.p.sourcePath, op.sourceRange, true)), "r04-array-identity");
            try self.local(op, op.metadata.create.local, true);
        } else {
            try self.need(self.position == endpoint and op.operands[0] == try self.binding(op.metadata.alias.targetBinding), "r04-array-ssa");
            try self.local(op, op.metadata.alias.local, false);
        }
        self.position += 1;
    }
    fn viewLocal(self: *Body, endpoint: usize) m.Error!void {
        const op = self.f.instructions[endpoint];
        const d = op.metadata.view_create;
        try self.need(m.encloses(op.sourceRange, d.calleeRange) and op.sourceRange[0] == d.calleeRange[0] and m.eq(d.intrinsic, self.p.viewIntrinsic.id), "r04-array-source");
        const owner = try self.receiver(d.receiverBinding, d.receiverRange, op.sourceRange);
        const start = try self.scalar(d.start, 2, true);
        const length = try self.scalar(d.length, 2, true);
        try self.need(self.position == endpoint and op.operands[0] == owner and op.operands[1] == start.reg and op.operands[2] == length.reg, "r04-array-ssa");
        try self.need(d.calleeRange[1] < d.receiverRange[0] and d.receiverRange[1] < start.anchor[0] and start.anchor[1] < length.anchor[0] and length.anchor[1] < op.sourceRange[1], "r04-array-source");
        try self.local(op, d.local, true);
        const annotations = d.local.annotations.typed;
        try self.need(annotations.elementAnnotationRange[0] > annotations.annotationRange[0] and annotations.elementAnnotationRange[1] < annotations.annotationRange[1], "r04-array-source");
        self.position += 1;
    }
    fn viewLength(self: *Body, endpoint: usize) m.Error!void {
        const op = self.f.instructions[endpoint];
        const d = op.metadata.view_length;
        const s = d.statementRange;
        const e = op.sourceRange;
        try self.need(self.position == endpoint and m.encloses(self.f.sourceRange, s) and s[0] >= self.previous and s[1] < self.f.sourceRange[1] and s[0] == e[0] and e[1] < s[1] and m.encloses(s, e) and m.encloses(e, d.propertyNameRange), "r04-array-source");
        const reg = try self.receiver(d.receiverBinding, d.receiverRange, e);
        try self.need(op.operands[0] == reg and m.eq(d.property, self.p.viewLengthProperty.id), "r04-array-identity");
        try self.need(e[0] == d.receiverRange[0] and d.receiverRange[1] < d.propertyNameRange[0] and d.propertyNameRange[1] == e[1], "r04-array-source");
        self.previous = s[1];
        self.position += 1;
    }
    fn viewAlias(self: *Body, endpoint: usize) m.Error!void {
        const op = self.f.instructions[endpoint];
        const d = op.metadata.view_alias;
        try self.need(self.position == endpoint and op.operands[0] == try self.binding(d.targetBinding), "r04-array-ssa");
        try self.local(op, d.local, false);
        if (d.local.annotations == .typed) {
            const a = d.local.annotations.typed;
            try self.need(a.elementAnnotationRange[0] > a.annotationRange[0] and a.elementAnnotationRange[1] < a.annotationRange[1], "r04-array-source");
        }
        self.position += 1;
    }
    fn standaloneRead(self: *Body, endpoint: usize) m.Error!void {
        const op = self.f.instructions[endpoint];
        const d = op.metadata.view_read;
        const statement = d.statementRange orelse return self.r.reject("r04-array-source");
        try self.need(m.encloses(self.f.sourceRange, statement) and statement[0] >= self.previous and statement[1] < self.f.sourceRange[1] and statement[0] == op.sourceRange[0] and m.encloses(statement, op.sourceRange), "r04-array-source");
        const receiver_reg = try self.receiver(d.receiverBinding, d.receiverRange, op.sourceRange);
        const index = try self.scalar(d.index, 2, false);
        try self.need(self.position == endpoint and op.operands[0] == receiver_reg and op.operands[1] == index.reg, "r04-array-ssa");
        try self.need(op.sourceRange[0] == d.receiverRange[0] and d.receiverRange[1] < index.anchor[0] and index.anchor[1] < op.sourceRange[1], "r04-array-source");
        self.previous = statement[1];
        self.position += 1;
    }
    fn mutation(self: *Body, endpoint: usize) m.Error!void {
        self.mutations += 1;
        try self.need(self.mutations <= 32, "r04-array-limit");
        const op = self.f.instructions[endpoint];
        const store = op.opcode == 6;
        const expr = if (store) op.metadata.store.expressionRange else op.metadata.resize.expressionRange;
        const operator = if (store) op.metadata.store.operatorRange else op.metadata.resize.operatorRange;
        const target = if (store) op.metadata.store.target.range else op.metadata.resize.targetRange;
        const binding_id = if (store) op.metadata.store.target.receiverBinding else op.metadata.resize.receiverBinding;
        const receiver_range = if (store) op.metadata.store.target.receiverRange else op.metadata.resize.receiverRange;
        const s = op.sourceRange;
        try self.need(m.encloses(self.f.sourceRange, s) and s[0] >= self.previous and s[1] < self.f.sourceRange[1] and m.encloses(s, expr) and expr[0] == s[0] and m.encloses(expr, operator) and operator[1] - operator[0] == 1 and m.encloses(expr, target) and target[0] == expr[0], "r04-array-source");
        const reg = try self.receiver(binding_id, receiver_range, target);
        try self.need(target[0] == receiver_range[0], "r04-array-source");
        var index: Scalar = undefined;
        if (store) {
            index = try self.scalar(op.metadata.store.target.index, 2, false);
            try self.need(receiver_range[1] < index.anchor[0] and index.anchor[1] < target[1], "r04-array-source");
        } else {
            const d = op.metadata.resize;
            try self.need(m.eq(d.property, self.p.lengthProperty.id) and m.encloses(target, d.propertyNameRange) and receiver_range[1] < d.propertyNameRange[0] and target[1] == d.propertyNameRange[1], "r04-array-source");
        }
        const rhs = try self.scalar(if (store) op.metadata.store.value else op.metadata.resize.newLength, if (store) 1 else 2, !store);
        try self.need(self.position == endpoint and op.operands[0] == reg and (if (store) op.operands[1] == index.reg and op.operands[2] == rhs.reg else op.operands[1] == rhs.reg), "r04-array-ssa");
        try self.need(target[1] <= operator[0] and operator[1] <= rhs.anchor[0] and rhs.anchor[1] == expr[1] and m.encloses(expr, rhs.anchor), "r04-array-source");
        self.previous = s[1];
        self.position += 1;
    }
    fn call(self: *Body, endpoint: usize, returning: bool) m.Error!m.Range {
        self.calls += 1;
        try self.need(self.calls <= 32, "r04-array-limit");
        const op = self.f.instructions[endpoint];
        const d = op.metadata.call;
        var target: ?m.Function = null;
        for (self.p.functions) |candidate| if (m.text(candidate.name, d.callee)) {
            target = candidate;
        };
        try self.need(target != null, "r04-array-call");
        const t = target.?;
        try self.need(m.eq(t.functionId, d.functionId) and m.eq(t.signatureHash, d.signatureHash) and m.eq(t.sourceBinding, d.sourceCallee) and d.arguments.len == t.parameters.len and op.operands.len == d.arguments.len, "r04-array-call");
        const s = d.statementRange;
        const e = op.sourceRange;
        const c = d.calleeRange;
        try self.need(m.encloses(self.f.sourceRange, s) and m.encloses(s, e) and s[0] >= self.previous and s[1] < self.f.sourceRange[1] and (if (returning) s[0] < e[0] else s[0] == e[0]) and e[0] == c[0] and m.encloses(e, c) and e[1] - c[1] >= 2, "r04-array-source");
        var previous = c[1];
        for (d.arguments, 0..) |arg, i| {
            try self.need(arg.kind >= 1 and arg.kind <= 3, "r04-array-call");
            var value: Scalar = undefined;
            if (t.parameters[i].type == 3 or t.parameters[i].type == 4) {
                try self.need(arg.kind == 3 and m.eq(arg.typeId, m.typeId(t.parameters[i].type).?) and m.encloses(self.f.sourceRange, arg.range), "r04-array-call");
                const reg = try self.binding(arg.binding.?);
                try self.need(self.types[reg] == t.parameters[i].type, "r04-array-type");
                value = .{ .reg = reg, .anchor = arg.range };
            } else value = try self.scalar(arg, t.parameters[i].type, true);
            try self.need(value.anchor[0] > previous and value.anchor[1] < e[1] and op.operands[i] == value.reg and self.types[value.reg] == t.parameters[i].type, "r04-array-call");
            previous = value.anchor[1];
        }
        try self.need(self.position == endpoint, "r04-array-ssa");
        self.position += 1;
        if (!returning) self.previous = s[1];
        return s;
    }
    fn verify(self: *Body) m.Error!void {
        try self.shape();
        var statements: usize = 0;
        while (self.position < self.f.instructions.len) {
            statements += 1;
            try self.need(statements <= 50, "r04-array-limit");
            var endpoint = self.position;
            while (endpoint < self.f.instructions.len and (self.f.instructions[endpoint].opcode == 2 or self.f.instructions[endpoint].opcode == 5 or (self.f.instructions[endpoint].opcode == 9 and self.f.instructions[endpoint].metadata.view_read.statementRange == null))) : (endpoint += 1) {}
            try self.need(endpoint < self.f.instructions.len, "r04-array-shape");
            const op = self.f.instructions[endpoint];
            switch (op.opcode) {
                3, 4 => try self.arrayLocal(endpoint),
                8 => try self.viewLocal(endpoint),
                13 => try self.viewAlias(endpoint),
                9 => try self.standaloneRead(endpoint),
                10 => try self.viewLength(endpoint),
                6, 7 => try self.mutation(endpoint),
                11 => {
                    const returning = endpoint + 2 == self.f.instructions.len and self.f.instructions[endpoint + 1].opcode == 12 and self.f.instructions[endpoint + 1].operands[0] == op.resultRegister;
                    const statement = try self.call(endpoint, returning);
                    if (returning) {
                        const returned = self.f.instructions[self.position];
                        const use = returned.metadata.returned.value;
                        try self.need(m.same(returned.sourceRange, statement) and use.kind == 6 and use.binding == null and m.eq(use.typeId, m.f64_id) and m.same(use.range, op.sourceRange), "r04-array-call");
                        self.position += 1;
                    }
                },
                12 => {
                    const use = op.metadata.returned.value;
                    const value = try self.scalar(use, 1, false);
                    try self.need(self.position == endpoint and endpoint + 1 == self.f.instructions.len and op.operands[0] == value.reg, "r04-array-ssa");
                    const s = op.sourceRange;
                    try self.need(m.encloses(self.f.sourceRange, s) and s[0] >= self.previous and s[1] < self.f.sourceRange[1] and m.encloses(s, value.anchor) and s[0] < value.anchor[0], "r04-array-source");
                    self.position += 1;
                },
                else => return self.r.reject("r04-array-shape"),
            }
        }
        try self.need(self.f.instructions[self.f.instructions.len - 1].opcode == 12, "r04-array-shape");
    }
};
pub fn verify(r: *m.Reader, p: m.Payload) m.Error!void {
    var elements: usize = 0;
    for (p.functions) |f| {
        var body: Body = .{ .r = r, .p = p, .f = f, .elements = &elements, .previous = f.returnAnnotationRange[1] };
        try body.verify();
    }
}
