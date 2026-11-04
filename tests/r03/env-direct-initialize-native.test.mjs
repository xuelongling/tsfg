// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('direct environment allocation results initialize each slot once', async () => {
  await nativeUnit({ source: 'runtime/env-direct-initialize-literal-test.zig', prefix: 'r03-env-direct-initialize-', expectedPasses: 7 });
});
