// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,verifyHir,printHir,readHir} from '../../compiler/hir.mjs';
import {admittedConversionScope,admittedInputScope} from '../../compiler/conversions.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {prepareFrontendInput} from '../../compiler/frontend-response.mjs';
import {moduleDefaultFacts} from './m18-module-facts.mjs';

// Actual M10 full149 Snapshot bytes, rebuilt by the current public HIR0.13 builder.
// Source Snapshot bytes, checker facts, signatures and Source bodies remain original.
const bytes=await readFile(new URL('./testdata/formal-cold-profile/owned-snapshot-hir.json',import.meta.url));
assert.equal(sha256(bytes),'sha256:5f22b4e99e09737ef6d58c544fc44a107d8fc0b6dc9d0c00ea52a9f837af8ae7');
const baseline=JSON.parse(bytes.toString('utf8'));

function moduleScopedPair(auxiliary){
  const pair=structuredClone(baseline),scope=structuredClone(pair.hir.inputScope);
  if(auxiliary){
    scope.files.push({path:'/src/aux.ts',content:'export function leaf(value:i32):i32{return value;}\n'});
    scope.files.sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  }
  scope.compilationClosure={roots:[{kind:'application',sourcePath:auxiliary?'/src/aux.ts':scope.rootFile,name:auxiliary?'leaf':'entry'}],requiredRoots:[]};
  const identity=sha256(canonical(scope)),priorInput=pair.hir.inputIdentity,priorSnapshot=pair.snapshot.snapshotId;
  pair.hir.inputScope=structuredClone(scope);pair.snapshot.identityInput=structuredClone(scope);
  if(auxiliary)pair.snapshot.inputs.push({path:'/src/aux.ts',sha256:sha256(scope.files.find(file=>file.path==='/src/aux.ts').content),kind:'declaration-dependency'});
  const nextSnapshot=sha256(canonical({contractVersion:pair.snapshot.contractVersion,schemaHash:pair.snapshot.schemaHash,inputIdentity:identity,frontendSource:pair.snapshot.frontendSource}));
  const pending=[pair];
  while(pending.length){
    const value=pending.pop();
    for(const [key,child] of Object.entries(value)){
      if(key==='inputIdentity'&&child===priorInput)value[key]=identity;
      else if(key==='snapshotId'&&child===priorSnapshot)value[key]=nextSnapshot;
      else if(child&&typeof child==='object')pending.push(child);
    }
  }
  return pair;
}

test('actual formal Snapshot0.10 and builder-owned HIR0.13 retain their cold public roundtrip',()=>{
  assert.doesNotThrow(()=>validateFrontendSnapshot(baseline.snapshot));
  assert.equal(buildHir(baseline.snapshot).status,'ok');
  assert.doesNotThrow(()=>verifyHir(baseline.hir));
  assert.equal(printHir(readHir(Buffer.from(printHir(baseline.hir)))),printHir(baseline.hir));
});

test('formal Snapshot and buildHir reject rehashed module contexts while normalized VFS remains available',()=>{
  for(const auxiliary of [false,true]){
    const pair=moduleScopedPair(auxiliary),scope=pair.snapshot.identityInput;
    assert.equal(admittedInputScope(scope,pair.snapshot.inputIdentity),true);
    assert.equal(admittedConversionScope(scope,pair.snapshot.inputIdentity),true);
    assert.throws(()=>validateFrontendSnapshot(pair.snapshot),/snapshot contract/);
    assert.equal(buildHir(pair.snapshot).status,'error');
  }
});

test('formal HIR verify, read and print reject a module root absent from the function-only contract',()=>{
  for(const auxiliary of [false,true]){
    const {hir}=moduleScopedPair(auxiliary);
    assert.deepEqual(hir.functions.map(fn=>fn.name),['entry']);
    assert.equal(admittedInputScope(hir.inputScope,hir.inputIdentity),true);
    assert.throws(()=>verifyHir(hir),/r03-hir-invalid/);
    assert.throws(()=>readHir(Buffer.from(canonical(hir)+'\n')),/r03-hir-invalid/);
    assert.throws(()=>printHir(hir),/r03-hir-invalid/);
  }
});

test('registered Source compilation rejects module scope before transport',async t=>{
  const pipeline=new URL('../../compiler/pipeline.mjs?formal-profile-test',import.meta.url);
  const frontend=new URL('../../compiler/frontend.mjs?formal-profile-test',import.meta.url);
  const execution=new URL('../../compiler/frontend-execution.mjs?formal-profile-test',import.meta.url);
  const {snapshot,hir}=baseline,request=snapshot.identityInput;
  // Strip only adapter-owned fields to feed the original scalar facts to the spy.
  const adapterFields=new Set(['ref','node','typeRef','returnTypeRef','inputIdentity']);
  function facts(value){
    if(Array.isArray(value))return value.map(facts);
    if(!value||typeof value!=='object')return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key,child])=>adapterFields.has(key)?[]:
      [[key,key==='symbol'&&child?.snapshotId?child.id:facts(child)]]));
  }
  const response=Buffer.from(JSON.stringify({status:'ok',inputs:snapshot.inputs.map(row=>row.path),
    functions:facts(snapshot.functions),symbols:facts(snapshot.symbols),diagnostics:[]}));
  const calls=[],spy=Symbol.for('tsfg.test.formal-profile-transport');
  globalThis[spy]=input=>{
    const submitted=JSON.parse(input);calls.push(submitted);
    if(Object.hasOwn(submitted,'compilationClosure'))return {status:'tool-error',message:'unexpected registered transport call'};
    return {status:'ok',stdout:response,frontendSource:snapshot.frontendSource};
  };
  const hook=registerHooks({
    resolve(specifier,context,next){
      if(context.parentURL===pipeline.href&&specifier==='./frontend.mjs')return {url:frontend.href,shortCircuit:true};
      if(context.parentURL===frontend.href&&specifier==='./frontend-execution.mjs')return {url:execution.href,shortCircuit:true};
      return next(specifier,context);
    },
    load(url,context,next){
      if(url!==execution.href)return next(url,context);
      return {format:'module',shortCircuit:true,source:
        "export async function runLockedFrontend(input){return globalThis[Symbol.for('tsfg.test.formal-profile-transport')](input);}"};
    },
  });
  t.after(()=>{hook.deregister();delete globalThis[spy];});
  const {compileHir}=await import(pipeline.href);
  assert.deepEqual(await compileHir(request,{frontend:'offline-spy'}),{status:'ok',hir});
  assert.deepEqual(calls.splice(0),[request]);

  const {input,prepared,snapshot:offline}=await moduleDefaultFacts({unrooted:true});
  assert.equal(offline.modules.length,3);
  const singleFileModule=moduleScopedPair(false).snapshot.identityInput;
  for(const [scope,identity]of [[input,prepared.inputIdentity],[singleFileModule,sha256(canonical(singleFileModule))]]){
    assert.deepEqual(await compileHir(scope,{frontend:'offline-spy'}),{
      status:'tool-error',inputIdentity:identity,message:'frontend snapshot 0.10.0 requires the single-file function-only profile',
    });
  }
  const malformed={...input,config:{...input.config,noEmit:false}};
  assert.deepEqual(await compileHir(malformed,{frontend:'offline-spy'}),await prepareFrontendInput(malformed));
  assert.deepEqual(calls,[]);
});
