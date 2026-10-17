// SPDX-License-Identifier: MIT
// Independent aggregate return-new oracle: original Source literals, manual facts and frozen HIR v1.
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
const specs=[{"id":"22","category":"value","name":"Pair","source":"// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(): Pair { return new Pair(); }","end":85,"classEnd":31,"nameStart":23,"nameEnd":28,"bodyStart":29,"markerEnd":17,"markerDtsStart":190,"markerDtsEnd":272,"fnNameStart":48,"fnNameEnd":54,"fnBodyStart":63,"returnStart":64,"returnEnd":83,"newStart":72,"newEnd":82},{"id":"26","category":"component","name":"Box","source":"// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(): Box { return new Box(); }","end":86,"classEnd":34,"nameStart":27,"nameEnd":31,"bodyStart":32,"markerEnd":21,"markerDtsStart":273,"markerDtsEnd":359,"fnNameStart":51,"fnNameEnd":57,"fnBodyStart":65,"returnStart":66,"returnEnd":84,"newStart":74,"newEnd":83}];
const origins={"22":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:e17ffaf98896f8148dabf47fea5ec75940654423b62620ee40c237574edce806","responseSha256":"sha256:eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"26":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:30937f2cfb10865008e0b6180be5666945fb72a661300e877ab9d7fcfe2e3249","responseSha256":"sha256:0412c6fc9ee515abe5fc3f970e9043d439e79f2acc755390ad7224411a3f5b30","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"22/request.json":"sha256:e17ffaf98896f8148dabf47fea5ec75940654423b62620ee40c237574edce806","22/origin.json":"sha256:e0017e70e38aedb9c9d9da56df3f284e316343f08ba3746cc4bebed829d1a116","22/response.json":"sha256:eabb2d2f4e483f20777d8c0db3316850105d9fdd07f883ecbcc1a3aadf00d14a","26/request.json":"sha256:30937f2cfb10865008e0b6180be5666945fb72a661300e877ab9d7fcfe2e3249","26/origin.json":"sha256:a7f6434e39bd8ea011c6529359dc85220c6fbe80bde7103a7480922952b52d64","26/response.json":"sha256:0412c6fc9ee515abe5fc3f970e9043d439e79f2acc755390ad7224411a3f5b30"};
const identityPins={"22":{"aggregate":"sha256:a2e5fc75d34023027d5c8d9a67e39627029d4c773832949e80195a3dcf63aa19","callable":"sha256:af4f7b075e5385f2c3f6d0f26e5dded6f5484e96aca436ab373475a1e1e4d76c","signature":"sha256:198832cd92275111fb02a8693efa5c8c3b569c27c855109537879c00bf630edd","module":"sha256:9de691c53c42789ca81e224aa58d9e219583563b463241a68db6df99a98afcb8","function":"sha256:e6e8930609ceeead4431cb2bdc397e5142640809f7870b63329238e32aafc7eb","scope":"sha256:05c12c13f746a33e49cf2c7487c80fa81ce6e4cc6b523b5ca43f704a59bda086","moduleScope":"sha256:58cdcd84ddaac9ef2cb7fae5b9732e3729ca82b62662603fdae2d44df84d8770","constructor":"sha256:ea67c762553e9c4779b450e40be1ff3e542a66ab6c8b6cbb45a8c4627ca80d52"},"26":{"aggregate":"sha256:b5e6a136b8270cabbc7fe7b1fff8652388ceb5e0c54bcd9eb0d4a7d590f1cc1e","callable":"sha256:b6359d93e4504852c9027f3c837fba4fc3f096dbc798e9e676514c84a3f8b6d5","signature":"sha256:1379c26c2efbf40970dffc7bf95ea0ebed8843460ee08c14a9035b600f570b84","module":"sha256:fc40018be18cb35fe351078c225c9102640184ed377d92f7db5560520dee6f14","function":"sha256:b598e588e65aad8809c66585ed8557ff5e1e2bbe772451481c650f9e04425459","scope":"sha256:9efa540d9cdd24085bb6e3f01ea81cd0e2308065fc6e5543bf6f422c53573927","moduleScope":"sha256:71672028bd7da301b67071636bec1c4130946e85d4f3bb1b0fa501e942d0505f","constructor":"sha256:3cc59a7efe9c29e963a350a10e7f55b24fc19e86d8fdda2d5ab389c50bd051fe"}};
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
/** @param {any} spec */
function markerOrigin(spec) {
  const digest=hash(markers);
  return {contextArity:1,contextName:'ClassDecoratorContext',declarationPath:markerPath,
    declarationRange:range(spec.markerDtsStart,spec.markerDtsEnd),declarationSha256:digest,
    entryId:hash('tsfg.marker\0minimal-aggregates-v1\0'+spec.category+'\0'+digest),mode:'standard',
    range:range(7,spec.markerEnd),version:'minimal-aggregates-v1'};
}
/** @param {any} spec */
const nominalKey=spec=>({sourcePath,declarationPath:[spec.name],category:spec.category});
/** @param {any} spec */
function sourceFacts(spec) {
  const classRange=range(7,spec.classEnd),bodyRange=range(spec.bodyStart,spec.classEnd),fnRange=range(spec.classEnd,spec.end);
  const signature={parameters:[],returnType:'a1'};
  const ctor={id:'c1',kind:'implicitDefault',classRef:'a1',signatureDeclaration:null,implementation:null,parameters:[],
    signature:copy(signature),resultType:'a1',body:[],parameterInitializers:[],range:copy(classRange),bodyRange:null};
  const aggregate={id:'a1',name:spec.name,symbol:'s1',category:spec.category,nominalKey:nominalKey(spec),markerOrigin:markerOrigin(spec),
    instanceType:'a1',constructorType:'constructor:a1',fields:[],constructors:[ctor],memberCoverage:[],
    range:copy(classRange),bodyRange:copy(bodyRange),noInheritance:true};
  const expression={kind:'construct',type:'a1',target:'c1',range:range(spec.newStart,spec.newEnd),signature:copy(signature),arguments:[]};
  return {status:'ok',inputs:[sourcePath,markerPath,conversionPath],symbols:[
    {id:'s1',kind:'class',name:spec.name,range:range(spec.nameStart,spec.nameEnd),type:'a1',writable:false},
    {id:'s2',kind:'function',name:'entry',range:range(spec.fnNameStart,spec.fnNameEnd),type:'a1',writable:false}],
    functions:[{name:'entry',symbol:'s2',parameters:[],returnType:'a1',range:copy(fnRange),
      body:[{kind:'return',range:range(spec.returnStart,spec.returnEnd),expression}]}],
    aggregateFacts:{profile:'minimal-aggregates-v1',declarations:[aggregate],sourceCoverage:[
      {kind:'class',name:spec.name,symbol:'s1',range:copy(classRange),bodyRange:copy(bodyRange)},
      {kind:'function',name:'entry',symbol:'s2',range:copy(fnRange),bodyRange:range(spec.fnBodyStart,spec.end)}]}};
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
  const exports=[{sourcePath,external:true,bindings:[{name:'entry',target:'s2',sourcePath,
    range:range(spec.classEnd,spec.end),definition:range(spec.fnNameStart,spec.fnNameEnd)}]}];
  const payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:hash(file.content),
    byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})),facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload},responseText=jcs(response);
  const sourceOrigin=copy(origins[spec.id]);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),
    sourceOrigin,inputIdentity,identityInput,sources:[{path:sourcePath,content:spec.source,
      hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),facts:copy(facts),exports:copy(exports),
    capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} spec @param {any} snapshot */
