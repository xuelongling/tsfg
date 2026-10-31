// SPDX-License-Identifier: MIT
// Complete inner owned entry identities, without Source or Runtime admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';
import {commonActualContextValues,commonActualContextSnapshot,commonActualContextSame} from '../../compiler/common-program-actual-context.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

function fixture(){
  const spend=commonMeter(1000000),types=new Map([['B',{id:'B',kind:'reference'}],['i32',{id:'i32',kind:'scalar'}]]),objects=new Map([['object:B',{type:'B',weak:true}]]),
    a=commonAbstract({spend,types}),regions=commonRegions(spend),receiver=commonReceiverActual({spend,types,objects},a),identity=commonActualContextValues(a,regions,spend),world=receiver.store();
  const id=receiver.create(world,{activation:'activation',site:'first',owner:'B',construction:'ctor:B',newTarget:'B',derived:false,fields:['F']});
  const bound=a.literal('B');bound.refs.add('object:B');bound.region={roots:new Set(['bound-origin']),opaque:false,empty:false,number:5};
  const selected=receiver.bind(world,new Set([id]),bound);assert.ok(selected.normal);const frames=selected.normal.frames,real=a.literal('i32',1,7);
  real.pairs.set('pair',{functionId:'code',environment:'environment'});real.region={roots:new Set(['real-origin']),opaque:false,empty:false,number:7};
  const heap=new Map([['object:B/field/F',real]]);receiver.birth(frames,id,'object:B',['F'],heap,true);
  const control=a.empty();control.frames.add(id);
  return {spend,a,regions,receiver,identity,frames,id,heap,control,real};
}

test('receiver owner compares every control flag and bound payload without inventing bound region identity',()=>{
  const {receiver,identity,frames,id}=fixture();
  /** @type {[string,(value:ReturnType<typeof frames.get>)=>void][]} */
  const mutations=[
    ['unbound',value=>value.unbound=true],['weak',value=>value.weak=true],['pending',value=>value.pending=true],
    ['initializing',value=>value.initializing=true],['aborted',value=>value.aborted=true],
    ['prefixMin',value=>value.prefixMin=1],['prefixMax',value=>value.prefixMax=1],
    ['bound',value=>value.bound.tags.add('different')],
  ];
  for(const [label,mutate]of mutations){const changed=receiver.clone(frames);mutate(changed.get(id));
    assert.equal(receiver.same(frames,changed,identity),false,label);assert.equal(receiver.same(changed,frames,identity),false,label);}
  const regionOnly=receiver.clone(frames);regionOnly.get(id).bound.region.opaque=true;
  assert.equal(receiver.same(frames,regionOnly,identity),true,'bound regions belong to the independent retained projection');
  assert.equal(frames.get(id).bound.region.opaque,false);
  const renamed=new Map([['different-frame',receiver.clone(frames).get(id)]]);
  assert.equal(receiver.same(frames,renamed,identity),false,'same size is not the same frame-key set');
});

test('receiver births retain slot ref pending and every full real Value facet',()=>{
  const {receiver,identity,frames,id}=fixture(),slot='object:B/field/F';
  /** @type {[string,(value:ReturnType<typeof frames.get>)=>void][]} */
  const mutations=[
    ['slot',binding=>{const row=binding.births.get(slot);binding.births.delete(slot);binding.births.set('other-slot',row);}],
    ['ref',binding=>binding.births.get(slot).ref='other-reference'],
    ['pending',binding=>binding.births.get(slot).pending=false],
    ['tags',binding=>binding.births.get(slot).real.tags.add('different')],
    ['refs',binding=>binding.births.get(slot).real.refs.add('different')],
    ['cells',binding=>binding.births.get(slot).real.cells.add('different')],
    ['frames',binding=>binding.births.get(slot).real.frames.add('different')],
    ['cursors',binding=>binding.births.get(slot).real.cursors.add('different')],
    ['pair key',binding=>{const value=binding.births.get(slot).real;value.pairs.set('other',value.pairs.get('pair'));value.pairs.delete('pair');}],
    ['pair code',binding=>binding.births.get(slot).real.pairs.set('pair',{functionId:'different',environment:'environment'})],
    ['pair env',binding=>binding.births.get(slot).real.pairs.set('pair',{functionId:'code',environment:null})],
    ['truth',binding=>binding.births.get(slot).real.truth=2],
    ['unknown',binding=>binding.births.get(slot).real.unknown=true],
    ['number',binding=>binding.births.get(slot).real.number=8],
    ['opaque',binding=>binding.births.get(slot).real.region.opaque=true],
    ['empty',binding=>binding.births.get(slot).real.region.empty=true],
    ['region number',binding=>binding.births.get(slot).real.region.number=8],
    ['same-size roots',binding=>binding.births.get(slot).real.region.roots=new Set(['other-origin'])],
  ];
  for(const [label,mutate]of mutations){const changed=receiver.clone(frames);mutate(changed.get(id));
    assert.equal(receiver.same(frames,changed,identity),false,label);assert.equal(receiver.same(changed,frames,identity),false,label);}
  assert.deepEqual([...frames.get(id).births.get(slot).real.region.roots],['real-origin']);
  assert.equal(frames.get(id).births.get(slot).real.pairs.get('pair').functionId,'code');
});

