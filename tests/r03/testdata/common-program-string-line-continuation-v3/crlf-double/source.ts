// SPDX-License-Identifier: Apache-2.0
// 😀 Preserve original UTF16 and continuation spelling.
export function concatValue(x: string): string {
  return x + "A\
B";
}

export function leftKernel(x: i32): i32 { return x; }
export function rightKernel(x: i32): i32 { return x; }
