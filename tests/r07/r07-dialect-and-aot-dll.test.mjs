// SPDX-License-Identifier: MIT
// R07 Test Suite: `tsfg` Dialect Verifier, Auditable Optimization Pass Pipeline,
// Miscompile Regressions, Real Windows x64 LLD Patch DLL Emission, Zero-Compiler
// Zig Native Loader (`LoadLibraryW`), Live AOT GC StackMap Relocation, FunctionCell
// Hot Call, `tsfg.parallel_for`, Strict Float NaN, and Tampered Artifact Rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { functionId, sha256, signatureHash, WINDOWS_X64_TARGET } from '../../compiler/r04-identity.mjs';
import { printTsfgDialect, runR07OptimizationPipeline, verifyTsfgDialect } from '../../compiler/r07-tsfg-dialect.mjs';
import { compileTsfgPatchDll } from '../../compiler/r07-aot-backend.mjs';

const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const BUILD_DIR = process.env.TSFG_R07_BUILD_DIR ?? 'E:\\tsfg-build\\r07';

let cachedLoaderExe = null;
async function ensureR07LoaderExe() {
  if (cachedLoaderExe) return cachedLoaderExe;
  await mkdir(BUILD_DIR, { recursive: true });
  const exe = path.join(BUILD_DIR, 'tsfg-r07-loader.exe');
  const res = spawnSync(ZIG_EXE, [
    'build-exe', 'r07-aot-loader.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${exe}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(res.status, 0, `zig build-exe r07-aot-loader failed:\n${res.stderr.toString('utf8')}`);
  cachedLoaderExe = exe;
  return exe;
}

function buildR07FeatureModule() {
  const abiHash = sha256('r07-feature-abi-v1');
  const hotTargetId = functionId('/src/hot.ts', 'hotScale', 'i32', ['i32']);
  const hotSig = signatureHash('i32', ['i32']);
  const hotEff = sha256('effect:pure-hot');

  return {
    abiHash,
    functions: [
      {
        functionId: functionId('/src/r07.ts', 'aot_gc_and_hot_call', 'i32', ['i32']),
        name: 'aot_gc_and_hot_call',
        ops: [
          { op: 'tsfg.fuel', attrs: { event: 'entry' }, operands: [] },
          { op: 'tsfg.const_i32', result: 'c10', type: 'i32', attrs: { value: 10 }, operands: [] },
          { op: 'tsfg.const_i32', result: 'c5', type: 'i32', attrs: { value: 5 }, operands: [] },
          { op: 'tsfg.add_i32', result: 'folded15', type: 'i32', attrs: {}, operands: ['c10', 'c5'] }, // folded by canonicalize!
          { op: 'tsfg.add_i32', result: 'baseVal', type: 'i32', attrs: {}, operands: ['x', 'folded15'] },
          { op: 'tsfg.add_i32', result: 'dupVal', type: 'i32', attrs: {}, operands: ['x', 'folded15'] }, // eliminated by CSE!
          { op: 'tsfg.handle.alloc', result: 'obj', type: '!tsfg.handle<Box>', attrs: { edges: 0, scalars: 2, typeId: 401 }, operands: [] },
          { op: 'tsfg.handle.write', attrs: { fieldIdx: 0 }, operands: ['obj', 'baseVal'] },
          // AOT GC Safepoint: R06 GenGc genuinely relocates `obj` inside the native DLL's stack frame!
          {
            op: 'tsfg.safepoint',
            attrs: {
              frameSize: 64,
              pcOffset: 16,
              roots: [{ kind: 'live_ref', reg: 'obj', slotOffset: 0, tagOffset: -1 }],
            },
            operands: [],
          },
          // Read `obj.field[0]` AFTER moving GC relocation!
          { op: 'tsfg.handle.read', result: 'afterGc', type: 'i32', attrs: { fieldIdx: 0 }, operands: ['obj'] },
          // Hot-reloadable call via FunctionCell slot 3 (returns arg0 * 10 + 3)
          {
            op: 'tsfg.call_hot',
            result: 'hotRes',
            type: 'i32',
            attrs: { cellSlot: 3, effectHash: hotEff, functionId: hotTargetId, signatureHash: hotSig },
            operands: ['afterGc'],
          },
          { op: 'tsfg.add_i32', result: 'final', type: 'i32', attrs: {}, operands: ['hotRes', 'dupVal'] },
          { op: 'tsfg.return', operands: ['final'] },
        ],
        params: [{ name: 'x', type: 'i32' }],
        returnType: 'i32',
      },
      {
        functionId: functionId('/src/r07.ts', 'aot_parallel_add', 'i32', ['ptr', 'ptr', 'i32', 'i32']),
        name: 'aot_parallel_add',
        ops: [
          { op: 'tsfg.fuel', attrs: { event: 'entry' }, operands: [] },
          { op: 'tsfg.borrow.begin', result: 'bsrc', type: '!tsfg.borrow<i32, ro>', attrs: { knownStableLength: 5 }, operands: ['src'] },
          { op: 'tsfg.const_i32', result: 'idx2', type: 'i32', attrs: { value: 2 }, operands: [] },
          { op: 'tsfg.bounds_check', attrs: {}, operands: ['bsrc', 'idx2'] }, // eliminated by tsfg-bounds-check-elim!
          { op: 'tsfg.borrow.load', result: 'mid', type: 'i32', attrs: {}, operands: ['bsrc', 'idx2'] },
          { op: 'tsfg.borrow.end', attrs: {}, operands: ['bsrc'] },
          { op: 'tsfg.parallel_for', attrs: { body: [] }, operands: ['dst', 'src', 'count', 'delta'] },
          { op: 'tsfg.return', operands: ['mid'] },
        ],
        params: [
          { name: 'dst', type: 'ptr' },
          { name: 'src', type: 'ptr' },
          { name: 'count', type: 'i32' },
          { name: 'delta', type: 'i32' },
        ],
        returnType: 'i32',
      },
      {
        functionId: functionId('/src/r07.ts', 'aot_strict_f64_div', 'f64', ['f64', 'f64']),
        name: 'aot_strict_f64_div',
        ops: [
          { op: 'tsfg.fuel', attrs: { event: 'entry' }, operands: [] },
          { op: 'tsfg.div_f64', result: 'q', type: 'f64', attrs: {}, operands: ['a', 'b'] },
          { op: 'tsfg.return', operands: ['q'] },
        ],
        params: [
          { name: 'a', type: 'f64' },
          { name: 'b', type: 'f64' },
        ],
        returnType: 'f64',
      },
    ],
    target: WINDOWS_X64_TARGET.target,
  };
}

test('R07 tsfg Dialect Verifier rejects illegal IR and Pass Pipeline preserves strict traps & audit trace', () => {
  const valid = buildR07FeatureModule();
  assert.equal(verifyTsfgDialect(valid), true);
  assert.ok(printTsfgDialect(valid).includes('tsfg.strict_fp = true'));

  // Negative 1: bare GC pointer in signature
  const bareGc = structuredClone(valid);
  bareGc.functions[0].params[0].type = '!tsfg.raw_gc_ptr';
  assert.throws(() => verifyTsfgDialect(bareGc), /r07-verify-bare-gc-ptr/);

  // Negative 2: unclosed / escaping borrow
  const leakBorrow = structuredClone(valid);
  leakBorrow.functions[1].ops = leakBorrow.functions[1].ops.filter((o) => o.op !== 'tsfg.borrow.end');
  assert.throws(() => verifyTsfgDialect(leakBorrow), /r07-verify-borrow-escape/);

  // Negative 3: GC allocation inside tsfg.parallel_for kernel
  const badKernel = structuredClone(valid);
  badKernel.functions[1].ops[6].attrs.body = [{ op: 'tsfg.handle.alloc', result: 'badObj', type: '!tsfg.handle<X>', attrs: {}, operands: [] }];
  assert.throws(() => verifyTsfgDialect(badKernel), /r07-verify-kernel-illegal/);

  // Negative 4: fast-math / FMA attribute forbidden in strict dialect
  const badFp = structuredClone(valid);
  badFp.functions[2].ops[1].attrs = { fastMath: true };
  assert.throws(() => verifyTsfgDialect(badFp), /r07-verify-strict-fp/);

  // Auditable Pass Pipeline check: verifies canonicalize, CSE, bounds-check-elim, and safepoint-liveness!
  const pipe = runR07OptimizationPipeline(valid, { optLevel: 'O2' });
  const byPass = new Map(pipe.audit.map((a) => [a.pass, a]));
  assert.ok(byPass.get('tsfg-canonicalize').eliminatedOps >= 1, 'canonicalize folds pure c10 + c5');
  assert.ok(byPass.get('tsfg-cse').eliminatedOps >= 1, 'CSE eliminates duplicate x + folded15');
  assert.ok(byPass.get('tsfg-bounds-check-elim').eliminatedOps === 1, 'bounds-check-elim removes proven in-bounds check');
  assert.equal(pipe.stackMapsByFn.get('aot_gc_and_hot_call').length, 1);

  // Miscompile regression: trapping 1 / 0 MUST NEVER be folded away by canonicalize!
  const trapMod = {
    abiHash: sha256('trap-reg'),
    functions: [{
      functionId: functionId('/src/t.ts', 'divz', 'i32', []),
      name: 'divz',
      ops: [
        { op: 'tsfg.fuel', attrs: { event: 'entry' }, operands: [] },
        { op: 'tsfg.const_i32', result: 'a', type: 'i32', attrs: { value: 1 }, operands: [] },
        { op: 'tsfg.const_i32', result: 'b', type: 'i32', attrs: { value: 0 }, operands: [] },
        { op: 'tsfg.div_i32', result: 'q', type: 'i32', attrs: {}, operands: ['a', 'b'] },
        { op: 'tsfg.return', operands: ['q'] },
      ],
      params: [],
      returnType: 'i32',
    }],
    target: WINDOWS_X64_TARGET.target,
  };
  const trapOpt = runR07OptimizationPipeline(trapMod, { optLevel: 'O2' });
  assert.ok(trapOpt.module.functions[0].ops.some((o) => o.op === 'tsfg.div_i32'), 'trapping div_i32 must survive O2');
});

test('R07 REAL Windows x64 LLD Patch DLL + Zig Loader: Live AOT GC Relocation, FunctionCell Hot Call, parallel_for, Strict NaN, and Tamper Rejection', async () => {
  const loaderExe = await ensureR07LoaderExe();
  const outDir = path.join(BUILD_DIR, 'feature-patch');
  const compiled = await compileTsfgPatchDll(buildR07FeatureModule(), outDir, {
    codeId: 1001,
    codeVersion: 1,
    optLevel: 'O2',
    tag: 'r07_feature',
  });

  // 1. Load & execute real Windows x64 DLL inside zero-compiler-dependency Zig R06Runtime!
  const run = spawnSync(loaderExe, ['patch-test', compiled.dllPath, compiled.tpatchPath], { windowsHide: true });
  assert.equal(run.status, 0, `R07 Zig loader failed:\n${run.stderr.toString('utf8')}`);
  const actual = JSON.parse(run.stdout.toString('utf8').trim());

  // Independent oracle:
  // x=7 -> baseVal = 7 + 15 = 22; written to obj.field[0]; AOT GC safepoint relocates obj (relocated >= 1)!
  // afterGc = 22; hotRes = 22 * 10 + 3 = 223; final = 223 + 22 = 245!
  // parallel_for: [10,20,30,40,50] + 3 = [13,23,33,43,53] -> sum = 165; mid = src[2] = 30
  // strict f64: 0.0 / 0.0 -> canonical quiet NaN 7ff8000000000000
  assert.equal(actual.gcRes, 245);
  assert.equal(actual.safepointsHit, 1);
  assert.ok(actual.relocated >= 1, `expected real young-gen relocation inside AOT DLL safepoint, got ${actual.relocated}`);
  assert.equal(actual.pforRet, 30);
  assert.equal(actual.pforSum, 165);
  assert.equal(actual.nanBits, '7ff8000000000000');
  assert.equal(actual.trap, 0);

  // 2. Negative: tampered DLL bytes on disk MUST be rejected before loading!
  const badDllPath = path.join(outDir, 'tampered.dll');
  const badBytes = Buffer.from(await readFile(compiled.dllPath));
  badBytes[badBytes.length - 1] ^= 0xff;
  await writeFile(badDllPath, badBytes);
  const badRun = spawnSync(loaderExe, ['patch-test', badDllPath, compiled.tpatchPath], { windowsHide: true });
  assert.equal(badRun.status, 4);
  assert.match(badRun.stderr.toString('utf8'), /r07-dll-digest-mismatch/);
});
