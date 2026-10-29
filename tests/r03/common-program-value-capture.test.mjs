// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,printCommonProgramHir,readCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const packet=name=>readCommonProgramFacts(readFileSync(new URL('./testdata/common-value-capture/'+name+'.json',import.meta.url)));
const names=['local-const','local-let','owner-write','sibling-write','sibling-early-write','parameter','parameter-rebind','ancestor','ancestor-rebind','shadow','copy-scalar','return-copy','nested-value','nested-copy','managed-fields','owner-resize','slot-replaced','borrow-slot-replaced','alias-type','named-import','const-field-write','const-managed-field-write'];
for(const name of names)test('complete official nominal value capture retains inline copies in shared environment: '+name,()=>{
  const source=packet(name),hir=projectCommonProgram(source),types=new Map(hir.types.map(t=>[t.id,t])),
    slots=hir.environments.flatMap(e=>e.slots).filter(s=>types.get(s.type)?.kind==='value');
  assert.ok(slots.length>0);
  assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(['owner-resize','borrow-slot-replaced'].includes(name)){
    assert.throws(()=>emitCommonProgramCore(hir,publication,request),e=>e instanceof Error&&'code'in e&&['r03-common-program-borrow-pending','r03-common-program-borrow-conflict'].includes(String(e.code)));return;
  }
  const core=emitCommonProgramCore(hir,publication,request);
  assert.match(core,/tsfg_program.env_load/);assert.match(core,/tsfg_program.construct_value/);assert.match(core,/tsfg_program.value_copy/);
  if(process.env.TSFG_VALUE_CORE_ROOT){mkdirSync(process.env.TSFG_VALUE_CORE_ROOT,{recursive:true});writeFileSync(process.env.TSFG_VALUE_CORE_ROOT+'/'+name+'.mlir',core);}
});
for(const change of ['owner','binding','type','occurrence','entry-root','source-spelling'])test('self-hashed original value capture rejects '+change,()=>{
  const value=structuredClone(packet('parameter')),owner=value.payload.functions.find(f=>f.name==='fromValue'),reader=value.payload.functions.find(f=>f.name==='readOwned'),held=owner.parameters.find(p=>p.name==='held');
  if(change==='owner')held.lexicalOwner=reader.id;
  if(change==='binding')reader.captures[0].binding=value.payload.functions.find(f=>f.name==='makeOwnedReader').parameters[0].id;
  if(change==='type')held.declaredType='i32';
  if(change==='occurrence')reader.captures[0].occurrences[0].range.start++;
  if(change==='entry-root')value.payload.entryCompatibilityRoots.push({functionId:owner.id,parameterBinding:held.id,viewType:held.declaredType,origin:{source:owner.sourcePath,...held.declarationRange},roots:[]});
  if(change==='source-spelling'){
    const source=value.payload.files.find(f=>f.path==='/src/main.ts');source.content=source.content.replace('return held.n;','return seed.n;');source.sha256=sha256(source.content).slice(7);
    for(const type of value.payload.types)if(['reference','value'].includes(type.kind))type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:value.payload.files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  }
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))),e=>e instanceof Error&&'code'in e&&e.code===({owner:'r03-common-program-lexical',binding:'r03-common-program-capture',type:'r03-common-program-source',occurrence:'r03-common-program-capture','entry-root':'r03-common-program-compatibility-entry','source-spelling':'r03-common-program-binding'})[change]);
});
for(const change of ['key','owner','binding','type','activation','parent'])test('cold inline value environment slot rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('local-const'))),types=new Map(hir.types.map(t=>[t.id,t])),env=hir.environments.find(e=>e.slots.some(s=>types.get(s.type)?.kind==='value')),slot=env.slots.find(s=>types.get(s.type)?.kind==='value');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=hir.functions.find(f=>f.name==='left').id;
  if(change==='binding')slot.binding=hir.functions.find(f=>f.name==='left').parameters[0].id;if(change==='type')slot.type=hir.types.find(t=>t.kind==='scalar').id;
  if(change==='activation')hir.functions.find(f=>f.name==='readOwned').activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  assert.throws(()=>verifyCommonProgramHir(hir),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-reconstruct');
});
test('fixed Published original value rebinding write remains authoritative',()=>{
  const hir=projectCommonProgram(packet('sibling-write')),publication=structuredClone(createCommonProgramPublication(hir)),writer=hir.functions.find(f=>f.name==='replace'),contract=publication.contracts.find(c=>c.functionId===writer.id);
  contract.upper.captures.find(c=>c.write).write=false;const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
for(const name of ['const-field-write','const-managed-field-write'])test('fixed const value field writes consume original Published authority: '+name,()=>{
  const hir=projectCommonProgram(packet(name)),publication=structuredClone(createCommonProgramPublication(hir)),reader=hir.functions.find(f=>f.name==='readOwned'),contract=publication.contracts.find(c=>c.functionId===reader.id),slot=hir.environments.flatMap(e=>e.slots).find(s=>reader.captures.some(c=>c.binding===s.binding)&&hir.types.find(t=>t.id===s.type)?.kind==='value');
  assert.equal(slot.writable,false);assert.equal(contract.upper.captures.find(c=>c.slot===slot.key).write,true);
  contract.upper.captures.find(c=>c.slot===slot.key).write=false;const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
for(const name of ['copy-scalar','nested-copy','managed-fields','const-managed-field-write'])test('original actual value copies isolate inline storage and retain managed identities: '+name,()=>{
  const hir=projectCommonProgram(packet(name)),publication=createCommonProgramPublication(hir),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c]))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),reader=hir.functions.find(f=>f.name==='readOwned'),slots=hir.environments.flatMap(e=>e.slots),
    held=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='held').id),old=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='old').id),type=hir.types.find(t=>t.id===held.type),
    contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===reader.id&&!c.repeated);
  assert.ok(contexts.length>0);assert.equal(held.type,old.type);
  const expected=name==='copy-scalar'?{byteSize:4,alignment:4,referenceCount:0}:name==='nested-copy'?{byteSize:8,alignment:4,referenceCount:0}:name==='const-managed-field-write'?{byteSize:24,alignment:8,referenceCount:2}:{byteSize:40,alignment:8,referenceCount:3};
  assert.deepEqual(physical.carriers.layout(type.id),expected);
  assert.deepEqual(type.fields.map(f=>f.name),name==='copy-scalar'?['n']:name==='nested-copy'?['n','inner']:name==='const-managed-field-write'?['n','ref','a']:['n','ref','a','span']);
  for(const context of contexts)for(const environment of context.args[0].refs){
    const current=context.entryHeap.get(environment+'/slot/'+held.key),previous=context.entryHeap.get(environment+'/slot/'+old.key);
    assert.equal(current.unknown,false);assert.equal(previous.unknown,false);assert.ok(current.refs.size>0);assert.ok(previous.refs.size>0);
    assert.ok([...current.refs].every(ref=>!previous.refs.has(ref)));
    for(const ref of [...current.refs,...previous.refs])assert.equal(physical.values.actual.objects.get(ref).type,type.id);
    for(const field of type.fields.filter(f=>['inner','ref','a','span'].includes(f.name))){
      const left=new Set([...current.refs].flatMap(ref=>[...context.entryHeap.get(ref+'/field/'+field.id).refs])),right=new Set([...previous.refs].flatMap(ref=>[...context.entryHeap.get(ref+'/field/'+field.id).refs]));
      assert.ok(left.size>0);assert.ok(right.size>0);
      if(field.name==='inner')assert.ok([...left].every(ref=>!right.has(ref)));
      else assert.deepEqual([...left].sort(),[...right].sort());
    }
  }
});
test('current region versions preserve old value children after replacing the shared slot',()=>{
  const hir=projectCommonProgram(packet('slot-replaced')),publication=createCommonProgramPublication(hir),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c]))),
    owner=hir.functions.find(f=>f.name==='makeOwnedReader'),slots=hir.environments.flatMap(e=>e.slots),held=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='held').id),old=slots.find(s=>s.binding===owner.bindings.find(b=>b.name==='old').id),
    type=hir.types.find(t=>t.id===held.type),contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===owner.id&&c.regionScope&&c.returned.region.roots.size),nodes=physical.values.actual.regions.nodes;
  assert.ok(contexts.length>0);assert.deepEqual(physical.carriers.layout(type.id),{byteSize:40,alignment:8,referenceCount:3});
  for(const context of contexts)for(const environment of context.returned.region.roots){
    const current=context.normalRegions.get(environment).get('slot/'+held.key),previous=context.normalRegions.get(environment).get('slot/'+old.key);
    assert.equal(current.opaque,false);assert.equal(previous.opaque,false);assert.ok(current.roots.size>0);assert.ok(previous.roots.size>0);assert.ok([...current.roots].every(id=>!previous.roots.has(id)));
    for(const field of type.fields.filter(f=>['ref','a','span'].includes(f.name))){
      const left=new Set([...current.roots].flatMap(id=>[...context.normalRegions.get(id).get('field/'+field.id).roots].map(id=>nodes.get(id).reference))),right=new Set([...previous.roots].flatMap(id=>[...context.normalRegions.get(id).get('field/'+field.id).roots].map(id=>nodes.get(id).reference)));
      assert.ok(left.size>0);assert.ok(right.size>0);assert.ok([...left].every(ref=>!right.has(ref)),field.name);
    }
  }
});
