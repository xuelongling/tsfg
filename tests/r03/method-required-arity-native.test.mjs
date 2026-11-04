// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('reference method projections cannot add required parameters', async () => {
  await nativeUnit({ source: 'runtime/method-required-arity-literal-test.zig', prefix: 'r03-method-required-arity-', expectedPasses: 7 });
});
