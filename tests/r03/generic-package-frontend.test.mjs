// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonical, sha256 } from '../../compiler/identity.mjs';
import { encodeGenericPackage } from '../../compiler/generic-package.mjs';
import { encodeGenericPackageRequest, genericPackageRequestId } from '../../compiler/generic-package-io.mjs';
import { readGenericHir, printGenericHir, genericHirFormat } from '../../compiler/generic-hir.mjs';
import * as pipeline from '../../compiler/pipeline.mjs';
import { runLockedFrontend } from '../../compiler/frontend-execution.mjs';

// Captured from the real Go Source handler. These bytes establish protocol/HIR
// correspondence, not execution or admission of a Source executable.
const fixtureBytes = await readFile(new URL('./fixtures/generic-package-io-source-v1.json', import.meta.url));
const cases = JSON.parse(fixtureBytes.toString('utf8')).cases;
const instantiate = cases.find(item => item.name === 'instantiate-ok');
const exported = cases.find(item => item.name === 'export-ok');
const bytes = value => new TextEncoder().encode(canonical(value));
const requestBytes = () => bytes(instantiate.request);
const responseBytes = () => bytes(instantiate.response);
const frontend = () => import('../../compiler/generic-package-frontend.mjs');
const rejected = error => error instanceof Error && /^(generic-package|generic-instance|generic-hir)-/.test(Reflect.get(error, 'code'));

// Each test loads the new module inside its public behavior. The BASE failure is
// the missing production capability, with no test executor or fabricated Source.
test('package frontend imports real Source export bytes and six-instance cold HIR', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  assert.equal(fixtureBytes.length, 16491);
  assert.equal(sha256(fixtureBytes), 'sha256:75a78b01dec795e3b24d3df61026a0b2d5328ca9e1a0e039b149432a887ac9d4');
  const pkg = readGenericPackageFrontendResponse(bytes(exported.request), bytes(exported.response));
  assert.equal(pkg.status, 'ok');
  assert.equal(pkg.requestId, exported.response.requestId);
  assert.deepEqual(pkg.packageBytes, encodeGenericPackage(instantiate.request.package));
  const result = readGenericPackageFrontendResponse(requestBytes(), responseBytes());
  assert.equal(result.status, 'ok');
  assert.equal(result.requestId, instantiate.response.requestId);
  assert.deepEqual(result.hir.format, genericHirFormat);
  assert.equal(result.hir.functions.length, 6);
  assert.equal(result.hir.closure.roots.length, 5);
  assert.equal(result.hir.closure.roots[0], result.hir.closure.roots[3]);
  assert.deepEqual(result.hir.source, instantiate.request.package.payload.source);
  assert.equal(Object.hasOwn(result.hir.source, 'content'), false);
  assert.equal(Object.hasOwn(result, 'snapshot'), false);
  assert.equal(Object.hasOwn(result, 'bytecode'), false);
  assert.deepEqual(readGenericHir(new TextEncoder().encode(printGenericHir(result.hir))), result.hir);
});

test('package frontend preserves real official, declaration and EOF diagnostics exactly', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  for (const item of cases.filter(item => item.response.status === 'error')) {
    const result = readGenericPackageFrontendResponse(bytes(item.request), bytes(item.response));
    assert.deepEqual(result, { status: 'error', requestId: item.response.requestId, diagnostic: item.response.diagnostic });
    assert.equal(Object.hasOwn(result.diagnostic.primary, 'startLine'), false);
    assert.ok(Object.isFrozen(result.diagnostic));
  }
});

test('package frontend keeps a source-free global diagnostic and raw machine identity', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  // A protocol edge case, not an additional claim of official checking.
  const response = { ...instantiate.response, status: 'error', diagnostic: { kind: 'budget', code: 0, detail: 'limit', primary: null } };
  delete response.value;
  const result = readGenericPackageFrontendResponse(requestBytes(), bytes(response));
  assert.deepEqual(result, { status: 'error', requestId: response.requestId, diagnostic: response.diagnostic });
});

test('package frontend rejects a foreign response before importing any facts', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  for (const mutate of [value => { value.requestId = 'sha256:' + '0'.repeat(64); },
    value => { value.operation = 'export'; }, value => { value.version = 2; },
    value => { value.family = 'tsfg.frontend-snapshot'; }]) {
    const response = structuredClone(instantiate.response); mutate(response);
    assert.throws(() => readGenericPackageFrontendResponse(requestBytes(), bytes(response)), rejected);
  }
  const changedRoots = structuredClone(instantiate.request); changedRoots.roots.reverse();
  assert.throws(() => readGenericPackageFrontendResponse(bytes(changedRoots), responseBytes()), rejected);
  const changedPackage = structuredClone(instantiate.request); changedPackage.package.packageId = 'sha256:' + '0'.repeat(64);
  const response = { ...instantiate.response, requestId: genericPackageRequestId(changedPackage) };
  assert.throws(() => readGenericPackageFrontendResponse(bytes(changedPackage), bytes(response)), rejected);
});

