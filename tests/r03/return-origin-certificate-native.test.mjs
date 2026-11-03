// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('pure symbolic receiver certificates compare complete equations and preserve rejection gates', async () => {
  await nativeUnit({ source: 'runtime/return-origin-certificate-test.zig', prefix: 'r03-return-origin-certificate-', expectedPasses: 16 });
});

test('pure structural receiver certificates preserve frames, complete joins and controlled gates', async () => {
  await nativeUnit({ source: 'runtime/wire-program-return-origin-frame-certificate-test.zig', prefix: 'r03-return-origin-frame-certificate-', expectedPasses: 11 });
});
