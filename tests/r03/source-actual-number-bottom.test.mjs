// SPDX-License-Identifier: MIT
// Private compiler lattice controls; no Source, Runtime or execution authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {i32TypeId} from '../../compiler/identity.mjs';
const make=()=>commonAbstract({types:new Map([[i32TypeId,{id:i32TypeId,kind:'scalar',name:'i32'}]]),spend:()=>{}});

test('numeric Bottom is a two-sided join identity for a known actual constant',()=>{
  const a=make(),known=a.literal(i32TypeId,0,2),bottom=a.empty(),before=a.key(known);
  assert.equal(a.merge(known,bottom),false);assert.equal(known.number,2);assert.equal(a.key(known),before);
  assert.equal(a.merge(bottom,known),true);assert.equal(a.key(bottom),before);
});

test('an actual nonconstant scalar widens a constant despite keeping the same actual tag',()=>{
  const a=make(),known=a.literal(i32TypeId,0,2),nonconstant=a.literal(i32TypeId);
  assert.equal(a.merge(known,nonconstant),true);assert.equal(known.number,null);assert.deepEqual([...known.tags],[i32TypeId]);
});

test('different actual constants join to an unknown numeric value',()=>{
  const a=make(),known=a.literal(i32TypeId,0,2);
  assert.equal(a.merge(known,a.literal(i32TypeId,0,9)),true);assert.equal(known.number,null);
});

test('unknown actual payload is not Bottom and cannot retain a numeric constant',()=>{
  const a=make(),known=a.literal(i32TypeId,0,2),unknown=a.empty();unknown.unknown=true;
  assert.equal(a.merge(known,unknown),true);assert.equal(known.number,null);assert.equal(known.unknown,true);
});

for(const kind of ['reference','code/environment','relation'])test(kind+' information is not numeric Bottom',()=>{
  const a=make(),known=a.literal(i32TypeId,0,2),other=a.empty();
  if(kind==='reference')other.refs.add('fixture:object');
  if(kind==='code/environment'){other.refs.add('fixture:env');other.pairs.set('fixture:code',{functionId:'fixture:function',environment:'fixture:env'});}
  if(kind==='relation')other.region={...other.region,roots:new Set(['fixture:root'])};
  assert.equal(a.merge(known,other),true);assert.equal(known.number,null);
  if(kind==='reference')assert.ok(known.refs.has('fixture:object'));
  if(kind==='code/environment')assert.deepEqual(known.pairs.get('fixture:code'),{functionId:'fixture:function',environment:'fixture:env'});
  if(kind==='relation')assert.ok(known.region.roots.has('fixture:root'));
});
