// SPDX-License-Identifier: MIT
// End-to-end 4-way equivalence suite compiling REAL official Common20 Core MLIR:
//   Official Facts -> HIR -> Publication -> emitCommonProgramCore
//     -> tsfg-core-ir.exe --common-program --canonicalize & --optimize
//     -> [CommonCoreVm (unopt & opt)]
//     === [lowerCommonCoreToLlvm -> clang-cl /O2 -> lld-link + tsfg_common_engine.lib (unopt & opt Windows x86-64 AOT)]
//     === [Independent Semantic Oracles]
// Covers M12, M19, M20, M21, M25, M26, M29, M30, M31, M32, M34, M36 on real compiler IR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonical } from '../../compiler/identity.mjs';
import { commonSourceFormatV3 } from '../../compiler/common-program-common.mjs';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { emitCommonProgramCore } from '../../compiler/common-program-core.mjs';
import { CommonCoreVm, TAG, TRAP } from '../../compiler/common-vm.mjs';
import { lowerCommonCoreToLlvm } from '../../compiler/common-aot-llvm.mjs';

const FRONTEND_EXE = process.env.TSFG_FRONTEND_EXE ?? 'E:\\tsfg-artifacts\\r03-baseline\\tsfg-frontend-m24-8443e0f.exe';
const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
const BUILD_DIR = process.env.TSFG_COMMON_E2E_BUILD_DIR ?? 'E:\\tsfg-build\\common-core-e2e';

const MSVC_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\lib\\x64';
const UCRT_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\ucrt\\x64';
const UM_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\um\\x64';
const MSVC_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\include';
const UCRT_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\ucrt';
const UM_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\um';
const SHARED_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\shared';
const BUILTINS_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\lib\\clang\\22\\lib\\windows\\clang_rt.builtins-x86_64.lib';

