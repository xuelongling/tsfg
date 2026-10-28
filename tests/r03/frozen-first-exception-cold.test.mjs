// SPDX-License-Identifier: MIT
// Frozen independently in scratch. Copy unchanged to tests/r03/frozen-first-exception-cold.test.mjs.
// Root must supply actual new Go private frames and origin custody; missing fixtures fail.
// This test grants static transport/ownership credit only, never SourceEXE/HIR/Core/Runtime credit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const fixture = new URL('../fixtures/r03/m21-exception/first/', import.meta.url);
// Root descriptor release: exact JCS, SHA256 5221b5..., not read back from a response.
const schemaHash = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const sourcePath = '/src/main.ts', declarationPath = '/src/minimal-integers-v3.d.ts';
const sourceDigest = 'sha256:4c5cfdea7fa418d1b0eaeda99b01cb1e749266ecd8ecb9c0154df4cb7219c8c2';
const declarationDigest = 'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e';
const source = [
  "// 😀",
  "export function entry(value: i32): i32 {",
  "  try {",
  "    throw value;",
  "  } catch (caught) {",
  "    throw caught;",
  "  } finally {",
  "    const copied: i32 = value;",
  "  }",
  "}"
].join('\r\n');
const declarations = [
  "interface Object {}",
  "interface Function {}",
  "interface CallableFunction {}",
  "interface NewableFunction {}",
  "interface IArguments {}",
  "interface String {}",
  "interface Number {}",
  "interface Boolean {}",
  "interface RegExp {}",
  "interface Array<T> {}",
  "type bool = boolean;",
  "declare const __tsfg_i32: unique symbol;",
  "type i32 = number & { readonly [__tsfg_i32]: true };",
  "type f64 = number;",
  "declare const __tsfg_i8: unique symbol;",
  "type i8 = number & { readonly [__tsfg_i8]: true };",
  "declare const __tsfg_i16: unique symbol;",
  "type i16 = number & { readonly [__tsfg_i16]: true };",
  "declare const __tsfg_i64: unique symbol;",
  "type i64 = number & { readonly [__tsfg_i64]: true };",
  "declare const __tsfg_u8: unique symbol;",
  "type u8 = number & { readonly [__tsfg_u8]: true };",
  "declare const __tsfg_u16: unique symbol;",
  "type u16 = number & { readonly [__tsfg_u16]: true };",
  "declare const __tsfg_u32: unique symbol;",
  "type u32 = number & { readonly [__tsfg_u32]: true };",
  "declare const __tsfg_u64: unique symbol;",
  "type u64 = number & { readonly [__tsfg_u64]: true };",
  "declare const __tsfg_isize: unique symbol;",
  "type isize = number & { readonly [__tsfg_isize]: true };",
  "declare const __tsfg_usize: unique symbol;",
  "type usize = number & { readonly [__tsfg_usize]: true };",
  ""
].join('\n');
const target = {
  target: 'windows-x86_64-msvc', triple: 'x86_64-pc-windows-msvc', pointerBits: '64',
  llvmDataLayout: 'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128',
};
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const range = (start, end) => ({ start, end });

// Independent JCS preimages for these JSON fixtures: UTF16 key order, original strings,
// finite ECMAScript numbers, no normalization; never producer/reader canonical helpers.
/** @param {any} value @returns {string} */
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assert.ok(value.isWellFormed(), 'lone surrogate in independent preimage');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) && !Object.is(value, -0), 'invalid JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'plain JSON object required');
  return '{' + Object.keys(value).sort().map(key => {
    assert.ok(key.isWellFormed() && !['__proto__', 'constructor', 'prototype'].includes(key));
    return JSON.stringify(key) + ':' + canonical(value[key]);
  }).join(',') + '}';
}
function exactKeys(value, names) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
function json(bytes, exact = true) {
  assert.ok(bytes.byteLength <= 8388608, 'first fixture exceeds wire budget');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.ok(!text.startsWith('\uFEFF'), 'fixture BOM');
  const value = JSON.parse(text);
  if (exact) assert.deepEqual(Buffer.from(canonical(value)), Buffer.from(bytes), 'exact canonical private frame');
  else canonical(value);
  return { value, text };
}
function frozenJSON(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return;
  assert.ok(!seen.has(value), 'owned JSON cannot contain cycles');
  seen.add(value);
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, 'no Buffer/Map/AST in output');
  assert.ok(Object.isFrozen(value), 'every owned record and array must be frozen');
  for (const child of Object.values(value)) frozenJSON(child, seen);
  seen.delete(value); // Internal aliases are valid when every reachable value is owned and frozen.
}

