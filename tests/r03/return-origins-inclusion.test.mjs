// SPDX-License-Identifier: MIT
// Literal equation DTOs only. This fixture imports no Source/AST/Runtime code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOriginsInclusion as inclusion} from '../../compiler/common-program-return-origin-inclusion.mjs';

const graph=()=>/** @type {Parameters<typeof inclusion>[0]} */ ({nodes:[],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[],language:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]});
const meter=()=>{let left=200000;return (units=1)=>{left-=units;if(left<0)throw new Error('fixture budget exhausted');};};
const prove=(body,upper,contracts=new Map())=>inclusion(body,upper,contracts,meter()).status;
const parameter=()=>{const row=graph();row.nodes.push({kind:'parameter',type:'View',index:0});row.normal=[0];return row;};
const afterWrite=after=>{const row=graph();row.nodes.push({kind:'parameter',type:'Box',index:0},{kind:'parameter',type:'Box',index:1},{kind:'global',type:'B',id:'G'},
  {kind:'projection',type:'B',bases:[1],selector:'field:owner',view:'Box',heap:after?1:0,control:0});
  row.heaps.push({kind:'store',previous:0,bases:[0],selector:'field:owner',view:'Box',values:[2],initialize:false,control:0});
  row.normal=[3];row.exits.normal=[{heap:1,control:0}];row.accesses=[{values:[0],flag:'write',control:0}];return row;};
const copies=separate=>{const row=graph();row.nodes.push({kind:'local',type:'Value'},{kind:'local',type:'Box'},
  {kind:'copy',type:'NativeView',bases:[0],site:'left-copy',heap:0,control:0});
  row.heaps.push({kind:'copy',previous:0,value:2});
  if(separate){row.nodes.push({kind:'copy',type:'OtherView',bases:[0],site:'right-copy',heap:1,control:0});row.heaps.push({kind:'copy',previous:1,value:3});}
  row.heaps.push({kind:'store',previous:row.heaps.length-1,bases:[1],selector:'field:left',view:'Box',values:[2],initialize:true,control:0});
  row.heaps.push({kind:'store',previous:row.heaps.length-1,bases:[1],selector:'field:right',view:'Box',values:[separate?3:2],initialize:true,control:0});
  row.normal=[1];row.exits.normal=[{heap:row.heaps.length-1,control:0}];row.accesses=[{values:[1],flag:'write',control:0}];return row;};

test('a selective parameter upper excludes an unrelated global',()=>{
  const upper=parameter(),body=parameter();body.nodes.push({kind:'global',type:'B',id:'G'});
  assert.equal(prove(body,upper),'covered');body.normal=[1];assert.equal(prove(body,upper),'open');
});
test('may-alias write/read order is retained by the certificate',()=>{
  assert.equal(prove(afterWrite(true),afterWrite(true)),'covered');
  assert.equal(prove(afterWrite(true),afterWrite(false)),'open');
});
test('an epsilon heap cycle cannot stand in for arbitrary entry contents',()=>{
  const upper=graph();upper.nodes.push({kind:'parameter',type:'Box',index:0},{kind:'global',type:'B',id:'G'});
  upper.heaps[0]={kind:'store',previous:0,bases:[0],selector:'field:owner',view:'Box',values:[1],initialize:false,control:0};
  assert.equal(prove(graph(),upper),'open');
});
test('heap Bottom does not remove an independently reachable completion',()=>{
  const body=graph(),upper=graph();body.heaps[0]={kind:'join',inputs:[0]};upper.exits.normal=[];
  assert.equal(prove(body,upper),'open');upper.exits.normal=[{heap:0,control:0}];assert.equal(prove(body,upper),'covered');
});
test('native data is Bottom for origins while native completion remains live',()=>{
  const body=graph();body.nodes.push({kind:'nonowning',type:'i32'});body.normal=[0];assert.equal(prove(body,graph()),'covered');
  const upper=graph();upper.exits.normal=[];assert.equal(prove(body,upper),'open');
});
test('copy scopes have one consistent alpha match across all content edges',()=>{
  const upper=copies(false),copy=upper.nodes[2];if(copy.kind==='copy')copy.site='published-copy';
  assert.equal(prove(copies(false),upper),'covered');assert.equal(prove(copies(false),copies(true)),'open');
});
test('fixed recursive calls are matched without recursively expanding digests',()=>{
  const fixed=parameter();fixed.nodes.push({kind:'call',type:'View',call:0,completion:'normal'});
  fixed.calls=[{functionId:'F',arguments:[[0]],heap:0,control:0,site:'recursive-call'}];
  fixed.controls.push({kind:'call',call:0,completion:'normal'});fixed.heaps.push({kind:'call',call:0,completion:'normal'});
  fixed.normal=[0,1];fixed.exits.normal.push({heap:1,control:1});
  assert.equal(prove(fixed,fixed,new Map([['F',{graph:fixed}]])),'covered');
  const upper=parameter();assert.equal(prove(fixed,upper,new Map([['F',{graph:fixed}]])),'open');
});
test('an unresolved unknown is never an implicit owning-data permission',()=>{
  const unknown=graph();unknown.nodes.push({kind:'unknown',type:null});unknown.normal=[0];
  assert.equal(prove(unknown,unknown),'open');
});
test('large valid reference directories exhaust the shared meter',()=>{
  const body=graph(),upper=graph();
  for(let index=0;index<512;index++){body.nodes.push({kind:'parameter',type:'View',index});upper.nodes.push({kind:'parameter',type:'View',index});body.normal.push(index);upper.normal.push(index);}
  let remaining=1500;
  assert.throws(()=>inclusion(body,upper,new Map(),(units=1)=>{remaining-=units;if(remaining<0)throw new Error('fixture budget exhausted');}),/fixture budget exhausted/);
});
