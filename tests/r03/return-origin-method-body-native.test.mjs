// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('method bodies retain receiver prefixes, dispatch continuations, and initializer guards', async () => {
  await nativeUnit({ source: 'runtime/return-origin-method-body-test.zig', prefix: 'r03-method-body-', expectedPasses: 6 });
});
