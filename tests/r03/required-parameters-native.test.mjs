// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('Source3 required constructor parameters preserve the strict no-initializer subset and Pending boundaries', async () => {
  await nativeUnit({ source: 'runtime/wire-program-required-parameters-test.zig', prefix: 'r03-required-parameters-', expectedPasses: 9 });
});
