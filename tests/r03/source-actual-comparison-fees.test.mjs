// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonActualContextValues} from '../../compiler/common-program-actual-context.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonRegions} from '../../compiler/common-program-regions.mjs';

function values(leftSize,rightSize){
  const a=commonAbstract({spend:commonMeter(),types:new Map()});
  const left=a.empty(),right=a.empty();
  for(let index=0;index<leftSize;index++)left.tags.add('tag:'+index);
  for(let index=0;index<rightSize;index++)right.tags.add('tag:'+index);
  const spend=commonMeter(32),identity=commonActualContextValues(a,commonRegions(spend),spend);
  return {left,right,identity};
}

test('a scalar mismatch does not traverse payload collections',()=>{
  const {left,right,identity}=values(256,256);right.truth=1;
  assert.equal(identity.samePayload(left,right),false);
});
test('a size mismatch does not traverse payload collections',()=>{
  const {left,right,identity}=values(255,256);
  assert.equal(identity.samePayload(left,right),false);
});
test('an equal large payload still prepays its complete traversal',()=>{
  const {left,right,identity}=values(256,256);
  assert.throws(()=>identity.samePayload(left,right),{code:'r03-common-program-limit'});
});
test('a complete small payload compares under the same small budget',()=>{
  const {left,right,identity}=values(1,1);
  assert.equal(identity.samePayload(left,right),true);
});
