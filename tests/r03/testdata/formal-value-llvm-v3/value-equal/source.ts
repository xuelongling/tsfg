// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Nested { inner: Delta = new Delta(); tag: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueEqual(a: Nested, b: Nested): bool { return a === b; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