// Literal independent 21b first oracle; Root must freshly recheck it in the 21c Source tracer before installing frames.
// Raw ranges intentionally include leading trivia; no package field manufactures these facts.
function expectedFacts() {
  const definition = { id: 's1', name: 'entry', kind: 'function', type: 'i32', writable: false, range: range(22, 28) };
  const parameter = { id: 's2', name: 'value', kind: 'parameter', type: 'i32', writable: true, range: range(29, 34),
    presence: { undefined: false, null: false, optional: false, default: false, range: range(29, 39), annotation: range(36, 39) } };
  const caught = { id: 's3', name: 'caught', kind: 'local', type: 'unknown', writable: true, range: range(87, 93) };
  const copied = { id: 's4', name: 'copied', kind: 'local', type: 'i32', writable: false, range: range(141, 148) };
  return { status: 'ok', inputs: [sourcePath, declarationPath], symbols: [definition, parameter, caught, copied], functions: [{
    name: 'entry', symbol: 's1', parameters: [copy(parameter)], returnType: 'i32', parameterInitializers: [null], range: range(0, 170), body: [{
      kind: 'try', range: range(47, 167), exception: {
        tryBlock: { range: range(54, 79), body: [{ kind: 'throw', range: range(56, 74),
          expression: { kind: 'reference', type: 'i32', symbol: 's2', range: range(67, 73) } }] },
        catchClause: { binding: copy(caught), declarationRange: range(87, 93), range: range(79, 120),
          block: { range: range(94, 120), body: [{ kind: 'throw', range: range(96, 115),
            expression: { kind: 'reference', type: 'unknown', symbol: 's3', range: range(107, 114) } }] } },
        finallyBlock: { range: range(128, 167), body: [{ kind: 'variable', symbol: copy(copied), range: range(141, 161),
          initializer: { kind: 'reference', type: 'i32', symbol: 's2', range: range(155, 161) } }] },
      },
    }],
  }] };
}
function snapshotIdentity(inputIdentity, sourceOrigin) {
  return hash('tsfg.frontend-exception-candidate.snapshot.v1\0' + schemaHash + '\0' + canonical({ inputIdentity, sourceOrigin }));
}

