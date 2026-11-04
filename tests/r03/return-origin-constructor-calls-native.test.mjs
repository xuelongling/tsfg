// SPDX-License-Identifier: MIT
import test from 'node:test';
import { nativeUnit } from './native-unit.mjs';

test('fixed constructor calls retain frame identity and complete callee evidence', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-test.zig', prefix: 'r03-constructor-calls-', expectedPasses: 6 });
});

test('constructor call analysis keeps one owning arena after return and failure', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-lifetime-test.zig', prefix: 'r03-constructor-call-lifetime-', expectedPasses: 2 });
});

test('constructor call certificates preserve both site and frame relations', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-certificate-test.zig', prefix: 'r03-constructor-call-certificate-', expectedPasses: 5 });
});

test('typed constructor bodies retain their real call frame and native prefix', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-body-test.zig', prefix: 'r03-constructor-call-body-', expectedPasses: 2 });
});

test('fixed constructor owner payloads retain original frames and initialized contents', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-owners-test.zig', prefix: 'r03-constructor-call-owners-', expectedPasses: 1 });
});

test('constructor owner imports keep full permissions, separate completions, and pending boundaries', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-call-owners-negative-test.zig', prefix: 'r03-constructor-call-owners-negative-', expectedPasses: 5 });
});

test('typed scalar constructor arguments retain their original initialized payload', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-scalar-argument-test.zig', prefix: 'r03-constructor-scalar-argument-', expectedPasses: 1 });
});

test('scalar constructor arguments retain caller input identity', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-scalar-formal-test.zig', prefix: 'r03-constructor-scalar-formal-', expectedPasses: 1 });
});

test('scalar constructor arguments respect typed boundaries and full effect permissions', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-scalar-negative-test.zig', prefix: 'r03-constructor-scalar-negative-', expectedPasses: 4 });
});

test('ordered scalar constructor arguments retain each original caller input', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-multi-scalar-test.zig', prefix: 'r03-constructor-multi-scalar-', expectedPasses: 1 });
});

test('each scalar constructor argument keeps its typed and complete effect boundary', async () => {
  await nativeUnit({ source: 'runtime/return-origin-constructor-multi-scalar-negative-test.zig', prefix: 'r03-constructor-multi-scalar-negative-', expectedPasses: 3 });
});
