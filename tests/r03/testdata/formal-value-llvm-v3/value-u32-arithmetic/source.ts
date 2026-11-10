// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Unsigned { n: u32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueU32Arithmetic(d: Unsigned, a: u32, choose: bool): u32 { let x: u32 = +d.n; x = -x; x = ~x; x = (x + a) - (x * a); if (choose) { x = x / a; } else { x = x % a; } x = (x & a) | (x ^ a); if (!choose) { if (x < a) { return x; } if (x <= a) { return x; } } else { if (x > a) { return x; } if (x >= a) { return x; } } return x; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
