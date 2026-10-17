// SPDX-License-Identifier: MIT
// Independent complete component Box local-construction return/throw oracle; all Source values and HIR identities recomputed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url);
const sourcePath='/src/main.ts',conversionPath='/src/minimal-conversions-v5.d.ts',markerPath='/src/minimal-aggregates-v1.d.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const conversions="// SPDX-License-Identifier: MIT\ninterface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i8: unique symbol;\ndeclare const __tsfg_i16: unique symbol;\ndeclare const __tsfg_i32: unique symbol;\ndeclare const __tsfg_i64: unique symbol;\ndeclare const __tsfg_u8: unique symbol;\ndeclare const __tsfg_u16: unique symbol;\ndeclare const __tsfg_u32: unique symbol;\ndeclare const __tsfg_u64: unique symbol;\ndeclare const __tsfg_isize: unique symbol;\ndeclare const __tsfg_usize: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ntype i16 = number & { readonly [__tsfg_i16]: true };\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype i64 = number & { readonly [__tsfg_i64]: true };\ntype u8 = number & { readonly [__tsfg_u8]: true };\ntype u16 = number & { readonly [__tsfg_u16]: true };\ntype u32 = number & { readonly [__tsfg_u32]: true };\ntype u64 = number & { readonly [__tsfg_u64]: true };\ntype isize = number & { readonly [__tsfg_isize]: true };\ntype usize = number & { readonly [__tsfg_usize]: true };\ntype f64 = number;\ndeclare const __tsfg_f32: unique symbol;\ntype f32 = number & { readonly [__tsfg_f32]: true };\ndeclare function checked_i8_from_i8(value: i8): i8;\ndeclare function checked_i16_from_i8(value: i8): i16;\ndeclare function checked_i32_from_i8(value: i8): i32;\ndeclare function checked_i64_from_i8(value: i8): i64;\ndeclare function checked_u8_from_i8(value: i8): u8;\ndeclare function checked_u16_from_i8(value: i8): u16;\ndeclare function checked_u32_from_i8(value: i8): u32;\ndeclare function checked_u64_from_i8(value: i8): u64;\ndeclare function checked_isize_from_i8(value: i8): isize;\ndeclare function checked_usize_from_i8(value: i8): usize;\ndeclare function checked_f32_from_i8(value: i8): f32;\ndeclare function checked_f64_from_i8(value: i8): f64;\ndeclare function checked_i8_from_i16(value: i16): i8;\ndeclare function checked_i16_from_i16(value: i16): i16;\ndeclare function checked_i32_from_i16(value: i16): i32;\ndeclare function checked_i64_from_i16(value: i16): i64;\ndeclare function checked_u8_from_i16(value: i16): u8;\ndeclare function checked_u16_from_i16(value: i16): u16;\ndeclare function checked_u32_from_i16(value: i16): u32;\ndeclare function checked_u64_from_i16(value: i16): u64;\ndeclare function checked_isize_from_i16(value: i16): isize;\ndeclare function checked_usize_from_i16(value: i16): usize;\ndeclare function checked_f32_from_i16(value: i16): f32;\ndeclare function checked_f64_from_i16(value: i16): f64;\ndeclare function checked_i8_from_i32(value: i32): i8;\ndeclare function checked_i16_from_i32(value: i32): i16;\ndeclare function checked_i32_from_i32(value: i32): i32;\ndeclare function checked_i64_from_i32(value: i32): i64;\ndeclare function checked_u8_from_i32(value: i32): u8;\ndeclare function checked_u16_from_i32(value: i32): u16;\ndeclare function checked_u32_from_i32(value: i32): u32;\ndeclare function checked_u64_from_i32(value: i32): u64;\ndeclare function checked_isize_from_i32(value: i32): isize;\ndeclare function checked_usize_from_i32(value: i32): usize;\ndeclare function checked_f32_from_i32(value: i32): f32;\ndeclare function checked_f64_from_i32(value: i32): f64;\ndeclare function checked_i8_from_i64(value: i64): i8;\ndeclare function checked_i16_from_i64(value: i64): i16;\ndeclare function checked_i32_from_i64(value: i64): i32;\ndeclare function checked_i64_from_i64(value: i64): i64;\ndeclare function checked_u8_from_i64(value: i64): u8;\ndeclare function checked_u16_from_i64(value: i64): u16;\ndeclare function checked_u32_from_i64(value: i64): u32;\ndeclare function checked_u64_from_i64(value: i64): u64;\ndeclare function checked_isize_from_i64(value: i64): isize;\ndeclare function checked_usize_from_i64(value: i64): usize;\ndeclare function checked_f32_from_i64(value: i64): f32;\ndeclare function checked_f64_from_i64(value: i64): f64;\ndeclare function checked_i8_from_u8(value: u8): i8;\ndeclare function checked_i16_from_u8(value: u8): i16;\ndeclare function checked_i32_from_u8(value: u8): i32;\ndeclare function checked_i64_from_u8(value: u8): i64;\ndeclare function checked_u8_from_u8(value: u8): u8;\ndeclare function checked_u16_from_u8(value: u8): u16;\ndeclare function checked_u32_from_u8(value: u8): u32;\ndeclare function checked_u64_from_u8(value: u8): u64;\ndeclare function checked_isize_from_u8(value: u8): isize;\ndeclare function checked_usize_from_u8(value: u8): usize;\ndeclare function checked_f32_from_u8(value: u8): f32;\ndeclare function checked_f64_from_u8(value: u8): f64;\ndeclare function checked_i8_from_u16(value: u16): i8;\ndeclare function checked_i16_from_u16(value: u16): i16;\ndeclare function checked_i32_from_u16(value: u16): i32;\ndeclare function checked_i64_from_u16(value: u16): i64;\ndeclare function checked_u8_from_u16(value: u16): u8;\ndeclare function checked_u16_from_u16(value: u16): u16;\ndeclare function checked_u32_from_u16(value: u16): u32;\ndeclare function checked_u64_from_u16(value: u16): u64;\ndeclare function checked_isize_from_u16(value: u16): isize;\ndeclare function checked_usize_from_u16(value: u16): usize;\ndeclare function checked_f32_from_u16(value: u16): f32;\ndeclare function checked_f64_from_u16(value: u16): f64;\ndeclare function checked_i8_from_u32(value: u32): i8;\ndeclare function checked_i16_from_u32(value: u32): i16;\ndeclare function checked_i32_from_u32(value: u32): i32;\ndeclare function checked_i64_from_u32(value: u32): i64;\ndeclare function checked_u8_from_u32(value: u32): u8;\ndeclare function checked_u16_from_u32(value: u32): u16;\ndeclare function checked_u32_from_u32(value: u32): u32;\ndeclare function checked_u64_from_u32(value: u32): u64;\ndeclare function checked_isize_from_u32(value: u32): isize;\ndeclare function checked_usize_from_u32(value: u32): usize;\ndeclare function checked_f32_from_u32(value: u32): f32;\ndeclare function checked_f64_from_u32(value: u32): f64;\ndeclare function checked_i8_from_u64(value: u64): i8;\ndeclare function checked_i16_from_u64(value: u64): i16;\ndeclare function checked_i32_from_u64(value: u64): i32;\ndeclare function checked_i64_from_u64(value: u64): i64;\ndeclare function checked_u8_from_u64(value: u64): u8;\ndeclare function checked_u16_from_u64(value: u64): u16;\ndeclare function checked_u32_from_u64(value: u64): u32;\ndeclare function checked_u64_from_u64(value: u64): u64;\ndeclare function checked_isize_from_u64(value: u64): isize;\ndeclare function checked_usize_from_u64(value: u64): usize;\ndeclare function checked_f32_from_u64(value: u64): f32;\ndeclare function checked_f64_from_u64(value: u64): f64;\ndeclare function checked_i8_from_isize(value: isize): i8;\ndeclare function checked_i16_from_isize(value: isize): i16;\ndeclare function checked_i32_from_isize(value: isize): i32;\ndeclare function checked_i64_from_isize(value: isize): i64;\ndeclare function checked_u8_from_isize(value: isize): u8;\ndeclare function checked_u16_from_isize(value: isize): u16;\ndeclare function checked_u32_from_isize(value: isize): u32;\ndeclare function checked_u64_from_isize(value: isize): u64;\ndeclare function checked_isize_from_isize(value: isize): isize;\ndeclare function checked_usize_from_isize(value: isize): usize;\ndeclare function checked_f32_from_isize(value: isize): f32;\ndeclare function checked_f64_from_isize(value: isize): f64;\ndeclare function checked_i8_from_usize(value: usize): i8;\ndeclare function checked_i16_from_usize(value: usize): i16;\ndeclare function checked_i32_from_usize(value: usize): i32;\ndeclare function checked_i64_from_usize(value: usize): i64;\ndeclare function checked_u8_from_usize(value: usize): u8;\ndeclare function checked_u16_from_usize(value: usize): u16;\ndeclare function checked_u32_from_usize(value: usize): u32;\ndeclare function checked_u64_from_usize(value: usize): u64;\ndeclare function checked_isize_from_usize(value: usize): isize;\ndeclare function checked_usize_from_usize(value: usize): usize;\ndeclare function checked_f32_from_usize(value: usize): f32;\ndeclare function checked_f64_from_usize(value: usize): f64;\ndeclare function checked_i8_from_f32(value: f32): i8;\ndeclare function checked_i16_from_f32(value: f32): i16;\ndeclare function checked_i32_from_f32(value: f32): i32;\ndeclare function checked_i64_from_f32(value: f32): i64;\ndeclare function checked_u8_from_f32(value: f32): u8;\ndeclare function checked_u16_from_f32(value: f32): u16;\ndeclare function checked_u32_from_f32(value: f32): u32;\ndeclare function checked_u64_from_f32(value: f32): u64;\ndeclare function checked_isize_from_f32(value: f32): isize;\ndeclare function checked_usize_from_f32(value: f32): usize;\ndeclare function checked_f32_from_f32(value: f32): f32;\ndeclare function checked_f64_from_f32(value: f32): f64;\ndeclare function checked_i8_from_f64(value: f64): i8;\ndeclare function checked_i16_from_f64(value: f64): i16;\ndeclare function checked_i32_from_f64(value: f64): i32;\ndeclare function checked_i64_from_f64(value: f64): i64;\ndeclare function checked_u8_from_f64(value: f64): u8;\ndeclare function checked_u16_from_f64(value: f64): u16;\ndeclare function checked_u32_from_f64(value: f64): u32;\ndeclare function checked_u64_from_f64(value: f64): u64;\ndeclare function checked_isize_from_f64(value: f64): isize;\ndeclare function checked_usize_from_f64(value: f64): usize;\ndeclare function checked_f32_from_f64(value: f64): f32;\ndeclare function checked_f64_from_f64(value: f64): f64;\ndeclare function wrap_i8_from_i8(value: i8): i8;\ndeclare function wrap_i16_from_i8(value: i8): i16;\ndeclare function wrap_i32_from_i8(value: i8): i32;\ndeclare function wrap_i64_from_i8(value: i8): i64;\ndeclare function wrap_u8_from_i8(value: i8): u8;\ndeclare function wrap_u16_from_i8(value: i8): u16;\ndeclare function wrap_u32_from_i8(value: i8): u32;\ndeclare function wrap_u64_from_i8(value: i8): u64;\ndeclare function wrap_isize_from_i8(value: i8): isize;\ndeclare function wrap_usize_from_i8(value: i8): usize;\ndeclare function wrap_i8_from_i16(value: i16): i8;\ndeclare function wrap_i16_from_i16(value: i16): i16;\ndeclare function wrap_i32_from_i16(value: i16): i32;\ndeclare function wrap_i64_from_i16(value: i16): i64;\ndeclare function wrap_u8_from_i16(value: i16): u8;\ndeclare function wrap_u16_from_i16(value: i16): u16;\ndeclare function wrap_u32_from_i16(value: i16): u32;\ndeclare function wrap_u64_from_i16(value: i16): u64;\ndeclare function wrap_isize_from_i16(value: i16): isize;\ndeclare function wrap_usize_from_i16(value: i16): usize;\ndeclare function wrap_i8_from_i32(value: i32): i8;\ndeclare function wrap_i16_from_i32(value: i32): i16;\ndeclare function wrap_i32_from_i32(value: i32): i32;\ndeclare function wrap_i64_from_i32(value: i32): i64;\ndeclare function wrap_u8_from_i32(value: i32): u8;\ndeclare function wrap_u16_from_i32(value: i32): u16;\ndeclare function wrap_u32_from_i32(value: i32): u32;\ndeclare function wrap_u64_from_i32(value: i32): u64;\ndeclare function wrap_isize_from_i32(value: i32): isize;\ndeclare function wrap_usize_from_i32(value: i32): usize;\ndeclare function wrap_i8_from_i64(value: i64): i8;\ndeclare function wrap_i16_from_i64(value: i64): i16;\ndeclare function wrap_i32_from_i64(value: i64): i32;\ndeclare function wrap_i64_from_i64(value: i64): i64;\ndeclare function wrap_u8_from_i64(value: i64): u8;\ndeclare function wrap_u16_from_i64(value: i64): u16;\ndeclare function wrap_u32_from_i64(value: i64): u32;\ndeclare function wrap_u64_from_i64(value: i64): u64;\ndeclare function wrap_isize_from_i64(value: i64): isize;\ndeclare function wrap_usize_from_i64(value: i64): usize;\ndeclare function wrap_i8_from_u8(value: u8): i8;\ndeclare function wrap_i16_from_u8(value: u8): i16;\ndeclare function wrap_i32_from_u8(value: u8): i32;\ndeclare function wrap_i64_from_u8(value: u8): i64;\ndeclare function wrap_u8_from_u8(value: u8): u8;\ndeclare function wrap_u16_from_u8(value: u8): u16;\ndeclare function wrap_u32_from_u8(value: u8): u32;\ndeclare function wrap_u64_from_u8(value: u8): u64;\ndeclare function wrap_isize_from_u8(value: u8): isize;\ndeclare function wrap_usize_from_u8(value: u8): usize;\ndeclare function wrap_i8_from_u16(value: u16): i8;\ndeclare function wrap_i16_from_u16(value: u16): i16;\ndeclare function wrap_i32_from_u16(value: u16): i32;\ndeclare function wrap_i64_from_u16(value: u16): i64;\ndeclare function wrap_u8_from_u16(value: u16): u8;\ndeclare function wrap_u16_from_u16(value: u16): u16;\ndeclare function wrap_u32_from_u16(value: u16): u32;\ndeclare function wrap_u64_from_u16(value: u16): u64;\ndeclare function wrap_isize_from_u16(value: u16): isize;\ndeclare function wrap_usize_from_u16(value: u16): usize;\ndeclare function wrap_i8_from_u32(value: u32): i8;\ndeclare function wrap_i16_from_u32(value: u32): i16;\ndeclare function wrap_i32_from_u32(value: u32): i32;\ndeclare function wrap_i64_from_u32(value: u32): i64;\ndeclare function wrap_u8_from_u32(value: u32): u8;\ndeclare function wrap_u16_from_u32(value: u32): u16;\ndeclare function wrap_u32_from_u32(value: u32): u32;\ndeclare function wrap_u64_from_u32(value: u32): u64;\ndeclare function wrap_isize_from_u32(value: u32): isize;\ndeclare function wrap_usize_from_u32(value: u32): usize;\ndeclare function wrap_i8_from_u64(value: u64): i8;\ndeclare function wrap_i16_from_u64(value: u64): i16;\ndeclare function wrap_i32_from_u64(value: u64): i32;\ndeclare function wrap_i64_from_u64(value: u64): i64;\ndeclare function wrap_u8_from_u64(value: u64): u8;\ndeclare function wrap_u16_from_u64(value: u64): u16;\ndeclare function wrap_u32_from_u64(value: u64): u32;\ndeclare function wrap_u64_from_u64(value: u64): u64;\ndeclare function wrap_isize_from_u64(value: u64): isize;\ndeclare function wrap_usize_from_u64(value: u64): usize;\ndeclare function wrap_i8_from_isize(value: isize): i8;\ndeclare function wrap_i16_from_isize(value: isize): i16;\ndeclare function wrap_i32_from_isize(value: isize): i32;\ndeclare function wrap_i64_from_isize(value: isize): i64;\ndeclare function wrap_u8_from_isize(value: isize): u8;\ndeclare function wrap_u16_from_isize(value: isize): u16;\ndeclare function wrap_u32_from_isize(value: isize): u32;\ndeclare function wrap_u64_from_isize(value: isize): u64;\ndeclare function wrap_isize_from_isize(value: isize): isize;\ndeclare function wrap_usize_from_isize(value: isize): usize;\ndeclare function wrap_i8_from_usize(value: usize): i8;\ndeclare function wrap_i16_from_usize(value: usize): i16;\ndeclare function wrap_i32_from_usize(value: usize): i32;\ndeclare function wrap_i64_from_usize(value: usize): i64;\ndeclare function wrap_u8_from_usize(value: usize): u8;\ndeclare function wrap_u16_from_usize(value: usize): u16;\ndeclare function wrap_u32_from_usize(value: usize): u32;\ndeclare function wrap_u64_from_usize(value: usize): u64;\ndeclare function wrap_isize_from_usize(value: usize): isize;\ndeclare function wrap_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_i8_from_i8(value: i8): i8;\ndeclare function reinterpret_u8_from_i8(value: i8): u8;\ndeclare function reinterpret_i16_from_i16(value: i16): i16;\ndeclare function reinterpret_u16_from_i16(value: i16): u16;\ndeclare function reinterpret_i32_from_i32(value: i32): i32;\ndeclare function reinterpret_u32_from_i32(value: i32): u32;\ndeclare function reinterpret_f32_from_i32(value: i32): f32;\ndeclare function reinterpret_i64_from_i64(value: i64): i64;\ndeclare function reinterpret_u64_from_i64(value: i64): u64;\ndeclare function reinterpret_isize_from_i64(value: i64): isize;\ndeclare function reinterpret_usize_from_i64(value: i64): usize;\ndeclare function reinterpret_f64_from_i64(value: i64): f64;\ndeclare function reinterpret_i8_from_u8(value: u8): i8;\ndeclare function reinterpret_u8_from_u8(value: u8): u8;\ndeclare function reinterpret_i16_from_u16(value: u16): i16;\ndeclare function reinterpret_u16_from_u16(value: u16): u16;\ndeclare function reinterpret_i32_from_u32(value: u32): i32;\ndeclare function reinterpret_u32_from_u32(value: u32): u32;\ndeclare function reinterpret_f32_from_u32(value: u32): f32;\ndeclare function reinterpret_i64_from_u64(value: u64): i64;\ndeclare function reinterpret_u64_from_u64(value: u64): u64;\ndeclare function reinterpret_isize_from_u64(value: u64): isize;\ndeclare function reinterpret_usize_from_u64(value: u64): usize;\ndeclare function reinterpret_f64_from_u64(value: u64): f64;\ndeclare function reinterpret_i64_from_isize(value: isize): i64;\ndeclare function reinterpret_u64_from_isize(value: isize): u64;\ndeclare function reinterpret_isize_from_isize(value: isize): isize;\ndeclare function reinterpret_usize_from_isize(value: isize): usize;\ndeclare function reinterpret_f64_from_isize(value: isize): f64;\ndeclare function reinterpret_i64_from_usize(value: usize): i64;\ndeclare function reinterpret_u64_from_usize(value: usize): u64;\ndeclare function reinterpret_isize_from_usize(value: usize): isize;\ndeclare function reinterpret_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_f64_from_usize(value: usize): f64;\ndeclare function reinterpret_i32_from_f32(value: f32): i32;\ndeclare function reinterpret_u32_from_f32(value: f32): u32;\ndeclare function reinterpret_f32_from_f32(value: f32): f32;\ndeclare function reinterpret_i64_from_f64(value: f64): i64;\ndeclare function reinterpret_u64_from_f64(value: f64): u64;\ndeclare function reinterpret_isize_from_f64(value: f64): isize;\ndeclare function reinterpret_usize_from_f64(value: f64): usize;\ndeclare function reinterpret_f64_from_f64(value: f64): f64;\n";
const markers="// SPDX-License-Identifier: MIT\ninterface ClassDecoratorContext<C> {\n  readonly kind: \"class\";\n  readonly name: string | undefined;\n  addInitializer(initializer: (this: C) => void): void;\n}\ndeclare function tsfgValue<C>(target: C, context: ClassDecoratorContext<C>): void;\ndeclare function tsfgComponent<C>(target: C, context: ClassDecoratorContext<C>): void;\n";
const specs=[{"id":"24","throwing":false,"source":"// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(value: i32): i32 { const payload: Box = new Box(); return value; }","end":124,"statementEnd":122,"readEnd":121},{"id":"25","throwing":true,"source":"// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(value: i32): i32 { const payload: Box = new Box(); throw payload; }","end":125,"statementEnd":123,"readEnd":122}];
const origins={"24":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:889f94b850e22b5ea724d55757b4711864b946b8e86059feefd1a1d6849bfdb2","responseSha256":"sha256:c80590674eade568a2b2f3ca97854dad1277eeabeab70ceebe748e1e9d56a30f","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"25":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:9e7dc54ed845a1391ddf0795a2e85fa39d32604dd6ecdd5d804b1177292840bc","responseSha256":"sha256:31d467a6242403aab30169e786b1c219daada5626c2be95684a06a2d64e1a202","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"24/request.json":"sha256:889f94b850e22b5ea724d55757b4711864b946b8e86059feefd1a1d6849bfdb2","24/response.json":"sha256:c80590674eade568a2b2f3ca97854dad1277eeabeab70ceebe748e1e9d56a30f","24/origin.json":"sha256:8152599f949c756231d7807793cb0574258d7a623faef9921f81cc578d1539ef","25/request.json":"sha256:9e7dc54ed845a1391ddf0795a2e85fa39d32604dd6ecdd5d804b1177292840bc","25/response.json":"sha256:31d467a6242403aab30169e786b1c219daada5626c2be95684a06a2d64e1a202","25/origin.json":"sha256:96ae51e04d978fbd54397db47041e188d74c58c3faba59d58df66bc11883e83b"};
const identityPins={"24":{"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","aggregate":"sha256:5fe6b9ef60202e2d32fdea9404b29f911156d1942b73cadd805bd5ddf4141bc1","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","ctorType":"sha256:aa24140d8dd18c677620d035c48dca8f9f3c20c4362ff3515c67f6dbae39c369","ctorSignature":"sha256:1d02c79d81de8de560d5ff80be1cf6df0078b3f28274d29f302370f5ecb3e082","module":"sha256:2178d05fee623931495ed613265e52b871a05097358eb004f1b3e33138e5ee3d","function":"sha256:d6362b9957d3ae974511e289be1175ad2fd9ad962b4ca19f06ce14b183e94919","moduleScope":"sha256:29349959f6a79f14e687024072ad55f9f97d682e285636088bb5b8c80edb254a","scope":"sha256:e70773d25d751600ace8afe9af12c45b4532d0d232076f8f9115351b4bca5f72","parameter":"sha256:c5be316d56de434bebe556f9cd9ea313874bdaa0244553539c6b2062b3eddd88","payload":"sha256:8440ccb0ec26fd08e2e0e4cc585bb86b2ccc41fb83a4f0f3c6bb1192c5877246","constructor":"sha256:5fa1ea8a6e356d92729c75c51e146ce3e040052dc81fbf4605d57e078d2477de"},"25":{"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","aggregate":"sha256:916e5b7bd9f1b806d99f1d733a9490ae0d3536e0ff4652029436c5212513fde9","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","ctorType":"sha256:6b3650ecd919800c8b821349a7e052a07a830e60889cecd62b7670637985b359","ctorSignature":"sha256:3769bcbf6f816d9142d90146774492bcd24b4c50187df4e5f4d8973fb0e6b19e","module":"sha256:6cdfbe977e5b09bd9df6c135520c63e9c11ddffb2ad2d004d8ff18d71ca52644","function":"sha256:cddacc8203ed06df8f8e89bf8a18119b49ad2f7159ce70c8def6950915e63233","moduleScope":"sha256:c08b0738cbb841002dd890eab428b5fa0c508c33435fca20d5486f8a43d9fa24","scope":"sha256:1819e1f15a01517de7b8c81957bd10c0aae2112f91fe0940e1591611423380fc","parameter":"sha256:41d2ae4a6e0d6bcf32fc489337629a0992e76b2b1c6d6f306f0358e97427cc9b","payload":"sha256:33a7877970228aff86815f80f7c75b8b499ad552e5498aca5d1e53ae1461e862","constructor":"sha256:474c1ac8ab889b257b7c8d1e757ddaf8d628bf3a081f2fdd738aa44e5be920fe"}};
const expectedHirPins={"24":{"bytes":54464,"sha256":"sha256:45b3cd836a85969703802e76b569ff3873c976fb803db80376ca606dd96e875d"},"25":{"bytes":54463,"sha256":"sha256:0cdb71601c540813f572708254a6cb7f3793773dd3de3b19bd437996fac36357"}};
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value)),range=(start,end)=>({start,end});
/** @param {any} value @returns {string} */
function jcs(value) {
  if(Array.isArray(value))return '['+value.map(jcs).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+jcs(value[k])).join(',')+'}';
  if(typeof value==='string')assert.ok(value.isWellFormed());
  if(typeof value==='number')assert.ok(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0));
  return JSON.stringify(value)??assert.fail('non-JSON oracle');
}
const entity=(kind,record)=>hash('tsfg.exception-hir-candidate.'+kind+'.v1\0'+schema+'\0'+jcs(record));
const i32=hash('tsfg.type\0i32');
const nominalKey=()=>({sourcePath,declarationPath:['Box'],category:'component'});
const parameterPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(58,68),annotation:range(65,68)});
function markerOrigin() {
  const digest=hash(markers);
  return {contextArity:1,contextName:'ClassDecoratorContext',declarationPath:markerPath,declarationRange:range(273,359),
    declarationSha256:digest,entryId:hash('tsfg.marker\0minimal-aggregates-v1\0component\0'+digest),
    mode:'standard',range:range(7,21),version:'minimal-aggregates-v1'};
}
/** @param {any} spec */
function sourceFacts(spec) {
  const parameter={id:'s3',kind:'parameter',name:'value',type:'i32',writable:true,range:range(58,63),presence:parameterPresence()};
  const payload={id:'s4',kind:'local',name:'payload',type:'a1',writable:false,range:range(82,90)};
  const ctor={id:'c1',kind:'implicitDefault',classRef:'a1',signatureDeclaration:null,implementation:null,parameters:[],
    signature:{parameters:[],returnType:'a1'},resultType:'a1',body:[],parameterInitializers:[],range:range(7,34),bodyRange:null};
  const aggregate={id:'a1',name:'Box',symbol:'s1',category:'component',nominalKey:nominalKey(),markerOrigin:markerOrigin(),
    instanceType:'a1',constructorType:'constructor:a1',fields:[],constructors:[ctor],memberCoverage:[],
    range:range(7,34),bodyRange:range(32,34),noInheritance:true};
  const construct={kind:'construct',type:'a1',target:'c1',arguments:[],signature:{parameters:[],returnType:'a1'},range:range(98,107)};
  const expression={kind:'reference',type:spec.throwing?'a1':'i32',symbol:spec.throwing?'s4':'s3',range:range(115,spec.readEnd)};
  return {status:'ok',inputs:[sourcePath,markerPath,conversionPath],symbols:[
    {id:'s1',kind:'class',name:'Box',type:'a1',writable:false,range:range(27,31)},
    {id:'s2',kind:'function',name:'entry',type:'i32',writable:false,range:range(51,57)},copy(parameter),copy(payload)],
    functions:[{name:'entry',symbol:'s2',parameters:[copy(parameter)],returnType:'i32',parameterInitializers:[null],range:range(34,spec.end),body:[
      {kind:'variable',symbol:copy(payload),initializer:construct,range:range(82,107)},
      {kind:spec.throwing?'throw':'return',expression,range:range(108,spec.statementEnd)}]}],
    aggregateFacts:{profile:'minimal-aggregates-v1',declarations:[aggregate],sourceCoverage:[
      {kind:'class',name:'Box',symbol:'s1',range:range(7,34),bodyRange:range(32,34)},
      {kind:'function',name:'entry',symbol:'s2',range:range(34,spec.end),bodyRange:range(75,spec.end)}]}};
}
/** @param {any} spec */
function transport(spec) {
  const input={sourceRoot:'/src',rootFile:sourcePath,files:[{path:sourcePath,content:spec.source},
    {path:conversionPath,content:conversions},{path:markerPath,content:markers}],config:{allowJs:false,decoratorMode:'standard',noEmit:true,strict:true},
    declarations:{version:'minimal-conversions-v5',paths:[conversionPath,markerPath],markerProfile:{contextArity:1,contextName:'ClassDecoratorContext',
      entries:[{category:'value',name:'tsfgValue'},{category:'component',name:'tsfgComponent'}],mode:'standard',path:markerPath,
      sha256:hash(markers),version:'minimal-aggregates-v1'}},target:copy(target)};
  const identityInput=copy(input);identityInput.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const inputIdentity=hash(jcs(identityInput)),facts=sourceFacts(spec);
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s2',sourcePath,range:range(34,spec.end),definition:range(51,57)}]}];
  const payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:hash(file.content),
    byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})),facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload};
  const responseText=jcs(response),sourceOrigin=copy(origins[spec.id]);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),sourceOrigin,inputIdentity,identityInput,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),
    facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} spec @param {any} snapshot @returns {any} */
