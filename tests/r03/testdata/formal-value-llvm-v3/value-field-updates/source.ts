// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
function mark(x: Delta): i32 { return x.n; }
export function valueFieldPostfix(d: Delta): i32 { return d.n++; }
export function valueFieldPrefix(d: Delta): i32 { return --d.n; }
export function valueCompoundRhsTrap(d: Delta): i32 { const absent: i32 = undefined as unknown as i32; return d.n += -absent; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueCompoundRebind(d: Delta, replacement: Delta): i32 { let current: Delta = d; return current.n -= mark(current = replacement); }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
