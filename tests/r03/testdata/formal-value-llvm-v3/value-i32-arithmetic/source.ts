// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueI32Arithmetic(d: Delta, a: i32, count: i32, choose: bool): i32 { let x: i32 = +d.n; x = -x; x = ~x; x = (x + a) - (x * a); if (choose) { x = x / a; } else { x = x % a; } x = ((x << count) ^ (x >> count)) | (x >>> count); x = x & a; if (!choose) { if (x < a) { return x; } if (x <= a) { return x; } } else { if (x > a) { return x; } if (x >= a) { return x; } } return x; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
