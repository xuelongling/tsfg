// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { numericTokenSyntax, floatBits } from '../../compiler/float.mjs';
import { sha256 } from '../../compiler/identity.mjs';
test('shared numeric syntax retains the 54 independently frozen float literal results', async () => {
  const bytes = await readFile(new URL('./fixtures/exact-float-oracle.PREPARED.json', import.meta.url));
  assert.equal(sha256(bytes), 'sha256:ac59c356703cd3e309b0e9f6ab076c0d06d823bc7830310384a8de819f438e94');
  const oracle = JSON.parse(bytes.toString('utf8')); assert.equal(oracle.cases.length, 54);
  for (const item of oracle.cases) {
    if (item.expected.kind === 'compile-reject-finite-overflow')
      assert.throws(() => floatBits(item.literal, item.type), RangeError, item.id);
    else assert.equal(floatBits(item.literal, item.type), item.expected.rawBits, item.id);
  }
});
test('numeric syntax validates complete decimal exponent separator and radix tokens without choosing a representation', () => {
  for (const token of ['0','1.','.5','1.5','1_000.0_1','1e+2','1e-1000','1e1000','0x1a','0XFF','0b10_01','0o7_1'])
    assert.doesNotThrow(() => numericTokenSyntax(token), token);
  for (const token of ['','0x','1abc','1__0','_1','1_','1e','1e+','1e_2','1._0','0b2','0o8','0x_1','1 2','Infinity','NaN'])
    assert.throws(() => numericTokenSyntax(token), TypeError, token);
  assert.doesNotThrow(() => numericTokenSyntax('1e1000'));
  assert.throws(() => floatBits('1e1000', 'f64'), RangeError);
  assert.equal(floatBits('-0.0', 'f64'), '8000000000000000');
});
