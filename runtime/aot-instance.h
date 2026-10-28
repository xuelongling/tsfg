// SPDX-License-Identifier: MIT
#ifndef TSFG_AOT_INSTANCE_H
#define TSFG_AOT_INSTANCE_H
#include <stdint.h>
#include <stddef.h>

/* Internal ordinary AOT ABI. Raw requests never supply these trusted pointers. */
#define TSFG_AOT_INSTANCE_VERSION 4u
#define TSFG_AOT_HOST_ENTITY 0x80000000u
enum TsfgAotStatusV4 { TSFG_AOT_COLD, TSFG_AOT_INITIALIZING, TSFG_AOT_READY, TSFG_AOT_FAILED };
enum TsfgAotFailureKindV4 { TSFG_AOT_NONE, TSFG_AOT_TRAP, TSFG_AOT_ABORT, TSFG_AOT_REQUEST, TSFG_AOT_EXCEPTION };
enum TsfgAotReasonV4 {
  TSFG_AOT_REASON_NONE, TSFG_AOT_DIVIDE_ZERO, TSFG_AOT_REMAINDER_ZERO,
  TSFG_AOT_SHIFT_RANGE, TSFG_AOT_CONVERSION_NONFINITE, TSFG_AOT_CONVERSION_RANGE,
  TSFG_AOT_TDZ, TSFG_AOT_FUEL, TSFG_AOT_DEPTH, TSFG_AOT_EXECUTION_ABORT,
  TSFG_AOT_BAD_INSTANCE, TSFG_AOT_BAD_FUNCTION, TSFG_AOT_BAD_ARGUMENTS,
  TSFG_AOT_BAD_CAPABILITY, TSFG_AOT_BAD_HOST_CONTRACT, TSFG_AOT_BAD_PRESENCE
};
typedef struct TsfgAotFailureV4 {
  uint32_t kind, reason, function_index, source_index, start, end;
  uint32_t reserved[2];
} TsfgAotFailureV4;
typedef struct TsfgAotHost31V4 {
  uint32_t capability, reserved;
  uint8_t signature[32], semantic_contract[32];
  void *counter;
} TsfgAotHost31V4;
typedef struct TsfgAotAuthorityV4 {
  uint32_t version, bytes;
  uint8_t signature[32], semantic_contract[32];
  uint32_t (*host31)(void *, uint32_t);
  uint32_t (*admitted)(const void *);
} TsfgAotAuthorityV4;
typedef struct TsfgAotInstanceV4 {
  uint32_t version, bytes;
  uint8_t compiled_table_id[32];
  uint32_t status, active, global_count, host_count;
  uint64_t *globals;
  uint8_t *initialized;
  const TsfgAotHost31V4 *hosts;
  const TsfgAotAuthorityV4 *authority;
  TsfgAotFailureV4 memo;
} TsfgAotInstanceV4;
typedef int32_t (*TsfgAotEventV4)(void *, uint32_t, uint32_t, uint32_t, uint32_t, uint64_t);
typedef struct TsfgAotRequestV4 {
  uint32_t version, bytes;
  void *event_state;
  TsfgAotEventV4 event;
  TsfgAotFailureV4 failure;
} TsfgAotRequestV4;
#ifdef __cplusplus
extern "C" {
#endif
/* global_count binds both array capacities. host_count is the exact required
 * capability set, not the full retained Host metadata table. */
extern const uint32_t tsfg_aot_global_count_v4, tsfg_aot_required_host_count_v4;
extern const uint8_t tsfg_aot_compiled_table_id_v4[32];
uint32_t tsfg_aot_instance_init_v4(TsfgAotInstanceV4 *);
uint32_t tsfg_aot_invoke_v4(TsfgAotInstanceV4 *, TsfgAotRequestV4 *, uint32_t,
  uint32_t, const uint8_t *, uint8_t, const void *, void *);
#ifdef __cplusplus
}
#define TSFG_AOT_ASSERT static_assert
#define TSFG_AOT_ALIGN alignof
#else
#define TSFG_AOT_ASSERT _Static_assert
#define TSFG_AOT_ALIGN _Alignof
#endif
TSFG_AOT_ASSERT(sizeof(void *) == 8, "AOTv4 requires Win64 pointer layout");
TSFG_AOT_ASSERT(sizeof(TsfgAotFailureV4) == 32, "AOTv4 failure layout");
TSFG_AOT_ASSERT(offsetof(TsfgAotFailureV4, reserved) == 24, "AOTv4 failure fields");
TSFG_AOT_ASSERT(sizeof(TsfgAotHost31V4) == 80, "AOTv4 Host layout");
TSFG_AOT_ASSERT(offsetof(TsfgAotHost31V4, counter) == 72, "AOTv4 Host fields");
TSFG_AOT_ASSERT(sizeof(TsfgAotAuthorityV4) == 88, "AOTv4 authority layout");
TSFG_AOT_ASSERT(offsetof(TsfgAotAuthorityV4, admitted) == 80, "AOTv4 authority fields");
TSFG_AOT_ASSERT(sizeof(TsfgAotInstanceV4) == 120, "AOTv4 instance layout");
TSFG_AOT_ASSERT(offsetof(TsfgAotInstanceV4, globals) == 56, "AOTv4 global fields");
TSFG_AOT_ASSERT(offsetof(TsfgAotInstanceV4, memo) == 88, "AOTv4 memo fields");
TSFG_AOT_ASSERT(sizeof(TsfgAotRequestV4) == 56, "AOTv4 request layout");
TSFG_AOT_ASSERT(offsetof(TsfgAotRequestV4, failure) == 24, "AOTv4 request fields");
TSFG_AOT_ASSERT(TSFG_AOT_ALIGN(TsfgAotFailureV4) == 4, "AOTv4 failure alignment");
TSFG_AOT_ASSERT(TSFG_AOT_ALIGN(TsfgAotHost31V4) == 8, "AOTv4 Host alignment");
TSFG_AOT_ASSERT(TSFG_AOT_ALIGN(TsfgAotAuthorityV4) == 8, "AOTv4 authority alignment");
TSFG_AOT_ASSERT(TSFG_AOT_ALIGN(TsfgAotInstanceV4) == 8, "AOTv4 instance alignment");
TSFG_AOT_ASSERT(TSFG_AOT_ALIGN(TsfgAotRequestV4) == 8, "AOTv4 request alignment");
#undef TSFG_AOT_ASSERT
#undef TSFG_AOT_ALIGN
#endif
