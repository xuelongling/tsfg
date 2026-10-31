// SPDX-License-Identifier: MIT
// Pure abstract metadata snapshots. No AST/Facts/Program/State/VM is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonActualContextSnapshot,commonActualContextSame,commonActualContextValues} from '../../compiler/common-program-actual-context.mjs';
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
  assert.equal(receiver.same(input.frameWorld,other,commonActualContextValues(a,regions,spend)),true,'same frame and payload metadata');
  const before=commonActualContextSnapshot(input,a,receiver,regions,spend),after=commonActualContextSnapshot({...input,frameWorld:other},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(before,after,commonActualContextValues(a,regions,spend),receiver,regions,spend),false,'hidden bound opaque is part of the entry identity');
  assert.equal(regions.heapSame(before.entryRegions,after.entryRegions),true,'reachable region cells did not change');
  assert.equal(before.entryFrames.get(frame).bound.region.opaque,false);assert.equal(after.entryFrames.get(frame).bound.region.opaque,true);
  assert.ok(before.entryHeap.has('object:B/field/F'),'retained this roots payload reachability');assert.equal(before.entryHeap.has('unreachable/field/F'),false);
  assert.ok(before.entryRegions.has('origin'));assert.ok(before.entryRegions.has('child-origin'));assert.equal(before.entryRegions.has('unreachable-origin'),false);
  original.bound.region.roots.add('later');input.heap.get('object:B/field/F').tags.add('later');input.regionHeap.get('origin').set('later',{roots:new Set(),opaque:true,empty:false,number:null});
  assert.equal(before.entryFrames.get(frame).bound.region.roots.has('later'),false);
  assert.equal(before.entryHeap.get('object:B/field/F').tags.has('later'),false);assert.equal(before.entryRegions.get('origin').has('later'),false);
});

test('rootless opaque, empty and numeric region facets are keyed even without region cells',()=>{
  const {spend,a,receiver,regions,input}=fixture(),base=a.literal('i32'),payload=a.key(base),snapshots=[];
  const variants=[{opaque:false,empty:false,number:null},{opaque:true,empty:false,number:null},{opaque:false,empty:true,number:null},
    {opaque:false,empty:true,number:3},{opaque:false,empty:true,number:4}];
  for(const region of variants){
    const value=a.copy(base);value.region={...region,roots:new Set()};
    const snapshot=commonActualContextSnapshot({...input,args:[value],heap:new Map(),frameWorld:receiver.store(),regionHeap:new Map()},a,receiver,regions,spend);
    assert.equal(a.key(value),payload);assert.equal(snapshot.entryRegions.size,0);snapshots.push(snapshot);
  }
  for(let i=0;i<snapshots.length;i++)for(let j=i+1;j<snapshots.length;j++)assert.equal(commonActualContextSame(snapshots[i],snapshots[j],commonActualContextValues(a,regions,spend),receiver,regions,spend),false);
});

test('global-only reachable values retain their own region identity and region heap version',()=>{
  const {spend,a,receiver,regions,input}=fixture(),global=a.literal('B');global.refs.add('object:B');global.region={roots:new Set(['origin']),opaque:false,empty:false,number:null};
  const changed=a.copy(global);changed.region.opaque=true;
  assert.equal(a.key(global),a.key(changed));
  const beforeInput={...input,args:[],frameWorld:receiver.store(),heap:new Map([['global:G',global]])},
    afterInput={...beforeInput,heap:new Map([['global:G',changed]])};
  const before=commonActualContextSnapshot(beforeInput,a,receiver,regions,spend),after=commonActualContextSnapshot(afterInput,a,receiver,regions,spend);
  assert.equal(commonActualContextSame(before,after,commonActualContextValues(a,regions,spend),receiver,regions,spend),false,'global memory regions are part of the entry snapshot');
  assert.equal(before.entryHeap.get('global:G').region.opaque,false);assert.equal(after.entryHeap.get('global:G').region.opaque,true);
  assert.ok(before.entryRegions.has('origin'));assert.ok(before.entryRegions.has('child-origin'));
  const newerRegions=regions.heapCopy(input.regionHeap);newerRegions.get('origin').get('child').opaque=true;
  const newer=commonActualContextSnapshot({...beforeInput,regionHeap:newerRegions},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(before,newer,commonActualContextValues(a,regions,spend),receiver,regions,spend),false,'reachable global relation-heap versions are also keyed');
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
  assert.equal(receiver.same(frames,swapped,commonActualContextValues(a,regions,spend)),true,'bound regions are separate from the control payload identity');
  const regionHeap=regions.heapCopy(input.regionHeap);regionHeap.set('other-origin',new Map());
  const original=commonActualContextSnapshot({...input,args:[forward],frameWorld:frames,regionHeap},a,receiver,regions,spend),
    changed=commonActualContextSnapshot({...input,args:[reverse],frameWorld:swapped,regionHeap},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(original,changed,commonActualContextValues(a,regions,spend),receiver,regions,spend),false,'swapping frame regions cannot be cancelled by reversing insertion order');
  const insertionOnly=commonActualContextSnapshot({...input,args:[reverse],frameWorld:frames,regionHeap},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(original,insertionOnly,commonActualContextValues(a,regions,spend),receiver,regions,spend),true,'the same frame-region association has the same entry identity');
});

