// SPDX-License-Identifier: MIT
// Runtime-owned Win64 call bridge. This is never a guest compilation backend.
#include <stdint.h>
struct TsfgCounter;
extern uint32_t tsfg_host_counter(struct TsfgCounter *, uint32_t);

// A real call keeps the leaf's incoming return and this bridge's shadow storage
// visible to the independent object/linked-code proof. A tail jump is rejected.
__attribute__((disable_tail_calls))
uint32_t tsfg_host_counter_bridge(struct TsfgCounter *counter, uint32_t delta) {
  return tsfg_host_counter(counter, delta);
}