function manualHir(spec,snapshot) {
  const source={path:sourcePath,digest:hash(spec.source)},classRange=range(7,spec.classEnd),bodyRange=range(spec.bodyStart,spec.classEnd);
  const aggregate=entity('type',{kind:'aggregate',source,category:spec.category,declarationPath:[spec.name]});
  const signature={parameters:[],returnType:aggregate},signatureHash=entity('signature',signature);
  const callable=entity('type',{kind:'callable',...signature}),moduleId=entity('module',{source,external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'entry',signatureHash,range:range(spec.classEnd,spec.end)});
  const scope=entity('scope',{ownerKind:'function',owner:functionId,path:[]}),moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const constructorId=entity('constructor',{owner:aggregate,ordinal:0,signatureHash});
  const ctor={kind:'implicitDefault',id:constructorId,owner:aggregate,ordinal:0,type:callable,signatureHash,
    signatureDeclaration:null,implementation:null,parameters:[],parameterInitializers:[],body:[],range:copy(classRange),bodyRange:null};
  const aggregateType={kind:'aggregate',id:aggregate,category:spec.category,name:spec.name,sourcePath,
    nameRange:range(spec.nameStart,spec.nameEnd),range:copy(classRange),bodyRange:copy(bodyRange),nominalKey:nominalKey(spec),
    markerOrigin:markerOrigin(spec),noInheritance:true,fields:[],constructors:[ctor],memberCoverage:[]};
  /** @type {any[]} */ const types=[aggregateType,{kind:'callable',id:callable,...signature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const expression={kind:'construct',type:aggregate,range:range(spec.newStart,spec.newEnd),constructorId,
    signature:{ownerKind:'constructor',owner:constructorId,type:callable,presence:null,returnPresence:null},arguments:[]};
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),types,
    functions:[{id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(spec.fnNameStart,spec.fnNameEnd),range:range(spec.classEnd,spec.end),
      type:callable,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:[],parameterInitializers:null,captures:null,returnPresence:null,
      body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(spec.classEnd,spec.end),bindings:[],
        body:[{kind:'return',range:range(spec.returnStart,spec.returnEnd),value:expression}]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[aggregate],imports:[],globals:[],initialization:null,closure:null,
      coverage:[{kind:'aggregate',name:spec.name,target:aggregate,range:copy(classRange),bodyRange:copy(bodyRange)},
        {kind:'function',name:'entry',target:functionId,range:range(spec.classEnd,spec.end),bodyRange:range(spec.fnBodyStart,spec.end)}]}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'entry',target:functionId,sourcePath,
      range:range(spec.classEnd,spec.end),definition:range(spec.fnNameStart,spec.fnNameEnd)}]}]};
}
// Test-only structural helpers remain independent of executable older tests.
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
test('two actual empty nominal aggregates retain complete return construction HIR',async t=>{
  for(const spec of specs)await t.test(spec.id+'-'+spec.category,async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>packetPins[spec.id+'/'+name]));assert.equal(spec.source.length,spec.end);
      assert.equal(Buffer.byteLength(spec.source),spec.end+2);assert.equal(conversions.length,17464);assert.equal(markers.length,360);
      assert.equal(hash(conversions),'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86');
      assert.equal(hash(markers),'sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9');
      assert.equal(spec.source.slice(spec.nameStart,spec.nameEnd),' '+spec.name);
      assert.equal(spec.source.slice(spec.newStart,spec.newEnd),'new '+spec.name+'()');
      const expected=transport(spec),origin=origins[spec.id];
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire original input from independent literals');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire actual packet from manual Source facts and exports');
      assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
      assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualNominalConstructorModuleCoverageAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),fn=expected.functions[0],agg=expected.types.find(type=>type.kind==='aggregate');
      assert.deepEqual({aggregate:agg.id,callable:fn.type,signature:fn.signatureHash,module:fn.module,function:fn.id,
        scope:fn.body.scope,moduleScope:fn.declaringScope,constructor:agg.constructors[0].id},identityPins[spec.id]);
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual HIR, constructor evidence, coverage, exports and exact two-type closure');
      assert.equal(result.hir.types.length,2);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.types.reverse();caller.sources[0].content='caller mutation';
      assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      for(const change of [
        h=>{h.types.find(type=>type.kind==='aggregate').category=spec.category==='value'?'component':'value';},
        h=>{h.types.find(type=>type.kind==='aggregate').nominalKey.declarationPath=['entry'];},
        h=>{h.types.find(type=>type.kind==='aggregate').markerOrigin.declarationRange.start++;},
        h=>{h.types.find(type=>type.kind==='aggregate').constructors[0].owner=h.functions[0].id;},
        h=>{h.types.find(type=>type.kind==='aggregate').constructors[0].bodyRange=range(spec.bodyStart,spec.classEnd);},
        h=>{h.functions[0].body.body[0].value.signature.owner=h.functions[0].id;},
        h=>{h.functions[0].body.body[0].value.signature.presence=[];},
        h=>{delete h.functions[0].body.body[0].value.arguments;},
        h=>{h.modules[0].aggregateTypes=[];},
        h=>{h.modules[0].coverage[0].target=h.functions[0].id;},
        h=>{h.types=h.types.filter(type=>type.kind!=='callable');},
        h=>{h.functions[0].parameterInitializers=[];},
        h=>{h.exports[0].bindings.push({...h.exports[0].bindings[0],name:spec.name});},
        h=>{const value=h.functions[0].body.body[0].value;value.signature.ownerKind='function';value.signature.owner=h.functions[0].id;},
        h=>{h.functions[0].body.body[0].kind='throw';},
        h=>{h.functions[0].body.body[0].value.type=h.functions[0].type;},
        h=>{h.types.push({kind:'scalar',id:hash('tsfg.type\0i32'),name:'i32'});h.types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
