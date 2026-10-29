// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram,verifyCommonProgramHir,readCommonProgramHir,printCommonProgramHir} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {commonIdentity} from '../../compiler/common-program-identities.mjs';
import {canonical,sha256} from '../../compiler/identity.mjs';
const packet=name=>readCommonProgramFacts(readFileSync(new URL('./testdata/common-nullable-capture/'+name+'.json',import.meta.url)));
const names=readdirSync(new URL('./testdata/common-nullable-capture/',import.meta.url)).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5)).sort();

test('the complete official nullable family has 108 unsliced Program packets',()=>assert.equal(names.length,108));
for(const name of names)test('complete official nullable capture retains its logical shared slot: '+name,()=>{
  const facts=packet(name),hir=projectCommonProgram(facts),types=new Map(hir.types.map(t=>[t.id,t])),
    slots=hir.environments.flatMap(e=>e.slots).filter(s=>types.get(s.type)?.kind==='union');
  assert.ok(slots.length>0);assert.deepEqual(readCommonProgramHir(Buffer.from(printCommonProgramHir(hir))),hir);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  if(['value-span','value-span-safe','value-span-conflict'].includes(name)){
    // The returned sibling closure transports the complete activation. Its
    // nullable Spanned slot still contains a descriptor without an owning edge.
    assert.throws(()=>emitCommonProgramCore(hir,publication,request),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-borrow-pending');return;
  }
  const core=emitCommonProgramCore(hir,publication,request),physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c])));
  for(const slot of slots){
    assert.equal(types.get(slot.type).kind,'union');
    assert.ok(physical.carriers.bindings.has(slot.binding));
  }
  assert.match(core,/tsfg_program.env_load/);
  if(process.env.TSFG_NULLABLE_CORE_ROOT){mkdirSync(process.env.TSFG_NULLABLE_CORE_ROOT,{recursive:true});writeFileSync(process.env.TSFG_NULLABLE_CORE_ROOT+'/'+name+'.mlir',core);}
});

for(const change of ['owner','type','occurrence','entry'])test('cold original nullable capture rejects '+change,()=>{
  const value=structuredClone(packet('null-parameter')),owner=value.payload.functions.find(f=>f.name==='fromValue'),reader=value.payload.functions.find(f=>f.name==='readOwned'),held=owner.parameters.find(p=>p.name==='held');
  if(change==='owner')held.lexicalOwner=reader.id;if(change==='type')held.declaredType='i32';
  if(change==='occurrence')reader.captures[0].occurrences[0].range.start++;
  if(change==='entry')value.payload.entryCompatibilityRoots.push({functionId:owner.id,parameterBinding:held.id,viewType:held.declaredType,origin:{source:owner.sourcePath,...held.declarationRange},roots:[]});
  value.packageId=sha256('tsfg.program-facts.package.v2\0'+value.schemaHash+'\0'+canonical(value.payload));
  assert.throws(()=>projectCommonProgram(readCommonProgramFacts(Buffer.from(canonical(value)+'\n'))),e=>e instanceof Error&&'code'in e&&e.code===({owner:'r03-common-program-lexical',type:'r03-common-program-source',occurrence:'r03-common-program-capture',entry:'r03-common-program-compatibility-entry'})[change]);
});

for(const change of ['key','owner','binding','type','activation','parent'])test('cold nullable environment rejects '+change,()=>{
  const hir=structuredClone(projectCommonProgram(packet('null-parameter'))),types=new Map(hir.types.map(t=>[t.id,t])),
    env=hir.environments.find(e=>e.slots.some(s=>types.get(s.type)?.kind==='union')),slot=env.slots.find(s=>types.get(s.type)?.kind==='union');
  if(change==='key')slot.key='foreign-slot';if(change==='owner')env.owner=hir.functions.find(f=>f.name==='readOwned').id;
  if(change==='binding')slot.binding='foreign-binding';if(change==='type')slot.type=hir.types.find(t=>t.kind==='scalar').id;
  if(change==='activation')hir.functions.find(f=>f.name==='readOwned').activationEnvironment=env.id;if(change==='parent')env.parent='foreign-layout';
  assert.throws(()=>verifyCommonProgramHir(hir),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-reconstruct');
});

function rehash(publication,contract){
  const {digest,...body}=contract;contract.digest=commonIdentity('published-contract',body);
  publication.expectedDigest=commonIdentity('publication',{scopeDigest:publication.scopeDigest,contracts:publication.contracts});
}
for(const change of ['missing-upper','signature','index'])test('fixed nullable callable original bound rejects '+change,()=>{
  const hir=projectCommonProgram(packet('function-null-parameter')),publication=structuredClone(createCommonProgramPublication(hir)),
    owner=hir.functions.find(f=>f.name==='fromNullable'),contract=publication.contracts.find(c=>c.functionId===owner.id),parameter=contract.callables.parameters[0];
  assert.equal(parameter.index,0);assert.ok(parameter.allowed.functions.length>0);
  if(change==='missing-upper')parameter.allowed.functions=[];
  if(change==='signature')parameter.allowed.functions=[hir.functions.find(f=>f.name==='left').id];
  if(change==='index')parameter.index=1;rehash(publication,contract);
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-callable-contract');
});

test('fixed nullable slot rebindings retain complete Published write authority',()=>{
  const hir=projectCommonProgram(packet('sibling-rebind')),publication=structuredClone(createCommonProgramPublication(hir)),writer=hir.functions.find(f=>f.name==='writeOwned'),
    contract=publication.contracts.find(c=>c.functionId===writer.id),capture=contract.upper.captures.find(c=>c.write);
  assert.ok(capture);capture.write=false;rehash(publication,contract);
  assert.throws(()=>emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()}),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-contract');
});

