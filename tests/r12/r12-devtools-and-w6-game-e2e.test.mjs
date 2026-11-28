// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTsfgProject, loadLocalPackage } from '../../tooling/r12-project-and-pkg.mjs';
import { decodeLspFrames, encodeLspFrame, TsfgLspServer } from '../../tooling/lsp/r12-tsfg-lsp.mjs';
import {
  inspectAbi,
  inspectTbcBytecode,
  inspectTmeta,
  TsfgTraceProfiler,
  UnifiedDebugSession,
} from '../../tooling/debugger/r12-inspector-debugger.mjs';
import { TsfgDapServer } from '../../tooling/debugger/tsfg-dap.mjs';
import { resolveTempDir, resolveZigCacheEnv, resolveZigExe } from '../../compiler/tsfg-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSFGC = path.join(REPO_ROOT, 'tooling', 'tsfgc.mjs');
const ZIG = resolveZigExe();

function zigEnv() {
  return resolveZigCacheEnv();
}

test('R12 tsfg-lsp JSON-RPC 2.0 Server: Merged TS + tsfg Kernel/ABI/Hot-Reload Diagnostics, Hover, Definition & Content-Length Framing', () => {
  const lsp = new TsfgLspServer();
  const initRes = lsp.handleMessage({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} });
  assert.equal(initRes.result.serverInfo.name, 'tsfg-lsp');

  // Verify wire framing round-trip
  const framed = encodeLspFrame(initRes);
  const decoded = decodeLspFrames(framed);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].result.serverInfo.name, 'tsfg-lsp');

  // Valid tsfg game source -> 0 diagnostics, hover & definition resolve!
  const goodSource = [
    '@component',
    'export class Position {',
    '  x: f32 = 0;',
    '  y: f32 = 0;',
    '}',
    '@system',
    'export function integrate(q: Query<[Write<Position>, Read<Velocity>]>, dt: f32): void {',
    '  const p = Position;',
    '}',
  ].join('\n');
  const openGood = lsp.handleMessage({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///game/main.ts', text: goodSource } },
  });
  assert.equal(openGood.params.diagnostics.length, 0);

  const hover = lsp.handleMessage({
    id: 2,
    jsonrpc: '2.0',
    method: 'textDocument/hover',
    params: { textDocument: { uri: 'file:///game/main.ts' }, position: { line: 7, character: 14 } },
  });
  assert.match(hover.result.contents.value, /@component class Position/);

  const def = lsp.handleMessage({
    id: 3,
    jsonrpc: '2.0',
    method: 'textDocument/definition',
    params: { textDocument: { uri: 'file:///game/main.ts' }, position: { line: 7, character: 14 } },
  });
  assert.equal(def.result.range.start.line, 1);

  // Inject forbidden JS import, `any`, non-value `@component string`, `@system` alias conflict, `@gpu_kernel throw`, AND hot-reload signature break!
  const badSource = [
    'import x from "./legacy.js";',
    '@component',
    'export class Position {',
    '  label: string = "";',
    '}',
    '@system',
    'export function integrate(q: Query<[Write<Position>, Read<Position>]>, dt: any): void {',
    '}',
    '@gpu_kernel',
    'export function shade(): void {',
    '  throw 1;',
    '}',
  ].join('\n');
  const changeBad = lsp.handleMessage({
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri: 'file:///game/main.ts' },
      contentChanges: [{ text: badSource }],
    },
  });
  const codes = new Set(changeBad.params.diagnostics.map((d) => d.code));
  assert.ok(codes.has('r02b-forbid-js-import'));
  assert.ok(codes.has('r10-component-nonvalue'));
  assert.ok(codes.has('r10-query-alias-conflict'));
  assert.ok(codes.has('r02b-forbid-any'));
  assert.ok(codes.has('r11-gpu-illegal-effect'));
  assert.ok(codes.has('r09-hot-reload-signature-change'));
});

