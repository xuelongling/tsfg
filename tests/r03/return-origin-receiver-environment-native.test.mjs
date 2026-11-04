// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('receiver lexical ENV bodies retain typed logical inputs and complete heap control equations', async () => {
  await nativeUnit({ source: 'runtime/return-origin-receiver-env-body-test.zig', prefix: 'r03-receiver-env-body-', expectedPasses: 4 });
});

test('receiver lexical ENV certificates retain complete structure and source identities', async () => {
  await nativeUnit({ source: 'runtime/return-origin-receiver-env-certificate-test.zig', prefix: 'r03-receiver-env-certificate-', expectedPasses: 3 });
});

test('receiver owner relations retain ENV slots and symbolic constructor identities', async () => {
  await nativeUnit({ source: 'runtime/return-origin-receiver-env-owners-test.zig', prefix: 'r03-receiver-env-owners-', expectedPasses: 6 });
});
