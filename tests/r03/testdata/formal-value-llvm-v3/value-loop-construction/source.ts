// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Constructed { n: i32 = 17; guard: i32 = 23; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueConstructLoop(run: bool, again: bool): i32 { let result: i32 = 0; while (run) { const current: Constructed = new Constructed(); result = current.n + current.guard; current.n = 41; run = again; again = false; } return result; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
