// SPDX-License-Identifier: MIT
// R04 Pillar 3 & 4: DataLayout-driven `.tsfgabi`, tsfg/Zig/C bindgen, Zig comptime
// exporter, static layout assertions, runtime handshake, and REAL Windows x64
// bidirectional Zig <-> clang-cl C <-> LLVM IR AOT ABI probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { emitAbiArtifact, parseLlvmDataLayout, validateAbiArtifact } from '../../compiler/r04-abi.mjs';
import { generateCHeader, generateTsDeclarations, generateZigBindings } from '../../compiler/r04-bindgen.mjs';
import { WINDOWS_X64_TARGET } from '../../compiler/r04-identity.mjs';
import { BUILD_DIR, buildFullR04AbiSpec, CLANG_CL, ensureR04ValidatorExe, LLD_LINK, ZIG_EXE } from './r04-test-helpers.mjs';

const MSVC_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\lib\\x64';
const UCRT_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\ucrt\\x64';
const UM_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Lib\\10.0.26100.9169\\um\\x64';
const MSVC_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\msvc\\include';
const UCRT_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\ucrt';
const UM_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\um';
const SHARED_INC = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\winsdk\\Include\\10.0.26100.9169\\shared';
const BUILTINS_LIB = 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\lib\\clang\\22\\lib\\windows\\clang_rt.builtins-x86_64.lib';

test('R04 DataLayout engine computes exact Win64 layouts, classifications, and rejects non-ABI types', () => {
  const dl = parseLlvmDataLayout(WINDOWS_X64_TARGET.llvmDataLayout);
  assert.equal(dl.ptrBits, 64);
  assert.equal(dl.scalars.bool.size, 1);
  assert.equal(dl.scalars.usize.size, 8);

  const art = emitAbiArtifact(buildFullR04AbiSpec());
  const verified = validateAbiArtifact(art.bytes, { target: 'windows-x86_64-msvc', triple: 'x86_64-pc-windows-msvc' });
  const byName = new Map(verified.payload.types.map((t) => [t.name, t]));
  const fnByName = new Map(verified.payload.functions.map((f) => [f.name, f]));

  // Layout assertions (DataLayout-driven, zero hand guesses)
  assert.equal(byName.get('SmallPair').byteSize, 8);
  assert.equal(byName.get('SmallPair').fields[1].offset, 4);
  assert.deepEqual(byName.get('SmallPair').padding, [{ start: 1, end: 4 }]);
  assert.equal(byName.get('Vec3').byteSize, 12);
  assert.equal(byName.get('Quat16').byteSize, 16);
  assert.equal(byName.get('Transform32').byteSize, 32);
  assert.equal(byName.get('Transform32').fields[3].offset, 24);
  assert.equal(byName.get('EntityHandle').byteSize, 8);
  assert.equal(byName.get('EntityHandle').align, 4);
  assert.equal(byName.get('I32ReadSpan').byteSize, 16);
  assert.equal(byName.get('StringView').byteSize, 16);
  assert.equal(byName.get('PayloadUnion').byteSize, 16);
  assert.equal(byName.get('PayloadUnion').payloadOffset, 8);

  // Microsoft x64 parameter & return classification
  const extFn = fnByName.get('ext_and_bool');
  assert.equal(extFn.params[0].extension, 'signext');
  assert.equal(extFn.params[1].extension, 'zeroext');
  assert.equal(extFn.params[4].extension, 'zeroext');
  assert.equal(extFn.params[4].location, 'STACK_0'); // 5th arg spills to stack!
  assert.equal(extFn.params[6].location, 'STACK_16'); // 7th arg (f64) spills to stack!

  assert.equal(fnByName.get('small_pair_step').returnClass.mode, 'by_val_reg');
  assert.equal(fnByName.get('small_pair_step').params[0].mode, 'direct');

  // 12B, 16B, 32B structs MUST use sret_indirect (RCX) + by_ref_copy, shifting param 0 to RDX!
  for (const fnName of ['vec3_add', 'quat16_scale', 'transform32_step']) {
    const f = fnByName.get(fnName);
    assert.equal(f.returnClass.mode, 'sret_indirect', `${fnName} must return via sret`);
    assert.equal(f.returnClass.register, 'RCX');
    assert.equal(f.params[0].mode, 'by_ref_copy');
    assert.equal(f.params[0].location, 'RDX');
    assert.equal(f.params[0].semanticKind, 'value');
  }

  // Borrow vs Value semantics preserved
  const spanFn = fnByName.get('span_and_str_sum');
  assert.equal(spanFn.params[0].semanticKind, 'borrow');
  assert.equal(spanFn.params[1].semanticKind, 'borrow');

  // Non-ABI-safe types MUST be rejected
  for (const badKind of ['bare_gc_ref', 'managed_string', 'closure_env', 'any', 'unspecialized_generic']) {
    assert.throws(
      () => emitAbiArtifact({ types: [{ kind: badKind, name: 'BadType' }] }),
      /r04-abi-forbidden-type/,
      `forbidden ABI kind ${badKind} must be rejected`,
    );
  }
});

