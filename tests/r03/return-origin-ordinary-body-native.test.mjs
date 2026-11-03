// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('ordinary Body local Span and incoming-function aliases preserve opaque Data without borrow or Code+ENV qualification', async () => {
  await nativeUnit({ source: 'runtime/return-origin-ordinary-body-test.zig', prefix: 'r03-return-origin-ordinary-body-', expectedPasses: 30 });
});

test('ordinary hidden lexical ENV retains logical parameters and explicit copy heaps', async () => {
  await nativeUnit({ source: 'runtime/return-origin-lexical-body-test.zig', prefix: 'r03-return-origin-lexical-body-', expectedPasses: 1 });
});

test('ordinary lexical ENV operations preserve parents slots code pairs and call completions', async () => {
  await nativeUnit({ source: 'runtime/return-origin-lexical-operations-test.zig', prefix: 'r03-return-origin-lexical-operations-', expectedPasses: 5 });
});
