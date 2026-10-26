// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {commonFactoryModel,commonReferenceBodyModel} from './common-program-model-cases.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {readCommonProgramFacts,verifyCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {createCommonProgramPublication,analyzeCommonProgram,verifyCommonKernelGroup} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const u=sha256('tsfg.type\0undefined');
for(const kind of ['reference','value','nested'])test('private abstract model retains old instances across repeated factory/copy: '+kind,()=>{
  const {program,entryId,loaded}=commonFactoryModel(kind),values=analyzeCommonGraphs(program),actual=values.actual.observed.get(entryId+'/'+loaded);
  assert.ok(actual.tags.has(u),'earlier U instance must survive a later factory result');
  assert.ok([...values.actual.operations].some(([key,row])=>key.startsWith(entryId+'/')&&row.requestTrap));
});
test('private abstract caller loop preserves summarized allocations through a wrapper',()=>{
  const {program,entryId,loaded}=commonFactoryModel('nested',true),values=analyzeCommonGraphs(program);
  assert.ok(values.actual.observed.get(entryId+'/'+loaded).tags.has(u));
});
test('private layout model rejects inherited reference body root and byte overflow',()=>{
  for(const [count,scalar]of /** @type {[number,boolean][]} */([[257,false],[8193,true]])){
    const {program,values}=commonReferenceBodyModel(count,scalar);assert.throws(()=>selectCommonCarriers(program,values),/** @param {any} e */e=>e.code==='r03-common-program-limit');
  }
  for(const [count,scalar]of /** @type {[number,boolean][]} */([[256,false],[8192,true]])){
    const {program,values,wide}=commonReferenceBodyModel(count,scalar),carriers=selectCommonCarriers(program,values);
    assert.equal(carriers.layout(wide).byteSize,8);assert.equal(carriers.layout(wide).referenceCount,1);
    assert.equal(carriers.bodies.get(wide)[scalar?'byteSize':'referenceCount'],scalar?65536:256);
  }
});
test('common unknown catalogue has exactly the builtin ID and a null constructor',async()=>{
  const value=readCommonProgramFacts(await fs.readFile(new URL('./common-program-positive.json',import.meta.url))),mutant=structuredClone(value);
  mutant.payload.types.find(t=>t.kind==='unknown').constructor=structuredClone(mutant.payload.functions[0]);
  mutant.packageId=sha256('tsfg.program-facts.package.v2\0'+mutant.schemaHash+'\0'+canonical(mutant.payload));
  assert.throws(()=>verifyCommonProgramFacts(mutant),/** @param {any} e */e=>e.code==='r03-common-program-unknown-type');
});
test('common cold boundary rejects noncanonical unknown IDs without changing Source or request',async()=>{
  const value=readCommonProgramFacts(await fs.readFile(new URL('./common-program-positive.json',import.meta.url))),mutant=structuredClone(value);
  mutant.payload.types.push({id:'unknownz',kind:'unknown',constructor:null});mutant.payload.types.sort((a,b)=>a.id<b.id?-1:1);
  mutant.packageId=sha256('tsfg.program-facts.package.v2\0'+mutant.schemaHash+'\0'+canonical(mutant.payload));
  assert.equal(mutant.requestId,value.requestId);assert.deepEqual(mutant.payload.files,value.payload.files);
  assert.throws(()=>verifyCommonProgramFacts(mutant),/** @param {any} e */e=>e.code==='r03-common-program-unknown-type');
});
test('real hidden-value whole package accepts the common unknown assertion boundary',async()=>{
  const bytes=await fs.readFile(new URL('./common-program-hidden-value-copy.json',import.meta.url));
  const facts=readCommonProgramFacts(bytes),hir=buildCommonProgramHir(facts,{family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId});
  assert.equal(hir.functions.length,7);assert.ok(hir.types.some(type=>type.name==='Carrier'));
  const physical=commonProgramPhysical(hir),relay=hir.functions.find(fn=>fn.name==='relayHidden'),id=hir.functions.find(fn=>fn.name==='id'),carrier=hir.types.find(t=>t.name==='Carrier');
  const contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===relay.id);assert.ok(contexts.length);
  for(const c of contexts){assert.equal(c.normal,true);assert.equal(c.returned.number,5);}
  const throughId=[...physical.values.actual.contexts.values()].find(c=>c.plan.owner.id===id.id&&c.args[0].tags.has(carrier.id));assert.ok(throughId);
  const box=carrier.fields.find(f=>f.name==='box');
  const before=[...throughId.args[0].refs].flatMap(ref=>[...throughId.entryHeap.get(ref+'/field/'+box.id).refs]).sort();
  const after=[...throughId.returned.refs].flatMap(ref=>[...throughId.normalHeap.get(ref+'/field/'+box.id).refs]).sort();assert.deepEqual(after,before);
  const abi=physical.carriers.functions.get(id.id),domain=physical.carriers.domains.get(abi.parameters[0]);assert.ok(domain.actualTypes.includes(carrier.id));assert.ok(domain.referenceCount>0);
  const publication=createCommonProgramPublication(hir),analysis=analyzeCommonProgram(hir,publication);
  assert.equal(analysis.functions.find(f=>f.functionId===id.id).effective.facets.managedReference,true);
  const positive={targets:hir.closure.roots.filter(r=>['left','right'].includes(r.name)).map(r=>r.target).sort()},negative={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  const core=commonProgramCore(hir,publication,positive);assert.equal((core.text.match(/func\.func @/g)??[]).length,8);
  assert.throws(()=>verifyCommonKernelGroup(hir,publication,negative),/** @param {any} e */e=>e.code==='r03-common-program-kernel-capability');
  const narrow=structuredClone(publication);narrow.contracts.find(c=>c.functionId===id.id).upper.facets.managedReference=false;
  for(const c of narrow.contracts){const {digest,...body}=c;c.digest=commonIdentity('published-contract',body);}
  narrow.expectedDigest=commonIdentity('publication',{scopeDigest:narrow.scopeDigest,contracts:narrow.contracts});
  assert.throws(()=>analyzeCommonProgram(hir,narrow),/** @param {any} e */e=>e.code==='r03-common-program-contract'&&e.functionId===id.id);
});
