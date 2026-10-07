// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {compileHir,sourceInput,compileProgram,runBytecode,runRequestSequence,createCompilerSession} from '../../compiler/pipeline.mjs';
import {lowerHir,printHir,readHir,verifyHir} from '../../compiler/hir.mjs';
import {sha256,canonical} from '../../compiler/identity.mjs';
const tools=()=>({frontend:process.env.TSFG_FRONTEND_EXE,core:process.env.TSFG_CORE_IR_EXE,vm:process.env.TSFG_VM_EXE});
const forward='export function entry(a: i32, b: bool): bool { return target(a, b); } export function target(x: i32, y: bool): bool { return y; }';
const countdown='export function entry(n: i32): i32 { if (n === 0) return n; let next: i32 = n - 1; return entry(next); }';
const mutual='export function even(n: i32): bool { if (n === 0) return true; let next: i32 = n - 1; return odd(next); } export function odd(n: i32): bool { if (n === 0) return false; let next: i32 = n - 1; return even(next); }';
const nested='export function entry(): i32 { return outer(leaf()); } export function outer(n: i32): i32 { return n; } export function leaf(): i32 { return 42; }';
const trailing='export function entry(): i32 { return outer(leaf(), /*tail*/); } export function outer(n: i32, /*tail*/): i32 { return n; } export function leaf(): i32 { return 42; }';
const i32=value=>({type:'i32',value:String(value)});
const compile=async source=>{const result=await compileProgram(await sourceInput(source),tools());assert.equal(result.status,'ok',JSON.stringify(result));return result;};
const range=(source,outcome)=>source.slice(Number(outcome.source.start),Number(outcome.source.end)).trim();
test('official forward signatures and typed arguments survive owned HIR roundtrip',async()=>{
  const result=await compileHir(await sourceInput(forward),tools());
  assert.equal(result.status,'ok',JSON.stringify(result));
  const hir=readHir(Buffer.from(printHir(result.hir)));
  assert.equal(hir.functions.length,2);
  assert.equal(hir.functions[0].parameters.length,2);
  assert.equal(hir.functions[0].body[0].value.target,hir.functions[1].id);
  assert.match(lowerHir(hir),/func.call/);
  const bad=structuredClone(hir);bad.functions[0].body[0].value.signatureHash=hir.inputIdentity;
  assert.throws(()=>verifyHir(bad),/r03-hir-invalid/);
});

test('owned calls and parameter lists retain a single legal trailing comma',async()=>{
  const source=trailing;
  const compiled=await compileHir(await sourceInput(source),tools());assert.equal(compiled.status,'ok',JSON.stringify(compiled));
  const hir=readHir(Buffer.from(printHir(compiled.hir)));assert.match(lowerHir(hir),/func.call/);
  for(const [needle,replacement]of [['leaf(),','leaf(),,'],['n: i32,','n: i32,,']]){
    const malformed=structuredClone(hir),position=malformed.source.content.indexOf(needle)+needle.length;
    malformed.source.content=malformed.source.content.replace(needle,replacement);
    malformed.source.hash=sha256(malformed.source.content);
    malformed.inputScope.files.find(file=>file.path===malformed.source.path).content=malformed.source.content;
    malformed.inputIdentity=sha256(canonical(malformed.inputScope));
    const shift=value=>{if(value&&typeof value==='object'){if(Object.hasOwn(value,'start')&&Object.hasOwn(value,'end')){if(value.start>=position)value.start++;if(value.end>=position)value.end++;}else for(const child of Object.values(value))shift(child);}};
    shift(malformed.functions);
    assert.throws(()=>verifyHir(malformed),/r03-hir-invalid/);assert.throws(()=>lowerHir(malformed),/r03-hir-invalid/);
    assert.throws(()=>readHir(Buffer.from(JSON.stringify(malformed))),/r03-hir-invalid/);
  }
});

