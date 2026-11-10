// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class RecursiveFloating { n: i32 = 0; wide: f64 = -0.0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueRecursiveAggregate(d: RecursiveFloating, stop: bool): RecursiveFloating { const copy: RecursiveFloating = d; copy.n = 7; if (stop) { return copy; } const result: RecursiveFloating = valueRecursiveAggregate(copy, true); result.n = 9; return result; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
