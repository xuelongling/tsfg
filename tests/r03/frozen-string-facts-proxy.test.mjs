// SPDX-License-Identifier: MIT
// Untrusted-object safety only; no Source semantic, official admission or execution credit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeStringFactsCandidate } from '../../compiler/string-facts.mjs';
import { frozen } from './string-facts-cold-independent-oracles.mjs';

/** @param {object} target @param {string[]} calls */
function trapped(target, calls) {
  const handler = Object.fromEntries([
    'get', 'set', 'has', 'deleteProperty', 'ownKeys', 'getOwnPropertyDescriptor',
    'defineProperty', 'getPrototypeOf', 'setPrototypeOf', 'isExtensible',
    'preventExtensions', 'apply', 'construct',
  ].map(name => [name, () => {
    calls.push(name);
    throw new Error('bounded Proxy trap sentinel: ' + name);
  }]));
  return new Proxy(target, handler);
}

/** @param {any} value @param {string[]} calls */
function rejectsWithoutTraps(value, calls) {
  assert.throws(() => writeStringFactsCandidate(value), {code: 'r03-string-facts-schema'});
  assert.deepEqual(calls, [], 'reject the Proxy before inspecting its prototype, descriptors or values');
}

test('string facts cold writer rejects root Proxy before any behavioral trap', async () => {
  const {value} = await frozen(), calls = [];
  rejectsWithoutTraps(trapped(value, calls), calls);
});

test('string facts cold writer rejects nested payload Proxy before any behavioral trap', async () => {
  const {value} = await frozen(), calls = [];
  value.payload = trapped(value.payload, calls);
  rejectsWithoutTraps(value, calls);
});

test('string facts cold writer rejects nested codeUnits array Proxy before any behavioral trap', async () => {
  const {value} = await frozen(), calls = [];
  const literal = value.payload.functions[1].body[0].value;
  literal.codeUnits = trapped(literal.codeUnits, calls);
  rejectsWithoutTraps(value, calls);
});
