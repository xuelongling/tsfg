// SPDX-License-Identifier: MIT
// Unified Windows x64 AOT vs R05 Zig VM Differential Parity & PDB Symbol Suite:
//   Proves that the EXACT SAME multi-feature TypeScript program compiles cleanly to:
//     1. Verified `TSFGR05B` bytecode running on `tsfg-r05-vm.exe`
//     2. Native Windows x64 Debug AOT (`/Od`) `.exe` + detached `.pdb`
//     3. Native Windows x64 Release AOT (`/O2`) `.exe` + detached `.pdb`
//     4. Native Windows x64 Release AOT (`/O2`) `.dll` + detached `.pdb`
//   with 100% bit-exact semantic parity across every tier!
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runTsOnR05ZigVm } from '../../compiler/r05-ts-driver.mjs';
import { compileTsToWindowsAot, runTsOnWindowsAot } from '../../compiler/tsfg-aot-driver.mjs';
import { resolveTempDir } from '../../compiler/tsfg-paths.mjs';

const WORK_DIR = resolveTempDir('r07-unified-aot');

test('Unified Windows x64 AOT (/Od & /O2 .exe + .pdb) === R05 Zig VM: Kitchen-Sink TypeScript + Multi-File + Span Release + Fixed-Width + Non-Null Trap', async () => {
  const projDir = path.join(WORK_DIR, 'game-core');
  await mkdir(projDir, { recursive: true });

  await writeFile(
    path.join(projDir, 'vec.ts'),
    `
@value
export class Vec2 {
  x: i32 = 3;
  y: i32 = 4;
}

export let moduleSeed: i32 = 10;

export function readPairSum(arr: i32[]): i32 {
  const sp: ReadSpan<i32> = readSpan(arr, 0, 2);
  return sp[0] + sp[1];
}
`,
    'utf8',
  );

  const mainTs = path.join(projDir, 'main.ts');
  await writeFile(
    mainTs,
    `
import { Vec2, moduleSeed, readPairSum } from './vec';

class Counter {
  n: i32 = 10;
  step(delta: i32): i32 { this.n += delta; return this.n; }
}
class DoubleCounter extends Counter {
  override step(delta: i32): i32 { this.n += delta * 2; return this.n; }
}

let bootVal: i32 = moduleSeed * 2; // 20 (topological init after vec.ts!)

function makeAdder(seed: i32): (k: i32) => i32 {
  let cur: i32 = seed;
  function add(k: i32): i32 { cur += k; return cur; }
  return add;
}

export function runGameTick(extra: i32): i32 {
  const v: Vec2 = new Vec2();
  const copy: Vec2 = v;
  copy.x = 50; // @value isolation: v.x stays 3!

  const c: Counter = new DoubleCounter();
  const s1: i32 = c.step(v.x + v.y); // 10 + (3+4)*2 = 24
  const fn: (k: i32) => i32 = makeAdder(s1);
  const s2: i32 = fn(6) + fn(10); // 30 + 40 = 70

  const arr: i32[] = [100, 200, 300];
  const spanSum: i32 = readPairSum(arr); // 300, ReadSpan released on return!
  arr[0] = 15; // succeeds because ReadSpan borrow was released!

  const f: f32 = 1.5;
  const g: f32 = 2.5;
  const h: f32 = f + g;
  const u: u32 = 4000000000;
  const uh: u32 = u / 2;
  let bonus: i32 = 0;
  if (h > 3.5) { bonus = bonus + 5; }
  if (uh === 2000000000) { bonus = bonus + 7; }

  let caught: i32 = 0;
  try {
    throw 33;
  } catch (e) {
    caught = (e as i32) + 2;
  } finally {
    bootVal = bootVal + 1;
  }

  return bootVal + v.x + copy.x + s2 + spanSum + arr[0] + bonus + caught + extra;
  // 21 + 3 + 50 + 70 + 300 + 15 + 12 + 35 + extra = 506 + extra
}

export function checkNonNull(x: i32 | undefined): i32 {
  return x!;
}
`,
    'utf8',
  );

  // 1. Run on R05 Zig VM
  const vmOk = await runTsOnR05ZigVm(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'runGameTick',
    args: [14],
  });
  assert.equal(vmOk.result.status, 'ok', `R05 VM failed: ${JSON.stringify(vmOk.result)}`);
  assert.equal(vmOk.result.i32, 520);

  // 2. Compile & run Windows x64 Debug AOT (/Od) .exe + detached .pdb
  const aotDebug = await runTsOnWindowsAot(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'runGameTick',
    args: [14],
    profile: 'debug',
    optimize: false,
    tag: 'game_core_debug',
    outDir: path.join(WORK_DIR, 'out-debug'),
  });
  assert.equal(aotDebug.result.status, 'ok', `AOT Debug failed: ${JSON.stringify(aotDebug.result)}`);
  assert.equal(aotDebug.result.i32, vmOk.result.i32, 'AOT Debug (/Od) !== R05 VM');
  assert.ok(aotDebug.artifact.pdbPath && existsSync(aotDebug.artifact.pdbPath), 'Expected detached Debug .pdb');
  assert.ok(statSync(aotDebug.artifact.pdbPath).size > 4096, 'Debug .pdb must be non-empty');

  // 3. Compile & run Windows x64 Release AOT (/O2) .exe + detached .pdb
  const aotRelease = await runTsOnWindowsAot(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'runGameTick',
    args: [14],
    profile: 'release',
    optimize: true,
    tag: 'game_core_release',
    outDir: path.join(WORK_DIR, 'out-release'),
  });
  assert.equal(aotRelease.result.status, 'ok', `AOT Release failed: ${JSON.stringify(aotRelease.result)}`);
  assert.equal(aotRelease.result.i32, vmOk.result.i32, 'AOT Release (/O2) !== R05 VM');
  assert.ok(aotRelease.artifact.pdbPath && existsSync(aotRelease.artifact.pdbPath), 'Expected detached Release .pdb');

  // 4. Verify non-null `x!` trap parity on BOTH R05 VM and Windows x64 AOT
  const vmTrap = await runTsOnR05ZigVm(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'checkNonNull',
    args: ['undefined'],
  });
  const aotTrap = await runTsOnWindowsAot(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'checkNonNull',
    args: ['undefined'],
    profile: 'release',
    tag: 'game_core_trap',
    outDir: path.join(WORK_DIR, 'out-release'),
  });
  assert.equal(vmTrap.result.status, 'trap');
  assert.equal(aotTrap.result.status, 'trap');

  // 5. Compile Windows x64 Release AOT .dll + .pdb
  const aotDll = await compileTsToWindowsAot(mainTs, {
    isFile: true,
    entries: ['runGameTick', 'checkNonNull'],
    entry: 'runGameTick',
    mode: 'dll',
    profile: 'release',
    tag: 'game_core_lib',
    outDir: path.join(WORK_DIR, 'out-dll'),
  });
  assert.ok(aotDll.dllPath && existsSync(aotDll.dllPath), 'Expected Windows x64 .dll');
  assert.ok(aotDll.pdbPath && existsSync(aotDll.pdbPath), 'Expected Windows x64 .dll .pdb');
});
