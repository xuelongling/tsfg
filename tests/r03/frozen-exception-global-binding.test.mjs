// SPDX-License-Identifier: MIT
// Independent negative-input helper prepared in scratch; the installed test below exercises Product.
// Baseline frames are exact actual Source first GREEN captures. Returned frames
// are intentionally forged, fully rehashed negative inputs, never new producer
// success evidence. Root must test cold admission independently.
import { createHash } from 'node:crypto';

const SCHEMA = 'sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const ORIGINAL = "// 😀\r\nexport function entry(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}";
const PINS = {
  request: 'sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed',
  response: 'sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a',
  origin: 'sha256:58842dfb6862b162c2cd82a6e79298905ebd3eec5d6e30618797d5e91b67f612',
};
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const insist = (ok, message) => { if (!ok) throw new Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));

// These fixtures contain only I-JSON objects/arrays/strings/booleans, null and
// exact finite integers. Key sorting uses UTF16 code units, matching JCS.
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    insist(Number.isFinite(value), 'non-finite fixture number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  insist(value && typeof value === 'object', 'invalid fixture JSON value');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function renameNames(value, before, after) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && value.name === before) value.name = after;
  for (const child of Object.values(value)) renameNames(child, before, after);
}

// Every source range in this first packet belongs to main.ts. No declaration
// source AST ranges exist in the packet. Reject endpoints inside edited text;
// deleted statements are removed before this transform.
function shiftRanges(value, start, end, replacementLength) {
  const delta = replacementLength - (end - start);
  const point = p => {
    if (p <= start) return p;
    if (p >= end) return p + delta;
    throw new Error('unexpected retained range endpoint inside source edit: ' + p);
  };
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item) && Object.keys(item).length === 2
        && Number.isInteger(item.start) && Number.isInteger(item.end)) {
      item.start = point(item.start);
      item.end = point(item.end);
      return;
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
}

function seal(request, response, origin, source) {
  const input = request.input;
  const root = input.files.find(file => file.path === input.rootFile);
  insist(root, 'main input missing');
  root.content = source;
  if (Object.hasOwn(root, 'sha256')) root.sha256 = digest(source);
  const files = input.files.map(file => ({ path: file.path, content: file.content }))
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const identityInput = { ...clone(input), files };
  response.payload.inputIdentity = digest(canonical(identityInput));
  response.payload.files = files.map(file => ({
    path: file.path, digest: digest(file.content), byteLength: Buffer.byteLength(file.content),
    length: file.content.length, positionUnit: 'utf16',
  }));
  const requestText = canonical(request);
  response.requestId = digest('tsfg.exception-facts.request.v1\0' + requestText);
  response.packageId = digest('tsfg.exception-facts.package.v1\0' + SCHEMA + '\0' + canonical(response.payload));
  const responseText = canonical(response);
  origin.requestSha256 = digest(requestText);
  origin.responseSha256 = digest(responseText);
  // Other custody fields remain unchanged to isolate the forged model. They
  // identify the real baseline producer, not authority for these mutations.
  return {
    source, requestBytes: Buffer.from(requestText), responseBytes: Buffer.from(responseText),
    originBytes: Buffer.from(canonical(origin)), origin: clone(origin),
  };
}

export function exceptionScriptDTSConflictCandidate(requestBytes, responseBytes, originBytes) {
  const frames = { request: Buffer.from(requestBytes), response: Buffer.from(responseBytes), origin: Buffer.from(originBytes) };
  for (const name of Object.keys(frames)) insist(digest(frames[name]) === PINS[name], 'exact baseline ' + name + ' pin differs');
  const baseline = Object.fromEntries(Object.entries(frames).map(([name, bytes]) => {
    const text = bytes.toString('utf8'), value = JSON.parse(text);
    insist(canonical(value) === text, 'baseline frame must be exact JCS');
    return [name, value];
  }));
  insist(baseline.request.schemaHash === SCHEMA && baseline.response.schemaHash === SCHEMA, 'schema differs');
  const request = clone(baseline.request), response = clone(baseline.response), origin = clone(baseline.origin);
  let source = request.input.files.find(file => file.path === request.input.rootFile)?.content;
  insist(source === ORIGINAL, 'independent literal source differs');

  // The script is still in the already accepted ordinary single-source profile.
  // Only the explicit export token is removed; original leading trivia remains.
  const exportStart = source.indexOf('export '), exportEnd = exportStart + 'export '.length;
  insist(exportStart >= 0, 'literal export token missing');
  source = source.slice(0, exportStart) + source.slice(exportEnd);
  response.payload.exports = [{ sourcePath: request.input.rootFile, external: false, bindings: [] }];
  shiftRanges(response.payload, exportStart, exportEnd, 0);

  // Type/value namespaces allow a module-local function with this name, but a
  // script-level function conflicts with the actual pinned global ambient const.
  const nameStart = source.indexOf('entry'), nameEnd = nameStart + 'entry'.length;
  const replacement = '__tsfg_i32';
  insist(nameStart >= 0, 'literal function identifier missing');
  source = source.slice(0, nameStart) + replacement + source.slice(nameEnd);
  renameNames(response.payload, 'entry', replacement);
  shiftRanges(response.payload, nameStart, nameEnd, replacement.length);
  insist(response.payload.facts.functions[0].name === replacement
    && response.payload.facts.symbols[0].name === replacement, 'function/symbol identity edit missing');
  const sealed = seal(request, response, origin, source);
  return {
    name: 'scriptConflictsWithDTSValue', expectedAdmission: 'error',
    reason: 'Script function conflicts with the actual pinned-DTS global const value binding.',
    provenance: 'independent repaired negative mutation; not an actual new Source producer package',
    ...sealed,
  };
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
const fixture=new URL('../fixtures/r03/m21-exception/first/',import.meta.url);
test('script-level function cannot conflict with a pinned ambient value binding',async t=>{
  const frames=await Promise.all(['request.json','response.json','origin.json'].map(name=>readFile(new URL(name,fixture))));
  const pins=frames.map(digest);
  const actual=await importCapturedFrontendResponse(frames[0],frames[1],JSON.parse(frames[2].toString('utf8')));
  assert.equal(actual.status,'ok','actual unchanged private frame control');validateFrontendSnapshot(actual.snapshot);
  const item=exceptionScriptDTSConflictCandidate(...frames),response=JSON.parse(item.responseBytes.toString('utf8'));
  assert.equal(item.origin.requestSha256,digest(item.requestBytes));assert.equal(item.origin.responseSha256,digest(item.responseBytes));
  assert.equal(response.requestId,digest('tsfg.exception-facts.request.v1\0'+item.requestBytes));
  assert.equal(response.packageId,digest('tsfg.exception-facts.package.v1\0'+SCHEMA+'\0'+canonical(response.payload)));
  const result=await importCapturedFrontendResponse(item.requestBytes,item.responseBytes,item.origin);
  t.diagnostic('independent repaired script candidate actual admission: '+result.status);
  assert.equal(result.status,'error',item.reason);
  assert.match(result.diagnostics?.[0]?.code??'',/^r03-exception-/);
  assert.notEqual(result.diagnostics[0].code,'r03-exception-identity','outer/input/file identities were fully repaired');
  assert.deepEqual(frames.map(digest),pins);
});
