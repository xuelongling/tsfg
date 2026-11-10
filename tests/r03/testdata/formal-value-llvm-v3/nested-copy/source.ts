// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Nested { inner: Delta = new Delta(); tag: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function nestedCopy(d: Nested): Nested { const copy: Nested = d; copy.inner.n = 7; copy.tag = 9; return copy; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
