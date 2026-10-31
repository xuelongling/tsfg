// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {commonAbstract} from '../../compiler/common-program-abstract.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
test('actual payload key charges long source references before serialization',()=>{
  const a=commonAbstract({types:new Map(),spend:commonMeter(100)}),value=a.empty();
  value.refs.add('entry/'+'x'.repeat(8192));
  assert.throws(()=>a.key(value),{code:'r03-common-program-limit'});
});
test('actual payload key rejects an exhausted collection before iteration',()=>{
  let iterated=false;const a=commonAbstract({types:new Map(),spend:commonMeter(2)}),value=a.empty(),original=value.tags[Symbol.iterator].bind(value.tags);
  value.tags.add('a');value.tags.add('b');value.tags.add('c');value.tags[Symbol.iterator]=()=>{iterated=true;return original();};
  assert.throws(()=>a.key(value),{code:'r03-common-program-limit'});assert.equal(iterated,false);
});
