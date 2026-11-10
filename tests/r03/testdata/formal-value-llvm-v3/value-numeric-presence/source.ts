// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function keep(x: i32): i32 { return x; }
export function valueNumericOnlyUndefined(d: Delta): i32 { const u: i32 = undefined as unknown as i32; return -u; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueNumericMaybe(d: Delta, b: bool): i32 { if (b) { d.n = undefined as unknown as i32; } const alias: i32 = d.n as i32; return keep(alias) + 7; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
