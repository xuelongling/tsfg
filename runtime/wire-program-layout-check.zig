// SPDX-License-Identifier: MIT
// Independent arithmetic for the owned wire17 tables, after reference checks.
// Layout consistency is not actual SSA, Source provenance, borrow validation,
// a digest check, reader admission or execution permission. No bytes are read.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const t = model.types;
const context = @import("wire-program-refcheck-context.zig");
const Context = context.Context;
const Error = context.Error;
const none = std.math.maxInt(u32);

const Shape = struct { bytes: u32 = 0, alignment: u16 = 1, roots: u16 = 0 };
const Entry = struct { state: enum { empty, active, done } = .empty, shape: Shape = .{} };
const Cache = struct {
    c: *Context, types: []Entry, domains: []Entry,
    fn init(c: *Context, nt: usize, nd: usize) Error!Cache {
        try c.charge(nt + nd);
        const ts = try c.allocator.alloc(Entry, nt); errdefer c.allocator.free(ts);
        const ds = try c.allocator.alloc(Entry, nd);
        @memset(ts, .{}); @memset(ds, .{});
        return .{ .c=c, .types=ts, .domains=ds };
    }
    fn deinit(self: *Cache) void { self.c.allocator.free(self.types); self.c.allocator.free(self.domains); }
};
fn aligned(c: *Context, value: u32, width: u16, limit: u32) Error!u32 {
    try c.step();
    // width comes only from independently derived 1/2/4/8-byte layouts.
    try c.require(value <= limit);
    const padding = (@as(u32, width) - value % width) % width;
    try c.require(padding <= limit - value); return value + padding;
}
fn equal(c: *Context, p: Shape, bytes: u32, alignment: u16, roots: u16) Error!void {
    try c.charge(3); try c.require(p.bytes == bytes and p.alignment == alignment and p.roots == roots);
}
fn scalar(c: *Context, name: []const u8, code: ?u8) Error!Shape {
    const names = [_][]const u8{ "i32", "bool", "i8", "i16", "i64", "u8", "u16", "u32", "u64", "isize", "usize", "f32", "f64" };
    const widths = [_]u16{ 4, 1, 1, 2, 8, 1, 2, 4, 8, 8, 8, 4, 8 };
    if (code) |id| {
        try c.require(id >= 1 and id <= names.len); try c.charge(1 + name.len / 64);
        try c.require(std.mem.eql(u8, name, names[id - 1]));
        return .{ .bytes=widths[id - 1], .alignment=widths[id - 1] };
    }
    for (names, widths) |label, width| {
        try c.charge(1 + name.len / 64);
        if (std.mem.eql(u8, name, label)) return .{ .bytes=width, .alignment=width };
    }
    return error.InvalidShape;
}
fn append(c: *Context, p: *Shape, child: Shape, limit: u32) Error!u32 {
    const offset = try aligned(c, p.bytes, child.alignment, limit);
    try c.require(child.bytes <= limit - offset and child.roots <= 256 - p.roots);
    p.bytes = offset + child.bytes; p.alignment = @max(p.alignment, child.alignment); p.roots += child.roots;
    return offset;
}
fn tagged(c: *Context, p: *Shape, limit: u32) Error!void {
    const offset = try aligned(c, 2, p.alignment, 8);
    try c.require(p.bytes <= limit - offset); p.bytes += offset; p.alignment = @max(2, p.alignment);
    p.bytes = try aligned(c, p.bytes, p.alignment, limit);
}
fn carrierEqual(c: *Context, a: t.Carrier, b: t.Carrier) Error!void {
    try c.charge(2); try c.require(std.meta.eql(a, b));
}

