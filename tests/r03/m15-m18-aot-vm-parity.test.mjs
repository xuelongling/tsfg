// SPDX-License-Identifier: MIT
// Real Windows AOT (tsfg-aot.exe via --emit-program-object + runtime/aot-main.zig)
// vs production VM (tsfg-runtime.exe via --emit-bytecode) + independent mathematical oracles
// covering M15 (i32/bool), M16 (full integer family), M17 (strict f32/f64), and M18 (conversions & ordinary expressions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import aotFixtures from './aot-compiler-fixtures.mjs';
import { fn, ret, type, operation, moduleOf, complete as floatComplete, oracle as floatOracle } from './strict-floating-aot-fixtures.mjs';
import { ordinaryFacts, defaultFacts, optionalFacts } from './m18-ordinary-facts.mjs';
import { buildHir, lowerFormalHir, printHir, readHir } from '../../compiler/hir.mjs';
import { validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { sourceInput } from '../../compiler/pipeline.mjs';
import { prepareFrontendInput, materializeFrontendResponse } from '../../compiler/frontend-response.mjs';

const FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const VM_EXE = process.env.TSFG_VM_EXE ?? 'E:\\tsfg-build\\vm\\tsfg-runtime.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const RUNTIME_STAGE = process.env.TSFG_RUNTIME_STAGE ?? 'E:\\tsfg-build\\runtime-stage';
const RUNTIME_OBJS = process.env.TSFG_RUNTIME_OBJS ?? 'E:\\tsfg-build\\runtime-objs';
const AOT_BUILD_DIR = process.env.TSFG_AOT_BUILD_DIR ?? 'E:\\tsfg-build\\aot-parity';

const registry = JSON.parse(readFileSync(new URL('../../contracts/registry.json', import.meta.url), 'utf8'));
const conversionEntries = JSON.parse(readFileSync(new URL('../../contracts/conversion-entries.json', import.meta.url), 'utf8')).entries;

const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const functionIdOf = (name, params, result, sourcePath = '/src/main.ts') => {
  const sig = sha256Hex(`tsfg.signature\0(${params.join(',')})->${result}`);
  return `sha256:${sha256Hex(`tsfg.function\0${sourcePath}\0${name}\0${sig}`)}`;
};

function runCore(coreText, flag) {
  const res = spawnSync(CORE_EXE, [flag], {
    input: Buffer.from(coreText, 'utf8'),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

/**
 * Compile Core MLIR to BOTH:
 *  - bytecode (.tbc) for tsfg-runtime.exe VM
 *  - linked Windows native executable (tsfg-aot.exe) via --emit-program-object + aot-main.zig
 */
async function compileDualBackend(tag, coreText) {
  const dir = path.join(AOT_BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });

  // 1. Canonical round-trip check
  const canon1 = runCore(coreText, '--canonicalize');
  assert.equal(canon1.status, 0, `${tag} --canonicalize failed: ${canon1.stderr.toString('utf8')}`);
  const canon2 = runCore(canon1.stdout.toString('utf8'), '--canonicalize');
  assert.equal(canon2.status, 0, `${tag} round-trip failed: ${canon2.stderr.toString('utf8')}`);
  assert.deepEqual(canon2.stdout, canon1.stdout, `${tag} canonicalization is idempotent`);

  // 2. Emit VM bytecode
  const tbcRes = runCore(coreText, '--emit-bytecode');
  assert.equal(tbcRes.status, 0, `${tag} --emit-bytecode failed: ${tbcRes.stderr.toString('utf8')}`);
  const tbcBytes = tbcRes.stdout;

  // 3. Emit AOT COFF program object (ABI4 + tsfg_aot_program_v1 metadata)
  const objRes = runCore(coreText, '--emit-program-object');
  assert.equal(objRes.status, 0, `${tag} --emit-program-object failed: ${objRes.stderr.toString('utf8')}`);
  const objPath = path.join(dir, 'program.obj');
  await writeFile(objPath, objRes.stdout);

  // 4. Link real Windows tsfg-aot.exe
  const exePath = path.join(dir, 'tsfg-aot.exe');
  const linkRes = spawnSync(ZIG_EXE, [
    'build-exe', 'aot-main.zig',
    objPath,
    path.join(RUNTIME_OBJS, 'host_counter.obj'),
    path.join(RUNTIME_OBJS, 'host_counter_bridge.obj'),
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-ODebug', '-fno-lto',
    `-femit-bin=${exePath}`,
  ], {
    cwd: RUNTIME_STAGE,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (linkRes.error) throw linkRes.error;
  assert.equal(linkRes.status, 0, `${tag} zig build-exe failed:\n${linkRes.stderr.toString('utf8')}`);

  return { tbcBytes, exePath };
}

function executeDual(compiled, requests, flag = '--requests') {
  const aotOut = [];
  const vmOut = [];
  const batchSize = 16;
  for (let offset = 0; offset < requests.length; offset += batchSize) {
    const batch = requests.slice(offset, offset + batchSize).map((r) => ({
      memoryBytes: 524288,
      ...r,
    }));
    const payload = JSON.stringify(batch);
    const aotRes = spawnSync(compiled.exePath, [flag, payload], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (aotRes.error) throw aotRes.error;
    assert.equal(aotRes.status, 0, `AOT exited ${aotRes.status}: ${aotRes.stderr.toString('utf8')}`);
    const aotBatch = JSON.parse(aotRes.stdout.toString('utf8'));

    const vmRes = spawnSync(VM_EXE, [flag, payload], {
      input: compiled.tbcBytes,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (vmRes.error) throw vmRes.error;
    assert.equal(vmRes.status, 0, `VM exited ${vmRes.status}: ${vmRes.stderr.toString('utf8')}`);
    const vmBatch = JSON.parse(vmRes.stdout.toString('utf8'));

    assert.equal(aotBatch.length, batch.length);
    assert.equal(vmBatch.length, batch.length);
    aotOut.push(...aotBatch);
    vmOut.push(...vmBatch);
  }
  return { aotOut, vmOut };
}

function assertParity(aotRow, vmRow, label) {
  assert.deepEqual(aotRow, vmRow, `VM/AOT parity mismatch on ${label}`);
}

const i32Arg = (v) => ({ type: 'i32', value: String(v) });
const boolArg = (v) => ({ type: 'bool', value: v });
const floatArg = (t, hex) => ({ type: t, value: hex });

// ============================================================================
// M15: i32/bool Windows Formal AOT — Arithmetic, Calls, CFG, Traps, Budgets, Parity
// ============================================================================
test('M15: i32/bool Windows AOT & VM parity on wrapping, traps, short-circuit, calls, fuel/depth, and negative boundaries', async () => {
  const dyn = aotFixtures.positive.find((p) => p.id === 'dynamic-arithmetic');
  const calls = aotFixtures.positive.find((p) => p.id === 'complete-call-order');
  const cfg = aotFixtures.positive.find((p) => p.id === 'cfg-short-circuit-traps');

  const dynCompiled = await compileDualBackend('m15-dyn', dyn.input);
  const fnByName = (fixture, name) => fixture.functions.find((f) => f.name === name).functionId;

  const I32_MAX = 2147483647;
  const I32_MIN = -2147483648;
  const dynCases = [
    // Wrapping arithmetic
    { label: 'add-wrap', fn: 'add', args: [i32Arg(I32_MAX), i32Arg(1)], expectVal: { type: 'i32', value: String(I32_MIN) } },
    { label: 'sub-wrap', fn: 'sub', args: [i32Arg(I32_MIN), i32Arg(1)], expectVal: { type: 'i32', value: String(I32_MAX) } },
    { label: 'mul-wrap', fn: 'mul', args: [i32Arg(I32_MIN), i32Arg(-1)], expectVal: { type: 'i32', value: String(I32_MIN) } },
    { label: 'neg-min', fn: 'neg', args: [i32Arg(I32_MIN)], expectVal: { type: 'i32', value: String(I32_MIN) } },
    { label: 'not-zero', fn: 'not', args: [i32Arg(0)], expectVal: { type: 'i32', value: '-1' } },
    { label: 'and', fn: 'and', args: [i32Arg(0x0f0f), i32Arg(0x00ff)], expectVal: { type: 'i32', value: '15' } },
    { label: 'or', fn: 'or', args: [i32Arg(0x0f00), i32Arg(0x000f)], expectVal: { type: 'i32', value: String(0x0f0f) } },
    { label: 'xor', fn: 'xor', args: [i32Arg(-1), i32Arg(0)], expectVal: { type: 'i32', value: '-1' } },
    // Division & remainder edge cases + traps
    { label: 'div-min-neg1', fn: 'div', args: [i32Arg(I32_MIN), i32Arg(-1)], expectVal: { type: 'i32', value: String(I32_MIN) } },
    { label: 'rem-min-neg1', fn: 'rem', args: [i32Arg(I32_MIN), i32Arg(-1)], expectVal: { type: 'i32', value: '0' } },
    { label: 'div-trunc-neg', fn: 'div', args: [i32Arg(-7), i32Arg(2)], expectVal: { type: 'i32', value: '-3' } },
    { label: 'rem-sign-neg', fn: 'rem', args: [i32Arg(-7), i32Arg(2)], expectVal: { type: 'i32', value: '-1' } },
    { label: 'div-zero-trap', fn: 'div', args: [i32Arg(10), i32Arg(0)], expectTrap: 'r01-t-divide-zero', expectSpan: [10, 20] },
    { label: 'rem-zero-trap', fn: 'rem', args: [i32Arg(10), i32Arg(0)], expectTrap: 'r01-t-remainder-zero', expectSpan: [10, 20] },
    // Shifts + shift-count traps
    { label: 'shl-31', fn: 'shl', args: [i32Arg(1), i32Arg(31)], expectVal: { type: 'i32', value: String(I32_MIN) } },
    { label: 'shr-sign', fn: 'shr', args: [i32Arg(I32_MIN), i32Arg(31)], expectVal: { type: 'i32', value: '-1' } },
    { label: 'ushr-zero', fn: 'ushr', args: [i32Arg(I32_MIN), i32Arg(31)], expectVal: { type: 'i32', value: '1' } },
    { label: 'shl-32-trap', fn: 'shl', args: [i32Arg(1), i32Arg(32)], expectTrap: 'r01-t-shift-count', expectSpan: [10, 20] },
    { label: 'shr-neg-trap', fn: 'shr', args: [i32Arg(1), i32Arg(-1)], expectTrap: 'r01-t-shift-count', expectSpan: [10, 20] },
    { label: 'ushr-32-trap', fn: 'ushr', args: [i32Arg(1), i32Arg(32)], expectTrap: 'r01-t-shift-count', expectSpan: [10, 20] },
    // Comparisons & bool
    { label: 'lt-min-max', fn: 'lt', args: [i32Arg(I32_MIN), i32Arg(I32_MAX)], expectVal: { type: 'bool', value: true } },
    { label: 'gt-min-max', fn: 'gt', args: [i32Arg(I32_MIN), i32Arg(I32_MAX)], expectVal: { type: 'bool', value: false } },
    { label: 'bool-not', fn: 'bool_not', args: [boolArg(true)], expectVal: { type: 'bool', value: false } },
    { label: 'bool-eq', fn: 'bool_eq', args: [boolArg(true), boolArg(true)], expectVal: { type: 'bool', value: true } },
    { label: 'bool-ne', fn: 'bool_ne', args: [boolArg(true), boolArg(false)], expectVal: { type: 'bool', value: true } },
    // Fuel exhaustion at entry
    { label: 'fuel-zero', fn: 'add', args: [i32Arg(1), i32Arg(2)], fuel: 0, expectTrap: 'r01-t-fuel', expectSpan: [0, 200] },
    // Negative request boundaries (wrong signature, wrong args)
    { label: 'wrong-sig', fn: 'add', args: [i32Arg(1), i32Arg(2)], sig: 'sha256:' + '0'.repeat(64), expectReqFail: 'r05-request-signature' },
    { label: 'wrong-arg-type', fn: 'add', args: [boolArg(true), i32Arg(2)], expectReqFail: 'r05-request-arguments' },
    { label: 'wrong-arg-count', fn: 'add', args: [i32Arg(1)], expectReqFail: 'r05-request-arguments' },
  ];

  const dynReqs = dynCases.map((c) => ({
    functionId: fnByName(dyn, c.fn),
    ...(c.sig ? { signatureHash: c.sig } : {}),
    arguments: c.args,
    semanticFuel: c.fuel ?? 100,
    depth: 4,
  }));
  const { aotOut: dynAot, vmOut: dynVm } = executeDual(dynCompiled, dynReqs);
  for (let i = 0; i < dynCases.length; i++) {
    const c = dynCases[i];
    assertParity(dynAot[i], dynVm[i], `M15:${c.label}`);
    if (c.expectVal) {
      assert.equal(dynAot[i].status, 'returned', c.label);
      assert.deepEqual(dynAot[i].result, c.expectVal, c.label);
    } else if (c.expectTrap) {
      assert.equal(dynAot[i].status, 'failed', c.label);
      assert.equal(dynAot[i].code, c.expectTrap, c.label);
      assert.equal(Number(dynAot[i].source.start), c.expectSpan[0], c.label);
      assert.equal(Number(dynAot[i].source.end), c.expectSpan[1], c.label);
    } else if (c.expectReqFail) {
      assert.equal(dynAot[i].status, 'failed', c.label);
      assert.equal(dynAot[i].code, c.expectReqFail, c.label);
    }
  }

  // CFG, short-circuit trap avoidance, first-failure dominance, loop fuel trap
  const cfgCompiled = await compileDualBackend('m15-cfg', cfg.input);
  const cfgCases = [
    { label: 'swap-false', fn: 'swap', args: [i32Arg(11), i32Arg(22), boolArg(false)], fuel: 10, expectVal: { type: 'i32', value: '11' } },
    { label: 'swap-loop-fuel', fn: 'swap', args: [i32Arg(11), i32Arg(22), boolArg(true)], fuel: 5, expectTrap: 'r01-t-fuel', expectSpan: [30, 40] },
    { label: 'branch-true', fn: 'branch', args: [boolArg(true), i32Arg(10), i32Arg(20)], expectVal: { type: 'i32', value: '20' } },
    { label: 'branch-false', fn: 'branch', args: [boolArg(false), i32Arg(10), i32Arg(20)], expectVal: { type: 'i32', value: '20' } },
    { label: 'and-short-skips-div0', fn: 'and_rhs', args: [boolArg(false), i32Arg(1), i32Arg(0)], expectVal: { type: 'bool', value: false } },
    { label: 'and-rhs-traps-div0', fn: 'and_rhs', args: [boolArg(true), i32Arg(1), i32Arg(0)], expectTrap: 'r01-t-divide-zero', expectSpan: [40, 50] },
    { label: 'or-short-skips-shl32', fn: 'or_rhs', args: [boolArg(true), i32Arg(1), i32Arg(32)], expectVal: { type: 'bool', value: true } },
    { label: 'or-rhs-traps-shl32', fn: 'or_rhs', args: [boolArg(false), i32Arg(1), i32Arg(32)], expectTrap: 'r01-t-shift-count', expectSpan: [40, 50] },
    { label: 'first-failure-div-before-rem', fn: 'two_traps', args: [i32Arg(10), i32Arg(0)], expectTrap: 'r01-t-divide-zero', expectSpan: [10, 20] },
  ];
  const cfgReqs = cfgCases.map((c) => ({
    functionId: fnByName(cfg, c.fn),
    arguments: c.args,
    semanticFuel: c.fuel ?? 100,
    depth: 4,
  }));
  const { aotOut: cfgAot, vmOut: cfgVm } = executeDual(cfgCompiled, cfgReqs);
  for (let i = 0; i < cfgCases.length; i++) {
    const c = cfgCases[i];
    assertParity(cfgAot[i], cfgVm[i], `M15-cfg:${c.label}`);
    if (c.expectVal) {
      assert.equal(cfgAot[i].status, 'returned', c.label);
      assert.deepEqual(cfgAot[i].result, c.expectVal, c.label);
    } else {
      assert.equal(cfgAot[i].status, 'failed', c.label);
      assert.equal(cfgAot[i].code, c.expectTrap, c.label);
      assert.equal(Number(cfgAot[i].source.start), c.expectSpan[0], c.label);
      assert.equal(Number(cfgAot[i].source.end), c.expectSpan[1], c.label);
    }
  }

  // Calls & recursion depth trap
  const callsCompiled = await compileDualBackend('m15-calls', calls.input);
  const callReqs = [
    { functionId: fnByName(calls, 'self'), arguments: [i32Arg(1)], semanticFuel: 100, depth: 3 },
    { functionId: fnByName(calls, 'entry'), arguments: [i32Arg(1), i32Arg(2), boolArg(true)], semanticFuel: 100, depth: 4 },
    { functionId: fnByName(calls, 'unusedBool'), arguments: [boolArg(true)], semanticFuel: 10, depth: 1 },
  ];
  const { aotOut: callsAot, vmOut: callsVm } = executeDual(callsCompiled, callReqs);
  for (let i = 0; i < callReqs.length; i++) assertParity(callsAot[i], callsVm[i], `M15-calls:${i}`);
  assert.equal(callsAot[0].code, 'r01-t-depth');
  assert.equal(callsAot[1].code, 'r01-t-depth');
  assert.equal(callsAot[2].status, 'returned');
  assert.deepEqual(callsAot[2].result, { type: 'bool', value: true });

  // Negative target/layout rejection before AOT emission
  for (const bad of [
    dyn.input.replace('windows-x86_64-msvc', 'linux-x86_64-gnu'),
    dyn.input.replace('x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu'),
    dyn.input.replace('e-m:w-', 'e-m:e-'),
  ]) {
    const rej = runCore(bad, '--emit-program-object');
    assert.equal(rej.status, 3);
    assert.equal(rej.stdout.length, 0);
  }
});

// ============================================================================
// M16: Complete Integer Family AOT (i8/u8/i16/u16/i32/u32/i64/u64/isize/usize)
// ============================================================================
test('M16: Full 10-type integer family Windows AOT & VM parity with BigInt oracle', async () => {
  const intSpecs = [
    { name: 'i8', bits: 8, signed: true },
    { name: 'u8', bits: 8, signed: false },
    { name: 'i16', bits: 16, signed: true },
    { name: 'u16', bits: 16, signed: false },
    { name: 'i32', bits: 32, signed: true },
    { name: 'u32', bits: 32, signed: false },
    { name: 'i64', bits: 64, signed: true },
    { name: 'u64', bits: 64, signed: false },
    { name: 'isize', bits: 64, signed: true },
    { name: 'usize', bits: 64, signed: false },
  ];

  const fns = [];
  for (const s of intSpecs) {
    const t = s.name;
    fns.push(fn(`add_${t}`, [t, t], t, operation('%r', 'add', ['%a0', '%a1'], t) + '\n' + ret('%r', t)));
    fns.push(fn(`sub_${t}`, [t, t], t, operation('%r', 'sub', ['%a0', '%a1'], t) + '\n' + ret('%r', t)));
    fns.push(fn(`mul_${t}`, [t, t], t, operation('%r', 'mul', ['%a0', '%a1'], t) + '\n' + ret('%r', t)));
    fns.push(fn(`div_${t}`, [t, t], t, operation('%r', 'div', ['%a0', '%a1'], t) + '\n' + ret('%r', t)));
    fns.push(fn(`rem_${t}`, [t, t], t, operation('%r', 'rem', ['%a0', '%a1'], t) + '\n' + ret('%r', t)));
    fns.push(fn(`shl_${t}`, [t, 'i32'], t,
      `%r = "tsfg_core.shl"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${type(t)}, i32) -> ${type(t)}\n` + ret('%r', t)));
    fns.push(fn(`shr_${t}`, [t, 'i32'], t,
      `%r = "tsfg_core.shr"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${type(t)}, i32) -> ${type(t)}\n` + ret('%r', t)));
    fns.push(fn(`lt_${t}`, [t, t], 'bool', operation('%r', 'lt', ['%a0', '%a1'], t, 'bool') + '\n' + ret('%r', 'bool')));
  }

  const mod = moduleOf(fns);
  const compiled = await compileDualBackend('m16-integers', mod.input);

  const reqs = [];
  const checks = [];
  for (const s of intSpecs) {
    const t = s.name;
    const minVal = s.signed ? -(1n << BigInt(s.bits - 1)) : 0n;
    const maxVal = s.signed ? (1n << BigInt(s.bits - 1)) - 1n : (1n << BigInt(s.bits)) - 1n;
    const arg = (v) => ({ type: t, value: String(v) });

    // Wrapping add: max + 1 => min
    reqs.push({ functionId: functionIdOf(`add_${t}`, [t, t], t), arguments: [arg(maxVal), arg(1n)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `add_wrap_${t}`, val: { type: t, value: String(minVal) } });

    // Wrapping sub: min - 1 => max
    reqs.push({ functionId: functionIdOf(`sub_${t}`, [t, t], t), arguments: [arg(minVal), arg(1n)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `sub_wrap_${t}`, val: { type: t, value: String(maxVal) } });

    // Wrapping mul: max * 2
    const mulExpected = s.signed ? -2n : (maxVal * 2n) & ((1n << BigInt(s.bits)) - 1n);
    reqs.push({ functionId: functionIdOf(`mul_${t}`, [t, t], t), arguments: [arg(maxVal), arg(2n)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `mul_wrap_${t}`, val: { type: t, value: String(mulExpected) } });

    // Signed MIN / -1 => MIN and MIN % -1 => 0; Unsigned max / 2 & max % 2
    if (s.signed) {
      reqs.push({ functionId: functionIdOf(`div_${t}`, [t, t], t), arguments: [arg(minVal), arg(-1n)], semanticFuel: 100, depth: 2 });
      checks.push({ label: `div_min_neg1_${t}`, val: { type: t, value: String(minVal) } });
      reqs.push({ functionId: functionIdOf(`rem_${t}`, [t, t], t), arguments: [arg(minVal), arg(-1n)], semanticFuel: 100, depth: 2 });
      checks.push({ label: `rem_min_neg1_${t}`, val: { type: t, value: '0' } });
    } else {
      reqs.push({ functionId: functionIdOf(`div_${t}`, [t, t], t), arguments: [arg(maxVal), arg(2n)], semanticFuel: 100, depth: 2 });
      checks.push({ label: `div_max_2_${t}`, val: { type: t, value: String(maxVal / 2n) } });
      reqs.push({ functionId: functionIdOf(`rem_${t}`, [t, t], t), arguments: [arg(maxVal), arg(2n)], semanticFuel: 100, depth: 2 });
      checks.push({ label: `rem_max_2_${t}`, val: { type: t, value: '1' } });
    }

    // Divide-by-zero & remainder-by-zero traps
    reqs.push({ functionId: functionIdOf(`div_${t}`, [t, t], t), arguments: [arg(1n), arg(0n)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `div_zero_${t}`, trap: 'r01-t-divide-zero' });
    reqs.push({ functionId: functionIdOf(`rem_${t}`, [t, t], t), arguments: [arg(1n), arg(0n)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `rem_zero_${t}`, trap: 'r01-t-remainder-zero' });

    // Shift valid (bits - 1) and shift trap (bits)
    const shlExpected = s.signed ? minVal : (1n << BigInt(s.bits - 1));
    reqs.push({ functionId: functionIdOf(`shl_${t}`, [t, 'i32'], t), arguments: [arg(1n), i32Arg(s.bits - 1)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `shl_valid_${t}`, val: { type: t, value: String(shlExpected) } });
    reqs.push({ functionId: functionIdOf(`shl_${t}`, [t, 'i32'], t), arguments: [arg(1n), i32Arg(s.bits)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `shl_trap_${t}`, trap: 'r01-t-shift-count' });

    // Signed vs unsigned comparison: min < max is true, max < min is false
    reqs.push({ functionId: functionIdOf(`lt_${t}`, [t, t], 'bool'), arguments: [arg(minVal), arg(maxVal)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `lt_min_max_${t}`, val: { type: 'bool', value: true } });
    reqs.push({ functionId: functionIdOf(`lt_${t}`, [t, t], 'bool'), arguments: [arg(maxVal), arg(minVal)], semanticFuel: 100, depth: 2 });
    checks.push({ label: `lt_max_min_${t}`, val: { type: 'bool', value: false } });
  }

  const { aotOut, vmOut } = executeDual(compiled, reqs);
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    assertParity(aotOut[i], vmOut[i], `M16:${c.label}`);
    if (c.val) {
      assert.equal(aotOut[i].status, 'returned', c.label);
      assert.deepEqual(aotOut[i].result, c.val, c.label);
    } else {
      assert.equal(aotOut[i].status, 'failed', c.label);
      assert.equal(aotOut[i].code, c.trap, c.label);
    }
  }
});

// ============================================================================
// M17: Strict IEEE-754 f32/f64 AOT — Full Frozen BigInt Oracle + VM Parity
// ============================================================================
test('M17: Strict f32/f64 Windows AOT & VM parity across all 136 arithmetic, 108 comparison, 16 raw NaN, and 64-arg ABI oracle cases', async () => {
  const compiled = await compileDualBackend('m17-float', floatComplete.input);
  const reqs = [];
  const checks = [];

  // 136 arithmetic cases (add, sub, mul, div, fmod, positive, negative)
  for (const row of floatOracle.arithmeticCases) {
    const fnName = row.id.replaceAll('-', '_');
    const isUnary = row.operation === 'positive' || row.operation === 'negative';
    const params = isUnary ? [row.type] : [row.type, row.type];
    const args = isUnary
      ? [floatArg(row.type, row.inputBits ?? row.leftBits)]
      : [floatArg(row.type, row.leftBits), floatArg(row.type, row.rightBits)];
    reqs.push({ functionId: functionIdOf(fnName, params, row.type), arguments: args, semanticFuel: 100, depth: 4 });
    checks.push({ label: `arith:${row.id}`, val: { type: row.type, value: row.expectedBits } });
  }

  // 108 comparison cases (eq, ne, lt, le, gt, ge across NaN, +/-0, Inf, subnormals)
  for (const row of floatOracle.comparisonCases) {
    for (const [op, expectedBool] of Object.entries(row.expected)) {
      const fnName = `${row.id.replaceAll('-', '_')}_${op}`;
      reqs.push({
        functionId: functionIdOf(fnName, [row.type, row.type], 'bool'),
        arguments: [floatArg(row.type, row.leftBits), floatArg(row.type, row.rightBits)],
        semanticFuel: 100,
        depth: 4,
      });
      checks.push({ label: `cmp:${row.id}:${op}`, val: { type: 'bool', value: expectedBool } });
    }
  }

  // 16 raw NaN/payload/signed-zero transport cases (must preserve exact bits!)
  for (const row of floatOracle.rawTransportCases) {
    const fnName = row.id.replaceAll('-', '_');
    reqs.push({ functionId: functionIdOf(fnName, [], row.type), arguments: [], semanticFuel: 100, depth: 4 });
    checks.push({ label: `raw:${row.id}`, val: { type: row.type, value: row.expectedBits } });
  }

  // 64-parameter mixed f32/f64/integer/bool relay ABI checks
  const intBits = { i8: 8, u8: 8, i16: 16, u16: 16, i32: 32, u32: 32, i64: 64, u64: 64, isize: 64, usize: 64 };
  const isSignedInt = (t) => t === 'i8' || t === 'i16' || t === 'i32' || t === 'i64' || t === 'isize';
  const toTypedArg = (a) => {
    if (a.type === 'bool') return { type: 'bool', value: a.rawBits !== '0' };
    if (a.type === 'f32' || a.type === 'f64') return { type: a.type, value: a.rawBits };
    const raw = BigInt('0x' + a.rawBits);
    const val = isSignedInt(a.type) ? BigInt.asIntN(intBits[a.type], raw) : raw;
    return { type: a.type, value: String(val) };
  };
  const mixedTypes = floatOracle.abi.mixed64.orderedTypes;
  for (const callRow of floatOracle.abi.mixed64.calls) {
    const t = callRow.expectedResult.type;
    const args = floatOracle.abi.mixed64.arguments.map(toTypedArg);
    reqs.push({ functionId: functionIdOf(`relay64_${t}`, mixedTypes, t), arguments: args, semanticFuel: 100, depth: 4 });
    checks.push({ label: `relay64:${t}`, val: { type: t, value: callRow.expectedResult.rawBits } });
  }

  const { aotOut, vmOut } = executeDual(compiled, reqs);
  assert.equal(checks.length, 136 + 108 + 16 + floatOracle.abi.mixed64.calls.length);
  for (let i = 0; i < checks.length; i++) {
    assertParity(aotOut[i], vmOut[i], `M17:${checks[i].label}`);
    assert.equal(aotOut[i].status, 'returned', checks[i].label);
    assert.deepEqual(aotOut[i].result, checks[i].val, checks[i].label);
  }
});

// ============================================================================
// M18: Conversions (286 entries) & Ordinary Expressions AOT + VM Parity
// ============================================================================
test('M18: Complete 286 conversions & ordinary expressions Windows AOT & VM parity', async () => {
  // 1. Compile ALL 286 conversion entries in one formal module
  const convOp = (mode, from, to) =>
    `%r = "tsfg_core.${mode}"(%a0) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${type(from)}) -> ${type(to)}`;
  const convFns = conversionEntries.map((e) =>
    fn(e.name, [e.from], e.to, convOp(e.mode === 'reinterpret' ? 'reinterpret' : `convert_${e.mode}`, e.from, e.to) + '\n' + ret('%r', e.to))
  );
  assert.equal(convFns.length, 286);
  const convMod = moduleOf(convFns);
  const convCompiled = await compileDualBackend('m18-conversions', convMod.input);

  const convCases = [
    // Checked float -> int: normal, trunc-toward-zero, NaN/Inf nonfinite trap, out-of-range trap
    { name: 'checked_i32_from_f64', from: 'f64', to: 'i32', arg: floatArg('f64', 'c00f333333333333'), val: { type: 'i32', value: '-3' } }, // -3.9 -> -3
    { name: 'checked_i8_from_f64', from: 'f64', to: 'i8', arg: floatArg('f64', '405fc00000000000'), val: { type: 'i8', value: '127' } },
    { name: 'checked_i8_from_f64', from: 'f64', to: 'i8', arg: floatArg('f64', '4060000000000000'), trap: 'r01-t-conversion-range' }, // 128.0
    { name: 'checked_u64_from_f64', from: 'f64', to: 'u64', arg: floatArg('f64', 'bff0000000000000'), trap: 'r01-t-conversion-range' }, // -1.0
    { name: 'checked_u64_from_f64', from: 'f64', to: 'u64', arg: floatArg('f64', '7ff8000000000000'), trap: 'r01-t-conversion-nonfinite' }, // NaN
    { name: 'checked_i32_from_f32', from: 'f32', to: 'i32', arg: floatArg('f32', '7f800000'), trap: 'r01-t-conversion-nonfinite' }, // +Inf
    { name: 'checked_i32_from_f32', from: 'f32', to: 'i32', arg: floatArg('f32', 'ff800000'), trap: 'r01-t-conversion-nonfinite' }, // -Inf
    // Checked int -> int range checks
    { name: 'checked_u8_from_i32', from: 'i32', to: 'u8', arg: i32Arg(255), val: { type: 'u8', value: '255' } },
    { name: 'checked_u8_from_i32', from: 'i32', to: 'u8', arg: i32Arg(256), trap: 'r01-t-conversion-range' },
    { name: 'checked_u8_from_i32', from: 'i32', to: 'u8', arg: i32Arg(-1), trap: 'r01-t-conversion-range' },
    { name: 'checked_i8_from_u32', from: 'u32', to: 'i8', arg: { type: 'u32', value: '128' }, trap: 'r01-t-conversion-range' },
    // Checked int -> float exact & rounded
    { name: 'checked_f32_from_i32', from: 'i32', to: 'f32', arg: i32Arg(-42), val: { type: 'f32', value: 'c2280000' } },
    { name: 'checked_f64_from_u64', from: 'u64', to: 'f64', arg: { type: 'u64', value: '18446744073709551615' }, val: { type: 'f64', value: '43f0000000000000' } },
    // Wrap int -> int truncation & sign/zero extension
    { name: 'wrap_u8_from_i32', from: 'i32', to: 'u8', arg: i32Arg(-1), val: { type: 'u8', value: '255' } },
    { name: 'wrap_i8_from_u32', from: 'u32', to: 'i8', arg: { type: 'u32', value: '255' }, val: { type: 'i8', value: '-1' } },
    { name: 'wrap_i64_from_i8', from: 'i8', to: 'i64', arg: { type: 'i8', value: '-5' }, val: { type: 'i64', value: '-5' } },
    { name: 'wrap_u64_from_u8', from: 'u8', to: 'u64', arg: { type: 'u8', value: '251' }, val: { type: 'u64', value: '251' } },
    // Bit-preserving reinterpret (including custom NaN payload!)
    { name: 'reinterpret_f32_from_u32', from: 'u32', to: 'f32', arg: { type: 'u32', value: String(0x7fc12345) }, val: { type: 'f32', value: '7fc12345' } },
    { name: 'reinterpret_u32_from_f32', from: 'f32', to: 'u32', arg: floatArg('f32', '7fc12345'), val: { type: 'u32', value: String(0x7fc12345) } },
    { name: 'reinterpret_f64_from_u64', from: 'u64', to: 'f64', arg: { type: 'u64', value: String(0xfff800000000abcdn) }, val: { type: 'f64', value: 'fff800000000abcd' } },
    { name: 'reinterpret_u64_from_f64', from: 'f64', to: 'u64', arg: floatArg('f64', 'fff800000000abcd'), val: { type: 'u64', value: String(0xfff800000000abcdn) } },
    { name: 'reinterpret_i32_from_f32', from: 'f32', to: 'i32', arg: floatArg('f32', 'bf800000'), val: { type: 'i32', value: '-1082130432' } },
  ];
  const convReqs = convCases.map((c) => ({
    functionId: functionIdOf(c.name, [c.from], c.to),
    arguments: [c.arg],
    semanticFuel: 100,
    depth: 2,
  }));
  const { aotOut: convAot, vmOut: convVm } = executeDual(convCompiled, convReqs);
  for (let i = 0; i < convCases.length; i++) {
    const c = convCases[i];
    assertParity(convAot[i], convVm[i], `M18-conv:${c.name}#${i}`);
    if (c.val) {
      assert.equal(convAot[i].status, 'returned', c.name);
      assert.deepEqual(convAot[i].result, c.val, c.name);
    } else {
      assert.equal(convAot[i].status, 'failed', c.name);
      assert.equal(convAot[i].code, c.trap, c.name);
    }
  }

  // 2. Ordinary expressions: compound assign old-LHS capture, postfix update, default param, optional ??=
  // Includes real Go tsfg-frontend source-to-HIR-to-Core-to-AOT/VM end-to-end compilation!
  async function compileFromRealTsSource(source) {
    const inp = await sourceInput(source, { declarationVersion: 'minimal-conversions-v5' });
    const prep = await prepareFrontendInput(inp);
    assert.equal(prep.status, 'ready');
    const feRes = spawnSync(FRONTEND_EXE, [], { input: JSON.stringify(prep.ownedInput), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(feRes.status, 0, feRes.stderr.toString('utf8'));
    const mat = materializeFrontendResponse(prep, feRes.stdout.toString('utf8'), {
      forkOid: '8443e0f34e',
      binarySha256: 'sha256:' + '0'.repeat(64),
    });
    assert.equal(mat.status, 'ok', mat.message);
    return mat.snapshot;
  }

  async function buildPostfixSnapshot() {
    const source = 'export function entry():i32 { let x:i32=1; return x++ + x; }';
    const inp = await sourceInput(source, { declarationVersion: 'minimal-conversions-v5' });
    const prep = await prepareFrontendInput(inp);
    const r = (start, end) => ({ start, end });
    const x = source.indexOf('x:i32'), one = source.indexOf('=1') + 1, update = source.indexOf('x++'), read = source.lastIndexOf('x;');
    const ref = (at) => ({ kind: 'reference', type: 'i32', symbol: 'x', range: r(at, at + 1) });
    const local = { id: 'x', name: 'x', kind: 'local', type: 'i32', writable: true, range: r(x, x + 1) };
    const facts = {
      status: 'ok',
      inputs: ['/src/main.ts', '/src/minimal-conversions-v5.d.ts'],
      diagnostics: [],
      symbols: [{ id: 'f', name: 'entry', kind: 'function', type: 'i32', range: r(16, 21) }, local],
      functions: [{
        symbol: 'f', name: 'entry', returnType: 'i32', parameters: [], parameterInitializers: [], range: r(0, source.length),
        body: [
          { kind: 'variable', range: r(x, one + 1), symbol: local, initializer: { kind: 'integer', type: 'i32', literal: { token: '1', decimal: '1' }, range: r(one, one + 1) } },
          { kind: 'return', range: r(source.indexOf('return'), read + 2), expression: { kind: 'binary', operator: '+', type: 'i32', range: r(update, read + 1), left: { kind: 'update', operator: '++', prefix: false, type: 'i32', range: r(update, update + 3), operand: ref(update) }, right: ref(read) } },
        ],
      }],
    };
    const mat = materializeFrontendResponse(prep, JSON.stringify(facts), { forkOid: 'independent-owned-fixture', binarySha256: 'sha256:' + '0'.repeat(64) });
    assert.equal(mat.status, 'ok', mat.message);
    return mat.snapshot;
  }

  const ordinaryPrograms = [
    {
      tag: 'm18-compound',
      snapshot: await ordinaryFacts(), // let x:i32=1; return x += (x = 5); => 1 + 5 = 6
      requests: [{ arguments: [], semanticFuel: 100, depth: 2 }],
      expected: [{ type: 'i32', value: '6' }],
    },
    {
      tag: 'm18-postfix',
      snapshot: await buildPostfixSnapshot(), // let x:i32=1; return x++ + x; => 1 + 2 = 3
      requests: [{ arguments: [], semanticFuel: 100, depth: 2 }],
      expected: [{ type: 'i32', value: '3' }],
    },
    {
      tag: 'm18-default-real-frontend',
      snapshot: await compileFromRealTsSource('export function entry(x: i32 = 7): i32 { return x; }'),
      requests: [
        { arguments: [], semanticFuel: 100, depth: 2 },
        { arguments: [{ type: 'undefined', value: null }], semanticFuel: 100, depth: 2 },
        { arguments: [i32Arg(42)], semanticFuel: 100, depth: 2 },
      ],
      expected: [{ type: 'i32', value: '7' }, { type: 'i32', value: '7' }, { type: 'i32', value: '42' }],
    },
    {
      tag: 'm18-optional-real-frontend',
      snapshot: await compileFromRealTsSource('export function entry(x?: i32): i32 { x ??= 7; return x; }'),
      requests: [
        { arguments: [], semanticFuel: 100, depth: 2 },
        { arguments: [{ type: 'undefined', value: null }], semanticFuel: 100, depth: 2 },
        { arguments: [i32Arg(99)], semanticFuel: 100, depth: 2 },
      ],
      expected: [{ type: 'i32', value: '7' }, { type: 'i32', value: '7' }, { type: 'i32', value: '99' }],
    },
  ];

  for (const prog of ordinaryPrograms) {
    validateFrontendSnapshot(prog.snapshot);
    const built = buildHir(prog.snapshot);
    assert.equal(built.status, 'ok', prog.tag);
    const hir = readHir(Buffer.from(printHir(built.hir)));
    const core = lowerFormalHir(hir);
    const compiled = await compileDualBackend(prog.tag, core);
    const { aotOut, vmOut } = executeDual(compiled, prog.requests);
    for (let i = 0; i < prog.expected.length; i++) {
      assertParity(aotOut[i], vmOut[i], `${prog.tag}#${i}`);
      assert.equal(aotOut[i].status, 'returned', `${prog.tag}#${i}`);
      assert.deepEqual(aotOut[i].result, prog.expected[i], `${prog.tag}#${i}`);
    }
  }
});
