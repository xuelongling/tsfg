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
type f64 = number;
type u32 = number;
interface ReadSpan<T> { readonly [n: number]: T; readonly length: u32; }
declare function readSpan<T>(owner: T[], start: u32, length: u32): ReadSpan<T>;
