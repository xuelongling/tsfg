// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('fixed method target namespaces preserve initialization witnesses and complete caller effects', async () => {
  await nativeUnit({ source: 'runtime/return-origin-method-owners-test.zig', prefix: 'r03-method-return-owners-', expectedPasses: 6 });
});
