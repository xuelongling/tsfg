// SPDX-License-Identifier: MIT
// Independent already-admitted HIR/effect premises for the scalar proof helper.
// No Scope/Runtime admission or body coverage is manufactured by these rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonReturnOriginAvailability,commonReturnOriginScalarProof} from '../../compiler/common-program-return-origin-source.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
const range={start:0,end:10},R='recursive',W='wrapper',call=id=>({kind:'call',callee:id,type:'i32',signature:{parameters:[],returnType:'i32'},arguments:[],range});
const fn=(id,body)=>({id,kind:'source',sourcePath:'/scalar-proof.ts',parameters:[],bindings:[],captures:[],ownerType:null,lexicalEnvironment:null,activationEnvironment:null,returnType:'i32',range,body});
const upper=()=>({parameters:[],captures:[],globals:{reads:[],writes:[]},hostResources:{reads:[],writes:[]},facets:{allocation:false,managedReference:false,ehControl:false,mayThrow:false,await:false,lock:false,escape:false,unknownHost:false}});
const stale=()=>({format:{family:'tsfg.return-origin-graph-candidate',version:4},nodes:[{kind:'nonowning',type:'i32'}],heaps:[{kind:'entry'}],controls:[{kind:'entry'}],calls:[],normal:[0],language:[],exits:{normal:[{heap:0,control:0}],language:[]},accesses:[]});
const premise=()=>{const hir={types:[{id:'i32',kind:'scalar',name:'i32'}],globals:[],environments:[],functions:[fn(R,[{kind:'return',range,value:call(R)}]),fn(W,[{kind:'return',range,value:call(R)}])]},spend=commonMeter(1000000),
  availability=commonReturnOriginAvailability(hir,{site:()=>({top:false,functions:[]})},{dispatch:()=>[]},spend),
  records=new Map([[R,{upper:upper(),returnOrigins:stale()}],[W,{upper:upper(),returnOrigins:null}]]);return {availability,records,spend};};
test('a supplied nonnull scalar SCC graph cannot use the null capability exception after body coverage was unavailable',()=>{
  const {availability,records,spend}=premise();assert.equal(availability.reasons.get(R),'recursive-return-open');
  assert.equal(commonReturnOriginScalarProof(R,availability,records,spend,new Set()),false);
});
test('a null scalar caller cannot hide an uncovered nonnull fixed target through its helper closure',()=>{
  const {availability,records,spend}=premise();assert.equal(availability.reasons.get(W),'fixed-callee-return-open');
  assert.equal(commonReturnOriginScalarProof(W,availability,records,spend,new Set()),false);
});
test('a genuinely null complete scalar closure retains its independent Source exception',()=>{
  const {availability,records,spend}=premise();records.get(R).returnOrigins=null;
  assert.equal(commonReturnOriginScalarProof(W,availability,records,spend,new Set()),true);
});
