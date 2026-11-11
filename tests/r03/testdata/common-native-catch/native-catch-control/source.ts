// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
class Box { n: i32 = 0; }
function failNative(): i32 { throw 7; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function catchNative(): i32 { try { return failNative(); } catch (caught) { return caught as i32; } }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
