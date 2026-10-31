// SPDX-License-Identifier: MIT
// Solver-owned metadata forks only; deep public clone/snapshot stay independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonReceiverActual} from '../../compiler/common-program-receiver-actual.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';

function fixture(fields=['F','G']){
  let meter=commonMeter(1000000);const spend=(amount=1)=>meter(amount),types=new Map([['B',{id:'B',kind:'reference'}],['D',{id:'D',kind:'reference',base:'B'}],
    ['i32',{id:'i32',kind:'scalar'}],['alt',{id:'alt',kind:'scalar'}]]),objects=new Map(),a=commonAbstract({spend,types}),r=commonReceiverActual({spend,types,objects},a);
  const definition={activation:'unit',site:'site',owner:'B',construction:'ctor:B',newTarget:'B',derived:false,fields},
    world=r.store(),id=r.create(world,definition),ref='object:B',selected=a.literal('B');selected.refs.add(ref);selected.region={roots:new Set(['bound-origin']),opaque:false,empty:false,number:null};
  objects.set(ref,{type:'B',weak:true});const bound=r.bind(world,new Set([id]),selected);assert.ok(bound.normal);
  const parent=bound.normal.frames,heap=new Map([[ref+'/field/F',a.literal('i32',0,1)]]);
  r.birth(parent,id,ref,fields,heap,true);
  return {a,r,types,objects,parent,heap,id,ref,selected,definition,setLimit:limit=>{meter=commonMeter(limit);}};
}
const row=(world,id,ref,field)=>world.get(id).births.get(ref+'/field/'+field);
const tags=value=>[...value.tags].sort();

test('receiver fork isolates child parent and sibling real writes and pending cleanup',()=>{
  const {a,r,parent,id,ref,selected}=fixture(),left=r.fork(parent),right=r.fork(parent),alt=a.literal('alt');
  r.write(left,ref+'/field/F',alt);assert.deepEqual(tags(row(left,id,ref,'F').real),['alt','i32']);
  assert.deepEqual(tags(row(parent,id,ref,'F').real),['i32']);assert.deepEqual(tags(row(right,id,ref,'F').real),['i32']);
  r.write(parent,ref+'/field/G',a.literal('i32'),true);
  assert.equal(row(parent,id,ref,'G').pending,false);assert.equal(row(left,id,ref,'G').pending,true);assert.equal(row(right,id,ref,'G').pending,true);
  const cursor=r.begin(left,new Set([id]));r.define(left,cursor,selected,'F');
  assert.equal(row(left,id,ref,'F').pending,false);assert.equal(row(parent,id,ref,'F').pending,true);assert.equal(row(right,id,ref,'F').pending,true);
  r.write(right,ref+'/field/F',alt,true);assert.deepEqual(tags(row(right,id,ref,'F').real),['alt']);
  assert.deepEqual(tags(row(left,id,ref,'F').real),['alt','i32']);assert.deepEqual(tags(row(parent,id,ref,'F').real),['i32']);
});

test('receiver fork detaches join and feedback destinations without changing source worlds',()=>{
  const {a,r,parent,id,ref}=fixture(),destination=r.fork(parent),sibling=r.fork(parent),source=r.clone(parent);
  r.write(source,ref+'/field/F',a.literal('alt'));assert.equal(r.join(destination,source),true);
  assert.deepEqual(tags(row(destination,id,ref,'F').real),['alt','i32']);
  assert.deepEqual(tags(row(parent,id,ref,'F').real),['i32']);assert.deepEqual(tags(row(sibling,id,ref,'F').real),['i32']);
  r.feedback(destination,value=>{value.region={...value.region,opaque:true};});
  assert.equal(destination.get(id).bound.region.opaque,true);assert.equal(row(destination,id,ref,'F').real.region.opaque,true);
  for(const world of [source,parent,sibling]){assert.equal(world.get(id).bound.region.opaque,false);assert.equal(row(world,id,ref,'F').real.region.opaque,false);}
  r.feedback(parent,value=>{value.region={...value.region,empty:true};});
  assert.equal(parent.get(id).bound.region.empty,true);assert.equal(sibling.get(id).bound.region.empty,false);
  assert.equal(destination.get(id).bound.region.empty,false);
});