// Declaration ordinals, rather than the semantic-ID directory order, determine
// a nominal body's physical fields. Placement also checks gaps and duplicates.
const Fields = struct {
    c: *Context, offsets: []usize, items: []u32,
    fn init(c: *Context, nt: usize, rows: anytype) Error!Fields {
        try c.charge(nt + 1 + rows.len);
        const offsets = try c.allocator.alloc(usize, nt + 1); errdefer c.allocator.free(offsets);
        @memset(offsets, 0);
        const items = try c.allocator.alloc(u32, rows.len); errdefer c.allocator.free(items);
        @memset(items, none);
        for (rows) |f| { try c.charge(2); offsets[@intFromEnum(f.owner) + 1] += 1; }
        for (0..nt) |i| { try c.step(); try c.require(offsets[i + 1] <= 256); offsets[i + 1] += offsets[i]; }
        for (rows, 0..) |f, i| {
            try c.charge(3); const owner = @intFromEnum(f.owner);
            try c.require(f.ordinal < offsets[owner + 1] - offsets[owner]);
            const at = offsets[owner] + f.ordinal; try c.require(items[at] == none); items[at] = @intCast(i);
        }
        return .{ .c=c, .offsets=offsets, .items=items };
    }
    fn deinit(self: *Fields) void { self.c.allocator.free(self.offsets); self.c.allocator.free(self.items); }
    fn own(self: *const Fields, id: usize) []const u32 { return self.items[self.offsets[id]..self.offsets[id + 1]]; }
};
fn lineage(c: *Context, types: anytype, first: usize, common: bool) Error!std.ArrayListUnmanaged(usize) {
    var out: std.ArrayListUnmanaged(usize) = .empty; errdefer out.deinit(c.allocator);
    var seen: std.AutoHashMapUnmanaged(usize, void) = .{}; defer seen.deinit(c.allocator);
    var current = first;
    while (true) {
        try c.charge(3); if ((try seen.getOrPut(c.allocator, current)).found_existing) return error.InvalidShape;
        const row = types[current]; try c.require(row.kind == types[first].kind and (row.kind == .reference or row.kind == .value));
        try out.append(c.allocator, current);
        if (row.base) |parent| { try c.require(!common or row.kind == .reference); current = @intFromEnum(parent); } else break;
    }
    return out;
}

