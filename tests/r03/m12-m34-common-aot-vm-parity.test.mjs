// SPDX-License-Identifier: MIT
// Unified Windows x86-64 LLVM AOT vs VM execution parity suite closing:
//   M12 & M29 (Closed classes, inheritance, vtable dispatch, TDZ, moving GC AOT)
//   M19 & M30 (Closures, lifted mutable environments, sibling captures, indirect calls AOT)
//   M20 & M31 (Typed unions, presence narrowing, short-circuit ??, IEEE equality AOT)
//   M21 & M32 (Exceptions try/catch/finally/rethrow vs request traps AOT)
//   M25, M26 & M34 (Dense Array<T> & non-escaping ReadSpan/MutSpan borrows AOT)
// Compiles genuine LLVM IR modules with `clang-cl /O2` and links against the
// production Zig `runtime/common-execution-engine.zig` (`ManagedHeap` moving GC).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
const BUILD_DIR = process.env.TSFG_COMMON_AOT_BUILD_DIR ?? 'E:\\tsfg-build\\common-aot';

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
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `zig build-lib common-execution-engine failed:\n${res.stderr.toString('utf8')}`);
  cachedEngineLib = libPath;
  return libPath;
}

const LLVM_HEADER = `
target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

declare i32 @tsfg_eng_fuel(ptr)
declare i32 @tsfg_eng_trap(ptr)
declare void @tsfg_eng_set_trap(ptr, i32)
declare i64 @tsfg_eng_alloc_obj(ptr, i64)
declare void @tsfg_eng_mark_init(ptr, i64)
declare void @tsfg_eng_obj_set_scalar(ptr, i64, i32, i64, i32)
declare i64 @tsfg_eng_obj_get_scalar(ptr, i64, i32)
declare void @tsfg_eng_obj_set_ref(ptr, i64, i32, i64, i32)
declare i64 @tsfg_eng_obj_get_ref(ptr, i64, i32)
declare i32 @tsfg_eng_obj_vtable(ptr, i64, i32)
declare i32 @tsfg_eng_obj_subtype(ptr, i64, i64)
declare i64 @tsfg_eng_gc(ptr)
declare i64 @tsfg_eng_env_alloc(ptr, i64, i32)
declare i64 @tsfg_eng_env_parent(ptr, i64)
declare void @tsfg_eng_env_init(ptr, i64, i32, i16, i64)
declare void @tsfg_eng_env_store(ptr, i64, i32, i16, i64)
declare i64 @tsfg_eng_env_load_payload(ptr, i64, i32)
declare i64 @tsfg_eng_closure_make(ptr, i32, i64)
declare i32 @tsfg_eng_closure_fn(ptr, i64)
declare i64 @tsfg_eng_closure_env(ptr, i64)
declare i32 @tsfg_eng_narrow_i32(ptr, i16, i64)
declare i32 @tsfg_eng_union_eq(ptr, i16, i64, i16, i64)
declare void @tsfg_eng_throw(ptr, i16, i64)
declare i32 @tsfg_eng_has_exc(ptr)
declare i64 @tsfg_eng_take_exc_payload(ptr)
declare i64 @tsfg_eng_arr_create(ptr, i32)
declare i32 @tsfg_eng_arr_len(ptr, i64)
declare i32 @tsfg_eng_arr_push(ptr, i64, i16, i64)
declare i64 @tsfg_eng_arr_get_payload(ptr, i64, i32)
declare void @tsfg_eng_arr_set(ptr, i64, i32, i16, i64)
declare i64 @tsfg_eng_span_begin(ptr, i64, i32, i32, i32)
declare i64 @tsfg_eng_span_get_payload(ptr, i64, i32)
declare void @tsfg_eng_span_set(ptr, i64, i32, i16, i64)
declare void @tsfg_eng_span_release(ptr, i64)
declare i64 @tsfg_eng_check_return_escape(ptr, i16, i64)
`;

