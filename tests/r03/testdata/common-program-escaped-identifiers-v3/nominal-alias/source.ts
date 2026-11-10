// SPDX-License-Identifier: Apache-2.0
// 😀 Original spelling and UTF16 are retained.
@tsfgValue
class Delta { n: i32 = 0; }
type \u0041lias = Delta;
export function escapedValue(x: \u0041lias): i32 { return x.n + 7; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
