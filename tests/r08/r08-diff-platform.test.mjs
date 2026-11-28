// SPDX-License-Identifier: MIT
// R08 Differential Verification Platform Test Suite:
//   - Seeded Core IR generator across 5 targets (Oracle === VM unfused === VM fused === AOT /O0 === AOT /O2)
//   - Automatic minimal-reproducer delta reducer + record/replay artifact persistence
//   - Permanent checked-in miscompile regression corpus replay
//   - Separate relaxed domain comparators (fast-math / parallel-reduction / GPU)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { generateSeededProgram } from '../../tooling/diff-platform/r08-generator.mjs';
import { loadRegressionArtifact, recordRegressionArtifact, reduceFailingProgram } from '../../tooling/diff-platform/r08-reducer.mjs';
import { compareDomainRelaxedOutcomes, compareStrictOutcomes, runFiveWayDiff } from '../../tooling/diff-platform/r08-diff-runner.mjs';

const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const R05_VM_EXE = process.env.TSFG_R05_VM_EXE ?? 'E:\\tsfg-build\\r05\\tsfg-r05-vm.exe';
const R07_LOADER_EXE = process.env.TSFG_R07_LOADER_EXE ?? 'E:\\tsfg-build\\r07\\tsfg-r07-loader.exe';

async function ensureBinaries() {
  await mkdir(path.dirname(R05_VM_EXE), { recursive: true });
  await mkdir(path.dirname(R07_LOADER_EXE), { recursive: true });
  for (const [src, out] of [['r05-vm-cli.zig', R05_VM_EXE], ['r07-aot-loader.zig', R07_LOADER_EXE]]) {
    const res = spawnSync(ZIG_EXE, [
      'build-exe', src,
      '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
      `-femit-bin=${out}`,
    ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(res.status, 0, `zig build-exe ${src} failed:\n${res.stderr.toString('utf8')}`);
  }
}

test('R08 5-Way Seeded Differential Campaign (Oracle === VM unfused === VM fused === AOT /O0 === AOT /O2)', async () => {
  await ensureBinaries();
  const workDir = 'E:\\tsfg-temp\\r08-diff-work';
  try {
    // 10 diverse deterministic seeds: 7 i32 (incl. INT32_MIN/-1 & div-zero traps!) + 3 strict f64 (incl. NaN/Inf/subnormal)
    const cases = [
      { arg0: 17, arg1: -5, kind: 'i32', seed: 101 },
      { arg0: -2147483648, arg1: -1, kind: 'i32', seed: 102 },
      { arg0: 2147483647, arg1: 0, kind: 'i32', seed: 103 },
      { arg0: -999999, arg1: 12345, kind: 'i32', seed: 104 },
      { arg0: 42, arg1: 42, kind: 'i32', seed: 105 },
      { arg0: 0, arg1: -1, kind: 'i32', seed: 106 },
      { arg0: 1337, arg1: -7, kind: 'i32', seed: 107 },
      { arg0: '3ff8000000000000', arg1: '0000000000000000', kind: 'f64', seed: 201 }, // 1.5, +0.0
      { arg0: '0000000000000000', arg1: '8000000000000000', kind: 'f64', seed: 202 }, // +0.0, -0.0 -> canonical NaN!
      { arg0: '0000000000000001', arg1: '3ff0000000000000', kind: 'f64', seed: 203 }, // min subnormal, 1.0
    ];

    for (const c of cases) {
      const prog = generateSeededProgram(c.seed, { kind: c.kind, length: 6 });
      const res = await runFiveWayDiff(prog, c.arg0, c.arg1, {
        r05VmExe: R05_VM_EXE,
        r07LoaderExe: R07_LOADER_EXE,
        workDir,
      });
      assert.equal(
        res.verdict.ok,
        true,
        `Seed ${c.seed} (${c.kind}) failed 5-way differential check: ${res.verdict.mismatches.join('; ')}`,
      );
    }

    // Replay permanent checked-in regression artifact across all 5 targets!
    const regPath = path.resolve('tests/fixtures/r08/regressions/min-int-rem-and-div-regression.json');
    const reg = await loadRegressionArtifact(regPath);
    const replay = await runFiveWayDiff(reg.program, reg.arg0, reg.arg1, {
      r05VmExe: R05_VM_EXE,
      r07LoaderExe: R07_LOADER_EXE,
      workDir,
    });
    assert.equal(replay.verdict.ok, true, `Permanent regression replay failed: ${replay.verdict.mismatches.join('; ')}`);
    assert.deepEqual(replay.oracle, reg.expectedOracle);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('R08 Automatic Delta Reducer minimizes a 16-op failing program and persists verified record/replay artifact', async () => {
  const big = generateSeededProgram(777, { kind: 'i32', length: 14 });
  // Inject a targeted operation deep inside the program and simulate a backend bug predicate on `tsfg.rem_i32`
  big.functions[0].ops.splice(8, 0, { op: 'tsfg.rem_i32', result: 'buggy_rem', type: 'i32', attrs: {}, operands: ['a', 'b'] });
  const syntheticBugPredicate = async (cand) => cand.functions[0].ops.some((o) => o.op === 'tsfg.rem_i32');

  const red = await reduceFailingProgram(big, syntheticBugPredicate);
  assert.ok(red.originalOpCount >= 16);
  assert.ok(red.reducedOpCount <= 4, `expected delta reducer to shrink to <= 4 ops, got ${red.reducedOpCount}`);
  assert.ok(red.reduced.functions[0].ops.some((o) => o.op === 'tsfg.rem_i32'));

  // Persist & reload record/replay artifact
  const tmpFile = 'E:\\tsfg-temp\\r08-reduced-repro.json';
  try {
    const rec = await recordRegressionArtifact(tmpFile, {
      arg0: -2147483648,
      arg1: -1,
      category: 'synthetic-reducer-test',
      description: 'Minimized rem_i32 reproducer',
      expectedOracle: { kind: 'i32', trap: 0, value: 0 },
      program: red.reduced,
      seed: 777,
    });
    const loaded = await loadRegressionArtifact(tmpFile);
    assert.equal(loaded.recordHash, rec.recordHash);
    assert.equal(loaded.program.functions[0].ops.length, red.reducedOpCount);
  } finally {
    await rm(tmpFile, { force: true });
  }
});

test('R08 Strict vs Relaxed Domain Comparators remain strictly separated', () => {
  // 1. Strict comparator MUST fail if both backends agree on a WRONG answer vs Oracle!
  const oracleWrongBoth = compareStrictOutcomes(
    { kind: 'i32', trap: 0, value: 42 },
    { aot_o2: { trap: 0, value: 99 }, vm_fused: { trap: 0, value: 99 } },
  );
  assert.equal(oracleWrongBoth.ok, false);
  assert.equal(oracleWrongBoth.mismatches.length, 2);

  // 2. Fast-math / parallel-reduction / GPU domain comparators enforce explicit tolerances
  const fmOk = compareDomainRelaxedOutcomes(1.0000001, 1.0000002, { absTolerance: 1e-6, domain: 'fast-math' });
  assert.equal(fmOk.ok, true);
  const fmBad = compareDomainRelaxedOutcomes(1.0, 1.01, { absTolerance: 1e-6, domain: 'fast-math' });
  assert.equal(fmBad.ok, false);

  const parOk = compareDomainRelaxedOutcomes(1000.0, 1000.0001, { domain: 'parallel-reduction', relTolerance: 1e-6 });
  assert.equal(parOk.ok, true);

  const gpuNanBad = compareDomainRelaxedOutcomes(1.0, NaN, { allowNanBoth: true, absTolerance: 1e-5, domain: 'gpu' });
  assert.equal(gpuNanBad.ok, false);
});
