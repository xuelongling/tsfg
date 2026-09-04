// SPDX-License-Identifier: MIT

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#if defined(TSFG_R00_SIMD_DISPATCH_RUNTIME) && TSFG_R00_SIMD_DISPATCH_RUNTIME && defined(__clang__)
#include <immintrin.h>
#if defined(_MSC_VER)
#include <intrin.h>
#else
#include <cpuid.h>
#endif
#endif

namespace {

using SumImplementation = int (*)(const int*);

#if TSFG_R00_SIMD_DISPATCH_RUNTIME && defined(__clang__)
#if defined(_MSC_VER)
void cpuid(int registers[4], int leaf, int subleaf) {
  __cpuidex(registers, leaf, subleaf);
}

uint64_t xgetbv0() {
  return _xgetbv(0);
}
#else
void cpuid(int registers[4], int leaf, int subleaf) {
  unsigned int eax = 0;
  unsigned int ebx = 0;
  unsigned int ecx = 0;
  unsigned int edx = 0;
  __cpuid_count(leaf, subleaf, eax, ebx, ecx, edx);
  registers[0] = static_cast<int>(eax);
  registers[1] = static_cast<int>(ebx);
  registers[2] = static_cast<int>(ecx);
  registers[3] = static_cast<int>(edx);
}

uint64_t xgetbv0() {
  uint32_t eax = 0;
  uint32_t edx = 0;
  __asm__ volatile("xgetbv" : "=a"(eax), "=d"(edx) : "c"(0));
  return (static_cast<uint64_t>(edx) << 32) | eax;
}
#endif

bool runtime_supports_avx2() {
  int registers[4] = {};
  cpuid(registers, 1, 0);
  constexpr int avx = 1 << 28;
  constexpr int osxsave = 1 << 27;
  if ((registers[2] & (avx | osxsave)) != (avx | osxsave)) return false;
  if ((xgetbv0() & 0x6) != 0x6) return false;
  cpuid(registers, 7, 0);
  constexpr int avx2 = 1 << 5;
  return (registers[1] & avx2) != 0;
}
#endif

#if defined(__clang__)
__attribute__((noinline))
#elif defined(_MSC_VER)
__declspec(noinline)
#endif
int baseline_sum(const int* values) {
  int sum = 0;
  for (int index = 0; index < 8; ++index) sum += values[index];
  return sum;
}

#if TSFG_R00_SIMD_DISPATCH_RUNTIME && defined(__clang__)
__attribute__((noinline, target("avx2")))
int avx2_sum(const int* values) {
  const __m256i packed = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(values));
  const __m128i halves = _mm_add_epi32(
      _mm256_castsi256_si128(packed),
      _mm256_extracti128_si256(packed, 1));
  const __m128i pairs = _mm_hadd_epi32(halves, halves);
  return _mm_cvtsi128_si32(_mm_hadd_epi32(pairs, pairs));
}
#endif

SumImplementation select_sum(bool force_baseline, bool* used_avx2) {
  *used_avx2 = false;
#if TSFG_R00_SIMD_DISPATCH_RUNTIME && defined(__clang__)
  if (!force_baseline && runtime_supports_avx2()) {
    *used_avx2 = true;
    return avx2_sum;
  }
#else
  (void)force_baseline;
#endif
  return baseline_sum;
}

}  // namespace

int main(int argc, char** argv) {
  const bool force_baseline = argc == 2 && strcmp(argv[1], "--cpu-fixture=x86-64-v2") == 0;
  if (argc > 1 && !force_baseline) return 2;
  const int values[8] = {1, 2, 3, 4, 5, 6, 7, 8};
  bool used_avx2 = false;
  const int sum = select_sum(force_baseline, &used_avx2)(values);
  assert(sum == 36);
  if (force_baseline) {
    assert(!used_avx2);
    return puts("tsfg-r00-cpp-smoke: baseline fallback ok") < 0 ? 1 : 0;
  }
  return puts("tsfg-r00-cpp-smoke: ok") < 0 ? 1 : 0;
}
