// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('module initializer enforces initialize-once before explicit global observation', async () => {
  await nativeUnit({ source: 'runtime/module-initialized-state-test.zig', prefix: 'r03-module-initialized-state-', expectedPasses: 10 });
});
