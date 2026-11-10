// SPDX-License-Identifier: Apache-2.0
export function constantKernel(x: i32): i32 {
  return x << 32;
}

export function otherKernel(x: i32): i32 {
  return x;
}
