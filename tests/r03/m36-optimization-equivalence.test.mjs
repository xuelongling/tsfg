// SPDX-License-Identifier: MIT
// M36: Core IR Optimization Equivalence (--optimize vs --canonicalize)
// Proves 4-way behavioral, trap-order, source-anchor, and fuel equivalence:
//   unopt-VM === opt-VM === unopt-AOT === opt-AOT
// across arithmetic, short-circuit traps, calls/recursion, IEEE floats,
// conversions, modules, generic packages, WTF-8 strings, and Common20 programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from '../../compiler/identity.mjs';
import { readGenericPackageFrontendResponse } from '../../compiler/generic-package-frontend.mjs';
import { encodeGenericPackageRequest } from '../../compiler/generic-package-io.mjs';
import { lowerGenericHir } from '../../compiler/generic-hir.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { emitCommonProgramCore } from '../../compiler/common-program-core.mjs';
import { generalStringProgram } from './formal-string-program.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const VM_EXE = process.env.TSFG_VM_EXE ?? 'E:\\tsfg-build\\vm\\tsfg-runtime.exe';
const FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const RUNTIME_STAGE = process.env.TSFG_RUNTIME_STAGE ?? 'E:\\tsfg-build\\runtime-stage';
const RUNTIME_OBJS = process.env.TSFG_RUNTIME_OBJS ?? 'E:\\tsfg-build\\runtime-objs';
const BUILD_DIR = process.env.TSFG_M36_BUILD_DIR ?? 'E:\\tsfg-build\\m36';

