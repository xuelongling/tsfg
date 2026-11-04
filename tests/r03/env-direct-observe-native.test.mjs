// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('direct environment observations require initialized cells', async () => {
  await nativeUnit({ source: 'runtime/env-direct-observe-literal-test.zig', prefix: 'r03-env-direct-observe-', expectedPasses: 7 });
});
