// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Empty { n!: i32; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function emptyAssertedRead(e: Empty): i32 { return e.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
