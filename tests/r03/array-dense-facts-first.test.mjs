// SPDX-License-Identifier: MIT
// Independently frozen private4 migration; original private3 publications stay retired.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readArrayFactsCandidate, writeArrayFactsCandidate } from '../../compiler/array-facts.mjs';
import { fixtures,jcs,sha } from './array-test-fixtures.mjs';

test('25d public facts reader preserves every independent private4 old-eight package', async t => {
  const rows=await fixtures();assert.equal(rows.length,8);
  for (const {facts:row} of rows) {
    const bytes=Buffer.from(row.packageText),before=Buffer.from(bytes);
    assert.equal(bytes.length,row.packageBytes);assert.equal(sha(bytes),row.packageSHA256);
    const expected=JSON.parse(row.packageText);
    assert.equal(jcs(expected)+'\n',row.packageText);assert.equal(expected.version,7);
    t.diagnostic('25d PUBLIC_FACTS_READER_REACHED '+row.name);
    const actual=readArrayFactsCandidate(bytes);
    assert.deepEqual(actual,expected,row.name+' complete independent package');
    assert.deepEqual(writeArrayFactsCandidate(actual),before);
    assert.deepEqual(bytes,before,'caller bytes retained');
  }
});
