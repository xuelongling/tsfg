// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('passive Common18 data decoding owns bytes and rejects ABI directory mismatches', async () => {
  await nativeUnit({ source: 'runtime/wire-program-decoder-data-test.zig', prefix: 'r03-passive-decoder-', expectedPasses: 5 });
});