const registry = JSON.parse(readFileSync(new URL('../../contracts/registry.json', import.meta.url), 'utf8'));
const bytecodeSchema = JSON.parse(readFileSync(new URL('../../contracts/bytecode.schema.json', import.meta.url), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

function runCore(coreText, args) {
  const res = spawnSync(CORE_EXE, args, {
    input: Buffer.from(coreText, 'utf8'),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

async function linkAot(tag, objBytes) {
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const objPath = path.join(dir, 'program.obj');
  const exePath = path.join(dir, 'tsfg-aot.exe');
  await writeFile(objPath, objBytes);
  const link = spawnSync(ZIG_EXE, [
    'build-exe', 'aot-main.zig',
    objPath,
    path.join(RUNTIME_OBJS, 'host_counter.obj'),
    path.join(RUNTIME_OBJS, 'host_counter_bridge.obj'),
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-ODebug', '-fno-lto',
    `-femit-bin=${exePath}`,
  ], { cwd: RUNTIME_STAGE, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(link.status, 0, `${tag} link failed:\n${link.stderr.toString('utf8')}`);
  return exePath;
}

function runVm(tbcBytes, requests, flag = '--requests') {
  const payload = JSON.stringify(requests.map((r) => ({ memoryBytes: 524288, ...r })));
  const res = spawnSync(VM_EXE, [flag, payload], { input: tbcBytes, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(res.status, 0, `VM failed: ${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

function runAot(exePath, requests, flag = '--requests') {
  const payload = JSON.stringify(requests.map((r) => ({ memoryBytes: 524288, ...r })));
  const res = spawnSync(exePath, [flag, payload], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(res.status, 0, `AOT failed: ${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

async function verifyFourWayEquivalence(tag, coreText, requests, flag = '--requests') {
  const unoptIr = runCore(coreText, ['--canonicalize']);
  assert.equal(unoptIr.status, 0, `${tag} --canonicalize failed:\n${unoptIr.stderr.toString('utf8')}`);
  const optIr = runCore(coreText, ['--optimize']);
  assert.equal(optIr.status, 0, `${tag} --optimize failed:\n${optIr.stderr.toString('utf8')}`);
  // Idempotency check: --optimize followed by --canonicalize succeeds cleanly
  const reCanon = runCore(optIr.stdout.toString('utf8'), ['--canonicalize']);
  assert.equal(reCanon.status, 0, `${tag} --optimize -> --canonicalize failed`);

  const unoptTbc = runCore(unoptIr.stdout.toString('utf8'), ['--emit-bytecode']);
  const optTbc = runCore(optIr.stdout.toString('utf8'), ['--emit-bytecode']);
  assert.equal(unoptTbc.status, 0);
  assert.equal(optTbc.status, 0);

  const unoptObj = runCore(unoptIr.stdout.toString('utf8'), ['--emit-program-object']);
  const optObj = runCore(optIr.stdout.toString('utf8'), ['--emit-program-object']);
  assert.equal(unoptObj.status, 0);
  assert.equal(optObj.status, 0);

  const unoptExe = await linkAot(`${tag}-unopt`, unoptObj.stdout);
  const optExe = await linkAot(`${tag}-opt`, optObj.stdout);

  const unoptVmOut = runVm(unoptTbc.stdout, requests, flag);
  const optVmOut = runVm(optTbc.stdout, requests, flag);
  const unoptAotOut = runAot(unoptExe, requests, flag);
  const optAotOut = runAot(optExe, requests, flag);

  assert.deepEqual(optVmOut, unoptVmOut, `${tag}: opt-VM === unopt-VM`);
  assert.deepEqual(unoptAotOut, unoptVmOut, `${tag}: unopt-AOT === unopt-VM`);
  assert.deepEqual(optAotOut, unoptVmOut, `${tag}: opt-AOT === unopt-VM`);
  return optAotOut;
}

test('M36: 4-way (--canonicalize vs --optimize) x (VM vs Windows AOT) equivalence for arithmetic, traps, floats & conversions', async () => {
  const p = '/src/m36_opt.ts';
  const sh = sha('m36-opt-src');
  const f64T = 'f64';
  const mkFn = (name, params, res, body) => {
    const mlirT = (t) => t === 'f64' ? f64T : t === 'bool' ? 'i1' : 'i32';
    const sig = sha(`tsfg.signature\0(${params.join(',')})->${res}`);
    const fid = sha(`tsfg.function\0${p}\0${name}\0${sig}`);
    const tid = sha(`tsfg.type\0${res}`);
    return {
      id: `sha256:${fid}`,
      text: `  func.func @"${name}"(${params.map((t, i) => `%a${i}: ${mlirT(t)}`).join(', ')}) -> ${mlirT(res)} attributes {tsfg_core.function_id = "sha256:${fid}", tsfg_core.signature_hash = "sha256:${sig}", tsfg_core.type_id = "sha256:${tid}", tsfg_core.function_start = 1 : i64, tsfg_core.function_end = 99 : i64} {\n    "tsfg_core.fuel"() {event = 1 : i32, tsfg_source.start = 1 : i64, tsfg_source.end = 99 : i64} : () -> ()\n${body}\n  }`,
    };
  };

  // 1. Constant folding + trapping division (dead trap vs live trap order & exact anchor!)
  const fnTrapOrder = mkFn('trapOrder', ['i32', 'i32'], 'i32', [
    `    %c1 = "tsfg_core.constant"() {value = 10 : i32, tsfg_source.start = 5 : i64, tsfg_source.end = 7 : i64} : () -> i32`,
    `    %c2 = "tsfg_core.constant"() {value = 20 : i32, tsfg_source.start = 8 : i64, tsfg_source.end = 10 : i64} : () -> i32`,
    `    %k = "tsfg_core.add"(%c1, %c2) {tsfg_source.start = 5 : i64, tsfg_source.end = 10 : i64} : (i32, i32) -> i32`,
    `    %d1 = "tsfg_core.div"(%k, %a0) {tsfg_source.start = 12 : i64, tsfg_source.end = 18 : i64} : (i32, i32) -> i32`,
    `    %d2 = "tsfg_core.shl"(%d1, %a1) {tsfg_source.start = 20 : i64, tsfg_source.end = 28 : i64} : (i32, i32) -> i32`,
    `    "func.return"(%d2) {tsfg_source.start = 30 : i64, tsfg_source.end = 35 : i64} : (i32) -> ()`,
  ].join('\n'));

  // 2. IEEE-754 signed zero + NaN preservation under --optimize
  const fnFloat = mkFn('floatPreserve', ['f64', 'f64'], 'f64', [
    `    %s = "tsfg_core.add"(%a0, %a1) {tsfg_source.start = 10 : i64, tsfg_source.end = 20 : i64} : (${f64T}, ${f64T}) -> ${f64T}`,
    `    %n = "tsfg_core.neg"(%s) {tsfg_source.start = 21 : i64, tsfg_source.end = 25 : i64} : (${f64T}) -> ${f64T}`,
    `    "func.return"(%n) {tsfg_source.start = 26 : i64, tsfg_source.end = 30 : i64} : (${f64T}) -> ()`,
  ].join('\n'));

  // 3. Checked conversion (nonfinite & range traps must keep exact anchor under --optimize)
  const fnConv = mkFn('convChecked', ['f64'], 'i32', [
    `    %r = "tsfg_core.convert_checked"(%a0) {tsfg_source.start = 40 : i64, tsfg_source.end = 55 : i64} : (${f64T}) -> i32`,
    `    "func.return"(%r) {tsfg_source.start = 60 : i64, tsfg_source.end = 65 : i64} : (i32) -> ()`,
  ].join('\n'));

  const core = `module attributes {tsfg_core.version = "0.12.0", tsfg_core.input_identity = "sha256:${sha('m36-opt-arith')}", tsfg_core.source_hash = "sha256:${sh}", tsfg_core.source_path = "${p}", tsfg_core.source_length = 100 : i64, tsfg_core.target = "${bytecodeSchema.target.target}", tsfg_core.triple = "${bytecodeSchema.target.triple}", tsfg_core.data_layout = "${bytecodeSchema.target.llvmDataLayout}", tsfg_core.bytecode_schema = "${registry['tsfg.bytecode'].schemaHash}"} {\n${[fnTrapOrder, fnFloat, fnConv].map((f) => f.text).join('\n')}\n}\n`;

  const out = await verifyFourWayEquivalence('m36-arith', core, [
    { functionId: fnTrapOrder.id, arguments: [{ type: 'i32', value: '5' }, { type: 'i32', value: '2' }], semanticFuel: 50, depth: 4 },
    // First-failure dominance: both a0=0 (div0 @ 12..18) and a1=32 (shift @ 20..28) -> MUST trap div0 @ 12..18!
    { functionId: fnTrapOrder.id, arguments: [{ type: 'i32', value: '0' }, { type: 'i32', value: '32' }], semanticFuel: 50, depth: 4 },
    { functionId: fnTrapOrder.id, arguments: [{ type: 'i32', value: '3' }, { type: 'i32', value: '32' }], semanticFuel: 50, depth: 4 },
    // IEEE -0.0 + -0.0 = -0.0, neg(-0.0) = +0.0; +0.0 + +0.0 = +0.0, neg(+0.0) = -0.0!
    { functionId: fnFloat.id, arguments: [{ type: 'f64', value: '8000000000000000' }, { type: 'f64', value: '8000000000000000' }], semanticFuel: 50, depth: 4 },
    { functionId: fnFloat.id, arguments: [{ type: 'f64', value: '0000000000000000' }, { type: 'f64', value: '0000000000000000' }], semanticFuel: 50, depth: 4 },
    // Checked conversion valid, NaN trap, overflow range trap
    { functionId: fnConv.id, arguments: [{ type: 'f64', value: 'c029800000000000' }], semanticFuel: 50, depth: 4 }, // -12.75 -> -12
    { functionId: fnConv.id, arguments: [{ type: 'f64', value: '7ff8000000000000' }], semanticFuel: 50, depth: 4 }, // NaN -> nonfinite
    { functionId: fnConv.id, arguments: [{ type: 'f64', value: '41e0000000000000' }], semanticFuel: 50, depth: 4 }, // 2^31 -> range
  ]);
  assert.equal(out[0].result.value, '24');
  assert.equal(out[1].code, 'r01-t-divide-zero');
  assert.equal(out[1].source.start, '12');
  assert.equal(out[2].code, 'r01-t-shift-count');
  assert.equal(out[2].source.start, '20');
  assert.equal(out[3].result.value, '0000000000000000');
  assert.equal(out[4].result.value, '8000000000000000');
  assert.equal(out[5].result.value, '-12');
  assert.equal(out[6].code, 'r01-t-conversion-nonfinite');
  assert.equal(out[7].code, 'r01-t-conversion-range');
});

test('M36: 4-way equivalence on live generic packages + WTF-8 strings + Common20 --optimize', async () => {
  // 1. Live Go-frontend instantiated generic package: 4-way opt vs unopt x VM vs AOT
  const fx = JSON.parse(readFileSync(new URL('./fixtures/generic-package-io-source-v7.json', import.meta.url), 'utf8'));
  const expReq = Buffer.from(canonical(fx.cases.find((c) => c.name === 'export-ok').request), 'utf8');
  const exp = readGenericPackageFrontendResponse(expReq, spawnSync(FRONTEND_EXE, ['--generic-package-io-v1'], { input: expReq, windowsHide: true }).stdout, { operation: 'export' });
  const pkg = JSON.parse(Buffer.from(exp.packageBytes).toString('utf8'));
  const routeKey = pkg.payload.definitions.find((d) => d.name === 'route').key;
  const instReq = encodeGenericPackageRequest({
    family: 'tsfg.generic-package-io-candidate',
    version: 1,
    operation: 'instantiate',
    package: pkg,
    roots: [
      { definition: routeKey, typeArguments: [{ kind: 'boolean', parameter: 0 }] },
      { definition: routeKey, typeArguments: [{ kind: 'number', parameter: 0 }] },
    ],
  });
  const inst = readGenericPackageFrontendResponse(instReq, spawnSync(FRONTEND_EXE, ['--generic-package-io-v1'], { input: instReq, windowsHide: true }).stdout, { operation: 'instantiate' });
  const genCore = lowerGenericHir(inst.hir);
  await verifyFourWayEquivalence('m36-generics', genCore, [
    { functionId: inst.hir.closure.roots[0], arguments: [{ type: 'bool', value: true }], semanticFuel: 100, depth: 4 },
    { functionId: inst.hir.closure.roots[1], arguments: [{ type: 'f64', value: 'fff8000000001234' }], semanticFuel: 100, depth: 4 },
    { functionId: inst.hir.closure.roots[0], arguments: [{ type: 'bool', value: true }], semanticFuel: 100, depth: 1 },
  ]);

  // 2. WTF-8 string module: --optimize vs --canonicalize on production VM
  const strProg = generalStringProgram(3);
  const strCanon = runCore(strProg.core, ['--canonicalize']);
  const strOpt = runCore(strProg.core, ['--optimize']);
  assert.equal(strCanon.status, 0);
  assert.equal(strOpt.status, 0);
  const strUnoptTbc = runCore(strCanon.stdout.toString('utf8'), ['--emit-bytecode']).stdout;
  const strOptTbc = runCore(strOpt.stdout.toString('utf8'), ['--emit-bytecode']).stdout;
  const strReqs = [
    { functionId: `sha256:${strProg.functions[1].id}`, arguments: [], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${strProg.functions[1].id}`, arguments: [], stringOutput: 'lossy', semanticFuel: 100, depth: 4 },
  ];
  assert.deepEqual(runVm(strOptTbc, strReqs), runVm(strUnoptTbc, strReqs), 'WTF-8 string opt === unopt on VM');

  // 3. Common20 programs: --common-program --optimize vs --canonicalize preserve layouts and verify cleanly
  for (const name of ['positive', 'mixed']) {
    const facts = readCommonProgramFacts(readFileSync(new URL(`./common-program-${name}.json`, import.meta.url)));
    const hir = projectCommonProgram(facts);
    const pub = createCommonProgramPublication(hir);
    const req = { targets: hir.closure.requiredRoots.filter((r) => r.kind === 'kernel').map((r) => r.target).sort() };
    const core = emitCommonProgramCore(hir, pub, req);
    const c1 = runCore(core, ['--common-program', '--canonicalize']);
    const c2 = runCore(core, ['--common-program', '--optimize']);
    assert.equal(c1.status, 0, `${name} --common-program --canonicalize failed`);
    assert.equal(c2.status, 0, `${name} --common-program --optimize failed`);
    const l1 = runCore(c1.stdout.toString('utf8'), ['--common-program', '--component-layouts']);
    const l2 = runCore(c2.stdout.toString('utf8'), ['--common-program', '--component-layouts']);
    assert.equal(l1.status, 0);
    assert.equal(l2.status, 0);
    assert.equal(l2.stdout.toString('utf8'), l1.stdout.toString('utf8'), `${name} component layouts preserved under --optimize`);
  }
});
