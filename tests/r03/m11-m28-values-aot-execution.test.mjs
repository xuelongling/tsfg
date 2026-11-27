// SPDX-License-Identifier: MIT
// M11 (Values & Layout) & M28 (Value/Component AOT) end-to-end native execution suite.
// Compiles official formal-value-llvm-v3 TypeScript packages through:
//   Common facts -> HIR -> Publication -> Core IR -> tsfg-core-ir --common-program --value-llvm
//   -> clang-cl /O2 -> lld-link -> real Windows x86-64 execution with EventV4 bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readCommonProgramFacts } from '../../compiler/common-program-facts.mjs';
import { projectCommonProgram } from '../../compiler/common-program-hir.mjs';
import { createCommonProgramPublication } from '../../compiler/common-program-analysis.mjs';
import { emitCommonProgramCore } from '../../compiler/common-program-core.mjs';

const CORE_EXE = process.env.TSFG_CORE_IR_EXE ?? 'E:\\tsfg-build\\mlir-sdk\\bin\\tsfg-core-ir.exe';
const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
const BUILD_DIR = process.env.TSFG_M11_M28_BUILD_DIR ?? 'E:\\tsfg-build\\m11-m28';
const FIXTURE_ROOT = path.resolve('tests/r03/testdata/formal-value-llvm-v3');

const MSVC_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\lib\\x64';
const UCRT_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\ucrt\\x64';
const UM_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\um\\x64';
const MSVC_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\include';
const UCRT_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\ucrt';
const UM_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\um';
const SHARED_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\shared';

