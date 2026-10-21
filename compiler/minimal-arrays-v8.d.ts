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
interface Array<T> { [n: number]: T; length: number; }
type i8 = number;
type i16 = number;
type i32 = number;
type i64 = number;
type isize = number;
type u8 = number;
type u16 = number;
type u32 = number;
type u64 = number;
type usize = number;
type f32 = number;
type f64 = number;
type bool = boolean;
interface ReadSpan<T> { readonly [n: number]: T; readonly length: u32; }
declare function readSpan<T>(owner: T[], start: u32, length: u32): ReadSpan<T>;
interface ClassDecoratorContext<C> {
  readonly kind: "class";
  readonly name: string | undefined;
  addInitializer(initializer: (this: C) => void): void;
}
declare function tsfgValue<C>(target: C, context: ClassDecoratorContext<C>): void;
declare function tsfgComponent<C>(target: C, context: ClassDecoratorContext<C>): void;
