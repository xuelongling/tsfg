// SPDX-License-Identifier: MIT
// Complete, unchanged v5 public Go producer packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,sha256,scalarTypeIds} from '../../compiler/identity.mjs';
import {readSystemQueryFacts,printSystemQueryFacts} from '../../compiler/system-query-facts.mjs';
import {systemQueryFixture as fixture} from './system-query-fixtures.mjs';
const actual=fixture('loop-architecture');
const inputLoop=packet=>packet.payload.systems[0].loops[0];
const edit=(mutate,input=actual)=>{
  const packet=structuredClone(input.packet);mutate(packet,inputLoop(packet));
  packet.packageId=sha256('tsfg.system-query.package.v5\0'+packet.schemaHash+'\0'+canonical(packet.payload));
  return {bytes:Buffer.from(canonical(packet)+'\n'),context:{...input.context,expectedPackageId:packet.packageId}};
};
test('actual architecture complete Query loop owns tuple bindings and f32 field body',()=>{
  const input=fixture('loop-architecture'),facts=readSystemQueryFacts(input.bytes,input.context),system=facts.systems[0],loop=system.loops[0];
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.nodes,input.packet.payload.nodes);
  assert.equal(system.loops.length,1);assert.equal(loop.statements.length,2);
  assert.equal(loop.queryBinding,system.parameters[0].binding.id);
  assert.deepEqual(loop.bindings.map(row=>[row.declaration.name,row.mode]),[['p','write'],['v','read']]);
  assert.deepEqual(loop.bindings.map(row=>row.componentType),system.parameters[0].query.items.map(row=>row.componentType));
  assert.deepEqual(loop.statements.map(row=>[row.value.kind,row.value.operator,row.value.value.kind,row.value.value.operator]),[['fieldAssignment','+=','binary','*'],['fieldAssignment','+=','binary','*']]);
  const value=loop.statements[0].value,raw=inputLoop(input.packet).statements[0].value;
  assert.equal(value.type,scalarTypeIds.f32);assert.equal(value.sourceType,'f32');
  assert.equal(value.target.access,'readwrite');assert.equal(value.value.left.access,'read');
  assert.equal(value.target.sourceField,raw.target.property);assert.notEqual(value.target.property,raw.target.property);
  assert.deepEqual(loop.bindings.map(row=>row.declaration),inputLoop(input.packet).bindings.map(row=>row.declaration));
  assert.ok(Object.isFrozen(loop)&&Object.isFrozen(value)&&Object.isFrozen(value.target));
});
for(const name of ['loop-aliases','loop-multiple'])test('actual complete typed Query loop retains '+name,()=>{
  const input=fixture(name),facts=readSystemQueryFacts(input.bytes,input.context);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.nodes,input.packet.payload.nodes);assert.deepEqual(facts.program,input.packet.payload.program);
  assert.ok(facts.systems.some(system=>system.loops.length));
});
test('actual shared component Read view does not freeze the Write view',()=>{
  const input=fixture('loop-shared-component'),facts=readSystemQueryFacts(input.bytes,input.context),loop=facts.systems[0].loops[0];
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.equal(loop.bindings[0].componentType,loop.bindings[1].componentType);
  assert.deepEqual(loop.bindings.map(row=>row.mode),['write','read']);
  assert.equal(loop.statements[0].value.target.sourceField,loop.statements[0].value.value.left.sourceField);
  assert.notEqual(loop.statements[0].value.target.receiver.binding,loop.statements[0].value.value.left.receiver.binding);
});
test('actual inherited component selects its own shadowing field declaration',()=>{
  const input=fixture('loop-inheritance'),facts=readSystemQueryFacts(input.bytes,input.context);
  const position=input.packet.payload.types.find(row=>row.name==='Position'),base=input.packet.payload.types.find(row=>row.name==='Base');
  assert.equal(position.base,base.id);
  assert.equal(facts.systems[0].loops[0].statements[0].value.target.sourceField,position.fields.find(row=>row.name==='x').id);
  assert.notEqual(position.fields.find(row=>row.name==='x').id,base.fields.find(row=>row.name==='x').id);
  assert.deepEqual(printSystemQueryFacts(facts,input.context),input.bytes);
  assert.deepEqual(facts.nodes,input.packet.payload.nodes);
});
test('cold loop boundary rejects rehashed shadowed base field declaration',()=>{
  const input=edit((packet,loop)=>{
    loop.statements[0].value.target.property=packet.payload.types.find(row=>row.name==='Base').fields.find(row=>row.name==='x').id;
  },fixture('loop-inheritance'));
  assert.throws(()=>readSystemQueryFacts(input.bytes,input.context));
});