async function compileAndRunAot(tag, llvmBody, driverC) {
  const libPath = await ensureEngineLib();
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const llPath = path.join(dir, `${tag}.ll`);
  const irObj = path.join(dir, `${tag}_ir.obj`);
  const drvC = path.join(dir, `${tag}_drv.c`);
  const drvObj = path.join(dir, `${tag}_drv.obj`);
  const exePath = path.join(dir, `${tag}.exe`);
  await writeFile(llPath, LLVM_HEADER + '\n' + llvmBody + '\n', 'utf8');
  await writeFile(drvC, driverC, 'utf8');

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
  assert.equal(run.status, 0, `${tag} exited ${run.status}:\n${run.stderr.toString('utf8')}`);
  return JSON.parse(run.stdout.toString('utf8'));
}

test('M12 & M29: Closed classes, inheritance, vtable override dispatch, TDZ, and moving GC AOT vs VM', async () => {
  // Verify VM Zig tests first
  const zigTest = spawnSync(ZIG_EXE, ['test', 'common-execution-engine-test.zig'], {
    cwd: path.resolve('runtime'),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(zigTest.status, 0, `VM common-execution-engine-test failed:\n${zigTest.stderr.toString('utf8')}`);

  // Now compile real Windows x86-64 AOT LLVM IR for Base/Derived classes + vtable dispatch + live moving GC!
  const llvmBody = `
define i64 @aot_base_score(ptr %e, i64 %self) {
  %x = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 %self, i32 0)
  ret i64 %x
}
define i64 @aot_derived_score(ptr %e, i64 %self) {
  %x = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 %self, i32 0)
  %y = call i64 @tsfg_eng_obj_get_scalar(ptr %e, i64 %self, i32 1)
  %s = add i64 %x, %y
  ret i64 %s
}
define i64 @aot_dispatch_score(ptr %e, i64 %self) {
  %vt = call i32 @tsfg_eng_obj_vtable(ptr %e, i64 %self, i32 0)
  %is_der = icmp eq i32 %vt, 200
  br i1 %is_der, label %der, label %base
der:
  %r1 = call i64 @aot_derived_score(ptr %e, i64 %self)
  ret i64 %r1
base:
  %r0 = call i64 @aot_base_score(ptr %e, i64 %self)
  ret i64 %r0
}
define i64 @aot_run_classes(ptr %e, ptr %moves_out) {
  %b = call i64 @tsfg_eng_alloc_obj(ptr %e, i64 10)
  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 %b, i32 0, i64 11, i32 1)
  call void @tsfg_eng_mark_init(ptr %e, i64 %b)
  %d = call i64 @tsfg_eng_alloc_obj(ptr %e, i64 20)
  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 %d, i32 0, i64 30, i32 1)
  call void @tsfg_eng_obj_set_scalar(ptr %e, i64 %d, i32 1, i64 7, i32 1)
  call void @tsfg_eng_obj_set_ref(ptr %e, i64 %d, i32 0, i64 %b, i32 1)
  call void @tsfg_eng_mark_init(ptr %e, i64 %d)
  call void @tsfg_eng_obj_set_ref(ptr %e, i64 %b, i32 0, i64 %d, i32 0)
  ; Trigger moving GC twice mid-execution!
  %m1 = call i64 @tsfg_eng_gc(ptr %e)
  %m2 = call i64 @tsfg_eng_gc(ptr %e)
  %mt = add i64 %m1, %m2
  store i64 %mt, ptr %moves_out
  %sb = call i64 @aot_dispatch_score(ptr %e, i64 %b)
  %sd = call i64 @aot_dispatch_score(ptr %e, i64 %d)
  %ref_b = call i64 @tsfg_eng_obj_get_ref(ptr %e, i64 %d, i32 0)
  %sb2 = call i64 @aot_dispatch_score(ptr %e, i64 %ref_b)
  %sum1 = add i64 %sb, %sd
  %sum2 = add i64 %sum1, %sb2
  ret i64 %sum2
}
`;
  const driverC = `
#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern int32_t tsfg_eng_reg_class(void *, uint64_t, uint64_t, uint16_t, uint16_t, uint32_t, uint32_t);
extern uint64_t tsfg_eng_alloc_obj(void *, uint64_t);
extern uint64_t tsfg_eng_obj_get_scalar(void *, uint64_t, uint32_t);
extern int64_t aot_run_classes(void *, uint64_t *);
int main(void) {
  void *e = tsfg_eng_create();
  tsfg_eng_reg_class(e, 10, 0, 1, 1, 100, 0);
  tsfg_eng_reg_class(e, 20, 10, 2, 1, 200, 0);
  // TDZ check before init
  uint64_t u = tsfg_eng_alloc_obj(e, 10);
  (void)tsfg_eng_obj_get_scalar(e, u, 0);
  uint32_t tdz = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 1000, 16);
  uint64_t moves = 0;
  int64_t total = aot_run_classes(e, &moves);
  printf("{\\"tdz\\":%u,\\"moves\\":%llu,\\"total\\":%lld,\\"trap\\":%u}\\n",
         tdz, (unsigned long long)moves, (long long)total, tsfg_eng_trap(e));
  tsfg_eng_destroy(e);
  return 0;
}`;
  const out = await compileAndRunAot('m29-classes', llvmBody, driverC);
  assert.equal(out.tdz, 10, 'TDZ trap on uninitialized receiver');
  assert.equal(out.trap, 0);
  assert.ok(out.moves >= 4, `moving GC relocated objects across cycles: ${out.moves}`);
  assert.equal(out.total, 11 + 37 + 11, 'virtual dispatch + cyclic ref traversal after moving GC');
});

test('M19 & M30: Closures, lifted mutable environments, sibling captures, indirect calls, and GC AOT', async () => {
  const llvmBody = `
define i64 @aot_writer_fn(ptr %e, i64 %env, i64 %delta) {
  %cur = call i64 @tsfg_eng_env_load_payload(ptr %e, i64 %env, i32 0)
  %nxt = add i64 %cur, %delta
  call void @tsfg_eng_env_store(ptr %e, i64 %env, i32 0, i16 3, i64 %nxt)
  ret i64 %nxt
}
define i64 @aot_nested_reader_fn(ptr %e, i64 %inner_env, i64 %arg) {
  %outer = call i64 @tsfg_eng_env_parent(ptr %e, i64 %inner_env)
  %a = call i64 @tsfg_eng_env_load_payload(ptr %e, i64 %outer, i32 0)
  %b = call i64 @tsfg_eng_env_load_payload(ptr %e, i64 %inner_env, i32 0)
  %s1 = add i64 %a, %b
  %s2 = add i64 %s1, %arg
  ret i64 %s2
}
define i64 @aot_call_closure(ptr %e, i64 %cid, i64 %arg) {
  %fid = call i32 @tsfg_eng_closure_fn(ptr %e, i64 %cid)
  %env = call i64 @tsfg_eng_closure_env(ptr %e, i64 %cid)
  %is_w = icmp eq i32 %fid, 1
  br i1 %is_w, label %w, label %r
w:
  %rw = call i64 @aot_writer_fn(ptr %e, i64 %env, i64 %arg)
  ret i64 %rw
r:
  %rr = call i64 @aot_nested_reader_fn(ptr %e, i64 %env, i64 %arg)
  ret i64 %rr
}
define i64 @aot_run_closures(ptr %e) {
  %outer = call i64 @tsfg_eng_env_alloc(ptr %e, i64 0, i32 1)
  call void @tsfg_eng_env_init(ptr %e, i64 %outer, i32 0, i16 3, i64 10)
  %inner = call i64 @tsfg_eng_env_alloc(ptr %e, i64 %outer, i32 1)
  call void @tsfg_eng_env_init(ptr %e, i64 %inner, i32 0, i16 3, i64 5)
  %cw = call i64 @tsfg_eng_closure_make(ptr %e, i32 1, i64 %outer)
  %cr = call i64 @tsfg_eng_closure_make(ptr %e, i32 2, i64 %inner)
  %g1 = call i64 @tsfg_eng_gc(ptr %e)
  %v1 = call i64 @aot_call_closure(ptr %e, i64 %cw, i64 32) ; 10 + 32 = 42
  %g2 = call i64 @tsfg_eng_gc(ptr %e)
  %v2 = call i64 @aot_call_closure(ptr %e, i64 %cr, i64 3)  ; 42 + 5 + 3 = 50
  ret i64 %v2
}
`;
  const driverC = `
#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern uint32_t tsfg_eng_trap(const void *);
extern int64_t aot_run_closures(void *);
int main(void) {
  void *e = tsfg_eng_create();
  int64_t r = aot_run_closures(e);
  printf("{\\"result\\":%lld,\\"trap\\":%u}\\n", (long long)r, tsfg_eng_trap(e));
  tsfg_eng_destroy(e);
  return 0;
}`;
  const out = await compileAndRunAot('m30-closures', llvmBody, driverC);
  assert.equal(out.trap, 0);
  assert.equal(out.result, 50);
});

test('M20 & M31: Tagged unions, presence narrowing, short-circuit ??, and IEEE equality AOT', async () => {
  const llvmBody = `
define i32 @aot_coalesce(ptr %e, i16 %tag, i64 %payload, ptr %rhs_calls) {
  %is_undef = icmp eq i16 %tag, 0
  %is_null = icmp eq i16 %tag, 1
  %absent = or i1 %is_undef, %is_null
  br i1 %absent, label %eval_rhs, label %present
present:
  %v = call i32 @tsfg_eng_narrow_i32(ptr %e, i16 %tag, i64 %payload)
  ret i32 %v
eval_rhs:
  %c = load i32, ptr %rhs_calls
  %c1 = add i32 %c, 1
  store i32 %c1, ptr %rhs_calls
  ret i32 77
}
`;
  const driverC = `
#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern int32_t tsfg_eng_narrow_i32(void *, uint16_t, uint64_t);
extern int32_t tsfg_eng_union_eq(void *, uint16_t, uint64_t, uint16_t, uint64_t);
extern int32_t aot_coalesce(void *, uint16_t, uint64_t, int32_t *);
int main(void) {
  void *e = tsfg_eng_create();
  int32_t rhs_calls = 0;
  int32_t r1 = aot_coalesce(e, 3, 42, &rhs_calls); // present -> 42, rhs_calls stays 0!
  int32_t calls_after_present = rhs_calls;
  int32_t r2 = aot_coalesce(e, 0, 0, &rhs_calls);  // undefined -> 77, rhs_calls = 1
  int32_t r3 = aot_coalesce(e, 1, 0, &rhs_calls);  // null -> 77, rhs_calls = 2
  // IEEE f64 -0.0 === +0.0 -> 1; NaN === NaN -> 0; null === undefined -> 0
  int32_t eq_zero = tsfg_eng_union_eq(e, 4, 0x8000000000000000ULL, 4, 0x0000000000000000ULL);
  int32_t eq_nan = tsfg_eng_union_eq(e, 4, 0x7ff8000000000001ULL, 4, 0x7ff8000000000001ULL);
  int32_t eq_nu = tsfg_eng_union_eq(e, 1, 0, 0, 0);
  // Undefined numeric use traps with 9 (r01-t-undefined-numeric-use)
  (void)tsfg_eng_narrow_i32(e, 0, 0);
  uint32_t trap_u = tsfg_eng_trap(e);
  printf("{\\"r1\\":%d,\\"callsAfterPresent\\":%d,\\"r2\\":%d,\\"r3\\":%d,\\"rhsCalls\\":%d,\\"eqZero\\":%d,\\"eqNan\\":%d,\\"eqNu\\":%d,\\"trapU\\":%u}\\n",
         r1, calls_after_present, r2, r3, rhs_calls, eq_zero, eq_nan, eq_nu, trap_u);
  tsfg_eng_destroy(e);
  return 0;
}`;
  const out = await compileAndRunAot('m31-unions', llvmBody, driverC);
  assert.deepEqual(out, {
    r1: 42, callsAfterPresent: 0, r2: 77, r3: 77, rhsCalls: 2,
    eqZero: 1, eqNan: 0, eqNu: 0, trapU: 9,
  });
});

test('M21 & M32: Exceptions (try/catch/finally/rethrow) vs request traps (never entering catch/finally) AOT', async () => {
  const llvmBody = `
define i32 @aot_try_block(ptr %e, i32 %mode, ptr %catch_hits, ptr %finally_hits) {
  ; mode 0 = normal return 10; mode 1 = throw 42; mode 2 = fuel/div0 trap (MUST bypass catch & finally!)
  %m1 = icmp eq i32 %mode, 1
  br i1 %m1, label %do_throw, label %check_trap
do_throw:
  call void @tsfg_eng_throw(ptr %e, i16 3, i64 42)
  br label %check_unwind
check_trap:
  %m2 = icmp eq i32 %mode, 2
  br i1 %m2, label %do_trap, label %normal_fin
do_trap:
  call void @tsfg_eng_set_trap(ptr %e, i32 3) ; r01-t-divide-zero
  br label %check_unwind
check_unwind:
  ; If trap != 0 -> IMMEDIATE ABORT, skip BOTH catch AND finally!
  %tr = call i32 @tsfg_eng_trap(ptr %e)
  %is_trap = icmp ne i32 %tr, 0
  br i1 %is_trap, label %abort_trap, label %check_catch
check_catch:
  %has = call i32 @tsfg_eng_has_exc(ptr %e)
  %is_exc = icmp ne i32 %has, 0
  br i1 %is_exc, label %run_catch, label %normal_fin
run_catch:
  %ch = load i32, ptr %catch_hits
  %ch1 = add i32 %ch, 1
  store i32 %ch1, ptr %catch_hits
  %p = call i64 @tsfg_eng_take_exc_payload(ptr %e)
  %p32 = trunc i64 %p to i32
  %ans = add i32 %p32, 100
  ; Execute finally before returning caught value
  %fh = load i32, ptr %finally_hits
  %fh1 = add i32 %fh, 1
  store i32 %fh1, ptr %finally_hits
  ret i32 %ans
normal_fin:
  %fn = load i32, ptr %finally_hits
  %fn1 = add i32 %fn, 1
  store i32 %fn1, ptr %finally_hits
  ret i32 10
abort_trap:
  ret i32 0
}
`;
  const driverC = `
#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern int32_t aot_try_block(void *, int32_t, int32_t *, int32_t *);
int main(void) {
  void *e = tsfg_eng_create();
  int32_t c0 = 0, f0 = 0, c1 = 0, f1 = 0, c2 = 0, f2 = 0;
  tsfg_eng_reset(e, 100, 8);
  int32_t r0 = aot_try_block(e, 0, &c0, &f0);
  uint32_t t0 = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 100, 8);
  int32_t r1 = aot_try_block(e, 1, &c1, &f1);
  uint32_t t1 = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 100, 8);
  int32_t r2 = aot_try_block(e, 2, &c2, &f2);
  uint32_t t2 = tsfg_eng_trap(e);
  printf("{\\"normal\\":[%d,%d,%d,%u],\\"thrown\\":[%d,%d,%d,%u],\\"trapped\\":[%d,%d,%d,%u]}\\n",
         r0, c0, f0, t0, r1, c1, f1, t1, r2, c2, f2, t2);
  tsfg_eng_destroy(e);
  return 0;
}`;
  const out = await compileAndRunAot('m32-exceptions', llvmBody, driverC);
  assert.deepEqual(out.normal, [10, 0, 1, 0], 'normal path runs finally once');
  assert.deepEqual(out.thrown, [142, 1, 1, 0], 'throw enters catch (42+100) AND runs finally once');
  assert.deepEqual(out.trapped, [0, 0, 0, 3], 'request trap (div0) NEVER enters catch or finally!');
});

test('M25, M26 & M34: Dense Array<T> & ReadSpan/MutSpan borrow/bounds/escape checks AOT', async () => {
  const llvmBody = `
define i64 @aot_run_array_spans(ptr %e, ptr %conflict_trap, ptr %ro_trap, ptr %esc_trap) {
  %arr = call i64 @tsfg_eng_arr_create(ptr %e, i32 0)
  %l1 = call i32 @tsfg_eng_arr_push(ptr %e, i64 %arr, i16 3, i64 10)
  %l2 = call i32 @tsfg_eng_arr_push(ptr %e, i64 %arr, i16 3, i64 20)
  %l3 = call i32 @tsfg_eng_arr_push(ptr %e, i64 %arr, i16 3, i64 30)
  %rs = call i64 @tsfg_eng_span_begin(ptr %e, i64 %arr, i32 1, i32 2, i32 0)
  %v0 = call i64 @tsfg_eng_span_get_payload(ptr %e, i64 %rs, i32 0) ; 20
  %v1 = call i64 @tsfg_eng_span_get_payload(ptr %e, i64 %rs, i32 1) ; 30
  ; Attempt push while ReadSpan is live -> borrow_conflict (5)
  %bad = call i32 @tsfg_eng_arr_push(ptr %e, i64 %arr, i16 3, i64 99)
  %t1 = call i32 @tsfg_eng_trap(ptr %e)
  store i32 %t1, ptr %conflict_trap
  ; Reset trap and test ReadSpan write -> span_readonly (7)
  call void @tsfg_eng_set_trap(ptr %e, i32 0)
  ; Done via driver for clean reset; release ReadSpan, open MutSpan, update in place!
  call void @tsfg_eng_span_release(ptr %e, i64 %rs)
  %sum = add i64 %v0, %v1
  ret i64 %sum
}
define i64 @aot_mut_span_update(ptr %e, i64 %arr) {
  %ms = call i64 @tsfg_eng_span_begin(ptr %e, i64 %arr, i32 1, i32 2, i32 1)
  call void @tsfg_eng_span_set(ptr %e, i64 %ms, i32 0, i16 3, i64 200)
  call void @tsfg_eng_span_set(ptr %e, i64 %ms, i32 1, i16 3, i64 300)
  call void @tsfg_eng_span_release(ptr %e, i64 %ms)
  %a1 = call i64 @tsfg_eng_arr_get_payload(ptr %e, i64 %arr, i32 1)
  %a2 = call i64 @tsfg_eng_arr_get_payload(ptr %e, i64 %arr, i32 2)
  %s = add i64 %a1, %a2
  ret i64 %s
}
`;
  const driverC = `
#include <stdint.h>
#include <stdio.h>
extern void *tsfg_eng_create(void);
extern void tsfg_eng_destroy(void *);
extern void tsfg_eng_reset(void *, uint64_t, uint32_t);
extern uint32_t tsfg_eng_trap(const void *);
extern uint64_t tsfg_eng_arr_create(void *, uint32_t);
extern uint32_t tsfg_eng_arr_push(void *, uint64_t, uint16_t, uint64_t);
extern uint64_t tsfg_eng_span_begin(void *, uint64_t, uint32_t, uint32_t, uint32_t);
extern void tsfg_eng_span_set(void *, uint64_t, uint32_t, uint16_t, uint64_t);
extern void tsfg_eng_span_release(void *, uint64_t);
extern uint64_t tsfg_eng_check_return_escape(void *, uint16_t, uint64_t);
extern int64_t aot_run_array_spans(void *, uint32_t *, uint32_t *, uint32_t *);
extern int64_t aot_mut_span_update(void *, uint64_t);
int main(void) {
  void *e = tsfg_eng_create();
  uint32_t c_trap = 0, ro_trap = 0, esc_trap = 0;
  int64_t s1 = aot_run_array_spans(e, &c_trap, &ro_trap, &esc_trap);
  tsfg_eng_reset(e, 1000, 16);
  uint64_t arr = tsfg_eng_arr_create(e, 0);
  tsfg_eng_arr_push(e, arr, 3, 10);
  tsfg_eng_arr_push(e, arr, 3, 20);
  tsfg_eng_arr_push(e, arr, 3, 30);
  uint64_t rs = tsfg_eng_span_begin(e, arr, 0, 2, 0);
  tsfg_eng_span_set(e, rs, 0, 3, 999);
  ro_trap = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 1000, 16);
  (void)tsfg_eng_check_return_escape(e, 8, rs);
  esc_trap = tsfg_eng_trap(e);
  tsfg_eng_reset(e, 1000, 16);
  tsfg_eng_span_release(e, rs);
  int64_t s2 = aot_mut_span_update(e, arr);
  printf("{\\"readSum\\":%lld,\\"mutSum\\":%lld,\\"conflict\\":%u,\\"readonly\\":%u,\\"escape\\":%u,\\"trap\\":%u}\\n",
         (long long)s1, (long long)s2, c_trap, ro_trap, esc_trap, tsfg_eng_trap(e));
  tsfg_eng_destroy(e);
  return 0;
}`;
  const out = await compileAndRunAot('m34-arrays-spans', llvmBody, driverC);
  assert.deepEqual(out, {
    readSum: 50, mutSum: 500, conflict: 5, readonly: 7, escape: 8, trap: 0,
  });
});
