// SPDX-License-Identifier: MIT
// Public adoption tracer; the separately retained Source RED proves mutation capability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';

/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + jcs(value[k])).join(',') + '}';
}
/** @param {string | Uint8Array} value */
const sha = value => createHash('sha256').update(value).digest('hex');

test('25d public facts reader preserves every frozen v2 package', async t => {
  const raw = await readFile(new URL('./array-facts-oracle-v2.json', import.meta.url));
  assert.equal(raw.length, 71746);
  assert.equal(sha(raw), '046084092c8c963870fa4ebb4984abcec0b793b5bbe309cfd1d2d4bd1129c0e0');
  const oracle = JSON.parse(raw.toString('utf8'));
  assert.equal(jcs(oracle) + '\n', raw.toString('utf8'));
  assert.equal(oracle.cases.length, 8);
  for (const row of oracle.cases) {
    const bytes = Buffer.from(row.packageText), before = Buffer.from(bytes);
    assert.equal(bytes.length, row.packageBytes); assert.equal(sha(bytes), row.packageSHA256);
    const expected = JSON.parse(row.packageText);
    assert.equal(jcs(expected) + '\n', row.packageText);
    t.diagnostic('25d PUBLIC_FACTS_READER_REACHED ' + row.name);
    const actual = readArrayFactsCandidate(bytes);
    assert.deepEqual(actual, expected, row.name + ' complete independent package');
    assert.deepEqual(writeArrayFactsCandidate(actual), before);
    assert.deepEqual(bytes, before, 'caller bytes retained');
  }
});
