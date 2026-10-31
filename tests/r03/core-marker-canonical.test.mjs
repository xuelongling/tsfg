// SPDX-License-Identifier: MIT
// Typed metadata formatting only, without Source or Runtime construction.
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendCommonProgramMarker} from '../../compiler/common-program-core.mjs';
import {commonMeter} from '../../compiler/common-program-common.mjs';
import {commonTextBudget} from '../../compiler/common-program-budget.mjs';

test('typed marker canonicalization preserves key order and exact escaped Unicode/number bytes',()=>{
  const publication={z:[null,true,false,0,-0,1.25,1e30],a:{z:'\b\f\n\r\t\u0000"\\é😀',a:'first'}},
    expected=JSON.stringify({a:{a:'first',z:'\b\f\n\r\t\u0000"\\é😀'},z:[null,true,false,0,-0,1.25,1e30]}),
    spend=commonMeter(1000000),text=commonTextBudget(spend);
  appendCommonProgramMarker(text,{hir:'{}',representation:'{}',publication,request:{},proof:{}},spend);
  const encoded=/, publication = ("(?:\\.|[^"\\])*")/.exec(text.finish());assert.ok(encoded);
  assert.equal(JSON.parse(encoded[1]),expected);
});
