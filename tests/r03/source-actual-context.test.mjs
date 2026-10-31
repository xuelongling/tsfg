// SPDX-License-Identifier: MIT
// Pure abstract metadata snapshots. No AST/Facts/Program/State/VM is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonActualContextSnapshot} from '../../compiler/common-program-actual-context.mjs';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

function fixture(){
  const spend=commonMeter(),types=new Map([['B',{id:'B',kind:'reference',name:'B'}],['i32',{id:'i32',kind:'scalar',name:'i32'}]]),objects=new Map();
  const a=commonAbstract({spend,types}),receiver=commonReceiverActual({spend,types,objects},a),regions=commonRegions(spend);
  const world=receiver.store(),frame=receiver.create(world,{activation:'activation',site:'site',owner:'B',construction:'ctor:B',newTarget:'B',derived:false,fields:['F']}),
    bound=a.literal('B');bound.refs.add('object:B');bound.region={roots:new Set(['origin']),opaque:false,empty:false,number:null};objects.set('object:B',{type:'B',weak:false});
  const selected=receiver.bind(world,new Set([frame]),bound);assert.ok(selected.normal);const frames=selected.normal.frames;
  const arg=a.empty();arg.frames.add(frame);
  const heap=new Map([['object:B/field/F',a.literal('i32')],['unreachable/field/F',a.literal('i32')]]);
  const regionHeap=new Map([['origin',new Map([['child',{roots:new Set(['child-origin']),opaque:false,empty:false,number:null}]])],['child-origin',new Map()],['unreachable-origin',new Map()]]);
  const input={target:'ctor:B',args:[arg],heap,frameWorld:frames,regionHeap,activation:'activation',repeated:false,regionScope:'scope'};
  return {spend,a,receiver,regions,frame,input};
}

test('a hidden bound receiver region participates in context identity and owned snapshots',()=>{
  const {spend,a,receiver,regions,frame,input}=fixture(),other=receiver.clone(input.frameWorld),changed=other.get(frame);assert.ok(changed);
  changed.bound.region.opaque=true;
  const original=input.frameWorld.get(frame);assert.ok(original);
  assert.equal(a.key(original.bound),a.key(changed.bound),'payload keys deliberately exclude regions');
  assert.equal(receiver.key(input.frameWorld),receiver.key(other),'same frame and payload metadata');
  const before=commonActualContextSnapshot(input,a,receiver,regions,spend),after=commonActualContextSnapshot({...input,frameWorld:other},a,receiver,regions,spend);
  assert.notEqual(before.key,after.key,'hidden bound opaque is part of the invocation key');
  assert.equal(regions.heapKey(before.entryRegions),regions.heapKey(after.entryRegions),'reachable region cells did not change');
  assert.equal(before.entryFrames.get(frame).bound.region.opaque,false);assert.equal(after.entryFrames.get(frame).bound.region.opaque,true);
  assert.ok(before.entryHeap.has('object:B/field/F'),'retained this roots payload reachability');assert.equal(before.entryHeap.has('unreachable/field/F'),false);
  assert.ok(before.entryRegions.has('origin'));assert.ok(before.entryRegions.has('child-origin'));assert.equal(before.entryRegions.has('unreachable-origin'),false);
  original.bound.region.roots.add('later');input.heap.get('object:B/field/F').tags.add('later');input.regionHeap.get('origin').set('later',{roots:new Set(),opaque:true,empty:false,number:null});
  assert.equal(before.entryFrames.get(frame).bound.region.roots.has('later'),false);
  assert.equal(before.entryHeap.get('object:B/field/F').tags.has('later'),false);assert.equal(before.entryRegions.get('origin').has('later'),false);
});

test('rootless opaque, empty and numeric region facets are keyed even without region cells',()=>{
  const {spend,a,receiver,regions,input}=fixture(),base=a.literal('i32'),payload=a.key(base),keys=new Set();
  const variants=[{opaque:false,empty:false,number:null},{opaque:true,empty:false,number:null},{opaque:false,empty:true,number:null},
    {opaque:false,empty:true,number:3},{opaque:false,empty:true,number:4}];
  for(const region of variants){
    const value=a.copy(base);value.region={...region,roots:new Set()};let calls=0;
    const tracked={key:selected=>{calls++;return regions.key(selected);},reachable:regions.reachable,heapKey:regions.heapKey};
    const snapshot=commonActualContextSnapshot({...input,args:[value],heap:new Map(),frameWorld:receiver.store(),regionHeap:new Map()},a,receiver,tracked,spend);
    assert.equal(a.key(value),payload);assert.equal(snapshot.entryRegions.size,0);assert.equal(calls,1,'every root invokes regions.key');keys.add(snapshot.key);
  }
  assert.equal(keys.size,variants.length);
});

