// SPDX-License-Identifier: MIT
// Identities of an already reference/layout-checked owned wire17 Program.
// This is not a decoder, validity handle, Source re-admission or execution API.
// Source contents/AST and original package payload are absent: their hashes,
// syntax, actual call targets, effects and borrow proofs are NOT reconstructed.
const std = @import("std");
const model = @import("wire-program-model.zig");
const tables = @import("wire-program-tables.zig");
const storage = @import("wire-program-storage.zig");
const publication = @import("wire-program-publication.zig");
const context = @import("wire-program-refcheck-context.zig");
const t = model.types;
const Context = context.Context;
pub const Error = context.Error;
const Raw = struct { bytes: []const u8 };
const Hex = struct { value: t.Hash };
const none = std.math.maxInt(usize);

// The keys here come from typed records, never unknown JSON. The sole encoding
// seam uses the existing canonical UTF8 escapes and lexicographic JSON keys.
fn camel(comptime input: []const u8) []const u8 {
    return comptime blk: {
        var result: []const u8 = "";
        var upper = false;
        for (input) |ch| {
            if (ch == '_') { upper = true; continue; }
            result = result ++ [1]u8{if (upper) std.ascii.toUpper(ch) else ch};
            upper = false;
        }
        break :blk result;
    };
}
fn order(comptime T: type) [@typeInfo(T).@"struct".fields.len]usize {
    // This quota covers only the finite typed record's compile-time key sort;
    // it does not change Context charging or any Program/input limit.
    @setEvalBranchQuota(10000);
    const fields = @typeInfo(T).@"struct".fields;
    const names = comptime blk: {
        var keys: [fields.len][]const u8 = undefined;
        for (fields, 0..) |field, i| keys[i] = camel(field.name);
        break :blk keys;
    };
    var result: [fields.len]usize = undefined;
    for (0..fields.len) |i| {
        var position = i;
        while (position > 0 and std.mem.order(u8, names[result[position - 1]], names[i]) == .gt) : (position -= 1)
            result[position] = result[position - 1];
        result[position] = i;
    }
    return result;
}
const Json = struct {
    c: *Context,
    bytes: std.ArrayListUnmanaged(u8) = .empty,
    fn deinit(self: *Json) void { self.bytes.deinit(self.c.allocator); }
    fn raw(self: *Json, bytes: []const u8) Error!void {
        try self.c.charge(1 + bytes.len / 64);
        if (bytes.len > model.format.max_bytes - self.bytes.items.len) return error.InvalidShape;
        try self.bytes.appendSlice(self.c.allocator, bytes);
    }
    fn string(self: *Json, text: []const u8) Error!void {
        try self.c.charge(1 + text.len / 64);
        try self.raw("\"");
        var start: usize = 0;
        for (text, 0..) |ch, i| {
            const escape: ?[]const u8 = switch (ch) {
                '"' => "\\\"", '\\' => "\\\\", 8 => "\\b", 12 => "\\f", 10 => "\\n", 13 => "\\r", 9 => "\\t", else => null,
            };
            if (escape != null or ch < 32) {
                try self.raw(text[start..i]);
                if (escape) |e| try self.raw(e) else {
                    const digits = "0123456789abcdef";
                    const escape_bytes = [6]u8{ '\\', 'u', '0', '0', digits[ch >> 4], digits[ch & 15] };
                    try self.raw(&escape_bytes);
                }
                start = i + 1;
            }
        }
        try self.raw(text[start..]); try self.raw("\"");
    }
    fn value(self: *Json, input: anytype) Error!void {
        const T = @TypeOf(input);
        if (T == Raw) return self.raw(input.bytes);
        if (T == Hex) { const hex = std.fmt.bytesToHex(input.value, .lower); return self.string(&hex); }
        if (T == t.Hash) {
            var text: [71]u8 = undefined; @memcpy(text[0..7], "sha256:");
            const hex = std.fmt.bytesToHex(input, .lower); @memcpy(text[7..], &hex); return self.string(&text);
        }
        if (T == publication.ScopeShape) return switch (input) {
            .primitive => |v| self.value(v), .function => |v| self.value(v),
            .union_type => |v| self.value(v), .element => |v| self.value(v),
            .nominal => |v| self.nominalShape(v),
        };
        switch (@typeInfo(T)) {
            .bool => try self.raw(if (input) "true" else "false"),
            .int, .comptime_int => { var buffer: [32]u8 = undefined; try self.raw(std.fmt.bufPrint(&buffer, "{d}", .{input}) catch unreachable); },
            .null, .void => try self.raw("null"),
            .@"enum" => |info| if(info.is_exhaustive) try self.string(@tagName(input)) else try self.value(@intFromEnum(input)),
            .optional => if (input) |v| try self.value(v) else try self.raw("null"),
            .pointer => |p| {
                if (p.size == .one) {
                    if (@typeInfo(p.child) == .array and @typeInfo(p.child).array.child == u8) return self.string(input);
                    return self.value(input.*);
                }
                if (p.size != .slice) @compileError("canonical owned values require slices or single pointers");
                if (p.child == u8) return self.string(input);
                try self.raw("["); for (input, 0..) |v, i| { try self.c.step(); if (i != 0) try self.raw(","); try self.value(v); } try self.raw("]");
            },
            .array => {
                try self.raw("["); for (input, 0..) |v, i| { try self.c.step(); if (i != 0) try self.raw(","); try self.value(v); } try self.raw("]");
            },
            .@"struct" => |info| {
                try self.raw("{");
                inline for (comptime order(T), 0..) |index, i| {
                    if (i != 0) try self.raw(",");
                    const field = info.fields[index]; try self.string(camel(field.name)); try self.raw(":"); try self.value(@field(input, field.name));
                }
                try self.raw("}");
            },
            else => @compileError("unsupported owned canonical value"),
        }
    }
    fn nominalShape(self: *Json, v: anytype) Error!void {
        // Optional semantic-shape properties are absent, unlike nullable refs.
        try self.raw("{");
        if (v.base) |base| { try self.raw("\"base\":"); try self.value(base); try self.raw(","); }
        try self.raw("\"construction\":"); try self.value(v.construction);
        try self.raw(",\"fields\":"); try self.value(v.fields);
        try self.raw(",\"kind\":"); try self.value(v.kind);
        try self.raw(",\"label\":"); try self.value(v.label);
        if (v.methods) |methods| { try self.raw(",\"methods\":"); try self.value(methods); }
        try self.raw("}");
    }
};
fn encoded(c: *Context, value: anytype) Error![]u8 {
    var out = Json{ .c = c }; errdefer out.deinit(); try out.value(value); return out.bytes.toOwnedSlice(c.allocator);
}
fn parts(c: *Context, values: []const []const u8) Error!t.Hash {
    var state = std.crypto.hash.sha2.Sha256.init(.{});
    for (values) |bytes| { try c.charge(1 + bytes.len / 64); state.update(bytes); }
    var out: t.Hash = undefined; state.final(&out); return out;
}
fn digest(c: *Context, domain: []const u8, value: anytype) Error!t.Hash {
    const text = try encoded(c, value); defer c.allocator.free(text); return parts(c, &.{ domain, "\x00", text });
}
fn ehDigest(c: *Context, comptime kind: []const u8, value: anytype) Error!t.Hash {
    const text = try encoded(c, value); defer c.allocator.free(text);
    return parts(c, &.{ "tsfg.exception-hir-candidate." ++ kind ++ ".v1\x00", "sha256:3c3da55c9d0af5236e50daba0788f5468b8a90b88de5545f83e79cafbc2a954e\x00", text });
}
fn equal(c: *Context, a: t.Hash, b: t.Hash) Error!void { try c.require(std.mem.eql(u8, &a, &b)); }
fn textEqual(c: *Context, a: []const u8, b: []const u8) Error!void { try c.charge(1 + @min(a.len, b.len) / 64); try c.require(std.mem.eql(u8, a, b)); }
fn idText(id: t.Hash) [71]u8 { var out: [71]u8 = undefined; @memcpy(out[0..7], "sha256:"); const hex = std.fmt.bytesToHex(id, .lower); @memcpy(out[7..], &hex); return out; }
fn source(c: *const Context, ref: t.SourceRef) tables.Source { return c.program.tables.sources[@intFromEnum(ref)]; }
fn sameValue(c: *Context, a: anytype, b: anytype) Error!void {
    const left = try encoded(c, a); defer c.allocator.free(left);
    const right = try encoded(c, b); defer c.allocator.free(right); try textEqual(c, left, right);
}
fn domainIds(c: *Context, types: anytype, refs: []const t.TypeRef) Error![]t.Hash {
    try c.charge(refs.len); const out = try c.allocator.alloc(t.Hash, refs.len);
    for (refs, 0..) |ref, i| out[i] = types[@intFromEnum(ref)].id; return out;
}
fn primitive(c: *Context, name: []const u8) Error!t.Hash { return parts(c, &.{ "tsfg.type\x00", name }); }
fn moduleIdentity(c: *Context, ref: t.SourceRef) Error!t.Hash { return parts(c, &.{ "tsfg.module\x00", source(c, ref).path }); }
fn runtimeClass(c:*Context,key:anytype) Error!t.Hash {
    const sources=c.program.tables.sources;
    const precharge=std.meta.activeTag(c.program.tables.mode)==.common;
    if(precharge)try c.charge(sources.len);
    const files=try c.allocator.alloc(struct{path:[]const u8,sha256:Hex},sources.len); defer c.allocator.free(files);
    for(sources,0..) |s,i| { if(!precharge)try c.step(); files[i]=.{.path=s.path,.sha256=.{.value=s.hash}}; }
    return digest(c,"tsfg.array-facts.runtime-class.v8",.{.files=files,.nominal_key=.{.source_path=source(c,key.source).path,.declaration_path=key.declaration_path,.category=key.category}});
}
fn actualDomains(c: *Context, types: anytype, domains: anytype, comptime legacy: bool) Error!void {
    for (domains) |row| {
        try c.step(); const ids = try domainIds(c, types, if (legacy) row.alternatives else row.actual_types); defer c.allocator.free(ids);
        try equal(c, row.id, try digest(c, "tsfg.actual-domain.v1", ids));
    }
}

