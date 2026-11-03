// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('passive Common18 heap facts stabilize and target analysis reaches a fixed point', async () => {
  await nativeUnit({ source: 'runtime/wire-program-facts-stability-test.zig', prefix: 'r03-passive-facts-stability-', expectedPasses: 3 });
});
