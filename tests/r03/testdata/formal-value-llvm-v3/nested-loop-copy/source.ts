// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Nested { inner: Delta = new Delta(); tag: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function nestedLoopCopy(d: Nested, run: bool, again: bool): Nested { let saved: Nested = d; while (run) { const copy: Nested = d; let inner: bool = true; while (inner) { if (again) { saved = copy; } copy.inner.n = 7; copy.tag = 9; inner = false; } d.inner.n = 4; d.tag = 5; run = again; again = false; } return saved; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
