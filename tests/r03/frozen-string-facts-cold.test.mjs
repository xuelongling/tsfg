// SPDX-License-Identifier: MIT
// Independently frozen 24a data: cold transport/domain credit only, never Source semantics or execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readStringFactsCandidate, writeStringFactsCandidate } from '../../compiler/string-facts.mjs';

const validName = './string-facts-lossless.frozen-v1.jcs.json';
const invalidName = './string-facts-code-unit-65536.frozen-v1.jcs.json';
const validSHA = '64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468';
const invalidSHA = '2d4ec9eb438e631d453a6ff7644e1a822b806d7987f5ecb0c2becdf591a60b55';
const schemaHash = 'sha256:6dfed46326c15a81aeb6a1ea9b5ed2fc10db7bb1bf27733ac3df530d78d5cc62';
const requestId = 'sha256:79391589f50d250f24754f8b9319edc4ace939a485dcc6c88ca3545b202f8784';
const validPackageId = 'sha256:968f1dc089d12b8826af05e413f8789db95c1495b941d9aab754daa869986009';
const invalidPackageId = 'sha256:20c4bbc5cc75389a714c09867f341cff1b97e8276f03266790327d9aaf7cdd5a';
const manualCodeUnits = [
  [], [0], [55357, 56832], [55357, 56832], [55357, 56832], [55296], [56320],
  [56832, 55357], [65, 55296, 0, 56320, 90], [92, 34, 10, 13, 9, 65, 66],
  [55296, 56320], [57344], [101, 769], [233],
];

/** @param {string | Uint8Array} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Independent JCS for the frozen JSON domain; never import product canonical or identity helpers.
/** @param {any} value @returns {string} */
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assert.ok(value.isWellFormed(), 'invalid Unicode in independent JSON preimage');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'plain oracle JSON object');
  return '{' + Object.keys(value).sort().map(key => {
    assert.ok(key.isWellFormed());
    return JSON.stringify(key) + ':' + canonical(value[key]);
  }).join(',') + '}';
}

/** @param {any} value */
function packageIdentity(value) {
  const prefix = Buffer.from('tsfg.string-facts.package.v1\0' + value.schemaHash + '\0', 'utf8');
  return 'sha256:' + sha256(Buffer.concat([prefix, Buffer.from(canonical(value.payload))]));
}

/** @param {any} value */
function requestIdentity(value) {
  const p = value.payload;
  const request = {
    family: 'tsfg.string-facts-request-candidate', version: 1,
    input: {
      sourceRoot: p.sourceRoot, rootFile: p.rootFile, config: p.config, declarations: p.declarations,
      files: p.files.map((/** @type {any} */ file) => ({
        path: file.path, content: file.content, sha256: file.sha256,
      })),
    },
  };
  const bytes = Buffer.from(canonical(request) + '\n');
  assert.equal(sha256(bytes), '153b9e72ac0dec01815f05218cad4bc7377a46456b5030e0659e4223474fdec5');
  return 'sha256:' + sha256(Buffer.concat([Buffer.from('tsfg.string-facts.request.v1\0'), bytes]));
}

/** @param {string} name @param {number} size @param {string} digest */
async function fixture(name, size, digest) {
  const bytes = await readFile(new URL(name, import.meta.url));
  assert.equal(bytes.length, size);
  assert.equal(sha256(bytes), digest, 'independent fixture drift');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.ok(!text.startsWith('\uFEFF'));
  const value = JSON.parse(text);
  assert.deepEqual(Buffer.from(canonical(value) + '\n'), bytes, 'exact JCS plus one LF');
  assert.equal(value.schemaHash, schemaHash);
  assert.equal(value.requestId, requestId);
  assert.equal(requestIdentity(value), requestId, 'complete input identity is independently valid');
  assert.equal(packageIdentity(value), value.packageId, 'independent package identity is valid');
  for (const file of value.payload.files) {
    assert.equal(sha256(file.content), file.sha256);
    assert.equal(Buffer.byteLength(file.content, 'utf8'), file.byteLength);
    assert.equal(file.content.length, file.utf16Length);
  }
  return { bytes, value };
}

/** @param {any} value @param {WeakSet<object>} [seen] */
function assertFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value), 'complete cold result must be frozen');
  for (const child of Object.values(value)) assertFrozen(child, seen);
}

test('string facts cold reader preserves the complete frozen fourteen-owner package', async () => {
  const expected = await fixture(validName, 6147, validSHA);
  assert.equal(expected.value.packageId, validPackageId);
  const input = Buffer.from(expected.bytes);
  const owned = /** @type {any} */ (readStringFactsCandidate(input));
  input.fill(0);
  assert.deepEqual(owned, expected.value, 'full files, input metadata, 42 ranges and every owner');
  assertFrozen(owned);
  assert.deepEqual(owned.payload.functions.map((/** @type {any} */ f) => f.name),
    ['s00', 's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12', 's13']);
  assert.deepEqual(owned.payload.functions.map((/** @type {any} */ f) => f.body[0].value.codeUnits),
    manualCodeUnits, 'empty, NUL, lone/reversed surrogates, repeated owners and no normalization');
  const output = writeStringFactsCandidate(owned);
  assert.ok(Buffer.isBuffer(output));
  assert.deepEqual(output, expected.bytes, 'complete private bytes -> owned -> identical private bytes');
});

test('string facts cold reader rejects 65536 after independent package identity repair', async () => {
  const valid = await fixture(validName, 6147, validSHA);
  const invalid = await fixture(invalidName, 6151, invalidSHA);
  assert.equal(valid.value.payload.functions[1].name, 's01');
  assert.deepEqual(valid.value.payload.functions[1].body[0].value.codeUnits, [0]);
  const expectedMutation = JSON.parse(JSON.stringify(valid.value));
  expectedMutation.payload.functions[1].body[0].value.codeUnits[0] = 65536;
  expectedMutation.packageId = packageIdentity(expectedMutation);
  assert.equal(expectedMutation.packageId, invalidPackageId);
  assert.deepEqual(invalid.value, expectedMutation,
    'only one codeUnit and its packageId differ; schema/request/source/owners/ranges stay valid');
  assert.equal(invalid.value.packageId, invalidPackageId);
  assert.notEqual(invalid.value.packageId, valid.value.packageId);
  // The initial real framing/identity reader accepts this; Missing expected rejection is causal RED.
  // Import, schema, family, canonical, identity or limit failures must never satisfy this assertion.
  await assert.rejects(async () => readStringFactsCandidate(invalid.bytes), {
    code: 'r03-string-facts-code-unit',
  });
});
