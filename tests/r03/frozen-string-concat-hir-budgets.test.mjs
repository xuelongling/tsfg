// SPDX-License-Identifier: MIT
// Synthetic cold/HIR budgets are STRUCTURAL_ONLY, never producer or official Source evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';
import { readStringFactsV2Candidate as read, writeStringFactsV2Candidate as write } from '../../compiler/string-facts-v2.mjs';
import { copyGenericJsonBytes, checkGenericJsonValueBudget } from '../../compiler/generic-json.mjs';
import { fixture, context, copy, wire, sealFacts, setSource, factsLeaves, leaves,
  coldReject, hirReject, buildReject, selectedJob } from './string-concat-hir-independent-fixtures.mjs';

/** @param {any} packet @param {number[]} lengths */
function setFactsLengths(packet, lengths) {
  packet.payload.functions.flatMap(factsLeaves).forEach((leaf, i) => { leaf.codeUnits = Array(lengths[i] ?? 0).fill(65); });
  return sealFacts(packet);
}
/** @param {any} f @param {any} value */
function hirLimit(f, value) {
  for (const action of [() => verifyHir(value, context(f.factsBytes)), () => printHir(value, context(f.factsBytes)),
    () => readHir(wire(value), context(f.factsBytes)), () => lowerHir(value, context(f.factsBytes))]) {
    assert.throws(action, error => {
      const e = /** @type {any} */ (error);
      assert.equal(e.code, 'r03-hir-limit'); assert.equal(e.ruleId, 'r01-input-boundary'); assert.equal(e.phase, 'hir');
      assert.equal(Object.hasOwn(e, 'primary'), false, 'global budget has no fabricated owner'); return true;
    });
  }
}
/** Fixed literal fragments with direct offsets, not a Source parser/evaluator. @param {any} base @param {number} count */
function emptyOwners(base, count) {
  const p = copy(base); let source = ''; const functions = [];
  for (let i = 0; i < count; i++) {
    const name = 'c' + String(i).padStart(2, '0'), prefix = 'export function ' + name + '(): string { ';
    const line = prefix + 'return "" + ""; }', start = source.length, ret = start + prefix.length;
    const left = ret + 7, plus = left + 3, right = plus + 2;
    const lr = {start: left, end: left + 2}, rr = {start: right, end: right + 2};
    functions.push({name, sourcePath: p.payload.rootFile, parameters: [], returnType: 'string',
      declarationRange: {start, end: start + line.length},
      body: [{kind: 'return', range: {start: ret, end: rr.end + 1}, value: {kind: 'stringConcat', type: 'string',
        range: {start: left, end: rr.end}, operatorRange: {start: plus, end: plus + 1},
        left: {kind: 'stringLiteral', type: 'string', range: lr, codeUnits: []},
        right: {kind: 'stringLiteral', type: 'string', range: rr, codeUnits: []}}}]});
    source += line + '\n';
    assert.equal(source.slice(left, left + 2), '""'); assert.equal(source[plus], '+');
    assert.equal(source.slice(right, right + 2), '""');
  }
  p.payload.functions = functions; setSource(p, source); return sealFacts(p);
}

test('24f v2 cold leaf concat aggregate and function structural budgets', async t => {
  /** @type {Array<[string, number[]]>} */
  const accepted = [['leaf16384', [16384]], ['concat32768', [16384, 16384]],
    ['aggregate65536', [16384, 16384, 16384, 16384]]];
  for (const [name, lengths] of accepted) await t.test(name, async () => {
    const {facts} = await fixture(), p = setFactsLengths(facts, /** @type {number[]} */ (lengths));
    const bytes = wire(p); assert.deepEqual(read(bytes), p); assert.deepEqual(write(p), bytes);
  });
  /** @type {Array<[string, number[]]>} */
  const rejected = [['leaf16385', [16385]], ['aggregate65537', [16384, 16384, 16384, 16384, 1]]];
  for (const [name, lengths] of rejected) {
    await t.test(name, async () => {
      const {facts} = await fixture(), p = setFactsLengths(facts, /** @type {number[]} */ (lengths));
      assert.ok(wire(p).length < 2097152); coldReject(() => read(wire(p)), 'limit'); coldReject(() => write(p), 'limit');
    });
  }
  const {facts} = await fixture(), at = emptyOwners(facts, 64), over = emptyOwners(facts, 65);
  assert.deepEqual(read(wire(at)), at); assert.deepEqual(write(at), wire(at));
  coldReject(() => read(wire(over)), 'limit'); coldReject(() => write(over), 'limit');
  // 32769 concat units require a leaf above16384; this is not an independently isolatable bound.
});

test('24f HIR domain budgets precede complete projection mismatches', async () => {
  const f = await fixture();
  for (const lengths of [[16385], [16384, 16384, 16384, 16384, 1]]) {
    const h = copy(f.hir); leaves(h).forEach((leaf, i) => { leaf.codeUnits = Array(lengths[i] ?? 0).fill(65); }); hirLimit(f, h);
  }
  const at = copy(f.hir); leaves(at).forEach((leaf, i) => { leaf.codeUnits = Array(i < 4 ? 16384 : 0).fill(65); });
  // Boundary65536 passes budgets, then correctly fails exact projection to the actual selected packet.
  hirReject(() => verifyHir(at, context(f.factsBytes)), 'invalid');
  const many = copy(f.hir); many.functions = Array.from({length: 65}, () => copy(f.hir.functions[0])); hirLimit(f, many);
  const source = copy(f.hir); source.source.content += ' '.repeat(65537 - Buffer.byteLength(source.source.content)); hirLimit(f, source);
});

