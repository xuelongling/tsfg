// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compileTsGpuKernelToSpirv,
  emitSpirv13ComputeKernel,
  runCpuGpuReference,
  validateSpirvBinary,
  verifyGpuKernelSpec,
} from '../../compiler/r11-gpu-kernel-compiler.mjs';
import { compareDomainRelaxedOutcomes } from '../../tooling/diff-platform/r08-diff-runner.mjs';
import { resolveTempDir, resolveVulkanConfig, resolveZigCacheEnv, resolveZigExe } from '../../compiler/tsfg-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ZIG = resolveZigExe();
const VK_CFG = resolveVulkanConfig();
const VULKAN_LOADER = VK_CFG.loaderPath;
const LAVAPIPE_ICD = VK_CFG.fallbackIcdPath;
const CLI_EXE = path.join(resolveTempDir('r11-cli-bin'), 'tsfg-r11-gpu.exe');

function zigEnv() {
  return resolveZigCacheEnv();
}

test('R11 GPU Kernel Legality Verifier & SPIR-V 1.3 Structural Validator (Illegal Refs/Exceptions/Alias/Feature Rejection)', () => {
  const validSpec = {
    name: 'vec_add_f32',
    workgroupSize: 64,
    explicitTransfers: true,
    effects: [],
    bindings: [
      { binding: 0, bufferName: 'a', addressSpace: 'storage_readonly', elementType: 'f32' },
      { binding: 1, bufferName: 'b', addressSpace: 'storage_readonly', elementType: 'f32' },
      { binding: 2, bufferName: 'out', addressSpace: 'storage_readwrite', elementType: 'f32' },
    ],
  };
  const verified = verifyGpuKernelSpec(validSpec);
  assert.equal(verified.ok, true);

  // Reject GC refs, exceptions, implicit copies, write-aliasing, and unnegotiated f64
  assert.throws(() => verifyGpuKernelSpec({ ...validSpec, effects: ['gc_ref'] }), /r11-gpu-illegal-effect/);
  assert.throws(() => verifyGpuKernelSpec({ ...validSpec, effects: ['throw'] }), /r11-gpu-illegal-effect/);
  assert.throws(() => verifyGpuKernelSpec({ ...validSpec, explicitTransfers: false }), /r11-gpu-implicit-copy/);
  assert.throws(
    () =>
      verifyGpuKernelSpec({
        ...validSpec,
        bindings: [
          { binding: 0, bufferName: 'shared', addressSpace: 'storage_readonly', elementType: 'f32' },
          { binding: 1, bufferName: 'shared', addressSpace: 'storage_readwrite', elementType: 'f32' },
        ],
      }),
    /r11-gpu-write-alias/,
  );
  assert.throws(
    () =>
      verifyGpuKernelSpec(
        { ...validSpec, bindings: [{ binding: 0, bufferName: 'd', addressSpace: 'storage_readwrite', elementType: 'f64' }] },
        { shaderFloat64: false, maxWorkgroupSize: 1024 },
      ),
    /r11-gpu-feature-missing/,
  );

  // SPIR-V 1.3 structural validator accepts valid emitted kernel and rejects corrupted magic
  const spv = emitSpirv13ComputeKernel('f32_add', 1024, 64);
  const v = validateSpirvBinary(spv.bytes);
  assert.equal(v.valid, true);
  assert.equal(v.version, 0x00010300);

  const badSpv = Buffer.from(spv.bytes);
  badSpv.writeUInt32LE(0xdeadbeef, 0);
  assert.throws(() => validateSpirvBinary(badSpv), /r11-spirv-magic/);
});

