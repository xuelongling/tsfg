// SPDX-License-Identifier: MIT
// Finite test-only packet encoder for the four frozen 20n presence programs.
// The schema owns layout; the earlier independent source/SSA plans own values.
// No product import, Core parser, C++ result, packet reader or execution is used.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const coreSchema="sha256:8f99963869ac2fed97db0ce90171d89593e4a3de667288eace4fc141c7cbc4bd";
const wireSchema="30ad00db29b3809aa36bad19c525d9b3af8f3c77431efa5edcfe081f540fa4e8";
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jcs=value=>Array.isArray(value)?'['+value.map(jcs).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+jcs(value[key])).join(',')+'}':JSON.stringify(value);
const entity=(domain,record)=>'sha256:'+digest(domain+'\0'+coreSchema+'\0'+jcs(record));
const handType=code=>{var records={1:{kind:'scalar',name:'i32'},241:{kind:'nullable-i32',null:false,undefined:true},242:{kind:'nullable-i32',null:true,undefined:false},243:{kind:'nullable-i32',null:true,undefined:true}};assert.ok(Object.hasOwn(records,code));return entity('tsfg.core-nullable-candidate.type.v1',records[code]);};
export function encodePresencePacketOracle(coreCase,hirCase){const hir=hirCase.expectedHir,p=coreCase.manualPlan.sourcePlan,n=240+p.mask,g=p.guards;
 assert.ok(g.length===1||g.length===2);
assert.equal(coreCase.name,hirCase.name);
assert.equal(coreCase.name,p.name);
const row=(opcode,type,register,immediate,range,edges=[])=>({opcode,type,register,immediate,start:range[0],end:range[1],bits:null,edges});
const b=(parameters,rows)=>({parameters,rows});
const chooseBlocks=[
 b([[0,n],[1,1]],[row(26,0,0,1,p.fn),row(242,2,2,g[0].tag*65536,g[0].condition),
  row(25,2,2,131073,g[0].condition,[[],[]])]),
 b([],[row(2,1,1,0,g[0].returned)]),b([],[row(24,0,0,3,g[0].if,[[0,1]])]),
];
if(g.length===1)chooseBlocks.push(b([[3,n],[4,1]],[row(243,1,5,3,p.tailRef),row(2,1,5,0,p.tailReturn)]));
else chooseBlocks.push(
 b([[3,n],[4,1]],[row(242,2,5,g[1].tag*65536+3,g[1].condition),row(25,2,5,327684,g[1].condition,[[],[]])]),
 b([],[row(2,1,4,0,g[1].returned)]),b([],[row(24,0,0,6,g[1].if,[[3,4]])]),
 b([[6,n],[7,1]],[row(243,1,8,6,p.tailRef),row(2,1,8,0,p.tailReturn)]),
);
const specifications=[
 {name:'choose',role:1,parameters:[n,1],result:1,registers:g.length===1?6:9,range:p.fn,
  registerTypes:g.length===1?[n,1,2,n,1,1]:[n,1,2,n,1,2,n,1,1],blocks:chooseBlocks},
 {name:'entry',role:0,parameters:[1],result:1,registers:3,range:p.entry,registerTypes:[1,n,1],
  blocks:[b([[0,1]],[row(26,0,0,1,p.entry),row(240,n,1,0,p.args[0]),
   row(27,1,2,0,p.call,[[1,0]]),row(2,1,2,0,p.entryReturn)])]},
];
const pieces=[];
let offset=80;
const put=bytes=>{pieces.push(bytes);
offset+=bytes.length;
};
const u8=v=>put(Buffer.from([v]));
const u16=v=>{const bytes=Buffer.alloc(2);
bytes.writeUInt16LE(v);
put(bytes);
};
const u32=v=>{const bytes=Buffer.alloc(4);
bytes.writeUInt32LE(v);
put(bytes);
};
const hash=value=>{assert.match(value,/^sha256:[a-f0-9]{64}$/);
put(Buffer.from(value.slice(7),'hex'));
};
const string=value=>{const bytes=Buffer.from(value,'utf8');
u32(bytes.length);
put(bytes);
};
string(hir.target.target);
string(hir.target.triple);
string(hir.target.llvmDataLayout);
for(const v of [4,4,64,8])u16(v);
u32(0);
hash(hir.inputIdentity);
hash(hir.source.hash);
string(hir.source.path);
u32(hir.source.content.length);
u8(0);
u16(2);
const functions=[];
for(const s of specifications){const typeId=handType(s.result),signature=entity('tsfg.core-nullable-candidate.signature.v1',{parameters:s.parameters.map(handType),returnType:typeId}),id=entity('tsfg.core-nullable-candidate.function.v1',{name:s.name,signatureHash:signature,source:{digest:hir.source.hash,path:hir.source.path}});
const old=coreCase.manualPlan.functions.find(f=>f.name===s.name),owned=hir.functions.find(f=>f.name===s.name);
assert.equal(id,old.id);
assert.equal(id,owned.id);
assert.equal(signature,old.signatureHash);
assert.equal(signature,owned.signatureHash);
assert.equal(typeId,old.returnTypeId);
assert.deepEqual(s.range,old.range);
assert.deepEqual(s.range,[owned.range.start,owned.range.end]);
const roleOffset=offset;
u8(s.role);
put(Buffer.alloc(3));
hash(id);
hash(signature);
hash(typeId);
string(s.name);
u32(s.range[0]);
u32(s.range[1]);
const resultOffset=offset;
u8(s.result);
u8(s.parameters.length);
s.parameters.forEach(u8);
u16(s.registers);
u16(s.blocks.length);
u16(s.blocks.reduce((sum,block)=>sum+block.rows.length,0));
const blocks=[];
for(const block of s.blocks){u16(block.parameters.length);
const parameters=block.parameters.map(([register,type])=>{const at=offset;
u16(register);
u8(type);
u8(0);
return{register,type,offset:at};
});
u16(block.rows.length);
blocks.push({parameters,count:block.rows.length});
}const instructions=[];
for(const [blockIndex,block]of s.blocks.entries())for(const op of block.rows){const at=offset;
u8(op.opcode);
u8(op.type);
u16(op.register);
u32(op.immediate);
u32(op.start);
u32(op.end);
for(const edge of op.edges){u16(edge.length);
edge.forEach(u16);
}instructions.push({...op,block:blockIndex,offset:at});
}functions.push({role:s.role,roleOffset,resultOffset,id,signature,typeId,name:s.name,start:s.range[0],end:s.range[1],result:s.result,parameters:s.parameters,registers:s.registers,blocks,instructions,registerTypes:s.registerTypes});
}const payload=Buffer.concat(pieces),header=Buffer.alloc(80);
header.write('TSFGNUL1',0,'ascii');
header.writeUInt32LE(1,8);
Buffer.from(wireSchema,'hex').copy(header,12);
header.writeUInt32LE(offset,44);
createHash('sha256').update(payload).digest().copy(header,48);
const packet=Buffer.concat([header,payload]);
assert.equal(packet.length,offset);
return{packet,view:{inputIdentity:hir.inputIdentity,sourceHash:hir.source.hash,sourcePath:hir.source.path,sourceLength:hir.source.content.length,functions,bytesRead:offset}};
}
