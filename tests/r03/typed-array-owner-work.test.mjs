// SPDX-License-Identifier: MIT
// Small owned-domain DAGs exercise the real helpers, not fabricated Source facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeArrayOwners,mapArrayOwner,createArrayOwnerTools} from '../../compiler/array-owner-trace.mjs';
import {analyzeArrayOwnerAccesses} from '../../compiler/array-call-model.mjs';
const owner=index=>({kind:'parameter',functionId:'callee',index});
const shared={kind:'aliases',owners:[owner(0),owner(1)]};
const dag={kind:'aliases',owners:[shared,shared]};
test('shared owner DAG expansion charges before leaf allocation and canonical sorting',()=>{
  const exhausted=new Error('inclusive owner work limit');let work=0;
  assert.throws(()=>mergeArrayOwners([dag],()=>{if(++work>3)throw exhausted;}),error=>error===exhausted);
  assert.equal(work,4);
  let full=0;assert.equal(mergeArrayOwners([dag],()=>{full++;}).owners.length,2);
  assert.ok(full>7,'leaf visits alone do not cover canonicalization and comparisons');
});
test('owner mapping charges call paths before copying and preserves cancellation first cause',()=>{
  const allocation={kind:'allocation',functionId:'leaf',allocationSite:'site',callPath:[
    {functionId:'middle',expressionPath:['body',0,'value']}]};
  const call={target:'leaf',arguments:[],expressionPath:['body',1,'value']};
  const cancelled=new Error('cancelled');let work=0;
  assert.throws(()=>mapArrayOwner(allocation,call,'root',()=>assert.fail('identity'),()=>{
    if(++work>2)throw cancelled;
  }),error=>error===cancelled);
  assert.equal(work,3);assert.equal(allocation.callPath.length,1);
});
test('three callable shared DAG retains four paths under one charged preparation',()=>{
  const range={start:0,end:1},call=target=>({kind:'call',target,type:'array',arguments:[],range});
  const branch=target=>[{kind:'if',condition:{kind:'boolean',type:'bool',value:true,range},
    then:[{kind:'return',value:call(target)}],else:[{kind:'return',value:call(target)}]}];
  // An owned analysis-unit fixture, not a Source packet or admission claim.
  const functions=[{id:'root',body:branch('middle')},{id:'middle',body:branch('leaf')},
    {id:'leaf',body:[{kind:'return',value:{kind:'arrayCreate',type:'array',elements:[],allocationSite:'site',range}}]}]
    .map(fn=>({...fn,parameters:[],returnType:{id:'array'},signatureHash:fn.id}));
  const hir={functions,types:[{id:'array',kind:'array',elementType:'bool'},{id:'bool',kind:'scalar'}],intrinsics:{readSpan:{id:'intrinsic'}}};
  const contracts=new Map(functions.map(fn=>[fn.id,{digest:fn.id,upper:{parameters:[],local:{read:true,write:true,structural:true},returnOrigin:null}}]));
  const fail=()=>assert.fail('unexpected analysis failure');let work=0;
  const result=analyzeArrayOwnerAccesses(hir,contracts,fail,createArrayOwnerTools(()=>{work++;}));
  const paths=result.functions.find(fn=>fn.functionId==='root').derivedReturnOrigin.owners;
  assert.equal(paths.length,4);assert.ok(paths.every(owner=>owner.callPath.length===2));assert.ok(work>25);
  const exhausted=new Error('shared low budget');let limited=0;
  assert.throws(()=>analyzeArrayOwnerAccesses(hir,contracts,fail,createArrayOwnerTools(()=>{
    if(++limited>8)throw exhausted;
  })),error=>error===exhausted);assert.equal(limited,9);
});
