// SPDX-License-Identifier: MIT
// Structural cold evidence only: re-signing data never grants official Source meaning.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readStringFactsV2Candidate as read, writeStringFactsV2Candidate as write } from '../../compiler/string-facts-v2.mjs';
import { readStringFactsCandidate as readV1, writeStringFactsCandidate as writeV1 } from '../../compiler/string-facts.mjs';
import { fixture, copy, wire, sealFacts, sha256, coldReject } from './string-concat-hir-independent-fixtures.mjs';
import { example } from './string-hir-independent-fixtures.mjs';

/** @param {any} value @param {string} code */
function rejectsBoth(value, code) {
  coldReject(() => read(wire(value)), code); coldReject(() => write(value), code);
}
/** All logical mutations repair identities; rejection must inspect the full shape/domain. @type {Array<[string, string, (p: any) => void]>} */
const mutations = [
  ['unknown envelope field', 'schema', p => { p.extra = true; }],
  ['unknown payload field', 'schema', p => { p.payload.extra = true; }],
  ['unknown file field', 'schema', p => { p.payload.files[0].extra = true; }],
  ['unknown function field', 'schema', p => { p.payload.functions[2].extra = true; }],
  ['unknown return field', 'schema', p => { p.payload.functions[2].body[0].extra = true; }],
  ['unknown concat result', 'schema', p => { p.payload.functions[2].body[0].value.codeUnits = [55357, 56960]; }],
  ['unknown left field', 'schema', p => { p.payload.functions[2].body[0].value.left.extra = true; }],
  ['unknown right field', 'schema', p => { p.payload.functions[2].body[0].value.right.extra = true; }],
  ['wrong family', 'schema', p => { p.family = 'tsfg.other-package'; }],
  ['v1 package version', 'schema', p => { p.version = 1; }],
  ['wrong position unit', 'schema', p => { p.payload.positionUnit = 'bytes'; }],
  ['null payload', 'schema', p => { p.payload = null; }],
  ['null functions', 'schema', p => { p.payload.functions = null; }],
  ['no functions', 'limit', p => { p.payload.functions = []; }],
  ['empty owner', 'schema', p => { p.payload.functions[2].name = ''; }],
  ['duplicate owner', 'owner', p => { p.payload.functions[2].name = p.payload.functions[1].name; }],
  ['nonroot owner', 'owner', p => { p.payload.functions[2].sourcePath = p.payload.files[1].path; }],
  ['parameter added', 'schema', p => { p.payload.functions[2].parameters = [{}]; }],
  ['wrong return type', 'schema', p => { p.payload.functions[2].returnType = 'i32'; }],
  ['empty body', 'schema', p => { p.payload.functions[2].body = []; }],
  ['second return', 'schema', p => { p.payload.functions[2].body.push(copy(p.payload.functions[2].body[0])); }],
  ['wrong return kind', 'schema', p => { p.payload.functions[2].body[0].kind = 'throw'; }],
  ['literal instead of concat', 'schema', p => { p.payload.functions[2].body[0].value = copy(p.payload.functions[2].body[0].value.left); }],
  ['wrong concat type', 'schema', p => { p.payload.functions[2].body[0].value.type = 'i32'; }],
  ['missing plus', 'schema', p => { delete p.payload.functions[2].body[0].value.operatorRange; }],
  ['missing left', 'schema', p => { delete p.payload.functions[2].body[0].value.left; }],
  ['missing right', 'schema', p => { delete p.payload.functions[2].body[0].value.right; }],
  ['nested concat left', 'schema', p => { p.payload.functions[2].body[0].value.left = copy(p.payload.functions[3].body[0].value); }],
  ['wrong right kind', 'schema', p => { p.payload.functions[2].body[0].value.right.kind = 'integerLiteral'; }],
  ['wrong left type', 'schema', p => { p.payload.functions[2].body[0].value.left.type = 'u16'; }],
  ['null units', 'schema', p => { p.payload.functions[2].body[0].value.left.codeUnits = null; }],
  ['missing empty units', 'schema', p => { delete p.payload.functions[0].body[0].value.left.codeUnits; }],
  ['negative unit preflight', 'schema', p => { p.payload.functions[2].body[0].value.left.codeUnits = [-1]; }],
  ['fractional unit preflight', 'schema', p => { p.payload.functions[2].body[0].value.left.codeUnits = [1.5]; }],
  ['unit above UTF16 maximum', 'code-unit', p => { p.payload.functions[2].body[0].value.left.codeUnits = [65536]; }],
  ['unknown range field', 'schema', p => { p.payload.functions[2].declarationRange.extra = 1; }],
  ['negative range preflight', 'schema', p => { p.payload.functions[2].declarationRange.start = -1; }],
  ['empty declaration', 'range', p => { p.payload.functions[2].declarationRange.end = p.payload.functions[2].declarationRange.start; }],
  ['declaration order', 'range', p => { p.payload.functions.reverse(); }],
  ['declaration overlap', 'range', p => { p.payload.functions[2].declarationRange.start = 140; }],
  ['return outside owner', 'range', p => { p.payload.functions[2].body[0].range.start = 143; }],
  ['concat left join', 'range', p => { p.payload.functions[2].body[0].value.range.start--; }],
  ['concat right join', 'range', p => { p.payload.functions[2].body[0].value.range.end++; }],
  ['plus width', 'range', p => { p.payload.functions[2].body[0].value.operatorRange.end++; }],
  ['plus points at trivia', 'range', p => { p.payload.functions[2].body[0].value.operatorRange = {start: 200, end: 201}; }],
  ['plus crosses left', 'range', p => { p.payload.functions[2].body[0].value.operatorRange = {start: 199, end: 200}; }],
  ['swapped operand ranges', 'range', p => { const v = p.payload.functions[2].body[0].value; [v.left.range, v.right.range] = [v.right.range, v.left.range]; }],
  ['left quote endpoint', 'range', p => { p.payload.functions[2].body[0].value.left.range.end--; }],
  ['right quote endpoint', 'range', p => { p.payload.functions[2].body[0].value.right.range.start++; }],
  ['split Source surrogate pair', 'range', p => { p.payload.functions[4].body[0].value.left.range.start = 330; }],
  ['wrong file SHA', 'identity', p => { p.payload.files[0].sha256 = '0'.repeat(64); }],
  ['wrong byteLength', 'source', p => { p.payload.files[0].byteLength++; }],
  ['wrong UTF16 length', 'source', p => { p.payload.files[0].utf16Length++; }],
  ['missing input file', 'input', p => { p.payload.files.pop(); }],
  ['file order', 'input', p => { p.payload.files.reverse(); }],
  ['wrong sourceRoot', 'input', p => { p.payload.sourceRoot += '/'; }],
  ['wrong root linkage', 'input', p => { p.payload.rootFile = '/oracle24e/absent.ts'; }],
  ['wrong strict', 'input', p => { p.payload.config.strict = false; }],
  ['wrong noEmit', 'input', p => { p.payload.config.noEmit = false; }],
  ['wrong allowJs', 'input', p => { p.payload.config.allowJs = true; }],
  ['wrong declarations', 'input', p => { p.payload.declarations.version = 'minimal-scalars-v3'; }],
  ['wrong known schema', 'identity', p => { p.schemaHash = 'sha256:' + '0'.repeat(64); }],
];