function lowerFixtureToValueLlvm(fixtureName, targetFnName) {
  const pkgPath = path.join(FIXTURE_ROOT, fixtureName, 'package.json');
  const facts = readCommonProgramFacts(readFileSync(pkgPath));
  const hir = projectCommonProgram(facts);
  const pub = createCommonProgramPublication(hir);
  const req = { targets: hir.closure.requiredRoots.filter((r) => r.kind === 'kernel').map((r) => r.target).sort() };
  const core = emitCommonProgramCore(hir, pub, req);
  const fn = hir.functions.find((f) => f.name === targetFnName);
  assert.ok(fn, `function ${targetFnName} found in ${fixtureName}`);
  const res = spawnSync(CORE_EXE, ['--common-program', '--value-llvm', fn.id], {
    input: Buffer.from(core, 'utf8'),
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return { status: res.status, llvm: res.stdout.toString('utf8'), stderr: res.stderr.toString('utf8'), symbol: `value_${fn.id.slice(7)}` };
}

// Parse LLVM function signature `define <retTy> @<sym>(ptr %0, ptr %1, <argTys...>)`
// and append a C-callable thunk `define void @tsfg_invoke(ptr %state, ptr %ev, ptr %in, ptr %out)`
// that loads every parameter from %in (packed as an LLVM struct `{ arg0, arg1, ... }`)
// and stores the return value to %out.
function appendInvokeThunk(llvmText, symbol) {
  const re = new RegExp(`^define\\s+(.+?)\\s+@${symbol}\\(([^)]*)\\)[^{]*\\{`, 'm');
  const m = llvmText.match(re);
  assert.ok(m, `could not find define @${symbol} in emitted LLVM IR`);
  const retTy = m[1].trim();
  const paramsRaw = m[2].trim();
  // Split top-level comma-separated parameters (respecting nested `{ ... }`)
  const params = [];
  let depth = 0, start = 0;
  for (let i = 0; i < paramsRaw.length; i++) {
    const ch = paramsRaw[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      params.push(paramsRaw.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (paramsRaw.length > start) params.push(paramsRaw.slice(start).trim());
  // Drop first two args (ptr %0, ptr %1) -> user args
  const userTys = params.slice(2).map((p) => p.replace(/\s+%[\w.$-]+$/, '').trim());

  const lines = [
    '',
    'define void @tsfg_invoke(ptr %state, ptr %ev, ptr %in, ptr %out) {',
  ];
  const callArgs = ['ptr %state', 'ptr %ev'];
  if (userTys.length > 0) {
    const inStruct = `{ ${userTys.join(', ')} }`;
    for (let i = 0; i < userTys.length; i++) {
      lines.push(`  %p${i} = getelementptr inbounds ${inStruct}, ptr %in, i32 0, i32 ${i}`);
      lines.push(`  %a${i} = load ${userTys[i]}, ptr %p${i}`);
      callArgs.push(`${userTys[i]} %a${i}`);
    }
  }
  if (retTy === 'void') {
    lines.push(`  call void @${symbol}(${callArgs.join(', ')})`);
  } else {
    lines.push(`  %res = call ${retTy} @${symbol}(${callArgs.join(', ')})`);
    lines.push(`  store ${retTy} %res, ptr %out`);
  }
  lines.push('  ret void');
  lines.push('}');
  return { llvmWithThunk: llvmText + '\n' + lines.join('\n') + '\n', retTy, userTys };
}

let cachedRunnerObj = null;
async function ensureRunnerObj() {
  if (cachedRunnerObj) return cachedRunnerObj;
  await mkdir(BUILD_DIR, { recursive: true });
  const cPath = path.join(BUILD_DIR, 'value_runner.c');
  const objPath = path.join(BUILD_DIR, 'value_runner.obj');
  const cCode = `
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  uint64_t fuel;
  uint32_t depth_limit;
  uint32_t depth;
  uint32_t trap_kind;
  uint32_t trap_start;
  uint32_t trap_end;
  uint64_t events;
} EventState;

static int32_t tsfg_event_cb(EventState *s, uint32_t kind, uint32_t entity, uint32_t start, uint32_t end, uint64_t site) {
  (void)entity; (void)site;
  s->events++;
  if (s->trap_kind != 0) {
    if (kind == 3 && s->depth > 0) s->depth--;
    return 0;
  }
  if (kind == 0) {
    if (s->depth >= s->depth_limit) {
      s->trap_kind = 8; s->trap_start = start; s->trap_end = end;
      return 0;
    }
    s->depth++;
    return 1;
  }
  if (kind == 1) {
    if (s->fuel == 0) {
      s->trap_kind = 7; s->trap_start = start; s->trap_end = end;
      return 0;
    }
    s->fuel--;
    return 1;
  }
  if (kind == 2 || kind == 4) return 1;
  if (kind == 3) {
    if (s->depth > 0) s->depth--;
    return 1;
  }
  // Arithmetic or presence traps (5=div0, 6=rem0, 7=shift, 0x100=undefined-numeric-use)
  s->trap_kind = kind;
  s->trap_start = start;
  s->trap_end = end;
  return 0;
}

extern void tsfg_invoke(void *state, void *ev, void *in_buf, void *out_buf);

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 5) return 2;
  uint64_t fuel = strtoull(argv[1], NULL, 10);
  uint32_t depth = (uint32_t)strtoul(argv[2], NULL, 10);
  const char *hex_in = argv[3];
  size_t out_len = (size_t)strtoul(argv[4], NULL, 10);

  uint8_t in_buf[256];
  uint8_t out_buf[256];
  memset(in_buf, 0, sizeof(in_buf));
  memset(out_buf, 0, sizeof(out_buf));
  size_t in_len = strlen(hex_in) / 2;
  for (size_t i = 0; i < in_len && i < sizeof(in_buf); i++) {
    in_buf[i] = (uint8_t)((hexval(hex_in[i * 2]) << 4) | hexval(hex_in[i * 2 + 1]));
  }

  EventState st;
  memset(&st, 0, sizeof(st));
  st.fuel = fuel;
  st.depth_limit = depth;
  st.depth = 1; // root entry frame

  tsfg_invoke(&st, (void *)&tsfg_event_cb, in_buf, out_buf);

  printf("{\\"trap\\":%u,\\"start\\":%u,\\"end\\":%u,\\"fuelRemaining\\":%llu,\\"events\\":%llu,\\"outHex\\":\\"",
         st.trap_kind, st.trap_start, st.trap_end,
         (unsigned long long)st.fuel, (unsigned long long)st.events);
  for (size_t i = 0; i < out_len && i < sizeof(out_buf); i++) {
    printf("%02x", out_buf[i]);
  }
  printf("\\"}\\n");
  return 0;
}
`;
  await writeFile(cPath, cCode, 'utf8');
  const cc = spawnSync(CLANG_CL, [
    '/c', '/O2', '/MT',
    `/I${MSVC_INC}`, `/I${UCRT_INC}`, `/I${UM_INC}`, `/I${SHARED_INC}`,
    cPath, `/Fo${objPath}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (cc.error) throw cc.error;
  assert.equal(cc.status, 0, `compile value_runner.c failed:\n${cc.stderr.toString('utf8')}`);
  cachedRunnerObj = objPath;
  return objPath;
}

async function buildValueExe(tag, fixtureName, targetFnName) {
  const runnerObj = await ensureRunnerObj();
  const lowered = lowerFixtureToValueLlvm(fixtureName, targetFnName);
  assert.equal(lowered.status, 0, `${fixtureName}:${targetFnName} --value-llvm failed:\n${lowered.stderr}`);
  const { llvmWithThunk, retTy, userTys } = appendInvokeThunk(lowered.llvm, lowered.symbol);

  const dir = path.join(BUILD_DIR, tag);
  await mkdir(dir, { recursive: true });
  const llPath = path.join(dir, `${tag}.ll`);
  const objPath = path.join(dir, `${tag}.obj`);
  const exePath = path.join(dir, `${tag}.exe`);
  await writeFile(llPath, llvmWithThunk, 'utf8');

  const cc = spawnSync(CLANG_CL, ['/c', '/O2', '-x', 'ir', llPath, `/Fo${objPath}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (cc.error) throw cc.error;
  assert.equal(cc.status, 0, `clang-cl IR failed for ${tag}:\n${cc.stderr.toString('utf8')}`);

  const ld = spawnSync(LLD_LINK, [
    `/OUT:${exePath}`,
    `/LIBPATH:${MSVC_LIB}`, `/LIBPATH:${UCRT_LIB}`, `/LIBPATH:${UM_LIB}`,
    runnerObj, objPath,
    'libcmt.lib', 'libvcruntime.lib', 'libucrt.lib', 'kernel32.lib',
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (ld.error) throw ld.error;
  assert.equal(ld.status, 0, `lld-link failed for ${tag}:\n${ld.stderr.toString('utf8')}`);
  return { exePath, retTy, userTys };
}

function invokeValue(exePath, inBuf, outLen, fuel = 500, depth = 16) {
  const res = spawnSync(exePath, [String(fuel), String(depth), inBuf.toString('hex'), String(outLen)], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, `${exePath} exited ${res.status}:\n${res.stderr.toString('utf8')}`);
  const parsed = JSON.parse(res.stdout.toString('utf8'));
  return { ...parsed, outBuf: Buffer.from(parsed.outHex, 'hex') };
}

test('M11 & M28: Value copy isolation, nested value layout, and padded semantic equality ignoring padding bytes', async () => {
  // 1. valueCopy(Delta{42}) -> Delta{7}, valueCopyOriginal(Delta{42}) -> 42
  const copyExe = await buildValueExe('value-copy', 'value-copy', 'valueCopy');
  const origExe = await buildValueExe('copy-original', 'copy-original', 'valueCopyOriginal');
  const d42 = Buffer.alloc(4);
  d42.writeInt32LE(42, 0);
  const rCopy = invokeValue(copyExe.exePath, d42, 4);
  assert.equal(rCopy.trap, 0);
  assert.equal(rCopy.outBuf.readInt32LE(0), 7);
  const rOrig = invokeValue(origExe.exePath, d42, 4);
  assert.equal(rOrig.trap, 0);
  assert.equal(rOrig.outBuf.readInt32LE(0), 42, 'copy mutation must not affect original value');

  // 2. nestedRead(Nested{{13}, 99}) -> 13; nestedCopy(Nested{{13}, 99}) -> Nested{{7}, 9}
  const nReadExe = await buildValueExe('nested-read', 'nested-read', 'nestedRead');
  const nCopyExe = await buildValueExe('nested-copy', 'nested-copy', 'nestedCopy');
  const nestedIn = Buffer.alloc(8);
  nestedIn.writeInt32LE(13, 0);
  nestedIn.writeInt32LE(99, 4);
  const rnRead = invokeValue(nReadExe.exePath, nestedIn, 4);
  assert.equal(rnRead.trap, 0);
  assert.equal(rnRead.outBuf.readInt32LE(0), 13);
  const rnCopy = invokeValue(nCopyExe.exePath, nestedIn, 8);
  assert.equal(rnCopy.trap, 0);
  assert.deepEqual([rnCopy.outBuf.readInt32LE(0), rnCopy.outBuf.readInt32LE(4)], [7, 9]);

  // 3. paddedEqual(Padded{flag, pad[7], n}, Padded{flag, pad[7], n}): 16 bytes each, garbage in padding!
  const padExe = await buildValueExe('padded-equal', 'padded-equal', 'paddedEqual');
  const mkPaddedPair = (f1, p1, n1, f2, p2, n2) => {
    const buf = Buffer.alloc(32);
    buf.fill(p1, 0, 16);
    buf[0] = f1;
    buf.writeBigInt64LE(BigInt(n1), 8);
    buf.fill(p2, 16, 32);
    buf[16] = f2;
    buf.writeBigInt64LE(BigInt(n2), 24);
    return buf;
  };
  // Different padding bytes (0xAA vs 0x55), same field values -> MUST be equal (1)!
  assert.equal(invokeValue(padExe.exePath, mkPaddedPair(1, 0xaa, 7, 1, 0x55, 7), 1).outBuf[0], 1, 'padding bytes ignored');
  assert.equal(invokeValue(padExe.exePath, mkPaddedPair(0, 0xff, -9999999999n, 0, 0x00, -9999999999n), 1).outBuf[0], 1);
  // Different flag -> 0; different i64 -> 0
  assert.equal(invokeValue(padExe.exePath, mkPaddedPair(1, 0x00, 7, 0, 0x00, 7), 1).outBuf[0], 0);
  assert.equal(invokeValue(padExe.exePath, mkPaddedPair(1, 0x00, 7, 1, 0x00, 8), 1).outBuf[0], 0);

  // 4. valueEqual & valueNotEqual on Nested{Delta{n}, tag}
  const eqExe = await buildValueExe('value-equal', 'value-equal', 'valueEqual');
  const neExe = await buildValueExe('value-not-equal', 'value-not-equal', 'valueNotEqual');
  const mkNestedPair = (a0, a1, b0, b1) => {
    const b = Buffer.alloc(16);
    b.writeInt32LE(a0, 0); b.writeInt32LE(a1, 4); b.writeInt32LE(b0, 8); b.writeInt32LE(b1, 12);
    return b;
  };
  assert.equal(invokeValue(eqExe.exePath, mkNestedPair(5, 9, 5, 9), 1).outBuf[0], 1);
  assert.equal(invokeValue(eqExe.exePath, mkNestedPair(5, 9, 5, 8), 1).outBuf[0], 0);
  assert.equal(invokeValue(neExe.exePath, mkNestedPair(5, 9, 5, 9), 1).outBuf[0], 0);
  assert.equal(invokeValue(neExe.exePath, mkNestedPair(5, 9, 6, 9), 1).outBuf[0], 1);
});

test('M11 & M28: IEEE-754 floating value copy/equality, implicit construction, and compound field update order', async () => {
  // 1. Floating{f32 single, [4 pad], f64 wide} (16 bytes): bit-exact copy & IEEE equality (-0 === +0, NaN !== NaN)
  const fCopyExe = await buildValueExe('value-float-copy', 'value-floating-copy-equal', 'valueFloatingCopy');
  const fEqExe = await buildValueExe('value-float-eq', 'value-floating-copy-equal', 'valueFloatingEqual');
  const fIn = Buffer.alloc(16);
  fIn.writeUInt32LE(0x80000000, 0); // -0.0f
  fIn.writeBigUInt64LE(0x7ff8000000001234n, 8); // quiet NaN with payload
  const rfCopy = invokeValue(fCopyExe.exePath, fIn, 16);
  assert.equal(rfCopy.trap, 0);
  assert.equal(rfCopy.outBuf.readUInt32LE(0), 0x80000000, '-0.0f bit pattern preserved');
  assert.equal(rfCopy.outBuf.readBigUInt64LE(8), 0x7ff8000000001234n, 'f64 NaN payload preserved');

  const mkFloatPair = (s1, w1, s2, w2) => {
    const b = Buffer.alloc(32);
    b.writeUInt32LE(s1, 0); b.writeBigUInt64LE(w1, 8);
    b.writeUInt32LE(s2, 16); b.writeBigUInt64LE(w2, 24);
    return b;
  };
  // +0.0 === -0.0 -> 1
  assert.equal(invokeValue(fEqExe.exePath, mkFloatPair(0x00000000, 0x8000000000000000n, 0x80000000, 0x0000000000000000n), 1).outBuf[0], 1);
  // NaN === NaN -> 0
  assert.equal(invokeValue(fEqExe.exePath, mkFloatPair(0x7fc00001, 0x3ff0000000000000n, 0x7fc00001, 0x3ff0000000000000n), 1).outBuf[0], 0);

  // 2. Implicit construction: Constructed{n=17, guard=23} & independent instances
  const ctorExe = await buildValueExe('value-ctor', 'value-implicit-construction', 'valueConstruct');
  const ctorIndepExe = await buildValueExe('value-ctor-indep', 'value-implicit-construction', 'valueConstructIndependent');
  const rCtor = invokeValue(ctorExe.exePath, Buffer.alloc(0), 8);
  assert.equal(rCtor.trap, 0);
  assert.deepEqual([rCtor.outBuf.readInt32LE(0), rCtor.outBuf.readInt32LE(4)], [17, 23]);
  const rIndep = invokeValue(ctorIndepExe.exePath, Buffer.alloc(0), 4);
  assert.equal(rIndep.trap, 0);
  assert.equal(rIndep.outBuf.readInt32LE(0), 17);

  // 3. Compound field updates: postfix, prefix, receiver evaluated once before RHS rebind, RHS trap
  const postExe = await buildValueExe('value-postfix', 'value-field-updates', 'valueFieldPostfix');
  const preExe = await buildValueExe('value-prefix', 'value-field-updates', 'valueFieldPrefix');
  const rebindExe = await buildValueExe('value-rebind', 'value-field-updates', 'valueCompoundRebind');
  const rhsTrapExe = await buildValueExe('value-rhs-trap', 'value-field-updates', 'valueCompoundRhsTrap');
  const d10 = Buffer.alloc(4); d10.writeInt32LE(10, 0);
  assert.equal(invokeValue(postExe.exePath, d10, 4).outBuf.readInt32LE(0), 10);
  assert.equal(invokeValue(preExe.exePath, d10, 4).outBuf.readInt32LE(0), 9);
  const rebindIn = Buffer.alloc(8); rebindIn.writeInt32LE(100, 0); rebindIn.writeInt32LE(30, 4);
  assert.equal(invokeValue(rebindExe.exePath, rebindIn, 4).outBuf.readInt32LE(0), 70, 'current.n -= mark(current = replacement) => 100 - 30 = 70');
  const rTrap = invokeValue(rhsTrapExe.exePath, d10, 4);
  assert.equal(rTrap.trap, 0x100, 'undefined numeric use trap 0x100');
});

test('M11 & M28: Numeric presence, loops, recursion/fuel/depth traps, void copy calls, and negative capability gates', async () => {
  // 1. valueNumericMaybe({{i16 tag, i32 val}}, bool b): tag=1 is present i32 -> val+7, b=true overwrites with undefined -> trap 0x100!
  const presExe = await buildValueExe('value-presence', 'value-numeric-presence', 'valueNumericMaybe');
  // Struct layout: { { { i16, i32 } }, i8 } -> offset 0: i16 tag (1=present, 0=undefined), offset 4: i32 val, offset 8: i8 b
  const pPresent = Buffer.alloc(12);
  pPresent.writeUInt16LE(1, 0); pPresent.writeInt32LE(10, 4); pPresent[8] = 0;
  const rPres = invokeValue(presExe.exePath, pPresent, 4);
  assert.equal(rPres.trap, 0);
  assert.equal(rPres.outBuf.readInt32LE(0), 17);
  const pAbsent = Buffer.alloc(12);
  pAbsent.writeUInt16LE(1, 0); pAbsent.writeInt32LE(10, 4); pAbsent[8] = 1;
  assert.equal(invokeValue(presExe.exePath, pAbsent, 4).trap, 0x100);

  // 2. valueVoidCall(Delta{55}): touch(d) mutates its copy, caller retains 55!
  const voidExe = await buildValueExe('value-void', 'value-void-call', 'valueVoidCall');
  const d55 = Buffer.alloc(4); d55.writeInt32LE(55, 0);
  assert.equal(invokeValue(voidExe.exePath, d55, 4).outBuf.readInt32LE(0), 55);

  // 3. valueRecursiveAggregate(RecursiveFloating{n=1, wide=-0.0}, stop=false) -> {n=9, wide=-0.0}
  const recAggExe = await buildValueExe('value-rec-agg', 'value-recursive-aggregate', 'valueRecursiveAggregate');
  const raIn = Buffer.alloc(24);
  raIn.writeInt32LE(1, 0);
  raIn.writeBigUInt64LE(0x8000000000000000n, 8);
  raIn[16] = 0; // stop = false
  const rRecAgg = invokeValue(recAggExe.exePath, raIn, 16);
  assert.equal(rRecAgg.trap, 0);
  assert.equal(rRecAgg.outBuf.readInt32LE(0), 9);
  assert.equal(rRecAgg.outBuf.readBigUInt64LE(8), 0x8000000000000000n);

  // 4. valueRecursive(Delta{1}) with depth=4 -> deterministic depth trap (8) & fuel=0 -> fuel trap (7)!
  const recExe = await buildValueExe('value-rec', 'value-recursive', 'valueRecursive');
  const d1 = Buffer.alloc(4); d1.writeInt32LE(1, 0);
  assert.equal(invokeValue(recExe.exePath, d1, 4, 500, 4).trap, 8, 'r01-t-depth');
  assert.equal(invokeValue(recExe.exePath, d1, 4, 0, 16).trap, 7, 'r01-t-fuel');

  // 5. Negative capability rejection: gc-callee rejected by --value-llvm with [core-ir-value-llvm-capability]
  const gcRes = lowerFixtureToValueLlvm('gc-callee', 'valueGcCall');
  assert.equal(gcRes.status, 3);
  assert.match(gcRes.stderr, /core-ir-value-llvm-capability/);

  // 6. Negative Source rejection: empty-asserted rejected at Common Source boundary
  assert.throws(
    () => readCommonProgramFacts(readFileSync(path.join(FIXTURE_ROOT, 'empty-asserted', 'package.json'))),
    (e) => e instanceof TypeError && e.code === 'r03-common-program-source'
  );
});
