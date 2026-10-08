// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {compileProgram,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
// Explicit, independent raw payload expectations. Undefined and null use the
// same canonical zero payload in every physical scalar family.
const families=[
  ...["i8","i16","i32","i64","u8","u16","u32","u64","isize","usize"].map(type=>({type,seven:"7",zero:"0",literal:"7",zeroLiteral:"0"})),
  {type:"f32",seven:"40e00000",zero:"00000000",literal:"7",zeroLiteral:"0"},
  {type:"f64",seven:"401c000000000000",zero:"0000000000000000",literal:"7",zeroLiteral:"0"},
  {type:"bool",seven:true,zero:false,literal:"true",zeroLiteral:"false"},
];
test("optional and nullable default presence executes for every admitted scalar payload family",async()=>{
  for(const family of families)for(const optimize of [false,true])for(const optional of [false,true]){
    const source=optional
      ? `export function entry(value?: ${family.type}): ${family.type} { if (value === undefined) { return ${family.literal}; } return value; }`
      : `export function entry(value: ${family.type} | null = ${family.literal}): ${family.type} { if (value === null) { return ${family.zeroLiteral}; } return value; }`;
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const request=argument=>({functionId:program.hir.functions[0].id,depth:16,arguments:argument===undefined?[]:[argument]});
    const requests=[request(),request({type:"undefined",value:null}),request({type:family.type,value:family.zero})];
    if(!optional)requests.push(request({type:"null",value:null}));
    const actual=await runBytecode(program.bytecode,{...tools(),requests});
    for(let index=0;index<actual.length;index++){
      assert.equal(actual[index].status,"returned",JSON.stringify({source,index,actual}));
      assert.deepEqual(actual[index].result,{type:family.type,value:index<2?family.seven:family.zero});
    }
  }
});
test("optional boolean narrowing retains logical assignment effects",async()=>{
  for(const source of [
    "export function entry(value?: bool): bool { if (value === undefined) { value = false; } value ||= true; return value; }",
    "export function entry(value?: bool): bool { if (value === undefined) { return false; } value &&= false; return value; }",
  ]){
    const program=await compileProgram(await sourceInput(source),tools());assert.equal(program.status,"ok",JSON.stringify({source,program}));
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,arguments:[{type:"bool",value:true}],depth:16}]});
    assert.equal(actual.status,"returned");assert.deepEqual(actual.result,{type:"bool",value:source.includes("||=")});
  }
});
