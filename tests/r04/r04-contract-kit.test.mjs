// SPDX-License-Identifier: MIT
// R04 Pillar 6: Standalone Contract Test Kit, Golden Fixtures, Old-Version Fixtures,
// Deterministic Fuzz Mutation Corpus (JS + Zig Runtime), and RF-01 Verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runContractKit } from '../../tooling/contract-kit/r04-contract-kit.mjs';
import { ensureR04ValidatorExe } from './r04-test-helpers.mjs';

const VM_EXE = process.env.TSFG_VM_EXE ?? 'E:\\tsfg-build\\vm\\tsfg-runtime.exe';

test('R04 Standalone Contract Test Kit: registry, golden fixtures, old-version rejection, JS+Zig fuzzing, and RF-01', async () => {
  const validatorExe = await ensureR04ValidatorExe();
  const report = await runContractKit({
    validatorExe,
    vmExe: VM_EXE,
  });

  assert.equal(report.registryVerified, 9, 'all 9 registered contract families verified');
  assert.equal(report.goldenPassed, 7, 'all 7 R04 golden fixtures passed in JS and Zig Runtime');
  assert.equal(report.oldVersionRejected, 7, 'all 6 old R04 envelopes + old-v11.tbc cleanly rejected');
  assert.ok(report.fuzzRejected >= 150, `expected >= 150 fuzz cases rejected cleanly, got ${report.fuzzRejected}`);
  assert.equal(report.rf01Verified, true, 'RF-01 dual-directory Reflection Digest verified');
});
