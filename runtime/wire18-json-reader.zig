// SPDX-License-Identifier: MIT
// Sole formal18 JSON boundary. This source has not been executed on a packet.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const publication = @import("wire-program-publication.zig");
const origin = @import("wire-program-return-origin-model.zig");
const control = @import("wire-program-control.zig");
const t = model.types;
pub const Error = std.mem.Allocator.Error || error{ InvalidJson, InvalidShape, InvalidOrder, WorkLimit, DepthLimit, UnsupportedMode };
pub const Meter = struct {
    remaining: usize = model.format.max_work,
    pub fn spend(self: *Meter, units: usize) Error!void {
        if (units > self.remaining) { self.remaining = 0; return error.WorkLimit; }
        self.remaining -= units;
    }
    pub fn bytes(self: *Meter, count: usize) Error!void { try self.spend(1 + count / 64); }
};
pub const Member = t.JsonMember;
pub const Node = t.JsonValue;

// Protocol records have fixed keys rejected by typed conversion. Open operation
// properties retain the complete canonical JSON grammar and UTF16 key order.
pub const Decoder = struct {
    allocator: std.mem.Allocator,
    meter: *Meter,
    // Borrowed from this decoder's owning arena after table0 is converted.
    // Plan paths become typed references; this is not original Source proof.
    sources: []const tables.Source = &.{},
    fn reserve(self: *Decoder, comptime T: type, list: *std.ArrayListUnmanaged(T)) Error!void {
        if (list.items.len < list.capacity) return;
        const capacity = @max(@as(usize, 8), list.capacity * 2);
        if (T == u8) { try self.meter.bytes(capacity); try self.meter.bytes(list.items.len); }
        else { try self.meter.spend(1 + capacity + list.items.len); try self.meter.bytes(capacity * @sizeOf(T)); try self.meter.bytes(list.items.len * @sizeOf(T)); }
        try list.ensureTotalCapacityPrecise(self.allocator, capacity);
    }
    pub fn alloc(self: *Decoder, comptime T: type, count: usize) Error![]T {
        if (count > model.format.max_bytes / @max(@sizeOf(T), 1)) return error.InvalidShape;
        try self.meter.spend(1 + count); try self.meter.bytes(count * @sizeOf(T));
        return self.allocator.alloc(T, count);
    }
    pub fn parse(self: *Decoder, bytes: []const u8) Error!Node {
        try self.meter.bytes(bytes.len); try self.meter.bytes(bytes.len);
        if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidJson;
        var parser = Parser{ .decoder = self, .bytes = bytes };
        const node = try parser.value(0);
        if (parser.at != bytes.len) return error.InvalidJson;
        return node;
    }
    pub fn object(self: *Decoder, node: Node) Error![]const Member {
        try self.meter.spend(1); return switch (node) { .object => |v| v, else => error.InvalidShape };
    }
    pub fn get(self: *Decoder, rows: []const Member, name: []const u8) Error!Node {
        return (try self.maybe(rows, name)) orelse error.InvalidShape;
    }
    pub fn maybe(self: *Decoder, rows: []const Member, name: []const u8) Error!?Node {
        var low: usize = 0; var high = rows.len;
        while (low < high) {
            const mid = low + (high - low) / 2;
            try self.meter.bytes(name.len + rows[mid].key.len);
            switch (keyOrder(rows[mid].key, name)) { .lt => low = mid + 1, .gt => high = mid, .eq => return rows[mid].value }
        }
        return null;
    }
    fn shape(self: *Decoder, rows: []const Member, names: []const []const u8) Error!void {
        try self.meter.spend(rows.len + names.len + 1);
        if (rows.len != names.len) return error.InvalidShape;
        for (names) |name| _ = try self.get(rows, name);
    }
    pub fn text(self: *Decoder, node: Node) Error![]const u8 {
        try self.meter.spend(1); return switch (node) { .string => |v| v, else => error.InvalidShape };
    }
    pub fn number(self: *Decoder, comptime T: type, node: Node) Error!T {
        try self.meter.spend(1);
        const n = switch (node) { .integer => |v| v, else => return error.InvalidShape };
        if (n > std.math.maxInt(T)) return error.InvalidShape;
        return @intCast(n);
    }
    fn record(self: *Decoder, comptime T: type, rows: []const Member, extras: []const []const u8) Error!T {
        const fields = @typeInfo(T).@"struct".fields;
        try self.meter.spend(1 + fields.len + extras.len);
        if (rows.len != fields.len + extras.len) return error.InvalidShape;
        for (extras) |extra| _ = try self.get(rows, extra);
        var out: T = undefined;
        inline for (fields) |field| @field(out, field.name) = try self.convert(field.type, try self.get(rows, camel(field.name)));
        return out;
    }
    pub fn convert(self: *Decoder, comptime T: type, node: Node) Error!T {
        try self.meter.spend(1);
        if (T == control.SourcePlan) return self.sourcePlan(node);
        if (T == t.Hash) {
            const hash_text = try self.text(node); try self.meter.bytes(hash_text.len); try self.meter.bytes(hash_text.len);
            if (hash_text.len != 71 or !std.mem.startsWith(u8, hash_text, "sha256:")) return error.InvalidShape;
            var out: t.Hash = undefined;
            for (hash_text[7..]) |ch| if (!(ch >= '0' and ch <= '9' or ch >= 'a' and ch <= 'f')) return error.InvalidShape;
            _ = std.fmt.hexToBytes(&out, hash_text[7..]) catch return error.InvalidShape; return out;
        }
        if (T == t.Carrier) {
            const rows = try self.object(node); try self.shape(rows, &.{ "kind", "ref" });
            const kind = try self.number(u16, try self.get(rows, "kind")); const ref = try self.get(rows, "ref");
            return switch (kind) {
                0 => .{ .domain = try self.convert(t.DomainRef, ref) }, 1 => .{ .environment = try self.convert(t.EnvironmentRef, ref) },
                2 => .{ .@"type" = try self.convert(t.TypeRef, ref) }, 3 => .{ .cell = try self.convert(t.CellRef, ref) },
                4 => blk: { if (try self.number(u32, ref) != 0) return error.InvalidShape; break :blk .{ .payload = {} }; },
                5 => .{ .receiver = try self.convert(t.ConstructionRef, ref) }, 6 => .{ .initialization = try self.convert(t.ConstructionRef, ref) }, else => error.InvalidShape,
            };
        }
        if (T == storage.CommonBinding) {
            const rows = try self.object(node); try self.shape(rows, &.{ "id", "role", "owner", "name", "type", "writable", "origin", "carrier", "scope", "declarationKind" });
            const role = try self.convert(storage.BindingRole, try self.get(rows, "role")); const owner = try self.get(rows, "owner");
            const owned: storage.BindingOwner = switch (role) {
                .param => .{ .param = try self.convert(t.FunctionRef, owner) }, .local => .{ .local = try self.convert(t.FunctionRef, owner) },
                .receiver => .{ .receiver = try self.convert(t.FunctionRef, owner) }, .global => .{ .global = try self.convert(t.GlobalRef, owner) },
                .field => .{ .field = try self.convert(t.FieldRef, owner) }, .element => .{ .element = try self.convert(t.TypeRef, owner) },
            };
            return .{ .id = try self.convert([]const u8, try self.get(rows,"id")), .owner=owned, .name=try self.convert([]const u8,try self.get(rows,"name")),
                .@"type"=try self.convert(t.TypeRef,try self.get(rows,"type")), .writable=try self.convert(bool,try self.get(rows,"writable")),
                .origin=try self.convert(?t.Origin,try self.get(rows,"origin")), .carrier=try self.convert(t.Carrier,try self.get(rows,"carrier")),
                .scope=try self.convert(?t.ScopeRef,try self.get(rows,"scope")), .declaration_kind=try self.convert(@FieldType(T,"declaration_kind"),try self.get(rows,"declarationKind")) };
        }
        if (T == t.FieldLayout) {
            const rows=try self.object(node); try self.shape(rows,&.{"byteSize","alignment","referenceCount","fieldOffsets"});
            return .{.layout=.{.byte_size=try self.number(u32,try self.get(rows,"byteSize")),.alignment=try self.number(u16,try self.get(rows,"alignment")),.reference_count=try self.number(u16,try self.get(rows,"referenceCount"))},.field_offsets=try self.convert([]const u32,try self.get(rows,"fieldOffsets"))};
        }
        if (T == tables.FieldLike) {
            const rows=try self.object(node);const kind=try self.text(try self.get(rows,"kind"));
            if (try self.equal(kind,"field")) { try self.shape(rows,&.{"kind","index"});return .{.field=try self.convert(t.FieldRef,try self.get(rows,"index"))}; }
            if (try self.equal(kind,"length")) { try self.shape(rows,&.{"kind","owner"});return .{.length=try self.convert(t.TypeRef,try self.get(rows,"owner"))}; }
            return error.InvalidShape;
        }
        if (T == tables.Dispatch) {
            const rows=try self.object(node);const kind=try self.text(try self.get(rows,"kind"));
            inline for (@typeInfo(T).@"union".fields) |field| if (try self.equal(kind,field.name)) return @unionInit(T,field.name,try self.record(field.type,rows,&.{"kind"}));
            return error.InvalidShape;
        }
        if (T == publication.ScopeShape) return self.scopeShape(node);
        if (T == publication.Publication) {
            const out = try self.record(T, try self.object(node), &.{});
            if (out.format.version != 5) return error.InvalidShape;
            return out;
        }
        if (T == origin.Graph) {
            const rows=try self.object(node);try self.shape(rows,&.{"format","nodes","heaps","controls","calls","normal","language","exits","accesses"});
            const format=try self.object(try self.get(rows,"format"));try self.shape(format,&.{"family","version"});
            if (!try self.equal(try self.text(try self.get(format,"family")),"tsfg.return-origin-graph-candidate") or try self.number(u32,try self.get(format,"version"))!=5) return error.InvalidShape;
            var out: T=undefined;out.version=5;
            inline for (@typeInfo(T).@"struct".fields) |field| if (!std.mem.eql(u8,field.name,"version")) { @field(out,field.name)=try self.convert(field.type,try self.get(rows,camel(field.name))); };
            return out;
        }
        if (T == origin.Value or T == origin.Heap or T == origin.Control) {
            const rows=try self.object(node);const kind=try self.text(try self.get(rows,"kind"));
            inline for (@typeInfo(T).@"union".fields) |field| {
                if (try self.equal(kind,camel(field.name))) {
                    if (field.type == void) {
                        if (T == origin.Value) {try self.shape(rows,&.{"kind","type"});if (try self.get(rows,"type")!=.null) return error.InvalidShape;} else try self.shape(rows,&.{"kind"});
                        return @unionInit(T,field.name,{});
                    }
                    const null_type=T == origin.Value and (std.mem.eql(u8,field.name,"receiver_frame") or std.mem.startsWith(u8,field.name,"environment_"));
                    if (null_type) {if (try self.get(rows,"type")!=.null) return error.InvalidShape;return @unionInit(T,field.name,try self.record(field.type,rows,&.{"kind","type"}));}
                    return @unionInit(T,field.name,try self.record(field.type,rows,&.{"kind"}));
                }
            }
            return error.InvalidShape;
        }
        switch (@typeInfo(T)) {
            .bool => return switch(node){.boolean=>|v|v,else=>error.InvalidShape},
            .int => return self.number(T,node),
            .void => {if(node!=.null)return error.InvalidShape;return {};},
            .optional => |info| return if(node==.null) null else try self.convert(info.child,node),
            .@"enum" => |info| {
                if (!info.is_exhaustive) return @enumFromInt(try self.number(info.tag_type,node));
                const enum_text=try self.text(node);
                inline for(info.fields)|field|if(try self.equal(enum_text,field.name))return @enumFromInt(field.value);
                return error.InvalidShape;
            },
            .pointer => |info| {
                if(info.size!=.slice)@compileError("formal DTO requires owned slices");
                if(info.child==u8)return self.text(node);
                const items=switch(node){.array=>|v|v,else=>return error.InvalidShape};
                const out=try self.alloc(info.child,items.len);
                for(items,0..)|item,i|out[i]=try self.convert(info.child,item);
                return out;
            },
            .array => |info| {
                const items=switch(node){.array=>|v|v,else=>return error.InvalidShape};if(items.len!=info.len)return error.InvalidShape;
                if(info.len==0)return .{};
                var out:T=undefined;for(items,0..)|item,i|{try self.meter.spend(1);out[i]=try self.convert(info.child,item);}return out;
            },
            .@"struct" => return self.record(T,try self.object(node),&.{}),
            else => @compileError("unmapped formal DTO kind"),
        }
    }
    fn boundedText(self: *Decoder, node: Node, minimum: usize) Error![]const u8 {
        const value = try self.text(node);
        try self.meter.bytes(value.len);
        if (value.len < minimum or value.len > 4096 or std.mem.indexOfScalar(u8, value, 0) != null or
            !std.unicode.utf8ValidateSlice(value)) return error.InvalidShape;
        return value;
    }
    fn array(self: *Decoder, node: Node, maximum: usize) Error![]const Node {
        try self.meter.spend(1);
        const rows = switch (node) { .array => |v| v, else => return error.InvalidShape };
        if (rows.len > maximum) return error.InvalidShape;
        return rows;
    }
    // This is the sole untrusted sourcePlan boundary. It owns syntax, internal
    // references and Source-directory joins, never logical/physical matching.
    // Arbitrary properties remain owned JSON syntax for that later checker.
    fn sourcePlan(self: *Decoder, node: Node) Error!control.SourcePlan {
        const plan = try self.object(node);
        try self.shape(plan, &.{ "carriers", "blocks" });
        const carrier_rows = try self.array(try self.get(plan, "carriers"), 4096);
        const block_rows = try self.array(try self.get(plan, "blocks"), 256);
        if (block_rows.len == 0 or self.sources.len == 0 or self.sources.len > 128) return error.InvalidShape;
        const carriers = try self.alloc([]const u8, carrier_rows.len);
        for (carrier_rows, 0..) |row, i| carriers[i] = try self.boundedText(row, 1);
        const blocks = try self.alloc(control.SourcePlanBlock, block_rows.len);
        const defined = try self.alloc(bool, carriers.len);
        const used = try self.alloc(bool, carriers.len);
        const incoming = try self.alloc(usize, blocks.len);
        @memset(defined, false); @memset(used, false); @memset(incoming, 0);
        var operation_count: usize = 0;
        for (block_rows, 0..) |block_node, b| {
            const block = try self.object(block_node);
            try self.shape(block, &.{ "parameters", "operations" });
            const parameter_rows = try self.array(try self.get(block, "parameters"), 4096);
            const operation_rows = try self.array(try self.get(block, "operations"), 8192 - operation_count);
            operation_count += operation_rows.len;
            const parameters = try self.alloc(t.RegisterRef, parameter_rows.len);
            for (parameter_rows, 0..) |row, i| {
                const parameter = try self.convert(t.RegisterRef, row);
                const index = @intFromEnum(parameter);
                if (index >= carriers.len or defined[index]) return error.InvalidShape;
                defined[index] = true; parameters[i] = parameter;
            }
            const operations = try self.alloc(control.SourcePlanOperation, operation_rows.len);
            for (operation_rows, 0..) |operation_node, n| {
                const row = try self.object(operation_node);
                try self.shape(row, &.{ "name", "view", "properties", "result", "operands", "successors", "source" });
                const name = try self.boundedText(try self.get(row, "name"), 1);
                const view = try self.boundedText(try self.get(row, "view"), 0);
                const properties = try self.object(try self.get(row, "properties"));
                const result = try self.convert(?t.RegisterRef, try self.get(row, "result"));
                if (result) |ref| {
                    const index = @intFromEnum(ref);
                    if (index >= carriers.len or defined[index]) return error.InvalidShape;
                    defined[index] = true;
                }
                const operand_rows = try self.array(try self.get(row, "operands"), 4096);
                const operands = try self.alloc(t.RegisterRef, operand_rows.len);
                for (operand_rows, 0..) |operand, i| {
                    const ref = try self.convert(t.RegisterRef, operand);
                    const index = @intFromEnum(ref);
                    if (index >= carriers.len) return error.InvalidShape;
                    used[index] = true; operands[i] = ref;
                }
                const successor_rows = try self.array(try self.get(row, "successors"), 256);
                const successors = try self.alloc(t.BlockRef, successor_rows.len);
                for (successor_rows, 0..) |successor, i| {
                    const ref = try self.convert(t.BlockRef, successor);
                    const index = @intFromEnum(ref);
                    if (index >= blocks.len or n + 1 != operation_rows.len) return error.InvalidShape;
                    incoming[index] += 1; successors[i] = ref;
                }
                if ((try self.equal(name, "invoke") or try self.equal(name, "invoke_method") or
                    try self.equal(name, "invoke_indirect")) and successors.len != 2) return error.InvalidShape;
                const source = try self.object(try self.get(row, "source"));
                try self.shape(source, &.{ "path", "start", "end" });
                const path = try self.boundedText(try self.get(source, "path"), 1);
                const start = try self.number(u32, try self.get(source, "start"));
                const end = try self.number(u32, try self.get(source, "end"));
                if (start > end) return error.InvalidShape;
                var source_ref: ?t.SourceRef = null;
                for (self.sources, 0..) |entry, i| {
                    if (!try self.equal(path, entry.path)) continue;
                    if (source_ref != null or end > entry.length) return error.InvalidShape;
                    source_ref = @enumFromInt(i);
                }
                operations[n] = .{ .name = name, .view = view, .properties = properties, .result = result,
                    .operands = operands, .successors = successors,
                    .source = .{ .source = source_ref orelse return error.InvalidShape, .start = start, .end = end } };
            }
            blocks[b] = .{ .parameters = parameters, .operations = operations };
        }
        try self.meter.spend(defined.len + blocks.len);
        if (blocks[0].operations.len == 0) return error.InvalidShape;
        for (defined) |present| if (!present) return error.InvalidShape;
        for (blocks, 0..) |block, b| {
            if (block.operations.len != 0) continue;
            if (b == 0 or incoming[b] != 0) return error.InvalidShape;
            try self.meter.spend(block.parameters.len);
            for (block.parameters) |parameter| if (used[@intFromEnum(parameter)]) return error.InvalidShape;
        }
        return .{ .carriers = carriers, .blocks = blocks };
    }
    fn equal(self:*Decoder,a:[]const u8,b:[]const u8)Error!bool{try self.meter.bytes(a.len+b.len);return std.mem.eql(u8,a,b);}
    fn scopeShape(self:*Decoder,node:Node)Error!publication.ScopeShape{
        const rows=try self.object(node);const kind=try self.text(try self.get(rows,"kind"));
        inline for(.{"scalar","string","unknown","undefined","null","void"})|name|if(try self.equal(kind,name))return .{.primitive=try self.record(@FieldType(publication.ScopeShape,"primitive"),rows,&.{})};
        if(try self.equal(kind,"function"))return .{.function=try self.record(@FieldType(publication.ScopeShape,"function"),rows,&.{})};
        if(try self.equal(kind,"union"))return .{.union_type=try self.record(@FieldType(publication.ScopeShape,"union_type"),rows,&.{})};
        if(try self.equal(kind,"array") or try self.equal(kind,"readSpan"))return .{.element=try self.record(@FieldType(publication.ScopeShape,"element"),rows,&.{})};
        if(!try self.equal(kind,"reference") and !try self.equal(kind,"value"))return error.InvalidShape;
        const N=@FieldType(publication.ScopeShape,"nominal");const C=@FieldType(N,"construction");
        const base=try self.maybe(rows,"base");const methods=try self.maybe(rows,"methods");
        if(rows.len!=4+@as(usize,@intFromBool(base!=null))+@as(usize,@intFromBool(methods!=null)))return error.InvalidShape;
        const constructor=try self.object(try self.get(rows,"construction"));
        const incoming=try self.maybe(constructor,"argumentTypes");const minimum=try self.maybe(constructor,"minimumArgumentCount");
        if((incoming==null)!=(minimum==null) or constructor.len!=3+2*@as(usize,@intFromBool(incoming!=null)))return error.InvalidShape;
        return .{.nominal=.{.kind=try self.convert(@FieldType(N,"kind"),try self.get(rows,"kind")),.label=try self.convert([]const u8,try self.get(rows,"label")),
            .base=if(base)|v|try self.convert([]const u8,v) else null,.methods=if(methods)|v|try self.convert(std.meta.Child(@FieldType(N,"methods")),v) else null,
            .fields=try self.convert(@FieldType(N,"fields"),try self.get(rows,"fields")),
            .construction=.{.access=try self.convert(@FieldType(C,"access"),try self.get(constructor,"access")),.parameters=try self.convert(@FieldType(C,"parameters"),try self.get(constructor,"parameters")),
                .return_type=try self.convert([]const u8,try self.get(constructor,"returnType")),.argument_signature=if(incoming)|v|.{.argument_types=try self.convert([]const []const u8,v),.minimum_argument_count=try self.number(u16,minimum.?)} else null}}};
    }
};
fn camel(comptime input:[]const u8)[]const u8{
    return comptime blk:{var result:[]const u8="";var upper=false;for(input)|ch|{if(ch=='_'){upper=true;continue;}result=result++[1]u8{if(upper)std.ascii.toUpper(ch)else ch};upper=false;}break :blk result;};
}