const Legacy = struct {
    c: *Context, v: *const tables.LegacyTables,
    descriptions: []?[]u8, states: []u2,
    fn init(c: *Context, v: *const tables.LegacyTables) Error!Legacy {
        try c.charge(v.types.len * 2);
        const desc = try c.allocator.alloc(?[]u8, v.types.len); errdefer c.allocator.free(desc); @memset(desc, null);
        const states = try c.allocator.alloc(u2, v.types.len); @memset(states, 0);
        return .{ .c=c, .v=v, .descriptions=desc, .states=states };
    }
    fn deinit(self: *Legacy) void {
        for (self.descriptions) |bytes| if (bytes) |v| self.c.allocator.free(v);
        self.c.allocator.free(self.descriptions); self.c.allocator.free(self.states);
    }
    fn description(self: *Legacy, index: usize, depth: usize) Error![]const u8 {
        const c=self.c; try c.step(); try c.require(depth<=64);
        if(self.descriptions[index]) |v| return v;
        try c.require(self.states[index]==0); self.states[index]=1;
        const row=self.v.types[index]; var out=Json{.c=c}; errdefer out.deinit();
        if(row.kind==.scalar) try out.value(row.name) else {
            try c.require(row.kind==.function);
            try out.raw("{\"parameters\":[");
            for(row.members,0..) |ref,i| { try c.step(); if(i!=0)try out.raw(","); try out.raw(try self.description(@intFromEnum(ref),depth+1)); }
            try out.raw("],\"returns\":"); try out.raw(try self.description(@intFromEnum(row.element.?),depth+1)); try out.raw("}");
        }
        self.descriptions[index]=try out.bytes.toOwnedSlice(c.allocator); self.states[index]=2; return self.descriptions[index].?;
    }
    fn run(self: *Legacy) Error!void {
        const c=self.c; const v=self.v;
        for(v.types,0..) |row,i| {
            try c.step(); var name=Json{.c=c}; defer name.deinit();
            switch(row.kind) {
                .function => {
                    // Finite callable rows omit their original Source signature
                    // origin. Only the closure directory carries the distinct
                    // structural closure-callable identity preimage.
                    if(v.closures.functions.len==0) {
                        const display=try std.fmt.allocPrint(c.allocator,"function<{s}>",.{idText(row.id)}); defer c.allocator.free(display);
                        try textEqual(c,row.name,display); continue;
                    }
                    const text=try self.description(i,0);
                    try equal(c,row.id,try parts(c,&.{"tsfg.closure-callable.candidate.v1\x00",text}));
                    const display=try std.fmt.allocPrint(c.allocator,"function<{s}>",.{idText(row.id)}); defer c.allocator.free(display); try textEqual(c,row.name,display); continue;
                },
                .reference,.value => {
                    const key=row.nominal_key.?;
                    const runtime=try runtimeClass(c,key);
                    try equal(c,row.runtime_key.?,runtime);
                    try name.raw(if(row.kind==.reference)"ref<" else "value<"); try name.raw(&idText(runtime)); try name.raw(">");
                },
                .array,.readSpan => { try name.raw(if(row.kind==.array)"Array<" else "ReadSpan<"); try name.raw(v.types[@intFromEnum(row.element.?)].name); try name.raw(">"); },
                .@"union" => {
                    try c.charge(row.members.len); const names=try c.allocator.alloc([]const u8,row.members.len); defer c.allocator.free(names);
                    for(row.members,0..) |ref,n| names[n]=v.types[@intFromEnum(ref)].name;
                    try chargeSort(c,names); std.mem.sort([]const u8,names,{},lessBytes);
                    try name.raw("Union<"); var previous:?[]const u8=null;
                    for(names) |part| { try c.step(); if(previous) |p| { if(std.mem.eql(u8,p,part))continue; try name.raw(","); } try name.raw(part); previous=part; }
                    try name.raw(">");
                },
                else => try name.raw(if(row.kind==.scalar) row.name else @tagName(row.kind)),
            }
            try textEqual(c,row.name,name.bytes.items); try equal(c,row.id,try primitive(c,name.bytes.items));
        }
        try actualDomains(c,v.types,v.domains,true);
        for(v.members.fields) |f| { try c.step(); try equal(c,f.id,try parts(c,&.{"tsfg.field\x00",&idText(v.types[@intFromEnum(f.owner)].id),"\x00",f.name})); }
        for(v.members.methods) |m| { try c.step(); const fnrow=c.program.functions[@intFromEnum(m.function)]; try equal(c,m.id,fnrow.id); try equal(c,m.signature,fnrow.signature); }
        for(v.members.constructions) |ctor| { try c.step(); try equal(c,ctor.id,try parts(c,&.{"tsfg.construction\x00",&idText(v.types[@intFromEnum(ctor.owner)].id)})); }
        for(v.abis) |abi| try self.checkAbi(abi);
        for(c.program.functions,0..) |fnrow,i| try self.function(fnrow,i);
        for(v.modules.modules) |m| { try c.step(); try equal(c,m.id,try moduleIdentity(c,m.source)); }
        for(v.modules.globals) |g| {
            try c.step(); const path=source(c,g.source).path; const type_name=v.types[@intFromEnum(g.view)].name;
            var expected:t.Hash=undefined;
            if(g.generated) {
                var a:[20]u8=undefined; var b:[20]u8=undefined;
                expected=try parts(c,&.{"tsfg.default-export-binding.v1\x00",path,"\x00",&idText(source(c,g.source).hash),"\x00",&idText(try moduleIdentity(c,g.source)),"\x00",type_name,"\x00",std.fmt.bufPrint(&a,"{d}",.{g.start}) catch unreachable,"\x00",std.fmt.bufPrint(&b,"{d}",.{g.end}) catch unreachable});
            } else expected=try parts(c,&.{"tsfg.global\x00",path,"\x00",g.name,"\x00",type_name});
            try equal(c,g.id,expected);
        }
        const host_signature=try parts(c,&.{"tsfg.signature\x00(i32)->i32"});
        for(v.modules.hosts) |h| { try c.step(); try equal(c,h.signature,host_signature); try equal(c,h.id,try parts(c,&.{"tsfg.host\x00",source(c,h.source).path,"\x00",h.name,"\x00",&idText(host_signature)})); }
        for(v.storage.concrete) |row| {
            try c.step(); const bytes=try encoded(c,.{.@"type"=@intFromEnum(row.@"type"),.byte_size=row.byte_size,.alignment=row.alignment,.reference_count=row.reference_count,.fields=row.fields}); defer c.allocator.free(bytes);
            const input=std.fmt.bytesToHex(c.program.input_identity,.lower); try equal(c,row.id,try parts(c,&.{"tsfg.storage-layout.v1\x00",&input,"\x00",bytes}));
        }
        for(v.storage.domains) |row| {
            try c.step(); const d=v.domains[@intFromEnum(row.domain)];
            const bytes=try encoded(c,.{.id=d.id,.alternatives=d.alternatives,.representation=d.representation,.native_code=d.native_code,.byte_size=d.byte_size,.alignment=d.alignment,.reference_count=d.reference_count,.tag_bytes=d.tag_bytes}); defer c.allocator.free(bytes);
            const input=std.fmt.bytesToHex(c.program.input_identity,.lower); try equal(c,row.id,try parts(c,&.{"tsfg.domain-storage.v1\x00",&input,"\x00",bytes}));
        }
        try self.closures();
        for(v.authority.published) |row| {
            try c.step(); const abi=v.abis[@intFromEnum(row.abi)]; const fnrow=c.program.functions[@intFromEnum(row.function)];
            try equal(c,row.source_signature,abi.source_signature); try equal(c,row.closure_identity,c.program.input_identity);
            try c.charge(row.parameter_bounds.len); const ids=try c.allocator.alloc(t.Hash,row.parameter_bounds.len); defer c.allocator.free(ids);
            for(row.parameter_bounds,0..) |ref,i| ids[i]=v.domains[@intFromEnum(ref)].id;
            const result:?t.Hash=if(row.result_bound) |ref| v.domains[@intFromEnum(ref)].id else null;
            try equal(c,row.id,try digest(c,"tsfg.published-call.v1",.{.function_id=fnrow.id,.source_signature=abi.source_signature,.closure_identity=c.program.input_identity,.parameter_bounds=ids,.result_bound=result,.abi=abi.id}));
        }
    }
    fn checkAbi(self:*Legacy,a:storage.LegacyAbi) Error!void {
        const c=self.c; const v=self.v; try c.step();
        if(a.kind!=.closure) {
            var sig=Json{.c=c}; defer sig.deinit(); try sig.raw("tsfg.signature\x00("); var at:usize=0; var logical:usize=0;
            while(at<a.parameters.len) {
                try c.step(); if(logical!=0)try sig.raw(","); try sig.raw(v.types[@intFromEnum(a.parameters[at].view)].name);
                const mask:u8=if(a.kind==.native)a.presence[logical] else 0;
                if(mask!=0) { try sig.raw("@0"); const digits="0123456789abcdef"; try sig.raw(digits[mask..][0..1]); }
                at+=if(a.kind==.native and mask&3!=0)@as(usize,2) else 1; logical+=1;
            }
            try sig.raw(")->"); try sig.raw(v.types[@intFromEnum(a.source_result)].name); try equal(c,a.source_signature,try parts(c,&.{sig.bytes.items}));
        }
        try c.charge(a.parameters.len); const ids=try c.allocator.alloc(t.Hash,a.parameters.len); defer c.allocator.free(ids);
        for(a.parameters,0..) |p,i| ids[i]=v.domains[@intFromEnum(p.domain)].id;
        const result:?t.Hash=if(a.result) |r| v.domains[@intFromEnum(r.domain)].id else null;
        try equal(c,a.id,try digest(c,"tsfg.finite-abi.v1",.{.parameters=ids,.result=result}));
    }
    fn function(self:*Legacy,f:model.Function,index:usize) Error!void {
        const c=self.c; const v=self.v; try c.step(); const abi=v.abis[@intFromEnum(f.abi)];
        if(abi.kind==.closure) {
            const row=v.closures.functions[index]; const description_text=try self.description(@intFromEnum(row.@"type"),0);
            const callable=v.types[@intFromEnum(row.@"type")]; try c.require(callable.members.len==abi.parameters.len and callable.element.?==abi.source_result);
            for(abi.parameters,0..) |parameter,i| {
                try c.step(); try c.require(parameter.view==callable.members[i]); var ordinal:[20]u8=undefined;
                const expected=try parts(c,&.{"tsfg.lexical-binding.candidate.v1\x00",&idText(f.id),"\x00parameter\x000:",std.fmt.bufPrint(&ordinal,"{d}",.{i}) catch unreachable});
                try textEqual(c,parameter.binding,&idText(expected));
            }
            try equal(c,f.signature,try parts(c,&.{"tsfg.closure-signature.candidate.v1\x00",description_text}));
            try equal(c,f.id,try digest(c,"tsfg.lexical-function.candidate.v1",.{.name=f.name,.parent=if(row.parent) |p| @as(?t.Hash,c.program.functions[@intFromEnum(p)].id) else null,.path=c.program.source_path,.scope=row.scope,.signature=f.signature})); return;
        }
        if(f.role==.module_initializer) {
            try equal(c,f.id,try parts(c,&.{"tsfg.module-initializer.v1\x00",source(c,f.source).path,"\x00",&idText(source(c,f.source).hash),"\x00",&idText(try moduleIdentity(c,f.source)),"\x00",&idText(f.signature)})); return;
        }
        var owner:?t.TypeRef=null; var implicit=false;
        for(v.members.constructions) |row| { try c.step(); if(@intFromEnum(row.function)==index){owner=row.owner; implicit=std.mem.eql(u8,&row.id,&f.id);} }
        for(v.members.methods) |row| { try c.step(); if(@intFromEnum(row.function)==index)owner=row.owner; }
        if(implicit) { try textEqual(c,f.name,"<implicit-construction>"); return; }
        var name=Json{.c=c}; defer name.deinit(); if(owner) |o| { try name.raw(v.types[@intFromEnum(o)].name); try name.raw("."); } try name.raw(f.name);
        const signature=std.fmt.bytesToHex(f.signature,.lower); try equal(c,f.id,try parts(c,&.{"tsfg.function\x00",source(c,f.source).path,"\x00",name.bytes.items,"\x00",&signature}));
    }
    fn closures(self:*Legacy) Error!void {
        const c=self.c; const v=self.v;
        for(v.closures.environments) |env| {
            try c.step(); const owner=c.program.functions[@intFromEnum(env.owner)].id;
            const parent:?t.Hash=if(env.parent) |p| v.closures.environments[@intFromEnum(p)].id else null;
            var slots=Json{.c=c}; defer slots.deinit(); try slots.raw("[");
            for(env.slots,0..) |slot,i| {
                try c.step(); var ordinal:[20]u8=undefined;
                try equal(c,slot.binding,try parts(c,&.{"tsfg.lexical-binding.candidate.v1\x00",&idText(owner),"\x00",@tagName(slot.role),"\x000:",std.fmt.bufPrint(&ordinal,"{d}",.{slot.declaration_index}) catch unreachable}));
                if(i!=0)try slots.raw(","); try slots.value(.{.binding=slot.binding,.@"type"=v.types[@intFromEnum(slot.@"type")].id,.writable=slot.writable});
            }
            try slots.raw("]"); try equal(c,env.id,try digest(c,"tsfg.closure-environment-layout.v1",.{.owner=owner,.parent=parent,.slots=Raw{.bytes=slots.bytes.items}}));
            const text=try encoded(c,.{.id=env.id,.owner=@intFromEnum(env.owner),.parent=if(env.parent) |p| @as(?u16,@intFromEnum(p)) else null,.byte_size=env.byte_size,.alignment=env.alignment,.reference_count=env.reference_count,.slots=env.slots}); defer c.allocator.free(text);
            const input=std.fmt.bytesToHex(c.program.input_identity,.lower); try equal(c,env.storage_id,try parts(c,&.{"tsfg.closure-storage.v1\x00",&input,"\x00",text}));
        }
    }
};

