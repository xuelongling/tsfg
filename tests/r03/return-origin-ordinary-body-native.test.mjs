// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('ordinary Body local Span and incoming-function aliases preserve opaque Data without borrow or Code+ENV qualification', async () => {
  await nativeUnit({ source: 'runtime/return-origin-ordinary-body-test.zig', prefix: 'r03-return-origin-ordinary-body-', expectedPasses: 30 });
});
