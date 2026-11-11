// SPDX-License-Identifier: Apache-2.0
// 😀 Original UTF-16 closure call sites.
function factory(seed: i32): () => i32 {
  const n: i32 = seed;
  function inner(): i32 { return n; }
  inner();
  return inner;
}
export function entry(seed: i32): i32 {
  return factory(seed)();
}