test('R11 REAL Vulkan 1.3 Lavapipe Compute Execution, In-Flight Hot-Reload Reclamation, Cache/OOM/DeviceLost Faults & CPU Reference Comparison', async () => {
  const workDir = path.join('E:\\tsfg-temp', 'r11-e2e');
  await mkdir(path.dirname(CLI_EXE), { recursive: true });
  await mkdir(workDir, { recursive: true });

  const build = spawnSync(ZIG, ['build-exe', path.join(REPO_ROOT, 'runtime', 'r11-gpu-cli.zig'), `-femit-bin=${CLI_EXE}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(build.status, 0, `zig build-exe r11-gpu-cli.zig failed:\n${build.stderr}`);

  const count = 1024;
  const spvV1 = emitSpirv13ComputeKernel('f32_add', count, 64);
  const spvV2 = emitSpirv13ComputeKernel('f32_mad', count, 64);
  validateSpirvBinary(spvV1.bytes);
  validateSpirvBinary(spvV2.bytes);

  const spv1Path = path.join(workDir, 'v1_add.spv');
  const spv2Path = path.join(workDir, 'v2_mad.spv');
  const out1Path = path.join(workDir, 'out_v1.bin');
  const out2Path = path.join(workDir, 'out_v2.bin');
  await writeFile(spv1Path, spvV1.bytes);
  await writeFile(spv2Path, spvV2.bytes);

  const run = spawnSync(CLI_EXE, [VULKAN_LOADER, LAVAPIPE_ICD, spv1Path, spv2Path, out1Path, out2Path], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(run.status, 0, `r11-gpu-cli failed:\n${run.stdout}\n${run.stderr}`);
  const report = JSON.parse(run.stdout.trim());

  assert.match(report.deviceName, /llvmpipe/i, `expected real Lavapipe GPU device, got ${report.deviceName}`);
  assert.equal(report.unsupportedFeatureRejected, true);
  assert.equal(report.oomRejected, true);
  assert.equal(report.deferredWhileInFlight, 1, 'old GPU pipeline MUST stay alive while VkFence is in-flight!');
  assert.equal(report.reclaimedAfterFence, 1, 'old GPU pipeline MUST be destroyed cleanly after vkWaitForFences!');
  assert.equal(report.corruptCacheRejected, true);
  assert.equal(report.deviceLostRejected, true);
  assert.equal(report.remainingRetired, 0);

  // Independent CPU Reference comparison using R08 explicit GPU numeric comparator
  const hostA = new Float32Array(count);
  const hostB = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    hostA[i] = Math.fround(i * 0.5 + 1.25);
    hostB[i] = Math.fround((i % 17) * 0.25 - 2.0);
  }
  const refV1 = runCpuGpuReference('f32_add', hostA, hostB);
  const refV2 = runCpuGpuReference('f32_mad', hostA, hostB);

  const rawV1 = await readFile(out1Path);
  const rawV2 = await readFile(out2Path);
  const gpuV1 = new Float32Array(rawV1.buffer, rawV1.byteOffset, count);
  const gpuV2 = new Float32Array(rawV2.buffer, rawV2.byteOffset, count);

  for (let i = 0; i < count; i++) {
    const cmp1 = compareDomainRelaxedOutcomes(refV1[i], gpuV1[i], { domain: 'gpu', absTolerance: 1e-5, relTolerance: 1e-5 });
    assert.equal(cmp1.ok, true, `v1 GPU mismatch at [${i}]: gpu=${gpuV1[i]} ref=${refV1[i]} (${cmp1.reason})`);
    const cmp2 = compareDomainRelaxedOutcomes(refV2[i], gpuV2[i], { domain: 'gpu', absTolerance: 1e-4, relTolerance: 1e-4 });
    assert.equal(cmp2.ok, true, `v2 GPU mismatch at [${i}]: gpu=${gpuV2[i]} ref=${refV2[i]} (${cmp2.reason})`);
  }
});

test('R11 Real TypeScript `@gpu_kernel` -> SPIR-V 1.3 Compiler Execution on Live Vulkan 1.3 Device', async () => {
  const count = 1024;
  const tsKernelV1 = `
@gpu_kernel
export function saxpy_add(a: ReadSpan<f32>, b: ReadSpan<f32>, out: Span<f32>): void {
  const s: f32 = a[i] + b[i];
  out[i] = s;
}
`;
  const tsKernelV2 = `
@gpu_kernel
export function saxpy_mad(a: ReadSpan<f32>, b: ReadSpan<f32>, out: Span<f32>): void {
  const prod: f32 = a[i] * b[i];
  out[i] = prod + a[i];
}
`;
  const compiled1 = compileTsGpuKernelToSpirv(tsKernelV1, { elementCount: count, workgroupSize: 64 });
  const compiled2 = compileTsGpuKernelToSpirv(tsKernelV2, { elementCount: count, workgroupSize: 64 });
  assert.equal(compiled1.validation.valid, true);
  assert.equal(compiled2.validation.valid, true);

  // Reject forbidden throw/managed object inside @gpu_kernel source
  assert.throws(
    () => compileTsGpuKernelToSpirv('@gpu_kernel function bad(a: ReadSpan<f32>, out: Span<f32>) { throw 1; out[i] = a[i]; }'),
    /r11-gpu-illegal-effect/,
  );

  // Execute the TS-compiled SPIR-V binaries directly on Vulkan 1.3!
  const workDir = resolveTempDir('r11-ts-spirv');
  await mkdir(workDir, { recursive: true });
  const spv1Path = path.join(workDir, 'ts_v1.spv');
  const spv2Path = path.join(workDir, 'ts_v2.spv');
  const out1Path = path.join(workDir, 'ts_out1.bin');
  const out2Path = path.join(workDir, 'ts_out2.bin');
  await writeFile(spv1Path, compiled1.bytes);
  await writeFile(spv2Path, compiled2.bytes);

  const run = spawnSync(CLI_EXE, [VULKAN_LOADER, LAVAPIPE_ICD, spv1Path, spv2Path, out1Path, out2Path], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(run.status, 0, `r11-gpu-cli failed on TS-compiled SPIR-V:\n${run.stdout}\n${run.stderr}`);

  const hostA = new Float32Array(count);
  const hostB = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    hostA[i] = Math.fround(i * 0.5 + 1.25);
    hostB[i] = Math.fround((i % 17) * 0.25 - 2.0);
  }
  const ref1 = runCpuGpuReference('f32_add', hostA, hostB);
  const ref2 = runCpuGpuReference('f32_mad', hostA, hostB);
  const raw1 = await readFile(out1Path);
  const raw2 = await readFile(out2Path);
  const gpu1 = new Float32Array(raw1.buffer, raw1.byteOffset, count);
  const gpu2 = new Float32Array(raw2.buffer, raw2.byteOffset, count);
  for (let i = 0; i < count; i++) {
    assert.equal(compareDomainRelaxedOutcomes(ref1[i], gpu1[i], { domain: 'gpu', absTolerance: 1e-5, relTolerance: 1e-5 }).ok, true);
    assert.equal(compareDomainRelaxedOutcomes(ref2[i], gpu2[i], { domain: 'gpu', absTolerance: 1e-4, relTolerance: 1e-4 }).ok, true);
  }
});