test('outer re-escaping and hashing use the same budget before constructing a context key',()=>{
  const meter=commonMeter(),largeKey='\0'.repeat(8192);let remaining=100000,frameKeyReached=false;
  const spend=units=>{meter(units);remaining-=units;},value={region:{roots:new Set(),opaque:false,empty:false,number:null}},
    a={reachable:()=>{spend(1);return new Map();},key:()=>{spend(1);return 'value';}},
    receiver={select:()=>{spend(1);return new Map();},retained:()=>{spend(1);return [];},key:()=>{frameKeyReached=true;spend(remaining-64);return largeKey;}},
    regions={key:()=>{spend(1);return 'region';},reachable:()=>{spend(1);return new Map();},heapKey:()=>{spend(1);return 'heap';}},
    input={target:'F',args:[value],heap:new Map(),frameWorld:new Map(),regionHeap:new Map(),activation:'A',repeated:false,regionScope:''};
  assert.throws(()=>commonActualContextSnapshot(input,a,receiver,regions,spend),{code:'r03-common-program-limit'});
  assert.equal(frameKeyReached,true,'the callback finished; the outer serialization reservation exhausts the budget');
});

test('global-only reachable values retain their own region identity and region heap version',()=>{
  const {spend,a,receiver,regions,input}=fixture(),global=a.literal('B');global.refs.add('object:B');global.region={roots:new Set(['origin']),opaque:false,empty:false,number:null};
  const changed=a.copy(global);changed.region.opaque=true;
  assert.equal(a.key(global),a.key(changed));
  const beforeInput={...input,args:[],frameWorld:receiver.store(),heap:new Map([['global:G',global]])},
    afterInput={...beforeInput,heap:new Map([['global:G',changed]])};
  const before=commonActualContextSnapshot(beforeInput,a,receiver,regions,spend),after=commonActualContextSnapshot(afterInput,a,receiver,regions,spend);
  assert.notEqual(before.key,after.key,'global memory regions are part of the entry snapshot');
  assert.equal(before.entryHeap.get('global:G').region.opaque,false);assert.equal(after.entryHeap.get('global:G').region.opaque,true);
  assert.ok(before.entryRegions.has('origin'));assert.ok(before.entryRegions.has('child-origin'));
  const newerRegions=regions.heapCopy(input.regionHeap);newerRegions.get('origin').get('child').opaque=true;
  const newer=commonActualContextSnapshot({...beforeInput,regionHeap:newerRegions},a,receiver,regions,spend);
  assert.notEqual(before.key,newer.key,'reachable global relation-heap versions are also keyed');
});

test('ordered retained frames keep region association while ignoring frame insertion order',()=>{
  const {spend,a,receiver,regions,frame,input}=fixture(),world=receiver.clone(input.frameWorld),second=receiver.create(world,
    {activation:'activation',site:'second-site',owner:'B',construction:'ctor:B',newTarget:'B',derived:false,fields:['F']}),bound=a.literal('B');
  bound.refs.add('object:B');bound.region={roots:new Set(['other-origin']),opaque:false,empty:false,number:null};
  const selected=receiver.bind(world,new Set([second]),bound);assert.ok(selected.normal);const frames=selected.normal.frames,swapped=receiver.clone(frames),
    firstBinding=swapped.get(frame),secondBinding=swapped.get(second);assert.ok(firstBinding);assert.ok(secondBinding);
  const originalRegion=regions.copy(firstBinding.bound.region);firstBinding.bound.region=regions.copy(secondBinding.bound.region);secondBinding.bound.region=originalRegion;
  const forward=a.empty(),reverse=a.empty();forward.frames.add(frame);forward.frames.add(second);reverse.frames.add(second);reverse.frames.add(frame);
  assert.equal(a.key(forward),a.key(reverse),'frame sets have the same actual payload key');
  assert.equal(receiver.key(frames),receiver.key(swapped),'bound regions are separate from the existing frame payload key');
  const regionHeap=regions.heapCopy(input.regionHeap);regionHeap.set('other-origin',new Map());
  const original=commonActualContextSnapshot({...input,args:[forward],frameWorld:frames,regionHeap},a,receiver,regions,spend),
    changed=commonActualContextSnapshot({...input,args:[reverse],frameWorld:swapped,regionHeap},a,receiver,regions,spend);
  assert.notEqual(original.key,changed.key,'swapping frame regions cannot be cancelled by reversing insertion order');
  const insertionOnly=commonActualContextSnapshot({...input,args:[reverse],frameWorld:frames,regionHeap},a,receiver,regions,spend);
  assert.equal(original.key,insertionOnly.key,'the same frame-region association has a canonical key');
});
