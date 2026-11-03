// SPDX-License-Identifier: MIT
// Prospective private Common18 owning reader. NOT registered or executed.
// Returns owned UNVERIFIED data: no Context, VerifiedModule or authority token.
const std=@import("std");
const model=@import("wire-program-model.zig");
const tables=@import("wire-program-tables.zig");
const json=@import("wire18-json-reader.zig");
const instruction=model.instruction;
const t=model.types;
pub const Error=json.Error||error{Truncated,WrongFormat,WrongTarget,PacketLimit,InvalidIntegrity,InvalidRecord,InvalidReference,InvalidOrigin};

const Reader=struct{
    bytes:[]const u8,at:usize=0,decoder:*json.Decoder,
    fn take(self:*Reader,count:usize)Error![]const u8{
        try self.decoder.meter.bytes(count);
        if(count>self.bytes.len-self.at)return error.Truncated;
        const out=self.bytes[self.at..][0..count];self.at+=count;return out;
    }
    fn int(self:*Reader,comptime T:type)Error!T{return std.mem.readInt(T,(try self.take(@sizeOf(T)))[0..@sizeOf(T)],.little);}
    fn boolean(self:*Reader)Error!bool{const v=try self.int(u8);if(v>1)return error.InvalidRecord;return v==1;}
    fn enumeration(self:*Reader,comptime T:type,comptime U:type)Error!T{
        const value=try self.int(U);
        return if(@typeInfo(T).@"enum".is_exhaustive)std.enums.fromInt(T,value) orelse error.InvalidRecord else @enumFromInt(value);
    }
    fn digest(self:*Reader)Error!t.Hash{return (try self.take(32))[0..32].*;}
    fn text(self:*Reader,maximum:usize,minimum:usize)Error![]const u8{
        const count=try self.int(u32);if(count<minimum or count>maximum)return error.InvalidRecord;
        const bytes=try self.take(count);try self.decoder.meter.bytes(bytes.len);
        if(!std.unicode.utf8ValidateSlice(bytes) or std.mem.indexOfScalar(u8,bytes,0)!=null)return error.InvalidRecord;
        return bytes;
    }
    fn anchor(self:*Reader)Error!t.Anchor{return .{.start=try self.int(u32),.end=try self.int(u32)};}
    fn reference(self:*Reader,comptime T:type,comptime U:type)Error!T{return @enumFromInt(try self.int(U));}
    fn refs(self:*Reader,count:usize)Error![]const t.RegisterRef{
        if(count>4096)return error.InvalidRecord;
        const out=try self.decoder.alloc(t.RegisterRef,count);for(out)|*v|v.*=try self.reference(t.RegisterRef,u16);return out;
    }
    // Only the declared instruction suffix structs use this wire layout.
    // Construction/Cell indices in these records are u16, despite the wider
    // table directory types; Field/Method/Dispatch/domain references are u32.
    fn suffix(self:*Reader,comptime T:type)Error!T{
        try self.decoder.meter.spend(1);
        if(T==t.ConstructionRef or T==t.CellRef)return self.reference(T,u16);
        switch(@typeInfo(T)){
            .void=>return {},.bool=>return self.boolean(),.int=>return self.int(T),
            .@"enum"=>|info|return self.enumeration(T,info.tag_type),
            .@"struct"=>|info|{var out:T=undefined;inline for(info.fields)|field|@field(out,field.name)=try self.suffix(field.type);return out;},
            else=>@compileError("instruction suffix needs an explicit wire mapping"),
        }
    }
    fn data(self:*Reader,opcode:instruction.Opcode)Error!instruction.Data{
        switch(opcode){
            .const_bool=>{const bits=try self.int(u64);if(bits>1)return error.InvalidRecord;return .{.const_bool=bits==1};},
            .string_constant=>{
                const count=try self.int(u32);if(count>16384)return error.InvalidRecord;
                const units=try self.decoder.alloc(u16,count);for(units)|*v|v.*=try self.int(u16);return .{.string_constant=units};
            },
            .domain_array_create=>return .{.domain_array_create=.{.actual_array_type=try self.reference(t.TypeRef,u16),.element_domain=try self.reference(t.DomainRef,u32),.owner=try self.text(4096,1)}},
            .domain_numeric_use=>return .{.domain_numeric_use=.{.target_type=try self.reference(t.TypeRef,u16),.numeric_operator=try self.enumeration(instruction.Opcode,u8),.numeric_arity=try self.int(u8),.numeric_operand=try self.int(u8),.numeric_group=try self.text(4096,1),.normal_successor=try self.reference(t.BlockRef,u16)}},
            .eh_field_initialize=>return .{.eh_field_initialize=.{.field=try self.reference(t.FieldRef,u16)}},
            .eh_field_read=>{
                const count=try self.int(u16);if(count==0 or count>32)return error.InvalidRecord;
                const fields=try self.decoder.alloc(t.FieldRef,count);for(fields)|*v|v.*=try self.reference(t.FieldRef,u16);return .{.eh_field_read=fields};
            },
            .eh_carrier=>{const ref=try self.int(u16);return .{.eh_carrier=if(ref==65535)null else @enumFromInt(ref)};},
            .common_typed_array_create=>{
                const actual=try self.reference(t.TypeRef,u16);const kind=try self.int(u16);const ref=try self.int(u32);
                const carrier:t.Carrier=switch(kind){0=>.{.domain=@enumFromInt(ref)},2=>blk:{if(ref>65535)return error.InvalidRecord;break :blk .{.@"type"=@enumFromInt(ref)};},4=>blk:{if(ref!=0)return error.InvalidRecord;break :blk .{.payload={}};},else=>return error.InvalidRecord};
                return .{.common_typed_array_create=.{.actual_array_type=actual,.element_carrier=carrier,.allocation=try self.text(4096,1)}};
            },
            // Every other enum arm is a fixed, explicitly typed suffix. No
            // opcode is executed; even the ordinary pos arm is data-only.
            inline else=>|tag|return @unionInit(instruction.Data,@tagName(tag),try self.suffix(@FieldType(instruction.Data,@tagName(tag)))),
        }
    }
    fn operation(self:*Reader)Error!instruction.Instruction{
        const opcode=try self.enumeration(instruction.Opcode,u8);
        const flags=try self.int(u8);if(flags>3)return error.InvalidRecord;
        const result=try self.int(u16);const count=try self.int(u32);
        const range=try self.anchor();const source=try self.reference(t.SourceRef,u16);
        const operands=try self.refs(count);
        const operator_anchor=if(flags&1!=0)try self.anchor() else null;
        const target_anchor=if(flags&2!=0)try self.anchor() else null;
        return .{.source=.{.source=source,.start=range.start,.end=range.end},.result=if(result==65535)null else @enumFromInt(result),.operands=operands,
            .operator_anchor=operator_anchor,.target_anchor=target_anchor,.data=try self.data(opcode)};
    }
    fn function(self:*Reader)Error!model.Function{
        const id=try self.digest();const signature=try self.digest();const abi=try self.reference(t.AbiRef,u32);const source=try self.reference(t.SourceRef,u16);
        const role=try self.enumeration(model.FunctionRole,u8);if(try self.int(u8)!=0)return error.InvalidRecord;
        const declaration=try self.anchor();const name=try self.text(4096,1);
        const register_count=try self.int(u16);const block_count=try self.int(u16);const operation_count=try self.int(u16);
        if(register_count>4096 or block_count==0 or block_count>256 or operation_count>8192)return error.InvalidRecord;
        const registers=try self.decoder.alloc(model.Register,register_count);
        for(registers)|*reg|{
            const ref=try self.int(u32);const view=try self.int(u16);const kind=try self.int(u16);
            const carrier:t.Carrier=switch(kind){
                0=>.{.domain=@enumFromInt(ref)},1=>blk:{if(ref>65535)return error.InvalidRecord;break :blk .{.environment=@enumFromInt(ref)};},
                2=>blk:{if(ref>65535)return error.InvalidRecord;break :blk .{.@"type"=@enumFromInt(ref)};},3=>.{.cell=@enumFromInt(ref)},
                4=>blk:{if(ref!=0)return error.InvalidRecord;break :blk .{.payload={}};},5=>.{.receiver=@enumFromInt(ref)},6=>.{.initialization=@enumFromInt(ref)},else=>return error.InvalidRecord};
            if((kind==1 or kind==3 or kind==5 or kind==6) and view!=65535)return error.InvalidRecord;
            reg.*=.{.carrier=carrier,.view=if(view==65535)null else @enumFromInt(view)};
        }
        const blocks=try self.decoder.alloc(model.Block,block_count);var operations:usize=0;
        for(blocks)|*block|{
            const count=try self.int(u16);const parameters=try self.refs(count);
            const length=try self.int(u16);if(length==0 or length>operation_count-operations)return error.InvalidRecord;operations+=length;
            const rows=try self.decoder.alloc(instruction.Instruction,length);for(rows)|*row|row.*=try self.operation();
            block.*=.{.parameters=parameters,.instructions=rows};
        }
        if(operations!=operation_count)return error.InvalidRecord;
        return .{.id=id,.signature=signature,.abi=abi,.source=source,.role=role,.declaration=declaration,.name=name,.registers=registers,.blocks=blocks};
    }
};

