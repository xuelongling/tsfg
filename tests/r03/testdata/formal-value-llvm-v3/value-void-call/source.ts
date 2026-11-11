// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function touch(d: Delta): void { d.n = 7; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueVoidCall(d: Delta): i32 { touch(d); return d.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