test('reachable heap ranges preserve raw complex prefixes and each current heap epoch',()=>{
  const a=commonAbstract({spend:commonMeter(),types:new Map([['B',{id:'B',kind:'reference'}],['i32',{id:'i32',kind:'scalar'}]])}),
    selected=a.literal('B'),global=a.literal('B');selected.refs.add('origin:a/slot/x');global.refs.add('global-child');
  const heap=new Map([['origin:a/slot/xy/field/no',a.literal('i32')],['origin:a/slot/x/field/yes',a.literal('i32',0,1)],
    ['global:G',global],['global-child/field/retained',a.literal('i32',0,3)],['unrelated/field/no',a.literal('i32')]]);
  const before=a.reachable([selected],heap);
  assert.deepEqual([...before.keys()].sort(),['global-child/field/retained','global:G','origin:a/slot/x/field/yes'].sort());
  assert.equal(before.get('origin:a/slot/x/field/yes').number,1);
  heap.set('origin:a/slot/x/field/yes',a.literal('i32',0,2));
  const after=a.reachable([selected],heap);
  assert.equal(after.get('origin:a/slot/x/field/yes').number,2);
  assert.equal(before.get('origin:a/slot/x/field/yes').number,1,'the earlier owned snapshot does not follow mutation');
});

test('per-call heap range index avoids scanning every heap cell for every root',()=>{
  const a=commonAbstract({spend:commonMeter(2500),types:new Map([['B',{id:'B',kind:'reference'}],['i32',{id:'i32',kind:'scalar'}]])}),
    selected=a.literal('B'),rows=Array.from({length:256},(_,index)=>{
      const ref=(index<16?'r':'z')+String(index).padStart(4,'0');if(index<16)selected.refs.add(ref);
      /** @type {[string,ReturnType<typeof a.empty>]} */ const entry=[ref+'/field/value',a.literal('i32')];return entry;
    });
  const reachable=a.reachable([selected],new Map(rows.reverse()));
  assert.equal(reachable.size,16);
  for(let index=0;index<16;index++)assert.ok(reachable.has('r'+String(index).padStart(4,'0')+'/field/value'));
});

test('fast context identity preserves number1 to null instead of normalizing the saved entry',()=>{
  const {spend,a,receiver,regions,input}=fixture(),identity=commonActualContextValues(a,regions,spend),
    first=a.literal('i32'),second=a.literal('i32');
  const firstRegion={roots:new Set(),opaque:false,empty:true,number:1};first.region=firstRegion;
  second.region={roots:new Set(),opaque:false,empty:true,number:null};
  assert.equal(a.copy(first).region.number,null,'execution-domain copying really normalizes this facet');
  const firstEntry=commonActualContextSnapshot({...input,args:[first]},a,receiver,regions,spend),
    secondEntry=commonActualContextSnapshot({...input,args:[second]},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(firstEntry,secondEntry,identity,receiver,regions,spend),false,'the original complete identity distinguishes these inputs');
  first.pairs.set('code',{functionId:'original',environment:'original-env'});
  const saved=identity.captureArgs([first]);
  assert.equal(saved[0].region.number,1);assert.equal(identity.sameValue(saved[0],second),false);
  assert.equal(identity.sameValue(saved[0],first),true);
  firstRegion.number=2;firstRegion.roots.add('later');first.tags.add('later');first.pairs.get('code').functionId='later';
  assert.equal(saved[0].region.number,1);assert.equal(saved[0].region.roots.size,0);assert.equal(saved[0].tags.has('later'),false);assert.equal(saved[0].pairs.get('code').functionId,'original');
});

test('owned entry comparison preserves UTF16, every payload component and control boundaries',()=>{
  const {spend,a,receiver,regions,input}=fixture(),identity=commonActualContextValues(a,regions,spend),base=commonActualContextSnapshot(input,a,receiver,regions,spend);
  /** @type {((row:typeof base)=>void)[]} */ const mutations=[
    row=>row.args[0].tags.add('other'),row=>row.args[0].refs.add('other'),row=>row.args[0].cells.add('other'),
    row=>row.args[0].pairs.set('code',{functionId:'callee',environment:'env'}),row=>row.args[0].frames.add('other'),row=>row.args[0].cursors.add('other'),
    row=>row.args[0].truth=3,row=>row.args[0].unknown=true,row=>row.args[0].number=1,
    row=>row.args[0].region={...row.args[0].region,opaque:true},row=>row.args[0].region={...row.args[0].region,empty:true},row=>row.args[0].region={...row.args[0].region,number:1},row=>row.args[0].region.roots.add('other'),
    row=>row.entryHeap.delete('object:B/field/F'),row=>row.entryHeap.get('object:B/field/F').tags.add('other'),row=>row.retained[0].region.opaque=true,
    row=>row.target='other',row=>row.activation='other',row=>row.repeated=true,row=>row.regionScope='other',
    row=>{row.entryFrames.values().next().value.pending=true;},
    row=>{row.entryRegions.get('origin').set('other',{roots:new Set(),opaque:true,empty:false,number:null});}
  ];
  for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);assert.equal(commonActualContextSame(base,changed,identity,receiver,regions,spend),false);}
  const same=structuredClone(base);same.entryHeap=new Map([...same.entryHeap].reverse());assert.equal(commonActualContextSame(base,same,identity,receiver,regions,spend),true);
  const first=a.literal('\ud800'),second=a.literal('\ufffd'),left=commonActualContextSnapshot({...input,args:[first]},a,receiver,regions,spend),right=commonActualContextSnapshot({...input,args:[second]},a,receiver,regions,spend);
  assert.equal(commonActualContextSame(left,right,identity,receiver,regions,spend),false);
});

