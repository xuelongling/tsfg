// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('fixed lexical ENV return owners preserve saved heaps full uppers and paired functions', async () => {
  await nativeUnit({ source: 'runtime/return-origin-lexical-owners-test.zig', prefix: 'r03-return-origin-lexical-owners-', expectedPasses: 10 });
});

test('fixed capture transfer preserves caller permissions and pending aggregate contents', async () => {
  await nativeUnit({ source: 'runtime/wire-program-effects-check.zig', prefix: 'r03-fixed-capture-effects-', expectedPasses: 13 });
});
