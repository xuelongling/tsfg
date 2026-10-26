// SPDX-License-Identifier: MIT
// One new official complete Source package; no synthetic successful Source facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {buildHir,verifyHir,printHir,readHir,lowerHir} from '../../compiler/hir.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {canonical,sha256,i32TypeId} from '../../compiler/identity.mjs';
import {commonEntryReferences} from '../../compiler/common-program-entry.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonMethodModel} from './common-program-model-cases.mjs';
const bytes=await fs.readFile(new URL('./common-program-m12-witness-forward.json',import.meta.url));
assert.equal(sha256(bytes),'sha256:f90d7b2f9566f2a8bd3a9c43ac5fa6cb5d14abbf36a033302a5dd18e3202667d');
const facts=readCommonProgramFacts(bytes),context={family:'tsfg.common-program-context-candidate',version:1,factsBytes:bytes,expectedPackageId:facts.packageId};
const built=buildHir(facts,context);assert.equal(built.status,'ok',JSON.stringify(built));const hir=built.hir;
const fn=name=>hir.functions.find(f=>f.name===name),type=name=>hir.types.find(t=>t.name===name);
let physical;const program=()=>physical??=commonProgramPhysical(hir);
const rootsFor=name=>[...program().values.actual.contexts.values()].filter(c=>c.root&&c.plan.owner.id===fn(name).id);
const parameterRow=(payload,name)=>payload.entryCompatibilityRoots.find(row=>row.functionId===payload.functions.find(f=>f.name===name).id);
const repaired=mutate=>{const changed=structuredClone(facts);mutate(changed.payload);
  changed.packageId=sha256('tsfg.program-facts.package.v1\0'+changed.schemaHash+'\0'+canonical(changed.payload));return Buffer.from(canonical(changed)+'\n');};

