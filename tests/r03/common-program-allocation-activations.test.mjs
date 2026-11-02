// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,sha256} from '../../compiler/identity.mjs';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {commonProgramCore} from '../../compiler/common-program-core.mjs';
import {allocationActivationModel,allocationUncertainModel,allocationArgumentContextsModel,allocationFixedSourceInput,allocationFixedFactsRequest,allocationFixedInputPair} from './common-program-allocation-models.mjs';
/** @param {unknown} error */
const borrowPending=error=>error instanceof TypeError&&'code' in error&&error.code==='r03-common-program-borrow-pending';
for(const wrapped of [false,true])test('normalized equal-argument acyclic activations retain distinct physical arrays: '+(wrapped?'wrapper':'direct'),()=>{
  const m=allocationActivationModel(wrapped),flow=analyzeCommonGraphs(m.program),
    root=[...flow.actual.contexts.values()].find(c=>c.plan.owner.id===m.chooser&&c.root),
    environments=[...root.returned.pairs.values()].map(p=>p.environment),owners=new Set();
  assert.equal(environments.length,2);assert.equal(new Set(environments).size,2);
  for(const ref of environments)for(const owner of root.normalHeap.get(ref+'/slot/'+m.ownerSlot).refs)owners.add(owner);
  assert.equal(owners.size,2,'same argument values are not physical allocation identities');
  const checked=allocationActivationModel(wrapped);assert.doesNotThrow(()=>analyzeCommonGraphs(checked.program,checked.records));
});
for(const wrapped of [false,true])test('normalized repeated call site keeps weak allocation origins: '+(wrapped?'wrapper':'direct'),()=>{
  const m=allocationActivationModel(wrapped,'loop'),flow=analyzeCommonGraphs(m.program),
    root=[...flow.actual.contexts.values()].find(c=>c.plan.owner.id===m.chooser&&c.root);
  for(const pair of root.returned.pairs.values())for(const owner of root.normalHeap.get(pair.environment+'/slot/'+m.ownerSlot).refs)
    assert.equal(flow.actual.objects.get(owner).weak,true);
  const checked=allocationActivationModel(wrapped,'loop');assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),borrowPending);
});
test('normalized full Host permission cannot grant an acyclic allocation uniqueness proof',()=>{
  const checked=allocationActivationModel(false,'unknown-host');assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),borrowPending);
});
for(const top of [false,true])test('normalized full target uncertainty is preserved despite an observed closed arm: '+(top?'TOP':'unobserved Host'),()=>{
  const observed=allocationUncertainModel(top),flow=analyzeCommonGraphs(observed.program);
  // Every top-level declaration also has an independent entry context.
  assert.equal([...flow.actual.contexts.values()].some(c=>!c.root&&c.plan.owner.id==='rightFactory'),false);
  assert.equal([...flow.actual.contexts.values()].some(c=>!c.root&&c.plan.owner.id==='leftFactory'),true);
  const checked=allocationUncertainModel(top);assert.throws(()=>analyzeCommonGraphs(checked.program,checked.records),borrowPending);
});
test('normalized distinct argument contexts do not grant distinct physical allocation identities',()=>{
  const m=allocationArgumentContextsModel(),reader=m.program.plans.find(plan=>plan.owner.id===m.reader);assert.ok(reader);
  const allocations=reader.graph.blocks.flatMap(block=>block.instructions).filter(op=>op.result===m.allocationRegister);
  assert.equal(allocations.length,1);const allocation=allocations[0];
  assert.equal(allocation.name,'tsfg_program.array_create');assert.equal(allocation.view,'unit:Array');
  assert.equal(allocation.properties.allocation,'argument-context');assert.deepEqual(allocation.range,{start:380,end:389});
  const flow=analyzeCommonGraphs(m.program),contexts=[...flow.actual.contexts.values()].filter(c=>c.plan.owner.id===m.reader),
    environments=new Set(contexts.flatMap(c=>[...c.args[0].refs]));
  assert.equal(environments.size,2);assert.ok(contexts.length>=2);assert.equal(new Set(contexts.map(c=>c.activation)).size,1);
  for(const context of contexts){assert.equal(context.args.length,1);assert.equal(context.args[0].refs.size,1);}
  // The actual SSA result aggregates this operation across every argument
  // context, before the unused temporary is removed from the return heap.
  const observed=flow.actual.observed.get(m.reader+'/'+allocation.result);assert.ok(observed);
  assert.equal(observed.refs.size,1,'one verified activation and allocation operation has one physical object');
  assert.equal(observed.unknown,false);assert.deepEqual([...observed.tags],['unit:Array']);
  for(const ref of observed.refs){const object=flow.actual.objects.get(ref);assert.ok(object);
    assert.equal(object.type,'unit:Array');assert.equal(object.weak,false);}
});

for(const wrapped of [false,true])test('allocation fixed input owns the complete two-result source: '+(wrapped?'wrapper':'direct'),()=>{
  const prior=JSON.parse(readFileSync(new URL('./testdata/common-program-fixed-v3-interop/actual-storage-nominal-partial.json',import.meta.url),'utf8')).hir.snapshot,
    bytes=Buffer.from(canonical(prior)+'\n'),declaration=prior.payload.files.find(row=>row.path.endsWith('/minimal-arrays-v8.d.ts')).content,
    input=allocationFixedSourceInput(declaration,wrapped),source=input.files.find(row=>row.path===input.rootFile).content,call=wrapped?'wrap':'make';
  assert.equal(input.files.length,2);assert.equal(input.declarations.version,'minimal-arrays-v8');
  assert.deepEqual(input.hostImports,[]);for(const file of input.files)assert.equal(file.sha256,sha256(file.content).slice(7));
  const request=allocationFixedFactsRequest(declaration,wrapped);assert.equal(request.family,'tsfg.program-facts-request-candidate');
  assert.equal(request.version,2);assert.deepEqual(request.input,input);
  assert.deepEqual(input.compilationClosure,{roots:[{kind:'application',name:'root',sourcePath:input.rootFile},
    {kind:'module-initialization',name:'$moduleInit',sourcePath:input.rootFile}],requiredRoots:[]});
  assert.deepEqual(input.config,{strict:true,noEmit:true,allowJs:false});
  assert.equal(source.split(' = '+call+'();').length-1,2,'equal-argument calls remain distinct source sites');
  assert.match(source,/return \[first, second\];/);assert.match(source,/function reader\(\): u32 \{ a; r; return 0; \}/);
  assert.equal(source.includes('function wrap()'),wrapped);
  assert.throws(()=>allocationFixedSourceInput(declaration+'\n',wrapped),/minimal-arrays-v8/);
  assert.throws(()=>allocationFixedInputPair(bytes,wrapped,commonProgramCore),/must describe this complete source/,'another valid owning graph cannot supply these contracts');
});
