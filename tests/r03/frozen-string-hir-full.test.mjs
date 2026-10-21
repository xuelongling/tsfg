// SPDX-License-Identifier: MIT
// Full independent literal oracle: no product output was used to create expected HIR.
import test from 'node:test';
import coreOracle from './string-core-oracle.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { readStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import {
  example, context, selectedId, stringTypeId, stringSignature, h10, manualUnits, manualRanges,
  hash, functionId, canonical, wire, copy, deeplyFrozen, manualEmptyFunctions, manualRepeatedA, setSource,
} from './string-hir-independent-fixtures.mjs';

test('24d full oracle independently fixes all fields, identities, owners, 42 ranges and 29 units', () => {
  const data = example(), expected = data.hir;
  assert.equal(expected.contractVersion, '0.12.0');
  assert.equal(expected.schemaHash, h10);
  assert.equal(expected.inputIdentity, selectedId);
  assert.equal(stringTypeId, hash('tsfg.type\0string'));
  assert.equal(stringSignature, hash('tsfg.signature\0()->string'));
  assert.equal(expected.source.hash, hash(expected.source.content));
  assert.equal(Buffer.byteLength(expected.source.content), 787);
  assert.equal(expected.source.content.length, 783);
  assert.equal(expected.functions.length, 14);
  assert.deepEqual(expected.functions.map(fn => fn.body[0].value.codeUnits), manualUnits);
  assert.equal(manualUnits.reduce((n, units) => n + units.length, 0), 29);
  expected.functions.forEach((fn, i) => {
    assert.equal(fn.name, 's' + String(i).padStart(2, '0'));
    assert.equal(fn.id, functionId('/src/main.ts', fn.name));
    assert.equal(fn.signatureHash, stringSignature);
    assert.deepEqual(fn.returnType, { kind: 'managedReference', name: 'string', id: stringTypeId });
    assert.deepEqual(fn.parameters, []);
    const ret = fn.body[0], value = ret.value;
    assert.equal(fn.body.length, 1);
    assert.equal(ret.kind, 'return');
    assert.equal(value.kind, 'stringConstant');
    assert.equal(value.type, stringTypeId);
    assert.deepEqual([fn.range, ret.range, value.range].map(r => [r.start, r.end]), manualRanges[i]);
  });
  assert.deepEqual(wire(expected), data.hirBytes, 'full frozen JCS+LF, never actual-output regeneration');
  assert.equal(canonical(expected), data.hirBytes.toString('utf8').slice(0, -1));
});

test('24d public build verify print read match complete fourteen-function frozen HIR bytes', () => {
  const data = example(), ctx = context(data.factsBytes);
  const facts = readStringFactsCandidate(data.factsBytes);
  const built = buildHir(facts, ctx);
  assert.equal(built.status, 'ok', JSON.stringify(built.diagnostics ?? []));
  assert.deepEqual(built.hir, data.hir, 'all fields, not just codeUnits or count');
  deeplyFrozen(built.hir);
  const verified = verifyHir(data.hir, ctx);
  assert.deepEqual(verified, data.hir);
  assert.notStrictEqual(verified, data.hir);
  deeplyFrozen(verified);
  assert.equal(printHir(verified, ctx), data.hirBytes.toString('utf8'));
  const read = readHir(data.hirBytes, ctx);
  assert.deepEqual(read, data.hir);
  deeplyFrozen(read);
  assert.deepEqual(readHir(Buffer.from(printHir(built.hir, ctx)), ctx), data.hir);
});

