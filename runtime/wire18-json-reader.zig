// SPDX-License-Identifier: MIT
// Sole formal18 JSON boundary. This source has not been executed on a packet.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const publication = @import("wire-program-publication.zig");
const origin = @import("wire-program-return-origin-model.zig");
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
pub const Member = struct { key: []const u8, value: Node };
pub const Node = union(enum) { null, boolean: bool, integer: u64, string: []const u8, array: []const Node, object: []const Member };

// The protocol has fixed ASCII object keys; unknown keys are rejected by the
// typed conversion. Canonical ordering here is therefore also JCS UTF16 order.
pub const Decoder = struct {
    allocator: std.mem.Allocator,
    meter: *Meter,
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
            switch (std.mem.order(u8, rows[mid].key, name)) { .lt => low = mid + 1, .gt => high = mid, .eq => return rows[mid].value }
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
            if (out.format.version != 4) return error.InvalidShape;
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
    fn value(self:*Parser,depth:usize)Error!Node{
        try self.decoder.meter.spend(1);if(depth>32)return error.DepthLimit;if(self.at==self.bytes.len)return error.InvalidJson;
        const first=self.bytes[self.at];
        if(first=='"')return .{.string=try self.string()};
        inline for(.{"null","true","false"},0..)|text,index|if(first==text[0]){
            for(text)|ch|if(try self.take()!=ch)return error.InvalidJson;
            return switch(index){0=>.null,1=>.{.boolean=true},2=>.{.boolean=false},else=>unreachable};
        };
        if(first>='0' and first<='9'){
            var number:u64=0;var count:usize=0;
            while(self.at<self.bytes.len and self.bytes[self.at]>='0' and self.bytes[self.at]<='9'){
                const digit=try self.take();if(count>0 and first=='0')return error.InvalidJson;
                if(number>(9007199254740991-@as(u64,digit-'0'))/10)return error.InvalidJson;number=number*10+digit-'0';count+=1;
            }
            return .{.integer=number};
        }
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
                const key=try self.string();try self.decoder.meter.bytes(key.len);for(key)|ch|if(ch<32 or ch>=128)return error.InvalidJson;
                if(out.items.len>0){const old=out.items[out.items.len-1].key;try self.decoder.meter.bytes(old.len+key.len);if(std.mem.order(u8,old,key)!=.lt)return error.InvalidOrder;}
                if(try self.take()!=':')return error.InvalidJson;
                try self.decoder.reserve(Member,&out);out.appendAssumeCapacity(.{.key=key,.value=try self.value(depth+1)});
                const separator=try self.take();if(separator=='}')break;if(separator!=',')return error.InvalidJson;
            }
            return .{.object=out.items};
        }
        return error.InvalidJson;
    }
};
