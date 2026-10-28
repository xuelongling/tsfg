// SPDX-License-Identifier: MIT
// Runtime-owned host adapter. The guest never compiles through this source.
// Unsigned arithmetic defines wrapping for every possible i32 bit pattern.
#include <stdint.h>
struct TsfgCounter { uint32_t storage, reserved; uint64_t events; };
uint32_t tsfg_host_counter(struct TsfgCounter *counter, uint32_t delta) {
  counter->events += UINT64_C(1);
  counter->storage += delta;
  return counter->storage;
}
