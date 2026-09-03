// SPDX-License-Identifier: MIT

#include <assert.h>
#include <stdio.h>

int main() {
  assert(2 + 2 == 4);
  return puts("tsfg-r00-cpp-smoke: ok") < 0 ? 1 : 0;
}
