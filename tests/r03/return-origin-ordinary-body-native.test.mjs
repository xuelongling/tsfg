// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('ordinary Body reference, scalar, String and absence aliases preserve actual data, copy heaps and strict rejection boundaries', async () => {
  await nativeUnit({ source: 'runtime/return-origin-ordinary-body-test.zig', prefix: 'r03-return-origin-ordinary-body-', expectedPasses: 16 });
});
