// SPDX-License-Identifier: MIT
// M33: Lossless WTF-8 String & StringView Windows AOT vs VM parity suite.
// Compiles verified Core IR string programs through BOTH:
//   (1) tsfg-core-ir --emit-bytecode -> tsfg-runtime.exe (production VM)
//   (2) tsfg-core-ir --canonicalize -> lowerStringCoreToLlvm -> clang-cl /O2
//       + lld-link against runtime/aot-string-runtime.zig (ManagedHeap + string-output.zig)
//       -> real Windows x86-64 AOT binary
// Verifies bit-exact VM vs AOT parity across lone surrogates, astral concatenation,
// UTF-16 indexing/slicing/comparison, persistent module string globals, moving GC
// compaction, out-of-bounds traps, and strict (r05-string-invalid-utf8) vs lossy output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { lowerStringCoreToLlvm } from '../../compiler/string-aot-llvm.mjs';
import { generalStringProgram, globalStringProgram } from './formal-string-program.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const VM_EXE = process.env.TSFG_VM_EXE ?? 'E:\\tsfg-build\\vm\\tsfg-runtime.exe';
const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
const BUILD_DIR = process.env.TSFG_M33_BUILD_DIR ?? 'E:\\tsfg-build\\m33';

const MSVC_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\lib\\x64';
const UCRT_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\ucrt\\x64';
const UM_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\um\\x64';
const MSVC_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\include';
const UCRT_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\ucrt';
const UM_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\um';
const SHARED_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\shared';
const BUILTINS_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\lib\\clang\\22\\lib\\windows\\clang_rt.builtins-x86_64.lib';

