// SPDX-License-Identifier: MIT
// Independent complete Pair local-construction return/throw oracle; no implementation-derived HIR.
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
const specs=[{"id":"20","throwing":false,"source":"// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { const payload: Pair = new Pair(); return value; }","end":123,"statementEnd":121,"readEnd":120},{"id":"21","throwing":true,"source":"// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { const payload: Pair = new Pair(); throw payload; }","end":124,"statementEnd":122,"readEnd":121}];
const origins={"20":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:dc55d4297f1719bba90b4d64168e20dec1be9ceea66420025b581a95c2c125c0","responseSha256":"sha256:e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"21":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:862e3336e1e4317fd079141f720304492e9007305f4f94e12133e5278423d37b","responseSha256":"sha256:c95dfb5ebb8133be27e9ede943161a64d26415693f902501bcc2d0d9e088b944","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"20/request.json":"sha256:dc55d4297f1719bba90b4d64168e20dec1be9ceea66420025b581a95c2c125c0","20/origin.json":"sha256:566b1ca12a570349498e1b1b94eaedde614f01e2ed9ef5f90f38b18103dbb9c7","20/response.json":"sha256:e923b55a1aac18ef460081f57eebb8328f1196cbab37196610b9d85ad7f04778","21/request.json":"sha256:862e3336e1e4317fd079141f720304492e9007305f4f94e12133e5278423d37b","21/origin.json":"sha256:012f31f4460bab4a2f24450edb660c7c1f16cfc72317b1e38b63d2e66e03f434","21/response.json":"sha256:c95dfb5ebb8133be27e9ede943161a64d26415693f902501bcc2d0d9e088b944"};
const identityPins={"20":{"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","aggregate":"sha256:f3132a1ca717352f072c5f5e1d9bfc6592bd19d01669652c86ec00ceb73829e8","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","ctorType":"sha256:0552bdbd635b9a11ace0115e8221024f1fae587ae633b6914d43fe079a6867e9","ctorSignature":"sha256:8131229e1ab6ff152bddb1558ebde70cbddb1766ca5f037f67994dbd08301c08","module":"sha256:07e4def0c6a8bc2951ad5de1861362af085e8d46feff08299db7699c5792ff92","function":"sha256:6f7f349093b07766e92026e5b19dc4f407c06b8532ebf3951e6686ed555a92bb","moduleScope":"sha256:e47a60410de0d3505bcf2d06ca453a69809764883aa2afcd83400d88b09cbf82","scope":"sha256:6e4dea7ba1914b637940e23d3045ebd1dfddcc8f34a87f80c169ec2ab05e9e0c","parameter":"sha256:8ee85a40f5511591a3f5b1a0fd722ddccbe694d072cb138c11272fb8328cf277","payload":"sha256:f9c895ad990ec520a8d6f80d7a8ee010d8e5fd7c100878b92f7f22e335cb58cc","constructor":"sha256:37337e0df7a6616ca7b457152e8d5178e370f740cffec978ae8c207fc9c802e8"},"21":{"i32":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","aggregate":"sha256:d4c387c6a6962d633c4bd3558a987325fd954359ac679e2911befc3b53cc3e99","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","ctorType":"sha256:0043223b62200744d68bb8dcc84a09cf278c7bb776ef5332ac63f478aa32ec71","ctorSignature":"sha256:984e7ba23ea997319c3a90bc69f4bb77a33e3885330334817497e87d7a1b6bbe","module":"sha256:c019816242118257c16b190bd50f8c8e80faee26e7b6c99b0068cae4c31c1f3b","function":"sha256:1b06b89dfb0056809333875c40d5b38900661bc08f08925b01f3465b77fe7b1e","moduleScope":"sha256:cc0c134c761d1882e3898be192808ceb5cac3059677426a08a7f883827cc3de9","scope":"sha256:9d7542fdeddbba517c3464bc16edb5c92b162f6bdfedc0192d95e9b8de61c652","parameter":"sha256:63735a6ef9e831054301c83108b00b90016c60f1ab5d86ab9e061c00cc6c4b05","payload":"sha256:1d809e365da1eb281b627dcc02cf9802cbff1441fe58ee4c5264349277a5f326","constructor":"sha256:303ab913e57baf70f88452ac6372d7eb39cdc6cb7db3d360f1c7c5d6a3d214d6"}};
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
const nominalKey=()=>({sourcePath,declarationPath:['Pair'],category:'value'});
const parameterPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(55,65),annotation:range(62,65)});
function markerOrigin() {
  const digest=hash(markers);
  return {contextArity:1,contextName:'ClassDecoratorContext',declarationPath:markerPath,declarationRange:range(190,272),
    declarationSha256:digest,entryId:hash('tsfg.marker\0minimal-aggregates-v1\0value\0'+digest),
    mode:'standard',range:range(7,17),version:'minimal-aggregates-v1'};
}
/** @param {any} spec */
function sourceFacts(spec) {
  const parameter={id:'s3',kind:'parameter',name:'value',type:'i32',writable:true,range:range(55,60),presence:parameterPresence()};
  const payload={id:'s4',kind:'local',name:'payload',type:'a1',writable:false,range:range(79,87)};
  const ctor={id:'c1',kind:'implicitDefault',classRef:'a1',signatureDeclaration:null,implementation:null,parameters:[],
    signature:{parameters:[],returnType:'a1'},resultType:'a1',body:[],parameterInitializers:[],range:range(7,31),bodyRange:null};
  const aggregate={id:'a1',name:'Pair',symbol:'s1',category:'value',nominalKey:nominalKey(),markerOrigin:markerOrigin(),
    instanceType:'a1',constructorType:'constructor:a1',fields:[],constructors:[ctor],memberCoverage:[],
    range:range(7,31),bodyRange:range(29,31),noInheritance:true};
  const construct={kind:'construct',type:'a1',target:'c1',arguments:[],signature:{parameters:[],returnType:'a1'},range:range(96,106)};
  const expression={kind:'reference',type:spec.throwing?'a1':'i32',symbol:spec.throwing?'s4':'s3',range:range(114,spec.readEnd)};
  return {status:'ok',inputs:[sourcePath,markerPath,conversionPath],symbols:[
    {id:'s1',kind:'class',name:'Pair',type:'a1',writable:false,range:range(23,28)},
    {id:'s2',kind:'function',name:'entry',type:'i32',writable:false,range:range(48,54)},copy(parameter),copy(payload)],
    functions:[{name:'entry',symbol:'s2',parameters:[copy(parameter)],returnType:'i32',parameterInitializers:[null],range:range(31,spec.end),body:[
      {kind:'variable',symbol:copy(payload),initializer:construct,range:range(79,106)},
      {kind:spec.throwing?'throw':'return',expression,range:range(107,spec.statementEnd)}]}],
    aggregateFacts:{profile:'minimal-aggregates-v1',declarations:[aggregate],sourceCoverage:[
      {kind:'class',name:'Pair',symbol:'s1',range:range(7,31),bodyRange:range(29,31)},
      {kind:'function',name:'entry',symbol:'s2',range:range(31,spec.end),bodyRange:range(72,spec.end)}]}};
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
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s2',sourcePath,range:range(31,spec.end),definition:range(48,54)}]}];
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
  const source={path:sourcePath,digest:hash(spec.source)},aggregate=entity('type',{kind:'aggregate',source,category:'value',declarationPath:['Pair']});
  const fnSignature={parameters:[i32],returnType:i32},signatureHash=entity('signature',fnSignature),callable=entity('type',{kind:'callable',...fnSignature});
  const ctorSignature={parameters:[],returnType:aggregate},ctorSignatureHash=entity('signature',ctorSignature),ctorType=entity('type',{kind:'callable',...ctorSignature});
  const moduleId=entity('module',{source,external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(31,spec.end)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]}),scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]});
  const parameter=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const payload=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'local',index:0});
  const constructorId=entity('constructor',{owner:aggregate,ordinal:0,signatureHash:ctorSignatureHash});
  const ctor={kind:'implicitDefault',id:constructorId,owner:aggregate,ordinal:0,type:ctorType,signatureHash:ctorSignatureHash,
    signatureDeclaration:null,implementation:null,parameters:[],parameterInitializers:[],body:[],range:range(7,31),bodyRange:null};
  const aggregateType={kind:'aggregate',id:aggregate,category:'value',name:'Pair',sourcePath,nameRange:range(23,28),range:range(7,31),bodyRange:range(29,31),
    nominalKey:nominalKey(),markerOrigin:markerOrigin(),noInheritance:true,fields:[],constructors:[ctor],memberCoverage:[]};
  /** @type {any[]} */ const types=[{kind:'scalar',id:i32,name:'i32'},aggregateType,
    {kind:'callable',id:callable,...fnSignature},{kind:'callable',id:ctorType,...ctorSignature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const construct={kind:'construct',type:aggregate,range:range(96,106),constructorId,arguments:[],
    signature:{ownerKind:'constructor',owner:constructorId,type:ctorType,presence:null,returnPresence:null}};
  const terminal={kind:spec.throwing?'throw':'return',range:range(107,spec.statementEnd),value:{kind:'bindingRead',type:spec.throwing?aggregate:i32,
    binding:spec.throwing?payload:parameter,range:range(114,spec.readEnd),presenceFlow:null}};
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),types,functions:[
      {id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(48,54),range:range(31,spec.end),type:callable,signatureHash,
        lexicalParent:null,declaringScope:moduleScope,parameters:[parameter],parameterInitializers:[null],captures:null,returnPresence:null,
        body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(31,spec.end),bindings:[
          {id:parameter,name:'value',role:'parameter',type:i32,writable:true,range:range(55,60),presence:parameterPresence()},
          {id:payload,name:'payload',role:'local',type:aggregate,writable:false,range:range(79,87),presence:null}],body:[
            {kind:'local',range:range(79,106),binding:payload,initializer:construct},terminal]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[aggregate],imports:[],globals:[],initialization:null,closure:null,
      coverage:[{kind:'aggregate',name:'Pair',target:aggregate,range:range(7,31),bodyRange:range(29,31)},
        {kind:'function',name:'entry',target:functionId,range:range(31,spec.end),bodyRange:range(72,spec.end)}]}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,range:range(31,spec.end),definition:range(48,54)}]}]};
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
test('actual Pair local construction retains complete return and throw HIR',async t=>{
  for(const spec of specs)await t.test(spec.id+(spec.throwing?'-throw-local':'-return-parameter'),async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>packetPins[spec.id+'/'+name]));assert.equal(spec.source.length,spec.end);
      assert.equal(Buffer.byteLength(spec.source),spec.end+2);assert.equal(conversions.length,17464);assert.equal(markers.length,360);
      assert.equal(hash(conversions),'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86');
      assert.equal(hash(markers),'sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9');
      assert.equal(spec.source.slice(79,87),' payload');assert.equal(spec.source.slice(96,106),'new Pair()');
      assert.equal(spec.source.slice(114,spec.readEnd),spec.throwing?'payload':' value');
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
      assert.deepEqual({i32,aggregate:agg.id,callable:fn.type,signature:fn.signatureHash,ctorType:ctor.type,ctorSignature:ctor.signatureHash,
        module:fn.module,function:fn.id,moduleScope:fn.declaringScope,scope:fn.body.scope,parameter:fn.parameters[0],
        payload:fn.body.bindings[1].id,constructor:ctor.id},identityPins[spec.id]);
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual Pair declaration, unused-or-thrown local, ctor, four types, coverage and exports');
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
        h=>{aggregateOf(h).nominalKey.category='component';},
        h=>{aggregateOf(h).markerOrigin.entryId='sha256:296b7cea922ade11f42bff80cdcccafdf19989994e48b444a1babc60bd86ef3a';},
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
