// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {compileHir,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
import {lowerHir} from "../../compiler/hir.mjs";
const own="";
const core=process.env.TSFG_CORE_IR_EXE,vm=process.env.TSFG_VM_EXE;
const source='function choose(value?: i32): i32 { if (value === undefined) { return 7; } return value; } export function entry(): i32 { return choose(undefined); }';
async function input(){const checked=await compileHir(await sourceInput(source),{frontend:process.env.TSFG_FRONTEND_EXE});assert.equal(checked.status,'ok',JSON.stringify(checked));return {text:lowerHir(checked.hir),entry:checked.hir.functions.find(f=>f.name==='entry').id};}
function consume(text,mode){const child=spawnSync(core,[mode],{input:text,windowsHide:true});assert.ifError(child.error);return child;}
function computedState(text,add){
  const call=text.match(/^(\s+)[^\n]* = "func.call"\(([^)]+)\)([^\n]+)$/m);assert.ok(call);
  const operands=call[2].split(',').map(x=>x.trim()),attrs=call[3].match(/tsfg_source.start = (\d+) : i64, tsfg_source.end = (\d+) : i64/);assert.ok(attrs);
  const ranges=`tsfg_source.start = ${attrs[1]} : i64, tsfg_source.end = ${attrs[2]} : i64`;
  const prefix=`${call[1]}%m10probe = "tsfg_core.constant"() {value = ${add} : i32, ${ranges}} : () -> i32\n${call[1]}%m10state = "tsfg_core.add"(${operands[1]}, %m10probe) {${ranges}} : (i32, i32) -> i32\n`;
  const line=call[0].replace(`(${call[2]})`,`(${operands[0]}, %m10state)`);return text.replace(call[0],prefix+line);
}
function alterPayload(text){
  const operands=text.match(/"func.call"\(([^)]+)\)/)[1].split(',').map(x=>x.trim());
  const name=operands[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return text.replace(new RegExp(`(${name} = "tsfg_core.constant"\\(\\) \\{value = )0( : i32)`),(_,prefix,suffix)=>prefix+'9'+suffix);
}
test('dynamic callee presence validation precedes depth, fuel and defaults',async()=>{
  const {text,entry}=await input();
  for(const [add,payload] of [[2,false],[1,false],[0,true]]){
    const dynamic=computedState(payload?alterPayload(text):text,add);
    for(const mode of ['--canonicalize','--optimize']){
      const validated=consume(dynamic,mode);assert.equal(validated.status,0,validated.stderr.toString());
      const packet=consume(validated.stdout,'--emit-bytecode');assert.equal(packet.status,0,packet.stderr.toString());
      const roundtrip=spawnSync(vm,['--roundtrip'],{input:packet.stdout,windowsHide:true});assert.ifError(roundtrip.error);assert.equal(roundtrip.status,0,roundtrip.stderr.toString());
      for(const limits of [{depth:1},{depth:8,semanticFuel:1}]){
        const [actual]=await runBytecode(packet.stdout,{vm,requests:[{functionId:entry,...limits}]});assert.equal(actual.status,'failed',JSON.stringify(actual));assert.equal(actual.code,'r05-presence-state');
        assert.equal(actual.source.path,'/src/main.ts');assert.equal(source.slice(Number(actual.source.start),Number(actual.source.end)).trim(),'choose(undefined)');assert.equal(actual.activeRequests,'0');
      }
    }
  }
});
function descriptorOffsets(bytes){
  let cursor=80;const u8=()=>bytes[cursor++],u16=()=>{const n=bytes.readUInt16LE(cursor);cursor+=2;return n;},u32=()=>{const n=bytes.readUInt32LE(cursor);cursor+=4;return n;};
  const string=()=>{const length=u32();cursor+=length;};for(let i=0;i<3;i++)string();cursor+=8+4+64;string();cursor+=4;
  const rows=[];
  for(let count=u16();count--;){cursor+=96;string();cursor+=8+1;const physicalCountOffset=cursor,physical=u8(),physicalTypesOffset=cursor;cursor+=physical;const logicalCountOffset=cursor,logical=u8(),masksOffset=cursor;cursor+=logical;
    u16();const blocks=u16();u16();const counts=[];for(let i=0;i<blocks;i++){const arity=u16();cursor+=arity*4;counts.push(u16());}
    for(const count of counts)for(let i=0;i<count;i++){const opcode=u8();cursor+=15;if(opcode===28||opcode===32)cursor+=8;for(let group=0;group<(opcode===24||opcode===27?1:opcode===25?2:0);group++){const arity=u16();cursor+=arity*2;}}
    rows.push({physicalCountOffset,physicalTypesOffset,logicalCountOffset,masksOffset,physical,logical});
  }
  assert.equal(cursor,bytes.length);return rows;
}
test('loader refuses impossible masks, state types, logical mappings and old mixed schema',async()=>{
  const packet=consume((await input()).text,'--emit-bytecode');assert.equal(packet.status,0,packet.stderr.toString());const rows=descriptorOffsets(packet.stdout),descriptor=rows.find(row=>row.physical===2&&row.logical===1);assert.ok(descriptor);
  // Current wire contract uses i32=1 and bool=2. The original probe wrote
  // i32 back unchanged and was a reader error, not a loader negative.
  for(const mutate of [b=>b[descriptor.masksOffset]=4,b=>b[descriptor.masksOffset]=2,b=>b[descriptor.physicalTypesOffset+1]=2,b=>b[descriptor.logicalCountOffset]=0,b=>b.writeUInt32LE(9,8),b=>Buffer.alloc(32,0).copy(b,12)]){
    const bytes=Buffer.from(packet.stdout);mutate(bytes);createHash('sha256').update(bytes.subarray(80)).digest().copy(bytes,48);
    const child=spawnSync(vm,['--roundtrip'],{input:bytes,windowsHide:true});assert.ifError(child.error);assert.equal(child.status,3);assert.equal(child.stdout.length,0);assert.match(child.stderr.toString(),/r04-/);
  }
});
