// SPDX-License-Identifier: Apache-2.0
// 😀 Complete official value Program and original UTF16.
@tsfgValue
class Delta { n: i32 = 0; }
@tsfgValue
class Floating { single: f32 = 0.0; wide: f64 = -0.0; }
export function valueF64Arithmetic(d: Floating, a: f64, choose: bool): f64 { let x: f64 = +d.wide; x = -x; x = (x + a) - (x * a); if (choose) { x = x / a; } else { x = x % a; } if (x < a) { return x; } if (x <= a) { return x; } if (x > a) { return x; } if (x >= a) { return x; } return x; }
export function valueOrdinary(d: Delta): i32 { return d.n; }
export function valueF32Arithmetic(d: Floating, a: f32, choose: bool): f32 { let x: f32 = +d.single; x = -x; x = (x + a) - (x * a); if (choose) { x = x / a; } else { x = x % a; } if (x < a) { return x; } if (x <= a) { return x; } if (x > a) { return x; } if (x >= a) { return x; } return x; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
