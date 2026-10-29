// SPDX-License-Identifier: MIT
// Normalized owning data only; complete official Source packets are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonEnvironments} from '../../compiler/common-program-environments.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {selectCommonCarriers} from '../../compiler/common-program-carriers.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
const absenceIds={null:sha256('tsfg.type\0null'),undefined:sha256('tsfg.type\0undefined')};
function captureModel(presence,role='local',writable=true){
  const binding={id:'held',name:'held',kind:role,type:'U',writable},members=[scalarTypeIds.bool,scalarTypeIds.i32,...presence.map(kind=>absenceIds[kind])].sort(),
    owner={id:'owner',lexicalParent:null,parameters:role==='parameter'?[binding]:[],bindings:role==='local'?[binding]:[],captures:[],
      body:role==='local'?[{kind:writable?'letDeclaration':'constDeclaration',binding:'held',initializer:{kind:'numericLiteral'}}]:[]},
    left={id:'left',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'held',read:true,write:false}]},
    right={...left,id:'right',captures:[{binding:'held',read:true,write:writable}]},grandchild={...left,id:'grandchild',lexicalParent:'left'},
    rows=[{id:scalarTypeIds.bool,kind:'scalar',name:'bool'},{id:scalarTypeIds.i32,kind:'scalar',name:'i32'},
      ...presence.map(kind=>({id:absenceIds[kind],kind})),{id:'U',kind:'union',members}];
  return {functions:[owner,left,right,grandchild],types:new Map(rows.map(row=>[row.id,row])),owner,left,right,grandchild,members};
}
for(const presence of [['null'],['undefined'],['null','undefined']])for(const role of ['local','parameter'])for(const writable of [false,true])
test('normalized scalar presence retains '+presence.join('/')+' '+role+' '+(writable?'mutable':'const')+' shared slot',()=>{
  const value=captureModel(presence,role,writable),layout=commonEnvironments(value.functions,value.types,commonMeter()),slot=layout.slots.get('held');
  assert.equal(layout.slots.size,1);assert.equal(slot.type,'U');assert.equal(slot.writable,writable);
  assert.deepEqual(value.types.get('U'),{id:'U',kind:'union',members:value.members});
  for(const child of [value.left,value.right,value.grandchild])assert.equal(layout.metadata(child).lexicalEnvironment,layout.metadata(value.owner).activationEnvironment);
});
test('the existing scalar vocabulary plus both absences remains finite',()=>{
  const value=captureModel(['null','undefined']),members=[...Object.values(scalarTypeIds),...Object.values(absenceIds)].sort();
  for(const [name,id]of Object.entries(scalarTypeIds))value.types.set(id,{id,kind:'scalar',name});
  value.types.set('U',{id:'U',kind:'union',members});
  assert.equal(commonEnvironments(value.functions,value.types,commonMeter()).slots.get('held').type,'U');assert.equal(members.length,15);
});
for(const kind of ['string','array','function','reference','value','readSpan','unknown','void'])
test('scalar presence does not admit an additional '+kind+' payload',()=>{
  const value=captureModel(['null','undefined']);value.types.set('foreign',{id:'foreign',kind});
  value.types.set('U',{id:'U',kind:'union',members:[...value.members,'foreign'].sort()});
  assert.throws(()=>commonEnvironments(value.functions,value.types,commonMeter()),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-capability');
});
test('absence alone does not acquire a scalar payload',()=>{
  const value=captureModel(['null','undefined']);value.types.set('U',{id:'U',kind:'union',members:Object.values(absenceIds).sort()});
  assert.throws(()=>commonEnvironments(value.functions,value.types,commonMeter()),e=>e instanceof Error&&'code'in e&&e.code==='r03-common-program-capability');
});
const all=[scalarTypeIds.bool,scalarTypeIds.i32,...Object.values(absenceIds)].sort();
for(let bits=0;bits<16;bits++)test('physical scalar/presence carrier retains actual subset '+bits,()=>{
  const observed=all.filter((_,index)=>bits&(1<<index)),fixture=captureModel(['null','undefined']),
    model={types:fixture.types,bindings:new Map([['held',{id:'held',type:'U'}]]),spend:commonMeter(),payload:'payload:unit',environments:new Map()},a=commonAbstract(model),value=a.empty();
  for(const id of observed)a.merge(value,a.literal(id));const before=a.copy(value),
    carriers=selectCommonCarriers({model,plans:[]},{abstract:a,fieldSeeds:new Map(),globalSeeds:new Map(),elementSeeds:new Map(),
      capacity:{observed:new Map([['binding/held',value]]),contexts:new Map()}}),carrier=carriers.bindings.get('held'),domain=carriers.domains.get(carrier);
  assert.deepEqual(domain?.actualTypes??[carrier],observed);assert.deepEqual(value,before);
  assert.equal(value.refs.size,0);assert.equal(value.cells.size,0);assert.equal(value.pairs.size,0);assert.equal(carriers.layout(carrier).referenceCount,0);
});
