// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('saved owned payloads retain complete copies and full call effects', async () => {
  await nativeUnit({ source: 'runtime/return-origin-owned-payload-test.zig', prefix: 'r03-owned-payload-', expectedPasses: 9 });
});

test('saved closure payloads retain both completion contents and all nested effects', async () => {
  await nativeUnit({ source: 'runtime/return-origin-owned-closure-payload-test.zig', prefix: 'r03-owned-closure-payload-', expectedPasses: 1 });
});
