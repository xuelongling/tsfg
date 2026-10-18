// SPDX-License-Identifier: MIT
// Frozen cold protocol oracle. BASE refusal is an API gap, never official Source semantic RED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildHir, verifyHir, printHir, readHir } from '../../compiler/hir.mjs';

/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}';
}
/** @param {string | Uint8Array} value */
const sha = value => createHash('sha256').update(value).digest('hex');
/** @param {any} value @returns {any} */
const fresh = value => JSON.parse(jcs(value));
/** @param {string} file @param {number} size @param {string} hash @returns {Promise<any>} */
async function frozen(file, size, hash) {
  const bytes = await readFile(new URL(file, import.meta.url));
  assert.equal(bytes.length, size); assert.equal(sha(bytes), hash);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(jcs(value) + '\n', bytes.toString('utf8')); return value;
}
/** @param {any} object @param {string} path @returns {any} */
function at(object, path) {
  assert.ok(path.startsWith('$.'));
  for (const key of path.slice(2).replace(/\[(\d+)\]/g, '.$1').split('.')) object = object[key];
  return object;
}
/** @param {string} source @param {any} range @param {string} text */
function range(source, range, text) {
  assert.ok(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end));
  assert.ok(!Object.is(range.start, -0) && !Object.is(range.end, -0));
  assert.ok(range.start >= 0 && range.start < range.end && range.end <= source.length);
  for (const n of [range.start, range.end]) assert.ok(!(n > 0 && n < source.length
    && source.charCodeAt(n) >= 0xdc00 && source.charCodeAt(n) <= 0xdfff
    && source.charCodeAt(n - 1) >= 0xd800 && source.charCodeAt(n - 1) <= 0xdbff));
  assert.equal(source.slice(range.start, range.end), text);
}

test('25b frozen whole facts and HIR controls precede existing public buildHir FIRST', async t => {
  const facts = await frozen('./array-facts-oracle-v1.json', 82788, '877483469d61070970cd48a9053fb2efd2028f45d934fda326c43e4b272c1b9d');
  const oracle = await frozen('./array-hir-oracle-v1.json', 79667, 'ca01aa9744a43aabe16e0b73bfaf3e9ec29affddd666fa62ba4017b34a597c68');
  assert.equal(facts.provenance.productImported, false); assert.equal(facts.provenance.producerCalled, false);
  assert.equal(facts.provenance.floatBitsCalled, false); assert.equal(oracle.provenance.buildHirCalled, false);
  assert.equal(oracle.factsOraclePin.sha256, sha(jcs(facts) + "\n"));
  assert.deepEqual(facts.cases.map(c => c.name), ['full-fresh-aliases', 'empty-checked-read', 'length-equal-checked-read', 'far-oob-checked-read']);
  assert.deepEqual(oracle.cases.map(c => c.name), facts.cases.map(c => c.name));
  for (const p of oracle.typePreimages) assert.equal("sha256:" + sha(Buffer.from(p.preimageUtf8Hex, "hex")), p.id);
  let sourceRanges = 0, hirRanges = 0, functions = 0, sites = 0;
  const prepared = [];
  for (let i = 0; i < facts.cases.length; i++) {
    const c = facts.cases[i], h = oracle.cases[i], p = c.package;
    assert.equal(jcs(c.request) + "\n", c.requestText); assert.equal(jcs(p) + "\n", c.packageText);
    assert.equal(Buffer.byteLength(c.requestText), c.requestBytes); assert.equal(sha(c.requestText), c.requestSHA256);
    assert.equal(Buffer.byteLength(c.packageText), c.packageBytes); assert.equal(sha(c.packageText), c.packageSHA256);
    assert.equal(p.requestId, "sha256:" + sha("tsfg.array-facts.request.v1\0" + c.requestText));
    assert.equal(p.packageId, "sha256:" + sha("tsfg.array-facts.package.v1\0" + p.schemaHash + "\0" + jcs(p.payload)));
    assert.equal(p.packageId, c.expectedPackageId);
    assert.deepEqual(c.request.input.files.map(f => ({...f, byteLength: Buffer.byteLength(f.content), utf16Length: f.content.length})), p.payload.files);
    for (const file of p.payload.files) assert.equal(sha(file.content), file.sha256);
    for (const witness of c.rangeAudit) {
      const file = p.payload.files.find(f => f.path === witness.sourcePath); assert.ok(file);
      range(file.content, witness.range, witness.text); sourceRanges++;
    }
    for (const pre of c.identityPreimages)
      assert.equal("sha256:" + sha(pre.domain + "\0" + pre.valueJcsNoLf), pre.id);
    assert.equal(jcs(h.expectedHir) + "\n", h.hirText);
    assert.equal(Buffer.byteLength(h.hirText), h.hirBytes); assert.equal(sha(h.hirText), h.hirSHA256);
    for (const pre of h.functionPreimages) {
      assert.equal("sha256:" + sha(Buffer.from(pre.signaturePreimageUtf8Hex, "hex")), pre.signatureHash);
      assert.equal("sha256:" + sha(Buffer.from(pre.functionPreimageUtf8Hex, "hex")), pre.functionId);
    }
    for (const witness of h.rangeWitnesses) {
      const file = p.payload.files.find(f => f.path === witness.sourcePath); assert.ok(file);
      assert.deepEqual(at(h.expectedHir, witness.path), witness.range); range(file.content, witness.range, witness.text); hirRanges++;
    }
    functions += p.payload.functions.length;
    sites += c.semantic.reduce((n, f) => n + f.allocationSites.length, 0);
    prepared.push({c, h});
  }
  assert.deepEqual({sourceRanges, hirRanges, functions, sites}, {sourceRanges: 115, hirRanges: 135, functions: 5, sites: 6});
  const full = facts.cases[0], body = full.package.payload.functions[0].body;
  assert.deepEqual(body[0].initializer.elements.map(e => e.bits), body[1].initializer.elements.map(e => e.bits));
  assert.notEqual(body[0].initializer.allocationSite, body[1].initializer.allocationSite);
  assert.equal(body[0].initializer.elements[0].bits, "8000000000000000");
  assert.equal(body[0].initializer.elements[1].bits, "3fb999999999999a");
  assert.equal(body[0].initializer.elements[2].bits, "3ff0000000000000");
  assert.equal(body[0].initializer.elements[3].bits, "3ff0000000000002");
  t.diagnostic("25b ALL_FROZEN_CONTROLS_COMPLETE: 4 packages/5 functions/6 sites/115 Source ranges/135 HIR ranges; cold oracle is not official Source credit.");
  for (const {c, h} of prepared) {
    const ctx = {...h.context, factsBytes: Buffer.from(c.packageText)};
    t.diagnostic("25b EXISTING_PUBLIC_BUILD_REACHED " + c.name);
    const built = buildHir(fresh(c.package), ctx);
    assert.equal(built.status, "ok", c.name + " complete Array HIR: BASE refusal is API gap");
    assert.deepEqual(built.hir, h.expectedHir);
    assert.equal(printHir(built.hir, ctx), h.hirText);
    assert.deepEqual(verifyHir(fresh(h.expectedHir), ctx), h.expectedHir);
    assert.deepEqual(readHir(Buffer.from(h.hirText), ctx), h.expectedHir);
  }
});
