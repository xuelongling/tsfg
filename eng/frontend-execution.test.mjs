// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runLockedFrontend } from '../compiler/frontend-execution.mjs';
import { analyzeFrontend } from '../compiler/frontend.mjs';

const declaration = await readFile(new URL('../compiler/minimal-scalars-v2.d.ts', import.meta.url), 'utf8');
const input = { sourceRoot: '/src', rootFile: '/src/main.ts',
  files: [{ path: '/src/main.ts', content: 'function entry(): i32 { return 0; }' },
    { path: '/src/minimal-scalars-v2.d.ts', content: declaration }],
  declarations: { version: 'minimal-scalars-v2', paths: ['/src/minimal-scalars-v2.d.ts'] },
  config: { strict: true, noEmit: true, allowJs: false } };
// These are identity/availability negative tests. They never execute Source,
// create an executable, inject a lock/runner, or claim a real Source success.
test('locked Source boundary preserves required and unavailable executable messages', async () => {
  assert.deepEqual(await runLockedFrontend('{}'), { status: 'tool-error', message: 'frontend executable is required' });
  const missing = fileURLToPath(new URL('./fixtures/frontend-execution-missing-never-created.exe', import.meta.url));
  assert.deepEqual(await runLockedFrontend('{}', { executable: missing }),
    { status: 'tool-error', message: 'frontend executable is unavailable' });
});
test('locked Source boundary rejects an actual unlocked file before process execution', async () => {
  assert.deepEqual(await runLockedFrontend('{}', { executable: fileURLToPath(import.meta.url) }),
    { status: 'tool-error', message: 'frontend executable differs from locked source build' });
});
test('Snapshot adapter keeps tool failure shape and owned input identity after extraction', async () => {
  const missing = await analyzeFrontend(input);
  assert.equal(missing.status, 'tool-error'); assert.equal(missing.message, 'frontend executable is required');
  assert.match(missing.inputIdentity, /^sha256:[0-9a-f]{64}$/);
  const mismatch = await analyzeFrontend(input, { executable: fileURLToPath(import.meta.url) });
  assert.equal(mismatch.status, 'tool-error');
  assert.equal(mismatch.message, 'frontend executable differs from locked source build');
  assert.equal(mismatch.inputIdentity, missing.inputIdentity);
});
test('Snapshot input rejection remains earlier than any locked execution attempt', async () => {
  const invalid = structuredClone(input); invalid.config.strict = false;
  const result = await analyzeFrontend(invalid, { executable: fileURLToPath(import.meta.url) });
  assert.equal(result.status, 'error'); assert.equal(result.diagnostics[0].code, 'r02b-d-input');
});
