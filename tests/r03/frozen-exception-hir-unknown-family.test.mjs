// SPDX-License-Identifier: MIT
// Run after the unchanged first+953c95 boundary controls; no new semantic oracle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readHir } from '../../compiler/hir.mjs';

// Only unambiguously new tags are negative. Existing exception, nullable,
// closure and the separately served reference family are not classified here.
const inputs = [
  ['unknownTag', '{"format":{"family":"tsfg.unknown-hir-candidate"}}\n'],
  ['unknownVersionTag', '{"format":{"family":"tsfg.exception-hir-candidate.v2"}}\n'],
  ['escapedUnknownTag', '{"format":{"family":"tsfg.\\u0075nknown-hir-candidate"}}\n'],
];
test('unknown root HIR family cannot enter legacy whole-object parsing', async t => {
  for (const [name, text] of inputs) await t.test(name, () => {
    const bytes = Buffer.from(text), before = Buffer.from(bytes), original = JSON.parse;
    let graphParses = 0, error;
    JSON.parse = function (value, reviver) {
      // String-token JSON decoding is permitted; full objects/arrays are not.
      if (typeof value === 'string' && /^[\x20\t\r\n]*[\[{]/.test(value)) graphParses++;
      return original(value, reviver);
    };
    try { readHir(bytes); } catch (failure) { error = failure; }
    finally { JSON.parse = original; }
    assert.equal(JSON.parse, original, 'temporary observation always restores');
    assert.ok(error instanceof TypeError, 'unknown family is rejected');
    assert.match(error.message, /r03-/);
    assert.equal(graphParses, 0, 'unknown string tag must not fall through to legacy JSON.parse');
    assert.deepEqual(bytes, before, 'caller bytes unchanged');
  });
});
