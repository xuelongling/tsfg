// SPDX-License-Identifier: MIT
// Whole frozen Core; only untrusted alias annotation intervals change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const bytes=await readFile(new URL('./readspan-core12-oracle.json',import.meta.url));
assert.equal(bytes.length,474847);
assert.equal(createHash('sha256').update(bytes).digest('hex'),'ea662dcd137a240a947c1fc3c57d9a17dbed31661e99338a4d76950e5dce9ba0');
const row=JSON.parse(bytes.toString('utf8')).cases.find(/** @param {{name:string,core:string}} row */ row=>row.name==='formal-alias-length');
assert.ok(row);
const original=row.core;
const line=original.split('\n').find(/** @param {string} line */ line=>line.includes('"tsfg_array.view_alias"'));
assert.ok(line);
const needle='annotation_range = array<i64>, element_annotation_range = array<i64>';
assert.ok(line.includes(needle));
test('typed View alias boundary: complete original untyped Core remains valid',async()=>accepted(await invokeCore(original)));
for(const [name,element] of [['left endpoint','56, 57'],['right endpoint','57, 58']])test('typed View alias must strictly enclose element: '+name,async()=>{
  const changed=line.replace(needle,'annotation_range = array<i64: 56, 58>, element_annotation_range = array<i64: '+element+'>');
  assert.notEqual(changed,line);
  const result=await invokeCore(original.replace(line,changed));
  assert.equal(result.close.code,3,result.stderr.toString('utf8'));
  assert.equal(result.stdout.length,0);
  assert.match(result.stderr.toString('utf8'),/core-ir-array-source/);
});