const registry = JSON.parse(readFileSync(new URL('../../contracts/registry.json', import.meta.url), 'utf8'));
const bytecodeSchema = JSON.parse(readFileSync(new URL('../../contracts/bytecode.schema.json', import.meta.url), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

let cachedStringLib = null;
async function ensureStringRuntimeLib() {
  if (cachedStringLib) return cachedStringLib;
  await mkdir(BUILD_DIR, { recursive: true });
  const libPath = path.join(BUILD_DIR, 'tsfg_aot_string.lib');
  const res = spawnSync(ZIG_EXE, [
    'build-lib', 'aot-string-runtime.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${libPath}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `zig build-lib aot-string-runtime failed:\n${res.stderr.toString('utf8')}`);
  cachedStringLib = libPath;
  return libPath;
}

function runCore(coreText, flag) {
  const res = spawnSync(CORE_EXE, [flag], {
    input: Buffer.from(coreText, 'utf8'),
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

function runVm(tbcBytes, requests, flag = '--requests') {
  const payload = JSON.stringify(requests.map((r) => ({ memoryBytes: 524288, ...r })));
  const res = spawnSync(VM_EXE, [flag, payload], { input: tbcBytes, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `VM failed: ${res.stderr.toString('utf8')}`);
  return JSON.parse(res.stdout.toString('utf8'));
}

async function buildStringAotExe(tag, coreText, driverC) {
  const libPath = await ensureStringRuntimeLib();
  const canon = runCore(coreText, '--canonicalize');
  assert.equal(canon.status, 0, `${tag} --canonicalize failed:\n${canon.stderr.toString('utf8')}`);
  const tbc = runCore(coreText, '--emit-bytecode');
  assert.equal(tbc.status, 0, `${tag} --emit-bytecode failed:\n${tbc.stderr.toString('utf8')}`);

  const lowered = lowerStringCoreToLlvm(canon.stdout.toString('utf8'));
  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const llPath = path.join(dir, `${tag}.ll`);
  const irObj = path.join(dir, `${tag}_ir.obj`);
  const drvC = path.join(dir, `${tag}_drv.c`);
  const drvObj = path.join(dir, `${tag}_drv.obj`);
  const exePath = path.join(dir, `${tag}.exe`);
  await writeFile(llPath, lowered.llvm, 'utf8');
  await writeFile(drvC, driverC(lowered.functions), 'utf8');

  const ccIr = spawnSync(CLANG_CL, ['/c', '/O2', '-x', 'ir', llPath, `/Fo${irObj}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ccIr.status, 0, `clang-cl IR failed:\n${ccIr.stderr.toString('utf8')}`);

  const ccDrv = spawnSync(CLANG_CL, [
    '/c', '/O2', '/MT',
    `/I${MSVC_INC}`, `/I${UCRT_INC}`, `/I${UM_INC}`, `/I${SHARED_INC}`,
    drvC, `/Fo${drvObj}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ccDrv.status, 0, `clang-cl driver failed:\n${ccDrv.stderr.toString('utf8')}`);

  const ld = spawnSync(LLD_LINK, [
    `/OUT:${exePath}`,
    `/LIBPATH:${MSVC_LIB}`, `/LIBPATH:${UCRT_LIB}`, `/LIBPATH:${UM_LIB}`,
    drvObj, irObj, libPath, BUILTINS_LIB,
    'libcmt.lib', 'libvcruntime.lib', 'libucrt.lib', 'kernel32.lib', 'ntdll.lib',
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ld.status, 0, `lld-link failed:\n${ld.stderr.toString('utf8')}`);
  return { tbcBytes: tbc.stdout, exePath, functions: lowered.functions };
}

const RUNTIME_C_DECLS = `
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void *tsfg_aot_str_create(uint64_t fuel);
extern void tsfg_aot_str_reset_request(void *ctx, uint64_t fuel);
extern void tsfg_aot_str_destroy(void *ctx);
extern uint32_t tsfg_aot_str_trap_code(const void *ctx);
extern uint64_t tsfg_aot_str_from_u16(void *ctx, const uint16_t *ptr, size_t len);
extern int32_t tsfg_aot_str_gc_collect(void *ctx);
extern int32_t tsfg_aot_str_export_utf8(void *ctx, uint64_t id, uint32_t strict, uint8_t *buf, size_t cap, size_t *out_len);

static void print_str_outcome(void *ctx, uint64_t handle, uint32_t strict, int comma) {
  if (comma) printf(",");
  uint32_t trap = tsfg_aot_str_trap_code(ctx);
  if (trap != 0) {
    printf("{\\"status\\":\\"failed\\",\\"trap\\":%u}", trap);
    return;
  }
  // Force moving GC compaction before export to prove live handles survive relocation!
  tsfg_aot_str_gc_collect(ctx);
  uint8_t buf[256];
  size_t len = 0;
  int32_t rc = tsfg_aot_str_export_utf8(ctx, handle, strict, buf, sizeof(buf), &len);
  if (rc == 1) {
    printf("{\\"status\\":\\"failed\\",\\"code\\":\\"r05-string-invalid-utf8\\"}");
    return;
  }
  if (rc != 0) {
    printf("{\\"status\\":\\"failed\\",\\"code\\":\\"r05-string-error\\"}");
    return;
  }
  printf("{\\"status\\":\\"returned\\",\\"byteLength\\":%zu,\\"hex\\":\\"", len);
  for (size_t i = 0; i < len; i++) printf("%02x", buf[i]);
  printf("\\"}");
}
`;

test('M33: General WTF-8 string, lone surrogates, slicing, and strict vs lossy UTF-8 boundary Windows AOT vs VM parity', async () => {
  const gen = generalStringProgram(3);
  const { tbcBytes, exePath } = await buildStringAotExe('m33-general', gen.core, (fns) => {
    const worker = fns[0].llvmSym;
    const entry = fns[1].llvmSym;
    return `${RUNTIME_C_DECLS}
extern uint64_t ${worker}(void *ctx, uint64_t s, uint64_t from, uint64_t to);
extern uint64_t ${entry}(void *ctx);
int main(void) {
  void *ctx = tsfg_aot_str_create(100);
  printf("[");
  // 0: entry() strict -> r05-string-invalid-utf8
  tsfg_aot_str_reset_request(ctx, 100);
  print_str_outcome(ctx, ${entry}(ctx), 1, 0);
  // 1: entry() lossy -> A\\0😀\\uFFFD
  tsfg_aot_str_reset_request(ctx, 100);
  print_str_outcome(ctx, ${entry}(ctx), 0, 1);
  // 2: worker([65,0,0xD83D,0xDE00,0xD800], 0, 4) strict -> A\\0😀
  tsfg_aot_str_reset_request(ctx, 100);
  uint16_t u1[] = {65, 0, 0xD83D, 0xDE00, 0xD800};
  uint64_t s1 = tsfg_aot_str_from_u16(ctx, u1, 5);
  tsfg_aot_str_gc_collect(ctx);
  print_str_outcome(ctx, ${worker}(ctx, s1, 0, 4), 1, 1);
  // 3: worker([65,0,0xD83D,0xDE00], 2, 3) strict -> r05-string-invalid-utf8 (splits surrogate pair!)
  tsfg_aot_str_reset_request(ctx, 100);
  uint16_t u2[] = {65, 0, 0xD83D, 0xDE00};
  uint64_t s2 = tsfg_aot_str_from_u16(ctx, u2, 4);
  print_str_outcome(ctx, ${worker}(ctx, s2, 2, 3), 1, 1);
  printf("]\\n");
  tsfg_aot_str_destroy(ctx);
  return 0;
}`;
  });

  const entryId = `sha256:${gen.functions[1].id}`;
  const workerId = `sha256:${gen.functions[0].id}`;
  const vmOut = runVm(tbcBytes, [
    { functionId: entryId, arguments: [], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
    { functionId: entryId, arguments: [], stringOutput: 'lossy', semanticFuel: 100, depth: 4 },
    { functionId: workerId, arguments: [{ type: 'string', value: [65, 0, 0xd83d, 0xde00, 0xd800] }, { type: 'usize', value: '0' }, { type: 'usize', value: '4' }], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
    { functionId: workerId, arguments: [{ type: 'string', value: [65, 0, 0xd83d, 0xde00] }, { type: 'usize', value: '2' }, { type: 'usize', value: '3' }], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
  ]);

  const aotProc = spawnSync(exePath, [], { windowsHide: true });
  assert.equal(aotProc.status, 0, aotProc.stderr.toString('utf8'));
  const aotOut = JSON.parse(aotProc.stdout.toString('utf8'));

  // Exact VM vs AOT parity!
  assert.equal(aotOut[0].code, vmOut[0].code);
  assert.equal(aotOut[0].code, 'r05-string-invalid-utf8');
  assert.equal(Buffer.from(aotOut[1].hex, 'hex').toString('utf8'), vmOut[1].result.value);
  assert.equal(aotOut[1].byteLength, vmOut[1].result.byteLength);
  assert.equal(Buffer.from(aotOut[2].hex, 'hex').toString('utf8'), vmOut[2].result.value);
  assert.equal(aotOut[2].byteLength, vmOut[2].result.byteLength);
  assert.equal(aotOut[3].code, vmOut[3].code);
  assert.equal(aotOut[3].code, 'r05-string-invalid-utf8');
});

test('M33: Persistent string globals + length/codeunit/concat(astral join)/UTF-16 compare/OOB trap AOT vs VM parity', async () => {
  // Part A: Persistent string globals surviving moving GC across requests
  const glob = globalStringProgram();
  const globCore = glob.core.replace(
    'tsfg_core.roots = [{kind = "application", source = 0 : i64, name = "entry", function = 1 : i64}]',
    'tsfg_core.roots = [{kind = "application", source = 0 : i64, name = "entry", function = 1 : i64}, {kind = "host-export", source = 0 : i64, name = "set", function = 2 : i64}]'
  );
  const gBuild = await buildStringAotExe('m33-globals', globCore, (fns) => {
    const initFn = fns[0].llvmSym;
    const entryFn = fns[1].llvmSym;
    const setFn = fns[2].llvmSym;
    return `${RUNTIME_C_DECLS}
extern int32_t ${initFn}(void *ctx);
extern uint64_t ${entryFn}(void *ctx);
extern uint64_t ${setFn}(void *ctx, uint64_t v);
int main(void) {
  void *ctx = tsfg_aot_str_create(100);
  ${initFn}(ctx);
  tsfg_aot_str_gc_collect(ctx);
  printf("[");
  tsfg_aot_str_reset_request(ctx, 100);
  print_str_outcome(ctx, ${entryFn}(ctx), 0, 0);
  tsfg_aot_str_reset_request(ctx, 100);
  uint16_t hi[] = {72, 105, 0xD83D, 0xDE80};
  uint64_t hs = tsfg_aot_str_from_u16(ctx, hi, 4);
  print_str_outcome(ctx, ${setFn}(ctx, hs), 1, 1);
  tsfg_aot_str_gc_collect(ctx);
  tsfg_aot_str_reset_request(ctx, 100);
  print_str_outcome(ctx, ${entryFn}(ctx), 1, 1);
  printf("]\\n");
  tsfg_aot_str_destroy(ctx);
  return 0;
}`;
  });
  const gVm = runVm(gBuild.tbcBytes, [
    { functionId: `sha256:${glob.functions[1].id}`, arguments: [], stringOutput: 'lossy', semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${glob.functions[2].id}`, arguments: [{ type: 'string', value: [72, 105, 0xd83d, 0xde80] }], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
    { functionId: `sha256:${glob.functions[1].id}`, arguments: [], stringOutput: 'strict', semanticFuel: 100, depth: 4 },
  ], '--module-requests');
  const gAot = JSON.parse(spawnSync(gBuild.exePath, [], { windowsHide: true }).stdout.toString('utf8'));
  for (let i = 0; i < 3; i++) {
    assert.equal(Buffer.from(gAot[i].hex, 'hex').toString('utf8'), gVm[i].result.value);
    assert.equal(gAot[i].byteLength, gVm[i].result.byteLength);
  }

  // Part B: length, codeunit, concat (joining lone surrogates into valid UTF-8!), UTF-16 compare, OOB trap
  const strT = '!tsfg_string.string';
  const u16T = '!tsfg_core.integer<"u16">';
  const usizeT = '!tsfg_core.integer<"usize">';
  const p = '/src/str_ops.ts';
  const sh = sha('str-ops-aot');
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
  const opsCore = `module attributes {tsfg_core.version = "0.12.0", tsfg_core.input_identity = "sha256:${sha('str-ops-aot')}", tsfg_core.source_hash = "sha256:${sh}", tsfg_core.source_path = "${p}", tsfg_core.source_length = 100 : i64, tsfg_core.target = "${bytecodeSchema.target.target}", tsfg_core.triple = "${bytecodeSchema.target.triple}", tsfg_core.data_layout = "${bytecodeSchema.target.llvmDataLayout}", tsfg_core.bytecode_schema = "${registry['tsfg.bytecode'].schemaHash}"} {\n${[fnLen, fnUnit, fnCat, fnCmp].map((f) => f.text).join('\n')}\n}\n`;

  const opsBuild = await buildStringAotExe('m33-ops', opsCore, (fns) => `${RUNTIME_C_DECLS}
extern uint64_t ${fns[0].llvmSym}(void *ctx, uint64_t s);
extern uint16_t ${fns[1].llvmSym}(void *ctx, uint64_t s, uint64_t idx);
extern uint64_t ${fns[2].llvmSym}(void *ctx, uint64_t a, uint64_t b);
extern int32_t ${fns[3].llvmSym}(void *ctx, uint64_t a, uint64_t b);
int main(void) {
  void *ctx = tsfg_aot_str_create(100);
  uint16_t uA[] = {65, 0xD83D, 0xDE00};
  uint16_t uHi[] = {0xD83D};
  uint16_t uLo[] = {0xDE00};
  uint16_t uPua[] = {0xE000};
  uint16_t uSur[] = {0xD83D, 0xDE00};
  uint16_t uOne[] = {65};
  uint64_t sA = tsfg_aot_str_from_u16(ctx, uA, 3);
  uint64_t sHi = tsfg_aot_str_from_u16(ctx, uHi, 1);
  uint64_t sLo = tsfg_aot_str_from_u16(ctx, uLo, 1);
  uint64_t sPua = tsfg_aot_str_from_u16(ctx, uPua, 1);
  uint64_t sSur = tsfg_aot_str_from_u16(ctx, uSur, 2);
  uint64_t sOne = tsfg_aot_str_from_u16(ctx, uOne, 1);
  tsfg_aot_str_gc_collect(ctx);
  uint64_t rLen = ${fns[0].llvmSym}(ctx, sA);
  uint16_t rUnit = ${fns[1].llvmSym}(ctx, sA, 1);
  uint64_t rCat = ${fns[2].llvmSym}(ctx, sHi, sLo);
  int32_t rCmp1 = ${fns[3].llvmSym}(ctx, sPua, sSur);
  int32_t rCmp2 = ${fns[3].llvmSym}(ctx, sSur, sPua);
  tsfg_aot_str_reset_request(ctx, 100);
  uint16_t rOob = ${fns[1].llvmSym}(ctx, sOne, 1);
  (void)rOob;
  uint32_t oobTrap = tsfg_aot_str_trap_code(ctx);
  tsfg_aot_str_reset_request(ctx, 100);
  printf("{\\"len\\":%llu,\\"unit\\":%u,\\"cmp1\\":%d,\\"cmp2\\":%d,\\"oobTrap\\":%u,\\"cat\\":",
         (unsigned long long)rLen, (unsigned)rUnit, rCmp1, rCmp2, oobTrap);
  print_str_outcome(ctx, rCat, 1, 0);
  printf("}\\n");
  tsfg_aot_str_destroy(ctx);
  return 0;
}`);

  const opsVm = runVm(opsBuild.tbcBytes, [
    { functionId: fnLen.id, arguments: [{ type: 'string', value: [65, 0xd83d, 0xde00] }], semanticFuel: 100, depth: 2 },
    { functionId: fnUnit.id, arguments: [{ type: 'string', value: [65, 0xd83d, 0xde00] }, { type: 'usize', value: '1' }], semanticFuel: 100, depth: 2 },
    { functionId: fnCat.id, arguments: [{ type: 'string', value: [0xd83d] }, { type: 'string', value: [0xde00] }], stringOutput: 'strict', semanticFuel: 100, depth: 2 },
    { functionId: fnCmp.id, arguments: [{ type: 'string', value: [0xe000] }, { type: 'string', value: [0xd83d, 0xde00] }], semanticFuel: 100, depth: 2 },
    { functionId: fnCmp.id, arguments: [{ type: 'string', value: [0xd83d, 0xde00] }, { type: 'string', value: [0xe000] }], semanticFuel: 100, depth: 2 },
    { functionId: fnUnit.id, arguments: [{ type: 'string', value: [65] }, { type: 'usize', value: '1' }], semanticFuel: 100, depth: 2 },
  ]);
  const opsAot = JSON.parse(spawnSync(opsBuild.exePath, [], { windowsHide: true }).stdout.toString('utf8'));
  assert.equal(String(opsAot.len), opsVm[0].result.value);
  assert.equal(String(opsAot.unit), opsVm[1].result.value);
  assert.equal(Buffer.from(opsAot.cat.hex, 'hex').toString('utf8'), opsVm[2].result.value);
  assert.equal(opsAot.cat.byteLength, opsVm[2].result.byteLength);
  assert.equal(String(opsAot.cmp1), opsVm[3].result.value);
  assert.equal(String(opsAot.cmp2), opsVm[4].result.value);
  assert.equal(opsAot.oobTrap, 2, 'AOT out-of-bounds codeunit traps cleanly');
  assert.equal(opsVm[5].status, 'failed');
});
