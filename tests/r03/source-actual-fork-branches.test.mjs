// SPDX-License-Identifier: MIT
// Inner owned abstract values only; no Source/Facts/Graph/Runtime input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';

const domain=()=>{
  const spend=commonMeter();
  return {a:commonAbstract({spend,types:new Map([['A',{id:'A',kind:'reference'}],['B',{id:'B',kind:'reference'}]])}),regions:commonRegions(spend)};
};

test('dataflow weak fork write observes truth changes with identical payload collections',()=>{
  const {a}=domain(),parent=a.state(),original=a.literal('A',1);
  parent.heap.set('slot',original);
  const child=a.fork(parent),sibling=a.fork(parent),incoming={...child.heap.get('slot'),truth:2};
  assert.equal(a.writeFork(child.heap,'slot',incoming),true);
  assert.equal(child.heap.get('slot').truth,3);
  assert.equal(parent.heap.get('slot').truth,1);assert.equal(sibling.heap.get('slot').truth,1);assert.equal(incoming.truth,2);
  assert.deepEqual([...child.heap.get('slot').tags],['A']);
});

test('dataflow weak fork write observes unknown changes with identical payload collections',()=>{
  const {a}=domain(),parent=a.state();parent.heap.set('slot',a.literal('A'));
  const child=a.fork(parent),sibling=a.fork(parent),incoming={...child.heap.get('slot'),unknown:true};
  assert.equal(a.writeFork(child.heap,'slot',incoming),true);
  assert.equal(child.heap.get('slot').unknown,true);
  assert.equal(parent.heap.get('slot').unknown,false);assert.equal(sibling.heap.get('slot').unknown,false);assert.equal(incoming.unknown,true);
  assert.deepEqual([...child.heap.get('slot').tags],['A']);
});

test('dataflow weak fork write joins different exact numbers with identical payload collections',()=>{
  const {a}=domain(),parent=a.state();parent.heap.set('slot',a.literal('A',0,7));
  const child=a.fork(parent),sibling=a.fork(parent),incoming={...child.heap.get('slot'),number:9};
  assert.equal(a.writeFork(child.heap,'slot',incoming),true);
  assert.equal(child.heap.get('slot').number,null);
  assert.equal(parent.heap.get('slot').number,7);assert.equal(sibling.heap.get('slot').number,7);assert.equal(incoming.number,9);
  assert.deepEqual([...child.heap.get('slot').tags],['A']);
});

test('dataflow weak fork write distinguishes equal-size region root sets and isolates both inputs',()=>{
  const {a,regions}=domain(),parent=a.state(),original=a.literal('A');
  original.region=regions.copy({roots:new Set(['origin:parent']),opaque:false,empty:false,number:null});
  parent.heap.set('slot',original);
  const child=a.fork(parent),sibling=a.fork(parent),incoming={...child.heap.get('slot'),
    region:regions.copy({roots:new Set(['origin:incoming']),opaque:false,empty:false,number:null})};
  assert.equal(child.heap.get('slot').region.roots.size,incoming.region.roots.size);
  assert.equal(a.writeFork(child.heap,'slot',incoming),true);
  assert.deepEqual([...child.heap.get('slot').region.roots].sort(),['origin:incoming','origin:parent']);
  assert.deepEqual([...parent.heap.get('slot').region.roots],['origin:parent']);
  assert.deepEqual([...sibling.heap.get('slot').region.roots],['origin:parent']);
  assert.deepEqual([...incoming.region.roots],['origin:incoming']);
  assert.equal(child.heap.get('slot').region.opaque,false);
  assert.equal(child.heap.get('slot').region.empty,false);
  assert.equal(child.heap.get('slot').region.number,null);
});

const assertControls=(value,names)=>{
  assert.deepEqual([...value.cells].sort(),names.map(name=>'cell:'+name).sort());
  assert.deepEqual([...value.frames].sort(),names.map(name=>'frame:'+name).sort());
  assert.deepEqual([...value.cursors].sort(),names.map(name=>'cursor:'+name).sort());
  assert.deepEqual([...value.pairs].map(([id,pair])=>[id,pair.functionId,pair.environment]).sort(),
    names.map(name=>['pair:'+name,'fn:'+name,'env:'+name]).sort());
};

test('dataflow weak write and joinFork isolate callable pairs and Cell Frame cursor unions',()=>{
  const {a}=domain(),parent=a.state(),original=a.literal('A');
  original.cells.add('cell:original');original.frames.add('frame:original');original.cursors.add('cursor:original');
  original.pairs.set('pair:original',{functionId:'fn:original',environment:'env:original'});
  parent.values.set('live',original);parent.heap.set('slot',original);
  const child=a.fork(parent),sibling=a.fork(parent),incoming=a.empty();
  incoming.cells.add('cell:incoming');incoming.frames.add('frame:incoming');incoming.cursors.add('cursor:incoming');
  incoming.pairs.set('pair:incoming',{functionId:'fn:incoming',environment:'env:incoming'});
  assert.equal(a.writeFork(child.values,'live',incoming),true);
  assertControls(child.values.get('live'),['original','incoming']);
  assertControls(child.heap.get('slot'),['original']);assertControls(parent.values.get('live'),['original']);
  assertControls(sibling.values.get('live'),['original']);assertControls(incoming,['incoming']);

  assert.equal(a.joinFork(sibling,child),true);
  assertControls(sibling.values.get('live'),['original','incoming']);
  assertControls(sibling.heap.get('slot'),['original']);assertControls(parent.values.get('live'),['original']);
  assertControls(child.values.get('live'),['original','incoming']);assertControls(incoming,['incoming']);

  const later=a.empty();later.cells.add('cell:later');later.frames.add('frame:later');later.cursors.add('cursor:later');
  later.pairs.set('pair:later',{functionId:'fn:later',environment:'env:later'});
  assert.equal(a.writeFork(sibling.values,'live',later),true);
  assertControls(sibling.values.get('live'),['original','incoming','later']);
  assertControls(child.values.get('live'),['original','incoming']);
  assertControls(parent.values.get('live'),['original']);assertControls(parent.heap.get('slot'),['original']);
  assertControls(incoming,['incoming']);assertControls(later,['later']);
});
