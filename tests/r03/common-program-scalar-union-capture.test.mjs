// SPDX-License-Identifier: MIT
// Complete packets from the independent official Source oracle; no slicing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {canonical,scalarTypeIds,sha256} from '../../compiler/identity.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
const directory=new URL('./testdata/common-scalar-union-capture/',import.meta.url),
  names=readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>name.slice(0,-5)).sort(),
  packet=name=>readCommonProgramFacts(readFileSync(new URL(name+'.json',directory)));

for(const name of names)test('complete official scalar-union shared binding: '+name,()=>{
  const facts=packet(name),hir=projectCommonProgram(facts),
    types=new Map(hir.types.map(type=>[type.id,type])),bindings=hir.functions.flatMap(fn=>[...fn.parameters,...fn.bindings]),
    slots=hir.environments.flatMap(env=>env.slots).filter(slot=>types.get(slot.type)?.kind==='union'),
    original=facts.payload.types.filter(type=>type.kind==='union').map(type=>type.members.map(id=>scalarTypeIds[id]).sort());
  assert.ok(slots.length>0);assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  for(const slot of slots){
    const members=types.get(slot.type).members;
    assert.equal(slot.type,bindings.find(binding=>binding.id===slot.binding).type);
    assert.ok(members.length>=2&&members.every(id=>types.get(id).kind==='scalar'));
    assert.ok(original.some(ids=>canonical(ids)===canonical(members)));
  }
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()},
    program=commonProgramCore(hir,publication,request,{borrowProof:true});
  assert.ok(program.borrowProof);assert.match(program.text,/tsfg_program.env_load/);
  for(const slot of slots){
    const carrier=program.representation.bindings.find(row=>row.id===slot.binding).carrier,
      domain=program.representation.domains.find(row=>row.id===carrier),members=types.get(slot.type).members,
      actual=domain?.actualTypes??[carrier];
    assert.ok(actual.every(id=>members.includes(id)));
    if(domain){assert.equal(domain.referenceCount,0);if(actual.length>1)assert.equal(domain.tagBytes,2);}
  }
  if(process.env.TSFG_SCALAR_UNION_CORE_ROOT){
    mkdirSync(process.env.TSFG_SCALAR_UNION_CORE_ROOT,{recursive:true});
    for(const [suffix,text]of [['.mlir',program.text],['.proof.json',canonical(program.borrowProof)+'\n'],['.owned.json',canonical({hir,publication,request})+'\n']]){
      const path=process.env.TSFG_SCALAR_UNION_CORE_ROOT+'/'+name+suffix;
      if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);else writeFileSync(path,text,{flag:'wx'});
    }
  }
});

for(const change of ['owner','type','members','const-writable','entry'])test('cold genuine scalar-union Source rejects '+change,()=>{
  const value=structuredClone(packet(change==='const-writable'?'local-const':change==='entry'?'parameter':'local-let')),
    owner=value.payload.functions.find(fn=>[...fn.parameters,...fn.bindings].some(binding=>binding.name==='held')),
    held=[...owner.parameters,...owner.bindings].find(binding=>binding.name==='held');
  if(change==='owner')held.lexicalOwner=value.payload.functions.find(fn=>fn.name==='readOwned').id;
  if(change==='type')held.declaredType='i32';
  if(change==='members')value.payload.types.find(type=>type.id===held.declaredType).members.reverse();
  if(change==='const-writable')held.writable=true;
  if(change==='entry')value.payload.entryCompatibilityRoots.push({functionId:owner.id,parameterBinding:held.id,viewType:held.declaredType,
    origin:{source:owner.sourcePath,...held.declarationRange},roots:[]});
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>readCommonProgramFacts(Buffer.from(canonical(value)+'\n')),e=>e instanceof Error&&'code'in e&&e.code===({
    owner:'r03-common-program-lexical',type:'r03-common-program-source',members:'r03-typed-array-type',
    'const-writable':'r03-common-program-binding',entry:'r03-common-program-compatibility-entry'
  })[change]);
});

for(const change of ['key','owner','binding','type','activation','parent'])test('cold genuine scalar-union slot rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('local-let'))),types=new Map(hir.types.map(type=>[type.id,type])),
    env=hir.environments.find(env=>env.slots.some(slot=>types.get(slot.type)?.kind==='union')),
    slot=env.slots.find(slot=>types.get(slot.type)?.kind==='union'),reader=hir.functions.find(fn=>fn.name==='readOwned');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=reader.id;
  if(change==='binding')slot.binding='foreign-binding';if(change==='type')slot.type=types.get(slot.type).members[0];
  if(change==='activation')reader.activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  assert.throws(()=>verifyCommonProgramHir(hir),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-reconstruct');
});

test('scalar-union sibling writes retain complete Published capture authority',()=>{
  const hir=projectCommonProgram(packet('local-let')),publication=structuredClone(createCommonProgramPublication(hir)),
    writer=hir.functions.find(fn=>fn.name==='writeOwned'),contract=publication.contracts.find(row=>row.functionId===writer.id),
    capture=contract.upper.captures.find(row=>row.write);assert.ok(capture);capture.write=false;
  const {digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);
  publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
  assert.throws(()=>commonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(root=>root.kind==='kernel').map(root=>root.target).sort()}),
    e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});
