// SPDX-License-Identifier: MIT
// Cold IR text boundary, not Source execution or an execution/resource certificate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const o=JSON.parse(await readFile(new URL('./string-core-oracle.json',import.meta.url),'utf8'));
const input=Buffer.from(o.cases.find(c=>c.name==='asi').core);
const expected=await readFile(new URL('./string-packet-asi.frozen-v1.bin',import.meta.url));
const limit=8388608;
function padded(size,last=32){const bytes=Buffer.alloc(size,10);input.copy(bytes);bytes[size-1]=last;return bytes;}
test('new private String command admits exactly8MiB complete text without changing whole packet',async()=>{
 const r=await invokeCore(padded(limit),'--emit-string-candidate');accepted(r);assert.deepEqual(r.stdout,expected);
});
for(const [name,last]of [['valid whitespace',32],['invalid token after complete Core',63]])
 test('new String preparse input cap refuses8MiB+1 before '+name,async()=>{
  const r=await invokeCore(padded(limit+1,Number(last)),'--emit-string-candidate');
  assert.equal(r.close.code,3,r.stderr.toString('utf8'));assert.equal(r.stdout.length,0);
  assert.ok(r.stderr.toString('utf8').includes('[core-ir-string-budget]'),r.stderr.toString('utf8'));
 });
