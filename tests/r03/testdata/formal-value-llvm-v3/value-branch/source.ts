// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueBranch(d: Delta, flag: bool): Delta { if (flag) { const copy: Delta = d; copy.n = 4; return copy; } return d; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