test('24d owned results survive mutable callers and input-buffer overwrite without freezing callers', () => {
  const data = example(), mutableFacts = copy(data.facts), mutableHir = copy(data.hir);
  const callerFactsBytes = Buffer.from(data.factsBytes);
  const built = buildHir(mutableFacts, { factsBytes: callerFactsBytes, expectedPackageId: selectedId });
  assert.equal(built.status, 'ok', JSON.stringify(built.diagnostics ?? []));
  const verified = verifyHir(mutableHir, { factsBytes: callerFactsBytes, expectedPackageId: selectedId });
  assert.equal(Object.isFrozen(mutableFacts), false);
  assert.equal(Object.isFrozen(mutableHir), false);
  assert.equal(Object.isFrozen(mutableHir.functions[5].body[0].value.codeUnits), false);
  mutableFacts.payload.functions[5].body[0].value.codeUnits[0] = 1;
  mutableFacts.payload.files[0].content = 'caller changed after build';
  mutableHir.functions[5].body[0].value.codeUnits[0] = 2;
  mutableHir.source.content = 'caller changed after verify';
  callerFactsBytes.fill(0);
  assert.deepEqual(built.hir, data.hir);
  assert.deepEqual(verified, data.hir);
  const backing = Buffer.concat([Buffer.from('prefix!'), data.hirBytes, Buffer.from('suffix!')]);
  const view = backing.subarray(7, 7 + data.hirBytes.length);
  const fromOffset = readHir(view, context(data.factsBytes));
  backing.fill(0);
  assert.deepEqual(fromOffset, data.hir);
  assert.equal(printHir(fromOffset, context(data.factsBytes)), data.hirBytes.toString('utf8'));
});

test('24d valid acyclic equal-value aliases remain writable input and independently owned output', () => {
  const data = example(), value = copy(data.hir);
  value.functions[3].body[0].value.codeUnits = value.functions[2].body[0].value.codeUnits;
  const verified = verifyHir(value, context(data.factsBytes));
  assert.deepEqual(verified, data.hir);
  value.functions[2].body[0].value.codeUnits[0] = 0;
  assert.deepEqual(verified, data.hir);
  deeplyFrozen(verified);
});

for (const name of /** @type {const} */ (['asi', 'boundaries'])) {
  test('24d complete manual cold ' + name + ' fixture preserves canonical typed HIR', () => {
    const data = example(name), ctx = context(data.factsBytes, data.expectedPackageId);
    const built = buildHir(readStringFactsCandidate(data.factsBytes), ctx);
    assert.equal(built.status, 'ok', JSON.stringify(built.diagnostics ?? []));
    assert.deepEqual(built.hir, data.hir);
    assert.equal(printHir(built.hir, ctx), data.hirBytes.toString('utf8'));
    assert.deepEqual(verifyHir(data.hir, ctx), data.hir);
    assert.deepEqual(readHir(data.hirBytes, ctx), data.hir);
    if (name === 'asi') {
      assert.equal(data.hir.functions[0].body[0].range.end,
        data.hir.functions[0].body[0].value.range.end, 'half-open inclusion permits ASI equal end');
    } else {
      assert.deepEqual(data.hir.functions[0].body[0].value.codeUnits,
        [0,55295,55296,56319,56320,57343,57344,65533,65535,56832,55357]);
    }
  });
}

test('24d valid cold boundaries admit 64 functions, 16384 units and exactly65536 Source bytes', () => {
  const maxSource = manualEmptyFunctions(1), original = maxSource.payload.files[0].content;
  const padded = setSource(maxSource, original + ' '.repeat(65536 - Buffer.byteLength(original)));
  for (const pkg of [manualEmptyFunctions(64), manualRepeatedA(16384), padded]) {
    const factsBytes = wire(pkg), ctx = context(factsBytes, pkg.packageId);
    const built = buildHir(readStringFactsCandidate(factsBytes), ctx);
    assert.equal(built.status, 'ok', JSON.stringify(built.diagnostics ?? []));
    assert.equal(built.hir.functions.length, pkg.payload.functions.length);
    assert.deepEqual(built.hir.functions.map(fn => fn.body[0].value.codeUnits),
      pkg.payload.functions.map(fn => fn.body[0].value.codeUnits));
    assert.deepEqual(readHir(Buffer.from(printHir(built.hir, ctx)), ctx), built.hir);
  }
});

test('24d legal String lowerHir matches the whole independent Core without value mutation', () => {
  const data = example(), ctx = context(data.factsBytes);
  const owned = verifyHir(data.hir, ctx);
  const expected = coreOracle.cases.find(c => c.name === 'lossless');
  assert.ok(expected);
  assert.equal(lowerHir(owned, ctx), expected.core);
  assert.deepEqual(owned, data.hir);
  assert.deepEqual(owned.functions.map(fn => fn.body[0].value.codeUnits), manualUnits);
});
