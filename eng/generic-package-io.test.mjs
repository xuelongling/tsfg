// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonical } from '../compiler/identity.mjs';
import { genericPackageIoFormat as format, encodeGenericPackageRequest as encodeRequest,
  decodeGenericPackageRequest as decodeRequest, genericPackageRequestId as requestId,
  encodeGenericPackageResponse as encodeResponse, decodeGenericPackageResponse as decodeResponse } from '../compiler/generic-package-io.mjs';
import { encodeGenericPackage } from '../compiler/generic-package.mjs';

const pkg = JSON.parse(await readFile(new URL('../tests/r03/fixtures/generic-package-source-v4.json', import.meta.url), 'utf8'));
const facts = JSON.parse(await readFile(new URL('../tests/r03/fixtures/generic-instance-source-v4.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value), utf8 = value => new TextEncoder().encode(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const id = request => 'sha256:' + hash(Buffer.concat([Buffer.from('tsfg:generic-package-io-request:v1\n'), Buffer.from(canonical(request))]));
/** @type {() => any} */
const instantiate = () => ({ ...format, operation: 'instantiate', package: clone(pkg), roots: clone(facts.requests) });
/** @type {(request: any) => any} */
const ok = request => ({ ...format, operation: request.operation, requestId: id(request), status: 'ok', value: clone(facts.result) });
/** @type {(request: any) => any} */
const error = request => ({ ...format, operation: request.operation, requestId: id(request), status: 'error',
  diagnostic: { kind: 'package-reference', code: 0, detail: 'owned input failure', primary: null } });
/** @returns {any} */
function exportRequest(content = 'export function identity<T>(value: T): T { return value; }') {
  return { ...format, operation: 'export', scope: 'io-unit', source: { path: '/original/name:copy.ts', content, digest: hash(content) },
    environment: clone(pkg.payload.environment) };
}
function metadata(file) {
  const surrogateStarts = []; let position = 0;
  for (const scalar of file.content) { if (scalar.length === 2) surrogateStarts.push(position); position += scalar.length; }
  return { path: file.path, digest: hash(file.content), length: file.content.length, positionUnit: 'utf16', surrogateStarts };
}
// Synthesized wrappers below are structural codec witnesses over existing owned
// facts; only the separate real-handler fixture test claims Go IO interoperability.
test('package IO canonical request roundtrip binds exact LF-domain identity and owns arrays', () => {
  const request = instantiate(), bytes = encodeRequest(request), framed = decodeRequest(bytes);
  assert.deepEqual(framed, request); assert.ok(Object.isFrozen(framed.roots[0].typeArguments));
  assert.equal(requestId(bytes), id(request)); assert.equal(requestId(request), id(request));
  assert.notEqual(requestId(request), 'sha256:' + hash('tsfg:generic-package-io-request:v1\\n' + canonical(request)));
  assert.equal(Buffer.from(bytes).toString('utf8'), canonical(request));
  request.roots[0].definition = '0'.repeat(64);
  assert.notEqual(framed.roots[0].definition, request.roots[0].definition);
});
test('package IO success validates exact owned package, roots, instance closure and request identity', () => {
  const request = instantiate(), response = ok(request), bytes = encodeResponse(response, request);
  assert.deepEqual(decodeResponse(bytes, encodeRequest(request)), response);
  for (const change of [value => { value.requestId = 'sha256:' + '0'.repeat(64); },
    value => { value.operation = 'export'; }, value => { value.version = 2; },
    value => { value.value.packageId = 'sha256:' + 'a'.repeat(64); },
    value => { value.value.instances.pop(); }]) {
    const broken = clone(response); change(broken);
    assert.throws(() => encodeResponse(broken, request), /generic-(package-io|instance)-/);
  }
});
test('package IO errors keep machine kind/code/detail with null global origin', () => {
  const request = instantiate(), response = error(request);
  response.diagnostic = { kind: 'official-type', code: 2345, detail: 'official compiler diagnostic', primary: null };
  const decoded = decodeResponse(encodeResponse(response, request), request);
  assert.deepEqual(decoded.diagnostic, response.diagnostic); assert.ok(Object.isFrozen(decoded.diagnostic));
  for (const code of [-1, -0, 2147483648, 0.5]) {
    const bad = clone(response); bad.diagnostic.code = code;
    assert.throws(() => encodeResponse(bad, request), /generic-package-io-schema/);
  }
});
test('package IO errors own both original definition source and exact retained declaration metadata', () => {
  const request = instantiate(), response = error(request);
  response.diagnostic.primary = { source: clone(pkg.payload.source), origin: clone(facts.result.instances[0].origin) };
  assert.deepEqual(decodeResponse(encodeResponse(response, request), request).diagnostic.primary, response.diagnostic.primary);
  const declaration = pkg.payload.environment.files[0];
  response.diagnostic.primary = { source: metadata(declaration), origin: { start: 0, end: 1 } };
  assert.deepEqual(decodeResponse(encodeResponse(response, request), request).diagnostic.primary, response.diagnostic.primary);
  for (const change of [primary => { primary.source.digest = 'f'.repeat(64); },
    primary => { primary.source.path = '/foreign/declaration.d.ts'; },
    primary => { primary.origin.end = primary.source.length + 1; },
    primary => { primary.startLine = 0; }]) {
    const broken = clone(response); change(broken.diagnostic.primary);
    assert.throws(() => encodeResponse(broken, request), /generic-package-io-(origin|schema)/);
  }
});
test('package IO diagnostics allow exact source and declaration EOF anchors but never split surrogate pairs', () => {
  const request = exportRequest('😀\nexport function identity<T>(value: T): T { return value; }'), response = error(request);
  for (const file of [request.source, ...request.environment.files]) {
    const source = metadata(file);
    response.diagnostic.primary = { source, origin: { start: source.length, end: source.length } };
    assert.deepEqual(decodeResponse(encodeResponse(response, request), request).diagnostic.primary, response.diagnostic.primary);
  }
  response.diagnostic.primary = { source: metadata(request.source), origin: { start: 1, end: 1 } };
  assert.throws(() => encodeResponse(response, request), /generic-package-io-origin/);
});
test('package IO framing preserves nested domain failures for associated typed responses', () => {
  for (const request of [instantiate(), exportRequest()]) {
    if (request.operation === 'instantiate') { request.package = { constructor: 'unknown-inner-field' }; request.roots = null; }
    else { request.source = { wrong: true }; request.environment = null; request.scope = 0; }
    const framed = decodeRequest(encodeRequest(request));
    assert.deepEqual(framed, request);
    const response = error(request);
    assert.deepEqual(decodeResponse(encodeResponse(response, request), request), response);
    response.diagnostic.primary = { source: clone(pkg.payload.source), origin: { start: 0, end: 0 } };
    assert.throws(() => encodeResponse(response, request), /generic-package-io-origin/);
  }
});
test('package IO rejects top-level extras, status unions, foreign IDs and unknown diagnostics', () => {
  const request = instantiate();
  for (const change of [value => { value.sessionId = 'foreign'; }, value => { value.operation = 'EXPORT'; },
    value => { value.family += '-foreign'; }, value => { delete value.roots; }]) {
    const broken = clone(request); change(broken);
    assert.throws(() => encodeRequest(broken), /generic-package-io-(schema|identity)/);
  }
  for (const change of [value => { value.value = {}; }, value => { value.diagnostic.upstreamCode = 2345; },
    value => { value.status = 'tool-error'; }]) {
    const response = error(request); change(response);
    assert.throws(() => encodeResponse(response, request), /generic-package-io-schema/);
  }
});
test('package IO rejects noncanonical JSON, duplicate and escaped duplicate keys, bad UTF8 and BOM', () => {
  const request = instantiate(), text = canonical(request);
  for (const bytes of [utf8(text + '\n'), utf8(' ' + text), utf8('\ufeff' + text),
    utf8('{"family":0,"family":1}'), utf8('{"family":0,"f\\u0061mily":1}'), Uint8Array.of(0xff)]) {
    assert.throws(() => decodeRequest(bytes), /generic-package-io-(canonical|json|utf8|schema)/);
  }
  const response = error(request);
  assert.throws(() => decodeResponse(utf8(canonical(response) + '\n'), request), /generic-package-io-canonical/);
});
test('package IO value preflight rejects getters, sparse arrays, cycles and unsafe integers before hashing', () => {
  let invoked = false; const accessor = instantiate();
  Object.defineProperty(accessor, 'package', { enumerable: true, get() { invoked = true; return pkg; } });
  assert.throws(() => requestId(accessor), /generic-package-io-schema/); assert.equal(invoked, false);
  const sparse = instantiate(); delete sparse.roots[0]; assert.throws(() => encodeRequest(sparse), /generic-package-io-schema/);
  const cycle = instantiate(); cycle.package = cycle; assert.throws(() => encodeRequest(cycle), /generic-package-io-schema/);
  const unsafe = instantiate(); unsafe.package = { unsafe: 9007199254740992 };
  assert.throws(() => requestId(unsafe), /generic-package-io-schema/);
});
test('package IO outer source policy retains NUL and all 3MiB of a valid 1Mi UTF16 string', () => {
  const nul = exportRequest('export\0source');
  assert.equal(decodeRequest(encodeRequest(nul)).source.content, nul.source.content);
  const request = exportRequest('\u0800'.repeat(1048576));
  assert.equal(Buffer.byteLength(request.source.content, 'utf8'), 3145728);
  assert.equal(decodeRequest(encodeRequest(request)).source.content.length, 1048576);
});
test('package IO envelope headroom never weakens inner package/fact string and byte budgets', () => {
  const request = instantiate(), response = ok(request);
  response.value.instances[0].parameters[0].name = 'x'.repeat(1048577);
  assert.throws(() => encodeResponse(response, request), /generic-instance-limit/);
  const invalid = instantiate(); invalid.package = { padding: Array(9).fill('x'.repeat(1048576)) };
  // The 16MiB framed request is valid; inner >8MiB is an associated import failure.
  const framed = decodeRequest(encodeRequest(invalid)), failure = error(framed);
  failure.diagnostic.kind = 'package-limit';
  assert.deepEqual(decodeResponse(encodeResponse(failure, framed), framed), failure);
  assert.throws(() => encodeResponse({ ...ok(framed), value: facts.result }, framed), /generic-package-limit/);
  const inner = clone(pkg); inner.payload.environment.files[0].content = 'x'.repeat(1048577);
  assert.throws(() => encodeGenericPackage(inner), /generic-package-limit/);
});
test('package IO outer reader bounds depth, token events, strings and bytes before whole JSON parsing', () => {
  for (const text of ['['.repeat(163) + '!', '[' + '0,'.repeat(1032768) + '!',
    '"' + 'x'.repeat(3145729) + '"!']) {
    const bytes = utf8(text); assert.ok(bytes.byteLength <= 16777216);
    assert.throws(() => decodeRequest(bytes), /generic-package-io-limit/);
  }
  const oversized = new Uint8Array(16777217);
  assert.throws(() => decodeRequest(oversized), /generic-package-io-limit/);
  assert.throws(() => requestId(oversized), /generic-package-io-limit/);
});
test('real Go package IO handler fixtures roundtrip byte exactly and correlate every response', async () => {
  const fixture = JSON.parse(await readFile(new URL('../tests/r03/fixtures/generic-package-io-source-v1.json', import.meta.url), 'utf8'));
  assert.ok(fixture.cases.length >= 3);
  assert.ok(fixture.cases.some(value => value.request.operation === 'export' && value.response.status === 'ok'));
  assert.ok(fixture.cases.some(value => value.request.operation === 'instantiate' && value.response.status === 'ok'));
  assert.ok(fixture.cases.some(value => value.response.status === 'error' && value.response.diagnostic.code > 0));
  for (const value of fixture.cases) {
    const requestBytes = encodeRequest(value.request), responseBytes = encodeResponse(value.response, requestBytes);
    assert.equal(Buffer.from(requestBytes).toString('utf8'), canonical(value.request), value.name);
    assert.equal(Buffer.from(responseBytes).toString('utf8'), canonical(value.response), value.name);
    assert.equal(requestId(requestBytes), id(value.request), value.name);
    assert.deepEqual(decodeRequest(requestBytes), value.request, value.name);
    assert.deepEqual(decodeResponse(responseBytes, requestBytes), value.response, value.name);
  }
});

test('owned VFS prefix conflicts reject controlled success while framed payload failures remain associated', () => {
  for (const paths of [['/original/main.ts', '/original/main.ts/lib.d.ts'],
    ['/decls/core.d.ts', '/decls/core.d.ts/nested.d.ts'],
    ['/decls/core.d.ts/nested.d.ts', '/decls/core.d.ts']]) {
    const request = exportRequest(), declaration = clone(request.environment.files[0]);
    if (paths[0].endsWith('/main.ts')) {
      request.source.path = paths[0]; request.environment.files[0].path = paths[1];
    } else {
      request.environment.files = [{ ...declaration, path: paths[0] }, { ...declaration, path: paths[1] }];
    }
    const response = error(request); response.diagnostic.kind = 'input';
    assert.deepEqual(decodeResponse(encodeResponse(response, request), request), response);
    response.diagnostic.primary = { source: metadata(request.source), origin: { start: 0, end: 0 } };
    assert.throws(() => encodeResponse(response, request), /generic-package-io-origin/);
  }
  const invalid = clone(pkg);
  invalid.payload.environment.files[0].path = pkg.payload.source.path + '/lib.d.ts';
  assert.throws(() => encodeGenericPackage(invalid), /generic-package-input/);
  const nested = clone(pkg), first = nested.payload.environment.files[0];
  nested.payload.environment.files = [{ ...first, path: '/decls/core.d.ts' },
    { ...first, path: '/decls/core.d.ts/nested.d.ts' }];
  assert.throws(() => encodeGenericPackage(nested), /generic-package-input/);
});
test('factory-only owned AST pathname never reserves the user declaration namespace', () => {
  const request = exportRequest(); request.environment.files[0].path = '/owned/definitions.ts/extra.d.ts';
  const response = error(request), declaration = request.environment.files[0];
  response.diagnostic.primary = { source: metadata(declaration), origin: { start: 0, end: 0 } };
  assert.deepEqual(decodeResponse(encodeResponse(response, request), request), response);
});
