// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('pure symbolic construction Domain preserves initialization and formal receiver-control completions', async () => {
  await nativeUnit({ source: 'runtime/return-origin-construction-test.zig', prefix: 'r03-return-origin-construction-', expectedPasses: 30 });
});

// Separate Body APIs: these checks do not grant full-refcheck or admission coverage.
test('pure checked receiver Body APIs preserve return and effect prefixes and Pending boundaries', async () => {
  await nativeUnit({ source: 'runtime/return-origin-body-test.zig', prefix: 'r03-return-origin-body-', expectedPasses: 3 });
});

// Captured metadata covers Body projection; it grants no Domain or VM admission.
test('checked Source3 Body preserves actual receiver data behind an unarchived SSA view', async () => {
  await nativeUnit({ source: 'runtime/return-origin-source3-body-view-test.zig', prefix: 'r03-return-origin-source3-body-view-', expectedPasses: 1 });
});

test('pure child-frame construction Domain retains universal targets and proves inactive completion roots', async () => {
  await nativeUnit({ source: 'runtime/return-origin-child-construction-test.zig', prefix: 'r03-return-origin-child-construction-', expectedPasses: 15 });
});

test('checked reference Data aliases preserve complete certificate copy and rejection boundaries', async () => {
  await nativeUnit({ source: 'runtime/return-origin-certificate-view-test.zig', prefix: 'r03-return-origin-certificate-view-', expectedPasses: 6 });
});
