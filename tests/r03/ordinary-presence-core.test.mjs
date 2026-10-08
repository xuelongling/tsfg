// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {compileHir,sourceInput} from "../../compiler/pipeline.mjs";
import {lowerHir} from "../../compiler/hir.mjs";

const source="function choose(value?: i32): i32 { if (value === undefined) { return 7; } return value; } export function entry(): i32 { return choose(undefined); }";
async function input() {
  const checked=await compileHir(await sourceInput(source),{frontend:process.env.TSFG_FRONTEND_EXE});
  assert.equal(checked.status,"ok",JSON.stringify(checked));return lowerHir(checked.hir);
}
function consume(text,mode) {
  assert.ok(process.env.TSFG_CORE_IR_EXE);
  const child=spawnSync(process.env.TSFG_CORE_IR_EXE,[mode],{input:text,windowsHide:true});
  assert.ifError(child.error);return child;
}
function alterCallConstant(text,physical,value) {
  const operands=text.match(/"func\.call"\(([^)]+)\)/)[1].split(",").map(x=>x.trim());
  const name=operands[physical].replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp(`(${name} = "tsfg_core.constant"\\(\\) \\{value = )-?\\d+( : i32)`);
  assert.match(text,pattern);return text.replace(pattern,`$1${value}$2`);
}
test("Core commands reject directly known illegal callee states and absent payloads",async()=>{
  const valid=await input();
  for(const mode of ["--canonicalize","--optimize","--emit-bytecode"]) {
    assert.equal(consume(valid,mode).status,0);
    for(const bad of [alterCallConstant(valid,1,3),alterCallConstant(valid,1,2),alterCallConstant(valid,0,9)]) {
      const child=consume(bad,mode);assert.equal(child.status,3,child.stderr.toString());
      assert.equal(child.stdout.length,0);assert.match(child.stderr.toString(),/r04-core-invalid/);
    }
  }
});

// Independent wire reader locates SSA definitions and call arguments; it does
// not derive an expected value by executing source or interpreting bytecode.
function packetInstructions(bytes) {
  let cursor=80;
  const u8=()=>bytes[cursor++],u16=()=>{const n=bytes.readUInt16LE(cursor);cursor+=2;return n;},u32=()=>{const n=bytes.readUInt32LE(cursor);cursor+=4;return n;};
  const string=()=>{const length=u32();cursor+=length;};
  for(let i=0;i<3;i++)string();cursor+=8+4+64;string();cursor+=4;
  const functions=[];
  for(let count=u16();count--;){
    cursor+=96;string();cursor+=8+1;const physical=u8();cursor+=physical;const logical=u8();cursor+=logical;
    u16();const blocks=u16();u16();const counts=[];
    for(let i=0;i<blocks;i++){const arity=u16();cursor+=arity*4;counts.push(u16());}
    const ops=[];
    for(const count of counts)for(let i=0;i<count;i++){
      const offset=cursor,opcode=u8();u8();const register=u16();cursor+=12;
      if(opcode===28||opcode===32)cursor+=8;
      const edges=[];
      for(let group=0;group<(opcode===24||opcode===27?1:opcode===25?2:0);group++)edges.push(Array.from({length:u16()},u16));
      ops.push({offset,opcode,register,edges});
    }
    functions.push(ops);
  }
  assert.equal(cursor,bytes.length);return functions;
}
function vm(bytes,arguments_) {
  const child=spawnSync(process.env.TSFG_VM_EXE,arguments_,{input:bytes,windowsHide:true});
  assert.ifError(child.error);return child;
}
test("loader independently refuses directly known illegal states and nonzero absent payload",async()=>{
  const packet=consume(await input(),"--emit-bytecode");assert.equal(packet.status,0,packet.stderr.toString());
  const instructions=packetInstructions(packet.stdout).find(ops=>ops.some(op=>op.opcode===27));
  const call=instructions.find(op=>op.opcode===27);
  for(const [physical,bits] of [[1,3],[1,2],[0,9]]) {
    const copy=Buffer.from(packet.stdout),constant=instructions.find(op=>op.opcode===1&&op.register===call.edges[0][physical]);
    assert.ok(constant);copy.writeUInt32LE(bits,constant.offset+4);
    createHash("sha256").update(copy.subarray(80)).digest().copy(copy,48);
    const child=vm(copy,["--roundtrip"]);assert.equal(child.status,3,child.stderr.toString());
    assert.equal(child.stdout.length,0);assert.match(child.stderr.toString(),/r04-presence-state/);
  }
});