function manualHir(spec,snapshot) {
  const source={path:sourcePath,digest:hash(spec.source)},aggregate=entity('type',{kind:'aggregate',source,category:'component',declarationPath:['Box']});
  const fnSignature={parameters:[i32],returnType:i32},signatureHash=entity('signature',fnSignature),callable=entity('type',{kind:'callable',...fnSignature});
  const ctorSignature={parameters:[],returnType:aggregate},ctorSignatureHash=entity('signature',ctorSignature),ctorType=entity('type',{kind:'callable',...ctorSignature});
  const moduleId=entity('module',{source,external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(34,spec.end)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]}),scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const parameter=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const payload=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'local',index:0});
  const constructorId=entity('constructor',{owner:aggregate,ordinal:0,signatureHash:ctorSignatureHash});
  const ctor={kind:'implicitDefault',id:constructorId,owner:aggregate,ordinal:0,type:ctorType,signatureHash:ctorSignatureHash,
    signatureDeclaration:null,implementation:null,parameters:[],parameterInitializers:[],body:[],range:range(7,34),bodyRange:null};
  const aggregateType={kind:'aggregate',id:aggregate,category:'component',name:'Box',sourcePath,nameRange:range(27,31),range:range(7,34),bodyRange:range(32,34),
    nominalKey:nominalKey(),markerOrigin:markerOrigin(),noInheritance:true,fields:[],constructors:[ctor],memberCoverage:[]};
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},aggregateType,
    {kind:'callable',id:callable,...fnSignature},{kind:'callable',id:ctorType,...ctorSignature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const construct={kind:'construct',type:aggregate,range:range(98,107),constructorId,arguments:[],
    signature:{ownerKind:'constructor',owner:constructorId,type:ctorType,presence:null,returnPresence:null}};
  const terminal={kind:spec.throwing?'throw':'return',range:range(108,spec.statementEnd),value:{kind:'bindingRead',type:spec.throwing?aggregate:i32,
    binding:spec.throwing?payload:parameter,range:range(115,spec.readEnd),presenceFlow:null}};
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),types,functions:[
      {id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(51,57),range:range(34,spec.end),type:callable,signatureHash,
        lexicalParent:null,declaringScope:moduleScope,parameters:[parameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(34,spec.end),bindings:[
          {id:parameter,name:'value',role:'parameter',type:i32,writable:true,range:range(58,63),presence:parameterPresence()},
          {id:payload,name:'payload',role:'local',type:aggregate,writable:false,range:range(82,90),presence:null}],body:[
            {kind:'local',range:range(82,107),binding:payload,initializer:construct},terminal]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[aggregate],imports:[],globals:[],initialization:null,closure:null,
      coverage:[{kind:'aggregate',name:'Box',target:aggregate,range:range(7,34),bodyRange:range(32,34)},
        {kind:'function',name:'entry',target:functionId,range:range(34,spec.end),bodyRange:range(75,spec.end)}]}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,range:range(34,spec.end),definition:range(51,57)}]}]};
}
// Test-only structural helpers avoid executable imports from earlier test files.
/** @param {any} value @param {Set<object>} [seen] */
function frozen(value,seen=new Set()) {
  if(!value||typeof value!=='object')return;
  assert.ok(!seen.has(value));seen.add(value);assert.ok(Object.isFrozen(value));
  assert.ok(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
  for(const child of Object.values(value))frozen(child,seen);seen.delete(value);
}
/** @param {any} value @param {Set<object>} [seen] @returns {Set<object>} */
function objects(value,seen=new Set()) {
  if(!value||typeof value!=='object'||seen.has(value))return seen;
  seen.add(value);for(const child of Object.values(value))objects(child,seen);return seen;
}
/** @param {any} result @param {any} caller */
function noAliases(result,caller) {
  const found=objects(caller);for(const item of objects(result))assert.ok(!found.has(item));
}
/** @param {any} error */
function rejected(error) {
  assert.match(error.code,/^r03-exception-hir-/);assert.equal(error.ruleId,'r01-input-boundary');
  assert.equal(error.phase,'hir');assert.ok(error instanceof TypeError);return true;
}
/** @param {any} h */
const aggregateOf=h=>h.types.find(type=>type.kind==='aggregate');
test('actual component Box local construction retains complete return and throw HIR',async t=>{
  for(const spec of specs)await t.test(spec.id+(spec.throwing?'-throw-local':'-return-parameter'),async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>packetPins[spec.id+'/'+name]));assert.equal(spec.source.length,spec.end);
      assert.equal(Buffer.byteLength(spec.source),spec.end+2);assert.equal(conversions.length,17464);assert.equal(markers.length,360);
      assert.equal(hash(conversions),'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86');
      assert.equal(hash(markers),'sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9');
      assert.equal(spec.source.slice(82,90),' payload');assert.equal(spec.source.slice(98,107),'new Box()');
      assert.equal(spec.source.slice(115,spec.readEnd),spec.throwing?'payload':' value');
      const expected=transport(spec),origin=origins[spec.id];
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'complete original input from independent literals');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'complete actual packet from manual Source facts and exports');
      assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualNominalLocalConstructorTerminalAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),fn=expected.functions[0],agg=aggregateOf(expected),ctor=agg.constructors[0];
      const expectedText=jcs(expected)+'\n';assert.equal(Buffer.byteLength(expectedText),expectedHirPins[spec.id].bytes);
      assert.equal(hash(expectedText),expectedHirPins[spec.id].sha256);
      assert.deepEqual({i32,aggregate:agg.id,callable:fn.type,signature:fn.signatureHash,ctorType:ctor.type,ctorSignature:ctor.signatureHash,
        module:fn.module,function:fn.id,moduleScope:fn.declaringScope,scope:fn.body.scope,parameter:fn.parameters[0],
        payload:fn.body.bindings[1].id,constructor:ctor.id},identityPins[spec.id]);
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual component Box declaration, unused-or-thrown local, ctor, four types, coverage and exports');
      assert.equal(result.hir.types.length,4);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);frozen(verified);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.functions[0].body.bindings[1].writable=true;
      caller.sources[0].content='caller mutation';assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
      assert.deepEqual(buildHir(copy(snapshot)).hir,expected);assert.equal(printHir(readHir(Buffer.from(text))),text);
      assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for(const change of [
        h=>{h.functions[0].body.bindings[1].type=i32;},
        h=>{h.functions[0].body.bindings[1].writable=true;},
        h=>{h.functions[0].body.bindings.reverse();},
        h=>{h.functions[0].body.body[0].binding=h.functions[0].parameters[0];},
        h=>{h.functions[0].body.body[0].initializer.constructorId=h.functions[0].id;},
        h=>{h.functions[0].body.body[0].initializer.signature.owner=h.functions[0].id;},
        h=>{h.functions[0].body.body[0].initializer.signature.type=h.functions[0].type;},
        h=>{h.functions[0].body.body[0].initializer.signature.presence=[];},
        h=>{delete h.functions[0].body.body[0].initializer.arguments;},
        h=>{h.functions[0].body.body[1].value.binding=spec.throwing?h.functions[0].parameters[0]:h.functions[0].body.bindings[1].id;},
        h=>{h.functions[0].body.body[1].value.type=spec.throwing?i32:aggregateOf(h).id;},
        h=>{h.functions[0].body.body.reverse();},
        h=>{h.modules[0].coverage[0].target=h.functions[0].id;},
        h=>{h.types=h.types.filter(type=>type.kind!=='aggregate');},
        h=>{const type=aggregateOf(h).constructors[0].type;h.types=h.types.filter(item=>item.id!==type);},
        h=>{aggregateOf(h).nominalKey.category='value';},
        h=>{aggregateOf(h).markerOrigin.entryId='sha256:a1583573a445e7f05794f949016d7472e065d22297320edc9d0057682efd22a5';},
        h=>{h.functions[0].body.bindings[0].presence=null;},
        h=>{h.functions[0].parameterInitializers=null;},
        h=>{aggregateOf(h).constructors[0].owner=h.functions[0].id;},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
