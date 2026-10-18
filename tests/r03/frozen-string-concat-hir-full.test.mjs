// SPDX-License-Identifier: MIT
// Complete independent selected-job projection; no Source execution or String runtime credit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { readStringFactsV2Candidate, writeStringFactsV2Candidate } from '../../compiler/string-facts-v2.mjs';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { example } from './string-hir-independent-fixtures.mjs';
import { fixture, context, canonical, copy, deeplyFrozen, leaves, selectedJob, stringType,
  signature, sha256, wire, sealFacts } from './string-concat-hir-independent-fixtures.mjs';

// The full immutable 6692-byte independent oracle is the authority, never a production roundtrip.
test('24f complete selected v2 cold and HIR public pipeline', async () => {
  const f = await fixture();
  const old = await example();
  assert.deepEqual(readStringFactsCandidate(old.factsBytes), old.facts);
  const oldBuilt = buildHir(old.facts, { factsBytes: Buffer.from(old.factsBytes), expectedPackageId: old.expectedPackageId });
  assert.equal(oldBuilt.status, 'ok'); assert.deepEqual(oldBuilt.hir, old.hir);
  assert.deepEqual(sealFacts(copy(f.facts)), f.facts, 'independent v2 domains reconstruct complete identities');
  const ownedFacts = readStringFactsV2Candidate(f.factsBytes);
  assert.deepEqual(ownedFacts, f.facts); deeplyFrozen(ownedFacts);
  assert.notEqual(ownedFacts, f.facts); assert.notEqual(ownedFacts.payload, f.facts.payload);
  const firstBytes = writeStringFactsV2Candidate(f.facts), secondBytes = writeStringFactsV2Candidate(ownedFacts);
  assert.deepEqual(firstBytes, f.factsBytes); assert.deepEqual(secondBytes, f.factsBytes);
  assert.notEqual(firstBytes, secondBytes); firstBytes.fill(0); assert.deepEqual(secondBytes, f.factsBytes);
  const built = buildHir(f.facts, context(f.factsBytes));
  assert.equal(built.status, 'ok'); assert.deepEqual(built.hir, f.hir);
  assert.equal(canonical(built.hir) + '\n', f.hirBytes.toString()); deeplyFrozen(built.hir);
  const verified = verifyHir(f.hir, context(f.factsBytes));
  const printed = printHir(f.hir, context(f.factsBytes));
  const parsed = readHir(f.hirBytes, context(f.factsBytes));
  assert.deepEqual(verified, f.hir); assert.deepEqual(parsed, f.hir);
  assert.equal(printed, f.hirBytes.toString()); assert.deepEqual(Buffer.from(printed), f.hirBytes);
  for (const hir of [built.hir, verified, parsed]) { deeplyFrozen(hir); assert.notEqual(hir, f.hir); }
  assert.notEqual(verified, parsed); assert.notEqual(verified.source, parsed.source);
  assert.throws(() => lowerHir(f.hir, context(f.factsBytes)), error => {
    const e = /** @type {any} */ (error);
    assert.equal(e.code, 'r03-d-capability'); assert.equal(e.ruleId, 'r01-ts-baseline');
    assert.equal(e.phase, 'lowering'); return true;
  });
  f.facts.payload.functions[4].body[0].value.left.codeUnits[0] = 65;
  f.hir.functions[4].body[0].value.right.codeUnits[0] = 65;
  f.hirBytes.fill(0); f.factsBytes.fill(0);
  assert.deepEqual(wire(built.hir), Buffer.from(printed));
  assert.deepEqual(verified, parsed); assert.equal(ownedFacts.packageId, selectedJob);
});

test('24f all six owners retain manual identities UTF16 operands and six ranges', async () => {
  const { facts, hir, factsBytes, manual } = await fixture();
  const result = buildHir(facts, context(factsBytes)); assert.equal(result.status, 'ok');
  assert.deepEqual(result.hir, hir);
  let units = 0, ranges = 0;
  for (const [i, row] of manual.rows.entries()) {
    const fn = result.hir.functions[i], sf = facts.payload.functions[i], ret = fn.body[0], v = ret.value;
    assert.equal(fn.name, row.name); assert.equal(fn.id, row.functionId); assert.equal(fn.signatureHash, signature);
    assert.equal('sha256:' + sha256(Buffer.from(row.functionIdentityPreimageHex, 'hex')), row.functionId);
    assert.deepEqual(fn.returnType, { kind: 'managedReference', name: 'string', id: stringType });
    assert.equal(v.kind, 'stringConcat'); assert.equal(v.type, stringType);
    assert.deepEqual(Object.keys(v).sort(), ['kind', 'left', 'operatorRange', 'range', 'right', 'type']);
    for (const [actual, expected] of [[fn.range, row.declaration], [ret.range, row.statement],
      [v.range, row.concat], [v.operatorRange, row.operator], [v.left.range, row.left], [v.right.range, row.right]]) {
      assert.deepEqual(actual, { start: expected[0], end: expected[1] }); ranges++;
    }
    assert.deepEqual(v.left.codeUnits, row.leftUnits); assert.deepEqual(v.right.codeUnits, row.rightUnits);
    assert.equal(v.left.kind, 'stringConstant'); assert.equal(v.right.kind, 'stringConstant');
    assert.equal(v.left.type, stringType); assert.equal(v.right.type, stringType);
    assert.notEqual(v.left.codeUnits, sf.body[0].value.left.codeUnits);
    assert.notEqual(v.right.codeUnits, sf.body[0].value.right.codeUnits);
    units += v.left.codeUnits.length + v.right.codeUnits.length;
  }
  assert.equal(ranges, 36); assert.equal(units, 13); assert.equal(result.hir.functions.length, 6);
  assert.equal(new Set(leaves(result.hir).map(l => l.codeUnits)).size, 12);
  assert.equal(hir.source.content.length, 422); assert.equal(Buffer.byteLength(hir.source.content), 427);
  assert.equal((hir.source.content.match(/\r/g) ?? []).length, 1);
  assert.equal((hir.source.content.match(/\n/g) ?? []).length, 9);
  const asi = result.hir.functions[5].body[0]; assert.equal(asi.range.end, asi.value.range.end);
});

test('24f safe repeated input references are counted and copied per operand', async () => {
  const f = await fixture();
  f.facts.payload.functions[4].body[0].value.right.codeUnits = f.facts.payload.functions[4].body[0].value.left.codeUnits;
  assert.deepEqual(writeStringFactsV2Candidate(f.facts), f.factsBytes);
  const built = buildHir(f.facts, context(f.factsBytes)); assert.equal(built.status, 'ok');
  assert.deepEqual(built.hir, f.hir);
  const v = built.hir.functions[4].body[0].value;
  assert.notEqual(v.left.codeUnits, v.right.codeUnits);
  const caller = copy(f.hir); caller.functions[4].body[0].value.right.codeUnits = caller.functions[4].body[0].value.left.codeUnits;
  const owned = verifyHir(caller, context(f.factsBytes)); assert.deepEqual(owned, f.hir);
  assert.notEqual(owned.functions[4].body[0].value.left.codeUnits, owned.functions[4].body[0].value.right.codeUnits);
  assert.equal(Object.isFrozen(caller), false); assert.equal(Object.isFrozen(f.facts), false);
});
