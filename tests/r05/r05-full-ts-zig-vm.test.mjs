// SPDX-License-Identifier: MIT
// Unified Full-Feature Zig TypeScript VM E2E Parity & Forbidden-Feature Rejection Suite:
//   Real `.ts` file -> `tooling/tsfgc.mjs --ts` -> Go TypeScript Frontend -> HIR -> Core MLIR
//   -> `compiler/r05-bytecode-lower.mjs` (TSFGR05B) -> `runtime/r05-vm.zig` (`tsfg-r05-vm.exe`)
//   === `CommonCoreVm` === Independent Semantic Oracle!
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CommonCoreVm } from '../../compiler/common-vm.mjs';
import { compileTsSourceToR05Bytecode, runTsOnR05ZigVm } from '../../compiler/r05-ts-driver.mjs';
import { resolveTempDir, resolveZigCacheEnv, resolveZigExe } from '../../compiler/tsfg-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSFGC = path.join(REPO_ROOT, 'tooling', 'tsfgc.mjs');
const ZIG_EXE = resolveZigExe();
const WORK_DIR = resolveTempDir('r05-full-ts-vm');

async function verifyParityWithCommonVm(source, entry, args = [], expected = {}) {
  const unfused = await runTsOnR05ZigVm(source, { entry, args, unfused: true });
  const fused = await runTsOnR05ZigVm(source, { entry, args, unfused: false });

  // Compare unfused vs fused R05 Zig VM
  assert.equal(fused.result.status, unfused.result.status, `${entry}: fused vs unfused status mismatch`);
  assert.equal(fused.result.tag, unfused.result.tag, `${entry}: fused vs unfused tag mismatch`);
  assert.equal(fused.result.i32, unfused.result.i32, `${entry}: fused vs unfused i32 mismatch`);
  assert.equal(fused.result.f64Bits, unfused.result.f64Bits, `${entry}: fused vs unfused f64Bits mismatch`);
  assert.equal(fused.result.fuelConsumed, unfused.result.fuelConsumed, `${entry}: fused vs unfused fuel mismatch`);

  // Compare against CommonCoreVm oracle on the exact same canonical MLIR
  const cvm = new CommonCoreVm(unfused.compiled.canonicalMlir);
  const cvmArgs = args.map((a) => {
    if (a === 'undefined') return undefined;
    if (a === 'null') return null;
    if (a === 'true') return true;
    if (a === 'false') return false;
    return typeof a === 'number' ? a : Number(a);
  });
  const cvmRes = cvm.callExport(entry, cvmArgs);

  if (expected.status === 'trap') {
    assert.equal(fused.result.status, 'trap', `${entry}: expected trap, got ${JSON.stringify(fused.result)}`);
    assert.ok((cvmRes.trap ?? 0) !== 0, `${entry}: CommonCoreVm expected trap`);
  } else if (expected.status === 'managed_exception') {
    assert.equal(fused.result.status, 'managed_exception', `${entry}: expected managed_exception`);
    assert.equal(cvmRes.status, 'throw', `${entry}: CommonCoreVm expected throw`);
  } else {
    assert.equal(fused.result.status, 'ok', `${entry}: expected ok, got ${JSON.stringify(fused.result)}`);
    assert.equal(cvmRes.trap ?? 0, 0, `${entry}: CommonCoreVm unexpected trap ${cvmRes.trap}`);
    if (expected.i32 !== undefined) {
      assert.equal(fused.result.i32, expected.i32, `${entry}: R05 Zig VM value mismatch`);
      assert.equal(cvmRes.i32, expected.i32, `${entry}: CommonCoreVm value mismatch`);
    }
  }
  return fused.result;
}

test('R05 Unified Zig TS VM: Full Kitchen-Sink TypeScript (@tsfgValue, Inheritance, Virtual Override, Closures, Module Globals, Array, ReadSpan, try/catch/finally vs Trap)', async () => {
  const rawTs = `
@tsfgValue
class Vec2 { x: i32 = 3; y: i32 = 2; }

class Counter {
  n: i32 = 10;
  step(delta: i32): i32 { this.n += delta; return this.n; }
}
class DoubleCounter extends Counter {
  override step(delta: i32): i32 { this.n += delta * 2; return this.n; }
}

let acc: i32 = 5;

function makeAdder(seed: i32): (k: i32) => i32 {
  let cur: i32 = seed;
  function add(k: i32): i32 { cur += k; return cur; }
  return add;
}

export function runAll(idx: u32): i32 {
  const v: Vec2 = new Vec2();
  const copy: Vec2 = v;
  copy.x = 999; // @tsfgValue copy isolation: v.x MUST stay 3!

  const c: Counter = new DoubleCounter();
  const s1: i32 = c.step(v.x + v.y); // virtual dispatch -> DoubleCounter.step(5) = 10 + 10 = 20
  const f: (k: i32) => i32 = makeAdder(s1);
  const s2: i32 = f(4) + f(6);       // 24 + 30 = 54
  const arr: i32[] = [100, 200, 300];
  const sp: ReadSpan<i32> = readSpan(arr, 0, 3);
  let picked: i32 = 0;
  try {
    throw sp[idx];
  } catch (e) {
    picked = e as i32;
  } finally {
    acc += 1;
  }
  return s2 + picked + acc + copy.x; // 54 + 200 + 6 + 999 = 1259
}
`;
  // Valid idx=1: 54 + 200 + 6 + 999 = 1259
  await verifyParityWithCommonVm(rawTs, 'runAll', [1], { i32: 1259 });
  // Out-of-bounds ReadSpan idx=5 -> traps bounds, bypasses catch & finally!
  await verifyParityWithCommonVm(rawTs, 'runAll', [5], { status: 'trap' });
});

