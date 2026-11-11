// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Constructed { n: i32 = 17; guard: i32 = 23; }
export function valueConstructIndependent(): i32 { const first: Constructed = new Constructed(); const second: Constructed = new Constructed(); first.n = 41; return second.n; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueConstruct(): Constructed { return new Constructed(); }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
