// SPDX-License-Identifier: MIT
// Manual cold structural oracle; no official Source semantic or execution credit.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readStringFactsCandidate, writeStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { copy, seal, sha256, wire } from './string-facts-cold-independent-oracles.mjs';

test('string facts cold reader accepts an ASI return whose literal and return share the end offset', async () => {
  const bytes = await readFile(new URL('./string-facts-asi.frozen-v1.jcs.json', import.meta.url));
  assert.equal(bytes.length, 1614);
  assert.equal(sha256(bytes), 'c1f618d4d4ad077d198fb7108097d6e775a9671cc00120a99c63f1957e794fdb');
  const expected = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  assert.deepEqual(wire(expected), bytes);
  assert.deepEqual(seal(copy(expected)), expected, 'independently repaired full input/package identities');
  assert.equal(expected.payload.files[0].content,
    '\r\n// 😀 manual cold ASI oracle\r\nexport function f(): string { return "A" }\r\n');
  assert.deepEqual(expected.payload.functions, [{
    name: 'f', sourcePath: '/src/main.ts', declarationRange: {start: 32, end: 74},
    parameters: [], returnType: 'string', body: [{
      kind: 'return', range: {start: 62, end: 72}, value: {
        kind: 'stringLiteral', type: 'string', range: {start: 69, end: 72}, codeUnits: [65],
      },
    }],
  }]);
  const fn = expected.payload.functions[0], source = expected.payload.files[0].content;
  assert.equal(source.slice(fn.declarationRange.start, fn.declarationRange.end),
    'export function f(): string { return "A" }');
  assert.equal(source.slice(fn.body[0].range.start, fn.body[0].range.end), 'return "A"');
  assert.equal(source.slice(fn.body[0].value.range.start, fn.body[0].value.range.end), '"A"');
  assert.equal(fn.body[0].range.end, fn.body[0].value.range.end);
  const owned = readStringFactsCandidate(bytes);
  assert.deepEqual(owned, expected);
  assert.deepEqual(writeStringFactsCandidate(owned), bytes);
});
