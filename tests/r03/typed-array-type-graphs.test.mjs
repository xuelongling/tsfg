// SPDX-License-Identifier: MIT
// Small graph-only fixtures exercise work admission, not Source/checker facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTypedValueContainment,typedReferenceWeights} from '../../compiler/typed-array-type-graphs.mjs';
const budget=initial=>{let remaining=initial;return ()=>{if(--remaining<0)throw new Error('bounded graph work');};};

test('flat value and union edges are iteratively bounded while reference cycles stop containment',()=>{
  const types=new Map([
    ['V',{kind:'value',fields:[{type:'U'}]}],['U',{kind:'union',members:['i32','R']}],
    ['i32',{kind:'scalar'}],['R',{kind:'reference',fields:[{type:'V'}]}],
  ]);
  assert.doesNotThrow(()=>checkTypedValueContainment(types,30));
  assert.throws(()=>checkTypedValueContainment(types,1),{code:'r03-typed-array-limit'});
  types.get('R').kind='value';
  assert.throws(()=>checkTypedValueContainment(types,30),{code:'r03-typed-array-recursive-value'});
});

test('inheritance weight shares the proof work budget before following flat base edges',()=>{
  const classes=new Map([
    ['D',{id:'D',base:'B',fields:[{}],methods:[{}]}],
    ['B',{id:'B',base:'A',fields:[{}],methods:[]}],['A',{id:'A',base:'',fields:[],methods:[{}]}],
  ]);
  const weights=typedReferenceWeights(classes,budget(20));
  assert.equal(weights.get('A'),2);assert.equal(weights.get('B'),4);assert.equal(weights.get('D'),7);
  assert.throws(()=>typedReferenceWeights(classes,budget(1)),/bounded graph work/);
  classes.get('A').base='D';
  assert.throws(()=>typedReferenceWeights(classes,budget(20)),{code:'r03-typed-array-inheritance'});
});
