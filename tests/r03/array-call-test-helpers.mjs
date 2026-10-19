// SPDX-License-Identifier: MIT
// Test-owned recipes only: hostile inputs are re-signed, never promoted to successful oracles.
import assert from 'node:assert/strict';
import { callOracle } from './array-test-fixtures.mjs';
import { createHash } from 'node:crypto';

/** @param {any} value @returns {string} */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
/** @param {string | Uint8Array} bytes */
export const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
/** @param {any} value @returns {any} */
export const fresh = value => JSON.parse(canonical(value));
/** @param {any} value */
export const wire = value => Buffer.from(canonical(value) + '\n');
export const arrayType = 'sha256:74dab77c8fbdacf6cf058e37cac033757417c808d57ee23a9c8866565202cb68';
export const bogusHash = 'sha256:' + '0'.repeat(64);

const allRows = callOracle().then(value => value.cases);
/** @param {string} name @returns {Promise<any>} */
export async function fixture(name) {
  const row = (await allRows).find(item => item.name === name);
  assert.ok(row, 'missing independently frozen fixture: ' + name);
  for (const key of ['requestText', 'packageText']) {
    assert.equal(typeof row[key], 'string', key);
    assert.equal(canonical(JSON.parse(row[key])) + '\n', row[key], key + ' is whole canonical wire');
  }
  return row;
}
/** @param {any} row @param {any} [packet] */
export function factsContext(row, packet = undefined) {
  const bytes = packet === undefined ? Buffer.from(row.packageText) : wire(packet);
  return { family: 'tsfg.array-facts-context-candidate', version: 1, factsBytes: bytes,
    expectedPackageId: JSON.parse(bytes.toString()).packageId };
}
/** @param {any} row @returns {any} */
export const packet = row => JSON.parse(row.packageText);
/** @param {any} value @param {string} name @returns {any} */
export function named(value, name) {
  const fn = value.functions.find(item => item.name === name);
  assert.ok(fn, 'missing complete function ' + name); return fn;
}
/** @param {any} hir @param {any} analysis @param {string} name @returns {any} */
export function summary(hir, analysis, name) {
  const id = named(hir, name).id, row = analysis.functions.find(item => item.functionId === id);
  assert.ok(row, 'missing complete analysis for ' + name); return row;
}
/** @param {any} fn @returns {any} */
export function directCall(fn) {
  const stmt = fn.body.find(item => item.expression?.kind === 'arrayDirectCall' || item.value?.kind === 'arrayDirectCall');
  assert.ok(stmt, 'a represented direct call is required');
  return stmt.expression ?? stmt.value;
}
/** @param {any} fn @returns {any} */
export function sourceCall(fn) {
  const stmt = fn.body.find(item => item.kind === 'call' || item.value?.kind === 'directCall');
  assert.ok(stmt, 'a represented original call is required'); return stmt.value;
}
/** @param {() => unknown} action @returns {any} */
export function caught(action) {
  let error; try { action(); } catch (value) { error = value; }
  assert.ok(error instanceof TypeError, 'public boundary must reject with its TypeError DTO');
  return error;
}
/** @param {any} error @param {string} code @param {string} rule @param {string} phase */
export function machine(error, code, rule, phase) {
  assert.equal(error.name, 'TypeError'); assert.equal(error.code, code);
  assert.equal(error.ruleId, rule); assert.equal(error.phase, phase);
  assert.ok(error.message.startsWith(code + ':'), 'diagnostic message retains machine identity');
  assert.equal(error.upstreamCode, undefined, 'private rejection must not fabricate a TypeScript diagnostic');
}
/** @param {any} error @param {string} kind */
export function factsError(error, kind) {
  machine(error, 'r03-array-facts-' + kind, 'r01-input-boundary', 'input');
  assert.equal(error.primary, undefined, 'untrusted facts do not supply trusted diagnostic anchors');
}
/** @param {any} error @param {string} [kind] */
export function analysisError(error, kind = '') {
  machine(error, 'r03-d-array-call-effects' + (kind ? '-' + kind : ''), 'r01-call-contract', 'analysis');
}
/** @param {any} error @param {string} kind */
export const hirError = (error, kind) => machine(error, 'r03-array-hir-' + kind, 'r01-input-boundary', 'hir');
/** @param {any} row @param {any} primary */
export function trustedPrimary(row, primary) {
  assert.ok(primary, 'a located rejection requires an original trusted anchor');
  assert.deepEqual(Object.keys(primary).sort(), ['end', 'sourceId', 'start']);
  const anchors = [];
  /** @param {any} value @param {string} sourceId */
  function walk(value, sourceId) {
    if (!value || typeof value !== 'object') return;
    sourceId = value.sourcePath ?? sourceId;
    if (Object.keys(value).length === 2 && Number.isInteger(value.start) && Number.isInteger(value.end)) {
      anchors.push({ sourceId, ...value }); return;
    }
    Object.values(value).forEach(child => walk(child, sourceId));
  }
  walk(row.hir, row.hir.rootFile);
  assert.ok(anchors.some(anchor => canonical(anchor) === canonical(primary)), 'anchor belongs to the independent complete HIR');
}
/** @param {any} value */
export function deeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value)); Object.values(value).forEach(deeplyFrozen);
}
/** @param {any} value @returns {any} */
export function reframe(value) {
  const p = value.payload;
  const request = { family: 'tsfg.array-facts-request-candidate', version: 7, input: {
    sourceRoot: p.sourceRoot, rootFile: p.rootFile,
    files: p.files.map(({ path, content, sha256 }) => ({ path, content, sha256 })),
    declarations: p.declarations, config: p.config,
  } };
  value.requestId = hash('tsfg.array-facts.request.v7\0' + canonical(request) + '\n');
  value.packageId = hash('tsfg.array-facts.package.v7\0' + value.schemaHash + '\0' + canonical(p));
  return value;
}
/** @param {any} context @returns {any} */
export function resign(context) {
  for (const row of context.contracts) {
    const { digest, ...body } = row;
    row.digest = hash('tsfg.array-published-contract.v3\0' + canonical(body));
  }
  context.expectedDigest = hash('tsfg.array-publication.v3\0' + canonical({
    scopeDigest: context.scopeDigest, contracts: context.contracts,
  }));
  return context;
}
// This edit is for hostile Source packets, not an alternative successful Source producer.
/** @param {any} value @param {number} start @param {number} end @param {string} replacement */
export function replaceSource(value, start, end, replacement) {
  const p = value.payload, file = p.files.find(item => item.path === p.rootFile);
  assert.ok(file); const delta = replacement.length - (end - start);
  file.content = file.content.slice(0, start) + replacement + file.content.slice(end);
  file.sha256 = hash(file.content).slice(7);
  file.byteLength = Buffer.byteLength(file.content); file.utf16Length = file.content.length;
  /** @param {any} item */
  function shift(item) {
    if (!item || typeof item !== 'object') return;
    if (Object.keys(item).length === 2 && Number.isInteger(item.start) && Number.isInteger(item.end)) {
      if (item.start >= end) { item.start += delta; item.end += delta; }
      else if (item.end >= end) item.end += delta;
      return;
    }
    Object.values(item).forEach(shift);
  }
  p.functions.forEach(shift);
  const ids = new Map();
  for (const fn of p.functions) for (const binding of [fn, ...fn.parameters, ...fn.bindings]) {
    const previous = binding.id;
    binding.id = hash('tsfg.array-facts.binding.v1\0' + canonical({ sourcePath: fn.sourcePath, nameRange: binding.nameRange }));
    ids.set(previous, binding.id);
  }
  /** @param {any} item */
  function rebind(item) {
    if (!item || typeof item !== 'object') return;
    for (const key of ['binding', 'callee']) if (ids.has(item[key])) item[key] = ids.get(item[key]);
    if (item.kind === 'arrayLiteral') item.allocationSite = hash('tsfg.array-facts.allocation-site.v1\0'
      + canonical({ sourcePath: p.rootFile, range: item.range }));
    Object.values(item).forEach(rebind);
  }
  p.functions.forEach(fn => rebind(fn.body));
  p.exports.forEach(item => { item.functionId = ids.get(item.functionId); });
  return reframe(value);
}
