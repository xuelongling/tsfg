// SPDX-License-Identifier: MIT
// Complete official facts prove static acceptance; numeric oracles are unexecuted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCommonProgramFacts} from '../../compiler/common-program-facts.mjs';
import {projectCommonProgram} from '../../compiler/common-program-hir.mjs';
import {createCommonProgramPublication} from '../../compiler/common-program-analysis.mjs';
import {emitCommonProgramCore} from '../../compiler/common-program-core.mjs';
import {commonClosureHolding} from '../../compiler/common-program-borrow-observations.mjs';
import {commonRegions,emptyRegionValue} from '../../compiler/common-program-regions.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
const hasCode=(e,code)=>e instanceof Error&&'code' in e&&e.code===code;
function consume(name){const hir=projectCommonProgram(readCommonProgramFacts(readFileSync(new URL('./testdata/common-loop-local-factory/'+name+'.json',import.meta.url)))),
  publication=createCommonProgramPublication(hir),request={targets:hir.closure.requiredRoots.filter(r=>r.kind==='kernel').map(r=>r.target).sort()};return emitCommonProgramCore(hir,publication,request);}
for(const name of ['scalar-cell-main','scalar-cell-saved-old'])test('complete Source self-held view reader can update its independent scalar Cell: '+name,()=>{
  const core=consume(name);assert.match(core,/tsfg_program.env_store/);assert.match(core,/tsfg_program.array_read/);
});
test('replacing the owning reference Cell cannot retain its old descriptor owner',()=>{
  assert.throws(()=>consume('unsafe-owner-reassignment-constant'),e=>hasCode(e,'r03-common-program-borrow-pending'));
});
function policyFixture(){
  const types=new Map([['n',{kind:'scalar'}],['a',{kind:'array'}],['f',{kind:'function'}]]),
    outer={id:'outer',parent:null,slots:[{key:'counter',type:'n',writable:true}]},inner={id:'inner',parent:'outer',slots:[]},
    upper={facets:{unknownHost:false,escape:false,await:false,lock:false},globals:{reads:[],writes:[]},parameters:[],captures:[{slot:'counter',write:true,structural:false}]},
    model={spend:commonMeter(),types,environments:new Map([['outer',outer],['inner',inner]]),functions:new Map([['reader',{lexicalEnvironment:'inner'}]])},
    records=new Map([['reader',{upper}]]),objects=new Map();
  let closed=true;const policy=()=>commonClosureHolding({model,records,objects,closedTarget:()=>closed});
  return {model,upper,outer,inner,records,objects,policy,close:()=>{closed=false;}};
}
test('canonical scalar write may resolve through a verified parent environment',()=>{const f=policyFixture();assert.equal(f.policy().permitsCode('reader'),true);});
for(const variant of ['foreign','missing','ambiguous'])test('capture permission rejects '+variant+' canonical slot authority',()=>{
  const f=policyFixture();if(variant==='foreign')f.inner.parent=null;
  if(variant==='missing')f.outer.slots=[];
  if(variant==='ambiguous')f.model.environments.set('foreign',{id:'foreign',parent:null,slots:[{...f.outer.slots[0]}]});
  assert.equal(f.policy().permitsCode('reader'),false);
});
for(const kind of ['array','reference','function','readSpan','union'])test('capture write does not permit '+kind+' slots',()=>{
  const f=policyFixture();f.model.types.set('n',{kind});assert.equal(f.policy().permitsCode('reader'),false);
});
test('cached fixed permission keeps the current target-closure gate',()=>{const f=policyFixture(),p=f.policy();assert.equal(p.permitsCode('reader'),true);f.close();assert.equal(p.permitsCode('reader'),false);});
test('an unobserved permitted code arm with reference writes or Host effects is not covered',()=>{
  for(const host of [false,true]){const f=policyFixture();f.outer.slots.push({key:'array',type:'a',writable:true});
    const bad={...f.upper,facets:{...f.upper.facets,unknownHost:host},captures:[{slot:'array',write:true,structural:false}]};
    f.model.functions.set('other',{lexicalEnvironment:'inner'});f.records.set('other',{upper:bad});
    f.objects.set('env1',{type:'env:inner'});f.objects.set('env2',{type:'env:inner'});
    const value={unknown:false,cells:new Set(),tags:new Set(['f']),refs:new Set(['env1','env2']),pairs:new Map([
      ['reader',{functionId:'reader',environment:'env1'}],['other',{functionId:'other',environment:'env2'}]])};
    assert.equal(f.policy().wholeValue(value,{top:false,functions:['reader','other']}),false);
  }
});
function currentGraph(mode='scalar'){
  const r=commonRegions(commonMeter()),heap=new Map(),scope=r.scope('factory','activation'),
    types=new Map([['n',{kind:'scalar'}],['a',{kind:'array',elementType:'n'}],['v',{kind:'readSpan',elementType:'n'}]]),
    layout={id:'E',parent:null,slots:[{key:'a',type:'a',writable:false},{key:'r',type:'v',writable:false},{key:'seen',type:'n',writable:true}]},
    env=r.allocate(scope,'act','env','env:E',heap),array=r.allocate(scope,'act','array','a',heap),span=r.allocate(scope,'act','span','v',heap);
  r.store(array,'length',r.number(1),heap);r.store(array,'element/0',r.number(7),heap);
  r.store(span,'owner',array,heap);r.store(span,'start',r.number(0),heap);r.store(span,'length',r.number(1),heap);
  r.store(env,'slot/a',array,heap);r.store(env,'slot/r',span,heap);
  if(mode!=='missing')r.store(env,'slot/seen',mode==='hidden-reference'?array:mode==='bottom'?emptyRegionValue():mode==='opaque'?{...r.number(0),opaque:true}:r.number(0),heap);
  if(mode==='reference-type')layout.slots[2].type='a';
  if(mode==='raw-hard')r.hardRaw(new Set(['array']));
  return ()=>r.ownedReturnHolds(env,heap,'span','array',scope,types,new Map([['E',layout]]));
}
test('current complete graph permits a proved nonowning scalar write slot',()=>assert.equal(currentGraph()(),true));
for(const mode of ['hidden-reference','bottom','opaque','missing','reference-type','raw-hard'])test('current scalar slot exception rejects '+mode,()=>assert.equal(currentGraph(mode)(),false));
