// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonActualContextSnapshot} from '../../compiler/common-program-actual-context.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

function snapshot(size,birth=false){
  const spend=commonMeter(),types=new Map(Array.from({length:size},(_,index)=>['T'+index,{id:'T'+index,kind:'reference'}]));
  const a=commonAbstract({spend,types}),regions=commonRegions(spend),objects=new Map(),receiver=commonReceiverActual({spend,types,objects},a),world=receiver.store();
  const frame=receiver.create(world,{activation:'entry',site:'site',owner:'T0',construction:'ctor',newTarget:'T0',derived:false,fields:[]});
  const bound=a.empty();for(const tag of (birth?['T0']:types.keys()))bound.tags.add(tag);
  const selected=receiver.bind(world,new Set([frame]),bound).normal.frames;
  if(birth){const real=a.empty();for(let index=0;index<size;index++)real.pairs.set('pair:'+index,{functionId:'f'+index,environment:null});
    receiver.birth(selected,frame,'object',['history'],new Map([['object/field/history',real]]),true);}
  const arg=a.empty();arg.frames.add(frame);
  return commonActualContextSnapshot({target:'f',args:[arg],heap:new Map(),frameWorld:selected,regionHeap:new Map(),activation:'entry/f',repeated:false,regionScope:''},a,receiver,regions,spend);
}
for(const birth of [false,true]){
  test((birth?'birth pairs':'bound tags')+' accepts the existing 256 boundary',()=>assert.doesNotThrow(()=>snapshot(256,birth)));
  test((birth?'birth pairs':'bound tags')+' rejects 257 retained entries with no heap rows',()=>assert.throws(()=>snapshot(257,birth),{code:'r03-common-program-limit'}));
}
