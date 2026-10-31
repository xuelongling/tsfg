// SPDX-License-Identifier: MIT
// Independent literal Graph5 equation DTO premises. No graph factory,
// Source/AST, solver, Program or Runtime import/construction is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readCommonReturnOriginGraph as read} from '../../compiler/common-program-return-origin-graph.mjs';

/** @returns {Parameters<typeof read>[1]} */
const directory=()=>({functionId:'F',types:new Map([
  ['View',{kind:'scalar'}],['Box',{kind:'reference'}],['Value',{kind:'value'}],['Union',{kind:'union'}],['Unknown',{kind:'unknown'}],['void',{kind:'void'}],
]),functions:new Map([
  ['F',{kind:'source',parameterTypes:['View'],returnType:'View',lexicalEnvironment:null,activationEnvironment:null}],
  ['M',{kind:'method',parameterTypes:['Box','View'],returnType:'View',lexicalEnvironment:null,activationEnvironment:null}],
  ['C',{kind:'construction-body',parameterTypes:['Box'],returnType:'Box',lexicalEnvironment:null,activationEnvironment:null}],
]),constructions:new Map(),globals:new Map([['G','View']]),fields:new Set(['owner','box']),environments:new Map([['E',{parent:null,slots:[{key:'slot',type:'Union',writable:false}]}]])});
/** @returns {import('../../compiler/common-program-return-origin-graph.mjs').Graph} */
const graph=()=>({format:{family:'tsfg.return-origin-graph-candidate',version:5},
  nodes:[{kind:'parameter',type:'View',index:0}],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[0],language:[],
  exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]});
const meter=(remaining=20000000)=>(units=1)=>{assert.ok(Number.isSafeInteger(units)&&units>=0);if(units>remaining)throw new Error('fixture work exhausted');remaining-=units;};
const reject=(value,d=directory())=>assert.throws(()=>read(value,d,meter()),/** @param {unknown} error */error=>error instanceof TypeError&&Object.hasOwn(error,'code'));

test('ordinary v5 typed graph is an owned copy with no identity certificate',()=>{
  const raw=graph(),result=read(raw,directory(),meter());assert.equal(result.status,'typed');
  if(result.status!=='typed')return;assert.deepEqual(result.graph,raw);assert.notEqual(result.graph.nodes,raw.nodes);
  raw.nodes[0]={kind:'unknown',type:null};assert.equal(result.graph.nodes[0].kind,'parameter');assert.equal(Object.hasOwn(result,'covered'),false);
});

test('all four reference namespaces enforce range and ordered unique lists',()=>{
  const node=graph();node.nodes.push({kind:'join',type:'View',inputs:[2]});reject(node);
  const heap=graph();heap.heaps[0]={kind:'join',inputs:[1]};reject(heap);
  const control=graph();control.controls[0]={kind:'join',inputs:[1]};reject(control);
  const call=graph();call.nodes.push({kind:'call',type:'View',call:0,completion:'normal'});reject(call);
  const duplicate=graph();duplicate.normal=[0,0];reject(duplicate);
  const reversed=graph();reversed.nodes.push({kind:'global',type:'View',id:'G'});reversed.normal=[1,0];reject(reversed);
  const fractional=graph();fractional.normal=[0.5];reject(fractional);
});

test('seedless joins and data Bottom retain independent completion control',()=>{
  const raw=graph();raw.nodes=[{kind:'join',type:null,inputs:[0]}];raw.heaps=[{kind:'join',inputs:[0]}];
  raw.controls=[{kind:'entry'},{kind:'join',inputs:[]}];raw.exits.normal=[{heap:0,control:0},{heap:0,control:1}];
  assert.equal(read(raw,directory(),meter()).status,'typed');
  raw.exits.normal.reverse();reject(raw);raw.exits.normal=[{heap:0,control:0},{heap:0,control:0}];reject(raw);
});

test('parameter/global/capture Source views are directory-bound, not actual tags',()=>{
  const d=directory(),raw=graph();d.functions.set('F',{kind:'source',parameterTypes:['Union'],returnType:'View',lexicalEnvironment:'E',activationEnvironment:null});
  raw.nodes=[{kind:'parameter',type:'Union',index:0},{kind:'global',type:'View',id:'G'},{kind:'environmentInput',type:null,layout:'E'},
    {kind:'capture',type:'Union',id:'slot',layout:'E',environment:[2],heap:0,control:0}];raw.normal=[0,1,3];
  assert.equal(read(raw,d,meter()).status,'typed');
  const wrongGlobal=graph();wrongGlobal.nodes=[{kind:'global',type:'Box',id:'G'}];reject(wrongGlobal);
  const wrongCapture=graph();wrongCapture.nodes=[{kind:'environmentInput',type:null,layout:'E'},
    {kind:'capture',type:'View',id:'slot',layout:'E',environment:[0],heap:0,control:0}];wrongCapture.normal=[1];reject(wrongCapture,d);
  const wrongParameter=graph();wrongParameter.nodes=[{kind:'parameter',type:'View',index:1}];reject(wrongParameter);
});

test('local actual tags exclude erased unions/unknown while unknown roots stay typed',()=>{
  for(const type of ['Union','Unknown','void']){const raw=graph();raw.nodes=[{kind:'local',type}];reject(raw);}
  const raw=graph();raw.nodes=[{kind:'unknown',type:null}];assert.equal(read(raw,directory(),meter()).status,'typed');
  const concrete=graph();concrete.nodes=[{kind:'local',type:'Value'}];assert.equal(read(concrete,directory(),meter()).status,'typed');
});

