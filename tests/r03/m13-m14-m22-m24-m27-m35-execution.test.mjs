// SPDX-License-Identifier: MIT
// Real end-to-end execution across Go frontend, MLIR Core IR, production VM (tsfg-runtime.exe),
// and Windows AOT (tsfg-aot.exe) covering:
//   M13 (modules & closure), M14 & M35 (source-free generic packages on VM & AOT),
//   M22 (Host31 Counter semantic contract & stateful execution on VM & AOT),
//   M24 (lossless WTF-8 strings on VM), and M27 (strict UTF-8 StringView boundary).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from '../../compiler/identity.mjs';
import { buildHir, lowerFormalHir, printHir, readHir } from '../../compiler/hir.mjs';
import { validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { readGenericPackageFrontendResponse } from '../../compiler/generic-package-frontend.mjs';
import { encodeGenericPackageRequest } from '../../compiler/generic-package-io.mjs';
import { moduleDefaultFacts } from './m18-module-facts.mjs';
import { generalStringProgram, globalStringProgram } from './formal-string-program.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const VM_EXE = process.env.TSFG_VM_EXE ?? 'E:\\tsfg-build\\vm\\tsfg-runtime.exe';
const VM_HOST31_EXE = process.env.TSFG_VM_HOST31_EXE ?? 'E:\\tsfg-build\\host31-qualified\\tsfg-runtime.exe';
const FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const RUNTIME_STAGE = process.env.TSFG_RUNTIME_STAGE ?? 'E:\\tsfg-build\\runtime-stage';
const HOST31_STAGE = process.env.TSFG_HOST31_STAGE ?? 'E:\\tsfg-build\\host31-qualified-stage';
const RUNTIME_OBJS = process.env.TSFG_RUNTIME_OBJS ?? 'E:\\tsfg-build\\runtime-objs';
const BUILD_DIR = process.env.TSFG_WAVE2_BUILD_DIR ?? 'E:\\tsfg-build\\wave2-exec';

const registry = JSON.parse(readFileSync(new URL('../../contracts/registry.json', import.meta.url), 'utf8'));
const bytecodeSchema = JSON.parse(readFileSync(new URL('../../contracts/bytecode.schema.json', import.meta.url), 'utf8'));
const hostContractProfile = JSON.parse(readFileSync(new URL('../../contracts/host-counter-semantic-v1.json', import.meta.url), 'utf8'));

const sha = (s) => createHash('sha256').update(s).digest('hex');

function runCore(coreText, flag) {
  const res = spawnSync(CORE_EXE, [flag], {
    input: Buffer.from(coreText, 'utf8'),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

async function compileDual(tag, coreText, stage = RUNTIME_STAGE) {
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });

  const canon = runCore(coreText, '--canonicalize');
  assert.equal(canon.status, 0, `${tag} --canonicalize failed:\n${canon.stderr.toString('utf8')}`);
  const tbc = runCore(coreText, '--emit-bytecode');
  assert.equal(tbc.status, 0, `${tag} --emit-bytecode failed:\n${tbc.stderr.toString('utf8')}`);
  const obj = runCore(coreText, '--emit-program-object');
  assert.equal(obj.status, 0, `${tag} --emit-program-object failed:\n${obj.stderr.toString('utf8')}`);

  const objPath = path.join(dir, 'program.obj');
  await writeFile(objPath, obj.stdout);
  const exePath = path.join(dir, 'tsfg-aot.exe');
  const link = spawnSync(ZIG_EXE, [
    'build-exe', 'aot-main.zig',
    objPath,
    path.join(RUNTIME_OBJS, 'host_counter.obj'),
    path.join(RUNTIME_OBJS, 'host_counter_bridge.obj'),
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-ODebug', '-fno-lto',
    `-femit-bin=${exePath}`,
  ], { cwd: stage, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (link.error) throw link.error;
  assert.equal(link.status, 0, `${tag} zig link failed:\n${link.stderr.toString('utf8')}`);
  return { tbcBytes: tbc.stdout, exePath };
}

function runVm(tbcBytes, requests, flag = '--requests', vmExe = VM_EXE) {
  const payload = JSON.stringify(requests.map((r) => ({ memoryBytes: 524288, ...r })));
  const res = spawnSync(vmExe, [flag, payload], {
    input: tbcBytes,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `VM exited ${res.status}: ${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

function runAot(exePath, requests, flag = '--requests') {
  const payload = JSON.stringify(requests.map((r) => ({ memoryBytes: 524288, ...r })));
  const res = spawnSync(exePath, [flag, payload], {
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `AOT exited ${res.status}: ${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

// Helper to build a valid Core 0.12 module with module tables (for M13 failing-init/TDZ & M22 Host31)
function buildModuleCore({ sources, modules, globals = [], hosts = [], roots, initialization, functions, inputTag }) {
  const q = JSON.stringify;
  const srcHash0 = sources[0].hash;
  const attrs = {
    version: '0.12.0',
    input_identity: `sha256:${sha(inputTag)}`,
    source_hash: `sha256:${srcHash0}`,
    source_path: sources[0].path,
    target: bytecodeSchema.target.target,
    triple: bytecodeSchema.target.triple,
    data_layout: bytecodeSchema.target.llvmDataLayout,
    bytecode_schema: registry['tsfg.bytecode'].schemaHash,
  };
  const headerAttrs = Object.entries(attrs).map(([k, v]) => `tsfg_core.${k} = ${q(v)}`).join(', ')
    + `, tsfg_core.source_length = ${sources[0].length} : i64`
    + `, tsfg_core.sources = [${sources.map((s) => `{path = ${q(s.path)}, hash = "sha256:${s.hash}", length = ${s.length} : i64}`).join(', ')}]`
    + `, tsfg_core.modules = [${modules.map((m) => `{id = "sha256:${m.id}", source = ${m.source} : i64, initializer = ${m.initializer} : i64, dependencies = [${m.dependencies.map((d) => `${d} : i64`).join(', ')}]}`).join(', ')}]`
    + `, tsfg_core.globals = [${globals.map((g) => `{id = "sha256:${g.id}", source = ${g.source} : i64, name = ${q(g.name)}, binding_kind = "source", type = "sha256:${g.typeId}", writable = ${g.writable}, start = ${g.start} : i64, end = ${g.end} : i64}`).join(', ')}]`
    + `, tsfg_core.hosts = [${hosts.map((h) => `{id = "sha256:${h.id}", source = ${h.source} : i64, name = ${q(h.name)}, capability = ${h.capability} : i64, signature = "sha256:${h.signature}", start = ${h.start} : i64, end = ${h.end} : i64}`).join(', ')}]`
    + `, tsfg_core.roots = [${roots.map((r) => `{kind = ${q(r.kind)}, source = ${r.source} : i64, name = ${q(r.name)}, function = ${r.function} : i64}`).join(', ')}]`
    + `, tsfg_core.initialization = [${initialization.map((i) => `${i} : i64`).join(', ')}]`;
  return `module attributes {${headerAttrs}} {\n${functions.join('\n')}\n}\n`;
}

// ============================================================================
// M13: Multi-Module Initialization, Persistent Globals, Failing Init Memo, TDZ
// ============================================================================
test('M13: Multi-module closure, live globals, failing-init memoization, and TDZ on both VM and Windows AOT', async () => {
  // 1. Live multi-module closure (app.ts -> worker.ts, dependency-ordered init, cross-module call + persistent global)
  const i32Type = sha('tsfg.type\0i32');
  const sigInit = sha('tsfg.signature\0()->i32');
  const sigBump = sha('tsfg.signature\0(i32)->i32');
  const srcWorker = { path: '/src/worker.ts', hash: sha('worker.ts'), length: 120 };
  const srcApp = { path: '/src/app.ts', hash: sha('app.ts'), length: 120 };
  const modWorker = sha(`tsfg.module\0${srcWorker.path}`);
  const modApp = sha(`tsfg.module\0${srcApp.path}`);
  const initWorkerId = sha(`tsfg.module-initializer.v1\0${srcWorker.path}\0sha256:${srcWorker.hash}\0sha256:${modWorker}\0sha256:${sigInit}`);
  const initAppId = sha(`tsfg.module-initializer.v1\0${srcApp.path}\0sha256:${srcApp.hash}\0sha256:${modApp}\0sha256:${sigInit}`);
  const bumpId = sha(`tsfg.function\0${srcWorker.path}\0bump\0${sigBump}`);
  const appEntryId = sha(`tsfg.function\0${srcApp.path}\0entry\0${sigInit}`);
  const countGlobalId = sha(`tsfg.global\0${srcWorker.path}\0count\0i32`);

  const liveCore = buildModuleCore({
    inputTag: 'm13-live-modules',
    sources: [srcWorker, srcApp],
    modules: [
      { id: modWorker, source: 0, initializer: 0, dependencies: [] },
      { id: modApp, source: 1, initializer: 1, dependencies: [0] },
    ],
    globals: [{ id: countGlobalId, source: 0, name: 'count', typeId: i32Type, writable: true, start: 1, end: 20 }],
    roots: [
      { kind: 'module-initialization', source: 0, name: '$moduleInit', function: 0 },
      { kind: 'module-initialization', source: 1, name: '$moduleInit', function: 1 },
      { kind: 'host-export', source: 0, name: 'bump', function: 2 },
      { kind: 'application', source: 1, name: 'entry', function: 3 },
    ],
    initialization: [0, 1],
    functions: [
      `  func.func @"f${initWorkerId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initWorkerId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 120 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %c = "tsfg_core.constant"() {value = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "tsfg_core.global_store"(%c) {global = 0 : i64, initialize = true, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : (i32) -> ()\n    %z = "tsfg_core.constant"() {value = 0 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "func.return"(%z) {tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${initAppId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initAppId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 120 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 1 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %z = "tsfg_core.constant"() {value = 0 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "func.return"(%z) {tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${bumpId}"(%d: i32) -> i32 attributes {tsfg_core.function_id = "sha256:${bumpId}", tsfg_core.signature_hash = "sha256:${sigBump}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 119 : i64, tsfg_core.initializer = false, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "bump"} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 119 : i64} : () -> ()\n    %old = "tsfg_core.global_load"() {global = 0 : i64, tsfg_source.start = 25 : i64, tsfg_source.end = 35 : i64} : () -> i32\n    %next = "tsfg_core.add"(%old, %d) {tsfg_source.start = 25 : i64, tsfg_source.end = 40 : i64} : (i32, i32) -> i32\n    "tsfg_core.global_store"(%next) {global = 0 : i64, initialize = false, tsfg_source.start = 25 : i64, tsfg_source.end = 40 : i64} : (i32) -> ()\n    "func.return"(%next) {tsfg_source.start = 45 : i64, tsfg_source.end = 55 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${appEntryId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${appEntryId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 119 : i64, tsfg_core.initializer = false, tsfg_core.source_index = 1 : i64, tsfg_core.logical_name = "entry"} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 119 : i64} : () -> ()\n    %seven = "tsfg_core.constant"() {value = 7 : i32, tsfg_source.start = 10 : i64, tsfg_source.end = 15 : i64} : () -> i32\n    %r = "func.call"(%seven) {callee = @"f${bumpId}", tsfg_core.function_id = "sha256:${bumpId}", tsfg_core.signature_hash = "sha256:${sigBump}", tsfg_source.start = 10 : i64, tsfg_source.end = 25 : i64} : (i32) -> i32\n    "func.return"(%r) {tsfg_source.start = 30 : i64, tsfg_source.end = 40 : i64} : (i32) -> ()\n  }`,
    ],
  });
  const compiled = await compileDual('m13-live-modules', liveCore);

  const reqs = [
    { functionId: `sha256:${appEntryId}`, arguments: [], semanticFuel: 200, depth: 4 },
    { functionId: `sha256:${appEntryId}`, arguments: [], semanticFuel: 200, depth: 4 },
    { functionId: `sha256:${bumpId}`, arguments: [{ type: 'i32', value: '20' }], semanticFuel: 200, depth: 4 },
    { functionId: `sha256:${appEntryId}`, arguments: [], semanticFuel: 200, depth: 4 },
  ];
  const aotOut = runAot(compiled.exePath, reqs, '--module-requests');
  const vmOut = runVm(compiled.tbcBytes, reqs, '--module-requests');
  assert.deepEqual(aotOut, vmOut, 'M13 live modules VM/AOT parity');
  assert.deepEqual(aotOut.map((r) => [r.status, r.moduleStatus, r.result?.value]), [
    ['returned', 'initialized', '8'],
    ['returned', 'initialized', '15'],
    ['returned', 'initialized', '35'],
    ['returned', 'initialized', '42'],
  ]);

  // 2. Failing module initializer (div by 0 in module B after module A succeeded) + memoization (no retry!)
  const srcA = { path: '/src/a.ts', hash: sha('a.ts'), length: 100 };
  const srcB = { path: '/src/b.ts', hash: sha('b.ts'), length: 100 };
  const modA = sha(`tsfg.module\0${srcA.path}`);
  const modB = sha(`tsfg.module\0${srcB.path}`);
  const initAId = sha(`tsfg.module-initializer.v1\0${srcA.path}\0sha256:${srcA.hash}\0sha256:${modA}\0sha256:${sigInit}`);
  const initBId = sha(`tsfg.module-initializer.v1\0${srcB.path}\0sha256:${srcB.hash}\0sha256:${modB}\0sha256:${sigInit}`);
  const entryBId = sha(`tsfg.function\0${srcB.path}\0entry\0${sigInit}`);
  const globalAId = sha(`tsfg.global\0${srcA.path}\0a\0i32`);

  const failCore = buildModuleCore({
    inputTag: 'm13-failing-init',
    sources: [srcA, srcB],
    modules: [
      { id: modA, source: 0, initializer: 0, dependencies: [] },
      { id: modB, source: 1, initializer: 1, dependencies: [0] },
    ],
    globals: [{ id: globalAId, source: 0, name: 'a', typeId: i32Type, writable: true, start: 1, end: 20 }],
    roots: [
      { kind: 'module-initialization', source: 0, name: '$moduleInit', function: 0 },
      { kind: 'module-initialization', source: 1, name: '$moduleInit', function: 1 },
      { kind: 'application', source: 1, name: 'entry', function: 2 },
    ],
    initialization: [0, 1],
    functions: [
      `  func.func @"f${initAId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initAId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %c = "tsfg_core.constant"() {value = 10 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "tsfg_core.global_store"(%c) {global = 0 : i64, initialize = true, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : (i32) -> ()\n    %z = "tsfg_core.constant"() {value = 0 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "func.return"(%z) {tsfg_source.start = 1 : i64, tsfg_source.end = 20 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${initBId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initBId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 1 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %x = "tsfg_core.global_load"() {global = 0 : i64, tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    %zero = "tsfg_core.constant"() {value = 0 : i32, tsfg_source.start = 21 : i64, tsfg_source.end = 22 : i64} : () -> i32\n    %boom = "tsfg_core.div"(%x, %zero) {tsfg_source.start = 30 : i64, tsfg_source.end = 40 : i64} : (i32, i32) -> i32\n    "func.return"(%boom) {tsfg_source.start = 50 : i64, tsfg_source.end = 60 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${entryBId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${entryBId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 99 : i64, tsfg_core.initializer = false, tsfg_core.source_index = 1 : i64, tsfg_core.logical_name = "entry"} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 99 : i64} : () -> ()\n    %v = "tsfg_core.global_load"() {global = 0 : i64, tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "func.return"(%v) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (i32) -> ()\n  }`,
    ],
  });
  const failCompiled = await compileDual('m13-fail-init', failCore);
  const failReqs = [
    { functionId: `sha256:${entryBId}`, arguments: [], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${entryBId}`, arguments: [], semanticFuel: 100, depth: 4 },
  ];
  const failAot = runAot(failCompiled.exePath, failReqs, '--module-requests');
  const failVm = runVm(failCompiled.tbcBytes, failReqs, '--module-requests');
  assert.deepEqual(failAot, failVm, 'M13 failing init memoization VM/AOT parity');
  assert.equal(failAot[0].status, 'failed');
  assert.equal(failAot[0].moduleStatus, 'failed');
  assert.equal(failAot[0].code, 'r01-t-divide-zero');
  assert.equal(failAot[0].source.start, '30');
  // Second request replays exact memoized failure with 0 fuel consumed (no retry!)
  assert.equal(failAot[1].status, 'failed');
  assert.equal(failAot[1].moduleStatus, 'failed');
  assert.equal(failAot[1].code, 'r01-t-divide-zero');
  assert.equal(failAot[1].fuelConsumed, '0');

  // 3. TDZ (read uninitialized global in initializer) -> ReferenceError memoized on both VM and AOT
  const tdzCore = buildModuleCore({
    inputTag: 'm13-tdz',
    sources: [srcA],
    modules: [{ id: modA, source: 0, initializer: 0, dependencies: [] }],
    globals: [{ id: globalAId, source: 0, name: 'a', typeId: i32Type, writable: true, start: 1, end: 20 }],
    roots: [
      { kind: 'module-initialization', source: 0, name: '$moduleInit', function: 0 },
      { kind: 'application', source: 0, name: 'entry', function: 1 },
    ],
    initialization: [0],
    functions: [
      `  func.func @"f${initAId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initAId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 100 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %v = "tsfg_core.global_load"() {global = 0 : i64, tsfg_source.start = 15 : i64, tsfg_source.end = 19 : i64} : () -> i32\n    "tsfg_core.global_store"(%v) {global = 0 : i64, initialize = true, tsfg_source.start = 1 : i64, tsfg_source.end = 25 : i64} : (i32) -> ()\n    "func.return"(%v) {tsfg_source.start = 26 : i64, tsfg_source.end = 30 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${sha(`tsfg.function\0${srcA.path}\0entry\0${sigInit}`)}"() -> i32 attributes {tsfg_core.function_id = "sha256:${sha(`tsfg.function\0${srcA.path}\0entry\0${sigInit}`)}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 99 : i64, tsfg_core.initializer = false, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "entry"} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 99 : i64} : () -> ()\n    %v = "tsfg_core.global_load"() {global = 0 : i64, tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : () -> i32\n    "func.return"(%v) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (i32) -> ()\n  }`,
    ],
  });
  const tdzCompiled = await compileDual('m13-tdz', tdzCore);
  const tdzEntryId = `sha256:${sha(`tsfg.function\0${srcA.path}\0entry\0${sigInit}`)}`;
  const tdzReqs = [
    { functionId: tdzEntryId, arguments: [], semanticFuel: 100, depth: 4 },
    { functionId: tdzEntryId, arguments: [], semanticFuel: 100, depth: 4 },
  ];
  const tdzAot = runAot(tdzCompiled.exePath, tdzReqs, '--module-requests');
  const tdzVm = runVm(tdzCompiled.tbcBytes, tdzReqs, '--module-requests');
  assert.deepEqual(tdzAot, tdzVm, 'M13 TDZ VM/AOT parity');
  assert.equal(tdzAot[0].status, 'exception');
  assert.equal(tdzAot[0].moduleStatus, 'failed');
  assert.equal(tdzAot[0].source.start, '15');
  assert.equal(tdzAot[1].status, 'exception');
  assert.equal(tdzAot[1].fuelConsumed, '0');
});

// ============================================================================
// M14 & M35: Live Source-Free Generic Package Export -> Instantiate -> VM + AOT
// ============================================================================
test('M14 & M35: Live source-free generic package export, instantiation, and dual VM/AOT execution', async () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/generic-package-io-source-v7.json', import.meta.url), 'utf8'));
  const exportCase = fx.cases.find((c) => c.name === 'export-ok');

  // Session 1: Live Go frontend exports owned generic package from TypeScript source
  const expReqBytes = Buffer.from(canonical(exportCase.request), 'utf8');
  const expProc = spawnSync(FRONTEND_EXE, ['--generic-package-io-v1'], { input: expReqBytes, windowsHide: true });
  assert.equal(expProc.status, 0, expProc.stderr.toString('utf8'));
  const exported = readGenericPackageFrontendResponse(expReqBytes, expProc.stdout, { operation: 'export' });
  assert.equal(exported.status, 'ok');
  const pkg = JSON.parse(Buffer.from(exported.packageBytes).toString('utf8'));

  // Session 2 (brand new process, NO original TypeScript source file!): instantiate concrete roots
  const routeKey = pkg.payload.definitions.find((d) => d.name === 'route').key;
  const unusedKey = pkg.payload.definitions.find((d) => d.name === 'unused').key;
  const instReqBytes = encodeGenericPackageRequest({
    family: 'tsfg.generic-package-io-candidate',
    version: 1,
    operation: 'instantiate',
    package: pkg,
    roots: [
      { definition: routeKey, typeArguments: [{ kind: 'boolean', parameter: 0 }] },
      { definition: routeKey, typeArguments: [{ kind: 'number', parameter: 0 }] },
      { definition: unusedKey, typeArguments: [{ kind: 'number', parameter: 0 }] },
      { definition: unusedKey, typeArguments: [{ kind: 'boolean', parameter: 0 }] },
    ],
  });
  const instProc = spawnSync(FRONTEND_EXE, ['--generic-package-io-v1'], { input: instReqBytes, windowsHide: true });
  assert.equal(instProc.status, 0, instProc.stderr.toString('utf8'));
  const instantiated = readGenericPackageFrontendResponse(instReqBytes, instProc.stdout, { operation: 'instantiate' });
  assert.equal(instantiated.status, 'ok');
  const hir = instantiated.hir;
  // Distinct concrete functions with distinct FunctionIds
  const ids = new Set(hir.functions.map((f) => f.id));
  assert.equal(ids.size, hir.functions.length);

  // Lower concrete monomorphized HIR -> Core IR -> BOTH VM bytecode AND Windows AOT exe!
  const core = lowerGenericHir(hir);
  const compiled = await compileDual('m14-m35-generics', core);

  const routeBoolId = hir.closure.roots[0];
  const routeF64Id = hir.closure.roots[1];
  const unusedNumId = hir.closure.roots[2];
  const unusedBoolId = hir.closure.roots[3];
  assert.notEqual(routeBoolId, routeF64Id);
  assert.notEqual(unusedNumId, unusedBoolId);

  const reqs = [
    { functionId: routeBoolId, arguments: [{ type: 'bool', value: true }], semanticFuel: 100, depth: 4 },
    { functionId: routeBoolId, arguments: [{ type: 'bool', value: false }], semanticFuel: 100, depth: 4 },
    { functionId: routeF64Id, arguments: [{ type: 'f64', value: '400c000000000000' }], semanticFuel: 100, depth: 4 }, // 3.5
    { functionId: routeF64Id, arguments: [{ type: 'f64', value: 'fff8000000001234' }], semanticFuel: 100, depth: 4 }, // custom NaN payload preserved!
    { functionId: routeF64Id, arguments: [{ type: 'f64', value: '8000000000000000' }], semanticFuel: 100, depth: 4 }, // -0.0 preserved!
    { functionId: unusedNumId, arguments: [{ type: 'bool', value: true }], semanticFuel: 100, depth: 4 },
    { functionId: unusedBoolId, arguments: [{ type: 'bool', value: false }], semanticFuel: 100, depth: 4 },
    // Depth exhaustion across generic call route -> identity (depth=1 fails when entering identity!)
    { functionId: routeBoolId, arguments: [{ type: 'bool', value: true }], semanticFuel: 100, depth: 1 },
  ];
  const aotOut = runAot(compiled.exePath, reqs);
  const vmOut = runVm(compiled.tbcBytes, reqs);
  assert.deepEqual(aotOut, vmOut, 'M14/M35 generic package VM/AOT parity');
  assert.deepEqual(aotOut.slice(0, 7).map((r) => r.result), [
    { type: 'bool', value: true },
    { type: 'bool', value: false },
    { type: 'f64', value: '400c000000000000' },
    { type: 'f64', value: 'fff8000000001234' },
    { type: 'f64', value: '8000000000000000' },
    { type: 'bool', value: true },
    { type: 'bool', value: false },
  ]);
  assert.equal(aotOut[7].status, 'failed');
  assert.equal(aotOut[7].code, 'r01-t-depth');
});

// ============================================================================
// M22: Host31 Counter Semantic Contract, Negative Rejections, Stateful VM & AOT
// ============================================================================
test('M22: Host31 Counter capability/contract trust separation and stateful execution on VM and Windows AOT', async () => {
  const i32Type = sha('tsfg.type\0i32');
  const sigInit = sha('tsfg.signature\0()->i32');
  const sigTick = hostContractProfile.binding.signatureHash.slice('sha256:'.length);
  const srcMain = { path: '/src/main.ts', hash: sha('host-main'), length: 120 };
  const srcDts = { path: '/src/counter.d.ts', hash: sha('host-dts'), length: 120 };
  const modMain = sha(`tsfg.module\0${srcMain.path}`);
  const initId = sha(`tsfg.module-initializer.v1\0${srcMain.path}\0sha256:${srcMain.hash}\0sha256:${modMain}\0sha256:${sigInit}`);
  const tickId = sha(`tsfg.function\0${srcMain.path}\0tick\0${sigTick}`);
  const hostId = sha(`tsfg.host\0${srcDts.path}\0counter\0sha256:${sigTick}`);

  const hostCore = buildModuleCore({
    inputTag: 'm22-host31-counter',
    sources: [srcMain, srcDts],
    modules: [{ id: modMain, source: 0, initializer: 0, dependencies: [] }],
    hosts: [{ id: hostId, source: 1, name: 'counter', capability: 31, signature: sigTick, start: 1, end: 40 }],
    roots: [
      { kind: 'module-initialization', source: 0, name: '$moduleInit', function: 0 },
      { kind: 'application', source: 0, name: 'tick', function: 1 },
    ],
    initialization: [0],
    functions: [
      `  func.func @"f${initId}"() -> i32 attributes {tsfg_core.function_id = "sha256:${initId}", tsfg_core.signature_hash = "sha256:${sigInit}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 0 : i64, tsfg_core.function_end = 120 : i64, tsfg_core.initializer = true, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "$moduleInit"} {\n    %z = "tsfg_core.constant"() {value = 0 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 10 : i64} : () -> i32\n    "func.return"(%z) {tsfg_source.start = 1 : i64, tsfg_source.end = 10 : i64} : (i32) -> ()\n  }`,
      `  func.func @"f${tickId}"(%d: i32) -> i32 attributes {tsfg_core.function_id = "sha256:${tickId}", tsfg_core.signature_hash = "sha256:${sigTick}", tsfg_core.type_id = "sha256:${i32Type}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 119 : i64, tsfg_core.initializer = false, tsfg_core.source_index = 0 : i64, tsfg_core.logical_name = "tick"} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 119 : i64} : () -> ()\n    %r = "tsfg_core.authorized_host"(%d) {host = 0 : i64, tsfg_source.start = 20 : i64, tsfg_source.end = 40 : i64} : (i32) -> i32\n    "func.return"(%r) {tsfg_source.start = 50 : i64, tsfg_source.end = 60 : i64} : (i32) -> ()\n  }`,
    ],
  });

  // Compile BOTH unqualified (default false cert) and qualified (certified counter) AOT binaries
  const unqual = await compileDual('m22-host31-unqual', hostCore, RUNTIME_STAGE);
  const qual = await compileDual('m22-host31-qual', hostCore, HOST31_STAGE);

  // Extract contract_hash from runtime-stage/host_semantic_identity.zig
  const identityText = readFileSync(path.join(HOST31_STAGE, 'host_semantic_identity.zig'), 'utf8');
  const m = identityText.match(/pub const contract_hash = \[_\]u8\{\s*([^}]+)\};/);
  assert.ok(m, 'contract_hash found in host_semantic_identity.zig');
  const contractHex = m[1].split(',').map((s) => Number(s.trim()).toString(16).padStart(2, '0')).join('');
  const validGrant = {
    id: 31,
    adapter: 'counter',
    signatureHash: hostContractProfile.binding.signatureHash,
    semanticContractHash: `sha256:${contractHex}`,
  };
  const badContractGrant = { ...validGrant, semanticContractHash: 'sha256:' + 'f'.repeat(64) };
  const badSigGrant = { ...validGrant, signatureHash: 'sha256:' + 'e'.repeat(64) };

  // 1. Default unqualified runtime MUST reject Host31 even with valid grant on BOTH VM and AOT!
  const unqualReqs = [{ functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '5' }], capabilities: [validGrant], semanticFuel: 100, depth: 4 }];
  const unqualAot = runAot(unqual.exePath, unqualReqs, '--module-requests');
  const unqualVm = runVm(unqual.tbcBytes, unqualReqs, '--module-requests', VM_EXE);
  assert.deepEqual(unqualAot, unqualVm, 'M22 unqualified cert rejection parity');
  assert.equal(unqualAot[0].status, 'failed');
  assert.equal(unqualAot[0].code, 'r05-request-capability');

  // 2. Negative capability/contract trust separation on qualified runtime (BOTH VM and AOT!)
  const negReqs = [
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '5' }], capabilities: [], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '5' }], capabilities: [badContractGrant], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '5' }], capabilities: [badSigGrant], semanticFuel: 100, depth: 4 },
  ];
  const negAot = runAot(qual.exePath, negReqs, '--module-requests');
  const negVm = runVm(qual.tbcBytes, negReqs, '--module-requests', VM_HOST31_EXE);
  assert.deepEqual(negAot, negVm, 'M22 negative capability/contract parity');
  assert.deepEqual(negAot.map((r) => r.code), ['r05-request-capability', 'r05-request-host-contract', 'r05-request-host-contract']);

  // 3. Positive stateful Host31 execution across sequential --module-requests on BOTH VM and AOT!
  const posReqs = [
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '5' }], capabilities: [validGrant], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '7' }], capabilities: [validGrant], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '-2' }], capabilities: [validGrant], semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${tickId}`, arguments: [{ type: 'i32', value: '2147483647' }], capabilities: [validGrant], semanticFuel: 100, depth: 4 },
  ];
  const posAot = runAot(qual.exePath, posReqs, '--module-requests');
  const posVm = runVm(qual.tbcBytes, posReqs, '--module-requests', VM_HOST31_EXE);
  assert.deepEqual(posAot, posVm, 'M22 positive stateful Host31 VM/AOT parity');
  // 0+5=5, 5+7=12, 12+(-2)=10, 10+2147483647 = -2147483639 (signed i32 wrap; u32 storage = 2147483657)
  assert.deepEqual(posAot.map((r) => [r.status, r.result?.value, r.hostEvents, r.requestHostEvents, r.hostCounter]), [
    ['returned', '5', 1, 1, 5],
    ['returned', '12', 2, 1, 12],
    ['returned', '10', 3, 1, 10],
    ['returned', '-2147483639', 4, 1, 2147483657],
  ]);
});

// ============================================================================
// M24 & M27: Lossless WTF-8 Strings & Strict UTF-8 StringView Boundary in VM
// ============================================================================
test('M24 & M27: Lossless WTF-8 String operations, lone surrogates, globals, and strict vs lossy UTF-8 boundary in VM', async () => {
  // 1. General string program (contains [65, 0, 0xD83D, 0xDE00, 0xD800]: 'A', NUL, U+1F600, lone high surrogate)
  const gen = generalStringProgram(3);
  const genTbc = runCore(gen.core, '--emit-bytecode');
  assert.equal(genTbc.status, 0, genTbc.stderr.toString('utf8'));
  const entryId = `sha256:${gen.functions[1].id}`;
  const workerId = `sha256:${gen.functions[0].id}`;

  // Strict UTF-8 mode MUST reject returning lone surrogate 0xD800 with r05-string-invalid-utf8,
  // while lossy mode replaces ONLY 0xD800 with U+FFFD!
  const strictRes = runVm(genTbc.stdout, [{ functionId: entryId, arguments: [], stringOutput: 'strict', semanticFuel: 100, depth: 4 }]);
  assert.equal(strictRes[0].status, 'failed');
  assert.equal(strictRes[0].code, 'r05-string-invalid-utf8');
  assert.equal(strictRes[0].category, 'string-output');

  const lossyRes = runVm(genTbc.stdout, [{ functionId: entryId, arguments: [], stringOutput: 'lossy', semanticFuel: 100, depth: 4 }]);
  assert.equal(lossyRes[0].status, 'returned');
  assert.equal(lossyRes[0].result.encoding, 'lossy');
  assert.equal(lossyRes[0].result.value, 'A\0😀\uFFFD');
  assert.equal(lossyRes[0].result.byteLength, 9);

  // Valid UTF-8 string slice [0, 4) ('A\0😀') passes STRICT UTF-8 mode with exact bytes!
  const sliceValid = runVm(genTbc.stdout, [{
    functionId: workerId,
    arguments: [
      { type: 'string', value: [65, 0, 0xd83d, 0xde00, 0xd800] },
      { type: 'usize', value: '0' },
      { type: 'usize', value: '4' },
    ],
    stringOutput: 'strict',
    semanticFuel: 100,
    depth: 4,
  }]);
  assert.equal(sliceValid[0].status, 'returned');
  assert.equal(sliceValid[0].result.encoding, 'strict');
  assert.equal(sliceValid[0].result.value, 'A\0😀');
  assert.equal(sliceValid[0].result.byteLength, 6);

  // Surrogate-splitting slice [2, 3) splits 😀 into lone high surrogate 0xD83D (rejected by strict UTF-8!)
  const sliceSplit = runVm(genTbc.stdout, [{
    functionId: workerId,
    arguments: [
      { type: 'string', value: [65, 0, 0xd83d, 0xde00] },
      { type: 'usize', value: '2' },
      { type: 'usize', value: '3' },
    ],
    stringOutput: 'strict',
    semanticFuel: 100,
    depth: 4,
  }]);
  assert.equal(sliceSplit[0].status, 'failed');
  assert.equal(sliceSplit[0].code, 'r05-string-invalid-utf8');

  // 2. Global String module persistence across --module-requests (add host-export root for set)
  const glob = globalStringProgram();
  const globCoreWithSetRoot = glob.core.replace(
    'tsfg_core.roots = [{kind = "application", source = 0 : i64, name = "entry", function = 1 : i64}]',
    'tsfg_core.roots = [{kind = "application", source = 0 : i64, name = "entry", function = 1 : i64}, {kind = "host-export", source = 0 : i64, name = "set", function = 2 : i64}]'
  );
  const globTbc = runCore(globCoreWithSetRoot, '--emit-bytecode');
  assert.equal(globTbc.status, 0, globTbc.stderr.toString('utf8'));
  const gEntryId = `sha256:${glob.functions[1].id}`;
  const gSetId = `sha256:${glob.functions[2].id}`;
  const globOut = runVm(globTbc.stdout, [
    { functionId: gEntryId, arguments: [], stringOutput: 'lossy', semanticFuel: 100, depth: 4 },
    { functionId: gSetId, arguments: [{ type: 'string', value: [72, 105, 0xd83d, 0xde80] }], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
    { functionId: gEntryId, arguments: [], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
  ], '--module-requests');
  assert.equal(globOut[0].result.value, 'A\0\uFFFD');
  assert.equal(globOut[1].result.value, 'Hi🚀');
  assert.equal(globOut[1].result.encoding, 'strict');
  assert.equal(globOut[2].result.value, 'Hi🚀');
  assert.equal(globOut[2].result.encoding, 'strict');

  // 3. Dedicated String ops module: length, codeunit, concat (joining lone high + low -> valid astral UTF-8!), compare (UTF-16 order)
  const strT = '!tsfg_string.string';
  const u16T = '!tsfg_core.integer<"u16">';
  const usizeT = '!tsfg_core.integer<"usize">';
  const p = '/src/str_ops.ts';
  const sh = sha('str-ops-src');
  const mkFn = (name, params, res, body) => {
    const mlirT = (t) => t === 'string' ? strT : t === 'i32' ? 'i32' : t === 'u16' ? u16T : usizeT;
    const sig = sha(`tsfg.signature\0(${params.join(',')})->${res}`);
    const fid = sha(`tsfg.function\0${p}\0${name}\0${sig}`);
    const tid = sha(`tsfg.type\0${res}`);
    return {
      id: `sha256:${fid}`,
      text: `  func.func @"${name}"(${params.map((t, i) => `%a${i}: ${mlirT(t)}`).join(', ')}) -> ${mlirT(res)} attributes {tsfg_core.function_id = "sha256:${fid}", tsfg_core.signature_hash = "sha256:${sig}", tsfg_core.type_id = "sha256:${tid}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 99 : i64} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 99 : i64} : () -> ()\n${body}\n  }`,
    };
  };
  const fnLen = mkFn('len', ['string'], 'usize', `    %r = "tsfg_string.length"(%a0) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${strT}) -> ${usizeT}\n    "func.return"(%r) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (${usizeT}) -> ()`);
  const fnUnit = mkFn('unit', ['string', 'usize'], 'u16', `    %r = "tsfg_string.codeunit"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${strT}, ${usizeT}) -> ${u16T}\n    "func.return"(%r) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (${u16T}) -> ()`);
  const fnCat = mkFn('cat', ['string', 'string'], 'string', `    %r = "tsfg_string.concat"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${strT}, ${strT}) -> ${strT}\n    "func.return"(%r) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (${strT}) -> ()`);
  const fnCmp = mkFn('cmp', ['string', 'string'], 'i32', `    %r = "tsfg_string.compare"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${strT}, ${strT}) -> i32\n    "func.return"(%r) {tsfg_source.start = 20 : i64, tsfg_source.end = 30 : i64} : (i32) -> ()`);
  const opsCore = `module attributes {tsfg_core.version = "0.12.0", tsfg_core.input_identity = "sha256:${sha('str-ops')}", tsfg_core.source_hash = "sha256:${sh}", tsfg_core.source_path = "${p}", tsfg_core.source_length = 100 : i64, tsfg_core.target = "${bytecodeSchema.target.target}", tsfg_core.triple = "${bytecodeSchema.target.triple}", tsfg_core.data_layout = "${bytecodeSchema.target.llvmDataLayout}", tsfg_core.bytecode_schema = "${registry['tsfg.bytecode'].schemaHash}"} {\n${[fnLen, fnUnit, fnCat, fnCmp].map((f) => f.text).join('\n')}\n}\n`;
  const opsTbc = runCore(opsCore, '--emit-bytecode');
  assert.equal(opsTbc.status, 0, opsTbc.stderr.toString('utf8'));
  const opsOut = runVm(opsTbc.stdout, [
    // UTF-16 code unit length of 'A😀' is 3 (1 + 2 surrogates)
    { functionId: fnLen.id, arguments: [{ type: 'string', value: [65, 0xd83d, 0xde00] }], semanticFuel: 100, depth: 2 },
    // codeunit at index 1 is 0xD83D (55357)
    { functionId: fnUnit.id, arguments: [{ type: 'string', value: [65, 0xd83d, 0xde00] }, { type: 'usize', value: '1' }], semanticFuel: 100, depth: 2 },
    // concat lone high [0xD83D] + lone low [0xDE00] => valid astral UTF-8 '😀' in STRICT mode!
    { functionId: fnCat.id, arguments: [{ type: 'string', value: [0xd83d] }, { type: 'string', value: [0xde00] }], stringOutput: 'strict', semanticFuel: 100, depth: 2 },
    // UTF-16 code-unit order: U+E000 (0xE000) > U+1F600 (starts with 0xD83D)!
    { functionId: fnCmp.id, arguments: [{ type: 'string', value: [0xe000] }, { type: 'string', value: [0xd83d, 0xde00] }], semanticFuel: 100, depth: 2 },
    { functionId: fnCmp.id, arguments: [{ type: 'string', value: [0xd83d, 0xde00] }, { type: 'string', value: [0xe000] }], semanticFuel: 100, depth: 2 },
    // Out-of-bounds codeunit trap
    { functionId: fnUnit.id, arguments: [{ type: 'string', value: [65] }, { type: 'usize', value: '1' }], semanticFuel: 100, depth: 2 },
  ]);
  assert.equal(opsOut[0].result.value, '3');
  assert.equal(opsOut[1].result.value, String(0xd83d));
  assert.equal(opsOut[2].result.encoding, 'strict');
  assert.equal(opsOut[2].result.value, '😀');
  assert.equal(opsOut[2].result.byteLength, 4);
  assert.equal(opsOut[3].result.value, '1');
  assert.equal(opsOut[4].result.value, '-1');
  assert.equal(opsOut[5].status, 'failed');
});
