// SPDX-License-Identifier: MIT
// Frozen after independent official diagnostics/types, before any related repair.
// Negative frames are forged and fully rehashed; positive controls are actual Go captures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const root = new URL('../fixtures/r03/m21-exception/', import.meta.url);
const schema = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
/** @param {string} directory @param {any} files @param {string[]} names */
async function frames(directory, files, names) {
  const bytes = await Promise.all(names.map(name => readFile(new URL(directory + '/' + name, root))));
  bytes.forEach((value, i) => { assert.equal(value.length, files[names[i]].bytes); assert.equal(hash(value), files[names[i]].sha256); });
  return bytes;
}
test('officially invalid exception relations reject complete repaired identities', async t => {
  const manifestBytes = await readFile(new URL('semantic-boundaries/manifest.json', root));
  assert.equal(hash(manifestBytes), '1775c645daa6e8b6bdc748d274bb6f20744ddc827c1efd1b76a79896d60431c9');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.schema, 'r03.m21c.forged-repaired-semantic-negatives.v1');
  assert.equal(manifest.actualControls.length, 2); assert.equal(manifest.cases.length, 4);
  for (const control of manifest.actualControls) await t.test('actual control ' + control.directory, async () => {
    const [request, response, origin] = await frames(control.directory, control.files, ['request.json','response.json','origin.json']);
    const result = await importCapturedFrontendResponse(request, response, JSON.parse(origin.toString('utf8')));
    assert.equal(result.status, 'ok'); validateFrontendSnapshot(JSON.parse(jcs(result.snapshot)));
  });
  for (const item of manifest.cases) await t.test(item.name, async () => {
    const [request, response, originBytes, oracleBytes] = await frames('semantic-boundaries/' + item.directory, item.files,
      ['request.json','response.json','origin.json','official-oracle.json']);
    const q = JSON.parse(request.toString('utf8')), p = JSON.parse(response.toString('utf8'));
    const origin = JSON.parse(originBytes.toString('utf8')), oracle = JSON.parse(oracleBytes.toString('utf8'));
    const source = q.input.files.find(file => file.path === q.input.rootFile).content;
    assert.equal(source, oracle.source); assert.equal(hash(source), item.sourceSha256);
    assert.equal(oracle.sourceSha256, item.sourceSha256);
    if (item.hasActualNever) assert.ok(oracle.occurrences.some(use => use.sameCatch && use.isNever && use.flags === 262144));
    else assert.ok(oracle.diagnostics.some(diagnostic => [1127,2397].includes(diagnostic.code)));
    assert.equal(request.toString('utf8'), jcs(q)); assert.equal(response.toString('utf8'), jcs(p));
    assert.equal(p.schemaHash, schema); assert.equal(origin.requestSha256, 'sha256:' + hash(request));
    assert.equal(origin.responseSha256, 'sha256:' + hash(response));
    const files = q.input.files.map(file => ({path:file.path,content:file.content})).sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    assert.equal(p.payload.inputIdentity, 'sha256:' + hash(jcs({...q.input,files})));
    assert.deepEqual(p.payload.files, files.map(file => ({path:file.path,digest:'sha256:' + hash(file.content),
      byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})));
    assert.equal(p.requestId, 'sha256:' + hash('tsfg.exception-facts.request.v1\0' + request));
    assert.equal(p.packageId, 'sha256:' + hash('tsfg.exception-facts.package.v1\0' + schema + '\0' + jcs(p.payload)));
    const before = [hash(request),hash(response),jcs(origin)];
    const result = await importCapturedFrontendResponse(request,response,origin);
    assert.deepEqual([hash(request),hash(response),jcs(origin)],before);
    assert.equal(result.status,'error','officially invalid relation accepted: ' + jcs(result));
    assert.notEqual(result.diagnostics?.[0]?.code,'r03-exception-identity','all outer identities must reach semantic checking');
  });
});
