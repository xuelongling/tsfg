// SPDX-License-Identifier: MIT
// Context authority is a caller-selected actual job, never an identity obtained from hostile HIR.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { readStringFactsV2Candidate } from '../../compiler/string-facts-v2.mjs';
import { example } from './string-hir-independent-fixtures.mjs';
import { fixture, context, copy, wire, sealFacts, selectedJob, buildReject, hirReject, deeplyFrozen, trapped, setSource } from './string-concat-hir-independent-fixtures.mjs';

/** @param {any} f @param {any} ctx @param {string} [code] */
function allReject(f, ctx, code = 'context') {
  buildReject(buildHir(f.facts, ctx), code);
  hirReject(() => verifyHir(f.hir, ctx), code); hirReject(() => printHir(f.hir, ctx), code);
  hirReject(() => readHir(f.hirBytes, ctx), code); hirReject(() => lowerHir(f.hir, ctx), code);
}
/** @type {Array<[string, (f: any) => any]>} */
const badContexts = [
  ['null', () => null], ['array', () => []], ['string', () => 'context'],
  ['missing bytes', () => ({factsVersion: 2, expectedPackageId: selectedJob})],
  ['missing selected ID', f => ({factsVersion: 2, factsBytes: f.factsBytes})],
  ['no explicit v2 selector', f => ({factsBytes: f.factsBytes, expectedPackageId: selectedJob})],
  ['explicit 1', f => ({...context(f.factsBytes), factsVersion: 1})],
  ['explicit undefined', f => ({...context(f.factsBytes), factsVersion: undefined})],
  ['string selector', f => ({...context(f.factsBytes), factsVersion: '2'})],
  ['unknown selector', f => ({...context(f.factsBytes), factsVersion: 3})],
  ['unknown field', f => ({...context(f.factsBytes), unused: true})],
  ['symbol field', f => ({...context(f.factsBytes), [Symbol('hidden')]: true})],
  ['custom prototype', f => Object.assign(Object.create({ambient: true}), context(f.factsBytes))],
  ['selected ID zero', f => ({...context(f.factsBytes), expectedPackageId: 'sha256:' + '0'.repeat(64)})],
  ['selected ID uppercase', f => ({...context(f.factsBytes), expectedPackageId: selectedJob.toUpperCase()})],
  ['selected ID absent prefix', f => ({...context(f.factsBytes), expectedPackageId: selectedJob.slice(7)})],
  ['corrupt facts bytes', () => ({factsVersion: 2, factsBytes: Buffer.from('null\n'), expectedPackageId: selectedJob})],
];
test('24f all public HIR entries require explicit exact fresh v2 context', async t => {
  for (const [name, make] of badContexts) await t.test(name, async () => { const f = await fixture(); allReject(f, make(f)); });
  const f = await fixture(), v1 = await example();
  allReject(f, {factsVersion: 2, factsBytes: v1.factsBytes, expectedPackageId: v1.expectedPackageId});
  const nullContext = Object.assign(Object.create(null), context(f.factsBytes));
  assert.deepEqual(verifyHir(f.hir, nullContext), f.hir);
  assert.equal(printHir(f.hir, nullContext), f.hirBytes.toString());
  assert.deepEqual(readHir(f.hirBytes, nullContext), f.hir);
  assert.equal(buildHir(Object.assign(Object.create(null), f.facts), nullContext).status, 'ok');
  const noContext = buildHir(f.facts);
  assert.equal(noContext.status, 'error'); assert.equal(Object.hasOwn(noContext, 'hir'), false);
  assert.equal(noContext.diagnostics[0].code, 'r03-d-snapshot');
  for (const action of [() => verifyHir(f.hir), () => printHir(f.hir), () => readHir(f.hirBytes), () => lowerHir(f.hir)]) {
    assert.throws(action, error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.startsWith('r03-hir-invalid:'), 'existing no-context scalar path rejects String');
      return true;
    });
  }
});