test('exact DTO keys and current v5 format reject old or extended rows',()=>{
  reject({...graph(),extra:true});const node=graph();Object.assign(node.nodes[0],{extra:true});reject(node);
  for(const version of [2,3,4]){const format=graph();Object.assign(format.format,{version});reject(format);}
  reject({...graph(),calls:[{functionId:'F',arguments:[[0]],heap:0,control:0,site:'old-unpaired-call'}]});
  reject({...graph(),nodes:[{kind:'capture',type:'Union',id:'slot'}]});
  const malformed=graph();Object.assign(malformed.nodes[0],{type:null});reject(malformed);
});

test('field/view membership is typed without deriving access permission',()=>{
  const raw=graph();raw.nodes.push({kind:'projection',type:'Box',bases:[0],selector:'field:owner',view:'View',heap:0,control:0});raw.normal=[1];
  assert.equal(read(raw,directory(),meter()).status,'typed');
  const unknownField=graph();unknownField.nodes.push({kind:'projection',type:'Box',bases:[0],selector:'field:missing',view:'View',heap:0,control:0});reject(unknownField);
  raw.nodes[1]={kind:'projection',type:'Box',bases:[0],selector:'element',view:'View',heap:0,control:0};assert.equal(read(raw,directory(),meter()).status,'typed');
  raw.heaps.push({kind:'store',previous:0,bases:[0],selector:'field:box',view:'View',values:[1],control:0,initialize:true});
  assert.equal(read(raw,directory(),meter()).status,'typed'); // No raw const/readonly initialization authority follows.
});

test('calls preserve ordered logical arguments and distinguish native empty alias data',()=>{
  const raw=graph();raw.calls=[{functionId:'F',arguments:[[]],environment:null,callee:null,receiver:null,heap:0,control:0,site:''}];
  raw.nodes.push({kind:'call',type:'View',call:0,completion:'normal'},{kind:'call',type:null,call:0,completion:'language'});
  raw.controls.push({kind:'call',call:0,completion:'normal'});raw.heaps.push({kind:'call',call:0,completion:'normal'});
  raw.normal=[1];raw.language=[2];raw.exits.normal=[{heap:1,control:1}];assert.equal(read(raw,directory(),meter()).status,'typed');
  const wrongArity=graph();wrongArity.calls=[{functionId:'F',arguments:[],environment:null,callee:null,receiver:null,heap:0,control:0,site:'call'}];reject(wrongArity);
  const wrongResult=graph();wrongResult.calls=[{functionId:'F',arguments:[[0]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'call'}];wrongResult.nodes.push({kind:'call',type:'Box',call:0,completion:'normal'});reject(wrongResult);
  wrongResult.nodes[1]={kind:'call',type:'View',call:0,completion:'language'};reject(wrongResult);
});

test('ordinary method arity includes receiver; construction and missing Env metadata are Open',()=>{
  const d=directory();d.functionId='M';const raw=graph();raw.nodes=[{kind:'parameter',type:'Box',index:0},{kind:'parameter',type:'View',index:1}];raw.normal=[1];
  raw.calls=[{functionId:'M',arguments:[[0],[1]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'method'}];assert.equal(read(raw,d,meter()).status,'typed');
  const constructor=graph();constructor.calls=[{functionId:'C',arguments:[[0]],environment:null,callee:null,receiver:null,heap:0,control:0,site:'new'}];assert.deepEqual(read(constructor,directory(),meter()),{status:'open',reason:'construction-metadata-open'});
  const current=directory();current.functionId='C';assert.deepEqual(read(graph(),current,meter()),{status:'open',reason:'construction-metadata-open'});
  const env=directory();env.functions.set('F',{kind:'source',parameterTypes:['View'],returnType:'View',lexicalEnvironment:null,activationEnvironment:'E'});
  assert.equal(read(graph(),env,meter()).status,'typed','a complete ordinary Env protocol is supported');
  env.functions.set('F',{kind:'source',parameterTypes:['View'],returnType:'View',activationEnvironment:'E'});
  assert.deepEqual(read(graph(),env,meter()),{status:'open',reason:'code-environment-metadata-open'});
});

test('copy storage closure and access canonical ordering use actual v5 records',()=>{
  const raw=graph();raw.nodes.push({kind:'copy',type:'View',bases:[0],heap:0,control:0,site:'opaque/copy'});raw.heaps.push({kind:'copy',previous:0,value:1});
  raw.accesses=[{values:[0],flag:'read',control:0},{values:[0],flag:'write',control:0}];assert.equal(read(raw,directory(),meter()).status,'typed');
  raw.accesses.reverse();reject(raw);raw.accesses=[];raw.heaps[1]={kind:'copy',previous:0,value:0};reject(raw);
});

test('shared work exhaustion is not Open and there is no invented 65536 reference cap',()=>{
  assert.throws(()=>read(graph(),directory(),meter(1)),/work exhausted/);
  const raw=graph();raw.nodes=[];raw.normal=[];
  for(let index=0;index<65537;index++){raw.nodes.push({kind:'join',type:'View',inputs:[]});raw.normal.push(index);}
  assert.equal(read(raw,directory(),meter()).status,'typed');
});
