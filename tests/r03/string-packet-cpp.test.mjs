// SPDX-License-Identifier: MIT
// Static IR-only command seam. Root supplies the actual qualified CLI/capture root.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted} from './generic-core-package-capture.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const core=JSON.parse(await readFile(new URL('./string-core-oracle.json',import.meta.url),'utf8'));
const goldRaw=await readFile(new URL('./string-packet-oracle.json',import.meta.url));
assert.equal(goldRaw.length,119782);
assert.equal(digest(goldRaw),'438c68d9a1bcc15ec494e3328e0125b1cc972f0e7ca405277562f5caae7e2485');
const gold=JSON.parse(goldRaw.toString('utf8'));
test('24j new static command emits the complete independent ASI String packet',async()=>{
  const expected=gold.cases.find(c=>c.name==='asi'),input=core.cases.find(c=>c.name==='asi');
  assert.ok(expected&&input);
  const bytes=await readFile(new URL('./'+expected.packetFile,import.meta.url));
  assert.equal(bytes.length,588);assert.equal(digest(bytes),'d0bba29170b2a15b261c5f03ce64d2f1d89e1d0d73c52c6757fc56ff6a4699b5');
  assert.equal(Buffer.byteLength(input.core),input.coreBytes);assert.equal(digest(input.core),input.coreSHA256);
  const actual=await invokeCore(input.core,'--emit-string-candidate');accepted(actual);
  assert.deepEqual(actual.stdout,bytes,'entire independently frozen packet, not sampled output');
});
