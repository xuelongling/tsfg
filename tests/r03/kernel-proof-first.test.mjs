// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as hir from '../../compiler/hir.mjs';

const fixture = JSON.parse(await readFile(new URL('./kernel-parallel-first.json', import.meta.url), 'utf8'));
// Existing literal oracle precedes this consumer; no SUT output defines expected proof bytes.
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
test('existing whole kernel proof has a cold verified canonical transport', () => {
  assert.deepEqual(hir.analyzeModuleCalls(fixture.hir, fixture.context), fixture.expectedAnalysis);
  assert.deepEqual(hir.verifyKernelParallelGroup(fixture.hir, fixture.context, fixture.request), fixture.expectedProof);
  const verify = Reflect.get(hir, 'verifyKernelParallelProof');
  // BASE fails only here: missing cold proof consumer, not a semantic analysis RED.
  assert.equal(typeof verify, 'function', 'cold proof verification must exist');
  const print = Reflect.get(hir, 'printKernelParallelProof'), read = Reflect.get(hir, 'readKernelParallelProof');
  assert.equal(typeof print, 'function'); assert.equal(typeof read, 'function');
  const text = jcs(fixture.expectedProof) + '\n';
  assert.deepEqual(verify(fixture.expectedProof, fixture.hir, fixture.context, fixture.request), fixture.expectedProof);
  assert.equal(print(fixture.expectedProof, fixture.hir, fixture.context, fixture.request), text);
  assert.deepEqual(read(Buffer.from(text), fixture.hir, fixture.context, fixture.request), fixture.expectedProof);
});