test('formal forward and recursive return values use typed arguments and independently enumerated entries',async()=>{
  for(const [source,arguments_,result,cost,depth] of [
    [forward,[i32(42),{type:'bool',value:true}],{type:'bool',value:true},2,2],
    [countdown,[i32(2)],{type:'i32',value:'0'},3,3],
    [mutual,[i32(3)],{type:'bool',value:false},4,4],
    [mutual,[i32(2)],{type:'bool',value:true},3,3],
    [nested,[],{type:'i32',value:'42'},3,2],
    [trailing,[],{type:'i32',value:'42'},3,2],
  ]){
    const compiled=await compile(source);
    const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{arguments:arguments_,depth,semanticFuel:cost}]});
    assert.deepEqual(outcome.result,result);assert.equal(outcome.fuelConsumed,String(cost));assert.equal(outcome.fuelRemaining,'0');assert.equal(outcome.activeRequests,'0');
  }
});

test('depth rejects the next callee before entry fuel and nested argument calls release active depth',async()=>{
  const compiled=await compile(countdown);
  const outcomes=await runBytecode(compiled.bytecode,{...tools(),requests:[
    {arguments:[i32(2)],depth:2,semanticFuel:2},
    {arguments:[i32(2)],depth:3,semanticFuel:2},
    {arguments:[i32(2)],depth:3,semanticFuel:3},
  ]});
  assert.equal(outcomes[0].code,'r01-t-depth');assert.deepEqual(outcomes[0].ruleIds,['r01-depth']);assert.equal(outcomes[0].fuelConsumed,'2');
  assert.equal(outcomes[1].code,'r01-t-fuel');assert.equal(outcomes[1].fuelConsumed,'2');
  for(const failure of outcomes.slice(0,2)){assert.equal(failure.functionId,compiled.hir.functions[0].id);assert.equal(range(countdown,failure),countdown);}
  assert.deepEqual(outcomes[2].result,{type:'i32',value:'0'});
  const call=await compile(nested);
  const [depthFailure,fuelFailure,returned]=await runBytecode(call.bytecode,{...tools(),requests:[{depth:1,semanticFuel:1},{depth:2,semanticFuel:2},{depth:2,semanticFuel:3}]});
  assert.equal(depthFailure.code,'r01-t-depth');assert.equal(depthFailure.functionId,call.hir.functions[2].id);assert.equal(depthFailure.fuelConsumed,'1');
  assert.equal(fuelFailure.code,'r01-t-fuel');assert.equal(fuelFailure.functionId,call.hir.functions[1].id);assert.equal(fuelFailure.fuelConsumed,'2');
  assert.equal(range(nested,fuelFailure),'export function outer(n: i32): i32 { return n; }');
  assert.deepEqual(returned.result,{type:'i32',value:'42'});
});

test('recursive arithmetic results and raw scalar arguments are checked by the real producer before execution',async()=>{
  const source='export function factorial(n: i32): i32 { if (n === 0) return 1; return n * factorial(n - 1); }';
  const compiled=await compile(source);
  const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{arguments:[i32(5)],depth:6,semanticFuel:6}]});
  assert.deepEqual(outcome.result,{type:'i32',value:'120'});assert.equal(outcome.fuelConsumed,'6');
});

test('formal source carries all 64 ordered scalar arguments and rejects the next parameter boundary',async()=>{
  const parameters=Array.from({length:64},(_,index)=>`p${index}: i32`).join(', ');
  const arguments_=Array.from({length:64},(_,index)=>String(index)).join(', ');
  const source=`export function entry(): i32 { return target(${arguments_}); } export function target(${parameters}): i32 { return p63; }`;
  const compiled=await compile(source);
  const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{depth:2,semanticFuel:2}]});
  assert.deepEqual(outcome.result,{type:'i32',value:'63'});assert.equal(outcome.fuelConsumed,'2');
  const unsupported=await compileHir(await sourceInput(`export function target(${parameters}, extra: i32): i32 { return extra; }`),tools());
  assert.equal(unsupported.status,'error');assert.equal(unsupported.diagnostics[0].code,'r03-d-capability');
});

