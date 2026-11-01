// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('pure symbolic construction Domain preserves native initialization and rejects unproved stores', async () => {
  await nativeUnit({ source: 'runtime/return-origin-construction-test.zig', prefix: 'r03-return-origin-construction-', expectedPasses: 8 });
});
