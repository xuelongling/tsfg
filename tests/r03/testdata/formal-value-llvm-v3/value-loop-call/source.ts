// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function relay(d: Delta): Delta { return d; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueLoopCall(d: Delta, run: bool, again: bool): Delta { let saved: Delta = d; while (run) { saved = relay(d); d.n = 9; run = again; again = false; } return saved; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
