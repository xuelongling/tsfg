// SPDX-License-Identifier: MIT
// Shared R04 test helpers (non-test module so importing never registers extra subtests).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { WINDOWS_X64_TARGET } from '../../compiler/r04-identity.mjs';

export const ZIG_EXE = process.env.TSFG_LOCKED_ZIG ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\zig\\zig.exe';
export const CLANG_CL = process.env.TSFG_CLANG_CL ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\clang-cl.exe';
export const LLD_LINK = process.env.TSFG_LLD_LINK ?? 'E:\\tsfg-cache\\win-cache\\closures\\sha256\\a39365994497d56ea791866f5d30580f4793a15f4ba2eb2c7fd861aa3fc1dc85\\windows-x86_64-msvc\\llvm\\bin\\lld-link.exe';
export const BUILD_DIR = process.env.TSFG_R04_BUILD_DIR ?? 'E:\\tsfg-build\\r04';

export function buildFullR04AbiSpec() {
  return {
    callingConvention: 'win64_c',
    functions: [
      {
        name: 'ext_and_bool',
        params: [
          { name: 'a', type: 'i8' },
          { name: 'b', type: 'u8' },
          { name: 'c', type: 'i16' },
          { name: 'd', type: 'u16' },
          { name: 'flag', type: 'bool' },
          { name: 'extra', type: 'i32' },
          { name: 'scale', type: 'f64' },
        ],
        returnType: 'i64',
        symbol: 'zig_ext_and_bool',
      },
      {
        name: 'small_pair_step',
        params: [
          { name: 'p', type: 'SmallPair' },
          { name: 'm', type: 'Mode' },
        ],
        returnType: 'SmallPair',
        symbol: 'zig_small_pair_step',
      },
      {
        name: 'vec3_add',
        params: [
          { name: 'a', type: 'Vec3' },
          { name: 'b', type: 'Vec3' },
        ],
        returnType: 'Vec3',
        symbol: 'zig_vec3_add',
      },
      {
        name: 'quat16_scale',
        params: [
          { name: 'q', type: 'Quat16' },
          { name: 's', type: 'f32' },
        ],
        returnType: 'Quat16',
        symbol: 'zig_quat16_scale',
      },
      {
        name: 'transform32_step',
        params: [
          { name: 't', type: 'Transform32' },
          { name: 'delta', type: 'f64' },
          { name: 'h', type: 'EntityHandle' },
        ],
        returnType: 'Transform32',
        symbol: 'zig_transform32_step',
      },
      {
        name: 'span_and_str_sum',
        params: [
          { name: 'rs', type: 'I32ReadSpan' },
          { name: 'sv', type: 'StringView' },
          { name: 'cb', type: 'IntBinaryFn' },
        ],
        returnType: 'i64',
        symbol: 'zig_span_and_str_sum',
      },
      {
        name: 'union_eval',
        params: [{ name: 'u', type: 'PayloadUnion' }],
        returnType: 'i64',
        symbol: 'zig_union_eval',
      },
    ],
    target: WINDOWS_X64_TARGET,
    types: [
      { kind: 'enum', name: 'Dir', underlyingType: 'i8', variants: [{ name: 'neg', value: -1 }, { name: 'pos', value: 1 }] },
      { kind: 'enum', name: 'Mode', underlyingType: 'u16', variants: [{ name: 'idle', value: 0 }, { name: 'active', value: 1 }] },
      { kind: 'handle', name: 'EntityHandle', targetName: 'Entity' },
      { elementType: 'i32', kind: 'read_span', name: 'I32ReadSpan' },
      { elementType: 'i32', kind: 'span', name: 'I32Span' },
      { kind: 'string_view', name: 'StringView' },
      { kind: 'fn_ptr', name: 'IntBinaryFn', paramTypes: ['i32', 'i32'], returnType: 'i32' },
      {
        fields: [
          { name: 'tag', type: 'u8' },
          { name: 'val', type: 'i32' },
        ],
        kind: 'struct',
        name: 'SmallPair',
      },
      {
        fields: [
          { name: 'x', type: 'f32' },
          { name: 'y', type: 'f32' },
          { name: 'z', type: 'f32' },
        ],
        kind: 'struct',
        name: 'Vec3',
      },
      {
        fields: [
          { name: 'x', type: 'f32' },
          { name: 'y', type: 'f32' },
          { name: 'z', type: 'f32' },
          { name: 'w', type: 'f32' },
        ],
        kind: 'struct',
        name: 'Quat16',
      },
      {
        fields: [
          { name: 'a', type: 'f64' },
          { name: 'b', type: 'f64' },
          { name: 'c', type: 'i64' },
          { name: 'flag', type: 'u8' },
        ],
        kind: 'struct',
        name: 'Transform32',
      },
      {
        kind: 'tagged_union',
        name: 'PayloadUnion',
        tagType: 'u8',
        variants: [
          { name: 'as_i64', tagValue: 1, type: 'i64' },
          { name: 'as_pair', tagValue: 2, type: 'SmallPair' },
        ],
      },
    ],
  };
}

let validatorBuilt = null;
export async function ensureR04ValidatorExe() {
  if (validatorBuilt) return validatorBuilt;
  await mkdir(BUILD_DIR, { recursive: true });
  const exe = path.join(BUILD_DIR, 'tsfg-r04-validator.exe');
  const res = spawnSync(ZIG_EXE, [
    'build-exe', 'r04-validator-cli.zig',
    '-target', 'x86_64-windows-msvc', '-mcpu', 'x86_64_v2', '-O', 'ReleaseSafe', '-fno-lto',
    `-femit-bin=${exe}`,
  ], { cwd: path.resolve('runtime'), windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(res.status, 0, `zig build-exe r04-validator-cli failed:\n${res.stderr.toString('utf8')}`);
  validatorBuilt = exe;
  return exe;
}
