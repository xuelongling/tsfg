// SPDX-License-Identifier: MIT
// Owned compiler dataflow values only; no Source/Facts/Graph/Runtime input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
const domain=()=>commonAbstract({spend:commonMeter(),types:new Map(['A','B','C'].map(id=>[id,{id,kind:'scalar'}]))});
test('dataflow fork detaches both parent and child writes and sibling joins',()=>{
  const a=domain(),parent=a.state(),value=a.literal('A');
  value.region={roots:new Set(['origin']),opaque:false,empty:false,number:null};
  parent.heap.set('slot',value);parent.values.set('live',value);
  const left=a.fork(parent),right=a.fork(parent);
  a.writeFork(left.heap,'slot',a.literal('B'));
  assert.deepEqual([...left.heap.get('slot').tags].sort(),['A','B']);
  assert.deepEqual([...parent.heap.get('slot').tags],['A']);assert.deepEqual([...right.heap.get('slot').tags],['A']);
  a.writeFork(parent.heap,'slot',a.literal('C'));
  assert.deepEqual([...parent.heap.get('slot').tags].sort(),['A','C']);assert.deepEqual([...left.heap.get('slot').tags].sort(),['A','B']);
  a.joinFork(right,left);assert.deepEqual([...right.heap.get('slot').tags].sort(),['A','B']);
  assert.deepEqual([...parent.heap.get('slot').tags].sort(),['A','C']);
  left.values.get('live').region.opaque=true;left.values.get('live').region.roots.add('later');
  assert.equal(parent.values.get('live').region.opaque,false);assert.equal(right.values.get('live').region.opaque,false);
  assert.deepEqual([...parent.values.get('live').region.roots],['origin']);assert.deepEqual([...right.values.get('live').region.roots],['origin']);
  a.writeFork(right.values,'live',a.literal('C'));
  assert.deepEqual([...left.values.get('live').tags],['A']);assert.deepEqual([...parent.values.get('live').tags],['A']);
});
test('owned snapshots and capacity/output joins do not inherit a fork mutation',()=>{
  const a=domain(),parent=a.state();parent.heap.set('slot',a.literal('A'));
  const child=a.fork(parent),snapshot=a.snapshot(parent.heap),summary=new Map(),seed=a.empty();
  a.joinHeap(summary,parent.heap);a.merge(seed,parent.heap.get('slot'));
  a.writeFork(parent.heap,'slot',a.literal('B'));a.writeFork(child.heap,'slot',a.literal('C'));
  assert.deepEqual([...snapshot.get('slot').tags],['A']);assert.deepEqual([...summary.get('slot').tags],['A']);assert.deepEqual([...seed.tags],['A']);
  a.joinFork(parent,child);assert.deepEqual([...parent.heap.get('slot').tags].sort(),['A','B','C']);
  assert.deepEqual([...child.heap.get('slot').tags].sort(),['A','C']);
});

test('execution entry forks preserve immutable context heap parents in both write directions',()=>{
  const spend=commonMeter(),a=commonAbstract({spend,types:new Map([['A',{id:'A',kind:'reference'}],['B',{id:'B',kind:'reference'}]])}),value=a.literal('A');
  value.region={roots:new Set(['origin']),opaque:false,empty:false,number:1};const entry=new Map([['object/field/value',value]]),first=a.forkHeap(entry),second=a.forkHeap(entry);
  a.writeFork(first,'object/field/value',a.literal('B'));assert.deepEqual([...entry.get('object/field/value').tags],['A']);assert.deepEqual([...second.get('object/field/value').tags],['A']);
  a.writeFork(entry,'object/field/value',a.literal('C'));assert.deepEqual([...first.get('object/field/value').tags],['A','B']);assert.deepEqual([...second.get('object/field/value').tags],['A']);
  first.get('object/field/value').region.roots.add('first-only');assert.equal(entry.get('object/field/value').region.roots.has('first-only'),false);assert.equal(second.get('object/field/value').region.roots.has('first-only'),false);
});