// This function is source-only/typechecked in the current candidate. Its byte
// slice signature is not permission to invoke it on original or test packets.
// Success conveys ownership and exact syntactic shape, never semantic proof.
// remaining belongs to the calling boundary; failures also retain all charges.
pub fn readOwned(allocator:std.mem.Allocator,borrowed:[]const u8,remaining:*usize)Error!model.OwnedProgram{
    if(remaining.*>model.format.max_work)return error.WorkLimit;
    if(borrowed.len<80 or borrowed.len>model.format.max_bytes)return error.PacketLimit;
    var meter=json.Meter{.remaining=remaining.*};defer remaining.*=meter.remaining;try meter.bytes(borrowed.len);
    var arena=std.heap.ArenaAllocator.init(allocator);errdefer arena.deinit();
    const encoded=try arena.allocator().dupe(u8,borrowed);
    var decoder=json.Decoder{.allocator=arena.allocator(),.meter=&meter};var reader=Reader{.bytes=encoded,.decoder=&decoder};
    const envelope=model.Envelope{.magic=(try reader.take(8))[0..8].*,.version=try reader.int(u32),.schema_hash=try reader.digest(),.total_bytes=try reader.int(u32),.payload_hash=try reader.digest()};
    if(envelope.total_bytes!=encoded.len)return error.PacketLimit;
    // The whole payload is charged before hashing; no independent refill.
    try meter.bytes(encoded.len-80);var payload_hash:t.Hash=undefined;std.crypto.hash.sha2.Sha256.hash(encoded[80..],&payload_hash,.{});
    if(!std.mem.eql(u8,&payload_hash,&envelope.payload_hash))return error.InvalidIntegrity;
    const target=model.Target{.target=try reader.text(4096,1),.triple=try reader.text(4096,1),.data_layout=try reader.text(4096,1),
        .i32_bytes=try reader.int(u16),.i32_alignment=try reader.int(u16),.pointer_bits=try reader.int(u16),.pointer_alignment=try reader.int(u16),.capability=try reader.int(u32)};
    try model.requireFormat(envelope,target);
    const input=try reader.digest();const source_hash=try reader.digest();const source_path=try reader.text(4096,1);const source_length=try reader.int(u32);const root_source=try reader.reference(t.SourceRef,u16);
    if(try reader.int(u8)!=11)return error.InvalidRecord;
    var raw:[11]json.Node=undefined;
    for(&raw,0..)|*row,index|{
        if(try reader.int(u8)!=index)return error.InvalidOrder;
        const length=try reader.int(u32);row.*=try decoder.parse(try reader.take(length));
    }
    const authority=try decoder.object(raw[8]);
    const fixed=try decoder.get(authority,"fixedPublication");if(fixed!=.object)return error.UnsupportedMode;
    const sources=try decoder.convert([]const tables.Source,raw[0]);
    if(sources.len==0 or sources.len>128)return error.InvalidRecord;
    decoder.sources=sources;
    // One complete Common table family. No independently selectable unions or
    // omitted tables, no fallbacks to a legacy schema or empty typed records.
    const common=tables.CommonTables{.types=try decoder.convert(@FieldType(tables.CommonTables,"types"),raw[1]),
        .members=try decoder.convert(@FieldType(tables.CommonTables,"members"),raw[2]),.domains=try decoder.convert(@FieldType(tables.CommonTables,"domains"),raw[3]),
        .storage=try decoder.convert(@FieldType(tables.CommonTables,"storage"),raw[4]),.views=try decoder.convert(@FieldType(tables.CommonTables,"views"),raw[5]),
        .abis=try decoder.convert(@FieldType(tables.CommonTables,"abis"),raw[6]),.modules=try decoder.convert(@FieldType(tables.CommonTables,"modules"),raw[7]),
        .authority=try decoder.convert(@FieldType(tables.CommonTables,"authority"),raw[8]),.closures=try decoder.convert(@FieldType(tables.CommonTables,"closures"),raw[9]),
        .exceptions=try decoder.convert(@FieldType(tables.CommonTables,"exceptions"),raw[10])};
    const count=try reader.int(u16);if(count==0 or count>4096)return error.InvalidRecord;
    const functions=try decoder.alloc(model.Function,count);for(functions)|*fn_row|fn_row.*=try reader.function();
    if(reader.at!=encoded.len)return error.InvalidRecord;
    // Required sourcePlan belongs to this actual function's one ABI directory
    // row. This exact join is data correspondence, not Source/SSA/VM admission.
    try meter.spend(1+common.abis.len);
    if(common.abis.len!=functions.len)return error.InvalidReference;
    for(common.abis,functions,0..)|abi,fn_row,index|{
        try meter.spend(3);try meter.bytes(64);
        if(@intFromEnum(abi.function)!=index or @intFromEnum(fn_row.abi)!=index)return error.InvalidReference;
        if(!std.mem.eql(u8,&abi.signature,&fn_row.signature))return error.InvalidRecord;
    }
    return .{.arena=arena,.encoded=encoded,.program=.{.envelope=envelope,.target=target,.input_identity=input,.source_hash=source_hash,.source_path=source_path,.source_length=source_length,
        .root_source=root_source,.tables=.{.sources=sources,.mode=.{.common=common}},.functions=functions}};
}