test('R04 Bidirectional REAL Windows x64 ABI Probe: Generated Zig + C11 + LLVM IR AOT + Runtime Handshake + Zig Comptime Export', async () => {
  const art = emitAbiArtifact(buildFullR04AbiSpec());
  const validatorExe = await ensureR04ValidatorExe();

  // 1. Validate `.tsfgabi` with standalone Zig Runtime validator
  const valRes = spawnSync(validatorExe, ['--validate', 'abi'], { input: art.bytes, windowsHide: true });
  assert.equal(valRes.status, 0, `Zig ABI validator failed: ${valRes.stderr.toString('utf8')}`);

  // 2. Verify Zig comptime ABI exporter matches compiler DataLayout calculations
  const expRes = spawnSync(validatorExe, ['--export-zig-abi'], { windowsHide: true });
  assert.equal(expRes.status, 0, `Zig comptime exporter failed: ${expRes.stderr.toString('utf8')}`);
  const zigExported = JSON.parse(expRes.stdout.toString('utf8'));
  const zigExportMap = new Map(zigExported.types.map((t) => [t.name, t]));
  const abiTypeMap = new Map(art.payload.types.map((t) => [t.name, t]));
  for (const name of ['Vec3', 'Quat16', 'Mode']) {
    assert.equal(zigExportMap.get(name).byteSize, abiTypeMap.get(name).byteSize, `comptime export ${name} byteSize`);
    assert.equal(zigExportMap.get(name).align, abiTypeMap.get(name).align, `comptime export ${name} align`);
  }
  assert.equal(zigExportMap.get('SmallPair').byteSize, abiTypeMap.get('SmallPair').byteSize);
  assert.equal(zigExportMap.get('SmallPair').fields[1].offset, abiTypeMap.get('SmallPair').fields[1].offset);
  assert.equal(zigExportMap.get('LargePose').byteSize, abiTypeMap.get('Transform32').byteSize);
  assert.equal(zigExportMap.get('LargePose').fields[3].offset, abiTypeMap.get('Transform32').fields[3].offset);

  // 3. Generate Zig, C11, and TypeScript bindings from the SINGLE `.tsfgabi` artifact
  const probeDir = path.join(BUILD_DIR, 'abi-probe');
  await mkdir(probeDir, { recursive: true });
  const zigBindings = generateZigBindings(art.payload, { emitExternFunctions: false });
  const cHeader = generateCHeader(art.payload);
  const tsDecls = generateTsDeclarations(art.payload);
  assert.ok(tsDecls.includes(art.payload.abiHash));
  assert.ok(tsDecls.includes('TSFG_ABI_LAYOUT_ASSERTIONS'));

  // Zig implementation importing the generated bindings (all comptime assertions checked by zig.exe!)
  const zigImpl = `${zigBindings}
extern fn c_callback_mul(a: i32, b: i32) callconv(.c) i32;
extern fn llvm_vec3_add(a: Vec3, b: Vec3) callconv(.c) Vec3;
extern fn llvm_small_pair_flip(p: SmallPair) callconv(.c) SmallPair;

pub export fn zig_ext_and_bool(a: i8, b: u8, c: i16, d: u16, flag: u8, extra: i32, scale: f64) callconv(.c) i64 {
    const sum: i64 = @as(i64, a) + @as(i64, b) + @as(i64, c) + @as(i64, d) + @as(i64, extra);
    const mult: i64 = if (flag != 0) @intFromFloat(scale) else 1;
    return sum * mult;
}

pub export fn zig_small_pair_step(p: SmallPair, m: Mode) callconv(.c) SmallPair {
    const bump: i32 = if (m == .active) 10 else 1;
    return .{ .tag = p.tag + 1, .val = p.val + bump };
}

pub export fn zig_vec3_add(a: Vec3, b: Vec3) callconv(.c) Vec3 {
    // Mutate local copy to verify caller value-semantics isolation!
    var local = a;
    local.x += b.x;
    local.y += b.y;
    local.z += b.z;
    return local;
}

pub export fn zig_quat16_scale(q: Quat16, s: f32) callconv(.c) Quat16 {
    return .{ .x = q.x * s, .y = q.y * s, .z = q.z * s, .w = q.w * s };
}

pub export fn zig_transform32_step(t: Transform32, delta: f64, h: EntityHandle) callconv(.c) Transform32 {
    return .{
        .a = t.a + delta,
        .b = t.b - delta,
        .c = t.c + @as(i64, h.index) * 100 + @as(i64, h.generation),
        .flag = t.flag ^ 1,
    };
}

pub export fn zig_span_and_str_sum(rs: I32ReadSpan, sv: StringView, cb: IntBinaryFn) callconv(.c) i64 {
    var acc: i64 = 0;
    for (0..rs.len) |i| acc += rs.ptr[i];
    for (0..sv.len) |i| acc += sv.ptr[i];
    if (cb) |f| {
        acc += f(6, 7);
    }
    return acc;
}

pub export fn zig_union_eval(u: PayloadUnion) callconv(.c) i64 {
    if (u.tag == 1) return u.payload.as_i64 * 2;
    if (u.tag == 2) return @as(i64, u.payload.as_pair.tag) * 1000 + u.payload.as_pair.val;
    return -1;
}

// Zig -> C and Zig -> LLVM AOT reverse calls
pub export fn zig_call_c_and_llvm(v: Vec3, p: SmallPair) callconv(.c) i64 {
    const lv = llvm_vec3_add(v, .{ .x = 1.0, .y = 2.0, .z = 3.0 });
    const lp = llvm_small_pair_flip(p);
    const cm = c_callback_mul(lp.val, 3);
    return @as(i64, @intFromFloat(lv.x + lv.y + lv.z)) + @as(i64, cm) + @as(i64, lp.tag);
}
`;

  // LLVM IR AOT module adhering strictly to Win64 C ABI classification (`sret` in RCX + `by_ref_copy` for 12B Vec3, `i64` in RAX for 8B SmallPair)
  const llvmIr = `target datalayout = "${WINDOWS_X64_TARGET.llvmDataLayout}"
target triple = "${WINDOWS_X64_TARGET.triple}"

%struct.Vec3 = type { float, float, float }

; Win64 C ABI: 12-byte Vec3 returns via hidden sret ptr in RCX, and 12-byte params pass by_ref_copy ptr in RDX, R8
define void @llvm_vec3_add(ptr noalias sret(%struct.Vec3) align 4 %out, ptr nocapture readonly %a, ptr nocapture readonly %b) {
entry:
  %ax = load float, ptr %a, align 4
  %bx = load float, ptr %b, align 4
  %sx = fadd float %ax, %bx
  store float %sx, ptr %out, align 4

  %ayp = getelementptr inbounds %struct.Vec3, ptr %a, i64 0, i32 1
  %byp = getelementptr inbounds %struct.Vec3, ptr %b, i64 0, i32 1
  %oyp = getelementptr inbounds %struct.Vec3, ptr %out, i64 0, i32 1
  %ay = load float, ptr %ayp, align 4
  %by = load float, ptr %byp, align 4
  %sy = fadd float %ay, %by
  store float %sy, ptr %oyp, align 4

  %azp = getelementptr inbounds %struct.Vec3, ptr %a, i64 0, i32 2
  %bzp = getelementptr inbounds %struct.Vec3, ptr %b, i64 0, i32 2
  %ozp = getelementptr inbounds %struct.Vec3, ptr %out, i64 0, i32 2
  %az = load float, ptr %azp, align 4
  %bz = load float, ptr %bzp, align 4
  %sz = fadd float %az, %bz
  store float %sz, ptr %ozp, align 4
  ret void
}

; Win64 C ABI: 8-byte SmallPair { u8 tag @0, pad[3], i32 val @4 } passes in RCX as i64 and returns in RAX as i64!
define i64 @llvm_small_pair_flip(i64 %raw) {
entry:
  %tag8 = trunc i64 %raw to i8
  %tag2 = add i8 %tag8, 5
  %tag64 = zext i8 %tag2 to i64
  %hi = lshr i64 %raw, 32
  %val32 = trunc i64 %hi to i32
  %val2 = add i32 %val32, 100
  %val64 = zext i32 %val2 to i64
  %valShift = shl i64 %val64, 32
  %res = or i64 %tag64, %valShift
  ret i64 %res
}
`;

  const cDriver = `#include "generated_abi.h"
#include <stdio.h>
#include <string.h>

extern int64_t zig_call_c_and_llvm(Vec3 v, SmallPair p);

int32_t c_callback_mul(int32_t a, int32_t b) { return a * b; }
static int32_t c_cb_add(int32_t a, int32_t b) { return a + b; }

int main(void) {
  int32_t hs_ok = tsfg_abi_verify_handshake((const uint8_t *)TSFG_ABI_HASH, strlen(TSFG_ABI_HASH),
                                            (const uint8_t *)TSFG_TARGET_TRIPLE, strlen(TSFG_TARGET_TRIPLE));
  const char *bad_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  int32_t hs_bad_hash = tsfg_abi_verify_handshake((const uint8_t *)bad_hash, strlen(bad_hash),
                                                  (const uint8_t *)TSFG_TARGET_TRIPLE, strlen(TSFG_TARGET_TRIPLE));
  const char *bad_triple = "x86_64-unknown-linux-gnu";
  int32_t hs_bad_triple = tsfg_abi_verify_handshake((const uint8_t *)TSFG_ABI_HASH, strlen(TSFG_ABI_HASH),
                                                    (const uint8_t *)bad_triple, strlen(bad_triple));

  /* 1. Sign/zero extension + bool + 7-arg stack spill */
  int64_t ext_res = zig_ext_and_bool(-5, 250, -300, 40000, 1, 1000, 3.0);

  /* 2. SmallPair 8B by-value register + enum(u16) */
  SmallPair sp_in = { 7, 30 };
  SmallPair sp_out = zig_small_pair_step(sp_in, Mode_active);

  /* 3. 12B Vec3 by_ref_copy + sret + caller value-semantics isolation check */
  Vec3 va = { 1.5f, 2.5f, 3.5f };
  Vec3 vb = { 4.5f, 5.5f, 6.5f };
  Vec3 vs = zig_vec3_add(va, vb);
  int32_t va_unchanged = (va.x == 1.5f && va.y == 2.5f && va.z == 3.5f) ? 1 : 0;

  /* 4. 16B Quat16 by_ref_copy + sret + float in XMM2 */
  Quat16 q = { 1.0f, 2.0f, 3.0f, 4.0f };
  Quat16 qs = zig_quat16_scale(q, 2.5f);

  /* 5. 32B Transform32 + f64 + Handle<Entity> */
  Transform32 tr_in = { 10.0, 20.0, 500, 0 };
  EntityHandle eh = { 9, 4 };
  Transform32 tr_out = zig_transform32_step(tr_in, 2.5, eh);

  /* 6. ReadSpan + StringView + C fn_ptr */
  int32_t nums[3] = { 10, 20, 30 };
  I32ReadSpan rs = { nums, 3 };
  const uint8_t msg[2] = { 'A', 'B' }; /* 65 + 66 = 131 */
  StringView sv = { msg, 2 };
  int64_t span_res = zig_span_and_str_sum(rs, sv, c_cb_add);

  /* 7. Explicit tagged union */
  PayloadUnion u1; u1.tag = 1; u1.payload.as_i64 = 42;
  PayloadUnion u2; u2.tag = 2; u2.payload.as_pair = sp_out;
  int64_t u1_res = zig_union_eval(u1);
  int64_t u2_res = zig_union_eval(u2);

  /* 8. Bidirectional Zig -> LLVM AOT + Zig -> C callback */
  int64_t bidir = zig_call_c_and_llvm(va, sp_in);

  printf("{\\"hsOk\\":%d,\\"hsBadHash\\":%d,\\"hsBadTriple\\":%d,\\"ext\\":%lld,\\"spTag\\":%u,\\"spVal\\":%d,\\"vsSum\\":%d,\\"vaIso\\":%d,\\"qsW\\":%d,\\"trC\\":%lld,\\"trFlag\\":%u,\\"spanRes\\":%lld,\\"u1\\":%lld,\\"u2\\":%lld,\\"bidir\\":%lld}\\n",
         hs_ok, hs_bad_hash, hs_bad_triple,
         (long long)ext_res, (unsigned)sp_out.tag, sp_out.val,
         (int)(vs.x + vs.y + vs.z), va_unchanged, (int)(qs.w * 10.0f),
         (long long)tr_out.c, (unsigned)tr_out.flag,
         (long long)span_res, (long long)u1_res, (long long)u2_res, (long long)bidir);
  return 0;
}
`;

  const zigPath = path.join(probeDir, 'zig_impl.zig');
  const hPath = path.join(probeDir, 'generated_abi.h');
  const dtsPath = path.join(probeDir, 'generated_abi.d.ts');
  const llPath = path.join(probeDir, 'llvm_aot.ll');
  const cPath = path.join(probeDir, 'c_driver.c');
  const zigLib = path.join(probeDir, 'zig_impl.lib');
  const llObj = path.join(probeDir, 'llvm_aot.obj');
  const cObj = path.join(probeDir, 'c_driver.obj');
  const exePath = path.join(probeDir, 'r04_abi_probe.exe');

  await writeFile(zigPath, zigImpl, 'utf8');
  await writeFile(hPath, cHeader, 'utf8');
  await writeFile(dtsPath, tsDecls, 'utf8');
  await writeFile(llPath, llvmIr, 'utf8');
  await writeFile(cPath, cDriver, 'utf8');

  const bz = spawnSync(ZIG_EXE, [
    'build-lib', zigPath,
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${zigLib}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(bz.status, 0, `zig build-lib failed (comptime ABI assertions):\n${bz.stderr.toString('utf8')}`);

  const bl = spawnSync(CLANG_CL, ['/c', '/O2', '-x', 'ir', llPath, `/Fo${llObj}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(bl.status, 0, `clang-cl LLVM IR failed:\n${bl.stderr.toString('utf8')}`);

  const bc = spawnSync(CLANG_CL, [
    '/c', '/O2', '/MT', '/std:c11',
    `/I${probeDir}`, `/I${MSVC_INC}`, `/I${UCRT_INC}`, `/I${UM_INC}`, `/I${SHARED_INC}`,
    cPath, `/Fo${cObj}`,
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(bc.status, 0, `clang-cl C11 driver failed (_Static_asserts):\n${bc.stderr.toString('utf8')}`);

  const ld = spawnSync(LLD_LINK, [
    `/OUT:${exePath}`,
    `/LIBPATH:${MSVC_LIB}`, `/LIBPATH:${UCRT_LIB}`, `/LIBPATH:${UM_LIB}`,
    cObj, llObj, zigLib, BUILTINS_LIB,
    'libcmt.lib', 'libvcruntime.lib', 'libucrt.lib', 'kernel32.lib', 'ntdll.lib',
  ], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(ld.status, 0, `lld-link failed:\n${ld.stderr.toString('utf8')}`);

  const run = spawnSync(exePath, [], { windowsHide: true });
  assert.equal(run.status, 0, `ABI probe exe crashed: ${run.stderr.toString('utf8')}`);
  const actual = JSON.parse(run.stdout.toString('utf8').trim());

  // Independent semantic oracle:
  // ext = (-5 + 250 - 300 + 40000 + 1000) * 3 = 40945 * 3 = 122835
  // sp_out = { tag: 8, val: 40 }
  // vs = { 6.0, 8.0, 10.0 } -> sum = 24; va unchanged = 1
  // qs.w = 4.0 * 2.5 = 10.0 -> *10 = 100
  // tr_out.c = 500 + 9*100 + 4 = 1404; tr_out.flag = 1
  // spanRes = (10+20+30) + (65+66) + (6+7) = 60 + 131 + 13 = 204
  // u1 = 42*2 = 84; u2 = 8*1000 + 40 = 8040
  // bidir = lv(2.5+4.5+6.5=13.5 -> 13) + c_callback_mul(130, 3)=390 + lp.tag(12) = 415
  assert.deepEqual(actual, {
    bidir: 415,
    ext: 122835,
    hsBadHash: 0,
    hsBadTriple: 0,
    hsOk: 1,
    qsW: 100,
    spanRes: 204,
    spTag: 8,
    spVal: 40,
    trC: 1404,
    trFlag: 1,
    u1: 84,
    u2: 8040,
    vaIso: 1,
    vsSum: 24,
  });
});
