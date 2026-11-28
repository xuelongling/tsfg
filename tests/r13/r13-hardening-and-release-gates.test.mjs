// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  auditCompatibilityMatrixAndMigrate,
  auditRuntimeDependencyClosure,
  auditSpdxAndGenerateSbom,
  signAndVerifyReleaseBundle,
  verifyReproducibleDualDirBuild,
} from '../../tooling/release/r13-release-audit.mjs';

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

test('R13 Runtime Zero-Compiler-Dependency Closure Audit (No LLVM/MLIR/Clang/TypeScript/JS VM in Shipping Runtime)', async () => {
  const audit = await auditRuntimeDependencyClosure(REPO_ROOT);
  assert.ok(audit.auditedFiles.length >= 12, `expected >= 12 runtime .zig files, audited ${audit.auditedFiles.length}`);
  assert.equal(audit.ok, true, `Runtime dependency closure violations: ${JSON.stringify(audit.violations)}`);
});

test('R13 SPDX License Header Audit & SPDX 2.3 SBOM Generation', async () => {
  const res = await auditSpdxAndGenerateSbom(REPO_ROOT, DELIVERED_FILES);
  assert.equal(res.ok, true, `Missing SPDX headers: ${res.missingSpdx.join(', ')}`);
  assert.equal(res.sbom.spdxVersion, 'SPDX-2.3');
  assert.equal(res.sbom.files.length, DELIVERED_FILES.length);
  assert.ok(res.sbomDigest.startsWith('sha256:'));
});

test('R13 Dual-Directory Reproducible Build Proof, Cross-Version Compatibility/Migration & Ed25519 Provenance Signing', async () => {
  const repro = await verifyReproducibleDualDirBuild(path.join('E:\\tsfg-temp', 'r13-repro'));
  assert.equal(repro.identical, true, 'Dual-directory builds MUST be byte-for-byte identical!');
  assert.equal(repro.digestA, repro.digestB);

  const compat = await auditCompatibilityMatrixAndMigrate(REPO_ROOT, repro.tpkgBytes);
  assert.equal(compat.registeredFamilies.length, 9);
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
});
