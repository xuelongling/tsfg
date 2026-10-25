// SPDX-License-Identifier: MIT
import {createExceptionOracle} from './exception-hir-v2-oracle.mjs';
const oracle=createExceptionOracle();
// Independent complete aggregate field/binary oracle; original literals and HIR v1 contract.
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
const specs=[{"id":"01","caughtLeft":false,"source":"// 😀\r\n@tsfgComponent class Box { flag: bool = true; }\r\nexport function f(box: Box): bool { try { throw true; } catch (caught) { if (typeof caught === \"boolean\") { return box.flag === caught; } throw caught; } }","fieldStart":171,"fieldEnd":179,"receiverEnd":174,"narrowedStart":184,"narrowedEnd":190},{"id":"02","caughtLeft":true,"source":"// 😀\r\n@tsfgComponent class Box { flag: bool = true; }\r\nexport function f(box: Box): bool { try { throw true; } catch (caught) { if (typeof caught === \"boolean\") { return caught === box.flag; } throw caught; } }","fieldStart":182,"fieldEnd":190,"receiverEnd":185,"narrowedStart":171,"narrowedEnd":177}];
const origins={"01":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:2f5063c5198335f321cfd6bafd94f4cf61ad429159f3f2ff9523387eb39933c9","responseSha256":"sha256:c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"02":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:7101e4e71a9322eb61612cb88a97f3aeabc6592f128db24a97c46cfdacb811e0","responseSha256":"sha256:0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const packetPins={"01/request.json":"sha256:2f5063c5198335f321cfd6bafd94f4cf61ad429159f3f2ff9523387eb39933c9","01/origin.json":"sha256:9009777fa1420e354f6063ef5b00ed14072f51f81ae7ffb3e6cd31a2aa04f704","01/response.json":"sha256:c86d8865f1c85f9d5d4cdc3befc0ba4688888fd6ec629a2be105a5fb83bdc4e1","02/request.json":"sha256:7101e4e71a9322eb61612cb88a97f3aeabc6592f128db24a97c46cfdacb811e0","02/origin.json":"sha256:4b6d057758a943b6c50d0d27b6350f0f5198d4dd578805ea8a96bd59363943ee","02/response.json":"sha256:0bf062e6e27e59f9e985dc68918919fe88abee53238ddbf7f3e30061ff1a0656"};
const identityPins={"01":{"bool":"sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","aggregate":"sha256:f9bdd4722eb52c2b51cace0636e52dc37513888f273a3f825052561ba456ffa4","callable":"sha256:4031ad49288c730c7c0a6d5af50178ca8a085af6f197ffcdd3157fe326ac65b1","signature":"sha256:aebe7b25823044c62d51073f97d92e6d459896f8589ccbdaed0da9efbfbcf2f9","ctorType":"sha256:8aeb9a3de392fb1570254fd8c789e1c1e5101ae8951675e9768b1f4edb4b1c8f","ctorSignature":"sha256:db3fcdbde76e1cb76efdbefde45484c4205f2a7452241962c34aa51fd6950169","module":"sha256:dd9aa161b90d54a6e30f1a6e947cdf8fc3a738ba5d096180c5d86ec272a80b82","function":"sha256:55b443179a7b11cda03bc0325123cd5ecbf9287b7ff48e9d9f991ff00cb70833","field":"sha256:0ebd483dc8ba2cf8909e559a94a59b76582d16368515e646d0761f554585afe2","constructor":"sha256:5d3a009419d7bc0ddc603e5134929950f0816edb49725b2e896fc9e4183b2955","scope":"sha256:203a940bc19c3217b2885defcd361ca9208389fa107fbaaf2276db1d30dad18b","tryScope":"sha256:9559b33037a75416410522db31ac38373b6971843e9fd5f9a22f71c06e1b756a","catchScope":"sha256:7e75341b3534155fb59cae4d3dd3072c1a1a2874c21afca87f6450454bd73090","thenScope":"sha256:59c1a461d662f0aae4abbcf8c790eb9173dab84e46b48f96d13e5106ce3e8d21","moduleScope":"sha256:92f505eb5b47528aa991df44aae906f1cee0a8bfcdb2cf50cebd224a7519d6e6","parameter":"sha256:75227d0025a73eab2c8a214c2ba185f5864b82abb06bcfc9bef3a904298caaa9","caught":"sha256:b47d7d6ce21c2b6cca9bae1704defd27c2cc60ae1c6bc520e9e968eab933a2ef"},"02":{"bool":"sha256:811afa3745352bcd218d039b4539ec7e7ca8d103420dbc4c8ab8d6119e850721","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","aggregate":"sha256:a482580d3fbe82e9ea7579244ebce50ea54aafba4d37736dc4e75ffd9f929b48","callable":"sha256:e0010c9c8c40298900a4a155529728484fe2fceb893afc11de2c094c1998398a","signature":"sha256:c387b3a49dc95981b5cb84402c31fc94406fcd8fc7b20d5dcf68dfadb91bc929","ctorType":"sha256:90156dac615ea92307f97f295e0d52d66c7fa3785df0edd1ae9b82c1999c48b2","ctorSignature":"sha256:8b11bb0d2938462c05ea3d9d04cd455367c110d315e05d45f2135f0cf0790c9e","module":"sha256:5b0b27520e647a17bb6df759cbf5400b7389e0b515c771942426261f46095dd7","function":"sha256:6f0a318e15e9e723f6db2181dc39f7f12b9510ae24cd4f40a1dccaf74d98ab47","field":"sha256:7ada6547b3350957da27fa38d09175375d6da103bbaf069060a60b87d77709cc","constructor":"sha256:b8ac86819f20f989e4e32bccece6e6c5c0c9a3542f2ade8cb554dbfce83ffbd7","scope":"sha256:21a89c68aa7a3056ed562a9b6f73ab3e11dd4a3a6daac137ab8c2e6d68aac37d","tryScope":"sha256:fb94471fd5859eb890c245583a7b04bcae37accf90478a6fb82f3abdfa49f8f2","catchScope":"sha256:246972869d6b1686fcc73eb1f0ad9d01100a866489aea7f64732d13eab9be6f0","thenScope":"sha256:1b56fbd0529e8af948bc708b1b3fad151d174d9b7e4e660e26d44331a6123744","moduleScope":"sha256:e87729917d3e623daf1e519e75c32768ff9857e6e85bc8cd707ac69846be9987","parameter":"sha256:a33cbd2d8134ac41a1c5acd6b285cf717606b7dd48cd369ade2347271908e250","caught":"sha256:16187aafb586d956b5d493fc1c29e15029e8bd2693dc4692a288619a835e08a6"}};
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
const bool=hash('tsfg.type\0bool'),unknown=entity('type',{kind:'unknown'});
const nominalKey=()=>({sourcePath,declarationPath:['Box'],category:'component'});
const parameterPresence=()=>({undefined:false,null:false,optional:false,default:false,range:range(74,82),annotation:range(79,82)});
function markerOrigin() {
  const digest=hash(markers);
  return {contextArity:1,contextName:'ClassDecoratorContext',declarationPath:markerPath,declarationRange:range(273,359),
    declarationSha256:digest,entryId:hash('tsfg.marker\0minimal-aggregates-v1\0component\0'+digest),
    mode:'standard',range:range(7,21),version:'minimal-aggregates-v1'};
}
/** @param {any} spec */
function sourceFacts(spec) {
  const parameter={id:'s4',kind:'parameter',name:'box',range:range(74,77),type:'a1',writable:true,presence:parameterPresence()};
  const caught={id:'s5',kind:'local',name:'caught',range:range(119,125),type:'unknown',writable:true};
  const fieldValue={kind:'field',type:'bool',range:range(spec.fieldStart,spec.fieldEnd),
    receiver:{kind:'reference',type:'a1',symbol:'s4',range:range(spec.fieldStart,spec.receiverEnd)},fieldPath:['a1.f0'],symbol:'s2',
    permission:{readable:true,writable:true,constructorSelf:false,classRef:'a1'}};
  const narrowed={kind:'reference',type:'bool',symbol:'s5',range:range(spec.narrowedStart,spec.narrowedEnd)};
  const binary={kind:'binary',type:'bool',operator:'===',range:range(171,190),
    left:spec.caughtLeft?narrowed:fieldValue,right:spec.caughtLeft?fieldValue:narrowed};
  const condition={kind:'type-test',type:'bool',operator:'===',range:range(133,160),
    operand:{kind:'reference',type:'unknown',symbol:'s5',range:range(139,146)},
    typeTest:{tag:'boolean',typeofRange:range(133,146),tagRange:range(150,160)}};
  const attempt={kind:'try',range:range(91,209),exception:{
    tryBlock:{range:range(95,111),body:[{kind:'throw',range:range(97,109),
      expression:{kind:'boolean',type:'bool',boolean:true,range:range(103,108)}}]},
    catchClause:{binding:copy(caught),declarationRange:range(119,125),range:range(111,209),block:{range:range(126,209),body:[
      {kind:'if',range:range(129,193),condition,thenBody:[{kind:'block',range:range(161,193),
        body:[{kind:'return',range:range(163,191),expression:binary}]}]},
      {kind:'throw',range:range(193,207),expression:{kind:'reference',type:'unknown',symbol:'s5',range:range(199,206)}}]}}}};
  const ctor={id:'c1',kind:'implicitDefault',classRef:'a1',signatureDeclaration:null,implementation:null,parameters:[],
    signature:{parameters:[],returnType:'a1'},resultType:'a1',body:[],parameterInitializers:[],range:range(7,54),bodyRange:null};
  const field={id:'a1.f0',ordinal:0,name:'flag',symbol:'s2',type:'bool',readonly:false,access:'public',optionalSyntax:false,
    definiteAssertionSyntax:false,initializer:{kind:'boolean',type:'bool',boolean:true,range:range(46,51)},range:range(34,52)};
  const aggregate={id:'a1',name:'Box',symbol:'s1',category:'component',nominalKey:nominalKey(),markerOrigin:markerOrigin(),
    instanceType:'a1',constructorType:'constructor:a1',fields:[field],constructors:[ctor],memberCoverage:[
      {kind:'KindPropertyDeclaration',name:'flag',symbol:'s2',range:range(34,52),bodyRange:null}],
    range:range(7,54),bodyRange:range(32,54),noInheritance:true};
  return {status:'ok',inputs:[sourcePath,markerPath,conversionPath],symbols:[
    {id:'s1',kind:'class',name:'Box',range:range(27,31),type:'a1',writable:false},
    {id:'s2',kind:'field',name:'flag',range:range(33,38),type:'bool',writable:true},
    {id:'s3',kind:'function',name:'f',range:range(71,73),type:'bool',writable:false},copy(parameter),copy(caught)],
    functions:[{name:'f',symbol:'s3',parameters:[copy(parameter)],returnType:'bool',parameterInitializers:[null],range:range(54,211),body:[attempt]}],
    aggregateFacts:{profile:'minimal-aggregates-v1',declarations:[aggregate],sourceCoverage:[
      {kind:'class',name:'Box',symbol:'s1',range:range(7,54),bodyRange:range(32,54)},
      {kind:'function',name:'f',symbol:'s3',range:range(54,211),bodyRange:range(90,211)}]}};
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
  const exports=[{sourcePath,external:true,bindings:[{name:'f',target:'s3',sourcePath,range:range(54,211),definition:range(71,73)}]}];
  const payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:hash(file.content),
    byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})),facts,exports};
  const request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:bridge,input},requestText=jcs(request);
  const response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:bridge,
    requestId:hash('tsfg.exception-facts.request.v1\0'+requestText),
    packageId:hash('tsfg.exception-facts.package.v1\0'+bridge+'\0'+jcs(payload)),payload},responseText=jcs(response);
  const sourceOrigin=copy(origins[spec.id]);
  const snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:bridge},
    snapshotId:hash('tsfg.frontend-exception-candidate.snapshot.v1\0'+bridge+'\0'+jcs({inputIdentity,sourceOrigin})),
    sourceOrigin,inputIdentity,identityInput,sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:211,positionUnit:'utf16'}],
    target:copy(target),facts:copy(facts),exports:copy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
}
/** @param {any} spec @param {any} snapshot */
function manualHir(spec,snapshot) {
  const source={path:sourcePath,digest:hash(spec.source)};
  const aggregate=entity('type',{kind:'aggregate',source,category:'component',declarationPath:['Box']});
  const fnSignature={parameters:[aggregate],returnType:bool},signatureHash=entity('signature',fnSignature);
  const callable=entity('type',{kind:'callable',...fnSignature}),ctorSignature={parameters:[],returnType:aggregate};
  const ctorType=entity('type',{kind:'callable',...ctorSignature}),ctorSignatureHash=entity('signature',ctorSignature);
  const moduleId=entity('module',{source,external:true});
  const functionId=entity('function',{module:moduleId,parent:null,declaringScopePath:[],name:'f',signatureHash,range:range(54,211)});
  const moduleScope=entity('scope',{ownerKind:'module',owner:moduleId,path:[]});
  const tryPath=[{statement:0,slot:'try'}],catchPath=[{statement:0,slot:'catch'}],thenPath=[...catchPath,{statement:0,slot:'then'}];
  const scopeOf=path=>entity('scope',{ownerKind:'function',owner:functionId,path});
  const scope=scopeOf([]),tryScope=scopeOf(tryPath),catchScope=scopeOf(catchPath),thenScope=scopeOf(thenPath);
  const parameter=entity('binding',{ownerKind:'function',owner:functionId,scopePath:[],role:'parameter',index:0});
  const caught=entity('binding',{ownerKind:'function',owner:functionId,scopePath:catchPath,role:'catch',index:0});
  const constructorId=entity('constructor',{owner:aggregate,ordinal:0,signatureHash:ctorSignatureHash});
  const fieldId=entity('field',{owner:aggregate,ordinal:0});
  const ctor={kind:'implicitDefault',id:constructorId,owner:aggregate,ordinal:0,type:ctorType,signatureHash:ctorSignatureHash,
    signatureDeclaration:null,implementation:null,parameters:[],parameterInitializers:[],body:[],range:range(7,54),bodyRange:null};
  const field={id:fieldId,owner:aggregate,ordinal:0,name:'flag',nameRange:range(33,38),type:bool,readonly:false,access:'public',
    optionalSyntax:false,definiteAssertionSyntax:false,initializer:{kind:'boolean',type:bool,value:true,range:range(46,51)},range:range(34,52)};
  const aggregateType={kind:'aggregate',id:aggregate,category:'component',name:'Box',sourcePath,nameRange:range(27,31),
    range:range(7,54),bodyRange:range(32,54),nominalKey:nominalKey(),markerOrigin:markerOrigin(),noInheritance:true,
    fields:[field],constructors:[ctor],memberCoverage:[{kind:'field',name:'flag',target:fieldId,range:range(34,52),bodyRange:null}]};
  /** @type {any[]} */ const types=[{kind:'scalar',id:bool,name:'bool'},{kind:'unknown',id:unknown},aggregateType,
    {kind:'callable',id:callable,...fnSignature},{kind:'callable',id:ctorType,...ctorSignature}].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const fieldRead={kind:'fieldRead',type:bool,range:range(spec.fieldStart,spec.fieldEnd),
    receiver:{kind:'bindingRead',type:aggregate,binding:parameter,range:range(spec.fieldStart,spec.receiverEnd),presenceFlow:null},
    fieldPath:[fieldId],permission:{readable:true,writable:true,constructorSelf:false,owner:aggregate}};
  const narrowed={kind:'bindingRead',type:bool,binding:caught,range:range(spec.narrowedStart,spec.narrowedEnd),presenceFlow:null};
  const binary={kind:'binary',type:bool,operator:'===',range:range(171,190),
    left:spec.caughtLeft?narrowed:fieldRead,right:spec.caughtLeft?fieldRead:narrowed};
  const condition={kind:'typeTest',type:bool,operator:'===',range:range(133,160),
    operand:{kind:'bindingRead',type:unknown,binding:caught,range:range(139,146),presenceFlow:null},
    tag:'boolean',typeofRange:range(133,146),tagRange:range(150,160),order:'typeof-first'};
  const thenRegion={kind:'region',role:'then',scope:thenScope,parentScope:catchScope,path:thenPath,range:range(161,193),bindings:[],
    body:[{kind:'return',range:range(163,191),value:binary}]};
  const attempt={kind:'try',range:range(91,209),
    tryRegion:{kind:'region',role:'try',scope:tryScope,parentScope:scope,path:tryPath,range:range(95,111),bindings:[],
      body:[{kind:'throw',range:range(97,109),value:{kind:'boolean',type:bool,value:true,range:range(103,108)}}]},
    catchClause:{range:range(111,209),binding:caught,declarationRange:range(119,125),annotationRange:null,
      region:{kind:'region',role:'catch',scope:catchScope,parentScope:scope,path:catchPath,range:range(126,209),
        bindings:[{id:caught,name:'caught',role:'catch',type:unknown,writable:true,range:range(119,125),presence:null}],
        body:[{kind:'if',range:range(129,193),condition,thenRegion,elseRegion:null},
          {kind:'throw',range:range(193,207),value:{kind:'bindingRead',type:unknown,binding:caught,range:range(199,206),presenceFlow:null}}]}},
    finallyRegion:null};
  return {format:{family:'tsfg.exception-hir-candidate',version:2,schemaHash:schema},snapshot:copy(snapshot),inputIdentity:snapshot.inputIdentity,
    sources:[{path:sourcePath,content:spec.source,hash:hash(spec.source),length:211,positionUnit:'utf16'}],target:copy(target),types,
    functions:[{id:functionId,module:moduleId,sourcePath,name:'f',nameRange:range(71,73),range:range(54,211),type:callable,signatureHash,
      lexicalParent:null,declaringScope:moduleScope,parameters:[parameter],parameterInitializers:[null],captures:null,returnPresence:null,
      body:{kind:'region',role:'function',scope,parentScope:null,path:[],range:range(54,211),
        bindings:[{id:parameter,name:'box',role:'parameter',type:aggregate,writable:true,range:range(74,77),presence:parameterPresence()}],body:[attempt]}}],
    modules:[{id:moduleId,sourcePath,external:true,functions:[functionId],aggregateTypes:[aggregate],imports:[],globals:[],initialization:null,closure:null,
      coverage:[{kind:'aggregate',name:'Box',target:aggregate,range:range(7,54),bodyRange:range(32,54)},
        {kind:'function',name:'f',target:functionId,range:range(54,211),bodyRange:range(90,211)}]}],
    exports:[{module:moduleId,sourcePath,external:true,bindings:[{name:'f',target:functionId,sourcePath,range:range(54,211),definition:range(71,73)}]}]};
}
// Test-only structural helpers avoid importing an executable earlier test.
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
/** @param {any} h */
const binaryOf=h=>h.functions[0].body.body[0].catchClause.region.body[0].thenRegion.body[0].value;
test('two actual aggregate field comparisons require complete ordered binary HIR',async t=>{
  for(const spec of specs)await t.test(spec.id+(spec.caughtLeft?'-caught-left':'-field-left'),async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(hash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeLiteralFactsActualPacketAndTenFieldColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>packetPins[spec.id+'/'+name]));assert.equal(spec.source.length,211);assert.equal(Buffer.byteLength(spec.source),213);
      assert.equal(conversions.length,17464);assert.equal(markers.length,360);
      assert.equal(hash(conversions),'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86');
      assert.equal(hash(markers),'sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9');
      assert.equal(spec.source.slice(33,38),' flag');assert.equal(spec.source.slice(46,51),' true');
      assert.equal(spec.source.slice(spec.fieldStart,spec.fieldEnd),'box.flag');
      assert.equal(spec.source.slice(spec.fieldStart,spec.receiverEnd),'box');assert.equal(spec.source.slice(spec.narrowedStart,spec.narrowedEnd),'caught');
      const expected=transport(spec),origin=origins[spec.id];
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire original input from independent Source literals');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire actual packet from manual facts, field layout and exports');
      assert.deepEqual(buffers[2],Buffer.from(jcs(origin)));expectedCold=expected.snapshot;assert.equal(Object.keys(expectedCold).length,10);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;
      assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(copy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(hash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualFieldPermissionOrderTypedClosureAndColdBoundaries',()=>{
      const expected=manualHir(spec,expectedCold),fn=expected.functions[0],agg=aggregateOf(expected),ctor=agg.constructors[0],attempt=fn.body.body[0];
      assert.deepEqual({bool,unknown,aggregate:agg.id,callable:fn.type,signature:fn.signatureHash,ctorType:ctor.type,ctorSignature:ctor.signatureHash,
        module:fn.module,function:fn.id,field:agg.fields[0].id,constructor:ctor.id,scope:fn.body.scope,tryScope:attempt.tryRegion.scope,
        catchScope:attempt.catchClause.region.scope,thenScope:attempt.catchClause.region.body[0].thenRegion.scope,moduleScope:fn.declaringScope,
        parameter:fn.parameters[0],caught:attempt.catchClause.binding},oracle.data(identityPins[spec.id]));
      const caller=copy(snapshot),callerBefore=jcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'complete manual aggregate, field, constructor, five-type closure, regions, coverage and exports');
      assert.equal(result.hir.types.length,5);assert.equal(jcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=jcs(expected)+'\n',cold=copy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);cold.types.reverse();caller.sources[0].content='caller mutation';
      assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(buildHir(copy(snapshot)).hir,expected);
      assert.equal(printHir(readHir(Buffer.from(text))),text);
      if(result.hir.target!==null)assert.match(lowerHir(result.hir),/tsfg_core.exception_program/);else assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(hash),before);
      const readOf=h=>spec.caughtLeft?binaryOf(h).right:binaryOf(h).left;
      const narrowedOf=h=>spec.caughtLeft?binaryOf(h).left:binaryOf(h).right;
      for(const change of [
        h=>{aggregateOf(h).fields[0].initializer.value=false;},
        h=>{aggregateOf(h).fields[0].initializer.range.start++;},
        h=>{aggregateOf(h).fields[0].nameRange.start++;},
        h=>{aggregateOf(h).fields[0].initializer=null;},
        h=>{readOf(h).permission.owner=h.functions[0].id;},
        h=>{readOf(h).permission.writable=false;},
        h=>{readOf(h).fieldPath=[aggregateOf(h).constructors[0].id];},
        h=>{const b=binaryOf(h);[b.left,b.right]=[b.right,b.left];},
        h=>{narrowedOf(h).type=unknown;},
        h=>{h.functions[0].body.bindings[0].presence=null;},
        h=>{h.functions[0].body.body[0].catchClause.region.bindings[0].type=bool;},
        h=>{aggregateOf(h).memberCoverage=[];},
        h=>{aggregateOf(h).constructors[0].type=h.functions[0].type;},
        h=>{h.types=h.types.filter(type=>type.id!==unknown);},
        h=>{h.functions[0].parameterInitializers=null;},
        h=>{h.modules[0].aggregateTypes=[];},
        h=>{h.functions[0].body.body[0].tryRegion.body[0].value.value=false;},
        h=>{readOf(h).receiver.presenceFlow={undefined:false,null:false};},
      ]){
        const bad=copy(expected);change(bad);const original=jcs(bad);
        assert.throws(()=>verifyHir(bad),rejected);assert.throws(()=>printHir(bad),rejected);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected);assert.equal(jcs(bad),original);
      }
    });
  });
});