test('birth and repeated frame creation detach every affected ancestor row',()=>{
  const {a,r,parent,id,ref,heap,definition}=fixture(),child=r.fork(parent),sibling=r.fork(parent);
  r.birth(child,id,ref,['added'],heap,true);
  assert.equal(child.get(id).births.has(ref+'/field/added'),true);assert.equal(parent.get(id).births.has(ref+'/field/added'),false);assert.equal(sibling.get(id).births.has(ref+'/field/added'),false);
  assert.equal(r.create(sibling,{...definition,repeated:true}),id);assert.equal(sibling.get(id).weak,true);assert.equal(sibling.get(id).unbound,true);
  assert.equal(parent.get(id).weak,false);assert.equal(parent.get(id).unbound,false);assert.equal(child.get(id).weak,false);
  const world=r.store(),derived=r.create(world,{...definition,site:'derived',owner:'D',construction:'ctor:D',newTarget:'D',derived:true}),
    base=[...r.child(world,new Set([derived]),{...definition,site:'base'})][0],forked=r.fork(world);
  r.birth(forked,base,'dynamic:D',['own'],new Map(),false);
  assert.equal(forked.get(base).births.size,1);assert.equal(forked.get(derived).births.size,1);
  assert.equal(world.get(base).births.size,0);assert.equal(world.get(derived).births.size,0);
  assert.equal(a.empty().refs.size,0);
});

test('begin advance end and both abort routes isolate their first fork destination mutation',()=>{
  {
    const {r,parent,id}=fixture(),child=r.fork(parent);r.begin(child,new Set([id]));
    assert.equal(child.get(id).initializing,true);assert.equal(parent.get(id).initializing,false);
  }
  {
    const {r,parent,id}=fixture(),start=r.begin(parent,new Set([id])),child=r.fork(parent),sibling=r.fork(parent);
    const next=r.advance(child,start,'F');assert.equal(child.get(id).prefixMin,1);assert.equal(parent.get(id).prefixMin,0);
    r.abort(sibling);assert.equal(sibling.get(id).aborted,true);assert.equal(sibling.get(id).initializing,false);
    assert.equal(parent.get(id).aborted,false);assert.equal(parent.get(id).initializing,true);
    const abrupt=r.fork(child);r.abort(abrupt,next);assert.equal(abrupt.get(id).aborted,true);assert.equal(abrupt.get(id).prefixMin,1);
    assert.equal(child.get(id).aborted,false);assert.equal(child.get(id).initializing,true);
  }
  {
    const {r,parent,id}=fixture(),start=r.begin(parent,new Set([id])),first=r.advance(parent,start,'F'),last=r.advance(parent,first,'G'),child=r.fork(parent);
    r.end(child,last);assert.equal(child.get(id).initializing,false);assert.equal(parent.get(id).initializing,true);assert.equal(parent.get(id).prefixMin,2);
  }
});

test('deep clone snapshot overlay and normal completions remain owned beside a fork',()=>{
  const {a,r,parent,id,ref,heap}=fixture(),forked=r.fork(parent),owned=r.clone(forked),control=a.empty();control.frames.add(id);
  owned.get(id).bound.tags.add('owned-only');assert.equal(parent.get(id).bound.tags.has('owned-only'),false);assert.equal(forked.get(id).bound.tags.has('owned-only'),false);
  const snapshot=r.snapshot(forked,[control],heap);snapshot.frames.get(id).bound.tags.add('snapshot-only');
  snapshot.retained[0].tags.add('retained-only');assert.equal(forked.get(id).bound.tags.has('snapshot-only'),false);assert.equal(forked.get(id).bound.tags.has('retained-only'),false);
  const source=r.clone(parent);r.write(source,ref+'/field/F',a.literal('alt'),true);r.overlay(forked,source);
  r.feedback(forked,value=>{value.region={...value.region,opaque:true};});
  assert.deepEqual(tags(row(parent,id,ref,'F').real),['i32']);assert.equal(source.get(id).bound.region.opaque,false);
  const completion=r.get(parent,new Set([id]));assert.ok(completion.normal);r.begin(completion.normal.frames,new Set([id]));
  assert.equal(parent.get(id).initializing,false);
});

test('binding a fork supplies independent normal worlds without changing its input or sibling',()=>{
  const {a,r,definition}=fixture(),world=r.store(),id=r.create(world,{...definition,site:'unbound'}),child=r.fork(world),sibling=r.fork(world),
    selected=a.literal('B');selected.refs.add('fresh:B');
  const bound=r.bind(child,new Set([id]),selected);assert.ok(bound.normal);assert.equal(bound.normal.frames.get(id).unbound,false);
  assert.equal(world.get(id).unbound,true);assert.equal(child.get(id).unbound,true);assert.equal(sibling.get(id).unbound,true);
  r.begin(bound.normal.frames,new Set([id]));assert.equal(child.get(id).initializing,false);
});

test('fork pays only real map sharing while first detach still prepays the unchanged deep copy',()=>{
  const {r,parent,id,setLimit}=fixture(Array.from({length:128},(_,index)=>'field:'+index)),before=parent.get(id);
  setLimit(64);const child=r.fork(parent);assert.equal(child.get(id),before);
  assert.throws(()=>r.clone(parent),{code:'r03-common-program-limit'});
  setLimit(64);assert.throws(()=>r.begin(child,new Set([id])),{code:'r03-common-program-limit'});
  assert.equal(child.get(id),before);assert.equal(parent.get(id),before);assert.equal(before.initializing,false);
});
