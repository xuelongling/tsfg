// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('ordinary Body aliases preserve typed Data and local Span transport without a borrow qualification', async () => {
  await nativeUnit({ source: 'runtime/return-origin-ordinary-body-test.zig', prefix: 'r03-return-origin-ordinary-body-', expectedPasses: 27 });
});
