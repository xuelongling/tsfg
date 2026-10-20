// SPDX-License-Identifier: MIT
// Actual Source packets are input only; the unchanged independent whole oracle predates Product output.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readArrayFactsCandidate,writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { projectArrayFacts } from '../../compiler/array-hir-model.mjs';
import { stateFor,entries,checkEntry,captureState,unchangedState,jcs,sha,deeplyFrozen } from './readspan-return-test-helpers.mjs';

const original=await readFile(new URL('./readspan-array-origin-return-first-oracle.json',import.meta.url));
assert.equal(original.length,344234);
assert.equal(sha(original),'2f97cef1e3f393a75069cf01ca35834f52503bbbe0407dfa6ef9c8f9cc4b38de');
const frozen=JSON.parse(original.toString('utf8'));
assert.equal(frozen.family,'tsfg.m26d-independent-first-whole-oracle');
/** @type {any[]} */
const rows=frozen.cases;
assert.deepEqual(rows.map(row=>row.name),['before','after']);
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
const manifestPin=JSON.parse(process.env.TSFG_READSPAN_ARRAY_RETURN_SOURCE_MANIFEST??'null');
assert.ok(manifestPin,'Root must bind the qualified new-HF actual Source manifest');
const manifestBytes=await readPin(manifestPin);
const manifest=JSON.parse(manifestBytes.toString('utf8'));
assert.ok(Array.isArray(manifest.cases));assert.equal(manifest.cases.length,2);
/** @type {Map<string,Buffer>} */
const actual=new Map();
for(const row of manifest.cases) {
  assert.ok(['before','after'].includes(row.name));
  assert.ok(!actual.has(row.name),'actual case occurs once');
  actual.set(row.name,await readPin(row.packet));
}
assert.equal(actual.size,2);

// The existing Core subset checks the first borrowed parameter before reserving output.
const lowerDiagnostic={code:'r03-d-core-array-capability',ruleId:'r01-ts-baseline',phase:'lowering',
  message:'Array Core lowering requires nominal Array/scalar calls and a final checked read or f64 direct call',
  primary:{sourceId:'/readspan26d/app.ts',start:16,end:24}};

for(const row of rows)test('26d actual complete facts and owned HIR8 projection: '+row.name,()=>{
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

for(const row of rows)test('26d Array-origin family and caller last use through nine public seams: '+row.name,async t=>{
  const raw=actual.get(row.name);assert.ok(raw);
  const before=Buffer.from(raw);
  for(const [name,action]of Object.entries(entries))await t.test(name,()=>{
    const state=stateFor(row,raw),snapshot=captureState(state);
    // Feature expectations remain structural refusal / whole success during Phase1 capability RED.
    checkEntry(row,name,()=>action(state),lowerDiagnostic);
    unchangedState(state,snapshot);
    assert.deepEqual(raw,before);
  });
  assert.equal(jcs(frozen),originalExpectations);
});
