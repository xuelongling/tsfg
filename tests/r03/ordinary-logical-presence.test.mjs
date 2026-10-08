// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {compileProgram,compileHir,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
import {printHir,readHir} from "../../compiler/hir.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
test("bare bool logical writes preserve private initialization and never expose an ordinary uninitialized read",async()=>{
  for(const [source,expected]of [
    ["export function entry(): bool { let value: bool; value &&= (1 / 0 === 0); return false; }",false],
    ["export function entry(): bool { let value: bool | null; value &&= (1 / 0 === 0); return false; }",false],
    ["export function entry(): bool { let value: bool | undefined; value &&= (1 / 0 === 0); if (value === undefined) { return false; } return value; }",false],
    ["export function entry(): bool { let value: bool; value ||= true; return value; }",true],
    ["export function entry(): bool { let value: bool | null; value ||= true; return value; }",true],
  ])for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify(program));
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,depth:16}]});
    assert.equal(actual.status,"returned");assert.deepEqual(actual.result,{type:"bool",value:expected});assert.equal(actual.activeRequests,"0");
  }
  const source="export function entry(): bool { let value: bool; value &&= true; return value; }";
  const rejected=await compileHir(await sourceInput(source),tools());assert.equal(rejected.status,"error");assert.ok(rejected.diagnostics.some(d=>d.upstreamCode===2454));
});
const cases=[
  ["export function entry(value?: bool): bool { value ||= true; return value; }",[],true],
  ["export function entry(value?: bool): bool { value &&= false; if (value === undefined) { return true; } return value; }",[],true],
  ["export function entry(value: bool | null = null): bool { value ||= true; return value; }",[],true],
  ["export function entry(value: bool | null = null): bool { value &&= true; if (value === null) { return true; } return value; }",[],true],
  ["export function entry(value?: bool): bool { value &&= false; if (value === undefined) { return true; } return value; }",[{type:"bool",value:true}],false],
  ["export function entry(value?: bool): bool { value ||= false; return value; }",[{type:"bool",value:false}],false],
  ["export function entry(value?: bool): bool { value ||= false; return value; }",[{type:"bool",value:true}],true],
  ["export function entry(): i32 { let count: i32 = 0; let value: bool | undefined = undefined; value ||= (++count === 1); return count; }",[],"1"],
  ["export function entry(value?: bool): bool { value &&= (1 / 0 === 0); if (value === undefined) { return true; } return value; }",[],true],
  ["export function entry(value: bool = false): bool { value &&= (1 / 0 === 0); return value; }",[],false],
  ["export function entry(value: bool = true): bool { value ||= (1 / 0 === 0); return value; }",[],true],
  ["export function entry(value?: bool): bool { if (value === undefined) { value = false; } value ||= true; return value; }",[],true],
  ["export function entry(): bool { let value: bool; value ||= true; return value; }",[],true],
];
test("logical presence targets retain absent states, short circuit once and exact whole result facts",async()=>{
  for(const [source,args,value] of cases)for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    assert.deepEqual(readHir(Buffer.from(printHir(program.hir))),program.hir);
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,arguments:args,depth:16}]});
    assert.equal(actual.status,"returned",JSON.stringify({source,actual}));assert.deepEqual(actual.result,{type:typeof value==="string"?"i32":"bool",value});
  }
});
test("a required logical RHS trap retains source identity and invalid whole results retain official diagnostics",async()=>{
  const source="export function entry(value?: bool): bool { value ||= (1 / 0 === 0); return value; }";
  const program=await compileProgram(await sourceInput(source),tools());assert.equal(program.status,"ok",JSON.stringify(program));
  const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:program.hir.functions[0].id,depth:16}]});
  assert.equal(actual.code,"r01-t-divide-zero");assert.equal(source.slice(Number(actual.source.start),Number(actual.source.end)),"1 / 0");
  for(const [source,upstream] of [
    ["export function entry(value?: bool): bool { return value &&= false; }",2322],
    ["export function entry(value: bool | null): bool { return value &&= true; }",2322],
    ["export function entry(value?: bool): bool { value ||= 0; return value; }",2322],
    ["export function entry(): bool { const value: bool = false; value ||= true; return value; }",2588],
  ]){
    const rejected=await compileHir(await sourceInput(source),tools());assert.equal(rejected.status,"error");assert.ok(rejected.diagnostics.some(d=>d.upstreamCode===upstream));assert.equal(rejected.hir,undefined);
  }
});
test("cold logical result facts reject absent, narrowed and widened fake whole-expression roles",async()=>{
  for(const operator of ["&&=","||="]){
    const source=`export function entry(value?: bool): bool { value ${operator} true; if (value === undefined) { return false; } return value; }`;
    const program=await compileHir(await sourceInput(source),tools());assert.equal(program.status,"ok",JSON.stringify(program));
    for(const mutate of [
      write=>delete write.presenceFlow,
      write=>write.presenceFlow.undefined=!write.presenceFlow.undefined,
      write=>write.left.presenceFlow.undefined=false,
    ]){
      const altered=structuredClone(program.hir);mutate(altered.functions[0].body[0].value);
      assert.throws(()=>readHir(Buffer.from(JSON.stringify(altered))));
    }
  }
});
