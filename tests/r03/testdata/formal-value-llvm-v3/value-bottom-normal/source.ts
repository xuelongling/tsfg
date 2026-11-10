// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function mutualBottomB(d: Delta): i32 { return mutualBottomA(d); }
export function mutualBottomA(d: Delta): i32 { return mutualBottomB(d); }
class Box { n: i32 = 0; }
function allocating(): i32 { const box: Box = new Box(); return box.n; }
export function bottomManaged(d: Delta): i32 { const prior: i32 = mutualBottomA(d); return allocating() + prior; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function mixedBottom(d: Delta, run: bool): i32 { if (run) { return mutualBottomA(d); } return d.n; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
