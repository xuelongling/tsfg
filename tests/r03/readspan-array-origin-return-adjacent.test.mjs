// SPDX-License-Identifier: MIT
// Actual Source packets are input only; the unchanged independent whole oracle predates Product output.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { stateFor,entries,checkEntry,captureState,unchangedState,jcs,sha,deeplyFrozen } from './readspan-return-test-helpers.mjs';

const original=await readFile(new URL('./readspan-array-origin-return-adjacent-oracle.json',import.meta.url));
assert.equal(original.length,519889);
assert.equal(sha(original),'805a131f0317a805b8fa3f2d377b2f8238ee7fb271abee3748bde6f5f864c561');
const frozen=JSON.parse(original.toString('utf8'));
assert.equal(frozen.family,'tsfg.m26d-independent-representative-whole-oracle');
/** @type {any[]} */
const rows=frozen.cases;
assert.deepEqual(rows.map(row=>row.name),["bound-const-alias","tail-discard-and-unused-bound","view-parameter-same-family","scc-outgoing-array-origin-view-rejected","scc-fresh-owner-rejected"]);
const originalExpectations=jcs(frozen);

/** Root supplies one explicit qualified actual manifest. No Source process is launched here.
 * @param {any} pin @returns {Promise<Buffer>} */
async function readPin(pin) {
  assert.ok(pin&&typeof pin==='object');
  assert.equal(typeof pin.path,'string');
  assert.ok(/^(?:[A-Za-z]:[\\/]|\/)/.test(pin.path),'actual pin uses an absolute path');
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);
  assert.match(pin.sha256,/^[0-9a-f]{64}$/);
  const bytes=await readFile(pin.path);
  assert.equal(bytes.length,pin.bytes);assert.equal(sha(bytes),pin.sha256);
  return bytes;
}
const manifestPin=JSON.parse(process.env.TSFG_READSPAN_ARRAY_RETURN_ADJACENT_SOURCE_MANIFEST??'null');
assert.ok(manifestPin,'Root must bind the qualified new-HF actual Source manifest');
const manifestBytes=await readPin(manifestPin);
const manifest=JSON.parse(manifestBytes.toString('utf8'));
assert.ok(Array.isArray(manifest.cases));assert.equal(manifest.cases.length,5);
/** @type {Map<string,Buffer>} */
const actual=new Map();
for(const row of manifest.cases) {
  assert.ok(rows.some(expected=>expected.name===row.name));
  assert.ok(!actual.has(row.name),'actual case occurs once');
  actual.set(row.name,await readPin(row.packet));
}
assert.equal(actual.size,5);

for(const row of rows)test('26d representative actual complete facts and owned HIR8 projection: '+row.name,()=>{
  const raw=actual.get(row.name);assert.ok(raw);
  const before=Buffer.from(raw);
  assert.deepEqual(raw,Buffer.from(row.packageText),'actual Source packet equals the independent whole literal');
  const packet=readArrayFactsCandidate(raw);
  assert.deepEqual(packet,row.package);deeplyFrozen(packet);
  assert.deepEqual(writeArrayFactsCandidate(packet),raw);
  assert.deepEqual(projectArrayFacts(packet),row.projectedHIR);
  assert.deepEqual(raw,before);
  assert.equal(jcs(frozen),originalExpectations);
});

for(const row of rows)test('26d representative family forms and SCC refusals through nine public seams: '+row.name,async t=>{
  const raw=actual.get(row.name);assert.ok(raw);
  const before=Buffer.from(raw);
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),snapshot=captureState(state);
    // Each complete success or preserved SCC capability is fixed by the independent oracle.
    checkEntry(row,name,()=>action(state),state);
    unchangedState(state,snapshot);
    assert.deepEqual(raw,before);
  });
  assert.equal(jcs(frozen),originalExpectations);
});