for(const absence of ['null','undefined'])test('actual inactive nullable callable has an empty code set: '+absence,()=>{
  const hir=projectCommonProgram(packet('function-'+absence+'-parameter-inactive-'+absence)),publication=createCommonProgramPublication(hir),
    owner=hir.functions.find(f=>f.name==='fromNullable'),contract=publication.contracts.find(c=>c.functionId===owner.id);
  assert.deepEqual(contract.callables.parameters,[{index:0,allowed:{top:false,functions:[]}}]);
  const physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c]))),type=hir.types.find(t=>t.kind===absence).id,
    slot=hir.environments.flatMap(e=>e.slots).find(s=>s.binding===owner.parameters[0].id),reader=hir.functions.find(f=>f.name==='readOwned'),
    inputs=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===reader.id).flatMap(c=>[...c.args[0].refs].map(ref=>c.entryHeap.get(ref+'/slot/'+slot.key))).filter(value=>value.tags.size===1&&value.tags.has(type));
  assert.ok(inputs.length>0);for(const input of inputs){assert.equal(input.refs.size,0);assert.equal(input.pairs.size,0);assert.equal(input.unknown,false);}
});

test('actual unreachable presence condition keeps bottom until its declared bool consumer adapter',()=>{
  const hir=projectCommonProgram(packet('reference-null-undefined-parameter-inactive-null')),publication=createCommonProgramPublication(hir),
    physical=commonProgramPhysical(hir,new Map(publication.contracts.map(c=>[c.functionId,c])));
  const conditions=physical.plans.flatMap(plan=>plan.graph.blocks.flatMap(block=>block.instructions.filter(op=>op.name==='cf.cond_br').map(op=>({
    view:plan.graph.registers.get(op.operands[0]).view,carrier:physical.carriers.registers.get(plan.owner.id).get(op.operands[0])}))));
  assert.ok(conditions.some(row=>physical.carriers.domains.get(row.carrier)?.actualTypes.length===0));
  const core=emitCommonProgramCore(hir,publication,{targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()});
  assert.match(core,/tsfg_program.carrier_cast/);for(const row of conditions)assert.equal(hir.types.find(t=>t.id===row.view).name,'bool');
});

for(const presence of ['null','undefined','null-undefined'])test('root callable TOP retains complete unknown nullable capacity: '+presence,()=>{
  const hir=projectCommonProgram(packet('root-callable-'+presence)),publication=createCommonProgramPublication(hir),
    owner=hir.functions.find(fn=>fn.name==='rootNullableCallable'),parameter=owner.parameters[0],contract=publication.contracts.find(row=>row.functionId===owner.id),
    physical=commonProgramPhysical(hir,new Map(publication.contracts.map(row=>[row.functionId,row]))),type=hir.types.find(row=>row.id===parameter.type);
  assert.deepEqual(contract.callables.parameters,[{index:0,allowed:{top:true,functions:[]}}]);
  assert.equal(type.kind,'union');assert.equal(type.members.filter(id=>hir.types.find(row=>row.id===id).kind==='function').length,1);
  assert.equal(physical.carriers.bindings.get(parameter.id),physical.model.payload);
  assert.equal(physical.carriers.functions.get(owner.id).parameters[0],physical.model.payload);
  const entry=[...physical.values.actual.contexts.values()].find(context=>context.plan.owner.id===owner.id&&context.root).args[0];
  assert.deepEqual([...entry.tags].sort(),[...type.members].sort());assert.equal(entry.unknown,true);
  assert.equal(entry.pairs.size,0);assert.equal(entry.refs.size,0);assert.equal(entry.cells.size,0);
  assert.equal(hir.environments.flatMap(env=>env.slots).find(slot=>slot.binding===parameter.id).type,parameter.type);
});
