// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('conditional constructor births preserve every original reference', async () => {
  await nativeUnit({ source: 'runtime/constructor-conditional-birth-literal-test.zig', prefix: 'r03-constructor-conditional-birth-', expectedPasses: 8 });
});

test('typed conditional constructor branches retain complete certificates', async () => {
  await nativeUnit({ source: 'runtime/constructor-conditional-birth-typed-test.zig', prefix: 'r03-constructor-conditional-typed-', expectedPasses: 1 });
});
