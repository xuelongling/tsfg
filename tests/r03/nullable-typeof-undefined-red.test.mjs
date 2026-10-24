// SPDX-License-Identifier: MIT
// Actual complete capture: mechanical API RED and old supported grammar RED are distinct.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importNullableCapturedResponse} from '../../compiler/nullable-frontend.mjs';
import {verifyNullableFacts} from '../../compiler/nullable-facts.mjs';
const dir=new URL('./testdata/nullable-typeof-v6/',import.meta.url);
const read=name=>readFileSync(new URL(name,dir));
const expected=JSON.parse(read('expected.json').toString());
test('actual v6 complete capture explicit API',()=>{
 const c=expected.context;
 assert.deepEqual(importNullableCapturedResponse(read('request.json'),read('package.json'),c.expectedOrigin,c),{status:'ok',snapshot:expected.snapshot});
});
test('actual v6 same facts remain rejected by supported5 grammar',()=>{
 assert.throws(()=>verifyNullableFacts({path:expected.snapshot.source.path,content:expected.snapshot.source.content},expected.facts,expected.exports,5),{code:'r03-nullable-capability'});
});
