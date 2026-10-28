// SPDX-License-Identifier: MIT
// Exact qualified common Source captures, retaining their original package bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts,verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir,verifyCommonProgramHir,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const names=['positive','reachable-managed','reference-value','mixed'];
const bytes=new Map(await Promise.all(names.map(async name=>/** @type {[string,Buffer]} */([name,await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url))]))));
const facts=new Map([...bytes].map(([name,raw])=>[name,readCommonProgramFacts(raw)]));
const context=name=>({family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes.get(name),expectedPackageId:facts.get(name).packageId});
const hirs=new Map([...facts].map(([name,value])=>[name,buildCommonProgramHir(value,context(name))]));

for(const name of names)test('complete real common Source to cold owned HIR: '+name,()=>{
  const hir=hirs.get(name);assert.deepEqual(hir.functions.map(fn=>fn.name).sort(),name==='mixed'?['add','bump','left','ordinary','right','run','view']:['add','left','ordinary','right']);
  assert.equal(hir.globals.length,2);assert.equal(hir.modules.length,name==='mixed'?4:1);assert.equal(hir.modules.reduce((n,row)=>n+row.initialization.length,0),2);
  assert.deepEqual(hir.closure.roots.filter(root=>root.kind==='kernel').map(root=>root.name),['left','right']);
  assert.equal(hir.functions.find(fn=>fn.name==='ordinary').body[1].kind,'try');
  assert.equal(hir.types.filter(type=>['value','reference'].includes(type.kind)).length,2);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
});
test('one mixed Program preserves namespace, re-export, ReadSpan and finally joins',()=>{
  const hir=hirs.get('mixed'),path=id=>hir.modules.find(row=>row.initializer===id).sourcePath;
  assert.deepEqual(hir.closure.initialization.map(path),['/src/data.ts','/src/state.ts','/src/barrel.ts','/src/main.ts']);
  assert.equal(hir.functions.find(fn=>fn.name==='ordinary').body[1].finallyBlock.body[0].value.callee,hir.functions.find(fn=>fn.name==='bump').id);
  assert.equal(hir.functions.find(fn=>fn.name==='view').body[0].value.callee,hir.functions.find(fn=>fn.name==='run').id);
  assert.ok(hir.types.some(type=>type.kind==='array'));assert.ok(hir.types.some(type=>type.kind==='readSpan'));
  assert.equal(hir.functions.find(fn=>fn.name==='run').body[1].initializer.callee,'intrinsic:readSpan');
});

test('body edits preserve stable declarations, signatures, GlobalIds and semantic shape',()=>{
  const a=hirs.get('positive'),b=hirs.get('reachable-managed');assert.notEqual(a.inputIdentity,b.inputIdentity);
  for(const fn of a.functions){const other=b.functions.find(row=>row.name===fn.name);assert.equal(fn.id,other.id);assert.equal(fn.signatureHash,other.signatureHash);}
  assert.deepEqual(a.globals.map(row=>row.id),b.globals.map(row=>row.id));
  assert.deepEqual(a.types.map(row=>row.id),b.types.map(row=>row.id));
  assert.notEqual(a.functions.find(fn=>fn.name==='ordinary').sourceBinding,b.functions.find(fn=>fn.name==='ordinary').sourceBinding);
});
test('adding a managed reference to inline value changes stable semantic signature',()=>{
  const a=hirs.get('positive'),b=hirs.get('reference-value');
  for(const name of ['add','left'])assert.notEqual(a.functions.find(fn=>fn.name===name).signatureHash,b.functions.find(fn=>fn.name===name).signatureHash);
  assert.equal(a.functions.find(fn=>fn.name==='right').id,b.functions.find(fn=>fn.name==='right').id);
});
test('selected complete package context cannot be replaced by a different real package',()=>{
  assert.throws(()=>buildCommonProgramHir(facts.get('positive'),context('reachable-managed')),/** @param {any} error */ error=>error.code==='r03-common-program-context');
});
test('semantic HIR is reconstructed independently of retained raw snapshot',()=>{
  const changed=structuredClone(hirs.get('positive'));changed.functions=changed.functions.filter(fn=>fn.name!=='ordinary');
  assert.throws(()=>verifyCommonProgramHir(changed),/** @param {any} error */ error=>error.code==='r03-common-program-reconstruct');
});

function mutated(change) {
  const value=structuredClone(facts.get('positive'));change(value.payload);
  const p=value.payload,tuples=rows=>rows.map(({kind,sourcePath,name})=>({kind,sourcePath,name}));
  const request={family:'tsfg.program-facts-request-candidate',version:2,schemaHash:value.schemaHash,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config,target:p.target,
    compilationClosure:{roots:tuples(p.closure.roots),requiredRoots:tuples(p.closure.requiredRoots)}}};
  value.requestId=sha256('tsfg.program-facts.request.v2\0'+canonical(request)+'\n');
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(p));return value;
}
test('cold verifier rejects ordinary function omission even after matching package hashes',()=>{
  const value=mutated(p=>{const removed=p.functions.find(fn=>fn.name==='ordinary');p.functions=p.functions.filter(fn=>fn!==removed);
    p.exports=p.exports.filter(row=>row.functionId!==removed.id);p.modules[0].exports=p.modules[0].exports.filter(row=>row.target!==removed.id);
    p.closure.roots=p.closure.roots.filter(row=>row.target!==removed.id);p.entryCompatibilityRoots=p.entryCompatibilityRoots.filter(row=>row.functionId!==removed.id);});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-source');
});
test('cold verifier checks actual class permissions rather than trusting changed metadata',()=>{
  const value=mutated(p=>{p.types.find(type=>type.kind==='value').fields[0].access='private';});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-permission');
});
test('catch binding cannot be read before its lexical catch activation',()=>{
  const value=mutated(p=>{const fn=p.functions.find(fn=>fn.name==='ordinary');fn.body[1].tryBlock.body[0].value.binding=fn.bindings.find(b=>b.kind==='catch').id;});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-binding');
});
test('source global reference must join original resolved binding, not a matching scalar type',()=>{
  const value=mutated(p=>{const fn=p.functions.find(fn=>fn.name==='add');fn.body[1].value.binding=p.globals[1].binding.id;});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-binding');
});
test('unknown raw fields and malformed canonical bytes fail before derived publication',()=>{
  const value=structuredClone(facts.get('positive'));value.payload.authority=true;
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-schema');
  assert.throws(()=>readCommonProgramFacts(Buffer.concat([bytes.get('positive'),Buffer.from(' ')])),/** @param {any} error */ error=>error.code==='r03-common-program-canonical');
});
test('behavioral and over-budget objects are rejected before any getter or clone',()=>{
  let read=0;const value={};Object.defineProperty(value,'payload',{enumerable:true,get(){read++;throw Error('getter');}});
  assert.throws(()=>verifyCommonProgramFacts(value),/** @param {any} error */ error=>error.code==='r03-common-program-input');assert.equal(read,0);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>verifyCommonProgramFacts(cyclic));
  assert.throws(()=>verifyCommonProgramFacts({payload:'a'.repeat(2097153)}),/** @param {any} error */ error=>error.code==='r03-common-program-limit');
});