const Common = struct {
    c: *Context, v: *const tables.CommonTables, cache: Cache, fields: Fields, concrete: []u32,
    fn init(c: *Context, v: *const tables.CommonTables) Error!Common {
        var cache = try Cache.init(c, v.types.len, v.domains.len); errdefer cache.deinit();
        var fields = try Fields.init(c, v.types.len, v.members.fields); errdefer fields.deinit();
        try c.charge(v.types.len); const concrete = try c.allocator.alloc(u32, v.types.len); errdefer c.allocator.free(concrete); @memset(concrete, none);
        for (v.storage.concrete, 0..) |row, i| {
            try c.charge(3); const id=@intFromEnum(row.@"type"); const kind=v.types[id].kind;
            try c.require(concrete[id] == none and ((kind==.reference or kind==.value)==(row.body!=null))); concrete[id]=@intCast(i);
        }
        for(v.members.fields) |field| { try c.charge(2); const kind=v.types[@intFromEnum(field.owner)].kind; try c.require(kind==.reference or kind==.value); }
        for (v.types, 0..) |row, i| { try c.charge(2); try c.require((row.kind == .@"union") == (concrete[i] == none)); }
        return .{ .c=c, .v=v, .cache=cache, .fields=fields, .concrete=concrete };
    }
    fn deinit(self: *Common) void { self.cache.deinit(); self.fields.deinit(); self.c.allocator.free(self.concrete); }
    fn carrier(self: *Common, value: t.Carrier, depth: usize) Error!Shape {
        try self.c.step();
        return switch (value) {
            .domain => |id| self.domain(@intFromEnum(id), depth + 1),
            .@"type" => |id| blk: {
                const kind=self.v.types[@intFromEnum(id)].kind;
                try self.c.require(kind != .@"union" and kind != .unknown and kind != .@"void");
                break :blk self.typeShape(@intFromEnum(id), depth + 1);
            },
            .environment, .cell => .{ .bytes=8, .alignment=8, .roots=1 },
            .payload => .{ .bytes=16, .alignment=8, .roots=1 },
        };
    }
    fn typeShape(self: *Common, id: usize, depth: usize) Error!Shape {
        const c=self.c; try c.step(); try c.require(depth <= 128);
        const entry=&self.cache.types[id]; if(entry.state == .done) return entry.shape;
        try c.require(entry.state == .empty); entry.state=.active;
        const row=self.v.types[id]; var p:Shape=.{};
        switch(row.kind) {
            .scalar => p=try scalar(c,row.name,row.native_code),
            .reference, .array, .string => p=.{ .bytes=8,.alignment=8,.roots=1 },
            .readSpan, .unknown => p=.{ .bytes=16,.alignment=8,.roots=1 },
            .function => p=.{ .bytes=40,.alignment=8,.roots=1 },
            .value => p=try self.body(id,depth+1),
            .@"null", .@"undefined", .@"void" => {},
            .@"union" => return error.InvalidShape,
        }
        const given=self.v.storage.concrete[self.concrete[id]].carrier;
        try equal(c,p,given.layout.byte_size,given.layout.alignment,given.layout.reference_count);
        if(row.kind != .value) try c.require(given.field_offsets.len == 0);
        entry.*=.{ .state=.done,.shape=p }; return p;
    }
    fn body(self: *Common, id: usize, depth: usize) Error!Shape {
        const c=self.c; const record=self.v.storage.concrete[self.concrete[id]];
        const given=record.body orelse return error.InvalidShape;
        var chain=try lineage(c,self.v.types,id,true); defer chain.deinit(c.allocator);
        var p:Shape=.{}; var ordinal:usize=0; var i=chain.items.len;
        while(i>0) { i-=1; for(self.fields.own(chain.items[i])) |f| {
            try c.charge(5); try c.require(ordinal < given.fields.len);
            const field=self.v.members.fields[f]; const binding=self.v.storage.bindings[@intFromEnum(field.binding)];
            const out=given.fields[ordinal]; try c.require(@intFromEnum(out.field)==f and out.binding==field.binding);
            try c.require(std.meta.activeTag(binding.owner)==.field and @intFromEnum(binding.owner.field)==f);
            try c.require(std.meta.activeTag(binding.carrier)!=.cell);
            const child=try self.carrier(binding.carrier,depth+1); const roots=p.roots; const offset=try append(c,&p,child,65536);
            try c.require(out.offset==offset and out.reference_offset==roots);
            if(self.v.types[id].kind==.value) { try c.require(ordinal<record.carrier.field_offsets.len); try c.require(record.carrier.field_offsets[ordinal]==offset); }
            ordinal+=1;
        }}
        try c.require(ordinal==given.fields.len);
        if(self.v.types[id].kind==.value) try c.require(ordinal==record.carrier.field_offsets.len);
        p.bytes=try aligned(c,p.bytes,p.alignment,65536); try equal(c,p,given.byte_size,given.alignment,given.reference_count); return p;
    }
    fn domain(self: *Common, id: usize, depth: usize) Error!Shape {
        const c=self.c; try c.step(); try c.require(depth<=128);
        const entry=&self.cache.domains[id]; if(entry.state==.done)return entry.shape;
        try c.require(entry.state==.empty); entry.state=.active;
        const row=self.v.domains[id]; var p:Shape=.{}; var references=row.actual_types.len!=0;
        for(row.actual_types) |ref| {
            try c.charge(2); const index=@intFromEnum(ref); const kind=self.v.types[index].kind;
            try c.require(kind!=.@"union" and kind!=.unknown and kind!=.@"void");
            const child=try self.typeShape(index,depth+1); p.bytes=@max(p.bytes,child.bytes); p.alignment=@max(p.alignment,child.alignment); p.roots=@max(p.roots,child.roots);
            references=references and (kind==.reference or kind==.array or kind==.string);
        }
        const tag:u8=if(row.actual_types.len>1 and !references)2 else 0;
        if(tag!=0)try tagged(c,&p,65536);
        const representation: @TypeOf(row.representation)=if(row.actual_types.len==0).bottom else if(references).reference else if(row.actual_types.len==1).absence else .@"finite-union";
        try c.require(row.tag_bytes==tag and row.representation==representation); try equal(c,p,row.byte_size,row.alignment,row.reference_count);
        entry.*=.{ .state=.done,.shape=p }; return p;
    }
    fn run(self: *Common) Error!void {
        const c=self.c; const v=self.v;
        for(v.types,0..) |row,i| { try c.step(); if(row.kind!=.@"union") { _=try self.typeShape(i,0); if(row.kind==.reference) _=try self.body(i,0); } }
        for(v.domains,0..) |_,i| { _=try self.domain(i,0); }
        for(v.storage.bindings) |binding| { try c.charge(2); try c.require(std.meta.activeTag(binding.carrier)!=.cell); _=try self.carrier(binding.carrier,0); }
        try self.arrays(); try self.environments(); try self.abis(); try self.cells();
        for(v.modules.globals,0..) |global,i| {
            try c.charge(3); const binding=v.storage.bindings[@intFromEnum(global.binding)];
            try c.require(binding.owner==.global and @intFromEnum(binding.owner.global)==i); try carrierEqual(c,global.carrier,binding.carrier);
        }
        try c.require(v.storage.payload.byte_size==16 and v.storage.payload.alignment==8 and v.storage.payload.reference_count==1);
    }
    fn arrays(self: *Common) Error!void {
        const c=self.c; const v=self.v; try c.charge(v.types.len);
        const elements=try c.allocator.alloc(u32,v.types.len); defer c.allocator.free(elements); @memset(elements,none);
        for(v.storage.bindings,0..) |binding,i| { try c.step(); if(binding.owner==.element) {
            const id=@intFromEnum(binding.owner.element); try c.require(v.types[id].kind==.array and v.types[id].element!=null and v.types[id].element.?==binding.@"type" and elements[id]==none); elements[id]=@intCast(i);
        }}
        try c.charge(v.types.len); const seen=try c.allocator.alloc(bool,v.types.len); defer c.allocator.free(seen); @memset(seen,false);
        for(v.storage.arrays) |row| {
            try c.charge(3); const id=@intFromEnum(row.@"type"); try c.require(v.types[id].kind==.array and !seen[id] and elements[id]!=none); seen[id]=true;
            try carrierEqual(c,row.element_carrier,v.storage.bindings[elements[id]].carrier);
        }
        for(v.types,0..) |row,i| { try c.require((row.kind==.array)==seen[i]); }
    }
    fn environments(self: *Common) Error!void {
        const c=self.c; const v=self.v; try c.require(v.storage.environments.len==v.closures.environments.len);
        try c.charge(v.storage.bindings.len); const captured=try c.allocator.alloc(bool,v.storage.bindings.len); defer c.allocator.free(captured); @memset(captured,false);
        for(v.closures.environments,0..) |env,i| {
            try c.charge(3); const given=v.storage.environments[i]; try c.require(@intFromEnum(given.environment)==i and given.slot_offsets.len==env.slots.len);
            var p:Shape=if(env.parent!=null).{.bytes=8,.alignment=8,.roots=1} else .{};
            try c.require(if(env.parent!=null)given.parent_offset!=null and given.parent_offset.?==0 else given.parent_offset==null);
            for(env.slots,0..) |slot,j| {
                try c.charge(6); const id=@intFromEnum(slot.binding); const binding=v.storage.bindings[id];
                try c.require(!captured[id]); captured[id]=true;
                const kind=std.meta.activeTag(binding.owner); try c.require(kind==.param or kind==.local);
                const owner=if(kind==.param)binding.owner.param else binding.owner.local;
                try c.require(owner==env.owner and binding.@"type"==slot.@"type" and binding.writable==slot.writable and binding.declaration_kind!=null);
                try c.require(if(slot.kind==.parameter)binding.declaration_kind.?==.parameter else binding.declaration_kind.?==.local);
                const child=try self.carrier(binding.carrier,0); const offset=try append(c,&p,child,65536); try c.require(given.slot_offsets[j]==offset);
            }
            p.bytes=try aligned(c,p.bytes,p.alignment,65536); try equal(c,p,given.byte_size,given.alignment,given.reference_count);
        }
        try c.charge(v.closures.environments.len);
        const done=try c.allocator.alloc(u2,v.closures.environments.len); defer c.allocator.free(done); @memset(done,0);
        var path:std.ArrayListUnmanaged(usize)=.empty; defer path.deinit(c.allocator);
        for(v.closures.environments,0..) |_,i| {
            try c.step(); if(done[i]==2)continue; var current:?usize=i; path.clearRetainingCapacity();
            while(current) |at| {
                try c.charge(2); if(done[at]==2)break; try c.require(done[at]==0); done[at]=1;
                try path.append(c.allocator,at); current=if(v.closures.environments[at].parent) |parent| @intFromEnum(parent) else null;
            }
            for(path.items) |at| { try c.step(); done[at]=2; }
        }
    }
    fn abis(self: *Common) Error!void {
        const c=self.c; const v=self.v;
        try c.charge(v.storage.bindings.len);
        const seen=try c.allocator.alloc(bool,v.storage.bindings.len); defer c.allocator.free(seen); @memset(seen,false);
        for(v.abis) |abi| {
            try c.charge(4); var at:usize=0;
            if(abi.lexical_environment) |env| { try c.require(at<abi.physical_parameters.len); try carrierEqual(c,abi.physical_parameters[at],.{.environment=env}); at+=1; }
            if(abi.receiver) |ref| {
                try c.charge(3); const id=@intFromEnum(ref); const binding=v.storage.bindings[id];
                try c.require(binding.owner==.receiver and binding.owner.receiver==abi.function and !seen[id]); seen[id]=true;
                try c.require(at<abi.physical_parameters.len); try carrierEqual(c,abi.physical_parameters[at],binding.carrier); at+=1;
            }
            for(abi.parameters) |ref| {
                try c.charge(3); const id=@intFromEnum(ref); const binding=v.storage.bindings[id];
                try c.require(binding.owner==.param and binding.owner.param==abi.function and !seen[id]); seen[id]=true;
                try c.require(at<abi.physical_parameters.len); try carrierEqual(c,abi.physical_parameters[at],binding.carrier); at+=1;
            }
            try c.require(at==abi.physical_parameters.len and (abi.result==null)==(abi.result_carrier==null));
            if(abi.result_carrier) |value| { _=try self.carrier(value,0); }
        }
        for(v.storage.bindings,0..) |binding,i| {
            try c.step(); const role=std.meta.activeTag(binding.owner); if(role==.param or role==.receiver)try c.require(seen[i]);
        }
    }
    fn cells(self:*Common) Error!void {
        const c=self.c; const v=self.v; var count:usize=0;
        for(v.storage.bindings) |binding| {
            try c.step(); const role=std.meta.activeTag(binding.owner); if(role==.param or role==.local or role==.receiver)count+=1;
        }
        try c.require(count==v.exceptions.bindings.len);
        for(v.exceptions.bindings) |cell| {
            try c.charge(4); const binding=v.storage.bindings[@intFromEnum(cell.binding)]; const role=std.meta.activeTag(binding.owner);
            try c.require(role==.param or role==.local or role==.receiver);
            const owner=switch(binding.owner){.param,.local,.receiver=>|id|id,else=>unreachable};
            try c.require(binding.scope!=null and binding.scope.?==cell.scope and v.exceptions.scopes[@intFromEnum(cell.scope)].owner==owner);
        }
    }
};