test('24f v2 cold complete shape domain ranges and identities', async t => {
  for (const [name, code, change] of mutations) await t.test(name, async () => {
    const {facts} = await fixture(); change(facts);
    // Null payload cannot supply a request; shape must reject before any identity is needed.
    if (facts.payload !== null) sealFacts(facts);
    rejectsBoth(facts, code);
  });
  for (const field of ['requestId', 'packageId']) await t.test('wrong ' + field, async () => {
    const {facts} = await fixture(); facts[field] = 'sha256:' + '0'.repeat(64); rejectsBoth(facts, 'identity');
  });
});

/** @type {Array<[string, string, (b: Buffer) => Buffer]>} */
const raw = [
  ['invalid UTF8', 'utf8', () => Buffer.from([255])],
  ['raw surrogate UTF8', 'utf8', () => Buffer.from([237, 160, 128])],
  ['BOM', 'canonical', b => Buffer.concat([Buffer.from([239, 187, 191]), b])],
  ['missing LF', 'canonical', b => b.subarray(0, -1)],
  ['second LF', 'canonical', b => Buffer.concat([b, Buffer.from('\n')])],
  ['CRLF framing', 'canonical', b => Buffer.concat([b.subarray(0, -1), Buffer.from('\r\n')])],
  ['leading whitespace', 'canonical', b => Buffer.concat([Buffer.from(' '), b])],
  ['duplicate key', 'json', b => Buffer.from(b.toString().replace('"version":2', '"version":2,"version":2'))],
  ['escaped duplicate key', 'json', b => Buffer.from(b.toString().replace('"version":2', '"version":2,"vers' + String.fromCharCode(92) + 'u0069on":2'))],
  ['trailing value', 'json', b => Buffer.concat([b, Buffer.from('{}\n')])],
  ['null root', 'schema', () => Buffer.from('null\n')],
  ['unpaired JSON surrogate', 'schema', b => Buffer.from(b.toString().replace('"name":"paired"', '"name":"' + String.fromCharCode(92) + 'ud800"'))],
  ['negative zero preflight', 'schema', b => Buffer.from(b.toString().replace('"codeUnits":[0]', '"codeUnits":[-0]'))],
  ['prototype key', 'schema', b => Buffer.from(b.toString().replace('"version":2', '"__proto__":{},"version":2'))],
  ['noncanonical key order', 'canonical', b => { const p = JSON.parse(b.toString());
    return Buffer.from(JSON.stringify({version: p.version, family: p.family, schemaHash: p.schemaHash,
      requestId: p.requestId, packageId: p.packageId, payload: p.payload}) + '\n'); }],
];
test('24f v2 cold strict UTF8 JSON and canonical frame', async t => {
  for (const [name, code, change] of raw) await t.test(name, async () => {
    const {factsBytes} = await fixture(), altered = change(factsBytes);
    assert.notDeepEqual(altered, factsBytes); coldReject(() => read(altered), code);
  });
  const {facts} = await fixture(); facts.payload.functions[1].body[0].value.left.codeUnits[0] = -0;
  coldReject(() => write(facts), 'schema', true);
});

test('24f v1 v2 public readers and writers reject cross-version packets', async () => {
  const f = await fixture(), v1 = await example();
  assert.deepEqual(readV1(v1.factsBytes), v1.facts); assert.deepEqual(read(f.factsBytes), f.facts);
  assert.throws(() => readV1(f.factsBytes), {code: 'r03-string-facts-schema'});
  assert.throws(() => writeV1(f.facts), {code: 'r03-string-facts-schema'});
  coldReject(() => read(v1.factsBytes), 'schema'); coldReject(() => write(v1.facts), 'schema');
});

test('24f cold structural false-value packet is not Source semantic evidence', async () => {
  const {facts} = await fixture(); facts.payload.functions[2].body[0].value.left.codeUnits = [65];
  sealFacts(facts); const bytes = wire(facts);
  assert.notEqual(facts.packageId, 'sha256:df91096cd1604f9c9af35e04df1ff3c11d77faeb3d9890cbf9bdc57ab4d83c6e');
  assert.deepEqual(read(bytes), facts); assert.deepEqual(write(facts), bytes);
  // The reader intentionally does not decode a quoted Source literal or rerun a checker.
  assert.equal(sha256(bytes).length, 64);
});
