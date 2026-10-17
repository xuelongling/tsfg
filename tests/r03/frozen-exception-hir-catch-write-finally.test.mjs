// SPDX-License-Identifier: MIT
// Independent complete catch-write and corpus-origin try/rethrow/finally HIR oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importCapturedFrontendResponse, validateFrontendSnapshot } from '../../compiler/frontend.mjs';
import { buildHir, verifyHir, printHir, readHir, lowerHir } from '../../compiler/hir.mjs';

const root=new URL('../fixtures/r03/m21-exception/corpus/',import.meta.url);
const cwSourcePath='/src/main.ts',cwConversionPath='/src/minimal-conversions-v5.d.ts';
const cwMarkerPath='/src/minimal-aggregates-v1.d.ts',cwIntegerPath='/src/minimal-integers-v3.d.ts';
const cwBridge="sha256:5221b50822965c633418462b28a9b58bfbc41b01e0fa4b6d31c50ab83805424d",cwSchema="sha256:af8317d8403ea2817e1eba2c47e1d4ef38090f7127897204b05e369ec545ddfd";
const cwTarget={"target":"windows-x86_64-msvc","triple":"x86_64-pc-windows-msvc","pointerBits":"64","llvmDataLayout":"e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"};
const cwConversions="// SPDX-License-Identifier: MIT\ninterface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i8: unique symbol;\ndeclare const __tsfg_i16: unique symbol;\ndeclare const __tsfg_i32: unique symbol;\ndeclare const __tsfg_i64: unique symbol;\ndeclare const __tsfg_u8: unique symbol;\ndeclare const __tsfg_u16: unique symbol;\ndeclare const __tsfg_u32: unique symbol;\ndeclare const __tsfg_u64: unique symbol;\ndeclare const __tsfg_isize: unique symbol;\ndeclare const __tsfg_usize: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ntype i16 = number & { readonly [__tsfg_i16]: true };\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype i64 = number & { readonly [__tsfg_i64]: true };\ntype u8 = number & { readonly [__tsfg_u8]: true };\ntype u16 = number & { readonly [__tsfg_u16]: true };\ntype u32 = number & { readonly [__tsfg_u32]: true };\ntype u64 = number & { readonly [__tsfg_u64]: true };\ntype isize = number & { readonly [__tsfg_isize]: true };\ntype usize = number & { readonly [__tsfg_usize]: true };\ntype f64 = number;\ndeclare const __tsfg_f32: unique symbol;\ntype f32 = number & { readonly [__tsfg_f32]: true };\ndeclare function checked_i8_from_i8(value: i8): i8;\ndeclare function checked_i16_from_i8(value: i8): i16;\ndeclare function checked_i32_from_i8(value: i8): i32;\ndeclare function checked_i64_from_i8(value: i8): i64;\ndeclare function checked_u8_from_i8(value: i8): u8;\ndeclare function checked_u16_from_i8(value: i8): u16;\ndeclare function checked_u32_from_i8(value: i8): u32;\ndeclare function checked_u64_from_i8(value: i8): u64;\ndeclare function checked_isize_from_i8(value: i8): isize;\ndeclare function checked_usize_from_i8(value: i8): usize;\ndeclare function checked_f32_from_i8(value: i8): f32;\ndeclare function checked_f64_from_i8(value: i8): f64;\ndeclare function checked_i8_from_i16(value: i16): i8;\ndeclare function checked_i16_from_i16(value: i16): i16;\ndeclare function checked_i32_from_i16(value: i16): i32;\ndeclare function checked_i64_from_i16(value: i16): i64;\ndeclare function checked_u8_from_i16(value: i16): u8;\ndeclare function checked_u16_from_i16(value: i16): u16;\ndeclare function checked_u32_from_i16(value: i16): u32;\ndeclare function checked_u64_from_i16(value: i16): u64;\ndeclare function checked_isize_from_i16(value: i16): isize;\ndeclare function checked_usize_from_i16(value: i16): usize;\ndeclare function checked_f32_from_i16(value: i16): f32;\ndeclare function checked_f64_from_i16(value: i16): f64;\ndeclare function checked_i8_from_i32(value: i32): i8;\ndeclare function checked_i16_from_i32(value: i32): i16;\ndeclare function checked_i32_from_i32(value: i32): i32;\ndeclare function checked_i64_from_i32(value: i32): i64;\ndeclare function checked_u8_from_i32(value: i32): u8;\ndeclare function checked_u16_from_i32(value: i32): u16;\ndeclare function checked_u32_from_i32(value: i32): u32;\ndeclare function checked_u64_from_i32(value: i32): u64;\ndeclare function checked_isize_from_i32(value: i32): isize;\ndeclare function checked_usize_from_i32(value: i32): usize;\ndeclare function checked_f32_from_i32(value: i32): f32;\ndeclare function checked_f64_from_i32(value: i32): f64;\ndeclare function checked_i8_from_i64(value: i64): i8;\ndeclare function checked_i16_from_i64(value: i64): i16;\ndeclare function checked_i32_from_i64(value: i64): i32;\ndeclare function checked_i64_from_i64(value: i64): i64;\ndeclare function checked_u8_from_i64(value: i64): u8;\ndeclare function checked_u16_from_i64(value: i64): u16;\ndeclare function checked_u32_from_i64(value: i64): u32;\ndeclare function checked_u64_from_i64(value: i64): u64;\ndeclare function checked_isize_from_i64(value: i64): isize;\ndeclare function checked_usize_from_i64(value: i64): usize;\ndeclare function checked_f32_from_i64(value: i64): f32;\ndeclare function checked_f64_from_i64(value: i64): f64;\ndeclare function checked_i8_from_u8(value: u8): i8;\ndeclare function checked_i16_from_u8(value: u8): i16;\ndeclare function checked_i32_from_u8(value: u8): i32;\ndeclare function checked_i64_from_u8(value: u8): i64;\ndeclare function checked_u8_from_u8(value: u8): u8;\ndeclare function checked_u16_from_u8(value: u8): u16;\ndeclare function checked_u32_from_u8(value: u8): u32;\ndeclare function checked_u64_from_u8(value: u8): u64;\ndeclare function checked_isize_from_u8(value: u8): isize;\ndeclare function checked_usize_from_u8(value: u8): usize;\ndeclare function checked_f32_from_u8(value: u8): f32;\ndeclare function checked_f64_from_u8(value: u8): f64;\ndeclare function checked_i8_from_u16(value: u16): i8;\ndeclare function checked_i16_from_u16(value: u16): i16;\ndeclare function checked_i32_from_u16(value: u16): i32;\ndeclare function checked_i64_from_u16(value: u16): i64;\ndeclare function checked_u8_from_u16(value: u16): u8;\ndeclare function checked_u16_from_u16(value: u16): u16;\ndeclare function checked_u32_from_u16(value: u16): u32;\ndeclare function checked_u64_from_u16(value: u16): u64;\ndeclare function checked_isize_from_u16(value: u16): isize;\ndeclare function checked_usize_from_u16(value: u16): usize;\ndeclare function checked_f32_from_u16(value: u16): f32;\ndeclare function checked_f64_from_u16(value: u16): f64;\ndeclare function checked_i8_from_u32(value: u32): i8;\ndeclare function checked_i16_from_u32(value: u32): i16;\ndeclare function checked_i32_from_u32(value: u32): i32;\ndeclare function checked_i64_from_u32(value: u32): i64;\ndeclare function checked_u8_from_u32(value: u32): u8;\ndeclare function checked_u16_from_u32(value: u32): u16;\ndeclare function checked_u32_from_u32(value: u32): u32;\ndeclare function checked_u64_from_u32(value: u32): u64;\ndeclare function checked_isize_from_u32(value: u32): isize;\ndeclare function checked_usize_from_u32(value: u32): usize;\ndeclare function checked_f32_from_u32(value: u32): f32;\ndeclare function checked_f64_from_u32(value: u32): f64;\ndeclare function checked_i8_from_u64(value: u64): i8;\ndeclare function checked_i16_from_u64(value: u64): i16;\ndeclare function checked_i32_from_u64(value: u64): i32;\ndeclare function checked_i64_from_u64(value: u64): i64;\ndeclare function checked_u8_from_u64(value: u64): u8;\ndeclare function checked_u16_from_u64(value: u64): u16;\ndeclare function checked_u32_from_u64(value: u64): u32;\ndeclare function checked_u64_from_u64(value: u64): u64;\ndeclare function checked_isize_from_u64(value: u64): isize;\ndeclare function checked_usize_from_u64(value: u64): usize;\ndeclare function checked_f32_from_u64(value: u64): f32;\ndeclare function checked_f64_from_u64(value: u64): f64;\ndeclare function checked_i8_from_isize(value: isize): i8;\ndeclare function checked_i16_from_isize(value: isize): i16;\ndeclare function checked_i32_from_isize(value: isize): i32;\ndeclare function checked_i64_from_isize(value: isize): i64;\ndeclare function checked_u8_from_isize(value: isize): u8;\ndeclare function checked_u16_from_isize(value: isize): u16;\ndeclare function checked_u32_from_isize(value: isize): u32;\ndeclare function checked_u64_from_isize(value: isize): u64;\ndeclare function checked_isize_from_isize(value: isize): isize;\ndeclare function checked_usize_from_isize(value: isize): usize;\ndeclare function checked_f32_from_isize(value: isize): f32;\ndeclare function checked_f64_from_isize(value: isize): f64;\ndeclare function checked_i8_from_usize(value: usize): i8;\ndeclare function checked_i16_from_usize(value: usize): i16;\ndeclare function checked_i32_from_usize(value: usize): i32;\ndeclare function checked_i64_from_usize(value: usize): i64;\ndeclare function checked_u8_from_usize(value: usize): u8;\ndeclare function checked_u16_from_usize(value: usize): u16;\ndeclare function checked_u32_from_usize(value: usize): u32;\ndeclare function checked_u64_from_usize(value: usize): u64;\ndeclare function checked_isize_from_usize(value: usize): isize;\ndeclare function checked_usize_from_usize(value: usize): usize;\ndeclare function checked_f32_from_usize(value: usize): f32;\ndeclare function checked_f64_from_usize(value: usize): f64;\ndeclare function checked_i8_from_f32(value: f32): i8;\ndeclare function checked_i16_from_f32(value: f32): i16;\ndeclare function checked_i32_from_f32(value: f32): i32;\ndeclare function checked_i64_from_f32(value: f32): i64;\ndeclare function checked_u8_from_f32(value: f32): u8;\ndeclare function checked_u16_from_f32(value: f32): u16;\ndeclare function checked_u32_from_f32(value: f32): u32;\ndeclare function checked_u64_from_f32(value: f32): u64;\ndeclare function checked_isize_from_f32(value: f32): isize;\ndeclare function checked_usize_from_f32(value: f32): usize;\ndeclare function checked_f32_from_f32(value: f32): f32;\ndeclare function checked_f64_from_f32(value: f32): f64;\ndeclare function checked_i8_from_f64(value: f64): i8;\ndeclare function checked_i16_from_f64(value: f64): i16;\ndeclare function checked_i32_from_f64(value: f64): i32;\ndeclare function checked_i64_from_f64(value: f64): i64;\ndeclare function checked_u8_from_f64(value: f64): u8;\ndeclare function checked_u16_from_f64(value: f64): u16;\ndeclare function checked_u32_from_f64(value: f64): u32;\ndeclare function checked_u64_from_f64(value: f64): u64;\ndeclare function checked_isize_from_f64(value: f64): isize;\ndeclare function checked_usize_from_f64(value: f64): usize;\ndeclare function checked_f32_from_f64(value: f64): f32;\ndeclare function checked_f64_from_f64(value: f64): f64;\ndeclare function wrap_i8_from_i8(value: i8): i8;\ndeclare function wrap_i16_from_i8(value: i8): i16;\ndeclare function wrap_i32_from_i8(value: i8): i32;\ndeclare function wrap_i64_from_i8(value: i8): i64;\ndeclare function wrap_u8_from_i8(value: i8): u8;\ndeclare function wrap_u16_from_i8(value: i8): u16;\ndeclare function wrap_u32_from_i8(value: i8): u32;\ndeclare function wrap_u64_from_i8(value: i8): u64;\ndeclare function wrap_isize_from_i8(value: i8): isize;\ndeclare function wrap_usize_from_i8(value: i8): usize;\ndeclare function wrap_i8_from_i16(value: i16): i8;\ndeclare function wrap_i16_from_i16(value: i16): i16;\ndeclare function wrap_i32_from_i16(value: i16): i32;\ndeclare function wrap_i64_from_i16(value: i16): i64;\ndeclare function wrap_u8_from_i16(value: i16): u8;\ndeclare function wrap_u16_from_i16(value: i16): u16;\ndeclare function wrap_u32_from_i16(value: i16): u32;\ndeclare function wrap_u64_from_i16(value: i16): u64;\ndeclare function wrap_isize_from_i16(value: i16): isize;\ndeclare function wrap_usize_from_i16(value: i16): usize;\ndeclare function wrap_i8_from_i32(value: i32): i8;\ndeclare function wrap_i16_from_i32(value: i32): i16;\ndeclare function wrap_i32_from_i32(value: i32): i32;\ndeclare function wrap_i64_from_i32(value: i32): i64;\ndeclare function wrap_u8_from_i32(value: i32): u8;\ndeclare function wrap_u16_from_i32(value: i32): u16;\ndeclare function wrap_u32_from_i32(value: i32): u32;\ndeclare function wrap_u64_from_i32(value: i32): u64;\ndeclare function wrap_isize_from_i32(value: i32): isize;\ndeclare function wrap_usize_from_i32(value: i32): usize;\ndeclare function wrap_i8_from_i64(value: i64): i8;\ndeclare function wrap_i16_from_i64(value: i64): i16;\ndeclare function wrap_i32_from_i64(value: i64): i32;\ndeclare function wrap_i64_from_i64(value: i64): i64;\ndeclare function wrap_u8_from_i64(value: i64): u8;\ndeclare function wrap_u16_from_i64(value: i64): u16;\ndeclare function wrap_u32_from_i64(value: i64): u32;\ndeclare function wrap_u64_from_i64(value: i64): u64;\ndeclare function wrap_isize_from_i64(value: i64): isize;\ndeclare function wrap_usize_from_i64(value: i64): usize;\ndeclare function wrap_i8_from_u8(value: u8): i8;\ndeclare function wrap_i16_from_u8(value: u8): i16;\ndeclare function wrap_i32_from_u8(value: u8): i32;\ndeclare function wrap_i64_from_u8(value: u8): i64;\ndeclare function wrap_u8_from_u8(value: u8): u8;\ndeclare function wrap_u16_from_u8(value: u8): u16;\ndeclare function wrap_u32_from_u8(value: u8): u32;\ndeclare function wrap_u64_from_u8(value: u8): u64;\ndeclare function wrap_isize_from_u8(value: u8): isize;\ndeclare function wrap_usize_from_u8(value: u8): usize;\ndeclare function wrap_i8_from_u16(value: u16): i8;\ndeclare function wrap_i16_from_u16(value: u16): i16;\ndeclare function wrap_i32_from_u16(value: u16): i32;\ndeclare function wrap_i64_from_u16(value: u16): i64;\ndeclare function wrap_u8_from_u16(value: u16): u8;\ndeclare function wrap_u16_from_u16(value: u16): u16;\ndeclare function wrap_u32_from_u16(value: u16): u32;\ndeclare function wrap_u64_from_u16(value: u16): u64;\ndeclare function wrap_isize_from_u16(value: u16): isize;\ndeclare function wrap_usize_from_u16(value: u16): usize;\ndeclare function wrap_i8_from_u32(value: u32): i8;\ndeclare function wrap_i16_from_u32(value: u32): i16;\ndeclare function wrap_i32_from_u32(value: u32): i32;\ndeclare function wrap_i64_from_u32(value: u32): i64;\ndeclare function wrap_u8_from_u32(value: u32): u8;\ndeclare function wrap_u16_from_u32(value: u32): u16;\ndeclare function wrap_u32_from_u32(value: u32): u32;\ndeclare function wrap_u64_from_u32(value: u32): u64;\ndeclare function wrap_isize_from_u32(value: u32): isize;\ndeclare function wrap_usize_from_u32(value: u32): usize;\ndeclare function wrap_i8_from_u64(value: u64): i8;\ndeclare function wrap_i16_from_u64(value: u64): i16;\ndeclare function wrap_i32_from_u64(value: u64): i32;\ndeclare function wrap_i64_from_u64(value: u64): i64;\ndeclare function wrap_u8_from_u64(value: u64): u8;\ndeclare function wrap_u16_from_u64(value: u64): u16;\ndeclare function wrap_u32_from_u64(value: u64): u32;\ndeclare function wrap_u64_from_u64(value: u64): u64;\ndeclare function wrap_isize_from_u64(value: u64): isize;\ndeclare function wrap_usize_from_u64(value: u64): usize;\ndeclare function wrap_i8_from_isize(value: isize): i8;\ndeclare function wrap_i16_from_isize(value: isize): i16;\ndeclare function wrap_i32_from_isize(value: isize): i32;\ndeclare function wrap_i64_from_isize(value: isize): i64;\ndeclare function wrap_u8_from_isize(value: isize): u8;\ndeclare function wrap_u16_from_isize(value: isize): u16;\ndeclare function wrap_u32_from_isize(value: isize): u32;\ndeclare function wrap_u64_from_isize(value: isize): u64;\ndeclare function wrap_isize_from_isize(value: isize): isize;\ndeclare function wrap_usize_from_isize(value: isize): usize;\ndeclare function wrap_i8_from_usize(value: usize): i8;\ndeclare function wrap_i16_from_usize(value: usize): i16;\ndeclare function wrap_i32_from_usize(value: usize): i32;\ndeclare function wrap_i64_from_usize(value: usize): i64;\ndeclare function wrap_u8_from_usize(value: usize): u8;\ndeclare function wrap_u16_from_usize(value: usize): u16;\ndeclare function wrap_u32_from_usize(value: usize): u32;\ndeclare function wrap_u64_from_usize(value: usize): u64;\ndeclare function wrap_isize_from_usize(value: usize): isize;\ndeclare function wrap_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_i8_from_i8(value: i8): i8;\ndeclare function reinterpret_u8_from_i8(value: i8): u8;\ndeclare function reinterpret_i16_from_i16(value: i16): i16;\ndeclare function reinterpret_u16_from_i16(value: i16): u16;\ndeclare function reinterpret_i32_from_i32(value: i32): i32;\ndeclare function reinterpret_u32_from_i32(value: i32): u32;\ndeclare function reinterpret_f32_from_i32(value: i32): f32;\ndeclare function reinterpret_i64_from_i64(value: i64): i64;\ndeclare function reinterpret_u64_from_i64(value: i64): u64;\ndeclare function reinterpret_isize_from_i64(value: i64): isize;\ndeclare function reinterpret_usize_from_i64(value: i64): usize;\ndeclare function reinterpret_f64_from_i64(value: i64): f64;\ndeclare function reinterpret_i8_from_u8(value: u8): i8;\ndeclare function reinterpret_u8_from_u8(value: u8): u8;\ndeclare function reinterpret_i16_from_u16(value: u16): i16;\ndeclare function reinterpret_u16_from_u16(value: u16): u16;\ndeclare function reinterpret_i32_from_u32(value: u32): i32;\ndeclare function reinterpret_u32_from_u32(value: u32): u32;\ndeclare function reinterpret_f32_from_u32(value: u32): f32;\ndeclare function reinterpret_i64_from_u64(value: u64): i64;\ndeclare function reinterpret_u64_from_u64(value: u64): u64;\ndeclare function reinterpret_isize_from_u64(value: u64): isize;\ndeclare function reinterpret_usize_from_u64(value: u64): usize;\ndeclare function reinterpret_f64_from_u64(value: u64): f64;\ndeclare function reinterpret_i64_from_isize(value: isize): i64;\ndeclare function reinterpret_u64_from_isize(value: isize): u64;\ndeclare function reinterpret_isize_from_isize(value: isize): isize;\ndeclare function reinterpret_usize_from_isize(value: isize): usize;\ndeclare function reinterpret_f64_from_isize(value: isize): f64;\ndeclare function reinterpret_i64_from_usize(value: usize): i64;\ndeclare function reinterpret_u64_from_usize(value: usize): u64;\ndeclare function reinterpret_isize_from_usize(value: usize): isize;\ndeclare function reinterpret_usize_from_usize(value: usize): usize;\ndeclare function reinterpret_f64_from_usize(value: usize): f64;\ndeclare function reinterpret_i32_from_f32(value: f32): i32;\ndeclare function reinterpret_u32_from_f32(value: f32): u32;\ndeclare function reinterpret_f32_from_f32(value: f32): f32;\ndeclare function reinterpret_i64_from_f64(value: f64): i64;\ndeclare function reinterpret_u64_from_f64(value: f64): u64;\ndeclare function reinterpret_isize_from_f64(value: f64): isize;\ndeclare function reinterpret_usize_from_f64(value: f64): usize;\ndeclare function reinterpret_f64_from_f64(value: f64): f64;\n";
const cwMarkers="// SPDX-License-Identifier: MIT\ninterface ClassDecoratorContext<C> {\n  readonly kind: \"class\";\n  readonly name: string | undefined;\n  addInitializer(initializer: (this: C) => void): void;\n}\ndeclare function tsfgValue<C>(target: C, context: ClassDecoratorContext<C>): void;\ndeclare function tsfgComponent<C>(target: C, context: ClassDecoratorContext<C>): void;\n";
const cwIntegers="interface Object {}\ninterface Function {}\ninterface CallableFunction {}\ninterface NewableFunction {}\ninterface IArguments {}\ninterface String {}\ninterface Number {}\ninterface Boolean {}\ninterface RegExp {}\ninterface Array<T> {}\ntype bool = boolean;\ndeclare const __tsfg_i32: unique symbol;\ntype i32 = number & { readonly [__tsfg_i32]: true };\ntype f64 = number;\ndeclare const __tsfg_i8: unique symbol;\ntype i8 = number & { readonly [__tsfg_i8]: true };\ndeclare const __tsfg_i16: unique symbol;\ntype i16 = number & { readonly [__tsfg_i16]: true };\ndeclare const __tsfg_i64: unique symbol;\ntype i64 = number & { readonly [__tsfg_i64]: true };\ndeclare const __tsfg_u8: unique symbol;\ntype u8 = number & { readonly [__tsfg_u8]: true };\ndeclare const __tsfg_u16: unique symbol;\ntype u16 = number & { readonly [__tsfg_u16]: true };\ndeclare const __tsfg_u32: unique symbol;\ntype u32 = number & { readonly [__tsfg_u32]: true };\ndeclare const __tsfg_u64: unique symbol;\ntype u64 = number & { readonly [__tsfg_u64]: true };\ndeclare const __tsfg_isize: unique symbol;\ntype isize = number & { readonly [__tsfg_isize]: true };\ndeclare const __tsfg_usize: unique symbol;\ntype usize = number & { readonly [__tsfg_usize]: true };\n";
const cwSpecs=[{"id":"29","source":"// 😀\r\n@tsfgValue class Pair {}\r\nexport function entry(value: i32): i32 { try { throw value; } catch (caught) { throw (caught = new Pair()); } }","end":144,"start":31,"nameStart":48,"nameEnd":54,"paramStart":55,"paramEnd":60,"annotationStart":62,"annotationEnd":65,"catchStart":102,"catchEnd":108},{"id":"30","source":"// 😀\r\nexport function entry(value: i32): i32 {\r\n  try {\r\n    throw value;\r\n  } catch (caught) {\r\n    throw caught;\r\n  } finally {\r\n    const copied: i32 = value;\r\n  }\r\n}","end":170,"start":0,"nameStart":22,"nameEnd":28,"paramStart":29,"paramEnd":34,"annotationStart":36,"annotationEnd":39,"catchStart":87,"catchEnd":93}];
const cwOrigins={"29":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:0fb8396df00eaec7695c87f3134bc927ef4fd88d54145d0e78eb4c0b478acc10","responseSha256":"sha256:ca5769ed8df7dbc9691126a08a1cf2f96b4f59381fab4331b26c7fbf402509ce","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"},"30":{"kind":"owned-go-exception-response","producerBaseOid":"e158ea23bf3020379bd152ba3ef58ed89c199305","producerDirty":true,"requestSha256":"sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed","responseSha256":"sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a","testedInputSetHash":"sha256:8d0bfd358a2d40042ecd8842aec30bbbac77b6ec91289c4a707bdda9490c262d"}};
const cwPacketPins={"29/request.json":"sha256:0fb8396df00eaec7695c87f3134bc927ef4fd88d54145d0e78eb4c0b478acc10","29/origin.json":"sha256:a035a036e4c2b6aa09e032eeaca94dcffc3e05e9e8594a670e669cfb36427f60","29/response.json":"sha256:ca5769ed8df7dbc9691126a08a1cf2f96b4f59381fab4331b26c7fbf402509ce","30/request.json":"sha256:8b081a06e3853bf8557206f3aafac4f8211622a224899a363c7c63bb34a030ed","30/origin.json":"sha256:995466146b5367ec0dd72147fabf6ed8602203282be53690941910cf4eb23591","30/response.json":"sha256:45317ccc970c8464d90cba8da674aea3da5756fbb39a7ba5dfc3326fad2d1a5a"};
const cwIdentityPins={"29":{"scalar":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","module":"sha256:8e5679c8453c2d00abc5b4568cead1e2d78cc8df054d14f98dc805737c452ff8","function":"sha256:9f0b8040273b0ccbe90aee2a364dc2583ec3d5aa6df715a20a2c7b076fdd1232","moduleScope":"sha256:123affa3a547987bc45ce1f9b632669667dca6adae969d4d9dadbc86db13600a","scope":"sha256:e74c53361ee57decbb67dae9ca66b12b23009fc35fd9955337f7491017dd4958","tryScope":"sha256:01a9dde3bcbf3ff6bcd4986e2d30f4d98e8ee040e163c6e9733d43ee519e3677","catchScope":"sha256:3ed2749232ad4c6b28fd4f11048cf2d73d6f50614282cd3a0f21fb5d6a074acb","parameter":"sha256:b3a95cba94ccab53ecba6b215cfc9fb12a6721ce3eee2579fc4aa4d4a3a4c95f","caught":"sha256:83c05239dc663a4bc66a278049bedcd9498c2a3e863b9161c0c243f318d0f6dd","aggregate":"sha256:ba5902e8fe09c9e4f051491a335d2b91aafcf06e6017b41673fef6e79a49df96","ctorSignature":"sha256:9750935ce46c535747f8b11c3285f547b8a40f0c70b18392e83d48a54bc2f42c","ctorType":"sha256:2b52edfb70f93fad6ef7e984cb8a795cf4bbec64fe3a5b15c5e00a95f79fdfef","constructor":"sha256:23e7616c4cfc10c1b8300bb92717552bdf3563209311812095b50387c49761ef"},"30":{"scalar":"sha256:a499279eb079e9a530729c0e20165237b946527f01f48d1426b927e2c2e7d727","unknown":"sha256:05a0814cb6ff31904cd0eb7cbbe918917490ad0f7346724ed5c273adea7e156d","callable":"sha256:2ec4c41cb3e328de498b4edd52b7ec19a4256ff082d376ee6029ab89844459cf","signature":"sha256:18bbe4b33254c214ed9b1b09ae8fa9808ce556581275c649eb7199f06f78c110","module":"sha256:3eb938ec9f84c7a44fc7d3fb49d5b4334d6e817d7158189b6e7c61e3b4bb1496","function":"sha256:14b050eba7e9567480e4d98ef41531788066045950728bbbfc4b729aac7d0a51","moduleScope":"sha256:ff6f9e379159eacb4f30b3130f68b3a56c60b36747b6141e0eee776663ce876f","scope":"sha256:1482a3075da20c77eb41a43cee20adec8caf0b68aef3d6a70ebf78343b1868bc","tryScope":"sha256:c3110a6e0cbe1bce357a99e5f4b18b9c09523996d9dd3287f9d879daf785dc41","catchScope":"sha256:cefefea64b63cafbe07c3368a0e5a4b6159ba04e4566c5f1ba7f0e8c0af95872","parameter":"sha256:3d99752ce6039f386e0c540289998a52cb7d1171331625f700b3f11638523807","caught":"sha256:96ce5330338a1ac46dd905ad97b724fa67440c6944f01aa632a883b4d40587a4","finallyScope":"sha256:cbaf316039bb19b054d76fe1ee70de330a0449b45b6a90796cd58e412e405379","copied":"sha256:b24e2590264d622697a59d028cf05625b1d3a2c6e879456f779b66a51952ee59"}};
const cwHirPins={"29":{"bytes":57049,"sha256":"sha256:af161797a176ff44ce901873886784b6fc4cba018477313b13363b67aaf0889d"},"30":{"bytes":17119,"sha256":"sha256:832e2794fa688d0709defecc31412c57e9293ab1a80cff2ce478635a71c5fd39"}};
const cwSnapshotPins={"29":{"inputIdentity":"sha256:cf3b830f90c2e610642932403164aea30c0024c37235d2c038496a074e0cf664","snapshotId":"sha256:0059550b56fdc2b9d6a789ff0203b10e2cee279d827d31088885463b4f6cf86c","requestId":"sha256:095cf660e3d994844c55e090e173f14904b302647bba06b312eb44b74f87db80","packageId":"sha256:0b832bbd0c3c981187c68265bd6a76f8ff40e1cb6100a43689fcdcd2e0b35939"},"30":{"inputIdentity":"sha256:565aea5c00696d58e2afd0713f90a37d927dfd28f0daa1abefaa3c23bbf5ea55","snapshotId":"sha256:105942c28e6796fe11af1409fb71e3cf9ff631a86df3c18fd7dfb5ee86c598d0","requestId":"sha256:908d6590e7fcb04428fd14d5455b01232cff5d57032f5537307f35e78cc750d8","packageId":"sha256:747d29f928cfe7526d39ef5ce7318e9a539ff4aef12a6bec2f4eb03c701982e3"}};
const cwHash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const cwCopy=value=>JSON.parse(JSON.stringify(value)),cwRange=(start,end)=>({start,end});
/** @param {any} value @returns {string} */
function cwJcs(value) {
  if(Array.isArray(value))return '['+value.map(cwJcs).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+cwJcs(value[k])).join(',')+'}';
  if(typeof value==='string')assert.ok(value.isWellFormed());
  if(typeof value==='number')assert.ok(Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0));
  return JSON.stringify(value)??assert.fail('non-JSON oracle');
}
const cwEntity=(kind,record)=>cwHash('tsfg.exception-hir-candidate.'+kind+'.v1\0'+cwSchema+'\0'+cwJcs(record));
/** @param {any} spec */
function cwPresence(spec){return {undefined:false,null:false,optional:false,default:false,range:cwRange(spec.paramStart,spec.annotationEnd),annotation:cwRange(spec.annotationStart,spec.annotationEnd)};
  }
// The actual pinned marker declaration, not a synthetic marker identity.
function cwMarkerOrigin(){var digest=cwHash(cwMarkers);
  return {contextArity:1,contextName:'ClassDecoratorContext',declarationPath:cwMarkerPath,declarationRange:cwRange(190,272),declarationSha256:digest,entryId:cwHash('tsfg.marker\0minimal-aggregates-v1\0value\0'+digest),mode:'standard',range:cwRange(7,17),version:'minimal-aggregates-v1'};
  }
// One nominal declaration in this value-family case.
function cwNominalKey(){return {sourcePath:cwSourcePath,declarationPath:['Pair'],
    category:'value'};
  }
/** @param {any} spec @returns {any} */
function cwSourceFacts(spec){var agg=spec.id==='29',param={id:agg?'s3':'s2',kind:'parameter',name:'value',type:'i32',writable:true,range:cwRange(spec.paramStart,spec.paramEnd),presence:cwPresence(spec)},
    caught={id:agg?'s4':'s3',kind:'local',name:'caught',type:'unknown',writable:true,range:cwRange(spec.catchStart,spec.catchEnd)},
    fnSymbol={id:agg?'s2':'s1',kind:'function',name:'entry',type:'i32',writable:false,range:cwRange(spec.nameStart,spec.nameEnd)},
    fn={name:'entry',symbol:fnSymbol.id,parameters:[cwCopy(param)],
    returnType:'i32',parameterInitializers:[null],
    range:cwRange(spec.start,spec.end),body:[]};
  var symbols=[fnSymbol,param,caught];
  if(agg){symbols.unshift({id:'s1',kind:'class',name:'Pair',type:'a1',writable:false,range:cwRange(23,28)});
  fn.body=[{kind:'try',range:cwRange(73,142),exception:{tryBlock:{range:cwRange(77,94),body:[{kind:'throw',range:cwRange(79,92),expression:{kind:'reference',type:'i32',symbol:'s3',range:cwRange(85,91)}}]},
    catchClause:{binding:cwCopy(caught),declarationRange:cwRange(102,108),range:cwRange(94,142),block:{range:cwRange(109,142),body:[{kind:'throw',range:cwRange(111,140),expression:{kind:'group',type:'a1',range:cwRange(118,139),operand:{kind:'write',type:'a1',operator:'=',range:cwRange(119,138),left:{kind:'reference',type:'unknown',symbol:'s4',range:cwRange(119,125)},
    right:{kind:'construct',type:'a1',target:'c1',arguments:[],
    signature:{parameters:[],
    returnType:'a1'},
    range:cwRange(128,138)}}}}]}}}}];
  var ctor={id:'c1',kind:'implicitDefault',classRef:'a1',signatureDeclaration:null,implementation:null,parameters:[],
    signature:{parameters:[],
    returnType:'a1'},
    resultType:'a1',body:[],
    parameterInitializers:[],
    range:cwRange(7,31),bodyRange:null};
  var declaration={id:'a1',name:'Pair',symbol:'s1',category:'value',nominalKey:cwNominalKey(),markerOrigin:cwMarkerOrigin(),instanceType:'a1',constructorType:'constructor:a1',fields:[],
    constructors:[ctor],
    memberCoverage:[],
    range:cwRange(7,31),bodyRange:cwRange(29,31),noInheritance:true};
  return {status:'ok',inputs:[cwSourcePath,cwMarkerPath,cwConversionPath],
    symbols,functions:[fn],
    aggregateFacts:{profile:'minimal-aggregates-v1',declarations:[declaration],
    sourceCoverage:[{kind:'class',name:'Pair',symbol:'s1',range:cwRange(7,31),bodyRange:cwRange(29,31)},
    {kind:'function',name:'entry',symbol:'s2',range:cwRange(31,144),bodyRange:cwRange(72,144)}]}};
  }var copied={id:'s4',kind:'local',name:'copied',type:'i32',writable:false,range:cwRange(141,148)};
  symbols.push(copied);
  fn.body=[{kind:'try',range:cwRange(47,167),exception:{tryBlock:{range:cwRange(54,79),body:[{kind:'throw',range:cwRange(56,74),expression:{kind:'reference',type:'i32',symbol:'s2',range:cwRange(67,73)}}]},
    catchClause:{binding:cwCopy(caught),declarationRange:cwRange(87,93),range:cwRange(79,120),block:{range:cwRange(94,120),body:[{kind:'throw',range:cwRange(96,115),expression:{kind:'reference',type:'unknown',symbol:'s3',range:cwRange(107,114)}}]}},
    finallyBlock:{range:cwRange(128,167),body:[{kind:'variable',symbol:cwCopy(copied),range:cwRange(141,161),initializer:{kind:'reference',type:'i32',symbol:'s2',range:cwRange(155,161)}}]}}}];
  return {status:'ok',inputs:[cwSourcePath,cwIntegerPath],
    symbols,functions:[fn]};
  }
/** @param {any} spec @returns {any} */
function cwTransport(spec){var agg=spec.id==='29',input=agg?{sourceRoot:'/src',rootFile:cwSourcePath,files:[{path:cwSourcePath,content:spec.source},
    {path:cwConversionPath,content:cwConversions},
    {path:cwMarkerPath,content:cwMarkers}],
    config:{allowJs:false,decoratorMode:'standard',noEmit:true,strict:true},
    declarations:{version:'minimal-conversions-v5',paths:[cwConversionPath,cwMarkerPath],
    markerProfile:{contextArity:1,contextName:'ClassDecoratorContext',entries:[{category:'value',name:'tsfgValue'},
    {category:'component',name:'tsfgComponent'}],
    mode:'standard',path:cwMarkerPath,sha256:cwHash(cwMarkers),version:'minimal-aggregates-v1'}},
    target:cwCopy(cwTarget)}:{sourceRoot:'/src',rootFile:cwSourcePath,files:[{path:cwSourcePath,content:spec.source},
    {path:cwIntegerPath,content:cwIntegers}],
    config:{allowJs:false,noEmit:true,strict:true},
    declarations:{version:'minimal-integers-v3',paths:[cwIntegerPath]},
    target:cwCopy(cwTarget)};
  var identityInput=cwCopy(input);
  identityInput.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  var inputIdentity=cwHash(cwJcs(identityInput)),facts=cwSourceFacts(spec),exports=[{sourcePath:cwSourcePath,external:true,bindings:[{name:'entry',target:agg?'s2':'s1',sourcePath:cwSourcePath,range:cwRange(spec.start,spec.end),definition:cwRange(spec.nameStart,spec.nameEnd)}]}];
  var payload={inputIdentity,files:identityInput.files.map(file=>({path:file.path,digest:cwHash(file.content),byteLength:Buffer.byteLength(file.content),length:file.content.length,positionUnit:'utf16'})),facts,exports};
  var request={family:'tsfg.exception-facts-request-candidate',version:1,schemaHash:cwBridge,input},
    requestText=cwJcs(request);
  var response={family:'tsfg.exception-facts-package-candidate',version:1,schemaHash:cwBridge,requestId:cwHash('tsfg.exception-facts.request.v1\0'+requestText),packageId:cwHash('tsfg.exception-facts.package.v1\0'+cwBridge+'\0'+cwJcs(payload)),payload},
    responseText=cwJcs(response),sourceOrigin=cwCopy(cwOrigins[spec.id]);
  var snapshot={format:{family:'tsfg.frontend-exception-candidate',version:1,schemaHash:cwBridge},
    snapshotId:cwHash('tsfg.frontend-exception-candidate.snapshot.v1\0'+cwBridge+'\0'+cwJcs({inputIdentity,sourceOrigin})),sourceOrigin,inputIdentity,identityInput,sources:[{path:cwSourcePath,content:spec.source,hash:cwHash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:cwCopy(cwTarget),facts:cwCopy(facts),exports:cwCopy(exports),capture:{request:requestText,response:responseText}};
  return {requestText,responseText,snapshot};
  }
/** @param {any} spec @returns {any} */
function cwIds(spec){var source={path:cwSourcePath,digest:cwHash(spec.source)},
    scalar=cwHash('tsfg.type\0i32'),unknown=cwEntity('type',{kind:'unknown'}),signature=cwEntity('signature',{parameters:[scalar],
    returnType:scalar}),callable=cwEntity('type',{kind:'callable',parameters:[scalar],
    returnType:scalar}),module=cwEntity('module',{source,external:true}),fn=cwEntity('function',{module,parent:null,declaringScopePath:[],
    name:'entry',signatureHash:signature,range:cwRange(spec.start,spec.end)}),scope=cwEntity('scope',{ownerKind:'function',owner:fn,path:[]}),moduleScope=cwEntity('scope',{ownerKind:'module',owner:module,path:[]}),tryScope=cwEntity('scope',{ownerKind:'function',owner:fn,path:[{statement:0,slot:'try'}]}),catchScope=cwEntity('scope',{ownerKind:'function',owner:fn,path:[{statement:0,slot:'catch'}]}),parameter=cwEntity('binding',{ownerKind:'function',owner:fn,scopePath:[],
    role:'parameter',index:0}),caught=cwEntity('binding',{ownerKind:'function',owner:fn,scopePath:[{statement:0,slot:'catch'}],
    role:'catch',index:0});
  var ids={scalar,unknown,callable,signature,module,function:fn,moduleScope,scope,tryScope,catchScope,parameter,caught};
  if(spec.id==='29'){var aggregate=cwEntity('type',{kind:'aggregate',source,category:'value',declarationPath:['Pair']}),ctorSignature=cwEntity('signature',{parameters:[],
    returnType:aggregate}),ctorType=cwEntity('type',{kind:'callable',parameters:[],
    returnType:aggregate}),constructor=cwEntity('constructor',{owner:aggregate,ordinal:0,signatureHash:ctorSignature});
  Object.assign(ids,{aggregate,ctorSignature,ctorType,constructor});
  }else Object.assign(ids,{finallyScope:cwEntity('scope',{ownerKind:'function',owner:fn,path:[{statement:0,slot:'finally'}]}),copied:cwEntity('binding',{ownerKind:'function',owner:fn,scopePath:[{statement:0,slot:'finally'}],
    role:'local',index:0})});
  return ids;
  }
/** @param {any} spec @param {any} snapshot @returns {any} */
function cwManualHir(spec,snapshot){var ids=cwIds(spec),agg=spec.id==='29',param={id:ids.parameter,name:'value',role:'parameter',type:ids.scalar,writable:true,range:cwRange(spec.paramStart,spec.paramEnd),presence:cwPresence(spec)},
    caught={id:ids.caught,name:'caught',role:'catch',type:ids.unknown,writable:true,range:cwRange(spec.catchStart,spec.catchEnd),presence:null};
  var root={kind:'region',role:'function',scope:ids.scope,parentScope:null,path:[],
    range:cwRange(spec.start,spec.end),bindings:[param],
    body:[]},
    tryRegion={kind:'region',role:'try',scope:ids.tryScope,parentScope:ids.scope,path:[{statement:0,slot:'try'}],
    range:agg?cwRange(77,94):cwRange(54,79),bindings:[],
    body:[{kind:'throw',range:agg?cwRange(79,92):cwRange(56,74),value:{kind:'bindingRead',type:ids.scalar,range:agg?cwRange(85,91):cwRange(67,73),binding:ids.parameter,presenceFlow:null}}]},
    catchRegion={kind:'region',role:'catch',scope:ids.catchScope,parentScope:ids.scope,path:[{statement:0,slot:'catch'}],
    range:agg?cwRange(109,142):cwRange(94,120),bindings:[caught],
    body:[]};
  var attempt={kind:'try',range:agg?cwRange(73,142):cwRange(47,167),tryRegion,catchClause:{range:agg?cwRange(94,142):cwRange(79,120),binding:ids.caught,declarationRange:cwRange(spec.catchStart,spec.catchEnd),annotationRange:null,region:catchRegion},
    finallyRegion:null};
  /** @type {any[]} */ var types=[{kind:'scalar',id:ids.scalar,name:'i32'},
    {kind:'unknown',id:ids.unknown},
    {kind:'callable',id:ids.callable,parameters:[ids.scalar],
    returnType:ids.scalar}],
    coverage=null,aggregateTypes=[];
  if(agg){var ctor={kind:'implicitDefault',id:ids.constructor,owner:ids.aggregate,ordinal:0,type:ids.ctorType,signatureHash:ids.ctorSignature,signatureDeclaration:null,implementation:null,parameters:[],
    parameterInitializers:[],
    body:[],
    range:cwRange(7,31),bodyRange:null},
    declaration={kind:'aggregate',id:ids.aggregate,category:'value',name:'Pair',sourcePath:cwSourcePath,nameRange:cwRange(23,28),range:cwRange(7,31),bodyRange:cwRange(29,31),nominalKey:cwNominalKey(),markerOrigin:cwMarkerOrigin(),noInheritance:true,fields:[],
    constructors:[ctor],
    memberCoverage:[]};
  types.push(declaration,{kind:'callable',id:ids.ctorType,parameters:[],
    returnType:ids.aggregate});
  aggregateTypes=[ids.aggregate];
  coverage=[{kind:'aggregate',name:'Pair',target:ids.aggregate,range:cwRange(7,31),bodyRange:cwRange(29,31)},
    {kind:'function',name:'entry',target:ids.function,range:cwRange(31,144),bodyRange:cwRange(72,144)}];
  var construct={kind:'construct',type:ids.aggregate,range:cwRange(128,138),constructorId:ids.constructor,signature:{ownerKind:'constructor',owner:ids.constructor,type:ids.ctorType,presence:null,returnPresence:null},
    arguments:[]},
    write={kind:'bindingWrite',type:ids.aggregate,range:cwRange(119,138),operator:'=',target:{kind:'bindingTarget',type:ids.unknown,binding:ids.caught,range:cwRange(119,125)},
    value:construct};
  catchRegion.body=[{kind:'throw',range:cwRange(111,140),value:{kind:'group',type:ids.aggregate,range:cwRange(118,139),operand:write}}];
  }else{catchRegion.body=[{kind:'throw',range:cwRange(96,115),value:{kind:'bindingRead',type:ids.unknown,range:cwRange(107,114),binding:ids.caught,presenceFlow:null}}];
  attempt.finallyRegion={kind:'region',role:'finally',scope:ids.finallyScope,parentScope:ids.scope,path:[{statement:0,slot:'finally'}],
    range:cwRange(128,167),bindings:[{id:ids.copied,name:'copied',role:'local',type:ids.scalar,writable:false,range:cwRange(141,148),presence:null}],
    body:[{kind:'local',range:cwRange(141,161),binding:ids.copied,initializer:{kind:'bindingRead',type:ids.scalar,range:cwRange(155,161),binding:ids.parameter,presenceFlow:null}}]};
  }root.body=[attempt];
  types.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {format:{family:'tsfg.exception-hir-candidate',version:1,schemaHash:cwSchema},
    snapshot:cwCopy(snapshot),inputIdentity:snapshot.inputIdentity,sources:[{path:cwSourcePath,content:spec.source,hash:cwHash(spec.source),length:spec.end,positionUnit:'utf16'}],
    target:cwCopy(cwTarget),types,functions:[{id:ids.function,module:ids.module,sourcePath:cwSourcePath,name:'entry',nameRange:cwRange(spec.nameStart,spec.nameEnd),range:cwRange(spec.start,spec.end),type:ids.callable,signatureHash:ids.signature,lexicalParent:null,declaringScope:ids.moduleScope,parameters:[ids.parameter],
    parameterInitializers:[null],
    captures:null,returnPresence:null,body:root}],
    modules:[{id:ids.module,sourcePath:cwSourcePath,external:true,functions:[ids.function],
    aggregateTypes,imports:[],
    globals:[],
    initialization:null,closure:null,coverage}],
    exports:[{module:ids.module,sourcePath:cwSourcePath,external:true,bindings:[{name:'entry',target:ids.function,sourcePath:cwSourcePath,range:cwRange(spec.start,spec.end),definition:cwRange(spec.nameStart,spec.nameEnd)}]}]};
  }
// Standalone ownership helpers avoid executable imports from older tests.
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
/** @param {any} spec @param {any} ids @returns {Array<(h:any)=>void>} */
function relationChanges(spec,ids) {
  /** @type {Array<(h:any)=>void>} */ const changes=[
    h=>{h.functions[0].body.body[0].catchClause.region.bindings[0].type=ids.scalar;},
    h=>{h.functions[0].body.body[0].catchClause.region.bindings[0].writable=false;},
    h=>{h.functions[0].body.body[0].catchClause.binding=ids.parameter;},
    h=>{h.functions[0].body.body[0].catchClause.declarationRange=null;},
    h=>{h.functions[0].body.body[0].catchClause.annotationRange=cwRange(spec.catchStart,spec.catchEnd);},
    h=>{h.functions[0].body.body[0].tryRegion.parentScope=ids.catchScope;},
    h=>{h.functions[0].body.body[0].catchClause.region.path[0].slot='finally';},
    h=>{h.functions[0].parameterInitializers=null;},
    h=>{h.functions[0].captures=[];},
    h=>{delete h.functions[0].body.bindings[0].presence.optional;},
    h=>{h.functions[0].body.bindings[0].writable=false;},
    h=>{h.modules[0].coverage=[];},
    h=>{h.exports[0].bindings[0].target=ids.module;},
    h=>{h.types=h.types.filter(type=>type.id!==ids.unknown);},
    h=>{h.functions[0].range.start++;},
  ];
  if(spec.id==='29')changes.push(
    h=>{const caught=h.functions[0].body.body[0].catchClause.region.body[0];caught.value=caught.value.operand;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.type=ids.unknown;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.target.type=ids.aggregate;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.target.binding=ids.parameter;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.value.constructorId=ids.function;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.value.arguments=null;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.value.signature.presence=[];},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.value.signature.owner=ids.module;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.range.start++;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.range.start++;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.target.range.start++;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.operand.value.range.end--;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value={kind:'bindingRead',type:ids.scalar,binding:ids.parameter,range:cwRange(118,139),presenceFlow:null};},
    h=>{h.types.find(type=>type.kind==='aggregate').constructors[0].owner=ids.unknown;},
    h=>{h.types.find(type=>type.kind==='aggregate').memberCoverage=null;},
    h=>{h.types.find(type=>type.kind==='aggregate').markerOrigin.declarationRange.start++;},
  );
  else changes.push(
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.type=ids.scalar;},
    h=>{h.functions[0].body.body[0].catchClause.region.body[0].value.binding=ids.parameter;},
    h=>{h.functions[0].body.body[0].finallyRegion=null;},
    h=>{h.functions[0].body.body[0].finallyRegion.body=[];},
    h=>{h.functions[0].body.body[0].finallyRegion.bindings[0].writable=true;},
    h=>{h.functions[0].body.body[0].finallyRegion.bindings[0].presence={undefined:false,null:false};},
    h=>{h.functions[0].body.body[0].finallyRegion.body[0].initializer.binding=ids.caught;},
    h=>{h.functions[0].body.body[0].finallyRegion.body[0].initializer.type=ids.unknown;},
    h=>{h.functions[0].body.body[0].finallyRegion.parentScope=ids.catchScope;},
    h=>{h.functions[0].body.body[0].finallyRegion.path[0].slot='catch';},
    h=>{h.functions[0].body.body[0].finallyRegion.body[0].binding=ids.parameter;},
    h=>{h.functions[0].body.body[0].finallyRegion.range.start++;},
    h=>{h.functions[0].body.body[0].finallyRegion.body[0].initializer.range.start++;},
  );
  return changes;
}
test('actual catch write and corpus-origin rethrow retain complete typed regions',async t=>{
  for(const spec of cwSpecs)await t.test(spec.id,async t=>{
    const names=['request.json','response.json','origin.json'];
    const buffers=await Promise.all(names.map(name=>readFile(new URL(spec.id+'/'+name,root)))),before=buffers.map(cwHash);
    let snapshot,expectedCold,ready=false;
    await t.test('completeIndependentSourcePacketAndTenFieldColdControl',async()=>{
      assert.deepEqual(before,names.map(name=>cwPacketPins[spec.id+'/'+name]));
      assert.equal(spec.source.length,spec.end);assert.equal(Buffer.byteLength(spec.source),spec.end+2);
      assert.equal(cwHash(cwConversions),'sha256:60974c1fa82cc549da3a9268f5d82ab10b58f52e2612a377ee4577f05af52c86');
      assert.equal(cwHash(cwMarkers),'sha256:6e55208fcb05c4383ce87a058fc3bf69834bcf04ac51011109771b963729d9a9');
      assert.equal(cwHash(cwIntegers),'sha256:9fc1955899e303b5815590f7150f60662f3cece0a633c94a2a06669cf509a96e');
      assert.equal(spec.source.slice(spec.nameStart,spec.nameEnd),' entry');
      assert.equal(spec.source.slice(spec.paramStart,spec.paramEnd),'value');
      assert.equal(spec.source.slice(spec.catchStart,spec.catchEnd),'caught');
      if(spec.id==='29'){
        assert.equal(spec.source.slice(119,125),'caught');assert.equal(spec.source.slice(128,138),'new Pair()');
      }else assert.equal(spec.source.slice(155,161),' value');
      const expected=cwTransport(spec),origin=cwOrigins[spec.id],response=JSON.parse(expected.responseText);
      assert.deepEqual(buffers[0],Buffer.from(expected.requestText),'entire request from independent literal input');
      assert.deepEqual(buffers[1],Buffer.from(expected.responseText),'entire actual package from complete manual Source facts and exports');
      assert.deepEqual(buffers[2],Buffer.from(cwJcs(origin)));expectedCold=expected.snapshot;
      assert.deepEqual({inputIdentity:expectedCold.inputIdentity,snapshotId:expectedCold.snapshotId,
        requestId:response.requestId,packageId:response.packageId},cwSnapshotPins[spec.id]);
      assert.equal(Object.keys(expectedCold).length,10);assert.equal('floats' in expectedCold.target,false);
      const imported=await importCapturedFrontendResponse(buffers[0],buffers[1],origin);
      assert.equal(imported.status,'ok',JSON.stringify(imported));snapshot=imported.snapshot;assert.deepEqual(snapshot,expectedCold);frozen(snapshot);
      assert.deepEqual(validateFrontendSnapshot(cwCopy(snapshot)),validateFrontendSnapshot(snapshot));assert.deepEqual(buffers.map(cwHash),before);ready=true;
    });
    if(!ready)return;
    await t.test('completeManualTypesScopesCurrentPayloadOwnershipAndColdRelations',()=>{
      const expected=cwManualHir(spec,expectedCold),ids=cwIds(spec),fn=expected.functions[0],attempt=fn.body.body[0];
      assert.deepEqual(ids,cwIdentityPins[spec.id]);assert.equal(expected.types.length,spec.id==='29'?5:3);
      const expectedText=cwJcs(expected)+'\n';assert.equal(Buffer.byteLength(expectedText),cwHirPins[spec.id].bytes);
      assert.equal(cwHash(expectedText),cwHirPins[spec.id].sha256);
      assert.equal(attempt.catchClause.region.bindings[0].type,ids.unknown);
      if(spec.id==='29'){
        const write=attempt.catchClause.region.body[0].value.operand;
        assert.equal(write.target.type,ids.unknown);assert.equal(write.type,ids.aggregate);assert.equal(write.value.type,ids.aggregate);
        assert.equal(attempt.finallyRegion,null);assert.equal(expected.modules[0].coverage.length,2);
      }else{
        assert.equal(attempt.catchClause.region.body[0].value.type,ids.unknown);
        assert.equal(attempt.finallyRegion.bindings[0].writable,false);assert.equal(expected.modules[0].coverage,null);
      }
      const caller=cwCopy(snapshot),callerBefore=cwJcs(caller),result=buildHir(caller);assert.equal(result.status,'ok',JSON.stringify(result));
      assert.deepEqual(result.hir,expected,'entire independently reconstructed HIR including current RHS, regions, aggregate, origin and exports');
      assert.equal(cwJcs(caller),callerBefore);frozen(result.hir);noAliases(result.hir,caller);
      const text=cwJcs(expected)+'\n',cold=cwCopy(result.hir),verified=verifyHir(cold),bytes=Buffer.from(text);
      assert.deepEqual(verified,expected);frozen(verified);noAliases(verified,cold);assert.equal(printHir(result.hir),text);
      const read=readHir(bytes);assert.deepEqual(read,expected);frozen(read);bytes.fill(0);
      cold.functions[0].body.body[0].catchClause.region.bindings[0].writable=false;caller.sources[0].content='caller mutation';
      assert.deepEqual(result.hir,expected);assert.deepEqual(read,expected);assert.deepEqual(verified,expected);
      assert.deepEqual(buildHir(cwCopy(snapshot)).hir,expected);assert.equal(printHir(readHir(Buffer.from(text))),text);
      assert.throws(()=>lowerHir(result.hir),{name:'TypeError',code:'r03-d-capability',ruleId:'r01-ts-baseline',phase:'lowering'});
      assert.deepEqual(buffers.map(cwHash),before);
      // These change only HIR relations, while the complete embedded Source packet,
      // its origin and every request/file/package/input identity remain valid.
      for(const [index,change] of relationChanges(spec,ids).entries()){
        const bad=cwCopy(expected);change(bad);const original=cwJcs(bad);
        assert.notEqual(original,cwJcs(expected),'nontrivial relation '+index);
        assert.throws(()=>verifyHir(bad),rejected,'verify relation '+index);
        assert.throws(()=>printHir(bad),rejected,'print relation '+index);
        assert.throws(()=>readHir(Buffer.from(original+'\n')),rejected,'read relation '+index);assert.equal(cwJcs(bad),original);
      }
    });
  });
});
