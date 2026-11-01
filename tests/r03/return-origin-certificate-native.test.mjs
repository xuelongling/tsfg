// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('pure symbolic receiver certificates compare complete equations and preserve rejection gates', async () => {
  await nativeUnit({ source: 'runtime/return-origin-certificate-test.zig', prefix: 'r03-return-origin-certificate-', expectedPasses: 8 });
});