test('24f v2 cold source UTF8 byte boundary is exact and identity repaired', async () => {
  const f = await fixture(), content = f.facts.payload.files[0].content;
  for (const size of [65536, 65537]) {
    const p = copy(f.facts); setSource(p, content + ' '.repeat(size - Buffer.byteLength(content))); sealFacts(p);
    assert.equal(Buffer.byteLength(p.payload.files[0].content), size);
    if (size === 65536) { assert.deepEqual(read(wire(p)), p); assert.deepEqual(write(p), wire(p)); }
    else { coldReject(() => read(wire(p)), 'limit'); coldReject(() => write(p), 'limit'); }
  }
});

test('24f v2 cold domain budget precedes canonical comparison', async () => {
  const {facts} = await fixture(); facts.payload.functions[2].body[0].value.left.codeUnits = Array(16385).fill(65);
  const canonicalButUnsealed = wire(facts), noncanonical = Buffer.concat([Buffer.from(' '), canonicalButUnsealed]);
  assert.ok(noncanonical.length < 2097152);
  // Valid JSON, generic budgets in range, but the String leaf is over its frozen domain budget.
  // Neither noncanonical spacing nor stale IDs may hide that required limit classification.
  coldReject(() => read(noncanonical), 'limit');
});

test('24f oversized context package maps domain limit before selected identity', async () => {
  const f = await fixture(), p = copy(f.facts); p.payload.functions[2].body[0].value.left.codeUnits = Array(16385).fill(65);
  const ctx = {factsVersion: 2, factsBytes: wire(p), expectedPackageId: selectedJob};
  buildReject(buildHir(f.facts, ctx), 'limit');
  for (const action of [() => verifyHir(f.hir, ctx), () => printHir(f.hir, ctx), () => readHir(f.hirBytes, ctx)]) {
    hirReject(action, 'limit', undefined, true);
  }
});

test('24f public JSON frame and live graph budgets reject before schema projection', async t => {
  for (const budget of ['depth', 'tokens', 'stringBytes', 'valueBytes']) await t.test(budget, async () => {
    const f = await fixture(), p = copy(f.facts), h = copy(f.hir);
    let extension;
    if (budget === 'depth') { extension = {}; for (let i = 0; i < 70; i++) extension = {next: extension}; }
    else if (budget === 'tokens') extension = Array(200001).fill(0);
    else if (budget === 'stringBytes') extension = 'A'.repeat(1048577);
    else extension = Array(100000).fill('A'.repeat(24));
    p.payload.extra = extension; h.extra = extension;
    coldReject(() => read(wire(p)), 'limit'); coldReject(() => write(p), 'limit'); hirLimit(f, h);
  });
  const f = await fixture(), bytes = Buffer.alloc(2097153, 32); f.factsBytes.copy(bytes);
  coldReject(() => read(bytes), 'limit', true);
  const hirBytes = Buffer.alloc(2097153, 32); f.hirBytes.copy(hirBytes);
  hirReject(() => readHir(hirBytes, context(f.factsBytes)), 'limit', undefined, true);
});

// These are natural shared-helper unit checks, not a public cold package accepted at every cap.
// Public shape/Source constraints prevent isolating all JSON caps with a valid selected actual packet.
test('24f shared native snapshot and JSON budgets have exact mechanical boundaries', () => {
  const policy = Object.freeze({bytes: 2097152, depth: 64, jsonTokens: 200000, stringBytes: 1048576,
    safeNonnegativeIntegers: true, allowNul: true, rejectPrototypeKeys: true});
  const bytes = Buffer.alloc(2097152, 65), owned = copyGenericJsonBytes(bytes, policy);
  assert.deepEqual(owned, bytes); assert.notEqual(owned, bytes); bytes.fill(0); assert.equal(owned[0], 65);
  assert.throws(() => copyGenericJsonBytes(Buffer.alloc(2097153), policy), {code: 'generic-package-io-limit'});
  const valuePolicy = Object.freeze({...policy, bytes: 2097151});
  const exact = ['A'.repeat(1048576), 'B'.repeat(1048568)];
  assert.equal(wire(exact).length - 1, 2097151); checkGenericJsonValueBudget(exact, valuePolicy);
  assert.throws(() => checkGenericJsonValueBudget([exact[0], exact[1] + 'B'], valuePolicy), {code: 'generic-package-io-limit'});
  let depth64 = 0; for (let i = 0; i < 64; i++) depth64 = /** @type {any} */ ([depth64]);
  checkGenericJsonValueBudget(depth64, valuePolicy);
  assert.throws(() => checkGenericJsonValueBudget([depth64], valuePolicy), {code: 'generic-package-io-limit'});
  checkGenericJsonValueBudget(Array(199998).fill(0), valuePolicy);
  assert.throws(() => checkGenericJsonValueBudget(Array(199999).fill(0), valuePolicy), {code: 'generic-package-io-limit'});
  checkGenericJsonValueBudget('A'.repeat(1048576), valuePolicy);
  assert.throws(() => checkGenericJsonValueBudget('A'.repeat(1048577), valuePolicy), {code: 'generic-package-io-limit'});
});
