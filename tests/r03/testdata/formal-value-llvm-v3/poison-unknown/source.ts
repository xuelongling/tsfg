// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function poisonUnknownWrite(d: Delta): i32 { d.n = undefined as unknown as i32; return d.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