test('24f context descriptors and Proxy are rejected without behavioral reads', async t => {
  for (const field of ['factsVersion', 'factsBytes', 'expectedPackageId']) await t.test('accessor ' + field, async () => {
    const f = await fixture(), ctx = context(f.factsBytes); let calls = 0;
    Object.defineProperty(ctx, field, {enumerable: true, get() { calls++; throw Error('24f context getter'); }});
    allReject(f, ctx); assert.equal(calls, 0);
  });
  const f = await fixture(), calls = [];
  allReject(f, trapped(context(f.factsBytes), calls)); assert.deepEqual(calls, []);
  for (const field of ['factsVersion', 'factsBytes', 'expectedPackageId']) {
    const ctx = context(f.factsBytes); Object.defineProperty(ctx, field, {enumerable: false}); allReject(f, ctx);
  }
});

test('24f selected actual job rejects repaired foreign packets and live substitutions', async t => {
  /** @type {Array<[string, (p: any) => void]>} */
  const changes = [
    ['left units only', p => { p.payload.functions[2].body[0].value.left.codeUnits = [65]; }],
    ['right units only', p => { p.payload.functions[3].body[0].value.right.codeUnits = [66]; }],
    ['owner renamed', p => { p.payload.functions[5].name = 'foreignNormalization'; }],
    ['declaration range changed', p => { p.payload.functions[5].declarationRange.end = 422; }],
    ['source comment changed', p => { setSource(p, p.payload.files[0].content.replace('oracle', 'ORACLE')); }],
  ];
  // These are structurally valid foreign packets; no Source meaning is claimed.
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = await fixture(), foreign = copy(f.facts); change(foreign); sealFacts(foreign);
    const foreignBytes = wire(foreign); assert.notEqual(foreign.packageId, selectedJob);
    assert.deepEqual(readStringFactsV2Candidate(foreignBytes), foreign);
    allReject(f, {factsVersion: 2, factsBytes: foreignBytes, expectedPackageId: selectedJob});
    buildReject(buildHir(foreign, context(f.factsBytes)), 'context');
    allReject(f, {factsVersion: 2, factsBytes: foreignBytes, expectedPackageId: foreign.packageId});
    const forgedId = copy(foreign); forgedId.packageId = selectedJob;
    buildReject(buildHir(forgedId, context(f.factsBytes)), 'invalid');
  });
  const f = await fixture(), bad = copy(f.facts);
  bad.payload.functions[5].body[0].value.right.codeUnits = [65];
  assert.equal(bad.packageId, selectedJob, 'a claimed ID does not prove complete input equality');
  buildReject(buildHir(bad, context(f.factsBytes)), 'invalid');
  const foreignHir = copy(f.hir); foreignHir.inputIdentity = 'sha256:' + '0'.repeat(64);
  hirReject(() => verifyHir(foreignHir, context(f.factsBytes)), 'context');
  hirReject(() => readHir(wire(foreignHir), context(f.factsBytes)), 'context');
});

test('24f returned HIR owns bytes while reused overwritten contexts cannot cache trust', async () => {
  const f = await fixture(), ctx = context(f.factsBytes);
  const owned = verifyHir(f.hir, ctx); deeplyFrozen(owned); ctx.factsBytes.fill(0);
  assert.deepEqual(owned, f.hir); allReject(f, ctx);
  assert.deepEqual(verifyHir(f.hir, context(f.factsBytes)), f.hir);
  const storage = new Uint8Array(f.factsBytes.length + 8); storage.set(f.factsBytes, 3);
  const view = storage.subarray(3, 3 + f.factsBytes.length);
  const parsed = readHir(f.hirBytes, {factsVersion: 2, factsBytes: view, expectedPackageId: selectedJob});
  view.fill(0); assert.deepEqual(parsed, f.hir);
  const invalid = {factsVersion: 2, factsBytes: view, expectedPackageId: selectedJob}; allReject(f, invalid);
});

test('24f context validation has priority over unsafe HIR graphs', async () => {
  const f = await fixture(), bad = copy(f.hir), calls = [];
  bad.functions[5] = trapped(bad.functions[5], calls);
  hirReject(() => verifyHir(bad, {...context(f.factsBytes), expectedPackageId: 'sha256:' + '0'.repeat(64)}), 'context');
  assert.deepEqual(calls, []);
  hirReject(() => verifyHir(f.hir, {factsVersion: 2, factsBytes: Buffer.from('null\n'), expectedPackageId: selectedJob}), 'context', undefined, true);
});