test('R05 Unified Zig TS VM: Cross-Function Exceptions (try/catch/finally) vs Division-by-Zero Trap Skipping finally', async () => {
  const tsSource = `
let finallyRan: i32 = 0;

function risky(x: i32): i32 {
  if (x < 0) {
    throw 42;
  }
  return x * 2;
}

export function testTryCatchFinally(x: i32): i32 {
  let out: i32 = 0;
  try {
    out = risky(x);
  } catch (e) {
    out = (e as i32) + 8;
  } finally {
    finallyRan = 100;
    out = out + finallyRan;
  }
  return out;
}

export function testTrapSkipsFinally(d: i32): i32 {
  let out: i32 = 1;
  try {
    out = 10 / d;
  } finally {
    finallyRan = 777;
  }
  return out;
}
`;
  await verifyParityWithCommonVm(tsSource, 'testTryCatchFinally', [5], { i32: 110 });
  await verifyParityWithCommonVm(tsSource, 'testTryCatchFinally', [-1], { i32: 150 });
  await verifyParityWithCommonVm(tsSource, 'testTrapSkipsFinally', [0], { status: 'trap' });
});

test('R05 Unified Zig TS VM: Unions, Nullish Narrowing, Non-Null ! Trap, Strict f64, INT32_MIN Edge Cases & ReadSpan.length Loop', async () => {
  const tsSource = `
export function classifyNullish(x: i32 | undefined | null): i32 {
  if (x === undefined) { return -1; }
  if (x === null) { return -2; }
  return 1;
}

export function nonNullPlus(x: i32 | undefined): i32 {
  return x! + 5;
}

export function spanAndFloat(n: i32): i32 {
  const a: i32[] = [10, 20, 30, 40];
  const s: ReadSpan<i32> = readSpan(a, 1, 2);
  let total: i32 = 0;
  let i: u32 = 0;
  while (i < s.length) {
    total = total + s[i];
    i = i + 1;
  }
  const f: f64 = 1.5 + 2.5;
  if (f > 3.5) {
    total = total + n;
  }
  return total;
}
`;
  await verifyParityWithCommonVm(tsSource, 'classifyNullish', ['undefined'], { i32: -1 });
  await verifyParityWithCommonVm(tsSource, 'classifyNullish', ['null'], { i32: -2 });
  await verifyParityWithCommonVm(tsSource, 'classifyNullish', [23], { i32: 1 });
  await verifyParityWithCommonVm(tsSource, 'nonNullPlus', [17], { i32: 22 });
  await verifyParityWithCommonVm(tsSource, 'nonNullPlus', ['undefined'], { status: 'trap' });
  await verifyParityWithCommonVm(tsSource, 'spanAndFloat', [7], { i32: 57 }); // (20+30) + 7 = 57
});

