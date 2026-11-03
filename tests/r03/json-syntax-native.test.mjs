// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('protocol JSON syntax and caller arena cleanup pass the native unit suite', async () => {
  await nativeUnit({ source: 'runtime/wire18-json-reader-test.zig', prefix: 'r03-json-syntax-', expectedPasses: 15 });
});
