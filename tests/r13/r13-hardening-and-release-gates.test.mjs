// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  auditCompatibilityMatrixAndMigrate,
  auditRuntimeDependencyClosure,
  auditSpdxAndGenerateSbom,
  signAndVerifyReleaseBundle,
  verifyReproducibleDualDirBuild,
} from '../../tooling/release/r13-release-audit.mjs';
import { buildWindowsX64ProductSdk } from '../../eng/build-windows-sdk.mjs';
import { resolveTempDir } from '../../compiler/tsfg-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const DELIVERED_FILES = [
  'compiler/r04-identity.mjs',
  'compiler/r04-abi.mjs',
  'compiler/r04-bindgen.mjs',
  'compiler/r04-protocols.mjs',
  'compiler/r05-bytecode-lower.mjs',
  'compiler/r07-tsfg-dialect.mjs',
  'compiler/r07-aot-backend.mjs',
  'compiler/r10-ecs-query-compiler.mjs',
  'compiler/r11-gpu-kernel-compiler.mjs',
  'runtime/r04-identity.zig',
  'runtime/r04-abi.zig',
  'runtime/r04-protocols.zig',
  'runtime/r05-bytecode.zig',
  'runtime/r05-vm.zig',
  'runtime/r06-gen-gc.zig',
  'runtime/r06-runtime.zig',
  'runtime/r07-aot-loader.zig',
  'runtime/r09-hot-reload.zig',
  'runtime/r10-ecs-jobs.zig',
  'runtime/r11-vulkan-gpu.zig',
  'tooling/contract-kit/r04-contract-kit.mjs',
  'tooling/diff-platform/r08-generator.mjs',
  'tooling/diff-platform/r08-reducer.mjs',
  'tooling/diff-platform/r08-diff-runner.mjs',
  'tooling/compiler-service/r09-compiler-service.mjs',
  'tooling/r12-project-and-pkg.mjs',
  'tooling/lsp/r12-tsfg-lsp.mjs',
  'tooling/debugger/r12-inspector-debugger.mjs',
  'tooling/release/r13-release-audit.mjs',
];

test('R13 Runtime Zero-Compiler-Dependency Closure Audit (Source Imports + Real PE32+ Import Table Inspection)', async () => {
  const audit = await auditRuntimeDependencyClosure(REPO_ROOT);
  assert.ok(audit.auditedFiles.length >= 12, `expected >= 12 runtime .zig files, audited ${audit.auditedFiles.length}`);
  assert.ok(audit.binaryAudits.length >= 2, `expected >= 2 shipping runtime PE32+ binaries audited, got ${audit.binaryAudits.length}`);
  assert.equal(audit.ok, true, `Runtime dependency closure violations: ${JSON.stringify(audit.violations)}`);
});

test('R13 Full-Repo SPDX License Header Audit, NOTICE File & Valid SPDX 2.3 SBOM Generation', async () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'NOTICE')), 'Top-level NOTICE file must exist');
  const res = await auditSpdxAndGenerateSbom(REPO_ROOT);
  assert.equal(res.ok, true, `Missing SPDX headers: ${res.missingSpdx.join(', ')}`);
  assert.equal(res.sbom.spdxVersion, 'SPDX-2.3');
  assert.ok(typeof res.sbom.creationInfo.created === 'string' && res.sbom.creationInfo.created.endsWith('Z'));
  assert.ok(res.sbom.files.length >= DELIVERED_FILES.length, `expected full-repo scan >= ${DELIVERED_FILES.length}, got ${res.sbom.files.length}`);
  assert.ok(res.sbomDigest.startsWith('sha256:'));
});

