// SPDX-License-Identifier: MIT
// Independent trusted test data only: no compiler encoder/projector creates expected HIR.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const selectedJob = 'sha256:df91096cd1604f9c9af35e04df1ff3c11d77faeb3d9890cbf9bdc57ab4d83c6e';
export const factsSchema = 'sha256:79d8f807552e301b606aacdee7b81fcee83d8996ff2043e58c435e5f2b7b519c';
export const hirSchema = 'sha256:981b3bf0a5d54094596ddd609ed61da5577d640728cee912964f7032be373d49';
export const stringType = 'sha256:7d62b2f4422bdcf8ffbd8d54487d799753faecc3655296bfd81d3e94b606a46e';
export const signature = 'sha256:854eb80faa738dba624abb80156ef142ab727222ac63c01620c51768ad44e5c4';
export const sourcePath = '/oracle24e/corpus.ts';
/** Trusted JSON values only; never pass behavioral or cyclic data here. @param {any} value @returns {string} */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
/** @param {any} value */
export const wire = value => Buffer.from(canonical(value) + '\n');
/** @param {any} value */
export const copy = value => JSON.parse(JSON.stringify(value));
/** @param {string | Uint8Array} value */
export const sha256 = value => createHash('sha256').update(value).digest('hex');
/** @param {any} value */
export function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) deeplyFrozen(child);
}
/** Each caller receives new bytes and JSON; contexts never select their own incoming identity. */
export async function fixture() {
  const [factsBytes, hirBytes, manualBytes] = await Promise.all([
    readFile(new URL('./string-facts-concat.frozen-v2.jcs.json', import.meta.url)),
    readFile(new URL('./string-hir-concat.frozen-v2.jcs.json', import.meta.url)),
    readFile(new URL('./string-concat-hir-manual.frozen-v2.json', import.meta.url)),
  ]);
  /** @type {Array<[Buffer, number, string]>} */
  const pins = [
    [factsBytes, 4855, '801792594c3f3b81d7d0a726bf99ea33772425f65abe3552236068d848c4498a'],
    [hirBytes, 6692, '8e2266b30452c4d665fea23eaa82ae27ca656f363be711c2fdeb89ffce29d2ae'],
    [manualBytes, 5844, '1f482ea65d89630dac8234fbe016216d3854cf3ed4e9beada2fbbfc5150a1b1c'],
  ];
  for (const [bytes, size, hash] of pins) {
    assert.equal(bytes.length, size); assert.equal(sha256(bytes), hash);
  }
  const facts = JSON.parse(factsBytes.toString()), hir = JSON.parse(hirBytes.toString());
  const manual = JSON.parse(manualBytes.toString());
  assert.deepEqual(wire(facts), factsBytes); assert.deepEqual(wire(hir), hirBytes);
  assert.equal(facts.packageId, selectedJob); assert.equal(hir.inputIdentity, selectedJob);
  return { factsBytes, hirBytes, facts, hir, manual };
}
/** @param {Uint8Array} bytes */
export const context = bytes => ({ factsVersion: 2, factsBytes: Buffer.from(bytes), expectedPackageId: selectedJob });
/** Trusted synthetic cold data only; this grants no official Source meaning. @param {any} packet */
export function sealFacts(packet) {
  const p = packet.payload;
  const request = { family: 'tsfg.string-facts-request-candidate', version: 2,
    input: { sourceRoot: p.sourceRoot, rootFile: p.rootFile, config: p.config, declarations: p.declarations,
      files: p.files.map(file => ({ path: file.path, content: file.content, sha256: file.sha256 })) } };
  packet.requestId = 'sha256:' + sha256('tsfg.string-facts.request.v2\0' + canonical(request) + '\n');
  packet.packageId = 'sha256:' + sha256('tsfg.string-facts.package.v2\0' + packet.schemaHash + '\0' + canonical(p));
  return packet;
}
/** @param {any} packet @param {string} text */
export function setSource(packet, text) {
  const source = packet.payload.files.find(file => file.path === packet.payload.rootFile);
  Object.assign(source, { content: text, sha256: sha256(text), byteLength: Buffer.byteLength(text), utf16Length: text.length });
}
/** @param {any} value */
export const leaves = value => value.functions.flatMap(fn => [fn.body[0].value.left, fn.body[0].value.right]);
/** @param {any} fn */
export const factsLeaves = fn => [fn.body[0].value.left, fn.body[0].value.right];
/** @param {() => unknown} action @param {string} category @param {boolean} [cause] */
export function coldReject(action, category, cause = false) {
  assert.throws(action, (/** @type {any} */ error) => {
    assert.equal(error.code, 'r03-string-facts-' + category);
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'input');
    if (cause) assert.ok(error.cause instanceof Error);
    return true;
  });
}
/** @param {() => unknown} action @param {string} category @param {any} [primary] @param {boolean} [cause] */
export function hirReject(action, category, primary = undefined, cause = false) {
  assert.throws(action, (/** @type {any} */ error) => {
    assert.equal(error.code, 'r03-hir-' + category);
    assert.equal(error.ruleId, 'r01-input-boundary'); assert.equal(error.phase, 'hir');
    if (primary !== undefined) assert.deepEqual(error.primary, primary);
    if (cause) assert.ok(error.cause instanceof Error);
    return true;
  });
}
/** @param {any} result @param {string} category @param {any} [primary] */
export function buildReject(result, category, primary = undefined) {
  assert.equal(result.status, 'error'); assert.equal(Object.hasOwn(result, 'hir'), false);
  assert.ok(result.diagnostics.length > 0);
  const d = result.diagnostics[0];
  assert.equal(d.code, 'r03-hir-' + category);
  assert.equal(d.ruleId, 'r01-input-boundary'); assert.equal(d.phase, 'hir');
  if (primary !== undefined) assert.deepEqual(d.primary, primary);
}
/** @param {any} range */
export const primary = range => ({ sourceId: sourcePath, start: range.start, end: range.end });
/** Proxy traps must remain untouched by public untrusted-data boundaries. @param {object} target @param {string[]} calls */
export function trapped(target, calls) {
  return new Proxy(target, Object.fromEntries(['get', 'set', 'has', 'deleteProperty', 'ownKeys',
    'getOwnPropertyDescriptor', 'defineProperty', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible',
    'preventExtensions', 'apply', 'construct'].map(name => [name, () => {
    calls.push(name); throw Error('24f Proxy sentinel');
  }])));
}
