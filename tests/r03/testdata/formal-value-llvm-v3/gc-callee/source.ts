// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
class Box { n: i32 = 0; }
function allocating(): i32 { const box: Box = new Box(); return box.n; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueGcCall(d: Delta): i32 { return allocating() + d.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
