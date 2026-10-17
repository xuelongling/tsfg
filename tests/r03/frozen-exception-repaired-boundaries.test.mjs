// SPDX-License-Identifier: MIT
// Negative-only repaired-wire mutations. Positive authority remains the actual Go first frame.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';

const fixture = new URL('../fixtures/r03/m21-exception/first/', import.meta.url);
const schemaHash = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { assert.ok(value.isWellFormed()); return JSON.stringify(value); }
  if (typeof value === 'number') { assert.ok(Number.isFinite(value) && !Object.is(value, -0)); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype);
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
function repaired(request, response, origin) {
  const files = request.input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a,b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  response.payload.inputIdentity = hash(jcs({ ...request.input, files }));
  response.payload.files = files.map(file => ({ path: file.path, digest: hash(file.content),
    byteLength: Buffer.byteLength(file.content), length: file.content.length, positionUnit: 'utf16' }));
  const requestBytes = Buffer.from(jcs(request));
  response.requestId = hash('tsfg.exception-facts.request.v1\0' + requestBytes);
  response.packageId = hash('tsfg.exception-facts.package.v1\0' + schemaHash + '\0' + jcs(response.payload));
  const responseBytes = Buffer.from(jcs(response));
  return { requestBytes, responseBytes, origin: { ...origin,
    requestSha256: hash(requestBytes), responseSha256: hash(responseBytes) } };
}
function rename(request, response, oldName, newName) {
  assert.equal(oldName.length, newName.length, 'retain original UTF16 anchors');
  request.input.files[0].content = request.input.files[0].content.replaceAll(oldName, newName);
  for (const symbol of response.payload.facts.symbols) if (symbol.name === oldName) symbol.name = newName;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.name === oldName) value.name = newName;
    for (const child of Object.values(value)) visit(child);
  };
  visit(response.payload.facts.functions); visit(response.payload.exports);
}
const fact = response => response.payload.facts;
const exception = response => fact(response).functions[0].body[0].exception;
/** @type {[string,(request:any,response:any)=>void][]} */
const semanticChanges = [
  ['reserved catch as parameter and use', (q,r) => rename(q,r,'value','catch')],
  ['reserved catch as function and export', (q,r) => rename(q,r,'entry','catch')],
  ['reserved return as const binding', (q,r) => rename(q,r,'copied','return')],
  ['catch declaration becomes i32', (q,r) => { fact(r).symbols[2].type='i32'; exception(r).catchClause.binding.type='i32'; }],
  ['catch occurrence loses unknown', (q,r) => { exception(r).catchClause.block.body[0].expression.type='i32'; }],
  ['catch binding becomes immutable', (q,r) => { fact(r).symbols[2].writable=false; exception(r).catchClause.binding.writable=false; }],
  ['foreign reference uses other same-type binding', (q,r) => { exception(r).tryBlock.body[0].expression.symbol='s4'; }],
  ['catch local leaks into finally', (q,r) => { const e=exception(r).finallyBlock.body[0].initializer; e.symbol='s3'; e.type='unknown'; }],
  ['throw statement omitted with source intact', (q,r) => { exception(r).tryBlock.body=[]; }],
  ['try block range consumes catch', (q,r) => { exception(r).tryBlock.range.end=120; }],
  ['catch raw declaration starts after trivia', (q,r) => { exception(r).catchClause.declarationRange.start++; }],
  ['raw function range removes leading emoji comment', (q,r) => { fact(r).functions[0].range.start=7; }],
  ['parameter symbol range shifts', (q,r) => { fact(r).symbols[1].range.start++; fact(r).functions[0].parameters[0].range.start++; }],
  ['parameter embedded and registry disagree', (q,r) => { fact(r).functions[0].parameters[0].name='other'; }],
  ['function symbol has absent registry target', (q,r) => { fact(r).functions[0].symbol='s9'; }],
  ['unowned local appended', (q,r) => { fact(r).symbols.push({...clone(fact(r).symbols[3]),id:'s5'}); }],
  ['complete exports omitted', (q,r) => { r.payload.exports[0].bindings=[]; }],
  ['export target is parameter', (q,r) => { r.payload.exports[0].bindings[0].target='s2'; }],
  ['export external flag reversed', (q,r) => { r.payload.exports[0].external=false; }],
  ['export definition differs', (q,r) => { r.payload.exports[0].bindings[0].definition.end++; }],
  ['source path inserted on ordinary function', (q,r) => { fact(r).functions[0].sourcePath='/src/foreign.ts'; }],
  ['unknown fact key', (q,r) => { fact(r).authority=true; }],
  ['unknown throw key', (q,r) => { exception(r).tryBlock.body[0].branch=true; }],
  ['declaration source altered', (q,r) => { q.input.files[1].content+=' '; }],
  ['target pointer width altered', (q,r) => { q.input.target.pointerBits='32'; }],
];
test('repaired private frames cannot grant unsupported semantic authority', async t => {
  const [requestBytes,responseBytes,originBytes] = await Promise.all(['request.json','response.json','origin.json']
    .map(name => readFile(new URL(name,fixture))));
  const request=JSON.parse(requestBytes.toString('utf8')),response=JSON.parse(responseBytes.toString('utf8'));
  const origin=JSON.parse(originBytes.toString('utf8'));
  assert.equal(origin.requestSha256,hash(requestBytes)); assert.equal(origin.responseSha256,hash(responseBytes));
  const positive=await importCapturedFrontendResponse(requestBytes,responseBytes,origin);
  assert.equal(positive.status,'ok','actual unmodified frame control'); validateFrontendSnapshot(positive.snapshot);
  const before=[hash(requestBytes),hash(responseBytes),jcs(origin)];
  for (const [name,change] of semanticChanges) await t.test(name,async () => {
    const q=clone(request),r=clone(response); change(q,r);
    const forged=repaired(q,r,origin);
    // All hash domains are valid again; rejection must inspect a deeper relation.
    assert.equal(forged.origin.requestSha256,hash(forged.requestBytes));
    assert.equal(forged.origin.responseSha256,hash(forged.responseBytes));
    const result=await importCapturedFrontendResponse(forged.requestBytes,forged.responseBytes,forged.origin);
    assert.equal(result.status,'error','forged relation accepted: '+name);
    assert.ok(result.diagnostics?.length>0);
    assert.match(result.diagnostics[0].code,/^r03-exception-/);
    if (name === 'declaration source altered') assert.equal(result.diagnostics[0].code,'r03-exception-identity',
      'the separately pinned declaration profile digest remains unchanged');
    else assert.notEqual(result.diagnostics[0].code,'r03-exception-identity',
      'this case repairs all outer/input/file hashes; inner semantic rejection required');
    t.diagnostic(name+': '+result.diagnostics[0].code);
  });
  assert.deepEqual([hash(requestBytes),hash(responseBytes),jcs(origin)],before);
});
