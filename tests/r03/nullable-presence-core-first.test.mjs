// SPDX-License-Identifier: MIT
// Four complete Core golden strings were authored independently of the emitter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyNullableHir } from '../../compiler/nullable-hir.mjs';
import { emitNullableCore } from '../../compiler/nullable-core-emitter.mjs';

const fixtureSHA = 'sha256:36d4c3e469536da1bca2ff44b1fdf8273077e653539163344d185114d04ceb37';
const fixtureBytes = 45300;
const names = ['mask1-undefined', 'mask2-null', 'mask3-null-undefined', 'mask3-undefined-null'];
/** @param {any} value @returns {string} */
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcs).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + jcs(value[key])).join(',') + '}';
}
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const fresh = value => JSON.parse(jcs(value));

test('nullable presence Core complete four golden strings FIRST', async t => {
  const hirRaw = readFileSync(new URL('./nullable-presence-hir-first.json', import.meta.url));
  assert.equal(hirRaw.length, 762638);
  assert.equal(sha(hirRaw), 'sha256:4b70ae12a6e499e2b08007a84bfb1c09f161053fad71ac8ddd61d6e5bdf28bd3');
  const hirs = JSON.parse(hirRaw.toString('utf8'));
  const raw = readFileSync(new URL('./nullable-presence-core-first.json', import.meta.url));
  assert.equal(raw.length, fixtureBytes); assert.equal(sha(raw), fixtureSHA);
  const fixture = JSON.parse(raw.toString('utf8'));
  assert.equal(JSON.stringify(fixture) + '\n', raw.toString('utf8'));
  assert.deepStrictEqual(hirs.cases.map(row => row.name), names);
  assert.deepStrictEqual(fixture.cases.map(row => row.name), names);
  // All four complete HIR4 positive controls finish before the FIRST emitter
  // call. This distinguishes a consumer gap from a rejected HIR input.
  for (let index = 0; index < names.length; index++) {
    const row = hirs.cases[index], golden = fixture.cases[index];
    assert.deepStrictEqual(golden.context, row.context);
    assert.equal(golden.expectedHirSHA256, sha(row.hirJcsNoLf));
    assert.equal(jcs(row.expectedHir), row.hirJcsNoLf);
    assert.equal(typeof golden.expectedCore, 'string');
    assert.equal(Buffer.byteLength(golden.expectedCore), golden.expectedCoreBytes);
    assert.equal(sha(golden.expectedCore), golden.expectedCoreSHA256);
    assert.ok(golden.expectedCore.endsWith('\n'));
    const actual = verifyNullableHir(JSON.parse(row.hirJcsNoLf), fresh(row.context));
    assert.deepStrictEqual(actual, row.expectedHir); assert.equal(jcs(actual), row.hirJcsNoLf);
    t.diagnostic('TSFG_20N_HIR_WHOLE_CONTROL_COMPLETE ' + row.name);
  }
  t.diagnostic('TSFG_20N_ALL_FOUR_HIR_WHOLE_CONTROLS_COMPLETE');
  for (let index = 0; index < names.length; index++) {
    const row = hirs.cases[index], golden = fixture.cases[index];
    await t.test('whole Core bytes/' + row.name, () => {
      // Preserve natural BASE/context-only refusals; never turn them into a
      // passing throws test or an implementation-generated golden snapshot.
      t.diagnostic('TSFG_20N_EMITTER_REACHED ' + row.name);
      const actual = emitNullableCore(fresh(row.expectedHir), fresh(row.context));
      assert.equal(actual, golden.expectedCore);
      assert.equal(Buffer.byteLength(actual), golden.expectedCoreBytes);
      assert.equal(sha(actual), golden.expectedCoreSHA256);
      assert.deepStrictEqual(Buffer.from(actual), Buffer.from(golden.expectedCore));
      t.diagnostic('TSFG_20N_WHOLE_CORE_COMPLETE ' + row.name);
    });
  }
});