// The legacy finite model has a separate reference plane and a 2-byte defined
// state before each field/closure slot. These are not Common object layouts.
const Legacy = struct {
    c: *Context, v: *const tables.LegacyTables, cache: Cache, fields: Fields, concrete: []u32,
    fn init(c:*Context,v:*const tables.LegacyTables) Error!Legacy {
        var cache=try Cache.init(c,v.types.len,v.domains.len); errdefer cache.deinit();
        var fields=try Fields.init(c,v.types.len,v.members.fields); errdefer fields.deinit();
        try c.charge(v.types.len); const concrete=try c.allocator.alloc(u32,v.types.len); errdefer c.allocator.free(concrete); @memset(concrete,none);
        for(v.storage.concrete,0..) |row,i| {
            try c.charge(3); const id=@intFromEnum(row.@"type"); const kind=v.types[id].kind;
            try c.require(concrete[id]==none and (kind==.reference or kind==.value)); concrete[id]=@intCast(i);
        }
        return .{.c=c,.v=v,.cache=cache,.fields=fields,.concrete=concrete};
    }
    fn deinit(self:*Legacy) void { self.cache.deinit(); self.fields.deinit(); self.c.allocator.free(self.concrete); }
    fn typeShape(self:*Legacy,id:usize,depth:usize) Error!Shape {
        const c=self.c; try c.step(); try c.require(depth<=32); const entry=&self.cache.types[id];
        if(entry.state==.done)return entry.shape; try c.require(entry.state==.empty); entry.state=.active;
        const row=self.v.types[id]; var p:Shape=.{};
        switch(row.kind) {
            .scalar => p=try scalar(c,row.name,row.native_code),
            .reference,.array,.string => p.roots=1,
            .readSpan => p=.{.bytes=8,.alignment=4,.roots=1},
            .function => p=.{.bytes=32,.alignment=8,.roots=1},
            .value => p=try self.body(id,depth+1),
            .@"null",.@"undefined" => {},
            else => return error.InvalidShape,
        }
        entry.*=.{.state=.done,.shape=p}; return p;
    }
    fn domain(self:*Legacy,id:usize,depth:usize) Error!Shape {
        const c=self.c; try c.step(); try c.require(depth<=32); const entry=&self.cache.domains[id];
        if(entry.state==.done)return entry.shape; try c.require(entry.state==.empty); entry.state=.active;
        const row=self.v.domains[id]; var p:Shape=.{}; var references=row.alternatives.len!=0; var native:u8=0;
        for(row.alternatives) |ref| {
            try c.charge(3); const i=@intFromEnum(ref); const child=try self.typeShape(i,depth+1);
            p.bytes=@max(p.bytes,child.bytes); p.alignment=@max(p.alignment,child.alignment); p.roots=@max(p.roots,child.roots);
            references=references and self.v.types[i].kind==.reference; native=self.v.types[i].native_code;
        }
        const count=row.alternatives.len; const tag:u8=if(count>1 and !references)2 else 0;
        if(tag!=0)try tagged(c,&p,65544); try c.require(p.bytes<=65544 and p.roots<=256 and row.tag_bytes==tag);
        try equal(c,p,row.byte_size,row.alignment,row.reference_count);
        if(count==0)try c.require(row.representation==.bottom and row.native_code==0) else
        if(count==1 and native!=0 and native!=14)try c.require(row.representation==.native and row.native_code==native) else
        if(references)try c.require(row.representation==.reference and row.native_code==0) else
        if(count>1)try c.require(row.representation==.@"finite-union" and row.native_code==0) else
            try c.require((row.representation==.absence or row.representation==.@"inline") and row.native_code==0);
        entry.*=.{.state=.done,.shape=p}; return p;
    }
    fn body(self:*Legacy,id:usize,depth:usize) Error!Shape {
        const c=self.c; try c.require(self.concrete[id]!=none); const given=self.v.storage.concrete[self.concrete[id]];
        var chain=try lineage(c,self.v.types,id,false); defer chain.deinit(c.allocator);
        var p:Shape=.{}; var ordinal:usize=0; var i=chain.items.len;
        while(i>0) { i-=1; for(self.fields.own(chain.items[i])) |field| {
            try c.charge(4); try c.require(ordinal<given.fields.len); const row=given.fields[ordinal];
            try c.require(@intFromEnum(row.field)==field); const child=try self.domain(@intFromEnum(row.domain),depth+1);
            const state=try aligned(c,p.bytes,2,65536); try c.require(state<=65534);
            const offset=try aligned(c,state+2,child.alignment,65536);
            try c.require(child.bytes<=65536-offset and child.roots<=256-p.roots and row.state_offset==state and row.offset==offset and row.reference_offset==p.roots);
            p.bytes=offset+child.bytes; p.alignment=@max(@max(p.alignment,2),child.alignment); p.roots+=child.roots; ordinal+=1;
        }}
        try c.require(ordinal==given.fields.len); p.bytes=try aligned(c,p.bytes,p.alignment,65536);
        try equal(c,p,given.byte_size,given.alignment,given.reference_count); return p;
    }
    fn run(self:*Legacy) Error!void {
        const c=self.c; const v=self.v;
        // Native-only programs genuinely have no finite storage directory. Their
        // scalar domain records still have independently recomputable layouts.
        for(v.domains,0..) |_,i| { _=try self.domain(i,0); }
        for(v.storage.concrete) |row| { try c.step(); _=try self.body(@intFromEnum(row.@"type"),0); }
        if(v.storage.concrete.len!=0 or v.storage.arrays.len!=0 or v.storage.domains.len!=0) {
            try c.require(v.storage.domains.len==v.domains.len);
            for(v.storage.domains,0..) |row,i| { try c.require(@intFromEnum(row.domain)==i); }
        }
        for(v.storage.arrays) |row| { try c.charge(2); try c.require(v.types[@intFromEnum(row.@"type")].kind==.array); _=try self.domain(@intFromEnum(row.domain),0); }
        for(v.closures.environments) |env| {
            try c.charge(4); var p:Shape=.{}; if(env.parent!=null)p.roots=1;
            for(env.slots) |slot| {
                try c.charge(6); const row=v.types[@intFromEnum(slot.@"type")];
                const child:Shape=switch(row.kind) {
                    .function => .{.bytes=32,.alignment=8,.roots=1},
                    else => value: { try c.require(row.kind==.scalar); break :value try scalar(c,row.name,row.native_code); },
                };
                const state=try aligned(c,p.bytes,2,65536); try c.require(state<=65534);
                const offset=try aligned(c,state+2,child.alignment,65536);
                try c.require(child.bytes<=65536-offset and child.roots<=256-p.roots and slot.state_offset==state and slot.offset==offset and slot.reference_offset==p.roots);
                p.bytes=offset+child.bytes; p.alignment=@max(@max(p.alignment,2),child.alignment); p.roots+=child.roots;
            }
            p.bytes=try aligned(c,p.bytes,p.alignment,65536); try equal(c,p,env.byte_size,env.alignment,env.reference_count);
        }
    }
};