test('typed owner equality ignores Map Set insertion order while preserving empty region rows and slots',()=>{
  const {receiver,identity,regions,frames,id}=fixture(),binding=receiver.clone(frames).get(id),copy=receiver.clone(frames);
  binding.births.set('second-slot',{ref:'second',pending:false,real:identity.captureArgs([binding.bound])[0]});
  frames.set('second-frame',binding);copy.get(id).births=new Map([...copy.get(id).births].reverse());
  copy.set('second-frame',receiver.clone(new Map([['copy',binding]])).get('copy'));
  copy.get('second-frame').births=new Map([...copy.get('second-frame').births].reverse());const reordered=new Map([...copy].reverse());
  assert.equal(receiver.same(frames,reordered,identity),true);
  const origin={roots:new Set(['one','two']),opaque:false,empty:false,number:3},empty={roots:new Set(),opaque:false,empty:false,number:null},
    heap=new Map([['origin',new Map([['slot',origin],['empty-slot',empty]])],['empty-origin',new Map()]]),
    reversed=new Map([['empty-origin',new Map()],['origin',new Map([['empty-slot',regions.copy(empty)],['slot',{...origin,roots:new Set(['two','one'])}]])]]);
  assert.equal(regions.heapSame(heap,reversed),true);
  const missingOuter=regions.heapCopy(heap);missingOuter.delete('empty-origin');assert.equal(regions.heapSame(heap,missingOuter),false);
  const renamedOuter=regions.heapCopy(heap);renamedOuter.delete('empty-origin');renamedOuter.set('other-empty',new Map());assert.equal(regions.heapSame(heap,renamedOuter),false);
  const missingSlot=regions.heapCopy(heap);missingSlot.get('origin').delete('empty-slot');assert.equal(regions.heapSame(heap,missingSlot),false);
  const renamedSlot=regions.heapCopy(heap);renamedSlot.get('origin').delete('empty-slot');renamedSlot.get('origin').set('other-empty-slot',empty);
  assert.equal(regions.heapSame(heap,renamedSlot),false);
  for(const mutate of [value=>value.opaque=true,value=>value.empty=true,value=>value.number=4,value=>value.roots=new Set(['one','different'])]){
    const changed=regions.heapCopy(heap);mutate(changed.get('origin').get('slot'));assert.equal(regions.heapSame(heap,changed),false);}
  const rootless=new Map([['row',new Map([['slot',{...empty,number:1}]])]]),nullNumber=regions.heapCopy(rootless);
  nullNumber.get('row').get('slot').number=null;assert.equal(regions.heapSame(rootless,nullNumber),false);
});

test('owned context snapshots and comparisons preserve inputs and the joint bound region identity',()=>{
  const {spend,a,receiver,regions,identity,frames,id,heap,control,real}=fixture(),
    versions=new Map([['bound-origin',new Map()],['real-origin',new Map()]]),
    input={target:'ctor:B',args:[control],heap,frameWorld:frames,regionHeap:versions,activation:'activation',repeated:false,regionScope:'scope'};
  const before=commonActualContextSnapshot(input,a,receiver,regions,spend),changedFrames=receiver.clone(frames);
  changedFrames.get(id).bound.region.opaque=true;
  const after=commonActualContextSnapshot({...input,frameWorld:changedFrames},a,receiver,regions,spend);
  assert.equal(receiver.same(before.entryFrames,after.entryFrames,identity),true);
  assert.equal(commonActualContextSame(before,after,identity,receiver,regions,spend),false);
  assert.equal(commonActualContextSame(before,commonActualContextSnapshot(input,a,receiver,regions,spend),identity,receiver,regions,spend),true);
  real.tags.add('later');frames.get(id).births.get('object:B/field/F').real.region.roots.add('later');
  versions.get('real-origin').set('later',{roots:new Set(),opaque:true,empty:false,number:null});
  assert.equal(before.entryHeap.get('object:B/field/F').tags.has('later'),false);
  assert.equal(before.entryFrames.get(id).births.get('object:B/field/F').real.region.roots.has('later'),false);
  assert.equal(before.entryRegions.get('real-origin').has('later'),false);
});

test('typed region lookups prepay long keys and roots without changing the input',()=>{
  const id='x'.repeat(8192),region={roots:new Set([id]),opaque:false,empty:false,number:null},left=new Map([[id,new Map()]]),right=new Map([[id,new Map()]]);
  assert.throws(()=>commonRegions(commonMeter(64)).heapSame(left,right),{code:'r03-common-program-limit'});
  assert.throws(()=>commonRegions(commonMeter(64)).same(region,{...region,roots:new Set([id])}),{code:'r03-common-program-limit'});
  assert.equal(left.has(id),true);assert.deepEqual([...region.roots],[id]);
});