test('actual private first exception frame has complete owned snapshot and cold reconstruction', async t => {
  // Missing actual frames fail here. Never synthesize a positive frame or skip this test.
  const bytes = await Promise.all(['request.json', 'response.json', 'origin.json', 'source.ts']
    .map(name => readFile(new URL(name, fixture))));
  const pins = bytes.map(hash), [requestBytes, responseBytes, originBytes, sourceBytes] = bytes;
  assert.deepEqual(sourceBytes, Buffer.from(source), 'original CRLF/emoji bytes');
  assert.equal(Buffer.byteLength(source), 172); assert.equal(source.length, 170); assert.equal(hash(sourceBytes), sourceDigest);
  assert.equal(Buffer.byteLength(declarations), 1214); assert.equal(declarations.length, 1214); assert.equal(hash(declarations), declarationDigest);
  const request = json(requestBytes), response = json(responseBytes), origin = json(originBytes, false).value;
  const originBefore = canonical(origin);
  exactKeys(origin, ['kind', 'producerBaseOid', 'producerDirty', 'requestSha256', 'responseSha256', 'testedInputSetHash']);
  assert.equal(origin.kind, 'owned-go-exception-response'); assert.match(origin.producerBaseOid, /^[0-9a-f]{40}$/);
  assert.equal(typeof origin.producerDirty, 'boolean'); assert.match(origin.testedInputSetHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(origin.requestSha256, hash(requestBytes)); assert.equal(origin.responseSha256, hash(responseBytes));
  // The separately supplied Root origin is custody metadata. It is neither packet self-certification nor admission authority.
  const input = { sourceRoot: '/src', rootFile: sourcePath, files: [{ path: sourcePath, content: source },
    { path: declarationPath, content: declarations }], declarations: { version: 'minimal-integers-v3', paths: [declarationPath] },
    config: { strict: true, noEmit: true, allowJs: false }, target: copy(target) };
  assert.deepEqual(request.value, { family: 'tsfg.exception-facts-request-candidate', version: 1, schemaHash, input });
  // This input is independently literal, not normalized from an unverified package or reader result.
  const inputIdentity = hash(canonical(input)), facts = expectedFacts();
  const exports = [{ sourcePath, external: true, bindings: [{ name: 'entry', target: 's1', sourcePath,
    range: range(0, 170), definition: range(22, 28) }] }];
  const files = [{ path: sourcePath, digest: sourceDigest, byteLength: 172, length: 170, positionUnit: 'utf16' },
    { path: declarationPath, digest: declarationDigest, byteLength: 1214, length: 1214, positionUnit: 'utf16' }];
  const payload = { inputIdentity, files, facts, exports };
  exactKeys(response.value, ['family', 'version', 'schemaHash', 'requestId', 'packageId', 'payload']);
  assert.deepEqual([response.value.family, response.value.version, response.value.schemaHash],
    ['tsfg.exception-facts-package-candidate', 1, schemaHash]);
  assert.equal(response.value.requestId, hash('tsfg.exception-facts.request.v1\0' + request.text));
  assert.equal(response.value.packageId, hash('tsfg.exception-facts.package.v1\0' + schemaHash + '\0' + canonical(payload)));
  assert.deepEqual(response.value.payload, payload, 'complete independent facts, files and fresh official export expectation');
  const expected = { format: { family: 'tsfg.frontend-exception-candidate', version: 1, schemaHash },
    snapshotId: snapshotIdentity(inputIdentity, origin), sourceOrigin: copy(origin), inputIdentity, identityInput: copy(input),
    sources: [{ path: sourcePath, content: source, hash: sourceDigest, length: 170, positionUnit: 'utf16' }],
    target: copy(target), facts: copy(facts), exports: copy(exports), capture: { request: request.text, response: response.text } };
  const passedRequest = Uint8Array.from(requestBytes), passedResponse = Uint8Array.from(responseBytes);
  const imported = await importCapturedFrontendResponse(passedRequest, passedResponse, origin);
  // Baseline reaches this existing dispatcher: r03-closure-identity is API RED, never grammar RED.
  assert.equal(imported.status, 'ok', 'existing public import refused actual new frame: ' + canonical(imported));
  const snapshot = imported.snapshot;
  assert.equal(canonical(snapshot), canonical(expected), 'every canonical snapshot field and optional presence');
  frozenJSON(imported);
  assert.notStrictEqual(snapshot.sourceOrigin, origin);
  assert.deepEqual(Buffer.from(passedRequest), requestBytes); assert.deepEqual(Buffer.from(passedResponse), responseBytes);
  assert.equal(canonical(origin), originBefore); assert.deepEqual(bytes.map(hash), pins);
  assert.doesNotThrow(() => validateFrontendSnapshot(snapshot));
  const coldText = canonical(snapshot), cold = JSON.parse(coldText);
  assert.notStrictEqual(cold, snapshot); assert.notStrictEqual(cold.facts, snapshot.facts);
  assert.equal(canonical(cold), canonical(expected));
  assert.doesNotThrow(() => validateFrontendSnapshot(cold), 'fresh JSON object must reconstruct from retained capture');
  assert.equal(canonical(cold), coldText, 'cold validation must not mutate caller JSON');
  assert.equal(canonical(snapshot), canonical(expected));

  // Mutate only caller-owned memory, after proving import preserved it. Retained capture must own its bytes/origin.
  passedRequest.fill(0); passedResponse.fill(0); origin.producerDirty = !origin.producerDirty;
  assert.equal(canonical(snapshot), canonical(expected)); assert.deepEqual(bytes.map(hash), pins);
  assert.doesNotThrow(() => validateFrontendSnapshot(snapshot));
  assert.doesNotThrow(() => validateFrontendSnapshot(JSON.parse(coldText)));

  // Cold derived-field mutations, not repaired-wire semantic REDs or broader grammar coverage.
  /** @type {[string, (value: any) => void][]} */
  const changes = [
    ['format', value => { value.format.version = 2; }],
    ['snapshotId', value => { value.snapshotId = hash('forged snapshot'); }],
    ['sourceOrigin', value => { value.sourceOrigin.requestSha256 = hash('foreign request'); }],
    ['inputIdentity', value => { value.inputIdentity = hash('foreign input'); value.snapshotId = snapshotIdentity(value.inputIdentity, value.sourceOrigin); }],
    ['identityInput', value => { value.identityInput.files[0].content += ' '; }],
    ['sources', value => { value.sources[0].hash = hash('foreign source'); }],
    ['target', value => { value.target.pointerBits = '32'; }],
    ['facts', value => { value.facts.functions[0].body[0].exception.catchClause.block.body[0].expression.type = 'i32'; }],
    ['exports', value => { value.exports[0].bindings = []; }],
    ['capture', value => { value.capture.response += '\n'; }],
  ];
  for (const [name, change] of changes) {
    const forged = JSON.parse(coldText); change(forged);
    assert.throws(() => validateFrontendSnapshot(forged), error => error instanceof Error && error.message.length > 0,
      'cold validator must reject changed ' + name);
  }
  assert.equal(canonical(snapshot), canonical(expected)); assert.deepEqual(bytes.map(hash), pins);
  t.diagnostic('first172B only: complete snapshot/cold/ownership; later30 corpus, guards, aliases, modules and payload families remain separate');
});
