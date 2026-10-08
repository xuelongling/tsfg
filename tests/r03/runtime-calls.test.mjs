// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import test from "node:test";

const hash=value=>createHash("sha256").update(value).digest();
const u8=value=>Buffer.from([value]);
const u16=value=>{const bytes=Buffer.alloc(2);bytes.writeUInt16LE(value);return bytes;};
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const str=value=>Buffer.concat([u32(Buffer.byteLength(value)),Buffer.from(value)]);
const scalar=type=>type===1?"i32":"bool";
const signature=types=>hash(`tsfg.signature\0(${types.map(scalar).join(",")})->bool`);
const identity=(name,sig)=>hash(`tsfg.function\0/fixture.ts\0${name}\0${sig.toString("hex")}`);
const instruction=(opcode,type,reg,payload,start,end,args)=>Buffer.concat([
  u8(opcode),u8(type),u16(reg),u32(payload),u32(start),u32(end),
  ...(args===undefined?[]:[u16(args.length),...args.map(u16)]),
]);

// Independently authored R04 bytes. This contains no source or HIR evaluator.
function packet(options={}) {
  const parameters=options.parameters??[1,2];
  const calleeSignature=options.signature??signature(parameters);
  const calleeName=options.name??"callee";
  const callerSignature=signature([1,2]);
  const functionBytes=(name,sig,start,end,types,registers,ops)=>Buffer.concat([
    identity(name,sig),sig,hash("tsfg.type\0bool"),str(name),u32(start),u32(end),u8(2),u8(types.length),...types.map(u8),u8(types.length),...types.map(()=>u8(0)),
    u16(registers),u16(1),u16(ops.length),u16(types.length),
    ...types.map((type,index)=>Buffer.concat([u16(index),u8(type),u8(0)])),u16(ops.length),...ops,
  ]);
  const payload=Buffer.concat([
    str("windows-x86_64-msvc"),str("x86_64-pc-windows-msvc"),
    str("e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"),
    u16(4),u16(4),u16(64),u16(8),u32(52),hash("input"),hash("source"),str("/fixture.ts"),u32(400),u16(2),
    functionBytes("caller",callerSignature,0,100,[1,2],3,[
      instruction(26,0,0,1,0,100),instruction(27,options.resultType??2,2,options.target??1,50,80,options.arguments??[0,1]),
      instruction(2,2,2,0,80,90),
    ]),
    functionBytes(calleeName,calleeSignature,200,300,parameters,2,[
      instruction(options.calleeFuel??26,0,0,1,200,300),instruction(2,2,1,0,250,260),
    ]),
  ]);
  return Buffer.concat([Buffer.from("TSFGTBC0"),u32(10),Buffer.from("6e1a281d385887750208b8ff69339e91407811128ce7ef3e68b43d3b0663c0b8","hex"),u32(80+payload.length),hash(payload),payload]);
}
function invoke(bytes,args=[]) {
  assert.match(process.env.TSFG_VM_EXE,/^E:[\\/]/i);
  const result=spawnSync(process.env.TSFG_VM_EXE,args,{input:bytes,windowsHide:true,timeout:30000,maxBuffer:2**20});
  assert.ifError(result.error);return result;
}
test("public R04 loader verifies all typed functions and preserves the exact multi-function wire",()=>{
  const bytes=packet();const roundtrip=invoke(bytes,["--roundtrip"]);
  assert.equal(roundtrip.status,0,roundtrip.stderr.toString());assert.deepEqual(roundtrip.stdout,bytes);
  const viewResult=invoke(bytes,["--inspect"]);assert.equal(viewResult.status,0,viewResult.stderr.toString());
  const view=JSON.parse(viewResult.stdout.toString());assert.equal(view.functions.length,2);
  assert.deepEqual(view.functions[1].parameterTypes,["i32","bool"]);
  const returned=invoke(bytes,["--requests",JSON.stringify([{arguments:[{type:"i32",value:"42"},{type:"bool",value:true}],depth:2,semanticFuel:2}])]);
  assert.equal(returned.status,0,returned.stderr.toString());const [result]=JSON.parse(returned.stdout.toString());
  assert.deepEqual(result.result,{type:"bool",value:true});assert.equal(result.fuelConsumed,"2");assert.equal(result.activeRequests,"0");
});
test("R04 rejects foreign call targets, malformed signatures, arity, argument types and dominance before requests",()=>{
  for(const [options,code] of [
    [{target:2},"r04-call-target"],[{target:0x10001},"r04-reserved"],
    [{arguments:[0]},"r04-call-arity"],[{arguments:[1,0]},"r04-type"],
    [{arguments:[2,1]},"r04-dominance"],[{arguments:[3,1]},"r04-register"],
    [{signature:hash("forged")},"r04-signature"],[{parameters:[2,1]},"r04-type"],
    [{name:"caller"},"r04-function"],[{calleeFuel:0},"r04-type"],
  ]) {
    const result=invoke(packet(options),["--requests","[{}]"]);
    assert.equal(result.status,3,JSON.stringify(options));assert.equal(result.stdout.length,0);
    assert.equal(JSON.parse(result.stderr.toString()).code,code,JSON.stringify(options));
  }
});
