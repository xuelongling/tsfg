// SPDX-License-Identifier: MIT
interface Object {}
interface Function {}
interface CallableFunction {}
interface NewableFunction {}
interface IArguments {}
interface String {}
interface Number {}
interface Boolean {}
interface RegExp {}
interface Array<T> {}
type bool = boolean;
declare const __tsfg_i8: unique symbol;
declare const __tsfg_i16: unique symbol;
declare const __tsfg_i32: unique symbol;
declare const __tsfg_i64: unique symbol;
declare const __tsfg_u8: unique symbol;
declare const __tsfg_u16: unique symbol;
declare const __tsfg_u32: unique symbol;
declare const __tsfg_u64: unique symbol;
declare const __tsfg_isize: unique symbol;
declare const __tsfg_usize: unique symbol;
type i8 = number & { readonly [__tsfg_i8]: true };
type i16 = number & { readonly [__tsfg_i16]: true };
type i32 = number & { readonly [__tsfg_i32]: true };
type i64 = number & { readonly [__tsfg_i64]: true };
type u8 = number & { readonly [__tsfg_u8]: true };
type u16 = number & { readonly [__tsfg_u16]: true };
type u32 = number & { readonly [__tsfg_u32]: true };
type u64 = number & { readonly [__tsfg_u64]: true };
type isize = number & { readonly [__tsfg_isize]: true };
type usize = number & { readonly [__tsfg_usize]: true };
type f64 = number;
declare const __tsfg_f32: unique symbol;
type f32 = number & { readonly [__tsfg_f32]: true };