const KeyUnits = struct {
    bytes: []const u8, at: usize = 0, pending: ?u16 = null,
    fn next(self: *KeyUnits) ?u16 {
        if (self.pending) |unit| { self.pending = null; return unit; }
        if (self.at == self.bytes.len) return null;
        // parse() already validated UTF8; canonical escapes decode only ASCII.
        const count = std.unicode.utf8ByteSequenceLength(self.bytes[self.at]) catch unreachable;
        const point = std.unicode.utf8Decode(self.bytes[self.at..][0..count]) catch unreachable;
        self.at += count;
        if (point <= 0xffff) return @intCast(point);
        const value = point - 0x10000;
        self.pending = @intCast(0xdc00 + (value & 1023));
        return @intCast(0xd800 + (value >> 10));
    }
};
fn keyOrder(a: []const u8, b: []const u8) std.math.Order {
    var left = KeyUnits{ .bytes = a }; var right = KeyUnits{ .bytes = b };
    while (true) {
        const l = left.next(); const r = right.next();
        if (l == null) return if (r == null) .eq else .lt;
        if (r == null) return .gt;
        if (l.? < r.?) return .lt;
        if (l.? > r.?) return .gt;
    }
}

const Parser=struct{
    decoder:*Decoder,bytes:[]const u8,at:usize=0,
    // parse() prepays the complete UTF8 scan and byte/tokenizer traversal.
    fn take(self:*Parser)Error!u8{if(self.at==self.bytes.len)return error.InvalidJson;const ch=self.bytes[self.at];self.at+=1;return ch;}
    fn string(self:*Parser)Error![]const u8{
        if(try self.take()!='"')return error.InvalidJson;
        var out:std.ArrayListUnmanaged(u8)=.empty;
        while(true){
            const ch=try self.take();if(ch=='"')break;if(ch<32)return error.InvalidJson;
            var decoded=ch;
            if(ch=='\\'){
                const escape=try self.take();decoded=switch(escape){'"'=>'"','\\'=>'\\','b'=>8,'t'=>9,'n'=>10,'f'=>12,'r'=>13,'u'=>blk:{
                    if(try self.take()!='0' or try self.take()!='0')return error.InvalidJson;
                    const a=try self.take();const b=try self.take();const digits="0123456789abcdef";
                    const high=std.mem.indexOfScalar(u8,digits,a) orelse return error.InvalidJson;const low=std.mem.indexOfScalar(u8,digits,b) orelse return error.InvalidJson;
                    const v: u8=@intCast(high*16+low);if(v>=32 or v==8 or v==9 or v==10 or v==12 or v==13)return error.InvalidJson;break :blk v;
                },else=>return error.InvalidJson};
            }
            // Reserve prepays allocation/copy. Decoded byte writes are a
            // separate traversal, charged in the same fixed byte chunks.
            if (out.items.len % 64 == 0) try self.decoder.meter.spend(1);
            try self.decoder.reserve(u8,&out);out.appendAssumeCapacity(decoded);
        }
        return out.items;
    }
    fn number(self: *Parser) Error!Node {
        const start = self.at;
        const negative = self.bytes[self.at] == '-';
        if (negative) self.at += 1;
        if (self.at == self.bytes.len) return error.InvalidJson;
        if (self.bytes[self.at] == '0') self.at += 1 else {
            if (self.bytes[self.at] < '1' or self.bytes[self.at] > '9') return error.InvalidJson;
            while (self.at < self.bytes.len and std.ascii.isDigit(self.bytes[self.at])) self.at += 1;
        }
        var plain = !negative;
        if (self.at < self.bytes.len and self.bytes[self.at] == '.') {
            plain = false; self.at += 1;
            const first = self.at;
            while (self.at < self.bytes.len and std.ascii.isDigit(self.bytes[self.at])) self.at += 1;
            if (first == self.at) return error.InvalidJson;
        }
        if (self.at < self.bytes.len and (self.bytes[self.at] == 'e' or self.bytes[self.at] == 'E')) {
            plain = false; self.at += 1;
            if (self.at < self.bytes.len and (self.bytes[self.at] == '+' or self.bytes[self.at] == '-')) self.at += 1;
            const first = self.at;
            while (self.at < self.bytes.len and std.ascii.isDigit(self.bytes[self.at])) self.at += 1;
            if (first == self.at) return error.InvalidJson;
        }
        const token = self.bytes[start..self.at];
        // Token traversal was prepaid by parse(); conversion, normalization and
        // the owned copy below spend this same meter before scanning/copying.
        try self.decoder.meter.bytes(token.len);
        if (plain) {
            const integer = std.fmt.parseInt(u64, token, 10) catch null;
            if (integer) |decoded_integer| if (decoded_integer <= 9007199254740991) return .{ .integer = decoded_integer };
        }
        try self.decoder.meter.bytes(token.len);
        const parsed_number = std.fmt.parseFloat(f64, token) catch return error.InvalidJson;
        if (!std.math.isFinite(parsed_number)) return error.InvalidJson;
        var output: [64]u8 = undefined; var length: usize = 0;
        if (parsed_number == 0) { output[0] = '0'; length = 1; } else {
            // Same shortest IEEEbinary64 + ECMAScript layout as the Common
            // canonical writer. The typed result keeps its text, not a float.
            var scientific_buffer: [64]u8 = undefined;
            try self.decoder.meter.bytes(scientific_buffer.len);
            const scientific = std.fmt.bufPrint(&scientific_buffer, "{e}", .{parsed_number}) catch return error.InvalidJson;
            try self.decoder.meter.bytes(scientific.len);
            const e = std.mem.indexOfScalar(u8, scientific, 'e') orelse return error.InvalidJson;
            var digits: [24]u8 = undefined; var count: usize = 0;
            const offset: usize = if (scientific[0] == '-') 1 else 0;
            try self.decoder.meter.bytes(e - offset);
            for (scientific[offset..e]) |ch| if (ch != '.') { digits[count] = ch; count += 1; };
            try self.decoder.meter.bytes(scientific.len - e - 1);
            const exponent = std.fmt.parseInt(i16, scientific[e + 1..], 10) catch return error.InvalidJson;
            const k = exponent + 1;
            try self.decoder.meter.bytes(output.len);
            if (offset == 1) { output[0] = '-'; length = 1; }
            if (k > 0 and k <= 21) {
                const whole: usize = @intCast(k);
                const first = @min(whole, count);
                @memcpy(output[length..][0..first], digits[0..first]); length += first;
                if (whole >= count) { @memset(output[length..][0..whole - count], '0'); length += whole - count; }
                else { output[length] = '.'; length += 1; @memcpy(output[length..][0..count - whole], digits[whole..count]); length += count - whole; }
            } else if (k <= 0 and k > -6) {
                const zeros: usize = @intCast(-k);
                @memcpy(output[length..][0..2], "0."); length += 2;
                @memset(output[length..][0..zeros], '0'); length += zeros;
                @memcpy(output[length..][0..count], digits[0..count]); length += count;
            } else {
                output[length] = digits[0]; length += 1;
                if (count > 1) { output[length] = '.'; length += 1; @memcpy(output[length..][0..count - 1], digits[1..count]); length += count - 1; }
                output[length] = 'e'; length += 1;
                if (exponent >= 0) { output[length] = '+'; length += 1; }
                const suffix = std.fmt.bufPrint(output[length..], "{d}", .{exponent}) catch return error.InvalidJson;
                length += suffix.len;
            }
        }
        try self.decoder.meter.bytes(token.len + length);
        if (!std.mem.eql(u8, token, output[0..length])) return error.InvalidJson;
        try self.decoder.meter.bytes(token.len);
        try self.decoder.meter.bytes(token.len);
        return .{ .number = .{ .canonical = try self.decoder.allocator.dupe(u8, token) } };
    }
    fn value(self:*Parser,depth:usize)Error!Node{
        try self.decoder.meter.spend(1);if(depth>32)return error.DepthLimit;if(self.at==self.bytes.len)return error.InvalidJson;
        const first=self.bytes[self.at];
        if(first=='"')return .{.string=try self.string()};
        inline for(.{"null","true","false"},0..)|text,index|if(first==text[0]){
            for(text)|ch|if(try self.take()!=ch)return error.InvalidJson;
            return switch(index){0=>.null,1=>.{.boolean=true},2=>.{.boolean=false},else=>unreachable};
        };
        if(first=='-' or first>='0' and first<='9')return self.number();
        if(first=='['){
            _=try self.take();var out:std.ArrayListUnmanaged(Node)=.empty;
            if(self.at<self.bytes.len and self.bytes[self.at]==']'){_=try self.take();return .{.array=out.items};}
            while(true){try self.decoder.reserve(Node,&out);out.appendAssumeCapacity(try self.value(depth+1));const separator=try self.take();if(separator==']')break;if(separator!=',')return error.InvalidJson;}
            return .{.array=out.items};
        }
        if(first=='{'){
            _=try self.take();var out:std.ArrayListUnmanaged(Member)=.empty;
            if(self.at<self.bytes.len and self.bytes[self.at]=='}'){_=try self.take();return .{.object=out.items};}
            while(true){
                const key=try self.string();
                if(out.items.len>0){const old=out.items[out.items.len-1].key;try self.decoder.meter.bytes(old.len+key.len);if(keyOrder(old,key)!=.lt)return error.InvalidOrder;}
                if(try self.take()!=':')return error.InvalidJson;
                try self.decoder.reserve(Member,&out);out.appendAssumeCapacity(.{.key=key,.value=try self.value(depth+1)});
                const separator=try self.take();if(separator=='}')break;if(separator!=',')return error.InvalidJson;
            }
            return .{.object=out.items};
        }
        return error.InvalidJson;
    }
};
