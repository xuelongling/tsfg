// SPDX-License-Identifier: Apache-2.0
// 😀 Original spelling and UTF16 are retained.
@tsfgValue
class Delta { \u006e: i32 = 0; }
export function escapedValue(x: Delta): i32 { return x.\u006e + 7; }
export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