const cases=[
  ['query parameter binding',(packet,loop)=>{loop.queryBinding=packet.payload.systems[0].parameters[1].binding.id;}],
  ['query occurrence range',(_packet,loop)=>{loop.queryRange.start--;}],
  ['original system body',packet=>{packet.payload.systems[0].bodyRange.start++;}],
  ['loop body range',(_packet,loop)=>{loop.bodyRange.end--;}],
  ['tuple binding range',(_packet,loop)=>{loop.bindingRange.start++;}],
  ['loop binding original ID',(_packet,loop)=>{loop.bindings[0].declaration.id=loop.queryBinding;}],
  ['loop binding order',(_packet,loop)=>{loop.bindings.reverse();loop.bindings.forEach((row,index)=>row.index=index);}],
  ['loop component selection',(_packet,loop)=>{loop.bindings[0].componentType=loop.bindings[1].componentType;}],
  ['loop Read/Write mode',(_packet,loop)=>{loop.bindings[1].mode='write';}],
  ['missing loop binding',(_packet,loop)=>{loop.bindings.pop();}],
  ['missing complete loop',packet=>{packet.payload.systems[0].loops=[];}],
  ['missing body statement',(_packet,loop)=>{loop.statements.pop();}],
  ['statement source order',(_packet,loop)=>{loop.statements.reverse();}],
  ['unowned expression binding',(_packet,loop)=>{loop.statements[0].value.value.right.binding=loop.queryBinding;}],
  ['wrong scalar expression type',(_packet,loop)=>{const value=loop.statements[0].value.value.right;value.type=value.flowType='u32';}],
  ['wrong expression flow type',(_packet,loop)=>{loop.statements[0].value.value.flowType='u32';}],
  ['field from other component',(_packet,loop)=>{loop.statements[0].value.target.property=loop.statements[0].value.value.left.property;}],
  ['different original field',(_packet,loop)=>{loop.statements[0].value.target.property=loop.statements[1].value.target.property;}],
  ['field name anchor',(_packet,loop)=>{loop.statements[0].value.target.nameRange.start++;}],
  ['field receiver binding',(_packet,loop)=>{loop.statements[0].value.target.receiver.binding=loop.bindings[1].declaration.id;}],
  ['arithmetic operator',(_packet,loop)=>{loop.statements[0].value.value.operator='+';}],
  ['compound operator',(_packet,loop)=>{loop.statements[0].value.operator='=';}],
  ['operator source anchor',(_packet,loop)=>{loop.statements[0].value.operatorRange.start++;}],
  ['assignment operator from another statement',(_packet,loop)=>{loop.statements[0].value.operatorRange={...loop.statements[1].value.operatorRange};}],
  ['binary operator from another statement',(_packet,loop)=>{loop.statements[0].value.value.operatorRange={...loop.statements[1].value.value.operatorRange};}],
  ['extra expression authority',(_packet,loop)=>{loop.statements[0].value.foreignPermission=true;}],
  ['loop declaration source',(_packet,loop)=>{loop.bindings[0].declaration.sourcePath='/src/system-query-context.d.ts';}],
  ['unowned property',(_packet,loop)=>{loop.statements[0].value.target.property='sha256:'+'0'.repeat(64);}],
];
for(const [name,mutate]of cases)test('cold loop boundary rejects rehashed '+name,()=>{
  const input=edit(mutate);assert.throws(()=>readSystemQueryFacts(input.bytes,input.context));
});
