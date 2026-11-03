// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('passive entry roles preserve conservative actual values and reject invalid selectors', async () => {
  await nativeUnit({ source: 'runtime/wire-program-entry-role-test.zig', prefix: 'r03-passive-entry-role-', expectedPasses: 4 });
});
