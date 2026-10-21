// SPDX-License-Identifier: MIT
// Proposed only: write to the product tree after contract/oracle freeze.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir } from '../../compiler/hir.mjs';
import { example, canonical } from './string-hir-independent-fixtures.mjs';

/** @param {Uint8Array} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const v1SelectedJob = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';
const v2SelectedJob = 'sha256:df91096cd1604f9c9af35e04df1ff3c11d77faeb3d9890cbf9bdc57ab4d83c6e';

/** @param {string} file @param {number} bytes @param {string} hash */
function pinned(file, bytes, hash) {
  const data = readFileSync(new URL(file, import.meta.url));
  assert.equal(data.length, bytes);
  assert.equal(digest(data), hash);
  return data;
}

test('24f FIRST public buildHir: selected actual v2 typed concat', t => {
  // Existing test-only fixture loader pins the complete current v1 bytes.
  // This preparation never changes that helper or any v1 metadata.
  const v1 = example();
  const ownedV1 = readStringFactsCandidate(v1.factsBytes);
  assert.equal(ownedV1.packageId, v1SelectedJob);
  assert.equal(ownedV1.payload.functions.length, 14);
  assert.deepEqual(ownedV1, v1.facts);
  const control = buildHir(ownedV1, {
    factsBytes: Buffer.from(v1.factsBytes), expectedPackageId: v1SelectedJob,
  });
  assert.equal(control.status, 'ok', JSON.stringify(control.diagnostics ?? []));
  assert.deepEqual(control.hir, v1.hir);
  assert.equal(canonical(control.hir) + '\n', v1.hirBytes.toString('utf8'));
  t.diagnostic('BASE_V1_READER_AND_COMPLETE_HIR_CONTROLS_PASS');

  const factsBytes = pinned('./string-facts-concat.frozen-v2.jcs.json', 4855,
    '801792594c3f3b81d7d0a726bf99ea33772425f65abe3552236068d848c4498a');
  const expectedBytes = pinned('./string-hir-concat.frozen-v2.jcs.json', 6692,
    '8e2266b30452c4d665fea23eaa82ae27ca656f363be711c2fdeb89ffce29d2ae');
  // JSON.parse supplies untrusted input data, not a substitute v2 validator.
  const input = JSON.parse(factsBytes.toString('utf8'));
  assert.equal(input.packageId, v2SelectedJob);
  const context = { factsVersion: 2, factsBytes: Buffer.from(factsBytes),
    expectedPackageId: v2SelectedJob };
  const result = buildHir(input, context);
  if (result.status !== 'ok') {
    const code = result.diagnostics?.[0]?.code;
    t.diagnostic(JSON.stringify({ actualDiagnostics: result.diagnostics ?? [],
      classification: code === 'r03-hir-context'
        ? 'PUBLIC_V2_CONTEXT_ROUTE_API_GAP_NOT_CONCAT_SEMANTIC_RED'
        : 'ACTUAL_FAILURE_REQUIRES_CLASSIFICATION' }));
  }
  // A real rejection fails this positive test. No stub or expected throw turns it green.
  assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics ?? []));
  assert.deepEqual(result.hir, JSON.parse(expectedBytes.toString('utf8')));
  assert.equal(canonical(result.hir) + '\n', expectedBytes.toString('utf8'));
});
