// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invokeCore,accepted,rejected} from './generic-core-package-capture.mjs';
import {parseKernelCore} from './kernel-global-core-structural.mjs';
const raw=await readFile(new URL('./kernel-global-core-oracle.json',import.meta.url));
const original=JSON.parse(raw.toString('utf8')),oracle=JSON.parse(await readFile(new URL('./kernel-global-core-roots-cold-oracle.json',import.meta.url),'utf8'));
const hash=v=>'sha256:'+createHash('sha256').update(v).digest('hex');
assert.equal(hash(raw),oracle.sourceOracle.sha256);assert.equal(raw.length,oracle.sourceOracle.bytes);
for(const c of oracle.cases){assert.equal(hash(c.core),c.sha256);assert.equal(Buffer.byteLength(c.core),c.bytes);}
// These are independent frozen Core metadata mutations, including deliberate
// export aliases to distinguish UTF-8 byte order from UTF-16 code-unit order.
// They retain every original function/body and claim no additional Source run.
for(const c of oracle.cases.filter(c=>c.status===3))test('rejects noncanonical roots: '+c.name,async()=>{
  const result=await invokeCore(c.core);rejected(result);
  assert.match(result.stderr.toString('utf8'),/core-ir-kernel-metadata.*root.*order/);
});
for(const c of [{name:'original complete whole Core',core:original.core},...oracle.cases.filter(c=>c.status===0)])test('accepts normalized roots: '+c.name,async()=>{
  const first=await invokeCore(c.core);accepted(first);
  assert.deepEqual(parseKernelCore(first.stdout.toString('utf8')),parseKernelCore(c.core));
  const second=await invokeCore(first.stdout);accepted(second);assert.deepEqual(second.stdout,first.stdout);
});