test('R13 Dual-Directory Reproducible Build Proof, Cross-Version Compatibility/Migration & Ed25519 Provenance Signing', async () => {
  const repro = await verifyReproducibleDualDirBuild(resolveTempDir('r13-repro'));
  assert.equal(repro.identical, true, 'Dual-directory builds MUST be byte-for-byte identical!');
  assert.equal(repro.digestA, repro.digestB);

  const compat = await auditCompatibilityMatrixAndMigrate(REPO_ROOT, repro.tpkgBytes);
  assert.ok(compat.registeredFamilies.length >= 9);
  assert.equal(compat.migratedVersion, '1.1.0');
  assert.equal(compat.rolledBackVersion, '1.0.0');

  const signed = signAndVerifyReleaseBundle({
    contractSetId: compat.contractSetId,
    reproducibleDigest: repro.digestA,
    target: compat.target,
    windowsFunctionalComplete: true,
    certifiedReleasePendingExternal: ['win11-24h2-min-vm', 'linux-debian12-matrix', 'multi-vendor-physical-gpu', 'external-code-sign-cert'],
  });
  assert.equal(signed.valid, true);
  assert.equal(signed.tamperedRejected, true);
  assert.match(signed.publicKeyPem, /BEGIN PUBLIC KEY/);
});

test('R13 Standalone Unpacked Windows x64 Product SDK Clean-Directory E2E Proof (Zero Repo Checkout Required)', async () => {
  const sdkRoot = path.join(resolveTempDir('r13-win-sdk'), 'sdk');
  const cleanUserDir = path.join(resolveTempDir('r13-win-sdk'), 'user-app');
  const built = await buildWindowsX64ProductSdk(sdkRoot, { zip: true });

  assert.ok(existsSync(path.join(sdkRoot, 'bin', 'tsfg-runtime.exe')));
  assert.ok(existsSync(path.join(sdkRoot, 'bin', 'tsfg-r05-vm.exe')));
  assert.ok(existsSync(path.join(sdkRoot, 'bin', 'tsfg-frontend.exe')));
  assert.ok(existsSync(path.join(sdkRoot, 'bin', 'tsfg-core-ir.exe')));
  assert.ok(existsSync(path.join(sdkRoot, 'bin', 'tsfgc.cmd')));
  assert.ok(existsSync(path.join(sdkRoot, 'lib', 'tsfg_runtime.lib')));
  assert.ok(existsSync(path.join(sdkRoot, 'include', 'tsfg_runtime.h')));
  assert.ok(existsSync(path.join(sdkRoot, 'NOTICE')));
  assert.ok(existsSync(path.join(sdkRoot, 'spdx-sbom.json')));
  assert.ok(existsSync(path.join(sdkRoot, 'sdk-manifest.json')));
  assert.ok(existsSync(path.join(sdkRoot, 'sdk-provenance.sig.json')));
  assert.ok(built.zipPath && existsSync(built.zipPath));

  // Execute `tsfgc.cmd run` and `tsfg-runtime.exe` from a completely isolated directory OUTSIDE the git repo!
  await mkdir(cleanUserDir, { recursive: true });
  const sampleTs = path.join(cleanUserDir, 'hello.ts');
  await writeFile(
    sampleTs,
    'export function main(a: i32, b: i32): i32 { return (a + b) * 3; }\n',
    'utf8',
  );

  const sdkEnv = {
    ...process.env,
    TSFG_SDK_ROOT: sdkRoot,
    TSFG_LOCKED_NODE: process.execPath,
  };
  delete sdkEnv.TSFG_FRONTEND_EXE;
  delete sdkEnv.TSFG_CORE_IR_EXE;
  delete sdkEnv.TSFG_R05_VM_EXE;
  delete sdkEnv.TSFG_RUNTIME_EXE;

  const runCli = spawnSync('cmd.exe', ['/c', path.join(sdkRoot, 'bin', 'tsfgc.cmd'), 'run', sampleTs, '--entry', 'main', '--args', '6,4'], {
    cwd: cleanUserDir,
    env: sdkEnv,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(runCli.status, 0, `Standalone SDK tsfgc.cmd run failed:\n${runCli.stdout}\n${runCli.stderr}`);
  const out = JSON.parse(runCli.stdout.trim());
  assert.equal(out.status, 'ok');
  assert.equal(out.i32, 30);

  const rtCheck = spawnSync(path.join(sdkRoot, 'bin', 'tsfg-runtime.exe'), ['--info'], {
    cwd: cleanUserDir,
    env: sdkEnv,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(rtCheck.status, 0, `Standalone SDK tsfg-runtime.exe --info failed:\n${rtCheck.stderr}`);
  const rtInfo = JSON.parse(rtCheck.stdout.trim());
  assert.equal(rtInfo.runtime, 'tsfg-runtime');
});
