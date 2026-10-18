// SPDX-License-Identifier: MIT
// Independent first public String HIR capability check; no Source semantics or native execution credit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir } from '../../compiler/hir.mjs';

const fixture = new URL('./string-facts-lossless.frozen-v1.jcs.json', import.meta.url);
const fixtureBytes = 6147;
const fixtureSHA = '64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468';
// Literal identity of the independently frozen complete package, never derived from HIR output.
const fixturePackageId = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';
// Literal manual s00..s13 oracle, fixed before any String HIR implementation.
const manualCodeUnits = [
  [], [0], [55357, 56832], [55357, 56832], [55357, 56832], [55296], [56320],
  [56832, 55357], [65, 55296, 0, 56320, 90], [92, 34, 10, 13, 9, 65, 66],
  [55296, 56320], [57344], [101, 769], [233],
];
const manualNames = [
  's00', 's01', 's02', 's03', 's04', 's05', 's06',
  's07', 's08', 's09', 's10', 's11', 's12', 's13',
];

function readFrozenOwnedPackage() {
  const frozenBytes = readFileSync(fixture);
  assert.equal(frozenBytes.length, fixtureBytes, 'complete frozen cold package byte count');
  assert.equal(createHash('sha256').update(frozenBytes).digest('hex'), fixtureSHA,
    'complete frozen cold package identity; never regenerate from actual');
  const owned = readStringFactsCandidate(frozenBytes);
  assert.equal(owned.packageId, fixturePackageId, 'selected complete package identity');
  return { frozenBytes, owned };
}

test('24d first positive control: cold reader preserves all fourteen manual UTF16 values', () => {
  const { owned } = readFrozenOwnedPackage();
  assert.deepEqual(owned.payload.functions.map(fn => fn.name), manualNames);
  assert.deepEqual(owned.payload.functions.map(fn => fn.body[0].value.codeUnits), manualCodeUnits,
    'all fourteen complete owned values match the independent manual code-unit oracle');
});

test('24d first public String HIR capability: buildHir accepts the complete owned package', () => {
  // Same full valid package as the control, with all metadata and required String input context.
  const { frozenBytes, owned } = readFrozenOwnedPackage();
  const result = buildHir(owned, {
    factsBytes: Buffer.from(frozenBytes),
    expectedPackageId: fixturePackageId,
  });
  assert.equal(result.status, 'ok',
    'PUBLIC_STRING_CAPABILITY_RED: expected existing buildHir to accept the valid String package; '
    + 'actual diagnostics=' + JSON.stringify(result.diagnostics ?? []));
  const functions = result.hir?.functions;
  assert.ok(Array.isArray(functions), 'successful public result has a functions array');
  assert.equal(functions.length, 14, 'public result contains all fourteen functions');
  // String HIR shape/value identities require the later independently frozen full oracle.
});
