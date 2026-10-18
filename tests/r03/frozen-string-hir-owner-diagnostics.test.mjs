// SPDX-License-Identifier: MIT
// Independent regression for frozen-contract.md:197; public projection errors keep trusted owner locations.
// Production-built HIR is only a negative-test seed, never the complete semantic oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir, verifyHir, readHir } from '../../compiler/hir.mjs';

const fixture = new URL('./string-facts-lossless.frozen-v1.jcs.json', import.meta.url);
const fixtureSHA = '64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468';
const packageId = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';

// This serializer is independent from printHir/canonical and accepts only the known test-data graph.
// Invalid HIR must reach the public cold reader rather than fail early in production printHir.
function jcs(value) {
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const wire = hir => Buffer.from(jcs(hir) + '\n', 'utf8');

function positiveSeed() {
  const bytes = readFileSync(fixture);
  assert.equal(bytes.length, 6147);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixtureSHA);
  const facts = readStringFactsCandidate(bytes);
  assert.equal(facts.packageId, packageId);
  const context = { factsBytes: Buffer.from(bytes), expectedPackageId: packageId };
  const result = buildHir(facts, context);
  assert.equal(result.status, 'ok', 'valid selected context builds before owner-negative mutation');
  assert.equal(result.hir.functions.length, 14);
  assert.equal(result.hir.functions[7].name, 's07');
  assert.equal(result.hir.functions[13].name, 's13');
  assert.deepEqual(verifyHir(result.hir, context), result.hir);
  assert.deepEqual(readHir(wire(result.hir), context), result.hir);
  return { hir: structuredClone(result.hir), context };
}

// Literal expectations were transcribed from the fixed 6147-byte facts, before running this test.
// Never derive an expected source/range from the rejected HIR, and never substitute s00's location.
const cases = [
  { name: 's07 code unit', index: 7, primary: { sourceId: '/src/main.ts', start: 421, end: 435 },
    mutate: fn => { fn.body[0].value.codeUnits[0] = 56833; } },
  { name: 's13 code unit', index: 13, primary: { sourceId: '/src/main.ts', start: 770, end: 778 },
    mutate: fn => { fn.body[0].value.codeUnits[0] = 234; } },
  { name: 's13 literal range', index: 13, primary: { sourceId: '/src/main.ts', start: 770, end: 778 },
    mutate: fn => { fn.body[0].value.range.start = 769; } },
  { name: 's07 return range', index: 7, primary: { sourceId: '/src/main.ts', start: 414, end: 436 },
    mutate: fn => { fn.body[0].range.end = 435; } },
  { name: 's13 function range', index: 13, primary: { sourceId: '/src/main.ts', start: 731, end: 781 },
    mutate: fn => { fn.range.start = 732; } },
];

test('24d owner diagnostics: fixed facts/public build/verify/cold-read positive control', () => {
  positiveSeed();
});

for (const entry of cases) {
  for (const mode of ['verify', 'cold-read']) {
    test('24d owner diagnostics: ' + entry.name + ' rejected with selected anchor via ' + mode, () => {
      const { hir, context } = positiveSeed();
      entry.mutate(hir.functions[entry.index]);
      const invoke = mode === 'verify' ? () => verifyHir(hir, context) : () => readHir(wire(hir), context);
      assert.throws(invoke, /** @param {any} error */ error => {
        assert.equal(error.code, 'r03-hir-invalid');
        assert.equal(error.ruleId, 'r01-input-boundary');
        assert.equal(error.phase, 'hir');
        assert.deepEqual(error.primary, entry.primary, 'trusted selected owner anchor, not rejected data');
        return true;
      });
    });
  }
}
