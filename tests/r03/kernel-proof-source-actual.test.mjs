// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse } from '../../compiler/frontend-response.mjs';
import { buildHir, analyzeModuleCalls, verifyKernelParallelProof,
  printKernelParallelProof, readKernelParallelProof } from '../../compiler/hir.mjs';

/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const bytes = value => Buffer.from(jcs(value) + '\n');
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
// Both the independent whole oracle and actual captured producer bytes predate
// this adapter. No Source process or upstream AST is used by this static test.
const expected = JSON.parse(await readFile(new URL('./module-callable-immutable-global-first.json', import.meta.url), 'utf8'));
const actual = JSON.parse(await readFile(new URL('./module-callable-immutable-global-source-actual.json', import.meta.url), 'utf8'));
test('actual owned Source packet reaches cold kernel proof consumption without new authority', async () => {
  assert.equal(actual.requestBytes, bytes(expected.request).toString('utf8'));
  assert.equal(actual.packetBytes, bytes(expected.packet).toString('utf8'));
  assert.deepEqual(actual.sourceOrigin, expected.sourceOrigin);
  assert.equal(hash(Buffer.from(actual.packetBytes)), expected.sourceOrigin.responseSha256);
  const imported = await importCapturedFrontendResponse(Buffer.from(actual.requestBytes),
    Buffer.from(actual.packetBytes), structuredClone(actual.sourceOrigin));
  assert.deepEqual(imported, { status: 'ok', snapshot: expected.snapshot });
  const built = buildHir(imported.snapshot);
  assert.deepEqual(built, { status: 'ok', hir: expected.hir });
  assert.deepEqual(analyzeModuleCalls(built.hir, expected.context), expected.analysis);
  for (const row of expected.proofs) {
    assert.ok(row.proof); const request = { targets: row.targets }, text = jcs(row.proof) + '\n';
    assert.deepEqual(verifyKernelParallelProof(structuredClone(row.proof), built.hir, expected.context, request), row.proof);
    assert.equal(printKernelParallelProof(row.proof, built.hir, expected.context, request), text);
    const proof = readKernelParallelProof(Buffer.from(text), built.hir, expected.context, request);
    assert.deepEqual(proof, row.proof); assert.ok(Object.isFrozen(proof));
  }
});