test('caller arguments run left to right before depth and callee entry events',async()=>{
  for(const [left,right,code,spelling] of [['1 / 0','1 << 32','r01-t-divide-zero','1 / 0'],['1 << 32','1 / 0','r01-t-shift-count','1 << 32']]){
    const source=`export function entry(): i32 { return target(${left}, ${right}); } export function target(a: i32, b: i32): i32 { return a; }`;
    const compiled=await compile(source);
    const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{depth:1,semanticFuel:1}]});
    assert.equal(outcome.code,code);assert.equal(outcome.functionId,compiled.hir.functions[0].id);assert.equal(range(source,outcome),spelling);assert.equal(outcome.fuelConsumed,'1');
  }
  const source='export function entry(): i32 { return target(42); } export function target(n: i32): i32 { return n / 0; }';
  const compiled=await compile(source);
  const [outcome]=await runBytecode(compiled.bytecode,{...tools(),requests:[{depth:2,semanticFuel:2}]});
  assert.equal(outcome.code,'r01-t-divide-zero');assert.equal(outcome.functionId,compiled.hir.functions[1].id);assert.equal(range(source,outcome),'n / 0');assert.equal(outcome.fuelConsumed,'2');
});

test('typed host preflight rejects malformed values, arity, signatures and foreign identities before events',async()=>{
  const compiled=await compile(forward);
  const good={arguments:[i32(42),{type:'bool',value:false}],depth:2,semanticFuel:2};
  /** @type {Array<[object,string]>} */
  const cases=[
    [{arguments:[]},'r05-request-arguments'],
    [{arguments:[{type:'i32',value:'042'},{type:'bool',value:false}]},'r05-request-arguments'],
    [{arguments:[{type:'i32',value:'2147483648'},{type:'bool',value:false}]},'r05-request-arguments'],
    [{arguments:[i32(42),{type:'bool',value:1}]},'r05-request-arguments'],
    [{arguments:[i32(42),{type:'bool',value:false,extra:0}]},'r05-request-arguments'],
    [{functionId:'0'.repeat(64)},'r05-request-function'],
    [{signatureHash:compiled.hir.functions[0].id},'r05-request-signature'],
  ];
  const outcomes=await runBytecode(compiled.bytecode,{...tools(),requests:cases.flatMap(([change])=>[{...good,...change,depth:0,semanticFuel:0},good])});
  for(const [index,[,code]] of cases.entries()){
    assert.equal(outcomes[index*2].code,code);assert.equal(outcomes[index*2].fuelConsumed,'0');assert.equal(outcomes[index*2].activeRequests,'0');
    assert.deepEqual(outcomes[index*2+1].result,{type:'bool',value:false});assert.equal(outcomes[index*2+1].activeRequests,'0');
  }
  const target=compiled.hir.functions[1];
  const [explicit]=await runBytecode(compiled.bytecode,{...tools(),requests:[{functionId:target.id,signatureHash:target.signatureHash,arguments:[i32(-3),{type:'bool',value:true}],semanticFuel:1}]});
  assert.deepEqual(explicit.result,{type:'bool',value:true});assert.equal(explicit.fuelConsumed,'1');
});

test('deep recursion uses bounded Runtime frames and cleans every abort or trap before a later request',async()=>{
  const compiled=await compile(countdown);
  const outcomes=await runBytecode(compiled.bytecode,{...tools(),requests:[
    {arguments:[i32(1000)],depth:1001,semanticFuel:1001,instructionBudget:20000,memoryBytes:1048576},
    {arguments:[i32(1000)],depth:1001,semanticFuel:1001,instructionBudget:20000,memoryBytes:512},
    {arguments:[i32(2)],depth:3,semanticFuel:3,instructionBudget:2},
    {arguments:[i32(2)],depth:3,semanticFuel:3},
  ]});
  assert.deepEqual(outcomes[0].result,{type:'i32',value:'0'});assert.equal(outcomes[0].fuelConsumed,'1001');
  for(const outcome of outcomes.slice(1,3)){assert.equal(outcome.code,'r05-execution-abort');assert.equal(outcome.category,'execution-abort');}
  assert.deepEqual(outcomes[3].result,{type:'i32',value:'0'});for(const outcome of outcomes)assert.equal(outcome.activeRequests,'0');
  const good=await compile(nested);
  const sequence=await runRequestSequence([compiled.bytecode,good.bytecode],{...tools(),requests:[{arguments:[i32(2)],depth:2},{depth:2,semanticFuel:3}]});
  assert.equal(sequence[0].code,'r01-t-depth');assert.deepEqual(sequence[1].result,{type:'i32',value:'42'});
});

