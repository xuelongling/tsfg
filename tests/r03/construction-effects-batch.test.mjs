// SPDX-License-Identifier: MIT
// Literal typed Source effect-domain inputs only; no Source/Facts/Runtime
// admission, frontend snapshot, physical layout or borrow proof is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonEffects,commonEffectsCover,commonFacets} from '../../compiler/common-program-effects.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';

const range={start:1,end:2},origin={source:'/effects-batch.ts',...range},B='literal:B',C='literal:C',G='literal:G';
const number=()=>({kind:'numericLiteral',type:i32TypeId,token:'1',decimal:'1',range});
const fn=(id,body=[])=>({id,kind:'source',returnType:i32TypeId,parameters:[],bindings:[],captures:[],body,range,sourcePath:origin.source});
const nominal=id=>({id,kind:'reference',fields:[],methods:[],construction:{id:id+'/ctor',kind:'implicit-base',functionId:null,
  parameters:[],signature:{parameters:[],returnType:id},initializationFields:[],origin}});
const create=type=>({kind:'new',type:type.id,callee:type.id,construction:type.construction.id,arguments:[],range});
const field=(type,name,view,initializer)=>({id:type.id+'/'+name,type:view,origin,initializer});
const hir=(types,functions,globals=[])=>({types:[{id:i32TypeId,kind:'scalar',name:'i32'},...types],functions,globals,
  environments:[],hostImports:[],hostContext:null,modules:[],closure:{roots:[]},snapshot:{payload:{compatibilityWitnesses:[],entryCompatibilityRoots:[]}}});

test('one authoring fixed point covers all public and implicit owners within the unchanged default meter',()=>{
  const types=[nominal(B),nominal(C)],functions=Array.from({length:32},(_,index)=>fn('source:empty:'+index,[{kind:'return',range,value:number()}])),
    effects=commonEffects(hir(types,functions),commonMeter()),derived=effects.derived();
  assert.equal(derived.size,functions.length);
  for(const owner of functions){const upper=derived.get(owner.id);
    assert.deepEqual(upper.globals,{reads:[],writes:[]});assert.deepEqual(upper.parameters,[]);
    assert.equal(Object.values(upper.facets).some(Boolean),false);}
  assert.equal([...derived.keys()].some(id=>id.startsWith('analysis-construction:')),false,'all-owned internal solve does not expand public publication rows');
});

function recursiveFixture(writeBody=false){
  const base=nominal(B),other=nominal(C),leaf=fn('source:leaf',writeBody?[{kind:'expression',range,value:{kind:'fieldAssignment',type:i32TypeId,
    operator:'=',target:{kind:'fieldTarget',type:i32TypeId,receiver:{kind:'globalReference',type:B,global:G,range},property:B+'/value',range},value:number(),range}}]:[]),
    invoke={kind:'call',type:i32TypeId,callee:leaf.id,arguments:[],signature:{parameters:[],returnType:i32TypeId},range},
    caller=fn('source:caller',[{kind:'expression',range,value:create(base)}]);
  base.fields=[field(base,'value',i32TypeId,null),field(base,'child',C,create(other)),field(base,'permission',i32TypeId,invoke)];
  other.fields=[field(other,'child',B,create(base))];
  for(const type of [base,other])type.construction.initializationFields=type.fields.map(row=>row.id);
  const input=hir([base,other],[leaf,caller],[{id:G,type:B,writable:true}]);
  return {input,leaf,caller};
}

test('authoring propagates changing public bodies through the same constructor fixed point',()=>{
  const {input,leaf,caller}=recursiveFixture(true),effects=commonEffects(input,commonMeter(1000000)),derived=effects.derived();
  assert.deepEqual(derived.get(leaf.id).globals.writes,[G]);
  assert.deepEqual(derived.get(caller.id).globals.writes,[G],'generated owner summaries revisit after a public authoring row grows');
  assert.deepEqual([...derived.keys()],[leaf.id,caller.id]);
});

test('fixed batches own their contract epoch and preserve broad archived permissions across every caller',()=>{
  const {input,leaf,caller}=recursiveFixture(),spend=commonMeter(1000000),effects=commonEffects(input,spend),
    broad=owner=>({...effects.blank(owner),globals:{reads:[],writes:[G]},facets:Object.fromEntries(commonFacets.map(flag=>[flag,flag!=='unknownHost']))}),
    rows=new Map([[leaf.id,broad(leaf)],[caller.id,broad(caller)]]),batch=effects.fixed(rows),
    first=batch.derive(caller),narrow={...rows.get(caller.id),globals:{reads:[],writes:[]}};
  assert.deepEqual(first.upper.globals.writes,[G],'empty current leaf body does not narrow its fixed cap');
  assert.equal(commonEffectsCover(rows.get(caller.id),first.upper,spend),true);
  assert.equal(commonEffectsCover(narrow,first.upper,spend),false);
  assert.deepEqual([...new Set(first.calls.map(row=>row.target))],[leaf.id]);
  assert.equal(first.calls.some(row=>row.target.startsWith('analysis-construction:')),false);
  rows.get(leaf.id).globals.writes.length=0;
  assert.deepEqual(batch.derive(caller).upper.globals.writes,[G],'in-place input mutation cannot reinterpret a closed batch');
  rows.set(leaf.id,{...rows.get(leaf.id),globals:{reads:[],writes:[]}});
  assert.deepEqual(batch.derive(caller,true).upper.globals.writes,[G],'diagnostics share the same closed fixed snapshot');
  assert.deepEqual(effects.fixed(rows).derive(caller).upper.globals.writes,[],'a new batch explicitly observes the replacement epoch');
  const missing=new Map(rows);missing.delete(leaf.id);
  assert.throws(()=>effects.fixed(missing),error=>error instanceof Error&&'code' in error&&error.code==='r03-common-program-publication');
});
