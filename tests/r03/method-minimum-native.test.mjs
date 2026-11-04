// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('explicit method minima bind complete semantic, ABI and fixed metadata', async () => {
  await nativeUnit({ source: 'runtime/method-explicit-minimum-literal-test.zig', prefix: 'r03-method-explicit-minimum-', expectedPasses: 11 });
});

test('inherited selected methods preserve complete signatures and original proof origins', async () => {
  await nativeUnit({ source: 'runtime/method-inherited-minimum-literal-test.zig', prefix: 'r03-method-inherited-minimum-', expectedPasses: 6 });
});

test('direct nominal methods independently satisfy the static view', async () => {
  await nativeUnit({ source: 'runtime/method-nominal-minimum-literal-test.zig', prefix: 'r03-method-nominal-minimum-', expectedPasses: 3 });
});
