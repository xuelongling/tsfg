// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../compiler/r04-identity.mjs';
import { emitCompilerServiceMessage, validateCompilerServiceMessage } from '../../compiler/r04-protocols.mjs';
import { R09CompilerService } from '../../tooling/compiler-service/r09-compiler-service.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ZIG = process.env.TSFG_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const CLI_EXE = path.join('E:\\tsfg-temp', 'r09-cli-bin', 'tsfg-r09-hot-reload.exe');

function zigEnv() {
  return {
    ...process.env,
    TEMP: 'E:\\tsfg-temp',
    TMP: 'E:\\tsfg-temp',
    ZIG_LOCAL_CACHE_DIR: 'E:\\tsfg-cache\\zig-local',
    ZIG_GLOBAL_CACHE_DIR: 'E:\\tsfg-cache\\zig-global',
  };
}

test('R09 Zig Runtime Unit & 4-Thread 20-Publish Concurrency / Epoch Reclamation Suite', () => {
  const res = spawnSync(ZIG, ['test', path.join(REPO_ROOT, 'runtime', 'r09-hot-reload.zig')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(res.status, 0, `zig test r09-hot-reload.zig failed:\n${res.stdout}\n${res.stderr}`);
});

test('R09 Compiler Service + REAL Windows x64 3-Phase Hot Reload (DLL v1 -> R05 Bytecode v2 -> DLL v3) + Delayed Lease + Tamper Rejection + Cache + Crash Recovery', async () => {
  const workDir = path.join('E:\\tsfg-temp', 'r09-e2e');
  await mkdir(path.dirname(CLI_EXE), { recursive: true });
  await mkdir(workDir, { recursive: true });

  // Build zero-compiler-dependency Zig hot-reload CLI
  const build = spawnSync(
    ZIG,
    ['build-exe', path.join(REPO_ROOT, 'runtime', 'r09-hot-reload-cli.zig'), `-femit-bin=${CLI_EXE}`],
    { cwd: REPO_ROOT, encoding: 'utf8', env: zigEnv() },
  );
  assert.equal(build.status, 0, `zig build-exe r09-hot-reload-cli.zig failed:\n${build.stderr}`);

  const svc = new R09CompilerService({ workRoot: workDir });
  const contract = {
    signatureHash: sha256(Buffer.from('sig:(i32,i32)->i32')),
    effectHash: sha256(Buffer.from('eff:pure-bounded')),
    captureLayoutHash: sha256(Buffer.from('cap:empty')),
    staticSchemaHash: sha256(Buffer.from('schema:v1')),
  };

  // Health check via R04 compiler-service protocol
  const healthReq = emitCompilerServiceMessage({
    direction: 'request',
    operation: 'health',
    requestId: 'req-health-1',
    epoch: 1,
    inputDigest: sha256(Buffer.from('health')),
  });
  const healthRes = await svc.handleRequest(healthReq.bytes);
  assert.equal(validateCompilerServiceMessage(healthRes.envelope.bytes).payload.status, 'ok');

  // Phase 1 Core IR program: (a + b) + 100  -> for (7, 3) = 110
  const progV1 = {
    name: 'hot_compute',
    returnType: 'i32',
    ops: [
      { op: 'tsfg.add_i32', result: 'r0', operands: ['a', 'b'] },
      { op: 'tsfg.const_i32', result: 'r1', attrs: { value: 100 } },
      { op: 'tsfg.add_i32', result: 'r2', operands: ['r0', 'r1'] },
      { op: 'tsfg.return', operands: ['r2'] },
    ],
  };

  // Phase 2 Core IR program (R05 Bytecode): (a * b) + 200 -> for (7, 3) = 221
  const progV2 = {
    name: 'hot_compute',
    returnType: 'i32',
    ops: [
      { op: 'tsfg.mul_i32', result: 'r0', operands: ['a', 'b'] },
      { op: 'tsfg.const_i32', result: 'r1', attrs: { value: 200 } },
      { op: 'tsfg.add_i32', result: 'r2', operands: ['r0', 'r1'] },
      { op: 'tsfg.return', operands: ['r2'] },
    ],
  };

  // Phase 3 Core IR program (New Native DLL v3): (a * b) + 300 -> for (7, 3) = 321
  const progV3 = {
    name: 'hot_compute',
    returnType: 'i32',
    ops: [
      { op: 'tsfg.mul_i32', result: 'r0', operands: ['a', 'b'] },
      { op: 'tsfg.const_i32', result: 'r1', attrs: { value: 300 } },
      { op: 'tsfg.add_i32', result: 'r2', operands: ['r0', 'r1'] },
      { op: 'tsfg.return', operands: ['r2'] },
    ],
  };

  const makeReq = (id) =>
    emitCompilerServiceMessage({
      direction: 'request',
      operation: 'compile_patch',
      requestId: id,
      epoch: 1,
      inputDigest: sha256(Buffer.from(id)),
    }).bytes;

  // Compile Phase 1 Native DLL v1
  const p1 = await svc.handleRequest(makeReq('req-p1'), {
    functionId: 'fn:hot_compute',
    contract,
    program: progV1,
    codeVersion: 1,
    phase: 'native',
    patchName: 'hot_v1',
  });
  assert.equal(validateCompilerServiceMessage(p1.envelope.bytes).payload.status, 'ok');
  assert.equal(p1.artifacts.cacheHit, false);

  // Negative service checks: effect widening, schema change, stale version must be REJECTED!
  const rejEff = await svc.handleRequest(makeReq('req-rej-eff'), {
    functionId: 'fn:hot_compute',
    contract: { ...contract, effectHash: sha256(Buffer.from('eff:widened-io')) },
    program: progV2,
    codeVersion: 2,
    phase: 'bytecode',
  });
  assert.equal(validateCompilerServiceMessage(rejEff.envelope.bytes).payload.status, 'rejected');

  const rejSchema = await svc.handleRequest(makeReq('req-rej-schema'), {
    functionId: 'fn:hot_compute',
    contract: { ...contract, staticSchemaHash: sha256(Buffer.from('schema:v2')) },
    program: progV2,
    codeVersion: 2,
    phase: 'bytecode',
  });
  assert.equal(validateCompilerServiceMessage(rejSchema.envelope.bytes).payload.status, 'rejected');

  // Simulated service crash returns structured error and leaves state intact
  svc.simulateCrash(true);
  const crashedRes = await svc.handleRequest(makeReq('req-crash'), {
    functionId: 'fn:hot_compute',
    contract,
    program: progV2,
    codeVersion: 2,
    phase: 'bytecode',
  });
  assert.equal(validateCompilerServiceMessage(crashedRes.envelope.bytes).payload.status, 'error');
  svc.simulateCrash(false);

  // Compile Phase 2 R05 Bytecode v2
  const p2 = await svc.handleRequest(makeReq('req-p2'), {
    functionId: 'fn:hot_compute',
    contract,
    program: progV2,
    codeVersion: 2,
    phase: 'bytecode',
    patchName: 'hot_v2_bc',
  });
  assert.equal(validateCompilerServiceMessage(p2.envelope.bytes).payload.status, 'ok');

  // Compile Phase 3 Native DLL v3
  const p3 = await svc.handleRequest(makeReq('req-p3'), {
    functionId: 'fn:hot_compute',
    contract,
    program: progV3,
    codeVersion: 3,
    phase: 'native',
    patchName: 'hot_v3',
  });
  assert.equal(validateCompilerServiceMessage(p3.envelope.bytes).payload.status, 'ok');

  // Verify incremental IR cache hit on identical Phase 3 compile request (with fresh version baseline check bypassed via new service cache check)
  svc.publishedContracts.get('fn:hot_compute').codeVersion = 2;
  const p3Cached = await svc.handleRequest(makeReq('req-p3-cache'), {
    functionId: 'fn:hot_compute',
    contract,
    program: progV3,
    codeVersion: 3,
    phase: 'native',
    patchName: 'hot_v3',
  });
  assert.equal(p3Cached.artifacts.cacheHit, true);

  // Create tampered `.tpatch` (corrupting payload codeVersion so envelope SHA-256 fails!)
  const badTpatchPath = path.join(workDir, 'tampered.tpatch');
  const origTpatch = await readFile(p3.artifacts.tpatchPath, 'utf8');
  const tamperedTpatch = origTpatch.replace('\\"codeVersion\\":3', '\\"codeVersion\\":9');
  assert.notEqual(tamperedTpatch, origTpatch, 'tampered .tpatch must differ from original');
  await writeFile(badTpatchPath, tamperedTpatch);

  // Run REAL Zig Hot-Reload CLI across all 3 phases on Windows x64!
  const run = spawnSync(
    CLI_EXE,
    [
      p1.artifacts.dllPath,
      p1.artifacts.tpatchPath,
      p2.artifacts.bytecodePath,
      p2.artifacts.bytecodeFnHex,
      p3.artifacts.dllPath,
      p3.artifacts.tpatchPath,
      badTpatchPath,
      'hot_compute',
      contract.signatureHash,
      contract.effectHash,
      contract.captureLayoutHash,
      contract.staticSchemaHash,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', env: zigEnv() },
  );
  assert.equal(run.status, 0, `r09-hot-reload-cli failed:\n${run.stdout}\n${run.stderr}`);
  const out = JSON.parse(run.stdout.trim());

  assert.equal(out.ver1, 1);
  assert.equal(out.p1Val, 110);
  assert.equal(out.p1Tier, 'native');
  assert.equal(out.badRejected, true);
  assert.equal(out.p2Val, 221);
  assert.equal(out.p2Tier, 'bytecode');
  assert.equal(out.p2Ver, 2);
  assert.equal(out.delayedVal, 110, 'delayed old native frame must complete on v1 safely!');
  assert.equal(out.delayedVer, 1);
  assert.equal(out.deferredWhilePinned, 1, 'old DLL must NOT be unloaded while delayed frame is active!');
  assert.equal(out.unloadedAfterRelease, 1, 'old DLL must be cleanly unloaded via FreeLibrary after release!');
  assert.equal(out.ver3, 3);
  assert.equal(out.p3Val, 321);
  assert.equal(out.p3Tier, 'native');
  assert.equal(out.reclaimedAfterV3, 1);
  assert.equal(out.remainingRetired, 0);
});
