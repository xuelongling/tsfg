// SPDX-License-Identifier: MIT
// Malformed priority probes below are not claimed as legal maximum programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildNullableHir, verifyNullableHir } from '../../compiler/nullable-hir.mjs';
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const fresh = value => JSON.parse(jcs(value));
const raw = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
assert.equal(createHash('sha256').update(raw).digest('hex'), '4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
const { cases } = JSON.parse(raw.toString('utf8')), row = cases[2];
const MAX_STRING = 1048576, MAX_BYTES = 8388608;
const snapshot = () => fresh(row.expectedSnapshot), hir = () => fresh(row.expectedHir), context = () => fresh(row.context);
/** @typedef {TypeError & {code:string,ruleId:string,phase:string}} BoundaryError */
/** @param {unknown} caught */
function typedError(caught) { assert.ok(caught instanceof TypeError); return /** @type {BoundaryError} */ (caught); }
function rejects(action, category) {
  assert.throws(action, caught => {
    const error = typedError(caught); assert.equal(error.code,'r03-nullable-' + category);
    assert.equal(error.message,error.code + ': invalid private nullable presence HIR');
    assert.equal(error.ruleId,'r01-input-boundary'); assert.equal(error.phase,'hir');
    assert.ok(!Object.hasOwn(error,'primary')); return true;
  });
}

test('nullable presence HIR fixed function parameter and guard counts precede invalid identity', () => {
  /** @type {[string,number,(value:any,n:number)=>void][]} */
  const vectors = [
    ['functions',512,(value,n) => { value.functions = Array.from({ length:n },() => ({ parameters:[],body:[] })); }],
    ['parameters',64,(value,n) => { value.functions = [{ parameters:Array.from({ length:n },() => ({})),body:[] }]; }],
    ['guards',2,(value,n) => { value.functions = [{ parameters:[],body:Array.from({ length:n },() => ({ kind:'if',thenBody:[],elseBody:[] })) }]; }],
    ['statements',4096,(value,n) => { value.functions = [{ parameters:[],body:Array.from({ length:n },() => ({ kind:'return' })) }]; }],
  ];
  for (const [label,maximum,fill] of vectors) for (const extra of [0,1]) {
    // Full generic-safe graph, deliberately wrong exact format and declaration
    // identities. At the domain cap shape wins; +1 must fail limit before it.
    const source = snapshot(); source.format.schemaHash = 'sha256:' + '0'.repeat(64); fill(source,maximum + extra);
    assert.ok(Buffer.byteLength(jcs(source)) < MAX_BYTES,label);
    rejects(() => buildNullableHir(source,context()),extra ? 'limit' : 'schema');
    const value = hir(); value.format.schemaHash = 'sha256:' + '0'.repeat(64); fill(value,maximum + extra);
    assert.ok(Buffer.byteLength(jcs(value)) < MAX_BYTES,label);
    rejects(() => verifyNullableHir(value,context()),extra ? 'limit' : 'schema');
    const nested = hir(); nested.format.schemaHash = 'sha256:' + '0'.repeat(64); fill(nested.snapshot,maximum + extra);
    rejects(() => verifyNullableHir(nested,context()),extra ? 'limit' : 'schema');
  }
});

test('nullable presence HIR fixed nested symbol and HIR type tables precede exact format', () => {
  for (const extra of [0,1]) {
    const source = snapshot(); source.format.schemaHash = 'sha256:' + '0'.repeat(64);
    source.symbols = Array.from({ length:4096 + extra },() => ({}));
    rejects(() => buildNullableHir(source,context()),extra ? 'limit' : 'schema');
    const nested = hir(); nested.format.schemaHash = 'sha256:' + '0'.repeat(64); nested.snapshot = source;
    rejects(() => verifyNullableHir(nested,context()),extra ? 'limit' : 'schema');
    const value = hir(); value.format.schemaHash = 'sha256:' + '0'.repeat(64);
    value.types = Array.from({ length:5 + extra },() => ({}));
    rejects(() => verifyNullableHir(value,context()),extra ? 'limit' : 'schema');
  }
});

test('nullable presence HIR generic depth128 and tokens200000 are exact graph boundaries', () => {
  for (const extra of [0,1]) {
    /** @type {unknown} */
    let nested = null;
    for (let i = 0; i < 128 + extra; i++) nested = [nested];
    // Each array contributes one container depth. The null leaf has no object
    // depth; this is a shape-negative probe, not a supported HIR production.
    assert.equal(Buffer.byteLength(jcs(nested)),2 * (128 + extra) + 4);
    rejects(() => buildNullableHir(nested,context()),extra ? 'limit' : 'schema');
    rejects(() => verifyNullableHir(nested,context()),extra ? 'limit' : 'schema');
    const tokens = Array(199998 + extra).fill(null);
    // Opening + closing =2 tokens, each null is1. Bytes=5*n+1 <8MiB;
    // depth=1, no strings and no domain-shaped paths can mask this boundary.
    assert.equal(2 + tokens.length,200000 + extra);
    assert.equal(Buffer.byteLength(jcs(tokens)),5 * tokens.length + 1);
    rejects(() => buildNullableHir(tokens,context()),extra ? 'limit' : 'schema');
    rejects(() => verifyNullableHir(tokens,context()),extra ? 'limit' : 'schema');
  }
});

test('nullable presence HIR complete embedded capture strings retain independent 1MiB limit', () => {
  for (const extra of [0,1]) {
    const source = snapshot(), original = source.capture.response;
    source.capture.response = original + ' '.repeat(MAX_STRING + extra - Buffer.byteLength(original));
    assert.equal(Buffer.byteLength(source.capture.response),MAX_STRING + extra);
    assert.ok(Buffer.byteLength(jcs(source)) < MAX_BYTES);
    // At the decoded string cap the retained JSON is valid but noncanonical;
    // +1 must be rejected by the whole graph before parse/hash/identity work.
    rejects(() => buildNullableHir(source,context()),extra ? 'limit' : 'canonical');
    const value = hir(); value.snapshot = source;
    rejects(() => verifyNullableHir(value,context()),extra ? 'limit' : 'canonical');
    const ctx = context(); ctx.extra = 'x'.repeat(MAX_STRING + extra);
    rejects(() => buildNullableHir(snapshot(),ctx),extra ? 'limit' : 'schema');
    rejects(() => verifyNullableHir(hir(),ctx),extra ? 'limit' : 'schema');
  }
});

function wholeWithBytes(size, projection = true) {
  const value = projection ? hir() : snapshot();
  // Each half-MiB decoded quote string occupies1MiB of escaped JCS payload.
  // The complete nested capture/source/projection remains in the arithmetic.
  value.extra = Array(7).fill('"'.repeat(MAX_STRING / 2));
  const remainder = size - Buffer.byteLength(jcs(value)) - 3;
  assert.ok(remainder >= 0 && remainder <= MAX_STRING);
  value.extra.push('x'.repeat(remainder));
  assert.equal(Buffer.byteLength(jcs(value)),size);
  for (const string of value.extra) assert.ok(Buffer.byteLength(string) <= MAX_STRING);
  return value;
}
test('nullable presence HIR whole escaped JCS8MiB budget includes nested snapshot and projection', () => {
  // Extra root keys intentionally fail schema exactly at8MiB. With each
  // component under1MiB, shallow depth and few tokens, +1 isolates whole bytes.
  for (const extra of [0,1]) {
    rejects(() => buildNullableHir(wholeWithBytes(MAX_BYTES + extra,false),context()),extra ? 'limit' : 'schema');
    rejects(() => verifyNullableHir(wholeWithBytes(MAX_BYTES + extra),context()),extra ? 'limit' : 'schema');
  }
});

// A valid S5 need not fit inside a whole HIR frame; neither the wrapper nor
// repeated aliases receive a larger budget. The1025-total-guard threshold
// cannot be independently exceeded under<=512functions and<=2guards/function.
// This suite claims no separate threshold coverage for that dependent domain,
// source-token counts or expression-step maxima. No Source request is emitted.
