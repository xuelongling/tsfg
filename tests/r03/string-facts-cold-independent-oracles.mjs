// SPDX-License-Identifier: MIT
// Independent cold oracles only: no Source producer/parser or product implementation imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** @param {string | Uint8Array} bytes */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {any} value @returns {any} */
export const copy = value => JSON.parse(JSON.stringify(value));

// Fixture domain uses ECMAScript finite JSON numbers and UTF16 property ordering, without normalization.
/** @param {any} value @returns {string} */
export function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    assert.ok(value.isWellFormed(), 'independent JSON strings must be well formed');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value) && !Object.is(value, -0));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, 'plain independent JSON');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
/** @param {any} value */
export const wire = value => Buffer.from(canonical(value) + '\n');

/** @param {any} value */
function requestIdentity(value) {
  const p = value.payload;
  const request = {
    family: 'tsfg.string-facts-request-candidate', version: 1,
    input: {
      sourceRoot: p.sourceRoot, rootFile: p.rootFile, config: p.config, declarations: p.declarations,
      files: p.files.map((/** @type {any} */ f) => ({path: f.path, content: f.content, sha256: f.sha256})),
    },
  };
  return 'sha256:' + sha256(Buffer.concat([Buffer.from('tsfg.string-facts.request.v1\0'), wire(request)]));
}
/** @param {any} value @param {boolean} [repairRequest] @returns {any} */
export function seal(value, repairRequest = true) {
  if (repairRequest) value.requestId = requestIdentity(value);
  const prefix = Buffer.from('tsfg.string-facts.package.v1\0' + value.schemaHash + '\0');
  value.packageId = 'sha256:' + sha256(Buffer.concat([prefix, Buffer.from(canonical(value.payload))]));
  return value;
}

export async function frozen() {
  const bytes = await readFile(new URL('./string-facts-lossless.frozen-v1.jcs.json', import.meta.url));
  assert.equal(bytes.length, 6147);
  assert.equal(sha256(bytes), '64e164fc00016eda6052453993c0eab1de9cac0f4879de3b79fe42df4b38a468');
  const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  assert.deepEqual(wire(value), bytes);
  assert.deepEqual(seal(copy(value)), value, 'both identities independently reconstructed');
  return {bytes, value};
}

/** @param {any} value @param {string} text */
export function setSource(value, text) {
  const file = value.payload.files.find((/** @type {any} */ f) => f.path === value.payload.rootFile);
  assert.ok(file);
  file.content = text;
  file.sha256 = sha256(text);
  file.byteLength = Buffer.byteLength(text, 'utf8');
  file.utf16Length = text.length;
  return value;
}

// Literal spellings and code-unit arrays are provided by hand; no decoder or Source evaluation.
// These complete Source/DTO pairs are hand cold oracles, never actual official Source evidence.
/** @param {any} base @param {{literal: string, codeUnits: number[]}[]} entries @returns {any} */
export function manualLiterals(base, entries) {
  const value = copy(base), functions = [];
  let source = '\r\n// 😀 manual cold oracle\r\n';
  for (const [ordinal, entry] of entries.entries()) {
    const name = 'm' + String(ordinal).padStart(2, '0');
    const prefix = 'export function ' + name + '(): string { ';
    const literal = entry.literal;
    const line = prefix + 'return ' + literal + '; }';
    const start = source.length, returnStart = start + prefix.length, literalStart = returnStart + 7;
    const declarationRange = {start, end: start + line.length};
    const range = {start: returnStart, end: literalStart + literal.length + 1};
    const literalRange = {start: literalStart, end: literalStart + literal.length};
    functions.push({
      name, sourcePath: value.payload.rootFile, declarationRange, parameters: [], returnType: 'string',
      body: [{kind: 'return', range, value: {
        kind: 'stringLiteral', type: 'string', range: literalRange, codeUnits: [...entry.codeUnits],
      }}],
    });
    source += line + '\r\n';
    assert.equal(source.slice(declarationRange.start, declarationRange.end), line);
    assert.equal(source.slice(range.start, range.end), 'return ' + literal + ';');
    assert.equal(source.slice(literalRange.start, literalRange.end), literal);
  }
  value.payload.functions = functions;
  return seal(setSource(value, source));
}

/** @param {any} base @param {number[]} lengths @returns {any} */
export function manualPackage(base, lengths) {
  return manualLiterals(base, lengths.map(count => {
    assert.ok(Number.isSafeInteger(count) && count >= 0);
    return {literal: '"' + 'A'.repeat(count) + '"', codeUnits: Array(count).fill(65)};
  }));
}