test('call source metamorphisms retain logical identities and full/incremental/optimized event equivalence',async()=>{
  const session=createCompilerSession(tools());
  let nestedIdentities;
  for(const source of [nested,'/*😀*/ '+nested.replace('outer(leaf())','outer(/*ordered*/ leaf())'),mutual]){
    const input=await sourceInput(source),full=await compileProgram(input,tools()),incremental=await session.compile(input),optimized=await compileProgram(input,{...tools(),optimize:true});
    for(const result of [full,incremental,optimized])assert.equal(result.status,'ok',JSON.stringify(result));
    if(!source.includes('even')){
      const identities=full.hir.functions.map(fn=>({name:fn.name,id:fn.id,signatureHash:fn.signatureHash}));
      if(nestedIdentities)assert.deepEqual(identities,nestedIdentities);else nestedIdentities=identities;
    }
    assert.deepEqual(incremental.hir,full.hir);assert.equal(incremental.core,full.core);assert.deepEqual(incremental.bytecode,full.bytecode);
    assert.deepEqual((await session.compile(input)).bytecode,full.bytecode);
    assert.deepEqual(await runBytecode(full.bytecode,{...tools(),command:'--roundtrip'}),full.bytecode);
    const request=source.includes('even')?{arguments:[i32(3)],depth:4,semanticFuel:3}:{depth:2,semanticFuel:2};
    const expected=await runBytecode(full.bytecode,{...tools(),requests:[request]});
    assert.equal(expected[0].code,'r01-t-fuel');
    assert.deepEqual(await runBytecode(incremental.bytecode,{...tools(),requests:[request]}),expected);
    assert.deepEqual(await runBytecode(optimized.bytecode,{...tools(),requests:[request]}),expected);
  }
  assert.deepEqual(session.statistics(),{analyses:6,lowerings:3,reuses:3});
});

test('owned call closure rejects forged foreign targets, parameter and source signatures before lowering',async()=>{
  const checked=await compileHir(await sourceInput(forward),tools());assert.equal(checked.status,'ok',JSON.stringify(checked));
  for(const change of [
    hir=>{hir.functions[0].body[0].value.target=hir.inputIdentity;},
    hir=>{hir.functions[0].body[0].value.arguments.reverse();},
    hir=>{hir.functions[0].body[0].value.arguments.pop();},
    hir=>{hir.functions[0].parameters[0].id='p1';},
    hir=>{hir.functions[0].parameters[0].type=hir.functions[0].parameters[1].type;},
    hir=>{hir.functions[1].id=hir.functions[0].id;},
    hir=>{hir.functions[0].parameters[0].range=hir.functions[1].parameters[0].range;},
    hir=>{hir.source.content=hir.source.content.replace('return target','return ta get');hir.source.hash=sha256(Buffer.from(hir.source.content));},
    hir=>{hir.source.content=hir.source.content.replace('function target','function ta get');hir.source.hash=sha256(Buffer.from(hir.source.content));},
  ]){const malformed=structuredClone(checked.hir);change(malformed);malformed.inputScope.files.find(file=>file.path===malformed.source.path).content=malformed.source.content;malformed.inputIdentity=sha256(canonical(malformed.inputScope));assert.throws(()=>verifyHir(malformed),/r03-hir-invalid/);assert.throws(()=>lowerHir(malformed),/r03-hir-invalid/);}
});
