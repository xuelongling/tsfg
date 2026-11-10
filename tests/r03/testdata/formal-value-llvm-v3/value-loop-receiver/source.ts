// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function mark(x: Delta): i32 { return 7; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueLoopReceiver(d: Delta, run: bool, again: bool): i32 { let current: Delta = d; while (run) { current.n = mark(current = d); run = again; again = false; } return current.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
