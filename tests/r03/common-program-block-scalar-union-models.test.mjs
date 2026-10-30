// SPDX-License-Identifier: MIT
// Owning normalized data controls, not substitutes for the official Source cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonEnvironments} from '../../compiler/common-program-environments.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {scalarTypeIds,sha256} from '../../compiler/identity.mjs';
function blockModel(presence,{writable=true,repeated=false,other=''}={}){
  const memberNames=['bool','i32',...presence],typeId=name=>scalarTypeIds[name]??sha256('tsfg.type\0'+name),
    members=memberNames.map(typeId).sort(),binding={id:'cell',name:'cell',kind:'local',type:'U',writable},
    declaration={kind:writable?'letDeclaration':'constDeclaration',binding:'cell',initializer:{kind:'numericLiteral'}},
    owner={id:'owner',lexicalParent:null,parameters:[],bindings:[binding],captures:[],
      body:[repeated?{kind:'while',body:[declaration]}:{kind:'if',then:[declaration],else:[]}]},
    reader={id:'reader',lexicalParent:'owner',parameters:[],bindings:[],body:[],captures:[{binding:'cell',read:true,write:false}]},
    writer={...reader,id:'writer',captures:[{binding:'cell',read:true,write:writable}]},
    union={id:'U',kind:'union',members},
    rows=[...memberNames.map(name=>({id:typeId(name),kind:['null','undefined'].includes(name)?name:'scalar',...(['null','undefined'].includes(name)?{}:{name})})),union];
  if(other==='mixed'){rows.push({id:'string',kind:'string'});union.members.push('string');}
  else if(other){rows.push({id:'other',kind:other});binding.type='other';}
  return {functions:[owner,reader,writer],types:new Map(rows.map(row=>[row.id,row])),owner,reader,writer};
}
for(const presence of [[],['null'],['undefined'],['null','undefined']])test('single block retains logical scalar slot '+(presence.join('/')||'pure'),()=>{
  const value=blockModel(presence),original=structuredClone(value.types.get('U')),
    layout=commonEnvironments(value.functions,value.types,commonMeter()),slot=layout.slots.get('cell');
  assert.equal(layout.slots.size,1);assert.equal(slot.type,'U');assert.equal(slot.writable,true);
  assert.deepEqual(value.types.get('U'),original);
  assert.equal(layout.metadata(value.reader).lexicalEnvironment,layout.metadata(value.owner).activationEnvironment);
  assert.equal(layout.metadata(value.writer).lexicalEnvironment,layout.metadata(value.owner).activationEnvironment);
});
test('scalar union block keeps const ownership',()=>{
  const value=blockModel(['null','undefined'],{writable:false}),layout=commonEnvironments(value.functions,value.types,commonMeter());
  assert.equal(layout.slots.get('cell').writable,false);assert.equal(layout.slots.size,1);
});
// Five existing payload classes now have complete official block package positives.
for(const other of ['mixed','readSpan'])test('single block still rejects '+other+' payload',()=>{
  const value=blockModel(['null'],{other});
  assert.throws(()=>commonEnvironments(value.functions,value.types,commonMeter()),error=>error instanceof Error&&'code'in error&&error.code==='r03-common-program-capability');
});
test('scalar union does not give repeated blocks a fresh binding model',()=>{
  const value=blockModel(['null','undefined'],{repeated:true});
  assert.throws(()=>commonEnvironments(value.functions,value.types,commonMeter()),error=>error instanceof Error&&'code'in error&&error.code==='r03-common-program-capability');
});
