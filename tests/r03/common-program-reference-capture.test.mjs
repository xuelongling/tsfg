// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const packet=name=>readCommonProgramFacts(readFileSync(new URL('./testdata/common-reference-capture/'+name+'.json',import.meta.url)));
function reseal(value){
  const p=value.payload;
  for(const type of p.types)if(['reference','value'].includes(type.kind))type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:p.files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));
  const request={family:'tsfg.program-facts-request-candidate',version:2,schemaHash:value.schemaHash,input:{sourceRoot:p.sourceRoot,rootFile:p.rootFile,
    files:p.files.map(({path,content,sha256})=>({path,content,sha256})),declarations:p.declarations,config:p.config,target:p.target,
    compilationClosure:{roots:p.closure.roots.map(({kind,sourcePath,name})=>({kind,sourcePath,name})),requiredRoots:p.closure.requiredRoots.map(({kind,sourcePath,name})=>({kind,sourcePath,name}))},
    hostImports:p.hostImports.map(({sourcePath,name,capabilityId,parameterTypes,returnType})=>({sourcePath,name,capabilityId,parameterTypes,returnType}))}};
  value.requestId=sha256('tsfg.program-facts.request.v2\0'+canonical(request)+'\n');value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(p));
}
const names=['local-const','local-let','owner-write','sibling-write','sibling-early-write','parameter','ancestor','shadow','alias-field-write','inheritance','ancestor-rebind','alias-type','parameter-rebind','const-field-write','array-span-readonly','owner-resize','slot-replaced','named-import','exported-entry','array-span-inherited','array-span-writable-field','inherited-throw','branch-owner-mismatch','method-sequence','method-language','capture-language'];
for(const name of names)test('complete official nominal reference original capture to fixed Published and Core: '+name,()=>{
  const source=packet(name),hir=projectCommonProgram(source),types=new Map(hir.types.map(t=>[t.id,t])),
    slots=hir.environments.flatMap(e=>e.slots).filter(s=>types.get(s.type)?.kind==='reference');
  assert.equal(slots.length,['alias-field-write','exported-entry'].includes(name)?2:1);
  const original=source.payload.functions.flatMap(f=>[...f.parameters,...f.bindings]).find(b=>b.name==='held'&&slots.some(s=>s.binding===b.id)),slot=slots.find(s=>s.binding===original.id),binding=original;
  assert.equal(binding.name,'held');assert.equal(slot.writable,['local-let','owner-write','sibling-write','sibling-early-write','parameter','ancestor-rebind','parameter-rebind','slot-replaced'].includes(name));assert.equal(slot.kind,['parameter','parameter-rebind'].includes(name)?'parameter':'local');
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(['owner-resize','slot-replaced','array-span-writable-field','branch-owner-mismatch'].includes(name)){assert.throws(()=>emitCommonProgramCore(hir,publication,request),e=>e instanceof Error&&'code' in e&&e.code==='r03-common-program-borrow-pending');return;}
  const core=emitCommonProgramCore(hir,publication,request),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(r=>[r.functionId,r])));
  assert.match(core,/tsfg_program.env_load/);assert.match(core,/tsfg_program.field/);
  assert.equal(physical.carriers.layout(slot.type).referenceCount,1);assert.equal(physical.carriers.layout(slot.type).byteSize,8);
  if(['array-span-readonly','array-span-inherited','inherited-throw'].includes(name)){
    assert.deepEqual(physical.carriers.bodies.get(slot.type),{byteSize:24,alignment:8,referenceCount:2});
    assert.ok(physical.values.actual.borrows);
  }
  if(name==='alias-field-write'){
    const plan=physical.plans.find(p=>p.owner.name==='readOwned'),loads=plan.graph.blocks.flatMap(b=>b.instructions).filter(op=>op.name==='tsfg_program.env_load'&&op.view===slot.type),
      held=loads.find(op=>op.properties.binding===binding.id),alias=loads.find(op=>op.properties.binding!==binding.id),
      original=physical.values.actual.observed.get(plan.owner.id+'/'+held.result),copied=physical.values.actual.observed.get(plan.owner.id+'/'+alias.result);
    assert.equal(original.unknown,false);assert.equal(copied.unknown,false);assert.ok(original.refs.size>0);
    assert.deepEqual([...original.refs].sort(),[...copied.refs].sort());
    for(const ref of original.refs)assert.equal(physical.values.actual.objects.get(ref).type,slot.type);
  }
  if(['sibling-write','sibling-early-write','capture-language'].includes(name)){
    const shared=hir.functions.flatMap(f=>f.captures).filter(c=>c.binding===binding.id);assert.equal(shared.length,2);
    assert.ok(publication.contracts.flatMap(c=>c.upper.captures).some(c=>c.slot===slot.key&&c.write));
  }
  if(process.env.TSFG_REFERENCE_CORE_ROOT){mkdirSync(process.env.TSFG_REFERENCE_CORE_ROOT,{recursive:true});writeFileSync(process.env.TSFG_REFERENCE_CORE_ROOT+'/'+name+'.mlir',core);}
});

