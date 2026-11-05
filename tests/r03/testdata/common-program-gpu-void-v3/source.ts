// SPDX-License-Identifier: Apache-2.0
let leftTotal: i32 = 0;
let rightTotal: i32 = 0;

export function sink(x: i32): void {
  leftTotal += x;
  return;
}

export function right(x: i32): i32 {
  rightTotal += x;
  return rightTotal;
}
