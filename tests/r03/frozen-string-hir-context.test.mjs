// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { example, context, selectedId, copy, wire, sealFacts, rejectsCode } from './string-hir-independent-fixtures.mjs';

/** @param {any} input @param {any} ctx @param {string | string[]} codes */
function buildRejects(input, ctx, codes) {
  const accepted = Array.isArray(codes) ? codes : [codes], result = buildHir(input, ctx);
  assert.equal(result.status, 'error');
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
  assert.ok(accepted.includes(result.diagnostics[0].code), JSON.stringify(result.diagnostics));
  assert.equal(typeof result.diagnostics[0].ruleId, 'string');
  assert.ok(result.diagnostics[0].ruleId.length > 0);
  assert.equal(result.diagnostics[0].phase, 'hir');
  assert.equal(result.hir, undefined);
}

test('24d context accepts a real Uint8Array byte window and literal selected job ID', () => {
  const data = example(), backing = Buffer.concat([Buffer.from('pad'), data.factsBytes, Buffer.from('tail')]);
  const bytes = new Uint8Array(backing.buffer, backing.byteOffset + 3, data.factsBytes.length);
  const ctx = { factsBytes: bytes, expectedPackageId: selectedId };
  assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
  assert.deepEqual(readHir(data.hirBytes, ctx), data.hir);
});

test('24d no context never grants standalone String validation or lowering', () => {
  const data = example(), facts = readStringFactsCandidate(data.factsBytes);
  const build = buildHir(facts);
  assert.equal(build.status, 'error');
  assert.ok(['r03-d-snapshot', 'r03-hir-invalid', 'r03-hir-context'].includes(build.diagnostics[0].code));
  for (const action of [() => verifyHir(data.hir), () => printHir(data.hir),
    () => readHir(data.hirBytes), () => lowerHir(data.hir)]) {
    assert.throws(action, error => {
      const e = /** @type {any} */ (error);
      const code = e.code ?? /^r03-[^ :]+/.exec(e.message)?.[0];
      assert.ok(['r03-d-snapshot','r03-hir-invalid','r03-hir-context'].includes(code));
      return true;
    });
  }
});

test('24d context closed shape and selected ID are checked at all public entry points', () => {
  const data = example(), facts = readStringFactsCandidate(data.factsBytes);
  assert.deepEqual(verifyHir(data.hir, context(data.factsBytes)), data.hir);
  const cases = [
    null, {}, [], { ...context(data.factsBytes), extra: true },
    { factsBytes: data.factsBytes }, { expectedPackageId: selectedId },
    { factsBytes: 'not bytes', expectedPackageId: selectedId },
    { factsBytes: data.factsBytes, expectedPackageId: 'sha256:' + '0'.repeat(64) },
    { factsBytes: data.factsBytes, expectedPackageId: selectedId.toUpperCase() },
  ];
  for (const ctx of cases) {
    buildRejects(facts, ctx, 'r03-hir-context');
    for (const action of [() => verifyHir(data.hir, ctx), () => printHir(data.hir, ctx),
      () => readHir(data.hirBytes, ctx), () => lowerHir(data.hir, ctx)]) rejectsCode(action, 'r03-hir-context');
  }
});

test('24d self-consistent foreign packages cannot replace the independently selected job', () => {
  const a = example(), b = example('asi');
  assert.deepEqual(verifyHir(b.hir, context(b.factsBytes, b.expectedPackageId)), b.hir);
  assert.notEqual(b.expectedPackageId, selectedId);
  const wrongContext = context(b.factsBytes, selectedId);
  rejectsCode(() => verifyHir(a.hir, wrongContext), 'r03-hir-context');
  rejectsCode(() => readHir(a.hirBytes, wrongContext), 'r03-hir-context');
  rejectsCode(() => verifyHir(b.hir, wrongContext), 'r03-hir-context');
  buildRejects(readStringFactsCandidate(b.factsBytes), wrongContext, 'r03-hir-context');
  rejectsCode(() => verifyHir(a.hir, context(b.factsBytes, b.expectedPackageId)), 'r03-hir-context');
  const wrongId = copy(a.hir); wrongId.inputIdentity = b.expectedPackageId;
  rejectsCode(() => verifyHir(wrongId, context(a.factsBytes)), 'r03-hir-context');
});

