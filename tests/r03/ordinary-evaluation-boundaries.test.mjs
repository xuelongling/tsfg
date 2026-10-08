// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {compileProgram,compileHir,sourceInput,runBytecode,runRequestSequence,createCompilerSession} from "../../compiler/pipeline.mjs";

const tools={frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE};
const i32=value=>({type:'i32',value:String(value)});
async function compiled(source,optimize=false){const result=await compileProgram(await sourceInput(source),{...tools,optimize});assert.equal(result.status,'ok',JSON.stringify(result));return result;}
const request=(program,extra={})=>({functionId:program.hir.functions.find(f=>f.name==='entry').id,depth:16,...extra});
test('64 logical optional parameters accept all 128 counted physical input slots',async()=>{
  const parameters=Array.from({length:64},(_,i)=>`value${i}?: i32`).join(', '),source=`export function entry(${parameters}): i32 { if (value63 === undefined) { return 7; } return value63; }`;
  const program=await compiled(source);
  const [omitted,absent,present,excess]=await runBytecode(program.bytecode,{...tools,requests:[request(program),request(program,{arguments:Array.from({length:64},()=>({type:'undefined',value:null}))}),request(program,{arguments:Array.from({length:64},(_,i)=>i32(i))}),request(program,{arguments:Array.from({length:65},()=>i32(1))})]});
  for(const actual of [omitted,absent]){assert.equal(actual.status,'returned');assert.deepEqual(actual.result,i32(7));}
  assert.equal(present.status,'returned');assert.deepEqual(present.result,i32(63));assert.equal(excess.status,'failed');assert.equal(excess.code,'r05-request-arguments');
  const oversized=await compileHir(await sourceInput(`export function entry(${parameters}, extra?: i32): i32 { return 1; }`),tools);assert.equal(oversized.status,'error');
});
test('state slots, caller frames, transfer slots and shadow locals consume the request memory budget',async()=>{
  const source='function choose(value?: i32): i32 { value ??= 7; if (true) { let shadow: i32; shadow ??= 8; value += shadow; } return value; } export function entry(): i32 { let value: i32; value ??= choose(); return value; }';
  const program=await compiled(source),requests=[request(program,{memoryBytes:1}),request(program,{memoryBytes:128}),request(program)];
  const [tiny,small,normal]=await runBytecode(program.bytecode,{...tools,requests});
  for(const failed of [tiny,small]){assert.equal(failed.status,'failed');assert.equal(failed.code,'r05-execution-abort');assert.equal(failed.activeRequests,'0');}
  assert.equal(normal.status,'returned');assert.deepEqual(normal.result,i32(15));assert.equal(normal.activeRequests,'0');
});
test('caller arguments precede default fuel and defaults retain first trap source identity',async()=>{
  const source='function risky(): i32 { return 1 / 0; } function choose(a: i32 = risky(), b: i32 = 2): i32 { return a + b; } export function entry(): i32 { return choose(undefined, 5 / 0); }';
  const program=await compiled(source);
  const [actual]=await runBytecode(program.bytecode,{...tools,requests:[request(program,{semanticFuel:1})]});
  assert.equal(actual.status,'failed');assert.equal(actual.code,'r01-t-divide-zero');assert.equal(actual.fuelRemaining,'0');assert.equal(actual.fuelConsumed,'1');assert.equal(source.slice(Number(actual.source.start),Number(actual.source.end)).trim(),'5 / 0');
});
test('ordinary absence and update operations retain semantic fuel, depth and failed-request cleanup',async()=>{
  const source='function choose(a: i32 = 1): i32 { return a; } export function entry(): i32 { let value: i32; value ??= choose(); return value++; }';
  const program=await compiled(source);
  const [depth,fuel,exact]=await runBytecode(program.bytecode,{...tools,requests:[request(program,{depth:1,semanticFuel:1}),request(program,{depth:2,semanticFuel:1}),request(program,{depth:2,semanticFuel:2})]});
  assert.equal(depth.code,'r01-t-depth');assert.equal(fuel.code,'r01-t-fuel');assert.equal(exact.status,'returned');assert.deepEqual(exact.result,i32(1));assert.equal(exact.fuelConsumed,'2');
  const results=await runRequestSequence([program.bytecode,program.bytecode,program.bytecode],{...tools,requests:[request(program,{depth:1}),request(program,{instructionBudget:0}),request(program,{depth:2,semanticFuel:2})]});
  assert.equal(results[0].status,'failed');assert.equal(results[1].code,'r05-execution-abort');assert.equal(results[2].status,'returned');for(const result of results)assert.equal(result.activeRequests,'0');
});
test('cold and incremental ordinary compilation agree and failures clear prior memo output',async()=>{
  const source='function choose(value: i32 = 7): i32 { return value; } export function entry(): i32 { let value: i32; value ??= choose(); return value++; }';
  for(const optimize of [false,true]){
    const session=createCompilerSession({...tools,optimize}),input=await sourceInput(source),first=await session.compile(input),second=await session.compile(input),cold=await compiled(source,optimize);
    assert.equal(first.status,'ok');assert.equal(second.status,'ok');assert.deepEqual(second.bytecode,cold.bytecode);assert.equal(session.statistics().reuses,1);
    const invalid=await session.compile(await sourceInput('export function entry(): i32 { let value: i32; return value++; }'));assert.equal(invalid.status,'error');
    const recovered=await session.compile(input);assert.equal(recovered.status,'ok');assert.deepEqual(recovered.bytecode,cold.bytecode);assert.equal(session.statistics().reuses,1);
    const changed=source.replace('= 7','= 9'),updated=await session.compile(await sourceInput(changed)),changedCold=await compiled(changed,optimize);assert.equal(updated.status,'ok');assert.deepEqual(updated.bytecode,changedCold.bytecode);
  }
});
test('nullish canonicalization preserves grouping, decoded bindings and alpha-renamed effects',async()=>{
  for(const source of ['export function entry(): i32 { let value: i32; value ??= 7; return value++; }','export function entry(): i32 { let renamed: i32; (renamed ??= (7)); return (renamed)++; }','export function entry(): i32 { let \\u0076alue: i32; /*once*/value ??= (7); return value++; }']){
    const program=await compiled(source),[actual]=await runBytecode(program.bytecode,{...tools,requests:[request(program)]});assert.equal(actual.status,'returned');assert.deepEqual(actual.result,i32(7));
  }
});
