// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateFrontendSnapshot} from '../../compiler/frontend.mjs';
import {buildHir,printHir,readHir,lowerHir,verifyHir} from '../../compiler/hir.mjs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {commonProgramPhysical} from '../../compiler/common-program-physical.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {i32TypeId,boolTypeId,sha256} from '../../compiler/identity.mjs';
const programs=new Map(),undefinedId=sha256('tsfg.type\0undefined');
for(const name of ['positive','reachable-managed','reference-value','mixed','actual-storage']){
  const bytes=await fs.readFile(new URL('./common-program-'+name+'.json',import.meta.url)),facts=readCommonProgramFacts(bytes),context={family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);assert.equal(result.status,'ok');const hir=result.hir,physical=commonProgramPhysical(hir);
  programs.set(name,{facts,context,hir,physical});
}
const fn=(hir,name)=>hir.functions.find(row=>row.name===name);
for(const name of ['positive','mixed'])test('public complete Program lowering preserves every Source function and initializer: '+name,()=>{
  const {facts,context,hir,physical}=programs.get(name);assert.deepEqual(validateFrontendSnapshot(facts),facts);
  assert.deepEqual(readHir(Buffer.from(printHir(hir,context)),context),hir);assert.deepEqual(verifyHir(hir),hir);
  const publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  const text=lowerHir(hir,context,{publication,request});assert.equal((text.match(/func\.func @/g)??[]).length,hir.functions.length+hir.modules.length);
  assert.match(text,/tsfg_program\.program/);assert.match(text,/"tsfg_program\.enter_handler"/);assert.match(text,/"tsfg_program\.catch_bind"/);
  assert.ok(text.includes('"tsfg_program.allocate_reference"'));assert.ok(text.includes('"tsfg_program.value_copy"'));assert.ok(text.includes('"tsfg_program.return_throw"'));
  assert.equal(physical.carriers.layout(fn(hir,'add').parameters[0].type).byteSize,4);
  assert.equal(physical.carriers.layout(fn(hir,'add').parameters[0].type).referenceCount,0);
  assert.throws(()=>lowerHir(hir,context));assert.deepEqual(verifyHir(hir),hir);
});
test('whole reference-bearing value has real entry capacity despite a U default initializer',()=>{
  const {hir,physical}=programs.get('reference-value'),type=physical.model.types.get(fn(hir,'add').parameters[0].type),field=type.fields.find(f=>physical.model.types.get(f.type).kind==='union');
  const domain=physical.carriers.domains.get(physical.carriers.bindings.get(field.sourceBinding));assert.ok(domain.actualTypes.includes(undefinedId));
  assert.equal(domain.referenceCount,1);assert.equal(physical.carriers.layout(type.id).referenceCount,1);
  for(const context of physical.values.actual.contexts.values())if(context.plan.owner.id===fn(hir,'add').id&&context.root){
    const roots=[...context.args[0].refs];assert.ok(roots.some(ref=>[...context.entryHeap].some(([slot,value])=>slot.startsWith(ref+'/field/')&&value.tags.size>1)));
  }
});
test('mixed actual array read keeps i32/U carrier and no fake no-GC ReadSpan',()=>{
  const {hir,physical}=programs.get('mixed'),plan=physical.plans.find(p=>p.owner.id===fn(hir,'run').id),read=plan.graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.array_read');
  const carrier=physical.carriers.registers.get(plan.owner.id).get(read.result),domain=physical.carriers.domains.get(carrier);
  assert.deepEqual(domain.actualTypes,[i32TypeId,undefinedId].sort());assert.equal(domain.byteSize,8);assert.equal(domain.alignment,4);assert.equal(domain.tagBytes,2);
  const array=hir.types.find(t=>t.kind==='array'),span=hir.types.find(t=>t.kind==='readSpan');assert.equal(physical.carriers.bindings.get('element:'+array.id),i32TypeId);
  assert.equal(physical.carriers.layout(span.id).referenceCount,1);
});
test('caught language payload transports actual i32 through assertion and field without a view retag',()=>{
  const {hir,physical}=programs.get('positive'),id=fn(hir,'ordinary').id,plan=physical.plans.find(p=>p.owner.id===id);
  const assertion=plan.graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.assert');assert.ok(assertion);
  const actual=physical.values.actual.observed.get(id+'/'+assertion.result);assert.deepEqual([...actual.tags],[i32TypeId]);assert.equal(actual.unknown,false);
  for(const context of physical.values.actual.contexts.values())if(context.plan.owner.id===id){assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual([...context.returned.tags],[i32TypeId]);}
});
test('mixed numeric consumers are emitted only after both source operand values and never into EH',()=>{
  const {hir,context}=programs.get('mixed'),publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  const text=lowerHir(hir,context,{publication,request}),checks=text.split('\n').filter(line=>line.includes('"tsfg_program.numeric_use"'));
  assert.ok(checks.length>0);for(const line of checks){assert.equal((line.match(/\^numeric\d+/g)??[]).length,1);assert.doesNotMatch(line,/return_throw|handler|finally/);}
  assert.match(text,/"tsfg_program\.finally_enter"/);assert.match(text,/"tsfg_program\.readspan"/);
});
test('Core generation remains failure atomic for invalid fixed publication and does not prune ordinary functions',()=>{
  const {hir,context}=programs.get('positive'),publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()},original=printHir(hir);
  const invalid=structuredClone(publication);invalid.contracts.pop();assert.throws(()=>lowerHir(hir,context,{publication:invalid,request}));
  assert.equal(printHir(hir),original);const text=lowerHir(hir,context,{publication,request});assert.ok(text.includes(fn(hir,'ordinary').id));
});
test('real Bool/U assertions and i32 field storage preserve actual values through ordinary transport',()=>{
  const {hir,physical}=programs.get('actual-storage');assert.equal(hir.functions.length,7);assert.equal(hir.closure.roots.length,6);
  const box=hir.types.find(t=>t.name==='Box'),field=box.fields[0],domain=physical.carriers.domains.get(physical.carriers.bindings.get(field.sourceBinding));
  assert.deepEqual(domain.actualTypes,[i32TypeId,boolTypeId,undefinedId].sort());assert.equal(domain.tagBytes,2);
  const transport=fn(hir,'transportBool');assert.equal(physical.carriers.functions.get(transport.id).result,boolTypeId);
  for(const context of physical.values.actual.contexts.values())if(context.plan.owner.id===transport.id){assert.equal(context.normal,true);assert.equal(context.language,false);assert.deepEqual([...context.returned.tags],[boolTypeId]);}
  const id=fn(hir,'consumeUndefined').id,contexts=[...physical.values.actual.contexts.values()].filter(c=>c.plan.owner.id===id);
  assert.ok(contexts.length);for(const context of contexts){assert.equal(context.normal,false);assert.equal(context.language,false);assert.equal(context.returned.tags.size,0);}
  const operation=[...physical.values.actual.operations].find(([key])=>key.startsWith(id+'/'));assert.ok(operation);assert.equal(operation[1].normal,false);assert.equal(operation[1].requestTrap,true);
});
test('real U numeric consumption follows the RHS side call and has only a normal continuation',()=>{
  const {hir,context,physical}=programs.get('actual-storage'),publication=createCommonProgramPublication(hir),request={targets:hir.closure.roots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};
  const text=lowerHir(hir,context,{publication,request}),id=fn(hir,'consumeUndefined').id,side=fn(hir,'side').id;
  const body=text.slice(text.indexOf('func.func @"program_'+id.slice(7)+'"')).split('\n  }')[0];
  const invoke=body.indexOf('"tsfg_program.invoke"'),numeric=body.indexOf('"tsfg_program.numeric_use"');assert.ok(invoke>=0&&numeric>invoke);assert.ok(body.includes(side));
  const plan=physical.plans.find(p=>p.owner.id===id),call=plan.graph.blocks.flatMap(b=>b.instructions).find(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===side);
  const normal=plan.graph.blocks.find(block=>block.name===call.successors[0]);assert.ok(normal.instructions.some(op=>op.name==='tsfg_program.binary'));
  assert.equal((body.match(/func\.func/g)??[]).length,1);assert.equal((text.match(/func\.func @/g)??[]).length,8);
});
test('real Bool numeric negative reaches actual-domain diagnosis after complete cold owned validation',async()=>{
  const bytes=await fs.readFile(new URL('./common-program-actual-storage-bool-consume.json',import.meta.url)),facts=readCommonProgramFacts(bytes),context={family:'tsfg.common-program-context-candidate',version:2,factsBytes:bytes,expectedPackageId:facts.packageId};
  const result=buildHir(facts,context);assert.equal(result.status,'ok');assert.equal(result.hir.functions.length,7);assert.equal(result.hir.closure.roots.length,6);
  assert.deepEqual(verifyHir(result.hir),result.hir);const transport=fn(result.hir,'transportBool');
  assert.throws(()=>commonProgramPhysical(result.hir),/** @param {any} error */error=>error.code==='r03-common-program-capability'&&error.functionId===transport.id
    &&error.message.includes('actual numeric consumption')&&error.actualTypes.includes(boolTypeId));
  assert.throws(()=>createCommonProgramPublication(result.hir),/** @param {any} error */error=>error.code==='r03-common-program-capability');
});
