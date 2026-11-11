// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('module initializer checks reachable Global access in a known direct callee', async () => {
  await nativeUnit({ source: 'runtime/module-call-initialized-state-test.zig', prefix: 'r03-module-call-initialized-', expectedPasses: 19 });
});