for(const change of ['owner','binding','type','occurrence','entry-root','source-spelling'])test('self-hashed cold original reference rejects '+change,()=>{
  const value=structuredClone(packet('parameter')),owner=value.payload.functions.find(f=>f.name==='relayHeld'),reader=value.payload.functions.find(f=>f.name==='readOwned'),held=owner.parameters.find(p=>p.name==='held');
  if(change==='owner')held.lexicalOwner=reader.id;
  if(change==='binding')reader.captures[0].binding=value.payload.functions.find(f=>f.name==='makeOwnedReader').parameters[0].id;
  if(change==='type')held.declaredType='i32';
  if(change==='occurrence')reader.captures[0].occurrences[0].range.start++;
  if(change==='entry-root')value.payload.entryCompatibilityRoots.push({functionId:owner.id,parameterBinding:held.id,viewType:held.declaredType,origin:{source:owner.sourcePath,...held.declarationRange},roots:[]});
  if(change==='source-spelling'){const source=value.payload.files.find(f=>f.path==='/src/main.ts');source.content=source.content.replace('return held.n;','return seed.n;');source.sha256=sha256(source.content).slice(7);
    for(const type of value.payload.types)if(['reference','value'].includes(type.kind))type.runtimeKey=sha256('tsfg.array-facts.runtime-class.v8\0'+canonical({files:value.payload.files.map(({path,sha256})=>({path,sha256})),nominalKey:type.nominalKey}));}
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))),e=>{
    if(!(e instanceof Error)||!('code'in e))return false;
    console.log('cold original '+change+': '+e.code);
    return e.code===({owner:'r03-common-program-lexical',binding:'r03-common-program-capture',type:'r03-common-program-source',occurrence:'r03-common-program-capture','entry-root':'r03-common-program-compatibility-entry','source-spelling':'r03-common-program-binding'})[change];
  });
});
for(const change of ['foreign-alias','wrong-module-owner'])test('cold named import preserves original nominal alias '+change,()=>{
  const value=structuredClone(packet('named-import')),edge=value.payload.modules.find(m=>m.sourcePath==='/src/main.ts').imports.find(e=>e.sourcePath==='/src/held.ts'),alias=edge.bindings[0];
  if(change==='foreign-alias')alias.name='ForeignHeld';else alias.targetSourcePath='/src/main.ts';
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))),e=>e instanceof Error&&'code'in e&&e.code===(change==='foreign-alias'?'r03-common-program-source':'r03-common-program-module'));
});
for(const change of ['specifier','resolved-target','keyword','imported-token','alias-token','from-token','target-kind'])test('self-hashed nominal import token provenance rejects '+change,()=>{
  const value=structuredClone(packet('named-import')),p=value.payload,file=p.files.find(f=>f.path==='/src/main.ts'),edge=p.modules.find(m=>m.sourcePath==='/src/main.ts').imports[0];
  const original=value.requestId;reseal(value);assert.equal(value.requestId,original);
  if(change==='specifier'||change==='resolved-target'){file.content=file.content.replace('from "./held"','from "./fake"');if(change==='resolved-target')edge.specifier='./fake';}
  if(change==='keyword')file.content=file.content.replace('import { Held as ImportedHeld }','export { Held as ImportedHeld }');
  if(change==='imported-token')file.content=file.content.replace('{ Held as ImportedHeld }','{ Fled as ImportedHeld }');
  if(change==='alias-token')file.content=file.content.replace('{ Held as ImportedHeld }','{ Held xx ImportedHeld }');
  if(change==='from-token')file.content=file.content.replace('from "./held"','with "./held"');
  if(change==='target-kind')edge.bindings[0].kind='global';
  file.sha256=sha256(file.content).slice(7);
  reseal(value);
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(value)+'\n')),e=>e instanceof Error&&'code'in e&&e.code===(['imported-token','alias-token'].includes(change)?'r03-common-program-source':'r03-common-program-module'));
});
test('current official namespace and re-export modules preserve concrete reference Program',()=>{
  const source=packet('namespace-module'),hir=projectCommonProgram(source),publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  assert.equal(source.payload.files.length,5);assert.equal(source.payload.modules.length,4);
  assert.ok(source.payload.modules.some(m=>m.imports.some(e=>e.bindings.some(a=>a.kind==='namespace'&&a.imported==='*'))));
  assert.ok(hir.types.some(t=>t.kind==='reference'));assert.match(emitCommonProgramCore(hir,publication,request),/tsfg_program.invoke/);
});
test('self-hashed namespace imported name cannot replace original star',()=>{
  const value=structuredClone(packet('namespace-module')),original=value.requestId;reseal(value);assert.equal(value.requestId,original);
  const alias=value.payload.modules.flatMap(m=>m.imports).flatMap(e=>e.bindings).find(a=>a.kind==='namespace');assert.equal(alias.imported,'*');alias.imported='foreign';reseal(value);
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(value)+'\n')),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-module');
});
for(const change of ['key','owner','binding','type','activation','parent'])test('cold owned reference slot rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('local-const'))),types=new Map(hir.types.map(t=>[t.id,t])),env=hir.environments.find(e=>e.slots.some(s=>types.get(s.type)?.kind==='reference')),slot=env.slots.find(s=>types.get(s.type)?.kind==='reference');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=hir.functions.find(f=>f.name==='left').id;
  if(change==='binding')slot.binding=hir.functions.find(f=>f.name==='left').parameters[0].id;if(change==='type')slot.type=hir.types.find(t=>t.kind==='scalar').id;
  if(change==='activation')hir.functions.find(f=>f.name==='readOwned').activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  assert.throws(()=>verifyCommonProgramHir(hir),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-reconstruct');
});
test('fixed Published reference field write remains authoritative',()=>{
  const hir=projectCommonProgram(packet('const-field-write')),publication=structuredClone(createCommonProgramPublication(hir)),reader=hir.functions.find(f=>f.name==='readOwned'),contract=publication.contracts.find(c=>c.functionId===reader.id);
  contract.upper.captures.find(c=>c.write).write=false;const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);
  publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
for(const permission of ['structural','escape','unknownHost'])test('fixed reference holding cannot discard '+permission+' permission',()=>{
  const hir=projectCommonProgram(packet('array-span-readonly')),publication=structuredClone(createCommonProgramPublication(hir)),reader=hir.functions.find(f=>f.name==='readOwned'),contract=publication.contracts.find(c=>c.functionId===reader.id);
  if(permission==='structural')contract.upper.captures[0].structural=true;else contract.upper.facets[permission]=true;
  const{digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&['r03-common-program-borrow-pending','r03-common-program-borrow-conflict'].includes(String(e.code)));
});
