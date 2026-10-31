// SPDX-License-Identifier: MIT
// Independent Graph5 equation DTO premises only; no Source, Program or Runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOriginsInclusion as inclusion} from '../../compiler/common-program-return-origin-inclusion.mjs';
import {readCommonReturnOriginGraph as read} from '../../compiler/common-program-return-origin-graph.mjs';
/** @returns {Parameters<typeof inclusion>[0]} */
const graph=()=>({format:{family:'tsfg.return-origin-graph-candidate',version:5},nodes:[],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[],language:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]});
const meter=()=>{let left=200000;return (units=1)=>{left-=units;if(left<0)throw new Error('fixture budget exhausted');};};
const unknown=()=>{const value=graph();value.nodes.push({kind:'unknown',type:null});return value;};
const call=(id,dead=false)=>{const value=graph();if(dead)value.controls.push({kind:'join',inputs:[]});value.calls.push({functionId:id,arguments:[],environment:null,callee:null,receiver:null,heap:0,control:dead?1:0,site:'syntax-call'});return value;};
/** @param {Map<string,{graph:Parameters<typeof inclusion>[0]|null}>} contracts */
const prove=contracts=>inclusion(graph(),graph(),contracts,meter());
/** @returns {Parameters<typeof read>[1]} */
const directory=()=>({functionId:'unused',types:new Map([['void',{kind:'void'}]]),functions:new Map([['unused',{kind:'source',parameterTypes:[],returnType:'void',lexicalEnvironment:null,activationEnvironment:null}]]),globals:new Map(),fields:new Set(),environments:new Map(),constructions:new Map()});

test('a reader-typed unrelated unknown graph cannot contaminate a call-free proof',()=>{
  const typed=read(unknown(),directory(),meter());assert.equal(typed.status,'typed');if(typed.status!=='typed')return;
  assert.deepEqual(prove(new Map([['unused',{graph:typed.graph}]])),{status:'covered',reason:null});
});
test('an unrelated absent graph is ignored only at the lower typed API',()=>{
  assert.deepEqual(prove(new Map([['unused',{graph:null}]])),{status:'covered',reason:null});
});
test('unknown in either selected comparison root remains Open',()=>{
  for(const [body,upper]of [[unknown(),graph()],[graph(),unknown()]])assert.equal(inclusion(body,upper,new Map(),meter()).status,'open');
});
test('a selected unknown or absent fixed callee remains Open',()=>{
  for(const selected of [unknown(),null])assert.equal(inclusion(call('F'),call('F'),new Map([['F',{graph:selected}]]),meter()).status,'open');
});
test('the upper root and transitive fixed syntax calls are dependency roots',()=>{
  const contracts=new Map([['F',{graph:call('G')}],['G',{graph:unknown()}]]);
  assert.equal(inclusion(graph(),call('F'),contracts,meter()).status,'open');
  assert.equal(inclusion(call('F'),call('F'),contracts,meter()).status,'open');
  contracts.delete('G');assert.equal(inclusion(call('F'),call('F'),contracts,meter()).status,'open');
});
test('dead syntax calls cannot hide a related unknown or missing summary',()=>{
  const body=call('F',true);
  assert.equal(inclusion(body,body,new Map([['F',{graph:unknown()}]]),meter()).status,'open');
  assert.equal(inclusion(body,body,new Map(),meter()).status,'open');
  assert.equal(inclusion(call('F'),call('F'),new Map([['F',{graph:call('G',true)}],['G',{graph:unknown()}]]),meter()).status,'open');
});
test('recursive syntax closure terminates without importing an unrelated unknown',()=>{
  const body=call('F'),contracts=new Map([['F',{graph:call('G')}],['G',{graph:call('F')}],['unused',{graph:unknown()}]]);
  assert.deepEqual(inclusion(body,body,contracts,meter()),{status:'covered',reason:null});
});
test('the complete graph reader still rejects corrupt unrelated nonnull metadata before inclusion',()=>{
  const corrupt=graph();corrupt.nodes.push({kind:'join',type:null,inputs:[9]});let entered=false;
  assert.throws(()=>{const rows=new Map();for(const [id,raw]of new Map([['unused',corrupt]])){const checked=read(raw,directory(),meter());assert.equal(checked.status,'typed');if(checked.status==='typed')rows.set(id,{graph:checked.graph});}
    entered=true;prove(rows);},error=>error instanceof TypeError&&'code' in error&&error.code==='return-origin-graph-boundary');
  assert.equal(entered,false);
});
