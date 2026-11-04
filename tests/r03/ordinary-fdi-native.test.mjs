// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('ordinary direct FDI binds independent raw ABI and fixed parameter metadata', async () => {
  await nativeUnit({ source: 'runtime/ordinary-fdi-metadata-literal-test.zig', prefix: 'r03-ordinary-fdi-', expectedPasses: 5 });
});