test('24d rehashed altered facts are structurally valid but cannot reset expectedPackageId', () => {
  const data = example(), altered = copy(data.facts);
  altered.payload.functions[5].body[0].value.codeUnits[0] = 55297;
  const rehashed = sealFacts(altered), bytes = wire(rehashed);
  assert.notEqual(rehashed.packageId, selectedId);
  assert.equal(readStringFactsCandidate(bytes).packageId, rehashed.packageId,
    'cold structural validity does not independently prove Source value semantics');
  buildRejects(readStringFactsCandidate(bytes), context(bytes, selectedId), 'r03-hir-context');
  const spliced = copy(data.hir);
  spliced.inputIdentity = rehashed.packageId;
  spliced.functions[5].body[0].value.codeUnits[0] = 55297;
  rejectsCode(() => verifyHir(spliced, context(bytes, selectedId)), 'r03-hir-context');
});

test('24d build validates the complete supplied package instead of trusting a matching claimed ID', () => {
  const data = example(), facts = readStringFactsCandidate(data.factsBytes), ctx = context(data.factsBytes);
  assert.equal(buildHir(facts, ctx).status, 'ok');
  buildRejects(facts.payload, ctx, ['r03-hir-invalid','r03-hir-context']);
  const changed = copy(data.facts); changed.payload.functions[13].body[0].value.codeUnits[0] = 234;
  buildRejects(changed, ctx, ['r03-hir-context','r03-hir-invalid']);
  const other = example('asi');
  buildRejects(readStringFactsCandidate(other.factsBytes), ctx, 'r03-hir-context');
});

test('24d context rereads full cold identities and preserves an underlying rejection cause', () => {
  const data = example(), bad = copy(data.facts);
  bad.requestId = 'sha256:' + '0'.repeat(64);
  assert.equal(bad.packageId, selectedId, 'packageId alone cannot validate the full request envelope');
  const ctx = context(wire(bad));
  assert.throws(() => verifyHir(data.hir, ctx), error => {
    const e = /** @type {any} */ (error);
    assert.equal(e.code, 'r03-hir-context');
    assert.ok(e.cause instanceof Error, 'cold-reader failure cause survives the public throw boundary');
    return true;
  });
  for (const mutate of [
    value => { value.packageId = 'sha256:' + '0'.repeat(64); },
    value => { value.payload.files[0].sha256 = '0'.repeat(64); },
    value => { value.payload.functions[5].body[0].value.codeUnits[0] = 65536; },
  ]) {
    const invalid = copy(data.facts); mutate(invalid);
    const resealed = sealFacts(invalid);
    // A packageId mutation is deliberately kept after rehashing to test that exact field.
    if (invalid.packageId !== selectedId) resealed.packageId = invalid.packageId;
    rejectsCode(() => verifyHir(data.hir, context(wire(resealed), resealed.packageId)), 'r03-hir-context');
  }
});

test('24d context accessors and Proxy records/byte views reject before user code runs', () => {
  const data = example(), facts = readStringFactsCandidate(data.factsBytes);
  let touched = 0;
  const getter = { expectedPackageId: selectedId };
  Object.defineProperty(getter, 'factsBytes', { enumerable: true, get() { touched++; return data.factsBytes; } });
  const traps = {
    get() { touched++; throw new Error('must not get Proxy'); },
    ownKeys() { touched++; throw new Error('must not enumerate Proxy'); },
    getPrototypeOf() { touched++; throw new Error('must not inspect Proxy prototype'); },
  };
  const proxy = new Proxy(context(data.factsBytes), traps);
  const bytesProxy = { factsBytes: new Proxy(data.factsBytes, traps), expectedPackageId: selectedId };
  for (const ctx of [getter, proxy, bytesProxy]) {
    buildRejects(facts, ctx, 'r03-hir-context');
    rejectsCode(() => verifyHir(data.hir, ctx), 'r03-hir-context');
    rejectsCode(() => printHir(data.hir, ctx), 'r03-hir-context');
    rejectsCode(() => readHir(data.hirBytes, ctx), 'r03-hir-context');
  }
  assert.equal(touched, 0);
});

test('24d context diagnostics do not dump untrusted fields or source-like sentinel text', () => {
  const data = example(), sentinel = 'UNTRUSTED_24D_FIELD_MUST_NOT_BE_DUMPED';
  const ctx = { ...context(data.factsBytes), extra: sentinel };
  const result = buildHir(readStringFactsCandidate(data.factsBytes), ctx);
  assert.equal(result.status, 'error');
  assert.equal(JSON.stringify(result.diagnostics).includes(sentinel), false);
});
