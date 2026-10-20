// SPDX-License-Identifier: MIT
// Finite monotone possible-tag analysis over verified immutable SSA identities.
const std = @import("std");
const m = @import("nullable-model.zig");
const Graph = @import("nullable-cfg.zig").Graph;
const Analysis = struct {
    reader: *m.Reader,
    fnc: m.Function,
    graph: Graph,
    incoming: []u8,
    live: []bool,
    queued: []bool,
    queue: []u16,
    head: usize = 0,
    tail: usize = 0,
    count: usize = 0,
    inserted: usize = 0,
    popped: usize = 0,

    fn enqueue(self: *Analysis, block: u16) void {
        if (self.queued[block]) return;
        // At most one pending item per verified block; no allocating queue growth.
        std.debug.assert(self.count < self.queue.len);
        self.queue[self.tail] = block;
        self.tail = (self.tail + 1) % self.queue.len;
        self.count += 1;
        self.queued[block] = true;
    }
    fn merge(self: *Analysis, block: usize, reg: usize, bits: u8) m.Error!bool {
        const cell = &self.incoming[block * self.fnc.register_count + reg];
        const added = bits & ~cell.*;
        if (added == 0) return false;
        self.inserted += @popCount(added);
        if (self.inserted > 3 * self.incoming.len) return self.reader.reject("r04-nullable-proof-limit");
        cell.* |= added;
        return true;
    }
    fn transfer(self: *Analysis, block: usize, facts: []u8, proofs: bool) m.Error!void {
        const width = self.fnc.register_count;
        @memcpy(facts, self.incoming[block * width ..][0..width]);
        const descriptor = self.fnc.blocks[block];
        const instructions = self.fnc.instructions[descriptor.start..][0..descriptor.count];
        // Backedges cannot lend an earlier iteration's result proof to a new definition.
        for (instructions) |op| if (m.result(op.opcode)) {
            facts[op.register] = 0;
        };
        for (instructions) |op| {
            const operand: u16 = @truncate(op.immediate);
            if (proofs and (op.opcode == 243 or op.opcode == 244)) {
                const possible = if (self.live[block]) facts[operand] else 0;
                const allowed: u8 = if (op.opcode == 243) 1 else m.allowed(op.type_code);
                if (possible == 0 or possible & ~allowed != 0) return self.reader.reject("r04-nullable-proof");
            }
            if (m.result(op.opcode) and m.nullable(op.type_code)) {
                var possible: u8 = 0;
                if (self.live[block]) {
                    if (op.opcode == 240) possible = 1 else if (op.opcode == 241) possible = @as(u8, 1) << @as(u3, @intCast(op.immediate)) else if (op.opcode == 244) possible = facts[operand] else if (op.opcode == 27) possible = m.allowed(op.type_code);
                }
                facts[op.register] = possible;
            }
        }
    }
    fn propagate(self: *Analysis, target: u16, arguments: []const u16, facts: []const u8, predicate: ?m.Instruction, truth: bool) m.Error!void {
        var subject: ?u16 = null;
        var filter: u8 = 7;
        if (predicate) |op| {
            const operand: u16 = @truncate(op.immediate);
            const tested = @as(u8, 1) << @as(u3, @intCast(op.immediate >> 16));
            subject = operand;
            filter = if (truth) tested else 7 & ~tested;
            if (facts[operand] & filter == 0) return;
        }
        var changed = !self.live[target];
        self.live[target] = true;
        for (facts, 0..) |bits, reg| {
            // Destination phi/local definitions acquire only actual edge/current values.
            if (self.graph.definitions[reg] == target) continue;
            const selected = if (subject != null and subject.? == reg) bits & filter else bits;
            changed = try self.merge(target, reg, selected) or changed;
        }
        for (arguments, self.fnc.blocks[target].parameters) |argument, parameter| {
            const selected = if (subject != null and subject.? == argument) facts[argument] & filter else facts[argument];
            changed = try self.merge(target, parameter.register, selected) or changed;
        }
        if (changed) self.enqueue(target);
    }
};

pub fn verify(reader: *m.Reader, allocator: m.Allocator, fnc: m.Function, graph: Graph) m.Error!void {
    const blocks = fnc.blocks.len;
    const width: usize = fnc.register_count;
    const cells = blocks * width;
    if (cells > 1048576) return reader.reject("r04-nullable-proof-limit");
    var analysis: Analysis = .{ .reader = reader, .fnc = fnc, .graph = graph, .incoming = try allocator.alloc(u8, cells), .live = try allocator.alloc(bool, blocks), .queued = try allocator.alloc(bool, blocks), .queue = try allocator.alloc(u16, blocks) };
    @memset(analysis.incoming, 0);
    @memset(analysis.live, false);
    @memset(analysis.queued, false);
    analysis.live[0] = true;
    for (fnc.blocks[0].parameters) |parameter| _ = try analysis.merge(0, parameter.register, m.allowed(parameter.type_code));
    analysis.enqueue(0);
    const facts = try allocator.alloc(u8, width);
    while (analysis.count != 0) {
        analysis.popped += 1;
        if (analysis.popped > 3 * cells + blocks + 1) return reader.reject("r04-nullable-proof-limit");
        const block = analysis.queue[analysis.head];
        analysis.head = (analysis.head + 1) % blocks;
        analysis.count -= 1;
        analysis.queued[block] = false;
        try analysis.transfer(block, facts, false);
        const descriptor = fnc.blocks[block];
        const last = fnc.instructions[descriptor.start + descriptor.count - 1];
        if (!analysis.live[block]) continue;
        if (last.opcode == 24) try analysis.propagate(@truncate(last.immediate), last.edges[0], facts, null, true) else if (last.opcode == 25) {
            var predicate: ?m.Instruction = null;
            for (fnc.instructions) |op| if (op.opcode == 242 and op.register == last.register) {
                predicate = op;
                break;
            };
            try analysis.propagate(@truncate(last.immediate), last.edges[0], facts, predicate, true);
            try analysis.propagate(@truncate(last.immediate >> 16), last.edges[1], facts, predicate, false);
        }
    }
    for (0..blocks) |block| try analysis.transfer(block, facts, true);
}
