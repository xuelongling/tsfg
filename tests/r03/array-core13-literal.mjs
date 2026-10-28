// SPDX-License-Identifier: MIT
// Current Core text is a frozen literal keyed by the entire public configuration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sha } from './array-test-fixtures.mjs';

/** @typedef {{path:string,bytes:number,sha256:string}} Pin */
/** @type {{oracle:Pin,keyHelper:Pin}} */
const pins=JSON.parse(process.env.TSFG_CORE13_LITERAL_PINS??'null');
assert.ok(pins,'Root must bind the accepted independent literal oracle and pure key helper');
/** @param {Pin} pin @returns {Promise<Buffer>} */
async function readPin(pin) {
  assert.ok(pin&&typeof pin.path==='string'&&/^(?:[A-Za-z]:[\\/]|\/)/.test(pin.path));
  assert.ok(Number.isSafeInteger(pin.bytes)&&pin.bytes>0);assert.match(pin.sha256,/^[0-9a-f]{64}$/);
  const raw=await readFile(pin.path);assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256);return raw;
}
/** @type {{family:string,version:number,configurationOccurrences:number,distinctConfigurations:number,rows:{configurationKey:string,expectedRawCore:string}[]}} */
const oracle=JSON.parse((await readPin(pins.oracle)).toString('utf8'));
await readPin(pins.keyHelper);
const {configurationKey}=await import(pathToFileURL(pins.keyHelper.path).href);
assert.equal(oracle.family,'tsfg.m26g-lower-hir-literal-oracle');assert.equal(oracle.version,1);
assert.equal(oracle.configurationOccurrences,56);assert.equal(oracle.distinctConfigurations,55);
const literal=new Map();
for(const row of oracle.rows) {
  assert.match(row.configurationKey,/^[0-9a-f]{64}$/);assert.equal(typeof row.expectedRawCore,'string');
  assert.ok(!literal.has(row.configurationKey),'one exact frozen literal per complete configuration');
  literal.set(row.configurationKey,row.expectedRawCore);
}
assert.equal(literal.size,55);
/** Match the real public argument-presence mode, not a truthiness/default test.
 * The caller evaluates its SUT normally before requesting this literal; cold
 * failure paths retain the original public diagnostic assertions.
 * @param {any} hir @param {any} factsContext @param {any} [fixedContext] @returns {string} */
export function expectedArrayCore13(hir,factsContext,fixedContext) {
  const key=configurationKey(hir,factsContext,fixedContext,arguments.length>=3);
  assert.ok(literal.has(key),'No independent Core13 literal for complete lowerHir configuration '+key);
  return literal.get(key);
}
