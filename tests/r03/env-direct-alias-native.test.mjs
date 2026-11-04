// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('typed Env aliases preserve initialization once and TDZ across transparent forwarding', async () => {
  await nativeUnit({ source: 'runtime/env-direct-alias-literal-test.zig', prefix: 'r03-env-direct-alias-', expectedPasses: 45 });
});
