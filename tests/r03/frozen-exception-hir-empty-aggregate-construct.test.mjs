// SPDX-License-Identifier: MIT
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const oracle=createExceptionOracle();
// Independent empty-aggregate oracle: original Source literals, manual facts and frozen HIR v1.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url);
const sourcePath='/src/main.ts',conversionPath='/src/minimal-conversions-v5.d.ts',markerPath='/src/minimal-aggregates-v1.d.ts';
const bridge='sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d';
const schema='sha256:fb37661820a43016639059f0b9e82275414da0de87d2320e5efdfe8423921ee5';
const target={target:'windows-x86_64-msvc',triple:'x86_64-pc-windows-msvc',pointerBits:'64',
  llvmDataLayout:'e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128'};
const conversions="// SPDX-License-Identifier: MIT\ninterface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i8: unique symbol;\ndeclare const __tsfg_i16: unique symbol;\ndeclare const __tsfg_i32: unique symbol;\ndeclare const __tsfg_i64: unique symbol;\ndeclare const __tsfg_u8: unique symbol;\ndeclare const __tsfg_u16: unique symbol;\ndeclare const __tsfg_u32: unique symbol;\ndeclare const __tsfg_u64: unique symbol;\ndeclare const __tsfg_isize: unique symbol;\ndeclare const __tsfg_usize: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ntype i16 = number & { readonly [__tsfg_i16]: true };\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype i64 = number & { readonly [__tsfg_i64]: true };\ntype u8 = number & { readonly [__tsfg_u8]: true };\ntype u16 = number & { readonly [__tsfg_u16]: true };\ntype u32 = number & { readonly [__tsfg_u32]: true };\ntype u64 = number & { readonly [__tsfg_u64]: true };\ntype isize = number & { readonly [__tsfg_isize]: true };\ntype usize = number & { readonly [__tsfg_usize]: true };\ntype f64 = number;\ndeclare const __tsfg_f32: unique symbol;\ntype f32 = number & { readonly [__tsfg_f32]: true };\ndeclare function checked_i8_from_i8(value: i8): i8;\ndeclare function checked_i16_from_i8(value: i8): i16;\ndeclare function checked_i32_from_i8(value: i8): i32;\ndeclare function checked_i64_from_i8(value: i8): i64;\ndeclare function checked_u8_from_i8(value: i8): u8;\ndeclare function checked_u16_from_i8(value: i8): u16;\ndeclare function checked_u32_from_i8(value: i8): u32;\ndeclare function checked_u64_from_i8(value: i8): u64;\ndeclare function checked_isize_from_i8(value: i8): isize;\ndeclare function checked_usize_from_i8(value: i8): usize;\ndeclare function checked_f32_from_i8(value: i8): f32;\ndeclare function checked_f64_from_i8(value: i8): f64;\ndeclare function checked_i8_from_i16(value: i16): i8;\ndeclare function checked_i16_from_i16(value: i16): i16;\ndeclare function checked_i32_from_i16(value: i16): i32;\ndeclare function checked_i64_from_i16(value: i16): i64;\ndeclare function checked_u8_from_i16(value: i16): u8;\ndeclare function checked_u16_from_i16(value: i16): u16;\ndeclare function checked_u32_from_i16(value: i16): u32;\ndeclare function checked_u64_from_i16(value: i16): u64;\ndeclare function checked_isize_from_i16(value: i16): isize;\ndeclare function checked_usize_from_i16(value: i16): usize;\ndeclare function checked_f32_from_i16(value: i16): f32;\ndeclare function checked_f64_from_i16(value: i16): f64;\ndeclare function checked_i8_from_i32(value: i32): i8;\ndeclare function checked_i16_from_i32(value: i32): i16;\ndeclare function checked_i32_from_i32(value: i32): i32;\ndeclare function checked_i64_from_i32(value: i32): i64;\ndeclare function checked_u8_from_i32(value: i32): u8;\ndeclare function checked_u16_from_i32(value: i32): u16;\ndeclare function checked_u32_from_i32(value: i32): u32;\ndeclare function checked_u64_from_i32(value: i32): u64;\ndeclare function checked_isize_from_i32(value: i32): isize;\ndeclare function checked_usize_from_i32(value: i32): usize;\ndeclare function checked_f32_from_i32(value: i32): f32;\ndeclare function checked_f64_from_i32(value: i32): f64;\ndeclare function checked_i8_from_i64(value: i64): i8;\ndeclare function checked_i16_from_i64(value: i64): i16;\ndeclare function checked_i32_from_i64(value: i64): i32;\ndeclare function checked_i64_from_i64(value: i64): i64;\ndeclare function checked_u8_from_i64(value: i64): u8;\ndeclare function checked_u16_from_i64(value: i64): u16;\ndeclare function checked_u32_from_i64(value: i64): u32;\ndeclare function checked_u64_from_i64(value: i64): u64;\ndeclare function checked_isize_from_i64(value: i64): isize;\ndeclare function checked_usize_from_i64(value: i64): usize;\ndeclare function checked_f32_from_i64(value: i64): f32;\ndeclare function checked_f64_from_i64(value: i64): f64;\ndeclare function checked_i8_from_u8(value: u8): i8;\ndeclare function checked_i16_from_u8(value: u8): i16;\ndeclare function checked_i32_from_u8(value: u8): i32;\ndeclare function checked_i64_from_u8(value: u8): i64;\ndeclare function checked_u8_from_u8(value: u8): u8;\ndeclare function checked_u16_from_u8(value: u8): u16;\ndeclare function checked_u32_from_u8(value: u8): u32;\ndeclare function checked_u64_from_u8(value: u8): u64;\ndeclare function checked_isize_from_u8(value: u8): isize;\ndeclare function checked_usize_from_u8(value: u8): usize;\ndeclare function checked_f32_from_u8(value: u8): f32;\ndeclare function checked_f64_from_u8(value: u8): f64;\ndeclare function checked_i8_from_u16(value: u16): i8;\ndeclare function checked_i16_from_u16(value: u16): i16;\ndeclare function checked_i32_from_u16(value: u16): i32;\ndeclare function checked_i64_from_u16(value: u16): i64;\ndeclare function checked_u8_from_u16(value: u16): u8;\ndeclare function checked_u16_from_u16(value: u16): u16;\ndeclare function checked_u32_from_u16(value: u16): u32;\ndeclare function checked_u64_from_u16(value: u16): u64;\ndeclare function checked_isize_from_u16(value: u16): isize;\ndeclare function checked_usize_from_u16(value: u16): usize;\ndeclare function checked_f32_from_u16(value: u16): f32;\ndeclare function checked_f64_from_u16(value: u16): f64;\ndeclare function checked_i8_from_u32(value: u32): i8;\ndeclare function checked_i16_from_u32(value: u32): i16;\ndeclare function checked_i32_from_u32(value: u32): i32;\ndeclare function checked_i64_from_u32(value: u32): i64;\ndeclare function checked_u8_from_u32(value: u32): u8;\ndeclare function checked_u16_from_u32(value: u32): u16;\ndeclare function checked_u32_from_u32(value: u32): u32;\ndeclare function checked_u64_from_u32(value: u32): u64;\ndeclare function checked_isize_from_u32(value: u32): isize;\ndeclare function checked_usize_from_u32(value: u32): usize;\ndeclare function checked_f32_from_u32(value: u32): f32;\ndeclare function checked_f64_from_u32(value: u32): f64;\ndeclare function checked_i8_from_u64(value: u64): i8;\ndeclare function checked_i16_from_u64(value: u64): i16;\ndeclare function checked_i32_from_u64(value: u64): i32;\ndeclare function checked_i64_from_u64(value: u64): i64;\ndeclare function checked_u8_from_u64(value: u64): u8;\ndeclare function checked_u16_from_u64(value: u64): u16;\ndeclare function checked_u32_from_u64(value: u64): u32;\ndeclare function checked_u64_from_u64(value: u64): u64;\ndeclare function checked_isize_from_u64(value: u64): isize;\ndeclare function checked_usize_from_u64(value: u64): usize;\ndeclare function checked_f32_from_u64(value: u64): f32;\ndeclare function checked_f64_from_u64(value: u64): f64;\ndeclare function checked_i8_from_isize(value: isize): i8;\ndeclare function checked_i16_from_isize(value: isize): i16;\ndeclare function checked_i32_from_isize(value: isize): i32;\ndeclare function checked_i64_from_isize(value: isize): i64;\ndeclare function checked_u8_from_isize(value: isize): u8;\ndeclare function checked_u16_from_isize(value: isize): u16;\ndeclare function checked_u32_from_isize(value: isize): u32;\ndeclare function checked_u64_from_isize(value: isize): u64;\ndeclare function checked_isize_from_isize(value: isize): isize;\ndeclare function checked_usize_from_isize(value: isize): usize;\ndeclare function checked_f32_from_isize(value: isize): f32;\ndeclare function checked_f64_from_isize(value: isize): f64;\ndeclare function checked_i8_from_usize(value: usize): i8;\ndeclare function checked_i16_from_usize(value: usize): i16;\ndeclare function checked_i32_from_usize(value: usize): i32;\ndeclare function checked_i64_from_usize(value: usize): i64;\ndeclare function checked_u8_from_usize(value: usize): u8;\ndeclare function checked_u16_from_usize(value: usize): u16;\ndeclare function checked_u32_from_usize(value: usize): u32;\ndeclare function checked_u64_from_usize(value: usize): u64;\ndeclare function checked_isize_from_usize(value: usize): isize;\ndeclare function checked_usize_from_usize(value: usize): usize;\ndeclare function checked_f32_from_usize(value: usize): f32;\ndeclare function checked_f64_from_usize(value: usize): f64;\ndeclare function checked_i8_from_f32(value: f32): i8;\ndeclare function checked_i16_from_f32(value: f32): i16;\ndeclare function checked_i32_from_f32(value: f32): i32;\ndeclare function checked_i64_from_f32(value: f32): i64;\ndeclare function checked_u8_from_f32(value: f32): u8;\ndeclare function checked_u16_from_f32(value: f32): u16;\ndeclare function checked_u32_from_f32(value: f32): u32;\ndeclare function checked_u64_from_f32(value: f32): u64;\ndeclare function checked_isize_from_f32(value: f32): isize;\ndeclare function checked_usize_from_f32(value: f32): usize;\ndeclare function checked_f32_from_f32(value: f32): f32;\ndeclare function checked_f64_from_f32(value: f32): f64;\ndeclare function checked_i8_from_f64(value: f64): i8;\ndeclare function checked_i16_from_f64(value: f64): i16;\ndeclare function checked_i32_from_f64(value: f64): i32;\ndeclare function checked_i64_from_f64(value: f64): i64;\ndeclare function checked_u8_from_f64(value: f64): u8;\ndeclare function checked_u16_from_f64(value: f64): u16;\ndeclare function checked_u32_from_f64(value: f64): u32;\ndeclare function checked_u64_from_f64(value: f64): u64;\ndeclare function checked_isize_from_f64(value: f64): isize;\ndeclare function checked_usize_from_f64(value: f64): usize;\ndeclare function checked_f32_from_f64(value: f64): f32;\ndeclare function checked_f64_from_f64(value: f64): f64;\ndeclare function wrap_i8_from_i8(value: i8): i8;\ndeclare function wrap_i16_from_i8(value: i8): i16;\ndeclare function wrap_i32_from_i8(value: i8): i32;\ndeclare function wrap_i64_from_i8(value: i8): i64;\ndeclare function wrap_u8_from_i8(value: i8): u8;\ndeclare function wrap_u16_from_i8(value: i8): u16;\ndeclare function wrap_u32_from_i8(value: i8): u32;\ndeclare function wrap_u64_from_i8(value: i8): u64;\ndeclare function wrap_isize_from_i8(value: i8): isize;\ndeclare function wrap_usize_from_i8(value: i8): usize;\ndeclare function wrap_i8_from_i16(value: i16): i8;\ndeclare function wrap_i16_from_i16(value: i16): i16;\ndeclare function wrap_i32_from_i16(value: i16): i32;\ndeclare function wrap_i64_from_i16(value: i16): i64;\ndeclare function wrap_u8_from_i16(value: i16): u8;\ndeclare function wrap_u16_from_i16(value: i16): u16;\ndeclare function wrap_u32_from_i16(value: i16): u32;\ndeclare function wrap_u64_from_i16(value: i16): u64;\ndeclare function wrap_isize_from_i16(value: i16): isize;\ndeclare function wrap_usize_from_i16(value: i16): usize;\ndeclare function wrap_i8_from_i32(value: i32): i8;\ndeclare function wrap_i16_from_i32(value: i32): i16;\ndeclare function wrap_i32_from_i32(value: i32): i32;\ndeclare function wrap_i64_from_i32(value: i32): i64;\ndeclare function wrap_u8_from_i32(value: i32): u8;\ndeclare function wrap_u16_from_i32(value: i32): u16;\ndeclare function wrap_u32_from_i32(value: i32): u32;\ndeclare function wrap_u64_from_i32(value: i32): u64;\ndeclare function wrap_isize_from_i32(value: i32): isize;\ndeclare function wrap_usize_from_i32(value: i32): usize;\ndeclare function wrap_i8_from_i64(value: i64): i8;\ndeclare function wrap_i16_from_i64(value: i64): i16;\ndeclare function wrap_i32_from_i64(value: i64): i32;\ndeclare function wrap_i64_from_i64(value: i64): i64;\ndeclare function wrap_u8_from_i64(value: i64): u8;\ndeclare function wrap_u16_from_i64(value: i64): u16;\ndeclare function wrap_u32_from_i64(value: i64): u32;\ndeclare function wrap_u64_from_i64(value: i64): u64;\ndeclare function wrap_isize_from_i64(value: i64): isize;\ndeclare function wrap_usize_from_i64(value: i64): usize;\ndeclare function wrap_i8_from_u8(value: u8): i8;\ndeclare function wrap_i16_from_u8(value: u8): i16;\ndeclare function wrap_i32_from_u8(value: u8): i32;\ndeclare function wrap_i64_from_u8(value: u8): i64;\ndeclare function wrap_u8_from_u8(value: u8): u8;\ndeclare function wrap_u16_from_u8(value: u8): u16;\ndeclare function wrap_u32_from_u8(value: u8): u32;\ndeclare function wrap_u64_from_u8(value: u8): u64;\ndeclare function wrap_isize_from_u8(value: u8): isize;\ndeclare function wrap_usize_from_u8(value: u8): usize;\ndeclare function wrap_i8_from_u16(value: u16): i8;\ndeclare function wrap_i16_from_u16(value: u16): i16;\ndeclare function wrap_i32_from_u16(value: u16): i32;\ndeclare function wrap_i64_from_u16(value: u16): i64;\ndeclare function wrap_u8_from_u16(value: u16): u8;\ndeclare function wrap_u16_from_u16(value: u16): u16;\ndeclare function wrap_u32_from_u16(value: u16): u32;\ndeclare function wrap_u64_from_u16(value: u16): u64;\ndeclare function wrap_isize_from_u16(value: u16): isize;\ndeclare function wrap_usize_from_u16(value: u16): usize;\ndeclare function wrap_i8_from_u32(value: u32): i8;\ndeclare function wrap_i16_from_u32(value: u32): i16;\ndeclare function wrap_i32_from_u32(value: u32): i32;\ndeclare function wrap_i64_from_u32(value: u32): i64;\ndeclare function wrap_u8_from_u32(value: u32): u8;\ndeclare function wrap_u16_from_u32(value: u32): u16;\ndeclare function wrap_u32_from_u32(value: u32): u32;\ndeclare function wrap_u64_from_u32(value: u32): u64;\ndeclare function wrap_isize_from_u32(value: u32): isize;\ndeclare function wrap_usize_from_u32(value: u32): usize;\ndeclare function wrap_i8_from_u64(value: u64): i8;\ndeclare function wrap_i16_from_u64(value: u64): i16;\ndeclare function wrap_i32_from_u64(value: u64): i32;\ndeclare function wrap_i64_from_u64(value: u64): i64;\ndeclare function wrap_u8_from_u64(value: u64): u8;\ndeclare function wrap_u16_from_u64(value: u64): u16;\ndeclare function wrap_u32_from_u64(value: u64): u32;\ndeclare function wrap_u64_from_u64(value: u64): u64;\ndeclare function wrap_isize_from_u64(value: u64): isize;\ndeclare function wrap_usize_from_u64(value: u64): usize;\ndeclare function wrap_i8_from_isize(value: isize): i8;\ndeclare function wrap_i16_from_isize(value: isize): i16;\ndeclare function wrap_i32_from_isize(value: isize): i32;\ndeclare function wrap_i64_from_isize(value: isize): i64;\ndeclare function wrap_u8_from_isize(value: isize): u8;\ndeclare function wrap_u16_from_isize(value: isize): u16;\ndeclare function wrap_u32_from_isize(value: isize): u32;\ndeclare function wrap_u64_from_isize(value: isize): u64;\ndeclare function wrap_isize_from_isize(value: isize): isize;\ndeclare function wrap_usize_from_isize(value: isize): usize;\ndeclare function wrap_i8_from_usize(value: usize): i8;\ndeclare function wrap_i16_from_usize(value: usize): i16;\ndeclare function wrap_i32_from_usize(value: usize): i32;\ndeclare function wrap_i64_from_usize(value: usize): i64;\ndeclare function wrap_u8_from_usize(value: usize): u8;\ndeclare function wrap_u16_from_usize(value: usize): u16;\ndeclare function wrap_u32_from_usize(value: usize): u32;\ndeclare function wrap_u64_from_usize(value: usize): u64;\ndeclare function wrap_isize_from_usize(value: usize): isize;\ndeclare function wrap_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_i8_from_i8(value: i8): i8;\ndeclare function reinterpret_u8_from_i8(value: i8): u8;\ndeclare function reinterpret_i16_from_i16(value: i16): i16;\ndeclare function reinterpret_u16_from_i16(value: i16): u16;\ndeclare function reinterpret_i32_from_i32(value: i32): i32;\ndeclare function reinterpret_u32_from_i32(value: i32): u32;\ndeclare function reinterpret_f32_from_i32(value: i32): f32;\ndeclare function reinterpret_i64_from_i64(value: i64): i64;\ndeclare function reinterpret_u64_from_i64(value: i64): u64;\ndeclare function reinterpret_isize_from_i64(value: i64): isize;\ndeclare function reinterpret_usize_from_i64(value: i64): usize;\ndeclare function reinterpret_f64_from_i64(value: i64): f64;\ndeclare function reinterpret_i8_from_u8(value: u8): i8;\ndeclare function reinterpret_u8_from_u8(value: u8): u8;\ndeclare function reinterpret_i16_from_u16(value: u16): i16;\ndeclare function reinterpret_u16_from_u16(value: u16): u16;\ndeclare function reinterpret_i32_from_u32(value: u32): i32;\ndeclare function reinterpret_u32_from_u32(value: u32): u32;\ndeclare function reinterpret_f32_from_u32(value: u32): f32;\ndeclare function reinterpret_i64_from_u64(value: u64): i64;\ndeclare function reinterpret_u64_from_u64(value: u64): u64;\ndeclare function reinterpret_isize_from_u64(value: u64): isize;\ndeclare function reinterpret_usize_from_u64(value: u64): usize;\ndeclare function reinterpret_f64_from_u64(value: u64): f64;\ndeclare function reinterpret_i64_from_isize(value: isize): i64;\ndeclare function reinterpret_u64_from_isize(value: isize): u64;\ndeclare function reinterpret_isize_from_isize(value: isize): isize;\ndeclare function reinterpret_usize_from_isize(value: isize): usize;\ndeclare function reinterpret_f64_from_isize(value: isize): f64;\ndeclare function reinterpret_i64_from_usize(value: usize): i64;\ndeclare function reinterpret_u64_from_usize(value: usize): u64;\ndeclare function reinterpret_isize_from_usize(value: usize): isize;\ndeclare function reinterpret_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_f64_from_usize(value: usize): f64;\ndeclare function reinterpret_i32_from_f32(value: f32): i32;\ndeclare function reinterpret_u32_from_f32(value: f32): u32;\ndeclare function reinterpret_f32_from_f32(value: f32): f32;\ndeclare function reinterpret_i64_from_f64(value: f64): i64;\ndeclare function reinterpret_u64_from_f64(value: f64): u64;\ndeclare function reinterpret_isize_from_f64(value: f64): isize;\ndeclare function reinterpret_usize_from_f64(value: f64): usize;\ndeclare function reinterpret_f64_from_f64(value: f64): f64;\n";
const markers="// SPDX-License-Identifier: MIT\ninterface ClassDecoratorContext<C> {\n  readonly kind: \"class\";\n  readonly name: string | undefined;\n  addInitializer(initializer: (this: C) => void): void;\n}\ndeclare function tsfgValue<C>(target: C, context: ClassDecoratorContext<C>): void;\ndeclare function tsfgComponent<C>(target: C, context: ClassDecoratorContext<C>): void;\n";
const specs=[{"id":"23","category":"value","name":"Pair","source":"// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(): Pair { throw new Pair(); }","end":84,"classEnd":31,"nameStart":23,"nameEnd":28,"bodyStart":29,"markerEnd":17,"markerDtsStart":190,"markerDtsEnd":272,"fnNameStart":48,"fnNameEnd":54,"fnBodyStart":63,"throwStart":64,"throwEnd":82,"newStart":71,"newEnd":81},{"id":"27","category":"component","name":"Box","source":"// 😀\r\n@tsfgComponent class Box {}\r\nexport function entry(): Box { throw new Box(); }","end":85,"classEnd":34,"nameStart":27,"nameEnd":31,"bodyStart":32,"markerEnd":21,"markerDtsStart":273,"markerDtsEnd":359,"fnNameStart":51,"fnNameEnd":57,"fnBodyStart":65,"throwStart":66,"throwEnd":83,"newStart":73,"newEnd":82}];
const origins={"23":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:2680877217b17e48a1792755ae179cfd953d150e0fe589177ced363357b9036c","responseSha256":"sha256:95ead78a4832c355262519dc108985e178a20be291998e97a2bc65399ad64f01","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"27":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:d1cb3f2c5b9673421ab8ceb45dc911edbf5f548d3a58de8b10fe16910a056628","responseSha256":"sha256:c80d48e22fed46ada39948872fc97c42a8e257026ce97699e6aff88bc26dccc2","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"23/request.json":"sha256:2680877217b17e48a1792755ae179cfd953d150e0fe589177ced363357b9036c","27/request.json":"sha256:d1cb3f2c5b9673421ab8ceb45dc911edbf5f548d3a58de8b10fe16910a056628","23/response.json":"sha256:95ead78a4832c355262519dc108985e178a20be291998e97a2bc65399ad64f01","23/origin.json":"sha256:7eb311663a98015f266aea926f6f1648ec9a14aa24f9817884ff13cfd4da7492","27/response.json":"sha256:c80d48e22fed46ada39948872fc97c42a8e257026ce97699e6aff88bc26dccc2","27/origin.json":"sha256:f0f1ef2ab98e8125cf7a9604d4a6a6568f25ef7c74ef908c361d4c8fb3e720e9"};
const identityPins={"23":{"aggregate":"sha256:34ef617d7ff1d48973944426728401d02603b91c6b810d06e39c7de7100f279d","callable":"sha256:d91901fb4fbfb9ae83b2d27ee49fe89cba15e3add4408f63fd0bf1da1d37bbe1","signature":"sha256:61c4bfd686df38b87bab6803fd1eede111e658f7c296f9a5180667e101cfa259","module":"sha256:daaf8fe12512d5098c7a04a1e4ce25ecf47483e713233b00dbea8915e88feaaf","function":"sha256:385196b0697f97778018365cce19c20bc8458882be14078eb9c44086838e5dc3","scope":"sha256:c9eae22de92a801e7016d79fe3364f178e11827392bf32b874bdb1d06a35ef52","moduleScope":"sha256:c8c3bead0dae0f8713ef19080951884ff0a0df15fd94d34ffd7d84290cbc1824","constructor":"sha256:68b7a883bb8ba638c9b7d76392a87b0e24ab41b79fff9d44068b5b2079e8e683"},"27":{"aggregate":"sha256:74f3444106e8a8795baad00354765983ba00826057d4dcd2deedd2d414d75c5d","callable":"sha256:1fe89fd53d17df0663f4a6b3ee3d80baf0807ed530f939736d0c869190be6399","signature":"sha256:42a295e48cc5b87c240bb60a09d9de94838dc21ba255597a907f92b537814352","module":"sha256:03c5efdeccfeb8be801db767ac60bf2739371152a8207b02eb60e5c679f19b8e","function":"sha256:48d5d138a977954094b3e08d05469e6f8d4bd05f330d2706a0fd4ceba481dbd1","scope":"sha256:5521cceecdf26efdb94ffc1efff9f093ebb04f9b91a86274d8122360f025d102","moduleScope":"sha256:a11c3368be202bbbd84f0a42d0dc3eb5678116674614076f9381a0a28f27c6a1","constructor":"sha256:3c5d754f9645583c780cb6a06ace71609b88d639700024312a78d965ae9a79a5"}};
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
const entity=oracle.entity;
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
      body:[{kind:'throw',range:range(spec.throwStart,spec.throwEnd),expression}]}],
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
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:spec.end,positionUnit:'utf16'}],target:copy(target),types,
    functions:[{id:functionId,module:moduleId,sourcePath,name:'entry',nameRange:range(spec.fnNameStart,spec.fnNameEnd),range:range(spec.classEnd,spec.end),
      type:callable,signatureHash,lexicalParent:null,declaringScope:moduleScope,parameters:[],parameterInitializers:null,captures:null,returnPresence:null,
      body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(spec.classEnd,spec.end),bindings:[],
        body:[{kind:'throw',range:range(spec.throwStart,spec.throwEnd),value:expression}]}}],
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
test('two actual empty nominal aggregates require complete construct-to-throw HIR',async t=>{
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
        scope:fn.body.scope,moduleScope:fn.declaringScope,constructor:agg.constructors[0].id},oracle.data(identityPins[spec.id]));
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual HIR, constructor evidence, coverage, exports and exact two-type closure');
      assert.equal(result.hir.types.length,2);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.types.reverse();caller.sources[0].content='caller mutation';
      assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      if(result.hir.target!==null)assert.match(lowerHir(result.hir),/tsfg_core.exception_program/);else assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
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
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
