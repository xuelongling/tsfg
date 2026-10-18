// SPDX-License-Identifier: MIT
// Persisted HIR is encoded independently for every negative; no producer/printer creates expected data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { readStringFactsV2Candidate as read, writeStringFactsV2Candidate as write } from '../../compiler/string-facts-v2.mjs';
import { fixture, context, copy, wire, sealFacts, coldReject, hirReject } from './string-concat-hir-independent-fixtures.mjs';

/** @type {Array<[string, string, (b: Buffer) => Buffer]>} */
const raw = [
  ['invalid UTF8', 'invalid', () => Buffer.from([255])],
  ['raw surrogate UTF8', 'invalid', () => Buffer.from([237, 160, 128])],
  ['BOM', 'canonical', b => Buffer.concat([Buffer.from([239, 187, 191]), b])],
  ['missing LF', 'canonical', b => b.subarray(0, -1)],
  ['second LF', 'canonical', b => Buffer.concat([b, Buffer.from('\n')])],
  ['CRLF', 'canonical', b => Buffer.concat([b.subarray(0, -1), Buffer.from('\r\n')])],
  ['leading whitespace', 'canonical', b => Buffer.concat([Buffer.from(' '), b])],
  ['duplicate key', 'invalid', b => Buffer.from(b.toString().replace('"contractVersion":"0.11.0"', '"contractVersion":"0.11.0","contractVersion":"0.11.0"'))],
  ['escaped duplicate key', 'invalid', b => Buffer.from(b.toString().replace('"contractVersion":"0.11.0"',
    '"contractVersion":"0.11.0","contractVers' + String.fromCharCode(92) + 'u0069on":"0.11.0"'))],
  ['trailing JSON value', 'invalid', b => Buffer.concat([b, Buffer.from('{}\n')])],
  ['null root', 'invalid', () => Buffer.from('null\n')],
  ['unpaired JSON surrogate', 'invalid', b => Buffer.from(b.toString().replace('"name":"paired"', '"name":"' + String.fromCharCode(92) + 'ud800"'))],
  ['negative zero preflight', 'invalid', b => Buffer.from(b.toString().replace('"codeUnits":[0]', '"codeUnits":[-0]'))],
  ['prototype key', 'invalid', b => Buffer.from(b.toString().replace('"contractVersion":"0.11.0"', '"__proto__":{},"contractVersion":"0.11.0"'))],
  ['noncanonical key order', 'canonical', b => { const h = JSON.parse(b.toString());
    return Buffer.from(JSON.stringify({source: h.source, target: h.target, functions: h.functions,
      contractVersion: h.contractVersion, schemaHash: h.schemaHash, inputIdentity: h.inputIdentity}) + '\n'); }],
  ['equivalent JSON escape', 'canonical', b => Buffer.from(b.toString().replace('é', String.fromCharCode(92) + 'u00e9'))],
];
test('24f persisted HIR strict UTF8 JSON canonical bytes use independent negatives', async t => {
  for (const [name, code, change] of raw) await t.test(name, async () => {
    const f = await fixture(), bad = change(f.hirBytes);
    assert.notDeepEqual(bad, f.hirBytes); hirReject(() => readHir(bad, context(f.factsBytes)), code);
  });
});

test('24f boundary errors preserve actual causes and fixed public domains', async () => {
  const f = await fixture();
  coldReject(() => read(Buffer.from([255])), 'utf8', true);
  coldReject(() => read(Buffer.from('{"version":2,"version":2}\n')), 'json', true);
  const wrongPath = copy(f.facts); wrongPath.payload.sourceRoot += '/'; sealFacts(wrongPath);
  coldReject(() => read(wire(wrongPath)), 'input', true); coldReject(() => write(wrongPath), 'input', true);
  hirReject(() => readHir(Buffer.from([255]), context(f.factsBytes)), 'invalid', undefined, true);
  const ctx = {factsVersion: 2, factsBytes: Buffer.from('null\n'), expectedPackageId: f.facts.packageId};
  for (const action of [() => verifyHir(f.hir, ctx), () => printHir(f.hir, ctx),
    () => readHir(f.hirBytes, ctx), () => lowerHir(f.hir, ctx)]) hirReject(action, 'context', undefined, true);
});

test('24f copied caller frames and separate cold reads share no writable storage', async () => {
  const f = await fixture(), first = read(f.factsBytes), second = read(f.factsBytes);
  assert.notEqual(first, second); assert.notEqual(first.payload.files, second.payload.files);
  assert.notEqual(first.payload.functions[5].body[0].value.left.codeUnits, second.payload.functions[5].body[0].value.left.codeUnits);
  const h1 = readHir(f.hirBytes, context(f.factsBytes)), h2 = readHir(f.hirBytes, context(f.factsBytes));
  assert.notEqual(h1, h2); assert.notEqual(h1.functions[5], h2.functions[5]);
  f.hirBytes.fill(0); f.factsBytes.fill(0);
  assert.deepEqual(h1, f.hir); assert.deepEqual(h2, f.hir); assert.deepEqual(first, f.facts); assert.deepEqual(second, f.facts);
});
