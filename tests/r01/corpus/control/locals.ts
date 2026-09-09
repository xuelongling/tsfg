// SPDX-License-Identifier: MIT
export function main(flag: bool): i32 {
  const seed: i32 = 3;
  let value: i32 = seed;
  if (flag) { value = value + 4; } else { value = value - 2; }
  return value;
}