// EH records explicit unconditional root byte offsets. Domain roots are instead
// conditional on the actual tag and must never become fabricated offsets.
const Explicit = struct {
    bytes:u32=0, alignment:u16=1,
    roots:std.ArrayListUnmanaged(u32)=.empty, offsets:std.ArrayListUnmanaged(u32)=.empty,
    fn deinit(self:*Explicit,c:*Context) void { self.roots.deinit(c.allocator); self.offsets.deinit(c.allocator); }
    fn shape(self:*const Explicit) Shape { return .{.bytes=self.bytes,.alignment=self.alignment,.roots=@intCast(self.roots.items.len)}; }
    fn appendSlot(self:*Explicit,c:*Context,p:Shape,roots:[]const u32) Error!u32 {
        try c.charge(roots.len+2); const at=try aligned(c,self.bytes,p.alignment,65536);
        try c.require(p.bytes<=65536-at and roots.len<=256-self.roots.items.len);
        try self.offsets.append(c.allocator,at);
        for(roots) |root| { try self.roots.append(c.allocator,at+root); }
        self.bytes=at+p.bytes; self.alignment=@max(self.alignment,p.alignment); return at;
    }
    fn compare(self:*const Explicit,c:*Context,given:storage.ExceptionLayout) Error!void {
        try equal(c,self.shape(),given.bytes,given.alignment,@intCast(given.roots.len));
        try c.require(given.offsets.len==self.offsets.items.len);
        for(given.roots,self.roots.items) |a,b| { try c.require(a==b); }
        for(given.offsets,self.offsets.items) |a,b| { try c.require(a==b); }
    }
};
const Selected = struct { shape:Shape, roots:[]const u32 };
const Exception = struct {
    c:*Context, v:*const tables.ExceptionTables, types:[]Explicit, done:[]bool, domains:[]Shape,
    fn init(c:*Context,v:*const tables.ExceptionTables) Error!Exception {
        try c.charge(2*v.types.len+v.domains.len);
        const types=try c.allocator.alloc(Explicit,v.types.len); errdefer c.allocator.free(types); @memset(types,.{});
        const done=try c.allocator.alloc(bool,v.types.len); errdefer c.allocator.free(done); @memset(done,false);
        const domains=try c.allocator.alloc(Shape,v.domains.len);
        return .{.c=c,.v=v,.types=types,.done=done,.domains=domains};
    }
    fn deinit(self:*Exception) void {
        for(self.types) |*p| p.deinit(self.c);
        self.c.allocator.free(self.types); self.c.allocator.free(self.done); self.c.allocator.free(self.domains);
    }
    fn typeShapes(self:*Exception) Error!void {
        const c=self.c; var left=self.types.len;
        for(self.v.types,0..) |row,i| {
            try c.charge(2); try c.require(row.fields.len==row.field_indexes.len);
            for(row.fields,row.field_indexes,0..) |field,ref,ordinal| {
                try c.charge(4); const member=self.v.members.fields[@intFromEnum(ref)];
                try c.require(@intFromEnum(member.owner)==i and member.ordinal==ordinal and member.@"type"==field.@"type");
            }
        }
        for(self.v.members.fields,0..) |field,i| {
            try c.charge(3); const owner=self.v.types[@intFromEnum(field.owner)];
            try c.require(owner.kind==.aggregate and field.ordinal<owner.field_indexes.len);
            try c.require(@intFromEnum(owner.field_indexes[field.ordinal])==i);
        }
        // This is the existing EH finite dependency algorithm. It has no new
        // depth cutoff: no progress rejects an inline cycle; work never refills.
        while(left!=0) {
            var progress=false;
            for(self.v.types,0..) |row,i| {
                try c.step(); if(self.done[i])continue;
                var p:Explicit=.{}; errdefer p.deinit(c);
                switch(row.kind) {
                    .scalar => { const s=try scalar(c,row.name,null); p.bytes=s.bytes; p.alignment=s.alignment; },
                    .unknown => { p.bytes=16; p.alignment=8; try c.step(); try p.roots.append(c.allocator,8); },
                    .callable => { p.bytes=40; p.alignment=8; try c.step(); try p.roots.append(c.allocator,32); },
                    .nullable => { p.bytes=8; p.alignment=4; },
                    .@"undefined",.@"null" => {},
                    .aggregate => {
                        var ready=true;
                        for(row.fields) |field| { try c.step(); if(!self.done[@intFromEnum(field.@"type")]) { ready=false; break; } }
                        if(!ready)continue;
                        var body:Explicit=.{}; defer body.deinit(c);
                        for(row.fields) |field| {
                            try c.step(); const child=&self.types[@intFromEnum(field.@"type")]; _=try body.appendSlot(c,child.shape(),child.roots.items);
                        }
                        body.bytes=try aligned(c,body.bytes,body.alignment,65536);
                        if(row.category==.component) {
                            p.bytes=8; p.alignment=8; p.offsets=body.offsets; body.offsets=.empty;
                            try c.step(); try p.roots.append(c.allocator,0);
                        } else {
                            try c.require(row.category==.value); p=body; body=.{};
                        }
                    },
                }
                try p.compare(c,row.layout); self.types[i]=p; p=.{};
                self.done[i]=true; left-=1; progress=true;
            }
            try c.require(progress);
        }
    }
    fn domainShapes(self:*Exception) Error!void {
        const c=self.c;
        for(self.v.domains,0..) |row,i| {
            try c.charge(4); var p:Shape=.{}; var references=row.actual_types.len!=0;
            for(row.actual_types) |ref| {
                try c.charge(3); const index=@intFromEnum(ref); const kind=self.v.types[index].kind;
                try c.require(kind!=.unknown and kind!=.nullable); const child=self.types[index].shape();
                p.bytes=@max(p.bytes,child.bytes); p.alignment=@max(p.alignment,child.alignment); p.roots=@max(p.roots,child.roots);
                references=references and kind==.aggregate and self.v.types[index].category==.component;
            }
            const count=row.actual_types.len; const tag:u8=if(count>1 and !references)2 else 0;
            if(tag!=0)try tagged(c,&p,65544);
            const representation: @TypeOf(row.representation)=if(count==0).bottom else if(references).reference else if(count==1).absence else .@"finite-union";
            try c.require(row.representation==representation and row.tag_bytes==tag); try equal(c,p,row.byte_size,row.alignment,row.reference_count);
            self.domains[i]=p;
        }
    }
    fn carrier(self:*Exception,value:storage.ExceptionCarrier) Error!Selected {
        try self.c.step();
        return switch(value) {
            .domain => |id| .{.shape=self.domains[@intFromEnum(id)],.roots=&.{}},
            .@"type" => |id| blk: {
                const index=@intFromEnum(id); const kind=self.v.types[index].kind; try self.c.require(kind!=.unknown and kind!=.nullable);
                break :blk .{.shape=self.types[index].shape(),.roots=self.types[index].roots.items};
            },
            .payload => .{.shape=.{.bytes=16,.alignment=8,.roots=1},.roots=&.{8}},
        };
    }
    fn frame(self:*Exception,index:usize) Error!void {
        const c=self.c; const fnrow=self.v.exceptions.functions[index]; const abi=self.v.abis[index]; const given=self.v.storage.frames[index];
        try c.charge(8); try c.require(abi.carriers.len==fnrow.parameters.len and abi.parameters.len==fnrow.parameters.len and abi.captures.len==fnrow.captures.len);
        try c.require(given.slots.len==fnrow.parameters.len+fnrow.captures.len and given.physical_parameters==1 and given.physical_bytes==8);
        var p:Explicit=.{}; defer p.deinit(c); var potential:usize=0;
        for(fnrow.parameters,0..) |binding,i| {
            try c.charge(6); try c.require(abi.parameters[i]==binding); const row=given.slots[i]; const b=self.v.exceptions.bindings[@intFromEnum(binding)];
            try c.require(row.binding==binding and row.kind==.value and row.@"type"==b.@"type" and row.carrier!=null);
            try c.require(std.meta.eql(row.carrier.?,abi.carriers[i])); const value=try self.carrier(abi.carriers[i]);
            try c.require(value.shape.roots<=256-potential); potential+=value.shape.roots;
            const at=try p.appendSlot(c,value.shape,value.roots); try c.require(row.offset==at);
        }
        for(fnrow.captures,0..) |binding,i| {
            try c.charge(6); try c.require(abi.captures[i]==binding); const row=given.slots[fnrow.parameters.len+i]; const b=self.v.exceptions.bindings[@intFromEnum(binding)];
            try c.require(row.binding==binding and row.kind==.cell and row.@"type"==b.@"type" and row.carrier==null and potential<256); potential+=1;
            const at=try p.appendSlot(c,.{.bytes=16,.alignment=8,.roots=1},&.{0}); try c.require(row.offset==at);
        }
        p.bytes=try aligned(c,p.bytes,p.alignment,65536); try p.compare(c,given.layout);
    }
    fn run(self:*Exception) Error!void {
        try self.typeShapes(); try self.domainShapes();
        for(self.v.exceptions.bindings) |binding| { try self.c.step(); _=try self.carrier(binding.carrier); }
        for(self.v.abis,0..) |abi,i| {
            try self.c.step();
            try self.c.require((abi.result_carrier==null)==(self.c.program.functions[i].role==.module_initializer));
            if(abi.result_carrier) |result| { _=try self.carrier(result); }
            try self.frame(i);
        }
    }
};

// The caller first checks references using this same Context, then lends the
// remaining budget here. No new Context, success marker or owned handle escapes.
pub fn check(c:*Context) Error!void {
    switch(c.program.tables.mode) {
        .common => |v| { var engine=try Common.init(c,&v); defer engine.deinit(); try engine.run(); },
        .legacy => |v| { var engine=try Legacy.init(c,&v); defer engine.deinit(); try engine.run(); },
        .exception => |v| { var engine=try Exception.init(c,&v); defer engine.deinit(); try engine.run(); },
    }
}
