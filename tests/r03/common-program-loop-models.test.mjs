// SPDX-License-Identifier: MIT
// Normalized actual/borrow controls only; Source and Core checks live separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCommonGraphs} from '../../compiler/common-program-actual.mjs';
import {loopFactoryModel,loopMayHoldingModel} from './common-program-loop-models.mjs';

const pending=/** @param {any} error */error=>error.code==='r03-common-program-borrow-pending';
function loopContexts(model,flow){
  return [...flow.actual.contexts.values()].filter(c=>c.plan.owner.id===model.factory&&!c.root&&c.regionScope);
}
function holding(model,context){
  const pair=[...context.returned.pairs.values()][0],heap=context.normalHeap,
    owner=heap.get(pair.environment+'/slot/'+model.ownerSlot),span=heap.get(pair.environment+'/slot/'+model.spanSlot);
  assert.ok(owner&&span);assert.equal(owner.refs.size,1);assert.equal(span.refs.size,1);
  const array=[...owner.refs][0],descriptor=[...span.refs][0];
  assert.deepEqual([...heap.get(descriptor+'/owner').refs],[array]);
  return {environment:pair.environment,array,descriptor};
}
test('normalized current iteration consumes its actually held factory result without strengthening raw objects',()=>{
  const model=loopFactoryModel(),flow=analyzeCommonGraphs(model.program,model.records),contexts=loopContexts(model,flow);
  assert.equal(contexts.length,1);assert.ok(flow.actual.borrows);
  const held=holding(model,contexts[0]);
  for(const ref of Object.values(held))assert.equal(flow.actual.objects.get(ref).weak,true);
  const layout=flow.actual.regions.layouts.get(model.root);
  assert.ok(layout.loops.get(model.header).members.has(model.body));
  assert.ok(layout.cuts.get(model.backedge).get(model.header).has(model.header));
  assert.equal(flow.actual.regions.scopes.get(contexts[0].regionScope).blocked,false);
});
test('normalized two same-code factories in one iteration retain their own matching owner and environment',()=>{
  const model=loopFactoryModel('two'),flow=analyzeCommonGraphs(model.program,model.records),contexts=loopContexts(model,flow);
  assert.equal(contexts.length,2);assert.equal(new Set(contexts.map(c=>c.regionScope)).size,2);
  const held=contexts.map(c=>holding(model,c));
  for(const key of ['environment','array','descriptor'])assert.equal(new Set(held.map(row=>row[key])).size,2);
  for(const row of held)assert.equal(flow.actual.objects.get(row.environment).weak,true);
  assert.equal(model.factoryCalls.length,2);assert.equal(model.readerCalls.length,2);
});
for(const mode of ['replaced','descriptor-only'])test('normalized current iteration cannot invent independent holding: '+mode,()=>{
  const model=loopFactoryModel(mode);assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
for(const mode of ['old-cell','old-field'])test('normalized saved alias is loaded before the next creation and cannot borrow its current fields: '+mode,()=>{
  const model=loopFactoryModel(mode),root=model.program.plans.find(p=>p.owner.id===model.root),
    body=root.graph.blocks.find(b=>b.name===model.body),load=body.instructions.find(op=>op.result===model.oldLoad.name);
  assert.ok(load);assert.equal(load.name,mode==='old-cell'?'tsfg_program.load':'tsfg_program.field_load');
  assert.equal(model.factoryCalls.length,2,'one real pre-loop initialization and one repeated creator site');
  assert.ok(root.graph.blocks.find(b=>b.name===model.backedge).instructions.at(-1).successors.includes(model.header));
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('normalized live break carries the current closure through an actually used exit phi',()=>{
  const model=loopFactoryModel('live-break'),root=model.program.plans.find(p=>p.owner.id===model.root),
    exit=root.graph.blocks.find(b=>b.name===model.done);
  assert.equal(exit.parameters.length,1);assert.equal(exit.instructions.at(-1).name,'tsfg_program.invoke_indirect');
  assert.equal(exit.instructions.at(-1).operands[0],exit.parameters[0].name);
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
test('normalized dead break exit phi does not keep the already consumed current closure live',()=>{
  const model=loopFactoryModel('dead-break'),root=model.program.plans.find(p=>p.owner.id===model.root),
    exit=root.graph.blocks.find(b=>b.name===model.done);
  assert.equal(exit.parameters.length,1);
  assert.equal(exit.instructions.some(op=>op.operands.includes(exit.parameters[0].name)),false);
  assert.doesNotThrow(()=>analyzeCommonGraphs(model.program,model.records));
});
for(const mode of ['unconnected-pure','unconnected-host'])test('normalized creator needs its full finite target table connected: '+mode,()=>{
  const model=loopFactoryModel(mode),creator=model.factoryCalls[0],operand=creator.operands[0],
    root=model.program.plans.find(p=>p.owner.id===model.root),code=root.graph.registers.get(operand).operation;
  assert.equal(code.properties.function_id,model.factory);
  assert.deepEqual(creator.properties.targets.functions.map(row=>row.function_id),[model.factory,model.pureCreator]);
  assert.equal(model.records.get(model.pureCreator).upper.facets.unknownHost,mode==='unconnected-host');
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
for(const mode of ['recursive','host'])test('normalized cyclic or unknown Host origin remains pending: '+mode,()=>{
  const model=loopFactoryModel(mode);
  if(mode==='recursive'){
    const factory=model.program.plans.find(p=>p.owner.id===model.factory);
    assert.ok(factory.graph.blocks.some(b=>b.instructions.some(op=>op.name==='tsfg_program.invoke'&&op.properties.function_id===model.factory)));
  }else assert.equal(model.records.get(model.factory).upper.facets.unknownHost,true);
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending);
});
for(const mode of ['may-field','may-array','inline-value-copy'])test('normalized may holding cannot erase its empty alternative: '+mode,()=>{
  const model=loopMayHoldingModel(mode),factory=model.program.plans.find(p=>p.owner.id===model.factory),
    root=model.program.plans.find(p=>p.owner.id===model.root),join=factory.graph.blocks.find(b=>b.name===model.join),
    incoming=factory.graph.blocks.flatMap(b=>b.instructions.filter(op=>op.successors.includes(join.name)));
  assert.equal(factory.owner.lexicalParent,root.owner.id);assert.equal(factory.parameters[0].id,model.condition);
  assert.deepEqual(incoming.map(op=>op.operands),[[model.left],[model.right]]);
  assert.equal(model.factoryCalls[0].operands.length,1);assert.equal(join.parameters[0].name,model.selected);
  const closure=join.instructions.find(op=>op.name==='tsfg_program.make_closure'),
    init=join.instructions.find(op=>op.name==='tsfg_program.env_init'&&op.properties.key===model.holderSlot);
  assert.ok(join.instructions.indexOf(init)<join.instructions.indexOf(closure));
  if(mode==='inline-value-copy'){
    assert.equal(join.instructions.filter(op=>op.name==='tsfg_program.value_copy').length,1);
    assert.equal(init.operands[1],model.copied);
  }else{
    assert.equal(model.write.operands[0],model.selected);assert.equal(model.write.operands.at(-1),model.owned);
    assert.equal(init.operands[1],model.right,'the returned B is not the may receiver');
  }
  assert.throws(()=>analyzeCommonGraphs(model.program,model.records),pending,'one real branch leaves the captured owner holder empty');
});
for(const mode of ['may-field','may-array','inline-value-copy'])test('normalized may holding succeeds when every real alternative retains A: '+mode,()=>{
  const model=loopMayHoldingModel(mode,true),flow=analyzeCommonGraphs(model.program,model.records),contexts=loopContexts(model,flow);
  assert.equal(contexts.length,1);assert.ok(flow.actual.borrows);
  if(mode==='inline-value-copy'){
    const c=contexts[0],env=[...c.returned.pairs.values()][0].environment,holder=c.normalHeap.get(env+'/slot/'+model.holderSlot);
    assert.equal(holder.refs.size,1,'source alternatives never create extra physical copy allocations');
    const ref=[...holder.refs][0],versions=[...flow.actual.regions.nodes.values()].filter(node=>node.reference===ref);
    assert.equal(versions.length,2,'both field alternatives of that physical copy survive');
    assert.equal(flow.actual.objects.get(ref).weak,true);
  }
});
