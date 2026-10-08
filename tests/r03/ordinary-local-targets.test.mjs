// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import test from "node:test";
import {compileProgram,compileHir,sourceInput,runBytecode} from "../../compiler/pipeline.mjs";
import {printHir,readHir} from "../../compiler/hir.mjs";
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
const cases=[
  ["export function entry(): i32 { let value: i32 = 1; value += 1; return value; }","2"],
  ["export function entry(): i32 { let value: i32 = 1; value++; return value; }","2"],
  ["export function entry(value: i32): i32 { return value += 1; }","4"],
  ["export function entry(value: i32): i32 { return value &= value; }","3"],
  ["export function entry(value: i32): i32 { return ++value; }","4"],
  ["export function entry(value: i32): i32 { return value++; }","3"],
  ["export function entry(value: i32): i32 { const next: i32 = value += 1; return next; }","4"],
  ["export function entry(): i32 { let value: i32; ((value)) ??= 7; return (value)++; }","7"],
  ["export function entry(): i32 { let value: i32 | undefined; ((value)) = 7; return ++(value); }","8"],
  ["export function entry(): i32 { let value: i32 = 3; (value) += ((value) = 4); return value; }","7"],
  ["export function entry(): i32 { let value: i32; (value) = 8; return --(value); }","7"],
  ["export function entry(): bool { let value: bool = false; ((value)) ||= true; return value; }",true],
  ["export function entry(): bool { let value: bool = true; ((value)) &&= false; return value; }",false],
];
test("current scalar context executes historical ordinary forms and actual parenthesized local targets",async()=>{
  for(const [source,value] of cases)for(const optimize of [false,true]){
    const program=await compileProgram(await sourceInput(source),{...tools(),optimize});assert.equal(program.status,"ok",JSON.stringify({source,program}));
    assert.deepEqual(readHir(Buffer.from(printHir(program.hir))),program.hir);
    const entry=program.hir.functions.find(f=>f.name==="entry");
    const [actual]=await runBytecode(program.bytecode,{...tools(),requests:[{functionId:entry.id,arguments:entry.parameters.length?[{type:"i32",value:"3"}]:[],depth:16}]});
    assert.equal(actual.status,"returned",JSON.stringify(actual));assert.deepEqual(actual.result,{type:entry.returnType.name,value});
  }
});
test("grouped targets preserve official definite assignment and immutable binding diagnostics",async()=>{
  for(const [source,upstream] of [
    ["export function entry(): i32 { let value: i32; return (value)++; }",2454],
    ["export function entry(): i32 { const value: i32 = 1; (value)++; return value; }",2588],
  ]){
    const result=await compileHir(await sourceInput(source),tools());assert.equal(result.status,"error");assert.ok(result.diagnostics.some(d=>d.upstreamCode===upstream));assert.equal(result.hir,undefined);
  }
  const power=await compileProgram(await sourceInput("export function entry(value: i32): i32 { return value **= 2; }"),tools());
  assert.equal(power.status,"error");assert.equal(power.diagnostics[0].code,"r02b-d-unsupported");assert.equal(power.bytecode,undefined);
});
test("cold HIR validates every explicit target group before assigning an uninitialized local",async()=>{
  const source="export function entry(): i32 { let value: i32; ((value)) ??= 7; return value; }";
  const program=await compileHir(await sourceInput(source),tools());assert.equal(program.status,"ok",JSON.stringify(program));
  for(const mutate of [
    target=>target.kind="unary",
    target=>target.type="sha256:"+"0".repeat(64),
    target=>target.range.start++,
    target=>target.operand.range.end--,
  ]){
    const altered=structuredClone(program.hir);mutate(altered.functions[0].body[1].value.left);
    assert.throws(()=>readHir(Buffer.from(JSON.stringify(altered))));
  }
});
