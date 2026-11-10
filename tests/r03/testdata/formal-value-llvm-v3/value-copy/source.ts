// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueCopy(d: Delta): Delta { const copy: Delta = d; copy.n = 7; return copy; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