test('package frontend rejects changed concrete facts and foreign diagnostic provenance', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  const forged = structuredClone(instantiate.response); forged.value.instances[0].returnType = 'f64';
  assert.throws(() => readGenericPackageFrontendResponse(requestBytes(), bytes(forged)), rejected);
  for (const mutate of [value => { value.diagnostic.primary.source.path = '/foreign/main.ts'; },
    value => { value.diagnostic.primary.origin.end++; }]) {
    const item = cases.find(item => item.name === 'source-eof-error');
    const response = structuredClone(item.response); mutate(response);
    assert.throws(() => readGenericPackageFrontendResponse(bytes(item.request), bytes(response)), rejected);
  }
});

test('package frontend requires raw owned canonical bytes at both transport inputs', async () => {
  const { readGenericPackageFrontendResponse } = await frontend();
  for (const input of [instantiate.request, { snapshot: instantiate.request.package }, '{}', new Uint8Array([0xff])])
    assert.throws(() => readGenericPackageFrontendResponse(input, responseBytes()), rejected);
  for (const input of [instantiate.response, new Uint8Array([0xff]),
    new TextEncoder().encode(canonical(instantiate.response) + '\n'),
    new TextEncoder().encode('{"status":"ok","status":"ok"}'),
    new Uint8Array([0xef, 0xbb, 0xbf, ...responseBytes()])])
    assert.throws(() => readGenericPackageFrontendResponse(requestBytes(), input), rejected);
});

test('package frontend maintains the distinct inner and outer byte budgets', async () => {
  const { readGenericPackageFrontendResponse, analyzeGenericPackage } = await frontend();
  assert.throws(() => readGenericPackageFrontendResponse(requestBytes(), new Uint8Array(16 * 1024 * 1024 + 1)),
    error => error instanceof Error && Reflect.get(error, 'code') === 'generic-package-io-limit');
  await assert.rejects(analyzeGenericPackage(new Uint8Array(16 * 1024 * 1024 + 1)),
    error => error instanceof Error && Reflect.get(error, 'code') === 'generic-package-io-limit');
  await assert.rejects(pipeline.compilePackageHir(new Uint8Array(8 * 1024 * 1024 + 1), instantiate.request.roots),
    error => error instanceof Error && Reflect.get(error, 'code') === 'generic-package-limit');
});

test('package frontend owns pending raw request bytes before its first await', async () => {
  const { analyzeGenericPackage } = await frontend();
  const input = requestBytes(), expected = genericPackageRequestId(input);
  const pending = analyzeGenericPackage(input); input.fill(0);
  const result = await pending;
  assert.deepEqual(result, { status: 'tool-error', requestId: expected, message: 'frontend executable is required' });
});

test('compilePackageHir owns package and roots without inventing a Snapshot or Core result', async () => {
  assert.equal(typeof pipeline.compilePackageHir, 'function');
  const pkg = encodeGenericPackage(instantiate.request.package), roots = structuredClone(instantiate.request.roots);
  const expected = genericPackageRequestId(encodeGenericPackageRequest({ ...instantiate.request, roots }));
  const pending = pipeline.compilePackageHir(pkg, roots); pkg.fill(0); roots.length = 0;
  assert.deepEqual(await pending, { status: 'tool-error', requestId: expected, message: 'frontend executable is required' });
  await assert.rejects(pipeline.compilePackageHir({ source: { content: 'fake Snapshot' } }, instantiate.request.roots), rejected);
});

test('locked frontend accepts only named finite modes and keeps Snapshot default prerequisites', async () => {
  const missing = { status: 'tool-error', message: 'frontend executable is required' };
  assert.deepEqual(await runLockedFrontend('{}'), missing);
  assert.deepEqual(await runLockedFrontend(requestBytes(), { mode: 'generic-package-io-candidate-v1' }), missing);
  const invalid = await runLockedFrontend('{}', { mode: '--arbitrary-command' });
  assert.equal(invalid.status, 'tool-error');
  assert.equal(invalid.message, 'unsupported frontend execution mode');
});