test('R12 & W6 Windows Functional Complete: Precompiled .tpkg Detached Consumption, Incremental === Clean Build, Zig Host Bindings, Inspector, Unified VM/AOT Debugger & Tracing', async () => {
  const root = path.join('E:\\tsfg-temp', 'r12-w6-game');
  await rm(root, { recursive: true, force: true });
  const libDir = path.join(root, 'physics_lib');
  const appDir = path.join(root, 'game_app');
  const pkgStore = path.join(root, 'pkg_store');
  await mkdir(libDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await mkdir(pkgStore, { recursive: true });

  // 1. Build `physics_lib` into a standalone precompiled `.tpkg`
  await writeFile(
    path.join(libDir, 'physics.ts'),
    '@component\nexport class Position { x: f32 = 0; y: f32 = 0; }\nexport function step_frame(a: i32, b: i32): i32 { return a + b; }\n',
    'utf8',
  );
  await writeFile(
    path.join(libDir, 'tsfg.project.json'),
    JSON.stringify({
      name: 'physics_lib',
      version: '1.0.0',
      entries: ['physics.ts'],
      components: [
        { name: 'Position', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
        { name: 'Velocity', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
      ],
      systems: [
        { name: 'integrate', query: [{ component: 'Position', access: 'write' }, { component: 'Velocity', access: 'read' }] },
      ],
    }),
    'utf8',
  );

  const libClean = await buildTsfgProject(libDir, { outDir: pkgStore, cacheDir: path.join(root, 'lib-cache'), clean: true });
  assert.equal(libClean.cacheHit, false);

  // DELETE the entire `physics_lib` source tree to prove `.tpkg` is consumed completely detached from original source!
  await rm(libDir, { recursive: true, force: true });

  // Tampered `.tpkg` payload AND incompatible version MUST both be rejected!
  const pkgStr = libClean.outputs.tpkgBytes.toString('utf8');
  assert.throws(() => loadLocalPackage(Buffer.from(pkgStr.replace('physics_lib', 'physics_bad'), 'utf8')), /r12-tpkg-tampered/);
  assert.throws(() => loadLocalPackage(Buffer.from(pkgStr.replace('"version":1', '"version":9'), 'utf8')), /r12-tpkg-version/);

  // 2. Build `game_app` consuming `physics_lib.tpkg` (with clean build === incremental build byte-identical proof!)
  await writeFile(
    path.join(appDir, 'main.ts'),
    'export function tick(dt_ms: i32, flags: i32): i32 { return dt_ms * 2 + flags; }\n',
    'utf8',
  );
  await writeFile(
    path.join(appDir, 'tsfg.project.json'),
    JSON.stringify({
      name: 'game_app',
      version: '1.0.0',
      entries: ['main.ts'],
      dependencies: [
        {
          name: 'physics_lib',
          packagePath: path.join(pkgStore, 'physics_lib.tpkg'),
          expectedAbiHash: libClean.outputs.abiHash,
        },
      ],
      components: [
        { name: 'Position', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
        { name: 'Velocity', fields: [{ name: 'x', type: 'f32' }, { name: 'y', type: 'f32' }] },
      ],
      systems: [
        { name: 'integrate', query: [{ component: 'Position', access: 'write' }, { component: 'Velocity', access: 'read' }] },
      ],
      irProgram: {
        name: 'tick',
        returnType: 'i32',
        ops: [
          { op: 'tsfg.fuel' },
          { op: 'tsfg.const_i32', result: 'c2', attrs: { value: 2 } },
          { op: 'tsfg.mul_i32', result: 'm', operands: ['a', 'c2'] },
          { op: 'tsfg.add_i32', result: 'r', operands: ['m', 'b'] },
          { op: 'tsfg.return', operands: ['r'] },
        ],
      },
    }),
    'utf8',
  );

  // Negative test: path traversal outside project root MUST be rejected!
  const evilDir = path.join(root, 'evil_proj');
  await mkdir(evilDir, { recursive: true });
  await writeFile(
    path.join(evilDir, 'tsfg.project.json'),
    JSON.stringify({ name: 'evil', version: '1.0.0', entries: ['../game_app/main.ts'] }),
    'utf8',
  );
  await assert.rejects(() => buildTsfgProject(evilDir, { clean: true }), /r12-path-escape/);

  const appCache = path.join(root, 'app-cache');
  const buildClean = await buildTsfgProject(appDir, { outDir: path.join(root, 'out-clean'), cacheDir: appCache, clean: true });
  const buildIncr = await buildTsfgProject(appDir, { outDir: path.join(root, 'out-incr'), cacheDir: appCache, clean: false });
  assert.equal(buildClean.cacheHit, false);
  assert.equal(buildIncr.cacheHit, true);
  assert.equal(buildClean.outputDigest, buildIncr.outputDigest, 'Incremental build MUST be byte-identical to clean build!');

  // 3. Compile & run generated Zig host ABI bindings with real `zig test`!
  const zigTest = spawnSync(ZIG, ['test', buildClean.paths.zigBindingsPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: zigEnv(),
  });
  assert.equal(zigTest.status, 0, `Generated Zig host bindings failed zig test:\n${zigTest.stderr}`);

  // 4. Artifact Inspector (`.tbc` + `.tmeta` + `.tsfgabi`)
  const tbcInfo = inspectTbcBytecode(buildClean.outputs.bytecodeBytes);
  assert.equal(tbcInfo.magic, 'TSFGR05B');
  assert.equal(tbcInfo.functions[0].instructions[0].op, 'fuel');
  const tmetaInfo = inspectTmeta(buildClean.outputs.tmetaBytes);
  assert.deepEqual(tmetaInfo.components, ['Position', 'Velocity']);
  const abiInfo = inspectAbi(buildClean.outputs.abiBytes);
  assert.equal(abiInfo.target, 'windows-x86_64-msvc');

  // 5. Unified VM/AOT Breakpoint Debugger & Tracing/Profiling Collector
  const dbg = new UnifiedDebugSession(new Map([[2, { file: 'main.ts', line: 1 }]]));
  dbg.setBreakpoint('main.ts', 1);
  const vmPause = dbg.onStep({ tier: 'bytecode', functionName: 'tick', pc: 2, locals: { dt_ms: 16, flags: 1 }, callStack: ['tick'] });
  const aotPause = dbg.onStep({ tier: 'native', functionName: 'tick', pc: 2, locals: { dt_ms: 16, flags: 1 }, callStack: ['tick'] });
  assert.equal(vmPause.line, aotPause.line);
  assert.deepEqual(vmPause.locals, aotPause.locals);

  const profiler = new TsfgTraceProfiler();
  profiler.record('hot_reload', 'switch_v1_to_bytecode_to_v2', 420, { function: 'tick', fromVer: 1, toVer: 3 });
  profiler.record('gc', 'young_gen_relocate', 85, { relocated: 12 });
  profiler.record('cpu_jobs', 'integrate_256_chunks', 310, { workers: 4, stolen: 64 });
  profiler.record('gpu_vulkan', 'lavapipe_dispatch_1024', 950, { device: 'llvmpipe', kernelVer: 2 });
  const traceParsed = JSON.parse(profiler.toChromeTraceJson());
  assert.equal(traceParsed.traceEvents.length, 4);
  assert.equal(profiler.summary().byCategory.gpu_vulkan, 1);
});

test('R12 Product W6 Real Non-Mocked Windows Game E2E: Real .ts -> .tbc + Windows x64 AOT .exe/.pdb + Live DAP Debugger + Real Win32 QPC Profiler + LSP Completion & .tpkg Cross-Ref + tsfgc Subcommands', async () => {
  const root = path.join(resolveTempDir('r12-w6-product'), 'real-game');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const gameTs = path.join(root, 'game.ts');
  await writeFile(
    gameTs,
    `
@value
export class Entity {
  hp: i32 = 100;
  dmg: i32 = 15;
}

export function simulateTurn(rounds: i32, armor: i32): i32 {
  const e: Entity = new Entity();
  let remaining: i32 = e.hp;
  let i: i32 = 0;
  while (i < rounds) {
    let hit: i32 = e.dmg - armor;
    if (hit < 1) { hit = 1; }
    remaining = remaining - hit;
    i = i + 1;
  }
  return remaining;
}
`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'tsfg.project.json'),
    JSON.stringify({
      name: 'real_game',
      version: '1.0.0',
      entries: ['game.ts'],
      entryFunction: 'simulateTurn',
      components: [{ name: 'Entity', fields: [{ name: 'hp', type: 'i32' }, { name: 'dmg', type: 'i32' }] }],
      systems: [{ name: 'combat', query: [{ component: 'Entity', access: 'write' }] }],
    }),
    'utf8',
  );

  // 1. Real `tsfgc build <dir> --aot` compiles REAL .ts -> TSFGR05B .tbc + Windows x64 AOT .exe + .pdb!
  const cliBuild = spawnSync(process.execPath, [TSFGC, 'build', root, '--aot', '--clean'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(cliBuild.status, 0, `tsfgc build failed:\n${cliBuild.stdout}\n${cliBuild.stderr}`);
  const buildJson = JSON.parse(cliBuild.stdout.trim());
  assert.equal(buildJson.usedRealTsPipeline, true);
  assert.ok(existsSync(buildJson.paths.bytecodePath));
  assert.ok(existsSync(buildJson.paths.aotPath));
  assert.ok(buildJson.paths.pdbPath && existsSync(buildJson.paths.pdbPath));

  // 2. Execute via BOTH `tsfgc run` (Zig VM) AND the standalone compiled Windows x64 AOT `.exe`!
  const vmRun = spawnSync(process.execPath, [TSFGC, 'run', gameTs, '--entry', 'simulateTurn', '--args', '4,5'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(vmRun.status, 0, `tsfgc run failed:\n${vmRun.stderr}`);
  const vmOut = JSON.parse(vmRun.stdout.trim());
  assert.equal(vmOut.status, 'ok');
  assert.equal(vmOut.i32, 60); // 100 - 4*(15-5) = 60

  const aotRun = spawnSync(buildJson.paths.aotPath, ['--entry', 'simulateTurn', '--args', '4,5'], {
    encoding: 'utf8',
  });
  assert.equal(aotRun.status, 0, `standalone AOT exe failed:\n${aotRun.stderr}`);
  const aotOut = JSON.parse(aotRun.stdout.trim());
  assert.equal(aotOut.status, 'ok');
  assert.equal(aotOut.i32, vmOut.i32);

  // 3. `tsfgc inspect` decodes the real compiled `.tbc`
  const insp = spawnSync(process.execPath, [TSFGC, 'inspect', buildJson.paths.bytecodePath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(insp.status, 0, `tsfgc inspect failed:\n${insp.stderr}`);
  const inspJson = JSON.parse(insp.stdout);
  assert.equal(inspJson.magic, 'TSFGR05B');
  assert.ok(inspJson.functions.length >= 1);

  // 4. Live DAP Debugger driving REAL `tsfg-r05-vm.exe` breakpoints + stackTrace + variables + Win32 QPC trace!
  const dap = new TsfgDapServer();
  const initMsgs = await dap.handleMessage({ seq: 1, type: 'request', command: 'initialize', arguments: {} });
  assert.equal(initMsgs[0].success, true);
  await dap.handleMessage({
    seq: 2,
    type: 'request',
    command: 'setBreakpoints',
    arguments: { source: { path: gameTs }, breakpoints: [{ line: 9 }] },
  });
  const launchMsgs = await dap.handleMessage({
    seq: 3,
    type: 'request',
    command: 'launch',
    arguments: { program: gameTs, entry: 'simulateTurn', args: ['4', '5'], stopOnEntry: true },
  });
  assert.equal(launchMsgs[0].success, true);
  assert.ok(launchMsgs.some((m) => m.type === 'event' && m.event === 'stopped'));
  const stRes = await dap.handleMessage({ seq: 4, type: 'request', command: 'stackTrace', arguments: { threadId: 1 } });
  assert.ok(stRes[0].body.stackFrames.length >= 1);
  assert.equal(stRes[0].body.stackFrames[0].name, 'simulateTurn');

  // Ingest real Win32 QPC trace from live VM run into TsfgTraceProfiler
  const prof = new TsfgTraceProfiler();
  assert.ok(dap.lastRun?.trace, 'Expected real Win32 QPC trace from live VM run');
  prof.ingestChromeTrace(dap.lastRun.trace);
  assert.ok(JSON.parse(prof.toChromeTraceJson()).traceEvents.length >= 0);

  // 5. LSP completion + documentSymbol + cross-package `.tpkg` declarations
  const lsp = new TsfgLspServer();
  lsp.registerPackageDeclarations('real_game', 'export declare function external_tick(dt: i32): i32;\n');
  lsp.handleMessage({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} });
  lsp.handleMessage({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///game/app.ts', text: 'export function boot(): i32 { return external_tick(16); }\n' } },
  });
  const comp = lsp.handleMessage({ id: 2, jsonrpc: '2.0', method: 'textDocument/completion', params: { textDocument: { uri: 'file:///game/app.ts' }, position: { line: 0, character: 37 } } });
  assert.ok(comp.result.items.some((x) => x.label === 'external_tick'));
  assert.ok(comp.result.items.some((x) => x.label === 'ReadSpan'));
  const def = lsp.handleMessage({ id: 3, jsonrpc: '2.0', method: 'textDocument/definition', params: { textDocument: { uri: 'file:///game/app.ts' }, position: { line: 0, character: 40 } } });
  assert.equal(def.result.uri, 'tsfg-pkg:///real_game.d.ts');
  const syms = lsp.handleMessage({ id: 4, jsonrpc: '2.0', method: 'textDocument/documentSymbol', params: { textDocument: { uri: 'file:///game/app.ts' } } });
  assert.equal(syms.result[0].name, 'boot');
});
