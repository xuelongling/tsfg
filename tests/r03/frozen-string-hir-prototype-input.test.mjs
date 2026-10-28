// SPDX-License-Identifier: MIT
// Independent public boundary regression; production output supplies only the negative seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';

const input = await readFile(new URL('./string-facts-lossless.frozen-v1.jcs.json', import.meta.url));
assert.equal(input.length, 6147);
assert.equal(createHash('sha256').update(input).digest('hex'),
  '64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468');
const expectedPackageId = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';
const sentinelMessage = 'untrusted byte prototype sentinel must never be invoked';
const context = factsBytes => ({ factsBytes, expectedPackageId });

function hostileView(original, deep) {
  const bytes = Uint8Array.from(original);
  let traps = 0;
  const sentinel = new Error(sentinelMessage);
  const proxy = new Proxy(Uint8Array.prototype, {
    getPrototypeOf() { traps++; throw sentinel; },
  });
  // Both inputs remain genuine byte views; only the caller-owned prototype chain changes.
  Object.setPrototypeOf(bytes, deep ? Object.create(proxy) : proxy);
  return { bytes, count: () => traps };
}
function thrown(consume) {
  try { consume(); return undefined; }
  catch (error) { return error; }
}
function assertBoundary(error, code, trapCount) {
  assert.ok(error && typeof error === 'object', 'the public boundary must reject');
  assert.deepEqual({ code: error.code, ruleId: error.ruleId, phase: error.phase,
    leakedSentinel: typeof error.message === 'string' && error.message.includes(sentinelMessage), traps: trapCount },
  { code, ruleId: 'r01-input-boundary', phase: 'hir', leakedSentinel: false, traps: 0 });
}

test('selected string HIR byte views reject caller prototype chains before reflection', async t => {
  let facts, hir, wire;
  await t.test('standard Uint8Array and Buffer inputs are complete valid public seeds', () => {
    facts = readStringFactsCandidate(input);
    assert.equal(facts.packageId, expectedPackageId);
    for (const factBytes of [Uint8Array.from(input), Buffer.from(input)]) {
      const selected = context(factBytes), result = buildHir(facts, selected);
      assert.equal(result.status, 'ok', JSON.stringify(result));
      assert.equal(result.hir.inputIdentity, expectedPackageId);
      assert.equal(result.hir.functions.length, 14);
      const printed = printHir(result.hir, selected);
      for (const bytes of [Uint8Array.from(Buffer.from(printed)), Buffer.from(printed)]) {
        assert.deepEqual(readHir(bytes, selected), result.hir);
      }
      assert.deepEqual(verifyHir(result.hir, selected), result.hir);
      hir = result.hir; wire = Buffer.from(printed);
    }
  });
  for (const deep of [false, true]) {
    const suffix = deep ? 'ordinary prototype then Proxy' : 'direct Proxy prototype';
    await t.test('buildHir rejects factsBytes with ' + suffix, () => {
      const hostile = hostileView(input, deep);
      const result = buildHir(facts, context(hostile.bytes));
      assert.equal(result.status, 'error');
      assert.equal(Object.hasOwn(result, 'hir'), false);
      assert.equal(result.diagnostics.length, 1);
      assertBoundary(result.diagnostics[0], 'r03-hir-context', hostile.count());
    });
    await t.test('readHir rejects factsBytes with ' + suffix, () => {
      const hostile = hostileView(input, deep);
      const error = thrown(() => readHir(wire, context(hostile.bytes)));
      assertBoundary(error, 'r03-hir-context', hostile.count());
    });
    await t.test('verifyHir rejects factsBytes with ' + suffix, () => {
      const hostile = hostileView(input, deep);
      const error = thrown(() => verifyHir(hir, context(hostile.bytes)));
      assertBoundary(error, 'r03-hir-context', hostile.count());
    });
    await t.test('readHir rejects wire bytes with ' + suffix, () => {
      const hostile = hostileView(wire, deep);
      const error = thrown(() => readHir(hostile.bytes, context(input)));
      assertBoundary(error, 'r03-hir-invalid', hostile.count());
    });
  }
});
