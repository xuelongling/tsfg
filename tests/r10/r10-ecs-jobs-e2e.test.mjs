// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateTmetaArtifact } from '../../compiler/r04-protocols.mjs';
import {
  analyzeQueryConflictGraph,
  compileComponentSchemas,
  compileDynamicEcsKernelDll,
  compileVectorizedEcsKernelDll,
  emitEcsTmeta,
  extractEcsFromTsSource,
} from '../../compiler/r10-ecs-query-compiler.mjs';
import { resolveTempDir, resolveZigCacheEnv, resolveZigExe } from '../../compiler/tsfg-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ZIG = resolveZigExe();
const CLI_EXE = path.join(resolveTempDir('r10-cli-bin'), 'tsfg-r10-ecs.exe');

function zigEnv() {
  return resolveZigCacheEnv();
}

test('R10 @component DataLayout Reflection, .tmeta RF-01 Digest, Read/Write Conflict Graph, Wave Scheduler & Illegal Kernel Rejection', () => {
  const schemas = compileComponentSchemas([
    { name: 'Position', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
    { name: 'Velocity', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
    { name: 'Health', fields: [{ name: 'hp', type: 'i32' }, { name: 'shield', type: 'i16' }] },
  ]);
  const pos = schemas.find((c) => c.name === 'Position');
  assert.equal(pos.size, 8);
  assert.equal(pos.align, 4);

  // Reject non-value GC ref / string inside @component
  assert.throws(
    () => compileComponentSchemas([{ name: 'Bad', fields: [{ name: 'label', type: 'string' }] }]),
    /r10-component-nonvalue/,
  );

  // Conflict graph: integrate(W:Pos, R:Vel) conflicts with render(R:Pos), does NOT conflict with regen(W:Health, R:Vel)!
  const graph = analyzeQueryConflictGraph(
    [
      { name: 'integrate', query: [{ component: 'Position', access: 'write' }, { component: 'Velocity', access: 'read' }], fusable: true },
      { name: 'regen', query: [{ component: 'Health', access: 'write' }, { component: 'Velocity', access: 'read' }], fusable: false },
      { name: 'render', query: [{ component: 'Position', access: 'read' }], fusable: false },
    ],
    schemas,
  );
  assert.equal(graph.conflicts.length, 1);
  assert.deepEqual(graph.conflicts[0], { left: 'integrate', right: 'render', components: ['Position'] });
  // Wave 0 runs integrate & regen in PARALLEL (shared Read<Velocity> is conflict-free!); Wave 1 runs render
  assert.deepEqual(graph.waves, [['integrate', 'regen'], ['render']]);

  // Reject intra-system Read/Write alias conflict and forbidden kernel effects (gc_ref, throw, await, managed_alloc)
  assert.throws(
    () => analyzeQueryConflictGraph([{ name: 'badAlias', query: [{ component: 'Position', access: 'write' }, { component: 'Position', access: 'read' }] }], schemas),
    /r10-query-alias-conflict/,
  );
  assert.throws(
    () => analyzeQueryConflictGraph([{ name: 'badEffect', query: [{ component: 'Position', access: 'read' }], effects: ['managed_alloc'] }], schemas),
    /r10-kernel-illegal-effect/,
  );

  // Canonical R04 `.tmeta` emission & validation
  const tmeta = emitEcsTmeta(schemas, graph);
  const validated = validateTmetaArtifact(tmeta.bytes);
  assert.equal(validated.payload.components.length, 3);
  assert.equal(validated.payload.queries.length, 3);
});

test('R10 Zig ECS Archetype/Chunk, BorrowConflict, Batch SIMD First-Failure Preservation & Work-Stealing JobSystem Tests', () => {
  const res = spawnSync(ZIG, ['test', path.join(REPO_ROOT, 'runtime', 'r10-ecs-jobs.zig')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(res.status, 0, `zig test r10-ecs-jobs.zig failed:\n${res.stdout}\n${res.stderr}`);
});

test('R10 16,384-Entity 3-Way Bit-Exact Equivalence (Scalar Oracle === Batch SIMD VM === 4-Thread Work-Stealing AOT <4 x float> DLL)', async () => {
  const workDir = path.join('E:\\tsfg-temp', 'r10-e2e');
  await mkdir(path.dirname(CLI_EXE), { recursive: true });
  await mkdir(workDir, { recursive: true });

  const [dll, build] = await Promise.all([
    compileVectorizedEcsKernelDll(workDir, { tag: 'r10_integrate_vec4' }),
    Promise.resolve(
      spawnSync(ZIG, ['build-exe', '-O', 'ReleaseFast', path.join(REPO_ROOT, 'runtime', 'r10-ecs-cli.zig'), `-femit-bin=${CLI_EXE}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: zigEnv(),
      }),
    ),
  ]);
  assert.equal(build.status, 0, `zig build-exe r10-ecs-cli.zig failed:\n${build.stderr}`);

  const run = spawnSync(CLI_EXE, [dll.dllPath, '16384'], { cwd: REPO_ROOT, encoding: 'utf8', env: zigEnv() });
  assert.equal(run.status, 0, `r10-ecs-cli failed:\n${run.stdout}\n${run.stderr}`);
  const metrics = JSON.parse(run.stdout.trim());

  assert.equal(metrics.entities, 16384);
  assert.equal(metrics.chunks, 256);
  assert.equal(metrics.bitExactMismatches, 0, 'Scalar Oracle, Batch SIMD VM, and AOT <4 x float> DLL MUST match bit-for-bit!');
  assert.ok(metrics.batchStolen > 0, 'Batch SIMD work-stealing must execute across worker threads');
  assert.ok(metrics.aotStolen > 0, 'AOT vectorized work-stealing must execute across worker threads');
});

test('R10 Source-Driven @component/@system Extraction & Query-Driven Dynamic Vectorized DLL + PDB', async () => {
  const tsSrc = `
@component
export class Transform {
  x: f32 = 0;
  y: f32 = 0;
}
@component
export class Impulse {
  dx: f32 = 0;
  dy: f32 = 0;
}
@system
export function applyImpulse(t: Write<Transform>, imp: Read<Impulse>): void {}
`;
  const extracted = extractEcsFromTsSource(tsSrc);
  assert.equal(extracted.components.length, 2);
  assert.equal(extracted.systems.length, 1);
  const schemas = compileComponentSchemas(extracted.components);
  const graph = analyzeQueryConflictGraph(extracted.systems, schemas);
  assert.deepEqual(graph.waves, [['applyImpulse']]);

  const dynDll = await compileDynamicEcsKernelDll(
    { symbolName: 'tsfg_apply_impulse_vec4', op: 'scale_add_1d' },
    path.join(resolveTempDir('r10-dyn-dll')),
    { emitPdb: true },
  );
  assert.ok(existsSync(dynDll.dllPath));
  assert.ok(dynDll.pdbPath && existsSync(dynDll.pdbPath));
});