let cachedEngineLib = null;
async function ensureEngineLib() {
  if (cachedEngineLib) return cachedEngineLib;
  await mkdir(BUILD_DIR, { recursive: true });
  const libPath = path.join(BUILD_DIR, 'tsfg_common_engine.lib');
  const res = spawnSync(ZIG_EXE, [
    'build-lib', 'common-execution-engine.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${libPath}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(res.status, 0, `zig build-lib failed:\n${res.stderr.toString('utf8')}`);
  cachedEngineLib = libPath;
  return libPath;
}

function compileCommonFactsToCoreMlir(fixtureUrl) {
  const facts = readCommonProgramFacts(readFileSync(fixtureUrl));
  const hir = projectCommonProgram(facts);
  const pub = createCommonProgramPublication(hir);
  const req = { targets: hir.closure.requiredRoots.filter((r) => r.kind === 'kernel').map((r) => r.target).sort() };
  const core = emitCommonProgramCore(hir, pub, req);
  const canon = spawnSync(CORE_EXE, ['--common-program', '--canonicalize'], {
    input: Buffer.from(core, 'utf8'), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(canon.status, 0, `--canonicalize failed:\n${canon.stderr.toString('utf8')}`);
  const opt = spawnSync(CORE_EXE, ['--common-program', '--optimize'], {
    input: Buffer.from(core, 'utf8'), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(opt.status, 0, `--optimize failed:\n${opt.stderr.toString('utf8')}`);
  return {
    canonMlir: canon.stdout.toString('utf8'),
    optMlir: opt.stdout.toString('utf8'),
  };
}

async function compileAndRunCommonAot(tag, mlirText, buildDriverC) {
  const libPath = await ensureEngineLib();
  const lowered = lowerCommonCoreToLlvm(mlirText);
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const llPath = path.join(dir, `${tag}.ll`);
  const irObj = path.join(dir, `${tag}_ir.obj`);
  const drvC = path.join(dir, `${tag}_drv.c`);
  const drvObj = path.join(dir, `${tag}_drv.obj`);
  const exePath = path.join(dir, `${tag}.exe`);

  await writeFile(llPath, lowered.llvmIr, 'utf8');
  await writeFile(drvC, buildDriverC(lowered), 'utf8');

  const ccIr = spawnSync(CLANG_CL, ['/c', '/O2', '-x', 'ir', llPath, `/Fo${irObj}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ccIr.status, 0, `${tag} clang-cl IR failed:\n${ccIr.stderr.toString('utf8')}`);
  const ccDrv = spawnSync(CLANG_CL, [
    '/c', '/O2', '/MT',
    `/I${MSVC_INC}`, `/I${UCRT_INC}`, `/I${UM_INC}`, `/I${SHARED_INC}`,
    drvC, `/Fo${drvObj}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ccDrv.status, 0, `${tag} clang-cl driver failed:\n${ccDrv.stderr.toString('utf8')}`);
  const ld = spawnSync(LLD_LINK, [
    `/OUT:${exePath}`,
    `/LIBPATH:${MSVC_LIB}`, `/LIBPATH:${UCRT_LIB}`, `/LIBPATH:${UM_LIB}`,
    drvObj, irObj, libPath, BUILTINS_LIB,
    'libcmt.lib', 'libvcruntime.lib', 'libucrt.lib', 'kernel32.lib', 'ntdll.lib',
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ld.status, 0, `${tag} lld-link failed:\n${ld.stderr.toString('utf8')}`);

  const run = spawnSync(exePath, [], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, `${tag} exe failed (${run.status}):\n${run.stderr.toString('utf8')}`);
  return JSON.parse(run.stdout.toString('utf8'));
}

const C_COMMON_EXTERNS = `#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern uint64_t tsfg_eng_gc(void *);
extern uint64_t tsfg_eng_alloc_obj(void *, uint64_t);
extern void tsfg_eng_mark_init(void *, uint64_t);
extern void tsfg_eng_obj_set_field(void *, uint64_t, uint32_t, uint16_t, uint64_t, uint32_t);
extern uint64_t tsfg_eng_arr_create(void *, uint32_t);
extern uint32_t tsfg_eng_arr_push(void *, uint64_t, uint16_t, uint64_t);
extern void aot_cmn_bootstrap(void *);
`;

test('E2E Real Common20 Core IR: common-program-positive (Value Delta, Ref Box, globals, try/catch/as) 4-way VM === AOT', async () => {
  const { canonMlir, optMlir } = compileCommonFactsToCoreMlir(new URL('./common-program-positive.json', import.meta.url));

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const d1 = vm.createValueObject('Delta', { n: 7 });
    const d2 = vm.createValueObject('Delta', { n: 5 });
    const l1 = vm.callExport('left', [d1]);
    const l2 = vm.callExport('left', [d2]);
    const r1 = vm.callExport('right', [10]);
    const r2 = vm.callExport('right', [3]);
    const o1 = vm.callExport('ordinary', [42]);
    return { l1: l1.i32, l2: l2.i32, r1: r1.i32, r2: r2.i32, o1: o1.i32 };
  };

  const buildDriver = ({ exports, mod }) => {
    const deltaId = [...mod.classesById.entries()].find(([, c]) => c.name === 'Delta')[0];
    const deltaNum = mod.classNumId.get(deltaId);
    return `${C_COMMON_EXTERNS}
extern void ${exports.left.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.right.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.ordinary.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint64_t d1 = tsfg_eng_alloc_obj(e, ${deltaNum}); tsfg_eng_obj_set_field(e, d1, 0, 3, 7, 1); tsfg_eng_mark_init(e, d1);
  uint64_t d2 = tsfg_eng_alloc_obj(e, ${deltaNum}); tsfg_eng_obj_set_field(e, d2, 0, 3, 5, 1); tsfg_eng_mark_init(e, d2);
  uint16_t t; uint64_t l1, l2, r1, r2, o1;
  ${exports.left.sym}(e, &t, &l1, 5, d1);
  (void)tsfg_eng_gc(e);
  ${exports.left.sym}(e, &t, &l2, 5, d2);
  ${exports.right.sym}(e, &t, &r1, 3, 10);
  ${exports.right.sym}(e, &t, &r2, 3, 3);
  ${exports.ordinary.sym}(e, &t, &o1, 3, 42);
  printf("{\\"l1\\":%d,\\"l2\\":%d,\\"r1\\":%d,\\"r2\\":%d,\\"o1\\":%d}\\n",
         (int32_t)l1, (int32_t)l2, (int32_t)r1, (int32_t)r2, (int32_t)o1);
  tsfg_eng_destroy(e);
  return 0;
}`;
  };

  const expected = { l1: 7, l2: 12, r1: 10, r2: 13, o1: 42 };
  const unoptVm = runVm(canonMlir);
  const optVm = runVm(optMlir);
  const unoptAot = await compileAndRunCommonAot('positive-unopt', canonMlir, buildDriver);
  const optAot = await compileAndRunCommonAot('positive-opt', optMlir, buildDriver);
  assert.deepEqual(unoptVm, expected);
  assert.deepEqual(optVm, expected);
  assert.deepEqual(unoptAot, expected);
  assert.deepEqual(optAot, expected);
});

test('E2E Real Common20 Core IR: common-program-mixed (4-module globals, try/catch/finally, Array & ReadSpan OOB) 4-way VM === AOT', async () => {
  const { canonMlir, optMlir } = compileCommonFactsToCoreMlir(new URL('./common-program-mixed.json', import.meta.url));

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const d = vm.createValueObject('Delta', { n: 4 });
    const l = vm.callExport('left', [d]);
    const r = vm.callExport('right', [10]); // rightTotal starts at leftTotal+1 = 1 -> 1+10 = 11!
    const o = vm.callExport('ordinary', [99]);
    const v0 = vm.callExport('view', [0]);
    const v1 = vm.callExport('view', [1]);
    const v2 = vm.callExport('view', [2]); // OOB ReadSpan trap!
    return { l: l.i32, r: r.i32, o: o.i32, v0: v0.i32, v1: v1.i32, v2Trap: v2.trap };
  };

  const buildDriver = ({ exports, mod }) => {
    const deltaId = [...mod.classesById.entries()].find(([, c]) => c.name === 'Delta')[0];
    const deltaNum = mod.classNumId.get(deltaId);
    return `${C_COMMON_EXTERNS}
extern void ${exports.left.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.right.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.ordinary.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.view.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint64_t d = tsfg_eng_alloc_obj(e, ${deltaNum}); tsfg_eng_obj_set_field(e, d, 0, 3, 4, 1); tsfg_eng_mark_init(e, d);
  uint16_t t; uint64_t l, r, o, v0, v1, v2;
  ${exports.left.sym}(e, &t, &l, 5, d);
  ${exports.right.sym}(e, &t, &r, 3, 10);
  ${exports.ordinary.sym}(e, &t, &o, 3, 99);
  ${exports.view.sym}(e, &t, &v0, 3, 0);
  ${exports.view.sym}(e, &t, &v1, 3, 1);
  ${exports.view.sym}(e, &t, &v2, 3, 2);
  uint32_t v2Trap = tsfg_eng_trap(e);
  printf("{\\"l\\":%d,\\"r\\":%d,\\"o\\":%d,\\"v0\\":%d,\\"v1\\":%d,\\"v2Trap\\":%u}\\n",
         (int32_t)l, (int32_t)r, (int32_t)o, (int32_t)v0, (int32_t)v1, v2Trap);
  tsfg_eng_destroy(e);
  return 0;
}`;
  };

  const expected = { l: 4, r: 11, o: 99, v0: 1, v1: 2, v2Trap: TRAP.bounds };
  assert.deepEqual(runVm(canonMlir), expected);
  assert.deepEqual(runVm(optMlir), expected);
  assert.deepEqual(await compileAndRunCommonAot('mixed-unopt', canonMlir, buildDriver), expected);
  assert.deepEqual(await compileAndRunCommonAot('mixed-opt', optMlir, buildDriver), expected);
});

test('E2E Real Common20 Core IR: local-sibling-writer (lifted closures, sibling env writes, indirect calls, while loop, Array/ReadSpan) 4-way VM === AOT', async () => {
  const { canonMlir, optMlir } = compileCommonFactsToCoreMlir(
    new URL('./testdata/common-callable-locals/local-sibling-writer.json', import.meta.url),
  );

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const ce = vm.callExport('closureEntry', []);
    const csF = vm.callExport('captureSpanOrdinary', [false]);
    const csT = vm.callExport('captureSpanOrdinary', [true]);
    const ord = vm.callExport('ordinary', [17]);
    const lr = vm.callExport('loopRead', [5]);
    const arr = vm.createArray([10, 20, 30]);
    const aoOk = vm.callExport('arrayOrdinary', [arr, 2]);
    const aoOob = vm.callExport('arrayOrdinary', [arr, 3]);
    return { ce: ce.i32, csF: csF.i32, csT: csT.i32, ord: ord.i32, lr: lr.i32, aoOk: aoOk.i32, aoOobTrap: aoOob.trap };
  };

  const buildDriver = ({ exports }) => `${C_COMMON_EXTERNS}
extern void ${exports.closureEntry.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.captureSpanOrdinary.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.ordinary.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.loopRead.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.arrayOrdinary.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t, uint16_t, uint64_t);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint16_t t; uint64_t ce, csF, csT, ord, lr, aoOk, aoOob;
  ${exports.closureEntry.sym}(e, &t, &ce);
  (void)tsfg_eng_gc(e);
  ${exports.captureSpanOrdinary.sym}(e, &t, &csF, 2, 0);
  ${exports.captureSpanOrdinary.sym}(e, &t, &csT, 2, 1);
  ${exports.ordinary.sym}(e, &t, &ord, 3, 17);
  ${exports.loopRead.sym}(e, &t, &lr, 3, 5);
  uint64_t arr = tsfg_eng_arr_create(e, 0);
  tsfg_eng_arr_push(e, arr, 3, 10); tsfg_eng_arr_push(e, arr, 3, 20); tsfg_eng_arr_push(e, arr, 3, 30);
  ${exports.arrayOrdinary.sym}(e, &t, &aoOk, 7, arr, 3, 2);
  ${exports.arrayOrdinary.sym}(e, &t, &aoOob, 7, arr, 3, 3);
  uint32_t oobTrap = tsfg_eng_trap(e);
  printf("{\\"ce\\":%d,\\"csF\\":%d,\\"csT\\":%d,\\"ord\\":%d,\\"lr\\":%d,\\"aoOk\\":%d,\\"aoOobTrap\\":%u}\\n",
         (int32_t)ce, (int32_t)csF, (int32_t)csT, (int32_t)ord, (int32_t)lr, (int32_t)aoOk, oobTrap);
  tsfg_eng_destroy(e);
  return 0;
}`;

  const expected = { ce: 23, csF: 9, csT: 9, ord: 17, lr: 15, aoOk: 30, aoOobTrap: TRAP.bounds };
  assert.deepEqual(runVm(canonMlir), expected);
  assert.deepEqual(runVm(optMlir), expected);
  assert.deepEqual(await compileAndRunCommonAot('closures-unopt', canonMlir, buildDriver), expected);
  assert.deepEqual(await compileAndRunCommonAot('closures-opt', optMlir, buildDriver), expected);
});

test('E2E Real Common20 Core IR: common-program-method-dispatch (3-level inheritance, receiver_child, invoke_method, Peer structural dispatch) 4-way VM === AOT', async () => {
  const { canonMlir, optMlir } = compileCommonFactsToCoreMlir(new URL('./common-program-method-dispatch.json', import.meta.url));

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const a1 = vm.createArray([0]);
    const a2 = vm.createArray([0]);
    const a3 = vm.createArray([0]);
    const cd = vm.callExport('concreteDerived', [a1]);
    const inh = vm.callExport('inheritedEntry', [a2]);
    const peer = vm.callExport('peerEntry', [a3]);
    const ord = vm.callExport('ordered', []);
    return { cd: cd.i32, inh: inh.i32, peer: peer.i32, ord: ord.i32 };
  };

  const buildDriver = ({ exports }) => `${C_COMMON_EXTERNS}
extern void ${exports.concreteDerived.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.inheritedEntry.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.peerEntry.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
extern void ${exports.ordered.sym}(void *, uint16_t *, uint64_t *);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint64_t a1 = tsfg_eng_arr_create(e, 0); tsfg_eng_arr_push(e, a1, 3, 0);
  uint64_t a2 = tsfg_eng_arr_create(e, 0); tsfg_eng_arr_push(e, a2, 3, 0);
  uint64_t a3 = tsfg_eng_arr_create(e, 0); tsfg_eng_arr_push(e, a3, 3, 0);
  uint16_t t; uint64_t cd, inh, peer, ord;
  ${exports.concreteDerived.sym}(e, &t, &cd, 7, a1);
  ${exports.inheritedEntry.sym}(e, &t, &inh, 7, a2);
  ${exports.peerEntry.sym}(e, &t, &peer, 7, a3);
  ${exports.ordered.sym}(e, &t, &ord);
  printf("{\\"cd\\":%d,\\"inh\\":%d,\\"peer\\":%d,\\"ord\\":%d}\\n",
         (int32_t)cd, (int32_t)inh, (int32_t)peer, (int32_t)ord);
  tsfg_eng_destroy(e);
  return 0;
}`;

  const expected = { cd: 1, inh: 2, peer: 5, ord: 2 };
  assert.deepEqual(runVm(canonMlir), expected);
  assert.deepEqual(runVm(optMlir), expected);
  assert.deepEqual(await compileAndRunCommonAot('dispatch-unopt', canonMlir, buildDriver), expected);
  assert.deepEqual(await compileAndRunCommonAot('dispatch-opt', optMlir, buildDriver), expected);
});

test('E2E Real Common20 Core IR: common-program-constructor-default-source-v3 (default params, super() order, null vs undefined, throw after effects) 4-way VM === AOT', async () => {
  const { canonMlir, optMlir } = compileCommonFactsToCoreMlir(new URL('./common-program-constructor-default-source-v3.json', import.meta.url));

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const om = vm.callExport('omitted', []);
    const au = vm.callExport('actualUndefined', []);
    const af = vm.callExport('argumentsFirst', []);
    const dv = vm.callExport('derived', []);
    const inh = vm.callExport('inherited', []);
    const na = vm.callExport('nullActual', []);
    const th = vm.callExport('throwsAfterEffects', []);
    return { om: om.i32, au: au.i32, af: af.i32, dv: dv.i32, inh: inh.i32, naTag: na.tag, th: th.i32 };
  };

  const buildDriver = ({ exports }) => `${C_COMMON_EXTERNS}
extern void ${exports.omitted.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.actualUndefined.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.argumentsFirst.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.derived.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.inherited.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.nullActual.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.throwsAfterEffects.sym}(void *, uint16_t *, uint64_t *);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint16_t t, naTag; uint64_t om, au, af, dv, inh, naPay, th;
  ${exports.omitted.sym}(e, &t, &om);
  ${exports.actualUndefined.sym}(e, &t, &au);
  ${exports.argumentsFirst.sym}(e, &t, &af);
  ${exports.derived.sym}(e, &t, &dv);
  ${exports.inherited.sym}(e, &t, &inh);
  ${exports.nullActual.sym}(e, &naTag, &naPay);
  ${exports.throwsAfterEffects.sym}(e, &t, &th);
  printf("{\\"om\\":%d,\\"au\\":%d,\\"af\\":%d,\\"dv\\":%d,\\"inh\\":%d,\\"naTag\\":%u,\\"th\\":%d}\\n",
         (int32_t)om, (int32_t)au, (int32_t)af, (int32_t)dv, (int32_t)inh, (unsigned)naTag, (int32_t)th);
  tsfg_eng_destroy(e);
  return 0;
}`;

  const unoptVm = runVm(canonMlir);
  const optVm = runVm(optMlir);
  const unoptAot = await compileAndRunCommonAot('ctordef-unopt', canonMlir, buildDriver);
  const optAot = await compileAndRunCommonAot('ctordef-opt', optMlir, buildDriver);
  assert.deepEqual(optVm, unoptVm, 'opt VM === unopt VM');
  assert.deepEqual(unoptAot, unoptVm, 'unopt AOT === unopt VM');
  assert.deepEqual(optAot, unoptVm, 'opt AOT === unopt VM');
  assert.equal(unoptAot.om, unoptAot.au, 'omitted() === actualUndefined()');
  assert.equal(unoptAot.om, unoptAot.inh, 'omitted() === inherited()');
  assert.equal(unoptAot.naTag, TAG.null, 'nullActual() returns null (not default mark(5))');
  assert.equal(unoptAot.th, 69, 'throwsAfterEffects() preserves mark(6), fail(9) and skips mark(5)');
});

function compileLiveRawTypeScriptToCoreMlir(rawTs, exportedRootNames) {
  const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
  const pos = JSON.parse(readFileSync(new URL('./common-program-positive.json', import.meta.url), 'utf8'));
  const dts = pos.payload.files.find((f) => f.path.endsWith('.d.ts'));
  const req = {
    family: 'tsfg.program-facts-request-candidate',
    version: commonSourceFormatV3.version,
    schemaHash: commonSourceFormatV3.schemaHash,
    input: {
      sourceRoot: '/src',
      rootFile: '/src/main.ts',
      files: [
        { path: '/src/main.ts', content: rawTs, sha256: sha(rawTs) },
        { path: dts.path, content: dts.content, sha256: dts.sha256 },
      ],
      declarations: pos.payload.declarations,
      config: pos.payload.config,
      target: pos.payload.target,
      compilationClosure: {
        roots: [
          ...exportedRootNames.map((name) => ({ kind: 'application', sourcePath: '/src/main.ts', name })),
          { kind: 'module-initialization', sourcePath: '/src/main.ts', name: '$moduleInit' },
        ],
        requiredRoots: [],
      },
      hostImports: [],
    },
  };
  const fe = spawnSync(FRONTEND_EXE, ['--program-facts-io-v3'], {
    input: Buffer.from(canonical(req) + '\n', 'utf8'), windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(fe.status, 0, `live Go frontend --program-facts-io-v3 failed:\n${fe.stderr.toString('utf8')}`);
  const facts = readCommonProgramFacts(fe.stdout);
  const hir = projectCommonProgram(facts);
  const pub = createCommonProgramPublication(hir);
  const core = emitCommonProgramCore(hir, pub, { targets: [] });
  const canon = spawnSync(CORE_EXE, ['--common-program', '--canonicalize'], {
    input: Buffer.from(core, 'utf8'), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(canon.status, 0, `live TS --canonicalize failed:\n${canon.stderr.toString('utf8')}`);
  const opt = spawnSync(CORE_EXE, ['--common-program', '--optimize'], {
    input: Buffer.from(core, 'utf8'), windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(opt.status, 0, `live TS --optimize failed:\n${opt.stderr.toString('utf8')}`);
  return { canonMlir: canon.stdout.toString('utf8'), optMlir: opt.stdout.toString('utf8') };
}

test('E2E Live Raw TypeScript -> Go Frontend -> Core IR -> 4-way VM === Windows x86-64 AOT (value, inheritance, closure, array, ReadSpan, try/catch/finally vs Q7 trap)', async () => {
  const rawTs = `
@tsfgValue
class Vec2 { x: i32 = 0; y: i32 = 0; }

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

export function getAcc(): i32 { return acc; }

export function runAll(v: Vec2, idx: u32): i32 {
  const c: Counter = new DoubleCounter();
  const s1: i32 = c.step(v.x + v.y);
  const f: (k: i32) => i32 = makeAdder(s1);
  const s2: i32 = f(4) + f(6);
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
  return s2 + picked + acc;
}

export function valueIsolation(v: Vec2): i32 {
  const copy: Vec2 = v;
  copy.x = 999;
  return v.x * 1000 + copy.x;
}
`;
  const { canonMlir, optMlir } = compileLiveRawTypeScriptToCoreMlir(rawTs, ['getAcc', 'runAll', 'valueIsolation']);

  const runVm = (mlir) => {
    const vm = new CommonCoreVm(mlir);
    const v = vm.createValueObject('Vec2', { x: 3, y: 2 });
    const ok1 = vm.callExport('runAll', [v, 1]);
    const accAfterOk = vm.callExport('getAcc', []);
    const trapped = vm.callExport('runAll', [v, 5]); // OOB ReadSpan trap -> MUST bypass catch & finally!
    const accAfterTrap = vm.callExport('getAcc', []); // MUST stay 6 (finally skipped on trap!)
    const iso = vm.callExport('valueIsolation', [v]); // copy.x=999 must NOT mutate v.x (3) -> 3999!
    return {
      ok1: ok1.i32,
      accAfterOk: accAfterOk.i32,
      trapCode: trapped.trap,
      accAfterTrap: accAfterTrap.i32,
      iso: iso.i32,
    };
  };

  const buildDriver = ({ exports, mod }) => {
    const vecId = [...mod.classesById.entries()].find(([, c]) => c.name === 'Vec2')[0];
    const vecNum = mod.classNumId.get(vecId);
    return `${C_COMMON_EXTERNS}
extern void ${exports.runAll.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t, uint16_t, uint64_t);
extern void ${exports.getAcc.sym}(void *, uint16_t *, uint64_t *);
extern void ${exports.valueIsolation.sym}(void *, uint16_t *, uint64_t *, uint16_t, uint64_t);
int main(void) {
  void *e = tsfg_eng_create();
  aot_cmn_bootstrap(e);
  uint64_t v = tsfg_eng_alloc_obj(e, ${vecNum});
  tsfg_eng_obj_set_field(e, v, 0, 3, 3, 1);
  tsfg_eng_obj_set_field(e, v, 1, 3, 2, 1);
  tsfg_eng_mark_init(e, v);
  uint16_t t; uint64_t ok1, acc1, dummy, acc2, iso;
  ${exports.runAll.sym}(e, &t, &ok1, 5, v, 3, 1);
  (void)tsfg_eng_gc(e);
  ${exports.getAcc.sym}(e, &t, &acc1);
  ${exports.runAll.sym}(e, &t, &dummy, 5, v, 3, 5);
  uint32_t trapCode = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 100000, 64);
  ${exports.getAcc.sym}(e, &t, &acc2);
  ${exports.valueIsolation.sym}(e, &t, &iso, 5, v);
  printf("{\\"ok1\\":%d,\\"accAfterOk\\":%d,\\"trapCode\\":%u,\\"accAfterTrap\\":%d,\\"iso\\":%d}\\n",
         (int32_t)ok1, (int32_t)acc1, trapCode, (int32_t)acc2, (int32_t)iso);
  tsfg_eng_destroy(e);
  return 0;
}`;
  };

  // Independent oracle:
  // s1 = 10 + (3+2)*2 = 20; s2 = 24 + 30 = 54; picked = 200; finally acc = 5+1 = 6 -> 54+200+6 = 260
  // idx=5 -> trap bounds(4), finally skipped -> acc stays 6
  // valueIsolation: v.x stays 3, copy.x = 999 -> 3*1000 + 999 = 3999
  const expected = { ok1: 260, accAfterOk: 6, trapCode: TRAP.bounds, accAfterTrap: 6, iso: 3999 };
  assert.deepEqual(runVm(canonMlir), expected);
  assert.deepEqual(runVm(optMlir), expected);
  assert.deepEqual(await compileAndRunCommonAot('live-ts-unopt', canonMlir, buildDriver), expected);
  assert.deepEqual(await compileAndRunCommonAot('live-ts-opt', optMlir, buildDriver), expected);
});
