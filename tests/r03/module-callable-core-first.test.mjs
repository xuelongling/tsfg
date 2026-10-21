// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {importCapturedFrontendResponse} from '../../compiler/frontend-response.mjs';
import {buildHir, verifyHir, printHir, readHir, lowerHir} from '../../compiler/hir.mjs';

// Independent whole literals were frozen before the first candidate execution.
// Both original captured packets remain complete; this test spawns no producer.
const goldBytes = await readFile(new URL('./module-callable-core-first.json', import.meta.url));
assert.equal(createHash('sha256').update(goldBytes).digest('hex'),
  'dea77608c5784845e5318090521e082ea24368164052dea35f49b4c9e2ea2fcf');
const gold = JSON.parse(goldBytes.toString('utf8'));
const originalBytes = await readFile(new URL('./module-callable-immutable-global-first.json', import.meta.url));
const actualBytes = await readFile(new URL('./module-callable-immutable-global-source-actual.json', import.meta.url));
const original = JSON.parse(originalBytes.toString('utf8'));
const actual = JSON.parse(actualBytes.toString('utf8'));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? assert.fail('non-JSON oracle');
}

for (const row of gold.rows) test('complete immutable callable ' + row.id + ' lowers to formal Core', async () => {
  const input = row.id === 'bool' ? original : original.i32;
  const captured = row.id === 'bool' ? actual : actual.i32;
  assert.deepEqual(row.publicConfiguration,
    {seam: 'lowerHir', argumentCount: 1, hirSelector: row.id === 'bool' ? '$.hir' : '$.i32.hir'});
  assert.equal(captured.requestBytes, jcs(input.request) + '\n');
  assert.equal(captured.packetBytes, jcs(input.packet) + '\n');
  assert.deepEqual(captured.sourceOrigin, input.sourceOrigin);
  const imported = await importCapturedFrontendResponse(Buffer.from(captured.requestBytes),
    Buffer.from(captured.packetBytes), structuredClone(captured.sourceOrigin));
  assert.equal(imported.status, 'ok', jcs(imported));
  assert.deepEqual(imported.snapshot, input.snapshot);
  const built = buildHir(imported.snapshot);
  assert.equal(built.status, 'ok', jcs(built));
  assert.deepEqual(built.hir, input.hir);
  assert.deepEqual(verifyHir(structuredClone(built.hir)), input.hir);
  const printed = printHir(built.hir);
  assert.equal(printed, jcs(input.hir) + '\n');
  const cold = readHir(Buffer.from(printed));
  assert.deepEqual(cold, input.hir);
  assert.equal(cold.functions.length, row.counts.functions);
  assert.equal(cold.sources.length, row.counts.sources);
  assert.equal(cold.modules.length, row.counts.modules);
  assert.equal(cold.globals.length, row.counts.globals);
  // Capability RED must occur at the real public lowering call, never assert.throws.
  assert.equal(lowerHir(cold), row.expectedRawCore);
  assert.equal(jcs(cold), jcs(input.hir));
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-first.json', import.meta.url)), originalBytes);
  assert.deepEqual(await readFile(new URL('./module-callable-immutable-global-source-actual.json', import.meta.url)), actualBytes);
});
