// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('passive SourcePlan correspondence preserves actual data origins and views', async () => {
  await nativeUnit({ source: 'runtime/wire-program-source-correspondence-test.zig', prefix: 'r03-source-correspondence-', expectedPasses: 12 });
});
