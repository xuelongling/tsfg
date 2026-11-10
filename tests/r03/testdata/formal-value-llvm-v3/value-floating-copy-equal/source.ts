// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Floating { single: f32 = 0.0; wide: f64 = -0.0; }
export function valueFloatingCopy(d: Floating): Floating { return d; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueFloatingEqual(left: Floating, right: Floating): bool { return left === right; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