test('complete entry comparison prepays actual long control map keys before lookup',()=>{
  const {a}=fixture(),spend=commonMeter(128),regions=commonRegions(spend),receiver=commonReceiverActual({spend,types:new Map(),objects:new Map()},a),identity=commonActualContextValues(a,regions,spend),id='x'.repeat(20000),bound=a.empty(),binding={unbound:false,weak:false,pending:false,initializing:false,aborted:false,prefixMin:0,prefixMax:0,bound,births:new Map()};
  const entry={target:'target',args:[],retained:[],activation:'activation',repeated:false,regionScope:'scope',entryHeap:new Map(),entryFrames:new Map([[id,binding]]),entryRegions:new Map()},other=structuredClone(entry);
  assert.throws(()=>commonActualContextSame(entry,other,identity,receiver,regions,spend),{code:'r03-common-program-limit'});
  assert.equal(entry.entryFrames.has(id),true);assert.equal(other.entryFrames.has(id),true);
});

test('reference-only selection uses the same raw graph walk without retaining payload aliases',()=>{
  const spend=commonMeter(),a=commonAbstract({spend,types:new Map([['B',{id:'B',kind:'reference'}]])}),root=a.literal('B'),child=a.literal('B'),env=a.empty(),global=a.literal('B');
  root.refs.add('root');root.refs.add('env');root.pairs.set('code',{functionId:'callee',environment:'env'});root.cells.add('local-cell');child.refs.add('child');env.refs.add('captured');global.refs.add('global-object');
  const heap=new Map([['root/field/child',child],['env/slot/code',env],['global:G',global],['child/field/value',a.literal('B')],['captured/field/value',a.literal('B')],['global-object/field/value',a.literal('B')],['root-other/field/value',a.literal('B')],['local-cell',a.literal('B')]]);
  const refs=a.reachableRefs([root],heap);assert.deepEqual([...refs].sort(),['root','env','child','captured','global-object'].sort());
  const owned=a.reachable([root],heap);child.refs.add('later');assert.equal(owned.get('root/field/child').refs.has('later'),false);assert.equal(refs.has('later'),false);
});

test('one receiver selection owns independent frames and retained birth payloads including parents',()=>{
  const spend=commonMeter(),types=new Map([['B',{id:'B',name:'B',kind:'reference'}],['D',{id:'D',name:'D',kind:'reference',base:'B'}],['i32',{id:'i32',name:'i32',kind:'scalar'}]]),objects=new Map(),a=commonAbstract({spend,types}),receiver=commonReceiverActual({spend,types,objects},a),world=receiver.store();
  const parent=receiver.create(world,{activation:'activation',site:'derived',owner:'D',construction:'ctor:D',newTarget:'D',derived:true,fields:['DF']}),child=[...receiver.child(world,new Set([parent]),{activation:'activation',site:'base',owner:'B',construction:'ctor:B',derived:false,fields:['F']})][0],ref='object:D',heap=new Map([[ref+'/field/F',a.literal('i32')]]);
  objects.set(ref,{type:'D',weak:true});receiver.birth(world,child,ref,['F'],heap,true);const bound=a.literal('D');bound.refs.add(ref);const binding=receiver.bind(world,new Set([child]),bound);assert.ok(binding.normal);const original=binding.normal.frames,argument=a.empty();argument.frames.add(child);
  const selected=receiver.snapshot(original,[argument],heap);assert.ok(selected.frames.has(child));assert.ok(selected.frames.has(parent));assert.equal(selected.frames.get(child).births.size,1);assert.equal(selected.frames.get(parent).births.size,1);
  const row=selected.frames.get(child),retainedBirths=selected.retained.filter(value=>value.tags.has('i32'));assert.equal(retainedBirths.length,2);row.births.get(ref+'/field/F').real.tags.add('frame-only');row.pending=true;
  assert.equal(original.get(child).pending,false);assert.equal(original.get(child).births.get(ref+'/field/F').real.tags.has('frame-only'),false);assert.ok(retainedBirths.every(value=>!value.tags.has('frame-only')));
  retainedBirths[0].tags.add('retained-only');for(const value of selected.frames.values())for(const birth of value.births.values())assert.equal(birth.real.tags.has('retained-only'),false);
  original.get(child).bound.tags.add('original-only');assert.equal(selected.frames.get(child).bound.tags.has('original-only'),false);assert.ok(selected.retained.every(value=>!value.tags.has('original-only')));
});