fn lessBytes(_:void,a:[]const u8,b:[]const u8) bool { return std.mem.order(u8,a,b)==.lt; }
fn lessHash(_:void,a:t.Hash,b:t.Hash) bool { return std.mem.order(u8,&a,&b)==.lt; }
fn indexes(c:*Context,rows:anytype,comptime field:[]const u8) Error!std.AutoHashMapUnmanaged(t.Hash,usize) {
    var out=std.AutoHashMapUnmanaged(t.Hash,usize){}; errdefer out.deinit(c.allocator);
    for(rows,0..) |row,i| { try c.step(); try out.put(c.allocator,@field(row,field),i); } return out;
}
fn chargeSort(c:*Context,values:[]const []const u8) Error!void {
    var rounds:usize=1; var n=values.len; while(n>1):(n=(n+1)/2)rounds+=1;
    try c.charge(values.len); for(values) |v| try c.charge(rounds*(1+v.len/8));
}

fn exception(c:*Context,v:*const tables.ExceptionTables) Error!void {
    for(v.types) |row| {
        try c.step(); const expected= switch(row.kind) {
            .scalar => try primitive(c,row.name), .@"undefined",.@"null" => try primitive(c,@tagName(row.kind)),
            .unknown => try ehDigest(c,"type",.{.kind="unknown"}),
            .nullable => try ehDigest(c,"type",.{.kind="nullable",.base=v.types[@intFromEnum(row.base.?)].id,.mask=row.mask}),
            .callable => blk: { const ids=try domainIds(c,v.types,row.parameters); defer c.allocator.free(ids); break :blk try ehDigest(c,"type",.{.kind="callable",.parameters=ids,.return_type=v.types[@intFromEnum(row.result.?)].id}); },
            .aggregate => try ehDigest(c,"type",.{.kind="aggregate",.source=.{.path=source(c,row.source.?).path,.digest=source(c,row.source.?).hash},.category=row.category,.declaration_path=row.path}),
        }; try equal(c,row.id,expected);
    }
    try actualDomains(c,v.types,v.domains,false);
    for(v.members.fields) |f| { try c.step(); try equal(c,f.id,try ehDigest(c,"field",.{.owner=v.types[@intFromEnum(f.owner)].id,.ordinal=f.ordinal})); }
    for(v.members.constructions) |ctor| {
        try c.step(); const owner=v.types[@intFromEnum(ctor.owner)].id;
        const signature=try ehDigest(c,"signature",.{.parameters=[0]t.Hash{},.return_type=owner});
        try equal(c,ctor.signature,signature); try equal(c,ctor.id,try ehDigest(c,"constructor",.{.owner=owner,.ordinal=0,.signature_hash=signature}));
    }
    for(v.modules.modules) |m| { try c.step(); const s=source(c,m.source); try equal(c,m.id,try ehDigest(c,"module",.{.source=.{.path=s.path,.digest=s.hash},.external=m.external})); }
    for(c.program.functions,0..) |f,i| {
        try c.step(); const meta=v.exceptions.functions[i]; const m=v.modules.modules[@intFromEnum(meta.module)]; const abi=v.abis[@intFromEnum(f.abi)];
        try c.require(m.source==f.source);
        if(f.role==.module_initializer) {
            try equal(c,f.id,m.id); try equal(c,f.signature,try ehDigest(c,"signature",.{.parameters=[0]t.Hash{},.return_type="void"})); continue;
        }
        try c.charge(abi.parameters.len); const ids=try c.allocator.alloc(t.Hash,abi.parameters.len); defer c.allocator.free(ids);
        const function_type=meta.@"type" orelse return error.InvalidShape;
        const declaring_scope=meta.declaring_scope orelse return error.InvalidShape;
        const result_type=abi.result orelse return error.InvalidShape;
        const callable=v.types[@intFromEnum(function_type)]; try c.require(callable.kind==.callable and callable.parameters.len==abi.parameters.len and callable.result==result_type);
        for(abi.parameters,0..) |ref,p| { const actual_type=v.exceptions.bindings[@intFromEnum(ref)].@"type"; try c.step(); try c.require(actual_type==callable.parameters[p]); ids[p]=v.types[@intFromEnum(actual_type)].id; }
        try equal(c,f.signature,try ehDigest(c,"signature",.{.parameters=ids,.return_type=v.types[@intFromEnum(result_type)].id}));
        const parent:?t.Hash=if(meta.parent) |p| c.program.functions[@intFromEnum(p)].id else null;
        var declaring=Json{.c=c}; defer declaring.deinit();
        if(meta.parent) |p| {
            var found=false; for(v.exceptions.scopes) |s| { try c.step(); if(s.owner==p and std.mem.eql(u8,&s.id,&declaring_scope)) { try declaring.value(s.path); found=true; break; } } try c.require(found);
        } else { try equal(c,declaring_scope,try ehDigest(c,"scope",.{.owner_kind="module",.owner=m.id,.path=[0]u8{}})); try declaring.raw("[]"); }
        try equal(c,f.id,try ehDigest(c,"function",.{.module=m.id,.parent=parent,.declaring_scope_path=Raw{.bytes=declaring.bytes.items},.name=f.name,.signature_hash=f.signature,.range=f.declaration}));
    }
    for(v.exceptions.scopes) |s| { try c.step(); const f=c.program.functions[@intFromEnum(s.owner)]; try equal(c,s.id,try ehDigest(c,"scope",.{.owner_kind=if(f.role==.module_initializer)@as([]const u8,"module") else "function",.owner=f.id,.path=s.path})); }
    for(v.exceptions.bindings) |b| { try c.step(); const f=c.program.functions[@intFromEnum(b.owner)]; try equal(c,b.id,try ehDigest(c,"binding",.{.owner_kind=if(f.role==.module_initializer)@as([]const u8,"module") else "function",.owner=f.id,.scope_path=v.exceptions.scopes[@intFromEnum(b.scope)].path,.role=b.role,.index=b.index})); }
}

