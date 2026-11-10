// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function valueMutualB(d: Delta, stop: bool): i32 { if (stop) { return d.n; } return valueMutualA(d, true); }
class Box { n: i32 = 0; }
function allocating(): i32 { const box: Box = new Box(); return box.n; }
export function valueRecursiveGc(d: Delta, stop: bool): i32 { if (stop) { const prior: i32 = valueRecursiveGc(d, false); return allocating() + prior; } return d.n; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueMutualA(d: Delta, stop: bool): i32 { if (stop) { return d.n; } return valueMutualB(d, true); }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
