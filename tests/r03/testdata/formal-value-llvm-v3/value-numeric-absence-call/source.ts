// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function keepUndefined(): i32 { return undefined as unknown as i32; }
export function valueAbsenceConsume(d: Delta): i32 { const u: i32 = keepUndefined(); return -u; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueAbsenceReturn(d: Delta): i32 { const u: i32 = keepUndefined(); return u as i32; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