test('R05 Unified Zig TS VM: Direct `tsfgc.mjs --ts` CLI Execution & `--emit r05-bytecode`', async () => {
  await mkdir(WORK_DIR, { recursive: true });
  const tsFile = path.join(WORK_DIR, 'direct_cli_sample.ts');
  await writeFile(
    tsFile,
    `export function compute(a: i32, b: i32): i32 {\n  let total: i32 = a;\n  let i: i32 = 0;\n  while (i < b) {\n    total = total + i;\n    i = i + 1;\n  }\n  return total;\n}\n`,
    'utf8',
  );

  // Execute directly via unified `tooling/tsfgc.mjs --ts <file.ts> --entry compute --args 10,5`!
  const cli = spawnSync(process.execPath, [TSFGC, '--ts', tsFile, '--entry', 'compute', '--args', '10,5'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, `tsfgc --ts failed:\n${cli.stdout}\n${cli.stderr}`);
  const out = JSON.parse(cli.stdout.trim());
  assert.equal(out.status, 'ok');
  assert.equal(out.i32, 20); // 10 + (0+1+2+3+4) = 20

  // Also verify `--emit r05-bytecode` produces valid TSFGR05B binary bytes
  const emitBc = spawnSync(process.execPath, [TSFGC, '--ts', tsFile, '--entry', 'compute', '--emit', 'r05-bytecode'], {
    cwd: REPO_ROOT,
  });
  assert.equal(emitBc.status, 0, `tsfgc --emit r05-bytecode failed:\n${emitBc.stderr.toString('utf8')}`);
  assert.equal(emitBc.stdout.subarray(0, 8).toString('ascii'), 'TSFGR05B');
});

test('R05 Zig VM Native Unit Suite: Lossless UTF-16 Strings (incl. Lone Surrogates), Fixed-Width Numerics, DebugHook & GC Relocation', () => {
  const res = spawnSync(ZIG_EXE, ['test', path.join(REPO_ROOT, 'runtime', 'r05-vm-test.zig')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: resolveZigCacheEnv(),
  });
  assert.equal(res.status, 0, `zig test r05-vm-test.zig failed:\n${res.stdout}\n${res.stderr}`);
});

test('R05 Unified Zig TS VM: Multi-File TS Imports, Topological $moduleInit, @value Alias, Span Release, Live Breakpoint & Win32 QPC Trace', async () => {
  const projDir = path.join(WORK_DIR, 'multi-file-mod');
  await mkdir(projDir, { recursive: true });
  await writeFile(
    path.join(projDir, 'math.ts'),
    `
@value
export class Pair {
  a: i32 = 10;
  b: i32 = 20;
}

export let initCounter: i32 = 7;

export function sumSpan(arr: i32[]): i32 {
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
import { Pair, initCounter, sumSpan } from './math';

let derivedInit: i32 = initCounter * 3; // 21 (proves math.ts initialized BEFORE main.ts!)

export function runMulti(extra: i32): i32 {
  const p: Pair = new Pair();
  const q: Pair = p;
  q.a = 100; // @value copy isolation: p.a remains 10!
  const arr: i32[] = [5, 6];
  const s: i32 = sumSpan(arr); // ReadSpan released on return!
  arr[0] = 9; // MUST succeed because ReadSpan borrow was released on return!
  return derivedInit + p.a + q.a + s + arr[0] + extra; // 21 + 10 + 100 + 11 + 9 + extra = 151 + extra
}
`,
    'utf8',
  );

  const tracePath = path.join(projDir, 'vm-trace.json');
  const { result } = await runTsOnR05ZigVm(mainTs, {
    isFile: true,
    entry: 'runMulti',
    args: [4],
    breakpointPc: 0,
    profileTrace: tracePath,
  });
  assert.equal(result.status, 'ok', `runMulti failed: ${JSON.stringify(result)}`);
  assert.equal(result.i32, 155);
  assert.ok(Array.isArray(result.debugPauses) && result.debugPauses.length >= 1, 'Expected live VM breakpoint debug pause');
  assert.equal(result.debugPauses[0].pc, 0);

  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  assert.ok(Array.isArray(trace.traceEvents), 'Expected Win32 QPC Chrome Trace JSON');
});

test('R05 Unified Zig TS VM: Exact f32, u32, and Direct-Return Non-Null ! Trap', async () => {
  const tsSource = `
export function directNonNull(x: i32 | undefined): i32 {
  return x!;
}

export function f32AndU32(): i32 {
  const a: f32 = 1.5;
  const b: f32 = 2.5;
  const c: f32 = a + b;
  const u: u32 = 4000000000;
  const half: u32 = u / 2;
  let ok: i32 = 0;
  if (c > 3.5) { ok = ok + 10; }
  if (half === 2000000000) { ok = ok + 20; }
  return ok;
}
`;
  const okRes = await runTsOnR05ZigVm(tsSource, { entry: 'f32AndU32' });
  assert.equal(okRes.result.status, 'ok', `f32AndU32 failed: ${JSON.stringify(okRes.result)}`);
  assert.equal(okRes.result.i32, 30);

  const nnOk = await runTsOnR05ZigVm(tsSource, { entry: 'directNonNull', args: [42] });
  assert.equal(nnOk.result.status, 'ok');
  assert.equal(nnOk.result.i32, 42);

  const nnTrap = await runTsOnR05ZigVm(tsSource, { entry: 'directNonNull', args: ['undefined'] });
  assert.equal(nnTrap.result.status, 'trap');
});

test('R05 Unified Zig TS VM: Strict Architecture Contract Rejections (.js, any, eval, Proxy, loose ==, __proto__, delete)', () => {
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(): i32 { return 1; }', { filePath: '/src/bad.js', entry: 'f' }), /r01-forbid-js-file/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(x: any): i32 { return 1; }', { entry: 'f' }), /r01-forbid-any/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(): i32 { eval("1"); return 1; }', { entry: 'f' }), /r01-forbid-eval/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(): i32 { const p = new Proxy({}, {}); return 1; }', { entry: 'f' }), /r01-forbid-proxy/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(a: i32, b: i32): i32 { return a == b ? 1 : 0; }', { entry: 'f' }), /r01-forbid-loose-eq/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(o: { a: i32 }): i32 { Object.setPrototypeOf(o, null); return 1; }', { entry: 'f' }), /r01-forbid-proto/);
  assert.throws(() => compileTsSourceToR05Bytecode('export function f(o: { a?: i32 }): i32 { delete o.a; return 1; }', { entry: 'f' }), /r01-forbid-delete/);
});