const Common = struct {
    c:*Context, v:*const tables.CommonTables,
    labels:[]?[]u8, shapes:[]?[]u8, states:[]u2,
    fields:[]std.ArrayListUnmanaged(usize), edges:[]std.ArrayListUnmanaged(usize), ctors:[]usize,
    fn init(c:*Context,v:*const tables.CommonTables) Error!Common {
        const n=v.types.len; try c.charge(n*6);
        const labels=try c.allocator.alloc(?[]u8,n); errdefer c.allocator.free(labels); @memset(labels,null);
        const shapes=try c.allocator.alloc(?[]u8,n); errdefer c.allocator.free(shapes); @memset(shapes,null);
        const states=try c.allocator.alloc(u2,n); errdefer c.allocator.free(states); @memset(states,0);
        const fields=try c.allocator.alloc(std.ArrayListUnmanaged(usize),n); errdefer c.allocator.free(fields); @memset(fields,.empty);
        const edges=try c.allocator.alloc(std.ArrayListUnmanaged(usize),n); errdefer c.allocator.free(edges); @memset(edges,.empty);
        const ctors=try c.allocator.alloc(usize,n); @memset(ctors,none);
        return .{.c=c,.v=v,.labels=labels,.shapes=shapes,.states=states,.fields=fields,.edges=edges,.ctors=ctors};
    }
    fn deinit(self:*Common) void {
        for(self.labels) |p| if(p) |bytes| self.c.allocator.free(bytes);
        for(self.shapes) |p| if(p) |bytes| self.c.allocator.free(bytes);
        for(self.fields) |*p| p.deinit(self.c.allocator); for(self.edges) |*p| p.deinit(self.c.allocator);
        self.c.allocator.free(self.labels); self.c.allocator.free(self.shapes); self.c.allocator.free(self.states);
        self.c.allocator.free(self.fields); self.c.allocator.free(self.edges); self.c.allocator.free(self.ctors);
    }
    const Key=struct {index:usize,units:[]u16,count:usize};
    fn lessKey(_:void,a:Key,b:Key) bool { return std.mem.order(u16,a.units[0..a.count],b.units[0..b.count])==.lt; }
    fn sortLabels(self:*Common,type_indexes:[]const usize) Error![]usize {
        const c=self.c; try c.charge(type_indexes.len*2);
        const keys=try c.allocator.alloc(Key,type_indexes.len); defer c.allocator.free(keys);
        var count:usize=0; defer for(keys[0..count]) |key| c.allocator.free(key.units);
        var rounds:usize=1; var n=type_indexes.len; while(n>1):(n=(n+1)/2)rounds+=1;
        for(type_indexes,0..) |index,i| {
            const label_text=self.labels[index].?; try c.charge(rounds*(1+label_text.len/8));
            // UTF8 was validated at the owning ref boundary; convert without
            // parsing it again. UTF16 code-unit order is required by this hash.
            const units=try c.allocator.alloc(u16,label_text.len);
            keys[i]=.{.index=index,.units=units,.count=0}; count+=1;
            var iterator=std.unicode.Utf8View.initUnchecked(label_text).iterator();
            while(iterator.nextCodepoint()) |point| {
                if(point<=0xffff) { units[keys[i].count]=@intCast(point); keys[i].count+=1; }
                else { const pair=point-0x10000; units[keys[i].count]=@intCast(0xd800+(pair>>10)); units[keys[i].count+1]=@intCast(0xdc00+(pair&1023)); keys[i].count+=2; }
            }
        }
        std.mem.sort(Key,keys,{},lessKey);
        const out=try c.allocator.alloc(usize,type_indexes.len); for(keys,0..) |key,i| out[i]=key.index; return out;
    }
    fn label(self:*Common,index:usize,depth:usize) Error![]const u8 {
        const c=self.c; try c.step(); try c.require(depth<=128);
        if(self.labels[index]) |out| return out;
        try c.require(self.states[index]==0); self.states[index]=1;
        const row=self.v.types[index]; var out=Json{.c=c}; errdefer out.deinit();
        switch(row.kind) {
            .reference,.value => { const k=row.nominal_key.?; try out.value(.{.kind=row.kind,.nominal=.{.source_path=source(c,k.source).path,.declaration_path=k.declaration_path,.category=k.category}}); },
            .array,.readSpan => try out.value(.{.kind=row.kind,.element=try self.label(@intFromEnum(row.element.?),depth+1)}),
            .function => {
                try out.raw("{\"kind\":\"function\",\"parameters\":[");
                for(row.members,0..) |ref,i| { try c.step(); if(i!=0)try out.raw(","); try out.value(try self.label(@intFromEnum(ref),depth+1)); }
                try out.raw("],\"returnType\":"); try out.value(try self.label(@intFromEnum(row.element.?),depth+1)); try out.raw("}");
            },
            .@"union" => {
                try c.charge(row.members.len); const refs=try c.allocator.alloc(usize,row.members.len); defer c.allocator.free(refs);
                for(row.members,0..) |ref,i| { refs[i]=@intFromEnum(ref); _=try self.label(refs[i],depth+1); }
                const sorted=try self.sortLabels(refs); defer c.allocator.free(sorted);
                try out.raw("{\"kind\":\"union\",\"members\":[");
                for(sorted,0..) |ref,i| { try c.step(); if(i!=0)try out.raw(","); try out.value(self.labels[ref].?); } try out.raw("]}");
            },
            else => try out.value(.{.kind=row.kind,.name=row.name}),
        }
        self.labels[index]=try out.bytes.toOwnedSlice(c.allocator); self.states[index]=2; return self.labels[index].?;
    }
    fn add(self:*Common,owner:usize,child:usize) Error![]const u8 {
        try self.c.step(); try self.edges[owner].append(self.c.allocator,child); return self.labels[child].?;
    }
    fn shape(self:*Common,index:usize,void_index:usize) Error!void {
        const c=self.c; const v=self.v; const row=v.types[index]; var out=Json{.c=c}; errdefer out.deinit();
        try out.raw("{");
        if(row.base) |base| { try out.raw("\"base\":"); try out.value(try self.add(index,@intFromEnum(base))); try out.raw(","); }
        if(row.kind==.reference or row.kind==.value) {
            try c.require(self.ctors[index]!=none); const ctor=v.members.constructions[self.ctors[index]];
            try out.raw("\"construction\":{\"access\":"); try out.value(ctor.access); try out.raw(",\"parameters\":[");
            for(ctor.signature.parameters,0..) |p,i| { if(i!=0)try out.raw(","); try out.value(try self.add(index,@intFromEnum(p))); }
            try out.raw("],\"returnType\":"); try out.value(self.labels[index].?); try out.raw("},");
        }
        if(row.kind==.array or row.kind==.readSpan) { try out.raw("\"elementType\":"); try out.value(try self.add(index,@intFromEnum(row.element.?))); try out.raw(","); }
        if(row.kind==.reference or row.kind==.value) {
            try out.raw("\"fields\":[");
            for(self.fields[index].items,0..) |f,i| {
                try c.step(); const field=v.members.fields[f]; if(i!=0)try out.raw(",");
                try out.value(.{.access=field.access,.index=field.ordinal,.name=field.name,.readonly=field.readonly,.@"type"=try self.add(index,@intFromEnum(field.@"type"))});
            }
            try out.raw("],");
        }
        try out.raw("\"kind\":"); try out.value(row.kind); try out.raw(",\"label\":"); try out.value(self.labels[index].?);
        if(row.kind==.@"union") {
            try c.charge(row.members.len); const refs=try c.allocator.alloc(usize,row.members.len); defer c.allocator.free(refs);
            for(row.members,0..) |p,i| { refs[i]=@intFromEnum(p); _=try self.add(index,refs[i]); }
            const sorted=try self.sortLabels(refs); defer c.allocator.free(sorted); try out.raw(",\"members\":[");
            for(sorted,0..) |ref,i| { if(i!=0)try out.raw(","); try out.value(self.labels[ref].?); } try out.raw("]");
        }
        if(row.methods) |methods| {
            try out.raw(",\"methods\":[");
            for(methods,0..) |ref,i| {
                try c.step(); const m=v.members.methods[@intFromEnum(ref)]; const abi=v.abis[@intFromEnum(c.program.functions[@intFromEnum(m.function)].abi)];
                if(i!=0)try out.raw(","); try out.raw("{\"access\":"); try out.value(m.access); try out.raw(",\"name\":"); try out.value(m.name); try out.raw(",\"parameters\":[");
                for(abi.parameters,0..) |p,n| { if(n!=0)try out.raw(","); try out.value(try self.add(index,@intFromEnum(v.storage.bindings[@intFromEnum(p)].@"type"))); }
                const result=if(abi.result) |p| @intFromEnum(p) else void_index; try c.require(result!=none);
                try out.raw("],\"returnType\":"); try out.value(try self.add(index,result)); try out.raw("}");
            } try out.raw("]");
        }
        if(row.kind==.function) {
            try out.raw(",\"parameters\":["); for(row.members,0..) |p,i| { if(i!=0)try out.raw(","); try out.value(try self.add(index,@intFromEnum(p))); }
            try out.raw("],\"returnType\":"); try out.value(try self.add(index,@intFromEnum(row.element.?)));
        }
        try out.raw("}"); self.shapes[index]=try out.bytes.toOwnedSlice(c.allocator);
    }
    fn types(self:*Common) Error!void {
        const c=self.c; const v=self.v;
        for(v.members.fields,0..) |f,i| { try c.step(); try self.fields[@intFromEnum(f.owner)].append(c.allocator,i); }
        for(self.fields) |*fs| {
            try c.charge(fs.items.len*8+1);
            std.mem.sort(usize,fs.items,v.members.fields,struct{fn less(rows:[]const @import("wire-program-members.zig").CommonField,a:usize,b:usize)bool{return rows[a].ordinal<rows[b].ordinal;}}.less);
        }
        for(v.members.constructions,0..) |ctor,i| { try c.step(); const owner=@intFromEnum(ctor.owner); try c.require(self.ctors[owner]==none); self.ctors[owner]=i; }
        var labels=std.StringHashMapUnmanaged(void){}; defer labels.deinit(c.allocator); var void_index:usize=none;
        for(v.types,0..) |row,i| { try c.step(); const text=try self.label(i,0); try c.charge(1+text.len/64); try c.require(!(try labels.getOrPut(c.allocator,text)).found_existing); if(row.kind==.@"void")void_index=i; }
        for(v.types,0..) |_,i| try self.shape(i,void_index);
        for(v.types,0..) |row,i| {
            try c.step();
            if(row.kind==.scalar or row.kind==.string or row.kind==.unknown or row.kind==.@"undefined" or row.kind==.@"null" or row.kind==.@"void") {
                const name=if(row.kind==.scalar)row.name else @tagName(row.kind); try textEqual(c,row.name,name); try equal(c,row.id,try primitive(c,name));
            } else {
                var seen=std.AutoHashMapUnmanaged(usize,void){}; defer seen.deinit(c.allocator);
                var pending:std.ArrayListUnmanaged(usize)=.empty; defer pending.deinit(c.allocator); try pending.append(c.allocator,i);
                var graph:std.ArrayListUnmanaged(usize)=.empty; defer graph.deinit(c.allocator);
                while(pending.pop()) |current| {
                    try c.step(); if((try seen.getOrPut(c.allocator,current)).found_existing)continue;
                    try graph.append(c.allocator,current); try c.charge(self.edges[current].items.len); try pending.appendSlice(c.allocator,self.edges[current].items);
                }
                const sorted=try self.sortLabels(graph.items); defer c.allocator.free(sorted);
                var out=Json{.c=c}; defer out.deinit(); try out.raw("{\"graph\":[");
                for(sorted,0..) |n,at| { if(at!=0)try out.raw(","); try out.raw(self.shapes[n].?); } try out.raw("],\"root\":"); try out.value(self.labels[i].?); try out.raw("}");
                try equal(c,row.id,try parts(c,&.{"tsfg.common-program.type.v1\x00",out.bytes.items}));
            }
            if(row.nominal_key) |key| {
                try equal(c,row.runtime_key.?,try runtimeClass(c,key));
            }
        }
        try actualDomains(c,v.types,v.domains,false);
    }
    fn run(self:*Common) Error!void {
        try self.types(); const c=self.c; const v=self.v;
        for(v.members.fields) |f| { try c.step(); try equal(c,f.id,try digest(c,"tsfg.common-program.field.v1",.{.owner=v.types[@intFromEnum(f.owner)].id,.name=f.name,.index=f.ordinal})); }
        for(v.members.methods) |m| { try c.step(); const f=c.program.functions[@intFromEnum(m.function)]; try equal(c,m.id,f.id); try equal(c,m.signature,f.signature); }
        for(v.members.constructions) |ctor| {
            try c.step(); try equal(c,ctor.id,try digest(c,"tsfg.common-program.construction.v1",.{.@"type"=v.types[@intFromEnum(ctor.owner)].id}));
            const origin=ctor.source_signature.origin;
            try equal(c,ctor.source_signature.id,try digest(c,"tsfg.array-facts.signature.v8",.{.source_path=source(c,origin.source).path,.declaration_range=.{.start=origin.start,.end=origin.end}}));
        }
        for(v.modules.modules) |m| {
            try c.step(); try equal(c,m.id,try moduleIdentity(c,m.source)); const f=c.program.functions[@intFromEnum(m.initializer)];
            try equal(c,f.id,try digest(c,"tsfg.common-program.initializer.v1",.{.module=m.id}));
            try equal(c,f.signature,try parts(c,&.{"tsfg.common-program.initializer-signature.v1\x00void"}));
        }
        for(v.modules.globals) |g| { try c.step(); try equal(c,g.id,try parts(c,&.{"tsfg.global\x00",source(c,g.source).path,"\x00",if(g.generated)"$default" else g.name,"\x00",&idText(v.types[@intFromEnum(g.@"type")].id)})); }
        for(v.modules.hosts) |h| {
            try c.step(); const ids=try domainIds(c,v.types,h.parameter_types); defer c.allocator.free(ids);
            try equal(c,h.signature,try digest(c,"tsfg.module-callable-signature.candidate.v1",.{.parameters=ids,.returns=v.types[@intFromEnum(h.return_type)].id}));
            try equal(c,h.id,try digest(c,"tsfg.common-program.host-import.v1",.{.source_path=source(c,h.source).path,.name=h.name,.capability_id=h.capability,.signature_hash=h.signature}));
        }
        for(v.storage.bindings) |b| switch(b.owner) {
            .receiver => |owner| {
                try c.step(); const f=c.program.functions[@intFromEnum(owner)];
                const raw=try digest(c,"tsfg.array-facts.function.v8",.{.source_path=source(c,f.source).path,.declaration_range=f.declaration});
                const expected=try std.fmt.allocPrint(c.allocator,"this@{s}",.{idText(raw)}); defer c.allocator.free(expected); try textEqual(c,b.id,expected);
            },
            .element => |owner| { try c.step(); const expected=try std.fmt.allocPrint(c.allocator,"element:{s}",.{idText(v.types[@intFromEnum(owner)].id)}); defer c.allocator.free(expected); try textEqual(c,b.id,expected); },
            else => {}, // Original Source Binding IDs omit the necessary Source declaration keys.
        };
        try self.environments(); try self.interfaces(); try self.checkPublication();
    }
    fn environments(self:*Common) Error!void {
        const c=self.c; const v=self.v;
        for(v.closures.environments) |env| {
            try c.step(); const owner=c.program.functions[@intFromEnum(env.owner)].id;
            var slots=Json{.c=c}; defer slots.deinit(); try slots.raw("[");
            for(env.slots,0..) |slot,i| {
                try c.step(); const b=v.storage.bindings[@intFromEnum(slot.binding)]; const path=v.exceptions.scopes[@intFromEnum(b.scope.?)].path;
                var key=Json{.c=c}; defer key.deinit(); try key.raw("{\"kind\":"); try key.value(slot.kind); try key.raw(",\"name\":"); try key.value(b.name); try key.raw(",\"owner\":"); try key.value(owner);
                if(path.len!=0) { try key.raw(",\"scope\":"); try key.value(path); } try key.raw("}");
                try equal(c,slot.key,try parts(c,&.{"tsfg.common-program.capture-slot.v1\x00",key.bytes.items}));
                if(i!=0)try slots.raw(","); try slots.value(.{.key=slot.key,.kind=slot.kind,.@"type"=v.types[@intFromEnum(slot.@"type")].id,.writable=slot.writable});
            }
            try slots.raw("]"); const parent:?t.Hash=if(env.parent) |p| v.closures.environments[@intFromEnum(p)].id else null;
            try equal(c,env.id,try digest(c,"tsfg.common-program.environment-layout.v1",.{.owner=owner,.parent=parent,.slots=Raw{.bytes=slots.bytes.items}}));
        }
    }
    fn interfaces(self:*Common) Error!void {
        const c=self.c; const v=self.v; const scope=v.authority.fixed_publication.stable_scope;
        var functions=std.AutoHashMapUnmanaged(t.Hash,usize){}; defer functions.deinit(c.allocator);
        for(c.program.functions,0..) |f,i| { try c.step(); try functions.put(c.allocator,f.id,i); }
        var closure_rows=std.AutoHashMapUnmanaged(usize,usize){}; defer closure_rows.deinit(c.allocator);
        for(v.closures.functions,0..) |row,ordinal| { try c.step(); try closure_rows.put(c.allocator,@intFromEnum(row.function),ordinal); }
        const Member=struct {owner:t.TypeRef,access:@import("wire-program-members.zig").Access};
        var member_rows=std.AutoHashMapUnmanaged(usize,Member){}; defer member_rows.deinit(c.allocator);
        for(v.members.methods) |row| {
            try c.step(); const entry=try member_rows.getOrPut(c.allocator,@intFromEnum(row.function));
            try c.require(!entry.found_existing); entry.value_ptr.*=.{.owner=row.owner,.access=row.access};
        }
        for(v.members.constructions) |row| {
            try c.step(); if(row.function) |function_ref| {
                const entry=try member_rows.getOrPut(c.allocator,@intFromEnum(function_ref));
                try c.require(!entry.found_existing); entry.value_ptr.*=.{.owner=row.owner,.access=row.access};
            }
        }
        var seen=std.AutoHashMapUnmanaged(t.Hash,void){}; defer seen.deinit(c.allocator);
        for(scope.functions) |row| {
            try c.step(); const index=functions.get(row.function_id) orelse return error.InvalidShape;
            try c.require(!(try seen.getOrPut(c.allocator,row.function_id)).found_existing);
            const f=c.program.functions[index]; const abi=v.abis[@intFromEnum(f.abi)]; const decl=row.decl_key;
            try c.require(f.role!=.module_initializer); try textEqual(c,decl.source_path,source(c,f.source).path); try textEqual(c,decl.name,f.name);
            try c.charge(abi.parameters.len+1); const ps=try c.allocator.alloc(t.Hash,abi.parameters.len+@as(usize,if(abi.receiver!=null)1 else 0)); defer c.allocator.free(ps);
            const offset:usize=if(abi.receiver) |b| blk:{ps[0]=v.types[@intFromEnum(v.storage.bindings[@intFromEnum(b)].@"type")].id; break :blk 1;} else 0;
            for(abi.parameters,0..) |b,i| ps[i+offset]=v.types[@intFromEnum(v.storage.bindings[@intFromEnum(b)].@"type")].id;
            const result=if(abi.result) |r| v.types[@intFromEnum(r)].id else try primitive(c,"void");
            try sameValue(c,ps,row.parameter_types); try equal(c,result,row.return_type);
            const signature=try digest(c,"tsfg.module-callable-signature.candidate.v1",.{.parameters=ps,.returns=result});
            try equal(c,signature,f.signature); try equal(c,signature,row.signature_hash);
            const name=try encoded(c,.{.path=decl.path,.kind=decl.kind,.name=decl.name}); defer c.allocator.free(name);
            try equal(c,f.id,try digest(c,"tsfg.module-callable-function.candidate.v1",.{.path=source(c,f.source).path,.name=name,.signature_hash=signature}));
            const closure=v.closures.functions[closure_rows.get(index) orelse return error.InvalidShape];
            const owner:?t.TypeRef=if(abi.receiver) |b| v.storage.bindings[@intFromEnum(b)].@"type" else null;
            if(f.role==.construction_body) {
                try c.require(row.kind==.@"construction-body" and decl.kind==.constructor and owner!=null);
            } else if(row.kind==.method) {
                try c.require(decl.kind==.method and owner!=null);
            } else try c.require(row.kind==.source and decl.kind==.function and owner==null);
            if(row.kind==.source) {
                try c.require(!member_rows.contains(index) and row.access==.public);
            } else {
                const selected=member_rows.get(index) orelse return error.InvalidShape;
                try c.require(row.access==selected.access and owner==selected.owner and closure.parent==null);
                const nominal=v.types[@intFromEnum(selected.owner)].nominal_key orelse return error.InvalidShape;
                try c.require(decl.path.len==nominal.declaration_path.len+1);
                try textEqual(c,decl.path[0],"type");
                for(decl.path[1..],nominal.declaration_path) |actual,expected| { try c.step(); try textEqual(c,actual,expected); }
            }
            const parent:?t.Hash=if(closure.parent) |p| c.program.functions[@intFromEnum(p)].id else null;
            const lexical:?t.Hash=if(closure.lexical_environment) |p| v.closures.environments[@intFromEnum(p)].id else null;
            const activation:?t.Hash=if(closure.activation_environment) |p| v.closures.environments[@intFromEnum(p)].id else null;
            try sameValue(c,parent,row.lexical_parent); try sameValue(c,lexical,row.lexical_environment); try sameValue(c,activation,row.activation_environment);
            var keys=std.AutoHashMapUnmanaged(t.Hash,void){}; defer keys.deinit(c.allocator);
            var captures:std.ArrayListUnmanaged(t.Hash)=.empty; defer captures.deinit(c.allocator);
            for(closure.captures) |cap| {
                try c.step(); const key=v.closures.environments[@intFromEnum(cap.environment)].slots[@intFromEnum(cap.slot)].key;
                if(!(try keys.getOrPut(c.allocator,key)).found_existing)try captures.append(c.allocator,key);
            }
            try c.charge(captures.items.len*8+1); std.mem.sort(t.Hash,captures.items,{},lessHash); try sameValue(c,captures.items,row.captures);
        }
        for(c.program.functions) |f| { try c.step(); try c.require((f.role!=.module_initializer)==seen.contains(f.id)); }
        var type_ids=std.AutoHashMapUnmanaged(t.Hash,usize){}; defer type_ids.deinit(c.allocator);
        for(v.types,0..) |row,i| { try c.step(); try type_ids.put(c.allocator,row.id,i); }
        for(scope.types) |row| {
            try c.step(); const i=type_ids.get(row.id) orelse return error.InvalidShape; try textEqual(c,self.labels[i].?,row.label);
            try sameValue(c,Raw{.bytes=self.shapes[i].?},row.shape);
        }
        try self.scopeDirectories();
    }
    fn scopeDirectories(self:*Common) Error!void {
        const c=self.c; const v=self.v; const scope=v.authority.fixed_publication.stable_scope;
        try textEqual(c,scope.root_file,c.program.source_path);
        try c.require(scope.globals.len==v.modules.globals.len and scope.modules.len==v.modules.modules.len and scope.environments.len==v.closures.environments.len and scope.host_imports.len==v.modules.hosts.len);
        const globals=try indexes(c,v.modules.globals,"id"); defer { var map=globals; map.deinit(c.allocator); }
        for(scope.globals) |g| {
            try c.step(); const actual=v.modules.globals[globals.get(g.global_id) orelse return error.InvalidShape];
            try equal(c,g.@"type",v.types[@intFromEnum(actual.@"type")].id); try c.require(g.writable==actual.writable); try sameValue(c,g.decl_key,actual.decl_key);
        }
        const envs=try indexes(c,v.closures.environments,"id"); defer { var map=envs; map.deinit(c.allocator); }
        for(scope.environments) |env| {
            try c.step(); const actual=v.closures.environments[envs.get(env.id) orelse return error.InvalidShape];
            try equal(c,env.owner,c.program.functions[@intFromEnum(actual.owner)].id);
            const parent:?t.Hash=if(actual.parent) |p| v.closures.environments[@intFromEnum(p)].id else null; try sameValue(c,env.parent,parent);
            try c.require(env.slots.len==actual.slots.len);
            for(env.slots,actual.slots) |s,a| { try c.step(); try sameValue(c,s,.{.key=a.key,.kind=a.kind,.@"type"=v.types[@intFromEnum(a.@"type")].id,.writable=a.writable}); }
        }
        const modules=try indexes(c,v.modules.modules,"id"); defer { var map=modules; map.deinit(c.allocator); }
        for(scope.modules) |m| {
            try c.step(); const actual=v.modules.modules[modules.get(m.id) orelse return error.InvalidShape];
            try textEqual(c,m.source_path,source(c,actual.source).path); try c.require(m.external==actual.external);
            try equal(c,m.initializer,c.program.functions[@intFromEnum(actual.initializer)].id);
            try c.require(m.dependencies.len==actual.dependencies.len and m.globals.len==actual.globals.len and m.imports.len==actual.imports.len and m.exports.len==actual.exports.len);
            for(m.dependencies,actual.dependencies) |path,ref| { try c.step(); try textEqual(c,path,source(c,v.modules.modules[@intFromEnum(ref)].source).path); }
            for(m.globals,actual.globals) |id,ref| { try c.step(); try equal(c,id,v.modules.globals[@intFromEnum(ref)].id); }
            for(m.imports,actual.imports) |imp,a| {
                try c.step(); try c.require(imp.kind==a.kind and imp.bindings.len==a.bindings.len); try textEqual(c,imp.specifier,a.specifier); try textEqual(c,imp.source_path,source(c,a.source).path);
                for(imp.bindings,a.bindings) |b,ab| { try c.step(); try sameValue(c,b,.{.imported=ab.imported,.kind=ab.kind,.name=ab.name,.target=ab.target,.target_source_path=source(c,ab.target_source).path}); }
            }
            for(m.exports,actual.exports) |e,a| { try c.step(); try sameValue(c,e,.{.kind=a.kind,.name=a.name,.target=a.target,.target_source_path=source(c,a.target_source).path}); }
        }
        try c.require(scope.roots.roots.len==v.modules.roots.roots.len and scope.roots.required_roots.len==v.modules.roots.required_roots.len);
        inline for(.{"roots","required_roots"}) |key| for(@field(scope.roots,key),@field(v.modules.roots,key)) |s,a| {
            try c.step(); try sameValue(c,s,.{.kind=a.kind,.name=a.name,.source_path=source(c,a.source).path,.target=a.target});
        };
        const hosts=try indexes(c,v.modules.hosts,"id"); defer { var map=hosts; map.deinit(c.allocator); }
        try c.require((scope.host_context!=null)==(v.modules.hosts.len!=0));
        for(scope.host_imports) |h| {
            try c.step(); const a=v.modules.hosts[hosts.get(h.id) orelse return error.InvalidShape];
            try textEqual(c,h.source_path,source(c,a.source).path); try textEqual(c,h.name,a.name); try c.require(h.capability_id==a.capability);
            try equal(c,h.signature_hash,a.signature); try equal(c,h.return_type,v.types[@intFromEnum(a.return_type)].id);
            const ids=try domainIds(c,v.types,a.parameter_types); defer c.allocator.free(ids); try sameValue(c,h.parameter_types,ids);
            try equal(c,scope.host_context.?.contract_digest,a.contract_digest); try equal(c,scope.host_context.?.build_identity_digest,a.build_identity_digest);
        }
        // The stable type directory is the interface/global/all-nominal closure,
        // not every body-only temporary Type and not a producer-selected subset.
        try c.charge(v.types.len); const required=try c.allocator.alloc(bool,v.types.len); defer c.allocator.free(required); @memset(required,false);
        var pending:std.ArrayListUnmanaged(usize)=.empty; defer pending.deinit(c.allocator);
        for(v.types,0..) |row,i| { try c.step(); if(row.kind==.reference or row.kind==.value)try pending.append(c.allocator,i); }
        for(v.modules.globals) |g| { try c.step(); try pending.append(c.allocator,@intFromEnum(g.@"type")); }
        for(c.program.functions,0..) |f,i| {
            try c.step(); if(f.role==.module_initializer)continue; const abi=v.abis[i];
            if(abi.receiver) |b| try pending.append(c.allocator,@intFromEnum(v.storage.bindings[@intFromEnum(b)].@"type"));
            for(abi.parameters) |b| { try c.step(); try pending.append(c.allocator,@intFromEnum(v.storage.bindings[@intFromEnum(b)].@"type")); }
            if(abi.result) |r| try pending.append(c.allocator,@intFromEnum(r)) else {
                for(v.types,0..) |row,n| { try c.step(); if(row.kind==.@"void") { try pending.append(c.allocator,n); break; } }
            }
        }
        var count:usize=0;
        while(pending.pop()) |i| { try c.step(); if(required[i])continue; required[i]=true; count+=1; try c.charge(self.edges[i].items.len); try pending.appendSlice(c.allocator,self.edges[i].items); }
        try c.require(scope.types.len==count);
        const type_ids=try indexes(c,v.types,"id"); defer { var map=type_ids; map.deinit(c.allocator); }
        for(scope.types) |row| { try c.step(); try c.require(required[type_ids.get(row.id) orelse return error.InvalidShape]); }
    }
    fn checkPublication(self:*Common) Error!void {
        const c=self.c; const v=self.v; const fixed=v.authority.fixed_publication; const p=fixed.publication;
        // This authenticates declared interfaces/upper bounds, never derives
        // effective call membership or grants the upper as an actual-flow seed.
        try equal(c,p.scope_digest,try digest(c,"tsfg.common-program.publication-scope.v1",fixed.stable_scope));
        var contracts=std.AutoHashMapUnmanaged(t.Hash,usize){}; defer contracts.deinit(c.allocator);
        try c.require(p.contracts.len==fixed.stable_scope.functions.len);
        for(p.contracts,0..) |row,i| {
            try c.step(); try c.require(!(try contracts.getOrPut(c.allocator,row.function_id)).found_existing);
            contracts.getPtr(row.function_id).?.*=i;
            try equal(c,row.function_id,fixed.stable_scope.functions[i].function_id); try equal(c,row.signature_hash,fixed.stable_scope.functions[i].signature_hash);
            try equal(c,row.digest,try digest(c,"tsfg.common-program.published-contract.v1",.{.function_id=row.function_id,.signature_hash=row.signature_hash,.upper=row.upper,.callables=row.callables}));
        }
        try equal(c,p.expected_digest,try digest(c,"tsfg.common-program.publication.v1",.{.scope_digest=p.scope_digest,.contracts=p.contracts}));
        try c.require(fixed.dependencies.len==c.program.functions.len);
        for(fixed.dependencies,0..) |row,i| {
            try c.step(); try equal(c,row.function_id,c.program.functions[i].id);
            for(row.callees) |edge| { try c.step(); const index=contracts.get(edge.function_id) orelse return error.InvalidShape; try equal(c,edge.digest,p.contracts[index].digest); }
            for(row.hosts) |edge| {
                var found=false; for(v.modules.hosts) |host| { try c.step(); if(std.mem.eql(u8,&edge.host_id,&host.id)){try equal(c,edge.contract_digest,host.contract_digest); try equal(c,edge.build_identity_digest,host.build_identity_digest);found=true;break;} } try c.require(found);
            }
        }
        for(fixed.request.targets) |id| { try c.step(); try c.require(contracts.contains(id)); }
    }
};

// Preconditions: wire17 references, table family/shape, UTF8 and layouts have
// passed using this SAME Context. Do not call this on a newly constructed graph
// to bypass those checks. Caller retains the one fixed, non-refillable budget.
// No raw packet/envelope payload hash, Source content/package hash, Source AST,
// SSA/effective targets, effects, borrow proof or execution authority is implied.
pub fn check(c:*Context) Error!void {
    switch(c.program.tables.mode) {
        .legacy => |v| { var engine=try Legacy.init(c,&v); defer engine.deinit(); try engine.run(); },
        .exception => |v| try exception(c,&v),
        .common => |v| { var engine=try Common.init(c,&v); defer engine.deinit(); try engine.run(); },
    }
}