test('real M12 package keeps all ordinary functions, constructor, roots and closed relation occurrences',()=>{
  assert.equal(hir.functions.length,9);assert.equal(hir.modules.length,1);assert.equal(hir.globals.length,2);assert.equal(hir.closure.roots.length,7);
  assert.deepEqual(hir.functions.map(f=>f.name).sort(),['add','compatibilityEntry','constructor','convert','derivedEntry','left','ordinary','relationRoundtrip','right']);
  assert.equal(facts.payload.compatibilityWitnesses.length,3);assert.equal(facts.payload.entryCompatibilityRoots.length,6);
  assert.ok(facts.payload.compatibilityWitnesses.every(row=>row.compatibility.members.length===2&&row.dependencies.length===1));
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);assert.deepEqual(verifyHir(hir),hir);
});
test('both actual structural entry candidates are consumed without changing their parameter views',()=>{
  for(const [name,view,other]of [['compatibilityEntry','Y','X'],['relationRoundtrip','X','Y']]){
    const roots=rootsFor(name);assert.equal(roots.length,1);assert.equal(fn(name).parameters[0].type,type(view).id);
    assert.deepEqual([...roots[0].args[0].tags].sort(),[type(view).id,type(other).id].sort());
  }
});
test('each actual backing Array retains the original logical parameter member role recursively',()=>{
  const p=program(),expected=[type('X').id,type('Y').id].sort();
  for(const name of ['compatibilityEntry','relationRoundtrip'])for(const root of rootsFor(name))for(const ref of root.args[0].refs){
    const actual=p.model.types.get(p.values.actual.objects.get(ref).type),field=actual.fields.find(f=>f.name==='next');
    const stored=root.entryHeap.get(ref+'/field/'+field.id);assert.deepEqual([...stored.tags],[field.type]);
    for(const owner of stored.refs){assert.equal(p.values.actual.objects.get(owner).type,field.type);
      assert.deepEqual([...root.entryHeap.get(owner+'/element/*').tags].sort(),expected);
    }
  }
  for(const array of p.model.types.values())if(array.kind==='array'){
    const domain=p.carriers.domains.get(p.carriers.bindings.get('element:'+array.id));assert.deepEqual(domain.actualTypes,expected);
  }
});
test('entry authority remains local to the exported parameter and charges before publishing selectors',()=>{
  const root=rootsFor('convert');assert.equal(root.length,1);assert.deepEqual([...root[0].args[0].tags],[type('X').id]);
  assert.throws(()=>commonEntryReferences(hir,commonMeter(1)),/r03-common-program-limit/);
  let remaining=100000;const spend=(n=1)=>{if(n>remaining)throw new TypeError('entry-work-limit');remaining-=n;};
  const select=commonEntryReferences(hir,spend)(fn('compatibilityEntry').id,fn('compatibilityEntry').parameters[0].id);
  remaining=0;assert.throws(()=>select.sources(type('Y').id),/entry-work-limit/);
});
test('cross-nominal return and call keep actual object identity and access original source fields',()=>{
  const contexts=[...program().values.actual.contexts.values()],x=type('X'),y=type('Y'),field=x.fields.find(f=>f.name==='n');
  const converts=contexts.filter(c=>c.plan.owner.id===fn('convert').id&&!c.root&&c.args[0].tags.has(x.id));assert.ok(converts.length);
  for(const c of converts){assert.equal(c.normal,true);assert.deepEqual(c.returned.tags,c.args[0].tags);assert.deepEqual(c.returned.refs,c.args[0].refs);}
  const readers=contexts.filter(c=>c.plan.owner.id===fn('compatibilityEntry').id&&!c.root&&c.args[0].tags.has(x.id));assert.ok(readers.length);
  for(const c of readers){assert.equal(c.normal,true);assert.deepEqual([...c.returned.tags],[i32TypeId]);
    for(const ref of c.args[0].refs)if(program().values.actual.objects.get(ref).type===x.id){
      assert.ok(c.normalHeap.has(ref+'/field/'+field.id));assert.equal(c.normalHeap.has(ref+'/field/'+y.fields.find(f=>f.name==='n').id),false);
    }}
});
test('implicit derived construction preserves base default, explicit seed call and own initialization order',()=>{
  const p=program(),base=type('Base'),derived=type('Derived'),ctor=hir.functions.find(f=>f.ownerType===base.id),plan=p.plans.find(p=>p.owner.id===fn('derivedEntry').id);
  assert.equal(derived.construction.kind,'implicit-derived');assert.equal(derived.construction.functionId,null);
  assert.equal(derived.construction.implicitForward.parameters.length,1);
  const instructions=plan.graph.blocks.flatMap(b=>b.instructions),baseField=base.fields.find(f=>f.name==='n'),extra=derived.fields.find(f=>f.name==='extra');
  const initial=instructions.findIndex(op=>op.name==='tsfg_program.field_store'&&op.properties.field===baseField.id);
  const invoke=instructions.findIndex(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===ctor.id);
  const own=instructions.findIndex(op=>op.name==='tsfg_program.field_store'&&op.properties.field===extra.id);
  assert.ok(initial>=0&&initial<invoke&&invoke<own);
  assert.ok(rootsFor('derivedEntry').every(c=>c.normal));
});
test('common entry authority rejects private targets, wrong binding, omitted empty row and duplicate order',()=>{
  const mutations=[p=>{parameterRow(p,'compatibilityEntry').functionId=p.functions.find(f=>f.name==='convert').id;},
    p=>{parameterRow(p,'compatibilityEntry').parameterBinding=p.functions.find(f=>f.name==='right').parameters[0].id;},
    p=>{p.entryCompatibilityRoots=p.entryCompatibilityRoots.filter(r=>r.functionId!==p.functions.find(f=>f.name==='derivedEntry').id);},
    p=>{p.entryCompatibilityRoots.reverse();}];
  for(const mutate of mutations)assert.throws(()=>readCommonProgramFacts(repaired(mutate)),/compatibility-(entry|order)/);
});
test('M12 expression closure and implicit forwarding remain strict after outer package hash repair',()=>{
  for(const mutate of [p=>{p.compatibilityWitnesses[0].dependencies=[];},
    p=>{p.functions.find(f=>f.name==='convert').body[0].value.compatibilityRoots=[];},
    p=>{p.types.find(t=>t.name==='Derived').construction.implicitForward.parameters[0].target='invented';}])
    assert.throws(()=>readCommonProgramFacts(repaired(mutate)),/r03-(typed-array|reference)/);
});
test('one complete fixed-publication Core retains the relation consumers and ordinary EH',()=>{
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  const text=lowerHir(hir,context,{publication,request});assert.equal((text.match(/func\.func @/g)??[]).length,10);
  assert.ok(text.includes('tsfg_program.catch_bind'));assert.ok(text.includes('tsfg_program.allocate_reference'));
  assert.ok(text.includes(fn('convert').id));assert.ok(text.includes(fn('ordinary').id));
});
for(const mode of ['override','structural'])test('synthetic actual graph refuses an unimplemented method dispatch: '+mode,()=>{
  assert.throws(()=>analyzeCommonGraphs(commonMethodModel(mode)),/** @param {any} e */e=>
    e.code==='r03-common-program-capability'&&e.functionId==='entry'&&e.primary.sourceId==='/unit-model.ts'&&e.primary.start===0&&e.primary.end===1);
});
test('synthetic actual graph permits inherited methods with the same effective callee',()=>{
  const values=analyzeCommonGraphs(commonMethodModel('inherited'));
  assert.ok([...values.actual.contexts.values()].filter(c=>c.plan.owner.id==='entry').every(c=>c.normal));
});
